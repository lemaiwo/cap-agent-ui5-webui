import Controller from "sap/ui/core/mvc/Controller"
import JSONModel from "sap/ui/model/json/JSONModel"
import Component from "sap/ui/core/Component"
import Input from "sap/m/Input"
import { A2AClient } from "../a2a/A2AClient"
import { initialState, appendUser, appendError, applyEvent } from "../chat/chatState"
import type { ChatState } from "../chat/chatState"

export default class Chat extends Controller {
  private model!: JSONModel
  private client!: A2AClient
  private state!: ChatState
  private agentName = "Catalog Agent"
  private abort?: AbortController

  public onInit(): void {
    const owner = this.getOwnerComponent() as Component
    const agentUrl = owner.getManifestEntry("/sap.ui5/config/agentUrl") as unknown as string

    this.client = new A2AClient(agentUrl)
    this.state = initialState()
    this.model = new JSONModel()
    this.getView()?.setModel(this.model, "chat")
    this.sync()

    void this.loadAgentCard()
  }

  public onSubmit(): void {
    void this.send()
  }

  public onSend(): void {
    void this.send()
  }

  public onCancel(): void {
    this.abort?.abort()
    if (this.state.taskId) void this.client.cancel(this.state.taskId)
  }

  private async loadAgentCard(): Promise<void> {
    try {
      const card = await this.client.getAgentCard()
      this.agentName = card.name || this.agentName
    } catch {
      this.agentName = "Catalog Agent (offline)"
    }
    this.sync()
  }

  private input(): Input {
    return this.byId("promptInput") as Input
  }

  private async send(): Promise<void> {
    const field = this.input()
    const text = (field.getValue() ?? "").trim()
    if (!text || this.state.busy) return

    field.setValue("")
    await this.exchange(text, null)
  }

  protected async exchange(text: string, resumeTaskId: string | null): Promise<void> {
    const contextId = this.state.contextId
    this.state = appendUser(this.state, text)
    this.sync()

    this.abort = new AbortController()

    try {
      await this.client.streamMessage(
        { text, contextId, taskId: resumeTaskId },
        (event) => {
          this.state = applyEvent(this.state, event)
          this.sync()
        },
        this.abort.signal,
      )
    } catch (err) {
      const error = err as Error
      if (error.name !== "AbortError") {
        this.state = appendError(this.state, error.message)
      } else {
        this.state = { ...this.state, busy: false, status: "" }
      }
      this.sync()
    } finally {
      if (this.state.busy && !this.state.pendingApproval) {
        this.state = { ...this.state, busy: false, status: "" }
        this.sync()
      }
      this.abort = undefined
    }
  }

  private sync(): void {
    this.model.setData({ ...this.state, agentName: this.agentName })
  }
}
