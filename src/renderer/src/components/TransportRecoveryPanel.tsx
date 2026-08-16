import { AlertTriangle, Play, RefreshCw, RotateCcw } from "lucide-react"
import type { SessionRecovery, SessionRecoveryAction } from "../../../shared/contracts"
import styles from "./TransportRecoveryPanel.module.css"

export function TransportRecoveryPanel({
  recovery,
  queuedCount,
  busy,
  onRecover
}: {
  readonly recovery: SessionRecovery
  readonly queuedCount: number
  readonly busy: boolean
  readonly onRecover: (action: SessionRecoveryAction) => void
}) {
  return (
    <section className={styles.root} aria-labelledby="transport-recovery-title" aria-busy={busy}>
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.marker}><AlertTriangle size={12} aria-hidden="true" /></span>
        <strong id="transport-recovery-title">Response interrupted</strong>
        <span className={styles.reason}>{recovery.reason}</span>
      </div>
      <div className={styles.actions} aria-label="Session recovery options">
        <button type="button" disabled={busy} title="Reconnect to the preserved session without sending a message" onClick={() => onRecover("resume")}>
          <RefreshCw size={14} aria-hidden="true" />
          <span><strong>Resume</strong><small>Reconnect only</small></span>
        </button>
        <button type="button" disabled={busy} title="Reconnect and ask Pi to continue from the preserved state" onClick={() => onRecover("continue")}>
          <Play size={14} aria-hidden="true" />
          <span><strong>Continue</strong><small>Use preserved state</small></span>
        </button>
        <button type="button" disabled={busy || !recovery.lastPrompt} title={recovery.lastPrompt ? "Reconnect and resend the last user prompt" : "No user prompt is available to restart"} onClick={() => onRecover("restart")}>
          <RotateCcw size={14} aria-hidden="true" />
          <span><strong>Restart</strong><small>Resend this prompt</small></span>
        </button>
      </div>
      {(queuedCount > 0 || busy) && (
        <div className={styles.note}>
          {busy ? "Recovering Pi session…" : `${queuedCount} queued ${queuedCount === 1 ? "message" : "messages"} preserved in order`}
        </div>
      )}
    </section>
  )
}
