const cds = require("@sap/cds")

// No custom handlers: this service exists only to give the E2E picker test a
// second discoverable @agent service. It stays on plain CRUD (Orders is
// read-only here) and, thanks to @agent.connect: 'none' on the CDS side,
// never gets wired as a delegation tool for the catalog agent.
module.exports = class SupportService extends cds.ApplicationService {
  init() {
    return super.init()
  }
}
