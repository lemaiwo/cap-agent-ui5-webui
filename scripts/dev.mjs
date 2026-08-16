#!/usr/bin/env node
/**
 * Development loop for this plugin.
 *
 * Runs the sample CAP project (test/fixture/bookshop) against the plugin and
 * rebuilds the UI whenever anything under ui/webapp changes.
 *
 * Why a rebuild rather than live transpilation: the plugin serves a pre-built
 * dist/ via express.static, and that is the path consumers and the E2E suite
 * use. Developing against a *different* serving path is how a Component
 * bootstrap bug hid from every check until a browser first loaded the app.
 * A few seconds per rebuild buys fidelity.
 *
 * No server restart is needed after a rebuild — express.static reads from disk
 * per request, so refreshing the browser is enough.
 *
 * AGENT_LLM=scripted is injected into the child's environment rather than the
 * command string: `AGENT_LLM=scripted cds serve` is POSIX syntax that fails in
 * PowerShell. Without it the bundled mock LLM can only ever call the read tool,
 * so the human-in-the-loop approval flow is unreachable.
 */

import { spawn } from "node:child_process"
import { watch } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const uiDir = join(root, "ui", "webapp")
const fixtureDir = join(root, "test", "fixture", "bookshop")
const URL = "http://localhost:4004/chat/index.html"

/**
 * npm and npx are .cmd shims on Windows, and since Node's CVE-2024-27980 fix
 * spawning a .cmd with shell:false throws EINVAL. Use a shell there and only
 * there — the arguments below are all fixed literals, so there is nothing to
 * quote-escape.
 */
const isWindows = process.platform === "win32"
const npm = "npm"
const npx = "npx"

let server
let building = false
let queued = false
let debounce

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: isWindows, ...opts })
    child.on("close", (code) => resolve(code ?? 1))
    child.on("error", (err) => {
      console.error(`\n[dev] could not start ${cmd}: ${err.message}`)
      resolve(1)
    })
  })
}

/**
 * Rebuild dist/. Never throws and never exits — a syntax error mid-edit should
 * cost you a red build message, not the server you are testing against.
 */
async function build(reason) {
  if (building) {
    queued = true
    return
  }
  building = true
  console.log(`\n[dev] building (${reason})...`)
  const code = await run(npm, ["run", "build"], { cwd: root })
  building = false

  if (code === 0) console.log(`[dev] build ok - refresh ${URL}`)
  else console.error(`[dev] build FAILED (exit ${code}) - dist/ is unchanged, still watching`)

  if (queued) {
    queued = false
    await build("queued change")
  }
}

function startServer() {
  console.log("[dev] starting sample: test/fixture/bookshop (AGENT_LLM=scripted)")
  server = spawn(npx, ["cds", "serve", "--in-memory"], {
    cwd: fixtureDir,
    stdio: "inherit",
    shell: isWindows,
    env: { ...process.env, AGENT_LLM: "scripted" },
  })
  server.on("error", (err) => {
    console.error(`[dev] could not start the sample server: ${err.message}`)
    process.exit(1)
  })
  server.on("close", (code) => {
    // Only meaningful if the server dies on its own; Ctrl-C is handled below.
    if (code !== null && code !== 0) {
      console.error(`\n[dev] sample server exited with ${code} - is port 4004 already in use?`)
    }
    process.exit(code ?? 0)
  })
}

function startWatching() {
  try {
    watch(uiDir, { recursive: true }, (_event, file) => {
      if (!file) return
      clearTimeout(debounce)
      // One save can emit several events; collapse them into a single build.
      debounce = setTimeout(() => void build(String(file)), 150)
    })
    console.log("[dev] watching ui/webapp for changes")
  } catch (err) {
    console.error(`[dev] could not watch ui/webapp: ${err.message}`)
    console.error("[dev] continuing without watch - run `npm run build` by hand after UI changes")
  }
}

function shutdown() {
  console.log("\n[dev] shutting down")
  if (server && !server.killed) server.kill()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

console.log("[dev] initial build so you never start against stale dist/")
const first = await run(npm, ["run", "build"], { cwd: root })
if (first !== 0) {
  console.error("[dev] initial build failed - fix it before starting the sample")
  process.exit(first)
}

startServer()
startWatching()

console.log(`\n[dev] sample:  ${URL}`)
console.log("[dev] agents:  http://localhost:4004/chat/agents.json")
console.log("[dev] odata:   http://localhost:4004/odata/v4/catalog/Books")
console.log("[dev] try:     \"show me all books\", then \"order 1 copies of book 2\"\n")
