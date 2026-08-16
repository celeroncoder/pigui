# Pi Desktop Agent Guide

This repository is an Electron GUI for the Pi coding agent. For any implementation, bug fix, refactor, UI review, test, or release task, first load and follow:

- `.agents/skills/pi-desktop-development/SKILL.md`

## Non-negotiable architecture

- Pi is the source of truth for sessions, models, effort levels, messages, tools, queues, extensions, and background processes.
- Electron main owns Pi SDK session/runtime objects. Never move Pi SDK ownership into the renderer.
- Backend workflows use Effect services, layers, schemas, typed errors, and the single managed runtime boundary.
- Validate all IPC inputs in main and expose only narrow, serialization-safe APIs through preload.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`.
- Preserve full active-branch history even when Pi compacts model context.
- Treat live event projection and persisted-history reconstruction as two paths that must converge without duplicates or missing activity.

## Repository map

- `src/main/index.ts` — Electron lifecycle, Effect runtime, validated IPC
- `src/main/services/PiSessions.ts` — Pi lifecycle, live events, queueing, extensions, Git/process projection
- `src/main/services/*.ts` — Effect-backed application services
- `src/preload/index.ts` — narrow context bridge
- `src/shared/` — serialization-safe contracts and schemas
- `src/renderer/src/App.tsx` — renderer orchestration and race guards
- `src/renderer/src/components/` — UI surfaces
- `src/renderer/src/styles.css` — global workbench styling
- `scripts/generate-e2e-fixture.mjs` — ignored Pi-backed browser fixture generation

## Required validation

For normal changes, run:

```bash
npm run typecheck
npm run test
npm run build
```

For UI changes, also generate a fresh Pi-backed fixture and review with any available browser automation tool:

```bash
npm run e2e:serve
```

Use `PI_E2E_ASK_USER=1 npm run e2e:serve` when reviewing the `ask_user` surface. Check responsive layouts, interactions, accessibility state, and browser console errors. When Electron-specific behavior changes, smoke-test the production Electron build as well.

## Cleanup, Git, and generated files

- Never commit `.mcp.json`, `.e2e-public/`, `.playwright-mcp/`, `.dev-artifacts/`, `artifacts/`, `out/`, `node_modules/`, `.repos/effect`, `.worktrees/`, logs, screenshots, traces, or generated review fixtures.
- Put temporary screenshots, traces, and browser/Electron review output in `.dev-artifacts/`; it is ignored and disposable.
- Before committing, stop every server, watcher, Electron instance, subagent, and keep-awake process started during the task.
- Run `.agents/skills/pi-desktop-development/scripts/cleanup-dev.sh` after review.
- Stage intended source, test, and documentation files explicitly. Do not use blanket `git add .` or `git add -A`.
- Run `.agents/skills/pi-desktop-development/scripts/check-staged.sh` and inspect `git diff --cached --stat` before committing.
- Keep feature work in focused commits.
- Use isolated worktrees for parallel delegated implementation, then remove them and prune worktree metadata.
- Do not push, publish, or create releases unless the user asks.
