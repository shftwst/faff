# ADR 0020 — Lights-out admissibility is a deterministic structural check, never LLM self-judgement

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-224

## Context

At L4 (lights-out) no human reviews the morning brief, so a spec admitted to an unattended run must carry stop-conditions a machine can evaluate on its own. Otherwise the build agent grades its own "done" — the exact failure L4 exists to remove. A quality-IN gate is needed between prep (spec rated) and build-admission that refuses an under-specified spec.

The tempting implementation is to ask an LLM (or re-invoke the spec producer) "is this DoD verifiable?". That reintroduces the failure mode: a model judging the verifiability of a DoD *is* the agent grading itself, and a producer self-certifying "my DoD is verifiable" is the same self-grade one level up. The existing `contract spec-readiness` surface trusts exactly such a producer-self-declared extraction — appropriate there, but disqualifying for an admission gate whose whole job is to not trust the producer's word.

## Decision

Lights-out admissibility is a **deterministic structural check** over the spec's own DoD text — never an LLM judgement and never a re-invocation of the spec producer. The `faff admissible` CLI parses the spec markdown's `## Scenarios` and `### N. DONE` structure directly and applies a fail-safe mechanical floor: gating R1 (≥1 born-verifiable scenario), R2a (non-empty DONE checklist), R2b (no banned-vague DONE item, against a named `BANNED_VAGUE` denylist); advisory R3 (a runnable-check command surfaces a `warnings` entry, never gates). Same input → same verdict, every run.

This deliberately **diverges from the `spec-readiness` extraction model**: where that contract reads a producer-declared shape, admissibility reads the spec's structure itself, because the thing being checked is precisely what the producer must not self-certify. It is a mechanical **floor, not a semantic proof** — it confirms a machine-verifiable DoD is *present in form*, not that the DoD is *good*. The semantic judgement sits in a separate, more expensive layer above it (the spec-stage adversarial review), which is why this gate is its cheaper precondition rather than a substitute. It composes with the structural form-check precedent on the product axis — the PRD born-verifiable form-check that lives in the CLI file-parse, and its scenario-by-Then / assertion-by-MUST recognition rule — as the spec-axis sibling of the same "the CLI parses structure, the model never self-grades" stance.

## Consequences

- The verdict is re-evaluable, tracker-free, and unit-testable in isolation (a `--selftest` verdict table is a CI gate). Any parse exception, unreadable spec, or absent DoD coerces to **inadmissible** (fail-safe) — admission never proceeds on doubt.
- The gate is enforced as defence-in-depth at two call-sites under the lights-out signal only — beep-boop build-queue assembly (primary filter) and graft's pre-worktree backstop — mirroring how eligibility is enforced. The signal itself fail-safe defaults **off**, so L1–L3 behaviour is a strict no-op and the gate can never spuriously block the existing autonomous queue.
- The denylist (`BANNED_VAGUE`) is a floor by construction: it catches known vague phrasings, not novel ones, and is tuned from real misses — it must **never** be escalated to an LLM to "understand" vagueness, or this decision is undone. Structural presence ≠ semantic verifiability is an accepted residual, closed only by the adversarial layer above.
- Promoting R3 (runnable-check command) from advisory to gating, or coupling admissibility to holdout-subset existence, are future tightenings layered on top — they do not change this structural, non-LLM core.
