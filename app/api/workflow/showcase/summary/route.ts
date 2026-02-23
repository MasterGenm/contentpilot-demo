import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { listTasks } from "@/lib/server/task-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StepPayload = {
  step?: string
  status?: string
  durationMs?: number
}

type BundlePayload = {
  finalOutput?: {
    summary?: string
    platformCount?: number
    publishStatus?: string
  }
  research?: {
    insight?: {
      summary?: string
    }
  }
  rewrite?: {
    variants?: Record<string, unknown>
  }
  publish?: {
    status?: string
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toDurationMs(input: { startedAt?: string; endedAt?: string }, steps: StepPayload[]): number {
  const started = Date.parse(input.startedAt || "")
  const ended = Date.parse(input.endedAt || "")
  if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
    return ended - started
  }
  const sum = steps.reduce((acc, step) => acc + (typeof step.durationMs === "number" ? step.durationMs : 0), 0)
  return Math.max(0, Math.round(sum))
}

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "workflow")
  const limitParam = Number.parseInt(String(request.nextUrl.searchParams.get("limit") || "50"), 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50

  const tasks = listTasks({ kind: "workflow", limit })
  const recentRuns = tasks.map((task) => {
    const payload = asRecord(task.payload) || {}
    const steps = Array.isArray(payload.steps) ? (payload.steps as StepPayload[]) : []
    const bundle = (asRecord(payload.bundle) || {}) as BundlePayload
    const effectiveStatus = String(payload.status || task.status)
    const durationMs = toDurationMs(task, steps)
    const finalOutput = bundle.finalOutput || {}
    const platformCount =
      typeof finalOutput.platformCount === "number"
        ? finalOutput.platformCount
        : Object.keys(bundle.rewrite?.variants || {}).length

    return {
      taskId: task.taskId,
      projectId: task.projectId || null,
      status: effectiveStatus,
      failedStep: payload.failedStep ? String(payload.failedStep) : null,
      recoverable: Boolean(payload.recoverable),
      updatedAt: task.updatedAt,
      durationMs,
      stepsCount: steps.length,
      summary: String(finalOutput.summary || bundle.research?.insight?.summary || "").trim(),
      platformCount,
      publishStatus: String(finalOutput.publishStatus || bundle.publish?.status || "not_published"),
    }
  })

  const completedRuns = recentRuns.filter((item) => item.status === "COMPLETED")
  const failedRuns = recentRuns.filter((item) => item.status === "FAILED")
  const runningRuns = recentRuns.filter((item) => item.status === "RUNNING")

  const avgDurationMs =
    completedRuns.length > 0
      ? Math.round(completedRuns.reduce((acc, item) => acc + item.durationMs, 0) / completedRuns.length)
      : 0

  const avgSteps =
    recentRuns.length > 0
      ? Number((recentRuns.reduce((acc, item) => acc + item.stepsCount, 0) / recentRuns.length).toFixed(2))
      : 0

  const successRate =
    recentRuns.length > 0
      ? Number(((completedRuns.length / recentRuns.length) * 100).toFixed(2))
      : 0

  return meta.ok({
    generatedAt: new Date().toISOString(),
    metrics: {
      totalRuns: recentRuns.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      runningRuns: runningRuns.length,
      successRate,
      avgDurationMs,
      avgSteps,
    },
    recentRuns,
  })
}

