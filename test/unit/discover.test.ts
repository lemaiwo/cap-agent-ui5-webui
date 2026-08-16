import test from "node:test"
import assert from "node:assert/strict"
import { discoverAgents } from "../../lib/discover.mjs"

const svc = (name: string, annotated: boolean, path?: string) => ({
  name,
  definition: annotated ? { "@agent": true } : {},
  endpoints: path ? [{ kind: "odata", path: "/odata/x" }, { kind: "agent", path }] : [],
})

test("returns only services annotated with @agent", () => {
  const found = discoverAgents([svc("A", true, "/a2a/a"), svc("B", false, "/a2a/b")], null)
  assert.deepEqual(found.map((f) => f.name), ["A"])
})

test("reads the real mounted path from the agent endpoint", () => {
  const found = discoverAgents([svc("A", true, "/custom/path")], null)
  assert.equal(found[0].path, "/custom/path")
})

test("skips an annotated service with no agent endpoint", () => {
  const found = discoverAgents([svc("A", true)], null)
  assert.deepEqual(found, [])
})

test("honours an explicit allow-list, preserving its order", () => {
  const found = discoverAgents(
    [svc("A", true, "/a2a/a"), svc("B", true, "/a2a/b")],
    ["B", "A"],
  )
  assert.deepEqual(found.map((f) => f.name), ["B", "A"])
})

test("ignores allow-list entries that are not agents", () => {
  const found = discoverAgents([svc("A", true, "/a2a/a")], ["A", "Nope"])
  assert.deepEqual(found.map((f) => f.name), ["A"])
})
