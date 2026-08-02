import { Check, ChevronDown, CircleStop, Copy, SquareTerminal, X } from "lucide-react"
import { useState } from "react"
import type { BackgroundProcess } from "../../../shared/contracts"

const statusLabel: Record<BackgroundProcess["status"], string> = {
  running: "Running",
  done: "Complete",
  failed: "Failed",
  killed: "Stopped",
  stopped: "Previous"
}

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
    <aside className="background-pane" aria-label="Background processes">
      <header className="background-pane-header">
        <div><SquareTerminal size={15} /><span>Background</span><small>{processes.length}</small></div>
        <button type="button" aria-label="Close background processes" onClick={onClose}><X size={15} /></button>
      </header>
      <div className="background-pane-summary">
        <span className={`process-pulse ${running > 0 ? "active" : ""}`} />
        <span>{running > 0 ? `${running} ${running === 1 ? "process" : "processes"} running` : "No active processes"}</span>
        <small>Pi-managed · read only</small>
      </div>
      <div className="background-process-list">
        {processes.length === 0 && (
          <div className="background-process-empty"><SquareTerminal size={22} /><span>No background processes in this session.</span></div>
        )}
        {processes.map((process) => {
          const expanded = expandedId === process.id
          const copyText = process.output || process.command || ""
          return (
            <article className={`background-process ${process.status}`} key={process.id}>
              <button type="button" className="background-process-trigger" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : process.id)}>
                <span className="background-process-icon"><SquareTerminal size={14} /></span>
                <span className="background-process-title"><strong>{process.title}</strong><small>{process.id}{process.pid ? ` · pid ${process.pid}` : ""}</small></span>
                <span className={`background-process-status ${process.status}`}>{process.status === "running" ? <span className="process-pulse active" /> : process.status === "failed" ? <CircleStop size={10} /> : <Check size={10} />}{statusLabel[process.status]}</span>
                <span className="background-process-elapsed">{formatElapsed(process)}</span>
                <ChevronDown className={expanded ? "open" : ""} size={13} />
              </button>
              {expanded && (
                <div className="background-process-detail">
                  {process.command && <div><span>Command</span><code>{process.command}</code></div>}
                  {process.cwd && <div><span>Working directory</span><code>{process.cwd}</code></div>}
                  {(process.exitCode !== undefined || process.signal) && <div className="background-process-exit"><span>Exit</span><code>{process.signal ?? process.exitCode}</code></div>}
                  {process.output && <pre>{process.output}</pre>}
                  {copyText && (
                    <button type="button" className="background-process-copy" onClick={() => {
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
