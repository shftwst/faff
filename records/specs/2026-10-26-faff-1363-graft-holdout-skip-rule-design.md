# FAFF-1363 — Graft decides whether to run the holdout when a spec has nothing for it to judge

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1363.

This spec addresses issue **FAFF-1363 — "Graft decides whether to run the holdout when a spec has nothing for it to judge."** Its audience is the build agent implementing the fix and the human reviewers gating it. It narrows the code-blind holdout's skip rule in `faff-graft/SKILL.md` from "nothing judged AND nothing integration-tier" to "nothing judged", and corrects the merge-floor prose and a stale test comment that assumed the old rule.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff dod classify` (`plugin/skills/faff/bin/lib/admissibility.js:328-332`, FAFF-1291) computes three disjoint counts over a spec's criteria: `judged_count` (every `running-stack` criterion — what the code-blind holdout can actually judge), `integration_count` (criteria routed to the review/merge test floor instead), and `delegated_count` (`integration_count` + prose DONE items resting on the AC checklist). `faff-graft/SKILL.md`'s `holdout_offer` (Step 6) and `holdout_run` (Step 8c) procedures read these counts to decide whether the code-blind holdout should run at all for this build.

**Problem statement.** Today both procedures skip the holdout only when `judged_count == 0 AND integration_count == 0` (SKILL.md:315, :321, :432). FAFF-1360 deliberately routes DONE items checked by a test file or an internal function call to the `integration` tier instead of the holdout, which makes a spec whose only non-prose criteria are `integration`-tier (`judged_count == 0`, `integration_count > 0`) more common. For such a spec the current rule does **not** skip — the holdout still runs, the evaluator is handed zero judgeable criteria, emits `criteria: []`, and `deriveHoldoutAggregate` (`holdout-record.js:309-315`) rolls an empty criteria list up to `needs-human` ("nothing was judged at all" — `faff contract holdout-verdict --describe`). At L4 this blocks merge for a build that has nothing wrong with it — a false-negative "needs human" on a spec the holdout was never going to be able to judge.

**Design principles.**

**One skip condition, not two.** The holdout's only job is to judge `running-stack` (judged) criteria. `integration_count` describes criteria routed *away* from the holdout to a different verifier (the review/merge test floor) — it says nothing about whether the holdout itself has work to do. Requiring it to also be zero is an unrelated second condition bolted onto the real one; dropping it is not a weakening, it is removing a condition that was never doing the job its presence implied.

**No new artifact, no new code path.** The counts already exist and are already correct (FAFF-1291's pinned selftests at `admissibility.js:1112` are untouched). The fix is entirely in how `faff-graft/SKILL.md`'s two procedures *consume* those counts — a prose edit to an existing procedure, not a new CLI surface, marker field, or schema.

**Absence stays absence.** When Step 8c skips, no `holdout.json` is written — exactly as today for every other skip cause (decline, autonomous-not-unattended). The merge floor's existing `resolveHoldoutLeg` (`merge-gate-floor.js:556`) already treats an absent verdict as pass-through regardless of *why* it is absent; this ticket does not add a new reason code or change that mechanism, only widens which specs legitimately produce the absence, and corrects the prose that explained the old, narrower list of causes.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | Markdown (skill prompt) | Step 6 `holdout_offer` (:314-321), Step 8c `holdout_run` (:429-433), Step 10 Holdout gate absent-verdict prose (:666-669) — the three sites to edit |
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript | `judged_count`/`integration_count`/`delegated_count` computation (:328-332) — read-only reference, unchanged |
| `plugin/skills/faff/bin/lib/holdout-record.js` | JavaScript | `deriveHoldoutAggregate` (:309-315) — the "nothing judged → needs-human" rule the holdout hits today when misfired; unchanged |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` | JavaScript | `resolveHoldoutLeg` (:556) — absent-verdict pass-through; unchanged, cited for why no code change is needed there |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | `SKILL_LINE_BASELINE["faff-graft"]` zero-headroom line-count ratchet the SKILL.md edit must not break |
| `test/dod.test.mjs` | JavaScript (node:test) | :256-265 carries a stale comment asserting the OLD behaviour ("an integration-only spec is not skipped by graft") that this ticket's fix makes false |

**Scope statement.** This sits entirely at graft's holdout-decision sites (Step 6, Step 8c, Step 10's absent-verdict prose) plus one stale test comment. It does not touch `faff dod classify`, the holdout evaluator, `deriveHoldoutAggregate`, or the merge floor's holdout-leg resolution.

## 2. OUT OF SCOPE

- **Changing `faff dod classify`'s tier computation** — `judged_count`/`integration_count`/`delegated_count` are already correct per FAFF-1291; this ticket only changes how graft's prose consumes them. **Extension point:** none needed.
- **A new `holdout-offer.json` field or schema change** — the marker already carries `judged_count`/`integration_count`/`delegated_count` for audit; only the invariant comment describing when `decision: skip` fires changes. **Extension point:** none.
- **Changing `resolveHoldoutLeg` / the merge floor's absence handling** — an absent `holdout.json` already passes through regardless of cause; this ticket widens which causes legitimately produce that absence, not the handling itself. **Extension point:** none — this is a hard constraint per FAFF-1263/FAFF-1270's "warn-only before enforcement" posture; the skip must stay structurally indistinguishable from today's existing skip causes at the merge floor.
- **FAFF-1270's evidence-readiness proving runs** — related (cited by the ticket as the other place a skip must "not be mistaken for a missing verdict"), but that ticket's own proving-run machinery is separate backlog; this ticket only ensures the prose it would read is accurate. **Extension point:** FAFF-1270, when built.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `judged_count` | Count of `running-stack`-tier criteria — what the code-blind holdout can judge (`admissibility.js:330`) |
| `integration_count` | Count of `integration`-tier criteria — routed to the review/merge test floor, never the holdout (`admissibility.js:331`) |
| Holdout skip | Graft's `decision: skip` outcome at Step 6, and Step 8c's matching `RETURN` before `holdout_step` runs — no env provisioned, no `holdout.json` written |
| Nothing-to-judge | The new, single skip condition: `judged_count == 0`, independent of `integration_count`'s value |

**No new functions or types.** This ticket edits three prose sites in `faff-graft/SKILL.md` and one code comment in `test/dod.test.mjs` — there is no new interface to declare.

## 4. HOW — Behavior

**The exact edits (all in `plugin/skills/faff-graft/SKILL.md`, word-level, line-count-neutral).**

1. **Step 6 `holdout_offer` pseudocode (line 315).** Change the skip condition's left-hand test and its trailing comment:
   - From: `` IF `faff dod classify --spec <full_spec>` judged_count == 0 AND integration_count == 0 → marker {decision: skip}; RETURN   # nothing judged, nothing integration-tier: no run will fire ``
   - To: `` IF `faff dod classify --spec <full_spec>` judged_count == 0 → marker {decision: skip}; RETURN   # nothing judged (an integration-tier-only spec included): no run will fire ``

2. **Step 6 marker invariant comment (line 321).** Change the stated invariant to match:
   - From: `` Invariants: `judged_count==0 AND integration_count==0 ⇒ skip`; ``
   - To: `` Invariants: `judged_count==0 ⇒ skip` (independent of `integration_count`); ``

3. **Step 8c `holdout_run` pseudocode (line 432) — the SOLE live skip gate.** Same condition change as (1):
   - From: `` IF `faff dod classify --spec <full_spec>` judged_count == 0 AND integration_count == 0: RETURN   # SOLE skip gate — live, never the marker counts (full_spec := faff dod split --view full) ``
   - To: `` IF `faff dod classify --spec <full_spec>` judged_count == 0: RETURN   # SOLE skip gate — live, never the marker counts; an integration-tier-only spec skips too (full_spec := faff dod split --view full) ``

4. **Step 10 Holdout gate absent-verdict prose (line 669).** Correct the stale parenthetical that still lists "nothing judged and no integration-tier criterion" as the skip cause, and make the no-confusion-with-a-missing-verdict property explicit (the ticket's second "to decide" question):
   - From: `` A **missing** verdict is **not** a block — Step 8c did not run (decline / autonomous-not-unattended / nothing judged and no integration-tier criterion), which the floor reads as pass-through; proceed. ``
   - To: `` A **missing** verdict is **not** a block — Step 8c did not run (decline / autonomous-not-unattended / nothing judged — including an integration-tier-only spec), which the floor reads as pass-through exactly as any other legitimate skip, never mistaken for a declined-but-judgeable spec's missing verdict; proceed. ``

**Why these four sites and no others.** Step 6 and Step 8c are the two places the rule is literally stated (Step 8c is the only one that *acts* on it live; Step 6's copy only decides the OFFER marker, which Step 8c's live re-check never trusts — "never the marker counts" is unchanged and still correct). Step 10 does not implement a skip condition — it only *describes*, in prose, the causes of a missing `holdout.json` for a human reader; its code (`resolveHoldoutLeg`) is unchanged and untouched. No other file states or re-derives this rule (`faff-beep-boop/SKILL.md` does not duplicate it).

**Edge cases.**

- **`judged_count == 0`, `integration_count == 0`, `delegated_count == 0`** (an all-delegated/trivial spec) — skipped exactly as before; this case was already covered by the old rule and is unchanged by the fix.
- **`judged_count == 0`, `integration_count > 0`** (the bug this ticket fixes) — now skipped; previously ran and mis-aggregated to `needs-human`.
- **`judged_count > 0`** (any judgeable criterion exists, regardless of `integration_count`) — never skipped, in both the old and new rule. The fix is a pure narrowing of *when a false run happens*, never a new way to skip a spec that genuinely has judgeable work.
- **Step 6 OFFER vs Step 8c RUN disagreement** — structurally impossible to newly introduce: Step 8c already re-reads `faff dod classify` live and ignores the marker's counts ("never the marker counts"), so the two sites' rules must simply read the same condition; this ticket changes both identically, preserving that invariant.

**Failure modes.**

- **The failure:** a future edit changes Step 6's condition without changing Step 8c's (or vice versa), reintroducing drift between the OFFER decision and the live RUN gate. **How you'd know:** `test/faff-1363-holdout-skip-rule.test.mjs` (below) greps both procedure blocks and fails if they diverge. **What it means:** fix the drifted site to match; Step 8c is authoritative (Step 6 is cosmetic/advisory per "never the marker counts").
- **The failure:** the SKILL.md edit changes the file's total line count, which `faff validate-adapters`'s zero-headroom `SKILL_LINE_BASELINE["faff-graft"]` ratchet (`validate-adapters.js:65`) then FAILs on (growth) or RATCHET-warns on (shrink). **How you'd know:** `faff validate-adapters` output. **What it means:** the four edits above are designed to be word-level substitutions within existing lines (no line added or removed); if a future edit of this area adds/removes a line, update `SKILL_LINE_BASELINE["faff-graft"]` in the same PR to the new exact `wc -l`-plus-one count.

**Anti-pattern:** reintroducing the `integration_count == 0` conjunct "to be safe." Why: it is exactly the condition this ticket removes because it describes criteria routed *away from*, not *to*, the holdout — requiring it to be zero has no bearing on whether the holdout has anything to judge, and keeping it is what causes the false `needs-human`.

**Anti-pattern:** having Step 10 (or any other reader) treat an absent `holdout.json` differently depending on *why* it is absent. Why: `resolveHoldoutLeg` is cause-blind by design (pass-through on absence, full stop) — teaching a human reader a cause-sensitive mental model via stale prose, when the code itself is cause-blind, is the exact confusion the ticket's second decision point (FAFF-1263 readiness) warns against.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec whose only non-prose criteria are integration-tier (judged_count 0, integration_count 1)
When faff-graft Step 6 runs holdout_offer
Then the holdout-offer.json marker records decision "skip", and Step 8c's holdout_run also returns without invoking holdout_step
```

```
Given a spec with at least one running-stack (judged) criterion and any integration_count value
When faff-graft Step 8c runs holdout_run
Then holdout_run does not return early on the judged_count/integration_count check (it proceeds to the trigger/freshness checks) — unchanged from today
```

```
Given faff-graft/SKILL.md's committed text
When the holdout_offer and holdout_run procedure blocks are inspected
Then neither contains the string "judged_count == 0 AND integration_count == 0", and both contain a skip condition keyed on judged_count == 0 alone
```

## 6. DESIGN DECISION RATIONALE

**Skip on `judged_count == 0` alone, or keep requiring `integration_count == 0` too?**
- *Keep both* — matches today's literal wording. Con: this is precisely the bug — it was never a deliberate "both must be zero" design, it is an unexamined conjunct that makes an integration-tier-only spec (which FAFF-1360 makes more common) misfire into a false `needs-human`.
- *`judged_count == 0` alone* — matches the ticket's own framing ("Whether graft skips the holdout when `judged_count` is 0 regardless of `integration_count`") and the semantic reality that `integration_count` describes work routed away from the holdout, not work for it.
- **Chosen:** `judged_count == 0` alone — the holdout's only remit is judged criteria; a count of criteria routed elsewhere has no bearing on whether the holdout has anything to do.

**What should the skipped run record?**
- *A new `holdout.json`-shaped "skip record"* — would let a reader distinguish "the holdout ran and found nothing" from "the holdout never ran." Con: no consumer asked for this distinction; `resolveHoldoutLeg` already treats absence as pass-through uniformly and FAFF-1263/1270 (warn-only-before-enforcement) do not require it; adding a new artifact for a distinction nothing reads is unwarranted scope.
- *No new artifact — absence stays absence, exactly as every other skip cause* — the existing `holdout-offer.json` marker (written at Step 6, unaffected by this ticket beyond the invariant comment) already carries `judged_count`/`integration_count`/`delegated_count` for audit, so the "why was it skipped" question is answerable from an existing file without inventing a second one.
- **Chosen:** No new artifact. Absence stays absence; the audit trail already exists in `holdout-offer.json`; only the prose explaining the causes of that absence (Step 10) needed correcting.

**Fix the stale `test/dod.test.mjs` comment, or leave it?**
- *Leave it* — the assertions (`judged_count===0`, `integration_count===1`) remain correct; only the comment's English framing becomes stale.
- *Fix the comment* — a comment asserting "an integration-only spec is not skipped by graft" is a specific, checkable claim about graft's behaviour that this ticket makes false; leaving it would actively mislead a future reader into thinking the old (buggy) behaviour is still current and intentional.
- **Chosen:** Fix the comment (data/assertions unchanged, framing corrected) — a stale comment that makes a false behavioural claim is worse than no comment.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — both ticket-posed decisions are `**Chosen:**` above.

**Assumptions.**

- **Assumes:** `plugin/skills/faff-graft/SKILL.md`'s `SKILL_LINE_BASELINE` entry (`validate-adapters.js:65`, currently 893) is a `text.split("\n").length` count (one more than `wc -l` on a trailing-newline-terminated file), and the four prose edits above are word-level substitutions that add/remove zero lines, so the baseline needs no change. *Validation:* `wc -l plugin/skills/faff-graft/SKILL.md` reads 892 pre-edit (893 lines by split, matching the baseline exactly, zero headroom) and must still read 892 post-edit.

## 8. DONE — Definition of Done

### From WHY / HOW (the fix itself)
- [ ] `faff-graft/SKILL.md` Step 6 `holdout_offer`'s skip condition reads `judged_count == 0` (no `AND integration_count == 0` conjunct).
- [ ] `faff-graft/SKILL.md` Step 6's marker invariant comment reads `judged_count==0 ⇒ skip` (no `AND integration_count==0` conjunct).
- [ ] `faff-graft/SKILL.md` Step 8c `holdout_run`'s skip condition (the SOLE live gate) reads `judged_count == 0` (no `AND integration_count == 0` conjunct).
- [ ] `faff-graft/SKILL.md` Step 10's absent-verdict prose no longer says "nothing judged and no integration-tier criterion"; it names "nothing judged — including an integration-tier-only spec" and states the skip is never mistaken for a missing verdict on a declined-but-judgeable spec.

### From constraints (regression)
- [ ] `faff validate-adapters` passes (no FAIL on `faff-graft`'s line cap; the SKILL_LINE_BASELINE ratchet is unaffected since the edits are line-count-neutral).
- [ ] `faff dod classify`'s computation of `judged_count`/`integration_count`/`delegated_count` is byte-for-byte unchanged (no edits to `admissibility.js`); the FAFF-1291 selftest at `admissibility.js:1112` still passes.

### From tests / hygiene
- [ ] `test/dod.test.mjs:264`'s stale comment ("an integration-only spec is not skipped by graft") is corrected to reflect the new behaviour; its assertions (`judged_count===0`, `integration_count===1`) are unchanged.
- [ ] A new test `test/faff-1363-holdout-skip-rule.test.mjs` asserts, against the live committed `faff-graft/SKILL.md`: (a) the old buggy string `judged_count == 0 AND integration_count == 0` no longer appears anywhere in the file; (b) both the Step 6 and Step 8c procedure blocks contain a `judged_count == 0` skip condition; (c) re-exercises `faff dod classify` on an integration-tier-only fixture to confirm `judged_count === 0` and `integration_count > 0` — the live facts the corrected rule depends on.

**Integration smoke test.**

```
1. grep -c 'judged_count == 0 AND integration_count == 0' plugin/skills/faff-graft/SKILL.md
   -> 0
2. Extract the Step 6 holdout_offer and Step 8c holdout_run fenced blocks; each contains
   a line matching /judged_count == 0/ and neither contains /integration_count == 0/
   on that same line.
3. faff dod classify --spec - --json <<< a spec with one integration-fenced Scenarios
   criterion and no other non-prose criteria
   -> judged_count: 0, integration_count: 1
4. faff validate-adapters
   -> faff-graft: pass (no FAIL line-cap)
```

## Already shipped against this surface

- **FAFF-1291** (Done) — *"The code-blind holdout judges only criteria a machine can check."* Introduced `judged_count`/`integration_count`/`delegated_count` and the `holdout_offer`/`holdout_run` OFFER/RUN split this ticket edits. **Related, not superseding:** FAFF-1291 built the counts and the two-site skip rule as it exists today (with the bug this ticket fixes); it did not anticipate FAFF-1360 making integration-tier-only specs common.
- **FAFF-1342** (Done) — *"holdout.json can carry an optional delegated[] list."* Schema-only PR for `holdout.json`'s `delegated[]` array; unrelated to the skip rule and untouched by this ticket.

confidence: high
build-tier: standard