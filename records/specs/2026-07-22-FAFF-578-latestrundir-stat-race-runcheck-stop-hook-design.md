# FAFF-578 — latestRunDir stat race: run-dir resolution never throws through the turn-end Stop hooks

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-578.

This spec addresses FAFF-578 (bug, from the 2026-07-21 external adversarial critique, appendix row 8). Audience: the build agent implementing the fix, and human reviewers checking the approach.

## 1. WHY — Problem and Principles

**Load-bearing model.** The Stop hooks (`runcheck --hook`, and `sentrycheck --hook` via the same helper) fire at **every session's turn-end** and resolve the newest run directory by scanning `.faff/runs`. Concurrent sessions creating and deleting run dirs is faff's own operating premise (parallel drains, worktree sessions, cleanup passes), so the scan must tolerate a directory vanishing mid-scan — a candidate listed by `readdirSync` can be gone by the time `statSync` reaches it.

**Problem.** `latestRunDir` (`plugin/skills/faff/bin/lib/shared-infra.js:145`) filters candidates with a bare `fs.statSync(p).isDirectory()` — a run dir deleted between `readdirSync` and `statSync` throws ENOENT out of `resolveRunDir` (`bin/lib/runcheck.js:130–132`) and out of `cmdRuncheck` (line 179), because the hook path's try/catch (line 184) covers only the ledger parse. The result is an uncaught exception in a hook that fires at every turn-end of every session in the repo.

**The discipline already exists in the codebase — applied inconsistently.** Ten lines above the bug, `sortRunDirsByMtimeDesc` catches the identical stat race (`shared-infra.js:133`, `catch { mtimeMs = -Infinity }`). And `state.js` `runDirsNewestFirst` (line ~70) wraps the same candidate-filter stat in a per-candidate try/catch (`catch { return false; }`). This fix brings `latestRunDir` in line with both.

**Design principle — tolerate resolution churn, never loosen own-fault fail-closed paths.** FAFF-425 made the governance CLIs fail closed on their *own* read faults (a named run whose ledger is gone is a fault, never all-clear). That boundary is untouched here: this fix tolerates filesystem churn during *candidate discovery* (which dir is newest), and must not swallow faults in *ledger reading* or in the explicit `--run-dir`/`$FAFF_RUN_DIR` paths (`resolveLedgerOrFault` is out of scope and unchanged).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/shared-infra.js` (`latestRunDir`, `sortRunDirsByMtimeDesc`) | Node (dependency-free CLI) | The buggy filter (line 145) and the in-file precedent for the fix (line 133) |
| `plugin/skills/faff/bin/lib/runcheck.js` (`resolveRunDir`, `cmdRuncheck`) | Node | The every-turn-end Stop-hook path the throw propagates through (lines 130–133, 174–199) |
| `plugin/skills/faff/bin/lib/state.js` (`runDirsNewestFirst`) | Node | The exact per-candidate try/catch filter form to mirror |
| `plugin/skills/faff/bin/lib/sentrycheck.js:122` | Node | Sibling Stop hook calling `latestRunDir` directly — transitive beneficiary, no edits |
| `test/runcheck-gate.test.mjs` | Node test runner | Existing fixture harness driving the real entrypoint against tmp roots — where the regression tests land |
| `test/doctor.test.mjs` | Node test runner | Precedent for `symlinkSync` in tests (the dangling-symlink reproduction trick) |

**Scope statement.** A robustness fix confined to run-dir *resolution* in the shared CLI helper plus a defensive catch at runcheck's resolution call site; no behaviour change on any happy path.

## 2. OUT OF SCOPE

- **`sentrycheck` / `prepcheck` hook-path defensive catches** — `sentrycheck`'s only resolution call is `latestRunDir` (fixed transitively); `prepcheck` already wraps its per-entry stats. No edits to either file. A future hardening pass could add call-site catches there; extension point: `cmdSentrycheck` (`sentrycheck.js:114`).
- **`resolveLedgerOrFault`'s documented benign TOCTOU** (`shared-infra.js:177–183`) — annotated as deliberate; both racy outcomes land on the correct fault exit. Unchanged.
- **`sortRunDirsByMtimeDesc`** — already tolerant; its `-Infinity` treatment stays as is.
- **Other `latestRunDir` callers** (heartbeat, disposition, economics, quality, queue-state, sentry, sentry-poller, budget via `resolveLedgerOrFault`) — they inherit the fix; no per-site edits. Extension point if a caller needs bespoke handling: its own call site.
- **`findRoot` robustness** — uses only `existsSync` (never throws); nothing to do.

## 3. WHAT — Behaviour contract

**`latestRunDir(root)` never throws on filesystem churn.** Its contract becomes:

```
FUNCTION latestRunDir(root) -> path | null:
  runs = root/.faff/runs
  IF runs does not exist            -> null            # existing behaviour
  IF readdirSync(runs) throws       -> null            # NEW: runs deleted between exists and readdir (same TOCTOU class)
  candidates = entries WHERE (statSync succeeds AND isDirectory AND run-ledger.json exists)
                                                       # NEW: statSync throws -> candidate EXCLUDED, scan continues
  IF candidates empty               -> null            # existing behaviour
  RETURN sortRunDirsByMtimeDesc(candidates)[0]         # unchanged
```

**`cmdRuncheck` resolution is defensively caught.** A throw from `resolveRunDir` (defence in depth — resolution should no longer throw, but a Stop hook must never crash on fs churn):

- hook mode (`--hook`): treated as "no run dir" → silent `return 0` (parity with the existing parse-error → silent rule, `runcheck.js:184`).
- non-hook mode: stderr message naming the failure + `return 2` (parity with the existing missing/malformed-ledger handling, lines 199–206).

**Design decisions:**

**Where to fix — shared helper vs per-caller catches.** Fixing inside `latestRunDir` protects all ~10 call sites at once and matches the file's own precedent (`sortRunDirsByMtimeDesc`). Per-caller catches would leave the next caller exposed. **Chosen:** fix inside `latestRunDir`; add exactly one defensive call-site catch in `cmdRuncheck` because it is the every-turn-end chokepoint the audit named.

**Unstat-able candidate: exclude vs sort-last.** `sortRunDirsByMtimeDesc` maps a failed stat to `-Infinity` (sort last) because its job is ordering an accepted set; the filter's job is candidacy — a dir that can't be statted can't be confirmed as a run dir at all. Excluding also mirrors `runDirsNewestFirst`'s filter exactly. **Chosen:** excluded from candidacy (`catch { return false; }` in the filter); `sortRunDirsByMtimeDesc` unchanged.

**`readdirSync` same-class race.** The audit cited the stat, but `existsSync(runs)` → `readdirSync(runs)` is the same TOCTOU shape one call earlier (runs dir itself deleted, or replaced by a file → ENOTDIR). **Chosen:** wrap the `readdirSync` in try/catch → `null`, closing the whole resolution path in one pass.

**Regression-check seam — pure selftest row vs fs-driven test.** The ticket direction says "selftest row", but `RUNCHECK_SELFTEST_CASES` is a deliberately pure `(ledger, env)` table with no filesystem (the FAFF-205 pure-decision invariant) — a vanished-candidate case cannot be expressed there without breaking that purity. The deterministic reproduction is a **dangling symlink** inside `.faff/runs`: `readdirSync` lists it, `statSync` (which follows links) throws ENOENT — exactly the "candidate vanishes mid-scan" state, reproducible without a race. `test/doctor.test.mjs` already uses `symlinkSync`. **Chosen:** fs-driven regression tests in `test/runcheck-gate.test.mjs` (the file that already drives the real entrypoint against tmp fixture roots), discharging the ticket's intent — a deterministic vanished-candidate check with exit codes unchanged — at the correct seam.

## 4. HOW — Behaviour

**Fix 1 — `latestRunDir` (shared-infra.js):**

```
1. IF NOT existsSync(runs): RETURN null                       # unchanged
2. TRY names = readdirSync(runs) CATCH: RETURN null           # new
3. cands = names -> join(runs, name)
     FILTER p:
       TRY st = statSync(p) CATCH: RETURN false               # new (mirror runDirsNewestFirst)
       RETURN st.isDirectory() AND existsSync(p/run-ledger.json)
4. IF cands empty: RETURN null                                # unchanged
5. RETURN sortRunDirsByMtimeDesc(cands)[0]                    # unchanged
```

**Fix 2 — `cmdRuncheck` (runcheck.js), around line 179:**

```
1. TRY runDir = resolveRunDir(positional[0])
2. CATCH:
   a. IF hook:      RETURN 0                                  # silent — Stop hook never crashes
   b. IF NOT hook:  stderr "runcheck: run-dir resolution failed: <message>"; RETURN 2
```

**Edge cases:**

- `.faff/runs` absent → `null` (unchanged).
- `.faff/runs` deleted between `existsSync` and `readdirSync`, or is a file (ENOTDIR) → `null` (new).
- One candidate vanishes pre-stat → excluded; remaining candidates still resolve (new).
- Every candidate vanishes → empty set → `null` (unchanged branch).
- Candidate vanishes between the filter's stat and `sortRunDirsByMtimeDesc`'s stat → `-Infinity`, sorts last (pre-existing tolerance); if it was the only candidate the resolved dir may be gone by ledger-read time — `readLedger`'s existing callers already handle that (hook: parse-catch → silent; CLI: fault exit). No new handling.
- Error categories: all resolution errors are terminal-for-this-scan and non-retryable within the call — the next hook firing rescans fresh.

**Anti-pattern:** widening the catch to swallow ledger-*read* faults or the explicit `--run-dir` absent-ledger fault into an all-clear. Why: FAFF-425 exists precisely because own-fault → all-clear made the orchestrator's fail-closed branch unreachable; this fix is about candidate *discovery* churn only.

## 5. SCENARIOS

```
Given a .faff/runs containing a dangling symlink and a valid run dir with a run-ledger.json
When latestRunDir resolves (driven via `faff runcheck --hook` or a direct helper call)
Then the valid run dir is resolved, the dangling entry is skipped, and nothing throws
```

```
Given a .faff/runs whose only entry is a dangling symlink
When `faff runcheck --hook` fires at turn-end
Then it exits 0 with no block payload and no crash (silent, as if no run exists)
```

```
Given a root where .faff/runs is a FILE, not a directory
When `faff runcheck --hook` fires
Then readdirSync's failure is absorbed, resolution yields null, exit 0, silent
```

- All existing `runcheck --selftest` cases and `test/runcheck-gate.test.mjs` cases pass unchanged (exit codes and stdout/stderr shapes byte-identical on non-churn paths).

## 6. DESIGN DECISION RATIONALE

- **Fix locus:** shared `latestRunDir` + one call-site catch — **Chosen:** above; rejected per-caller catches (leaves future callers exposed) and hook-only fix (leaves the other nine callers throwing).
- **Excluded vs sort-last for unstat-able candidates** — **Chosen:** excluded; rejected `-Infinity`-style inclusion (a filter is candidacy, not ordering; mirrors `runDirsNewestFirst`).
- **readdir catch included** — **Chosen:** yes; rejected stat-only (same TOCTOU class one call earlier; two-line cost).
- **fs-driven regression test over pure selftest row** — **Chosen:** `test/runcheck-gate.test.mjs` with dangling-symlink fixtures; rejected adding fs to `RUNCHECK_SELFTEST_CASES` (breaks the FAFF-205 pure-decision invariant). At the time of writing the selftest table is `(ledger, env)`-pure by design.
- **Hook catch maps to silent 0, CLI catch to exit 2** — **Chosen:** parity with the existing parse-error-silent and missing-ledger-exit-2 conventions in the same function; rejected a new exit code or warning channel (no precedent, no consumer).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** the node test runner suite under `test/*.test.mjs` is the CI-gated test surface. Validation: `.github/workflows/validate.yml:245` runs `node --test`, which picks up `test/runcheck-gate.test.mjs`; confirm before starting.
- **Assumes:** `symlinkSync` is usable in the test environment (POSIX runners). Validation: `test/doctor.test.mjs` already relies on it in this repo's CI.

## 8. DONE — Definition of Done

### From WHY
- [ ] A run dir deleted mid-scan can no longer produce an uncaught exception on the `runcheck --hook` turn-end path.

### From WHAT (behaviour contract)
- [ ] `latestRunDir` returns the newest *surviving* candidate when an entry vanishes mid-scan (unstat-able entry excluded, scan continues).
- [ ] `latestRunDir` returns `null` (never throws) when `readdirSync` on `.faff/runs` fails.
- [ ] `cmdRuncheck` wraps run-dir resolution: hook mode → exit 0 silent on a resolution throw; non-hook mode → stderr message + exit 2.

### From HOW (edge cases)
- [ ] Dangling-symlink-only `.faff/runs` → `runcheck --hook` exits 0, empty stdout.
- [ ] `.faff/runs`-is-a-file → `runcheck --hook` exits 0, empty stdout.
- [ ] `resolveLedgerOrFault` and `sortRunDirsByMtimeDesc` are byte-unchanged (no loosening of FAFF-425 fail-closed paths).

### From SCENARIOS (tests)
- [ ] New tests in `test/runcheck-gate.test.mjs` cover: dangling symlink + valid dir resolves the valid dir; dangling-symlink-only hook run exits 0 silent; runs-as-file hook run exits 0 silent.
- [ ] `faff runcheck --selftest` and the full existing test suite pass unchanged.

**Eval coverage:** no LLM-judgement seam introduced or changed — not applicable.

**Integration smoke test:**

```
1. In a tmp root, create .faff/runs/{RUN-A (valid ledger), dangling-link}
2. Run `node bin/faff runcheck --hook` with cwd at the root
3. Expect exit 0 and no crash; remove RUN-A, rerun, expect exit 0 silent
```

## Already shipped against this surface

Related Done work — none of it supersedes this premise:

- FAFF-337 — made `latestRunDir` order by mtime and introduced `sortRunDirsByMtimeDesc` *with* the stat catch; the candidate-filter stat (this bug) stayed bare.
- FAFF-205 / FAFF-233 / FAFF-235 / FAFF-355 — hardened the hook's *decision* logic (ownership, liveness, heartbeat overlay); the hook's *resolution* path was untouched.
- FAFF-425 — made governance CLIs fail closed on own read faults; constrains this fix (see the design principle) rather than delivering it.

## Build serialisation note

FAFF-574 (events.js) and FAFF-575 (heartbeat.js / ledger writers) were specced in this same run; this spec touches only `shared-infra.js`, `runcheck.js`, and `test/runcheck-gate.test.mjs` — no file overlap, no build serialisation required.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single sub-day unit: one shared helper, one call-site catch, three regression tests. Nothing to split; no always-ships-together sibling to merge (FAFF-574/575 are independent files from the same audit batch).
- **Workstream fit?** No issues — hardening of the governance Stop-hook family, cohesive with the external-critique remediation stream it was filed from.
- **Deps surfaced?** No issues — no implicit dependencies; explicitly disjoint from the FAFF-574/575 specs attached this run (see the build serialisation note).
- **Risk profile?** No issues — mechanical robustness fix mirroring an existing in-file pattern; no novel integration, no de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
