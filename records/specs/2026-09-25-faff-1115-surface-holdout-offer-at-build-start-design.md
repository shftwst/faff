# nlspec — FAFF-1115: Offer the code-blind holdout at build-start, run it after build-complete

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1115.
> Revised 2026-09-25 (spec-review `revise`, applied) — the unattended RUN trigger now keys on `verif.unattended` ALONE (never `marker.born_verifiable_count`), closing the marker-suppression vector the review found; born-verifiable is the live step-5 gate. Folded the two observations: Step 8c runs dispatcher-side under a dispatch cut (holdout.json stays trusted-side-written), and the resume-path freshness ordering is pinned in the DoD.

**Artifact.** A build-agent-ready spec for FAFF-1115. **Audience:** the coding agent that will edit `faff-graft/SKILL.md` (and any thin CLI/marker plumbing it needs), plus the human reviewers gating the change. **Issue:** split the code-blind holdout into a *decision* surfaced at build-start and a *run* executed after build-complete, feeding the FAFF-1040 merge floor a fresh verdict.

## 1. WHY — Problem and Principles

**The load-bearing model — separate the OFFER from the RUN.** There are two distinct events, at two distinct times. The **OFFER** is a *decision* taken at build-start (graft Step 6): attended runs are prompted, unattended runs are pre-decided (yes, auto). Nothing is executed there. The **RUN** happens later, after build-complete (a new Step 8c), via the shared `holdout_step`, and is the only thing that provisions an env, judges the built feature code-blind, and writes `holdout.json`. Conflating the two is what broke the prior spec.

**Problem statement.** Today the code-blind holdout only ever runs at the Step-10 merge floor, and only under the L4 lights-out signal — so an operator never gets to *decide* up front, and lower levels get no holdout at all. This change surfaces the decision at build-start (any level, capability-permitting) and moves the run to immediately after build-complete, where the built feature actually exists and the FAFF-1040 freshness gate is satisfiable.

**Design principles.**

- **The RUN must postdate build-complete — this is not a preference, it is forced twice.** (a) The holdout exercises a *built* feature; nothing to judge exists at Step 6. (b) FAFF-1040's `readHoldout`/`readCanRun` require `holdout.json` mtime to strictly postdate the build-complete checkpoint (`<run-dir>/<issue>/build-progress.json`); `holdoutIsFresh(NaN,…)` and any pre-checkpoint verdict resolve to `faulted → strict → blocked`. A verdict produced before Step 8b is stale by construction and refuses every run.
- **The unattended auto-run keys on the unattended FACT, never the interactive resolver's legs.** `resolveInteractiveVerification` (config.js:843-852) and `faff verification resolve`'s `legs.holdout` are hard-zeroed for any unattended run. Routing the unattended run through them is dead code that would silently never fire. The trigger is `(ledger.level === "L4") || declaredUnattendedFromConfig(cfg)` — the resolver's top-level `unattended` field reports exactly this and is a safe read of the same fact; its `legs.holdout` is not.
- **Reuse, do not re-implement.** One verification resolver (attended opt-in only), one shared `holdout_step` engine. No second resolver, no second holdout engine, no second store.
- **Absent verdict must never block.** An attended decline and a zero-born-verifiable spec both leave no `holdout.json`; the merge floor already reads that as `can_run: absent → pass-through → not-applicable` and steps aside. The design leans on this rather than adding a merge-time "offer" state (which `resolveHoldoutPosture` deliberately does not have).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | Steps 6 (offer-gate to mirror), 8b (build-complete checkpoint), 9/10 (existing holdout gate to reconcile) — the file this ticket edits |
| `holdout_step` (shared) | Skill prose | The call-site-agnostic run engine reused verbatim; FAFF-384 carries its code-blind spawner dispatch |
| `plugin/skills/faff/bin/lib/config.js:843-910` | JS | `resolveInteractiveVerification` (zeroes legs for unattended), `cmdVerification` (`resolve --json`) |
| `plugin/skills/faff/bin/lib/sentry.js:251-253` | JS | `declaredUnattendedFromConfig` — the unattended fact |
| `plugin/skills/faff/bin/lib/merge-gate.js:698-787` | JS | `readHoldout`/`readCanRun`/`readCaged`/`resolveHoldoutLeg` — the FAFF-1040 consumer, unchanged here |
| `plugin/skills/faff/bin/lib/contract-defs.js:2273-2305` | JS | `resolveHoldoutPosture`: absent→pass-through, faulted→strict, satisfied+caged→strict-any-level |
| `plugin/skills/faff/bin/lib/admissibility.js:220-243` | JS | `faff dod classify` — the born-verifiable capability read |

**Scope statement.** This ticket owns the *sequencing* of the holdout decision and run inside faff-graft; the merge floor that consumes the verdict (FAFF-1040) and the evaluator lane that judges (FAFF-384) are pre-existing and unchanged.

## 2. OUT OF SCOPE

- **The merge-floor holdout leg (FAFF-1040).** — Excluded: it is the *consumer*; this ticket only guarantees it a fresh verdict. Extension point: `merge-gate.js resolveHoldoutLeg` / `contract-defs.js resolveHoldoutPosture` — untouched.
- **The evaluator-lane wiring / code-blind cage (FAFF-384).** — Excluded: SHIP-NOT-WIRE dependency; `holdout_step` already dispatches the caged evaluator via `evaluate-call.mjs`. Extension point: `holdout_step` internals.
- **SUT-standability ledger capture (FAFF-1116).** — Excluded: the sibling that records standability facts in the run ledger at build time. This ticket coordinates with it but does not depend on it — see Design Decision *Decision-carry mechanism*. Extension point: `run-ledger.json` + `resolveHoldoutLeg`'s "future follow-up" note (merge-gate.js:778).
- **A holdout cost cap.** — Excluded: whether low-level unattended auto-runs need a `verification` cost ceiling. Extension point: a `verification.*` config leaf + `holdout_step` gating. See Open Questions.
- **Changing the holdout verdict contract or store.** — Excluded: one artifact (`holdout.json`), two consumers, unchanged. Extension point: `faff contract holdout-verdict`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| OFFER | The build-start *decision* (Step 6) whether a code-blind holdout will run for this build. Records intent; executes nothing. |
| RUN | The post-build-complete *execution* (Step 8c) of `holdout_step` that provisions, judges, and writes `holdout.json`. |
| Unattended fact | `(ledger.level === "L4") || declaredUnattendedFromConfig(cfg)` — the operator-declared no-human-watching signal. Distinct from `autonomous` (any beep-boop dispatch). |
| Born-verifiable | A spec DoD criterion classified `scenario`/`assertion` by `faff dod classify`; the capability gate for offer and run. |
| Offer marker | A per-issue run-dir artifact recording the Step-6 decision, carried forward to Step 8c. |

**Type — the offer marker.** New per-issue run-dir artifact, written at Step 6, read at Step 8c.

```
RECORD HoldoutOfferMarker:            # <run-dir>/<issue>/holdout-offer.json
  decision: ENUM{accept, decline, auto, skip}   # accept/decline = attended; auto = unattended pre-decision; skip = zero-born-verifiable
  attended: Boolean                   # true on an interactive graft
  born_verifiable_count: Integer      # from faff dod classify at Step 6; 0 ⇒ decision MUST be skip
  decided_at: Timestamp               # ISO-8601, for audit only (never a freshness input)

  CONSTRAINT born_verifiable_count == 0  ⇒  decision == skip
  CONSTRAINT decision == auto            ⇒  attended == false
```

**Interface — the unattended fact (read at Step 8c).** Reuse the existing resolver output, keying only on the top-level `unattended` field, never `legs.holdout`:

```
verif := faff verification resolve --json   # {attended, unattended, level, legs:{holdout,…}, any}
unattended_run := verif.unattended          # == (ledger.level=="L4") || declaredUnattendedFromConfig(cfg)
# legs.holdout is ONLY consulted for the ATTENDED opt-in below — never for unattended_run.
```

**Design decision — trigger source per mode.** The attended path may be re-prompted only interactively; the unattended path must never be silently suppressed by a lost marker. **Chosen:** the attended RUN keys on the marker (`decision == accept`); the unattended RUN keys on the live `unattended` fact at Step 8c, independent of the marker. Rationale: attended fail-safe is "don't run" (advisory), unattended fail-safe is "run the guarantee".

## 4. HOW — Behavior

**Architecture.** Three touch-points in `faff-graft/SKILL.md`:

```
Step 6  (build-start)   → OFFER: capability-gate on born-verifiable, record HoldoutOfferMarker. Execute nothing.
Step 8b (build-complete)→ push branch + write build-progress.json checkpoint.        [unchanged]
Step 8c (NEW, post-8b)  → RUN: if triggered, holdout_step → holdout.json (mtime > 8b checkpoint).
Step 10 (merge floor)   → CONSUME the verdict via the FAFF-1040 merge floor. No holdout_step run here. No first-time prompt.
```

**Dispatch-cut placement (spec-review observation, resolved).** `holdout.json` is evidence class (faff-graft/SKILL.md:378): under a dispatch cut the trusted side must write it. So Step 8c runs **in-lane only on a top-level / sequential run** (no cut — the session *is* the trusted side, exactly as today's Step-10 write). **Under a dispatch cut** (a `concurrency` executor dispatched the build → the lane returns `pr-ready`), the RUN executes **dispatcher-side** at the merge locus, mirroring where today's L4 Step-10 holdout gate already runs (SKILL.md:828-832) — the build lane never writes the verdict. This is the same trusted-side-writes-evidence posture the merge floor already enforces, not a new hole.

**Step 6 — the OFFER (decision only).** Runs where the existing three-way spec offer already lives (SKILL.md:293-299), mirroring that standalone gate pattern.

```
PROCEDURE holdout_offer(spec_path, run_dir, issue):
  1. full_spec := faff dod split --spec <spec_path> --view full        # tracker comment; git-only: .faff/specs/<issue>.md
  2. bv := count of born-verifiable criteria in `faff dod classify --spec <full_spec>`
  3. IF bv == 0:                                                       # zero-born-verifiable short-circuit
       write marker { decision: skip, attended, born_verifiable_count: 0 }
       RETURN                                                          # no offer shown, no run will fire
  4. IF autonomous run (Step 6 already skips prompts):
       a. verif := faff verification resolve --json
       b. IF verif.unattended: write marker { decision: auto, attended:false, bv }
          ELSE:                 write marker { decision: skip, attended:false, bv }   # autonomous-but-not-unattended: no human, fact false
       RETURN
  5. ELSE (attended):
       a. verif := faff verification resolve --json
       b. IF verif.legs.holdout:                                       # standing config posture already on
            write marker { decision: accept, attended:true, bv }       # pre-accepted, no prompt needed
          ELSE:
            prompt "Run the code-blind holdout for this build after it completes? (y/n)"
            write marker { decision: (y ? accept : decline), attended:true, bv }
```

**Behaviour summary.** Step 6 decides and records; it never provisions an env or invokes the evaluator.

**Step 8c — the RUN (execution).** New step, immediately after Step 8b's checkpoint, before Step 9/10.

```
PROCEDURE holdout_run(spec_path, run_dir, issue, prdr_id):
  1. marker := read <run-dir>/<issue>/holdout-offer.json  (absent ⇒ treat as {decision: skip})
  2. verif  := faff verification resolve --json
  3. trigger :=
       verif.unattended                                               # unattended: the LIVE fact ALONE, marker-independent (a deleted/forged marker can NEVER suppress the guarantee); born-verifiable is re-asserted live at step 5
       OR (marker.attended AND marker.decision == accept)             # attended: marker-driven, advisory
  4. IF NOT trigger: RETURN                                           # attended-decline/skip, or autonomous-not-unattended ⇒ no run, no artifact
  5. full_spec := faff dod split --spec <spec_path> --view full
     IF `faff dod classify --spec <full_spec>` has zero born-verifiable: RETURN   # the SOLE born-verifiable gate for the run — live, marker-independent (spec-review fix: never read marker.born_verifiable_count in the trigger)
  6. IF a FRESH holdout.json already exists (mtime > build-progress.json): RETURN  # idempotent on resume
  7. holdout_step(full_spec, prdr_id, key=<issue>, run_dir):          # the SHARED engine — do NOT re-implement
       provision env slot → assert env-handle status:ready
       → invoke evaluator slot CODE-BLIND (FAFF-384 spawner: evaluate-call.mjs)
       → persist verdict to BOTH .faff/holdout/<issue>.json AND <run-dir>/<issue>/holdout.json  (AFTER the 8b checkpoint ⇒ fresh)
       → teardown env on EVERY exit path (success/block/exception)
```

**Step 10 reconciliation.** Delete the in-prose `holdout_step` invocation from Step 10's condition-4 and remove any first-time holdout prompt at the merge floor. Step 10 now only *consumes*: the FAFF-1040 merge floor (`resolveHoldoutLeg`) reads the `holdout.json` produced at Step 8c, and `faff holdout verdict --issue <issue>` asserts it. The attended advisory surface at Step 10 reads the same Step-8c verdict rather than running one.

**Edge cases and error handling.**

- **Absent marker at Step 8c** → treated as `skip` for the attended arm; the unattended arm still fires on the live fact (guarantee is never marker-suppressed).
- **Attended decline / zero-born-verifiable** → no `holdout.json` → merge floor `can_run: absent → pass-through → not-applicable`. Merge proceeds; no gate, no park.
- **Env fault during the run** (`env-handle status:failed`) → surfaced as an env-lane fault, never silently a feature `fails`. Teardown still runs.
- **Stale verdict** (somehow pre-checkpoint) → merge floor `faulted → strict → blocked`. This is why Step 8c runs strictly after Step 8b.

**Anti-pattern:** Running `holdout_step` at Step 6. Why: nothing is built yet, and the verdict would predate the Step-8b checkpoint → `faulted → blocked` forever.
**Anti-pattern:** Keying the unattended run on `verif.legs.holdout`. Why: it is hard-zeroed for unattended (config.js:845) → dead code, holdout never fires.
**Anti-pattern:** Adding a merge-time "offer" posture. Why: `resolveHoldoutPosture` deliberately has none; by merge time the only fact is whether a fresh caged verdict exists.

**Failure modes.**

- **The failure:** the "unattended fact" I key on is broader than today's L4-only gate, so an L3 run with `autonomous.unattended` declared now auto-provisions an env per issue — a cost the operator did not anticipate. **How you'd know:** env-provision count on L3 unattended drains jumps; run-cost telemetry rises without a level change. **What it means:** narrow via the punted cost cap, or accept it as the intended widening. Not a correctness fault.
- **The failure:** an autonomous-but-not-unattended L3 beep-boop run gets neither offer nor run, so a spec-failing feature merges un-held. **How you'd know:** an L3 unattended-declared vs plain-L3 A/B shows holdout coverage only on the former. **What it means:** this is intended — the blocking guarantee is scoped to the unattended fact; plain autonomous L3 has no human and did not opt in. Documented, not a gap to close here.

## 5. Scenarios — born-verifiable main objectives

```
Given an attended graft on a spec with >=1 born-verifiable criterion and verification.holdout unset
When Step 6 runs
Then the operator is prompted to run the holdout, and no env is provisioned at Step 6
```

```
Given an attended graft where the operator declined the Step-6 offer
When the build reaches the merge floor with no holdout.json written
Then the merge floor resolves holdout_posture "pass-through" and the merge is not blocked on the holdout leg
```

```
Given an unattended run (ledger.level L4, or declaredUnattendedFromConfig true) on a spec with >=1 born-verifiable criterion
When Step 8c runs after the Step-8b build-complete checkpoint
Then holdout.json is written with mtime strictly greater than build-progress.json, and readCanRun reports "satisfied"
```

```
Given an unattended run whose Step-6 offer marker was deleted before Step 8c
When Step 8c evaluates its trigger
Then the holdout still runs (the unattended fact, not the marker, drives it)
```

```
Given a spec with zero born-verifiable criteria
When Step 6 and Step 8c run
Then no offer is shown, no env is provisioned, no holdout.json is written, and the merge floor is pass-through
```

- The Step-8c run MUST invoke the shared `holdout_step`; it MUST NOT contain a second env-provision or evaluator-invocation implementation.
- The unattended run MUST NOT consult `verif.legs.holdout` (which is always false unattended); it MUST key on `verif.unattended`.

## 6. Design Decision Rationale

**Where does the OFFER surface, and does it execute anything?**
Options: (a) run the holdout at Step 6; (b) decide at Step 6, run later. (a) is the prior spec's fatal shape — no built feature, stale-by-construction verdict. **Chosen:** (b) — Step 6 mirrors the existing standalone offer-gate (SKILL.md:293-299), records a decision, executes nothing. Forced by the freshness gate.

**Where does the RUN go?**
Options: at Step 6; at Step 8c (post-checkpoint); at Step 10 (merge floor). **Chosen:** a new Step 8c immediately after the Step-8b build-complete checkpoint — the earliest point where the feature is built *and* the FAFF-420 freshness comparison (`holdout.json` mtime > `build-progress.json`) can pass. Rationale verified against `readHoldout`/`holdoutIsFresh` (merge-gate.js:698-712, contract-defs.js).

**How is the Step-6 decision carried to Step 8c, without hard-depending on FAFF-1116?**
Options: run-ledger flag (overlaps FAFF-1116's territory); per-issue run-dir marker; recompute at Step 8c. **Chosen:** a per-issue `<run-dir>/<issue>/holdout-offer.json` marker for the attended decision, plus live recomputation of the unattended fact. Independent of FAFF-1116; when FAFF-1116 lands its ledger capture, the marker can be subsumed. `(decides: architecture)`

**What triggers the RUN in each mode?**
**Chosen:** attended → the marker (`decision == accept`), advisory; unattended → the live `unattended` fact, mandatory. Never `legs.holdout` for unattended (config.js:843-852 zeroes it). Reuse `faff verification resolve` only for the attended standing-posture read.

**How is the offer/run capability-gated?**
**Chosen:** gate both on `faff dod classify` reporting >=1 born-verifiable criterion, at any level (not just L4). Zero-born-verifiable short-circuits the offer and the run — no env, no artifact, merge-floor pass-through. Mirrors the short-circuit already in Step 10 (SKILL.md:607).

**Is an attended decline a gate or a park?**
**Chosen:** advisory only — no gate, no park. It writes no `holdout.json`; the merge floor reads absent → pass-through. Verified: `resolveHoldoutPosture` returns pass-through on `can_run: absent`.

**Does the autonomous-but-not-unattended L3 class get a holdout?**
**Chosen:** no — no offer (autonomous skips Step-6 prompts) and no auto-run (unattended fact false). This preserves today's L1-L3 behaviour for that class; the blocking guarantee is scoped to the declared unattended fact.

**Is Step 8c idempotent on resume?**
**Chosen:** yes — if a fresh `holdout.json` (mtime > checkpoint) already exists, skip the re-run; otherwise run. Avoids a redundant env provision when a run resumes at review after Step 8c already completed.

**Does a low-level unattended auto-run need a cost cap?**
**Punt:** a `verification` config cost-cap leaf vs relying on the zero-born-verifiable short-circuit — needs human. `(decides: product)`

## 7. Open Questions and Assumptions

**Open Questions.**

- **Cost of low-level unattended auto-run.** **Punt:** Add a `verification.*` cost-cap leaf to bound env provisioning on L1-L3 unattended drains, or rely solely on the zero-born-verifiable short-circuit? — needs human `(decides: product)`. Context: widening from L4-only to any-unattended means an env per born-verifiable issue at any level.

**Assumptions.**

- **Assumes:** FAFF-384 has shipped the evaluator-lane wiring inside `holdout_step` (the `evaluate-call.mjs` spawner, lane-boundary cage, spawner attestation). Validate: confirm `holdout_step`'s code-blind dispatch is present and that a run's `lane-boundary.json` declares `lane: evaluator, container: own, accesses.repo: absent` before relying on structural code-blindness.
- **Assumes:** FAFF-1040's merge floor reads an absent `holdout.json` as `pass-through` (non-blocking). Validate: `resolveHoldoutPosture({can_run:"absent"})` returns `posture:"pass-through"` (contract-defs.js:2301-2303) — already confirmed against the tree.
- **Assumes:** `faff verification resolve --json` exposes a top-level `unattended` field equal to the unattended fact. Validate: config.js:883,892 — confirmed.

## 8. DONE — Definition of Done

### From WHY
- [ ] The holdout OFFER (Step 6) records a decision and provisions no env / invokes no evaluator.
- [ ] The holdout RUN writes `<run-dir>/<issue>/holdout.json` with mtime strictly greater than `<run-dir>/<issue>/build-progress.json`.

### From WHAT (types and interfaces)
- [ ] `<run-dir>/<issue>/holdout-offer.json` is written at Step 6 with `{decision, attended, born_verifiable_count, decided_at}`.
- [ ] `born_verifiable_count == 0` implies `decision == skip`; `decision == auto` implies `attended == false`.
- [ ] The unattended trigger reads `verif.unattended` (or the equivalent `(ledger.level=="L4")||declaredUnattendedFromConfig(cfg)`), never `verif.legs.holdout`.

### From HOW (behaviour)
- [ ] Attended, `verification.holdout` unset, born-verifiable > 0 → Step 6 prompts; on accept, marker `decision:accept`; on decline, `decision:decline`.
- [ ] Attended, `verification.holdout` set → marker `decision:accept` without a prompt.
- [ ] Unattended, born-verifiable > 0 → marker `decision:auto` at Step 6 and `holdout_step` runs at Step 8c.
- [ ] Autonomous-but-not-unattended → marker `decision:skip`, no run.
- [ ] Zero born-verifiable → no offer, marker `decision:skip`, no env, no `holdout.json`.
- [ ] Step 8c invokes the shared `holdout_step` (no second env/evaluator implementation) and tears the env down on every exit path.
- [ ] Step 10 no longer invokes `holdout_step` and shows no first-time holdout prompt; it consumes the Step-8c verdict via the FAFF-1040 merge floor.

### From HOW (edge cases)
- [ ] Attended decline → no `holdout.json` → merge floor `holdout_posture:"pass-through"`, merge not blocked on the holdout leg.
- [ ] Unattended run with the marker deleted before Step 8c → holdout still runs.
- [ ] A fresh `holdout.json` already present at Step 8c → the run is skipped (idempotent).
- [ ] On a resume-store restore (`cp .faff/resume/<issue>/*.json`), the restored `holdout.json` mtime still postdates the restored `build-progress.json` (freshness ordering preserved across the copy) — pinned by test, not left to `cp` glob order.
- [ ] Under a dispatch cut, the RUN executes dispatcher-side (the build lane returns `pr-ready` without writing `holdout.json`); only a top-level/sequential run writes the verdict in-lane at Step 8c.
- [ ] An `env-handle status:failed` at Step 8c is surfaced as an env fault, not a feature `fails`.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the evaluator seam is FAFF-384's, unchanged); no new grader/eval-case row required. If the reconciliation touches the holdout verdict rendering, register the seam row in this ticket.

**Integration smoke test.**

```
1. Unattended run (L4), spec with >=1 born-verifiable criterion.
2. Step 6 writes holdout-offer.json {decision:auto}.
3. Step 8b writes build-progress.json.
4. Step 8c runs holdout_step; assert holdout.json exists AND mtime(holdout.json) > mtime(build-progress.json).
5. faff merge-gate resolveHoldoutLeg → holdout_posture "strict", holdout read from the fresh verdict.
```

## Already shipped against this surface

- **FAFF-1040 — Done (ADR-0131).** The merge floor that consumes a fresh code-blind holdout verdict; gates on capability facts, not the L4 label. This ticket is its upstream *producer*; the floor is unchanged. **Premise HOLDS** — verified against `resolveHoldoutLeg`/`resolveHoldoutPosture` in the current tree.
- **FAFF-1101 — Cancelled.** The prior single-ticket approach (offer + run at build-start) was reject-approach for running the holdout before a feature existed; split into this ticket (the offer/run separation) and FAFF-1116 (the SUT-standability ledger capture). **Premise HOLDS.**
- **FAFF-384 — dependency.** Evaluator-lane wiring inside the shared `holdout_step`; this ticket reuses it and does not re-wire the evaluator lane. (Methodology critique corrects the SHIP-NOT-WIRE assumption: FAFF-384 is **Done** (2026-07-13, PR #354) — the lane exists; 1115 only relocates the `holdout_step` *call site* to Step 8c. The Assumes becomes a confirm-the-lane-exists validation, not an open blocker.) **Premise HOLDS** (see Assumptions for the validation step).

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No blocking issue; one watch-item. One outcome (a fresh code-blind holdout verdict feeding the FAFF-1040 floor) threaded across three graft touch-points (Step 6 OFFER, new Step 8c RUN, Step 10 reconciliation) that move together — a marker with no reader, or a runner with no marker, is dead alone. Under the merge test these are one always-ship-together unit; the two things that could split (offer/run conflation, sut_standable ledger) were already split out (to this ticket and FAFF-1116). Hold as one ticket. Watch-item for build: Step 8c is a new checkpoint (new plumbing + a re-pointed `holdout_step`) at the upper edge of the 1-3 day band — revisit a split only if it proves independently large.

**Workstream fit?** Surface, not a defect. The ticket is loose in Backlog (no project/priority/labels) yet describes itself as part of the unattended-L3-safety-floor cluster (FAFF-1040/1072/1073/717/1061), which is not a tracker container. Loose work isn't sequenced against its siblings and has no container Definition of Done. What to do: home FAFF-1115 (and the cluster) in an outcome project that owns the unattended-L3-safety-floor guarantee, or leave it loose deliberately and say so. Proposal, not a write.

**Deps surfaced?** Partly; one missing edge (now added). FAFF-384 linked `relatedTo` (non-blocking) is correct — it is Done and satisfied; the Assumes is a confirm-the-lane check, not an open blocker. FAFF-1116 (the sut_standable ledger sibling that later subsumes this ticket's `holdout-offer.json` marker) had **no** graph edge — the marker→ledger subsume path lived only in prose (a Principle-6 smell). A `related` edge between FAFF-1115 and FAFF-1116 has been added recording the marker-now / ledger-later relationship (no `blockedBy` — 1115 ships the marker independently, 1116 later replaces it).

**Risk profile?** Surface, no new spike. The novel piece is the unattended-keying: driving the auto-run off the unattended fact (`declaredUnattendedFromConfig` / ledger level) to bypass `resolveInteractiveVerification`, which zeroes `legs.holdout` for unattended — the exact FAFF-1101 failure surface. Get it wrong and the auto-run silently never fires, or a stale pre-build verdict trips FAFF-1040's freshness gate → `blocked` → the live Done merge floor refuses every run. No new spike (FAFF-384 shipped, FAFF-1073 owns feasibility); de-risk in build via the integration smoke test (§8) that pins the unattended-fact→Step-8c auto-run and the `holdout.json` mtime > Step-8b checkpoint ordering. Resolve or explicitly scope out the cost-cap Punt before build.

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen", "topic": "OFFER is decision-only at Step 6, executes nothing" },
    { "marker": "chosen", "topic": "RUN placed at new Step 8c, after the build-complete checkpoint" },
    { "marker": "chosen", "topic": "Decision-carry via per-issue run-dir marker, not FAFF-1116 ledger" },
    { "marker": "chosen", "topic": "Attended trigger = marker; unattended trigger = live unattended fact, never legs.holdout" },
    { "marker": "chosen", "topic": "Capability-gate offer and run on born-verifiable at any level; zero short-circuits" },
    { "marker": "chosen", "topic": "Attended decline is advisory (merge-floor pass-through), no gate/park" },
    { "marker": "chosen", "topic": "Autonomous-but-not-unattended class gets neither offer nor auto-run" },
    { "marker": "chosen", "topic": "Step 8c idempotent on resume when a fresh holdout.json exists; resume-cp freshness ordering pinned" },
    { "marker": "chosen", "topic": "Step 10 reconciliation: consume the Step-8c verdict, no run, no first-time prompt" },
    { "marker": "chosen", "topic": "under a dispatch cut the RUN executes dispatcher-side (holdout.json stays trusted-side-written, evidence class); in-lane only top-level/sequential" },
    { "marker": "punt", "topic": "Cost cap for low-level unattended auto-run (decides: product)" },
    { "marker": "assumes", "topic": "FAFF-384 evaluator-lane wiring shipped inside holdout_step" }
  ] }
```
