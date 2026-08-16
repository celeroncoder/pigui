import { CircleCheck, CircleDot, CircleX, ExternalLink, FileDiff, GitBranch, GitFork, GitMerge, GitPullRequest, HardDrive, LoaderCircle, X } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { GitHubWorktreeContext, WorktreeContext } from "../../../shared/contracts"
import { desktopApi } from "../lib/api"
import styles from "./GitHubWorkflowDialog.module.css"

interface GitHubWorkflowDialogProps {
  readonly worktreeContext: WorktreeContext
  readonly defaultCommitMessage: string
  readonly onClose: () => void
  readonly onPullRequestChanged?: () => void
}

const pullRequestStateText = (context: GitHubWorktreeContext) => {
  const state = context.pullRequest?.state
  if (state === "mergeable") return "Checks successful"
  if (state === "conflict") return "Merge conflicts"
  if (state === "merged") return "Pull request merged"
  return "Checks pending or failing"
}

export function GitHubWorkflowDialog({ worktreeContext, defaultCommitMessage, onClose, onPullRequestChanged }: GitHubWorkflowDialogProps) {
  const projectId = worktreeContext.projectId
  const worktreeId = worktreeContext.worktreeId
  const [context, setContext] = useState<GitHubWorktreeContext | null>(null)
  const [commitMessage, setCommitMessage] = useState(() => defaultCommitMessage.trim().slice(0, 200))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const commitRef = useRef<HTMLInputElement>(null)
  const closeFromEffect = useEffectEvent(onClose)

  useEffect(() => {
    let current = true
    setLoading(true)
    void desktopApi.github.worktree({ projectId, worktreeId }).then((next) => {
      if (!current) return
      setContext(next)
    }).catch((cause: unknown) => {
      if (current) {
        setError(cause instanceof Error ? cause.message : "Could not inspect this GitHub worktree")
      }
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [projectId, worktreeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeFromEffect()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      const control = popoverRef.current?.parentElement
      if (!busy && target instanceof Node && control && !control.contains(target)) closeFromEffect()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [busy])

  const commitOrPush = () => {
    if (!context || busy) return
    if (context.changes.changedFiles > 0 && !commitOpen) {
      setCommitOpen(true)
      window.setTimeout(() => commitRef.current?.focus(), 0)
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    void desktopApi.github.commitOrPush(worktreeContext, commitMessage).then((result) => {
      setSuccess(result.action === "committed-and-pushed" ? `Committed ${result.commit ?? "changes"} and pushed` : "Branch pushed")
      setCommitOpen(false)
      onPullRequestChanged?.()
      return desktopApi.github.worktree(worktreeContext).then(setContext).catch((cause: unknown) => {
        setError(cause instanceof Error ? `Changes were pushed, but status could not refresh: ${cause.message}` : "Changes were pushed, but status could not refresh")
      })
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not commit or push this worktree")
    }).finally(() => setBusy(false))
  }

  const hasChanges = (context?.changes.changedFiles ?? 0) > 0
  const canSync = !!context && (hasChanges || !context.hasUpstream || context.ahead > 0)
  const syncLabel = hasChanges
    ? commitOpen ? "Commit and push" : "Commit or push"
    : !context?.hasUpstream ? "Publish branch"
      : context.ahead > 0 ? `Push ${context.ahead} ${context.ahead === 1 ? "commit" : "commits"}`
        : "Up to date"
  const prState = context?.pullRequest?.state

  return (
    <section id="github-worktree-popover" ref={popoverRef} className={styles.popover} aria-labelledby="github-worktree-title">
      <header className={styles.header}>
        <h2 id="github-worktree-title">Environment</h2>
        <button type="button" aria-label="Close GitHub environment" onClick={onClose} disabled={busy}><X size={15} /></button>
      </header>

      {loading && <div className={styles.loading} role="status"><LoaderCircle size={15} /> Inspecting worktree…</div>}

      {!loading && context && (
        <div className={styles.content}>
          <div className={styles.row}>
            <FileDiff size={15} aria-hidden="true" />
            <strong>Changes</strong>
            <span className={styles.diff}><i>+{context.changes.additions.toLocaleString()}</i><b>-{context.changes.deletions.toLocaleString()}</b></span>
          </div>
          <div className={styles.row}>
            {context.worktreeKind === "linked" ? <GitFork size={15} aria-hidden="true" /> : <HardDrive size={15} aria-hidden="true" />}
            <strong>{context.worktreeKind === "linked" ? "Worktree" : "Local checkout"}</strong>
            <code title={context.path}>{context.path.split("/").at(-1)}</code>
          </div>
          <div className={styles.row}><GitBranch size={15} aria-hidden="true" /><strong title={context.branch}>{context.branch}</strong></div>

          {hasChanges && commitOpen && (
            <label className={styles.commitMessage}>
              <span>Commit message</span>
              <input ref={commitRef} value={commitMessage} maxLength={200} onChange={(event) => setCommitMessage(event.target.value)} disabled={busy} />
            </label>
          )}

          <button className={styles.action} type="button" onClick={commitOrPush} disabled={busy || !canSync || (hasChanges && commitOpen && !commitMessage.trim())}>
            {busy ? <LoaderCircle className={styles.spin} size={15} /> : <CircleDot size={15} />}
            <span>{syncLabel}</span>
          </button>

          {context.pullRequest && (
            <div className={styles.pullRequest}>
              <a href={context.pullRequest.url} target="_blank" rel="noreferrer">
                {prState === "merged" ? <GitMerge size={15} /> : <GitPullRequest size={15} />}
                <span>#{context.pullRequest.number} {context.pullRequest.title}</span>
                <ExternalLink size={12} />
              </a>
              <div className={`${styles.prStatus} ${prState ? styles[prState] : ""}`}>
                {prState === "mergeable" || prState === "merged" ? <CircleCheck size={15} /> : prState === "conflict" ? <CircleX size={15} /> : <LoaderCircle size={15} />}
                <span>{pullRequestStateText(context)}</span>
              </div>
            </div>
          )}

          {error && <div className={styles.error} role="alert">{error}</div>}
          {success && <div className={styles.success} role="status"><CircleCheck size={14} />{success}</div>}
        </div>
      )}

      {!loading && !context && error && <div className={`${styles.error} ${styles.fatal}`} role="alert">{error}</div>}
    </section>
  )
}
