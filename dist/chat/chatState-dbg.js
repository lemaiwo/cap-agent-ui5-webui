sap.ui.define(["../a2a/types"], function (___a2a_types) {
  "use strict";

  const partsToText = ___a2a_types["partsToText"];
  function initialState() {
    return {
      messages: [],
      busy: false,
      status: "",
      contextId: null,
      taskId: null,
      pendingApproval: false,
      streamed: false
    };
  }
  function push(state, role, text, now, streaming = false) {
    const id = `${role.charAt(0)}${state.messages.length}`;
    return {
      ...state,
      messages: [...state.messages, {
        id,
        role,
        text,
        streaming,
        at: now
      }]
    };
  }
  function finalize(state) {
    if (!state.messages.some(m => m.streaming)) return state;
    return {
      ...state,
      messages: state.messages.map(m => m.streaming ? {
        ...m,
        streaming: false
      } : m)
    };
  }
  function appendUser(state, text, now) {
    return {
      ...push(state, "user", text, now),
      busy: true,
      status: "",
      pendingApproval: false,
      streamed: false
    };
  }
  function appendError(state, text, now) {
    return {
      ...push(finalize(state), "error", text, now),
      busy: false,
      status: "",
      pendingApproval: false
    };
  }
  function upsertStream(state, text, append, now) {
    const messages = [...state.messages];
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last && last.role === "agent" && last.streaming) {
      // Keep the bubble's original `at` — it is when the reply started, not when
      // this particular chunk landed.
      messages[lastIndex] = {
        ...last,
        text: append ? last.text + text : text
      };
      return {
        ...state,
        messages,
        streamed: true,
        busy: true
      };
    }
    return {
      ...push(state, "agent", text, now, true),
      streamed: true,
      busy: true
    };
  }
  function applyEvent(state, event, now) {
    if (event.kind === "task") {
      return {
        ...state,
        taskId: event.id,
        contextId: event.contextId,
        busy: true
      };
    }
    if (event.kind === "artifact-update") {
      return upsertStream(state, partsToText(event.artifact?.parts), event.append === true, now);
    }
    if (event.kind === "status-update") {
      const base = {
        ...state,
        taskId: event.taskId ?? state.taskId,
        contextId: event.contextId ?? state.contextId
      };
      const text = partsToText(event.status?.message?.parts);
      switch (event.status?.state) {
        case "working":
          return {
            ...base,
            busy: true,
            status: text
          };
        case "input-required":
          {
            const done = finalize(base);
            const withMessage = text && !done.streamed ? push(done, "agent", text, now) : done;
            return {
              ...withMessage,
              busy: false,
              status: "",
              pendingApproval: true
            };
          }
        case "completed":
          {
            const done = finalize(base);
            const withMessage = text && !done.streamed ? push(done, "agent", text, now) : done;
            return {
              ...withMessage,
              busy: false,
              status: "",
              pendingApproval: false,
              streamed: false
            };
          }
        case "failed":
        case "canceled":
          return appendError(base, text || `Task ${event.status.state}.`, now);
        default:
          return base;
      }
    }
    return state;
  }
  var __exports = {
    __esModule: true
  };
  __exports.initialState = initialState;
  __exports.appendUser = appendUser;
  __exports.appendError = appendError;
  __exports.applyEvent = applyEvent;
  return __exports;
});
//# sourceMappingURL=chatState-dbg.js.map
