import { describe, expect, it } from "vitest"
import { isProjectExpanded, toggleProjectCollapse } from "./projectSidebarState"

describe("project sidebar expansion", () => {
  it("toggles the active project without changing the existing set", () => {
    const collapsed = new Set(["other"])

    const next = toggleProjectCollapse(collapsed, "active")

    expect(next).toEqual(new Set(["other", "active"]))
    expect(collapsed).toEqual(new Set(["other"]))
    expect(isProjectExpanded("active", "active", next)).toBe(false)

    const expanded = toggleProjectCollapse(next, "active")
    expect(expanded).toEqual(new Set(["other"]))
    expect(isProjectExpanded("active", "active", expanded)).toBe(true)
  })

  it("keeps a project collapsed when selection moves away and back", () => {
    const collapsed = toggleProjectCollapse(new Set<string>(), "project-a")

    expect(isProjectExpanded("project-b", "project-b", collapsed)).toBe(true)
    expect(isProjectExpanded("project-a", "project-a", collapsed)).toBe(false)
  })
})
