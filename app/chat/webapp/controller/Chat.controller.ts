import Controller from "sap/ui/core/mvc/Controller"
import JSONModel from "sap/ui/model/json/JSONModel"
import Component from "sap/ui/core/Component"

export default class Chat extends Controller {
  protected model!: JSONModel
  protected agentUrl!: string

  public onInit(): void {
    const owner = this.getOwnerComponent() as Component
    this.agentUrl = owner.getManifestEntry("/sap.ui5/config/agentUrl") as unknown as string

    this.model = new JSONModel({ agentName: "connecting…" })
    this.getView()?.setModel(this.model, "chat")

    void this.loadAgentCard()
  }

  private async loadAgentCard(): Promise<void> {
    try {
      const res = await fetch(`${this.agentUrl}/.well-known/agent-card.json`)
      const card = (await res.json()) as { name?: string }
      this.model.setProperty("/agentName", card.name ?? "Agent")
    } catch {
      this.model.setProperty("/agentName", "unavailable")
    }
  }
}
