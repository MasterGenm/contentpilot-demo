import { NextResponse } from "next/server"

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "WP_AUTH_FAILED"
  | "UNKNOWN_ERROR"

export interface ApiErrorPayload {
  code: ApiErrorCode
  message: string
  retriable: boolean
  detail?: string
}

function requestIdFromHeaders(request?: Request): string {
  const fromHeader =
    request?.headers.get("x-trace-id") ||
    request?.headers.get("x-request-id") ||
    request?.headers.get("traceparent")

  if (fromHeader) {
    return fromHeader.slice(0, 120)
  }

  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function withMeta(request?: Request, provider?: string) {
  const startedAt = Date.now()
  const requestId = requestIdFromHeaders(request)

  return {
    ok<T>(data: T, status = 200) {
      return NextResponse.json(
        {
          ok: true,
          data,
          meta: {
            requestId,
            durationMs: Date.now() - startedAt,
            provider,
          },
        },
        { status }
      )
    },
    error(error: ApiErrorPayload, status = 500) {
      return NextResponse.json(
        {
          ok: false,
          error,
          meta: {
            requestId,
            durationMs: Date.now() - startedAt,
            provider,
          },
        },
        { status }
      )
    },
    requestId,
  }
}
