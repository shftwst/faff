# nlspec: Extend the Commissaire merge-chokepoint decision verification to the committed-anchor / CI path (FAFF-976)

> Spec: faffter-dark-nlspec · 2026-09-05 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-976.

This document specifies the change for FAFF-976. Its audience is the build agent that will implement it and the human and adversarial reviewers who gate it. It is buildable from this document alone. Every code claim below was checked against the working tree; line numbers are given as landmarks, not contracts, so re-confirm them before editing.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** A governed run proves, at merge time, that a signed Commissaire decision (an Ed25519 `effect-decision-verdict`) covers the merge effect. That proof is re-checked in CI against a *committed anchor* (a frozen, git-committed snapshot of the run's evidence). The re-check verifies the committed decision under a *public* Commissaire key. The anchor must therefore carry that public key, and only the public key, because the governor's secret material (the Ed25519 secret key and the HMAC master) must never be committed. This ticket makes the anchor carry the public `pk.json` so the CI re-verification can actually run.

**Problem statement.** Today a governed run's committed anchor does not carry `commissaire/producer/pk.json`, so when governance-check re-authenticates the anchor's schema:3 records in CI it has no public key to verify the Commissaire decision against and fails closed (`integrity` leg returns `auth-failed`), refusing a genuinely-governed merge. FAFF-828 proved the chokepoint on the *live* run dir, but the anchor / CI path is where an unattended merge actually re-proves the floor. This change byte-copies the public `pk.json` into the anchor so the prevention property holds end to end in CI.

**A correction to the ticket's stated mechanism, load-bearing for scope.** The ticket (and the explore findings' scope item 2) name `resolveCommissaireDecisionGrant` / the `decision_grant` floor field as the failing anchor-path leg. That is not what runs in CI. Verified in `governance-check.js`:

- The anchor / CI path is `evaluateAnchorDir(dir, ...)` (governance-check.js ~line 262), which runs `evaluateIntegrityLeg(dir, ..., { requireWitness: true })` and `evaluateMergeFloorLeg(dir, ".", level)`.
- `evaluateMergeFloorLeg` (governance-check.js ~line 134) reads only `ac_complete`, `review_verdict`, and (at L4) `holdout`. It never reads `decision_grant` and never calls `resolveCommissaireDecisionGrant`.
- `resolveCommissaireDecisionGrant` (merge-gate.js ~line 772) is called only from the *live* merge-gate paths (merge-gate.js ~lines 1026 and 1247), where the effective `runDir` is the live run dir that already contains `pk.json`. It is never invoked against a committed anchor.
- The decision *is* re-verified on the anchor, but through a different leg: `evaluateIntegrityLeg`'s schema:3 auth sub-leg (governance-check.js ~lines 221-236). When `hasGovernanceContext(dir)` is true it calls `verifyAuthLeg(dir)`, which re-verifies every committed Commissaire decision under the public key.

So the fix belongs to `verifyAuthLeg`'s key resolution, not to `resolveCommissaireDecisionGrant`. `verifyAuthLeg` (commissaire.js ~line 195, FAFF-978) resolves the key as: prefer `governor.json`'s `pk` (the authoritative live root), else fall back to the producer-dir `pk.json`. On a committed anchor `governor.json` is deliberately absent, so the fallback to `commissaire/producer/pk.json` is the *only* source, and it is missing today. That missing file, read via `pkFileOf(producerDirOf(dir))`, is the whole bug.

**Design principles.**

**Public-only in the anchor.** Only `commissaire/producer/pk.json` (fields `pk`, `pk_fingerprint`) may be copied into an anchor. `commissaire/governor/governor.json` holds `sk` and `master_secret` (commissaire.js ~line 377) and must never be committed. The copy targets one explicit nested file, never a directory sweep, so the governor dir is structurally out of reach.

**One byte-copy core, never forked.** The copy belongs in `mintIssueAnchor` (events.js ~line 1319), the single shared core both `faff events anchor` (per-PR) and `faff events anchor-run` (git-only) call. Adding it there gives both anchor paths the key for free. This is the FAFF-796 "single byte-copy core, never forked" rule.

**Best-effort-present, like the other floor files.** The `pk.json` copy mirrors the FAFF-623 optional-floor-file pattern (events.js ~lines 1365-1371): copy iff the source exists; its absence is a normal ungoverned-run state, never an anchor-command error. An ungoverned run carries no `pk.json` and no schema:3 records, so nothing is copied and the anchor path stays a byte-for-byte no-op.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` (`mintIssueAnchor`, ~1319) | JavaScript (Node) | The single shared anchor byte-copy core; the copy is added here |
| `plugin/skills/faff/bin/lib/governance-check.js` (`evaluateIntegrityLeg`/`evaluateAnchorDir`, ~216/262) | JavaScript (Node) | The CI anchor re-verification; consumes the anchored `pk.json` via `verifyAuthLeg`, unchanged |
| `plugin/skills/faff/bin/lib/commissaire.js` (`verifyAuthLeg`, ~195; `pkFileOf`/`producerDirOf`, ~65) | JavaScript (Node) | Resolves the anchor-local nested `pk.json`; the read site the copy satisfies |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`resolveCommissaireDecisionGrant`, ~772) | JavaScript (Node) | The live-path decision leg; NOT on the anchor path, left unchanged |
| `test/commissaire.test.mjs` (`chokepoint-enforcement-pass`, `forged-grant-rejection`, ~72/98) | JavaScript (Node test) | The live-run-dir fixtures the new anchor-path fixture mirrors |

**Scope statement.** This closes the CI half of the FAFF-828 merge chokepoint: the anchor now carries the public key its committed decision is re-verified against, so a governed merge's prevention property is enforced by governance-check, not only by the live merge-gate.

---

## 2. OUT OF SCOPE

- **Any change to `resolveCommissaireDecisionGrant` or the `decision_grant` floor field.** Why excluded: the anchor / CI path re-verifies the decision through `verifyAuthLeg`, not through `resolveCommissaireDecisionGrant`, which only ever runs against the live run dir (already carrying `pk.json`). Extension point: if a future ticket adds a live-path merge-gate invocation whose `runDir` is a committed anchor, it would read the same nested `commissaire/producer/pk.json` this ticket now writes, so no code change would be needed there either.
- **External pinning of the anchored public key (a fingerprint root outside the anchor).** Why excluded: the minimal change trusts the committed anchor as the root, consistent with the existing "the trust root is the committed anchor" principle (see `test/merge-gate-controlflow.test.mjs` ~line 434). Whether that self-certifying property is sufficient is raised as an open question below. Extension point: `verifyAuthLeg`'s anchor branch (commissaire.js ~line 205) plus a repo-level governance config (for example a `pk_fingerprint` in `.faffrc.yaml` read independently by CI) would cross-check the anchored key against an out-of-anchor root.
- **Copying any governor / secret material.** Why excluded: it would leak `sk` / `master_secret` into git; it is a security prohibition, not a deferral. Extension point: none by design.
- **Changing what governance-check's merge_floor leg checks.** Why excluded: the decision re-verification already lives in the integrity leg's auth sub-leg; adding a decision leg to merge_floor would duplicate it. Extension point: `evaluateMergeFloorLeg` (governance-check.js ~134) if the floor model is ever restructured.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Anchor | A git-committed, frozen snapshot of a run's evidence dir, re-verified by governance-check in CI. Minted by `mintIssueAnchor`. |
| Auth leg | The schema:3 re-authentication inside `evaluateIntegrityLeg`: `verifyAuthLeg` re-verifies each committed Commissaire decision under the public key and each producer claim under the master-derived key. |
| Producer pk.json | The public Commissaire key file at `runDir/commissaire/producer/pk.json`, fields `{ pk, pk_fingerprint }` only. Written by `commissaire admit` (commissaire.js ~385). Public, safe to commit. |
| Governor file | `runDir/commissaire/governor/governor.json`, fields include `sk` and `master_secret`. Secret, never committed. |
| Self-certifying anchor | An anchor that carries both the committed decision and the public key that validates it, trusting the git commit as the root (no out-of-anchor key pin). |

**The public key file shape (confirm before copying).**

```
RECORD ProducerPkJson:               # commissaire/producer/pk.json
  pk: Base64OrHexString              # the public Ed25519 key
  pk_fingerprint: HexString          # SHA-256 fingerprint of pk
  CONSTRAINT no field named sk
  CONSTRAINT no field named master_secret
```

The build agent MUST confirm the on-disk `pk.json` contains only public material before the copy path trusts it (belt-and-braces; the writer at commissaire.js ~385 already emits exactly `{ pk, pk_fingerprint }`).

**The copy site (unchanged signature).**

```
FUNCTION mintIssueAnchor(runDir, issue, destDir) -> { ok, head, copiedFloorFiles, effectsAnchored }
  # events.js ~1319. Byte-copies events.jsonl (required) + run-ledger.json
  # + declared-effects.jsonl/witness + optional floor files, FLAT into destDir.
  # NEW: additionally byte-copy commissaire/producer/pk.json into destDir,
  #      PRESERVING the commissaire/producer/ nesting, best-effort-present.
```

**The read site (unchanged).**

```
FUNCTION verifyAuthLeg(runDir, governorDir?, producerDir?)   # commissaire.js ~195
  gov   = readJson(governorFileOf(governorDirOf(runDir)))     # anchor: null
  pkRec = readJson(pkFileOf(producerDirOf(runDir)))           # anchor: dir/commissaire/producer/pk.json
  pk    = gov ? gov.pk : (pkRec ? pkRec.pk : null)
  # each schema:3 commissaire record: fail-closed unless verifyDecision(record, pk)
```

`producerDirOf(dir)` = `dir/commissaire/producer`; `pkFileOf(producerDir)` = `producerDir/pk.json`. On the anchor `dir` is `destDir`, so the read resolves `destDir/commissaire/producer/pk.json` — the nested path the copy must write.

**Design decision (destination layout).** Copy `pk.json` preserving the `commissaire/producer/` nesting under `destDir` (so `verifyAuthLeg` and, incidentally, the live-path `resolveCommissaireDecisionGrant` both find it with zero read-site change), versus copying it flat to `destDir/pk.json` and teaching a reader to fall back to the flat path. **Chosen:** nested copy to `destDir/commissaire/producer/pk.json` — the anchor re-verifier (`verifyAuthLeg`) reads exactly `pkFileOf(producerDirOf(dir))`, i.e. the nested path, so nesting satisfies it with no reader change, keeps the change to a single file, and also happens to satisfy the identical nested read in `resolveCommissaireDecisionGrant`. The flat option would require a reader change on a path (`resolveCommissaireDecisionGrant`) that does not even run in CI, which is why scope item 2 leaned the wrong way.

**Design decision (governance detection signal).** Detect "schema:3 governance context present" for the copy via the existence of the source `pk.json` itself, versus parsing the ledger for a schema:3 record inside the copy core. **Chosen:** existence of `runDir/commissaire/producer/pk.json`, best-effort-present, exactly like the other optional floor files (events.js ~1368). A governed run always writes `pk.json` at admit time; the copy core stays a pure filesystem operation with no ledger parse, and an ungoverned run (no file) copies nothing.

---

## 4. HOW — Behavior

**Approach.** Add one best-effort-present copy inside `mintIssueAnchor`, after the optional-floor-file loop, that reproduces the `commissaire/producer/` path under `destDir`. Nothing else changes: `verifyAuthLeg` already reads the nested path, `evaluateIntegrityLeg` already invokes the auth leg on the anchor, and the live merge-gate path is untouched.

**Behavior summary.** After this change, minting a governed run's anchor writes the public key alongside the committed decision, so CI's `verifyAuthLeg` verifies the decision and passes; an ungoverned run writes no key and CI stays a no-op; a forged decision still fails because the anchored public key does not verify a producer-forged (non-Ed25519) signature.

**The copy, in `mintIssueAnchor` (added after the optionalFloorFiles loop, events.js ~1371):**

```
PROCEDURE copy_public_pk(runDir, destDir):
  1. src = runDir/commissaire/producer/pk.json
  2. IF NOT exists(src):
       RETURN                              # ungoverned run — no-op, mirrors optional floor files
  3. rec = parse(read(src))
  4. IF rec has field "sk" OR rec has field "master_secret":
       ABORT the copy for this file with a fail-loud error   # refuse to commit secret material
  5. destProducerDir = destDir/commissaire/producer
  6. mkdir -p destProducerDir
  7. byte-copy src -> destProducerDir/pk.json               # verbatim bytes, nested layout
  8. record "commissaire/producer/pk.json" in the returned copied-files list (for the command summary)
```

Notes for the build agent:

- Use a verbatim byte copy (`fs.copyFileSync` or read-buffer-then-write), consistent with the other copies in this core. The parse in step 3 is only for the step-4 safety assertion; do not re-serialize the file.
- Step 4 is a guard, not the normal path: the writer already emits public-only fields. Keep it, so a future writer regression cannot leak secrets into a committed anchor.
- The governor dir (`commissaire/governor/`) is never referenced by this procedure, so it can never be swept in.

**The CI re-verification (no change; this is the consumer that now succeeds).**

```
PROCEDURE anchor_reverify(destDir, level):        # governance-check.js evaluateAnchorDir
  1. integrity = evaluateIntegrityLeg(destDir, ..., { requireWitness: true })
     a. verify events chain + declared-effects chain against committed witnesses
     b. IF hasGovernanceContext(destDir):          # schema:3 records present in declared-effects.jsonl
          auth = verifyAuthLeg(destDir)             # reads destDir/commissaire/producer/pk.json (now present)
          IF NOT auth.pass: integrity = { pass: false, status: "auth-failed" }
  2. merge_floor = evaluateMergeFloorLeg(destDir, ".", level)   # ac/review/holdout, unchanged
  3. pass = integrity.pass AND merge_floor.pass
```

**Edge cases and error handling.**

- **Ungoverned run (no `pk.json`, no schema:3 records):** copy is skipped (best-effort-present); `hasGovernanceContext` is false; the auth leg does not run. Byte-for-byte unchanged from today.
- **Governed run, key present:** copied to the nested path; `verifyAuthLeg` verifies the committed decision under it; auth leg passes.
- **`pk.json` present but unreadable/malformed at mint:** step 3 parse fails. Precedence: treat a parse failure the same as a secret-material abort — fail loud rather than committing an unverifiable key (fail-closed at mint is safer than a broken anchor that fails-closed later in CI). Do not silently skip a present-but-broken key, because that would mint a governed anchor with no key and reintroduce the exact `auth-failed` this ticket fixes, only later and less legibly.
- **`pk.json` present but contains secret fields:** step 4 aborts the copy fail-loud. This can only happen via a writer regression; the guard converts a silent secret leak into a loud mint failure.

**Anti-pattern:** Copying the whole `commissaire/` subtree into the anchor. Why: it would sweep in `governor/governor.json` (`sk` + `master_secret`) and commit secrets. Copy the one explicit public file only.

**Anti-pattern:** Teaching `resolveCommissaireDecisionGrant` a flat anchor-path fallback. Why: that function never runs against a committed anchor in CI; the change would be dead on the anchor path and the flat layout would not satisfy `verifyAuthLeg`, which is the leg that actually runs.

**Failure modes.**

- **The failure:** the anchor is self-certifying. It carries both the committed decision and the public key that validates it, with no key pin outside the anchor (the governor, the live external root, is deliberately never committed). An actor who can rewrite the committed anchor wholesale (key file plus the witnessed decision plus its recomputed chain witness) could present an internally-consistent forged grant that `verifyAuthLeg` accepts.
  - **How you'd know:** a governance-check pass over an anchor whose `pk_fingerprint` does not match the run's genuine governor fingerprint, with no independent fingerprint source for CI to catch it. There is no signal today because there is no out-of-anchor root to compare against.
  - **What it means:** proceed with the minimal change, because this residual is bounded by the existing "the committed anchor is the trust root" principle (an actor who can rewrite committed anchor bytes and push past branch protection has already defeated CI, independent of this key), and because the change still preserves the FAFF-828 property that a *producer* cannot forge a Commissaire decision (a producer holds only the symmetric `K_producer`, never the Ed25519 secret, so a producer-forged record fails `verifyDecision` under the anchored public key). Whether to additionally pin the anchored key to an out-of-anchor fingerprint root is the open question below; it is a hardening, not a blocker on the CI path this ticket unblocks.

---

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governed run (admit -> declare -> request-decision granting a merge to `main`)
  whose committed anchor is minted by `faff events anchor`
When governance-check re-verifies that anchor dir (the CI path)
Then it PERMITS: exit 0, legs.integrity.pass is true, and the anchor contains
     commissaire/producer/pk.json carrying only { pk, pk_fingerprint }
```

- The anchor of an ungoverned run (no `pk.json`, no schema:3 records) MUST be byte-for-byte unchanged: no `commissaire/` dir is written, `hasGovernanceContext` is false, and governance-check PERMITS exactly as today.

---

## 6. Design Decision Rationale

**Where does the anchor / CI path re-verify the Commissaire decision?**
- Options: (a) `resolveCommissaireDecisionGrant` / the `decision_grant` floor field, as the ticket states; (b) `verifyAuthLeg` inside `evaluateIntegrityLeg`.
- Evidence: `evaluateAnchorDir` runs `evaluateIntegrityLeg` (which calls `verifyAuthLeg` when `hasGovernanceContext`) and `evaluateMergeFloorLeg` (ac/review/holdout only, no `decision_grant`). `resolveCommissaireDecisionGrant` is called only from the live merge-gate paths.
- **Chosen:** (b) `verifyAuthLeg` is the failing leg. This relocates the fix from merge-gate.js to the anchor's key availability and voids the ticket's scope item 2 as written.

**Nested vs flat copy destination.**
- Nested (`destDir/commissaire/producer/pk.json`): satisfies `verifyAuthLeg`'s exact read path with no reader change; also satisfies the live-path read. Con: one extra dir level in the anchor.
- Flat (`destDir/pk.json` + reader fallback): matches the other floor files' flat layout, but requires a reader change on a path that does not run in CI and does not satisfy `verifyAuthLeg`.
- **Chosen:** nested — it is the only layout the CI re-verifier reads, and it needs zero reader edits.

**Detection signal for the copy.**
- Source-file existence (best-effort-present) vs ledger parse for a schema:3 record.
- **Chosen:** source-file existence — mirrors the FAFF-623 optional-floor-file pattern, keeps the copy core parse-free (aside from the secret-material guard), and is naturally a no-op for ungoverned runs.

**Copy locus.**
- `mintIssueAnchor` (shared core) vs the per-command call sites.
- **Chosen:** `mintIssueAnchor` — the FAFF-796 single-byte-copy-core rule; both `faff events anchor` and `faff events anchor-run` inherit the key with one edit.

**What to copy.**
- The one public file vs the `commissaire/` subtree.
- **Chosen:** only `commissaire/producer/pk.json`, with a secret-field guard — copying the subtree would commit the governor secret. At the time of writing, `pk.json` is written as exactly `{ pk, pk_fingerprint }` (commissaire.js ~385); the guard defends against a future writer regression.

**Do we change `resolveCommissaireDecisionGrant`?**
- **Chosen:** no. It does not run against a committed anchor; the nested copy incidentally satisfies its identical read anyway, so the ticket's scope item 2 requires no code.

---

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** self-certifying anchor vs external fingerprint pin — needs human (decides: security). Is a self-certifying anchor (public key committed beside the decision it validates, no out-of-anchor fingerprint pin) sufficient for the chokepoint's prevention property, or must CI cross-check the anchored `pk_fingerprint` against a root committed outside the anchor (for example in `.faffrc.yaml`, branch-protection-controlled)? Context: the governor (the live external root) is deliberately never anchored, so the anchor path has no external key pin today; the residual is bounded by the existing committed-anchor-as-trust-root model and does not block the CI path this ticket unblocks, but it is a genuine security-model call on a security boundary. This is non-blocking for the minimal change.

**Assumptions.**

- **Assumes:** `commissaire admit` writes `commissaire/producer/pk.json` as public-only `{ pk, pk_fingerprint }`. Validate: read commissaire.js ~385 and confirm no `sk` / `master_secret` is written to `pkFileOf`; the step-4 guard enforces this at mint regardless.
- **Assumes:** `verifyAuthLeg` on a committed anchor resolves the key from `pkFileOf(producerDirOf(dir))` (the nested producer path) because `governor.json` is absent. Validate: read commissaire.js ~195-226 and confirm the `gov ? gov.pk : pkRec.pk` fallback and the nested `producerDirOf`/`pkFileOf` composition.
- **Assumes:** schema:3 `effect-decision-verdict` records live in `declared-effects.jsonl`, which `mintIssueAnchor` already byte-copies, so `hasGovernanceContext(anchorDir)` is true and the auth leg runs. Validate: read commissaire.js ~62/72 (`LEDGER_CFG` / `readLedgerEntries`) and events.js ~1346 (effects byte-copy).

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A governed run's committed anchor, re-verified by governance-check in CI, PERMITS on a genuine grant instead of failing `auth-failed` (the FAFF-828 prevention property now holds on the anchor path).
- [ ] The spec's mechanism correction is honored: no change is made to `resolveCommissaireDecisionGrant` or the `decision_grant` floor field.

### From WHAT (types and interfaces)
- [ ] The anchor contains `commissaire/producer/pk.json` carrying exactly `{ pk, pk_fingerprint }` (no `sk`, no `master_secret`).
- [ ] The copy is added inside `mintIssueAnchor` (the single shared core), so both `faff events anchor` and `faff events anchor-run` produce it.
- [ ] `pk.json` is copied preserving the `commissaire/producer/` nesting under the anchor dir.

### From HOW (behavior)
- [ ] Copy is best-effort-present: a governed run copies the key; an ungoverned run (no source `pk.json`) copies nothing and the anchor is byte-for-byte unchanged.
- [ ] The copy refuses fail-loud if the source `pk.json` contains an `sk` or `master_secret` field, or is unreadable/malformed.
- [ ] The anchor never contains `commissaire/governor/governor.json`.
- [ ] `faff events anchor`'s command summary lists `commissaire/producer/pk.json` among the copied files when it is present.

### From HOW (edge cases)
- [ ] Malformed/unreadable source `pk.json` fails the mint loud rather than minting a governed anchor with no key.

### From SCENARIOS
- [ ] Fixture: a genuine governed grant verified from a committed anchor PERMITS (governance-check exit 0, `legs.integrity.pass` true) — the anchor-path analogue of `chokepoint-enforcement-pass`.
- [ ] Fixture (holdout): a forged (producer-HMAC, non-Ed25519) grant verified from a committed anchor REFUSES (non-zero exit, `legs.integrity.status` `auth-failed`) — the anchor-path analogue of `forged-grant-rejection`.
- [ ] Fixture: an ungoverned run's anchor still PERMITS with no `commissaire/` dir written.
- [ ] Fixture (holdout): the minted anchor contains no governor file and no `sk` / `master_secret` in any file.

### Integration smoke test

```
PROCEDURE smoke(tmp):
  1. runDir = fresh run dir
  2. commissaire admit  --run-dir runDir --producer P1 --contract-revision r1 --scope merge
  3. commissaire declare --run-dir runDir --producer P1 --issue FAFF-1 --step merge   # {kind:merge,target:main}
  4. commissaire request-decision --run-dir runDir --producer P1 --issue FAFF-1 --step merge   # verdict == "grant"
  5. dest = fresh anchor dir
  6. faff events anchor --run-dir runDir --issue FAFF-1 --dest dest
  7. ASSERT exists(dest/commissaire/producer/pk.json) AND NOT exists(dest/commissaire/governor/governor.json)
  8. ASSERT governance-check --anchor-dir dest  -> exit 0            # PERMIT (plumbing connected)
  9. tamper: replace dest/declared-effects.jsonl verdict with a producer-HMAC forged grant (+ recompute its witness)
 10. ASSERT governance-check --anchor-dir dest  -> non-zero, integrity.status == "auth-failed"   # REFUSE
```

---

confidence: medium
build-tier: complex
