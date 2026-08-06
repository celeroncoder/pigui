import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { GitHubBranchPullRequest, GitHubCommentResult, GitHubPullRequestResult, GitHubPullRequestState, GitHubWorkflowContext } from "../../shared/contracts"

const COMMAND_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_INPUT_BYTES = 64 * 1024
const SUMMARY_MARKER_START = "<!-- pi-desktop:session-summary:start -->"
const SUMMARY_MARKER_END = "<!-- pi-desktop:session-summary:end -->"

export interface SessionShareSummary {
  readonly content: string
  readonly sessionName: string
}

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
    if (input && Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
      rejectPromise(new Error(`Input exceeds the ${MAX_INPUT_BYTES}-byte GitHub safety limit`))
      return
    }

    let settled = false
    let stdout = ""
    let stderr = ""
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true
    })
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
    if (signal?.aborted) {
      abort()
      return
    }
    child.stdout!.setEncoding("utf8")
    child.stderr!.setEncoding("utf8")
    child.stdout!.on("data", (chunk: string) => { stdout = append(stdout, chunk, "stdout") })
    child.stderr!.on("data", (chunk: string) => { stderr = append(stderr, chunk, "stderr") })
    child.stdin?.once("error", fail)
    child.once("error", fail)
    child.once("close", (exitCode) => finish({ exitCode, stdout, stderr }))
    if (input !== undefined) child.stdin!.end(input)
  })

const RepoSchema = Schema.Struct({
  nameWithOwner: Schema.String,
  url: Schema.String,
  defaultBranchRef: Schema.Struct({ name: Schema.String })
})
const PullRequestSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  body: Schema.String,
  baseRefName: Schema.String
})
const PullRequestListSchema = Schema.Array(Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  baseRefName: Schema.String,
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  isCrossRepository: Schema.Boolean
}))
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
  const parsed = yield* Effect.try({
    try: () => JSON.parse(value),
    catch: (cause) => commandError(operation, cause)
  })
  return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
    Effect.mapError((error) => GitHubWorkflowError.make({ operation, message: error.message }))
  )
})

const requireSuccess = (operation: string, result: CommandResult) => result.exitCode === 0
  ? Effect.succeed(result.stdout)
  : Effect.fail(GitHubWorkflowError.make({
    operation,
    message: result.stderr.trim() || result.stdout.trim() || `Command exited with code ${result.exitCode ?? "unknown"}`
  }))

const nonNegativeInteger = (value: string) => {
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

const parseNumstat = (value: string) => {
  let committedFiles = 0
  let additions = 0
  let deletions = 0
  for (const line of value.split("\n")) {
    if (!line.trim()) continue
    const [added, deleted] = line.split("\t")
    committedFiles += 1
    additions += added === "-" ? 0 : nonNegativeInteger(added ?? "")
    deletions += deleted === "-" ? 0 : nonNegativeInteger(deleted ?? "")
  }
  return { committedFiles, additions, deletions }
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

export const normalizeGitHubTarget = (target: string, repository: string): string | undefined => {
  const trimmed = target.trim()
  const number = trimmed.match(/^#?(\d+)$/)?.[1]
  if (number && Number(number) > 0) return number
  try {
    const url = new URL(trimmed)
    const match = url.hostname === "github.com" && url.protocol === "https:"
      ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/)
      : null
    if (!match || `${match[1]}/${match[2]}`.toLocaleLowerCase() !== repository.toLocaleLowerCase()) return undefined
    return match[3]
  } catch {
    return undefined
  }
}

export const replaceSessionSummarySection = (body: string, section: string): string => {
  const start = body.indexOf(SUMMARY_MARKER_START)
  const end = body.indexOf(SUMMARY_MARKER_END)
  if (start >= 0 && end >= start) {
    return `${body.slice(0, start).trimEnd()}${body.slice(0, start).trimEnd() ? "\n\n" : ""}${section}${body.slice(end + SUMMARY_MARKER_END.length).trimStart() ? `\n\n${body.slice(end + SUMMARY_MARKER_END.length).trimStart()}` : ""}`
  }
  return `${body.trim()}${body.trim() ? "\n\n" : ""}${section}`
}

const escapeSummaryMarkers = (summary: string) => summary
  .replaceAll(SUMMARY_MARKER_START, "`pi-desktop session summary start`")
  .replaceAll(SUMMARY_MARKER_END, "`pi-desktop session summary end`")

const inlineCode = (value: string) => `\`${value.replaceAll("`", "'")}\``

const pullRequestBodySection = (context: GitHubWorkflowContext) => `${SUMMARY_MARKER_START}
## Pi session summary

${escapeSummaryMarkers(context.summary)}

### Worktree context

- Repository: [${context.repository}](${context.repositoryUrl})
- Branch: \`${context.branch}\` at \`${context.commit}\`
- Committed diff: [${context.commits} ${context.commits === 1 ? "commit" : "commits"}, ${context.committedFiles} ${context.committedFiles === 1 ? "file" : "files"}, +${context.additions}/-${context.deletions}](${context.compareUrl})
- Pi session: ${inlineCode(context.sessionName)}
${SUMMARY_MARKER_END}`

const commentBody = (context: GitHubWorkflowContext) => `${context.summary}

---
_From Pi session ${inlineCode(context.sessionName)} on [\`${context.branch}\` at \`${context.commit}\`](${context.compareUrl}) (${context.committedFiles} ${context.committedFiles === 1 ? "file" : "files"}, +${context.additions}/-${context.deletions})._`

const titleFromSession = (sessionName: string) => {
  const firstLine = sessionName.trim().split("\n")[0]?.replace(/\s+/g, " ") ?? ""
  return (firstLine || "Pi session changes").slice(0, 120)
}

export const makeGitHubWorkflow = (executor: GitHubCommandExecutor) => Effect.gen(function*() {
  const mutationLock = yield* Semaphore.make(1)
  const queryLock = yield* Semaphore.make(4)

  const run = (cwd: string, executable: "git" | "gh", args: ReadonlyArray<string>, input?: string) => Effect.tryPromise({
    try: (signal) => executor.run(cwd, executable, args, input, signal),
    catch: (cause) => commandError(`${executable} ${args[0] ?? "command"}`, cause)
  })
  const required = (cwd: string, executable: "git" | "gh", args: ReadonlyArray<string>, operation: string, input?: string) =>
    run(cwd, executable, args, input).pipe(Effect.flatMap((result) => requireSuccess(operation, result)))

  const branchPullRequest = Effect.fn("GitHubWorkflow.branchPullRequest")(function*(cwd: string) {
    return yield* queryLock.withPermit(Effect.gen(function*() {
      const worktree = resolve(cwd)
      const branchResult = yield* run(worktree, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"])
      const branch = branchResult.stdout.trim()
      if (branchResult.exitCode !== 0 || !branch) return null
      const pulls = yield* required(worktree, "gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "100", "--json", "number,title,url,state,mergedAt,mergeable,mergeStateStatus,isCrossRepository,statusCheckRollup"], "inspect branch pull request").pipe(
        Effect.flatMap((json) => decodeJson("decode branch pull request", BranchPullRequestListSchema, json))
      )
      const pull = pulls.find((candidate) => !candidate.isCrossRepository && (candidate.state === "OPEN" || candidate.state === "MERGED" || candidate.mergedAt !== null))
      if (!pull) return null
      return {
        number: pull.number,
        title: pull.title,
        url: pull.url,
        branch,
        state: classifyBranchPullRequest(pull)
      } satisfies GitHubBranchPullRequest
    }))
  })

  const inspect = Effect.fn("GitHubWorkflow.inspect")(function*(cwd: string, summary: SessionShareSummary) {
    const worktree = resolve(cwd)
    const repositoryRoot = (yield* required(worktree, "git", ["rev-parse", "--show-toplevel"], "resolve Git worktree")).trim()
    if (!repositoryRoot) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "resolve Git worktree", message: "The selected workspace is not a Git worktree" }))
    const branch = (yield* required(worktree, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"], "resolve Git branch")).trim()
    if (!branch) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "resolve Git branch", message: "Check out a branch before creating a GitHub workflow" }))
    const commit = (yield* required(worktree, "git", ["rev-parse", "--short=12", "HEAD"], "resolve Git commit")).trim()
    const repository = yield* required(worktree, "gh", ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"], "inspect GitHub repository").pipe(
      Effect.flatMap((json) => decodeJson("decode GitHub repository", RepoSchema, json))
    )
    const repositoryOwner = repository.nameWithOwner.split("/")[0]
    if (!repositoryOwner) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "inspect GitHub repository", message: "GitHub returned an invalid repository owner" }))
    const pulls = yield* required(worktree, "gh", ["pr", "list", "--head", branch, "--state", "open", "--limit", "100", "--json", "number,title,url,isDraft,baseRefName,headRepositoryOwner,isCrossRepository"], "inspect pull request").pipe(
      Effect.flatMap((json) => decodeJson("decode pull request", PullRequestListSchema, json))
    )
    const existing = pulls.find((pull) => !pull.isCrossRepository && pull.headRepositoryOwner?.login.toLocaleLowerCase() === repositoryOwner.toLocaleLowerCase())
    const baseBranch = existing?.baseRefName ?? repository.defaultBranchRef.name
    yield* required(worktree, "git", ["fetch", "--quiet", "origin", baseBranch], "refresh pull request base")
    const baseRefCandidates = [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`]
    let baseRef: string | undefined
    for (const candidate of baseRefCandidates) {
      const verified = yield* run(worktree, "git", ["rev-parse", "--verify", "--quiet", candidate])
      if (verified.exitCode === 0) {
        baseRef = candidate
        break
      }
    }
    if (!baseRef) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "inspect committed diff", message: `Fetch or check out the ${baseBranch} base branch before creating a PR draft` }))
    const range = `${baseRef}...HEAD`
    const stats = parseNumstat(yield* required(worktree, "git", ["diff", "--numstat", "--no-renames", range, "--"], "inspect committed diff"))
    const commits = nonNegativeInteger(yield* required(worktree, "git", ["rev-list", "--count", `${baseRef}..HEAD`], "count branch commits"))
    const status = yield* required(worktree, "git", ["status", "--porcelain=v1", "--untracked-files=normal"], "inspect worktree status")
    const encodedBase = encodeURIComponent(baseBranch)
    const encodedBranch = branch.split("/").map(encodeURIComponent).join("/")
    return {
      repository: repository.nameWithOwner,
      repositoryUrl: repository.url,
      branch,
      baseBranch,
      commit,
      compareUrl: `${repository.url}/compare/${encodedBase}...${encodedBranch}`,
      ...stats,
      commits,
      hasUncommittedChanges: status.trim().length > 0,
      summary: summary.content,
      sessionName: summary.sessionName,
      ...(existing ? { existingPullRequest: { number: existing.number, title: existing.title, url: existing.url, isDraft: existing.isDraft } } : {})
    } satisfies GitHubWorkflowContext
  })

  const postComment = Effect.fn("GitHubWorkflow.comment")(function*(cwd: string, summary: SessionShareSummary, target: string) {
    return yield* mutationLock.withPermit(Effect.gen(function*() {
      const context = yield* inspect(cwd, summary)
      const issue = normalizeGitHubTarget(target, context.repository)
      if (!issue) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "validate GitHub target", message: `Enter an issue or PR number from ${context.repository}` }))
      const output = yield* required(cwd, "gh", ["issue", "comment", issue, "--repo", context.repository, "--body-file", "-"], "post GitHub comment", commentBody(context))
      const url = output.trim().split(/\s+/).findLast((value) => value.startsWith("https://github.com/"))
      if (!url) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "post GitHub comment", message: "GitHub accepted the comment but did not return its URL" }))
      return { url } satisfies GitHubCommentResult
    }))
  })

  const createOrUpdateDraft = Effect.fn("GitHubWorkflow.createOrUpdateDraft")(function*(cwd: string, summary: SessionShareSummary) {
    return yield* mutationLock.withPermit(Effect.gen(function*() {
      const context = yield* inspect(cwd, summary)
      if (context.branch === context.baseBranch) {
        return yield* Effect.fail(GitHubWorkflowError.make({ operation: "create pull request", message: `Create a feature branch instead of opening a PR from ${context.baseBranch}` }))
      }
      if (!context.existingPullRequest && context.commits === 0) {
        return yield* Effect.fail(GitHubWorkflowError.make({ operation: "create pull request", message: `Commit the ${context.branch} changes before opening a pull request` }))
      }
      yield* required(cwd, "git", ["push", "--set-upstream", "origin", "HEAD"], "push GitHub branch")
      const section = pullRequestBodySection(context)
      const existing = context.existingPullRequest
      if (existing) {
        const pulls = yield* required(cwd, "gh", ["pr", "view", String(existing.number), "--repo", context.repository, "--json", "number,title,url,isDraft,body,baseRefName"], "read pull request").pipe(
          Effect.flatMap((json) => decodeJson("decode pull request", PullRequestSchema, json))
        )
        const body = replaceSessionSummarySection(pulls.body, section)
        yield* required(cwd, "gh", ["pr", "edit", String(existing.number), "--repo", context.repository, "--body-file", "-"], "update pull request", body)
        return { number: existing.number, title: existing.title, url: existing.url, isDraft: existing.isDraft, action: "updated" } satisfies GitHubPullRequestResult
      }
      const output = yield* required(cwd, "gh", ["pr", "create", "--repo", context.repository, "--draft", "--base", context.baseBranch, "--head", context.branch, "--title", titleFromSession(context.sessionName), "--body-file", "-"], "create draft pull request", section)
      const url = output.trim().split(/\s+/).findLast((value) => value.startsWith("https://github.com/"))
      if (!url) return yield* Effect.fail(GitHubWorkflowError.make({ operation: "create draft pull request", message: "GitHub created the pull request but did not return its URL" }))
      const created = yield* required(cwd, "gh", ["pr", "view", url, "--repo", context.repository, "--json", "number,title,url,isDraft,body,baseRefName"], "read created pull request").pipe(
        Effect.flatMap((json) => decodeJson("decode created pull request", PullRequestSchema, json))
      )
      return { number: created.number, title: created.title, url: created.url, isDraft: created.isDraft, action: "created" } satisfies GitHubPullRequestResult
    }))
  })

  return { branchPullRequest, inspect, comment: postComment, createOrUpdateDraft }
})

export class GitHubWorkflow extends Context.Service<GitHubWorkflow, {
  readonly branchPullRequest: (cwd: string) => Effect.Effect<GitHubBranchPullRequest | null, GitHubWorkflowError>
  readonly inspect: (cwd: string, summary: SessionShareSummary) => Effect.Effect<GitHubWorkflowContext, GitHubWorkflowError>
  readonly comment: (cwd: string, summary: SessionShareSummary, target: string) => Effect.Effect<GitHubCommentResult, GitHubWorkflowError>
  readonly createOrUpdateDraft: (cwd: string, summary: SessionShareSummary) => Effect.Effect<GitHubPullRequestResult, GitHubWorkflowError>
}>()("GitHubWorkflow") {}

export const GitHubWorkflowLive = Layer.effect(GitHubWorkflow)(makeGitHubWorkflow({ run: executeCommand }))
