import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { GitHubBranchPullRequest, GitHubPullRequestState, GitHubSyncResult } from "../../shared/contracts"

const COMMAND_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1024 * 1024

export class GitHubWorkflowError extends Schema.TaggedErrorClass<GitHubWorkflowError>()("GitHubWorkflowError", {
  operation: Schema.String,
  message: Schema.String
}) {}

interface CommandResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface GitHubCommandExecutor {
  readonly run: (cwd: string, executable: "git" | "gh", args: ReadonlyArray<string>, input?: string, signal?: AbortSignal) => Promise<CommandResult>
}

const commandError = (operation: string, cause: unknown) => GitHubWorkflowError.make({
  operation,
  message: cause instanceof Error ? cause.message : String(cause)
})

const executeCommand: GitHubCommandExecutor["run"] = (cwd, executable, args, input, signal) =>
  new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let stdout = ""
    let stderr = ""
    const child = spawn(executable, [...args], { cwd, shell: false, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true })
    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      resolvePromise(result)
    }
    const fail = (cause: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      child.kill()
      rejectPromise(cause)
    }
    const append = (current: string, chunk: string, stream: "stdout" | "stderr") => {
      if (Buffer.byteLength(current, "utf8") + Buffer.byteLength(chunk, "utf8") > MAX_OUTPUT_BYTES) {
        fail(new Error(`${executable} ${stream} exceeded the ${MAX_OUTPUT_BYTES}-byte safety limit`))
        return current
      }
      return `${current}${chunk}`
    }
    const abort = () => fail(new Error(`${executable} command was interrupted`))
    const timeout = setTimeout(() => fail(new Error(`${executable} ${args[0] ?? "command"} timed out after ${COMMAND_TIMEOUT_MS}ms`)), COMMAND_TIMEOUT_MS)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) return abort()
    child.stdout!.setEncoding("utf8")
    child.stderr!.setEncoding("utf8")
    child.stdout!.on("data", (chunk: string) => { stdout = append(stdout, chunk, "stdout") })
    child.stderr!.on("data", (chunk: string) => { stderr = append(stderr, chunk, "stderr") })
    child.stdin?.once("error", fail)
    child.once("error", fail)
    child.once("close", (exitCode) => finish({ exitCode, stdout, stderr }))
    if (input !== undefined) child.stdin!.end(input)
  })

const RepoSchema = Schema.Struct({ nameWithOwner: Schema.String, url: Schema.String })
const BranchPullRequestListSchema = Schema.Array(Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
  mergeable: Schema.String,
  mergeStateStatus: Schema.String,
  isCrossRepository: Schema.Boolean,
  statusCheckRollup: Schema.Array(Schema.Struct({
    status: Schema.optionalKey(Schema.String),
    conclusion: Schema.optionalKey(Schema.String),
    state: Schema.optionalKey(Schema.String)
  }))
}))
type BranchPullRequest = Schema.Schema.Type<typeof BranchPullRequestListSchema>[number]

const decodeJson = <S extends Schema.Constraint>(operation: string, schema: S, value: string) => Effect.gen(function*() {
  const parsed = yield* Effect.try({ try: () => JSON.parse(value), catch: (cause) => commandError(operation, cause) })
  return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(Effect.mapError((error) => GitHubWorkflowError.make({ operation, message: error.message })))
})

const requireSuccess = (operation: string, result: CommandResult) => result.exitCode === 0
  ? Effect.succeed(result.stdout)
  : Effect.fail(GitHubWorkflowError.make({ operation, message: result.stderr.trim() || result.stdout.trim() || `Command exited with code ${result.exitCode ?? "unknown"}` }))

const nonNegativeInteger = (value: string) => {
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

const successfulCheckStates = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])

export const classifyBranchPullRequest = (pull: BranchPullRequest): GitHubPullRequestState => {
  if (pull.state === "MERGED" || pull.mergedAt !== null) return "merged"
  if (pull.mergeable === "CONFLICTING" || pull.mergeStateStatus === "DIRTY") return "conflict"
  const checksNeedAttention = pull.statusCheckRollup.some((check) =>
    (check.status !== undefined && check.status !== "COMPLETED")
      || (check.conclusion !== undefined && !successfulCheckStates.has(check.conclusion))
      || (check.state !== undefined && !successfulCheckStates.has(check.state))
  )
  return checksNeedAttention || pull.mergeable !== "MERGEABLE" ? "pending" : "mergeable"
}

export const makeGitHubWorkflow = (executor: GitHubCommandExecutor) => Effect.gen(function*() {
  const mutationLock = yield* Semaphore.make(1)
  const queryLock = yield* Semaphore.make(4)
  const run = (cwd: string, executable: "git" | "gh", args: ReadonlyArray<string>) => Effect.tryPromise({
    try: (signal) => executor.run(cwd, executable, args, undefined, signal),
    catch: (cause) => commandError(`${executable} ${args[0] ?? "command"}`, cause)
  })
  const required = (cwd: string, executable: "git" | "gh", args: ReadonlyArray<string>, operation: string) =>
    run(cwd, executable, args).pipe(Effect.flatMap((result) => requireSuccess(operation, result)))
  const resolveBranch = (cwd: string) => required(cwd, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"], "resolve Git branch").pipe(Effect.map((value) => value.trim()))
  const ensureBranch = (cwd: string, expected: string) => resolveBranch(cwd).pipe(Effect.flatMap((current) => current === expected
    ? Effect.void
    : Effect.fail(GitHubWorkflowError.make({ operation: "validate Git branch", message: `The worktree changed from ${expected} to ${current || "a detached HEAD"}; inspect it again before pushing` }))))

  const branchPullRequest = Effect.fn("GitHubWorkflow.branchPullRequest")(function*(cwd: string) {
    return yield* queryLock.withPermit(Effect.gen(function*() {
      const path = resolve(cwd)
      const branchResult = yield* run(path, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"])
      const branch = branchResult.stdout.trim()
      if (branchResult.exitCode !== 0 || !branch) return null
      const pulls = yield* required(path, "gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "100", "--json", "number,title,url,state,mergedAt,mergeable,mergeStateStatus,isCrossRepository,statusCheckRollup"], "inspect branch pull request").pipe(
        Effect.flatMap((json) => decodeJson("decode branch pull request", BranchPullRequestListSchema, json))
      )
      const pull = pulls.find((candidate) => !candidate.isCrossRepository && (candidate.state === "OPEN" || candidate.state === "MERGED" || candidate.mergedAt !== null))
      return pull ? { number: pull.number, title: pull.title, url: pull.url, branch, state: classifyBranchPullRequest(pull) } satisfies GitHubBranchPullRequest : null
    }))
  })

  const worktree = Effect.fn("GitHubWorkflow.worktree")(function*(cwd: string) {
    const path = resolve(cwd)
    const branch = yield* resolveBranch(path)
    const repository = yield* required(path, "gh", ["repo", "view", "--json", "nameWithOwner,url"], "inspect GitHub repository").pipe(
      Effect.flatMap((json) => decodeJson("decode GitHub repository", RepoSchema, json))
    )
    const upstreamResult = yield* run(path, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : ""
    const ahead = upstream ? nonNegativeInteger(yield* required(path, "git", ["rev-list", "--count", `${upstream}..HEAD`], "count unpushed commits")) : 0
    return { repository: repository.nameWithOwner, repositoryUrl: repository.url, branch, path, hasUpstream: !!upstream, ahead, pullRequest: yield* branchPullRequest(path) }
  })

  const commitOrPush = Effect.fn("GitHubWorkflow.commitOrPush")(function*(cwd: string, commitMessage: string) {
    return yield* mutationLock.withPermit(Effect.gen(function*() {
      const path = resolve(cwd)
      const branch = yield* resolveBranch(path)
      if (!branch) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "commit or push", message: "Check out a branch before committing or pushing" }))
      const status = yield* required(path, "git", ["status", "--porcelain=v1", "--untracked-files=normal"], "inspect worktree status")
      let commit: string | undefined
      if (status.trim()) {
        const message = commitMessage.trim()
        if (!message) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "validate commit message", message: "Add a commit message before committing these changes" }))
        const hasControlChars = Array.from(message).some((char) => {
          const code = char.charCodeAt(0)
          return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
        })
        if (message.length > 200 || hasControlChars) {
          return yield* Effect.fail(GitHubWorkflowError.make({ operation: "validate commit message", message: "Use a commit message of at most 200 printable characters" }))
        }
        yield* ensureBranch(path, branch)
        yield* required(path, "git", ["add", "--all", "--"], "stage worktree changes")
        yield* required(path, "git", ["commit", "-m", message], "commit worktree changes")
        commit = (yield* required(path, "git", ["rev-parse", "--short=12", "HEAD"], "resolve created commit")).trim()
      }
      yield* ensureBranch(path, branch)
      yield* required(path, "git", ["push", "--set-upstream", "origin", "HEAD"], "push GitHub branch")
      return { action: commit ? "committed-and-pushed" : "pushed", commit } satisfies GitHubSyncResult
    }))
  })

  return { branchPullRequest, worktree, commitOrPush }
})

export class GitHubWorkflow extends Context.Service<GitHubWorkflow, {
  readonly branchPullRequest: (cwd: string) => Effect.Effect<GitHubBranchPullRequest | null, GitHubWorkflowError>
  readonly worktree: (cwd: string) => Effect.Effect<{ readonly repository: string; readonly repositoryUrl: string; readonly branch: string; readonly path: string; readonly hasUpstream: boolean; readonly ahead: number; readonly pullRequest: GitHubBranchPullRequest | null }, GitHubWorkflowError>
  readonly commitOrPush: (cwd: string, commitMessage: string) => Effect.Effect<GitHubSyncResult, GitHubWorkflowError>
}>()("GitHubWorkflow") {}

export const GitHubWorkflowLive = Layer.effect(GitHubWorkflow)(makeGitHubWorkflow({ run: executeCommand }))
