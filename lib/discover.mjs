/**
 * Find A2A agents to offer in the UI.
 *
 * `@agent` is service-level only — the plugin reads srv.definition["@agent"],
 * so "how many agents" is exactly "how many annotated services". The mounted
 * path is read from the endpoint whose kind is "agent" rather than
 * reconstructed from the service name, because an explicit @path overrides the
 * default /a2a prefix entirely.
 */
export function discoverAgents(services = [], allow = null) {
  const found = []
  for (const srv of services) {
    if (!srv?.definition?.["@agent"]) continue
    const endpoint = (srv.endpoints ?? []).find((e) => e.kind === "agent")
    if (!endpoint?.path) continue
    found.push({
      name: srv.name,
      path: endpoint.path,
      description: srv.definition["@description"] ?? srv.definition["@title"] ?? srv.name,
    })
  }
  if (!allow) return found
  const byName = new Map(found.map((f) => [f.name, f]))
  return allow.map((n) => byName.get(n)).filter(Boolean)
}
