import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Project, SessionSummary } from "../../../shared/contracts"
import { ProjectSidebar } from "./ProjectSidebar"

const project = (id: string, name: string): Project => ({
  id,
  name,
  addedAt: 1,
  worktrees: [
    { id: `${id}-linked`, path: `/repo/${id}-linked`, name: `${name} linked`, branch: "issue-14", addedAt: 2, kind: "linked" },
    { id: `${id}-local`, path: `/repo/${id}`, name, branch: "main", addedAt: 1, kind: "local", git: { branch: "main", additions: 1, deletions: 0, changedFiles: 1 } }
  ]
})

const summary: SessionSummary = {
  id: "session",
  path: "/sessions/issue-14.jsonl",
  name: "Issue #14 — full worktree support",
  firstMessage: "Implement worktrees",
  updatedAt: 1,
  messageCount: 2
}

const renderSidebar = (projects: ReadonlyArray<Project>, activeProject: Project) => renderToStaticMarkup(createElement(ProjectSidebar, {
  projects,
  sessionsByWorktree: {
    [`${activeProject.id}:${activeProject.id}-local`]: { sessions: [summary], loading: false },
    [`${activeProject.id}:${activeProject.id}-linked`]: { sessions: [], loading: false }
  },
  activeProject,
  activeWorktree: activeProject.worktrees.find((worktree) => worktree.kind === "local") ?? null,
  activeSessionPath: summary.path,
  activeSessionStreaming: true,
  onSelectProject: () => undefined,
  onSelectSession: () => undefined,
  onAddProject: () => undefined,
  onNewSession: () => undefined
}))

describe("ProjectSidebar", () => {
  it("renders a flat, context-labelled session list without empty-worktree rows", () => {
    const alpha = project("alpha", "Alpha")
    const markup = renderSidebar([alpha], alpha)

    expect(markup).toContain("Issue #14 — full worktree support. local checkout, branch main, 1 changed file, path /repo/alpha. Session running.")
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain("empty-worktree-row")
    expect(markup).not.toContain("worktree-list")
  })

  it("keeps each project action scoped and the active project independently collapsible", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const markup = renderSidebar([alpha, beta], alpha)

    expect(markup).toContain('aria-label="New session in Alpha, local checkout Alpha"')
    expect(markup).toContain('aria-label="New session in Beta, local checkout Beta"')
    expect(markup).toContain('class="project-row active"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain("<kbd>⌘N</kbd>")
    expect(markup).not.toContain("project-panel-label")
  })

  it("keeps the project action available when session discovery fails", () => {
    const alpha = project("alpha", "Alpha")
    const markup = renderToStaticMarkup(createElement(ProjectSidebar, {
      projects: [alpha],
      sessionsByWorktree: {
        "alpha:alpha-local": { sessions: [], loading: false, unavailable: true },
        "alpha:alpha-linked": { sessions: [], loading: false, unavailable: true }
      },
      activeProject: alpha,
      activeWorktree: alpha.worktrees[1] ?? null,
      activeSessionPath: null,
      activeSessionStreaming: false,
      onSelectProject: () => undefined,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: () => undefined
    }))

    expect(markup).toContain("Sessions unavailable for local checkout, branch main, /repo/alpha")
    expect(markup).toContain("Sessions unavailable for linked worktree, branch issue-14, /repo/alpha-linked")
    expect(markup).toContain("New session in Alpha, local checkout Alpha")
    expect(markup).not.toContain("No sessions yet")
  })
})
