import type { ContextUsage } from "./contracts"

/** The small, stable part of AgentSession used by the shared projection. */
export interface ContextUsageSession {
  readonly getContextUsage: () => ContextUsage | undefined
}

/**
 * Copy Pi's measurement into the renderer contract without estimating, clamping,
 * or otherwise changing it. In particular, null is meaningful after compaction.
 */
export const projectContextUsage = (session: ContextUsageSession): ContextUsage | undefined => {
  const usage = session.getContextUsage()
  return usage && {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent
  }
}
