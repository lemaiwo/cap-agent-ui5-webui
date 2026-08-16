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
})
