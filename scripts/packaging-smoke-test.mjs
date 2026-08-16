// Run from inside a throwaway directory where the packed tarball has just been
// `npm install`ed as a real dependency (see .github/workflows/ci.yml). Checks that
// what a consumer actually receives — the npm package, not this repo's checkout —
// contains what the README promises.
//
// Why this exists: the repo uses npm workspaces, so every other test resolves the
// plugin through the hoisted root node_modules tree, not through anything npm's
// packaging logic (the "files" field, the "exports" map) produced. That means no
// test in this repo can catch a packaging error — the exact class of bug that let
// the @langchain/core peer-dependency omission ship in Task 4, found only by
// reading, not by any test passing. This closes that gap by exercising the actual
// packaged artifact the way a first-time consumer would: install the tarball, then
// resolve it.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const pkgRoot = join("node_modules", "cap-agent-ui5-webui")

// Files a consumer needs, per the README: the plugin entry point, the built UI
// (proof `dist/` was actually included, not just declared in "files"), the runtime
// lib/, and the optional scripted-LLM test support export.
const requiredFiles = [
  "cds-plugin.js",
  "dist/index.html",
  "lib/config.mjs",
  "lib/discover.mjs",
  "lib/mount.mjs",
  "test-support/scripted-llm.mjs",
  "docs/templates/AGENTS.md.template",
]

// Subpaths a consumer imports by name, resolved through the package's "exports"
// map rather than the filesystem — this is what would have caught a missing or
// misconfigured exports subpath (e.g. the "./cds-plugin" entry CAP's
// require.resolve("<pkg>/cds-plugin") convention depends on).
const requiredExports = [
  "cap-agent-ui5-webui",
  "cap-agent-ui5-webui/cds-plugin",
  "cap-agent-ui5-webui/test-support/scripted-llm",
]

let ok = true

for (const rel of requiredFiles) {
  const full = join(pkgRoot, rel)
  if (!existsSync(full)) {
    console.error(`packaging smoke test: missing file in installed package: ${rel}`)
    ok = false
  }
}

for (const spec of requiredExports) {
  try {
    require.resolve(spec)
  } catch (err) {
    console.error(`packaging smoke test: failed to resolve "${spec}": ${err.message}`)
    ok = false
  }
}

if (!ok) {
  console.error("packaging smoke test: FAILED")
  process.exit(1)
}

console.log("packaging smoke test: ok — installed package contains everything the README promises")
