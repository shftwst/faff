# FAFF-1068 spec: persist the .faff/conventions.json cache (mine writes, get/show read with invalidation)

> Spec: faffter-dark-nlspec · 2026-09-21 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1068.
> build-tier: standard

## Source and scope

This spec lifts and tightens the fully-specced "Slice 1: persist the cache" section of the FAFF-1060 spec (the comment "FAFF-1060 spec: unified repo + tracker convention/template scan, feeding onboard persistence and jot's create path", attached to FAFF-1060 on 2026-09-21). FAFF-1060 split into three ratified slices; this is Slice 1, the cache-persistence leg, which ships value on its own and blocks Slices 2 (FAFF-1069) and 3 (FAFF-1070). The design is settled and human-ratified, so this spec closes the one carried open question (cache invalidation input set) rather than re-opening the design.

Slice 1 is deliberately narrow: it persists the existing three-key style grammar plus an invalidation fingerprint. It does **not** add `record_locations` (Slice 2) or template reads (Slice 3).

## WHY

FAFF-1041 ("Discover repo conventions: branch naming, commit style from standards", Done, PR shftwst/faff#895) built the miner/resolver `plugin/skills/faff/bin/lib/conventions.js` for a three-key style grammar (`branch_naming`, `commit_subject`, `pr_title`) with a fixed precedence: explicit `.faffrc conventions.<key>` over documented over CI-gate-enforced over history-inferred over hardcoded default (ADR-0128/0129). ADR-0128 also designed a `.faff/conventions.json` cache and a mine-then-persist flow, but nothing writes it:

- `conventions get <key>` fully re-derives (a standards-doc scan plus a `git` subprocess) on every call.
- `conventions mine` emits the `faff-contract:conventions` block and writes no file.
- `conventions show` reads `.faff/conventions.json` (conventions.js line 467) and exits 2 on a malformed file, but the file is never created, so `show` only ever reports `.faffrc conventions:` overrides.

The cache is design-only. `faff-graft` is the sole consumer, calling `conventions get` at three points (SKILL.md lines 201, 245, 474), each a fresh doc scan plus `git` invocation. This slice makes the cache real so graft resolves the three keys once per run instead of re-deriving three times.

## WHAT — delta against FAFF-1041

FAFF-1041 shipped the miner, the resolver, the precedence model, the `mine`/`get`/`show`/`--selftest` verbs, the evidence grammar (`{ value, source, confidence, evidence }`), and `validateConventionSet` (hard-requiring `schema === 1`). This slice adds only:

1. `conventions mine` writes `.faff/conventions.json` atomically, at `schema: 2`, with a `source_fingerprint` and a diagnostic `git_signal`.
2. `conventions get <key>` reads the cache on a fingerprint match with no re-derivation; a miss re-derives (byte-identical to today) and refreshes the cache when writable.
3. `conventions show` reads the schema-2 cache; a schema-1 or torn file is treated as absent/stale.
4. `validateConventionSet` accepts schema 2.
5. `faff-graft` SKILL.md resolves all three keys once at run start and reuses the values for its three reads.

No new discovery source, no new key, no second discovery entry point (ADR-0128 requires future conventions to extend this CLI, not fork it).

## HOW

### Cache shape (`.faff/conventions.json`, schema 2)

```
{ schema: 2,
  generated_at: <ISO8601>,
  source_fingerprint: <sha256 hex over the build-stable scanned inputs>,
  git_signal: { head: <HEAD sha or null>, branches: <count of refs/heads> },
  branch_naming: { key, value, source, confidence, evidence: [...] },
  commit_subject: { ... },
  pr_title: { ... } }
```

The three style-key entries keep FAFF-1041's evidence grammar unchanged; `mineConventions` resolves them exactly as today. Only `schema`, `source_fingerprint`, and `git_signal` are added.

### The invalidation fingerprint (firming the carried open question)

**Chosen: `source_fingerprint` is a SHA-256 over the build-stable, human-controlled inputs, computed from stat metadata (not file content); the git head/branch-count is captured as diagnostic `git_signal` and is deliberately excluded from the fingerprint's hit test (decides: architecture).**

`source_fingerprint` = SHA-256 over a canonical JSON serialization of:

- **docs** — sorted `[relpath, size, mtimeMs]` for each file `findStandardsDocs(root)` returns (the documented-tier inputs).
- **workflows** — sorted `[relpath, size, mtimeMs]` for each `.github/workflows/*.ya?ml` file (the CI-gate-tier inputs `detectGateFixedValue` scans).
- **config** — the resolved `.faffrc conventions:` block (or null); already loaded during config resolution, so no extra read.

Rationale, and why the git signal is diagnostic rather than gating:

- **Two hard acceptance criteria constrain the hit test.** `get` must return the cached value "with no doc scan or git subprocess" on a match; and a single mine per run must feed all three graft reads with "no mid-build re-derive against a changed state." A live git head/branch-count recomputed on every `get` would break both: recomputing it is a git subprocess (against the first AC), and it drifts the instant graft creates its feature branch and commits (against the second), so a lazy read after the first commit would miss and re-derive against changed state.
- **Stat metadata keeps the hit test cheap and content-free.** Size plus mtime lets `get` detect a changed/added/removed standards doc or workflow with a `stat` alone, no content read (so "no doc scan" holds literally) and no git call. A false miss (an edit that preserves both size and mtime) is nearly impossible and would only cost one harmless re-derivation; a false hit is not reachable by an ordinary edit.
- **`git_signal` stays captured for observability and for the explicit refresh lever.** It records the head sha and branch count at mine time, honouring the recommended git-signal intent from the FAFF-1060 spec, without letting a build's own commits invalidate the run's frozen conventions. A history-only change (new commits flip an inferred value with no doc/config change) is picked up by `conventions mine --refresh`, which always rewrites, and by graft mining fresh at every run start.

**Chosen: invalidation is a `source_fingerprint` mismatch plus an explicit `mine --refresh`; a TTL is not used (decides: architecture).** A TTL refreshes on a timer even when nothing changed and goes stale between changes, so it is the weakest option; the fingerprint self-invalidates on the inputs that actually determine the resolved conventions, and `--refresh` is the manual override.

### `conventions mine [--refresh]`

```
set = mineConventions(root, cfg)          # three style keys, byte-identical to today
set.schema = 2
set.source_fingerprint = computeSourceFingerprint(root, cfg)
set.git_signal = cheapGitSignal(root)     # { head, branches }; failures -> { head: null, branches: 0 }
writeConventionsCacheAtomic(root, set)    # temp-then-rename; mkdir .faff if absent
emit the faff-contract:conventions block  # unchanged, now carrying schema 2
```

Atomic write: `mkdir -p .faff`, write `.faff/conventions.json.tmp-<pid>`, `fs.renameSync` onto `.faff/conventions.json` (the shipped pattern in `machine-id.js`), so a concurrent reader never sees a torn file. `--refresh` is accepted as a no-op-today flag that documents intent: `mine` already always rewrites, so `--refresh` and a bare `mine` behave identically; the flag exists so the invalidation lever is nameable from graft/onboard and by an operator.

### `conventions get <key>`

```
cache = readConventionsCache(root)                    # null on absent / unreadable / invalid JSON
if cache and cache.schema === 2 and cache[key]
   and cache.source_fingerprint === computeSourceFingerprint(root, cfg):   # stat + config only
     return cache[key].value                          # HIT: no doc scan, no history git subprocess
resolved = resolveConvention(root, key, cfg)          # MISS: re-derive, byte-identical to today
if cacheDirWritable(root): writeConventionsCacheAtomic(root, mineConventions-with-fingerprint)
return resolved.value
```

On a hit, `get` reads the cache and recomputes only the cheap stat-plus-config fingerprint. On a miss (absent, schema-1, torn, key missing, or fingerprint mismatch) it re-derives with the existing `resolveConvention` (so a repo with no cache is byte-identical to today, including the `-d/--default` and `--json` paths) and refreshes the whole cache when the directory is writable. A read-only tree simply re-derives every call, exactly as today.

### `conventions show`

`show` keeps its current shape: read `.faff/conventions.json`, overlay the `.faffrc conventions:` block, print the effective set, exit 3 when neither a cache nor an override exists. Changes:

- **Invalid JSON (torn)** — keep the shipped exit-2 malformed-file behaviour (mine's atomic write means this should not happen in practice).
- **Valid JSON but `schema !== 2`** (a schema-1 file from before this slice) — treat as absent/stale: fall through to the override-or-exit-3 path exactly as if no cache had been mined. Never crash.

### `validateConventionSet`

Change the schema check from `obj.schema !== 1` to `obj.schema !== 2`. The three style-key checks (vocabulary, source, confidence, evidence) are unchanged. `source_fingerprint` and `git_signal` are additive and not validated as structural requirements in this slice (they are cache metadata, not part of the resolved-convention contract).

### faff-graft wiring (the single mine per run)

graft is the sole consumer, reading `branch_naming` before worktree creation (line 201, main checkout), then `commit_subject` (line 245) and `pr_title` (line 474) inside the worktree, after the feature branch and build commits exist. To guarantee "a single mine per run feeds all graft reads (no mid-build re-derive against a changed state)":

- At run start (the line-201 site, main checkout), graft runs `conventions mine` once to write the cache, then resolves all three keys against that fresh cache and captures them into shell values (`branch_scheme` / `commit_scheme` / `pr_scheme`).
- The line-245 and line-474 sites use the captured `commit_scheme` / `pr_scheme` values instead of a fresh `conventions get`, so no mid-build read re-derives against the branch or commits graft itself created (which a worktree checkout's reset mtimes and moved HEAD would otherwise turn into a cache miss).

This is a wiring change to `faff-graft/SKILL.md` only; the resolved values and the emitted branch/commit/PR strings are byte-identical to FAFF-1041's behaviour on a repo that signals nothing.

## Assumptions

- **Assumes:** `.faff/` is gitignored (onboard's `gitignore-ensure` already covers it), so writing `.faff/conventions.json` never dirties the tree or ships in a PR.
- **Assumes:** `faff-graft` remains the sole `conventions get` consumer this slice needs to wire. A future second consumer would move the single mine to a run-dir/events seam (the FAFF-966 genesis pattern); that is noted as a later refinement, not a Slice 1 dependency.

## DONE

- [ ] `conventions mine` writes `.faff/conventions.json` atomically (temp-then-rename, mkdir `.faff` if absent); the file validates against a schema-2 `validateConventionSet`.
- [ ] `conventions get <key>` returns the cached value on a `source_fingerprint` match without a doc scan or a history `git` subprocess; a mismatch/absent/schema-1/torn cache re-derives byte-identically to today and refreshes the cache when the directory is writable.
- [ ] `conventions get <key>` output is byte-identical to pre-slice behaviour on a repo with no cache, including the `--json` and `-d/--default` paths (`branch_naming=issue-slug`, `commit_subject=conventional`, `pr_title=conventional` on this repo).
- [ ] `conventions show` reads the schema-2 cache; a schema-1 file or a torn file is treated as absent/stale and never crashes; invalid JSON keeps the exit-2 malformed behaviour.
- [ ] `validateConventionSet` accepts schema 2 and rejects other schemas.
- [ ] `faff-graft` resolves the three keys once at run start and reuses them for its three reads (no mid-build re-derive).
- [ ] `conventions --selftest` covers: mine-writes-file, get-reads-cache (a planted cache value with a matching fingerprint is returned, proving no re-derive), fingerprint-mismatch-re-derives, torn-file-treated-as-absent.
- [ ] A dedicated unit test (`test/conventions-cache.test.mjs`) exercises the `mine`/`get`/`show` CLI cache round-trip against tmp dirs; every existing conventions test stays green.
- [ ] Any `faff-graft/SKILL.md` growth past the `validate-adapters` baseline (860) is locked to the exact new size with a changelog note.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" } ] }
```
