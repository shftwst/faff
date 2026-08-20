# ADR 0118 — Digest-custody basis grants the merge floor at a narrowed detective authority

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-20
- **Issue:** FAFF-892

## Context

The merge floor's corrective-integrity leg (`resolveIntegrity` in `merge-gate.js`) recognised only one trust basis: the pid-1 `FAFF_INTEGRITY_BOUNDARY` mount declaration (ADR-0061, assert the boundary). Under single-session subscription economics the real read-only mount is deferred (ADR-0073 decision 3: the mount can never be truthfully declared today), so an honest run resolves to `basis: no-declaration`, which the leg mapped to `unasserted-refuse` at L4. The `lights-out --check` preflight already treats the same honest absence as an advisory degrade and proceeds on the FAFF-518 digest-custody floor (FAFF-525), so the two gates disagreed: a runbook-correct L4 run could mint, build, pass adversarial review and the code-blind holdout, and then be refused at the merge floor on a condition it could never satisfy.

ADR-0114 granted the digest-verified custody basis, but scoped it explicitly to the `corrective` consumer (the Sentry-2 stop-and-redispatch decision), via the fixed five-branch fold `foldCorrectiveAuthority`. It deliberately left the merge floor out of scope: "the digest mechanism never reached the corrective authority decision" for merge-floor. That left the merge-floor grant an open, unrecorded question.

## Decision

The merge floor admits the digest-verified custody basis as a distinct, weaker trust class than mount-asserted, at a narrowed detective authority, composed at a new pure fold — the merge-floor sibling of ADR-0114's `foldCorrectiveAuthority`.

- **Composition, not gate-patching.** A new pure `foldMergeFloorAuthority(mountGate, digestVerify)` lives beside `integrityGate` in `corrective-integrity.js`; `integrityGate` and `integrity-digest.js` stay byte-untouched. The fold mirrors `foldCorrectiveAuthority` but adds a mount-violation branch (branch 2), because `integrityGate(_, "merge-floor")` — unlike the corrective consumer — returns `refuse` on a `VIOLATION_BASES` probe. That branch sits above the digest consult, so a clean digest never rescues a forged, malformed, or dir-mismatched declaration. Precedence is the safety argument.
- **A distinct trust class.** The grant surfaces as a new `FLOOR_INTEGRITY` value, `custody-trusted`, not folded into `unasserted-ok` (ADR-0073 decision 5: the digest basis must surface as its own class). The merge record annotates the truthful basis rather than collapsing it into `unasserted`.
- **Two-basis non-conflation holds.** The digest verdict is never fed through `FAFF_INTEGRITY_BOUNDARY`, `correctiveIntegrityProbe`, or the pid-1 environ read. It is admitted only via the existing `computeCustodyVerdictAdmission` against a caller-retained sha256, never a bare writable-path read.
- **Uncertainty fails toward refuse.** Only an affirmatively clean digest over the exact per-issue forge surface grants; an uncomputable verify, a tamper result, a digest mismatch, or an absent verdict all refuse. With no digest bracket run at all, the leg falls through to today's L4 `unasserted-refuse` exactly (no regression).

The producer of the custody verdict this leg reads is FAFF-893 (the interactive `--local` path); this ADR governs the consumer only.

## Consequences

- A runbook-correct L4 run with honest-absent `FAFF_INTEGRITY_BOUNDARY` and a clean per-issue custody verdict reaches merge-ok on the `custody-trusted` basis; the merge floor is fail-closed and truthful, and the preflight/merge inconsistency is closed.
- The grant is a narrowed detective authority, not the mount-asserted guarantee: on the interactive path it is a self-consistency stamp (per FAFF-893), security-empty by construction, and must never be presented as the strong mount basis. A future reader who treats `custody-trusted` as mount-asserted, or routes the verdict through `FAFF_INTEGRITY_BOUNDARY`, violates this ADR and ADR-0061/0073/0114.
- When the real read-only mount lands (FAFF-517), mount-asserted returns as the strongest basis (fold branch 1) and this change needs no rework; `custody-trusted` becomes the interim/complementary floor, never a replacement.
- Scoped to the sequential executor at v1, inheriting ADR-0114's parallel-executor deferral (concurrent lanes can race the forge surface).
- The pure-core enum widened by one value; every hand-derivation site that keys on the integrity state (`alreadyMergedReconcile`) treats `custody-trusted` as non-blocking, and the `integrity-floor` contract carries fixtures for the grant.
