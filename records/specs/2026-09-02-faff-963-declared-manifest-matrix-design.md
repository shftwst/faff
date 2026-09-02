# Declared-manifest matrix for the gateway prefix-planner

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-963.

This spec addresses FAFF-963 ("prefix-planner mis-classifies refer-back canonical gateway blocks as movable"). Audience: the build agent implementing the fix, and the human reviewers who read the spec on the ticket before build. It describes the durable fix the 2026-08-29 design named but only half-shipped: make the prefix-planner read a human-owned declared-usage manifest as the authoritative consumer set, seed and update that manifest without clobbering human corrections, demote the title scan to a seed and a drift alarm, and lint the manifest in CI.

## 1. WHY — Problem and Principles

**The load-bearing model.** The prefix-planner today infers which gateway block belongs to which skill by scanning each skill's text for the block's section-heading title as a substring. faff's own refer-back rule ("shared prose has one home; reference it by name") makes that inference wrong in both directions: a canonical block that its one consumer refers back to by name looks privately-owned (one citation), and a core block that consumers rely on without quoting its heading looks unused (zero citations). The fix replaces inference-as-truth with a declared, human-owned matrix the planner reads, keeping the scan only to seed that matrix and to warn when it drifts.

**Problem statement.** The title-substring scan in `eval/prefix-planner.mjs` mis-classifies canonical and `(fixed)` refer-back gateway blocks: all four sole-consumer "movable" candidates are false positives (each a gateway-owned block its named consumer refers back to), and core universal blocks fall into a 33k-token `unknown` bucket that the reported optimistic floor then treats as reclaimable. Acting on those raw candidates during the FAFF-607 gateway split would move canonical contracts out of the shared gateway and break the single-source model.

**Design principles.**

- **The manifest is authoritative; the scan is advisory.** Once the manifest exists, the planner's live classification reads the manifest's declared consumer sets. The title scan never overrides a declared entry — it only seeds a missing entry and raises a drift warning. Any implementation that lets the scan silently rewrite a declared consumer set reintroduces the exact bug this ticket fixes.
- **Human corrections are never clobbered.** The manifest is human-owned. A re-seed or update adds entries for new gateway blocks and leaves every existing entry byte-stable. Wholesale overwrite is forbidden.
- **Structural drift fails CI; usage drift only warns.** A gateway block with no manifest entry, or a manifest entry naming a block or skill that does not exist, is a structural fault that must fail CI. A scan guessing a consumer set that differs from the declared one is expected (implicit and refer-back usage the scan cannot see) and is surfaced as a warning for a human to reconcile, never a hard failure.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/prefix-planner.mjs` | Node ESM (`.mjs`) | The planner being changed: `segmentGateway`, `scanUsage`, `classify`, `buildReport`, `emitManifest`, `main`. |
| `eval/baselines/gateway-usage.json` | JSON | The manifest file. Exists today as the un-corrected seed (output of `--emit-manifest`); re-seeded from the verified matrix and then human-owned. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node CJS | The CI lint host. Reads `eval/seam-registry.json` / `eval/baselines/frontier.json` today with an exit-2 fail-loud precedent; the new manifest lint mirrors that shape. |
| `plugin/skills/faff/SKILL.md` | Markdown | The gateway. `segmentGateway` splits it into H2/H3 blocks; `(fixed)` is a prose-only heading suffix on six canonical contract blocks. |
| `test/eval-prefix-planner.test.mjs` | Node ESM test | Imports the planner's pure functions; currently asserts a `(fixed)` block classifies as single-consumer `set` — the behaviour this fix changes. |
| `.github/workflows/validate.yml` | YAML | Runs `node plugin/skills/faff/bin/faff validate-adapters`; any non-zero exit fails the job. |

**Scope statement.** This is the classification layer of the tokenomics eval suite that feeds the FAFF-607 layered read-back prefix design; it does not touch the gateway content itself or the split execution.

## Already shipped against this surface

Related Done work, none of which supersedes this premise:

- **FAFF-932** (Tokenomics eval suite — Done 2026-08-31) shipped method 1 of the 2026-08-29 design: the reference-scan (`scanUsage`), the clustering, and the un-corrected seed `eval/baselines/gateway-usage.json`. It did **not** ship method 2 (the authoritative declared manifest read + merge-preserving update + CI lint), which is the delta this ticket builds.
- **FAFF-882 / FAFF-903** (review-call context lean — Done) reduced gateway context handed to review calls; adjacent tokenomics work, not the classification layer.

Premise still holds: the authoritative-manifest half is undelivered.

## 2. OUT OF SCOPE

- **Executing the gateway kernel/reference split.** That is FAFF-607, the downstream consumer of this manifest. Extension point: FAFF-607 reads the corrected manifest's consumer sets to plan the split.
- **Editing gateway content (moving, renaming, or deleting any block).** This spec changes only how blocks are classified, never the gateway prose. Extension point: `plugin/skills/faff/SKILL.md`, under FAFF-607.
- **A machine-readable per-heading tag inside the gateway (a `(fixed)`/canonical frontmatter marker on each block).** One of the ticket's open questions; the declared manifest supersedes the need for it, because the human declares keep/consumer status in the manifest instead of tagging the gateway. Extension point: the manifest's `keep` field is where that intent now lives.
- **Making the usage-drift check an enforcing CI gate.** Drift stays advisory (a warning), mirroring the currently-advisory `size-census --gate` step. Extension point: `.github/workflows/validate.yml`, a future enforce flip once the manifest is stable.
- **Auto-detecting implicit usage (a skill relying on a block without naming it).** Not machine-detectable, which is the reason the manifest is human-owned. Extension point: the manifest entry a human edits.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Declared manifest | The human-owned `eval/baselines/gateway-usage.json`: the authoritative block-to-consumer matrix the planner reads. |
| Consumer set | The skills that need a gateway block, declared per entry as an array of `plugin/skills/<dir>` names, or the sentinel `"all"` (near-universal core) or `"none"` (no sub-skill consumer). |
| Keep flag | A human declaration that a block is never a move candidate regardless of its consumer count (canonical/`(fixed)`/core blocks). |
| Seed | An entry the planner wrote from the title scan, not yet human-verified (`source: "seed"`). |
| Structural drift | The gateway block set and the manifest entry set disagree, or an entry names a nonexistent block/skill. CI-failing. |
| Usage drift | The title scan's guessed consumer set differs from the declared one. Warning-only. |

**Manifest schema.** The file supersedes today's ambiguous seed shape (where `consumers` held either an array or a kind-string). New shape:

```
RECORD Manifest:
  _note: String                 # human-readable provenance note
  _schema: Int                  # schema version, starts at 1
  blocks: List<BlockEntry>      # one per gateway H2/H3 block, in gateway order

RECORD BlockEntry:
  title: String                 # exact normalised-comparable gateway heading text; unique key
  consumers: List<String> | "all" | "none"
                                # array => explicit consumer skill dirs; "all" => near-universal core; "none" => no sub-skill consumer
  keep: Boolean                 # true => never a move candidate (canonical/(fixed)/core)
  keep_reason: String?          # optional free-form why, present when keep = true
  source: "seed" | "verified"   # "seed" => scan-written, unreviewed; "verified" => human-confirmed
  tokens: Int?                  # informational only; the live token count is recomputed from the gateway, never read from here

  CONSTRAINT title matches exactly one gateway block heading
  CONSTRAINT every array member of consumers is an existing plugin/skills/<dir>
  CONSTRAINT consumers is a non-empty array, or one of the two sentinels
```

**Design decision — file format.** The 2026-08-29 design named `gateway-usage.yaml`; the shipped tool already writes `gateway-usage.json` and it is committed at that path. **Chosen:** keep JSON at `eval/baselines/gateway-usage.json`. Rationale: no format churn, no new YAML parser dependency, and `validate-adapters.js` already reads JSON baselines directly.

**Design decision — tokens are not authoritative.** A stored token count drifts the moment the gateway is edited. **Chosen:** `tokens` in the manifest is informational only; `buildReport` recomputes every block's token count live from the gateway via `estimateTokens`, exactly as today. Rationale: keeps the reported figures true after any gateway edit without forcing a manifest re-seed for size alone.

**Planner API (the functions changed or added in `eval/prefix-planner.mjs`).**

```
FUNCTION loadManifest(path) -> { byTitle: Map<title, BlockEntry>, raw: Manifest } | null
  # null when the file is absent; throws a labelled error when present-but-unparseable.

FUNCTION seedEntry(block, matrix) -> BlockEntry
  # builds a source:"seed" entry from the scan: consumers from the scanned citer set
  # (or "none" when empty), keep=false, tokens from the live block size.

FUNCTION syncManifest(blocks, matrix, path) -> { added: [title], preserved: Int }
  # seed-if-absent + merge-preserving update; never overwrites an existing entry.

FUNCTION driftCheck(blocks, matrix, manifest) -> List<Warning>
  # one-directional usage-drift warnings (scan-sees-more only).

FUNCTION checkManifest(blocks, manifest) -> { structural: [violation], reference: [violation] }
  # the CI-gating structural + reference-validity check; pure, no I/O beyond the inputs.

FUNCTION buildReport(blocks, manifest, { conservative }) -> Report
  # manifest-authoritative when a manifest is supplied; scan-fallback when null (back-compat for unit tests).
```

**CLI surface (unchanged flags plus new modes).**

| Invocation | Behaviour |
|---|---|
| `node eval/prefix-planner.mjs --json` | Report built from the manifest (authoritative), tokens recomputed live. |
| `node eval/prefix-planner.mjs --emit-manifest <path>` | Seed-if-absent + merge-preserving update of the manifest at `<path>` (never a wholesale overwrite). |
| `node eval/prefix-planner.mjs --drift` | Print usage-drift warnings; exit 0 (advisory, never fails CI). |
| `node eval/prefix-planner.mjs --check-manifest [--json]` | Structural + reference lint; exit 0 clean, exit 1 drift/dead-ref, exit 2 manifest missing/unparseable. |

## 4. HOW — Behaviour

**Architecture and approach.** `segmentGateway` still splits the live gateway into blocks and `estimateTokens` still sizes them. `scanUsage` still produces a guessed block-to-citer matrix, but its output is no longer the classification — it is the seed source and the drift-check input. `buildReport` reads the declared manifest and classifies each block from its declared `consumers`/`keep`. The CI lint lives in `validate-adapters.js` and delegates the gateway-parse to the planner (single-source) so the two never diverge.

**Classification from the manifest (replacing citation-count inference).**

```
PROCEDURE classifyFromManifest(block, entry):
  1. IF entry.consumers == "all"  -> kind = universal
  2. ELSE IF entry.consumers == "none" -> kind = uncited      # declared, not "unknown"
  3. ELSE -> kind = set, consumers = entry.consumers
  4. movable = (kind == set AND entry.consumers.length == 1 AND entry.keep == false)
```

**Anti-pattern:** deriving `movable` from the scan's citation count. Why: that is the FAFF-963 bug; a single scan-citation on a refer-back canonical block is a false positive. Movability is `single declared consumer AND not keep`, read from the manifest.

**duplication_candidates.** `buildReport` builds `duplication_candidates` from manifest entries where `movable` is true. A `keep: true` block never appears there even if it has one declared consumer.

**The optimistic floor stops lying.** With every block carrying a declared consumer set (or `"none"`/`keep`), the carried-token and floor figures are computed from declared data. There is no `unknown` bucket of core blocks masquerading as reclaimable; the reclaimable figure counts only `movable` (single-consumer, not-keep) blocks. When the manifest is complete (the lint enforces completeness), no block is silently treated as reclaimable-because-uncited.

**seed-if-absent + merge-preserving update.** The plain summary: never lose a human edit; only add what is genuinely new.

```
PROCEDURE syncManifest(blocks, matrix, path):
  1. existing = loadManifest(path)                       # null when absent
  2. IF existing is null:
     a. write a fresh manifest: one seedEntry(block, matrix) per block, in gateway order
     b. RETURN { added: all titles, preserved: 0 }
  3. added = []
  4. FOR each block in blocks:
     a. IF existing.byTitle has block.title -> keep the existing entry verbatim (preserved++)
     b. ELSE -> append seedEntry(block, matrix); added.push(block.title)
  5. do NOT delete entries for blocks no longer in the gateway   # the lint reports those; deletion is a human edit
  6. write the merged manifest (existing entries byte-stable, new seed entries appended)
  7. RETURN { added, preserved }
```

**Anti-pattern:** rebuilding the manifest from the scan on every emit. Why: that discards human corrections — the clobber-on-reseed bug the ticket calls out. `emitManifest`'s unconditional `writeFileSync` is replaced by `syncManifest`.

**Usage-drift check (one-directional, advisory).**

```
PROCEDURE driftCheck(blocks, matrix, manifest):
  warnings = []
  FOR each block with a manifest entry whose consumers is an array:
    scanned = matrix.get(block.title)            # the scan's guessed citer set
    FOR each skill in scanned NOT in entry.consumers:
      warnings.push("scan now sees " + skill + " citing '" + block.title + "', not in the manifest — reconcile")
  # manifest listing a consumer the scan does not see is EXPECTED (implicit/refer-back usage); never warned
  RETURN warnings
```

Rationale for one-directionality: the manifest exists precisely to record usage the scan cannot see, so "manifest has more than the scan" is the normal, correct state and must be silent; only "scan sees a citation the human has not folded in" is a reconcile signal.

**CI lint in `validate-adapters.js`.** A new inline pass, `lintGatewayManifest`, added among the existing sequential passes (following the `eval/seam-registry.json` precedent). Because `validate-adapters.js` is CJS and `prefix-planner.mjs` is ESM, and to keep the gateway-heading parse single-source, the lint shells out to the planner's `--check-manifest` mode synchronously and folds the result in.

```
PROCEDURE lintGatewayManifest(root):
  1. plannerPath = <root>/eval/prefix-planner.mjs
  2. TRY result = execFileSync(process.execPath, [plannerPath, "--check-manifest", "--json"])
  3. CATCH err:
     a. IF err.status == 2 -> print "FAIL  eval/baselines/gateway-usage.json (manifest missing/unparseable)"; RETURN 2   # fail-loud, mirrors seam-registry
     b. IF err.status == 1 -> parse err.stdout as { structural, reference };
        print one "FAIL ..." line per violation; set failed = true
     c. ELSE -> RETURN 2   # unexpected planner failure is a harness fault
  4. exit-0 path -> print "pass  gateway-usage manifest"
```

Structural + reference violations the `--check-manifest` mode reports (from `checkManifest`):

```
PROCEDURE checkManifest(blocks, manifest):
  structural = []; reference = []
  gatewayTitles = set(blocks.title)
  manifestTitles = set(manifest.blocks.title)
  FOR title in gatewayTitles NOT in manifestTitles: structural.push("gateway block '" + title + "' has no manifest entry")
  FOR title in manifestTitles NOT in gatewayTitles: structural.push("manifest entry '" + title + "' names no gateway block")
  realSkills = set(dir names under plugin/skills)
  FOR each entry with an array consumers:
    IF entry.consumers is empty: structural.push("entry '" + entry.title + "' has an empty consumer set and keep!=true")
    FOR skill in entry.consumers NOT in realSkills: reference.push("entry '" + entry.title + "' names nonexistent skill '" + skill + "'")
  FOR each entry: IF consumers is neither array/"all"/"none" AND keep != true: structural.push("entry '" + entry.title + "' has no consumer set and no keep")
  RETURN { structural, reference }
```

**Behaviour on a skill change (the update-vs-reconcile boundary).**

| Skill change | Behaviour |
|---|---|
| Structural: a gateway block added, renamed, or deleted | `--check-manifest` (in CI) fails until the manifest has a matching entry and no entry names a dead block or skill. `--emit-manifest` appends a seed entry for a genuinely new block; a rename reads as one add + one dead entry, both surfaced for a human to reconcile. |
| Usage: a skill starts or stops needing a block | `--drift` warns (`scan now sees skill X citing block Y, not in the manifest — reconcile`); a human folds it into the declared set. CI is not failed by usage drift. |
| Implicit usage: a skill relies on a block without naming it | Not auto-detectable; captured only by the human-owned declared set. Neither lint nor drift can see it — the reason the manifest is authoritative rather than derived. |

**Failure modes.**

- **The failure:** the two gateway-heading parses (planner's `segmentGateway` and any parse the lint carries) diverge, producing phantom structural drift that fails CI on a correct manifest. **How you'd know:** `--check-manifest` reports a block missing from the manifest that a human can see is present under a slightly different heading string. **What it means:** the mitigation (lint shells out to the planner's own `--check-manifest`, so there is exactly one parser) removes this; if a divergence still appears, the normalisation applied to titles is the confound to inspect. Proceed with the single-parser design.
- **The failure:** re-seeding silently reorders or rewrites existing entries, losing human edits. **How you'd know:** a `git diff` on `gateway-usage.json` after `--emit-manifest` shows changes to lines other than newly-appended entries. **What it means:** `syncManifest` must leave existing entries byte-stable; a diff touching them is a defect. A DONE item asserts a no-op `--emit-manifest` on a complete manifest produces an empty diff.
- **The failure:** title normalisation makes two distinct headings collide to one manifest key. **How you'd know:** `checkManifest` reports a count mismatch, or two gateway blocks map to one entry. **What it means:** the manifest key is the exact heading text (not the 12-char-truncated scan needle); keep the key un-truncated. Proceed.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the gateway contains "Delivery outcome (fixed)" and the manifest declares it keep:true with consumers ["faffter-noon-ship","faff-graft","faffter-noon-concurrency-sequential","faffter-dark-concurrency-parallel","faffter-dark-authoring-adaptors"]
When node eval/prefix-planner.mjs --json is run
Then "Delivery outcome (fixed)" does NOT appear in duplication_candidates
```

```
Given a manifest entry for a block declares consumers ["faff-prep"] and the title scan finds two citers for it
When node eval/prefix-planner.mjs --json is run
Then the block is classified with consumers ["faff-prep"] (the declared set), not the scanned two
```

```
Given a complete, human-verified manifest and an unchanged gateway
When node eval/prefix-planner.mjs --emit-manifest eval/baselines/gateway-usage.json is run
Then git diff eval/baselines/gateway-usage.json is empty
```

```
Given the gateway gains a new "## Foo bar baz" block with no manifest entry
When node eval/prefix-planner.mjs --check-manifest is run
Then it exits non-zero and names "Foo bar baz" as a gateway block with no manifest entry
```

```
Given a manifest entry names a consumer skill "faff-nonexistent" that has no plugin/skills dir
When node plugin/skills/faff/bin/faff validate-adapters is run
Then the run fails (non-zero exit) and prints a FAIL line naming the nonexistent skill
```

```
Given a manifest entry declares consumers ["faff-prep"] and the scan additionally sees "faff-graft" citing that block's title
When node eval/prefix-planner.mjs --drift is run
Then it prints a reconcile warning naming faff-graft and that block, and exits 0
```

## 6. Design Decision Rationale

**Where does authoritative classification come from — the scan, a gateway per-block tag, or a declared manifest?**
- Scan only: the status quo, the bug. Rejected.
- Per-block machine tag in the gateway: captures `(fixed)`/keep but not consumer sets, and still cannot express implicit usage. Rejected as insufficient and as gateway-content churn.
- **Chosen:** a declared, human-owned manifest the planner reads. Rationale: it is the only option that captures consumer sets, keep intent, and usage the scan cannot see, in one human-editable place — the answer to both of the ticket's open questions.

**File format — JSON or YAML?** **Chosen:** JSON at the existing `eval/baselines/gateway-usage.json`. Rationale: the tool already writes it there; no new parser; `validate-adapters.js` reads JSON baselines already.

**How does emit-manifest avoid clobbering human edits?** **Chosen:** `syncManifest` = seed-if-absent, else merge-preserving (existing entries byte-stable, new blocks appended as seeds, deletions left for the lint to flag). Rejected: unconditional rewrite (the clobber bug); auto-deleting stale entries (deletion is a human call).

**Where does the CI lint run, and how does CJS reach the ESM planner?** **Chosen:** a `lintGatewayManifest` pass in `validate-adapters.js` that shells out via `execFileSync(process.execPath, [plannerPath, "--check-manifest", "--json"])`. Rationale: keeps `validate-adapters` synchronous (no change to `cmdValidateAdapters`'s return contract or its callers/tests), keeps the gateway-heading parse single-source in `segmentGateway`, and follows the existing exit-2 fail-loud precedent. Rejected: making `cmdValidateAdapters` async to `import()` the ESM (ripples to every caller and the five test files); duplicating the heading regex in the lint (two parsers that can diverge — the first failure mode above).

**Drift check directionality.** **Chosen:** warn only when the scan sees a citer the manifest lacks; stay silent when the manifest lists more than the scan. Rationale: the manifest's purpose is to record usage the scan misses, so manifest-superset is the correct steady state.

**Existing test.** `test/eval-prefix-planner.test.mjs` asserts a `(fixed)` block classifies as single-consumer `set` — the pre-fix behaviour. **Chosen:** update the test to supply a manifest fixture and assert manifest-authoritative classification plus `keep` exclusion from `duplication_candidates`. Rationale: the old assertion locks in the bug; `buildReport`'s scan-fallback path (manifest = null) stays covered for back-compat.

**Seeding the initial manifest.** **Chosen:** seed `gateway-usage.json` from the verified 61-block matrix attached to the ticket, mapping the comment's shorthand consumer names to canonical `plugin/skills/<dir>` names, marking Band A as `consumers:"all", keep:true`, Band B as `consumers:"none"`, Band C with its declared lists and `keep:true` on the `(fixed)`/canonical blocks, all `source:"verified"`. Rationale: the matrix is the human-verified ground truth this ticket exists to make durable.

Temporal anchor: at the time of writing, `validate-adapters.js` is synchronous CJS and `prefix-planner.mjs` is dependency-free ESM; the shell-out decision can be revisited if the CLI dispatch migrates fully to async handlers.

## 7. Open Questions and Assumptions

**Open Questions.** None. The ticket's two open questions ("detect refer-back in the scan vs tag blocks machine-readably" and "should classification take the manifest as a third input") are both resolved by the declared-manifest design: the manifest is the authoritative input, and keep/refer-back intent is declared there rather than detected or tagged in the gateway.

**Assumptions.**

- **Assumes:** `estimateTokens` remains importable from `eval/cli-driver.mjs` by `prefix-planner.mjs`. Validate: the existing `import { estimateTokens } from "./cli-driver.mjs"` at the top of `prefix-planner.mjs` still resolves.
- **Assumes:** `process.execPath` (the node binary) is available to `validate-adapters.js` at CI time. Validate: `validate-adapters` already runs under node in `.github/workflows/validate.yml`, so `process.execPath` is populated.
- **Assumes:** the verified 61-block matrix comment on FAFF-963 corresponds 1:1 to the current gateway's H2/H3 block set. Validate: run `--check-manifest` after seeding; any block-set mismatch surfaces as structural drift to reconcile before the manifest is marked complete.

## 8. DONE — Definition of Done

### From WHY
- [ ] The four previously-flagged sole-consumer blocks (`Delivery outcome (fixed)`, `Tracker as the lights-out control plane`, `Install health (doctor-at-entry)`, `Workable vs terminal states`) no longer appear in `duplication_candidates`.
- [ ] The reported reclaimable/optimistic figure counts only `movable` (single declared consumer, not keep) blocks; no uncited-core block is counted as reclaimable.

### From WHAT (types and interfaces)
- [ ] `eval/baselines/gateway-usage.json` matches the new schema (`_schema`, per-block `consumers` as array/`"all"`/`"none"`, `keep`, optional `keep_reason`, `source`).
- [ ] The manifest is seeded from the verified 61-block matrix with canonical `plugin/skills/<dir>` consumer names and `source:"verified"`.
- [ ] `--json`, `--emit-manifest <path>`, `--drift`, and `--check-manifest [--json]` invocations behave as tabulated.

### From HOW (behaviour)
- [ ] `buildReport` classifies each block from its declared manifest entry (manifest-authoritative), recomputing token counts live; `movable = single declared consumer AND keep==false`.
- [ ] The title scan (`scanUsage`) is used only to seed entries and to feed `driftCheck`; it never overrides a declared consumer set.
- [ ] `syncManifest` writes a fresh seed when the file is absent and otherwise appends only new-block seed entries, leaving existing entries byte-stable.
- [ ] `driftCheck` warns only when the scan sees a citer absent from the declared set, and never when the manifest lists more than the scan.
- [ ] `lintGatewayManifest` runs inside `validate-adapters`, shells out to `--check-manifest`, folds structural/reference violations into the run's failure, and fails loud (exit 2) on a missing/unparseable manifest.
- [ ] Structural drift (block↔entry mismatch, dead block/skill reference, entry with neither consumers nor keep) fails CI; usage drift only warns.

### From HOW (edge cases)
- [ ] A no-op `--emit-manifest` against a complete, unchanged manifest produces an empty `git diff`.
- [ ] A gateway block added with no manifest entry fails `--check-manifest` with a naming message; a manifest entry for a nonexistent block or skill fails likewise.
- [ ] The manifest key is the exact heading text (not the 12-char scan needle), so distinct headings never collide to one entry.

### From tests
- [ ] `test/eval-prefix-planner.test.mjs` is updated to a manifest-authoritative expectation (a `(fixed)` block with `keep:true` is excluded from `duplication_candidates`), while retaining coverage of `buildReport`'s scan-fallback path when no manifest is supplied.
- [ ] New unit coverage for `checkManifest` (structural + reference violations) and `syncManifest` (seed-if-absent, merge-preserving).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. node eval/prefix-planner.mjs --emit-manifest eval/baselines/gateway-usage.json   # no-op on a complete manifest
  2. git diff --quiet eval/baselines/gateway-usage.json                                # empty diff
  3. node eval/prefix-planner.mjs --check-manifest                                     # exit 0
  4. node plugin/skills/faff/bin/faff validate-adapters                                # exit 0, includes "pass  gateway-usage manifest"
```

## Appendix A — Band-to-field mapping for seeding

| Verified band | `consumers` | `keep` |
|---|---|---|
| Band A — near-universal core | `"all"` | `true` (`keep_reason`: shared kernel) |
| Band B — gateway-entry-only (orientation prose) | `"none"` | `false` |
| Band C — lane/role-scoped, `(fixed)`/canonical | declared array | `true` (`keep_reason`: fixed-contract/canonical refer-back home) |
| Band C — lane/role-scoped, ordinary | declared array | `false` |

confidence: high
