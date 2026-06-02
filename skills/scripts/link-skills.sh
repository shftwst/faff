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
# Discovery rule: any top-level dir in skills/ that contains a SKILL.md.
# The scripts/ dir is excluded automatically.
#
# Also symlinks the bundled faff CLI (skills/faff/bin/faff) into ~/.local/bin/faff
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
#   bash skills/scripts/link-skills.sh
#   bash skills/scripts/link-skills.sh --global
#   bash skills/scripts/link-skills.sh --global --replace   # bootstrap
#   bash skills/scripts/link-skills.sh --global --unlink    # pre-worktree-remove
#   bash skills/scripts/link-skills.sh --global --status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILLS_ROOT/.." && pwd)"
SRC_DIR="$SKILLS_ROOT"
BIN_SRC="$SRC_DIR/faff/bin/faff"     # the bundled faff CLI executable
BIN_DST="${HOME}/.local/bin/faff"    # symlinked here so `faff …` works on PATH

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
    printf "  ⚠  %-30s (exists and is not a symlink — skipping; use --replace to override)\n" "$name"
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
