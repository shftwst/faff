# ADR 0065 — Sentry watchdog invocation locus: mint-scoped detached poller as primary, Stop-hook staleness-check as opportunistic assist

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-426

## Context

Every supervision trigger faff has today is **cooperative** — it fires only when the supervised party volunteers control. `faff sentry check` (`plugin/skills/faff/bin/lib/sentry.js`) runs solely when the beep-boop prose loop reaches a between-units checkpoint; the Stop hooks (`runcheck --hook`, `prepcheck --hook`) fire only when a session reaches turn-end (`runcheck.js`, FAFF-205 comment: "The Stop hook fires on EVERY session's turn-end"). A supervisor whose invocation depends on the supervised party's cooperation cannot catch a cooperation failure: a `wall-clock-runaway` orchestrator that stops reaching checkpoints — exactly the failure that verdict exists to catch — starves its own supervisor. The evidence already exists on disk (`owner.last_heartbeat`, staleness window `FAFF_RUN_HEARTBEAT_STALE_SECS`, default 900s); no *executor* evaluates it from outside the orchestrator's own control flow. FAFF-352 (merged this run, commit `01b7ba2`) wires the cooperative checkpoint consult — necessary, not sufficient. This ADR settles the non-cooperative half.

**Live corroborating evidence, this run.** This spike's own run (`run-20260712-043209-beepboop-full`) tripped `wall-clock-runaway` on `run_elapsed_secs` (18216s > the 4h/14400s ceiling), logged at `.faff/runs/run-20260712-043209-beepboop-full/wave-1/sentry-advisory.md`. The trip fired because a checkpoint was reached — heartbeat was fresh (age 0s) and the L3 disposition was advisory-proceed, so this is not itself an instance of starvation. It is, however, live confirmation that the cooperative consult fires repeatedly and correctly on real, non-synthetic elapsed-time pressure — and it underlines, by the same token, that the only reason this run's sentry consults happened at all is that every checkpoint was, in fact, reached. A run that stopped reaching them would have logged nothing here, which is precisely the gap this ADR closes.

**Design principles carried from the spec (constraints that reject an otherwise-valid design):**

- **Consume, never re-derive.** The chosen locus invokes `faff sentry check` / `faff sentry abort` and reimplements no trigger math.
- **Liveness is owner-emitted on-disk state** (ADR-0008) — the watchdog reads `owner.last_heartbeat` / `owner.status`, no second liveness channel.
- **Un-subvertability extends upward** (ADR-0034) — a watchdog the orchestrator must invoke is theatre by ADR-0034's own standard.
- **Fail closed on own faults** (FAFF-425) — an own-fault (ledger unreadable) escalates, never concludes all-clear.
- **Proportionate, minimal** (ADR-0039) — no new supervisory *lane*; either the chosen locus is an invocation seam for the existing detector, or the answer is alert-only.

**Execution environment, confirmed for this very run.** `id` in this session reports `uid=501(hostuser)`, `DOCKER_HOST` and `CLAUDE_BOX_ENGINE=rootless` are set, and `hostname` resolves to a container ID — this run is itself executing inside a claude-box container per ADR-0010's blast-radius model. The orchestrator and every build subagent it dispatches (this one included) share that one container's filesystem and uid. This matters directly for criterion 6 below: any locus spawned *from inside* a faff run — a hook, a daemon — shares that boundary with the build lane, inheriting the same shared-fs residual ADR-0034's FAFF-324 amendment already found and named as a tracked, not-yet-closed follow-up guard (vectors 4/4b: `owner.last_heartbeat` is forgeable by a same-uid `fs.writeFileSync`, or gameable via the legitimate `faff heartbeat` call itself). Only a host-level executor — one that runs *outside* the container, reading the bind-mounted `.faff/` tree from the host side — would cross that boundary for real; none of this run's own tooling can install one today.

## Decision

```
RECORD WatchdogLocusDecision:
  chosen_locus: composite — mint-scoped detached poller (primary) + Stop-hook staleness
                consult (opportunistic assist); alert-only was NOT needed — a live,
                actionable answer exists.
  trigger:
    - poller: fixed-interval poll loop (proposed default: same order as the heartbeat
      staleness window, e.g. 60-120s — the implementation ticket tunes this), started at
      run-mint, independent of any session's turn-end.
    - hook: any session's Stop event (existing FAFF_STOP_HOOKS family), extended to also
      run a staleness-triggered `sentry check` against the newest run ledger — reuses the
      runcheck.js ownership/liveness gate shape (FAFF-205) so a foreign, still-live run is
      never falsely tripped.
  executor:
    - poller: a detached Node child process (`spawn(..., {detached:true, stdio:"ignore"})`
      + `.unref()`), spawned by the orchestrator (beep-boop skill prose) at run-mint,
      looping `faff sentry check --json --run-dir <dir>` and stopping on either (a) a
      run-done sentinel the orchestrator writes at teardown, or (b) observing the ledger's
      own outcome set is complete / owner.status leaves "running" — a defensive self-stop
      so a poller that outlives its intended stop signal still terminates, bounding the
      orphan-process risk demonstrated below rather than leaving it unbounded.
      Lifecycle: start at run mint, stop at run-done (ADR-0044) — owned by the orchestrator
      skill step that mints the run, not a new standalone faff subcommand's own daemon
      management (no `faff sentry watch` service to install/uninstall).
    - hook: the existing hooks-ensure.js Stop-hook registrar (FAFF-192 precedent) — no new
      install mechanism, one more command string in FAFF_STOP_HOOKS.
  action_channel: check + sentry abort (mint-scoped per ADR-0044) — both executors call
    the identical, unmodified `faff sentry check` CLI; a `tripped:true, intervention:abort`
    verdict is actioned via the existing `faff sentry abort --run-dir <dir> --worktree
    <path>` path (ledger-mark aborted-resumable + best-effort WIP commit) — the same
    write path FAFF-49/ADR-0034 already ships, never a second implementation.
  cancellation_story: ledger-mark (`sentry abort` → `aborted-resumable`), not a live
    process interrupt. Reconciled with "no mid-issue cancellation": the poller does NOT
    kill the in-flight build subagent's process — it marks the run ledger, commits WIP
    best-effort, and leaves the issue undispatched-but-resumable. The next dispatch (or a
    human re-invoking /faff-graft) picks it up cold. FAFF-332 (this run, NO-GO on
    SendMessage live-resume) is the adjacent seam for anything richer — its own
    recommendation is exactly this checkpoint + cold-re-dispatch shape (FAFF-329/FAFF-402),
    which the poller's ledger-mark composes with directly rather than inventing a live-kill
    mechanism this ADR does not need and FAFF-332 already found no safe path to.
  regress_termination: no new supervisory lane, so no new "who watches this" question in
    the ADR-0039 sense — the poller is ~30 lines of deterministic polling that calls the
    SAME sentry check CLI the checkpoint already calls (probe-verified below); it carries
    no judgment, no LLM context, and re-derives no detection math. Its own failure modes
    are answered the way ADR-0039 answered Sentry's ("a failure-mode register composing
    shipped precedents, no new lane"):
      - Poller never spawned / crashes silently / orphaned past run-done → the run's
        sentry advisories simply go quiet; this degrades to EXACTLY today's cooperative-
        only coverage (the checkpoint + hook still catch what they already catch), not a
        false all-clear — the poller is additive-only, never a replacement for the
        checkpoint consult FAFF-352 ships.
      - A wedged/dead poller is not itself distinguished from "the run finished
        normally" by a new mechanism — it is caught the same way an unattended L4 run's
        overall health already is: budget spend/time backstops, run-done's floor, and (once
        FAFF-386 ships) the andon/morning-brief surfacing an unattended run with no recent
        sentry advisory activity. The watchdog's own liveness is human-observable, never
        machine-supervised — the regress terminates at the human, exactly as ADR-0039
        settled it for Sentry-2's who-watches-the-watcher question.
      - Forged/tampered ledger content reaching the poller is the SAME residual ADR-0034's
        FAFF-324 amendment already named (vectors 4/4b) and tracked as a follow-up guard —
        this ADR does not reopen it, does not claim to close it, and does not treat it as a
        reason to reject the poller (every locus available to this spike shares it, per the
        Context section's container finding, except a host-external cron/launchd install
        this repo has no wiring for and, per ADR-0010, has explicitly declined to own).
  rejected:
    - locus: cron / OS scheduler (launchd, crontab)
      disqualifying_evidence: >
        Genuinely the only candidate that crosses the container boundary for real (a
        host-level job reading the bind-mounted .faff/ tree from outside the uid/fs the
        build lane shares) — but faff has no install precedent for it (unlike
        hooks-ensure.js's settings.json registrar, there is no single idempotently-
        rewritable target: crontab entries must be diffed against a user's unrelated jobs,
        launchd plists are a distinct macOS-only mechanism, and no shared cross-platform
        primitive exists). ADR-0010 already settled that faff "implements no sandbox of
        its own" and stays "adoptable, not all-encompassing" — a faff-owned host-level
        scheduler installer is exactly the kind of infra-ownership-outside-the-container
        that decision declined to take on. Disqualified on criterion 5 (install wiring) and
        in tension with criterion 7 (proportionality: the composite above delivers the
        same cooperation-independence property, criterion 1, at a fraction of the wiring
        cost) — not on criterion 1, where it would in principle also pass.
    - locus: CI-side watchdog (a `schedule:`-triggered GitHub Actions workflow)
      disqualifying_evidence: >
        Confirmed by direct inspection: `.github/workflows/validate.yml` and
        `release-please.yml` are the only two workflows in the repo, both `on:
        pull_request` / `push: [main]` — no `schedule:` trigger exists anywhere.
        Independently confirmed `.faff/` is gitignored (`git check-ignore -v .faff/` →
        matches `.gitignore:15:.faff/`) — run ledgers are local-only state a CI runner
        never sees, with or without a schedule trigger. Disqualified outright on criterion
        3 (liveness-contract fit: CI has no path to `owner.last_heartbeat` at all) — this is
        a structural, not a wiring-cost, disqualification. Adjacent to FAFF-363
        (artifact-time attestation), which is a different, already-named seam for
        post-merge checks, not in-flight supervision.
    - locus: Stop-hook staleness check, standalone (not composed with the poller)
      disqualifying_evidence: >
        Probe-confirmed by direct reading of `runcheck.js`'s FAFF-205 comment: Stop fires
        "on EVERY session's turn-end" — but a solo, wall-clock-runaway overnight
        `/faff-beep-boop` session (the exact motivating scenario in the spec's WHY) has, by
        construction, no OTHER session on the machine to coincidentally reach turn-end and
        trigger the shared check against the stuck run's ledger; and the stuck session's
        OWN Stop event is exactly the event that does not fire while it is stuck. Standalone,
        the hook only ever covers the "another concurrent session happens to end its turn"
        case — real, but not sufficient for the primary solo-overnight-run threat model.
        Not rejected outright: retained as the opportunistic-assist half of the composite
        (criterion 5's install cost is near-zero, reusing the exact hooks-ensure.js
        precedent), but it alone does not satisfy criterion 1 (independence) for the
        run shape the spec exists to protect.
  follow_ups:
    - "Implement the mint-scoped detached sentry poller: spawn-detach at run-mint in
      faff-beep-boop's skill prose, PID/lifecycle recorded on the run ledger, explicit
      stop-at-run-done, defensive self-stop when the ledger's own owner.status leaves
      \"running\" (bounds the orphan-process risk this ADR's probe demonstrated). Wires
      the check→abort action channel using the unmodified `faff sentry check`/`sentry
      abort` CLI surface — no detection-math changes."
    - "Extend hooks-ensure.js's FAFF_STOP_HOOKS family with a staleness-triggered sentry
      consult, reusing runcheck.js's ownership/liveness gate shape (FAFF-205) so a foreign
      still-live run is never falsely tripped — the opportunistic-assist half of this ADR's
      composite."
    - "Wire the poller's/hook's tripped verdict to FAFF-386 (andon) once that alerting
      channel ships, so a human is paged on abort/pause rather than relying on the next
      morning brief; until FAFF-386 lands, the existing ledger-mark + tracker-comment
      surface (as `sentry abort` already writes) is the interim visibility path."
```

## Consequences

- **The gap this spike was opened to close is closed on paper, not yet in code.** Nothing in this ADR ships a locus — `faff-beep-boop` still spawns no poller and `hooks-ensure.js` still registers no staleness-triggered Stop consult until the follow-up tickets above land. Until then, sentry invocation remains exactly as cooperative as it is today (FAFF-352's checkpoint + the plain Stop hooks); this ADR is the recorded design the follow-up implements against, not a behaviour change.
- **The composite is additive, never a replacement.** The poller and the extended hook both call the same `faff sentry check` the checkpoint already calls; neither removes or weakens the existing cooperative consult (FAFF-352). A poller that never gets built, or gets built and later removed, degrades the run to exactly today's coverage — never below it.
- **The un-subvertability claim this ADR relies on is intentionally narrow.** Both halves of the composite share the same container/uid boundary as the build lane (confirmed for this run's own execution environment) and therefore inherit ADR-0034's FAFF-324-tracked shared-fs residual (ledger-content forgery, vectors 4/4b) unchanged. This ADR does not claim to close that residual and does not treat it as a reason to prefer a heavier locus — every locus this spike could realistically wire shares it except a host-external cron/launchd install, which is rejected above on install-wiring grounds, not on this axis. FAFF-324's own follow-up guard (wiring `sentry check` through `integrityGate`'s `detection` consumer) remains the right place to close that residual, orthogonal to which locus invokes the check.
- **No new supervisory lane, no new regress question.** The poller is deterministic polling code with no judgment and no LLM context — it does not reopen ADR-0039's watcher-of-watchers rejection. Its own failure modes (crash, orphan, tamper) are answered by composing existing backstops (budget/time, run-done, the tracked FAFF-324 guard, and — once shipped — FAFF-386's andon) and terminate, deliberately, at a human observer rather than at a further machine watcher.
- **Cancellation stays ledger-mark-only, consistent with FAFF-332's NO-GO.** The watchdog never attempts a live process interrupt of an in-flight build subagent; it composes with the existing `sentry abort` → `aborted-resumable` → cold-re-dispatch path, the same shape FAFF-332 (this run) independently recommended as the terminal answer for resuming interrupted work. If a future spike revisits live interrupt/resume, it does so against FAFF-332's NO-GO finding, not against this ADR's cancellation story, which does not depend on live resume at all.
- **Orphan-process risk is named, bounded, not eliminated.** The throwaway probe in this spike (`spawn-detached.js` / `poll-loop.js`, not merged) demonstrated a detached poller reparents to PID 1 and survives its launching shell's exit (PPID transitions to 1), and that a sentinel-file stop signal cleanly terminates it — but also that nothing external reaps a poller whose stop signal never arrives (e.g., the orchestrator crashing before writing run-done). The recorded design's defensive self-stop (exit when the ledger's own `owner.status` leaves `"running"`) bounds this to "at most one poll interval past the run's actual end," not zero — the implementation ticket owns tightening this further if needed.
- **Timebox discharged.** All four named candidates plus the composite converged to a recorded decision inside this single spike unit, per the spec's chosen timebox — no park-with-findings was required.

## Probe evidence (throwaway, not merged)

Two small scripts (`spawn-detached.js`, `poll-loop.js`) were written to a scratch directory outside this repo, run against a synthetic fixture run dir (`owner.status: "running"`, a fixed old `last_heartbeat`), and discarded — nothing from this probe is committed.

- **Cooperation independence (criterion 1), demonstrated:** the spawning shell process exited immediately after launch; the poller's PID showed `PPID=1` (reparented to init) and kept polling `faff sentry check --json` on a fixed interval with zero further input from the process that spawned it.
- **Correct, real derailment detection, demonstrated:** every poll against the stale fixture ledger returned a genuine `wall-clock-runaway` trip (`heartbeat-staleness`, `intervention: "abort"`) from the unmodified, unmocked `faff sentry check` CLI — not a synthetic/mocked verdict.
- **Clean lifecycle stop, demonstrated:** writing a stop-sentinel file into the fixture run dir caused the very next poll cycle to log the sentinel and exit(0) cleanly, with the process gone on the next `ps` check.
- **Execution-boundary finding, demonstrated:** `id` / `hostname` / `DOCKER_HOST` in this very probe's shell confirm the probe itself ran inside the same claude-box container as the rest of this build session — corroborating the Context section's claim that an in-container poller shares the build lane's uid/fs boundary (it does not, on its own, cross the boundary the FAFF-324 residual concerns).

## Paper-trace of the spec's first Scenario

> Given a run ledger with `owner.status "running"` and `owner.last_heartbeat` older than the staleness window, and an orchestrator session that reaches no further checkpoint and no turn-end — when the recorded watchdog design operates — then `faff sentry check` executes against that run dir within a bounded, stated delay, and its verdict reaches the recorded action channel with no orchestrator step involved.

Traced against the recorded design: the mint-scoped poller was already running (spawned at run mint, independent of this session), so it needs no cooperation from the now-stuck orchestrator session to keep polling. Its next scheduled tick (bounded by the poll interval, the "stated delay") calls `faff sentry check --run-dir <this run>`, which reads exactly `owner.status`/`owner.last_heartbeat` as today and returns the same `wall-clock-runaway` trip the probe reproduced against the fixture. The poller's action-channel step then calls `faff sentry abort --run-dir <dir> --worktree <path>`, the existing ledger-mark path — no orchestrator step is on the critical path from "heartbeat goes stale" to "ledger marked aborted-resumable." The probe evidence above exercises the identical `sentry check` call this trace depends on; only the mint-time spawn wiring and the run-done stop wiring remain unbuilt (named in the follow-ups).
