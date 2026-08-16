import Controller from "sap/ui/core/mvc/Controller"
import JSONModel from "sap/ui/model/json/JSONModel"
import Component from "sap/ui/core/Component"
import Input from "sap/m/Input"
import Page from "sap/m/Page"
import { A2AClient } from "../a2a/A2AClient"
import { initialState, appendUser, appendError, applyEvent } from "../chat/chatState"
import type { ChatState } from "../chat/chatState"

/** Single place the wall clock is read. The reducer stays pure by taking this as input. */
const now = (): string => new Date().toISOString()

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

  public onApprove(): void {
    void this.decide("approve")
  }

  public onReject(): void {
    void this.decide("reject")
  }

  private async decide(decision: "approve" | "reject"): Promise<void> {
    const taskId = this.state.taskId
    if (!taskId || !this.state.pendingApproval) return
    await this.exchange(decision, taskId)
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
    this.state = appendUser(this.state, text, now())
    this.sync()

    this.abort = new AbortController()

    try {
      await this.client.streamMessage(
        { text, contextId, taskId: resumeTaskId },
        (event) => {
          this.state = applyEvent(this.state, event, now())
          this.sync()
        },
        this.abort.signal,
      )
    } catch (err) {
      const error = err as Error
      if (error.name !== "AbortError") {
        this.state = appendError(this.state, error.message, now())
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

  /**
   * Bound by the view to render each bubble's timestamp. Returns local
   * HH:MM; an empty/invalid stamp renders as nothing rather than "Invalid Date".
   */
  public formatTime(at?: string): string {
    if (!at) return ""
    const d = new Date(at)
    if (Number.isNaN(d.getTime())) return ""
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  private sync(): void {
    this.model.setData({ ...this.state, agentName: this.agentName })
    this.scrollToNewest()
  }

  /**
   * Keep the newest message in view. Deferred a frame because the list has not
   * re-rendered at the moment setData returns.
   */
  private scrollToNewest(): void {
    const page = this.byId("page") as Page | undefined
    if (!page) return
    setTimeout(() => page.scrollTo(1e6, 200), 0)
  }
}
