# CAP Agent Chat UI — Plugin Extraction Design

**Date:** 2026-08-16
**Status:** Awaiting review
**Supersedes the role of:** `docs/superpowers/specs/2026-08-16-cap-agent-ui-design.md` (that spec describes the demo app; this one turns the product inside out)

## Goal

Turn `lemaiwo/cap-agent-ui5-webui` from a demo application into a **reusable CAP plugin** that gives any CAP project a working A2A chat UI by installing it — no wiring, no copying files, no approuter changes — and that behaves identically under `cds watch` and deployed on SAP BTP.

Success means: in an unrelated CAP project with an `@agent`-annotated service,

```bash
npm add github:lemaiwo/cap-agent-ui5-webui
cds watch
```

serves a chat UI at `/chat` that talks to that project's agent, with no further configuration — and the same code path serves it on Cloud Foundry.

## Non-goals

- No npm registry publish yet (GitHub install only; the release story stays a later decision).
- No approuter, HTML5 Application Repository, or MTA descriptors — the plugin deliberately avoids needing them.
- No Fiori Elements integration, no theming API beyond CSS variables.
- Not a general chat framework: it speaks A2A as `@cap-js/agents` serves it, nothing else.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | Plugin **is** the root package | Forced by distribution: `npm add github:owner/repo` resolves the repo root's `package.json`. A `packages/plugin/` monorepo would not be git-installable. |
| Serving | Pre-built assets + `express.static` | Avoids UI5 Tooling at runtime, the measured 60–70s cold start, and any approuter/HTML5-repo wiring. Same code path in dev and on BTP. |
| `cds-plugin-ui5` | devDependency of this repo only | Keeps live TS transpilation while developing the UI; consumers never inherit it. It is community-maintained and dev-oriented — see Risks. |
| Agent discovery | Read served endpoints | Verified: endpoints carry `kind: "agent"` and `path` (`@cap-js/agents/lib/index.js:116-121`). Reliable, unlike reconstructing slugs. |
| Bookshop demo | Becomes a test fixture | A real consumer is the only honest proof the extraction generalised. |
| Scripted LLM | Generic, script-driven, shipped as an optional export | The bundled mock cannot call actions, so HITL is untestable without one. Every CAP agent project hits this — it is reusable, not fixture-specific. |
| E2E fixtures | Derived from OData at runtime | Removes hardcoded titles/IDs and *strengthens* the assertions — see Testing. |
| SAPUI5 bootstrap | CDN by default, `bootstrapUrl` overridable | A self-contained build would bundle megabytes of UI5 into a `dist/` that is committed to git. The CDN keeps the package small; the override lets an air-gapped or CSP-restricted consumer point at their own hosted UI5. |

## Repository structure

```
cap-agent-ui5-webui/
├─ package.json               the plugin package
├─ cds-plugin.js              auto-loaded by CAP from any dependency
├─ lib/
│  ├─ mount.js                express.static mounting
│  ├─ discover.js             find @agent services and their paths
│  └─ config.js               resolve + validate plugin config
├─ ui/
│  ├─ ui5.yaml                build config (transpile task)
│  └─ webapp/
│     ├─ a2a/{types,sse,A2AClient}.ts
│     ├─ chat/chatState.ts
│     ├─ controller/Chat.controller.ts
│     ├─ view/Chat.view.xml
│     ├─ css/style.css
│     ├─ Component.ts, index.html, manifest.json
├─ dist/                      built UI5 output (see Build)
├─ test-support/
│  └─ scripted-llm.mjs        generic, script-driven test double
└─ test/
   ├─ unit/                   sse, chatState, A2AClient
   ├─ fixture/bookshop/       a CAP app that consumes the plugin
   └─ e2e/                    Playwright, driving the fixture
```

The bookshop stops being the product. It keeps its CDS model, its `catalog-agent/` markdown, and its service handler, and gains a `package.json` that depends on the plugin by relative path.

## Plugin runtime

`cds-plugin.js` hooks CAP's bootstrap and served events:

1. **On `bootstrap`** — mount `dist/` at the configured path with `express.static`, plus one JSON endpoint (`<mountPath>/agents.json`) the UI fetches at startup.
2. **On `served`** — walk `cds.services`, keep those whose definition carries `@agent`, and for each read the endpoint whose `kind === "agent"` to get its real mounted `path`. Cache the resulting list for `agents.json`.

Serving static files needs no UI5 Tooling, no transpilation, and no framework download at runtime. The `dist/` bundle is self-contained apart from the SAPUI5 CDN bootstrap, which the consumer's existing network policy already governs.

### Why not reuse `cds-plugin-ui5` at runtime

It is documented and installed as a `devDependency`, it injects UI5 CLI express middlewares, and it resolves framework artifacts on demand — we measured a 60–70 second cold start on an empty cache in this very repo. It is also explicitly community-maintained, outside SAP's standard support model. All acceptable for `cds watch`; none of it acceptable for a first request on Cloud Foundry.

## Configuration

Zero-config by default. The consumer may override in `package.json`:

```jsonc
{
  "cds": {
    "cap-agent-ui5-webui": {
      "mountPath": "/chat",     // default "/chat"
      "enabled": true,          // default true
      "agents": ["CatalogService"]  // default: all @agent services, in model order
    }
  }
}
```

The boolean shorthand `"cap-agent-ui5-webui": true` is accepted and means "defaults". `false` disables the plugin entirely — useful for a project that wants the dependency present but the UI off in some profile.

## Agent discovery and multi-agent UI

`agents.json` returns `[{ name, path, description }]`, derived from the model and the served endpoints. The UI:

- **one agent** — connects to it directly, no picker, visually identical to today;
- **several** — renders a picker; switching agents starts a fresh conversation, because each agent owns its own `contextId` and task history.

This uses what we established earlier: `@agent` is service-level only (`cds-plugin.js:82` reads `srv.definition["@agent"]`), so "how many agents" is exactly "how many annotated services".

Note the UI holds one `A2AClient` per selected agent; `A2AClient` already takes a `baseUrl`, so this needs no transport change.

## The generic scripted LLM

Today's double hardcodes three bookshop facts: an order regex, the `submitOrder` tool name, and `SELECT * FROM Books LIMIT 3`. It becomes generic in two ways.

**Intent matching becomes data.** The consumer supplies a script; the model itself knows no domain:

```js
export default [
  {
    match: /order\s+(\d+)\s+.*book\s+(\d+)/i,
    tool: "submitOrder",
    args: (m) => ({ book: Number(m[2]), quantity: Number(m[1]) }),
  },
]
```

**The read fallback derives its entity from the model.** When no rule matches, it queries the first exposed entity of the agent's service rather than a hardcoded name. This is correct by construction: the plugin's own mock only ever queries entity[0], so reading entity[0] from the model is exactly the right target.

The tool's argument shape stays **CQL** (`{ cql: "SELECT * FROM <Entity> LIMIT 3" }`). This was established by direct schema testing, not inference: CQN `{entity, limit}` is rejected by the tool's zod validator (`expected string, received undefined → at cql`) because `@cap-js/mcp` registers the query tool as `z.object({ cql: z.string() })` with no `entity` field unless `cds.env.mcp.format === 'cqn'`.

**Deliberate limit:** the script matches regexes and maps captures to arguments. It does not infer intent, and should not — determinism is its entire value. Anything needing inference needs a real model via AI Core and the `hybrid` profile.

It is exported as `cap-agent-ui5-webui/test-support/scripted-llm` and activated the same way as now: an app-level `buildModel` handler behind an env guard, which the fixture demonstrates.

## What stays with the consumer

Three things are irreducibly domain-specific and must not migrate into the plugin:

- **`AGENTS.md` / `SKILL.md`** — domain vocabulary *is* the deliverable for a markdown agent. The plugin ships a commented template; the content is the consumer's.
- **The CDS model** — something concrete must exist for the agent to talk about.
- **The intent script** — six lines, but they name the consumer's own actions.

## Build

`npm run build` runs the UI5 build (with `ui5-tooling-transpile-task`) from `ui/` into `dist/`.

`dist/` is **committed to the repository**. This is a deliberate trade-off: a git-install consumer runs no build step, and npm lifecycle scripts are unreliable for git dependencies. The cost is build output in version control and the discipline of rebuilding before commit; a CI check that `dist/` matches a fresh build is the guard against drift.

**This requires removing `dist/` from `.gitignore`**, where it currently sits (`.gitignore:8`). Missing that step would produce a package that installs cleanly and then serves nothing — a failure mode that no test in this repo would catch, because the fixture resolves the plugin by relative path and would still see a local `dist/`. The plan must include an explicit check that `dist/` is present in `git ls-files`.

`package.json` `files` must include `dist`, `cds-plugin.js`, `lib`, and `test-support` so an eventual npm publish ships the same set a git install does.

## Testing

Four layers, and one rule that matters more than the rest.

**The rule: E2E runs against `dist/`, never against the TypeScript sources.** Testing the live-transpiled version would prove something no consumer ever runs. This is the single most important property of the test setup.

| Layer | What it covers | Runner |
|---|---|---|
| Unit | `sse`, `chatState`, `A2AClient` — unchanged, still dependency-free | `node:test` + `tsx` |
| Plugin | `discover`, `config`, mount behaviour — new | `node:test` |
| Fixture service | `submitOrder` handler | `cds.test` |
| E2E | Playwright against the fixture, consuming built `dist/` | `@playwright/test` |

**E2E fixtures become dynamic.** Instead of hardcoding `"Wuthering Heights"` and book IDs 2 and 3, tests fetch the first rows from OData at runtime. This makes the assertions *stronger*, not weaker: the streaming test now asserts the chat reply contains what OData independently returns, cross-checking two surfaces where a constant only ever checked itself. Mutating tests still take disjoint rows (`rows[1]`, `rows[2]`), and `workers: 1` with `fullyParallel: false` remains required because the in-memory DB is seeded once per server start.

Existing assertions that must survive the move unchanged in strength: stock unchanged **while approval is pending** (the proof the gate is real), `stockOf` failing loudly on a non-OK response, and the agent-card identity check that catches a silent Phase B → Phase A regression.

**New E2E case:** with two `@agent` services in the fixture, the picker appears and switching agents starts a new conversation. This is the only automated coverage of the multi-agent path.

## Migration

Performed with `git mv` so history follows each file, on a branch, with the full suite green before merge.

| From | To |
|---|---|
| `app/chat/webapp/**` | `ui/webapp/**` |
| `app/chat/ui5.yaml` | `ui/ui5.yaml` |
| `db/`, `srv/` | `test/fixture/bookshop/{db,srv}` |
| `test-support/scripted-llm.mjs` | `test-support/scripted-llm.mjs` (generalised) |
| `test/unit/**` | unchanged |
| `test/service/**` | `test/fixture/bookshop/test/` |
| `test/e2e/**` | unchanged path, retargeted at the fixture |
| root `package.json` | becomes the plugin's; fixture gets its own |

The existing `docs/` (both specs, both agent cards, `agent-phases.md`) stay — they document how the agent behaves, which is still true and still useful.

## Risks

1. **`@cap-js/agents` is `0.9.1`, pre-1.0, days old.** A plugin wrapping it inherits that. `chatState.ts` reduces over its event shapes and `discover.js` depends on its endpoint `kind`. Pin exactly; expect breakage on upgrade; the E2E suite is what will tell you.
2. **`dist/` in git drifts** if someone edits `ui/` and forgets to rebuild. Mitigate with a CI check comparing committed `dist/` against a fresh build.
3. **CSS collision.** The current stylesheet assumes it owns `html, body`. Inside a host app that is wrong. Styles must be scoped to the plugin's own container, and the height fix reworked accordingly — this is the most likely source of subtle breakage in a real consumer.
4. **SAPUI5 bootstrap** is decided (CDN, overridable — see Decisions) but is still the most likely thing to fail first on BTP, because it is the only runtime dependency the plugin cannot satisfy from its own package. A consumer with a restrictive CSP will see a blank page until they set `bootstrapUrl`. The plugin should fail loudly here rather than silently rendering nothing.
5. **Restructuring a repo that was just published.** The remote is one hour old with two commits; the restructure is large. Branch, green suite, and reviewed before it lands.

## Verified during investigation

Established by reading source or running code, not assumed:

- `cds-plugin-ui5`'s README states apps may be in `app/`, via `cds.env.folders.app`, **"or be a dependency of the CDS server"** — the mechanism this design relies on for dev.
- It carries no production guard beyond a Jest check, so it *can* run in production — but it drags UI5 Tooling into the runtime, which is why this design does not.
- Agent endpoints expose `kind: "agent"` and `path` (`@cap-js/agents/lib/index.js:116-121`).
- `@agent` is read only on service definitions (`cds-plugin.js:82`, `sidecar.js:53`); on an entity it is silently ignored.
- Entities are excluded from an agent's tools via `@cds.api.ignore` (`lib/utils/utils.js:38-50`); there is no `@agent.ignore`.
- Agent services auto-connect to each other as delegation tools when `connect: "auto"` (the default), via `buildSubAgentTool` (`srv/handlers/index.js:20-86`).
- The `query` tool's args are CQL-shaped, proven by schema rejection of the CQN form.
