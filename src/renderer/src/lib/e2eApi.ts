import { Schema } from "effect"
import type { PiDesktopApi, SessionDetail } from "../../../shared/contracts"

const GitStatusSchema = Schema.Struct({ branch: Schema.String, additions: Schema.Number, deletions: Schema.Number })
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
  parentSessionPath: Schema.optional(Schema.String)
})
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const MessageBlockSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thinking"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("compaction"), status: Schema.Literals(["compacting", "compacted"]) }),
  Schema.Struct({ type: Schema.Literal("tool-call"), id: Schema.String, name: Schema.String, input: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool-result"), id: Schema.String, name: Schema.String, output: Schema.String, isError: Schema.Boolean, diff: Schema.optional(Schema.String) })
])
const ChatMessageSchema = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "tool", "system"]),
  blocks: Schema.Array(MessageBlockSchema),
  timestamp: Schema.Number,
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String)
})
const BackgroundProcessSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  command: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Number),
  status: Schema.Literals(["running", "done", "failed", "killed", "stopped"]),
  output: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  updatedAt: Schema.Number
})
const SessionDetailSchema = Schema.Struct({
  summary: SessionSummarySchema,
  messages: Schema.Array(ChatMessageSchema),
  model: Schema.String,
  thinkingLevel: ThinkingLevelSchema,
  availableThinkingLevels: Schema.Array(ThinkingLevelSchema),
  backgroundProcesses: Schema.Array(BackgroundProcessSchema),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.Boolean
})
const ModelOptionSchema = Schema.Struct({ provider: Schema.String, id: Schema.String, name: Schema.String })
const FixtureSchema = Schema.Struct({
  generatedAt: Schema.Number,
  projects: Schema.Array(ProjectSchema),
  sessions: Schema.Array(SessionSummarySchema),
  details: Schema.Array(SessionDetailSchema),
  models: Schema.Array(ModelOptionSchema)
})

let fixture: Promise<Schema.Schema.Type<typeof FixtureSchema>> | undefined

const loadFixture = () => fixture ??= fetch("/pi-e2e.json")
  .then((response) => {
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("Pi preload is unavailable. For browser review, run `npm run e2e:serve`.")
    }
    return response.json()
  })
  .then(Schema.decodeUnknownPromise(FixtureSchema))

export const createE2eApi = (): PiDesktopApi => ({
  attachments: {
    save: async () => Promise.reject(new Error("Image attachments are tested in Electron, not the browser review harness")),
    preview: async () => Promise.reject(new Error("Local image previews are unavailable in the browser review harness"))
  },
  projects: {
    list: async () => (await loadFixture()).projects,
    add: async () => (await loadFixture()).projects[0] ?? null,
    remove: async () => undefined,
    refreshGit: async (projectPath) => (await loadFixture()).projects.find((project) => project.path === projectPath)?.git
  },
  sessions: {
    list: async () => (await loadFixture()).sessions,
    create: async () => Promise.reject(new Error("Session creation is tested in Electron, not the browser review harness")),
    open: async (_projectPath, sessionPath) => {
      const detail = (await loadFixture()).details.find((item) => item.summary.path === sessionPath)
      if (!detail) throw new Error("The generated Pi session snapshot is unavailable")
      return detail
    },
    inspect: async (_projectPath, parentSessionPath, sessionPath) => {
      const detail = (await loadFixture()).details.find((item) => item.summary.path === sessionPath && item.summary.parentSessionPath === parentSessionPath)
      if (!detail) throw new Error("The generated linked Pi session snapshot is unavailable")
      return detail
    },
    prompt: async () => Promise.reject(new Error("Live prompting is tested in Electron, not the browser review harness")),
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
    }
  },
  onSessionEvent: () => () => undefined
})
