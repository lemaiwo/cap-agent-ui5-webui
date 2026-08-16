import { parseSSE } from "./sse"
import type { A2AEvent, AgentCard, JsonRpcEnvelope } from "./types"

export interface SendParams {
  text: string
  contextId?: string | null
  taskId?: string | null
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export class A2AClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  public async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent-card.json`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`Agent card request failed: ${res.status}`)
    return (await res.json()) as AgentCard
  }

  public async streamMessage(
    params: SendParams,
    onEvent: (event: A2AEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: this.envelope("message/stream", params),
      signal,
    })

    if (!res.ok || !res.body) {
      const envelope = (await res.json().catch(() => null)) as JsonRpcEnvelope<never> | null
      throw new Error(envelope?.error?.message ?? `Request failed: ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const parsed = parseSSE(buffer, decoder.decode(value, { stream: true }))
      buffer = parsed.rest

      for (const frame of parsed.frames) {
        const envelope = JSON.parse(frame.data) as JsonRpcEnvelope<A2AEvent>
        if (envelope.error) throw new Error(envelope.error.message)
        if (envelope.result) onEvent(envelope.result)
      }
    }
  }

  public async cancel(taskId: string): Promise<void> {
    await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: newId(),
        method: "tasks/cancel",
        params: { id: taskId },
      }),
    }).catch(() => undefined)
  }

  private envelope(method: string, params: SendParams): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: newId(),
      method,
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: newId(),
          parts: [{ kind: "text", text: params.text }],
          ...(params.contextId ? { contextId: params.contextId } : {}),
          ...(params.taskId ? { taskId: params.taskId } : {}),
        },
      },
    })
  }
}
