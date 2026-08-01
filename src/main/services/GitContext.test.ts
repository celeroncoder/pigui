import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { GitContext, GitContextLive } from "./GitContext"

const git = (cwd: string, args: ReadonlyArray<string>) => {
  execFileSync("git", [...args], { cwd, stdio: "ignore" })
}

const inspect = (cwd: string) => Effect.runPromise(Effect.gen(function*() {
  const context = yield* GitContext
  return yield* context.inspect(cwd)
}).pipe(Effect.provide(GitContextLive)))

describe("GitContext", () => {
  it("reports a branch and line totals for tracked and untracked changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-git-context-"))
    try {
      git(cwd, ["init", "--quiet"])
      git(cwd, ["config", "user.email", "test@example.com"])
      git(cwd, ["config", "user.name", "Test User"])
      await writeFile(join(cwd, "tracked.txt"), "same\nold\n", "utf8")
      git(cwd, ["add", "tracked.txt"])
      git(cwd, ["commit", "--quiet", "-m", "Initial commit"])

      await writeFile(join(cwd, "tracked.txt"), "same\nnew\nextra\n", "utf8")
      await writeFile(join(cwd, "untracked.txt"), "alpha\nbeta\n", "utf8")

      const status = await inspect(cwd)
      expect(status?.branch).toBeTruthy()
      expect(status?.additions).toBe(4)
      expect(status?.deletions).toBe(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("returns no context for a non-git folder", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-git-context-"))
    try {
      await expect(inspect(cwd)).resolves.toBeUndefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
