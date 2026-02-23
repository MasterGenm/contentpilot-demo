interface ResearchSourceInput {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
}

interface ResearchPromptInput {
  query: string
  timeWindow: string
  sources: ResearchSourceInput[]
}

interface DraftPromptInput {
  topic: string
  toneInstruction: string
  audience: string
  minWords: number
  maxWords: number
  researchSummary: string
  sourceLines: string[]
}

interface RewritePromptInput {
  platformName: string
  style: string
  maxLength: number
  withHashtags: boolean
  sourceContent: string
}

export function buildResearchInsightPrompt(input: ResearchPromptInput): string {
  const sourceContext = input.sources
    .slice(0, 10)
    .map(
      (s, i) =>
        `[${i + 1}] 标题: ${s.title}\nURL: ${s.url}\n摘要: ${s.snippet || "无"}\n时间: ${s.publishedAt || "未知"}`
    )
    .join("\n\n")

  return [
    "你是内容策略分析师。请基于给定来源，输出可执行的选题研究结论。",
    "必须使用简体中文，不要输出英文段落。",
    "",
    `主题: ${input.query}`,
    `时间窗口: ${input.timeWindow}`,
    `来源数量: ${input.sources.length}`,
    "",
    "只输出 JSON，不要输出任何解释文本。",
    "JSON 字段必须完整：",
    "{",
    '  "summary": "120-220字中文总结，强调结论与证据",',
    '  "risks": ["风险1","风险2","风险3"],',
    '  "angles": ["角度1","角度2","角度3","角度4"],',
    '  "recommendedTitles": ["标题1","标题2","标题3","标题4","标题5"]',
    "}",
    "",
    "要求：",
    "1) 避免空话，结论必须可执行。",
    "2) 标题必须是中文标题。",
    "3) 风险要具体，不要泛泛而谈。",
    "",
    "参考来源：",
    sourceContext || "暂无来源",
  ].join("\n")
}

export function buildDraftPrompt(input: DraftPromptInput): string {
  return [
    "你是资深中文编辑，请生成可直接发布的中文 Markdown 初稿。",
    "必须使用简体中文，不要输出英文段落。",
    "",
    `主题: ${input.topic}`,
    `语气风格: ${input.toneInstruction}`,
    `目标受众: ${input.audience}`,
    `篇幅要求: ${input.minWords}-${input.maxWords} 字`,
    "",
    "结构要求：",
    "1) 标题 + 引言 + 正文 + 结尾",
    "2) 至少 3 个 H2 小节",
    "3) 每个小节要有可执行建议",
    "4) 结尾给出下一步行动清单",
    "",
    `研究摘要: ${input.researchSummary || "无"}`,
    "参考来源：",
    input.sourceLines.join("\n") || "无",
    "",
    "只输出 Markdown 正文，不要输出解释，不要输出 JSON。",
  ].join("\n")
}

export function buildRewritePrompt(input: RewritePromptInput): string {
  return [
    "你是多平台改写专家，请将原文改写为指定平台版本。",
    "必须使用简体中文，不要输出英文段落。",
    "",
    `平台: ${input.platformName}`,
    `风格: ${input.style}`,
    `正文最大长度: ${input.maxLength} 字符`,
    "",
    "只输出 JSON，不要输出任何解释文本。",
    "JSON 字段必须完整：",
    "{",
    '  "titleCandidates": ["标题1","标题2","标题3"],',
    '  "body": "改写后的正文",',
    `  "hashtags": ${input.withHashtags ? '["标签1","标签2","标签3"]' : "[]"}`,
    "}",
    "",
    "要求：保留核心观点，适配平台语境，避免机械复述。",
    "原文：",
    input.sourceContent,
  ].join("\n")
}

export function buildAssetPromptFromDraft(draftMarkdown: string): string {
  const firstLine = draftMarkdown.split("\n").find((line) => line.trim()) || "内容主题"
  return `中文内容封面图，写实风格，主题：${firstLine.slice(0, 80)}`
}

export interface ChatOrchestratorPromptInput {
  userMessage: string
  workflowStep: string
  projectTitle: string
  topicKeywords: string[]
  memoryProfile: Record<string, unknown>
  memoryProjectContext: Record<string, unknown>
  memoryPerformance: Array<Record<string, unknown>>
  memorySnippet?: string
}

export function buildChatOrchestratorPrompt(input: ChatOrchestratorPromptInput): string {
  return [
    "你是 ContentPilot 编排助手。",
    "你只做流程编排建议，不直接替代页面执行。",
    "必须使用简体中文回复。",
    "",
    "可选步骤：",
    "- research",
    "- drafts",
    "- rewrite",
    "- assets",
    "- publish",
    "- analytics",
    "",
    `当前步骤: ${input.workflowStep || "research"}`,
    `项目标题: ${input.projectTitle || "未命名项目"}`,
    `主题关键词: ${(input.topicKeywords || []).join(", ") || "无"}`,
    "",
    "用户消息：",
    input.userMessage,
    "",
    "记忆画像：",
    JSON.stringify(input.memoryProfile || {}),
    "",
    "项目上下文：",
    JSON.stringify(input.memoryProjectContext || {}),
    "",
    "历史表现摘要：",
    JSON.stringify(input.memoryPerformance || []),
    "",
    `记忆片段: ${input.memorySnippet || "无"}`,
    "",
    "只输出 JSON：",
    "{",
    '  "reply": "中文、简洁、可执行",',
    '  "suggestedStep": "research|drafts|rewrite|assets|publish|analytics",',
    '  "reason": "建议该步骤的原因",',
    '  "profileUpdate": {',
    '    "preferred_tone": "可选",',
    '    "preferred_platform": "可选",',
    '    "target_audience": "可选"',
    "  }",
    "}",
  ].join("\n")
}
