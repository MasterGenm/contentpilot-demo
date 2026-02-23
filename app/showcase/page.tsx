"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, RefreshCcw } from "lucide-react"
import { toast } from "sonner"

import { Header } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type ShowcaseRun = {
  taskId: string
  projectId: string | null
  status: string
  failedStep: string | null
  recoverable: boolean
  updatedAt: string
  durationMs: number
  stepsCount: number
  summary: string
  platformCount: number
  publishStatus: string
}

type ShowcaseData = {
  generatedAt: string
  metrics: {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    runningRuns: number
    successRate: number
    avgDurationMs: number
    avgSteps: number
  }
  recentRuns: ShowcaseRun[]
}

function toDurationText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-"
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function toDateText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

export default function ShowcasePage() {
  const [loading, setLoading] = React.useState(false)
  const [data, setData] = React.useState<ShowcaseData | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/workflow/showcase/summary?limit=50", { method: "GET" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error?.message || "获取展示数据失败")
      }
      setData(payload.data as ShowcaseData)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取展示数据失败")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const metrics = data?.metrics
  const recentRuns = data?.recentRuns || []

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="价值展示总览" />

      <main className="flex-1 space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>展示目标</CardTitle>
            <CardDescription>
              证明这不是一次性 Demo，而是可运行、可恢复、可审计的内容生产工作流。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCcw className="mr-2 size-4" />}
              刷新展示数据
            </Button>
            <Link href="/workflow">
              <Button>运行总流程</Button>
            </Link>
            <Link href="/projects">
              <Button variant="secondary">打开项目管理</Button>
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardHeader>
              <CardDescription>总运行次数</CardDescription>
              <CardTitle>{metrics?.totalRuns ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>成功次数</CardDescription>
              <CardTitle>{metrics?.completedRuns ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>失败次数</CardDescription>
              <CardTitle>{metrics?.failedRuns ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>运行中</CardDescription>
              <CardTitle>{metrics?.runningRuns ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>成功率</CardDescription>
              <CardTitle>{metrics ? `${metrics.successRate}%` : "0%"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>平均耗时</CardDescription>
              <CardTitle>{toDurationText(metrics?.avgDurationMs ?? 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>最近运行记录</CardTitle>
            <CardDescription>
              每条记录都可导出审计报告（JSON/Markdown）。最近刷新时间：{data ? toDateText(data.generatedAt) : "-"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录。先去总流程页跑一次。</p>
            ) : (
              recentRuns.map((run) => (
                <div key={run.taskId} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Task: <code>{run.taskId}</code>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        项目ID：{run.projectId || "-"} · 更新时间：{toDateText(run.updatedAt)} · 耗时：{toDurationText(run.durationMs)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "COMPLETED" ? "default" : run.status === "FAILED" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                      {run.recoverable ? <Badge variant="outline">可恢复</Badge> : null}
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground">
                    摘要：{run.summary || "无摘要"} · 平台稿件：{run.platformCount} · 发布状态：{run.publishStatus}
                    {run.failedStep ? ` · 失败步骤：${run.failedStep}` : ""}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/workflow?projectId=${encodeURIComponent(run.projectId || "")}&resumeTaskId=${encodeURIComponent(run.taskId)}`}>
                      <Button size="sm" variant="secondary">打开并恢复</Button>
                    </Link>
                    <a href={`/api/workflow/report?taskId=${encodeURIComponent(run.taskId)}&format=json&download=1`}>
                      <Button size="sm" variant="outline">导出 JSON 报告</Button>
                    </a>
                    <a href={`/api/workflow/report?taskId=${encodeURIComponent(run.taskId)}&format=md&download=1`}>
                      <Button size="sm" variant="outline">导出 Markdown 报告</Button>
                    </a>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

