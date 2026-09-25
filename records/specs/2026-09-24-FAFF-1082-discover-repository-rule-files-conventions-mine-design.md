# Discover repository rule files (`.claude/rules/`, `CLAUDE.md`) in `conventions mine`

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1082.

This is the buildable spec for Linear issue FAFF-1082. Audience: the build agent that will implement it, plus the human reviewers who gate it. It extends the existing convention miner in `plugin/skills/faff/bin/lib/conventions.js` to discover repository rule files and record them as a manifest, without touching the three style-convention keys that miner already resolves.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff conventions mine` today answers exactly three questions about a repo: how branches are named, how commit subjects read, how PR titles read. It does that by scanning a fixed list of standards docs and then falling back to git-history inference. Repository *rules* are a different axis entirely: binding, managed prose that governs every change (documentation standards, working rules, language conventions, an internal CLI). faff has no concept of them, so on a repo that carries them under `.claude/rules/`, the miner never sees them. This ticket adds a discovery pass that records which rule files exist, as a manifest emitted alongside the existing conventions, and nothing more.

**Problem statement.** A repo can carry binding rule files under `.claude/rules/managed/` and a `CLAUDE.md` that says those rules load automatically; under Claude Code the harness injects them into every session, so their absence from faff is invisible there. faff's lanes also run under other harnesses, where nothing injects them, so a build proceeds without the repository's binding rules ever reaching the convention resolver. This change makes `conventions mine` discover and record those files so a manifest of them exists in `.faff/conventions.json`.

**Design principles.**

- **Discovery only, never enforcement.** This ticket records which rule files exist. It does not read their prose for meaning, does not resolve them into any convention value, and does not feed them to a build lane. Consuming the manifest is separate, later work (see Out of Scope).
- **The three style keys must not shift.** `branch_naming`, `commit_subject`, and `pr_title` resolve today by a first-confident-hit scan across a fixed, ordered document list. Adding rule-file discovery must not add, remove, or reorder a single entry in that list, so a repo's resolved style conventions are byte-identical before and after this change. This principle would cause rejection of any implementation that folds rule files into `findStandardsDocs`.
- **Read-only and bounded, like its siblings.** The rule-file scan does the same kind of work the standards-doc scan does: `fs` inspection only, no network, no subprocess beyond what is already there, and a bounded walk that cannot run away on a deep or symlinked tree.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/conventions.js` | Node.js (CommonJS) | The miner this change extends: `findStandardsDocs`, `mineConventions`, `computeSourceFingerprint`, `validateConventionSet`, the cache read/write, and `cmdConventions` dispatch |
| `plugin/skills/faff/bin/faff` | Node.js | CLI entrypoint; requires `cmdConventions` (line 39) and wires `"conventions"` into the flat `COMMANDS` map (line 225). `--json` is parsed inside `cmdConventions`, not here |
| `plugin/skills/faff/bin/lib/profile.js` | Node.js | Comparator for the home-of-scan question: `profile mine` emits only, caller persists |
| `plugin/skills/faff/bin/lib/gates.js` | Node.js | Comparator: `gates discover` is stateless, persists nothing |
| `test/conventions-cache.test.mjs` | Node test runner (`.mjs`) | Existing test for this module; drives the real `bin/faff` via `test/helpers/run-cli.mjs` against `mkdtemp` fixtures |

**Scope statement.** This sits in faff's "repo archaeology" family (conventions, infra profile, CI gates) as a new discovery pass inside the existing `conventions mine` verb, recording a rules manifest into the same `.faff/conventions.json` cache the style keys already use.

## 2. OUT OF SCOPE

- **Enforcing or consuming rules during a build.** Excluded because the ticket is discover-and-record only. Extension point: a future issue reads the `rules` manifest from `.faff/conventions.json` and injects it into the build lanes' context under harnesses that do not auto-inject it.
- **Parsing rule-file prose into convention values.** Excluded because a rule file has no fixed vocabulary and this change must not affect the three resolved style keys. Extension point: if a rule file ever needs to *state* a branch or commit convention, that belongs in the existing standards-doc scan path (`scanDocs` / `matchDocForKey`), governed by its own ticket and its own precedence review.
- **A separate top-level discovery verb (`conventions rules`, `rules discover`).** Excluded because the acceptance criterion binds discovery to `conventions mine --json` output; a new verb would need its own `COMMANDS` entry and would not satisfy the acceptance as written. Extension point: `cmdConventions` dispatch in `conventions.js` if a dedicated read-back verb is ever wanted.
- **Content hashing of rule files for change detection.** Excluded because the existing fingerprint uses stat metadata (size + mtime), and matching that is sufficient. Extension point: `computeSourceFingerprint` could later add a content digest per rule file if stat-only invalidation proves too coarse.
- **Sibling tracker-template work (FAFF-1083) and the adjacent open tickets** FAFF-1060 (unified repo+tracker scan), FAFF-451 (repo-map carrier), FAFF-1085 (repo-specific ADR template). Excluded as independent scope; noted here so the build agent does not pull them in.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Rule file | A repository file that carries binding working rules: any `*.md` under `.claude/rules/` (at any depth), plus a root `CLAUDE.md` |
| Rules manifest | The ordered list of rule-file entries this change discovers, stored as a new top-level `rules` array on the conventions set |
| Rule-file entry | One manifest element, one per discovered file, in the same five-field shape as a convention entry |
| Style keys | The three existing convention keys `branch_naming`, `commit_subject`, `pr_title`, resolved by `resolveConvention` and unchanged by this ticket |

**Type definitions.**

```
RECORD RuleFileEntry:               # one per discovered rule file
  key: string                       # repo-relative POSIX path, unique within the manifest
                                    #   e.g. ".claude/rules/managed/documentation.md" or "CLAUDE.md"
  value: string                     # the same repo-relative path (identity and value coincide
                                    #   for a discovered artifact — both slots populated to satisfy the shape)
  source: "discovered"              # a rules-block-only source token; NOT a member of CONVENTIONS_SOURCES
  confidence: "high"                # existence is directly observed
  evidence: [ RuleEvidence ]        # exactly one entry

RECORD RuleEvidence:
  kind: "rule-file"                 # a rules-block-only evidence kind; NOT a member of CONVENTIONS_EVIDENCE_KINDS
  ref: string                       # the repo-relative path
  detail: string                    # e.g. "<rel> discovered as a repository rule file"

RECORD ConventionsSet (extended):
  schema: 3                         # bumped from 2 (was FAFF-1068)
  generated_at: Timestamp
  source_fingerprint: string        # now also covers rule files (see HOW)
  git_signal: { head, branches }
  branch_naming: ConventionEntry    # unchanged
  commit_subject: ConventionEntry   # unchanged
  pr_title: ConventionEntry         # unchanged
  rules: [ RuleFileEntry ]          # NEW — may be empty; deterministic order

  CONSTRAINT rules is an array (possibly empty), never absent on a schema-3 set
  CONSTRAINT every RuleFileEntry.key is unique within rules
```

**Data model — one entry per file, collected in a `rules` array.** The WHAT text of the ticket says "a rules manifest" (singular) and the acceptance says "every such file appears ... under the existing `{key, value, source, confidence, evidence}` shape" (one object per file). These reconcile as: the manifest *is* the array; each file is one entry in it.
**Chosen:** one `RuleFileEntry` object per discovered file, collected into a single top-level `rules` array on the conventions set.

**Structurally-separate block, not a fourth convention key.** The three style keys are governed by small fixed arrays (`CONVENTIONS_KEYS`, `CONVENTIONS_DEFAULTS`, `CONVENTIONS_VOCAB`) and `validateConventionSet` hard-rejects any `value` outside a key's closed vocabulary (line 475). A rule file's `value` is a path with no fixed vocabulary, so making rules a fourth key would force that value through the enum validator and break it. Keeping rules in a separate, shape-mirrored block leaves every existing array and the style-key validation untouched.
**Chosen:** rule entries live in a separate `rules` block validated by a dedicated `validateRuleManifest`, never as a member of `CONVENTIONS_KEYS` / `CONVENTIONS_VOCAB` / `validateConventionSet`'s key loop.

**Vocabulary for rule entries.** Because rule entries sit outside the style-key enums, they carry their own small vocabularies rather than bending the existing ones:

- `source` = `"discovered"`. None of `explicit | documented | inferred | default` cleanly means "this artifact exists"; `documented` conflates "a doc states a preference" with "a rule file is present". A new token in a rules-only set is clearer than overloading an existing one, and `CONVENTIONS_SOURCES` is left untouched.
- `evidence.kind` = `"rule-file"`, in a rules-only `RULE_EVIDENCE_KINDS`, leaving `CONVENTIONS_EVIDENCE_KINDS` untouched.
- `confidence` = `"high"`. Existence is directly observed, matching the documented-source precedent. `"low"` is reserved for `source: "default"` by the style-key validator and would be wrong here.

**Chosen:** rule entries use `source: "discovered"`, `evidence.kind: "rule-file"`, `confidence: "high"`, each defined in rules-block-only constants that do not modify the style-key enums.

**CLI surface.** No new verb, flag, or `COMMANDS` entry. `mineConventions` gains a `rules` field; `conventions mine` and `conventions mine --json` already print the whole set, so the manifest rides the existing plumbing. `conventions get` (per style key) and `conventions show` (deep-copies the stored set, then overlays only the three keys) are unchanged; `show` passes the `rules` field through untouched by construction.

## 4. HOW — Behaviour

**Architecture and approach.** Add a dedicated, self-contained scan that discovers rule files, map each to a `RuleFileEntry`, and attach the array to the set that `mineConventions` builds. Extend the fingerprint to cover rule files so the manifest invalidates when they change, and bump the schema so old caches re-mine. Do not touch `findStandardsDocs`, `scanDocs`, or any style-key resolution.

**Rule-file discovery — separate scan function.** Folding `.claude/rules/**/*.md` and `CLAUDE.md` into `findStandardsDocs` would let rule-file prose win or shift the first-confident-hit precedence for the three style keys and would reorder today's fixed document sequence. A separate function keeps the two axes independent.
**Chosen:** a new `findRuleFiles(root)`, structurally separate from `findStandardsDocs`.

```
PROCEDURE find_rule_files(root):
  1. out := []
  2. IF a regular file "CLAUDE.md" exists at root:
     a. out.push("CLAUDE.md")
  3. Walk ".claude/rules" recursively, bounded:
     a. budget := 5000; skip any symbolic link (dirs and files)
     b. for each regular file whose name ends ".md" (case-insensitive):
        push its repo-relative POSIX path
     c. sort the .claude/rules paths deterministically (alphabetic)
  4. Return out with duplicates removed, order preserved
     (CLAUDE.md first when present, then the sorted .claude/rules paths)
```

**Bounded recursive walk.** `walkDocsForNames` only targets `docs/` with a basename filter, so it is not reusable for a general recursive `.md` glob. A new bounded walk is required, mirroring the existing walk's safeguards: a `budget` cap and a symlink skip, deterministic sort.
**Chosen:** a new bounded recursive walk for `.claude/rules` (budget cap 5000, symlinks skipped, alphabetic order), not a reuse of `walkDocsForNames`.

**CLAUDE.md recorded independently.** `AGENTS.md` is already scanned by `findStandardsDocs`, and in many repos `CLAUDE.md` merely points at `AGENTS.md`. Deduplicating would require content-parsing heuristics ("does this file only import another?") that are fragile, and the two files load under different semantics. The manifest records file *presence and provenance*, not deduplicated prose, and the two files sit on different axes (style-doc scan vs rules manifest).
**Chosen:** `CLAUDE.md` is always recorded as its own rule-file entry when present, with no dedup or flag against `AGENTS.md`.

**Mapping to entries.**

```
PROCEDURE scan_rule_files(root):
  1. rels := find_rule_files(root)
  2. return rels.map(rel => {
       key: rel,
       value: rel,
       source: "discovered",
       confidence: "high",
       evidence: [ { kind: "rule-file", ref: rel,
                     detail: `${rel} discovered as a repository rule file` } ]
     })
```

**Home for the scan — `conventions mine`, reusing the fingerprint cache.** The ticket's own WHAT ("extend the standards-doc scan in `conventions.js`") and acceptance ("when `faff conventions mine --json` runs, every such file appears in the emitted output") both bind discovery to `conventions mine`. The manifest changes whenever a rule file changes, which is exactly what `conventions mine`'s fingerprint-keyed `.faff/conventions.json` cache exists to track; `profile mine` (emit-only) and `gates discover` (stateless) do not persist and so would not satisfy the acceptance without extra wiring.
**Chosen:** rule discovery runs inside `mineConventions` and is persisted into the existing `.faff/conventions.json` cache, not a separate verb and not a stateless emit.

```
PROCEDURE mine_conventions(root, cfg):        # extends the existing function
  1. set := { schema: 3, generated_at: now() }
  2. set.source_fingerprint := compute_source_fingerprint(root, cfg)   # now covers rule files
  3. set.git_signal := cheap_git_signal(root)
  4. set.branch_naming := resolve_convention(root, "branch_naming", cfg)   # unchanged
  5. set.commit_subject := resolve_convention(root, "commit_subject", cfg) # unchanged
  6. set.pr_title := resolve_pr_title(root, cfg, set.commit_subject)        # unchanged
  7. set.rules := scan_rule_files(root)        # NEW
  8. return set
```

**Cache fingerprint coverage and schema bump.** `computeSourceFingerprint` today digests `{docs, workflows, config}` by stat metadata. If a rule file changes but the fingerprint does not cover it, `conventions get`'s cache-hit path would serve a stale manifest. Because rules use a separate scan, the fingerprint needs a second stat-list.
**Chosen:** `computeSourceFingerprint` adds a `rules` stat-list (`findRuleFiles(root)` mapped to `[rel, statMeta]`), and `CONVENTIONS_SCHEMA` bumps `2 -> 3`.

```
PROCEDURE compute_source_fingerprint(root, cfg):   # extends the existing function
  docs      := find_standards_docs(root).map(rel => [rel, stat_meta(rel)]) sorted    # unchanged
  workflows := workflow_files(root).map(rel => [rel, stat_meta(rel)])                # unchanged
  rules     := find_rule_files(root).map(rel => [rel, stat_meta(rel)])               # NEW
  config    := dig(cfg, "conventions")                                               # unchanged
  return sha256(JSON.stringify({ docs, workflows, rules, config }))
```

Because the constant `CONVENTIONS_SCHEMA` is now `3`, `isUsableCache` (which tests `cache.schema === CONVENTIONS_SCHEMA`), `validateConventionSet`'s schema check, and `show`'s stale-fallback all follow automatically: any existing on-disk schema-2 cache reads as stale and re-mines. No separate edit is needed for those three call sites beyond the constant change; confirm each still references the constant rather than a literal `2`.

**Validation.** Add `validateRuleManifest(rules)` and call it from `validateConventionSet` after the style-key loop, so a schema-3 set with a malformed `rules` block fails validation without disturbing the style-key checks.

```
PROCEDURE validate_rule_manifest(rules):
  1. IF rules is not an array: return ["rules must be an array"]
  2. errors := []; seen := {}
  3. for each entry at index i:
     a. entry must be a non-array object, else record error, continue
     b. entry.key non-empty string; unique across the manifest (else "duplicate rule key")
     c. entry.value non-empty string
     d. entry.source === "discovered"
     e. entry.confidence === "high"
     f. entry.evidence is a length-1 array of { kind: "rule-file", ref: non-empty }
  4. return errors
```

**Edge cases and error handling.**

- **No rule files.** `.claude/rules` absent and no root `CLAUDE.md`: `find_rule_files` returns `[]`, `set.rules = []`. A schema-3 set with an empty `rules` array is valid.
- **`.claude/rules` exists but holds no `*.md`** (only sub-dirs, or non-markdown): manifest excludes them; `rules` may be `[]`.
- **Symlinked file or directory under `.claude/rules`**: skipped, exactly as `walkDocsForNames` skips symlinks, so a symlink loop cannot hang the walk.
- **Unreadable `.claude/rules` directory** (permission error): the walk swallows the read error to an empty result for that directory, never throws; matches the existing scanners' `try/catch` posture.
- **Read-only tree on the `get` path**: `resolveConventionCached` already wraps the cache rewrite in `try/catch`; a re-mine that now also computes `rules` inherits that safety unchanged.

**Anti-pattern:** adding `.claude/rules/**/*.md` or `CLAUDE.md` to `findStandardsDocs`. Why: it changes the ordered candidate list the three style keys scan first-hit-wins over, so a rule file's prose could win or reorder `branch_naming` / `commit_subject` / `pr_title` resolution, violating the "style keys must not shift" principle.

**Anti-pattern:** giving rule entries a `value` from `CONVENTIONS_VOCAB` or a `source` from `CONVENTIONS_SOURCES`. Why: those enums are closed and validated for the three style keys; rule entries use their own `"discovered"` / `"rule-file"` tokens in a separate block.

**Failure modes.**

- **The failure:** rule-file discovery silently bleeds into the style keys (the manifest and the enforced style conventions become coupled). **How you'd know:** the existing `conventions --selftest` doc-parse and tmp-repo cases, and a new selftest assertion that resolves the three keys on a fixture that also has `.claude/rules/*.md`, return a different value than the same fixture without rule files. **What it means:** abandon any approach that shares the scan list; the separate `findRuleFiles` is the corrective.
- **The failure:** the fingerprint does not cover rule files, so `conventions get` serves a stale manifest after a rule file changes. **How you'd know:** a test that mines, edits a rule file, then reads back via the cache-hit path and sees the old manifest. **What it means:** the `rules` stat-list in `computeSourceFingerprint` is mandatory, not optional.

## 5. Scenarios — main objectives, born verifiable

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo containing .claude/rules/managed/documentation.md and a root CLAUDE.md
When `faff conventions mine --json` runs
Then the emitted JSON has a top-level "rules" array
 And it contains an entry whose key is ".claude/rules/managed/documentation.md"
 And an entry whose key is "CLAUDE.md"
 And each such entry has source "discovered", confidence "high",
     and evidence [{ kind: "rule-file", ref: <that path> }]
```

```
Given a repo whose branch_naming / commit_subject / pr_title resolve to known values
 And .claude/rules/*.md files and a CLAUDE.md are then added to that repo
When `faff conventions mine --json` runs
Then branch_naming, commit_subject, and pr_title resolve to exactly the same
     value / source / confidence as they did before the rule files were added
```

- The emitted schema is `3`, and `validateConventionSet` accepts a freshly-mined schema-3 set (with a possibly-empty `rules` array) and rejects a schema-2 set as stale.

## 6. Design Decision Rationale

**Where does rule discovery live: `conventions mine`, or a separate verb?**
Options: (a) inside `conventions mine`, persisted to the existing cache; (b) a stateless `conventions rules` / `rules discover` verb, like `gates discover`; (c) an emit-only miner, like `profile mine`. The ticket's WHAT and acceptance both name `conventions mine --json` explicitly, and the manifest changes when a rule file changes, which is what the fingerprint cache tracks. A separate verb needs a new `COMMANDS` entry and does not satisfy the acceptance as written.
**Chosen:** inside `conventions mine`, persisted to `.faff/conventions.json` — it is the only option the acceptance criterion admits, and it reuses the change-detection the cache already provides.

**How is the manifest modelled: one entry per file, or one aggregate entry?**
The ticket says "a rules manifest" (singular container) but "every such file appears ... under the existing `{...}` shape" (one object per file). One aggregate entry cannot give each file its own source attribution.
**Chosen:** one entry per file, collected in a `rules` array — the array is the manifest, and each file keeps its own attribution.

**A fourth convention key, or a structurally-separate block?**
A fourth key drags rule entries through `CONVENTIONS_VOCAB` (closed enums) and `validateConventionSet`, which would reject a path-valued entry, and would force edits to every fixed array for a value that has no vocabulary. A separate block touches none of them.
**Chosen:** a structurally-separate, shape-mirrored `rules` block with its own validator — the enums stay closed and the style-key path is untouched.

**What vocabulary do rule entries carry?**
`source`: reusing `documented` conflates "a doc states a preference" with "a file exists"; a new `"discovered"` token is clearer and, in a separate block, costs nothing. `evidence.kind`: `"rule-file"` in a rules-only set. `confidence`: existence is observed, so `"high"`; `"low"` is validator-reserved for `default`.
**Chosen:** `source: "discovered"`, `evidence.kind: "rule-file"`, `confidence: "high"`, defined in rules-block-only constants.

**One scan list, or two?**
Folding rule files into `findStandardsDocs` would let them win or reorder the first-confident-hit resolution of the three style keys.
**Chosen:** a separate `findRuleFiles(root)` — the only way to guarantee the style keys do not shift.

**Is `CLAUDE.md` deduped against `AGENTS.md`?**
Dedup needs a fragile "does this file only import another?" heuristic; the two files load under different semantics and sit on different axes (style-doc scan vs rules manifest).
**Chosen:** record `CLAUDE.md` independently when present, no dedup or flag.

**Reuse a walker, or write a bounded one?**
`walkDocsForNames` is `docs/`-and-basename specific, not a general recursive `.md` glob.
**Chosen:** a new bounded recursive walk (budget 5000, symlinks skipped, deterministic order), mirroring the existing walk's safeguards.

**Does the fingerprint cover rule files, and does the schema bump?**
If the fingerprint ignores rule files, `get` serves a stale manifest after a rule file changes; the separate scan means a second stat-list is needed. The shape of the persisted set changes, so the schema must bump so old caches re-mine.
**Chosen:** add a `rules` stat-list to `computeSourceFingerprint` and bump `CONVENTIONS_SCHEMA` `2 -> 3`; `isUsableCache`, `validateConventionSet`, and `show`'s stale-fallback follow from the constant.

## 7. Open Questions and Assumptions

**Open Questions.** None. The ticket's headline "home for the scan" question is resolved by its own acceptance criterion (binds to `conventions mine --json`); see the first decision above.

**Assumptions.**

- **Assumes:** `test/helpers/run-cli.mjs` exists and spawns the real `bin/faff` for `.mjs` integration tests. Validation: confirm the file is present and that `test/conventions-cache.test.mjs` imports it before writing the new integration test; if it is absent, fall back to a `conventionsSelftest()` case as the acceptance evidence.

## 8. Already shipped against this surface

These Done siblings built the surface this ticket extends; they are related context, not a supersession (the premise still holds — none of them discovers `.claude/rules/` or `CLAUDE.md`). Do not redo their work.

- **FAFF-1041** (Done 2026-09-15) — built the standards-doc scan in `conventions.js` that this ticket extends. Committed spec: `records/specs/2026-09-13-faff-1041-discover-repo-conventions-branch-naming-commit-style-from-design.md`.
- **FAFF-1068** (Done 2026-09-21) — built the atomic fingerprint-keyed `.faff/conventions.json` cache (`mine` writes, `get`/`show` read with invalidation); this is the schema `2` and the cache the schema bump and the fingerprint extension above build on. Committed spec: `records/specs/2026-09-21-FAFF-1068-persist-conventions-cache-design.md`.
- **FAFF-1069** (Done) — `faff onboard` record-location scan.

Adjacent open tickets (not blockers, context only): FAFF-1060 (unified repo + tracker convention/template scan), FAFF-451 (repo-map carrier for prep), FAFF-1085 (adr slot honouring a repo-specific ADR template).

## 9. DONE — Definition of Done

### From WHY
- [ ] Running `faff conventions mine` on a repo carrying `.claude/rules/*.md` and/or `CLAUDE.md` records those files in a manifest; the same run on a repo with none produces an empty `rules` array, not a missing field or an error.
- [ ] The three style keys (`branch_naming`, `commit_subject`, `pr_title`) resolve to identical `value` / `source` / `confidence` on a fixture with and without rule files added (precedence-isolation principle).

### From WHAT (types and vocabulary)
- [ ] Each discovered file yields one `rules` entry with `{ key, value, source, confidence, evidence }`; `key` is the repo-relative POSIX path and is unique within the manifest.
- [ ] Rule entries carry `source: "discovered"`, `confidence: "high"`, and `evidence: [{ kind: "rule-file", ref: <path>, detail: <string> }]`.
- [ ] `CONVENTIONS_SOURCES`, `CONVENTIONS_EVIDENCE_KINDS`, `CONVENTIONS_KEYS`, `CONVENTIONS_VOCAB`, and `CONVENTIONS_DEFAULTS` are unchanged; rule vocabulary lives in rules-block-only constants.
- [ ] The persisted set uses `schema: 3`; `validateConventionSet` accepts a freshly-mined schema-3 set and rejects a schema-2 set as stale.

### From HOW (behaviour)
- [ ] `findRuleFiles(root)` discovers root `CLAUDE.md` (when a regular file) plus every `*.md` under `.claude/rules` at any depth, deterministically ordered, duplicates removed.
- [ ] `mineConventions` attaches the manifest as `set.rules`; `conventions mine` and `conventions mine --json` both emit it via the existing output plumbing (no new verb or flag).
- [ ] `computeSourceFingerprint` includes a rule-file stat-list, so changing a discovered rule file misses the cache and re-mines on the next `get`.
- [ ] `findStandardsDocs`, `scanDocs`, `matchDocForKey`, and the style-key resolution are not modified.
- [ ] `validateRuleManifest` is added and called from `validateConventionSet`; a malformed `rules` block fails validation without disturbing the style-key checks.

### From HOW (edge cases)
- [ ] Absent `.claude/rules` and absent `CLAUDE.md` yield `rules: []`; an unreadable `.claude/rules` directory yields `[]` without throwing.
- [ ] Symlinked files and directories under `.claude/rules` are skipped; the walk is bounded and cannot hang on a symlink loop or a deep tree.

### Acceptance (stop condition 5)
- [ ] A test asserts that, given a repo with `.claude/rules/*.md`, `faff conventions mine --json` output contains every such file under the `{key, value, source, confidence, evidence}` shape with a source attribution. This is a `conventionsSelftest()` case (tmp dir with `.claude/rules/*.md` and `CLAUDE.md`, asserting on the emitted entries) plus, when `test/helpers/run-cli.mjs` is present, a `.mjs` integration test driving the real CLI.

### Integration smoke test
```
PROCEDURE smoke():
  1. tmp := mkdtemp()
  2. write tmp/.claude/rules/managed/documentation.md  (any content)
     write tmp/CLAUDE.md                                (any content)
  3. run `faff conventions mine --json --root tmp`  -> parse stdout as JSON
  4. assert parsed.schema === 3
  5. assert parsed.rules is an array containing an entry
        with key ".claude/rules/managed/documentation.md"
        and an entry with key "CLAUDE.md"
     each with source "discovered", confidence "high",
        evidence[0].kind "rule-file"
  6. assert parsed.branch_naming / commit_subject / pr_title are present and unchanged
        vs mining the same tmp with the rule files removed
```

confidence: high
spec-review: approve
build-tier: complex

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
    { "marker": "assumes" }
  ] }
```
