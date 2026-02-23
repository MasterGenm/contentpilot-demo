import { withMeta } from "@/lib/server/api-response"

export async function GET(request: Request) {
  const meta = withMeta(request)
  return meta.ok({ message: "Hello, world!" })
}
