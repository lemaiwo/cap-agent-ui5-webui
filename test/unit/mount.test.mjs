import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_BOOTSTRAP, distPath, mountIndex, mountUi } from "../../lib/mount.mjs"

const OVERRIDE = "https://ui5.internal.example/1.120.0/resources/sap-ui-core.js"

/**
 * Records every registration into one array, so ordering *across* `use` and `get`
 * is observable — which is the whole point, since express resolves them in
 * registration order regardless of which method registered them.
 */
function fakeApp() {
  const calls = []
  return {
    calls,
    use: (path, handler) => calls.push({ verb: "use", path, handler }),
    get: (path, handler) => calls.push({ verb: "get", path, handler }),
  }
}

function fakeLog() {
  const infos = []
  const warns = []
  return { infos, warns, info: (m) => infos.push(m), warn: (m) => warns.push(m) }
}

function fakeRes() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    send(body) {
      this.body = body
    },
  }
}

/** A directory containing exactly the given files, removed afterwards. */
function withDist(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "cap-agent-ui5-webui-"))
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const missingDist = () => join(tmpdir(), "cap-agent-ui5-webui-does-not-exist-9f3a1c")

const INDEX_WITH_DEFAULT = `<!DOCTYPE html><html><head>
  <script id="sap-ui-bootstrap" src="${DEFAULT_BOOTSTRAP}"></script>
</head><body></body></html>`

test("distPath resolves to the plugin's own dist/, not the consumer's cwd", () => {
  assert.match(distPath().replaceAll("\\", "/"), /\/dist$/)
})

test("mountUi serves the built UI and reports success", () => {
  const app = fakeApp()
  const log = fakeLog()

  assert.equal(mountUi(app, "/chat", log, distPath()), true)
  assert.equal(app.calls.length, 1)
  assert.equal(app.calls[0].verb, "use")
  assert.equal(app.calls[0].path, "/chat")
  assert.match(log.infos.join("\n"), /serving chat UI at \/chat/)
  assert.deepEqual(log.warns, [])
})

test("mountUi registers nothing and warns loudly when dist/ is missing", () => {
  const app = fakeApp()
  const log = fakeLog()

  assert.equal(mountUi(app, "/chat", log, missingDist()), false)
  assert.deepEqual(app.calls, [])
  assert.equal(log.warns.length, 1)
  // The whole point of this branch is that the warning names the likely cause,
  // rather than leaving a consumer to diagnose a 404 from an empty page.
  assert.match(log.warns[0], /no dist\/ found/)
  assert.match(log.warns[0], /npm run build/)
  assert.match(log.warns[0], /gitignored/)
})

test("the index override is registered ahead of the static handler", () => {
  withDist({ "index.html": INDEX_WITH_DEFAULT }, (dist) => {
    const app = fakeApp()
    const log = fakeLog()

    // Same order as cds-plugin.js. If it were reversed, express.static would
    // answer "/chat" first and the override would be dead code.
    mountIndex(app, "/chat", OVERRIDE, log, dist)
    mountUi(app, "/chat", log, dist)

    assert.deepEqual(
      app.calls.map((c) => `${c.verb} ${c.path}`),
      ["get /chat", "get /chat/index.html", "use /chat"],
    )
  })
})

test("the override actually substitutes the bootstrap URL in the served html", () => {
  withDist({ "index.html": INDEX_WITH_DEFAULT }, (dist) => {
    const app = fakeApp()
    const log = fakeLog()
    mountIndex(app, "/chat", OVERRIDE, log, dist)

    for (const { handler } of app.calls) {
      const res = fakeRes()
      handler({}, res)
      assert.match(res.body, new RegExp(OVERRIDE.replaceAll(/[/.]/g, "\\$&")))
      assert.equal(res.body.includes(DEFAULT_BOOTSTRAP), false)
      assert.equal(res.headers["Content-Type"], "text/html; charset=utf-8")
    }
    assert.match(log.infos.join("\n"), /bootstrap overridden to https:\/\/ui5\.internal\.example/)
  })
})

test("no override is registered when bootstrapUrl is unset or already the default", () => {
  withDist({ "index.html": INDEX_WITH_DEFAULT }, (dist) => {
    for (const url of [null, undefined, "", DEFAULT_BOOTSTRAP]) {
      const app = fakeApp()
      const log = fakeLog()
      mountIndex(app, "/chat", url, log, dist)
      assert.deepEqual(app.calls, [], `expected no registration for bootstrapUrl ${url}`)
      assert.deepEqual(log.infos, [])
    }
  })
})

test("a bootstrapUrl whose target string is absent warns instead of claiming success", () => {
  // The default URL lives in both ui/webapp/index.html and lib/mount.mjs with
  // nothing binding them, so a UI5 version bump in the HTML lands here — as a
  // substitution that silently matches nothing.
  withDist({ "index.html": `<script src="https://ui5.sap.com/1.999.0/resources/sap-ui-core.js">` }, (dist) => {
    const app = fakeApp()
    const log = fakeLog()

    mountIndex(app, "/chat", OVERRIDE, log, dist)

    assert.deepEqual(app.calls, [])
    assert.deepEqual(log.infos, [])
    assert.equal(log.warns.length, 1)
    assert.match(log.warns[0], /does not reference/)
    assert.match(log.warns[0], /override not applied/)
  })
})

test("a bootstrapUrl override with no dist/ at all does not throw", () => {
  const app = fakeApp()
  const log = fakeLog()

  assert.doesNotThrow(() => mountIndex(app, "/chat", OVERRIDE, log, missingDist()))
  assert.deepEqual(app.calls, [])
  // mountUi owns the missing-dist diagnostic; a second one here would just be noise.
  assert.deepEqual(log.warns, [])
})
