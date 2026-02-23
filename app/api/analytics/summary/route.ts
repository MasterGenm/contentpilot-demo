import { NextRequest } from "next/server"
import { withMeta } from "@/lib/server/api-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export async function GET(request: NextRequest) {
  const meta = withMeta(request)

  const sp = request.nextUrl.searchParams
  const projectsCount = toInt(sp.get("projectsCount"), 0)
  const draftsCount = toInt(sp.get("draftsCount"), 0)
  const publishTotal = toInt(sp.get("publishTotal"), 0)
  const publishSuccess = toInt(sp.get("publishSuccess"), 0)
  const avgCycleMinutes = toInt(sp.get("avgCycleMinutes"), 0)

  const publishSuccessRate = publishTotal > 0
    ? Number(((publishSuccess / publishTotal) * 100).toFixed(2))
    : 0

  return meta.ok({
    window: sp.get("window") || "7d",
    projectsCount,
    draftsCount,
    publishTotal,
    publishSuccess,
    publishSuccessRate,
    avgCycleMinutes,
    generatedAt: new Date().toISOString(),
  })
}
