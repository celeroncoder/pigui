import { join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { IpcChannels, type Project } from "../shared/contracts"
import { AskUserInteractionAnswerSchema } from "../shared/interaction"
import { AppError, toAppError } from "./services/AppError"
import { AttachmentStore, AttachmentStoreLive } from "./services/AttachmentStore"
import { GitContext, GitContextLive } from "./services/GitContext"
import { PiSessions, PiSessionsLive } from "./services/PiSessions"
import { ProjectStore, ProjectStoreLive } from "./services/ProjectStore"
import { ShutdownCoordinator, type ShutdownReason } from "./services/ShutdownCoordinator"
import { WindowBusLive } from "./services/WindowBus"

const NonEmptyString = Schema.NonEmptyString
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const AttachmentSaveSchema = Schema.Struct({
  bytes: Schema.Uint8Array,
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String)
})
const AttachmentPathsSchema = Schema.Array(NonEmptyString)
const QueueDeliverySchema = Schema.Literals(["follow-up", "steer"])
const SessionRecoveryActionSchema = Schema.Literals(["resume", "continue", "restart"])

const invalidIpcInput = (error: { readonly message: string }) => AppError.make({ operation: "validate IPC input", message: error.message })
const decodeString = (input: unknown) => Schema.decodeUnknownEffect(NonEmptyString)(input).pipe(Effect.mapError(invalidIpcInput))
const decodePromptText = (input: unknown) => Schema.decodeUnknownEffect(Schema.String)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeThinkingLevel = (input: unknown) => Schema.decodeUnknownEffect(ThinkingLevelSchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeAttachmentSave = (input: unknown) => Schema.decodeUnknownEffect(AttachmentSaveSchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeAttachmentPaths = (input: unknown) => Schema.decodeUnknownEffect(Schema.Union([AttachmentPathsSchema, Schema.Undefined]))(input).pipe(Effect.mapError(invalidIpcInput))
const decodeQueueDelivery = (input: unknown) => Schema.decodeUnknownEffect(QueueDeliverySchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeSessionRecoveryAction = (input: unknown) => Schema.decodeUnknownEffect(SessionRecoveryActionSchema)(input).pipe(Effect.mapError(invalidIpcInput))
const decodeMessageText = Effect.fn("decodeMessageText")(function*(input: unknown) {
  const text = yield* decodeString(input)
  const normalized = text.trim()
  if (!normalized) return yield* Effect.fail(AppError.make({ operation: "validate IPC input", message: "Message text cannot be blank" }))
  return normalized
})

const AppDependencies = Layer.mergeAll(WindowBusLive, GitContextLive, AttachmentStoreLive)
const AppServices = Layer.mergeAll(ProjectStoreLive, PiSessionsLive)
const AppLayer = Layer.provideMerge(AppServices, AppDependencies)
const runtime = ManagedRuntime.make(AppLayer)

const disposeSessions = async (): Promise<void> => {
  const exit = await runtime.runPromiseExit(Effect.gen(function*() {
    const sessions = yield* PiSessions
    yield* sessions.dispose()
  }))
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
}

const shutdown = new ShutdownCoordinator({
  disposeSessions,
  disposeRuntime: () => runtime.dispose(),
  exit: (code) => app.exit(code),
  logError: (message, cause) => console.error(message, cause)
})

const run = async <A, E>(effect: Effect.Effect<A, E, ProjectStore | PiSessions | GitContext | AttachmentStore>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  if (shutdown.isShuttingDown && Cause.hasInterruptsOnly(exit.cause)) {
    throw AppError.make({ operation: "application", message: "Pi Desktop is shutting down" })
  }
  throw Cause.squash(exit.cause)
}

const resolveKnownProject = Effect.fn("resolveKnownProject")(function*(input: unknown) {
  const requestedPath = yield* decodeString(input)
  const store = yield* ProjectStore
  const projects = yield* store.list()
  const project = projects.find((candidate) => candidate.path === requestedPath)
  if (!project) return yield* Effect.fail(AppError.make({ operation: "resolve project", message: "Unknown project folder" }))
  return project.path
})

const enrichProject = Effect.fn("enrichProject")(function*(project: Project) {
  const git = yield* GitContext
  const status = yield* git.inspect(project.path).pipe(
    Effect.catchTag("GitContextError", () => Effect.succeed(undefined))
  )
  return status ? { ...project, git: status } : project
})

const listProjectsWithGit = Effect.fn("listProjectsWithGit")(function*() {
  const store = yield* ProjectStore
  const projects = yield* store.list()
  return yield* Effect.forEach(projects, enrichProject, { concurrency: 4 })
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
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || shutdown.isShuttingDown) return
    console.error("[pi-desktop] renderer process terminated unexpectedly", details)
    void shutdown.shutdown("renderer-crash", 1)
  })

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
      try: () => dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Add a project folder" }),
      catch: toAppError("choose project folder")
    })
    const folderPath = result.filePaths[0]
    if (result.canceled || !folderPath) return null
    const store = yield* ProjectStore
    const project = yield* store.add(folderPath)
    return yield* enrichProject(project)
  })))

  ipcMain.handle(IpcChannels.removeProject, (_event, projectId: unknown) => run(Effect.gen(function*() {
    const id = yield* decodeString(projectId)
    const store = yield* ProjectStore
    yield* store.remove(id)
  })))

  ipcMain.handle(IpcChannels.refreshProjectGit, (_event, projectPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const git = yield* GitContext
    return yield* git.inspect(cwd)
  })))

  ipcMain.handle(IpcChannels.gitDiff, (_event, projectPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const git = yield* GitContext
    return yield* git.diff(cwd)
  })))

  ipcMain.handle(IpcChannels.listSessions, (_event, projectPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const sessions = yield* PiSessions
    return yield* sessions.list(cwd)
  })))

  ipcMain.handle(IpcChannels.createSession, (_event, projectPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const sessions = yield* PiSessions
    return yield* sessions.create(cwd)
  })))

  ipcMain.handle(IpcChannels.openSession, (_event, projectPath: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.open(cwd, path)
  })))

  ipcMain.handle(IpcChannels.inspectSession, (_event, projectPath: unknown, parentSessionPath: unknown, sessionPath: unknown) => run(Effect.gen(function*() {
    const cwd = yield* resolveKnownProject(projectPath)
    const parentPath = yield* decodeString(parentSessionPath)
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.inspect(cwd, parentPath, path)
  })))

  ipcMain.handle(IpcChannels.promptSession, (_event, sessionPath: unknown, text: unknown, delivery: unknown, attachmentPaths: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const prompt = yield* decodePromptText(text)
    const queueDelivery = yield* decodeQueueDelivery(delivery === undefined ? "follow-up" : delivery)
    const paths = yield* decodeAttachmentPaths(attachmentPaths)
    const sessions = yield* PiSessions
    yield* sessions.prompt(path, prompt, queueDelivery, paths ?? [])
  })))

  ipcMain.handle(IpcChannels.recoverSession, (_event, sessionPath: unknown, action: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const selectedAction = yield* decodeSessionRecoveryAction(action)
    const sessions = yield* PiSessions
    return yield* sessions.recover(path, selectedAction)
  })))

  ipcMain.handle(IpcChannels.editQueuedMessage, (_event, sessionPath: unknown, messageId: unknown, text: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const message = yield* decodeMessageText(text)
    const sessions = yield* PiSessions
    yield* sessions.editQueuedMessage(path, id, message)
  })))

  ipcMain.handle(IpcChannels.removeQueuedMessage, (_event, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const sessions = yield* PiSessions
    yield* sessions.removeQueuedMessage(path, id)
  })))

  ipcMain.handle(IpcChannels.steerQueuedMessage, (_event, sessionPath: unknown, messageId: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(messageId)
    const sessions = yield* PiSessions
    yield* sessions.steerQueuedMessage(path, id)
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

  ipcMain.handle(IpcChannels.abortSession, (_event, sessionPath: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    yield* sessions.abort(path)
  })))

  ipcMain.handle(IpcChannels.listModels, (_event, sessionPath: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const sessions = yield* PiSessions
    return yield* sessions.models(path)
  })))

  ipcMain.handle(IpcChannels.setModel, (_event, sessionPath: unknown, provider: unknown, modelId: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const selectedProvider = yield* decodeString(provider)
    const selectedModel = yield* decodeString(modelId)
    const sessions = yield* PiSessions
    return yield* sessions.setModel(path, selectedProvider, selectedModel)
  })))

  ipcMain.handle(IpcChannels.setThinkingLevel, (_event, sessionPath: unknown, level: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const selectedLevel = yield* decodeThinkingLevel(level)
    const sessions = yield* PiSessions
    return yield* sessions.setThinkingLevel(path, selectedLevel)
  })))

  ipcMain.handle(IpcChannels.answerInteraction, (_event, sessionPath: unknown, requestId: unknown, answer: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const id = yield* decodeString(requestId)
    const selectedAnswer = yield* Schema.decodeUnknownEffect(AskUserInteractionAnswerSchema)(answer).pipe(
      Effect.mapError(toAppError("validate Pi interaction answer"))
    )
    const sessions = yield* PiSessions
    yield* sessions.answerInteraction(path, id, selectedAnswer)
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

app.on("before-quit", (event) => {
  event.preventDefault()
  void shutdown.shutdown("application-quit", 0)
})

const signalExitCodes: ReadonlyArray<readonly [NodeJS.Signals, number]> = process.platform === "win32"
  ? [["SIGINT", 130], ["SIGTERM", 143]]
  : [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]

for (const [signal, exitCode] of signalExitCodes) {
  // Keep handling repeated signals until cleanup finishes so a second signal
  // cannot restore Node's default behavior and cut runtime disposal short.
  process.on(signal, () => {
    void shutdown.shutdown(signal, exitCode)
  })
}

const shutdownAfterFatalError = (reason: ShutdownReason, cause: unknown) => {
  console.error(`[pi-desktop] ${reason}`, cause)
  void shutdown.shutdown(reason, 1)
}

process.once("uncaughtException", (error) => shutdownAfterFatalError("uncaught-exception", error))
process.once("unhandledRejection", (reason) => shutdownAfterFatalError("unhandled-rejection", reason))
