#!/usr/bin/env node
/**
 * cap-agent-ui5-webui <command>
 *
 * html5 <dir>   Write a deployable HTML5 Application Repository artifact.
 */

import { resolve } from "node:path"
import { prepareHtml5, routerRoutes } from "../lib/html5.mjs"

const USAGE = `
cap-agent-ui5-webui html5 <dir> [options]

  Writes the prebuilt chat UI plus an xs-app.json into <dir>, ready for an
  MTA "html5" module to zip and deploy to the HTML5 Application Repository.

  Use it only when you also set serveUi:false in your CAP config - otherwise
  the same UI is served twice, once from the repository and once from the CDS
  server.

Options:
  --mount-path <path>   Where the plugin mounts agents.json on the CAP service.
                        Must match your cap-agent-ui5-webui.mountPath.
                        Default: /chat
  --destination <name>  Approuter destination pointing at the CAP service, as
                        named in your mta.yaml. Default: srv-api
  --archive-name <name> Base name of the .zip written into <dir>. Must match
                        the MTA html5 module name that references it.
                        Default: the app id without dots

Example:
  cap-agent-ui5-webui html5 app/chat-ui
`

const [command, ...rest] = process.argv.slice(2)

if (!command || command === "--help" || command === "-h") {
  console.log(USAGE)
  process.exit(command ? 0 : 1)
}

if (command !== "html5") {
  console.error(`unknown command: ${command}`)
  console.error(USAGE)
  process.exit(1)
}

const positional = []
const options = { mountPath: "/chat", destination: "srv-api" }

for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (arg === "--mount-path") options.mountPath = rest[++i]
  else if (arg === "--destination") options.destination = rest[++i]
  else if (arg === "--archive-name") options.archiveName = rest[++i]
  else if (arg.startsWith("-")) {
    console.error(`unknown option: ${arg}`)
    process.exit(1)
  } else positional.push(arg)
}

if (positional.length !== 1) {
  console.error("html5 takes exactly one directory")
  console.error(USAGE)
  process.exit(1)
}

if (!options.mountPath || !options.destination) {
  console.error("--mount-path and --destination each need a value")
  process.exit(1)
}

const targetDir = resolve(positional[0])

try {
  const { entries, path } = prepareHtml5({ ...options, targetDir })
  console.log(`wrote ${entries.length} entries to ${targetDir}`)
  console.log(`the approuter will serve this app at /${path}/index.html\n`)
  console.log("Add these routes to your approuter's xs-app.json, ABOVE any catch-all")
  console.log("(a catch-all matches the app path first and forwards it to the CAP service,")
  console.log("which serves none of it):\n")
  console.log(JSON.stringify(routerRoutes({ ...options, path }), null, 2))
} catch (err) {
  console.error(`cap-agent-ui5-webui html5: ${err.message}`)
  process.exit(1)
}
