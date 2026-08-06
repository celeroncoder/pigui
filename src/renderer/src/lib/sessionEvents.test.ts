import { describe, expect, it } from "vitest"
import type { ChatMessage, SessionDetail, SessionEvent, ToolResultBlock } from "../../../shared/contracts"
import { reduceSessionEvent } from "../../../shared/sessionEvents"
import { buildConversationItems } from "./conversation"

const sessionPath = "/sessions/current.jsonl"

const message = (id: string, role: ChatMessage["role"], blocks: ChatMessage["blocks"]): ChatMessage => ({
  id,
  role,
  blocks,
  timestamp: 1
})

const detail = (messages: ReadonlyArray<ChatMessage> = []): SessionDetail => ({
  summary: {
    id: "session",
    path: sessionPath,
    name: "Current",
    firstMessage: "Fix it",
    updatedAt: 1,
    messageCount: messages.length
  },
  messages,
  model: "provider/model",
  thinkingLevel: "off",
  availableThinkingLevels: ["off"],
  backgroundProcesses: [],
  queuedMessages: [],
  runtimeStatus: "running",
  isStreaming: true,
  isCompacting: false
})

const apply = (current: SessionDetail, event: SessionEvent) => {
  const next = reduceSessionEvent(current, sessionPath, event)
  if (!next) throw new Error("Expected a session detail")
  return next
}

const toolResult = (current: SessionDetail, toolId: string): ToolResultBlock | undefined => current.messages
  .flatMap((item) => item.blocks)
  .find((block): block is ToolResultBlock => block.type === "tool-result" && block.id === toolId)

describe("live session event reconciliation", () => {
  it("updates tool output in place and converges with the final persisted snapshot", () => {
    let current = detail([message("user-live", "user", [{ type: "text", text: "Fix it" }])])
    current = apply(current, { type: "assistant-start", sessionPath, messageId: "assistant-live-tools", timestamp: 2 })
    current = apply(current, {
      type: "tool-start",
      sessionPath,
      messageId: "assistant-live-tools",
      tool: { id: "call-1", name: "bash", input: "{\"command\":\"npm test\"}", status: "running", startedAt: 3 }
    })
    current = apply(current, { type: "tool-update", sessionPath, toolId: "call-1", output: "first line" })

    expect(toolResult(current, "call-1")).toMatchObject({ output: "first line", status: "running", isError: false })

    current = apply(current, { type: "tool-update", sessionPath, toolId: "call-1", output: "first line\nsecond line" })
    expect(current.messages.flatMap((item) => item.blocks).filter((block) => block.type === "tool-result" && block.id === "call-1")).toHaveLength(1)
    expect(toolResult(current, "call-1")?.output).toBe("first line\nsecond line")

    current = apply(current, { type: "tool-end", sessionPath, toolId: "call-1", output: "2 tests passed", isError: false })
    current = apply(current, { type: "assistant-start", sessionPath, messageId: "assistant-live-answer", timestamp: 4 })
    current = apply(current, { type: "text-delta", sessionPath, messageId: "assistant-live-answer", delta: "Fixed." })

    expect(toolResult(current, "call-1")).toMatchObject({ output: "2 tests passed", status: "success", isError: false })
    expect(buildConversationItems(current.messages).map((item) => item.type)).toEqual(["message", "activity", "message"])

    const snapshot = detail([
      message("user-persisted", "user", [{ type: "text", text: "Fix it" }]),
      message("assistant-persisted-tools", "assistant", [
        { type: "tool-call", id: "call-1", name: "bash", input: "{\"command\":\"npm test\"}" },
        { type: "tool-result", id: "call-1", name: "bash", output: "2 tests passed", isError: false }
      ]),
      message("assistant-persisted-answer", "assistant", [{ type: "text", text: "Fixed." }])
    ])
    current = apply(current, { type: "session-state", sessionPath, detail: { ...snapshot, isStreaming: false } })

    const items = buildConversationItems(current.messages)
    expect(items.map((item) => item.type)).toEqual(["message", "activity", "message"])
    expect(current.messages.flatMap((item) => item.blocks).filter((block) => block.type === "tool-call" && block.id === "call-1")).toHaveLength(1)
    expect(toolResult(current, "call-1")?.output).toBe("2 tests passed")
    expect(current.isStreaming).toBe(false)
  })

  it("creates the associated assistant turn when tool activity arrives first", () => {
    let current = detail()
    current = apply(current, {
      type: "tool-start",
      sessionPath,
      messageId: "assistant-live-tools",
      tool: { id: "call-early", name: "read", input: "{\"path\":\"README.md\"}", status: "running", startedAt: 2 }
    })
    current = apply(current, { type: "assistant-start", sessionPath, messageId: "assistant-live-tools", timestamp: 1 })

    expect(current.messages).toHaveLength(1)
    expect(current.messages[0]).toMatchObject({ id: "assistant-live-tools", role: "assistant", timestamp: 1 })
    expect(current.messages[0]?.blocks).toEqual([
      { type: "tool-call", id: "call-early", name: "read", input: "{\"path\":\"README.md\"}" },
      { type: "tool-result", id: "call-early", name: "read", output: "", isError: false, status: "running" }
    ])
  })

  it("marks failed tools in place", () => {
    let current = detail()
    current = apply(current, {
      type: "tool-start",
      sessionPath,
      messageId: "assistant-failure",
      tool: { id: "call-failure", name: "bash", input: "{\"command\":\"exit 1\"}", status: "running", startedAt: 2 }
    })
    current = apply(current, {
      type: "tool-end",
      sessionPath,
      toolId: "call-failure",
      output: "command failed",
      isError: true
    })

    expect(toolResult(current, "call-failure")).toMatchObject({ output: "command failed", status: "error", isError: true })
  })

  it("applies queue, context, background-process, and settled-state updates", () => {
    let current = detail()
    current = apply(current, {
      type: "queue-update",
      sessionPath,
      messages: [{ id: "queued", delivery: "follow-up", text: "Continue" }]
    })
    current = apply(current, {
      type: "context-usage",
      sessionPath,
      contextUsage: { tokens: 4_000, contextWindow: 128_000, percent: 3.125 }
    })
    current = apply(current, {
      type: "background-processes",
      sessionPath,
      processes: [{
        id: "terminal-1",
        title: "Dev server",
        status: "running",
        startedAt: 2,
        updatedAt: 3,
        output: "Ready"
      }]
    })
    current = apply(current, { type: "agent-status", sessionPath, isStreaming: false })

    expect(current.queuedMessages).toEqual([{ id: "queued", delivery: "follow-up", text: "Continue" }])
    expect(current.contextUsage).toEqual({ tokens: 4_000, contextWindow: 128_000, percent: 3.125 })
    expect(current.backgroundProcesses).toEqual([expect.objectContaining({ id: "terminal-1", output: "Ready" })])
    expect(current.isStreaming).toBe(false)
  })

  it("keeps the active detail's runtime status in sync with its sidebar projection", () => {
    let current = detail()
    current = apply(current, { type: "runtime-status", sessionPath, status: "input-required" })

    expect(current.runtimeStatus).toBe("input-required")

    const other = reduceSessionEvent(current, sessionPath, { type: "runtime-status", sessionPath: "/sessions/other.jsonl", status: "failed" })
    expect(other?.runtimeStatus).toBe("input-required")
  })

  it("ignores events from a session that is no longer active", () => {
    const current = detail([message("answer", "assistant", [{ type: "text", text: "Current answer" }])])
    const next = reduceSessionEvent(current, sessionPath, {
      type: "tool-start",
      sessionPath: "/sessions/other.jsonl",
      messageId: "other-assistant",
      tool: { id: "other-call", name: "bash", status: "running", startedAt: 2 }
    })

    expect(next).toBe(current)
  })
})
