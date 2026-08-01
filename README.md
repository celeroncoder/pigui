# Pi Desktop

A focused Electron workspace for browsing projects and working with existing or new [Pi](https://pi.dev) coding-agent sessions.

## MVP features

- Add local folders as persistent workspaces
- Discover the workspace’s existing Pi JSONL sessions through `SessionManager.list()`
- Create and open persistent Pi sessions
- Stream assistant text, ephemeral current-work status, tool calls, tool output, run state, and final snapshots live
- Collapse each run’s tool activity directly above its final response
- Preserve the complete active-branch transcript across Pi compactions, with structural compacting/compacted separators and no internal summary metadata
- Navigate long transcripts with a compact hover-preview rail
- Render both user and assistant messages as safe HTTPS-only Markdown
- Preview Pi CLI image paths inline, paste validated images, and send them to Pi as native image attachments
- Open securely linked Pi subagent sessions in an on-demand, read-only right split view
- Inspect Pi-managed background terminals in a parallel read-only process pane
- Send, queue, steer, and abort prompts
- Pick from the models currently authenticated and available in Pi, with provider marks loaded from Logo.dev
- Choose the active model’s Pi-supported reasoning effort for the next prompt
- Render installed `ask_user` extension questions inline with 2–5 options and a free-form answer path
- Reuse Pi’s existing credentials, settings, context files, skills, extensions, and tools
- Secure, narrow Electron preload bridge with validated IPC inputs

No session, message, model, or tool data is hardcoded in the application. The Electron main process owns Pi SDK objects and sends renderer-safe DTOs to React. The browser-only review harness generates its ignored fixture directly from the local Pi SDK before each Playwright review.

## Development

Requirements: Node.js 22.19 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm run test
npm run build
```

Browser UI review with a fresh Pi-backed snapshot:

```bash
npm run e2e:serve
```

To include the ask_user interaction preview in the browser fixture (without starting a live Pi call):

```bash
PI_E2E_ASK_USER=1 npm run e2e:serve
```

## Architecture

- `src/main/services/PiSessions.ts` — Pi SDK lifecycle, extension binding, image prompt preparation, queueing, and live event projection
- `src/main/services/AskUserInteraction.ts` — TUI custom-component bridge for the installed `ask_user` extension
- `src/main/services/AttachmentStore.ts` — Effect service for validated app-owned image persistence and previews
- `src/main/services/ProjectStore.ts` — Effect service for persistent workspace metadata
- `src/main/index.ts` — Electron lifecycle and Effect-powered IPC handlers
- `src/preload/index.ts` — context-isolated renderer API
- `src/renderer/src/` — React workbench UI
- `src/shared/contracts.ts` — renderer-safe contracts

The backend uses Effect services, schema-backed errors, layers, and a single managed runtime. The UI uses DM Sans for content, Michroma for selected interface titles, JetBrains Mono for technical data, and Lucide React icons.
