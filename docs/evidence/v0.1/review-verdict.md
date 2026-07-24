# review-verdict.json

**Purpose.** The per-issue floor artifact recording the `review` slot's terminal verdict
on the diff — the artifact governance-check's `merge_floor` leg re-reads rather than
re-running review itself.

**Location & lifecycle.** `<run-dir>/<issue>/review-verdict.json`, written once
`faff-graft` Step 9 (the pre-PR review phase) reaches a terminal verdict (`pass`,
`needs-human`, or `unavailable` falling through to a park — `fail` loops in place and
writes nothing until it resolves). Not mutated afterward.

**Producer(s).** `faff-graft` Step 9, from the `review` slot's returned
`faff-contract:review-verdict` block, extracted and validated via `faff contract
review-verdict`.

**Consumer(s).** `faff merge-gate`'s `readReviewVerdict`, reused by governance-check's
`merge_floor` leg.

**Schema.** Existing `plugin/skills/faff/contracts/review-verdict.schema.json` —
referenced here, not copied (one source per schema). Shape: `{ signal, findings,
conformant, violations }`; `signal ∈ {pass, fail, needs-human, unavailable}`.

**Integrity.** A single write per issue; no locking concerns (one issue, one graft run,
sequential). The persisted file is the same extraction JSON `faff contract
review-verdict` validated at write time — the merge_floor leg re-validates through the
identical rule, so a persisted-but-tampered file that no longer conforms is caught, not
silently trusted.

**Fail direction.** A missing or unreadable `review-verdict.json` is fail-closed to
`missing` (≠ `pass`) at the merge_floor leg. A malformed verdict coerces to
`needs-human`, never `pass` (the same coercion rule the live review gate applies —
restated here because the persisted artifact is re-validated through the identical
contract).

**Example.** `.faff/runs/run-20260724-125424-beepboop-full/FAFF-634/review-verdict.json`
(a real merged issue, `{ "signal": "pass", "findings": [], "adversarial_outcome":
"human-waived-unavailable" }`) — not copied into `schema/examples/` since the schema is
referenced, not owned, by this directory (one source per schema, per the README's
authoring rule).
