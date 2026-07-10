#!/usr/bin/env bash
#
# link-skills.sh
#
# Symlink every skill in skills/ into a .claude/skills/ directory so
# Claude Code can discover them. The source of truth stays in this repo.
#
# By default targets the repo-local .claude/skills/ dir. Pass --global to
# target ~/.claude/skills/ instead (makes the skills available in every
# project on this machine).
#
# Discovery rule: any top-level dir in plugin/skills/ that contains a SKILL.md.
#
# Also symlinks the bundled faff CLI (plugin/skills/faff/bin/faff) into ~/.local/bin/faff
# so `faff config|runcheck|validate-adapters …` works bare; warns if ~/.local/bin
# isn't on PATH. --unlink removes it; --status reports it.
#
# Safe to re-run. Uses `ln -sfn` to refresh existing symlinks.
#
# Flags:
#   (default)         link into <repo>/.claude/skills
#   --global          link into ~/.claude/skills
#   --dry|--dry-run   show what would happen, no writes
#   --replace         replace real dirs at the target whose names match a
#                     discovered skill (destructive — only use on first-time
#                     bootstrap when ~/.claude/skills has pre-existing copies)
#   --unlink|--remove remove only the symlinks this script owns (that point
#                     into this repo's skills/); leaves foreign entries
#                     alone. Useful before removing a worktree so the global
#                     dir doesn't dangle.
#   --prune           remove dead symlinks that point into skills/
#   --status          report current link state at the target, make no changes
#
# Usage:
#   bash scripts/link-skills.sh
#   bash scripts/link-skills.sh --global
#   bash scripts/link-skills.sh --global --replace   # bootstrap
#   bash scripts/link-skills.sh --global --unlink    # pre-worktree-remove
#   bash scripts/link-skills.sh --global --status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DST="${HOME}/.local/bin/faff"    # symlinked here so `faff …` works on PATH
# SRC_DIR / SKILLS_ROOT / BIN_SRC are derived AFTER arg-parse (below the --global block):
# --global from a linked worktree retargets the source to the main checkout (FAFF-443),
# so they can't be fixed here before GLOBAL is known.

DRY_RUN=0
PRUNE=0
GLOBAL=0
REPLACE=0
UNLINK=0
STATUS=0
for arg in "$@"; do
  case "$arg" in
    --dry|--dry-run) DRY_RUN=1 ;;
    --prune) PRUNE=1 ;;
    --global) GLOBAL=1 ;;
    --replace) REPLACE=1 ;;
    --unlink|--remove) UNLINK=1 ;;
    --status) STATUS=1 ;;
    -h|--help)
      sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$GLOBAL" -eq 1 ]; then
  TARGET_DIR="${HOME}/.claude/skills"
else
  TARGET_DIR="${REPO_ROOT}/.claude/skills"
fi

# FAFF-443: a --global install is machine-wide and long-lived, so it must be sourced from
# the stable main checkout, never an ephemeral linked worktree — otherwise the global links
# dangle when that worktree is removed. Only --global is affected; repo-local mode correctly
# links a worktree's OWN skills into its own .claude/skills. This mirrors bin/faff's
# mainWorktreeRoot() predicate (the Node helper is unreachable from bash) and fails safe to
# today's SCRIPT_DIR-derived source on the main checkout / a bare repo / a non-repo / no git.
SRC_ROOT="$REPO_ROOT"
# Only the LINK-CREATING flow retargets. --unlink and --status inspect/remove links AT the
# invocation context and must operate on the worktree they were called from (FAFF-443 review):
# `--global --unlink` from a worktree is the documented pre-worktree-remove cleanup and must match
# that worktree's OWN links, not main's — retargeting it would leave a worktree-sourced install
# (a pre-fix migration case) uncleaned. (--prune rides the create flow below and keeps the retarget.)
if [ "$GLOBAL" -eq 1 ] && [ "$UNLINK" -eq 0 ] && [ "$STATUS" -eq 0 ]; then
  common_dir="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$common_dir" ]; then
    case "$common_dir" in
      /*) ;;                                       # already absolute
      *)  common_dir="$REPO_ROOT/$common_dir" ;;   # resolve relative to REPO_ROOT
    esac
    # `<main>/.git` for a linked worktree; the main checkout is its parent. Bail on bare/odd layouts.
    if [ "$(basename "$common_dir")" = ".git" ]; then
      main_root="$(cd "$(dirname "$common_dir")" 2>/dev/null && pwd || true)"
      if [ -n "$main_root" ] && [ "$main_root" != "$REPO_ROOT" ]; then
        # REPO_ROOT is a linked worktree — source the durable global install from main.
        if [ ! -d "$main_root/plugin/skills" ]; then
          echo "✗ --global from a linked worktree, but the main checkout has no plugin/skills at $main_root/plugin/skills — refusing (a retarget would dangle immediately)." >&2
          exit 1
        fi
        SRC_ROOT="$main_root"
        # Diagnostic on stderr so it stays "loud" even for callers that redirect stdout (FAFF-443 review).
        echo "⚠  worktree detected — sourcing global links from the main checkout: $main_root" >&2
      fi
    fi
  fi
fi
SKILLS_ROOT="$SRC_ROOT/plugin/skills"
SRC_DIR="$SKILLS_ROOT"
BIN_SRC="$SRC_DIR/faff/bin/faff"     # the bundled faff CLI executable (re-derived post-retarget)

# Discover skills by SKILL.md presence, excluding the scripts dir.
shopt -s nullglob
SKILL_DIRS=()
for dir in "$SRC_DIR"/*/; do
  [ "$(basename "$dir")" = "scripts" ] && continue
  [ -f "${dir}SKILL.md" ] || continue
  SKILL_DIRS+=("${dir%/}")
done
shopt -u nullglob

if [ ${#SKILL_DIRS[@]} -eq 0 ]; then
  echo "No skills found under $SRC_DIR (looking for dirs containing SKILL.md)" >&2
  exit 1
fi

# --status: report and exit without changes.
if [ "$STATUS" -eq 1 ]; then
  echo "Source: $SRC_DIR"
  echo "Target: $TARGET_DIR"
  [ "$GLOBAL" -eq 1 ] && echo "(global mode)"
  echo

  if [ ! -d "$TARGET_DIR" ]; then
    echo "Target dir does not exist — nothing linked."
    exit 0
  fi

  linked_ct=0
  foreign_ct=0
  dangling_ct=0
  real_ct=0
  missing_ct=0

  for src in "${SKILL_DIRS[@]}"; do
    name="$(basename "$src")"
    dst="$TARGET_DIR/$name"
    if [ -L "$dst" ]; then
      current="$(readlink "$dst")"
      if [ "$current" = "$src" ]; then
        if [ -e "$dst" ]; then
          printf "  ✓ %-30s → this repo\n" "$name"
          linked_ct=$((linked_ct + 1))
        else
          printf "  ⚠ %-30s → dangling (%s)\n" "$name" "$current"
          dangling_ct=$((dangling_ct + 1))
        fi
      else
        printf "  ⚠ %-30s → foreign symlink (%s)\n" "$name" "$current"
        foreign_ct=$((foreign_ct + 1))
      fi
    elif [ -d "$dst" ]; then
      printf "  ✗ %-30s real dir at target (blocks link)\n" "$name"
      real_ct=$((real_ct + 1))
    elif [ -e "$dst" ]; then
      printf "  ✗ %-30s non-dir file at target\n" "$name"
      real_ct=$((real_ct + 1))
    else
      printf "  · %-30s not linked\n" "$name"
      missing_ct=$((missing_ct + 1))
    fi
  done

  echo
  echo "Summary:"
  printf "  linked (this repo): %d\n" "$linked_ct"
  printf "  not linked:         %d\n" "$missing_ct"
  printf "  foreign symlinks:   %d\n" "$foreign_ct"
  printf "  dangling symlinks:  %d\n" "$dangling_ct"
  printf "  real blocking:      %d\n" "$real_ct"
  echo
  if [ -L "$BIN_DST" ] && [ "$(readlink "$BIN_DST")" = "$BIN_SRC" ]; then
    echo "CLI: faff → $BIN_DST (linked)"
  else
    echo "CLI: faff not linked into $(dirname "$BIN_DST")"
  fi
  exit 0
fi

# --unlink: remove only symlinks pointing into THIS repo's skills/.
if [ "$UNLINK" -eq 1 ]; then
  echo "Source: $SRC_DIR"
  echo "Target: $TARGET_DIR"
  [ "$GLOBAL" -eq 1 ] && echo "(global mode)"
  [ "$DRY_RUN" -eq 1 ] && echo "(dry run — no changes will be made)"
  echo "Unlinking symlinks that point into $SRC_DIR"
  echo

  if [ ! -d "$TARGET_DIR" ]; then
    echo "Target dir does not exist — nothing to unlink."
    exit 0
  fi

  unlinked=0
  left_alone=0
  shopt -s nullglob
  for entry in "$TARGET_DIR"/*; do
    [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    target="$(readlink "$entry")"
    case "$target" in
      "$SRC_DIR"/*)
        printf "  - %-30s (unlinking → %s)\n" "$name" "$target"
        if [ "$DRY_RUN" -eq 0 ]; then
          rm "$entry"
        fi
        unlinked=$((unlinked + 1))
        ;;
      *)
        left_alone=$((left_alone + 1))
        ;;
    esac
  done
  shopt -u nullglob

  # also remove the ~/.local/bin/faff symlink if it points into this repo
  if [ -L "$BIN_DST" ] && [ "$(readlink "$BIN_DST")" = "$BIN_SRC" ]; then
    printf "  - %-30s (unlinking → %s)\n" "faff (CLI)" "$BIN_SRC"
    [ "$DRY_RUN" -eq 0 ] && rm "$BIN_DST"
    unlinked=$((unlinked + 1))
  fi

  echo
  echo "Summary:"
  printf "  unlinked:    %d\n" "$unlinked"
  printf "  left alone:  %d (foreign symlinks / real dirs)\n" "$left_alone"
  exit 0
fi

mkdir -p "$TARGET_DIR"

echo "Source: $SRC_DIR"
echo "Target: $TARGET_DIR"
[ "$GLOBAL" -eq 1 ] && echo "(global mode — linking into \$HOME)"
[ "$DRY_RUN" -eq 1 ] && echo "(dry run — no changes will be made)"
[ "$REPLACE" -eq 1 ] && echo "(replace mode — real dirs at target will be removed)"
echo

linked=0
refreshed=0
replaced=0
skipped=0
errors=0

for src in "${SKILL_DIRS[@]}"; do
  name="$(basename "$src")"
  dst="$TARGET_DIR/$name"

  if [ -L "$dst" ]; then
    current="$(readlink "$dst")"
    if [ "$current" = "$src" ]; then
      printf "  ✓ %-30s (already linked)\n" "$name"
      linked=$((linked + 1))
      continue
    else
      printf "  ↻ %-30s (relinking: %s → %s)\n" "$name" "$current" "$src"
      if [ "$DRY_RUN" -eq 0 ]; then
        ln -sfn "$src" "$dst"
      fi
      refreshed=$((refreshed + 1))
      continue
    fi
  fi

  if [ -e "$dst" ]; then
    if [ "$REPLACE" -eq 1 ]; then
      printf "  ⟳ %-30s (replacing real entry → %s)\n" "$name" "$src"
      if [ "$DRY_RUN" -eq 0 ]; then
        rm -rf "$dst"
        ln -s "$src" "$dst"
      fi
      replaced=$((replaced + 1))
      continue
    fi
    printf "  ⚠  %-30s COPY install — NOT dev-linked; shipped repo changes won't go live. Re-run with --replace (or run 'faff doctor').\n" "$name"
    skipped=$((skipped + 1))
    errors=$((errors + 1))
    continue
  fi

  printf "  + %-30s (new link → %s)\n" "$name" "$src"
  if [ "$DRY_RUN" -eq 0 ]; then
    ln -s "$src" "$dst"
  fi
  linked=$((linked + 1))
done

# Prune dead symlinks
pruned=0
if [ "$PRUNE" -eq 1 ]; then
  echo
  echo "Pruning dead symlinks in $TARGET_DIR"
  shopt -s nullglob
  for entry in "$TARGET_DIR"/*; do
    [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    target="$(readlink "$entry")"
    case "$target" in
      "$SRC_DIR"/*) ;;
      *) continue ;;
    esac
    if [ ! -e "$target" ]; then
      printf "  - %-30s (pruning dead link → %s)\n" "$name" "$target"
      if [ "$DRY_RUN" -eq 0 ]; then
        rm "$entry"
      fi
      pruned=$((pruned + 1))
    fi
  done
  shopt -u nullglob
fi

# Symlink the bundled faff CLI onto PATH so `faff …` works bare.
if [ -f "$BIN_SRC" ]; then
  echo
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname "$BIN_DST")"
    ln -sfn "$BIN_SRC" "$BIN_DST"
  fi
  echo "CLI: $BIN_DST → $BIN_SRC"
  case ":$PATH:" in
    *":$(dirname "$BIN_DST"):"*) ;;
    *)
      echo "  ⚠  $(dirname "$BIN_DST") is not on your PATH — add it so \`faff\` resolves bare:"
      echo "       export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac
fi

echo
echo "Summary:"
printf "  linked:    %d\n" "$linked"
printf "  refreshed: %d\n" "$refreshed"
[ "$REPLACE" -eq 1 ] && printf "  replaced:  %d\n" "$replaced"
[ "$PRUNE" -eq 1 ] && printf "  pruned:    %d\n" "$pruned"
printf "  skipped:   %d\n" "$skipped"

if [ "$errors" -gt 0 ]; then
  echo
  echo "⚠  $errors target(s) existed as real files/dirs and were not touched."
  echo "   Re-run with --replace to overwrite them, or move them out manually."
  exit 1
fi

echo
echo "Done. Skills are now discoverable by Claude Code at $TARGET_DIR"
