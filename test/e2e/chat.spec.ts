import { test, expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { APP_URL, seedBooks } from "./constants"

async function stockOf(request: APIRequestContext, id: number): Promise<number> {
  const res = await request.get(`/odata/v4/catalog/Books(${id})`)
  expect(res.ok(), `stock lookup for book ${id} failed: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { stock: number }
  return body.stock
}

test("streams a reply containing real data from the database", async ({ page, request }) => {
  const [first] = await seedBooks(request)

  await page.goto(APP_URL)

  const input = page.getByPlaceholder("Ask the agent")
  await expect(input).toBeVisible()

  await input.fill("show me all books")
  await page.getByRole("button", { name: "Send" }).click()

  // Asserts the chat reply contains what OData independently returned —
  // two surfaces cross-checked, where a hardcoded title only checked itself.
  await expect(page.getByText(first.title)).toBeVisible()
  await expect(input).toBeEnabled()
})

test("reuses the contextId on a follow-up message", async ({ page, request }) => {
  const [first] = await seedBooks(request)

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
  const input = page.getByPlaceholder("Ask the agent")
  const send = page.getByRole("button", { name: "Send" })

  await input.fill("show me all books")
  await send.click()
  await expect(page.getByText(first.title)).toBeVisible()
  await expect(input).toBeEnabled()

  await input.fill("show them again")
  await send.click()
  await expect(input).toBeEnabled()

  expect(bodies.length).toBeGreaterThanOrEqual(2)
  const firstBody = JSON.parse(bodies[0])
  const secondBody = JSON.parse(bodies[1])
  expect(firstBody.params.message.contextId).toBeUndefined()
  expect(secondBody.params.message.contextId).toBeTruthy()
})

test("approving an order actually decrements stock", async ({ page, request }) => {
  const books = await seedBooks(request)
  const approveBook = books[1].ID
  const before = await stockOf(request, approveBook)

  await page.goto(APP_URL)
  await page.getByPlaceholder("Ask the agent").fill(`order 1 copies of book ${approveBook}`)
  await page.getByRole("button", { name: "Send" }).click()

  const approve = page.getByRole("button", { name: "Approve" })
  await expect(approve).toBeVisible()
  expect(await stockOf(request, approveBook)).toBe(before)

  await approve.click()
  await expect(approve).toBeHidden()

  await expect.poll(async () => stockOf(request, approveBook)).toBe(before - 1)
})

test("rejecting an order leaves stock untouched", async ({ page, request }) => {
  const books = await seedBooks(request)
  const rejectBook = books[2].ID
  const before = await stockOf(request, rejectBook)

  await page.goto(APP_URL)
  const input = page.getByPlaceholder("Ask the agent")
  await input.fill(`order 1 copies of book ${rejectBook}`)
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

  expect(await stockOf(request, rejectBook)).toBe(before)
})

test("agent card reflects the Phase B markdown-defined agent, not Phase A auto-agentification", async ({
  request,
}) => {
  const res = await request.get("/a2a/catalog/.well-known/agent-card.json")
  expect(res.ok()).toBeTruthy()
  const card = (await res.json()) as { name: string; skills: Array<{ id?: string; name?: string }> }

  expect(card.name).toBe("catalog-agent")
  expect(card.skills.some((s) => s.id === "book-purchase" || s.name === "book-purchase")).toBe(true)
})

test("an over-long message surfaces an error instead of wedging the UI", async ({ page }) => {
  await page.goto(APP_URL)

  const input = page.getByPlaceholder("Ask the agent")
  await input.fill("x".repeat(5001))
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page.getByText(/too long|5000/i)).toBeVisible()
  await expect(input).toBeEnabled()
})

test("offers a picker when several agents exist and switching resets the conversation", async ({ page, request }) => {
  const res = await request.get("/chat/agents.json")
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).length).toBeGreaterThan(1)

  await page.goto(APP_URL)
  const picker = page.getByRole("combobox")
  await expect(picker).toBeVisible()

  const input = page.getByPlaceholder("Ask the agent")
  await input.fill("show me all books")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(input).toBeEnabled()
  // Role is written to the DOM as data-role (see style.css) rather than
  // rendered as visible text, so the user bubble is found by that attribute.
  const userRow = page.locator('[data-role="user"]')
  const before = await userRow.count()
  expect(before).toBeGreaterThan(0)

  // sap.m.Select renders a custom combobox, not a native <select>: the
  // accessible "combobox" role sits on an off-screen a11y helper node whose
  // click is intercepted by the visible label sitting on top of it, so the
  // label itself — what a user actually clicks — is the reliable target.
  await page.locator('[id$="-agentSelect-label"]').click()
  await page.getByRole("option").nth(1).click()
  await expect(userRow).toHaveCount(0) // conversation reset
})
