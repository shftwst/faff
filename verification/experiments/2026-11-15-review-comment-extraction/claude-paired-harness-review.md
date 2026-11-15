# Claude Code review: paired harness patch

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no implementation edits, no credential read, no model request.

## Verdict

No false pass, admission bypass or must-fix accounting defect was found.

- One acceptance gap, not a false pass: in a real run, the original strict comparison will report every pair as `incomplete` and compare no events. The actual event differences appear only in the new per-pair classification. The tests never exercise this because their scripted drivers report equal runtimes. Pin it with a test and say it in the report.
- Five advisories follow.
- The production planner and the reduced caller prose are still pending, so no paired readiness can be produced yet. That is expected: the preflight command probe fails closed.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `paired-harness-review.patch`, 69,694 bytes, SHA-256 `44900c0db18af57683f475f3b000a5f8ac702d366a1fc71690554b1704652455` |
| Base | `ba93d04b`. Its `candidate-command.mjs`, `claude-driver.mjs`, `tool-server.mjs` and `command-use.mjs` are byte-identical to the adapter reviewed in `claude-adapter-final-review.md` |
| Review tree | Fresh detached worktree at `ba93d04b`: `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-wt5`. The patch applied cleanly |
| New files | `eval/control-parity/{paired.mjs, treatments.mjs, intended-differences.json, PAIRED-RUNS.md}`, `test/control-parity-treatment.test.mjs` |
| Changed files | `run.mjs`, `command-use.mjs` (`COMMAND_LIMITS`), `tool-server.mjs` (limits from the binding), `test/control-parity-run.test.mjs` (+171 lines) |

## Validation run

| Command (in the review tree) | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `node --test test/control-parity-treatment.test.mjs` | 6 | 6 | 0 | 0 |
| `node --test test/control-parity-run.test.mjs` | 39 | 39 | 0 | 0 |
| `node --test test/control-parity-command.test.mjs` | 15 | 15 | 0 | 0 |
| `node --test test/control-parity-command-use.test.mjs` | 13 | 13 | 0 | 0 |
| `node --test test/control-parity*.test.mjs` | 169 | 169 | 0 | 0 |

## Probes (local, no model calls)

| Probe | Result |
|---|---|
| `validateDeclarations` on the real committed `intended-differences.json`, `policy-decisions.json` and historical `run.json` | Accepted: 4 entries |
| Declare the fenced-example case, whose historical baseline conformed | Refused: "historical difference is not complete" |
| Duplicate entry; decision not covering the case; extra key such as `any_difference` | Each refused |
| Empty `entries` list | Accepted. This only removes exemptions, and the manifest binds the declarations hash |
| Runtime normalisation (`treatmentRuntime`) over the 11 historical first requests (CLI 2.1.311) and the historical preflight capture | Exactly 1 distinct raw hash and 1 common hash across all 12. The only top-level field that varied was `metadata` (session user id, removed). So no false runtime stop is expected on an unchanged CLI |
| `classifyPair` on a declared case: exact historical baseline with a conforming candidate that followed the command | `declared-change` |
| Same, with the baseline altered by one byte in the write body | `unexpected-difference` |
| Same, with the command not used | `command-not-followed` |
| Same, with a runtime mismatch | `incomplete` |
| Conforming candidate used as both arms | `preserved` |
| Real stdio tool server given a manifest-style candidate object (`{ binding, limits: { maxCalls: 1 } }`) | First call returns a plan; the second gives `command-call-limit`. Bound limits reach the server |

The code and the new tests also cover:
- refusals before paid work for candidate drift, changed declarations, duplicate or unbound schedules, a changed Claude CLI and changed unrelated system context;
- source and runtime drift stopping the batch between executions, with every remaining execution kept as `not-run`;
- a 22-execution schedule using both arm orders;
- held reservations reported apart from observed cost.

## Acceptance gap: the strict comparison is uninformative in a real paired run

- What the code does: each trace's `runtime_sha256` folds in the observed request fingerprint (`captureScenario`, from `runtimeFingerprintOfBody`), and that fingerprint includes `system` and `tools`. The candidate arm differs in both by design. `compareRuns` stops at `unpaired-runtime` before comparing events (`schema.mjs:228`).
- Real-driver result: every key in `comparison.json` is `unpaired-runtime`, and `comparison.status` is `incomplete`, even when `report.status` is `complete`.
- Why the tests miss it: the scripted drivers in `test/control-parity-run.test.mjs` return no `observed_runtime_sha256`, so both arms carry the same runtime hash. The tests then see `comparison.status` `pass` or `fail` (lines 258, 263), which a real run never produces.
- Repro: run `runCommandPairs` with a scripted driver that returns a different `observed_runtime_sha256` for each arm. `comparison.differences` then holds only `unpaired-runtime` entries.
- Ticket 2, acceptance 3: it asks that the "original strict comparison still exposes actual effect differences". The patch meets the intent through `pairs[].event_differences`, which compares projections regardless of runtime. `PAIRED-RUNS.md` mentions the changed fingerprints. However, the original comparator itself exposes nothing.
- Recommended fix:
  - add a test with differing per-arm fingerprints that pins the expected `comparison.json` content;
  - state in `report.json` that strict-comparison incompleteness from the declared treatment is expected;
  - or run `compareRuns` once more on traces with the treatment-normalised runtime, so the strict event comparison produces a result.

## Advisories

1. **Only the first request is checked against readiness.** The raw and common hashes come from `001.request.json` only, so a runtime change on a later turn of the same attempt is not caught here. The proxy still enforces model, effort, output ceiling and the allowed tools on every request.
2. **Extra candidate reads count as differences.** The projection includes reads. A candidate that reads comments twice, with the correct write and final state, is `unexpected-difference` on an undeclared case. It errs towards failing; a declared case accepts it. Record this as the intended strictness, so a re-read in the reduced prose is not a surprise.
3. **Observed token totals are lower bounds without a count.** `observed_tokens` sums only the requests that reported a value; `requests_with_unknown_cost` flags missing cost. A count of contributing requests for each token field would make the partial totals clear.
4. **No per-arm totals.** The report carries per-attempt costs and tokens and ledger-level totals, but no per-arm sums. Ticket 3, acceptance 6, can be met from the per-attempt rows; a per-arm summary would save the reader the arithmetic.
5. **Index-based event differences.** One inserted event marks every later index as different. This is cosmetic.

## Not claimed by this patch (documented scope)

- The production planner and reduced caller. Preflight's command probe fails until the planner exists. At the base, `faff review-comment` is an unknown subcommand.
- A fresh Claude comparison. It needs `CLAUDE_CODE_OAUTH_TOKEN` in a launcher shell, plus a fresh `prepare-pairs` against the installed CLI (2.1.325, not the 2.1.311 recorded in history).
- The ticket 1 rule for duplicate comment ids, and the `blocked` grading rule.

## Housekeeping

There are now five scratch review worktrees, `review-wt` to `review-wt5`, under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad`. `git worktree prune` cleans them up once the scratchpad is cleared.
