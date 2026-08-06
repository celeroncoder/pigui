import { ChevronDown, FolderGit2, FolderPlus, GitBranch, Plus } from "lucide-react"
import { useState } from "react"
import type { Project, ProjectWorktree, SessionSummary } from "../../../shared/contracts"
import { compactLabel } from "../lib/text"

interface ProjectSidebarProps {
  readonly projects: ReadonlyArray<Project>
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly activeProject: Project | null
  readonly activeWorktree: ProjectWorktree | null
  readonly activeSessionPath: string | null
  readonly isLoading: boolean
  readonly onSelectWorktree: (project: Project, worktree: ProjectWorktree) => void
  readonly onSelectSession: (session: SessionSummary) => void
  readonly onAddProject: () => void
  readonly onNewSession: () => void
}

const formatRelative = (timestamp: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    projects,
    sessions,
    activeProject,
    activeWorktree,
    activeSessionPath,
    isLoading,
    onSelectWorktree,
    onSelectSession,
    onAddProject,
    onNewSession
  } = props
  const [projectExpansion, setProjectExpansion] = useState<ReadonlyMap<string, boolean>>(() => new Map())

  return (
    <aside className="project-sidebar" aria-label="Projects, worktrees, and sessions">
      <div className="sidebar-actions">
        <button className="primary-action" type="button" onClick={onNewSession} disabled={!activeWorktree}>
          <Plus size={16} strokeWidth={2.2} />
          <span>New session</span>
          <kbd>⌘N</kbd>
        </button>
      </div>

      <div className="section-label-row">
        <span className="section-label">Repositories</span>
        <button className="mini-button" type="button" onClick={onAddProject} aria-label="Add Git worktree">
          <FolderPlus size={15} />
        </button>
      </div>

      <nav className="project-list">
        {projects.map((project) => {
          const projectActive = activeProject?.id === project.id
          const projectExpanded = projectExpansion.get(project.id) ?? projectActive
          const firstWorktree = project.worktrees[0]
          return (
            <div className={`project-group ${projectActive ? "active" : ""}`} key={project.id}>
              <button
                className={`project-row ${projectActive ? "active" : ""}`}
                type="button"
                disabled={!firstWorktree}
                onClick={() => {
                  setProjectExpansion((current) => {
                    const next = new Map(current)
                    next.set(project.id, !projectExpanded)
                    return next
                  })
                  if (!projectActive && firstWorktree) onSelectWorktree(project, firstWorktree)
                }}
                aria-expanded={projectExpanded}
              >
                <ChevronDown className={projectExpanded ? "" : "collapsed"} size={14} />
                <FolderGit2 size={15} />
                <span>{project.name}</span>
                <small>{project.worktrees.length}</small>
              </button>

              {projectExpanded && (
                <div className="worktree-list" aria-label={`${project.name} worktrees`}>
                  {project.worktrees.map((worktree) => {
                    const worktreeActive = activeWorktree?.id === worktree.id
                    const git = worktree.git
                    return (
                      <div className="worktree-group" key={worktree.id}>
                        <button
                          className={`worktree-row ${worktreeActive ? "active" : ""}`}
                          type="button"
                          onClick={() => onSelectWorktree(project, worktree)}
                          aria-current={worktreeActive ? "location" : undefined}
                          aria-label={`Worktree ${git?.branch ?? worktree.branch}, ${worktree.path}`}
                          title={`${worktree.path}\nBranch: ${git?.branch ?? worktree.branch}`}
                        >
                          <GitBranch size={12} aria-hidden="true" />
                          <span className="worktree-copy">
                            <strong>{compactLabel(git?.branch ?? worktree.branch, 25)}</strong>
                            <small>{compactLabel(worktree.name, 28)}</small>
                          </span>
                          {git && (git.additions > 0 || git.deletions > 0) && <em>+{git.additions}/-{git.deletions}</em>}
                        </button>

                        {worktreeActive && (
                          <div className="session-list">
                            {isLoading && <div className="session-skeleton" aria-label="Loading sessions" />}
                            {!isLoading && sessions.length === 0 && (
                              <button className="empty-session" type="button" onClick={onNewSession}>
                                No sessions yet. Start one.
                              </button>
                            )}
                            {!isLoading && sessions.map((session) => (
                              <button
                                className={`session-row ${activeSessionPath === session.path ? "active" : ""}`}
                                key={session.path}
                                type="button"
                                onClick={() => onSelectSession(session)}
                              >
                                <span className="session-title" title={session.name || session.firstMessage}>{compactLabel(session.name || session.firstMessage || "Untitled session")}</span>
                                <span className="session-time">{formatRelative(session.updatedAt)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <button className="add-project" type="button" onClick={onAddProject}>
        <FolderPlus size={15} />
        <span>Add project or worktree</span>
      </button>
    </aside>
  )
}
