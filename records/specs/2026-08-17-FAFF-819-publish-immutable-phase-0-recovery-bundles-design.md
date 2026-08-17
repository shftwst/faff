# Spec: FAFF-819 — Phase 0 recovery bundle: publish mechanism, minimal bundle, fail-closed independent verifier

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-819.
>
> Revised 2026-08-17 — narrowed at prep to the publish mechanism, a minimal seven-member bundle, and its fail-closed verifier. The recovery-semantics members (contract/config fingerprint, restart descriptor, unresolved effects) are split to FAFF-845, co-designed with FAFF-820's read contract. Supersedes the earlier medium-confidence single-ticket spec.
>
> Revised 2026-08-17 (round 2) — spec-review fix pass: corrected the run-close boundary (it publishes in git-only mode only, since `faff events anchor-run` mints no anchor in a tracker-backed run — a tracker run's recovery points are its per-issue bundles); added identity-component validation, head-sha-pinned read/push ref discipline, `store_unavailable` detection + idempotent-no-op observable oracles, and `cause`-vocabulary scoping.
>
> Revised 2026-08-17 (round 3) — the store is now a **`bundle_store` slot** over a fixed contract, not a hardcoded git remote. The default occupant is a **local store** (zero off-box side-effect, today's posture), and the **git-remote occupant extends it** with the off-box push — the same default-occupant / heavier-occupant shape faff uses for `spec_review` (noon → dark) and `concurrency` (sequential → parallel). Off-box publishing is opt-in by filling the slot, not on-by-default. There is no publish on/off flag; the occupant is the control surface.
>
> Revised 2026-08-17 (round 4) — the git-remote occupant writes each bundle to its own **dedicated write-once ref** `refs/faff/bundles/…` (an orphan commit), not the feature-branch code commit: this decouples publishing from graft, survives PR-merge/branch-deletion, and triggers no PR and no CI (custom refs are invisible to GitHub Actions). Added the explicit **recovery model** (same-run resume via `listBoundaries(run_id)`; fresh-run cross-run discovery by issue is FAFF-820's, built on this ref layout) and a **consistency** note (local synchronous; git-remote push synchronous, checkout-free read eventually-consistent but fail-closed-safe).

This spec is the build brief for FAFF-819. It defines how an unattended run publishes a verifiable recovery bundle at each safe boundary, what the minimal bundle contains, and how an independent party verifies a published bundle so that a missing, stale, malformed, or tampered bundle fails closed rather than being trusted. The audience is the build agent implementing the feature and the human reviewers gating it. The bundle is written by the run; it is read and acted on by FAFF-820 (recover/consume) and accepted as evidence by FAFF-823; neither read side is built here.

## 1. WHY — problem and principles

**The load-bearing idea.** A recovery bundle is a derived, independently verifiable replica of a run's already-durable state at a safe boundary, not a new source of truth. Every byte in it either is copied verbatim from a file the run already wrote through the redaction hook, is a projection over those already-redacted bytes, or is a small structural pointer that carries no free text. Because the bundle is a replica and not a lineage, an independent verifier can re-derive its integrity from first principles and refuse it when the replica does not match, without ever having to trust the machine that produced it.

**Problem statement.** Today an unattended run's durable state (its ledger, anchors, and integrity manifest) lives only on the box that ran it, and anchor discovery needs a PR diff or a local checkout to find (`deriveAnchorDirs` / `deriveAnchorDirsFromTree`, governance-check.js:320/367), so a second machine cannot locate or trust that state after the fact. FAFF-819 lets a run publish a self-contained bundle to a configured store at each anchor mint and ships a verifier that reaches, reads, and checks that bundle through the store, failing closed on anything it cannot prove clean.

**Design principles.**

**Off-box is opt-in via a slot, never on by default.** The publisher and verifier speak only to a fixed `BundleStore` contract; which occupant fills the `bundle_store` slot decides whether anything leaves the box. The default occupant is a **local** store, so a repo that adopts faff gets no new off-box side-effect and no surprise pushes. A run distributes its bundles only when a distributing occupant (the git-remote occupant built here, or a third-party object store) is put in the slot. This is faff's "Configurable, not opinionated" and "Adoptable, not all-encompassing" applied: local → distributed and git-remote → object-store are both a change of occupant, never a code edit.

**No competing lineage.** The bundle is a replica, never a second journal. It never becomes the authority for any fact the ledger, anchors, or manifest already hold; a verifier disagreement is resolved by refusing the bundle, never by preferring it. This mirrors the `mintIssueAnchor` / `anchor-run` framing (RFC master v5 line 261) and is why `boundary_seq` is scoped to `(run_id, run_segment_id)` rather than being a global counter.

**Fail closed, always.** Every verification path that cannot reach a positive CLEAN determination returns a non-clean verdict. Unreachable store, unreadable ref, absent member, unparseable member, digest mismatch, and broken chain each map to a specific non-clean verdict; none of them degrades to a pass. This inherits the posture of `resolveAnchorLevel`, which refuses (exit 2) on any non-ok anchor status and never falls back to the live ledger.

**Immutability by never-rewrite.** A bundle at a given identity is written once and never rewritten. Visibility is atomic (the occupant makes the whole bundle appear at once), and a re-publish at an already-published identity is a no-op rather than an overwrite. This is what makes a `run_id` collision safe without solving cross-machine `run_id` uniqueness here (that stays FAFF-757): a second writer at the same identity cannot silently replace the first.

**Redaction is inherited, never re-implemented.** The bundle adds no new redaction logic. Copied and projected members inherit the redaction already applied at the ledger and event write boundaries; the few structural members carry no secret-bearing fields by construction. See the second assumption for the validation.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| `slots.concurrency` / `slots.spec_review` pattern | gateway → Slots (default sequential → parallel; noon → dark) | The default-occupant / heavier-occupant slot shape the `bundle_store` slot follows: a conservative built-in default, a swap-in occupant that extends it, one fixed contract. |
| `resolveAnchorLevel` | `bin/lib/merge-gate.js:309` | The checkout-free git read model (`git show <ref>:path` with a GitHub API fallback) and four-status fail-closed posture the **git-remote occupant** reuses; the occupant substitutes a write-once per-identity ref for the head-sha pin as its immutability source. |
| `buildManifest` / `diffAgainstManifest` | `bin/lib/integrity-digest.js:128` / `:152` | The `d1` artifact manifest that becomes a bundle member, and the tamper diff (including the append-tolerant `events.jsonl` prefix rule) the verifier reuses. |
| `verifyChain` / `verifyEffectsChain` | `bin/lib/events.js:740` / `:748` | Chain verification over `events.jsonl` + `chain-head.json` and `declared-effects.jsonl` + `effects-chain-head.json` witnesses, reused for tamper detection. |
| `resolveKnownSecretValues` / `redactKnownSecrets` | `bin/lib/redact.js:138` / `:106` | The redaction hook already wired into `atomicWriteLedger` and `appendEventRecord` (heartbeat.js:219/227) that copied and projected members inherit. |
| `owner.epoch` | `bin/lib/lights-out.js:1146` | The existing per-run epoch that `run_segment_id` surfaces; no new vocabulary is introduced. |
| custody verdict idiom | `bin/lib/contract-defs.js:776`, `bin/lib/integrity-digest.js:187` | `--record-result`, the `{clean, tamper, verification-unavailable}` enum, and exit 0/1/2 that `bundle verify` and `bundle-verdict` mirror and extend. |

**Scope.** FAFF-819 is the write-and-verify half of Phase 0 recovery: it publishes the bundle and proves it. Reading a bundle to actually resume a run is FAFF-820; accepting a bundle as merge evidence is FAFF-823; enriching the bundle with recovery-semantics members is FAFF-845.

## 2. Out of scope

- **Recovery-semantics members (contract/config fingerprint, restart descriptor, unresolved effect records)** — Why excluded: their shape is only provable by their consumer, so they are co-designed with FAFF-820's read contract rather than guessed here. Extension point: **FAFF-845** ("Enrich Phase 0 recovery bundles with recovery-semantics members") adds the `ContractConfigFingerprint` (`cf1`) member and `computeFingerprint`, the `RestartDescriptor` member, and the `UnresolvedEffect` member with its declared-minus-observed `deriveUnresolvedEffects` derivation, all onto the same bundle manifest defined in section 3.
- **Reading / consuming a bundle to resume a run** — Why excluded: recovery is a distinct behaviour with its own read contract. Extension point: **FAFF-820** consumes the members and refs defined here. FAFF-819 supports same-run resume fully (`listBoundaries(run_id, …)`); the **cross-run, enumerate-by-issue** discovery a fresh run needs (`git ls-remote 'refs/faff/bundles/*/*/<ISSUE>'`) and the choose-which-boundary-to-resume-from logic are FAFF-820's, built on this ticket's per-identity ref layout (see the recovery-model note in section 4).
- **Accepting a bundle as merge-gate evidence** — Why excluded: evidence acceptance is a governance decision separate from producing and proving the bundle. Extension point: **FAFF-823** consumes the `bundle-verdict` defined here.
- **Cross-machine `run_id` uniqueness** — Why excluded: identity collision avoidance across machines is a separate problem; fail-closed immutability makes a collision safe in the meantime. Extension point: **FAFF-757**.
- **A third-party / object-store backend** — Why excluded: the two occupants built here (local default + git-remote) prove the seam and cover the reference runner with zero new infrastructure. Extension point: a **further occupant of the `bundle_store` slot** implementing the same `BundleStore` contract (S3 / MinIO / a cloud volume), dropped in with no change to the publisher, verifier, identity, or verdict.
- **The resume/epoch boundary as a publish trigger** — Why excluded: a resume mints no anchor, so it has no safe boundary to publish. It is represented instead: the bundle records the current `owner.epoch` as its `run_segment_id`.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Safe boundary | A point at which the run mints an anchor and therefore has a durable, verifiable state worth replicating: the per-issue merge-floor boundary and the run-close boundary. |
| `bundle_store` slot | The delegation slot that selects the store occupant. Default occupant: the built-in local store. Swap-in occupants: the git-remote occupant (built here), or a third-party object store. One fixed `BundleStore` contract across all occupants. |
| `run_segment_id` | The current `owner.epoch` of the run, surfaced under a name that says what it means for a bundle. It segments a `run_id` across resumes. |
| `boundary_key` | The key that names a boundary within a segment: the issue key for a per-issue merge-floor boundary, and the reserved constant `run-close` for the run-close boundary. |
| `boundary_seq` | A monotonic sequence number scoped to `(run_id, run_segment_id)`, ordering boundaries within a segment. Used to decide staleness. |
| Bundle identity | The triple `(run_id, run_segment_id, boundary_key)`. Machine-independent in content and fully determines the store handle. |
| Bundle member | One named entry in a bundle: a byte-copy of an existing file, a projection over already-redacted bytes, or a small structural pointer. |
| `bundle_manifest_digest` | The top-level `sha256` over the canonical serialisation of the member set. The single value a verifier reads first to identify the bundle. |

**Bundle identity and store handle.**

```
RECORD BundleIdentity:
  run_id: String            # the run's id
  run_segment_id: Integer   # := owner.epoch at publish time; >= 0
  boundary_kind: Enum { issue-merge-floor, run-close }
  boundary_key: String      # issue key for issue-merge-floor; the constant "run-close" for run-close
  boundary_seq: Integer     # monotonic within (run_id, run_segment_id); >= 0

  # Handle derivation is total and deterministic — the identity alone yields the store handle:
  #   git-remote occupant → ref  refs/faff/bundles/<run_id>/seg-<run_segment_id>/<boundary_key>
  #   local occupant      → path .faff/bundles/<run_id>/seg-<run_segment_id>/<boundary_key>/
  CONSTRAINT boundary_kind = run-close  IFF  boundary_key = "run-close"
```

**Bundle member set (minimal).** Every member below is in scope for FAFF-819. The `origin` column states how each member is produced and is the basis for the redaction assumption in section 7.

| Member | Origin | Content |
|---|---|---|
| `ledger_snapshot` | byte-copy | Verbatim bytes of `run-ledger.json` as written by `atomicWriteLedger` (already redacted). |
| `admitted_outcomes` | projection | `{ admitted, outcomes }` projected from the ledger bytes; no fields added. |
| `anchors` | byte-copy | Verbatim bytes from `.faff/anchors/<run_id>/<boundary_key>/` plus the `chain-head.json` and `effects-chain-head.json` witnesses. |
| `artifact_manifest` | byte-copy | The existing `d1` manifest returned by `buildManifest` (integrity-digest.js:128). |
| `last_safe_boundary` | structural | The recovery pointer `{ boundary_kind, boundary_key, run_segment_id, boundary_seq, anchor_ref, ts }`. The one invented member; it is what makes the bundle a recovery point. |
| `redaction` | structural | Metadata recording that redaction ran (for example the placeholder token and the count of applied targets). Never a secret value. |
| `bundle_manifest_digest` | derived | Top-level `sha256` over `canonical(members)`; the identity digest a verifier reads first. |

```
RECORD LastSafeBoundary:
  boundary_kind: Enum { issue-merge-floor, run-close }
  boundary_key: String
  run_segment_id: Integer
  boundary_seq: Integer
  anchor_ref: String        # the ref the anchor member was read at (occupant-defined)
  ts: Timestamp             # ISO-8601, boundary mint time

RECORD RedactionMeta:
  ran: Boolean              # always true for a published bundle
  placeholder: String       # REDACTED_PLACEHOLDER from redact.js
  applied_count: Integer    # number of redaction targets applied; never the values

RECORD BundleManifest:
  version: String                 # "b1"
  identity: BundleIdentity
  members: Map<String, MemberRef> # member name -> { sha256, bytes_len } or nested for a dir member
  bundle_manifest_digest: String  # sha256 over canonical(members); recomputed on read, never trusted as read
```

**Canonical serialisation (`canonical(members)`) — load-bearing for cross-machine reproducibility.** The digest a second machine recomputes must be byte-identical to the one the producer wrote, so `canonical` is pinned, not left to the JSON encoder: object keys sorted lexicographically at every depth, UTF-8, no insignificant whitespace, integers as plain decimals, and each member represented by its `{ sha256, bytes_len }` (or the nested dir shape) rather than its raw bytes. Reuse the existing canonicalisation the manifest/chain-head path already relies on (`computeChainHead` / `buildManifest` serialise deterministically today) rather than introducing a second scheme.

**The `bundle_store` slot and its fixed `BundleStore` contract.** The publisher and verifier are store-agnostic: they resolve the `bundle_store` slot occupant once and speak only to the contract below. Which occupant is in the slot is the entire on/off and local-vs-distributed control surface — there is no separate publish flag.

```
CONTRACT BundleStore:               # the fixed contract every occupant satisfies
  put(identity, members) -> PutResult
    # Writes all members under the derived handle and makes them visible atomically.
    # Idempotent: a put at an already-published identity whose bundle_manifest_digest matches is a no-op.
    # Returns { ok: false, reason: "store_unavailable" } when the occupant's backing store is unreachable.

  headDigest(identity) -> { status, digest }
    # Reads bundle_manifest_digest. status vocabulary (mirrors resolveAnchorLevel):
    #   ok | bundle-missing | bundle-malformed | bundle-unreadable

  member(identity, name) -> { status, bytes }
    # Reads one member's bytes; same status vocabulary as headDigest.

  listBoundaries(run_id, run_segment_id) -> [BundleIdentity]
    # Enumerates boundary keys under the run/segment prefix (for staleness).
```

Occupants built in this ticket:

| Occupant | Slot role | Behaviour |
|---|---|---|
| **local store** | **default** (built-in, faff-owned) | `put` writes the member tree under a local base path and is atomically visible on completion; reads are local; `listBoundaries` lists the local prefix. Nothing leaves the box. Synchronous, read-after-write consistent. Never returns `store_unavailable`. This is the zero-friction, today's-posture default. |
| **git-remote** | swap-in that **extends** the default | Builds and digests identically, then writes each bundle to its **own dedicated ref** `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>` (an orphan commit whose tree is just that bundle's members) with a **single push to that ref** — never a branch, never the run's code commit. Reads read that ref (`git show <ref>:<member>` after a targeted fetch, GitHub refs/Contents API fallback); `listBoundaries` is `git ls-remote refs/faff/bundles/<run_id>/*`. Returns `store_unavailable` when the remote has no push access. See _Why a dedicated ref, not the code commit_ and _Consistency_ below. |

**Why a dedicated ref, not the code commit (git-remote occupant).** A recovery bundle must publish at *every* safe boundary and must *outlive the run*, so it cannot ride the feature-branch code commit: that would only push when graft happens to push code, and a feature branch is deleted on merge, taking the evidence with it. Instead each bundle is an orphan commit pushed to its own ref under `refs/faff/bundles/…`. This is decoupled from graft and the merge lifecycle, and it has three consequences that matter:
- **No PR, no CI.** A push to a custom ref (not `refs/heads/*` or `refs/tags/*`) opens no PR and triggers no GitHub Actions — Actions only fire on branch and tag pushes. The bundle push is invisible to CI and to the branch/PR UI. (This is the opposite of the rejected ride-the-code-commit approach, which would retrigger CI on every boundary.)
- **Durable + immutable.** `refs/faff/…` refs are not branches: they survive PR merge and branch deletion, and each per-identity ref is written **once** and never updated (a re-publish of the same digest is a no-op; a different digest is refused, never force-updated). The ref name is one-to-one with one bundle, so the ref *is* the immutability guarantee.
- **Self-sufficient discovery.** Reads and `listBoundaries` key off the ref name (deterministic from identity), so a reader needs no head sha — `git ls-remote 'refs/faff/bundles/<run_id>/*'` enumerates a run's boundaries with nothing local. Ref granularity is **per-identity** (one write-once ref per bundle), not a shared per-run ref, so parallel boundaries never race on a push and cleanup is a ref delete.

**Consistency (differs by occupant, fail-closed absorbs the difference).** The **local** occupant is synchronous and read-after-write consistent. The **git-remote** occupant's *push* is also synchronous — it lands the ref on the origin and is acked, or it fails to `store_unavailable`; there is no half-push, and the bundle exists as a local git object before the push regardless. Only the git-remote *read* is eventually consistent, and only on the checkout-free path: a `git fetch` + `git show <ref>` is strongly consistent once the push is acked, but the GitHub refs/Contents API cache lags the git backend by seconds, so an *immediate* checkout-free read on another machine can briefly see `bundle-missing`. This is harmless by construction: recovery reads are never immediate (the producing executor is gone), and a not-yet-propagated bundle reads as `MISSING` / `VERIFICATION_UNAVAILABLE` — a fail-closed non-clean verdict. Eventual consistency can only ever produce a false *negative* (retry later), never a false `CLEAN`.

**`bundle-verdict` contract.** A new deterministic-CLI-computed contract, schema at `plugin/skills/faff/contracts/bundle-verdict.schema.json`, surfaced by `faff contract bundle-verdict`, following the `review-verdict` / custody-verdict idiom.

```
RECORD BundleVerdict:
  verdict: Enum { CLEAN, STALE, MISSING, MALFORMED, TAMPERED, VERIFICATION_UNAVAILABLE }
  identity: BundleIdentity
  cause: String              # a member NAME or status token (e.g. "anchors", "manifest-digest",
                             #   "bundle-unreadable"); NEVER raw member bytes, a filesystem path, or
                             #   config content — the cause is a fixed vocabulary, so it discloses nothing
  superseded_by: BundleIdentity | null   # populated only on STALE
```

**Detection and observability (testability of the two soft branches).** Two behaviours need an observable oracle so a test can assert them without ambiguity:
- **`store_unavailable`** is an occupant-reported outcome of `put`. For the git-remote occupant it is detected by the `git push` (or `gh api`) result: a non-zero push exit whose stderr matches the no-access / no-remote class maps to `{ ok:false, reason:"store_unavailable" }`; a network timeout counts as `store_unavailable`; any other non-zero push is a hard publish error surfaced to the caller. The local default occupant never returns it. A test simulates it by configuring the git-remote occupant against a remote with no push credential and asserting the run reaches its terminal outcome with a `store_unavailable` run event and no bundle at the remote.
- **The idempotent no-op** is observable as: `headDigest(identity)` returns a digest equal to the recomputed `bundle_manifest_digest`, and `put` creates **no new** store object for that identity (for the git-remote occupant: the per-identity ref already exists and is left untouched — no new commit, no push). A test re-runs `publish_bundle` for an already-published identity and asserts the occupant's handle (local bytes, or the ref's commit sha) is unchanged.

**Design decision — the store is a slot, not a hardcoded backend.** Options: (a) hardcode the git remote as the store; (b) a `bundle_store` slot over a fixed `BundleStore` contract, with a conservative default occupant. Hardcoding the git remote makes off-box publishing on-by-default the moment faff runs — a new commit-and-push side-effect on the adopter's remote at every boundary (worse for a repo whose CI fires on every push, the case `graft.push_at_build_complete` already exists to avoid), and it makes any later store swap a code edit. The slot avoids both: the **default occupant is a local store** (nothing leaves the box, no onboarding friction), and off-box publishing is opt-in by putting a **distributing occupant** in the slot. The git-remote occupant **extends** the local default (same assemble + digest, plus the push), exactly the default-to-heavier occupant shape faff already uses for `spec_review` (noon → dark) and `concurrency` (sequential → parallel). **Chosen:** a `bundle_store` slot; default occupant the built-in local store; the git-remote occupant (built here) as the distributing swap-in; a third-party object store as a further occupant. No publish on/off flag — the occupant is the control surface.

**Design decision — safe boundaries.** Options: (a) publish at every state change; (b) publish only at anchor mints; (c) also publish at resume/epoch. A bundle is only worth publishing where the run has a durable, verifiable state, which is exactly where an anchor is minted: the per-issue merge-floor boundary (`faff events anchor`, graft Step 9b) and the run-close boundary (`faff events anchor-run`, ADR-0109). The resume/epoch boundary mints no anchor, so it has nothing to replicate; the bundle records the current `owner.epoch` as its segment id instead. **Chosen:** publish at each anchor mint (the per-issue merge-floor boundary and, in git-only mode, the run-close boundary); the resume/epoch boundary is excluded.

**Boundary availability differs by run mode (load-bearing — corrects the naive "always both" reading).** The per-issue merge-floor anchor (`faff events anchor`, graft Step 9b) mints in **both** tracker-backed and git-only runs, so the per-issue boundary is always available. The run-level anchor (`faff events anchor-run`) mints **only under the git-only signal** — `faff-beep-boop/SKILL.md` is explicit that *"tracker-backed runs never reach this bullet: no anchor is minted"* (the per-PR anchor path carries the evidence instead). Therefore the run-close boundary publishes **only in git-only mode**, wired immediately after `anchor-run`. In a tracker-backed run there is no run-level anchor to replicate, so the run's recovery points are its set of per-issue merge-floor bundles; the publisher mints no run-close bundle and this is correct, not a gap. A future tracker-backed run-close signal (should one be introduced) is a drop-in second call site, not a redesign.

**Design decision — identity.** Options: (a) a new globally unique bundle id; (b) `(run_id, run_segment_id := owner.epoch, boundary_key)`. The triple is machine-independent in content, fully determines the store handle, and introduces no new vocabulary because `run_segment_id` surfaces the existing `owner.epoch`. Cross-machine `run_id` uniqueness is not solved here (it stays FAFF-757); fail-closed immutability makes a collision safe because a colliding writer cannot silently overwrite. **Chosen:** `(run_id, run_segment_id := owner.epoch, boundary_key)`.

**Design decision — discovery.** Options: (a) a mutable index listing published bundles; (b) deterministic identity-to-name derivation plus contract reads. A mutable index breaks immutability and reintroduces a partial-visibility window (a reader can see the index entry before the bundle is fully visible). Deterministic derivation avoids both: the identity maps to a fixed store handle — for the git-remote occupant the per-identity ref `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>`, for the local occupant the mirror path `.faff/bundles/<run_id>/seg-<segment>/<boundary_key>/` — and `headDigest` / `member` / `listBoundaries` read it through the occupant (`git show <ref>:<member>` + refs/Contents API + `git ls-remote` for the git-remote occupant). Because the git-remote ref name is self-sufficient, discovery needs no head sha and no local checkout. **Chosen:** deterministic identity-to-handle derivation plus contract reads; the mutable index is rejected.

## 4. HOW — behaviour

**Architecture.** Two entry points wrap a pure core and a resolved slot occupant, following the pure-core / I-O split idiom in budget.js and run-done.js.

| Layer | Responsibility |
|---|---|
| Pure core `buildBundle(runDir, identity)` | Assembles the member set (copies, projections, structural members), computes each member digest and the top-level `bundle_manifest_digest` over `canonical(members)`. No I/O beyond reading the already-written run files; no store knowledge. |
| Pure core `classifyBundle(read)` | Given the bytes a store read returned, produces a `BundleVerdict` via the verdict ladder. Deterministic; no I/O; no store knowledge. |
| I-O `publishBundle` | Resolves the `bundle_store` slot occupant, resolves identity from the boundary, calls `buildBundle`, writes via `occupant.put`, returns `store_unavailable` without failing the run when a distributing occupant's backing store is absent. |
| I-O `bundle verify` | Resolves the `bundle_store` slot occupant, reads members via `occupant.{headDigest,member,listBoundaries}`, hands bytes to `classifyBundle`, records the verdict via `--record-result`, sets the exit code. |

**Region.** All new code lives in the **factory** region (it touches redaction, effects governance, and git-style integrity operations), alongside `merge-gate.js`, `run-ledger.js`, and `integrity-digest.js`; `faff regions check` must pass. The slot-occupant resolution reuses the standard slot-resolution path (`faff config get slots.bundle_store`, built-in default when unset).

**Publish, wired at the two anchor mints.**

```
PROCEDURE publish_bundle(runDir, boundary_kind, boundary_key):
  0. store := resolve occupant of slots.bundle_store (built-in local store when unset)
  1. Resolve identity:
     a. run_id        := basename(runDir)
     b. run_segment_id := ledger.owner.epoch            # lights-out.js:1146
     c. boundary_seq  := next monotonic seq within (run_id, run_segment_id)
  2. members := buildBundle(runDir, identity)           # pure; copies inherit redaction
  3. result := store.put(identity, members)             # occupant makes it visible atomically
  4. IF result.ok is false AND result.reason = "store_unavailable":
     a. Emit a run event noting store_unavailable       # only a distributing occupant reaches here
     b. Return without failing the run                  # the run continues locally
  5. IF identity already published AND stored bundle_manifest_digest = members' digest:
     a. Treat as a no-op (idempotent re-publish)         # never a rewrite
  6. Return { published: true, identity }
```

Call sites: graft Step 9b immediately after `faff events anchor` (per-issue merge-floor boundary, both run modes), and — **git-only mode only** — the run-close path immediately after `faff events anchor-run` (run-close boundary; see the boundary-availability decision in section 3). The run-close call site never fires in a tracker-backed run because `anchor-run` mints no anchor there. The call sites are identical whatever occupant is in the slot; the default local occupant simply keeps the bundle on the box.

**Identity-component validation (defence in depth).** Before any identity field is interpolated into a store handle (ref name, filesystem path, or object-store key), `run_id`, `run_segment_id`, and `boundary_key` are validated against a strict charset (`run_id` and `boundary_key`: `[A-Za-z0-9._-]+` with no `..` segment; `run_segment_id`: a non-negative integer). In practice `run_id` is faff-minted (a UTC stamp) and `boundary_key` is an issue key (`ISSUE_ID_RE`) or the constant `run-close`, so none is user-controlled today; the validation is a cheap invariant applied by the store-agnostic layer (so every occupant inherits it) that keeps a future identity source from opening a path-traversal write or read. A component that fails validation is a hard error (publish/verify exits non-zero with a `cause`-vocabulary token naming the invalid component), never a best-effort continue.

**Ref discipline (git-remote occupant, fail-closed).** `put` builds an orphan commit (`git commit-tree`, no parent, no working tree touched) whose tree is the bundle's members, and pushes it to the per-identity ref `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>` — never a branch, never a tag, never the run's code commit, never a force-update. Because the ref is write-once and its name is one-to-one with one bundle, the ref itself is the immutable, content-addressed handle a verifier reads; there is no branch ref that could move under it. Reads are `git show <ref>:<member>` after a targeted `git fetch <ref>`, or the GitHub refs/Contents API when nothing is local; `listBoundaries` is `git ls-remote 'refs/faff/bundles/<run_id>/*'`. Other occupants provide their own immutable-visibility mechanism behind the same contract (the local default: an atomic local write; an object store: an immutable/write-once key).

**Recovery model (which executor reads these, and why the run_id is not a problem).** A published bundle is consumed by a later executor. There are two paths, and this is the FAFF-819 ↔ FAFF-820 seam:
- **Same-run resume (the primary path, what `segment` is for).** `lights-out --resume <run_id>` continues the *same run* on a new box and bumps `owner.epoch` to a new segment. The resuming executor already holds the run_id, so it finds the prior segment's bundles under it (`listBoundaries(run_id, …)`), verifies the latest safe boundary, and continues. The run_id is not different, so there is nothing to discover across runs. FAFF-819 fully supports this.
- **Fresh-run pickup (cross-run, discovery by the work).** If instead a brand-new run (new run_id) is meant to recover, it cannot look up by run_id. It discovers by the **work**, which is `boundary_key`: for a per-issue boundary that key *is* the issue, so a fresh run working `<ISSUE>` enumerates `git ls-remote 'refs/faff/bundles/*/*/<ISSUE>'` across all runs, picks the most recent, verifies it, and recovers. FAFF-819 makes this *listable* (the issue is in the ref name), but the enumerate-by-issue-across-runs query and the choose-which-to-resume-from logic are **FAFF-820's read contract**, not built here. `listBoundaries` as shipped here is deliberately run-scoped (it serves resume and staleness); the cross-run by-issue listing is 820's to add on top of this ref layout.

**Anti-pattern:** publishing before the anchor is minted. Why: the anchor is the durable state the bundle replicates; publishing first would replicate a state that is not yet anchored, and a verifier reading the anchor member would find nothing.

**Verify, fail-closed verdict ladder.** The ladder is evaluated in order; the first condition that holds is the verdict. Staleness is only ever considered for an otherwise-CLEAN bundle. It runs identically over whatever occupant is in the slot.

```
PROCEDURE classify_bundle(identity):
  1. head := store.headDigest(identity)
     IF head.status in { bundle-unreadable } OR store unreachable:
        RETURN VERIFICATION_UNAVAILABLE (cause = head.status)   # could not determine — never clean
  2. IF head.status = bundle-missing OR any required member read returns missing:
        RETURN MISSING (cause = the absent member)
  3. FOR each member:
        read its bytes; IF unparseable / fails schema / manifest shape wrong:
           RETURN MALFORMED (cause = that member)
  4. Recompute bundle_manifest_digest over canonical(members):
        IF recomputed != stored:                              RETURN TAMPERED (cause = "manifest-digest")
     FOR each member: IF member.sha256 != sha256(bytes):       RETURN TAMPERED (cause = that member)
     Run diffAgainstManifest against artifact_manifest:        IF diffs: RETURN TAMPERED (cause = first diff)
     Run verifyChain over the anchors' events witness:         IF not verified: RETURN TAMPERED (cause = "events-chain")
     Run verifyEffectsChain over the effects witness:          IF not verified: RETURN TAMPERED (cause = "effects-chain")
  5. IF is_superseded(identity):                               RETURN STALE (superseded_by = the superseding identity)
  6. RETURN CLEAN
```

**Staleness precedence.** A bundle is superseded when a later safe boundary exists for the same run:

```
FUNCTION is_superseded(identity) -> BundleIdentity | null:
  candidates := store.listBoundaries(identity.run_id, identity.run_segment_id)
  # A per-issue boundary is superseded by a later per-issue boundary in the same segment:
  IF identity.boundary_kind = issue-merge-floor:
     later := candidates where boundary_kind = issue-merge-floor AND boundary_seq > identity.boundary_seq
     IF later non-empty: RETURN the highest-seq of `later`
  # ANY per-issue boundary is superseded by a run-close boundary:
  runClose := candidates where boundary_kind = run-close
  IF identity.boundary_kind = issue-merge-floor AND runClose exists: RETURN runClose
  RETURN null
```

**Reused tamper primitives.** Step 4 does not reimplement integrity checks: `diffAgainstManifest` (integrity-digest.js:152, including the append-tolerant `events.jsonl` prefix rule) checks the artifact manifest, and `verifyChain` / `verifyEffectsChain` (events.js:740/748) check the two witness chains. A malformed member and a tampered member are distinct verdicts: MALFORMED is "cannot even parse it", TAMPERED is "parsed fine but the bytes do not match what the digest or chain says they should be".

**Exit codes and record.** `bundle verify` mirrors the custody `--record-result` idiom (writes the verdict record, then exits) and extends its exit mapping to the six verdicts:

| Verdict | Exit | Meaning |
|---|---|---|
| CLEAN | 0 | Positively verified and current. |
| STALE / MISSING / MALFORMED / TAMPERED | 1 | A determinate non-clean verdict was reached (fails closed on stale, missing, malformed, tampered, as the acceptance boundary requires). |
| VERIFICATION_UNAVAILABLE | 2 | No determination could be made (store unreachable or read denied); never treated as clean. |

The full six-value verdict is always written to the record so the consumer (FAFF-820, FAFF-823) can distinguish STALE from a hard failure even though both exit 1.

**Failure modes.**

- **The failure:** the redaction assumption is wrong and a member carries a secret off-box. **How you'd know:** a member that is neither a byte-copy of an already-redacted file nor a projection over one, nor a purely structural record, appears in the member set; or a copied member's source was written on a path that bypasses `atomicWriteLedger` / `appendEventRecord`. **What it means:** narrow. Do not publish that member until it is either routed through the redaction hook or shown to be structural. (This is why the risk lives on the publisher, not the occupant: the default local occupant never leaves the box, but a bad member would still be a latent leak once a distributing occupant is configured.)
- **The failure:** `run_segment_id` is read after the epoch has already advanced, so the bundle is stamped with the wrong segment. **How you'd know:** a published bundle's `run_segment_id` does not match the `owner.epoch` recorded in its own `ledger_snapshot` member. **What it means:** proceed with a guard, resolve `run_segment_id` from the same ledger read that produces `ledger_snapshot`, never a second read.
- **The failure:** a partial write makes some members visible before others, so a verifier sees a bundle that is present-but-incomplete and misclassifies it. **How you'd know:** a MISSING or MALFORMED verdict on a bundle the producer believes it published cleanly. **What it means:** proceed; the atomic-visibility requirement the `BundleStore` contract places on every occupant's `put` is what prevents this (for the git-remote occupant, the ref is created by the single push or not at all), and a verifier that sees a partial state correctly fails closed (MISSING), which is the safe outcome, not a wrong PASS.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run at a per-issue merge-floor boundary that has just minted an anchor via `faff events anchor`
When publish runs at graft Step 9b
Then a bundle is stored by the slot occupant under the identity handle for
     (run_id, run_segment_id, issue), containing ledger_snapshot, admitted_outcomes, anchors,
     artifact_manifest, last_safe_boundary, redaction, and bundle_manifest_digest,
     and its run_segment_id equals the ledger owner.epoch
```

```
Given the bundle_store slot is unset (the default local occupant is resolved)
When publish runs at a boundary
Then the bundle is stored locally, nothing is pushed off-box, and no store_unavailable event is emitted
```

```
Given the git-remote occupant, when publish runs at a boundary
Then the bundle is pushed to refs/faff/bundles/<run_id>/seg-<segment>/<key>, opening no PR and triggering no CI
```

```
Given a published bundle whose stored bundle_manifest_digest no longer matches canonical(members)
When `faff bundle verify` runs against it
Then the verdict is TAMPERED with cause "manifest-digest" and the process exits 1
```

```
Given a bundle whose handle exists but is missing the anchors member
When `faff bundle verify` runs against it
Then the verdict is MISSING with cause naming the anchors member and the process exits 1
```

```
Given the git-remote occupant is configured but the run has no push access to the remote
When publish runs at an anchor mint
Then put returns store_unavailable, a run event records it, the run continues locally, and no bundle is published off-box
```

```
Given a bundle whose store read is denied (bundle-unreadable) rather than absent
When `faff bundle verify` runs against it
Then the verdict is VERIFICATION_UNAVAILABLE and the process exits 2, never CLEAN
```

- The `redaction` member records that redaction ran and never a secret value: no assertion in the bundle contains any resolved `api_key_env` / `seat_token_env` value, `andon.url`, or `andon.token`.

## 6. Design decision rationale

**Local-only or distributed, and how is that chosen?** Options: hardcode the git remote (off-box on by default); or a `bundle_store` slot with a local default occupant. Hardcoding turns off-box publishing on the moment faff runs — a new commit-and-push on the adopter's remote at every boundary, and any later store swap becomes a code edit. **Chosen:** the slot. The default occupant is a local store (zero off-box side-effect, no onboarding friction), off-box publishing is opt-in by putting a distributing occupant in the slot, and the git-remote occupant extends the local default the way `faffter-dark-spec-review` extends `faffter-noon-spec-review`. No publish flag; the occupant is the control.

**Where does a distributing bundle live?** For the git-remote occupant: dedicated write-once refs under `refs/faff/bundles/…` on the git remote, reusing `resolveAnchorLevel`'s checkout-free read model — no infrastructure, atomic single-push visibility, never-rewrite immutability from the write-once ref, and no PR/CI because a custom ref is invisible to GitHub Actions. An object-store occupant is a later drop-in behind the same contract. **Chosen:** the git-remote occupant as the built-here distributor; object store deferred to a further occupant.

**When does it publish?** Options: every state change, only at anchor mints, or also at resume/epoch. Only anchor mints have a durable verifiable state to replicate; resume mints no anchor and is represented by the recorded `owner.epoch` segment id instead. **Chosen:** publish at each anchor mint (per-issue merge-floor and, in git-only mode, run-close); resume/epoch excluded.

**What names a bundle?** Options: a fresh global id, or the `(run_id, run_segment_id := owner.epoch, boundary_key)` triple. The triple is machine-independent, handle-determining, and reuses existing vocabulary; cross-machine `run_id` uniqueness stays FAFF-757 and is made safe by fail-closed immutability. **Chosen:** `(run_id, run_segment_id, boundary_key)`.

**How is a bundle found?** Options: a mutable index, or deterministic handle derivation plus contract reads. A mutable index breaks immutability and reintroduces a partial-visibility window; deterministic derivation read through the occupant reuses `resolveAnchorLevel`'s model for the git-remote case and needs no head sha because the ref name is self-sufficient. **Chosen:** deterministic identity-to-handle derivation plus contract reads; mutable index rejected.

## 7. Open questions and assumptions

**Open questions.** None. All design decisions are closed.

**Assumptions.**

- **Assumes:** when a distributing occupant is configured, its backing store is reachable with write access — for the git-remote occupant, a configured git remote with push access. This is not an assumption for the default local occupant (which needs nothing off-box). Validation: the build agent confirms the git-remote occupant's `publishBundle` returns `store_unavailable` and the run continues locally when push access is absent, rather than failing the run; this is the degraded path, not an error path.
- **Assumes:** `redact.js`'s exact-known-secret scope (resolved `api_key_env` / `seat_token_env`, `andon.url` / `andon.token`, minimum length 8, no PII and no token-shape regex) is sufficient for the minimal bundle contents. Validation: for each member, confirm it is one of (a) a byte-copy of a file already written through `atomicWriteLedger` / `appendEventRecord` and therefore already redacted, (b) a projection over those already-redacted bytes that adds no field, or (c) a purely structural member (`last_safe_boundary`, `redaction`, `bundle_manifest_digest`) whose fields are identifiers, counts, timestamps, refs, and digests, never config-derived free text. The scope is not even exercised on class (c), so no member can carry a secret the hook would have missed.

## 8. DONE — definition of done

### From WHY
- [ ] A bundle stored at a safe boundary is a replica: `bundle verify` re-derives its integrity with no dependency on the producing machine, and no code prefers a bundle over the ledger/anchors/manifest on disagreement.
- [ ] Every non-clean condition (unreachable, missing, malformed, digest mismatch, broken chain, superseded) returns a non-clean verdict; no path degrades to CLEAN.
- [ ] A re-publish at an already-published identity with a matching digest is a no-op, never a rewrite.
- [ ] Off-box publishing is opt-in: with `slots.bundle_store` unset, the default local occupant is resolved and nothing leaves the box; no publish on/off flag exists.

### From WHAT (types, slot, and contract)
- [ ] `BundleIdentity` matches the schema, and the store handle derives deterministically (git-remote ref `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>`; local path mirror).
- [ ] The minimal member set is exactly `ledger_snapshot`, `admitted_outcomes`, `anchors`, `artifact_manifest`, `last_safe_boundary`, `redaction`, and the top-level `bundle_manifest_digest`; no fingerprint, restart-descriptor, or unresolved-effect member is present.
- [ ] `bundle_manifest_digest` is `sha256` over `canonical(members)` and is recomputed on read rather than trusted as read; `canonical` is the pinned deterministic serialisation (sorted keys, UTF-8, no insignificant whitespace), reusing the existing manifest/chain-head canonicalisation, so a second machine recomputes a byte-identical digest.
- [ ] `slots.bundle_store` resolves via the standard slot path with the built-in **local store** as the default occupant; the **git-remote** occupant is the built-here distributing swap-in; both satisfy the one `BundleStore` contract (`put` / `headDigest` / `member` / `listBoundaries`).
- [ ] `put` makes members visible atomically for every occupant; only a distributing occupant returns `store_unavailable` (the local default never does).
- [ ] The publisher and verifier hold no store-specific logic; they resolve the occupant once and speak only to the contract.
- [ ] `bundle-verdict` schema exists at `plugin/skills/faff/contracts/bundle-verdict.schema.json` and is surfaced by `faff contract bundle-verdict`, following the `review-verdict` idiom.

### From HOW (behaviour)
- [ ] `publishBundle` is wired at graft Step 9b (after `faff events anchor`, both run modes) and — git-only mode only — at the run-close path (after `faff events anchor-run`), and at no other site; a tracker-backed run mints no run-close bundle. The call sites are occupant-agnostic.
- [ ] `run_id`, `run_segment_id`, and `boundary_key` are validated against the strict charset in the store-agnostic layer before any handle interpolation; a failing component is a hard error inherited by every occupant.
- [ ] The git-remote occupant writes each bundle to its own write-once ref `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>` (an orphan commit, single push to that ref), never a branch/tag, never the code commit, never a force-update; a push to that custom ref triggers no PR and no CI. Reads and `listBoundaries` key off the ref name and need no head sha.
- [ ] Same-run resume finds prior bundles via `listBoundaries(run_id, …)`; the cross-run enumerate-by-issue query is documented as FAFF-820's, and this ticket's ref layout keeps it listable (`git ls-remote 'refs/faff/bundles/*/*/<ISSUE>'`).
- [ ] The git-remote push is synchronous (`store_unavailable` or acked); only the checkout-free read path is eventually consistent, and a not-yet-propagated bundle fails closed to MISSING / VERIFICATION_UNAVAILABLE, never a false CLEAN.
- [ ] `store_unavailable` is detected by the git-remote occupant from the push result (no-access / no-remote / timeout class) and is distinguished from a hard publish error; a test simulates it with a credential-less remote and asserts the run completes with a `store_unavailable` event and no published bundle.
- [ ] The idempotent no-op is observable: `headDigest` equals the recomputed digest and `put` creates no new store object; a test asserts the occupant handle is unchanged on re-publish.
- [ ] `BundleVerdict.cause` is a member-name or status token from a fixed vocabulary, never raw member bytes, a filesystem path, or config content.
- [ ] `run_segment_id` is read from the same ledger read that produces `ledger_snapshot`, and equals `owner.epoch`.
- [ ] `bundle verify` produces exactly one of CLEAN / STALE / MISSING / MALFORMED / TAMPERED / VERIFICATION_UNAVAILABLE per run, over whatever occupant is in the slot.
- [ ] Tamper detection reuses `diffAgainstManifest`, `verifyChain`, and `verifyEffectsChain`; no forked integrity check is added.
- [ ] Staleness precedence holds: a per-issue boundary is superseded by a higher-`boundary_seq` per-issue boundary in the same segment, and any per-issue boundary is superseded by a run-close boundary.
- [ ] Exit codes map CLEAN to 0, the four determinate non-clean verdicts to 1, and VERIFICATION_UNAVAILABLE to 2; the full verdict is always written via `--record-result`.
- [ ] All new code is in the factory region and `faff regions check` passes.

### From HOW (edge cases and failure modes)
- [ ] `store_unavailable` at publish (distributing occupant) records a run event and does not fail the run.
- [ ] A present-but-incomplete bundle verifies as MISSING (fails closed), never as CLEAN.
- [ ] A read denial (`bundle-unreadable`) verifies as VERIFICATION_UNAVAILABLE with exit 2, never CLEAN.

### From assumptions
- [ ] Each member is confirmed to be a byte-copy of an already-redacted file, a projection over already-redacted bytes, or a purely structural member; no member carries a config-derived secret value.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Run a fixture run to a per-issue merge-floor boundary; mint the anchor.
  2. With slots.bundle_store unset (default local occupant), call publishBundle; assert a local bundle
     appears at the derived handle with the seven members and nothing is pushed off-box.
  3. Call `faff bundle verify`; assert verdict CLEAN, exit 0.
  4. Corrupt one byte of the ledger_snapshot member in the store.
  5. Call `faff bundle verify` again; assert verdict TAMPERED with cause naming ledger_snapshot, exit 1.
  6. Configure the git-remote occupant against a scratch remote; re-publish; assert the bundle appears at
     refs/faff/bundles/... (no PR, no CI run) and a checkout-free `faff bundle verify` from a directory with
     no .faff/runs returns CLEAN, exit 0.
```

confidence: high
spec-review: approve (prior shape; re-run advised on a healthy backend after the slot + ref recast)

## Methodology critique

Lens: `faffter-dark-methodology-agile-delivery` (`issue-critique`), run against the pre-narrow single-ticket spec. Actioned at prep: the split it recommended was taken — the recovery-semantics members are now FAFF-845, and the dep-reclassify flag (FAFF-841/842) was checked and resolves to keep-Related (FAFF-841 preserves the Step-9b anchor mint FAFF-819 hooks and leaves merge-gate unchanged, so there is no load-bearing ordering to promote). Retained here as the audit trail of why the scope was cut.

**Right-sized? (Principle 4) — Split candidate (actioned).** The pre-narrow spec bundled the publish mechanism, four invented members, a six-value verdict, two CLI commands, and two contract schemas into one ticket, none independently sequenceable. Cut taken: FAFF-819 keeps the publish mechanism, the minimal member set, the fail-closed verifier its own acceptance boundary demands, and the `bundle_store` slot with its local default and git-remote occupant; the recover-coupled invented members moved to FAFF-845.

**Workstream fit? (Principles 1 + 5) — Cohesion smell (held).** The project drew a publish / recover / accept-evidence seam across FAFF-819 / 820 / 823; the pre-narrow spec pulled recover-side concerns back. The verifier and `STALE` stay in FAFF-819 because its acceptance boundary explicitly requires independent verification to fail closed on missing / stale / malformed / tampered members; the recover-only members (fingerprint, restart descriptor, unresolved effects) moved to FAFF-845, co-designed with FAFF-820's read contract.

**Deps surfaced? (Principle 6) — Checked, no reclassify.** FAFF-841/842 (graft landing loop, L3 resume) were linked Related. Grounded against graft Step 9b: FAFF-841 inserts its In Review write after `gh pr create` and preserves the `faff events anchor` mint (SKILL.md:450) FAFF-819 hooks, and leaves `merge-gate.js` unchanged. No rework of FAFF-819's hook point, so the relation stays Related; the two rebase cleanly if built in parallel.

**Risk profile? (Principle 7) — De-risked by the narrow and the slot.** The invented-membership risk was the medium-confidence driver; moving the recover-coupled members to FAFF-845 (proven by a real FAFF-820-style consume before they freeze) removes it from FAFF-819. The slot recast also removes the on-by-default off-box side-effect (an onboarding risk): the default local occupant leaves nothing off-box, and the dedicated-ref design keeps distribution off the PR/CI path entirely. The two remaining Assumes are non-blocking: the distributing-occupant reachability assumption degrades to `store_unavailable`, and the redaction-scope assumption is discharged by construction (every member is an already-redacted copy, a projection over redacted bytes, or a structural record).