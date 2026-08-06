import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { GitHubPullRequestState, Project, SessionRuntimeStatus, SessionSummary } from "../../../shared/contracts"
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

const linkedSummary: SessionSummary = {
  ...summary,
  id: "linked-session",
  path: "/sessions/linked.jsonl",
  name: "Linked session"
}

const renderSidebar = (
  projects: ReadonlyArray<Project>,
  activeProject: Project,
  options: {
    readonly linkedSession?: SessionSummary
    readonly pullRequestState?: GitHubPullRequestState
    readonly unavailable?: boolean
    readonly localRuntimeStatus?: SessionRuntimeStatus
    readonly linkedRuntimeStatus?: SessionRuntimeStatus
  } = {}
) => renderToStaticMarkup(createElement(ProjectSidebar, {
  projects,
  sessionsByWorktree: {
    [`${activeProject.id}:${activeProject.id}-local`]: { sessions: options.unavailable ? [] : [summary], loading: false, unavailable: options.unavailable },
    [`${activeProject.id}:${activeProject.id}-linked`]: { sessions: options.linkedSession ? [options.linkedSession] : [], loading: false, unavailable: options.unavailable }
  },
  runtimeStatuses: {
    [summary.path]: options.localRuntimeStatus ?? "running",
    [linkedSummary.path]: options.linkedRuntimeStatus ?? "failed"
  },
  pullRequestsByWorktree: options.pullRequestState ? {
    [`${activeProject.id}:${activeProject.id}-linked`]: {
      number: 35,
      title: "Worktree support",
      url: "https://github.com/celeroncoder/pigui/pull/35",
      branch: "issue-14",
      state: options.pullRequestState
    }
  } : {},
  activeProject,
  activeWorktree: activeProject.worktrees.find((worktree) => worktree.kind === "local") ?? null,
  activeSessionPath: options.unavailable ? null : summary.path,
  onSelectProject: () => undefined,
  onSelectSession: () => undefined,
  onAddProject: () => undefined,
  onNewSession: () => undefined
}))

describe("ProjectSidebar", () => {
  it("combines worktree, pull-request, and runtime status in the same flat Pi-backed rows", () => {
    const alpha = project("alpha", "Alpha")
    const markup = renderSidebar([alpha], alpha, { linkedSession: linkedSummary, pullRequestState: "mergeable" })

    expect(markup).toContain("Issue #14 — full worktree support. local checkout, branch main, 1 changed file, path /repo/alpha. Session working.")
    expect(markup).toContain("Linked session. linked worktree, branch issue-14, Git status not loaded, path /repo/alpha-linked. PR #35 is mergeable. Session failed.")
    expect(markup).toContain('role="img" aria-label="Session status: Working"')
    expect(markup).toContain('role="img" aria-label="Session status: Failed"')
    expect(markup.match(/data-worktree-kind-icon="linked"/g)).toHaveLength(1)
    expect(markup).toContain("pull-request-state mergeable")
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain("empty-worktree-row")
    expect(markup).not.toContain("worktree-list")
  })

  it.each(["mergeable", "conflict", "pending", "merged"] as const)("renders the %s pull-request treatment", (state) => {
    const alpha = project("alpha", "Alpha")
    const markup = renderSidebar([alpha], alpha, { linkedSession: linkedSummary, pullRequestState: state })

    expect(markup).toContain(`pull-request-state ${state}`)
    expect(markup).toContain(state === "merged" ? "lucide-git-merge" : "lucide-git-pull-request")
    expect(markup.match(/data-worktree-kind-icon="linked"/g)).toHaveLength(1)
  })

  it.each([
    ["running", "Working"],
    ["input-required", "Needs input"],
    ["waiting", "Waiting"],
    ["done", "Done"],
    ["failed", "Failed"]
  ] as const)("renders the %s runtime treatment", (runtimeStatus, label) => {
    const alpha = project("alpha", "Alpha")
    const markup = renderSidebar([alpha], alpha, { localRuntimeStatus: runtimeStatus })

    expect(markup).toContain(`session-status ${runtimeStatus}`)
    expect(markup).toContain(`aria-label="Session status: ${label}"`)
  })

  it("keeps project details and new-session icon actions beside each independently collapsible project", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const markup = renderSidebar([alpha, beta], alpha)

    expect(markup).toContain('aria-label="New session in Alpha, local checkout Alpha"')
    expect(markup).toContain('aria-label="New session in Beta, local checkout Beta"')
    expect(markup).toContain('aria-label="Project details for Alpha"')
    expect(markup).toContain('aria-label="Project details for Beta"')
    expect(markup).toContain("lucide-square-pen")
    expect(markup).toContain("lucide-ellipsis")
    expect(markup).toContain('class="project-row active"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain("<kbd>")
    expect(markup).not.toContain("project-panel-label")
    expect(markup).not.toContain("project-new-session")
  })

  it("keeps creation available but omits pseudo-session rows when discovery fails", () => {
    const alpha = project("alpha", "Alpha")
    const markup = renderSidebar([alpha], alpha, { unavailable: true })

    expect(markup).toContain("New session in Alpha, local checkout Alpha")
    expect(markup).not.toContain("Sessions unavailable")
    expect(markup).not.toContain("session-row flat")
    expect(markup).not.toContain("No sessions yet")
  })
})
