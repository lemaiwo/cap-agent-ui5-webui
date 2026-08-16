sap.ui.define([], function () {
  "use strict";

  function partsToText(parts) {
    if (!parts) return "";
    return parts.filter(p => p.kind === "text").map(p => p.text).join("");
  }
  var __exports = {
    __esModule: true
  };
  __exports.partsToText = partsToText;
  return __exports;
});
//# sourceMappingURL=types-dbg.js.map
