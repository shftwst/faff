#!/usr/bin/env bash
set -euo pipefail

# Build-worktree provisioning script (ships with the faff skill). Two input modes, one shared body:
#   Direct:  setup-worktree.sh <name> [<repo-root>]   — name from $1, repo root from $2 (else pwd).
#            No stdin is read; jq is never invoked. This is how the faff-graft skill step calls it.
#   Hook:    setup-worktree.sh                         — zero args: read Claude Code WorktreeCreate
#            JSON on stdin ({ session_id, transcript_path, cwd, hook_event_name, name }) and parse
#            .name / .cwd with jq. Byte-compatible with the legacy hook contract.
# Either way: call `git worktree add` and print the worktree path to stdout on success.

if [ "$#" -ge 1 ]; then
  # Direct mode — positional args; never touch stdin, never call jq.
  NAME="$1"
  CWD="${2:-$(pwd)}"
else
  # Hook mode — JSON on stdin, parsed with jq (Claude Code guarantees the shape).
  INPUT=$(cat)
  NAME=$(printf '%s' "$INPUT" | jq -r '.name // empty')
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
fi

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
# defaults and the build silently ignores the repo's config (FAFF-186). .faffrc.local.yaml is the
# gitignored machine-local overlay (FAFF-387) — copied too so a linked worktree resolves the same
# merged config as the main checkout (both are still covered by the FAFF-208 fallback per-file).
# Keep .faffrc.yaml in the list: an unmigrated repo still keeps it gitignored, so a worktree needs
# the copy. Canonical names only — the resolver errors loudly on legacy .faffrc / .faffrc.yml, so
# copying those would break the worktree.
#
# FAFF-532: copy ONLY files git does not track. `git worktree add` already materialises every
# TRACKED path at the worktree's own ref, so a tracked .faffrc.yaml (a migrated repo — faff itself)
# is correct the moment the worktree exists; copying $CWD's version over it would clobber the good
# own-ref content with the invoking checkout's possibly-divergent copy (sharpest under the parallel
# executor, where $CWD and the branch base diverge mid-wave). The per-file `git ls-files
# --error-unmatch` test — run in the worktree (cwd is $WORKTREE_PATH since line 46), never $CWD —
# self-corrects across repo states: tracked (migrated) => skip; untracked overlay / gitignored
# .faffrc.yaml in an unmigrated adopter repo => still copied (FAFF-186/FAFF-387 intent preserved).
# The tracked-test is the right question, not a gitignore-listing check: the overlay
# .faffrc.local.yaml is untracked yet need not appear in .gitignore, so a gitignore-based guard
# would wrongly drop it.
for f in .env .env.local .env.development .env.production.local .claude/settings.local.json .faffrc.yaml .faffrc.local.yaml; do
  if [ -f "$CWD/$f" ]; then
    # Skip any path the worktree already tracks — git put the correct own-ref content there.
    # Both streams suppressed; only the exit code is consulted, so a tracked-but-locally-modified
    # file still reports tracked (exit 0) and is skipped. The `if` test keeps `set -e` from
    # tripping on the non-tracked (exit-1) case.
    if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
      echo "$(date '+%H:%M:%S') [worktree] skip $f — tracked at worktree ref, keeping checked-out copy" >&2
      continue
    fi
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
