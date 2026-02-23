"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink, Loader2, Search, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Header, WorkflowSteps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { fetchTaskStatus, isTerminalTaskStatus } from "@/lib/task-client"
import { createRequestId } from "@/lib/utils"
import { useStore, type Insight, type SearchTool, type SourceItem } from "@/stores/project-store"

const timeWindowOptions = [
  { value: "24h", label: "最近24小时" },
  { value: "7d", label: "最近7天" },
  { value: "30d", label: "最近30天" },
  { value: "all", label: "不限时间" },
]

type ProviderAttempt = {
  provider: "tavily" | "serper"
  status: "success" | "error"
  durationMs: number
  errorCode?: string
  errorMessage?: string
}

type ProviderRun = {
  provider: "tavily" | "serper" | "none"
  primaryProvider: "tavily" | "serper" | "none"
  fallbackUsed: boolean
  fallbackReason?: string
  attempts: ProviderAttempt[]
}

export default function ResearchPage() {
  const {
    projects,
    currentProjectId,
    setCurrentProject,
    addProject,
    updateProject,
    addResearchTask,
    updateResearchTask,
    addSource,
    addInsight,
    researchTasks,
    sources,
    insights,
    setWorkflowStep,
  } = useStore()

  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) : projects[0]

  const [title, setTitle] = React.useState(currentProject?.title || "")
  const [projectIdInput, setProjectIdInput] = React.useState(currentProject?.id || "")
  const [keywords, setKeywords] = React.useState(currentProject?.topicKeywords.join(", ") || "")
  const [timeWindow, setTimeWindow] = React.useState(currentProject?.timeWindow || "7d")
  const [searchTool, setSearchTool] = React.useState<SearchTool>("WEB_SEARCH")

  const [isSearching, setIsSearching] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [resultSources, setResultSources] = React.useState<SourceItem[]>([])
  const [resultInsight, setResultInsight] = React.useState<Insight | null>(null)
  const [providerRun, setProviderRun] = React.useState<ProviderRun | null>(null)
  const recoveredTaskRef = React.useRef<string | null>(null)

  const pendingResearchTask = React.useMemo(() => {
    if (!currentProject) return undefined
    return researchTasks.find(
      (task) => task.projectId === currentProject.id && task.status === "RUNNING" && Boolean(task.taskId)
    )
  }, [currentProject?.id, researchTasks])

  React.useEffect(() => {
    if (!currentProject) return
    setTitle(currentProject.title || "")
    setKeywords(currentProject.topicKeywords.join(", ") || "")
    setTimeWindow(currentProject.timeWindow || "7d")
    setProjectIdInput(currentProject.id)
  }, [currentProject?.id])

  React.useEffect(() => {
    if (!currentProject || !pendingResearchTask?.taskId) return
    if (isSearching) return
    if (recoveredTaskRef.current === pendingResearchTask.taskId) return

    recoveredTaskRef.current = pendingResearchTask.taskId
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const snapshot = await fetchTaskStatus(pendingResearchTask.taskId as string)
      if (!snapshot || cancelled) return

      const nextProgress = Number.isFinite(snapshot.progress) ? snapshot.progress : 0
      setIsSearching(!isTerminalTaskStatus(snapshot.status))
      setProgress(nextProgress)

      updateResearchTask(pendingResearchTask.id, {
        status: snapshot.status,
        progress: nextProgress,
        provider: snapshot.provider,
        error: snapshot.error?.message,
        endedAt: snapshot.endedAt,
        lastSyncAt: new Date().toISOString(),
      })

      if (snapshot.status === "COMPLETED") {
        const payload = snapshot.payload || {}
        const restoredSources = Array.isArray(payload.sources)
          ? (payload.sources as Array<Record<string, unknown>>)
          : []
        const restoredInsight =
          payload.insight && typeof payload.insight === "object"
            ? (payload.insight as Record<string, unknown>)
            : null

        const projectSourceUrls = new Set(
          sources.filter((item) => item.projectId === currentProject.id).map((item) => item.url)
        )
        const recoveredSources: SourceItem[] = []
        for (const item of restoredSources) {
          const url = String(item.url || "")
          if (!url) continue
          const source: SourceItem = {
            id: `recovered-${Date.now()}-${Math.random()}`,
            projectId: currentProject.id,
            url,
            title: String(item.title || "Untitled"),
            publisher: item.publisher ? String(item.publisher) : undefined,
            snippet: item.snippet ? String(item.snippet) : undefined,
            publishedAt: item.publishedAt ? String(item.publishedAt) : undefined,
            credibilityScore: Number(item.credibilityScore || 0.5),
            createdAt: new Date().toISOString(),
            provider: snapshot.provider,
            lastSyncAt: new Date().toISOString(),
          }
          recoveredSources.push(source)
          if (!projectSourceUrls.has(url)) {
            addSource({
              projectId: currentProject.id,
              url: source.url,
              title: source.title,
              publisher: source.publisher,
              snippet: source.snippet,
              publishedAt: source.publishedAt,
              credibilityScore: source.credibilityScore,
              provider: snapshot.provider,
              lastSyncAt: source.lastSyncAt,
            })
            projectSourceUrls.add(url)
          }
        }
        if (recoveredSources.length > 0) {
          setResultSources(recoveredSources)
        }

        if (restoredInsight) {
          const insightSummary = String(restoredInsight.summary || "")
          const insightPayload: Insight = {
            id: `recovered-insight-${Date.now()}`,
            projectId: currentProject.id,
            summary: insightSummary,
            risks: Array.isArray(restoredInsight.risks)
              ? restoredInsight.risks.map((x) => String(x))
              : [],
            angles: Array.isArray(restoredInsight.angles)
              ? restoredInsight.angles.map((x) => String(x))
              : [],
            recommendedTitles: Array.isArray(restoredInsight.recommendedTitles)
              ? restoredInsight.recommendedTitles.map((x) => String(x))
              : [],
            createdAt: new Date().toISOString(),
            provider: "llm",
            lastSyncAt: new Date().toISOString(),
          }
          setResultInsight(insightPayload)
          const existingInsight = insights.find((item) => item.projectId === currentProject.id)
          if (!existingInsight) {
            addInsight({
              projectId: currentProject.id,
              summary: insightPayload.summary,
              risks: insightPayload.risks,
              angles: insightPayload.angles,
              recommendedTitles: insightPayload.recommendedTitles,
              provider: "llm",
              lastSyncAt: insightPayload.lastSyncAt,
            })
          }
        }

        updateProject(currentProject.id, { status: "DRAFTING" })
        setWorkflowStep("drafts")
        setIsSearching(false)
        toast.success("已恢复研究任务结果")
        return
      }

      if (snapshot.status === "FAILED") {
        setIsSearching(false)
        toast.error(snapshot.error?.message || "研究任务失败")
        return
      }

      timer = window.setTimeout(poll, 1500)
    }

    poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [
    addInsight,
    addSource,
    currentProject,
    insights,
    pendingResearchTask?.id,
    pendingResearchTask?.taskId,
    isSearching,
    setWorkflowStep,
    sources,
    updateProject,
    updateResearchTask,
  ])

  const handleStartResearch = async () => {
    const normalizedTitle = title.trim()
    const normalizedKeywords = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
    const normalizedProjectId = projectIdInput.trim() || normalizedTitle

    if (!normalizedTitle) {
      toast.error("请输入项目标题")
      return
    }

    if (!keywords.trim()) {
      toast.error("请输入选题关键词")
      return
    }

    if (!normalizedProjectId) {
      toast.error("请输入项目ID")
      return
    }

    if (currentProject?.id && normalizedProjectId !== currentProject.id) {
      toast.message("当前项目ID是固定标识，需新ID请先切换/新建项目")
      setProjectIdInput(currentProject.id)
      return
    }

    setIsSearching(true)
    setProgress(0)
    setResultSources([])
    setResultInsight(null)
    setProviderRun(null)

    let projectId = currentProject?.id
    if (!projectId) {
      if (projects.some((item) => item.id === normalizedProjectId)) {
        toast.error("项目ID已存在，请换一个")
        setIsSearching(false)
        return
      }
      projectId = addProject({
        id: normalizedProjectId,
        title: normalizedTitle,
        topicKeywords: normalizedKeywords,
        timeWindow,
        status: "RESEARCHING",
      })
      setCurrentProject(projectId)
      setProjectIdInput(projectId)
    } else {
      updateProject(projectId, {
        title: normalizedTitle,
        topicKeywords: normalizedKeywords,
        timeWindow,
        status: "RESEARCHING",
      })
    }

    const traceId = createRequestId("trace")
    const idempotencyKey = createRequestId("idem")
    const taskId = addResearchTask({
      projectId,
      query: keywords,
      tool: searchTool,
      status: "RUNNING",
      progress: 0,
      provider: "pending",
      taskId: idempotencyKey,
      lastSyncAt: new Date().toISOString(),
    })

    try {
      const resp = await fetch("/api/research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": traceId },
        body: JSON.stringify({
          projectId,
          query: keywords,
          timeWindow,
          tool: searchTool,
          traceId,
          idempotencyKey,
        }),
      })

      if (!resp.ok || !resp.body) {
        throw new Error("研究请求失败")
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      const localSources: SourceItem[] = []
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue
          let evt: Record<string, any>
          try {
            evt = JSON.parse(line)
          } catch {
            continue
          }
          if (evt.type === "progress") {
            setProgress(evt.progress)
            updateResearchTask(taskId, { progress: evt.progress })
          }
          if (evt.type === "source") {
            const source: SourceItem = {
              id: `tmp-${Date.now()}-${Math.random()}`,
              projectId,
              url: evt.url,
              title: evt.title,
              publisher: evt.publisher,
              snippet: evt.snippet,
              publishedAt: evt.publishedAt,
              credibilityScore: evt.credibilityScore || 0.5,
              createdAt: new Date().toISOString(),
              provider: evt.provider,
              lastSyncAt: new Date().toISOString(),
            }
            localSources.push(source)
            addSource({
              projectId,
              url: evt.url,
              title: evt.title,
              publisher: evt.publisher,
              snippet: evt.snippet,
              publishedAt: evt.publishedAt,
              credibilityScore: evt.credibilityScore || 0.5,
              provider: evt.provider,
              lastSyncAt: new Date().toISOString(),
            })
            setResultSources([...localSources])
          }
          if (evt.type === "provider") {
            setProviderRun({
              provider: evt.provider || "none",
              primaryProvider: evt.primaryProvider || evt.provider || "none",
              fallbackUsed: Boolean(evt.fallbackUsed),
              fallbackReason: evt.fallbackReason,
              attempts: Array.isArray(evt.attempts) ? evt.attempts : [],
            })
            updateResearchTask(taskId, {
              provider: evt.provider || "none",
              lastSyncAt: new Date().toISOString(),
            })
          }
          if (evt.type === "insight") {
            const insight: Insight = {
              id: `tmp-${Date.now()}`,
              projectId,
              summary: evt.summary || "",
              risks: evt.risks || [],
              angles: evt.angles || [],
              recommendedTitles: evt.recommendedTitles || [],
              createdAt: new Date().toISOString(),
              provider: "llm",
              lastSyncAt: new Date().toISOString(),
            }
            setResultInsight(insight)
            addInsight({
              projectId,
              summary: evt.summary || "",
              risks: evt.risks || [],
              angles: evt.angles || [],
              recommendedTitles: evt.recommendedTitles || [],
              provider: "llm",
              lastSyncAt: new Date().toISOString(),
            })
          }
          if (evt.type === "error") {
            throw new Error(evt.message || "研究执行失败")
          }
        }
      }

      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer)
          if (evt.type === "insight") {
            const insight: Insight = {
              id: `tmp-${Date.now()}`,
              projectId,
              summary: evt.summary || "",
              risks: evt.risks || [],
              angles: evt.angles || [],
              recommendedTitles: evt.recommendedTitles || [],
              createdAt: new Date().toISOString(),
              provider: "llm",
              lastSyncAt: new Date().toISOString(),
            }
            setResultInsight(insight)
          }
        } catch {
          // ignore tail parse failures from stream chunks
        }
      }

      updateResearchTask(taskId, { status: "COMPLETED", progress: 100, endedAt: new Date().toISOString() })
      updateProject(projectId, { status: "DRAFTING" })
      setWorkflowStep("drafts")
      toast.success("研究完成")
    } catch (error) {
      updateResearchTask(taskId, {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      })
      toast.error(error instanceof Error ? error.message : "研究失败")
    } finally {
      setIsSearching(false)
    }
  }

  const fallbackSources = currentProject ? sources.filter((s) => s.projectId === currentProject.id) : []
  const displayedSources = resultSources.length > 0 ? resultSources : fallbackSources
  const displayedInsight = resultInsight || (currentProject ? insights.find((i) => i.projectId === currentProject.id) : null)
  const canGoDrafts = displayedSources.length > 0 && Boolean(displayedInsight?.summary)

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="选题研究" />

      <main className="flex-1 p-6">
        <WorkflowSteps />
        <div className="h-4" />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>研究配置</CardTitle>
                <CardDescription>输入主题关键词并启动检索研究。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">项目标题</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="project-id">项目ID</Label>
                  <Input
                    id="project-id"
                    value={projectIdInput}
                    onChange={(e) => setProjectIdInput(e.target.value)}
                    placeholder={currentProject ? "当前项目ID已锁定" : "不填则默认使用项目标题"}
                    disabled={Boolean(currentProject)}
                  />
                  <p className="text-xs text-muted-foreground">
                    规则：项目ID用于任务恢复与跨页关联，创建后保持不变；项目标题可随时调整。
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">关键词</Label>
                  <Textarea
                    id="keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="例如：AI 内容运营，创作者增长"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>时间范围</Label>
                  <Select value={timeWindow} onValueChange={setTimeWindow}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timeWindowOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>检索类型</Label>
                  <Select value={searchTool} onValueChange={(v) => setSearchTool(v as SearchTool)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WEB_SEARCH">网页检索</SelectItem>
                      <SelectItem value="NEWS_SEARCH">新闻检索</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleStartResearch}
                  disabled={isSearching || !keywords.trim() || !title.trim()}
                >
                  {isSearching ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
                  开始研究
                </Button>

                {isSearching ? <Progress value={progress} /> : null}
              </CardContent>
            </Card>

            {displayedInsight?.recommendedTitles?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4" />
                  推荐标题
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {displayedInsight.recommendedTitles.map((t) => (
                    <div key={t} className="rounded bg-muted px-2 py-1">
                      {t}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {providerRun ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">检索引擎执行</CardTitle>
                  <CardDescription>
                    主引擎：{providerRun.primaryProvider.toUpperCase()}，实际返回：{providerRun.provider.toUpperCase()}
                    {providerRun.fallbackUsed ? "（已回退）" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {providerRun.attempts.length === 0 ? (
                    <p className="text-muted-foreground">无引擎执行详情。</p>
                  ) : (
                    providerRun.attempts.map((attempt, idx) => (
                      <div key={`${attempt.provider}-${idx}`} className="rounded border p-2">
                        <p>
                          {attempt.provider.toUpperCase()} · {attempt.status === "success" ? "成功" : "失败"} ·{" "}
                          {attempt.durationMs}ms
                        </p>
                        {attempt.errorCode ? (
                          <p className="text-red-600">
                            {attempt.errorCode}
                            {attempt.errorMessage ? `: ${attempt.errorMessage}` : ""}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>研究结论</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{displayedInsight?.summary || "运行研究后会在这里生成总结。"}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>来源列表（{displayedSources.length}）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {displayedSources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂时没有来源数据。</p>
                ) : (
                  displayedSources.map((source) => (
                    <div key={source.id} className="rounded border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{source.title}</p>
                          <p className="text-xs text-muted-foreground">{source.publisher || "未知来源"}</p>
                        </div>
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-muted-foreground">
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                      {source.snippet ? <p className="mt-2 text-xs text-muted-foreground">{source.snippet}</p> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              {canGoDrafts ? (
                <Link href="/drafts">
                  <Button>继续到初稿</Button>
                </Link>
              ) : (
                <Button disabled>继续到初稿</Button>
              )}
            </div>
            {!canGoDrafts ? (
              <p className="text-right text-xs text-muted-foreground">请先完成研究并生成结论后再进入下一步。</p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
