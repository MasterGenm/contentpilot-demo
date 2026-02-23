"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CheckCircle2, Circle } from "lucide-react"

import { cn } from "@/lib/utils"
import { useStore, type WorkflowStep } from "@/stores/project-store"

const flow: Array<{ step: WorkflowStep; href: string; label: string }> = [
  { step: "research", href: "/research", label: "研究" },
  { step: "drafts", href: "/drafts", label: "初稿" },
  { step: "rewrite", href: "/rewrite", label: "改写" },
  { step: "publish", href: "/publish", label: "导出" },
]

export function WorkflowSteps() {
  const pathname = usePathname()
  const { workflowStep, canProceed } = useStore()
  const safePathname = pathname || "/"
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const safeWorkflowStep: WorkflowStep = mounted ? workflowStep : "research"
  const activeIndex = flow.findIndex((item) => safePathname.startsWith(item.href))
  const currentIndex = flow.findIndex((item) => item.step === safeWorkflowStep)

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {flow.map((item, index) => {
          const reached = index <= currentIndex
          const active = index === activeIndex
          const allowed = mounted ? canProceed(item.step) : false

          return (
            <Link
              key={item.step}
              href={allowed ? item.href : safePathname}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                !allowed && "cursor-not-allowed opacity-60"
              )}
              aria-disabled={!allowed}
            >
              {reached ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
