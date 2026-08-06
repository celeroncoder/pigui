import type { AskUserInteractionRequest, SessionDetail, SessionEvent, SessionSummary } from "../../../shared/contracts"
import { reduceSessionEvent } from "../../../shared/sessionEvents"

export interface LiveThinking {
  readonly messageId: string
  readonly text: string
}

export type AnimationFrameScheduler = (callback: FrameRequestCallback) => number
export type AnimationFrameCanceller = (handle: number) => void

export interface SessionEventBatcher {
  readonly enqueue: (event: SessionEvent) => void
  readonly flush: () => void
  readonly cancel: () => void
}

/**
 * Pi emits incremental content and tool output in order. Adjacent updates to
 * the same target can be represented by a single event without changing the
 * eventual session projection, which keeps dense streams cheap to render.
 */
export const coalesceSessionEvents = (events: ReadonlyArray<SessionEvent>): ReadonlyArray<SessionEvent> => {
  const coalesced: SessionEvent[] = []
  for (const event of events) {
    const previous = coalesced.at(-1)
    if (event.type === "text-delta" && previous?.type === "text-delta" && previous.sessionPath === event.sessionPath && previous.messageId === event.messageId) {
      coalesced[coalesced.length - 1] = { ...previous, delta: `${previous.delta}${event.delta}` }
      continue
    }
    if (event.type === "thinking-delta" && previous?.type === "thinking-delta" && previous.sessionPath === event.sessionPath && previous.messageId === event.messageId) {
      coalesced[coalesced.length - 1] = { ...previous, delta: `${previous.delta}${event.delta}` }
      continue
    }
    if (previous?.type === "tool-update" && event.type === "tool-update" && previous.sessionPath === event.sessionPath && previous.toolId === event.toolId) {
      coalesced[coalesced.length - 1] = event
      continue
    }
    coalesced.push(event)
  }
  return coalesced
}

export const createSessionEventBatcher = (
  onFlush: (events: ReadonlyArray<SessionEvent>) => void,
  requestFrame: AnimationFrameScheduler,
  cancelFrame: AnimationFrameCanceller
): SessionEventBatcher => {
  let queued: SessionEvent[] = []
  let frame: number | undefined

  const flush = () => {
    if (frame !== undefined) {
      cancelFrame(frame)
      frame = undefined
    }
    if (queued.length === 0) return
    const events = coalesceSessionEvents(queued)
    queued = []
    onFlush(events)
  }

  return {
    enqueue: (event) => {
      queued.push(event)
      if (frame === undefined) frame = requestFrame(() => flush())
    },
    flush,
    cancel: () => {
      if (frame !== undefined) cancelFrame(frame)
      frame = undefined
      queued = []
    }
  }
}

export const reduceSessionEventBatch = (
  current: SessionDetail | null,
  activeSessionPath: string | null,
  events: ReadonlyArray<SessionEvent>
): SessionDetail | null => events.reduce(
  (detail, event) => reduceSessionEvent(detail, activeSessionPath, event),
  current
)

export const reduceLiveThinkingBatch = (
  current: LiveThinking | null,
  activeSessionPath: string | null,
  events: ReadonlyArray<SessionEvent>
): LiveThinking | null => {
  let next = current
  for (const event of events) {
    if (!("sessionPath" in event) || event.sessionPath !== activeSessionPath) continue
    if (event.type === "assistant-start" || event.type === "text-delta" || event.type === "session-state" || (event.type === "agent-status" && !event.isStreaming)) {
      next = null
    } else if (event.type === "thinking-delta") {
      next = {
        messageId: event.messageId,
        text: `${next?.messageId === event.messageId ? next.text : ""}${event.delta}`
      }
    }
  }
  return next
}

export const reduceInteractionRequestBatch = (
  current: AskUserInteractionRequest | null,
  activeSessionPath: string | null,
  events: ReadonlyArray<SessionEvent>
): AskUserInteractionRequest | null => {
  let next = current
  for (const event of events) {
    if (!("sessionPath" in event) || event.sessionPath !== activeSessionPath) continue
    if (event.type === "interaction-request") next = event.request
    if (event.type === "interaction-cleared" && next?.requestId === event.requestId) next = null
    if (event.type === "session-state") next = event.detail.interactionRequest ?? null
  }
  return next
}

export const latestSessionSummary = (
  activeSessionPath: string | null,
  events: ReadonlyArray<SessionEvent>
): SessionSummary | undefined => {
  let summary: SessionSummary | undefined
  for (const event of events) {
    if (event.type === "session-state" && event.sessionPath === activeSessionPath) summary = event.detail.summary
  }
  return summary
}

export const hasSessionDetailUpdate = (activeSessionPath: string | null, events: ReadonlyArray<SessionEvent>): boolean =>
  events.some((event) => "sessionPath" in event && event.type !== "error" && event.type !== "thinking-delta" && event.type !== "interaction-request" && event.type !== "interaction-cleared" && event.sessionPath === activeSessionPath)

export const shouldRefreshSubagents = (activeSessionPath: string | null, events: ReadonlyArray<SessionEvent>): boolean =>
  events.some((event) => event.type === "tool-start" && event.sessionPath === activeSessionPath && event.tool.name === "subagent_spawn")

export const resetsInteractionSubmitting = (activeSessionPath: string | null, events: ReadonlyArray<SessionEvent>): boolean =>
  events.some((event) => (event.type === "interaction-request" || event.type === "interaction-cleared") && event.sessionPath === activeSessionPath)
