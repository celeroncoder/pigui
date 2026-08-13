import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import type { SessionDetail, SessionEvent } from "../../shared/contracts"
import { reduceSessionEvent } from "../../shared/sessionEvents"
import { PiSessionLifecycleGate, releaseAllEntries, releaseInactiveEntriesExcept, releaseSessionResources } from "./PiSessionLifecycle"

interface FakeSession {
  readonly path: string
  running: boolean
  promptStartsPending: number
  backgroundRunning?: boolean
}

const retained = (session: FakeSession) => session.running || session.promptStartsPending > 0 || session.backgroundRunning === true

const detail = (path: string): SessionDetail => ({
  summary: {
    id: path,
    path,
    name: path,
    firstMessage: "",
    updatedAt: 1,
    messageCount: 0
  },
  messages: [],
  model: "provider/model",
  thinkingLevel: "off",
  availableThinkingLevels: ["off"],
  backgroundProcesses: [],
  queuedMessages: [],
  runtimeStatus: "running",
  isStreaming: true,
  isCompacting: false
})

const apply = (current: SessionDetail, activePath: string, event: SessionEvent): SessionDetail => {
  const next = reduceSessionEvent(current, activePath, event)
  if (!next) throw new Error("Expected a session detail")
  return next
}

describe("Pi session lifecycle", () => {
  it("permanently rejects new runtime creation after shutdown begins", async () => {
    const gate = new PiSessionLifecycleGate()
    await expect(Effect.runPromise(gate.ensureAvailable("open Pi session"))).resolves.toBeUndefined()

    gate.close()

    await expect(Effect.runPromise(gate.ensureAvailable("open Pi session"))).rejects.toMatchObject({
      _tag: "AppError",
      operation: "open Pi session",
      message: "Pi Desktop is shutting down"
    })
  })

  it("keeps a running session alive while another session is selected", async () => {
    const sessionA: FakeSession = { path: "session-a", running: true, promptStartsPending: 0 }
    const sessionB: FakeSession = { path: "session-b", running: false, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])
    const released: string[] = []

    await releaseInactiveEntriesExcept(sessions, sessionB.path, retained, async (session) => {
      released.push(session.path)
    })

    expect(sessions.has(sessionA.path)).toBe(true)
    expect(released).toEqual([])

    sessionA.running = false
    await releaseInactiveEntriesExcept(sessions, sessionA.path, retained, async (session) => {
      released.push(session.path)
    })

    expect(sessions.has(sessionA.path)).toBe(true)
    expect(sessions.has(sessionB.path)).toBe(false)
    expect(released).toEqual([sessionB.path])
  })

  it("retains a session while its prompt is starting during a fast switch", async () => {
    const sessionA: FakeSession = { path: "session-a", running: false, promptStartsPending: 1 }
    const sessionB: FakeSession = { path: "session-b", running: false, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])
    const released: string[] = []

    await releaseInactiveEntriesExcept(sessions, sessionB.path, retained, async (session) => {
      released.push(session.path)
    })
    expect(sessions.has(sessionA.path)).toBe(true)

    sessionA.promptStartsPending = 0
    await releaseInactiveEntriesExcept(sessions, "session-c", retained, async (session) => {
      released.push(session.path)
    })

    expect(released).toEqual([sessionA.path, sessionB.path])
    expect(sessions.size).toBe(0)
  })

  it("retains an offscreen session while its background terminal is active", async () => {
    const sessionA: FakeSession = { path: "session-a", running: false, promptStartsPending: 0, backgroundRunning: true }
    const sessionB: FakeSession = { path: "session-b", running: false, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])

    await releaseInactiveEntriesExcept(sessions, sessionB.path, retained, async () => undefined)
    expect(sessions.has(sessionA.path)).toBe(true)

    sessionA.backgroundRunning = false
    await releaseInactiveEntriesExcept(sessions, "session-c", retained, async () => undefined)
    expect(sessions.size).toBe(0)
  })

  it("attempts every inactive release and reports all failures", async () => {
    const sessionA: FakeSession = { path: "session-a", running: false, promptStartsPending: 0 }
    const sessionB: FakeSession = { path: "session-b", running: false, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])
    const released: string[] = []

    const release = releaseInactiveEntriesExcept(sessions, "session-c", retained, (session) => {
      released.push(session.path)
      throw new Error(`failed-${session.path}`)
    })

    await expect(release).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: "failed-session-a" }), expect.objectContaining({ message: "failed-session-b" })]
    })
    expect(released).toEqual([sessionA.path, sessionB.path])
    expect(sessions.size).toBe(0)
  })

  it("clears all tracked sessions while attempting every shutdown", async () => {
    const sessionA: FakeSession = { path: "session-a", running: true, promptStartsPending: 0 }
    const sessionB: FakeSession = { path: "session-b", running: true, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])
    const released: string[] = []

    await expect(releaseAllEntries(sessions, (session) => {
      released.push(session.path)
      if (session === sessionA) throw new Error("first session failed")
      return Promise.resolve()
    })).rejects.toThrow("Failed to dispose Pi sessions")

    expect(released).toEqual([sessionA.path, sessionB.path])
    expect(sessions.size).toBe(0)
  })

  it("disposes the Pi runtime even when host-owned cleanup fails", async () => {
    const disposed: string[] = []
    const release = releaseSessionResources({
      disposeInteraction: () => {
        disposed.push("interaction")
        throw new Error("interaction failed")
      },
      unsubscribe: () => {
        disposed.push("unsubscribe")
        throw new Error("unsubscribe failed")
      },
      disposeRuntime: async () => {
        disposed.push("runtime")
      },
      disposeSession: () => disposed.push("session-fallback")
    })

    await expect(release).rejects.toThrow("interaction failed")
    expect(disposed).toEqual(["interaction", "unsubscribe", "runtime"])
  })

  it("falls back to synchronous Pi session disposal when runtime disposal fails", async () => {
    const disposed: string[] = []
    await expect(releaseSessionResources({
      disposeInteraction: () => disposed.push("interaction"),
      unsubscribe: () => disposed.push("unsubscribe"),
      disposeRuntime: async () => {
        disposed.push("runtime")
        throw new Error("runtime failed")
      },
      disposeSession: () => disposed.push("session-fallback")
    })).rejects.toThrow("runtime failed")

    expect(disposed).toEqual(["interaction", "unsubscribe", "runtime", "session-fallback"])
  })

  it("preserves session A activity while B is visible and restores it when A is reopened", async () => {
    const sessionA: FakeSession = { path: "session-a", running: true, promptStartsPending: 0 }
    const sessionB: FakeSession = { path: "session-b", running: false, promptStartsPending: 0 }
    const sessions = new Map([[sessionA.path, sessionA], [sessionB.path, sessionB]])
    await releaseInactiveEntriesExcept(sessions, sessionB.path, retained, async () => undefined)

    let cachedA = detail(sessionA.path)
    let visibleB = detail(sessionB.path)
    const toolStart: SessionEvent = {
      type: "tool-start",
      sessionPath: sessionA.path,
      messageId: "assistant-a",
      tool: { id: "tool-a", name: "bash", input: "{\"command\":\"npm test\"}", status: "running", startedAt: 2 }
    }
    const toolUpdate: SessionEvent = {
      type: "tool-update",
      sessionPath: sessionA.path,
      toolId: "tool-a",
      output: "Tests are running"
    }

    cachedA = apply(cachedA, sessionA.path, toolStart)
    cachedA = apply(cachedA, sessionA.path, toolUpdate)
    visibleB = apply(visibleB, sessionB.path, toolStart)
    visibleB = apply(visibleB, sessionB.path, toolUpdate)

    expect(visibleB.messages).toEqual([])
    expect(cachedA.messages).toHaveLength(1)
    expect(cachedA.messages[0]?.blocks).toEqual([
      { type: "tool-call", id: "tool-a", name: "bash", input: "{\"command\":\"npm test\"}" },
      { type: "tool-result", id: "tool-a", name: "bash", output: "Tests are running", isError: false, status: "running" }
    ])
  })
})
