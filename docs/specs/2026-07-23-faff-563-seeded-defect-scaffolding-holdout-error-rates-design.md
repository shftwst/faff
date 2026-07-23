# FAFF-563 — Seeded-defect scaffolding for measuring the holdout evaluator's error rates

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-563.

> **Refreshed 2026-07-23** (autonomous, `/faff-beep-boop` prep queue) — narrowed to the fork-independent scaffolding after the human Decision comment (2026-07-23, via `/faff-tidy`) closed the load-bearing approach-fork Punt and **split** the ticket. The production-scale runs are now separate filed tickets: **FAFF-625** (offline-proxy lower bound, `blockedBy` this ticket) and **FAFF-629** (live agentic lane, `blockedBy` FAFF-474 + FAFF-625). The corpus-size / results-home / timebox Punts moved **out** of this spec — they are owned by FAFF-625. What remains here is a timeboxable, fork-independent scaffolding deliverable with **no open architectural punts**, so confidence re-rates `medium → high`.
>
> **Spec-review revision (same session).** The autonomous adversarial spec-review returned `reject-approach` on the first pass — the architectural and QA lenses found the scorer's data-flow under-specified and several DoD items not born-verifiable. Those founded objections are folded in above: the case→label join is now explicit (re-load fixtures, join on `case_id`), the judged aggregate is obtained by re-deriving it via `deriveHoldoutAggregate` from the already-captured per-criterion classes (no change to `run-evals.mjs`), the scorer's correctness is gated by a synthetic-fixture unit test, the leakage test asserts over the *rendered prompt*, and the pilot gates on loop-closure not on the sensitivity rate. **The approach-critique gate was not re-run to an `approve` this session** because the `infosec` refuter's backend chain was fully unreachable (HTTP 504 / quota-429 / host-unreachable) — the transport floor forbids a silent pass through a down refuter, so a clean re-verdict must come from a human review or a later run with the backends healthy. Surfaced for `/faff-wtf`.

This is a design spec for the **fork-independent measurement scaffolding**, written for the build agent that will assemble the corpus format and scorer. It turns the ticket's question — *how sensitive is the code-blind holdout judge?* — into the reusable apparatus that makes the answer measurable: the seeded-defect fixture format, the deterministic scorer, the measurement protocol with its teaching-to-the-test discipline, and a small offline-proxy pilot that exercises the whole loop end to end. The production-scale number the L4 trust story cites is out of scope here (FAFF-625/629); this ticket delivers the machinery those runs will use.

## 1. WHY — Problem and principles

**The load-bearing model.** The L4 trust story terminates in one number the machinery *invokes* but nobody has *measured*: whether the code-blind holdout judge actually returns `unmet`/`gaps`/`fails` when handed a genuinely bad implementation. Everything upstream — container isolation, the `holdout-verdict` contract's fail-safe coercion, the `merge-gate` re-read — is mechanically enforced plumbing that can only ever route the judge's verdict. If the judge is insensitive (says `meets-spec` when the feature is broken), all that plumbing faithfully carries a wrong answer, and every L4 exit-proof downstream of the verdict is theatre. Measuring that sensitivity needs three things that do not exist today: a way to describe a labelled defective case, a way to turn a run's judgements into a false-pass / false-fail rate, and a protocol that keeps the measurement honest. **This ticket builds those three.** The production runs that turn the scaffolding into a citable rate are FAFF-625 (offline lower bound) and FAFF-629 (live end-to-end).

**Problem statement.** ADR-0029 measured 0/155 false-pass (~1.9% rule-of-three upper bound) for the strawman judge — but on **PR-diff-as-text**, not a stood-up runtime, and its own residual follow-ups (2) and (4) name the production job: runtime-exercise validation in a real env, and a production-scale negative set to push the bound below 1%. The shipped holdout evaluator exercises a *running feature* it never has the code for, so its diff-as-text sensitivity number does not transfer. The scaffolding here is the reusable measurement lane that the FAFF-625/629 runs re-measure sensitivity through.

**Design principles.**

- **False-pass is cardinal; false-fail merely parks.** A defective implementation judged `meets-spec` ships un-done work silently. A clean implementation judged `gaps`/`fails` only sends a human to look. The fixture format, the scorer's reporting shape, and the pilot all weight false-pass first. This mirrors ADR-0029's `unverified ⇒ not-done` fail-safe.
- **The measurement must not teach to the test.** Per the `docs/external-verification/` FAFF-547 measurement-boundary discipline: the evaluator (and any prompt it sees) must never be shown the operator's description of the defect classes being seeded. The judge derives criteria from the spec's DoD and exercises the env — it must not be handed "we injected a missing-422 defect here." The scaffolding enforces this by construction: the label fields are scorer-only and asserted never to render into the judge prompt.
- **The rate is only as honest as the corpus is representative.** A corpus of trivially-detectable defects (500-error where 200 expected) yields a flattering false-pass rate that the subtle real-world defect class never earns. The fixture taxonomy must span from blatant to subtle-and-plausible, and the scorer must stratify the reported rate by class so a low aggregate can't hide a blind spot in one stratum. The scaffolding bakes the strata into the format so the production corpus can't be built without them.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose skill | The subject under measurement — the code-blind judge |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JS | `computeHoldoutVerdict` / `deriveHoldoutAggregate` — the deterministic verdict roll-up the scorer reads |
| `plugin/skills/faff/contracts/holdout-verdict.schema.json` | JSON schema | The verdict shape `{aggregate, code_blind, criteria[], violations[]}` |
| `eval/grader.mjs`, `eval/run-evals.mjs`, `eval/cases/`, `eval/baselines/` | JS/JSON | The reusable measurement apparatus (grader `KINDS` include `holdout` + `holdout-exercise`) |
| `eval/cases/holdout-exercise-00{1,2}.json` | JSON fixtures | The `EvalCase` shape the corpus extends, and the offline proxy the pilot uses |
| `test/holdout-evaluate-integration.test.mjs` + `test/helpers/holdout-exercise.mjs` | JS | The docker-gated seeded-defect harness (N=1 pos + N=1 neg, deterministic exerciser) |
| `docs/adr/0029-…machine-dod-verification…md` | ADR | The direct precedent (diff-as-text bound) the production runs extend to runtime |

**Scope statement.** This is the fork-independent scaffolding slice of a T5 pre-proof spike. It delivers the corpus format, the scorer, the protocol, and a small offline pilot — the machinery. It does **not** produce a production-scale citable rate (FAFF-625/629), and it does not change the evaluator, the contract, or the leash.

## 2. OUT OF SCOPE

- **The production-scale error-rate runs (FAFF-625 / FAFF-629).** — Assembling the full labelled corpus (300+ negatives per ADR-0029 residual 4), running it, and recording the citable rate in the trust story is **FAFF-625** (offline-proxy lower bound, `blockedBy` this ticket) and **FAFF-629** (live agentic lane, `blockedBy` FAFF-474 + FAFF-625). Corpus sizing, results home, and the production timebox travel with those tickets. **This ticket delivers the format + scorer + protocol + pilot those runs consume.**
- **Building the live-lane agentic adapter (FAFF-474).** — Driving the *real* evaluator agentically against N docker envs is FAFF-474's job; the live production run that uses it is FAFF-629. This ticket builds neither. **Extension point:** `eval/live-driver.mjs` + a `LIVE_KINDS` holdout driver.
- **Changing the evaluator's judgement procedure.** — This measures the judge as shipped; it does not tune prompts or add checks. A measured insensitivity (from the pilot or the production runs) produces a *finding* (and possibly a new ticket), not a fix here. **Extension point:** `plugin/skills/faffter-noon-evaluate/SKILL.md`.
- **Wiring evaluator code-blindness enforcement (FAFF-276/384).** — The `evaluator-preflight.js` cage is ship-not-wire; the corpus must nonetheless keep the code out of the judge's context by construction (see the code-blindness Assumes). **Extension point:** the cage/spawner FAFF-384.
- **Local-model / cost characterisation.** — ADR-0029 residual (5). The frontier driver is the pilot's measurement lane. **Extension point:** `eval/ollama-model.mjs`.
- **Independent ground-truth audit.** — ADR-0029 residual (3): a second party re-labels a sample. The corpus here is builder-labelled; the audit is a follow-up. **Extension point:** a labelled-sample re-review ticket.

## 3. WHAT — Vocabulary, corpus format, and scorer

**Vocabulary.**

| Term | Definition |
|---|---|
| Positive / clean | An implementation that genuinely satisfies its spec's born-verifiable DoD. Correct verdict: `meets-spec`. |
| Negative / defective | An implementation carrying a *known injected* spec violation. Correct verdict: `gaps` or `fails` (never `meets-spec`). |
| False-pass | A negative the judge returns `meets-spec` on. The cardinal failure. |
| False-fail | A positive the judge returns `gaps`/`fails` on. Parks a human; non-cardinal. |
| Defect class | The kind of injected violation (see taxonomy). |
| Corpus unit | One (spec, implementation/env-surface, expected-verdict, label, defect_class?) tuple the judge is run against. |

**Defect taxonomy.** The four strata, each a distinct way an implementation can be wrong that a code-blind runtime judge might miss:

| Class | What is injected | Why it stresses the judge |
|---|---|---|
| `missed-criterion` | One born-verifiable DoD criterion is simply not implemented (endpoint absent, field never returned). | Tests whether the judge exercises *every* derived criterion, not a plausible subset. |
| `subtly-wrong` | The criterion is implemented but returns a wrong-but-plausible value (off-by-one status, `200` where `201` required, wrong field name). | The hardest class — surface-plausible output the judge must actually assert against, not eyeball. |
| `working-but-off-spec` | The feature works and looks right but violates a *specific* spec assertion (persists a different item than submitted; 404 where 422 required). | Tests discrimination — ADR-0029's standout was same-PR split-correctly quality; this is its runtime analogue. |
| `spec-satisfying-but-broken-elsewhere` | The targeted criterion is met, but an *adjacent* born-verifiable criterion the same spec states is broken. | Tests that a partial pass doesn't roll up to `meets-spec` — the aggregate-derivation guard's real-world exercise. |

**Chosen:** these four classes are the corpus strata — each maps to a concrete runtime observable the judge can be scored on and to an ADR-0029 negative sub-stratum. The scorer's `by_defect_class` stratification is keyed on exactly these four, so the production corpus (FAFF-625) inherits the strata from the format rather than re-inventing them.

**Corpus fixture format.** Extend the existing `EvalCase` fixture shape (as used by `holdout-exercise-00{1,2}.json`) with three label fields, so the corpus rides the harness that already grades holdout kinds:

```
RECORD SeededDefectCase EXTENDS EvalCase:
  id: string                       # e.g. "holdout-seed-neg-subtly-wrong-003"
  kind: "holdout" | "holdout-exercise"   # existing grader KINDS (unchanged)
  label: "clean" | "defective"     # NEW — the ground-truth polarity
  defect_class: DefectClass | null # NEW — null iff label == clean
  fixture: { spec_dod[], recordings[] | exercise, ... }   # existing shape
  oracle: { closed_set[] }         # existing per-criterion oracle
  expected_aggregate: Aggregate    # NEW — meets-spec (clean) | gaps|fails (defective)

  CONSTRAINT label == "defective"  <=>  defect_class != null
  CONSTRAINT label == "clean"      <=>  expected_aggregate == "meets-spec"
```

**Chosen:** extend `EvalCase` in place with `label` / `defect_class` / `expected_aggregate` rather than a parallel corpus format. Rationale: the grader, envelope parser, and raw-judgement capture (FAFF-320) already handle holdout kinds; a new format duplicates all of it. The new fields are additive and ignored by the existing set-equality grader.

**Scorer.** No false-pass/false-fail rollup exists today — the `eval/baselines/*.json` `per_kind` block holds only `{accuracy, stability, format_adherence}`, and the grader does per-criterion set-equality, not a labelled pos/neg confusion matrix. This ticket adds one:

```
RECORD ErrorRateReport:
  n_positive: int
  n_negative: int
  false_pass: int                  # negatives judged meets-spec
  false_fail: int                  # positives judged NOT meets-spec
  false_pass_rate: float           # false_pass / n_negative
  false_fail_rate: float           # false_fail / n_positive
  false_pass_upper_95: float|null  # rule-of-three when false_pass == 0: 3/n_negative; null when > 0
  by_defect_class: Map<DefectClass, { n, false_pass, rate }>   # stratified, all four keys
  reps: int                        # K per case
  driver: string                   # frontier | live | …
  captured_at, commit, model
```

**Chosen:** a **standalone scorer** (`eval/score-error-rates.mjs`) that reads the per-rep raw judgements (the durable `.faff/eval-runs/<run-id>/judgements.jsonl` FAFF-320 already streams) and emits `ErrorRateReport` — *not* an extension of the `per_kind` baseline block. Rationale: `per_kind` is a per-rep accuracy/stability aggregate consumed by the regression gate (`diffAgainstBaseline`); false-pass over a labelled corpus is a different shape with rule-of-three CIs, and jamming it into `per_kind` would entangle the gate with corpus polarity. Keep the gate untouched; the scorer is a separate read over the same captured judgements.

**Chosen — the case→label join (explicit).** `judgements.jsonl` records carry `{run_id, ts, case_id, kind, rep, status, raw_text, envelope, graded, score, signature, oracle}` — they do **not** carry the new `label` / `defect_class` / `expected_aggregate` fields, and by design must not (a label in the judged stream is the teaching-to-the-test leak the discipline forbids). The scorer therefore obtains ground truth by a **second pass**: re-load the `SeededDefectCase` fixtures from `eval/cases/`, build a `case_id → {label, defect_class, expected_aggregate}` map, and join each judgement to its case by `case_id`. The label fields live only on disk in the fixtures and only ever enter the *scorer's* process — never a judge prompt. A judgement whose `case_id` has no seeded-case entry is skipped (it is an ordinary eval case, not part of the corpus).

**Chosen — the judged aggregate is re-derived, not captured.** The scorer needs the judge's *actual* rolled-up aggregate to compare against `expected_aggregate`, but the grader records per-criterion `key:class` pairs (in the judgement record's `envelope`/`graded`), not the aggregate — and `run-evals.mjs` is deliberately left unchanged (no new capture field). So the scorer **re-derives** the judged aggregate from the captured per-criterion classes using the same `deriveHoldoutAggregate` logic the `holdout-verdict` contract uses (`plugin/skills/faff/bin/lib/contract-defs.js`). This keeps the capture format and the regression gate untouched and reuses the one canonical aggregate roll-up rather than inventing a second. The polarity check is then: re-derived-aggregate `== meets-spec` on a `defective` case → false-pass; re-derived-aggregate `!= meets-spec` on a `clean` case → false-fail.

**Chosen:** the scorer is **deterministic** — a join of `judgements.jsonl` records to on-disk case labels, a re-derivation of the aggregate via `deriveHoldoutAggregate`, plus arithmetic and a rule-of-three bound. It has no LLM seam, so it introduces no new grader `KIND` and needs no eval case of its own (the judge it scores is the existing `holdout` / `holdout-exercise` seam, already covered). Because it is deterministic, its own correctness is checkable by a unit test over a **synthetic** `judgements.jsonl` fixture with known per-criterion classes — independent of any real judge run (see §5 / §8).

## 4. HOW — Behaviour

**Architecture.** Four moving parts; three already exist, one (`score-error-rates.mjs`) is the new build:

```
PROCEDURE measure_error_rates:
  1. Assemble corpus:  clean + defective SeededDefectCase fixtures under eval/cases/.
                       (This ticket: the format + a small pilot set. Production sizing: FAFF-625.)
  2. Run the judge:    node eval/run-evals.mjs --only <seeded-cases> --reps K --driver <D>
                       → streams per-rep judgements to .faff/eval-runs/<run-id>/judgements.jsonl
  3. Score:            node eval/score-error-rates.mjs .faff/eval-runs/<run-id>/judgements.jsonl
                       → re-loads the seeded cases, joins each judgement by case_id, re-derives the
                         aggregate via deriveHoldoutAggregate, compares to expected_aggregate
                       → emits ErrorRateReport (false-pass/false-fail, stratified, rule-of-three)
  4. Record:           (production runs only — FAFF-625/629 — write the report where the trust story cites it.)
```

**Behaviour summary — how a defect becomes a false-pass count.** For each defective case, the judge (driven code-blind) exercises the born-verifiable criteria against the env-surface and records per-criterion classes. The scorer re-derives the judged aggregate from those captured classes (`deriveHoldoutAggregate`) and compares it to the case's `expected_aggregate` (joined from the on-disk fixture by `case_id`): a re-derived `meets-spec` on a `defective` case is a false-pass; anything-but-`meets-spec` on a `clean` case is a false-fail. Prose criteria are excluded from the polarity check — they are forced to `needs-human` by construction and are never the seeded defect.

**Fixture kind (pinned).** The pilot and smoke fixtures are `holdout-exercise` kind, whose fixture body is `recordings[]` (raw request/response transcripts). The `holdout` kind's body is `exercise` instead; the format's `recordings[] | exercise` alternation is keyed by `kind` (`holdout-exercise → recordings[]`, `holdout → exercise`) and is not a free choice. A seeded case's `kind` picks its body shape exactly as the existing grader's per-kind fixture-shape validation requires — authoring a `holdout`-kind case with `recordings[]` is a fixture-shape error, not a supported variant.

**The measurement lane (fork resolved).** Two materially different things can be called "the evaluator's error rate," and they require different apparatus. The human Decision (2026-07-23) resolved which this ticket builds:

| Approach | What feeds the judge | Measures | Owned by |
|---|---|---|---|
| **Offline proxy** | `holdout-exercise` recordings (static env-surface transcripts, defects injected into the recorded responses) | The judge's *criteria-mapping + met/unmet reasoning* over a fixed surface | The **pilot** here proves the loop; the production offline lower bound is **FAFF-625** |
| **Live agentic** | N real defective implementations stood up in docker envs; the real evaluator derives and executes against them | The *honest* end-to-end sensitivity the L4 trust story needs | **FAFF-629** (`blockedBy` FAFF-474 + FAFF-625) |

These do not measure the same thing — the offline number is a cheap lower-bound on reasoning quality, the live number is the one the trust story actually needs. **The scaffolding is common to both** (same fixture format, same scorer): this ticket builds the common apparatus and exercises it through the offline proxy at pilot scale, so the fork was settled with evidence, and the production runs pick up the lane each is scoped to.

**The offline-proxy pilot.** To prove the scaffolding end-to-end and give the FAFF-625 offline run a working starting point, this ticket authors a *small* pilot corpus — at least one clean case plus one defective case per stratum — as `holdout-exercise` fixtures, runs the judge over them, and scores the result. The pilot is a **loop-closing proof**, not a citable rate: its N is far below the ADR-0029 bound, so its `ErrorRateReport` is a shape-and-plumbing demonstration. It must be labelled with its `driver` and the FAFF-317 offline-proxy limitation so it is never laundered as the live number.

**Failure modes — how the measurement itself could be wrong.** (These are the discipline the scaffolding enforces; the production runs inherit them.)

- **Teaching-to-the-test leakage.** The defect description reaches the judge's context (via the case prompt, a leaked oracle, or a defect-labelled fixture field the renderer forwards). **How you'd know:** an implausibly low false-pass rate, especially on `subtly-wrong`; a spot-check of the rendered judge prompt shows defect-class strings. **What it means:** the run is invalid — the `label`/`defect_class`/`expected_aggregate` fields MUST be scorer-only and never enter the judgement prompt (asserted by a test in this ticket).
- **Unrepresentative corpus.** All defects are blatant, so the aggregate false-pass rate flatters the subtle class. **How you'd know:** `by_defect_class` shows near-zero error everywhere including `subtly-wrong`. **What it means:** report per-class, never a bare aggregate — the scorer's `by_defect_class` exists precisely so this can't hide.
- **Offline proxy stands in for live and nobody notices.** The cheap offline number gets cited as *the* sensitivity, but FAFF-317 says it cannot capture the agentic loop. **How you'd know:** a results doc cites a `holdout-exercise`-driven rate with no live-lane caveat. **What it means:** the `ErrorRateReport` records its `driver` and the FAFF-317 limitation, exactly as ADR-0029 labelled its diff-as-text caveat. (The pilot here is explicitly offline and labelled as such.)

**Anti-pattern:** reusing the docker integration test's N=1 pos + N=1 neg as "the measurement." Why: it is a *plumbing* proof (a deterministic non-LLM exerciser, not the LLM judge) — it shows the loop closes, not that the judge is sensitive at scale. The corpus format and scorer are the new work precisely because that test is not a rate.

## 5. Scenarios — born-verifiable main objectives

These are the scaffolding's own born-verifiable checks — each about the **scorer's determinism** and the **measurement boundary**, gated by a unit/integration test the build owns. They do **not** gate on the real judge's sensitivity *rate* (that is FAFF-625's job); a pilot's false-pass *count* is reported, never asserted below a threshold here.

```
Given a synthetic judgements.jsonl fixture whose records carry KNOWN per-criterion classes, joined to
      SeededDefectCase fixtures (1 clean + 1 defective per stratum) by case_id
When node eval/score-error-rates.mjs is run over it
Then it emits an ErrorRateReport whose false_pass, false_fail, false_pass_rate, false_fail_rate match
     the values arithmetically implied by the known classes, and whose by_defect_class map has all four
     stratum keys present
```

```
Given a synthetic judgement for a DEFECTIVE case whose known per-criterion classes re-derive (via
      deriveHoldoutAggregate) to meets-spec
When the scorer joins it to the case's expected_aggregate and classifies polarity
Then the scorer counts it as exactly one false_pass (the cardinal-failure count is computed correctly
     from the derived aggregate, not asserted by fiat)
```

```
Given a synthetic judgement for a WORKING-BUT-OFF-SPEC case where the targeted criterion's class is met
      but an adjacent criterion the same spec states is unmet
When the scorer re-derives the aggregate via deriveHoldoutAggregate
Then the derived aggregate is gaps or fails — a partial pass never re-derives to meets-spec — and the
     case is NOT counted as a false_pass
```

```
Given a SeededDefectCase and the driver's judge-prompt builder
When the prompt is rendered for that case
Then the rendered prompt string contains none of the case's label / defect_class / expected_aggregate
     values (the leakage assertion — the measurement-boundary discipline, a hard test)
```

- The `false_pass_upper_95` rule-of-three bound MUST be reported alongside the raw rate whenever `false_pass == 0` (value `3/n_negative`); when `false_pass > 0` it is `null`, never a fabricated float — so a zero-count is never read as a proven-zero rate and a non-zero count never carries a spurious bound.

## 6. Design decision rationale

- **Which defect classes?** Options: the ticket's four; a reduced two (blatant + subtle); a larger custom set. **Chosen:** the four listed classes — each maps to a distinct runtime observable and to an ADR-0029 negative sub-stratum. Locked into the scorer's `by_defect_class` key so the production corpus inherits them.
- **Corpus fixture format?** Options: new bespoke format; extend `EvalCase`. **Chosen:** extend `EvalCase` — reuses the grader, envelope parser, and FAFF-320 capture; new fields are additive.
- **Scorer home?** Options: extend `per_kind` baseline; standalone scorer over captured judgements. **Chosen:** standalone `eval/score-error-rates.mjs` — keeps the regression gate's `per_kind` semantics untouched; false-pass over a labelled corpus is a different aggregate shape. Deterministic (join + arithmetic), so no LLM seam.
- **Where does the judged aggregate come from?** Options: extend `run-evals.mjs` to capture the aggregate into `judgements.jsonl`; re-derive it in the scorer from the already-captured per-criterion classes. **Chosen:** re-derive via `deriveHoldoutAggregate` — the capture format and the regression gate stay byte-for-byte unchanged, and the one canonical roll-up is reused rather than a second one invented. The scorer is a pure read over existing capture.
- **How is the scorer's own correctness gated?** Options: gate on a real pilot judge run; a deterministic unit test over a synthetic judgements fixture. **Chosen:** the synthetic-fixture unit test — the scorer is deterministic, so its polarity/arithmetic/stratification logic is verifiable with known inputs, independent of (and far cheaper than) a real judge run. The pilot's real-judge run separately proves the *loop closes*; it never gates on the sensitivity rate (FAFF-625 owns that).
- **Measurement approach (formerly the load-bearing fork).** **Chosen:** phased + split (per the 2026-07-23 human Decision). This ticket delivers the fork-independent scaffolding (fixture format + scorer + protocol + teaching-to-the-test guard + small offline pilot); the production offline lower bound is FAFF-625 and the live agentic run is FAFF-629. Corpus sizing, results home, and the production timebox are owned by FAFF-625, not this ticket.

*Temporal anchor: at time of this refresh, the shipped `eval/` harness measures accuracy/stability/format only — no false-pass rollup exists (confirmed on main: `eval/grader.mjs` `KINDS` include `holdout` + `holdout-exercise`; `run-evals.mjs` streams `.faff/eval-runs/<id>/judgements.jsonl`; `faff dod classify` and `faff contract holdout-verdict` present; `score-error-rates.mjs` absent). FAFF-474 (live-lane adapter) remains unbuilt; that only gates FAFF-629, not this scaffolding.*

## 7. Open questions and assumptions

**Open Questions.** None architectural — the load-bearing approach fork was resolved by the 2026-07-23 human Decision (phased + split). The corpus-size, results-home, and production-timebox questions moved **out** of this spec and are **owned by FAFF-625** (the offline production run); they do not gate this scaffolding slice. This ticket is timeboxable in days.

**Assumptions.**

- **Assumes:** the reusable apparatus exists as mapped — the `eval/` harness (grader `holdout`/`holdout-exercise` KINDS, `run-evals.mjs`, FAFF-320 judgement capture), `faff dod classify`, the `holdout-verdict` contract, and the docker integration harness (`test/holdout-evaluate-integration.test.mjs` + `test/helpers/holdout-exercise.mjs`). *Confirmed at this refresh (all present on main).* *Re-validate before starting:* a smoke `run-evals.mjs --only holdout-001 --reps 1` still produces `.faff/eval-runs/<id>/judgements.jsonl`.
- **Assumes:** code-blindness holds for the corpus by construction. The `evaluator-preflight.js` cage is ship-not-wire (FAFF-276/384), so today's evaluator can see the run cwd. *Validation:* the corpus feeds the judge only spec DoD + env-surface (the `holdout-exercise` fixture already does this — recordings, no diff); assert no `label`/`defect_class`/`expected_aggregate` field is rendered into the judge prompt.

## 8. DONE — Definition of Done

### From WHY
- [ ] The `ErrorRateReport` reports **false-pass rate** distinctly from and weighted ahead of false-fail (cardinal-failure principle).
- [ ] A test renders the judge prompt for a `SeededDefectCase` via the driver's prompt-builder and asserts the rendered string contains none of the case's `label` / `defect_class` / `expected_aggregate` values (teaching-to-the-test discipline — the assertion is over the *rendered prompt*, not merely over the fixture JSON).

### From WHAT (corpus format + scorer)
- [ ] The `SeededDefectCase` format extends `EvalCase` with `label` / `defect_class` / `expected_aggregate`, and validates the constraints: `defective ⇔ defect_class != null`; `clean ⇔ expected_aggregate == meets-spec`.
- [ ] The four defect classes (`missed-criterion`, `subtly-wrong`, `working-but-off-spec`, `spec-satisfying-but-broken-elsewhere`) are the scorer's `by_defect_class` strata, and a scored report's `by_defect_class` map carries all four keys.
- [ ] `eval/score-error-rates.mjs` joins `judgements.jsonl` records to the on-disk `SeededDefectCase` labels by `case_id`, re-derives each judged aggregate via `deriveHoldoutAggregate`, and emits an `ErrorRateReport` with `false_pass`, `false_fail`, `false_pass_rate`, `false_fail_rate`, `false_pass_upper_95`, and `by_defect_class`.
- [ ] `run-evals.mjs` and the `per_kind` regression-gate baseline are unchanged (the scorer is a pure additive read — no new capture field, no aggregate stored in `judgements.jsonl`).

### From HOW (scorer determinism — gated by a synthetic-fixture test)
- [ ] A deterministic unit test drives the scorer over a **synthetic** `judgements.jsonl` with known per-criterion classes and asserts the emitted counts (`false_pass`, `false_fail`, rates) match the values arithmetically implied by those classes — the scorer's correctness is verified independent of any real judge run.
- [ ] A synthetic defective case whose known classes re-derive to `meets-spec` is counted as exactly one `false_pass`; a working-but-off-spec case re-derives to `gaps`/`fails` and is not counted as a false-pass (scored via `deriveHoldoutAggregate`, not asserted by fiat).
- [ ] `false_pass_upper_95` is `3/n_negative` whenever `false_pass == 0` and `null` when `false_pass > 0` (never a fabricated float).
- [ ] The `ErrorRateReport` records its `driver` and, for the offline lane, the FAFF-317 limitation caveat.

### From HOW (offline-proxy pilot — gated on loop-closure, not on the rate)
- [ ] A **small offline-proxy pilot** exists — ≥1 clean plus ≥1 defective (`holdout-exercise`) fixture per stratum. The smoke procedure below runs green over it: the loop `run-evals → judgements.jsonl → score-error-rates → ErrorRateReport` closes, the report's `by_defect_class` has all four keys, and every defective case's polarity is *classified* (its re-derived aggregate is compared to `expected_aggregate`). **The pilot does not gate on the false-pass rate** — a high pilot false-pass count is a valid, reportable outcome (the citable rate is FAFF-625). When run with a mock/fixture driver in CI, the smoke's assertion is over scorer correctness against the mock's *known* aggregate, not over judge behaviour.

### Eval coverage
- [ ] No new grader `KIND` is introduced (the corpus reuses `holdout` / `holdout-exercise`); the seam-registry rows for both kinds remain covered. The scorer is deterministic (a join + arithmetic over captured judgements), so no new eval case is expected.

### Handoff
- [ ] The production-scale run is left to FAFF-625 (offline lower bound) / FAFF-629 (live agentic lane); corpus sizing, results home, and the production timebox are recorded on FAFF-625, not here.

### Integration smoke test
```
PROCEDURE smoke:
  1. Author 1 clean + 1 defective (subtly-wrong) holdout-exercise SeededDefectCase under eval/cases/.
  2. node eval/run-evals.mjs --only <the two> --reps 1 --driver frontier   # or a mock driver in CI
     (mock driver returns a KNOWN aggregate per case — the smoke then asserts SCORER correctness, not
      judge behaviour, so CI is deterministic and never bills the frontier.)
  3. node eval/score-error-rates.mjs .faff/eval-runs/<run-id>/judgements.jsonl
  4. ASSERT n_positive=1, n_negative=1, by_defect_class has the subtly-wrong key, and the defective
     case's re-derived aggregate is compared to expected_aggregate (polarity classified). With the mock
     driver's known aggregate, ASSERT the false_pass count equals the value implied by that aggregate.
```

---

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4) — Now right-sized; the split it called for was executed.** The prior critique flagged that FAFF-563 "has no honest size: it's a 1–3 day scaffolding job *or* a multi-env research programme depending on how the approach fork resolves." That fork is now resolved (human Decision, 2026-07-23) and the ticket split: the fork-independent core (fixture format + deterministic `eval/score-error-rates.mjs` + protocol + small offline pilot) is *this* ticket, timeboxable in days; the production-scale runs are FAFF-625 (offline) and FAFF-629 (live). A ticket whose own timebox can now be named is the tell that the unit is right-sized. No further split indicated.

**Workstream fit? (principles 1 + 5) — Cohesive; the results-home caveat moved to the run ticket.** The remaining scope is a single outcome — *build the seeded-defect measurement scaffolding* — with no mixed-purpose load. The earlier "results home isn't nailed to T5's DoD" caveat is no longer this ticket's concern: the deliverable here is machinery, not a citable number, and the results-home question travels with FAFF-625 where the citable rate is actually produced.

**Deps surfaced? (principle 6) — Now correctly encoded.** The load-bearing FAFF-474 coupling that the prior critique called under-encoded is discharged by the split: this scaffolding ticket carries **no** FAFF-474 blocker (it's fork-independent by construction), and the live run FAFF-629 carries the explicit `blockedBy FAFF-474`. FAFF-625 is `blockedBy` this ticket. The one remaining build-time dependency — `score-error-rates.mjs` reads the FAFF-320 judgement capture — is confirmed present and stable on main at this refresh, so it needs no blocker link.

**Risk profile? (principle 7) — The de-risking the prior critique recommended is now in scope.** The prior critique's recommendation was exactly this: "build the fork-independent scaffolding plus a *small* offline-proxy pilot, and use the pilot's output to answer the approach fork with evidence." The fork is answered and the pilot is now an explicit DoD item. The novel-integration risk (N stood-up docker envs) and the measurement-validity risk (offline proxy can't capture the agentic loop) both sit downstream in FAFF-629, where the live lane is built and labelled — they no longer load this scaffolding slice.

---

confidence: high

_Attached by `/faff-beep-boop` autonomous prep (run-20260723-144253-beepboop-full), refresh path. Provenance + spec-readiness (confidence high, markers valid) verified; spec-review verdict + park status in the companion comment below._
