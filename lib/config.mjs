const DEFAULTS = { enabled: true, mountPath: "/chat", bootstrapUrl: null, agents: null }

/**
 * Resolve plugin config from a cds.env-shaped object.
 *
 * Returns `warnings`: config that was understood but cannot be honoured. The
 * caller logs them. Nothing here throws — a bad mountPath should not take the
 * host server down, but it must not pass silently either.
 */
export function resolveConfig(env = {}) {
  const raw = env["cap-agent-ui5-webui"]
  const warnings = []
  if (raw === false) return { ...DEFAULTS, enabled: false, warnings }

  const given = raw === true || raw == null ? {} : raw
  const merged = { ...DEFAULTS, ...given, warnings }

  if (merged.mountPath && !merged.mountPath.startsWith("/")) {
    merged.mountPath = `/${merged.mountPath}`
  }

  // "/" and "" both mount at the root, which the plugin can never win: cds.server
  // registers `app.get('/', o.index)` for its own welcome page synchronously, while
  // this plugin's bootstrap listener has already yielded at its first dynamic
  // import(). Taking the value would produce a config that reads as applied and
  // serves nothing, so fall back to the default and say so.
  if (!merged.mountPath || merged.mountPath === "/") {
    warnings.push(
      `cap-agent-ui5-webui: mountPath "/" is not available — CAP registers its own handler ` +
        `for "/" before plugins mount, so the chat UI would never be reached. ` +
        `Falling back to "${DEFAULTS.mountPath}".`,
    )
    merged.mountPath = DEFAULTS.mountPath
  }

  return merged
}
