import { describe, expect, it } from "vitest"
import { projectToolOutput } from "./PiEventProjection"

describe("Pi event projection", () => {
  it("projects progressive and final tool results like persisted transcript content", () => {
    expect(projectToolOutput({
      content: [{ type: "text", text: "first line\nsecond line" }],
      details: { fullOutputPath: "/tmp/output" }
    })).toBe("first line\nsecond line")

    expect(projectToolOutput({
      content: [{ type: "text", text: "2 tests passed" }],
      details: { exitCode: 0 }
    })).toBe("2 tests passed")
  })
})
