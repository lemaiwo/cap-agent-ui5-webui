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
 *
 * `dist` is a parameter rather than a constant so the missing-dist branch — the
 * one a consumer is most likely to hit and least able to diagnose — can be
 * tested without touching the real build output.
 */
export function mountUi(app, mountPath, log, dist = distPath()) {
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
export function mountIndex(app, mountPath, bootstrapUrl, log, dist = distPath()) {
  if (!bootstrapUrl || bootstrapUrl === DEFAULT_BOOTSTRAP) return

  const file = join(dist, "index.html")
  // mountUi logs the missing-dist case; returning quietly here keeps that one
  // diagnostic authoritative instead of crashing bootstrap on a readFileSync.
  if (!existsSync(file)) return

  const source = readFileSync(file, "utf-8")
  // A String#split that finds nothing yields a one-element array and the join is
  // a no-op — so without this guard an override that matched nothing would still
  // report success, and the page would keep fetching the CDN the consumer is
  // trying to avoid. DEFAULT_BOOTSTRAP is duplicated in ui/webapp/index.html with
  // nothing binding the two, so a UI5 version bump there lands exactly here.
  if (!source.includes(DEFAULT_BOOTSTRAP)) {
    log.warn(
      `cap-agent-ui5-webui: bootstrapUrl set, but ${file} does not reference ` +
        `${DEFAULT_BOOTSTRAP} — override not applied`,
    )
    return
  }

  const html = source.split(DEFAULT_BOOTSTRAP).join(bootstrapUrl)
  const send = (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(html)
  }
  app.get(mountPath, send)
  app.get(`${mountPath}/index.html`, send)
  log.info(`cap-agent-ui5-webui: UI5 bootstrap overridden to ${bootstrapUrl}`)
}
