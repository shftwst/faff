# FAFF-889 — Reuse the FAFF-863 write-once claim primitive as the build-queue mutex; demote `faff-claimed` to a breadcrumb

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-889.

This spec is for the build agent implementing FAFF-889 and the humans reviewing it. It reuses the shipped FAFF-863 `recoveryClaimStore` git-ref claim primitive (origin/main `plugin/skills/faff/bin/lib/bundle.js`) as a real build-queue mutex, so two grafts cannot build the same issue, and demotes the tracker `In Progress` status and `faff-claimed` label from mutex to human-facing breadcrumb.

## 1. WHY — problem and principles

**The load-bearing model.** A build-queue claim is a distributed mutex: at most one graft, anywhere, may build a given issue at a given time. FAFF-863 already built exactly this kind of mutex for a different boundary — a write-once git ref whose creation is a server-side compare-and-swap (a non-force `git push` that only one racer can win), with a read-after-write head-confirm as the safety pin and a lease-matched (`--force-with-lease`) reclaim for a dead holder. This change puts that same primitive underneath graft's build claim. Everything else here is consequence: which ref, when to acquire, how it is released so a re-queued issue can be built again, and how liveness is judged.

**Problem statement.** The build-queue claim today is a tracker label plus an hour-granularity TTL: `faff-graft` sets the issue `In Progress` + the `faff-claimed` label, `faff claim-verdict` judges staleness by `age + claim_ttl_hours`, and `faff-tidy` reclaims a stale claim best-effort. There is no mutex — concurrent builds are tolerated and only caught at merge by rebase-before-merge, and a live-but-slow build past the hour TTL can be wrongly reclaimed. This change makes the claim an exactly-one-winner git-ref CAS and leaves the tracker status/label as breadcrumbs only.

**Design principles.**

**The ref is the mutex; the tracker is a breadcrumb.** After this change the `In Progress` status and the `faff-claimed`/`faff-awaiting-review` labels carry the human-facing signal a git ref cannot, but nothing reads them to decide who builds. Any implementation that still consults the label to gate a build has missed the point and must be rejected.

**Liveness is heartbeat-only; the recorded `pid` is never consulted (FAFF-233).** `runcheck.js` (lines 79, 127) is explicit: the beep-boop worker pid rolls between issues and a dead recorded pid is no evidence of death while heartbeats still arrive, so `runIsHeld` judges `owner.status === "running"` AND a fresh `owner.last_heartbeat`, and nothing else. The FAFF-889 ticket description proposes a same-machine "pid probe" fast-path; that contradicts FAFF-233 and is reconciled into a heartbeat-file read below, not copied. Any design that probes a recorded pid for liveness must be rejected.

**The CAS + head-confirm is the mutex; staleness only decides *when* a reclaim may be attempted, never *who wins*.** This is the FAFF-863 safety invariant, inherited unchanged. A mis-timed or buggy staleness read can at worst trigger a reclaim attempt; the lease-matched CAS still lets only one reclaimer win, and the head-confirm still makes a wrongly-judged-dead claimant stand down before it does anything irreversible. A liveness bug therefore cannot cause a double build.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| `recoveryClaimStore` | origin/main `plugin/skills/faff/bin/lib/bundle.js` lines 615–778 | The write-once claim primitive being generalised and reused. Exposes `acquire` / `readHolder` / `confirmHead` / `reclaimIfStale`; ref name `recoveryClaimRefName(identity)`. |
| `resumeLightsOut` STEP 4b | origin/main `lights-out.js` ~1164 | The FAFF-863 caller and the integration precedent: `acquire` → on `reason:"exists"` `reclaimIfStale` → `confirmHead` before the owner write; `emitRefuse` on loss; no-op success under the `local` store. |
| `runIsHeld` / `heartbeatStaleSecs` | `runcheck.js` (~127; default `RUN_HEARTBEAT_STALE_SECS_DEFAULT = 900` in `shared-infra.js`) | Heartbeat-only liveness predicate reused verbatim for a heartbeating claimant. |
| `overlayHeartbeat` / `readHeartbeatFile` | `runcheck.js` ~241 (FAFF-355) | The dedicated live heartbeat file overlaid over `owner.last_heartbeat`. Same-box reader reads it fresh; cross-box reader has only the frozen snapshot in the ref. |
| run-dir exclusive-create | `lights-out.js` ~934 (FAFF-757) | Atomic non-recursive `mkdirSync` → `EEXIST` is the same-host uniqueness primitive; the per-issue graft worktree is its build-side analogue. |
| graft Step 5 + release paths | `plugin/skills/faff-graft/SKILL.md` ~255, ~410–412 | Where the claim is taken and cleared today (In Progress + `faff-claimed`; cleared on any terminal disposition and on retry-later). |
| tidy stale reclaim | `plugin/skills/faff-tidy/SKILL.md` ~292 | Stale (past `claim_ttl_hours`) + `faff-claimed` → In Progress→Todo, remove label. |
| `claim-verdict.js` / `config.js` | `plugin/skills/faff/bin/lib/` (`claim_ttl_hours` ~89) | Pure `age + TTL → verdict`; the hour-granularity fallback retained for a non-heartbeating claimant. |

**Scope.** This sits under graft's Step-5 claim and tidy's stale-reclaim, in the shared build-queue coordination layer that every orchestrator (graft, beep-boop) leans on.

## 2. OUT OF SCOPE

- **The FAFF-863 recovery-claim behaviour** — not changed. `resumeLightsOut` STEP 4b keeps calling `recoveryClaimStore(root)` with byte-identical results. Extension point: the generalised claim core in `bundle.js`, of which `recoveryClaimStore` becomes one thin binding.
- **Retiring `claim_ttl_hours`** — the config key stays; it is the staleness fallback for a non-heartbeating human graft. Extension point: `config.js` ~89.
- **Retiring the tracker `In Progress` / `faff-claimed` / `faff-awaiting-review` writes** — they stay as breadcrumbs, cleared on the same events as today. Extension point: graft Step 5 / release paths and tidy's state-driven label sweep.
- **A new heartbeat mechanism for build claims** — none is introduced; a heartbeating claimant reuses the run-ledger heartbeat, a non-heartbeating one uses TTL age. Extension point: `runcheck.js` liveness.
- **Bundle-store coupling** — the build claim lives on `origin`, independent of `bundle_store`. Extension point: the store constructor's `remoteName` argument.
- **rebase-before-merge** — stays as the last-line merge-time guard; it is no longer the *only* guard. Extension point: the merge gate.

## 3. WHAT — vocabulary, types, interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Build claim | A write-once git ref on `origin` asserting that one graft holds the right to build a given issue. |
| Breadcrumb | The tracker `In Progress` status and `faff-claimed` label: human-facing provenance, no longer read to gate a build. |
| Heartbeating claimant | A graft running under a lights-out owner that refreshes `owner.last_heartbeat` / the FAFF-355 heartbeat file. |
| Bare claimant | A human `/faff-graft ISSUE-XX` with no heartbeating owner; judged by `claim_ttl_hours` age, not heartbeat. |
| Frozen snapshot | The `owner` block baked into `claim.json` at claim time; immutable because the ref is write-once. A cross-box reader sees only this. |

**The generalised claim store.** The FAFF-863 primitive is generalised by extracting its core (identity → ref name, orphan-commit build, non-force-CAS acquire, head-confirm, lease-matched reclaim) and parametrising the ref-naming and the extra `claim.json` fields, so `recoveryClaimStore` becomes a thin binding and a second binding serves build claims.

```
FACTORY claimStoreCore(root, remoteName, spec):
  spec.refName:      (identity) -> String        # the ref path
  spec.identityKeys: (identity) -> RECORD        # identity fields copied into claim.json
  spec.extraClaim:   (ownerSnapshot) -> RECORD   # extra claim.json members (build store adds machine_id, heartbeating)
  spec.stalePredicate: (claim, nowMs, env) -> Bool   # "is the holder still alive?" (default = runIsHeld)
  spec.commitMessage: (identity, claim) -> String  # the orphan commit-msg (recovery keeps "recovery-claim ..."; build uses "build-claim <issue> epoch=<n>")
  RETURNS { name, acquire, readHolder, confirmHead, reclaimIfStale, release }

# FAFF-863 binding — byte-identical to today for its caller:
recoveryClaimStore(root, remoteName="origin") =
  claimStoreCore(root, remoteName, {
    refName: id -> "refs/faff/recovery-claims/<id.run_id>/seg-<id.run_segment_id>",
    identityKeys: id -> { run_id, run_segment_id },
    extraClaim: _ -> {},                 # no new members
    stalePredicate: runIsHeld })         # unchanged

# FAFF-889 binding:
buildClaimStore(root, remoteName="origin") =
  claimStoreCore(root, remoteName, {
    refName: id -> "refs/faff/build-claims/<id.issue>",
    identityKeys: id -> { issue },
    extraClaim: owner -> { machine_id: <collision-resistant host id>, heartbeating: <bool> },
    stalePredicate: buildClaimStaleAware })   # two-branch, machine-aware (HOW)
```

**Chosen: generalise by extraction, keep `recoveryClaimStore` a thin byte-identical binding.** The FAFF-863 caller (`resumeLightsOut` STEP 4b) and the `bundle.js` recovery-claim selftest must observe no change — same ref path, same `claim.json` shape `{ run_id, run_segment_id, owner, claim_epoch, claimed_at }`, same commit message. The build binding adds two `claim.json` members and swaps the ref path and staleness predicate; it never touches the recovery binding's shape. (Alternative rejected: pushing an `issue`-vs-`run_segment` conditional into the existing single function — it entangles the two callers and risks a shape drift the FAFF-863 selftest would catch late.)

**The build `claim.json`.**

```
RECORD BuildClaim:
  issue:        String                 # e.g. "FAFF-889" — the identity key
  owner:        OwnerSnapshot          # frozen at claim time
  machine_id:   String                 # collision-resistant host id; gates the same-box fast path only
  heartbeating: Bool                   # true = judge by heartbeat; false = judge by claim_ttl_hours
  claim_epoch:  Int                    # 0 on first acquire; +1 per lease-matched reclaim (provenance)
  claimed_at:   Timestamp              # ISO-8601, claim instant

RECORD OwnerSnapshot:                  # same shape the run ledger writes (bundle.js line 1185 fixture)
  status:         "running"
  epoch:          Int
  session_id:     String | null        # FAFF_SESSION_ID; the self-recognition idempotent-reacquire key
  pid:            Int                   # RECORDED FOR PROVENANCE ONLY — never read for liveness (FAFF-233)
  started_at:     Timestamp
  last_heartbeat: Timestamp            # frozen in the ref; the live value lives in the FAFF-355 heartbeat file
```

**Interface (build binding).**

| Method | Behaviour | Return |
|---|---|---|
| `acquire(identity, ownerSnapshot)` | Non-force `push <sha>:refs/faff/build-claims/<issue>` (CAS). Self-session idempotent re-acquire on `session_id` match. | `{acquired, reason?, holder?, sha?}` — `reason` ∈ `exists` \| `store_unavailable` \| `error` |
| `readHolder(identity)` | `ls-remote` + read `claim.json`. | `{status, sha?, claim?}` |
| `confirmHead(identity, mySha)` | `ls-remote`; head sha must equal `mySha`. | `{confirmed, reason?, sha?}` |
| `reclaimIfStale(identity, ownerSnapshot, env)` | Machine-aware staleness; lease-matched `--force-with-lease` supersede on stale. | `{reclaimed, reason?, holder?, sha?}` — `reason` ∈ `held` \| `lease-lost` \| `store_unavailable` |
| `release(identity, mySha)` | **New.** Lease-matched delete `--force-with-lease=<ref>:<mySha> :<ref>`. Deletes only if the ref still points at the releaser's own claim. | `{released, reason?}` — `reason` ∈ `superseded` \| `missing` \| `store_unavailable` |

`release` is the one verb the recovery claim never had. The recovery binding does not expose it (a run segment is monotonic and never released).

## 4. HOW — behaviour

### 4.1 Where the ref lives

**Chosen: on `origin`, not the bundle store.** Graft always has `origin`; the bundle store may be `local` (in which case FAFF-863's recovery claim no-ops entirely). Keying the build claim to `origin` means it works under every `bundle_store`. This is the single biggest win: git-only mode today has no cross-host build-queue claim at all (the tracker path no-ops with no tracker), and this gives it one. The `buildClaimStore` constructor therefore defaults `remoteName = "origin"` and is never gated on `resolveBundleStoreName`.

### 4.2 Release model — the crux

An issue legitimately returns to `Todo` (retry-later, tidy stale-reclaim) and is built again on a later drain, so a write-once-and-leave ref would make the second graft refuse forever. The claim needs a release verb. Two candidates:

1. **Active delete on release** — one ref per issue, `refs/faff/build-claims/<issue>`; a lease-matched delete on every terminal disposition and every reclaim.
2. **Key per attempt** — `refs/faff/build-claims/<issue>/attempt-<n>`, each ref write-once-and-inert like FAFF-863; needs an attempt counter.

**Chosen: option 1 — active delete on release, via a lease-matched delete.** Reasoning:

- **The attempt counter has no clean source where it matters most.** Option 2 needs `n` that every racer in one drain agrees on *and* that advances on re-queue. The tracker In Progress transition count does not exist in git-only mode — the biggest-win case. The run ledger is per-host, so a cross-box racer cannot read another host's ledger to compute `n`. Deriving `n` from the refs themselves (highest existing attempt) reintroduces the very liveness-of-a-prior-ref question option 2 was meant to avoid, and races during the count. Option 1's key is just the issue — identical in git-only and tracker modes, with nothing to agree on.
- **The "missed delete strands the issue" objection is bounded, not permanent.** If a graft crashes between releasing the tracker breadcrumb and deleting the ref, the stranded ref self-heals: its frozen `last_heartbeat` (or its `claimed_at` age for a bare claimant) goes stale within the window, and the next drain's `reclaimIfStale` supersedes it via the same lease-matched CAS FAFF-863 already ships. A missed delete costs one staleness window of delay, never a permanent refuse.
- **The delete is safe.** Release is `git push --force-with-lease=<ref>:<mySha> origin :<ref>` — it deletes only if the ref still points at the releaser's own claim sha, so it can never delete a claim a reclaimer already took over. No bare `--force` anywhere.

Temporal note: the ticket description leans toward option 2 as "closer fit to FAFF-863." This spec reverses that lean on the git-only attempt-counter gap and the per-host-ledger gap, which the ticket did not weigh. If a future change gives git-only mode a shared monotonic attempt source, option 2 becomes reconsiderable; until then option 1 is strictly simpler and equally safe.

**Anti-pattern:** deleting the ref with a bare `git push --delete` (no lease). Why: it would delete a claim a concurrent reclaimer legitimately re-took, re-opening the double-build the mutex exists to prevent.

### 4.3 Same-machine liveness — three rows, heartbeat-only, no pid probe

The `heartbeatStaleSecs` window exists only because a cross-box reclaimer has nothing but the frozen `last_heartbeat` in the ref, so it must wait to tell "briefly quiet" from "dead." A same-box reclaimer can read the live FAFF-355 heartbeat file and observe death now. The ticket frames the same-box advantage as a "pid probe"; the FAFF-233-compliant reconciliation is that the advantage is the *live heartbeat file read*, gated by a machine-id match — never a pid probe.

| Case | Mutex that applies | Wait? |
|---|---|---|
| Same box, both live | local exclusive-create — the per-issue graft worktree dir (atomic `mkdirSync` → `EEXIST`, the FAFF-757 idiom). The ref is redundant here. | n/a |
| Same box, one crashed | fast-path reclaim: `machine_id` matches → read the **live** FAFF-355 heartbeat file for the holder's run-dir; stale ⇒ dead **now** | no wait |
| Different machine | git-ref CAS + frozen-snapshot staleness window (`heartbeatStaleSecs`, or `claim_ttl_hours` age for a bare claimant) | wait out the window |

```
PROCEDURE buildClaimStaleAware(claim, nowMs, env):
  1. IF claim.heartbeating == false:
     # bare human graft — no heartbeat to trust; use the hour TTL age
     RETURN age(nowMs, claim.claimed_at) <= claim_ttl_hours(env)   # held iff within TTL
  2. IF claim.machine_id == thisMachineId() AND runDirResolves(claim.owner):
     # SAME BOX: read the LIVE heartbeat file (fresh), not the frozen snapshot
     liveHb := readHeartbeatFile(claim.owner run-dir)              # FAFF-355
     RETURN runIsHeld({ owner: {...claim.owner, last_heartbeat: liveHb ?? claim.owner.last_heartbeat} }, nowMs, env)
  3. # CROSS BOX (or same-box run-dir gone): only the FROZEN snapshot is available
     RETURN runIsHeld({ owner: claim.owner }, nowMs, env)          # heartbeat-only, waits the window
```

- Step 1 keeps `claim_ttl_hours` alive for the bare-human case: a human build can legitimately outlast the 900 s heartbeat window, so it must not be judged by heartbeat staleness.
- Step 2 is the same-box fast path. `machine_id` gates it so a cross-box `pid` collision can never be misread as a live holder — but note `pid` is not consulted at all; the liveness signal is the heartbeat file. A same-box crashed claim reclaims immediately off the stale live heartbeat, no conservative wait.
- Step 3 is the cross-box row: the reader has only the frozen snapshot and waits out `heartbeatStaleSecs`.

**Chosen: an explicit *collision-resistant* `machine_id` in `claim.json`, never a bare hostname.** The owner snapshot today carries `session_id` + `pid` but no machine id; inferring same-box from a local run-dir resolve is what the ticket flags as ambiguous. The id must be one that does **not** collide across distinct boxes in the containerised / CI environments this change most benefits — a bare hostname is forbidden as the source, because container and CI hosts routinely share a hostname, and a false same-box match is the one input that can make the no-wait fast path (4.3 step 2) skip the staleness wait against a genuinely-live *remote* claim. Source order: the OS machine id (`/etc/machine-id`, or the platform equivalent) as primary; where none is stable, a per-host UUID minted once into a durable path under the run root and reused, never a hostname. The id gates only *when* a reclaim may skip the wait, never *who wins*, so the CAS + head-confirm still arbitrate a wrong match — but a *collision* (too few ids) is not merely a lost optimisation, it is the double-build hazard the machine-id gate exists to prevent, so the source must fail toward uniqueness (a fresh UUID on any doubt), never toward a shared name. (Alternative rejected: inferring same-box from a run-dir/session resolve — ambiguous across users and stores, and it fails exactly when a run-dir was reconstructed elsewhere. Alternative rejected: bare hostname — collides in the exact target environments.)

**Anti-pattern:** consulting `claim.owner.pid` (e.g. `kill -0`) to decide liveness. Why: FAFF-233 — the recorded pid rolls and a dead recorded pid is no evidence of death while heartbeats arrive; cross-box a live unrelated pid gives a false "held."

### 4.4 Graft integration (Step 5)

```
PROCEDURE graft_step5_claim(issue):
  1. store := buildClaimStore(root)                       # origin; works under every bundle_store
  2. owner := { status:"running", epoch, session_id: FAFF_SESSION_ID, pid, started_at, last_heartbeat }
     machine_id := thisMachineId();  heartbeating := runningUnderLightsOutOwner()
  3. r := store.acquire({issue}, owner + {machine_id, heartbeating})
  4. IF not r.acquired AND r.reason == "exists":
        r := reclaimIfStale({issue}, owner+extras, env)   # buildClaimStaleAware inside
        # held -> refuse; stale same-box -> immediate; stale cross-box -> only after the window
  5. IF not r.acquired:
        # store_unavailable is a REFUSE, never an unguarded build (FAFF-863 posture)
        emit founded refuse: skip issue as `claimed-by-peer` (autonomous) / tell the user (interactive)
        RETURN
  6. # WON — now write the BREADCRUMBS (no longer the mutex): status -> In Progress, add faff-claimed
  7. confirmHead({issue}, r.sha) immediately before the first irreversible build side effect
     (worktree write / first commit); on !confirmed -> founded refuse, do not build
  8. record r.sha for release
```

- The self-recognition idempotent re-acquire (`session_id` match, primitive lines 685–696) already covers a human re-running `/faff-graft ISSUE-XX` within one attempt without a self-lockout.
- `store_unavailable` refuses rather than building unguarded, matching FAFF-863's STEP 4b.
- The breadcrumb writes (step 6) are unchanged from today except that they no longer decide anything; in git-only mode they are no-ops while the ref still carries the mutex.

### 4.5 Release and reclaim wiring

- **Graft, every terminal disposition** (`shipped` / `needs-human` / `fail`) **and retry-later** — in the same best-effort housekeeping block that clears `faff-claimed` and moves status today (graft SKILL ~412), also call `store.release({issue}, mySha)` (lease-matched delete). A failed release never halts the pipeline; the next drain's `reclaimIfStale` backstops a missed release exactly as it backstops a crash.
- **Tidy stale reclaim** (SKILL ~292) — for an issue whose build claim is stale under `buildClaimStaleAware`, `release` the ref (lease-matched to the stale sha) so the next drain re-acquires cleanly, alongside the existing breadcrumb move `In Progress → Todo` + remove `faff-claimed`. Tidy grooms; it does not take over the claim to build.
- **The breadcrumb sweep is unchanged.** Tidy's state-driven `faff-claimed` / `faff-awaiting-review` clears (SKILL ~296–299) still fire on the same events; only their authority is gone.

### 4.6 Failure modes

- **The failure (too many ids — safe):** `machine_id` is unstable across a container restart or a re-imaged host, so a same-box crashed claim is misread as cross-box and waits the full window instead of reclaiming immediately. **How you'd know:** a same-host crash-and-retry that measurably waits ~`heartbeatStaleSecs` before re-acquiring, when the fast path should have been instant. **What it means:** narrow, not abandon — correctness holds (it degrades to the safe cross-box row); only the no-wait optimisation is lost. Fix the id source; do not weaken the machine-id gate.
- **The failure (too few ids — the double-build hazard):** two distinct boxes share a `machine_id` (a bare hostname that collides in a container/CI fleet), and box B's `runDirResolves(claim.owner)` coincidentally resolves to a local path holding a stale heartbeat file, so box B takes the no-wait fast path against box A's genuinely-live remote claim and both build — caught only by rebase-before-merge, reintroducing the tolerated concurrency this change removes. **How you'd know:** a cross-box double-build on hosts that report the same name; the reclaimed holder's *own* heartbeat (on A) was fresh. **What it means:** this is why the id source MUST be collision-resistant (4.3 Chosen) — never a bare hostname; a fresh per-host UUID on any doubt. This failure must be impossible by construction of the id source, not merely narrowed by the run-dir gate.
- **The failure:** a lease-matched `release` silently no-ops because a reclaimer already superseded the ref (the lease no longer matches), and the releaser assumes the issue is free. **How you'd know:** `release` returns `reason: "superseded"`; the ref still exists, held by the reclaimer. **What it means:** proceed — this is correct behaviour, not a bug: the reclaimer is the legitimate current holder and must not have its claim deleted. Log it, do not retry with force.
- **The failure:** a heartbeating build's `heartbeating: true` is set but the run-dir cannot be resolved cross-box, so step 3 judges it on the frozen snapshot and (past the window) reclaims a genuinely-live remote build. **How you'd know:** a cross-box double-build survives to merge and rebase-before-merge catches it; the reclaimed holder's heartbeat file (had it been reachable) was fresh. **What it means:** this is the accepted cross-box residual — the frozen snapshot cannot see a live remote heartbeat, so a build that runs longer than `heartbeatStaleSecs` without the ref being able to observe its liveness is the known limit of a write-once snapshot. Heartbeating builds must refresh well inside the window; the merge-time rebase remains the backstop. Abandon only if cross-box builds routinely exceed the window (raise `heartbeatStaleSecs` or add a claim-refresh, out of scope here).

## 5. Scenarios

```
Given two grafts on different machines racing the same Todo issue
When both call buildClaimStore.acquire({issue}) at once
Then exactly one gets acquired:true and builds, and the other gets acquired:false reason:"exists"
     and emits a founded claimed-by-peer refuse — with no concurrent build relying on rebase-before-merge
```

```
Given an issue built once then returned to Todo (retry-later or tidy stale-reclaim)
When the releasing graft/tidy calls store.release({issue}, mySha) and a later drain acquires
Then release deletes the ref only against its own sha, and the later acquire succeeds cleanly
     (no permanent refuse under the active-delete release model)
```

```
Given a same-machine claim whose holder crashed (live FAFF-355 heartbeat file is stale) and machine_id matches
When a second same-box graft calls reclaimIfStale({issue})
Then it reclaims immediately off the live-but-stale heartbeat file with no heartbeatStaleSecs wait
     and the reclaim lands via --force-with-lease against the exact stale sha
```

```
Given two live grafts of the same issue on the same box
When both reach worktree creation
Then the per-issue worktree mkdir EEXISTs for the second (FAFF-757 exclusive-create) — the ref is not what excludes them
```

```
Given a claim held by a live remote heartbeating claimant (frozen last_heartbeat fresh within heartbeatStaleSecs)
When a cross-box graft evaluates it
Then buildClaimStaleAware returns held via runIsHeld on the frozen snapshot, the graft refuses,
     and only after the window elapses is the claim reclaimable
```

```
Given two distinct boxes A (live claim holder) and B, and a machine_id source that returns the SAME id on both (the forbidden bare-hostname case)
When B evaluates A's live claim
Then the machine_id source MUST NOT have produced a collision in the first place — the negative test asserts the chosen source yields distinct ids for two fleet hosts, so B never enters the same-box fast path against A's live remote claim
```

- A bare human `/faff-graft` claim (`heartbeating:false`) that is 5 h old under a 6 h `claim_ttl_hours` MUST read held (judged by TTL age, not the 900 s heartbeat window); at 6 h + 1 s it MUST read stale.
- A git-only-mode repository (no tracker, `bundle_store: local`) MUST still exclude a second cross-host graft via the `origin` build-claim ref, where today it has no cross-host claim at all.
- No release, reclaim, or supersede path MUST ever issue a bare `git push --force`; every ref move is a non-force create, a `--force-with-lease` reclaim, or a `--force-with-lease` delete.
- The FAFF-863 `resumeLightsOut` STEP 4b path MUST be byte-identical — same `refs/faff/recovery-claims/...` ref, same `claim.json` shape, same `bundle.js` recovery-claim selftest output.

**Concrete verifiability oracles.** Each of these is a mechanical assertion a build agent writes as a test; they pin the DONE items that are otherwise prose.

- **Crash-after-build missed-release recovery.** Fixture: A acquires the claim (sha `aSha`) and makes its last commit; kill A before `release`. Assert the ref still points at `aSha`. Advance the injected clock past the staleness window (`heartbeatStaleSecs` for a heartbeating claim, or `claim_ttl_hours` for a bare one). Run B's `reclaimIfStale`. Oracle: `{reclaimed:true}`, the ref now points at B's sha, `claim_epoch` incremented by 1 — the issue is not permanently stranded.
- **`store_unavailable` refuses, never builds.** Point `remoteName` at an unreachable remote. Oracle: `acquire` returns `{acquired:false, reason:"store_unavailable"}` and graft's Step-5 path emits the founded refuse with **no** worktree write / commit — never a silent unguarded build.
- **`confirmHead` mismatch refuses.** A acquires (`aSha`); a reclaimer supersedes the ref to `bSha`; call `A.confirmHead(aSha)`. Oracle: `{confirmed:false, reason:"superseded"}`, and A takes the refuse arm before any irreversible side effect.
- **`release` superseded is a safe no-op.** A acquires (`aSha`); a reclaimer moves the ref to `bSha`; call `A.release(aSha)`. Oracle: `{released:false, reason:"superseded"}` and the ref **still** points at `bSha` (B's claim is not deleted).
- **`heartbeating` flag selects the staleness branch.** Same claim age, two flags: `heartbeating:true` with a fresh heartbeat reads **held** via `runIsHeld`; `heartbeating:false` is judged by `claim_ttl_hours` age. Oracle: at a wall-clock age between `heartbeatStaleSecs` and `claim_ttl_hours` (window ≠ TTL), the two flags return **opposite** verdicts (`false`→held, `true`→stale), proving the branch selection.
- **Tidy release-and-reclaim, never build.** Given an issue whose build claim is stale under `buildClaimStaleAware`: tidy calls `release` (lease-matched to the stale sha) **and** moves `In Progress → Todo` + removes `faff-claimed`. Oracle: the ref is deleted (or superseded) and tidy **never** calls `acquire` to build — assert no build side effect in tidy's path.
- **`machine_id` collision is unconstructable.** The negative test spins two work roots with the real id source and asserts `thisMachineId()` differs across them. A second variant forces the forbidden bare-hostname source and asserts the id-source selector **rejects** it (a hostname never becomes the `machine_id`), so a same-name two-host collision cannot be built in the first place.

## 6. Design decision rationale

**Where does the ref live?** origin vs bundle store. Bundle store no-ops under `local` and would leave git-only mode uncovered. **Chosen: origin** — always present, `bundle_store`-independent, unlocks git-only mode.

**How is the primitive generalised without breaking FAFF-863?** Conditional inside the one function vs extract-and-bind. Conditional entangles the callers and risks a late shape drift. **Chosen: extract a parametrised core; keep `recoveryClaimStore` a thin byte-identical binding; add `buildClaimStore`.**

**Release model?** Active-delete (option 1) vs per-attempt keying (option 2). Option 2 needs an attempt counter with no clean git-only / cross-box source and re-introduces prior-ref liveness reasoning. **Chosen: option 1, lease-matched delete** — trivial keying, self-healing on a missed delete via the existing reclaim path, no bare force.

**Same-box liveness signal?** pid probe (ticket) vs live heartbeat-file read. pid violates FAFF-233 and is cross-box-meaningless. **Chosen: live FAFF-355 heartbeat-file read gated by a machine-id match; pid never consulted.**

**Machine identity?** Explicit `machine_id` vs inferred same-box. Inference is ambiguous and fails on reconstructed run-dirs. **Chosen: an explicit collision-resistant id (OS `/etc/machine-id`, or a durable per-host UUID where none is stable — never a bare hostname), gating the fast path only.** A collision is the double-build hazard, so the source fails toward uniqueness.

**Staleness input?** Always heartbeat vs a two-branch selector. A bare human build outlasts the 900 s window and would be wrongly reclaimed. **Chosen: `heartbeating` flag selects `runIsHeld`/`heartbeatStaleSecs` for a heartbeating claimant, `claim_ttl_hours` age for a bare one; `claim_ttl_hours` is retained.**

**Head-confirm placement?** **Chosen:** immediately before the first irreversible build side effect (worktree write / first commit), mirroring FAFF-863's confirm-before-owner-write — the ref head, not any timer, is the final arbiter of who builds.

## 7. Open questions and assumptions

**Open questions.** None blocking. The release model is a closed **Chosen** (option 1); it reverses the ticket's stated lean, so a reviewer who prefers option 2 should weigh the git-only attempt-counter gap documented in 4.2 before overriding.

**Assumptions.**

- **Assumes:** a stable, *collision-resistant* per-host machine id is obtainable (`/etc/machine-id` or platform equivalent; a durable per-host UUID where none is stable — **never** a bare hostname). *Validate:* run the de-risking spike (see the methodology critique) confirming the chosen source is both readable AND distinct across two hosts in each target environment (bare host, container, CI) before relying on the same-box fast path. Too-many-ids degrades safely (cross-box row); too-few-ids (a collision) is the double-build hazard the source must preclude by construction.
- **Assumes:** graft can tell whether it runs under a heartbeating lights-out owner (to set `heartbeating`). *Validate:* check for the lights-out owner/run-dir context graft already resolves (`FAFF_RUN_DIR` / owner ledger) at Step 5; absent ⇒ `heartbeating:false`.
- **Assumes:** the FAFF-863 `recoveryClaimStore` primitive is present on the build base (origin/main, PR #725). *Validate:* `git grep recoveryClaimStore plugin/skills/faff/bin/lib/bundle.js` returns the primitive before starting; the local tree may be behind and must be brought up to origin/main first.

## 8. DONE

### From WHY
- [ ] No build-gating path reads `faff-claimed` or `In Progress`; the git ref alone decides who builds (grep the graft/tidy claim paths).
- [ ] No liveness path consults `owner.pid`; liveness is heartbeat-only (FAFF-233).

### From WHAT (types and interfaces)
- [ ] `recoveryClaimStore(root)` is a thin binding; its ref path, `claim.json` shape, and `bundle.js` recovery-claim selftest output are byte-identical to origin/main.
- [ ] `buildClaimStore(root)` exists, defaults `remoteName="origin"`, and writes `claim.json` with `issue`, `owner`, `machine_id`, `heartbeating`, `claim_epoch`, `claimed_at`.
- [ ] `buildClaimStore` exposes `release(identity, mySha)`; `recoveryClaimStore` does not.

### From HOW (where the ref lives)
- [ ] The build claim is pushed to `origin` and works with `bundle_store: local` and `bundle_store: git-remote` alike.

### From HOW (release model)
- [ ] `release` deletes via `git push --force-with-lease=<ref>:<mySha> :<ref>` and is a no-op (`reason:"superseded"`) when the ref no longer points at `mySha`.
- [ ] A re-queued issue is re-acquirable on the next drain (no permanent refuse).
- [ ] A missed release is recovered by the next drain's `reclaimIfStale` (crash-after-build fixture), not permanently stranded.

### From HOW (same-machine liveness)
- [ ] `buildClaimStaleAware` returns held-by-TTL for a `heartbeating:false` claim within `claim_ttl_hours`, stale past it.
- [ ] A same-box (`machine_id` match) crashed claim reclaims immediately off the live FAFF-355 heartbeat file, with no `heartbeatStaleSecs` wait.
- [ ] A cross-box claim is judged on the frozen snapshot via `runIsHeld` and only reclaimable after `heartbeatStaleSecs`.
- [ ] Two live same-box grafts of one issue are excluded by the per-issue worktree exclusive-create, not the ref.
- [ ] `machine_id` is an explicit `claim.json` member sourced collision-resistantly (OS machine id / durable per-host UUID, never a bare hostname); a negative test asserts two fleet hosts yield distinct ids; no pid probe exists.

### From HOW (graft integration)
- [ ] Graft Step 5 acquires the build claim; a lost claim yields a founded refuse (`claimed-by-peer` autonomous / user notice interactive), replacing the tolerated concurrent build.
- [ ] `store_unavailable` refuses rather than building unguarded.
- [ ] `confirmHead` runs immediately before the first irreversible build side effect; a mismatch refuses.
- [ ] A same-session re-run of `/faff-graft ISSUE-XX` re-acquires idempotently (no self-lockout).
- [ ] The tracker `In Progress` + `faff-claimed` writes remain, as breadcrumbs, cleared on the same events as today; git-only mode gains a working cross-host build claim.

### From HOW (edge cases)
- [ ] No path issues a bare `git push --force`; every ref move is non-force create, `--force-with-lease` reclaim, or `--force-with-lease` delete.

**Integration smoke test.**

```
PROCEDURE smoke():
  shared bare remote; two work roots A, B on distinct machine_ids
  A.buildClaimStore.acquire({issue:"X"})            EXPECT acquired:true
  B.buildClaimStore.acquire({issue:"X"})            EXPECT acquired:false reason:"exists"
  A.buildClaimStore.confirmHead({issue:"X"}, aSha)  EXPECT confirmed:true
  A.buildClaimStore.release({issue:"X"}, aSha)      EXPECT released:true
  B.buildClaimStore.acquire({issue:"X"})            EXPECT acquired:true   # re-queued, re-claimable
  assert no ref move used a bare --force (inspect the pushed argv)
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? — split candidate (principle 4).** The spec covers two structurally independent concerns: (a) the library work — generalise `recoveryClaimStore` into `claimStoreCore`, keep the recovery binding byte-identical, add `buildClaimStore` with `release` + the three-row `buildClaimStaleAware`; and (b) the orchestrator wiring — graft Step 5 acquire/confirm/refuse, tidy release-and-reclaim, breadcrumb demotion. The integration smoke test exercises the primitive standalone, so (a) is independently verifiable. Splitting front-loads the risky primitive (and closes the byte-identical FAFF-863 regression surface) before any orchestrator change rides on it. What to do: split into a primitive ticket (blocking) + an integration ticket. They ship together for end-user value, so if the combined unit fits 1–3 days keeping it whole is defensible — but `build-tier: complex` and the breadth suggest it does not. **Operator decision: kept whole.**

**Workstream fit? — loose ticket, cohesive in itself (principles 1, 5).** Backlog, no project, no labels, but internally cohesive (one outcome). It converges with FAFF-757 and FAFF-863 on "correctness of faff's distributed build/run coordination". No action now; flag for the next rehoming pass that FAFF-889 + FAFF-757 are candidates for an outcome-named home (e.g. "harden distributed build/run coordination").

**Deps surfaced? — real dependency now expressed as `blockedBy` (principle 6).** The FAFF-863 dependency was `relatedTo`; this pass converted it to `blockedBy` (it reads immediately-satisfied, FAFF-863 being Done) so the graph records the real prerequisite. FAFF-757 stays `relatedTo` — a reused idiom, not a blocker.

**Risk profile? — novel-integration risk, one de-risking spike (principle 7).** A `confidence: medium` refactor of a shipped live cross-box mutex requiring byte-identical behaviour, plus a new lease-matched `release` and a `machine_id` gate. Well de-risked already (assumptions, failure modes, standalone smoke test). The residual unknown surfacing at the worst time is `machine_id` source stability/uniqueness across bare host, container, CI. What to do: run a short spike (or make it the first task of the build) confirming the id source is readable AND distinct per host before the same-box fast path is built on it.

confidence: medium
build-tier: complex
spec-review: approve (human-adjudicated 2026-08-19 — adversarial backend rate-limited across 4 rounds; round-1 architectural objection resolved; QA oracle gaps closed above)

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```

---

**Spec-review status (human-adjudicated 2026-08-19).** Round 1 returned `revise` (architectural, major) on a `machine_id` bare-hostname collision that could false-same-box and double-build — addressed here (collision-resistant id mandated, hostname forbidden, collision failure mode + negative scenario added). Rounds 2–4 could not certify the architectural/infosec lenses: the whole GLM adversarial chain (`openrouter-glm-free` → `nvidia-glm-free` → `openrouter-glm-paid`) was HTTP 429 rate-limited / returned empty content, so the fail-safe returned `needs-human` — a backend-availability artifact, not a design rejection. QA's recurring verifiability gaps are closed by the **Concrete verifiability oracles** block in section 5. On that basis the operator adjudicated the approach `approve` and promoted the issue to Todo (medium retained). A clean automated three-lens pass should be re-run when the adversarial backend recovers.

---

## Spec revision — 2026-08-20 (certified spec-review reject-approach adjudicated)

> Spec: faffter-dark-nlspec · 2026-08-20 · interactive · claude-code/unknown · confidence: medium. Revision addendum to the spec above.

The automated adversarial spec-review was re-run on 2026-08-20 after the backend retune (PR #734), so the full four-lens pass certified this time (architectural + infosec clear; earlier rounds could not run because the GLM `:free` tier was HTTP 429). The certified verdict was **reject-approach** on two lenses. This addendum records the operator disposition and the resulting spec changes. It **supersedes** the 2026-08-19 human-adjudicated status.

### Disposition
- **methodology (blocker) — split into primitive + integration increments:** **held whole.** This re-raises the split the operator already weighed and overrode; the kept-whole decision stands (human curation authoritative). Rationale unchanged from the methodology-critique block: the two concerns ship together for end-user value; the standalone smoke test still front-loads the risky primitive within the single ticket.
- **QA (blocker + 2 major) — verifiability gaps:** **addressed** by the spike carve-out and the oracle additions below.

### QA blocker — machine_id collision-resistance now a blocking dependency, not an assumption
The §7 `Assumes:` machine_id item ("run the de-risking spike") is promoted to a real, blocking dependency: **FAFF-891 — Spike: prove the machine_id source is readable AND collision-resistant across bare host / container / CI** (blocks FAFF-889). FAFF-891 owns the cross-environment readable-and-distinct proof and delivers the negative-test harness (two fleet hosts yield distinct ids; the id-source selector rejects a bare hostname). FAFF-889's build consumes FAFF-891's chosen source and adopts its harness rather than re-deriving it. The §5 oracle "machine_id collision is unconstructable" stands, now backed by FAFF-891's harness.

### QA major 1 — claim_ttl_hours default and resolution, pinned
Added to §4.3 step 1 / §2:
- **Default:** `claim_ttl_hours = 6` (`config.js` line 94, `CANONICAL_CONFIG`), used when the key is absent.
- **Resolution source:** read via the config resolver (`faff config get claim_ttl_hours`), the same pure `age + TTL -> verdict` path `claim-verdict.js` already uses. A test asserting TTL-based staleness resolves the threshold through the resolver against a fixture config, so the oracle is deterministic (6 h unless the fixture overrides it).

### QA major 2 — store_unavailable refusal, observation oracle added
Added to the §5 "store_unavailable refuses, never builds" oracle: the refusal is observable as a **founded-refuse record** (the same `claimed-by-peer` / user-notice disposition graft already emits at Step 5), and the "no unguarded build" half is asserted by **file-system state**: after `acquire` returns `{acquired:false, reason:"store_unavailable"}`, assert the per-issue worktree dir was never created and no commit was made on the (absent) build branch. The interactive-notice vs autonomous-skip distinction is read off the disposition field the refuse record already carries, not inferred.

### Retained status (supersedes 2026-08-19)
```
spec-review: reject-approach (certified 2026-08-20; architectural+infosec clear, methodology split held-whole by operator, QA gaps closed: machine_id -> FAFF-891 blocking spike, claim_ttl_hours default+resolution pinned, store_unavailable fs-state oracle added)
confidence: medium
build-tier: complex
```

FAFF-889 remains whole and stays in Todo, now **blocked by FAFF-891**. Build proceeds once FAFF-891's finding lands.

---

**Unblocked — FAFF-891 shipped (PR #740, main `fa05705c`).** The `machine_id` de-risking spike is Done: `faff machine-id` (`thisMachineId()`) ships the collision-resistant source (OS machine id sha256-hashed → durable minted UUID under `<homeDir>/.faff/machine-id` → never a hostname), and its `--selftest` is the four-row negative-test harness this build adopts (distinct-per-host, container hostname-collision, hostname-source-rejected, readable/idempotent). Bare-host readability confirmed (`source: os-machine-id`); CI-verified via the `regions selftest` rung. This closes the QA-critical from the 2026-08-20 spec-review. FAFF-889's build can now consume `resolveMachineId(deps)` and the harness directly rather than re-deriving them.