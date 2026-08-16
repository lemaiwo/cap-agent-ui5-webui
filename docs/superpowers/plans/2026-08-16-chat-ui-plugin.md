# CAP Agent Chat UI Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repo from a demo app into a reusable CAP plugin that serves an A2A chat UI to any CAP project on install, identically in `cds watch` and on BTP.

**Architecture:** The plugin becomes the root package (forced by `npm add github:owner/repo` resolving the repo root). It ships a pre-built `dist/` mounted with `express.static` from `cds-plugin.js` — no UI5 Tooling at runtime. The bookshop demo becomes a test fixture that consumes the plugin, which is the only honest proof the extraction generalised.

**Tech Stack:** `@sap/cds` v10, `@cap-js/agents` 0.9.1 (pinned), UI5 1.120 + TypeScript, `ui5-tooling-transpile`, `node:test` + `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-chat-ui-plugin-design.md`

## Global Constraints

- `@cap-js/agents` pinned to exactly `0.9.1`.
- **E2E must run against built `dist/`, never the TypeScript sources.** Testing live-transpiled code proves something no consumer runs.
- `dist/` is committed to git. `.gitignore:7` currently excludes it and must be changed.
- The plugin must not depend on `cds-plugin-ui5` at runtime — devDependency only.
- Test runner is `node:test` via `tsx`; Playwright for E2E. No Jest, no Mocha.
- `workers: 1` + `fullyParallel: false` stay required — the in-memory DB is seeded once per server start.
- Assertions that must never weaken: stock unchanged **while approval is pending**; `stockOf` failing loudly on non-OK; the agent-card identity check guarding Phase B.
- The query tool's args are **CQL** (`{ cql: "..." }`), not CQN — proven by schema rejection.
- Commit after every task; full suite green before each commit.

---

### Task 1: Make the scripted LLM generic

Done first, in the current layout, so the later move is pure relocation.

**Files:**
- Modify: `test-support/scripted-llm.mjs`
- Create: `test/fixture-script.mjs` (the bookshop's own intent script)
- Modify: `srv/cat-service.js` (pass the script in)
- Test: `test/unit/scriptedLlm.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `new ScriptedChatModel(name, { script, entity })` where `script` is an array of `{ match: RegExp, tool: string, args: (m: RegExpExecArray) => object }`, and `entity` optionally overrides the derived read-tool entity.

- [ ] **Step 1: Write the failing test**

Create `test/unit/scriptedLlm.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import ScriptedChatModel from "../../test-support/scripted-llm.mjs"

const script = [
  {
    match: /order\s+(\d+)\s+.*book\s+(\d+)/i,
    tool: "submitOrder",
    args: (m) => ({ book: Number(m[2]), quantity: Number(m[1]) }),
  },
]

const tools = [{ name: "submitOrder" }, { name: "query" }]
const human = (content) => ({ content, _getType: () => "human" })

test("calls the scripted tool when the prompt matches", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([human("order 2 copies of book 1")])
  const call = res.generations[0].message.tool_calls[0]
  assert.equal(call.name, "submitOrder")
  assert.deepEqual(call.args, { book: 1, quantity: 2 })
})

test("falls back to the read tool with a CQL query on the given entity", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([human("show me everything")])
  const call = res.generations[0].message.tool_calls[0]
  assert.equal(call.name, "query")
  assert.deepEqual(call.args, { cql: "SELECT * FROM Books LIMIT 3" })
})

test("knows nothing about books when given a different script and entity", async () => {
  const other = [
    { match: /cancel\s+(\d+)/i, tool: "cancelTrip", args: (m) => ({ id: Number(m[1]) }) },
  ]
  const m = new ScriptedChatModel("t", { script: other, entity: "Travels" })
    .bindTools([{ name: "cancelTrip" }, { name: "query" }])

  const hit = await m._generate([human("cancel 42")])
  assert.deepEqual(hit.generations[0].message.tool_calls[0].args, { id: 42 })

  const miss = await m._generate([human("hello")])
  assert.deepEqual(miss.generations[0].message.tool_calls[0].args, {
    cql: "SELECT * FROM Travels LIMIT 3",
  })
})

test("skips a scripted rule whose tool is not bound", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" })
    .bindTools([{ name: "query" }])
  const res = await m._generate([human("order 2 copies of book 1")])
  assert.equal(res.generations[0].message.tool_calls[0].name, "query")
})

test("echoes a tool result back as the final answer", async () => {
  const m = new ScriptedChatModel("t", { script, entity: "Books" }).bindTools(tools)
  const res = await m._generate([{ content: "stock: 10", _getType: () => "tool" }])
  assert.match(res.generations[0].message.content, /stock: 10/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/unit/scriptedLlm.test.mjs`
Expected: FAIL — the current model ignores `options.script` and hardcodes the bookshop regex.

- [ ] **Step 3: Generalise the model**

Rewrite `test-support/scripted-llm.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/unit/scriptedLlm.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Move the bookshop script out of the model**

Create `test/fixture-script.mjs`:

```js
/** The bookshop's own intents. The scripted model knows none of this. */
export default [
  {
    match: /order\s+(\d+)\s+.*book\s+(\d+)/i,
    tool: "submitOrder",
    args: (m) => ({ book: Number(m[2]), quantity: Number(m[1]) }),
  },
]
```

In `srv/cat-service.js`, change the `buildModel` handler to pass it in:

```js
    if (process.env.AGENT_LLM === "scripted") {
      this.on("buildModel", async () => {
        const { default: ScriptedChatModel } = await import("../test-support/scripted-llm.mjs")
        const { default: script } = await import("../test/fixture-script.mjs")
        return new ScriptedChatModel("scripted", { script, entity: "Books" })
      })
    }
```

- [ ] **Step 6: Add the new file to the unit script and run everything**

Append `test/unit/scriptedLlm.test.mjs` to `test:unit` in `package.json`.

Run: `npm test` then `npm run test:e2e`
Expected: 35 unit + 3 service, and 6 E2E still passing — the fixture behaves exactly as before.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: make the scripted LLM generic and script-driven"
```

---

### Task 2: Derive E2E fixtures from OData

**Files:**
- Modify: `test/e2e/constants.ts`, `test/e2e/chat.spec.ts`

**Interfaces:**
- Produces: `seedBooks(request): Promise<{ID:number,title:string,stock:number}[]>` used by the specs.

- [ ] **Step 1: Replace the hardcoded constants**

Rewrite `test/e2e/constants.ts`:

```ts
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
```

- [ ] **Step 2: Use them in the specs**

In `test/e2e/chat.spec.ts`, replace the `APPROVE_BOOK` / `REJECT_BOOK` imports with `seedBooks`, and in each test resolve rows first. The streaming test becomes a genuine cross-check:

```ts
test("streams a reply containing real data from the database", async ({ page, request }) => {
  const [first] = await seedBooks(request)

  await page.goto(APP_URL)
  const input = page.getByPlaceholder("Ask the catalog agent")
  await expect(input).toBeVisible()
  await input.fill("show me all books")
  await page.getByRole("button", { name: "Send" }).click()

  // Asserts the chat reply contains what OData independently returned —
  // two surfaces cross-checked, where a hardcoded title only checked itself.
  await expect(page.getByText(first.title)).toBeVisible()
  await expect(input).toBeEnabled()
})
```

Mutating tests take disjoint rows — approve uses `books[1]`, reject uses `books[2]` — and keep every existing assertion, including the stock-unchanged-while-pending check.

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e`
Expected: 6/6 passing, no hardcoded titles or IDs left in `test/e2e/`.

Verify with: `grep -rn "Wuthering\|APPROVE_BOOK\|REJECT_BOOK" test/e2e/` → no matches.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: derive e2e fixtures from OData instead of hardcoding"
```

---

### Task 3: Scope the CSS so it does not own the page

**Files:**
- Modify: `app/chat/webapp/css/style.css`, `app/chat/webapp/index.html`, `app/chat/webapp/view/Chat.view.xml`

Inside a host application, `html, body { height: 100% }` is not ours to set. Everything must be scoped to the plugin's own root.

- [ ] **Step 1: Add a scoping class to the view root**

In `Chat.view.xml`, add `class="capAgentChat"` to the `<Page>` so every rule can hang off it.

- [ ] **Step 2: Rescope the stylesheet**

In `style.css`, prefix every selector with `.capAgentChat` (they already mostly are via `.chatPage`; rename that root class to `.capAgentChat` and make the nesting explicit). Remove any rule targeting bare `html`, `body`, or `body > div`.

- [ ] **Step 3: Move the height fix out of the global scope**

The height chain currently lives in `index.html` and targets `html, body, body > div, #container, .sapUiView`. In the plugin's own `index.html` this is legitimate — it is our page. Keep it there, and add a comment recording that it is deliberately page-level because this HTML is the plugin's own shell, **not** injected into a host page. Nothing in `style.css` may target those elements, so a future embed-into-host-page mode inherits no global rules.

- [ ] **Step 4: Verify visually and by test**

Run: `npm run test:e2e`
Expected: 6/6 — in particular the approve/reject click tests, which are what caught the original height bug via pointer-event interception.

Then start the server and confirm `document.body.getBoundingClientRect().height` still spans the viewport, not 44px.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: scope chat styles to the plugin root"
```

---

### Task 4: Restructure the repo and serve the UI from the plugin

The large one. Restructure and serving are a single atomic change: the repo cannot be coherent with one but not the other.

**Files:**
- Move: `app/chat/webapp/**` → `ui/webapp/**`; `app/chat/ui5.yaml` → `ui/ui5.yaml`; `db/`, `srv/` → `test/fixture/bookshop/`; `test/service/**` → `test/fixture/bookshop/test/`
- Create: `cds-plugin.js`, `lib/mount.mjs`, `lib/config.mjs`, `test/fixture/bookshop/package.json`, `test/unit/config.test.ts`
- Modify: root `package.json`, `.gitignore`, `playwright.config.ts`

**Interfaces:**
- Produces: `resolveConfig(env): { enabled: boolean, mountPath: string, bootstrapUrl: string, agents: string[] | null }` from `lib/config.mjs`; a mounted static route at `mountPath`.

- [ ] **Step 1: Move files with history preserved**

```bash
git mv app/chat/ui5.yaml ui/ui5.yaml
git mv app/chat/webapp ui/webapp
mkdir -p test/fixture/bookshop
git mv db test/fixture/bookshop/db
git mv srv test/fixture/bookshop/srv
mkdir -p test/fixture/bookshop/test
git mv test/service test/fixture/bookshop/test/service
git mv test/fixture-script.mjs test/fixture/bookshop/fixture-script.mjs
rmdir app/chat app 2>/dev/null || true
```

Fix the now-stale relative imports in `test/fixture/bookshop/srv/cat-service.js` (the `buildModel` handler's two dynamic imports) to point at `../../../../test-support/scripted-llm.mjs` and `../fixture-script.mjs`.

- [ ] **Step 2: Split package.json**

Root `package.json` becomes the plugin. Key fields:

```json
{
  "name": "cap-agent-ui5-webui",
  "version": "0.1.0",
  "description": "A CAP plugin that serves a UI5 chat client for @cap-js/agents A2A agents",
  "main": "cds-plugin.js",
  "files": ["cds-plugin.js", "lib", "dist", "test-support", "README.md"],
  "exports": {
    ".": "./cds-plugin.js",
    "./test-support/scripted-llm": "./test-support/scripted-llm.mjs"
  },
  "peerDependencies": { "@sap/cds": ">=8" },
  "dependencies": { "express": "^4" }
}
```

`@cap-js/agents`, `@cap-js/sqlite` and the UI5 toolchain move to `devDependencies` — the plugin does not require them at runtime, the consumer brings its own agent.

Create `test/fixture/bookshop/package.json`:

```json
{
  "name": "bookshop-fixture",
  "private": true,
  "dependencies": {
    "cap-agent-ui5-webui": "file:../../.."
  },
  "cds": {
    "requires": { "db": { "kind": "sqlite", "credentials": { "url": ":memory:" } } }
  }
}
```

- [ ] **Step 3: Un-ignore dist and add the build**

In `.gitignore`, delete the `dist/` line (currently line 7). Missing this produces a package that installs cleanly and serves nothing — and no test here would catch it, because the fixture resolves the plugin by relative path and would still see a local `dist/`.

Add to root `package.json` scripts:

```json
"build": "ui5 build --config ui/ui5.yaml --dest dist --clean-dest"
```

- [ ] **Step 4: Write the config resolver and its test**

Create `test/unit/config.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { resolveConfig } from "../../lib/config.mjs"

test("defaults when nothing is configured", () => {
  const c = resolveConfig({})
  assert.equal(c.enabled, true)
  assert.equal(c.mountPath, "/chat")
  assert.equal(c.agents, null)
})

test("boolean shorthand true means defaults", () => {
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": true }).enabled, true)
})

test("boolean shorthand false disables the plugin", () => {
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": false }).enabled, false)
})

test("object config overrides individual fields", () => {
  const c = resolveConfig({ "cap-agent-ui5-webui": { mountPath: "/assistant" } })
  assert.equal(c.mountPath, "/assistant")
  assert.equal(c.enabled, true)
})

test("a mountPath without a leading slash is corrected", () => {
  assert.equal(resolveConfig({ "cap-agent-ui5-webui": { mountPath: "assistant" } }).mountPath, "/assistant")
})
```

Run it (expect FAIL), then create `lib/config.mjs`:

```js
const DEFAULTS = { enabled: true, mountPath: "/chat", bootstrapUrl: null, agents: null }

/** Resolve plugin config from a cds.env-shaped object. */
export function resolveConfig(env = {}) {
  const raw = env["cap-agent-ui5-webui"]
  if (raw === false) return { ...DEFAULTS, enabled: false }
  const given = raw === true || raw == null ? {} : raw
  const merged = { ...DEFAULTS, ...given }
  if (merged.mountPath && !merged.mountPath.startsWith("/")) {
    merged.mountPath = `/${merged.mountPath}`
  }
  return merged
}
```

Run it again (expect PASS — 5 tests) and append the file to `test:unit`.

- [ ] **Step 5: Write the mount and the plugin entry**

Create `lib/mount.mjs`:

```js
import express from "express"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the built UI. */
export function distPath() {
  return join(here, "..", "dist")
}

/**
 * Serve the built UI at mountPath. Returns false (and logs) when dist/ is
 * missing, which means the package was published without a build.
 */
export function mountUi(app, mountPath, log) {
  const dist = distPath()
  if (!existsSync(dist)) {
    log.warn(
      `cap-agent-ui5-webui: no dist/ found at ${dist} — the chat UI will not be served. ` +
        `Run \`npm run build\` in the plugin, and check dist/ is committed (not gitignored).`,
    )
    return false
  }
  app.use(mountPath, express.static(dist, { index: "index.html" }))
  log.info(`cap-agent-ui5-webui: serving chat UI at ${mountPath}`)
  return true
}

/** Default SAPUI5 bootstrap, overridable for air-gapped or CSP-restricted hosts. */
export const DEFAULT_BOOTSTRAP = "https://ui5.sap.com/1.120.0/resources/sap-ui-core.js"

/**
 * Serve index.html with the bootstrap URL substituted. Registered BEFORE the
 * static handler so it wins for "/" and "/index.html".
 */
export function mountIndex(app, mountPath, bootstrapUrl, log) {
  if (!bootstrapUrl || bootstrapUrl === DEFAULT_BOOTSTRAP) return
  const file = join(distPath(), "index.html")
  const html = readFileSync(file, "utf-8").split(DEFAULT_BOOTSTRAP).join(bootstrapUrl)
  const send = (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(html)
  }
  app.get(mountPath, send)
  app.get(`${mountPath}/index.html`, send)
  log.info(`cap-agent-ui5-webui: UI5 bootstrap overridden to ${bootstrapUrl}`)
}
```

Add `readFileSync` to the `node:fs` import at the top of the file.

Create `cds-plugin.js`:

```js
const cds = require("@sap/cds")

const LOG = cds.log("agent-chat-ui")

cds.on("bootstrap", async (app) => {
  const { resolveConfig } = await import("./lib/config.mjs")
  const { mountUi } = await import("./lib/mount.mjs")

  const config = resolveConfig(cds.env)
  if (!config.enabled) {
    LOG.info("cap-agent-ui5-webui: disabled by configuration")
    return
  }

  mountIndex(app, config.mountPath, config.bootstrapUrl, LOG)
  mountUi(app, config.mountPath, LOG)
})
```

Import `mountIndex` alongside `mountUi`. Order matters — the index handler must be registered before the static handler or `express.static` answers `/` first.

The failure mode is deliberately loud: a missing `dist/` logs a warning naming the likely cause, rather than silently 404ing.

- [ ] **Step 5b: Point index.html at the CDN**

`ui/webapp/index.html` currently bootstraps from a relative `resources/sap-ui-core.js`, which only exists because the dev middleware serves it. **A static `dist/` has no such server, so this must change or Step 7 will fail with a blank page.** Set the bootstrap `src` to the literal default:

```html
      src="https://ui5.sap.com/1.120.0/resources/sap-ui-core.js"
```

Using the literal in the file (rather than a placeholder) keeps dev and prod on the same code path and lets `mountIndex` do a plain string substitution when a consumer overrides it. Confirm afterwards that `dist/index.html` contains the CDN URL and no `resources/sap-ui-core.js` reference.

- [ ] **Step 6: Point Playwright at the fixture**

In `playwright.config.ts`, change `webServer.command` to run the fixture and keep `AGENT_LLM=scripted`:

```ts
  webServer: {
    command: "npx cds serve --in-memory",
    cwd: "test/fixture/bookshop",
    url: "http://localhost:4004/a2a/catalog/.well-known/agent-card.json",
    env: { AGENT_LLM: "scripted" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
```

- [ ] **Step 7: Build, install the fixture, and verify end to end**

```bash
npm run build
ls dist/index.html            # must exist
cd test/fixture/bookshop && npm install && cd ../../..
npm run test:e2e
```

Expected: `dist/index.html` exists; 6/6 E2E passing — now served by the plugin from built output rather than by `cds-plugin-ui5` from sources.

Then confirm the file that would silently break a consumer is actually tracked:

```bash
git ls-files dist | head -3
```

Expected: non-empty. An empty result means `.gitignore` still excludes `dist/` — stop and fix.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: restructure as a CAP plugin serving prebuilt UI from dist"
```

---

### Task 5: Agent discovery

**Files:**
- Create: `lib/discover.mjs`, `test/unit/discover.test.ts`
- Modify: `cds-plugin.js`

**Interfaces:**
- Produces: `discoverAgents(services, filter): {name, path, description}[]`, and a `GET <mountPath>/agents.json` route.

- [ ] **Step 1: Write the failing test**

Create `test/unit/discover.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { discoverAgents } from "../../lib/discover.mjs"

const svc = (name: string, annotated: boolean, path?: string) => ({
  name,
  definition: annotated ? { "@agent": true } : {},
  endpoints: path ? [{ kind: "odata", path: "/odata/x" }, { kind: "agent", path }] : [],
})

test("returns only services annotated with @agent", () => {
  const found = discoverAgents([svc("A", true, "/a2a/a"), svc("B", false, "/a2a/b")], null)
  assert.deepEqual(found.map((f) => f.name), ["A"])
})

test("reads the real mounted path from the agent endpoint", () => {
  const found = discoverAgents([svc("A", true, "/custom/path")], null)
  assert.equal(found[0].path, "/custom/path")
})

test("skips an annotated service with no agent endpoint", () => {
  const found = discoverAgents([svc("A", true)], null)
  assert.deepEqual(found, [])
})

test("honours an explicit allow-list, preserving its order", () => {
  const found = discoverAgents(
    [svc("A", true, "/a2a/a"), svc("B", true, "/a2a/b")],
    ["B", "A"],
  )
  assert.deepEqual(found.map((f) => f.name), ["B", "A"])
})

test("ignores allow-list entries that are not agents", () => {
  const found = discoverAgents([svc("A", true, "/a2a/a")], ["A", "Nope"])
  assert.deepEqual(found.map((f) => f.name), ["A"])
})
```

Run it: expect FAIL (module missing).

- [ ] **Step 2: Implement discovery**

Create `lib/discover.mjs`:

```js
/**
 * Find A2A agents to offer in the UI.
 *
 * `@agent` is service-level only — the plugin reads srv.definition["@agent"],
 * so "how many agents" is exactly "how many annotated services". The mounted
 * path is read from the endpoint whose kind is "agent" rather than
 * reconstructed from the service name, because an explicit @path overrides the
 * default /a2a prefix entirely.
 */
export function discoverAgents(services = [], allow = null) {
  const found = []
  for (const srv of services) {
    if (!srv?.definition?.["@agent"]) continue
    const endpoint = (srv.endpoints ?? []).find((e) => e.kind === "agent")
    if (!endpoint?.path) continue
    found.push({
      name: srv.name,
      path: endpoint.path,
      description: srv.definition["@description"] ?? srv.definition["@title"] ?? srv.name,
    })
  }
  if (!allow) return found
  const byName = new Map(found.map((f) => [f.name, f]))
  return allow.map((n) => byName.get(n)).filter(Boolean)
}
```

Run the test: expect PASS — 5 tests. Append the file to `test:unit`.

- [ ] **Step 3: Serve agents.json**

In `cds-plugin.js`, register the route at bootstrap and fill it on `served`:

```js
  let agents = []
  app.get(`${config.mountPath}/agents.json`, (_req, res) => res.json(agents))

  cds.on("served", async (services) => {
    const { discoverAgents } = await import("./lib/discover.mjs")
    agents = discoverAgents(Object.values(services), config.agents)
    LOG.info(`cap-agent-ui5-webui: discovered ${agents.length} agent(s)`, agents.map((a) => a.path))
  })
```

Registering the route before `served` matters: Express matches at request time, so the closure sees the filled array.

- [ ] **Step 4: Verify against the fixture**

Start the fixture server and:

```bash
curl -s http://localhost:4004/chat/agents.json
```

Expected: `[{"name":"CatalogService","path":"/a2a/catalog",...}]`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: discover @agent services and expose them as agents.json"
```

---

### Task 6: Multi-agent UI

**Files:**
- Modify: `ui/webapp/controller/Chat.controller.ts`, `ui/webapp/view/Chat.view.xml`
- Create: `test/fixture/bookshop/srv/support-service.cds`, `test/fixture/bookshop/srv/support-service.js`
- Modify: `test/e2e/chat.spec.ts`

- [ ] **Step 1: Fetch agents at startup**

In `onInit`, replace the manifest-only agent URL with a fetch of `<mountPath>/agents.json`, falling back to the manifest value if the request fails (which keeps the app working when embedded without the plugin). Store the list on the model as `/agents` and the selected one as `/agentPath`, then construct `A2AClient` from the selection.

- [ ] **Step 2: Render a picker only when it earns its place**

In `Chat.view.xml`, add a header inside the `<Page>`:

```xml
    <headerContent>
      <Select
        id="agentSelect"
        items="{chat>/agents}"
        selectedKey="{chat>/agentPath}"
        change=".onAgentChange"
        visible="{= ${chat>/agents}.length &gt; 1 }">
        <core:Item key="{chat>path}" text="{chat>name}" />
      </Select>
    </headerContent>
```

Note `&gt;` — a bare `>` inside an XML attribute is invalid and will fail to parse.

Then in the controller:

```ts
  public onAgentChange(): void {
    const path = this.model.getProperty("/agentPath") as string
    this.abort?.abort()
    this.client = new A2AClient(path)
    // contextId and task history belong to the agent that issued them, so a
    // switch starts a genuinely new conversation rather than replaying one
    // agent's thread at another.
    this.state = initialState()
    this.sync()
  }
```

- [ ] **Step 3: Add a second agent to the fixture**

Create `test/fixture/bookshop/srv/support-service.cds`:

```cds
using bookshop from '../db/schema';

@agent
@agent.connect: 'none'
@protocol: ['odata', 'agent']
service SupportService {
  entity Orders as projection on bookshop.Orders;
}
```

`@agent.connect: 'none'` is deliberate: the default is `'auto'`, which would make each agent expose the other as a delegation tool and muddy what the picker test is proving.

- [ ] **Step 4: Add the E2E case**

In `chat.spec.ts`:

```ts
test("offers a picker when several agents exist and switching resets the conversation", async ({ page, request }) => {
  const res = await request.get("/chat/agents.json")
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).length).toBeGreaterThan(1)

  await page.goto(APP_URL)
  const picker = page.getByRole("combobox")
  await expect(picker).toBeVisible()

  const input = page.getByPlaceholder("Ask the catalog agent")
  await input.fill("show me all books")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(input).toBeEnabled()
  const before = await page.getByText("user").count()
  expect(before).toBeGreaterThan(0)

  await picker.selectOption({ index: 1 })
  await expect(page.getByText("user")).toHaveCount(0)   // conversation reset
})
```

- [ ] **Step 5: Rebuild and run**

Run: `npm run build && npm run test:e2e`
Expected: 7/7 passing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: multi-agent picker driven by agents.json"
```

---

### Task 7: Consumer-facing documentation

**Files:**
- Modify: `README.md`
- Create: `docs/templates/AGENTS.md.template`, `docs/templates/SKILL.md.template`

- [ ] **Step 1: Rewrite the README for consumers**

It must open with what the plugin is and the two-line install, then cover: configuration (all four keys, plus the `true`/`false` shorthand), multi-agent behaviour, the `bootstrapUrl` override and when a restrictive CSP needs it, the optional `test-support/scripted-llm` export **with the explanation of why it exists** (the bundled mock cannot call actions, so HITL is otherwise untestable), BTP notes (static serving, same-origin, no approuter needed), and a "developing this plugin" section covering `npm run build`, the fixture, and the rule that `dist/` is committed.

- [ ] **Step 2: Ship the markdown agent templates**

Create the two templates with placeholders and comments explaining that frontmatter populates the agent card, that the body is the system prompt, and — the non-obvious part — that a skill's description becomes the delegation tool description a *parent* agent sees when deciding whether to route to this agent, so it is routing metadata, not just documentation.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: consumer README and agent markdown templates"
```

---

### Task 8: Guard against dist drift

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add CI**

Create a workflow that on push and pull request runs `npm ci`, `npm run typecheck`, `npm test`, `npx playwright install --with-deps chromium`, `npm run test:e2e`, then:

```yaml
      - name: dist/ is committed and current
        run: |
          test -n "$(git ls-files dist)" || { echo "dist/ is not tracked — check .gitignore"; exit 1; }
          npm run build
          git diff --exit-code -- dist || { echo "dist/ is stale — run npm run build and commit"; exit 1; }
```

Both halves matter: the first catches `dist/` being gitignored, the second catches someone editing `ui/` without rebuilding. Either failure ships a package that installs and serves nothing.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: verify dist is committed and current"
```

---

## Verification checklist

- [ ] `npm test` passes (unit + fixture service)
- [ ] `npm run test:e2e` passes (7 tests, against built `dist/`)
- [ ] `npm run typecheck` clean
- [ ] `git ls-files dist` is non-empty
- [ ] `grep -rn "Books\|book" lib/ cds-plugin.js` finds nothing domain-specific
- [ ] A scratch CAP project with an `@agent` service, installing the plugin by file path, serves the chat UI at `/chat` with no other configuration
