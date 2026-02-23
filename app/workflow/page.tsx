"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronDown, ChevronUp, Loader2, PlayCircle } from "lucide-react"
import { toast } from "sonner"

import { Header } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { fetchTaskStatus } from "@/lib/task-client"
import { createRequestId } from "@/lib/utils"
import { useStore, type Platform } from "@/stores/project-store"

type StepStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED"

interface StepLog {
  step: string
  status: StepStatus
  retryCount: number
  durationMs?: number
  provider?: string
  errorCode?: string
  errorMessage?: string
}

interface WorkflowResponseData {
  taskId: string
  status: "COMPLETED" | "FAILED"
  failedStep?: string
  recoverable: boolean
  steps: StepLog[]
  bundle: Record<string, any>
}

interface PersistedWorkflowUi {
  projectId: string
  topic: string
  researchTool: "WEB_SEARCH" | "NEWS_SEARCH"
  timeWindow: string
  tone: string
  length: string
  generateAsset: boolean
  publishToWordpress: boolean
  showAdvanced: boolean
  lastTaskId?: string
  lastResult?: WorkflowResponseData | null
}

const UI_KEY = "contentpilot:workflow:ui:v5"
const SHOW_WORDPRESS_PUBLISH = false

function statusTone(status: StepStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "COMPLETED") return "default"
  if (status === "FAILED") return "destructive"
  if (status === "RUNNING") return "secondary"
  return "outline"
}

function parseKeywords(topic: string): string[] {
  return topic
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toIsoDate(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, any>
}

function toWorkflowResult(snapshot: Awaited<ReturnType<typeof fetchTaskStatus>>): WorkflowResponseData | null {
  if (!snapshot || snapshot.kind !== "workflow") return null
  const payload = asRecord(snapshot.payload)
  if (!payload) return null
  const steps = Array.isArray(payload.steps) ? (payload.steps as StepLog[]) : []
  const bundle = asRecord(payload.bundle) || {}
  return {
    taskId: snapshot.taskId,
    status: payload.status === "COMPLETED" ? "COMPLETED" : "FAILED",
    failedStep: payload.failedStep ? String(payload.failedStep) : undefined,
    recoverable: Boolean(payload.recoverable),
    steps,
    bundle,
  }
}

function WorkflowPageContent() {
  const searchParams = useSearchParams()
  const {
    projects,
    currentProjectId,
    setCurrentProject,
    addProject,
    updateProject,
    sources,
    insights,
    drafts,
    variants,
    assets,
    publishJobs,
    analytics,
    addSource,
    addInsight,
    addDraft,
    updateDraft,
    addVariant,
    updateVariant,
    addAsset,
    updateAsset,
    addPublishJob,
    addAnalytics,
    setWorkflowStep,
  } = useStore()

  const defaultProjectId = currentProjectId || projects[0]?.id || "demo-project"

  const [projectId, setProjectId] = React.useState(defaultProjectId)
  const [topic, setTopic] = React.useState("个人IP, 内容定位, 人设打造, 爆款选题, 商业化路径")
  const [researchTool, setResearchTool] = React.useState<"WEB_SEARCH" | "NEWS_SEARCH">("WEB_SEARCH")
  const [timeWindow, setTimeWindow] = React.useState("7d")
  const [tone, setTone] = React.useState("professional")
  const [length, setLength] = React.useState("medium")
  const [generateAsset, setGenerateAsset] = React.useState(false)
  const [publishToWordpress, setPublishToWordpress] = React.useState(false)
  const [showAdvanced, setShowAdvanced] = React.useState(false)

  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<WorkflowResponseData | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const autoResumeRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(UI_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedWorkflowUi
      if (parsed.projectId) setProjectId(parsed.projectId)
      if (parsed.topic) setTopic(parsed.topic)
      if (parsed.researchTool === "NEWS_SEARCH" || parsed.researchTool === "WEB_SEARCH") {
        setResearchTool(parsed.researchTool)
      }
      if (parsed.timeWindow) setTimeWindow(parsed.timeWindow)
      if (parsed.tone) setTone(parsed.tone)
      if (parsed.length) setLength(parsed.length)
      setGenerateAsset(parsed.generateAsset === true)
      setPublishToWordpress(parsed.publishToWordpress === true)
      setShowAdvanced(Boolean(parsed.showAdvanced))

      if (parsed.lastResult && typeof parsed.lastResult === "object") {
        setResult(parsed.lastResult)
      }

      if (parsed.lastTaskId) {
        void (async () => {
          const snapshot = await fetchTaskStatus(String(parsed.lastTaskId))
          const recovered = toWorkflowResult(snapshot)
          if (!recovered) return
          setResult(recovered)
        })()
      }
    } catch {
      // ignore invalid local cache
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    const payload: PersistedWorkflowUi = {
      projectId,
      topic,
      researchTool,
      timeWindow,
      tone,
      length,
      generateAsset,
      publishToWordpress,
      showAdvanced,
      lastTaskId: result?.taskId,
      lastResult: result,
    }
    localStorage.setItem(UI_KEY, JSON.stringify(payload))
  }, [
    generateAsset,
    length,
    mounted,
    projectId,
    publishToWordpress,
    researchTool,
    result,
    showAdvanced,
    timeWindow,
    tone,
    topic,
  ])

  React.useEffect(() => {
    if (!SHOW_WORDPRESS_PUBLISH && publishToWordpress) {
      setPublishToWordpress(false)
    }
  }, [publishToWordpress])

  const syncBundleToStore = React.useCallback(
    (bundle: Record<string, any>) => {
      const incomingProjectId = String(bundle.projectId || projectId || "").trim() || "demo-project"
      const incomingTopic = String(bundle.topic || topic || "").trim() || "未命名项目"
      const incomingWindow = String(bundle.timeWindow || timeWindow || "7d")

      const existingProject = projects.find((p) => p.id === incomingProjectId)
      let targetProjectId = incomingProjectId

      if (!existingProject) {
        const createdId = addProject({
          id: incomingProjectId,
          title: incomingTopic,
          topicKeywords: parseKeywords(incomingTopic),
          timeWindow: incomingWindow,
          status: "RESEARCHING",
        })
        targetProjectId = createdId
      } else {
        updateProject(existingProject.id, {
          title: incomingTopic,
          topicKeywords: parseKeywords(incomingTopic),
          timeWindow: incomingWindow,
          status: "RESEARCHING",
        })
      }

      setProjectId(targetProjectId)
      setCurrentProject(targetProjectId)

      const research = asRecord(bundle.research)
      if (research) {
        const sourceRows = Array.isArray(research.sources) ? research.sources : []
        const existingUrls = new Set(
          sources.filter((item) => item.projectId === targetProjectId).map((item) => item.url)
        )
        for (const row of sourceRows) {
          const record = asRecord(row)
          if (!record) continue
          const url = String(record.url || "").trim()
          if (!url || existingUrls.has(url)) continue
          addSource({
            projectId: targetProjectId,
            url,
            title: String(record.title || "Untitled"),
            publisher: record.publisher ? String(record.publisher) : undefined,
            snippet: record.snippet ? String(record.snippet) : undefined,
            publishedAt: record.publishedAt ? String(record.publishedAt) : undefined,
            credibilityScore: typeof record.score === "number" ? record.score : 0.6,
            provider: String(research.provider || "workflow"),
            lastSyncAt: new Date().toISOString(),
          })
          existingUrls.add(url)
        }

        const insight = asRecord(research.insight)
        if (insight) {
          const summary = String(insight.summary || "").trim()
          const exists = insights.find((item) => item.projectId === targetProjectId && item.summary === summary)
          if (!exists && summary) {
            addInsight({
              projectId: targetProjectId,
              summary,
              risks: Array.isArray(insight.risks) ? insight.risks.map((x: unknown) => String(x)) : [],
              angles: Array.isArray(insight.angles) ? insight.angles.map((x: unknown) => String(x)) : [],
              recommendedTitles: Array.isArray(insight.recommendedTitles)
                ? insight.recommendedTitles.map((x: unknown) => String(x))
                : [],
              provider: String(research.provider || "workflow"),
              lastSyncAt: new Date().toISOString(),
            })
          }
        }
      }

      const draft = asRecord(bundle.draft)
      let targetDraftId: string | null = null
      if (draft && typeof draft.content === "string" && draft.content.trim()) {
        const currentDraft =
          drafts.find((item) => item.projectId === targetProjectId && item.isCurrent) ||
          drafts.find((item) => item.projectId === targetProjectId)

        if (currentDraft) {
          updateDraft(currentDraft.id, {
            contentMd: draft.content,
            wordCount: draft.content.length,
            isCurrent: true,
            provider: "workflow",
            lastSyncAt: new Date().toISOString(),
          })
          targetDraftId = currentDraft.id
        } else {
          targetDraftId = addDraft({
            projectId: targetProjectId,
            versionNo: drafts.filter((item) => item.projectId === targetProjectId).length + 1,
            contentMd: draft.content,
            wordCount: draft.content.length,
            citations: [],
            isCurrent: true,
            provider: "workflow",
            lastSyncAt: new Date().toISOString(),
          })
        }
      }

      const rewrite = asRecord(bundle.rewrite)
      if (rewrite && targetDraftId) {
        const variantRows = asRecord(rewrite.variants) || {}
        for (const [platformKey, raw] of Object.entries(variantRows)) {
          const row = asRecord(raw)
          if (!row) continue
          const platform = platformKey as Platform
          const body = String(row.body || "")
          if (!body) continue

          const existingVariant = variants.find(
            (item) => item.draftId === targetDraftId && item.platform === platform
          )
          const payload = {
            titleCandidates: Array.isArray(row.titleCandidates)
              ? row.titleCandidates.map((x: unknown) => String(x))
              : [],
            body,
            hashtags: Array.isArray(row.hashtags) ? row.hashtags.map((x: unknown) => String(x)) : [],
            coverCopy: row.coverCopy ? String(row.coverCopy) : undefined,
            provider: "workflow",
            lastSyncAt: new Date().toISOString(),
          }

          if (existingVariant) {
            updateVariant(existingVariant.id, payload)
          } else {
            addVariant({
              draftId: targetDraftId,
              platform,
              ...payload,
            })
          }
        }
      }

      const asset = asRecord(bundle.assets)
      if (asset && typeof asset.imageUrl === "string" && asset.imageUrl.trim()) {
        const imageUrl = asset.imageUrl.trim()
        const existingAsset = assets.find(
          (item) => item.projectId === targetProjectId && item.imageUrl === imageUrl
        )
        if (existingAsset) {
          updateAsset(existingAsset.id, {
            status: "COMPLETED",
            provider: String(asset.provider || "workflow"),
            lastSyncAt: new Date().toISOString(),
          })
        } else {
          addAsset({
            projectId: targetProjectId,
            prompt: "workflow-generated",
            imageUrl,
            status: "COMPLETED",
            linkedVariantIds: [],
            provider: String(asset.provider || "workflow"),
            lastSyncAt: new Date().toISOString(),
          })
        }
      }

      const publish = asRecord(bundle.publish)
      if (publish && publish.status && publish.status !== "skipped") {
        const remotePostId = publish.postId ? String(publish.postId) : undefined
        const existingJob = publishJobs.find(
          (job) =>
            job.projectId === targetProjectId &&
            (remotePostId ? String(job.remotePostId || "") === remotePostId : false)
        )
        if (!existingJob) {
          addPublishJob({
            projectId: targetProjectId,
            target: "WORDPRESS",
            status: "COMPLETED",
            retryCount: 0,
            remotePostId,
            remoteLink: publish.editUrl ? String(publish.editUrl) : undefined,
            provider: publish.mode === "mock" ? "wordpress-mock" : "wordpress-live",
            lastSyncAt: new Date().toISOString(),
          })
        }
      }

      const analyticsSummary = asRecord(bundle.analytics)
      if (analyticsSummary) {
        const date = toIsoDate(analyticsSummary.generatedAt ? String(analyticsSummary.generatedAt) : undefined)
        const hasSameDate = analytics.some((item) => item.date === date)
        if (!hasSameDate) {
          addAnalytics({
            date,
            projectsCount: Number(analyticsSummary.projectsCount || 0),
            draftsCount: Number(analyticsSummary.draftsCount || 0),
            publishSuccessRate: Number(analyticsSummary.publishSuccessRate || 0),
            avgCycleMinutes: Number(analyticsSummary.avgCycleMinutes || 0),
          })
        }
      }

      updateProject(targetProjectId, { status: "COMPLETED" })
      setWorkflowStep("publish")
      toast.success("结果已同步到研究/初稿/改写/发布页面")
    },
    [
      addAnalytics,
      addAsset,
      addDraft,
      addInsight,
      addProject,
      addPublishJob,
      addSource,
      addVariant,
      analytics,
      assets,
      drafts,
      insights,
      projectId,
      projects,
      publishJobs,
      setCurrentProject,
      setWorkflowStep,
      sources,
      timeWindow,
      topic,
      updateAsset,
      updateDraft,
      updateProject,
      updateVariant,
      variants,
    ]
  )

  const runWorkflow = React.useCallback(
    async (input?: { resumeTaskId?: string }) => {
      if (!input?.resumeTaskId && (!projectId.trim() || !topic.trim())) {
        toast.error("请先填写项目ID和主题关键词")
        return
      }

      setRunning(true)
      try {
        const traceId = createRequestId("trace")
        const idempotencyKey = createRequestId("wf")
        const response = await fetch("/api/workflow/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-trace-id": traceId,
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            projectId,
            topic,
            researchTool,
            timeWindow,
            tone,
            audience: "创作者",
            length,
            generateAsset,
            publishToWordpress: SHOW_WORDPRESS_PUBLISH ? publishToWordpress : false,
            resumeTaskId: input?.resumeTaskId,
            traceId,
            idempotencyKey,
          }),
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload?.ok || !payload?.data) {
          const message = payload?.error?.message || "workflow run failed"
          throw new Error(message)
        }

        const data = payload.data as WorkflowResponseData
        setResult(data)
        syncBundleToStore(data.bundle || {})

        if (data.status === "FAILED") {
          toast.error(`流程失败：${data.failedStep || "unknown step"}`)
        } else {
          toast.success("主流程执行完成")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "workflow run failed")
      } finally {
        setRunning(false)
      }
    },
    [
      generateAsset,
      length,
      projectId,
      publishToWordpress,
      researchTool,
      syncBundleToStore,
      timeWindow,
      tone,
      topic,
    ]
  )

  React.useEffect(() => {
    if (!searchParams) return
    const projectIdFromQuery = String(searchParams.get("projectId") || "").trim()
    if (projectIdFromQuery) {
      setProjectId(projectIdFromQuery)
      const matched = projects.find((item) => item.id === projectIdFromQuery)
      if (matched) {
        setCurrentProject(projectIdFromQuery)
        if (!topic.trim()) {
          setTopic(matched.topicKeywords.length ? matched.topicKeywords.join(", ") : matched.title)
        }
      }
    }
  }, [projects, searchParams, setCurrentProject, topic])

  React.useEffect(() => {
    if (!searchParams) return
    const resumeTaskIdFromQuery = String(searchParams.get("resumeTaskId") || "").trim()
    if (!resumeTaskIdFromQuery) return
    if (autoResumeRef.current === resumeTaskIdFromQuery) return
    autoResumeRef.current = resumeTaskIdFromQuery
    void runWorkflow({ resumeTaskId: resumeTaskIdFromQuery })
  }, [runWorkflow, searchParams])

  const summary = asRecord(result?.bundle?.finalOutput)
  const research = asRecord(result?.bundle?.research)
  const draft = asRecord(result?.bundle?.draft)
  const rewrite = asRecord(result?.bundle?.rewrite)
  const publish = asRecord(result?.bundle?.publish)

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="总流程控制" />

      <main className="flex-1 space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>新手模式（推荐）</CardTitle>
            <CardDescription>先填 3 个必填项，其他保持默认即可。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="projectId">项目 ID（必填）</Label>
              <Input
                id="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="仅输入当前要运行的项目 ID"
              />
              <p className="text-xs text-muted-foreground">历史项目恢复与删除，请在「项目管理」页统一处理。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">主题关键词（必填）</Label>
              <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>研究来源（必填）</Label>
              <Select
                value={researchTool}
                onValueChange={(value) => setResearchTool(value as "WEB_SEARCH" | "NEWS_SEARCH")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEB_SEARCH">网页检索（通用）</SelectItem>
                  <SelectItem value="NEWS_SEARCH">新闻检索（时效）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                网页检索覆盖面更广；新闻检索更偏近期事件与媒体报道。
              </p>
            </div>

            <div className="space-y-2">
              <Label>时间窗口（必填）</Label>
              <Select value={timeWindow} onValueChange={setTimeWindow}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">最近24小时</SelectItem>
                  <SelectItem value="7d">最近7天</SelectItem>
                  <SelectItem value="30d">最近30天</SelectItem>
                  <SelectItem value="all">不限时间</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 flex items-center justify-between rounded border p-2">
              <div>
                <p className="text-sm font-medium">高级选项</p>
                <p className="text-xs text-muted-foreground">语气、篇幅、生成素材</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowAdvanced((prev) => !prev)}>
                {showAdvanced ? <ChevronUp className="mr-1 size-4" /> : <ChevronDown className="mr-1 size-4" />}
                {showAdvanced ? "收起" : "展开"}
              </Button>
            </div>

            {showAdvanced ? (
              <>
                <div className="space-y-2">
                  <Label>语气风格</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">专业</SelectItem>
                      <SelectItem value="casual">轻松</SelectItem>
                      <SelectItem value="storytelling">叙事</SelectItem>
                      <SelectItem value="analytical">分析</SelectItem>
                      <SelectItem value="tutorial">教程</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>篇幅</Label>
                  <Select value={length} onValueChange={setLength}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">短</SelectItem>
                      <SelectItem value="medium">中</SelectItem>
                      <SelectItem value="long">长</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded border p-2">
                    <Label htmlFor="assetSwitch">生成素材图</Label>
                    <Switch id="assetSwitch" checked={generateAsset} onCheckedChange={setGenerateAsset} />
                  </div>
                  {SHOW_WORDPRESS_PUBLISH ? (
                    <div className="flex items-center justify-between rounded border p-2">
                      <Label htmlFor="publishSwitch">推送到 WordPress 草稿</Label>
                      <Switch id="publishSwitch" checked={publishToWordpress} onCheckedChange={setPublishToWordpress} />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="md:col-span-2 grid gap-3 lg:grid-cols-2">
              <div className="rounded border p-3 space-y-2">
                <p className="text-sm font-medium">主流程执行</p>
                <Button className="w-full" onClick={() => runWorkflow()} disabled={running || !projectId || !topic}>
                  {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlayCircle className="mr-2 size-4" />}
                  运行主链并同步到各页面
                </Button>
                <p className="text-xs text-muted-foreground">建议先运行主链，再去各模块页检查结果。</p>
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-sm font-medium">项目管理</p>
                <p className="text-xs text-muted-foreground">
                  历史项目、恢复任务、删除项目已迁移到独立页面，避免与主流程执行混在一起。
                </p>
                <Link href="/projects">
                  <Button variant="outline" className="w-full">打开项目管理页</Button>
                </Link>
              </div>

              <div className="lg:col-span-2 flex flex-wrap gap-2">
                <Link href="/showcase">
                  <Button size="sm" variant="secondary">查看价值展示页</Button>
                </Link>
                <Link href="/projects">
                  <Button size="sm" variant="secondary">查看项目管理页</Button>
                </Link>
                <Link href="/research">
                  <Button size="sm" variant="secondary">查看研究页</Button>
                </Link>
                <Link href="/drafts">
                  <Button size="sm" variant="secondary">查看初稿页</Button>
                </Link>
                <Link href="/rewrite">
                  <Button size="sm" variant="secondary">查看改写页</Button>
                </Link>
                <Link href="/publish">
                  <Button size="sm" variant="secondary">查看发布页</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>步骤时间线</CardTitle>
            <CardDescription>
              {result
                ? `任务 ${result.taskId} · 状态 ${result.status}${result.failedStep ? ` · 失败于 ${result.failedStep}` : ""}`
                : "运行后会在这里展示每一步状态，刷新后会自动恢复最近结果。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {result?.steps?.length ? (
              result.steps.map((step) => (
                <div key={step.step} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
                  <Badge variant={statusTone(step.status)}>{step.status}</Badge>
                  <span className="font-medium">{step.step}</span>
                  {step.provider ? <span className="text-muted-foreground">provider: {step.provider}</span> : null}
                  {typeof step.durationMs === "number" ? (
                    <span className="text-muted-foreground">{step.durationMs}ms</span>
                  ) : null}
                  {step.errorMessage ? <span className="text-red-600">{step.errorMessage}</span> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">暂无时间线数据。</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>最终汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {summary ? (
                <>
                  <p>摘要：{String(summary.summary || "")}</p>
                  <p>标题候选：{Array.isArray(summary.titleCandidates) ? summary.titleCandidates.length : 0} 个</p>
                  <p>平台稿件：{Number(summary.platformCount || 0)}</p>
                  <p>素材图：{summary.hasAsset ? "已生成" : "未生成"}</p>
                  <p>发布状态：{String(summary.publishStatus || "not_published")}</p>
                </>
              ) : (
                <p className="text-muted-foreground">运行后显示汇总结果。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>关键输出预览</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {research?.insight ? <p>研究结论：{String(asRecord(research.insight)?.summary || "")}</p> : null}
              {typeof draft?.content === "string" ? <p>初稿片段：{draft.content.slice(0, 180)}...</p> : null}
              {rewrite?.variants ? <p>改写平台：{Object.keys(asRecord(rewrite.variants) || {}).join(", ") || "无"}</p> : null}
              {publish ? (
                <p>
                  发布：{String(publish.status || "unknown")}
                  {publish.postId ? ` / postId=${String(publish.postId)}` : ""}
                </p>
              ) : null}

              {!research?.insight && typeof draft?.content !== "string" && !rewrite?.variants && !publish ? (
                <p className="text-muted-foreground">暂无预览数据。</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

export default function WorkflowPage() {
  return (
    <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载总流程控制页...</div>}>
      <WorkflowPageContent />
    </React.Suspense>
  )
}
