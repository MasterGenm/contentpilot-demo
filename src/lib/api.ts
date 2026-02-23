export interface ApiError {
  code:
    | "VALIDATION_ERROR"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_UNAVAILABLE"
    | "RATE_LIMITED"
    | "WP_AUTH_FAILED"
    | "UNKNOWN_ERROR"
  message: string
  retriable: boolean
  detail?: string
}

export interface ApiMeta {
  requestId: string
  durationMs: number
  provider?: string
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: ApiError
  meta: ApiMeta
}

export function buildRequestMeta(provider?: string): ApiMeta {
  return {
    requestId: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    durationMs: 0,
    provider,
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const startedAt = Date.now()
  const fallbackMeta = buildRequestMeta()

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    })

    const payload = (await response.json().catch(() => ({}))) as Partial<ApiResponse<T>>

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.error || {
          code: "UNKNOWN_ERROR",
          message: `Request failed: ${response.status}`,
          retriable: response.status >= 500,
        },
        meta: {
          ...(payload.meta || fallbackMeta),
          durationMs: Date.now() - startedAt,
        },
      }
    }

    return {
      ok: true,
      data: payload.data,
      meta: {
        ...(payload.meta || fallbackMeta),
        durationMs: Date.now() - startedAt,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Network request failed",
        detail: error instanceof Error ? error.message : String(error),
        retriable: true,
      },
      meta: {
        ...fallbackMeta,
        durationMs: Date.now() - startedAt,
      },
    }
  }
}

export function apiPost<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, { method: "GET" })
}
