#!/usr/bin/env bash
# =============================================================================
# faff-cron.sh — REFERENCE wrapper (copy into a crontab / systemd timer)
# =============================================================================
#
# The Actions-free trigger for the L3 watcher: the same sequence l3-watcher.yml
# encodes, as plain shell, with NO GitHub Actions in the loop. Point a cron line
# or a systemd timer at it and the machine wakes itself, drains the queue, and
# opens PRs — no runner registration, no Actions platform charge.
#
# See docs/guide/self-hosted-rig.md -> "Without GitHub Actions: a cron on the
# machine" for the why (incl. the 2026-03-01 self-hosted Actions platform
# charge), the L4 resume-segmentation delta, and what you keep vs lose.
#
# PREREQUISITES:
#   - `faff` and your harness (`claude`, or your own) on PATH;
#   - a subscription seat logged in on the machine, and its token exported in the
#     timer's environment (the CI path) — never committed;
#   - a cage that passes `faff container-check --gate` (see the rig doc);
#   - run from the TARGET repo's checkout (its committed .faffrc self-targets);
#   - `flock` and `timeout` available (util-linux / coreutils) — the concurrency
#     guard and the wall-clock cap;
#   - the lock file's directory must exist (default /tmp; if you set
#     FAFF_CRON_LOCK, point it at a directory that exists).
#
# Example crontab line (hourly), token from the operator's secret store:
#   0 * * * * CLAUDE_CODE_OAUTH_TOKEN="$(pass faff/seat)" FAFF_REPO_DIR=/srv/app /srv/app/operations/ci/faff-cron.sh >> /var/log/faff-cron.log 2>&1
# =============================================================================
set -euo pipefail

cd "${FAFF_REPO_DIR:-$PWD}" || { echo "faff-cron: cannot cd to the repo dir"; exit 1; }

# CONCURRENCY GUARD — the Actions-free equivalent of the workflow `concurrency:`
# block. A NON-BLOCKING flock: if a previous firing is still draining, SKIP this
# tick (the next re-queries the tracker). NB: this *skips* an overlap, whereas the
# workflow `concurrency:` would *queue* it to run after the first finishes — either
# way no two firings touch the same ledger. claim-before-admit is the correctness
# backstop regardless (an overlap would be safe, not just prevented).
LOCK="${FAFF_CRON_LOCK:-/tmp/faff-cron.lock}"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "faff-cron: another firing holds $LOCK — skipping this tick"
  exit 0
fi

# 1. ADMISSION GATE — MUST be first, before any agent, tracker claim, or ledger
#    mint. Exits 1 when the rig is not admitted (not contained, or a host engine
#    socket reachable); `set -e` then aborts here, so nothing is claimed or minted
#    on a rig that isn't caged. Any cage that passes the gate works.
faff container-check --gate

# 2. THE L3 DRAIN — a plain /faff-beep-boop (no `faff lights-out`, so this is L3).
#    Mint the run dir up front so the disposition step reads the SAME run's end
#    state. AUTH: the harness reads its seat token from the environment (exported by
#    the timer, e.g. CLAUDE_CODE_OAUTH_TOKEN for `claude -p`; a Codex harness reads
#    its own) — never written to disk here. Swap `claude -p` for your harness.
#
#    `timeout 300m` is the wall-clock ceiling — the l3-watcher.yml `timeout-minutes:
#    300` equivalent. It matters MORE here than in Actions: without it a wedged drain
#    (a hung network read, a stuck harness that never reaches a budget checkpoint)
#    would hold the flock forever, and every later tick would skip green — the factory
#    silently stalls. The timeout kills a hang, releases the lock, and the drain's exit
#    (a `timeout` kill is 124) is funnelled below. `|| true` so ANY drain failure does
#    not skip the disposition gate: a drain that crashed BEFORE writing a ledger leaves
#    no run-ledger.json (disposition exits 3), and one that wrote a partial ledger then
#    died is scored incomplete (non-zero) — either way disposition catches it.
FAFF_RUN_DIR=".faff/runs/run-$(date -u +%Y%m%d-%H%M%S)-l3-cron"
export FAFF_RUN_DIR
timeout 300m claude -p "/faff-beep-boop" || true

# 3. DISPOSITION — the final, exit-propagating step: non-zero iff anything parked /
#    errored / needs attention (parked-window included). It is the authoritative
#    red/green exit. The guard below is defensive hygiene (FAFF_RUN_DIR is set just
#    above, so it never fires here) — it exists so this stays correct if someone
#    reorders the steps; a genuinely wiped workspace is caught by disposition itself,
#    which exits 3 on a missing run-ledger.json (an explicit --run-dir is never
#    redirected to the latest ledger).
[ -n "${FAFF_RUN_DIR:-}" ] || { echo "faff-cron: no run dir for this firing — failing"; exit 1; }
exec faff disposition --run-dir "$FAFF_RUN_DIR"
