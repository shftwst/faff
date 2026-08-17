# ADR 0061 — Assert-the-boundary over signatures for corrective-artifact integrity

- **Status:** Proposed
- **Amended:** 2026-07-16 — ADR-0074 (FAFF-514) adds the content-origin/boundary-origin split: faff owns the declaration's *content* (the `faff integrity-boundary` emitter) while the launcher still owns *setting* it and the cage owns the mount. Every consequence below stays in force.
- **Amended:** 2026-08-17 — ADR-0114 (FAFF-833) adds a second, weaker corrective trust basis (digest-custody) folded on the consumer side, never through the `FAFF_INTEGRITY_BOUNDARY` channel. The two-basis non-conflation rule stays in force.
- **Date:** 2026-07-12
- **Issue:** FAFF-325

## Context

ADR-0039 admitted Sentry-2 Channel A (subtractive corrective authority) GO-narrow, **conditional on** a corrective-artifact integrity mechanism: under shared uid+fs, the build subagent can forge any on-disk artifact the orchestrator trusts, including a corrective input or — per the FAFF-316 frontier audit's finding F1 — a merge-floor artifact (`ac-checklist.json`, `review-verdict.json`, the holdout verdict). ADR-0039 named two candidate mechanisms and left the choice open: a **read-only mount** of the trusted-artifact surface for the build subagent, or **orchestrator-verified signatures** checked before consumption. FAFF-373 shipped the fail-safe half — an inert probe that returns `asserted:false` for every input, plus the closed `integrityGate` consumer vocabulary — deliberately leaving the trust signal unwired pending this decision.

## Decision

**Assert the boundary; do not sign it.** The trusted attestation signal is an outer-layer, launch-time declaration (`FAFF_INTEGRITY_BOUNDARY=<version>:<ro-dir-set>`) read **only** from pid-1 environ (`/proc/1/environ`) — never the CLI's own inherited process environment, which is poisonable via profile files on the shared fs. This closes ADR-0039's open alternative in favour of the mount side: under shared uid, a faff-held signing secret is build-lane-readable (`bin/faff:1683`, guardrail-not-crypto), so a signature scheme would give false assurance at this rung — the verifier and the forger would share the same key material. A read-only mount boundary has no such symmetry: the build lane cannot write what it cannot mount write-access to, regardless of what it reads.

Consistent with ADR-0010 (containerised Claude Code, not a faff-owned sandbox), faff's role is **assertion, not creation**: it reads and trusts the outer layer's declaration; it does not provision the mount or enforce the boundary itself. `correctiveIntegrityProbe` asserts `true` only when the declaration is present in pid-1 environ, well-formed, and its declared directory set covers the dirs being asserted for (now extended, per F1, to the three merge-floor artifacts alongside the original `corrective/` + `run-ledger.json`). Every other case — absence, or a declaration that fails verification (env-injection, malformed, dir-mismatch) — is `asserted:false`, with `basis` distinguishing honest absence from tamper evidence. `integrityGate` consumes this for two call sites: the L4 run-start preflight (refuses admission on absence or violation) and `cmdMergeGate`'s `consumer="merge-floor"` (refuses on violation at every level; refuses on absence only at L4, defence-in-depth; annotates and proceeds on absence at L1–L3).

## Consequences

- **No faff-built signing/HMAC path is added, ever, for this purpose** — the rejection is settled, not merely deferred; a future proposal to sign corrective or merge-floor artifacts must first overturn the shared-uid-readable-secret argument above, not just propose better crypto.
- **The boundary's existence is an external precondition faff cannot force.** Without the outer layer setting the pid-1 declaration and providing the read-only mount, the probe stays `asserted:false` forever — correct fail-safe behaviour, not a bug. Docs must say this explicitly: FAFF-325 asserts a boundary, it does not create one.
- **Constrains every future integrity consumer** (FAFF-326's Channel A, FAFF-324's detection-consumer strength, and any later `integrityGate` caller) to the same pid-1-only read and the same closed, single-sourced directory-set contract — no consumer may invent its own trust signal or a second hand-written dir list.
- **L4 carries the cost, L1–L3 carry the annotation.** Because the mount is cage-mandated at L4 (ADR-0010/0041) but not at L3, refusing admission on absence is a one-line launch-config fee at L4 and would be a disproportionate tax at L3 — so L1–L3 runs proceed with a visible `integrity: unasserted` annotation on every unasserted merge rather than being blocked.
- **The level input to the merge-floor disposition must arrive via invocation context, never a shared-fs artifact** — a build lane that could forge its own "L1" label would downgrade an L4 refusal to an L1–L3 annotate-and-proceed, reopening the same forge this ADR closes.
- **readHoldout freshness/containment hardening is explicitly out of this boundary** and forked to FAFF-420; this decision assumes it lands independently and does not depend on it.

**Self-review:** checked against the shipped diff — `correctiveIntegrityProbe` reads only the injectable `fsq.readEnviron("/proc/1/environ")` seam, never `process.env`; no signing/HMAC code was added anywhere in this change; `cmdMergeGate` takes the run level from its own invocation-context argument, not from `run-ledger.json` or any other shared-fs artifact (covered by the forged-ledger-level test). No drift between the decision as recorded here and what shipped.

confidence: high
