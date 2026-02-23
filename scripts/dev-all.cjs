const { spawn, spawnSync } = require("child_process")
const path = require("path")
const fs = require("fs")

const root = path.resolve(__dirname, "..")
const isWin = process.platform === "win32"

function writePrefixed(prefix, chunk, isErr = false) {
  const text = String(chunk)
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    const out = `[${prefix}] ${line}\n`
    if (isErr) {
      process.stderr.write(out)
    } else {
      process.stdout.write(out)
    }
  }
}

function resolvePython() {
  const candidates = isWin ? ["python", "py"] : ["python3", "python"]
  for (const cmd of candidates) {
    const args = cmd === "py" ? ["-3", "--version"] : ["--version"]
    const probe = spawnSync(cmd, args, { cwd: root, encoding: "utf8" })
    if (!probe.error && probe.status === 0) {
      return {
        command: cmd,
        prefixArgs: cmd === "py" ? ["-3"] : [],
      }
    }
  }
  return null
}

function spawnProc(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdout.on("data", (d) => writePrefixed(name, d, false))
  child.stderr.on("data", (d) => writePrefixed(name, d, true))
  return child
}

function resolveNextRunner(nextPort) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next")
  if (fs.existsSync(nextBin)) {
    return {
      command: process.execPath,
      args: [nextBin, "dev", "-p", String(nextPort)],
      label: "node-next-bin",
    }
  }
  const npmCmd = isWin ? "npm.cmd" : "npm"
  return {
    command: npmCmd,
    args: ["run", "dev", "--", "-p", String(nextPort)],
    label: "npm-dev",
  }
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve()
      return
    }

    if (isWin) {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
      killer.on("exit", () => resolve())
      killer.on("error", () => resolve())
      return
    }

    child.kill("SIGTERM")
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // ignore
      }
      resolve()
    }, 2500)
    child.on("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function main() {
  const py = resolvePython()
  if (!py) {
    console.error("[dev:all] Python not found. Install Python or add it to PATH.")
    process.exit(1)
  }

  const legacyArgs = [...py.prefixArgs, "main.py"]
  const nextPort = String(process.env.NEXT_DEV_PORT || "3000").trim() || "3000"
  const nextRunner = resolveNextRunner(nextPort)

  console.log(`[dev:all] starting legacy backend + Next.js (next:${nextPort}, runner=${nextRunner.label})`)
  const legacy = spawnProc("legacy", py.command, legacyArgs)
  const next = spawnProc("next", nextRunner.command, nextRunner.args)
  const children = [legacy, next]

  let shuttingDown = false
  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[dev:all] shutting down: ${reason}`)
    await Promise.all(children.map((c) => killTree(c)))
    process.exit(exitCode)
  }

  legacy.on("exit", (code, signal) => {
    if (shuttingDown) return
    shutdown(`legacy exited (code=${code ?? "null"} signal=${signal ?? "null"})`, code || 1)
  })

  next.on("exit", (code, signal) => {
    if (shuttingDown) return
    shutdown(`next exited (code=${code ?? "null"} signal=${signal ?? "null"})`, code || 1)
  })

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((err) => {
  console.error("[dev:all] fatal:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
