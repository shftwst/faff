# FAFF-537 — `faff merge-gate` bare merge-method flag: accept it, or fail loud — never silently drop

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: high. Full spec on Linear FAFF-537.

This spec addresses FAFF-537 for the build agent and human reviewers. It fixes a CLI-ergonomics defect in `faff merge-gate` (the sole sanctioned `gh pr merge` path) where a bare top-level `--squash`/`--merge`/`--rebase` on argv is silently discarded, then `gh pr merge` fails with a message that points at gh's requirement rather than the real cause. The change is confined to the merge-method argv handling and its selftest — no floor, CI-observation, or integrity logic is touched.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate` reads the merge method from exactly one place — the value of `--merge-args` (`mergeArgsRaw = adrFlag(args, "--merge-args")`, `merge-gate.js:614`), validated against the closed `MERGE_FLAG_ALLOW` set (`:33`). Every other argv token is read ad-hoc by `adrFlag` (a `--flag value` index lookup) or `args.includes(...)`; there is **no** top-level unknown-flag rejection. So a bare `--squash` typed as a top-level flag is consumed by nobody and rejected by nobody — it evaporates.

**Problem statement.** An operator hand-driving a human-override merge passes the method as a bare `--squash` (the natural `gh`-shaped form); merge-gate drops it and calls `gh pr merge` with no method, which fails with `--merge, --rebase, or --squash required when not running interactively` — gh's generic requirement, not merge-gate's real cause. The operator reasonably believes they *did* pass `--squash`, and the correct form (`--merge-args "--squash"`) is not discoverable from the error. This change makes the bare form work and makes the no-method case fail with merge-gate's own actionable message.

**Design principles.**

- **Fail loud over silent drop.** faff's norm is that an unrecognised/ineffective flag errors rather than being quietly ignored (the same norm `MERGE_FLAG_ALLOW` already enforces on `--merge-args` tokens). A merge method that does not reach `gh` must never fail silently.
- **Lowest blast radius on the autonomous path.** The default `ship` producer always passes `--merge-args "--squash --delete-branch"` on the PR path, and `--merge-args` is inert in `--local` mode. The fix must not change behaviour for any caller that already passes a method via `--merge-args`.
- **Pure core, thin shell.** merge-gate is built as pure cores (`decideFloor`, `parseMergeArgs`, `classifyHeadShaChecks`) driven by a `--selftest` with no network, plus a thin impure gh/git shell. New method-resolution logic belongs in a pure helper so the selftest covers it, matching `parseMergeArgs`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node (CJS) | The file changed: `MERGE_FLAG_ALLOW`/`parseMergeArgs` (`:33`–`:39`), `cmdMergeGate` argv read (`:604`–`:647`), the `gh pr merge` spawn (`:716`), `mergeGateSelftest` (`:784`+, `parseMergeArgs` cases `:858`–`:864`) |
| `plugin/skills/faffter-noon-ship/SKILL.md` | Prose | The default `ship` producer — the autonomous caller; always passes `--merge-args "--squash --delete-branch"` (PR path), `--merge-args` inert in `--local` |
| FAFF-375 | Shipped | Prior `--merge-args` allowlist hardening (dropped `--admin`, fenced human-only flags) — the precedent for fail-loud flag handling here |
| FAFF-367 | Shipped | Added pure control-flow tests for merge-gate — the selftest/pure-helper pattern this fix follows |

**Scope statement.** A CLI-ergonomics fix at the merge-method argv boundary of the sole sanctioned merge path; it does not alter the integrity floor or which merges are allowed to land.

## 2. OUT OF SCOPE

- **Full reject-unrecognised-top-level-flags allowlist** — Why excluded: enumerating every accepted top-level flag (`--pr`/`--issue`/`--run-dir`/`--level`/`--merge-args`/`--repo`/`--branch`/`--base`/`--json`/`--local`/`--check-only`/`--execute`/`--interactive`/`--human-override`/`--allow-no-ci`/`--selftest`) and rejecting anything else is a higher-blast-radius change (an accepted-but-ignored flag like `--execute` must stay tolerated) for a Low-priority ergonomics bug; the empty-method guard already converts the reported symptom (and a mistyped `--sqush`) into an actionable error. Extension point: a future `cmdMergeGate` argv-allowlist pass could add it, reusing the same pure-helper + selftest shape.
- **`--local` (git-only) mode bare-flag handling** — Why excluded: `--local` lands the merge via a `git update-ref` compare-and-swap, never `gh pr merge`; `--merge-args` is inert there, so a bare method flag causes no cryptic failure and needs no actionable guard. Extension point: `cmdMergeGateLocal` (`merge-gate.js:489`) if a method ever becomes meaningful locally.
- **`--delete-branch` / `--auto` as bare flags** — Why excluded: these are merge *modifiers*, not methods; a bare `--delete-branch` is not the reported friction and gh does not require one. They remain `--merge-args`-only. Extension point: the same bare-flag collector if a future need arises.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| merge method | One of `--squash` / `--merge` / `--rebase` — the mutually-exclusive `gh pr merge` strategy flags |
| merge modifier | `--delete-branch` / `--auto` — non-method flags in `MERGE_FLAG_ALLOW` |
| bare flag | A merge-method flag passed as a top-level argv token (e.g. `... --execute --squash`) rather than inside `--merge-args "..."` |

**New constant.** A method sub-set of the existing allowlist, defined alongside `MERGE_FLAG_ALLOW`:

```
MERGE_METHOD_FLAGS = { "--squash", "--merge", "--rebase" }   # methods only; modifiers excluded
```

**New pure helper.** Resolves the effective merge flags from both sources and reports conflict / method-presence:

```
FUNCTION resolveMergeFlags(args, mergeArgsRaw) -> RECORD:
  parsed          : { flags, rejected }        # = parseMergeArgs(mergeArgsRaw), unchanged
  flags           : List<String>               # union of parsed.flags + bare method flags on args, de-duplicated, order-stable
  rejected        : List<String>               # = parsed.rejected (bad --merge-args tokens; unchanged semantics)
  methods         : Set<String>                # the distinct MERGE_METHOD_FLAGS members present in flags
  conflict        : Bool                        # methods.size > 1
  method_present  : Bool                        # methods.size >= 1

  CONSTRAINT: only tokens in MERGE_METHOD_FLAGS are harvested from args (a bare --delete-branch on argv is ignored, as today)
  CONSTRAINT: pure — depends only on (args, mergeArgsRaw); no I/O
```

## 4. HOW — Behavior

**Architecture and approach.** Replace the direct `parseMergeArgs(mergeArgsRaw)` call in `cmdMergeGate` (`:646`) with `resolveMergeFlags(args, mergeArgsRaw)`. The helper unions the `--merge-args` flags with any bare method flags found on argv, dedupes, and computes `conflict`/`method_present`. `cmdMergeGate` then applies three checks; the eventual `gh pr merge` spawn continues to receive `...resolved.flags` exactly as it received `...parsedMerge.flags` before.

```
PROCEDURE cmdMergeGate merge-method resolution (replaces the :646-:647 parse block, PR path):
  1. resolved = resolveMergeFlags(args, mergeArgsRaw)
  2. IF resolved.rejected is non-empty:
     a. stderr: "faff merge-gate: unrecognised --merge-args token(s): <rejected> (allowed: <MERGE_FLAG_ALLOW>)"
     b. RETURN 2                              # unchanged message + exit for bad --merge-args tokens
  3. IF resolved.conflict:
     a. stderr: "faff merge-gate: conflicting merge methods <methods> — pass exactly one of --squash/--merge/--rebase"
     b. RETURN 2
  4. carry resolved.flags forward (same variable role parsedMerge.flags had)

PROCEDURE empty-method guard (immediately before the `gh pr merge` spawn, :716):
  # reached only when: not --check-only (returned :709), not already-MERGED (returned :681),
  # and verdict merge-ok OR human-override fall-through — i.e. we are about to merge for real.
  1. IF NOT resolved.method_present:
     a. stderr: "faff merge-gate: no merge method — pass one via --merge-args \"--squash\" (or --merge/--rebase), or as a bare --squash/--merge/--rebase flag"
     b. RETURN 2                              # merge-gate's own actionable error, BEFORE delegating to gh
  2. spawnSync("gh", ["pr","merge", pr, ...resolved.flags, "--match-head-commit", headSha], ...)   # unchanged
```

**Behavior summary.** A bare `--squash` now works (folded in); a mistyped or omitted method now yields merge-gate's own actionable error naming `--merge-args` before any gh call; two conflicting methods fail loud; a valid `--merge-args "--squash …"` is unchanged.

**Edge cases and error handling.**

- Bare method flag **and** `--merge-args` naming the *same* method → `methods` has one member (deduped) → proceeds, no conflict.
- Bare method flag **and** `--merge-args` naming a *different* method → `conflict` → exit 2.
- `--merge-args "--delete-branch"` (modifier only) + bare `--squash` → `flags = {--squash, --delete-branch}`, `method_present` true → proceeds.
- No method anywhere, `--check-only` → the empty-method guard is never reached (check-only returns at `:709` before the spawn); the verdict is still computed and returned. This is intended: check-only never calls gh.
- No method anywhere, already-MERGED PR → idempotent no-op returns at `:681` before the guard. Intended.
- Bad `--merge-args` token (e.g. `--admin`, `rm -rf /`) → still caught by `resolved.rejected` at step 2, exit 2, message unchanged (FAFF-375 behaviour preserved).

**Anti-pattern:** placing the empty-method guard at the top of `cmdMergeGate` instead of immediately before the spawn. Why: it would wrongly reject `--check-only` invocations (which legitimately need no method) and the already-merged idempotent no-op. The guard must sit on the about-to-merge path only.

**Anti-pattern:** harvesting all of `MERGE_FLAG_ALLOW` as bare flags. Why: bare `--delete-branch`/`--auto` are not the reported friction and gh needs no modifier; widening the bare surface adds blast radius for no benefit. Only `MERGE_METHOD_FLAGS` are harvested.

## 5. SCENARIOS

```
Given a PR-path merge-gate invocation about to execute (merge-ok or human-override)
When the merge method is passed as a bare top-level --squash (no --merge-args)
Then gh pr merge is spawned with --squash among its flags (the method is not dropped)
```

```
Given a PR-path merge-gate invocation about to execute
When no merge method is present via --merge-args or a bare flag
Then merge-gate exits 2 with its own error naming --merge-args, BEFORE any gh pr merge call
```

```
Given a merge-gate invocation
When a bare --squash and --merge-args "--rebase" name two different methods
Then merge-gate exits 2 with a conflicting-merge-methods error
```

- The resolution helper is pure (no I/O) and is exercised by `faff merge-gate --selftest` with no network, alongside the existing `parseMergeArgs` cases.

## 6. DESIGN DECISION RATIONALE

**Accept bare method flags, or reject all unrecognised top-level flags?** Options: (a) fold bare `--squash`/`--merge`/`--rebase` into the method set; (b) build a full top-level allowlist rejecting any unrecognised flag. (b) is more thorough on the fail-loud axis but higher-risk (must tolerate accepted-but-ignored flags like `--execute`, ongoing maintenance) for a Low-priority bug, and the empty-method guard already turns the concrete symptom — and a typo like `--sqush` — into an actionable error. **Chosen:** (a) accept bare method flags as aliases folding into the merge-flag set, paired with the empty-method guard — matches the operator's mental model, minimal blast radius (autonomous callers pass `--merge-args`, unaffected), and closes both RCA gaps.

**Where does the actionable no-method error fire?** Options: at argv-parse time, or immediately before the gh spawn. Parse-time would break `--check-only` (needs no method) and the already-merged no-op. **Chosen:** immediately before the `gh pr merge` spawn (`:716`), on the about-to-merge path only — the guard runs exactly when a missing method would otherwise reach gh.

**How is the resolution logic structured?** **Chosen:** a pure `resolveMergeFlags(args, mergeArgsRaw)` helper wrapping the unchanged `parseMergeArgs`, exported and selftest-covered — matching merge-gate's pure-core/thin-shell architecture and FAFF-367's precedent, so the bare-flag and empty-method paths are tested with no network.

**Two conflicting bare/`--merge-args` methods?** **Chosen:** fail loud (exit 2) — passing more than one distinct method is a bad invocation gh could not satisfy; surfacing it at the CLI boundary is clearer than letting gh reject it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the `gh pr merge` invocation at `merge-gate.js:716` remains the single spawn point for the PR-path merge, and `--check-only` (`:709`) and the already-MERGED no-op (`:681`) still return before it. Validation: read `cmdMergeGate` and confirm the three return points precede the spawn before placing the guard.
- **Assumes:** the default `ship` producer and all in-repo autonomous callers pass a method via `--merge-args` (never relying on a bare flag or no method). Validation: `grep -rn 'merge-gate' plugin/skills --include='*.md'` — confirmed at author time (`faffter-noon-ship/SKILL.md:41` passes `--merge-args "--squash --delete-branch"`).

## 8. DONE — Definition of Done

### From WHAT (types and interfaces)
- [ ] `MERGE_METHOD_FLAGS` (`--squash`/`--merge`/`--rebase`) is defined alongside `MERGE_FLAG_ALLOW`.
- [ ] `resolveMergeFlags(args, mergeArgsRaw)` exists, is pure (no I/O), and is exported from `merge-gate.js`.
- [ ] `resolveMergeFlags` unions `parseMergeArgs(mergeArgsRaw).flags` with bare `MERGE_METHOD_FLAGS` tokens on `args`, de-duplicated; only method flags are harvested from argv.

### From HOW (behaviour)
- [ ] A bare top-level `--squash` (no `--merge-args`) results in `--squash` being passed to `gh pr merge`.
- [ ] Reaching the `gh pr merge` spawn with no merge method present returns exit 2 with a merge-gate-authored message naming `--merge-args`, before any gh call.
- [ ] A bare method flag plus a different `--merge-args` method returns exit 2 with a conflicting-methods message.
- [ ] A bare method flag plus a `--merge-args` naming the same method proceeds (deduped, no conflict).
- [ ] An existing `--merge-args "--squash --delete-branch"` invocation behaves exactly as before (no regression).

### From HOW (edge cases)
- [ ] `--check-only` with no method still returns the computed verdict (the empty-method guard is not reached).
- [ ] A bad `--merge-args` token (e.g. `--admin`) still exits 2 with the unchanged unrecognised-token message.

### From SCENARIOS (selftest)
- [ ] `mergeGateSelftest` gains pure cases: bare `--squash` folds in; bare + same-method `--merge-args` dedupes; bare + different-method conflicts; no-method → `method_present` false.
- [ ] `faff merge-gate --selftest` passes with the new cases (no network).

**Integration smoke test:**

```
Run: faff merge-gate --selftest
Expect: exit 0, all checks "ok", including the new resolveMergeFlags cases.
(The end-to-end bare-flag → gh path is covered by the pure helper + selftest;
 the gh spawn itself stays out of the no-network selftest, per the module's convention.)
```
