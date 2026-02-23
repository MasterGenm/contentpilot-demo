import { buildLegacyUrl } from "@/lib/legacy-backend"

export type WorkflowStep = "research" | "drafts" | "rewrite" | "assets" | "publish" | "analytics"

export interface MemoryProfile {
  user_id?: string
  [key: string]: unknown
}

export interface ProjectContext {
  project_id?: string
  [key: string]: unknown
}

export interface PerformanceSummary {
  project_id?: string
  recorded_at?: string
  [key: string]: unknown
}

export interface RetrievedMemory {
  success: boolean
  user_id?: string
  project_id?: string
  profile?: MemoryProfile
  project_context?: ProjectContext
  performance?: PerformanceSummary[]
  grag_memory?: string | null
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

function normalizeEnabled(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  return !(v === "0" || v === "false" || v === "off" || v === "disabled")
}

export function isLegacyMemoryEnabled(): boolean {
  return normalizeEnabled(String(process.env.USE_LEGACY_CHAT_MEMORY || "true"))
}

async function callLegacyMemory<T = Record<string, unknown>>(
  path: string,
  payload?: Record<string, unknown>,
  timeoutMs = 4000
): Promise<T | null> {
  if (!isLegacyMemoryEnabled()) return null
  try {
    const response = await fetch(buildLegacyUrl(path), {
      method: payload ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      signal: withTimeoutSignal(timeoutMs),
    })
    const data = (await response.json().catch(() => null)) as T | null
    if (!response.ok || !data) return null
    return data
  } catch {
    return null
  }
}

export async function getLegacyMemoryStatus(): Promise<Record<string, unknown> | null> {
  return callLegacyMemory<Record<string, unknown>>("/api/memory/status", undefined, 3500)
}

export async function retrieveLegacyMemory(input: {
  userId?: string
  projectId?: string
  query?: string
  performanceLimit?: number
}): Promise<RetrievedMemory | null> {
  return callLegacyMemory<RetrievedMemory>(
    "/api/memory/retrieve",
    {
      user_id: input.userId || "",
      project_id: input.projectId || "",
      query: input.query || "",
      performance_limit: input.performanceLimit ?? 5,
    },
    5500
  )
}

export async function upsertLegacyProfile(userId: string, profile: Record<string, unknown>): Promise<boolean> {
  if (!userId) return false
  const result = await callLegacyMemory<Record<string, unknown>>(
    "/api/memory/upsert-profile",
    { user_id: userId, profile },
    3500
  )
  return Boolean(result && result.success)
}

export async function upsertLegacyProjectContext(
  projectId: string,
  context: Record<string, unknown>
): Promise<boolean> {
  if (!projectId) return false
  const result = await callLegacyMemory<Record<string, unknown>>(
    "/api/memory/upsert-project-context",
    { project_id: projectId, context },
    3500
  )
  return Boolean(result && result.success)
}

export async function upsertLegacyPerformanceSummary(
  projectId: string,
  summary: Record<string, unknown>
): Promise<boolean> {
  if (!projectId) return false
  const result = await callLegacyMemory<Record<string, unknown>>(
    "/api/memory/upsert-performance-summary",
    { project_id: projectId, summary },
    3500
  )
  return Boolean(result && result.success)
}

export async function ingestLegacyConversation(userInput: string, aiResponse: string): Promise<boolean> {
  if (!userInput || !aiResponse) return false
  const result = await callLegacyMemory<Record<string, unknown>>(
    "/api/memory/ingest-conversation",
    { user_input: userInput, ai_response: aiResponse },
    4500
  )
  return Boolean(result && result.success)
}
