# FAFF-845: enrich the Phase 0 recovery bundle: contract fingerprint + landing-progress

> Spec: faffter-dark-nlspec · 2026-08-18 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-845.

This is the build spec for FAFF-845 ("Enrich Phase 0 recovery bundles with recovery-semantics members"). It supersedes the earlier 2026-08-18 draft: `restart_descriptor` and `unresolved_effects` are both out, and the single open question about who owns the post-recovery read path is resolved (Option A, owned here). Two things ship, plus the verifier change that makes them safe.

## 1. Why: problem and principles

**The key idea.** A Phase 0 recovery bundle is the only trace a later executor has of a run whose original box is gone. Some facts can be recomputed from what the bundle already carries; others can only be captured at mint time and are lost forever if not. FAFF-819 shipped a minimal 6-member bundle. This ticket adds exactly the facts that are capture-now-or-never, and wires the one already-planned reader so the recovered data is actually reachable.

**Problem.** FAFF-819's bundle carries enough to reconstruct and resume a run (FAFF-820 reads `ledger_snapshot` + `anchors`), but it does not record the governance posture the run was minted under, and it does not carry the per-issue landing fix-cycle counter that FAFF-842 needs to resume a stranded In Review PR. Both gaps are only fillable from the original run's own state. This change adds a `contract_fingerprint` member and rides the existing `landing-progress.json` into the bundle, then extends FAFF-820's read path so the counter is readable after recovery.

**Design principles.**

**Never read the ledger twice.** The posture inside `contract_fingerprint` is read off the already-in-memory parsed `ledger_snapshot`, never a second `run-ledger.json` read. This mirrors FAFF-819's existing `run_segment_id` rule. A second read could observe a torn or later-mutated ledger and mint a fingerprint that disagrees with the bundled snapshot.

**Deterministic, no wall-clock.** Every byte a new member contributes must be reproducible: a re-publish of the same already-minted anchor must produce byte-identical members (FAFF-819's idempotent-no-op invariant). No `new Date()`, no ambient state, canonical JSON serialisation.

**Additive only.** The reconstruction change (FAFF-820's `reconstructProjection`) must not alter existing behaviour for any run that has no `landing-progress.json`. The existing three writes stay byte-for-byte as today.

**Fail closed, and gate on the version.** The verifier must classify an already-published `b1` bundle CLEAN and a new `b2` bundle missing the new member as MISSING. The manifest version selects the required-member set, so it does the real work, not cosmetic.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | `buildBundle` mints the member set; `classifyBundle` verifies it. Both change here. |
| `plugin/skills/faff/bin/lib/bundle-recover.js` | FAFF-820's `reconstructProjection` restores a bundle. Option A extends it. |
| `plugin/skills/faff/bin/lib/events.js` | `mintIssueAnchor`'s `optionalFloorFiles` list. One entry added. |
| `plugin/skills/faff/bin/lib/effects.js` | `landingProgressPath` (FAFF-846) defines where the counter lives. `computeEscapes` is the shape a future `unresolved_effects` would mirror. |
| `plugin/skills/faff/bin/lib/lights-out.js` | `mintLightsOut` stamps the four posture fields into the ledger. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | `CONTRACTS` (23 names) and the schema-file resolution the fingerprint reuses. |

**Scope.** This sits inside FAFF-819's bundle factory and FAFF-820's recover verb. It publishes evidence and makes one already-planned reader reach it; it does not add a new posture-aware recovery gate.

## 2. Out of scope

**`unresolved_effects` member: dropped, deferred to a real consumer.**
- Why excluded: its source, `declared-effects.jsonl`, is already carried verbatim inside the `anchors` member. Any future consumer can recompute declared-minus-observed on demand. Unlike the mint-time posture, it is not capture-now-or-never, so materialising it now as a required member with no shipped reader only adds a second copy and a consistency invariant to maintain.
- Extension point: a future `computeUnresolvedEffects(entries, issueFilter)` in `effects.js`, a sibling of `computeEscapes`, computing `declared.filter(D => !observed.some(O => O.kind === D.kind && effectTargetMatches(D.target, O.target)))` over the anchors' `declared-effects.jsonl`. Landed by the consumer that needs it, not here.
- **Chosen:** keep the bundle minimal here; do not materialise `unresolved_effects`.

**`restart_descriptor` member: dropped.**
- Why excluded: no shipped or planned consumer. FAFF-820's `bundle-recover` self-computes the next action (resume or park) from `ledger_snapshot` + `anchors` through the shipped resume cores, so a stored next-action descriptor would be a second, drift-prone source of the same decision.
- **Chosen:** drop it; the recover verb keeps computing the next action itself.

**The posture-aware recovery gate itself: out of scope.**
- Why excluded: this ticket publishes the `contract_fingerprint` evidence. The gate that reads it (a future check in `bundle-recover.js`'s `previewResume` that refuses or warns on a posture or contract-schema mismatch) is separate work with its own tests.
- **Chosen:** ship the evidence now, the gate later.

## 3. What: types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Posture | The four governance fields `mintLightsOut` stamps into the run ledger: `dial_profile`, `floor`, `corrective_authority`, `prd_creative_licence`. |
| `b1` / `b2` | The bundle manifest version. `b1` is FAFF-819's 6-member set; `b2` adds `contract_fingerprint`. |
| Capture-now-or-never | A fact that cannot be recomputed from the bundle's other bytes after the minting box is gone. |

**The `contract_fingerprint` member.** A JSON object, canonically serialised.

```
RECORD ContractFingerprint:
  digest: hex-string          # sha256hex(canonicalJSON(inputs))
  inputs: FingerprintInputs

RECORD FingerprintInputs:
  version: "cf1"                          # this record's own schema tag, constant
  posture: Posture                        # read off ledger_snapshot, never a second ledger read
  contract_schema_versions: Map<name, hex-string | null>   # key-sorted; null for a missing schema file

RECORD Posture:
  dial_profile: object | null             # ledger.dial_profile (an OBJECT), or null if absent
  floor: object | null                    # ledger.floor (an OBJECT), or null if absent
  corrective_authority: "available" | "channel-D-only" | null
  prd_creative_licence: "broad" | "tight" | null

  # Every field is null-tolerant: a null or absent ledger field folds to null, never throws.
```

Notes the build agent needs:
- `dial_profile` and `floor` are whole objects (`mintLightsOut` writes `dial_profile = { appetite, convergence, slots, gates }` and `floor = { no_execute, worktree_isolation, autonomous_contract }`). Carry them verbatim; do not flatten or re-derive them.
- `corrective_authority` is the enum string `mintLightsOut` already wrote. `prd_creative_licence` is `"broad"`, `"tight"`, or `null`.
- `contract_schema_versions` is built over `Object.keys(CONTRACTS)` (23 names, hyphenated), sorted. For each name, resolve the schema file exactly as `contract-defs.js` does, `path.resolve(HERE, "..", "contracts", "<name>.schema.json")`, read the bytes, and store `sha256hex(bytes)`. A missing or unreadable schema file stores `null`, never throws.
- The member bytes are `canonicalJSON(fingerprint)`, so the whole member is deterministic and byte-stable across republishes.

**Manifest version and required-member sets** (`bundle.js`).

```
BUNDLE_MANIFEST_VERSION = "b2"            # was "b1"; new publishes stamp b2

REQUIRED_MEMBERS_B1 = [ledger_snapshot, admitted_outcomes, anchors,
                       artifact_manifest, last_safe_boundary, redaction]   # the shipped 6
REQUIRED_MEMBERS_B2 = REQUIRED_MEMBERS_B1 + [contract_fingerprint]         # the 6 + 1

FUNCTION requiredMembersFor(version):
  RETURN version == "b2" ? REQUIRED_MEMBERS_B2 : REQUIRED_MEMBERS_B1
  # default to the b1 set: an absent/unknown version reads as the original contract, never
  # as "b2 minus the new member" (which would false-flag every legacy bundle MISSING).
```

**The landing-progress member.** No new bundle member and no format change. `landing-progress.json` is added to `mintIssueAnchor`'s `optionalFloorFiles`, so it is copied into the anchor directory when present and rides `readAnchorDir` into the existing `anchors` member generically. It is covered by the `anchors` member's own sha256, so it needs no `REQUIRED_MEMBERS` entry.

**Design decisions.**

**`contract_fingerprint`: a published-for-future member, no shipped reader.** FAFF-820's `bundle-recover` reads only `ledger_snapshot` + `anchors` and does no posture check, so nothing consumes this member yet. It is published anyway because the minting posture (and specifically the publisher's local schema-file hashes at mint) is capture-now-or-never: it cannot be reconstructed from a drifted recovering box, unlike a derivation of already-bundled data. The named future reader is the posture-aware recovery gate. **Chosen:** publish `contract_fingerprint` now with no current consumer; state the no-reader fact plainly rather than inventing one.

**`contract_schema_versions` is a new derivation, not a reuse.** No existing schema-version registry exists to reuse; the map is derived here by hashing each `CONTRACTS` schema file, resolving paths the same way `contract-defs.js` does so the two never drift. **Chosen:** derive the map here; do not fabricate a reuse of a registry that does not exist.

## 4. How: behaviour

**Minting (`buildBundle`).** `buildBundle` already parses the ledger once into `ledgerObj`. Add the fingerprint from that same object, and add the member to the set.

```
PROCEDURE buildBundle(runDir, identityInput, root):     # extends the shipped function
  ... existing member assembly (ledger_snapshot ... redaction) ...
  posture = {
    dial_profile:         ledgerObj.dial_profile ?? null,
    floor:                ledgerObj.floor ?? null,
    corrective_authority: ledgerObj.corrective_authority ?? null,
    prd_creative_licence: ledgerObj.prd_creative_licence ?? null,
  }
  schemaMap = {}
  FOR name IN sort(Object.keys(CONTRACTS)):
    schemaPath = path.resolve(HERE, "..", "contracts", name + ".schema.json")
    schemaMap[name] = tryReadBytes(schemaPath) is bytes ? sha256hex(bytes) : null   # null, never throw
  inputs = { version: "cf1", posture, contract_schema_versions: schemaMap }
  fingerprint = { digest: sha256hex(canonicalJSON(inputs)), inputs }
  contractFingerprintBytes = Buffer.from(canonicalJSON(fingerprint), "utf8")
  memberBytes = { ...the 6 existing..., contract_fingerprint: contractFingerprintBytes }
  # memberRefs, bundle_manifest_digest, and manifest.version = "b2" follow the existing path unchanged.
```

**Anchoring (`events.js`).** One-line change: append `"landing-progress.json"` to `optionalFloorFiles`. `mintIssueAnchor` copies each present file from `<run-dir>/<issue>/` into the anchor directory; `landingProgressPath(runDir, issue)` is exactly `<run-dir>/<issue>/landing-progress.json`. An issue that never ran a landing loop simply has no such file, and it is skipped.

**Verifying (`classifyBundle`).** Select the required-member set from the manifest version, then run the shipped ladder over that set unchanged.

```
PROCEDURE classifyBundle(read):                          # extends the shipped function
  ... existing head-status ladder (VERIFICATION_UNAVAILABLE / MISSING / MALFORMED) ...
  required = requiredMembersFor(read.version)             # b1 -> 6, b2 -> 7, default -> 6
  # every existing loop that iterated REQUIRED_MEMBERS now iterates `required`:
  #  missing -> MISSING (names the member); non-ok status/parse-fail -> MALFORMED;
  #  per-member sha256 + manifest digest mismatch -> TAMPERED (names it).
  # The temp-dir tamper leg (overlap manifest + verifyChain/verifyEffectsChain) is UNCHANGED.

  # Additive deep cross-check for contract_fingerprint (b2 only), over BUNDLE-CARRIED bytes only:
  IF "contract_fingerprint" IN required:
    fp = parsed.contract_fingerprint
    IF sha256hex(canonicalJSON(fp.inputs)) != fp.digest:  RETURN TAMPERED, cause "contract_fingerprint"
    IF fp.inputs.posture != (posture off parsed.ledger_snapshot):  RETURN TAMPERED, cause "contract_fingerprint"
  ... existing staleness / CLEAN tail ...
```

**Threading the version through the read.** `read.version` must reach `classifyBundle`. The store's `headDigest` already parses `manifest.json`; have it also return `version` (both occupants, local and git-remote). `verifyBundleIdentity` then reads `head.version`, computes `required = requiredMembersFor(head.version)`, fetches member bytes for `required` (not the hardcoded 6), and passes `read.version = head.version` into `classifyBundle`. Because `version` rides in the digest-covered head, forging it means forging the head digest, which the fail-closed verifier already rejects upstream.

**Anti-pattern:** the verifier recomputing `contract_schema_versions` from the recovering box's own `contracts/` files. Why: publisher-vs-recoverer schema drift is exactly what the fingerprint records; a local re-derivation would false-flag TAMPERED on a box whose shipped schemas differ. The verify legs use only bytes the bundle itself carries.

**Reconstruction (`bundle-recover.js`, Option A owned here).** Extend `reconstructProjection` so the restored `landing-progress.json` is also copied up into `<run-dir>/<issue>/`, matching where `faff landing-progress read <run-dir> <issue>` looks.

```
PROCEDURE reconstructProjection(targetRoot, identity, memberBytes):   # extends FAFF-820's function
  ... existing writes UNCHANGED: run-ledger.json -> runDir; anchor files -> anchorDir; events.jsonl -> runDir ...
  # Additive: only when the restored anchor carries a landing-progress.json.
  landingSrc = path.join(anchorDir, "landing-progress.json")
  IF exists(landingSrc):
    issueDir = path.join(runDir, identity.boundary_key)      # same boundary_key the anchorDir join already trusts
    mkdirp(issueDir); copyFile(landingSrc, path.join(issueDir, "landing-progress.json"))
  # No landing-progress.json present -> nothing extra written -> projection byte-identical to today.
```

Only `landing-progress.json` is copied up. The same `<run-dir>/<issue>/` gap exists today for `build-progress.json`, `review-verdict.json`, and `ac-checklist.json`, none of which has a named post-recovery reader; do not broaden the copy to them without a reason. `landing-progress.json` is the one file with a reader (FAFF-842, via `faff landing-progress read`, per FAFF-846's plan).

**Design decisions.**

**Version-gate the required-member set.** `classifyBundle` currently iterates a flat `REQUIRED_MEMBERS` with no branch on `manifest.version`. Adding `contract_fingerprint` to that flat set would retroactively classify every already-published `b1` bundle (6 members) as MISSING, even though FAFF-820 can still recover them (it reads only `ledger_snapshot` + `anchors`, both present in `b1`). Verification and consumption would then disagree across a rolling deploy. Gating the set on `manifest.version` means an existing `b1` bundle still verifies CLEAN and a `b2` bundle requires the new member (fail-closed if absent). This is what makes the `b1` to `b2` bump do real work, correcting the earlier draft's "cosmetic" framing. **Chosen:** select the required-member set from `manifest.version`; new publishes stamp `b2`; the verifier honours both.

**landing-progress rides the anchors member; no format change.** Adding it to `optionalFloorFiles` reuses the anchor's existing generic byte-copy in and out. It gets tamper coverage for free and needs no `REQUIRED_MEMBERS` entry or bundle-format change. **Chosen:** ride the anchor, do not mint a new bundle member.

**Option A, owned by FAFF-845.** The post-recovery read path (copying `landing-progress.json` up into `<run-dir>/<issue>/`) is edited here, in `reconstructProjection`, so `faff landing-progress read` works unchanged after recovery. The alternative (a new reader that looks in the anchor dir) would fork the read path FAFF-846 already shipped. **Chosen:** extend `reconstructProjection`; copy only `landing-progress.json`; guard the copy on presence so it is strictly additive.

**Verify only over bundle-carried bytes.** **Chosen:** the deep cross-check recomputes the digest from the member's own `inputs` and compares the posture to the bundle's own verified `ledger_snapshot`; it never touches the recovering box's local `contracts/`.

## 5. Scenarios

- **Digest changes when any posture field flips:** given a run ledger with a known posture, when `buildBundle` mints it then a single posture field is changed and it is minted again, then the `contract_fingerprint.digest` differs.
- **Byte-identical republish (determinism):** given an already-minted anchor and its published b2 bundle, when `buildBundle` runs again for the same identity, then the `contract_fingerprint` member bytes are byte-identical and the store resolves the re-publish as an idempotent no-op.
- **Posture read off ledger_snapshot, not a second read:** given a bundle whose `ledger_snapshot` records posture P, when the fingerprint is inspected, then its `inputs.posture` equals P read from that same `ledger_snapshot`, with no second `run-ledger.json` read.
- **Null-tolerant posture:** given a run ledger missing `prd_creative_licence` (or any posture field absent), when `buildBundle` mints the fingerprint, then the missing field folds to null and no error is thrown.
- **Schema-version map sorted and null-safe:** given the shipped `CONTRACTS` set with one schema file deliberately absent, when `contract_schema_versions` is built, then it has one entry per name in sorted order, each a sha256hex of the schema bytes, and the absent file's value is null.
- **A b1 bundle still verifies CLEAN:** given a bundle published as b1 (6 members, no `contract_fingerprint`), when verified by the new `classifyBundle`, then the verdict is CLEAN.
- **A b2 bundle missing contract_fingerprint is MISSING; a tampered one is TAMPERED:** given a b2 bundle, removing `contract_fingerprint` yields MISSING (cause `contract_fingerprint`); altering its bytes yields TAMPERED naming it.
- **The verifier never re-derives the schema map locally:** given a CLEAN b2 bundle whose `contract_schema_versions` differ from the verifying box's local `contracts/` files, when verified, then the verdict is still CLEAN.
- **landing-progress rides in and is readable after recovery:** given a run with a `<run-dir>/<issue>/landing-progress.json` and a published bundle, when `bundle-recover` reconstructs at a fresh root, then `landing-progress.json` is restored into the anchor dir AND copied into `<run-dir>/<issue>/`, so `faff landing-progress read <run-dir> <issue>` returns the record.
- **Reconstruction stays additive when there is no landing-progress:** given a CLEAN bundle whose anchor carries no `landing-progress.json`, when `reconstructProjection` runs, then the run-ledger copy, anchor restore, events.jsonl copy-up, and resume preview are all identical to today, and no `<run-dir>/<issue>/` file is written.

## 6. Design decision rationale

**Ship `contract_fingerprint` with no current reader?** Publish now captures the mint-time schema-hash surface, which a drifted recoverer cannot reconstruct; waiting for the gate keeps the bundle smaller but the surface is unrecoverable by then. **Chosen:** publish now; the named future reader is the posture-aware recovery gate.

**Reuse a schema-version registry or derive the map?** No registry exists to reuse. **Chosen:** derive, path-resolved identically to `contract-defs.js` so the two cannot drift.

**Is the `b1` to `b2` bump cosmetic?** Treating it as cosmetic retroactively fails every b1 bundle as MISSING while FAFF-820 can still recover them. **Chosen:** the version does the work; `classifyBundle` picks the set from `manifest.version`.

**New bundle member for landing-progress, or ride the anchor?** **Chosen:** ride the anchor (one line in `optionalFloorFiles`; no format change).

**Who owns the post-recovery read path?** (Was the open question; resolved by the human to Option A.) **Chosen:** Option A, owned by this ticket; copy only `landing-progress.json`, guarded on presence, strictly additive.

**Deep cross-check against local files or bundle bytes?** **Chosen:** bundle bytes only; never re-derive `contract_schema_versions` locally.

## 7. Open questions and assumptions

**Open questions.** None. The read-path ownership question is resolved to Option A above.

**Assumes: the build rebases onto `origin/main` first.** `bundle-recover.js` and `effects.js`'s `landingProgressPath` exist only on `origin/main`. Validation: before starting, confirm `plugin/skills/faff/bin/lib/bundle-recover.js` exists and `effects.js` exports `landingProgressPath`; if either is absent, rebase onto `origin/main` before writing code.

## 8. Done

**From why**
- [ ] The bundle records the mint-time posture (`dial_profile`, `floor`, `corrective_authority`, `prd_creative_licence`) that cannot be recomputed after the minting box is gone.
- [ ] The per-issue `landing-progress.json` is recoverable after a cross-box recovery.

**From what (types)**
- [ ] `contract_fingerprint` matches the record: `{ digest, inputs: { version: "cf1", posture, contract_schema_versions } }`; `digest === sha256hex(canonicalJSON(inputs))`.
- [ ] `posture` carries `dial_profile`/`floor` as whole objects, `corrective_authority` as `"available"|"channel-D-only"|null`, `prd_creative_licence` as `"broad"|"tight"|null`; a null/absent field folds to null and the mint never throws.
- [ ] `contract_schema_versions` has one entry per `Object.keys(CONTRACTS)` in sorted order; each value is `sha256hex` of the schema bytes resolved via `path.resolve(HERE, "..", "contracts", "<name>.schema.json")`, or `null` for a missing file.
- [ ] `BUNDLE_MANIFEST_VERSION` is `"b2"`; `requiredMembersFor("b1")` is the original 6, `requiredMembersFor("b2")` is those 6 plus `contract_fingerprint`, an absent/unknown version defaults to the b1 set.

**From what (posture read)**
- [ ] The posture is read off the already-parsed `ledger_snapshot`, with no second `run-ledger.json` read.

**From how (minting and anchoring)**
- [ ] `contract_fingerprint` member bytes are `canonicalJSON(fingerprint)` and byte-identical across a re-publish of the same anchor; the digest is deterministic with no wall-clock input.
- [ ] `"landing-progress.json"` is appended to `mintIssueAnchor`'s `optionalFloorFiles` and rides `readAnchorDir` into the `anchors` member when present.

**From how (verifying)**
- [ ] A `b1` bundle verifies CLEAN under the new `classifyBundle`.
- [ ] A `b2` bundle missing `contract_fingerprint` returns MISSING (cause `contract_fingerprint`); a tampered one returns TAMPERED naming it.
- [ ] The deep cross-check flags a `contract_fingerprint` whose `digest` disagrees with `sha256hex(canonicalJSON(inputs))`, or whose `inputs.posture` disagrees with the bundle's own `ledger_snapshot`, as TAMPERED.
- [ ] The verifier never recomputes `contract_schema_versions` from the recovering box's local `contracts/`; a box with differing local schemas still reads a CLEAN bundle CLEAN.
- [ ] `headDigest` returns `version`, and `verifyBundleIdentity` fetches members for `requiredMembersFor(head.version)` and passes `read.version` to `classifyBundle`, for both the local and git-remote occupants.

**From how (reconstruction, Option A)**
- [ ] `reconstructProjection` copies a restored `landing-progress.json` from the anchor dir up into `<run-dir>/<identity.boundary_key>/landing-progress.json`; after recovery `faff landing-progress read <run-dir> <issue>` returns the record.
- [ ] For a bundle with no `landing-progress.json`, `reconstructProjection` writes nothing extra and its existing outputs are unchanged from today. A focused test proves this additive property.
- [ ] Only `landing-progress.json` is copied up; `build-progress.json`, `review-verdict.json`, and `ac-checklist.json` are not.

**From out of scope**
- [ ] No `unresolved_effects` member is added; no `restart_descriptor` member is added; no posture-aware recovery gate is added.

**Integration smoke test.**
```
1. Mint an L4-style run ledger with a full posture; write a <run-dir>/<issue>/landing-progress.json.
2. mintIssueAnchor -> anchor carries landing-progress.json.
3. publishBundle -> a b2 bundle with contract_fingerprint.
4. verifyBundleIdentity -> CLEAN.
5. bundle-recover at a fresh root -> reconstructed; run-ledger + anchor + events.jsonl present,
   and <run-dir>/<issue>/landing-progress.json present.
6. `faff landing-progress read <run-dir> <issue>` returns the record.
```

confidence: high
build-tier: complex
spec-review: approve
