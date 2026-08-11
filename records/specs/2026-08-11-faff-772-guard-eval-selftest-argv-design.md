# Spec — FAFF-772: Guard the `eval` member's selftest argv (`eval affected --selftest`)

> Spec: faffter-dark-nlspec · 2026-08-11 · autonomous · confidence: high. Full spec on Linear FAFF-772.

This is an nlspec-format spec for **FAFF-772**, a Test-coverage ticket. Its audience is the build agent that will implement the change and the human reviewers who gate it. The deliverable is small and mechanical: correct one wrong entry in the registry selftest argv table and add a unit-test assertion that locks the correct value in, so a future regression to the wrong argv fails loud in the fast test suite rather than passing unnoticed.

## 1. WHY — Problem and Principles

**Load-bearing model.** The registry selftest sweep (`faff regions selftest`) does not know how to invoke each member's selftest — it looks the invocation up in a static table, `REGION_SELFTEST_ARGV`, mapping each CLI subcommand to the exact argv array it spawns as a child process (`spawnSync(node, [ENTRYPOINT, ...argv])`, expecting exit 0). There is no runtime argv correction anywhere; whatever the table stores is spawned verbatim. So the table entry for a sub-verb command like `eval` **must already be the runnable sub-verb form** or the spawn fails. The "silent correction" the ticket names is exactly this: the value has to be right at rest — nothing fixes it up.

**Problem statement.** The `eval` entry in `REGION_SELFTEST_ARGV` (regions.js line 305) is `["eval", "--selftest"]`, but `cmdEval` rejects any first token other than `affected` with a usage error (exit 2), so the only runnable form is `["eval", "affected", "--selftest"]`. The wrong entry makes `faff regions selftest --region factory` report the `eval` row as `FAIL (exit 2)` and the sweep as `FAIL`, yet nothing catches it because CI runs only the `governance` region and no test asserts any `REGION_SELFTEST_ARGV` value. This change corrects the entry and adds an explicit assertion locking it to the sub-verb form, so a regression fails in the unit suite.

**Design principles.**

**The stored argv is the single source of truth for what the sweep spawns — the guard locks the value, it does not re-derive it.** The correct form is a fact about `cmdEval`'s contract (first token must be `affected`), not a matter of taste. The test asserts the literal expected array by deep-equality, so it fails on *any* drift away from `["eval", "affected", "--selftest"]` — not just the specific historical mistake.

**Keep it in the fast unit suite.** The guard must run under `node --test` in every CI job (it already runs the whole `test/*.test.mjs` suite), not depend on spawning the real CLI or on the factory sweep being wired into CI. A pure deep-equal against the imported module value is instantaneous and has no process/fixture dependencies.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/regions.js` (line 305, `REGION_SELFTEST_ARGV`) | JavaScript (CommonJS) | Holds the entry to correct; exported at line 881 |
| `plugin/skills/faff/bin/lib/eval-affected.js` (`cmdEval`, lines 218–224) | JavaScript | Defines the contract: first token must be `affected` |
| `test/argv.test.mjs` | ESM `node:test` | Already imports `regionsMod` and iterates `REGION_MAP`; idiomatic home for the new assertion |
| `.github/workflows/validate.yml` (line 242 governance-only; line 260 `node --test`) | YAML | Why the bug went unnoticed, and where the new test runs |

**Scope statement.** This sits at the registry-selftest layer of the faff CLI: it corrects one factory-region member's selftest invocation and pins it with a test, without touching the sweep runner, the meta-selftest, or CI's region selection.

## 2. OUT OF SCOPE

- **Wiring the full `regions selftest --region factory`/`all` sweep into CI.** — Why excluded: that is FAFF-581's job (open PR #605, "registry-derived CLI selftest battery, coverage gate"), which spawns every registry entry in CI and would independently catch this argv. Extension point: `.github/workflows/validate.yml` around line 242, adding a `--region factory`/`all` step — owned by FAFF-581, not this ticket.
- **Argv-validity assertions for other registry members beyond `eval`.** — Why excluded: the ticket is scoped to the `eval` member; a per-member battery is FAFF-581's coverage gate. Extension point: `test/argv.test.mjs` (or a new `test/region-selftest-argv.test.mjs`) could iterate `REGION_SELFTEST_ARGV` once FAFF-581 lands.
- **Coverage-measurement / spawn-every-entry plumbing.** — Why excluded: no coverage instrumentation is in scope for a one-entry fix. Extension point: `regionsSelftestRun` in regions.js is where a spawn-all coverage gate would attach.
- **Strengthening the meta-selftest `regionsSelftest` to validate argv runnability.** — Why excluded: the meta-selftest checks table *shape* (map↔registry bijection, coverage, governance non-null, stale-null) not argv *runnability*, and expanding it is broader than this guard. Extension point: `regionsSelftest(COMMANDS)` in regions.js (~lines 713–724).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `REGION_SELFTEST_ARGV` | Static object in regions.js mapping each CLI subcommand → the argv array the sweep spawns (`["cmd", "--selftest"]`), or `null` for members with deliberately no standalone selftest |
| Sub-verb form | An argv whose first token is a sub-command (`affected`) before its flags, e.g. `["eval", "affected", "--selftest"]` — the only form `cmdEval` accepts |
| Registry selftest sweep | `faff regions selftest [--region …]` → `regionsSelftestRun`, which `spawnSync`s each member's stored argv expecting exit 0 |

**The entry, before and after.**

```
REGION_SELFTEST_ARGV["eval"]:
  BEFORE:  ["eval", "--selftest"]            # unrunnable — cmdEval rejects first token != "affected" (exit 2)
  AFTER:   ["eval", "affected", "--selftest"] # runnable — cmdEval → evalAffectedSelftest() (exit 0)
```

**Contract being honoured** (`cmdEval`, eval-affected.js lines 218–224): `sub = args[0]`; if `sub !== "affected"` → `usageError(… "unknown eval sub-verb '<x>' (expected 'affected')")` (exit 2). With `["affected", "--selftest"]`, `rest.includes("--selftest")` → `evalAffectedSelftest()` (exit 0, 9 cases pass).

**Design decisions.** The correction is a fact-not-taste fix: the sub-verb form is the only argv that runs, and the ticket names it explicitly.

**Chosen:** Correct `REGION_SELFTEST_ARGV["eval"]` to `["eval", "affected", "--selftest"]` — the sub-verb form is the sole runnable invocation per `cmdEval`'s contract; no alternative is valid.

## 4. HOW — Behavior

**Approach.** Two edits, both trivial:

```
PROCEDURE fix_and_guard:
  1. In plugin/skills/faff/bin/lib/regions.js, change the "eval" entry:
       "eval": ["eval", "--selftest"]  ->  "eval": ["eval", "affected", "--selftest"]
  2. In test/argv.test.mjs, add a node:test that deep-equals
       regionsMod.REGION_SELFTEST_ARGV["eval"] to ["eval", "affected", "--selftest"].
     (regionsMod is already imported at line 116; no new import needed.)
```

**The assertion.**

```
test("REGION_SELFTEST_ARGV['eval'] is the runnable sub-verb form — FAFF-772"):
  assert.deepEqual(
    regionsMod.REGION_SELFTEST_ARGV["eval"],
    ["eval", "affected", "--selftest"],
    "the eval member's selftest argv must be the sub-verb form; cmdEval rejects any first token != 'affected' (exit 2)"
  )
```

`assert.deepEqual` over the whole array is deliberate: it fails on the historical wrong form `["eval", "--selftest"]` **and** on any other drift (reordered tokens, a different sub-verb, a missing/extra flag). A single-index check would not.

**Placement.** `test/argv.test.mjs` already imports `regionsMod` (line 116) and reads `REGION_MAP`; adding the assertion there needs no new wiring. A small sibling `test/region-selftest-argv.test.mjs` is an acceptable alternative if the reviewer prefers a dedicated file — same import, same assertion. The argv.test.mjs home is preferred for minimal surface.

**Anti-pattern:** Asserting only `REGION_SELFTEST_ARGV["eval"][1] === "affected"`. Why: it passes for malformed variants like `["eval", "affected"]` (missing `--selftest`) or `["x", "affected", "--selftest"]`; deep-equal the full array instead.

**Anti-pattern:** Adding a test that spawns `faff eval affected --selftest` through the real CLI as the guard. Why: that re-tests `cmdEval`'s behaviour (already covered by `test/eval-affected.test.mjs`), not the *registry's stored argv* — the thing that regressed. The guard must read the table value directly.

**Edge cases.** The meta-selftest `regionsSelftest` and the bijection/coverage checks are unaffected — the key set of `REGION_SELFTEST_ARGV` is unchanged (only the `eval` value changes), so `REGION_SELFTEST_ARGV covers REGION_MAP exactly` still holds. No stale-null interaction: `eval` was and remains non-null.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The behavioural objective — the sweep can actually run the `eval` selftest, and a regression is caught — is above the bar; the mechanical edits are not.

```
Given the eval member's REGION_SELFTEST_ARGV entry has been corrected to ["eval","affected","--selftest"]
When `faff regions selftest --region factory` runs
Then the eval row reports PASS and the sweep RESULT is PASS (no members failed)
```

```
Given REGION_SELFTEST_ARGV["eval"] is regressed to any non-sub-verb form (e.g. ["eval","--selftest"])
When `node --test test/argv.test.mjs` runs
Then the FAFF-772 assertion fails (deepEqual mismatch)
```

## 6. Design Decision Rationale

**Which argv form is correct for the `eval` member?**
- `["eval", "--selftest"]` — the historical value (added wrong by FAFF-752, commit 8fc7e31). Con: `cmdEval` rejects it (exit 2); the sweep fails.
- `["eval", "affected", "--selftest"]` — the sub-verb form. Pro: the only invocation `cmdEval` routes to `evalAffectedSelftest()` (exit 0); the ticket names it explicitly.

**Chosen:** `["eval", "affected", "--selftest"]` — dictated by `cmdEval`'s contract, not preference.

**Where does the guard live, and what shape?**
- Deep-equal in `test/argv.test.mjs` — reuses the existing `regionsMod` import; runs in the fast unit suite; no CI change.
- New dedicated test file — cleaner topical home but adds a file for one assertion.
- Extend `regionsSelftest` meta-selftest to validate argv runnability — broader than this ticket (see OUT OF SCOPE).

**Chosen:** A `deepEqual` assertion in `test/argv.test.mjs` — smallest surface, idiomatic, runs everywhere `node --test` does.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.**

- **Assumes:** FAFF-581 (open PR #605) is not yet merged. Validation: `gh pr view 605 --json state` (or `git log --oneline | grep -i FAFF-581`). If it has merged and already spawns every registry entry in CI, this targeted guard is still independently valuable (documents the exact required argv, runs fast in the unit suite) — the builder should rebase onto it and avoid duplicating any assertion PR #605 introduces, not drop this one.
- **Assumes:** `cmdEval` in eval-affected.js still requires `args[0] === "affected"` (verified at spec time, lines 218–224). Validation: re-read `cmdEval`; if the contract changed to accept a bare `eval --selftest`, revisit the correct form before editing.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff regions selftest --region factory` exits 0 with the `eval` row reporting `PASS` (no members failed).

### From WHAT (the entry)
- [ ] `REGION_SELFTEST_ARGV["eval"]` in regions.js deep-equals `["eval", "affected", "--selftest"]`.
- [ ] The key set of `REGION_SELFTEST_ARGV` is unchanged (only the `eval` value changed); `faff regions selftest` still passes its `REGION_SELFTEST_ARGV covers REGION_MAP exactly` meta-check.

### From HOW (the guard)
- [ ] A `node:test` in `test/argv.test.mjs` (or a sibling `test/*.test.mjs`) asserts `regionsMod.REGION_SELFTEST_ARGV["eval"]` deep-equals `["eval", "affected", "--selftest"]`.
- [ ] The assertion fails if the entry regresses to any non-sub-verb form (e.g. `["eval", "--selftest"]`, reordered tokens, or a missing/extra token).
- [ ] The new test passes under `node --test` (the command CI runs at validate.yml line 260).

### Integration smoke test
```
PROCEDURE smoke:
  1. node --test test/argv.test.mjs           # the FAFF-772 assertion passes
  2. node plugin/skills/faff/bin/faff regions selftest --region factory
     # -> eval row PASS; final line "RESULT: PASS (… members, 0 failed)"
  3. (regression check) temporarily set the entry back to ["eval","--selftest"];
     re-run step 1 -> the assertion FAILS. Revert.
```

confidence: high
spec-review: approve
