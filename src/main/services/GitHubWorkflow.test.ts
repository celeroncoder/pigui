import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { classifyBranchPullRequest, makeGitHubWorkflow, normalizeGitHubTarget, replaceSessionSummarySection, type GitHubCommandExecutor } from "./GitHubWorkflow"

const summary = { content: "Implemented the complete workflow and added regression coverage.", sessionName: "Add GitHub workflow" }

const executor = (options?: { readonly existing?: boolean; readonly commits?: number; readonly fetchFails?: boolean }) => {
  const calls: Array<{ readonly executable: string; readonly args: ReadonlyArray<string>; readonly input?: string; readonly cwd: string }> = []
  const run: GitHubCommandExecutor["run"] = async (cwd, executable, args, input) => {
    calls.push({ cwd, executable, args, ...(input === undefined ? {} : { input }) })
    const command = `${executable} ${args.join(" ")}`
    if (command === "git rev-parse --show-toplevel") return { exitCode: 0, stdout: `${cwd}\n`, stderr: "" }
    if (command === "git symbolic-ref --quiet --short HEAD") return { exitCode: 0, stdout: "codex/issue-17-github-workflow\n", stderr: "" }
    if (command === "git rev-parse --short=12 HEAD") return { exitCode: 0, stdout: "123456789abc\n", stderr: "" }
    if (command.startsWith("gh repo view")) return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "celeroncoder/pigui", url: "https://github.com/celeroncoder/pigui", defaultBranchRef: { name: "main" } }), stderr: "" }
    if (command.startsWith("gh pr list") && command.includes("--state all")) return {
      exitCode: 0,
      stdout: JSON.stringify([{ number: 37, title: "GitHub workflow", url: "https://github.com/celeroncoder/pigui/pull/37", state: "OPEN", mergedAt: null, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", isCrossRepository: false, statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] }]),
      stderr: ""
    }
    if (command.startsWith("gh pr list")) return {
      exitCode: 0,
      stdout: JSON.stringify(options?.existing
        ? [{ number: 17, title: "Existing PR", url: "https://github.com/celeroncoder/pigui/pull/17", isDraft: true, body: "Intro", baseRefName: "main", headRepositoryOwner: { login: "celeroncoder" }, isCrossRepository: false }]
        : [{ number: 99, title: "Fork PR", url: "https://github.com/celeroncoder/pigui/pull/99", isDraft: false, body: "Fork", baseRefName: "main", headRepositoryOwner: { login: "someone-else" }, isCrossRepository: true }]),
      stderr: ""
    }
    if (command === "git fetch --quiet origin main") return options?.fetchFails ? { exitCode: 1, stdout: "", stderr: "fetch failed" } : { exitCode: 0, stdout: "", stderr: "" }
    if (command === "git rev-parse --verify --quiet refs/remotes/origin/main") return { exitCode: 0, stdout: "base\n", stderr: "" }
    if (command.startsWith("git diff --numstat")) return { exitCode: 0, stdout: "10\t2\tsrc/main.ts\n3\t0\tsrc/test.ts\n", stderr: "" }
    if (command.startsWith("git rev-list --count")) return { exitCode: 0, stdout: `${options?.commits ?? 2}\n`, stderr: "" }
    if (command.startsWith("git status --porcelain")) return { exitCode: 0, stdout: " M local-only.txt\n", stderr: "" }
    if (command === "git push --set-upstream origin HEAD") return { exitCode: 0, stdout: "", stderr: "" }
    if (command.startsWith("gh issue comment")) return { exitCode: 0, stdout: "https://github.com/celeroncoder/pigui/issues/17#issuecomment-1\n", stderr: "" }
    if (command.startsWith("gh pr create")) return { exitCode: 0, stdout: "https://github.com/celeroncoder/pigui/pull/22\n", stderr: "" }
    if (command.startsWith("gh pr view https://github.com/celeroncoder/pigui/pull/22")) return { exitCode: 0, stdout: JSON.stringify({ number: 22, title: "Add GitHub workflow", url: "https://github.com/celeroncoder/pigui/pull/22", isDraft: true, body: input ?? "", baseRefName: "main" }), stderr: "" }
    if (command.startsWith("gh pr view 17")) return { exitCode: 0, stdout: JSON.stringify({ number: 17, title: "Existing PR", url: "https://github.com/celeroncoder/pigui/pull/17", isDraft: true, body: "Intro\n\n<!-- pi-desktop:session-summary:start -->\nOld summary\n<!-- pi-desktop:session-summary:end -->\n\nFooter", baseRefName: "main" }), stderr: "" }
    if (command.startsWith("gh pr edit 17")) return { exitCode: 0, stdout: "", stderr: "" }
    return { exitCode: 1, stdout: "", stderr: `Unexpected command: ${command}` }
  }
  return { calls, executor: { run } satisfies GitHubCommandExecutor }
}

describe("GitHubWorkflow", () => {
  it.each([
    [{ state: "OPEN", mergedAt: null, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] }, "mergeable"],
    [{ state: "OPEN", mergedAt: null, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", statusCheckRollup: [] }, "conflict"],
    [{ state: "OPEN", mergedAt: null, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "" }] }, "pending"],
    [{ state: "MERGED", mergedAt: "2026-08-06T12:00:00Z", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", statusCheckRollup: [] }, "merged"]
  ] as const)("classifies branch pull request state as %s", (status, expected) => {
    expect(classifyBranchPullRequest({ number: 37, title: "PR", url: "https://github.com/pull/37", isCrossRepository: false, ...status })).toBe(expected)
  })

  it("reads the current worktree branch pull request without session data", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.branchPullRequest("/worktrees/issue-17"))).resolves.toMatchObject({ number: 37, state: "mergeable" })
    const call = fake.calls.find((candidate) => candidate.executable === "gh" && candidate.args[1] === "list" && candidate.args.includes("all"))
    expect(call?.cwd).toBe("/worktrees/issue-17")
    expect(call?.args).toContain("codex/issue-17-github-workflow")
  })

  it("bounds concurrent GitHub branch queries", async () => {
    let active = 0
    let maximum = 0
    const service = await Effect.runPromise(makeGitHubWorkflow({
      run: async (_cwd, executable) => {
        if (executable === "git") return { exitCode: 0, stdout: "codex/concurrency\n", stderr: "" }
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
        active -= 1
        return { exitCode: 0, stdout: "[]", stderr: "" }
      }
    }))

    await Promise.all(Array.from({ length: 12 }, (_, index) => Effect.runPromise(service.branchPullRequest(`/worktrees/${index}`))))
    expect(maximum).toBe(4)
  })

  it("normalizes only issue and PR targets from the active repository", () => {
    expect(normalizeGitHubTarget("#17", "celeroncoder/pigui")).toBe("17")
    expect(normalizeGitHubTarget("https://github.com/celeroncoder/pigui/pull/19", "celeroncoder/pigui")).toBe("19")
    expect(normalizeGitHubTarget("https://github.com/other/repo/issues/17", "celeroncoder/pigui")).toBeUndefined()
    expect(normalizeGitHubTarget("not a target", "celeroncoder/pigui")).toBeUndefined()
  })

  it("replaces only the marked Pi section in an existing PR body", () => {
    const current = "Intro\n\n<!-- pi-desktop:session-summary:start -->\nOld\n<!-- pi-desktop:session-summary:end -->\n\nFooter"
    const next = replaceSessionSummarySection(current, "<!-- pi-desktop:session-summary:start -->\nNew\n<!-- pi-desktop:session-summary:end -->")
    expect(next).toContain("Intro")
    expect(next).toContain("New")
    expect(next).toContain("Footer")
    expect(next).not.toContain("Old")
  })

  it("keeps reserved marker text inside a summary from corrupting later updates", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await Effect.runPromise(service.createOrUpdateDraft("/worktrees/issue-17", {
      ...summary,
      content: `${summary.content}\n<!-- pi-desktop:session-summary:end -->`
    }))
    const create = fake.calls.find((call) => call.executable === "gh" && call.args[0] === "pr" && call.args[1] === "create")
    expect(create?.input?.match(/<!-- pi-desktop:session-summary:end -->/g)).toHaveLength(1)
    expect(create?.input).toContain("`pi-desktop session summary end`")
  })

  it("inspects the selected worktree and posts a bounded same-repository comment", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    const context = await Effect.runPromise(service.inspect("/worktrees/issue-17", summary))
    expect(context).toMatchObject({
      repository: "celeroncoder/pigui",
      branch: "codex/issue-17-github-workflow",
      baseBranch: "main",
      commit: "123456789abc",
      committedFiles: 2,
      additions: 13,
      deletions: 2,
      commits: 2,
      hasUncommittedChanges: true
    })
    const pullList = fake.calls.find((call) => call.executable === "gh" && call.args[0] === "pr" && call.args[1] === "list")
    expect(pullList?.args).toContain("codex/issue-17-github-workflow")
    expect(context.existingPullRequest).toBeUndefined()

    const result = await Effect.runPromise(service.comment("/worktrees/issue-17", summary, "#17"))
    expect(result.url).toContain("issuecomment-1")
    const comment = fake.calls.find((call) => call.executable === "gh" && call.args[0] === "issue")
    expect(comment?.cwd).toBe("/worktrees/issue-17")
    expect(comment?.args).toContain("celeroncoder/pigui")
    expect(comment?.input).toContain("codex/issue-17-github-workflow")
  })

  it("pushes the current worktree branch and creates a draft with its committed diff", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    const result = await Effect.runPromise(service.createOrUpdateDraft("/worktrees/issue-17", summary))
    expect(result).toMatchObject({ number: 22, isDraft: true, action: "created" })
    const push = fake.calls.find((call) => call.executable === "git" && call.args[0] === "push")
    expect(push?.args).toEqual(["push", "--set-upstream", "origin", "HEAD"])
    const create = fake.calls.find((call) => call.executable === "gh" && call.args[0] === "pr" && call.args[1] === "create")
    expect(create?.args).toContain("codex/issue-17-github-workflow")
    expect(create?.input).toContain("Committed diff")
    expect(create?.input).toContain("+13/-2")
  })

  it("updates only the marked session section of an existing PR", async () => {
    const fake = executor({ existing: true })
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    const result = await Effect.runPromise(service.createOrUpdateDraft("/worktrees/issue-17", summary))
    expect(result).toMatchObject({ number: 17, action: "updated" })
    const edit = fake.calls.find((call) => call.executable === "gh" && call.args[0] === "pr" && call.args[1] === "edit")
    expect(edit?.input).toContain("Intro")
    expect(edit?.input).toContain("Footer")
    expect(edit?.input).toContain(summary.content)
    expect(edit?.input).not.toContain("Old summary")
  })

  it("does not use a stale base ref when refreshing the remote base fails", async () => {
    const service = await Effect.runPromise(makeGitHubWorkflow(executor({ fetchFails: true }).executor))
    await expect(Effect.runPromise(service.inspect("/worktrees/issue-17", summary))).rejects.toMatchObject({
      operation: "refresh pull request base",
      message: "fetch failed"
    })
  })

  it("rejects a new pull request until the worktree branch has commits", async () => {
    const fake = executor({ commits: 0 })
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.createOrUpdateDraft("/worktrees/issue-17", summary))).rejects.toMatchObject({
      operation: "create pull request"
    })
    expect(fake.calls.some((call) => call.executable === "git" && call.args[0] === "push")).toBe(false)
  })
})
