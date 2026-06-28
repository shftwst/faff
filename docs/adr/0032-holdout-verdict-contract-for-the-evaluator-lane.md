# ADR 0032 — holdout-verdict contract for the evaluator lane

- **Status:** Accepted
- **Date:** 2026-06-28
- **Issue:** FAFF-34

## Context

faff's lights-out pipeline is a four-box flow — propose an architecture (FAFF-27), provision a runtime (FAFF-30/270), seed it (FAFF-31), then **evaluate** the build against it (FAFF-34). The evaluate box is the code-blind holdout judge: it stands the feature up, exercises the spec's done-criteria against the running system, and answers "does the delivered thing meet the spec?". For that answer to be trustworthy it needs a *fixed shape* the pipeline branches on — without one, "evaluated" has no agreed meaning and an over-optimistic producer could emit a free-form pass that quietly carries false confidence into a lights-out merge.

The danger is asymmetric. A verdict that errs toward "fail" merely wastes a build; one that errs toward "meets-spec" ships a feature that does not work. So the envelope must make the unsafe verdict *unrepresentable as a pass*: any ambiguity has to resolve away from "meets-spec", and the roll-up must not be hand-wavable over an unmet criterion.

## Decision

Introduce a fixed **`holdout-verdict`** contract behind the consumer-fold pattern (the producer emits a `faff-contract:holdout-verdict` block; the consumer locates it, `JSON.parse`s it, and pipes it to `faff contract holdout-verdict`). It joins the contract family alongside `review-verdict`, `env-handle`, and `architecture-proposal`.

The record is `{ aggregate, code_blind, criteria[], violations }`, where each criterion is `{ class: scenario|assertion|prose, verdict: met|unmet|needs-human, evidence_present }`. A pure compute function (no I/O) validates shape *and consistency*, with the exit code as the gate:

- **exit 2** — non-object (producer breakage).
- **exit 1** — any of: `code_blind` ≠ `true` (a non-blind verdict is structurally inadmissible); an out-of-enum `aggregate` (coerced to `needs-human`, recorded as a violation — **never** to `meets-spec`); a `prose`-class criterion judged anything other than `needs-human` (the machine must never judge prose — ADR-0029); a `met`/`unmet` criterion with no evidence; an `aggregate` that does not match the derivation from the criteria.
- **exit 0** — conformant and gate-passing.

The `aggregate` is **derived**, not asserted: any `needs-human` (or an empty criteria set) → `needs-human`; all `met` → `meets-spec`; all `unmet` → `fails`; otherwise `gaps`. The compute function derives the expected aggregate and flags a mismatch, so a producer cannot stamp `meets-spec` over an unmet criterion. The fail-safe coercion target is `needs-human`, mirroring `review-verdict` — never a pass.

## Consequences

Every evaluator occupant — the default `faffter-noon-evaluate` and any swap-in — emits this one block, so the pipeline branches on a stable verdict regardless of how the feature was exercised. The per-criterion shape is what the downstream PRD-coverage roll-up (`faff prdr coverage --dod-verdicts`, FAFF-24/257) consumes, and what makes a `gaps` verdict actionable ("which criterion?"). Evidence lives in the producer's prose report, not the validated block — the contract checks the *presence* of evidence (a boolean), never re-reads it, exactly as `review-verdict` checks `location_present`/`action_present`.

`code_blind` is a schema-required field the gate forces to `true`: a missing attestation is producer breakage (fail-loud), a present-but-false one is a real state the gate rejects at exit 1. The contract therefore rejects a *declared* non-blind verdict, but cannot detect a producer that read the codebase and lied `true` — sandboxed enforcement of blindness is deferred (FAFF-25/73) and must close before this verdict ever gates a lights-out merge. In v1a the verdict gates nothing automatically (orchestrator wiring is out of scope), so that residual has no blast radius yet. The decision is consistent with the contract-plus-slot precedents (ADR-0025 spec-review, ADR-0030 architecture-proposal, ADR-0031 env-handle): faff fixes the verdict envelope and leaves the producing strategy to the slot (ADR-0033).
