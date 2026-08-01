import { RefreshCw, X } from "lucide-react"
import type { SessionDetail, SessionSummary } from "../../../shared/contracts"
import { buildConversationItems } from "../lib/conversation"
import { ActivityGroup } from "./ActivityGroup"
import { MessageView } from "./MessageView"
import { SubagentAvatar, SubagentAvatarGroup } from "./SubagentAvatars"

interface SubagentPaneProps {
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly selectedPath: string | null
  readonly detail: SessionDetail | null
  readonly loading: boolean
  readonly onSelect: (session: SessionSummary) => void
  readonly onRefresh: () => void
  readonly onClose: () => void
}

const displayName = (name: string) => name.replace(/^subagent:\s*/i, "")

export function SubagentPane({ sessions, selectedPath, detail, loading, onSelect, onRefresh, onClose }: SubagentPaneProps) {
  const items = buildConversationItems(detail?.messages ?? [])

  return (
    <aside className="subagent-pane" aria-label="Linked subagent sessions">
      <header className="subagent-pane-header">
        <div><SubagentAvatarGroup sessions={sessions} /><span>Subagents</span><small>{sessions.length}</small></div>
        <div className="subagent-pane-actions">
          <button type="button" aria-label="Refresh subagent" onClick={onRefresh}><RefreshCw size={14} /></button>
          <button type="button" aria-label="Close subagent split view" onClick={onClose}><X size={15} /></button>
        </div>
      </header>

      <nav className="subagent-tabs" aria-label="Subagent sessions">
        {sessions.map((session) => (
          <button
            type="button"
            className={session.path === selectedPath ? "active" : ""}
            title={displayName(session.name)}
            onClick={() => onSelect(session)}
            key={session.path}
          >
            <SubagentAvatar session={session} size={22} />
            <span>{displayName(session.name)}</span>
            <small>{session.messageCount}</small>
          </button>
        ))}
      </nav>

      <div className="subagent-context">
        <span>Read-only linked Pi session</span>
        {detail && <strong>{detail.model.split("/").at(-1)}</strong>}
      </div>

      <div className="subagent-scroll">
        {loading && !detail ? (
          <div className="subagent-loading"><RefreshCw size={15} /> Loading session…</div>
        ) : detail ? (
          <div className="subagent-message-list">
            {items.map((item) => item.type === "message"
              ? <MessageView message={item.message} key={item.id} />
              : <ActivityGroup messages={item.messages} isLive={false} key={item.id} />)}
          </div>
        ) : (
          <div className="subagent-loading">Select a subagent to inspect its work.</div>
        )}
      </div>
    </aside>
  )
}
