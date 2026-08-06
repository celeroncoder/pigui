import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { Project } from "../../shared/contracts"
import { discoverRepository, parseWorktreeList } from "./ProjectStore"

const git = (cwd: string, args: ReadonlyArray<string>) => execFileSync("git", [...args], { cwd, encoding: "utf8" })

describe("Project worktrees", () => {
  it("keeps explicit branch and path metadata under one logical project", () => {
    const project: Project = {
      id: "repo",
      name: "demo",
      addedAt: 1,
      worktrees: [{ id: "main", name: "demo", path: "/tmp/demo", branch: "main", addedAt: 1 }]
    }
    expect(project.worktrees[0]).toMatchObject({ branch: "main", path: "/tmp/demo" })
  })

  it("parses branches and detached heads from Git's NUL-delimited porcelain format", () => {
    const records = parseWorktreeList([
      "worktree /repo", "HEAD 1234567890", "branch refs/heads/main", "",
      "worktree /repo-task", "HEAD abcdef0123", "detached", "", ""
    ].join("\0"))
    expect(records).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-task", branch: "detached @ abcdef0" }
    ])
  })

  it("discovers sibling linked worktrees as one repository and preserves their branches", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-worktrees-"))
    const repository = join(root, "repo")
    const sibling = join(root, "repo-feature")
    try {
      await mkdir(repository)
      git(repository, ["init", "--quiet", "--initial-branch=main"])
      git(repository, ["config", "user.email", "test@example.com"])
      git(repository, ["config", "user.name", "Test User"])
      await writeFile(join(repository, "README.md"), "test\n", "utf8")
      git(repository, ["add", "README.md"])
      git(repository, ["commit", "--quiet", "-m", "Initial"])
      git(repository, ["worktree", "add", "--quiet", "-b", "feature", sibling])

      const selection = await Effect.runPromise(discoverRepository(sibling))
      expect(selection.project.name).toBe("repo")
      expect(selection.project.worktrees).toHaveLength(2)
      expect(selection.project.worktrees.map((worktree) => worktree.branch).sort()).toEqual(["feature", "main"])
      expect(selection.worktree).toMatchObject({ path: await realpath(sibling), branch: "feature" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps non-Git project folders as standalone worktrees", async () => {
    const folder = await mkdtemp(join(tmpdir(), "pi-project-standalone-"))
    try {
      const selection = await Effect.runPromise(discoverRepository(folder))
      expect(selection.project.worktrees).toEqual([selection.worktree])
      expect(selection.worktree).toMatchObject({ path: await realpath(folder), branch: "no Git branch" })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
