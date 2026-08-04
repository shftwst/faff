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
#   - `flock` available (util-linux) for the concurrency guard.
#
# Example crontab line (hourly), token from the operator's secret store:
#   0 * * * * CLAUDE_CODE_OAUTH_TOKEN="$(pass faff/seat)" FAFF_REPO_DIR=/srv/app /srv/app/docs/ci/faff-cron.sh >> /var/log/faff-cron.log 2>&1
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
#    `|| true` so a drain failure does not skip the disposition gate below; a crashed
#    drain leaves an incomplete ledger that disposition scores non-zero anyway.
FAFF_RUN_DIR=".faff/runs/run-$(date -u +%Y%m%d-%H%M%S)-l3-cron"
export FAFF_RUN_DIR
claude -p "/faff-beep-boop" || true

# 3. DISPOSITION — the final, exit-propagating step: non-zero iff anything parked /
#    errored / needs attention (parked-window included). It is the authoritative
#    red/green exit. Guard against an unset run dir so a wiped workspace fails loudly
#    rather than silently scoring the latest ledger.
[ -n "${FAFF_RUN_DIR:-}" ] || { echo "faff-cron: no run dir for this firing — failing"; exit 1; }
exec faff disposition --run-dir "$FAFF_RUN_DIR"
