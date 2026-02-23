import fs from "node:fs"
import path from "node:path"

export type ChatStepName =
  | "memory_retrieve"
  | "orchestrate_llm"
  | "memory_write"
  | "workflow_plan"
  | "workflow_execute"
  | "workflow_verify"
export type ChatStepStatus = "ok" | "error" | "skipped"
export type WorkflowTaskStep = "research" | "drafts" | "rewrite" | "assets" | "publish" | "analytics"
export type WorkflowTaskPhase = "plan" | "execute" | "verify"
export type WorkflowTaskStatus = "pending" | "running" | "waiting_user" | "succeeded" | "failed"

export interface ChatSessionTurn {
  role: "user" | "assistant" | "system"
  content: string
  createdAt: string
}

export interface ChatSessionStep {
  name: ChatStepName
  status: ChatStepStatus
  startedAt: string
  endedAt: string
  durationMs: number
  summary?: string
  error?: string
}

export interface ChatSessionMeta {
  lastSuggestedStep?: string
  lastReason?: string
  usedGragMemory?: boolean
  memorySnippet?: string
  lastWorkflowTaskId?: string
  lastWorkflowTaskStatus?: WorkflowTaskStatus
}

export interface WorkflowTaskValidation {
  key: string
  passed: boolean
  message: string
}

export interface WorkflowTaskRecord {
  taskId: string
  step: WorkflowTaskStep
  phase: WorkflowTaskPhase
  status: WorkflowTaskStatus
  retryCount: number
  provider?: string
  traceId?: string
  idempotencyKey?: string
  inputSummary?: string
  outputSummary?: string
  lastError?: string
  validations?: WorkflowTaskValidation[]
  createdAt: string
  updatedAt: string
}

export interface ChatSessionRecord {
  conversationId: string
  userId: string
  projectId?: string
  createdAt: string
  updatedAt: string
  turns: ChatSessionTurn[]
  steps: ChatSessionStep[]
  workflowTasks: WorkflowTaskRecord[]
  meta?: ChatSessionMeta
}

interface ChatSessionStore {
  sessions: Record<string, ChatSessionRecord>
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function nowIso(): string {
  return new Date().toISOString()
}

function sanitizeText(text: unknown, maxLen = 4000): string {
  const value = String(text || "").trim()
  if (!value) return ""
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value
}

function sanitizeWorkflowStatus(value: unknown, fallback: WorkflowTaskStatus): WorkflowTaskStatus {
  const status = String(value || "").trim().toLowerCase()
  if (
    status === "pending" ||
    status === "running" ||
    status === "waiting_user" ||
    status === "succeeded" ||
    status === "failed"
  ) {
    return status
  }
  return fallback
}

function sanitizeWorkflowPhase(value: unknown, fallback: WorkflowTaskPhase): WorkflowTaskPhase {
  const phase = String(value || "").trim().toLowerCase()
  if (phase === "plan" || phase === "execute" || phase === "verify") {
    return phase
  }
  return fallback
}

function storePath(): string {
  const custom = String(process.env.CHAT_SESSION_STORE_FILE || "").trim()
  if (custom) return custom
  return path.join(process.cwd(), "state", "chat_sessions_store.json")
}

function ensureStoreDir(): void {
  const filePath = storePath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function cleanupExpired(sessions: Record<string, ChatSessionRecord>): Record<string, ChatSessionRecord> {
  const nowMs = Date.now()
  const next: Record<string, ChatSessionRecord> = {}
  for (const [id, session] of Object.entries(sessions)) {
    const updatedMs = Date.parse(session.updatedAt)
    if (Number.isNaN(updatedMs)) continue
    if (nowMs - updatedMs > MAX_AGE_MS) continue
    next[id] = session
  }
  return next
}

function readStore(): ChatSessionStore {
  const filePath = storePath()
  if (!fs.existsSync(filePath)) {
    return { sessions: {} }
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<ChatSessionStore>
    const sessions = parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {}
    const normalized: Record<string, ChatSessionRecord> = {}
    for (const [conversationId, raw] of Object.entries(sessions as Record<string, ChatSessionRecord>)) {
      normalized[conversationId] = {
        ...raw,
        conversationId,
        turns: Array.isArray(raw?.turns) ? raw.turns : [],
        steps: Array.isArray(raw?.steps) ? raw.steps : [],
        workflowTasks: Array.isArray(raw?.workflowTasks)
          ? raw.workflowTasks.map((task) => ({
              ...task,
              status: sanitizeWorkflowStatus(task.status, "pending"),
              phase: sanitizeWorkflowPhase(task.phase, "plan"),
            }))
          : [],
      }
    }
    return { sessions: cleanupExpired(normalized) }
  } catch {
    return { sessions: {} }
  }
}

function writeStore(store: ChatSessionStore): void {
  ensureStoreDir()
  const filePath = storePath()
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        sessions: cleanupExpired(store.sessions),
        updatedAt: nowIso(),
      },
      null,
      2
    ),
    "utf8"
  )
}

export function ensureChatSession(input: {
  conversationId: string
  userId: string
  projectId?: string
  history?: Array<{ role?: string; content?: string }>
}): ChatSessionRecord {
  const store = readStore()
  const existing = store.sessions[input.conversationId]
  if (existing) {
    existing.updatedAt = nowIso()
    if (input.projectId) existing.projectId = input.projectId
    if (!Array.isArray(existing.turns)) existing.turns = []
    if (!Array.isArray(existing.steps)) existing.steps = []
    if (!Array.isArray(existing.workflowTasks)) existing.workflowTasks = []
    store.sessions[input.conversationId] = existing
    writeStore(store)
    return existing
  }

  const createdAt = nowIso()
  const turns: ChatSessionTurn[] = []
  for (const item of input.history || []) {
    const role = String(item?.role || "").toLowerCase()
    const content = sanitizeText(item?.content)
    if (!content) continue
    if (role !== "user" && role !== "assistant" && role !== "system") continue
    turns.push({
      role: role as ChatSessionTurn["role"],
      content,
      createdAt,
    })
  }

  const record: ChatSessionRecord = {
    conversationId: input.conversationId,
    userId: input.userId,
    projectId: input.projectId,
    createdAt,
    updatedAt: createdAt,
    turns,
    steps: [],
    workflowTasks: [],
  }
  store.sessions[input.conversationId] = record
  writeStore(store)
  return record
}

export function appendChatTurn(
  conversationId: string,
  turn: { role: "user" | "assistant" | "system"; content: string; createdAt?: string }
): ChatSessionRecord | null {
  const store = readStore()
  const session = store.sessions[conversationId]
  if (!session) return null

  const content = sanitizeText(turn.content)
  if (!content) return session

  session.turns.push({
    role: turn.role,
    content,
    createdAt: turn.createdAt || nowIso(),
  })
  session.updatedAt = nowIso()
  store.sessions[conversationId] = session
  writeStore(store)
  return session
}

export function appendChatStep(
  conversationId: string,
  step: {
    name: ChatStepName
    status: ChatStepStatus
    startedAt: Date
    endedAt?: Date
    summary?: string
    error?: string
  }
): ChatSessionRecord | null {
  const store = readStore()
  const session = store.sessions[conversationId]
  if (!session) return null

  const endedAt = step.endedAt || new Date()
  const durationMs = Math.max(0, endedAt.getTime() - step.startedAt.getTime())
  session.steps.push({
    name: step.name,
    status: step.status,
    startedAt: step.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs,
    summary: sanitizeText(step.summary, 1200) || undefined,
    error: sanitizeText(step.error, 1200) || undefined,
  })
  session.updatedAt = nowIso()
  store.sessions[conversationId] = session
  writeStore(store)
  return session
}

export function updateChatSessionMeta(
  conversationId: string,
  patch: Partial<ChatSessionMeta>
): ChatSessionRecord | null {
  const store = readStore()
  const session = store.sessions[conversationId]
  if (!session) return null

  session.meta = {
    ...(session.meta || {}),
    ...patch,
  }
  session.updatedAt = nowIso()
  store.sessions[conversationId] = session
  writeStore(store)
  return session
}

export function upsertWorkflowTask(
  conversationId: string,
  task: {
    taskId: string
    step: WorkflowTaskStep
    phase?: WorkflowTaskPhase
    status?: WorkflowTaskStatus
    retryCount?: number
    provider?: string
    traceId?: string
    idempotencyKey?: string
    inputSummary?: string
    outputSummary?: string
    lastError?: string
    validations?: WorkflowTaskValidation[]
  }
): WorkflowTaskRecord | null {
  const store = readStore()
  const session = store.sessions[conversationId]
  if (!session) return null

  if (!Array.isArray(session.workflowTasks)) {
    session.workflowTasks = []
  }

  const now = nowIso()
  const existingIndex = session.workflowTasks.findIndex((item) => item.taskId === task.taskId)
  if (existingIndex >= 0) {
    const current = session.workflowTasks[existingIndex]
    const next: WorkflowTaskRecord = {
      ...current,
      ...task,
      phase: sanitizeWorkflowPhase(task.phase, current.phase),
      status: sanitizeWorkflowStatus(task.status, current.status),
      retryCount: typeof task.retryCount === "number" ? Math.max(0, task.retryCount) : current.retryCount,
      inputSummary: sanitizeText(task.inputSummary, 1200) || current.inputSummary,
      outputSummary: sanitizeText(task.outputSummary, 1200) || current.outputSummary,
      lastError: sanitizeText(task.lastError, 1200) || current.lastError,
      validations: Array.isArray(task.validations) ? task.validations : current.validations,
      updatedAt: now,
    }
    session.workflowTasks[existingIndex] = next
    session.updatedAt = now
    store.sessions[conversationId] = session
    writeStore(store)
    return next
  }

  const created: WorkflowTaskRecord = {
    taskId: task.taskId,
    step: task.step,
    phase: sanitizeWorkflowPhase(task.phase, "plan"),
    status: sanitizeWorkflowStatus(task.status, "pending"),
    retryCount: typeof task.retryCount === "number" ? Math.max(0, task.retryCount) : 0,
    provider: task.provider,
    traceId: task.traceId,
    idempotencyKey: task.idempotencyKey,
    inputSummary: sanitizeText(task.inputSummary, 1200) || undefined,
    outputSummary: sanitizeText(task.outputSummary, 1200) || undefined,
    lastError: sanitizeText(task.lastError, 1200) || undefined,
    validations: Array.isArray(task.validations) ? task.validations : [],
    createdAt: now,
    updatedAt: now,
  }
  session.workflowTasks.push(created)
  session.updatedAt = now
  store.sessions[conversationId] = session
  writeStore(store)
  return created
}

export function getWorkflowTask(conversationId: string, taskId: string): WorkflowTaskRecord | null {
  const session = getChatSession(conversationId)
  if (!session) return null
  const task = session.workflowTasks.find((item) => item.taskId === taskId)
  return task || null
}

export function findLatestRecoverableWorkflowTask(input: {
  conversationId?: string
  userId?: string
  projectId?: string
  statuses?: WorkflowTaskStatus[]
}): {
  conversationId: string
  userId: string
  projectId?: string
  task: WorkflowTaskRecord
  latestAssistantReply?: string
  latestUserMessage?: string
} | null {
  const store = readStore()
  const sessions = Object.values(store.sessions).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  )
  const statusSet = new Set(
    (input.statuses && input.statuses.length
      ? input.statuses
      : ["running", "failed", "waiting_user"]) as WorkflowTaskStatus[]
  )

  for (const session of sessions) {
    if (input.conversationId && session.conversationId !== input.conversationId) continue
    if (input.userId && session.userId !== input.userId) continue
    if (input.projectId && session.projectId !== input.projectId) continue
    if (!Array.isArray(session.workflowTasks) || session.workflowTasks.length === 0) continue

    const latestTask = [...session.workflowTasks]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .find((task) => statusSet.has(task.status))
    if (!latestTask) continue

    const latestAssistantReply = [...session.turns]
      .reverse()
      .find((turn) => turn.role === "assistant")?.content
    const latestUserMessage = [...session.turns].reverse().find((turn) => turn.role === "user")?.content

    return {
      conversationId: session.conversationId,
      userId: session.userId,
      projectId: session.projectId,
      task: latestTask,
      latestAssistantReply,
      latestUserMessage,
    }
  }

  return null
}

export function getChatSession(conversationId: string): ChatSessionRecord | null {
  const store = readStore()
  return store.sessions[conversationId] || null
}

export function exportChatSession(conversationId: string): Record<string, unknown> | null {
  const session = getChatSession(conversationId)
  if (!session) return null

  return {
    generatedAt: nowIso(),
    conversation: {
      conversationId: session.conversationId,
      userId: session.userId,
      projectId: session.projectId || "",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    counts: {
      turns: session.turns.length,
      steps: session.steps.length,
      workflowTasks: session.workflowTasks.length,
    },
    meta: session.meta || {},
    turns: session.turns,
    steps: session.steps,
    workflowTasks: session.workflowTasks,
  }
}
