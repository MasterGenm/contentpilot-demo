import { NextRequest } from "next/server"

import { exportRequestSchema } from "@/lib/schemas"
import { withMeta } from "@/lib/server/api-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ExportFormat = "EXPORT_MD" | "EXPORT_HTML" | "EXPORT_JSON" | "EXPORT_ZIP"

interface ExportPayload {
  title?: string
  platform?: string
  content?: string
  hashtags?: string[]
  projectId?: string
  variantId?: string
}

interface ExportFile {
  filename: string
  mimeType: string
  content: string
}

function toMarkdown(payload: ExportPayload): string {
  const tags = payload.hashtags?.length ? payload.hashtags.map((t) => `#${t}`).join(" ") : ""
  return [
    `# ${payload.title || "ContentPilot Export"}`,
    "",
    `- Platform: ${payload.platform || "N/A"}`,
    `- ExportedAt: ${new Date().toISOString()}`,
    tags ? `- Tags: ${tags}` : "",
    "",
    payload.content || "",
  ]
    .filter(Boolean)
    .join("\n")
}

function toHtml(payload: ExportPayload): string {
  const escaped = (payload.content || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")

  const tags = payload.hashtags?.length ? payload.hashtags.map((t) => `#${t}`).join(" ") : ""

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${payload.title || "ContentPilot Export"}</title>
  <style>
    body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 0 auto; padding: 40px 20px; line-height: 1.7; }
    .meta { color: #666; font-size: 14px; margin-bottom: 16px; }
    .content { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${payload.title || "ContentPilot Export"}</h1>
  <div class="meta">Platform: ${payload.platform || "N/A"}</div>
  <div class="meta">ExportedAt: ${new Date().toISOString()}</div>
  ${tags ? `<div class="meta">Tags: ${tags}</div>` : ""}
  <hr/>
  <div class="content">${escaped}</div>
</body>
</html>`
}

function buildExportFile(format: ExportFormat, payload: ExportPayload): ExportFile {
  switch (format) {
    case "EXPORT_MD":
      return {
        content: toMarkdown(payload),
        filename: `contentpilot-${Date.now()}.md`,
        mimeType: "text/markdown",
      }
    case "EXPORT_HTML":
      return {
        content: toHtml(payload),
        filename: `contentpilot-${Date.now()}.html`,
        mimeType: "text/html",
      }
    case "EXPORT_JSON":
      return {
        content: JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            ...payload,
          },
          null,
          2
        ),
        filename: `contentpilot-${Date.now()}.json`,
        mimeType: "application/json",
      }
    case "EXPORT_ZIP":
      return {
        content: JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            note: "ZIP is not enabled in MVP. Returned JSON package instead.",
            files: [
              { name: "article.md", content: toMarkdown(payload) },
              { name: "article.html", content: toHtml(payload) },
              {
                name: "article.json",
                content: JSON.stringify(
                  {
                    title: payload.title,
                    platform: payload.platform,
                    content: payload.content,
                  },
                  null,
                  2
                ),
              },
            ],
          },
          null,
          2
        ),
        filename: `contentpilot-${Date.now()}-package.json`,
        mimeType: "application/json",
      }
    default:
      throw new Error(`unsupported_format:${format}`)
  }
}

export async function POST(request: NextRequest) {
  const meta = withMeta(request, "local-export")

  try {
    const body = await request.json()
    const parsedBody = exportRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return meta.error(
        {
          code: "VALIDATION_ERROR",
          message: "导出参数不合法",
          detail: JSON.stringify(parsedBody.error.flatten()),
          retriable: false,
        },
        400
      )
    }

    const format = parsedBody.data.format as ExportFormat
    const payload: ExportPayload = parsedBody.data.payload || {
      title: "ContentPilot Export",
      content: "",
      projectId: parsedBody.data.projectId,
      variantId: parsedBody.data.variantId,
    }

    const file = buildExportFile(format, payload)
    const buffer = Buffer.from(file.content, "utf8")

    return meta.ok({
      mode: "package",
      format,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: buffer.byteLength,
      contentBase64: buffer.toString("base64"),
    })
  } catch (error) {
    return meta.error(
      {
        code: "UNKNOWN_ERROR",
        message: "导出失败",
        detail: error instanceof Error ? error.message : undefined,
        retriable: true,
      },
      500
    )
  }
}
