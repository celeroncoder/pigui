import type { FileContents, FileDiffOptions } from "@pierre/diffs"
import { MultiFileDiff } from "@pierre/diffs/react"
import { ChevronDown, FileCode2, Folder, FolderOpen, GitBranch, RefreshCw, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import type { GitDiff, GitDiffFile } from "../../../shared/contracts"

const statusLabel: Record<GitDiffFile["status"], string> = {
  added: "Added",
  untracked: "Untracked",
  modified: "Modified",
  deleted: "Deleted"
}

type GitFileTreeNode =
  | { readonly kind: "folder"; readonly name: string; readonly path: string; readonly children: GitFileTreeNode[] }
  | { readonly kind: "file"; readonly name: string; readonly path: string; readonly file: GitDiffFile }

const sortTree = (nodes: GitFileTreeNode[]) => {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  })
  for (const node of nodes) if (node.kind === "folder") sortTree(node.children)
  return nodes
}

const buildFileTree = (files: ReadonlyArray<GitDiffFile>) => {
  const roots: GitFileTreeNode[] = []
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean)
    if (!parts.length) continue
    let children = roots
    let parentPath = ""
    parts.forEach((part, index) => {
      const path = parentPath ? `${parentPath}/${part}` : part
      const isFile = index === parts.length - 1
      if (isFile) {
        children.push({ kind: "file", name: part, path: file.path, file })
        return
      }
      let folder = children.find((node): node is Extract<GitFileTreeNode, { kind: "folder" }> => node.kind === "folder" && node.path === path)
      if (!folder) {
        folder = { kind: "folder", name: part, path, children: [] }
        children.push(folder)
      }
      children = folder.children
      parentPath = path
    })
  }
  return sortTree(roots)
}

const folderPaths = (nodes: ReadonlyArray<GitFileTreeNode>): ReadonlyArray<string> => nodes.flatMap((node) => node.kind === "folder" ? [node.path, ...folderPaths(node.children)] : [])

const statusMark: Record<GitDiffFile["status"], string> = {
  added: "A",
  untracked: "U",
  modified: "M",
  deleted: "D"
}

export function GitDiffPane({ diff, loading, onClose, onRefresh }: {
  readonly diff: GitDiff | null
  readonly loading: boolean
  readonly onClose: () => void
  readonly onRefresh: () => void
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(diff?.files[0]?.path ?? null)
  const [filter, setFilter] = useState("")
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set())
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({ theme: "pierre-dark", diffStyle: "unified" }), [])
  const selectedFile = diff?.files.find((file) => file.path === selectedPath) ?? diff?.files[0]
  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? (diff?.files ?? []).filter((file) => file.path.toLowerCase().includes(query)) : (diff?.files ?? [])
  }, [diff, filter])
  const tree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles])

  useEffect(() => {
    if (!diff?.files.length) {
      setSelectedPath(null)
      return
    }
    if (!diff.files.some((file) => file.path === selectedPath)) setSelectedPath(diff.files[0]?.path ?? null)
  }, [diff, selectedPath])

  useEffect(() => {
    setExpandedFolders(new Set(folderPaths(tree)))
  }, [tree])

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

  const renderTree = (nodes: ReadonlyArray<GitFileTreeNode>, depth = 0): ReactNode => nodes.map((node) => {
    if (node.kind === "folder") {
      const expanded = expandedFolders.has(node.path)
      return (
        <div key={node.path}>
          <button
            type="button"
            className="git-tree-folder"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            aria-expanded={expanded}
            onClick={() => setExpandedFolders((current) => {
              const next = new Set(current)
              if (expanded) next.delete(node.path)
              else next.add(node.path)
              return next
            })}
          >
            <ChevronDown className={expanded ? "open" : ""} size={14} aria-hidden="true" />
            {expanded ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
            <span title={node.path}>{node.name}</span>
          </button>
          {expanded && renderTree(node.children, depth + 1)}
        </div>
      )
    }
    return (
      <button
        type="button"
        className={`git-tree-file ${selectedFile?.path === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${9 + depth * 14}px` }}
        key={node.path}
        title={`${node.path} · ${statusLabel[node.file.status]}`}
        onClick={() => setSelectedPath(node.path)}
      >
        <span className="git-tree-file-icon"><FileCode2 size={12} aria-hidden="true" /></span>
        <span title={node.path}>{node.name}</span>
        <small className={node.file.status}>{statusMark[node.file.status]}</small>
      </button>
    )
  })

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
        {loading
          ? "Reading working tree…"
          : diff?.truncated
            ? `Showing ${diff.files.length} of ${diff.files.length + diff.omittedFiles} changed files`
            : diff?.files.length
              ? `${diff.files.length} changed ${diff.files.length === 1 ? "file" : "files"}`
              : "Working tree clean"}
        {!loading && diff?.truncated && <small className="git-pane-truncated" role="status">Some files were omitted to keep the diff responsive.</small>}
      </div>
      {loading && <div className="git-diff-loading"><RefreshCw size={16} /> Loading diff…</div>}
      {!loading && diff && diff.files.length > 0 && (
        <div className="git-pane-content">
          <section className="git-diff-main" aria-label={selectedFile ? `Diff for ${selectedFile.path}` : "File diff"}>
            <header className="git-diff-file-header">
              {selectedFile ? (
                <>
                  <div><FileCode2 size={14} aria-hidden="true" /><strong title={selectedFile.path}>{selectedFile.path}</strong></div>
                  <small className={selectedFile.status}>{statusLabel[selectedFile.status]}</small>
                </>
              ) : <span>Select a file to review its changes.</span>}
            </header>
            <div className="git-diff-scroll">
              {selectedFile ? renderDiff(selectedFile) : <div className="git-diff-empty">Select a file to review its changes.</div>}
            </div>
          </section>
          <aside className="git-file-tree" aria-label="Changed files">
            <label className="git-file-filter">
              <Search size={13} aria-hidden="true" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files…" aria-label="Filter changed files" />
            </label>
            <div className="git-tree-scroll">
              {tree.length ? renderTree(tree) : <div className="git-tree-empty">No matching files.</div>}
            </div>
          </aside>
        </div>
      )}
      {!loading && diff?.truncated && diff.files.length === 0 && <div className="git-diff-empty"><GitBranch size={22} /><span>Diff preview was truncated before any files could be loaded.</span></div>}
      {!loading && (!diff || (diff.files.length === 0 && !diff.truncated)) && <div className="git-diff-empty"><GitBranch size={22} /><span>No changed files in this working tree.</span></div>}
    </aside>
  )
}
