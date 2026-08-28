# Narrow, audited `--accept-review-unavailable` merge disposition

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high · build-tier: complex · spec-review: approve. Full spec on Linear FAFF-912.

This spec defines a narrow operator merge disposition for FAFF-912. It is written for the build agent implementing it and for the human reviewers gating the change. It adds a scalpel beside the existing `--human-override` hammer at the merge floor.

## 1. WHY — Problem and Principles

**The load-bearing model.** The merge floor already distinguishes a review verdict of `pass` / `fail` / `needs-human` / `unavailable` / `missing` (`decideFloor` in `contract-defs.js`). But the *only* operator escape from a merge-floor refusal — `faff merge-gate --human-override` — collapses that distinction: it overrides **every** unmet leg at once (CI, AC, merge-floor, review) and records the merge as a blanket override. This change adds a second, narrower escape that keys specifically on `review_verdict == "unavailable"` and leaves every other leg fully enforced.

**Problem statement.** A graft can build clean — CI green, ACs verified, structural review clean — yet be blocked solely because the adversarial Phase-2 review produced no verdict at all (`signal: unavailable`, a durable backend outage, not a code finding — see FAFF-855 / FAFF-872 / FAFF-911). The operator, having reviewed and wishing to accept the review *outage* specifically, has no first-class path: `faff-graft`'s `unavailable` disposition retries/parks, and `--human-override` overrides all blockers. This change adds a precise, audited, TTY-fenced disposition that excuses only the review-unavailable leg.

**Design principles.**

- **Narrow by construction, not by prose.** The disposition must be structurally incapable of excusing anything other than a review-unavailable leg. Narrowness is computed by re-deciding the floor with the review leg treated as `pass` and requiring the remaining blocker set to be empty — never by a prose "intended only for" caveat, and never by string-matching the blockers array.
- **Same human fence as the broad override.** This is still a human overriding a floor leg, so it keeps the full `--human-override` fence unweakened: a real TTY, the declarative `--interactive` pairing, and a required non-empty reason.
- **Audit legibility.** A narrow accept must be distinguishable in the persisted record from a blanket override, so `faff audit` and any override classifier never conflate the two.
- **The pure floor core stays provenance-blind and unchanged.** `decideFloor` is not modified. Narrowing is a shell-level decision keyed on `decideFloor`'s own output.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | `fenceHumanFlags`, `cmdMergeGate` (PR path), `cmdMergeGateLocal`; the refuse branch that writes `merge-gate-override.json` |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (Node) | `decideFloor` (the pure floor authority), `FLOOR_REVIEW_VERDICTS` |
| `plugin/skills/faff/bin/lib/audit.js` | JavaScript (Node) | `accountHumanMerge` — reads `merge-gate-override.json`, reconciles the merge; `source` is provenance it passes through |
| `test/merge-gate.test.mjs` | JavaScript (Node test) | selftest tables, CLI arg-validation, fence tests |

**Scope statement.** This lives entirely inside `faff merge-gate` — the sanctioned merge interlock — and touches the audit reader that reconciles override records.

## 2. OUT OF SCOPE

- **A general `--override-legs <leg>` leg-scoping mechanism.** The ticket floats this as an alternative framing. Excluded: a named leg vocabulary plus its validation is a larger design than the single most-needed disposition. Extension point: `fenceHumanFlags` plus the refuse branch in `cmdMergeGate` / `cmdMergeGateLocal` — a future leg-scoping flag generalises the same two seams this change touches.
- **Fixing the adversarial-review outage root cause.** FAFF-855 / FAFF-872 / FAFF-911 remove the causes of `review == unavailable`. Excluded: orthogonal — this accepts the outage, it does not prevent it. Extension point: the adversarial review transport, not the merge gate.
- **Auto-accepting review-unavailable in autonomous mode.** Excluded: this disposition is human-only by fence, exactly like `--human-override`. Autonomous `unavailable` stays retry/park (the existing `faff-graft` disposition). Extension point: none in this change — autonomous acceptance would be a separate, deliberately-gated decision.
- **Modifying `decideFloor` or the review-verdict contract.** Excluded: the pure core stays unchanged; narrowing is a shell-level composition over its output.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| review outage | A review verdict of `unavailable` — no verdict could be produced (a backend outage), as distinct from `fail` (an adverse finding), `needs-human`, or `missing` (no verdict artifact at all) |
| narrow accept | Excusing only the review-unavailable leg while every other floor leg is enforced |
| blanket override | The existing `--human-override`, which excuses every unmet leg at once |

**New flag.** `--accept-review-unavailable` (arity 0) added to `MERGE_GATE_SPEC.flags`. It reuses the existing `--override-reason` (arity 1) and `--interactive` flags — no new reason flag.

**Fence input extension.** `fenceHumanFlags(i)` gains an input field `accept_review_unavailable`. It is fenced by the same three checks the blanket override already carries, plus one mutual-exclusion check:

```
FUNCTION fenceHumanFlags(i):
  # existing --human-override / --allow-no-ci checks unchanged
  IF i.accept_review_unavailable AND NOT i.stdin_is_tty:
    violation "--accept-review-unavailable is human-only: stdin is not a TTY — run this merge-gate command yourself in a real terminal"
  IF i.accept_review_unavailable AND NOT i.interactive:
    violation "--accept-review-unavailable requires --interactive"
  IF i.accept_review_unavailable AND empty(i.override_reason):
    violation '--accept-review-unavailable requires --override-reason "<what merged + why the review outage is acceptable>"'
  IF i.human_override AND i.accept_review_unavailable:
    violation "--human-override and --accept-review-unavailable are mutually exclusive — choose the blanket override or the narrow review-unavailable accept"
```

**Narrowness predicate (pure).**

```
FUNCTION narrowReviewUnavailableExcusable(floor) -> Boolean:
  # true iff the ONLY thing keeping the floor from merge-ok is the review-unavailable leg
  RETURN floor.review_verdict === "unavailable"
     AND decideFloor({ ...floor, review_verdict: "pass" }).blockers.length === 0
```

**Override record shape (narrow accept).** Written to the same per-issue `merge-gate-override.json`, with a distinct `source`:

```
RECORD merge-gate-override.json (narrow accept):
  pr: Number            # PR path only; absent on --local
  issue: String
  head_sha: String
  blockers: [String]    # the leg(s) present at refusal — the single review-unavailable blocker
  overridden_at: ISO-8601
  reason: String        # the fenced non-empty --override-reason
  source: "review-unavailable-accept"   # vs "human-override" for the blanket override
```

**Design decisions.**

- **Chosen:** a dedicated boolean flag `--accept-review-unavailable`, not a `--override-legs review-unavailable` value flag. Rationale: a single named disposition is discoverable and self-documenting, needs no leg-name vocabulary or validation, and defers the general mechanism (see OUT OF SCOPE).
- **Chosen:** narrowness is computed structurally, by re-deciding the floor with the review leg treated as pass and requiring zero remaining blockers — not by inspecting the blockers array textually. Rationale: reuses `decideFloor` as the single floor authority and is immune to blocker-string drift.
- **Chosen:** strictly `review_verdict === "unavailable"` qualifies; `fail`, `needs-human`, and `missing` all refuse. Rationale: the disposition accepts a review *outage*, never an absent or adverse review.
- **Chosen:** `--accept-review-unavailable` and `--human-override` are mutually exclusive; passing both is a fail-loud caller error (exit 2). Rationale: the two produce different audit records at different scopes; passing both is ambiguous, so refuse loudly rather than silently pick a precedence.
- **Chosen:** the narrow accept records a distinct `source: "review-unavailable-accept"`; `accountHumanMerge` reconciles it through the unchanged reason + declare + landing logic and passes `source` through so audit rendering can name it. Rationale: reconciliation is identical to a blanket override; only provenance and legibility differ.
- **Assumes:** the graft build persisted `review-verdict.json`, so `readReviewVerdict` yields `unavailable` for a genuine outage. Validation: the build agent confirms `readReviewVerdict` returns the persisted signal; if it reads `missing` (no artifact), the predicate correctly fails and the gate refuses — there is no outage to accept.

## 4. HOW — Behavior

**Architecture and approach.** The change adds one new arm to the existing `verdict === "refuse"` branch, in both merge paths (`cmdMergeGate` PR path and `cmdMergeGateLocal`). The fence runs first, exactly where `fenceHumanFlags` already runs, so a non-TTY, non-`--interactive`, empty-reason, or both-flags invocation exits 2 before the refuse branch is reached.

**The refuse branch, extended.** The narrow arm is evaluated ahead of the blanket-override arm; the two are mutually exclusive by fence, so ordering only decides which branch a single-flag invocation takes.

```
PROCEDURE refuse_branch(floor, verdict, blockers, interactive, humanOverride, acceptReviewUnavailable, overrideReason):
  1. IF verdict != "refuse": no override arm runs (normal merge or check-only path).
  2. IF interactive AND acceptReviewUnavailable:
     a. IF narrowReviewUnavailableExcusable(floor):
        - write merge-gate-override.json { ...ids, head_sha, blockers, overridden_at: now,
          reason: overrideReason, source: "review-unavailable-accept" }
        - fall through to execute — the recorded narrow accept REPLACES the refusal.
     b. ELSE (review is not unavailable, or another leg is unmet):
        - REFUSE (exit 1). Message: "--accept-review-unavailable only excuses a review-unavailable
          outage; this floor is unmet for other reasons: <blockers>." Do NOT fall through.
          Do NOT escalate to a blanket override.
  3. ELSE IF interactive AND humanOverride: <existing blanket-override arm, unchanged — source "human-override">
  4. ELSE: <existing refuse + non-graft remedy, unchanged>
```

**Behavior summary.** When the operator asks to accept a review outage and the floor's only unmet leg is exactly that outage, the merge lands with a distinctly-sourced override record. When any other leg is also unmet — or the review is `fail` / `needs-human` / `missing` rather than an outage — the gate refuses without merging and without widening the operator's intent into a blanket override.

**Edge cases and error handling.**

- Review `pass`, all legs green → `verdict != "refuse"` → the flag is inert; the merge proceeds normally.
- Review `unavailable`, CI red (or AC unverified, or head-sha drift) → predicate false → refuse (exit 1) naming the non-review blocker.
- Review `fail` or `needs-human` → predicate false (`review_verdict != "unavailable"`) → refuse (exit 1); the flag never merges an adverse review.
- L4, review `unavailable`, holdout blocked/missing → predicate false → refuse (exit 1) naming the holdout leg; never merges.
- `--accept-review-unavailable` and `--human-override` both passed → fence exit 2 (mutual exclusion), before any merge decision.
- `--accept-review-unavailable` without `--interactive`, or non-TTY stdin, or empty/absent `--override-reason` → fence exit 2, naming the failing fence.

**Anti-pattern:** excusing the leg by string-matching the `blockers` array for the review text. Why: blocker strings drift; re-decide the floor with `review_verdict: "pass"` and require zero blockers instead.

**Anti-pattern:** falling through to the blanket-override write when the narrow predicate fails. Why: that silently widens the operator's intent from "accept the outage" to "override everything" — the exact conflation this change removes.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refused merge whose only unmet leg is review_verdict == "unavailable"
  (CI green, ACs verified, head-sha matches, and at L4 holdout meets-spec)
When the operator runs `faff merge-gate ... --accept-review-unavailable --interactive
  --override-reason "clean graft; adversarial backend outage"` at a real terminal
Then the merge lands, and merge-gate-override.json records
  source == "review-unavailable-accept", the single review-unavailable blocker, and the reason
```

```
Given a refused merge whose review verdict is "fail"
When --accept-review-unavailable is passed at a TTY with --interactive and a reason
Then the gate refuses (exit 1) without merging, and writes no override record
```

```
Given a refused merge with review "unavailable" but CI red
When --accept-review-unavailable is passed at a TTY with --interactive and a reason
Then the gate refuses (exit 1) without merging, naming the CI leg
```

```
Given --accept-review-unavailable AND --human-override both passed
When merge-gate runs
Then it fails loud (exit 2) naming the mutual-exclusion violation, before any merge decision
```

```
Given --accept-review-unavailable passed without --interactive (or with non-TTY stdin, or an empty reason)
When merge-gate runs
Then it fails loud (exit 2) naming the failing fence
```

## 6. Design Decision Rationale

**A dedicated flag, or a general `--override-legs` value flag?** Options: (a) `--accept-review-unavailable` boolean; (b) `--override-legs review-unavailable` with a leg vocabulary. **Chosen:** (a) — the single named disposition is discoverable and needs no leg-name parsing/validation; the general mechanism is deferred (OUT OF SCOPE) rather than half-built.

**How is "narrow" enforced?** Options: (a) string-match the blockers array; (b) re-decide the floor with the review leg treated as pass and require zero remaining blockers. **Chosen:** (b) — `decideFloor` is the single floor authority, and re-deciding is immune to blocker-string drift; string-matching couples the gate to prose.

**Which review verdicts qualify?** Options: (a) only `unavailable`; (b) `unavailable` and `missing`. **Chosen:** (a) — the disposition accepts an *outage*; `missing` means no verdict artifact was produced at all (a different, more suspect situation), and `fail` / `needs-human` are adverse findings that must never be excused by this narrow path.

**Both flags at once?** Options: (a) precedence (one wins); (b) mutual exclusion, fail loud. **Chosen:** (b) — the two write different audit records; picking a silent precedence would let an operator's ambiguous invocation land an unexpected scope. Fail loud (exit 2), consistent with the gate's existing bad-invocation posture.

**How does audit tell them apart?** The override record's `source` field already exists for the blanket override (`"human-override"`). **Chosen:** a distinct `source: "review-unavailable-accept"`; `accountHumanMerge` keeps its reconciliation (reason + declare + landing) unchanged and passes `source` through so `faff audit` can name a narrow outage-accept distinctly. At the time of writing, `accountHumanMerge` does not branch on `source`; this change makes it available to the renderer without changing the accounted/unaccounted decision.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision above carries a `**Chosen:**` marker.

**Assumptions.**

- **Assumes:** the graft build persisted `review-verdict.json` and `readReviewVerdict` yields `unavailable` for a genuine outage. Validation: confirm `readReviewVerdict(runDir, issue)` returns the persisted signal before relying on the predicate; a `missing` read fails the predicate and refuses, which is the intended safe outcome.

## 8. DONE — Definition of Done

### From WHAT (flag + fence)
- [ ] `--accept-review-unavailable` (arity 0) is accepted by `MERGE_GATE_SPEC`; an unknown-flag rejection no longer fires for it.
- [ ] `fenceHumanFlags` refuses `--accept-review-unavailable` when stdin is not a TTY (exit 2, message naming the real-terminal remedy).
- [ ] `fenceHumanFlags` refuses `--accept-review-unavailable` without `--interactive` (exit 2).
- [ ] `fenceHumanFlags` refuses `--accept-review-unavailable` with an empty/absent `--override-reason` (exit 2).
- [ ] `fenceHumanFlags` refuses `--human-override` and `--accept-review-unavailable` passed together (exit 2, naming mutual exclusion).

### From WHAT (predicate)
- [ ] `narrowReviewUnavailableExcusable(floor)` returns true iff `review_verdict === "unavailable"` and `decideFloor({...floor, review_verdict:"pass"}).blockers` is empty.
- [ ] The predicate is exercised by a pure selftest table (true for review-unavailable-only; false for review fail, review missing, review needs-human, and for review-unavailable + any other unmet leg at L3 and L4).

### From HOW (behavior)
- [ ] On a refused merge whose only unmet leg is review-unavailable, `--accept-review-unavailable --interactive --override-reason "..."` at a TTY lands the merge and writes `merge-gate-override.json` with `source: "review-unavailable-accept"`, the review-unavailable blocker, and the reason — on both the PR path and `--local`.
- [ ] When the predicate is false (review fail/needs-human/missing, or another leg unmet), the gate refuses (exit 1), merges nothing, writes no override record, and does not escalate to a blanket override.
- [ ] The existing `--human-override` blanket path is byte-for-byte unchanged (still `source: "human-override"`, still overrides all legs).

### From HOW (audit)
- [ ] `accountHumanMerge` reconciles a `source: "review-unavailable-accept"` record through the unchanged reason + declare + landing logic and surfaces `source` so `faff audit` can name it distinctly from `human-override`.

### Integration smoke test
```
PROCEDURE smoke:
  1. Construct a refused floor: review_verdict "unavailable", CI green, AC complete, head-sha match, level L3.
  2. Run merge-gate --local --accept-review-unavailable --interactive --override-reason "outage; clean graft"
     against a TTY-simulated stdin.
  3. Assert: merge lands; merge-gate-override.json has source "review-unavailable-accept".
  4. Flip review_verdict to "fail"; re-run; assert exit 1, no merge, no override record.
```

confidence: high
build-tier: complex
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** No issue. FAFF-912 is a single 1-3 day unit: one flag, one fence extension, one pure predicate, one audit passthrough, plus their selftest/CLI tests — all one coherent concern (the audit `source` passthrough always ships with the new disposition, so it is not an independent splittable concern).
- **Workstream fit (principles 1 + 5).** No issue. The ticket sits in the merge-gate / governance workstream alongside FAFF-673 (the `--human-override` it narrows); outcome-aligned, not activity-bucketed.
- **Surfaced deps (principle 6).** No issue. The substrate it builds on (`--human-override`, the `source` field, `merge-gate-override.json`) has already shipped, so there is no unshipped blocker to link. FAFF-673 / 855 / 872 / 911 are correctly `relatedTo`, not `blockedBy` — 855/872/911 are root-cause fixes this change is deliberately independent of (it accepts the outage regardless of whether they land).
- **Risk profile (principle 7).** No issue. Low risk: no novel integration and no external dependency; the new arm mirrors an existing, tested override arm. No de-risking spike warranted.
