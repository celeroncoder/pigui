import { ArrowRight, Clock3, FolderCode, Plus, RefreshCw, TriangleAlert } from "lucide-react"
import type { Project, ProjectMetrics, ProjectWorktree, SessionSummary } from "../../../shared/contracts"
import { DitherProgressBar } from "./DitherProgressBar"
import { ProviderLogo } from "./ProviderLogo"
import styles from "./HomeDashboard.module.css"

export interface ProjectHomeData {
  readonly project: Project
  readonly worktree: ProjectWorktree
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly metrics: ProjectMetrics | null
  readonly loading: boolean
  readonly error?: string
}

const number = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null) return "—"
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

const formatRelative = (timestamp: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const modelParts = (model: string) => {
  const slash = model.indexOf("/")
  return slash < 0 ? { provider: model, name: model } : { provider: model.slice(0, slash), name: model.slice(slash + 1) }
}

const progressTone = (successRate: number | null) => {
  if (successRate === null) return "unknown" as const
  if (successRate >= 0.8) return "default" as const
  if (successRate >= 0.5) return "warning" as const
  return "critical" as const
}

export function HomeDashboard({ data, loadingProjects, onRefresh, onAddProject, onOpenProject, onOpenSession }: {
  readonly data: ReadonlyArray<ProjectHomeData>
  readonly loadingProjects: boolean
  readonly onRefresh: () => void
  readonly onAddProject: () => void
  readonly onOpenProject: (project: Project, worktree: ProjectWorktree) => void
  readonly onOpenSession: (project: Project, worktree: ProjectWorktree, session: SessionSummary) => void
}) {
  const projectCount = new Set(data.map(({ project }) => project.id)).size
  const totalSessions = data.reduce((total, overview) => total + (overview.metrics?.sessionCount ?? 0), 0)
  const totalTokens = data.reduce((total, overview) => total + (overview.metrics?.tokenUsage.total ?? 0), 0)
  const loading = loadingProjects || data.some((overview) => overview.loading)

  return (
    <main className={styles.root} id="main-content">
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Pi Desktop overview</span>
          <h1>Your projects</h1>
          <p>Every local Pi session, its latest outcome, and lifetime model usage in one place.</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? styles.spinning : undefined} size={15} /> Refresh
          </button>
          <button type="button" className={styles.add} onClick={onAddProject}><Plus size={16} /> Add project</button>
        </div>
      </header>

      <section className={styles.portfolio} aria-label="Workspace totals">
        <div><span>Projects</span><strong>{projectCount}</strong></div>
        <div><span>Pi sessions</span><strong>{number.format(totalSessions)}</strong></div>
        <div><span>Lifetime tokens</span><strong>{number.format(totalTokens)}</strong></div>
      </section>

      {loadingProjects && data.length === 0 ? (
        <div className={styles.loading} role="status"><RefreshCw className={styles.spinning} size={17} /> Loading projects…</div>
      ) : data.length === 0 ? (
        <section className={styles.empty}>
          <FolderCode size={30} />
          <h2>Add your first project</h2>
          <p>Pi Desktop will discover its local Pi sessions and build this dashboard from persisted telemetry.</p>
          <button type="button" onClick={onAddProject}><Plus size={15} /> Add project folder</button>
        </section>
      ) : (
        <section className={styles.grid} aria-label="Projects">
          {data.map((overview) => {
            const { project, worktree } = overview
            const metrics = overview?.metrics
            const sessions = overview?.sessions ?? []
            const rate = metrics?.successRate ?? null
            return (
              <article className={styles.card} key={`${project.id}:${worktree.id}`}>
                <button className={styles.projectHeading} type="button" onClick={() => onOpenProject(project, worktree)}>
                  <span className={styles.folder}><FolderCode size={17} /></span>
                  <span><strong>{project.name} · {worktree.name}</strong><small>{worktree.path}</small></span>
                  <ArrowRight size={16} />
                </button>

                {overview?.loading && !metrics ? (
                  <div className={styles.cardLoading} role="status"><RefreshCw className={styles.spinning} size={15} /> Reading Pi sessions…</div>
                ) : overview?.error ? (
                  <div className={styles.cardError}>{overview.error}</div>
                ) : metrics ? (
                  <>
                    <section className={styles.metrics} aria-label={`${project.name} metrics`}>
                      <div><span>Success</span><strong>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</strong></div>
                      <div><span>Turnaround</span><strong>{formatDuration(metrics.averageCompletionMs)}</strong></div>
                      <div><span>Tokens</span><strong>{number.format(metrics.tokenUsage.total)}</strong></div>
                      <div><span>Incomplete</span><strong>{metrics.incompleteSessions}</strong></div>
                    </section>
                    <div className={styles.rate} aria-label={rate === null ? "No completed sessions" : `${Math.round(rate * 100)} percent success rate`}>
                      <DitherProgressBar value={(rate ?? 0) * 100} tone={progressTone(rate)} />
                    </div>

                    <dl className={styles.tokenBreakdown} aria-label={`${project.name} token usage`}>
                      <div><dt>Input</dt><dd>{number.format(metrics.tokenUsage.input)}</dd></div>
                      <div><dt>Output</dt><dd>{number.format(metrics.tokenUsage.output)}</dd></div>
                      <div><dt>Cache read</dt><dd>{number.format(metrics.tokenUsage.cacheRead)}</dd></div>
                      <div><dt>Cache write</dt><dd>{number.format(metrics.tokenUsage.cacheWrite)}</dd></div>
                    </dl>

                    <section className={styles.models} aria-label={`${project.name} model usage`}>
                      <div className={styles.sectionHeading}><h2>Model usage</h2><small>{metrics.modelUsage.length} sources</small></div>
                      {metrics.modelUsage.length === 0 ? <p>No persisted model usage yet.</p> : (
                        <div className={styles.modelList}>
                          {metrics.modelUsage.map((item) => {
                            const model = modelParts(item.model)
                            return (
                              <div className={styles.model} key={item.model}>
                                <ProviderLogo provider={model.provider} size={18} />
                                <span><strong title={item.model}>{model.name}</strong><small>{item.sessions} {item.sessions === 1 ? "session" : "sessions"}</small></span>
                                <b>{number.format(item.total)}</b>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>

                    <section className={styles.failures} aria-label={`${project.name} failure reasons`}>
                      <div className={styles.sectionHeading}><h2>Failure reasons</h2><small>{metrics.failedSessions} failed</small></div>
                      {metrics.failureReasons.length === 0 ? <p>No failed latest session outcomes.</p> : (
                        <div className={styles.failureList}>
                          {metrics.failureReasons.map((item) => (
                            <div key={item.reason}><TriangleAlert size={12} /><span title={item.reason}>{item.reason}</span><strong>{item.count}</strong></div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className={styles.sessions} aria-label={`${project.name} sessions`}>
                      <div className={styles.sectionHeading}><h2>Sessions</h2><small>{sessions.length} total</small></div>
                      {sessions.length === 0 ? <p>No sessions yet.</p> : (
                        <div className={styles.sessionList}>
                          {sessions.map((session) => (
                            <button type="button" onClick={() => onOpenSession(project, worktree, session)} key={session.path}>
                              <span><strong>{session.name || session.firstMessage || "Untitled session"}</strong><small>{session.messageCount} messages</small></span>
                              <time dateTime={new Date(session.updatedAt).toISOString()}><Clock3 size={11} /> {formatRelative(session.updatedAt)}</time>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                ) : null}
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}
