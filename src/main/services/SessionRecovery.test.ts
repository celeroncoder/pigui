import { describe, expect, it } from "vitest"
import { interruptedTransportReason, lastUserPrompt, recoveryPrompt } from "./SessionRecovery"
import { reconcileQueuedMessages } from "./PromptQueue"

describe("Pi session transport recovery", () => {
  const interrupted = [
    { role: "user", content: [{ type: "text", text: "Fix the flaky lifecycle test" }] },
    { role: "assistant", content: [{ type: "text", text: "I inspected the failure" }], stopReason: "error", errorMessage: "connection reset by peer" }
  ]

  it("detects a terminal transport error and preserves the latest user prompt", () => {
    expect(interruptedTransportReason(interrupted, false, false)).toBe("connection reset by peer")
    expect(lastUserPrompt(interrupted)).toBe("Fix the flaky lifecycle test")
  })

  it("does not interrupt for automatic retries, explicit aborts, or successful turns", () => {
    expect(interruptedTransportReason(interrupted, true, false)).toBeUndefined()
    expect(interruptedTransportReason(interrupted, false, true)).toBeUndefined()
    expect(interruptedTransportReason([{ role: "assistant", stopReason: "stop" }], false, false)).toBeUndefined()
  })

  it("maps resume, continue, and restart to distinct recovery behavior", () => {
    const recovery = { reason: "pipe reset", interruptedAt: 123, lastPrompt: "Run the tests" }
    expect(recoveryPrompt("resume", recovery)).toBeUndefined()
    expect(recoveryPrompt("continue", recovery)).toContain("last preserved session state")
    expect(recoveryPrompt("restart", recovery)).toBe("Run the tests")
  })

  it("retains steering and follow-up identity and order when a runtime queue is rebuilt", () => {
    const preserved = [
      { id: "steer-1", delivery: "steer" as const, text: "Inspect the reset" },
      { id: "steer-2", delivery: "steer" as const, text: "Preserve the partial state" },
      { id: "follow-1", delivery: "follow-up" as const, text: "Run focused tests" },
      { id: "follow-2", delivery: "follow-up" as const, text: "Summarize the result" }
    ]
    const restored = reconcileQueuedMessages(preserved, {
      steering: ["Inspect the reset", "Preserve the partial state"],
      followUp: ["Run focused tests", "Summarize the result"]
    }, () => "unexpected-new-id")

    expect(restored).toEqual(preserved)
  })
})
