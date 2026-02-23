const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000"
const requestTimeoutMs = Number(process.env.SMOKE_RECOVERY_TIMEOUT_MS || 60000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function requestJson(path, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message || `request failed (${response.status})`)
  }
  return payload
}

async function run() {
  const projectId = `smoke-recover-${Date.now()}`
  const resumeTaskId = `resume-smoke-${Date.now()}`

  // 1) Intentionally fail a workflow run to create a recoverable task.
  const failedResp = await requestJson("/api/workflow/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      topic: "",
      timeWindow: "7d",
      researchTool: "WEB_SEARCH",
      generateAsset: false,
      publishToWordpress: false,
      resumeTaskId,
      traceId: `trace-${resumeTaskId}`,
      idempotencyKey: `idem-${resumeTaskId}`,
    }),
  })
  assert(failedResp?.ok === true, "workflow failure run should still return envelope ok=true")
  assert(failedResp?.data?.status === "FAILED", "first workflow run should be FAILED")
  assert(failedResp?.data?.recoverable === true, "failed workflow should be recoverable")

  // 2) Verify recover list can discover the task by project.
  const recoverListResp = await requestJson(`/api/workflow/recover/list?byProject=0&projectId=${encodeURIComponent(projectId)}&limit=20`)
  const listedTasks = Array.isArray(recoverListResp?.data?.tasks) ? recoverListResp.data.tasks : []
  const matchedTask = listedTasks.find((task) => String(task?.taskId || "") === resumeTaskId)
  assert(Boolean(matchedTask), "recover list should include the failed task")

  // 3) Recover the same task with valid inputs.
  const recoveredResp = await requestJson("/api/workflow/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      topic: "个人IP, 内容定位, 人设打造, 爆款选题, 商业化路径",
      timeWindow: "7d",
      researchTool: "WEB_SEARCH",
      tone: "professional",
      length: "medium",
      generateAsset: false,
      publishToWordpress: false,
      resumeTaskId,
      traceId: `trace-recover-${resumeTaskId}`,
      idempotencyKey: `idem-recover-${resumeTaskId}`,
    }),
  })
  assert(recoveredResp?.ok === true, "recovered run should return ok=true")
  assert(recoveredResp?.data?.status === "COMPLETED", "recovered run should be COMPLETED")

  // 4) Verify report export API works for the recovered task.
  const reportResp = await requestJson(`/api/workflow/report?taskId=${encodeURIComponent(resumeTaskId)}&format=json`)
  assert(reportResp?.ok === true, "report api should return ok=true")
  assert(reportResp?.data?.task?.taskId === resumeTaskId, "report taskId should match")

  return {
    baseUrl,
    projectId,
    resumeTaskId,
    failedStatus: failedResp?.data?.status,
    recoveredStatus: recoveredResp?.data?.status,
    reportStatus: reportResp?.data?.task?.status,
  }
}

run()
  .then((result) => {
    console.log(JSON.stringify({ ok: true, result }, null, 2))
  })
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          baseUrl,
          error: error instanceof Error ? error.message : String(error),
          hint: "请先启动 Next.js 服务（例如 npm run dev），再执行 smoke:workflow:recovery。",
        },
        null,
        2
      )
    )
    process.exitCode = 1
  })
