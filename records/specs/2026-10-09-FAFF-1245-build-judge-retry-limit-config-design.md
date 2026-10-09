# FAFF-1245: graft.build_judge_retry_limit is registered and documented, but nothing reads it

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1245.

This spec is for the build agent implementing FAFF-1245 and for the humans reviewing it. `graft.build_judge_retry_limit` (default `"2"`) is registered in `config.js` and named in faff-graft as the build judge's outage retry bound, but `faff build-judge-evidence --assemble` reads only its own `--retry-limit` flag, and faff-graft never passes that flag. This ticket makes `cmdAssemble` read the key in-process (a valid flag still wins), turns an invalid flag into a usage error, and adds the tests and two small doc touches.

## 1. WHY

**The idea the rest turns on.** A config key only works if the code that needs the value reads it. FAFF-1244 already moved the judge's clock from "faff-graft should pass a flag" to "`cmdAssemble` resolves it from config in-process", because the flag route had silently failed for this very key. This ticket applies the same move to the retry limit: resolve flag, then config, then the default, inside `cmdAssemble`, so the documented key does what it says.

**Problem.**

- `cmdAssemble` (`plugin/skills/faff/bin/lib/build-judge-evidence.js` :515-516) sets `retryLimit` from `values["--retry-limit"]` when it matches `/^\d+$/`, else `DEFAULT_BUILD_JUDGE_RETRY_LIMIT` (2, :407). It never reads config.
- faff-graft (`plugin/skills/faff-graft/SKILL.md` :504) runs `--assemble` without `--retry-limit` and says the judge retries "up to `graft.build_judge_retry_limit`". So setting the key changes nothing.
- An invalid flag (`"abc"`, `"1.5"`) silently falls back to 2: the same quiet fallback that let this key go dead unnoticed.
- FAFF-1246 needs the retry limit as a working operator lever, since the judge's per-case worst case is `(retry limit + 1) x 2 phases x deadline`.

### Design principles

**Fail direction stays park.** A wrong or missing config value can only change how many outage retries happen before a park; it can never turn an unresolved case into an admit or hard-fail the judge.

**Config typos degrade, explicit flags fail loud.** An invalid config value falls through to the default (as FAFF-1244's clock tiers do). An invalid `--retry-limit` is an operator's explicit mistake on the command line and gets a usage error.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `build-judge-evidence.js`: `positiveInt` (:78-87), `resolveBuildJudgeClock` (:89-101), `realResolveBuildJudgeClock` (:103-108), `--retry-limit` spec (:399), `DEFAULT_BUILD_JUDGE_RETRY_LIMIT` (:407), `--window-start` usage error (:429-433), backend-chain early return (:497-512), `retryLimit` parse and `dispatchDeps` (:515-523), retry loops (:275, :304), `module.exports` (:577) | JavaScript (CJS) | The file this ticket changes |
| `plugin/skills/faff/bin/lib/config.js` `DEFAULTS["graft.build_judge_retry_limit"]` (:253-256), exported `DEFAULTS` | JavaScript | Registered key and its comment |
| `plugin/skills/faff/bin/lib/prdr.js` (:660-664) | JavaScript | Precedent: `--thrash-max` flag, then `prdr.thrash_max`, then default; non-negative integer, exit 2 otherwise |
| `test/build-judge-evidence.test.mjs`: `fakeDepsAlwaysOverturn` (:200-216), retry tests (:270, :295), clock resolver tests (:498-532), `runDispatch` (:543), unresolvable-chain clock test (:616) | JavaScript (`node:test`) | Home of the new tests |
| `docs/guide/cli.md` (:169), `.faffrc.example.yaml` (:473) | Markdown, YAML comments | Doc touches |

**Scope.** One pure resolver, one helper, early flag validation and an injectable resolver in `cmdAssemble`, unit tests, and three one-line text touches (config comment, CLI guide, example config). No SKILL.md changes.

## 2. OUT OF SCOPE

- **Other prose-read `graft.*` / `prep.*` limits** (`graft.review_outage_retry_limit`, `graft.build_review_hold_limit`, `prep.spec_review_judge_retry_limit`, ...). Why excluded: SKILL prose reads them with `faff config get`, which works. Extension point: each owning SKILL.md.
- **The caller-wait problem** (the judge's worst case outlasting faff-graft's 600s foreground call). Why excluded: FAFF-1246 owns it; this ticket only makes the lever work. Extension point: FAFF-1246.
- **An upper cap on the retry limit.** Why excluded: no sibling limit has one (`prdr.thrash_max`, the clock), and each attempt is already bounded by the FAFF-1244 deadline. Extension point: `resolveBuildJudgeRetryLimit`.
- **`faff config check` value validation for `graft.*` keys.** Why excluded: `knownKeyLint` checks top-level names only, for every namespace; adding value checks is a wider change. Extension point: `config.js` `knownKeyLint` (:2476).
- **Sharing one config load across the three real resolvers.** Why excluded: see DESIGN DECISION RATIONALE. Extension point: `cmdAssemble` dispatch setup.

## 3. WHAT

### Config key (existing, now read)

```
graft.build_judge_retry_limit: non-negative integer   # YAML integer or ASCII-digit string; default 2
  0  -> one attempt per phase, no retries
  N  -> N + 1 attempts per phase on a "retry" disposition, then park
```

### Interfaces (all in `build-judge-evidence.js`)

```
nonNegativeInt(v) -> integer >= 0 | null
  # beside positiveInt; same shape, but accepts 0

resolveBuildJudgeRetryLimit(cfg) -> integer >= 0
  # pure; exported

realResolveBuildJudgeRetryLimit() -> integer >= 0
  # loadConfig(findRoot())[0] then resolveBuildJudgeRetryLimit; exported

cmdAssemble(values, deps):
  deps.resolveBuildJudgeRetryLimit?: () -> integer >= 0   # new injection seam, defaults to the real resolver

module.exports gains: resolveBuildJudgeRetryLimit, realResolveBuildJudgeRetryLimit, DEFAULT_BUILD_JUDGE_RETRY_LIMIT
```

- **Chosen:** a new `nonNegativeInt` helper rather than reusing `positiveInt`, which rejects `0`, and `0` (no retries) is meaningful today.
- **Chosen:** keep `DEFAULT_BUILD_JUDGE_RETRY_LIMIT = 2` as the code default, pinned to `DEFAULTS["graft.build_judge_retry_limit"]` by a parity test (the FAFF-1244 constants-test style), rather than reading `DEFAULTS` at runtime.

## 4. HOW

### Resolution order

A valid flag wins; otherwise the config key; otherwise 2.

```
PROCEDURE nonNegativeInt(v):
  1. IF typeof v is number AND Number.isInteger(v) AND v >= 0: RETURN v
  2. IF typeof v is string AND trimmed v matches /^\d+$/: RETURN parseInt(trimmed, 10)
  3. RETURN null                    # -1, 1.5, "abc", "", "1.5", true, null, objects

PROCEDURE resolveBuildJudgeRetryLimit(cfg):
  1. RETURN nonNegativeInt(dig(cfg, "graft.build_judge_retry_limit")) ?? DEFAULT_BUILD_JUDGE_RETRY_LIMIT
     # cfg null / non-object / graft not a map -> 2
```

### Flag validation (early, beside `--window-start`)

Validate the flag before any filesystem work, so an invalid value is a usage error on every path (including the zero-criticals and unresolvable-chain paths), not only when dispatch is reached.

```
cmdAssemble, immediately after the --window-start check (:429-433):
  1. raw = values["--retry-limit"]
  2. flagRetryLimit = null
  3. IF raw != null:
     a. flagRetryLimit = nonNegativeInt(raw)
     b. IF flagRetryLimit is null:
        RETURN usageError([{ code: "invalid-value", detail: "--retry-limit expects an integer >= 0" }], BUILD_JUDGE_EVIDENCE_USAGE)   # exit 2
```

- **Chosen:** an invalid flag is exit 2 (usage error), replacing today's silent fallback to 2. No caller passes the flag today, so nothing breaks; it matches `--window-start` in the same command and `prdr --thrash-max`.

### Resolving at dispatch (replaces :515-516)

```
cmdAssemble, after backendsResult resolved without error (same point as the clock):
  retryLimit = flagRetryLimit
            ?? (deps.resolveBuildJudgeRetryLimit OR realResolveBuildJudgeRetryLimit)()
  dispatchDeps = { runReviewCall, judgeDispatchDisposition, retryLimit, backendsChain, clock }
```

- The resolver is called only when the flag is absent, and never on the zero-criticals or unresolvable-chain early returns.
- **Anti-pattern:** `flagRetryLimit || resolver()`. Why: a flag of `0` is falsy and would be overridden by config; use nullish coalescing.
- **Chosen:** accept a third `loadConfig` call (after the backend chain and the clock) rather than sharing one `cfg`. It is one small YAML read per `--assemble` run, and each resolver stays independently injectable, as FAFF-1244 left them.
- `realResolveBuildJudgeRetryLimit` has the same error behaviour as `realResolveBuildJudgeClock`: a config that fails to parse would already have thrown in `realResolveAdversarialBackends` first.

### Edge cases

- Config `0` -> `retryLimit` 0 (one attempt per phase). Config `"0"` likewise.
- Config `-1`, `1.5`, `"abc"`, `""`, `true`, or `graft: "oops"` (not a map) -> 2, silently.
- Flag `"0"` with config `5` -> 0 (the flag wins).
- Flag `"abc"`, `"1.5"` or `"-1"` -> exit 2 with the usage line, no `ledger.json` written (`parseArgs` passes `-1` through as a value, since it is not a known flag, so `nonNegativeInt` is what rejects it).
- **Chosen:** no stderr warning for an invalid config value, matching `resolveBuildJudgeClock`: the judge's stderr is not surfaced to an operator today.

### Tests (`test/build-judge-evidence.test.mjs`)

- `fakeDepsAlwaysOverturn` and every deps object that sets `resolveBuildJudgeClock` also set `resolveBuildJudgeRetryLimit` (a fixed `2` is fine), so no test reaching dispatch without the flag reads the repo's real `.faffrc.yaml`.
- **Anti-pattern:** relying on the repo `.faffrc.yaml` not setting the key. Why: a contributor's local config would change test call counts.

### Text touches

- `config.js` comment on the key (:253-255): add one clause, "read in-process by `build-judge-evidence --assemble`; a valid `--retry-limit` flag wins".
- `docs/guide/cli.md` :169: replace "(`--retry-limit`, default 2)" with "(`--retry-limit`, else `graft.build_judge_retry_limit`, else 2; an invalid flag is a usage error, exit 2)".
- `.faffrc.example.yaml` :473: in the existing worst-case comment, replace "retry limit" with `graft.build_judge_retry_limit`.
- **Chosen:** no new example-config entry (there is no `graft:` section to put it in) and no faff-graft SKILL.md change: :504 already names the key and becomes true as written; faff-graft never passes the flag, so naming the override there adds nothing for its reader.

## Scenarios

```
Given cmdAssemble with one standing critical, no "--retry-limit" flag, an injected resolveBuildJudgeRetryLimit returning 0, and a fake runReviewCall whose every Phase-1 call returns exit 5 with a disposition fake mapping 5 to "retry"
When the dispatch runs
Then runReviewCall is called exactly once and ledger.json records the case as parked with park_cause 'phase-1 dispatch disposition "retry" (exit 5)'
```

```
Given the same setup but "--retry-limit" "2" and an injected resolveBuildJudgeRetryLimit that throws
When the dispatch runs
Then runReviewCall is called exactly 3 times and the resolver is never called
```

- cmdAssemble with "--retry-limit" "abc" MUST return 2 and write no ledger.json.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Wire or delete the key | Delete the key, its selftest entry and the SKILL mention; resolve it in-process | **Chosen:** resolve in-process |
| Resolution order | Config wins; flag wins | **Chosen:** valid flag, then config, then 2 |
| Validity helper | Reuse `positiveInt`; inline regex; new `nonNegativeInt` | **Chosen:** new `nonNegativeInt` |
| Invalid flag | Silent fallback (today); usage error exit 2 | **Chosen:** usage error exit 2, validated early |
| Invalid config value | Hard fail; warn; fall through to 2 | **Chosen:** fall through to 2, silently |
| Config loads | Share one `cfg` among three resolvers; a third `loadConfig` | **Chosen:** a third `loadConfig` |
| Where to inject | Pass a value; `deps.resolveBuildJudgeRetryLimit` resolver | **Chosen:** injectable resolver, called after the chain resolves and only when the flag is absent |
| Docs | Restate in faff-graft; touch CLI guide, config comment and example comment only | **Chosen:** CLI guide, config comment, example comment |

- **Wire, not delete.** The FAFF-1244 spec already names in-process resolution as the fix for this exact dead-flag failure, and FAFF-1246 needs the limit as an operator lever on the judge's worst case. Deleting would remove the only lever besides the deadline.
- **Flag wins.** It is the more specific, per-invocation input, and the `prdr --thrash-max` and `adr` precedents put the flag first.
- **Usage error for a bad flag.** Silent fallback is how this key went dead; an explicit flag deserves a loud failure. At the time of writing, only tests pass `--retry-limit` (faff-graft does not), so the change breaks nothing.
- **Fall through for bad config.** A config typo must not hard-fail the judge mid-graft; FAFF-1244's clock tiers set this precedent.
- **Third config load.** Sharing one `cfg` would change the signatures of two existing injected resolvers for a negligible saving.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** no caller in the repo passes `--retry-limit` other than tests (`test/build-judge-evidence.test.mjs`, `test/impure/build-judge-deadline.test.mjs`), so the usage-error change has no production caller to break. Validation: `grep -rn -- '--retry-limit' plugin docs test` shows only the CLI's own spec/usage, the CLI guide row and test files, each passing a valid value.

## 8. DONE

### From WHY
- [ ] With `graft.build_judge_retry_limit` set and no flag, the judge's dispatch call count on a `retry` disposition follows the config value (scenario 1)
- [ ] `plugin/skills/faff-graft/SKILL.md` is unchanged in the diff

### From WHAT
- [ ] `build-judge-evidence.js` exports `resolveBuildJudgeRetryLimit`, `realResolveBuildJudgeRetryLimit` and `DEFAULT_BUILD_JUDGE_RETRY_LIMIT` (2)
- [ ] Unit: `DEFAULTS["graft.build_judge_retry_limit"] === String(bje.DEFAULT_BUILD_JUDGE_RETRY_LIMIT)`
- [ ] `cmdAssemble` accepts `deps.resolveBuildJudgeRetryLimit`, defaulting to the real resolver
- [ ] `realResolveBuildJudgeRetryLimit()` run in a child `node` process whose cwd is a tmp dir holding `.faff/` and a `.faffrc.yaml` with `graft: { build_judge_retry_limit: 0 }` prints 0 (child process, so the test runner never changes its own cwd)

### From HOW (pure resolver, unit tests on `resolveBuildJudgeRetryLimit`)
- [ ] `{}` and `null` -> 2
- [ ] `{ graft: { build_judge_retry_limit: 1 } }` -> 1; `"3"` -> 3; `" 4 "` (padded string) -> 4
- [ ] `0` -> 0 and `"0"` -> 0
- [ ] Each of `-1`, `1.5`, `"abc"`, `""`, `"1.5"`, `true` -> 2
- [ ] `{ graft: "oops" }` -> 2

### From HOW (flag validation)
- [ ] `--retry-limit` `"abc"`, `"1.5"` and `"-1"` each return 2 and leave no `ledger.json` in the `--out` dir
- [ ] `--retry-limit "abc"` with a zero-criticals round dir also returns 2 (validated before the early return)
- [ ] `--retry-limit "0"` is accepted: with a `retry` disposition, one call per phase

### From HOW (dispatch, using `runDispatch`)
- [ ] No flag, resolver returns 0, Phase-1 disposition `retry` -> exactly 1 `runReviewCall`, case parked (scenario 1)
- [ ] No flag, resolver returns 1, same fakes -> exactly 2 calls
- [ ] `--retry-limit "2"` with a throwing resolver -> exactly 3 calls, resolver never called (scenario 2)
- [ ] The unresolvable-chain test (:616) also injects a throwing `resolveBuildJudgeRetryLimit` and still returns 0
- [ ] `--retry-limit "0"` with an injected resolver returning 5, on a `retry` disposition -> exactly 1 Phase-1 call (a falsy flag still wins; guards against `flag || resolver()`)
- [ ] A zero-criticals round dir with a throwing `resolveBuildJudgeRetryLimit` and no flag returns 0 (the resolver is never reached on that early return)
- [ ] `fakeDepsAlwaysOverturn` and every deps literal that sets `resolveBuildJudgeClock` also set `resolveBuildJudgeRetryLimit`

### From HOW (text touches)
- [ ] `config.js` key comment says `build-judge-evidence --assemble` reads it in-process and a valid `--retry-limit` wins
- [ ] `docs/guide/cli.md` :169 reads "(`--retry-limit`, else `graft.build_judge_retry_limit`, else 2; an invalid flag is a usage error, exit 2)"
- [ ] `.faffrc.example.yaml` worst-case comment names `graft.build_judge_retry_limit`
- [ ] `node --test test/build-judge-evidence.test.mjs`, `faff config defaults --selftest`, `faff validate-adapters` and `faff config check` pass

### Integration smoke test

```
1. tmp dir with .faff/ and .faffrc.yaml containing graft: { build_judge_retry_limit: 0 }
2. child node process, cwd = tmp dir: realResolveBuildJudgeRetryLimit() -> 0   (config reaches the resolver)
3. runDispatch with no flag, resolveBuildJudgeRetryLimit: () => 0, Phase-1 exit 5 mapped to "retry"
   -> exactly 1 runReviewCall, case parked with '(exit 5)'                     (the value reaches the loop)
4. same with --retry-limit "1" -> exactly 2 calls                                 (the flag still wins)
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (P4)** No issues.
  - The work fits in one file: one helper, one resolver, early flag validation and an injection seam in `cmdAssemble`. It adds unit tests and three one-line text touches. That is well inside a 1 to 3 day unit.
  - The usage-error change for an invalid `--retry-limit` always ships with the wiring, so it is not a split candidate.
  - FAFF-1246 edits the same `cmdAssemble`, but it is not a merge candidate. This ticket delivers value on its own: the documented key starts working. The existing blocker edge already orders the work on the shared code.

- **Workstream fit? (P1 + P5)**
  - **What's there:** FAFF-1245 has no project. FAFF-1228, FAFF-1246, FAFF-1247 and the now-Done FAFF-1244 all serve the same outcome: review and judge calls end bounded and park honestly. This ticket contributes a working retry bound, which is one factor in the judge's worst case of `(retry limit + 1) x 2 phases x deadline`.
  - **Why it matters:** With no container, the chain has no shared definition of done. A `/faff-wtf` or build-queue pass can't tell that finishing FAFF-1245 and FAFF-1246 lights up one increment. They look like unrelated Tech chores.
  - **What to do:** The next `/faff-plot rehome` (or a tidy pass) could propose one outcome-named project, for example "Review and judge calls end bounded and park honestly", holding FAFF-1228, FAFF-1245, FAFF-1246 and FAFF-1247. It would be a proposal only, with nothing written from here. This does not block building FAFF-1245.

- **Deps surfaced? (P6)**
  - **What's there:** The edges match the spec. It is blocked by FAFF-1244 (Done), whose in-process clock resolution it copies, and it blocks FAFF-1246, which needs the limit as a working lever. FAFF-1246 is being prepped in parallel and edits the same dispatch setup. This spec replaces `build-judge-evidence.js` :515-516 and adds a `flagRetryLimit` check near :429-433.
  - **Why it matters:** The tracker edge orders the builds, but it does not keep the specs in step. If FAFF-1246's spec points at today's `retryLimit` line numbers, or assumes the silent fallback, it will be stale once this ticket merges. The FAFF-1246 build would then find that out partway through.
  - **What to do:** FAFF-1246's spec could describe its change against the post-FAFF-1245 shape (`resolveBuildJudgeRetryLimit`, the `deps.resolveBuildJudgeRetryLimit` seam, early flag validation) instead of current line numbers. Otherwise it should be re-checked against `main` at graft time. No new edge is needed.

- **Risk profile? (P7)** No issues.
  - Nothing here is a novel integration or an external dependency, so no de-risking spike is warranted.
  - Both behaviour changes are contained:
    - The default stays 2. The repo's own `.faffrc.yaml` doesn't set `graft.build_judge_retry_limit`, so repos without the key behave the same as today.
    - An invalid flag now exits 2. Only tests pass `--retry-limit`, all with valid values (`test/build-judge-evidence.test.mjs` :287, :312, :589, :607; `test/impure/build-judge-deadline.test.mjs` :76). faff-graft never passes it.
  - Failures still end in a park. A bad config value can only change how many outage retries run before a park.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
