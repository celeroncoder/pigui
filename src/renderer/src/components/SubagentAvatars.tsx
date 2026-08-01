import type { SessionSummary } from "../../../shared/contracts"
import { DitherAvatar } from "./dither-kit/avatar"

const avatarName = (session: SessionSummary) => session.name.replace(/^subagent:\s*/i, "") || session.id

export function SubagentAvatar({ session, size = 22, className }: { readonly session: SessionSummary; readonly size?: number; readonly className?: string }) {
  return <DitherAvatar name={avatarName(session)} size={size} bloom="low" animate={false} className={className} />
}

export function SubagentAvatarGroup({ sessions, limit = 3 }: { readonly sessions: ReadonlyArray<SessionSummary>; readonly limit?: number }) {
  const visible = sessions.slice(0, limit)
  const remainder = sessions.length - visible.length

  return (
    <span className="subagent-avatar-group" aria-label={`${sessions.length} linked subagents`}>
      {visible.map((session, index) => (
        <SubagentAvatar
          session={session}
          size={18}
          className={`subagent-avatar-item avatar-index-${index + 1}`}
          key={session.path}
        />
      ))}
      {remainder > 0 && <span className="subagent-avatar-more">+{remainder}</span>}
    </span>
  )
}
