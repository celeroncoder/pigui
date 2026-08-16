import { describe, expect, it } from "vitest"
import { contextUsagePresentation } from "./contextUsage"

describe("composer context usage presentation", () => {
  it("hides the control when Pi has no context window", () => {
    expect(contextUsagePresentation(undefined)).toBeUndefined()
  })

  it("renders Pi's post-compaction state as unknown instead of zero percent", () => {
    expect(contextUsagePresentation({ tokens: null, contextWindow: 200_000, percent: null })).toEqual({
      detail: "? / 200,000 tokens · unknown until next response",
      headline: "Unknown · ? / 200K",
      ringPercent: 0,
      tone: "unknown",
      usageLabel: "Waiting for the next response"
    })
  })

  it("formats ordinary usage and retains its unrounded value for the ring", () => {
    expect(contextUsagePresentation({ tokens: 143_278, contextWindow: 200_000, percent: 71.639 })).toEqual({
      detail: "143,278 / 200,000 tokens · 71.6%",
      headline: "71.6% · 143.3K / 200K",
      ringPercent: 71.639,
      tone: "warning",
      usageLabel: "143,278 tokens in context"
    })
  })

  it("uses restrained warning and critical thresholds at 70% and 90%", () => {
    expect(contextUsagePresentation({ tokens: 139, contextWindow: 200, percent: 69.9 })?.tone).toBe("default")
    expect(contextUsagePresentation({ tokens: 140, contextWindow: 200, percent: 70 })?.tone).toBe("warning")
    expect(contextUsagePresentation({ tokens: 180, contextWindow: 200, percent: 90 })?.tone).toBe("critical")
  })

  it("clamps only the rendered ring, not the presented source percentage", () => {
    expect(contextUsagePresentation({ tokens: 300, contextWindow: 200, percent: 150 })).toEqual({
      detail: "300 / 200 tokens · 150%",
      headline: "150% · 300 / 200",
      ringPercent: 100,
      tone: "critical",
      usageLabel: "300 tokens in context"
    })
  })
})
