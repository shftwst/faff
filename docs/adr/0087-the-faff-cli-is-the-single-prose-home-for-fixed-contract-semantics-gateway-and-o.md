# ADR 0087 — The faff CLI is the single prose home for fixed-contract semantics; gateway and occupant skills carry pointers

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-07-24
- **Issue:** FAFF-598

## Context

The fixed-contract prose (verdict enums and their semantics, coercion directions,
envelope shapes) has lived in two places at once: the gateway
(`plugin/skills/faff/SKILL.md` → Core contracts) and non-normative recaps
scattered across occupant skills. The two copies drift — FAFF-582 caught the
shipped default reviewer teaching a three-verdict contract against the
gateway's four-value enum. Every faff session also pays the always-loaded
cost of ~25KB of gateway prose to carry semantics the CLI already has the
data to print on demand, because the CLI (`contract-defs.js`) is the thing
that actually validates every fixed contract — the enum arrays it branches
on are the ground truth, and the gateway prose was always a hand-maintained
copy of them.

ADR-0001 ("Contract-as-code foundations") set the original division of
labour: schema = shape, gateway = semantics. That division is what this
decision amends — not because it was wrong, but because it assumed the
semantics layer had no cheaper home than hand-written prose. FAFF-598 gives
it one: a `--describe` entry can bind directly to the same enum constant the
validator uses, making the described and validated values structurally the
same value rather than two hand-synced copies.

## Decision

The faff CLI is the single prose home for fixed-contract semantics. Each
dispatcher-known contract in `contract-defs.js` carries a `describe` entry
(purpose, per-field value groups bound **by reference** to the validation
enum constants, coercion/fail-direction statements, and producer-emits
notes). `faff contract <name> --describe` renders that entry — plus the
envelope shape loaded from the same on-disk schema the validator already
resolves — to markdown or JSON, read-only and dependency-free.

The gateway and every occupant skill stop restating enum values and their
meanings inline. Each of the gateway's per-contract sections shrinks to a
one-line purpose plus the pointer `Canonical semantics: faff contract <name>
--describe`. What stays in prose is pipeline wiring, not contract semantics:
who locates which block and pipes it where (consumer-folds), live-thread
reconciliation, the integrity-floor gate routing, and the producer-facing
spec dialect a skill must *write* (spec-readiness's decision markers).
`faff validate-adapters` gains a lint that fails a skill restating a
lintable enum's full value set inline, so the shrink cannot silently regrow
into the copy it replaced.

This amends ADR-0001's two-layer split (schema = shape, gateway = semantics)
to a three-layer split: schema = shape, CLI `--describe` = semantics
(bound by reference to validation), prose = pipeline wiring only. It does
not contradict ADR-0001's shape/semantics distinction — it relocates where
"semantics" is authored and gives that layer a drift-proof binding.

## Consequences

- Contract semantics can no longer drift from validation by construction:
  a described enum value and a validated enum value are the same array
  object, not independently maintained lists. The FAFF-582 class of bug
  (a producer or the gateway teaching a stale arity) becomes structurally
  unreachable for any value group flagged `lintable: true`.
- Adding or changing a fixed-contract enum value is a one-place edit
  (`contract-defs.js`) that automatically updates what `--describe` prints;
  no gateway or occupant-skill edit is needed to keep prose in sync.
- The gateway's always-loaded prose surface shrinks by the five Core-contracts
  sections' worth of enum-and-semantics text (~25KB), which FAFF-607's
  kernel/reference split can then build on to bring the gateway under its
  line-cap target.
- A skill author who needs to name several enum values together for
  legitimate prose reasons must either reword around the pointer or, if the
  value group is genuinely producer-authored vocabulary (not a validated
  verdict), have that group flagged `lintable: false` in its describe entry
  — a data-side exemption, not a free-form suppression comment.
- The residual authored one-line semantics text (what each enum value
  *means*) is not itself drift-proof — only its membership is. A future
  compute-function change that shifts a value's meaning without updating
  its `semantics` string is not caught by selftest; PR review of contract
  compute functions must now also check the sibling describe entry.
- `contract-defs.js` grows to hold both validation and description data for
  22 contracts; it remains the single navigable home for "what does this
  contract mean," rather than splitting a contract's identity across a
  second module.
