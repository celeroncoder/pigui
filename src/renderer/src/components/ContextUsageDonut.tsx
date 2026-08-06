import { useId, useState } from "react"
import type { ContextUsage } from "../../../shared/contracts"
import { DitherProgressBar } from "./DitherProgressBar"
import { contextUsagePresentation } from "./contextUsage"
import styles from "./ContextUsageDonut.module.css"

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
      className={`${styles.control} ${presentation.tone === "default" ? "" : styles[presentation.tone]} ${detailsOpen ? styles.isOpen : ""}`}
      onMouseEnter={() => setDetailsOpen(true)}
      onMouseLeave={(event) => {
        // Keep details open while keyboard focus remains inside the control.
        if (event.currentTarget.contains(document.activeElement)) return
        setDetailsOpen(false)
      }}
    >
      <button
        type="button"
        className={styles.button}
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
          <circle className={styles.track} cx="16" cy="16" r="12" pathLength="100" />
          <circle
            className={styles.fill}
            cx="16"
            cy="16"
            r="12"
            pathLength="100"
            style={{ strokeDasharray: "100", strokeDashoffset: 100 - presentation.ringPercent }}
          />
        </svg>
        <span id={detailId} className="visually-hidden">{presentation.detail}</span>
      </button>
      <span className={styles.tooltip} role="tooltip" aria-hidden="true">
        <span className={styles.tooltipHeader}>
          <strong>Context window</strong>
          <small>{presentation.headline}</small>
        </span>
        <DitherProgressBar value={presentation.ringPercent} tone={presentation.tone} />
        <span className={styles.divider} />
        <span className={styles.tooltipRow}>
          <span>Current context</span>
          <strong>{presentation.usageLabel}</strong>
        </span>
      </span>
    </div>
  )
}
