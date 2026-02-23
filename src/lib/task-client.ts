import { apiGet } from "@/lib/api"

export type WorkflowTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"

export interface WorkflowTaskSnapshot {
  taskId: string
  kind: "research" | "draft" | "rewrite" | "asset" | "publish" | "export" | "workflow"
  status: WorkflowTaskStatus
  progress: number
  projectId?: string
  provider?: string
  traceId?: string
  idempotencyKey?: string
  requestId?: string
  error?: {
    code?: string
    message: string
    retriable: boolean
  }
  payload?: Record<string, unknown>
  startedAt: string
  updatedAt: string
  endedAt?: string
}

export function isTerminalTaskStatus(status: WorkflowTaskStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
}

export async function fetchTaskStatus(taskId: string): Promise<WorkflowTaskSnapshot | null> {
  if (!taskId) return null
  const response = await apiGet<WorkflowTaskSnapshot>(
    `/api/tasks/${encodeURIComponent(taskId)}/status`
  )

  if (!response.ok || !response.data) {
    return null
  }

  return response.data
}
