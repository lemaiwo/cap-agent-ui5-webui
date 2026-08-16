# CAP Agent UI — Design

**Date:** 2026-08-16
**Status:** Approved for planning

## Goal

Build a CAP application that exercises the `@cap-js/agents` plugin, with a freestyle UI5 TypeScript chat interface on top of it. The purpose is evaluation: to see both agent-definition mechanisms working, and to have a chat client that handles streaming and human-in-the-loop approval end to end.

Success means: `npm install && cds watch`, open one URL, type "show me all books", and watch the reply stream in incrementally — with no cloud binding.

The ordering flow has one caveat worth stating up front: under the default mock LLM the agent **cannot** call `submitOrder` at all, so Approve/Reject is unreachable. To exercise HITL without a cloud binding, start with `AGENT_LLM=scripted` (what the E2E suite does); to exercise it with a real model, bind SAP AI Core and run the `hybrid` profile. This is a property of the plugin's mock, not of our design — see "The mock LLM cannot call actions".

## Non-goals

- No deployment (no MTA, Cloud Foundry, or Kyma descriptors).
- No multitenancy, no XSUAA. Mocked basic auth only.
- No OData-bound table or Fiori Elements UI. Chat page only.
- No file upload/attachments, push notifications, or quota tuning.
- Not a reusable library. This is a demo app.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Domain | Bookshop | Matches the plugin's own README sample, so upstream docs map onto our code. |
| Agent definition | Both, phased | Phase A auto-agentification, Phase B markdown agent, same UI — makes the comparison direct. |
| UI5 flavour | Freestyle TypeScript | User preference. Typed A2A envelopes are a real benefit here. |
| UI scope | Chat only | User preference. |
| Serving | `cds-plugin-ui5` | Serves the UI5 app from the CDS server, same-origin on `:4004`. No dev server, no proxy. |
| Transport | `fetch` | Only way to consume the A2A stream. See below. |
| Protocols | `@agent` **and** `@protocol: ['odata', 'agent']` | Both are required — see below. Gives a browser-inspectable OData endpoint to confirm agent writes landed. |
| Test LLM | Scripted `buildModel` handler | The mock LLM cannot call actions, so HITL would be untestable without it — see below. |

### Why both `@agent` and `@protocol` are required

`@protocol: ['odata', 'agent']` on its own produces a **broken agent**. The plugin gates handler registration on the annotation, in `cds-plugin.js:80-84`:

```js
cds.on("serving", (srv) => {
  if (!(srv instanceof cds.ApplicationService)) return
  if (!srv.definition?.["@agent"]) return
  registerDefaultAgentHandlers(srv)
})
```

Without `@agent`, the A2A endpoint still mounts and still serves a valid agent card, but no `buildGraph`/`buildTools`/`buildModel` handlers exist, so every message fails with *"buildGraph handler … must return a compiled LangGraph … Got: undefined"*. The card being served is what makes this trap convincing: the endpoint looks healthy until you actually send a message.

Both annotations together were verified working: `at: [ '/odata/v4/catalog', '/a2a/catalog' ]`, with messages executing correctly.

### The mock LLM cannot call actions

`lib/models/mock.js` ignores the user's message entirely. It unconditionally calls the `query` tool on the **first entity** in the tool schema with `limit 3`, and on the tool result returns fixed text. It has no path that calls any other tool.

Two consequences:

1. **HITL cannot be exercised under the mock**, because `submitOrder` is never called. Approve/Reject would be unreachable.
2. **`Books` must be declared first** in the service, and any assertion on returned data must target one of the first three rows, because that is all the mock ever queries.

The fix is a **scripted test LLM**: a small LangChain `BaseChatModel` that emits a `submitOrder` tool call when the prompt matches an order request. It is wired through an app-level `buildModel` handler in `srv/cat-service.js`, guarded by `AGENT_LLM=scripted`, so normal `cds watch` keeps using the mock and only the E2E suite opts in.

This hook is supported rather than a workaround — the plugin's default handler resolves the model through the same `buildModel` event (`srv/handlers/index.js:91`), and handlers registered in the service's `init()` take precedence over the plugin's defaults.

### Why `fetch` and not a UI5 model

This was challenged during design and is worth recording, because the obvious reading is that a UI5 app should use a UI5 model for its requests.

`JSONModel#loadData` **can** issue the unary call. Verified against the OpenUI5 source: `{string} [sType="GET"]` accepts `"POST"`, and for a raw JSON body `oParameters` "has to be the JSON-stringified value" with `mHeaders` supplying `"Content-Type": "application/json;charset=utf-8"`.

It cannot do the streaming call. `loadData` goes through `jQuery.ajax` and applies its result via `setData()` atomically — the entire response parsed as JSON in one shot, with no incremental path. `EventSource` is no help either: it is GET-only, while A2A streams over a POST. `ODataModel` is inapplicable — `/a2a/catalog` is JSON-RPC and exposes no `$metadata`.

The resolution is the conventional split, not a rejection of models: **`JSONModel` is the view model** and drives every binding in the view; `fetch` is only the transport beneath it. Routing the unary path through `loadData` would mean `setData`-ing a JSON-RPC envelope into a throwaway model and transforming it into chat state regardless — no gain, and it would fork the transport for no benefit.

## Architecture

```
cap-agent-ui/
├─ db/
│  ├─ schema.cds                 Books, Authors, Orders
│  └─ data/*.csv                 seed data
├─ srv/
│  ├─ cat-service.cds            CatalogService, @protocol: ['odata','agent']
│  ├─ cat-service.js             submitOrder handler
│  └─ catalog-agent/             Phase B only
│     ├─ AGENTS.md
│     └─ skills/book-purchase/SKILL.md
├─ app/chat/
│  ├─ ui5.yaml                   ui5-tooling-transpile middleware
│  └─ webapp/
│     ├─ manifest.json, index.html, Component.ts
│     ├─ a2a/{types,sse,A2AClient}.ts
│     ├─ chat/chatState.ts
│     ├─ controller/Chat.controller.ts
│     └─ view/Chat.view.xml
├─ test/
│  ├─ unit/                      sse + chatState (node --test via tsx)
│  ├─ service/                   cds.test for submitOrder
│  └─ e2e/                       Playwright specs
├─ playwright.config.ts
└─ docs/superpowers/specs/
```

Everything is served from `http://localhost:4004`: the chat UI, the agent, and OData.

## CDS layer

`db/schema.cds` — `Books` (ID, title, stock, price, association to `Authors`), `Authors` (ID, name), `Orders` (ID, association to `Books`, quantity, timestamp). Seeded from CSV.

`srv/cat-service.cds`:

```cds
@agent
@protocol: ['odata', 'agent']
service CatalogService {
  entity Books   as projection on demo.Books;   // MUST stay first — the mock queries entity[0]
  entity Authors as projection on demo.Authors;
  entity Orders  as projection on demo.Orders;
  action submitOrder(book : Books:ID, quantity : Integer) returns { stock : Integer };
}
annotate CatalogService.submitOrder with @agent.hitl;
```

`srv/cat-service.js` implements `submitOrder`: rejects a quantity exceeding stock with a CAP error, otherwise decrements stock, writes an `Orders` row, and returns the remaining stock.

`@agent.hitl` is what makes the approval flow reachable — without it the agent executes the order immediately.

### Agent phases

**Phase A — auto-agentification.** No `srv/catalog-agent/` directory. The plugin derives tools from the entities and the action, runs a ReAct loop, and generates the agent card's skills automatically.

**Phase B — markdown agent.** Add `srv/catalog-agent/` (directory name is the slugified service name). `AGENTS.md` frontmatter (`name`, `version`, `description`) populates the agent card and its body becomes the system prompt; `skills/book-purchase/SKILL.md` describes the ordering workflow. Its presence replaces the auto-generated agent.

Phase B is additive — no UI change — so the switch is observable by diffing the agent card and the agent's tone before and after.

## UI5 layer

Modules, ordered so the interesting logic carries no UI5 dependency and is testable in Node:

| Module | Responsibility | Depends on |
|---|---|---|
| `a2a/types.ts` | A2A envelope, Task, event, and agent-card types | — |
| `a2a/sse.ts` | Pure SSE frame parser | — |
| `a2a/A2AClient.ts` | `fetch`-based transport | `sse`, `types` |
| `chat/chatState.ts` | Pure reducer: event → chat state | `types` |
| `controller/Chat.controller.ts` | Glue: `JSONModel` ↔ client ↔ reducer | all |
| `view/Chat.view.xml` | Presentation | — |

### Interfaces

```ts
// a2a/sse.ts — frames split on "\n\n"; "data:" lines concatenated
interface SSEFrame { event?: string; data: string }
function parseSSE(buffer: string, chunk: string): { frames: SSEFrame[]; rest: string }

// a2a/A2AClient.ts
class A2AClient {
  constructor(baseUrl: string)
  getAgentCard(): Promise<AgentCard>
  streamMessage(req: SendParams, onFrame: (e: A2AEvent) => void, signal: AbortSignal): Promise<void>
  cancel(taskId: string): Promise<void>
}

// chat/chatState.ts
interface ChatMessage { id: string; role: "user" | "agent" | "error"; text: string; streaming: boolean }
interface ChatState {
  messages: ChatMessage[]
  busy: boolean
  status: string              // transient, e.g. "Querying Books"
  contextId: string | null
  taskId: string | null
  pendingApproval: boolean
}
function applyEvent(state: ChatState, event: A2AEvent): ChatState   // pure
```

`parseSSE` is a fold over chunk boundaries because a network chunk may split a frame mid-way; carrying `rest` forward is the entire reason it exists as a separate unit, and it is the first thing to test.

### Event handling

| Event | Effect on state |
|---|---|
| `kind: "task"` | Record `taskId` + `contextId`, `busy = true` |
| `status-update`, `state: "working"` | `status = ` message text (transient line, not a bubble) |
| `status-update`, `state: "input-required"` | `pendingApproval = true`, `busy = false`, retain `taskId` |
| `status-update`, `state: "completed"` | Finalize streaming bubble, `busy = false`, clear `status` |
| `status-update`, `state: "failed" \| "canceled"` | Error bubble, `busy = false` |
| `artifact-update` | Append or replace the streaming bubble per the event-level `append` / `lastChunk` flags |

`append` and `lastChunk` are siblings of `artifact`, not fields inside it — a detail confirmed by observing live frames.

### HITL

When `pendingApproval` is set the view shows Approve / Reject. Either button sends an ordinary user message carrying the **same `taskId` and `contextId`** with body text `"approve"` or `"reject"`. This contract was confirmed by reading the plugin's bundled preview client.

### Data flow

`FeedInput` submit → `A2AClient.streamMessage` POSTs `message/stream` → response body read as a `ReadableStream` → `parseSSE` → each JSON-RPC envelope's `result` → `applyEvent` → new state written to the `JSONModel` → bindings re-render.

Send doubles as Cancel while busy, aborting the `fetch` via `AbortController` and firing `tasks/cancel`.

## Error handling

- JSON-RPC error envelopes surface as an error bubble: `-32001` unauthorized, `-32003` forbidden, `-32029` quota exceeded or message too long, `-32603` internal.
- SSE `event: error` frames end the turn and render the message.
- Any network failure or aborted stream resets `busy` so the UI cannot wedge; this is asserted in the reducer tests.
- CAP validation errors from `submitOrder` (insufficient stock) reach the user as the agent's own reply, since the agent sees the tool error.

## Testing

Three layers, each testing what only it can reach.

### Unit — pure logic (TDD)

The two pure modules are dependency-free TypeScript, so they run under Node's built-in test runner via `tsx`, with no browser and no karma. These are written test-first.

- `sse.ts`: frame split across chunk boundaries, multi-line `data:`, `event: error` frames, trailing partial frame retained in `rest`.
- `chatState.ts`: full happy-path event sequence; `input-required` sets `pendingApproval`; `artifact-update` append vs replace; failure and cancel both clear `busy`.

Note: `cds-plugin-ui5` is disabled under Jest by default, which is a further reason the pure modules use the Node runner rather than a UI5 test stack.

### Service — CAP handlers

Via `cds.test` against in-memory SQLite: `submitOrder` decrements stock, writes an `Orders` row, and rejects a quantity above stock.

In CAP v10 `cds.test` lives in a **separate `@cap-js/cds-test` package** and is not bundled with `@sap/cds`; without it the import fails with `Cannot find module '@cap-js/cds-test'`. With it installed, `cds.test` runs under `node --test` — both the HTTP helpers and direct `cds.connect.to` service calls work, and the returned handle is awaitable. So one runner (`node:test`) covers unit and service layers; no Jest, no Mocha.

### End-to-end — Playwright

Playwright covers what unit tests structurally cannot: that a real browser renders a real SSE stream from a real agent. Streaming is the riskiest part of this app and is only observable in a browser.

This is viable here specifically because **the mock LLM is deterministic** — it returns fixed text plus genuine tool results from the database, so assertions on exact content are stable. E2E runs against the mock; no cloud binding, no LLM variance.

**Setup.** `playwright.config.ts` at the root, specs in `test/e2e/`. The config's `webServer` launches `cds serve --in-memory` (not `cds watch`, whose file-watching restarts make test runs nondeterministic) with **`AGENT_LLM=scripted`** in its `env`, `baseURL: http://localhost:4004`, and `reuseExistingServer` locally. If mocked auth challenges, the config supplies `httpCredentials` for user `alice`.

Because the scripted LLM is deterministic in a stronger sense than the mock — it reads the prompt and calls the tool the prompt asks for — the HITL scenarios are ordinary assertions rather than best-effort ones.

**Locators.** Address controls through Playwright's role and text locators — `getByPlaceholder`, `getByRole('button', { name: 'Approve' })`, `getByText` — rather than UI5's generated DOM IDs, which are unstable across view nesting. Where a semantic locator is genuinely unavailable, attach `sap.ui.core.CustomData` with `writeToDom: true` to emit a stable `data-*` attribute. No reliance on `container-…---view--id` strings.

**Test state isolation.** The in-memory database is seeded fresh at server start but shared across the run, so mutations persist between tests. Two mitigations, together: `workers: 1` with `fullyParallel: false`, and **each mutating test targets its own dedicated book row** so stock changes cannot collide.

**Scenarios:**

| Test | Asserts |
|---|---|
| Streaming reply | Ask "show me all books"; the agent bubble ends up containing a real seeded title (one of the first three rows) and the input re-enables. Content from the DB proves the tool actually ran. The transient `Querying Books` status line is **not** asserted — mock replies return in milliseconds, so any assertion on an intermediate render state is a race. |
| Conversation continuity | A second message's request body carries the `contextId` returned by the first, captured via Playwright request interception. |
| HITL approve | Order a book, Approve appears, click it, task completes; then a direct `GET /odata/v4/catalog/Books(<id>)` from the test's request context confirms stock **decreased**. |
| HITL reject | Same up to Reject; stock is **unchanged**. Guards against the approval gate being decorative. |
| Quota error path | Send a message longer than `maxIncomingMessageLength` (5000); expect the `-32029` error surfaced as an error bubble, not a wedged UI. |

Cross-checking HITL through OData rather than through the chat transcript is deliberate: it verifies the write really happened, instead of trusting the agent's own claim that it did.

**Deliberately not asserted:** token-by-token growth of the streaming bubble. Timing-dependent assertions on intermediate render states are flaky, and incremental correctness is already covered deterministically by the `chatState` reducer tests. E2E asserts observable milestones only.

**Cancel** is best-effort. Mock replies return near-instantly, leaving almost no window to click Cancel mid-flight; if it proves flaky it will be skipped with a comment rather than retried into false confidence.

The same suite runs unchanged against Phase A and Phase B — which is precisely how we detect whether introducing the markdown agent broke the wire contract.

`npm test` runs unit + service; `npm run test:e2e` runs Playwright.

## Running it

```bash
npm install
npx playwright install chromium   # once, for the E2E suite
cds watch                         # chat UI, agent, and OData all on :4004

npm test                          # unit + service
npm run test:e2e                  # Playwright (starts its own cds serve)
```

Real LLM instead of the mock:

```bash
cds bind -2 <aicore-instance>
cds w --profile hybrid
```

## Risks

1. **`@cap-js/agents` is v0.9.1, published 2026-08-14.** Three days old, pre-1.0, and its README marks connectivity, quota, telemetry, audit logging, and content filtering as experimental with a surface that may change. Pin the exact version.
2. **`cds-plugin-ui5` + `ui5-tooling-transpile` middleware is load-bearing** for the whole dev loop. Task 1 is a thin end-to-end smoke check — TypeScript app served from `:4004` streaming one mock-LLM reply — before any real UI work is layered on. If the middleware combination fails, the fallback is building the app to static JS that CDS serves, at the cost of a rebuild per change.
3. **UI5 app mount path.** The path at which `cds-plugin-ui5` mounts the chat app derives from `ui5.yaml` `metadata.name`. It will be set explicitly in the CDS config and confirmed in task 1 rather than assumed.
4. **Endpoint path is not stable across configurations.** An explicit `@path` on the service overrides the `/a2a` prefix entirely. The client reads its endpoint from configuration and validates against the agent card instead of hardcoding a URL.
5. **Version skew.** Global `@sap/cds-dk` is 9.9.2 while a fresh project resolves `@sap/cds` v10. This worked during investigation but is worth knowing if tooling behaves oddly.

## Verified during investigation

These were established by running the plugin, not read from documentation:

- `message/send` and `message/stream` both work; SSE order is `task` → `status-update(working)` → `artifact-update`… → `status-update(completed, final: true)`.
- The mock LLM really invokes the generated tools against the database and returns actual rows, so the entire UI is buildable with no cloud binding.
- `@agent` alone **replaces** the OData protocol — `/odata/v4/...` returns 404. `@protocol: ['odata','agent']` restores it, yielding `at: [ '/odata/v4/catalog', '/a2a/catalog' ]` — but `@protocol` **without** `@agent` leaves the agent unusable (handlers never register). Both annotations are needed. An earlier draft of this spec asserted `@protocol` alone was sufficient; that was checked only by fetching the agent card, which is served either way. Sending a message is what exposes the difference.
- The mock LLM is hardcoded to the `query` tool on the first entity with `limit 3`, and ignores the user's message.
- A scripted `BaseChatModel` returned from an app-level `buildModel` handler overrides the mock, and drives the full HITL loop: `input-required` with stock unchanged → `approve` → `submitOrder` executes → stock **12 → 10**, confirmed independently through OData.
- `cds.test` requires the separate `@cap-js/cds-test` package on CAP v10, and then works under `node --test`.
- The A2A endpoint accepts POST with no CSRF token, as it is a custom Express router rather than the OData adapter.
- The plugin ships `cap.agent.Tasks` / `Checkpoints` entities, so conversations are persisted and queryable by `contextId`.
