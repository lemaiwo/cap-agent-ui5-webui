import express from "express"
import { existsSync, readFileSync } from "node:fs"
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
  // mountUi logs the missing-dist case; returning quietly here keeps that one
  // diagnostic authoritative instead of crashing bootstrap on a readFileSync.
  if (!existsSync(file)) return
  const html = readFileSync(file, "utf-8").split(DEFAULT_BOOTSTRAP).join(bootstrapUrl)
  const send = (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(html)
  }
  app.get(mountPath, send)
  app.get(`${mountPath}/index.html`, send)
  log.info(`cap-agent-ui5-webui: UI5 bootstrap overridden to ${bootstrapUrl}`)
}
