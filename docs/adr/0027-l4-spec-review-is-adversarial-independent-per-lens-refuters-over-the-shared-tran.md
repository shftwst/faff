# ADR 0027 — L4 spec review is adversarial — independent per-lens refuters over the shared transport

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-267

## Context

ADR-0025 stood up the `spec_review` slot and the fixed `spec-review-verdict` contract, deliberately leaving the reviewer's behaviour to the occupant. ADR-0026 then fixed that depth scales by level: L1–L3 run a single-pass four-lens checklist, and L4 runs independent per-lens adversarial refuters — but ADR-0026 left the L4 form as a named hook with no realisation.

At L4 there is no human in the room to sanity-check a spec before code is written. A single review pass run by one model — even a four-lens one — inherits that model's correlated blind spots, the exact failure the L4 evaluator lane exists to close. faff already trusts an adversarial second opinion at the code stage (`faffter-dark-adversarial-review`, via the `review-call.mjs` transport: preflight, streaming, token budget, fallback chain, and an exit-code→outcome discipline where a down provider surfaces `needs-human`, never a silent pass). The same shape applies one altitude up, at the spec. Without fixing how the L4 form is built, each downstream slice (this one, and change-surface lens selection) would re-decide the adversarial mechanism ad hoc and risk forking the hard-won transport robustness.

A sibling product-altitude adversarial review already exists (the PRDR YAGNI gate). The realisation must say what is shared with it and what is altitude-specific, so the two do not duplicate transport nor blur into one contract.

## Decision

**L4 spec review is adversarial: each enabled lens runs as an independent refuter over the shared adversarial transport, aggregated onto the one `spec-review-verdict` contract.**

- **A distinct "dark" occupant of the existing `spec_review` slot** (`faffter-dark-spec-review`), selected by the human in the L4 recipe — mirroring `faffter-dark-adversarial-review` ↔ `faffter-noon-review`. Not a new slot, not a mode flag on the noon occupant.
- **One independent refuter pass per enabled lens** (architectural / infosec / methodology / QA), each prompted to *break* the spec from its angle — a separate `review-call.mjs` invocation per lens, never a single pass enumerating all lenses. Independence (decorrelation) is the whole value over the single-pass form; collapsing the lenses re-correlates the blind spots and reduces this to the L1–L3 reviewer.
- **Reuse the `review-call.mjs` transport verbatim** — the spec is passed as the reviewed `--diff` artifact, repo context as `--context`, the lens refutation prompt as `--system`. The helper is not forked.
- **A deterministic majority/severity aggregation** maps the refutations onto the contract verdict: any `critical` objection → `reject-approach`; a strict majority of enabled lenses refuting (`ceil((n+1)/2)`) → `reject-approach`; a non-critical minority → `revise`; all clear → `approve`; a transport failure that could swing the vote → `needs-human` (a down refuter never silently approves). This severity→verdict mapping is reviewer judgement, which ADR-0025 keeps out of the contract.
- **The shared-mechanism boundary with the product-altitude review is the transport plus the "a different model challenges; the loop never self-grades" discipline only.** Artifact, lens count, arbiter, and emitted contract are altitude-specific and intentionally separate (two contracts, two arbiters).

## Consequences

- **Realises ADR-0026's L4 hook.** This is the concrete content of the level gradient's L4 rung; it refines depth and lens prompts, never the verdict shape.
- **No transport fork.** Both the spec-altitude and product-altitude adversarial reviews consume the same `review-call.mjs`; the only common code is that helper plus the gateway's adversarial-review discipline. The transport's robustness (preflight, streaming, token budget, fallback chain, down→needs-human) is inherited, not re-created.
- **The gate cannot be silently disabled by an outage.** A configured/default backend that is down or misconfigured surfaces `needs-human`, never a quiet `approve` — the L4 spec gate fails safe.
- **Aggregation is the reviewer's, not the contract's.** The contract continues to validate verdict shape only; a later change may weight lenses by change-surface, altering *which* lenses are enabled without touching this aggregation rule or the contract boundary.
- **Independence has a token cost.** Running N isolated passes instead of one is more expensive; that cost is reserved for L4, where lights-out correctness pays for it, consistent with the depth-by-level gradient.
