import { Activity, Check, Circle, Clock3, Cpu, Hash, LoaderCircle, TerminalSquare, X } from "lucide-react"
import type { Project, SessionDetail, ToolActivity } from "../../../shared/contracts"

interface InspectorProps {
  readonly project: Project | null
  readonly session: SessionDetail | null
  readonly activities: ReadonlyArray<ToolActivity>
}

export function Inspector({ project, session, activities }: InspectorProps) {
  const worktreePath = project?.worktrees[0]?.path
  return (
    <aside className="inspector" aria-label="Session inspector">
      <section className="inspector-section run-overview">
        <div className="inspector-heading">
          <span>Run pulse</span>
          <span className={`status-chip ${session?.isStreaming ? "running" : ""}`}>
            <Circle size={7} fill="currentColor" />
            {session?.isStreaming ? "Working" : "Ready"}
          </span>
        </div>
        <div className="pulse-grid">
          <div><Cpu size={14} /><span>Model</span><strong>{session?.model.split("/").at(-1) ?? "—"}</strong></div>
          <div><Activity size={14} /><span>Thinking</span><strong>{session?.thinkingLevel ?? "—"}</strong></div>
          <div><Hash size={14} /><span>Session</span><strong>{session?.summary.id.slice(0, 8) ?? "—"}</strong></div>
          <div><Clock3 size={14} /><span>Messages</span><strong>{session?.messages.length ?? 0}</strong></div>
        </div>
      </section>

      <section className="inspector-section activity-feed">
        <div className="inspector-heading">
          <span>Activity</span>
          <span className="activity-count">{activities.length}</span>
        </div>
        {activities.length === 0 ? (
          <div className="quiet-state">
            <TerminalSquare size={18} />
            <p>Tool calls will appear here while Pi works.</p>
          </div>
        ) : (
          <ol className="activity-list">
            {activities.map((item) => (
              <li key={item.id}>
                <span className={`activity-status ${item.status}`}>
                  {item.status === "running" && <LoaderCircle size={13} />}
                  {item.status === "success" && <Check size={13} />}
                  {item.status === "error" && <X size={13} />}
                </span>
                <div><strong>{item.name}</strong><span>{item.status === "running" ? "Running now" : item.status}</span></div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="inspector-section workspace-info">
        <div className="inspector-heading"><span>Workspace</span></div>
        <div className="path-box" title={worktreePath}>{worktreePath ?? "No project selected"}</div>
        <div className="trust-note"><Check size={13} /><span>Uses your existing Pi config and sessions</span></div>
      </section>
    </aside>
  )
}
