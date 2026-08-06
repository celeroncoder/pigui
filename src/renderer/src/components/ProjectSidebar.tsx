import { ChevronDown, Folder, FolderPlus, GitBranch, MoreHorizontal, Plus } from "lucide-react"
import type { Project, SessionSummary } from "../../../shared/contracts"
import { compactLabel } from "../lib/text"

interface ProjectSidebarProps {
  readonly projects: ReadonlyArray<Project>
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly activeProject: Project | null
  readonly activeSessionPath: string | null
  readonly isLoading: boolean
  readonly onSelectProject: (project: Project) => void
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
    activeSessionPath,
    isLoading,
    onSelectProject,
    onSelectSession,
    onAddProject,
    onNewSession
  } = props

  return (
    <aside className="project-sidebar" aria-label="Projects and sessions">
      <div className="sidebar-actions">
        <button className="primary-action" type="button" onClick={onNewSession} disabled={!activeProject}>
          <Plus size={16} strokeWidth={2.2} />
          <span>New session</span>
          <kbd>⌘N</kbd>
        </button>
      </div>

      <div className="section-label-row">
        <span className="section-label">Workspaces</span>
        <button className="mini-button" type="button" onClick={onAddProject} aria-label="Add project folder">
          <FolderPlus size={15} />
        </button>
      </div>

      <nav className="project-list">
        {projects.map((project) => {
          const isActive = activeProject?.id === project.id
          return (
            <div className="project-group" key={project.id}>
              <button
                className={`project-row ${isActive ? "active" : ""}`}
                type="button"
                onClick={() => onSelectProject(project)}
                aria-expanded={isActive}
              >
                <ChevronDown className={isActive ? "" : "collapsed"} size={14} />
                <Folder size={15} />
                <span>{project.name}</span>
                <MoreHorizontal className="row-more" size={15} />
              </button>

              {isActive && project.git && (
                <div className="sidebar-git-context" title={`Current branch: ${project.git.branch}`}>
                  <GitBranch size={11} aria-hidden="true" />
                  <span>{compactLabel(project.git.branch, 29)}</span>
                  {(project.git.additions > 0 || project.git.deletions > 0) && <small>+{project.git.additions}/-{project.git.deletions}</small>}
                </div>
              )}

              {isActive && (
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
      </nav>

      <button className="add-project" type="button" onClick={onAddProject}>
        <FolderPlus size={15} />
        <span>Add project folder</span>
      </button>
    </aside>
  )
}
