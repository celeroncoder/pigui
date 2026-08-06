import { Check, ExternalLink, GitBranch, GitPullRequest, GitPullRequestDraft, LoaderCircle, MessageSquare, X } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { GitHubWorkflowContext, WorktreeContext } from "../../../shared/contracts"
import { desktopApi } from "../lib/api"
import styles from "./GitHubWorkflowDialog.module.css"

interface GitHubWorkflowDialogProps {
  readonly worktreeContext: WorktreeContext
  readonly sessionPath: string
  readonly messageId: string
  readonly onClose: () => void
  readonly onPullRequestChanged?: () => void
}

type Success = { readonly label: string; readonly url: string }

export function GitHubWorkflowDialog({ worktreeContext, sessionPath, messageId, onClose, onPullRequestChanged }: GitHubWorkflowDialogProps) {
  const projectId = worktreeContext.projectId
  const worktreeId = worktreeContext.worktreeId
  const [context, setContext] = useState<GitHubWorkflowContext | null>(null)
  const [target, setTarget] = useState("")
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<"comment" | "draft" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<Success | null>(null)
  const targetRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const busy = loading || operation !== null
  const draftUnavailable = context?.branch === context?.baseBranch
  const closeFromEffect = useEffectEvent(onClose)

  useEffect(() => {
    let current = true
    setLoading(true)
    void desktopApi.github.inspect({ projectId, worktreeId }, sessionPath, messageId).then((next) => {
      if (!current) return
      setContext(next)
      window.setTimeout(() => targetRef.current?.focus(), 0)
    }).catch((cause: unknown) => {
      if (current) {
        setError(cause instanceof Error ? cause.message : "Could not inspect this GitHub worktree")
        window.setTimeout(() => closeRef.current?.focus(), 0)
      }
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [messageId, projectId, sessionPath, worktreeId])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeFromEffect()
      if (event.key !== "Tab") return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [busy])

  useEffect(() => () => returnFocusRef.current?.focus(), [])

  const postComment = () => {
    if (!target.trim() || operation) return
    setOperation("comment")
    setError(null)
    setSuccess(null)
    void desktopApi.github.comment({ projectId, worktreeId }, sessionPath, messageId, target).then((result) => {
      setSuccess({ label: "Comment posted", url: result.url })
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not post the GitHub comment")
    }).finally(() => setOperation(null))
  }

  const createOrUpdateDraft = () => {
    if (operation) return
    setOperation("draft")
    setError(null)
    setSuccess(null)
    void desktopApi.github.createOrUpdateDraft({ projectId, worktreeId }, sessionPath, messageId).then((result) => {
      setContext((current) => current ? { ...current, existingPullRequest: result } : current)
      setSuccess({ label: result.action === "created" ? `Draft PR #${result.number} created` : `PR #${result.number} updated`, url: result.url })
      onPullRequestChanged?.()
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not create or update the pull request")
    }).finally(() => setOperation(null))
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <dialog ref={dialogRef} className={styles.dialog} open aria-modal="true" aria-labelledby="github-workflow-title">
        <header className={styles.header}>
          <div className={styles.icon}><GitPullRequest size={17} aria-hidden="true" /></div>
          <div>
            <span>Session to GitHub</span>
            <h2 id="github-workflow-title">Publish this Pi summary</h2>
          </div>
          <button ref={closeRef} type="button" aria-label="Close GitHub workflow" onClick={onClose} disabled={busy}><X size={17} /></button>
        </header>

        {loading && <div className={styles.loading} role="status"><LoaderCircle size={17} /> Inspecting repository and worktree…</div>}

        {!loading && context && (
          <div className={styles.content}>
            <div className={styles.context}>
              <div><GitPullRequest size={13} /><span>{context.repository}</span></div>
              <div><GitBranch size={13} /><span>{context.branch}</span><code>{context.commit}</code></div>
              <a href={context.compareUrl} target="_blank" rel="noreferrer">
                {context.commits} {context.commits === 1 ? "commit" : "commits"} · {context.committedFiles} {context.committedFiles === 1 ? "file" : "files"} · +{context.additions}/-{context.deletions}
                <ExternalLink size={12} />
              </a>
            </div>

            {context.hasUncommittedChanges && <p className={styles.notice}>Uncommitted work stays local. The PR diff includes committed changes only.</p>}

            <div className={styles.preview}>
              <span>Selected response</span>
              <p>{context.summary}</p>
            </div>

            <form className={styles.comment} onSubmit={(event) => { event.preventDefault(); postComment() }}>
              <label htmlFor="github-comment-target">Issue or PR in {context.repository}</label>
              <div>
                <input
                  ref={targetRef}
                  id="github-comment-target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="#17 or GitHub URL"
                  disabled={operation !== null}
                  autoComplete="off"
                />
                <button type="submit" disabled={!target.trim() || operation !== null}>
                  {operation === "comment" ? <LoaderCircle className={styles.spin} size={14} /> : <MessageSquare size={14} />}
                  Post comment
                </button>
              </div>
            </form>

            <div className={styles.divider}><span>or</span></div>

            <button className={styles.prAction} type="button" onClick={createOrUpdateDraft} disabled={operation !== null || draftUnavailable || (!context.existingPullRequest && context.commits === 0)}>
              {operation === "draft" ? <LoaderCircle className={styles.spin} size={16} /> : <GitPullRequestDraft size={16} />}
              <span>
                <strong>{draftUnavailable ? "Create a feature branch first" : !context.existingPullRequest && context.commits === 0 ? "Commit worktree changes first" : context.existingPullRequest ? `Update PR #${context.existingPullRequest.number} from session` : "Create draft PR from session"}</strong>
                <small>{draftUnavailable ? `A pull request cannot use ${context.baseBranch} as both its head and base` : !context.existingPullRequest && context.commits === 0 ? `The ${context.branch} branch has no committed changes against ${context.baseBranch}` : context.existingPullRequest ? "Preserves the PR body outside Pi’s marked summary section" : `Pushes ${context.branch} and opens a draft against ${context.baseBranch}`}</small>
              </span>
            </button>

            {error && <div className={styles.error} role="alert">{error}</div>}
            {success && (
              <div className={styles.success} role="status">
                <Check size={14} />
                <a href={success.url} target="_blank" rel="noreferrer">{success.label} <ExternalLink size={12} /></a>
              </div>
            )}
          </div>
        )}

        {!loading && !context && error && <div className={`${styles.error} ${styles.fatal}`} role="alert">{error}</div>}
      </dialog>
    </div>
  )
}
