import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent"
import type { ModelUsageMetric, ProjectMetrics, TokenUsageTotals } from "../../shared/contracts"

interface SessionTelemetry {
  readonly id: string
  readonly outcome: "success" | "failure" | "incomplete"
  readonly completionMs?: number
  readonly failureReason?: string
  readonly usage: ReadonlyArray<{ readonly model: string; readonly tokens: TokenUsageTotals }>
}

const emptyTokens = (): TokenUsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

const addTokens = (target: TokenUsageTotals, source: Omit<TokenUsageTotals, "total">): TokenUsageTotals => ({
  input: target.input + source.input,
  output: target.output + source.output,
  cacheRead: target.cacheRead + source.cacheRead,
  cacheWrite: target.cacheWrite + source.cacheWrite,
  total: target.total + source.input + source.output + source.cacheRead + source.cacheWrite
})

const usageFromEntry = (entry: SessionEntry): { readonly model: string; readonly tokens: TokenUsageTotals } | undefined => {
  if (entry.type === "message" && entry.message.role === "assistant") {
    const message = entry.message
    return {
      model: `${message.provider}/${message.responseModel ?? message.model}`,
      tokens: addTokens(emptyTokens(), message.usage)
    }
  }
  if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
    return { model: "Tools & summaries", tokens: addTokens(emptyTokens(), entry.message.usage) }
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
    return { model: "Tools & summaries", tokens: addTokens(emptyTokens(), entry.usage) }
  }
  return undefined
}

const failureReason = (stopReason: "error" | "aborted", errorMessage?: string): string => {
  const message = errorMessage?.trim()
  if (message) return message
  return stopReason === "aborted" ? "Aborted" : "Provider error"
}

export const telemetryFromSession = (manager: Pick<SessionManager, "getSessionId" | "getEntries" | "getBranch">): SessionTelemetry => {
  const branchMessages = manager.getBranch().flatMap((entry) => entry.type === "message" ? [entry.message] : [])
  const latestUserIndex = branchMessages.findLastIndex((message) => message.role === "user")
  const latestUser = latestUserIndex >= 0 ? branchMessages[latestUserIndex] : undefined
  const subsequentAssistants = latestUserIndex >= 0
    ? branchMessages.slice(latestUserIndex + 1).filter((message) => message.role === "assistant")
    : []
  const terminal = subsequentAssistants.findLast((message) => message.stopReason !== "pending" && message.stopReason !== "toolUse")
  const usage = manager.getEntries().flatMap((entry) => {
    const projected = usageFromEntry(entry)
    return projected ? [projected] : []
  })

  if (!latestUser || !terminal) return { id: manager.getSessionId(), outcome: "incomplete", usage }
  const completionMs = Math.max(0, terminal.timestamp - latestUser.timestamp)
  if (terminal.stopReason === "error" || terminal.stopReason === "aborted") {
    return {
      id: manager.getSessionId(),
      outcome: "failure",
      completionMs,
      failureReason: failureReason(terminal.stopReason, terminal.errorMessage),
      usage
    }
  }
  return { id: manager.getSessionId(), outcome: "success", completionMs, usage }
}

export const aggregateProjectMetrics = (sessions: ReadonlyArray<SessionTelemetry>, generatedAt = Date.now()): ProjectMetrics => {
  const modelTotals = new Map<string, { tokens: TokenUsageTotals; sessions: Set<string> }>()
  const reasons = new Map<string, number>()
  let tokenUsage = emptyTokens()
  let successfulSessions = 0
  let failedSessions = 0
  let totalCompletionMs = 0

  for (const session of sessions) {
    if (session.outcome === "success") successfulSessions += 1
    if (session.outcome === "failure") {
      failedSessions += 1
      const reason = session.failureReason ?? "Provider error"
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    if (session.completionMs !== undefined) totalCompletionMs += session.completionMs
    for (const item of session.usage) {
      tokenUsage = addTokens(tokenUsage, item.tokens)
      const current = modelTotals.get(item.model) ?? { tokens: emptyTokens(), sessions: new Set<string>() }
      current.tokens = addTokens(current.tokens, item.tokens)
      current.sessions.add(session.id)
      modelTotals.set(item.model, current)
    }
  }

  const completedSessions = successfulSessions + failedSessions
  const modelUsage: ModelUsageMetric[] = [...modelTotals.entries()].map(([model, value]) => ({
    model,
    sessions: value.sessions.size,
    ...value.tokens
  })).sort((left, right) => right.total - left.total || left.model.localeCompare(right.model))

  return {
    generatedAt,
    sessionCount: sessions.length,
    completedSessions,
    successfulSessions,
    failedSessions,
    incompleteSessions: sessions.length - completedSessions,
    successRate: completedSessions > 0 ? successfulSessions / completedSessions : null,
    averageCompletionMs: completedSessions > 0 ? totalCompletionMs / completedSessions : null,
    tokenUsage,
    modelUsage,
    failureReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
  }
}
