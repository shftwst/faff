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
WORKTREE_PATH="$CWD/.claude/worktrees/${REPO_NAME}--${SAFE_NAME}"
LOG="$CWD/.claude/worktrees/setup.log"

mkdir -p "$CWD/.claude/worktrees"
exec 2>>"$LOG"

echo "$(date '+%H:%M:%S') [worktree] Creating ${REPO_NAME}--${NAME}" >&2

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
