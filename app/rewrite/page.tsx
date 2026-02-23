"use client"

import * as React from "react"
import Link from "next/link"
import { AtSign, Copy, FileText, Loader2, MessageSquare, Tv, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Header, WorkflowSteps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { fetchTaskStatus, isTerminalTaskStatus } from "@/lib/task-client"
import { createRequestId } from "@/lib/utils"
import { useStore, type Platform } from "@/stores/project-store"

const platforms: { id: Platform; label: string; icon: typeof FileText }[] = [
  { id: "WECHAT", label: "公众号", icon: FileText },
  { id: "XIAOHONGSHU", label: "小红书", icon: MessageSquare },
  { id: "WEIBO", label: "微博", icon: AtSign },
  { id: "BILIBILI", label: "B站", icon: Tv },
]

export default function RewritePage() {
  const {
    projects,
    currentProjectId,
    drafts,
    variants,
    addVariant,
    updateVariant,
    setWorkflowStep,
    getSetting,
    setSetting,
  } = useStore()

  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) : projects[0]
  const currentDraft = currentProject
    ? drafts.find((d) => d.projectId === currentProject.id && d.isCurrent) || drafts.find((d) => d.projectId === currentProject.id)
    : undefined

  const existingVariants = currentDraft ? variants.filter((v) => v.draftId === currentDraft.id) : []
  const canGoPublish = existingVariants.length > 0

  const [activeTab, setActiveTab] = React.useState<Platform>("WECHAT")
  const [isGenerating, setIsGenerating] = React.useState(false)
  const recoveringTaskRef = React.useRef<string | null>(null)
  const [contents, setContents] = React.useState<Record<Platform, string>>({
    WECHAT: existingVariants.find((v) => v.platform === "WECHAT")?.body || "",
    XIAOHONGSHU: existingVariants.find((v) => v.platform === "XIAOHONGSHU")?.body || "",
    WEIBO: existingVariants.find((v) => v.platform === "WEIBO")?.body || "",
    BILIBILI: existingVariants.find((v) => v.platform === "BILIBILI")?.body || "",
  })

  React.useEffect(() => {
    if (!currentDraft) return
    const next = { ...contents }
    for (const v of existingVariants) {
      next[v.platform] = v.body
    }
    setContents(next)
  }, [existingVariants.map((v) => v.id).join(",")])

  const rewriteTaskKey = currentDraft ? `task:rewrite:${currentDraft.id}` : ""

  React.useEffect(() => {
    if (!currentDraft || !rewriteTaskKey) return
    if (isGenerating) return
    const taskId = getSetting(rewriteTaskKey)
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
        const recoveredVariants =
          payload.variants && typeof payload.variants === "object"
            ? (payload.variants as Record<string, any>)
            : {}

        for (const p of platforms) {
          const row = recoveredVariants[p.id]
          if (!row) continue
          const existing = existingVariants.find((v) => v.platform === p.id)
          const variantPayload = {
            body: String(row.body || ""),
            titleCandidates: Array.isArray(row.titleCandidates) ? row.titleCandidates.map((x: unknown) => String(x)) : [],
            hashtags: Array.isArray(row.hashtags) ? row.hashtags.map((x: unknown) => String(x)) : [],
            provider: snapshot.provider || "llm",
            taskId,
            lastSyncAt: new Date().toISOString(),
          }

          if (existing) {
            updateVariant(existing.id, variantPayload)
          } else {
            addVariant({
              draftId: currentDraft.id,
              platform: p.id,
              ...variantPayload,
            })
          }
          setContents((prev) => ({ ...prev, [p.id]: variantPayload.body }))
        }

        setSetting(rewriteTaskKey, "")
        setWorkflowStep("publish")
        setIsGenerating(false)
        toast.success("已恢复改写任务结果")
        return
      }

      if (snapshot.status === "FAILED") {
        setSetting(rewriteTaskKey, "")
        setIsGenerating(false)
        toast.error(snapshot.error?.message || "改写任务失败")
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
    addVariant,
    currentDraft,
    existingVariants,
    getSetting,
    isGenerating,
    rewriteTaskKey,
    setSetting,
    setWorkflowStep,
    updateVariant,
  ])

  const handleGenerate = async () => {
    if (!currentDraft) {
      toast.error("请先生成初稿")
      return
    }

    setIsGenerating(true)
    try {
      const traceId = createRequestId("trace")
      const idempotencyKey = createRequestId("idem")
      if (rewriteTaskKey) {
        setSetting(rewriteTaskKey, idempotencyKey)
      }
      const resp = await fetch("/api/rewrite/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": traceId },
        body: JSON.stringify({
          projectId: currentProject?.id,
          draftId: currentDraft.id,
          draftContent: currentDraft.contentMd,
          topic: currentProject?.title,
          platforms: platforms.map((p) => p.id),
          traceId,
          idempotencyKey,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error("改写生成失败")
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
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
          if (evt.type === "variant") {
            const platform = evt.platform as Platform
            const existing = existingVariants.find((v) => v.platform === platform)
            const payload = {
              body: evt.body || "",
              titleCandidates: evt.titleCandidates || [],
              hashtags: evt.hashtags || [],
              provider: "llm",
              taskId: idempotencyKey,
              lastSyncAt: new Date().toISOString(),
            }

            if (existing) {
              updateVariant(existing.id, payload)
            } else {
              addVariant({
                draftId: currentDraft.id,
                platform,
                ...payload,
              })
            }

            setContents((prev) => ({ ...prev, [platform]: evt.body || "" }))
          }
          if (evt.type === "error") {
            // Platform-level errors can be recoverable because API may already emit fallback variant.
            if (evt.platform) {
              toast.warning(`${evt.platform} 改写失败，已使用兜底内容`)
              continue
            }
            throw new Error(evt.message || "改写失败")
          }
        }
      }
      if (rewriteTaskKey) {
        setSetting(rewriteTaskKey, "")
      }

      setWorkflowStep("publish")
      toast.success("多平台改写完成")
    } catch (error) {
      if (rewriteTaskKey) {
        setSetting(rewriteTaskKey, "")
      }
      toast.error(error instanceof Error ? error.message : "改写失败")
    } finally {
      setIsGenerating(false)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="多平台改写">
        <Button onClick={handleGenerate} disabled={isGenerating || !currentDraft} size="sm">
          {isGenerating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Wand2 className="mr-1 size-4" />}
          一键生成4平台版本
        </Button>
      </Header>

      <main className="flex-1 p-6">
        <WorkflowSteps />
        <div className="h-4" />

        {!currentDraft ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              未找到初稿，请先到“文章初稿”页面生成内容。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">来源初稿</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground">{currentDraft.contentMd}</p>
              </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Platform)}>
              <TabsList className="grid w-full grid-cols-4">
                {platforms.map((p) => (
                  <TabsTrigger value={p.id} key={p.id}>
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {platforms.map((p) => {
                const variant = existingVariants.find((v) => v.platform === p.id)
                return (
                  <TabsContent value={p.id} key={p.id}>
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{p.label}</CardTitle>
                          <Button variant="outline" size="sm" onClick={() => copyText(contents[p.id] || "")}> 
                            <Copy className="mr-1 size-4" />
                            复制
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {variant?.titleCandidates?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {variant.titleCandidates.map((t) => (
                              <Badge key={t} variant="secondary">{t}</Badge>
                            ))}
                          </div>
                        ) : null}

                        <Textarea
                          rows={14}
                          value={contents[p.id] || ""}
                          onChange={(e) => {
                            const next = e.target.value
                            setContents((prev) => ({ ...prev, [p.id]: next }))
                            if (variant) {
                              updateVariant(variant.id, { body: next, lastSyncAt: new Date().toISOString() })
                            }
                          }}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                )
              })}
            </Tabs>

            <div className="flex justify-end">
              {canGoPublish ? (
                <Link href="/publish">
                  <Button>继续到导出</Button>
                </Link>
              ) : (
                <Button disabled>继续到导出</Button>
              )}
            </div>
            {!canGoPublish ? (
              <p className="text-right text-xs text-muted-foreground">请先生成至少一个平台版本后再进入导出页。</p>
            ) : null}
          </div>
        )}
      </main>
    </div>
  )
}
