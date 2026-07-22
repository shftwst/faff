# FAFF-553 — `faff heartbeat` strict flag parsing + sentry in-flight staleness grace

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-553.

This spec addresses FAFF-553 for the build agent and human reviewers: it closes the silent no-op in the `faff heartbeat` CLI's argument handling and teaches sentry's run-scoped wall-clock-runaway verdict to distinguish an in-flight long build turn from liveness loss.

## 1. WHY — problem and principles

**The load-bearing model:** run liveness is a cooperative signal — the orchestrator and build subagents tick a dedicated heartbeat file through one sanctioned write path (`faff heartbeat`), and every safety reader (runcheck, sentrycheck, sentry) judges the run alive by that file's freshness. The whole chain is only as honest as the tick, so a tick that silently does nothing poisons every reader downstream.

**Problem:** `faff heartbeat` accepts only positional `RUN_DIR` plus `--unit`/`--json`/`--selftest`, but its hand-rolled parser silently drops any unknown flag and lets the flag's *value* leak into the positional slot. `faff heartbeat --run <id>` therefore resolves `<id>` (a run id, not a path) as `RUN_DIR`, finds no `run-ledger.json` there, and takes the deliberate soft no-op branch — exit 0, nothing written (reproduced live 2026-07-22). During the 2026-07-18 `p2-task-api` testbed run every tick used that form, so the heartbeat mtime froze, and `faff sentry check` tripped `wall-clock-runaway` / `intervention: abort` on `tripped_on: heartbeat-staleness` (~1400s) while the run was shipping work correctly. Separately, even with correct ticks, a run-scoped stale heartbeat during one legitimately long build turn is indistinguishable from a hung run — the cooperative checkpoint can't fire mid-turn.

**Design principles:**

**Loud beats lenient at the resolution seam; lenient stays at the write seam.** A caller that *names* a run target wrongly must hear about it (that is the F4 footgun); a transient filesystem fault on an otherwise-correct tick keeps the existing loud-stderr-but-exit-0 degrade — a single failed tick is not fatal and callers retry on the next tick. Reject an implementation that inverts either half.

**No new liveness mechanism.** The fix reuses signals sentry already derives (the FAFF-327 in-flight member list from `events.jsonl` + ledger) and the existing intervention ladder. Recorded pids stay un-consulted (FAFF-233: worker pids roll). Reject an implementation that adds a new liveness source or config knob for this.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node (dep-free) | `cmdHeartbeat` arg parsing + `resolveHeartbeatRunDir` — the flag fix lands here |
| `plugin/skills/faff/bin/lib/sentry.js` | Node (dep-free) | `evalWallClock`, `evaluateDerailment`'s ladder loop (the FAFF-327 member pause-cap precedent), `sentryInflightMembers` |
| `plugin/skills/faff/bin/faff` | Node | CLI usage doc line for `heartbeat` (and `sentry`) |
| `test/heartbeat.test.mjs`, `test/sentry.test.mjs` | node:test | Existing coverage the new cases extend |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | Node | Consults `sentry check` unchanged — inherits the in-flight grace for free |

**Scope:** a two-part hardening of the governance CLI's liveness chain; no skill prose changes (every shipped skill already calls `faff heartbeat "$run_dir" [--unit <issue>]` positionally).

## 2. OUT OF SCOPE

- **Suite-wide strict-flag audit** — other subcommands may tolerate unknown flags too. Why excluded: each has its own parse idiom and blast radius; this ticket fixes the one that gates a safety hook. Extension point: the same reject-unknown-flags pattern in each `cmd*` entry in `bin/lib/*.js`.
- **An id→dir resolution mode (`--run <id>` as a real flag)** — why excluded: it would add a second resolution vocabulary for the same thing; callers already hold the dir (`$FAFF_RUN_DIR`, `BuildDispatch.run_dir`). Extension point: `resolveHeartbeatRunDir` if a future caller genuinely only has an id.
- **Sentry acting scope (mint-scoped abort, L3 advisory vs L4 binding)** — unchanged; this ticket only corrects *which* intervention the verdict maps to. Extension point: the beep-boop/lights-out consult sites.
- **The run-ledger write races in the same file** — tracked as FAFF-575 (`atomicWriteLedger` fixed `.tmp` path, check-then-write fence). Why excluded: independent concern, separately ticketed.
- **The stale FAFF-234 "field-merge" wording in `faff-beep-boop/SKILL.md`** (superseded by FAFF-355's dedicated file) — docs drift, not this bug. Extension point: a docs tidy pass.

## Already shipped against this surface

Related Done work — context, none of it supersedes this premise (verified live: the silent no-op still reproduces on current `main`):

- FAFF-234 (Done) — mandated mid-step heartbeat ticks in graft/review; assumes the tick actually writes.
- FAFF-355 (Done) — the dedicated single-value heartbeat file + atomic write idiom this spec leaves untouched.
- FAFF-327 (Done) — fleet member heartbeats + the member-scoped wall-clock pause-cap; this spec's run-scoped grace deliberately mirrors that cap's shape and reuses its in-flight derivation.
- FAFF-470/471 (Done) — the detached sentry poller + Stop-hook consult; both consume `sentry check` output and inherit the fix without change.
- FAFF-233/205/235 (Done) — heartbeat-only liveness and foreign-run warn-don't-block posture; constraints this spec preserves.

## 3. WHAT — vocabulary and interfaces

**Vocabulary:** *explicit target* = a run dir named by the caller (positional `RUN_DIR` or the new `--run-dir` flag). *Ambient resolution* = no explicit target; the dir comes from `$FAFF_RUN_DIR` or latest-under-`.faff/runs`. *In-flight member* = an issue with a `build-start` event and no terminal ledger outcome (the existing FAFF-327 derivation, `sentryInflightMembers`).

**CLI surface after the change:**

```
heartbeat [RUN_DIR] [--run-dir DIR] [--unit ISSUE] [--json] [--selftest]

exit 0  — wrote the heartbeat (written:true), or a sanctioned soft no-op (written:false):
          ambient resolution found no run, or owner.status != "running", or a
          transient fs write fault (loud on stderr)
exit 2  — usage: unknown flag (e.g. --run), --unit invalid, or RUN_DIR and
          --run-dir both given; malformed ledger (existing)
exit 3  — an EXPLICIT target that is missing or has no run-ledger.json (loud, named on stderr)
```

- The known-flag set is closed: `--run-dir`, `--unit`, `--json`, `--selftest`. Any other `--*` token exits 2 with a usage message naming the legal flags; the message special-cases `--run` to point at `--run-dir`/positional. Flag values never leak into the positional slot.
- `--run-dir DIR` is exactly equivalent to positional `RUN_DIR` (consistency with `sentry check` / `budget check` / `governance-check` — the inconsistency is what made the testbed agent invent a flag). Giving both exits 2.
- An empty-string positional (`faff heartbeat ""`, an unset shell var) stays **ambient**, not explicit — preserving "safe to call unconditionally".

**Sentry verdict shape (additive evidence only):** the run-scoped `wall-clock-runaway` verdict, when tripped on `heartbeat-staleness` with ≥1 in-flight member, carries `evidence.in_flight: [<issue ids>]` and `evidence.grace: "in-flight-unit"`, and contributes at most `pause` to the intervention ladder. All other cases are byte-identical to today.

## 4. HOW — behaviour

**Heartbeat parsing** (in `cmdHeartbeat`, before any resolution):

```
PROCEDURE parse_heartbeat_args(args):
  1. --selftest short-circuits (unchanged)
  2. Scan args left to right:
     a. a known value-flag (--run-dir, --unit) consumes its value; missing value → exit 2
     b. a known boolean flag (--json) is noted
     c. any other token starting with "-" → exit 2, usage naming legal flags
        (message names --run explicitly: "did you mean --run-dir <dir>, or positional RUN_DIR?")
     d. a bare token is a positional candidate; a second bare token → exit 2
  3. IF positional AND --run-dir both present → exit 2
  4. explicit_target := positional or --run-dir value (nil if neither; "" coerces to nil)
```

**Heartbeat resolution** (replacing the current silent fall-through):

```
PROCEDURE resolve_and_guard(explicit_target):
  1. IF explicit_target:
     a. IF explicit_target is not a directory, OR has no run-ledger.json:
        → stderr "heartbeat: <target> is not a run dir (no run-ledger.json)" ; exit 3
     b. run_dir := explicit_target
  2. ELSE run_dir := $FAFF_RUN_DIR or latestRunDir(findRoot())
     a. IF nil or no run-ledger.json → soft no-op, exit 0, written:false   # unchanged
  3. Everything downstream (ledger read guard, owner.status gate, atomic write,
     --unit member file, transient-fault degrade) is byte-identical to today.
```

**Anti-pattern:** making the transient fs write fault exit non-zero. Why: a single failed tick mid-run is recoverable by the next tick; a non-zero exit would teach callers to treat ticks as fatal and break the "call unconditionally" contract. The fault is already loud on stderr.

**Sentry in-flight grace** (in `evaluateDerailment`'s ladder loop, beside the FAFF-327 member cap — `sentryInflightMembers` is already computed in scope there):

```
PROCEDURE ladder_mapping(verdict v, inflight):
  ... existing mapping ...
  IF v.signal == "wall-clock-runaway" AND v.scope is absent (run-scoped)
     AND v.evidence.tripped_on == "heartbeat-staleness"
     AND v.evidence.run_elapsed_secs is under run_elapsed_ceiling_secs
     AND inflight is non-empty:
       annotate v.evidence.in_flight := [inflight issue ids]
       annotate v.evidence.grace := "in-flight-unit"
       mapped := "pause"            # cap, mirroring the member-scoped cap
  # run-elapsed trips, and staleness with NO in-flight member, keep mapped "abort"
```

The verdict itself stays severity `trip` (`tripped: true`); only the contributed intervention is capped — same shape as the member cap, so `sentrycheck --hook` and `sentry-poller` consume it with zero changes. `evalWallClock` itself stays byte-identical (the cap and annotation live at the aggregation seam, where the in-flight list already exists).

**Deliberate contract changes (name them, don't discover them in review):**

- The existing test "no ledger at the resolved run dir → soft no-op, never an error" (`test/heartbeat.test.mjs`) passes an **explicit** dir and asserts exit 0. This spec re-scopes that contract to ambient resolution only: the test is rewritten as two cases — explicit ledger-less dir → exit 3, ambient no-run → exit 0 soft no-op.
- The shipped sentry docs (the `sentry` row in `docs/guide/cli.md` and the matching `bin/faff` doc line) state "if every member is stalled the run heartbeat file itself goes stale too, so the run-scoped wall-clock-runaway still trips abort exactly as before". Under the in-flight grace that case yields `pause` until the elapsed ceiling; both doc surfaces are updated to say so.

**Edge cases:**

- Staleness **and** run-elapsed both over threshold → `tripped_on` is `heartbeat-staleness` today (staleTrip wins the ternary); the grace must not mask the elapsed breach. Rule: apply the cap only when `run_elapsed_secs` is under `run_elapsed_ceiling_secs`.
- A dead-mid-build run (member started, everything crashed) shows an in-flight member forever → staleness maps to `pause` until the `run_elapsed_ceiling_secs` backstop (default 14400s) trips `abort`. Accepted trade — see Failure modes.
- No events surface (sequential/legacy runs with no `build-start` events) → in-flight list is empty → behaviour byte-identical to today.

**Failure modes:**

- **The grace delays hard-stop of a genuinely hung in-flight run.** How you'd know: repeated `pause` verdicts carrying the same `in_flight` member across consults in `sentry-poller.log`/run logs, then the elapsed-ceiling abort. What it means: accepted — detection latency moves from stall-window to elapsed-ceiling for exactly the mid-build case; the ceiling is the unchanged backstop, and at L3 the whole signal is advisory anyway.
- **Strict flags could break an unknown out-of-tree caller.** How you'd know: exit 2 with the usage message in that caller's logs. What it means: proceed — repo-wide grep shows every shipped call site is positional; an out-of-tree caller passing an invented flag is precisely the bug this fixes.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir with a running-owner ledger
When `faff heartbeat --run <run-id>` is invoked
Then the process exits 2, writes nothing, and stderr names the legal flags and suggests --run-dir
```

```
Given a path that is not a run dir (no run-ledger.json)
When `faff heartbeat <path>` or `faff heartbeat --run-dir <path>` is invoked
Then the process exits 3 and stderr names the path and the missing ledger
```

```
Given no explicit target, no $FAFF_RUN_DIR, and no .faff/runs
When `faff heartbeat` is invoked
Then the process exits 0 with written:false (the sanctioned ambient soft no-op, unchanged)
```

```
Given a running run whose heartbeat is older than stall_window_secs, with one in-flight member and run-elapsed under the ceiling
When `faff sentry check` evaluates it
Then the wall-clock-runaway verdict trips with tripped_on heartbeat-staleness, evidence.in_flight naming the member, and the aggregate intervention is pause
```

```
Given a running run whose heartbeat is older than stall_window_secs, with NO in-flight member
When `faff sentry check` evaluates it
Then the aggregate intervention is abort (unchanged)
```

## 6. Design decision rationale

**How should `--run <id>` be handled?** Options: (i) accept it, resolving `.faff/runs/<id>` — pro: matches what the agent reached for; con: second resolution vocabulary, id vs dir ambiguity; (ii) reject unknown flags loudly — pro: kills the whole class (any future invented flag), minimal surface; con: caller must correct.
**Chosen:** reject unknown flags with exit 2, message special-casing `--run` — the failure class is "invented flag silently no-ops", not "id support missing"; every sanctioned caller already holds the dir.

**Add `--run-dir` or stay positional-only?** Options: positional-only (smallest diff) vs adding the flag. The sibling read-side commands (`sentry check`, `budget check`, `governance-check`) all take `--run-dir`; heartbeat being the odd one out is the likely reason the testbed agent invented a flag.
**Chosen:** add `--run-dir DIR` as an exact positional equivalent (both → exit 2); update the CLI doc line + `docs/guide/cli.md` row and keep `lint-cli-doc` green.

**What does an explicit-but-wrong target do?** Options: soft no-op (today), warn + exit 0, exit non-zero.
**Chosen:** exit 3 + stderr (mirrors sentry's no-run-dir convention). The soft no-op contract exists for *ambient* callers ("an interactive non-run context must never error") and is preserved there; a caller that names a target wrongly is the F4 bug and must fail loud. Exit 2 stays usage/malformed-ledger; exit 3 is target-resolution.

**How does sentry distinguish an in-flight long turn from liveness loss?** Options: (i) checkpoint-anchored grace window (new threshold knob); (ii) transcript/pid probes (rejected — FAFF-233, machine-specific surface); (iii) cap the run-scoped staleness trip at `pause` while a member is in flight, elapsed ceiling unchanged as backstop.
**Chosen:** the pause-cap (iii) — it reuses the already-derived in-flight list, adds no knob and no liveness source, mirrors the shipped FAFF-327 member-cap shape exactly, and keeps a genuine hang bounded by the existing elapsed ceiling. The verdict still trips (visible, logged); only the action softens while work is provably dispatched.

**Where does the cap live?** Options: inside `evalWallClock` (verdict born capped) vs the aggregation ladder loop.
**Chosen:** the aggregation loop, beside the member cap — `evalWallClock` stays a pure per-signal predicate with today's byte-identical output shape, and the in-flight list is already in scope at the loop. The evidence annotation rides the same seam.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** `sentryInflightMembers(s.events, s.ledger, profile)` is computed before the ladder loop in `evaluateDerailment` (true on current `main` — it is derived for `evalMemberStall` immediately above the loop). Validate by reading `bin/lib/sentry.js` before starting.
- **Assumes:** no shipped skill or test invokes `faff heartbeat` with `--run`/`--run-dir` today (verified by repo grep 2026-07-22 — all call sites are positional). Validate with `grep -rn "faff heartbeat" plugin/ test/`.

## 8. DONE — definition of done

### From WHY / WHAT (heartbeat CLI)
- [ ] `faff heartbeat --run X` exits 2 with a usage message naming the legal flags and suggesting `--run-dir`; nothing is written
- [ ] Any other unknown `--flag` exits 2; flag values never leak into the positional slot
- [ ] `faff heartbeat --run-dir <dir>` behaves exactly as positional `<dir>`; giving both exits 2
- [ ] An explicit target (positional or `--run-dir`) that is missing or has no `run-ledger.json` exits 3 with the path named on stderr
- [ ] Ambient resolution with no run found still exits 0 `written:false` (soft no-op unchanged); empty-string positional counts as ambient
- [ ] `owner.status != "running"`, malformed-ledger (exit 2), transient-write-fault (stderr + exit 0), and `--unit` behaviours are byte-identical to today
- [ ] The `heartbeat` doc line in `bin/faff` and the `heartbeat` row in `docs/guide/cli.md` name the new flag + exit codes; `faff lint-cli-doc` stays green

### From HOW (sentry)
- [ ] Run-scoped `wall-clock-runaway` tripped on `heartbeat-staleness` with ≥1 in-flight member and elapsed under ceiling → aggregate intervention `pause`; evidence carries `in_flight` + `grace: "in-flight-unit"`
- [ ] Same staleness trip with zero in-flight members → `abort` (unchanged)
- [ ] `run-elapsed` ceiling trip → `abort` regardless of in-flight members (the holdout scenario)
- [ ] A run with no build-start events produces byte-identical sentry output to today
- [ ] Member-scoped cap (FAFF-327) and every other signal's mapping untouched
- [ ] The `sentry` doc line in `bin/faff` and the `sentry` row in `docs/guide/cli.md` reflect the in-flight grace (superseding the "all members stalled still trips run-scoped abort" wording)

### Tests
- [ ] `test/heartbeat.test.mjs` covers the exit-2 unknown-flag, exit-2 both-targets, exit-3 explicit-missing, and ambient-soft-no-op cases; the existing explicit-dir soft-no-op test is rewritten per the named contract change
- [ ] `faff sentry --selftest` table extended with the in-flight-grace pause case, the no-in-flight abort case, and the elapsed-backstop abort case; `test/sentry.test.mjs` green
- [ ] Full `node --test test/` green

**Integration smoke test:**

```
1. Mint a temp run dir with a running-owner ledger + a build-start event for ISSUE-X
2. `faff heartbeat --run run-xyz`            → exit 2, heartbeat file absent
3. `faff heartbeat --run-dir <dir> --json`   → exit 0, written:true, file present
4. Age the heartbeat past stall_window; `faff sentry check --run-dir <dir> --json`
   → tripped:true, wall-clock-runaway, intervention "pause", evidence.in_flight == ["ISSUE-X"]
5. Remove the build-start event; re-check → intervention "abort"
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
