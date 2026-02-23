import { NextResponse } from "next/server"
import { proxyLegacyJson } from "@/lib/legacy-backend"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const resp = await proxyLegacyJson("/api/content/workflow", {
      method: "POST",
      body: JSON.stringify(body || {}),
    })
    const data = await resp.json().catch(() => ({}))
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to connect to legacy backend /api/content/workflow",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    )
  }
}
