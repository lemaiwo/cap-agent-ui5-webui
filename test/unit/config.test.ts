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
