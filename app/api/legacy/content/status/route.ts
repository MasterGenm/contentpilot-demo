import { NextResponse } from "next/server"
import { proxyLegacyJson } from "@/lib/legacy-backend"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const resp = await proxyLegacyJson("/api/content/status", {
      method: "GET",
    })
    const data = await resp.json().catch(() => ({}))
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to connect to legacy backend /api/content/status",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    )
  }
}
