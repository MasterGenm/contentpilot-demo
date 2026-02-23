"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, Save, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Header, WorkflowSteps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { fetchTaskStatus, isTerminalTaskStatus } from "@/lib/task-client"
import { createRequestId } from "@/lib/utils"
import { useStore } from "@/stores/project-store"

export default function DraftsPage() {
  const {
    projects,
    currentProjectId,
    sources,
    insights,
    drafts,
    addDraft,
    updateDraft,
    updateProject,
    setSetting,
    getSetting,
    setWorkflowStep,
  } = useStore()

  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) : projects[0]
  const projectSources = currentProject ? sources.filter((s) => s.projectId === currentProject.id) : []
  const projectInsight = currentProject ? insights.find((i) => i.projectId === currentProject.id) : undefined
  const projectDrafts = currentProject ? drafts.filter((d) => d.projectId === currentProject.id) : []
  const currentDraft = projectDrafts.find((d) => d.isCurrent) || projectDrafts[0]

  const [tone, setTone] = React.useState("professional")
  const [length, setLength] = React.useState("medium")
  const [content, setContent] = React.useState(currentDraft?.contentMd || "")
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const canGenerateDraft = Boolean(currentProject && projectInsight && projectSources.length > 0)
  const canGoRewrite = Boolean(currentDraft && content.trim().length > 0)
  const recoveringTaskRef = React.useRef<string | null>(null)

  const draftTaskKey = currentProject ? `task:draft:${currentProject.id}` : ""

  React.useEffect(() => {
    if (!currentProject || !draftTaskKey) return
    if (isGenerating) return
    const taskId = getSetting(draftTaskKey)
    if (!taskId || taskId.trim().length === 0) return
    if (recoveringTaskRef.current === taskId) return

    recoveringTaskRef.current = taskId
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const snapshot = await fetchTaskStatus(taskId)
      if (!snapshot || cancelled) return

      setIsGenerating(!isTerminalTaskStatus(snapshot.status))

      if (snapshot.status === "COMPLETED") {
        const payload = snapshot.payload || {}
        const recoveredContent = String(payload.content || "")
        if (recoveredContent) {
          projectDrafts.forEach((d) => {
            if (d.isCurrent) updateDraft(d.id, { isCurrent: false })
          })

          const existing = projectDrafts.find((d) => d.taskId === taskId)
          if (existing) {
            updateDraft(existing.id, {
              contentMd: recoveredContent,
              wordCount: recoveredContent.length,
              isCurrent: true,
              provider: snapshot.provider || "llm",
              lastSyncAt: new Date().toISOString(),
            })
          } else {
            addDraft({
              projectId: currentProject.id,
              versionNo: projectDrafts.length + 1,
              contentMd: recoveredContent,
              wordCount: recoveredContent.length,
              citations: projectSources.slice(0, 6).map((s) => s.url),
              isCurrent: true,
              provider: snapshot.provider || "llm",
              taskId,
              lastSyncAt: new Date().toISOString(),
            })
          }

          setContent(recoveredContent)
          updateProject(currentProject.id, { status: "REWRITING" })
          setWorkflowStep("rewrite")
          toast.success("已恢复初稿任务结果")
        }
        setSetting(draftTaskKey, "")
        setIsGenerating(false)
        return
      }

      if (snapshot.status === "FAILED") {
        setSetting(draftTaskKey, "")
        setIsGenerating(false)
        toast.error(snapshot.error?.message || "初稿任务失败")
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
    addDraft,
    currentProject,
    draftTaskKey,
    getSetting,
    isGenerating,
    projectDrafts,
    projectSources,
    setSetting,
    setWorkflowStep,
    updateDraft,
    updateProject,
  ])

  React.useEffect(() => {
    if (currentDraft?.contentMd) {
      setContent(currentDraft.contentMd)
    }
  }, [currentDraft?.id])

  const handleSave = () => {
    if (!currentProject) {
      toast.error("请先从选题研究开始")
      return
    }

    setIsSaving(true)
    try {
      if (currentDraft) {
        updateDraft(currentDraft.id, {
          contentMd: content,
          wordCount: content.length,
          lastSyncAt: new Date().toISOString(),
        })
      } else {
        addDraft({
          projectId: currentProject.id,
          versionNo: 1,
          contentMd: content,
          wordCount: content.length,
          citations: [],
          isCurrent: true,
          provider: "manual",
          lastSyncAt: new Date().toISOString(),
        })
      }
      toast.success("草稿已保存")
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerate = async () => {
    if (!currentProject) {
      toast.error("请先创建并完成研究项目")
      return
    }
    if (!canGenerateDraft) {
      toast.error("请先在选题研究页生成来源与研究结论")
      return
    }

    setIsGenerating(true)
    try {
      const traceId = createRequestId("trace")
      const idempotencyKey = createRequestId("idem")
      if (draftTaskKey) {
        setSetting(draftTaskKey, idempotencyKey)
      }

      const resp = await fetch("/api/draft/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": traceId },
        body: JSON.stringify({
          projectId: currentProject.id,
          topic: currentProject.title,
          tone,
          length,
          audience: "media team",
          researchSummary: projectInsight?.summary || "",
          sources: projectSources.map((s) => ({ title: s.title, url: s.url, publisher: s.publisher })),
          traceId,
          idempotencyKey,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error("初稿生成失败")

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let out = ""
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
          if (evt.type === "content") {
            out += evt.text
            setContent(out)
          }
          if (evt.type === "error") {
            throw new Error(evt.message || "初稿生成失败")
          }
        }
      }

      projectDrafts.forEach((d) => {
        if (d.isCurrent) updateDraft(d.id, { isCurrent: false })
      })

      addDraft({
        projectId: currentProject.id,
        versionNo: projectDrafts.length + 1,
        contentMd: out,
        wordCount: out.length,
        citations: projectSources.slice(0, 6).map((s) => s.url),
        isCurrent: true,
        provider: "llm",
        taskId: idempotencyKey,
        lastSyncAt: new Date().toISOString(),
      })
      if (draftTaskKey) {
        setSetting(draftTaskKey, "")
      }

      updateProject(currentProject.id, { status: "REWRITING" })
      setWorkflowStep("rewrite")
      toast.success("初稿生成完成")
    } catch (error) {
      if (draftTaskKey) {
        setSetting(draftTaskKey, "")
      }
      toast.error(error instanceof Error ? error.message : "初稿生成失败")
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="文章初稿">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Save className="mr-1 size-4" />}
            保存
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating || !canGenerateDraft}>
            {isGenerating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Wand2 className="mr-1 size-4" />}
            生成初稿
          </Button>
        </div>
      </Header>

      <main className="flex-1 p-6">
        <WorkflowSteps />
        <div className="h-4" />

        <div className="grid gap-6 lg:grid-cols-4">
          <div className="lg:col-span-3 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">编辑器</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
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
                </div>

                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={24}
                  className="font-mono text-sm"
                  placeholder="生成后的 Markdown 初稿会显示在这里。"
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">当前项目</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium">{currentProject?.title || "未选择项目"}</p>
                <p className="mt-2 text-xs text-muted-foreground">字数：{content.length}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">版本历史</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {projectDrafts.length === 0 ? (
                  <p className="text-muted-foreground">暂无草稿版本。</p>
                ) : (
                  projectDrafts.map((d) => (
                    <div key={d.id} className="rounded border px-2 py-1">
                      v{d.versionNo} - {d.wordCount} 字 {d.isCurrent ? "（当前）" : ""}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {canGoRewrite ? (
              <Link href="/rewrite" className="block">
                <Button className="w-full">继续到改写</Button>
              </Link>
            ) : (
              <Button className="w-full" disabled>
                继续到改写
              </Button>
            )}
            {!canGoRewrite ? (
              <p className="text-xs text-muted-foreground">请先生成或保存一版初稿再进入改写。</p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
