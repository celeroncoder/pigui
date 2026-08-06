import type { ChatMessage } from "../../../shared/contracts"

export const latestTransientStatus = (text: string) => text
  .split(/\n+/)
  .map((line) => line.replace(/[*_`#]/g, "").trim())
  .filter(Boolean)
  .at(-1)

export type ConversationItem =
  | { readonly type: "message"; readonly id: string; readonly message: ChatMessage }
  | { readonly type: "activity"; readonly id: string; readonly messages: ReadonlyArray<ChatMessage> }

export type MessagePreviewLandmark = {
  readonly id: string
  readonly targetId: string
  readonly kind: "user" | "assistant" | "activity" | "compaction"
  readonly label: string
  readonly detail: string
}

const compactPreviewLabel = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized
}

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

export const buildConversationPreviewLandmarks = (items: ReadonlyArray<ConversationItem>): ReadonlyArray<MessagePreviewLandmark> => items.map((item) => {
  const targetId = `conversation-landmark-${item.id}`
  if (item.type === "activity") {
    const toolNames = [...new Set(item.messages.flatMap((message) => message.blocks.flatMap((block) => block.type === "tool-call" ? [block.name] : [])))]
    const toolCount = item.messages.reduce((total, message) => total + message.blocks.filter((block) => block.type === "tool-call").length, 0)
    const thinkingCount = item.messages.reduce((total, message) => total + message.blocks.filter((block) => block.type === "thinking").length, 0)
    const activityLabel = toolCount > 0
      ? `${toolCount} tool ${toolCount === 1 ? "call" : "calls"}`
      : `${thinkingCount} thinking ${thinkingCount === 1 ? "step" : "steps"}`
    return {
      id: `preview-${item.id}`,
      targetId,
      kind: "activity",
      label: activityLabel,
      detail: toolNames.slice(0, 2).join(" · ") || "Agent trace"
    }
  }

  const compaction = item.message.blocks.find((block) => block.type === "compaction")
  if (compaction?.type === "compaction") {
    return {
      id: `preview-${item.id}`,
      targetId,
      kind: "compaction",
      label: compaction.status === "compacting" ? "Compacting context…" : "Context compacted",
      detail: "Full history remains visible"
    }
  }

  const text = item.message.blocks
    .flatMap((block) => block.type === "text" ? [block.text] : [])
    .join(" ")
    .replace(/[#*_`~>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return {
    id: `preview-${item.id}`,
    targetId,
    kind: item.message.role === "user" ? "user" : "assistant",
    label: compactPreviewLabel(text || (item.message.role === "user" ? "New prompt" : "Pi response"), 43),
    detail: item.message.role === "user" ? "Your message" : "Assistant response"
  }
})

export const filterUserMessagePreviewLandmarks = (landmarks: ReadonlyArray<MessagePreviewLandmark>): ReadonlyArray<MessagePreviewLandmark> =>
  landmarks.filter((landmark) => landmark.kind === "user")
