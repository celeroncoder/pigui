import { describe, expect, it } from "vitest"
import { isProjectExpanded, preserveProjectExpansionOnSelection, toggleProjectExpansion } from "./projectSidebarState"

describe("project sidebar expansion", () => {
  it("toggles the active project without changing the existing state", () => {
    const expansionState = new Map<string, boolean>([["other", true]])

    const next = toggleProjectExpansion(expansionState, "active", "active")

    expect(next).toEqual(new Map([["other", true], ["active", false]]))
    expect(expansionState).toEqual(new Map([["other", true]]))
    expect(isProjectExpanded("active", "active", next)).toBe(false)

    const expanded = toggleProjectExpansion(next, "active", "active")
    expect(expanded).toEqual(new Map([["other", true], ["active", true]]))
    expect(isProjectExpanded("active", "active", expanded)).toBe(true)
  })

  it("keeps the previous project expanded when selection moves to another project", () => {
    const selected = preserveProjectExpansionOnSelection(new Map<string, boolean>(), "project-a", "project-b")

    expect(isProjectExpanded("project-a", "project-a", selected)).toBe(true)
    expect(isProjectExpanded("project-b", "project-b", selected)).toBe(true)
  })

  it("does not reopen a project that was explicitly collapsed", () => {
    const collapsed = new Map<string, boolean>([["project-a", false]])
    const selected = preserveProjectExpansionOnSelection(collapsed, "project-a", "project-b")

    expect(isProjectExpanded("project-a", "project-a", selected)).toBe(false)
    expect(isProjectExpanded("project-b", "project-b", selected)).toBe(true)
  })
})
