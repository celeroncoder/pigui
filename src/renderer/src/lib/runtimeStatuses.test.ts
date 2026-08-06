import { describe, expect, it } from "vitest"
import type { SessionDetail, SessionEvent } from "../../../shared/contracts"
import { applySessionRuntimeStatus } from "./runtimeStatuses"

const sessionPath = "/sessions/current.jsonl"
const detail: SessionDetail = {
  summary: { id: "current", path: sessionPath, name: "Current", firstMessage: "", updatedAt: 1, messageCount: 0 },
  messages: [],
  model: "provider/model",
  thinkingLevel: "off",
  availableThinkingLevels: ["off"],
  backgroundProcesses: [],
  queuedMessages: [],
  runtimeStatus: "done",
  isStreaming: false,
  isCompacting: false
}

const apply = (current: ReturnType<typeof applySessionRuntimeStatus>, event: SessionEvent) => applySessionRuntimeStatus(current, event)

describe("sidebar runtime statuses", () => {
  it("updates an offscreen session from live Pi events", () => {
    let statuses = apply({}, { type: "runtime-status", sessionPath, status: "running" })
    statuses = apply(statuses, { type: "runtime-status", sessionPath, status: "waiting" })
    statuses = apply(statuses, { type: "runtime-status", sessionPath, status: "input-required" })
    statuses = apply(statuses, { type: "interaction-cleared", sessionPath, requestId: "request-1" })

    expect(statuses[sessionPath]).toBe("running")
  })

  it("uses a runtime snapshot and records session-scoped failures", () => {
    let statuses = apply({}, { type: "session-state", sessionPath, detail: { ...detail, runtimeStatus: "done" } })
    statuses = apply(statuses, { type: "error", sessionPath, message: "Pi retry failed" })

    expect(statuses[sessionPath]).toBe("failed")
  })
})
