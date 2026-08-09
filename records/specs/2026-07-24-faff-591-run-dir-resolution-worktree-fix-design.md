# FAFF-591 — `faff effects`/`events` must resolve the run dir against the main checkout, not cwd

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-591.

## Problem

`faff effects declare/observe/check` resolve the run dir as `<findRoot()>/.faff/runs/<run-id>`, where `findRoot()` (`bin/lib/shared-infra.js`) walks up from **cwd** to the nearest `.git`/`.faff`. A build worktree is its own checkout, so from inside one `findRoot()` returns the *worktree* root — but the run dir lives in the **main checkout's** `.faff/runs/`. `declare` then exits 3 (`run dir missing — initialise the run first`) and writes no declaration.

The merge itself is unaffected: `faff merge-gate` is handed the absolute `--run-dir` and its mechanical self-`observe` (`observeMergeEffects(runDir, …)` in `bin/lib/merge-gate.js`) writes the `observe` entry to the **main-checkout** ledger. So every worktree-invoked interactive merge produces an `observe` with no covering `declare` → `merge-gate` correctly warns `observed merge pr:<n> with no covering declaration — this will read as an escaped side-effect`. Hit twice on 2026-07-22 (PR #448/FAFF-565, PR #453/FAFF-569).

Impact is observability-only today, but it systematically poisons the effects→sentry escaped-side-effect signal for the most common graft topology (build worktree + main checkout): every legitimate, declared-intent merge is recorded as undeclared.

**`faff events append` shares the identical defect** (`bin/lib/events.js` → `cmdEvents`, `root = root || findRoot()` → `path.join(root, ".faff", "runs", run)` → same exit-3 guard). It is the same root cause one file over, invoked from the same graft/worktree topology (a build subagent appending run events from inside its worktree hits exit 3 the same way). Fixing only `effects` would leave the identical landmine one call site over, so this ticket fixes both through one shared resolver.

## Reference context

- `bin/lib/effects.js` → `cmdEffects` (the `declare`/`observe`/`check` CLI). `root = root || findRoot()` (~line 376); `const dir = path.join(root, ".faff", "runs", run)` (~384); exit-3 guard (~387); `check`'s ledger path (~418). Already accepts a `--root DIR` override.
- `bin/lib/events.js` → `cmdEvents` `append` branch. `root = root || findRoot()` (~624); `const dir = path.join(root, ".faff", "runs", run)` (~635); exit-3 guard (~639); the events path (~792). Already accepts `--root` and `--run-dir`. (FAFF-568 recently added anchor/verify hash-chain code to this file; it does **not** touch this resolution block — no conflict.)
- `bin/lib/shared-infra.js` → `mainWorktreeRoot(root)` (exported): shells `git -C <root> rev-parse --git-common-dir`, returns the parent of the shared `.git` common dir — i.e. the **main checkout**, the *same* value from the main checkout or any linked worktree; returns `null` for a bare/non-git root. `findConfig` (same file, FAFF-208) already uses it for exactly this worktree→main-checkout fallback shape. This is the natural home for the new shared resolver.
- `bin/lib/merge-gate.js` → `observeMergeEffects` / `appendEffectEntries` already receive an absolute `runDir` and are correct; no change there.
- Graft Step-10 prose (`plugin/skills/faff-graft/SKILL.md` ~line 437) invokes `faff effects declare --run "$(basename "$run_dir")" …`, passing only the basename `--run`.
- `bin/faff` — the `effects` (~line 179) and `events` (~611 usage) CLI doc/usage headers.
- Tests: `test/effects.test.mjs` (24 tests) and the events test suite; harnesses run the real CLI in a tmp cwd.

## Already shipped against this surface

- **FAFF-420** (Done) — *Harden readHoldout: bind the holdout verdict to the run + resolve it run-dir-relative (not CWD), freshness-checked.* The identical bug class one call site over (a CWD-relative run-dir artifact read in `merge-gate`), fixed by binding to the explicit run-dir and never falling back to CWD. Establishes the house preference: **bind run-dir artifacts to the run, don't re-derive from cwd.**
- **FAFF-208** (Done) — `findConfig`'s worktree→main-checkout fallback via `mainWorktreeRoot`; the exact resolver + precedence shape this spec reuses.
- **FAFF-383** (Done) — extracted `appendEffectEntries`; the shared ledger-append core both `cmdEffects` and `merge-gate` call. Unchanged by this fix.

None of these fix `effects`/`events` run-dir resolution. Premise holds — proceed.

## What to build

A single worktree-aware run-dir resolver, home in `shared-infra.js`, reused by both `effects.js` and `events.js` so the fix has one home (not two copies). Reuse `mainWorktreeRoot` — do not re-implement git probing.

**Chosen:** Add a pure exported helper `resolveRunDir(root, run, rootExplicit)` to `bin/lib/shared-infra.js`:
1. `cwdDir = path.join(root, ".faff", "runs", run)`. If it exists and is a directory → return `cwdDir` (byte-for-byte today when run from the main checkout, or from any cwd whose root already holds the run).
2. Else, **only when `rootExplicit` is false** (root came from `findRoot()`, not an operator `--root`): `mainRoot = mainWorktreeRoot(root)`; if `mainRoot` is non-null and `!== root`, and `path.join(mainRoot, ".faff", "runs", run)` exists and is a directory → return that.
3. Else → return `cwdDir` (the canonical "not found" path, so the exit-3 message still names a `.faff/runs/<run>` path).

It mirrors `findConfig`'s precedence exactly and honours FAFF-420's "bind to the run, not cwd" preference. Being pure + git-probing-via-`mainWorktreeRoot` only, it is unit-testable and shared.

**Chosen:** Apply `resolveRunDir` in `cmdEffects` for all three subcommands (`declare`/`observe`/`check`), replacing the inline `path.join(root, ".faff", "runs", run)`. Capture `rootExplicit` (was `--root` supplied?) *before* the `root = root || findRoot()` default and pass it through. For `check`, resolve the run dir via the helper first, then probe the ledger under the resolved dir — the genuinely-absent-ledger clean state (exit 0) is preserved when neither the cwd-root nor the main-checkout dir holds a ledger.

**Chosen:** Apply the same helper in `cmdEvents`' `append` branch (`events.js`), with the same `rootExplicit` capture. This is the sibling fold-in: the ticket's scope widens by one call site to kill the identical root cause rather than leave `events append` broken from worktrees. The events path (`<dir>/events.jsonl`) and the ledger/verify code (incl. FAFF-568's hash chain) are downstream of the resolved `dir` and unchanged.

**Chosen:** Gate the fallback on `rootExplicit` in both callers. An explicit `--root` stays a strict, deterministic escape hatch (no surprise git probe / no fallback); only the auto-derived-from-cwd path gets the main-checkout rescue. Keeps `--root`-based tests hermetic and gives operators a way to force exact behaviour.

**Chosen:** Update the `effects` and `events` CLI doc/usage headers in `bin/faff` to state the run dir is resolved against the main checkout when invoked from a linked worktree. Documentation-accuracy only (no `lint-cli-doc` parity rule covers either subcommand's body prose).

**Punt:** The other orchestrator-lane commands that also join `<root>/.faff/runs` (`audit.js`, `contain.js`, `lights-out.js`, `self-intake.js`, `park-history.js`) are **not** in scope — they run in the orchestrator lane (main checkout), never from a build worktree, so they cannot hit this bug in practice. They can adopt `resolveRunDir` later if a worktree-invocation path ever emerges; no ticket needed now. *(decides: architecture)*

**Assumes:** In the interactive-graft topology the build worktree and the main checkout **share one git common dir** (they are linked worktrees of the same clone), so `git rev-parse --git-common-dir` from the worktree resolves to the main checkout's `.git` — true for every faff-created worktree (`git worktree add`). A fully independent clone (no shared common dir) is out of scope and no faff flow produces that layout for a run.

**Assumes:** `.faff/runs/<run-id>` is unique to the main checkout — a linked worktree never carries its own copy of the same run-id dir — so the cwd-root-first / main-checkout-second precedence is unambiguous.

## Acceptance criteria

1. **`resolveRunDir` precedence (pure).** Unit-level: given a root whose `.faff/runs/<run>` exists → returns that dir; given a root missing it whose `mainWorktreeRoot` differs and holds `.faff/runs/<run>` → returns the main-checkout dir; `rootExplicit=true` → never consults `mainWorktreeRoot`; `mainWorktreeRoot`→null → returns the cwd-root dir. Covered by `--selftest` where git-independent, and by integration for the git-common-dir path.
2. **`effects declare` from a worktree resolves to the main checkout.** From inside a linked git worktree whose main checkout holds `.faff/runs/<run>/`, `faff effects declare --run <run> --issue <id> --step merge` (no `--root`) exits 0 and appends to the **main checkout's** `declared-effects.jsonl` (not the worktree's). *Test: real `git init` + `git worktree add`; assert the ledger line lands under the main checkout and the worktree has no `.faff/runs/<run>`.*
3. **`effects observe` + `check` from a worktree.** An `observe` from the worktree lands in the same main-checkout ledger; a declare-then-observe pair from the worktree yields `faff effects check` → `any_escape: false`; `check` from the worktree reads the main-checkout ledger (not a false "clean" against the worktree root).
4. **`events append` from a worktree resolves to the main checkout.** From inside the worktree, `faff events append --run <run> …` (no `--root`) exits 0 and appends to the main checkout's `.faff/runs/<run>/events.jsonl`; the events validate/verify paths still operate against the resolved dir.
5. **Main-checkout behaviour is byte-for-byte unchanged.** Every existing `test/effects.test.mjs` and events-suite case (run in a plain tmp cwd that *is* the root) passes untouched — same exit codes, same paths, same envelopes.
6. **Explicit `--root` is strict.** With `--root <dir>` supplied and `<dir>/.faff/runs/<run>` absent, `effects declare/observe` and `events append` exit 3 with no git probe / no main-checkout fallback.
7. **Genuine missing run still exits 3.** From a worktree whose main checkout *also* lacks `.faff/runs/<run>`, `declare`/`observe`/`events append` exit 3 naming a `.faff/runs/<run>` path; `effects check` reports clean (exit 0), preserving the missing-ledger tolerance.
8. **Non-git / bare root degrades safely.** When `mainWorktreeRoot` returns `null`, resolution falls back to the cwd-root path exactly as today — no throw.
9. **Suites green.** `faff effects --selftest`, the new `resolveRunDir` selftest, `test/effects.test.mjs`, and the events test suite all pass.

confidence: high
spec-review: approve

## Methodology critique

*(agile-delivery lens — issue-critique)*

- **Right-sized?** Yes. One cohesive concern — worktree-aware `.faff/runs/<id>` resolution for the two run-dir-writing CLIs (`effects`, `events`) invoked from the graft/worktree topology — as a single shared helper. The `events append` fold-in is the *same* root cause and the *same* fix, not a second concern; splitting it into its own ticket would ship a knowingly half-fixed landmine. Still comfortably a single sub-1-day unit (a ~15-line pure helper + two 1-line call-site swaps + tests).
- **Workstream fit?** Cohesive with the effects→sentry signal-integrity line (FAFF-383/420/352). Outcome-named: the declared-effects + events ledgers tell the truth for worktree-invoked runs.
- **Deps surfaced?** No hidden dependency. `mainWorktreeRoot` already exists and is exported; no blocker link missing. The one thing to watch — FAFF-568's recent edits to `events.js` — is confirmed orthogonal to the resolution block.
- **Risk profile?** Low. Reuses a shipped resolver and a shipped precedent (FAFF-208/420). The only real-world seam is the git-common-dir probe, covered by an integration test with a real linked worktree. No de-risking spike warranted.
