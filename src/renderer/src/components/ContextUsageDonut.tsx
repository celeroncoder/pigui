import { useId, useState } from "react"
import type { ContextUsage } from "../../../shared/contracts"
import { DitherProgressBar } from "./DitherProgressBar"
import { contextUsagePresentation } from "./contextUsage"

interface ContextUsageDonutProps {
  readonly contextUsage?: ContextUsage
}

export function ContextUsageDonut({ contextUsage }: ContextUsageDonutProps) {
  const presentation = contextUsagePresentation(contextUsage)
  const detailId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (!presentation) return null

  return (
    <div
      className={`context-usage-control ${presentation.tone} ${detailsOpen ? "is-open" : ""}`}
      onMouseEnter={() => setDetailsOpen(true)}
      onMouseLeave={() => setDetailsOpen(false)}
    >
      <button
        type="button"
        className="context-usage-button"
        aria-label="Context usage"
        aria-describedby={detailId}
        aria-expanded={detailsOpen}
        onFocus={() => setDetailsOpen(true)}
        onBlur={() => setDetailsOpen(false)}
        onClick={() => setDetailsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            setDetailsOpen(false)
          }
        }}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <circle className="context-usage-track" cx="16" cy="16" r="12" pathLength="100" />
          <circle
            className="context-usage-fill"
            cx="16"
            cy="16"
            r="12"
            pathLength="100"
            style={{ strokeDasharray: "100", strokeDashoffset: 100 - presentation.ringPercent }}
          />
        </svg>
        <span id={detailId} className="visually-hidden">{presentation.detail}</span>
      </button>
      <span className="context-usage-tooltip" role="tooltip" aria-hidden="true">
        <span className="context-usage-tooltip-header">
          <strong>Context window</strong>
          <small>{presentation.headline}</small>
        </span>
        <DitherProgressBar value={presentation.ringPercent} tone={presentation.tone} />
        <span className="context-usage-divider" />
        <span className="context-usage-tooltip-row">
          <span>Current context</span>
          <strong>{presentation.usageLabel}</strong>
        </span>
      </span>
    </div>
  )
}
