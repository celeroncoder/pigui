import { Schema } from "effect"
import { AskUserInteractionRequestSchema } from "../../../shared/interaction"
import type { AskUserInteractionAnswer, AskUserInteractionRequest, GitDiff, PiDesktopApi, SessionDetail, SessionEvent } from "../../../shared/contracts"

const GitStatusSchema = Schema.Struct({ branch: Schema.String, additions: Schema.Number, deletions: Schema.Number, changedFiles: Schema.Number })
const ProjectSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  addedAt: Schema.Number,
  git: Schema.optionalKey(GitStatusSchema)
})
const SessionSummarySchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  firstMessage: Schema.String,
  updatedAt: Schema.Number,
  messageCount: Schema.Number,
  parentSessionPath: Schema.optionalKey(Schema.String)
})
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const QueueDeliverySchema = Schema.Literals(["follow-up", "steer"])
const QueuedMessageSchema = Schema.Struct({ id: Schema.String, delivery: QueueDeliverySchema, text: Schema.String })
const SessionRecoverySchema = Schema.Struct({
  reason: Schema.String,
  interruptedAt: Schema.Number,
  lastPrompt: Schema.optionalKey(Schema.String)
})
const MessageBlockSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thinking"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("compaction"), status: Schema.Literals(["compacting", "compacted"]) }),
  Schema.Struct({ type: Schema.Literal("tool-call"), id: Schema.String, name: Schema.String, input: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool-result"), id: Schema.String, name: Schema.String, output: Schema.String, isError: Schema.Boolean, diff: Schema.optionalKey(Schema.String) })
])
const ChatMessageSchema = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "tool", "system"]),
  blocks: Schema.Array(MessageBlockSchema),
  timestamp: Schema.Number,
  model: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String)
})
const BackgroundProcessSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  command: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(Schema.Number),
  status: Schema.Literals(["running", "done", "failed", "killed", "stopped"]),
  output: Schema.optionalKey(Schema.String),
  exitCode: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  startedAt: Schema.Number,
  updatedAt: Schema.Number
})
const ContextUsageSchema = Schema.Struct({
  tokens: Schema.Union([Schema.Number, Schema.Null]),
  contextWindow: Schema.Number,
  percent: Schema.Union([Schema.Number, Schema.Null])
})
const SessionDetailSchema = Schema.Struct({
  summary: SessionSummarySchema,
  messages: Schema.Array(ChatMessageSchema),
  model: Schema.String,
  thinkingLevel: ThinkingLevelSchema,
  availableThinkingLevels: Schema.Array(ThinkingLevelSchema),
  backgroundProcesses: Schema.Array(BackgroundProcessSchema),
  queuedMessages: Schema.Array(QueuedMessageSchema),
  recovery: Schema.optionalKey(SessionRecoverySchema),
  contextUsage: Schema.optionalKey(ContextUsageSchema),
  interactionRequest: Schema.optionalKey(AskUserInteractionRequestSchema),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.Boolean
})
const ModelOptionSchema = Schema.Struct({ provider: Schema.String, id: Schema.String, name: Schema.String })
const FixtureSchema = Schema.Struct({
  generatedAt: Schema.Number,
  projects: Schema.Array(ProjectSchema),
  sessions: Schema.Array(SessionSummarySchema),
  details: Schema.Array(SessionDetailSchema),
  models: Schema.Array(ModelOptionSchema),
  interaction: Schema.optionalKey(Schema.Struct({
    sessionPath: Schema.String,
    request: AskUserInteractionRequestSchema
  }))
})
type E2eFixture = Schema.Schema.Type<typeof FixtureSchema>

type SessionEventListener = (event: SessionEvent) => void
let fixture: Promise<E2eFixture> | undefined

const loadFixture = () => fixture ??= fetch("/pi-e2e.json")
  .then((response) => {
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("Pi preload is unavailable. For browser review, run `npm run e2e:serve`.")
    }
    return response.json()
  })
  .then(Schema.decodeUnknownPromise(FixtureSchema))

export const createE2eApi = (): PiDesktopApi => {
  const listeners = new Set<SessionEventListener>()
  let interaction: E2eFixture["interaction"]
  let interactionSeeded = false
  let interactionAnnouncedPath: string | undefined
  let interactionDispatchPending = false

  const interactionEvent = (): SessionEvent | undefined => interaction
    ? { type: "interaction-request", sessionPath: interaction.sessionPath, request: interaction.request }
    : undefined

  const emit = (event: SessionEvent) => {
    for (const listener of listeners) listener(event)
  }

  const seedInteraction = async () => {
    if (interactionSeeded) return
    interactionSeeded = true
    const data = await loadFixture()
    interaction = data.interaction
  }

  const announceInteraction = (sessionPath: string) => {
    if (interaction?.sessionPath !== sessionPath || (interactionAnnouncedPath === sessionPath && interactionDispatchPending)) return
    interactionAnnouncedPath = sessionPath
    interactionDispatchPending = true
    window.setTimeout(() => {
      interactionDispatchPending = false
      const event = interactionEvent()
      if (event) emit(event)
    }, 250)
  }

  const answerInteraction = async (sessionPath: string, requestId: string, answer: AskUserInteractionAnswer): Promise<void> => {
    await seedInteraction()
    const current = interaction
    if (!current || current.sessionPath !== sessionPath || current.request.requestId !== requestId) {
      throw new Error("The generated ask_user fixture is no longer waiting for an answer")
    }
    if (answer.kind === "option" && (answer.optionIndex < 0 || answer.optionIndex >= current.request.options.length)) {
      throw new Error("The selected ask_user fixture option is unavailable")
    }
    if (answer.kind === "custom" && !answer.answer.trim()) {
      throw new Error("A custom ask_user fixture answer cannot be empty")
    }
    interaction = undefined
    interactionAnnouncedPath = undefined
    emit({ type: "interaction-cleared", sessionPath, requestId })
  }

  return {
    attachments: {
      save: async () => Promise.reject(new Error("Image attachments are tested in Electron, not the browser review harness")),
      preview: async () => Promise.reject(new Error("Local image previews are unavailable in the browser review harness"))
    },
    projects: {
      list: async () => (await loadFixture()).projects,
      add: async () => (await loadFixture()).projects[0] ?? null,
      remove: async () => undefined,
      refreshGit: async (projectPath) => (await loadFixture()).projects.find((project) => project.path === projectPath)?.git,
      diff: async (projectPath): Promise<GitDiff | undefined> => {
        const data = await loadFixture()
        return data.projects.find((project) => project.path === projectPath)?.git ? { files: [], truncated: false, omittedFiles: 0 } : undefined
      }
    },
    sessions: {
      list: async () => (await loadFixture()).sessions,
      create: async () => Promise.reject(new Error("Session creation is tested in Electron, not the browser review harness")),
      open: async (_projectPath, sessionPath) => {
        const detail = (await loadFixture()).details.find((item) => item.summary.path === sessionPath)
        if (!detail) throw new Error("The generated Pi session snapshot is unavailable")
        await seedInteraction()
        announceInteraction(sessionPath)
        return detail
      },
      inspect: async (_projectPath, parentSessionPath, sessionPath) => {
        const detail = (await loadFixture()).details.find((item) => item.summary.path === sessionPath && item.summary.parentSessionPath === parentSessionPath)
        if (!detail) throw new Error("The generated linked Pi session snapshot is unavailable")
        return detail
      },
      prompt: async () => Promise.reject(new Error("Live prompting is tested in Electron, not the browser review harness")),
      recover: async (sessionPath) => {
        const data = await loadFixture()
        const current = data.details.find((item) => item.summary.path === sessionPath)
        if (!current) throw new Error("The generated Pi session snapshot is unavailable")
        const detail: SessionDetail = { ...current, recovery: undefined }
        window.setTimeout(() => emit({ type: "session-state", sessionPath, detail }), 80)
        return detail
      },
      editQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      removeQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      steerQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      abort: async () => undefined,
      models: async () => (await loadFixture()).models,
      setModel: async (sessionPath, provider, modelId) => {
        const data = await loadFixture()
        const current = data.details.find((item) => item.summary.path === sessionPath)
        if (!current) throw new Error("The generated Pi session snapshot is unavailable")
        const detail: SessionDetail = { ...current, model: `${provider}/${modelId}` }
        return detail
      },
      setThinkingLevel: async (sessionPath, level) => {
        const data = await loadFixture()
        const current = data.details.find((item) => item.summary.path === sessionPath)
        if (!current) throw new Error("The generated Pi session snapshot is unavailable")
        const detail: SessionDetail = { ...current, thinkingLevel: level }
        return detail
      },
      answerInteraction
    },
    onSessionEvent: (listener) => {
      listeners.add(listener)
      void seedInteraction().then(() => {
        if (!interactionAnnouncedPath || interactionDispatchPending) return
        const event = interactionEvent()
        if (event) listener(event)
      }).catch(() => undefined)
      return () => listeners.delete(listener)
    }
  }
}
