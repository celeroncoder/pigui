import { join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { IpcChannels, type Project, type ProjectWorktree } from "../shared/contracts"
import { AskUserInteractionAnswerSchema } from "../shared/interaction"
import { AppError, toAppError } from "./services/AppError"
import { AttachmentStore, AttachmentStoreLive } from "./services/AttachmentStore"
import { GitContext, GitContextLive } from "./services/GitContext"
import { GitHubWorkflow, GitHubWorkflowLive } from "./services/GitHubWorkflow"
import { PiSessions, PiSessionsLive } from "./services/PiSessions"
import { ProjectStore, ProjectStoreLive } from "./services/ProjectStore"
import { WindowBus, WindowBusLive } from "./services/WindowBus"

const NonEmptyString = Schema.NonEmptyString
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const AttachmentSaveSchema = Schema.Struct({
  bytes: Schema.Uint8Array,
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String)
})
const AttachmentPathsSchema = Schema.Array(NonEmptyString)
const QueueDeliverySchema = Schema.Literals(["follow-up", "steer"])
const WorktreeContextSchema = Schema.Struct({
  projectId: NonEmptyString,
  worktreeId: NonEmptyString
})

const invalidIpcInput = (error: { readonly message: string }) => AppError.make({ operation: "validate IPC input", message: error.message })
const decodeString = (input: unknown) => Schema.decodeUnknownEffect(NonEmptyString)(input).pipe(Effect.mapError(invalidIpcInput))
const decodePromptText = (input: unknown) => Schema.decodeUnknownEffect(Schema.String)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeThinkingLevel = (input: unknown) => Schema.decodeUnknownEffect(ThinkingLevelSchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeAttachmentSave = (input: unknown) => Schema.decodeUnknownEffect(AttachmentSaveSchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeAttachmentPaths = (input: unknown) => Schema.decodeUnknownEffect(Schema.Union([AttachmentPathsSchema, Schema.Undefined]))(input).pipe(Effect.mapError(invalidIpcInput))
const decodeQueueDelivery = (input: unknown) => Schema.decodeUnknownEffect(QueueDeliverySchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeMessageText = Effect.fn("decodeMessageText")(function*(input: unknown) {
  const text = yield* decodeString(input)
  const normalized = text.trim()
  if (!normalized) return yield* Effect.fail(AppError.make({ operation: "validate IPC input", message: "Message text cannot be blank" }))
  return normalized
})

const AppDependencies = Layer.mergeAll(WindowBusLive, GitContextLive, AttachmentStoreLive, GitHubWorkflowLive)
const AppServices = Layer.mergeAll(ProjectStoreLive, PiSessionsLive)
const AppLayer = Layer.provideMerge(AppServices, AppDependencies)
const runtime = ManagedRuntime.make(AppLayer)
let isShuttingDown = false

const run = async <A, E>(effect: Effect.Effect<A, E, ProjectStore | PiSessions | GitContext | GitHubWorkflow | AttachmentStore | WindowBus>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  if (isShuttingDown && Cause.hasInterruptsOnly(exit.cause)) {
    throw AppError.make({ operation: "application", message: "Pi Desktop is shutting down" })
  }
  throw Cause.squash(exit.cause)
}

const resolveKnownWorktree = Effect.fn("resolveKnownWorktree")(function*(input: unknown) {
  const context = yield* Schema.decodeUnknownEffect(WorktreeContextSchema)(input).pipe(Effect.mapError(invalidIpcInput))
  const store = yield* ProjectStore
  return { ...(yield* store.resolve(context.projectId, context.worktreeId)), context }
})

const enrichWorktree = Effect.fn("enrichWorktree")(function*(worktree: ProjectWorktree) {
  const git = yield* GitContext
  const status = yield* git.inspect(worktree.path).pipe(
    Effect.catchTag("GitContextError", () => Effect.succeed(undefined))
  )
  return status ? { ...worktree, branch: status.branch, git: status } : worktree
})

const enrichProject = Effect.fn("enrichProject")(function*(project: Project) {
  const worktrees = yield* Effect.forEach(project.worktrees, enrichWorktree, { concurrency: 4 })
  return { ...project, worktrees }
})

const listProjectsWithGit = Effect.fn("listProjectsWithGit")(function*() {
  const store = yield* ProjectStore
  const projects = yield* store.list()
  return yield* Effect.forEach(projects, enrichProject, { concurrency: 4 })
})

const resolveGitHubSummary = Effect.fn("resolveGitHubSummary")(function*(context: unknown, sessionPath: unknown, messageId: unknown) {
  const { worktree } = yield* resolveKnownWorktree(context)
  const path = yield* decodeString(sessionPath)
  const id = yield* decodeString(messageId)
  const sessions = yield* PiSessions
  const summary = yield* sessions.shareSummary(worktree.path, path, id)
  return { cwd: worktree.path, summary }
})

const appIconPath = join(__dirname, "../renderer/pi-icon.png")

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 860,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: "#0b0c0d",
    icon: appIconPath,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  window.once("ready-to-show", () => window.show())
  if (process.env.NODE_ENV !== "production") {
    window.webContents.once("did-finish-load", () => {
      void window.webContents.executeJavaScript("typeof window.piDesktop !== 'undefined'").then((bridgeReady) => {
        console.info(`[pi-desktop] preload bridge: ${bridgeReady ? "ready" : "missing"}`)
      })
    })
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

const registerIpc = () => {
  ipcMain.handle(IpcChannels.listProjects, () => run(listProjectsWithGit()))

  ipcMain.handle(IpcChannels.addProject, () => run(Effect.gen(function*() {
    const result = yield* Effect.tryPromise({
      try: () => dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Add a project or Git worktree" }),
      catch: toAppError("choose project folder")
    })
    const folderPath = result.filePaths[0]
    if (result.canceled || !folderPath) return null
    const store = yield* ProjectStore
    const selection = yield* store.add(folderPath)
    const project = yield* enrichProject(selection.project)
    const worktree = project.worktrees.find((candidate) => candidate.id === selection.worktree.id)
    if (!worktree) return yield* Effect.fail(AppError.make({ operation: "add project worktree", message: "The selected worktree was not persisted" }))
    return { project, worktree }
  })))

  ipcMain.handle(IpcChannels.removeProject, (_event, projectId: unknown) => run(Effect.gen(function*() {
    const id = yield* decodeString(projectId)
    const store = yield* ProjectStore
    yield* store.remove(id)
  })))

  ipcMain.handle(IpcChannels.refreshProjectGit, (_event, context: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const git = yield* GitContext
    return yield* git.inspect(worktree.path)
  })))

  ipcMain.handle(IpcChannels.gitDiff, (_event, context: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const git = yield* GitContext
    return yield* git.diff(worktree.path)
  })))

  ipcMain.handle(IpcChannels.sessionDraft, (_event, input: unknown) => run(Effect.gen(function*() {
    const { context } = yield* resolveKnownWorktree(input)
    const store = yield* ProjectStore
    return yield* store.sessionDraft(context.projectId, context.worktreeId)
  })))

  ipcMain.handle(IpcChannels.inspectGitHubBranchPullRequest, (_event, context: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const github = yield* GitHubWorkflow
    return yield* github.branchPullRequest(worktree.path)
  })))

  ipcMain.handle(IpcChannels.inspectGitHubWorkflow, (_event, context: unknown, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const { cwd, summary } = yield* resolveGitHubSummary(context, sessionPath, messageId)
    const github = yield* GitHubWorkflow
    return yield* github.inspect(cwd, summary)
  })))

  ipcMain.handle(IpcChannels.postGitHubComment, (_event, context: unknown, sessionPath: unknown, messageId: unknown, target: unknown) => run(Effect.gen(function*() {
    const { cwd, summary } = yield* resolveGitHubSummary(context, sessionPath, messageId)
    const requestedTarget = yield* decodeString(target)
    const github = yield* GitHubWorkflow
    return yield* github.comment(cwd, summary, requestedTarget)
  })))

  ipcMain.handle(IpcChannels.createOrUpdateGitHubDraft, (_event, context: unknown, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const { cwd, summary } = yield* resolveGitHubSummary(context, sessionPath, messageId)
    const github = yield* GitHubWorkflow
    return yield* github.createOrUpdateDraft(cwd, summary)
  })))

  ipcMain.handle(IpcChannels.listSessions, (_event, context: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const sessions = yield* PiSessions
    return yield* sessions.list(worktree.path)
  })))

  ipcMain.handle(IpcChannels.startSession, (_event, input: unknown, requestIdInput: unknown, text: unknown, baseBranch: unknown, attachmentPaths: unknown) => run(Effect.gen(function*() {
    const { worktree, context } = yield* resolveKnownWorktree(input)
    const requestId = yield* decodeString(requestIdInput)
    const prompt = yield* decodePromptText(text)
    const paths = yield* decodeAttachmentPaths(attachmentPaths)
    const store = yield* ProjectStore
    const sessions = yield* PiSessions
    const draft = yield* store.sessionDraft(context.projectId, context.worktreeId)
    const fallbackBaseBranch = draft.defaultBaseBranch ?? draft.baseBranches[0]
    const selectedBaseBranch = worktree.kind === "linked"
      ? yield* (baseBranch === undefined
          ? fallbackBaseBranch
            ? Effect.succeed(fallbackBaseBranch)
            : Effect.fail(AppError.make({ operation: "validate base branch", message: "No base branch is available for this linked worktree" }))
          : decodeString(baseBranch)).pipe(Effect.flatMap((candidate) => draft.baseBranches.includes(candidate)
          ? Effect.succeed(candidate)
          : Effect.fail(AppError.make({ operation: "validate base branch", message: "The selected base branch is no longer available" }))))
      : undefined
    const existing = yield* sessions.list(worktree.path)
    if (worktree.kind === "linked" && existing.length === 0) {
      yield* store.setupWorktree(context.projectId, context.worktreeId)
    }
    const detail = yield* sessions.create(worktree.path, selectedBaseBranch)
    const bus = yield* WindowBus
    yield* bus.emit({ type: "session-started", requestId, context, detail })
    yield* sessions.prompt(worktree.path, detail.summary.path, prompt, "follow-up", paths ?? [])
    return detail
  })))

  ipcMain.handle(IpcChannels.openSession, (_event, context: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.open(worktree.path, path)
  })))

  ipcMain.handle(IpcChannels.inspectSession, (_event, context: unknown, parentSessionPath: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const parentPath = yield* decodeString(parentSessionPath)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.inspect(worktree.path, parentPath, path)
  })))

  ipcMain.handle(IpcChannels.promptSession, (_event, context: unknown, sessionPath: unknown, text: unknown, delivery: unknown, attachmentPaths: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const prompt = yield* decodePromptText(text)
    const queueDelivery = yield* decodeQueueDelivery(delivery === undefined ? "follow-up" : delivery)
    const paths = yield* decodeAttachmentPaths(attachmentPaths)
    const sessions = yield* PiSessions
    yield* sessions.prompt(worktree.path, path, prompt, queueDelivery, paths ?? [])
  })))

  ipcMain.handle(IpcChannels.editQueuedMessage, (_event, context: unknown, sessionPath: unknown, messageId: unknown, text: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const message = yield* decodeMessageText(text)
    const sessions = yield* PiSessions
    yield* sessions.editQueuedMessage(worktree.path, path, id, message)
  })))

  ipcMain.handle(IpcChannels.removeQueuedMessage, (_event, context: unknown, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const sessions = yield* PiSessions
    yield* sessions.removeQueuedMessage(worktree.path, path, id)
  })))

  ipcMain.handle(IpcChannels.steerQueuedMessage, (_event, context: unknown, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const sessions = yield* PiSessions
    yield* sessions.steerQueuedMessage(worktree.path, path, id)
  })))

  ipcMain.handle(IpcChannels.saveAttachment, (_event, input: unknown) => run(Effect.gen(function*() {
    const payload = yield* decodeAttachmentSave(input)
    const attachments = yield* AttachmentStore
    return yield* attachments.save(payload.bytes, payload.name, payload.mimeType)
  })))

  ipcMain.handle(IpcChannels.previewAttachment, (_event, path: unknown) => run(Effect.gen(function*() {
    const requestedPath = yield* decodeString(path)
    const attachments = yield* AttachmentStore
    return yield* attachments.preview(requestedPath)
  })))

  ipcMain.handle(IpcChannels.abortSession, (_event, context: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    yield* sessions.abort(worktree.path, path)
  })))

  ipcMain.handle(IpcChannels.listModels, (_event, context: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.models(worktree.path, path)
  })))

  ipcMain.handle(IpcChannels.setModel, (_event, context: unknown, sessionPath: unknown, provider: unknown, modelId: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const selectedProvider = yield* decodeString(provider)
    const selectedModel = yield* decodeString(modelId)
    const sessions = yield* PiSessions
    return yield* sessions.setModel(worktree.path, path, selectedProvider, selectedModel)
  })))

  ipcMain.handle(IpcChannels.setThinkingLevel, (_event, context: unknown, sessionPath: unknown, level: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const selectedLevel = yield* decodeThinkingLevel(level)
    const sessions = yield* PiSessions
    return yield* sessions.setThinkingLevel(worktree.path, path, selectedLevel)
  })))

  ipcMain.handle(IpcChannels.answerInteraction, (_event, context: unknown, sessionPath: unknown, requestId: unknown, answer: unknown) => run(Effect.gen(function*() {
    const { worktree } = yield* resolveKnownWorktree(context)
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(requestId)
    const selectedAnswer = yield* Schema.decodeUnknownEffect(AskUserInteractionAnswerSchema)(answer).pipe(
      Effect.mapError(toAppError("validate Pi interaction answer"))
    )
    const sessions = yield* PiSessions
    yield* sessions.answerInteraction(worktree.path, path, id, selectedAnswer)
  })))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(nativeImage.createFromPath(appIconPath))
  registerIpc()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  if (isShuttingDown) return
  isShuttingDown = true
  void runtime.runPromise(Effect.gen(function*() {
    const sessions = yield* PiSessions
    yield* sessions.dispose()
  })).finally(() => runtime.dispose())
})
