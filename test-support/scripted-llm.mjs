import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage } from "@langchain/core/messages"

/**
 * Deterministic stand-in for a real LLM, for testing CAP agents.
 *
 * @cap-js/agents' bundled mock ignores the prompt and only ever calls the read
 * tool on entity[0], so it can never invoke an action — which makes
 * human-in-the-loop approval untestable. This model reads the prompt and calls
 * the tool a supplied script says to.
 *
 * It matches regexes and maps captures to arguments. It does not infer intent,
 * deliberately: determinism is the entire value. Anything needing inference
 * needs a real model (SAP AI Core, `hybrid` profile).
 *
 * @param {object} options
 * @param {Array<{match: RegExp, tool: string, args: (m: RegExpExecArray) => object}>} options.script
 * @param {string} [options.entity] entity for the read-tool fallback
 */
export default class ScriptedChatModel extends BaseChatModel {
  constructor(name, options = {}) {
    super({})
    this.name = name
    this.options = options
    this._script = options.script ?? []
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

  _has(toolName) {
    return this._tools.some((t) => t.name === toolName)
  }

  _call(name, args, id) {
    return {
      generations: [
        { message: new AIMessage({ content: "", tool_calls: [{ id, name, args }] }) },
      ],
      llmOutput: { model: `scripted-${this.name}` },
    }
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

    for (const rule of this._script) {
      const m = rule.match.exec(text)
      if (m && this._has(rule.tool)) {
        return this._call(rule.tool, rule.args(m), `scripted_${rule.tool}`)
      }
    }

    // Fallback: read the first entity. The args are CQL — this service's query
    // tool is registered as z.object({ cql: z.string() }) with no `entity`
    // field unless cds.env.mcp.format === 'cqn', so the CQN shape is rejected
    // outright by its validator.
    const entity = this.options.entity ?? this._deriveEntity()
    if (entity && this._has("query")) {
      return this._call("query", { cql: `SELECT * FROM ${entity} LIMIT 3` }, "scripted_query")
    }

    return {
      generations: [{ message: new AIMessage("[Scripted LLM] no rule matched.") }],
      llmOutput: { model: `scripted-${this.name}` },
    }
  }

  /** First exposed entity of the first @agent service, read from the CDS model. */
  _deriveEntity() {
    const services = globalThis.cds?.model?.services ?? []
    const agentSrv = services.find((s) => s["@agent"]) ?? services[0]
    if (!agentSrv) return undefined
    const entities = Object.keys(agentSrv.entities ?? {})
    return entities.length ? entities[0].split(".").pop() : undefined
  }
}

ScriptedChatModel._is_service_class = true
