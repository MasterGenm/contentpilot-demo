export interface WorkflowValidationCheck {
  key: string
  passed: boolean
  message: string
}

export interface WorkflowValidationResult {
  ok: boolean
  checks: WorkflowValidationCheck[]
}

function buildResult(checks: WorkflowValidationCheck[]): WorkflowValidationResult {
  return {
    ok: checks.every((item) => item.passed),
    checks,
  }
}

export function verifyResearchResult(input: {
  sources: Array<{ url?: string; title?: string }>
  insight?: { summary?: string; recommendedTitles?: string[] } | null
}): WorkflowValidationResult {
  const checks: WorkflowValidationCheck[] = [
    {
      key: "research.sources.min",
      passed: input.sources.length > 0,
      message:
        input.sources.length > 0
          ? "At least one source exists."
          : "No sources were generated.",
    },
    {
      key: "research.insight.summary",
      passed: Boolean(String(input.insight?.summary || "").trim()),
      message: String(input.insight?.summary || "").trim()
        ? "Insight summary is available."
        : "Insight summary is empty.",
    },
    {
      key: "research.insight.titles",
      passed: Array.isArray(input.insight?.recommendedTitles) && input.insight!.recommendedTitles!.length > 0,
      message:
        Array.isArray(input.insight?.recommendedTitles) && input.insight!.recommendedTitles!.length > 0
          ? "Recommended titles are available."
          : "Recommended titles are missing.",
    },
  ]
  return buildResult(checks)
}

export function verifyDraftResult(input: { content: string }): WorkflowValidationResult {
  const text = String(input.content || "")
  const checks: WorkflowValidationCheck[] = [
    {
      key: "draft.content.non_empty",
      passed: text.trim().length > 0,
      message: text.trim().length > 0 ? "Draft content exists." : "Draft content is empty.",
    },
    {
      key: "draft.content.min_chars",
      passed: text.trim().length >= 200,
      message:
        text.trim().length >= 200
          ? "Draft length is sufficient."
          : "Draft is too short (< 200 chars).",
    },
  ]
  return buildResult(checks)
}

export function verifyRewriteResult(input: {
  variants: Record<string, { body?: string; titleCandidates?: string[] }>
  requiredPlatforms: string[]
}): WorkflowValidationResult {
  const checks: WorkflowValidationCheck[] = []
  checks.push({
    key: "rewrite.variants.min",
    passed: Object.keys(input.variants).length > 0,
    message:
      Object.keys(input.variants).length > 0
        ? "At least one variant exists."
        : "No variants were generated.",
  })

  for (const platform of input.requiredPlatforms) {
    const row = input.variants[platform]
    const hasBody = Boolean(String(row?.body || "").trim())
    const hasTitle = Array.isArray(row?.titleCandidates) && row!.titleCandidates!.length > 0
    checks.push({
      key: `rewrite.${platform}.body`,
      passed: hasBody,
      message: hasBody ? `${platform} body exists.` : `${platform} body is missing.`,
    })
    checks.push({
      key: `rewrite.${platform}.title`,
      passed: hasTitle,
      message: hasTitle ? `${platform} title candidates exist.` : `${platform} title candidates are missing.`,
    })
  }

  return buildResult(checks)
}

export function verifyAssetResult(input: { imageUrl?: string; provider?: string }): WorkflowValidationResult {
  const imageUrl = String(input.imageUrl || "").trim()
  const provider = String(input.provider || "").trim()
  const checks: WorkflowValidationCheck[] = [
    {
      key: "asset.image.url",
      passed: imageUrl.length > 0,
      message: imageUrl.length > 0 ? "Image URL exists." : "Image URL is empty.",
    },
    {
      key: "asset.provider",
      passed: provider.length > 0,
      message: provider.length > 0 ? "Provider exists." : "Provider is empty.",
    },
  ]
  return buildResult(checks)
}

export function verifyPublishResult(input: {
  postId?: string | number
  editUrl?: string
  status?: string
}): WorkflowValidationResult {
  const checks: WorkflowValidationCheck[] = [
    {
      key: "publish.post_id",
      passed: Boolean(input.postId),
      message: input.postId ? "Post id exists." : "Post id is missing.",
    },
    {
      key: "publish.status",
      passed: Boolean(String(input.status || "").trim()),
      message: String(input.status || "").trim() ? "Status exists." : "Status is missing.",
    },
    {
      key: "publish.edit_url",
      passed: Boolean(String(input.editUrl || "").trim()),
      message: String(input.editUrl || "").trim() ? "Edit URL exists." : "Edit URL is missing.",
    },
  ]
  return buildResult(checks)
}

