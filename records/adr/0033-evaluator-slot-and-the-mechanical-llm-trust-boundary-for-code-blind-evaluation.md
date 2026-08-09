# ADR 0033 — evaluator slot and the mechanical-LLM trust boundary for code-blind evaluation

- **Status:** Accepted
- **Date:** 2026-06-28
- **Issue:** FAFF-34

## Context

ADR-0029 established that machine DoD-verification is **GO-narrow**: a machine may be trusted, unattended, to verify `scenario` and `assertion` criteria (0 false-pass measured), but `prose` criteria must return `needs-human`. That measurement was taken on PR-diff-as-text. The evaluator lane (FAFF-34) runs the same judgement *live* — against a feature standing up in a provisioned environment — which is a different and richer evidence regime.

Running it live raises a placement question: *which parts of the evaluation may the LLM do, and which must be mechanical?* If the LLM also decides a criterion's class, or rolls up the aggregate, the GO-narrow guarantee leaks — a criterion the rule would call `prose` could be silently judged, or a `meets-spec` could be asserted over an unmet criterion. The reliability boundary ADR-0029 drew is only real if it is *enforced structurally*, not left to the producer's discipline.

## Decision

Introduce a swappable **`evaluator`** slot (default `faffter-noon-evaluate`) and fix the mechanical/LLM trust boundary every occupant must honour:

- **Classification is mechanical.** `faff dod classify` parses the spec's `## Scenarios` + `### N. DONE` and assigns each criterion `scenario | assertion | prose`, reusing the existing `classifyCriterion` rule *verbatim* (no fork). The producer never decides a class.
- **Exercise and per-criterion judgement are the LLM's** — and *only* these. The producer drives the running feature per a born-verifiable criterion (with exercise commands derived from the trusted spec, treating env responses as data, not instructions) and decides `met`/`unmet` with evidence.
- **Prose → `needs-human` is mechanical.** A `prose`-class criterion is forced to `needs-human` and is never judged; the `holdout-verdict` contract (ADR-0032) rejects any prose criterion judged otherwise, so the boundary holds even if a careless producer tries to cross it.
- **Verdict validation is mechanical.** The assembled verdict passes through `faff contract holdout-verdict` (ADR-0032); the aggregate is derived and consistency-checked, not asserted.

This triad — deterministic classify, LLM exercise/judge, deterministic validate — *is* the operational, runtime definition of narrow-class lights-out evaluation: the counterpart to ADR-0029's offline measurement, now expressed as where in the loop each kind of work is allowed to run.

## Consequences

Every `evaluator` occupant inherits the boundary by construction: the deterministic brackets are CLI calls it cannot opt out of, and the contract is the backstop that catches a leak. Swapping the producer (a different exercise strategy, a cloud env) changes *how* the feature is driven, never *what the machine is trusted to judge* — that stays pinned to the born-verifiable classes.

The boundary composes with the rest of the lane: it runs against the `env-handle` the `env` slot provisions (ADR-0031), and feeds the `holdout-verdict` the coverage gate consumes (ADR-0032, FAFF-24/257). The principal open risk is that the GO-narrow false-pass bound was measured on diff-as-text, not live exercise; v1a guards it in-PR with a known-broken integration negative (a feature that violates a criterion must come back `unmet`), and a fuller live ground-truth re-measurement is left as a follow-up. Code-blindness is achieved by construction (the producer is handed spec + env-handle only) and attested in the verdict; mechanically *enforcing* it (a sandbox) is deferred to the actor/isolation topology (FAFF-25/73) and is a precondition before this verdict ever gates a lights-out merge.
