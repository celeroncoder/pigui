import { createHash } from "node:crypto"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { parse as parseToml } from "toml"
import type { Project, ProjectSelection, ProjectWorktree, SessionDraftContext } from "../../shared/contracts"
import { AppError, toAppError } from "./AppError"

const execFileAsync = promisify(execFile)

const SetupScriptSchema = Schema.Struct({ script: Schema.String })
const EnvironmentSchema = Schema.Struct({
  version: Schema.optional(Schema.Number),
  name: Schema.String,
  setup: Schema.Struct({
    script: Schema.String,
    darwin: Schema.optional(SetupScriptSchema),
    linux: Schema.optional(SetupScriptSchema),
    win32: Schema.optional(SetupScriptSchema)
  })
})

interface LocalEnvironment {
  readonly name: string
  readonly configPath: string
  readonly setupScript: string
}

const WorktreeSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  addedAt: Schema.Number,
  kind: Schema.optionalKey(Schema.Literals(["local", "linked"]))
})

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  addedAt: Schema.Number,
  worktrees: Schema.Array(WorktreeSchema)
})

const LegacyProjectSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  addedAt: Schema.Number
})

const StoredProjectListSchema = Schema.Array(Schema.Union([ProjectSchema, LegacyProjectSchema]))

const isMissingFile = (cause: unknown) => cause instanceof Error && "code" in cause && cause.code === "ENOENT"
const storageFile = () => join(app.getPath("userData"), "projects.json")
const stableId = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 12)

const canonicalFolder = Effect.fn("ProjectStore.canonicalFolder")(function*(folderPath: string, operation: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      const resolved = await realpath(folderPath)
      const details = await stat(resolved)
      if (!details.isDirectory()) throw new Error("The selected path is not a folder")
      return resolved
    },
    catch: toAppError(operation)
  })
})

export const validateStoredWorktreePath = Effect.fn("ProjectStore.validateStoredWorktreePath")(function*(storedPath: string) {
  const resolved = yield* canonicalFolder(storedPath, "validate stored worktree")
  if (resolved !== storedPath) {
    return yield* Effect.fail(AppError.make({
      operation: "validate stored worktree",
      message: "The worktree path no longer resolves to its approved canonical folder; remove and add it again"
    }))
  }
  return resolved
})

interface WorktreeRecord {
  readonly path: string
  readonly branch: string
}

/** Parses `git worktree list --porcelain -z` without allowing paths through a shell. */
export const parseWorktreeList = (output: string): ReadonlyArray<WorktreeRecord> => {
  const records: WorktreeRecord[] = []
  let path: string | undefined
  let head = ""
  let branch: string | undefined

  const flush = () => {
    if (!path) return
    records.push({
      path,
      branch: branch?.replace(/^refs\/heads\//, "") ?? (head ? `detached @ ${head.slice(0, 7)}` : "detached HEAD")
    })
    path = undefined
    head = ""
    branch = undefined
  }

  for (const field of output.split("\0")) {
    if (!field) {
      flush()
    } else if (field.startsWith("worktree ")) {
      flush()
      path = field.slice("worktree ".length)
    } else if (field.startsWith("HEAD ")) {
      head = field.slice("HEAD ".length)
    } else if (field.startsWith("branch ")) {
      branch = field.slice("branch ".length)
    }
  }
  flush()
  return records
}

export const parseBranchRefs = (output: string): ReadonlyArray<string> => [...new Set(output
  .split(/\r?\n/)
  .map((branch) => branch.trim())
  .filter((branch) => branch.length > 0 && !branch.endsWith("/HEAD")))]
  .sort((left, right) => left.localeCompare(right))

const gitOutput = (cwd: string, args: ReadonlyArray<string>, operation: string) => Effect.tryPromise({
  try: async () => (await execFileAsync("git", ["-C", cwd, ...args], { timeout: 5_000, maxBuffer: 512 * 1024 })).stdout.trim(),
  catch: toAppError(operation)
})

const readDefaultEnvironment = Effect.fn("ProjectStore.readDefaultEnvironment")(function*(sourcePath: string) {
  const environmentFolder = join(sourcePath, ".codex", "environments")
  const entries = yield* Effect.tryPromise({
    try: () => readdir(environmentFolder, { withFileTypes: true }),
    catch: (cause) => isMissingFile(cause) ? AppError.make({ operation: "local environment missing", message: "No local environment is configured" }) : toAppError("list local environments")(cause)
  }).pipe(Effect.catchTag("AppError", (error) => error.operation === "local environment missing" ? Effect.succeed([]) : Effect.fail(error)))
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
    .map((entry) => join(environmentFolder, entry.name))
    .sort((left, right) => {
      const leftDefault = basename(left) === "environment.toml"
      const rightDefault = basename(right) === "environment.toml"
      return leftDefault === rightDefault ? left.localeCompare(right) : leftDefault ? -1 : 1
    })
  if (candidates.length === 0) return undefined

  let firstError: AppError | undefined
  for (const configPath of candidates) {
    const decoded = yield* Effect.tryPromise({
      try: async () => Schema.decodeUnknownPromise(EnvironmentSchema)(parseToml(await readFile(configPath, "utf8"))),
      catch: toAppError(`read local environment ${basename(configPath)}`)
    }).pipe(Effect.match({ onFailure: (error) => ({ error }), onSuccess: (environment) => ({ environment }) }))
    if ("error" in decoded) {
      firstError ??= decoded.error
      continue
    }
    const platformScript = process.platform === "darwin"
      ? decoded.environment.setup.darwin?.script
      : process.platform === "linux"
        ? decoded.environment.setup.linux?.script
        : process.platform === "win32"
          ? decoded.environment.setup.win32?.script
          : undefined
    return {
      name: decoded.environment.name,
      configPath,
      setupScript: platformScript?.trim() ? platformScript : decoded.environment.setup.script
    } satisfies LocalEnvironment
  }
  return yield* Effect.fail(firstError ?? AppError.make({ operation: "read local environment", message: "No valid environment configuration was found" }))
})

const describeSessionDraft = Effect.fn("ProjectStore.describeSessionDraft")(function*(project: Project, worktree: ProjectWorktree) {
  const isLinked = worktree.kind === "linked"
  const branchOutput = isLinked
    ? yield* gitOutput(worktree.path, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], "list base branches")
    : ""
  const baseBranches = parseBranchRefs(branchOutput)
  let defaultBaseBranch: string | undefined
  if (isLinked) {
    const remoteDefault = yield* gitOutput(worktree.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], "read default remote branch").pipe(
      Effect.catchTag("AppError", () => Effect.succeed(undefined))
    )
    defaultBaseBranch = remoteDefault
      ?? baseBranches.find((branch) => branch === "origin/main" || branch === "main" || branch === "origin/master" || branch === "master")
      ?? (yield* gitOutput(worktree.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], "read branch upstream").pipe(
        Effect.catchTag("AppError", () => Effect.succeed(undefined))
      ))
  }
  const sourceWorktree = project.worktrees.find((candidate) => candidate.kind === "local") ?? project.worktrees[0]
  if (isLinked && sourceWorktree) yield* validateStoredWorktreePath(sourceWorktree.path)
  const environment = isLinked && sourceWorktree ? yield* readDefaultEnvironment(sourceWorktree.path) : undefined
  return {
    path: worktree.path,
    folderName: worktree.name,
    worktreeKind: isLinked ? "linked" : "local",
    branch: worktree.branch,
    baseBranches,
    ...(defaultBaseBranch ? { defaultBaseBranch } : {}),
    ...(environment ? { setupEnvironment: { name: environment.name, configPath: environment.configPath } } : {})
  } satisfies SessionDraftContext
})

export const runWorktreeSetup = Effect.fn("ProjectStore.runWorktreeSetup")(function*(project: Project, worktree: ProjectWorktree) {
  if (worktree.kind !== "linked") return
  yield* validateStoredWorktreePath(worktree.path)
  const sourceWorktree = project.worktrees.find((candidate) => candidate.kind === "local") ?? project.worktrees[0]
  if (!sourceWorktree) return
  yield* validateStoredWorktreePath(sourceWorktree.path)
  const environment = yield* readDefaultEnvironment(sourceWorktree.path)
  if (!environment?.setupScript.trim()) return
  const operation = `run worktree setup from ${basename(environment.configPath)}`
  yield* Effect.callback<void, AppError>((resume) => {
    const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh"
    const args = process.platform === "win32" ? ["/d", "/s", "/c", environment.setupScript] : ["-lc", environment.setupScript]
    let child: ReturnType<typeof spawn> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let outputBytes = 0
    let stderr = ""
    const terminate = () => {
      if (!child) return
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM")
          return
        } catch {
          // The process may have exited between the check and signal.
        }
      }
      child.kill()
    }
    const finish = (effect: Effect.Effect<void, AppError>) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resume(effect)
    }
    const fail = (cause: unknown) => finish(Effect.fail(toAppError(operation)(cause)))
    const countOutput = (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > 4 * 1024 * 1024) {
        terminate()
        fail(new Error("Setup output exceeded the 4 MiB safety limit"))
      }
    }
    try {
      child = spawn(command, args, {
        cwd: sourceWorktree.path,
        env: {
          ...process.env,
          CODEX_SOURCE_TREE_PATH: sourceWorktree.path,
          CODEX_WORKTREE_PATH: worktree.path
        },
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    } catch (cause) {
      fail(cause)
      return
    }
    child.stdout?.on("data", countOutput)
    child.stderr?.on("data", (chunk: Buffer) => {
      countOutput(chunk)
      if (stderr.length < 8_192) stderr += chunk.toString("utf8", 0, Math.min(chunk.byteLength, 8_192 - stderr.length))
    })
    child.once("error", fail)
    child.once("close", (code, signal) => {
      if (code === 0) finish(Effect.void)
      else fail(new Error(stderr.trim() || `Setup exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`))
    })
    timeout = setTimeout(() => {
      terminate()
      fail(new Error("Setup timed out after 10 minutes"))
    }, 10 * 60_000)
    return Effect.sync(() => {
      if (timeout) clearTimeout(timeout)
      if (!settled) terminate()
    })
  })
})

const normalizeStoredProjects = (stored: typeof StoredProjectListSchema.Type): ReadonlyArray<Project> =>
  stored.map((project) => "worktrees" in project
    ? { ...project, worktrees: project.worktrees.map((worktree, index) => ({ ...worktree, kind: worktree.kind ?? (index === 0 ? "local" : "linked") })) }
    : {
        id: project.id,
        name: project.name,
        addedAt: project.addedAt,
        worktrees: [{
          id: stableId(project.path),
          path: project.path,
          name: project.name,
          branch: "unknown",
          addedAt: project.addedAt,
          kind: "local"
        }]
      })

const readProjects = Effect.fn("ProjectStore.read")(function*() {
  const file = storageFile()
  const content = yield* Effect.tryPromise({
    try: () => readFile(file, "utf8"),
    catch: (cause) => AppError.make({
      operation: isMissingFile(cause) ? "projects file missing" : "read projects",
      message: cause instanceof Error ? cause.message : String(cause)
    })
  }).pipe(
    Effect.catchTag("AppError", (error) => error.operation === "projects file missing" ? Effect.succeed("[]") : Effect.fail(error))
  )
  const parsed = yield* Effect.try({
    try: () => JSON.parse(content),
    catch: toAppError("parse projects")
  })
  const stored = yield* Schema.decodeUnknownEffect(StoredProjectListSchema)(parsed).pipe(
    Effect.mapError((error) => AppError.make({ operation: "decode projects", message: error.message }))
  )
  return normalizeStoredProjects(stored)
})

const writeProjects = Effect.fn("ProjectStore.write")(function*(projects: ReadonlyArray<Project>) {
  const file = storageFile()
  const temporary = `${file}.tmp`
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8")
      await rename(temporary, file)
    },
    catch: toAppError("write projects")
  })
})

export const discoverRepository = Effect.fn("ProjectStore.discoverRepository")(function*(folderPath: string, previous?: Project) {
  const selectedPath = yield* canonicalFolder(folderPath, "validate project folder")

  const git = (args: ReadonlyArray<string>) => Effect.tryPromise({
    try: async () => (await execFileAsync("git", ["-C", selectedPath, ...args], { timeout: 5_000, maxBuffer: 512 * 1024 })).stdout,
    catch: toAppError("inspect linked Git worktrees")
  })
  const root = yield* git(["rev-parse", "--show-toplevel"]).pipe(Effect.match({
    onFailure: () => undefined,
    onSuccess: (output) => output.trim()
  }))
  if (!root) {
    const existing = previous?.worktrees[0]
    const addedAt = existing?.addedAt ?? previous?.addedAt ?? Date.now()
    const worktree = {
      id: stableId(selectedPath),
      path: selectedPath,
      name: existing?.name ?? basename(selectedPath),
      branch: "no Git branch",
      addedAt,
      kind: "local"
    } satisfies ProjectWorktree
    return {
      project: {
        id: stableId(selectedPath),
        name: previous?.name ?? basename(selectedPath),
        addedAt: previous?.addedAt ?? addedAt,
        worktrees: [worktree]
      },
      worktree
    } satisfies ProjectSelection
  }
  const commonDir = (yield* git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()
  const listed = parseWorktreeList(yield* git(["worktree", "list", "--porcelain", "-z"]))
  const now = Date.now()
  const projectId = stableId(commonDir)
  const previousWorktrees = new Map(previous?.worktrees.map((worktree) => [worktree.path, worktree]))
  const worktrees: ProjectWorktree[] = []

  for (const [recordIndex, record] of listed.entries()) {
    const path = yield* Effect.tryPromise({ try: () => realpath(record.path), catch: toAppError("resolve linked Git worktree") }).pipe(Effect.match({
      onFailure: () => undefined,
      onSuccess: (resolved) => resolved
    }))
    // Git retains manually-deleted worktrees as prunable metadata. A stale
    // sibling must not make every healthy worktree in the repository unusable.
    if (!path) continue
    const existing = previousWorktrees.get(path)
    worktrees.push({
      id: stableId(`${projectId}:${path}`),
      path,
      name: basename(path),
      branch: record.branch,
      addedAt: existing?.addedAt ?? now,
      kind: recordIndex === 0 ? "local" : "linked"
    })
  }

  const selectedRoot = yield* Effect.tryPromise({ try: () => realpath(root), catch: toAppError("resolve selected Git worktree") })
  const selected = worktrees.find((worktree) => worktree.path === selectedRoot)
  if (!selected) return yield* Effect.fail(AppError.make({ operation: "inspect linked Git worktrees", message: "The selected worktree was not reported by Git" }))
  const repositoryName = basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir)
  return {
    project: {
      id: projectId,
      name: previous?.id === projectId ? previous.name : repositoryName,
      addedAt: previous?.addedAt ?? now,
      worktrees
    } satisfies Project,
    worktree: selected
  } satisfies ProjectSelection
})

const reconcileProjects = Effect.fn("ProjectStore.reconcileProjects")(function*(projects: ReadonlyArray<Project>) {
  const refreshed = yield* Effect.forEach(projects, (project) => {
    const first = project.worktrees[0]
    if (!first) return Effect.succeed(project)
    return discoverRepository(first.path, project).pipe(
      Effect.map((selection) => selection.project),
      Effect.catchTag("AppError", () => Effect.succeed(project))
    )
  }, { concurrency: 4 })
  const merged = new Map<string, Project>()
  for (const project of refreshed) {
    const existing = merged.get(project.id)
    if (!existing) {
      merged.set(project.id, project)
      continue
    }
    const worktrees = new Map(existing.worktrees.map((worktree) => [worktree.id, worktree]))
    for (const worktree of project.worktrees) worktrees.set(worktree.id, worktree)
    merged.set(project.id, { ...existing, worktrees: [...worktrees.values()] })
  }
  return [...merged.values()]
})

export class ProjectStore extends Context.Service<ProjectStore, {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, AppError>
  readonly add: (folderPath: string) => Effect.Effect<ProjectSelection, AppError>
  readonly resolve: (projectId: string, worktreeId: string) => Effect.Effect<ProjectSelection, AppError>
  readonly sessionDraft: (projectId: string, worktreeId: string) => Effect.Effect<SessionDraftContext, AppError>
  readonly setupWorktree: (projectId: string, worktreeId: string) => Effect.Effect<void, AppError>
  readonly remove: (projectId: string) => Effect.Effect<void, AppError>
}>()("ProjectStore") {}

export const ProjectStoreLive = Layer.effect(ProjectStore)(Effect.gen(function*() {
  const mutationLock = yield* Semaphore.make(1)

  return {
    list: Effect.fn("ProjectStore.list")(function*() {
      return yield* mutationLock.withPermit(Effect.gen(function*() {
        const current = yield* readProjects()
        const reconciled = yield* reconcileProjects(current)
        if (JSON.stringify(reconciled) !== JSON.stringify(current)) yield* writeProjects(reconciled)
        return reconciled
      }))
    }),
    add: Effect.fn("ProjectStore.add")(function*(folderPath: string) {
      return yield* mutationLock.withPermit(Effect.gen(function*() {
        const current = yield* reconcileProjects(yield* readProjects())
        const initial = yield* discoverRepository(folderPath)
        const previous = current.find((project) => project.id === initial.project.id)
        const selection = previous ? yield* discoverRepository(folderPath, previous) : initial
        const next = [...current.filter((project) => project.id !== selection.project.id), selection.project]
        yield* writeProjects(next)
        return selection
      }))
    }),
    resolve: Effect.fn("ProjectStore.resolve")(function*(projectId: string, worktreeId: string) {
      const projects = yield* readProjects()
      const project = projects.find((candidate) => candidate.id === projectId)
      const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId)
      if (!project || !worktree) return yield* Effect.fail(AppError.make({ operation: "resolve worktree", message: "Unknown project worktree" }))
      yield* validateStoredWorktreePath(worktree.path)
      return { project, worktree }
    }),
    sessionDraft: Effect.fn("ProjectStore.sessionDraft")(function*(projectId: string, worktreeId: string) {
      const projects = yield* readProjects()
      const project = projects.find((candidate) => candidate.id === projectId)
      const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId)
      if (!project || !worktree) return yield* Effect.fail(AppError.make({ operation: "describe session draft", message: "Unknown project worktree" }))
      yield* validateStoredWorktreePath(worktree.path)
      return yield* describeSessionDraft(project, worktree)
    }),
    setupWorktree: Effect.fn("ProjectStore.setupWorktree")(function*(projectId: string, worktreeId: string) {
      const projects = yield* readProjects()
      const project = projects.find((candidate) => candidate.id === projectId)
      const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId)
      if (!project || !worktree) return yield* Effect.fail(AppError.make({ operation: "set up worktree", message: "Unknown project worktree" }))
      yield* validateStoredWorktreePath(worktree.path)
      yield* runWorktreeSetup(project, worktree)
    }),
    remove: Effect.fn("ProjectStore.remove")(function*(projectId: string) {
      yield* mutationLock.withPermit(Effect.gen(function*() {
        const current = yield* readProjects()
        yield* writeProjects(current.filter((project) => project.id !== projectId))
      }))
    })
  }
}))
