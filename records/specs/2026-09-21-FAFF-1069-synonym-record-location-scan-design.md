# FAFF-1069 spec: synonym-tolerant record-location scan + onboard offer for the four missing keys

> Spec: faffter-dark-nlspec · 2026-09-21 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1069.
> build-tier: complex
> Revised 2026-09-21 — folded in six minor spec-review clarifications (evidence kind, confidence tiers, fingerprint depth, exact-basename equality, README traversal-safety, selftest cases, holdout wording).

Slice 2 of epic FAFF-1060 (unified repo + tracker convention/template scan). Lifts and tightens the FAFF-1060 spec's Slice 2 section, delta-scoped against FAFF-1041 (Done, the discovery engine) and the now-merged FAFF-1068 (schema-2 `.faff/conventions.json` cache). This spec builds only the record-location leg and the onboard offer; the cache spine and the three style keys are FAFF-1068/FAFF-1041 and unchanged. Slice 3 (jot template selection) is out of scope.

## Already shipped against this surface

- **FAFF-1041** (Done, PR shftwst/faff#895) built `conventions.js`: a miner/resolver for the three-key style grammar (`branch_naming`, `commit_subject`, `pr_title`) with the `{ value, source, confidence, evidence }` grammar and a fixed precedence ladder. `conventions mine | get | show | --selftest`.
- **FAFF-1068** (Done, PR shftwst/faff#916) made the cache real: `mine` writes `.faff/conventions.json` atomically at `schema: 2` with a `source_fingerprint`; `get` reads the cache on a fingerprint match (no doc scan / git subprocess) else re-derives; `show` reads schema 2, treats schema-1/torn as stale. `validateConventionSet` currently validates only the three style keys.

Verified in the tree at HEAD (eea5f520):
- `conventions.js`: `CONVENTIONS_SCHEMA = 2`; `CONVENTIONS_SOURCES = ["explicit","documented","inferred","default"]`; `CONVENTIONS_CONFIDENCES = ["high","medium","low"]`; `computeSourceFingerprint` covers standards docs + `.github/workflows/*` + the `.faffrc conventions:` block (stat + config, content-free); no `record_locations` anywhere.
- `config.js`: `TRACKING_KEYS` (lines 911-923) already admits all four newer keys (`prd_docs_path`, `prdr_docs_path`, `adr_superseded_docs_path`, `label_prefix`). `resolveDocsPath` (876-886) is the `docs/` then `doc/` ladder; `resolveAdrSupersededDocsPath` (898-899) falls back to the resolved ADR dir; `DEFAULTS["tracking.label_prefix"] = "faff"` (line 113).
- `faff-onboard/SKILL.md`: detect step (section 2) offers only `spec_docs_path`, `adr_docs_path`, `spike_docs_path`, and only when a path diverges from the ladder default; it never offers the four newer keys and never recognises a synonym-named store.

Delta to build: the record-location scan with synonym tolerance, its persistence into the schema-2 cache, the fingerprint extension so a moved record directory invalidates, and the onboard offer for the newer keys. No second discovery entry point; no CLI writer change.

## WHY

`/faff-onboard` under-serves an established repo: it offers three of seven record-location keys and only when a path diverges from the exact `docs/<kind>` ladder. A repo that keeps ADRs under `decisions/`, or superseded ADRs under `docs/adr/archived/`, or PRDs under a non-default directory, gets nothing detected, and `adr_superseded_docs_path` / `prd_docs_path` / `prdr_docs_path` / `label_prefix` are never offered at all. The FAFF-1068 cache spine exists to carry this; the writer allowlist already admits the keys. Only the scan and onboard's detect step are missing.

## Design principles (inherited from FAFF-1060, binding here)

- **Extend, do not fork.** All new discovery lands in `conventions.js` and its precedence model (ADR-0128). No second discovery CLI.
- **Never silently adopt.** A synonym-mapped hit is low-confidence, surfaced to the operator as a confirm, never auto-written. Mirrors the existing below-threshold-falls-to-default rule.
- **No-signal is a clean no-op.** A repo exposing no non-default record directories yields no offers and no writes, byte-identical to today. Explicit acceptance criterion.
- **CLI-only config writes.** onboard persists only through `faff config init`; the `config init` writer (`TRACKING_KEYS`) is untouched (keeps the `validate-adapters` lint green).

## WHAT: data and interfaces

### Cache shape — `record_locations` sub-object (schema stays 2)

`mineConventions` gains a `record_locations` sub-object on the existing schema-2 set. Six keys, each reusing the existing entry grammar:

```
record_locations: {
  adr_docs_path:            { key, value, source, confidence, evidence:[…] },
  adr_superseded_docs_path: { … },
  prd_docs_path:            { … },
  prdr_docs_path:           { … },
  spec_docs_path:           { … },
  spike_docs_path:          { … } }
```

**Chosen: reuse the existing `{ key, value, source, confidence, evidence }` grammar for record locations rather than inventing a second shape (decides: architecture).** The validator, the `show` printer, and onboard's read all extend rather than branch. `value` is the found directory path relative to repo root (trailing slash stripped, forward-slash separators), or the ladder default when nothing non-default is found.

**Chosen: schema stays 2; a mapped hit is `source: "synonym-mapped", confidence: "low"` (decides: architecture).** `record_locations` is additive to the FAFF-1068 schema-2 set, so the schema number does not bump. Sources for a record-location entry:

| source | meaning | onboard action |
|---|---|---|
| `explicit` | the `tracking.<key>` is already set in config | skip (already set) |
| `documented` | the ADR store README states the directory (README override) | offer as confirm |
| `synonym-mapped` | a directory basename matched a built-in synonym, non-default | offer as confirm |
| `default` | resolved to the ladder default (no non-default signal) | leave unset, no offer |

**Chosen: a distinct source vocabulary for record locations (decides: architecture).** Define `RECORD_SOURCES = ["explicit","documented","synonym-mapped","default"]`. The three style keys keep their own `CONVENTIONS_SOURCES` unchanged, so `synonym-mapped` never leaks into style-key validation. `validateConventionSet` validates `record_locations` when present: each key in the six-key set, each entry an object carrying `key` (equal to its record key), a non-empty string `value`, a `source` in `RECORD_SOURCES`, a `confidence` in `CONVENTIONS_CONFIDENCES`, a `synonym-mapped` entry carrying `confidence: "low"`, a non-`default` source citing at least one evidence entry, and evidence entries shaped like the style-key evidence (`kind` in the evidence-kind set, non-empty `ref`). A `default` entry needs no evidence.

**Chosen: reuse the existing evidence `kind` vocabulary, no new kind (decides: architecture).** A record-location hit (both `synonym-mapped` and `documented`) cites evidence with `kind: "doc-file"` (the directory path relative to root as `ref`, e.g. `{ kind: "doc-file", ref: "docs/adr/archived", detail: "…" }`) and an `explicit` hit cites `kind: "config-key"` — the existing `CONVENTIONS_EVIDENCE_KINDS = ["config-key","doc-file","history"]` set is reused unchanged, no `directory` kind is added.

**Chosen: confidence tiers for record-location entries (decides: architecture).** `explicit` → `high`; `documented` (README-stated) → `high` (mirrors the style-key `documented` tier); `synonym-mapped` → `low`; `default` → `low`. The validator pins `synonym-mapped` to `low` and `default` to `low`; `documented`/`explicit` carry `high`.

**Chosen: `record_locations` is optional in the validator for back-compat (decides: architecture).** A FAFF-1068-era schema-2 cache written before this slice carries no `record_locations` and stays valid (the three-key checks still pass). `mineConventions` from this slice onward always emits it. When onboard or `get` needs record locations from a pre-slice cache, the fingerprint extension below forces a re-mine, so the sub-object materialises on first read.

### Fingerprint extension (so a moved record directory invalidates)

The record-location scan reads the `docs/`/`doc/` directory *structure* (directory basenames), a new input class the FAFF-1068 fingerprint does not cover: adding, removing, or renaming a record directory changes the resolved `record_locations` but need not change any standards-doc file's stat.

**Chosen: extend `computeSourceFingerprint` to include a content-free record-directory signal (decides: architecture).** Add the sorted set of candidate record-directory relative paths under `docs/`/`doc/` (bounded, names only, no content read, no git subprocess) to the canonical fingerprint input. This keeps the "no doc scan or git subprocess on a `get` hit" contract (a bounded `readdirSync` of the record tree is neither) while making the cache self-invalidate when a record directory moves. A one-time consequence: an existing FAFF-1068 cache's fingerprint now mismatches once and re-mines, which is benign and correct.

The candidate set the fingerprint hashes must cover **exactly what `scanRecordLocations` inspects** — the immediate child directories under `docs/`/`doc/` **and** the immediate child directories of the resolved current-ADR directory (the nested superseded location). Otherwise a co-located superseded move (e.g. `docs/adr/archived` renamed to `docs/adr/retired`) would change the resolved `adr_superseded_docs_path` without changing the fingerprint, and the cache would not invalidate. Bound the listing to that fixed depth (top-level record dirs + the one nested ADR level), never a full recursive walk.

### Synonym set

**Chosen: a fixed built-in synonym floor, with the ADR store's own README able to add a term for that repo (decides: architecture).** A fixed list makes the common case work with zero config and is deterministic (the conventions.js determinism rule); the README override keeps a repo with non-standard vocabulary from being missed. Built-in floor (case-insensitive on the directory basename):

- current / active ADR store: `adr`, `active`, `accepted`, `current`, `decisions`
- superseded ADR store: `superseded`, `deprecated`, `archived`, `retired`, `historical`
- prd store: `prd`
- prdr store: `prdr`
- spec store: `spec`, `specs`
- spike store: `spike`, `spikes`

Matching is **exact case-insensitive basename equality**, never a substring test: `prd` is a substring of `prdr`, so a `prdr/` directory must map only to `prdr_docs_path`, never also to `prd_docs_path`. The scan compares `basename.toLowerCase()` against each synonym-set member for equality.

**README override (concrete).** Read the resolved current-ADR store's own `README*` (e.g. `docs/adr/README.md`). A directory name it states as the superseded store (a line naming a directory alongside a superseded synonym, e.g. "archived decisions move to `retired/`") is added to the superseded synonym set for this repo only. The override is additive to the built-in floor, never a replacement, and a README-named directory that actually exists maps as `source: "documented"`, `confidence: "high"` (stronger than a bare synonym hit). Keep the README parse deterministic and bounded (a single README read, a fixed pattern), no LLM seam. **Security:** the README-extracted term is used only as a **basename match token** compared for equality against directory basenames actually present under the resolved ADR store; it is never path-joined, resolved, or followed, so a `../`-style or absolute-path term in a README can direct nothing outside the scanned tree.

## HOW: behaviour

### The scan (`conventions.js`)

A new bounded, read-only scan `scanRecordLocations(root, cfg)` returns the six-key `record_locations` object. Per key:

```
resolve record location for <key>:
  explicit = dig(cfg, "tracking.<key>")
  if explicit set -> { source: "explicit", value: explicit, confidence: "high", evidence:[config-key] }
  else scan docs/ (then doc/) directory basenames against the key's synonym set:
    - a README-stated term (ADR keys) -> source "documented", confidence per the README hit
    - a built-in synonym match, non-default name -> source "synonym-mapped", confidence "low"
    - the ladder default name (e.g. docs/adr for adr_docs_path) present -> source "default"
    - nothing -> source "default", value = the ladder default (config.resolve*DocsPath, create=false)
```

Reuse the ladder defaults via the exported `config.js` resolvers (`resolveAdrDocsPath`, `resolveAdrSupersededDocsPath`, `resolvePrdDocsPath`, `resolvePrdrDocsPath`, `resolveSpecDocsPath`, `resolveSpikeDocsPath`, each with `create=false`) so the default `value` never diverges from what the rest of faff resolves.

**Co-located current + superseded ADR dirs (the collision edge).**

**Chosen: match the superseded ADR store scoped under the resolved current-ADR directory first, then repo-root fallback; the current-ADR match never claims its own superseded subdirectory (decides: architecture).** So a repo with `docs/adr/` (current) and `docs/adr/archived/` (superseded) maps `adr_docs_path = docs/adr` and `adr_superseded_docs_path = docs/adr/archived`, distinct keys, no collision. Concretely: resolve the current-ADR directory first; when scanning for the superseded store, look inside the resolved current-ADR directory for a superseded-synonym subdirectory before falling back to a repo-root/`docs`-level match, and exclude any superseded-synonym subdirectory from the current-ADR match.

`mineConventions` calls `scanRecordLocations` and attaches the result as `set.record_locations`; the `mine` verb persists it in the cache as today. `show` passes `record_locations` through when present. The three style keys and their resolution are unchanged.

### onboard offer (`faff-onboard/SKILL.md`, detect step)

The detect step (section 2) gains a deterministic record-location read in place of its prose "if an existing repository clearly keeps one of these stores elsewhere" heuristic:

```
run: faff conventions mine --json            # the scan; persists the gitignored cache
read record_locations from the JSON
for each of the six record keys:
  entry = record_locations[key]
  if entry.source == "explicit"                       -> skip (already set)
  if entry.source in { synonym-mapped, documented }
     and entry.value != the ladder default            -> offer as a confirm
  else                                                 -> leave unset (ladder default resolves it)
label_prefix: offer confirm-the-default ("Control-label prefix, use 'faff'? (y/n)")
```

Accepted values join onboard's single existing `faff config init` call (one `--set tracking.<key>=<value>` each). The four newer keys are already in `TRACKING_KEYS`, so no CLI change. onboard's existing bail / dry-run / one-confirm / write flow is unchanged; only the set of detected/offered keys widens, and the example key list + Rules "detected keys only" line in the SKILL.md are updated to include the four newer keys. A synonym-mapped store is never written without an explicit confirm (it rides the same dry-run-preview + confirm gate).

## Assumptions

- **Assumes:** `/faff-onboard` is interactive-only (its SKILL.md states this), so the confirm-each-detected-store prompts always have a human to answer; the autonomous pipeline never onboards, so no synonym hit is ever auto-persisted behind the operator's back.
- **Assumes:** writing the gitignored `.faff/conventions.json` during onboard's detect step (via `conventions mine`) is benign — `.faff/` is covered by onboard's own `gitignore-ensure` and the operator commits only `.faffrc.yaml`. The no-signal guarantee is therefore scoped precisely as **no `.faffrc` write and no offer** (not literally byte-identical filesystem state): onboard now runs `conventions mine` in its detect step, which writes the gitignored cache before `gitignore-ensure`, where no such write happened before. This is the one benign departure the holdout scenario tolerates.

## Scenarios

```
Given a repo with ADRs under docs/adr/ and superseded ADRs under docs/adr/archived/
When faff conventions mine runs
Then record_locations.adr_docs_path = { value: "docs/adr", source: "synonym-mapped"|"default", … }
     and record_locations.adr_superseded_docs_path = { value: "docs/adr/archived", source: "synonym-mapped", confidence: "low", … }
     as distinct keys with no collision
```

```
Given a repo whose ADRs live under decisions/ (a current-ADR synonym, non-default)
When onboard runs its detect step
Then it offers tracking.adr_docs_path=decisions as a confirm, and persists it only if the operator accepts
```

```
Given docs/adr/README.md stating "archived decisions move to retired/" and a docs/adr/retired/ directory
When the scan resolves adr_superseded_docs_path
Then retired/ is matched (README term added to the synonym set for this repo), source "documented"
```

```
Given a repo exposing no non-default record directories (only the ladder defaults, or none)
When onboard and the scan run
Then every record key resolves to source "default", no key is offered, and no config is written (no regression)
```

## DONE: definition of done

- [ ] `scanRecordLocations` maps synonym-named directories to `adr_docs_path`, `adr_superseded_docs_path`, `prd_docs_path`, `prdr_docs_path`, `spec_docs_path`, `spike_docs_path`; a mapped hit carries `source: "synonym-mapped", confidence: "low"`.
- [ ] A term named in the ADR store's README is added to the synonym set for that repo; a `--selftest` case covers a README-stated custom superseded term being matched.
- [ ] `mineConventions` emits `record_locations`; the `mine` verb persists it; `validateConventionSet` accepts a schema-2 set with `record_locations` and rejects a malformed record entry (bad source, missing evidence on a non-default source). A pre-slice schema-2 cache without `record_locations` stays valid.
- [ ] `computeSourceFingerprint` includes the content-free record-directory signal, so moving a record directory invalidates the cache; the `get`-hit contract (no doc scan / git subprocess) is preserved.
- [ ] Co-located current + superseded ADR directories map to distinct keys without collision (the current-ADR match excludes its own superseded subdirectory).
- [ ] onboard's detect step offers each detected non-default record-location as a confirm and `label_prefix` as confirm-the-default, persisting accepted values through one `faff config init` call (no `TRACKING_KEYS` change).
- [ ] A synonym-mapped store is never auto-written without a confirm.
- [ ] A repo exposing no non-default record directories produces no offers and no writes (holdout scenario).
- [ ] `conventions --selftest` extends with: synonym mapping (incl. a README-stated custom term), co-located current+superseded dirs distinct, no-signal repo = all defaults / no synonym-mapped entries, a mapped hit carries `source: "synonym-mapped", confidence: "low"`, a `doc/`-only repo (the `doc/` vs `docs/` ladder resolves and maps correctly), a README naming a directory that does not exist (no false-positive match), exact-basename equality (`prdr/` maps only to `prdr_docs_path`, never also `prd_docs_path`), and the `record_locations` validator cases (accepts a well-formed sub-object; rejects a bad `source`, a `synonym-mapped` entry not carrying `confidence: low`, and a non-`default` source with no evidence). All existing conventions / onboard / config tests stay green.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" } ] }
```
