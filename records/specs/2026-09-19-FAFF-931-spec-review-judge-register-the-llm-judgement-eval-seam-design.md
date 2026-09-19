# Spec: Register the spec-review judge's weighing as a first-class LLM-judgement eval seam (FAFF-931)

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-931.

This is the buildable spec for FAFF-931, addressed to the coding agent who will register the seam and to the human reviewers who gate it. It completes the item FAFF-922 (the judge scaffold, PR #780) deliberately deferred: now that FAFF-930 has landed a runnable, terminal spec-review adjudicator, this registers that adjudicator's ruling as a graded eval seam so `faff validate-adapters` stops being blind to it. It writes no new judge behaviour and records no baseline number: it wires the seam that already has a committed case-pair waiting for it, and it makes the folded fail-open fix born-verifiable with a runnable test.

## Refresh log

- **Revision 2026-09-19 (round-1 revise fold):** Reverted the shared-module extraction from the 2026-09-17 revision. It edited `plugin/skills/faff/bin/lib/contract-defs.js`, which section 2 reserves to FAFF-930 as out of scope, and minted a new top-level `shared/` directory, a large structural change to cure what the prior review rated only a minor cross-layer coupling. `SPEC_JUDGE_OUTCOMES` now stays where it already lives (`contract-defs.js:494`, untouched), and `eval/grader.mjs` imports it directly from `contract-defs.js` (an ESM named import of a CommonJS named export, resolved by Node via static analysis); the cross-layer coupling is accepted as a documented minor, re-pointed with a one-line fix if `contract-defs.js` later moves. Also added a runtime value-equality assertion to the born-verifiable test: it imports `SPEC_JUDGE_OUTCOMES` the way the grader does and asserts it deep-equals the four-outcome set, a stronger single-source guarantee than the import-text scan alone. Confidence unchanged (high).
- **Revision 2026-09-17 (spec-review fold):** Folded the four foldable objections from the 2026-09-14 spec-review (reject-approach, zero criticals), all born-verifiability and test-quality fixes with the approach unchanged. Objection 1 (architectural, major): the born-verifiable test drove `grade()` with hardcoded oracle literals, so an oracle-shape edit to the committed `oracles.json` could not turn it red; the test now reads each case's `oracle` object from the committed file and passes that bound object to `grade()`, and adds an explicit corpus-to-branch binding assertion on the read oracle shapes. Objection 2 (architectural, minor): `eval/grader.mjs` importing `SPEC_JUDGE_OUTCOMES` straight from the plugin-internal `contract-defs.js` coupled the harness to the plugin's file layout; that revision extracted the four-outcome set to a shared repo-root module, since reverted (see the 2026-09-19 entry above). Objection 3 (QA, major): smoke step 1 used a dynamic `import().then()` that swallowed a load-time throw and exited 0; it is replaced with a top-level-await form so a rejected import exits non-zero, and `test/seam-registry.test.mjs` (smoke step 3) is now credited as the check that enforces the KINDS-to-registry total equality. Objection 4 (QA, minor): the single-source invariant was prose only; a source scan of `eval/grader.mjs` now asserts it imports the enum and carries no hardcoded outcome-array literal. The KINDS count (35 today, 36 after), the `designed` set, and the FAFF-930 premise are unchanged. Confidence unchanged (high).
- **2026-09-13 (autonomous re-prep):** Folded the born-verifiability gap the served spec-review QA lens raised **critical** in the 2026-09-03T21:20 park comment. The `spec-judge-discrimination` grade branch, including the enum-membership fix the prior re-prep folded, was asserted only in prose (section 5 scenarios) and by section 8's smoke, which never invoked `grade()` on a discrimination case; a `designed` seam runs no live driver either, so a build could revert to the pre-fix fail-open code and pass every check green. This re-prep adds a runnable test (`test/grader-spec-judge-discrimination.test.mjs`) that loads the committed `oracles.json`, drives `grade()` over the committed defect/taste pair, and asserts the pinned oracles plus the out-of-enum and null regression guards, then wires it into section 8's smoke, so a reverted fail-open branch turns a green build red. Also corrected a count that had gone stale: `KINDS` and the registry now hold 35 keys (FAFF-992 added `park-reconsider-classification` after the prior draft), so registering this seam takes the total to **36, not 35**; the `test/seam-registry.test.mjs` count assertion and its exact `designed` set both move with it. The prior draft's `env.ruling` enum-membership gate, decisions, and `designed`-status architecture are unchanged. The secondary architectural objection (grade branch "premature" while the live driver is deferred) is resolved in place: the branch is now exercised by a runnable test, "grade branch now, live driver later" is the existing `verdict-build` precedent, and the deferred live driver is filed as the FAFF-1007-style follow-up rather than built here. Confidence unchanged (high).
- **2026-09-03 (autonomous re-prep):** Folded the fail-open fix the served spec-review lenses (architectural + infosec) flagged in the 2026-09-03T09:49 park comment. Section 4's grade branch previously admitted **any** non-null string on an `outcome_not` oracle (it only tested `typeof env.ruling === "string"`), yet section 3, section 4 edge-cases, section 5 and section 8 DONE all assert an **out-of-enum** `env.ruling` must FAIL. As written, a hallucinated/garbage ruling would have PASSed the `case-defect` oracle (`outcome_not: AFFIRM_SPEC`), exactly the case the discrimination seam exists to catch. The grade branch now gates `env.ruling` on membership of the four-outcome closed set (`SPEC_JUDGE_OUTCOMES`) before the oracle test, so an out-of-enum ruling collapses to `null` → clean FAIL. A born-verifiable out-of-enum scenario was added to section 5, a design decision documenting the enum source to section 6, and the stale `README.md` line was added to build scope (section 1 / section 8). This is a correctness alignment of the pseudocode with the spec's own thrice-stated intent: no architectural or interface change; confidence unchanged.

## 1. WHY: Problem and Principles

**The load-bearing idea.** faff's eval harness has one registry, `eval/seam-registry.json`, that maps every grader KIND to the skill whose LLM-judgement seam it grades. Two consumers read it: `eval/grader.mjs` asserts, fail-loud on load, that its `KINDS` enum equals the registry's keys exactly (`assertRegistryConsistent`), and `faff validate-adapters` reconciles each skill's `judgement_seam:` frontmatter against the same registry. A judgement seam that has no registry row is invisible to both, it grades nothing and `validate-adapters` never even reports it owed. Making the judge's ruling "a real seam" therefore means one atomic change across three files that must stay mutually consistent, not one file in isolation.

**Problem statement.** The spec-review adjudicator shipped by FAFF-930 emits a terminal four-outcome ruling (`AFFIRM_SPEC | UPHOLD_REVIEW | SYNTHESIZE | PRD_BOUNDARY`) over blinded case files, and a discriminating case-pair plus pinned oracles are already committed for it, but no grader KIND, no registry row, and no frontmatter declaration exist, so `validate-adapters` is blind to the judge's weighing. This ticket registers that weighing as a graded seam (KIND + eval case + registry row, plus the two consistency edits those force) so the harness accounts for it and emits an honest NEEDS-CASES advisory, and it makes the grade branch's fail-closed behaviour a runnable regression check rather than prose.

**Design principle: the three registry consumers move together or not at all.** `eval/grader.mjs` `KINDS`, `eval/seam-registry.json` keys, and each surface's `judgement_seam:` frontmatter are cross-asserted for exact equality. An implementation that touches one without the matching others is rejected: adding a registry key without the KIND is a fail-loud load error; adding the row without updating the surface's frontmatter is a `validate-adapters` reconcile FAIL. Treat the KIND, the row, the frontmatter line, and the test-count as one commit.

**Design principle: honesty over coverage theatre.** A single stochastic sample cannot certify a probabilistic judge, so this seam must not claim `covered` (which would assert a graded black-box frontier that does not honestly exist yet) and must not fabricate a calibrated baseline. It registers `designed`, the truthful state for a live-driver seam whose corpus certification is a later human-supervised step.

**Design principle: a folded fix must be born-verifiable, not just described.** The enum-membership gate that closes the fail-open path is the whole point of this ticket. A gate asserted only in prose can be silently reverted by a later refactor with every check still green. The fix must therefore be exercised by a runnable test that grades the committed pair and the out-of-enum / null cases, so reverting the gate turns a green build red.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/seam-registry.json` | JSON | The seam→KIND SSOT; gains the new row. Currently 35 keys, no judge seam. |
| `eval/grader.mjs` | JS (ESM) | `KINDS` enum + `assertRegistryConsistent` + the grade dispatch; gains the KIND and its grade branch. Imports `SPEC_JUDGE_OUTCOMES` directly from `plugin/skills/faff/bin/lib/contract-defs.js` (an ESM named import of a CommonJS named export, which Node resolves via static analysis) for the ruling enum-membership gate. `grade(c, env)` is exported and drivable directly. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JS (CommonJS) | The `faff contract spec-judge-verdict` validator and the single home of `SPEC_JUDGE_OUTCOMES` (`contract-defs.js:494`), which the grader imports. Untouched by this ticket; the eval harness importing this plugin-internal module is an accepted, documented minor tradeoff (see section 6), re-pointed with a one-line fix if this file later moves. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JS | `reconcileSeam` / C2 NEEDS-CASES logic; unchanged, but its contract governs the frontmatter edit. Its `casesPresent(kind)` counts only `eval/cases/<kind>-NNN.json`. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown+frontmatter | The judge's surface; its `judgement_seam:` line must declare the new KIND. |
| `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/` | JSON+MD | The committed case-pair + `oracles.json` this seam grades; referenced, not moved. |
| `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/README.md` | Markdown | Its "Deferred: the gating grader" section still frames the grader KIND + registry row as "the sibling calibrated-corpus ticket's scope", stale once this ticket lands them; refresh that line (see section 8). |
| `test/grader-spec-judge-discrimination.test.mjs` | JS test (new) | The born-verifiable driver: loads the committed `oracles.json`, reads each case's `oracle` object from it and drives `grade()` with those bound oracles over the pair, asserts the corpus-to-branch binding plus the out-of-enum / null regression guards, and source-scans the grader for the single-source import. Added by this ticket, wired into section 8's smoke. |
| `test/seam-registry.test.mjs` | JS test | Hardcodes the KIND count (35) **and** the exact `designed` set; both must move: 35→36, and `spec-judge-discrimination` joins the `designed` set. |

**Scope statement.** This sits at the eval-harness registration layer for the `spec_review` slot's adjudicator surface (`faffter-dark-spec-review`), one altitude below the judge producer itself, which FAFF-930 owns and this spec does not touch.

## Already shipped against this surface

Two Done sibling tickets touch this surface; neither supersedes this ticket's premise:

- **FAFF-930** (Done, landed as commit `407be00b`) shipped the runnable blinded two-sided case-file adjudicator and *committed the discrimination case-pair + `oracles.json` as a "starting frontier" explicitly for this ticket* under `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/`. It did **not** add the grader KIND, the registry row, or the frontmatter declaration.
- **FAFF-922** (Done, PR #780) shipped the judge scaffold and deliberately **deferred this exact item** (register the grader KIND + eval case + seam-registry row), because the judge dispatch shape was then an open human Punt.

The remaining delta this ticket owns is unbuilt: the `spec-judge-discrimination` grader KIND + grade branch, the `eval/seam-registry.json` row, the `faffter-dark-spec-review` frontmatter reconciliation, the runnable born-verifiable test, and the test-count/designed-set bump. The premise holds; prep proceeds against the now-settled dispatch shape.

## 2. OUT OF SCOPE

- **Recording or accepting the baseline value**: excluded because certifying a stochastic judge is a human-supervised step (matching FAFF-922's original DONE phrasing). Extension point: `eval/baselines/frontier.json` (`per_kind` + `policy`), consumed by `validate-adapters` C3 (`checkCalibrated`); a future ticket flips the row `designed → calibrated` after the sweep.
- **The gating N-sample live-driver adapter**: excluded because gating needs a calibrated pass-rate threshold over a corpus, which depends on the deferred baseline. Extension point: a `LIVE_KINDS["spec-judge-discrimination"]` entry in `eval/run-live-evals.mjs` (the reconciliation/verdict-build/holdout-live precedent). `prd-readiness` is a `designed` kind that ships today with no `LIVE_KINDS` entry, so this omission is a supported state, not a gap. **Explicit follow-up:** arming this seam's gating N-sample live driver + case-backed wiring is the direct sibling of FAFF-1007 ("park-reconsider-classification grader: eval cases + case-backed wiring"), which does the same `designed → covered` arming for the park-reconsider classifier; the spec-judge-discrimination live driver should be filed as its counterpart, not built here. The born-verifiable test this ticket adds is a repo-local driver over the committed pair, not that gating N-sample corpus lane.
- **Any change to the judge producer or its contract**: the two-phase `faff spec-judge-evidence` dispatch, `adjudicate-phase1-reconstruct.md` / `adjudicate-phase2-rule.md`, and `faff contract spec-judge-verdict` are FAFF-930's, already landed. This spec consumes their output shape and changes none of it (it imports the `SPEC_JUDGE_OUTCOMES` enum from `contract-defs.js` without editing that file).
- **The advisory single-sample in-ticket run**: FAFF-930 already ships the non-gating advisory run over the committed pair. This ticket does not add or alter it.
- **Copying the case-pair into `eval/cases/`**: excluded; the committed pair is the live-driver corpus and stays in the skill dir. Copying it in the black-box `<kind>-NNN.json` shape would falsely mark the seam `covered` (see Design Decision Rationale). The born-verifiable test reads the pair from the skill dir; it does not copy fixtures into `eval/cases/`.

## 3. WHAT: Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| judge / adjudicator | The FAFF-930 spec-review producer that reads a blinded case file and emits one terminal `spec-judge-verdict` ruling. |
| the four-outcome ruling | The closed set `AFFIRM_SPEC | UPHOLD_REVIEW | SYNTHESIZE | PRD_BOUNDARY` (`SPEC_JUDGE_OUTCOMES`, defined in `contract-defs.js`, which the grader imports). |
| `spec-judge-discrimination` | The new grader KIND registered here for the judge's weighing output. |
| `designed` (registry status) | Registered, 0 cases in `eval/cases/`; `validate-adapters` emits an advisory NEEDS-CASES, never a FAIL. |
| discrimination case-pair | The committed `case-defect.json` (ruling must NOT be `AFFIRM_SPEC`) + `case-taste.json` (ruling MUST be `AFFIRM_SPEC`), with `oracles.json`. |
| exercised-case count | The number of committed cases the born-verifiable test loads and grades (2). Distinct from validate-adapters' `casesPresent`, which counts `eval/cases/` files (0 for this `designed` seam). |

**The registry row (added to `eval/seam-registry.json` `kinds`).**

```
ENTRY spec-judge-discrimination:
  surface: "faffter-dark-spec-review"   # the skill dir that holds the judge pipeline
  status:  "designed"                    # registered, graded via the live driver, 0 eval/cases/ files
```

**The grader KIND (added to `eval/grader.mjs`).**

```
KINDS ..= "spec-judge-discrimination"          # appended; keeps KINDS === registry keys (36 total)
# NOT added to CLOSED_SET_KINDS: its oracle is a single-value ==/≠ test, not set-equality.
# NOT added to BINARY_SETEQ_KINDS: likewise.
```

**The oracle shape (already committed, unchanged, in the skill dir).** The grade branch reads exactly this, with no rewrite of the committed `oracles.json`:

```
ORACLE (one of, per case):
  { outcome:     <one of the four outcomes> }   # ruling MUST equal it        (case-taste → AFFIRM_SPEC)
  { outcome_not: <one of the four outcomes> }   # ruling MUST NOT equal it    (case-defect → not AFFIRM_SPEC)
```

**The grade env the branch reads.**

```
ENV spec-judge-discrimination:
  ruling: <string>   # the judge's emitted outcome. MUST be a member of the four-outcome closed set
                     # SPEC_JUDGE_OUTCOMES (AFFIRM_SPEC | UPHOLD_REVIEW | SYNTHESIZE | PRD_BOUNDARY).
                     # null / non-string / out-of-enum → collapses to null → a clean FAIL, never a throw.
```

**Design decision: where the ruling rides in the env.** The dedicated branch reads `env.ruling`, a field distinct from the `env.verdict` lane that routing / verdict-build / spec-verdict / prd-readiness share. Options: (a) reuse `env.verdict`, (b) a dedicated `env.ruling`. Reusing `env.verdict` would overload a field whose established lane is set-equality against `oracle.closed_set`, whereas this seam grades `==`/`!=` against `oracle.outcome`/`oracle.outcome_not`; keeping them separate prevents a future reader assuming the closed-set math applies. **Chosen:** a dedicated `env.ruling` field, read only by the `spec-judge-discrimination` branch.

**Design decision: validate `env.ruling` against the four-outcome enum before grading.** The judge's ruling is only meaningful if it is one of the four terminal outcomes; a hallucinated or garbage string is not a "different ruling", it is a non-ruling. Options: (a) accept any non-null string and let the oracle equality/inequality decide, (b) gate on membership of `SPEC_JUDGE_OUTCOMES` first, collapsing anything out-of-enum to `null`. Option (a) is fail-open: on an `outcome_not` oracle any out-of-enum string trivially `!==` the forbidden value, so a garbage ruling would PASS the `case-defect` oracle, the exact defect the discrimination seam exists to catch. **Chosen:** (b): the grade branch imports `SPEC_JUDGE_OUTCOMES` directly from `contract-defs.js` (the single source, not a re-hardcoded literal) and treats a ruling outside that set exactly as `null` (clean FAIL). This is what makes section 4's edge-cases, section 5's out-of-enum scenario, and section 8's "out-of-enum → FAIL" DONE items true of the pseudocode, not just of the prose.

**Design decision: closed-set membership vs a dedicated grade branch.** Options: (a) route through `CLOSED_SET_KINDS` and re-express both oracle halves as `closed_set`; (b) a dedicated `if (c.kind === "spec-judge-discrimination")` branch. `outcome: AFFIRM_SPEC` could be a one-element `closed_set`, but `outcome_not: AFFIRM_SPEC` is a membership/inequality over the other three values that `setEqual` cannot express, and rewriting the committed oracles to force it would be a lie about what the case tests. **Chosen:** a dedicated grade branch outside `CLOSED_SET_KINDS`, honouring the committed `outcome`/`outcome_not` shape, the same "own branch, not in the closed set" precedent splittable / chain-gap / resolved-elsewhere already follow. Note this is orthogonal to the enum-membership gate above: the branch validates `env.ruling ∈ SPEC_JUDGE_OUTCOMES` itself, it does not delegate that to `CLOSED_SET_KINDS`.

**Design decision: make the folded enum-membership fix born-verifiable with an executable grade-branch test.** Until now the gate was asserted only in prose: section 5's Given/When/Then scenarios and section 8's DONE describe the behaviour, but section 8's smoke only imported the grader, greped the advisory, and ran a count assertion, none invoked `grade()` on a `spec-judge-discrimination` case, and a `designed` seam runs no live driver, so a build could revert to the pre-fix fail-open code and pass green. Options: (a) leave the scenarios as prose and trust review to catch a reverted gate; (b) add a runnable test that reads each committed case's `oracle` object and drives `grade()` with those bound oracles, asserting the pinned oracles plus the out-of-enum / null regression guards. Option (a) is exactly the born-verifiability gap the spec-review QA lens flagged critical. **Chosen:** (b): a dedicated `test/grader-spec-judge-discrimination.test.mjs` loads the committed `oracles.json`, binds `defectOracle` and `tasteOracle` from the file's `cases[]` (matched by `case_file`), asserts their exact shape (the corpus-to-branch binding), then drives `grade({ kind: "spec-judge-discrimination", oracle: <the bound oracle> }, { ruling })` per committed case, and asserts: the `case-defect` oracle (`outcome_not: AFFIRM_SPEC`) PASSes a non-`AFFIRM_SPEC` enum ruling and FAILs both `AFFIRM_SPEC` and an out-of-enum `"AFFIRM_SPECX"`; the `case-taste` oracle (`outcome: AFFIRM_SPEC`) PASSes `AFFIRM_SPEC` and FAILs an out-of-enum `"BANANA"`; a `null` ruling FAILs without throwing. The rulings stay test-supplied, since they simulate judge outputs, not oracle payloads. It reuses the exact `grade(c, env)` drive pattern the existing `test/eval-grader.test.mjs` uses. Wired into section 8's smoke, this turns a reverted fail-open branch from a green build into a red one.

**Design decision: how "the committed pair is exercised" is counted, given the seam stays `designed`.** Two different counters are in play and must not be conflated. `validate-adapters`' `casesPresent(kind)` counts files under `eval/cases/` matching `<kind>-NNN.json`; for a `designed` live-driver seam whose corpus lives in the skill dir it is legitimately 0 (and drives the honest NEEDS-CASES advisory). Separately, the committed discrimination corpus (`oracles.json` `cases[]`, 2 entries) is the seam's exercised-case set. Options: (a) copy black-box fixtures into `eval/cases/` so validate-adapters' counter reads > 0 (rejected in section 6 as dishonest coverage theatre for a stochastic seam); (b) keep the pair in the skill dir and exercise it via the runnable test above, so the seam's exercised-case count is 2 while validate-adapters' `casesPresent` stays 0. **Chosen:** (b): the born-verifiability the QA lens requires is met by the runnable test loading and grading the committed pair (exercised-cases = 2 > 0, asserted by the test), not by inflating validate-adapters' `eval/cases/` counter. The spec does not claim validate-adapters reports `casesPresent > 0`; it correctly stays 0 for a `designed` seam, and the NEEDS-CASES advisory remains the honest signal.

## 4. HOW: Behaviour

**Approach.** One commit makes six coordinated edits: the registry row, the KIND + grade branch, the frontmatter declaration, the test-count/designed-set bump, the README refresh, and the new born-verifiable grade-branch test, so the three cross-asserted consumers stay consistent, `validate-adapters` reports the seam honestly, and the folded gate is a runnable regression check.

**The grade branch.** Behaviour summary: read the judge's single ruling, reject anything not in the four-outcome enum, and pass iff the (enum-valid) ruling satisfies the case's `outcome`/`outcome_not` oracle; fail closed on anything malformed.

```
IN grade(), a dedicated branch placed with the other own-branch kinds (splittable/chain-gap precedent):
PROCEDURE grade_spec_judge_discrimination(c, env):
  1. # Enum-membership gate: only a member of the four-outcome closed set is a real ruling.
     #   An out-of-enum / non-string / null value is NOT a ruling and collapses to null,
     #   so a hallucinated/garbage ruling can never vacuously satisfy an `outcome_not` oracle.
     inEnum := (typeof env.ruling === "string") AND SPEC_JUDGE_OUTCOMES.includes(env.ruling)
     ruling := inEnum ? env.ruling : null
  2. o := c.oracle
  3. IF o has `outcome`:          ok := (ruling === o.outcome)
  4. ELSE IF o has `outcome_not`: ok := (ruling !== null) AND (ruling !== o.outcome_not)
  5. ELSE: ok := false            # malformed oracle → clean FAIL, never a throw
  6. RETURN { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, tokens,
             signature: JSON.stringify(ruling) }
```

`SPEC_JUDGE_OUTCOMES` is imported directly from `plugin/skills/faff/bin/lib/contract-defs.js`, the same closed set `faff contract spec-judge-verdict` validates against, never a second hardcoded copy in the grader. This is a cross-layer import: the eval harness reaches into a plugin-internal module, so if `contract-defs.js` is later moved or refactored the grader's import path must be re-pointed (a one-line fix), or the harness throws `ERR_MODULE_NOT_FOUND` at load. That coupling is an accepted, documented minor (see section 6): the extraction cure, editing the out-of-scope `contract-defs.js` and minting a new top-level directory, is disproportionate to a minor.

Note steps 1 + 4 together close the fail-open path: a `null` ruling fails `outcome_not` (an absent ruling must not vacuously "pass" a negative oracle by not-equalling the forbidden value), and step 1 routes an out-of-enum ruling (a hallucinated `"AFFIRM_SPECX"` or arbitrary garbage) to `null` **before** step 4, so it FAILs the `case-defect` oracle (`outcome_not: AFFIRM_SPEC`) rather than passing it by mere inequality. Without step 1 the served review lenses' fail-open objection stands; with it, an out-of-enum ruling is graded exactly like a missing one. The new born-verifiable test drives exactly these paths.

**The born-verifiable test.** `test/grader-spec-judge-discrimination.test.mjs` imports `grade` from `../eval/grader.mjs` (the pure, free-to-run drive pattern `test/eval-grader.test.mjs` already uses) and reads the committed `oracles.json` from the skill dir. Every oracle it grades is read from the committed file, not transcribed as a literal; only the rulings are test-supplied, because they simulate judge outputs, not oracle payloads.

```
PROCEDURE test():
  reg := JSON.parse(read("plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/oracles.json"))
  assert reg.grader_kind === "spec-judge-discrimination"     # corpus-to-KIND drift guard
  assert reg.cases.length === 2                              # exercised-case count > 0 (the pair)

  # Bind each oracle FROM the committed file (never a hardcoded literal), matched by case_file.
  defectOracle := (reg.cases.find(x => x.case_file === "case-defect.json")).oracle
  tasteOracle  := (reg.cases.find(x => x.case_file === "case-taste.json")).oracle

  # Corpus-to-branch binding: an oracle-shape edit to the committed file turns this test RED.
  assert ("outcome_not" in defectOracle) AND defectOracle.outcome_not === "AFFIRM_SPEC"
  assert ("outcome"     in tasteOracle)  AND tasteOracle.outcome      === "AFFIRM_SPEC"

  K := "spec-judge-discrimination"
  # case-defect oracle, READ from the file; only the ruling is test-supplied.
  assert grade({kind:K, oracle:defectOracle}, {ruling:"UPHOLD_REVIEW"}).score === 1   # PASS
  assert grade({kind:K, oracle:defectOracle}, {ruling:"AFFIRM_SPEC"}).score   === 0   # FAIL
  assert grade({kind:K, oracle:defectOracle}, {ruling:"AFFIRM_SPECX"}).score  === 0   # out-of-enum FAIL (the fold)
  assert grade({kind:K, oracle:defectOracle}, {ruling:null}).score            === 0   # null FAIL, no throw
  # case-taste oracle, READ from the file
  assert grade({kind:K, oracle:tasteOracle}, {ruling:"AFFIRM_SPEC"}).score === 1      # PASS
  assert grade({kind:K, oracle:tasteOracle}, {ruling:"BANANA"}).score      === 0      # out-of-enum FAIL

  # Fix 4, single-source scan: the grader IMPORTS the enum, it does not re-hardcode it.
  src := read("eval/grader.mjs")
  assert src imports SPEC_JUDGE_OUTCOMES from contract-defs.js
         # matches /import\s*\{[^}]*\bSPEC_JUDGE_OUTCOMES\b[^}]*\}\s*from\s*["'][^"']*contract-defs\.js["']/
  assert src has NO hardcoded outcome-array literal
         # no ["AFFIRM_SPEC", ... , "PRD_BOUNDARY"] array reintroduced in grader.mjs

  # Change B, runtime value-equality: import the enum the same way the grader does and
  # assert its exact members, a stronger single-source check than the import-text scan above.
  { SPEC_JUDGE_OUTCOMES } := import("../plugin/skills/faff/bin/lib/contract-defs.js")
  assert deepEqual(SPEC_JUDGE_OUTCOMES, ["AFFIRM_SPEC","UPHOLD_REVIEW","SYNTHESIZE","PRD_BOUNDARY"])
         # fail-loud, in the style of assertRegistryConsistent (grader.mjs:309)
```

Reverting step 1's enum-membership gate makes the two out-of-enum assertions fail; editing the committed oracle shapes makes the corpus-to-branch binding assertions fail; re-hardcoding the outcome set in the grader makes the source-scan assertion fail; drifting the enum's members from the four-outcome set makes the runtime value-equality assertion fail. So the fold, the corpus-to-branch link, and the single-source invariant (both its import and its exact value) each become a red build if regressed.

**Load-time consistency.** `assertRegistryConsistent(loadSeamRegistry())` runs on module load (`grader.mjs:309`). After the edit, `KINDS` (36 entries) must equal the registry keys (36) exactly; a one-sided edit is a fail-loud `CaseError`. Smoke step 1 surfaces that throw (it uses top-level `await import(...)`, so a rejected import exits non-zero rather than swallowing the rejection), and `test/seam-registry.test.mjs` (smoke step 3) independently asserts the KINDS-to-registry total equality. This is the enforcement, not a thing to test around.

**The frontmatter reconciliation.** `reconcileSeam` set-equals a surface's declared seams to its registry rows. `faffter-dark-spec-review` will own two rows (`refutation-spec`, `spec-judge-discrimination`), so its frontmatter line becomes the comma-scalar list `readJudgementSeam` parses:

```
judgement_seam: refutation-spec, spec-judge-discrimination
```

**What `validate-adapters` then reports.** With the row `designed` and 0 files in `eval/cases/`, C2 takes the `designed` arm and prints a `NEEDS-CASES  spec-judge-discrimination (surface faffter-dark-spec-review)` line whose tail records registry-status `designed`, 0 cases yet (advisory); it is advisory, exit 0. This advisory line IS "validate-adapters accounts for the judge seam"; before this ticket the seam produced no line at all. C3 (calibration floor) is untouched because no row is `calibrated`.

**The test-count and designed-set bump.** `test/seam-registry.test.mjs` hardcodes both the KIND count (currently 35, three references) and the exact `designed` set (`["reconciliation", "verdict-build", "holdout-live", "prd-readiness", "park-reconsider-classification"]`). Registering a new `designed` kind moves both: the count becomes 36, and `spec-judge-discrimination` joins the `designed` set. Its own "seed is truthful" per-kind arm (a `designed` kind must have 0 files in `eval/cases/`) then passes for the new row because the committed pair stays in the skill dir.

**Edge cases and error handling.**
- Null / non-string / out-of-enum `env.ruling` → clean FAIL with a distinct `signature`, never a throw (the confidence/routing fail-safe stance). The out-of-enum case is enforced by step 1's `SPEC_JUDGE_OUTCOMES.includes` gate, not left to the oracle's inequality, and is asserted by the born-verifiable test.
- Malformed oracle (neither `outcome` nor `outcome_not`) → clean FAIL.
- The committed pair staying in the skill dir means `casesPresent("spec-judge-discrimination")` derives 0 from `eval/cases/`, correct for `designed`; do not "fix" it by copying files in. The exercised-case count (2) lives in the test, not in that counter.

**Failure modes.**
- **The failure:** marking the seam `covered` (or copying fixtures into `eval/cases/`) to make it look graded. **How you'd know:** `validate-adapters` C2 FAILs (`covered` with 0 cases), or, if fixtures are copied, a single-sample black-box PASS/FAIL that cannot certify a stochastic judge yet is treated as a frontier. **What it means:** abandon that path; `designed` is the honest state until the calibration ticket runs the corpus sweep.
- **The failure:** editing the registry key or the KIND alone. **How you'd know:** smoke step 1's top-level `await import("./eval/grader.mjs")` exits non-zero on the fail-loud `seam-registry KINDS drift` throw, and `test/seam-registry.test.mjs` (smoke step 3) FAILs the total-equality assertion. **What it means:** the two-sided edit is mandatory, by construction.
- **The failure:** admitting any non-null string as a ruling (the pre-fix fail-open). **How you'd know:** the born-verifiable test's `"AFFIRM_SPECX"` assertion fails, the `case-defect` oracle (`outcome_not: AFFIRM_SPEC`) PASSes on a garbage ruling, so the seam cannot catch a hallucinating judge. **What it means:** step 1's enum-membership gate is missing, restore it.
- **The failure:** landing the grade branch but not the test (prose-only, the state the QA lens flagged critical). **How you'd know:** no `spec-judge-discrimination` case ever reaches `grade()` in CI; the smoke's step 4 is absent. **What it means:** the fold is not born-verifiable, add the test and wire it into the smoke.
- **The failure:** re-hardcoding the four-outcome set in `grader.mjs` instead of importing it. **How you'd know:** the born-verifiable test's source-scan or runtime value-equality assertion fails (no `contract-defs.js` import, a literal outcome array present, or the members drifted). **What it means:** delete the literal and import `SPEC_JUDGE_OUTCOMES` from `contract-defs.js`.

**Anti-pattern:** adding `spec-judge-discrimination` to `CLOSED_SET_KINDS`. Why: its oracle is `outcome`/`outcome_not` (equality/inequality on one ruling), not a set to `setEqual`; the closed-set path would misgrade the committed `outcome_not` case.

**Anti-pattern:** rewriting the committed `oracles.json` into a `closed_set` shape. Why: the pinned pair is the seam's starting frontier committed for this ticket; the grader adapts to it, not the reverse.

**Anti-pattern:** re-declaring the four-outcome set as a literal inside `grader.mjs`. Why: it must stay a single source with the contract; import `SPEC_JUDGE_OUTCOMES` from `contract-defs.js` so a future outcome addition cannot drift the grader from the contract.

## 5. SCENARIOS: born-verifiable main objectives

```
Given the coordinated edits are applied
When eval/grader.mjs is imported via smoke step 1 (top-level await, so a load-time throw exits non-zero)
Then it loads without throwing, smoke step 1 exits 0, and KINDS.length === 36
And test/seam-registry.test.mjs (smoke step 3) asserts KINDS.length === Object.keys(registry.kinds).length === 36, so the three-consumers total-equality is the check that catches a one-sided edit
```

```
Given the spec-judge-discrimination row is `designed` with 0 files in eval/cases/
When `faff validate-adapters` runs
Then it prints a NEEDS-CASES advisory line naming spec-judge-discrimination (surface faffter-dark-spec-review) and exits 0 (no FAIL for this kind)
```

```
Given a case whose oracle is { outcome_not: "AFFIRM_SPEC" } (the case-defect shape, READ from the committed oracles.json)
When the judge ruling in env.ruling is "UPHOLD_REVIEW"
Then the grade branch returns PASS (score 1)
And given the same read oracle when env.ruling is "AFFIRM_SPEC" the branch returns FAIL (score 0)
And given env.ruling is null the branch returns FAIL, not a throw
And given env.ruling is an out-of-enum string "AFFIRM_SPECX" (not in SPEC_JUDGE_OUTCOMES) the branch returns FAIL (score 0), not a vacuous PASS
```

```
Given a case whose oracle is { outcome: "AFFIRM_SPEC" } (the case-taste shape, READ from the committed oracles.json)
When env.ruling is "AFFIRM_SPEC" the branch returns PASS (score 1)
And when env.ruling is an out-of-enum string "BANANA" the branch returns FAIL (score 0), not a throw
```

```
Given test/grader-spec-judge-discrimination.test.mjs is present
When `node --test test/grader-spec-judge-discrimination.test.mjs` runs
Then it loads the committed oracles.json (grader_kind === "spec-judge-discrimination", cases.length === 2)
And binds defectOracle and tasteOracle from the file's cases[] (matched by case_file) and asserts their exact shape, so an oracle-shape edit to the committed file turns the test RED
And drives grade() with those bound oracles over the committed defect/taste pair, asserting each of the PASS/FAIL/out-of-enum/null outcomes above with only the ruling supplied per case
And source-scans eval/grader.mjs, asserting it imports SPEC_JUDGE_OUTCOMES from contract-defs.js and carries no hardcoded outcome-array literal
And imports SPEC_JUDGE_OUTCOMES the same way the grader does and asserts it deep-equals ["AFFIRM_SPEC","UPHOLD_REVIEW","SYNTHESIZE","PRD_BOUNDARY"], a runtime value check stronger than the import-text scan
And a build carrying the pre-fix fail-open branch (no enum gate) FAILS this test: the fold is verified, not merely described
```

```
Given faffter-dark-spec-review now owns two registry rows
When reconcileSeam compares its judgement_seam frontmatter to the registry
Then declared [refutation-spec, spec-judge-discrimination] set-equals the registry rows and reconciliation passes
```

## 6. DESIGN DECISION RATIONALE

**Register the seam `designed` (live-driver lane) or `covered` (black-box `eval/cases/` fixtures)?**
- `covered`: would require ≥1 `eval/cases/spec-judge-discrimination-NNN.json` black-box fixture graded against a recorded env. Con: grading the judge means actually RUNNING it over blinded case files, execution-entangled, exactly like the existing `designed` live-driver lanes (reconciliation, verdict-build, holdout-live, prd-readiness). A recorded single-sample env cannot honestly certify a stochastic judge, and `validate-adapters` C2 FAILs a `covered` kind with 0 files in `eval/cases/`, where the committed pair does not live.
- `designed`: registered, KIND + grade branch wired, cases referenced from the skill dir and exercised by the born-verifiable test, graded via the live driver when the calibration ticket adds the adapter. `validate-adapters` emits NEEDS-CASES (advisory), which is the honest "accounted-for" state and the precedent every other live-driver seam uses.
- **Chosen:** `designed`: it is the only status that is both truthful for a stochastic execution-entangled seam and non-failing given the committed pair's location. At the time of writing the corpus sweep that would justify `calibrated` is out of scope (human-supervised).

**Make the folded enum-membership fix born-verifiable, or leave the scenarios as prose?**
- Prose-only: the state the 2026-09-03T21:20 spec-review QA lens flagged **critical**, section 5's Given/When/Then and section 8's DONE describe the gate, but no runnable check invokes `grade()` on a discrimination case, and a `designed` seam runs no live driver, so a build could revert to the fail-open branch and pass every AC green.
- Runnable test: `test/grader-spec-judge-discrimination.test.mjs` reads the committed oracles from the file and drives `grade()` over the bound pair plus the out-of-enum / null cases, wired into section 8's smoke; reverting the gate turns the build red.
- **Chosen:** the runnable test. It costs one free-to-run test file (the grader is pure; no frontier calls), closes the born-verifiability gap, and reuses the established `test/eval-grader.test.mjs` drive pattern.

**Read the graded oracles from the committed file, or transcribe them as literals in the test?**
- Literals: the test would grade the branch against a spec-author's transcription of the oracles, so an oracle-shape edit to the committed `oracles.json` (a changed `outcome_not` value, a third case) would leave the test green, silently desynchronising it from the corpus it claims to guard. The `grader_kind` check catches only a KIND rename.
- Read from file: bind `defectOracle` / `tasteOracle` from `reg.cases[]` (matched by `case_file`), assert their exact shape (the corpus-to-branch binding), and pass those bound objects to `grade()`. Only the rulings stay test-supplied, since they simulate judge outputs, not oracle payloads.
- **Chosen:** read from file. This is the corpus-to-branch binding the 2026-09-14 architectural lens said was missing: an oracle-shape edit to the committed file turns the test red, so the test guards what the corpus actually says, not what the author transcribed.

**Keep the committed case-pair in the skill dir, or move it into `eval/cases/`?**
- **Chosen:** keep it in `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/` and reference it (the born-verifiable test reads it from there). Its bespoke `oracles.json` (`grader_kind` + `gating:false` + `advisory_note` + `cases[]`) is the live-driver corpus shape, not the black-box `<kind>-NNN.json` fixture shape; moving it would misrepresent a `designed` seam as `covered` and force a dishonest fixture rewrite.

**How does the grade branch read the ruling and grade it?**
- **Chosen:** a dedicated `env.ruling` field graded by a dedicated `spec-judge-discrimination` branch outside `CLOSED_SET_KINDS`, honouring the committed `outcome`/`outcome_not` oracle (see WHAT). Rejected: reusing the `env.verdict`/`closed_set` set-equality lane, which cannot express `outcome_not`.

**Validate the ruling against the four-outcome enum, or accept any non-null string? And where does the enum live?**
- **Chosen:** gate `env.ruling` on `SPEC_JUDGE_OUTCOMES.includes(...)` before the oracle test, collapsing anything out-of-enum to `null`, and source `SPEC_JUDGE_OUTCOMES` by importing it directly from `plugin/skills/faff/bin/lib/contract-defs.js` (`contract-defs.js:494`, where it already lives), an ESM named import of a CommonJS named export that Node resolves by static analysis. Accepting any non-null string is fail-open on the `outcome_not` oracle: a garbage ruling trivially `!==` the forbidden outcome and would PASS `case-defect`, defeating the seam's whole purpose (catching a hallucinating judge). On the enum's home the options were (a) a literal in the grader (rejected, drifts from the contract), (b) import directly from `contract-defs.js` and accept the cross-layer coupling, (c) extract the enum to a new shared repo-root module both the plugin and the harness import. Option (b) is chosen: `contract-defs.js` is left untouched, and the coupling it creates (the eval harness importing a plugin-internal module) is an accepted, documented minor: if `contract-defs.js` is later moved or refactored the grader's import must be re-pointed, a one-line fix. It is accepted because the coupling was only ever rated a minor by the prior review, and the cure is disproportionate to it. Option (c) was considered and rejected for that reason: extracting to `shared/spec-judge-outcomes.cjs` would edit `contract-defs.js`, which section 2 reserves to FAFF-930 as out of scope, and mint a new top-level `shared/` directory, a large structural change to fix a minor cross-layer nit. With the born-verifiable test, its source-scan, and its runtime value-equality check, this resolves the fail-open contradiction the served spec-review lenses raised and makes section 4's edge-cases, section 5's out-of-enum scenario, and section 8's out-of-enum and single-source DONE items true of the code, not just the prose.

**Count "the committed pair is exercised" via validate-adapters' `casesPresent`, or via the test's exercised-case count?**
- **Chosen:** via the test. `validate-adapters`' `casesPresent(kind)` counts `eval/cases/` files and is correctly 0 for a `designed` seam whose corpus lives in the skill dir; forcing it > 0 would mean copying black-box fixtures (coverage theatre, rejected above). The born-verifiability the QA lens requires is met by the runnable test loading and grading the committed pair (exercised-cases = 2 > 0). The spec asserts the exercised count in the test, not a change to validate-adapters' counter, and keeps the NEEDS-CASES advisory as the honest registry signal.

**The frontmatter, test-count/designed-set, and README edits.**
- **Chosen:** update `faffter-dark-spec-review/SKILL.md` `judgement_seam:` to `refutation-spec, spec-judge-discrimination`; bump `test/seam-registry.test.mjs` count 35→36 (three references) and add `spec-judge-discrimination` to its `designed`-set assertion; and refresh `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/README.md`'s "Deferred: the gating grader" section so it no longer claims the grader KIND + registry row are "the sibling calibrated-corpus ticket's scope" (they land here; only the calibrated N-sample gating stays deferred). The first two are forced by `reconcileSeam`'s set-equality and hardcoded count/set assertions respectively; the README refresh keeps the committed docs honest once the row exists. Documented so the build agent does not ship a row-only change that fails CI or leaves stale docs.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. FAFF-930 landed (commit `407be00b`), so the judge-dispatch shape that caused FAFF-922's deferral (slot-vs-inline) is settled as an inline `faff-prep` dispatch, and every decision above is a defensible `Chosen`.

**Resolved objection (from the 2026-09-03T21:20 spec-review architectural lens).** The lens argued the grade branch is "premature / over-built" because its gating live driver is deferred and no `eval/cases/` fixtures ship, so the branch existed only as a would-be unit-test target. This resolves two ways: (1) the branch is now exercised by a runnable test (`test/grader-spec-judge-discrimination.test.mjs`, see section 3 / section 4 / section 8), so it is a live regression check, not a dead target; and (2) "grade branch now, live driver later" is the established precedent, `verdict-build` is itself a `designed` seam with a wired grade branch and a deferred live driver (`grader.mjs` header). The deferred gating N-sample driver is filed as the FAFF-1007-style follow-up (see section 2's OUT OF SCOPE bullet), not built here. The lens's secondary points (the `covered`-semantics wording and the cross-layer enum import) are clarified in section 6 and the reference table respectively; the cross-layer import is retained and accepted as a documented minor (see section 6), not removed, because the extraction cure would edit the out-of-scope `contract-defs.js` and add a new top-level directory to fix a minor. Neither changes the registry contract.

**Assumptions.**
- **Assumes:** the FAFF-930 judge producer, its two-phase `faff spec-judge-evidence` dispatch, and `faff contract spec-judge-verdict` with the four-outcome vocabulary `AFFIRM_SPEC | UPHOLD_REVIEW | SYNTHESIZE | PRD_BOUNDARY` exist and emit that ruling. Validation before starting: `faff contract spec-judge-verdict --describe` lists the four outcomes, and `grep -n SPEC_JUDGE_OUTCOMES plugin/skills/faff/bin/lib/contract-defs.js` shows the closed set (confirmed present at authoring time, `contract-defs.js:494`, which this ticket leaves untouched and imports the grader's enum from directly).
- **Assumes:** the committed discrimination pair (`case-defect.json`, `case-taste.json`, `oracles.json`) is present under `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/`. Validation: `ls` that dir before wiring the reference and the test (confirmed present at authoring time).
- **Assumes:** the current on-disk `KINDS` / registry hold 35 keys (FAFF-992's `park-reconsider-classification` is present), so registration takes the total to 36. Validation: `node --input-type=module -e 'const m = await import("./eval/grader.mjs"); console.log(m.KINDS.length)'` prints 35 before the edit (confirmed 35 at authoring time).

## 8. DONE: Definition of Done

### From WHY (the seam is accounted for)
- [ ] `eval/seam-registry.json` `kinds` contains `spec-judge-discrimination` with `{ "surface": "faffter-dark-spec-review", "status": "designed" }`, and the map has 36 keys.
- [ ] `faff validate-adapters` prints a NEEDS-CASES advisory line for `spec-judge-discrimination` (surface `faffter-dark-spec-review`) and exits 0 (no FAIL introduced for this kind).
- [ ] `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/README.md`'s "Deferred: the gating grader" section is refreshed so it no longer frames the grader KIND + `eval/seam-registry.json` row as "the sibling calibrated-corpus ticket's scope", it records they land in this ticket (`designed`), with only the calibrated N-sample gating still deferred.

### From WHAT (KIND + registry + consistency)
- [ ] `eval/grader.mjs` `KINDS` includes `"spec-judge-discrimination"` (36 entries) and it is NOT in `CLOSED_SET_KINDS` or `BINARY_SETEQ_KINDS`.
- [ ] `eval/grader.mjs` imports `SPEC_JUDGE_OUTCOMES` directly from `plugin/skills/faff/bin/lib/contract-defs.js` (not a second hardcoded outcome list) and the grade branch validates `env.ruling` against it; `contract-defs.js` is left untouched and the cross-layer import is an accepted, documented minor.
- [ ] Importing `eval/grader.mjs` runs `assertRegistryConsistent(loadSeamRegistry())` on load; smoke step 1's top-level `await import("./eval/grader.mjs")` exits non-zero if that throws `seam-registry KINDS drift`, and `test/seam-registry.test.mjs` (smoke step 3) asserts the KINDS-to-registry total equality. A one-sided edit therefore turns a named check red.
- [ ] `test/seam-registry.test.mjs` asserts the count is 36 (35→36 bumped, all three references) and its `designed`-set assertion includes `spec-judge-discrimination`; the test passes.

### From HOW (grade behaviour)
- [ ] `grade()` has a dedicated `spec-judge-discrimination` branch: with `oracle.outcome`, PASS iff `env.ruling === oracle.outcome`; with `oracle.outcome_not`, PASS iff `env.ruling` is a non-null enum-valid string `!== oracle.outcome_not`.
- [ ] An `env.ruling` outside `SPEC_JUDGE_OUTCOMES` (e.g. `"AFFIRM_SPECX"`) yields a clean FAIL (score 0) on BOTH oracle halves, in particular it does NOT vacuously PASS an `outcome_not` oracle.
- [ ] A null / non-string `env.ruling` yields a clean FAIL (score 0), never a throw.
- [ ] A malformed oracle (neither key) yields a clean FAIL, never a throw.

### From HOW (the fold is born-verifiable)
- [ ] `test/grader-spec-judge-discrimination.test.mjs` exists, imports `grade` from `eval/grader.mjs`, and loads the committed `plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/oracles.json` (asserting `grader_kind === "spec-judge-discrimination"` and `cases.length === 2`).
- [ ] That test binds `defectOracle` and `tasteOracle` from the file's `cases[]` (matched by `case_file`), asserts their exact shape (`defectOracle` has `outcome_not === "AFFIRM_SPEC"`; `tasteOracle` has `outcome === "AFFIRM_SPEC"`), and drives `grade()` with those bound oracles (not transcribed literals) so an oracle-shape edit to the committed file turns the test red.
- [ ] Driving `grade()` with the bound oracles asserts every section 5 outcome, only the ruling supplied per case: `case-defect` PASSes `"UPHOLD_REVIEW"`, FAILs `"AFFIRM_SPEC"`, FAILs out-of-enum `"AFFIRM_SPECX"`, FAILs `null` (no throw); `case-taste` PASSes `"AFFIRM_SPEC"`, FAILs out-of-enum `"BANANA"`.
- [ ] The test source-scans `eval/grader.mjs` and asserts it imports `SPEC_JUDGE_OUTCOMES` from `contract-defs.js` and contains no hardcoded outcome-array literal (no `["AFFIRM_SPEC", ... , "PRD_BOUNDARY"]` in the grader), so the single-source invariant is a decidable check.
- [ ] The test additionally imports `SPEC_JUDGE_OUTCOMES` the same way the grader does and asserts it deep-equals `["AFFIRM_SPEC","UPHOLD_REVIEW","SYNTHESIZE","PRD_BOUNDARY"]` (a runtime value-equality check, stronger than the import-text scan), in the fail-loud style of `assertRegistryConsistent` (`grader.mjs:309`).
- [ ] The test is a runnable regression check: a build carrying the pre-fix fail-open branch (no enum-membership gate) makes it FAIL. `node --test test/grader-spec-judge-discrimination.test.mjs` passes on the fixed branch.
- [ ] The test is wired into section 8's smoke (step 4 below).

### From HOW (frontmatter reconciliation)
- [ ] `faffter-dark-spec-review/SKILL.md` frontmatter reads `judgement_seam: refutation-spec, spec-judge-discrimination`, and `faff validate-adapters` reports its judgement-seam reconciliation as passing (declared set-equals the two registry rows).

### From OUT OF SCOPE (deferrals held)
- [ ] No black-box fixture is added under `eval/cases/` for this kind (the committed pair stays in the skill dir); `casesPresent("spec-judge-discrimination")` derives 0. Born-verifiability comes from the runnable test, not from copied fixtures.
- [ ] No `calibrated` status, no `eval/baselines/frontier.json` row, and no `LIVE_KINDS["spec-judge-discrimination"]` adapter are introduced (calibration/gating stays deferred as the FAFF-1007-style follow-up); C3 remains unaffected.

### Eval coverage
- [ ] This work registers the judge-weighing LLM-judgement seam: grader KIND (`spec-judge-discrimination`), ≥1 eval case (the committed discrimination pair, referenced and now exercised by a runnable test), and the seam-registry row, all in this ticket. Recording/accepting the baseline value and the gating N-sample live driver are the separate follow-up (FAFF-1007's sibling) and are not part of this DONE.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. node --input-type=module -e 'const m = await import("./eval/grader.mjs"); if (m.KINDS.length !== 36) process.exit(1);'
     # top-level await: a load-time assertRegistryConsistent throw rejects the import and exits non-zero
     # (not swallowed), and the KIND count is checked: connectivity of registry↔KINDS
  2. faff validate-adapters | grep -q "NEEDS-CASES  spec-judge-discrimination"
     # the seam is now accounted for, advisory
  3. node --test test/seam-registry.test.mjs
     # the check that ENFORCES the AC: count (36) + KINDS↔registry total-equality + designed-set hold
  4. node --test test/grader-spec-judge-discrimination.test.mjs
     # the folded enum-membership gate is exercised: oracles READ from the committed file grade to
     # their pinned outcomes, an out-of-enum / null ruling FAILs, and the grader source-scan confirms
     # the single-source import, so the fail-open, corpus-drift, and re-hardcode regressions are all caught
  # all four green ⇒ the seam is registered, the three consumers agree, and the fold is born-verifiable
```

confidence: high
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
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
