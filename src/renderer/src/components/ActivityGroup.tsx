import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import type { ChatMessage } from "../../../shared/contracts"
import { MessageView } from "./MessageView"
import { ToolGlyph } from "./ToolGlyph"

interface ActivityGroupProps {
  readonly messages: ReadonlyArray<ChatMessage>
  readonly isLive: boolean
  readonly anchorId?: string
}

export function ActivityGroup({ messages, isLive, anchorId }: ActivityGroupProps) {
  const [open, setOpen] = useState(isLive)
  const toolNames = new Set(messages.flatMap((message) => message.blocks.flatMap((block) => block.type === "tool-call" ? [block.name] : [])))
  const toolCallCount = messages.reduce((total, message) => total + message.blocks.filter((block) => block.type === "tool-call").length, 0)
  const thinkingCount = messages.reduce((total, message) => total + message.blocks.filter((block) => block.type === "thinking").length, 0)
  const updateCount = messages.length

  useEffect(() => {
    setOpen(isLive)
  }, [isLive])

  return (
    <section className={`activity-group ${open ? "open" : ""}`} id={anchorId}>
      <button type="button" className="activity-group-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ChevronRight size={14} />
        <span>{toolCallCount > 0
          ? `${toolCallCount} tool ${toolCallCount === 1 ? "call" : "calls"}, ${updateCount} ${updateCount === 1 ? "message" : "messages"}`
          : `${thinkingCount} thinking ${thinkingCount === 1 ? "step" : "steps"}`}</span>
        <div className="activity-group-icons" aria-hidden="true">
          {[...toolNames].slice(0, 5).map((name) => <ToolGlyph name={name} size={14} key={name} />)}
        </div>
      </button>
      {open && (
        <div className="activity-group-content">
          {messages.map((message) => <MessageView message={message} key={message.id} />)}
        </div>
      )}
    </section>
  )
}
