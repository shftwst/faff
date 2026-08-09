# Spec — route the three binary set-equality eval kinds to 0.0 gate tolerance

> Spec: faffter-dark-nlspec · 2026-08-06 · interactive · confidence: high · spec-review: approve (human override — see revision note). Full spec on Linear FAFF-692.

> **Revised 2026-08-06 (interactive re-prep).** Folded in the spec-review QA lens's `revise` (landed this session via nvidia glm-5.2): (1) Scenario 2 + its DONE item now pin a **concrete hermetic fixture** for the `diffAgainstBaseline` gate-effect test, so the "failed not warned" assertion is reproducible rather than oracle-ambiguous; (2) a new DONE item guards the `warn_kinds` invariant alongside the existing `!CLOSED_SET_KINDS.has(...)` guard. Design unchanged. The architectural + infosec lenses could not be independently scored this session (refuter backends quota-exhausted); given a trivial pure-function change with no founded objection across five review attempts, promoted by operator override. See the promotion note comment.

This spec resolves FAFF-692: three eval kinds — `chain-gap`, `resolved-elsewhere`, and `splittable` — are graded pass/fail (score 0 or 1) but the baseline gate hands them the 0.03 tolerance meant for free-text rubric grades. The work is a decision plus a small, pure-function change to `eval/run-evals.mjs` and a co-located named set in `eval/grader.mjs`, with a test.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the gate's tolerance is keyed by *grader class*, not by kind name. A grade that can only come back 0 or 1 has no partial-credit band for a tolerance to sit in — any drop is a real flip, so its tolerance must be 0.0. Three kinds are currently mis-keyed to the free-text band.

**Problem statement.** `gradeSplittable` and `gradeChainGap` return `score: ok ? 1 : 0` — exact, synonym-tolerant set-equality, no partial credit. But `toleranceFor()` in `eval/run-evals.mjs` sends `chain-gap`, `resolved-elsewhere`, and `splittable` to the `free_text` bucket at 0.03, because they sit in neither `CLOSED_SET_KINDS` nor the `ordering` special-case. A regression of up to 0.03 on a binary grade is then absorbed as a warning instead of failing the gate — a real flip, partially hidden, on a grade with no generation variance to justify the slack.

**The decision this ticket asks for is settled here: yes, all three belong at 0.0.** The codebase already states the rationale in the `DEFAULT_POLICY` comment — "closed-set + ordering grade by exact set-equality / rank-correlation, so any drop is real (tol 0); free-text kinds (rubric/coverage) carry inherent generation variance, so a small tolerance absorbs a ~1-rep dip." These three are exact set-equality graders. By the harness's own stated reasoning they are in the "any drop is real" camp, not the rubric-variance camp. The 0.03 slack was never chosen for them — they fell into it as the default `else` branch.

**Design principles.**

- **Tolerance class is not grade-dispatch class.** `CLOSED_SET_KINDS` drives which *grade function* runs (the closed-set set-membership math). These three are deliberately *out* of `CLOSED_SET_KINDS` because they grade through their own synonym-folding branches (`gradeSplittable` / `gradeChainGap`). Their tolerance must be fixed without moving them into `CLOSED_SET_KINDS` — doing that would silently repoint their grade math. Keep the two axes separate.
- **Empirical flakiness is handled by `warn_kinds`, not by tolerance slack.** The precedent is `confidence`: a binary-graded kind that proved rep-to-rep flaky was added to `warn_kinds` (reported, not failed), while keeping its tolerance at 0.0. If any of these three later proves flaky, that is the lever — not a reintroduced 0.03. This keeps 0.0 the honest default and the fix from reading as an oversight (the ticket's second acceptance branch).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/run-evals.mjs` (`toleranceFor`, `DEFAULT_POLICY`) | JavaScript (ESM) | The pure tolerance-routing function this change edits |
| `eval/grader.mjs` (`CLOSED_SET_KINDS`, `gradeSplittable`, `gradeChainGap`) | JavaScript (ESM) | Where the binary grade functions and the kind-class sets live; the new named set is co-located here |
| `test/eval-baseline-gate.test.mjs` | JavaScript (node:test) | Existing `toleranceFor` assertions; the new assertions extend this file |

**Scope statement.** This touches only the baseline-gate tolerance policy — the regression call at `diffAgainstBaseline` — not any grade math, fixture, or driver.

## 2. OUT OF SCOPE

- **Changing how the three kinds are graded** — Why excluded: the grade functions already return the correct binary scores; only their tolerance routing is wrong. Extension point: `gradeSplittable` / `gradeChainGap` in `eval/grader.mjs` if grade semantics ever change.
- **Adding these kinds to `CLOSED_SET_KINDS`** — Why excluded: that set drives grade dispatch, and these kinds must keep their synonym-folding branches. Extension point: none — this is a deliberate non-action the spec forecloses.
- **Writing or refreshing baseline rows for these kinds** — Why excluded: that is the frontier sweep's job (FAFF-614), an operator-run paid step. Extension point: `eval/baselines/frontier.json`, rewritten by the FAFF-614 sweep.
- **Reviewing whether the three oracles are correct** — Why excluded: oracle soundness was triaged under FAFF-670. Extension point: `eval/calibration/oracle-triage.json`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Grader class | The family a kind's grade math belongs to for tolerance purposes: closed-set / ordering / free-text. Distinct from which named set drives grade dispatch. |
| Binary set-equality grade | A grade returning score ∈ {0, 1} from exact (synonym-tolerant) set-equality — `gradeSplittable`, `gradeChainGap`. No partial credit. |

**The named set (new, in `eval/grader.mjs`, exported):**

```
BINARY_SETEQ_KINDS : Set<string> = { "splittable", "chain-gap", "resolved-elsewhere" }
  # kinds graded by exact synonym-tolerant set-equality (score 0 or 1) but deliberately
  # NOT in CLOSED_SET_KINDS — they grade via their own folding branches. For tolerance
  # purposes they are the closed-set "any drop is real" class → 0.0.
```

**The routing function (edited, in `eval/run-evals.mjs`):**

```
FUNCTION toleranceFor(kind, tolerances = DEFAULT_POLICY.tolerances) -> number:
  IF CLOSED_SET_KINDS.has(kind)                          -> tolerances.closed_set ?? 0
  IF BINARY_SETEQ_KINDS.has(kind)                        -> tolerances.closed_set ?? 0   # NEW
  IF kind == "ordering" OR kind == "explanatory-order"  -> tolerances.ordering ?? 0
  ELSE                                                    -> tolerances.free_text ?? 0
```

**Design decision — where the new membership lives.** Options: (a) a named exported set in `grader.mjs` beside `CLOSED_SET_KINDS`; (b) an inline literal list inside `toleranceFor`; (c) fold the three into the existing `ordering` special-case line. **Chosen:** (a) — a named `BINARY_SETEQ_KINDS` co-located with `CLOSED_SET_KINDS`, imported into `run-evals.mjs` exactly as `CLOSED_SET_KINDS` already is. It names the grader class, keeps the kind lists in one file, and is directly testable. (b) buries the policy in a function body; (c) is misleading — these are set-equality, not rank-correlation, grades, so routing them through the `ordering` clause would mislabel their class even though the numeric result is identical.

## 4. HOW — Behavior

**Approach.** Add `BINARY_SETEQ_KINDS` to `eval/grader.mjs` next to `CLOSED_SET_KINDS`, exported. Import it into `eval/run-evals.mjs` alongside the existing `CLOSED_SET_KINDS` import. Insert one branch in `toleranceFor` returning the `closed_set` tolerance for members. Update the `toleranceFor` and `DEFAULT_POLICY` comments so the 0.0 choice and the `warn_kinds`-not-slack escape hatch are documented at the definition site.

**Behaviour summary.** After the change, `toleranceFor("splittable")`, `toleranceFor("chain-gap")`, and `toleranceFor("resolved-elsewhere")` each return the `closed_set` tolerance (0.0 under `DEFAULT_POLICY`), so any accuracy or stability drop on these kinds fails the gate instead of being absorbed as a warning up to 0.03.

**Anti-pattern:** adding the three to `CLOSED_SET_KINDS` to get 0.0 for free. Why: that set selects the grade function; these kinds must keep their `gradeSplittable` / `gradeChainGap` branches, so moving them silently changes grade math while the intent was only tolerance.

**Failure modes.**

- **The failure:** the change looks inert because two of the three kinds have no baseline rows yet, so a reviewer might think it does nothing. **How you'd know:** `eval/baselines/frontier.json` currently has no `per_kind` entry for `chain-gap` or `resolved-elsewhere` (verified at spec time); `splittable` is present at accuracy 1.0 / stability 1.0. **What it means:** proceed — the routing is correct by construction and takes effect for `chain-gap` / `resolved-elsewhere` the moment the FAFF-614 sweep writes their rows, and immediately for `splittable`. This is exactly the timing the ticket flags; the decision is a-priori and does not need the sweep to be right.
- **The failure:** tightening `splittable` from 0.03 to 0.0 retroactively fails the committed baseline. **How you'd know:** run the baseline gate against the unchanged `frontier.json`. **What it means:** it does not — `splittable` sits at a perfect 1.0/1.0, so a run matching baseline has zero delta and passes under either tolerance. The tightening only bites a *future* run that actually drops, which is the intended effect.

## 5. SCENARIOS

```
Given the default tolerance policy
When toleranceFor is called for "splittable", "chain-gap", or "resolved-elsewhere"
Then it returns 0.0 (the closed_set tolerance), not 0.03
```

```
Given a synthetic baseline fixture per_kind.splittable = { accuracy: 1.0, stability: 1.0 } (format_adherence unset both sides, so the diffAgainstBaseline formatBad path stays out of it) and the default tolerance policy
When diffAgainstBaseline receives a run with per_kind.splittable = { accuracy: 0.98, stability: 1.0 } (acc_delta −0.02, stab_delta 0)
Then the returned splittable entry has status "failed" and rides in `failed` (not `warned`), because toleranceFor("splittable") is now 0.0 and |−0.02| > 0.0 — whereas under the old 0.03 band the identical run resolved to "warned"
```

- The free-text kinds (`gloss`, `shaping`, `decomposition`) MUST still resolve to 0.03 — the change is additive, not a reclassification of the free-text band.

## 6. DESIGN DECISION RATIONALE

**Should the three binary set-equality kinds sit at 0.0 tolerance, or is the 0.03 slack wanted?**
- *Options:* keep 0.03 (treat them as free-text) / route to 0.0 (treat them as their true set-equality class).
- Keeping 0.03 has no stated justification — the harness's own policy comment says exact set-equality grades carry no generation-variance band, so any drop is real. The slack is an accident of the default `else` branch, not a decision.
- **Chosen:** route all three to 0.0. Their graders return score ∈ {0,1}; a 0.03 tolerance can only hide a partial flip on a grade that cannot be partially right.

**Where does the membership live and how is it expressed?**
- *Options:* named exported set in `grader.mjs` / inline literal in `toleranceFor` / fold into the `ordering` clause.
- **Chosen:** a named `BINARY_SETEQ_KINDS` set in `grader.mjs`, imported into `run-evals.mjs`. Mirrors the existing `CLOSED_SET_KINDS` shape and import, names the class, and is testable. Folding into the `ordering` clause was rejected as mislabelling (set-equality ≠ rank-correlation, even though the number is the same).

**How is future empirical flakiness handled without reintroducing slack?**
- **Chosen:** `warn_kinds`, following the `confidence` precedent — a flaky binary kind is reported-not-failed while its tolerance stays 0.0. Documented in the `toleranceFor` comment so the 0.0 choice does not read as ignoring variance (the ticket's "document why" branch, satisfied in the same edit).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** `gradeSplittable` and `gradeChainGap` return only score ∈ {0, 1} (no partial credit). Validation: read the two functions in `eval/grader.mjs` — both end `score: ok ? 1 : 0`. `resolved-elsewhere` grades through `gradeSplittable` (verified at the `c.kind === "resolved-elsewhere"` dispatch).
- **Assumes:** `run-evals.mjs` already imports named exports from `grader.mjs`. Validation: it imports `CLOSED_SET_KINDS` from `./grader.mjs` today — add `BINARY_SETEQ_KINDS` to the same import.

## 8. DONE — Definition of Done

### From WHY
- [ ] A decision is recorded, with reasoning, that binary set-equality grades sit at 0.0 tolerance — captured in the `toleranceFor` / `DEFAULT_POLICY` comments at the definition site (so it does not read as an oversight).

### From WHAT / HOW
- [ ] `BINARY_SETEQ_KINDS = { "splittable", "chain-gap", "resolved-elsewhere" }` is defined and exported in `eval/grader.mjs`, beside `CLOSED_SET_KINDS`.
- [ ] `run-evals.mjs` imports `BINARY_SETEQ_KINDS` and `toleranceFor` returns the `closed_set` tolerance for its members.
- [ ] The three kinds are NOT added to `CLOSED_SET_KINDS` (grade dispatch unchanged), guarded by an assertion (e.g. `!CLOSED_SET_KINDS.has("splittable")`).
- [ ] The `toleranceFor` comment documents both the 0.0 decision and the `warn_kinds`-not-tolerance escape hatch for future flakiness.

### From SCENARIOS (tests)
- [ ] A test asserts `toleranceFor` resolves each of `splittable`, `chain-gap`, `resolved-elsewhere` to 0.0.
- [ ] The existing free-text assertions (`gloss`, `shaping`, `decomposition` → 0.03) still pass.
- [ ] A `diffAgainstBaseline` test proves the tightened tolerance actually fails the gate, over a **concrete hermetic fixture** (not the committed `frontier.json`): baseline `per_kind.splittable = { accuracy: 1.0, stability: 1.0 }` with `format_adherence` unset on both sides (so the `formatBad` branch stays out of it), run `per_kind.splittable = { accuracy: 0.98, stability: 1.0 }` (acc_delta −0.02, stab_delta 0). Assert the returned `splittable` entry has `status: "failed"` and rides in `failed` (not `warned`). This is the gate-effect half; the isolated `toleranceFor("splittable") === 0` unit assertion stays too. *(Oracle pinned per the 2026-08-06 QA-lens major — a builder cannot satisfy this against a different branch.)*
- [ ] An assertion guards the `!CLOSED_SET_KINDS.has(...)` invariant for the three kinds, so a future edit that moves them into `CLOSED_SET_KINDS` (silently repointing grade math) is caught.
- [ ] An assertion guards that none of the three kinds is in the active `warn_kinds` set (the parallel `!warn_kinds.includes(...)` invariant), so a future edit adding one to `warn_kinds` — which would silently flip its gate result from `failed` back to `warned`, breaking Scenario 2's guarantee — is caught. *(Added per the 2026-08-06 QA-lens minor.)*

**Integration smoke test:**
```
import { toleranceFor } from "eval/run-evals.mjs"
assert toleranceFor("splittable") === 0
assert toleranceFor("chain-gap") === 0
assert toleranceFor("resolved-elsewhere") === 0
assert toleranceFor("gloss") === 0.03   # free-text band unchanged
```

confidence: high
spec-review: approve (human override 2026-08-06 — QA lens `revise` folded in [test oracle pinned + `warn_kinds` guard added]; architectural + infosec could not be independently scored, refuter backends quota-exhausted; low-risk pure-function change, operator-promoted)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery (agile-delivery). Carried forward from the 2026-08-05 prep — design unchanged, so the critique still holds. Does not gate promotion.*

**Right-sized? (principle 4)** — No issues. One coherent unit: a recorded decision plus a one-branch change to `toleranceFor`, a co-located `BINARY_SETEQ_KINDS` set, and tests. Well under the 1–3 day ceiling. It doesn't split — the decision and the routing change are the same act, and all three kinds move for one identical reason. No merge candidate.

**Workstream fit? (principles 1 + 5)** — Worth a look. The container "Skill-behaviour harness" is component-named rather than outcome-named, so there's no single deliverable its tickets converge on. This issue is internally cohesive (eval-gate tolerance work), so the fit is fine at the issue level; the observation is about the boundary, which a human may have set deliberately. Nothing blocking.

**Deps surfaced? (principle 6)** — Surfaced. The issue and spec lean on FAFF-614 ("best resolved after FAFF-614 writes real rows"), currently a non-blocking `relatedTo` edge. The spec argues the stronger position: the decision is a-priori and correct by construction — effective immediately for `splittable`, automatically for the other two once rows land — so FAFF-614 is a timing preference, not a hard prerequisite. The existing `relatedTo` edge is the right encoding; no `blockedBy` warranted.

**Risk profile? (principle 7)** — No issues. A single branch in an existing pure function, mirroring the `CLOSED_SET_KINDS` shape and import already in the file, with direct precedent (`splittable`; `confidence` for the `warn_kinds` escape hatch) and tests. No novel integration, no external dependency. The one surprise — the change looking inert with no baseline rows for two kinds — is already characterised in the spec's failure-modes section.