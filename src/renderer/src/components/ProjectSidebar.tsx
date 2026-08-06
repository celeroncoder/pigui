import { ChevronDown, CircleAlert, CircleCheck, CircleDashed, CirclePause, FolderGit2, FolderPlus, GitBranch, GitFork, GitMerge, GitPullRequest, HardDrive, MessageCircleQuestionMark, MoreHorizontal, SquarePen } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { GitHubBranchPullRequest, Project, ProjectWorktree, SessionRuntimeStatus, SessionSummary } from "../../../shared/contracts"
import { isProjectExpanded, preserveProjectExpansionOnSelection, toggleProjectExpansion } from "./projectSidebarState"

export interface WorktreeSessionList {
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly loading: boolean
  readonly unavailable?: boolean
}

interface ProjectSidebarProps {
  readonly projects: ReadonlyArray<Project>
  readonly sessionsByWorktree: Readonly<Record<string, WorktreeSessionList | undefined>>
  readonly runtimeStatuses: Readonly<Record<string, SessionRuntimeStatus>>
  readonly activeProject: Project | null
  readonly activeWorktree: ProjectWorktree | null
  readonly activeSessionPath: string | null
  readonly onSelectProject: (project: Project) => void
  readonly pullRequestsByWorktree: Readonly<Record<string, GitHubBranchPullRequest | null | undefined>>
  readonly onSelectSession: (project: Project, worktree: ProjectWorktree, session: SessionSummary) => void
  readonly onAddProject: () => void
  readonly onNewSession: (project: Project, worktree?: ProjectWorktree) => void
}

const worktreeKey = (project: Project, worktree: ProjectWorktree) => `${project.id}:${worktree.id}`
const sessionTitle = (session: SessionSummary) => session.name || session.firstMessage || "Untitled session"
const pullRequestStateLabel = (pullRequest: GitHubBranchPullRequest) => pullRequest.state === "mergeable"
  ? `PR #${pullRequest.number} is mergeable`
  : pullRequest.state === "conflict"
    ? `PR #${pullRequest.number} has conflicts`
    : pullRequest.state === "merged"
      ? `PR #${pullRequest.number} is merged`
      : `PR #${pullRequest.number} has checks pending or failing`

const sessionStatusPresentation: Record<SessionRuntimeStatus, { readonly label: string; readonly Icon: typeof CircleCheck }> = {
  running: { label: "Working", Icon: CircleDashed },
  "input-required": { label: "Needs input", Icon: MessageCircleQuestionMark },
  waiting: { label: "Waiting", Icon: CirclePause },
  done: { label: "Done", Icon: CircleCheck },
  failed: { label: "Failed", Icon: CircleAlert }
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    projects,
    sessionsByWorktree,
    runtimeStatuses,
    activeProject,
    activeWorktree,
    activeSessionPath,
    onSelectProject,
    pullRequestsByWorktree,
    onSelectSession,
    onAddProject,
    onNewSession
  } = props
  const [expansionState, setExpansionState] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [detailsMenu, setDetailsMenu] = useState<{ readonly projectId: string; readonly left: number; readonly top: number } | null>(null)
  const previousActiveProjectIdRef = useRef<string | null>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const detailsPopoverRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const nextActiveProjectId = activeProject?.id ?? null
    const previousActiveProjectId = previousActiveProjectIdRef.current
    if (nextActiveProjectId && nextActiveProjectId !== previousActiveProjectId) {
      setExpansionState((current) => preserveProjectExpansionOnSelection(current, previousActiveProjectId, nextActiveProjectId))
    }
    previousActiveProjectIdRef.current = nextActiveProjectId
  }, [activeProject?.id])

  useEffect(() => {
    if (!detailsMenu) return
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || detailsPopoverRef.current?.contains(target) || detailsTriggerRef.current?.contains(target)) return
      setDetailsMenu(null)
    }
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setDetailsMenu(null)
      detailsTriggerRef.current?.focus()
    }
    const closeOnLayoutChange = () => setDetailsMenu(null)
    document.addEventListener("pointerdown", closeOnPointerDown)
    document.addEventListener("keydown", closeOnKeyDown)
    document.addEventListener("scroll", closeOnLayoutChange, true)
    window.addEventListener("resize", closeOnLayoutChange)
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown)
      document.removeEventListener("keydown", closeOnKeyDown)
      document.removeEventListener("scroll", closeOnLayoutChange, true)
      window.removeEventListener("resize", closeOnLayoutChange)
    }
  }, [detailsMenu])

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
            count + (sessionsByWorktree[worktreeKey(project, worktree)]?.sessions.filter((candidate) => !candidate.parentSessionPath).length ?? 0)
          ), 0)
          const detailsOpen = detailsMenu?.projectId === project.id
          return (
            <section className={`project-group ${projectActive ? "active" : ""}`} key={project.id} aria-labelledby={`project-${project.id}`}>
              <div className={`project-header ${projectActive ? "active" : ""}`}>
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
                <div className="project-header-actions">
                  <button
                    className="project-icon-button"
                    type="button"
                    aria-label={`Project details for ${project.name}`}
                    aria-expanded={detailsOpen}
                    aria-controls={`project-details-${project.id}`}
                    title={`Project details for ${project.name}`}
                    onClick={(event) => {
                      if (detailsOpen) {
                        setDetailsMenu(null)
                        return
                      }
                      const rect = event.currentTarget.getBoundingClientRect()
                      const sidebarRight = event.currentTarget.closest(".project-sidebar")?.getBoundingClientRect().right ?? rect.right
                      detailsTriggerRef.current = event.currentTarget
                      setDetailsMenu({
                        projectId: project.id,
                        left: Math.min(sidebarRight + 8, window.innerWidth - 356),
                        top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 360))
                      })
                    }}
                  >
                    <MoreHorizontal size={15} aria-hidden="true" />
                  </button>
                  {targetWorktree && (
                    <button
                      className="project-icon-button new-session"
                      type="button"
                      onClick={() => onNewSession(project, targetWorktree)}
                      aria-label={`New session in ${project.name}, ${targetWorktree.kind === "linked" ? "linked worktree" : "local checkout"} ${targetWorktree.name}`}
                      title={`New session in ${targetWorktree.name}`}
                    >
                      <SquarePen size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {detailsOpen && createPortal(
                <section
                  className="project-details-popover"
                  id={`project-details-${project.id}`}
                  ref={detailsPopoverRef}
                  aria-label={`${project.name} project details`}
                  style={{ left: detailsMenu.left, top: detailsMenu.top }}
                >
                  <header><FolderGit2 size={18} aria-hidden="true" /><strong>{project.name}</strong></header>
                  <p>{visibleSessionCount} {visibleSessionCount === 1 ? "session" : "sessions"} · {project.worktrees.length} {project.worktrees.length === 1 ? "checkout" : "checkouts"}</p>
                  <div className="project-details-worktrees">
                    {project.worktrees.map((worktree, worktreeIndex) => {
                      const isLocal = worktree.kind ? worktree.kind === "local" : worktreeIndex === 0
                      const branch = worktree.git?.branch ?? worktree.branch
                      return (
                        <div className="project-details-worktree" key={worktree.id}>
                          {isLocal ? <HardDrive size={15} aria-hidden="true" /> : <GitFork size={15} aria-hidden="true" />}
                          <div><strong>{isLocal ? "Local checkout" : "Worktree"}</strong><code title={worktree.path}>{worktree.path}</code></div>
                          <span title={`Branch ${branch}`}><GitBranch size={12} aria-hidden="true" />{branch}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>,
                document.body
              )}

              {expanded && (
                <div className="flat-session-list">
                  {project.worktrees.flatMap((worktree, worktreeIndex) => {
                    const contextKey = worktreeKey(project, worktree)
                    const listing = sessionsByWorktree[contextKey]
                    const sessions = listing?.sessions.filter((candidate) => !candidate.parentSessionPath) ?? []
                    const isLocal = worktree.kind ? worktree.kind === "local" : worktreeIndex === 0
                    const kindLabel = isLocal ? "local checkout" : "linked worktree"
                    const branch = worktree.git?.branch ?? worktree.branch
                    const candidatePullRequest = pullRequestsByWorktree[contextKey]
                    const pullRequest = candidatePullRequest?.branch === branch ? candidatePullRequest : null
                    const dirty = !!worktree.git && worktree.git.changedFiles > 0
                    const gitState = dirty
                      ? `${worktree.git?.changedFiles ?? 0} changed ${worktree.git?.changedFiles === 1 ? "file" : "files"}`
                      : worktree.git ? "Git clean" : "Git status not loaded"

                    return sessions.map((candidate) => {
                      const title = sessionTitle(candidate)
                      const active = projectActive && activeWorktree?.id === worktree.id && activeSessionPath === candidate.path
                      const runtimeStatus = runtimeStatuses[candidate.path] ?? "done"
                      const { label: statusLabel, Icon } = sessionStatusPresentation[runtimeStatus]
                      const pullRequestLabel = pullRequest ? ` ${pullRequestStateLabel(pullRequest)}.` : ""
                      const label = `${title}. ${kindLabel}, branch ${branch}, ${gitState}, path ${worktree.path}.${pullRequestLabel} Session ${statusLabel.toLocaleLowerCase()}.`
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
                            {!isLocal && <GitFork data-worktree-kind-icon="linked" size={14} />}
                            {pullRequest && (
                              <span className={`pull-request-state ${pullRequest.state}`}>
                                {pullRequest.state === "merged" ? <GitMerge size={14} /> : <GitPullRequest size={14} />}
                                <i />
                              </span>
                            )}
                          </span>
                          <span className={`session-status ${runtimeStatus}`} role="img" aria-label={`Session status: ${statusLabel}`} title={`Session status: ${statusLabel}`}>
                            <Icon size={13} aria-hidden="true" />
                          </span>
                        </button>
                      )
                    })
                  })}
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
