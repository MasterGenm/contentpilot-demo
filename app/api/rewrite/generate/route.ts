import { NextRequest } from "next/server"
import { createChatCompletion, hasChatModelConfig } from "@/lib/server/openai"
import { encodeSSE } from "@/lib/server/sse"
import { buildLegacyUrl } from "@/lib/legacy-backend"
import { withMeta } from "@/lib/server/api-response"
import { buildRewritePrompt } from "@/lib/prompts"
import { extractJsonObject, rewriteVariantSchema } from "@/lib/schemas"
import { completeTask, failTask, patchTask, upsertTask } from "@/lib/server/task-registry"
import { verifyRewriteResult } from "@/lib/server/workflow-verifier"
import {
  ingestLegacyConversation,
  isLegacyMemoryEnabled,
  retrieveLegacyMemory,
  upsertLegacyPerformanceSummary,
  upsertLegacyProjectContext,
} from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Platform = "WECHAT" | "XIAOHONGSHU" | "WEIBO" | "BILIBILI"

const platformConfigs: Record<
  Platform,
  {
    platformName: string
    maxLength: number
    style: string
    hashtags: boolean
  }
> = {
  WECHAT: {
    platformName: "微信公众号",
    maxLength: 20000,
    style: "结构清晰、信息密度高、适合深度阅读",
    hashtags: false,
  },
  XIAOHONGSHU: {
    platformName: "小红书笔记",
    maxLength: 1200,
    style: "口语化、场景化、强调体验与结论",
    hashtags: true,
  },
  WEIBO: {
    platformName: "微博短帖",
    maxLength: 800,
    style: "短句高密度、观点鲜明、节奏快",
    hashtags: true,
  },
  BILIBILI: {
    platformName: "B站口播稿",
    maxLength: 4000,
    style: "口语化分段、镜头感强、适合口播",
    hashtags: true,
  },
}

function safeParseVariant(text: string) {
  const fallback = {
    titleCandidates: [] as string[],
    body: text,
    hashtags: [] as string[],
  }

  try {
    const parsedObj = extractJsonObject(text)
    if (!parsedObj) return fallback
    const parsed = rewriteVariantSchema.parse(parsedObj)
    return {
      titleCandidates: parsed.titleCandidates,
      body: parsed.body,
      hashtags: parsed.hashtags,
    }
  } catch {
    return fallback
  }
}

function buildFallbackVariant(platform: Platform, content: string) {
  const shortBody = content.slice(0, platformConfigs[platform].maxLength)
  return {
    titleCandidates: [`${platformConfigs[platform].platformName}：快速版`],
    body: shortBody,
    hashtags: platformConfigs[platform].hashtags ? ["内容创作", "选题研究", "多平台发布"] : [],
  }
}

async function fetchLegacyVariants(topic: string, platforms: Platform[]): Promise<Record<string, ReturnType<typeof buildFallbackVariant>> | null> {
  if (String(process.env.USE_LEGACY_CONTENT_WORKFLOW || "").toLowerCase() !== "true") {
    return null
  }

  const resp = await fetch(buildLegacyUrl("/api/content/workflow"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      topic,
      platforms,
      include_report: false,
    }),
  })

  if (!resp.ok) return null

  const data = (await resp.json().catch(() => ({}))) as {
    success?: boolean
    variants?: Array<{ platform?: string; title_candidates?: string[]; body?: string; hashtags?: string[] }>
  }

  if (!data.success || !Array.isArray(data.variants)) {
    return null
  }

  const mapped: Record<string, ReturnType<typeof buildFallbackVariant>> = {}
  for (const item of data.variants) {
    const key = String(item.platform || "")
    if (!key) continue
    mapped[key] = {
      titleCandidates: Array.isArray(item.title_candidates) ? item.title_candidates : [],
      body: String(item.body || ""),
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
    }
  }

  return mapped
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
    const draftId = String(body?.draftId || "").trim()
    const draftContent = String(body?.draftContent || "").trim()
    const topic = String(body?.topic || "").trim() || draftContent.slice(0, 40)
    const requestedPlatforms: Platform[] = Array.isArray(body?.platforms) ? body.platforms : []
    const userId = String(body?.userId || "local-user").trim() || "local-user"

    const memoryEnabled = isLegacyMemoryEnabled()
    const memorySnapshot = await retrieveLegacyMemory({
      userId,
      projectId,
      query: topic || draftId,
      performanceLimit: 5,
    })
    const memoryProfile =
      memorySnapshot?.profile && typeof memorySnapshot.profile === "object"
        ? (memorySnapshot.profile as Record<string, unknown>)
        : {}
    const preferredPlatform = String(memoryProfile.preferred_platform || "").trim().toUpperCase()
    const memorySnippet =
      typeof memorySnapshot?.grag_memory === "string" ? memorySnapshot.grag_memory.slice(0, 500) : ""

    const platforms = [...requestedPlatforms]
    if (preferredPlatform && platforms.includes(preferredPlatform as Platform)) {
      platforms.sort((a, b) => {
        if (a === preferredPlatform) return -1
        if (b === preferredPlatform) return 1
        return 0
      })
    }

    if (!draftId || platforms.length === 0) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "draftId and platforms are required",
          retriable: false,
        },
        400
      )
    }

    const sourceContent = memorySnippet
      ? `${draftContent || `DraftRef:${draftId}`}\n\nMemory hints:\n${memorySnippet}`
      : draftContent || `DraftRef:${draftId}`

    const stream = new ReadableStream({
      async start(controller) {
        const taskVariants: Record<string, ReturnType<typeof buildFallbackVariant>> = {}
        const taskErrors: Array<{ platform: string; message: string }> = []

        upsertTask(taskId, {
          kind: "rewrite",
          status: "RUNNING",
          progress: 0,
          projectId: projectId || undefined,
          provider: "llm",
          traceId: traceId || undefined,
          idempotencyKey: idempotencyKey || undefined,
          requestId: meta.requestId,
          payload: {
            topic,
            draftId,
            platforms,
          },
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
          patchTask(taskId, { progress: 10 })

          const legacyVariants = await fetchLegacyVariants(topic, platforms)
          let handledPlatforms = 0

          for (const platform of platforms) {
            const config = platformConfigs[platform]
            if (!config) {
              taskErrors.push({ platform, message: `Unsupported platform: ${platform}` })
              controller.enqueue(
                encoder.encode(
                  encodeSSE({ type: "error", platform, message: `Unsupported platform: ${platform}` })
                )
              )
              continue
            }

            try {
              let variant: ReturnType<typeof buildFallbackVariant>
              if (legacyVariants?.[platform]) {
                variant = legacyVariants[platform]
              } else if (hasChatModelConfig()) {
                const prompt = buildRewritePrompt({
                  platformName: config.platformName,
                  style: config.style,
                  maxLength: config.maxLength,
                  withHashtags: config.hashtags,
                  sourceContent,
                })

                const responseText = await createChatCompletion({
                  messages: [
                    { role: "system", content: "你是多平台内容改写专家，输出严格遵循指定结构。" },
                    { role: "user", content: prompt },
                  ],
                  responseFormat: { type: "json_object" },
                  temperature: 0.7,
                  maxTokens: 1400,
                })
                variant = safeParseVariant(responseText)
              } else {
                variant = buildFallbackVariant(platform, sourceContent)
              }
              taskVariants[platform] = variant

              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "variant",
                    platform,
                    titleCandidates: variant.titleCandidates,
                    body: variant.body,
                    hashtags: variant.hashtags,
                  })
                )
              )
            } catch (error) {
              const fallbackVariant = buildFallbackVariant(platform, sourceContent)
              taskVariants[platform] = fallbackVariant
              taskErrors.push({
                platform,
                message: error instanceof Error ? error.message : `Generate ${platform} failed`,
              })
              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "variant",
                    platform,
                    titleCandidates: fallbackVariant.titleCandidates,
                    body: fallbackVariant.body,
                    hashtags: fallbackVariant.hashtags,
                    fallback: true,
                  })
                )
              )
              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "error",
                    platform,
                    message: error instanceof Error ? error.message : `Generate ${platform} failed`,
                  })
                )
              )
            }

            handledPlatforms += 1
            const progress = Math.min(
              95,
              Math.round((handledPlatforms / Math.max(platforms.length, 1)) * 100)
            )
            patchTask(taskId, {
              progress,
              payload: {
                variants: taskVariants,
                errors: taskErrors,
              },
            })
          }

          if (Object.keys(taskVariants).length === 0) {
            throw new Error("No platform variants generated")
          }

          const validation = verifyRewriteResult({
            variants: taskVariants,
            requiredPlatforms: platforms,
          })
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "validator",
                stage: "rewrite",
                ok: validation.ok,
                checks: validation.checks,
              })
            )
          )
          if (!validation.ok) {
            throw new Error(
              `rewrite_validation_failed:${validation.checks
                .filter((item) => !item.passed)
                .map((item) => item.key)
                .join(",")}`
            )
          }

          completeTask(taskId, {
            progress: 100,
            payload: {
              variants: taskVariants,
              errors: taskErrors,
              validator: validation,
            },
          })

          if (memoryEnabled && projectId) {
            await Promise.allSettled([
              upsertLegacyProjectContext(projectId, {
                workflow_step: "rewrite",
                last_rewrite_topic: topic,
                preferred_platform: preferredPlatform || undefined,
                rewrite_platforms: platforms,
                variants_count: Object.keys(taskVariants).length,
                updated_at: new Date().toISOString(),
              }),
              upsertLegacyPerformanceSummary(projectId, {
                stage: "rewrite",
                success: true,
                topic,
                variants_count: Object.keys(taskVariants).length,
                error_count: taskErrors.length,
                recorded_at: new Date().toISOString(),
              }),
              ingestLegacyConversation(topic || draftId, JSON.stringify(taskVariants).slice(0, 2000)),
            ])
          }
          controller.close()
        } catch (error) {
          failTask(
            taskId,
            {
              code: "PROVIDER_UNAVAILABLE",
              message: error instanceof Error ? error.message : "Rewrite failed",
              retriable: true,
            },
            {
              payload: {
                variants: taskVariants,
                errors: taskErrors,
              },
            }
          )
          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "error",
                message: error instanceof Error ? error.message : "Rewrite failed",
              })
            )
          )

          if (memoryEnabled && projectId) {
            await Promise.allSettled([
              upsertLegacyPerformanceSummary(projectId, {
                stage: "rewrite",
                success: false,
                topic,
                error: error instanceof Error ? error.message : "Rewrite failed",
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
        message: "Rewrite request failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
