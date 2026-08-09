# FAFF-442 — Split-parity harness must never write the shared git worktree registry

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-442.

This spec addresses FAFF-442 (Bug, blocks FAFF-441): the split-parity harness `scripts/verify-split-parity.mjs` runs `git worktree add/remove` against the real shared repo, and during the FAFF-440 graft that churn coincided with a calling linked worktree's admin dir vanishing mid-graft. Audience: the build agent implementing the fix, and human reviewers gating FAFF-441 (which runs this harness).

## 1. WHY — Problem and Principles

**The load-bearing model:** the harness consumes its baseline ref only as a plain file tree — `cpSync` input and a subprocess entrypoint — so it never needed a live worktree at all. `git archive <ref> -- plugin/skills/faff | tar -x` produces that same tree (proven byte-identical, executable bits intact) with **zero writes** to the shared `.git/worktrees/` registry. Replacing the two `worktree add` call sites with archive-based materialisation removes the entire hazard class structurally, rather than defending against one interleaving of it.

**Problem statement:** the harness's `gate()` registers and removes temp worktrees in the repo's shared registry — the same registry every live graft worktree depends on — and during FAFF-440 a caller's worktree admin dir vanished mid-graft while that churn ran. The exact race is **unreproduced** (sequential, concurrent, and racing repro attempts all came back clean on git 2.39.5); this change is honestly framed as removal of a design smell — touching a live shared resource the task structurally doesn't need — plus a durable invariant, not a confirmed-race fix. After this change the harness performs no worktree-registry operations at all, so the caller's worktree is intact by construction.

**Design principles:**

- **Eliminate, don't guard.** An implementation that keeps any `git worktree` verb in the harness and bolts on locking/detection is rejected — the fix is that the operation class no longer exists.
- **Fail closed, stay loud.** Every materialisation step that can fail (ref resolution, archive, extract) must raise `SetupFault` → exit 2, never a silent PASS.
- **No normalisation, no byte drift.** The materialised baseline must be byte-identical (content and mode bits) to what `worktree add` produced — a materialisation that changes bytes invalidates FAFF-441's gate.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `scripts/verify-split-parity.mjs` | Node (ESM) | The harness under change — `gate()` holds both call sites + cleanup |
| `test/helpers/seed-repo.mjs` | Node (ESM) | Prior art: only ever runs worktree ops inside repos it created in `mkdtempSync` — the convention `gate()` violated |
| `plugin/skills/faff/bin/faff` (`worktree-prune`) | Node | Independent corroboration that the registry-hazard class (admin-dir id de-dup suffixes) is real |

**Scope statement:** a surgical change to one script's setup/teardown plumbing plus its two canonical recipe copies; the parity matrix, comparator, and run-in-place swap are untouched.

## 2. OUT OF SCOPE

- **The bin/faff split itself (FAFF-441)** — this ticket only makes its gate safe to run.
- **Option (b), REPO_ROOT → common git dir** — proven a no-op: `git -C <main>` and `git -C <linked-worktree>` both register under the identical `<main>/.git/worktrees/` admin dir; there is nothing to change.
- **Option (c) as a refuse-gate** — with zero registry ops remaining, refusing to run from a linked worktree would over-block a now-safe invocation.
- **Reproducing/diagnosing the original corruption race** — three repro campaigns failed; if corruption recurs post-fix it is a different actor (see Failure modes); extension point: a fresh ticket against the graft flow or `worktree-prune`.
- **General worktree-hygiene tooling** — `faff worktree-prune` already owns that surface.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Shared registry | `<main-checkout>/.git/worktrees/` — the single admin dir git uses for every linked worktree, regardless of which checkout ran the command |
| Linked worktree | A checkout created by `git worktree add`, whose `.git` file points into the shared registry |
| Materialise | Produce a plain on-disk file tree for a ref's `plugin/skills/faff` subtree, consumed only by `cpSync` and as a subprocess entrypoint |

**Interface — the single new helper**, used by both ref-based call sites (baseline + optional `--candidate-ref`):

```
PROCEDURE materialiseRef(repoRoot, ref, destDir) -> srcFaffDir:
  # Contract: writes ONLY under destDir; performs ZERO git write operations of any kind.
  1. run: git -C repoRoot rev-parse --verify "<ref>^{commit}"
     IF exit != 0: raise SetupFault("--…-ref '<ref>' does not resolve to a commit")
  2. run: git -C repoRoot archive <ref> -- plugin/skills/faff
     capture stdout as raw bytes with an EXPLICIT large maxBuffer (see D5)
     IF exit != 0 OR spawn error: raise SetupFault (include git stderr)
  3. mkdir -p destDir; run: tar -x -C destDir  with step-2 bytes as stdin
     IF exit != 0 OR spawn error: raise SetupFault (include tar stderr)
  4. return path.join(destDir, "plugin", "skills", "faff")
```

`ref` is passed as a discrete argv element (no shell interpolation). The default candidate (the working tree, `cpSync`) is **unchanged**; only ref-based materialisation moves.

**Removed surface:** the `finally` block's two `git worktree remove --force` calls are deleted; cleanup is `rmSync(scratch)` alone. The harness ends with **zero** occurrences of the exact quoted argv literal `"worktree"` — and that invariant is **executed, not just greppable** (D8): the selftest reads the harness's own source and fails on any occurrence.

## 4. HOW — Behavior

**Approach:** inside `gate()`, replace the baseline block (verify → `worktree add` → join) with `baselineSrc = materialiseRef(REPO_ROOT, baselineRef, path.join(scratch, "baseline"))`, and the `--candidate-ref` block likewise. Delete `baselineWorktree` tracking and both `worktree remove` lines from `finally`. Everything downstream (`runParity`, comparator, coverage check) is untouched — it already consumes plain paths.

**Behavior summary:** after this change a gate run's only side effects outside `scratch` are git **reads** (rev-parse, archive) — safe from any checkout, main or linked.

**Edge cases and error handling:**

- Bad ref → step-1 `SetupFault`, exit 2 (unchanged message shape).
- `git archive` failure → `SetupFault` with git's stderr, exit 2. Terminal.
- `tar` missing / extract failure → `SetupFault` with details, exit 2. Terminal.
- Archive stream larger than the buffer cap → loud spawn error → `SetupFault`, exit 2 — never a truncated tree. **Anti-pattern:** relying on Node's default `spawnSync` maxBuffer (1 MiB) — the tar stream is already ~1.4 MiB; set it explicitly (D5).
- `--keep` unchanged: scratch retained; no registered worktree to leak, so `--keep` no longer strands registry entries even on SIGKILL.
- **Builder advisory (from spec-review):** `git rev-parse --git-common-dir` can return a *relative* path (e.g. `.git` from the main checkout) — resolve it against `REPO_ROOT` before the D4 readdir, else a cwd-dependent misresolution + the absent-dir→empty-set convention could make the invariance compare vacuous. (The linked-worktree DONE demo backstops this end-to-end.)

**Failure modes:**

- **The original corruption was never caused by the harness** (the race is unreproduced), so this change doesn't prevent recurrence. How you'd know: a graft worktree's admin dir vanishes again while the harness contains zero `git worktree` verbs (the executed invariant proves the alibi). What it means: the smell removal stands on its own; open a fresh investigation against the other registry writers.
- **Archive stops being byte-identical to a checkout** (someone adds `export-ignore`/`export-subst` attributes). How you'd know: FAFF-441's gate reports mismatches on file-reading rows. What it means: narrow — strip/guard the attributes; the Assumes item carries the validation.

## Scenarios

```
Given a repo with at least one linked worktree registered
When `verify-split-parity.mjs --baseline-ref HEAD` runs to completion from INSIDE a linked worktree
Then it exits 0 (self-parity PASS) and `git worktree list --porcelain` output is byte-identical before vs after
```

```
Given any valid commit ref
When the harness materialises it
Then the resulting plugin/skills/faff tree is byte-identical to that ref's committed tree, including the executable bit on bin/faff
```

- Assertion (executed): the harness's `--selftest` reads its own source and fails on any occurrence of the exact quoted argv literal `"worktree"` (concatenation-built needle) — the invariant is enforced by a run, not a reader.

## 6. DESIGN DECISION RATIONALE

- **D1 — How to materialise a ref?** Options: worktree add (status quo — writes the shared registry); clone into scratch (heavyweight); option (b) resolve REPO_ROOT to the common dir (**measured no-op**); `git archive | tar -x` (registry-clean, ~28 ms for the 1.3 MB subtree, verified byte-identical with mode bits preserved). **Chosen:** `git archive | tar -x` — the only option that deletes the hazard class instead of relocating it.
- **D2 — REPO_ROOT resolution?** **Chosen:** keep `SCRIPT_DIR`-based + a one-line "safe: only git reads" comment — simplicity over a no-observable-effect change.
- **D3 — Keep a detect as belt-and-braces?** **Chosen:** drop entirely — proportionate/minimal; regression protection is mechanical instead (D4/D8).
- **D4 — What does the selftest add?** **Chosen:** helper-level, measured on the resource that was actually corrupted: resolve the registry dir ONCE via `git rev-parse --git-common-dir` (resolve a relative return against `REPO_ROOT`) + path-join the literal `"worktrees"` (a different string from the argv token `"worktree"`); snapshot it via fs (sorted readdir entry names, absent-dir → empty set) before and after `materialiseRef(REPO_ROOT, "HEAD", <scratch>)`; assert snapshots identical, and the returned tree's `bin/faff` exists and is executable. No `git worktree` invocation anywhere. Residual (accepted): a concurrent build adding/removing a worktree during the selftest window could false-fail — the selftest runs interactively/CI where no concurrent grafts run; a false-fail is loud and re-runnable, never a false-pass.
- **D5 — Node pipe?** **Chosen:** two-step `spawnSync` — `git archive` capturing a Buffer with explicit `maxBuffer` (≥ 64 MiB), then `tar -x -C dest` with that Buffer as `input`. Each step fail-closed; ref stays a discrete argv element.
- **D6 — Recipe copies.** **Chosen:** header gains the run-locus note; a follow-up correction comment on FAFF-441 is a DONE obligation of this ticket's graft.
- **D7 — tar dependency.** **Chosen:** `tar` binary from the harness's ambient PATH. Missing tar → loud `SetupFault`.
- **D8 — Executed invariant, not convention grep (folded from the methodology critique; pinned by spec-review).** **Chosen:** the selftest reads `scripts/verify-split-parity.mjs`'s own source and fails on any occurrence of the exact quoted argv literal `"worktree"`. The needle is built by string concatenation (`'"work' + 'tree"'`) so the assertion never matches itself; the MATRIX row literals `"worktree-prune"`/`"worktree-root"` do not match the exact-quoted form; the fs path constant is `"worktrees"` (also different). No line-exclusion logic.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions.**

- **Assumes:** no `export-ignore`/`export-subst` gitattributes apply under `plugin/skills/faff`. Validation: `git check-attr export-ignore export-subst -- plugin/skills/faff/bin/faff plugin/skills/faff/SKILL.md` reports `unspecified` (verified true at spec time; no `.gitattributes` exists).
- **Assumes:** `tar` is on PATH in every environment that runs the harness. Validation: `command -v tar`; failure is a loud exit-2.

## 8. DONE — Definition of Done

### From WHY (the invariant)
- [ ] The harness contains zero occurrences of the exact quoted argv literal `"worktree"`, and the `--selftest` **executes** that check against its own source via a concatenation-built needle (fails loud on reintroduction of any `git worktree <verb>` call).

### From WHAT (interfaces)
- [ ] `materialiseRef` exists and both ref call sites (baseline + `--candidate-ref`) route through it; the default working-tree candidate path is unchanged.
- [ ] The `finally` block performs no `git worktree remove`; cleanup is `rmSync(scratch)` (still honouring `--keep`).
- [ ] `rev-parse --verify <ref>^{commit}` retained fail-closed for both refs; archive/extract failures raise `SetupFault` → exit 2; `maxBuffer` set explicitly (≥ 64 MiB).

### From HOW (behaviour, demonstrated)
- [ ] Full-matrix `--baseline-ref HEAD` self-parity run from the **main checkout**: exit 0, PASS.
- [ ] Full-matrix `--baseline-ref HEAD` self-parity run from **inside a linked worktree** (the previously dangerous invocation): exit 0, PASS, and `git worktree list --porcelain` captured before/after (in the smoke shell — outside the harness source) is byte-identical.

### From HOW (selftest)
- [ ] `--selftest` green, including the new assertions: worktrees registry dir fs-snapshot (sorted entry names) unchanged around a `materialiseRef` call; the materialised `bin/faff` exists and is executable; the executed worktree-verb invariant (D8).
- [ ] All pre-existing selftest assertions (comparator, coverage-drift kill, self-parity, mutation kill) still green.

### From D6 (docs never stale)
- [ ] Script header comment states the run-locus property (safe from any checkout; `git archive`, no registry writes).
- [ ] A follow-up comment on FAFF-441 correcting its recorded recipe with the same note is posted by the graft flow.

### CI
- [ ] `faff validate-adapters` green; repo `node --test` suite green.

**Integration smoke test:**

```
1. From the main checkout: node scripts/verify-split-parity.mjs --selftest   → expect PASS, exit 0
2. wt=$(git worktree add --detach <tmp> HEAD); cd <tmp>
3. Capture git worktree list --porcelain → before
4. node scripts/verify-split-parity.mjs --baseline-ref HEAD                  → expect PASS, exit 0
5. Capture git worktree list --porcelain → after; assert before == after byte-for-byte
6. Assert the calling worktree's .git file and admin dir are intact; clean up <tmp>
```
