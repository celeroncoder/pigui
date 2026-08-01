import { join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { IpcChannels, type Project } from "../shared/contracts"
import { AttachmentStore, AttachmentStoreLive } from "./services/AttachmentStore"
import { GitContext, GitContextLive } from "./services/GitContext"
import { PiSessions, PiSessionsLive } from "./services/PiSessions"
import { ProjectStore, ProjectStoreLive } from "./services/ProjectStore"
import { WindowBusLive } from "./services/WindowBus"

const NonEmptyString = Schema.NonEmptyString
const ThinkingLevelSchema = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const AttachmentSaveSchema = Schema.Struct({
  bytes: Schema.Uint8Array,
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String)
})
const AttachmentPathsSchema = Schema.Array(NonEmptyString)
const decodeString = Schema.decodeUnknownEffect(NonEmptyString)
const decodePromptText = Schema.decodeUnknownEffect(Schema.String)
const decodeThinkingLevel = Schema.decodeUnknownEffect(ThinkingLevelSchema)
const decodeAttachmentSave = Schema.decodeUnknownEffect(AttachmentSaveSchema)
const decodeAttachmentPaths = Schema.decodeUnknownEffect(Schema.Union([AttachmentPathsSchema, Schema.Undefined]))

const AppDependencies = Layer.mergeAll(WindowBusLive, GitContextLive, AttachmentStoreLive)
const AppServices = Layer.mergeAll(ProjectStoreLive, PiSessionsLive)
const AppLayer = Layer.provideMerge(AppServices, AppDependencies)
const runtime = ManagedRuntime.make(AppLayer)
let isShuttingDown = false

const run = async <A, E>(effect: Effect.Effect<A, E, ProjectStore | PiSessions | GitContext | AttachmentStore>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  if (isShuttingDown && Cause.hasInterruptsOnly(exit.cause)) return new Promise<A>(() => undefined)
  throw Cause.squash(exit.cause)
}

const resolveKnownProject = Effect.fn("resolveKnownProject")(function*(input: unknown) {
  const requestedPath = yield* decodeString(input)
  const store = yield* ProjectStore
  const projects = yield* store.list()
  const project = projects.find((candidate) => candidate.path === requestedPath)
  if (!project) return yield* Effect.fail(new Error("Unknown project folder"))
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
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
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
    return yield* git.inspect(cwd).pipe(
      Effect.catchTag("GitContextError", () => Effect.succeed(undefined))
    )
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

  ipcMain.handle(IpcChannels.promptSession, (_event, sessionPath: unknown, text: unknown, attachmentPaths: unknown) => run(Effect.gen(function*() {
    const path = yield* decodeString(sessionPath)
    const prompt = yield* decodePromptText(text)
    const paths = yield* decodeAttachmentPaths(attachmentPaths)
    const sessions = yield* PiSessions
    yield* sessions.prompt(path, prompt, paths ?? [])
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
