import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { listTasks } from "@/lib/server/task-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isStaleRunningTask(task: {
  status: string
  progress: number
  startedAt?: string
  updatedAt?: string
  payload?: Record<string, unknown>
}): boolean {
  if (task.status !== "RUNNING") return false

  const startedTs = Date.parse(task.startedAt || "")
  const updatedTs = Date.parse(task.updatedAt || "")
  const payload = task.payload && typeof task.payload === "object" ? task.payload : {}
  const hasStepSnapshot = Array.isArray((payload as { steps?: unknown }).steps)
  const nowTs = Date.now()

  return (
    task.progress <= 5 &&
    !hasStepSnapshot &&
    Number.isFinite(startedTs) &&
    Number.isFinite(updatedTs) &&
    startedTs === updatedTs &&
    nowTs - updatedTs > 3 * 60 * 1000
  )
}

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "workflow")
  const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim()
  const byProject = request.nextUrl.searchParams.get("byProject") !== "0"
  const limitParam = Number.parseInt(String(request.nextUrl.searchParams.get("limit") || "50"), 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50

  const candidates = listTasks({
    kind: "workflow",
    status: ["RUNNING", "FAILED"],
    projectId: projectId || undefined,
    limit: Math.max(limit * 3, 50),
  }).filter((task) => !isStaleRunningTask(task))

  let tasks = candidates

  if (byProject) {
    const seenProjectIds = new Set<string>()
    const grouped: typeof candidates = []
    for (const task of candidates) {
      const key = String(task.projectId || "")
      if (!key || seenProjectIds.has(key)) continue
      seenProjectIds.add(key)
      grouped.push(task)
      if (grouped.length >= limit) break
    }
    tasks = grouped
  } else {
    tasks = candidates.slice(0, limit)
  }

  return meta.ok({
    tasks,
    count: tasks.length,
    byProject,
    projectId: projectId || null,
  })
}

