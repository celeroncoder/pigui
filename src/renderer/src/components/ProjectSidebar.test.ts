import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Project, SessionSummary } from "../../../shared/contracts"
import { ProjectSidebar } from "./ProjectSidebar"

const project: Project = {
  id: "project",
  name: "pi-gui",
  addedAt: 1,
  worktrees: [
    { id: "linked", path: "/repo/pi-gui-issue-14", name: "pi-gui-issue-14", branch: "issue-14", addedAt: 2, kind: "linked" },
    { id: "local", path: "/repo/pi-gui", name: "pi-gui", branch: "main", addedAt: 1, kind: "local", git: { branch: "main", additions: 1, deletions: 0, changedFiles: 1 } }
  ]
}

const summary: SessionSummary = {
  id: "session",
  path: "/sessions/issue-14.jsonl",
  name: "Issue #14 — full worktree support",
  firstMessage: "Implement worktrees",
  updatedAt: 1,
  messageCount: 2
}

describe("ProjectSidebar", () => {
  it("renders one flat, context-labelled session list and an empty-worktree action", () => {
    const markup = renderToStaticMarkup(createElement(ProjectSidebar, {
      projects: [project],
      sessionsByWorktree: {
        "project:local": { sessions: [summary], loading: false },
        "project:linked": { sessions: [], loading: false }
      },
      activeProject: project,
      activeWorktree: project.worktrees.find((worktree) => worktree.id === "local") ?? null,
      activeSessionPath: summary.path,
      activeSessionStreaming: true,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: () => undefined
    }))

    expect(markup).toContain("Issue #14 — full worktree support. local checkout, branch main, 1 changed file, path /repo/pi-gui. Session running.")
    expect(markup).toContain("Start a session in linked worktree, branch issue-14, Git status not loaded, /repo/pi-gui-issue-14")
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain("aria-expanded")
    expect(markup).not.toContain("worktree-list")
  })

  it("does not present creation when Pi session discovery fails", () => {
    const markup = renderToStaticMarkup(createElement(ProjectSidebar, {
      projects: [project],
      sessionsByWorktree: {
        "project:local": { sessions: [], loading: false, unavailable: true },
        "project:linked": { sessions: [], loading: false, unavailable: true }
      },
      activeProject: project,
      activeWorktree: null,
      activeSessionPath: null,
      activeSessionStreaming: false,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: () => undefined
    }))

    expect(markup).toContain("Sessions unavailable for local checkout, branch main, /repo/pi-gui")
    expect(markup).toContain("Sessions unavailable for linked worktree, branch issue-14, /repo/pi-gui-issue-14")
    expect(markup).not.toContain("Start a session in")
  })
})
