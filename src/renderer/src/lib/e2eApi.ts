import { Schema } from "effect"
import { AskUserInteractionRequestSchema } from "../../../shared/interaction"
import type { AskUserInteractionAnswer, GitDiff, PiDesktopApi, SessionDetail, SessionEvent, WorktreeContext } from "../../../shared/contracts"

const GitStatusSchema = Schema.Struct({ branch: Schema.String, additions: Schema.Number, deletions: Schema.Number, changedFiles: Schema.Number })
const ProjectWorktreeSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  addedAt: Schema.Number,
  kind: Schema.optionalKey(Schema.Literals(["local", "linked"])),
  git: Schema.optionalKey(GitStatusSchema)
})
const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  addedAt: Schema.Number,
  worktrees: Schema.Array(ProjectWorktreeSchema)
})
const SessionSummarySchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  firstMessage: Schema.String,
  updatedAt: Schema.Number,
  messageCount: Schema.Number,
  parentSessionPath: Schema.optionalKey(Schema.String),
  forkedFrom: Schema.optionalKey(Schema.Struct({
    sourceSessionId: Schema.String,
    sourceSessionPath: Schema.String,
    sourceSessionName: Schema.String,
    sourceMessageIndex: Schema.Number,
    sourceMessageId: Schema.String
  }))
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
  runtimeStatus: Schema.Literals(["running", "input-required", "waiting", "done", "failed"]),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.Boolean
})
const ModelOptionSchema = Schema.Struct({ provider: Schema.String, id: Schema.String, name: Schema.String })
const PiCommandSchema = Schema.Struct({
  kind: Schema.Literals(["prompt", "skill"]),
  name: Schema.String,
  description: Schema.String,
  argumentHint: Schema.optionalKey(Schema.String),
  scope: Schema.Literals(["user", "project", "other"])
})
const TokenUsageSchema = Schema.Struct({ input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number, total: Schema.Number })
const ProjectMetricsSchema = Schema.Struct({
  generatedAt: Schema.Number,
  sessionCount: Schema.Number,
  completedSessions: Schema.Number,
  successfulSessions: Schema.Number,
  failedSessions: Schema.Number,
  incompleteSessions: Schema.Number,
  successRate: Schema.Union([Schema.Number, Schema.Null]),
  averageCompletionMs: Schema.Union([Schema.Number, Schema.Null]),
  tokenUsage: TokenUsageSchema,
  modelUsage: Schema.Array(Schema.Struct({
    model: Schema.String,
    sessions: Schema.Number,
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    total: Schema.Number
  })),
  failureReasons: Schema.Array(Schema.Struct({ reason: Schema.String, count: Schema.Number }))
})
const FixtureSchema = Schema.Struct({
  generatedAt: Schema.Number,
  activeWorktreeId: Schema.String,
  projects: Schema.Array(ProjectSchema),
  sessions: Schema.Array(SessionSummarySchema),
  details: Schema.Array(SessionDetailSchema),
  models: Schema.Array(ModelOptionSchema),
  commands: Schema.Array(PiCommandSchema),
  metrics: ProjectMetricsSchema,
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
  const isActiveFixtureContext = (data: E2eFixture, context: { readonly projectId: string; readonly worktreeId: string }) =>
    data.projects.some((project) => project.id === context.projectId) && context.worktreeId === data.activeWorktreeId
  let forkedDetail: SessionDetail | undefined

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

  const answerInteraction = async (_context: WorktreeContext, sessionPath: string, requestId: string, answer: AskUserInteractionAnswer): Promise<void> => {
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
    github: {
      branchPullRequest: async (context) => {
        const data = await loadFixture()
        const worktree = data.projects.find((project) => project.id === context.projectId)?.worktrees.find((candidate) => candidate.id === context.worktreeId)
        if (!worktree || worktree.kind !== "linked") return null
        return { number: 37, title: "Browser review PR", url: "https://github.com/celeroncoder/pigui/pull/37", branch: worktree.git?.branch ?? worktree.branch, state: "mergeable" }
      },
      worktree: async (context) => {
        const data = await loadFixture()
        const worktree = data.projects.find((project) => project.id === context.projectId)?.worktrees.find((candidate) => candidate.id === context.worktreeId)
        if (!worktree) throw new Error("The generated worktree snapshot is unavailable")
        const changes = worktree.git ?? { branch: worktree.branch, additions: 0, deletions: 0, changedFiles: 0 }
        const pullRequest = worktree.kind === "linked" ? { number: 37, title: "Add worktree-aware GitHub workflow", url: "https://github.com/celeroncoder/pigui/pull/37", branch: changes.branch, state: "mergeable" as const } : undefined
        return {
          repository: "celeroncoder/pigui",
          repositoryUrl: "https://github.com/celeroncoder/pigui",
          branch: changes.branch,
          path: worktree.path,
          worktreeKind: worktree.kind === "linked" ? "linked" : "local",
          changes,
          hasUpstream: true,
          ahead: 1,
          pullRequest
        }
      },
      commitOrPush: async () => Promise.reject(new Error("Git mutations are tested in Electron, not the browser review harness"))
    },
    projects: {
      list: async () => (await loadFixture()).projects,
      add: async () => {
        const project = (await loadFixture()).projects[0]
        const worktree = project?.worktrees[0]
        return project && worktree ? { project, worktree } : null
      },
      remove: async () => undefined,
      refreshGit: async (context) => (await loadFixture()).projects.find((project) => project.id === context.projectId)?.worktrees.find((worktree) => worktree.id === context.worktreeId)?.git,
      diff: async (context): Promise<GitDiff | undefined> => {
        const data = await loadFixture()
        return data.projects.find((project) => project.id === context.projectId)?.worktrees.find((worktree) => worktree.id === context.worktreeId)?.git ? { files: [], truncated: false, omittedFiles: 0 } : undefined
      },
      sessionDraft: async (context) => {
        const data = await loadFixture()
        const worktree = data.projects.find((project) => project.id === context.projectId)?.worktrees.find((candidate) => candidate.id === context.worktreeId)
        if (!worktree) throw new Error("The generated worktree snapshot is unavailable")
        const defaultBaseBranch = worktree.kind === "linked" ? "origin/main" : undefined
        return {
          path: worktree.path,
          folderName: worktree.name,
          worktreeKind: worktree.kind === "linked" ? "linked" : "local",
          branch: worktree.branch,
          baseBranches: worktree.kind === "linked" ? ["origin/main", "main"] : [],
          defaultBaseBranch,
          setupEnvironment: { name: "E2E", configPath: `${worktree.path}/.codex/environments/environment.toml` }
        }
      },
      metrics: async () => (await loadFixture()).metrics
    },
    sessions: {
      list: async (context) => {
        const data = await loadFixture()
        return isActiveFixtureContext(data, context) ? (forkedDetail ? [forkedDetail.summary, ...data.sessions] : data.sessions) : []
      },
      start: async () => Promise.reject(new Error("Session creation is tested in Electron, not the browser review harness")),
      fork: async (context, sessionPath, messageId) => {
        const data = await loadFixture()
        if (!isActiveFixtureContext(data, context)) throw new Error("The generated worktree snapshot is unavailable")
        const source = forkedDetail?.summary.path === sessionPath
          ? forkedDetail
          : data.details.find((item) => item.summary.path === sessionPath)
        if (!source) throw new Error("The generated Pi session snapshot is unavailable")
        const messageIndex = source.messages.filter((message) => message.role === "user" || message.role === "assistant").findIndex((message) => message.id === messageId)
        if (messageIndex < 0) throw new Error("The selected fixture message cannot be forked")
        const retainedIds = new Set(source.messages.slice(0, source.messages.findIndex((message) => message.id === messageId) + 1).map((message) => message.id))
        const forkPath = `${sessionPath}.fork-${messageId}`
        forkedDetail = {
          ...source,
          summary: {
            ...source.summary,
            id: `fork-${source.summary.id}-${messageId}`,
            path: forkPath,
            updatedAt: Date.now(),
            messageCount: retainedIds.size,
            forkedFrom: {
              sourceSessionId: source.summary.id,
              sourceSessionPath: source.summary.path,
              sourceSessionName: source.summary.name,
              sourceMessageIndex: messageIndex + 1,
              sourceMessageId: messageId
            }
          },
          messages: source.messages.filter((message) => retainedIds.has(message.id)),
          backgroundProcesses: [],
          queuedMessages: [],
          runtimeStatus: "done",
          isStreaming: false,
          isCompacting: false
        }
        return forkedDetail
      },
      open: async (context, sessionPath) => {
        const data = await loadFixture()
        const detail = isActiveFixtureContext(data, context)
          ? (forkedDetail?.summary.path === sessionPath ? forkedDetail : data.details.find((item) => item.summary.path === sessionPath))
          : undefined
        if (!detail) throw new Error("The generated Pi session snapshot is unavailable")
        await seedInteraction()
        announceInteraction(sessionPath)
        return detail
      },
      inspect: async (context, parentSessionPath, sessionPath) => {
        const data = await loadFixture()
        const detail = isActiveFixtureContext(data, context) ? data.details.find((item) => item.summary.path === sessionPath && item.summary.parentSessionPath === parentSessionPath) : undefined
        if (!detail) throw new Error("The generated linked Pi session snapshot is unavailable")
        return detail
      },
      prompt: async () => Promise.reject(new Error("Live prompting is tested in Electron, not the browser review harness")),
      recover: async (_context, sessionPath, _action) => {
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
      models: async () => ({ models: (await loadFixture()).models, status: "ready" }),
      commands: async () => (await loadFixture()).commands,
      setModel: async (_context, sessionPath, provider, modelId) => {
        const data = await loadFixture()
        const current = data.details.find((item) => item.summary.path === sessionPath)
        if (!current) throw new Error("The generated Pi session snapshot is unavailable")
        const detail: SessionDetail = { ...current, model: `${provider}/${modelId}` }
        return detail
      },
      setThinkingLevel: async (_context, sessionPath, level) => {
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
