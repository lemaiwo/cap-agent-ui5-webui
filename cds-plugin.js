// CAP discovers plugins via require.resolve("<pkg>/cds-plugin"), so package.json
// must export the "./cds-plugin" subpath as well as "." — an exports map without
// it resolves to ERR_PACKAGE_PATH_NOT_EXPORTED and the plugin silently no-ops.
const cds = require("@sap/cds")

const LOG = cds.log("agent-chat-ui")

cds.on("bootstrap", async (app) => {
  const { resolveConfig } = await import("./lib/config.mjs")
  const { mountUi, mountIndex } = await import("./lib/mount.mjs")

  const config = resolveConfig(cds.env)
  for (const warning of config.warnings) LOG.warn(warning)

  if (!config.enabled) {
    LOG.info("cap-agent-ui5-webui: disabled by configuration")
    return
  }

  // serveUi:false means the UI is deployed to the HTML5 Application Repository
  // and the approuter delivers it from there. Only agents.json is mounted
  // below - it is generated at runtime from the services carrying @agent, so
  // no static artifact can stand in for it. Serving the UI here too would put
  // a second, stale copy on a public srv route.
  let mounted = false
  if (config.serveUi) {
    // Order matters: the index handler must be registered before the static
    // handler, or express.static answers "/" first and the override is dead code.
    mountIndex(app, config.mountPath, config.bootstrapUrl, LOG)
    mounted = mountUi(app, config.mountPath, LOG)
  } else {
    LOG.info(
      `cap-agent-ui5-webui: serveUi:false — chat UI not served from the CDS server; ` +
        `only ${config.mountPath}/agents.json is mounted`,
    )
  }

  // List the chat UI under "Web Applications" on the CDS welcome page.
  //
  // CAP builds that list by scanning cds.env.folders.app for *.html
  // (@sap/cds/app/index.js -> _app_links), which can never find us: the UI ships
  // inside this package's dist/, not in the consumer's app/ folder. The same
  // function concatenates cds.app._app_links, which exists precisely so
  // something serving its own assets can add itself.
  //
  // Only when the UI actually mounted - advertising a link to a missing dist/
  // would be worse than showing nothing.
  if (mounted) {
    ;(cds.app._app_links ??= []).push(`${config.mountPath}/index.html`)
  }

  // Registered here, at bootstrap, but filled below on "served" — Express
  // resolves routes at request time, so this closure over `agents` sees
  // whatever discoverAgents() has produced by the time a request arrives.
  // Registering the route inside the "served" handler instead would race
  // CAP's own middleware and 404 handler.
  let agents = []
  app.get(`${config.mountPath}/agents.json`, (_req, res) => res.json(agents))

  cds.on("served", async (services) => {
    const { discoverAgents } = await import("./lib/discover.mjs")
    agents = discoverAgents(Object.values(services), config.agents)
    LOG.info(
      `cap-agent-ui5-webui: discovered ${agents.length} agent(s)`,
      agents.map((a) => a.path),
    )
  })
})
