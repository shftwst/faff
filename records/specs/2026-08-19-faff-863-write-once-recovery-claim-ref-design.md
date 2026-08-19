# FAFF-863 — Write-once recovery-claim ref: gate the continuation boundary against a cross-box double-continue

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-863.

## Why

FAFF-820 (Done, PR #701) gave us `faff bundle-recover`: a later executor with no local run directory can retrieve and verify a Phase 0 bundle, reconstruct a run directory, and compute a **read-only** resume-or-park preview. That verb deliberately writes no owner state — `bundle-recover.js` never touches `owner.status` or `owner.epoch` — so recovery alone cannot double-continue a run.

The double-continue risk lives one step later, at the **continuation boundary** `faff lights-out --resume <run-id>`. In `lights-out.js`'s `resumeLightsOut`, STEP 5 writes the re-entry: it appends the prior owner to `owner_history` and installs a new owner block with `owner.epoch = prior_epoch + 1`, then re-admits work. Today that boundary is guarded only by the local run-ledger's own owner-liveness read (`runIsHeld`): running owner + fresh heartbeat ⇒ refuse, stale ⇒ dead-running ⇒ re-enter. That read is *local* — a fresh box recovering from a bundle cannot read the original box's heartbeat file, so two boxes can each recover to their own reconstructed root and both pass the resume preflight and both bump `owner.epoch`. FAFF-820 filed this ticket to add the real cross-box mutex at the point where owner state is actually written.

This ticket adds a **write-once recovery-claim ref on the git-remote bundle store** that at most one executor can hold for a given run segment, gating the continuation boundary so exactly one executor continues.

## What

A recovering executor that is about to **continue** (not merely preview) must acquire a write-once claim ref on the git-remote store before `lights-out --resume` writes owner state. A second executor that finds the claim already held by a live claimant refuses with a founded refused disposition. A claim held by a claimant that is stale under the reused owner-liveness rule is reclaimable, so a genuinely-stuck run is never permanently deadlocked (the concern raised in the ticket comment).

Scope guards:
- The read-only `bundle-recover` recover-and-preview path (FAFF-820) is **unchanged** — claim acquisition happens at the continuation boundary, never in the recovery verb.
- The mutex is the git-remote store only (`bundle_store: git-remote`). Under the default `local` store there is no cross-box surface, so acquisition is a no-op success (single-box, already serialised by the run-dir exclusive-create).

## How

### The claim ref shape

**Chosen:** the claim is one write-once ref per run segment, `refs/faff/recovery-claims/<run_id>/seg-<run_segment_id>`, mirroring the existing bundle-ref namespace `refs/faff/bundles/<run_id>/seg-<run_segment_id>/<boundary_key>` (`bundleRefName` in `bundle.js`). It keys on `run_id` + `run_segment_id` — the continuation boundary re-admits at run-segment / epoch granularity (one `owner.epoch` bump per resumed segment), not per bundle boundary, so the claim's grain matches the thing it gates. A custom ref (not `refs/heads/*` / `refs/tags/*`) opens no PR and triggers no CI, exactly as the bundle refs.

The claim points at a tiny orphan commit whose tree carries one `claim.json` member — the **frozen owner snapshot** of the acquiring executor: `{ run_id, run_segment_id, owner: { status: "running", epoch, session_id, started_at, last_heartbeat }, claimed_at }`. The `owner` block is the same shape the run ledger writes (`resume.js` `applyResumeToLedger`), so the staleness rule below can run the ledger's own predicate against it verbatim.

### Acquiring the claim (write-once, at the continuation boundary)

**Chosen:** acquire by reusing `gitRemoteBundleStore.put`'s exact write-once idiom — build the orphan commit with `hash-object` / `mktree` / `commit-tree`, then a single **non-force** `git push <commitSha>:<claimRef>`. Git's server-side ref-update atomicity is the compare-and-swap: creating a ref that already exists with an unrelated (non-descendant) commit is rejected as non-fast-forward. So two racing executors that both build a claim commit and push: the first creates the ref and **wins**; the second's push is **rejected** (the ref exists and the pushed orphan is not a descendant) and it has **lost** the race. A rejection whose stderr matches `STORE_UNAVAILABLE_RE` (existing constant in `bundle.js`) is surfaced as `store_unavailable`, not a lost claim. This reuses `gitRunText`, `bundleRefName`'s sibling shape, `gitReadRefManifest`, and `STORE_UNAVAILABLE_RE` rather than adding a second git-plumbing path.

### Read-after-write head-confirm (the safety pin)

**Chosen:** immediately before `resumeLightsOut` STEP 5 writes owner state, the continuer re-reads the claim ref head (`git ls-remote <remote> <claimRef>`) and proceeds only if the head SHA equals its own claim commit SHA; otherwise it refuses. This makes the ref head — not any staleness timer — the single source of truth for who continues. It closes the one race a frozen-heartbeat liveness judgement could otherwise open: if executor B wrongly reclaims a claim held by a still-live executor A (staleness misjudged), A discovers at owner-write time that the head no longer points at its own claim and refuses. Exactly one executor reaches the `owner.epoch` bump. Staleness (below) therefore only governs *when a reclaim is permitted*, never *who wins* — the CAS + head-confirm is the actual mutex, so a mistimed staleness verdict is never catastrophic.

### Staleness / reclaim rule (reuse owner-liveness, no second heartbeat)

**Chosen:** a claim's liveness is judged by the run-ledger's own predicate `runIsHeld` (`runcheck.js`) applied to the claim's frozen `owner` snapshot: `owner.status === "running"` AND `(now - Date.parse(owner.last_heartbeat)) / 1000 <= heartbeatStaleSecs(env)`. This is the exact reasoning the resume boundary already uses (`lights-out.js`: "the SAME liveness read every other seam uses — no second constant"), with `heartbeatStaleSecs(env)` the single tunable window. No new heartbeat, no claim-specific TTL constant, no refresh loop. Because a write-once ref is immutable, the embedded `last_heartbeat` is frozen at claim time: the claim reads **held** only within `heartbeatStaleSecs` of when it was taken, and **stale** thereafter — a claimant that acquired the claim and then died before continuing is presumed gone once the window elapses.

**Chosen:** a stale claim is reclaimed by a compare-and-swap supersede — `git push --force-with-lease=<claimRef>:<staleClaimSha> <newClaimSha>:<claimRef>` — which succeeds only if the ref still points at the exact stale SHA the reclaimer read. Two executors both reclaiming the same stale claim therefore cannot both win: the first CAS moves the head, the second's lease no longer matches and is rejected (it then re-reads and treats the run as freshly held). The new claim carries an incremented `claim_epoch` in its `claim.json` for provenance. `--force-with-lease` (never a bare `--force`) preserves write-once integrity: a **live** claim is never overwritten, because reclaim is only attempted after the frozen-snapshot staleness verdict, and even then only lands via the lease-matched CAS. This directly answers the ticket comment ("does a recovery claim need to get cleared later on so it doesn't deadlock if it fails again?"): a claiming executor that dies again leaves a claim that goes stale under the same window and is reclaimable again — the reclaim path is idempotently re-runnable, so repeated failure never permanently blocks recovery.

### Claim lifecycle / no active clear needed

**Chosen:** claims are left in place after use (never actively deleted), matching the write-once bundle-ref posture in `bundle.js` (bundle refs are also never GC'd). A successfully-continued segment advances the run to the next `owner.epoch` / segment, so the seg-`<n>` claim is thereafter **inert** — nothing gates on a superseded segment. This keeps the store's "write-once, never overwritten, never force-updated" invariant (only the lease-matched reclaim CAS ever moves a claim head, and only against a proven-stale predecessor). No tombstone member and no background sweep is introduced; a superseded claim's history survives in the reclaiming claim's `claim_epoch` chain and the git ref reflog, mirroring how the resume path keeps prior owners in `owner_history`.

### Refused disposition (founded)

**Chosen:** losing the claim race (a live-held claim, or a lost head-confirm) is a **founded refused disposition** in the existing family — `resumeLightsOut` emits its REFUSE via the same `emitRefuse` path it already uses for the live-running case, naming the claim ref, the holding claimant's `session_id`/`epoch`, and its liveness verdict (held vs stale). No new disposition vocabulary is invented; the continuation boundary already speaks refuse/proceed, and this adds a claim-lost refuse reason alongside the existing "owner is running with a fresh heartbeat" one. The recovery-verb `refusedDisposition` shape (`bundle-recover.js`) is the reference for the record's founded fields when a caller surfaces the claim outcome structurally.

### Where the code lands

- `bundle.js`: a small `recoveryClaimStore(root, remoteName)` (or claim methods on the git-remote store) exposing `acquire(identity, ownerSnapshot)` → `{ acquired, reason, holder? }`, `readHolder(identity)`, `confirmHead(identity, mySha)`, and `reclaimIfStale(identity, ownerSnapshot, env)` — each built from the existing `gitRunText` / `hash-object` / `mktree` / `commit-tree` / `ls-remote` primitives and `STORE_UNAVAILABLE_RE`.
- `lights-out.js` `resumeLightsOut`: between the passed preflight/budget checks (steps 1–4) and STEP 5's owner-state write, acquire (or stale-reclaim) the claim for `{ run_id, run_segment_id }`, then head-confirm; on loss, `emitRefuse` with the founded claim-held reason. Guarded on `resolveBundleStoreName(root) === "git-remote"`; under `local` the acquire is a success no-op.
- Reuse `runIsHeld` / `heartbeatStaleSecs` from `runcheck.js` for the staleness verdict — imported, not reimplemented.

## Done

- **Race → exactly one continues.** A test with two executors racing to continue the same recovered run segment (fixture in `bundle.js`'s existing git-remote test style — a shared bare remote, two work roots): exactly one `acquire` returns `acquired: true` and reaches the `owner.epoch` bump; the other gets `acquired: false` with a founded refused disposition. Assert exactly one `owner.epoch` increment on the ledger and no double re-admit.
- **Live claim blocks.** A second executor facing a claim whose frozen owner snapshot is fresh under `heartbeatStaleSecs` refuses (does not reclaim), naming the holder.
- **Stale claim reclaimable.** A claim whose frozen `last_heartbeat` is older than `heartbeatStaleSecs` (killed-claimant fixture) is reclaimed via the lease-matched CAS; the reclaiming executor continues, and a second concurrent reclaimer of the same stale claim loses the lease CAS (no double reclaim). Recovery is therefore never permanently blocked.
- **Head-confirm defeats a mistimed reclaim.** With a live claimant A and a reclaimer B that (via an injected clock) wrongly judges A stale and supersedes the ref, A's pre-owner-write head-confirm fails and A refuses; exactly one of {A, B} bumps `owner.epoch`.
- **Recovery verb unchanged.** `bundle-recover` acquires no claim and writes no owner state; its read-only recover-and-preview output is byte-identical to FAFF-820 (regression assert). Acquisition is observable only on the `lights-out --resume` path.
- **Local store no-op.** Under the default `local` bundle store, `resumeLightsOut` behaves byte-for-byte as today (acquire is a success no-op; no ref pushed).
- **No force-overwrite of a live claim.** No path performs a bare `git push --force` or overwrites a claim whose predecessor was not first proven stale; reclaim only ever lands via `--force-with-lease` against the exact read SHA.
- `faff validate-adapters` / the CLI selftest wiring stays green; the new claim methods carry a `--selftest` leg in `bundle.js`'s existing selftest style.

confidence: high
spec-review: approve
build-tier: mechanical

## Methodology critique (agile-delivery lens)

- **Right-sized?** Single 1–3 day unit, one cohesive concern (the recovery-claim mutex at the continuation boundary). Acquire + staleness + reclaim are one atomic capability, not separable concerns — no split. No issue.
- **Workstream fit?** Sits in the "unattended run survives executor loss at safe boundaries" project, consumes FAFF-820 (Done) and feeds FAFF-823 (consumes the continuation outcome). Outcome-named and cohesive. No issue.
- **Deps surfaced?** Blocker FAFF-820 Done; related FAFF-823 linked. No implicit unlinked dependency. No issue.
- **Risk profile?** The risk is distributed-mutex correctness. It is de-risked in-design by reusing the shipped write-once ref idiom and the canonical `runIsHeld` liveness predicate (not a novel mechanism) and by the CAS + read-after-write head-confirm that makes the ref head the single source of truth. No novel-integration/external-dep risk warranting a spike. No issue.

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ]
}
```
