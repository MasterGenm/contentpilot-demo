import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { findLatestRecoverableWorkflowTask } from "@/lib/server/chat-session-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "chat-session")
  const conversationId = String(request.nextUrl.searchParams.get("conversationId") || "").trim()
  const userId = String(request.nextUrl.searchParams.get("userId") || "").trim()
  const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim()

  const recovered = findLatestRecoverableWorkflowTask({
    conversationId: conversationId || undefined,
    userId: userId || undefined,
    projectId: projectId || undefined,
  })

  if (!recovered) {
    return meta.ok({
      found: false,
      conversationId: conversationId || null,
    })
  }

  return meta.ok({
    found: true,
    ...recovered,
  })
}

