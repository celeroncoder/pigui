import { resolve } from "node:path"
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager
} from "@earendil-works/pi-coding-agent"
import type { AgentSession, AgentSessionRuntime, CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent"
import { Context, Effect, Exit, Layer, Schema, Semaphore } from "effect"
import { normalizeImageReferences, parseImagePathReferences } from "../../shared/attachments"
import { projectContextUsage } from "../../shared/contextUsage"
import type { AskUserInteractionAnswer, AskUserInteractionRequest } from "../../shared/interaction"
import { AskUserInputSchema } from "../../shared/interaction"
import type { BackgroundProcess, BackgroundProcessStatus, ChatMessage, ContextUsage, MessageBlock, ModelOption, QueueDelivery, QueuedMessage, SessionDetail, SessionEvent, SessionSummary, ThinkingLevel, ToolResultBlock } from "../../shared/contracts"
import { reduceSessionEvent } from "../../shared/sessionEvents"
import { AppError, toAppError } from "./AppError"
import { AskUserInteractionBridge } from "./AskUserInteraction"
import { AttachmentStore, type PiImageAttachment } from "./AttachmentStore"
import { GitContext } from "./GitContext"
import { projectToolOutput } from "./PiEventProjection"
import { releaseInactiveEntriesExcept } from "./PiSessionLifecycle"
import {
  type NativePromptQueue,
  prioritizeQueuedMessageForSteering,
  reconcileQueuedMessages,
  removeQueuedMessage,
  sameQueuedMessages,
  updateQueuedMessageText
} from "./PromptQueue"
import { WindowBus } from "./WindowBus"

const canonicalPath = (value: string) => resolve(value)

interface ActiveSession {
  readonly cwd: string
  readonly runtime: AgentSessionRuntime
  readonly session: AgentSession
  unsubscribe: () => void
  readonly interaction: AskUserInteractionBridge
  readonly backgroundProcesses: Map<string, BackgroundProcess>
  readonly pendingTools: Map<string, { readonly name: string; readonly args: unknown }>
  readonly queuedImages: Map<string, ReadonlyArray<PiImageAttachment>>
  queuedMessages: ReadonlyArray<QueuedMessage>
  queueUpdatesSuspended: number
  pendingPromptStarts: number
  liveMessageId: string | null
  liveMessageStarted: boolean
  liveDetail: SessionDetail | undefined
  gitRefreshTimer: ReturnType<typeof setTimeout> | undefined
  gitRefreshGeneration: number
  disposed: boolean
  liveAssistantMessageIndex: number
  liveUserMessageIndex: number
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

const detailFromManager = (manager: SessionManager, summary: SessionSummary, contextUsage?: ContextUsage): SessionDetail => {
  const context = manager.buildSessionContext()
  return {
    summary,
    messages: historyToChat(manager),
    model: context.model ? `${context.model.provider}/${context.model.modelId}` : "No model configured",
    thinkingLevel: thinkingLevelValue(context.thinkingLevel),
    availableThinkingLevels: ["off"],
    // Background terminals and prompt queues are runtime-scoped, never historical.
    backgroundProcesses: [],
    queuedMessages: [],
    ...(contextUsage ? { contextUsage } : {}),
    isStreaming: false,
    isCompacting: false
  }
}

const snapshotFromActive = (active: ActiveSession): SessionDetail => {
  const messages = historyToChat(active.session.sessionManager)
  const firstUserText = messages.find((message) => message.role === "user")?.blocks.find((block) => block.type === "text")?.text
  const interactionRequest = active.interaction.pendingRequest()
  const contextUsage = projectContextUsage(active.session)
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
    queuedMessages: active.queuedMessages,
    ...(contextUsage ? { contextUsage } : {}),
    ...(interactionRequest ? { interactionRequest } : {}),
    isStreaming: active.session.isStreaming || active.pendingPromptStarts > 0,
    isCompacting: active.session.isCompacting
  }
}

const detailFromActive = (active: ActiveSession): SessionDetail => {
  const detail = active.liveDetail ?? snapshotFromActive(active)
  const { contextUsage: _previousContextUsage, interactionRequest: _previousInteraction, ...base } = detail
  const contextUsage = projectContextUsage(active.session)
  const interactionRequest = active.interaction.pendingRequest()
  return {
    ...base,
    model: active.session.model ? `${active.session.model.provider}/${active.session.model.id}` : "No model configured",
    thinkingLevel: active.session.thinkingLevel,
    availableThinkingLevels: active.session.getAvailableThinkingLevels(),
    backgroundProcesses: runningProcesses(active.backgroundProcesses),
    queuedMessages: active.queuedMessages,
    ...(contextUsage ? { contextUsage } : {}),
    ...(interactionRequest ? { interactionRequest } : {}),
    isStreaming: active.session.isStreaming || active.pendingPromptStarts > 0,
    isCompacting: active.session.isCompacting
  }
}

export class PiSessions extends Context.Service<PiSessions, {
  readonly list: (cwd: string) => Effect.Effect<ReadonlyArray<SessionSummary>, AppError>
  readonly create: (cwd: string, baseBranch?: string) => Effect.Effect<SessionDetail, AppError>
  readonly open: (cwd: string, sessionPath: string) => Effect.Effect<SessionDetail, AppError>
  readonly inspect: (cwd: string, parentSessionPath: string, sessionPath: string) => Effect.Effect<SessionDetail, AppError>
  readonly prompt: (cwd: string, sessionPath: string, text: string, delivery: QueueDelivery, attachmentPaths: ReadonlyArray<string>) => Effect.Effect<void, AppError>
  readonly editQueuedMessage: (cwd: string, sessionPath: string, messageId: string, text: string) => Effect.Effect<void, AppError>
  readonly removeQueuedMessage: (cwd: string, sessionPath: string, messageId: string) => Effect.Effect<void, AppError>
  readonly steerQueuedMessage: (cwd: string, sessionPath: string, messageId: string) => Effect.Effect<void, AppError>
  readonly abort: (cwd: string, sessionPath: string) => Effect.Effect<void, AppError>
  readonly models: (cwd: string, sessionPath: string) => Effect.Effect<ReadonlyArray<ModelOption>, AppError>
  readonly setModel: (cwd: string, sessionPath: string, provider: string, modelId: string) => Effect.Effect<SessionDetail, AppError>
  readonly setThinkingLevel: (cwd: string, sessionPath: string, level: ThinkingLevel) => Effect.Effect<SessionDetail, AppError>
  readonly answerInteraction: (cwd: string, sessionPath: string, requestId: string, answer: AskUserInteractionAnswer) => Effect.Effect<void, AppError>
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
  const attachments = yield* AttachmentStore
  const git = yield* GitContext
  const sessionLifecycleLock = yield* Semaphore.make(1)
  const queueMutationLock = yield* Semaphore.make(1)
  const activeSessions = new Map<string, ActiveSession>()

  const emitActiveEvent = (active: ActiveSession, event: SessionEvent) => {
    // The renderer intentionally ignores offscreen session paths. Mirror the
    // same projection here so reopening a running session restores its live UI.
    const sessionPath = active.session.sessionFile ?? ""
    const current = active.liveDetail ?? snapshotFromActive(active)
    const next = reduceSessionEvent(current, sessionPath, event)
    if (next) active.liveDetail = next
    return bus.emit(event)
  }

  const emitSnapshot = (active: ActiveSession, overrides?: Pick<Partial<SessionDetail>, "isCompacting">) => emitActiveEvent(active, {
    type: "session-state",
    sessionPath: active.session.sessionFile ?? "",
    detail: { ...snapshotFromActive(active), ...overrides }
  })

  const emitContextUsage = (active: ActiveSession) => emitActiveEvent(active, {
    type: "context-usage",
    sessionPath: active.session.sessionFile ?? "",
    contextUsage: projectContextUsage(active.session)
  })

  const emitBackgroundProcesses = (active: ActiveSession) => emitActiveEvent(active, {
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

  const releaseActiveSession = async (active: ActiveSession) => {
    active.disposed = true
    cancelGitRefresh(active)
    active.interaction.dispose()
    active.unsubscribe()
    await active.runtime.dispose()
  }

  const releaseInactiveSessionsExcept = (keepKey: string) => releaseInactiveEntriesExcept(
    activeSessions,
    keepKey,
    // Runtime disposal aborts Pi's agent and tears down runtime-scoped work.
    // Preserve established runs, background terminals, compaction/queue state,
    // and the async preflight gap between IPC acceptance and agent_start.
    (active) => active.session.isStreaming
      || active.session.isCompacting
      || active.pendingPromptStarts > 0
      || active.queuedMessages.length > 0
      || runningProcesses(active.backgroundProcesses).length > 0,
    releaseActiveSession
  )

  const scheduleGitRefresh = (active: ActiveSession, delay = 350) => {
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
            : bus.emit({ type: "project-git", worktreePath: active.cwd, ...(status ? { git: status } : {}) })
        ),
        Effect.catchTag("GitContextError", () => Effect.void)
      )).finally(() => {
        if (runningProcesses(active.backgroundProcesses).length > 0) scheduleGitRefresh(active, 2500)
      })
    }, delay)
  }


  const nativePromptQueue = (session: AgentSession): NativePromptQueue => ({
    steering: session.getSteeringMessages(),
    followUp: session.getFollowUpMessages()
  })

  const refreshQueuedMessages = (active: ActiveSession): boolean => {
    const next = reconcileQueuedMessages(active.queuedMessages, nativePromptQueue(active.session))
    const nextIds = new Set(next.map((message) => message.id))
    for (const id of active.queuedImages.keys()) {
      if (!nextIds.has(id)) active.queuedImages.delete(id)
    }
    if (sameQueuedMessages(active.queuedMessages, next)) return false
    active.queuedMessages = next
    return true
  }

  const emitQueuedMessages = (active: ActiveSession) => emitActiveEvent(active, {
    type: "queue-update",
    sessionPath: active.session.sessionFile ?? "",
    messages: active.queuedMessages
  })

  const queueCommandName = (text: string): string | undefined => {
    if (!text.startsWith("/")) return undefined
    const spaceIndex = text.indexOf(" ")
    return spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
  }

  const queueabilityError = (session: AgentSession, text: string): AppError | undefined => {
    const commandName = queueCommandName(text)
    if (!commandName || !session.extensionRunner.getCommand(commandName)) return undefined
    return AppError.make({
      operation: "queue Pi message",
      message: `Extension command "/${commandName}" cannot be queued`
    })
  }

  const enqueueNativeMessages = (active: ActiveSession, messages: ReadonlyArray<QueuedMessage>): Promise<void> => {
    const imagesFor = (message: QueuedMessage) => [...(active.queuedImages.get(message.id) ?? [])]
    const steering = messages.filter((message) => message.delivery === "steer").map((message) => active.session.steer(message.text, imagesFor(message)))
    const followUps = messages.filter((message) => message.delivery === "follow-up").map((message) => active.session.followUp(message.text, imagesFor(message)))
    return Promise.all([...steering, ...followUps]).then(() => undefined)
  }

  // AgentSession exposes native enqueue plus clear-all, but no per-item mutation.
  // Rebuild the SDK queues synchronously so edits/removals never become renderer-only state.
  const replaceNativeQueue = Effect.fn("PiSessions.replaceNativeQueue")(function*(active: ActiveSession, messages: ReadonlyArray<QueuedMessage>) {
    const previous = active.queuedMessages
    const previousImages = new Map(active.queuedImages)
    yield* Effect.tryPromise({
      try: async () => {
        let replaced = false
        active.queueUpdatesSuspended += 1
        active.queuedMessages = messages
        try {
          active.session.clearQueue()
          await enqueueNativeMessages(active, messages)
          replaced = true
        } catch (cause) {
          active.session.clearQueue()
          active.queuedMessages = previous
          active.queuedImages.clear()
          for (const [id, images] of previousImages) active.queuedImages.set(id, images)
          try {
            await enqueueNativeMessages(active, previous)
          } catch {
            // Preserve the original SDK failure; the following runtime snapshot reconciles the queue.
          }
          throw cause
        } finally {
          active.queueUpdatesSuspended -= 1
          const reconciled = refreshQueuedMessages(active)
          if (reconciled || replaced) void Effect.runPromise(emitQueuedMessages(active))
        }
      },
      catch: toAppError("update queued Pi message")
    })
  })

  const decodeAskUserInput = (value: unknown) => {
    const decoded = Schema.decodeUnknownExit(AskUserInputSchema)(value)
    return Exit.isSuccess(decoded) ? decoded.value : undefined
  }

  const attach = Effect.fn("PiSessions.attach")(function*(cwd: string, manager: SessionManager) {
    const attachedRuntime = yield* Effect.tryPromise({
      try: async () => {
        const next = await createAgentSessionRuntime(createPiRuntime, {
          cwd,
          agentDir: getAgentDir(),
          sessionManager: manager
        })
        const sessionPath = next.session.sessionFile
        if (!sessionPath) {
          await next.dispose()
          throw new Error("Pi did not create a persistent session file")
        }

        const interaction = new AskUserInteractionBridge({
          sessionPath,
          onRequest: (request) => {
            void Effect.runPromise(bus.emit({ type: "interaction-request", sessionPath, request })).catch(() => undefined)
          },
          onClear: (requestId) => {
            void Effect.runPromise(bus.emit({ type: "interaction-cleared", sessionPath, requestId })).catch(() => undefined)
          }
        })

        try {
          await next.session.bindExtensions({
            uiContext: interaction.uiContext,
            mode: "tui",
            abortHandler: () => {
              interaction.cancelPending()
              void next.session.abort().catch(() => undefined)
            },
            shutdownHandler: () => interaction.cancelPending()
          })
        } catch (cause) {
          interaction.dispose()
          await next.dispose()
          throw cause
        }

        return { runtime: next, interaction }
      },
      catch: toAppError("open Pi session")
    })
    const runtime = attachedRuntime.runtime
    const interaction = attachedRuntime.interaction
    const sessionPath = runtime.session.sessionFile
    if (!sessionPath) {
      interaction.dispose()
      return yield* Effect.fail(AppError.make({ operation: "open Pi session", message: "Pi did not create a persistent session file" }))
    }

    const active: ActiveSession = {
      cwd,
      runtime,
      session: runtime.session,
      interaction,
      backgroundProcesses: historicalBackgroundProcesses(manager),
      pendingTools: new Map(),
      queuedImages: new Map(),
      queuedMessages: reconcileQueuedMessages([], nativePromptQueue(runtime.session)),
      queueUpdatesSuspended: 0,
      pendingPromptStarts: 0,
      liveMessageId: null,
      liveMessageStarted: false,
      liveDetail: undefined,
      gitRefreshTimer: undefined,
      gitRefreshGeneration: 0,
      disposed: false,
      liveAssistantMessageIndex: 0,
      liveUserMessageIndex: 0,
      unsubscribe: () => undefined
    }

    active.liveDetail = snapshotFromActive(active)

    active.unsubscribe = runtime.session.subscribe((event) => {
      if (event.type === "queue_update") {
        if (active.queueUpdatesSuspended === 0 && refreshQueuedMessages(active)) {
          void Effect.runPromise(emitQueuedMessages(active))
        }
      } else if (event.type === "agent_start") {
        void Effect.runPromise(Effect.gen(function*() {
          yield* emitActiveEvent(active, { type: "agent-status", sessionPath, isStreaming: true })
          yield* emitContextUsage(active)
        }))
      } else if (event.type === "message_start" && event.message.role === "user") {
        active.liveUserMessageIndex += 1
        void Effect.runPromise(emitActiveEvent(active, {
          type: "user-message",
          sessionPath,
          message: {
            id: `live-user-${event.message.timestamp}-${active.liveUserMessageIndex}`,
            role: "user",
            blocks: [{ type: "text", text: textFromContent(event.message.content) }],
            timestamp: event.message.timestamp
          }
        }))
      } else if (event.type === "message_start" && event.message.role === "assistant") {
        if (!active.liveMessageId || active.liveMessageStarted) {
          active.liveAssistantMessageIndex += 1
          active.liveMessageId = `live-assistant-${event.message.timestamp}-${active.liveAssistantMessageIndex}`
        }
        active.liveMessageStarted = true
        void Effect.runPromise(emitActiveEvent(active, { type: "assistant-start", sessionPath, messageId: active.liveMessageId, timestamp: event.message.timestamp }))
      } else if (event.type === "message_update") {
        if (!active.liveMessageId) {
          active.liveAssistantMessageIndex += 1
          active.liveMessageId = `live-assistant-${Date.now()}-${active.liveAssistantMessageIndex}`
        }
        active.liveMessageStarted = true
        if (event.assistantMessageEvent.type === "text_delta") {
          void Effect.runPromise(emitActiveEvent(active, { type: "text-delta", sessionPath, messageId: active.liveMessageId, delta: event.assistantMessageEvent.delta }))
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          void Effect.runPromise(emitActiveEvent(active, { type: "thinking-delta", sessionPath, messageId: active.liveMessageId, delta: event.assistantMessageEvent.delta }))
        }
      } else if (event.type === "tool_execution_start") {
        if (!active.liveMessageId) {
          active.liveMessageId = `live-tool-${event.toolCallId}`
          active.liveMessageStarted = false
        }
        const messageId = active.liveMessageId
        active.pendingTools.set(event.toolCallId, { name: event.toolName, args: event.args })
        if (event.toolName === "ask_user") {
          const input = decodeAskUserInput(event.args)
          if (input) {
            const request: AskUserInteractionRequest = {
              requestId: event.toolCallId,
              toolCallId: event.toolCallId,
              question: input.question,
              options: input.options
            }
            active.interaction.register(request)
          }
        }
        void Effect.runPromise(emitActiveEvent(active, {
          type: "tool-start",
          sessionPath,
          messageId,
          tool: { id: event.toolCallId, name: event.toolName, input: stringify(event.args), status: "running", startedAt: Date.now() }
        }))
      } else if (event.type === "tool_execution_update") {
        void Effect.runPromise(emitActiveEvent(active, { type: "tool-update", sessionPath, toolId: event.toolCallId, output: projectToolOutput(event.partialResult) }))
      } else if (event.type === "tool_execution_end") {
        const diff = diffFromResult(event.result)
        const call = active.pendingTools.get(event.toolCallId)
        active.pendingTools.delete(event.toolCallId)
        if (event.toolName === "ask_user") active.interaction.finishTool(event.toolCallId)
        if (event.toolName.startsWith("bg_")) {
          applyBackgroundToolResult(active.backgroundProcesses, event.toolName, call?.args, event.result, Date.now())
          void Effect.runPromise(emitBackgroundProcesses(active))
        }
        void Effect.runPromise(emitActiveEvent(active, {
          type: "tool-end",
          sessionPath,
          toolId: event.toolCallId,
          output: projectToolOutput(event.result),
          isError: event.isError,
          ...(diff ? { diff } : {})
        }))
        scheduleGitRefresh(active)
      } else if (event.type === "message_end") {
        if (event.message.role === "assistant") void Effect.runPromise(emitContextUsage(active))
        if (event.message.role === "custom" && event.message.customType === "background-terminal-result") {
          applyBackgroundResultMessage(active.backgroundProcesses, event.message, event.message.timestamp)
          void Effect.runPromise(emitBackgroundProcesses(active))
          scheduleGitRefresh(active)
        }
      } else if (event.type === "entry_appended") {
        void Effect.runPromise(emitContextUsage(active))
      } else if (event.type === "compaction_start") {
        void Effect.runPromise(Effect.gen(function*() {
          yield* emitActiveEvent(active, { type: "compaction-status", sessionPath, isCompacting: true })
          yield* emitContextUsage(active)
        }))
      } else if (event.type === "compaction_end") {
        void Effect.runPromise(Effect.gen(function*() {
          yield* emitActiveEvent(active, { type: "compaction-status", sessionPath, isCompacting: false })
          yield* emitContextUsage(active)
          // Pi clears its compaction controller immediately after this event.
          // The end event itself is authoritative, so keep the snapshot in sync.
          yield* emitSnapshot(active, { isCompacting: false })
        }))
      } else if (event.type === "thinking_level_changed") {
        void Effect.runPromise(emitSnapshot(active))
      } else if (event.type === "agent_settled") {
        active.liveMessageId = null
        active.liveMessageStarted = false
        void Effect.runPromise(emitActiveEvent(active, { type: "agent-status", sessionPath, isStreaming: false }))
        void Effect.runPromise(emitSnapshot(active))
        scheduleGitRefresh(active)
      }
    })

    const sessionKey = canonicalPath(sessionPath)
    activeSessions.set(sessionKey, active)
    yield* Effect.promise(() => releaseInactiveSessionsExcept(sessionKey))
    return active
  })

  const getOrOpen = Effect.fn("PiSessions.getOrOpen")(function*(cwd: string, sessionPath: string) {
    const projectCwd = canonicalPath(cwd)
    const requestedSessionPath = canonicalPath(sessionPath)
    const existing = activeSessions.get(requestedSessionPath)
    if (existing && canonicalPath(existing.cwd) === projectCwd) {
      yield* Effect.promise(() => releaseInactiveSessionsExcept(requestedSessionPath))
      return existing
    }

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

  const activeForWorktree = Effect.fn("PiSessions.activeForWorktree")(function*(cwd: string, sessionPath: string, operation: string) {
    const active = activeSessions.get(canonicalPath(sessionPath))
    if (!active || canonicalPath(active.cwd) !== canonicalPath(cwd)) {
      return yield* Effect.fail(AppError.make({ operation, message: "The session is not open in the selected worktree" }))
    }
    return active
  })

  return {
    list: Effect.fn("PiSessions.list")(function*(cwd: string) {
      const projectCwd = canonicalPath(cwd)
      const listed = yield* Effect.tryPromise({ try: () => SessionManager.list(projectCwd), catch: toAppError("list Pi sessions") })
      const infos = listed.filter((info) => canonicalPath(info.cwd || projectCwd) === projectCwd)
      const parentByChild = inferSubagentParents(projectCwd, infos)
      return infos.map((info) => summaryFromInfo(info, parentByChild.get(info.path)))
    }),
    create: Effect.fn("PiSessions.create")(function*(cwd: string, baseBranch?: string) {
      return yield* sessionLifecycleLock.withPermit(queueMutationLock.withPermit(Effect.gen(function*() {
        const projectCwd = canonicalPath(cwd)
        const manager = yield* Effect.try({ try: () => SessionManager.create(projectCwd), catch: toAppError("create Pi session") })
        if (baseBranch) {
          yield* Effect.try({
            try: () => manager.appendCustomEntry("pi-desktop-worktree-context", { baseBranch }),
            catch: toAppError("persist worktree session context")
          })
        }
        const active = yield* attach(projectCwd, manager)
        return detailFromActive(active)
      })))
    }),
    open: Effect.fn("PiSessions.open")(function*(cwd: string, sessionPath: string) {
      return yield* sessionLifecycleLock.withPermit(queueMutationLock.withPermit(Effect.gen(function*() {
        const active = yield* getOrOpen(cwd, sessionPath)
        return detailFromActive(active)
      })))
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
      const runtime = yield* Effect.tryPromise({
        try: () => createAgentSessionRuntime(createPiRuntime, { cwd: projectCwd, agentDir: getAgentDir(), sessionManager: manager }),
        catch: toAppError("inspect Pi context usage")
      })
      try {
        return detailFromManager(manager, summaryFromInfo(info), projectContextUsage(runtime.session))
      } finally {
        yield* Effect.promise(() => runtime.dispose())
      }
    }),
    prompt: Effect.fn("PiSessions.prompt")(function*(cwd: string, sessionPath: string, text: string, delivery: QueueDelivery, attachmentPaths: ReadonlyArray<string>) {
      const requestedPath = canonicalPath(sessionPath)
      const active = yield* activeForWorktree(cwd, sessionPath, "prompt Pi")

      const inferredPaths = parseImagePathReferences(text).map((reference) => reference.path)
      const paths = [...new Set([...inferredPaths, ...attachmentPaths])]
      const prompt = normalizeImageReferences(text, paths)
      if (prompt.trim().length === 0) return yield* Effect.fail(AppError.make({ operation: "prompt Pi", message: "Add a message or image before sending" }))
      let promptStartPending = true
      const finishPromptStart = () => {
        if (!promptStartPending) return
        promptStartPending = false
        active.pendingPromptStarts -= 1
      }
      yield* Effect.sync(() => {
        active.pendingPromptStarts += 1
      })
      yield* Effect.gen(function*() {
        const images = yield* Effect.all(paths.map((path) => attachments.readForPi(path))).pipe(
          Effect.mapError((error) => AppError.make({ operation: "read image attachment", message: error.message }))
        )

        const operation = yield* sessionLifecycleLock.withPermit(queueMutationLock.withPermit(Effect.gen(function*() {
          if (activeSessions.get(requestedPath) !== active) {
            return yield* Effect.fail(AppError.make({ operation: "prompt Pi", message: "The session changed before the message could be sent" }))
          }
          if (active.session.isStreaming) {
            const error = queueabilityError(active.session, prompt)
            if (error) return yield* Effect.fail(error)
            yield* Effect.tryPromise({
              try: () => delivery === "steer" ? active.session.steer(prompt, images) : active.session.followUp(prompt, images),
              catch: toAppError(delivery === "steer" ? "steer Pi" : "queue follow-up Pi message")
            })
            if (refreshQueuedMessages(active)) yield* emitQueuedMessages(active)
            if (images.length > 0) {
              const queuedMessage = [...active.queuedMessages].reverse().find((message) =>
                message.delivery === delivery && message.text === prompt && !active.queuedImages.has(message.id)
              )
              if (queuedMessage) active.queuedImages.set(queuedMessage.id, images)
            }
            return { kind: "queued" } as const
          }

          const run = yield* Effect.try({
            try: () => active.session.prompt(prompt, {
              ...(images.length > 0 ? { images } : {}),
              preflightResult: finishPromptStart
            }),
            catch: toAppError("prompt Pi")
          })
          return { kind: "started", run } as const
        })))

        if (operation.kind === "queued") return
        yield* Effect.tryPromise({ try: () => operation.run, catch: toAppError("prompt Pi") })
      }).pipe(Effect.ensuring(Effect.sync(finishPromptStart)))
    }),
    editQueuedMessage: Effect.fn("PiSessions.editQueuedMessage")(function*(cwd: string, sessionPath: string, messageId: string, text: string) {
      const requestedPath = canonicalPath(sessionPath)
      yield* queueMutationLock.withPermit(Effect.gen(function*() {
        const active = yield* activeForWorktree(cwd, requestedPath, "edit queued Pi message")
        if (refreshQueuedMessages(active)) yield* emitQueuedMessages(active)
        if (!active.session.isStreaming) {
          return yield* Effect.fail(AppError.make({ operation: "edit queued Pi message", message: "Pi already settled before this queued message could be edited" }))
        }
        const message = active.queuedMessages.find((candidate) => candidate.id === messageId)
        if (!message) return yield* Effect.fail(AppError.make({ operation: "edit queued Pi message", message: "That queued message has already been delivered or removed" }))
        if (parseImagePathReferences(message.text).length > 0) {
          return yield* Effect.fail(AppError.make({ operation: "edit queued Pi message", message: "Queued messages with image attachments cannot be edited; remove and resend the message instead" }))
        }
        const error = queueabilityError(active.session, text)
        if (error) return yield* Effect.fail(error)
        yield* replaceNativeQueue(active, updateQueuedMessageText(active.queuedMessages, message.id, text))
      }))
    }),
    removeQueuedMessage: Effect.fn("PiSessions.removeQueuedMessage")(function*(cwd: string, sessionPath: string, messageId: string) {
      const requestedPath = canonicalPath(sessionPath)
      yield* queueMutationLock.withPermit(Effect.gen(function*() {
        const active = yield* activeForWorktree(cwd, requestedPath, "remove queued Pi message")
        if (refreshQueuedMessages(active)) yield* emitQueuedMessages(active)
        if (!active.session.isStreaming) {
          return yield* Effect.fail(AppError.make({ operation: "remove queued Pi message", message: "Pi already settled before this queued message could be removed" }))
        }
        const message = active.queuedMessages.find((candidate) => candidate.id === messageId)
        if (!message) return yield* Effect.fail(AppError.make({ operation: "remove queued Pi message", message: "That queued message has already been delivered or removed" }))
        yield* replaceNativeQueue(active, removeQueuedMessage(active.queuedMessages, message.id))
      }))
    }),
    steerQueuedMessage: Effect.fn("PiSessions.steerQueuedMessage")(function*(cwd: string, sessionPath: string, messageId: string) {
      const requestedPath = canonicalPath(sessionPath)
      yield* queueMutationLock.withPermit(Effect.gen(function*() {
        const active = yield* activeForWorktree(cwd, requestedPath, "steer queued Pi message")
        if (refreshQueuedMessages(active)) yield* emitQueuedMessages(active)
        if (!active.session.isStreaming) {
          return yield* Effect.fail(AppError.make({ operation: "steer queued Pi message", message: "Pi already settled before this message could be steered" }))
        }
        const message = active.queuedMessages.find((candidate) => candidate.id === messageId)
        if (!message) return yield* Effect.fail(AppError.make({ operation: "steer queued Pi message", message: "That queued message has already been delivered or removed" }))
        yield* replaceNativeQueue(active, prioritizeQueuedMessageForSteering(active.queuedMessages, message.id))
      }))
    }),
    abort: Effect.fn("PiSessions.abort")(function*(cwd: string, sessionPath: string) {
      const active = yield* activeForWorktree(cwd, sessionPath, "abort Pi")
      active.interaction.cancelPending()
      yield* Effect.tryPromise({ try: () => active.session.abort(), catch: toAppError("abort Pi") })
    }),
    models: Effect.fn("PiSessions.models")(function*(cwd: string, sessionPath: string) {
      const active = yield* activeForWorktree(cwd, sessionPath, "list models")
      const models = yield* Effect.tryPromise({ try: () => active.session.modelRuntime.getAvailable(), catch: toAppError("list models") })
      return models.map((model) => ({ provider: model.provider, id: model.id, name: model.name }))
    }),
    setModel: Effect.fn("PiSessions.setModel")(function*(cwd: string, sessionPath: string, provider: string, modelId: string) {
      const active = yield* activeForWorktree(cwd, sessionPath, "set model")
      const available = yield* Effect.tryPromise({ try: () => active.session.modelRuntime.getAvailable(), catch: toAppError("list models") })
      const model = available.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      if (!model) return yield* Effect.fail(AppError.make({ operation: "set model", message: "The selected model is unavailable" }))
      yield* Effect.tryPromise({ try: () => active.session.setModel(model), catch: toAppError("set model") })
      yield* emitSnapshot(active)
      return detailFromActive(active)
    }),
    setThinkingLevel: Effect.fn("PiSessions.setThinkingLevel")(function*(cwd: string, sessionPath: string, level: ThinkingLevel) {
      const active = yield* activeForWorktree(cwd, sessionPath, "set effort")
      const supported: ReadonlyArray<string> = active.session.getAvailableThinkingLevels()
      if (!supported.includes(level)) {
        return yield* Effect.fail(AppError.make({ operation: "set effort", message: `Effort ${level} is unavailable for this model` }))
      }
      yield* Effect.sync(() => active.session.setThinkingLevel(level))
      yield* emitSnapshot(active)
      return detailFromActive(active)
    }),
    answerInteraction: Effect.fn("PiSessions.answerInteraction")(function*(cwd: string, sessionPath: string, requestId: string, answer: AskUserInteractionAnswer) {
      const active = yield* activeForWorktree(cwd, sessionPath, "answer Pi interaction")
      yield* Effect.try({
        try: () => active.interaction.answer(requestId, answer),
        catch: toAppError("answer Pi interaction")
      })
    }),
    dispose: Effect.fn("PiSessions.dispose")(function*() {
      yield* sessionLifecycleLock.withPermit(queueMutationLock.withPermit(Effect.gen(function*() {
        const active = [...activeSessions.values()]
        activeSessions.clear()
        yield* Effect.promise(() => Promise.all(active.map(releaseActiveSession)).then(() => undefined))
      })))
    })
  }
}))
