# nlspec — FAFF-1149: `faff gates run` false non-green on the CI matrix-sharded UNIT rung

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1149.

This spec is for the build agent and human reviewers. It fixes the local gate ladder (`plugin/skills/faff/bin/lib/gates.js`) so `faff gates run` stops reporting a non-green UNIT verdict when the test suite is genuinely green, and so the ladder genuinely exercises the unit tests on every dev host. It corrects the ticket's stated root cause with evidence gathered by running the resolver directly.

---

## 1. WHY — Problem and Principles

**The central model.** `faff gates run` builds its rung list by *scraping* `.github/workflows/*.yml`: `discoverCiWorkflowsRunnable` reads every `run:` step, splits a multi-line `run: |` block into **one candidate command per body line**, drops the ones that are "not locally runnable" (`exclusionReason`), and keeps the rest as rungs to execute. Two properties of that scrape decide everything below: (a) a multi-line **shell script** in a `run: |` block is shredded into many independent "commands", and (b) a step is dropped when its declared `runs-on:` OS family differs from the local host (`os-mismatch`).

**Problem statement.** On a macOS dev host, `faff gates run` selects **only** three shell-fragment lines scraped from the `validate-macos` job's per-file loop as its UNIT "rungs" — the genuine cross-platform `node --test` suite (pinned to `runs-on: ubuntu-latest`) is `os-mismatch`-excluded, so it never runs locally, and one broken fragment produces a non-green UNIT status. The result misleads every local `gates run` and would be a real false-fail for any consumer wiring the ladder to gate. This change stops fabricating rungs from shell-script fragments and lets the OS-portable suite run on any host.

**The ticket's stated cause is inaccurate — corrected here.** The ticket attributes the failure to the unexpanded `${{ matrix.shard }}` token being executed. It is not: FAFF-987's `normaliseLocalRungCommand` already strips `--test-shard=${{ matrix.shard }}/4` in the execution path, and on macOS that matrix step is `os-mismatch`-excluded before it could run. The token is visible only in `faff gates discover` (the reporting path, which neither normalises nor OS-filters) — which is what the reporter saw and (reasonably) blamed. See §6 for the evidence.

**Design principles.**

**Never manufacture a gate from noise.** The code already refuses to gate on an unrecognised pre-commit hook or a loose script name (the "slow target labelled cheap" failure the comments at `discoverPreCommit` and `CI_RUNNERS` name). A comment line or a bash loop-body fragment that merely *contains* the substring `node --test` or `tap` is the same failure and must be treated the same way: not runnable, so not a rung.

**A non-green signal must mean a real test result.** A rung that is skipped-as-not-locally-runnable is never `fail`/`errored`. A UNIT verdict on a dev host must come from running the actual suite, not from a scraped shell fragment. Removing the false-fail while leaving the host with *no* real UNIT coverage only half-solves the ticket.

**Execution path only; reporting stays faithful.** `faff gates discover` is a *report* of what CI enforces and deliberately shows raw CI command text (including `${{ … }}`). This change touches only what `gates run` selects and executes; discover's output is out of scope.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` `exclusionReason` | JS | Where "not locally runnable" is decided (`configured` > `os-mismatch` > `github-context`); the primary edit site. |
| `plugin/skills/faff/bin/lib/gates.js` `discoverCiWorkflowsRunnable` / `selectRunnableRungs` / `runLadder` | JS | The execution resolver + ladder that consume `exclusionReason`. |
| `plugin/skills/faff/bin/lib/gates.js` `normaliseLocalRungCommand` (FAFF-987) | JS | Already strips `--test-shard`; preserved and additive to this fix. |
| `.github/workflows/validate.yml` | YAML | Source of truth: the `unit` matrix job (ubuntu), `env-rootless` (ubuntu), and the `validate-macos` per-file loop (FAFF-1049). |
| `test/gates-ci-source.test.mjs` | JS (node:test) | Real-repo `selectRunnableRungs` acceptance; runs on the ubuntu unit lane only (so the macOS path is currently uncovered). |
| `test/gates-ci-macos-guard.test.mjs` | JS (node:test) | Extracts the real `validate-macos` step body via `extractRunCommandsWithContext`; harness precedent for OS-specific fixtures. |

**Scope statement.** This sits inside the FAFF-11 gate ladder's local-execution resolver, downstream of FAFF-987 (shard strip), FAFF-1002 (local resharding), and FAFF-1137 (bounded shard pool), all of which are preserved unchanged.

---

## 2. OUT OF SCOPE

- **`faff gates discover` reporting output.** — The reporting path (`discoverRungsReporting` / `discoverCiWorkflowsReporting`) still shows the raw `${{ matrix.shard }}` token and per-line fragment UNIT rungs. Why excluded: discover is a faithful report of CI, not a gate; the token there is not a defect. Extension point: `discoverCiWorkflowsReporting` in `gates.js` if a future ticket wants annotated/normalised reporting.
- **The CI workflow itself.** — `validate.yml` (the sharded matrix, the per-file loop, `runs-on` pins) is correct for CI and unchanged. Why excluded: the bug is in local scraping, not in CI. Extension point: `.github/workflows/validate.yml`.
- **A first-class `skipped` rung status in the ladder output.** — This fix reuses the existing *exclusion* mechanism (dropped + logged with a reason), consistent with today's `github-context` handling, rather than emitting rungs with `status: "skipped"`. Why excluded: exclusion already guarantees "never fail" with the smallest blast radius; a status-carrying skipped rung is a larger surface. Extension point: `GATE_RUNG_STATUSES` already lists `skipped` in `contract-defs.js` if a future ticket wants visible skipped rungs.
- **A per-repo allow/deny for OS-portable runners.** — The secondary fix hard-codes "recognised UNIT runners are OS-portable". Why excluded: a config knob is unnecessary for the increment. Extension point: a future `gates.portable_runners` / `gates.os_strict` knob read in `readGatesConfig`.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Scraped command | One candidate command line produced by the workflow line-scan (`extractRunCommandsWithContext`); a multi-line `run: \|` block yields one per non-blank body line. |
| Standalone-runnable | A scraped command that can be executed on its own in the worktree without workflow context (no unset workflow/shell variable, not a comment, not a bare control-operator fragment). |
| Portable runner | A recognised test runner whose result is OS-independent by construction (`node --test`, `pytest`, `jest`, `vitest`, `mocha`, `ava`, `tap`, `go test`, `cargo test` — the UNIT entries of `CI_RUNNERS`). |
| `os-mismatch` exclusion | Dropping a step because its `runs-on:` OS family differs from the local host. |
| `not-runnable` exclusion | New reason: dropping a scraped command that is not standalone-runnable. |

**Exclusion-reason surface (the contract the ladder logs).** `exclusionReason(rec, cfg, localOsVal)` returns one of the reason strings below, or `null` when the command is runnable. Order = precedence (first match wins):

```
ENUM ExclusionReason:
  "configured"       # cfg.exclude substring match (unchanged)
  "github-context"   # ${{ … }} / $GITHUB_ / $RUNNER_ — kept AHEAD of not-runnable so these specific
                     #   patterns keep their existing reason and the existing selftests pass unchanged
  "not-runnable"     # NEW: comment-only, or references a NON-github-context undefined shell variable,
                     #      or is a bare control-operator fragment
  "os-mismatch"      # runs-on OS family != local host — NOT applied to a portable runner (CHANGED)
```

**Precedence — deliberate.** `github-context` is ordered *before* `not-runnable`: `${{ … }}` / `$GITHUB_` / `$RUNNER_` are a subset of the undefined-shell-var class, but they keep their existing reason so no existing exclusion-reason is churned and the current `gates.js --selftest` `github-context` cases stay green unchanged. `not-runnable` then catches only the genuinely-new cases (comment lines, other workflow-local vars like `$f` / `${test_timeout_ms}`, bare fragments).

**Design decision — how to express "skip, don't fail".** Options: (A) exclude the fragment lines (drop + log, like `github-context` today); (B) emit them as rungs with `status: "skipped"`. **Chosen:** A — reuse the existing exclusion path. It guarantees "never fail" for free (excluded commands never reach `runRung`), keeps the change inside `exclusionReason`, and is consistent with how `${{ … }}` is already handled. `skipped`-status rungs (option B) are a larger surface for no added correctness.

**Design decision — breadth of the "not-runnable" test.** Options: detect only `${{ … }}` (the ticket's candidate 1); detect any reference to a shell variable not present in the local environment, plus comment-only lines. **Chosen:** the broader test. Candidate 1 catches only the discover-visible token and would leave every macOS fragment (`$f`, `$filelog`, `${test_timeout_ms}`, comment lines) running and failing. The broader test is the one that actually removes the observed false non-green.

---

## 4. HOW — Behaviour

**Architecture.** Two coupled, additive edits, both inside the execution resolver's runnable filter; nothing else in `gates.js`, the contract shape, the local sources (pkg/Makefile/pre-commit), or the CI workflow changes.

**Primary edit — exclude non-standalone-runnable scraped lines (`exclusionReason`).** Behaviour summary: a scraped line that cannot run on its own is dropped as `not-runnable`, so it never becomes a rung and never contributes a `fail`/`errored`.

```
PROCEDURE exclusionReason(rec, cfg, localOsVal):
  cmd = rec.command
  1. IF cfg.exclude has a substring of cmd → RETURN "configured"      # unchanged
  2. IF cmd matches /\$\{\{ | \$GITHUB_ | \$RUNNER_/ → RETURN "github-context"  # MOVED UP: keeps the existing reason for these patterns (existing selftests unchanged)
  3. IF isNotRunnable(cmd) → RETURN "not-runnable"                    # NEW, before os-mismatch
  4. IF rec.runs_on:
       fam = osFamily(rec.runs_on)
       IF fam != null AND fam != localOsVal:
         IF NOT isPortableRunner(cmd) → RETURN "os-mismatch"          # CHANGED: portable runners bypass
  5. RETURN null

PROCEDURE isNotRunnable(cmd):   # reached only AFTER the github-context check, so cmd carries no ${{ }}/$GITHUB_/$RUNNER_ token
  1. IF cmd trimmed starts with "#"        → RETURN true              # comment-only body line
  2. FOR each shell-variable reference in cmd (${NAME} or $NAME):
       IF NAME is not a key of the local process environment → RETURN true
  3. IF cmd is a bare control-operator fragment (e.g. trailing "&" with no complete command,
        a lone "fi"/"done"/"then", an assignment-only line like NAME=VALUE) → RETURN true
  4. RETURN false

PROCEDURE isPortableRunner(cmd):
  # true iff cmd matches a UNIT-kind entry of CI_RUNNERS whose result is OS-independent:
  #   node … --test, pytest, jest, vitest, mocha, ava, tap, go test, cargo test
  RETURN ciRunnerKind(cmd) == "UNIT"
```

- Env-var presence uses the live process environment (`process.env`), so `$HOME`/`$PATH` and any genuinely-exported var are *not* flagged; only workflow-local shell vars (`$f`, `$test_timeout_ms`, `$RUNNER_TEMP`, …) are.
- `github-context` (step 2) runs *before* `not-runnable` on purpose: `${{ … }}` / `$GITHUB_` / `$RUNNER_` are a subset of the undefined-var class, but keeping the dedicated check first preserves the existing exclusion reason for those patterns, so the current `gates.js --selftest` `github-context` cases stay green unchanged and no existing exclusion-reason is churned.

**Secondary edit — let a portable UNIT runner survive `os-mismatch` (the `isPortableRunner` guard in the os-mismatch step).** Behaviour summary: the genuine cross-platform suite, pinned to `ubuntu-latest` in CI, is selected and run on a macOS (or any) dev host, so local `gates run` actually exercises the tests everywhere. `normaliseLocalRungCommand` still strips `--test-shard`; `shardCapable`/`runShardedRung` still reshard it to the local host (FAFF-1002/1137 unchanged).

**Anti-pattern:** substituting a shard value (e.g. `1/1`) for the matrix token to "make it runnable". Why: `normaliseLocalRungCommand` already removes the token and `runRung` reshards locally to `local_shards`; re-injecting a shard only re-shrinks the local run and re-introduces the exact token-parsing fragility the strip removed.

**Anti-pattern:** preferring the `validate-macos` per-file rung over the matrix rung on a non-CI host. Why: on macOS the per-file lines *are* the broken fragments and the matrix line is the genuine suite — "prefer per-file" is backwards.

**Edge cases.**

- **Linux host — selected rungs and ladder verdict unchanged; internal reason bookkeeping churns (by design, non-behavioural).** The **selected rung set is unchanged** (the matrix `node --import ./test/hermetic-env.mjs --test`, `env-rootless`, and the LINT/STATIC rungs) and the ladder's signal is unchanged. What *does* change is the *exclusion-reason* accounting inside `discoverCiWorkflowsRunnable`: because `not-runnable` fires at step 3 (before os-mismatch) on **every** scraped comment line and undefined-`$var` line in **every** job, a large set of previously-`os-mismatch` or previously-unlogged fragment lines now log as `not-runnable` instead (measured on this repo: dozens of macOS `validate-macos` fragments flip `os-mismatch → not-runnable`, pure-control lines like `set -uo pipefail` / `exit 1` stay `os-mismatch`, and comment/`$var` lines in ubuntu jobs newly appear as `not-runnable`). This is *log accounting only* — it selects no different rung and changes no gate outcome, so it is not a behaviour change. **The spec deliberately does not enumerate exact per-reason counts** (they are brittle and repo-specific); the regression guard asserts the behaviour-relevant invariants (selected-rung set + ladder signal unchanged), not a reason-count delta.
- **macOS host (fixed):** the three `validate-macos` fragments are excluded (`not-runnable`); the matrix suite survives `os-mismatch` (portable runner) and runs.
- **`env-rootless` on macOS:** now survives `os-mismatch` (portable UNIT). Without `FAFF_REQUIRE_DOCKER` and without a daemon, its two files self-skip → `pass`. Harmless.
- **A step whose `env:` injects a var used in the command** (e.g. `node --test $EXTRA` with `EXTRA` set only in the step's `env:`): excluded as `not-runnable`. Accepted: the scraper does not read `env:`, so such a command is genuinely not standalone-runnable locally; skipping (never failing) is the safe outcome.
- **Empty result:** if after exclusion a host has zero runnable rungs, `runLadder` falls through to today's `discovery: none` → fail-closed → `needs-human`. The secondary fix is what prevents macOS from landing there.

**Failure modes.**

- **The failure:** the secondary edit runs a genuinely OS-specific test (e.g. a `windows-latest` job asserting Windows path behaviour) on the wrong host, producing a real non-green that is not a code defect. **How you'd know:** a portable-runner rung fails locally on one OS but the suite is green in CI on its pinned OS. **What it means:** narrow — add a per-repo opt-out (Punt P1) or exclude that command via `gates.exclude`. In faff's own repo no such case exists (all UNIT steps are OS-portable), so the increment is safe here; the risk is cross-repo.
- **The failure:** the undefined-var heuristic over-excludes a legitimate single-command step that references an exported var, silently dropping real coverage. **How you'd know:** a rung that ran (and passed) before now appears in the exclusions log as `not-runnable`. **What it means:** proceed — the outcome is a skip, never a false-green; if it matters, export the var or narrow the check. The presence test against `process.env` keeps this rare.

---

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff's own repo on a LINUX host
When selectRunnableRungs runs
Then a UNIT rung "node --import ./test/hermetic-env.mjs --test" is selected
 And no selected UNIT rung is a comment line or contains an undefined shell variable
 And the Linux rung set is unchanged from before this fix
```

```
Given a synthetic workflow whose only recognised UNIT line is a comment containing "node --test"
 And a sibling job pinned to a different OS whose run: is a real "node --test" step
When selectRunnableRungs runs on the mismatched host
Then the comment line is excluded "not-runnable"
 And the real "node --test" step survives os-mismatch as a portable runner
```

- The genuinely green suite (5138 pass / 0 fail / 5 docker-skips) MUST NOT surface as a `fail` from `faff gates run` on any host.
- A scraped command referencing a shell variable not present in the local environment MUST be classified `not-runnable`, never executed.

---

## 6. Design Decision Rationale

**Evidence for the root-cause reframe (ran against the codebase, not inferred).** Calling `selectRunnableRungs(repoRoot)` directly:
- On a Linux host: 8 rungs — 3 LINT, 3 STATIC_ANALYSIS, and 2 UNIT (`node --import ./test/hermetic-env.mjs --test` and the `env-rootless` line); both UNIT rungs pass. No false-fail. The `--test-shard=${{ matrix.shard }}/4` line is present but `normaliseLocalRungCommand` has already stripped the token.
- With `process.platform` forced to `"darwin"`: **3 rungs, all UNIT, all from the `validate-macos` per-file loop** — two comment lines (`# Per-file loop …`, `# file per node --test …`, matched because they contain `tap`/`node --test`) and `node --import ./test/hermetic-env.mjs --test-reporter=tap --test-timeout=${test_timeout_ms} --test "$f" > "$filelog" 2>&1 &`. Every ubuntu rung (the matrix suite, `env-rootless`, all LINT/STATIC) is `os-mismatch`-excluded. `runLadder` returns non-green from the fragment. This is the reporter's "UNIT fail" — mechanism: fragment fabrication + OS exclusion, not the shard token.
- `faff gates discover --json` shows the raw `${{ matrix.shard }}` token and five per-line UNIT fragments — reporting-only, matches the reporter's discover output.

**Why the gates test suite never caught this.** `test/gates-ci-source.test.mjs`'s real-repo `selectRunnableRungs` assertion runs on the ubuntu `unit` matrix lane; `validate-macos` runs only `test/impure/*.test.mjs`. So the macOS selection path has zero coverage. This fix's ACs close that gap by spoofing `process.platform`.

**Question: which fix removes the false non-green?**
- Candidate 1 — detect `${{ … }}`, skip. Pros: matches the ticket. Cons: catches only the discover-visible token; leaves every macOS fragment (`$f`, `${test_timeout_ms}`, comment lines) running and failing. Insufficient.
- Candidate 2 — substitute shard `1/1`. Cons: the fragments aren't the shard token; `normaliseLocalRungCommand` already strips it and `runRung` reshards locally — substitution re-shrinks the run. Wrong target.
- Candidate 3 — prefer the per-file rung over the matrix rung. Cons: on macOS the per-file rung IS the broken fragment. Backwards.
- Generalised skip (comment / undefined-shell-var / fragment) → excluded as `not-runnable`. Pros: removes the actual macOS false non-green; consistent with existing exclusion; small blast radius. **Chosen.**

**Question: how to keep local `gates run` genuinely exercising the tests on macOS?**
- Do nothing — after the primary fix macOS has zero UNIT rungs → `discovery: none` → `needs-human`. Removes the false-fail but runs no tests. Rejected: fails the ticket's "keep exercising the tests" half.
- Let recognised OS-portable UNIT runners bypass `os-mismatch`. Pros: the genuine suite runs on any host; preserves FAFF-987/1002/1137. Cons: cross-repo risk of running an OS-specific test on the wrong host (see Failure modes). **Chosen:** the trade-off favours real coverage; the risk is bounded, signalled, and Punt P1 offers an opt-out.

**Question: exclude vs. `status: "skipped"` rung?** **Chosen:** exclude (drop + log a reason), reusing today's mechanism; smallest surface, "never fail" for free.

---

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt P1 (non-blocking):** should the portable-runner OS bypass be gated behind a per-repo knob (`gates.os_strict` / `gates.portable_runners`) for repos with genuinely OS-specific test jobs? The increment ships the hard-coded bypass; the knob is a follow-up. `(decides: architecture)`

**Assumptions.**

- **Assumes:** `process.env` reflects the developer's real shell environment when `faff gates run` executes, so the undefined-shell-var test correctly distinguishes exported vars from workflow-local ones. Validate: confirm `exclusionReason` is reached in-process during `runLadder` (it is — `discoverCiWorkflowsRunnable` runs synchronously in the CLI process).
- **Assumes:** the UNIT entries of `CI_RUNNERS` (`node --test`, pytest, jest, vitest, mocha, ava, tap, go test, cargo test) are OS-portable in intent. Validate: these are language test runners; none is inherently OS-bound. Confirm the list in `gates.js` before wiring `isPortableRunner` to it.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] On faff's own repo, `faff gates run` does not report a UNIT `fail`/`errored` caused by a scraped `validate-macos` shell fragment on any host (Linux verified by run; macOS verified by platform-spoof test).
- [ ] The genuinely green suite (5138 pass / 0 fail / 5 docker-skips) is not surfaced as a `fail` locally.

### From WHAT (exclusion surface)
- [ ] `exclusionReason` returns `"not-runnable"` for a comment-only scraped line.
- [ ] `exclusionReason` returns `"not-runnable"` for a scraped line referencing a shell variable absent from `process.env`, while leaving a command referencing only a present env var runnable. **Test deterministically:** the selftest injects a known var (`process.env.FAFF_TEST_PRESENT = "x"`, asserted-runnable) and uses a known-absent var (`$FAFF_TEST_ABSENT`, asserted `not-runnable`), restoring both after — never relying on an ambient var like `$HOME` whose presence varies by host.
- [ ] `exclusionReason` does NOT return `"os-mismatch"` for a recognised portable UNIT runner (`ciRunnerKind(cmd) === "UNIT"`), even when `runs_on` OS family differs from the local host.
- [ ] Precedence is `configured` > `github-context` > `not-runnable` > `os-mismatch`(portable-exempt). The `github-context` reason is kept ahead of `not-runnable` so `${{ … }}` / `$GITHUB_` / `$RUNNER_` patterns retain their existing reason.
- [ ] **The existing `gates.js --selftest` `github-context` cases (the `${{ }}` and `$GITHUB_` exclusion assertions, which carry no `runs_on`) still pass unchanged** — the reason-precedence keeps `github-context` for those patterns, so *those* cases are not broken and need no editing. (This is the concrete guard the github-context precedence exists to satisfy; it is scoped to the github-context cases only — the `os-mismatch` cases keyed on a portable UNIT runner do change and are updated per Test harness below.)

### From HOW (behaviour)
- [ ] With `process.platform` spoofed to `"darwin"`, `selectRunnableRungs(repoRoot)` excludes the three `validate-macos` per-file-loop fragment lines as `not-runnable`.
- [ ] With `process.platform` spoofed to `"darwin"`, `selectRunnableRungs(repoRoot)` selects `node --import ./test/hermetic-env.mjs --test` as a UNIT rung (portable-runner os-mismatch bypass).
- [ ] On the Linux lane, the **behaviour-relevant invariants are unchanged**: `selectRunnableRungs(repoRoot)`'s **selected-rung set** and `runLadder`'s **signal** are both identical to before this fix (regression guard in `test/gates-ci-source.test.mjs`). The guard asserts these two, **not** a per-reason exclusion count: the internal exclusion-*reason* accounting churns broadly and non-behaviourally (many comment/`$var`/fragment lines across all jobs move to `not-runnable`; some pure-control lines stay `os-mismatch`), which is log accounting that selects no different rung — so the guard must not assert a "reason-set unchanged" or an enumerated per-reason delta (both are brittle and false against the real repo). Selecting the same rungs with the same verdict is the property that matters.
- [ ] FAFF-987 (`normaliseLocalRungCommand`), FAFF-1002 (`shardCapable`/`runShardedRung`), and FAFF-1137 (bounded pool) behave identically — asserted by **their own** `gates --selftest` cases (shard-strip / local-reshard / bounded-pool) still passing; this fix touches `exclusionReason` only, not the shard machinery. The `github-context` selftest cases (no `runs_on`, so untouched by the os-mismatch reorder) also pass unchanged. The `os-mismatch` selftest cases keyed on a portable UNIT runner are the ones that legitimately change — see Test harness below.

### From HOW (edge cases)
- [ ] A step whose command references an `env:`-injected var absent from `process.env` is excluded `not-runnable`, never executed.
- [ ] The `env-rootless` line surviving `os-mismatch` on macOS self-skips (docker unreachable) → `pass`, not `fail`.

### Test harness
- [ ] `test/gates-ci-source.test.mjs` gains a macOS-spoof case (`Object.defineProperty(process, "platform", { value: "darwin" })`, restored after) asserting the macOS selection above; a Linux case asserting the unchanged selected-rung **set** and ladder **signal** (never a per-reason exclusion count).
- [ ] `gates.js` `--selftest` table gains unit cases for `exclusionReason` `not-runnable` (comment, undefined-var via the injected `FAFF_TEST_ABSENT` / present-var-runnable via `FAFF_TEST_PRESENT`) and the portable-runner os-mismatch bypass (a `node --test` step with a mismatched `runs_on` returns `null`).
- [ ] **The existing `os-mismatch` selftest cases keyed on `node --test` are updated to the new behaviour — enumerated, not left to break.** A recognised portable UNIT runner now bypasses `os-mismatch`, so a `node --test` command with a mismatched `runs_on` returns `null` (not `"os-mismatch"`) and counts as an eligible rung. The build updates each such case (the mismatched-command os-mismatch assertion and the mismatched-job eligible-step/rung-count assertions) to the portable-bypass expectation, **and** adds a companion case proving a **non-portable** mismatched command (e.g. an OS-specific shell step, not a `CI_RUNNERS` UNIT runner) still returns `"os-mismatch"` — so the os-mismatch mechanism itself stays covered. The DoD does not assert these cases are unchanged; it asserts they are updated to the intended new behaviour and the suite is green afterward.

**Integration smoke test.**

```
1. Force process.platform = "darwin"
2. rungs = selectRunnableRungs(repoRoot, readGatesConfig(repoRoot))
3. ASSERT no rung.command starts with "#" and no rung.command references an undefined shell var
4. ASSERT rungs contains a UNIT rung "node --import ./test/hermetic-env.mjs --test"
5. Restore process.platform
```

---

confidence: high
build-tier: complex
