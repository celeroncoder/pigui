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
      <AlertTriangle className={styles.icon} size={17} aria-hidden="true" />
      <div className={styles.copy} role="status" aria-live="polite">
        <strong id="transport-recovery-title">Pi response interrupted</strong>
        <span>{recovery.reason}</span>
        {queuedCount > 0 && <small>{queuedCount} queued {queuedCount === 1 ? "message is" : "messages are"} preserved in order.</small>}
        {busy && <small>Recovering Pi session…</small>}
      </div>
      <div className={styles.actions} aria-label="Session recovery options">
        <button type="button" disabled={busy} title="Reconnect to the preserved session without sending a message" onClick={() => onRecover("resume")}>
          <RefreshCw size={13} aria-hidden="true" /> Resume
        </button>
        <button type="button" disabled={busy} title="Reconnect and ask Pi to continue from the preserved state" onClick={() => onRecover("continue")}>
          <Play size={13} aria-hidden="true" /> Continue
        </button>
        <button type="button" disabled={busy || !recovery.lastPrompt} title={recovery.lastPrompt ? "Reconnect and resend the last user prompt" : "No user prompt is available to restart"} onClick={() => onRecover("restart")}>
          <RotateCcw size={13} aria-hidden="true" /> Restart prompt
        </button>
      </div>
    </section>
  )
}
