"use client"

import * as React from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Header, WorkflowSteps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useStore, type PublishTarget } from "@/stores/project-store"

const exportFormats: Array<{ value: PublishTarget; label: string }> = [
  { value: "EXPORT_MD", label: "Markdown 文档" },
  { value: "EXPORT_HTML", label: "HTML" },
  { value: "EXPORT_JSON", label: "JSON" },
  { value: "EXPORT_ZIP", label: "发布包（ZIP）" },
]

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" })
}

export default function PublishPage() {
  const { projects, currentProjectId, drafts, variants, publishJobs, addPublishJob } = useStore()

  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) : projects[0]
  const currentDraft = currentProject
    ? drafts.find((d) => d.projectId === currentProject.id && d.isCurrent) ||
      drafts.find((d) => d.projectId === currentProject.id)
    : undefined
  const draftVariants = currentDraft ? variants.filter((v) => v.draftId === currentDraft.id) : []
  const [selectedVariant, setSelectedVariant] = React.useState<string>("draft-original")
  const [isExporting, setIsExporting] = React.useState(false)

  const selectedVariantData =
    selectedVariant === "draft-original"
      ? undefined
      : draftVariants.find((variant) => variant.id === selectedVariant)
  const resolvedVariantId = selectedVariant === "draft-original" ? undefined : selectedVariant
  const projectJobs = currentProject ? publishJobs.filter((j) => j.projectId === currentProject.id) : []

  const handleExport = async (format: PublishTarget) => {
    if (!currentDraft || !currentProject) {
      toast.error("当前没有可导出的内容")
      return
    }

    setIsExporting(true)
    try {
      const resp = await fetch("/api/export/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          variantId: resolvedVariantId,
          format,
          payload: {
            projectId: currentProject.id,
            variantId: resolvedVariantId,
            title: selectedVariantData?.titleCandidates?.[0] || currentProject.title,
            platform: selectedVariantData?.platform || "初稿",
            content: selectedVariantData?.body || currentDraft.contentMd,
            hashtags: selectedVariantData?.hashtags || [],
          },
        }),
      })

      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || "导出失败")
      }

      const data = payload?.data || {}
      if (!data?.contentBase64) {
        throw new Error("导出内容为空")
      }

      const blob = base64ToBlob(String(data.contentBase64), String(data.mimeType || "application/octet-stream"))
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = String(data.filename || `contentpilot-${Date.now()}`)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      addPublishJob({
        projectId: currentProject.id,
        variantId: resolvedVariantId,
        target: format,
        status: "COMPLETED",
        retryCount: 0,
        provider: "local-export",
        lastSyncAt: new Date().toISOString(),
      })

      toast.success("导出成功")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="导出结果" />

      <main className="flex-1 space-y-6 p-6">
        <WorkflowSteps />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>导出内容</CardTitle>
              <CardDescription>选择版本并导出为本地文件。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">选择版本</p>
                <Select value={selectedVariant} onValueChange={setSelectedVariant}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择版本" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft-original">原始初稿</SelectItem>
                    {draftVariants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.platform}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {exportFormats.map((f) => (
                  <Button
                    key={f.value}
                    variant="outline"
                    className="justify-start"
                    onClick={() => handleExport(f.value)}
                    disabled={isExporting || !currentDraft}
                  >
                    {isExporting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
                    {f.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>导出历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {projectJobs.length === 0 ? (
                <p className="text-muted-foreground">暂无导出记录。</p>
              ) : (
                projectJobs.slice(0, 8).map((job) => (
                  <div key={job.id} className="rounded border p-2">
                    <p className="font-medium">{job.target}</p>
                    <p className="text-xs text-muted-foreground">{job.status}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
