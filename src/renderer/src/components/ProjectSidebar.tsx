import { ChevronDown, FolderGit2, FolderPlus, GitBranch, GitFork, HardDrive, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Project, ProjectWorktree, SessionSummary } from "../../../shared/contracts"
import { isProjectExpanded, preserveProjectExpansionOnSelection, toggleProjectExpansion } from "./projectSidebarState"

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
  readonly onSelectProject: (project: Project) => void
  readonly onSelectSession: (project: Project, worktree: ProjectWorktree, session: SessionSummary) => void
  readonly onAddProject: () => void
  readonly onNewSession: (project: Project, worktree?: ProjectWorktree) => void
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
        <span className="section-label">Repositories</span>
        <button className="mini-button" type="button" onClick={onAddProject} aria-label="Add Git worktree">
          <FolderPlus size={15} />
        </button>
      </div>

      <nav className="project-list" aria-label="Project sessions">
        {projects.map((project) => {
          const projectActive = activeProject?.id === project.id
          const expanded = isProjectExpanded(activeProject?.id ?? null, project.id, expansionState)
          const targetWorktree = projectActive
            ? activeWorktree ?? project.worktrees.find((worktree) => worktree.kind === "local") ?? project.worktrees[0]
            : project.worktrees.find((worktree) => worktree.kind === "local") ?? project.worktrees[0]
          const visibleSessionCount = project.worktrees.reduce((count, worktree) => (
            count + (sessionsByWorktree[worktreeKey(project, worktree)]?.sessions.filter((session) => !session.parentSessionPath).length ?? 0)
          ), 0)
          const anyLoading = project.worktrees.some((worktree) => sessionsByWorktree[worktreeKey(project, worktree)]?.loading)
          const anyUnavailable = project.worktrees.some((worktree) => sessionsByWorktree[worktreeKey(project, worktree)]?.unavailable)

          return (
            <section className={`project-group ${projectActive ? "active" : ""}`} key={project.id} aria-labelledby={`project-${project.id}`}>
              <button
                className={`project-row ${projectActive ? "active" : ""}`}
                id={`project-${project.id}`}
                type="button"
                title={project.name}
                aria-expanded={expanded}
                aria-current={projectActive ? "page" : undefined}
                onClick={() => {
                  if (projectActive) {
                    setExpansionState((current) => toggleProjectExpansion(current, activeProject?.id ?? null, project.id))
                  } else {
                    setExpansionState((current) => preserveProjectExpansionOnSelection(current, activeProject?.id ?? null, project.id))
                    onSelectProject(project)
                  }
                }}
              >
                <ChevronDown className={expanded ? "" : "collapsed"} size={14} aria-hidden="true" />
                <FolderGit2 size={16} aria-hidden="true" />
                <span>{project.name}</span>
              </button>

              <div className={`project-panel ${projectActive ? "active" : ""}`} aria-label={`${project.name} session actions`}>
                <div className="project-panel-heading">
                  <span className="project-panel-label">{projectActive ? "Sessions" : "Workspace"}</span>
                  {targetWorktree && (
                    <button
                      className="project-new-session"
                      type="button"
                      onClick={() => onNewSession(project, targetWorktree)}
                      aria-label={`New session in ${project.name}, ${targetWorktree.kind === "linked" ? "linked worktree" : "local checkout"} ${targetWorktree.name}`}
                      title={`New session in ${targetWorktree.name}`}
                    >
                      <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
                      <span>New session</span>
                      {projectActive && <kbd>⌘N</kbd>}
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
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

                    return sessions.map((candidate) => {
                      const title = sessionTitle(candidate)
                      const active = projectActive && activeWorktree?.id === worktree.id && activeSessionPath === candidate.path
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
                  {!anyLoading && !anyUnavailable && visibleSessionCount === 0 && <span className="empty-session">No sessions yet. Start one above.</span>}
                </div>
              )}
            </section>
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
