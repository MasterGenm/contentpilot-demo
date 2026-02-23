"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2 } from "lucide-react"

import { Header, WorkflowSteps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useStore } from "@/stores/project-store"

export default function DashboardPage() {
  const { currentProjectId, projects, canProceed } = useStore()
  const pid = currentProjectId || projects[0]?.id || null
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const canGoDrafts = mounted ? canProceed("drafts", pid) : false
  const canGoRewrite = mounted ? canProceed("rewrite", pid) : false
  const canGoPublish = mounted ? canProceed("publish", pid) : false

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="单链路 Demo" />

      <main className="flex-1 space-y-6 p-6">
        <WorkflowSteps />

        <Card>
          <CardHeader>
            <CardTitle>唯一主流程</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>研究 - 初稿 - 改写 - 导出。</p>
            <p>当前版本只保留这条链路，其它功能入口已隐藏。</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>开始运行</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/research" className="block">
              <Button variant="outline" className="w-full justify-between">
                1. 选题研究 <ArrowRight className="size-4" />
              </Button>
            </Link>

            {canGoDrafts ? (
              <Link href="/drafts" className="block">
                <Button variant="outline" className="w-full justify-between">
                  2. 生成初稿 <ArrowRight className="size-4" />
                </Button>
              </Link>
            ) : (
              <Button variant="outline" className="w-full justify-between" disabled>
                2. 生成初稿 <ArrowRight className="size-4" />
              </Button>
            )}

            {canGoRewrite ? (
              <Link href="/rewrite" className="block">
                <Button variant="outline" className="w-full justify-between">
                  3. 多平台改写 <ArrowRight className="size-4" />
                </Button>
              </Link>
            ) : (
              <Button variant="outline" className="w-full justify-between" disabled>
                3. 多平台改写 <ArrowRight className="size-4" />
              </Button>
            )}

            {canGoPublish ? (
              <Link href="/publish" className="block">
                <Button className="w-full justify-between">
                  4. 导出结果 <CheckCircle2 className="size-4" />
                </Button>
              </Link>
            ) : (
              <Button className="w-full justify-between" disabled>
                4. 导出结果 <CheckCircle2 className="size-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
