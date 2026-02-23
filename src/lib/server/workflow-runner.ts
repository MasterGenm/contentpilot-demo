import { getTask } from "@/lib/server/task-registry"
import {
  verifyAssetResult,
  verifyDraftResult,
  verifyPublishResult,
  verifyResearchResult,
  verifyRewriteResult,
  type WorkflowValidationResult,
} from "@/lib/server/workflow-verifier"

export type WorkflowStepKey =
  | "research"
  | "draft"
  | "rewrite"
  | "assets"
  | "publish"
  | "analytics"

export type WorkflowStepStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED"

export interface WorkflowStepLog {
  step: WorkflowStepKey
  status: WorkflowStepStatus
  retryCount: number
  startedAt?: string
  endedAt?: string
  durationMs?: number
  provider?: string
  errorCode?: string
  errorMessage?: string
  validation?: WorkflowValidationResult
}

export interface WorkflowBundle {
  projectId: string
  topic: string
  researchTool?: "WEB_SEARCH" | "NEWS_SEARCH"
  timeWindow: string
  tone: string
  audience: string
  length: "short" | "medium" | "long"
  platforms: string[]
  research?: {
    provider: string
    sources: Array<{
      title: string
      url: string
      snippet?: string
      publishedAt?: string
      publisher?: string
      score?: number
    }>
    insight: {
      summary: string
      risks: string[]
      angles: string[]
      recommendedTitles: string[]
    }
    attempts?: Array<Record<string, unknown>>
  }
  draft?: {
    content: string
    warnings: string[]
  }
  rewrite?: {
    variants: Record<
      string,
      {
        titleCandidates: string[]
        body: string
        hashtags: string[]
      }
    >
    errors: Array<{ platform: string; message: string }>
  }
  assets?: {
    imageUrl: string
    provider: string
    note?: string
  }
  publish?: {
    mode?: string
    postId?: string | number
    editUrl?: string
    status?: string
    message?: string
  }
  analytics?: Record<string, unknown>
  finalOutput?: {
    summary: string
    titleCandidates: string[]
    platformCount: number
    hasAsset: boolean
    publishStatus: string
  }
}

export interface WorkflowRunOptions {
  origin: string
  projectId: string
  topic: string
  researchTool?: "WEB_SEARCH" | "NEWS_SEARCH"
  timeWindow?: string
  tone?: string
  audience?: string
  length?: "short" | "medium" | "long"
  platforms?: string[]
  generateAsset?: boolean
  publishToWordpress?: boolean
  traceId?: string
  idempotencyKey?: string
  resumeTaskId?: string
}

export interface WorkflowRunResult {
  taskId: string
  status: "COMPLETED" | "FAILED"
  failedStep?: WorkflowStepKey
  recoverable: boolean
  steps: WorkflowStepLog[]
  bundle: WorkflowBundle
}

const STEP_ORDER: WorkflowStepKey[] = ["research", "draft", "rewrite", "assets", "publish", "analytics"]
const DEFAULT_PLATFORMS = ["WECHAT", "XIAOHONGSHU", "WEIBO", "BILIBILI"]

function nowIso(): string {
  return new Date().toISOString()
}

function safeJsonParse(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
    return null
  } catch {
    return null
  }
}

function createRequestId(prefix = "wf"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeOrigin(origin: string): string {
  return String(origin || "").replace(/\/+$/, "")
}

function parseSseLines(raw: string): Array<Record<string, any>> {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const events: Array<Record<string, any>> = []
  for (const line of lines) {
    const parsed = safeJsonParse(line)
    if (parsed) events.push(parsed)
  }
  return events
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

function extractApiError(detail: string): { code: string; message: string } {
  const parsed = safeJsonParse(detail)
  const code = String(parsed?.error?.code || "PROVIDER_UNAVAILABLE")
  const message = String(parsed?.error?.message || detail || "request failed")
  return { code, message }
}

function buildDraftInput(bundle: WorkflowBundle): Record<string, unknown> {
  return {
    projectId: bundle.projectId,
    topic: bundle.topic,
    tone: bundle.tone,
    audience: bundle.audience,
    length: bundle.length,
    researchSummary: bundle.research?.insight.summary || "",
    sources: bundle.research?.sources || [],
  }
}

function buildRewriteInput(bundle: WorkflowBundle, taskId: string): Record<string, unknown> {
  return {
    projectId: bundle.projectId,
    topic: bundle.topic,
    draftId: `draft-${taskId}`,
    draftContent: bundle.draft?.content || "",
    platforms: bundle.platforms,
  }
}

function buildAssetInput(bundle: WorkflowBundle): Record<string, unknown> {
  const firstVariant = Object.values(bundle.rewrite?.variants || {})[0]
  const baseText = firstVariant?.body || bundle.draft?.content || bundle.topic
  const prompt = [
    "Create an editorial cover image for the following content.",
    "Topic: " + bundle.topic,
    "Context: " + baseText.slice(0, 300),
    "Style: modern, clean, high-contrast, suitable for media publishing.",
  ].join("\n")
  return {
    projectId: bundle.projectId,
    prompt,
  }
}
function buildPublishInput(bundle: WorkflowBundle, taskId: string): Record<string, unknown> {
  const preferred =
    bundle.rewrite?.variants.WECHAT ||
    Object.values(bundle.rewrite?.variants || {})[0] || { titleCandidates: [bundle.topic], body: "" }
  return {
    projectId: bundle.projectId,
    variantId: `variant-${taskId}`,
    title: preferred.titleCandidates?.[0] || bundle.topic,
    content: preferred.body || "",
    excerpt: bundle.research?.insight.summary || "",
  }
}

function buildAnalyticsQuery(bundle: WorkflowBundle): string {
  const params = new URLSearchParams({
    window: "7d",
    projectsCount: "1",
    draftsCount: bundle.draft?.content ? "1" : "0",
    publishTotal: bundle.publish?.status ? "1" : "0",
    publishSuccess: bundle.publish?.status ? "1" : "0",
    avgCycleMinutes: "8",
  })
  return params.toString()
}

function aggregateFinalOutput(bundle: WorkflowBundle): WorkflowBundle["finalOutput"] {
  return {
    summary: bundle.research?.insight.summary || bundle.topic,
    titleCandidates: bundle.research?.insight.recommendedTitles || [],
    platformCount: Object.keys(bundle.rewrite?.variants || {}).length,
    hasAsset: Boolean(bundle.assets?.imageUrl),
    publishStatus: bundle.publish?.status || "not_published",
  }
}

function initSteps(from?: WorkflowStepLog[]): WorkflowStepLog[] {
  const base = STEP_ORDER.map((step) => ({
    step,
    status: "PENDING" as WorkflowStepStatus,
    retryCount: 0,
  }))
  if (!from?.length) return base

  const map = new Map(from.map((item) => [item.step, item]))
  return base.map((item) => map.get(item.step) || item)
}

function findResumeIndex(steps: WorkflowStepLog[]): number {
  const failed = steps.findIndex((step) => step.status === "FAILED")
  if (failed >= 0) return failed
  const pending = steps.findIndex((step) => step.status === "PENDING" || step.status === "RUNNING")
  if (pending >= 0) return pending
  return 0
}

async function runResearch(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  const url = `${normalizeOrigin(options.origin)}/api/research/start`
  const traceId = options.traceId || createRequestId("trace")
  const idempotencyKey = `${options.idempotencyKey || createRequestId("idem")}-research`

  const researchTool = options.researchTool || bundle.researchTool || "WEB_SEARCH"

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        projectId: bundle.projectId,
        query: bundle.topic,
        timeWindow: bundle.timeWindow,
        tool: researchTool,
        traceId,
        idempotencyKey,
      }),
    },
    180000
  )

  const raw = await response.text()
  if (!response.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const events = parseSseLines(raw)
  const sources: Array<{
    title: string
    url: string
    snippet?: string
    publishedAt?: string
    publisher?: string
    score?: number
  }> = []
  let provider = "unknown"
  let insight: {
    summary: string
    risks: string[]
    angles: string[]
    recommendedTitles: string[]
  } = {
    summary: "",
    risks: [],
    angles: [],
    recommendedTitles: [],
  }
  let attempts: Array<Record<string, unknown>> = []

  for (const evt of events) {
    if (evt.type === "source") {
      sources.push({
        title: String(evt.title || ""),
        url: String(evt.url || ""),
        snippet: evt.snippet ? String(evt.snippet) : undefined,
        publishedAt: evt.publishedAt ? String(evt.publishedAt) : undefined,
        publisher: evt.publisher ? String(evt.publisher) : undefined,
        score: typeof evt.credibilityScore === "number" ? evt.credibilityScore : undefined,
      })
    }
    if (evt.type === "provider") {
      provider = String(evt.provider || provider)
      if (Array.isArray(evt.attempts)) {
        attempts = evt.attempts
      }
    }
    if (evt.type === "insight") {
      insight = {
        summary: String(evt.summary || ""),
        risks: Array.isArray(evt.risks) ? evt.risks.map((x: unknown) => String(x)) : [],
        angles: Array.isArray(evt.angles) ? evt.angles.map((x: unknown) => String(x)) : [],
        recommendedTitles: Array.isArray(evt.recommendedTitles)
          ? evt.recommendedTitles.map((x: unknown) => String(x))
          : [],
      }
    }
    if (evt.type === "error") {
      throw new Error(`${String(evt.code || "PROVIDER_UNAVAILABLE")}:${String(evt.message || "research failed")}`)
    }
  }

  const validation = verifyResearchResult({
    sources: sources.map((item) => ({ title: item.title, url: item.url })),
    insight,
  })
  if (!validation.ok) {
    throw new Error("VALIDATION_ERROR:research result incomplete")
  }

  bundle.research = {
    provider,
    sources,
    insight,
    attempts,
  }

  return { provider, validation }
}

async function runDraft(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  const url = `${normalizeOrigin(options.origin)}/api/draft/generate`
  const traceId = options.traceId || createRequestId("trace")
  const idempotencyKey = `${options.idempotencyKey || createRequestId("idem")}-draft`
  const payload = buildDraftInput(bundle)
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        ...payload,
        traceId,
        idempotencyKey,
      }),
    },
    180000
  )
  const raw = await response.text()
  if (!response.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const events = parseSseLines(raw)
  let content = ""
  const warnings: string[] = []
  for (const evt of events) {
    if (evt.type === "content") {
      content += String(evt.text || "")
    }
    if (evt.type === "warning") {
      warnings.push(String(evt.message || evt.code || "warning"))
    }
    if (evt.type === "error") {
      throw new Error(`${String(evt.code || "PROVIDER_UNAVAILABLE")}:${String(evt.message || "draft failed")}`)
    }
  }

  const validation = verifyDraftResult({ content })
  if (!validation.ok) {
    throw new Error("VALIDATION_ERROR:draft result incomplete")
  }

  bundle.draft = { content, warnings }
  return { provider: warnings.length > 0 ? "fallback" : "llm", validation }
}

async function runRewrite(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle,
  taskId: string
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  const url = `${normalizeOrigin(options.origin)}/api/rewrite/generate`
  const traceId = options.traceId || createRequestId("trace")
  const idempotencyKey = `${options.idempotencyKey || createRequestId("idem")}-rewrite`
  const payload = buildRewriteInput(bundle, taskId)

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        ...payload,
        traceId,
        idempotencyKey,
      }),
    },
    180000
  )

  const raw = await response.text()
  if (!response.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const events = parseSseLines(raw)
  const variants: Record<string, { titleCandidates: string[]; body: string; hashtags: string[] }> = {}
  const errors: Array<{ platform: string; message: string }> = []

  for (const evt of events) {
    if (evt.type === "variant") {
      const platform = String(evt.platform || "")
      if (!platform) continue
      variants[platform] = {
        titleCandidates: Array.isArray(evt.titleCandidates)
          ? evt.titleCandidates.map((item: unknown) => String(item))
          : [],
        body: String(evt.body || ""),
        hashtags: Array.isArray(evt.hashtags) ? evt.hashtags.map((item: unknown) => String(item)) : [],
      }
    }
    if (evt.type === "error") {
      errors.push({
        platform: String(evt.platform || "unknown"),
        message: String(evt.message || "rewrite failed"),
      })
    }
  }

  const validation = verifyRewriteResult({
    variants,
    requiredPlatforms: bundle.platforms,
  })
  if (!validation.ok) {
    throw new Error("VALIDATION_ERROR:rewrite result incomplete")
  }

  bundle.rewrite = { variants, errors }
  return { provider: "llm", validation }
}

async function runAssets(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  if (!options.generateAsset) {
    const skipped = verifyAssetResult({
      imageUrl: "skipped://asset",
      provider: "skipped",
    })
    bundle.assets = {
      imageUrl: "",
      provider: "skipped",
      note: "asset step skipped by workflow option",
    }
    return { provider: "skipped", validation: skipped }
  }

  const url = `${normalizeOrigin(options.origin)}/api/assets/generate-image`
  const traceId = options.traceId || createRequestId("trace")
  const idempotencyKey = `${options.idempotencyKey || createRequestId("idem")}-assets`

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        ...buildAssetInput(bundle),
        traceId,
        idempotencyKey,
      }),
    },
    120000
  )

  const raw = await response.text()
  const parsed = safeJsonParse(raw)
  if (!response.ok || !parsed?.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const data = parsed.data || {}
  const validation = verifyAssetResult({
    imageUrl: String(data.imageUrl || ""),
    provider: String(data.provider || ""),
  })
  if (!validation.ok) {
    throw new Error("VALIDATION_ERROR:asset result incomplete")
  }

  bundle.assets = {
    imageUrl: String(data.imageUrl || ""),
    provider: String(data.provider || ""),
    note: data.note ? String(data.note) : undefined,
  }
  return { provider: String(data.provider || "image-api"), validation }
}

async function runPublish(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle,
  taskId: string
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  if (!options.publishToWordpress) {
    const skipped = verifyPublishResult({
      postId: "skipped",
      editUrl: "skipped://publish",
      status: "skipped",
    })
    bundle.publish = {
      mode: "skipped",
      status: "skipped",
      message: "publish step skipped by workflow option",
    }
    return { provider: "skipped", validation: skipped }
  }

  const url = `${normalizeOrigin(options.origin)}/api/publish/wordpress-draft`
  const traceId = options.traceId || createRequestId("trace")
  const idempotencyKey = `${options.idempotencyKey || createRequestId("idem")}-publish`
  const publishInput = buildPublishInput(bundle, taskId)

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        ...publishInput,
        traceId,
        idempotencyKey,
      }),
    },
    120000
  )

  const raw = await response.text()
  const parsed = safeJsonParse(raw)
  if (!response.ok || !parsed?.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const data = parsed.data || {}
  const validation = verifyPublishResult({
    postId: data.postId,
    editUrl: data.editUrl,
    status: data.status,
  })
  if (!validation.ok) {
    throw new Error("VALIDATION_ERROR:publish result incomplete")
  }

  bundle.publish = {
    mode: data.mode ? String(data.mode) : undefined,
    postId: data.postId,
    editUrl: data.editUrl ? String(data.editUrl) : undefined,
    status: data.status ? String(data.status) : undefined,
    message: data.message ? String(data.message) : undefined,
  }
  return { provider: data.mode === "mock" ? "wordpress-mock" : "wordpress-live", validation }
}

async function runAnalytics(
  options: WorkflowRunOptions,
  bundle: WorkflowBundle
): Promise<{ provider: string; validation: WorkflowValidationResult }> {
  const query = buildAnalyticsQuery(bundle)
  const url = `${normalizeOrigin(options.origin)}/api/analytics/summary?${query}`
  const response = await fetchWithTimeout(url, { method: "GET" }, 30000)
  const raw = await response.text()
  const parsed = safeJsonParse(raw)
  if (!response.ok || !parsed?.ok) {
    const err = extractApiError(raw)
    throw new Error(`${err.code}:${err.message}`)
  }

  const data = parsed.data || {}
  bundle.analytics = data
  const validation: WorkflowValidationResult = {
    ok: true,
    checks: [
      {
        key: "analytics.summary.exists",
        passed: true,
        message: "Analytics summary generated.",
      },
    ],
  }
  return { provider: "local-summary", validation }
}

export function buildWorkflowFromTask(taskId: string): {
  bundle: WorkflowBundle
  steps: WorkflowStepLog[]
} | null {
  const task = getTask(taskId)
  if (!task || task.kind !== "workflow") return null

  const payload = task.payload && typeof task.payload === "object" ? task.payload : {}
  const rawBundle = payload.bundle
  const rawSteps = payload.steps

  if (!rawBundle || typeof rawBundle !== "object") return null

  return {
    bundle: rawBundle as WorkflowBundle,
    steps: initSteps(Array.isArray(rawSteps) ? (rawSteps as WorkflowStepLog[]) : []),
  }
}

export async function executeWorkflowRun(options: WorkflowRunOptions): Promise<WorkflowRunResult> {
  const taskId = options.resumeTaskId || options.idempotencyKey || createRequestId("workflow")
  const persisted = options.resumeTaskId ? buildWorkflowFromTask(options.resumeTaskId) : null

  const baseBundle: WorkflowBundle =
    persisted?.bundle || {
      projectId: options.projectId,
      topic: options.topic,
      researchTool: options.researchTool || "WEB_SEARCH",
      timeWindow: options.timeWindow || "7d",
      tone: options.tone || "professional",
      audience: options.audience || "创作者",
      length: options.length || "medium",
      platforms: options.platforms?.length ? options.platforms : DEFAULT_PLATFORMS,
    }
  const bundle: WorkflowBundle = {
    ...baseBundle,
    projectId: options.projectId || baseBundle.projectId,
    topic: options.topic || baseBundle.topic,
    researchTool: options.researchTool || baseBundle.researchTool || "WEB_SEARCH",
    timeWindow: options.timeWindow || baseBundle.timeWindow,
    tone: options.tone || baseBundle.tone,
    audience: options.audience || baseBundle.audience,
    length: options.length || baseBundle.length,
    platforms: options.platforms?.length ? options.platforms : baseBundle.platforms,
  }

  const steps = initSteps(persisted?.steps)
  let resumeIndex = 0
  if (persisted) {
    resumeIndex = findResumeIndex(steps)
  }

  for (let index = 0; index < STEP_ORDER.length; index += 1) {
    const stepKey = STEP_ORDER[index]
    const stepState = steps[index]
    if (index < resumeIndex && stepState.status === "COMPLETED") {
      continue
    }

    const startedAt = new Date()
    stepState.status = "RUNNING"
    stepState.startedAt = startedAt.toISOString()
    stepState.endedAt = undefined
    stepState.durationMs = undefined
    stepState.errorCode = undefined
    stepState.errorMessage = undefined

    try {
      let provider = "workflow"
      let validation: WorkflowValidationResult = {
        ok: true,
        checks: [],
      }

      if (stepKey === "research") {
        const run = await runResearch(options, bundle)
        provider = run.provider
        validation = run.validation
      } else if (stepKey === "draft") {
        const run = await runDraft(options, bundle)
        provider = run.provider
        validation = run.validation
      } else if (stepKey === "rewrite") {
        const run = await runRewrite(options, bundle, taskId)
        provider = run.provider
        validation = run.validation
      } else if (stepKey === "assets") {
        const run = await runAssets(options, bundle)
        provider = run.provider
        validation = run.validation
      } else if (stepKey === "publish") {
        const run = await runPublish(options, bundle, taskId)
        provider = run.provider
        validation = run.validation
      } else if (stepKey === "analytics") {
        const run = await runAnalytics(options, bundle)
        provider = run.provider
        validation = run.validation
      }

      stepState.status = "COMPLETED"
      stepState.provider = provider
      stepState.validation = validation
      const endedAt = new Date()
      stepState.endedAt = endedAt.toISOString()
      stepState.durationMs = endedAt.getTime() - startedAt.getTime()

    } catch (error) {
      const message = error instanceof Error ? error.message : "workflow step failed"
      const [code, ...rest] = message.split(":")
      stepState.status = "FAILED"
      stepState.errorCode = code || "UNKNOWN_ERROR"
      stepState.errorMessage = rest.join(":") || message
      const endedAt = new Date()
      stepState.endedAt = endedAt.toISOString()
      stepState.durationMs = endedAt.getTime() - startedAt.getTime()
      return {
        taskId,
        status: "FAILED",
        failedStep: stepKey,
        recoverable: true,
        steps,
        bundle: {
          ...bundle,
          finalOutput: aggregateFinalOutput(bundle),
        },
      }
    }
  }

  bundle.finalOutput = aggregateFinalOutput(bundle)
  return {
    taskId,
    status: "COMPLETED",
    recoverable: false,
    steps,
    bundle,
  }
}

