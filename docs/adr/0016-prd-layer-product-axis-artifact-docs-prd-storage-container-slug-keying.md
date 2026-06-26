# ADR 0016 — PRD layer: product-axis artifact, docs/prd storage, container-slug keying

- **Status:** Accepted
- **Date:** 2026-06-26
- **Issue:** FAFF-252
- **Initiative:** L4 — Lights-out AI factory

## Context

faff has a **decision-axis** durable artifact — the ADR (`docs/adr/NNNN-slug.md`, the `faff adr` CLI) — but **no product-axis** counterpart. The PRD/PRDR design (`design/prds.md` K, `design/prdrs.md` L) makes the **PRD** the immutable root-ends a lights-out (L4) run is bounded by. Before the downstream PRD-layer slices can build (FAFF-253 admissibility, FAFF-254 born-verifiable freeze, FAFF-245 PRDR supersession), the layer's storage + naming convention must be settled once, durably — a per-spec decision would let the four slices drift.

This ADR is the product-axis sibling of ADR 0001 (contract-as-code): same "settle the convention, then the slices copy it" role, on the product axis.

## Decision

- **A PRD is the product-axis counterpart to the ADR** — a durable product-requirements doc (*what & why*, Atlassian school) at **container** (initiative/project) altitude, the immutable root-ends. The `faff prd` CLI structurally **mirrors `faff adr`** (`path` / `new` / `link` / `list` / `validate`); it does not reinvent storage, scaffolding, or validation.
- **Storage = committed `docs/prd/`**, resolved via a new `tracking.prd_docs_path` config key that mirrors `tracking.spec_docs_path`'s resolver + default rule. Rejected: `.faff/prd/` (ephemeral, doesn't travel with the code) and tracker-only (not machine-clean, doesn't ship in the PR).
- **Filename keyed by container slug** (`docs/prd/<container-slug>.md`), **not** an ADR-style global `NNNN`. There is exactly one PRD per container, so a running number is meaningless and a slug is self-documenting; the supersession a number would serve is the **PRDR**'s job (FAFF-245), not the PRD's.
- **Lean, format-flexible.** `prd validate` checks metadata + non-empty body **presence**, never section *shape* — a PRD is a one-pager, not a rigid schema. The CLI writes the file and emits the container-link line; the **caller commits** and applies the link (orchestrator-agnostic, exactly like `faff adr new`).

## Consequences

- **FAFF-253** (PRD-admissibility gate) validates *this* artifact — a future `faff prd validate --admissible` / `prd-readiness` contract reads the metadata + acceptance section defined here.
- **FAFF-254** (born-verifiable freeze) enforces immutability on the `Status: Frozen` field + `## Acceptance criteria` section this layer ships as plumbing.
- **FAFF-245** (PRDRs) supersede-decompose the PRD; because the PRD itself carries no numbering/supersession, that mechanic lives entirely in the PRDR layer with no PRD-side conflict.
- The container-link **assumes** the tracker MCP can edit a container description; the CLI never depends on it (it emits the `**PRD:**` line for the caller), so the committed-file half ships regardless.
- The PRD is **consumer-side** repo markdown (`docs/prd/`), travelling with the code and PR-reviewable — preserving the same property the spec and ADR have.
