import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { getTask } from "@/lib/server/task-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ReportStep = {
  step: string
  status: string
  retryCount: number
  provider?: string
  durationMs?: number
  errorCode?: string
  errorMessage?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseSteps(input: unknown): ReportStep[] {
  if (!Array.isArray(input)) return []
  return input.map((raw) => {
    const item = asRecord(raw) || {}
    return {
      step: String(item.step || "unknown"),
      status: String(item.status || "UNKNOWN"),
      retryCount: Number(item.retryCount || 0),
      provider: item.provider ? String(item.provider) : undefined,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
      errorCode: item.errorCode ? String(item.errorCode) : undefined,
      errorMessage: item.errorMessage ? String(item.errorMessage) : undefined,
    }
  })
}

function durationMsFromTask(input: { startedAt?: string; endedAt?: string }, steps: ReportStep[]): number {
  const started = Date.parse(input.startedAt || "")
  const ended = Date.parse(input.endedAt || "")
  if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
    return ended - started
  }
  const sum = steps.reduce((acc, step) => acc + (step.durationMs || 0), 0)
  return Math.max(0, Math.round(sum))
}

function buildMarkdown(report: Record<string, unknown>): string {
  const task = asRecord(report.task) || {}
  const execution = asRecord(report.execution) || {}
  const output = asRecord(report.output) || {}
  const steps = Array.isArray(execution.steps) ? (execution.steps as ReportStep[]) : []
  const titleCandidates = Array.isArray(output.titleCandidates) ? (output.titleCandidates as string[]) : []

  const lines: string[] = []
  lines.push("# ContentPilot 运行报告")
  lines.push("")
  lines.push(`- 生成时间: ${String(report.generatedAt || "-")}`)
  lines.push(`- Task ID: ${String(task.taskId || "-")}`)
  lines.push(`- 项目ID: ${String(task.projectId || "-")}`)
  lines.push(`- 状态: ${String(task.status || "-")}`)
  lines.push(`- 总耗时(ms): ${String(task.durationMs || 0)}`)
  lines.push("")
  lines.push("## 执行概览")
  lines.push("")
  lines.push(`- 失败步骤: ${String(execution.failedStep || "无")}`)
  lines.push(`- 可恢复: ${String(execution.recoverable || false)}`)
  lines.push(`- 步骤数: ${String(execution.stepsCount || 0)}`)
  lines.push(`- 完成步骤数: ${String(execution.completedSteps || 0)}`)
  lines.push("")
  lines.push("## 关键输出")
  lines.push("")
  lines.push(`- 主题: ${String(output.topic || "-")}`)
  lines.push(`- 研究来源: ${String(output.researchTool || "WEB_SEARCH")}`)
  lines.push(`- 研究来源数: ${String(output.sourcesCount || 0)}`)
  lines.push(`- 研究摘要: ${String(output.researchSummary || "-")}`)
  lines.push(`- 初稿字数: ${String(output.draftLength || 0)}`)
  lines.push(`- 改写平台数: ${String(output.platformCount || 0)}`)
  lines.push(`- 发布状态: ${String(output.publishStatus || "not_published")}`)
  lines.push("")
  if (titleCandidates.length > 0) {
    lines.push("## 推荐标题")
    lines.push("")
    for (const title of titleCandidates) {
      lines.push(`- ${title}`)
    }
    lines.push("")
  }

  lines.push("## 步骤时间线")
  lines.push("")
  lines.push("| step | status | provider | durationMs | error |")
  lines.push("|---|---|---|---:|---|")
  for (const step of steps) {
    lines.push(
      `| ${step.step} | ${step.status} | ${step.provider || "-"} | ${step.durationMs || 0} | ${
        step.errorMessage || "-"
      } |`
    )
  }
  lines.push("")

  return lines.join("\n")
}

export async function GET(request: NextRequest) {
  const meta = withMeta(request, "workflow-report")
  const taskId = String(request.nextUrl.searchParams.get("taskId") || "").trim()
  const format = String(request.nextUrl.searchParams.get("format") || "json").toLowerCase()
  const shouldDownload = request.nextUrl.searchParams.get("download") === "1"

  if (!taskId) {
    return meta.error(
      {
        code: "VALIDATION_ERROR",
        message: "taskId is required",
        retriable: false,
      },
      400
    )
  }

  const task = getTask(taskId)
  if (!task || task.kind !== "workflow") {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "workflow task not found",
        retriable: true,
      },
      404
    )
  }

  const payload = asRecord(task.payload) || {}
  const bundle = asRecord(payload.bundle) || {}
  const research = asRecord(bundle.research) || {}
  const insight = asRecord(research.insight) || {}
  const draft = asRecord(bundle.draft) || {}
  const rewrite = asRecord(bundle.rewrite) || {}
  const publish = asRecord(bundle.publish) || {}
  const finalOutput = asRecord(bundle.finalOutput) || {}
  const steps = parseSteps(payload.steps)
  const durationMs = durationMsFromTask(task, steps)
  const variants = asRecord(rewrite.variants) || {}
  const sources = Array.isArray(research.sources) ? research.sources : []
  const titleCandidates = Array.isArray(finalOutput.titleCandidates)
    ? finalOutput.titleCandidates.map((item) => String(item))
    : []

  const report = {
    reportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    task: {
      taskId: task.taskId,
      status: String(payload.status || task.status),
      kind: task.kind,
      projectId: task.projectId || null,
      provider: task.provider || null,
      traceId: task.traceId || null,
      idempotencyKey: task.idempotencyKey || null,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
      endedAt: task.endedAt || null,
      durationMs,
      error: task.error || null,
    },
    execution: {
      failedStep: payload.failedStep ? String(payload.failedStep) : null,
      recoverable: Boolean(payload.recoverable),
      stepsCount: steps.length,
      completedSteps: steps.filter((item) => item.status === "COMPLETED").length,
      failedSteps: steps.filter((item) => item.status === "FAILED").length,
      steps,
    },
    output: {
      topic: String(bundle.topic || ""),
      researchTool: String(bundle.researchTool || "WEB_SEARCH"),
      timeWindow: String(bundle.timeWindow || ""),
      researchProvider: String(research.provider || ""),
      sourcesCount: sources.length,
      researchSummary: String(insight.summary || finalOutput.summary || ""),
      titleCandidates,
      draftLength: typeof draft.content === "string" ? draft.content.length : 0,
      platformCount: Object.keys(variants).length,
      publishStatus: String(finalOutput.publishStatus || publish.status || "not_published"),
      publishPostId: publish.postId ? String(publish.postId) : null,
      publishEditUrl: publish.editUrl ? String(publish.editUrl) : null,
      finalOutput,
    },
  }

  if (format === "md" || format === "markdown") {
    const markdown = buildMarkdown(report as unknown as Record<string, unknown>)
    const headers = new Headers({
      "Content-Type": "text/markdown; charset=utf-8",
    })
    if (shouldDownload) {
      headers.set("Content-Disposition", `attachment; filename="workflow-report-${taskId}.md"`)
    }
    return new Response(markdown, { status: 200, headers })
  }

  if (shouldDownload) {
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="workflow-report-${taskId}.json"`,
    })
    return new Response(JSON.stringify(report, null, 2), { status: 200, headers })
  }

  return meta.ok(report)
}
