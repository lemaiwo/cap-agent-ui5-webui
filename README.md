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
package), plus a sample CAP project that consumes it.

### Running the sample

```bash
npm run dev
```

That is the loop to use while changing anything in this repo. It builds `ui/` into
`dist/`, starts the sample project at **<http://localhost:4004/chat/index.html>**, and
rebuilds automatically whenever you edit anything under `ui/webapp`. A rebuild needs no
server restart — `express.static` reads from disk per request, so refreshing the browser
is enough.

It starts the sample with **`AGENT_LLM=scripted`**, which matters: under the LLM that
`@cap-js/agents` ships by default, the agent ignores your prompt and can only ever call
the read tool, so the Approve/Reject flow is unreachable. With the scripted model, try
`show me all books` and then `order 1 copies of book 2` to see the approval gate.

`npm run dev` deliberately serves the built `dist/`, the same path consumers and the E2E
suite use, rather than transpiling `ui/` sources on the fly. That costs a few seconds per
rebuild and buys fidelity: a `Component.ts` bootstrap bug once hid from every check in
this repo precisely because nothing had loaded the built output in a browser.

### Hybrid testing: the sample against a real LLM

`npm run dev` uses a deterministic stand-in for an LLM. To run the sample against a **real
model on SAP AI Core** — which is the only way to see the agent actually reason, rather
than match a regex — use hybrid mode.

```bash
npm run dev:hybrid
```

One-time setup, in `test/fixture/bookshop`:

```bash
cf login                                  # the subaccount holding your AI Core instance
cds bind -2 <instance>:<service-key>      # e.g. cds bind -2 aicore:aicore-key
```

`cds bind` writes `.cdsrc-private.json`. **That file holds live service credentials and is
gitignored** — keep it that way.

Two things are worth knowing before you try it:

- **Hybrid needs [`@sap/cds-dk`](https://www.npmjs.com/package/@sap/cds-dk) installed
  (`npm i -g @sap/cds-dk`); normal `npm run dev` does not.** `cds bind` records only a
  *reference* to the CF instance and key, and resolving that into the `VCAP_SERVICES` the
  SAP AI SDK reads happens at startup in `cds watch`, which ships with cds-dk. Started any
  other way, the SDK logs `Could not find service binding of type 'aicore'` and every call
  then fails with a misleading *"content safety check is temporarily unavailable"* — the
  filter cannot reach AI Core either.
- **`AGENT_LLM` is deliberately unset in hybrid.** The scripted test double registers a
  `buildModel` handler that would shadow the real model, and the agent would keep matching
  regexes while looking like it was reasoning.

The model comes from `@cap-js/agents`' own `[hybrid]` defaults — `anthropic--claude-4.6-sonnet`
via the `aicore` kind — so the sample needs no LLM configuration of its own.

To just start the server in hybrid mode, without the build-and-watch loop:

```bash
npm run start:fixture:hybrid     # the hybrid counterpart of npm run start:fixture
```

Note the asymmetry, which is forced by the tooling rather than chosen: `start:fixture`
uses `cds-serve`, but the hybrid script uses **`cds watch --profile hybrid`**. `cds serve
--profile hybrid` does *not* resolve the service binding — verified: it starts cleanly, then
every model call fails with `Could not find service binding of type 'aicore'` and surfaces as
*"content safety check is temporarily unavailable"*. Don't "simplify" it back to `serve`.

#### Hybrid tests

```bash
npm run test:hybrid
```

Starts the sample in hybrid mode, runs `test/hybrid/` against the real model, and shuts the
server down. **Not part of `npm test` and never run in CI** — no runner has a binding, and a
suite that costs money per run has no business firing on every push. Expect roughly a minute.

Without a binding or without `cds-dk` it **skips with an explanatory message and exits 0**,
so a contributor who was never expected to run it does not see a red build.

The assertions deliberately never check the model's wording, which differs every run. They
check things that stay deterministic even when the prose does not: that the reply contains a
title fetched independently from OData (the agent could only know it by calling a tool), that
ordering reaches `input-required` **with stock unchanged**, that approving decrements stock by
exactly the amount ordered, that rejecting does not, and that a follow-up turn reuses the
`contextId` the server issued.

Verified working end to end: asked for the cheapest book and the cost of three copies, the
model queried the catalog and answered `$11.11 → $33.33`; ordering two copies paused at
`input-required` with stock untouched, and approving it moved stock 12 → 10.

### Other commands

- **`npm run build`** — runs the UI5 build (`ui5-tooling-transpile-task`) from `ui/`
  into `dist/`. `npm run dev` does this for you; run it by hand before committing a
  `ui/` change.
- **`dist/` is committed to git**, deliberately (see `.gitignore`) — a git-install
  consumer runs no build step of its own, so the built output has to already be there.
  This means you must run `npm run build` and commit the result before pushing any
  `ui/` change; CI checks that `dist/` matches a fresh build.
- **`test/fixture/bookshop/`** is the sample, and also the test fixture. It is a small
  CAP project that depends on the plugin via `file:../../..` exactly as a real consumer
  would, and it defines two `@agent` services so the agent picker is exercised. Sample
  and fixture are deliberately the same app: a separate sample would not be run by any
  test and would rot silently. Its
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

## Releasing

Publishing is triggered by **publishing a GitHub Release**, never by a push — nothing
reaches npm because a commit landed. `.github/workflows/publish.yml` re-runs the whole
quality gate (typecheck, unit, service, E2E, the `dist/` freshness check and the packaging
smoke test) before it publishes, because npm's unpublish window is 72 hours and a release
is the last point at which a mistake is cheap.

It authenticates with **npm trusted publishing over OIDC** — there is no `NPM_TOKEN` in
this repository — and publishes with `--provenance`, so consumers can verify the package
was built from this repo by this workflow.

To cut a release:

1. Bump `version` in `package.json`, commit, push.
2. Draft a GitHub Release whose tag is that version, prefixed with `v` (`v0.2.0` for
   `0.2.0`). The workflow **fails fast if the tag and `package.json` disagree** rather
   than publishing a version nobody can correlate with a release.
3. Publish the release. The workflow does the rest.

### One-time setup before the first release

Trusted publishing requires the package to already exist on npm, so the very first
publish cannot come from this workflow:

1. Publish once from your machine: `npm publish --access public`. The `prepublishOnly`
   script builds `dist/` first, so a manual publish cannot ship stale output either.
2. On npmjs.com, open the package's **Settings → Trusted Publisher** and add this
   repository with workflow `publish.yml`.
3. From then on, every release publishes itself with no token.

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
