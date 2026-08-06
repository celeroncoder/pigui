import { describe, expect, it } from "vitest"
import { projectContextUsage } from "./contextUsage"

describe("context usage projection", () => {
  it("omits usage when Pi reports no model context window", () => {
    expect(projectContextUsage({ getContextUsage: () => undefined })).toBeUndefined()
  })

  it("copies Pi's usage values without estimating or changing them", () => {
    const source = { tokens: 143_278, contextWindow: 200_000, percent: 71.639 }

    expect(projectContextUsage({ getContextUsage: () => source })).toEqual(source)
  })

  it("preserves Pi's post-compaction unknown state", () => {
    expect(projectContextUsage({ getContextUsage: () => ({ tokens: null, contextWindow: 200_000, percent: null }) })).toEqual({
      tokens: null,
      contextWindow: 200_000,
      percent: null
    })
  })
})
