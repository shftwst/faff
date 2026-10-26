# economics `--by` breakdowns read the ambient session instead of the resolved one

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1380.

This spec addresses FAFF-1380 for the build agent and any human reviewer picking up the PR. It is a scoped bug fix inside `plugin/skills/faff/bin/lib/economics.js`'s `cmdEconomics` function — no new types, no new surface, two one-line changes plus test coverage for the gap that let the bug ship.

## 1. WHY

**The load-bearing fact: `effectiveEnv` already exists and is already correct — two call sites just don't read it.** `cmdEconomics` resolves which session's transcript to meter under the FAFF-560 precedence (`--session-id` flag → the open budget span's own `session_id` → the ledger's mint-time `measure_session_id` → ambient `process.env`) into a local variable, `effectiveEnv` (`economics.js:1259`). The top-line token total already reads through this variable. Three `--by` branches independently re-read the transcript to build their breakdown rows, and only one of the three uses `effectiveEnv`.

**Problem statement.** On a resumed run with no ambient `CLAUDE_CODE_SESSION_ID` (the common case for an unattended resume — a fresh process with no inherited env var), the top line correctly meters the open span's session, but the `effort`, `class`, `model`, `day`, and `mcp` breakdowns silently read `process.env` instead — which, with no ambient session set, resolves to no session at all, degrading those breakdowns to the empty/estimate path. Any `--session-id` override is likewise ignored by the same two branches. This fix makes all three branches share the single resolved session, matching the top line.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/economics.js` | JavaScript | The file this spec changes — `cmdEconomics`, the three `--by` branches, `readRunTranscriptRecords` / `readRunTranscriptRecordsByFile` |
| `test/economics.test.mjs` | JavaScript (node:test) | Existing FAFF-933 resumed-run fixtures and CLI-level integration tests this spec extends |
| FAFF-933 (Done) | — | Introduced `effectiveEnv` and the cross-epoch fold this bug sits inside; its own test suite is the reason the gap went unnoticed (see below) |
| FAFF-560 (Done) | — | Defined the session-resolution precedence `effectiveEnv` implements |

**Scope statement.** This is a two-line fix inside one existing function, plus the test coverage that should have caught it; it does not touch the FAFF-933 cross-epoch fold logic, the precedence resolution itself, or any other `faff economics` behaviour.

## 2. OUT OF SCOPE

- **The `--by phase` branch.** Already reads `effectiveEnv` (`economics.js:1581`) — nothing to change there. It is the reference implementation this spec's two fixes bring the other branches in line with.
- **Any change to the FAFF-560 precedence or `effectiveEnv`'s resolution itself** (`economics.js:1250–1259`). This spec consumes that variable; it does not alter how it is computed.
- **The epoch-fold logic for `--by class` / `--by model`** (closed-span row merging, FAFF-933). Unaffected — this spec only changes which transcript the fold reads from, not how the fold itself works.

## 3. WHAT — Design decisions

**Decision: which variable the two branches should read.**

| Option | Pros | Cons |
|---|---|---|
| Read `effectiveEnv` (what the top line and the phase branch already use) | One resolved session for the whole command; matches the existing, working pattern; zero new concepts | None |
| Introduce a second resolution path specific to these branches | — | Would reintroduce the exact drift this bug already demonstrates — rejected outright |

**Chosen:** read `effectiveEnv` at both remaining call sites, exactly as the phase branch already does. No new resolution logic.

## 4. HOW

**The two call sites to change**, both inside `cmdEconomics` (line numbers as of this writing; locate by the branch's behaviour if they've drifted — the `effort`-axis branch and the branch serving `class`/`model`/`day`/`mcp`):

```
economics.js:1564 (--by effort branch):
  BEFORE: const { records } = readRunTranscriptRecords(root, process.env, runStartMs);
  AFTER:  const { records } = readRunTranscriptRecords(root, effectiveEnv, runStartMs);

economics.js:1589 (generic branch — serves --by class | model | day | mcp):
  BEFORE: const { records } = readRunTranscriptRecords(root, process.env, runStartMs);
  AFTER:  const { records } = readRunTranscriptRecords(root, effectiveEnv, runStartMs);
```

No other line in either branch changes. `--by mcp` and the `else` sub-branch (`class`/`model`/`day`) both consume the same `records` value from the single call at `economics.js:1589`, so fixing that one call site fixes all four axes at once; `--by effort` is the fourth distinct call site and needs its own fix at `economics.js:1564`.

**Why this is safe by construction — the single-session case.** `effectiveEnv` is defined (`economics.js:1259`) as:

```
PROCEDURE resolve_effective_env(sessionIdFlag, openSpanSessionId, mintSessionId):
  1. measureSessionId = sessionIdFlag OR openSpanSessionId OR mintSessionId OR null
  2. IF measureSessionId is null:
       effectiveEnv = process.env           # the SAME reference, not a copy
  3. ELSE:
       effectiveEnv = { ...process.env, CLAUDE_CODE_SESSION_ID: measureSessionId }
```

On any run with no `budget.sessions` array (every single-session run — today's overwhelming majority case) `measureSessionId` is `null`, so `effectiveEnv IS process.env` — the literal same object, not a value that happens to match. Swapping `process.env` for `effectiveEnv` at the two call sites is therefore a no-op on every single-session fixture in the existing suite: nothing to assert beyond "the existing suite still passes," which is the acceptance criterion's byte-identical-output bullet. The resumed case is the only one where the two diverge, and that is exactly the case this fix targets.

**Edge cases already handled by `effectiveEnv` and inherited for free:**
- A `--session-id` flag overrides everything, including a resumed run's open-span session — both fixed branches now honour it, where before they ignored it (acceptance bullet 2).
- No ambient session, no override, no resumed sessions array (the "nothing to resolve" case) — `effectiveEnv` degrades to `process.env`, and `readRunTranscriptRecords`/`readRunTranscriptRecordsByFile` already degrade to the empty/estimate result on an absent session, unchanged.

## 5. SCENARIOS

```
Given a resumed run (a budget.sessions array with one closed prior-epoch span
  and one open span) with NO ambient CLAUDE_CODE_SESSION_ID set
When `faff economics --by <axis>` runs for axis in {class, model, day, mcp, effort}
Then the breakdown reads the open span's session transcript (not the empty/estimate
  path). For class/model — whose FAFF-933 fold is in scope — this means
  reconciliation.reconciles is true against the EPOCH-SPANNING total (closed +
  open). For day/mcp/effort — which FAFF-933 deliberately never folds across
  epochs (unaffected, out of scope here) — it means the breakdown's rows are
  built from the open span's transcript rather than coming back empty; day's own
  reconciliation reconciles against its RESUMING-EPOCH-ONLY total (not the
  run-scoped tokens_total), mcp's rows carry the fixture's actual tool-call
  counts/bytes rather than reading as zero, and effort's priced_at_model
  resolves to the fixture's real dominant model rather than null.
```

```
Given the same resumed run, with --session-id <other> passed
When `faff economics --by <axis>` runs for axis in {class, model}
Then the breakdown is built from <other>'s transcript, matching the top line's
  already-correct precedence
```

```
Given a single-session run with an ambient CLAUDE_CODE_SESSION_ID set (today's
  common case, unchanged by this fix)
When `faff economics --by <axis>` runs for any axis
Then output is byte-identical to before this change
```

## 6. DESIGN DECISION RATIONALE

**Why fix the call sites rather than add a wrapper or helper?** The phase branch already demonstrates the correct, minimal pattern (pass `effectiveEnv` where the branch today passes `process.env`). Introducing a wrapper function for two call sites that already share a variable in scope would be indirection with no payoff.

**Chosen:** two one-line substitutions, no refactor, no new abstraction — rationale above.

**Why did FAFF-933's own test suite not catch this?** Every FAFF-933 resumed-run breakdown test sets `CLAUDE_CODE_SESSION_ID` in the test's environment to the open span's own session id (e.g. `CLAUDE_CODE_SESSION_ID: "epoch-1"` matching `openSpan("epoch-1")`). Under that setup `process.env.CLAUDE_CODE_SESSION_ID` and `effectiveEnv.CLAUDE_CODE_SESSION_ID` resolve to the identical value, so the two reads produce identical output and the bug is invisible. The one test that runs with no ambient session id ("FAFF-933: session PRECEDENCE meters the open span's own session…", `test/economics.test.mjs:1403`) asserts only `tokens_total` (the top line) — it never runs with `--by`, so it never exercises a breakdown branch. This spec's test additions close exactly that gap: a no-ambient-session resumed fixture per breakdown axis.

**Chosen:** add one test per affected axis, modelled on the existing `test/economics.test.mjs:1403` fixture but asserting the breakdown (not just the top line), per the DONE checklist below.

**Why do `day`/`mcp`/`effort` need axis-specific assertions instead of one shared template?** A round-1 draft of this spec asserted the same two things — "closed span tokens in the rows" and "reconciliation reconciles" — uniformly across all five axes. Spec review's architectural and QA lenses independently caught that this is unsatisfiable (or non-discriminating) for three of the five: `day`/`mcp`/`effort` never fold the closed span (FAFF-933 design, out of scope here), so "closed-span tokens in the rows" is false for a *correct* build on those axes, and `mcp`'s own `reconciles` flag is a vacuous identity that is `true` over zero rows regardless of this fix. Each axis's DONE item now names the field this fix actually changes for that axis (verified against the relevant breakdown core in `economics.js`), so a pre-fix run of each new test fails for the reason the fix addresses.

**Chosen:** axis-specific DONE/test assertions (above), not one templated assertion reused five times — rationale above.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None. The fix is fully determined by the existing `effectiveEnv` pattern the phase branch already demonstrates, and the test fixtures/helpers (`fixture`, `withRecords`, `twoEpochLedger`, `closedSpan`, `openSpan`, `run`) already exist in `test/economics.test.mjs` for the new tests to reuse without modification.

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] `economics.js:1564` (the `--by effort` branch's `readRunTranscriptRecords` call) passes `effectiveEnv`, not `process.env`.
- [ ] `economics.js:1589` (the generic branch serving `--by class|model|day|mcp`) passes `effectiveEnv`, not `process.env`.
- [ ] No other line in either branch, and no line in the `--by phase` branch, changes.

### From HOW (behaviour)

**Revision note (round 2, folding the spec-review design lenses' objections):** the round-1 draft asserted "the closed span's model/class tokens are present in the rows" as a blanket requirement across all five axes. That is wrong for `day`/`mcp`/`effort`: FAFF-933 deliberately never folds a closed span into those three (out of scope here, unaffected by this fix), so a *correct* post-fix `--by day` build on this spec's own fixture reports the resuming epoch's 100 tokens, not 600, and carries no closed-span row at all — the existing test `test/economics.test.mjs:1511` ("`--by day` does NOT fold … and NAMES its epoch-scoping") already pins exactly this. The items below are now axis-specific, each checked against what `readRunTranscriptRecords(root, effectiveEnv, …)`'s fix actually changes for that axis (verified against `economics.js`'s `economicsBreakdown` / `economicsMcpBreakdown` / `economicsEffortBreakdown` cores), so each pre-fix run of the new test fails for a reason the fix addresses, not an incidental one:

- [ ] New test — `--by class` and `--by model`: a resumed-run fixture (one closed prior-epoch span + one open span, per the existing `twoEpochLedger`/`closedSpan`/`openSpan` helpers) with **no** `CLAUDE_CODE_SESSION_ID` in the test environment, run with `--by class --json` and separately `--by model --json`. Asserts `breakdown.reconciliation.reconciles === true` against the **epoch-spanning** total (closed + open — `target = topLineTotal + closedFolded` in `economicsBreakdown`, and `closedFolded` is non-zero only for these two axes), and that the closed span's model/class tokens appear in the rows. Pre-fix this fails: `readRunTranscriptRecords(root, process.env, …)` returns no records under no ambient session, so `grand_total` is the closed span's tokens alone (e.g. 500) against a 600 target — `reconciles: false`.
- [ ] New test — `--by day`: same resumed-run fixture, no ambient session, run with `--by day --json`. `day` never folds the closed span (`closedFolded` is always 0 for `day`), so its reconciliation target is `topLineTotal` alone — the **resuming-epoch-only** total (100 in the canonical fixture), not the run-scoped `tokens_total` (600). Asserts `breakdown.reconciliation.reconciles === true` against that 100 **and** `breakdown.reconciliation.grand_total === 100` (i.e. the open span's own tokens appear in the row, not zero). Pre-fix this fails: with no transcript records read, every day row is absent, so `grand_total` is 0 against a 100 target — `reconciles: false`.
- [ ] New test — `--by mcp`: same resumed-run fixture, but the open span's transcript additionally contains at least one `mcp__`-prefixed `tool_use`/`tool_result` pair. Run with `--by mcp --json`. **Do not assert `reconciliation.reconciles` as the discriminator** — `economicsMcpBreakdown`'s `reconciles` is a cache-read-attribution identity that holds trivially (`0 === 0`) over zero rows, so it is `true` both pre- and post-fix and proves nothing on its own. Instead assert `breakdown.rows.length > 0` and that the row for the fixture's tool name carries the expected `call_count` (and non-zero `request_bytes`/`response_bytes`). Pre-fix this fails: no transcript records are read, so `rows` is empty regardless of what the transcript actually contains.
- [ ] New test — `--by effort`: same resumed-run fixture, plus an `events.jsonl` dispatch tagged with an effort level (mirroring the existing `test/economics.test.mjs:1739` fixture shape). Run with `--by effort --json`. **Do not assert `reconciliation.events_token_total`/`top_line_total` as the discriminator** — both derive from `events.jsonl` and the already-correct top-line `measuredTotal`, neither of which this fix touches; they are identical pre- and post-fix. Instead assert `breakdown.priced_at_model` equals the fixture's actual dominant model (a non-null string) and at least one row's `cost` is non-null. Pre-fix this fails: `readRunTranscriptRecords(root, process.env, …)` returns no records, so `economicsDominantModel([])` returns `null`, `priced_at_model` is `null`, and every row's `cost` is unpriced (`null`).
- [ ] New test: the same resumed-run fixture, with `--session-id <other-session>` passed explicitly and a transcript written under `<other-session>`, run with `--by class` (or `--by model`), asserts the breakdown's rows come from `<other-session>`'s transcript — not the open span's — mirroring the existing top-line-only coverage at `test/economics.test.mjs:1617`.
- [ ] The full existing `test/economics.test.mjs` suite passes unchanged — in particular every existing single-session `--by` test, proving the `effectiveEnv`-is-`process.env` single-session case is byte-identical (acceptance bullet 3; no new test needed for this, since it is covered by construction per the HOW section's rationale, and confirmed by the existing suite passing).

### Integration smoke test
```
PROCEDURE smoke_test:
  1. Build a 2-epoch ledger: epoch-0 closed with a measured delta, epoch-1 open.
  2. Write epoch-1's transcript under $CLAUDE_CONFIG_DIR, no ambient session env var set.
  3. Run `faff economics --run-dir <dir> --root <root> --by class --json` with a clean env.
  4. Assert exit 0, tokens_total spans both epochs, and breakdown.reconciliation.reconciles is true.
```

confidence: high
spec-review: approve
build-tier: standard

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
