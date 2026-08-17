# ADR 0114 — Digest-custody basis grants Channel A at a narrowed detective authority

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-08-17
- **Issue:** FAFF-833

## Context

The corrective consumer has two integrity bases, and they differ in kind. The mount basis (`FAFF_INTEGRITY_BOUNDARY`, ADR-0061's assert-the-boundary-not-signatures rule) is preventive: the build lane structurally cannot write the forge surface, so a corrective artifact on disk is authentic by construction. The digest-custody basis (`integrity-digest`, shipped by FAFF-518, the corrective-artifact digest mechanism) is detective: the build lane can write anything, but the trusted dispatcher snapshots the evidence set before dispatch, holds the manifest in its own context, and re-verifies on return, refusing to consume on mismatch.

The mount basis is deferred indefinitely. Under ADR-0073's ruling that single-session subscription economics defer process-isolated lanes to the portability era, no launcher can truthfully declare `FAFF_INTEGRITY_BOUNDARY`, because the property it attests describes a process boundary that does not exist in-session. Its corrective-integrity preflight leg is therefore an honest refuse today.

The effect is that Channel A is built but unreachable. FAFF-326 shipped Channel A (subtractive, stop-and-redispatch corrective authority, admitted GO-narrow by ADR-0039), but `integrityGate(probe, "corrective")` returns `trusted` only when `basis === "asserted"`, the mount path. That path never fires in-session, so corrective authority is stuck at `channel-D-only` (human relay) with no live route. The digest-custody mechanism is shipped and emits its own `digest-verified` trust class, and ADR-0073's decision 5 sanctioned digest-bracketing as the interim rung and named it as a trust class distinct from mount-asserted. But that mechanism only backstops the merge-floor and general obligations. It never reached the corrective authority decision, so it does not currently make Channel A reachable.

## Decision

Admit `digest-verified` into the `corrective` consumer's authority as a distinct, weaker basis. The detective basis governs authenticity, not width, so it authorizes exactly the subtractive, stop-and-redispatch Channel A that mount `trusted` authorizes (park with cause, forbid a named surface, tighten a threshold, de-scope to a subset of the already human-gated spec). ADR-0039 sets that width from provenance, not from the integrity basis, so the width is unchanged. The narrowing is entirely in the basis label and one added precondition: a clean verify at consumption time. Additive inputs still route to park or needs-human as they do today.

The decision lives at a separate composition point. A new pure function, `foldCorrectiveAuthority` in `corrective.js`, imports both primitives and folds their two independent results into one authority decision. It never extends `integrityGate`, never modifies `integrity-digest.js`, and never feeds the mount channel. The consumer side already imports both primitives, so this keeps `integrityGate` pure and keeps the `integrity-digest` boundary selftest intact.

The fold is a five-branch contract, precedence-ordered:

| Input state | Disposition | Basis | Trusted |
|---|---|---|---|
| Mount gate trusted | `trusted` | `asserted` | yes (strongest basis wins) |
| Manifest held, verify could not be computed | `refuse` | `unverifiable` | no |
| Manifest held, verify clean | `custody-trusted` | `digest-verified` | yes |
| Manifest held, verify reports tampered paths | `refuse` | `tampered` | no |
| No manifest held | `channel-D` | `none` | no |

The fail-safe branches are settled. An absent manifest (never snapshotted, or lost to compaction) degrades to `channel-D`, which is byte-identical to today's unasserted behaviour, never to trust. A detected tamper is worse than absence and degrades to `refuse`, never to `channel-D`, so a proven forge is never surfaced as if it were an honest human-relay input. An indeterminate verify degrades to `refuse` under `unverifiable`: `diffAgainstManifest` throws by design when the hasher cannot be resolved or a member cannot be read, and that throw must map to the `unverifiable` branch, never be caught and defaulted to empty diffs. A verify that cannot be computed must never read as clean, because the un-computable path is reachable under the accepted tool-poisoning residual.

The grant is limited to the sequential executor at v1. Under the concurrency slot's parallel executor the orchestrator's own in-flight writes between snapshot and verify would false-positive as tampering, so parallel-executor custody is a named follow-on, mirroring ADR-0039's per-run-at-v1, fleet-deferred split.

This decision revisits ADR-0073's decision 5, promoting digest-bracketing from a sanctioned interim rung to a granted basis for Channel A at a narrowed authority. It reaffirms ADR-0061's assert-don't-sign, two-basis non-conflation rule by keeping the fold on the consumer side and never routing a digest verdict through the mount channel. It extends ADR-0039's GO-narrow corrective authority by admitting the detective basis as a valid live-discharge path via FAFF-328 (the live-run validation trial). It does not supersede any of the three; each stays live.

## Consequences

Channel A becomes reachable in-session today, without waiting for the mount. When the orchestrator holds a manifest and the on-return verify is clean, the fold returns `custody-trusted` / `digest-verified`, the `correct` rung enables, and the corrective consumer folds the subtractive constraints on the existing Channel A path.

FAFF-328's live-run trial can now run under a genuine basis. A digest bracket is a real mechanism, not the seam-injected `asserted:true` that FAFF-328's "live means live" forbids: the build subagent genuinely runs, genuinely can write the filesystem, and the trust is earned by a real verify. So FAFF-328 accepts a digest-custody-basis run and records a `confirm` narrowed to the detective basis. Its checkpoint 4 currently reads "under asserted integrity", which names the mount basis specifically, so that wording is touched to "under a genuine (non-seam) integrity basis, with the basis recorded", and the TrialRecord carries the authorizing basis on each corrective-consumed observation. This is a dependency on FAFF-328, not owned here.

The mount-asserted discharge remains future evidence for the portability era. ADR-0039's provisional GO is discharged in-session at the detective basis; the preventive-basis discharge is named as outstanding, to be revisited when process-isolated lanes land (tracked by the deferred lane-isolation work, FAFF-834).

Implementation ships under FAFF-843, the follow-on build ticket, against the fold contract above: `foldCorrectiveAuthority`, the `--manifest` input on `cmdCorrectiveCheck` (receiving the context-held manifest value, never a re-read filesystem artifact the build lane could touch), the `basis` field on the `corrective-consumed` event, and the sequential-executor snapshot-before-dispatch, verify-on-return custody bracket. No production code ships from the FAFF-833 spike itself; the deliverable is this decision.

Honest residuals travel with the grant rather than being laundered away:

- **Same-uid tool-poisoning arms race** is accepted at the narrowed authority and already mitigated, not eliminated, in `integrity-digest.js` (absolute root-owned hasher, sanitized environment for the Perl `shasum`). This is the gap the mount would close and the detective basis cannot, which is exactly what the `digest-verified` label records. The one live consequence the fold handles: a poisoning that makes the hasher spawn fail turns the verify into a throw, which the fold maps to `refuse` / `unverifiable`, never a clean grant.
- **Parallel-executor custody** is deferred; the v1 grant covers the single-writer sequential executor only.
- **Digest custody across compaction** is closed by the fail-safe: a manifest lost to compaction reads as `held:false` and degrades to `channel-D`, never reconstruct-and-trust.
- **Append-only prefix checks** are not in this consumer's surface: the corrective forge surface (`correctiveIntegrityDirs`) contains no `events.jsonl`.

This decision supersedes nothing. ADR-0039 (GO-narrow subtractive corrective authority, integrity-gated and provisional on live-run validation), ADR-0061 (assert-the-boundary over signatures, two bases never conflated), and ADR-0073 (single-session economics defer process-isolated lanes; digest-bracketing sanctioned as the interim rung) all stay in force. This decision amends and extends them and contradicts none of their decisions: the subtractive width and integrity gate of ADR-0039 are preserved, the non-conflation and assert-don't-sign rules of ADR-0061 are reaffirmed by the separate consumer-side fold, and ADR-0073's deferral of the mount and its ban on any rung feeding `FAFF_INTEGRITY_BOUNDARY` are both respected. Promoting digest-bracketing from sanctioned rung to granted basis is the extension ADR-0073 decision 5 anticipated, not a reversal of it.
