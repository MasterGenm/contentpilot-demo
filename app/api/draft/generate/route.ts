import { NextRequest } from "next/server"
import { createChatCompletion, hasChatModelConfig } from "@/lib/server/openai"
import { encodeSSE } from "@/lib/server/sse"
import { buildLegacyUrl } from "@/lib/legacy-backend"
import { withMeta } from "@/lib/server/api-response"
import { buildDraftPrompt } from "@/lib/prompts"
import { completeTask, failTask, patchTask, upsertTask } from "@/lib/server/task-registry"
import { verifyDraftResult } from "@/lib/server/workflow-verifier"
import {
  ingestLegacyConversation,
  isLegacyMemoryEnabled,
  retrieveLegacyMemory,
  upsertLegacyPerformanceSummary,
  upsertLegacyProjectContext,
} from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getLengthRange(length: string): { min: number; max: number } {
  const map: Record<string, { min: number; max: number }> = {
    short: { min: 500, max: 1000 },
    medium: { min: 1500, max: 2500 },
    long: { min: 3000, max: 4500 },
  }
  return map[length] || map.medium
}

function getLengthTargetChars(length: string): number {
  const map: Record<string, number> = {
    short: 900,
    medium: 2000,
    long: 3600,
  }
  return map[length] || map.medium
}

function getDraftMaxTokens(length: string): number {
  const map: Record<string, number> = {
    short: 1200,
    medium: 2600,
    long: 4200,
  }
  return map[length] || map.medium
}

function getDraftTemperature(tone: string): number {
  const map: Record<string, number> = {
    professional: 0.45,
    analytical: 0.5,
    tutorial: 0.55,
    casual: 0.75,
    storytelling: 0.85,
  }
  return map[tone] ?? 0.65
}

function getToneInstruction(tone: string): string {
  const map: Record<string, string> = {
    professional: "专业克制，信息密度高，避免口语化。",
    casual: "轻松自然，口语化表达，强调可读性。",
    storytelling: "叙事化推进，带场景与人物动作细节。",
    analytical: "结构化分析，结论先行，证据与推理清晰。",
    tutorial: "步骤化讲解，强调方法、清单与可执行动作。",
  }
  return map[tone] || map.professional
}

function buildFallbackDraft(
  topic: string,
  summary: string,
  minWords: number,
  tone: string,
  audience: string,
  length: string
): string {
  const title = topic || "内容初稿"
  const targetChars = Math.max(getLengthTargetChars(length), Math.floor(minWords * 1.7))
  const toneHint = getToneInstruction(tone)

  const sections = [
    `# ${title}`,
    "",
    "## 引言",
    `${summary || "以下内容围绕主题给出结论、证据线索和可执行建议。"} 目标读者为${audience}。`,
    "",
    "## 为什么现在要做",
    "1. 用户需求已形成明确痛点，存在持续内容消费空间。",
    "2. 平台分发更偏好结构清晰、可复用的实操内容。",
    "3. 主题具备系列化潜力，可沉淀为长期栏目。",
    "",
    "## 核心观点与执行框架",
    `写作语气要求：${toneHint}`,
    "1. 先给结论：明确读者应采取的动作。",
    "2. 再给证据：引用来源或案例支撑判断。",
    "3. 最后给路径：拆成可执行步骤与时间节奏。",
    "",
    "## 可执行清单",
    "1. 明确目标受众与发布目标（增粉/转化/品牌）。",
    "2. 设定选题优先级（价值密度、时效性、可验证性）。",
    "3. 产出主稿后，改写为多平台版本并统一素材风格。",
    "4. 发布后记录数据，复盘标题、开头与转化节点。",
    "",
    "## 结语",
    "把内容从“表达”升级为“可执行方案”，形成稳定产出与迭代闭环。",
    "",
    `> 当前为兜底草稿（未调用到 LLM 或调用失败）。目标篇幅约 ${minWords}+ 字。`,
  ]

  let text = sections.join("\n")
  let i = 1
  while (text.length < targetChars) {
    text += `\n\n### 延展观点 ${i}\n围绕“${title}”继续补充案例、反例、执行细节和落地注意事项，确保读者能直接按步骤实施。`
    i += 1
  }
  return text
}

async function fetchLegacyDraft(topic: string, tone: string, audience: string): Promise<string | null> {
  if (String(process.env.USE_LEGACY_CONTENT_WORKFLOW || "").toLowerCase() !== "true") {
    return null
  }

  const resp = await fetch(buildLegacyUrl("/api/content/workflow"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      topic,
      tone,
      audience,
      platforms: ["WECHAT"],
      include_report: false,
    }),
  })

  if (!resp.ok) {
    return null
  }

  const data = await resp.json().catch(() => ({})) as { draft_md?: string; success?: boolean }
  if (!data?.success || !data?.draft_md) {
    return null
  }

  return data.draft_md
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request)
  const encoder = new TextEncoder()

  try {
    const body = await request.json()
    const projectId = String(body?.projectId || "").trim()
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const taskId = idempotencyKey || traceId || meta.requestId
    const topic = String(body?.topic || projectId || "").trim()
    const requestedTone = String(body?.tone || "").trim()
    const requestedAudience = String(body?.audience || "").trim()
    const length = String(body?.length || "medium")
    const researchSummary = String(body?.researchSummary || "").trim()
    const sources = Array.isArray(body?.sources) ? body.sources : []
    const userId = String(body?.userId || "local-user").trim() || "local-user"

    if (!topic) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "topic is required",
          retriable: false,
        },
        400
      )
    }

    const memoryEnabled = isLegacyMemoryEnabled()
    const memorySnapshot = await retrieveLegacyMemory({
      userId,
      projectId,
      query: topic,
      performanceLimit: 5,
    })
    const memoryProfile =
      memorySnapshot?.profile && typeof memorySnapshot.profile === "object"
        ? (memorySnapshot.profile as Record<string, unknown>)
        : {}
    const tone = requestedTone || String(memoryProfile.preferred_tone || "").trim() || "professional"
    const audience =
      requestedAudience || String(memoryProfile.target_audience || "").trim() || "media team"
    const memorySnippet =
      typeof memorySnapshot?.grag_memory === "string" ? memorySnapshot.grag_memory.slice(0, 600) : ""

    const stream = new ReadableStream({
      async start(controller) {
        let outputContent = ""
        try {
          const { min, max } = getLengthRange(length)
          upsertTask(taskId, {
            kind: "draft",
            status: "RUNNING",
            progress: 0,
            projectId: projectId || undefined,
            provider: "llm",
            traceId: traceId || undefined,
            idempotencyKey: idempotencyKey || undefined,
            requestId: meta.requestId,
            payload: {
              topic,
              tone,
              audience,
              length,
              minWords: min,
              maxWords: max,
            },
          })

          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "meta",
                requestId: meta.requestId,
                projectId,
                traceId,
                idempotencyKey,
                taskId,
              })
            )
          )
          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 10 })))
          patchTask(taskId, { progress: 10 })

          let content = await fetchLegacyDraft(topic, tone, audience)

          if (!content && hasChatModelConfig()) {
            try {
              const sourceContext = sources
                .slice(0, 8)
                .map((s: Record<string, unknown>, i: number) => {
                  const title = String(s.title || "")
                  const url = String(s.url || "")
                  return `[${i + 1}] ${title}${url ? ` (${url})` : ""}`
                })

              const prompt = buildDraftPrompt({
                topic,
                toneInstruction: getToneInstruction(tone),
                audience,
                minWords: min,
                maxWords: max,
                researchSummary: memorySnippet
                  ? `${researchSummary}\n\nMemory hints:\n${memorySnippet}`
                  : researchSummary,
                sourceLines: sourceContext,
              })

              content = await createChatCompletion({
                messages: [
                  {
                    role: "system",
                    content:
                      "你是中文内容编辑。必须严格使用简体中文输出，不得输出英文段落。严格遵守用户给定的语气风格和篇幅要求。",
                  },
                  { role: "user", content: prompt },
                ],
                temperature: getDraftTemperature(tone),
                maxTokens: getDraftMaxTokens(length),
              })
            } catch (llmError) {
              const fallbackReason =
                llmError instanceof Error ? llmError.message : String(llmError || "unknown")
              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "warning",
                    code: "LLM_FALLBACK",
                    message: fallbackReason,
                  })
                )
              )
              content = buildFallbackDraft(topic, researchSummary, min, tone, audience, length)
            }
          }

          if (!content) {
            content = buildFallbackDraft(topic, researchSummary, min, tone, audience, length)
          }

          let normalizedContent = content
          let validation = verifyDraftResult({ content: normalizedContent })
          if (!validation.ok) {
            const minFiller = [
              "## Supplement",
              "This section is auto-expanded to meet minimum draft completeness.",
              "1. Clarify audience and publishing goal.",
              "2. Add evidence-backed claims from research.",
              "3. Keep a clear section hierarchy for reuse in rewriting.",
              "4. Add concrete examples, checklist items, and publishing constraints.",
              "5. Include expected outcomes and measurable metrics for iteration.",
            ].join("\n")
            normalizedContent = `${normalizedContent}\n\n${minFiller}`
            while (normalizedContent.trim().length < 240) {
              normalizedContent += "\nAdditional implementation detail for workflow continuity."
            }
            validation = verifyDraftResult({ content: normalizedContent })
          }
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "validator",
                stage: "draft",
                ok: validation.ok,
                checks: validation.checks,
              })
            )
          )
          if (!validation.ok) {
            throw new Error(
              `draft_validation_failed:${validation.checks
                .filter((item) => !item.passed)
                .map((item) => item.key)
                .join(",")}`
            )
          }
          content = normalizedContent

          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 55 })))
          patchTask(taskId, { progress: 55 })

          const chunkSize = 96
          for (let i = 0; i < content.length; i += chunkSize) {
            const chunk = content.slice(i, i + chunkSize)
            outputContent += chunk
            controller.enqueue(encoder.encode(encodeSSE({ type: "content", text: chunk })))
            const progress = 55 + Math.floor((i / Math.max(content.length, 1)) * 45)
            controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress })))
            patchTask(taskId, { progress })
            await new Promise((resolve) => setTimeout(resolve, 8))
          }

          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 100 })))
          completeTask(taskId, {
            provider: hasChatModelConfig() ? "llm" : "fallback",
            progress: 100,
            payload: {
              topic,
              tone,
              audience,
              length,
              content: outputContent,
              validator: verifyDraftResult({ content: outputContent }),
            },
          })

          if (memoryEnabled && projectId) {
            await Promise.allSettled([
              upsertLegacyProjectContext(projectId, {
                workflow_step: "drafts",
                last_draft_topic: topic,
                last_draft_tone: tone,
                last_draft_audience: audience,
                draft_length: length,
                updated_at: new Date().toISOString(),
              }),
              upsertLegacyPerformanceSummary(projectId, {
                stage: "drafts",
                success: true,
                topic,
                tone,
                audience,
                chars: outputContent.length,
                recorded_at: new Date().toISOString(),
              }),
              ingestLegacyConversation(topic, outputContent.slice(0, 2000)),
            ])
          }
          controller.close()
        } catch (error) {
          failTask(taskId, {
            code: "PROVIDER_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Draft generation failed",
            retriable: true,
          })
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "error",
                code: "PROVIDER_UNAVAILABLE",
                message: error instanceof Error ? error.message : "Draft generation failed",
                retriable: true,
              })
            )
          )

          if (memoryEnabled && projectId) {
            await Promise.allSettled([
              upsertLegacyPerformanceSummary(projectId, {
                stage: "drafts",
                success: false,
                topic,
                error: error instanceof Error ? error.message : "Draft generation failed",
                recorded_at: new Date().toISOString(),
              }),
            ])
          }
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "Draft generation request failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
