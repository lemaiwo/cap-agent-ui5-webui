import test from "node:test"
import assert from "node:assert/strict"
import { parseSSE } from "../../app/chat/webapp/a2a/sse"

test("parses a single complete frame", () => {
  const { frames, rest } = parseSSE("", 'data: {"a":1}\n\n')
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, '{"a":1}')
  assert.equal(rest, "")
})

test("retains a trailing partial frame in rest", () => {
  const { frames, rest } = parseSSE("", 'data: {"a":1}\n\ndata: {"b"')
  assert.equal(frames.length, 1)
  assert.equal(rest, 'data: {"b"')
})

test("joins a frame split across two chunks", () => {
  const first = parseSSE("", 'data: {"a"')
  assert.equal(first.frames.length, 0)
  const second = parseSSE(first.rest, ':1}\n\n')
  assert.equal(second.frames.length, 1)
  assert.equal(second.frames[0].data, '{"a":1}')
})

test("concatenates multiple data lines in one frame", () => {
  const { frames } = parseSSE("", "data: line1\ndata: line2\n\n")
  assert.equal(frames[0].data, "line1\nline2")
})

test("captures the event type of an error frame", () => {
  const { frames } = parseSSE("", 'event: error\ndata: {"code":-32603}\n\n')
  assert.equal(frames[0].event, "error")
  assert.equal(frames[0].data, '{"code":-32603}')
})

test("ignores comment lines and blank padding", () => {
  const { frames } = parseSSE("", ": keep-alive\ndata: ok\n\n")
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, "ok")
})

test("handles CRLF line endings", () => {
  const { frames } = parseSSE("", "data: ok\r\n\r\n")
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, "ok")
})
