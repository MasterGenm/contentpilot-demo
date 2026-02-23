import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { completeTask, failTask, patchTask, upsertTask } from "@/lib/server/task-registry"
import { executeWorkflowRun } from "@/lib/server/workflow-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function createId(prefix = "workflow"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request, "workflow")

  try {
    const body = await request.json()
    const projectId = String(body?.projectId || "").trim()
    const topic = String(body?.topic || "").trim()
    const researchTool =
      body?.researchTool === "NEWS_SEARCH" ? "NEWS_SEARCH" : "WEB_SEARCH"
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const resumeTaskId = String(body?.resumeTaskId || "").trim()
    const taskId = resumeTaskId || idempotencyKey || traceId || createId()

    if (!resumeTaskId && (!projectId || !topic)) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "projectId and topic are required (or provide resumeTaskId)",
          retriable: false,
        },
        400
      )
    }

    upsertTask(taskId, {
      kind: "workflow",
      status: "RUNNING",
      progress: 5,
      projectId: projectId || undefined,
      provider: "workflow",
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      requestId: meta.requestId,
      payload: {
        topic,
        researchTool,
        resumeTaskId: resumeTaskId || undefined,
      },
    })

    const runResult = await executeWorkflowRun({
      origin: request.nextUrl.origin,
      projectId,
      topic,
      researchTool,
      timeWindow: String(body?.timeWindow || "7d"),
      tone: String(body?.tone || "professional"),
      audience: String(body?.audience || "创作者"),
      length: body?.length === "short" || body?.length === "long" ? body.length : "medium",
      platforms: Array.isArray(body?.platforms)
        ? body.platforms.map((x: unknown) => String(x)).filter(Boolean)
        : undefined,
      generateAsset: body?.generateAsset !== false,
      publishToWordpress: body?.publishToWordpress !== false,
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      resumeTaskId: resumeTaskId || undefined,
    })

    const completedSteps = runResult.steps.filter((item) => item.status === "COMPLETED").length
    const progress = Math.round((completedSteps / Math.max(runResult.steps.length, 1)) * 100)

    patchTask(taskId, {
      progress,
      payload: {
        steps: runResult.steps,
        bundle: runResult.bundle,
        status: runResult.status,
        failedStep: runResult.failedStep,
        recoverable: runResult.recoverable,
      },
    })

    if (runResult.status === "FAILED") {
      failTask(
        taskId,
        {
          code: "PROVIDER_UNAVAILABLE",
          message: runResult.failedStep
            ? `workflow failed at step: ${runResult.failedStep}`
            : "workflow failed",
          retriable: true,
        },
        {
          progress,
          payload: {
            steps: runResult.steps,
            bundle: runResult.bundle,
            status: runResult.status,
            failedStep: runResult.failedStep,
            recoverable: runResult.recoverable,
          },
        }
      )
    } else {
      completeTask(taskId, {
        provider: "workflow",
        progress: 100,
        payload: {
          steps: runResult.steps,
          bundle: runResult.bundle,
          status: runResult.status,
          recoverable: runResult.recoverable,
        },
      })
    }

    return meta.ok({
      taskId,
      status: runResult.status,
      failedStep: runResult.failedStep,
      recoverable: runResult.recoverable,
      steps: runResult.steps,
      bundle: runResult.bundle,
    })
  } catch (error) {
    const fallbackTaskId = request.headers.get("idempotency-key") || request.headers.get("x-trace-id") || meta.requestId
    failTask(fallbackTaskId, {
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "workflow failed",
      retriable: true,
    })

    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "workflow run failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
