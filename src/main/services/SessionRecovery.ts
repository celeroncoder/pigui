import type { SessionRecovery, SessionRecoveryAction } from "../../shared/contracts"

interface RecoveryMessage {
  readonly role?: unknown
  readonly content?: unknown
  readonly stopReason?: unknown
  readonly errorMessage?: unknown
}

const messageText = (content: unknown): string | undefined => {
  if (typeof content === "string") return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block) => {
    if (typeof block !== "object" || block === null || !("type" in block) || !("text" in block)) return []
    return block.type === "text" && typeof block.text === "string" ? [block.text] : []
  }).join("\n").trim()
  return text || undefined
}

export const lastUserPrompt = (messages: ReadonlyArray<RecoveryMessage>): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user") return messageText(message.content)
  }
  return undefined
}

export const interruptedTransportReason = (
  messages: ReadonlyArray<RecoveryMessage>,
  willRetry: boolean,
  abortRequested: boolean
): string | undefined => {
  if (willRetry || abortRequested) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "assistant") continue
    if (message.stopReason !== "error" && message.stopReason !== "aborted") return undefined
    if (typeof message.errorMessage === "string" && message.errorMessage.trim()) return message.errorMessage.trim()
    return message.stopReason === "aborted"
      ? "Pi's response transport stopped before the turn completed."
      : "Pi's response transport ended with an error."
  }
  return undefined
}

export const recoveryPrompt = (action: SessionRecoveryAction, recovery: SessionRecovery): string | undefined => {
  if (action === "resume") return undefined
  if (action === "restart") return recovery.lastPrompt
  return "Continue from the last preserved session state. Review the interrupted turn, avoid repeating completed work, and finish the requested task."
}
