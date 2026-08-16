sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";

  const Component = UIComponent.extend("webapp.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    },
    init: function _init() {
      UIComponent.prototype.init.call(this);
    }
  });
  return Component;
});
//# sourceMappingURL=Component-dbg.js.map
