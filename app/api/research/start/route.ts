import { NextRequest } from "next/server"
import { createChatCompletion, hasChatModelConfig } from "@/lib/server/openai"
import { encodeSSE } from "@/lib/server/sse"
import { hasSearchConfig, searchWebWithFallback } from "@/lib/server/search"
import {
  runLegacyQueryEngineResearch,
  shouldUseLegacyQueryEngineResearch,
} from "@/lib/server/legacy-queryengine"
import { withMeta } from "@/lib/server/api-response"
import { buildResearchInsightPrompt } from "@/lib/prompts"
import { extractJsonObject, researchInsightSchema } from "@/lib/schemas"
import { completeTask, failTask, patchTask, upsertTask } from "@/lib/server/task-registry"
import { verifyResearchResult } from "@/lib/server/workflow-verifier"
import {
  ingestLegacyConversation,
  isLegacyMemoryEnabled,
  retrieveLegacyMemory,
  upsertLegacyPerformanceSummary,
  upsertLegacyProjectContext,
} from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface SearchSource {
  url: string
  title: string
  publisher?: string
  snippet?: string
  publishedAt?: string
  credibilityScore: number
}

interface ResearchInsight {
  summary: string
  risks: string[]
  angles: string[]
  recommendedTitles: string[]
}

type ResearchProvider = "legacy-queryengine" | "tavily" | "serper" | "none"

function classifyResearchErrorCode(error: unknown): "PROVIDER_TIMEOUT" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes("timeout") || message.includes("abort") || message.includes("timed out")) {
    return "PROVIDER_TIMEOUT"
  }
  if (message.includes("429") || message.includes("rate limit")) {
    return "RATE_LIMITED"
  }
  return "PROVIDER_UNAVAILABLE"
}

function getCredibilityScore(hostname: string): number {
  const highCredibilityDomains = [
    "reuters.com", "apnews.com", "bbc.com", "nytimes.com",
    "wsj.com", "ft.com", "economist.com", "nature.com",
    "science.org", "pnas.org", "ieee.org", "acm.org",
    "gov.cn", "gov.uk", ".gov", "edu.cn", ".edu",
  ]
  const mediumCredibilityDomains = [
    "cnbc.com", "bloomberg.com", "forbes.com", "techcrunch.com",
    "theverge.com", "wired.com", "medium.com", "substack.com",
    "zhihu.com", "36kr.com", "huxiu.com", "ifanr.com",
  ]

  const lowerHost = hostname.toLowerCase()
  if (highCredibilityDomains.some((d) => lowerHost.includes(d))) return 0.9
  if (mediumCredibilityDomains.some((d) => lowerHost.includes(d))) return 0.7
  return 0.55
}

function getRecencyDays(timeWindow: string): number {
  const recencyMap: Record<string, number> = {
    "24h": 1,
    "7d": 7,
    "30d": 30,
    all: 0,
  }
  return recencyMap[timeWindow] ?? 7
}

function parseInsight(text: string): ResearchInsight {
  const fallback: ResearchInsight = {
    summary: text.slice(0, 500) || "No insight generated",
    risks: [],
    angles: [],
    recommendedTitles: [],
  }

  try {
    const parsedObj = extractJsonObject(text)
    if (!parsedObj) return fallback
    const parsed = researchInsightSchema.parse(parsedObj)
    return {
      summary: parsed.summary || fallback.summary,
      risks: parsed.risks,
      angles: parsed.angles,
      recommendedTitles: parsed.recommendedTitles,
    }
  } catch {
    return fallback
  }
}

function buildFallbackInsight(query: string, sources: SearchSource[]): ResearchInsight {
  return {
    summary: `已完成“${query}”的选题研究，共整理 ${sources.length} 条来源。建议优先保留可验证事实，并按“结论-证据-行动建议”组织内容。`,
    risks: [
      "部分来源可能是二次解读，不是一手证据。",
      "热点变化快，时间敏感信息发布前需二次核验。",
      "争议话题需保持中性表达并附上来源链接。",
    ],
    angles: [
      "近 7-30 天发生了哪些关键变化",
      "读者可直接执行的行动清单",
      "常见误区与反例拆解",
      "一个成功案例与一个失败案例对照",
    ],
    recommendedTitles: [
      `${query}：本周关键变化与结论`,
      `${query}：可直接落地的执行清单`,
      `${query}：风险、机会与下一步动作`,
      `别只看热闹：${query} 的务实判断`,
      `${query}：小团队可复用的方法手册`,
    ],
  }
}

function buildSyntheticSource(query: string): SearchSource {
  return {
    url: `https://example.com/search?q=${encodeURIComponent(query)}`,
    title: `${query} 的兜底来源`,
    publisher: "contentpilot-fallback",
    snippet: "当外部检索未返回结果时，系统自动生成兜底来源以保证流程可继续执行。",
    publishedAt: new Date().toISOString(),
    credibilityScore: 0.4,
  }
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request)
  const encoder = new TextEncoder()

  try {
    const body = await request.json()
    const projectId = String(body?.projectId || "").trim()
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const taskId = idempotencyKey || traceId || meta.requestId
    const query = String(body?.query || "").trim()
    const timeWindow = String(body?.timeWindow || "7d")
    const tool = String(body?.tool || "WEB_SEARCH")
    const userId = String(body?.userId || "local-user").trim() || "local-user"

    if (!query) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "query is required",
          retriable: false,
        },
        400
      )
    }

    const memoryEnabled = isLegacyMemoryEnabled()
    const memorySnapshot = await retrieveLegacyMemory({
      userId,
      projectId,
      query,
      performanceLimit: 5,
    })
    const memoryProfile =
      memorySnapshot?.profile && typeof memorySnapshot.profile === "object"
        ? (memorySnapshot.profile as Record<string, unknown>)
        : {}
    const preferredPlatform = String(memoryProfile.preferred_platform || "").trim()
    const targetAudience = String(memoryProfile.target_audience || "").trim()
    const memoryHint = [targetAudience ? `audience:${targetAudience}` : "", preferredPlatform ? `platform:${preferredPlatform}` : ""]
      .filter(Boolean)
      .join(" ")

    const stream = new ReadableStream({
      async start(controller) {
        const taskPayload: Record<string, unknown> = {
          query,
          timeWindow,
          tool,
        }
        const streamSources: SearchSource[] = []
        let streamInsight: ResearchInsight | undefined

        upsertTask(taskId, {
          kind: "research",
          status: "RUNNING",
          progress: 0,
          projectId: projectId || undefined,
          provider: "pending",
          traceId: traceId || undefined,
          idempotencyKey: idempotencyKey || undefined,
          requestId: meta.requestId,
          payload: taskPayload,
        })

        try {
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "meta",
                requestId: meta.requestId,
                projectId,
                traceId,
                idempotencyKey,
                taskId,
              })
            )
          )

          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 10 })))
          patchTask(taskId, { progress: 10 })

          const recencyDays = getRecencyDays(timeWindow)
          const baseQuery = tool === "NEWS_SEARCH" ? `${query} latest news` : query
          const searchQuery = memoryHint ? `${baseQuery} ${memoryHint}` : baseQuery

          let provider: ResearchProvider = "none"
          let primaryProvider: ResearchProvider = "none"
          let sources: SearchSource[] = []
          let legacyInsight: ResearchInsight | undefined

          if (shouldUseLegacyQueryEngineResearch()) {
            primaryProvider = "legacy-queryengine"
            try {
              const legacyResearch = await runLegacyQueryEngineResearch(searchQuery)
              provider = legacyResearch.provider
              sources = legacyResearch.sources.map((item) => ({
                url: item.url,
                title: item.title,
                publisher: item.publisher,
                snippet: item.snippet,
                publishedAt: item.publishedAt,
                credibilityScore: Number(item.credibilityScore || 0.7),
              }))
              legacyInsight = legacyResearch.insight

              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "provider",
                    provider,
                    primaryProvider,
                    fallbackUsed: false,
                    attempts: [
                      {
                        provider: "legacy-queryengine",
                        status: "success",
                        durationMs: 0,
                      },
                    ],
                  })
                )
              )
              patchTask(taskId, {
                provider,
                payload: {
                  provider,
                  primaryProvider,
                  fallbackUsed: false,
                  attempts: [
                    {
                      provider: "legacy-queryengine",
                      status: "success",
                      durationMs: 0,
                    },
                  ],
                },
              })
            } catch (legacyError) {
              const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError)
              const legacyCode = classifyResearchErrorCode(legacyError)
              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "provider",
                    provider: "none",
                    primaryProvider: "legacy-queryengine",
                    fallbackUsed: true,
                    fallbackReason: legacyCode,
                    attempts: [
                      {
                        provider: "legacy-queryengine",
                        status: "error",
                        durationMs: 0,
                        errorCode: legacyCode,
                        errorMessage: legacyMessage,
                      },
                    ],
                  })
                )
              )
              patchTask(taskId, {
                provider: "none",
                payload: {
                  provider: "none",
                  primaryProvider: "legacy-queryengine",
                  fallbackUsed: true,
                  fallbackReason: legacyCode,
                  attempts: [
                    {
                      provider: "legacy-queryengine",
                      status: "error",
                      durationMs: 0,
                      errorCode: legacyCode,
                      errorMessage: legacyMessage,
                    },
                  ],
                },
              })
            }
          }

          if (provider !== "legacy-queryengine" && hasSearchConfig()) {
            const searchRun = await searchWebWithFallback({
              query: searchQuery,
              maxResults: 15,
              recencyDays: recencyDays > 0 ? recencyDays : undefined,
            })

            provider = searchRun.provider
            primaryProvider = searchRun.primaryProvider
            sources = searchRun.results.map((item) => ({
              url: item.url,
              title: item.title,
              publisher: item.publisher,
              snippet: item.snippet,
              publishedAt: item.publishedAt,
              credibilityScore: getCredibilityScore(item.publisher || ""),
            }))

            controller.enqueue(
              encoder.encode(
                encodeSSE({
                  type: "provider",
                  provider,
                  primaryProvider,
                  fallbackUsed: searchRun.fallbackUsed,
                  fallbackReason: searchRun.fallbackReason,
                  attempts: searchRun.attempts,
                })
              )
            )
            patchTask(taskId, {
              provider,
              payload: {
                provider,
                primaryProvider,
                fallbackUsed: searchRun.fallbackUsed,
                fallbackReason: searchRun.fallbackReason,
                attempts: searchRun.attempts,
              },
            })
          }

          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 45 })))
          patchTask(taskId, { progress: 45 })

          for (const source of sources) {
            controller.enqueue(encoder.encode(encodeSSE({ type: "source", provider, ...source })))
            streamSources.push(source)
          }

          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 70 })))
          patchTask(taskId, { progress: 70, payload: { sourcesCount: streamSources.length } })

          let insight: ResearchInsight
          if (legacyInsight) {
            insight = legacyInsight
          } else if (hasChatModelConfig()) {
            const insightPrompt = buildResearchInsightPrompt({
              query: memoryHint ? `${query} (${memoryHint})` : query,
              timeWindow,
              sources: sources.map((s) => ({
                title: s.title,
                url: s.url,
                snippet: s.snippet,
                publishedAt: s.publishedAt,
              })),
            })

            const content = await createChatCompletion({
              messages: [
                { role: "system", content: "你负责内容项目研究结论输出，强调证据与可执行性。" },
                { role: "user", content: insightPrompt },
              ],
              responseFormat: { type: "json_object" },
              temperature: 0.4,
              maxTokens: 1200,
            })
            insight = parseInsight(content)
          } else {
            insight = buildFallbackInsight(query, sources)
          }
          streamInsight = insight

          if (!streamInsight.summary.trim()) {
            streamInsight.summary = `已生成“${query}”研究结论。`
          }
          if (!Array.isArray(streamInsight.recommendedTitles) || streamInsight.recommendedTitles.length === 0) {
            streamInsight.recommendedTitles = buildFallbackInsight(query, sources).recommendedTitles
          }
          if (streamSources.length === 0) {
            const synthetic = buildSyntheticSource(query)
            streamSources.push(synthetic)
            controller.enqueue(encoder.encode(encodeSSE({ type: "source", provider, ...synthetic })))
          }

          const validation = verifyResearchResult({
            sources: streamSources,
            insight: streamInsight,
          })
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "validator",
                stage: "research",
                ok: validation.ok,
                checks: validation.checks,
              })
            )
          )

          controller.enqueue(encoder.encode(encodeSSE({ type: "insight", ...insight })))
          controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 100 })))
          completeTask(taskId, {
            provider,
            progress: 100,
            payload: {
              ...taskPayload,
              provider,
              sources: streamSources,
              insight: streamInsight,
              validator: validation,
            },
          })

          if (memoryEnabled && projectId) {
            const contextPatch = {
              workflow_step: "research",
              last_research_query: query,
              last_research_time_window: timeWindow,
              last_research_provider: provider,
              source_count: streamSources.length,
              updated_at: new Date().toISOString(),
            }
            const perfPatch = {
              stage: "research",
              success: true,
              provider,
              source_count: streamSources.length,
              recorded_at: new Date().toISOString(),
            }
            await Promise.allSettled([
              upsertLegacyProjectContext(projectId, contextPatch),
              upsertLegacyPerformanceSummary(projectId, perfPatch),
              ingestLegacyConversation(query, streamInsight?.summary || `Research completed with ${streamSources.length} sources`),
            ])
          }
          controller.close()
        } catch (error) {
          const fallbackSources =
            streamSources.length > 0 ? [...streamSources] : [buildSyntheticSource(query)]
          const fallbackInsight = streamInsight || buildFallbackInsight(query, fallbackSources)
          const fallbackValidation = verifyResearchResult({
            sources: fallbackSources,
            insight: fallbackInsight,
          })

          if (fallbackValidation.ok) {
            controller.enqueue(
              encoder.encode(
                encodeSSE({
                  type: "provider",
                  provider: "none",
                  primaryProvider: "none",
                  fallbackUsed: true,
                  fallbackReason: classifyResearchErrorCode(error),
                  attempts: [],
                })
              )
            )
            for (const source of fallbackSources) {
              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "source",
                    provider: "none",
                    ...source,
                  })
                )
              )
            }
            controller.enqueue(encoder.encode(encodeSSE({ type: "insight", ...fallbackInsight })))
            controller.enqueue(
              encoder.encode(
                encodeSSE({
                  type: "validator",
                  stage: "research",
                  ok: fallbackValidation.ok,
                  checks: fallbackValidation.checks,
                })
              )
            )
            controller.enqueue(encoder.encode(encodeSSE({ type: "progress", progress: 100 })))

            completeTask(taskId, {
              provider: "fallback",
              progress: 100,
              payload: {
                ...taskPayload,
                fallbackReason: error instanceof Error ? error.message : "Research failed",
                sources: fallbackSources,
                insight: fallbackInsight,
                validator: fallbackValidation,
              },
            })

            if (memoryEnabled && projectId) {
              await Promise.allSettled([
                upsertLegacyPerformanceSummary(projectId, {
                  stage: "research",
                  success: true,
                  provider: "fallback",
                  source_count: fallbackSources.length,
                  fallback_reason: error instanceof Error ? error.message : "Research failed",
                  recorded_at: new Date().toISOString(),
                }),
              ])
            }
            controller.close()
            return
          }

          failTask(
            taskId,
            {
              code: classifyResearchErrorCode(error),
              message: error instanceof Error ? error.message : "Research failed",
              retriable: true,
            },
            {
              payload: {
                ...taskPayload,
                sources: streamSources,
                insight: streamInsight,
                validator: fallbackValidation,
              },
            }
          )
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "error",
                code: classifyResearchErrorCode(error),
                message: error instanceof Error ? error.message : "Research failed",
                retriable: true,
              })
            )
          )

          if (memoryEnabled && projectId) {
            await Promise.allSettled([
              upsertLegacyPerformanceSummary(projectId, {
                stage: "research",
                success: false,
                error: error instanceof Error ? error.message : "Research failed",
                recorded_at: new Date().toISOString(),
              }),
            ])
          }
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "Research request failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
