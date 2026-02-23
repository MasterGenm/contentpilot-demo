import { NextRequest } from "next/server"
import { generateImage } from "@/lib/server/openai"
import { withMeta } from "@/lib/server/api-response"
import { completeTask, failTask, upsertTask } from "@/lib/server/task-registry"
import { verifyAssetResult } from "@/lib/server/workflow-verifier"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const meta = withMeta(request)

  try {
    const body = await request.json()
    const projectId = String(body?.projectId || "").trim()
    const traceId = String(body?.traceId || request.headers.get("x-trace-id") || "").trim()
    const idempotencyKey = String(body?.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
    const taskId = idempotencyKey || traceId || meta.requestId
    const prompt = String(body?.prompt || "").trim()
    const imageSize = String(body?.size || process.env.DASHSCOPE_IMAGE_SIZE || "1024x1024")
    const promptExtend =
      typeof body?.promptExtend === "boolean"
        ? body.promptExtend
        : String(process.env.DASHSCOPE_PROMPT_EXTEND || "false").toLowerCase() === "true"

    if (!prompt) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "prompt is required",
          retriable: false,
        },
        400
      )
    }

    upsertTask(taskId, {
      kind: "asset",
      status: "RUNNING",
      progress: 10,
      projectId: projectId || undefined,
      provider: "image-api",
      traceId: traceId || undefined,
      idempotencyKey: idempotencyKey || undefined,
      requestId: meta.requestId,
      payload: {
        prompt,
        size: imageSize,
        promptExtend,
      },
    })

    try {
      const generated = await generateImage({
        prompt,
        size: imageSize,
        promptExtend,
      })
      const validation = verifyAssetResult({
        imageUrl: generated.imageUrl,
        provider: generated.provider,
      })

      completeTask(taskId, {
        provider: generated.provider,
        progress: 100,
        payload: {
          imageUrl: generated.imageUrl,
          requestId: generated.requestId,
          revisedPrompt: generated.revisedPrompt,
          reasoningContent: generated.reasoningContent,
          usage: generated.usage,
          expiresAt: generated.expiresAt,
          note: generated.expiresAt
            ? "DashScope image URL is temporary. Save it promptly (usually within 24h)."
            : undefined,
          validator: validation,
        },
      })

      return meta.ok({
        imageUrl: generated.imageUrl,
        provider: generated.provider,
        requestId: generated.requestId,
        revisedPrompt: generated.revisedPrompt,
        reasoningContent: generated.reasoningContent,
        usage: generated.usage,
        expiresAt: generated.expiresAt,
        note: generated.expiresAt
          ? "DashScope image URL is temporary. Save it promptly (usually within 24h)."
          : undefined,
        validator: validation,
        message: "Image generated successfully",
      })
    } catch (error) {
      const seed = Math.random().toString(36).slice(2)
      const fallbackImageUrl = `https://picsum.photos/seed/${seed}/1024/1024`
      const validation = verifyAssetResult({
        imageUrl: fallbackImageUrl,
        provider: "placeholder",
      })

      completeTask(taskId, {
        provider: "placeholder",
        progress: 100,
        payload: {
          imageUrl: fallbackImageUrl,
          fallback: true,
          fallbackReason: error instanceof Error ? error.message : "Image API unavailable",
          validator: validation,
        },
      })

      return meta.ok({
        imageUrl: fallbackImageUrl,
        provider: "placeholder",
        validator: validation,
        message: error instanceof Error
          ? `Image API unavailable, fallback image used: ${error.message}`
          : "Image API unavailable, fallback image used",
      })
    }
  } catch (error) {
    const taskId = request.headers.get("idempotency-key") || request.headers.get("x-trace-id") || meta.requestId
    failTask(taskId, {
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Image generation failed",
      retriable: true,
    })

    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "Image generation failed",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
