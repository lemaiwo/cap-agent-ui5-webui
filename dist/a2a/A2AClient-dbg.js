sap.ui.define(["./sse"], function (___sse) {
  "use strict";

  const parseSSE = ___sse["parseSSE"];
  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  class A2AClient {
    constructor(baseUrl) {
      this.baseUrl = baseUrl;
    }
    async getAgentCard() {
      const res = await fetch(`${this.baseUrl}/.well-known/agent-card.json`, {
        headers: {
          Accept: "application/json"
        }
      });
      if (!res.ok) throw new Error(`Agent card request failed: ${res.status}`);
      return await res.json();
    }
    async streamMessage(params, onEvent, signal) {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: this.envelope("message/stream", params),
        signal
      });
      if (!res.ok || !res.body) {
        const envelope = await res.json().catch(() => null);
        throw new Error(envelope?.error?.message ?? `Request failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const {
          done,
          value
        } = await reader.read();
        if (done) break;
        const parsed = parseSSE(buffer, decoder.decode(value, {
          stream: true
        }));
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          const envelope = JSON.parse(frame.data);
          if (envelope.error) throw new Error(envelope.error.message);
          if (envelope.result) onEvent(envelope.result);
        }
      }
    }
    async cancel(taskId) {
      await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: newId(),
          method: "tasks/cancel",
          params: {
            id: taskId
          }
        })
      }).catch(() => undefined);
    }
    envelope(method, params) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: newId(),
        method,
        params: {
          message: {
            kind: "message",
            role: "user",
            messageId: newId(),
            parts: [{
              kind: "text",
              text: params.text
            }],
            ...(params.contextId ? {
              contextId: params.contextId
            } : {}),
            ...(params.taskId ? {
              taskId: params.taskId
            } : {})
          }
        }
      });
    }
  }
  var __exports = {
    __esModule: true
  };
  __exports.A2AClient = A2AClient;
  return __exports;
});
//# sourceMappingURL=A2AClient-dbg.js.map
