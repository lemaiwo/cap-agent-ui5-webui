import test from "node:test"
import assert from "node:assert/strict"
import ScriptedChatModel from "../../test-support/scripted-llm.mjs"

const script = [
  {
    match: /order\s+(\d+)\s+.*book\s+(\d+)/i,
    tool: "submitOrder",
    args: (m) => ({ book: Number(m[2]), quantity: Number(m[1]) }),
  },
]

const tools = [{ name: "submitOrder" }, { name: "query" }]
const human = (content) => ({ content, _getType: () => "human" })

test("calls the scripted tool when the prompt matches", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([human("order 2 copies of book 1")])
  const call = res.generations[0].message.tool_calls[0]
  assert.equal(call.name, "submitOrder")
  assert.deepEqual(call.args, { book: 1, quantity: 2 })
})

test("falls back to the read tool with a CQL query on the given entity", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([human("show me everything")])
  const call = res.generations[0].message.tool_calls[0]
  assert.equal(call.name, "query")
  assert.deepEqual(call.args, { cql: "SELECT * FROM Books LIMIT 3" })
})

test("knows nothing about books when given a different script and entity", async () => {
  const other = [
    { match: /cancel\s+(\d+)/i, tool: "cancelTrip", args: (m) => ({ id: Number(m[1]) }) },
  ]
  const m = new ScriptedChatModel("t", { script: other, entity: "Travels" })
    .bindTools([{ name: "cancelTrip" }, { name: "query" }])

  const hit = await m._generate([human("cancel 42")])
  assert.deepEqual(hit.generations[0].message.tool_calls[0].args, { id: 42 })

  const miss = await m._generate([human("hello")])
  assert.deepEqual(miss.generations[0].message.tool_calls[0].args, {
    cql: "SELECT * FROM Travels LIMIT 3",
  })
})

test("skips a scripted rule whose tool is not bound", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" })
    .bindTools([{ name: "query" }])
  const res = await m._generate([human("order 2 copies of book 1")])
  assert.equal(res.generations[0].message.tool_calls[0].name, "query")
})

test("echoes a tool result back as the final answer", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([{ content: "stock: 10", _getType: () => "tool" }])
  assert.match(res.generations[0].message.content, /stock: 10/)
})
