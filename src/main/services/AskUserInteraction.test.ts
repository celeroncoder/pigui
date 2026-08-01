import { describe, expect, it } from "vitest"
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent"
import type { Component, TUI } from "@earendil-works/pi-tui"
import type { AskUserInteractionRequest } from "../../shared/interaction"
import { AskUserInteractionBridge } from "./AskUserInteraction"

type SelectionResult =
  | { readonly kind: "option"; readonly answer: string }
  | { readonly kind: "custom"; readonly answer: string }
  | { readonly kind: "dismissed" }

const request = (requestId: string): AskUserInteractionRequest => ({
  requestId,
  toolCallId: requestId,
  question: "Where should the change go?",
  options: [
    { label: "The renderer", description: "Keep presentation in React" },
    { label: "The main process", description: "Keep lifecycle work in Electron" }
  ]
})

const makeSelectionFactory = (
  done: (result: SelectionResult) => void
): Component => {
  let mode: "options" | "custom" = "options"
  let value = ""
  return {
    render: () => [],
    invalidate: () => undefined,
    handleInput: (data: string) => {
      if (data === "1") {
        done({ kind: "option", answer: "The renderer" })
        return
      }
      if (data === "3") {
        mode = "custom"
        return
      }
      if (data === "\x1b") {
        done({ kind: "dismissed" })
        return
      }
      if (data === "\r" && mode === "custom") {
        done({ kind: "custom", answer: value })
        return
      }
      if (mode === "custom") value += data
    }
  }
}

const selectionFactory = (
  _tui: TUI,
  _theme: Theme,
  _keybindings: KeybindingsManager,
  done: (result: SelectionResult) => void
): Component => makeSelectionFactory(done)

describe("AskUserInteractionBridge", () => {
  it("replays a selected option through Pi's custom component callback", async () => {
    const requests: AskUserInteractionRequest[] = []
    const cleared: string[] = []
    const bridge = new AskUserInteractionBridge({
      sessionPath: "/tmp/session.jsonl",
      onRequest: (next) => requests.push(next),
      onClear: (requestId) => cleared.push(requestId)
    })

    bridge.register(request("call-1"))
    const waiting = bridge.uiContext.custom<SelectionResult>(selectionFactory)
    bridge.answer("call-1", { kind: "option", optionIndex: 0 })

    await expect(waiting).resolves.toEqual({ kind: "option", answer: "The renderer" })
    expect(requests).toHaveLength(1)
    expect(cleared).toEqual(["call-1"])
  })

  it("delivers free-form answers and keeps only one visible question", async () => {
    const requests: AskUserInteractionRequest[] = []
    const bridge = new AskUserInteractionBridge({
      sessionPath: "/tmp/session.jsonl",
      onRequest: (next) => requests.push(next),
      onClear: () => undefined
    })

    bridge.register(request("call-1"))
    bridge.register(request("call-2"))
    const first = bridge.uiContext.custom<SelectionResult>(selectionFactory)
    const second = bridge.uiContext.custom<SelectionResult>(selectionFactory)
    bridge.answer("call-1", { kind: "custom", answer: "A new inline surface" })

    await expect(first).resolves.toEqual({ kind: "custom", answer: "A new inline surface" })
    await expect(second).rejects.toMatchObject({ reason: "busy" })
    expect(requests.map((item) => item.requestId)).toEqual(["call-1"])
  })

  it("settles pending UI on cancellation, early completion, and disposal", async () => {
    const cleared: string[] = []
    const bridge = new AskUserInteractionBridge({
      sessionPath: "/tmp/session.jsonl",
      onRequest: () => undefined,
      onClear: (requestId) => cleared.push(requestId)
    })

    bridge.register(request("call-1"))
    const cancelled = bridge.uiContext.custom<SelectionResult>(selectionFactory)
    bridge.cancelPending()
    await expect(cancelled).resolves.toEqual({ kind: "dismissed" })

    bridge.register(request("call-2"))
    bridge.finishTool("call-2")
    expect(cleared).toContain("call-2")

    bridge.register(request("call-3"))
    const disposed = bridge.uiContext.custom<SelectionResult>(async () => new Promise<Component>(() => undefined))
    bridge.dispose()
    await expect(disposed).rejects.toMatchObject({ reason: "disposed" })
  })
})
