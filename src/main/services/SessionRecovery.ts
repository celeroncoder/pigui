import { Schema } from "effect"
import type { SessionRecovery, SessionRecoveryAction } from "../../shared/contracts"

const RecoveryContentBlockSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String)
})

const isString = Schema.is(Schema.String)

const MessageContentSchema = Schema.Union([
  Schema.String,
  Schema.Array(RecoveryContentBlockSchema)
])

export const RecoveryMessageSchema = Schema.Struct({
  role: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(MessageContentSchema),
  stopReason: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.String)
})

export type RecoveryMessage = typeof RecoveryMessageSchema.Type

const messageText = (content: typeof MessageContentSchema.Type | undefined): string | undefined => {
  if (content === undefined) return undefined
  if (Array.isArray(content)) {
    const text = content.flatMap((block) => block.type === "text" && block.text ? [block.text] : []).join("\n").trim()
    return text || undefined
  }
  if (isString(content)) return content.trim() || undefined
  return undefined
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
    if (message?.role === "user") {
      return "Pi's response transport stopped before the turn completed."
    }
    if (message?.role !== "assistant") continue
    // Pi uses `aborted` for an intentional AbortSignal cancellation. That state
    // persists in JSONL, where the in-memory abortRequested flag is unavailable,
    // so treating it as a dead transport would resurrect recovery UI after a
    // normal user abort or app restart.
    if (message.stopReason !== "error") return undefined
    if (message.errorMessage && message.errorMessage.trim()) return message.errorMessage.trim()
    return "Pi's response transport ended with an error."
  }
  return undefined
}

export const recoveryAfterReopen = (
  action: SessionRecoveryAction,
  recovery: SessionRecovery
): SessionRecovery | undefined => action === "resume" ? undefined : recovery

export const recoveryPrompt = (action: SessionRecoveryAction, recovery: SessionRecovery): string | undefined => {
  if (action === "resume") return undefined
  if (action === "restart") return recovery.lastPrompt
  return "Continue from the last preserved session state. Review the interrupted turn, avoid repeating completed work, and finish the requested task."
}
