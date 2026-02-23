import { buildLegacyUrl } from "@/lib/legacy-backend"

export type LegacyResearchErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR"

export interface LegacyResearchSource {
  url: string
  title: string
  publisher?: string
  snippet?: string
  publishedAt?: string
  credibilityScore: number
}

export interface LegacyResearchInsight {
  summary: string
  risks: string[]
  angles: string[]
  recommendedTitles: string[]
}

export interface LegacyResearchResult {
  provider: "legacy-queryengine"
  sources: LegacyResearchSource[]
  insight: LegacyResearchInsight
}

interface LegacyResearchApiResponse {
  success?: boolean
  topic?: string
  key_points?: unknown
  research?: Record<string, unknown>
  sources?: unknown
  error?: string
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

function classifyLegacyError(error: unknown): LegacyResearchErrorCode {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) {
    return "PROVIDER_TIMEOUT"
  }
  if (text.includes("429") || text.includes("rate limit")) {
    return "RATE_LIMITED"
  }
  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("504")) {
    return "PROVIDER_UNAVAILABLE"
  }
  return "UNKNOWN_ERROR"
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item || "").trim()).filter(Boolean)
}

function normalizeLegacySources(input: unknown): LegacyResearchSource[] {
  if (!Array.isArray(input)) return []
  const out: LegacyResearchSource[] = []
  for (const raw of input) {
    const item = raw as Record<string, unknown>
    const url = String(item?.url || item?.link || "").trim()
    const title = String(item?.title || item?.name || "").trim()
    if (!url || !title) continue
    out.push({
      url,
      title,
      publisher: item?.publisher ? String(item.publisher) : undefined,
      snippet: item?.snippet ? String(item.snippet) : undefined,
      publishedAt: item?.publishedAt ? String(item.publishedAt) : undefined,
      credibilityScore: Number(item?.credibilityScore || 0.7),
    })
  }
  return out
}

function buildInsightFromLegacy(topic: string, keyPoints: string[]): LegacyResearchInsight {
  const angles = keyPoints.slice(0, 4)
  return {
    summary:
      keyPoints.length > 0
        ? `Legacy QueryEngine completed research for "${topic}". Key points: ${keyPoints.slice(0, 3).join(" / ")}`
        : `Legacy QueryEngine completed research for "${topic}".`,
    risks: [
      "Legacy research response may omit source-level metadata.",
      "Time-sensitive claims still require manual verification before publish.",
    ],
    angles,
    recommendedTitles: [
      `${topic}: key shifts this week`,
      `${topic}: practical execution checklist`,
      `${topic}: risk map and next actions`,
    ],
  }
}

function isLegacyResearchEnabled(): boolean {
  const raw = String(process.env.USE_LEGACY_QUERYENGINE_RESEARCH || process.env.RESEARCH_BACKEND || "")
    .trim()
    .toLowerCase()
  return raw === "true" || raw === "1" || raw === "legacy" || raw === "queryengine"
}

export function shouldUseLegacyQueryEngineResearch(): boolean {
  return isLegacyResearchEnabled()
}

export async function runLegacyQueryEngineResearch(topic: string): Promise<LegacyResearchResult> {
  const response = await fetch(buildLegacyUrl("/api/content/research"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    cache: "no-store",
    signal: withTimeoutSignal(12000),
  })

  const payload = (await response.json().catch(() => ({}))) as LegacyResearchApiResponse

  if (!response.ok || payload.success === false) {
    const detail = payload?.error ? String(payload.error) : `HTTP_${response.status}`
    const code = classifyLegacyError(detail)
    throw new Error(`legacy_queryengine_failed:${code}:${detail}`)
  }

  const keyPoints = toStringArray(payload?.key_points)
  const primarySources = normalizeLegacySources(payload?.sources)
  const fallbackSources = normalizeLegacySources(payload?.research?.sources)
  const sources = primarySources.length > 0 ? primarySources : fallbackSources
  const insight = buildInsightFromLegacy(topic, keyPoints)

  return {
    provider: "legacy-queryengine",
    sources,
    insight,
  }
}
