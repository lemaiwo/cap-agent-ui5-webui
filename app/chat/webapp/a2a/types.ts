export interface TextPart {
  kind: "text"
  text: string
}

export type Part = TextPart | { kind: string; [key: string]: unknown }

export interface AgentMessage {
  kind: "message"
  messageId: string
  role: "user" | "agent"
  parts: Part[]
  taskId?: string
  contextId?: string
}

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"

export interface TaskStatus {
  state: TaskState
  message?: AgentMessage
  timestamp?: string
}

export interface Artifact {
  artifactId: string
  parts: Part[]
}

export interface Task {
  kind: "task"
  id: string
  contextId: string
  status: TaskStatus
  artifacts?: Artifact[]
  history?: AgentMessage[]
}

export interface StatusUpdate {
  kind: "status-update"
  taskId: string
  contextId: string
  status: TaskStatus
  final: boolean
}

export interface ArtifactUpdate {
  kind: "artifact-update"
  taskId: string
  contextId: string
  append?: boolean
  lastChunk?: boolean
  artifact: Artifact
}

export type A2AEvent = Task | StatusUpdate | ArtifactUpdate

export interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0"
  id: string | number | null
  result?: T
  error?: { code: number; message: string }
}

export interface AgentCard {
  name: string
  description?: string
  url: string
  version: string
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  skills?: { id: string; name: string; description?: string }[]
}

export function partsToText(parts: Part[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join("")
}
