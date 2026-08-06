# Renderer styling architecture

## Decision: CSS Modules, migrated incrementally

Use CSS Modules for component-owned renderer styles and retain `src/renderer/src/styles.css` as the deliberately limited global foundation. The Background Processes pane, Git Diff pane, and context-usage controls demonstrate the approach: each owns a co-located module, with no visual or behavioral change intended during migration.

### Why CSS Modules fit Pi Desktop

- The renderer is a compact Electron/Vite/React application with semantic component markup and a carefully authored graphite visual language. CSS Modules scope that existing CSS without converting dense controls into long utility strings.
- Vite supports `.module.css` with no new configuration or dependencies. `src/renderer/src/css.d.ts` gives imported class maps a typed shape.
- The 500-line stylesheet already uses CSS layers, native custom properties, selectors for structured controls, and seven shared keyframe animations. Modules preserve these tools, so migration can be one component at a time with small, visually reviewable diffs.

Tailwind is technically compatible with the renderer. For current Tailwind v4, the recommended Vite integration would add `tailwindcss` and `@tailwindcss/vite`, then add `tailwindcss()` to the renderer plugins in `electron.vite.config.ts`; its PostCSS alternative also needs `@tailwindcss/postcss`, a direct `postcss` dependency, and `postcss.config.mjs`. It would introduce a second styling vocabulary and still need bespoke CSS for the application’s tokens, desktop drag regions, dense grid layouts, masked gradients, custom scrollbar, and shared animations. Do not add those dependencies or configuration unless the product later chooses a utility-first rewrite deliberately. See the [Tailwind Vite installation guide](https://tailwindcss.com/docs/installation/using-vite) and [PostCSS installation guide](https://tailwindcss.com/docs/installation/using-postcss).

## Global versus component-owned styles

Keep these in `styles.css`:

- reset/base element rules, root typography, and browser-wide `:focus-visible`, selection, and scrollbar treatment;
- theme tokens and font variables in `:root`;
- application-shell and cross-component layout rules, including responsive workspace grids and Electron drag regions;
- shared animation definitions and the global reduced-motion override.

Co-locate styles that belong to one component’s DOM tree: its root, descendants, interaction states, variants, icon treatment, and empty/loading states. A module may append to the existing `layout` or `components` layer, as the proof of concept does, so cascade ordering remains predictable.

When a parent changes a child’s layout (for example, `.workspace-layout.with-subagents .composer-caption`), keep that rule global until the relationship is expressed as an explicit component prop. Do not use a module to reach into another component.

## Incremental migration plan

1. Move leaf components with self-contained markup first: `BackgroundProcessesPane`, `GitDiffPane`, `ContextUsageDonut`, and `DitherProgressBar` are complete; next are `Inspector`, `ImageAttachmentCard`, and `ActivityGroup`.
2. Move medium-sized component families in reviewable commits: `ProjectSidebar`, `AskUserPanel`, `SubagentPane`, and `Composer`. Keep shared controls separate until their ownership is clear.
3. Move message rendering and `App` last. First replace cross-component descendant selectors with props or local wrapper classes, then co-locate their CSS.
4. Delete each global block only in the same change that introduces its module. Preserve selectors and declarations initially; refactoring names or visual values is a separate change.
5. For every migration, run typecheck, tests, build, and a focused renderer comparison at the relevant pane/state. Check keyboard focus, disabled/hover states, narrow layouts, and `prefers-reduced-motion` before accepting a visual change.

## Naming and shared-style rules

- Use `ComponentName.module.css` beside `ComponentName.tsx`; import it as `styles`.
- Prefer semantic local keys such as `root`, `header`, `trigger`, `empty`, and state keys such as `running` or `open`. Combine them from the component rather than depending on global class-name strings.
- Use the existing `var(--token)` values rather than copying color, typography, and spacing constants. Promote a value to a global token only when at least two independent components need the same semantic value.
- Keep reusable behavior-oriented primitives small and explicit. A future shared `Button.module.css` or `StatusChip.module.css` is appropriate only after repeated, compatible use; do not create a generic utility layer preemptively.
