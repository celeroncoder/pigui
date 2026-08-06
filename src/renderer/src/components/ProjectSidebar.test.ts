import { describe, expect, it } from "vitest"
import type { Project } from "../../../shared/contracts"
import { ProjectSidebar } from "./ProjectSidebar"

interface ElementLike {
  readonly type?: unknown
  readonly props?: {
    readonly className?: unknown
    readonly children?: unknown
    readonly [key: string]: unknown
  }
}

const isElement = (value: unknown): value is ElementLike => typeof value === "object" && value !== null

const findElements = (value: unknown, predicate: (element: ElementLike) => boolean): ReadonlyArray<ElementLike> => {
  if (Array.isArray(value)) return value.flatMap((item) => findElements(item, predicate))
  if (!isElement(value)) return []
  const matches = predicate(value) ? [value] : []
  return [...matches, ...findElements(value.props?.children, predicate)]
}

const project = (id: string, name: string): Project => ({ id, name, path: `/workspace/${id}`, addedAt: 1 })

describe("project sidebar session actions", () => {
  it("anchors each new-session action to its own project", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const createdFor: Project[] = []
    const tree = ProjectSidebar({
      projects: [alpha, beta],
      sessions: [],
      activeProject: alpha,
      activeSessionPath: null,
      isLoading: false,
      onSelectProject: () => undefined,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: (selected) => createdFor.push(selected)
    })

    const actions = findElements(tree, (element) => element.props?.className === "project-new-session")
    expect(actions.map((action) => action.props?.["aria-label"])).toEqual([
      "New session in Alpha",
      "New session in Beta"
    ])

    const betaAction = actions[1]
    if (!betaAction) throw new Error("Expected a project-scoped Beta action")
    const onClick = betaAction.props?.onClick
    if (typeof onClick !== "function") throw new Error("Expected Beta action to be clickable")
    onClick()
    expect(createdFor).toEqual([beta])
  })

  it("marks the active project and keeps the shortcut hint scoped to it", () => {
    const alpha = project("alpha", "Alpha")
    const beta = project("beta", "Beta")
    const tree = ProjectSidebar({
      projects: [alpha, beta],
      sessions: [],
      activeProject: alpha,
      activeSessionPath: null,
      isLoading: false,
      onSelectProject: () => undefined,
      onSelectSession: () => undefined,
      onAddProject: () => undefined,
      onNewSession: () => undefined
    })

    const projectRows = findElements(tree, (element) => typeof element.props?.className === "string" && element.props.className.startsWith("project-row"))
    expect(projectRows.map((row) => row.props?.["aria-current"])).toEqual(["page", undefined])

    const shortcutHints = findElements(tree, (element) => element.type === "kbd")
    expect(shortcutHints).toHaveLength(1)
  })
})
