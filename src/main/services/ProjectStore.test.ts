import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { Project } from "../../shared/contracts"
import { discoverRepository, parseWorktreeList, validateStoredWorktreePath } from "./ProjectStore"

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

  it("canonicalizes legacy standalone folders without losing their display metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-legacy-"))
    const folder = join(root, "project")
    const alias = join(root, "project-alias")
    try {
      await mkdir(folder)
      await symlink(folder, alias)
      const previous: Project = {
        id: "legacy-id",
        name: "Saved project",
        addedAt: 42,
        worktrees: [{ id: "legacy-worktree", path: alias, name: "Saved folder", branch: "unknown", addedAt: 42 }]
      }
      const selection = await Effect.runPromise(discoverRepository(alias, previous))
      expect(selection.project).toMatchObject({ name: "Saved project", addedAt: 42 })
      expect(selection.project.worktrees).toEqual([selection.worktree])
      expect(selection.worktree).toMatchObject({ path: await realpath(folder), name: "Saved folder", branch: "no Git branch", addedAt: 42 })
      expect(selection.project.id).not.toBe("legacy-id")
      expect(selection.worktree.id).not.toBe("legacy-worktree")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("ignores prunable sibling metadata while keeping healthy linked worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-prunable-"))
    const repository = join(root, "repo")
    const missingSibling = join(root, "repo-missing")
    try {
      await mkdir(repository)
      git(repository, ["init", "--quiet", "--initial-branch=main"])
      git(repository, ["config", "user.email", "test@example.com"])
      git(repository, ["config", "user.name", "Test User"])
      await writeFile(join(repository, "README.md"), "test\n", "utf8")
      git(repository, ["add", "README.md"])
      git(repository, ["commit", "--quiet", "-m", "Initial"])
      git(repository, ["worktree", "add", "--quiet", "-b", "missing", missingSibling])
      await rm(missingSibling, { recursive: true, force: true })

      const selection = await Effect.runPromise(discoverRepository(repository))
      expect(selection.project.worktrees).toHaveLength(1)
      expect(selection.worktree).toMatchObject({ path: await realpath(repository), branch: "main" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects a persisted worktree path that now redirects through a symlink", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-project-path-swap-")))
    const approved = join(root, "approved")
    const redirected = join(root, "redirected")
    try {
      await mkdir(approved)
      await mkdir(redirected)
      await expect(Effect.runPromise(validateStoredWorktreePath(approved))).resolves.toBe(approved)
      await rm(approved, { recursive: true, force: true })
      await symlink(redirected, approved)
      await expect(Effect.runPromise(validateStoredWorktreePath(approved))).rejects.toThrow(/no longer resolves to its approved canonical folder/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
