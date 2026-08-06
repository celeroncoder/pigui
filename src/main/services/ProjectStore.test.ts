import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import type { Project } from "../../shared/contracts"
import { discoverRepository, parseBranchRefs, parseWorktreeList, runWorktreeSetup, validateStoredWorktreePath } from "./ProjectStore"

const git = (cwd: string, args: ReadonlyArray<string>) => execFileSync("git", [...args], { cwd, encoding: "utf8" })
const waitForFile = async (path: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, "utf8")
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

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

  it("normalizes selectable Git base branches without symbolic remote heads", () => {
    expect(parseBranchRefs("origin/main\nfeature\norigin/HEAD\nmain\norigin/main\n")).toEqual(["feature", "main", "origin/main"])
  })

  it("runs the default Codex worktree environment before a first linked-worktree session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-setup-"))
    const source = join(root, "source")
    const worktree = join(root, "linked")
    try {
      await mkdir(join(source, ".codex", "environments"), { recursive: true })
      await mkdir(worktree)
      const canonicalSource = await realpath(source)
      const canonicalWorktree = await realpath(worktree)
      await writeFile(join(source, ".codex", "environments", "environment.toml"), [
        "version = 1",
        'name = "Repository setup"',
        "[setup]",
        "script = '''",
        "printf '%s\\n%s' \"$CODEX_SOURCE_TREE_PATH\" \"$CODEX_WORKTREE_PATH\" > \"$CODEX_WORKTREE_PATH/setup-marker.txt\"",
        "'''",
        ""
      ].join("\n"), "utf8")
      const project: Project = {
        id: "repo",
        name: "repo",
        addedAt: 1,
        worktrees: [
          { id: "source", name: "source", path: canonicalSource, branch: "main", kind: "local", addedAt: 1 },
          { id: "linked", name: "linked", path: canonicalWorktree, branch: "feature", kind: "linked", addedAt: 1 }
        ]
      }
      const linked = project.worktrees[1]
      if (!linked) throw new Error("Expected linked worktree fixture")
      await Effect.runPromise(runWorktreeSetup(project, linked))
      expect(await readFile(join(canonicalWorktree, "setup-marker.txt"), "utf8")).toBe(`${canonicalSource}\n${canonicalWorktree}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("terminates the setup process group when interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-setup-interrupt-"))
    const source = join(root, "source")
    const worktree = join(root, "linked")
    try {
      await mkdir(join(source, ".codex", "environments"), { recursive: true })
      await mkdir(worktree)
      const canonicalSource = await realpath(source)
      const canonicalWorktree = await realpath(worktree)
      await writeFile(join(source, ".codex", "environments", "environment.toml"), [
        "version = 1",
        'name = "Interruptible setup"',
        "[setup]",
        "script = '''",
        "printf '%s' \"$$\" > \"$CODEX_WORKTREE_PATH/setup.pid\"",
        "while :; do sleep 1; done",
        "'''",
        ""
      ].join("\n"), "utf8")
      const project: Project = {
        id: "repo",
        name: "repo",
        addedAt: 1,
        worktrees: [
          { id: "source", name: "source", path: canonicalSource, branch: "main", kind: "local", addedAt: 1 },
          { id: "linked", name: "linked", path: canonicalWorktree, branch: "feature", kind: "linked", addedAt: 1 }
        ]
      }
      const linked = project.worktrees[1]
      if (!linked) throw new Error("Expected linked worktree fixture")
      const fiber = Effect.runFork(runWorktreeSetup(project, linked))
      const pid = Number(await waitForFile(join(canonicalWorktree, "setup.pid")))
      await Effect.runPromise(Fiber.interrupt(fiber))
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          process.kill(pid, 0)
          await new Promise((resolve) => setTimeout(resolve, 20))
        } catch {
          return
        }
      }
      throw new Error(`Setup process ${pid} remained alive after interruption`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
      expect(selection.project.worktrees.find((worktree) => worktree.branch === "main")).toMatchObject({ kind: "local" })
      expect(selection.worktree).toMatchObject({ path: await realpath(sibling), branch: "feature", kind: "linked" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps non-Git project folders as standalone worktrees", async () => {
    const folder = await mkdtemp(join(tmpdir(), "pi-project-standalone-"))
    try {
      const selection = await Effect.runPromise(discoverRepository(folder))
      expect(selection.project.worktrees).toEqual([selection.worktree])
      expect(selection.worktree).toMatchObject({ path: await realpath(folder), branch: "no Git branch", kind: "local" })
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
