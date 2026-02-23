export type WorkflowTaskKind = "research" | "draft" | "rewrite" | "asset" | "publish" | "export" | "workflow"
export type WorkflowTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"

export interface WorkflowTaskError {
  code?: string
  message: string
  retriable: boolean
}

export interface WorkflowTaskSnapshot {
  taskId: string
  kind: WorkflowTaskKind
  status: WorkflowTaskStatus
  progress: number
  projectId?: string
  provider?: string
  traceId?: string
  idempotencyKey?: string
  requestId?: string
  error?: WorkflowTaskError
  payload?: Record<string, unknown>
  startedAt: string
  updatedAt: string
  endedAt?: string
}

interface UpsertTaskInput {
  kind: WorkflowTaskKind
  status?: WorkflowTaskStatus
  progress?: number
  projectId?: string
  provider?: string
  traceId?: string
  idempotencyKey?: string
  requestId?: string
  payload?: Record<string, unknown>
}

interface PatchTaskInput {
  status?: WorkflowTaskStatus
  progress?: number
  provider?: string
  payload?: Record<string, unknown>
  error?: WorkflowTaskError
  endedAt?: string
}

declare global {
  var __contentpilotTaskRegistry: Map<string, WorkflowTaskSnapshot> | undefined
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000

function nowIso(): string {
  return new Date().toISOString()
}

function cleanupExpired(store: Map<string, WorkflowTaskSnapshot>) {
  const nowTs = Date.now()
  for (const [taskId, task] of store.entries()) {
    const updatedTs = Date.parse(task.updatedAt)
    if (Number.isNaN(updatedTs)) continue
    if (nowTs - updatedTs > MAX_AGE_MS) {
      store.delete(taskId)
    }
  }
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, Math.round(progress)))
}

export function getTaskRegistry(): Map<string, WorkflowTaskSnapshot> {
  if (!globalThis.__contentpilotTaskRegistry) {
    globalThis.__contentpilotTaskRegistry = new Map<string, WorkflowTaskSnapshot>()
  }
  cleanupExpired(globalThis.__contentpilotTaskRegistry)
  return globalThis.__contentpilotTaskRegistry
}

export function upsertTask(taskId: string, input: UpsertTaskInput): WorkflowTaskSnapshot {
  const store = getTaskRegistry()
  const current = store.get(taskId)
  const timestamp = nowIso()

  const next: WorkflowTaskSnapshot = current
    ? {
        ...current,
        ...input,
        progress:
          typeof input.progress === "number"
            ? clampProgress(input.progress)
            : current.progress,
        payload: {
          ...(current.payload || {}),
          ...(input.payload || {}),
        },
        updatedAt: timestamp,
      }
    : {
        taskId,
        kind: input.kind,
        status: input.status || "RUNNING",
        progress: clampProgress(typeof input.progress === "number" ? input.progress : 0),
        projectId: input.projectId,
        provider: input.provider,
        traceId: input.traceId,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        payload: input.payload,
        startedAt: timestamp,
        updatedAt: timestamp,
      }

  store.set(taskId, next)
  return next
}

export function patchTask(taskId: string, patch: PatchTaskInput): WorkflowTaskSnapshot | undefined {
  const store = getTaskRegistry()
  const current = store.get(taskId)
  if (!current) return undefined

  const next: WorkflowTaskSnapshot = {
    ...current,
    ...patch,
    progress:
      typeof patch.progress === "number"
        ? clampProgress(patch.progress)
        : current.progress,
    payload: patch.payload
      ? {
          ...(current.payload || {}),
          ...patch.payload,
        }
      : current.payload,
    updatedAt: nowIso(),
  }
  store.set(taskId, next)
  return next
}

export function completeTask(taskId: string, patch?: Omit<PatchTaskInput, "status" | "endedAt">): WorkflowTaskSnapshot | undefined {
  return patchTask(taskId, {
    ...(patch || {}),
    status: "COMPLETED",
    progress: typeof patch?.progress === "number" ? patch.progress : 100,
    endedAt: nowIso(),
  })
}

export function failTask(taskId: string, error: WorkflowTaskError, patch?: Omit<PatchTaskInput, "status" | "error" | "endedAt">): WorkflowTaskSnapshot | undefined {
  return patchTask(taskId, {
    ...(patch || {}),
    status: "FAILED",
    error,
    endedAt: nowIso(),
  })
}

export function getTask(taskId: string): WorkflowTaskSnapshot | undefined {
  return getTaskRegistry().get(taskId)
}

export function listTasks(input?: {
  kind?: WorkflowTaskKind
  status?: WorkflowTaskStatus | WorkflowTaskStatus[]
  projectId?: string
  limit?: number
}): WorkflowTaskSnapshot[] {
  const all = Array.from(getTaskRegistry().values())
  const statusSet =
    input?.status === undefined
      ? null
      : new Set(Array.isArray(input.status) ? input.status : [input.status])

  const filtered = all.filter((task) => {
    if (input?.kind && task.kind !== input.kind) return false
    if (input?.projectId && task.projectId !== input.projectId) return false
    if (statusSet && !statusSet.has(task.status)) return false
    return true
  })

  filtered.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const limit = typeof input?.limit === "number" ? Math.max(1, Math.floor(input.limit)) : undefined
  return typeof limit === "number" ? filtered.slice(0, limit) : filtered
}
