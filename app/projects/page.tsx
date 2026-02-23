"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Header } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useStore } from "@/stores/project-store"

type RecoverableTask = {
  taskId: string
  projectId?: string
  status: "RUNNING" | "FAILED"
  progress: number
  updatedAt: string
  error?: { message?: string }
}

function toLocaleDate(value?: string): string {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString()
}

export default function ProjectsPage() {
  const router = useRouter()
  const {
    projects,
    currentProjectId,
    setCurrentProject,
    deleteProject,
    sources,
    drafts,
    variants,
    publishJobs,
    researchTasks,
  } = useStore()

  const [recoverableByProject, setRecoverableByProject] = React.useState<Record<string, RecoverableTask>>({})
  const [loadingRecoverables, setLoadingRecoverables] = React.useState(false)
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null)

  const loadRecoverableTasks = React.useCallback(async () => {
    setLoadingRecoverables(true)
    try {
      const response = await fetch("/api/workflow/recover/list?byProject=1&limit=200", { method: "GET" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok || !Array.isArray(payload?.data?.tasks)) {
        throw new Error(payload?.error?.message || "获取可恢复任务失败")
      }

      const mapping: Record<string, RecoverableTask> = {}
      for (const task of payload.data.tasks as RecoverableTask[]) {
        const projectId = String(task.projectId || "").trim()
        if (!projectId) continue
        if (!mapping[projectId]) {
          mapping[projectId] = task
        }
      }
      setRecoverableByProject(mapping)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取可恢复任务失败")
    } finally {
      setLoadingRecoverables(false)
    }
  }, [])

  React.useEffect(() => {
    void loadRecoverableTasks()
  }, [loadRecoverableTasks])

  const handleResumeProject = React.useCallback(
    (projectId: string) => {
      const task = recoverableByProject[projectId]
      if (!task?.taskId) {
        toast.message("该项目暂无可恢复任务")
        return
      }
      setCurrentProject(projectId)
      router.push(`/workflow?resumeTaskId=${encodeURIComponent(task.taskId)}&projectId=${encodeURIComponent(projectId)}`)
    },
    [recoverableByProject, router, setCurrentProject]
  )

  const handleDeleteProject = React.useCallback(
    (projectId: string, title: string) => {
      if (!window.confirm(`确认删除项目「${title}」吗？\n将级联删除该项目的研究、初稿、改写、素材、发布记录。`)) {
        return
      }

      setDeletingProjectId(projectId)
      try {
        deleteProject(projectId)
        setRecoverableByProject((prev) => {
          const next = { ...prev }
          delete next[projectId]
          return next
        })
        toast.success("项目已删除")
      } finally {
        setDeletingProjectId(null)
      }
    },
    [deleteProject]
  )

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="项目与任务管理" />

      <main className="flex-1 space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>历史项目管理</CardTitle>
            <CardDescription>统一管理历史项目、恢复任务与删除清理；总流程页只保留执行控制。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void loadRecoverableTasks()} disabled={loadingRecoverables}>
              {loadingRecoverables ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 size-4" />
              )}
              刷新可恢复任务
            </Button>
            <Link href="/workflow">
              <Button>打开总流程控制</Button>
            </Link>
          </CardContent>
        </Card>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              暂无项目。先去 <Link href="/research" className="underline">选题研究</Link> 创建一个项目。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => {
              const recoverable = recoverableByProject[project.id]
              const sourceCount = sources.filter((item) => item.projectId === project.id).length
              const projectDraftIds = new Set(
                drafts.filter((item) => item.projectId === project.id).map((item) => item.id)
              )
              const draftCount = projectDraftIds.size
              const variantCount = variants.filter((item) => projectDraftIds.has(item.draftId)).length
              const publishSuccessCount = publishJobs.filter(
                (item) => item.projectId === project.id && item.status === "COMPLETED"
              ).length
              const runningResearchCount = researchTasks.filter(
                (item) => item.projectId === project.id && item.status === "RUNNING"
              ).length

              return (
                <Card key={project.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{project.title}</CardTitle>
                        <CardDescription>
                          项目ID：<code>{project.id}</code>
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentProjectId === project.id ? <Badge>当前项目</Badge> : <Badge variant="outline">历史项目</Badge>}
                        <Badge variant="secondary">{project.status}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      关键词：{project.topicKeywords.length ? project.topicKeywords.join("，") : "无"}
                    </p>
                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-5">
                      <div>来源：{sourceCount}</div>
                      <div>初稿：{draftCount}</div>
                      <div>改写：{variantCount}</div>
                      <div>发布成功：{publishSuccessCount}</div>
                      <div>运行中研究：{runningResearchCount}</div>
                    </div>

                    <div className="rounded border p-2 text-xs">
                      {recoverable ? (
                        <p>
                          可恢复任务：<code>{recoverable.taskId}</code> · 状态 {recoverable.status} · 更新于{" "}
                          {toLocaleDate(recoverable.updatedAt)}
                          {recoverable.error?.message ? ` · ${recoverable.error.message}` : ""}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">暂无可恢复任务</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setCurrentProject(project.id)}>
                        设为当前项目
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleResumeProject(project.id)}
                        disabled={!recoverable?.taskId}
                      >
                        恢复并运行
                      </Button>
                      <Link href={`/workflow?projectId=${encodeURIComponent(project.id)}`}>
                        <Button variant="outline">进入总流程页</Button>
                      </Link>
                      <Button
                        variant="destructive"
                        onClick={() => handleDeleteProject(project.id, project.title)}
                        disabled={deletingProjectId === project.id}
                      >
                        {deletingProjectId === project.id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 size-4" />
                        )}
                        删除项目
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
