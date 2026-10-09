# FAFF-1244: build-judge-evidence runs review-call with no deadline, so a trickling backend can stall the judge indefinitely

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1244.

This spec is for the build agent implementing FAFF-1244 and for the humans reviewing it. `build-judge-evidence.js` dispatches `review-call.mjs` for the build-review would-be-park judge with no `--deadline` and no `--timeout`, through an `execFileSync` with no `timeout`. A backend that trickles bytes therefore keeps the judge (and the graft turn that runs it) blocked forever. This ticket resolves a bounded judge clock from config in-process, threads it into every judge dispatch, and adds a spawn backstop that dispositions like review-call's own deadline exit.

## 1. WHY

**The idea the rest turns on.** `review-call.mjs` only bounds a call in wall-clock terms when it is given `--deadline`. With it, the chain races each backend against a time slice and returns exit 8 (`DEADLINE`) when the last slice runs out; the judge already treats exit 8 as a bounded `retry`. Without it there is no slice, and the only clock left is a per-socket inactivity timeout that every trickled byte resets. So the fix is to give the judge's dispatch the same `--deadline` (and `--timeout`) the other review callers already pass, resolved from config, plus an outer kill that can only fire after review-call's own deadline and that lands on the same exit 8.

**Problem.**

- `dispatchOne` (`plugin/skills/faff/bin/lib/build-judge-evidence.js` :198) calls `runReviewCall([...])` for Phase 1 (:212) and Phase 2 (:241) with only `--system`, `--diff`, `--context`, `--expect contract` and `--backends-json`. No `--deadline`, no `--timeout`.
- `realRunReviewCall` (:72-83) runs `execFileSync("node", [REVIEW_CALL_MJS, ...args], { encoding: "utf8" })`: no `timeout`, no `killSignal`.
- In review-call, `--deadline` absent means `totalDeadlineMs` is undefined, so `runReviewChain` takes the unbounded branch: no slice race, and FAFF-1239's per-element abort fires only on settle, which a trickling stream never reaches. The inactivity timeout defaults to 580000ms (`realStream`, `review-call.mjs` :1460) and is reset by every chunk.
- Result: a hung or trickling judge backend blocks `faff build-judge-evidence --assemble` indefinitely. It is the one judge path with no park; today the graft turn just dies and falls through to the `built-but-not-admitted` hold.

### Design principles

**Every judge exit goes through the existing disposition.** A bounded run must end in an exit code that `judgeDispatchDisposition` (`review-call.mjs` :1776) already classifies. A wedged judge ends as exit 8 (`retry`, then park at the bound), never as a new code and never as a silent admit.

**Review-call's own deadline fires first.** The spawn backstop is a second line, set strictly later than `--deadline` (the FAFF-793 rule: a hard kill must only fire after the budget). On the healthy path it never fires.

**One resolution, one number.** The deadline is resolved once per `--assemble` run. The `--deadline` argv value and the backstop's timeout derive from that same resolved value; nothing re-parses argv.

**Fail direction stays park.** Nothing here can turn an unresolved case into an admit.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/build-judge-evidence.js`: `realRunReviewCall` (:72-83), `realResolveAdversarialBackends` (:89-93), `dispatchOne` (:198-260), `cmdAssemble` dispatch deps (:451-458) | JavaScript (CJS) | The file this ticket changes |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`: `parseArgs` `--timeout` / `--deadline` (:1626-1627), chain mapper per-backend `timeout` precedence (:2256), `budgetWarnings` (:1790), `judgeDispatchDisposition` (:1775-1780), `ledgerMandatory` / `mandatoryRemap` (:1678, :1753, :2406) | JavaScript (ESM) | Unchanged; defines the flags and the exit 8 disposition this relies on |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` (:71-105) | Shell in prose | Precedent: `adversarial.spec_review.deadline` -> `adversarial.deadline` -> 900, with a `-gt 0` guard |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (:210-240) | Shell in prose | Precedent: code review `adversarial.<consumer>.timeout` -> `adversarial.timeout` -> 120, `adversarial.deadline` -> 480, `review-spawn.mjs` backstop at deadline + 30s |
| `plugin/skills/faff/bin/lib/killable-spawn.mjs` `DEFAULT_GRACE_SECONDS = 30` (:30), `WRAPPER_EXIT.DEADLINE = 8` (:36) | JavaScript (ESM) | Grace and exit code the new backstop mirrors |
| `plugin/skills/faff/bin/lib/shared-infra.js` `dig` (:476), `scalar` (:340) | JavaScript | Config reads; YAML integers arrive as numbers, quoted values as strings |
| `test/build-judge-evidence.test.mjs` (`fakeDepsAlwaysOverturn` :199-213, `--backends-json` threading test :315-346) | JavaScript (`node:test`) | Home of the new unit tests |
| `test/impure/review-call-served-exit.test.mjs` | JavaScript (`node:test`) | FAFF-1239 trickling fake-server pattern the new impure test reuses |
| `.faffrc.example.yaml` (:447-488), `docs/guide/cli.md` (:169) | YAML comments, Markdown | Docs touched |

**Scope.** One config resolver, argv threading in `dispatchOne`, a spawn backstop with a pure exit-mapping helper in `realRunReviewCall`, unit tests, one impure test, and two doc touches. `review-call.mjs` and every SKILL.md are unchanged.

## 2. OUT OF SCOPE

- **Dead retry-limit config key.** `graft.build_judge_retry_limit` (`config.js` :256) is never read; `--retry-limit` is the only input and faff-graft never passes it. Why excluded: a separate wiring decision, not a timing bound. Extension point: `cmdAssemble`'s `retryLimit` resolution (:451-452) or the faff-graft Step 9 invocation. See the Punt under OPEN QUESTIONS.
- **The 480 vs 900 terminal-default inconsistency.** Code review falls back to 480 for `adversarial.deadline`, spec review to 900. Why excluded: changing either alters an existing consumer's budget. Extension point: the two SKILL.md resolution blocks.
- **`maxBuffer` sizing for `realRunReviewCall`.** Node's 1 MiB default still applies; an overflow stays exit 1 (park). Why excluded: unrelated to timing. Extension point: the `execFileSync` options helper added here.
- **The spec-judge clock in faff-prep.** Its `adversarial.spec_judge.*` resolution is prose-only with no terminal default. Why excluded: different seam (SKILL prose, not this CLI). Extension point: `plugin/skills/faff-prep/SKILL.md` :217.
- **A spawn backstop for `fan-out.mjs`.** Why excluded: it already passes `--deadline`; FAFF-793 left process-grouping there as its own follow-up. Extension point: `fan-out.mjs` `runOne` (:90).
- **Any `review-call.mjs` change.** Why excluded: none is needed; it already honours both flags.
- **The L4 mandatory remap of exit 8 to 9.** Under an L4 run ledger reachable through `$FAFF_RUN_DIR`, review-call remaps its own exit 8 to 9 (`MANDATORY_OUTAGE`, park). Why excluded: pre-existing, deliberate, and the same today for exit 5. Extension point: `mandatoryRemap` / `ledgerMandatory`.
- **Shortening the worst-case judge wall-clock.** Bounded at `(retryLimit + 1) x 2 phases x deadline` per case (accepted, see HOW). Why excluded: this ticket bounds it; tuning is config. Extension point: `adversarial.build_judge.deadline` and the retry limit.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Judge clock | The pair `{ deadline, timeout }` (whole seconds) resolved once per `--assemble` run and applied to every judge dispatch |
| Tier | One config key in a fallback chain: per-consumer (`adversarial.build_judge.*`), shared (`adversarial.*`), terminal default |
| Valid tier value | A positive integer: a YAML integer, or a string of ASCII digits, whose value is greater than 0 |
| Spawn backstop | The `execFileSync` `timeout` that SIGKILLs review-call at deadline + grace |

### Config keys (new, both optional)

```
adversarial.build_judge.deadline   # seconds, TOTAL wall-clock per review-call dispatch; falls back to adversarial.deadline, then 480
adversarial.build_judge.timeout    # seconds, ONE stream attempt's inactivity bound; falls back to adversarial.timeout, then 120
```

`adversarial.build_judge.refs` already exists (FAFF-870 per-consumer chain, read by `assembleAdversarialBackends(cfg, "build_judge")`) but is undocumented.

### Interfaces (all in `build-judge-evidence.js`)

```
CONST DEFAULT_BUILD_JUDGE_DEADLINE_SECS = 480
CONST DEFAULT_BUILD_JUDGE_TIMEOUT_SECS  = 120
CONST BUILD_JUDGE_SPAWN_GRACE_SECS      = 30     # mirrors killable-spawn DEFAULT_GRACE_SECONDS
CONST REVIEW_CALL_DEADLINE_EXIT         = 8      # review-call EXIT.DEADLINE / killable-spawn WRAPPER_EXIT.DEADLINE

PURE FUNCTION resolveBuildJudgeClock(cfg) -> RECORD JudgeClock:
  deadline: Integer > 0      # seconds
  timeout:  Integer > 0      # seconds

FUNCTION realResolveBuildJudgeClock() -> JudgeClock      # loadConfig(findRoot()) then resolveBuildJudgeClock

PURE FUNCTION reviewCallSpawnOptions(deadlineSecs?) -> execFileSync options:
  deadlineSecs valid -> { encoding: "utf8", timeout: (deadlineSecs + BUILD_JUDGE_SPAWN_GRACE_SECS) * 1000, killSignal: "SIGKILL" }
  otherwise          -> { encoding: "utf8" }             # today's options, unchanged

PURE FUNCTION reviewCallExitFromError(e) -> Integer:
  e.code == "ETIMEDOUT"        -> 8
  typeof e.status == number    -> e.status
  otherwise                    -> 1                      # ENOBUFS, external signal, spawn failure: today's mapping

FUNCTION realRunReviewCall(args, opts = {}) -> { code, stdout, stderr }
  opts.deadlineSecs?: Integer  # the resolved clock's deadline; absent -> no backstop
  opts.exec?: Function         # test seam, defaults to execFileSync; same (file, args, options) signature

cmdAssemble deps (injectable, as today):
  + resolveBuildJudgeClock?: () -> JudgeClock            # default realResolveBuildJudgeClock

dispatchJudgeRulings / dispatchOne deps:
  + clock: JudgeClock                                    # set by cmdAssemble
runReviewCall is called as runReviewCall(args, { deadlineSecs: clock.deadline })
```

- Export `resolveBuildJudgeClock`, `reviewCallSpawnOptions`, `reviewCallExitFromError` and the four constants from `module.exports` for the tests.
- Injected `runReviewCall` fakes keep working: the second argument is extra and ignored.

## 4. HOW

### Resolving the judge clock

Each value walks its tiers and takes the first valid one; an absent, non-numeric, zero or negative value at a tier falls through to the next tier.

```
PROCEDURE positiveInt(v):
  1. IF typeof v is number AND Number.isInteger(v) AND v > 0: RETURN v
  2. IF typeof v is string AND trimmed v matches /^\d+$/ AND parseInt(trimmed, 10) > 0: RETURN parseInt(trimmed, 10)
  3. RETURN null                                  # floats, "abc", "", 0, -5, null, objects, booleans

PROCEDURE resolveBuildJudgeClock(cfg):
  1. deadline = positiveInt(dig(cfg, "adversarial.build_judge.deadline"))
             ?? positiveInt(dig(cfg, "adversarial.deadline"))
             ?? DEFAULT_BUILD_JUDGE_DEADLINE_SECS
  2. timeout  = positiveInt(dig(cfg, "adversarial.build_judge.timeout"))
             ?? positiveInt(dig(cfg, "adversarial.timeout"))
             ?? DEFAULT_BUILD_JUDGE_TIMEOUT_SECS
  3. RETURN { deadline, timeout }
```

- `dig` comes from `./shared-infra` (already required for `findRoot`; add it to that destructure). `dig` returns null when `adversarial.build_judge` is absent or not a map, so a missing sub-block just falls through.
- `cfg` null or not an object resolves to `{ 480, 120 }`.
- **Chosen:** 480 as the terminal deadline default. It matches code review's `adversarial.deadline -d 480` and FAFF-329's "about 480s, under the 900s staleness window with margin"; the judge, like code review, runs inside a graft turn. The 480 vs 900 split between code review and spec review is noted and left as is (OUT OF SCOPE).
- **Chosen:** no 60s sanity-floor warning (spec review has one). The judge's stderr is never surfaced to an operator today, so a warning would be invisible; a small deadline is still bounded and correct.

`realResolveBuildJudgeClock` is `resolveBuildJudgeClock(loadConfig(findRoot())[0])`, the same load `realResolveAdversarialBackends` does. It is called in `cmdAssemble` only after the backend chain resolved successfully (so the unresolvable-chain park path at :435-449 is unchanged and needs no clock), and its result goes into `dispatchDeps.clock`:

```
cmdAssemble, after backendsResult resolved without error:
  resolveClock = deps.resolveBuildJudgeClock OR realResolveBuildJudgeClock
  clock = resolveClock()
  dispatchDeps = { runReviewCall, judgeDispatchDisposition, retryLimit, backendsChain, clock }
```

### Threading the clock into both phases

```
dispatchOne(caseId, caseFile, tmpDir, deps):
  clockArgs = ["--timeout", String(deps.clock.timeout), "--deadline", String(deps.clock.deadline)]
  runOpts   = { deadlineSecs: deps.clock.deadline }
  Phase 1, every attempt:  runReviewCall([...existing Phase-1 args, ...backendsArgs, ...clockArgs], runOpts)
  Phase 2, every attempt:  runReviewCall([...existing Phase-2 args, ...backendsArgs, ...clockArgs], runOpts)
```

- The retry loops, dispositions, park causes and verdict parsing are unchanged.
- Review-call reads both flags in seconds (`* 1000`). `--timeout` is the default per-attempt bound for chain elements with no `timeout` of their own; a per-backend `timeout` in the chain still wins (`review-call.mjs` :2256).
- With the defaults and a one-backend chain, review-call prints its FAFF-617 `budget:` advisory to stderr (120 x 6 >= 480). It never gates and the judge does not surface stderr; code review emits the same line today.

### Spawn backstop in `realRunReviewCall`

The backstop kills a review-call that is still alive 30s after its own deadline and reports that kill as exit 8, the same code review-call (and `review-spawn.mjs`) use for a deadline.

```
PROCEDURE realRunReviewCall(args, opts = {}):
  1. options = reviewCallSpawnOptions(opts.deadlineSecs)
  2. TRY stdout = (opts.exec OR execFileSync)("node", [REVIEW_CALL_MJS, ...args], options); RETURN { code: 0, stdout, stderr: "" }
  3. CATCH e:
       code = reviewCallExitFromError(e)
       IF e.code == "ETIMEDOUT":
         write to stderr: "faff build-judge-evidence: review-call still alive at deadline("
                          + opts.deadlineSecs + "s)+grace(" + BUILD_JUDGE_SPAWN_GRACE_SECS + "s); killed, treated as exit 8 (FAFF-1244)\n"
       RETURN { code, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }
```

- Verified on Node 22: `execFileSync` with `timeout` and `killSignal: "SIGKILL"` throws with `code: "ETIMEDOUT"`, `signal: "SIGKILL"`, `status: null`. A `maxBuffer` overflow throws `code: "ENOBUFS"`, `signal: "SIGTERM"`, `status: null`. An external signal throws with `code` undefined, `status: null`. A normal non-zero exit throws with `status` set.
- Keying on `e.code == "ETIMEDOUT"` (not on `e.signal`) is what separates the backstop kill from an `ENOBUFS` overflow or an external kill, both of which keep today's exit 1 (park).
- `runFaff` (:56) keeps its own options; only `realRunReviewCall` changes.
- **Chosen:** a raw `execFileSync` `timeout` with the explicit mapping, not routing through `review-spawn.mjs` (see DESIGN DECISION RATIONALE).

**Anti-pattern:** setting the backstop equal to the deadline, or below it. Why: it races review-call's own exit 8 and can kill a call that is about to return a served ruling (FAFF-793).

**Anti-pattern:** mapping every `status: null` error to 8. Why: an `ENOBUFS` overflow or an operator's kill is not a transient outage; retrying it wastes up to `retryLimit` more deadlines and hides the real fault.

**Anti-pattern:** reading the deadline back out of `args` inside `realRunReviewCall`. Why: two sources for one number drift; the clock is passed as a value.

### Edge cases

- **Trickling backend, one-element chain.** The single slice equals the deadline; at the deadline review-call returns exit 8 (last-backend slice exhaustion, `review-call.mjs` :2112-2115), FAFF-1239's per-element abort tears the request down, the process exits, and the judge dispositions `retry`. After `retryLimit` retries the case parks with cause `phase-1 dispatch disposition "retry" (exit 8)` (or `phase-2`).
- **A needs-human class seen earlier in the chain** (for example exit 7 auth on chain[0]) dominates exit 8, exactly as today; it parks.
- **L4 run ledger reachable via inherited `$FAFF_RUN_DIR`.** Review-call remaps its own exit 8 to 9 (park, no retry). The spawn backstop's synthesised 8 is not remapped, matching `review-spawn.mjs`. Pre-existing and accepted (OUT OF SCOPE).
- **Config sets only `adversarial.build_judge.timeout`.** Deadline still falls through to `adversarial.deadline`, then 480, and vice versa; the two values resolve independently.
- **`adversarial.build_judge.deadline: "0"` with `adversarial.deadline: 300`.** Resolves 300 (the invalid per-consumer value falls through to the shared tier). This differs from spec review's shell, where an invalid value at any tier lands on the terminal default; the ticket asks for tier fallthrough.
- **Deadline value as a float (`2.5`).** Not a positive integer, so it falls through. Matches the shell `-gt 0` guard, which rejects non-integers.
- **A healthy but slow backend that goes silent mid-stream for more than `timeout`.** Today such a chain element (no per-backend `timeout`) waits up to 580s of inactivity; with `--timeout 120` it fails the attempt as a transport fault, which review-call retries and then maps to exit 5 (`retry`). This matches code review's behaviour under the same default and is the intended trade; a per-backend `timeout` in the chain, or `adversarial.build_judge.timeout`, raises it.
- **`opts.deadlineSecs` absent** (a future caller of `realRunReviewCall` with no clock). No backstop, today's options; never a crash.

### Accepted bound

**Chosen:** accept the worst case as bounded, not minimised, and keep the 480s default rather than shrinking it to fit graft's 600s Bash call (a 90s default would park healthy slow reviewers; Phase 2 code reviews have taken 42 to 320s). The gap to the caller's wait is filed as FAFF-1246. Per case it is `(retryLimit + 1) x 2 phases x deadline` (Phase 2 only runs if Phase 1 ruled), so at the defaults (retry limit 2, deadline 480) about 48 minutes, plus up to 30s per attempt only if the backstop fires. Today it is unbounded. Operators tune it with `adversarial.build_judge.deadline`.

### Failure modes

- **The graft turn or its shell tool times out before the bounded judge finishes.** This is expected at the defaults, not rare: faff-graft runs `--assemble` as one foreground Bash call capped at 600s, and one trickling backend with a single retry already needs 2 x 480s. How you'd know: graft still reaches the `built-but-not-admitted` hold on a judge with an unhealthy backend, with no `ledger.json` park causes written. What it means: proceed; this ticket converts an infinite stall into a bounded one, and the honest exit-8 park reaches graft at the defaults only once FAFF-1246 (fit or survive the caller's wait) lands. Until then a lower `adversarial.build_judge.deadline` is the lever.
- **The backstop fires in production.** How you'd know: the `review-call still alive at deadline(...)` stderr line, or a case parking with `(exit 8)` after a run that took about deadline + 30s per attempt. What it means: review-call failed to honour its own deadline; open a review-call bug rather than raising the grace.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fake OpenAI-compatible server (running in a separate process) whose model A answers every POST with ": keepalive" SSE comments every 50ms and never ends
And cmdAssemble is called with one standing critical, an injected backend chain [A], an injected judge clock { deadline: 2, timeout: 120 }, "--retry-limit" "1", and the real runReviewCall and judgeDispatchDisposition
When the judge dispatches the case
Then cmdAssemble resolves 0 within 12000ms, the server received exactly 2 Phase-1 POSTs (the first exit 8 was dispositioned as retry), and ledger.json records the case as parked with park_cause 'phase-1 dispatch disposition "retry" (exit 8)'
```

```
Given cmdAssemble with an injected clock { deadline: 300, timeout: 90 }, a fake runReviewCall that records (args, opts) and returns exit 5 for every Phase-1 attempt, a disposition fake mapping 5 to "retry", and "--retry-limit" "2"
When the dispatch runs
Then all 3 recorded calls carry "--timeout" "90" and "--deadline" "300" exactly once each, and every recorded opts.deadlineSecs is 300
```

- reviewCallExitFromError MUST map an error with code "ETIMEDOUT" to 8, code "ENOBUFS" with status null to 1, and status 7 to 7.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Where the clock is resolved | faff-graft SKILL prose passes `--deadline` / `--timeout` flags; `build-judge-evidence.js` resolves config in-process | **Chosen:** in-process in `build-judge-evidence.js` |
| Config keys (ticket question 1) | Shared `adversarial.deadline` / `.timeout` only; per-consumer `adversarial.build_judge.*` falling back to the shared keys | **Chosen:** `adversarial.build_judge.*` -> `adversarial.*` -> 480 / 120 |
| Invalid value at a tier | Jump to the terminal default (spec review's shell shape); fall through to the next tier | **Chosen:** fall through to the next tier |
| Terminal deadline default | 480 (code review, FAFF-329); 900 (spec review) | **Chosen:** 480 |
| Spawn backstop (ticket question 2) | None (rely on review-call's deadline); `execFileSync` `timeout` with explicit exit mapping; route through `review-spawn.mjs` | **Chosen:** `execFileSync` `timeout` at deadline + 30s, SIGKILL, ETIMEDOUT -> 8 |
| How the backstop gets the deadline | Re-parse `--deadline` from argv; pass the resolved value as a second argument | **Chosen:** `runReviewCall(args, { deadlineSecs })` |
| Exit mapping location | Inline in the catch; a pure exported helper | **Chosen:** pure exported `reviewCallExitFromError` |
| Sanity-floor warning | Mirror spec review's 60s warning; none | **Chosen:** none |
| Worst-case wall-clock | Shrink retries or phases here; accept the bounded product | **Chosen:** accept, tune via config |
| Impure test shape | Call `realRunReviewCall` directly with explicit argv; drive `cmdAssemble` with injected resolvers and the real transport | **Chosen:** drive `cmdAssemble` with injected resolvers, real `runReviewCall` and real disposition; server out of process |
| SKILL.md changes | Restate the clock in faff-graft; none | **Chosen:** none |

**In-process resolution.** `cmdAssemble` already loads `.faffrc.yaml` in-process for the backend chain (`realResolveAdversarialBackends`, :89-93), and review-call never reads config. The flag-passing alternative already failed once here: `graft.build_judge_retry_limit` exists but faff-graft never passes `--retry-limit`, so the key is dead. Resolving in code also makes the tiers unit-testable without a shell mirror.

**Per-consumer keys.** `build_judge` is already a named consumer for `refs` (FAFF-870), and FAFF-1054 already split `adversarial.spec_review.deadline`. The judge's budget is a different shape from a code review (up to six dispatches per case), so an operator needs to tune it separately; unset keys fall back to the shared ones, so existing configs change only from "unbounded" to "bounded by `adversarial.deadline`".

**Tier fallthrough on invalid values.** A typo in the per-consumer key should not silently discard a valid shared setting. Spec review's shell lands on 900 only because two nested `config get -d` calls cannot validate the inner tier; in JavaScript each tier is cheap to check.

**480 terminal default.** The judge runs inside a graft turn, as code review does, so it takes code review's budget, which FAFF-329 chose to stay under the 900s staleness window. At the time of writing, spec review's 900 is the outlier and is out of scope here.

**`execFileSync` `timeout` over `review-spawn.mjs`.** `review-spawn.mjs` gives a process-group kill and already returns 8, and with `stdio: "inherit"` under `execFileSync` the stdout would still be captured. But review-call has no long-lived grandchildren (its only child process is a short synchronous `node --check` at :977), so a group kill buys nothing; the wrapper adds a second Node process per dispatch (up to six per case), a second argv layer and its own exit taxonomy (130, 1, 2) that would also need mapping. A direct `timeout` with one explicit mapping is fewer moving parts and is fully unit-testable through the pure helper.

**Grace 30s, SIGKILL.** It matches `killable-spawn.mjs` `DEFAULT_GRACE_SECONDS`, which code review already relies on, and leaves review-call's own deadline (plus FAFF-1239's 2s exit backstop) ample room to win. SIGKILL because a review-call that ignored its own deadline cannot be trusted to handle SIGTERM.

**Passing the deadline as a value.** Re-parsing argv would make the backstop depend on argv layout. A second argument keeps one resolution and leaves every injected fake (`(args) => ...`) working unchanged.

**No floor warning.** Spec review's warning reaches an operator through the prep transcript; the judge's stderr is discarded by `realRunReviewCall` on success and never logged on failure. A warning nobody sees is noise.

**Impure test shape.** `realRunReviewCall` is synchronous, so an in-process server would be blocked while review-call runs; the server must live in its own process. Driving `cmdAssemble` with injected resolvers (backend chain and clock) exercises the real argv threading, the real backstop options, the real review-call deadline exit and the real disposition import end to end, without needing a config file. Calling `realRunReviewCall` directly would skip the threading and disposition this ticket is about.

**No SKILL.md change.** faff-graft (:504) describes the judge's dispatch and retry, not its timing; per `docs/reference/skill-authoring.md` (lean, no changelog) nothing needs restating.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:**

**Punt:** wire or remove the dead retry-limit config key, as a follow-up ticket (decides: architecture) (non-blocking)

Filed as FAFF-1245. Context: `graft.build_judge_retry_limit` (default `"2"`, `config.js` :256) is registered and described in faff-graft (:504), but nothing passes `--retry-limit` and `cmdAssemble` never reads config for it, so the judge always uses `DEFAULT_BUILD_JUDGE_RETRY_LIMIT = 2`. Options: read it in `cmdAssemble` the same way as the clock (flag wins), or delete the key and the SKILL mention. This ticket's bound holds either way; prep files the follow-up.

**Assumptions:**

- **Assumes:** `execFileSync` with `timeout` reports a timeout kill as `e.code === "ETIMEDOUT"` on the Node 20 adopter floor as on Node 22. Validation: `node -e 'try{require("child_process").execFileSync("node",["-e","setInterval(()=>{},1e3)"],{timeout:300,killSignal:"SIGKILL"})}catch(e){console.log(e.code,e.signal,e.status)}'` prints `ETIMEDOUT SIGKILL null` on the Node 20 CI image.
- **Assumes:** review-call's last-backend slice exhaustion returns exit 8 promptly under a trickle now that FAFF-1239 (merged as 7bcbd8c7) aborts the abandoned element. Validation: the impure test below completes each attempt in about 2s; if an attempt takes about 32s instead, the backstop is doing the work and FAFF-1239's abort is not reaching this path.

## 8. DONE

### From WHY
- [ ] With a trickling one-backend chain and a 2s judge deadline, `cmdAssemble` resolves instead of hanging, and the case parks with an `(exit 8)` cause after the configured retries (impure test below)
- [ ] `review-call.mjs` and every `SKILL.md` are unchanged in the diff
- [ ] The `.faffrc.example.yaml` `build_judge` comment states that at the defaults the per-case worst case exceeds graft's 600s foreground call, and names FAFF-1246

### From WHAT
- [ ] `build-judge-evidence.js` exports `resolveBuildJudgeClock`, `reviewCallSpawnOptions`, `reviewCallExitFromError`, `DEFAULT_BUILD_JUDGE_DEADLINE_SECS` (480), `DEFAULT_BUILD_JUDGE_TIMEOUT_SECS` (120), `BUILD_JUDGE_SPAWN_GRACE_SECS` (30) and `REVIEW_CALL_DEADLINE_EXIT` (8)
- [ ] Unit: `BUILD_JUDGE_SPAWN_GRACE_SECS` equals `DEFAULT_GRACE_SECONDS` and `REVIEW_CALL_DEADLINE_EXIT` equals `EXIT.DEADLINE` (both read by dynamic import of `killable-spawn.mjs` / `review-call.mjs`)
- [ ] `cmdAssemble` accepts an injectable `deps.resolveBuildJudgeClock`, defaulting to the real config-loading resolver; `fakeDepsAlwaysOverturn` injects a fixed clock

### From HOW (clock resolution, unit tests on `resolveBuildJudgeClock`)
- [ ] `{}` and `null` -> `{ deadline: 480, timeout: 120 }`
- [ ] `adversarial: { deadline: 300, timeout: 90 }` -> `{ 300, 90 }`
- [ ] `adversarial: { deadline: 300, timeout: 90, build_judge: { deadline: 600, timeout: 45 } }` -> `{ 600, 45 }`
- [ ] `build_judge.deadline` of each of `0`, `-5`, `"abc"`, `""`, `2.5`, `true` with `adversarial.deadline: 300` -> deadline 300
- [ ] `build_judge.deadline: "600"` (quoted string) -> 600
- [ ] Invalid at both tiers (`build_judge.timeout: "x"`, `adversarial.timeout: 0`) -> timeout 120
- [ ] `adversarial.build_judge` as a non-map scalar -> falls through to the shared tier

### From HOW (threading, unit tests in `test/build-judge-evidence.test.mjs` following the `--backends-json` test at :315-346)
- [ ] Success path: the Phase-1 and Phase-2 calls each carry `--timeout <clock.timeout>` and `--deadline <clock.deadline>` exactly once, as strings, and `opts.deadlineSecs === clock.deadline`
- [ ] Retry path: with exit 5 dispositioned `retry` and `--retry-limit 2`, all 3 Phase-1 calls carry both flags and the same `opts.deadlineSecs`
- [ ] A Phase-2 retry (Phase 1 rules, Phase 2 returns 8 dispositioned `retry`, `--retry-limit 1`): both Phase-2 calls carry both flags
- [ ] The unresolvable-chain path never calls `resolveBuildJudgeClock` (a throwing injected resolver does not fail that test)
- [ ] Every existing test in `test/build-judge-evidence.test.mjs` passes unchanged except for adding the injected clock where a test reaches dispatch

### From HOW (backstop, unit tests)
- [ ] `reviewCallSpawnOptions(480)` deep-equals `{ encoding: "utf8", timeout: 510000, killSignal: "SIGKILL" }`; `reviewCallSpawnOptions(undefined)` deep-equals `{ encoding: "utf8" }`
- [ ] `reviewCallExitFromError({ code: "ETIMEDOUT", signal: "SIGKILL", status: null })` is 8
- [ ] `reviewCallExitFromError({ code: "ENOBUFS", signal: "SIGTERM", status: null })` is 1
- [ ] `reviewCallExitFromError({ signal: "SIGTERM", status: null })` is 1
- [ ] `reviewCallExitFromError({ status: 7 })` is 7 and `reviewCallExitFromError({ status: 8 })` is 8
- [ ] `realRunReviewCall` uses `reviewCallSpawnOptions(opts.deadlineSecs)` and `reviewCallExitFromError(e)`, and writes the `review-call still alive at deadline(` stderr line only on `ETIMEDOUT`
- [ ] Wiring, through the `opts.exec` seam: a fake exec receives options deep-equal to `reviewCallSpawnOptions(300)` when called with `{ deadlineSecs: 300 }`; a fake throwing `{ code: "ETIMEDOUT", signal: "SIGKILL", status: null }` gives `code` 8 and the stderr line; a fake throwing `{ code: "ENOBUFS", signal: "SIGTERM", status: null }` gives `code` 1 and no stderr line

### From HOW (impure, new file `test/impure/build-judge-deadline.test.mjs`)
- [ ] A fake server runs in a child process (`spawn(process.execPath, ["-e", <server source>])`), listens on 127.0.0.1:0, prints its port on stdout, serves `GET /v1/models` listing `A`, and answers every `POST /v1/chat/completions` with SSE headers, an immediate `: keepalive\n\n`, then the same every 50ms, never ending; it counts POSTs and reports the count on request (for example a `GET /count` endpoint)
- [ ] The test deletes `FAFF_RUN_DIR` from `process.env` for its duration (restoring it after) so no L4 remap applies
- [ ] It calls `cmdAssemble` with one standing critical round record, `--retry-limit "1"`, injected `resolveAdversarialBackends` -> `{ chain: [{ provider: "openai", model: "A", host: <server>/v1 }] }`, injected `resolveBuildJudgeClock` -> `{ deadline: 2, timeout: 120 }`, and no injected `runReviewCall` or `judgeDispatchDisposition`
- [ ] Assertions: return code 0; elapsed under 12000ms; the server counted exactly 2 POSTs; `ledger.json` has the case `resolution: "parked"` with `park_cause` equal to `phase-1 dispatch disposition "retry" (exit 8)`; no `ruling-*.json` was written
- [ ] The test always kills the server child and removes its temp dirs; the file runs in under 15s

### From HOW (docs)
- [ ] `.faffrc.example.yaml`: the FAFF-870 per-consumer comment no longer says "deadline and requires stay GLOBAL"; it says `requires` stays global and `deadline` splits for `spec_review` (FAFF-1054) and `build_judge`
- [ ] `.faffrc.example.yaml`: the commented per-consumer example gains a `build_judge:` block showing `refs`, `deadline: 480` and `timeout: 120`, with one comment line each on the fallback (`adversarial.build_judge.* -> adversarial.* -> 480 / 120`) and on the worst case (`(retry limit + 1) x 2 phases x deadline` per case)
- [ ] `docs/guide/cli.md` `build-judge-evidence` row (:169) gains one clause: each dispatch carries `--deadline` / `--timeout` resolved from `adversarial.build_judge.*` -> `adversarial.*` -> 480 / 120, with a spawn backstop at deadline + 30s that reports exit 8
- [ ] `faff validate-adapters` and `faff config check` still pass

### Integration smoke test

```
1. start the out-of-process trickling server (model A)
2. cmdAssemble(--retry-limit 1, chain [A], clock { deadline: 2, timeout: 120 }, real transport)
3. attempt 1: review-call slices 2s, returns exit 8; disposition "retry"
4. attempt 2: same; retries exhausted
5. case parks: 'phase-1 dispatch disposition "retry" (exit 8)'; cmdAssemble returns 0 at about 4 to 5s
6. no "review-call still alive" stderr line (the backstop never fired)
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues. One concern: bounding the build judge's review-call dispatch. The backstop and the flag threading share one resolved clock and always ship together. FAFF-1245 (the unused `graft.build_judge_retry_limit`) stays separate, since it needs its own wire-or-remove call.
- **Workstream fit (P1 + P5):** No change to this ticket.
  - FAFF-1228, FAFF-1244, FAFF-1245 and FAFF-1246 share one outcome: "review and judge calls end bounded and park honestly". FAFF-1067 does not belong in it.
  - Flag them for the next rehome pass instead of creating a container now.
- **Surfaced dependencies (P6):**
  - FAFF-1239 (the blocker) is Done.
  - FAFF-1245 would reuse this ticket's in-process resolver and edits the same `cmdAssemble` lines, so it is now blocked by FAFF-1244.
  - FAFF-1228 and FAFF-1067 touch only `review-call.mjs`, which this spec leaves alone, so neither needs a link.
- **Risk profile (P7):** applied at prep.
  - The bounded worst case (about 48 minutes per case at the defaults) still outlasts faff-graft's 600s foreground Bash call. At the defaults, an unhealthy backend still ends in the `built-but-not-admitted` hold, not an honest park.
  - Kept the 480s default, since a shorter one parks healthy slow reviewers. Restated the failure mode as expected, added a DONE line for the example-config comment, and filed FAFF-1246 to make `--assemble` fit or survive the caller's wait.
  - Build the impure trickle test early: it checks the FAFF-1239 assumption cheaply.

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
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
