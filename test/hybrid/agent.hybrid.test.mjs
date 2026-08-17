/**
 * Hybrid tests: the sample agent against a REAL model on SAP AI Core.
 *
 * These are not part of `npm test` and never run in CI. They need a service
 * binding (`cds bind -2 <instance>:<key>`), they cost money per run, and the
 * model's wording differs every time.
 *
 * That last point drives every assertion here: **nothing checks prose.** A real
 * model may answer "The cheapest is Wuthering Heights at $11.11" or "Wuthering
 * Heights, £11.11 — the best value" and both are correct. So the assertions are
 * on things that are deterministic even when the language is not:
 *
 *   - side effects in the database (stock moved, or provably did not)
 *   - A2A task state transitions (input-required, completed)
 *   - identifiers the server issued (contextId)
 *   - presence of data the agent could only know by calling a tool
 *
 * Run with: npm run test:hybrid
 */

import test from "node:test"
import assert from "node:assert/strict"

const BASE = process.env.HYBRID_BASE_URL ?? "http://localhost:4004"
const AGENT = `${BASE}/a2a/catalog`
const ODATA = `${BASE}/odata/v4/catalog`

/** Real models are slow; be generous but bounded. */
const LLM_TIMEOUT = 180_000

let seq = 0
const id = (p) => `${p}-${Date.now()}-${seq++}`

async function books() {
  const res = await fetch(`${ODATA}/Books?$top=3&$orderby=ID`)
  assert.ok(res.ok, `OData lookup failed: ${res.status}`)
  const body = await res.json()
  assert.ok(body.value.length >= 3, `expected 3 seed books, got ${body.value.length}`)
  return body.value
}

async function stockOf(bookId) {
  const res = await fetch(`${ODATA}/Books(${bookId})`)
  assert.ok(res.ok, `stock lookup for book ${bookId} failed: ${res.status}`)
  return (await res.json()).stock
}

/** Send one A2A message and return the resulting task. */
async function ask(text, { taskId = null, contextId = null } = {}) {
  const res = await fetch(AGENT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: id("rpc"),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: id("msg"),
          parts: [{ kind: "text", text }],
          ...(contextId ? { contextId } : {}),
          ...(taskId ? { taskId } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT),
  })

  assert.ok(res.ok, `agent request failed: ${res.status}`)
  const envelope = await res.json()
  assert.ok(!envelope.error, `agent returned an error: ${JSON.stringify(envelope.error)}`)
  return envelope.result
}

const replyText = (task) =>
  (task.status?.message?.parts ?? []).filter((p) => p.kind === "text").map((p) => p.text).join("")

test("the agent grounds its answer in data it could only get by calling a tool", async () => {
  const [first] = await books()
  const task = await ask("List every book in the catalogue with its price.")

  assert.equal(task.status.state, "completed")
  // Not "the reply equals X" - just that a real title from the database appears.
  // A model that answered from thin air could not produce this.
  assert.ok(
    replyText(task).includes(first.title),
    `reply never mentions "${first.title}" - did the agent actually query? Got: ${replyText(task)}`,
  )
})

test("a follow-up message continues the same conversation", async () => {
  const one = await ask("How many books are in the catalogue?")
  assert.ok(one.contextId, "server issued no contextId")

  const two = await ask("And which of them is the most expensive?", { contextId: one.contextId })
  assert.equal(two.contextId, one.contextId, "second turn started a different conversation")
  assert.equal(two.status.state, "completed")
})

test("ordering pauses for approval and does not touch stock until approved", async () => {
  const all = await books()
  const target = all[1] // disjoint from the reject test below
  const before = await stockOf(target.ID)

  const paused = await ask(`Please order 1 copy of "${target.title}".`)

  assert.equal(
    paused.status.state,
    "input-required",
    `expected the agent to pause for approval, got "${paused.status.state}": ${replyText(paused)}`,
  )
  // The assertion that proves the gate is real rather than decorative.
  assert.equal(await stockOf(target.ID), before, "stock changed while approval was still pending")

  const done = await ask("approve", { taskId: paused.id, contextId: paused.contextId })
  assert.equal(done.status.state, "completed")
  assert.equal(await stockOf(target.ID), before - 1, "approving did not decrement stock")
})

test("rejecting an order leaves stock untouched", async () => {
  const all = await books()
  const target = all[2] // disjoint from the approve test above
  const before = await stockOf(target.ID)

  const paused = await ask(`Please order 1 copy of "${target.title}".`)
  assert.equal(paused.status.state, "input-required")

  const done = await ask("reject", { taskId: paused.id, contextId: paused.contextId })
  assert.equal(done.status.state, "completed")
  assert.equal(await stockOf(target.ID), before, "rejecting still changed stock")
})
