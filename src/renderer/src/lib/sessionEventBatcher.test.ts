import { describe, expect, it } from "vitest"
import type { AskUserInteractionRequest, SessionDetail, SessionEvent } from "../../../shared/contracts"
import { coalesceSessionEvents, createSessionEventBatcher, latestSessionSummary, reduceInteractionRequestBatch, reduceLiveThinkingBatch, reduceSessionEventBatch, type LiveThinking } from "./sessionEventBatcher"

const sessionPath = "/sessions/current.jsonl"

const detail = (): SessionDetail => ({
  summary: { id: "current", path: sessionPath, name: "Current", firstMessage: "", updatedAt: 1, messageCount: 0 },
  messages: [],
  model: "provider/model",
  thinkingLevel: "off",
  availableThinkingLevels: ["off"],
  backgroundProcesses: [],
  queuedMessages: [],
  runtimeStatus: "done",
  isStreaming: true,
  isCompacting: false
})

describe("session event batching", () => {
  it("coalesces a dense streaming burst into one ordered animation-frame flush", () => {
    const flushed: SessionEvent[][] = []
    let scheduled: FrameRequestCallback | undefined
    const batcher = createSessionEventBatcher(
      (events) => flushed.push([...events]),
      (callback) => {
        scheduled = callback
        return 1
      },
      () => undefined
    )
    const events: SessionEvent[] = [
      { type: "assistant-start", sessionPath, messageId: "assistant", timestamp: 1 },
      ...Array.from({ length: 80 }, (_, index): SessionEvent => ({ type: "text-delta", sessionPath, messageId: "assistant", delta: String(index) })),
      { type: "tool-start", sessionPath, messageId: "assistant", tool: { id: "tool", name: "bash", status: "running", startedAt: 2 } },
      ...Array.from({ length: 80 }, (_, index): SessionEvent => ({ type: "tool-update", sessionPath, toolId: "tool", output: `line ${index}` })),
      { type: "tool-end", sessionPath, toolId: "tool", output: "complete", isError: false }
    ]

    for (const event of events) batcher.enqueue(event)

    expect(flushed).toEqual([])
    expect(scheduled).toBeTypeOf("function")
    scheduled?.(0)

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toHaveLength(5)
    expect(flushed[0]?.map((event) => event.type)).toEqual(["assistant-start", "text-delta", "tool-start", "tool-update", "tool-end"])
    expect(reduceSessionEventBatch(detail(), sessionPath, flushed[0] ?? [])).toEqual(reduceSessionEventBatch(detail(), sessionPath, events))
  })

  it("keeps ordering boundaries that change the resulting projection", () => {
    const events: SessionEvent[] = [
      { type: "assistant-start", sessionPath, messageId: "first", timestamp: 1 },
      { type: "text-delta", sessionPath, messageId: "first", delta: "one" },
      { type: "tool-start", sessionPath, messageId: "first", tool: { id: "tool", name: "bash", status: "running", startedAt: 2 } },
      { type: "text-delta", sessionPath, messageId: "first", delta: "two" },
      { type: "tool-update", sessionPath, toolId: "tool", output: "first" },
      { type: "tool-update", sessionPath, toolId: "tool", output: "second" }
    ]

    expect(coalesceSessionEvents(events).map((event) => event.type)).toEqual([
      "assistant-start", "text-delta", "tool-start", "text-delta", "tool-update"
    ])
    expect(reduceSessionEventBatch(detail(), sessionPath, coalesceSessionEvents(events))).toEqual(reduceSessionEventBatch(detail(), sessionPath, events))
  })

  it("drops queued work when the renderer subscription is disposed", () => {
    const flushed: SessionEvent[][] = []
    const cancelled: number[] = []
    let scheduled: FrameRequestCallback | undefined
    const batcher = createSessionEventBatcher(
      (events) => flushed.push([...events]),
      (callback) => {
        scheduled = callback
        return 7
      },
      (handle) => cancelled.push(handle)
    )

    batcher.enqueue({ type: "text-delta", sessionPath, messageId: "assistant", delta: "discard me" })
    batcher.cancel()
    scheduled?.(0)

    expect(cancelled).toEqual([7])
    expect(flushed).toEqual([])
  })

  it("reconciles thinking, interaction, and snapshots in their original order", () => {
    const request: AskUserInteractionRequest = {
      requestId: "request",
      toolCallId: "tool",
      question: "Continue?",
      options: [{ label: "Yes" }, { label: "No" }]
    }
    const events: SessionEvent[] = [
      { type: "thinking-delta", sessionPath, messageId: "assistant", delta: "Thinking" },
      { type: "interaction-request", sessionPath, request },
      { type: "thinking-delta", sessionPath, messageId: "assistant", delta: " harder" },
      { type: "interaction-cleared", sessionPath, requestId: request.requestId },
      { type: "session-state", sessionPath, detail: { ...detail(), summary: { ...detail().summary, name: "Fresh" }, interactionRequest: request } }
    ]
    const thinking: LiveThinking = { messageId: "previous", text: "old" }

    expect(reduceLiveThinkingBatch(thinking, sessionPath, coalesceSessionEvents(events))).toBeNull()
    expect(reduceInteractionRequestBatch(null, sessionPath, coalesceSessionEvents(events))).toEqual(request)
    expect(latestSessionSummary(sessionPath, coalesceSessionEvents(events))).toMatchObject({ name: "Fresh" })
  })
})
