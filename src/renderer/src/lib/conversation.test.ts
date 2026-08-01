import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../../shared/contracts"
import { buildConversationItems, latestTransientStatus } from "./conversation"

const message = (id: string, role: ChatMessage["role"], blocks: ChatMessage["blocks"]): ChatMessage => ({ id, role, blocks, timestamp: 1 })

describe("conversation presentation", () => {
  it("places a collapsed activity group before the final agent response", () => {
    const items = buildConversationItems([
      message("user", "user", [{ type: "text", text: "Fix it" }]),
      message("tools", "assistant", [
        { type: "tool-call", id: "call-1", name: "read", input: "{}" },
        { type: "tool-result", id: "call-1", name: "read", output: "ok", isError: false }
      ]),
      message("answer", "assistant", [{ type: "text", text: "Fixed." }])
    ])

    expect(items.map((item) => item.type)).toEqual(["message", "activity", "message"])
    expect(items[2]?.type === "message" ? items[2].message.id : null).toBe("answer")
  })

  it("keeps compaction markers in chronological message history", () => {
    const items = buildConversationItems([
      message("before", "assistant", [{ type: "text", text: "Earlier answer" }]),
      message("compact", "system", [{ type: "compaction", status: "compacted" }]),
      message("after", "user", [{ type: "text", text: "Continue" }])
    ])

    expect(items.map((item) => item.id)).toEqual(["before", "compact", "after"])
  })

  it("keeps only the latest streamed status line", () => {
    expect(latestTransientStatus("**Designing the UI**\n\n**Parsing subagent sessions**")).toBe("Parsing subagent sessions")
  })
})
