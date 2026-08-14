#!/usr/bin/env bash
# FAFF-708 — resolve the diff/branch base ref for graft's remote-backed operations: the worktree base
# (setup-worktree.sh delegates here) AND the coupled diff identities (the Step 9 review input + its
# review-progress hash, the Step 3 resume-at-review recompute, the Step 8b build-progress hash). One
# resolver, so the provisioner and the diffs can never drift. Prints ONE base ref to stdout and
# nothing else on success:
#   - remote-backed repo (an `origin` remote exists) -> `origin/<resolved-default>`, the fetched
#     remote default branch, so nothing is ever based on the operator's possibly-stale local checkout;
#   - git-only repo (no `origin`)                    -> the locally-resolved default (`main` or
#     `master`), matching merge-gate.js resolveLocalBase's own rule (check both; refuse if neither).
# Fail-loud: any resolve/fetch/verify failure exits non-zero with a stderr reason and prints no base
# — never a silent stale-HEAD/`main` fall-back, which would preserve the bug this fixes.
#
# Network posture: both network commands run non-interactively (GIT_TERMINAL_PROMPT=0, so a
# missing/expired credential fails fast instead of hanging on a TTY prompt) and under a bounded
# wall-clock — FAFF_GIT_NET_TIMEOUT when a positive integer, else 30s. The bound is applied
# portably (FAFF-708 review): GNU `timeout` when present (Linux, and macOS with coreutils), else
# `gtimeout` (the coreutils name on macOS), else git's own low-speed abort as the fall-back on a
# stock-macOS host with neither — so the bound holds everywhere, never a `timeout: command not
# found` hard-fail. Run from within the repo/worktree whose base you want.
#
# SSH transport (FAFF-744): the low-speed knobs above only bound HTTP(S) transfers — an SSH origin
# is bounded by `ssh` itself, so on a host with neither `timeout` nor `gtimeout` a black-holed SSH
# connection had no wall-clock bound at all. GIT_SSH_COMMAND gives `ssh` its own connect/liveness
# bound, reusing the same NET_TIMEOUT budget, composed into every net_git() invocation (both the
# timeout-wrapped and unwrapped branches) so the bound holds independent of a `timeout` binary. An
# operator-set GIT_SSH_COMMAND is used verbatim — never clobbered, never appended to.
set -euo pipefail

export GIT_TERMINAL_PROMPT=0
NET_TIMEOUT="${FAFF_GIT_NET_TIMEOUT:-}"
case "$NET_TIMEOUT" in
  ''|*[!0-9]*) NET_TIMEOUT=30 ;;   # unset or non-numeric -> default
  0) NET_TIMEOUT=30 ;;             # 0 is not a positive integer -> default
esac

# Resolve a portable command-timeout wrapper. Where neither `timeout` nor `gtimeout` exists we still
# bound the transfer via git's low-speed knobs (below) and stay non-interactive, so the command never
# hangs indefinitely on that host either.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN=gtimeout
fi

# SSH connect/liveness bound (FAFF-744): respect an operator-set GIT_SSH_COMMAND verbatim (they own
# their transport — proxy, jump host, custom identity); otherwise default to a bounded, non-
# interactive ssh command reusing NET_TIMEOUT. BatchMode=yes fails instead of prompting on a
# host-key/passphrase prompt (the SSH-layer analogue of GIT_TERMINAL_PROMPT=0); ConnectTimeout
# bounds the TCP/connect phase; ServerAliveInterval+ServerAliveCountMax=1 bounds an
# established-then-stalled session (a mid-transfer black-hole is dropped after ~NET_TIMEOUT via one
# unanswered keepalive). Computed once, scoped to net_git()'s own invocations only — never exported
# process-wide, so it can't leak onto an unrelated later git call in the same process.
if [ -n "${GIT_SSH_COMMAND:-}" ]; then
  SSH_CMD="$GIT_SSH_COMMAND"
else
  SSH_CMD="ssh -o BatchMode=yes -o ConnectTimeout=$NET_TIMEOUT -o ServerAliveInterval=$NET_TIMEOUT -o ServerAliveCountMax=1"
fi

# Bounded, non-interactive git network command. The low-speed knobs abort a stalled HTTP(S) transfer
# after NET_TIMEOUT seconds even when no `timeout` binary is present; GIT_SSH_COMMAND bounds an SSH
# transfer the same way (both are harmless no-ops for a transport they don't apply to — e.g. the
# low-speed knobs for ssh://, GIT_SSH_COMMAND for HTTP(S)); the timeout wrapper, when available, is
# the hard wall-clock bound on top of both.
net_git() {
  if [ -n "$TIMEOUT_BIN" ]; then
    GIT_SSH_COMMAND="$SSH_CMD" "$TIMEOUT_BIN" "$NET_TIMEOUT" git -c "http.lowSpeedLimit=1" -c "http.lowSpeedTime=$NET_TIMEOUT" "$@"
  else
    GIT_SSH_COMMAND="$SSH_CMD" git -c "http.lowSpeedLimit=1" -c "http.lowSpeedTime=$NET_TIMEOUT" "$@"
  fi
}

if git remote get-url origin >/dev/null 2>&1; then
  # Remote-backed: resolve the default branch from the remote's advertised symbolic HEAD. Do NOT
  # guess `main`, write local git config, or call a forge API — the fetched remote is the authority.
  SYMREF=$(net_git ls-remote --symref origin HEAD) || {
    echo "remote-diff-base: could not query origin's symbolic HEAD (ls-remote failed, timed out, or credential failure)" >&2
    exit 1
  }
  DEFAULT_BRANCH=$(printf '%s\n' "$SYMREF" | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#\1#p' | head -1)
  [ -n "$DEFAULT_BRANCH" ] || {
    echo "remote-diff-base: origin advertises no symbolic HEAD — cannot resolve a default branch" >&2
    exit 1
  }
  net_git fetch -q origin "$DEFAULT_BRANCH" >/dev/null 2>&1 || {
    echo "remote-diff-base: could not fetch origin/${DEFAULT_BRANCH} (fetch failed, timed out, or credential failure)" >&2
    exit 1
  }
  git rev-parse --verify --quiet "refs/remotes/origin/${DEFAULT_BRANCH}^{commit}" >/dev/null || {
    echo "remote-diff-base: refs/remotes/origin/${DEFAULT_BRANCH} does not resolve to a commit after fetch" >&2
    exit 1
  }
  printf 'origin/%s\n' "$DEFAULT_BRANCH"
else
  # git-only: no origin — the locally-resolved default branch, mirroring merge-gate.js
  # resolveLocalBase exactly (check main then master via show-ref; refuse if neither exists).
  for cand in main master; do
    if git show-ref --verify --quiet "refs/heads/${cand}"; then
      printf '%s\n' "$cand"
      exit 0
    fi
  done
  echo "remote-diff-base: no origin remote and neither local main nor master exists — cannot resolve a base" >&2
  exit 1
fi
