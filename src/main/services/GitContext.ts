import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"

const GIT_TIMEOUT_MS = 5_000
const MAX_GIT_OUTPUT_BYTES = 512 * 1024

export class GitStatus extends Schema.Class<GitStatus>("GitStatus")({
  branch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number
}) {}

export class GitContextError extends Schema.TaggedErrorClass<GitContextError>()("GitContextError", {
  operation: Schema.String,
  message: Schema.String
}) {}

interface GitCommandResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

interface LineTotals {
  readonly additions: number
  readonly deletions: number
}

const gitError = (operation: string, cause: unknown) => GitContextError.make({
  operation,
  message: cause instanceof Error ? cause.message : String(cause)
})

/** Executes git directly with an argument vector; project paths never enter a shell string. */
const executeGit = (cwd: string, args: ReadonlyArray<string>): Promise<GitCommandResult> =>
  new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let stdout = ""
    let stderr = ""
    let child: ReturnType<typeof spawn> | undefined

    const finish = (result: GitCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolvePromise(result)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectPromise(error)
    }
    const append = (current: string, chunk: string, stream: "stdout" | "stderr") => {
      if (current.length + chunk.length > MAX_GIT_OUTPUT_BYTES) {
        fail(new Error(`git ${stream} exceeded the ${MAX_GIT_OUTPUT_BYTES}-byte safety limit`))
        child?.kill()
        return current
      }
      return `${current}${chunk}`
    }

    const timeout = setTimeout(() => {
      fail(new Error(`git ${args[0] ?? "command"} timed out after ${GIT_TIMEOUT_MS}ms`))
      child?.kill()
    }, GIT_TIMEOUT_MS)

    try {
      child = spawn("git", [...args], {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
      child.stdout?.setEncoding("utf8")
      child.stderr?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        stdout = append(stdout, chunk, "stdout")
      })
      child.stderr?.on("data", (chunk: string) => {
        stderr = append(stderr, chunk, "stderr")
      })
      child.once("error", fail)
      child.once("close", (exitCode) => finish({ exitCode, stdout, stderr }))
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })

const runGit = Effect.fn("GitContext.runGit")(function*(cwd: string, args: ReadonlyArray<string>) {
  return yield* Effect.tryPromise({
    try: () => executeGit(cwd, args),
    catch: (cause) => gitError(`git ${args[0] ?? "command"}`, cause)
  })
})

const requireSuccess = (operation: string, result: GitCommandResult) =>
  result.exitCode === 0
    ? Effect.succeed(result.stdout)
    : Effect.fail(GitContextError.make({
      operation,
      message: result.stderr.trim() || `git exited with code ${result.exitCode ?? "unknown"}`
    }))

const numericStat = (value: string | undefined) => {
  if (!value || value === "-") return 0
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

const parseNumstat = (stdout: string): LineTotals => {
  let additions = 0
  let deletions = 0
  for (const line of stdout.split("\n")) {
    const [added, deleted] = line.split("\t")
    additions += numericStat(added)
    deletions += numericStat(deleted)
  }
  return { additions, deletions }
}

const parseNulSeparated = (stdout: string) => stdout.split("\0").filter((path) => path.length > 0)

const safeProjectFile = (cwd: string, candidate: string) => {
  const absolute = resolve(cwd, candidate)
  const fromProject = relative(cwd, absolute)
  return fromProject.length > 0
    && fromProject !== ".."
    && !fromProject.startsWith(`..${sep}`)
    && !isAbsolute(fromProject)
    ? absolute
    : undefined
}

const countUntrackedLines = Effect.fn("GitContext.countUntrackedLines")(function*(cwd: string, candidate: string) {
  const file = safeProjectFile(cwd, candidate)
  if (!file) return 0
  const content = yield* Effect.tryPromise({
    try: () => readFile(file),
    catch: (cause) => gitError("read untracked file", cause)
  }).pipe(Effect.match({
    onFailure: () => undefined,
    onSuccess: (value) => value
  }))
  if (!content || content.includes(0)) return 0

  let lines = 0
  for (const byte of content) if (byte === 10) lines++
  return content.length > 0 && content[content.length - 1] !== 10 ? lines + 1 : lines
})

const countFilesAsAdditions = Effect.fn("GitContext.countFilesAsAdditions")(function*(cwd: string, paths: ReadonlyArray<string>) {
  const additions = yield* Effect.forEach(
    paths,
    (path) => countUntrackedLines(cwd, path),
    { concurrency: 8 }
  )
  return additions.reduce((total, count) => total + count, 0)
})

const detectBranch = Effect.fn("GitContext.detectBranch")(function*(cwd: string) {
  const symbolicRef = yield* runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  const branch = symbolicRef.stdout.trim()
  if (symbolicRef.exitCode === 0 && branch) return branch

  const revision = yield* runGit(cwd, ["rev-parse", "--short", "HEAD"])
  const shortRevision = revision.exitCode === 0 ? revision.stdout.trim() : ""
  return shortRevision ? `detached @ ${shortRevision}` : "detached HEAD"
})

const inspectGit = Effect.fn("GitContext.inspect")(function*(cwd: string) {
  const repository = yield* runGit(cwd, ["rev-parse", "--is-inside-work-tree"])
  if (repository.exitCode !== 0 || repository.stdout.trim() !== "true") return undefined

  const branch = yield* detectBranch(cwd)
  const head = yield* runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])
  const trackedChanges = head.exitCode === 0
    ? yield* runGit(cwd, ["diff", "--numstat", "--no-ext-diff", "--no-renames", "HEAD", "--"]).pipe(
      Effect.flatMap((result) => requireSuccess("read working-tree diff", result)),
      Effect.map(parseNumstat)
    )
    : { additions: yield* countFilesAsAdditions(
      cwd,
      parseNulSeparated(yield* runGit(cwd, ["ls-files", "--cached", "-z"]).pipe(
        Effect.flatMap((result) => requireSuccess("list tracked files", result))
      ))
    ), deletions: 0 }

  const untracked = yield* runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).pipe(
    Effect.flatMap((result) => requireSuccess("list untracked files", result))
  )
  const untrackedAdditions = yield* countFilesAsAdditions(cwd, parseNulSeparated(untracked))

  return GitStatus.make({
    branch,
    additions: trackedChanges.additions + untrackedAdditions,
    deletions: trackedChanges.deletions
  })
})

export class GitContext extends Context.Service<GitContext, {
  readonly inspect: (cwd: string) => Effect.Effect<GitStatus | undefined, GitContextError>
}>()("GitContext") {}

export const GitContextLive = Layer.effect(GitContext)(Effect.gen(function*() {
  return {
    inspect: (cwd: string) => inspectGit(cwd)
  }
}))
