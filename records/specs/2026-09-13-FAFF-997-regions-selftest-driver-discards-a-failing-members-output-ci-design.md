# Surface a failing member's captured output in the regions selftest driver

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-997.

This spec addresses FAFF-997 for the build agent and human reviewers. The `faff regions selftest` driver spawns each member's own `--selftest` as a subprocess and prints a one-line-per-member summary. On a member failure the driver reads only the child's exit status and discards its captured `stdout`/`stderr`, so the CI log names the failing member but none of its failing sub-check lines — making a red run undiagnosable without a manual local reproduction. This change surfaces a failed member's captured output beneath its `FAIL` line while leaving the passing-path output byte-identical.

## 1. WHY — Problem and Principles

**The load-bearing model.** The driver already captures each child's output (`spawnSync(..., { encoding: "utf8" })` populates `r.stdout`/`r.stderr`), but on the failure branch it consumes only `r.status`. The captured text exists in memory and is thrown away. The fix is not to gather new information — it is to print information the driver already holds, and only on the failure path.

**Problem statement:** A factory member that fails its selftest in CI shows only `FAIL (exit N)` and a `RESULT: FAIL` summary. Because the member's own `ok`/`not ok` sub-check lines are discarded, a reviewer cannot tell a real regression from a flake without checking out the branch and re-running the member selftest by hand (this cost real time on PR #848 / FAFF-959). Echoing the failed member's captured output makes the failing sub-check visible directly in the CI log.

**Design principles:**

- **The happy path is sacred.** The one-line-per-member summary exists because the battery has ~104 members; a full dump per member would drown the signal. Detail is emitted *only* for members that fail, so a green run's output is unchanged to the byte.
- **Diagnosability is the whole point.** Where a choice trades diagnosability for terseness on the *failure* path, favour diagnosability — a failing CI run is exactly when the reader needs the detail.
- **Driver-only, no member changes.** No member's own selftest is touched; the change lives entirely in the `regionsSelftestRun` driver so it cannot perturb what any member prints.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/regions.js` (`regionsSelftestRun`, ~L977–1018) | Node.js | The driver being changed — spawns members, prints the summary table. |
| `plugin/skills/faff/bin/lib/regions.js` (`regionsSelftest(COMMANDS)`, ~L751) | Node.js | The fixtures-table selftest of the `regions` command itself, where the new assertion is added. |
| `.github/workflows/validate.yml` (L116, L119) | YAML | Invokes `faff regions selftest --region factory` / `--region governance` — the CI consumer whose log this fixes. |

**Scope statement:** A CI-diagnosability fix to one driver function in the faff CLI's `regions` module; it changes what the driver prints on failure, nothing about which members pass or fail.

## 2. OUT OF SCOPE

- **Member selftest output format** — Why excluded: the gap is in the driver, not any member; members already emit useful `ok`/`not ok` detail. Extension point: each member's own `--selftest` handler.
- **A `--verbose` / opt-in flag for failure detail** — Why excluded: detail is gated by *failure*, not by a flag (see Design Decision Rationale); a flag adds a way to accidentally re-hide the very detail CI needs. Extension point: `REGIONS_SPEC.flags` in `cmdRegions` if a future need for opt-in verbosity on the *pass* path arises.
- **Capping / truncating a pathologically long member's output** — Why excluded: only failing members print, failures are rare (typically one member), and each member selftest is a bounded in-memory table emitting tens of lines, so flood risk is low; adding a cap now is unwarranted complexity. Extension point: a `--max-detail-lines`-style cap in `regionsSelftestRun`'s detail-rendering helper if a member ever emits pathological volume.
- **The governance-member-without-a-selftest FAIL and the allowlist/stale-null MALFORMED exits** — Why excluded: those failure lines carry their own diagnostic text already and spawn no child, so there is no captured output to surface. Extension point: the `argv === null` branch and the pre-spawn drift guards in `regionsSelftestRun`.

## 3. WHAT — Behaviour surface

**Vocabulary:**

| Term | Definition |
|---|---|
| member | A command in `REGION_MAP` whose own `--selftest` the driver spawns. |
| detail block | The failed member's captured `stdout` + `stderr`, indented, printed beneath its `FAIL` summary line. |
| spawn result | The `spawnSync` return object `r` — carries `status`, `signal`, `error`, `stdout`, `stderr`. |

**The detail-rendering helper (new, pure, testable):**

```
FUNCTION regionsFailDetail(r) -> string:
  # r is a spawnSync-shaped result for a FAILED member.
  # Returns the indented detail block (possibly empty), WITHOUT the summary line.
  inputs:  r.stdout: string|null, r.stderr: string|null, r.error: Error|null, r.signal: string|null
  output:  a string; each non-empty source rendered as indented lines; "" when nothing to show
```

- The helper is a pure function of `r` (no I/O, no spawning) so it is unit-testable against a synthetic failing result.
- `regionsSelftestRun` calls it on the failure branch and prints its result (when non-empty) beneath the member's `FAIL` line.

**Behavioural contract of the helper:**

- Non-empty `r.stdout` is included, each line indented (e.g. two spaces) under a short `stdout:` label.
- Non-empty `r.stderr` is included, each line indented under a short `stderr:` label.
- On the timeout/spawn-error case (`r.status === null`): include `r.error.message` (when present) and/or `r.signal` under an `error:` label, in addition to any captured `stdout`/`stderr`.
- When every source is empty/absent, return `""` (no stray labels) — the summary line already reads `FAIL (exit N)` / `FAIL (exit timeout/error)`.

## 4. HOW — Behaviour

**Approach.** Extract the failure-detail formatting into the pure helper `regionsFailDetail(r)` and call it from the existing failure branch of `regionsSelftestRun`'s member loop. The summary line and the pass path are untouched.

```
PROCEDURE member_loop_iteration(cmd):   # only the spawned-member branch changes
  1. argv = REGION_SELFTEST_ARGV[cmd]
  2. IF argv === null: (governance FAIL / no-selftest) — UNCHANGED, no spawn, no detail.
  3. ELSE:
     a. r = spawnSync(node, [ENTRYPOINT, ...argv], { encoding: "utf8", timeout: 120000 })
     b. IF r.status !== 0: failed++
     c. status = r.status === 0 ? "PASS"
                 : `FAIL (exit ${r.status === null ? "timeout/error" : r.status})`   # UNCHANGED
     d. print the summary line: `${cmd.padEnd(width)}  ${region.padEnd(10)}  ${status}`   # UNCHANGED
     e. IF r.status !== 0:                                  # NEW
          detail = regionsFailDetail(r)
          IF detail !== "": print(detail)                  # indented block beneath the FAIL line
```

**Anti-pattern:** printing the detail block for a passing member, or before the summary line. Why: it breaks the byte-identical happy path and the readable member → status → detail ordering.

**Anti-pattern:** re-running the child to fetch output on failure. Why: the output is already captured in `r`; re-spawning doubles the wall-clock and can flip a flake.

**Edge cases:**

- `r.status === null` (timeout or spawn error): the summary line already says `FAIL (exit timeout/error)`; the detail block adds `r.error.message` / `r.signal` so the opaque case names its cause.
- Empty captured output on a genuine non-zero exit: helper returns `""`; only the (unchanged) summary line prints — no empty `stdout:`/`stderr:` labels.
- Trailing newlines in captured output: normalise so the block does not emit a run of blank indented lines (trim trailing whitespace before indenting).

## 5. SCENARIOS — born-verifiable objectives

```
Given a member whose spawned selftest exits non-zero with sub-check text on stdout/stderr
When regionsSelftestRun processes that member
Then the member's captured stdout and stderr are printed, indented, beneath its FAIL summary line
```

```
Given a member whose spawned selftest passes (exit 0)
When regionsSelftestRun processes that member
Then only the single PASS summary line is printed for it — no detail block (happy path byte-identical)
```

```
Given a spawn result with status === null and an error message/signal (timeout or spawn error)
When regionsFailDetail renders it
Then the rendered detail includes the error message and/or signal
```

## 6. DESIGN DECISION RATIONALE

**Always surface detail on FAIL, or gate it behind a `--verbose`/CI flag?**
- Options: (a) always print detail on failure; (b) gate behind a flag.
- (a) makes every red CI run diagnosable with no configuration; (b) risks a red run that is still opaque because the flag was not set — the exact failure mode this ticket exists to remove.
- **Chosen:** always print detail on the failure path, no flag — the issue's own stated lean, and diagnosability is the whole point. Passing members print nothing extra, so there is no happy-path cost to weigh against it.

**Print captured output in full, or truncate it?**
- Options: (a) print in full; (b) cap/truncate per member.
- Only failing members print, failures are typically a single member, and each member selftest is a bounded in-memory table (tens of lines). A cap adds head/tail-selection complexity and risks eliding the one failing line.
- **Chosen:** print in full; leave a per-member cap as a documented OUT OF SCOPE extension point should a member ever emit pathological volume.

**Extract a pure helper, or inline the formatting in the loop?**
- Options: (a) pure `regionsFailDetail(r)` helper; (b) inline `console.log`s in the failure branch.
- The driver spawns real subprocesses, so asserting surfaced detail end-to-end is awkward; a pure helper over a synthetic spawn result is directly unit-testable and keeps the loop thin.
- **Chosen:** extract `regionsFailDetail(r)` and assert it in the `regions` selftest fixtures; the loop just calls and prints it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — both questions raised in the ticket are resolved above.

**Assumptions:** none beyond the current code shape, which the explore step confirmed against `regions.js` at `regionsSelftestRun` (~L1010) and `regionsSelftest` (~L751).

## 8. DONE — Definition of Done

### From WHY
- [ ] A member that fails its spawned selftest prints its failing sub-check detail in the driver output (no manual reproduction needed to see which check failed).

### From WHAT / HOW (behaviour)
- [ ] A pure helper (`regionsFailDetail(r)` or equivalent) renders a failed member's captured `stdout` and `stderr` as an indented block, and returns `""` when there is nothing to show.
- [ ] `regionsSelftestRun` prints the helper's non-empty result beneath the member's `FAIL` summary line, on the `r.status !== 0` branch only.
- [ ] The `status === null` (timeout/spawn-error) case surfaces `r.error` message and/or `r.signal` in the detail.
- [ ] The passing-member path is byte-identical to before (only the single summary line; no detail block).
- [ ] The `argv === null` governance-FAIL / no-selftest branch is unchanged (no spawn, no detail block).

### From HOW (edge cases)
- [ ] Empty captured output on a non-zero exit emits no stray `stdout:`/`stderr:` labels (helper returns `""`).
- [ ] Trailing whitespace in captured output does not produce runs of blank indented lines.

### Tests
- [ ] The `regions` selftest (`faff regions --selftest`, the `regionsSelftest(COMMANDS)` fixtures) is extended with at least one case asserting `regionsFailDetail` surfaces a synthetic failing result's `stdout`+`stderr` (indented), and returns `""` for an empty result.
- [ ] `faff regions --selftest` passes; `faff regions selftest --region factory` and `--region governance` continue to pass on a clean tree.

**Integration smoke test:**
```
Construct a synthetic spawn result r = { status: 1, stdout: "ok 1\nnot ok 2 - boom\n", stderr: "", error: null, signal: null }
Assert regionsFailDetail(r) contains an indented "not ok 2 - boom" line
Assert regionsFailDetail({ status: 1, stdout: "", stderr: "", error: null, signal: null }) === ""
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues. One concern (the driver's failure-path output), a single sub-day change to one function plus one test — a clean 1–3 day unit; no split or merge indicated.
- **Workstream fit?** No issues. Straightforward CI-diagnosability / developer-tooling work, cohesive with the `regions` governance surface it sits in.
- **Deps surfaced?** No issues. No implicit dependency — `regionsSelftestRun` already captures the output; the change only prints it. The `relatedTo` links (FAFF-959, FAFF-1038) are context, not blockers, and neither gates this work.
- **Risk profile?** No issues. No novel integration or external dependency; the passing path is untouched and the change lands via PR (revertible). No de-risking spike warranted.

confidence: high
build-tier: standard
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
