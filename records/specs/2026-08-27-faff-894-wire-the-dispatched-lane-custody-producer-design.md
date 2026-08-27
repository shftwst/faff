# FAFF-894 — Wire the dispatched-lane custody producer

> Spec: faffter-dark-nlspec · 2026-08-27 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-894.
_Revised 2026-08-27 — folded the human resolution (alec, 2026-08-23): manifest grain = **run-grain reuse** (the sole Punt closed → Chosen); `lane-boundary.json` coexistence = **never-coexist** (new Chosen); widening `LANE_BOUNDARY_LANES` to admit `build` = ADR-promotion candidate, promoted at graft. No open architecture questions remain; re-rated → high._
_Spec-review round 1 (`revise`, two minor) applied in place: added the enum-widening companion edits the selftest gates (`CONTRACT_DESCRIBES["lane-boundary"].semantics.build` + `ISOLATION_LANE_VOCAB.build`, and `faff contract lane-boundary --selftest` in DoD/validation); made both smoke-test arms required merge-blocking checks; hardened the merge-locus-relocation Assumes to a named Done-prerequisite; recorded the never-coexist constraint on FAFF-384._

This spec describes wiring the dormant FAFF-784 detective-custody merge gate onto the dispatched build path, for the build agent implementing FAFF-894 and the human reviewers gating it. It covers the emit half (`lane-boundary.json` for a build lane), the producer half (`integrity-digest verify --record-result` in the trusted dispatcher's context), and the admission half (threading `--custody-verdict` / `--custody-verdict-sha256` into the dispatcher's `--pr` merge). The mechanism it turns on already ships in `merge-gate.js`; this work removes the "SHIP-NOT-WIRE" gap that leaves it dormant.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's dispatched build lanes are untrusted: a build subagent runs in its own worktree and could tamper with the run's forge-surface evidence (`run-ledger.json`, `corrective/`, `events.jsonl`) mid-dispatch. FAFF-784 shipped the *admission* half of the defence: when a run is structurally "dispatched" (a valid `lane-boundary.json` is present in the run dir), `merge-gate.js`'s `evaluateCustody` refuses any merge that does not carry an admitted, sha256-pinned per-issue `custody-verdict.json` produced by the trusted dispatcher's own verify. But nothing on the build path *emits* `lane-boundary.json` or *produces* that verdict, so on a real dispatched build merge the run reads as "absent" and `evaluateCustody` returns `{required:false}`. The detective gate is provably dormant on the emit side.

**Problem statement.** Today a dispatched build merge runs with no custody detection: a build lane that tampered a forge-surface member would merge as if clean. This change makes the dispatcher emit the dispatch declaration, run the trusted-side verify that produces the custody verdict, and thread that verdict into the merge, so the shipped FAFF-784 gate actually fires — refusing a merge on tamper and admitting a clean round-trip.

**Design principles.**

**Only the evaluator lane arms the holdout cage — the build lane never does.** `merge-gate.js`'s `laneBoundaryPromisesCage` keys the spawner-attestation ratchet specifically on `lane === "evaluator" && container === "own" && accesses.repo === "absent"`. A build lane's `lane-boundary.json` must flip `laneBoundaryDispatchState` to `"dispatched"` (custody required) **without** arming that cage. Any implementation that emits the build declaration with `lane: "evaluator"` is wrong — it would falsely arm the holdout ratchet. The build lane needs its own lane value, and the cage predicate must stay evaluator-keyed by construction.

**Detective custody, never a self-consistency stamp, never the integrity boundary.** This producer is genuine detective custody: a *trusted dispatcher* verifying an *untrusted build lane's* forge surface. It must never be conflated with FAFF-893's interactive self-consistency stamp (a security-empty same-party stamp on the trusted `--local` path), and the verdict is never fed through `FAFF_INTEGRITY_BOUNDARY` (the separate outer-layer boundary authority — ADR-0061 / ADR-0074). The two-basis discipline (ADR-0061 / ADR-0114 / ADR-0041) is load-bearing: conflating the bases is the lying-attestation failure the CLI already guards against.

**Emit and threading must land atomically — a partial wiring breaks every dispatched merge.** The instant a valid `lane-boundary.json` is present, `laneBoundaryDispatchState` returns `"dispatched"` and *every* merge in that run dir requires an admitted custody verdict. Emitting the declaration without also producing the verdict and threading the flags would make every dispatched build merge **refuse**. This is exactly the hazard `lane-boundary.js`'s own header documents. The three halves are one indivisible slice.

**A build lane and an evaluator lane never share a run dir.** `lane-boundary.json` is a single per-run file (`<run-dir>/lane-boundary.json`); it declares one lane. This work emits only the build-lane boundary, and relies on the guarantee that a dispatched build pass and a deferred FAFF-384 evaluator-cage lane are never co-resident in the same run dir. The multi-lane file shape is FAFF-384's to introduce when that cage actually lands — this work must not pre-build a multi-lane container for a cage that does not yet exist. (Human decision, alec 2026-08-23.) This never-coexist constraint is **recorded on FAFF-384 itself** (a note on that ticket), not only in this spec's prose, so whoever builds the evaluator cage sees the obligation to reconcile the two boundaries rather than silently introducing a multi-lane shape that breaks the guarantee.

**Fail-closed on doubt.** Every custody failure mode already refuses in `merge-gate.js` (indeterminate dispatch state, missing flags, non-canonical path, digest mismatch, non-clean verdict). This work must preserve that: an uncomputable or unavailable verify must never present as clean.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node | `evaluateCustody` / `laneBoundaryDispatchState` / `laneBoundaryPromisesCage` — the shipped admission + dispatch-state readers this wiring feeds |
| `plugin/skills/faff/bin/lib/lane-boundary.js` | Node | `faff lane-boundary emit` — the emitter, currently SHIP-NOT-WIRE, defaults `--lane evaluator` |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | Node | `verify --record-result` (`verifyAndRecord`) — the shipped producer verb that writes `custody-verdict.json` and prints `verdict_sha256` |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node | `LANE_BOUNDARY_LANES` (currently `["evaluator"]`) and `computeLaneBoundary` — the boundary contract vocabulary this must widen |
| `plugin/skills/faff/bin/lib/config.js` | Node | `DEFAULTS` — where `lanes.<lane>.isolation.*` defaults live (only `evaluator` today) |
| `plugin/skills/faff/SKILL.md` (gateway) | Markdown | Mechanism slot (`concurrency`) obligations 5–7 — the fixed contract the executors discharge |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | Markdown | Sequential executor — obligation-7 merge-locus placement |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | Markdown | Parallel executor — obligation-7 merge under the rebase-before-merge lock |
| `plugin/skills/faffter-noon-ship/SKILL.md` | Markdown | Ship producer — currently forwards custody flags only on the `--local` path |

**Scope statement.** This sits at the dispatcher→lane cut in the autonomous build pass: the trusted concurrency-executor side of every dispatched `/faff-graft`, above the merge locus obligations 6–7 already relocated there.

## 2. OUT OF SCOPE

- **Interactive / top-level graft custody.** Interactive and autonomous-but-top-level `/faff-graft` have no dispatch cut above them (the human-supervised or top-level session *is* the trusted side). They emit no `lane-boundary.json`, so `laneBoundaryDispatchState` reads `"absent"` and custody stays `{required:false}` — existing behaviour, untouched. **Extension point:** if a future ticket wants custody on the interactive `--pr` L4 merge, that is FAFF-895's surface, not this one.
- **The interactive `--local` custody stamp.** FAFF-893 already produces and threads a per-issue verdict on the interactive/non-dispatched `--local` L4 path, and the ship producer already forwards its flags there. This work adds the `--pr` dispatched path only; it must not disturb the `--local` path. **Extension point:** `faffter-noon-ship/SKILL.md` custody pass-through.
- **The `FAFF_INTEGRITY_BOUNDARY` outer-layer authority.** A separate mechanism (ADR-0061 / ADR-0074). The custody verdict is never fed through it. **Extension point:** none — deliberately disjoint.
- **New tamper-detection primitives.** The verify, the snapshot, the manifest diff, the admission gate, and the atomic verdict write all already ship (FAFF-518 / FAFF-784). This work only *calls* them from the dispatched path. **Extension point:** `integrity-digest.js`.
- **Re-designing obligation 5's run-grain bracket.** The one-continuous-run-grain-chain bracket stays exactly as FAFF-520 shipped it. This work reuses its held manifest; it does not re-open the bracket design. **Extension point:** gateway obligation 5.
- **A multi-lane `lane-boundary.json` shape.** One per-run file declaring more than one lane (build + evaluator) is FAFF-384's to introduce when the evaluator cage lands. This work emits only the single build-lane boundary and leans on the never-coexist guarantee. **Extension point:** `contract-defs.js` `computeLaneBoundary` / FAFF-384.
- **The per-issue (FAFF-751) manifest basis.** The dispatched producer verifies obligation 5's run-grain held baseline only; per-issue evidence coverage is obligation 6's job. **Extension point:** a follow-up if a per-issue custody basis is ever wanted beyond obligation 6.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Dispatch cut | The orchestrator→lane boundary where a build subagent is dispatched; the trusted side is the dispatcher (the concurrency executor) |
| Dispatched (dispatch state) | `laneBoundaryDispatchState(runDir)` returns `"dispatched"` — a present, structurally-valid `<run-dir>/lane-boundary.json` exists (any admitted lane value) |
| Custody verdict | The per-issue `<run-dir>/<issue>/custody-verdict.json` `verify --record-result` writes; classification `clean` / `tamper` / `verification-unavailable`; only `clean` admits |
| Forge surface | The run-grain corrective-integrity evidence set: `correctiveIntegrityDirs(runDir)` + `events.jsonl`, the members obligation 5's baseline covers |
| Build lane | A dispatched `/faff-graft` build subagent (untrusted), as distinct from the evaluator/holdout lane |

**Contract vocabulary change (types).**

```
# contract-defs.js — widen the boundary lane vocabulary
LANE_BOUNDARY_LANES: List<String>
  BEFORE: ["evaluator"]
  AFTER:  ["evaluator", "build"]         # "build" is the dispatched-build-lane declaration

INVARIANT (merge-gate.js laneBoundaryPromisesCage):
  arms_cage(intent) == (intent.lane == "evaluator"
                        AND intent.container == "own"
                        AND intent.accesses.repo == "absent")
  # "build" can NEVER satisfy this — the predicate is lane-value-keyed, unchanged.
```

```
# config.js DEFAULTS — a build lane isolation declaration (declaration-only for custody)
"lanes.build.isolation.container": "shared"    # build runs with the repo present in its worktree
"lanes.build.isolation.host": "local"
```

**Companion edits the enum widening forces (do not omit — a selftest gates them).** Adding `"build"` to `LANE_BOUNDARY_LANES` is not self-contained; two shipped structures key off that enum and fail-loud if the widening lands alone:

- `contract-defs.js` `CONTRACT_DESCRIBES["lane-boundary"].values[lane].semantics` today maps only `{ evaluator: "…the only lane this contract covers today" }`. `describeChecks` asserts `semantics-covers-every-enum-value`, so `faff contract lane-boundary --selftest` **fails** the instant `build` is in the enum without a `semantics.build` entry. Add `build: "the dispatched build lane — custody-required, never arms the evaluator cage"` and correct the now-false "only lane this contract covers today" wording. The `lane-boundary` contract `purpose` still says "an evaluator lane needs"; widen it to cover the build lane too.
- `config.js` `ISOLATION_LANE_VOCAB` (consumed by `validateIsolationLane`) has no `build` key, so `lanes.build.isolation.*` values are not fail-loud validated the way `evaluator`'s are. Add a `build` entry mirroring the evaluator vocab so an off-vocabulary build-lane isolation value is rejected, not silently accepted. (Low-stakes — declaration-only — but cheap and keeps the two lanes symmetric.)

**The custody producer call (interface — already shipped, invoked here).**

```
faff integrity-digest verify
  --run-dir <run_dir>
  --issue-context <ISSUE-ID>
  --merge-state pre-merge
  --record-result <run_dir>/<ISSUE-ID>/custody-verdict.json   # canonical path, validated first
  --events
  --manifest -                                                 # obligation-5 held baseline, over stdin
  --json

# stdout (exit 0): { classification: "clean", verdict_path, verdict_sha256, detail, paths }
# exit 0 = clean, 1 = tamper (verdict written, non-admitting), 2 = verification-unavailable
```

**The emit call (already shipped, invoked here for the build lane).**

```
faff lane-boundary emit --run-dir <run_dir> --lane build --json
# writes <run_dir>/lane-boundary.json; requires the lanes.build.isolation.* defaults above
```

**Design decisions.**

Every non-trivial decision below concludes with a canonical marker; the full rationale is collected in section 6.

- Widen `LANE_BOUNDARY_LANES` to admit `build`. **Chosen:** extend the enum to `["evaluator", "build"]` — it is the only correct mechanism to make a build run structurally "dispatched" without arming the evaluator cage.
- Where `lane-boundary.json` is emitted. **Chosen:** the dispatcher emits it once per dispatched build pass, at pass start (before the first dispatch), keyed to the run dir.
- Which manifest the record-result verify covers. **Chosen:** run-grain reuse of obligation 5's held baseline. Per-issue (FAFF-751) coverage is already obligation 6's job; run-grain reuse is sufficient and avoids a second baseline over a shared mutable set. (Human decision, alec 2026-08-23 — closes the sole architecture Punt.)
- How the build-lane boundary coexists with the deferred FAFF-384 evaluator cage. **Chosen:** never-coexist — emit only the build-lane boundary and guarantee a build lane and an evaluator lane never share a run dir; the multi-lane file shape is FAFF-384's to introduce when it lands. (Human decision, alec 2026-08-23.)
- Who runs the producer + threads the flags. **Chosen:** the concurrency executor (dispatcher), at the obligation-7 merge locus; the build lane never merges.
- How the flags reach `merge-gate`. **Chosen:** the dispatcher passes `--custody-verdict` / `--custody-verdict-sha256` to `slots.ship`, which forwards them on the `--pr` invocation (mirroring the existing `--local` pass-through).
- The build lane's container/host declaration values. **Chosen:** `container: shared, host: local` — declaration-only for a build lane (never asserted, never arms the cage).

## 4. HOW — Behavior

**Architecture and approach.** The wiring adds three trusted-side actions to the dispatched build pass, all on the dispatcher (concurrency executor), never in the build lane:

1. **At pass start (once per run):** emit the build-lane `lane-boundary.json`. From this point every merge in the run dir is custody-required.
2. **At each issue's obligation-7 merge locus (per issue, trusted side):** run `integrity-digest verify --record-result` over obligation 5's held run-grain baseline, producing `<run_dir>/<issue>/custody-verdict.json` and capturing `verdict_sha256`.
3. **In the same merge locus:** thread `--custody-verdict <path>` / `--custody-verdict-sha256 <sha>` into the `slots.ship` invocation, which forwards them to `faff merge-gate --pr … --execute`.

The gateway concurrency contract (obligations 5–7) is fixed prose; this work amends obligation 7 to add the custody producer + threading as a mandatory trusted-side sub-step of the merge locus, and both executor recaps and the ship producer follow.

**Behavior summary — the per-issue merge locus, after this change.** For each `pr-ready` member, after obligation-5's run-grain verify and obligation-6's evidence persist have passed, the dispatcher produces the custody verdict from the same held baseline and threads it into the merge, so `evaluateCustody` admits a clean verdict and refuses a tampered one.

```
PROCEDURE dispatched_build_pass(partition, run_dir):
  1. emit_build_lane_boundary(run_dir):
     a. Run `faff lane-boundary emit --run-dir <run_dir> --lane build --json`.
     b. On non-zero exit (e.g. missing lanes.build.isolation defaults) -> park the pass loudly;
        do NOT dispatch (a half-wired run would refuse every merge).
  2. FOR each unit (obligation-1 order):
     a. obligation-5 snapshot -> hold manifest M in context.
     b. dispatch build subagent (foreground), await TerminalToken + EvidenceReturn.
     c. obligation-5 verify M on return (exit 1/2 -> park unit, do not consume).
     d. obligation-6 persist+verify returned AC/review evidence (mismatch -> park unit).
     e. IF outcome == pr-ready: run_merge_locus(unit, run_dir, M).

PROCEDURE run_merge_locus(issue, run_dir, held_manifest_M):
  1. custody := produce_custody_verdict(issue, run_dir, held_manifest_M)
  2. IF custody.exit == 1 (tamper):
     a. Park the unit per obligation 5's tamper path (cause: integrity-digest tampered — <paths>);
        the verdict is written but non-admitting, so even an attempted merge would refuse. Do NOT merge.
  3. IF custody.exit == 2 (verification-unavailable):
     a. Park the unit (cause: integrity-digest verification unavailable — <detail>). Do NOT merge.
  4. IF custody.exit == 0 (clean):
     a. Assert the non-delegable floor (AC + CI-green + review pass [+ L4 holdout meets-spec]).
     b. Run the ADR/PRDR-collision guard.
     c. Invoke slots.ship with --pr/--issue/--run-dir/--level
        AND --custody-verdict <custody.verdict_path>
        AND --custody-verdict-sha256 <custody.verdict_sha256>.
     d. Route the faff-contract:delivery-outcome -> shipped / pr-open / parked bucket.
     e. On shipped, run the post-merge tail.

PROCEDURE produce_custody_verdict(issue, run_dir, held_manifest_M):
  1. Run: faff integrity-digest verify --run-dir <run_dir> --issue-context <issue>
          --merge-state pre-merge --record-result <run_dir>/<issue>/custody-verdict.json
          --events --manifest - --json,  piping held_manifest_M over stdin (NEVER a disk path,
          NEVER a fresh snapshot — the held-in-context baseline is the whole point of obligation 5).
  2. Return { exit, verdict_path, verdict_sha256 } parsed from stdout on exit 0;
     on exit 1/2 return { exit, ... } for the park branches above.
```

**Edge cases and error handling.**

- **Emit fails (missing `lanes.build.isolation` defaults, or an invalid intent).** The pass parks before any dispatch — never a half-wired run. `emitLaneBoundary` already refuses to write a broken promise; the config defaults in section 3 are what make the well-formed case succeed.
- **Tamper (exit 1).** `verify --record-result` writes a `tamper`-classified verdict. Even if a merge were attempted, `computeCustodyVerdictAdmission` requires `clean`, so the merge refuses. The dispatcher parks the unit per obligation 5's tamper path rather than attempting the merge — the fail-closed outcome the AC requires.
- **Verification-unavailable (exit 2).** A subagent can force this, so it has substrate parity with tamper; park, never merge (fail-closed).
- **Re-baseline interaction.** Between issues, obligation 5's held baseline may be legitimately re-baselined (a trusted-side ledger write via the Class-A/B sequence). The record-result verify always uses the *current* held baseline, so a legitimately-appended `events.jsonl` verifies clean under the prefix rule and a legitimate ledger write is folded in before the next issue's verify.
- **Non-canonical `--record-result` path.** `verifyAndRecord` refuses (exit 2) before verifying — the canonical path is derived, never trusted off a caller argument.
- **A build lane and an evaluator lane in one run dir.** Out of scope by the never-coexist guarantee: the single per-run `lane-boundary.json` declares the build lane only. If FAFF-384's evaluator cage ever needs to co-reside, that ticket introduces the multi-lane shape; this work must not.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the build lane emits `lane-boundary.json` with `lane: "evaluator"` (reusing the only previously-valid value), falsely arming the holdout spawner-attestation ratchet on a non-evaluator run. **How you'd know:** a dispatched build run's holdout leg starts demanding spawner attestation it never produces, or `laneBoundaryPromisesCage` returns true on a build run. **What it means:** abandon that shortcut — the build lane must use `lane: "build"` (this spec's Chosen), and the cage predicate must stay evaluator-keyed. A test asserting `laneBoundaryPromisesCage` is false for a `build`-lane intent is the guard.
- **The failure:** emit lands but the producer/threading does not (partial wiring), so every dispatched merge refuses `{required:true, ok:false}`. **How you'd know:** every dispatched build parks at merge with "dispatched merge: --custody-verdict … required". **What it means:** the three halves must ship together (design principle); the integration smoke test below exercises the clean round-trip end-to-end to catch a partial landing.
- **The failure:** the record-result verify is fed a fresh snapshot at merge time instead of the held baseline, rubber-stamping a surface no untrusted dispatch was ever measured against. **How you'd know:** a mid-dispatch tamper reads as clean. **What it means:** the manifest MUST be obligation 5's held-in-context baseline (`--manifest -` over stdin), never a fresh snapshot — the same rule obligation 5 already states.

**Anti-pattern:** emitting `lane-boundary.json` from within the build lane. Why: `lane-boundary.json` is Evidence class (orchestrator/trusted-side only); a lane-written boundary is exactly the tamper the custody chain defends against.

**Anti-pattern:** producing the custody verdict inside the build subagent and returning it. Why: the judged party never writes its own verdict artifact (the spawner precedent) — the trusted dispatcher runs the verify.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a dispatched build run whose lane-boundary.json is emitted for the build lane
  And a build lane that tampers a forge-surface member (e.g. run-ledger.json) mid-dispatch
When the dispatcher runs the obligation-7 merge locus for that issue
Then integrity-digest verify --record-result classifies the verdict `tamper` (exit 1)
  And the dispatcher does not merge, parking the unit
  And even an attempted merge-gate --execute refuses (the FAFF-784 gate fires, not {required:false})
```

```
Given a build run under this wiring
When laneBoundaryPromisesCage(runDir) is evaluated on the build-lane lane-boundary.json
Then it returns false (the build lane never arms the holdout spawner-attestation ratchet)
```

- The interactive / top-level `--pr` and `--local` paths emit no build-lane `lane-boundary.json` and behave byte-for-byte as before (no custody required on the top-level path; FAFF-893's `--local` stamp unchanged).

## 6. DESIGN DECISION RATIONALE

**How does a dispatched build run become structurally "dispatched" without arming the evaluator cage?**
- Reuse `lane: "evaluator"` — rejected: `laneBoundaryPromisesCage` would arm the holdout ratchet, a security regression.
- Add a caller flag / ledger field to signal dispatch — rejected: `laneBoundaryDispatchState`'s design deliberately reads only the on-disk `lane-boundary.json` (never a caller flag, never a suspect ledger field a same-uid lane could set — the ADR-cited bypass this closes).
- Widen `LANE_BOUNDARY_LANES` to admit `build`. **Chosen:** extend the contract vocabulary to `["evaluator", "build"]`. A `build`-lane boundary is a valid intent (so `laneBoundaryDispatchState` → `"dispatched"`) and can never satisfy the evaluator-keyed cage predicate. This is architecturally significant (it widens the FAFF-784 / FAFF-859 boundary contract) and is recorded as an ADR-promotion candidate (promoted at graft, per the human decision). Rationale: it is the only mechanism consistent with the shipped design.

**Where is `lane-boundary.json` emitted?**
- Per-issue — rejected: `lane-boundary.json` is per-run (`<run-dir>/lane-boundary.json`) and governs every merge in the run; a per-issue emit is the wrong grain.
- At pass start, once per dispatched build run, by the dispatcher. **Chosen:** emit before the first dispatch so custody is required for the whole pass; a failed emit parks the pass before any dispatch (never half-wired).

**Which manifest does the record-result verify cover?**
- Run-grain reuse of obligation 5's held baseline (`correctiveIntegrityDirs + events`). Pro: it is literally "the manifest held across the untrusted build" the ticket names; no second baseline over a shared mutable set (the anti-pattern obligation 5 forbids). Con: it attests the run-grain forge surface, not each issue's per-issue (FAFF-751) evidence surface.
- Additionally cover the per-issue 7-entry surface (FAFF-751 relocation). Pro: tighter per-issue attestation. Con: a second baseline / more moving parts; interaction with the per-issue evidence obligation-6 already covers.
- **Chosen:** run-grain reuse of obligation 5's held baseline (human decision, alec 2026-08-23). Per-issue (FAFF-751) coverage is already obligation 6's job; run-grain reuse is sufficient and avoids a second baseline over a shared mutable set. This closes the sole architecture Punt; every decision in this spec is now Chosen.

**How does the build-lane boundary coexist with the deferred FAFF-384 evaluator cage?**
- A per-lane boundary file, or a multi-lane file shape now — rejected: builds a container for a cage that does not yet exist; the per-run `lane-boundary.json` declares exactly one lane today.
- **Chosen:** never-coexist (human decision, alec 2026-08-23). Emit only the build-lane boundary now and guarantee a build lane and an evaluator lane never share a run dir. When FAFF-384's evaluator cage lands, that ticket owns reconciling the two boundaries (the multi-lane shape). Rationale: it is the smallest correct step and does not pre-commit the contract to an unshipped cage.

**Who runs the producer and threads the flags?**
- The build lane — rejected: the judged party never writes its own verdict; the lane stops at `pr-ready` and does not merge (obligations 6–7).
- `/faff-graft` under a dispatch cut — rejected: graft under a dispatch cut also stops at `pr-ready`; the dispatcher owns the merge locus.
- The concurrency executor (dispatcher) at the obligation-7 merge locus. **Chosen:** it is already the merge locus and the trusted side; the producer + threading are a sub-step of it. Both executors (sequential + parallel) discharge it; the parallel one inside its rebase-before-merge lock.

**How do the flags reach `merge-gate`?**
- The dispatcher calls `merge-gate` directly — rejected: the sanctioned merge path is `slots.ship`, never a direct/raw merge.
- `slots.ship` forwards `--custody-verdict` / `--custody-verdict-sha256` on the `--pr` invocation. **Chosen:** mirror the existing `--local` pass-through; the ship producer never mints, re-hashes, or inspects the verdict — it relays the two flags the dispatcher passes.

**The build lane's container/host declaration.**
- **Chosen:** `container: shared, host: local`. For a build lane these fields are declaration-only (never asserted, never arm the cage), so the honest "runs locally with the repo present" declaration is correct and low-stakes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — both architecture Punts (manifest grain; build/evaluator boundary coexistence) were closed by the human decision of 2026-08-23 (alec), folded into the Chosen decisions above. The spec is fully buildable at its Chosen defaults.

**Assumptions.**

- **Assumes:** the shipped `verify --record-result` verb, `computeCustodyVerdictAdmission`, `emitLaneBoundary`, and `evaluateCustody` behave as read from the current `integrity-digest.js` / `merge-gate.js` / `lane-boundary.js` / `contract-defs.js`. **Validation:** the build agent runs `faff integrity-digest --selftest`, `faff lane-boundary --selftest`, **and `faff contract lane-boundary --selftest`** (the one that catches the incomplete enum widening — see the companion edits in §3), and greps `LANE_BOUNDARY_LANES` before starting; if the verb signatures or the enum have moved, re-read those modules.
- **Assumes:** obligations 6–7 have **already** relocated the merge locus to the dispatcher (a `pr-ready` lane that does not merge) — a landed prerequisite (the obligation-6/7 relocation work, related FAFF-520 / FAFF-751, both Done), not a future dependency. **Validation:** confirm the gateway obligation-7 prose and both executor recaps still say "the dispatcher merges"; if that relocation is ever reverted or still pending, this ticket has a live blocker and must not be pulled ready — link it as a blocker rather than proceeding on the grep. Encoded here as an explicit Done-prerequisite so the dependency is honest in the graph, not discovered at build start.

## 8. DONE — Definition of Done

### From WHY
- [ ] A dispatched build run emits a valid `<run-dir>/lane-boundary.json` for the build lane, so `laneBoundaryDispatchState(runDir)` returns `"dispatched"`.
- [ ] On a real dispatched build merge, `evaluateCustody` no longer returns `{required:false}` — it requires and admits/refuses a custody verdict.

### From WHAT (types and interfaces)
- [ ] `LANE_BOUNDARY_LANES` in `contract-defs.js` admits `"build"`; `computeLaneBoundary` returns zero violations for a well-formed `build`-lane intent.
- [ ] `CONTRACT_DESCRIBES["lane-boundary"]` gains a `semantics.build` entry (and the "only lane this contract covers today" / evaluator-only `purpose` wording is corrected), so `faff contract lane-boundary --selftest` passes `semantics-covers-every-enum-value` after the widening.
- [ ] `ISOLATION_LANE_VOCAB` in `config.js` gains a `build` entry, so `validateIsolationLane` fail-loud-rejects an off-vocabulary `lanes.build.isolation.*` value.
- [ ] `config.js` `DEFAULTS` defines `lanes.build.isolation.container` and `lanes.build.isolation.host`, so `faff lane-boundary emit --lane build` resolves and writes a valid file.
- [ ] `laneBoundaryPromisesCage` returns `false` for a `build`-lane intent (the cage stays evaluator-keyed) — asserted by a test.

### From HOW (behaviour)
- [ ] The dispatcher (concurrency executor) emits the build-lane `lane-boundary.json` once at pass start, before the first dispatch; a failed emit parks the pass with no dispatch.
- [ ] At each issue's obligation-7 merge locus the dispatcher runs `integrity-digest verify --record-result` over obligation 5's held run-grain baseline (`--manifest -` over stdin, `--events`), writing `<run-dir>/<issue>/custody-verdict.json`.
- [ ] The dispatcher threads `--custody-verdict` / `--custody-verdict-sha256` into `slots.ship`, which forwards them on the `merge-gate --pr … --execute` invocation.
- [ ] The gateway concurrency obligation-7 prose, both executor recaps, and the ship producer's `--pr` pass-through are updated to describe the custody producer + threading.

### From HOW (edge cases)
- [ ] A tampered forge-surface member yields a `tamper` verdict (exit 1); the dispatcher parks the unit and does not merge; an attempted merge refuses.
- [ ] A `verification-unavailable` result (exit 2) parks the unit and does not merge.
- [ ] A clean dispatched build records a `clean` verdict, threads the sha, and the merge admits (`evaluateCustody` → `{required:true, ok:true}`).
- [ ] The interactive / top-level `--pr` and the `--local` (FAFF-893) paths are unchanged — no build-lane `lane-boundary.json`, custody behaviour byte-for-byte as before.
- [ ] A build lane and an evaluator lane never share a run dir (the never-coexist guarantee); no multi-lane `lane-boundary.json` is introduced here.

**Integration smoke test.** Both arms below (clean-admits and tamper-refuses) land as **required, merge-blocking checks**, not a described procedure — because a partial or buggy landing makes *every* dispatched merge refuse (the whole beep-boop merge path stalls against itself), the atomic-slice guarantee must be enforced mechanically, not by reviewer diligence.

```
PROCEDURE smoke_dispatched_custody_round_trip:
  1. Set up a run dir; run `faff lane-boundary emit --run-dir <dir> --lane build` -> file written.
  2. obligation-5 snapshot -> hold manifest M.
  3. (clean path) faff integrity-digest verify --run-dir <dir> --issue-context <ISSUE>
     --merge-state pre-merge --record-result <dir>/<ISSUE>/custody-verdict.json --events
     --manifest M --json -> exit 0, capture verdict_sha256.
  4. faff merge-gate --pr <n> --issue <ISSUE> --run-dir <dir> --level L3 --execute
     --custody-verdict <dir>/<ISSUE>/custody-verdict.json --custody-verdict-sha256 <sha>
     -> custody admits (not {required:false}); merge proceeds on an otherwise-green floor.
  5. (tamper path) mutate run-ledger.json after step 2's snapshot; repeat step 3
     -> exit 1, verdict classification tamper; step 4 merge-gate refuses.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sizing (principle 4).** No issues. The ticket bundles three sub-actions (emit the build-lane `lane-boundary.json`, produce the custody verdict, thread the two flags into `slots.ship`) plus small edits to `contract-defs.js`, `config.js`, the gateway obligation-7 prose, both executor recaps, and the ship producer. The spec argues these are one indivisible slice because the moment a valid `lane-boundary.json` is present every merge in the run dir requires an admitted verdict, so emitting without threading would make every dispatched merge refuse. That is the correct merge-not-split call, not a split candidate: the three halves share a single completion criterion and cannot ship independently without opening a window where the whole dispatched-merge path refuses. The total scope reads as a 1-3 day unit; each file change is small and converges on one outcome.

**Workstream fit (principles 1 + 5).** The home project is "A current unattended run survives executor loss at safe boundaries," a resilience/resumability outcome. FAFF-894's outcome is detective custody on the dispatched build merge: catching an untrusted build lane that tampers forge-surface evidence (`run-ledger.json`, `corrective/`, `events.jsonl`). A build lane tampering evidence is an integrity/security outcome, not a lost executor, so taken at the project's literal name the ticket's outcome and the project's outcome diverge. Under principle 5 a workstream encodes one outcome; when two outcomes sit in one container, "done" for the container becomes ambiguous and sequencing inside it stops meaning anything. What to do: confirm the project's outcome genuinely covers integrity hardening as well as executor-loss survival (if it does, the name is narrower than the outcome and could be widened to say so), or re-home FAFF-894 under a custody/integrity-hardening outcome. Named here so a human can discount the boundary if the lens has misjudged how broad the project's outcome really is.

**Surfaced deps (principle 6).** Two implicit dependencies are carried as prose rather than tracker edges.

1. The Assumptions section rests on "obligations 6-7 have relocated the merge locus to the dispatcher," with the only check being a runtime grep of the gateway obligation-7 prose and the executor recaps. The relocation is not tied to a tracker ID or a blocker link. An assumption the build depends on that is not encoded as a blocker is unfinished thinking: if the relocation lives in a ticket that is not yet Done, this could be pulled ready before its prerequisite has landed, and the failure surfaces only at build time. What to do: name the ticket that relocated the merge locus and either link it as a blocker (if it is not Done) or record in the spec that it is Done, so the dependency is honest in the graph rather than a grep at build start.

2. The never-coexist guarantee (a build lane and an evaluator lane never share a run dir) is a forward-constraint on FAFF-384, the deferred evaluator cage, and currently lives only in this spec's prose. The spec correctly puts the multi-lane reconciliation obligation on FAFF-384, but an implicit cross-ticket constraint that is not encoded where the future work will see it can regress silently: if FAFF-384 later introduces a multi-lane `lane-boundary.json` shape without knowing FAFF-894 assumed never-coexist, the guarantee breaks unnoticed. What to do: record the never-coexist constraint on FAFF-384 itself (a related/blocker link or a note on that ticket), so the obligation is visible to whoever builds the cage, not assumed across a prose boundary.

**Risk profile (principle 7).** The earlier risk read (medium confidence plus an open architecture Punt) no longer holds: both Punts (manifest grain, build/evaluator coexistence) were closed by alec on 2026-08-23 and folded in as Chosen, and the spec is re-rated high. Residual risk is execution and blast radius, not open decisions. The change arms a dormant gate live on the unattended build/merge path, and a partial or buggy landing makes every dispatched merge refuse, stalling the whole beep-boop merge path against itself. The spec de-risks this well: park-before-dispatch on emit failure, a test that `laneBoundaryPromisesCage` returns false for a `build` intent (guarding the cage-arming regression), and an integration smoke test with both a clean-admits arm and a tamper-refuses arm. Because the blast radius is the entire dispatched-merge path, that smoke test is the main thing standing between a green build and a stalled overnight run. What to do: make both arms of the integration smoke test required, merge-blocking checks rather than a described procedure, so the atomic-slice guarantee is enforced mechanically rather than by reviewer diligence. This is the early de-risking principle 7 asks for when a change flips a live gate on the autonomous path. The ADR-promotion candidate (widening `LANE_BOUNDARY_LANES` to admit `build`) is architecturally significant and correctly deferred to promotion at graft; no action beyond confirming it actually promotes when graft runs.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```