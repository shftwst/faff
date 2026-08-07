#!/usr/bin/env bash
# FAFF-708 — resolve the diff base ref for graft's coupled remote-backed diffs (the Step 9 review
# input and its review-progress hash, the Step 3 resume-at-review recompute, and the Step 8b
# build-progress hash). Prints ONE base ref to stdout and nothing else on success:
#   - remote-backed repo (an `origin` remote exists) -> `origin/<resolved-default>`, the fetched
#     remote default branch, so a diff never uses the operator's possibly-stale local checkout;
#   - git-only repo (no `origin`)                    -> the locally-resolved default (`main`/`master`),
#     matching `merge-gate --local`'s own rule.
# Fail-loud: any resolve/fetch/verify failure exits non-zero with a stderr reason and prints no base
# — never a silent stale-HEAD/`main` fall-back, which would preserve the bug this fixes.
#
# Network posture mirrors setup-worktree.sh (the sibling remote-base consumer): both network commands
# run non-interactively (GIT_TERMINAL_PROMPT=0, so a missing/expired credential fails fast instead of
# hanging on a TTY prompt) and under a bounded wall-clock `timeout` — FAFF_GIT_NET_TIMEOUT when a
# positive integer, else 30s. Run from within the repo/worktree whose base you want.
set -euo pipefail

export GIT_TERMINAL_PROMPT=0
NET_TIMEOUT="${FAFF_GIT_NET_TIMEOUT:-}"
case "$NET_TIMEOUT" in
  ''|*[!0-9]*) NET_TIMEOUT=30 ;;   # unset or non-numeric -> default
  0) NET_TIMEOUT=30 ;;             # 0 is not a positive integer -> default
esac

if git remote get-url origin >/dev/null 2>&1; then
  # Remote-backed: resolve the default branch from the remote's advertised symbolic HEAD. Do NOT
  # guess `main`, write local git config, or call a forge API — the fetched remote is the authority.
  SYMREF=$(timeout "$NET_TIMEOUT" git ls-remote --symref origin HEAD) || {
    echo "remote-diff-base: could not query origin's symbolic HEAD (ls-remote failed, timed out, or credential failure)" >&2
    exit 1
  }
  DEFAULT_BRANCH=$(printf '%s\n' "$SYMREF" | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#\1#p' | head -1)
  [ -n "$DEFAULT_BRANCH" ] || {
    echo "remote-diff-base: origin advertises no symbolic HEAD — cannot resolve a default branch" >&2
    exit 1
  }
  timeout "$NET_TIMEOUT" git fetch -q origin "$DEFAULT_BRANCH" >/dev/null 2>&1 || {
    echo "remote-diff-base: could not fetch origin/${DEFAULT_BRANCH} (fetch failed, timed out, or credential failure)" >&2
    exit 1
  }
  git rev-parse --verify --quiet "refs/remotes/origin/${DEFAULT_BRANCH}^{commit}" >/dev/null || {
    echo "remote-diff-base: refs/remotes/origin/${DEFAULT_BRANCH} does not resolve to a commit after fetch" >&2
    exit 1
  }
  printf 'origin/%s\n' "$DEFAULT_BRANCH"
else
  # git-only: no origin — the locally-resolved default branch (merge-gate --local's main/master rule).
  if git rev-parse -q --verify main >/dev/null 2>&1; then
    printf 'main\n'
  else
    printf 'master\n'
  fi
fi
