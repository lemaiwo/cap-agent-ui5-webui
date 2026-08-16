const DEFAULTS = { enabled: true, mountPath: "/chat", bootstrapUrl: null, agents: null }

/** Resolve plugin config from a cds.env-shaped object. */
export function resolveConfig(env = {}) {
  const raw = env["cap-agent-ui5-webui"]
  if (raw === false) return { ...DEFAULTS, enabled: false }
  const given = raw === true || raw == null ? {} : raw
  const merged = { ...DEFAULTS, ...given }
  if (merged.mountPath && !merged.mountPath.startsWith("/")) {
    merged.mountPath = `/${merged.mountPath}`
  }
  return merged
}
