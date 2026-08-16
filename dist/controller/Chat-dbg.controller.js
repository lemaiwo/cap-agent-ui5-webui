sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "../a2a/A2AClient", "../chat/chatState"], function (Controller, JSONModel, ___a2a_A2AClient, ___chat_chatState) {
  "use strict";

  const A2AClient = ___a2a_A2AClient["A2AClient"];
  const initialState = ___chat_chatState["initialState"];
  const appendUser = ___chat_chatState["appendUser"];
  const appendError = ___chat_chatState["appendError"];
  const applyEvent = ___chat_chatState["applyEvent"];
  /** Single place the wall clock is read. The reducer stays pure by taking this as input. */
  const now = () => new Date().toISOString();
  const Chat = Controller.extend("webapp.controller.Chat", {
    constructor: function constructor() {
      Controller.prototype.constructor.apply(this, arguments);
      this.agentName = "Agent";
      this.agents = [];
      this.agentPath = "";
    },
    onInit: function _onInit() {
      const owner = this.getOwnerComponent();
      const agentUrl = owner.getManifestEntry("/sap.ui5/config/agentUrl");
      this.setAgent(agentUrl);
      this.state = initialState();
      this.model = new JSONModel();
      this.getView()?.setModel(this.model, "chat");
      this.sync();
      void this.bootstrap(agentUrl);
    },
    onAgentChange: function _onAgentChange() {
      const path = this.model.getProperty("/agentPath");
      this.abort?.abort();
      this.setAgent(path);
      // contextId and task history belong to the agent that issued them, so a
      // switch starts a genuinely new conversation rather than replaying one
      // agent's thread at another.
      this.state = initialState();
      this.sync();
    },
    setAgent: function _setAgent(path) {
      this.agentPath = path;
      this.client = new A2AClient(path);
    },
    /**
     * Fetches the agent list before the first agent-card lookup, so the card
     * request goes out against whichever agent ends up selected rather than
     * always the manifest fallback.
     */
    bootstrap: async function _bootstrap(fallbackUrl) {
      await this.loadAgents(fallbackUrl);
      await this.loadAgentCard();
    },
    /**
     * Falls back to the manifest's agentUrl (kept as-is, a single implicit
     * agent) when the request fails — e.g. this UI embedded without the
     * plugin's own server mounting agents.json.
     */
    loadAgents: async function _loadAgents(fallbackUrl) {
      try {
        const res = await fetch("agents.json");
        if (!res.ok) throw new Error(`Agents request failed: ${res.status}`);
        const agents = await res.json();
        this.agents = agents;
        const preferred = agents.find(a => a.path === fallbackUrl) ?? agents[0];
        if (preferred) this.setAgent(preferred.path);
      } catch {
        this.agents = [];
      }
      this.sync();
    },
    onSubmit: function _onSubmit() {
      void this.send();
    },
    onSend: function _onSend() {
      void this.send();
    },
    onCancel: function _onCancel() {
      this.abort?.abort();
      if (this.state.taskId) void this.client.cancel(this.state.taskId);
    },
    onApprove: function _onApprove() {
      void this.decide("approve");
    },
    onReject: function _onReject() {
      void this.decide("reject");
    },
    decide: async function _decide(decision) {
      const taskId = this.state.taskId;
      if (!taskId || !this.state.pendingApproval) return;
      await this.exchange(decision, taskId);
    },
    loadAgentCard: async function _loadAgentCard() {
      try {
        const card = await this.client.getAgentCard();
        this.agentName = card.name || this.agentName;
      } catch {
        this.agentName = "Agent (offline)";
      }
      this.sync();
    },
    input: function _input() {
      return this.byId("promptInput");
    },
    send: async function _send() {
      const field = this.input();
      const text = (field.getValue() ?? "").trim();
      if (!text || this.state.busy) return;
      field.setValue("");
      await this.exchange(text, null);
    },
    exchange: async function _exchange(text, resumeTaskId) {
      const contextId = this.state.contextId;
      this.state = appendUser(this.state, text, now());
      this.sync();
      this.abort = new AbortController();
      try {
        await this.client.streamMessage({
          text,
          contextId,
          taskId: resumeTaskId
        }, event => {
          this.state = applyEvent(this.state, event, now());
          this.sync();
        }, this.abort.signal);
      } catch (err) {
        const error = err;
        if (error.name !== "AbortError") {
          this.state = appendError(this.state, error.message, now());
        } else {
          this.state = {
            ...this.state,
            busy: false,
            status: ""
          };
        }
        this.sync();
      } finally {
        if (this.state.busy && !this.state.pendingApproval) {
          this.state = {
            ...this.state,
            busy: false,
            status: ""
          };
          this.sync();
        }
        this.abort = undefined;
      }
    },
    /**
     * Bound by the view to render each bubble's timestamp. Returns local
     * HH:MM; an empty/invalid stamp renders as nothing rather than "Invalid Date".
     */
    formatTime: function _formatTime(at) {
      if (!at) return "";
      const d = new Date(at);
      if (Number.isNaN(d.getTime())) return "";
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
    sync: function _sync() {
      this.model.setData({
        ...this.state,
        agentName: this.agentName,
        agents: this.agents,
        agentPath: this.agentPath
      });
      this.scrollToNewest();
    },
    /**
     * Keep the newest message in view. Deferred a frame because the list has not
     * re-rendered at the moment setData returns.
     */
    scrollToNewest: function _scrollToNewest() {
      const page = this.byId("page");
      if (!page) return;
      setTimeout(() => page.scrollTo(1e6, 200), 0);
    }
  });
  return Chat;
});
//# sourceMappingURL=Chat-dbg.controller.js.map
