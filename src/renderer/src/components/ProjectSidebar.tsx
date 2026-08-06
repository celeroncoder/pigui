import { ChevronDown, Folder, FolderPlus, GitBranch, MoreHorizontal, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Project, SessionSummary } from "../../../shared/contracts"
import { compactLabel } from "../lib/text"
import { isProjectExpanded, preserveProjectExpansionOnSelection, toggleProjectExpansion } from "./projectSidebarState"

interface ProjectSidebarProps {
  readonly projects: ReadonlyArray<Project>
  readonly sessionsByProjectId: Readonly<Record<string, ReadonlyArray<SessionSummary>>>
  readonly activeProject: Project | null
  readonly activeSessionPath: string | null
  readonly loadingProjectId: string | null
  readonly onSelectProject: (project: Project) => void
  readonly onSelectSession: (project: Project, session: SessionSummary) => void
  readonly onAddProject: () => void
  readonly onNewSession: (project: Project) => void
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
    sessionsByProjectId,
    activeProject,
    activeSessionPath,
    loadingProjectId,
    onSelectProject,
    onSelectSession,
    onAddProject,
    onNewSession
  } = props
  const [expansionState, setExpansionState] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const previousActiveProjectIdRef = useRef<string | null>(null)

  useEffect(() => {
    const nextActiveProjectId = activeProject?.id ?? null
    const previousActiveProjectId = previousActiveProjectIdRef.current
    if (nextActiveProjectId && nextActiveProjectId !== previousActiveProjectId) {
      setExpansionState((current) => preserveProjectExpansionOnSelection(current, previousActiveProjectId, nextActiveProjectId))
    }
    previousActiveProjectIdRef.current = nextActiveProjectId
  }, [activeProject?.id])

  return (
    <aside className="project-sidebar" aria-label="Projects and sessions">
      <div className="section-label-row">
        <span className="section-label">Workspaces</span>
        <button className="mini-button" type="button" onClick={onAddProject} aria-label="Add project folder">
          <FolderPlus size={15} />
        </button>
      </div>

      <nav className="project-list">
        {projects.map((project) => {
          const isActive = activeProject?.id === project.id
          const isExpanded = isProjectExpanded(activeProject?.id ?? null, project.id, expansionState)
          const sessions = (sessionsByProjectId[project.id] ?? []).filter((session) => !session.parentSessionPath)
          const isLoading = loadingProjectId === project.id
          return (
            <div className="project-group" key={project.id}>
              <button
                className={`project-row ${isActive ? "active" : ""}`}
                type="button"
                onClick={() => {
                  if (isActive) {
                    setExpansionState((current) => toggleProjectExpansion(current, activeProject?.id ?? null, project.id))
                  } else {
                    setExpansionState((current) => preserveProjectExpansionOnSelection(current, activeProject?.id ?? null, project.id))
                    onSelectProject(project)
                  }
                }}
                aria-expanded={isExpanded}
                aria-current={isActive ? "page" : undefined}
              >
                <ChevronDown className={isExpanded ? "" : "collapsed"} size={14} />
                <Folder size={15} />
                <span>{project.name}</span>
                <MoreHorizontal className="row-more" size={15} />
              </button>

              {isExpanded && project.git && (
                <div className="sidebar-git-context" title={`Current branch: ${project.git.branch}`}>
                  <GitBranch size={11} aria-hidden="true" />
                  <span>{compactLabel(project.git.branch, 29)}</span>
                  {(project.git.additions > 0 || project.git.deletions > 0) && <small>+{project.git.additions}/-{project.git.deletions}</small>}
                </div>
              )}

              <div className={`project-panel ${isActive ? "active" : ""}`} aria-label={`${project.name} session actions`}>
                <div className="project-panel-heading">
                  <span className="project-panel-label">{isActive ? "Sessions" : "Workspace"}</span>
                  <button
                    className="project-new-session"
                    type="button"
                    onClick={() => onNewSession(project)}
                    aria-label={`New session in ${project.name}`}
                    title={`New session in ${project.name}`}
                  >
                    <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
                    <span>New session</span>
                    {isActive && <kbd>⌘N</kbd>}
                  </button>
                </div>
                {isExpanded && (
                  <div className="session-list">
                    {isLoading && <div className="session-skeleton" aria-label="Loading sessions" />}
                    {!isLoading && sessions.length === 0 && (
                      <span className="empty-session">No sessions yet. Start one above.</span>
                    )}
                    {!isLoading && sessions.map((session) => (
                      <button
                        className={`session-row ${activeSessionPath === session.path ? "active" : ""}`}
                        key={session.path}
                        type="button"
                        onClick={() => onSelectSession(project, session)}
                      >
                        <span className="session-title" title={session.name || session.firstMessage}>{compactLabel(session.name || session.firstMessage || "Untitled session")}</span>
                        <span className="session-time">{formatRelative(session.updatedAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
