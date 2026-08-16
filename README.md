# cap-agent-ui5-webui

A [SAP CAP](https://cap.cloud.sap/) plugin that gives any CAP project a working
[A2A protocol](https://a2a-protocol.org/) chat UI by installing it — no wiring, no
copying files, no approuter changes. It serves a freestyle SAPUI5 TypeScript chat
client, same-origin from your CDS server, that talks to whichever of your services
carry the `@agent` annotation from [`@cap-js/agents`](https://www.npmjs.com/package/@cap-js/agents).

`@cap-js/agents` is pinned to exactly `0.9.1` — it is pre-1.0, days old at the time of
writing, and its own README marks areas such as connectivity and content filtering as
experimental. This plugin inherits that instability; expect breakage on upgrade.

## Install

```bash
npm add github:lemaiwo/cap-agent-ui5-webui
```

CAP auto-loads the plugin from any dependency via its `cds-plugin.js` convention —
there is nothing else to wire up. Start your server as usual:

```bash
cds watch
```

and open **`/chat/index.html`** (e.g. `http://localhost:4004/chat/index.html`). The UI
fetches `<mountPath>/agents.json` on startup to find out which of your services are
agents.

If your project has no `@agent`-annotated service, the UI still loads but has nothing
to talk to.

## Configuration

Zero-config by default. Override under `cds["cap-agent-ui5-webui"]` in `package.json`:

```jsonc
{
  "cds": {
    "cap-agent-ui5-webui": {
      "mountPath": "/chat",          // default "/chat"
      "enabled": true,               // default true
      "bootstrapUrl": null,          // default null (use the SAPUI5 CDN)
      "agents": ["CatalogService"]   // default: all @agent services, in model order
    }
  }
}
```

All four keys are optional and independent:

- **`mountPath`** — where the UI and `agents.json` are served. Must start with `/`
  (a bare value is prefixed automatically). **`"/"` and `""` are refused** and fall back
  to `/chat` with a logged warning — CAP's own server registers a handler for `/`
  synchronously, before this plugin's async bootstrap listener resumes, so a plugin
  mounted at `/` would never actually be reached. Taking the value anyway would produce
  a config that reads as applied but serves nothing, so the plugin refuses it loudly
  instead.
- **`enabled`** — set to `false` to disable the plugin entirely (e.g. in a profile where
  you want the dependency present but the UI off). Equivalent to the shorthand
  `"cap-agent-ui5-webui": false`.
- **`bootstrapUrl`** — overrides the SAPUI5 bootstrap URL. See below.
- **`agents`** — an allow-list of service names, in the order you want them offered. If
  omitted, every `@agent`-annotated service is offered, in model order.

The boolean shorthand is also accepted: `"cap-agent-ui5-webui": true` means "all
defaults"; `"cap-agent-ui5-webui": false` disables the plugin.

## Multi-agent behaviour

`@agent` is a service-level annotation, so "how many agents" is exactly "how many
`@agent`-annotated services" your project exposes:

- **One agent** — the UI connects to it directly. No picker; behaves exactly as a
  single-agent setup always has.
- **More than one** — the UI renders a picker. **Switching agents starts a new
  conversation.** Each agent owns its own `contextId` and task history, so there is no
  meaningful way to carry a conversation across agents.

## `bootstrapUrl` and CSP

By default the UI bootstraps SAPUI5 from `https://ui5.sap.com/1.120.0/resources/sap-ui-core.js`.
A self-contained build would bundle megabytes of the UI5 framework into a `dist/` that
is committed to git, so instead the plugin loads it from SAP's CDN and lets you override
the URL for two situations:

- an **air-gapped** environment with no route to `ui5.sap.com`;
- a **restrictive Content-Security-Policy** that blocks the CDN's origin.

In either case, point `bootstrapUrl` at your own hosted copy of SAPUI5/OpenUI5. Without
it, the page will render blank rather than fail loudly — this is the most likely first
failure mode on a locked-down deployment, so if the chat UI loads with nothing visible,
check the browser console for a blocked script load before anything else.

## Testing human-in-the-loop approval: `test-support/scripted-llm`

**The default mock LLM shipped with `@cap-js/agents` ignores the prompt.** It is
hardcoded to always call the read (`query`) tool against the first entity in your model,
and can never call an action. That means any human-in-the-loop approval flow you've
built — an action annotated `@agent.hitl`, gated behind Approve/Reject — is **unreachable**
under the bundled mock. This isn't specific to any one project; every CAP agent that
uses HITL hits it.

The plugin ships a generic, script-driven mock LLM to close that gap, exported as:

```js
import ScriptedChatModel from "cap-agent-ui5-webui/test-support/scripted-llm"
```

It needs `@langchain/core` (declared as an **optional peer dependency** — install it
yourself if you use this export; the plugin does not require it otherwise). You supply a
script mapping regexes to tool calls:

```js
const script = [
  {
    match: /order\s+(\d+)\s+.*book\s+(\d+)/i,
    tool: "submitOrder",
    args: (m) => ({ book: Number(m[2]), quantity: Number(m[1]) }),
  },
]

new ScriptedChatModel("scripted", { script, entity: "Books" })
```

When no rule matches, it falls back to reading the first exposed entity of your service
(or the `entity` option, if given) — deliberately: it matches regexes and maps captures
to arguments, it does not infer intent, because determinism is its entire value.
Anything needing real inference needs an actual model via SAP AI Core and CAP's `hybrid`
profile.

Wire it in with a `buildModel` handler behind an environment guard, the way the test
fixture in this repo does (`test/fixture/bookshop/srv/cat-service.js`):

```js
if (process.env.AGENT_LLM === "scripted") {
  this.on("buildModel", async () => {
    const { default: ScriptedChatModel } = await import("cap-agent-ui5-webui/test-support/scripted-llm")
    return new ScriptedChatModel("scripted", { script, entity: "Books" })
  })
}
```

## Running on SAP BTP

The plugin serves static files with `express.static` — no UI5 Tooling, no
transpilation, and no framework download at runtime. The same code path runs under
`cds watch` and on Cloud Foundry.

Because the UI is served same-origin from your CDS server, requests it makes to your
agent carry the host's own session, so the agent stays protected exactly as it was —
there is **no approuter and no HTML5 Application Repository to set up**. Note that the
static assets and `<mountPath>/agents.json` are served ahead of CAP's auth middleware
(the plugin registers its routes on the raw Express `app` at bootstrap, before `cds.serve`
mounts service-level auth) and are readable without a session — `agents.json` in
particular enumerates your agent services' names, descriptions and mounted paths.

## `dist/` ships TypeScript sources — deliberately

The committed `dist/` build output includes `.ts` source files and `.js.map` source-map
files alongside the compiled `.js`, and `express.static` serves them as-is — a request
for `/chat/Component.ts` (or any other source file under the mount path) returns the raw
TypeScript. This is intentional, not an oversight:

- it is client-side UI code, already delivered to the browser as compiled JavaScript —
  shipping the source alongside it discloses nothing that inspecting the compiled bundle
  wouldn't;
- the source maps make the compiled code debuggable in the browser's dev tools, which is
  worth more than the marginal bytes saved by stripping them.

If your deployment has a reason to withhold `.ts`/`.map` files (e.g. a strict asset
allow-list at a reverse proxy), filter them there — the plugin does not.

## Developing this plugin

This repository is itself the plugin (the root `package.json` is the published
package), plus a test fixture that consumes it.

- **`npm run build`** — runs the UI5 build (`ui5-tooling-transpile-task`) from `ui/`
  into `dist/`. Run this after any change under `ui/`.
- **`dist/` is committed to git**, deliberately (see `.gitignore`) — a git-install
  consumer runs no build step of its own, so the built output has to already be there.
  This means you must run `npm run build` and commit the result before pushing any
  `ui/` change; CI checks that `dist/` matches a fresh build.
- **`test/fixture/bookshop/`** is a small CAP project that depends on the plugin via
  `file:../../..` and stands in for a real consumer for the service and E2E tests. Its
  `srv/catalog-agent/AGENTS.md` and `srv/catalog-agent/skills/book-purchase/SKILL.md`
  are also a working example of the markdown agent templates below (see
  [`docs/agent-phases.md`](./docs/agent-phases.md) for how the two agent-definition
  styles differ in the resulting agent card).

Test commands:

```bash
npm test          # unit (node:test via tsx) + fixture service tests (cds.test)
npm run test:e2e  # Playwright, against the fixture and its built dist/
npm run typecheck # tsc --noEmit over ui/
```

`npm test` does not start a server. `npm run test:e2e` starts its own CAP server (via
`playwright.config.ts`'s `webServer`, with `AGENT_LLM=scripted`) against the fixture,
and always starts a fresh instance rather than reusing one left over from `cds watch`.

E2E always runs against the **built `dist/`**, never against live-transpiled TypeScript
— that's the only way the suite proves what a real consumer actually runs.

## Markdown agent templates

`docs/templates/AGENTS.md.template` and `docs/templates/SKILL.md.template` are
commented starting points for defining your own agent and its skills — domain
vocabulary is irreducibly yours, so the plugin ships templates, not content. Copy them
into your service (e.g. `srv/<your-agent>/AGENTS.md` and
`srv/<your-agent>/skills/<skill-name>/SKILL.md`) and fill them in.

## What this is / is not

This plugin serves the chat UI and discovers your agents; it is not a general chat
framework and does not speak anything other than A2A as `@cap-js/agents` serves it.
It also does not publish to npm yet — GitHub install only.
