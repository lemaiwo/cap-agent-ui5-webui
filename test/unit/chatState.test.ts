import test from "node:test"
import assert from "node:assert/strict"
import {
  initialState,
  appendUser,
  appendError,
  applyEvent,
} from "../../ui/webapp/chat/chatState"
import type { A2AEvent } from "../../ui/webapp/a2a/types"

const NOW = "2026-08-16T12:00:00.000Z"

const taskEvent: A2AEvent = {
  kind: "task",
  id: "t1",
  contextId: "c1",
  status: { state: "submitted" },
}

function statusEvent(state: string, text?: string): A2AEvent {
  return {
    kind: "status-update",
    taskId: "t1",
    contextId: "c1",
    final: state === "completed",
    status: {
      state: state as never,
      ...(text
        ? { message: { kind: "message", messageId: "m", role: "agent", parts: [{ kind: "text", text }] } }
        : {}),
    },
  } as A2AEvent
}

function artifactEvent(text: string, append: boolean): A2AEvent {
  return {
    kind: "artifact-update",
    taskId: "t1",
    contextId: "c1",
    append,
    lastChunk: false,
    artifact: { artifactId: "response", parts: [{ kind: "text", text }] },
  }
}

test("appendUser adds a user message and marks busy", () => {
  const s = appendUser(initialState(), "hello", NOW)
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0].role, "user")
  assert.equal(s.busy, true)
  assert.equal(s.streamed, false)
})

test("task event records ids", () => {
  const s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  assert.equal(s.taskId, "t1")
  assert.equal(s.contextId, "c1")
  assert.equal(s.busy, true)
})

test("working status sets the transient status line", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, statusEvent("working", "Querying Books"), NOW)
  assert.equal(s.status, "Querying Books")
  assert.equal(s.busy, true)
})

test("artifact-update with append=false replaces the streaming bubble", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, artifactEvent("Hello", false), NOW)
  s = applyEvent(s, artifactEvent("Hello world", false), NOW)
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent.length, 1)
  assert.equal(agent[0].text, "Hello world")
})

test("artifact-update with append=true concatenates", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, artifactEvent("Hello", false), NOW)
  s = applyEvent(s, artifactEvent(" world", true), NOW)
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent[0].text, "Hello world")
})

test("completed clears busy and does not duplicate the streamed text", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, artifactEvent("Answer", false), NOW)
  s = applyEvent(s, statusEvent("completed", "Answer"), NOW)
  assert.equal(s.busy, false)
  assert.equal(s.status, "")
  assert.equal(s.messages.filter((m) => m.role === "agent").length, 1)
  assert.equal(s.messages.every((m) => !m.streaming), true)
})

test("completed adds the message when nothing streamed", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, statusEvent("completed", "Direct answer"), NOW)
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent.length, 1)
  assert.equal(agent[0].text, "Direct answer")
})

test("input-required raises pendingApproval and clears busy", () => {
  let s = applyEvent(appendUser(initialState(), "order it", NOW), taskEvent, NOW)
  s = applyEvent(s, statusEvent("input-required", "Tool execution requires approval"), NOW)
  assert.equal(s.pendingApproval, true)
  assert.equal(s.busy, false)
  assert.equal(s.taskId, "t1")
  assert.equal(s.messages.at(-1)?.text, "Tool execution requires approval")
})

test("failed clears busy and records an error", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, statusEvent("failed", "boom"), NOW)
  assert.equal(s.busy, false)
  assert.equal(s.messages.at(-1)?.role, "error")
})

test("canceled clears busy", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, statusEvent("canceled"), NOW)
  assert.equal(s.busy, false)
})

test("appendError never leaves the UI busy", () => {
  const s = appendError(appendUser(initialState(), "hi", NOW), "network down", NOW)
  assert.equal(s.busy, false)
  assert.equal(s.pendingApproval, false)
  assert.equal(s.messages.at(-1)?.role, "error")
})

test("appendUser stamps the message with the supplied time", () => {
  const s = appendUser(initialState(), "hello", NOW)
  assert.equal(s.messages[0].at, NOW)
})

test("agent and error messages are stamped with the supplied time", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, artifactEvent("streamed", false), "2026-08-16T12:00:05.000Z")
  assert.equal(s.messages.at(-1)?.at, "2026-08-16T12:00:05.000Z")

  const e = appendError(s, "boom", "2026-08-16T12:00:09.000Z")
  assert.equal(e.messages.at(-1)?.at, "2026-08-16T12:00:09.000Z")
})

test("a streaming bubble keeps its original timestamp as chunks arrive", () => {
  let s = applyEvent(appendUser(initialState(), "hi", NOW), taskEvent, NOW)
  s = applyEvent(s, artifactEvent("Hel", false), "2026-08-16T12:00:01.000Z")
  s = applyEvent(s, artifactEvent("lo", true), "2026-08-16T12:00:07.000Z")
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent.length, 1)
  assert.equal(agent[0].text, "Hello")
  assert.equal(agent[0].at, "2026-08-16T12:00:01.000Z")
})

test("applyEvent remains pure — the input state is not mutated", () => {
  const before = appendUser(initialState(), "hi", NOW)
  const snapshot = JSON.stringify(before)
  applyEvent(before, taskEvent, NOW)
  applyEvent(before, artifactEvent("x", false), NOW)
  assert.equal(JSON.stringify(before), snapshot)
})
