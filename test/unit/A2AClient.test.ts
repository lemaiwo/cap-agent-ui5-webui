import test from "node:test"
import assert from "node:assert/strict"
import { A2AClient } from "../../app/chat/webapp/a2a/A2AClient"
import type { A2AEvent } from "../../app/chat/webapp/a2a/types"

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

test("streamMessage yields parsed events in order", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"t1","contextId":"c1","status":{"state":"submitted"}}}\n\n',
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"t1","contextId":"c1","final":true,"status":{"state":"completed"}}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  const received: A2AEvent[] = []
  await new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, (e) => received.push(e))

  assert.equal(received.length, 2)
  assert.equal(received[0].kind, "task")
  assert.equal(received[1].kind, "status-update")
})

test("streamMessage reassembles an event split across chunks", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task",',
    '"id":"t1","contextId":"c1","status":{"state":"submitted"}}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  const received: A2AEvent[] = []
  await new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, (e) => received.push(e))

  assert.equal(received.length, 1)
  assert.equal(received[0].kind, "task")
})

test("streamMessage throws on a JSON-RPC error frame", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32029,"message":"Message too long."}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  await assert.rejects(
    () => new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, () => {}),
    /Message too long/,
  )
})

test("streamMessage surfaces a non-OK response message", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized." } }), {
      status: 401,
    })) as typeof fetch

  await assert.rejects(
    () => new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, () => {}),
    /Unauthorized/,
  )
})

test("streamMessage sends contextId and taskId when provided", async () => {
  let sent = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body ?? "")
    return sseResponse([])
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").streamMessage(
    { text: "approve", contextId: "c1", taskId: "t1" },
    () => {},
  )

  const body = JSON.parse(sent)
  assert.equal(body.method, "message/stream")
  assert.equal(body.params.message.contextId, "c1")
  assert.equal(body.params.message.taskId, "t1")
})

test("streamMessage omits contextId on a first message", async () => {
  let sent = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body ?? "")
    return sseResponse([])
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").streamMessage({ text: "hello" }, () => {})

  const body = JSON.parse(sent)
  assert.equal("contextId" in body.params.message, false)
  assert.equal("taskId" in body.params.message, false)
})

test("getAgentCard returns the parsed card", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ name: "CatalogService", url: "/a2a/catalog", version: "0.0.1" }), {
      status: 200,
    })) as typeof fetch

  const card = await new A2AClient("/a2a/catalog").getAgentCard()
  assert.equal(card.name, "CatalogService")
})

test("getAgentCard requests the well-known agent card path", async () => {
  let requestedUrl = ""
  globalThis.fetch = (async (url: unknown) => {
    requestedUrl = String(url)
    return new Response(JSON.stringify({ name: "CatalogService", url: "/a2a/catalog", version: "0.0.1" }), {
      status: 200,
    })
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").getAgentCard()

  assert.equal(requestedUrl, "/a2a/catalog/.well-known/agent-card.json")
})

test("cancel sends a tasks/cancel JSON-RPC envelope for the given task", async () => {
  let sent = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body ?? "")
    return new Response(null, { status: 200 })
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").cancel("t1")

  const body = JSON.parse(sent)
  assert.equal(body.jsonrpc, "2.0")
  assert.equal(body.method, "tasks/cancel")
  assert.deepEqual(body.params, { id: "t1" })
})
