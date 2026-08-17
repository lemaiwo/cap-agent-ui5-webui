const DEFAULTS = {
  enabled: true,
  mountPath: "/chat",
  bootstrapUrl: null,
  agents: null,
  // Set false when the UI is deployed to the HTML5 Application Repository
  // instead of being served from the CDS server. agents.json stays mounted -
  // it is generated at runtime from the services carrying @agent, so the
  // repository cannot produce it and the UI still has to fetch it from here.
  serveUi: true,
}

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

  // A trailing slash produces routes like "/chat//agents.json", which nothing
  // can match: the UI still loads (mountUi/mountIndex don't care), but every
  // fetch under the mount path 404s, loadAgents swallows the failure, and the
  // client falls back silently to a manifest path that exists in no project.
  // Strip it before the "/" / "" check below, so "/chat/" is caught the same
  // way "/" already is once stripping leaves nothing behind. `?? ""` covers a
  // config that explicitly sets mountPath to null/undefined (e.g. an unset
  // env var spread in) — merged.mountPath would otherwise be that same
  // null/undefined (object spread copies explicit undefined too), and
  // .replace on it would throw, contradicting this function's own contract of
  // never throwing.
  merged.mountPath = (merged.mountPath ?? "").replace(/\/+$/, "")

  // A typo'd key (e.g. "mountpath") would otherwise be silently ignored —
  // spread into `merged` as dead weight, never read by anything downstream —
  // leaving a consumer with no signal that their config did nothing.
  const unknown = Object.keys(given).filter((k) => !(k in DEFAULTS))
  if (unknown.length) {
    warnings.push(`cap-agent-ui5-webui: unknown config key(s) ignored: ${unknown.join(", ")}`)
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
