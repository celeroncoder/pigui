import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { app } from "electron"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { Project } from "../../shared/contracts"
import { AppError, toAppError } from "./AppError"

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  name: Schema.String,
  addedAt: Schema.Number
})

const ProjectListSchema = Schema.Array(ProjectSchema)

const isMissingFile = (cause: unknown) => cause instanceof Error && "code" in cause && cause.code === "ENOENT"

const storageFile = () => join(app.getPath("userData"), "projects.json")

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
  return yield* Schema.decodeUnknownEffect(ProjectListSchema)(parsed).pipe(
    Effect.mapError((error) => AppError.make({ operation: "decode projects", message: error.message }))
  )
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

export class ProjectStore extends Context.Service<ProjectStore, {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, AppError>
  readonly add: (folderPath: string) => Effect.Effect<Project, AppError>
  readonly remove: (projectId: string) => Effect.Effect<void, AppError>
}>()("ProjectStore") {}

export const ProjectStoreLive = Layer.effect(ProjectStore)(Effect.gen(function*() {
  const mutationLock = yield* Semaphore.make(1)

  return {
    list: Effect.fn("ProjectStore.list")(function*() {
      return yield* readProjects()
    }),
    add: Effect.fn("ProjectStore.add")(function*(folderPath: string) {
      return yield* mutationLock.withPermit(Effect.gen(function*() {
        const canonicalPath = yield* Effect.tryPromise({
          try: async () => {
            const resolved = await realpath(folderPath)
            const details = await stat(resolved)
            if (!details.isDirectory()) throw new Error("The selected path is not a folder")
            return resolved
          },
          catch: toAppError("validate project folder")
        })
        const current = yield* readProjects()
        const existing = current.find((project) => project.path === canonicalPath)
        if (existing) return existing

        const name = canonicalPath.split(/[\\/]/).filter(Boolean).at(-1) ?? canonicalPath
        const project: Project = {
          id: createHash("sha1").update(canonicalPath).digest("hex").slice(0, 12),
          path: canonicalPath,
          name,
          addedAt: Date.now()
        }
        yield* writeProjects([...current, project])
        return project
      }))
    }),
    remove: Effect.fn("ProjectStore.remove")(function*(projectId: string) {
      yield* mutationLock.withPermit(Effect.gen(function*() {
        const current = yield* readProjects()
        yield* writeProjects(current.filter((project) => project.id !== projectId))
      }))
    })
  }
}))
