import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:4004",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx cds serve --in-memory",
    cwd: "test/fixture/bookshop",
    url: "http://localhost:4004/a2a/catalog/.well-known/agent-card.json",
    env: { AGENT_LLM: "scripted" },
    reuseExistingServer: false,
    // Task 2 measured a 60-70s cold start when the SAPUI5 framework cache is
    // empty. Packages are warm now, but the headroom costs nothing (Ruling 8).
    timeout: 180_000,
  },
})
