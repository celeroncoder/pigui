import type { SessionEvent, SessionRuntimeStatus } from "../../../shared/contracts"

export type SessionRuntimeStatuses = Readonly<Record<string, SessionRuntimeStatus>>

/** Retains runtime state for every open Pi session, including offscreen sessions. */
export const applySessionRuntimeStatus = (current: SessionRuntimeStatuses, event: SessionEvent) => {
  if (event.type === "runtime-status") return { ...current, [event.sessionPath]: event.status }
  if (event.type === "session-state") return { ...current, [event.sessionPath]: event.detail.runtimeStatus }
  if (event.type === "interaction-cleared") return { ...current, [event.sessionPath]: "running" as const }
  if (event.type === "error" && event.sessionPath) return { ...current, [event.sessionPath]: "failed" as const }
  return current
}
