import { Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AskUserInputSchema, AskUserInteractionAnswerSchema } from "./interaction"

const input = (options: ReadonlyArray<{ readonly label: string }>) => ({
  question: "Pick one",
  options
})

describe("ask_user interaction schemas", () => {
  it("accepts the installed tool's two-to-five option contract", () => {
    const decoded = Schema.decodeUnknownExit(AskUserInputSchema)(input([{ label: "A" }, { label: "B" }]))
    expect(Exit.isSuccess(decoded)).toBe(true)
  })

  it("rejects option counts outside the installed tool contract", () => {
    const tooFew = Schema.decodeUnknownExit(AskUserInputSchema)(input([{ label: "A" }]))
    const tooMany = Schema.decodeUnknownExit(AskUserInputSchema)(input([
      { label: "A" },
      { label: "B" },
      { label: "C" },
      { label: "D" },
      { label: "E" },
      { label: "F" }
    ]))
    expect(Exit.isFailure(tooFew)).toBe(true)
    expect(Exit.isFailure(tooMany)).toBe(true)
  })

  it("keeps cancellation and free-form answers typed", () => {
    const cancelled = Schema.decodeUnknownExit(AskUserInteractionAnswerSchema)({ kind: "dismissed" })
    const custom = Schema.decodeUnknownExit(AskUserInteractionAnswerSchema)({ kind: "custom", answer: "Something else" })
    expect(Exit.isSuccess(cancelled)).toBe(true)
    expect(Exit.isSuccess(custom)).toBe(true)
  })
})
