# CAP Agent UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CAP bookshop application exposing an A2A agent via `@cap-js/agents`, with a freestyle UI5 TypeScript chat UI that streams replies and gates writes behind human approval.

**Architecture:** One CDS service serves both OData and A2A. The UI5 app is served same-origin from the CDS server by `cds-plugin-ui5`, with live TypeScript transpilation. The chat client speaks A2A JSON-RPC over `fetch`, consuming SSE via `ReadableStream`; `JSONModel` is the view model only.

**Tech Stack:** `@sap/cds` v10, `@cap-js/agents` 0.9.1, `@cap-js/sqlite`, `cds-plugin-ui5`, `ui5-tooling-transpile`, SAPUI5 1.120, TypeScript, `node:test` + `tsx`, `@cap-js/cds-test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-cap-agent-ui-design.md`

## Global Constraints

- `@cap-js/agents` is pinned to exactly `0.9.1` — it is pre-1.0 and three days old.
- The service **must** carry both `@agent` and `@protocol: ['odata', 'agent']`. `@protocol` alone serves an agent card but registers no handlers, so every message fails.
- `Books` **must** be the first entity declared in the service. The mock LLM queries entity[0] with `limit 3` and nothing else.
- Any assertion on agent-returned data must target one of the **first three** book rows.
- The mock LLM cannot call actions. HITL requires `AGENT_LLM=scripted`.
- `cds.test` needs the separate `@cap-js/cds-test` dev dependency on CAP v10.
- Test runner is `node:test` for both unit and service layers. No Jest, no Mocha.
- Commit after every task.

---

### Task 1: CAP foundation — domain, service, and service tests

**Files:**
- Create: `package.json`, `db/schema.cds`, `db/data/bookshop-Authors.csv`, `db/data/bookshop-Books.csv`, `srv/cat-service.cds`, `srv/cat-service.js`, `.gitignore`
- Test: `test/service/catalog.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CatalogService` at `/odata/v4/catalog` and `/a2a/catalog`; action `submitOrder(book: Integer, quantity: Integer) → { stock: Integer }`; entities `Books`, `Authors`, `Orders`.

- [ ] **Step 1: Initialize the repository and package manifest**

```bash
cd C:/Users/woute/Documents/Projects/cap-agent-ui
git init
```

Create `package.json`:

```json
{
  "name": "cap-agent-ui",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@cap-js/agents": "0.9.1",
    "@cap-js/sqlite": "^3",
    "@sap/cds": "^10"
  },
  "devDependencies": {
    "@cap-js/cds-test": "^1"
  },
  "scripts": {
    "start": "cds-serve",
    "test:service": "node --test test/service/catalog.test.js",
    "test": "npm run test:service"
  }
}
```

Create `.gitignore`:

```
node_modules/
gen/
*.log
.env
test-results/
playwright-report/
dist/
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without errors.

- [ ] **Step 3: Write the domain model**

Create `db/schema.cds`:

```cds
namespace bookshop;

entity Authors {
  key ID    : Integer;
      name  : String(111);
      books : Association to many Books
                on books.author = $self;
}

entity Books {
  key ID     : Integer;
      title  : String(111);
      author : Association to Authors;
      stock  : Integer;
      price  : Decimal(9, 2);
}

entity Orders {
  key ID        : UUID;
      book      : Association to Books;
      quantity  : Integer;
      orderedAt : Timestamp;
}
```

Create `db/data/bookshop-Authors.csv`:

```csv
ID,name
1,Emily Brontë
2,Charlotte Brontë
3,Edgar Allan Poe
```

Create `db/data/bookshop-Books.csv`:

```csv
ID,title,author_ID,stock,price
1,Wuthering Heights,1,12,11.11
2,Jane Eyre,2,11,12.34
3,The Raven,3,333,13.13
```

Only three books: the mock LLM returns `limit 3`, so every row must be reachable by assertions. Book 1 is reserved for service tests, book 2 for the E2E approve test, book 3 for the E2E reject test.

- [ ] **Step 4: Write the service definition**

Create `srv/cat-service.cds`:

```cds
using bookshop from '../db/schema';

@agent
@protocol: ['odata', 'agent']
service CatalogService {
  entity Books   as projection on bookshop.Books;
  entity Authors as projection on bookshop.Authors;
  entity Orders  as projection on bookshop.Orders;

  action submitOrder(book : Books:ID, quantity : Integer) returns {
    stock : Integer
  };
}

annotate CatalogService.submitOrder with @agent.hitl;
```

`Books` is first on purpose. `@agent` and `@protocol` are both required. Do not remove either.

- [ ] **Step 5: Write the failing service test**

Create `test/service/catalog.test.js`:

```js
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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test:service`
Expected: FAIL — `submitOrder` has no handler, so the action returns `undefined` and the first assertion throws.

- [ ] **Step 7: Implement the service handler**

Create `srv/cat-service.js`:

```js
const cds = require("@sap/cds")

module.exports = class CatalogService extends cds.ApplicationService {
  init() {
    const { Books, Orders } = this.entities
    const { SELECT, INSERT, UPDATE } = cds.ql

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
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test:service`
Expected: PASS — 3 tests.

- [ ] **Step 9: Verify both protocols are served**

Run: `npx cds serve --in-memory`
Expected in the log:

```
[cds] - serving CatalogService {
  at: [ '/odata/v4/catalog', '/a2a/catalog' ],
```

If `at:` shows only one path, the `@agent` / `@protocol` combination is wrong — fix before continuing. Then, with the server running:

```bash
curl -s http://localhost:4004/a2a/catalog -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"message/send\",\"params\":{\"message\":{\"kind\":\"message\",\"role\":\"user\",\"messageId\":\"m1\",\"parts\":[{\"kind\":\"text\",\"text\":\"show me all books\"}]}}}"
```

Expected: `"state":"completed"` and the response text contains `Wuthering Heights`. If it instead reports *"buildGraph handler … Got: undefined"*, the `@agent` annotation is missing. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: CAP bookshop service with A2A agent and submitOrder"
```

---

### Task 2: UI5 TypeScript app served by cds-plugin-ui5

This task exists to de-risk the one load-bearing assumption in the design. Keep it thin; the real UI comes later.

**Files:**
- Create: `app/chat/ui5.yaml`, `app/chat/package.json`, `app/chat/tsconfig.json`, `app/chat/webapp/index.html`, `app/chat/webapp/manifest.json`, `app/chat/webapp/Component.ts`, `app/chat/webapp/view/Chat.view.xml`, `app/chat/webapp/controller/Chat.controller.ts`
- Modify: `package.json` (add dev dependencies)

**Interfaces:**
- Consumes: `/a2a/catalog/.well-known/agent-card.json` from Task 1.
- Produces: a UI5 app mounted on the CDS server; `Chat.controller.ts` exporting a default `Chat` controller class, extended in Task 6.

- [ ] **Step 1: Add the tooling dependencies**

Run:

```bash
npm add -D cds-plugin-ui5 ui5-tooling-transpile @ui5/cli typescript @sapui5/types
```

- [ ] **Step 2: Create the UI5 project descriptors**

Create `app/chat/package.json`:

```json
{
  "name": "chat",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "ui5-tooling-transpile": "^3"
  },
  "ui5": {
    "dependencies": ["ui5-tooling-transpile"]
  }
}
```

The `ui5.dependencies` array is required because UI5 Tooling ignores `devDependencies` unless they are listed there explicitly.

Create `app/chat/ui5.yaml`:

```yaml
specVersion: "3.0"
metadata:
  name: chat
type: application
framework:
  name: SAPUI5
  version: "1.120.0"
  libraries:
    - name: sap.m
    - name: sap.ui.core
    - name: themelib_sap_horizon
builder:
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
      configuration:
        debug: true
```

Create `app/chat/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "skipLibCheck": true,
    "strict": true,
    "types": ["@sapui5/types"]
  },
  "include": ["webapp/**/*"]
}
```

- [ ] **Step 3: Create the app shell**

Create `app/chat/webapp/manifest.json`:

```json
{
  "_version": "1.60.0",
  "sap.app": {
    "id": "capagentui.chat",
    "type": "application",
    "title": "Catalog Agent Chat",
    "applicationVersion": { "version": "1.0.0" }
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": { "desktop": true, "tablet": true, "phone": true }
  },
  "sap.ui5": {
    "dependencies": {
      "minUI5Version": "1.120.0",
      "libs": { "sap.m": {}, "sap.ui.core": {} }
    },
    "rootView": {
      "viewName": "capagentui.chat.view.Chat",
      "type": "XML",
      "id": "chatView",
      "async": true
    },
    "config": {
      "agentUrl": "/a2a/catalog"
    }
  }
}
```

The agent URL lives in the manifest because the endpoint path is configuration-dependent — an explicit `@path` on the service would move it off `/a2a`.

Create `app/chat/webapp/index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Catalog Agent Chat</title>
    <script
      id="sap-ui-bootstrap"
      src="resources/sap-ui-core.js"
      data-sap-ui-theme="sap_horizon"
      data-sap-ui-resource-roots='{"capagentui.chat": "./"}'
      data-sap-ui-oninit="module:sap/ui/core/ComponentSupport"
      data-sap-ui-compat-version="edge"
      data-sap-ui-async="true"
    ></script>
  </head>
  <body class="sapUiBody">
    <div
      data-sap-ui-component
      data-name="capagentui.chat"
      data-id="container"
      data-height="100%"
    ></div>
  </body>
</html>
```

Create `app/chat/webapp/Component.ts`:

```ts
import UIComponent from "sap/ui/core/UIComponent"

export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  }

  public init(): void {
    super.init()
  }
}
```

- [ ] **Step 4: Create the minimal view and controller**

Create `app/chat/webapp/view/Chat.view.xml`:

```xml
<mvc:View
  controllerName="capagentui.chat.controller.Chat"
  xmlns="sap.m"
  xmlns:mvc="sap.ui.core.mvc"
  displayBlock="true">
  <Page id="page" title="{chat>/agentName}">
    <content>
      <Text id="bootProbe" text="Agent: {chat>/agentName}" class="sapUiSmallMargin" />
    </content>
  </Page>
</mvc:View>
```

Create `app/chat/webapp/controller/Chat.controller.ts`:

```ts
import Controller from "sap/ui/core/mvc/Controller"
import JSONModel from "sap/ui/model/json/JSONModel"
import Component from "sap/ui/core/Component"

export default class Chat extends Controller {
  protected model!: JSONModel
  protected agentUrl!: string

  public onInit(): void {
    const owner = this.getOwnerComponent() as Component
    this.agentUrl = owner.getManifestEntry("/sap.ui5/config/agentUrl") as unknown as string

    this.model = new JSONModel({ agentName: "connecting…" })
    this.getView()?.setModel(this.model, "chat")

    void this.loadAgentCard()
  }

  private async loadAgentCard(): Promise<void> {
    try {
      const res = await fetch(`${this.agentUrl}/.well-known/agent-card.json`)
      const card = (await res.json()) as { name?: string }
      this.model.setProperty("/agentName", card.name ?? "Agent")
    } catch {
      this.model.setProperty("/agentName", "unavailable")
    }
  }
}
```

- [ ] **Step 5: Start the server and confirm the mount path**

Run: `npx cds watch`
Expected: the startup log lists the UI5 app served by `cds-plugin-ui5`. Read the mount path from that log line.

- [ ] **Step 6: Verify TypeScript transpiles and the app boots**

Open the mount path in a browser (expected `http://localhost:4004/chat/index.html`).
Expected: the page renders `Agent: CatalogService`.

Both halves matter: rendering at all proves `ui5-tooling-transpile-middleware` compiled `.ts` on the fly, and the agent name proves a same-origin request reached the A2A endpoint.

If the mount path is not `/chat`, record the actual value — it becomes `APP_URL` in Task 8. If the page 404s or serves raw TypeScript, the transpile middleware is not active: check that `ui5.dependencies` in `app/chat/package.json` lists `ui5-tooling-transpile`.

Stop the server.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: UI5 TypeScript chat shell served by cds-plugin-ui5"
```

---

### Task 3: A2A types and SSE parser

**Files:**
- Create: `app/chat/webapp/a2a/types.ts`, `app/chat/webapp/a2a/sse.ts`
- Test: `test/unit/sse.test.ts`
- Modify: `package.json` (test scripts, `tsx`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseSSE(buffer: string, chunk: string): { frames: SSEFrame[]; rest: string }`
  - `SSEFrame { event?: string; data: string }`
  - `partsToText(parts: Part[] | undefined): string`
  - Types `A2AEvent`, `Task`, `StatusUpdate`, `ArtifactUpdate`, `AgentCard`, `JsonRpcEnvelope<T>`, `TaskState`

- [ ] **Step 1: Add the unit test tooling**

Run: `npm add -D tsx`

Update the `scripts` block in the root `package.json` to:

```json
"scripts": {
  "start": "cds-serve",
  "test:unit": "node --import tsx --test test/unit/sse.test.ts test/unit/chatState.test.ts test/unit/A2AClient.test.ts",
  "test:service": "node --test test/service/catalog.test.js",
  "test": "npm run test:unit && npm run test:service"
}
```

The unit test files are listed explicitly rather than globbed, because Node's test runner does not discover `.ts` files by directory.

- [ ] **Step 2: Write the failing SSE parser test**

Create `test/unit/sse.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { parseSSE } from "../../app/chat/webapp/a2a/sse"

test("parses a single complete frame", () => {
  const { frames, rest } = parseSSE("", 'data: {"a":1}\n\n')
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, '{"a":1}')
  assert.equal(rest, "")
})

test("retains a trailing partial frame in rest", () => {
  const { frames, rest } = parseSSE("", 'data: {"a":1}\n\ndata: {"b"')
  assert.equal(frames.length, 1)
  assert.equal(rest, 'data: {"b"')
})

test("joins a frame split across two chunks", () => {
  const first = parseSSE("", 'data: {"a"')
  assert.equal(first.frames.length, 0)
  const second = parseSSE(first.rest, ':1}\n\n')
  assert.equal(second.frames.length, 1)
  assert.equal(second.frames[0].data, '{"a":1}')
})

test("concatenates multiple data lines in one frame", () => {
  const { frames } = parseSSE("", "data: line1\ndata: line2\n\n")
  assert.equal(frames[0].data, "line1\nline2")
})

test("captures the event type of an error frame", () => {
  const { frames } = parseSSE("", 'event: error\ndata: {"code":-32603}\n\n')
  assert.equal(frames[0].event, "error")
  assert.equal(frames[0].data, '{"code":-32603}')
})

test("ignores comment lines and blank padding", () => {
  const { frames } = parseSSE("", ": keep-alive\ndata: ok\n\n")
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, "ok")
})

test("handles CRLF line endings", () => {
  const { frames } = parseSSE("", "data: ok\r\n\r\n")
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data, "ok")
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `../../app/chat/webapp/a2a/sse`.

- [ ] **Step 4: Write the types module**

Create `app/chat/webapp/a2a/types.ts`:

```ts
export interface TextPart {
  kind: "text"
  text: string
}

export type Part = TextPart | { kind: string; [key: string]: unknown }

export interface AgentMessage {
  kind: "message"
  messageId: string
  role: "user" | "agent"
  parts: Part[]
  taskId?: string
  contextId?: string
}

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"

export interface TaskStatus {
  state: TaskState
  message?: AgentMessage
  timestamp?: string
}

export interface Artifact {
  artifactId: string
  parts: Part[]
}

export interface Task {
  kind: "task"
  id: string
  contextId: string
  status: TaskStatus
  artifacts?: Artifact[]
  history?: AgentMessage[]
}

export interface StatusUpdate {
  kind: "status-update"
  taskId: string
  contextId: string
  status: TaskStatus
  final: boolean
}

export interface ArtifactUpdate {
  kind: "artifact-update"
  taskId: string
  contextId: string
  append?: boolean
  lastChunk?: boolean
  artifact: Artifact
}

export type A2AEvent = Task | StatusUpdate | ArtifactUpdate

export interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0"
  id: string | number | null
  result?: T
  error?: { code: number; message: string }
}

export interface AgentCard {
  name: string
  description?: string
  url: string
  version: string
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  skills?: { id: string; name: string; description?: string }[]
}

export function partsToText(parts: Part[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join("")
}
```

`append` and `lastChunk` sit on `ArtifactUpdate` itself, not inside `artifact` — this matches the frames the server actually emits.

- [ ] **Step 5: Write the SSE parser**

Create `app/chat/webapp/a2a/sse.ts`:

```ts
export interface SSEFrame {
  event?: string
  data: string
}

export function parseSSE(
  buffer: string,
  chunk: string,
): { frames: SSEFrame[]; rest: string } {
  const combined = (buffer + chunk).replace(/\r\n/g, "\n")
  const blocks = combined.split("\n\n")
  const rest = blocks.pop() ?? ""
  const frames: SSEFrame[] = []

  for (const block of blocks) {
    if (!block.trim()) continue

    let event: string | undefined
    const dataLines: string[] = []

    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""))
    }

    if (dataLines.length) frames.push({ event, data: dataLines.join("\n") })
  }

  return { frames, rest }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — 7 tests. `chatState.test.ts` and `A2AClient.test.ts` do not exist yet, so temporarily run only the SSE file:
`node --import tsx --test test/unit/sse.test.ts`

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: A2A types and SSE frame parser"
```

---

### Task 4: Chat state reducer

**Files:**
- Create: `app/chat/webapp/chat/chatState.ts`
- Test: `test/unit/chatState.test.ts`

**Interfaces:**
- Consumes: `A2AEvent`, `partsToText` from Task 3.
- Produces:
  - `ChatState { messages, busy, status, contextId, taskId, pendingApproval, streamed }`
  - `ChatMessage { id, role: "user" | "agent" | "error", text, streaming }`
  - `initialState(): ChatState`
  - `appendUser(state, text): ChatState`
  - `appendError(state, text): ChatState`
  - `applyEvent(state, event): ChatState`

- [ ] **Step 1: Write the failing reducer test**

Create `test/unit/chatState.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  initialState,
  appendUser,
  appendError,
  applyEvent,
} from "../../app/chat/webapp/chat/chatState"
import type { A2AEvent } from "../../app/chat/webapp/a2a/types"

const taskEvent: A2AEvent = {
  kind: "task",
  id: "t1",
  contextId: "c1",
  status: { state: "submitted" },
}

function statusEvent(state: string, text?: string): A2AEvent {
  return {
    kind: "status-update",
    taskId: "t1",
    contextId: "c1",
    final: state === "completed",
    status: {
      state: state as never,
      ...(text
        ? { message: { kind: "message", messageId: "m", role: "agent", parts: [{ kind: "text", text }] } }
        : {}),
    },
  } as A2AEvent
}

function artifactEvent(text: string, append: boolean): A2AEvent {
  return {
    kind: "artifact-update",
    taskId: "t1",
    contextId: "c1",
    append,
    lastChunk: false,
    artifact: { artifactId: "response", parts: [{ kind: "text", text }] },
  }
}

test("appendUser adds a user message and marks busy", () => {
  const s = appendUser(initialState(), "hello")
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0].role, "user")
  assert.equal(s.busy, true)
  assert.equal(s.streamed, false)
})

test("task event records ids", () => {
  const s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  assert.equal(s.taskId, "t1")
  assert.equal(s.contextId, "c1")
  assert.equal(s.busy, true)
})

test("working status sets the transient status line", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, statusEvent("working", "Querying Books"))
  assert.equal(s.status, "Querying Books")
  assert.equal(s.busy, true)
})

test("artifact-update with append=false replaces the streaming bubble", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, artifactEvent("Hello", false))
  s = applyEvent(s, artifactEvent("Hello world", false))
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent.length, 1)
  assert.equal(agent[0].text, "Hello world")
})

test("artifact-update with append=true concatenates", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, artifactEvent("Hello", false))
  s = applyEvent(s, artifactEvent(" world", true))
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent[0].text, "Hello world")
})

test("completed clears busy and does not duplicate the streamed text", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, artifactEvent("Answer", false))
  s = applyEvent(s, statusEvent("completed", "Answer"))
  assert.equal(s.busy, false)
  assert.equal(s.status, "")
  assert.equal(s.messages.filter((m) => m.role === "agent").length, 1)
  assert.equal(s.messages.every((m) => !m.streaming), true)
})

test("completed adds the message when nothing streamed", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, statusEvent("completed", "Direct answer"))
  const agent = s.messages.filter((m) => m.role === "agent")
  assert.equal(agent.length, 1)
  assert.equal(agent[0].text, "Direct answer")
})

test("input-required raises pendingApproval and clears busy", () => {
  let s = applyEvent(appendUser(initialState(), "order it"), taskEvent)
  s = applyEvent(s, statusEvent("input-required", "Tool execution requires approval"))
  assert.equal(s.pendingApproval, true)
  assert.equal(s.busy, false)
  assert.equal(s.taskId, "t1")
  assert.equal(s.messages.at(-1)?.text, "Tool execution requires approval")
})

test("failed clears busy and records an error", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, statusEvent("failed", "boom"))
  assert.equal(s.busy, false)
  assert.equal(s.messages.at(-1)?.role, "error")
})

test("canceled clears busy", () => {
  let s = applyEvent(appendUser(initialState(), "hi"), taskEvent)
  s = applyEvent(s, statusEvent("canceled"))
  assert.equal(s.busy, false)
})

test("appendError never leaves the UI busy", () => {
  const s = appendError(appendUser(initialState(), "hi"), "network down")
  assert.equal(s.busy, false)
  assert.equal(s.pendingApproval, false)
  assert.equal(s.messages.at(-1)?.role, "error")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/unit/chatState.test.ts`
Expected: FAIL — cannot resolve `chatState`.

- [ ] **Step 3: Write the reducer**

Create `app/chat/webapp/chat/chatState.ts`:

```ts
import { partsToText } from "../a2a/types"
import type { A2AEvent } from "../a2a/types"

export interface ChatMessage {
  id: string
  role: "user" | "agent" | "error"
  text: string
  streaming: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  busy: boolean
  status: string
  contextId: string | null
  taskId: string | null
  pendingApproval: boolean
  streamed: boolean
}

export function initialState(): ChatState {
  return {
    messages: [],
    busy: false,
    status: "",
    contextId: null,
    taskId: null,
    pendingApproval: false,
    streamed: false,
  }
}

function push(
  state: ChatState,
  role: ChatMessage["role"],
  text: string,
  streaming = false,
): ChatState {
  const id = `${role.charAt(0)}${state.messages.length}`
  return { ...state, messages: [...state.messages, { id, role, text, streaming }] }
}

function finalize(state: ChatState): ChatState {
  if (!state.messages.some((m) => m.streaming)) return state
  return {
    ...state,
    messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
  }
}

export function appendUser(state: ChatState, text: string): ChatState {
  return {
    ...push(state, "user", text),
    busy: true,
    status: "",
    pendingApproval: false,
    streamed: false,
  }
}

export function appendError(state: ChatState, text: string): ChatState {
  return {
    ...push(finalize(state), "error", text),
    busy: false,
    status: "",
    pendingApproval: false,
  }
}

function upsertStream(state: ChatState, text: string, append: boolean): ChatState {
  const messages = [...state.messages]
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]

  if (last && last.role === "agent" && last.streaming) {
    messages[lastIndex] = { ...last, text: append ? last.text + text : text }
    return { ...state, messages, streamed: true, busy: true }
  }

  return { ...push(state, "agent", text, true), streamed: true, busy: true }
}

export function applyEvent(state: ChatState, event: A2AEvent): ChatState {
  if (event.kind === "task") {
    return { ...state, taskId: event.id, contextId: event.contextId, busy: true }
  }

  if (event.kind === "artifact-update") {
    return upsertStream(state, partsToText(event.artifact?.parts), event.append === true)
  }

  if (event.kind === "status-update") {
    const base: ChatState = {
      ...state,
      taskId: event.taskId ?? state.taskId,
      contextId: event.contextId ?? state.contextId,
    }
    const text = partsToText(event.status?.message?.parts)

    switch (event.status?.state) {
      case "working":
        return { ...base, busy: true, status: text }

      case "input-required": {
        const done = finalize(base)
        const withMessage = text && !done.streamed ? push(done, "agent", text) : done
        return { ...withMessage, busy: false, status: "", pendingApproval: true }
      }

      case "completed": {
        const done = finalize(base)
        const withMessage = text && !done.streamed ? push(done, "agent", text) : done
        return {
          ...withMessage,
          busy: false,
          status: "",
          pendingApproval: false,
          streamed: false,
        }
      }

      case "failed":
      case "canceled":
        return appendError(base, text || `Task ${event.status.state}.`)

      default:
        return base
    }
  }

  return state
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/unit/chatState.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: pure chat state reducer for A2A events"
```

---

### Task 5: A2A client

**Files:**
- Create: `app/chat/webapp/a2a/A2AClient.ts`
- Test: `test/unit/A2AClient.test.ts`

**Interfaces:**
- Consumes: `parseSSE` (Task 3), types (Task 3).
- Produces:
  - `new A2AClient(baseUrl: string)`
  - `getAgentCard(): Promise<AgentCard>`
  - `streamMessage(params: SendParams, onEvent: (e: A2AEvent) => void, signal?: AbortSignal): Promise<void>`
  - `cancel(taskId: string): Promise<void>`
  - `SendParams { text: string; contextId?: string | null; taskId?: string | null }`

- [ ] **Step 1: Write the failing client test**

Create `test/unit/A2AClient.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { A2AClient } from "../../app/chat/webapp/a2a/A2AClient"
import type { A2AEvent } from "../../app/chat/webapp/a2a/types"

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

test("streamMessage yields parsed events in order", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"t1","contextId":"c1","status":{"state":"submitted"}}}\n\n',
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"t1","contextId":"c1","final":true,"status":{"state":"completed"}}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  const received: A2AEvent[] = []
  await new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, (e) => received.push(e))

  assert.equal(received.length, 2)
  assert.equal(received[0].kind, "task")
  assert.equal(received[1].kind, "status-update")
})

test("streamMessage reassembles an event split across chunks", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task",',
    '"id":"t1","contextId":"c1","status":{"state":"submitted"}}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  const received: A2AEvent[] = []
  await new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, (e) => received.push(e))

  assert.equal(received.length, 1)
  assert.equal(received[0].kind, "task")
})

test("streamMessage throws on a JSON-RPC error frame", async () => {
  const frames = [
    'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32029,"message":"Message too long."}}\n\n',
  ]
  globalThis.fetch = (async () => sseResponse(frames)) as typeof fetch

  await assert.rejects(
    () => new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, () => {}),
    /Message too long/,
  )
})

test("streamMessage surfaces a non-OK response message", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized." } }), {
      status: 401,
    })) as typeof fetch

  await assert.rejects(
    () => new A2AClient("/a2a/catalog").streamMessage({ text: "hi" }, () => {}),
    /Unauthorized/,
  )
})

test("streamMessage sends contextId and taskId when provided", async () => {
  let sent = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body ?? "")
    return sseResponse([])
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").streamMessage(
    { text: "approve", contextId: "c1", taskId: "t1" },
    () => {},
  )

  const body = JSON.parse(sent)
  assert.equal(body.method, "message/stream")
  assert.equal(body.params.message.contextId, "c1")
  assert.equal(body.params.message.taskId, "t1")
})

test("streamMessage omits contextId on a first message", async () => {
  let sent = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body ?? "")
    return sseResponse([])
  }) as typeof fetch

  await new A2AClient("/a2a/catalog").streamMessage({ text: "hello" }, () => {})

  const body = JSON.parse(sent)
  assert.equal("contextId" in body.params.message, false)
  assert.equal("taskId" in body.params.message, false)
})

test("getAgentCard returns the parsed card", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ name: "CatalogService", url: "/a2a/catalog", version: "0.0.1" }), {
      status: 200,
    })) as typeof fetch

  const card = await new A2AClient("/a2a/catalog").getAgentCard()
  assert.equal(card.name, "CatalogService")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/unit/A2AClient.test.ts`
Expected: FAIL — cannot resolve `A2AClient`.

- [ ] **Step 3: Write the client**

Create `app/chat/webapp/a2a/A2AClient.ts`:

```ts
import { parseSSE } from "./sse"
import type { A2AEvent, AgentCard, JsonRpcEnvelope } from "./types"

export interface SendParams {
  text: string
  contextId?: string | null
  taskId?: string | null
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export class A2AClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  public async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent-card.json`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`Agent card request failed: ${res.status}`)
    return (await res.json()) as AgentCard
  }

  public async streamMessage(
    params: SendParams,
    onEvent: (event: A2AEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: this.envelope("message/stream", params),
      signal,
    })

    if (!res.ok || !res.body) {
      const envelope = (await res.json().catch(() => null)) as JsonRpcEnvelope<never> | null
      throw new Error(envelope?.error?.message ?? `Request failed: ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const parsed = parseSSE(buffer, decoder.decode(value, { stream: true }))
      buffer = parsed.rest

      for (const frame of parsed.frames) {
        const envelope = JSON.parse(frame.data) as JsonRpcEnvelope<A2AEvent>
        if (envelope.error) throw new Error(envelope.error.message)
        if (envelope.result) onEvent(envelope.result)
      }
    }
  }

  public async cancel(taskId: string): Promise<void> {
    await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: newId(),
        method: "tasks/cancel",
        params: { id: taskId },
      }),
    }).catch(() => undefined)
  }

  private envelope(method: string, params: SendParams): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: newId(),
      method,
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: newId(),
          parts: [{ kind: "text", text: params.text }],
          ...(params.contextId ? { contextId: params.contextId } : {}),
          ...(params.taskId ? { taskId: params.taskId } : {}),
        },
      },
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — all three unit files, 25 tests total.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: fetch-based A2A streaming client"
```

---

### Task 6: Chat UI wiring

**Files:**
- Modify: `app/chat/webapp/view/Chat.view.xml`, `app/chat/webapp/controller/Chat.controller.ts`

**Interfaces:**
- Consumes: `A2AClient` (Task 5), `chatState` (Task 4).
- Produces: a working chat page. Controller handlers `onSend`, `onSubmit`, `onCancel` bound in the view. Stable locators: placeholder `Ask the catalog agent`, buttons named `Send` and `Cancel`.

A deviation from the spec, deliberate: the input is `sap.m.Input` plus an explicit `Send` button rather than `sap.m.FeedInput`, and Cancel is its own button rather than Send relabelling itself. `FeedInput` owns its post button and cannot relabel it, and explicit controls give the E2E suite unambiguous role-and-name locators.

- [ ] **Step 1: Replace the view**

Replace the contents of `app/chat/webapp/view/Chat.view.xml`:

```xml
<mvc:View
  controllerName="capagentui.chat.controller.Chat"
  xmlns="sap.m"
  xmlns:mvc="sap.ui.core.mvc"
  displayBlock="true">
  <Page id="page" title="{chat>/agentName}">
    <content>
      <List
        id="messageList"
        items="{chat>/messages}"
        showSeparators="None"
        noDataText="Ask the agent something to get started.">
        <CustomListItem>
          <VBox class="sapUiSmallMarginBegin sapUiTinyMarginTop">
            <Label text="{chat>role}" design="Bold" />
            <Text text="{chat>text}" />
          </VBox>
        </CustomListItem>
      </List>

      <Text
        id="statusLine"
        text="{chat>/status}"
        visible="{= !!${chat>/status} }"
        class="sapUiSmallMarginBegin" />

      <HBox visible="{chat>/pendingApproval}" class="sapUiSmallMargin">
        <Button id="approveBtn" text="Approve" type="Emphasized" press=".onApprove" />
        <Button id="rejectBtn" text="Reject" press=".onReject" class="sapUiTinyMarginBegin" />
      </HBox>
    </content>

    <footer>
      <Toolbar>
        <Input
          id="promptInput"
          width="100%"
          placeholder="Ask the catalog agent"
          submit=".onSubmit"
          enabled="{= !${chat>/busy} }" />
        <Button
          id="sendBtn"
          text="Send"
          type="Emphasized"
          press=".onSend"
          enabled="{= !${chat>/busy} }" />
        <Button id="cancelBtn" text="Cancel" press=".onCancel" visible="{chat>/busy}" />
      </Toolbar>
    </footer>
  </Page>
</mvc:View>
```

`onApprove` and `onReject` are wired here but implemented in Task 7; until then the buttons never become visible because `pendingApproval` stays false under the mock LLM.

- [ ] **Step 2: Replace the controller**

Replace the contents of `app/chat/webapp/controller/Chat.controller.ts`:

```ts
import Controller from "sap/ui/core/mvc/Controller"
import JSONModel from "sap/ui/model/json/JSONModel"
import Component from "sap/ui/core/Component"
import Input from "sap/m/Input"
import { A2AClient } from "../a2a/A2AClient"
import { initialState, appendUser, appendError, applyEvent } from "../chat/chatState"
import type { ChatState } from "../chat/chatState"

export default class Chat extends Controller {
  private model!: JSONModel
  private client!: A2AClient
  private state!: ChatState
  private agentName = "Catalog Agent"
  private abort?: AbortController

  public onInit(): void {
    const owner = this.getOwnerComponent() as Component
    const agentUrl = owner.getManifestEntry("/sap.ui5/config/agentUrl") as unknown as string

    this.client = new A2AClient(agentUrl)
    this.state = initialState()
    this.model = new JSONModel()
    this.getView()?.setModel(this.model, "chat")
    this.sync()

    void this.loadAgentCard()
  }

  public onSubmit(): void {
    void this.send()
  }

  public onSend(): void {
    void this.send()
  }

  public onCancel(): void {
    this.abort?.abort()
    if (this.state.taskId) void this.client.cancel(this.state.taskId)
  }

  private async loadAgentCard(): Promise<void> {
    try {
      const card = await this.client.getAgentCard()
      this.agentName = card.name || this.agentName
    } catch {
      this.agentName = "Catalog Agent (offline)"
    }
    this.sync()
  }

  private input(): Input {
    return this.byId("promptInput") as Input
  }

  private async send(): Promise<void> {
    const field = this.input()
    const text = (field.getValue() ?? "").trim()
    if (!text || this.state.busy) return

    field.setValue("")
    await this.exchange(text, null)
  }

  protected async exchange(text: string, resumeTaskId: string | null): Promise<void> {
    const contextId = this.state.contextId
    this.state = appendUser(this.state, text)
    this.sync()

    this.abort = new AbortController()

    try {
      await this.client.streamMessage(
        { text, contextId, taskId: resumeTaskId },
        (event) => {
          this.state = applyEvent(this.state, event)
          this.sync()
        },
        this.abort.signal,
      )
    } catch (err) {
      const error = err as Error
      if (error.name !== "AbortError") {
        this.state = appendError(this.state, error.message)
      } else {
        this.state = { ...this.state, busy: false, status: "" }
      }
      this.sync()
    } finally {
      if (this.state.busy && !this.state.pendingApproval) {
        this.state = { ...this.state, busy: false, status: "" }
        this.sync()
      }
      this.abort = undefined
    }
  }

  private sync(): void {
    this.model.setData({ ...this.state, agentName: this.agentName })
  }
}
```

`exchange` is `protected` because Task 7 reuses it for approve and reject. The `finally` block is the guarantee that no failure path can leave the UI stuck busy.

- [ ] **Step 3: Verify streaming in the browser**

Run: `npx cds watch`
Open the app mount path from Task 2 and type `show me all books`, then press Send.

Expected: the page title shows `CatalogService`, a user bubble appears, and an agent bubble arrives containing `Wuthering Heights`. The input re-enables when the turn finishes.

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: streaming chat UI wired to the A2A client"
```

---

### Task 7: Human-in-the-loop approval and the scripted test LLM

**Files:**
- Create: `test-support/scripted-llm.mjs`
- Modify: `srv/cat-service.js`, `app/chat/webapp/controller/Chat.controller.ts`, `package.json`

**Interfaces:**
- Consumes: `exchange` (Task 6), `pendingApproval` / `taskId` from `ChatState` (Task 4).
- Produces: controller handlers `onApprove` / `onReject`; a scripted LLM active only when `AGENT_LLM=scripted`.

The mock LLM never calls `submitOrder`, so without the scripted model this task cannot be demonstrated at all.

- [ ] **Step 1: Add the LangChain dependency**

Run: `npm add -D @langchain/core`

It is declared explicitly rather than relied on through `@cap-js/agents`' transitive tree, which npm may or may not hoist.

- [ ] **Step 2: Write the scripted LLM**

Create `test-support/scripted-llm.mjs`:

```js
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
```

- [ ] **Step 3: Register the scripted model behind an env guard**

In `srv/cat-service.js`, insert this block inside `init()`, immediately before the `this.on("submitOrder", …)` registration:

```js
    // E2E only: the plugin's mock LLM cannot call actions, so HITL would be
    // unreachable. Handlers registered here take precedence over the plugin's
    // default buildModel handler.
    if (process.env.AGENT_LLM === "scripted") {
      this.on("buildModel", async () => {
        const { default: ScriptedChatModel } = await import("../test-support/scripted-llm.mjs")
        return new ScriptedChatModel("scripted")
      })
    }
```

- [ ] **Step 4: Add the approve and reject handlers**

In `app/chat/webapp/controller/Chat.controller.ts`, add these two methods to the `Chat` class:

```ts
  public onApprove(): void {
    void this.decide("approve")
  }

  public onReject(): void {
    void this.decide("reject")
  }

  private async decide(decision: "approve" | "reject"): Promise<void> {
    const taskId = this.state.taskId
    if (!taskId || !this.state.pendingApproval) return
    await this.exchange(decision, taskId)
  }
```

Resuming a paused task means sending an ordinary user message carrying the same `taskId` and `contextId` with the text `approve` or `reject`.

- [ ] **Step 5: Note how the variable is set**

Do not add an npm script for this. `AGENT_LLM=scripted cds-serve` is POSIX syntax that fails in PowerShell, and pulling in a helper package to paper over that is not worth it for one variable.

For manual verification on Windows PowerShell:

```powershell
$env:AGENT_LLM = "scripted"; npx cds watch
```

Playwright sets it through its `env` option in Task 8, which is cross-platform and is the authoritative path.

- [ ] **Step 6: Verify the approval flow by hand**

Run:

```powershell
$env:AGENT_LLM = "scripted"; npx cds watch
```

In the app, send `order 2 copies of book 1`.

Expected: an agent message reading `Tool execution requires approval` with `Tool: submitOrder`, and Approve / Reject buttons visible. Check `http://localhost:4004/odata/v4/catalog/Books(1)` — stock is still 12. Click Approve.

Expected: the task completes and `Books(1)` stock is now 10.

Then reload, send the same message, and click Reject. Expected: stock unchanged.

Stop the server and clear the variable with `Remove-Item Env:\AGENT_LLM`.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: HITL approval flow with a scripted test LLM"
```

---

### Task 8: Playwright end-to-end suite

**Files:**
- Create: `playwright.config.ts`, `test/e2e/constants.ts`, `test/e2e/chat.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running app from Tasks 6 and 7.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Install Playwright**

Run:

```bash
npm add -D @playwright/test
npx playwright install chromium
```

Add to `scripts` in the root `package.json`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Write the config**

Create `playwright.config.ts`:

```ts
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
    url: "http://localhost:4004/a2a/catalog/.well-known/agent-card.json",
    env: { AGENT_LLM: "scripted" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

`workers: 1` with `fullyParallel: false` is required, not stylistic: the in-memory database is seeded once at server start and shared for the whole run.

- [ ] **Step 3: Record the app URL**

Create `test/e2e/constants.ts`:

```ts
// Mount path assigned by cds-plugin-ui5, confirmed in Task 2 Step 5.
// If the startup log shows a different path, change it here.
export const APP_URL = "/chat/index.html"

// Books reserved per test so that stock mutations cannot collide.
export const APPROVE_BOOK = 2
export const REJECT_BOOK = 3
```

- [ ] **Step 4: Write the end-to-end specs**

Create `test/e2e/chat.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { APP_URL, APPROVE_BOOK, REJECT_BOOK } from "./constants"

async function stockOf(request: APIRequestContext, id: number): Promise<number> {
  const res = await request.get(`/odata/v4/catalog/Books(${id})`)
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
  const bodies: string[] = []
  await page.route("**/a2a/catalog", async (route) => {
    bodies.push(route.request().postData() ?? "")
    await route.continue()
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
  await page.getByPlaceholder("Ask the catalog agent").fill(`order 1 copies of book ${REJECT_BOOK}`)
  await page.getByRole("button", { name: "Send" }).click()

  const reject = page.getByRole("button", { name: "Reject" })
  await expect(reject).toBeVisible()

  await reject.click()
  await expect(reject).toBeHidden()

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
```

Checking stock *before* clicking Approve is the assertion that proves the gate is real rather than cosmetic.

- [ ] **Step 5: Run the suite**

Run: `npm run test:e2e`
Expected: PASS — 5 tests.

If the first test cannot find the input, `APP_URL` in `test/e2e/constants.ts` is wrong; correct it from the `cds watch` startup log.

- [ ] **Step 6: Run the full test suite**

Run: `npm test && npm run test:e2e`
Expected: all unit, service, and E2E tests pass.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "test: Playwright end-to-end suite covering streaming and HITL"
```

---

### Task 9: Phase B — markdown-defined agent

**Files:**
- Create: `srv/catalog-agent/AGENTS.md`, `srv/catalog-agent/skills/book-purchase/SKILL.md`

**Interfaces:**
- Consumes: the `CatalogService` from Task 1.
- Produces: no code interface. The directory replaces the auto-generated agent at startup.

The directory name must be the slugified service name — `CatalogService` becomes `catalog-agent`. The plugin detects it by the presence of `AGENTS.md`.

- [ ] **Step 1: Capture the Phase A agent card for comparison**

Run: `npx cds serve --in-memory`, then:

```bash
curl -s http://localhost:4004/a2a/catalog/.well-known/agent-card.json > docs/agent-card-phase-a.json
```

Stop the server.

- [ ] **Step 2: Write the agent definition**

Create `srv/catalog-agent/AGENTS.md`:

```md
---
name: catalog-agent
version: "1.0.0"
description: >
  Bookshop assistant that answers questions about the catalog and places
  orders on the user's behalf.
---

# Catalog Agent

## Identity

You are the **Catalog Agent** for an online bookshop. You are concise,
factual, and never invent titles, prices, or stock levels.

## Behaviour

- Answer questions about books by querying the catalog rather than guessing.
- Quote stock and price exactly as returned by the tools.
- When a user asks to buy or order a book, follow the Book Purchase skill.
- If a request is ambiguous about which book or how many copies, ask before acting.
- Never claim an order succeeded unless the tool call returned successfully.
```

- [ ] **Step 3: Write the skill**

Create `srv/catalog-agent/skills/book-purchase/SKILL.md`:

```md
---
name: book-purchase
description: Order one or more copies of a book for the user.
---

# Book Purchase

## When to use

The user asks to buy, order, or reserve a book.

## Workflow

1. Identify the book. If the user gave a title rather than an ID, query the
   catalog to resolve it. If more than one title matches, ask which they mean.
2. Determine the quantity. Assume 1 only if the user clearly implies a single copy.
3. Check the current stock. If stock is lower than the requested quantity, tell
   the user how many are available and stop.
4. Call `submitOrder` with the book ID and quantity. This action requires human
   approval, so expect the request to pause.
5. Report the outcome using the remaining stock returned by the action.

## Examples

- "I'd like two copies of The Raven" → resolve The Raven, then order quantity 2.
- "Order book 1" → order book ID 1, quantity 1.
- "Buy every copy of Jane Eyre" → ask how many copies they want.
```

- [ ] **Step 4: Verify the markdown agent took over**

Run: `npx cds serve --in-memory`, then:

```bash
curl -s http://localhost:4004/a2a/catalog/.well-known/agent-card.json
```

Expected: the card's `name` is now `catalog-agent` and the description matches the `AGENTS.md` frontmatter, rather than the generated `Agent for CatalogService`. Diff against `docs/agent-card-phase-a.json` to see exactly what the markdown directory changed.

Stop the server.

- [ ] **Step 5: Confirm the wire contract is unbroken**

Run: `npm run test:e2e`
Expected: the same 5 tests still pass, unchanged.

This is the point of the phased build. The suite was written against Phase A; passing it untouched against Phase B proves the markdown agent did not alter the protocol behaviour the UI depends on.

If the HITL tests now fail, the likely cause is the scripted LLM: a deep agent may present tools differently. Check whether `submitOrder` still appears in the bound tool list before changing the tests.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: markdown-defined catalog agent (Phase B)"
```

---

## Verification checklist

Run all of these from a clean checkout before calling the project done:

- [ ] `npm install` succeeds
- [ ] `npm test` passes (unit + service)
- [ ] `npm run test:e2e` passes (5 tests)
- [ ] `npx cds watch` serves `at: [ '/odata/v4/catalog', '/a2a/catalog' ]`
- [ ] The chat app loads and streams a reply naming a real book
- [ ] With `AGENT_LLM=scripted`, ordering pauses for approval and Approve moves stock
- [ ] The agent card reports `catalog-agent` (Phase B active)
