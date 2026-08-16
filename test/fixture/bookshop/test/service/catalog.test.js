const { test } = require("node:test")
const assert = require("node:assert/strict")
const cds = require("@sap/cds")

const t = cds.test(__dirname + "/../..")

test("submitOrder decrements stock and records an order", async () => {
  await t
  const srv = await cds.connect.to("CatalogService")
  const { SELECT } = cds.ql

  const before = await SELECT.one.from("CatalogService.Books").where({ ID: 1 }).columns("stock")
  const result = await srv.send("submitOrder", { book: 1, quantity: 2 })

  assert.equal(result.stock, before.stock - 2)

  const orders = await SELECT.from("CatalogService.Orders").where({ book_ID: 1 })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].quantity, 2)
})

test("submitOrder rejects a quantity above stock", async () => {
  await t
  const srv = await cds.connect.to("CatalogService")
  await assert.rejects(() => srv.send("submitOrder", { book: 3, quantity: 999999 }), /left/)
})

test("submitOrder rejects an unknown book", async () => {
  await t
  const srv = await cds.connect.to("CatalogService")
  await assert.rejects(() => srv.send("submitOrder", { book: 4242, quantity: 1 }), /not found/)
})
