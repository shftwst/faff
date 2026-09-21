# faff: build-claim on-box under `bundle_store` (pluggable claim transport) (FAFF-1064)

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1064.
> build-tier: complex

This spec is for the build agent implementing the claim-store half of the FAFF-1059 local-mode work, and for the human reviewers gating it. It generalises `claimStoreCore` to a pluggable transport so that `buildClaimStore` stays on-box under `bundle_store: local` and nothing under `refs/faff/*` is pushed to `origin`. This is the isolated, higher-risk half of the original slice A; the sibling ticket FAFF-1062 owns the writer `--local` flags (config / gitignore / hooks). Parent: FAFF-1059.

## 1. WHY — Problem and principles

**The model to hold in mind: a "writer target" and a "claim transport" are the two things that change under local mode, and both are swaps of a destination, not new code paths.** A writer under `--local` points at its personal, uncommitted file instead of the shared committed one. The build-claim mutex under `bundle_store: local` points its compare-and-swap at a never-pushed local git ref instead of a ref on `origin`. In both cases the logic that runs is the existing logic; only where it reads and writes moves.

**Problem.** `buildClaimStore` always pushes `refs/faff/build-claims/<issue>` to `origin` regardless of `bundle_store` (its own header comment at bundle.js:800-802 says it lives on origin "independent of bundle_store"), so under `bundle_store: local` a ref still leaves the box, which contradicts the local-mode promise that nothing under `refs/faff/*` is pushed. (The writer-side gap — the four CLI writers only ever writing their shared targets — is the sibling ticket FAFF-1062.)

**What this change does.** It generalises the claim-store mutex to take a pluggable transport, extracts today's git-remote push behaviour into one transport, adds a local transport built on `git update-ref` compare-and-swap against a never-pushed local ref, and has `buildClaimStore` pick the transport from `resolveBundleStoreName(root)`.

### Design principles

**Standard mode is byte-for-byte unchanged.** With `bundle_store` unset or `git-remote`, the build claim behaves exactly as it does today, down to claim.json field order, commit messages, and push argv semantics. The git-remote transport extraction is a pure refactor: reject any implementation that alters an observable in standard mode.

**One mutex core, not a fork.** The claim protocol (acquire, reclaim, confirm-head, release, heartbeat), the staleness predicates (`buildClaimStaleAware`), the self-recognition idempotent re-acquire, the head-confirm safety pin, and the claim.json shapes are reused unchanged. Only the transport primitives (read a ref head, read the manifest, compare-and-swap write a ref, compare-and-swap delete a ref) become pluggable. Reject any design that copies `claimStoreCore` into a second local variant; that is the fork FAFF-889 was written to avoid.

**A local build claim still mutually excludes same-box grafts.** Unlike `recoveryClaimStore`, which "goes local" by being constructed as `null` at its call site (single-box resume is already serialised by run-dir exclusive-create), a build claim cannot null out. `faffter-dark-concurrency-parallel` runs concurrent builds in multiple worktrees on one box, so the single-box mutex must still exist under local mode. The local transport's job is to preserve the exclusion, on-box, not to remove it.

### Reference context

| System | Where | Relevance |
|---|---|---|
| `claimStoreCore(root, remoteName, spec)` | bundle.js:424-599 | The mutex core being generalised. Every verb hardcodes git against `remoteName`. |
| `pushClaimCommit` | bundle.js:391-406 | Builds the orphan claim commit locally, then pushes. Only the push is remote-bound. |
| `gitReadClaimManifest` | bundle.js:359-379 | Reads head sha + claim.json via `ls-remote` + `fetch` + `show`. |
| `confirmHead` | bundle.js:479-487 | Reads the head with a bare `ls-remote` ONLY (no fetch, no parse). Drives the head-only `readHead` primitive. |
| `buildClaimStore(root, remoteName)` | bundle.js:808-827 | The binding to make transport-selecting. Ref `refs/faff/build-claims/<issue>`. |
| `recoveryClaimStore` / `landingClaimStore` | bundle.js:607-625 / 627+ | Sibling bindings that must stay byte-for-byte on git-remote. |
| `resolveBundleStoreName(root)` | bundle.js:837-842 | Returns `"local"` / `"git-remote"`, fail-safe to `"local"`. The transport selector. |
| `localBundleStore` | bundle-seal-core.js:265-320 | The fs-based write-once store. A precedent for on-box, but write-once-forever only. |
| `buildClaimSelftest` | bundle.js:1369-1537 | The in-file coverage that must gain a no-remote local fixture. |

### Scope

This ticket is the claim-store transport refactor half of FAFF-1059's local mode. The writer `--local` flags are FAFF-1062; the onboard flow is FAFF-1063. This ticket ships standalone (closes the build-claim origin leak under `bundle_store: local`) and is testable on its own.

## 2. OUT OF SCOPE

- **The writer `--local` flags and the onboard flow.** FAFF-1062 and FAFF-1063 respectively.
- **`recoveryClaimStore` and `landingClaimStore` behaviour.** Why excluded: recovery already goes local by nulling out at its call site, and landing is not part of the local-mode promise. Extension point: both are `claimStoreCore` bindings; if a future ticket wants them on-box under local, they select a transport the same way `buildClaimStore` will after this ticket, using the same seam.
- **The bundle store itself and other `refs/faff/*` refs (recovery-bundles, and so on).** Why excluded: the local bundle store already exists (`localBundleStore`); this ticket only closes the build-claim ref, which was the one still pushing under local. Extension point: any remaining ref that pushes under local is closed the same way, by giving its store a transport.
- **A config key to force the claim transport independently of `bundle_store`.** Why excluded: the decisions-register intent on this ticket is that build-claim follows `bundle_store`, so there is one selector, not two. Extension point: if a split is ever wanted, `buildClaimStore` gains its own resolver instead of reading `resolveBundleStoreName`.
- **Changing the build-claim under `bundle_store: git-remote`.** Excluded: the origin-bound cross-machine build lock is unchanged whenever `bundle_store` is not `local`. Only the `local` branch is new.

## 3. WHAT — Vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Standard mode | The build claim under `bundle_store` unset or `git-remote`. Behaviour is today's, unchanged. |
| Local mode (claim) | `buildClaimStore` under `bundle_store: local`; the claim ref stays on-box. |
| Transport | The four-primitive interface (`readHead` / `read` / `casWrite` / `casDelete`) that `claimStoreCore` uses to touch a ref. Git-remote and local are the two occupants. |
| Never-pushed local ref | A ref under `refs/faff/build-claims/<issue>` in the box's own `.git`, created by `git update-ref`, never pushed and never fetched from a remote. |

### The transport interface

The transport is the seam. Everything else in `claimStoreCore` is written in terms of it.

```
INTERFACE ClaimTransport:
  readHead(ref) -> { status: "ok" | "missing" | "unreachable" | "error",
                     sha?: CommitSha }     # head-only: resolves the ref head with NO fetch and NO claim.json parse
    # confirmHead uses THIS: it needs only the current head sha, never the manifest.

  read(ref) -> { status: "ok" | "missing" | "unreachable" | "unreadable" | "malformed",
                 sha?: CommitSha,          # the ref head, populated whenever the head resolves (even if the claim is unreadable/malformed)
                 claim?: Object }          # parsed claim.json at that head, when status ok

  casWrite(ref, newSha, expectedOld) -> { ok: Bool,
                                          reason?: "store_unavailable" | "cas_lost" | "error",
                                          detail?: String }
    # expectedOld == null  -> create-only: the write lands ONLY if ref does not yet exist
    # expectedOld == <sha>  -> lease-matched update: lands ONLY if ref currently points at <sha>

  casDelete(ref, expectedSha) -> { ok: Bool,
                                   reason?: "store_unavailable" | "cas_lost" | "missing" | "error" }
    # deletes ONLY if ref currently points at expectedSha

  name: String                # for the store's returned name / diagnostics
```

Note that the claim commit itself (hash-object / mktree / commit-tree over `claim.json`) is built locally and is transport-agnostic. The transport receives an already-built `newSha` for `casWrite`. Only the act of publishing that sha to the ref, and reading a ref back, differ between transports.

### Git-remote transport (extracted, behaviour-preserving)

```
FUNCTION gitRemoteTransport(root, remoteName):
  readHead(ref):
    ls-remote remoteName ref                # head sha ONLY; NO fetch, NO show — byte-for-byte today's confirmHead read
    # empty -> missing; a resolved head -> ok+sha regardless of whether the claim is parseable

  read(ref):
    ls-remote remoteName ref                # head sha, or empty -> missing
    fetch --no-tags remoteName ref          # bring the orphan commit local
    show <sha>:claim.json                    # parse -> claim
    # maps exactly onto today's gitReadClaimManifest status set

  casWrite(ref, newSha, expectedOld):
    IF expectedOld == null:
      push remoteName  "<newSha>:<ref>"                              # non-force create
    ELSE:
      push remoteName  "--force-with-lease=<ref>:<expectedOld>"  "<newSha>:<ref>"
    # STORE_UNAVAILABLE_RE on stderr -> store_unavailable; non-fast-forward / lease reject -> cas_lost

  casDelete(ref, expectedSha):
    push remoteName  "--force-with-lease=<ref>:<expectedSha>"  ":<ref>"
```

This is today's `gitReadClaimManifest` / `pushClaimCommit` push argv / `confirmHead` `ls-remote` / `release` delete, moved behind the interface with no semantic change. It is the default transport for every existing binding, so `recoveryClaimStore` and `landingClaimStore` are byte-for-byte unchanged.

### Local transport (new, CAS-parity on-box)

```
FUNCTION localRefTransport(root):
  readHead(ref):
    show-ref --verify ref                    # head sha ONLY, or absent -> missing (no fetch, no show)

  read(ref):
    show-ref --verify ref                    # head sha, or absent -> missing (no ls-remote, no fetch)
    show <sha>:claim.json                    # parse -> claim (the commit is already a local object)

  casWrite(ref, newSha, expectedOld):
    IF expectedOld == null:
      git update-ref  ref  newSha  ""        # empty old-value asserts ref MUST NOT exist -> create-only CAS
    ELSE:
      git update-ref  ref  newSha  expectedOld   # update ONLY if ref currently == expectedOld (the lease)
    # Failure classification — git update-ref exits non-zero for BOTH a CAS miss and unrelated faults, so parse stderr:
    #   ref already exists / "is at <x> but expected <y>" / old-value mismatch      -> cas_lost
    #   "cannot lock ref" / "unable to create" / other lock or io fault              -> error (NOT cas_lost)
    #   Never fold a lock/io fault into cas_lost: that would read spuriously as "superseded" when the ref never moved.

  casDelete(ref, expectedSha):
    git update-ref -d  ref  expectedSha      # delete ONLY if ref currently == expectedSha
    # same failure classification: old-value mismatch -> cas_lost; lock/io fault -> error
```

`git update-ref <ref> <new> <old>` is git's local compare-and-swap: it applies the update only if the ref currently equals `<old>`, and an empty `<old>` string asserts the ref does not yet exist. That is the exact local mirror of a non-force push (create) and `--force-with-lease` (update / delete). Nothing is pushed and nothing is fetched, so no `refs/remotes/*` entry is ever created for the claim.

**Anti-pattern:** implementing the local transport as a `.faff` file, mirroring `localBundleStore`. Why: `localBundleStore` is write-once-forever (no reclaim, release, or heartbeat), so it cannot serve a build claim, which needs lease-matched reclaim, release, and heartbeat. `git update-ref` gives that lease semantics for free; a file would re-implement it worse.

### Store selection

```
FUNCTION buildClaimStore(root, remoteName = "origin"):
  transport = resolveBundleStoreName(root) == "local"
                ? localRefTransport(root)
                : gitRemoteTransport(root, remoteName)
  RETURN claimStoreCore(root, transport, { ...the existing build-claim spec, unchanged })
```

`claimStoreCore` takes the transport in place of `remoteName` (or alongside it, defaulting to `gitRemoteTransport(root, remoteName)` so existing callers need no change). The build-claim `spec` (refName, buildClaim, commitMessage, stalePredicate = `buildClaimStaleAware`) is untouched.

## 4. HOW — Behaviour

### Approach

An extract-and-add refactor in `bundle.js`:

1. Pull the transport primitives out of `gitReadClaimManifest`, `pushClaimCommit`'s push step, `confirmHead`'s `ls-remote`, `release`, and `tickHeartbeat` into the `ClaimTransport` interface.
2. Rewrite `claimStoreCore`'s verbs to call `transport.readHead` / `transport.read` / `transport.casWrite` / `transport.casDelete` instead of git directly. The commit-building half of `pushClaimCommit` (hash-object / mktree / commit-tree) stays; only its push becomes `transport.casWrite(ref, commitSha, expectedOld)`.
3. Implement `gitRemoteTransport` as the byte-for-byte extraction, and `localRefTransport` on `git update-ref`.
4. Make `buildClaimStore` select the transport from `resolveBundleStoreName(root)`; leave `recoveryClaimStore` and `landingClaimStore` on the git-remote default.

### The protocol is unchanged; only the primitives move

The verbs keep their exact shapes. Acquire is a create-only CAS write; reclaim is a lease-matched CAS write against the read stale sha; release and heartbeat are lease-matched CAS write/delete against the holder's own sha; confirm-head is a head-only read compared to the holder's sha. Mapping the existing result reasons onto the transport:

```
PROCEDURE acquire(identity, ownerSnapshot):     # claimStoreCore, rewritten over the transport
  1. r = transport.read(refName(identity))
  2. IF r.status == "unreachable" -> refuse store_unavailable
  3. IF r.status == "ok":
     a. IF r.claim.owner.session_id == ownerSnapshot.session_id AND non-empty
          -> return { acquired, idempotent }          # self-recognition, unchanged
     b. ELSE -> return { acquired: false, reason: "exists", holder: r.claim }
  4. IF r.status not in { ok, missing } -> refuse store_unavailable
  5. commitSha = build the claim orphan commit (unchanged local plumbing)
  6. w = transport.casWrite(ref, commitSha, null)      # create-only
  7. IF w.ok -> acquired
     IF w.reason == store_unavailable -> refuse
     IF w.reason == cas_lost -> re-read; surface the winning holder as "exists"   # never silent retry
```

Reclaim, release, and heartbeat follow the same substitution: `--force-with-lease=<ref>:<oldSha>` becomes `casWrite(ref, newSha, oldSha)` or `casDelete(ref, oldSha)`, and the "lease-lost / superseded" branch becomes the `cas_lost` re-read. Under the local transport the same result set comes back, because `git update-ref` fails a mismatched CAS exactly as a rejected `--force-with-lease` push does.

### What must be preserved verbatim

- **Self-recognition idempotence.** The same-session re-acquire (owner `session_id` match) returns `{ acquired: true, idempotent: true }` under both transports. It is above the transport, so it needs no change; the test must confirm it under the local transport too.
- **Head-confirm safety pin.** `confirmHead` uses the head-only `transport.readHead` (not the manifest `read`), comparing the resolved head sha to the holder's sha; a mismatch is `superseded`. This keeps standard-mode `confirmHead` byte-for-byte today's bare `ls-remote` (no added `fetch` / `show`), and a competitor head whose claim.json is malformed still reads `superseded` (head sha != mine), never `store_unavailable`. Under local, `readHead` is a `show-ref` head read, so the pin holds identically.
- **Staleness predicates.** `buildClaimStaleAware` (the three-row, machine-aware, heartbeat-only predicate) is unchanged and transport-independent. The same-box row (machine_id match plus live heartbeat-file read) is exactly the path a concurrent same-box graft exercises under local mode.
- **claim.json shape and commit messages.** `build-claim <issue> epoch=<n>`, and the `{ issue, owner, machine_id, heartbeating, claim_epoch, claimed_at }` object, are unchanged under both transports.

### Single-box concurrency, explicitly

Under `bundle_store: local`, two concurrent grafts on one box (the `faffter-dark-concurrency-parallel` case) each call `buildClaimStore(root)` and get the local transport. Both attempt `git update-ref refs/faff/build-claims/<issue> <sha> ""` (create-only). Git applies exactly one; the other sees the ref now exists and its empty-old-value assertion fails, surfacing as `cas_lost`, then re-read as `exists`. The mutex holds on-box with no remote. This claim must NOT be nulled out the way `recoveryClaimStore` is at its call site: nulling it would let two same-box grafts build the same issue at once, which is the double-build the mutex exists to prevent.

### Edge cases

- **No `origin` remote under local.** The local transport never touches a remote, so a repo with no `origin` still gets a working build claim. Under the git-remote transport an unreachable remote still refuses with `store_unavailable`, unchanged.
- **A stale local claim (crash after acquire).** The next drain's `reclaimIfStale` reads the local ref, judges it stale via `buildClaimStaleAware` (same-box row, live heartbeat file gone or stale), and reclaims with a lease-matched `git update-ref <ref> <new> <staleSha>`, epoch incremented. Self-heals exactly as the remote path does.
- **Two same-box reclaimers of one stale local ref.** Both read the same stale sha, both attempt `git update-ref <ref> <new> <staleSha>`; the first moves the ref, the second's old-value no longer matches and fails as `cas_lost`. Exactly one wins, mirroring the `--force-with-lease` race.

### Failure modes

- **The failure:** the git-remote extraction changes an observable in standard mode (a different push argv, a reordered claim.json, a dropped `fetch --no-tags`), so an existing remote-backed claim silently diverges. How you'd know: the git-remote path of `buildClaimSelftest` and the `test/bundle.test.mjs` claim fixtures fail, or a byte-comparison of claim.json / commit message differs, or the argv spy sees a changed sequence. What it means: the refactor is not pure; fix until the git-remote path is identical before trusting the local path.
- **The failure:** `git update-ref` empty-old-value create semantics are misused (for example passing all-zeros vs an empty string, or omitting the old-value), so two same-box grafts both acquire. How you'd know: the new no-remote local fixture's "exactly one of two racing same-box acquires wins" assertion fails, or both report `acquired: true`. What it means: the local CAS is not create-only; the mutex is broken and must not ship.
- **The failure:** a local ref under `refs/faff/build-claims/*` is nonetheless pushed by a user's blanket push configuration. How you'd know: `git for-each-ref refs/remotes` after a local-mode acquire is non-empty, or the ref appears on `origin`. What it means: default git does not push `refs/faff/*` under `--all`, `--tags`, or a matching push, so this is a user-config concern, not a faff defect; the assertion documents the boundary rather than guarding every possible refspec.

## 5. Scenarios

```
Given bundle_store is local and two grafts run concurrently on one box for the same issue
When both call buildClaimStore(root).acquire for refs/faff/build-claims/<issue>
Then exactly one acquires, the other gets { acquired: false, reason: "exists" }, and no ref is pushed to any remote
```

```
Given bundle_store is local and a build claim was acquired then abandoned (stale heartbeat)
When the next drain calls reclaimIfStale on the same box
Then it reclaims via a lease-matched git update-ref, claim_epoch increments, and the issue is not stranded
```

```
Given bundle_store is local and a build claim is held then released
When another graft acquires the same issue afterwards
Then the re-acquire succeeds (the local ref was deleted by a lease-matched git update-ref -d)
```

```
Given bundle_store is git-remote (or unset) — standard mode
When buildClaimStore runs acquire / reclaim / confirm / release / heartbeat
Then the pushed ref, claim.json bytes, commit messages, AND the git argv sequence are byte-for-byte identical to the pre-refactor behaviour
```

Non-functional assertions:

- Under the local transport, no `git push` is ever issued and no `refs/remotes/*` entry is ever created for the claim ref.
- The self-recognition idempotent re-acquire returns `{ acquired: true, idempotent: true }` under the local transport, identically to the remote transport.

## 6. Design decision rationale

**How should the build-claim mutex go on-box without forking the core?**
Options considered:

| Option | Pro | Con |
|---|---|---|
| A. Pluggable transport in `claimStoreCore` | One mutex core; the protocol, staleness, and claim shapes stay shared; git-remote stays byte-for-byte | A refactor of a load-bearing concurrency primitive |
| B. A second local-only claim store | No change to the git-remote path | Forks the mutex core, the exact duplication FAFF-889 removed; two staleness/lease implementations to keep in step |
| C. Null the build claim under local, like recovery | Simplest | Wrong: concurrent same-box grafts would build the same issue at once |

**Chosen:** Option A, the pluggable transport (human decision, 2026-09-19). Extract today's git-remote push behaviour into a git-remote transport (byte-for-byte under git-remote), and add a local transport on `git update-ref` compare-and-swap against a never-pushed local ref. `buildClaimStore` selects the transport from `resolveBundleStoreName(root)`. The acquire / reclaim / confirm / release / heartbeat protocol, `buildClaimStaleAware`, and claim.json shapes are reused unchanged; only the transport is pluggable. Rationale: do not fork the claim core, and the `git update-ref` old-to-new CAS mirrors `--force-with-lease` exactly, so the local path inherits the same one-winner guarantee.

**What backs the local transport: a git ref or a `.faff` file?**
Options: a `.faff` file like `localBundleStore` (fs write-once with a `.tmp` rename); or a never-pushed local git ref via `git update-ref`. The file gives write-once-forever only, with no reclaim, release, or heartbeat lease, so it cannot serve a claim that needs all three. `git update-ref` provides create-only CAS (empty old-value), lease-matched update (old-value match), and lease-matched delete (`-d` old-value), which are the exact local mirrors of the remote push semantics already relied on.
**Chosen:** a never-pushed local git ref via `git update-ref`, for exact CAS and lease parity with the remote path and zero new lease code. Not a punt: the file alternative is disqualified by the reclaim/release/heartbeat requirement. The only residual, a user's own blanket push refspec pushing `refs/faff/*`, is outside default git behaviour and is documented as a boundary in the failure modes, not guarded.

**Where is the transport selected?**
Options: a new dedicated config key for the claim transport; or reuse `resolveBundleStoreName(root)`. The decisions-register intent on this ticket is that build-claim follows `bundle_store`, so a second key would split one decision into two.
**Chosen:** `buildClaimStore` reads `resolveBundleStoreName(root)`; `"local"` picks the local transport, anything else picks the git-remote transport with the existing `origin` default. Existing bindings keep the git-remote default, so they are unchanged.

## 7. Open questions and assumptions

Open questions: none. Every decision above is closed.

Assumptions:

- **Assumes:** `git update-ref <ref> <new> ""` asserts the ref does not yet exist, and `git update-ref -d <ref> <old>` / `git update-ref <ref> <new> <old>` apply only on an old-value match. Validate before building (the pre-build gate): confirm against the local git version in the repo (a create, a second create that must fail, a mismatched-old update that must fail). This is the local CAS the whole local transport rests on.
- **Assumes:** `resolveBundleStoreName(root)` is callable from `buildClaimStore` without a circular require or a config-read cost that matters per acquire. Validate: it already loads config (bundle.js:838) and is called elsewhere in the same module, so this holds; confirm no new import cycle is introduced by calling it inside `buildClaimStore`.

## 8. DONE — Definition of Done

### From WHY
- [ ] Under `bundle_store: local`, an acquire / reclaim / release cycle for `refs/faff/build-claims/<issue>` issues no `git push` and creates no `refs/remotes/*` entry (asserted by `git for-each-ref refs/remotes` being empty and the local ref existing).
- [ ] With `bundle_store` unset or `git-remote`, the build-claim behaviour is byte-for-byte identical to pre-change (the standard-mode regression).

### From WHAT (transport interface)
- [ ] `claimStoreCore` calls `transport.readHead` / `transport.read` / `transport.casWrite` / `transport.casDelete` only; no direct `git push` / `ls-remote` / `fetch` / `update-ref` remains in its verbs.
- [ ] `confirmHead` routes through the head-only `readHead` (no `fetch` / `show`); a competitor head with a malformed claim.json still reads `superseded`, never `store_unavailable`. Standard-mode `confirmHead` issues the same bare `ls-remote` as today (asserted by the argv spy below).
- [ ] `gitRemoteTransport` reproduces today's `gitReadClaimManifest` reads, `readHead`'s bare `ls-remote`, push argv (non-force create and `--force-with-lease` update/delete), and result reasons exactly. Oracle: a git-argv-capturing spy over acquire / reclaim / confirm / release / heartbeat asserts the captured argv sequence is byte-for-byte the pre-refactor sequence, not only the claim.json / commit-message bytes.
- [ ] `localRefTransport` uses `git update-ref` with empty old-value for create-only, old-value match for lease update, and `-d` old-value for lease delete; `readHead` / `read` use `show-ref` / `show` with no `ls-remote` or `fetch`. Its failure classification parses `git update-ref` stderr to map an old-value mismatch to `cas_lost` and a lock/io fault to `error` (never `cas_lost`), so a transient lock never reads as `superseded`.
- [ ] `buildClaimStore` selects `localRefTransport` when `resolveBundleStoreName(root) == "local"`, else `gitRemoteTransport(root, remoteName)`; `recoveryClaimStore` and `landingClaimStore` still use the git-remote transport.

### From HOW (behaviour)
- [ ] Two concurrent same-box acquires for one issue under local mode: exactly one returns `acquired: true`, the other `{ acquired: false, reason: "exists" }`.
- [ ] A stale local claim is reclaimed by the next drain via a lease-matched `git update-ref`, with `claim_epoch` incremented.
- [ ] A released local claim is re-acquirable; a release against a superseded sha is a safe no-op.
- [ ] `confirmHead`, the self-recognition idempotent re-acquire, and `buildClaimStaleAware` behave identically under the local transport.
- [ ] The local build claim is never nulled out (it is constructed and used, not skipped, under local mode).

### Pre-build gate
- [ ] Before touching `claimStoreCore`, run the `git update-ref` CAS validation (a create, a second create that must fail, a mismatched-old update that must fail) against the repo's git. If it does not behave as assumed, the local transport is void and the design reworks — this is the kill-switch.

### Test targets
- [ ] `buildClaimSelftest` (bundle.js) runs BOTH transports: the existing scratch-bare-remote fixture (git-remote, asserting byte-for-byte today's behaviour, including the argv spy), AND a new no-remote local fixture (a git repo with no `origin`) covering race-to-one-winner, claim.json shape, confirmHead, reclaim epoch increment, release then re-acquire, release-superseded no-op, same-session idempotence, and the no-push / no-`refs/remotes` assertion.
- [ ] `regions selftest --region factory` stays green (build-claim is region `factory`).
- [ ] `test/bundle.test.mjs` gains local-transport unit coverage and keeps the existing `recoveryClaimStore` local-store no-op test (bundle.test.mjs:857) unchanged.

### Integration smoke test

```
PROCEDURE local_build_claim_smoke:
  1. Init a git repo with NO origin remote; write .faffrc.yaml with bundle_store: local
  2. store = buildClaimStore(root)                       # selects the local transport
  3. acquire(issue) -> acquired: true, sha S
  4. Assert `git for-each-ref refs/remotes` is empty AND `git show-ref refs/faff/build-claims/<issue>` == S
  5. confirmHead(issue, S) -> confirmed
  6. release(issue, S) -> released; re-acquire(issue) -> acquired: true
  7. Assert no `git push` was ever invoked (spy / no remote configured, so a push would error)
```
