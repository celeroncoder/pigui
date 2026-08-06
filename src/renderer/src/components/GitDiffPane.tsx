import type { FileContents, FileDiffOptions } from "@pierre/diffs"
import { MultiFileDiff } from "@pierre/diffs/react"
import { FileCode2, GitBranch, RefreshCw, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { GitDiff, GitDiffFile } from "../../../shared/contracts"

const statusLabel: Record<GitDiffFile["status"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted"
}

export function GitDiffPane({ diff, loading, onClose, onRefresh }: {
  readonly diff: GitDiff | null
  readonly loading: boolean
  readonly onClose: () => void
  readonly onRefresh: () => void
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(diff?.files[0]?.path ?? null)
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({ theme: "pierre-dark", diffStyle: "unified" }), [])
  const selectedFile = diff?.files.find((file) => file.path === selectedPath) ?? diff?.files[0]

  useEffect(() => {
    if (!diff?.files.length) {
      setSelectedPath(null)
      return
    }
    if (!diff.files.some((file) => file.path === selectedPath)) setSelectedPath(diff.files[0]?.path ?? null)
  }, [diff, selectedPath])

  const renderDiff = (file: GitDiffFile) => {
    if (file.binary) return <div className="git-diff-empty"><FileCode2 size={22} /><span>Binary or unreadable file</span><code>{file.path}</code></div>
    const oldFile: FileContents | null = file.oldContents === null ? null : { name: file.path, contents: file.oldContents }
    const newFile: FileContents | null = file.newContents === null ? null : { name: file.path, contents: file.newContents }
    if (!oldFile && !newFile) return <div className="git-diff-empty"><span>File changed before it could be read.</span><code>{file.path}</code></div>
    return (
      <div className="git-diff-render">
        {oldFile === null
          ? <MultiFileDiff oldFile={null} newFile={newFile!} options={diffOptions} />
          : newFile === null
            ? <MultiFileDiff oldFile={oldFile} newFile={null} options={diffOptions} />
            : <MultiFileDiff oldFile={oldFile} newFile={newFile} options={diffOptions} />}
      </div>
    )
  }

  return (
    <aside className="git-pane" aria-label="Git changes">
      <header className="git-pane-header">
        <div><GitBranch size={15} /><span>Git changes</span><small>{diff?.files.length ?? "…"}</small></div>
        <div className="git-pane-actions">
          <button type="button" aria-label="Refresh Git changes" onClick={onRefresh} disabled={loading}><RefreshCw size={14} /></button>
          <button type="button" aria-label="Close Git changes" onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      <div className="git-pane-summary">
        {loading ? "Reading working tree…" : diff?.files.length ? `${diff.files.length} changed ${diff.files.length === 1 ? "file" : "files"}` : "Working tree clean"}
      </div>
      {loading && <div className="git-diff-loading"><RefreshCw size={16} /> Loading diff…</div>}
      {!loading && diff && diff.files.length > 0 && (
        <div className="git-pane-content">
          <nav className="git-file-list" aria-label="Changed files">
            {diff.files.map((file) => (
              <button
                type="button"
                className={`git-file-row ${selectedFile?.path === file.path ? "active" : ""}`}
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                title={file.path}
              >
                <FileCode2 size={13} />
                <span>{file.path}</span>
                <small className={file.status}>{statusLabel[file.status]}</small>
              </button>
            ))}
          </nav>
          <div className="git-diff-scroll">
            {selectedFile ? renderDiff(selectedFile) : <div className="git-diff-empty">Select a file to review its changes.</div>}
          </div>
        </div>
      )}
      {!loading && (!diff || diff.files.length === 0) && <div className="git-diff-empty"><GitBranch size={22} /><span>No changed files in this working tree.</span></div>}
    </aside>
  )
}
