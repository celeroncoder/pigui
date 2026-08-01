import type { ChatMessage } from "../../../shared/contracts"

export const latestTransientStatus = (text: string) => text
  .split(/\n+/)
  .map((line) => line.replace(/[*_`#]/g, "").trim())
  .filter(Boolean)
  .at(-1)

export type ConversationItem =
  | { readonly type: "message"; readonly id: string; readonly message: ChatMessage }
  | { readonly type: "activity"; readonly id: string; readonly messages: ReadonlyArray<ChatMessage> }

export const buildConversationItems = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ConversationItem> => {
  const items: ConversationItem[] = []
  let pendingActivity: ChatMessage[] = []

  const flushActivity = () => {
    const first = pendingActivity[0]
    const last = pendingActivity.at(-1)
    if (first && last) items.push({ type: "activity", id: `activity-${first.id}-${last.id}`, messages: pendingActivity })
    pendingActivity = []
  }

  for (const message of messages) {
    if (message.role === "tool") continue
    if (message.role !== "assistant") {
      flushActivity()
      items.push({ type: "message", id: message.id, message })
      continue
    }

    if (message.blocks.length === 0) continue

    const hasToolCall = message.blocks.some((block) => block.type === "tool-call")
    const textBlocks = message.blocks.filter((block) => block.type === "text")
    const activityBlocks = message.blocks.filter((block) => block.type !== "text")

    if (hasToolCall) {
      pendingActivity.push(message)
      continue
    }
    if (activityBlocks.length > 0) pendingActivity.push({ ...message, blocks: activityBlocks })
    if (textBlocks.length > 0) {
      flushActivity()
      items.push({ type: "message", id: message.id, message: { ...message, blocks: textBlocks } })
    }
  }

  flushActivity()
  return items
}
