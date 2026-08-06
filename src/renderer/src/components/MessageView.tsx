import { Brain, Check, ChevronDown, CircleAlert, CircleDashed, Copy, GitFork } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AttachmentPreview, ChatMessage, MessageBlock, ToolCallBlock, ToolResultBlock } from "../../../shared/contracts"
import { splitTextByImageReferences } from "../../../shared/attachments"
import { ImageAttachmentCard } from "./ImageAttachmentCard"
import { ProviderLogo } from "./ProviderLogo"
import { ToolGlyph } from "./ToolGlyph"
import styles from "./MessageView.module.css"

const ToolOutputView = lazy(() => import("./ToolOutputView"))

const MarkdownContent = ({ text, className = "markdown" }: { readonly text: string; readonly className?: string }) => (
  <div className={className}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const safeHref = href?.startsWith("https://") ? href : undefined
          return <a href={safeHref} target="_blank" rel="noreferrer">{children}</a>
        },
        img: ({ src, alt }) => {
          const safeSrc = src?.startsWith("https://") ? src : undefined
          return safeSrc ? <img src={safeSrc} alt={alt ?? ""} loading="lazy" /> : null
        }
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
)

const copyText = (blocks: ReadonlyArray<MessageBlock>) => {
  const text = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
  return navigator.clipboard.writeText(text)
}

function ToolBlock({ block, result }: { readonly block: ToolCallBlock; readonly result?: ToolResultBlock }) {
  const [open, setOpen] = useState(result?.status === "running")
  const hasError = result?.isError ?? false
  const isRunning = result?.status === "running"

  const compactInput = block.input.replace(/\s+/g, " ").trim()

  return (
    <div className={`tool-block ${hasError ? "error" : ""}`}>
      <button type="button" className="tool-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <ToolGlyph name={block.name} />
        <span className="tool-name">{block.name}</span>
        <code className="tool-description">{compactInput}</code>
        {isRunning
          ? <CircleDashed className={`tool-state ${styles.running}`} size={14} />
          : hasError
            ? <CircleAlert className="tool-state error" size={14} />
            : <Check className="tool-state" size={14} />}
        <ChevronDown className={`tool-chevron ${open ? "open" : ""}`} size={13} />
      </button>
      {open && (
        <div className="tool-detail">
          <div className="tool-input"><span>Input</span><pre>{block.input}</pre></div>
          {result && (
            <Suspense fallback={<div className="tool-output-loading">Preparing highlighted output…</div>}>
              <ToolOutputView block={block} result={result} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}

function AssistantContent({ message }: { readonly message: ChatMessage }) {
  return (
    <div className="assistant-content">
      {message.blocks.map((block, index) => {
        if (block.type === "text") {
          return <MarkdownContent text={block.text} key={`${message.id}-text-${index}`} />
        }
        if (block.type === "thinking") {
          const preview = block.text.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()
          return (
            <details className="thinking-block" key={`${message.id}-thinking-${index}`}>
              <summary><Brain size={14} /><span>Thinking</span><code>{preview}</code></summary>
              <p>{block.text}</p>
            </details>
          )
        }
        if (block.type === "tool-call") {
          const result = message.blocks.find((candidate) => candidate.type === "tool-result" && candidate.id === block.id)
          return <ToolBlock block={block} result={result?.type === "tool-result" ? result : undefined} key={`${message.id}-tool-${block.id}`} />
        }
        return null
      })}
      {message.blocks.length === 0 && <span className="streaming-caret" aria-label="Pi is responding" />}
    </div>
  )
}

function UserMessageContent({ text, onOpenImage }: { readonly text: string; readonly onOpenImage?: (preview: AttachmentPreview) => void }) {
  return (
    <div className="user-markdown">
      {splitTextByImageReferences(text).map((segment, index) => segment.type === "image"
        ? <ImageAttachmentCard path={segment.value} onOpen={onOpenImage ?? (() => undefined)} key={`image-${index}-${segment.value}`} />
        : <MarkdownContent text={segment.value} className="markdown user-markdown-text" key={`text-${index}`} />)}
    </div>
  )
}

interface MessageViewProps {
  readonly message: ChatMessage
  readonly anchorId?: string
  readonly onOpenImage?: (preview: AttachmentPreview) => void
  readonly onFork?: (message: ChatMessage) => void
  readonly isForking?: boolean
}

const ForkButton = ({ message, onFork, isForking }: Pick<MessageViewProps, "message" | "onFork" | "isForking">) => onFork && (message.role === "user" || message.role === "assistant") ? (
  <button
    type="button"
    className="message-fork"
    aria-label="Fork session from this message"
    title="Fork session from this message"
    disabled={isForking}
    onClick={() => onFork(message)}
  >
    {isForking ? <CircleDashed className={styles.running} size={13} /> : <GitFork size={13} />}
  </button>
) : null

export function MessageView({ message, anchorId, onOpenImage, onFork, isForking }: MessageViewProps) {
  const [copied, setCopied] = useState(false)
  const hasText = message.blocks.some((block) => block.type === "text" && block.text.trim().length > 0)
  const compaction = message.blocks.find((block) => block.type === "compaction")

  if (compaction?.type === "compaction") {
    return (
      <div className={`compaction-separator ${compaction.status}`} id={anchorId} role="separator" aria-label={compaction.status === "compacting" ? "Compacting conversation context" : "Conversation context compacted"}>
        <span>{compaction.status === "compacting" ? "Compacting…" : "Compacted"}</span>
      </div>
    )
  }

  if (message.role === "user") {
    const text = message.blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n\n")
    return (
      <article className="message user-message" id={anchorId}>
        <div className="user-turn">
          <div className="user-bubble"><UserMessageContent text={text} onOpenImage={onOpenImage} /></div>
          <div className="user-message-actions"><ForkButton message={message} onFork={onFork} isForking={isForking} /></div>
        </div>
      </article>
    )
  }

  if (message.role === "tool") return null

  return (
    <article className={`message assistant-message ${hasText ? "" : "compact-turn"}`} id={anchorId}>
      <div className="assistant-body">
        <AssistantContent message={message} />
        {(hasText || onFork) && (
          <div className="message-meta">
            {hasText && <>
              {message.provider && <ProviderLogo provider={message.provider} size={13} />}
              <span>{message.model ?? "Pi"}</span>
              <button
                type="button"
                aria-label="Copy response"
                onClick={() => {
                  void copyText(message.blocks).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1200)
                  })
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </>}
            <ForkButton message={message} onFork={onFork} isForking={isForking} />
          </div>
        )}
      </div>
    </article>
  )
}
