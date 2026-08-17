import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MARKER, appPath, prepareHtml5, routerRoutes, xsAppJson } from "../../lib/html5.mjs"

const tmp = () => mkdtempSync(join(tmpdir(), "cap-agent-html5-"))

/** A stand-in for the plugin's dist/, so these tests never depend on a build. */
function fakeDist() {
  const dir = join(tmp(), "dist")
  mkdirSync(join(dir, "css"), { recursive: true })
  writeFileSync(join(dir, "index.html"), "<html></html>")
  writeFileSync(join(dir, "manifest.json"), '{"sap.app":{"id":"capagentui.chat"}}')
  writeFileSync(join(dir, "css", "style.css"), ".a{}")
  return dir
}

test("xs-app.json routes agents.json to the CAP service, not the repository", () => {
  const { routes } = xsAppJson()
  const agents = routes.find((r) => r.source.includes("agents"))

  assert.equal(agents.target, "/chat/agents.json")
  assert.equal(agents.destination, "srv-api")
  // Falling through to html5-apps-repo would 404: the repository has no
  // agents.json and cannot generate one.
  assert.equal(agents.service, undefined)
})

test("the agents.json route is matched before the catch-all", () => {
  const { routes } = xsAppJson()
  const agentsAt = routes.findIndex((r) => r.source.includes("agents"))
  const catchAllAt = routes.findIndex((r) => r.service === "html5-apps-repo-rt")

  assert.ok(agentsAt < catchAllAt, "agents.json route must precede the repository catch-all")
})

test("the agents.json route follows a custom mountPath and destination", () => {
  const { routes } = xsAppJson({ mountPath: "/assistant", destination: "backend" })
  const agents = routes.find((r) => r.source.includes("agents"))

  assert.equal(agents.target, "/assistant/agents.json")
  assert.equal(agents.destination, "backend")
})

test("the source pattern escapes the dot, so it cannot match agentsXjson", () => {
  const { routes } = xsAppJson()
  const agents = routes.find((r) => r.source.includes("agents"))
  const re = new RegExp(agents.source)

  assert.ok(re.test("/agents.json"))
  assert.ok(!re.test("/agentsXjson"))
})

test("prepareHtml5 copies the built UI and writes xs-app.json", () => {
  const targetDir = join(tmp(), "out")
  const { entries } = prepareHtml5({ targetDir, dist: fakeDist() })

  assert.ok(entries.includes("index.html"))
  assert.ok(entries.includes("manifest.json"))
  assert.ok(entries.includes("xs-app.json"))
  assert.equal(readFileSync(join(targetDir, "css", "style.css"), "utf8"), ".a{}")

  const written = JSON.parse(readFileSync(join(targetDir, "xs-app.json"), "utf8"))
  assert.equal(written.welcomeFile, "/index.html")
})

test("prepareHtml5 refuses to overwrite a directory it did not create", () => {
  const targetDir = join(tmp(), "mine")
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, "important.txt"), "do not delete")

  assert.throws(() => prepareHtml5({ targetDir, dist: fakeDist() }), /Refusing to overwrite/)
  assert.equal(readFileSync(join(targetDir, "important.txt"), "utf8"), "do not delete")
})

test("prepareHtml5 does overwrite its own previous output", () => {
  const dist = fakeDist()
  const targetDir = join(tmp(), "out")
  prepareHtml5({ targetDir, dist })

  assert.ok(existsSync(join(targetDir, MARKER)))
  assert.doesNotThrow(() => prepareHtml5({ targetDir, dist }))
})

test("prepareHtml5 explains a missing build rather than producing an empty artifact", () => {
  assert.throws(
    () => prepareHtml5({ targetDir: join(tmp(), "out"), dist: join(tmp(), "nope") }),
    /no built UI found/,
  )
})

test("appPath is the manifest's sap.app.id without dots", () => {
  assert.equal(appPath(fakeDist()), "capagentuichat")
})

test("appPath reports a manifest it cannot use rather than returning a broken path", () => {
  const dir = join(tmp(), "dist")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), '{"sap.app":{}}')

  assert.throws(() => appPath(dir), /no sap.app.id/)
})

// A standalone approuter with a catch-all to the CAP service matches the app
// path first and forwards the whole UI to a server that serves none of it, so
// the app path has to be routed explicitly and ahead of that catch-all.
test("routerRoutes sends the app path to the repository and agents.json to the service", () => {
  const [agents, app] = routerRoutes({ path: "capagentuichat" })

  assert.ok(new RegExp(agents.source).test("/capagentuichat/agents.json"))
  assert.equal(agents.target, "/chat/agents.json")
  assert.equal(agents.destination, "srv-api")

  assert.ok(new RegExp(app.source).test("/capagentuichat/index.html"))
  assert.equal(app.service, "html5-apps-repo-rt")
})

// A standalone approuter validates BOTH files - its own at startup, and the
// app's on every request after fetching it from the repository - against the
// bound service's runtime name. The widely-copied "html5-apps-repo" only works
// under the managed approuter, which skips the check; here it produces a boot
// crash or a request-time 500 reading "the service is not bound", which points
// at the binding rather than at the name.
test("both xs-app.json flavours name the bound app-runtime service", () => {
  const [, routerApp] = routerRoutes({ path: "capagentuichat" })
  const bundled = xsAppJson().routes.find((r) => r.service)

  assert.equal(routerApp.service, "html5-apps-repo-rt")
  assert.equal(bundled.service, "html5-apps-repo-rt")
})

test("routerRoutes puts agents.json before the app catch-all", () => {
  const [first] = routerRoutes({ path: "capagentuichat" })
  assert.ok(first.source.includes("agents"))
})

test("prepareHtml5 reports the path the app will be served under", () => {
  const { path } = prepareHtml5({ targetDir: join(tmp(), "out"), dist: fakeDist() })
  assert.equal(path, "capagentuichat")
})
