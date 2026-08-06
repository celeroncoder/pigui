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

const diff = (cwd: string) => Effect.runPromise(Effect.gen(function*() {
  const context = yield* GitContext
  return yield* context.diff(cwd)
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
      expect(status?.changedFiles).toBe(2)
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

  it("counts binary-only changes without inventing line totals", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-git-context-"))
    try {
      git(cwd, ["init", "--quiet"])
      git(cwd, ["config", "user.email", "test@example.com"])
      git(cwd, ["config", "user.name", "Test User"])
      await writeFile(join(cwd, "tracked.txt"), "initial\n", "utf8")
      git(cwd, ["add", "tracked.txt"])
      git(cwd, ["commit", "--quiet", "-m", "Initial commit"])

      await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 3]))

      const status = await inspect(cwd)
      expect(status?.additions).toBe(0)
      expect(status?.deletions).toBe(0)
      expect(status?.changedFiles).toBe(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("returns readable tracked and untracked file diffs", async () => {
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

      const result = await diff(cwd)
      expect(result).toEqual({
        truncated: false,
        omittedFiles: 0,
        files: [
          { path: "tracked.txt", status: "modified", oldContents: "same\nold\n", newContents: "same\nnew\nextra\n", binary: false },
          { path: "untracked.txt", status: "untracked", oldContents: null, newContents: "alpha\nbeta\n", binary: false }
        ]
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("labels staged additions separately from untracked files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-git-context-"))
    try {
      git(cwd, ["init", "--quiet"])
      git(cwd, ["config", "user.email", "test@example.com"])
      git(cwd, ["config", "user.name", "Test User"])
      await writeFile(join(cwd, "tracked.txt"), "initial\n", "utf8")
      git(cwd, ["add", "tracked.txt"])
      git(cwd, ["commit", "--quiet", "-m", "Initial commit"])

      await writeFile(join(cwd, "staged.txt"), "staged\n", "utf8")
      git(cwd, ["add", "staged.txt"])
      await writeFile(join(cwd, "untracked.txt"), "untracked\n", "utf8")

      const result = await diff(cwd)
      expect(result?.files.find((file) => file.path === "staged.txt")?.status).toBe("added")
      expect(result?.files.find((file) => file.path === "untracked.txt")?.status).toBe("untracked")
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("bounds large diff previews and reports omitted files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-git-context-"))
    try {
      git(cwd, ["init", "--quiet"])
      await Promise.all(Array.from({ length: 201 }, (_value, index) => writeFile(join(cwd, `file-${index}.txt`), `${index}\n`, "utf8")))

      const result = await diff(cwd)
      expect(result?.files).toHaveLength(200)
      expect(result?.truncated).toBe(true)
      expect(result?.omittedFiles).toBe(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
