# FAFF-3: Merge gate must distinguish "CI ran green" from "no CI present"

This spec addresses FAFF-3 for the build agent who edits the faff prose contracts, and for the human reviewers who gate that edit. The artifact is a prose-contract change across two SKILL.md files — the gateway integrity-floor wording and faff-graft's Step 10 merge gate plus its CI-wait guidance. faff's "code" here is prose (verified: no `faff contract` CLI script governs the integrity floor — `grep -i integrity\|floor\|merge.gate` over `skills/faff/bin/faff` returns only the authoring-adaptor lint string, not a gate function), so the deliverable is precise contract wording, not a code function.

## 1. WHY — Problem and Principles

**Problem statement.** faff-graft Step 10's merge-confidence gate requires three conditions to merge — every AC auto-verified, CI green, review `pass` — but when a PR has zero applicable checks (`gh pr checks` reports none for workflow/config/docs-only diffs, or a repo with no CI on the changed paths), condition #2 is satisfied *vacuously*: absent CI reads as green, and the gate rubber-stamps a change whose correctness was never validated pre-merge. This bit FAFF-1 (release-please adoption): a workflow/config deliverable with no PR-triggered CI passed the gate, then failed twice post-merge (missing `workflow` OAuth scope; org policy blocking Actions-created PRs).

**Design principle — the gate is the safety net the gateway already leans on; it must actually hold.** The gateway (`skills/faff/SKILL.md` ~line 481) explicitly forbids pre-parking workflow/CI/config edits, justifying it with "these all land via PR; the PR review is the gate" and (~line 475) "the review + merge-confidence gate already catches mistakes." FAFF-3 is the case where that promise is hollow: for exactly those diffs, the gate's CI-green leg is vacuous. The fix therefore belongs **at the gate (post-PR)**, strengthening the net — **not** as a new pre-park category, which would contradict the gateway's standing rule. Any implementation that re-introduces a pre-PR park on "touches CI/workflow" is wrong.

**Design principle — absent is a third state, not a green.** "CI ran and is green", "CI ran and is red", and "no CI applies to this diff" are three distinct signals. The defect is collapsing the third into the first. The fix is to name the third explicitly and route it deliberately, never silently.

**Design principle — deterministic detection over inference.** Whether a PR has zero applicable checks is a mechanical fact `gh pr checks` reports (it exits non-zero with "no checks reported on the … branch" when the set is empty). The gate must branch on that observed emptiness, not on a narrated guess about whether CI "should" exist.

**Reference context.**

| System | Form | Relevance |
|---|---|---|
| `skills/faff/SKILL.md` (~745) | Prose contract | The FIXED integrity-floor wording "AC-verified + CI-green + review `pass`"; "CI-green" is the load-bearing phrase the defect exploits. Non-delegable. |
| `skills/faff-graft/SKILL.md` (Step 10, ~226-245) | Prose contract | The assertion site: the three conditions, the "CI failed" branch (~243), the autonomous flow (~302). |
| `skills/faff-graft/SKILL.md` ("How to actually wait for CI", ~259-275) | Prose guidance | Where `gh pr checks --watch` reads empty-as-terminal-green today. |
| `skills/faff/SKILL.md` (~481) | Prose contract | "Workflow/CI edits are not a valid pre-park — the PR review is the gate." The constraint the fix must honour. |

**Scope statement.** This change sits inside faff's fixed delivery contract: it sharpens condition #2 of the integrity floor and the graft step that asserts it. It does not touch the `ship` producer, the `ship_adaptor`, or the three-outcome delivery vocabulary.

## 2. OUT OF SCOPE

- **A `faff contract merge-gate` CLI script** — what's excluded: building a deterministic contract script for the integrity floor (as exists for spec-readiness/review-verdict/delivery-outcome/automation-routing). Why excluded: the integrity floor is asserted in graft prose and has no adaptor slot; introducing a fifth contract + schema is a larger architectural move than FAFF-3 needs, and the empty-checks fact is already deterministic via `gh`. Extension point: a future issue could add `skills/faff/contracts/integrity-floor.schema.json` + a `CONTRACTS["integrity-floor"]` entry in `skills/faff/bin/faff`.

- **FAFF-4 (ship-precondition checks)** — what's excluded: a new delivery *outcome* or precondition tier in the gateway's delivery-outcome contract (~737-749). Why excluded: FAFF-4 owns the delivery-outcome vocabulary; FAFF-3 owns condition #2 of the integrity floor that runs *before* delivery is invoked. Extension point: FAFF-4 edits the `ship_adaptor`/delivery-outcome section; FAFF-3 stays in the integrity-floor + Step 10 prose. The two must not both edit the delivery-outcome vocabulary — see the Anti-pattern in HOW.

- **Auto-authoring CI for repos that lack it** — what's excluded: having the gate generate a workflow when none exists. Why excluded: that's a product feature, not a gate fix, and would itself be an unreviewed change. Extension point: a future "scaffold-ci" prep/jot capability.

- **Changing the `--watch`/poll loop mechanics** — what's excluded: how graft *waits* for non-empty CI to finish. Why excluded: the wait loop is correct for the non-empty case; only the empty-set classification is wrong. The CI-wait section gains one branch (empty-set), not a rewrite.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| applicable checks | The set of CI checks `gh pr checks <pr>` reports for the PR head. Empty when no workflow is triggered by this PR / matches the changed paths. |
| no-CI-coverage | The distinct signal raised when the applicable-checks set is observed empty at the gate. The third state, not a synonym for green. |
| CI-green | Reserved (post-fix) for "≥1 applicable check ran and all reached a passing terminal state". No longer satisfiable vacuously. |
| post-merge-only validation | A diff whose correctness can only be exercised by a push/merge-triggered workflow (e.g. `on: push` to default branch). The gate cannot prove these pre-merge by construction. |

**The CI condition, restated (the load-bearing change).** Condition #2 of the integrity floor splits its outcomes into three, evaluated against the observed applicable-checks set:

```
ENUM CiGateResult:
  ci-green          # >=1 applicable check, all passing-terminal  -> condition #2 SATISFIED
  ci-red            # >=1 applicable check, >=1 failing-terminal   -> condition #2 FAILED (existing "CI failed" branch)
  no-ci-coverage    # applicable-checks set is empty               -> condition #2 NOT satisfiable; route per HOW
```

**Design decision — how `no-ci-coverage` routes.** Two options:

- **(a) Hard `needs-human` always** — any zero-check PR escalates to a human in every mode. Pro: maximally safe, one rule. Con: in interactive mode a human is already present at the "merge now?" prompt, so a hard escalation is redundant friction; it also punishes legitimately CI-less repos uniformly with no path to proceed.
- **(b) A distinct `no-ci-coverage` state that surfaces LOUDLY and routes by mode** — autonomous: do not merge, park as `needs-human` (the human is absent, the net is provably down, so default to not-having-merged — mirroring the delivery-outcome and review-verdict fail-safe direction); interactive: surface the absence loudly at the gate and require an explicit confirm before merge (the human present *is* the gate). Pro: names the third state once, honours the mode asymmetry already pervasive in faff, never silently passes. Con: two code paths instead of one.

**Chosen:** (b) — a distinct `no-ci-coverage` state that surfaces loudly and routes by mode (autonomous → park `needs-human`; interactive → explicit confirm). It is the most defensible: it never lets absent-CI pass silently (the whole defect), it fails safe toward not-having-merged in autonomous mode exactly as the review-verdict ("malformed → `needs-human`, never `pass`") and delivery-outcome ("unmappable → `failed`, never `shipped`") contracts already do, and it respects that interactive mode already has the human the gate would otherwise summon. Option (a)'s redundant interactive escalation buys no extra safety over an explicit confirm.

**Design decision — post-merge-only validation (push-triggered workflows).** Some diffs (a new `on: push` workflow, a release pipeline) genuinely cannot be validated pre-merge — there is no PR-triggered check to run, and the real check only fires after the merge lands. This is a strict sub-case of `no-ci-coverage` (the applicable-checks set is empty *because* validation is deferred by design). The gate cannot prove these and must say so rather than imply it validated them.

**Chosen:** treat post-merge-only validation as `no-ci-coverage` with an explicit reason annotation (`no-ci-coverage: validation is post-merge-only`), routed by the same mode rule above — it does **not** get its own merge-eligible fast-path. Rationale: the gate's contract is pre-merge validation; a change it cannot validate pre-merge is precisely what a human should bless (autonomous: park; interactive: confirm). The annotation makes the surfaced message honest ("this can only be checked after merge") instead of silent. Carving a separate auto-merge lane for push-triggered diffs would re-open the FAFF-1 hole (release-please was exactly this shape).

## 4. HOW — Behavior

**Architecture.** Two prose edits, one mechanical detection seam:

1. **Gateway integrity-floor wording** (`skills/faff/SKILL.md` ~745): the FIXED floor currently reads "AC-verified + CI-green + review `pass`". It must be reworded so "CI-green" cannot be read as satisfied by absence — naming `no-ci-coverage` as a distinct, non-passing state of condition #2. This edit is necessary because the floor is the canonical definition; leaving it as bare "CI-green" lets a future reader re-collapse absent into green. The floor stays **non-delegable** — this reword tightens it, it does not move it into the `ship` producer/adaptor.

2. **faff-graft Step 10** (`skills/faff-graft/SKILL.md` ~226-245 and the autonomous flow ~302): condition #2's evaluation gains the three-way `CiGateResult` and the routing branch. The existing "CI failed" branch (~243) handles `ci-red` unchanged.

3. **The CI-wait guidance** (~259-275): the empty-set detection lands here, because this is where `gh pr checks` is observed.

**Detecting the empty set (the mechanical seam).**

```
PROCEDURE evaluate_ci_condition(pr):
  1. Run the CI wait to a terminal state (existing `gh pr checks <pr> --watch` / poll loop).
  2. Read the applicable-checks set with `gh pr checks <pr>`.
     - gh exits non-zero with "no checks reported on the … branch" AND prints no check rows
       => applicable-checks set is EMPTY => return no-ci-coverage
       (distinguish this from a real failure: empty-set has zero rows; ci-red has >=1 failing row)
  3. IF >=1 row AND all rows passing-terminal: return ci-green
  4. IF >=1 row AND >=1 failing-terminal:    return ci-red
```

**Anti-pattern:** treating `gh pr checks` non-zero exit as `ci-red`. Why: a non-zero exit covers *both* "checks failed" and "no checks exist". The branch must read the row count, not the exit code alone — zero rows is `no-ci-coverage`, failing rows is `ci-red`. Conflating them would either mask the absence (back to the defect) or wrongly route legitimate-CI-less repos into the failure-iterate loop.

**Routing `no-ci-coverage` at the gate.**

```
PROCEDURE gate_on_no_ci_coverage(pr, mode, reason?):   # reason = "validation is post-merge-only" when detected
  1. Compose a LOUD gate message naming the third state explicitly:
     "No applicable CI ran on this PR (zero checks). CI-green could not be established;
      it was NOT validated pre-merge[. <reason, if present>]"
  2. IF mode == autonomous:
       a. Do NOT merge. Do NOT hand off to the ship producer.
       b. Park as needs-human (shared park protocol): leave PR open + non-draft? -> flip to draft per the park protocol,
          attach the AC checklist, review comment, and the no-ci-coverage reason.
       c. Return pr-open-for-human (the existing autonomous return for a parked gate).
       d. Log the no-ci-coverage decision to the run dir so /faff-wtf surfaces it as a park reason.
  3. IF mode == interactive:
       a. Surface the loud message at the Step 11 gate.
       b. Require an EXPLICIT confirm distinct from the normal "merge now?":
          yes/no "No CI validated this PR pre-merge[ — <reason>]. Merge anyway on your own judgement? (y/n)".
       c. On confirm -> proceed to ship handoff (the human is the gate). On deny -> leave PR open.
```

**Behavior summary.** When the gate observes zero applicable checks, it never treats that as green: it names the gap loudly, then in autonomous mode parks for a human and in interactive mode asks the present human to bless the merge explicitly. `ci-green` (≥1 passing check) and `ci-red` (≥1 failing check) behave exactly as today.

**Edge cases.**
- **Mixed set with some skipped checks** — if ≥1 check ran to a passing terminal and the rest are `skipped`/`neutral`, that is `ci-green` (CI ran and is green), not `no-ci-coverage`. `no-ci-coverage` requires the set to be genuinely empty.
- **Checks still pending at gate time** — unchanged: the wait loop (step 1) blocks until terminal; emptiness is only evaluated after the wait resolves, so "pending" never reads as empty.
- **Concurrent execution rebase** — the existing `faffter-dark-concurrency-parallel` rule re-confirms CI-green on the rebased head. After this change, a rebase that yields an empty set is `no-ci-coverage`, not a stale-green pass — the same routing applies.
- **Flaky/infra re-run** — the existing "re-run once" path (~243) is for `ci-red`; it does not apply to `no-ci-coverage` (there is nothing to re-run).

**Anti-pattern:** editing the gateway's delivery-outcome vocabulary (~737-749) to add a "no-ci" outcome. Why: that is FAFF-4's surface, and `no-ci-coverage` is an integrity-floor (pre-delivery) concept, not a delivery outcome. FAFF-3 must confine its gateway edit to the integrity-floor wording (~745).

**Anti-pattern:** adding a pre-PR park for "touches CI/workflow files". Why: the gateway (~481) forbids it and the whole point of FAFF-3 is to make the post-PR gate trustworthy so pre-parking stays unnecessary.

## 5. DESIGN DECISION RATIONALE

**How should absent CI route?** Options (a) hard `needs-human` always vs (b) a distinct `no-ci-coverage` state routed by mode. (a) is simpler but redundantly escalates in interactive mode where a human is already at the prompt, and offers CI-less repos no proceed path; (b) names the third state once, fails safe in autonomous mode toward not-having-merged (consistent with the review-verdict and delivery-outcome coercion direction), and lets the present interactive human bless explicitly. **Chosen:** (b) — distinct `no-ci-coverage`, autonomous → park `needs-human`, interactive → explicit confirm.

**Does the fix touch the FIXED gateway integrity-floor wording?** It must: "CI-green" is *defined* there (~745), and that bare phrase is what the defect re-reads as green. **Chosen:** reword the floor to name `no-ci-coverage` as a distinct non-passing state of condition #2, keeping the floor non-delegable — plus the Step 10 assertion and the CI-wait guidance edits.

**How is post-merge-only validation handled?** It is a sub-case of an empty check set, not a separate merge-eligible lane. **Chosen:** fold it into `no-ci-coverage` with a `validation is post-merge-only` reason annotation, routed identically — giving it its own auto-merge path would re-open the FAFF-1 hole.

**Why detect emptiness by row count, not gh exit code?** `gh pr checks` exits non-zero for both failure and absence; only the row count separates them. **Chosen:** branch on observed rows (zero rows ⇒ `no-ci-coverage`; failing rows ⇒ `ci-red`).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. All decisions are closed above.

**Assumptions.**

- **Assumes** `gh pr checks <pr>` reports an empty/zero-row result (and a "no checks reported" message) for PRs with no applicable checks, distinguishably from a failing-check result. Validation: before editing, run `gh pr checks` against a known zero-check PR (or read `gh pr checks --help`) and confirm the empty case is distinguishable from the failing case by row presence. If gh's behaviour differs, adjust the detection seam in HOW to match the actual empty-set signal (e.g. `gh pr checks <pr> --json` returning `[]`).
- **Assumes** the gateway integrity-floor wording at `skills/faff/SKILL.md` ~745 and the Step 10 / CI-wait prose at `skills/faff-graft/SKILL.md` ~226-275 are the only assertion sites of condition #2. Validation: `grep -n "CI.green\|CI is green\|integrity floor" skills/faff/SKILL.md skills/faff-graft/SKILL.md` before editing; reword every match consistently so no site still reads absent-as-green.

## 7. DONE — Definition of Done

### From WHY
- [ ] A PR with zero applicable checks does **not** pass the merge gate silently (the FAFF-1 failure mode is closed).
- [ ] The fix is implemented at the post-PR gate, not as a new pre-PR park category (the gateway ~481 rule is not contradicted; no "touches CI/workflow ⇒ park" path is added).

### From WHAT (types and the routing decision)
- [ ] Condition #2 evaluates to one of three results — `ci-green` / `ci-red` / `no-ci-coverage` — with `no-ci-coverage` defined as the empty applicable-checks set.
- [ ] "CI-green" is defined (in the reworded floor) as "≥1 applicable check ran and all passed", and is no longer satisfiable by an empty set.
- [ ] `no-ci-coverage` routes per the **Chosen** rule: autonomous → park `needs-human` (return `pr-open-for-human`); interactive → explicit confirm distinct from the normal merge prompt.
- [ ] Post-merge-only validation is handled as `no-ci-coverage` with a `validation is post-merge-only` reason annotation, with no separate merge-eligible fast-path.

### From HOW (behaviour)
- [ ] The gate emits a distinct, LOUD no-CI signal (a message that explicitly states CI-green could not be established and the diff was not validated pre-merge).
- [ ] In autonomous mode, a zero-check PR is parked `needs-human` and surfaced in `/faff-wtf` with the no-ci-coverage reason; it is not merged.
- [ ] In interactive mode, a zero-check PR requires an explicit "merge anyway on your own judgement?" confirm before the ship handoff.
- [ ] The gateway integrity-floor wording (~745) distinguishes "CI ran green" from "no CI present" and keeps the floor non-delegable.
- [ ] faff-graft Step 10 and the "How to actually wait for CI" section reflect the three-way result; the existing `ci-red` (CI failed) and flaky-re-run branches are unchanged for the non-empty case.

### From HOW (edge cases)
- [ ] Empty-set detection branches on observed check rows, not on `gh pr checks` exit code alone (zero rows ⇒ `no-ci-coverage`; ≥1 failing row ⇒ `ci-red`).
- [ ] A set with ≥1 passing check plus skipped/neutral checks is `ci-green`, not `no-ci-coverage`.
- [ ] Pending checks are resolved by the wait loop before emptiness is evaluated (pending never reads as empty).
- [ ] Under concurrent execution, a rebased head that yields an empty set is `no-ci-coverage`, not a stale-green pass.

### From OUT OF SCOPE (collision guard)
- [ ] No `faff contract` CLI script / schema is added for the integrity floor.
- [ ] The gateway delivery-outcome vocabulary (~737-749) is **not** edited (that is FAFF-4's surface); FAFF-3's only gateway edit is the integrity-floor wording.

**Integration smoke test.**
```
GIVEN an autonomous build whose diff is .github/workflows/*.yml only (no PR-triggered CI)
WHEN faff-graft reaches the Step 10 merge gate and runs evaluate_ci_condition(pr)
THEN gh pr checks reports zero rows -> result is no-ci-coverage
AND the gate does NOT hand off to the ship producer
AND the issue is parked needs-human with a no-ci-coverage reason visible to /faff-wtf
AND re-running the same scenario in interactive mode surfaces the explicit "merge anyway?" confirm instead of auto-merging.
```

confidence: high

