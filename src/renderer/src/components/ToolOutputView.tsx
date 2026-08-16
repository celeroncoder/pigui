import type { FileContents, FileDiffOptions, FileOptions } from "@pierre/diffs"
import { File, MultiFileDiff } from "@pierre/diffs/react"
import { Schema } from "effect"
import { Check, Copy } from "lucide-react"
import { useMemo, useState } from "react"
import type { ToolCallBlock, ToolResultBlock } from "../../../shared/contracts"

const ToolInputSchema = Schema.Struct({
  path: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  edits: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        oldText: Schema.String,
        newText: Schema.String
      })
    )
  ),
  oldText: Schema.optionalKey(Schema.String),
  newText: Schema.optionalKey(Schema.String)
})
type ToolInput = typeof ToolInputSchema.Type

const parseInput = (input: string): ToolInput => {
  try {
    const value = JSON.parse(input)
    const decoded = Schema.decodeUnknownOption(ToolInputSchema)(value)
    return decoded._tag === "Some" ? decoded.value : {}
  } catch {
    return {}
  }
}

const filePath = (input: ToolInput, fallback: string) => input.path ?? fallback

type ChangedFiles =
  | { readonly oldFile: null; readonly newFile: FileContents }
  | { readonly oldFile: FileContents; readonly newFile: FileContents }

const editFiles = (block: ToolCallBlock): ChangedFiles | null => {
  const input = parseInput(block.input)
  const name = filePath(input, "changes.txt")

  if (block.name === "write" && input.content !== undefined) {
    return { oldFile: null, newFile: { name, contents: input.content } }
  }

  const replacements = input.edits
    ? input.edits
    : input.oldText !== undefined && input.newText !== undefined
      ? [{ oldText: input.oldText, newText: input.newText }]
      : []
  if (replacements.length === 0) return null

  return {
    oldFile: { name, contents: replacements.map((edit) => edit.oldText).join("\n\n/* … */\n\n") },
    newFile: { name, contents: replacements.map((edit) => edit.newText).join("\n\n/* … */\n\n") }
  }
}

function OutputCopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="tool-output-copy"
      aria-label="Copy tool output"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  )
}

export default function ToolOutputView({ block, result }: { readonly block: ToolCallBlock; readonly result: ToolResultBlock }) {
  const input = useMemo(() => parseInput(block.input), [block.input])
  const files = useMemo(() => editFiles(block), [block])
  const fileOptions = useMemo<FileOptions<undefined>>(() => ({ theme: "pierre-dark" }), [])
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({ theme: "pierre-dark", diffStyle: "unified" }), [])
  const isRead = block.name === "read" && !result.output.startsWith("Read image file")
  const isFileChange = (block.name === "write" || block.name === "edit") && files !== null

  if (isRead) {
    const file = { name: filePath(input, "output.txt"), contents: result.output }
    return (
      <div className="tool-render-surface">
        <div className="tool-output-actions"><span>File output</span><OutputCopyButton text={result.output} /></div>
        <File file={file} options={fileOptions} />
      </div>
    )
  }

  if (isFileChange && files) {
    const copyText = result.diff ?? result.output
    return (
      <div className="tool-render-surface tool-diff-surface">
        <div className="tool-output-actions"><span>Changes</span><OutputCopyButton text={copyText} /></div>
        {files.oldFile === null
          ? <MultiFileDiff oldFile={null} newFile={files.newFile} options={diffOptions} />
          : <MultiFileDiff oldFile={files.oldFile} newFile={files.newFile} options={diffOptions} />}
      </div>
    )
  }

  return (
    <div className="tool-plain-output">
      <div className="tool-output-actions"><span>Output</span><OutputCopyButton text={result.output} /></div>
      <pre>{result.output}</pre>
    </div>
  )
}
