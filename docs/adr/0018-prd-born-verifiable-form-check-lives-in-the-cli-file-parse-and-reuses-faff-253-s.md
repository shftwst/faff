# ADR 0018 — PRD born-verifiable form-check lives in the CLI file-parse and reuses FAFF-253's prd-readiness contract surface

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-254

## Context

A PRD is the L4 termination function: a lights-out loop stops when the immutable PRD's done-criteria are satisfied. For that to be *accountable*, the done-criteria must be machine-checkable in form — born verifiable. FAFF-254 adds the first half: a deterministic form-check over a PRD's `## Acceptance criteria`.

Two structural choices had to be made, and they interact:

1. **Where does the form-check live?** The FAFF-77 contract pattern (used by `spec`/`review`/`ship`) presumes an **LLM producer** emitting a `faff-contract:<name>` block that a deterministic script then shape-checks. But a PRD is **authored markdown with no producer** — there is no LLM step to emit an extraction block. A pure stdin-extraction contract would have nothing producing its input.

2. **The `prd-readiness` name collided with FAFF-253.** FAFF-253 already shipped a `faff contract prd-readiness` contract + `contracts/prd-readiness.schema.json` — but as the *run-start admissibility verdict* (`admissible`/`not-ready` + `creative_licence` + `stop_conditions_verifiable`), produced by a deferred LLM run-start validator (FAFF-260). FAFF-254's deterministic form-check is a different thing on the same name. The 2026-06-27 human Resolution settled the overlap: the two are complementary, not duplicate, and FAFF-254 must **reuse** 253's contract, never define a second.

## Decision

**The PRD born-verifiable form-check is a deterministic file-parse in the `faff` CLI (`classifyAcceptanceCriteria` + `acceptanceSection` + `prdStrictCheck`, surfaced as `faff prd validate --strict`), mirroring `adrValidate`/`prdValidate` — not a producer-emitted contract. It reuses FAFF-253's existing `prd-readiness` contract surface as the canonical downstream shape; it does NOT register a second contract or schema.**

- The classifier is a **pure function** of the acceptance-criteria section text (no filesystem/tracker I/O), so it is unit-testable in isolation and callable from anywhere.
- The CLI parse is the natural home for reading a PRD file, exactly as `adrValidate` reads ADRs — and it needs no LLM producer.
- The deterministic form-check is the **forward interface** the run-start gate (FAFF-260) and the evaluator (FAFF-34) consume to populate the `stop_conditions_verifiable` signal that FAFF-253's `prd-readiness` verdict already carries. One canonical shape spans the freeze gate and the future evaluator.

## Consequences

- **One `prd-readiness` contract, two complementary halves.** FAFF-253 owns the *admit-this-run?* verdict shape; FAFF-254 owns the deterministic *is-this-PRD-born-verifiable?* form-check that feeds it. Future PRD-axis work extends this surface rather than forking a parallel one. The spec's original proposal to register a *second* `prd-readiness` contract with a `{criteria_present, all_born_verifiable, criteria, violations}` shape is **superseded** by this decision.
- **The form-check is a CLI concern, the verdict is a producer concern.** A future evaluator (FAFF-34) or run-start gate (FAFF-260) shells `faff prd validate --strict` / imports the classifier for the deterministic form gate, then layers its own semantic judgement on top — it never re-implements the parse.
- **Constraint on producers:** because PRDs have no LLM producer, the form-check must stay a deterministic parse. If a future PRD authoring assistant becomes an LLM producer, it would emit toward this same shape, not a new one.
- Trade-off: the classifier and the run-start verdict live in two places (CLI parse vs. contract script) that must agree on the meaning of "born-verifiable". They are kept aligned by the shared `stop_conditions_verifiable` signal and the `prd-readiness` schema as the single shape.
