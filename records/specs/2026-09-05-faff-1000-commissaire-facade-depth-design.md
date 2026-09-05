# FAFF-1000: Build the Commissaire facade to depth: verdict conclude + audit seal (drop the faff-bin dependency) + audit export

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1000.

This spec covers `plugin/skills/faff/bin/lib/commissaire.js` and a new sealing-core module beside it. It targets the coding agent that builds this ticket; a human reviewer should be able to follow the WHY and the design-decision rationale without reading the code first.

**Dependency.** FAFF-999 (the standalone `commissaire` binary at `plugin/skills/faff/bin/commissaire`, and its import-independence test `test/commissaire-standalone.test.mjs`) is in review on PR #858, not yet merged. This spec assumes it has landed: the binary exists, `cliPosixGuard`/`runGovernedDispatch` live in `shared-infra.js`, and the independence test's `DENYLIST` / `walk()` machinery is in place. If FAFF-999 lands with material changes to that machinery, re-check this spec's file/line references before building.

## 1. WHY

**The load-bearing fact:** two of `commissaire.js`'s six facade verbs are boundary stubs that `spawnSync` the `faff` bin (`cmdBoundaryStub`, `plugin/skills/faff/bin/lib/commissaire.js` lines 469-476), and the obvious way to remove that spawn, requiring `./bundle` or `./events` in-process, silently reintroduces the exact dependency FAFF-999 just proved absent. `bundle.js` requires `./config` (line 25) and `./contract-defs` (line 29); `config.js` requires `./backends`, which requires `./harness` (`backends.js` line 300); `contract-defs.js` requires `./run-done` and `./run-start` (lines 20-21). `harness`, `run-done`, and `run-start` are three of the eleven names in `test/commissaire-standalone.test.mjs`'s `DENYLIST`. Requiring `bundle.js` (or anything that requires `config.js` or `contract-defs.js`) from `commissaire.js` would make the standalone binary's require graph reach all three and fail FAFF-999's own independence test. This is verified by tracing the requires directly (see the Reference context table), not inferred.

The fix is not "don't use `bundle.js`'s logic." It is extracting the narrow slice of that logic which has no denylisted dependency into its own module, and pointing both `bundle.js` and `commissaire.js` at it.

**Problem.** `verdict conclude` and `audit seal` are boundary stubs (`cmdTerminalVerdict`, `cmdSealBundle`) that shell out to `faff events anchor` / `faff bundle publish`, which defeats the point of FAFF-999's standalone binary: a caller who only has `commissaire` on `PATH` still needs a working `faff` bin beside it for these two verbs to do anything. `audit export` is not wired in at all. This ticket gives both verbs real in-process depth and wires up `audit export`, without reintroducing the spawn or the require-graph dependency FAFF-999 removed.

**Design principles.**

- **A record only Commissaire may issue.** Per the V5 master doc: "Only Commissaire may issue `accepted_under_contract` for a work item under a named contract revision" (`docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md` line 148). `verdict conclude` must emit this as a signed schema:3 ledger record, not a side-channel exit code.
- **Extraction, not duplication.** `bundle.js`'s own header says integrity/chain logic is "REUSES ... verbatim, never forked." The same rule applies here: the sealing core moves to a shared module both `bundle.js` and `commissaire.js` require, rather than being copy-pasted into `commissaire.js`.
- **The independence guard is the spec for what "in-process" is allowed to touch.** Every new `require` this ticket adds to `commissaire.js`'s transitive graph must resolve to a file already proven clean by FAFF-999's `walk()`, or a new file whose own requires are traced against `DENYLIST` before it's trusted.

**Reference context**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript (CommonJS) | The facade being extended: `cmdTerminalVerdict`, `cmdSealBundle`, `COMMISSAIRE_DISPATCH`, `REQUIRED_FLAGS_BY_CANONICAL` |
| `plugin/skills/faff/bin/lib/bundle.js` | JavaScript | Owns today's `buildBundle`/`publishBundle`/`localBundleStore`, the logic being extracted |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | 3389-line module; requires `./run-done` and `./run-start` (denylisted). Must never be required by `commissaire.js` |
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | Requires `./backends`, which requires `./harness` (denylisted). Must never be required by `commissaire.js` |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | `computeEscapes`, already used by `cmdReconcile`; reused for `verdict conclude`'s precondition |
| `test/commissaire-standalone.test.mjs` | JavaScript (node:test) | FAFF-999's `DENYLIST`, `walk()`, and the byte-parity fixtures this ticket must not break |
| `test/commissaire.test.mjs` | JavaScript (node:test) | The FAFF-828/977/978/980 fixtures that must stay green |

**Scope statement.** This is a depth pass over two of `commissaire.js`'s six facade verbs (verdict, audit) plus wiring the seventh action (`audit export`); it does not touch `contract admit`, `effect declare/authorize/observe/reconcile`, or `audit verify`, all of which are already built to depth or (per ADR-0122) deliberately out of Phase 2A's scope.

## 2. OUT OF SCOPE

- **The `git-remote` bundle-store occupant becoming config-driven for `commissaire`.** `faff bundle publish` picks the occupant from the `.faffrc.yaml` `bundle_store` key via `config.js`, which this ticket cannot require. `commissaire audit seal`/`export` take an explicit `--bundle-store` flag instead (see WHAT). Reading `.faffrc.yaml` through a config-independent lens is a future ticket. **Extension point:** a new `commissaire-config.js` (or similar) that reads only the `bundle_store` key without pulling in `backends.js`/`harness.js`.
- **The full MASTER-doc terminal-safety ladder** ("complete causal lineage", "a current verdict at the expected work-item stream revision", "an evidence seal over every relied-on record and artifact digest", the last of which is verb 6's job, not verb 5's). This ticket implements the three preconditions the issue names (producer admitted, no unreconciled escapes, evidence present) as a first depth pass, matching ADR-0122's phased-cutover posture. **Extension point:** `evaluateTerminalVerdict` (WHAT, below); additional legs are added there.
- **A negative `outcome_rejected` ledger record.** The master doc names it as a sibling verdict; `KIND_AUTHOR` (`commissaire.js` lines 47-55) does not yet define it, and this ticket's `verdict conclude` returns a refusal without writing to the ledger (see HOW). **Extension point:** add an `outcome_rejected` entry to `KIND_AUTHOR` and persist refusals once a consumer needs the durable record.
- **`issue-merge-floor` bundles from `commissaire audit seal`.** The current stub only ever seals `run-close`, and this ticket keeps that scope; `readAnchorDir`'s `issue-merge-floor` path is untouched. **Extension point:** a `--boundary-kind` flag on `audit seal`/`export`, once a caller needs per-issue bundles from the facade rather than the run-close bundle.

## 3. WHAT

**Vocabulary**

| Term | Definition |
|---|---|
| Sealing core | The extracted, denylist-clean subset of `bundle.js`'s logic: `buildBundle`, `localBundleStore`, `requiredMembersFor`, `validateIdentityForHandle`, and the contract-schema-version enumeration |
| Boundary stub | `cmdBoundaryStub` (`commissaire.js` line 469), spawns the `faff` bin as a child process. Removed from the verdict/seal paths by this ticket; the function itself is deleted (its only other caller was these two verbs) |
| Escape | `computeEscapes`'s term for an observed effect with no matching declared effect for the same `(issue, step)`, an undischarged obligation |

**New module: `plugin/skills/faff/bin/lib/bundle-seal-core.js`.**

Moved out of `bundle.js`, verbatim except for the one change named below: `buildBundle`, `readAnchorDir`, `canonicalJSON`, `validIdentityToken`, `validateIdentityForHandle`, `requiredMembersFor`, `REQUIRED_MEMBERS_B1`/`_B2`, `BUNDLE_MANIFEST_VERSION`, `BUNDLE_BOUNDARY_KINDS`, `localBundleStore` (and its private helpers `localBundleSegDir`/`localBundleDir`/`localExistingBundleResult`).

Its own requires: `node:fs`, `node:path`, `./shared-infra` (`dig`, `findRoot`, `HERE`, `isSafeAnchorRelPath`), `./integrity-digest` (`buildManifest`, `sha256`), `./redact` (`resolveKnownSecretValues`). Traced transitively: `integrity-digest.js` requires `corrective-integrity.js` which requires `container-check.js` and `argv.js` (a leaf); `redact.js` requires `shared-infra.js` and `budget.js`, and `budget.js` requires `shared-infra.js` and `heartbeat.js`, which requires `shared-infra.js` and `fs-lock.js`. None of these files require `config.js`, `contract-defs.js`, `backends.js`, `harness.js`, or any other `DENYLIST` name, verified by direct inspection of every file in this chain (recorded here so the build agent doesn't have to re-derive it).

The one substantive change while moving `buildBundle`: the `contract_schema_versions` computation's `Object.keys(CONTRACTS)` (`bundle.js` line 215, `CONTRACTS` from `contract-defs.js`) is replaced with a directory read of `contracts/*.schema.json` basenames off `path.resolve(HERE, "..", "contracts")` (rationale and verification in section 6).

`bundle.js` is refactored to `require("./bundle-seal-core")` for the moved functions rather than keeping its own copies, one implementation, matching the file's own "never forked" convention. `bundle.js` keeps its own `contract-defs.js` require for `computeBundleVerdict` (used only by `bundle verify`, untouched by this ticket) and its own `config.js` require for `resolveBundleStoreName`/`resolveBundleStore` (used only by `faff bundle`'s CLI, which may still honour `.faffrc.yaml`'s `bundle_store` key; that path is unaffected by this ticket).

**`commissaire.js`'s new requires:** `./bundle-seal-core` (for `audit seal`/`export`); `./events`'s already-imported `appendRecordsUnderLock`/`verifyEffectsChain` stay as-is (no new events.js exports needed). No new require touches `config.js`, `contract-defs.js`, or anything transitively reaching `DENYLIST`.

**RECORD `accepted_under_contract` body** (the schema:3 envelope's `body` argument to `appendCommissaireRecord`; wraps into the existing envelope shape `buildEnvelope` already produces):

```
RECORD AcceptedUnderContractBody:
  kind_of_entry: "accepted_under_contract"   # already in KIND_AUTHOR as commissaire-authored
  issue: String
  step: "conclude"
  payload:
    producer_id: String                      # the single producer whose contract this concludes
    contract_revision: String
    evidence_seq_range: [Integer, Integer]    # min/max seq among this issue's ledger entries
    escapes_checked: true
```

**ENUM `VerdictRefusalReason`** (returned, never persisted, see HOW):

```
ENUM VerdictRefusalReason:
  no-evidence          # zero ledger entries exist for this issue, or none from an explicitly-named --producer
  producer-not-admitted   # a producer that touched this issue is missing or revoked
  ambiguous-producer      # more than one distinct producer touched this issue and --producer was not given
  unreconciled-escape     # computeEscapes reports any_escape for this issue
  no-governor             # no governor material at --governor-dir (admit was never run)
```

**New CLI surface (all in `commissaire.js`):**

| Change | Detail |
|---|---|
| `cmdTerminalVerdict` | Rewritten to the in-process precondition + `appendCommissaireRecord` flow (HOW). Same `--run-dir`/`--issue` required flags; `--producer`, `--governor-dir`, `--producer-dir`, `--ts` stay optional (already declared in `COMMISSAIRE_SPEC.flags`) |
| `cmdSealBundle` | Rewritten to call `bundle-seal-core.js`'s `buildBundle` + `localBundleStore` (or the git-remote store, resolved from `--bundle-store`, never from config) directly, in-process |
| `cmdAuditExport` (new) | Reads the already-sealed bundle from the store and copies its manifest + members to `--dest` |
| `COMMISSAIRE_DISPATCH["audit export"]` | New entry: `(flags) => cmdAuditExport(flags)` |
| `REQUIRED_FLAGS_BY_CANONICAL["audit export"]` | `["--dest"]` |
| `COMMISSAIRE_SPEC.flags` | Add `--root` (arity 1), `--dest` (arity 1), `--bundle-store` (arity 1) |
| `parseCommissaireArgs`'s `single` Set | Add `"--root"`, `"--dest"`, `"--bundle-store"` (currently missing, so these flags are silently dropped without this) |
| `cmdBoundaryStub`, `spawnSync` import for it | Deleted, its only two callers (`cmdTerminalVerdict`, `cmdSealBundle`) no longer call it. `spawnSync`/`ENTRYPOINT` stay imported: `commissaireSelftest()` (line ~660) still legitimately spawns the `faff` bin to round-trip-test the *other* verbs (`admit`/`declare`/`authorize`/`reconcile`) end to end; that use is unrelated to this ticket and out of scope to remove |

`audit seal`/`export` take an optional `--bundle-store local|git-remote` flag, default `local`, instead of resolving `.faffrc.yaml`'s `bundle_store` key (rationale in section 6).

`verdict conclude`'s preconditions are narrowed to exactly the three the issue names: producer admission, no unreconciled escapes, evidence present (rationale in section 6).

## 4. HOW

### `verdict conclude`

**Summary:** validate the run dir and governor exist, resolve which producer's contract this concludes, check three preconditions against the existing ledger, and, only if all three pass, append one signed `accepted_under_contract` record. A failed precondition is reported, not silently dropped, but is never written to the ledger (Out of scope: negative record).

```
PROCEDURE conclude_verdict(runDir, issue, flags):
  1. requireRunDir(flags, "verdict conclude"), unchanged from today; missing dir -> exit 3
  2. entries := readLedgerEntries(runDir).filter(e -> e.issue == issue)
  3. IF entries is empty -> return refusal("no-evidence")
  4. existing := entries.find(e -> e.kind_of_entry == "accepted_under_contract")
     IF existing exists -> print { verdict: "accepted_under_contract", issue, idempotent: true, seq: existing.seq }; exit 0
       # idempotent re-conclude, rationale in section 6.
  5. producerIds := distinct(entries.map(e -> e.producer_id))
     IF flags["--producer"] given:
       IF flags["--producer"] not in producerIds -> return refusal("no-evidence")
       producerId := flags["--producer"]
     ELSE IF producerIds.length == 1: producerId := producerIds[0]
     ELSE: return refusal("ambiguous-producer")
  6. admission := readJson(producerFileOf(producerDirOf(runDir, flags["--producer-dir"]), producerId))
     IF !admission OR admission.status == "revoked" -> return refusal("producer-not-admitted")
  7. escapeResult := computeEscapes(entries, issue)
     IF escapeResult.any_escape -> return refusal("unreconciled-escape", { escapes: escapeResult.escapes })
  8. gov := readJson(governorFileOf(governorDirOf(runDir, flags["--governor-dir"])))
     IF !gov -> return refusal("no-governor")   # exit 2, a setup error, not a governed refusal
  9. seqs := entries.map(e -> e.seq); range := [min(seqs), max(seqs)]
  10. body := AcceptedUnderContractBody{ issue, step: "conclude",
        payload: { producer_id: producerId, contract_revision: admission.contract_revision,
                   evidence_seq_range: range, escapes_checked: true } }
  11. record := appendCommissaireRecord(runDir, gov.sk, producerId, admission.contract_revision, body, flags["--ts"])
  12. print { verdict: "accepted_under_contract", issue, producer_id: producerId, seq: record.seq }; exit 0
```

A refusal (steps 3, 5, 6, 7) is printed as `{ verdict: "refused", reason, issue, ...detail }` and exits **0**, a completed evaluation that concluded "not yet," mirroring `evaluateDecisionRequest`'s own grant/deny-is-not-an-error convention (`cmdRequestDecision` always exits 0 on a completed decision). Step 8's `no-governor` is a setup error (admit was never run) and exits **2**, matching `cmdRequestDecision`'s own `no governor material` check.

**Anti-pattern:** re-deriving the producer set from `admitted_scope` or re-running `evaluateDecisionRequest`. Both already ran at `effect authorize` time; `verdict conclude` reads their *outcome* off the ledger (who touched this issue, whether an escape was ever recorded), it does not re-adjudicate individual effect requests.

### `audit seal` (in-process)

**Summary:** build the run-close bundle from the run dir's own ledger/anchor bytes and write it to the chosen store, the same bytes `faff bundle publish --boundary-kind run-close` would produce, computed without spawning it.

```
PROCEDURE seal_bundle(runDir, flags):
  1. requireRunDir(flags, "audit seal") -> exit 3 if missing (unchanged contract)
  2. root := flags["--root"] or findRoot()
  3. store := flags["--bundle-store"] == "git-remote" ? gitRemoteBundleStore(root) : localBundleStore(root)
  4. run_id := basename(runDir)
  5. built := buildBundle(runDir, { run_id, boundary_kind: "run-close", boundary_key: "run-close" }, root)
     # boundary_key is the LITERAL constant "run-close", never basename(runDir); see the bug note below
  6. seq := nextBoundarySeq(store, run_id, built.manifest.identity.run_segment_id, "run-close")
     rebuild with the real boundary_seq if seq != 0 (mirrors publishBundle's own probe-then-build shape)
  7. result := store.put(manifest.identity, memberBytes, manifest)
  8. print { sealed: result.ok, idempotent: !!result.idempotent, identity: manifest.identity,
             bundle_manifest_digest: manifest.bundle_manifest_digest }
  9. exit 0 on ok (including store_unavailable, which never fails the run, same rule as `bundle publish`), 1 on a genuine failure
```

**Failure mode found during exploration, not introduced by this ticket:** today's stub calls `faff bundle publish --boundary-kind run-close --boundary-key $(basename runDir)`. `buildBundle`'s own validation requires `boundary_key === "run-close"` whenever `boundary_kind === "run-close"`; a run dir's basename is never literally `"run-close"`, so this call always throws `invalid identity component(s): boundary_kind "run-close" requires boundary_key === "run-close"` and `commissaire audit seal` has never successfully sealed a bundle. Reproduced directly against `bundle.js`'s `publishBundle` in isolation. No test caught this because `test/commissaire.test.mjs`'s only `seal-bundle` fixture (line 540) exercises the *missing-run-dir* failure path, never a real seal. This ticket's DONE/Scenarios require a fixture that actually seals successfully, which step 5 above fixes by using the literal constant.

### `audit export`

**Summary:** copy an already-sealed bundle's manifest and member bytes to a destination directory, no re-sealing, no re-deriving anything from the run dir.

```
PROCEDURE export_bundle(flags):
  1. requireRunDir(flags, "audit export") -> exit 3 if missing
  2. dest := flags["--dest"]; IF !dest -> usage error, exit 2
  3. root := flags["--root"] or findRoot(); store selection same as seal_bundle
  4. identity := { run_id: basename(runDir), boundary_kind: "run-close", boundary_key: "run-close",
                    run_segment_id: <resolved from the ledger, same read buildBundle does> }
  5. head := store.headDigest(identity)
     IF head.status != "ok" -> print { exported: false, reason: "not-sealed" }; exit 1
        # audit seal must run first; export never seals implicitly
  6. mkdir(dest); write dest/manifest.json from head's manifest
  7. FOR name IN requiredMembersFor(head.version):
       member := store.member(identity, name); write dest/<name>.bin
  8. print { exported: true, dest, identity: head.identity, bundle_manifest_digest: head.digest }; exit 0
```

**Edge case:** `--dest` already exists and is non-empty. Refuse rather than silently merge/overwrite (`{ exported: false, reason: "dest-not-empty" }`, exit 1); an export is meant to be a clean, verifiable copy, and a partial prior export left on disk must not silently blend with a new one.

### Independence-test extension (FAFF-999's static guard, plus this ticket's runtime one)

FAFF-999's `walk()` over `[COMMISSAIRE, join(LIB, "commissaire.js")]` already re-runs automatically once `commissaire.js` requires `bundle-seal-core.js`; no test *code* change is needed for the static half, since `libSourceSet()` globs every `.js` file under `bin/lib/` and the walk follows whatever `commissaire.js` actually requires. The static assertion this ticket must pass is: `bundle-seal-core.js` (and everything it requires) contains no `DENYLIST` basename.

The **new** assertion is a runtime one: prove neither `verdict conclude` nor `audit seal` calls `spawnSync` naming the `faff` `ENTRYPOINT`, complementing the static "never requires it" check with "never execs it either" (a require-graph guard cannot catch a dynamically-constructed spawn).

```
PROCEDURE runtime_spawn_guard_test():
  1. In a FRESH child node process (spawnSync("node", [harnessScript, ...]), matching the existing
     parity-test style in test/commissaire-standalone.test.mjs), before anything requires
     lib/commissaire.js:
       a. monkeypatch node:child_process's spawnSync to record every (cmd, args) call
       b. THEN require lib/commissaire.js (module cache is fresh in the child process, so the
          patched spawnSync is what commissaire.js's own `const { spawnSync } = require(...)`
          destructures)
  2. Set up a scratch run dir: admit -> declare -> authorize -> observe, so `verdict conclude`
     has evidence to evaluate and `audit seal` has an anchor to bundle. Mint the run-close
     anchor directly (fs writes under runDir/../../anchors/<run_id>/) rather than via
     `faff events anchor-run`; the guard's whole point is testing a path with no faff-bin call.
  3. Call COMMISSAIRE_DISPATCH["verdict conclude"](flags) and COMMISSAIRE_DISPATCH["audit seal"](flags)
     directly (in-process, not through argv)
  4. Assert: zero recorded spawnSync calls whose args include the `faff` ENTRYPOINT path, for
     either call. (commissaireSelftest's own legitimate faff-bin spawns are never exercised by
     this harness, since it calls the dispatch table directly rather than --selftest.)
  5. Report pass/fail via the child process's exit code; the outer test asserts exit 0.
```

**Anti-pattern:** asserting `spawnSync` is never called anywhere in `commissaire.js` at all. `commissaireSelftest()` (unrelated to this ticket) legitimately spawns the `faff` bin to round-trip-test `admit`/`declare`/`authorize`/`reconcile`; a blanket assertion would break that and would not be testing what this ticket changed.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir with one admitted producer that declared and observed the same effect for an issue (no escape)
When `commissaire verdict conclude --run-dir <dir> --issue <I>` runs
Then it appends one schema:3 `accepted_under_contract` record, author "commissaire", signed under the governor SK, and `faff commissaire audit verify` classifies it "verified"
```

```
Given the same run dir but the producer observed an effect it never declared for that issue
When `verdict conclude` runs for that issue
Then it returns { verdict: "refused", reason: "unreconciled-escape" }, exit 0, and appends nothing to the ledger
```

```
Given `verdict conclude` already succeeded once for an issue
When it is run again for the same issue with no new ledger activity
Then it returns the existing record's seq with idempotent: true, and the ledger gains no second `accepted_under_contract` record
```

```
Given a sealed bundle from the prior scenario
When `commissaire audit export --run-dir <dir> --dest <emptyDir>` runs
Then `<emptyDir>/manifest.json` and one `<emptyDir>/<member>.bin` per required member exist, and each member's sha256 matches the manifest's own `members[<name>].sha256`
```

- No PII in `verdict conclude`/`audit seal`/`export` stdout: every field is a ledger-derived identifier, digest, or fixed status string.

## 6. DESIGN DECISION RATIONALE

**How does `commissaire.js` reuse `bundle.js`'s sealing logic without reintroducing the denylisted require graph?**
- *Option A, require `bundle.js` directly.* Simplest, but pulls in `config.js` (via `backends.js` via `harness.js`) and `contract-defs.js` (via `run-done.js`, `run-start.js`), three `DENYLIST` names, verified by direct trace. Fails FAFF-999's independence test immediately.
- *Option B, copy `buildBundle`/`localBundleStore` into `commissaire.js`.* Avoids the denylist but forks logic `bundle.js`'s own header explicitly says must never be forked; a future fix to `buildBundle` would silently not apply to the copy.
- **Chosen:** extract the denylist-clean subset into `bundle-seal-core.js`, required by both `bundle.js` and `commissaire.js`. One implementation, verified clean transitively (see WHAT's Reference/requires trace).

**How does `contract_schema_versions` avoid `contract-defs.js`'s `CONTRACTS` export?**
- *Option A, keep `Object.keys(CONTRACTS)`.* Requires `contract-defs.js`, denylisted.
- *Option B, hardcode the 26 names as a literal list in the new module.* Avoids the require but silently drifts the moment a new contract schema is added without updating the literal.
- **Chosen:** read `contracts/*.schema.json` basenames directly off disk. Verified today to produce the identical 26-name set `Object.keys(CONTRACTS)` does; stays correct as contracts are added or removed without a second list to maintain.

**How does `audit seal` pick a bundle-store occupant without `config.js`?**
- *Option A, always use the local store.* Simple, but silently ignores an operator's `bundle_store: git-remote` configuration for this one facade path.
- *Option B, an explicit `--bundle-store` flag.* `gitRemoteBundleStore(root)` itself has no `config.js` dependency; only the *selection* logic did.
- **Chosen:** Option B, `--bundle-store local|git-remote`, default `local`. Keeps both occupants reachable from `commissaire` without ever requiring `config.js`.

**How many of the master doc's terminal-safety preconditions does `verdict conclude` enforce?**
- *Option A, the full six-point ladder* (admitted contract revision, complete causal lineage, all mandatory evidence, no unresolved blocking effect, current verdict at the expected stream revision, an evidence seal over every relied-on record). A materially larger undertaking than this ticket's stated acceptance criteria.
- *Option B, the three legs the issue names:* producer admission, no unreconciled escapes, evidence present.
- **Chosen:** Option B. ADR-0122 explicitly phases V5 cutover work; the remaining legs are out of scope (section 2) and land as later depth passes over `evaluateTerminalVerdict`.

**Should a repeat `verdict conclude` call for an already-concluded issue append a second record?**
- *Option A, refuse the repeat call outright.* Forces every caller to first check whether the issue is already concluded, a ceremony `publishBundle`'s own idempotent-no-op pattern deliberately avoids for the equivalent bundle-publish case.
- *Option B, treat it as an idempotent no-op,* returning the existing record.
- **Chosen:** Option B, matching `publishBundle`'s own pattern. A repeat call (for example after a crash mid-run) must not multiply terminal records for one issue.

**Should `verdict conclude` persist a refusal?**
- *Option A, append a negative `outcome_rejected` record (master doc's fuller model).* `KIND_AUTHOR` has no such kind yet, and inventing one is a bigger surface than this ticket's stated scope.
- **Chosen:** a refusal is diagnostic output only, never a ledger write. Punted to a future ticket if a consumer needs the durable negative record.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions**

- **Punt:** should `commissaire` eventually read `.faffrc.yaml`'s `bundle_store` key through a config-independent module, so `--bundle-store` becomes a default-following flag instead of a hardcoded `local` default, or needs-decision (architecture)? Not needed for this ticket; `git-remote` stays reachable via the explicit flag either way.
- **Punt:** should a negative `outcome_rejected` schema:3 record be added to `KIND_AUTHOR` and persisted on refusal, matching the master doc's full lifecycle, needs-decision (architecture)? Out of scope here; a refusal is diagnostic-only for now.

**Assumptions**

- **Assumes:** FAFF-999 has landed as described (the `commissaire` binary, `shared-infra.js`'s `cliPosixGuard`/`runGovernedDispatch`, and `test/commissaire-standalone.test.mjs`'s `DENYLIST`/`walk()`). Validate: `git log --oneline -- plugin/skills/faff/bin/commissaire` shows a merged commit on the target branch's ancestry, and `test/commissaire-standalone.test.mjs` exists and passes before starting this ticket's changes.
- **Assumes:** `CONTRACTS`' key set (`contract-defs.js`) and `contracts/*.schema.json`'s basenames stay in lockstep going forward. Validated now (26/26 identical); re-run the same diff (`Object.keys(CONTRACTS)` vs. `ls contracts/*.schema.json` basenames) if this fails after the extraction; a mismatch would mean `bundle-seal-core.js`'s `contract_schema_versions` silently omits or adds a schema relative to today's `bundle.js` behaviour.
- **Assumes:** a run-close anchor already exists at `.faff/anchors/<run_id>/` before `audit seal` runs, minted by `faff events anchor-run` or equivalent, outside this ticket's scope. This is not a new requirement: `buildBundle` has always thrown `no anchor found` without one, in both the old spawned stub and this ticket's in-process version. It was simply never reachable before, because the old stub's `boundary_key` bug (HOW) always threw first. Validate by confirming the fixture/test setup for `audit seal` mints a run-close anchor before calling it, exactly as the runtime spawn-guard test (HOW) does.

## 8. DONE: Definition of Done

### From WHY
- [ ] `commissaire.js` requires no module that transitively reaches `config.js` or `contract-defs.js` (verified by `test/commissaire-standalone.test.mjs`'s existing `walk()` after `bundle-seal-core.js` is wired in; no test-code change needed for this half)

### From WHAT (types and interfaces)
- [ ] `bundle-seal-core.js` exists, exporting `buildBundle`, `localBundleStore`, `requiredMembersFor`, `validateIdentityForHandle`, `BUNDLE_MANIFEST_VERSION`, `BUNDLE_BOUNDARY_KINDS`; its own requires are `node:fs`, `node:path`, `./shared-infra`, `./integrity-digest`, `./redact` only
- [ ] `bundle.js` requires `bundle-seal-core.js` for the moved functions instead of defining its own copies; `faff bundle publish`/`verify` behaviour is unchanged (existing `bundle.js` fixtures stay green)
- [ ] `contract_schema_versions` is computed from `contracts/*.schema.json` basenames, not `Object.keys(CONTRACTS)`, in the one place it's now computed
- [ ] `COMMISSAIRE_DISPATCH["audit export"]`, `REQUIRED_FLAGS_BY_CANONICAL["audit export"] = ["--dest"]`, and `COMMISSAIRE_SPEC.flags`/`parseCommissaireArgs`'s `single` Set carry `--root`/`--dest`/`--bundle-store`
- [ ] `cmdBoundaryStub` and its now-orphaned call sites are deleted from `commissaire.js`; `spawnSync`/`ENTRYPOINT` remain imported only for `commissaireSelftest`'s unrelated round-trip test

### From HOW (behaviour)
- [ ] `verdict conclude` on a clean covered run appends one schema:3 `accepted_under_contract` record signed under the governor SK, and `commissaire audit verify` classifies it `verified`
- [ ] `verdict conclude` refuses with `reason: "unreconciled-escape"` (exit 0, no ledger write) when `computeEscapes` reports `any_escape` for the issue
- [ ] `verdict conclude` refuses with `reason: "no-evidence"` when the issue has zero ledger entries, and `reason: "ambiguous-producer"` when more than one producer touched the issue and `--producer` was not given
- [ ] A second `verdict conclude` call for an already-concluded issue returns the existing record's seq with `idempotent: true` and appends nothing
- [ ] `audit seal` builds and writes a bundle whose `bundle_manifest_digest` matches a direct `buildBundle` computation over the same run dir, using the literal boundary_key `"run-close"` (not `basename(runDir)`, the reproduced pre-existing bug)
- [ ] `audit export` copies a previously-sealed bundle's manifest and every required member to `--dest`, each member's sha256 matching the manifest, and refuses with `reason: "not-sealed"` if `audit seal` never ran
- [ ] Neither `verdict conclude` nor `audit seal` spawns the `faff` bin (runtime spawn-guard test, HOW)

### From HOW (edge cases)
- [ ] `audit export --dest` pointing at a non-empty existing directory refuses (`reason: "dest-not-empty"`, exit 1) rather than overwriting or merging
- [ ] `audit seal`'s `store_unavailable` disposition still exits 0 and never fails the run, matching `bundle publish`'s existing rule

### From FAFF-999 extension
- [ ] `test/commissaire-standalone.test.mjs`'s independence guard passes with `bundle-seal-core.js` in the walked graph (no `DENYLIST` hit)
- [ ] A new runtime spawn-guard test (HOW) asserts zero `spawnSync` calls naming the faff `ENTRYPOINT` from `verdict conclude` or `audit seal`, run in a fresh child process with `child_process.spawnSync` patched before `lib/commissaire.js` is first required
- [ ] All existing FAFF-828/977/978/980 fixtures in `test/commissaire.test.mjs` and `test/commissaire-standalone.test.mjs` stay green, including the flat/object-verb alias exit-parity fixture at line 540 for `terminal-verdict`/`verdict conclude` and `seal-bundle`/`audit seal`

**Integration smoke test:** `contract admit` then `effect declare` then `effect authorize` (grant) then `effect observe` (matching) then `verdict conclude` (appends `accepted_under_contract`) then `audit seal` (writes a local bundle) then `audit export --dest <dir>` (copies it) then `audit verify` (classifies every record `verified`), one straight-line path through every verb this ticket touches, run through the standalone `commissaire` binary end to end with no `faff` bin on `PATH`.

confidence: high
build-tier: complex
