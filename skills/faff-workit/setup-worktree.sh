#!/usr/bin/env bash
set -euo pipefail

# Claude Code WorktreeCreate hook script (ships with the faff skill).
# Receives JSON on stdin: { session_id, transcript_path, cwd, hook_event_name, name }
# Must call `git worktree add` and print the worktree path to stdout on success.

INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$NAME" ] || [ -z "$CWD" ]; then
  exit 1
fi

REPO_NAME=$(basename "$CWD")
SAFE_NAME=$(echo "$NAME" | tr '/' '-')

# Resolve the worktree root (see gateway -> Worktree policy), in precedence order:
#   1. FAFF_WORKTREE_ROOT env override
#   2. .faffrc `worktree_root` key (used as-is — .faffrc is per-repo)
#   3. default ~/.faff/worktrees/<repo>  (writable on host and in repo-only mounts;
#      outside the repo, so it keeps holdout/evaluator work isolated from the build)
WT_ROOT="${FAFF_WORKTREE_ROOT:-}"
if [ -z "$WT_ROOT" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/skills/faff/faff.mjs" ]; then
  WT_ROOT=$( (cd "$CWD" && node "${CLAUDE_PLUGIN_ROOT}/skills/faff/faff.mjs" config get worktree_root -d "") 2>/dev/null || true )
fi
[ -z "$WT_ROOT" ] && WT_ROOT="$HOME/.faff/worktrees/${REPO_NAME}"
WORKTREE_PATH="$WT_ROOT/${SAFE_NAME}"
LOG="$WT_ROOT/setup.log"

mkdir -p "$WT_ROOT"
exec 2>>"$LOG"

echo "$(date '+%H:%M:%S') [worktree] Creating ${WT_ROOT}/${SAFE_NAME}" >&2

cd "$CWD" || exit 1

# Create the worktree on a new branch based on HEAD
git worktree add -b "${SAFE_NAME}" "$WORKTREE_PATH" HEAD >&2 2>&1
cd "$WORKTREE_PATH"

# Copy common gitignored config files from main worktree
for f in .env .env.local .env.development .env.production.local .claude/settings.local.json; do
  if [ -f "$CWD/$f" ]; then
    mkdir -p "$WORKTREE_PATH/$(dirname "$f")"
    cp "$CWD/$f" "$WORKTREE_PATH/$f"
  fi
done

# Skip install when requested — e.g. when running inside a Linux container
# with a macOS bind-mounted worktree, installing would write platform-wrong binaries.
if [ "${SKIP_NPM_PACKAGES_INSTALL:-}" = "1" ]; then
  echo "$(date '+%H:%M:%S') [worktree] SKIP_NPM_PACKAGES_INSTALL=1 — skipping install." >&2
  echo "$WORKTREE_PATH"
  exit 0
fi

# Run project setup if a setup command exists in package.json
if [ -f "$WORKTREE_PATH/package.json" ]; then
  # Detect package manager
  if [ -f "$WORKTREE_PATH/yarn.lock" ] || [ -f "$CWD/yarn.lock" ]; then
    PM="yarn"
  elif [ -f "$WORKTREE_PATH/pnpm-lock.yaml" ] || [ -f "$CWD/pnpm-lock.yaml" ]; then
    PM="pnpm"
  elif [ -f "$WORKTREE_PATH/bun.lockb" ] || [ -f "$CWD/bun.lockb" ]; then
    PM="bun"
  else
    PM="npm"
  fi

  echo "$(date '+%H:%M:%S') [worktree] ${PM} install..." >&2
  $PM install --no-immutable >&2 2>&1 || $PM install >&2 2>&1 || true

  # Run setup script if it exists
  if grep -q '"setup"' "$WORKTREE_PATH/package.json" 2>/dev/null; then
    echo "$(date '+%H:%M:%S') [worktree] ${PM} run setup..." >&2
    $PM run setup >&2 2>&1 || true
  fi
elif [ -f "$WORKTREE_PATH/Makefile" ]; then
  if grep -q '^setup:' "$WORKTREE_PATH/Makefile" 2>/dev/null; then
    echo "$(date '+%H:%M:%S') [worktree] make setup..." >&2
    make -C "$WORKTREE_PATH" setup >&2 2>&1 || true
  fi
fi

echo "$(date '+%H:%M:%S') [worktree] Done." >&2

# Required: print path to stdout
echo "$WORKTREE_PATH"
