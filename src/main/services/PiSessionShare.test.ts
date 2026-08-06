import { SessionManager } from "@earendil-works/pi-coding-agent"
import { describe, expect, it } from "vitest"
import { sessionShareSummary } from "./PiSessions"

const usage = {
  input: 10,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 30,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

describe("Pi session GitHub summary selection", () => {
  it("resolves a selected assistant entry from Pi's active branch", () => {
    const manager = SessionManager.inMemory("/worktree")
    manager.appendSessionInfo("Fix GitHub workflow")
    const messageId = manager.appendMessage({
      role: "assistant",
      content: [
        { type: "text", text: "Implemented the workflow." },
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "Added regression tests." }
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test-model",
      usage,
      stopReason: "stop",
      timestamp: Date.now()
    })

    expect(sessionShareSummary(manager, messageId)).toEqual({
      content: "Implemented the workflow.\n\nAdded regression tests.",
      sessionName: "Fix GitHub workflow"
    })
  })

  it("rejects user entries and unknown message ids", () => {
    const manager = SessionManager.inMemory("/worktree")
    const userId = manager.appendMessage({ role: "user", content: "Do the work", timestamp: Date.now() })
    expect(sessionShareSummary(manager, userId)).toBeUndefined()
    expect(sessionShareSummary(manager, "missing")).toBeUndefined()
  })

  it("bounds summaries by encoded size and sanitizes their public session name", () => {
    const manager = SessionManager.inMemory("/worktree")
    manager.appendSessionInfo(`GitHub\u0000 workflow ${"x".repeat(200)}`)
    const validId = manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "A bounded summary" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test-model",
      usage,
      stopReason: "stop",
      timestamp: Date.now()
    })
    const oversizedId = manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "🙂".repeat(20_000) }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test-model",
      usage,
      stopReason: "stop",
      timestamp: Date.now()
    })

    expect(sessionShareSummary(manager, validId)?.sessionName).toBe(`GitHub workflow ${"x".repeat(104)}`)
    expect(sessionShareSummary(manager, oversizedId)).toBeUndefined()
  })
})
