---
name: pi-desktop-development
description: Develop, debug, review, and validate the Pi Desktop Electron application in this repository. Use for any task involving Pi sessions or events, Effect services, Electron IPC, React renderer state, queues, attachments, ask_user, background terminals, Git context, responsive UI, browser review, testing, or release preparation.
compatibility: Requires Node.js 22.19+, npm, Git, and the repository-local Pi and Effect dependencies.
---

# Pi Desktop Development

Use this workflow for all engineering work in this repository.

## 1. Establish context before editing

1. Read `AGENTS.md`, `README.md`, and `package.json`.
2. Check `git status --short --branch` and recent commits.
3. Confirm `.repos/effect` exists. If it does not, stop and follow the repository's Effect setup process rather than improvising.
4. Search for the existing implementation and tests before creating a new abstraction.
5. Read the relevant Pi SDK declarations or documentation when behavior depends on Pi lifecycle, events, extensions, session history, queueing, images, or models. Do not guess SDK behavior.
6. If the task corresponds to a GitHub issue, inspect it with `gh issue view` and preserve its acceptance criteria.

Prefer focused file discovery and one or two content searches, then read the most relevant files. Avoid broad repeated searches.

## 2. Preserve the architecture

### Pi ownership

Electron main owns all live `AgentSession`, `AgentSessionRuntime`, and `SessionManager` objects. Renderer code receives only DTOs and event projections.

All application data must come from Pi APIs, session JSONL, or Pi runtime events:

- projects may be persisted by the app, but session identity and content come from Pi
- sessions and messages come from Pi
- model and effort choices come from Pi
- tool and activity data come from Pi
- prompt queues use Pi's native `followUp`, `steer`, and queue APIs
- background terminals come from the installed Pi extension's events/results
- extension interactions must settle the extension-owned promise rather than fabricating tool results

Never ship hardcoded session, model, message, tool, effort, or process fixtures in production. Browser fixtures must be freshly generated, ignored, and Pi-backed.

### Effect backend

Backend application workflows use Effect.

- Model dependencies as services and layers.
- Use schema-backed typed errors for expected failures.
- Use `Effect.fn` for reusable business workflows.
- Decode external and IPC inputs with Schema at the boundary.
- Keep one managed runtime boundary in Electron main.
- Preserve interrupt semantics during shutdown; do not surface expected cancellation as an application error.
- Use Effect concurrency primitives for lifecycle and mutation serialization instead of ad hoc promise locks.
- Consult existing service patterns and the vendored Effect source under `.repos/effect` before introducing a new pattern.

Do not use `any`, unsafe casts, renderer-side Node access, or unvalidated IPC payloads.

### Electron boundary

- Keep `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`.
- Keep preload narrow and serialization-safe.
- Add shared contract/schema changes before wiring main, preload, and renderer.
- Validate project/session ownership with canonical paths in main.
- Guard async renderer responses with active project/session IDs or request generations.
- Treat session switching, prompt startup, queue mutation, abort, and runtime disposal as race-prone lifecycle operations.

### Live state and history

Pi's persisted history and live events are complementary:

- full transcript reconstruction comes from the active JSONL branch
- current streaming activity comes from Pi runtime subscriptions
- final snapshots reconcile live state with persisted history

When changing event handling, verify tool start, update, end, assistant deltas, queue changes, compaction, background processes, and snapshots appear live without requiring refresh. Ensure the final snapshot neither duplicates nor erases live activity.

## 3. UI and interaction conventions

Maintain the compact graphite workbench aesthetic.

- DM Sans is the content font.
- Michroma is selective display/interface typography.
- JetBrains Mono is for technical metadata.
- Use Lucide React icons.
- Keep controls restrained and beveled rather than badge-heavy or ornamental.
- Match new header controls to the existing Subagents and Background Processes controls.
- Preserve WCAG-readable text and control contrast.
- Keep application chrome non-selectable; messages and composer text remain selectable.
- Keep copy actions explicit for tool output and other technical content.
- Use safe HTTPS-only Markdown links and images.
- Keep composer growth bounded and all picker menus dismissible by selection, outside click, and Escape.
- Preserve native macOS window controls; never render fake traffic lights.
- Test the main layout both with and without a right split. Grid children must use `minmax(0, 1fr)`/`min-width: 0` where necessary to prevent hidden controls.

For attachments:

- validate bytes and MIME by content in main
- persist pasted images in the app-owned attachment directory
- render local paths through data URLs, never unrestricted `file://` access
- use Pi's image conversion/resizing path before provider submission
- keep preview removal and lightbox cancellation keyboard-accessible

For queues:

- use Pi-native queue APIs
- preserve stable UI identity across native queue updates, including duplicate text
- preserve image payload identity when queued messages move or drain
- do not pretend unsupported attachment edits are safe; disable them with a clear explanation

## 4. Parallel work and subagents

Use delegation when a task contains multiple independent, substantial workstreams. Do not delegate trivial edits.

1. Inspect available models before choosing a subagent model.
2. Prefer the strongest suitable coding/reasoning models; use Luna or Terra at `xhigh`/`max` when available and justified.
3. Give every subagent a complete, self-contained prompt with constraints, file paths, ownership boundaries, tests, and required report format.
4. Use one isolated Git worktree per implementation subagent under `.worktrees/`.
5. Assign non-overlapping areas where possible.
6. Require subagents to validate and commit their branch; the orchestrating agent reviews and integrates.
7. Continue independent integration work while subagents run.
8. Use status checks rather than blocking shell sleeps. Use an explicit subagent wait only when the result is required to proceed.
9. After integration, run a separate read-only audit for cross-feature races and data loss when the change is large.
10. Remove worktrees and temporary branches after successful integration.

The orchestrating agent owns conflict resolution, cross-feature semantics, final validation, and the push.

## 5. Implementation loop

Use small, verifiable increments:

1. Add or update shared schemas/contracts.
2. Implement or update the Effect service/domain logic.
3. Wire validated IPC in main.
4. Expose the narrow preload method.
5. Update renderer state/event reconciliation.
6. Implement the UI surface and responsive styles.
7. Add focused regression tests for parsers, reconciliation, races, and typed services.
8. Run typecheck/tests before integrating another large branch.

When resolving cherry-pick conflicts, combine behavior deliberately. Do not choose one side wholesale when both branches added contract fields, IPC methods, event variants, or renderer state.

After merging parallel features, specifically audit:

- argument order across contract, preload, IPC, and service
- session lifecycle and stale-response races
- optimistic versus runtime-emitted message duplication
- queue identity and attachment preservation
- snapshot replacement of live state
- pending extension interaction recovery
- right-pane responsive clipping
- background-process terminal settlement
- Git refresh generations

## 6. Validation workflow

### Automated validation

Run:

```bash
npm run typecheck
npm run test
npm run build
```

For fixture/schema changes also run:

```bash
npm run e2e:fixture
```

Use:

```bash
PI_E2E_ASK_USER=1 npm run e2e:fixture
```

when the interaction fixture is relevant.

Treat a build as incomplete if tests or typecheck have not also passed. Run `git diff --check` before committing.

### Browser review

For renderer changes:

1. Start `npm run e2e:serve` as a background process.
2. Use any browser automation tool available in the current environment. Examples include a browser MCP server, Playwright, CDP automation, or another installed browser-driving tool; no specific provider is required.
3. Review at representative large and compact viewport sizes.
4. Exercise the changed interaction, not only the initial screenshot.
5. Inspect accessibility roles/names and keyboard behavior.
6. Check browser console errors and relevant network failures.
7. Verify right splits, queue controls, preview rail, menus, dialogs, and composer bounds as applicable.
8. Save temporary screenshots, traces, and review output only under `.dev-artifacts/`. They are disposable evidence for the current task and must not be committed.

The generated `.e2e-public/` fixture and `.dev-artifacts/` output are review-only and must remain ignored and be deleted during cleanup.

### Electron review

When changing preload, IPC, Electron lifecycle, local files, native chrome, or production-only behavior:

1. Build first.
2. Launch `out/main/index.js` with Electron, using GPU-disabled mode if the environment requires it.
3. Use any available Electron or CDP automation path to inspect the production page.
4. Confirm the page loads from `out/renderer/index.html`.
5. Confirm `window.piDesktop` is available.
6. Check for runtime exceptions and main-process errors.
7. Verify no fake traffic-light elements exist.
8. Exercise the changed native/preload operation when safe.
9. Shut down and confirm expected Effect interruption is not reported as an application failure.

## 7. Process discipline

- Use background processes for dev servers, Electron smoke sessions, watchers, and optional `caffeinate` during long work.
- Never use blocking `sleep` commands merely to wait for another agent or server.
- Track the IDs of every background server, Electron instance, watcher, subagent, and keep-awake process started during the task.
- Stop or cancel all of them before staging changes; verify no task-owned process remains running.
- Put all temporary screenshots, videos, traces, logs, CDP output, and visual-review files in `.dev-artifacts/`, never in source directories.
- Run `.agents/skills/pi-desktop-development/scripts/cleanup-dev.sh` after validation. It removes ignored fixtures/review output and prunes worktree metadata.
- Remove delegated worktrees and temporary branches after integration.
- Keep `.mcp.json` and other local credential/config files untracked.
- Do not alter generated `out/` or `.e2e-public/` files directly as source changes.
- Do not hide an upstream dependency advisory with unrelated overrides; document it and upgrade the owning dependency when a fixed release exists.

## 8. Git and delivery

Before committing:

1. Stop task-owned background processes and remove delegated worktrees.
2. Run the cleanup helper.
3. Inspect the working tree.
4. Stage only intended source, tests, configuration, and documentation by explicit path.
5. Run the staged-file guard and inspect the staged diff.

```bash
.agents/skills/pi-desktop-development/scripts/cleanup-dev.sh
git status --short
git diff --check
git add <explicit-source-paths>
.agents/skills/pi-desktop-development/scripts/check-staged.sh
git diff --cached --stat
git diff --cached --check
```

Never use `git add .` or `git add -A` in this repository. Never commit screenshots, browser traces, generated fixtures, build output, logs, local MCP configuration, vendored Effect setup, temporary worktrees, or other development artifacts. If a staged path is surprising, stop and unstage it before proceeding.

Use focused commit messages that explain the behavior. Push only when requested. When asked to create or manage repository issues, use `gh` and include a clear problem statement, desired behavior, investigation notes where useful, and testable acceptance criteria.

In the final report, include:

- what changed
- validation performed and test counts
- browser/Electron review performed (without committing temporary evidence)
- commit and push status when applicable
- remaining upstream or intentionally deferred issues
