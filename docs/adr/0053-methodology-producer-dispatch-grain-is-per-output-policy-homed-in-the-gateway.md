# ADR 0053 — Methodology producer-dispatch grain is per-output policy homed in the gateway

- **Status:** Proposed
- **Date:** 2026-07-11
- **Issue:** FAFF-421

## Context

The `methodology` slot answers a set of **named outputs** — `pick-ordering`, `backlog-diagnostics`, `promotion-readiness`, `build-queue`, `ticket-shaping`, `standup-digest`, `horizon-assignment`, `issue-critique`, `crank-up-set`, `prdr-author`, `yagni-judge`, `run-termination-policy` — requested by name across faff-tidy, faff-wtf, faff-map, faff-plot, faff-jot, faff-prep, and faff-beep-boop. ADR-0045 fixed the *mechanism*: producer slots are dispatched as Agent-tool subagents so the orchestrator keeps control across the boundary (an inline Skill call would end the caller's turn). ADR-0050 fixed the *lane* routing: `models.methodology` / `effort.methodology` stamp a model and reasoning-effort onto those dispatches, stopping at the prep boundary.

Neither settles the **grain** — how many dispatches a call site makes, and what each one carries. That gap is real, because the call sites differ sharply in shape. A read-skill pass (tidy, wtf) requests four to seven named outputs from one backlog snapshot. `/faff-plot` recurses `ticket-shaping` level by level, each level gated by a human confirmation. `prdr-author` fires once per project proposal, each separately human-gated after a gate, and owns a `faff prdr new` write. With no settled grain each call site improvises, and the two naive uniform answers are both wrong: dispatch-per-request spins N subagents and re-serialises the dependency graph N times per pass (tidy/wtf pay this 4–7×); folding everything into one batch front-runs plot's per-level gates and prdr's per-project gates. The grain is a cross-cutting policy — it constrains every present and future methodology call site — so it needs a single normative home, not N per-skill conventions that rot and trip the duplicated-block lint.

## Decision

**Methodology producer-dispatch grain is per-output policy, homed in one place.** A normative `Transport` subsection under gateway → "The `methodology` slot" carries the grain table, beside the named-output contract it governs, with a one-sentence pointer from the Producer-dispatch bullet (gateway → *Sibling-skill invocation*). The grain is chosen per output:

- **batched-per-pass (default)** — one Agent-tool producer dispatch per read-skill pass, carrying all that pass's named-output requests (`pick-ordering`, `backlog-diagnostics`, `crank-up-set`, `standup-digest`, `horizon-assignment`). One snapshot, one skill-load, N answers — and ordering stays mutually consistent with diagnostics because both are computed from the same state.
- **batch-per-altitude** — for `/faff-plot`'s `ticket-shaping` recursion: one dispatch per descent level, carrying all confirmed nodes' sub-briefs; an `edit` triggers a follow-up node-scoped dispatch. Levels are sequentially dependent through human gates (a whole-tree batch is impossible), but nodes at one altitude shape independently — the grain matches plot's level-by-level gating.
- **dispatch-per-request (per container)** — for `prdr-author`: each proposal is separately human-gated, arises after a gate, and its `faff prdr new` write stays methodology-owned. Folding it into the pass batch would front-run the per-project human gates.
- **in-context fallback** — when the calling skill is itself a subagent (single-level nesting, per ADR-0045): the producer runs in-context, and the `models.methodology` / `effort.methodology` lanes do not apply — a same-session run cannot take a dispatch-level model or effort.

The table is normative and **re-tunable per output in one place** without touching any call site.

## Consequences

- Six `SKILL.md` files (faff-tidy, faff-plot, faff-map, faff-wtf, faff-jot, and the gateway) shed any improvised dispatch grain and refer back to the `Transport` subsection. The migration ships in this PR, so the prose is already consistent with the recorded policy — this is prose-only across the suite, no runtime code path changes.
- Every future methodology call site inherits its grain by output name. FAFF-436's `rehome-set` extends the **batched-per-pass** row; a new named output picks its grain in the table, not at the call site.
- The default trades one modest coupling — a single subagent must hold a whole pass's requests in one prompt — for one snapshot and one skill-load per pass, plus cross-output consistency (ordering and diagnostics cannot diverge). The documented exception is a legitimate isolated single-output call (e.g. a follow-up after a plot `edit`); it is an exception, not a reason to abandon the batch.
- **batch-per-altitude** leaves plot's recursion, stop rule, and writes on the plot side (the methodology shapes one level per call, per the `ticket-shaping` contract); the grain governs only how many dispatches plot makes as it descends.
- **dispatch-per-request** for `prdr-author` preserves the FAFF-245/255/256 human-gate ordering — the methodology authors but never admits, and the CLI write stays methodology-owned.
- This ADR **complements** ADR-0045 (dispatch mechanism) and ADR-0050 (model/effort lane routing) and contradicts neither: it is the transport-*grain* leg alongside mechanism and lane, mirroring 0050's role for the effort lanes (per-facet policy homed in one normative place). The **in-context fallback** restates 0045/0050's single-level-nesting rule in grain vocabulary rather than adding a new carve-out.
- Re-tuning any output's grain is a one-line table edit in the gateway; no call site changes. The cost is the standard faff contract-loading trade — the gateway's methodology section grows one subsection and each call site carries a refer-back pointer instead of a self-contained rule — accepted here to keep the grain's single canonical home.
