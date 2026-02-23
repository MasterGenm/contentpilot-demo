export interface SearchResultItem {
  url: string
  title: string
  publisher?: string
  snippet?: string
  publishedAt?: string
  score?: number
}

interface SearchParams {
  query: string
  maxResults?: number
  recencyDays?: number
}

export interface SearchRunResult {
  provider: "tavily" | "serper" | "none"
  results: SearchResultItem[]
  fallbackUsed: boolean
  primaryProvider: "tavily" | "serper" | "none"
  attempts: SearchAttempt[]
  fallbackReason?: "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED"
}

export interface SearchAttempt {
  provider: "tavily" | "serper"
  status: "success" | "error"
  durationMs: number
  errorCode?: "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED"
  errorMessage?: string
}

function trim(text: string, max = 360): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeUrl(input: string): string {
  try {
    const u = new URL(input)
    u.hash = ""
    const removeKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "spm"]
    removeKeys.forEach((k) => u.searchParams.delete(k))
    return u.toString().replace(/\/?$/, "")
  } catch {
    return input.trim()
  }
}

function titleSignature(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 14)
    .sort()
    .join(" ")

  let hash = 0
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}

function dedupeResults(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>()
  const output: SearchResultItem[] = []

  for (const item of items) {
    const key = `${normalizeUrl(item.url)}|${titleSignature(item.title)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push(item)
  }

  return output
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

function parsePublisher(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function serperFreshness(days?: number): "qdr:d" | "qdr:w" | "qdr:m" | "qdr:y" | undefined {
  if (!days || days <= 0) return undefined
  if (days <= 1) return "qdr:d"
  if (days <= 7) return "qdr:w"
  if (days <= 31) return "qdr:m"
  return "qdr:y"
}

function hasTavilyConfig(): boolean {
  return Boolean(process.env.TAVILY_API_KEY)
}

function hasSerperConfig(): boolean {
  return Boolean(process.env.SERPER_API_KEY)
}

export function hasSearchConfig(): boolean {
  return hasTavilyConfig() || hasSerperConfig()
}

function classifySearchError(error: unknown): "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  if (
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout")
  ) {
    return "PROVIDER_TIMEOUT"
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return "RATE_LIMITED"
  }

  return "PROVIDER_UNAVAILABLE"
}

async function runProvider(
  provider: "tavily" | "serper",
  executor: () => Promise<SearchResultItem[]>
): Promise<{ results: SearchResultItem[]; attempt: SearchAttempt }> {
  const startedAt = Date.now()
  try {
    const results = await executor()
    return {
      results,
      attempt: {
        provider,
        status: "success",
        durationMs: Date.now() - startedAt,
      },
    }
  } catch (error) {
    return {
      results: [],
      attempt: {
        provider,
        status: "error",
        durationMs: Date.now() - startedAt,
        errorCode: classifySearchError(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function searchTavily(params: SearchParams): Promise<SearchResultItem[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: withTimeoutSignal(8000),
    body: JSON.stringify({
      api_key: apiKey,
      query: params.query,
      max_results: params.maxResults || 12,
      search_depth: "advanced",
      include_raw_content: false,
      include_images: false,
      ...(params.recencyDays ? { days: params.recencyDays } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`tavily:${response.status}:${detail}`)
  }

  const data = await response.json()
  const results = Array.isArray(data?.results) ? data.results : []

  return results.map((item: Record<string, unknown>) => {
    const url = String(item.url || "")
    return {
      url,
      title: String(item.title || "Untitled"),
      publisher: parsePublisher(url),
      snippet: trim(String(item.content || "")),
      publishedAt: item.published_date ? String(item.published_date) : undefined,
      score: typeof item.score === "number" ? item.score : undefined,
    }
  })
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts).toISOString()
}

async function searchSerper(params: SearchParams): Promise<SearchResultItem[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) return []

  const baseUrl = (process.env.SERPER_BASE_URL || "https://google.serper.dev").replace(/\/+$/, "")
  const tbs = serperFreshness(params.recencyDays)

  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    signal: withTimeoutSignal(6000),
    body: JSON.stringify({
      q: params.query,
      num: params.maxResults || 12,
      gl: "us",
      hl: "zh-cn",
      autocorrect: true,
      ...(tbs ? { tbs } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`serper:${response.status}:${detail}`)
  }

  const data = await response.json()
  const results = Array.isArray(data?.organic) ? data.organic : []

  return results.map((item: Record<string, unknown>) => {
    const url = String(item.link || "")
    const position = typeof item.position === "number" ? item.position : undefined
    return {
      url,
      title: String(item.title || "Untitled"),
      publisher: parsePublisher(url),
      snippet: trim(String(item.snippet || "")),
      publishedAt: toIsoDate(typeof item.date === "string" ? item.date : undefined),
      score: position && position > 0 ? Number((1 / position).toFixed(4)) : undefined,
    }
  })
}

export async function searchWeb(params: SearchParams): Promise<SearchResultItem[]> {
  const out = await searchWebWithFallback(params)
  return out.results
}

export async function searchWebWithFallback(params: SearchParams): Promise<SearchRunResult> {
  const normalized: SearchParams = {
    query: params.query,
    maxResults: params.maxResults || 12,
    recencyDays: params.recencyDays,
  }

  const attempts: SearchAttempt[] = []

  if (hasTavilyConfig()) {
    const tavilyRun = await runProvider("tavily", () => searchTavily(normalized))
    attempts.push(tavilyRun.attempt)

    if (tavilyRun.attempt.status === "success") {
      return {
        provider: "tavily",
        primaryProvider: "tavily",
        results: dedupeResults(tavilyRun.results),
        fallbackUsed: false,
        attempts,
      }
    }

    if (hasSerperConfig()) {
      const serperRun = await runProvider("serper", () => searchSerper(normalized))
      attempts.push(serperRun.attempt)

      if (serperRun.attempt.status === "success") {
        return {
          provider: "serper",
          primaryProvider: "tavily",
          results: dedupeResults(serperRun.results),
          fallbackUsed: true,
          attempts,
          fallbackReason: tavilyRun.attempt.errorCode,
        }
      }

      const fallbackDetail = serperRun.attempt.errorMessage || "unknown"
      throw new Error(`search_all_failed:${tavilyRun.attempt.errorCode || "unknown"}:${fallbackDetail}`)
    }

    throw new Error(`tavily_failed_no_fallback:${tavilyRun.attempt.errorCode || "unknown"}`)
  }

  if (hasSerperConfig()) {
    const serperRun = await runProvider("serper", () => searchSerper(normalized))
    attempts.push(serperRun.attempt)

    if (serperRun.attempt.status !== "success") {
      throw new Error(`serper_failed:${serperRun.attempt.errorCode || "unknown"}`)
    }

    return {
      provider: "serper",
      primaryProvider: "serper",
      results: dedupeResults(serperRun.results),
      fallbackUsed: false,
      attempts,
    }
  }

  return {
    provider: "none",
    primaryProvider: "none",
    results: [],
    fallbackUsed: false,
    attempts,
  }
}
