import { withMeta } from "@/lib/server/api-response"
import { hasSearchConfig } from "@/lib/server/search"
import { hasChatModelConfig } from "@/lib/server/openai"
import { proxyLegacyJson } from "@/lib/legacy-backend"
import { shouldUseLegacyQueryEngineResearch } from "@/lib/server/legacy-queryengine"
import { getLegacyMemoryStatus, isLegacyMemoryEnabled } from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function maskValue(value: string): string {
  if (!value) return ""
  if (value.length <= 2) return `${value[0]}*`
  return `${value.slice(0, 2)}***${value.slice(-1)}`
}

function detectLlmProvider(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  if (lower.includes("bigmodel.cn")) return "zhipu-openai-compatible"
  if (lower.includes("openai.com")) return "openai"
  return "openai-compatible"
}

function detectDashScopeRegion(baseUrl: string): "cn-beijing" | "intl-singapore" | "custom" {
  const lower = baseUrl.toLowerCase()
  if (lower.includes("dashscope.aliyuncs.com")) return "cn-beijing"
  if (lower.includes("dashscope-intl.aliyuncs.com")) return "intl-singapore"
  return "custom"
}

export async function GET(request: Request) {
  const meta = withMeta(request)
  const researchBackend = shouldUseLegacyQueryEngineResearch() ? "legacy-queryengine" : "next-native"

  const tavilyEnabled = Boolean(process.env.TAVILY_API_KEY)
  const serperEnabled = Boolean(process.env.SERPER_API_KEY)

  const llmEnabled = hasChatModelConfig()
  const llmBaseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
  const llmModel = process.env.OPENAI_MODEL || "gpt-4o-mini"

  const dashscopeEnabled = Boolean(process.env.DASHSCOPE_API_KEY)
  const imageOpenAICompatibleEnabled = Boolean(process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY)
  const imageEnabled = dashscopeEnabled || imageOpenAICompatibleEnabled
  const imageBaseUrl = dashscopeEnabled
    ? normalizeBaseUrl(process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com")
    : normalizeBaseUrl(process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
  const imageModel = dashscopeEnabled
    ? process.env.DASHSCOPE_IMAGE_MODEL || "z-image-turbo"
    : process.env.IMAGE_MODEL || "gpt-image-1"

  const wpEnabled =
    Boolean(process.env.WORDPRESS_BASE_URL) &&
    Boolean(process.env.WORDPRESS_USERNAME) &&
    Boolean(process.env.WORDPRESS_APP_PASSWORD)

  let legacyContentOps = false
  try {
    const resp = await proxyLegacyJson("/api/content/status", { method: "GET" })
    legacyContentOps = resp.ok
  } catch {
    legacyContentOps = false
  }

  const memoryEnabled = isLegacyMemoryEnabled()
  const memoryStatus = await getLegacyMemoryStatus()
  const legacyMemoryOps = memoryEnabled ? Boolean(memoryStatus?.success) : false
  const memoryStore = memoryStatus?.store && typeof memoryStatus.store === "object"
    ? (memoryStatus.store as Record<string, unknown>)
    : {}
  const memoryGrag = memoryStatus?.grag && typeof memoryStatus.grag === "object"
    ? (memoryStatus.grag as Record<string, unknown>)
    : {}

  return meta.ok({
    search: hasSearchConfig(),
    llm: llmEnabled,
    image: imageEnabled,
    wordpress: wpEnabled,
    legacyContentOps,
    legacyMemoryOps,
    diagnostics: {
      research: {
        backend: researchBackend,
        switchEnv: {
          USE_LEGACY_QUERYENGINE_RESEARCH: String(process.env.USE_LEGACY_QUERYENGINE_RESEARCH || ""),
          RESEARCH_BACKEND: String(process.env.RESEARCH_BACKEND || ""),
        },
      },
      search: {
        primary: tavilyEnabled ? "tavily" : serperEnabled ? "serper" : "none",
        fallback: tavilyEnabled && serperEnabled ? "serper" : "none",
        configuredProviders: [
          ...(tavilyEnabled ? ["tavily"] : []),
          ...(serperEnabled ? ["serper"] : []),
        ],
        timeoutMs: {
          tavily: 8000,
          serper: 6000,
        },
        missingEnv: [
          ...(tavilyEnabled ? [] : ["TAVILY_API_KEY"]),
          ...(serperEnabled ? [] : ["SERPER_API_KEY"]),
        ],
      },
      llm: {
        enabled: llmEnabled,
        provider: detectLlmProvider(llmBaseUrl),
        baseUrl: llmBaseUrl,
        model: llmModel,
        missingEnv: llmEnabled ? [] : ["OPENAI_API_KEY"],
      },
      image: {
        enabled: imageEnabled,
        provider: dashscopeEnabled ? "dashscope" : "openai-compatible",
        baseUrl: imageBaseUrl,
        model: imageModel,
        region: dashscopeEnabled ? detectDashScopeRegion(imageBaseUrl) : undefined,
        promptExtend:
          dashscopeEnabled
            ? String(process.env.DASHSCOPE_PROMPT_EXTEND || "false").toLowerCase() === "true"
            : undefined,
        missingEnv: imageEnabled
          ? []
          : ["DASHSCOPE_API_KEY or IMAGE_API_KEY or OPENAI_API_KEY"],
      },
      wordpress: {
        enabled: wpEnabled,
        baseUrl: process.env.WORDPRESS_BASE_URL || "",
        usernameMasked: process.env.WORDPRESS_USERNAME ? maskValue(process.env.WORDPRESS_USERNAME) : "",
        status: process.env.WORDPRESS_POST_STATUS || "draft",
        missingEnv: [
          ...(process.env.WORDPRESS_BASE_URL ? [] : ["WORDPRESS_BASE_URL"]),
          ...(process.env.WORDPRESS_USERNAME ? [] : ["WORDPRESS_USERNAME"]),
          ...(process.env.WORDPRESS_APP_PASSWORD ? [] : ["WORDPRESS_APP_PASSWORD"]),
        ],
      },
      legacy: {
        configuredUrl: process.env.LEGACY_BACKEND_URL || "",
        reachable: legacyContentOps,
      },
      memory: {
        enabled: memoryEnabled,
        reachable: legacyMemoryOps,
        gragEnabled: Boolean(memoryGrag.enabled),
        storePath: String(memoryStore.path || ""),
        profilesCount: Number(memoryStore.profiles_count || 0),
        projectContextCount: Number(memoryStore.project_context_count || 0),
        performanceRecordCount: Number(memoryStore.performance_record_count || 0),
      },
    },
  })
}
