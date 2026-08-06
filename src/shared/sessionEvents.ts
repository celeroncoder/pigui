import type { ChatMessage, MessageBlock, SessionDetail, SessionEvent, ToolResultBlock } from "./contracts"

const ensureAssistantMessage = (detail: SessionDetail, messageId: string, timestamp: number): SessionDetail => {
  if (detail.messages.some((message) => message.id === messageId)) return detail
  return {
    ...detail,
    messages: [...detail.messages, { id: messageId, role: "assistant", blocks: [], timestamp }]
  }
}

const updateAssistantMessage = (
  detail: SessionDetail,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage
): SessionDetail => {
  const index = detail.messages.findIndex((message) => message.id === messageId && message.role === "assistant")
  if (index < 0) return detail
  return {
    ...detail,
    messages: detail.messages.map((message, messageIndex) => messageIndex === index ? update(message) : message)
  }
}

const startAssistantMessage = (detail: SessionDetail, messageId: string, timestamp: number): SessionDetail => {
  const withMessage = ensureAssistantMessage(detail, messageId, timestamp)
  return updateAssistantMessage(withMessage, messageId, (message) =>
    message.timestamp === timestamp ? message : { ...message, timestamp }
  )
}

const appendTextDelta = (detail: SessionDetail, messageId: string, delta: string): SessionDetail => {
  const withMessage = ensureAssistantMessage(detail, messageId, Date.now())
  return updateAssistantMessage(withMessage, messageId, (message) => {
    const last = message.blocks.at(-1)
    if (last?.type === "text") {
      return { ...message, blocks: [...message.blocks.slice(0, -1), { type: "text", text: `${last.text}${delta}` }] }
    }
    return { ...message, blocks: [...message.blocks, { type: "text", text: delta }] }
  })
}

const addToolCall = (detail: SessionDetail, event: Extract<SessionEvent, { readonly type: "tool-start" }>): SessionDetail => {
  if (detail.messages.some((message) => message.blocks.some((block) => block.type === "tool-call" && block.id === event.tool.id))) {
    return detail
  }
  const withMessage = ensureAssistantMessage(detail, event.messageId, event.tool.startedAt)
  return updateAssistantMessage(withMessage, event.messageId, (message) => ({
    ...message,
    blocks: [
      ...message.blocks,
      {
        type: "tool-call",
        id: event.tool.id,
        name: event.tool.name,
        input: event.tool.input ?? ""
      },
      {
        type: "tool-result",
        id: event.tool.id,
        name: event.tool.name,
        output: "",
        isError: false,
        status: "running"
      }
    ]
  }))
}

const upsertToolResult = (
  detail: SessionDetail,
  toolId: string,
  output: string,
  status: "running" | "success" | "error",
  isError: boolean,
  diff?: string
): SessionDetail => {
  const assistantIndex = detail.messages.findLastIndex((message) =>
    message.role === "assistant" && message.blocks.some((block) => block.type === "tool-call" && block.id === toolId)
  )
  const assistant = detail.messages[assistantIndex]
  if (!assistant) return detail
  const toolCall = assistant.blocks.find((block) => block.type === "tool-call" && block.id === toolId)
  if (!toolCall || toolCall.type !== "tool-call") return detail

  const result: ToolResultBlock = {
    type: "tool-result",
    id: toolId,
    name: toolCall.name,
    output,
    isError,
    status,
    ...(diff ? { diff } : {})
  }
  const resultIndex = assistant.blocks.findIndex((block) => block.type === "tool-result" && block.id === toolId)
  const blocks: ReadonlyArray<MessageBlock> = resultIndex < 0
    ? [...assistant.blocks, result]
    : assistant.blocks.map((block, blockIndex) => blockIndex === resultIndex ? result : block)

  return {
    ...detail,
    messages: detail.messages.map((message, messageIndex) => messageIndex === assistantIndex ? { ...message, blocks } : message)
  }
}

export const reduceSessionEvent = (
  current: SessionDetail | null,
  activeSessionPath: string | null,
  event: SessionEvent
): SessionDetail | null => {
  if (!activeSessionPath || !("sessionPath" in event) || event.sessionPath !== activeSessionPath) return current

  if (event.type === "session-state") {
    return event.detail.summary.path === activeSessionPath ? event.detail : current
  }
  if (!current || current.summary.path !== activeSessionPath) return current

  if (event.type === "queue-update") return { ...current, queuedMessages: event.messages }
  if (event.type === "user-message") {
    return current.messages.some((message) => message.id === event.message.id)
      ? current
      : { ...current, messages: [...current.messages, event.message] }
  }
  if (event.type === "assistant-start") return startAssistantMessage(current, event.messageId, event.timestamp)
  if (event.type === "text-delta") return appendTextDelta(current, event.messageId, event.delta)
  if (event.type === "tool-start") return addToolCall(current, event)
  if (event.type === "tool-update") return upsertToolResult(current, event.toolId, event.output, "running", false)
  if (event.type === "tool-end") {
    return upsertToolResult(current, event.toolId, event.output, event.isError ? "error" : "success", event.isError, event.diff)
  }
  if (event.type === "compaction-status") return { ...current, isCompacting: event.isCompacting }
  if (event.type === "context-usage") return { ...current, contextUsage: event.contextUsage }
  if (event.type === "background-processes") return { ...current, backgroundProcesses: event.processes }
  if (event.type === "agent-status") return { ...current, isStreaming: event.isStreaming }
  return current
}
