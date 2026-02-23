import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type ProjectStatus =
  | "DRAFT"
  | "RESEARCHING"
  | "DRAFTING"
  | "REWRITING"
  | "PUBLISHING"
  | "COMPLETED"
  | "ARCHIVED"

export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"
export type Platform = "WECHAT" | "XIAOHONGSHU" | "WEIBO" | "BILIBILI"
export type SearchTool = "WEB_SEARCH" | "NEWS_SEARCH" | "TAVILY" | "SERPER"
export type PublishTarget = "WORDPRESS" | "EXPORT_MD" | "EXPORT_HTML" | "EXPORT_JSON" | "EXPORT_ZIP"
export type AssetStatus = "PENDING" | "GENERATING" | "COMPLETED" | "FAILED"
export type WorkflowStep = "research" | "drafts" | "rewrite" | "assets" | "publish" | "analytics"

interface SyncMeta {
  taskId?: string
  provider?: string
  lastSyncAt?: string
}

export interface Project {
  id: string
  title: string
  topicKeywords: string[]
  timeWindow: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export interface ResearchTask extends SyncMeta {
  id: string
  projectId: string
  query: string
  tool: SearchTool
  status: TaskStatus
  progress: number
  error?: string
  startedAt?: string
  endedAt?: string
  createdAt: string
}

export interface SourceItem extends SyncMeta {
  id: string
  projectId: string
  url: string
  title: string
  publisher?: string
  publishedAt?: string
  snippet?: string
  contentExtracted?: string
  credibilityScore: number
  createdAt: string
}

export interface Insight extends SyncMeta {
  id: string
  projectId: string
  summary: string
  risks: string[]
  angles: string[]
  recommendedTitles: string[]
  createdAt: string
}

export interface DraftVersion extends SyncMeta {
  id: string
  projectId: string
  versionNo: number
  contentMd: string
  contentHtml?: string
  wordCount: number
  citations: string[]
  authorNote?: string
  isCurrent: boolean
  createdAt: string
}

export interface PlatformVariant extends SyncMeta {
  id: string
  draftId: string
  platform: Platform
  titleCandidates: string[]
  body: string
  hashtags: string[]
  coverCopy?: string
  createdAt: string
}

export interface AssetItem extends SyncMeta {
  id: string
  projectId: string
  prompt: string
  imageUrl?: string
  status: AssetStatus
  linkedVariantIds: string[]
  createdAt: string
}

export interface PublishJob extends SyncMeta {
  id: string
  variantId?: string
  projectId: string
  target: PublishTarget
  payloadRef?: string
  status: TaskStatus
  retryCount: number
  lastError?: string
  remotePostId?: string
  remoteLink?: string
  createdAt: string
  updatedAt: string
}

export interface AnalyticsDaily {
  id: string
  date: string
  projectsCount: number
  draftsCount: number
  publishSuccessRate: number
  avgCycleMinutes: number
}

interface PersistedStateV1 {
  projects?: Project[]
  currentProjectId?: string | null
  researchTasks?: ResearchTask[]
  sources?: SourceItem[]
  insights?: Insight[]
  drafts?: DraftVersion[]
  variants?: PlatformVariant[]
  assets?: AssetItem[]
  publishJobs?: PublishJob[]
  settings?: Record<string, string>
  analytics?: AnalyticsDaily[]
}

interface ContentPilotState {
  projects: Project[]
  currentProjectId: string | null
  workflowStep: WorkflowStep
  setWorkflowStep: (step: WorkflowStep) => void
  canProceed: (step: WorkflowStep, projectId?: string | null) => boolean

  addProject: (project: Omit<Project, "id" | "createdAt" | "updatedAt"> & { id?: string }) => string
  updateProject: (id: string, updates: Partial<Project>) => void
  deleteProject: (id: string) => void
  setCurrentProject: (id: string | null) => void

  researchTasks: ResearchTask[]
  addResearchTask: (task: Omit<ResearchTask, "id" | "createdAt">) => string
  updateResearchTask: (id: string, updates: Partial<ResearchTask>) => void

  sources: SourceItem[]
  addSource: (source: Omit<SourceItem, "id" | "createdAt">) => string
  updateSource: (id: string, updates: Partial<SourceItem>) => void

  insights: Insight[]
  addInsight: (insight: Omit<Insight, "id" | "createdAt">) => string

  drafts: DraftVersion[]
  addDraft: (draft: Omit<DraftVersion, "id" | "createdAt">) => string
  updateDraft: (id: string, updates: Partial<DraftVersion>) => void

  variants: PlatformVariant[]
  addVariant: (variant: Omit<PlatformVariant, "id" | "createdAt">) => string
  updateVariant: (id: string, updates: Partial<PlatformVariant>) => void

  assets: AssetItem[]
  addAsset: (asset: Omit<AssetItem, "id" | "createdAt">) => string
  updateAsset: (id: string, updates: Partial<AssetItem>) => void

  publishJobs: PublishJob[]
  addPublishJob: (job: Omit<PublishJob, "id" | "createdAt" | "updatedAt">) => string
  updatePublishJob: (id: string, updates: Partial<PublishJob>) => void

  settings: Record<string, string>
  setSetting: (key: string, value: string) => void
  getSetting: (key: string, defaultValue?: string) => string | undefined

  analytics: AnalyticsDaily[]
  addAnalytics: (data: Omit<AnalyticsDaily, "id">) => void

  clearAll: () => void
  exportData: () => string
  importData: (json: string) => boolean
}

const LEGACY_STORAGE_KEY = "contentpilot-storage"
const V2_STORAGE_KEY = "contentpilot:v2:store"

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
const now = () => new Date().toISOString()

const emptyState: Pick<
  ContentPilotState,
  | "projects"
  | "currentProjectId"
  | "workflowStep"
  | "researchTasks"
  | "sources"
  | "insights"
  | "drafts"
  | "variants"
  | "assets"
  | "publishJobs"
  | "settings"
  | "analytics"
> = {
  projects: [],
  currentProjectId: null,
  workflowStep: "research",
  researchTasks: [],
  sources: [],
  insights: [],
  drafts: [],
  variants: [],
  assets: [],
  publishJobs: [],
  settings: {},
  analytics: [],
}

export function migratePersistedV1State(raw: PersistedStateV1 | undefined): PersistedStateV1 {
  if (!raw) return { ...emptyState }

  return {
    projects: raw.projects || [],
    currentProjectId: raw.currentProjectId || null,
    researchTasks: (raw.researchTasks || []).map((item) => ({
      ...item,
      provider: item.provider || "tavily",
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    sources: (raw.sources || []).map((item) => ({
      ...item,
      provider: item.provider || undefined,
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    insights: (raw.insights || []).map((item) => ({
      ...item,
      provider: item.provider || undefined,
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    drafts: (raw.drafts || []).map((item) => ({
      ...item,
      provider: item.provider || undefined,
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    variants: (raw.variants || []).map((item) => ({
      ...item,
      provider: item.provider || undefined,
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    assets: (raw.assets || []).map((item) => ({
      ...item,
      provider: item.provider || item.provider,
      lastSyncAt: item.lastSyncAt || item.createdAt || now(),
    })),
    publishJobs: (raw.publishJobs || []).map((item) => ({
      ...item,
      provider: item.provider || (item.target === "WORDPRESS" ? "wordpress" : "local-export"),
      lastSyncAt: item.lastSyncAt || item.updatedAt || now(),
    })),
    settings: raw.settings || {},
    analytics: raw.analytics || [],
  }
}

function detectWorkflowStep(state: PersistedStateV1): WorkflowStep {
  const projectId = state.currentProjectId || state.projects?.[0]?.id
  if (!projectId) return "research"

  const hasResearch = Boolean(
    state.sources?.some((s) => s.projectId === projectId) &&
      state.insights?.some((i) => i.projectId === projectId)
  )
  if (!hasResearch) return "research"

  const draft = state.drafts?.find((d) => d.projectId === projectId && d.isCurrent)
  if (!draft) return "drafts"

  const hasVariants = Boolean(state.variants?.some((v) => v.draftId === draft.id))
  if (!hasVariants) return "rewrite"
  return "publish"
}

const storage = createJSONStorage<any>(() => ({
  getItem: (name) => {
    const current = window.localStorage.getItem(name)
    if (current) return current

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      window.localStorage.setItem(name, legacy)
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      return legacy
    }

    return null
  },
  setItem: (name, value) => window.localStorage.setItem(name, value),
  removeItem: (name) => window.localStorage.removeItem(name),
})) as any

export const useStore = create<ContentPilotState>()(
  persist(
    (set, get) => ({
      ...emptyState,

      setWorkflowStep: (step) => set({ workflowStep: step }),
      canProceed: (step, projectId) => {
        const state = get()
        const pid = projectId || state.currentProjectId || state.projects[0]?.id
        if (!pid) return step === "research"

        const hasResearch =
          state.sources.some((s) => s.projectId === pid) &&
          state.insights.some((i) => i.projectId === pid)

        const currentDraft = state.drafts.find((d) => d.projectId === pid && d.isCurrent)
        const hasDraft = Boolean(currentDraft)
        const hasVariants = Boolean(currentDraft && state.variants.some((v) => v.draftId === currentDraft.id))
        const hasPublish = state.publishJobs.some((j) => j.projectId === pid && j.status === "COMPLETED")

        switch (step) {
          case "research":
            return true
          case "drafts":
            return hasResearch
          case "rewrite":
            return hasDraft
          case "assets":
            return hasVariants
          case "publish":
            return hasVariants
          case "analytics":
            return hasPublish
          default:
            return false
        }
      },

      addProject: (project) => {
        const preferredId = String(project.id || "").trim()
        const idExists = get().projects.some((item) => item.id === preferredId)
        const id = preferredId && !idExists ? preferredId : generateId()
        const nowTime = now()
        set((state) => ({
          projects: [
            {
              id,
              title: project.title,
              topicKeywords: project.topicKeywords,
              timeWindow: project.timeWindow,
              status: project.status,
              createdAt: nowTime,
              updatedAt: nowTime,
            },
            ...state.projects,
          ],
          currentProjectId: state.currentProjectId || id,
          workflowStep: "research",
        }))
        return id
      },

      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: now() } : p)),
        }))
      },

      deleteProject: (id) => {
        set((state) => {
          const nextProjects = state.projects.filter((p) => p.id !== id)
          const removedDraftIds = new Set(
            state.drafts.filter((draft) => draft.projectId === id).map((draft) => draft.id)
          )

          return {
            projects: nextProjects,
            currentProjectId:
              state.currentProjectId === id ? (nextProjects[0]?.id ?? null) : state.currentProjectId,
            researchTasks: state.researchTasks.filter((task) => task.projectId !== id),
            sources: state.sources.filter((source) => source.projectId !== id),
            insights: state.insights.filter((insight) => insight.projectId !== id),
            drafts: state.drafts.filter((draft) => draft.projectId !== id),
            variants: state.variants.filter((variant) => !removedDraftIds.has(variant.draftId)),
            assets: state.assets.filter((asset) => asset.projectId !== id),
            publishJobs: state.publishJobs.filter((job) => job.projectId !== id),
            workflowStep: "research",
          }
        })
      },

      setCurrentProject: (id) => set({ currentProjectId: id }),

      researchTasks: [],
      addResearchTask: (task) => {
        const id = generateId()
        set((state) => ({
          researchTasks: [
            { ...task, id, createdAt: now(), lastSyncAt: task.lastSyncAt || now() },
            ...state.researchTasks,
          ],
        }))
        return id
      },
      updateResearchTask: (id, updates) => {
        set((state) => ({
          researchTasks: state.researchTasks.map((t) =>
            t.id === id ? { ...t, ...updates, lastSyncAt: updates.lastSyncAt || now() } : t
          ),
        }))
      },

      sources: [],
      addSource: (source) => {
        const id = generateId()
        set((state) => ({
          sources: [{ ...source, id, createdAt: now(), lastSyncAt: source.lastSyncAt || now() }, ...state.sources],
        }))
        return id
      },
      updateSource: (id, updates) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, ...updates, lastSyncAt: updates.lastSyncAt || now() } : s
          ),
        }))
      },

      insights: [],
      addInsight: (insight) => {
        const id = generateId()
        set((state) => ({
          insights: [
            { ...insight, id, createdAt: now(), lastSyncAt: insight.lastSyncAt || now() },
            ...state.insights,
          ],
          workflowStep: "drafts",
        }))
        return id
      },

      drafts: [],
      addDraft: (draft) => {
        const id = generateId()
        set((state) => ({
          drafts: [{ ...draft, id, createdAt: now(), lastSyncAt: draft.lastSyncAt || now() }, ...state.drafts],
          workflowStep: "rewrite",
        }))
        return id
      },
      updateDraft: (id, updates) => {
        set((state) => ({
          drafts: state.drafts.map((d) =>
            d.id === id ? { ...d, ...updates, lastSyncAt: updates.lastSyncAt || now() } : d
          ),
        }))
      },

      variants: [],
      addVariant: (variant) => {
        const id = generateId()
        set((state) => ({
          variants: [
            { ...variant, id, createdAt: now(), lastSyncAt: variant.lastSyncAt || now() },
            ...state.variants,
          ],
          workflowStep: "publish",
        }))
        return id
      },
      updateVariant: (id, updates) => {
        set((state) => ({
          variants: state.variants.map((v) =>
            v.id === id ? { ...v, ...updates, lastSyncAt: updates.lastSyncAt || now() } : v
          ),
        }))
      },

      assets: [],
      addAsset: (asset) => {
        const id = generateId()
        set((state) => ({
          assets: [{ ...asset, id, createdAt: now(), lastSyncAt: asset.lastSyncAt || now() }, ...state.assets],
          workflowStep: "publish",
        }))
        return id
      },
      updateAsset: (id, updates) => {
        set((state) => ({
          assets: state.assets.map((a) =>
            a.id === id ? { ...a, ...updates, lastSyncAt: updates.lastSyncAt || now() } : a
          ),
        }))
      },

      publishJobs: [],
      addPublishJob: (job) => {
        const id = generateId()
        const nowTime = now()
        set((state) => ({
          publishJobs: [
            { ...job, id, createdAt: nowTime, updatedAt: nowTime, lastSyncAt: job.lastSyncAt || nowTime },
            ...state.publishJobs,
          ],
          workflowStep: "publish",
        }))
        return id
      },
      updatePublishJob: (id, updates) => {
        set((state) => ({
          publishJobs: state.publishJobs.map((j) =>
            j.id === id
              ? { ...j, ...updates, updatedAt: now(), lastSyncAt: updates.lastSyncAt || now() }
              : j
          ),
        }))
      },

      settings: {},
      setSetting: (key, value) => {
        set((state) => ({ settings: { ...state.settings, [key]: value } }))
      },
      getSetting: (key, defaultValue) => get().settings[key] ?? defaultValue,

      analytics: [],
      addAnalytics: (data) => {
        const id = generateId()
        set((state) => ({ analytics: [...state.analytics, { ...data, id }] }))
      },

      clearAll: () => set({ ...emptyState }),

      exportData: () => {
        const state = get()
        return JSON.stringify(
          {
            version: 2,
            exportedAt: now(),
            projects: state.projects,
            currentProjectId: state.currentProjectId,
            workflowStep: state.workflowStep,
            researchTasks: state.researchTasks,
            sources: state.sources,
            insights: state.insights,
            drafts: state.drafts,
            variants: state.variants,
            assets: state.assets,
            publishJobs: state.publishJobs,
            settings: state.settings,
            analytics: state.analytics,
          },
          null,
          2
        )
      },

      importData: (json) => {
        try {
          const data = JSON.parse(json) as { version?: number } & PersistedStateV1 & {
            workflowStep?: WorkflowStep
          }

          const normalized = data.version === 1 ? migratePersistedV1State(data) : migratePersistedV1State(data)

          set({
            ...emptyState,
            projects: normalized.projects || [],
            currentProjectId: normalized.currentProjectId || null,
            workflowStep: data.workflowStep || detectWorkflowStep(normalized),
            researchTasks: normalized.researchTasks || [],
            sources: normalized.sources || [],
            insights: normalized.insights || [],
            drafts: normalized.drafts || [],
            variants: normalized.variants || [],
            assets: normalized.assets || [],
            publishJobs: normalized.publishJobs || [],
            settings: normalized.settings || {},
            analytics: normalized.analytics || [],
          })

          return true
        } catch (error) {
          console.error("Failed to import data:", error)
          return false
        }
      },
    }),
    {
      name: V2_STORAGE_KEY,
      version: 2,
      storage,
      migrate: (persistedState, version) => {
        const state = persistedState as PersistedStateV1 & { workflowStep?: WorkflowStep }

        if (version < 2) {
          const migrated = migratePersistedV1State(state)
          return {
            ...emptyState,
            ...migrated,
            workflowStep: detectWorkflowStep(migrated),
          }
        }

        return {
          ...emptyState,
          ...state,
          workflowStep: state.workflowStep || detectWorkflowStep(state),
        }
      },
      partialize: (state) => ({
        projects: state.projects,
        currentProjectId: state.currentProjectId,
        workflowStep: state.workflowStep,
        researchTasks: state.researchTasks,
        sources: state.sources,
        insights: state.insights,
        drafts: state.drafts,
        variants: state.variants,
        assets: state.assets,
        publishJobs: state.publishJobs,
        settings: state.settings,
        analytics: state.analytics,
      }),
    }
  )
)
