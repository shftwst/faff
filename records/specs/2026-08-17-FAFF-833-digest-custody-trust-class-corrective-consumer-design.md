# Spec — FAFF-833: Digest-custody trust class for the corrective consumer

> Spec: faffter-dark-nlspec · 2026-08-16 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-833.

> Spike / design ticket. Audience: the human reviewers who will accept or reject the decision, the ADR author who will promote it, and the build agent who will implement the follow-on fold. This spec settles one decision and emits an ADR-promotion intent; it ships no production code itself (the FAFF-278 / FAFF-328 spike shape).

## 1. WHY — Problem and principles

**The load-bearing idea.** Two integrity bases exist for the corrective consumer, and they are different in kind. The mount-asserted basis (`FAFF_INTEGRITY_BOUNDARY`, ADR-0061) is *preventive*: the build lane structurally cannot write the forge surface, so a corrective artifact on disk is authentic by construction. The digest-custody basis (`integrity-digest`, FAFF-518, ADR-0073 decision 5) is *detective*: the build lane can write anything, but the trusted dispatcher snapshots the evidence set before dispatch, holds the manifest in its own context, and re-verifies on return, refusing to consume on mismatch. This spike decides whether the detective basis may authorize the `corrective` consumer to Channel A, and at what narrowed authority.

**Problem statement.** Today `integrityGate(probe, "corrective")` returns `trusted` only when `basis === "asserted"` (the mount path). Under ADR-0073, that mount does not exist in-session and is deferred to the portability era, so corrective authority is stuck at `channel-D-only` (human relay) with no in-session path. The digest-custody mechanism is shipped and emits its own `digest-verified` trust class, but only backstops the merge-floor and general obligations; it never reaches the corrective authority decision. Channel A is therefore built (FAFF-326) but unreachable under the governing architecture.

**Design principles.**

- **Two bases, never conflated.** The mount basis and the digest basis are separate authorities (ADR-0061; ADR-0073 decision 5). A digest verdict must never feed the `FAFF_INTEGRITY_BOUNDARY` channel, and must never be recorded as, or masquerade as, mount-asserted. The `integrity-digest` module's own selftest enforces this at the code level (it may not reference `integrityGate` or the mount env var); this spike must not weaken that.
- **Detective is weaker than preventive, and the record must say so.** Admitting the detective basis does not upgrade it to the preventive one. Every authority granted on it is recorded under a distinct, weaker basis label, so the honest residuals travel with the decision rather than being laundered away.
- **Fail-safe when custody is absent.** If the manifest is not held at consumption time (lost to compaction, never snapshotted), the basis degrades to `channel-D`, never to trust. A detected tamper is worse than absence and degrades to `refuse`, never to `channel-D` (a channel-D artifact is surfaced for a human; a proven-forged one must not be).
- **Width is set by provenance, not by the integrity basis.** ADR-0039's subtractive-only limit comes from the machine-authored input having no human-gated provenance. That limit is independent of whether authenticity is mount-prevented or digest-detected. The basis governs *authenticity*, not *how far the input may go*.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript | `integrityGate(probe, "corrective")` — the mount-basis decision, `trusted` only on `basis:"asserted"` |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript | `buildManifest` / `diffAgainstManifest` — the detective custody mechanism and its `digest-verified` verdict; boundary selftest at lines 311-316 |
| `plugin/skills/faff/bin/lib/corrective.js` | JavaScript | `cmdCorrectiveCheck` (lines 458-467) — the corrective consumer's decision site, calls `integrityGate` directly |
| `plugin/skills/faff/bin/lib/sentry.js` | JavaScript | `sentryReadCorrectiveAuthority` (line 776) — spawns `corrective-integrity --consumer corrective`, maps `trusted===true` → `available` to enable the `correct` rung |
| `records/adr/0073-…lane-isolati.md` | Markdown | Decision 5 sanctions digest-bracketing as the interim rung and its own trust class; lists the honest residuals |
| `records/adr/0061-…integrity.md` | Markdown | Assert-don't-sign; the two-basis non-conflation rule |
| `records/adr/0039-…gated.md` | Markdown | Channel A is subtractive, stop-and-redispatch, integrity-gated, provisional on FAFF-328 |
| FAFF-328 spec (branch `faff-328-live-run-validation-of-channel-a-corrective-authority`) | Markdown | "Live means live" — forbids the seam-injected `asserted:true`; checkpoint 4 names "asserted integrity" |

**Scope statement.** This is the decision that makes Channel A reachable in-session, sitting between ADR-0073's sanction of the rung and the follow-on build ticket that wires the fold.

## 2. Out of scope

- **Building the mount-asserted path** — deferred lane-isolation work, tracked by FAFF-834. *Why excluded:* ADR-0073 defers process-isolated lanes to the portability era. *Extension point:* when the mount lands, the fold's first branch (mount basis → strongest) already accepts it with no change.
- **The lane-containerisation decision itself** — FAFF-834. *Why excluded:* an architecture decision of its own; this spike assumes single-session operation as given. *Extension point:* FAFF-834's ADR.
- **Re-testing FAFF-518's tamper detection** — FAFF-518's own ACs own snapshot/verify/symlink/prefix correctness. *Why excluded:* this spike consumes `diffAgainstManifest` as a trusted primitive; it does not re-verify forgery resistance. *Extension point:* FAFF-518's test suite.
- **Executing the FAFF-328 trial** — FAFF-328. *Why excluded:* this spike decides whether FAFF-328 *accepts* a digest-custody-basis run and what its claim narrows to; it does not run the trial. *Extension point:* FAFF-328's TrialRecord and the checkpoint-4 wording touch named below.
- **The parallel-executor digest custody** — deferred (see residuals). *Why excluded:* the concurrency slot's in-flight orchestrator writes break a naive snapshot/verify bracket. *Extension point:* a future ticket, mirroring ADR-0039's per-run-at-v1 / fleet-deferred split.

## 3. WHAT — Vocabulary, types, and the fold contract

**Vocabulary.**

| Term | Definition |
|---|---|
| Mount basis | The preventive integrity basis: `correctiveIntegrityProbe` asserts `true` from a pid-1 `FAFF_INTEGRITY_BOUNDARY` declaration covering the forge surface |
| Digest-custody basis | The detective integrity basis: a manifest snapshotted before dispatch, held in the dispatcher's context, and verified clean on return via `diffAgainstManifest` |
| Held manifest | The `buildManifest(runDir, issue)` output the trusted orchestrator retains across the untrusted build-subagent dispatch; the secret is custody of it, not a key on disk |
| Custody-trusted | The new, weaker authority disposition granted on a clean digest verify, distinct from mount `trusted` |
| Forge surface (corrective) | `correctiveIntegrityDirs(runDir[, issue])` — the 2-entry run set or 7-entry per-issue set; contains no `events.jsonl` at this consumer |

**The composition fold — the core mechanism this spike specifies.** A new pure function folds the two independent basis results into one corrective-authority decision. It lives at a *separate composition point*, importing both primitives; it does not extend `integrityGate` and does not touch `integrity-digest.js`.

```
RECORD CorrectiveAuthority:
  trusted: Bool
  disposition: ENUM { trusted, custody-trusted, refuse, channel-D }
  basis: ENUM { asserted, digest-verified, tampered, unverifiable, none }

PROCEDURE foldCorrectiveAuthority(mountGate, digestVerify):
  # mountGate  = integrityGate(correctiveIntegrityProbe(env, fsq, dirs), "corrective")
  # digestVerify = one of: { held: false }
  #                        | { held: true, diffs: [] }        (clean)
  #                        | { held: true, diffs: [<paths>] } (tampered)
  #                        | { held: true, error: <reason> }  (verify could not be computed)
  1. IF mountGate.trusted === true:
       RETURN { trusted: true,  disposition: "trusted",         basis: "asserted" }      # strongest wins
  2. IF digestVerify.held === true AND digestVerify.error != null:
       RETURN { trusted: false, disposition: "refuse",          basis: "unverifiable" }  # verify could not run: never trust
  3. IF digestVerify.held === true AND digestVerify.diffs.length === 0:
       RETURN { trusted: true,  disposition: "custody-trusted", basis: "digest-verified" }
  4. IF digestVerify.held === true AND digestVerify.diffs.length > 0:
       RETURN { trusted: false, disposition: "refuse",          basis: "tampered" }       # proven forge: never surfaced
  5. RETURN { trusted: false, disposition: "channel-D",         basis: "none" }           # no basis held: fail-safe
```

The indeterminate-verify branch (2) is load-bearing and precedence-ordered: `diffAgainstManifest` fails loud by design (`resolveHasher` and `sha256` throw when the hasher cannot be resolved or a member cannot be read), and that path is reachable under the accepted tool-poisoning residual — a same-uid lane that makes the hasher spawn fail turns a real verify into a throw. The build ticket must map that throw to `{ held: true, error }` (never catch-and-default to empty diffs), so a sabotaged verify degrades to `refuse`, not `custody-trusted`. A verify that cannot be computed must never read as clean.

**Authority width is unchanged.** A `custody-trusted` decision authorizes exactly the same subtractive, stop-and-redispatch Channel A that mount `trusted` does (ADR-0039: park-with-cause, forbid-surface, tighten-threshold, descope-to-subset). The narrowing is entirely in the basis label and the additional precondition (a clean verify at consumption time), not in the op-set. Additive inputs still route to park / needs-human exactly as today.

**Interfaces the fold plugs into.**

- `cmdCorrectiveCheck` (corrective.js) gains a `--manifest <json|file|->` input (the same shape `integrity-digest verify` already accepts) and, when a manifest is supplied, computes `digestVerify` via `diffAgainstManifest(runDir, manifest)` and routes through `foldCorrectiveAuthority` instead of calling `integrityGate` alone. With no manifest, `digestVerify.held === false` and behaviour is byte-identical to today.
- The `corrective-consumed` event payload gains a `basis` field (`asserted` | `digest-verified`) so the audit trail and the FAFF-328 record can state which basis authorized each consumption.
- `sentryReadCorrectiveAuthority` must obtain the held manifest to enable the `correct` rung under the detective basis. The exact plumbing (whether sentry spawns `corrective check --manifest …` or a dedicated authority command) is a build-ticket concern (punt below); the fold contract above is fixed.

## 4. HOW — the decision and its mechanics

**Approach.** No production code ships from this spike. It delivers the settled decision, the fold contract above, the residual disposition, the FAFF-328 handling, the ADR-promotion intent, and a filed follow-on build ticket that implements the fold against the contract. This mirrors the FAFF-278 and FAFF-328 spike shape (a recorded decision is the deliverable).

**The custody flow the fold sits inside** (context, owned by the build ticket, stated here so the fold's inputs are grounded):

```
PROCEDURE corrective_custody_bracket:
  1. Before dispatching the untrusted build subagent, the orchestrator snapshots the
     corrective forge surface:  manifest = buildManifest(runDir, issue)   # held in context
  2. Dispatch the build subagent (it may write anything on the shared fs)
  3. On return, before consuming any corrective artifact:
     a. diffs = diffAgainstManifest(runDir, manifest)   # absolute root-owned hasher
     b. foldCorrectiveAuthority(integrityGate(...,"corrective"), { held: true, diffs })
     c. custody-trusted  -> fold the subtractive constraints (unchanged Channel A path)
        refuse (tampered / unverifiable) -> never consume; surface the cause; route to human
        channel-D         -> surface for human relay (today's behaviour)
```

The verify step must map a `diffAgainstManifest` throw (hasher unresolvable, member unreadable) to `{ held: true, error }`, never absorb it into an empty-diffs clean result. This is the one place a naive `try/catch` would silently convert a sabotaged verify into a grant.

**Residual disposition.** ADR-0073 decision 5 named four honest residuals of digest-bracketing. This spike rules on each before granting Channel A on the basis.

| Residual | Ruling | Rationale |
|---|---|---|
| Same-uid tool-poisoning arms race | Acceptable at the narrowed authority, with the sabotage-to-throw path handled | Already mitigated (not eliminated) in `integrity-digest.js`: absolute root-owned hasher list, sanitized env for the Perl `shasum`. This is exactly the gap the mount would close and the detective basis cannot; naming it under the `digest-verified` label is the narrowing, not a defect to fix here. The one live consequence the fold must handle: a poisoning that makes the hasher spawn fail turns the verify into a throw, which branch 2 maps to `refuse`/`unverifiable` (never a clean grant). |
| Digest custody across compaction | Must be closed | The fold fail-safes on `held:false` (branch 5 → `channel-D`), so a manifest lost to compaction can never read as trust. The build ticket must verify immediately on return and treat a missing held manifest as `held:false`, never reconstruct-and-trust. |
| Append-only files as prefix-preserving | Not in play for this consumer | The corrective forge surface (`correctiveIntegrityDirs`) contains no `events.jsonl`; the prefix-preserving rule applies only to the detection consumer's surface. `diffAgainstManifest` already handles it correctly regardless. |
| Parallel-executor bookkeeping | Deferred; grant sequential-only at v1 | The concurrency slot's own in-flight orchestrator writes between snapshot and verify would false-positive as tampering. At v1 the custody basis is granted only under the sequential executor (single writer). Parallel custody is a named follow-on, mirroring ADR-0039's per-run-at-v1 / fleet-deferred split. |

**FAFF-328 handling.** FAFF-328's "live means live" forbids the seam-injected `asserted:true`. A real digest-custody bracket is not that seam: the build subagent genuinely runs, genuinely can write the fs, and the trust is genuinely earned by a real verify. So FAFF-328 *accepts* a digest-custody-basis run as a valid live basis. But its checkpoint 4 reads "returns `trusted` under asserted integrity", which names the mount basis specifically. A digest-basis run returns `custody-trusted` under `digest-verified`, not mount `asserted`. Therefore:

- FAFF-328 admits a digest-custody-basis run and records its verdict as `confirm` **narrowed to the digest-custody (detective) basis**, with mount-asserted (preventive) integrity named as outstanding future evidence in the TrialRecord.
- FAFF-328's checkpoint-4 wording is touched to read "under a genuine (non-seam) integrity basis, with the basis recorded" rather than "under asserted integrity", and the TrialRecord gains the basis on each corrective-consumed observation. This is a minor spec touch on FAFF-328, not a redesign; it is listed as a dependency, not owned here.

This lets Channel A's provisional GO be discharged in-session at the detective basis, while ADR-0039's mount-basis discharge remains a future evidence item for the portability era.

**Failure modes.**

- **The fold silently launders detective as preventive.** *How you'd know:* a `corrective-consumed` event carries `basis:"asserted"` on a run where no pid-1 declaration existed, or the `integrity-digest` boundary selftest fails after the change. *What it means:* abandon that implementation; the two bases must stay distinct all the way to the recorded event. The fold's branch 1 is the only source of `basis:"asserted"`.
- **The custody claim is hollow because the manifest was never really isolated.** *How you'd know:* the manifest is read from a shared-fs path at verify time rather than held in the dispatcher's context. *What it means:* the basis provides no assurance (a same-uid lane could rewrite the on-disk manifest to match its forgery); the fold's `--manifest` input must receive the context-held value, not re-read a fs artifact the build lane could touch.
- **Detected tamper is treated as absence.** *How you'd know:* a run with `diffs.length > 0` surfaces the artifact for human relay (`channel-D`) instead of refusing. *What it means:* branch 4 is wrong; a proven forge must `refuse`, never be surfaced as if it were an honest unasserted input.
- **An indeterminate verify is treated as clean.** *How you'd know:* a `corrective-consumed` event carries `basis:"digest-verified"` on a run where the hasher could not be resolved or a member could not be read (the verify actually threw). *What it means:* the implementer caught the `diffAgainstManifest` throw and defaulted `diffs` to empty; branch 2 exists precisely to stop this. A verify that cannot be computed degrades to `refuse`/`unverifiable`, because the un-computable path is reachable by the accepted tool-poisoning residual, so treating it as clean would be the residual's own escalation into a false grant.

**Anti-pattern:** extending `integrityGate` to take a custody input. Why: it pulls the digest basis into the mount-basis module and invites the two bases to be returned through one code path, which is the conflation ADR-0061 and ADR-0073 forbid. The fold is a separate composition point by design.

**Anti-pattern:** importing `integrityGate` or referencing `FAFF_INTEGRITY_BOUNDARY` from `integrity-digest.js` to do the fold there. Why: it breaks that module's boundary selftest and re-couples the detective mechanism to the mount channel. The fold's home is the consumer side (corrective.js), which already imports both primitives.

## 5. Scenarios

These express the fold contract as born-verifiable behaviour for the follow-on build ticket. Zero holdouts (a spike deliverable is the decision, not a graded feature).

```
Given a corrective artifact on disk and no pid-1 mount declaration
When the orchestrator holds a manifest snapshotted before dispatch and the on-return verify is clean
Then foldCorrectiveAuthority returns { trusted: true, disposition: "custody-trusted", basis: "digest-verified" }
     and the corrective-consumed event records basis: "digest-verified"
```

```
Given a corrective artifact on disk and a held manifest
When the on-return verify reports one or more tampered paths
Then foldCorrectiveAuthority returns { trusted: false, disposition: "refuse", basis: "tampered" }
     and the artifact is never consumed nor surfaced as an honest human-relay input
```

```
Given a corrective artifact on disk and a held manifest
When the on-return verify cannot be computed (the hasher throws — e.g. a poisoned/unresolvable hasher)
Then foldCorrectiveAuthority returns { trusted: false, disposition: "refuse", basis: "unverifiable" }
     and the artifact is never consumed (a verify that could not run never reads as clean)
```

```
Given no manifest is held (never snapshotted, or lost to compaction) and no pid-1 mount declaration
When the corrective consumer runs
Then foldCorrectiveAuthority returns { trusted: false, disposition: "channel-D", basis: "none" }
     which is byte-identical to today's unasserted corrective behaviour
```

```
Given a valid pid-1 mount declaration covering the forge surface
When any digest state is present
Then foldCorrectiveAuthority returns { trusted: true, disposition: "trusted", basis: "asserted" }
     (the strongest basis wins; the digest state does not alter or dilute it)
```

## 6. Design decision rationale

**Should the shipped `digest-verified` trust class authorize the `corrective` consumer to Channel A at all?**
Options: (a) admit as a distinct weaker basis; (b) reject and keep corrective at `channel-D-only` until the mount lands. Reject was weighed: the detective basis cannot match the mount's preventive guarantee, and the tool-poisoning arms race stays open. But ADR-0073 already made the governing call that the mount is deferred indefinitely under single-session economics, and decision 5 explicitly sanctioned digest-bracketing as the interim rung "surfacing as its own trust class (e.g. an `integrityGate` basis distinct from mount-asserted)". Rejecting would leave Channel A permanently dead code in-session with no path. The residuals are named and bounded, and the fail-safe branches ensure absence and tamper never read as trust.
**Chosen:** admit `digest-verified` into the corrective authority decision as a distinct, weaker basis, never via the mount channel.

**At what narrowed authority does Channel A operate on the detective basis?**
Options: (a) same subtractive width, recorded under a weaker basis; (b) a further-restricted op subset (e.g. park-only). Width in ADR-0039 is a function of provenance (machine-authored, no human gate), not of the integrity basis, which governs authenticity. Restricting the op-set would conflate two independent axes and hobble the mechanism for no safety gain, since the detective basis already refuses on any detected forgery.
**Chosen:** same subtractive, stop-and-redispatch width as mount-asserted, recorded under the distinct `custody-trusted` / `digest-verified` label, with the added precondition of a clean verify at consumption time.

**Where does the authority decision physically live?**
Options: (a) extend `integrityGate` to take a custody input; (b) a separate composition point folding the two primitives. Option (a) pulls the digest basis into the mount-basis module and risks the single-path conflation ADR-0061 forbids. A separate fold keeps `integrityGate` pure, keeps `integrity-digest.js` clean (its boundary selftest intact), and puts the deliberate composition in one auditable place on the consumer side.
**Chosen:** a separate composition fold (`foldCorrectiveAuthority`) in `corrective.js`, importing both `integrityGate` and `diffAgainstManifest`; neither the mount module nor the digest module is modified to reference the other.

**Which honest residuals must be closed before granting Channel A on this basis?**
Ruled per the residual table in HOW: custody-across-compaction must be closed (fail-safe on absent manifest); tool-poisoning is acceptable and already mitigated; append-only prefix checks are not in this consumer's surface; parallel-executor custody is deferred with the grant limited to the sequential executor at v1.
**Chosen:** grant the detective basis for single-writer (sequential) runs at v1, with compaction fail-safe mandatory and tool-poisoning accepted as the named narrowing; defer parallel-executor custody.

**Does this let FAFF-328's trial run under a genuine-but-detective basis, and what does its verdict claim narrow to?**
A digest bracket is a real mechanism, not the forbidden seam, so FAFF-328 accepts it as a live basis; but its checkpoint 4 names mount `asserted` integrity specifically, so a digest-basis run cannot claim the mount discharge.
**Chosen:** FAFF-328 admits a digest-custody-basis run and records a `confirm` narrowed to the detective basis, with mount-asserted discharge named as outstanding future evidence; FAFF-328's checkpoint-4 wording and TrialRecord are touched to carry the basis.

**Where does the decision get promoted?**
This revisits ADR-0073 decision 5 (from "sanctioned rung" to "granted basis for Channel A at a narrowed authority") and touches ADR-0061 (reaffirming non-conflation via the separate fold) and ADR-0039 (admitting the detective basis as a valid live-discharge path via FAFF-328). A changed reachability of a gated capability earns its own record.
**Chosen:** promote a new ADR ("Digest-custody basis grants Channel A at a narrowed detective authority"), cross-referenced from ADR-0073, ADR-0061, and ADR-0039, authored at graft time by the follow-on build ticket.

**Open — the exact disposition/basis token names and the sentry authority-reader mapping.**
The fold contract fixes the shape and the five-way decision; the surface spelling (`custody-trusted` vs an `available-custody` value out of `sentryReadCorrectiveAuthority`, and whether that reader returns a third enum value or keeps the binary `available` / `channel-D-only`) is a naming and integration call best made against the shipped surface.
**Punt:** final token names and the sentry authority-reader return shape — needs human (decides: architecture).

**Open — where the manifest-custody plumbing lives.**
Whether the snapshot-before-dispatch / verify-on-return bracket and the `--manifest` threading are folded into FAFF-326's existing corrective surface or filed as a distinct build ticket depends on how the beep-boop and sequential-concurrency dispatch sites are structured at build time.
**Punt:** the plumbing's ticket home and dispatch-site wiring — needs human (decides: architecture).

## 7. Open questions and assumptions

**Open questions.**

- Final disposition/basis token names and the `sentryReadCorrectiveAuthority` return shape (the naming punt above). Enough context: the fold returns a distinct disposition for the detective grant; the only question is the exact spelling and whether sentry's reader exposes a third value or keeps its binary mapping while the basis rides in the event record.
- The manifest-custody plumbing's ticket home (the plumbing punt above). Enough context: the fold contract is fixed; what is open is which ticket owns the snapshot/verify bracket and the `--manifest` threading at the dispatch sites.

**Assumptions.**

- **Assumes:** FAFF-326 is shipped — the corrective CLI region (`faff corrective author|check`), the `correct` rung, the `corrective-authored` / `corrective-consumed` events, and `BuildDispatch.constraints`. *Validate:* `faff corrective check` exits with a usage error, not unknown-region; `corrective.js` is present with `cmdCorrectiveCheck`. Confirmed present in this repo at `plugin/skills/faff/bin/lib/corrective.js`.
- **Assumes:** FAFF-518 is shipped — `buildManifest`, `diffAgainstManifest`, the `digest-verified` verdict, and the absolute root-owned hasher. *Validate:* `faff integrity-digest --selftest` passes; `integrity-digest.js` exports the two functions. Confirmed present at `plugin/skills/faff/bin/lib/integrity-digest.js`.

## 8. DONE — definition of done

### From WHY
- [ ] The decision is recorded: `digest-verified` is admitted into the corrective authority decision as a distinct weaker basis, never via the mount channel, with the detective-vs-preventive distinction stated.

### From WHAT (the fold contract)
- [ ] The fold's five-way decision table is specified exactly (mount-trusted → `trusted`/`asserted`; held+unverifiable → `refuse`/`unverifiable`; held+clean → `custody-trusted`/`digest-verified`; held+tampered → `refuse`/`tampered`; not-held → `channel-D`/`none`), and the build ticket maps a `diffAgainstManifest` throw to the unverifiable branch rather than catch-and-default to clean.
- [ ] The authority width is recorded as unchanged (same subtractive stop-and-redispatch), with the narrowing located in the basis label and the verify-at-consumption precondition only.
- [ ] The `corrective-consumed` event is specified to carry the authorizing `basis`.

### From HOW (residuals and placement)
- [ ] Each of ADR-0073 decision 5's four residuals has a ruling (compaction must-close; tool-poisoning acceptable-mitigated; prefix-checks not-in-surface; parallel deferred to sequential-only at v1).
- [ ] The composition point is fixed as a separate fold on the consumer side, not an `integrityGate` extension and not an `integrity-digest.js` change; the anti-patterns are recorded.

### From the FAFF-328 handling
- [ ] The decision states FAFF-328 accepts a digest-custody-basis run as live, produces a `confirm` narrowed to the detective basis, and requires the checkpoint-4 / TrialRecord basis touch (named as a FAFF-328 dependency, not owned here).

### From the deliverable shape
- [ ] The ADR-promotion intent is emitted: a new ADR cross-referenced from ADR-0073, ADR-0061, and ADR-0039, authored at graft time by the follow-on build ticket.
- [ ] A follow-on build ticket is filed to implement `foldCorrectiveAuthority`, the `--manifest` input on `cmdCorrectiveCheck`, the event `basis` field, and the sequential-executor custody bracket, against the contract in this spec.
- [ ] No production code ships from this spike (the deliverable is the decision plus the ADR-promotion intent).

**Integration smoke test (the decision is the deliverable; this is the follow-on build's connected-plumbing check):**

```
PROCEDURE smoke:
  snapshot manifest before dispatch -> build subagent runs on shared fs ->
  verify clean on return -> foldCorrectiveAuthority returns custody-trusted/digest-verified ->
  corrective check folds the subtractive constraints -> corrective-consumed event records basis=digest-verified ->
  sentry correct rung enabled under the detective basis
```

---

confidence: high
spec-review: approve
build-tier: complex

## Clean-context self-review

Ran the inherited `faffter-noon-spec` self-review as a fresh-reasoning pass over the drafted spec against the codebase. Findings and resolutions:

- **major — the fold's manifest input must be context-held, not fs-read.** First draft implied `--manifest` could point at a file. A same-uid lane can rewrite an on-disk manifest to match its forgery, hollowing the basis. *Resolution:* added the failure mode "custody claim is hollow because the manifest was never really isolated" and stated the `--manifest` input must receive the context-held value; `integrity-digest verify` already accepts inline JSON / stdin (`-`), so the plumbing exists. Verified against `readManifestArg` in `integrity-digest.js`.
- **major — checkpoint 4 of FAFF-328 names mount "asserted" specifically.** Confirmed by reading the branch spec: checkpoint 4 reads "under asserted integrity" and the `confirm` semantics require checkpoints 1-8. A digest-basis run returns a different basis, so it cannot satisfy checkpoint 4 verbatim. *Resolution:* decision 5 now requires a checkpoint-4 wording touch and a narrowed `confirm`, named as a FAFF-328 dependency rather than silently assumed.
- **major — placing the fold in `integrity-digest.js` would break its boundary selftest.** Verified lines 311-316: the selftest asserts the module's code never references `integrityGate` or `FAFF_INTEGRITY_BOUNDARY`. *Resolution:* the fold is fixed on the consumer side (`corrective.js`, which already imports both primitives), recorded as an anti-pattern; `integrity-digest.js` is untouched.
- **minor — corrective forge surface has no events.jsonl.** Verified `cmdCorrectiveCheck` uses `correctiveIntegrityDirs(runDir)` (2 entries) / per-issue (7 entries), none including events. *Resolution:* the prefix-check residual is ruled "not in play for this consumer" rather than "closed", which is the accurate statement.
- **minor — sentry authority reader is binary.** Verified `sentryReadCorrectiveAuthority` maps `trusted===true` → `available`. A `custody-trusted` decision sets `trusted:true`, so the `correct` rung enables without a reader change; the reader shape is left as an explicit punt rather than a forced decision. No blocker.

No blocker findings; fewer than three residual majors after resolution. The `high` self-rating stands (not capped).

**Revision (spec-review round 1 → revise, infosec major).** The reviewer flagged that the fold's decision table had no branch for an indeterminate verify: `diffAgainstManifest` throws (fail-loud) when the hasher cannot be resolved or a member cannot be read, and that path is reachable under the accepted tool-poisoning residual, so a naive catch-and-default-to-empty-diffs would flip a sabotaged verify to `custody-trusted`. Applied in place: added the `unverifiable` basis and a precedence-ordered branch 2 (`held + error → refuse/unverifiable`), a matching failure mode, a scenario, a residual-table note, and the DONE update. The `high` rating stands; the fix tightened the contract without changing the approach.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "punt" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery (agile delivery lens)

**Right-sized?** No issues. The spike is a single decision unit (may the detective digest-custody basis authorize the corrective consumer to Channel A, and at what narrowed authority), and the implementation is already carved out to a separate follow-on build ticket in the DONE list. That is the correct spike/build split under principle 4: the decision ships as a recorded artifact, the code ships later against a fixed contract. The DONE list is long, but every item is a facet of the one question the spike settles (the fold contract, the residual rulings, the FAFF-328 handling, the ADR-promotion intent), not a second independent concern that could ship on its own.

**Workstream fit?** No issues. The home project "T3 — supervision stands alone" is outcome-named, and FAFF-833's outcome (make the corrective consumer's Channel A authority reachable in-session, without the deferred mount) sits squarely inside it. Corrective-integrity authority work living with the rest of the supervision-integrity cluster it relates to is cohesive (principle 5).

**Deps surfaced?** Finding. The spec places a concrete obligation on FAFF-328 (touch checkpoint-4 wording from "under asserted integrity" to "under a genuine non-seam integrity basis, with the basis recorded"; carry the authorizing basis on each corrective-consumed observation) and emits a follow-on build ticket implementing `foldCorrectiveAuthority`, but FAFF-833 carries only "relates" edges, not blocker edges. Why it matters (principle 6): a "relates" edge does not sequence, so FAFF-328 or the build ticket could be pulled "ready" ahead of the decision they consume. What to do: encode the chain FAFF-833 → build ticket → FAFF-328's in-session discharge as blocker edges. (Operator note: FAFF-328 is currently blocked by FAFF-517 for the mount path; the digest path via FAFF-833 is an *alternative*, so the two are OR-related, not both-required — wire the edge deliberately rather than as a blanket AND-blocker.)

**Risk profile?** No issues. FAFF-833 is itself the de-risking spike principle 7 prescribes for a new, security-sensitive integration (folding two distinct integrity bases into one authority decision reachable under an accepted tool-poisoning residual). Running it decision-only ahead of any build is the early de-risking the principle wants, and the spec-review round-1 catch of the indeterminate-verify branch is the return on that. The v1 grant is bounded to the sequential executor with parallel-executor custody deferred as a named follow-on, which correctly splits off the concurrency unknown.
