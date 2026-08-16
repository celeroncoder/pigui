import { describe, expect, it } from "vitest"
import type { PiCommand } from "../../../shared/contracts"
import { commandQuery, filterPiCommands, piCommandText } from "./promptTemplates"

const commands: ReadonlyArray<PiCommand> = [
  { kind: "prompt", name: "review", description: "Review a change", argumentHint: "[focus]", scope: "project" },
  { kind: "skill", name: "release", description: "Prepare a release", scope: "user" }
]

describe("Pi command helpers", () => {
  it("recognizes slash commands and dollar-prefixed skill queries", () => {
    expect(commandQuery("/")).toEqual({ query: "" })
    expect(commandQuery("/rev")).toEqual({ query: "rev" })
    expect(commandQuery("/skill:rel")).toEqual({ query: "rel", kind: "skill" })
    expect(commandQuery("$rel")).toEqual({ query: "rel", kind: "skill" })
    expect(commandQuery("/review auth")).toBeNull()
    expect(commandQuery("Please /review")).toBeNull()
  })

  it("filters executable Pi commands without changing their invocation", () => {
    expect(filterPiCommands(commands, { query: "rel" }).map((command) => command.name)).toEqual(["release"])
    expect(piCommandText(commands[0]!)).toBe("/review ")
    expect(piCommandText(commands[1]!)).toBe("/skill:release ")
  })

  it("keeps only the command that Pi resolves when invocations collide", () => {
    const collisions: ReadonlyArray<PiCommand> = [
      { kind: "skill", name: "review", description: "Personal review skill", scope: "user" },
      { kind: "prompt", name: "skill:review", description: "Colliding prompt", scope: "project" },
      { kind: "prompt", name: "ship", description: "Prepare a release", scope: "project" }
    ]

    expect(filterPiCommands(collisions, { query: "" })).toEqual([collisions[0], collisions[2]])
  })
})
