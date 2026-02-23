const DEFAULT_BACKEND = "http://127.0.0.1:12000"

export function getLegacyBackendBaseUrl(): string {
  const raw =
    process.env.LEGACY_BACKEND_URL ||
    process.env.NEXT_PUBLIC_LEGACY_BACKEND_URL ||
    DEFAULT_BACKEND
  return raw.replace(/\/+$/, "")
}

export function buildLegacyUrl(path: string): string {
  const base = getLegacyBackendBaseUrl()
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}

export async function proxyLegacyJson(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = buildLegacyUrl(path)
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  })
}
