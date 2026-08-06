#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

rm -rf \
  .dev-artifacts \
  .e2e-public \
  .playwright-mcp \
  artifacts/dev

git worktree prune
rmdir .worktrees 2>/dev/null || true

printf 'Removed ignored review fixtures, traces, and temporary development artifacts.\n'
printf 'Background servers, Electron processes, subagents, and keep-awake processes must be stopped through the tool that started them.\n'
