import { Check, PenLine, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type FormEvent } from "react"
import type { AskUserInteractionAnswer, AskUserInteractionRequest } from "../../../shared/contracts"

interface AskUserPanelProps {
  readonly request: AskUserInteractionRequest
  readonly submitting: boolean
  readonly onAnswer: (answer: AskUserInteractionAnswer) => void
}

export function AskUserPanel({ request, submitting, onAnswer }: AskUserPanelProps) {
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const customInputRef = useRef<HTMLTextAreaElement>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customAnswer, setCustomAnswer] = useState("")

  useEffect(() => {
    setCustomMode(false)
    setCustomAnswer("")
    firstOptionRef.current?.focus()
  }, [request.requestId])

  useEffect(() => {
    if (customMode) customInputRef.current?.focus()
  }, [customMode])

  const answerOption = (optionIndex: number) => {
    if (!submitting) onAnswer({ kind: "option", optionIndex })
  }

  const submitCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || !customAnswer.trim()) return
    onAnswer({ kind: "custom", answer: customAnswer })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      if (customMode) {
        setCustomMode(false)
        setCustomAnswer("")
      } else if (!submitting) {
        onAnswer({ kind: "dismissed" })
      }
      return
    }

    if (customMode || submitting || event.metaKey || event.ctrlKey || event.altKey) return
    const optionIndex = Number(event.key) - 1
    if (Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < request.options.length) {
      event.preventDefault()
      answerOption(optionIndex)
    }
  }

  return (
    <section
      className="ask-user-panel"
      aria-labelledby={`ask-user-title-${request.requestId}`}
      aria-describedby={`ask-user-question-${request.requestId}`}
      aria-keyshortcuts={`${request.options.map((_option, index) => index + 1).join(" ")} Escape`}
      data-testid="ask-user-panel"
      onKeyDown={handleKeyDown}
    >
      <div className="ask-user-panel-heading">
        <div>
          <span className="ask-user-eyebrow">Pi needs your input</span>
          <h2 id={`ask-user-title-${request.requestId}`}>Choose a direction</h2>
        </div>
        <button
          type="button"
          className="ask-user-dismiss"
          aria-label="Dismiss question"
          title="Dismiss question (Esc)"
          disabled={submitting}
          onClick={() => onAnswer({ kind: "dismissed" })}
        >
          <X size={15} />
        </button>
      </div>

      <p className="ask-user-question" id={`ask-user-question-${request.requestId}`}>{request.question}</p>

      {!customMode ? (
        <div className="ask-user-options" aria-label="Answer options">
          {request.options.map((option, index) => (
            <button
              type="button"
              className="ask-user-option"
              data-testid={`ask-user-option-${index}`}
              key={`${request.requestId}-${index}`}
              ref={index === 0 ? firstOptionRef : undefined}
              disabled={submitting}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => answerOption(index)}
            >
              <span className="ask-user-option-number" aria-hidden="true">{index + 1}</span>
              <span className="ask-user-option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              <Check className="ask-user-option-check" size={15} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="ask-user-option ask-user-custom-option"
            data-testid="ask-user-custom-option"
            disabled={submitting}
            onClick={() => setCustomMode(true)}
          >
            <span className="ask-user-option-number ask-user-pencil" aria-hidden="true"><PenLine size={14} /></span>
            <span className="ask-user-option-copy">
              <strong>Write my own answer…</strong>
              <small>Use a free-form answer instead</small>
            </span>
          </button>
        </div>
      ) : (
        <form className="ask-user-custom-form" onSubmit={submitCustom}>
          <label htmlFor={`ask-user-custom-${request.requestId}`}>Your answer</label>
          <textarea
            ref={customInputRef}
            id={`ask-user-custom-${request.requestId}`}
            data-testid="ask-user-custom-input"
            rows={2}
            value={customAnswer}
            disabled={submitting}
            placeholder="Write your answer…"
            onChange={(event) => setCustomAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!submitting && customAnswer.trim()) onAnswer({ kind: "custom", answer: customAnswer })
              }
            }}
          />
          <div className="ask-user-custom-actions">
            <button type="button" className="ask-user-back" disabled={submitting} onClick={() => { setCustomMode(false); setCustomAnswer("") }}>
              Back to options
            </button>
            <button type="submit" className="ask-user-submit" disabled={submitting || !customAnswer.trim()}>
              <Check size={14} />
              {submitting ? "Sending…" : "Submit answer"}
            </button>
          </div>
        </form>
      )}

      <div className="ask-user-panel-footer">
        <span>{customMode ? "Enter submits · Shift+Enter adds a line · Esc returns to options" : `Press 1–${request.options.length} or use the buttons · Esc dismisses`}</span>
        {submitting && <span role="status" aria-live="polite">Sending answer…</span>}
      </div>
    </section>
  )
}
