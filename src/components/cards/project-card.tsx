import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, ExternalLink } from "lucide-react"
import { StatusBadge } from "./status-badge"
import { formatRelativeTime } from "@/lib/date"
import type { Project } from "@/stores/project-store"

interface ProjectCardProps {
  project: Project
  className?: string
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  return (
    <Card className={cn("card-hover group", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-base font-medium truncate">
              {project.title}
            </CardTitle>
            <div className="flex items-center gap-2">
              <StatusBadge status={project.status} />
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(project.updatedAt)}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1 mb-3">
          {project.topicKeywords.slice(0, 3).map((keyword) => (
            <span
              key={keyword}
              className="text-xs bg-muted px-2 py-0.5 rounded-full"
            >
              {keyword}
            </span>
          ))}
          {project.topicKeywords.length > 3 && (
            <span className="text-xs text-muted-foreground">
              +{project.topicKeywords.length - 3}
            </span>
          )}
        </div>
        <Link href={`/research?project=${project.id}`}>
          <Button variant="outline" size="sm" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            继续工作
            <ExternalLink className="size-3 ml-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}

// Helper import
function cn(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(" ")
}
