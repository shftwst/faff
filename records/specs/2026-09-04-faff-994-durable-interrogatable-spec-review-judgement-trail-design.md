# Durable, interrogatable spec-review judgement trail

> Spec: faffter-dark-nlspec · 2026-09-04 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-994.
> build-tier: complex

This spec is the buildable design for FAFF-994 — "half 1 of 2" split from FAFF-946 (human resolution 2026-09-03, "Chosen: option 3"). Audience: the build agent that implements it, and the human reviewers who gate it. It persists every spec-review judgement to a durable custom git ref, adds a `faff judge-history` reader over that ref, and teaches `faff audit` to enumerate the ref as a second discovery source.

## 1. WHY — Problem and Principles

**The load-bearing model.** A spec-review run produces judgement raw material — refuter objections, per-proposition judge rulings, the `AdmitResult`, and the spec text that was judged — but today that material lives only in the gitignored run-dir spec-review scratch subtree (`<run-dir>/<ISSUE>/spec-review/…`). The run dir is swept; a parked or errored spec opens no PR and so mints no committed anchor at all. This change writes that same material, verbatim, to a dedicated `refs/faff/judge-trail/<run_id>` custom git ref — a durable, queryable sibling store that survives run-dir cleanup and needs no PR.

**Problem statement.** The judgement trail is scattered and ephemeral, and the parked/errored case — the one an audit trail most needs — is the least covered because it never reaches a PR anchor. This change persists the trail to a durable ref and makes it interrogatable via `faff judge-history` and `faff audit`.

**Design principles.**

- **Verbatim, never re-derived.** The trail stores the objections, rulings, `AdmitResult`, and spec text exactly as they were produced. The mint step copies bytes off disk; it never recomputes a judgement, re-runs a lens, or reconstructs a verdict. A trail that re-derived its content would be an opinion, not evidence.
- **Additive sibling — touch nothing load-bearing.** The store is additive. It does not alter ADR-0109's PR-only committed-anchor rule, does not touch FAFF-623/796's `deriveAnchorDirs`/`evaluateAnchorDir` anchor machinery, and does not become a persistence precondition for anything. Option 3 dissolved the old fail-closed interlock, so the mint is best-effort — its failure never blocks a run close, a merge, or a park.
- **Region boundary is real.** `audit.js` is `region:governance`; per ADR-0042's require-graph lint (`governance never requires factory`) it cannot `require()` the factory-region git-ref machinery (`bundle.js`, the new `judge-trail.js`). Any path from `faff audit` into the ref reader crosses a **process** boundary (a CLI self-spawn), never a require edge. This constraint shapes the whole reader design; implementing it as an in-process require would fail the region lint and is wrong.
- **Tamper-evident on read, not tamper-proof.** A CLI-computed `witness_sha` is stored in the manifest and **recomputed on every read** — the store's own claimed hash is never trusted (mirrors `bundle.js`'s `classifyBundle` recompute-per-read discipline). A mismatch is surfaced as tamper-suspect; the reader does not silently drop or trust divergent data.

**Reference context.**

| System | Region | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | factory | The `refs/faff/*` write-once push idiom (hash-object → tree → commit-tree → update-ref/push), the `bundle_store` local-vs-git-remote resolution (`resolveBundleStore`), `canonicalJSON`, `validateIdentityForHandle`, and the recompute-digest-on-read discipline this store copies. |
| `plugin/skills/faff/bin/lib/audit.js` | governance | `cmdAudit` / `buildReconstruction` — the single-run reader the second source folds into. Cannot require factory modules. |
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` | factory | Writes the scratch substrate: `case-<pid>.json`, `ledger.json` (0600), and (via `--admit`) the `AdmitResult`. `roundFilesInDir` reads `round-<n>.json`. |
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` | factory | `sha256Text` (the `built_spec_sha` hash), the objection triple shape, `admitRollup`'s `AdmitResult` shape, the `contested_source` (down-weighted) flag. |
| `records/adr/0109-*.md` | — | The PR-only rule + the `deriveAnchorDirs` second-source precedent this mirrors, and the run-close best-effort mint timing (ADR-0109-symmetric). |
| `plugin/skills/faff/bin/lib/events.js` | factory | `cmdEventsAnchorRun` — the run-close mint template, and the `spawnSync` self-spawn precedent for crossing the governance↔factory region boundary. |
| `plugin/skills/faff-beep-boop/SKILL.md` (~line 434–436) | — | The single orchestrator-exit edit where the best-effort mint bullet is added, after `events anchor-run` and `bundle publish`. |

**Scope statement.** This is the durable-persistence + reader half of FAFF-946's option 3, inside the existing `faff` CLI — no new service, datastore, or runtime surface.

## Already shipped against this surface

These Done tickets built the judgement **substrate** this trail persists — they are why the material can be stored verbatim, and none of them supersede this work (the durable ref, `faff judge-history`, and the `faff audit` second source do not yet exist):

- **FAFF-935** — refuter objections carry `{claim, evidence, predicted_consequence}` (the stored objection triple).
- **FAFF-943** — objections carry `spec_anchor` (stored alongside).
- **FAFF-930 / FAFF-922** — the blinded two-sided case-file adjudicator and the weighing judge (the rulings + `AdmitResult` this trail stores).
- **FAFF-945 / FAFF-972 / FAFF-973 / FAFF-941 / FAFF-940** — accept-bar placement, `max_tokens` wiring, config cleanup, dispatch reliability — the judge machinery whose output is the source substrate.

Related but not superseding, for reader context: **FAFF-601** (delivery-evidence schemas), **FAFF-43** (unattended-run audit trail), **FAFF-107** (audit-log redaction), **ADR-0109 / FAFF-623 / FAFF-796** (the PR-only anchor + `deriveAnchorDirs` second-source precedent this mirrors).

## 2. OUT OF SCOPE

- **The L4 infosec-floor flip** — *Why:* the sibling FAFF-946 sub-issue (the judge-aware infosec floor); option 3 made the two independent. *Extension point:* the sibling ticket; no hook here.
- **ADR-0109 reversal / the PR-only committed-anchor rule** — *Why:* this store is an additive sibling, not a replacement. *Extension point:* `records/adr/0109-*.md` stays as written; a future ADR would supersede it if ever needed.
- **FAFF-888 (calibration/liveness consumer)** — *Why:* it is the downstream reader of this trail, a separate build. *Extension point:* `faff judge-history --json` is the stable interface FAFF-888 consumes; do not build calibration logic here.
- **Retention / GC of old `refs/faff/judge-trail/*` refs** — *Why:* out of the stated scope; refs are cheap and additive. *Extension point:* a future `faff judge-history --prune` or a maintenance sweep.
- **Migrating historical (pre-feature) runs into the trail** — *Why:* the substrate for past runs is already swept. *Extension point:* none; the trail is forward-only from first ship.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| judge-trail ref | The custom git ref `refs/faff/judge-trail/<run_id>` holding one run's judgement trail as a commit over a tree. Never a branch; opens no PR, triggers no CI. |
| per-issue subtree | A directory inside the trail tree, one per issue (`<ISSUE>/…`), holding that issue's verbatim judgement material. |
| `witness_sha` | A CLI-computed sha256 over the canonicalised manifest core, stored in `manifest.json` and recomputed on read to detect tampering. |
| `built_spec_sha` | `sha256Text(spec_text)` over the spec text that the judge ran against — the manifest key linking objections, rulings, `AdmitResult`, and the stored spec blob. |
| down-weighted objection | An objection whose serving backend was reputation-flagged — carried with the ledger entry's `contested_source: true`. Stored, never dropped. |

**Type definitions.**

```
RECORD JudgeTrailManifest:            # manifest.json, one per issue subtree
  schema_version: Int                 # bump-on-shape-change, validated on read
  issue: IssueId                      # e.g. FAFF-994; charset-guarded (validateIdentityForHandle)
  run_id: RunId                       # the minting run; charset-guarded
  built_spec_sha: Hex64               # sha256Text(spec_text); the linking key
  spec_blob: Path                     # relative path to the stored spec text within the subtree
  objections: Path                    # relative path to objections.json (verbatim round/ledger material)
  rulings: Path                       # relative path to rulings.json (per-proposition, verbatim)
  admit_result: Path | null           # relative path to admit-result.json; null if the judge never ran
  outcome: Enum{admit, park, error, no-judge}   # coarse disposition, for --outcome filtering
  lenses: Set<Enum{architectural, infosec, methodology, QA}>  # union of objecting lenses, for --lens filtering
  witness_sha: Hex64                  # sha256(canonicalJSON(manifest_core)); EXCLUDES this field

  CONSTRAINT witness_sha == sha256(canonicalJSON(manifest without witness_sha))
  CONSTRAINT built_spec_sha == sha256Text(read(spec_blob))

RECORD StoredObjection:               # verbatim; shape as produced by the reviewer / ledger
  claim: String
  evidence: String
  predicted_consequence: String | null
  spec_anchor: String
  lens: Enum{architectural, infosec, methodology, QA}
  severity: Enum{blocker, major, minor}
  contested_source: Bool              # true = down-weighted (reputation-flagged backend)

RECORD StoredRuling:                  # verbatim; one per proposition
  proposition_id: PropId              # p-01 … p-0N
  outcome: Enum{AFFIRM_SPEC, PRD_BOUNDARY, UPHOLD_REVIEW, SYNTHESIZE}
  rationale: String
  applied_correction: String | null
  resolution: Enum{resolved, parked, pending}
```

**CLI surfaces.**

```
faff judge-trail mint --run-dir <dir> [--root <repo>] [--json]
  # best-effort persist; reads the run's scratch subtrees, writes the ref. Exit 0 on mint or clean no-op;
  # non-zero is logged by the caller and NEVER gates run close (see HOW).

faff judge-history [--issue <ID>] [--run <RUN_ID>] [--lens <L>] [--outcome <O>] [--root <repo>] [--json]
  # reader over refs/faff/judge-trail/*; git plumbing only (ls-remote/cat-file/show), no checkout.
  # verifies witness_sha per record; a mismatch renders tamper-suspect (never dropped, never trusted).

faff audit <run-id> [--issue <ID>] [--json] [--root <repo>]
  # UNCHANGED signature; gains a durable-ref SECOND source folded in via self-spawn (see HOW).
```

**Design decisions** (rationale collected in §6):

- Tree construction — **Chosen:** build the per-issue-subtree tree with a temporary index (`GIT_INDEX_FILE=<tmp> git update-index --add --cacheinfo <mode>,<sha>,<issue>/<file>` per blob, then `git write-tree`), which materialises real nested subtrees from slash-containing paths. `git mktree` builds only flat trees and is not used for the nested layout.
- Module placement — **Chosen:** a new factory-region module `plugin/skills/faff/bin/lib/judge-trail.js` holds the writer, the reader core, and the ref plumbing; it reuses `bundle.js`'s **exported** surface (`canonicalJSON`, `validateIdentityForHandle`, `resolveBundleStore`) and `spec-judge-casefile.js`'s exported `sha256Text`.
- Push destination — **Chosen:** honour the existing `bundle_store` config via `resolveBundleStore` — `local` writes the ref locally (`update-ref`; already survives run-dir cleanup, since refs live in `.git`), `git-remote` pushes it to `origin` (survives local clone loss).
- audit second source — **Chosen:** `faff audit` gains the durable ref as a second source by **self-spawning** `faff judge-history --json` (a process boundary, ADR-0042-legal), never a require edge (see §6 and the region-boundary principle).
- `AdmitResult` persistence — **Chosen:** persist the `AdmitResult` to `<scratch>/judge/admit-result.json` at the point `faff spec-judge-evidence --admit` computes it, so the mint reads it verbatim rather than re-deriving it.

## 4. HOW — Behaviour

### 4.1 Writer — `faff judge-trail mint`

**Summary.** At run close, copy each issue's on-disk judgement material into a per-issue subtree, compute the manifest + `witness_sha`, assemble one tree, commit it (no parent), and write/push it to `refs/faff/judge-trail/<run_id>`. Best-effort throughout: any failure logs and returns non-zero without side effects the caller must clean up.

```
PROCEDURE mint(run_dir, root):
  1. run_id := basename(run_dir); validateIdentityForHandle(run_id)   # charset guard before ref interpolation
  2. issues := list <run_dir>/<ISSUE>/spec-review/ dirs that contain any judgement material
     (round-<n>.json, or a judge/ subdir with ledger.json)
  3. IF issues is empty: log "no judgement material — nothing to mint"; RETURN 0    # clean no-op
  4. tmp_index := fresh temp index file
  5. FOR each issue in issues:
       a. objections := collect verbatim from round-<n>.json (roundFilesInDir) + ledger.json entries
          (carry contested_source / lens / severity through unchanged)
       b. rulings := collect verbatim from judge/ruling-<pid>.json (if any)
       c. admit_result := read judge/admit-result.json (if present) else null
       d. spec_text := the reviewed spec text for this issue
          (the last proposition's pre_ruling_spec_content in ledger.json, or the on-disk spec file;
           precedence: on-disk spec file if present, else ledger pre_ruling_spec_content)
       e. built_spec_sha := sha256Text(spec_text)
       f. hash each artifact blob (git hash-object -w --stdin) → sha
       g. manifest := { schema_version, issue, run_id, built_spec_sha, relative paths, outcome, lenses }
          witness_sha := sha256(canonicalJSON(manifest_core))   # manifest_core = manifest minus witness_sha
          manifest.witness_sha := witness_sha
       h. update-index --add --cacheinfo for <issue>/manifest.json, <issue>/spec.txt,
          <issue>/objections.json, <issue>/rulings.json, <issue>/admit-result.json (as present)
  6. tree_sha := git write-tree (GIT_INDEX_FILE=tmp_index)
  7. commit_sha := git commit-tree tree_sha -m "judge-trail <run_id>"    # orphan, no parent
  8. store := resolveBundleStore(root)
     local     → git update-ref refs/faff/judge-trail/<run_id> commit_sha    # write-once (see edge cases)
     git-remote→ git push <remote> commit_sha:refs/faff/judge-trail/<run_id> # non-force create
  9. RETURN 0

  ON ANY ERROR at steps 4–8: log the error, leave no partial ref, RETURN 1   # best-effort; never throws upward
```

**Run-close seam (the single orchestrator-exit edit).** In `faff-beep-boop/SKILL.md`, immediately after the existing run-close `events anchor-run` + `bundle publish` bullets (~line 434–436), add one bullet: shell `"$faff" judge-trail mint --run-dir "$FAFF_RUN_DIR"`. It is best-effort — a non-zero exit is logged and the close proceeds regardless — and, unlike the two git-only-gated bullets above it, it is **not** git-only-gated: it runs on every review-gated run, tracker-backed or not (the parked/errored tracker-backed case is exactly what the trail exists to cover). This is the only mint call site; every orchestrator exit path (clean drain, all-parked, budget-hit) reaches it because it sits on the shared close edit.

### 4.2 `AdmitResult` persistence (extension to the admit flow)

**Summary.** `admitRollup`'s result is emitted to stdout today but never written to disk, so the mint cannot read it verbatim. Persist it.

```
PROCEDURE on_admit(scratch, admit_result):
  # in the --admit code path of spec-judge-evidence.js, after admitRollup returns and before emitting:
  1. write <scratch>/judge/admit-result.json := JSON.stringify(admit_result, null, 2)
  2. continue emitting the AdmitResult exactly as today   # stdout contract UNCHANGED
```

**Anti-pattern:** having the mint re-run `--admit` to recover the `AdmitResult`. Why: it would re-derive a judgement (violating verbatim-never-re-derived) and could diverge from what actually gated the run.

### 4.3 Reader — `faff judge-history`

**Summary.** Enumerate `refs/faff/judge-trail/*`, read each manifest + artifacts via git plumbing (no working-tree checkout), verify `witness_sha`, apply filters, render.

```
PROCEDURE judge_history(filters, root):
  1. store := resolveBundleStore(root)
  2. refs := enumerate refs/faff/judge-trail/*      # local: git for-each-ref; git-remote: git ls-remote <remote> "refs/faff/judge-trail/*"
  3. records := []
  4. FOR each ref (run_id) [filter by --run early if set]:
       a. commit_sha := resolve ref (for git-remote: fetch --no-tags <remote> <ref> first)
       b. FOR each <issue>/ subtree [filter by --issue early if set]:
            manifest := parse git show commit_sha:<issue>/manifest.json
            recomputed := sha256(canonicalJSON(manifest minus witness_sha))
            tamper_suspect := (recomputed != manifest.witness_sha)
            record := { run_id, issue, outcome, lenses, manifest, tamper_suspect }
            records.push(record)
  5. records := records filtered by --lens (intersect lenses) and --outcome (equals outcome)
  6. IF --json: print JSON.stringify(records) [tamper_suspect included per record]
     ELSE: render text; a tamper_suspect record is clearly flagged "TAMPER-SUSPECT (witness_sha mismatch)"
  7. RETURN 0    # a tamper-suspect record is surfaced, not an error exit
```

**Edge cases.**

- **No judge-trail refs at all** → `judge-history` prints an empty set (`[]` under `--json`) and exits 0. Not an error.
- **`witness_sha` mismatch** → the record is retained and marked tamper-suspect; never silently dropped, never trusted as clean. This is the whole point of the witness.
- **Malformed / unparseable manifest** → that one record renders as tamper-suspect with a parse note; other records are unaffected.
- **Ref already exists at mint (local `update-ref`)** → write-once: if the ref exists, the mint treats it as already-minted for that `run_id` and no-ops (a re-run of the same run must not clobber the first trail). For `git-remote`, the non-force push naturally fails a second create; that failure is a clean no-op, logged, exit 0-equivalent (already persisted).
- **A run that never invoked the judge** (only refuter rounds, no `judge/` dir) → still minted, with `admit_result: null` and `outcome: no-judge`; objections/rulings-from-rounds are the trail. The parked-before-judge case is covered.
- **`git-remote` store but remote unreachable** (`STORE_UNAVAILABLE_RE`-class error) → mint logs and returns non-zero; run close proceeds. `judge-history`/`audit` degrade to whatever is locally resolvable and note the unreachable remote.

### 4.4 `faff audit` second source (cross-region, self-spawn)

**Summary.** `faff audit` keeps its single-run reconstruction and additionally folds in the durable ref, obtained by self-spawning the factory-region reader across a process boundary.

```
PROCEDURE audit_second_source(run_id, root):
  # inside cmdAudit, after the existing single-run reconstruction is built:
  1. child := spawnSync(process.execPath, [FAFF_ENTRYPOINT, "judge-history", "--run", run_id, "--json", "--root", root])
     # a PROCESS boundary, not a require edge — ADR-0042-legal (precedent: events.js anchor-run → governance-check)
  2. IF child ok: durable := JSON.parse(child.stdout); fold durable records into the reconstruction
     under a distinct "durable judge-trail" section (second source), preserving tamper_suspect flags
  3. IF child failed/absent: note "durable judge-trail unavailable" and render the single-run reconstruction alone
     # the second source is additive; its absence never fails audit
```

**Failure modes.**

- **The failure:** treating the audit second source as an in-process require of `judge-trail.js`. *How you'd know:* `faff regions check` (the ADR-0042 require-graph lint) fails with a governance→factory edge. *What it means:* abandon the require; use the `spawnSync` self-spawn. This is the single highest-risk mistake in the build.
- **The failure:** the mint silently clobbers or double-writes a ref on a resumed/retried run. *How you'd know:* two `commit-tree` SHAs for one `run_id`, or a changed ref where a run only resumed. *What it means:* the write-once guard (edge case above) is missing or wrong — the ref must be create-only per `run_id`.
- **The failure:** `witness_sha` computed over a non-canonical serialisation, so an innocent key-order change reads as tamper. *How you'd know:* a freshly-minted, untouched trail reads tamper-suspect. *What it means:* the read path isn't using the identical `canonicalJSON` the write path used — both sides must share the one helper.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run that spec-review-parked FAFF-994 (judge ran, admit:false, no PR opened)
When the orchestrator reaches run close and shells `faff judge-trail mint --run-dir <run-dir>`
Then refs/faff/judge-trail/<run_id> exists with a FAFF-994/ subtree containing objections.json,
     rulings.json, admit-result.json, spec.txt, and a manifest.json whose witness_sha verifies
```

```
Given a minted judge-trail ref whose stored spec blob has been altered after minting
When `faff judge-history --issue FAFF-994 --json` reads it
Then the FAFF-994 record is returned with tamper_suspect:true (witness_sha mismatch), not dropped and not exit-nonzero
```

```
Given a minted judge-trail ref for run R
When `faff audit R --json` runs
Then the output includes the single-run reconstruction AND a durable judge-trail second source folded in,
     and `faff regions check` still passes (no governance→factory require edge was introduced)
```

```
Given a run whose spec-review produced only refuter rounds and never invoked the judge
When the trail is minted
Then the issue subtree carries objections from round-<n>.json with admit_result:null and outcome:"no-judge"
```

## 6. Design Decision Rationale

**How are per-issue subtrees built when no nested-mktree helper exists?**
Options: (a) `git mktree` with slash-named entries — rejected, `mktree` builds only flat trees and does not synthesise intermediate trees from slashes; (b) manually build inner trees per issue then a root `mktree` — works but verbose and error-prone; (c) a temporary index + `update-index --add --cacheinfo <mode>,<sha>,<path>` + `write-tree` — git materialises nested subtrees from slash paths automatically. **Chosen:** (c) — the idiomatic git-plumbing route to nested trees, least custom code, no checkout.

**New module vs widening `bundle.js`?**
`bundle.js`'s low-level git wrappers (`gitRunText`) and `STORE_UNAVAILABLE_RE` are module-private by design, and its exported surface is a bundle/claim mutex contract. **Chosen:** a new factory module `judge-trail.js` with its own thin git wrappers mirroring bundle.js's private ones (each ~5 lines), reusing bundle.js's *exported* higher-level pieces (`canonicalJSON`, `validateIdentityForHandle`, `resolveBundleStore`). **Anti-pattern:** widening bundle.js's exports just to share 5-line spawn wrappers. Why: it enlarges a closed contract's surface for a trivial DRY win and couples two unrelated stores.

**How does `faff audit` (governance) read a factory-region ref?**
`audit.js` cannot `require()` factory modules (ADR-0042 lint). **Chosen:** self-spawn `faff judge-history --json` via `spawnSync(process.execPath, …)` — a process boundary invisible to the require-graph lint by design, the exact precedent `events.js`'s `anchor-run` uses to reach `governance-check`. This is why the reader core lives in `judge-history` (factory) and `audit` consumes its JSON, not the reverse. This resolves the ticket's "one reader core" phrasing: `judge-history` is that core; `audit` is a second consumer of it.

**witness_sha algorithm.**
**Chosen:** `sha256(canonicalJSON(manifest_core))`, `manifest_core` = the manifest minus the `witness_sha` field, using the same `canonicalJSON` on write and read, recomputed on every read and never trusting the stored value — mirrors `bundle.js`'s `classifyBundle` "recompute, never trust the store's own claim." Rationale: deterministic across key-order, single helper eliminates the false-tamper failure mode.

**Mint timing + gating.**
**Chosen:** best-effort at run close, one bullet after the existing anchor-run/bundle-publish sequence, not git-only-gated (every review-gated run), never a close gate — ADR-0109-symmetric. At the time of writing, option 3 has dissolved the old fail-closed persistence interlock, so no precondition guards the mint.

**Push destination.**
**Chosen:** reuse `bundle_store` via `resolveBundleStore` rather than a new config key — `local` already survives run-dir cleanup (refs live in `.git`), `git-remote` adds clone-loss durability. Rationale: no new knob, consistent with the existing bundle store's operator model.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed; the direction the ticket set (option 3, additive sibling, ADR-0109-symmetric mint, `deriveAnchorDirs`-style second source) is followed.

**Assumptions.**

- **Assumes:** for a review-gated issue, the per-issue scratch material (`round-<n>.json`, and where the judge ran, `judge/ledger.json` + `judge/ruling-<pid>.json`) is present under `<run-dir>/<ISSUE>/spec-review/` at run close. *Validation:* before writing a subtree, the mint checks the dir for material and skips (with a log line) any issue dir that has none; a run with zero material is a clean no-op. The one net-new on-disk artifact this build must add is `judge/admit-result.json` (§4.2).
- **Assumes:** the reviewed spec text for an issue is recoverable at mint — from the on-disk spec file if present, else from the last proposition's `pre_ruling_spec_content` in `ledger.json` (that field, and its `pre_ruling_spec_sha` sibling, are written by `spec-judge-casefile.js`'s `assemble()`; the on-disk spec is read from the `--spec <spec-file>` path at both assemble and admit time). *Validation:* the mint asserts one of the two is available; if neither is, it stores the subtree with `spec_blob` absent and `built_spec_sha` over the empty string, and marks `outcome` accordingly rather than failing the whole mint.
- **Assumes:** `git` plumbing (`hash-object`, `update-index --cacheinfo`, `write-tree`, `commit-tree`, `update-ref`, `push`, `for-each-ref`, `ls-remote`, `show`) is available — already a hard dependency of `bundle.js`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A spec-review run that parks (no PR) leaves a durable `refs/faff/judge-trail/<run_id>` ref with the run's judgement material — verified by minting from a parked-run fixture and reading it back.
- [ ] The stored objections, rulings, and `AdmitResult` are byte-identical to the scratch material (verbatim; no re-derivation) — verified by comparing stored blobs to the source files.

### From WHAT (types and interfaces)
- [ ] `manifest.json` carries `schema_version`, `issue`, `run_id`, `built_spec_sha`, artifact paths, `outcome`, `lenses`, and `witness_sha`; `witness_sha == sha256(canonicalJSON(manifest_core))` and `built_spec_sha == sha256Text(spec_text)`.
- [ ] `contested_source` (down-weighted) objections are stored, not dropped.
- [ ] `faff judge-history` accepts `--issue`, `--run`, `--lens`, `--outcome`, `--json` and filters accordingly.

### From HOW (behaviour)
- [ ] `faff judge-trail mint` builds real per-issue subtrees via a temp index + `write-tree` (nested trees, not flat) and writes/pushes `refs/faff/judge-trail/<run_id>` per the resolved `bundle_store` (`local` → `update-ref`; `git-remote` → non-force push to origin).
- [ ] The mint opens no PR and triggers no CI (custom ref only) and survives run-dir cleanup.
- [ ] A best-effort mint bullet is added to `faff-beep-boop/SKILL.md` after the anchor-run/bundle-publish sequence; a non-zero mint exit is logged and never gates run close; it is reached on every exit path (clean/all-parked/budget-hit) and is not git-only-gated.
- [ ] `faff spec-judge-evidence --admit` writes `<scratch>/judge/admit-result.json` verbatim; its stdout `AdmitResult` contract is unchanged.
- [ ] `faff judge-history` reads via git plumbing with no checkout, recomputes `witness_sha` per record, and surfaces a mismatch as tamper-suspect (record retained, exit 0).
- [ ] `faff audit <run-id>` folds the durable ref in as a second source by self-spawning `faff judge-history --json` (process boundary), preserving `tamper_suspect` flags; its signature is unchanged and the single-run reconstruction still renders when the second source is absent.

### From HOW (edge cases)
- [ ] A second mint for the same `run_id` leaves a single ref (write-once; second create is a clean logged no-op, never a force-update).
- [ ] A run with no judgement material mints nothing and exits 0.
- [ ] A run that never invoked the judge is minted with `admit_result: null` and `outcome: "no-judge"`.
- [ ] `faff regions check` passes — no `governance → factory` require edge was introduced by the audit second source.

### Integration smoke test
```
PROCEDURE smoke:
  1. Build a temp run-dir fixture with one issue's spec-review scratch (round-1.json + judge/ledger.json + ruling-p-01.json + admit-result.json) and a spec file.
  2. Configure bundle_store=git-remote against a `git init --bare` origin fixture (per test/bundle.test.mjs).
  3. faff judge-trail mint --run-dir <fixture>  → exit 0; ref exists on the bare remote.
  4. faff judge-history --run <run_id> --json  → one record, tamper_suspect:false, witness verifies.
  5. faff audit <run_id> --json                → includes the durable second source; regions check passes.
```

**Eval coverage.** No new LLM-judgement seam is introduced — the mint and readers are deterministic plumbing over already-produced judgements. No grader/eval-case registration is required.

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** At the upper bound of a single unit (build-tier complex) but **not splittable** — the writer, the `judge-history` reader, the `audit` second source, and the `admit-result.json` persistence always ship together: a writer with no reader is inert, and the audit second source consumes the reader. This is already "half 1 of 2" split from FAFF-946; splitting further would leave a non-functional half. Merge-not-split. Watch scope during build; if the writer alone grows unexpectedly, the reader/audit-source could be a fast-follow, but the spec's DONE keeps them coupled deliberately.
- **Workstream fit?** Fits the spec-review-judge audit/calibration workstream (parent FAFF-946; feeds FAFF-888). Outcome-named and cohesive.
- **Deps surfaced?** No hidden dep. The build stands on already-Done substrate (FAFF-935/943/930/922); the sibling FAFF-946 half is explicitly independent (option 3); FAFF-888 is downstream and out of scope. No missing blocker link.
- **Risk profile?** The one novel integration — `faff audit` reading a factory-region ref across the governance boundary — is de-risked in-spec: the design pins the `spawnSync` self-spawn to the `events.js` precedent and gives a concrete signal (`faff regions check`) in Failure Modes. No de-risking spike warranted.

confidence: high
spec-review: approve (single-pass, L3)
