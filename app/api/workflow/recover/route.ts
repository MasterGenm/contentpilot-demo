import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { listTasks } from "@/lib/server/task-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "workflow")
  const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim()

  const latestCandidates = listTasks({
    kind: "workflow",
    status: ["RUNNING", "FAILED"],
    projectId: projectId || undefined,
    limit: 10,
  })
  const nowTs = Date.now()
  const latest = latestCandidates.find((task) => {
    if (task.status !== "RUNNING") return true

    const startedTs = Date.parse(task.startedAt || "")
    const updatedTs = Date.parse(task.updatedAt || "")
    const payload = task.payload && typeof task.payload === "object" ? task.payload : {}
    const hasStepSnapshot = Array.isArray((payload as { steps?: unknown }).steps)
    const looksStale =
      task.progress <= 5 &&
      !hasStepSnapshot &&
      Number.isFinite(startedTs) &&
      Number.isFinite(updatedTs) &&
      startedTs === updatedTs &&
      nowTs - updatedTs > 3 * 60 * 1000

    return !looksStale
  })

  if (!latest) {
    return meta.ok({
      found: false,
      projectId: projectId || null,
    })
  }

  return meta.ok({
    found: true,
    task: latest,
    resumeTaskId: latest.taskId,
  })
}
