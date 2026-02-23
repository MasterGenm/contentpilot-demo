import { NextRequest } from "next/server"

import { withMeta } from "@/lib/server/api-response"
import { completeTask, failTask, upsertTask } from "@/lib/server/task-registry"
import { verifyPublishResult } from "@/lib/server/workflow-verifier"
import {
  isLegacyMemoryEnabled,
  upsertLegacyPerformanceSummary,
  upsertLegacyProjectContext,
  upsertLegacyProfile,
} from "@/lib/server/legacy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PublishMode = "mock" | "live"

interface PublishResult {
  mode: PublishMode
  postId: string | number
  editUrl: string
  status: string
  message: string
  replayed?: boolean
}

declare global {
  var __contentpilotWpIdempotency: Map<string, PublishResult> | undefined
}

function getIdempotencyStore(): Map<string, PublishResult> {
  if (!globalThis.__contentpilotWpIdempotency) {
    globalThis.__contentpilotWpIdempotency = new Map<string, PublishResult>()
  }
  return globalThis.__contentpilotWpIdempotency
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function createBasicAuth(username: string, appPassword: string): string {
  const raw = `${username}:${appPassword}`
  return `Basic ${Buffer.from(raw).toString("base64")}`
}

function parseWpErrorCode(status: number): { code: "WP_AUTH_FAILED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE"; retriable: boolean } {
  if (status === 401 || status === 403) {
    return { code: "WP_AUTH_FAILED", retriable: false }
  }
  if (status === 429) {
    return { code: "RATE_LIMITED", retriable: true }
  }
  return { code: "PROVIDER_UNAVAILABLE", retriable: true }
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request, "wordpress")

  try {
    const body = await request.json()
    const projectId = String(body?.projectId || "").trim()
    const variantId = String(body?.variantId || "").trim()
    const title = String(body?.title || "").trim()
    const content = String(body?.content || "").trim()
    const excerpt = String(body?.excerpt || "").trim()
    const userId = String(body?.userId || "local-user").trim() || "local-user"
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const taskId = idempotencyKey || traceId || meta.requestId

    if (!projectId || !variantId || !content) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "projectId, variantId and content are required",
          retriable: false,
        },
        400
      )
    }

    const memoryEnabled = isLegacyMemoryEnabled()
    const recordPublishMemory = async (input: {
      success: boolean
      mode: PublishMode
      postId?: string | number
      status?: string
      error?: string
    }) => {
      if (!memoryEnabled || !projectId) return
      await Promise.allSettled([
        upsertLegacyProfile(userId, {
          last_publish_target: "wordpress",
        }),
        upsertLegacyProjectContext(projectId, {
          workflow_step: "publish",
          last_publish_target: "wordpress",
          last_publish_variant_id: variantId,
          last_publish_status: input.status || "",
          last_publish_mode: input.mode,
          last_publish_post_id: input.postId || "",
          updated_at: new Date().toISOString(),
        }),
        upsertLegacyPerformanceSummary(projectId, {
          stage: "publish",
          target: "wordpress",
          success: input.success,
          mode: input.mode,
          status: input.status || "",
          post_id: input.postId || "",
          error: input.error || "",
          recorded_at: new Date().toISOString(),
        }),
      ])
    }

    upsertTask(taskId, {
      kind: "publish",
      status: "RUNNING",
      progress: 10,
      projectId,
      provider: "wordpress",
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      requestId: meta.requestId,
      payload: {
        variantId,
        title,
      },
    })

    if (idempotencyKey) {
      const cached = getIdempotencyStore().get(idempotencyKey)
      if (cached) {
        const validation = verifyPublishResult({
          postId: cached.postId,
          editUrl: cached.editUrl,
          status: cached.status,
        })
        await recordPublishMemory({
          success: true,
          mode: cached.mode,
          postId: cached.postId,
          status: cached.status,
        })
        completeTask(taskId, {
          provider: cached.mode === "mock" ? "wordpress-mock" : "wordpress-live",
          progress: 100,
          payload: { ...cached, replayed: true, validator: validation },
        })
        return meta.ok({ ...cached, replayed: true, validator: validation })
      }
    }

    const wpBaseUrl = process.env.WORDPRESS_BASE_URL
    const wpUsername = process.env.WORDPRESS_USERNAME
    const wpAppPassword = process.env.WORDPRESS_APP_PASSWORD
    const wpStatus = process.env.WORDPRESS_POST_STATUS || "draft"

    if (!wpBaseUrl || !wpUsername || !wpAppPassword) {
      const mockPostId = Math.floor(Math.random() * 100000)
      const result: PublishResult = {
        mode: "mock",
        postId: mockPostId,
        editUrl: `https://example.com/wp-admin/post.php?post=${mockPostId}&action=edit`,
        status: "draft",
        message: "WordPress credentials not configured. Returned mock draft result.",
      }
      const validation = verifyPublishResult({
        postId: result.postId,
        editUrl: result.editUrl,
        status: result.status,
      })
      if (idempotencyKey) {
        getIdempotencyStore().set(idempotencyKey, result)
      }
      await recordPublishMemory({
        success: true,
        mode: result.mode,
        postId: result.postId,
        status: result.status,
      })
      completeTask(taskId, {
        provider: "wordpress-mock",
        progress: 100,
        payload: {
          mode: result.mode,
          postId: result.postId,
          editUrl: result.editUrl,
          status: result.status,
          message: result.message,
          replayed: result.replayed,
          validator: validation,
        },
      })
      return meta.ok({ ...result, validator: validation })
    }

    const endpoint = `${normalizeBaseUrl(wpBaseUrl)}/wp-json/wp/v2/posts`
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: createBasicAuth(wpUsername, wpAppPassword),
      },
      body: JSON.stringify({
        title: title || "ContentPilot Draft",
        content,
        excerpt: excerpt || undefined,
        status: wpStatus,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      const mapped = parseWpErrorCode(response.status)
      await recordPublishMemory({
        success: false,
        mode: "live",
        status: String(response.status),
        error: detail || mapped.code,
      })
      failTask(taskId, {
        code: mapped.code,
        message: "WordPress publish failed",
        retriable: mapped.retriable,
      })
      return meta.error(
        {
          code: mapped.code,
          message: "WordPress publish failed",
          detail,
          retriable: mapped.retriable,
        },
        response.status
      )
    }

    const post = await response.json()
    const result: PublishResult = {
      mode: "live",
      postId: post?.id,
      editUrl: post?.link || "",
      status: String(post?.status || wpStatus),
      message: "Draft pushed to WordPress successfully",
    }
    const validation = verifyPublishResult({
      postId: result.postId,
      editUrl: result.editUrl,
      status: result.status,
    })
    if (idempotencyKey) {
      getIdempotencyStore().set(idempotencyKey, result)
    }
    await recordPublishMemory({
      success: true,
      mode: result.mode,
      postId: result.postId,
      status: result.status,
    })
    completeTask(taskId, {
      provider: "wordpress-live",
      progress: 100,
      payload: {
        mode: result.mode,
        postId: result.postId,
        editUrl: result.editUrl,
        status: result.status,
        message: result.message,
        replayed: result.replayed,
        validator: validation,
      },
    })
    return meta.ok({ ...result, validator: validation })
  } catch (error) {
    const taskId = request.headers.get("idempotency-key") || request.headers.get("x-trace-id") || meta.requestId
    const memoryEnabled = isLegacyMemoryEnabled()
    if (memoryEnabled) {
      const body = await request.clone().json().catch(() => ({}))
      const projectId = String(body?.projectId || "").trim()
      if (projectId) {
        await Promise.allSettled([
          upsertLegacyPerformanceSummary(projectId, {
            stage: "publish",
            target: "wordpress",
            success: false,
            mode: "live",
            error: error instanceof Error ? error.message : "WordPress publish failed",
            recorded_at: new Date().toISOString(),
          }),
        ])
      }
    }
    failTask(taskId, {
      code: "PROVIDER_UNAVAILABLE",
      message: error instanceof Error ? error.message : "WordPress publish failed",
      retriable: true,
    })
    return meta.error(
      {
        code: "PROVIDER_UNAVAILABLE",
        message: "WordPress publish failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
