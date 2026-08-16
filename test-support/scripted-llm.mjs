import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage } from "@langchain/core/messages"

// Fallback args for the `query` tool when schema introspection comes back
// empty (see below). Determined empirically, not guessed, by testing both
// candidate shapes directly against the live tool's own schema validator
// (temporarily hardcoding each, one at a time, under AGENT_LLM=scripted):
//   - CQN shape `{ entity: "Books", limit: 3 }` is REJECTED outright by the
//     tool's zod schema: "Invalid input: expected string, received
//     undefined -> at cql" — i.e. this server's `query` tool schema has a
//     required `cql` field, not `entity`/`limit`.
//   - CQL shape `{ cql: "SELECT * FROM Books LIMIT 3" }` is ACCEPTED and
//     returns real rows (Wuthering Heights / Jane Eyre / The Raven).
// (A weaker, indirect signal pointed the same way first: running with
// AGENT_LLM unset, so @cap-js/agents' own MockChatModel builds the query
// call, also lands on this exact CQL shape once its own CQN introspection
// comes back empty here — but the schema-validation result above is the
// direct proof, not just an inference from the mock's behavior.)
const FALLBACK_QUERY_ARGS = { cql: "SELECT * FROM Books LIMIT 3" }

/**
 * Deterministic stand-in for a real LLM, used by the E2E suite.
 * Unlike the plugin's mock — which only ever calls `query` on the first
 * entity — this reads the prompt and calls `submitOrder` when asked to order.
 */
export default class ScriptedChatModel extends BaseChatModel {
  constructor(name, options = {}) {
    super({})
    this.name = name
    this.options = options
    this._tools = []
  }

  _llmType() {
    return "cap-scripted-llm"
  }

  bindTools(tools) {
    const bound = Object.create(this)
    bound._tools = tools ?? []
    return bound
  }

  async _generate(messages) {
    const last = messages[messages.length - 1]

    if (last?._getType?.() === "tool") {
      return {
        generations: [{ message: new AIMessage(`Done. Tool result: ${last?.content ?? ""}`) }],
        llmOutput: { model: `scripted-${this.name}` },
      }
    }

    const text = String(last?.content ?? "")
    const order = /order\s+(\d+)\s+.*book\s+(\d+)/i.exec(text)

    if (order && this._tools.some((t) => t.name === "submitOrder")) {
      return {
        generations: [
          {
            message: new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "scripted_order",
                  name: "submitOrder",
                  args: { book: Number(order[2]), quantity: Number(order[1]) },
                },
              ],
            }),
          },
        ],
        llmOutput: { model: `scripted-${this.name}` },
      }
    }

    const query = this._tools.find((t) => t.name === "query")
    if (query) {
      // Try CQN-mode schema introspection first. This service's `query`
      // tool is registered in CQL mode by default (@cap-js/mcp's
      // createGenericReadToolDefinition only returns an `entity` field when
      // cds.env.mcp.format === "cqn"; otherwise the schema is
      // z.object({ cql: z.string() }), with no `entity` at all) — so this
      // branch finds nothing here and the CQL fallback below is the live
      // path. It's kept for a service configured with mcp.format: "cqn".
      const entities = query?.schema?.shape?.entity?.def?.entries
      const entity = entities && Object.keys(entities)[0]
      const args = entity ? { entity, limit: 3 } : FALLBACK_QUERY_ARGS
      return {
        generations: [
          {
            message: new AIMessage({
              content: "",
              tool_calls: [{ id: "scripted_query", name: "query", args }],
            }),
          },
        ],
        llmOutput: { model: `scripted-${this.name}` },
      }
    }

    return {
      generations: [{ message: new AIMessage("[Scripted LLM] no tool matched.") }],
      llmOutput: { model: `scripted-${this.name}` },
    }
  }
}

ScriptedChatModel._is_service_class = true
