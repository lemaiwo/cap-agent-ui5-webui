# cap-agent-ui

A [SAP CAP](https://cap.cloud.sap/) bookshop service that exposes an
[A2A protocol](https://a2a-protocol.org/) agent via [`@cap-js/agents`](https://www.npmjs.com/package/@cap-js/agents)
(pinned to exactly `0.9.1` — the package is pre-1.0 and its own README marks several
areas, including connectivity and content filtering, as experimental), fronted by a
freestyle SAPUI5 **TypeScript** chat client served same-origin from the CDS server by
`cds-plugin-ui5`. This is a demo/evaluation project, not a production template.

## Setup

```bash
npm install
npx playwright install chromium   # once, needed only for the E2E suite
```

## Running it

```bash
cds watch
```

Then open **http://localhost:4004/chat/index.html** for the chat UI.

Other useful endpoints while it's running:

- `http://localhost:4004/odata/v4/catalog/Books` — inspect the seeded catalog data directly.
- `http://localhost:4004/a2a/catalog/.well-known/agent-card.json` — the agent card (see
  [`docs/agent-phases.md`](./docs/agent-phases.md) for what's in it and why).

### Approve/Reject requires the scripted LLM

**The default mock LLM shipped with `@cap-js/agents` can only ever call the `query`
tool** — it's hardcoded to look up the first entity in the model and ignores the rest of
the conversation. That means the human-in-the-loop approval flow (the Approve/Reject
buttons that gate `submitOrder`) is **unreachable** if you just run `cds watch` and
start chatting. Asking to order a book will not trigger it under the default mock.

To exercise the HITL flow, start the server with the project's own scripted test LLM
(`test-support/scripted-llm.mjs`) instead, via the `AGENT_LLM=scripted` environment
variable:

```powershell
# PowerShell
$env:AGENT_LLM = "scripted"; npx cds watch
```

```bash
# bash
AGENT_LLM=scripted npx cds watch
```

Then ask something like `order 1 copies of book 2` and the Approve/Reject buttons will
appear.

To use a real LLM instead of either mock, bind an SAP AI Core instance and run the
`hybrid` profile:

```bash
cds bind -2 <aicore-instance>
cds w --profile hybrid
```

## Tests

```bash
npm test        # unit (node:test via tsx) + service tests (cds.test)
npm run test:e2e  # Playwright — starts its own cds server with AGENT_LLM=scripted
```

`npm test` does not start a server. `npm run test:e2e` does, via
`playwright.config.ts`'s `webServer`, and does not reuse an already-running one — so an
instance left over from `cds watch` won't silently get attached to (and, per the caveat
above, wouldn't have HITL working if it did).

## Architecture note: why `fetch` + `ReadableStream`, not a UI5 model

The chat client streams A2A responses with a plain `fetch` call and reads the response
body as a `ReadableStream`, rather than going through a UI5 `Model`. Two things rule out
the more idiomatic UI5 approaches:

- `JSONModel#loadData` applies its result atomically via `setData()` — there's no
  incremental/streaming path to append partial data as it arrives.
- `EventSource` (the standard way to consume Server-Sent Events) is GET-only, but A2A
  streams over a `POST` (the request carries a JSON-RPC body).

`JSONModel` is still used, just not for transport — it's the view model that the raw
stream's parsed events are folded into via `chatState`, and the view binds against it as
usual.

## What this is / is not

This project demonstrates auto- vs. markdown-defined agent behavior with `@cap-js/agents`
(see [`docs/agent-phases.md`](./docs/agent-phases.md)) and a same-origin TypeScript chat
UI talking A2A over SSE. It is not hardened for production use, multi-tenant, or
deployment — those are explicit non-goals.
