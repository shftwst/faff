# FAFF-1073 — Spike: is holdout-at-L3 feasible?

> Spec: faffter-dark-nlspec · 2026-09-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1073.

This is the investigation plan for **FAFF-1073** — a time-boxed spike, not a build. It is written for the build agent who will run the measurements and for the human reviewers on FAFF-1040 who will read the decision it produces. The "spec" below is a measurement protocol: what to measure, on what sample, with which real seams, inside a fixed time-box, and what decision the numbers must let FAFF-1040 close. It ships a decision plus a reproducible measurement artifact under `records/spikes/`, never product code.

## 1. WHY — Problem and Principles

**The load-bearing model: holdout at L3 would run by default and, on an inability to test, pass the merge through rather than park it — so the honesty of that guarantee depends entirely on how often "inability" fires, which nobody has measured.** FAFF-1040 wants to extend the code-blind holdout gate down from L4 to L3. At L4 today the gate provisions an env, runs the evaluator code-blind against the running feature, and blocks a non-`meets-spec` merge (`plugin/skills/faff-graft/SKILL.md` ~570, ~607-613; `plugin/skills/faff-beep-boop/SKILL.md` per-run holdout phase). The proposed L3 posture is **lenient**: when holdout cannot run, the merge passes through (the L3 morning review catches it post-merge) instead of parking. That posture is only honest if the inability case is rare and understood. This spike measures the inability rate and the run cost before FAFF-1040 commits.

**Problem statement:** Today at L1-L3 nothing runs — no env, no evaluator; the merge floor is the three-condition AC+CI+review (`faff-graft` ~570: "At L1-L3 this condition does not apply and no env is provisioned"). FAFF-1040 cannot choose between L3-lenient and a stricter guarantee without knowing how often holdout would actually produce a verdict versus fall through one of three inability conditions. This spike supplies that number, and the per-issue standup cost that sits behind it.

**Design principles:**

**Mine before you build.** The default is retrospective analysis over the existing `.faff/runs/` ledger corpus and the 753 committed specs under `records/specs/`, in the style of the FAFF-411 spike (`records/spikes/2026-07-10-faff-411/`). A live env-standup sample is added only where the corpus cannot answer the question, and it is kept small and bounded. An open-ended build harness is out of scope by construction.

**A null or negative result is a valid outcome.** "Inability is common, so L3-lenient is the only honest posture" is a complete, shippable answer. So is "inability is rare, a stricter guarantee is viable." The spike is not obliged to make holdout look feasible; it is obliged to report what the numbers say with cited data.

**Measure the shipped default, not the aspiration.** Code-blindness today is a self-attestation (`code_blind: true` set by the evaluator, checked only for presence), not a physical fact — grepping every skill for `faff lane-boundary emit --lane evaluator` finds zero live call sites; only `--lane build` is emitted (`plugin/skills/faff/bin/lib/lane-boundary.js:28` marks the evaluator lane SHIP-NOT-WIRE, and ADR-0041 assigns the physical cage to an outer orchestration layer faff "asserts but never launches"). The spike characterises inability condition (c) as it exists in a run you would see today, not as the FAFF-384 spawner machinery would make it if wired.

**Reference context:**

| Seam | File | Relevance to the measurement |
|---|---|---|
| Holdout evaluator (occupant) | `plugin/skills/faffter-noon-evaluate/SKILL.md` | The judge whose feasibility is under test |
| Caged spawner (built, not wired) | `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Condition (c): the spawner-attested path that is not live |
| Holdout verdict contract | `plugin/skills/faff/contracts/holdout-verdict.schema.json` | The verdict shape mined/emitted |
| DoD classifier | `plugin/skills/faff/bin/lib/admissibility.js` (`dodClassify`, `classifyCriterion`) | Condition (a): born-verifiable criteria, retrospectively computable over specs |
| Env provisioner | `plugin/skills/faffter-noon-env-compose/SKILL.md` | Condition (b): standup wall-time + fault rate seam |
| Env handle contract | `plugin/skills/faff/contracts/env-handle.schema.json` | `status: ready` vs `status: failed` — the fault signal |
| Lane boundary | `plugin/skills/faff/bin/lib/lane-boundary.js` | Evidence condition (c) is attested-not-physical today |
| Reporting precedent | `records/spikes/2026-07-10-faff-411/RESULTS.md` + `analyze.mjs` | The retrospective-mining method + report shape to reuse |
| Ledger corpus | `.faff/runs/` (222 run dirs) | The retrospective data source |

**Scope statement:** This spike is the holdout-feasibility measurement feeding FAFF-1040's per-mechanism L3/L4 decision; it sits beside FAFF-1072 (which already decided admissibility + custody at L3 by gating on run facts, not the L-level label).

**Sequencing.** The spike must land *before* FAFF-1040 opens (it de-risks that decision). Home it in FAFF-1040's value stream and sequence it ahead of the parent, or leave it deliberately project-less in Backlog with that intent noted — either is fine, but it must not drift unsequenced, or the finding arrives after the decision it exists to inform.

## Already shipped against this surface

Related work checked during prep — the premise still holds (none of these deliver the env-standup feasibility measurement this spike exists to produce):

- **FAFF-717** (Done) — decoupled Sentry-acting from the L4 mint (`autonomous.sentry_acting`) but **explicitly deferred** the holdout opt-in for unattended L3, recording the reason: holdout is preview (attested-not-physical) + no standup target on a CLI/skills repo like faff itself. This spike measures exactly that deferred question.
- **FAFF-1072** (Done, PR #927) — the sibling extraction from the same parent FAFF-1040; decided admissibility + custody at L3 via "gate on run facts, not the L-level label." Template for how this spike's outcome feeds FAFF-1040.
- **FAFF-1040** (Backlog) — the parent decision this spike feeds; holdout is its remaining subject.
- **FAFF-961** (Done) — code-blind holdout handed integration-tier DoD criteria it can't observe, stalling the L4 drain: inability conditions (a)/(b) already biting at L4 in production (a consistency cross-check for the mined rate).
- **FAFF-563 / FAFF-625 / FAFF-317 / FAFF-284** (Done) — prior holdout-evaluator error-rate spikes (evaluator accuracy given a running env — a different question from env-standup feasibility; method precedent, not overlap).
- **FAFF-384 / FAFF-276 / FAFF-313** (Done) + ADR-0041 — the code-blind cage machinery + the prior design-level refutation of the code-blindness question.
- **FAFF-310 / FAFF-474 / FAFF-307 / FAFF-270 / FAFF-30** (Done) — real architecture→env→evaluate standup e2e evidence to sample from.

## 2. OUT OF SCOPE

- **Wiring the physical evaluator cage** — Why excluded: FAFF-384/ADR-0041 machinery exists but is not live; wiring it is FAFF-1040-and-beyond product work, not measurement. Extension point: `faff lane-boundary emit --lane evaluator` call sites + `evaluate-call.mjs` dispatch in `faff-graft` Step 10 / `faff-beep-boop` §10b.
- **Changing the L3 merge floor or the guarantee posture** — Why excluded: the spike *decides* the posture with evidence and hands it to FAFF-1040; FAFF-1040 owns the code change. Extension point: `faff-graft` ~570 merge-floor conditions and the `$lights_out` resolution locus.
- **Re-measuring evaluator judgement accuracy** — Why excluded: FAFF-563/625/317/284 already measured evaluator error-rate given a running env; this spike measures env-standup *feasibility*, a different question. Extension point: the eval harness under `eval/` and those prior spike records.
- **Building a persistent holdout eval suite** — Why excluded: there is no `faffter-noon-evaluate/eval/` dir today and standing one up is open-ended; the spike reuses `eval/`'s driver architecture and FAFF-411's report shape only as far as the measurement needs. Extension point: a future `faffter-noon-evaluate/eval/` mirroring `eval/cli-driver.mjs`.
- **Standing up a SUT for faff itself** — Why excluded: FAFF-717 already recorded that faff is a CLI/skills repo with no standup target; measuring env feasibility on faff-on-faff would measure a known non-target. Extension point: the representative-repo sample defined in HOW.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Inability condition (a) | The ticket is unsuitable for holdout: `faff dod classify` reports zero born-verifiable (scenario/assertion) criteria, so the evaluator could only return all-`needs-human` |
| Inability condition (b) | The env cannot stand up the SUT: `faff env up`/`seed` yields an `env-handle` with `status: failed` (unprovisionable store, failed health, or failed seed) |
| Inability condition (c) | The env is not provably code-blind: no live spawner attestation, so `code_blind` is a self-attestation rather than a physical fact |
| Pass-through rate | The fraction of eligible L3 runs in which any inability condition fires, i.e. the merge would pass through un-holdout-tested under the lenient posture |
| Born-verifiable | A criterion classed scenario or assertion by `classifyCriterion` (scenario > assertion > prose) |
| Caught pre-merge | A real spec-fail the holdout gate would have blocked before `main`, versus one the L3 morning review would have caught post-merge |

**The measurement record — every run in the sample produces one:**

```
RECORD HoldoutFeasibilityObservation:
  issue_id: String                     # tracker id or corpus key
  source: ENUM{ retrospective, live }  # mined from ledger/spec, or a live standup
  born_verifiable_count: Int           # from faff dod classify (scenario + assertion)
  condition_a_fires: Bool              # born_verifiable_count == 0
  env_status: ENUM{ ready, failed, not-attempted }
  condition_b_fires: Bool              # env_status == failed
  standup_wall_secs: Float | null      # env up + seed wall-time; null if not-attempted
  teardown_wall_secs: Float | null
  provisioning_fault: String | null    # the violations[] reason on a failed handle
  code_blind_basis: ENUM{ self-attested, spawner-attested, none }
  condition_c_fires: Bool              # basis != spawner-attested (today: always true when holdout runs)
  holdout_ran: Bool                    # NOT (a OR b OR c-blocks); a verdict was produced
  verdict_aggregate: ENUM{ meets-spec, gaps, needs-human, n/a }
  real_spec_fail: Bool | null          # ground-truth: did this issue actually ship a spec-fail?
  caught_stage: ENUM{ pre-merge, post-merge-review, uncaught, n/a }

  CONSTRAINT condition_a_fires OR condition_b_fires OR condition_c_fires OR holdout_ran
```

**The headline outputs — one aggregate record for the decision doc:**

```
RECORD SpikeFindings:
  corpus_size: Int                     # observations, split retrospective/live
  pass_through_rate: Float             # fraction where any inability condition fires
  condition_a_rate: Float
  condition_b_rate: Float              # from the live sample
  condition_c_rate: Float              # today: ~1.0 while the cage is unwired — reported as such
  median_standup_wall_secs: Float
  standup_fault_rate: Float            # failed / attempted
  spec_fails_caught_pre_merge: Int     # where holdout ran and would have blocked
  spec_fails_left_to_review: Int       # inability pass-throughs a real fail slipped through
  decision: ENUM{ L3-lenient-only, stricter-viable }
```

**Design decisions:**

**Two-track method — retrospective mine for (a), a small live sample for (b) and (c).** Condition (a) is computable over the existing corpus: `faff dod classify` runs on any committed spec with no env, so the 753 specs under `records/specs/` (and the built-issue subset in the ledgers) yield the born-verifiable distribution directly, exactly as FAFF-411 mined `scenario_count`. Conditions (b) and (c) cannot be mined — **zero run-ledgers carry `level:"L4"`, so holdout has never actually run in the recorded corpus** — and a small live env-standup sample is the only way to get real wall-time and fault numbers. **Chosen:** two-track (retrospective condition-(a) mine + bounded live (b)/(c) sample) over a pure-retrospective or pure-live design — rationale in section 6.

**Condition (c) is reported as a state, not proven away.** Because the spawner cage is unwired, every holdout that runs today is self-attested; condition (c) "fires" for all of them in the strict physical sense. The spike reports condition (c)'s rate as the honest `~1.0` state-of-the-world under the shipped default and separately notes what it would become if FAFF-384 were wired, rather than attempting to physically establish blindness. **Chosen:** descriptive characterisation of condition (c) over a physical-cage measurement — rationale in section 6.

## 4. HOW — Behavior

**Approach.** Two independent tracks feed one findings record and one decision doc.

**Track 1 — retrospective condition-(a) mine (the FAFF-411 shape).** A single read-only script over the main checkout's `.faff/runs/` and `records/specs/`, mirroring `records/spikes/2026-07-10-faff-411/analyze.mjs`:

```
PROCEDURE mine_condition_a():
  1. Enumerate every committed spec (records/specs/*) and every built-issue ledger outcome.
  2. FOR each spec:
     a. Run `faff dod classify --spec <spec> --json`.
     b. Record born_verifiable_count = counts.scenario + counts.assertion.
     c. condition_a_fires = (born_verifiable_count == 0).
  3. Emit the condition_a distribution + rate, with the corpus/coverage table (FAFF-411 style).
  4. Cross-check against FAFF-961 (a real (a)/(b) bite at L4): confirm the mined rate is
     consistent with the conditions already observed in production.
```

**Track 2 — bounded live (b)/(c) sample.** A small representative set of real tickets with genuine standup targets, drawn from the architecture-to-env-to-evaluate e2e evidence (FAFF-310/474/307/270/30) plus the `env-compose` datastore matrix, run through the real env seam:

```
PROCEDURE sample_env_standup(issue, architecture):
  1. faff env compose-gen --profile <profile> --base-host <base>   # ProvisionPlan
  2. IF plan.unprovisionable[] non-empty: record condition_b_fires, status=failed, stop.
  3. t0 = now; faff env up --plan <plan> (docker compose up -d, 60s/2s health SLA)
  4. faff env seed --plan <plan> --manifest <m>; standup_wall_secs = now - t0.
  5. Assert `faff contract env-handle`: status ready | failed → condition_b_fires.
  6. Record code_blind_basis = self-attested (no --lane evaluator emit live) → condition_c_fires = true.
  7. t1 = now; faff env down --project <ref>; teardown_wall_secs = now - t1.
  8. Emit one HoldoutFeasibilityObservation.
```

**Behavior summary — where holdout *does* run.** For sample issues that clear (a) and stand up, run the real evaluator code-blind and record whether the verdict would have blocked a real spec-fail pre-merge, versus the count the L3 morning review would have caught post-merge. This is the "value delivered" side of the ledger against the "cost paid" side (wall-time + fault rate).

**The value-side oracle (best-effort by construction).** `real_spec_fail` / `caught_stage` need a ground-truth spec-fail signal. **Chosen:** establish it only from committed post-merge evidence — a revert or a follow-up fix commit referencing the issue, or a recorded FAFF-961-style stall/cascade — never by re-judging the merged feature (which would re-introduce the code-sighted judgement the holdout gate exists to avoid). Where no such evidence exists, the field stays null and the issue drops out of the value-side counts (`spec_fails_caught_pre_merge` / `spec_fails_left_to_review`); the value side is therefore **explicitly best-effort**. The primary decision rests on the three condition rates, which do not depend on this oracle — so a thin value side narrows the "was it worth it" colour, never the posture call itself.

**The time-box.** Two engineering days. Day 1: Track 1 script + the retrospective condition-(a) number over the full corpus (the cheap, high-coverage result). Day 2: Track 2 live sample of 8-12 representative issues (bounded — enough to bracket the standup fault rate and median wall-time, not to build a suite), then write the decision doc. If Track 2 cannot source real standup targets inside the box, fall back to the `env-compose` fixture matrix and label the (b) numbers as fixture-derived. **Chosen:** a two-day box with the retrospective result front-loaded so a partial spike still ships the (a) rate — rationale in section 6.

**The deliverable.** A dated dir under `records/spikes/` (the configured `spike_docs_path`) containing `RESULTS.md` (headline + corpus/coverage table + the SpikeFindings record + the decision, FAFF-411 shape), the reproducible `analyze.mjs`, and its committed machine output. `RESULTS.md` ends with the explicit hand-back to FAFF-1040: the posture recommendation and the numbers behind it.

**Failure modes — how this measurement could mislead, and how you'd notice:**

- **The zero-L4-ledger confound.** The failure: conditions (b)/(c) have no retrospective data at all because holdout never ran at L3-or-below and no ledger is L4, so a live sample of 8-12 is the *entire* basis for the (b) rate. How you'd know: the corpus/coverage table shows n=0 for mined (b)/(c) and a single-digit live n. What it means: report the (b) fault rate with a wide caveat and treat it as a bracket, not a point estimate; the (a) rate (n in the hundreds) carries the confident part of the decision.
- **The representative-sample confound.** The failure: faff itself has no SUT, so the live sample uses *other* repos/architectures whose standup cost may not match the real L3 ticket distribution. How you'd know: the sampled architectures cluster (e.g. all postgres-backed web apps) while `env-compose`'s `DATASTORE_TABLE` covers more. What it means: narrow the claim to the architecture classes actually sampled; name the unsampled classes as an open question for FAFF-1040.
- **The attestation illusion.** The failure: reading `code_blind: true` off a mined or live verdict and treating it as a physical fact, concluding condition (c) is rare. How you'd know: no `--lane evaluator` emit exists, so every `code_blind: true` is self-attested by construction. What it means: condition (c) is ~always-on today; a stricter guarantee that *requires* physical blindness is not viable until FAFF-384 is wired — that is itself a finding, not a gap.
- **Small-sample fault rate.** The failure: a single flaky docker health-timeout in a sample of 10 swings the fault rate by 10 points. How you'd know: the fault rate's confidence interval is wider than the gap between the two candidate postures. What it means: the spike cannot distinguish the postures on (b) alone — say so, and let the (a) rate carry the decision.

**Anti-pattern:** Building a durable holdout eval harness to get the numbers. Why: the spike is time-boxed measurement; a reproducible `analyze.mjs` plus a scripted live sample answers the questions without a suite, and the suite is explicitly out of scope.

**Anti-pattern:** Reporting a single "feasibility: yes/no". Why: the decision is a posture (L3-lenient vs stricter) grounded in three separate condition rates; collapsing them hides which condition drives the answer.

## 5. Scenarios

The spike's main objectives, born verifiable. These assert the investigation was actually performed and recorded, not that a feature works.

```
Given the full records/specs/ corpus and the .faff/runs/ ledgers
When the Track-1 retrospective mine runs `faff dod classify` over every committed spec
Then a condition-(a) rate is recorded with a corpus/coverage table citing the sample size
```

```
Given a representative set of real tickets with standup targets
When the Track-2 live sample runs the env-compose → up → seed → down seam per issue
Then each issue yields a HoldoutFeasibilityObservation with standup wall-time, teardown wall-time, env_status, and any provisioning fault
```

```
Given the recorded observations from both tracks
When the SpikeFindings record is assembled
Then it reports pass_through_rate plus each of the three condition rates, and a decision of L3-lenient-only or stricter-viable with the numbers behind it
```

- The condition-(c) rate MUST be reported as the state-of-the-world under the shipped default (self-attested, cage unwired), never as a physically-established blindness measurement.
- The decision doc MUST land under `records/spikes/` (the configured `spike_docs_path`) with a reproducible analysis script and its committed machine output.
- The RESULTS.md MUST hand back to FAFF-1040 an explicit posture recommendation traceable to the recorded rates.

## 6. Design Decision Rationale

**How to get the numbers — pure-retrospective, pure-live, or two-track?**
- Pure-retrospective: cheapest, highest coverage — but zero L4 ledgers means conditions (b)/(c) are unmeasurable this way.
- Pure-live: real (b)/(c) numbers — but an open-ended build, and (a) is answerable far more cheaply from the corpus.
- Two-track: mine (a) over hundreds of specs, sample (b)/(c) live on a bounded set.
- **Chosen:** two-track — it puts the confident part of the decision (the large-n (a) rate) on cheap retrospective data and spends the live budget only where nothing else can answer.

**How to treat condition (c) given the unwired cage?**
- Attempt a physical-cage measurement: would require wiring FAFF-384, which is out of scope and would blow the time-box.
- Report (c) descriptively: state that today's holdout is self-attested (~always fires in the physical sense) and note what wiring the cage would change.
- **Chosen:** descriptive characterisation — the shipped default is what an L3 run would actually use, and its attestation posture is itself a finding FAFF-1040 needs.

**How big a time-box, and how ordered?**
- Open-ended: risks the exact build the ticket forbids.
- Two days, retrospective-first: a partial spike still ships the (a) rate; the live sample is the second-day add.
- **Chosen:** two-day box, Track 1 front-loaded — de-risks a partial result and matches the FAFF-411 precedent's cost.

At the time of writing, the evaluator lane is SHIP-NOT-WIRE (`lane-boundary.js:28`) and no `--lane evaluator` emit exists; the condition-(c) finding should be revisited if FAFF-384 is wired live.

## 7. Open Questions and Assumptions

**Open Questions:**

- **Punt:** The final L3 holdout guarantee posture (L3-lenient pass-through vs a stricter guarantee) is the spike's *output*, recommended with evidence but committed by FAFF-1040 — needs human (decides: product). The spike hands over the rates and a recommendation; the parent ticket makes the standing product commitment.

**Assumptions:**

- **Assumes:** The `.faff/runs/` ledger corpus and the 753 committed specs are representative of the real L3 ticket distribution. Validation: report corpus size and coverage in the RESULTS table (as FAFF-411 did) and flag any skew before drawing the (a) rate.
- **Assumes:** Representative repos with genuine standup targets are available to sample env provisioning, since faff itself has none (FAFF-717). Validation: before Track 2, enumerate candidate repos/architectures from the FAFF-310/474/307/270/30 e2e evidence; if none are reachable in the box, fall back to the `env-compose` fixture matrix and label the (b) numbers fixture-derived.

## 8. DONE — Definition of Done

### From WHY
- [ ] The pass-through rate (fraction of eligible L3 runs where any inability condition fires) is recorded with cited data.

### From WHAT (measurements)
- [ ] Condition-(a) rate recorded from `faff dod classify` over the committed-spec corpus, with a corpus/coverage table stating the sample size.
- [ ] Condition-(b) rate (env `status: failed`) recorded from the live sample, with per-issue provisioning-fault reasons.
- [ ] Condition-(c) reported as the shipped-default state (self-attested, cage unwired), not as a physical-blindness measurement.
- [ ] Median standup wall-time and standup fault rate recorded from the live sample.
- [ ] Count of real spec-fails the holdout gate would catch pre-merge vs the count left to the L3 morning review recorded.

### From HOW (method)
- [ ] Track-1 retrospective mine implemented as a read-only, re-runnable script over `.faff/runs/` + `records/specs/`.
- [ ] Track-2 live sample exercises the real `faff env compose-gen → up → seed → down` seam and tears every env down on exit.
- [ ] The investigation stayed within the two-day time-box (or a partial result shipped the front-loaded (a) rate).

### From HOW (decision + deliverable)
- [ ] The decision (L3-lenient-only vs stricter-viable) is made with evidence and stated in RESULTS.md.
- [ ] Results committed under `records/spikes/<dated-dir>/` with RESULTS.md, a reproducible analysis script, and its committed machine output.
- [ ] RESULTS.md hands back to FAFF-1040 an explicit posture recommendation traceable to the recorded rates.

**Integration smoke test:**

```
PROCEDURE spike_smoke():
  1. Run the Track-1 script over the corpus → assert it emits a condition_a_rate + coverage table.
  2. Run one Track-2 live standup on a single representative issue → assert one
     HoldoutFeasibilityObservation with a non-null standup_wall_secs and a torn-down env.
  3. Assert SpikeFindings assembles and names a decision value.
  If these three connect, the measurement plumbing is wired end to end.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** No issues. Two-day time-box, one deliverable (a decision + a committed analysis script), one investigative question. The two tracks measure different inability conditions of the *same* feasibility question and converge on one handoff to FAFF-1040 — splitting them would fragment one decision into two half-answers. Correctly one unit inside the 1-3 day envelope.
- **Workstream fit (principles 1 + 5):** Addressed in the Sequencing note above — home it in FAFF-1040's value stream and sequence it ahead, or leave it deliberately project-less; don't let it drift unsequenced.
- **Deps surfaced (principle 6):** `blocks FAFF-1040` and `related to FAFF-1072` are present. The "standup targets available" Assume rests on the `env compose→up→seed→down` seam being operational; confirm that seam is Done, else convert the Assume to a `blockedBy` edge. The fixture-matrix fallback mitigates it to non-blocking.
- **Risk profile (principle 7):** No issues. This is exactly the de-risking-spike instrument — the novel unknown is isolated into a bounded, time-boxed investigation that fires *before* FAFF-1040 commits. The single Punt keeps the spike's scope honest rather than smuggling the hard call into a time-boxed investigation.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen", "topic": "two-track method: retrospective condition-(a) mine plus bounded live (b)/(c) sample" },
    { "marker": "chosen", "topic": "condition (c) reported descriptively as the shipped-default state, not physically proven" },
    { "marker": "chosen", "topic": "two-day time-box, Track-1 retrospective front-loaded" },
    { "marker": "chosen", "topic": "value-side oracle from committed post-merge evidence only; value side explicitly best-effort" },
    { "marker": "punt", "topic": "final L3 holdout guarantee posture (lenient vs stricter) committed by FAFF-1040" },
    { "marker": "assumes", "topic": "ledger + committed-spec corpus is representative of the real L3 ticket distribution" },
    { "marker": "assumes", "topic": "representative repos with standup targets are available for the live env sample" }
  ] }
```