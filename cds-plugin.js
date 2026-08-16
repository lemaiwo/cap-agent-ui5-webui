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

  // Order matters: the index handler must be registered before the static
  // handler, or express.static answers "/" first and the override is dead code.
  mountIndex(app, config.mountPath, config.bootstrapUrl, LOG)
  mountUi(app, config.mountPath, LOG)

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
