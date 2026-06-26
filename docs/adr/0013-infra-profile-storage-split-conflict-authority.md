# ADR 0013 — Infra-profile storage split + conflict authority

- **Status:** Accepted
- **Date:** 2026-06-26
- **Issue:** FAFF-26

## Context

faff is gaining an **infra profile** (FAFF-26): a structured record of a repo's infra world — runtimes, CI, deploy targets, datastores, PaaS availability, prefs — that the L4 substrate spine (FAFF-27 generative architecture, FAFF-30 env/data fabric) reads to reason about what to build and stand up.

A profile has **two distinct authorship sources** that can disagree:

- **Machine acquirers** (e.g. the FAFF-231 repo-miner; later Q&A / learned-over-projects modes) that infer the profile and **regenerate** it on demand.
- **Humans** who assert ground truth the machine can't see or gets wrong.

This forces two coupled decisions FAFF-26 named as open questions: *where does the profile live (per-repo machine state vs human config; one file or two)?* and *when machine and human disagree (mining finds Mongo, the human says Postgres), who wins?* A single shared file can't answer both — a re-acquire would clobber human edits, and there'd be no stable rule for whose value is authoritative.

## Decision

Split storage **by authorship**, and compute the effective profile on read with the human winning:

- The **machine-acquired profile** lives in `.faff/infra-profile.json` — per-repo, machine-owned, regenerable, gitignored, exactly like all other `.faff/` working state. Acquirers write **only** this file.
- The **human override** lives in an optional `infra:` block in `.faffrc.yaml` — hand-authored, version-controlled, the FAFF-19 human control surface.
- The **effective profile** is computed on read by `faff profile show` as `stored ⊕ override`, with the override winning **field-by-field** (wholesale per field; no deep per-element merge in v1). The override is **never** persisted back into the machine file, so it stays the single source of human intent.

The schema definition, validation, and the merge are owned by the `faff` CLI (`faff profile validate|show`), not skill prose — the deterministic-tools-over-prose tenet. Reading the structured `infra:` block requires a structured config read (`faff config get --json`), since the existing scalar `config get` stringifies objects.

## Consequences

- **Re-acquisition is safe.** Regenerating the machine file can never destroy human edits — they live in a separate, version-controlled file.
- **Conflict authority is settled: the human wins**, by construction, answering FAFF-26's "Postgres vs Mongo" question once for every acquirer.
- **The profile is a first-class human control surface** (FAFF-19) — editing `.faffrc.yaml infra:` is the supported override path.
- **Binds every future acquirer**: FAFF-231 and any later mode write only `.faff/infra-profile.json` and must never touch the `.faffrc.yaml infra:` block.
- **Binds every consumer**: FAFF-27 and FAFF-30 read the **effective** profile via `faff profile show`, never the raw machine file — so the human override is always honoured downstream.
- **Field-wholesale override is a v1 simplification.** A finer per-element merge (keyed on per-field provenance) is deferred to the multi-mode acquisition work and would revisit this ADR. Until then, a human's `datastores:` list *replaces* the mined one rather than merging — predictable and auditable, at the cost of granularity.
- Shares the **human-authority-wins** philosophy of ADR 0009 (eligibility-label provenance by write-abstention), applied here to infra config rather than control labels. No existing ADR is superseded.

<!-- adr-confidence: high — the decision is fully specified in the FAFF-26 spec rationale and grounded in faff's existing storage-split + FAFF-19 conventions. Authored inline (the `adr` slot default `faffter-noon-adr` is not installed in this environment). -->
