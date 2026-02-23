import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { getTask } from "@/lib/server/task-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  const meta = withMeta(request, "task-registry")
  const { taskId } = await context.params
  const normalizedTaskId = String(taskId || "").trim()

  if (!normalizedTaskId) {
    return meta.error(
      {
        code: "VALIDATION_ERROR",
        message: "taskId is required",
        retriable: false,
      },
      400
    )
  }

  const task = getTask(normalizedTaskId)
  if (!task) {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "Task not found or expired",
        retriable: true,
      },
      404
    )
  }

  return meta.ok(task)
}
