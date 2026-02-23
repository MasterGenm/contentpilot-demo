type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

interface ChatCompletionOptions {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: { type: "json_object" }
}

interface ImageGenerationOptions {
  prompt: string
  size?: string
  promptExtend?: boolean
}

interface ImageGenerationResult {
  imageUrl: string
  provider: string
  requestId?: string
  revisedPrompt?: string
  reasoningContent?: string
  usage?: {
    width?: number
    height?: number
    imageCount?: number
  }
  expiresAt?: string
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function getChatConfig() {
  const openaiApiKey = process.env.OPENAI_API_KEY
  const zhipuApiKey = process.env.ZHIPU_API_KEY || process.env.NAGA_API_KEY
  const model =
    process.env.OPENAI_MODEL ||
    process.env.QUERYENGINE_ZHIPU_MODEL ||
    process.env.QUERY_MODEL_NAME ||
    process.env.NAGA_MODEL_NAME ||
    "gpt-4o-mini"
  const baseUrl = normalizeBaseUrl(
    process.env.OPENAI_BASE_URL ||
      process.env.ZHIPU_BASE_URL ||
      process.env.NAGA_BASE_URL ||
      "https://api.openai.com/v1"
  )
  const apiKey = isZhipuCompatible(baseUrl, model)
    ? zhipuApiKey || openaiApiKey
    : openaiApiKey || zhipuApiKey
  return { apiKey, baseUrl, model }
}

function isZhipuCompatible(baseUrl: string, model: string): boolean {
  const b = String(baseUrl || "").toLowerCase()
  const m = String(model || "").toLowerCase()
  return b.includes("bigmodel.cn") || m.startsWith("glm-")
}

function extractAssistantText(data: any): string {
  const message = data?.choices?.[0]?.message
  const rawContent = message?.content

  if (typeof rawContent === "string" && rawContent.trim().length > 0) {
    return rawContent
  }

  if (Array.isArray(rawContent)) {
    const text = rawContent
      .map((item: any) => {
        if (typeof item === "string") return item
        if (item && typeof item.text === "string") return item.text
        return ""
      })
      .filter(Boolean)
      .join("\n")
      .trim()
    if (text.length > 0) return text
  }

  const reasoning = message?.reasoning_content
  if (typeof reasoning === "string" && reasoning.trim().length > 0) {
    return reasoning
  }

  return ""
}

function getImageConfig() {
  const apiKey = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY
  const baseUrl = normalizeBaseUrl(process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
  const model = process.env.IMAGE_MODEL || "gpt-image-1"
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY
  const dashscopeBaseUrl = normalizeBaseUrl(
    process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com"
  )
  const dashscopeModel = process.env.DASHSCOPE_IMAGE_MODEL || "z-image-turbo"
  const dashscopeSize = process.env.DASHSCOPE_IMAGE_SIZE || "1120*1440"
  const dashscopePromptExtend = String(process.env.DASHSCOPE_PROMPT_EXTEND || "false").toLowerCase() === "true"
  return {
    apiKey,
    baseUrl,
    model,
    dashscopeApiKey,
    dashscopeBaseUrl,
    dashscopeModel,
    dashscopeSize,
    dashscopePromptExtend,
  }
}

export function hasChatModelConfig(): boolean {
  return Boolean(getChatConfig().apiKey)
}

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
  const { apiKey, baseUrl, model: defaultModel } = getChatConfig()
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = options.model || defaultModel
  const payload: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1800,
    response_format: options.responseFormat,
  }
  if (isZhipuCompatible(baseUrl, model)) {
    payload.thinking = { type: "disabled" }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Chat completion failed (${response.status}): ${detail}`)
  }

  const data = await response.json()
  const content = extractAssistantText(data)
  if (!content) {
    throw new Error(`Chat completion returned empty content (model=${model})`)
  }
  return content
}

function toOpenAIImageSize(size: string): string {
  if (size.includes("*")) {
    return size.replace("*", "x")
  }
  return size
}

function extractDashscopeImage(result: Record<string, any>): ImageGenerationResult {
  const code = result?.code
  const message = result?.message
  if (code || message) {
    throw new Error(`DashScope error: ${code || "UnknownError"} - ${message || "No message"}`)
  }

  const requestId = result?.request_id ? String(result.request_id) : undefined
  const contentList = result?.output?.choices?.[0]?.message?.content
  const imageItem = Array.isArray(contentList)
    ? contentList.find((item: Record<string, any>) => typeof item?.image === "string")
    : undefined
  const textItem = Array.isArray(contentList)
    ? contentList.find((item: Record<string, any>) => typeof item?.text === "string")
    : undefined

  const imageUrl = imageItem?.image
  if (!imageUrl) {
    throw new Error("DashScope image generation returned no image url")
  }

  const reasoningContent = result?.output?.choices?.[0]?.message?.reasoning_content
  const usage = result?.usage || {}
  let expiresAt: string | undefined
  try {
    const urlObj = new URL(imageUrl)
    const expiresTs = urlObj.searchParams.get("Expires")
    if (expiresTs) {
      const ts = Number(expiresTs)
      if (!Number.isNaN(ts)) {
        expiresAt = new Date(ts * 1000).toISOString()
      }
    }
  } catch {
    expiresAt = undefined
  }

  return {
    imageUrl,
    provider: "dashscope",
    requestId,
    revisedPrompt: textItem?.text,
    reasoningContent: typeof reasoningContent === "string" ? reasoningContent : undefined,
    usage: {
      width: typeof usage.width === "number" ? usage.width : undefined,
      height: typeof usage.height === "number" ? usage.height : undefined,
      imageCount: typeof usage.image_count === "number" ? usage.image_count : undefined,
    },
    expiresAt,
  }
}

async function generateImageWithDashscope(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const { dashscopeApiKey, dashscopeBaseUrl, dashscopeModel, dashscopeSize, dashscopePromptExtend } = getImageConfig()
  if (!dashscopeApiKey) {
    throw new Error("DASHSCOPE_API_KEY is not configured")
  }

  const response = await fetch(`${dashscopeBaseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: dashscopeModel,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: options.prompt }],
          },
        ],
      },
      parameters: {
        prompt_extend: options.promptExtend ?? dashscopePromptExtend,
        size: options.size || dashscopeSize,
      },
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const code = data?.code || `HTTP_${response.status}`
    const message = data?.message || "Image generation failed"
    throw new Error(`DashScope error: ${code} - ${message}`)
  }

  return extractDashscopeImage(data)
}

async function generateImageWithOpenAICompatible(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const { apiKey, baseUrl, model } = getImageConfig()
  if (!apiKey) {
    throw new Error("IMAGE_API_KEY/OPENAI_API_KEY is not configured")
  }

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      size: toOpenAIImageSize(options.size || "1024x1024"),
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Image generation failed (${response.status}): ${detail}`)
  }

  const data = await response.json()
  const item = data?.data?.[0]
  if (item?.url) {
    return { imageUrl: item.url, provider: model }
  }

  if (item?.b64_json) {
    return {
      imageUrl: `data:image/png;base64,${item.b64_json}`,
      provider: model,
    }
  }

  throw new Error("Image generation returned no usable image data")
}

export async function generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const { dashscopeApiKey } = getImageConfig()
  if (dashscopeApiKey) {
    return generateImageWithDashscope(options)
  }
  return generateImageWithOpenAICompatible(options)
}
