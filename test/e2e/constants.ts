import type { APIRequestContext } from "@playwright/test"

// Mount path served by the plugin (Task 4) — confirmed from the startup log.
export const APP_URL = "/chat/index.html"

export interface SeedBook {
  ID: number
  title: string
  stock: number
}

/**
 * The first three rows, read from OData at runtime.
 *
 * Three, because the agent's read tool is capped at LIMIT 3 — anything beyond
 * that is unreachable and would make an assertion unfalsifiable.
 */
export async function seedBooks(request: APIRequestContext): Promise<SeedBook[]> {
  const res = await request.get("/odata/v4/catalog/Books?$top=3&$orderby=ID")
  if (!res.ok()) throw new Error(`seed lookup failed: ${res.status()}`)
  const body = (await res.json()) as { value: SeedBook[] }
  if (body.value.length < 3) throw new Error(`expected 3 seed books, got ${body.value.length}`)
  return body.value
}
