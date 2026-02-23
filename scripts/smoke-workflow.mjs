import { spawn } from "node:child_process"

const port = Number(process.env.SMOKE_PORT || 3102)
const baseUrl = `http://127.0.0.1:${port}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function waitForServer(timeoutMs = 60000) {
  const started = Date.now()
  let lastError = ""
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/api/providers/health`,
        { method: "GET" },
        8000
      )
      if (res.ok || res.status === 500) return
      lastError = `status=${res.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(1200)
  }
  throw new Error(`Server startup timeout. lastError=${lastError}`)
}

async function parseSseResponse(response) {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SSE request failed (${response.status}): ${body}`)
  }
  const text = await response.text()
  const events = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // ignore non-json lines
    }
  }
  return events
}

async function postSse(path, payload) {
  const resp = await fetchWithTimeout(
    `${baseUrl}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    },
    120000
  )
  return parseSseResponse(resp)
}

async function postJson(path, payload) {
  const resp = await fetchWithTimeout(
    `${baseUrl}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    },
    45000
  )
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || json?.ok === false) {
    throw new Error(json?.error?.message || `Request failed (${resp.status})`)
  }
  return json?.data || json
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function pickLast(events, type) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === type) return events[i]
  }
  return null
}

async function runSmoke() {
  const projectId = `smoke-${Date.now()}`
  const idempotencyBase = crypto.randomUUID()

  const researchEvents = await postSse("/api/research/start", {
    projectId,
    query: "personal IP positioning and monetization path",
    timeWindow: "7d",
    tool: "WEB_SEARCH",
    idempotencyKey: `${idempotencyBase}-research`,
    userId: "smoke-user",
  })
  const researchSources = researchEvents.filter((evt) => evt.type === "source")
  const researchInsight = pickLast(researchEvents, "insight")
  const researchValidator = pickLast(researchEvents, "validator")
  assert(researchSources.length > 0, "research has no source events")
  assert(Boolean(researchValidator?.ok), "research validator failed")
  const researchSummary = String(researchInsight?.summary || "smoke fallback summary")

  const draftEvents = await postSse("/api/draft/generate", {
    projectId,
    topic: "personal IP growth route",
    tone: "professional",
    length: "medium",
    audience: "media team",
    researchSummary,
    sources: researchSources.slice(0, 5).map((s) => ({ title: s.title, url: s.url })),
    idempotencyKey: `${idempotencyBase}-draft`,
    userId: "smoke-user",
  })
  const draftText = draftEvents
    .filter((evt) => evt.type === "content")
    .map((evt) => String(evt.text || ""))
    .join("")
  const draftError = pickLast(draftEvents, "error")
  const draftValidator = pickLast(draftEvents, "validator")
  if (draftError?.message) {
    throw new Error(`draft_api_error:${draftError.message}`)
  }
  assert(draftText.trim().length >= 200, "draft output too short")
  assert(Boolean(draftValidator?.ok), "draft validator failed")

  const rewriteEvents = await postSse("/api/rewrite/generate", {
    projectId,
    draftId: `${projectId}-draft-v1`,
    draftContent: draftText,
    topic: "personal IP growth route",
    platforms: ["WECHAT", "XIAOHONGSHU", "WEIBO", "BILIBILI"],
    idempotencyKey: `${idempotencyBase}-rewrite`,
    userId: "smoke-user",
  })
  const rewriteVariants = rewriteEvents.filter((evt) => evt.type === "variant")
  const rewriteValidator = pickLast(rewriteEvents, "validator")
  assert(rewriteVariants.length >= 1, "rewrite generated no variant")
  assert(Boolean(rewriteValidator?.ok), "rewrite validator failed")

  const firstVariant = rewriteVariants[0] || {}
  const assetsData = await postJson("/api/assets/generate-image", {
    projectId,
    prompt: `cover image prompt: ${String(firstVariant?.body || draftText).slice(0, 120)}`,
    size: "1024x1024",
    idempotencyKey: `${idempotencyBase}-asset`,
  })
  assert(Boolean(assetsData?.imageUrl), "asset has no imageUrl")
  assert(Boolean(assetsData?.validator?.ok), "asset validator failed")

  const publishData = await postJson("/api/publish/wordpress-draft", {
    projectId,
    variantId: `${projectId}-variant-1`,
    title: String(firstVariant?.titleCandidates?.[0] || "Smoke Publish"),
    content: String(firstVariant?.body || draftText).slice(0, 1800),
    excerpt: String(firstVariant?.body || draftText).slice(0, 120),
    idempotencyKey: `${idempotencyBase}-publish`,
    userId: "smoke-user",
  })
  assert(Boolean(publishData?.postId), "publish has no postId")
  assert(Boolean(publishData?.validator?.ok), "publish validator failed")

  return {
    researchSources: researchSources.length,
    draftChars: draftText.length,
    rewriteVariants: rewriteVariants.length,
    assetProvider: assetsData?.provider,
    publishMode: publishData?.mode,
    publishPostId: publishData?.postId,
  }
}

async function main() {
  const logs = { stdout: "", stderr: "" }
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npx next start -p ${port}`], {
          cwd: process.cwd(),
          env: process.env,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn("npx", ["next", "start", "-p", String(port)], {
          cwd: process.cwd(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        })

  child.stdout.on("data", (chunk) => {
    logs.stdout += chunk.toString()
  })
  child.stderr.on("data", (chunk) => {
    logs.stderr += chunk.toString()
  })

  try {
    await waitForServer()
    const result = await runSmoke()
    console.log(JSON.stringify({ ok: true, result }, null, 2))
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          logs,
        },
        null,
        2
      )
    )
    process.exitCode = 1
  } finally {
    if (child.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        })
      } else if (!child.killed) {
        child.kill("SIGTERM")
        await sleep(500)
        if (!child.killed) child.kill("SIGKILL")
      }
    }
  }
}

main()
