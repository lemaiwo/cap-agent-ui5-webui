#!/usr/bin/env node
/**
 * Runs the hybrid test suite: the sample agent against a REAL model on SAP AI Core.
 *
 * Starts the fixture with `cds watch --profile hybrid`, waits for it to answer,
 * runs test/hybrid, then tears the server down.
 *
 * These tests are deliberately NOT part of `npm test` and never run in CI: they
 * need a service binding no runner has, they cost money per run, and they are
 * slower than everything else by an order of magnitude.
 *
 * Missing prerequisites SKIP rather than fail. A contributor without AI Core
 * access should not see red for something they were never expected to run.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const fixtureDir = join(root, "test", "fixture", "bookshop")
const BASE = "http://localhost:4004"
const READY_URL = `${BASE}/a2a/catalog/.well-known/agent-card.json`

const isWindows = process.platform === "win32"

function skip(reason, remedy) {
  console.log(`\n[hybrid] SKIPPED - ${reason}\n`)
  for (const line of remedy) console.log(`  ${line}`)
  console.log("")
  process.exit(0)
}

// --- preflight -------------------------------------------------------------

if (!existsSync(join(fixtureDir, ".cdsrc-private.json"))) {
  skip("the sample has no service binding", [
    "Hybrid runs against a real LLM on SAP AI Core, which needs a binding:",
    "",
    "  cf login",
    "  cd test/fixture/bookshop",
    "  cds bind -2 <instance>:<service-key>      # e.g. aicore:aicore-key",
    "",
    "Then re-run: npm run test:hybrid",
  ])
}

// --- server ----------------------------------------------------------------

// `cds watch` (from @sap/cds-dk) is required, not `cds-serve`: cds bind records
// only a reference to the CF instance and key, and resolving it into the
// VCAP_SERVICES the SAP AI SDK reads happens at startup in cds watch.
const env = { ...process.env }
delete env.AGENT_LLM // the scripted double would shadow the real model

console.log("[hybrid] starting sample with a real LLM (cds watch --profile hybrid)")
const server = spawn("npx", ["cds", "watch", "--profile", "hybrid"], {
  cwd: fixtureDir,
  stdio: ["ignore", "pipe", "pipe"],
  shell: isWindows,
  env,
})

let serverOutput = ""
server.stdout.on("data", (d) => (serverOutput += d))
server.stderr.on("data", (d) => (serverOutput += d))

let stopped = false
function stopServer() {
  if (stopped) return
  stopped = true
  if (!server.killed) server.kill()
}
process.on("SIGINT", () => {
  stopServer()
  process.exit(130)
})

async function waitForReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false
    try {
      const res = await fetch(READY_URL, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

const ready = await waitForReady()

if (!ready) {
  stopServer()
  // A missing cds CLI is the most common cause and worth naming explicitly,
  // rather than making the reader parse a stack trace for it.
  if (/could not determine executable|not recognized|command not found/i.test(serverOutput)) {
    skip("the `cds` CLI is not available", [
      "Hybrid needs @sap/cds-dk at runtime (normal `npm run dev` does not):",
      "",
      "  npm i -g @sap/cds-dk",
      "",
      "Then re-run: npm run test:hybrid",
    ])
  }
  console.error("[hybrid] the sample server never became ready. Output:\n")
  console.error(serverOutput.slice(-2000))
  process.exit(1)
}

console.log("[hybrid] server ready - running tests against a real model\n")

// --- tests -----------------------------------------------------------------

// Named explicitly rather than passing the directory: node --test resolves a
// bare directory path as a module on Windows and fails with MODULE_NOT_FOUND.
// The other test scripts in this repo list their files for the same reason.
const tests = spawn("node", ["--test", "test/hybrid/agent.hybrid.test.mjs"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, HYBRID_BASE_URL: BASE },
})

tests.on("close", (code) => {
  stopServer()
  if (code === 0) console.log("\n[hybrid] passed against the real model")
  else console.error(`\n[hybrid] FAILED (exit ${code})`)
  process.exit(code ?? 1)
})

tests.on("error", (err) => {
  console.error(`[hybrid] could not run the tests: ${err.message}`)
  stopServer()
  process.exit(1)
})
