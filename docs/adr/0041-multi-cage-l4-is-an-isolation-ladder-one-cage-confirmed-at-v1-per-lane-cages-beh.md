# ADR 0041 — Multi-cage L4 is an isolation ladder: one cage confirmed at v1, per-lane cages behind named triggers, outer orchestrator asserted-never-launched

- **Status:** Accepted
- **Date:** 2026-07-03
- **Issue:** FAFF-313

## Context

L4 today runs every agent lane — orchestrator, implementor build-subagents, code-blind evaluator — inside **one** human-launched cage (claude-box or any containerised Claude Code, ADR-0010). Isolation between the lanes is *context* isolation: throwaway subagent contexts, git worktrees, code-blindness-by-not-handing-it-the-code. That is weaker than the lane diagram implies: the evaluator's blindness is an attested convention (a stray repo path would let it read source), and ADR-0039 proved the build lane shares uid+filesystem with the orchestrator's on-disk artifacts (the forge finding, extended to Sentry *detection* by its consequence on ledger content).

ADR-0010's invariants bound this decision and are preserved verbatim: **"faff implements no sandbox of its own"** (:22); **"the container is the substitutable mechanism, not a specific product… any containerised Claude Code satisfies this ADR"** (:26–27); **"this ADR bounds blast radius *to the container*, not *within* it"** with within-container lane isolation scoped to FAFF-32 (:47); and the revisit trigger — reopen "if faff needs finer-than-container isolation between lanes that the container can't give" (:48a). ADR-0034 co-binds Sentry's un-subvertability to the isolation model; ADR-0037 forces appetite `full` at L4; ADR-0038 defers the FAFF-69 role/isolation DSL while sanctioning incremental seams.

This decision is the outcome of the FAFF-313 **spike** (the ADR-0029/0039/0040 shape: hypothesis → adversarial refutation → decision or narrowing; deliverable is a recorded decision, not a shipped mechanism). Each question took ≥2 refutation attempts; the full log is the spike record (`docs/spikes/2026-07-03-FAFF-313-multi-cage-refutation-log.md`).

## Decision

**1. The scope call is an isolation ladder, not a binary — and v1's stopping point is confirmed.** The ticket's promotion-intent line holds: **L4 v1 = one cage + context-isolated lanes; hard per-lane cages require an outer orchestrator that faff asserts-but-never-launches.** The rungs, each with owner and trigger:

| Rung | Content | Owner | Trigger |
|---|---|---|---|
| 0 — context isolation | subagent contexts + worktrees + attested code-blindness (shipped) | faff | none — the confirmed v1 baseline, sufficient at L1–L3 |
| 1 — fs-integrity | read-only mount of run-ledger / corrective-artifact dirs for the build lane, or orchestrator-verified signatures (**FAFF-325**) | outer layer provides the mount; faff verifies/asserts | **fired** — ADR-0039's conditional GO (:25) + the detection residual (:40); blocks FAFF-326 |
| 2 — evaluator hard cage | the evaluator runs where the codebase is physically unreadable (**FAFF-276**, the first slice) | outer layer provides the cage; faff asserts + refuses | **fired for L4** — FAFF-309 made the holdout verdict load-bearing (`run-done` escalates on `prd_satisfied === false`; graft's merge-gate reuses `holdout_step`), so the code-blindness it rests on is a live single point of trust. FAFF-276's own "must close before the verdict gates a lights-out merge" condition is now met. L1–L3 unaffected (no holdout phase runs there) |
| 3 — full per-lane cages | every lane in its own container with its own env | outer layer provides; faff emits intent + asserts per lane | **not fired** — fires when FAFF-32's lane→secret matrix needs physical enforcement (no per-subagent env scrubbing exists below this rung) or ADR-0034's isolation revisit trigger fires. When it fires, it **formally reopens ADR-0010 via its own :48(a) trigger** — the singular-cage topology becomes N cages by the ADR's own escalation mechanism, never a quiet contradiction |

**2. Assert-not-launch is sharpened by the cage/workload distinction, and the outer seam is intent-out / assert-in with phase-boundary handoff.** faff already launches containers — the env slot's `docker compose up` stands up the SUT. So the invariant, precisely: **faff never launches or widens a *cage* (a permission envelope an agent lane runs in) and never self-grants; SUT containers are *workload*, not authority.** The outer orchestration layer is the existing HOST altitude (a human today; a CI runner or factory-compute host later) acting under authority a human granted at setup. The seam faff exposes to it:

- **Intent-out:** faff emits a declarative lane-boundary intent artifact (machine-readable, versioned — the env-handle/profile contract shape); it contains what boundaries the lanes need, never a launch instruction faff executes.
- **Assert-in:** each lane runs a `container-check`-shaped preflight at entry and **refuses** if the boundary it was promised is absent — per-lane assert-and-refuse, the ADR-0010 posture applied at lane granularity.
- **Cross-cage dispatch happens at phase boundaries through artifacts, never a live channel:** the orchestrator emits a request artifact (e.g. an evaluation request), the outer layer runs the target cage, and the orchestrator consumes the result at its next dispatch boundary, validating it through the existing contracts (`holdout-verdict`'s `code_blind` + shape) plus the rung-1 integrity mechanism. A shared-volume transport is explicitly integrity-gated (it is exactly ADR-0039's forgeable-artifact surface); the concrete transport and manifest schema are the first consumer's (FAFF-276) build decisions.
- **The outer-layer owner is deliberately unresolved:** "first consumer decides" is recorded as an explicit boundary, not an oversight — settling it before a consumer exists would be guessing.

**3. The docker-inside-the-cage precondition is a hard L4 launch requirement, stated by criterion: the engine's authority must be bounded by the cage.** The env slot needs a container engine reachable inside the cage; *which* engine posture matters:

- A **mounted host socket fails the criterion by definition** — it is root-equivalent host control (any lane can start a privileged container and mount the host fs), which makes the cage **not host-isolated at all**: ADR-0010's own contract ("host-isolated container + in-container allow-all") is unmet and a contained verdict from `container-check` would assert a lie. Not a lane-envelope nuance — a contract-level failure.
- **Privileged docker-in-docker partially fails** (a privileged cage weakens host isolation) — a named, documented risk.
- **Rootless nested engines** (rootless dind, podman-in-podman, sysbox-class runtimes) satisfy the criterion best and are the recommendation.
- faff's posture stays assert-don't-implement: the requirement is documented in the L4 launch preconditions; a detection probe (host-socket present ⇒ warn/refuse on the lights-out path) is a costed follow-up **assertion**; the cage image itself is claude-box's (external) concern.

**4. The decision is expressed as declared `isolation`-field semantics (FAFF-69/73 vocabulary), building none of it.** The ladder adds a `container: shared | own` axis to the role `isolation` field: rung 0 = every lane `container: shared`; rung 2 = the evaluator `container: own` with an `accesses` envelope physically excluding `repo` (FAFF-73's loader-rejection example made physical); rung 3 = all lanes `container: own`, each with its own env. The ceiling rule ("an override never weakens isolation") extends naturally to the container axis. What each rung makes *enforceable*: rung 1 — orchestrator artifacts trustworthy against the build lane; rung 2 — `code_blind: true` a physical fact rather than an attestation; rung 3 — the FAFF-32 lane→secret matrix and per-lane credentials, plus a strengthened ADR-0034 isolation co-binding. FAFF-73 stays blocked by FAFF-72 and the DSL stays deferred (ADR-0038); the field inherits settled meaning from this decision.

## Consequences

- **FAFF-276 is re-classified as triggered-now for L4** — its first-slice framing (posted on the ticket) carries the ladder position, the fired trigger, and the required assertion seam. Until it lands, every L4 holdout verdict rests on attested (not enforced) code-blindness — a known, recorded gap; operators weighing lights-out runs should weigh it.
- **FAFF-325 stays the nearest rung** (it already blocks FAFF-326); nothing here changes its content — this ADR only fixes its ladder position and confirms its trigger.
- **No build ships from FAFF-313.** The spike lands as docs (this ADR + the refutation log) + tracker comments; the intent-artifact schema, the per-lane probe, the host-socket detection probe, and any SVG/doc guidance corrections (the current architecture SVG blesses "mounted socket / docker-in-docker" — now wrong for L4 under the boundedness criterion) ride with the follow-up builds, chiefly FAFF-276.
- **ADR-0010 is extended, not amended:** its wording stands verbatim; this ADR adds the cage/workload distinction (decision 2), the boundedness criterion for the in-cage engine (decision 3), and the explicit rule that rung 3 reopens ADR-0010 through its own :48(a) trigger.
- **FAFF-32/104 gain a precise unlock condition:** their matrix is buildable as specification any time, but *physically enforceable* only at rung 3 — recorded on their tickets so nobody builds enforcement below the rung that can hold it.
- **Costed follow-ups:** the per-lane assertion probe + intent-artifact schema (with FAFF-276); the host-socket detection probe on the lights-out preflight (small, assert-only); the SVG/guidance correction (rides with either).
- **Revisit triggers:** if a live channel between cages ever becomes necessary (phase-boundary handoff proves insufficient for a real consumer), decision 2 is revisited — a live cross-lane channel is exactly what ADR-0034's isolation co-binding warns against; if the tracker stops being human-gated, ADR-0010's :48(b) governs as before.
