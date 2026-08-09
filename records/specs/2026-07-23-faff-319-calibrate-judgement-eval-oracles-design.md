# Calibrate the eight new judgement-eval kinds (FAFF-319)

> Spec: faffter-dark-nlspec · 2026-07-23 · interactive · confidence: high. Full spec on Linear FAFF-319.

> Revised 2026-07-23 — spec-review pass 1 absorbed (methodology major + QA minor): the operator sweep becomes its own ticket so the re-baseline follow-up carries an honest `blockedBy` edge; the runbook states the no-resume operating condition explicitly; a mechanical triage-completeness test closes the FAFF-321 partial-triage recurrence path. No design outcome changed.

> Revised 2026-07-23 (build-time discovery, human-sanctioned scope call) — the 0.00-signature root cause is a **driver gap, not the oracles**: all 7 non-holdout kinds fall through to the tidy-default envelope instruction / fixture rendering / criteria in `eval/cli-driver.mjs` (the exact FAFF-317 `holdout` gap, never fixed for the rest), so the model was told to run a tidy pass and emit tidy fields while the grader read `env.architecture`/`env.verdict`/`env.objections`/`env.findings` — empty by construction. The 2026-07-02 sweep measured a mis-instructed harness; its scores are **void as calibration evidence** (the refutation "passes" were vacuous `[]`-vs-`[]` matches on clean cases). This build now ALSO adds the per-kind driver arms (the FAFF-317 pattern; `cli-driver.mjs` was never on the untouchable list); the oracle triage proceeds unchanged, judging each oracle strictly on fixture-vs-oracle terms.

Spec for the build agent and human reviewers. This turns FAFF-319 — "oracles miscalibrated (0.00–0.40 on first frontier baseline); re-baseline after" — into a buildable unit: the per-kind driver arms that make the harness ask the right question, a correct static triage of all 29 cases across the 8 target kinds, oracle fixes applied in the PR, and an operator runbook for the un-nested re-baseline sweep. It supersedes the defective FAFF-321 triage.

## 1. WHY — Problem and Principles

**The load-bearing model (corrected at build time):** a perfectly stable, well-formed answer that scores 0.00 means the *measurement chain* is broken somewhere — and it must be diagnosed from the harness outward before blaming the oracle. For these kinds the break is at the first link: the driver never instructs the model to emit the envelope field the grader reads, so the score was 0.00 regardless of oracle quality. Oracle calibration remains a real, separate axis — several oracles are defective on their own terms (mention-trap `must_avoid` sets, rule-narration demands on artifacts) — but no oracle edit can move a score the driver zeroes out first. Both layers ship here.

**Problem statement.** The 8 judgement-eval kinds (architecture, specqual, holdout, roadmap, adr-gloss, spec-verdict, refutation-spec, refutation-code) pass the coverage lint but contribute nothing to the regression gate: `eval/baselines/frontier.json` has never contained rows for any of them, 7 of the 8 are un-driveable (the fall-through gap; `holdout` was fixed by FAFF-317), and their oracles were guessed by build subagents and never validated. The one prior triage attempt (FAFF-321, Done) is defective: it triaged the alphabetically-first 24 case files instead of the 8 target kinds (5 kinds never triaged), proposed exactly one fix (never applied), and left a stray `triage-results.json` at the repo root. This build fixes the driver arms, does the triage correctly, applies the clear oracle fixes under human review, and hands the operator everything needed to run the re-baseline sweep in a plain terminal.

**Design principles:**

**The build session spawns zero paid model reps.** ADR-0004 and standing operator practice mark the frontier sweep nested-`claude -p`-hostile (quota race, `~/.claude.json` config race). Small `--only <case> --reps 3` probes use the same nested mechanism, so they are excluded too. Everything the build produces comes from static inspection of fixtures, oracles, grader, and driver code. An implementation that shells out to `claude -p` at any point is invalid.

**Every triage judgement must survive the stranger test.** FAFF-321's failure signature was 23 entries carrying the identical note "Requires Opus regen or human judgment". Each entry in the new triage carries a case-specific rationale a reader without this spec could follow. Two entries with interchangeable rationale text mean the triage wasn't done. Rationales judge the oracle against its fixture and grader shape only — never against the void 2026-07-02 scores.

**Oracle edits are human-gated.** Trust-critical oracles need human sign-off (the FAFF-283 discipline). The PR review is the sign-off vehicle: the build proposes and applies edits in the branch; the human approves or amends at review. No oracle edit lands without that review.

**Reference context:**

| System | Relevance |
|---|---|
| `eval/cli-driver.mjs` | The driver gap: `modeInstructionFor` / `renderFixturePrompt` / `criteriaFor` have no arms for the 7 kinds — all three fall through to tidy defaults |
| `eval/cases/*.json` | The 29 in-scope case files (fixtures + oracles) |
| `eval/grader.mjs` | Grader dispatch: `gloss_rubric` coverage (substring synonyms) vs closed-set family (single-verdict, criterion-pairs, lens-set, binary-flagged) |
| `eval/run-evals.mjs` | Sweep driver, `--update-baseline` semantics, FAFF-320 judgements capture, model resolution |
| `eval/baselines/frontier.json` | The regression-gate baseline — currently 14 legacy kinds, meta marked PROVISIONAL |
| `test/eval-cli-driver.test.mjs` | The per-kind `buildEvalPrompt` assertion pattern the new arms extend additively |
| `triage-results.json` (repo root) | The defective FAFF-321 artifact this build supersedes |
| `records/adr/0004-judgement-evals-spike.md` | The nested-sweep prohibition's home |
| `eval/README.md` | Where the operator runbook lands |

**Scope statement.** Calibration work inside the existing eval harness, **plus** the per-kind driver instruction arms in `eval/cli-driver.mjs` that make the harness ask the right question (the FAFF-317 pattern) — no grader logic, no new kinds, no registry schema changes.

## 2. OUT OF SCOPE

- **A "calibrated" seam-registry tier** — real gap, its own design conversation. *Extension point:* `eval/seam-registry.json` status vocabulary + `assertRegistryConsistent` + `faff validate-adapters`. The build files a follow-up ticket naming this.
- **Running the re-baseline sweep** — prohibited in-session. *Extension point:* the operator runbook + the operator-owned sweep ticket (follow-up 1).
- **Fixing skills that genuinely miss** — belongs to the skill's surface. *Extension point:* per-miss follow-up tickets with case id + capture evidence.
- **The 14 legacy kinds' PROVISIONAL numbers** — refreshed incidentally by the operator's wholesale `--update-baseline`; re-examining legacy oracles is not this ticket.
- **holdout-exercise and resolved-elsewhere kinds** — separate kinds; cases and driver arms untouched (both already have correct arms).
- **FAFF-318 sweep resume/checkpointing** — unshipped, deliberately **not** a blocker (the runbook's operating-condition statement). *Extension point:* ship FAFF-318 first if interruption proves chronic.
- **Grader/driver behaviour changes beyond the instruction arms** — `eval/grader.mjs` and `eval/run-evals.mjs` stay byte-untouched; the `cli-driver.mjs` edits are strictly the additive per-kind arms + their tests, never a change to how existing kinds are driven.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| driver arm | The per-kind triple in `cli-driver.mjs`: a `modeInstructionFor` envelope instruction (naming the exact env field the grader reads), a `renderFixturePrompt` framing (the actual task, never "run faff-tidy's judgement pass"), and a `criteriaFor` loader (the surface's own shipped prose) |
| oracle-defect | The oracle rejects answers the fixture itself justifies. Fix the oracle in this PR. |
| needs-evidence | Static inspection cannot decide between oracle-defect and genuine miss; the first real sweep's captures decide it, via a per-case discriminating question. |
| suspected-genuine-miss | The planted defect is unambiguous and the oracle label defensible — a consistent mismatch on a *correctly-driven* sweep would mean the skill misses. |
| discriminating question | Per needs-evidence case: what to look for in `judgements.jsonl`, and which class each answer implies. |
| capture | A `JudgementRecord` line in `.faff/eval-runs/<run-id>/judgements.jsonl` (FAFF-320). |

**The driver arms (build-time addition).** For each of the 7 fall-through kinds, add all three arms following the FAFF-317 `holdout` precedent:

- **Envelope instructions** — each names its grader-read field exactly: `architecture` / `specqual` / `roadmap` / `adr` (adr-gloss) as `{id: text}` maps or arrays of the artifact's key claims/sections; `verdict` (spec-verdict, one of approve/revise/reject-approach/needs-human); `objections` (refutation-spec, `[{lens, severity}]`); `findings` (refutation-code, `[{severity, ...}]`). Same OUTPUT-ONLY hardening as every sibling instruction.
- **Fixture renderings** — each frames its real task (propose an architecture from brief+infra profile; write the lite-nlspec; synthesise the roadmap; author the ADR body; emit the spec-review verdict; run the lens-refuters over the spec; run the adversarial code review over diff+spec_summary).
- **`criteriaFor` arms** — load each surface's own shipped prose (architecture → `faffter-noon-architecture`, specqual → `faffter-noon-spec`, roadmap → `faff-map`, adr-gloss → the `adr` slot's rubric, spec-verdict → `faffter-noon-spec-review`, refutation-spec → `faffter-dark-spec-review`, refutation-code → `faffter-dark-adversarial-review`'s lens), mirroring the existing loaders; where a clean prose slice isn't extractable, fall back to `null` (the improvise control) **explicitly per kind with a comment**, never silently to tidy's criteria.

**Chosen:** fix the driver arms in this PR rather than filing them as a blocker ticket — without them every oracle edit is unmeasurable, the operator sweep burns ~1,580 paid reps re-measuring a mis-instructed harness, and the FAFF-317 precedent makes the change mechanical and additive. Human-sanctioned scope call, 2026-07-23. Each arm gets an additive `buildEvalPrompt(<kind>)` assertion in `test/eval-cli-driver.test.mjs` (envelope names the grader's field; rendering frames the right task; criteria loader resolves).

**The triage artifact** — `eval/calibration/oracle-triage.json`, committed (unchanged from the prior revision): TriageArtifact meta (pinned case-id list, method: prose, supersedes line) + one TriageEntry per case (`case_id, kind, grader_shape, class ∈ {oracle-defect, needs-evidence, suspected-genuine-miss, sound}, rationale, proposed_fix iff oracle-defect, discriminating_question iff needs-evidence`). `sound` is a valid class.

**Chosen:** the artifact lives at `eval/calibration/oracle-triage.json`; the stray root `triage-results.json` is deleted in the same PR.

**The completeness gate** — `test/oracle-triage.test.mjs`: artifact↔cases set equality across the 8 kinds (both directions) + per-class required fields. **Chosen:** mechanical, not review-only — the FAFF-321 recurrence path.

**The runbook** — a new section in `eval/README.md` (six required elements, see HOW).

**The follow-up tickets** — filed by the build:
1. *Run the un-nested re-baseline sweep* — **operator-owned**, not automation-eligible; the runbook is its instructions.
2. *Resolve needs-evidence entries from the sweep's captures* — **`blockedBy` ticket 1**.
3. *Calibrated registry tier* — the covered ≠ calibrated gap.

**Chosen:** the operator sweep is a ticket, not a prose precondition (the honest blocker edge).

**Chosen:** the baseline for the 8 kinds is only ever written by a full-suite, un-nested `--update-baseline` run — never hand-edited, never partial (`--only` wipes the other rows; a hand-added row spuriously fails future gates).

## 4. HOW — Behavior

### Driver arms

Follow `HOLDOUT_MODE_INSTRUCTION` / the `holdout` branches verbatim in shape: one exported instruction constant per kind, one `renderFixturePrompt` branch rendering the fixture's actual fields, one `criteriaFor` line per kind. No change to `buildEvalPrompt`'s structure, no change to any existing kind's path, no grader/run-evals edits. Each envelope instruction states the exact JSON shape with the grader's field name and closed vocabulary where one exists (spec-verdict's four verdicts; refutation severities).

### Triage pass

One entry per case, driven by the grader shape (gloss_rubric → coverage over substring-matched synonym sets; spec-verdict → single verdict; holdout → criterion:class pairs; refutation-spec → above-minor lens set; refutation-code → binary flagged). The build reads the fixture, the oracle, and the relevant grader arm, then asks: *would a competent answer the fixture justifies pass this oracle?* Known mechanics to check per shape: too-narrow `must_include` synonym sets (inflection/plural misses included — matching is literal substring); `must_avoid` legitimate-mention traps (the check trips on ANY occurrence, including mention-to-reject); closed-set expectations defensible from the fixture alone; severity-threshold and neighbouring-lens ambiguity → needs-evidence with a discriminating question.

**Known starting points (verify, don't inherit):** architecture-001's postgres-only sets vs a justified SQLite phrasing (never admit NoSQL — the fixture demands relational); architecture-002's kafka/broker `must_avoid` vs a question that actively primes "no broker needed" rejection language; spec-verdict-001's `["approve"]` vs a possible nitpick magnet; specqual-003's rule-narration demands on an artifact that merely applies the rules; the refutation clean-case oracles (`[]`) where over-flagging is the miss direction.

**Anti-pattern:** editing an oracle for a needs-evidence case — only oracle-defect entries get edits in this PR.

### Oracle edits

Apply exactly each oracle-defect entry's `proposed_fix`; oracle values only, never fixture text unless the entry's rationale explicitly justifies it. After edits: `node --test test/` + `faff validate-adapters` pass; `eval/grader.mjs`, `eval/run-evals.mjs`, `eval/seam-registry.json` byte-untouched (`test/oracle-triage.test.mjs` + the driver-arm tests are additive; `cli-driver.mjs` carries only the new arms).

### Operator runbook (new section in `eval/README.md`)

Six required elements, stated for a reader who has not read this spec: (1) the un-nested prohibition + ADR-0004 reason; (2) the exact full-suite `--update-baseline` command + model resolution (flag > `models.eval` > pinned claude-sonnet-4-6); (3) NEVER `--only` with `--update-baseline` (wholesale-write wipe); (4) derived cost honesty (N cases from the live glob — 79 at spec time — × 20 base reps ≈ 1,580, escalation to 50 → worst ≈ 3,950, multi-hour); (5) the no-resume accepted operating condition (FAFF-318 deliberately not a blocker; interrupted spend partially survives via `judgements.jsonl`); (6) what it leaves behind + capture retention until the resolution ticket closes.

### Edge cases

- **Case inventory drift** — mechanically covered by the completeness test (both-direction set equality).
- **A triaged-sound kind still scores low on the corrected sweep** — the captures adjudicate; the follow-up corrects from evidence.
- **`.faff/eval-runs/` does not exist today** — expected; no sweep has run since FAFF-320 shipped.

### Failure modes

- **The static triage is itself miscalibrated** — the sweep's captures bound the guessing loop at one more iteration.
- **The operator never runs the sweep** — visible: the sweep ticket sits open, follow-up 2 blocked on it; coverage stays at today's zero, no regression.
- **A driver arm mis-names its field** — the additive `buildEvalPrompt` tests assert each instruction contains the grader's exact field name; a wrong name fails the test, not the sweep.

## Scenarios

```
Given the 29 case files across the 8 in-scope kinds on the build branch
When eval/calibration/oracle-triage.json is generated
Then it contains exactly one entry per in-scope case, every entry has one of
     the four classes, every oracle-defect entry has a proposed_fix matching an
     applied case-file edit, and every needs-evidence entry has a
     discriminating question naming both possible resolutions
```

```holdout
Given any two entries in the committed triage artifact
When their rationale fields are compared
Then neither is a generic deferral ("requires regen / human judgment") and the
     two texts are not interchangeable — each cites its own case's fixture or
     oracle content
```

```
Given the seven new driver arms
When node --test test/eval-cli-driver.test.mjs runs
Then each kind's buildEvalPrompt output contains its grader-read envelope
     field name (architecture/specqual/roadmap/adr/verdict/objections/findings)
     and frames the kind's real task — and no existing kind's prompt changed
```

```
Given the triage artifact and the live eval/cases/ tree
When node --test test/oracle-triage.test.mjs runs
Then it passes iff the artifact's case-id set exactly equals the glob of the
     8 kinds' case files (both directions) and every entry carries its
     per-class required fields
```

```
Given the merged PR
When the repo root is listed
Then triage-results.json is gone, and eval/calibration/oracle-triage.json's
     meta names it as superseded
```

- The runbook section MUST contain all six required elements.
- The build session MUST spawn zero `claude -p` processes.
- Follow-up tickets MUST exist for the operator sweep (not automation-eligible), the capture-driven resolution (`blockedBy` the sweep ticket), and the calibrated registry tier.

## 6. Design Decision Rationale

**Fix the driver arms here, or file a blocker ticket?** Without the arms, oracle calibration is unmeasurable and the paid sweep re-measures a mis-instructed harness; with them, one PR makes the sweep meaningful. The FAFF-317 precedent makes the change mechanical. **Chosen:** fix here (human-sanctioned scope call, 2026-07-23); grader/run-evals stay untouched, arms are additive.

**Should the build run any nested reps?** **Chosen:** fully static — needs-evidence + discriminating questions make "undecided until the sweep" a first-class outcome. (Unchanged.)

**Where does the corrected triage live?** **Chosen:** `eval/calibration/oracle-triage.json`; root stray deleted. (Unchanged.)

**When are oracle fixes applied?** **Chosen:** in-PR, review as the FAFF-283 sign-off. (Unchanged.)

**How is refutation label-mismatch vs genuine-miss decided?** **Chosen:** discriminating questions resolved from the first *correctly-driven* sweep's captures — the void 2026-07-02 scores never count as evidence. (Sharpened.)

**How do the 8 kinds enter the baseline?** **Chosen:** operator's full-suite un-nested `--update-baseline` only. (Unchanged.)

**Genuine misses?** **Chosen:** per-miss follow-up tickets. (Unchanged.)

**Calibrated registry tier?** **Chosen:** follow-up ticket. (Unchanged.)

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

**Assumes:** the tracker's 0.00–0.40 figures were produced by the fall-through driver (the arithmetic fits: gloss kinds 0.00 stable; refutation "passes" = vacuous clean-case `[]` matches; spec-verdict 0.11/0.76 = occasional improvised `verdict` field). *Validation:* satisfied statically — the fall-through is verified in `cli-driver.mjs` on main; the design holds even if some additional oracle-level cause coexists (the triage judges oracles independently).

**Assumes:** the operator has a working `claude` CLI in a plain terminal. *Validation:* runbook step 2.

**Assumes:** FAFF-320 capture works as shipped. *Validation:* `node --test test/eval-judgement-capture.test.mjs` passes on the branch **before** the capture-dependent follow-up is filed.

## 8. DONE — Definition of Done

### From WHY
- [ ] No `claude -p` invocation appears anywhere in the build session (probes included).

### From WHAT (driver arms)
- [ ] Each of the 7 fall-through kinds has all three arms (envelope instruction naming the grader's exact field, task-true fixture rendering, criteria loader or explicit per-kind null-with-comment).
- [ ] Additive `buildEvalPrompt(<kind>)` assertions in `test/eval-cli-driver.test.mjs` pass for all 7; no existing kind's prompt output changed.

### From WHAT (artifacts)
- [ ] `eval/calibration/oracle-triage.json` exists and matches the TriageArtifact record.
- [ ] `test/oracle-triage.test.mjs` exists and passes (both-direction set equality + per-class fields).
- [ ] Root `triage-results.json` is deleted; the new artifact's meta names it as superseded.
- [ ] Follow-up tickets filed: operator sweep (not automation-eligible), capture-driven resolution (`blockedBy` the sweep ticket), calibrated registry tier.
- [ ] `test/eval-judgement-capture.test.mjs` confirmed passing before the capture-dependent follow-up was filed.

### From HOW (triage)
- [ ] Every entry's rationale is case-specific — no generic deferrals, no interchangeable text; no rationale cites the void 2026-07-02 scores as evidence.
- [ ] All five previously-untriaged kinds have entries for every case.
- [ ] Every refutation entry resolves to one of the four classes with written reasoning; every needs-evidence entry's discriminating question names both resolutions.

### From HOW (oracle edits)
- [ ] Every oracle-defect entry's proposed_fix is applied; no edits to any other case.
- [ ] `architecture-001`'s fix does not admit NoSQL.
- [ ] `node --test test/` and `faff validate-adapters` pass; `eval/grader.mjs`, `eval/run-evals.mjs`, `eval/seam-registry.json` byte-untouched.

### From HOW (runbook)
- [ ] `eval/README.md` gains the runbook section with all six required elements.
- [ ] `eval/baselines/frontier.json` is untouched by this PR.

**Integration smoke test:**

```
1. Pick one oracle-defect case whose fix widened a must_include synonym set;
   grade a synthetic envelope phrased with a newly-accepted synonym → passes;
   grade a garbage envelope → still fails (loosened, not slack).
2. buildEvalPrompt("refutation-spec", …) output contains "objections" and the
   lens vocabulary; buildEvalPrompt("architecture", …) contains "architecture".
3. node --test test/oracle-triage.test.mjs → passes (completeness gate).
4. node --test test/eval-cli-driver.test.mjs → passes (arms + no regression).
```

confidence: high
spec-review: approve

## Methodology critique

**Methodology:** faffter-dark-methodology-agile-delivery

**Right-sized?** No issues (as revised): the driver arms are seven mechanical, precedented additions that share every test/review surface with the triage work — splitting them out would gate this PR on a two-line-per-kind sibling. Still one coherent increment.

**Workstream fit?** No issues — all of it converges on "an eval harness whose verdicts can be trusted" (the Skill-behaviour harness project's outcome).

**Deps surfaced?** Two findings — *[both absorbed by the first 2026-07-23 revision: the operator sweep is follow-up ticket 1 (operator-owned, not automation-eligible) with the capture-resolution follow-up `blockedBy` it; the runbook's operating-condition statement makes the FAFF-318 non-link an explicit decision.]*

**Risk profile?** The fully-static build removes the execution risk class; the completeness test closes the FAFF-321 recurrence path; the FAFF-320 capture check is a pre-filing validation. *[Second-revision addition:]* the driver-arm risk (a mis-named envelope field silently zeroing a kind again) is closed mechanically by the per-kind `buildEvalPrompt` assertions naming the grader's exact fields.
