# readGovernanceConfig: throw the legacy-config error instead of process.exit(2)

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-627.

This spec covers the correctness fix carved out of FAFF-579 as item B (human split decision, 2026-07-23): removing the one live `process.exit` buried in a faff CLI library function. It is written for the build agent and human reviewers. All paths and line references are verified against current `main` (files under `plugin/skills/faff/`).

## 1. WHY — Problem and Principles

**The load-bearing idea:** the faff CLI already has a central error policy — library functions signal an error condition by returned code or named throw, and the single dispatch boundary in `bin/faff` (the `try { return handler(rest) } catch` around every subcommand) maps named errors to a loud stderr line plus exit 2. `readGovernanceConfig` violates that policy exactly once, and the *same function* already contains the correct pattern to copy: its FAFF-577 `base-parse-error` branch writes the loud governance-flavoured stderr line and then **throws**, letting the entrypoint own the exit.

**Problem statement.** `bin/lib/budget.js` — inside `readGovernanceConfig`'s legacy-config-name branch (function defined at :77, the exit at :90) — calls `process.exit(2)` directly. Any process that imports the module and reaches this path dies outright: test runners importing budget exports (`test/lights-out.test.mjs`, `test/lights-out-resume.test.mjs` import them directly today), and any future lib consumer, cannot observe or handle the condition. This change makes the function throw the error condition; the entrypoint maps it to exit 2, so behaviour at the CLI surface is unchanged.

**Design principles.**

- **Behaviour-preserving at the CLI surface.** Every governance entry (`budget check`, `sentry check`, `economics`, `corrective`) that hits a legacy-named config today exits 2 with the loud stderr message; after this change each still exits 2 with the same loud message. Only the *mechanism* moves (throw + boundary map, not in-lib exit).
- **The dispatch boundary is the one exit-mapping home.** Mirror the FAFF-577 `base-parse-error` precedent in the same catch block; do not scatter per-caller catches.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | JS (CommonJS) | Holds the defect (`readGovernanceConfig`, exit at :90) and the FAFF-577 throw pattern to mirror (same function, `base-parse-error` branch). |
| `plugin/skills/faff/bin/faff` | JS (entrypoint) | The dispatch boundary (`catch` at ~:302–:313) with the existing `base-parse-error` arm; gains a `legacy-config-name` arm. |
| `plugin/skills/faff/bin/lib/config.js` (also engine.js, validate-adapters.js, profile.js, fixtures.js) | JS | Sibling convention: each catches `legacy-config-name` itself and returns 2 — proof the thrown-error shape is the house style. |
| `plugin/skills/faff/bin/lib/sentry.js` | JS | Caller whose FAFF-577 catch handles only `base-parse-error`; the legacy-name throw propagates to the boundary → exit 2, byte-equal to today's observable outcome. |
| `test/budget.test.mjs` | JS (ESM) | End-to-end CLI harness (spawnSync fixture repo) — home for the CLI regression test and the importer test. |

**Scope statement.** A one-function convention fix inside the faff CLI's spend-governance library plus one new arm at the entrypoint's error boundary; no contract, gate, or pipeline logic changes.

**Build-adjacency context (for the orchestrator, not the builder):** FAFF-579 (items C/D/E) is Todo with an approved spec and builds in the next drain; it also edits `budget.js` (dead-export removal, price-table anchor, `budgetSelftest`) and `bin/faff` (header comment, `USAGE`). Different regions of the same files — a conflict-analysis serialisation fact, not a blocker or dependency.

## 2. OUT OF SCOPE

- **FAFF-579's remaining items (C/D/E).** — Dead exports, entrypoint-doc collapse, price staleness. *Why excluded:* they have their own approved spec on FAFF-579. *Extension point:* that ticket.
- **Widening sentry's degrade-loud catch to legacy config names.** — `sentry check` catches only `base-parse-error` (FAFF-577) and degrades to default thresholds; a legacy-named file today hard-exits 2 and, after this change, still exits 2 via the boundary. Whether the watchdog should *also* degrade loud on a legacy name is a real question but a behaviour change. *Why excluded:* this ticket is behaviour-preserving by its own Expected. *Extension point:* the `catch` at `sentry.js:~735`.
- **The two non-live `process.exit` mentions.** — `env.js:262` (inside a docker-healthcheck string literal) and `governance-profile.js` (a comment documenting the convention). *Why excluded:* not executable exits. *Extension point:* none needed.

## 3. WHAT

One behaviour change in `readGovernanceConfig(root)` and one new arm at the dispatch boundary.

**`readGovernanceConfig` legacy branch:** keep the loud stderr message byte-identical; replace `process.exit(2)` with a rethrow of the caught error (message `"legacy-config-name"`, carrying `e.legacy`, exactly as `findConfig` threw it).

**Dispatch boundary (`bin/faff`):** in the existing per-subcommand `catch`, beside the `base-parse-error` arm, add a `legacy-config-name` arm: write one short command-level stderr line (e.g. `faff <sub>: cannot proceed — legacy config filename (<names>); rename to .faffrc.yaml.`) and return 2. The detailed governance message already fired from the lib before the throw, mirroring how the FAFF-577 arm works.

**Design decision — throw vs sentinel return vs per-caller catches.**

- **Chosen:** rethrow the original `legacy-config-name` error and map it once at the dispatch boundary. — *Rationale:* it is the pattern the *same function* already uses for `base-parse-error` (FAFF-577), so the two loud-config failure modes become symmetric; a sentinel return would force every one of the five call sites (`budget.js:702`, `corrective.js:361`/`:421`, `sentry.js:735`, `economics.js:714`) to branch on a non-config return from a function whose contract is "return the merged config object"; per-caller catches would quintuplicate the exit mapping the central boundary exists to own. Rethrowing the *original* error (not a new wrapper) keeps `e.legacy` intact and matches what the five sibling modules that self-catch `legacy-config-name` already pattern-match on.

## 4. HOW — Behavior

```
PROCEDURE readGovernanceConfig(root):
  1. try rc = findConfig(root)
  2. catch e:
     a. IF e.message == "legacy-config-name":
        - write the existing loud governance stderr message (unchanged text)
        - THROW e                      # was: process.exit(2)
     b. ELSE rethrow e
  3. ...rest of the function unchanged (null → {}, readBaseConfigStrict + base-parse-error branch)
```

```
PROCEDURE dispatch_boundary(sub, e):        # bin/faff, the existing catch
  1. IF e.faffGovernanceProfileError: existing arm, exit 2
  2. IF e.message == "base-parse-error": existing arm, exit 2
  3. IF e.message == "legacy-config-name":                    # NEW
     a. stderr: one command-level line naming sub + the legacy filenames (e.legacy)
     b. return 2
  4. ELSE rethrow (genuine bug)
```

**Edge cases.**

- **`sentry check` (the watchdog poller):** its FAFF-577 catch matches only `base-parse-error`, so the legacy-name throw propagates to the boundary → exit 2 + loud message — the same observable outcome as today's in-lib exit. No sentry edit needed or wanted (see OUT OF SCOPE).
- **Per-command self-catchers:** `config.js`, `engine.js`, `validate-adapters.js`, `profile.js`, `fixtures.js` catch `legacy-config-name` from their own `findConfig`/`loadConfig` calls before the boundary sees it — untouched and unaffected.
- **Direct importers:** module load of `budget.js` runs no config read, and after this change the module contains no exit path at all — importing it can never kill the host process.

**Tests (the DoD's importer proof + CLI regression):**

- **Importer test:** in a fixture repo whose root holds a legacy-named `.faffrc`, import `readGovernanceConfig` from `budget.js` directly (ESM→CJS, as the lights-out tests already do) and `assert.throws` with message `legacy-config-name`; the assertion completing proves the importing process survived.
- **CLI regression test:** using `test/budget.test.mjs`'s existing spawnSync fixture harness, run `faff budget check` against a fixture repo with a legacy `.faffrc` → exit 2, stderr contains the loud legacy-config message.

## Scenarios

```
Given a repo root containing a legacy-named `.faffrc` (not `.faffrc.yaml`)
When a test process imports budget.js and calls readGovernanceConfig(root)
Then the call throws an error with message "legacy-config-name" and the importing process survives to assert on it
```

```
Given the same legacy-named fixture repo
When `faff budget check` is run at the CLI
Then it exits 2 and stderr contains the loud legacy-config-filename message (surface unchanged from today)
```

## 6. DESIGN DECISION RATIONALE

**How should the lib signal the legacy-config condition?** Options: (a) sentinel return value — breaks the "returns the config object" contract at five call sites; (b) catch-and-map in every caller — quintuplicates the exit mapping; (c) rethrow the original error + one new boundary arm — symmetric with the FAFF-577 `base-parse-error` handling already in the same function and catch block. **Chosen:** (c) — see §3. At the time of writing the boundary already dispatches ~65+ handlers through the one catch, so the arm covers every present and future governance entry at once.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** no caller of `readGovernanceConfig` relies on the process actually dying on the legacy path. *Validate:* grep the five call sites before building — none catches `legacy-config-name` today, and `process.exit` meant no post-call code ever ran on this path, which a throw preserves exactly.

## 8. DONE — Definition of Done

### From WHY
- [ ] `grep -rn "process.exit" plugin/skills/faff/bin/lib/` shows no live call — the only remaining matches are inside string literals or comments (env.js healthcheck, convention docs).

### From WHAT / HOW — the fix
- [ ] `readGovernanceConfig` rethrows the `legacy-config-name` error (with `e.legacy` intact) after writing the unchanged loud stderr message; no `process.exit` remains in `budget.js`.
- [ ] `bin/faff`'s dispatch-boundary catch has a `legacy-config-name` arm that writes one command-level stderr line and returns 2.

### From HOW — tests
- [ ] Importer test: direct import of `budget.js` + `assert.throws("legacy-config-name")` against a legacy-named fixture; passes without killing the runner.
- [ ] CLI regression: `faff budget check` on a legacy-named fixture exits 2 with the loud message on stderr.

### Whole change
- [ ] `node --test` passes across the suite.

**Integration smoke test:**

```
1. mkdir fixture; write legacy `.faffrc` at its root.
2. In a node process, require budget.js and call readGovernanceConfig(fixtureRoot) inside a try/catch → the catch receives message "legacy-config-name" and the process continues (prints "alive").
3. faff budget check --run-dir <fixture-run> (root = fixture) → exit 2, stderr names the legacy filename.
4. node --test → all pass.
```

## Methodology critique

*(agile-delivery lens — issue-critique)*

- **Right-sized?** Yes — a single sub-day unit: one function edit, one boundary arm, two tests. No split or merge warranted; it exists *because* of the human's split decision on FAFF-579.
- **Workstream fit / cohesive?** Yes — one outcome: the lib obeys the CLI's central error policy. The `faff-chain-gap-fill` label matches its carve-out provenance.
- **Deps surfaced?** None hidden. Independent of FAFF-626 and of FAFF-579's C/D/E (that spec lists this work as out of scope; verified against its attached spec). Same-file adjacency with FAFF-579's next-drain build is a serialisation fact for conflict analysis, already surfaced in WHY.
- **Risk profile?** Low — behaviour-preserving mechanism change with a regression test pinning the CLI surface. No spike needed.

confidence: high
spec-review: approve (single-pass — architectural / infosec / QA per lens selection; no objections; 2026-07-23, autonomous)
