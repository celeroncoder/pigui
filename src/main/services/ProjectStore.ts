import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { Project, ProjectSelection, ProjectWorktree } from "../../shared/contracts"
import { AppError, toAppError } from "./AppError"

const execFileAsync = promisify(execFile)

const WorktreeSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  addedAt: Schema.Number
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

const normalizeStoredProjects = (stored: typeof StoredProjectListSchema.Type): ReadonlyArray<Project> =>
  stored.map((project) => "worktrees" in project
    ? project
    : {
        id: project.id,
        name: project.name,
        addedAt: project.addedAt,
        worktrees: [{
          id: stableId(project.path),
          path: project.path,
          name: project.name,
          branch: "unknown",
          addedAt: project.addedAt
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
  const selectedPath = yield* Effect.tryPromise({
    try: async () => {
      const resolved = await realpath(folderPath)
      const details = await stat(resolved)
      if (!details.isDirectory()) throw new Error("The selected path is not a folder")
      return resolved
    },
    catch: toAppError("validate project folder")
  })

  const git = (args: ReadonlyArray<string>) => Effect.tryPromise({
    try: async () => (await execFileAsync("git", ["-C", selectedPath, ...args], { timeout: 5_000, maxBuffer: 512 * 1024 })).stdout,
    catch: toAppError("inspect linked Git worktrees")
  })
  const root = yield* git(["rev-parse", "--show-toplevel"]).pipe(Effect.match({
    onFailure: () => undefined,
    onSuccess: (output) => output.trim()
  }))
  if (!root) {
    const existing = previous?.worktrees.find((worktree) => worktree.path === selectedPath)
    const worktree = {
      id: existing?.id ?? stableId(selectedPath),
      path: selectedPath,
      name: existing?.name ?? basename(selectedPath),
      branch: existing?.branch ?? "no Git branch",
      addedAt: existing?.addedAt ?? Date.now()
    } satisfies ProjectWorktree
    return {
      project: previous ?? {
        id: stableId(selectedPath),
        name: basename(selectedPath),
        addedAt: worktree.addedAt,
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

  for (const record of listed) {
    const path = yield* Effect.tryPromise({ try: () => realpath(record.path), catch: toAppError("resolve linked Git worktree") })
    const existing = previousWorktrees.get(path)
    worktrees.push({
      id: stableId(`${projectId}:${path}`),
      path,
      name: basename(path),
      branch: record.branch,
      addedAt: existing?.addedAt ?? now
    })
  }

  const selectedRoot = yield* Effect.tryPromise({ try: () => realpath(root), catch: toAppError("resolve selected Git worktree") })
  const selected = worktrees.find((worktree) => worktree.path === selectedRoot)
  if (!selected) return yield* Effect.fail(AppError.make({ operation: "inspect linked Git worktrees", message: "The selected worktree was not reported by Git" }))
  const repositoryName = basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir)
  return {
    project: {
      id: projectId,
      name: previous?.name ?? repositoryName,
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
      return { project, worktree }
    }),
    remove: Effect.fn("ProjectStore.remove")(function*(projectId: string) {
      yield* mutationLock.withPermit(Effect.gen(function*() {
        const current = yield* readProjects()
        yield* writeProjects(current.filter((project) => project.id !== projectId))
      }))
    })
  }
}))
