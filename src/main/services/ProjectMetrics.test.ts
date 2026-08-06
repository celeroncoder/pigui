import { describe, expect, it } from "vitest"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import { aggregateProjectMetrics, telemetryFromSession } from "./ProjectMetrics"

const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  total: input + output + cacheRead + cacheWrite
})

describe("project metrics aggregation", () => {
  it("uses the latest persisted turn and message-end timestamps while retaining lifetime usage", () => {
    const usage = (input: number, output: number) => ({
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    })
    const entries = [
      {
        type: "message",
        id: "user-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "first", timestamp: 1_000 }
      },
      {
        type: "message",
        id: "assistant-1",
        parentId: "user-1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "failed" }],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5",
          usage: usage(10, 2),
          stopReason: "error",
          errorMessage: "Old failure",
          timestamp: 2_000
        }
      },
      {
        type: "message",
        id: "user-2",
        parentId: "assistant-1",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: { role: "user", content: "retry", timestamp: 3_000 }
      },
      {
        type: "message",
        id: "assistant-2",
        parentId: "user-2",
        timestamp: "2026-01-01T00:00:04.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-sonnet",
          responseModel: "claude-sonnet-4",
          usage: usage(20, 4),
          stopReason: "stop",
          // Provider timestamps mark response start and must not drive turnaround.
          timestamp: 3_100
        }
      }
    ] satisfies SessionEntry[]

    expect(telemetryFromSession({
      getSessionId: () => "session-1",
      getEntries: () => entries,
      getBranch: () => entries
    })).toEqual({
      id: "session-1",
      outcome: "success",
      completionMs: 2_000,
      usage: [
        { model: "openai/gpt-5", tokens: tokens(10, 2) },
        { model: "anthropic/claude-sonnet-4", tokens: tokens(20, 4) }
      ]
    })
  })

  it("keeps session outcomes independent while aggregating usage by model", () => {
    const metrics = aggregateProjectMetrics([
      {
        id: "success",
        outcome: "success",
        completionMs: 2_000,
        usage: [
          { model: "openai/gpt-5", tokens: tokens(100, 20, 30) },
          { model: "Tools & summaries", tokens: tokens(5, 2) }
        ]
      },
      {
        id: "failure",
        outcome: "failure",
        completionMs: 4_000,
        failureReason: "Rate limit exceeded",
        usage: [{ model: "openai/gpt-5", tokens: tokens(50, 10) }]
      },
      {
        id: "incomplete",
        outcome: "incomplete",
        usage: [{ model: "anthropic/claude", tokens: tokens(20, 8) }]
      }
    ], 123)

    expect(metrics).toMatchObject({
      generatedAt: 123,
      sessionCount: 3,
      completedSessions: 2,
      successfulSessions: 1,
      failedSessions: 1,
      incompleteSessions: 1,
      successRate: 0.5,
      averageCompletionMs: 3_000,
      tokenUsage: tokens(175, 40, 30)
    })
    expect(metrics.modelUsage).toEqual([
      { model: "openai/gpt-5", sessions: 2, ...tokens(150, 30, 30) },
      { model: "anthropic/claude", sessions: 1, ...tokens(20, 8) },
      { model: "Tools & summaries", sessions: 1, ...tokens(5, 2) }
    ])
    expect(metrics.failureReasons).toEqual([{ reason: "Rate limit exceeded", count: 1 }])
  })

  it("does not reuse an older failure after a newer tool-use response or during an active retry", () => {
    const usage = {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
    const entries = [
      {
        type: "message",
        id: "user",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "retry", timestamp: 1_000 }
      },
      {
        type: "message",
        id: "error",
        parentId: "user",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "failed" }],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5",
          usage,
          stopReason: "error",
          errorMessage: "Transient failure",
          timestamp: 1_100
        }
      },
      {
        type: "message",
        id: "tool-use",
        parentId: "error",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "README.md" } }],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5",
          usage,
          stopReason: "toolUse",
          timestamp: 1_500
        }
      }
    ] satisfies SessionEntry[]
    const manager = { getSessionId: () => "retry", getEntries: () => entries, getBranch: () => entries }

    expect(telemetryFromSession(manager)).toMatchObject({ outcome: "incomplete" })
    expect(telemetryFromSession({ ...manager, getBranch: () => entries.slice(0, 2) }, true)).toMatchObject({ outcome: "incomplete" })
  })

  it("reports null rates and turnaround when no session has completed", () => {
    expect(aggregateProjectMetrics([{ id: "new", outcome: "incomplete", usage: [] }], 1)).toMatchObject({
      successRate: null,
      averageCompletionMs: null,
      completedSessions: 0,
      incompleteSessions: 1
    })
  })
})
