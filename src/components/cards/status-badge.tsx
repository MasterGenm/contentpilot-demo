import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { AssetStatus, ProjectStatus, TaskStatus } from "@/stores/project-store"

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "草稿", variant: "secondary" },
  RESEARCHING: { label: "研究中", variant: "default" },
  DRAFTING: { label: "写作中", variant: "default" },
  REWRITING: { label: "改写中", variant: "default" },
  PUBLISHING: { label: "发布中", variant: "default" },
  COMPLETED: { label: "已完成", variant: "outline" },
  ARCHIVED: { label: "已归档", variant: "secondary" },

  PENDING: { label: "等待中", variant: "secondary" },
  RUNNING: { label: "运行中", variant: "default" },
  FAILED: { label: "失败", variant: "destructive" },
  CANCELLED: { label: "已取消", variant: "secondary" },

  GENERATING: { label: "生成中", variant: "default" },
}

interface StatusBadgeProps {
  status: TaskStatus | ProjectStatus | AssetStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: "secondary" as const }
  return (
    <Badge variant={config.variant} className={cn("font-normal", className)}>
      {config.label}
    </Badge>
  )
}
