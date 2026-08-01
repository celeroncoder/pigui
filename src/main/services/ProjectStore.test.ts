import { describe, expect, it } from "vitest"
import type { Project } from "../../shared/contracts"

describe("Project contract", () => {
  it("keeps stable folder metadata", () => {
    const project: Project = { id: "abc", name: "demo", path: "/tmp/demo", addedAt: 1 }
    expect(project.name).toBe("demo")
    expect(project.path).toContain(project.name)
  })
})
