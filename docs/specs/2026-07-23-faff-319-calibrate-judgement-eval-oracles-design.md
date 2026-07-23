# Calibrate the eight new judgement-eval kinds (FAFF-319)

> Spec: faffter-dark-nlspec · 2026-07-23 · interactive · confidence: high. Full spec on Linear FAFF-319.

> Revised 2026-07-23 — spec-review pass 1 absorbed (methodology major + QA minor): the operator sweep becomes its own ticket so the re-baseline follow-up carries an honest `blockedBy` edge; the runbook states the no-resume operating condition explicitly; a mechanical triage-completeness test closes the FAFF-321 partial-triage recurrence path. No design outcome changed.

Spec for the build agent and human reviewers. This turns FAFF-319 — "oracles miscalibrated (0.00–0.40 on first frontier baseline); re-baseline after" — into a buildable unit: a correct static triage of all 29 cases across the 8 target kinds, oracle fixes applied in the PR, and an operator runbook for the un-nested re-baseline sweep. It supersedes the defective FAFF-321 triage.

## 1. WHY — Problem and Principles

**The load-bearing model:** when a frontier model gives well-formed answers (fmt 1.00) that are perfectly consistent across reps (stability 1.00) yet score 0.00–0.40 against the oracle, the oracle is wrong, not the model. The fixture oracles for the 8 kinds shipped 2026-07-02 were guessed by build subagents and never checked against real model output. Calibration therefore means fixing oracles to accept valid variation — and, where a mismatch might instead be a genuine skill miss (the refutation kinds), deciding which it is from evidence, not another guess.

**Problem statement.** The 8 judgement-eval kinds (architecture, specqual, holdout, roadmap, adr-gloss, spec-verdict, refutation-spec, refutation-code) pass the coverage lint but their oracles are untrustworthy, so they contribute nothing to the regression gate — `eval/baselines/frontier.json` has never contained rows for any of them. The one prior attempt at triage (FAFF-321, Done) is defective: it triaged the alphabetically-first 24 case files instead of the 8 target kinds (only 6 of its 24 entries are in scope; specqual, roadmap, spec-verdict, refutation-spec, refutation-code were never triaged at all), proposed exactly one fix (never applied), and left a stray `triage-results.json` at the repo root. This build does the triage correctly, applies the clear oracle fixes under human review, and hands the operator everything needed to run the re-baseline sweep in a plain terminal.

**Design principles:**

**The build session spawns zero paid model reps.** ADR-0004 and standing operator practice mark the frontier sweep nested-`claude -p`-hostile (quota race, `~/.claude.json` config race). Small `--only <case> --reps 3` probes use the same nested mechanism, so they are excluded too. Everything the build produces comes from static inspection of fixtures, oracles, and grader code — which is exactly the work a triage needs, since the question "is this oracle defensible on the fixture's own terms?" is answerable by reading. An implementation that shells out to `claude -p` at any point is invalid.

**Every triage judgement must survive the stranger test.** FAFF-321's failure signature was 23 entries carrying the identical note "Requires Opus regen or human judgment". Each entry in the new triage carries a case-specific rationale a reader without this spec could follow. Two entries with interchangeable rationale text mean the triage wasn't done.

**Oracle edits are human-gated.** Trust-critical oracles need human sign-off (the FAFF-283 discipline). The PR review is the sign-off vehicle: the build proposes and applies edits in the branch; the human approves or amends at review. No oracle edit lands without that review.

**Reference context:**

| System | Relevance |
|---|---|
| `eval/cases/*.json` | The 29 in-scope case files (fixtures + oracles) |
| `eval/grader.mjs` | Grader dispatch: `gloss_rubric` coverage vs closed-set family; `labelMatchesEntry` synonym tolerance |
| `eval/run-evals.mjs` | Sweep driver, `--update-baseline` semantics, FAFF-320 judgements capture, model resolution |
| `eval/baselines/frontier.json` | The regression-gate baseline — currently 14 legacy kinds, meta marked PROVISIONAL |
| `eval/seam-registry.json` | Kind → surface registry; status vocabulary is exactly {covered, designed} |
| `triage-results.json` (repo root) | The defective FAFF-321 artifact this build supersedes |
| `docs/adr/0004-judgement-evals-spike.md` | The nested-sweep prohibition's home |
| `eval/README.md` | Where the operator runbook lands |

**Scope statement.** This is calibration work inside the existing eval harness — no grader logic, no new kinds, no registry schema changes.

## 2. OUT OF SCOPE

- **A "calibrated" seam-registry tier** — the ticket's deeper finding (covered ≠ calibrated) is real: nothing distinguishes "has cases" from "oracles trustworthy". Excluded because it changes the registry schema and the `validate-adapters` contract, its own design conversation. *Extension point:* `eval/seam-registry.json` status vocabulary + the reconciliation checks in `eval/grader.mjs` (`assertRegistryConsistent`) and `faff validate-adapters`. The build files a follow-up ticket naming this.
- **Running the re-baseline sweep** — prohibited in-session (see principles). *Extension point:* the operator runbook in `eval/README.md` + the operator-owned sweep ticket the build files (follow-up 1).
- **Fixing skills that genuinely miss** — where triage or later evidence shows a refuter truly failing to catch a planted defect, the fix belongs to that skill's surface, not the eval suite. *Extension point:* follow-up tickets filed per confirmed miss, referencing the case id and capture evidence.
- **The 14 legacy kinds' PROVISIONAL numbers** — the operator's full-suite `--update-baseline` run refreshes them incidentally (the write is wholesale), which is welcome, but re-examining legacy oracles is not this ticket.
- **holdout-exercise and resolved-elsewhere kinds** — separate kinds outside the ticket's 8; their cases are untouched.
- **FAFF-318 sweep resume/checkpointing** — unshipped, and deliberately **not** a blocker of the operator sweep: a no-resume single-pass run is the accepted operating condition (see the runbook's operating-condition statement). *Extension point:* ship FAFF-318 first if interruption proves chronic.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| oracle-defect | The oracle rejects answers the fixture itself justifies (wrong expected verdict, too-narrow synonym sets, a `must_avoid` term that trips on legitimate mentions). Fix the oracle. Corresponds to FAFF-321's class (a). |
| needs-evidence | Static inspection cannot decide between oracle-defect and genuine miss; the first real sweep's captures decide it. Corresponds to class (b), but each entry must now carry a discriminating question, not a deferral note. |
| suspected-genuine-miss | The fixture's planted defect is unambiguous and the oracle label is defensible — a consistent model mismatch would mean the *skill* misses. Keep the oracle; the follow-up confirms from captures. Corresponds to class (c). |
| discriminating question | Per needs-evidence case: what to look for in `judgements.jsonl`, and which triage class each possible answer implies. |
| capture | A `JudgementRecord` line in `.faff/eval-runs/<run-id>/judgements.jsonl` (FAFF-320) — raw model text + graded result per rep, written by every sweep. Gitignored, advisory-only. |

**The triage artifact** — `eval/calibration/oracle-triage.json`, committed:

```
RECORD TriageArtifact:
  meta:
    generated_at: Date
    ticket: "FAFF-319"
    scope: { kinds: [the 8], case_ids: [all 29] }   # exact list at generation time
    method: prose                                    # in-session static inspection; no captures existed
    supersedes: "FAFF-321 triage-results.json (repo root, deleted in this PR)"
  entries: List<TriageEntry>                         # exactly one per in-scope case

RECORD TriageEntry:
  case_id, kind
  grader_shape: "gloss_rubric" | "closed_set" | "lens-set" | "binary-flagged" | "criterion-pairs"
  class: "oracle-defect" | "needs-evidence" | "suspected-genuine-miss" | "sound"
  rationale: Text            # case-specific; stranger test applies
  proposed_fix: EditSummary  # REQUIRED iff class = oracle-defect: the exact oracle change made in this PR
  discriminating_question: Text  # REQUIRED iff class = needs-evidence
```

`sound` is a valid class — an oracle the inspection endorses as-is. Forcing every case into a defect class would repeat FAFF-321's guessing in the other direction.

**Chosen:** the artifact lives at `eval/calibration/oracle-triage.json` (a new committed directory — `.faff/` is gitignored so unsuitable), and the stray root `triage-results.json` is deleted in the same PR. One living artifact, superseded in place by any future calibration pass.

**The completeness gate** — a committed test `test/oracle-triage.test.mjs` asserting: (a) the artifact's entry case-id set equals the live glob of `eval/cases/<kind>-*.json` across the 8 in-scope kinds — set equality in **both** directions, so a partial triage *or* a stale artifact fails loud; (b) every entry carries its per-class required fields (`proposed_fix` iff oracle-defect, `discriminating_question` iff needs-evidence). **Chosen:** a mechanical gate rather than review-only enforcement — human review is exactly the vector by which FAFF-321's alphabetical-24 partial triage passed silently; the same test mechanises the inventory-drift edge case (a case added to the 8 kinds later turns the artifact loudly stale until re-triaged). Additive test file only — no grader/driver/registry changes.

**The runbook** — a new section in `eval/README.md` (see HOW for required content).

**The follow-up tickets** — filed by the build, in this repo's tracker:
1. *Run the un-nested re-baseline sweep* — **operator-owned**: a human runs the runbook in a plain terminal and commits the resulting baseline. Deliberately **not** automation-eligible (no eligibility labels — the same discipline that keeps this ticket human-driven); the runbook section this spec writes is that ticket's instructions.
2. *Resolve needs-evidence entries from the sweep's captures* — **`blockedBy` ticket 1** (an honest graph edge, not prose): a build session reads `.faff/eval-runs/<run-id>/judgements.jsonl`, resolves every needs-evidence entry via its discriminating question, applies second-round oracle fixes, commits the operator's `--update-baseline` output if not already landed, and files per-miss skill tickets for confirmed genuine misses.
3. *Calibrated registry tier* — the covered ≠ calibrated gap, pointing at the extension points above.

**Chosen:** the operator sweep is a **ticket, not a prose precondition** — a follow-up "blocked on a human action" with no tracker representation would sit in Backlog reading as ready indefinitely (the chain-gap class the methodology critique flagged); the explicit `blockedBy` edge keeps the blocker graph honest for every downstream routing read.

**Chosen:** the baseline for the 8 kinds is only ever written by a full-suite, un-nested `--update-baseline` run — never hand-edited, never partially added. Two mechanics force this: `--update-baseline` writes `per_kind` wholesale from the run (combining it with `--only` would wipe the 14 legacy rows), and once the baseline gains the 8 kinds, `--against` fails any run missing a baselined kind — a hand-added row with a wrong value would fail every future gate run spuriously. The interim state (kinds present in runs, absent from baseline) is the status quo and already handled: `--against` reports un-baselined kinds as informational, not failures.

## 4. HOW — Behavior

### Triage pass

One entry per case, driven by the grader shape. The build reads the fixture, the oracle, and the relevant grader arm, then asks: *would a competent answer the fixture justifies pass this oracle?*

```
PROCEDURE triage_case(case):
  1. Identify grader shape from eval/grader.mjs dispatch:
     gloss_rubric  → architecture, specqual, roadmap, adr-gloss
     closed_set    → spec-verdict, holdout (criterion pairs),
                     refutation-spec (lens set), refutation-code (binary flagged)
  2. FOR gloss_rubric cases:
     a. For each must_include synonym set: enumerate answers the fixture text
        justifies; if a justified answer contains none of the synonyms → too
        narrow → oracle-defect; proposed_fix widens the set (labelMatchesEntry
        tolerance means widening = adding synonyms, never new grade math).
     b. For each must_avoid set: check for legitimate-mention traps — the check
        trips on ANY occurrence, so an answer saying "no microservices needed"
        fails a ["microservice"] avoid set. Any avoid term a good answer would
        plausibly mention while rejecting → oracle-defect.
  3. FOR closed-set-family cases:
     a. Is the expected verdict/label/lens-set defensible from the fixture alone?
        No  → oracle-defect; proposed_fix corrects the expected value.
        Yes, and the planted defect (or clean bill) is unambiguous
            → suspected-genuine-miss (or sound).
        Yes, but a competent answer could land on a different-but-valid value
        (e.g. a real objection attributed to a neighbouring lens, or raised at
        minor severity so the ABOVE_MINOR filter drops it)
            → needs-evidence, with the discriminating question spelling out:
              "if captures show X → oracle fix to X; if captures show the model
              approving/missing → genuine miss, file skill ticket".
  4. Write the entry with case-specific rationale.
```

**Known starting points (verify, don't inherit):**
- `architecture-001` — the fixture brief demands relational data, durability, and transactional integrity, and the infra profile states docker-compose; the current must_include sets (`["postgres","relational","rdbms"]`, `["docker","container","compose"]`, `["durable","persist","survive restart"]`) look defensible in *theme* but the reported 0-score suggests a justified answer (e.g. sqlite-based, phrased without the exact synonyms) slips all three. **Anti-pattern:** copying FAFF-321's proposed `[SQL|NoSQL]` relaxation. Why: the brief says the data *is relational* — accepting NoSQL contradicts the fixture. Re-derive the widening from the brief.
- `spec-verdict-001` — oracle `["approve"]` against a deliberately clean spec; the model reliably returns another verdict. Decide from the fixture whether the spec truly gives no lens an objection (then the oracle is sound and this is needs-evidence or a miss) or contains a nitpick magnet a reasonable reviewer flags as `revise` (then either de-magnetise the fixture or correct the oracle — an oracle-defect either way).
- `refutation-spec` at 0.33 / `refutation-code` at 0.40 — the ticket's load-bearing question. The lens-set and severity-threshold mechanics above give the two plausible non-miss explanations; every refutation entry lands in sound / oracle-defect / needs-evidence / suspected-genuine-miss with the reasoning written down. Note some refutation-spec cases may have empty-set (should-approve) oracles — a mismatch there is over-flagging, and the discriminating question runs in the opposite direction.

**Anti-pattern:** editing an oracle for a needs-evidence case. Why: that's a second guess — the entire failure mode this ticket exists to end. Only oracle-defect entries get edits in this PR.

### Oracle edits

For each oracle-defect entry: apply exactly the `proposed_fix` to the case file. Edits touch oracle values only — `must_include`/`must_avoid` synonym sets, expected closed-set values — never fixture text unless the entry's rationale explicitly justifies a fixture change (the spec-verdict-001 de-magnetise option). After edits, the full test suite (`node --test test/`, including `test/eval-grader.test.mjs` and `eval-coverage-gate`) and `faff validate-adapters` must pass — no grader, driver, registry, or lint modifications are in scope (the new `test/oracle-triage.test.mjs` is additive).

### Operator runbook (new section in `eval/README.md`)

Required content, stated for a reader who has not read this spec:

```
1. Prohibition + why: run in a plain terminal, never inside a Claude session
   (ADR-0004 — quota race + ~/.claude.json config race).
2. The command:
     node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json
   Model resolution: --model flag > `faff config get models.eval` > pinned
   claude-sonnet-4-6. Never the account default.
3. NEVER add --only to the --update-baseline invocation — the baseline is
   written wholesale from the run; a filtered run erases every other kind's row.
4. Cost honesty: N cases (derive N from `ls eval/cases/*.json | wc -l` when
   writing the section — 79 at spec time) × 20 base reps ≈ 1,580 paid
   claude -p calls, with adaptive escalation to 50 reps on disagreement
   (worst case ≈ 3,950). Multi-hour.
5. Accepted operating condition — no resume: FAFF-318 (sweep checkpointing) is
   unshipped and deliberately NOT a blocker of this run. An interrupted run
   loses the aggregate baseline write and must restart from scratch — but every
   completed rep's capture survives in judgements.jsonl, so interrupted spend
   is not a total loss. If interruption proves chronic, ship FAFF-318 before
   retrying rather than repeatedly eating restarts.
6. What it leaves behind: the updated baseline (commit it) and
   .faff/eval-runs/<run-id>/judgements.jsonl — the per-rep capture the
   follow-up ticket reads to resolve the needs-evidence triage entries.
   Don't delete the run directory until that ticket closes.
```

### Edge cases

- **Case inventory drifts before the operator runs** — mechanically covered: the completeness test diffs the artifact's case-id set against the live glob, so a case added to the 8 kinds turns CI loudly stale until the addition is triaged. The capture-resolution follow-up's first step remains re-checking the list.
- **A triaged-sound kind still scores low on the real sweep** — handled by design: the sweep's captures are inspectable, so the follow-up adjudicates from evidence instead of re-guessing.
- **`.faff/eval-runs/` does not exist today** — correct and expected: no sweep has run since FAFF-320 shipped, so there are no captures for this build to read. The build is static by necessity as well as by principle.

### Failure modes

- **The static triage is itself miscalibrated** — a second guessed oracle, dressed up. *How you'd know:* the operator sweep still scores well below stability on kinds whose oracles this PR "fixed". *What it means:* proceed anyway — unlike 2026-07-02, every rep is now captured, so the follow-up corrects from raw model text; the guessing loop is bounded at one more iteration.
- **The operator never runs the sweep** — *how you'd know:* the operator sweep ticket sits open and follow-up 2 shows blocked on it — visible on every wtf/map read, which is exactly what the explicit ticket + blocker edge buys over the prior prose precondition. *What it means:* gate coverage for the 8 kinds stays at today's zero (no regression from status quo); a stale operator ticket is tidy's to surface, never a reason to weaken the nested-sweep prohibition.
- **The 0.00–0.40 figures were misremembered** (the MISCALIBRATED snapshot is absent from git and disk; the numbers exist only in tracker prose). *How you'd know:* the first real sweep disagrees with the tracker's picture. *What it means:* nothing changes — the triage judges each oracle on the fixture's own terms and never leans on the exact historical scores.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the 29 case files across the 8 in-scope kinds on the build branch
When eval/calibration/oracle-triage.json is generated
Then it contains exactly one entry per in-scope case, every entry has one of
     the four classes, every oracle-defect entry has a proposed_fix matching an
     applied case-file edit, and every needs-evidence entry has a
     discriminating question naming both possible resolutions
```

```
Given the triage artifact and the live eval/cases/ tree
When node --test test/oracle-triage.test.mjs runs
Then it passes iff the artifact's case-id set exactly equals the glob of the
     8 kinds' case files (both directions) and every entry carries its
     per-class required fields — a partial triage or a stale artifact fails
```

```
Given the oracle edits applied for every oracle-defect entry
When `node --test test/` and `faff validate-adapters` run on the branch
Then both pass with no changes to eval/grader.mjs, eval/run-evals.mjs, or
     eval/seam-registry.json in the diff (test/oracle-triage.test.mjs is additive)
```

```
Given the merged PR
When the repo root is listed
Then triage-results.json is gone, and eval/calibration/oracle-triage.json's
     meta names it as superseded
```

- The runbook section in `eval/README.md` MUST contain all six required elements: the un-nested prohibition with the ADR-0004 reason, the exact full-suite `--update-baseline` command + model resolution, the never-`--only` warning with its wipe rationale, the derived rep-count/cost estimate, the explicit no-resume operating-condition statement (FAFF-318 deliberately not a blocker), and the `judgements.jsonl` retention instruction.
- The build session MUST spawn zero `claude -p` processes (no probes, no partial sweeps).
- Follow-up tickets MUST exist for (1) the operator-owned un-nested sweep (not automation-eligible), (2) the capture-driven needs-evidence resolution — `blockedBy` ticket 1, the edge visible in the tracker — and (3) the calibrated registry tier, each pointing at its extension point.

## 6. Design Decision Rationale

**Should the build run any nested reps (the ticket's own step-1 suggested `--only <case> --reps 3` probes)?**
Options: small probes for evidence on ambiguous cases (pro: real data; con: same nested-hostile mechanism as the full sweep, and 3 reps of a 20-rep-stability question is weak evidence) vs fully static (pro: zero quota/config risk, triage questions are answerable by reading; con: some cases stay undecided until the operator runs).
**Chosen:** fully static — the needs-evidence class plus discriminating questions makes "undecided until the sweep" a first-class, evidence-preserving outcome instead of a gap.

**Where does the corrected triage live, and what happens to the FAFF-321 stray?**
Options: leave the root file and add a new one (con: two conflicting artifacts); overwrite in place at the root (con: repo-root strays are the defect being fixed); committed home under eval/.
**Chosen:** `eval/calibration/oracle-triage.json`, root stray deleted in the same PR — one artifact, in the tree that owns it, superseded in place by future passes.

**When are oracle fixes applied?**
Options: propose-only (defer all edits to the human) vs apply-in-PR with review as sign-off.
**Chosen:** apply oracle-defect fixes in the PR — the human sign-off the FAFF-283 discipline requires is exactly what PR review is; propose-only would repeat FAFF-321's applied-nothing outcome.

**How is the refutation label-mismatch vs genuine-miss question decided?**
Options: decide statically now (con: guessing, again); rerun cases in-session (con: nested); encode a per-case discriminating question and decide from the first sweep's FAFF-320 captures.
**Chosen:** the discriminating-question mechanism — static inspection settles what *can* be settled (defensible labels, unambiguous planted defects), and everything else gets an explicit evidence test instead of a guess.

**How do the 8 kinds enter the baseline, given the gate fails runs missing a baselined kind?**
Options: hand-add rows now (con: uncalibrated values fail every future gate run spuriously); partial sweep per kind (con: `--update-baseline --only` wipes the other rows); full-suite un-nested `--update-baseline` only.
**Chosen:** full-suite `--update-baseline` by the operator, committed via the sweep + resolution follow-ups — the only mechanically safe path, and it retires the legacy PROVISIONAL numbers for free. Until then the 8 kinds stay un-baselined, which `--against` already treats as informational.

**What happens to confirmed genuine misses?**
Options: fix the skill in this ticket (con: unbounded scope, different surface) vs file per-miss follow-up tickets.
**Chosen:** file follow-up tickets referencing case id + capture evidence — eval calibration and skill repair are different units of work.

**Does this ticket add the "calibrated" registry tier?**
Options: in-scope (pro: the finding is real; con: registry schema + lint contract changes, a design of its own) vs follow-up.
**Chosen:** follow-up ticket, with the extension points named in OUT OF SCOPE — this keeps FAFF-319 a 1–3 day unit; no split of the ticket itself is needed.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

**Assumes:** the 0.00–0.40 accuracy / 1.00 stability figures quoted in the tracker are directionally right; the snapshot file backing them is absent from git history and disk. *Validation:* none needed before building — the design nowhere depends on the exact numbers (see Failure modes); the first real sweep re-establishes ground truth.

**Assumes:** the operator has a working `claude` CLI and model access in a plain terminal (model resolved via `faff config get models.eval` or the pinned claude-sonnet-4-6 fallback). *Validation:* runbook step 2 makes the resolution order explicit; nothing in the build itself depends on it.

**Assumes:** FAFF-320 capture works as shipped — every sweep rep appends a JudgementRecord to `.faff/eval-runs/<run-id>/judgements.jsonl`. *Validation:* **before filing the capture-dependent follow-up**, confirm `node --test test/eval-judgement-capture.test.mjs` passes on the branch (the static check the no-rep constraint allows); a broken capture path discovered after the operator's paid sweep is the worst-time surprise this validation exists to prevent.

## 8. DONE — Definition of Done

### From WHY
- [ ] No `claude -p` invocation appears anywhere in the build session (probes included).

### From WHAT (artifacts)
- [ ] `eval/calibration/oracle-triage.json` exists, matches the TriageArtifact record (meta with pinned case-id list, one entry per in-scope case, per-class required fields present).
- [ ] `test/oracle-triage.test.mjs` exists and passes: artifact↔cases set equality across the 8 kinds (both directions) + per-class required-field checks.
- [ ] Root `triage-results.json` is deleted; the new artifact's meta names it as superseded.
- [ ] Follow-up tickets filed: the operator-owned un-nested sweep (not automation-eligible), the capture-driven resolution (`blockedBy` the sweep ticket — the edge visible in the tracker), and the calibrated registry tier.
- [ ] `test/eval-judgement-capture.test.mjs` confirmed passing on the branch before the capture-dependent follow-up was filed.

### From HOW (triage)
- [ ] Every entry's rationale is case-specific — no generic deferral notes, no interchangeable text.
- [ ] All five previously-untriaged kinds (specqual, roadmap, spec-verdict, refutation-spec, refutation-code) have entries for every case.
- [ ] Every refutation-spec and refutation-code entry resolves to sound / oracle-defect / needs-evidence / suspected-genuine-miss with written reasoning; every needs-evidence entry's discriminating question names both resolutions.

### From HOW (oracle edits)
- [ ] Every oracle-defect entry's proposed_fix is applied to its case file; no edits to any other case.
- [ ] `architecture-001`'s fix does not admit NoSQL (the fixture requires relational data).
- [ ] `node --test test/` and `faff validate-adapters` pass; the diff contains no changes to `eval/grader.mjs`, `eval/run-evals.mjs`, or `eval/seam-registry.json` (`test/oracle-triage.test.mjs` is additive).

### From HOW (runbook)
- [ ] `eval/README.md` gains the runbook section with all six required elements (prohibition + reason, exact command + model resolution, never-`--only` warning, derived cost estimate, no-resume operating-condition statement, capture retention).
- [ ] `eval/baselines/frontier.json` is untouched by this PR.

**Integration smoke test:**

```
1. Pick one oracle-defect case whose fix widened a must_include synonym set.
2. Construct a synthetic envelope phrased with a newly-accepted synonym
   (the "valid alternative" answer the old oracle rejected).
3. Grade it via the exported grader path → coverage counts the widened check
   as passing.
4. Grade a garbage envelope against the same case → still fails.
5. Run node --test test/oracle-triage.test.mjs → passes (completeness gate).
   If all hold, the calibration loosened without going slack, the triage is
   mechanically complete, and the grader plumbing is untouched.
```

confidence: high
spec-review: approve
