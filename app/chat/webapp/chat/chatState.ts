import { partsToText } from "../a2a/types"
import type { A2AEvent } from "../a2a/types"

export interface ChatMessage {
  id: string
  role: "user" | "agent" | "error"
  text: string
  streaming: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  busy: boolean
  status: string
  contextId: string | null
  taskId: string | null
  pendingApproval: boolean
  streamed: boolean
}

export function initialState(): ChatState {
  return {
    messages: [],
    busy: false,
    status: "",
    contextId: null,
    taskId: null,
    pendingApproval: false,
    streamed: false,
  }
}

function push(
  state: ChatState,
  role: ChatMessage["role"],
  text: string,
  streaming = false,
): ChatState {
  const id = `${role.charAt(0)}${state.messages.length}`
  return { ...state, messages: [...state.messages, { id, role, text, streaming }] }
}

function finalize(state: ChatState): ChatState {
  if (!state.messages.some((m) => m.streaming)) return state
  return {
    ...state,
    messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
  }
}

export function appendUser(state: ChatState, text: string): ChatState {
  return {
    ...push(state, "user", text),
    busy: true,
    status: "",
    pendingApproval: false,
    streamed: false,
  }
}

export function appendError(state: ChatState, text: string): ChatState {
  return {
    ...push(finalize(state), "error", text),
    busy: false,
    status: "",
    pendingApproval: false,
  }
}

function upsertStream(state: ChatState, text: string, append: boolean): ChatState {
  const messages = [...state.messages]
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]

  if (last && last.role === "agent" && last.streaming) {
    messages[lastIndex] = { ...last, text: append ? last.text + text : text }
    return { ...state, messages, streamed: true, busy: true }
  }

  return { ...push(state, "agent", text, true), streamed: true, busy: true }
}

export function applyEvent(state: ChatState, event: A2AEvent): ChatState {
  if (event.kind === "task") {
    return { ...state, taskId: event.id, contextId: event.contextId, busy: true }
  }

  if (event.kind === "artifact-update") {
    return upsertStream(state, partsToText(event.artifact?.parts), event.append === true)
  }

  if (event.kind === "status-update") {
    const base: ChatState = {
      ...state,
      taskId: event.taskId ?? state.taskId,
      contextId: event.contextId ?? state.contextId,
    }
    const text = partsToText(event.status?.message?.parts)

    switch (event.status?.state) {
      case "working":
        return { ...base, busy: true, status: text }

      case "input-required": {
        const done = finalize(base)
        const withMessage = text && !done.streamed ? push(done, "agent", text) : done
        return { ...withMessage, busy: false, status: "", pendingApproval: true }
      }

      case "completed": {
        const done = finalize(base)
        const withMessage = text && !done.streamed ? push(done, "agent", text) : done
        return {
          ...withMessage,
          busy: false,
          status: "",
          pendingApproval: false,
          streamed: false,
        }
      }

      case "failed":
      case "canceled":
        return appendError(base, text || `Task ${event.status.state}.`)

      default:
        return base
    }
  }

  return state
}
