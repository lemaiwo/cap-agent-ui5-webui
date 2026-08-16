import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage } from "@langchain/core/messages"

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
      const entities = query?.schema?.shape?.entity?.def?.entries
      const entity = entities && Object.keys(entities)[0]
      if (entity) {
        return {
          generations: [
            {
              message: new AIMessage({
                content: "",
                tool_calls: [{ id: "scripted_query", name: "query", args: { entity, limit: 3 } }],
              }),
            },
          ],
          llmOutput: { model: `scripted-${this.name}` },
        }
      }
    }

    return {
      generations: [{ message: new AIMessage("[Scripted LLM] no tool matched.") }],
      llmOutput: { model: `scripted-${this.name}` },
    }
  }
}

ScriptedChatModel._is_service_class = true
