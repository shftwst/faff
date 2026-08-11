#!/usr/bin/env bash
#
# setup-git-hooks.sh
#
# Point this repo's core.hooksPath at the tracked .githooks/ dir, so the
# prepare-commit-msg hook adds the DCO Signed-off-by trailer the `dco` check
# requires on every commit. One repo-scoped git config write, shared by all
# linked worktrees; the value is relative, so it resolves against each
# worktree's own .githooks/ checkout.
#
# Reused by two callers so the activation lives in one place:
#   - scripts/link-skills.sh, during contributor setup;
#   - the CI runner's provisioning, so runner- and agent-authored commits are
#     signed off the same way a human's are.
#
# Idempotent and safe to re-run. A no-op (exit 0) outside a git repo or when
# .githooks/ is absent, so a provisioner can call it unconditionally.
#
# Usage:
#   bash scripts/setup-git-hooks.sh
#   bash scripts/setup-git-hooks.sh --dry-run   # report the intended change, write nothing

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
	case "$arg" in
		--dry|--dry-run) DRY_RUN=1 ;;
		-h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown arg: $arg" >&2; exit 2 ;;
	esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$REPO_ROOT/.githooks" ]; then
	echo "setup-git-hooks: no .githooks/ at $REPO_ROOT, nothing to activate." >&2
	exit 0
fi
if ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
	echo "setup-git-hooks: $REPO_ROOT is not a git repository; skipping." >&2
	exit 0
fi

current="$(git -C "$REPO_ROOT" config --local --get core.hooksPath 2>/dev/null || true)"
if [ "$current" = ".githooks" ]; then
	echo "Git hooks: core.hooksPath already → .githooks (DCO sign-off auto-added on commit)"
	exit 0
fi
if [ "$DRY_RUN" -eq 1 ]; then
	echo "Git hooks: would set core.hooksPath → .githooks (currently: ${current:-unset})"
	exit 0
fi

git -C "$REPO_ROOT" config --local core.hooksPath .githooks
echo "Git hooks: set core.hooksPath → .githooks (DCO sign-off auto-added on commit)"
