import { ArrowUp, Check, ChevronDown, Folder, GitBranch, GitFork, HardDrive, Pencil, Send, ShieldCheck, Square, Trash2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { parseImagePathReferences } from "../../../shared/attachments"
import type { AttachmentPreview, ContextUsage, ImageAttachment, ModelOption, QueueDelivery, QueuedMessage, SessionDraftContext, ThinkingLevel } from "../../../shared/contracts"
import { ContextUsageDonut } from "./ContextUsageDonut"
import { ImageAttachmentCard } from "./ImageAttachmentCard"
import { ProviderLogo } from "./ProviderLogo"

const effortLabel: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max"
}

interface PromptQueueProps {
  readonly messages: ReadonlyArray<QueuedMessage>
  readonly disabled: boolean
  readonly onEdit: (message: QueuedMessage, text: string) => Promise<void>
  readonly onRemove: (message: QueuedMessage) => Promise<void>
  readonly onSteer: (message: QueuedMessage) => Promise<void>
}

function PromptQueue({ messages, disabled, onEdit, onRemove, onSteer }: PromptQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    if (editingId && !messages.some((message) => message.id === editingId)) {
      setEditingId(null)
      setEditingText("")
    }
  }, [editingId, messages])

  if (messages.length === 0) return null

  const runAction = async (id: string, action: () => Promise<void>): Promise<boolean> => {
    setPendingId(id)
    try {
      await action()
      return true
    } catch {
      return false
    } finally {
      setPendingId((current) => current === id ? null : current)
    }
  }

  const saveEdit = async (message: QueuedMessage) => {
    const text = editingText.trim()
    if (!text) return
    if (await runAction(message.id, () => onEdit(message, text))) {
      setEditingId(null)
      setEditingText("")
    }
  }

  return (
    <section className="prompt-queue" aria-label="Queued Pi messages">
      <header className="prompt-queue-header">
        <span><Send size={11} /> Queue <small>{messages.length}</small></span>
        <em>Pi-managed</em>
      </header>
      <ol className="prompt-queue-list">
        {messages.map((message) => {
          const editing = editingId === message.id
          const pending = pendingId === message.id
          const hasImages = parseImagePathReferences(message.text).length > 0
          const controlsDisabled = disabled || pendingId !== null
          return (
            <li className={`prompt-queue-item ${message.delivery === "steer" ? "steering" : "follow-up"}`} key={message.id}>
              <span className="prompt-queue-delivery">{message.delivery === "steer" ? "Steering" : "Follow-up"}</span>
              {editing ? (
                <div className="prompt-queue-edit">
                  <textarea
                    aria-label="Edit queued message"
                    value={editingText}
                    disabled={controlsDisabled}
                    rows={2}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setEditingId(null)
                        setEditingText("")
                      }
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void saveEdit(message)
                      }
                    }}
                  />
                  <div className="prompt-queue-edit-actions">
                    <button type="button" className="queue-action save" aria-label="Save queued message" title="Save (⌘/Ctrl+Enter)" disabled={controlsDisabled || !editingText.trim()} onClick={() => void saveEdit(message)}>
                      <Check size={12} /> Save
                    </button>
                    <button type="button" className="queue-action" aria-label="Cancel editing queued message" disabled={controlsDisabled} onClick={() => {
                      setEditingId(null)
                      setEditingText("")
                    }}>
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="prompt-queue-text" title={message.text}>{message.text}</p>
                  <div className="prompt-queue-actions">
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={hasImages ? "Image attachments cannot be edited in the queue" : "Edit queued message"}
                      title={hasImages ? "Remove and resend to change an attached image" : "Edit"}
                      disabled={controlsDisabled || hasImages}
                      onClick={() => {
                        setEditingId(message.id)
                        setEditingText(message.text)
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="queue-action remove" aria-label="Remove queued message" title="Remove" disabled={controlsDisabled} onClick={() => void runAction(message.id, () => onRemove(message))}>
                      <Trash2 size={12} />
                    </button>
                    <button
                      type="button"
                      className="queue-action steer"
                      aria-label={message.delivery === "steer" ? "Send this steering message first" : "Steer this message after Pi's current tool turn"}
                      title={message.delivery === "steer" ? "Send first" : "Steer after the current tool turn"}
                      disabled={controlsDisabled}
                      onClick={() => void runAction(message.id, () => onSteer(message))}
                    >
                      <Send size={11} /> {pending ? "Sending" : message.delivery === "steer" ? "Send first" : "Steer now"}
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

interface ComposerProps {
  readonly value: string
  readonly disabled: boolean
  readonly disabledReason?: string
  readonly attachments: ReadonlyArray<ImageAttachment>
  readonly isStreaming: boolean
  readonly model: string
  readonly modelProvider?: string
  readonly modelOptions: ReadonlyArray<ModelOption>
  readonly thinkingLevel: ThinkingLevel
  readonly availableThinkingLevels: ReadonlyArray<ThinkingLevel>
  readonly queuedMessages: ReadonlyArray<QueuedMessage>
  readonly contextUsage?: ContextUsage
  readonly worktreeContext?: SessionDraftContext
  readonly draftContext?: SessionDraftContext
  readonly draftBaseBranch?: string
  readonly draftContextLoading?: boolean
  readonly onDraftBaseBranchChange: (branch: string) => void
  readonly onModelChange: (option: ModelOption) => void
  readonly onThinkingLevelChange: (level: ThinkingLevel) => void
  readonly onChange: (value: string) => void
  readonly onOpenImage: (preview: AttachmentPreview) => void
  readonly onPasteImage: (image: File) => void
  readonly onRemoveAttachment: (id: string) => void
  readonly onSubmit: (delivery?: QueueDelivery) => void
  readonly onEditQueuedMessage: (message: QueuedMessage, text: string) => Promise<void>
  readonly onRemoveQueuedMessage: (message: QueuedMessage) => Promise<void>
  readonly onSteerQueuedMessage: (message: QueuedMessage) => Promise<void>
  readonly onAbort: () => void
}

export function Composer({
  value,
  disabled,
  disabledReason,
  attachments,
  isStreaming,
  model,
  modelProvider,
  modelOptions,
  thinkingLevel,
  availableThinkingLevels,
  queuedMessages,
  contextUsage,
  worktreeContext,
  draftContext,
  draftBaseBranch,
  draftContextLoading = false,
  onDraftBaseBranchChange,
  onModelChange,
  onThinkingLevelChange,
  onChange,
  onOpenImage,
  onPasteImage,
  onRemoveAttachment,
  onSubmit,
  onEditQueuedMessage,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onAbort
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [openPicker, setOpenPicker] = useState<"model" | "effort" | null>(null)
  const currentProvider = modelProvider ?? modelOptions.find((option) => option.id === model)?.provider
  const displayedContext = draftContext ?? worktreeContext

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = "0px"
    const height = Math.min(Math.max(input.scrollHeight, 48), 132)
    input.style.height = `${height}px`
    input.style.overflowY = input.scrollHeight > 132 ? "auto" : "hidden"
  }, [value])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  useEffect(() => {
    if (!openPicker) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpenPicker(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPicker(null)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [openPicker])

  return (
    <div className="composer-shell">
      {displayedContext && (
        <section className="composer-worktree-context" aria-label={draftContext ? "New session worktree context" : "Selected worktree context"}>
          <span className="composer-context-folder" title={displayedContext.path}>
            <Folder size={13} aria-hidden="true" />
            <strong>{displayedContext.folderName}</strong>
            <small>{displayedContext.path}</small>
          </span>
          <span className="composer-context-kind" title={`${displayedContext.worktreeKind === "linked" ? "Linked worktree" : "Local checkout"}: ${displayedContext.path}`}>
            {displayedContext.worktreeKind === "linked" ? <GitFork size={13} aria-hidden="true" /> : <HardDrive size={13} aria-hidden="true" />}
            {displayedContext.worktreeKind === "linked" ? "Linked worktree" : "Local checkout"}
          </span>
          <span className="composer-context-branch" title={`Current branch: ${displayedContext.branch}`}>
            <GitBranch size={13} aria-hidden="true" />
            <span>{displayedContext.branch}</span>
          </span>
          {draftContext?.worktreeKind === "linked" && (
            <label className="composer-base-branch">
              <span>Base branch</span>
              <select
                aria-label="Base branch for new worktree session"
                value={draftBaseBranch ?? ""}
                disabled={disabled || draftContextLoading || draftContext.baseBranches.length === 0}
                onChange={(event) => onDraftBaseBranchChange(event.target.value)}
              >
                {draftContext.baseBranches.length === 0 && <option value="">{draftContextLoading ? "Loading branches…" : "No base branches found"}</option>}
                {draftContext.baseBranches.map((branch) => <option value={branch} key={branch}>{branch}</option>)}
              </select>
            </label>
          )}
          {draftContext?.setupEnvironment && (
            <span className="composer-setup-environment" title={`Runs ${draftContext.setupEnvironment.configPath} before the first Pi session is created`}>
              Setup: {draftContext.setupEnvironment.name}
            </span>
          )}
        </section>
      )}
      <PromptQueue
        messages={queuedMessages}
        disabled={disabled}
        onEdit={onEditQueuedMessage}
        onRemove={onRemoveQueuedMessage}
        onSteer={onSteerQueuedMessage}
      />
      <div className={`composer ${isStreaming ? "streaming" : ""}`}>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label="Message Pi"
          placeholder={disabled ? disabledReason ?? "Select a project to begin" : isStreaming ? "Queue a follow-up or steer Pi…" : "Ask Pi to build, inspect, or fix…"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (value.trim() || attachments.length > 0) onSubmit(isStreaming && event.altKey ? "steer" : "follow-up")
            }
          }}
          onPaste={(event) => {
            if (disabled) return
            const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"))
            if (!image) return
            event.preventDefault()
            onPasteImage(image)
          }}
        />
        {attachments.length > 0 && (
          <div className="composer-attachments" aria-label="Pending image attachments">
            {attachments.map((attachment) => (
              <div className="composer-attachment" key={attachment.id}>
                <ImageAttachmentCard attachment={attachment} compact onOpen={onOpenImage} />
                <button type="button" className="composer-attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-tools" ref={pickerRef}>
            <button
              type="button"
              className="composer-model-selector"
              aria-label={`Current model: ${model}`}
              aria-expanded={openPicker === "model"}
              disabled={!!draftContext}
              title={draftContext ? "Pi model choices become available after the first message starts the session" : undefined}
              onClick={() => setOpenPicker((open) => open === "model" ? null : "model")}
            >
              {currentProvider ? <ProviderLogo provider={currentProvider} size={15} /> : <span className={`live-dot ${isStreaming ? "active" : ""}`} />}
              <span>{model}</span>
              <ChevronDown size={12} />
            </button>
            {openPicker === "model" && (
              <div className="model-menu" role="menu" aria-label="Available models">
                <span className="model-menu-label">Available models</span>
                {modelOptions.length === 0 && <span className="model-menu-empty">No authenticated models found</span>}
                {modelOptions.map((option) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={`${option.provider}/${option.id}`}
                    onClick={() => {
                      onModelChange(option)
                      setOpenPicker(null)
                    }}
                  >
                    <ProviderLogo provider={option.provider} size={20} />
                    <span className="model-option-copy">
                      <strong>{option.name}</strong>
                      <small>{option.provider}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {availableThinkingLevels.length > 1 && (
              <div className="effort-picker">
                <button
                  type="button"
                  className="composer-effort-selector"
                  aria-label={`Current reasoning effort: ${thinkingLevel}`}
                  aria-expanded={openPicker === "effort"}
                  disabled={isStreaming}
                  title={isStreaming ? "Effort can be changed after Pi finishes" : "Reasoning effort for the next message"}
                  onClick={() => setOpenPicker((open) => open === "effort" ? null : "effort")}
                >
                  <span>{effortLabel[thinkingLevel]}</span>
                  <ChevronDown size={12} />
                </button>
                {openPicker === "effort" && (
                  <div className="effort-menu" role="menu" aria-label="Reasoning effort">
                    <span className="model-menu-label">Reasoning effort</span>
                    <small>Applied to the next Pi message</small>
                    {availableThinkingLevels.map((level) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={level === thinkingLevel}
                        key={level}
                        onClick={() => {
                          onThinkingLevelChange(level)
                          setOpenPicker(null)
                        }}
                        className={level === thinkingLevel ? "selected" : undefined}
                      >
                        <span className={`effort-option-label ${level === "xhigh" || level === "max" ? "emphasis" : ""}`}>
                          {effortLabel[level]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="context-pill" title="Pi uses its configured tool access"><ShieldCheck size={14} /><span>Full access</span></span>
          </div>
          <div className="composer-run-actions">
            <ContextUsageDonut contextUsage={contextUsage} />
            {isStreaming ? (
              <>
                <button type="button" className="send-button queue" aria-label="Queue follow-up message" title="Queue follow-up" disabled={disabled || (!value.trim() && attachments.length === 0)} onClick={() => onSubmit("follow-up")}><Send size={14} /></button>
                <button type="button" className="send-button stop" aria-label="Stop Pi" onClick={onAbort}><Square size={12} fill="currentColor" /></button>
              </>
            ) : (
              <button type="button" className="send-button" aria-label="Send message" disabled={disabled || (!value.trim() && attachments.length === 0)} onClick={() => onSubmit()}><ArrowUp size={17} /></button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-caption">
        <span>{isStreaming ? "Enter to queue follow-up · Alt+Enter to steer · Shift+Enter for new line" : "Enter to send · Shift+Enter for new line"}</span>
        <span>Pi can make mistakes. Review changes.</span>
      </div>
    </div>
  )
}
