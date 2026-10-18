# ADR 0140 — The code-blind holdout judges only machine-checkable criteria

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-18
- **Issue:** FAFF-1291

## Context

ADR-0029 trusted the machine holdout for born-verifiable (scenario and assertion) criteria and sent prose criteria to a human. In the code, a prose DONE item forced the verdict to needs-human, and ADR-0032 fixes the verdict contract that carries it. Every spec's DONE section holds prose items, since they are the builder's own acceptance criteria. So the strict L4 floor was blocked unconditionally for them, and no run could pass it. FAFF-1291 exists to remove that block.

The holdout is code-blind: it sees the spec and a running environment, never the codebase. A prose DONE item cannot be checked that way, and asking the evaluator model to judge it would put an unverifiable opinion into the anchored verdict. The criterion still has a verifier, though. The builder writes an acceptance-criterion (AC) checklist (`ac-checklist.json`, keyed by the qualified ids of ADR-0139), and the review leg reads the diff against it.

Three ways to route those criteria out of the judged set were considered:

- Infer "prose means delegated" separately in each consumer. That gives two partition keys and no per-row verifier to name.
- Add new verdict or class enum values. These are non-additive under `classifySchemaChange`.
- List delegated rows only in the unsigned evidence report. The anchored record then cannot show what was left out of the judgement.

## Decision

The code-blind holdout judges only machine-checkable criteria. Everything else is delegated to a named verifier and recorded as such.

- `faff dod classify` gives a DONE-sourced prose criterion a new `verification_tier` value, `delegated`, with verifier `ac-checklist`. The prose-DONE rule runs before integration-keyword matching. An explicit integration fence still wins, so a fenced criterion stays `integration`.
- Delegated and `integration` criteria leave the judged set and the aggregate.
- The holdout writer, never the evaluator model, lists each delegated criterion in an optional top-level `delegated[]` in `holdout.json`, with its verifier and `ac_id`. The writer refuses a record whose judged ids do not match what classify produced.
- A prose Scenarios unit is never delegated, because no verifier receives it by id. It fails closed to needs-human.
- `meets-spec` now means every judged criterion was met.
- Graft skips the holdout only when nothing is judged and nothing is integration-tier.

The trust shift is stated openly. A prose DONE item used to force needs-human and block the strict L4 floor. It now passes on the builder-written AC checklist plus the review leg. The product owner accepted this on 2026-10-17, because keeping the hard block would undo the ticket. This narrows ADR-0029 for prose DONE items only.

## Consequences

- A `meets-spec` verdict no longer says the whole DoD was verified. It says every judged criterion was met, and the delegated ones are listed in the record, so a reader can see what was not judged and who owns it.
- The independence of the delegated path is weaker than the judged path. The builder writes the checklist, so the same party that built the feature also asserts its prose criteria. Two follow-ups address this. FAFF-1339 makes the merge floor check that every delegated `ac_id` has a passed checklist row. That adds completeness, not independence. Moving the checklist write to the trusted side is the only change that narrows the shift.
- `delegated[]` is optional and additive, so existing records and `classifySchemaChange` are unaffected. Consumers that read `holdout.json` must treat it as the home of delegated rows and must not infer delegation from prose.
- The writer-side check of judged ids against classify is the guard against the evaluator model dropping or adding criteria. Later changes to classify's tiers must keep that check in step.
- Specs with prose Scenarios still reach needs-human. Only prose DONE items gain the delegated route.
