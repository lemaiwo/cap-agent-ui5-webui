import test from "node:test"
import assert from "node:assert/strict"
import { resolveConfig } from "../../lib/config.mjs"

test("defaults when nothing is configured", () => {
  const c = resolveConfig({})
  assert.equal(c.enabled, true)
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.agents, null)
})

test("boolean shorthand true means defaults", () => {
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": true }).enabled, true)
})

test("boolean shorthand false disables the plugin", () => {
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": false }).enabled, false)
})

test("object config overrides individual fields", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "/assistant" } })
  assert.equal(c.mountPath, "/assistant")
  assert.equal(c.enabled, true)
})

test("a mountPath without a leading slash is corrected", () => {
  assert.equal(
    resolveConfig({ "cap-agent-ui5-webui": { mountPath: "assistant" } }).mountPath,
    "/assistant",
  )
})

// cds.server registers `app.get('/', o.index)` for its own welcome page before any
// plugin's bootstrap continuation resumes, so a root mount can never win. Accepting
// "/" would hand a consumer a config that reads as applied and does nothing.
test('a mountPath of "/" is refused, with a warning naming why', () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "/" } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
  assert.match(c.warnings[0], /mountPath "\/" is not available/)
  assert.match(c.warnings[0], /CAP/)
})

test("an empty mountPath is refused the same way", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "" } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
})

// A trailing slash produces routes like "/chat//agents.json", which nothing
// matches — the UI loads but every fetch under the mount path 404s silently
// (loadAgents swallows the failure), leaving a chat box that talks to nothing
// with no warning at all. It must be stripped, not merely tolerated.
test("a trailing slash on mountPath is stripped", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "/chat/" } })
  assert.equal(c.mountPath, "/chat")
  assert.deepEqual(c.warnings, [])
})

test("a mountPath of only slashes collapses to the root case and is refused", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "//" } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
  assert.match(c.warnings[0], /mountPath "\/" is not available/)
})

test("a trailing slash combines correctly with a missing leading slash", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "chat/" } })
  assert.equal(c.mountPath, "/chat")
  assert.deepEqual(c.warnings, [])
})

// An unrecognised key (e.g. a typo like "mountpath") was previously spread
// into the merged config and silently ignored — a consumer's override would
// do nothing, with no signal anywhere that anything was wrong.
test("an unknown config key produces a warning but does not throw", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountpath: "/assistant" } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
  assert.match(c.warnings[0], /unknown config key\(s\) ignored/)
  assert.match(c.warnings[0], /mountpath/)
})

test("multiple unknown config keys are named together in one warning", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountpath: "/x", foo: 1 } })
  assert.equal(c.warnings.length, 1)
  assert.match(c.warnings[0], /mountpath/)
  assert.match(c.warnings[0], /foo/)
})

// Regression: object spread copies an explicit `undefined`/`null` property
// too, so `{ mountPath: undefined }` overwrote the default with `undefined`
// rather than leaving it untouched — and the trailing-slash strip then called
// .replace on it unconditionally. A consumer writing something like
// `mountPath: process.env.CHAT_PATH` with that variable unset hits this
// immediately, and resolveConfig is called unguarded from cds-plugin.js's
// async bootstrap listener with no try/catch — a throw here plausibly takes
// the whole CAP server down at startup, directly contradicting this
// function's own "nothing here throws" contract.
test("an explicit undefined mountPath does not throw and falls back to the default", () => {
  assert.doesNotThrow(() => resolveConfig({ "cap-agent-ui5-webui": { mountPath: undefined } }))
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: undefined } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
})

test("an explicit null mountPath does not throw and falls back to the default", () => {
  assert.doesNotThrow(() => resolveConfig({ "cap-agent-ui5-webui": { mountPath: null } }))
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: null } })
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.warnings.length, 1)
})

test("a usable config carries no warnings", () => {
  assert.deepEqual(resolveConfig({}).warnings, [])
  assert.deepEqual(resolveConfig({ "cap-agent-ui5-webui": { mountPath: "ui" } }).warnings, [])
  assert.deepEqual(resolveConfig({ "cap-agent-ui5-webui": false }).warnings, [])
})

test("serveUi defaults to true, so the plugin serves the UI unless told otherwise", () => {
  assert.equal(resolveConfig({}).serveUi, true)
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": true }).serveUi, true)
})

// serveUi:false is the HTML5 Application Repository mode: the approuter serves
// the UI from the repository, and the CDS server serves only agents.json.
// mountPath must survive, because that is where agents.json still lives and
// what the generated xs-app.json routes to.
test("serveUi:false is accepted as config, not reported as an unknown key", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { serveUi: false } })
  assert.equal(c.serveUi, false)
  assert.equal(c.enabled, true)
  assert.equal(c.mountPath, "/chat")
  assert.deepEqual(c.warnings, [])
})

test("serveUi:false still honours a custom mountPath", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { serveUi: false, mountPath: "assistant" } })
  assert.equal(c.mountPath, "/assistant")
  assert.equal(c.serveUi, false)
})
