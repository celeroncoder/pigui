import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Project, ProjectMetrics, SessionSummary } from "../../../shared/contracts"
import { HomeDashboard } from "./HomeDashboard"

const project: Project = {
  id: "project-1",
  name: "Pi Desktop",
  addedAt: 1,
  worktrees: [{ id: "local", path: "/code/pi-desktop", name: "Pi Desktop", branch: "main", addedAt: 1, kind: "local" }]
}
const sessions: ReadonlyArray<SessionSummary> = [
  { id: "one", path: "/sessions/one.jsonl", name: "First session", firstMessage: "first", updatedAt: 1, messageCount: 4 },
  { id: "two", path: "/sessions/two.jsonl", name: "Second session", firstMessage: "second", updatedAt: 2, messageCount: 7 }
]
const metrics: ProjectMetrics = {
  generatedAt: 3,
  sessionCount: 2,
  completedSessions: 2,
  successfulSessions: 1,
  failedSessions: 1,
  incompleteSessions: 0,
  successRate: 0.5,
  averageCompletionMs: 65_000,
  tokenUsage: { input: 700, output: 300, cacheRead: 0, cacheWrite: 0, total: 1_000 },
  modelUsage: [{ model: "openai/gpt-5", sessions: 2, input: 700, output: 300, cacheRead: 0, cacheWrite: 0, total: 1_000 }],
  failureReasons: [{ reason: "Rate limit", count: 1 }]
}

describe("HomeDashboard", () => {
  it("renders every project session and uses provider logos for model usage", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        data={[{ project, worktree: project.worktrees[0]!, sessions, metrics, loading: false }]}
        loadingProjects={false}
        onRefresh={() => undefined}
        onAddProject={() => undefined}
        onOpenProject={() => undefined}
        onOpenSession={() => undefined}
      />
    )

    expect(html).toContain("First session")
    expect(html).toContain("Second session")
    expect(html).toContain("50%")
    expect(html).toContain("1m 05s")
    expect(html).toContain("Rate limit")
    expect(html).toContain("Cache read")
    expect(html).toContain("img.logo.dev/openai.com")
    expect(html).toContain("OpenAI logo")
  })
})
