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

# Resolve the worktree root via the single canonical resolver (FAFF-382). `faff worktree-root`
# owns the precedence (FAFF_WORKTREE_ROOT env -> .faffrc worktree_root -> ~/.faff/worktrees/<repo>;
# gateway -> Worktree policy), so this hook, the lights-out preflight, and the graft Step-3
# assert never drift. Fall back to the literal default if the binary is unresolvable.
FAFF_BIN=""
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -x "${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff" ]; then
  FAFF_BIN="${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff"
elif command -v faff >/dev/null 2>&1; then
  FAFF_BIN="$(command -v faff)"
fi
WT_ROOT=""
if [ -n "$FAFF_BIN" ]; then
  WT_ROOT=$( (cd "$CWD" && "$FAFF_BIN" worktree-root --root "$CWD") 2>/dev/null || true )
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

# Copy common gitignored config files from main worktree. .faffrc.yaml is per-repo faff config
# (slots, appetite, adversarial backend) the build needs; without it `faff config` resolves to
# defaults and the build silently ignores the repo's config (FAFF-186). Canonical name only — the
# resolver errors loudly on legacy .faffrc / .faffrc.yml, so copying those would break the worktree.
for f in .env .env.local .env.development .env.production.local .claude/settings.local.json .faffrc.yaml; do
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
