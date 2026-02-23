import { NextRequest } from "next/server"

import { buildChatOrchestratorPrompt } from "@/lib/prompts"
import { extractJsonObject } from "@/lib/schemas"
import { withMeta } from "@/lib/server/api-response"
import {
  appendChatStep,
  appendChatTurn,
  ensureChatSession,
  getWorkflowTask,
  type WorkflowTaskStep,
  type WorkflowTaskValidation,
  updateChatSessionMeta,
  upsertWorkflowTask,
} from "@/lib/server/chat-session-registry"
import {
  createChatCompletion,
  hasChatModelConfig,
} from "@/lib/server/openai"
import {
  ingestLegacyConversation,
  isLegacyMemoryEnabled,
  retrieveLegacyMemory,
  upsertLegacyPerformanceSummary,
  upsertLegacyProfile,
  upsertLegacyProjectContext,
} from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const workflowSteps = ["research", "drafts", "rewrite", "assets", "publish", "analytics"] as const
type WorkflowStep = (typeof workflowSteps)[number]

const stepToPath: Record<WorkflowStep, string> = {
  research: "/research",
  drafts: "/drafts",
  rewrite: "/rewrite",
  assets: "/assets",
  publish: "/publish",
  analytics: "/analytics",
}

type OrchestratorOutput = {
  reply: string
  suggestedStep: WorkflowStep
  reason: string
  profileUpdate?: Record<string, unknown>
}

type StepCounters = {
  sourceCount: number
  draftCount: number
  variantCount: number
  assetCount: number
  publishCount: number
  publishSuccess: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function toSafeInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function countersFromHint(hint: Record<string, unknown>): StepCounters {
  return {
    sourceCount: toSafeInt(hint.source_count),
    draftCount: toSafeInt(hint.draft_count),
    variantCount: toSafeInt(hint.variant_count),
    assetCount: toSafeInt(hint.asset_count),
    publishCount: toSafeInt(hint.publish_count),
    publishSuccess: toSafeInt(hint.publish_success),
  }
}

function normalizeStep(value: unknown, fallback: WorkflowStep): WorkflowStep {
  const raw = String(value || "").trim().toLowerCase()
  return workflowSteps.includes(raw as WorkflowStep) ? (raw as WorkflowStep) : fallback
}

function classifyStepByMessage(message: string, fallback: WorkflowStep): WorkflowStep {
  const text = message.toLowerCase()
  if (/(research|topic|keyword|search|trend|source|选题|研究|检索|趋势|热点)/.test(text)) return "research"
  if (/(draft|article|long[- ]?form|初稿|长文|写作|文章)/.test(text)) return "drafts"
  if (/(rewrite|platform|wechat|xiaohongshu|weibo|bilibili|改写|多平台|口播)/.test(text)) return "rewrite"
  if (/(asset|image|cover|visual|素材|配图|封面|图片)/.test(text)) return "assets"
  if (/(publish|wordpress|export|发布|推送|导出)/.test(text)) return "publish"
  if (/(analytics|metrics|dashboard|统计|分析|复盘|看板)/.test(text)) return "analytics"
  return fallback
}

function buildFallbackOutput(message: string, currentStep: WorkflowStep): OrchestratorOutput {
  const suggestedStep = classifyStepByMessage(message, currentStep)
  return {
    reply: [
      "I can orchestrate your workflow but I do not execute the six business pages directly.",
      `Suggested next step: ${suggestedStep}`,
      "Open that page, complete the action, then return to chat for the next decision.",
    ].join("\n"),
    suggestedStep,
    reason: `Rule-based route selected for step "${suggestedStep}".`,
  }
}

function parseLlmOutput(content: string, fallback: OrchestratorOutput): OrchestratorOutput {
  const parsed = extractJsonObject(content)
  if (!isRecord(parsed)) return fallback

  const suggestedStep = normalizeStep(parsed.suggestedStep, fallback.suggestedStep)
  const reply = String(parsed.reply || "").trim() || fallback.reply
  const reason = String(parsed.reason || "").trim() || fallback.reason
  const profileUpdate = isRecord(parsed.profileUpdate) ? parsed.profileUpdate : undefined
  return {
    reply,
    suggestedStep,
    reason,
    profileUpdate,
  }
}

function normalizeHistory(input: unknown): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ role: "user" | "assistant" | "system"; content: string }> = []
  for (const item of input) {
    if (!isRecord(item)) continue
    const role = String(item.role || "").toLowerCase()
    const content = String(item.content || "").trim()
    if (!content) continue
    if (role !== "user" && role !== "assistant" && role !== "system") continue
    out.push({
      role: role as "user" | "assistant" | "system",
      content: content.slice(0, 1200),
    })
  }
  return out
}

function formatHistoryForPrompt(history: Array<{ role: "user" | "assistant" | "system"; content: string }>): string {
  if (!history.length) return ""
  return history
    .slice(-8)
    .map((item, idx) => `[H${idx + 1}] ${item.role}: ${item.content}`)
    .join("\n")
}

function deriveActionableStep(counters: StepCounters): WorkflowStep {
  if (counters.sourceCount <= 0) return "research"
  if (counters.draftCount <= 0) return "drafts"
  if (counters.variantCount <= 0) return "rewrite"
  if (counters.assetCount <= 0) return "assets"
  if (counters.publishCount <= 0) return "publish"
  return "analytics"
}

function validateStepReadiness(step: WorkflowStep, counters: StepCounters): WorkflowTaskValidation[] {
  switch (step) {
    case "research":
      return [
        {
          key: "research.input",
          passed: true,
          message: "Research can always start from a topic and keyword.",
        },
      ]
    case "drafts":
      return [
        {
          key: "drafts.requires_research_sources",
          passed: counters.sourceCount > 0,
          message: counters.sourceCount > 0 ? "Research sources ready." : "Need at least one research source first.",
        },
      ]
    case "rewrite":
      return [
        {
          key: "rewrite.requires_draft",
          passed: counters.draftCount > 0,
          message: counters.draftCount > 0 ? "Draft is available." : "Generate draft before rewrite.",
        },
      ]
    case "assets":
      return [
        {
          key: "assets.requires_variants",
          passed: counters.variantCount > 0,
          message: counters.variantCount > 0 ? "Variants are available." : "Generate platform variants before assets.",
        },
      ]
    case "publish":
      return [
        {
          key: "publish.requires_assets",
          passed: counters.assetCount > 0,
          message: counters.assetCount > 0 ? "Assets are available." : "Generate at least one asset before publish.",
        },
      ]
    case "analytics":
      return [
        {
          key: "analytics.requires_publish",
          passed: counters.publishCount > 0,
          message: counters.publishCount > 0 ? "Publish records available." : "Need publish records before analytics.",
        },
      ]
  }
}

function verifyStep(
  suggestedStep: WorkflowStep,
  counters: StepCounters
): {
  ok: boolean
  step: WorkflowStep
  reason: string
  validations: WorkflowTaskValidation[]
} {
  const validations = validateStepReadiness(suggestedStep, counters)
  const blocked = validations.find((item) => !item.passed)
  if (!blocked) {
    return {
      ok: true,
      step: suggestedStep,
      reason: "Verifier passed. Ready for next page action.",
      validations,
    }
  }

  const fallbackStep = deriveActionableStep(counters)
  return {
    ok: false,
    step: fallbackStep,
    reason: `Verifier blocked: ${blocked.message} Route changed to "${fallbackStep}".`,
    validations,
  }
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request)

  try {
    const body = await request.json()
    const userMessage = String(body?.userMessage || "").trim()
    const userId = String(body?.userId || "").trim() || "local-user"
    const projectId = String(body?.projectId || "").trim()
    const workflowStep = normalizeStep(body?.workflowStep, "research")
    const projectTitle = String(body?.projectTitle || "").trim()
    const topicKeywords = Array.isArray(body?.topicKeywords)
      ? body.topicKeywords.map((x: unknown) => String(x)).filter(Boolean)
      : []
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const conversationId = String(body?.conversationId || traceId || idempotencyKey || meta.requestId).trim()
    const history = normalizeHistory(body?.history)
    const profileHint = isRecord(body?.profileHint) ? body.profileHint : {}
    const projectContextHint = isRecord(body?.projectContextHint) ? body.projectContextHint : {}
    const performanceSummary = isRecord(body?.performanceSummary) ? body.performanceSummary : null
    const resumeTaskId = String(body?.resumeTaskId || "").trim()
    const workflowTaskId = String(body?.workflowTaskId || `${conversationId}-${Date.now()}`).trim()
    const counters = countersFromHint(projectContextHint)

    if (!userMessage) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "userMessage is required",
          retriable: false,
        },
        400
      )
    }

    ensureChatSession({
      conversationId,
      userId,
      projectId: projectId || undefined,
      history,
    })

    if (resumeTaskId) {
      const resumed = getWorkflowTask(conversationId, resumeTaskId)
      if (resumed && (resumed.status === "running" || resumed.status === "waiting_user")) {
        upsertWorkflowTask(conversationId, {
          taskId: resumed.taskId,
          step: resumed.step,
          phase: "verify",
          status: "succeeded",
          retryCount: resumed.retryCount,
          provider: resumed.provider,
          traceId: resumed.traceId,
          idempotencyKey: resumed.idempotencyKey,
          outputSummary: "Marked as succeeded by explicit resume command.",
        })
      }
    }

    upsertWorkflowTask(conversationId, {
      taskId: workflowTaskId,
      step: workflowStep as WorkflowTaskStep,
      phase: "plan",
      status: "pending",
      retryCount: 0,
      provider: hasChatModelConfig() ? "openai-compatible" : "rule",
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      inputSummary: userMessage.slice(0, 240),
    })

    appendChatTurn(conversationId, {
      role: "user",
      content: userMessage,
    })

    upsertWorkflowTask(conversationId, {
      taskId: workflowTaskId,
      step: workflowStep as WorkflowTaskStep,
      phase: "plan",
      status: "running",
    })

    const memoryEnabled = isLegacyMemoryEnabled()

    const memoryRetrieveStarted = new Date()
    const retrievedMemory = await retrieveLegacyMemory({
      userId,
      projectId,
      query: userMessage,
      performanceLimit: 5,
    })
    appendChatStep(conversationId, {
      name: "memory_retrieve",
      status: "ok",
      startedAt: memoryRetrieveStarted,
      summary: retrievedMemory?.grag_memory
        ? "memory hit"
        : retrievedMemory
          ? "memory empty"
          : "memory unavailable",
    })

    const memoryProfile = {
      ...(isRecord(retrievedMemory?.profile) ? retrievedMemory.profile : {}),
      ...profileHint,
      user_id: userId,
    }
    const memoryProjectContext = {
      ...(isRecord(retrievedMemory?.project_context) ? retrievedMemory.project_context : {}),
      ...projectContextHint,
      ...(projectId ? { project_id: projectId } : {}),
      workflow_step: workflowStep,
      project_title: projectTitle || undefined,
      topic_keywords: topicKeywords,
      trace_id: traceId || undefined,
    }
    const memoryPerformance = Array.isArray(retrievedMemory?.performance)
      ? [...retrievedMemory.performance]
      : []
    if (performanceSummary) {
      memoryPerformance.push(performanceSummary)
    }
    const latestPerformance = memoryPerformance[memoryPerformance.length - 1]

    const fallbackOutput = buildFallbackOutput(userMessage, workflowStep)
    let output = fallbackOutput
    let llmAttempts = 0
    const llmErrors: string[] = []

    const planStarted = new Date()
    const llmStarted = new Date()
    if (hasChatModelConfig()) {
      const historyText = formatHistoryForPrompt(history)
      const prompt = buildChatOrchestratorPrompt({
        userMessage: historyText
          ? `${userMessage}\n\nRecent conversation:\n${historyText}`
          : userMessage,
        workflowStep,
        projectTitle,
        topicKeywords,
        memoryProfile,
        memoryProjectContext,
        memoryPerformance: memoryPerformance.slice(-5),
        memorySnippet:
          typeof retrievedMemory?.grag_memory === "string"
            ? retrievedMemory.grag_memory
            : undefined,
      })

      for (let i = 0; i < 2; i += 1) {
        llmAttempts += 1
        try {
          const content = await createChatCompletion({
            messages: [
              {
                role: "system",
                content:
                  "You are the ContentPilot chat orchestrator. You only provide workflow routing decisions. Output must be valid JSON.",
              },
              { role: "user", content: prompt },
            ],
            responseFormat: { type: "json_object" },
            temperature: 0.3,
            maxTokens: 900,
          })
          output = parseLlmOutput(content, fallbackOutput)
          break
        } catch (error) {
          llmErrors.push(error instanceof Error ? error.message : "llm_failed")
        }
      }

      appendChatStep(conversationId, {
        name: "orchestrate_llm",
        status: llmAttempts > 0 && llmErrors.length < llmAttempts ? "ok" : "error",
        startedAt: llmStarted,
        summary: `attempts=${llmAttempts}, fallback=${llmErrors.length === llmAttempts}`,
        error: llmErrors.length ? llmErrors.join(" | ").slice(0, 1000) : undefined,
      })
    } else {
      appendChatStep(conversationId, {
        name: "orchestrate_llm",
        status: "skipped",
        startedAt: llmStarted,
        summary: "llm_not_configured",
      })
    }

    appendChatStep(conversationId, {
      name: "workflow_plan",
      status: "ok",
      startedAt: planStarted,
      summary: `suggested=${output.suggestedStep}`,
    })

    const executeStarted = new Date()
    upsertWorkflowTask(conversationId, {
      taskId: workflowTaskId,
      step: output.suggestedStep as WorkflowTaskStep,
      phase: "execute",
      status: "running",
      retryCount: Math.max(0, llmAttempts - 1),
      provider: hasChatModelConfig() ? "openai-compatible" : "rule",
    })
    appendChatStep(conversationId, {
      name: "workflow_execute",
      status: "ok",
      startedAt: executeStarted,
      summary: `step=${output.suggestedStep}`,
    })

    const verifyStarted = new Date()
    const verification = verifyStep(output.suggestedStep, counters)
    if (verification.step !== output.suggestedStep) {
      output = {
        ...output,
        suggestedStep: verification.step,
        reason: `${output.reason} ${verification.reason}`.trim(),
      }
    }
    if (!verification.ok) {
      output = {
        ...output,
        reply: `${output.reply}\n\nVerifier blocked this route. ${verification.reason}`,
      }
    }

    const finalStatus = verification.ok ? "waiting_user" : "failed"
    const workflowTask = upsertWorkflowTask(conversationId, {
      taskId: workflowTaskId,
      step: output.suggestedStep as WorkflowTaskStep,
      phase: "verify",
      status: finalStatus,
      retryCount: Math.max(0, llmAttempts - 1),
      provider: hasChatModelConfig() ? "openai-compatible" : "rule",
      outputSummary: `${output.reason} -> ${output.suggestedStep}`,
      lastError: verification.ok ? undefined : verification.reason,
      validations: verification.validations,
    })

    appendChatStep(conversationId, {
      name: "workflow_verify",
      status: verification.ok ? "ok" : "error",
      startedAt: verifyStarted,
      summary: `status=${finalStatus}; step=${output.suggestedStep}`,
      error: verification.ok ? undefined : verification.reason,
    })

    const mergedProfile = output.profileUpdate
      ? { ...memoryProfile, ...output.profileUpdate, user_id: userId }
      : memoryProfile

    const writeStarted = new Date()
    const memoryUpserts: Array<Promise<boolean>> = []
    if (memoryEnabled && userId) {
      memoryUpserts.push(upsertLegacyProfile(userId, mergedProfile))
    }
    if (memoryEnabled && projectId) {
      memoryUpserts.push(upsertLegacyProjectContext(projectId, memoryProjectContext))
      if (isRecord(latestPerformance)) {
        memoryUpserts.push(upsertLegacyPerformanceSummary(projectId, latestPerformance))
      }
    }
    if (memoryEnabled) {
      memoryUpserts.push(ingestLegacyConversation(userMessage, output.reply))
    }
    const writeResults = await Promise.allSettled(memoryUpserts)
    const writeOk = writeResults.every((item) => item.status === "fulfilled")
    appendChatStep(conversationId, {
      name: "memory_write",
      status: writeOk ? "ok" : "error",
      startedAt: writeStarted,
      summary: `ops=${memoryUpserts.length}`,
      error: writeOk ? undefined : "some memory writes failed",
    })

    appendChatTurn(conversationId, {
      role: "assistant",
      content: output.reply,
    })
    updateChatSessionMeta(conversationId, {
      lastSuggestedStep: output.suggestedStep,
      lastReason: output.reason,
      usedGragMemory: Boolean(retrievedMemory?.grag_memory),
      memorySnippet:
        typeof retrievedMemory?.grag_memory === "string"
          ? retrievedMemory.grag_memory.slice(0, 500)
          : undefined,
      lastWorkflowTaskId: workflowTask?.taskId || workflowTaskId,
      lastWorkflowTaskStatus: finalStatus,
    })

    return meta.ok({
      conversationId,
      workflowTaskId,
      workflowTask,
      reply: output.reply,
      suggestedStep: output.suggestedStep,
      reason: output.reason,
      nextPath: stepToPath[output.suggestedStep],
      verifier: {
        ok: verification.ok,
        validations: verification.validations,
      },
      memory: {
        enabled: memoryEnabled,
        snippet: retrievedMemory?.grag_memory || null,
        profile: mergedProfile,
        projectContext: memoryProjectContext,
        latestPerformance: isRecord(latestPerformance) ? latestPerformance : null,
      },
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      llm: {
        attempts: llmAttempts,
        fallbackUsed: llmAttempts > 0 && llmAttempts === llmErrors.length,
        errors: llmErrors,
      },
    })
  } catch (error) {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "chat orchestration request failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}

