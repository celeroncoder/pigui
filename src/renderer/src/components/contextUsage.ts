import type { ContextUsage } from "../../../shared/contracts"

export type ContextUsageTone = "default" | "warning" | "critical" | "unknown"

export interface ContextUsagePresentation {
  readonly detail: string
  readonly headline: string
  readonly ringPercent: number
  readonly tone: ContextUsageTone
  readonly usageLabel: string
}

const tokenFormatter = new Intl.NumberFormat("en-US")
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const compactTokenFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

const clampForRing = (value: number) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

/** Derive display state only; Pi remains the source of every usage measurement. */
export const contextUsagePresentation = (usage: ContextUsage | undefined): ContextUsagePresentation | undefined => {
  if (!usage) return undefined

  if (usage.tokens === null || usage.percent === null) {
    return {
      detail: `? / ${tokenFormatter.format(usage.contextWindow)} tokens · unknown until next response`,
      headline: `Unknown · ? / ${compactTokenFormatter.format(usage.contextWindow)}`,
      ringPercent: 0,
      tone: "unknown",
      usageLabel: "Waiting for the next response"
    }
  }

  const tone: ContextUsageTone = usage.percent >= 90
    ? "critical"
    : usage.percent >= 70
      ? "warning"
      : "default"

  return {
    detail: `${tokenFormatter.format(usage.tokens)} / ${tokenFormatter.format(usage.contextWindow)} tokens · ${percentFormatter.format(usage.percent)}%`,
    headline: `${percentFormatter.format(usage.percent)}% · ${compactTokenFormatter.format(usage.tokens)} / ${compactTokenFormatter.format(usage.contextWindow)}`,
    ringPercent: clampForRing(usage.percent),
    tone,
    usageLabel: `${tokenFormatter.format(usage.tokens)} tokens in context`
  }
}
