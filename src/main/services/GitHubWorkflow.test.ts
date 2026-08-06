import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { classifyBranchPullRequest, makeGitHubWorkflow, type GitHubCommandExecutor } from "./GitHubWorkflow"

const executor = (options?: { readonly clean?: boolean; readonly noUpstream?: boolean }) => {
  const calls: Array<{ readonly executable: string; readonly args: ReadonlyArray<string>; readonly cwd: string }> = []
  const run: GitHubCommandExecutor["run"] = async (cwd, executable, args) => {
    calls.push({ cwd, executable, args })
    const command = `${executable} ${args.join(" ")}`
    if (command === "git symbolic-ref --quiet --short HEAD") return { exitCode: 0, stdout: "codex/issue-17-github-workflow\n", stderr: "" }
    if (command === "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return options?.noUpstream
      ? { exitCode: 128, stdout: "", stderr: "no upstream" }
      : { exitCode: 0, stdout: "origin/codex/issue-17-github-workflow\n", stderr: "" }
    if (command === "git rev-list --count origin/codex/issue-17-github-workflow..HEAD") return { exitCode: 0, stdout: "2\n", stderr: "" }
    if (command === "git status --porcelain=v1 --untracked-files=normal") return { exitCode: 0, stdout: options?.clean ? "" : " M src/main.ts\n?? src/new.ts\n", stderr: "" }
    if (command === "git add --all --") return { exitCode: 0, stdout: "", stderr: "" }
    if (command.startsWith("git commit -m")) return { exitCode: 0, stdout: "[branch abc123] Commit\n", stderr: "" }
    if (command === "git rev-parse --short=12 HEAD") return { exitCode: 0, stdout: "123456789abc\n", stderr: "" }
    if (command === "git push --set-upstream origin HEAD") return { exitCode: 0, stdout: "", stderr: "" }
    if (command === "gh repo view --json nameWithOwner,url") return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "celeroncoder/pigui", url: "https://github.com/celeroncoder/pigui" }), stderr: "" }
    if (command.startsWith("gh pr list")) return { exitCode: 0, stdout: JSON.stringify([{
      number: 37,
      title: "GitHub environment",
      url: "https://github.com/celeroncoder/pigui/pull/37",
      state: "OPEN",
      mergedAt: null,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      isCrossRepository: false,
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }]
    }]), stderr: "" }
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
  ] as const)("classifies attached pull request state", (status, expected) => {
    expect(classifyBranchPullRequest({ number: 37, title: "PR", url: "https://github.com/pull/37", isCrossRepository: false, ...status })).toBe(expected)
  })

  it("inspects branch sync state and the attached pull request", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.worktree("/worktrees/issue-17"))).resolves.toMatchObject({
      repository: "celeroncoder/pigui",
      branch: "codex/issue-17-github-workflow",
      hasUpstream: true,
      ahead: 2,
      pullRequest: { number: 37, state: "mergeable" }
    })
  })

  it("bounds concurrent attached-PR queries", async () => {
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

  it("interrupts an in-flight GitHub command with the Effect fiber", async () => {
    let interrupted = false
    const service = await Effect.runPromise(makeGitHubWorkflow({
      run: async (_cwd, _executable, _args, _input, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          interrupted = true
          reject(new Error("interrupted"))
        }, { once: true })
      })
    }))
    const fiber = Effect.runFork(service.branchPullRequest("/worktrees/interruption"))
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(interrupted).toBe(true)
  })

  it("serializes commit and push mutations", async () => {
    let active = 0
    let maximum = 0
    const fake = executor({ clean: true })
    const service = await Effect.runPromise(makeGitHubWorkflow({
      run: async (...args) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2))
        const result = await fake.executor.run(...args)
        active -= 1
        return result
      }
    }))
    await Promise.all([
      Effect.runPromise(service.commitOrPush("/worktrees/one", "Unused")),
      Effect.runPromise(service.commitOrPush("/worktrees/two", "Unused"))
    ])
    expect(maximum).toBe(1)
  })

  it("commits the complete current diff before pushing", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.commitOrPush("/worktrees/issue-17", "Finish GitHub environment"))).resolves.toEqual({ action: "committed-and-pushed", commit: "123456789abc" })
    const commands = fake.calls.map((call) => `${call.executable} ${call.args.join(" ")}`)
    expect(commands.indexOf("git add --all --")).toBeLessThan(commands.indexOf("git commit -m Finish GitHub environment"))
    expect(commands.indexOf("git commit -m Finish GitHub environment")).toBeLessThan(commands.indexOf("git push --set-upstream origin HEAD"))
  })

  it("pushes without creating an empty commit when the worktree is clean", async () => {
    const fake = executor({ clean: true })
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.commitOrPush("/worktrees/issue-17", "Unused"))).resolves.toEqual({ action: "pushed" })
    expect(fake.calls.some((call) => call.args[0] === "commit")).toBe(false)
  })

  it("rejects an unsafe commit message before staging changes", async () => {
    const fake = executor()
    const service = await Effect.runPromise(makeGitHubWorkflow(fake.executor))
    await expect(Effect.runPromise(service.commitOrPush("/worktrees/issue-17", `bad\u0000message`))).rejects.toMatchObject({ operation: "validate commit message" })
    expect(fake.calls.some((call) => call.args[0] === "add")).toBe(false)
  })

  it("does not push if the selected branch changes during the mutation", async () => {
    let branchReads = 0
    const fake = executor({ clean: true })
    const service = await Effect.runPromise(makeGitHubWorkflow({
      run: async (...args) => {
        if (args[1] === "git" && args[2][0] === "symbolic-ref") {
          branchReads += 1
          return { exitCode: 0, stdout: branchReads === 1 ? "codex/issue-17-github-workflow\n" : "main\n", stderr: "" }
        }
        return fake.executor.run(...args)
      }
    }))
    await expect(Effect.runPromise(service.commitOrPush("/worktrees/issue-17", "Unused"))).rejects.toMatchObject({ operation: "validate Git branch" })
    expect(fake.calls.some((call) => call.args[0] === "push")).toBe(false)
  })
})
