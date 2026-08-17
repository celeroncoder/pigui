import { Check, ChevronDown, CircleStop, Copy, SquareTerminal, X } from "lucide-react"
import { useState } from "react"
import type { BackgroundProcess } from "../../../shared/contracts"
import styles from "./BackgroundProcessesPane.module.css"

const statusLabel = {
  running: "Running",
  done: "Complete",
  failed: "Failed",
  killed: "Stopped",
  stopped: "Previous"
} satisfies Record<BackgroundProcess["status"], string>

const statusClass = {
  running: styles.running,
  done: styles.done,
  failed: styles.failed,
  killed: "",
  stopped: ""
} satisfies Record<BackgroundProcess["status"], string>

const formatElapsed = (process: BackgroundProcess) => {
  const elapsed = Math.max(0, (process.status === "running" ? Date.now() : process.updatedAt) - process.startedAt)
  const seconds = Math.round(elapsed / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
}

export function BackgroundProcessesPane({ processes, onClose }: {
  readonly processes: ReadonlyArray<BackgroundProcess>
  readonly onClose: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(processes[0]?.id ?? null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const running = processes.filter((process) => process.status === "running").length

  return (
    <aside className={styles.root} aria-label="Background processes">
      <header className={styles.header}>
        <div><SquareTerminal size={15} /><span>Background</span><small>{processes.length}</small></div>
        <button type="button" aria-label="Close background processes" onClick={onClose}><X size={15} /></button>
      </header>
      <div className={styles.summary}>
        <span className={running > 0 ? styles.activePulse : styles.pulse} />
        <span>{running > 0 ? `${running} ${running === 1 ? "process" : "processes"} running` : "No active processes"}</span>
        <small>Pi-managed · read only</small>
      </div>
      <div className={styles.list}>
        {processes.length === 0 && (
          <div className={styles.empty}><SquareTerminal size={22} /><span>No background processes in this session.</span></div>
        )}
        {processes.map((process) => {
          const expanded = expandedId === process.id
          const copyText = process.output || process.command || ""
          const processStatusClass = statusClass[process.status]
          return (
            <article className={`${styles.process} ${processStatusClass}`} key={process.id}>
              <button type="button" className={styles.trigger} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : process.id)}>
                <span className={styles.icon}><SquareTerminal size={14} /></span>
                <span className={styles.title}><strong>{process.title}</strong><small>{process.id}{process.pid ? ` · pid ${process.pid}` : ""}</small></span>
                <span className={`${styles.status} ${processStatusClass}`}>{process.status === "running" ? <span className={styles.activeStatusPulse} /> : process.status === "failed" ? <CircleStop size={10} /> : <Check size={10} />}{statusLabel[process.status]}</span>
                <span className={styles.elapsed}>{formatElapsed(process)}</span>
                <ChevronDown className={expanded ? styles.open : undefined} size={13} />
              </button>
              {expanded && (
                <div className={styles.detail}>
                  {process.command && <div><span>Command</span><code>{process.command}</code></div>}
                  {process.cwd && <div><span>Working directory</span><code>{process.cwd}</code></div>}
                  {(process.exitCode !== undefined || process.signal) && <div><span>Exit</span><code>{process.signal ?? process.exitCode}</code></div>}
                  {process.output && <pre>{process.output}</pre>}
                  {copyText && (
                    <button type="button" className={styles.copy} onClick={() => {
                      void navigator.clipboard.writeText(copyText).then(() => {
                        setCopiedId(process.id)
                        window.setTimeout(() => setCopiedId(null), 1200)
                      })
                    }}>{copiedId === process.id ? <Check size={12} /> : <Copy size={12} />}{copiedId === process.id ? "Copied" : "Copy output"}</button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </aside>
  )
}
