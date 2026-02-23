import { z } from "zod"

export const researchInsightSchema = z.object({
  summary: z.string().min(1),
  risks: z.array(z.string()).default([]),
  angles: z.array(z.string()).default([]),
  recommendedTitles: z.array(z.string()).default([]),
})

export const rewriteVariantSchema = z.object({
  titleCandidates: z.array(z.string()).default([]),
  body: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
})

const exportPayloadSchema = z.object({
  title: z.string().optional(),
  platform: z.string().optional(),
  content: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  variantId: z.string().optional(),
})

export const exportRequestSchema = z.object({
  projectId: z.string().optional(),
  variantId: z.string().optional(),
  format: z.enum(["EXPORT_MD", "EXPORT_HTML", "EXPORT_JSON", "EXPORT_ZIP"]),
  payload: exportPayloadSchema.optional(),
})

export type ResearchInsightSchema = z.infer<typeof researchInsightSchema>
export type RewriteVariantSchema = z.infer<typeof rewriteVariantSchema>
export type ExportRequestSchema = z.infer<typeof exportRequestSchema>

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
}
