import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it } from "vitest"
import { createSessionFork, sessionForkMetadata } from "./SessionFork"

const temporaryDirectories: string[] = []

const createManager = () => {
  const root = mkdtempSync(join(tmpdir(), "pi-desktop-fork-"))
  temporaryDirectories.push(root)
  return SessionManager.create(root, join(root, "sessions"))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("session forks", () => {
  it("copies Pi context through the selected turn without changing the source session", () => {
    const source = createManager()
    const firstUserId = source.appendMessage({ role: "user", content: "First question", timestamp: 1 })
    const firstAssistantId = source.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "First answer" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 2
    })
    source.appendMessage({ role: "user", content: "Later question", timestamp: 3 })
    const sourcePath = source.getSessionFile()
    expect(sourcePath).toBeDefined()
    const sourceBeforeFork = readFileSync(sourcePath!, "utf8")

    const independent = SessionManager.open(sourcePath!)
    const fork = createSessionFork(independent, "Original session", firstAssistantId)
    const forked = SessionManager.open(fork.sessionPath)

    expect(readFileSync(sourcePath!, "utf8")).toBe(sourceBeforeFork)
    expect(forked.getHeader()?.parentSession).toBe(sourcePath)
    expect(forked.getBranch().filter((entry) => entry.type === "message").map((entry) => entry.id)).toEqual([firstUserId, firstAssistantId])
    expect(forked.buildSessionContext().messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(sessionForkMetadata(forked)).toEqual({
      sourceSessionId: source.getSessionId(),
      sourceSessionPath: sourcePath,
      sourceSessionName: "Original session",
      sourceMessageId: firstAssistantId,
      sourceMessageIndex: 2
    })
  })

  it("rejects tool results and messages outside the active branch", () => {
    const source = createManager()
    source.appendMessage({ role: "user", content: "Question", timestamp: 1 })
    const assistantId = source.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 2
    })
    const toolId = source.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "done" }], isError: false, timestamp: 3 })
    source.branch(assistantId)

    expect(() => createSessionFork(source, "Original session", toolId)).toThrow(/not a user or assistant turn/)
    expect(() => createSessionFork(source, "Original session", "missing-message")).toThrow(/not a user or assistant turn/)
  })

  it("retains tool results needed by a selected assistant tool-call turn", () => {
    const source = createManager()
    source.appendMessage({ role: "user", content: "Read it", timestamp: 1 })
    const assistantId = source.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 2
    })
    const toolId = source.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "contents" }], isError: false, timestamp: 3 })
    source.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Later answer" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 4
    })

    const fork = createSessionFork(SessionManager.open(source.getSessionFile()!), "Tool session", assistantId)
    const forkedMessages = SessionManager.open(fork.sessionPath).getBranch().filter((entry) => entry.type === "message")

    expect(forkedMessages.map((entry) => entry.id)).toEqual(expect.arrayContaining([assistantId, toolId]))
    expect(forkedMessages.at(-1)?.id).toBe(toolId)
  })

  it("persists a fork from the first user message before an assistant reply", async () => {
    const source = createManager()
    const firstUserId = source.appendMessage({ role: "user", content: "First question", timestamp: 1 })
    source.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Original answer" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 2
    })

    const fork = createSessionFork(SessionManager.open(source.getSessionFile()!), "Original session", firstUserId)

    expect(existsSync(fork.sessionPath)).toBe(true)
    expect(fork.manager.getBranch().filter((entry) => entry.type === "message").map((entry) => entry.id)).toEqual([firstUserId])
    expect(sessionForkMetadata(fork.manager)?.sourceMessageId).toBe(firstUserId)
    const listed = await SessionManager.list(source.getCwd(), source.getSessionDir())
    expect(listed.some((session) => session.path === fork.sessionPath)).toBe(true)

    fork.manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "New answer" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 3
    })
    const persistedEntries = parseSessionEntries(readFileSync(fork.sessionPath, "utf8"))
    expect(persistedEntries.filter((entry) => entry.type === "session")).toHaveLength(1)
    expect(SessionManager.open(fork.sessionPath).buildSessionContext().messages.map((message) => message.role)).toEqual(["user", "assistant"])
  })
})
