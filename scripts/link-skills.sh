#!/usr/bin/env bash
#
# link-skills.sh
#
# Symlink every skill in skills/ into the directories a harness scans for skills,
# so Claude Code and Codex can discover them. The source of truth stays in this repo.
#
# By default targets the repo-local .claude/skills/ dir. Pass --global to target the
# machine-wide skill directories instead: ~/.claude/skills/ (Claude Code) and
# ~/.agents/skills/ (Codex and any other Agent Skills tool — the cross-tool
# convention rather than one vendor's home). One symlink per skill in each; the
# directories themselves are never symlinked, so other tools' skills are untouched.
#
# --global targets come from the install.skill_targets config key when it's set (a YAML
# sequence of absolute or "~"-relative paths in .faffrc.yaml), defaulting to the pair above
# when it's unset or unreadable. Local (non-`--global`) mode never consults the key. See
# FAFF-684 and plugin/skills/faff/SKILL.md's .faffrc.yaml schema block.
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
#   --global          link into ~/.claude/skills and ~/.agents/skills
#   --dry|--dry-run   show what would happen, no writes
#   --replace         replace real dirs at the target whose names match a
#                     discovered skill (destructive — only use on first-time
#                     bootstrap when a target holds pre-existing copies). Only
#                     entries named after a discovered faff skill are touched.
#   --unlink|--remove remove only the symlinks this script owns (that point
#                     into this repo's skills/); leaves foreign entries
#                     alone. Useful before removing a worktree so the global
#                     dirs don't dangle.
#   --prune           remove dead symlinks that point into skills/
#   --status          report current link state at each target, make no changes
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
      sed -n '2,37p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

# FAFF-672: --global installs the same per-skill symlink into every directory a harness
# scans, so the install targets are PLURAL. They live in one ordered list, built once here;
# document order is output order. Every operational block below iterates this list and no
# block reconstructs a target path from $HOME/$REPO_ROOT independently — that single-source
# rule is what keeps the four blocks from drifting as a target is added or removed. The
# SOURCE stays singular (SRC_ROOT/SKILLS_ROOT/SRC_DIR, resolved below); only the target is plural.

# Resolve a directory through symlinks. Uses a cd/pwd -P subshell rather than `realpath`,
# which is not present on every macOS the installer runs on. A path that does not exist (or
# that cd cannot enter) resolves to itself — it aliases nothing.
resolve_path() {
  local p="$1"
  if [ -d "$p" ]; then
    ( cd "$p" 2>/dev/null && pwd -P ) || printf '%s' "$p"
  else
    printf '%s' "$p"
  fi
}

# De-duplicate TARGET_DIRS by RESOLVED path, keeping the first occurrence in list order.
# A user who hand-fixed this bug with `ln -s ~/.claude/skills ~/.agents/skills` has one
# directory reachable by two literal paths; treating them as two would double-count status,
# re-run the destructive --replace pass over the same inode, and make cross-target checks
# compare a directory against itself. Collapsing keeps a working install working. Rewrites
# TARGET_DIRS in place. (Parallel accumulators, not an associative array — macOS ships bash 3.2.)
dedupe_by_resolved_path() {
  local -a kept=()
  local seen=""            # newline-delimited "<resolved>\t<literal>" records
  local d resolved match
  for d in "${TARGET_DIRS[@]}"; do
    resolved="$(resolve_path "$d")"
    match="$(printf '%s' "$seen" | awk -F '\t' -v r="$resolved" '$1==r {print $2; exit}')"
    if [ -n "$match" ]; then
      echo "⚠  $d resolves to $match — treating them as one target"
      continue
    fi
    seen="${seen}${resolved}"$'\t'"${d}"$'\n'
    kept+=("$d")
  done
  TARGET_DIRS=("${kept[@]}")
}

# FAFF-684: expand a single install.skill_targets entry to an absolute path. A bare "~"
# expands to $HOME, a "~/…" entry drops the "~" and keeps $HOME + the rest, an absolute
# path passes through unchanged. Anything else (relative, empty, a literal "$HOME" that
# YAML never shell-expands) is unusable — the caller skips it with a notice. Prints the
# expanded path and returns 0 on success; returns 1 with nothing printed when unusable.
expand_target() {
  local entry="$1"
  case "$entry" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "${HOME}${entry#\~}" ;;
    /*) printf '%s' "$entry" ;;
    *) return 1 ;;
  esac
}

# FAFF-684: best-effort read of the configured install target list, via the already-resolved
# bundled CLI (BIN_SRC) rather than a hand grep/sed of .faffrc.yaml — the resolver alone
# handles overlay merge and the malformed-base loud-exit. Every failure mode (node absent,
# BIN_SRC unreadable, a non-zero exit other than "key absent", an empty result, every entry
# unusable) appends nothing to CONFIGURED_TARGETS — the caller falls back to the hardcoded
# pair. Exit 3 (key absent) is the normal "unset" case and stays silent, matching the design
# promise that an unset key changes nothing, including stdout; any other non-zero warns to
# stderr so a genuinely broken key is never masked without a trace. Appends to the global
# CONFIGURED_TARGETS array (declared by the caller) rather than returning a value, since bash
# 3.2 (macOS) has no clean way to return an array from a function.
read_configured_targets() {
  if ! command -v node >/dev/null 2>&1 || [ ! -f "$BIN_SRC" ]; then
    return 0
  fi
  local out status
  # `set -e` treats `var=$(failing-cmd)` as a failing command in its own right (it is not
  # inside an if/while/&&/|| context), so a plain assignment here would abort the whole
  # installer the instant the key is unset (exit 3) — exactly the anti-pattern this function
  # exists to avoid. Disable errexit for just this one capture, then restore it.
  set +e
  out="$(cd "$SRC_ROOT" && node "$BIN_SRC" config get install.skill_targets 2>/dev/null)"
  status=$?
  set -e
  if [ "$status" -eq 3 ]; then
    return 0   # key absent — silent, this is the normal default
  fi
  if [ "$status" -ne 0 ]; then
    echo "⚠  could not read install.skill_targets from config (exit $status) — using default install targets" >&2
    return 0
  fi
  if [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
    return 0
  fi
  local -a raw=()
  IFS=',' read -ra raw <<< "$out"
  local e trimmed expanded
  for e in "${raw[@]}"; do
    trimmed="$(printf '%s' "$e" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if expanded="$(expand_target "$trimmed")"; then
      CONFIGURED_TARGETS+=("$expanded")
    else
      echo "⚠  ignoring install target '$trimmed' — not absolute or ~-relative" >&2
    fi
  done
}

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
# FAFF-999: the CLI binaries symlinked onto PATH — faff plus the standalone commissaire. For each,
# src is "$SRC_DIR/faff/bin/<name>" and dst is "$HOME/.local/bin/<name>"; the --status / --unlink /
# create-symlink blocks loop over this list so a second binary never triples them. BIN_SRC/BIN_DST
# stay the canonical faff pair the config-read section above shells.
CLI_BIN_NAMES="faff commissaire"

# FAFF-684: build TARGET_DIRS here, now that BIN_SRC/SRC_ROOT are resolved — the config read
# needs BIN_SRC to shell the bundled CLI, and for a worktree --global install SRC_ROOT must
# already be retargeted to the main checkout or the read would run the wrong CLI. Nothing
# between the old (pre-retarget) and this site reads TARGET_DIRS, so the move is safe. Local
# (non-`--global`) mode never consults the config key — it stays exactly [<repo>/.claude/skills].
if [ "$GLOBAL" -eq 1 ]; then
  CONFIGURED_TARGETS=()
  read_configured_targets
  if [ ${#CONFIGURED_TARGETS[@]} -gt 0 ]; then
    TARGET_DIRS=("${CONFIGURED_TARGETS[@]}")
  else
    TARGET_DIRS=("${HOME}/.claude/skills" "${HOME}/.agents/skills")
  fi
else
  TARGET_DIRS=("${REPO_ROOT}/.claude/skills")
fi
dedupe_by_resolved_path

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

# --status: report and exit without changes. Source header + counters are single-run; the
# per-target block loops. A missing target prints a per-target note and CONTINUES — it must
# never `exit 0` before every target has been visited (else it reproduces the half-install).
if [ "$STATUS" -eq 1 ]; then
  echo "Source: $SRC_DIR"
  [ "$GLOBAL" -eq 1 ] && echo "(global mode)"
  echo

  linked_ct=0
  foreign_ct=0
  dangling_ct=0
  real_ct=0
  missing_ct=0

  for TARGET_DIR in "${TARGET_DIRS[@]}"; do
    echo "Target: $TARGET_DIR"
    if [ ! -d "$TARGET_DIR" ]; then
      echo "  nothing linked here — target dir does not exist"
      echo
      continue
    fi

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
  done

  echo "Summary (totals across targets):"
  printf "  linked (this repo): %d\n" "$linked_ct"
  printf "  not linked:         %d\n" "$missing_ct"
  printf "  foreign symlinks:   %d\n" "$foreign_ct"
  printf "  dangling symlinks:  %d\n" "$dangling_ct"
  printf "  real blocking:      %d\n" "$real_ct"
  echo
  for _cli in $CLI_BIN_NAMES; do
    _src="$SRC_DIR/faff/bin/$_cli"; _dst="${HOME}/.local/bin/$_cli"
    if [ -L "$_dst" ] && [ "$(readlink "$_dst")" = "$_src" ]; then
      echo "CLI: $_cli → $_dst (linked)"
    else
      echo "CLI: $_cli not linked into $(dirname "$_dst")"
    fi
  done
  exit 0
fi

# --unlink: remove only symlinks pointing into THIS repo's skills/, from EVERY target.
# Best-effort per target — a missing or unwritable target is recorded and skipped, never a
# reason to leave the other target uncleaned (the pre-worktree-remove cleanup FAFF-443 needs).
if [ "$UNLINK" -eq 1 ]; then
  echo "Source: $SRC_DIR"
  [ "$GLOBAL" -eq 1 ] && echo "(global mode)"
  [ "$DRY_RUN" -eq 1 ] && echo "(dry run — no changes will be made)"
  echo "Unlinking symlinks that point into $SRC_DIR"
  echo

  unlinked=0
  left_alone=0
  failed_targets=""

  for TARGET_DIR in "${TARGET_DIRS[@]}"; do
    echo "Target: $TARGET_DIR"
    if [ ! -d "$TARGET_DIR" ]; then
      echo "  nothing to unlink here — target dir does not exist"
      echo
      continue
    fi

    target_failed=0
    shopt -s nullglob
    for entry in "$TARGET_DIR"/*; do
      [ -L "$entry" ] || continue
      name="$(basename "$entry")"
      target="$(readlink "$entry")"
      case "$target" in
        "$SRC_DIR"/*)
          printf "  - %-30s (unlinking → %s)\n" "$name" "$target"
          if [ "$DRY_RUN" -eq 0 ]; then
            if ! rm "$entry" 2>/dev/null; then
              printf "  ✗ %-30s (could not remove)\n" "$name"
              target_failed=1
              continue
            fi
          fi
          unlinked=$((unlinked + 1))
          ;;
        *)
          left_alone=$((left_alone + 1))
          ;;
      esac
    done
    shopt -u nullglob
    [ "$target_failed" -eq 1 ] && failed_targets="${failed_targets}${TARGET_DIR} "
    echo
  done

  # also remove the ~/.local/bin/<cli> symlinks that point into this repo — ONCE, after the loop
  for _cli in $CLI_BIN_NAMES; do
    _src="$SRC_DIR/faff/bin/$_cli"; _dst="${HOME}/.local/bin/$_cli"
    if [ -L "$_dst" ] && [ "$(readlink "$_dst")" = "$_src" ]; then
      printf "  - %-30s (unlinking → %s)\n" "$_cli (CLI)" "$_src"
      [ "$DRY_RUN" -eq 0 ] && rm "$_dst"
      unlinked=$((unlinked + 1))
    fi
  done

  echo
  echo "Summary:"
  printf "  unlinked:    %d\n" "$unlinked"
  printf "  left alone:  %d (foreign symlinks / real dirs)\n" "$left_alone"
  if [ -n "$failed_targets" ]; then
    echo
    echo "⚠  could not fully clean these target(s): $failed_targets"
    exit 1
  fi
  exit 0
fi

# Create path: link each skill into EVERY target. Header + counters are single-run and above
# the target loop, so counts accumulate across targets; the per-skill work loops per target.
echo "Source: $SRC_DIR"
echo "Targets:"
for TARGET_DIR in "${TARGET_DIRS[@]}"; do echo "  - $TARGET_DIR"; done
[ "$GLOBAL" -eq 1 ] && echo "(global mode — linking into \$HOME)"
[ "$DRY_RUN" -eq 1 ] && echo "(dry run — no changes will be made)"
[ "$REPLACE" -eq 1 ] && echo "(replace mode — real dirs at target will be removed)"
echo

linked=0
refreshed=0
replaced=0
skipped=0
errors=0
failed_targets=""

for TARGET_DIR in "${TARGET_DIRS[@]}"; do
  echo "Target: $TARGET_DIR"
  if ! mkdir -p "$TARGET_DIR" 2>/dev/null; then
    echo "  ✗ could not create/access $TARGET_DIR — skipping this target"
    errors=$((errors + 1))
    failed_targets="${failed_targets}${TARGET_DIR} "
    echo
    continue
  fi

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
  echo
done

# Prune dead symlinks from every target. `pruned` is single-run (outside the flag block).
pruned=0
if [ "$PRUNE" -eq 1 ]; then
  for TARGET_DIR in "${TARGET_DIRS[@]}"; do
    echo "Pruning dead symlinks in $TARGET_DIR"
    if [ ! -d "$TARGET_DIR" ]; then
      echo "  (target dir does not exist)"
      continue
    fi
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
  done
  echo
fi

# Symlink the bundled CLI binaries onto PATH so `faff …` / `commissaire …` work bare (FAFF-999).
# One src/dst pair per name; the PATH warning fires once after the loop (both share ~/.local/bin).
for _cli in $CLI_BIN_NAMES; do
  _src="$SRC_DIR/faff/bin/$_cli"; _dst="${HOME}/.local/bin/$_cli"
  [ -f "$_src" ] || continue
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname "$_dst")"
    ln -sfn "$_src" "$_dst"
  fi
  echo "CLI: $_dst → $_src"
done
if [ -f "$BIN_SRC" ]; then
  case ":$PATH:" in
    *":$(dirname "$BIN_DST"):"*) ;;
    *)
      echo "  ⚠  $(dirname "$BIN_DST") is not on your PATH — add it so \`faff\` / \`commissaire\` resolve bare:"
      echo "       export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac
fi

echo
# Activate the DCO sign-off hook. The logic lives in its own script so the CI runner
# can reuse it verbatim (setup-git-hooks.sh). It is idempotent and honours --dry-run,
# so it is safe to call on every setup run. Guarded on presence: if this installer is
# vendored on its own without its sibling, skip the activation rather than abort: a
# missing hook is a lost convenience, not a reason to fail the skill link.
if [ -f "$SCRIPT_DIR/setup-git-hooks.sh" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    bash "$SCRIPT_DIR/setup-git-hooks.sh" --dry-run
  else
    bash "$SCRIPT_DIR/setup-git-hooks.sh"
  fi
fi
# No else: a lone-vendored installer skips activation silently, keeping this path's
# stderr clean (a real checkout always ships setup-git-hooks.sh, which reports on stdout).

echo
echo "Summary:"
printf "  linked:    %d\n" "$linked"
printf "  refreshed: %d\n" "$refreshed"
[ "$REPLACE" -eq 1 ] && printf "  replaced:  %d\n" "$replaced"
[ "$PRUNE" -eq 1 ] && printf "  pruned:    %d\n" "$pruned"
printf "  skipped:   %d\n" "$skipped"

if [ "$errors" -gt 0 ]; then
  echo
  echo "⚠  $errors entr(y/ies) at a target existed as real files/dirs (or a target was unwritable) and were not touched."
  [ -n "$failed_targets" ] && echo "   unwritable target(s): $failed_targets"
  echo "   Re-run with --replace to overwrite real entries, or move them out manually."
  exit 1
fi

echo
echo "Done. Skills are now discoverable at: ${TARGET_DIRS[*]}"
