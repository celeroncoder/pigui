import { resolve } from "node:path"
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager
} from "@earendil-works/pi-coding-agent"
import type { AgentSession, AgentSessionRuntime, CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent"
import { Context, Effect, Layer, Semaphore } from "effect"
import type { BackgroundProcess, BackgroundProcessStatus, ChatMessage, MessageBlock, ModelOption, SessionDetail, SessionSummary, ThinkingLevel, ToolResultBlock } from "../../shared/contracts"
import { AppError, toAppError } from "./AppError"
import { GitContext } from "./GitContext"
import { WindowBus } from "./WindowBus"

const canonicalPath = (value: string) => resolve(value)

interface ActiveSession {
  readonly cwd: string
  readonly runtime: AgentSessionRuntime
  readonly session: AgentSession
  unsubscribe: () => void
  readonly backgroundProcesses: Map<string, BackgroundProcess>
  readonly pendingTools: Map<string, { readonly name: string; readonly args: unknown }>
  liveMessageId: string | null
  gitRefreshTimer: ReturnType<typeof setTimeout> | undefined
  gitRefreshGeneration: number
  disposed: boolean
}

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const diffFromResult = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("details" in value)) return undefined
  const details = value.details
  if (typeof details !== "object" || details === null || !("diff" in details) || typeof details.diff !== "string") return undefined
  return details.diff
}

const textFromContent = (content: string | ReadonlyArray<{ readonly type: string; readonly text?: string }>) => {
  if (typeof content === "string") return content
  return content.flatMap((block) => block.type === "text" && block.text ? [block.text] : []).join("\n")
}

type PiMessage = AgentSession["messages"][number]

const timestampValue = (value: string | number): number => typeof value === "number" ? value : new Date(value).getTime()

const appendMessageToChat = (output: ChatMessage[], message: PiMessage, id: string) => {
  if (message.role === "user") {
    output.push({ id, role: "user", blocks: [{ type: "text", text: textFromContent(message.content) }], timestamp: message.timestamp })
    return
  }
  if (message.role === "assistant") {
    const blocks: MessageBlock[] = []
    for (const block of message.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text })
      } else if (block.type === "toolCall") {
        blocks.push({ type: "tool-call", id: block.id, name: block.name, input: stringify(block.arguments) })
      }
    }
    output.push({ id, role: "assistant", blocks, timestamp: message.timestamp, model: message.model, provider: message.provider })
    return
  }
  if (message.role === "toolResult") {
    const diff = diffFromResult(message)
    const result: ToolResultBlock = {
      type: "tool-result",
      id: message.toolCallId,
      name: message.toolName,
      output: textFromContent(message.content),
      isError: message.isError,
      ...(diff ? { diff } : {})
    }
    const assistantIndex = output.findLastIndex((candidate) => candidate.role === "assistant" && candidate.blocks.some((block) => block.type === "tool-call" && block.id === message.toolCallId))
    if (assistantIndex >= 0) {
      const assistant = output[assistantIndex]
      if (assistant) output[assistantIndex] = { ...assistant, blocks: [...assistant.blocks, result] }
    } else {
      output.push({ id, role: "tool", blocks: [result], timestamp: message.timestamp })
    }
    return
  }
  if (message.role === "bashExecution") {
    output.push({
      id,
      role: "system",
      blocks: [{ type: "tool-result", id, name: "bash", output: message.output, isError: (message.exitCode ?? 0) !== 0 }],
      timestamp: message.timestamp
    })
    return
  }
  if (message.role === "branchSummary") {
    output.push({ id, role: "system", blocks: [{ type: "text", text: message.summary }], timestamp: message.timestamp })
    return
  }
  if (message.role === "compactionSummary") {
    output.push({ id, role: "system", blocks: [{ type: "compaction", status: "compacted" }], timestamp: message.timestamp })
    return
  }
  if (message.role === "custom" && message.display) {
    output.push({ id, role: "system", blocks: [{ type: "text", text: textFromContent(message.content) }], timestamp: message.timestamp })
  }
}

const historyToChat = (manager: SessionManager): ReadonlyArray<ChatMessage> => {
  const output: ChatMessage[] = []
  for (const entry of manager.getBranch()) {
    if (entry.type === "message") {
      appendMessageToChat(output, entry.message, entry.id)
    } else if (entry.type === "compaction") {
      output.push({
        id: entry.id,
        role: "system",
        blocks: [{ type: "compaction", status: "compacted" }],
        timestamp: timestampValue(entry.timestamp)
      })
    }
  }
  return output
}

const recordValue = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : undefined
const stringValue = (value: unknown): string | undefined => typeof value === "string" ? value : undefined
const numberValue = (value: unknown): number | undefined => typeof value === "number" ? value : undefined
const thinkingLevelValue = (value: unknown): ThinkingLevel =>
  value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : "off"

const resultText = (value: unknown): string | undefined => {
  const record = recordValue(value)
  if (!record || !Array.isArray(record.content)) return undefined
  const lines = record.content.flatMap((item) => {
    const block = recordValue(item)
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : []
  })
  return lines.length > 0 ? lines.join("\n") : undefined
}

const processStatus = (value: unknown): BackgroundProcessStatus | undefined => {
  if (value === "running" || value === "done" || value === "failed" || value === "killed" || value === "stopped") return value
  return undefined
}

const sortedProcesses = (processes: ReadonlyMap<string, BackgroundProcess>): ReadonlyArray<BackgroundProcess> =>
  [...processes.values()].sort((left, right) => right.startedAt - left.startedAt)

const runningProcesses = (processes: ReadonlyMap<string, BackgroundProcess>): ReadonlyArray<BackgroundProcess> =>
  sortedProcesses(processes).filter((process) => process.status === "running")

const updateProcess = (processes: Map<string, BackgroundProcess>, id: string, patch: Partial<BackgroundProcess>, at: number) => {
  const current = processes.get(id)
  // A Pi background-terminal id cannot return to running once it has settled.
  // Ignore an older status/list result that arrives after the completion event.
  const status = patch.status === "running" && current && current.status !== "running"
    ? current.status
    : patch.status ?? current?.status ?? "running"
  processes.set(id, {
    id,
    title: patch.title ?? current?.title ?? `Terminal ${id}`,
    status,
    startedAt: patch.startedAt ?? current?.startedAt ?? at,
    updatedAt: at,
    ...(patch.command ?? current?.command ? { command: patch.command ?? current?.command } : {}),
    ...(patch.cwd ?? current?.cwd ? { cwd: patch.cwd ?? current?.cwd } : {}),
    ...(patch.pid ?? current?.pid ? { pid: patch.pid ?? current?.pid } : {}),
    ...(patch.output ?? current?.output ? { output: patch.output ?? current?.output } : {}),
    ...(patch.exitCode ?? current?.exitCode !== undefined ? { exitCode: patch.exitCode ?? current?.exitCode } : {}),
    ...(patch.signal ?? current?.signal ? { signal: patch.signal ?? current?.signal } : {})
  })
}

const applyBackgroundToolResult = (
  processes: Map<string, BackgroundProcess>,
  toolName: string,
  args: unknown,
  result: unknown,
  at: number
) => {
  const resultRecord = recordValue(result)
  const details = recordValue(resultRecord?.details)
  const argsRecord = recordValue(args)
  const output = resultText(result)

  if (toolName === "bg_start") {
    const id = stringValue(details?.id)
    if (!id) return
    updateProcess(processes, id, {
      title: stringValue(details?.title) ?? stringValue(argsRecord?.title) ?? `Terminal ${id}`,
      command: stringValue(argsRecord?.command),
      cwd: stringValue(details?.cwd) ?? stringValue(argsRecord?.working_dir),
      pid: numberValue(details?.pid),
      status: "running",
      output
    }, at)
    return
  }

  if (toolName === "bg_status") {
    const id = stringValue(details?.id)
    if (!id) return
    updateProcess(processes, id, {
      status: processStatus(details?.status),
      pid: numberValue(details?.pid),
      exitCode: numberValue(details?.exitCode),
      signal: stringValue(details?.signal),
      output
    }, at)
    return
  }

  if (toolName === "bg_list" && Array.isArray(details?.terminals)) {
    const listed = new Set<string>()
    for (const item of details.terminals) {
      const terminal = recordValue(item)
      const id = stringValue(terminal?.id)
      if (!id) continue
      listed.add(id)
      updateProcess(processes, id, {
        title: stringValue(terminal?.title),
        status: processStatus(terminal?.status),
        pid: numberValue(terminal?.pid)
      }, at)
    }
    // The extension never prunes a live child. If an id that we thought was
    // running is missing from its authoritative list, it cannot still run.
    for (const [id, process] of processes) {
      if (process.status === "running" && !listed.has(id)) {
        updateProcess(processes, id, { status: "stopped" }, at)
      }
    }
    return
  }

  if (toolName === "bg_kill" && Array.isArray(details?.results)) {
    for (const item of details.results) {
      const terminal = recordValue(item)
      const id = stringValue(terminal?.id)
      if (!id) continue
      updateProcess(processes, id, {
        title: stringValue(terminal?.title),
        status: processStatus(terminal?.status) ?? "killed",
        output
      }, at)
    }
  }
}

const applyBackgroundResultMessage = (processes: Map<string, BackgroundProcess>, message: unknown, at: number) => {
  const record = recordValue(message)
  if (record?.role !== "custom" || record.customType !== "background-terminal-result") return
  const details = recordValue(record.details)
  const id = stringValue(details?.id)
  if (!id) return
  updateProcess(processes, id, {
    title: stringValue(details?.title),
    status: processStatus(details?.status),
    exitCode: numberValue(details?.exitCode),
    signal: stringValue(details?.signal),
    output: typeof record.content === "string" ? record.content : undefined
  }, at)
}

const historicalBackgroundProcesses = (manager: SessionManager): Map<string, BackgroundProcess> => {
  const processes = new Map<string, BackgroundProcess>()
  const pending = new Map<string, { readonly name: string; readonly args: unknown }>()
  for (const entry of manager.getBranch()) {
    if (entry.type !== "message") continue
    const at = timestampValue(entry.timestamp)
    if (entry.message.role === "assistant") {
      for (const block of entry.message.content) {
        if (block.type === "toolCall" && block.name.startsWith("bg_")) pending.set(block.id, { name: block.name, args: block.arguments })
      }
    } else if (entry.message.role === "toolResult" && entry.message.toolName.startsWith("bg_")) {
      const call = pending.get(entry.message.toolCallId)
      applyBackgroundToolResult(processes, entry.message.toolName, call?.args, entry.message, at)
    } else {
      applyBackgroundResultMessage(processes, entry.message, at)
    }
  }
  for (const [id, process] of processes) {
    if (process.status === "running") processes.set(id, { ...process, status: "stopped" })
  }
  return processes
}

type PiSessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number]

const inferSubagentParents = (cwd: string, infos: ReadonlyArray<PiSessionInfo>) => {
  const matches = new Map<string, string>()
  const children = infos.filter((info) => info.name?.toLocaleLowerCase().startsWith("subagent:"))

  for (const parent of infos) {
    try {
      const manager = SessionManager.open(parent.path, undefined, parent.cwd || cwd)
      for (const entry of manager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue
        for (const block of entry.message.content) {
          if (block.type !== "toolCall" || block.name !== "subagent_spawn") continue
          const args: unknown = block.arguments
          if (typeof args !== "object" || args === null || !("name" in args) || !("prompt" in args)) continue
          if (typeof args.name !== "string" || typeof args.prompt !== "string") continue
          if ("harness" in args && args.harness !== undefined && args.harness !== "pi") continue

          const expectedName = `subagent: ${args.name.trim()}`.toLocaleLowerCase()
          const expectedPrompt = args.prompt.trim()
          const parentCwd = parent.cwd || cwd
          const expectedCwd = "working_dir" in args && typeof args.working_dir === "string" ? resolve(parentCwd, args.working_dir) : parentCwd
          const spawnedAt = new Date(entry.timestamp).getTime()
          const candidates = children.filter((child) => {
            const distance = child.created.getTime() - spawnedAt
            return child.name?.trim().toLocaleLowerCase() === expectedName
              && child.firstMessage.trim() === expectedPrompt
              && resolve(child.cwd || cwd) === expectedCwd
              && distance >= -2_000
              && distance <= 60_000
          })
          if (candidates.length === 1 && candidates[0]) matches.set(candidates[0].path, parent.path)
        }
      }
    } catch {
      // A malformed or concurrently-written session should not prevent listing the rest.
    }
  }

  return matches
}

const summaryFromInfo = (info: PiSessionInfo, parentSessionPath?: string): SessionSummary => ({
  id: info.id,
  path: info.path,
  name: info.name || info.firstMessage || "Untitled session",
  firstMessage: info.firstMessage,
  updatedAt: info.modified.getTime(),
  messageCount: info.messageCount,
  ...(parentSessionPath ? { parentSessionPath } : {})
})

const detailFromManager = (manager: SessionManager, summary: SessionSummary): SessionDetail => {
  const context = manager.buildSessionContext()
  return {
    summary,
    messages: historyToChat(manager),
    model: context.model ? `${context.model.provider}/${context.model.modelId}` : "No model configured",
    thinkingLevel: thinkingLevelValue(context.thinkingLevel),
    availableThinkingLevels: ["off"],
    // Background terminals are session-scoped and are killed on shutdown;
    // stored entries are history, never live children for an inspected session.
    backgroundProcesses: [],
    isStreaming: false,
    isCompacting: false
  }
}

const detailFromActive = (active: ActiveSession): SessionDetail => {
  const messages = historyToChat(active.session.sessionManager)
  const firstUserText = messages.find((message) => message.role === "user")?.blocks.find((block) => block.type === "text")?.text
  return {
    summary: {
      id: active.session.sessionId,
      path: active.session.sessionFile ?? "",
      name: active.session.sessionManager.getSessionName() || firstUserText || "New session",
      firstMessage: firstUserText ?? "",
      updatedAt: Date.now(),
      messageCount: messages.filter((message) => message.blocks.some((block) => block.type !== "compaction")).length
    },
    messages,
    model: active.session.model ? `${active.session.model.provider}/${active.session.model.id}` : "No model configured",
    thinkingLevel: active.session.thinkingLevel,
    availableThinkingLevels: active.session.getAvailableThinkingLevels(),
    backgroundProcesses: runningProcesses(active.backgroundProcesses),
    isStreaming: active.session.isStreaming,
    isCompacting: active.session.isCompacting
  }
}

export class PiSessions extends Context.Service<PiSessions, {
  readonly list: (cwd: string) => Effect.Effect<ReadonlyArray<SessionSummary>, AppError>
  readonly create: (cwd: string) => Effect.Effect<SessionDetail, AppError>
  readonly open: (cwd: string, sessionPath: string) => Effect.Effect<SessionDetail, AppError>
  readonly inspect: (cwd: string, parentSessionPath: string, sessionPath: string) => Effect.Effect<SessionDetail, AppError>
  readonly prompt: (sessionPath: string, text: string) => Effect.Effect<void, AppError>
  readonly abort: (sessionPath: string) => Effect.Effect<void, AppError>
  readonly models: (sessionPath: string) => Effect.Effect<ReadonlyArray<ModelOption>, AppError>
  readonly setModel: (sessionPath: string, provider: string, modelId: string) => Effect.Effect<SessionDetail, AppError>
  readonly setThinkingLevel: (sessionPath: string, level: ThinkingLevel) => Effect.Effect<SessionDetail, AppError>
  readonly dispose: () => Effect.Effect<void>
}>()("PiSessions") {}

const createPiRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd, agentDir })
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics
  }
}

export const PiSessionsLive = Layer.effect(PiSessions)(Effect.gen(function*() {
  const bus = yield* WindowBus
  const git = yield* GitContext
  const sessionLifecycleLock = yield* Semaphore.make(1)
  const activeSessions = new Map<string, ActiveSession>()

  const emitSnapshot = (active: ActiveSession) => bus.emit({
    type: "session-state",
    sessionPath: active.session.sessionFile ?? "",
    detail: detailFromActive(active)
  })

  const emitBackgroundProcesses = (active: ActiveSession) => bus.emit({
    type: "background-processes",
    sessionPath: active.session.sessionFile ?? "",
    processes: runningProcesses(active.backgroundProcesses)
  })

  const cancelGitRefresh = (active: ActiveSession) => {
    active.disposed = true
    active.gitRefreshGeneration++
    if (active.gitRefreshTimer) clearTimeout(active.gitRefreshTimer)
    active.gitRefreshTimer = undefined
  }

  const scheduleGitRefresh = (active: ActiveSession) => {
    if (active.disposed || active.gitRefreshTimer) return
    const generation = ++active.gitRefreshGeneration
    const sessionKey = canonicalPath(active.session.sessionFile ?? "")
    active.gitRefreshTimer = setTimeout(() => {
      active.gitRefreshTimer = undefined
      void Effect.runPromise(git.inspect(active.cwd).pipe(
        Effect.flatMap((status) =>
          active.disposed
            || active.gitRefreshGeneration !== generation
            || activeSessions.get(sessionKey) !== active
            ? Effect.void
            : bus.emit({ type: "project-git", projectPath: active.cwd, ...(status ? { git: status } : {}) })
        ),
        Effect.catchTag("GitContextError", () => Effect.void)
      ))
    }, 350)
  }

  const attach = Effect.fn("PiSessions.attach")(function*(cwd: string, manager: SessionManager) {
    const runtime = yield* Effect.tryPromise({
      try: async () => {
        for (const active of activeSessions.values()) {
          cancelGitRefresh(active)
          active.unsubscribe()
          await active.runtime.dispose()
        }
        activeSessions.clear()
        const next = await createAgentSessionRuntime(createPiRuntime, {
          cwd,
          agentDir: getAgentDir(),
          sessionManager: manager
        })
        await next.session.bindExtensions({ mode: "print" })
        return next
      },
      catch: toAppError("open Pi session")
    })
    const sessionPath = runtime.session.sessionFile
    if (!sessionPath) return yield* Effect.fail(AppError.make({ operation: "open Pi session", message: "Pi did not create a persistent session file" }))

    const active: ActiveSession = {
      cwd,
      runtime,
      session: runtime.session,
      backgroundProcesses: historicalBackgroundProcesses(manager),
      pendingTools: new Map(),
      liveMessageId: null,
      gitRefreshTimer: undefined,
      gitRefreshGeneration: 0,
      disposed: false,
      unsubscribe: () => undefined
    }

    active.unsubscribe = runtime.session.subscribe((event) => {
      if (event.type === "agent_start") {
        void Effect.runPromise(bus.emit({ type: "agent-status", sessionPath, isStreaming: true }))
      } else if (event.type === "message_start" && event.message.role === "assistant") {
        active.liveMessageId = `live-${event.message.timestamp}`
        void Effect.runPromise(bus.emit({ type: "assistant-start", sessionPath, messageId: active.liveMessageId, timestamp: event.message.timestamp }))
      } else if (event.type === "message_update") {
        if (!active.liveMessageId) active.liveMessageId = `live-${Date.now()}`
        if (event.assistantMessageEvent.type === "text_delta") {
          void Effect.runPromise(bus.emit({ type: "text-delta", sessionPath, messageId: active.liveMessageId, delta: event.assistantMessageEvent.delta }))
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          void Effect.runPromise(bus.emit({ type: "thinking-delta", sessionPath, messageId: active.liveMessageId, delta: event.assistantMessageEvent.delta }))
        }
      } else if (event.type === "tool_execution_start") {
        active.pendingTools.set(event.toolCallId, { name: event.toolName, args: event.args })
        void Effect.runPromise(bus.emit({
          type: "tool-start",
          sessionPath,
          tool: { id: event.toolCallId, name: event.toolName, input: stringify(event.args), status: "running", startedAt: Date.now() }
        }))
      } else if (event.type === "tool_execution_update") {
        void Effect.runPromise(bus.emit({ type: "tool-update", sessionPath, toolId: event.toolCallId, output: stringify(event.partialResult) }))
      } else if (event.type === "tool_execution_end") {
        const diff = diffFromResult(event.result)
        const call = active.pendingTools.get(event.toolCallId)
        active.pendingTools.delete(event.toolCallId)
        if (event.toolName.startsWith("bg_")) {
          applyBackgroundToolResult(active.backgroundProcesses, event.toolName, call?.args, event.result, Date.now())
          void Effect.runPromise(emitBackgroundProcesses(active))
        }
        void Effect.runPromise(bus.emit({
          type: "tool-end",
          sessionPath,
          toolId: event.toolCallId,
          output: stringify(event.result),
          isError: event.isError,
          ...(diff ? { diff } : {})
        }))
        scheduleGitRefresh(active)
      } else if (event.type === "message_end" && event.message.role === "custom" && event.message.customType === "background-terminal-result") {
        applyBackgroundResultMessage(active.backgroundProcesses, event.message, event.message.timestamp)
        void Effect.runPromise(emitBackgroundProcesses(active))
      } else if (event.type === "compaction_start") {
        void Effect.runPromise(bus.emit({ type: "compaction-status", sessionPath, isCompacting: true }))
      } else if (event.type === "compaction_end") {
        void Effect.runPromise(bus.emit({ type: "compaction-status", sessionPath, isCompacting: false }))
        void Effect.runPromise(emitSnapshot(active))
      } else if (event.type === "thinking_level_changed") {
        void Effect.runPromise(emitSnapshot(active))
      } else if (event.type === "agent_settled") {
        active.liveMessageId = null
        void Effect.runPromise(bus.emit({ type: "agent-status", sessionPath, isStreaming: false }))
        void Effect.runPromise(emitSnapshot(active))
        scheduleGitRefresh(active)
      }
    })

    activeSessions.set(canonicalPath(sessionPath), active)
    return active
  })

  const getOrOpen = Effect.fn("PiSessions.getOrOpen")(function*(cwd: string, sessionPath: string) {
    const projectCwd = canonicalPath(cwd)
    const requestedSessionPath = canonicalPath(sessionPath)
    const existing = activeSessions.get(requestedSessionPath)
    if (existing && canonicalPath(existing.cwd) === projectCwd) return existing

    const knownSessions = yield* Effect.tryPromise({ try: () => SessionManager.list(projectCwd), catch: toAppError("verify Pi session") })
    const known = knownSessions.find((info) => canonicalPath(info.path) === requestedSessionPath && canonicalPath(info.cwd || projectCwd) === projectCwd)
    if (!known) {
      return yield* Effect.fail(AppError.make({ operation: "open Pi session", message: "Session does not belong to this project" }))
    }
    const manager = yield* Effect.try({
      try: () => SessionManager.open(known.path, undefined, projectCwd),
      catch: toAppError("read Pi session")
    })
    return yield* attach(projectCwd, manager)
  })

  return {
    list: Effect.fn("PiSessions.list")(function*(cwd: string) {
      const projectCwd = canonicalPath(cwd)
      const listed = yield* Effect.tryPromise({ try: () => SessionManager.list(projectCwd), catch: toAppError("list Pi sessions") })
      const infos = listed.filter((info) => canonicalPath(info.cwd || projectCwd) === projectCwd)
      const parentByChild = inferSubagentParents(projectCwd, infos)
      return infos.map((info) => summaryFromInfo(info, parentByChild.get(info.path)))
    }),
    create: Effect.fn("PiSessions.create")(function*(cwd: string) {
      return yield* sessionLifecycleLock.withPermit(Effect.gen(function*() {
        const projectCwd = canonicalPath(cwd)
        const manager = yield* Effect.try({ try: () => SessionManager.create(projectCwd), catch: toAppError("create Pi session") })
        const active = yield* attach(projectCwd, manager)
        return detailFromActive(active)
      }))
    }),
    open: Effect.fn("PiSessions.open")(function*(cwd: string, sessionPath: string) {
      return yield* sessionLifecycleLock.withPermit(Effect.gen(function*() {
        const active = yield* getOrOpen(cwd, sessionPath)
        return detailFromActive(active)
      }))
    }),
    inspect: Effect.fn("PiSessions.inspect")(function*(cwd: string, parentSessionPath: string, sessionPath: string) {
      const projectCwd = canonicalPath(cwd)
      const requestedPath = canonicalPath(sessionPath)
      const listed = yield* Effect.tryPromise({ try: () => SessionManager.list(projectCwd), catch: toAppError("verify Pi session") })
      const infos = listed.filter((candidate) => canonicalPath(candidate.cwd || projectCwd) === projectCwd)
      const info = infos.find((candidate) => canonicalPath(candidate.path) === requestedPath)
      const parentByChild = inferSubagentParents(projectCwd, infos)
      const inferredParentPath = info ? parentByChild.get(info.path) : undefined
      if (!info || !inferredParentPath || canonicalPath(inferredParentPath) !== canonicalPath(parentSessionPath)) {
        return yield* Effect.fail(AppError.make({ operation: "inspect Pi session", message: "Session is not linked to this parent" }))
      }
      const manager = yield* Effect.try({ try: () => SessionManager.open(info.path, undefined, projectCwd), catch: toAppError("inspect Pi session") })
      return detailFromManager(manager, summaryFromInfo(info))
    }),
    prompt: Effect.fn("PiSessions.prompt")(function*(sessionPath: string, text: string) {
      const active = activeSessions.get(canonicalPath(sessionPath))
      if (!active) return yield* Effect.fail(AppError.make({ operation: "prompt Pi", message: "Open the session before sending a message" }))
      if (active.session.isStreaming) return yield* Effect.fail(AppError.make({ operation: "prompt Pi", message: "Pi is already working in this session" }))
      yield* Effect.tryPromise({ try: () => active.session.prompt(text), catch: toAppError("prompt Pi") })
    }),
    abort: Effect.fn("PiSessions.abort")(function*(sessionPath: string) {
      const active = activeSessions.get(canonicalPath(sessionPath))
      if (!active) return
      yield* Effect.tryPromise({ try: () => active.session.abort(), catch: toAppError("abort Pi") })
    }),
    models: Effect.fn("PiSessions.models")(function*(sessionPath: string) {
      const active = activeSessions.get(canonicalPath(sessionPath))
      if (!active) return yield* Effect.fail(AppError.make({ operation: "list models", message: "Open the session before choosing a model" }))
      const models = yield* Effect.tryPromise({ try: () => active.session.modelRuntime.getAvailable(), catch: toAppError("list models") })
      return models.map((model) => ({ provider: model.provider, id: model.id, name: model.name }))
    }),
    setModel: Effect.fn("PiSessions.setModel")(function*(sessionPath: string, provider: string, modelId: string) {
      const active = activeSessions.get(canonicalPath(sessionPath))
      if (!active) return yield* Effect.fail(AppError.make({ operation: "set model", message: "Open the session before choosing a model" }))
      const available = yield* Effect.tryPromise({ try: () => active.session.modelRuntime.getAvailable(), catch: toAppError("list models") })
      const model = available.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      if (!model) return yield* Effect.fail(AppError.make({ operation: "set model", message: "The selected model is unavailable" }))
      yield* Effect.tryPromise({ try: () => active.session.setModel(model), catch: toAppError("set model") })
      const detail = detailFromActive(active)
      yield* emitSnapshot(active)
      return detail
    }),
    setThinkingLevel: Effect.fn("PiSessions.setThinkingLevel")(function*(sessionPath: string, level: ThinkingLevel) {
      const active = activeSessions.get(canonicalPath(sessionPath))
      if (!active) return yield* Effect.fail(AppError.make({ operation: "set effort", message: "Open the session before choosing an effort" }))
      const supported: ReadonlyArray<string> = active.session.getAvailableThinkingLevels()
      if (!supported.includes(level)) {
        return yield* Effect.fail(AppError.make({ operation: "set effort", message: `Effort ${level} is unavailable for this model` }))
      }
      yield* Effect.sync(() => active.session.setThinkingLevel(level))
      const detail = detailFromActive(active)
      yield* emitSnapshot(active)
      return detail
    }),
    dispose: Effect.fn("PiSessions.dispose")(function*() {
      yield* sessionLifecycleLock.withPermit(Effect.gen(function*() {
        const active = [...activeSessions.values()]
        activeSessions.clear()
        yield* Effect.promise(async () => {
          for (const session of active) {
            cancelGitRefresh(session)
            session.unsubscribe()
            await session.runtime.dispose()
          }
        })
      }))
    })
  }
}))
