#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

staged="$(git diff --cached --name-only --diff-filter=ACMR)"
if [[ -z "$staged" ]]; then
  printf 'No staged files.\n'
  exit 0
fi

blocked="$(printf '%s\n' "$staged" | grep -E '(^|/)(\.mcp\.json|\.e2e-public|\.playwright-mcp|\.dev-artifacts|\.worktrees|node_modules|out|dist|\.repos)(/|$)|(^|/)artifacts/|\.log$' || true)"
if [[ -n "$blocked" ]]; then
  printf 'Refusing commit: staged development/generated artifacts detected:\n%s\n' "$blocked" >&2
  printf 'Unstage them, clean the workspace, and stage source files explicitly.\n' >&2
  exit 1
fi

printf 'Staged file scope contains no known development artifacts.\n'
