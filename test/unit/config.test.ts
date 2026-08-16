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

test("a usable config carries no warnings", () => {
  assert.deepEqual(resolveConfig({}).warnings, [])
  assert.deepEqual(resolveConfig({ "cap-agent-ui5-webui": { mountPath: "ui" } }).warnings, [])
  assert.deepEqual(resolveConfig({ "cap-agent-ui5-webui": false }).warnings, [])
})
