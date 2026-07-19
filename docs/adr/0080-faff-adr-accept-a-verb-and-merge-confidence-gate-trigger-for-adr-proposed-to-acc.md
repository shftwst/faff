# ADR 0080 — faff adr accept: a verb and merge-confidence-gate trigger for ADR Proposed to Accepted

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-07-19
- **Issue:** FAFF-546

## Context

`faff adr new` always scaffolds `Status: Proposed`, and the `adr` producer authors the body at faff-graft Step 4b — after the build, once the decision is already settled and shipped. No CLI verb ever moves an ADR forward from there: `supersede` retires one, `admit` (ADR-0022's PRDR-axis sibling concept, ported to the ADR axis by FAFF-199) is a report-only gate over *supersession* authority, not adoption. The result: every ADR is born describing a fact that already happened, labelled as a proposal, and stays that way forever absent a hand-edit — undermining the one coherence check (FAFF-342) that depends on `Accepted` meaning something. The PRDR axis already solved this with `faff prdr accept`, a dedicated writer with its own `--actor`/`--admit-verdict`/branch-landing ceremony (ADR-0022, ADR-0023) because a PRDR can be accepted standalone, independent of any one build. An ADR has no such standalone existence — it is always authored inside an already-in-flight graft run's own branch/PR, the same branch ADR-0043's mechanical merge floor (`faff merge-gate`) already gates before anything reaches `main`.

## Decision

Add `faff adr accept <selector>` as a **mechanical, authority-blind** Status-field edit — no `--actor`, no `--admit-verdict`, no branch machinery — and fire it as one sub-step inside faff-graft's existing Step 10 merge-confidence gate, immediately after the ADR-collision renumber guard and before the `ship` handoff. The verb only performs the `Proposed → Accepted` transition (idempotent no-op if already `Accepted`; refuses on any other Status, e.g. `Superseded by …`), reusing `recordSupersede`'s existing atomic field-edit regex rather than a second Status-mutation code path.

The authority to call it lives entirely at the call site, not the verb: at L1–L3 it fires only after AC verification, CI-green, and review `pass` have all held and a human has confirmed merge at Step 11; at L4 it additionally requires the code-blind holdout to return `meets-spec` before it fires — the holdout stands in for the "someone besides the author corroborated this" property a human confirm supplies at L3, so a loop-provenance ADR's acceptance is sanctioned by the same merge-confidence gate every code change already passes through, not by routing through `admit`'s separate two-gate supersession-authority schema (a different question: "may this loop retire that ADR" vs. "has this decision been corroborated"). This mirrors ADR-0043's own logic: the gate observes/asserts real state (CI, review, holdout) rather than trusting a self-report, and the same fail-closed posture applies here — a non-zero `faff adr accept` exit, or a non-zero `faff adr validate` re-run, blocks the merge as `needs-human` rather than merging on an unverified or red tree.

A companion `adrGitTier` validate pass (config-gated by `adr.validate_git`, default `auto`, mirroring `prdr.validate_git`) closes the parallel hazard this creates: an ADR marked `Accepted` in a working tree whose file was never actually committed. This ships alongside the verb rather than as a follow-up, matching how `prdrGitTier` shipped with `prdr accept` on the PRDR axis (FAFF-463) — a status-flip verb without a git-awareness check left unguarded is a known-hazard window from the moment it exists.

## Consequences

- Every ADR this system authors now has a defined, mechanical path out of `Proposed` — the merge-confidence gate is the *only* trigger, so no other call site (interactive hand-edit aside) ever writes `Status: Accepted`.
- Step 4b (ADR authoring) is unchanged: ADRs are still born `Proposed`. The born-Accepted alternative (having Step 4b's producer scaffold `Accepted` directly, provenance-tiered) was rejected — that would require the authoring producer to make a provenance/confidence judgement it is deliberately scoped out of (it authors prose, not authority, per this skill's own boundary).
- `faff adr accept`'s narrow flag surface (no `--actor`/`--admit-verdict`) means it can never disagree with the gate that calls it — the two cannot drift apart because there is only one authority vocabulary, the gate's own floor. Any future context that wants to call `faff adr accept` outside graft (e.g. a bare interactive invocation) must supply its own equivalent judgement before invoking; the verb still won't model one.
- The ~29 existing `Proposed` ADRs predating this verb are explicitly **not** backfilled by this decision — they predate any mechanical corroboration event this ADR defines, and retroactively accepting them is a human judgement call, left to a follow-up ticket parallel in shape to FAFF-342's one-time sweep.
- `adrGitTier`'s FAILs (accepted-but-uncommitted) now gate `faff adr validate`'s exit code, on the gating side alongside the ADR-collision/duplicate-number checks — distinct from FAFF-342's informational-only advisories.
