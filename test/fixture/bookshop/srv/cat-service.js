const cds = require("@sap/cds")

module.exports = class CatalogService extends cds.ApplicationService {
  init() {
    const { Books, Orders } = this.entities
    const { SELECT, INSERT, UPDATE } = cds.ql

    // E2E only: the plugin's mock LLM cannot call actions, so HITL would be
    // unreachable. Handlers registered here take precedence over the plugin's
    // default buildModel handler.
    if (process.env.AGENT_LLM === "scripted") {
      this.on("buildModel", async () => {
        const { default: ScriptedChatModel } = await import(
          "../../../../test-support/scripted-llm.mjs"
        )
        const { default: script } = await import("../fixture-script.mjs")
        return new ScriptedChatModel("scripted", { script, entity: "Books" })
      })
    }

    this.on("submitOrder", async (req) => {
      const { book, quantity } = req.data

      if (!(quantity > 0)) return req.error(400, `Quantity must be greater than 0.`)

      const found = await SELECT.one.from(Books).where({ ID: book }).columns("ID", "title", "stock")
      if (!found) return req.error(404, `Book ${book} not found.`)
      if (found.stock < quantity) {
        return req.error(409, `Only ${found.stock} copies of "${found.title}" left.`)
      }

      await UPDATE(Books, book).with({ stock: { "-=": quantity } })
      await INSERT.into(Orders).entries({
        book_ID: book,
        quantity,
        orderedAt: new Date().toISOString(),
      })

      const after = await SELECT.one.from(Books).where({ ID: book }).columns("stock")
      return { stock: after.stock }
    })

    return super.init()
  }
}
