import { FolderGit2, FolderPlus, GitBranch, GitFork, HardDrive, Plus } from "lucide-react"
import type { Project, ProjectWorktree, SessionSummary } from "../../../shared/contracts"

export interface WorktreeSessionList {
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly loading: boolean
  readonly unavailable?: boolean
}

interface ProjectSidebarProps {
  readonly projects: ReadonlyArray<Project>
  readonly sessionsByWorktree: Readonly<Record<string, WorktreeSessionList | undefined>>
  readonly activeProject: Project | null
  readonly activeWorktree: ProjectWorktree | null
  readonly activeSessionPath: string | null
  readonly activeSessionStreaming: boolean
  readonly onSelectSession: (project: Project, worktree: ProjectWorktree, session: SessionSummary) => void
  readonly onAddProject: () => void
  readonly onNewSession: (project?: Project, worktree?: ProjectWorktree) => void
}

const worktreeKey = (project: Project, worktree: ProjectWorktree) => `${project.id}:${worktree.id}`
const sessionTitle = (session: SessionSummary) => session.name || session.firstMessage || "Untitled session"

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    projects,
    sessionsByWorktree,
    activeProject,
    activeWorktree,
    activeSessionPath,
    activeSessionStreaming,
    onSelectSession,
    onAddProject,
    onNewSession
  } = props

  return (
    <aside className="project-sidebar" aria-label="Projects and sessions">
      <div className="sidebar-actions">
        <button className="primary-action" type="button" onClick={() => onNewSession()} disabled={!activeWorktree}>
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

      <nav className="project-list" aria-label="Project sessions">
        {projects.map((project) => (
          <section className={`project-group ${activeProject?.id === project.id ? "active" : ""}`} key={project.id} aria-labelledby={`project-${project.id}`}>
            <div className="project-row" id={`project-${project.id}`} title={project.name}>
              <FolderGit2 size={16} aria-hidden="true" />
              <span>{project.name}</span>
            </div>

            <div className="flat-session-list">
              {project.worktrees.flatMap((worktree, worktreeIndex) => {
                const contextKey = worktreeKey(project, worktree)
                const listing = sessionsByWorktree[contextKey]
                const sessions = listing?.sessions.filter((candidate) => !candidate.parentSessionPath) ?? []
                const isLocal = worktree.kind ? worktree.kind === "local" : worktreeIndex === 0
                const kindLabel = isLocal ? "local checkout" : "linked worktree"
                const branch = worktree.git?.branch ?? worktree.branch
                const dirty = !!worktree.git && worktree.git.changedFiles > 0
                const gitState = dirty
                  ? `${worktree.git?.changedFiles ?? 0} changed ${worktree.git?.changedFiles === 1 ? "file" : "files"}`
                  : worktree.git ? "Git clean" : "Git status not loaded"

                if (listing?.loading) {
                  return [<div className="session-skeleton compact" aria-label={`Loading sessions for ${kindLabel} ${branch}`} key={`${contextKey}:loading`} />]
                }

                if (listing?.unavailable) {
                  const label = `Sessions unavailable for ${kindLabel}, branch ${branch}, ${worktree.path}`
                  return [<div className="unavailable-worktree-row" role="status" aria-label={label} title={label} key={`${contextKey}:unavailable`}>Sessions unavailable</div>]
                }

                if (sessions.length === 0) {
                  const label = `Start a session in ${kindLabel}, branch ${branch}, ${gitState}, ${worktree.path}`
                  return [(
                    <button className="empty-worktree-row" type="button" onClick={() => onNewSession(project, worktree)} aria-label={label} title={label} key={`${contextKey}:empty`}>
                      <span className="empty-worktree-title">New session</span>
                      <span className="session-metadata" aria-hidden="true">
                        {isLocal ? <HardDrive size={13} /> : <GitFork size={13} />}
                        <GitBranch size={13} />
                        <i className={`git-status-dot ${dirty ? "dirty" : ""}`} />
                        <Plus size={13} />
                      </span>
                    </button>
                  )]
                }

                return sessions.map((candidate) => {
                  const title = sessionTitle(candidate)
                  const active = activeProject?.id === project.id && activeWorktree?.id === worktree.id && activeSessionPath === candidate.path
                  const state = active && activeSessionStreaming ? "running" : active ? "selected and idle" : "idle"
                  const label = `${title}. ${kindLabel}, branch ${branch}, ${gitState}, path ${worktree.path}. Session ${state}.`
                  return (
                    <button
                      className={`session-row flat ${active ? "active" : ""}`}
                      key={`${contextKey}:${candidate.path}`}
                      type="button"
                      onClick={() => onSelectSession(project, worktree, candidate)}
                      aria-current={active ? "page" : undefined}
                      aria-label={label}
                      title={label}
                    >
                      <span className="session-title">{title}</span>
                      <span className="session-metadata" aria-hidden="true">
                        {isLocal ? <HardDrive size={13} /> : <GitFork size={13} />}
                        <GitBranch size={13} />
                        <i className={`git-status-dot ${dirty ? "dirty" : ""}`} />
                        <i className={`session-state-dot ${active && activeSessionStreaming ? "streaming" : ""}`} />
                      </span>
                    </button>
                  )
                })
              })}
            </div>
          </section>
        ))}
      </nav>

      <button className="add-project" type="button" onClick={onAddProject}>
        <FolderPlus size={15} />
        <span>Add project or worktree</span>
      </button>
    </aside>
  )
}
