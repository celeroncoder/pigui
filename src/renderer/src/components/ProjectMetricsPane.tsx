import { BarChart3, Clock3, RefreshCw, X } from "lucide-react"
import type { ProjectMetrics } from "../../../shared/contracts"
import styles from "./ProjectMetricsPane.module.css"

const number = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null) return "—"
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function ProjectMetricsPane({ metrics, loading, onRefresh, onClose }: {
  readonly metrics: ProjectMetrics | null
  readonly loading: boolean
  readonly onRefresh: () => void
  readonly onClose: () => void
}) {
  const maxModelTokens = metrics?.modelUsage[0]?.total ?? 0
  const maxFailureCount = metrics?.failureReasons[0]?.count ?? 0

  return (
    <aside className={styles.root} aria-label="Project metrics">
      <header className={styles.header}>
        <div><BarChart3 size={15} /><span>Project metrics</span></div>
        <div className={styles.actions}>
          <button type="button" aria-label="Refresh project metrics" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? styles.spinning : undefined} size={14} /></button>
          <button type="button" aria-label="Close project metrics" onClick={onClose}><X size={15} /></button>
        </div>
      </header>

      {loading && !metrics ? (
        <div className={styles.loading}><RefreshCw size={16} /> Reading local Pi sessions…</div>
      ) : metrics ? (
        <div className={styles.scroll}>
          <p className={styles.scope}>Latest outcome per Pi session · lifetime persisted usage</p>

          <section className={styles.summary} aria-label="Session outcome summary">
            <article><span>Success rate</span><strong>{metrics.successRate === null ? "—" : `${Math.round(metrics.successRate * 100)}%`}</strong><small>{metrics.successfulSessions} of {metrics.completedSessions} completed</small></article>
            <article><span>Avg. turnaround</span><strong>{formatDuration(metrics.averageCompletionMs)}</strong><small><Clock3 size={10} /> latest completed turns</small></article>
            <article><span>Total tokens</span><strong>{number.format(metrics.tokenUsage.total)}</strong><small>{metrics.sessionCount} local {metrics.sessionCount === 1 ? "session" : "sessions"}</small></article>
            <article><span>Incomplete</span><strong>{metrics.incompleteSessions}</strong><small>no terminal latest response</small></article>
          </section>

          <section className={styles.section} aria-labelledby="token-usage-heading">
            <div className={styles.sectionHeading}><h2 id="token-usage-heading">Token usage</h2><small>{number.format(metrics.tokenUsage.total)} total</small></div>
            <dl className={styles.tokenGrid}>
              <div><dt>Input</dt><dd>{number.format(metrics.tokenUsage.input)}</dd></div>
              <div><dt>Output</dt><dd>{number.format(metrics.tokenUsage.output)}</dd></div>
              <div><dt>Cache read</dt><dd>{number.format(metrics.tokenUsage.cacheRead)}</dd></div>
              <div><dt>Cache write</dt><dd>{number.format(metrics.tokenUsage.cacheWrite)}</dd></div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="model-usage-heading">
            <div className={styles.sectionHeading}><h2 id="model-usage-heading">Model usage</h2><small>{metrics.modelUsage.length} sources</small></div>
            <div className={styles.rows}>
              {metrics.modelUsage.length === 0 && <p className={styles.empty}>No persisted model usage yet.</p>}
              {metrics.modelUsage.map((item) => (
                <article className={styles.row} key={item.model}>
                  <div><strong title={item.model}>{item.model}</strong><small>{item.sessions} {item.sessions === 1 ? "session" : "sessions"}</small></div>
                  <span>{number.format(item.total)}</span>
                  <i style={{ width: `${maxModelTokens > 0 ? (item.total / maxModelTokens) * 100 : 0}%` }} />
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="failures-heading">
            <div className={styles.sectionHeading}><h2 id="failures-heading">Failure reasons</h2><small>{metrics.failedSessions} failed</small></div>
            <div className={styles.rows}>
              {metrics.failureReasons.length === 0 && <p className={styles.empty}>No failed latest session outcomes.</p>}
              {metrics.failureReasons.map((item) => (
                <article className={`${styles.row} ${styles.failure}`} key={item.reason}>
                  <div><strong title={item.reason}>{item.reason}</strong><small>{item.count} {item.count === 1 ? "session" : "sessions"}</small></div>
                  <span>{item.count}</span>
                  <i style={{ width: `${maxFailureCount > 0 ? (item.count / maxFailureCount) * 100 : 0}%` }} />
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className={styles.loading}>Project metrics are unavailable.</div>
      )}
    </aside>
  )
}
