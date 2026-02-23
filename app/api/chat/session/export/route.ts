import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { exportChatSession } from "@/lib/server/chat-session-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "chat-session")
  const conversationId = String(request.nextUrl.searchParams.get("conversationId") || "").trim()

  if (!conversationId) {
    return meta.error(
      {
        code: "VALIDATION_ERROR",
        message: "conversationId is required",
        retriable: false,
      },
      400
    )
  }

  const exported = exportChatSession(conversationId)
  if (!exported) {
    return meta.error(
      {
        code: "VALIDATION_ERROR",
        message: "conversation not found",
        retriable: false,
      },
      404
    )
  }

  return meta.ok(exported)
}

