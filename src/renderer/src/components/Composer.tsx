import { ArrowUp, ChevronDown, ShieldCheck, Square } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ModelOption, ThinkingLevel } from "../../../shared/contracts"
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

interface ComposerProps {
  readonly value: string
  readonly disabled: boolean
  readonly isStreaming: boolean
  readonly model: string
  readonly modelProvider?: string
  readonly modelOptions: ReadonlyArray<ModelOption>
  readonly thinkingLevel: ThinkingLevel
  readonly availableThinkingLevels: ReadonlyArray<ThinkingLevel>
  readonly onModelChange: (option: ModelOption) => void
  readonly onThinkingLevelChange: (level: ThinkingLevel) => void
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onAbort: () => void
}

export function Composer({ value, disabled, isStreaming, model, modelProvider, modelOptions, thinkingLevel, availableThinkingLevels, onModelChange, onThinkingLevelChange, onChange, onSubmit, onAbort }: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [openPicker, setOpenPicker] = useState<"model" | "effort" | null>(null)
  const currentProvider = modelProvider ?? modelOptions.find((option) => option.id === model)?.provider

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
      <div className={`composer ${isStreaming ? "streaming" : ""}`}>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label="Message Pi"
          placeholder={disabled ? "Select a project to begin" : "Ask Pi to build, inspect, or fix…"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (!isStreaming && value.trim()) onSubmit()
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools" ref={pickerRef}>
            <button
              type="button"
              className="composer-model-selector"
              aria-label={`Current model: ${model}`}
              aria-expanded={openPicker === "model"}
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
          {isStreaming ? (
            <button type="button" className="send-button stop" aria-label="Stop Pi" onClick={onAbort}><Square size={12} fill="currentColor" /></button>
          ) : (
            <button type="button" className="send-button" aria-label="Send message" disabled={disabled || !value.trim()} onClick={onSubmit}><ArrowUp size={17} /></button>
          )}
        </div>
      </div>
      <div className="composer-caption"><span>Enter to send · Shift+Enter for new line</span><span>Pi can make mistakes. Review changes.</span></div>
    </div>
  )
}
