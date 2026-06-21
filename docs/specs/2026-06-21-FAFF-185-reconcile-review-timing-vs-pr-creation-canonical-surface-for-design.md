# Reconcile review timing vs PR creation — canonical surface for review findings

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-185.

_Revised 2026-06-19 — the open Punt (pre-PR vs PR-first) was resolved to **(a) genuinely pre-PR** by the maintainer; respec to high._

Build spec for **FAFF-185** (build agent + reviewers). Reconciles the three-way disagreement over whether a PR exists when review runs, by committing to **genuinely pre-PR** review with the **tracker** as the single canonical findings surface.

## 1. WHY — Problem and Principles

**Problem statement.** `faffter-noon-review` frames review as pre-PR with findings → tracker; faff-graft Step 9 says "append the review result to **the PR**"; interactive graft never opens a PR before Step 9 while autonomous opens it at sub-step 4 — so the four sites disagree on PR existence at review time and on where findings go. This spec makes all four agree on **review-before-PR, findings-to-tracker, PR-opened-only-after-`pass`**.

**Design principles.**

- **Tracker is the canonical surface.** Per the gateway "Tracker as the lights-out control plane", review + adversarial findings post to the **tracker issue**, not the PR — there is no PR at review time. One surface, both modes.
- **Pre-PR saves CI.** The PR is opened only once review reaches `pass`, so review-fix iterations never burn CI. This is the stated intent of `faffter-noon-review` → "Why pre-PR"; this change honours it rather than retiring it.
- **No mode-specific sequence.** Interactive and autonomous must create the PR at the *same* point (after review `pass`). The current autonomous step-4 PR-open is the thing that drifts; it moves.

**Reference context.**

| System | Lines | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | Step 9 (L198–214), Step 10 (L235), Step 11 (L261–), autonomous flow (L324–325) | Where the PR is opened + where findings are posted |
| `plugin/skills/faffter-noon-review/SKILL.md` | "Why pre-PR" (L20–24) | Already pre-PR/tracker — honoured, lightly reinforced |
| FAFF-184 | — | Comment-count policy on the (now tracker) findings surface — composes |

**Scope statement.** Doc/prose reconciliation across faff-graft + faffter-noon-review — no CLI or code change.

## 2. OUT OF SCOPE

- **Comment-count policy** (append-trail vs collapse) → FAFF-184. This spec fixes *where/when*; 184 fixes *how many*.
- **Adversarial-backend hardening** → FAFF-183.
- **Slot dispatch** → FAFF-182.
- **The review passes / verdict vocabulary** — unchanged; only *timing + surface* move.

## 3. WHAT — the reconciled sequence

**Vocabulary.**

| Term | Meaning |
|---|---|
| pre-PR review | review (+ adversarial) runs against the branch/diff with **no PR open yet** |
| findings surface | the **tracker issue** — where review/adversarial findings + dispositions are posted |
| PR-open point | the single step, both modes, where the PR is created: **immediately after review returns `pass`** |

**Decision — the sequence.** **Chosen:** (a) genuinely pre-PR — review runs before the PR; review + adversarial findings post to the tracker issue; the PR opens only after review reaches `pass`. (Resolved by the maintainer; rejected (b) PR-first, which would drop the CI-saving intent and split findings onto the PR.)

**Decision — review-terminal-before-PR handling.** Because the PR opens only on `pass`, a review `fail` or `needs-human` happens **with no PR in existence**. **Chosen:** review-stage terminal states are tracker-only (no PR): `fail` → iterate (fix → re-review), still pre-PR; review `needs-human` → surface on the tracker as needs-human **without** opening a PR. Only **post-PR** needs-human causes (CI-red, delivery `not-ready`/`failed`) keep their PR. The `pr-open-for-human` return is therefore split by cause (see HOW).

## 4. HOW — Behavior

**The reconciled flow (both modes):**

```
… Step 8 (AC verification)
Step 9  Review phase — runs PRE-PR, against the branch/diff:
        - review + adversarial findings + dispositions → TRACKER ISSUE comment(s)  [was: "append to the PR"]
        - pass        → proceed to PR-open
        - fail        → iterate (fix → re-review), still pre-PR, no PR opened
        - needs-human → surface on tracker as needs-human, NO PR opened
Step 9b OPEN THE PR  (new explicit step, identical both modes) — only reached on review `pass`
Step 10 Merge-confidence gate — unchanged (now always has a PR, opened at 9b)
Step 11 Post-PR checks — unchanged ("after the PR is posted" now always true)
```

**Per-file change list** (verify line refs against live text before editing):

```
faff-graft  plugin/skills/faff-graft/SKILL.md
  - Steps list (L65–72): insert "Step 9b: Open the PR (after review pass)" between Step 9 and Step 10;
    note both modes share it.
  - Step 9 (L214): "Append the review result to the PR as a comment" →
    "Post the review result (and adversarial findings + dispositions) as a comment on the TRACKER ISSUE — no PR exists yet."
  - Step 9 review-signal handling: fail → iterate pre-PR; needs-human → tracker, no PR (see return-token change below).
  - Autonomous flow (L324–325): MOVE "Push the branch and open the PR" OUT of sub-step 4;
    open the PR at the new 9b, only after Step 9 returns `pass`. Sub-step 4 keeps branch push only
    (or defers push to 9b) — pick the minimal edit that leaves no PR before review.
  - Step 11 (L265 "After the PR is posted…"): unchanged in wording; now structurally guaranteed
    because 9b created the PR.
  - Return tokens (L365, L375): a review `needs-human` returns a NO-PR human-handoff
    (e.g. `needs-human` / a no-PR variant), distinct from `pr-open-for-human` (CI-red / delivery
    not-ready|failed), which still has a PR. Keep the ledger bucket mapping valid for runcheck.

faffter-noon-review  plugin/skills/faffter-noon-review/SKILL.md
  - "Why pre-PR" (L20–24): HONOURED — keep. Optionally add one line: the PR is opened by faff-graft
    only after this review returns `pass`, so review-fix iterations never reach CI.
```

**Anti-pattern:** leaving any "append to the PR" phrasing in Step 9. Why: it re-introduces the exact contradiction — there is no PR at Step 9 under (a).

**Anti-pattern:** fixing interactive but leaving autonomous opening the PR at sub-step 4. Why: that recreates the mode-specific divergence the AC forbids. Both modes open at 9b.

**Edge cases.**
- Review iterates `fail`→fix→`pass` several times → all on the tracker, PR opens once at the end (the CI saving).
- Review `needs-human` interactive → tracker needs-human, no PR; the human resolves, then re-enters at 9b on a subsequent `pass`.
- Discovered-scope filing (Step 9) → unchanged (already tracker/Backlog).

## 5. SCENARIOS

```
Given a build reaches the review phase (interactive or autonomous)
When review runs
Then no PR exists yet, and review + adversarial findings are posted to the tracker issue
```
```
Given review returns `pass`
When the flow proceeds
Then the PR is opened at Step 9b — the same point in both modes — and only then
```
```
Given review returns `fail` then `needs-human` across iterations
When those terminal/iteration states are handled
Then no PR is opened for them (fail → iterate pre-PR; review needs-human → tracker, no PR),
     while CI-red / delivery not-ready still operate on the post-`pass` PR
```
```
Given the reconciled prose
When I grep faff-graft for "append the review result to the PR"
Then it is gone, and faffter-noon-review's "Why pre-PR" text is intact (honoured, not retired)
```

## 6. DESIGN DECISION RATIONALE

**Pre-PR (a) vs PR-first (b)?** (b) is less work and matches how the FAFF-181/179 runs happened, but drops the CI-saving intent and splits findings onto the PR. (a) preserves the intent and keeps the tracker canonical. **Chosen:** (a) — maintainer decision at prep.

**What about review `needs-human` with no PR?** Under (a) it can't return `pr-open-for-human` (no PR). **Chosen:** split the human-handoff by cause — review needs-human = no-PR tracker handoff; CI/delivery needs-human = PR-open handoff. Keeps `runcheck` ledger buckets valid.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the sequence decision is resolved.

**Assumptions.**
- **Assumes:** FAFF-184 will define the comment-count policy for the (now tracker) findings surface. *Validation:* land 184 alongside or after this; this spec sets *where/when*, 184 sets *how many*. They compose, neither blocks the other's core change.

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] All four sites agree: review is pre-PR, findings → tracker, PR opens only after review `pass`.
- [ ] faff-graft states the PR-creation point **identically** for interactive and autonomous (no mode-specific ambiguity).

### From HOW
- [ ] Step 9 posts review + adversarial findings to the **tracker issue**; the "append to the PR" wording is gone.
- [ ] A Step 9b "open the PR after review `pass`" exists, shared by both modes; autonomous no longer opens the PR at sub-step 4.
- [ ] Review `fail` iterates pre-PR; review `needs-human` is a no-PR tracker handoff, distinct from the PR-open handoff for CI-red / delivery not-ready/failed; ledger buckets stay valid for `runcheck`.
- [ ] `faffter-noon-review`'s "Why pre-PR / report to tracker" text is honoured (kept), not contradicted.

### From SCENARIOS (verification)
- [ ] grep: no "append the review result to the PR" remains in faff-graft.
- [ ] `faff validate-adapters` + the test suite pass; the judgement-eval baseline re-runs without regression (prose change, FAFF-130/145 gate).

**Integration smoke test:**
```
1. grep -n 'append.*review.*PR' plugin/skills/faff-graft/SKILL.md              → 0 hits
2. grep -n 'open the PR' plugin/skills/faff-graft/SKILL.md                      → present at 9b, both modes; absent before Step 9
3. grep -n 'Why pre-PR' plugin/skills/faffter-noon-review/SKILL.md             → still present
4. node --test test/ && faff validate-adapters                                 → green
```

confidence: high
