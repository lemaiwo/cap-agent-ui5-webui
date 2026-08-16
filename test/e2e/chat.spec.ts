import { test, expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { APP_URL, APPROVE_BOOK, REJECT_BOOK } from "./constants"

async function stockOf(request: APIRequestContext, id: number): Promise<number> {
  const res = await request.get(`/odata/v4/catalog/Books(${id})`)
  expect(res.ok(), `stock lookup for book ${id} failed: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { stock: number }
  return body.stock
}

test("streams a reply containing real data from the database", async ({ page }) => {
  await page.goto(APP_URL)

  const input = page.getByPlaceholder("Ask the catalog agent")
  await expect(input).toBeVisible()

  await input.fill("show me all books")
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page.getByText("Wuthering Heights")).toBeVisible()
  await expect(input).toBeEnabled()
})

test("reuses the contextId on a follow-up message", async ({ page }) => {
  // Ruling 7: observe the POST body passively instead of page.route(...) +
  // route.continue(). The response is a long-lived SSE stream, and an
  // interception layer can buffer or break streaming; page.on only observes.
  const bodies: string[] = []
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/a2a/catalog")) {
      bodies.push(req.postData() ?? "")
    }
  })

  await page.goto(APP_URL)
  const input = page.getByPlaceholder("Ask the catalog agent")
  const send = page.getByRole("button", { name: "Send" })

  await input.fill("show me all books")
  await send.click()
  await expect(page.getByText("Wuthering Heights")).toBeVisible()
  await expect(input).toBeEnabled()

  await input.fill("show them again")
  await send.click()
  await expect(input).toBeEnabled()

  expect(bodies.length).toBeGreaterThanOrEqual(2)
  const first = JSON.parse(bodies[0])
  const second = JSON.parse(bodies[1])
  expect(first.params.message.contextId).toBeUndefined()
  expect(second.params.message.contextId).toBeTruthy()
})

test("approving an order actually decrements stock", async ({ page, request }) => {
  const before = await stockOf(request, APPROVE_BOOK)

  await page.goto(APP_URL)
  await page.getByPlaceholder("Ask the catalog agent").fill(`order 1 copies of book ${APPROVE_BOOK}`)
  await page.getByRole("button", { name: "Send" }).click()

  const approve = page.getByRole("button", { name: "Approve" })
  await expect(approve).toBeVisible()
  expect(await stockOf(request, APPROVE_BOOK)).toBe(before)

  await approve.click()
  await expect(approve).toBeHidden()

  await expect.poll(async () => stockOf(request, APPROVE_BOOK)).toBe(before - 1)
})

test("rejecting an order leaves stock untouched", async ({ page, request }) => {
  const before = await stockOf(request, REJECT_BOOK)

  await page.goto(APP_URL)
  const input = page.getByPlaceholder("Ask the catalog agent")
  await input.fill(`order 1 copies of book ${REJECT_BOOK}`)
  await page.getByRole("button", { name: "Send" }).click()

  const reject = page.getByRole("button", { name: "Reject" })
  await expect(reject).toBeVisible()

  await reject.click()
  await expect(reject).toBeHidden()
  // The button hides synchronously inside the click handler, before any
  // network round-trip — waiting for the input to re-enable is what proves
  // the reject exchange actually reached and finished at the server before
  // we read stock below.
  await expect(input).toBeEnabled()

  expect(await stockOf(request, REJECT_BOOK)).toBe(before)
})

test("an over-long message surfaces an error instead of wedging the UI", async ({ page }) => {
  await page.goto(APP_URL)

  const input = page.getByPlaceholder("Ask the catalog agent")
  await input.fill("x".repeat(5001))
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page.getByText(/too long|5000/i)).toBeVisible()
  await expect(input).toBeEnabled()
})
