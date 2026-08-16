import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage } from "@langchain/core/messages"

// Fallback args for the `query` tool when schema introspection comes back
// empty (see below). Determined empirically, not guessed: running with
// AGENT_LLM unset (so @cap-js/agents' own MockChatModel builds the query
// args) against a live server showed its CQN-mode introspection *also* comes
// back empty here, so it falls through to CQL mode and calls the tool with
// `{ cql: "SELECT * FROM Books LIMIT 3" }` — which succeeds and returns real
// rows. That confirms both the query format this server's `query` tool
// actually expects (CQL, not CQN) and the entity name ("Books"), independent
// of whatever the schema getter returns.
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
      // Try schema introspection first — it works when the tool's schema
      // getter behaves. It can come back empty (e.g. if the getter's
      // authorization check errors outside of an expected request context),
      // in which case we know what our own app's `query` tool needs and can
      // just say so, rather than giving up like the plugin's mock does.
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
