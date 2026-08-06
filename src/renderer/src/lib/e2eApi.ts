import { Schema } from "effect"
import { AskUserInteractionRequestSchema } from "../../../shared/interaction"
import type { AskUserInteractionAnswer, AskUserInteractionRequest, GitDiff, PiDesktopApi, SessionDetail, SessionEvent } from "../../../shared/contracts"

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
  parentSessionPath: Schema.optionalKey(Schema.String)
})
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const QueueDeliverySchema = Schema.Literals(["follow-up", "steer"])
const QueuedMessageSchema = Schema.Struct({ id: Schema.String, delivery: QueueDeliverySchema, text: Schema.String })
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
  contextUsage: Schema.optionalKey(ContextUsageSchema),
  interactionRequest: Schema.optionalKey(AskUserInteractionRequestSchema),
  runtimeStatus: Schema.Literals(["running", "input-required", "waiting", "done", "failed"]),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.Boolean
})
const ModelOptionSchema = Schema.Struct({ provider: Schema.String, id: Schema.String, name: Schema.String })
const FixtureSchema = Schema.Struct({
  generatedAt: Schema.Number,
  activeWorktreeId: Schema.String,
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
  const isActiveFixtureContext = (data: E2eFixture, context: { readonly projectId: string; readonly worktreeId: string }) =>
    data.projects.some((project) => project.id === context.projectId) && context.worktreeId === data.activeWorktreeId

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

  const answerInteraction = async (_context: unknown, sessionPath: string, requestId: string, answer: AskUserInteractionAnswer): Promise<void> => {
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
      inspect: async (_context, sessionPath, messageId) => {
        const detail = (await loadFixture()).details.find((candidate) => candidate.summary.path === sessionPath)
        const message = detail?.messages.find((candidate) => candidate.id === messageId)
        const summary = message?.blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n\n").trim()
        if (!detail || !summary) throw new Error("The selected Pi response is unavailable")
        return {
          repository: "celeroncoder/pigui",
          repositoryUrl: "https://github.com/celeroncoder/pigui",
          branch: "codex/browser-review",
          baseBranch: "main",
          commit: "a1b2c3d4e5f6",
          compareUrl: "https://github.com/celeroncoder/pigui/compare/main...codex/browser-review",
          committedFiles: 4,
          additions: 128,
          deletions: 17,
          commits: 2,
          hasUncommittedChanges: true,
          summary,
          sessionName: detail.summary.name
        }
      },
      comment: async () => ({ url: "https://github.com/celeroncoder/pigui/issues/17#issuecomment-browser-review" }),
      createOrUpdateDraft: async () => ({ number: 117, title: "Browser review draft", url: "https://github.com/celeroncoder/pigui/pull/117", isDraft: true, action: "created" })
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
        return {
          path: worktree.path,
          folderName: worktree.name,
          worktreeKind: worktree.kind === "linked" ? "linked" : "local",
          branch: worktree.branch,
          baseBranches: worktree.kind === "linked" ? ["origin/main", "main"] : [],
          ...(worktree.kind === "linked" ? { defaultBaseBranch: "origin/main" } : {}),
          setupEnvironment: { name: "E2E", configPath: `${worktree.path}/.codex/environments/environment.toml` }
        }
      }
    },
    sessions: {
      list: async (context) => {
        const data = await loadFixture()
        return isActiveFixtureContext(data, context) ? data.sessions : []
      },
      start: async () => Promise.reject(new Error("Session creation is tested in Electron, not the browser review harness")),
      open: async (context, sessionPath) => {
        const data = await loadFixture()
        const detail = isActiveFixtureContext(data, context) ? data.details.find((item) => item.summary.path === sessionPath) : undefined
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
      editQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      removeQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      steerQueuedMessage: async () => Promise.reject(new Error("Queue controls are tested in Electron, not the browser review harness")),
      abort: async () => undefined,
      models: async () => (await loadFixture()).models,
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
