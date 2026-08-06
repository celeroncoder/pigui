import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Project } from "../../../shared/contracts"
import { ProjectSidebar } from "./ProjectSidebar"

const project = (id: string, name: string): Project => ({ id, name, path: `/workspace/${id}`, addedAt: 1 })

describe("project sidebar session actions", () => {
  it("renders the expanded project's scoped new-session action", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const createdFor: Project[] = []
    const markup = renderToStaticMarkup(createElement(ProjectSidebar, {
      projects: [alpha, beta],
      sessionsByProjectId: {},
      activeProject: alpha,
      activeSessionPath: null,
      loadingProjectId: null,
      onSelectProject: () => undefined,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: (selected) => createdFor.push(selected)
    }))

    expect(markup).toContain('aria-label="New session in Alpha"')
    expect(markup).not.toContain('aria-label="New session in Beta"')
    expect(createdFor).toEqual([])
  })

  it("marks the active project and keeps the shortcut hint scoped to it", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const markup = renderToStaticMarkup(createElement(ProjectSidebar, {
      projects: [alpha, beta],
      sessionsByProjectId: {},
      activeProject: alpha,
      activeSessionPath: null,
      loadingProjectId: null,
      onSelectProject: () => undefined,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: () => undefined
    }))

    expect(markup).toContain('class="project-row active"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain("<kbd>⌘N</kbd>")
  })
})
