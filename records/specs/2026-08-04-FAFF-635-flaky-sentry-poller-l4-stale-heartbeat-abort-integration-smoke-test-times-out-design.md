# FAFF-635 — nlspec: settle the sentry-poller L4 abort-timing flake

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-635.

**Artifact:** a natural-language build spec for FAFF-635, "Flaky: sentry-poller L4 stale-heartbeat abort integration smoke test times out under CI load." **Audience:** the build agent that will make the test-only change, and the human reviewer gating it. **The one file that changes is `test/sentry-poller.test.mjs`** — no production code moves.

## Already shipped against this surface

A sibling ticket, **FAFF-686 (PR #535, merged to `main` 2026-08-04)**, already fixed a *different* failure mode of this same test — the checkpoint-observation race. The abort child writes the run ledger; the poller parent appends the `sentry-checkpoint` event and *then* the `abort-actioned` log line, in that fixed order. The old test read `events.jsonl` inside that window and sometimes saw zero checkpoints. 686 closed that by:

- Adding a settling wait — `const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: 10000 })` — *before* reading `events()`, because the `abort-actioned` line is a strict happens-after of the checkpoint append.
- Splitting the count assertion into two lines with distinct messages: `assert.ok(checkpoints.length >= 1, …)` (the append happened) and `assert.equal(checkpoints.length, 1, …)` (the per-tick guard didn't regress).

**The build agent must NOT redo any of that.** The checkpoint-observation race is closed. 686's spec explicitly declared the *abort-landing-within-deadline* flake out of scope and handed it here. FAFF-635's remaining, load-bearing delta is only the **wall-clock deadline race** — the abort child landing on the ledger, and the poller process exiting, within their time budgets on a loaded CI runner.

**Rebase note.** 635 branches on top of 686. When you start, `test/sentry-poller.test.mjs` already contains 686's settling wait and split assertions. That is your baseline; do not reintroduce or revert it.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** The test's L4 poller runs as a **detached, unref'd child process** (spawned by `sentry-poller start` at `sentry-poller.js:319`, `{ detached: true, stdio: "ignore" }`). Under heavy CI parallelism the OS can scheduling-starve that detached process — and the two blocking `spawnSync` children it runs each tick (`faff sentry check`, `faff sentry abort`). Nothing about the *logic* is wrong; the process just doesn't get enough CPU to finish its work inside the test's wall-clock deadlines. So the flake is a **timing budget** problem, not a correctness problem, and the fix lives in how long the test is willing to wait — not in what it asserts.

**Problem statement.** The L4 integration smoke test at `test/sentry-poller.test.mjs:174` goes red on the first `validate`-lane CI run and passes on an identical `gh run rerun --failed`. It has flaked on unrelated PRs and on main's own head. The change sizes the test's abort-landing and poller-exit deadlines to a defensible worst-case CI scheduling budget so the test passes on the first run without re-running.

**Design principles.**

**The trip is already deterministic — only the landing races.** The test sets `owner.last_heartbeat: isoAgo(2000)` (2000 seconds stale) against an L4 `stall_window_secs` default of 600–900s. The staleness *decision* trips on the first tick, every time, with no dependence on timing. What varies under load is *when* the abort lands on the ledger and *when* the poller exits. Any fix must preserve that: we are widening a deadline on a guaranteed event, not gambling on a probabilistic one.

**Waits are predicate-polled, so a generous ceiling is free on the happy path.** The `waitUntil(predicate, { timeoutMs, intervalMs = 200 })` helper polls every 200ms and returns the instant its predicate is true. On a fast runner it returns in well under a second regardless of the ceiling. Raising a ceiling adds cost *only* when the runner is genuinely starved — which is exactly the case we're trying to tolerate. This is the property that makes "wait longer" defensible rather than "sleep and hope."

**No new inheritance seam for a fake clock.** The `$FAFF_NOW_MS` override (`sentry.js:680`, `budget.js:798`) is per-invocation and caller-typed, and is *deliberately not inherited by child processes*. Reaching the detached poller and its detached-context children with an injected clock would require inventing the inheritance seam those comments were written to forbid — a production change to a hermetic-override contract, to fix a test. Off-limits.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/sentry-poller.test.mjs` (~L174–207) | JS (node:test) | The only file this issue edits — the L4 smoke test and its deadlines |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | JS | Read-only here. `runLoop` (L241) runs a tick before its first sleep, so the trip fires immediately; the abort is a blocking `spawnSync` (L253); the poller itself is the detached process (L319) |
| FAFF-686 / PR #535 | — | Merged predecessor; owns the settling wait + split assertions this rebases onto |
| FAFF-301, FAFF-403 | — | Prior flake precedents (relative fixture timestamps; injected clock for single-process due-date tests) |

**Scope statement.** This is a test-stability fix inside the sentry-poller watchdog's integration coverage; it changes deadline sizing only, leaving both the poller's production behaviour and 686's observation-ordering fix intact.

---

## 2. OUT OF SCOPE

- **The checkpoint-observation race** — already fixed by FAFF-686 (settling wait + split assertions). *Extension point:* n/a; do not reopen. Rebase onto it.
- **Any change to `sentry-poller.js` production ordering or semantics** — the flake is a test-side deadline, not a poller bug. Mirrors 686's boundary. *Extension point:* if the poller's tick work genuinely needs to be faster, that is a separate performance ticket against `runLoop`, not this one.
- **Injecting a fake clock into the detached poller** — rejected on design grounds (see §6); would require a forbidden inheritance seam and wouldn't fix a CPU-starvation flake anyway. *Extension point:* if a future single-process poller path ever needs deterministic time, `$FAFF_NOW_MS` already covers the caller-typed case (FAFF-403 pattern).
- **Speeding the poll interval below 1s** — `--interval-secs` has a hard floor of 1, is explicit-flag-only, and has no env override by design (`sentry-poller.js:49-53`). The floor is not a knob this fix can turn.
- **A general test-harness "CI mode" / deadline-multiplier framework** — rejected as unneeded surface for a two-deadline fix (see §6). *Extension point:* if many tests later need CI-scaled deadlines, a shared helper in the test-support module is where it would live.

---

## 3. WHAT — the shape of the change

**Vocabulary.**

| Term | Definition |
|---|---|
| Abort-landing budget | Max wall-clock the test waits for `owner.status` to reach `aborted-resumable` *and* for the `abort-actioned` log line to appear — the same physical event, observed two ways |
| Poller-exit budget | Max wall-clock the test waits for the poller PID to stop being alive after the abort is actioned |
| Predicate-polled wait | `waitUntil(fn, { timeoutMs })` — returns the moment `fn()` is true, else fails at `timeoutMs`; never a fixed sleep |

**What changes, concretely.** Three wall-clock ceilings currently bound this test, all sized for an unloaded box. Raise them to one shared, documented worst-case budget per race:

```
CONSTANT ABORT_LANDING_BUDGET_MS = 30000   # was 10000
CONSTANT POLLER_EXIT_BUDGET_MS   = 20000   # was 5000

# These name a defensible CI worst-case, not a hope. See §6 for the derivation.
```

The three call sites they feed:

```
RECORD deadline_sites:
  ledger_wait        # ~L183-186: waitUntil(owner.status === "aborted-resumable")
                     #   → timeoutMs: ABORT_LANDING_BUDGET_MS
  settling_wait      # 686-owned line: waitUntil(log().includes("abort-actioned"))
                     #   → timeoutMs: ABORT_LANDING_BUDGET_MS   (same race, same budget)
  exit_wait          # ~L200: waitUntil(!pidAliveProbe(started.pid))
                     #   → timeoutMs: POLLER_EXIT_BUDGET_MS

  CONSTRAINT ledger_wait.timeoutMs == settling_wait.timeoutMs   # one budget, cannot drift
  CONSTRAINT every_assertion_from_686_and_before is preserved unchanged
```

**Why the settling wait is in this list even though 686 authored it.** 686 owns *what* that line asserts — "wait for `abort-actioned` before reading `events()`." 635 owns *how long* every abort-landing deadline may wait. They are orthogonal: raising `settling_wait`'s `timeoutMs` from 10000 to the shared budget changes the time budget only, not 686's observation-ordering guarantee or its split count assertions. If 635 raised the ledger wait but left 686's settling wait at 10s, the flake would simply relocate to that line — both bound the same abort-landing event. So the settling wait's timeout *must* move with the others. This is a budget edit on already-merged code at rebase time, not a parallel-development collision of the kind 686's spec warned against.

**Design decision markers** are collected in §6.

---

## 4. HOW — Behavior

**Approach.** Introduce the two named budget constants near the top of the L4 test (or the file's existing constant area), point the three deadline sites at them, and leave every assertion untouched. The single shared constant for the abort-landing race guarantees the ledger wait and 686's settling wait can never drift apart. No production file is touched; no assertion is weakened.

```
PROCEDURE apply_fix(test_file):
  1. Define ABORT_LANDING_BUDGET_MS = 30000, POLLER_EXIT_BUDGET_MS = 20000,
     each with a one-line comment justifying the number (see §6 derivation).
  2. ledger_wait   → timeoutMs: ABORT_LANDING_BUDGET_MS
  3. settling_wait → timeoutMs: ABORT_LANDING_BUDGET_MS   # 686's line; budget only
  4. exit_wait     → timeoutMs: POLLER_EXIT_BUDGET_MS
  5. Leave intervalMs at its default (200ms) — polling cadence is not the problem.
  6. Do NOT touch: the aborted-resumable assertion, the abort-entry assertion,
     the split checkpoint assertions (>=1 and ===1), data.tripped===true,
     the abort-actioned match, handle().pid, or status.running===false.
```

**Edge cases.**

- **A genuine abort-path regression** (ledger never reaches `aborted-resumable`): the predicate stays false, `waitUntil` returns `false` at the budget, and `assert.ok(aborted, …)` fails — same failure, just surfaced later. Correctness detection is preserved; only the time-to-red on a truly broken build lengthens.
- **A wrong-but-present abort** (e.g. two checkpoint events, or `tripped !== true`): still caught immediately by the unchanged assertions, independent of any deadline.
- **Ceiling vs suite timeout:** `node --test` has no default per-test timeout, so a 30s ceiling does not breach a runner cap. If the suite is later run with an explicit `--test-timeout`, both budgets must stay comfortably under it (see failure modes).

**Anti-pattern:** replacing a `waitUntil` predicate with a fixed `await sleep(30000)` "to be safe." Why: it would make every green run 30s slower and still not guarantee the event landed — the exact opposite of the predicate-polled property that makes this fix free on the happy path.

**Anti-pattern:** loosening an assertion (e.g. `checkpoints.length >= 1` as the *only* count check, or dropping `status.running === false`) to make red runs pass. Why: that trades a timing flake for lost coverage — the ticket forbids reducing what the L4 path proves.

**Failure modes.**

- **The failure:** 30s / 20s are still not enough under some pathological CI contention, so the flake persists at a lower rate. **How you'd know:** the repeated full-suite runs in the DONE check still show an occasional first-run red on this test. **What it means:** the budget is under-sized for the real worst case — raise it further (the predicate-polling property means a larger ceiling costs green runs nothing), and only then reconsider whether the runner itself is the problem. Do not respond by weakening assertions.
- **The failure:** the abort genuinely never lands (real regression), and the larger ceiling makes a red build take ~30s longer to fail. **How you'd know:** a *consistent* (not intermittent) red on this test with a `waitUntil → false` timeout. **What it means:** this is correct behaviour, not a flake — the test is doing its job; investigate the poller, not the deadline.
- **The failure:** a future `--test-timeout` on the suite is set below 30s, silently truncating the ledger wait into a spurious failure. **How you'd know:** the test fails at exactly the suite timeout, not at the budget. **What it means:** keep the budgets under any suite-level cap, or lift the cap for this file.

---

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose owner.last_heartbeat is 2000s stale (deterministically past the ~600-900s stall window)
When sentry-poller start runs with --interval-secs 1 on a CPU-contended CI runner
Then the run ledger reaches owner.status "aborted-resumable" and an abort entry exists, within the abort-landing budget
And exactly one sentry-checkpoint event is present with data.tripped === true
And the sentry-poller.log contains abort-actioned
And the poller process exits, and sentry-poller status reports running: false — all within their budgets, on the first run, with no rerun
```

- Non-functional assertion: the abort-landing ceiling used by the ledger wait and by 686's settling wait MUST be one and the same constant — the two deadlines on the abort-landing race cannot diverge.

---

## 6. Design Decision Rationale

**How do we make the abort-landing / poller-exit deadlines robust under CI load — inject a deterministic clock, or size real-time deadlines to a CI-tolerant worst case?**

- *Deterministic clock injection (`$FAFF_NOW_MS`):* Pro — hermetic, no wall-clock at all. Con — fatal here on two counts. First, the seam is deliberately *not* inherited by child processes (`sentry.js:680`, `budget.js:798`); the poller is a detached child and its `sentry check` / `sentry abort` workers are further children, so reaching them needs a new inheritance seam those comments exist to forbid — a production change to fix a test. Second, and decisive: the flake is **CPU starvation of a real process**, not a clock-readable computation. A fake clock controls what `now()` *returns* inside a process; it cannot make a scheduling-starved process *run sooner*. Even with the seam, it wouldn't fix this flake. FAFF-403's injected-clock pattern fit because it was a single in-process due-date read — not a detached multi-process race.
- *CI-tolerant real-time deadlines:* Pro — directly addresses the actual cause (not enough wall-clock under contention); the waits are already predicate-polled, so a generous ceiling is free on green runs and only ever spends time on a genuinely starved runner; the trip itself is already deterministic, so we widen a deadline on a guaranteed event, never gamble on a flaky one. Con — a real abort-path regression takes longer to surface as red (bounded, acceptable — see failure modes). This is the FAFF-301 lineage: harden a timing flake by making the test's temporal assumptions match reality, not by hoping.

**Chosen:** CI-tolerant real-time deadlines, predicate-polled, sized to a defensible worst case. (decides: qa) — clock injection cannot reach the detached processes and would not fix a starvation flake even if it could; generous predicate-polled ceilings cost green runs nothing and preserve the deterministic trip.

**Fixed generous ceiling, or an env/CI-gated deadline multiplier?**

- *Env/CI multiplier (e.g. `process.env.CI ? ×N : ×1`):* Pro — keeps local deadlines tight so a genuine hang fails fast on a dev box. Con — adds a config surface (a new env/CI-detection branch) that must be documented and can rot, for a two-deadline test; and because the waits are predicate-polled, the "tight local deadline" buys almost nothing — a genuine local hang still fails, just ~25s later, on the rare red run.
- *Fixed generous ceiling:* Pro — no new knob, no CI-detection branch, nothing to rot; the predicate-poll property already delivers the "free on green" benefit the multiplier was chasing. Con — a genuine hang on a dev box also waits the full ceiling (bounded, rare, acceptable).

**Chosen:** a fixed generous ceiling with named constants and a justifying comment; no env/CI multiplier. (decides: qa) — minimal surface, and predicate-polling already gives the only benefit the multiplier offered.

**Derivation of the numbers (why 30s / 20s, not "some big number").** Per tick the detached poller does: `gatherFacts` → one blocking `spawnSync(faff sentry check)`, then on the trip one blocking `spawnSync(faff sentry abort)`, then an events append and a log append, then `return`. The trip fires on the *first* loop iteration, before any interval sleep (`runLoop`, `sentry-poller.js:241` — tick then sleep), so no interval delay is in the budget. On an unloaded runner this whole chain is well under a second; the observed flake proves 10s is not always enough under N-way parallelism, where each `node` child spawn can stretch to several seconds under contention. **Abort-landing budget = 30s** covers roughly 5–6× the two-child-spawn worst case with headroom. **Poller-exit budget = 20s** covers node process teardown of the detached poller under the same contention after `runLoop` returns. Both are ceilings a predicate returns well inside of on any healthy run.

**One shared constant for the abort-landing race, or per-site literals?**

**Chosen:** one `ABORT_LANDING_BUDGET_MS` constant feeding both the ledger wait and 686's settling wait. (decides: qa) — they bound the same physical event; a shared constant makes drift impossible and documents that they are the same race.

**Is editing 686's settling-wait timeout in scope, or off-limits as "686's line"?**

**Chosen:** in scope — 635 owns the time budget of every abort-landing deadline, including the one 686 authored; the edit changes only `timeoutMs`, never 686's observation-ordering assertion or split counts. (decides: qa) — leaving it at 10s would just relocate the same flake to that line. At rebase time this is a normal edit on merged code, not the parallel-development collision 686's spec cautioned against.

*Temporal anchor:* at the time of writing, `$FAFF_NOW_MS` is intentionally non-inheriting and `--interval-secs` has a hard floor of 1 with no env override. If either changes, the clock-injection rejection is worth revisiting.

---

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed.

**Assumptions.**

- **Assumes:** FAFF-686 (PR #535) is merged and is an ancestor of 635's base branch, so the test already carries the settling wait + split assertions. *Validation:* `git merge-base --is-ancestor <686-commit> HEAD` before editing; if the settling wait is absent, rebase onto main first. (At spec time, 686 is present on `origin/main`.)
- **Assumes:** the L4 `stall_window_secs` default is in the 600–900s range, so `isoAgo(2000)` trips deterministically. *Validation:* confirmed against `governance-profile.js` (L4 profile) / `corrective.js:562`; re-check if the L4 profile default is retuned.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] The L4 test at `test/sentry-poller.test.mjs:174` passes on the first CI `validate`-lane run with no `gh run rerun` needed.
- [ ] Only `test/sentry-poller.test.mjs` is modified; `git diff` touches no production file, `sentry-poller.js` least of all.

### From WHAT / HOW (behaviour)
- [ ] `ABORT_LANDING_BUDGET_MS` (30000) and `POLLER_EXIT_BUDGET_MS` (20000) are defined as named constants, each with a comment stating the worst-case rationale.
- [ ] The ledger wait (`owner.status === "aborted-resumable"`) uses `ABORT_LANDING_BUDGET_MS`.
- [ ] 686's settling wait (`log().includes("abort-actioned")`) uses `ABORT_LANDING_BUDGET_MS` — the same constant, verifiably not a separate literal.
- [ ] The exit wait (`!pidAliveProbe(started.pid)`) uses `POLLER_EXIT_BUDGET_MS`.
- [ ] All waits remain predicate-polled `waitUntil` calls; no fixed `sleep` replaces a predicate.

### From HOW (coverage preserved — must all still assert)
- [ ] `owner.status === "aborted-resumable"` and an abort entry exists.
- [ ] Exactly one `sentry-checkpoint` event (686's `>= 1` and `=== 1` split, both kept) with `data.tripped === true`.
- [ ] `abort-actioned` present in the poller log.
- [ ] The poller process exits (`pidAliveProbe` goes false) and `sentry-poller status` reports `running: false`; `handle().pid === started.pid`.

### From HOW (edge cases / failure modes)
- [ ] A genuine non-landing regression still fails the test (predicate false → `assert.ok(aborted)` fails at the budget) — confirmed by reasoning or a scratch check, not weakened away.
- [ ] Both budgets stay under any suite-level `--test-timeout` (none by default in `node --test`).

### Stability evidence (the actual acceptance bar)

The flake is CI N-way-parallelism CPU-starvation of a detached process (§1). Isolated local reruns on an idle box do **not** reproduce that contention, so a green local rerun proves almost nothing on its own. Two tiers, both required:

- [ ] **True oracle — CI `validate` lane, first-run-green.** The `validate` lane passes on the **first** run (no `gh run rerun --failed`) for this test across at least **3 consecutive** PR pushes / CI runs after the fix lands. This is the only observation that sees the real starvation condition; it is the acceptance signal of record — cite the run IDs in the PR.
- [ ] **Local proxy — full suite under induced contention.** Run the **full suite** (not the test in isolation) under genuine CPU load — e.g. several concurrent `node --test` invocations, or a parallel-load wrapper that saturates the cores — for **at least 20 consecutive iterations**, all green, with zero first-run-red / rerun-green on this test. A plain back-to-back loop on an idle box does not count. Record the exact command, the induced-load method, and the 20/20 result in the PR.

Neither tier alone is sufficient: the local proxy is the fast pre-merge check, the CI first-run-green tier is the true confirmation.

**Integration smoke test (the plumbing check):**
```
1. Build an L4 run dir: owner.status "running", last_heartbeat isoAgo(2000).
2. sentry-poller start --run-dir <dir> --interval-secs 1 --json  → spawned: true.
3. waitUntil owner.status === "aborted-resumable"        within ABORT_LANDING_BUDGET_MS.
4. waitUntil log() includes "abort-actioned"             within ABORT_LANDING_BUDGET_MS.
5. Assert exactly one sentry-checkpoint event, data.tripped === true.
6. waitUntil poller PID not alive                        within POLLER_EXIT_BUDGET_MS.
7. sentry-poller status --json → running: false. Pass ⇒ the deadline plumbing is sized right.
```

*No eval-coverage item: this change introduces no LLM-judgement seam.*

---

confidence: high
spec-review: approve

---

> Provenance: prepped autonomously by /faff-beep-boop (run run-20260803-232227-beepboop-full). Spec produced by faffter-dark-nlspec, reviewed by faffter-dark-spec-review (L4 adversarial, all four lenses): verdict **approve** after one QA-lens `revise` (the stability acceptance bar was sharpened to name the CI validate-lane first-run-green as the true oracle over idle-box reruns). Scope narrowed against **FAFF-686** (merged PR #535), which already fixed this test's checkpoint-observation race — 635 owns only the remaining wall-clock deadline race, and coordinates by rebasing onto 686.
