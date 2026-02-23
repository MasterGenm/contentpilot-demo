import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function createRequestId(prefix?: string): string {
  const uuid = globalThis?.crypto?.randomUUID?.()
  if (uuid) {
    return prefix ? `${prefix}-${uuid}` : uuid
  }

  const fallback = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}-${fallback}` : fallback
}
