sap.ui.define([], function () {
  "use strict";

  function parseSSE(buffer, chunk) {
    const combined = (buffer + chunk).replace(/\r\n/g, "\n");
    const blocks = combined.split("\n\n");
    const rest = blocks.pop() ?? "";
    const frames = [];
    for (const block of blocks) {
      if (!block.trim()) continue;
      let event;
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (dataLines.length) frames.push({
        event,
        data: dataLines.join("\n")
      });
    }
    return {
      frames,
      rest
    };
  }
  var __exports = {
    __esModule: true
  };
  __exports.parseSSE = parseSSE;
  return __exports;
});
//# sourceMappingURL=sse-dbg.js.map
