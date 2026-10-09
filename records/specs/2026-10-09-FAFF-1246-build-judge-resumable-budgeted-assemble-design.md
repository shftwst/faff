# FAFF-1246: The build judge's bounded worst case still outlasts graft's 600s foreground Bash call

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1246.

This spec is for the build agent implementing FAFF-1246 and for the humans reviewing it. FAFF-1244 bounded every build-judge dispatch, but `faff build-judge-evidence --assemble` still runs every case, both phases and every retry inside one process, and faff-graft runs that process as one foreground Bash call capped at 600s. This ticket makes `--assemble` stop inside a per-call wall-clock budget, persist its progress after every attempt, and resume from `ledger.json` on the next call, so graft can chunk the judge across successive foreground calls with a heartbeat tick between them. It builds on FAFF-1248, which already stamps every ruling file with a binding, rejects an unbound ruling at `--admit`, and sweeps old rulings at every `--assemble`; this ticket narrows that sweep so a matching pass can resume.

## 1. WHY

**The idea the rest turns on.** The judge's total work cannot be made to fit 600s at the defaults (one case can need 6 dispatches of up to 480s each), so instead each `--assemble` call does only as much as fits in a budget, writes down exactly where it got to, and exits with a distinct "incomplete, call me again" code. The next call reads the ledger back, skips what is already decided, and carries on, with the per-case attempt counts living on disk so that chunking can never multiply the retries. graft loops that call the way it already loops the CI watch: tick the heartbeat, make one bounded foreground call, re-enter.

**Problem.**

- `cmdAssemble` (`plugin/skills/faff/bin/lib/build-judge-evidence.js` :420-533) assembles the case files, writes an all-`pending` `ledger.json` once, runs `dispatchJudgeRulings` over every case, and writes `ledger.json` again only after the whole loop (:526).
- At the defaults (deadline 480, spawn backstop +30s, retry limit 2) one case's worst case is `3 attempts x 2 phases x 510s`, about 51 minutes. faff-graft runs `--assemble` as one foreground Bash call (`faff-graft/SKILL.md` :504), capped at 600s, and a run goes stale at 900s without a heartbeat tick.
- When that call is killed, every park cause decided during dispatch is lost (it lived only in memory), the on-disk ledger still says every case is `pending`, and graft falls through to the `built-but-not-admitted` hold with no recorded cause.
- Re-running `--assemble` today starts from scratch: it overwrites `ledger.json` and re-dispatches every case, so a retry after a kill repeats work and resets the retry bound.
- After FAFF-1248, every `--assemble` deletes all `ruling-*.json` and `admit-result.json` on entry. That is right while every call starts fresh, but it would throw away a partial pass's rulings on every chunk, so resume needs the sweep narrowed to calls that really start fresh.

This change bounds each `--assemble` call by a wall-clock budget, persists the ledger after every attempt, resumes a ledger whose adjudication identity matches (sweeping only on a mismatch), binds the persisted Phase-1 reconstruction the same way FAFF-1248 binds rulings, and tells graft to loop the call.

### Design principles

**Fail direction stays park.** Every new path (budget stop, resume, identity mismatch, missing reconstruction, a killed attempt, a binding mismatch) ends in either more judge work or a park. Nothing here can turn an unresolved case into an admit.

**Attempts are counted before they start.** An attempt's count is bumped and persisted before `runReviewCall` is called, so an attempt killed by anything (the Bash cap, an operator, a crash) still counts toward `(retryLimit + 1)` per phase. Chunking must never make retries unbounded.

**Every call makes progress.** The first attempt of an invocation always runs, even when the budget is smaller than one attempt, so every incomplete exit has consumed at least one bounded attempt and the loop terminates.

**A persisted result only counts for the case it was made on.** FAFF-1248's ruling binding still holds unchanged; this ticket applies the same binding to the Phase-1 reconstruction file, and resumes a ledger only when its identity covers the same fields.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/build-judge-evidence.js`: `dispatchOne` (:260-324), `dispatchJudgeRulings` (:333-353), `BUILD_JUDGE_EVIDENCE_SPEC` / usage (:385-405), `cmdAssemble` (:420-533), `cmdAdmit` (:535-575) | JavaScript (CJS) | The file this ticket changes |
| FAFF-1248 in `build-judge-evidence.js`: `case_sha` on ledger entries, `bindingFor(ledger, cid)`, `bindingMatches(binding, ledger, cid)`, the `--assemble` sweep of `ruling-*.json` and `admit-result.json`, the `--admit` binding check | JavaScript (CJS) | Merged before this ticket; reused, and the sweep narrowed |
| `plugin/skills/faff/bin/lib/build-judge-casefile.js`: `assembleBuildCaseFiles` (:98-199), `sha256Text` (:201), `admitBuildRollup` (:216-274) | JavaScript (CJS) | Ledger entry shape (`finding_id`, `pre_ruling_diff_sha`, `ruling`, `resolution`, `park_cause`); unchanged |
| `plugin/skills/faff/bin/lib/config.js` `DEFAULTS` (:252-256), `config defaults --selftest` expected list (:3149-3150) | JavaScript | Where the new budget key registers |
| `plugin/skills/faff/bin/lib/events.js` (:2000) | JavaScript | Precedent: exit 3 means "floor-incomplete" in `faff events anchor` |
| `plugin/skills/faff/bin/lib/heartbeat.js` | JavaScript | Writes tmp + rename; the atomic-write precedent |
| `plugin/skills/faff-graft/SKILL.md` :353 (chunk or poll across successive foreground calls), :504 (the judge paragraph), :846 (CI watch: tick, bounded call, re-enter) | Prose | The caller and its existing chunking pattern |
| `plugin/skills/faff/bin/lib/validate-adapters.js` `SKILL_LINE_BASELINE` (:65, `faff-graft: 958`), `PARA_WORD_CAP = 200` (:79) | JavaScript | faff-graft is 957 lines today: one line of headroom |
| `test/build-judge-evidence.test.mjs` (`fakeDepsAlwaysOverturn` :199-213, `writeLedgerAndRulings` and the `cmdAdmit` tests :427-475), `test/impure/build-judge-deadline.test.mjs` | JavaScript (`node:test`) | Home of the new tests |
| `.faffrc.example.yaml` (:468-475), `docs/guide/cli.md` (:169) | YAML comments, Markdown | Docs touched |

**Scope.** `build-judge-evidence.js` (budget, resume, per-attempt persistence, reconstruction binding, the narrowed sweep), one config key, one new line in faff-graft's SKILL.md, tests, and two doc touches. `review-call.mjs`, `build-judge-casefile.js` and the 480s deadline default are unchanged.

## 2. OUT OF SCOPE

- **Changing the 480s judge deadline default.** Why excluded: FAFF-1244 chose it so healthy slow reviewers are not parked; this ticket makes the caller survive it instead. Extension point: `DEFAULT_BUILD_JUDGE_DEADLINE_SECS` and `adversarial.build_judge.deadline`.
- **Async or supervised dispatch with an in-process heartbeat.** Why excluded: `execFileSync` blocks the event loop, so a `setInterval` renewal cannot fire mid-dispatch; moving to `superviseSubprocess` is a larger transport change and still leaves one process running longer than the Bash cap. Extension point: `realRunReviewCall`.
- **The spec-side judge.** Why excluded: faff-prep already drives it one proposition per Bash call (`faff-prep/SKILL.md` :214-222). Extension point: `spec-judge-evidence.js`.
- **Wiring `graft.build_judge_retry_limit`.** Why excluded: FAFF-1245 owns it and lands first. Extension point: `cmdAssemble`'s retry-limit resolution.
- **The `built-but-not-admitted` hold's resume path.** The hold (:514-517) stashes "judge progress" that nothing consumes, and resume re-enters the dialogue loop rather than the judge. Why excluded: FAFF-1249 (blocked by this ticket) routes that resume back into the judge; meanwhile a resume that reaches `--assemble` with unchanged inputs resumes the persisted ledger for free, and one with changed inputs starts fresh safely. Extension point: faff-graft :517 and the resume store at :204.
- **Ruling binding and the `--admit` check.** Why excluded: FAFF-1248 shipped them; this ticket reuses them unchanged. Extension point: `bindingMatches`.
- **Shortening the total worst case.** The total judge work per case is unchanged (still up to 6 attempts); only its split across calls changes. Why excluded: tuning is config. Extension point: `adversarial.build_judge.deadline` and the retry limit.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Call budget | The wall-clock seconds one `--assemble` invocation may spend, measured from `cmdAssemble` entry |
| Attempt cost | `clock.deadline + BUILD_JUDGE_SPAWN_GRACE_SECS`: the longest one `runReviewCall` can take before the FAFF-1244 spawn backstop kills it |
| Adjudication identity | The tuple that decides whether an on-disk ledger describes the same judge pass as a fresh assembly (defined below) |
| Pending-unruled entry | A ledger entry with `resolution: "pending"` and `ruling: null`: still needs judge work |
| Ruled entry | `resolution: "overturned"`, or `resolution: "pending"` with a non-null `ruling` (UPHOLD or PRODUCT_BOUNDARY) |
| Incomplete exit | Exit 3 from `--assemble`: progress is persisted and the caller should call again |
| Binding | FAFF-1248's `{finding_id, pre_ruling_diff_sha, case_sha, run_id}` stamp on ruling files; this ticket also writes it into every reconstruction file |

### Constants and config

```
CONST DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS = 540
CONST ASSEMBLE_INCOMPLETE_EXIT            = 3

config key (new, DEFAULTS string like its neighbours):
  graft.build_judge_call_budget_secs: "540"
```

- **Chosen:** exit 3 for "incomplete, re-invoke". `--assemble` uses 0 and 2 today (`--admit` adds 1), so 3 is free on this command, and `faff events anchor` already uses 3 for "floor-incomplete". It is not a failure code: graft branches on it explicitly.
- **Chosen:** 540 as the default. It is under the 600s Bash cap with 60s headroom for Node start-up, assembly, config loads and the ledger writes, under the 900s heartbeat staleness window, and above the default attempt cost (480 + 30 = 510), so at the defaults one attempt always fits and the progress override below never fires.

### Ledger entry additions (per entry; `admitBuildRollup` ignores extra fields)

```
RECORD BuildJudgeLedgerEntry (existing fields, including FAFF-1248's case_sha, unchanged) +:
  judge_progress: RECORD      # added on the first attempt; absent on a never-dispatched entry
    phase1_attempts: Int >= 0 # attempts STARTED in Phase 1 across all invocations
    phase2_attempts: Int >= 0
    last_exit: Int | null     # exit of the latest COMPLETED attempt in the current phase; null while one is in flight or after a phase change
    reconstruction: String | null   # "recon-<case_id>.json" once Phase 1 produced a valid reconstruction
```

### Adjudication identity

```
PURE FUNCTION adjudicationIdentity(ledger) -> String:
  JSON.stringify({
    run_id: ledger.run_id,
    window_start: ledger.window_start,
    cases: ledger.order.map(cid => [cid, entries[cid].finding_id, entries[cid].pre_ruling_diff_sha, entries[cid].case_sha])
  })
```

- **Chosen:** the identity adds `case_sha` and `run_id` to the orchestrator's `{order, finding_id, pre_ruling_diff_sha, window_start}`. Why: a rebuttal-only round changes the argument but never the diff (`config.js` comment on `graft.review_rebuttal_round_cap`), and the acceptance criteria and repository evidence files can change too, so `finding_id` + diff sha can match while the case the judge would see differs. `run_id` feeds `orderSeed`, which decides the A/B coin swap. These are the same fields FAFF-1248 binds a ruling to, so a resumed ledger's rulings are bound to entries with the same identity. A ledger written before FAFF-1248 has no `case_sha`, so it never matches and starts fresh.

### Reconstruction file

```
recon-<case_id>.json = { binding: bindingFor(ledger, cid), stdout: String }   # raw Phase-1 stdout, mode 0600
```

`bindingFor` and `bindingMatches` are FAFF-1248's, reused as they are. Ruling files keep FAFF-1248's shape (`{ ...verdict, binding }`).

### CLI surface

```
faff build-judge-evidence --assemble ... [--retry-limit N] [--budget-secs N]

exit 0  complete: every case is ruled or parked; ledger final
exit 2  usage / plumbing failure (as today), including an invalid --budget-secs
exit 3  incomplete: budget reached; ledger persisted; call again with the same arguments

stdout (one JSON line), both exit 0 and exit 3:
  { assembled, dispatched, out, cases,           # existing keys, unchanged meaning
    resumed: Boolean,                            # true when an on-disk ledger was reused
    incomplete: Boolean,
    remaining: [case_id],                        # pending-unruled case ids, [] on exit 0
    attempts_remaining: Int }                    # see below; 0 on exit 0
```

`attempts_remaining` is the sum over pending-unruled entries of the attempts they may still start, with `L = retryLimit + 1`:

```
  reconstruction set:      L - phase2_attempts
  otherwise:               (L - phase1_attempts) + L
```

It never rises within one judge pass and falls by at least 1 across every call that exits 3, so graft can use it as the loop's termination check.

### Injectable deps (`cmdAssemble(values, deps)`, as today) +

```
  resolveBuildJudgeCallBudget?: () -> Int          # config tier + default only; default realResolveBuildJudgeCallBudget (config load)
  now?: () -> milliseconds                          # default Date.now; the budget clock
```

Export `resolveBuildJudgeCallBudget`, `adjudicationIdentity`, `DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS` and `ASSEMBLE_INCOMPLETE_EXIT`.

## 4. HOW

### Resolving the budget

```
PURE FUNCTION resolveBuildJudgeCallBudget(cfg) -> Int:
  RETURN positiveInt(dig(cfg, "graft.build_judge_call_budget_secs")) ?? DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS

FUNCTION realResolveBuildJudgeCallBudget() -> Int:      # loadConfig(findRoot()) then the pure resolver

in cmdAssemble, with the other argv checks (before any file is read or written):
  raw = values["--budget-secs"]
  IF raw != null AND positiveInt(raw) == null: RETURN usage error "--budget-secs expects an integer > 0" (exit 2)
later, at dispatch:
  budgetSecs = raw != null ? positiveInt(raw) : (deps.resolveBuildJudgeCallBudget OR realResolveBuildJudgeCallBudget)()
```

- `positiveInt` and `dig` are the FAFF-1244 helpers already in the file.
- **Chosen:** an invalid flag is a usage error; an invalid config value falls through to 540. A flag is the caller's explicit input (the `--window-start` precedent at :429-433); a config typo should not stop the judge (the `resolveBuildJudgeClock` precedent).
- The config read reuses the same `loadConfig(findRoot())` shape as `realResolveBuildJudgeClock`; if FAFF-1245 has introduced one shared config load in `cmdAssemble`, use it.

### The call, end to end

```
PROCEDURE cmdAssemble(values, deps):
  1. startedAt = now(); validate argv as today (+ --budget-secs)
  2. read rounds, diff, AC, repository evidence; collectAdjudicationSet; assembleBuildCaseFiles   (unchanged)
  3. stamp entry.case_sha for every entry (FAFF-1248, unchanged)
  4. mkdir outDir
  5. fresh = the assembled ledger
     existing = try JSON.parse(outDir/ledger.json) catch null
     IF existing has order[] and entries{} AND adjudicationIdentity(existing) == adjudicationIdentity(fresh):
          ledger = existing; resumed = true
     ELSE:
          sweep every ruling-*.json, recon-*.json and admit-result.json in outDir (FAFF-1248's sweep helper + recon-*)
          ledger = fresh; resumed = false
  6. write every case-<cid>.json (identical content on resume); persistLedger()
  7. IF ledger.order is empty: print summary; RETURN 0
  8. resolve the backend chain (as today). On error: park every PENDING-UNRULED entry with today's cause
     (ruled and parked entries keep their state); persistLedger(); print summary; RETURN 0
  9. resolve retryLimit (post-FAFF-1245: flag > config > 2), clock (FAFF-1244), budgetSecs
 10. IF clock.deadline + GRACE > budgetSecs: write one stderr advisory line naming both numbers
     ("each call will run one attempt and may overshoot the budget by up to <n>s")
 11. outcome = await dispatchJudgeRulings(ledger, caseFiles, outDir, deps + { budget, persistLedger })
 12. print summary (incomplete = outcome.stopped)
 13. RETURN outcome.stopped ? 3 : 0
     (a thrown error stays exit 2, as today; the ledger already holds everything up to the throw)
```

- **Chosen:** FAFF-1248's unconditional sweep moves inside the mismatch branch and gains `recon-*.json`. A matching identity keeps the pass's rulings and reconstructions; a mismatch clears them before anything else is written. Sweep failures stay best-effort, as in FAFF-1248, because the bindings are what guarantee safety.
- An unreadable or malformed `ledger.json` is treated as a mismatch: fresh start plus sweep.
- A ledger written before FAFF-1248 (no `case_sha`) is a mismatch.

**Anti-pattern:** resuming on a `finding_id`-only match. Why: a rebuttal-only round keeps every `finding_id` and the diff, and the judge would then serve a ruling on the old rebuttal for the new one.

### Persisting the ledger

```
PROCEDURE persistLedger():
  write JSON to outDir/ledger.json.tmp (mode 0600); chmod 0600 best-effort; rename over outDir/ledger.json
```

- **Chosen:** tmp + rename (the `heartbeat.js` pattern). A torn `ledger.json` from a kill mid-write would read as a mismatch and restart the pass, discarding the attempt counts.
- `persistLedger` is called: after step 6, after every attempt-count bump, after every completed attempt, and after every case outcome. A kill therefore loses at most the in-flight attempt's result, never its count, and never an earlier park cause.

### The resumable dispatch loop

```
PROCEDURE dispatchJudgeRulings(ledger, caseFiles, judgeDir, deps):
  FOR cid IN ledger.order:
    entry = ledger.entries[cid]
    IF entry missing OR entry.resolution == "parked": CONTINUE
    IF entry.resolution == "overturned" OR entry.ruling != null: CONTINUE        # ruled
    r = await dispatchOne(cid, caseFiles[cid], judgeDir, entry, deps)
    IF r.stopped: RETURN { stopped: true }                                        # entry state already persisted
    entry.ruling = r.ruling; entry.resolution = r.resolution
    IF r.cause: entry.park_cause = r.cause
    persistLedger()                                                               # ledger first ...
    IF r.ruling: write ruling-<cid>.json = { ...r.ruling, binding: bindingFor(ledger, cid) }  # ... then the file (FAFF-1248 shape)
  RETURN { stopped: false }
```

- **Chosen:** persist the ledger before writing the ruling file. The ledger's inline `ruling` is what `--admit` reads first; a kill between the two writes then leaves a complete ledger and only a missing secondary copy. (FAFF-1248 writes ruling files inside the loop and the ledger only at the end; this reorders that.)

```
PROCEDURE runPhase(phase, entry, args, deps) -> { stopped } | { exhausted, cause } | { disposition, res }:
  p = entry.judge_progress (create { 0, 0, null, null } on first use)
  LOOP:
    n = p["phase" + phase + "_attempts"]
    IF n >= retryLimit + 1:
      IF p.last_exit != null:
        RETURN { exhausted, cause: `phase-${phase} dispatch disposition "${await disposition(p.last_exit)}" (exit ${p.last_exit})` }
      RETURN { exhausted, cause: `phase-${phase} attempts exhausted: attempt ${n} of ${retryLimit + 1} did not complete` }
    IF NOT deps.budget.allows(): RETURN { stopped }
    p["phase" + phase + "_attempts"] = n + 1; p.last_exit = null; persistLedger()
    deps.budget.attemptsStarted += 1
    res = runReviewCall(args, runOpts)                           # FAFF-1244 clock + backstop, unchanged
    p.last_exit = res.code; persistLedger()
    disp = await judgeDispatchDisposition(res.code)
    IF disp == "retry": CONTINUE
    RETURN { disposition: disp, res }

budget.allows():
  attemptsStarted == 0                                                    # progress guarantee
  OR (now() - startedAt) / 1000 + clock.deadline + GRACE <= budgetSecs
```

- The exhausted-with-`last_exit` cause string is byte-identical to today's (`phase-1 dispatch disposition "retry" (exit 8)`), so the FAFF-1244 impure test's assertion still holds.
- A retry limit that changed between calls is read fresh each call; counts already above the new bound exhaust at once (towards park).

```
PROCEDURE dispatchOne(cid, caseFile, judgeDir, entry, deps):
  1. p = entry.judge_progress
  2. IF p.reconstruction == null:
       r1 = runPhase(1, ...Phase-1 args as today...)
       IF r1.stopped: RETURN { stopped }
       IF r1.exhausted: RETURN parked(r1.cause)
       IF r1.disposition != "ruling": RETURN parked(`phase-1 dispatch disposition "${r1.disposition}" (exit ${r1.res.code})`)
       IF NOT validateReconstruction(r1.res.stdout).ok: RETURN parked(`reconstruction empty/failed: ...`)   # as today
       write recon-<cid>.json = { binding: bindingFor(ledger, cid), stdout: r1.res.stdout } (mode 0600)
       p.reconstruction = "recon-<cid>.json"; p.last_exit = null; persistLedger()
       reconStdout = r1.res.stdout
     ELSE:
       read recon file; IF unreadable OR NOT bindingMatches(file.binding, ledger, cid)
                          OR NOT validateReconstruction(file.stdout).ok:
         RETURN parked("phase-1 reconstruction missing or unbound on resume")
       reconStdout = file.stdout
  3. r2 = runPhase(2, ...Phase-2 args as today, context built from imperativeScrub(reconStdout)...)
     stopped / exhausted / non-ruling / verdict-block handling exactly as today's Phase 2
  4. RETURN { ruling, resolution, cause } as today
```

- **Chosen:** persist Phase 1's validated output and resume at Phase 2, rather than re-running Phase 1. At the defaults only one attempt fits a 540s call (510s attempt cost), so a resumed case whose Phase 1 had to re-run would never reach Phase 2 when Phase 1 alone takes more than 30s. Re-running would also spend Phase-1 attempts the bound already counted.
- **Chosen:** a missing, unbound or invalid reconstruction file on resume parks the case rather than re-running Phase 1. It can only happen through outside interference with the judge dir, and re-running would let Phase 1 exceed its attempt bound.
- The temp dir for per-dispatch context files stays per call (`mkdtemp` in `dispatchJudgeRulings`, as today); nothing in it needs to survive a call.

**Anti-pattern:** checking the budget after an attempt instead of before. Why: the next attempt could then start with less than its attempt cost left and push the call past the Bash cap.

**Anti-pattern:** resetting or not persisting `judge_progress` on resume. Why: each chunk would then get a fresh `(retryLimit + 1)`, and a wedged backend would loop graft forever.

### `--admit`

Unchanged. FAFF-1248's binding check still holds: an incomplete pass leaves pending-unruled entries with no ruling, so `--admit` exits 2 (park) exactly as for any missing ruling, and a resumed pass's ruling files are bound to entries with the same identity.

### faff-graft SKILL.md

Add one line directly after :504 (keep it one paragraph under the 200-word cap; lean, no history):

> **Chunked judge calls.** Run each `--assemble` as its own foreground Bash call with `timeout: 600000`; it stops inside `graft.build_judge_call_budget_secs` (default 540) with its ledger persisted and exits `3` (incomplete). While it exits `3` and its printed `attempts_remaining` is lower than the previous call's, tick `faff heartbeat "$run_dir" --unit <issue>` and re-invoke it with the same arguments; on any other exit, or when `attempts_remaining` did not fall, stop looping and run `--admit`, whose fail-closed exit on an unresolved case parks.

- The file goes from 957 to 958 lines, which equals `SKILL_LINE_BASELINE["faff-graft"]` (958) and passes (`lines.length > cap` fails, equal does not).
- If FAFF-1245 has already grown the file, raise `SKILL_LINE_BASELINE["faff-graft"]` by exactly the net growth this ticket adds and append a `FAFF-1246 +1 faff-graft (...)` note to the baseline comment, matching the existing entries.
- **Chosen:** the loop ends on a non-falling `attempts_remaining`, not on a fixed call count. It needs no case count in the prose, and it also catches an identity that flaps between calls (each fresh start resets the count upwards).

### Docs

- `.faffrc.example.yaml` :474-475: replace the "until that lands, lower build_judge.deadline" lines with: each `--assemble` call stops inside `graft.build_judge_call_budget_secs` (default 540) and exits 3 so graft re-invokes it (FAFF-1246); keep `deadline + 30` at or under that budget so each call fits.
- `docs/guide/cli.md` :169: add `[--budget-secs N]` to the usage; add one clause: `--assemble` stops before any attempt that would not fit the call budget (`--budget-secs` > `graft.build_judge_call_budget_secs` > 540; the first attempt of a call always runs), persists `ledger.json` after every attempt, exits 3 (incomplete) to be re-invoked, resumes a ledger whose adjudication identity matches, and sweeps earlier ruling, reconstruction and admit-result files only when it does not (replacing FAFF-1248's every-call sweep wording).
- Update the `BUILD_JUDGE_EVIDENCE_USAGE` string and the file header comment (:6-21) to match.

### Edge cases

- **Budget smaller than one attempt** (for example `--budget-secs 60`, deadline 480). Each call runs exactly one attempt, writes the advisory line, and exits 3 (or 0 if that attempt finished the last case). The call can overshoot the budget by up to `deadline + 30 - budget` plus setup.
- **Overshoot bound in general.** One call lasts at most `max(budget, setup + deadline + 30)` plus the post-attempt writes, where setup is assembly, config loads and Node start-up (a few seconds).
- **Bash kills the call anyway** (only when `deadline + 30 + setup` exceeds 600s, an operator misconfiguration). The in-flight attempt is already counted; Bash returns a non-3 result, so graft stops looping and `--admit` parks. A review-call child orphaned by that kill is still bounded by its own `--deadline`.
- **A completed call with nothing left.** All entries ruled or parked on entry: no attempt runs, exit 0, `attempts_remaining: 0`.
- **Exhausted counts found at resume** (the last attempt was killed). The case parks with the "did not complete" cause without starting an attempt.
- **A kill after an attempt's result is persisted but before its outcome is.** The result is lost and the attempt stays counted: resume runs another attempt if the bound allows, otherwise parks with that phase's last-exit cause. Never an admit.
- **A ledger written before this ticket but after FAFF-1248.** It carries `case_sha`, so its identity can match; its pending-unruled entries have no `judge_progress` and start from zero counts. A one-time upgrade cost, still bounded.
- **Retry limit 0.** One attempt per phase; the formulae hold with `L = 1`.
- **Unresolvable backend chain on resume.** Only pending-unruled entries park; earlier rulings stand.
- **The FAFF-1244 impure trickle test** (deadline 2, retry limit 1, real config so budget 540). Both attempts fit; exit 0 and the same park cause as today.

### Failure modes

- **Graft's turn ends between chunks.** The chunks keep each call under the Bash cap, but the whole loop can still take far longer than one turn (worst case about 6 calls per case). How you'd know: graft still reaches the `built-but-not-admitted` hold, but now `ledger.json` shows per-case `judge_progress` and park causes. What it means: proceed; the honest cause is now on disk, and routing the hold's resume back into the judge loop is FAFF-1249.
- **Assembly is not deterministic across calls.** If anything in the case files varies between calls with identical inputs, every call starts fresh and the sweep throws away progress. How you'd know: `resumed: false` on every call after the first, and graft stopping because `attempts_remaining` did not fall. What it means: a bug in assembly; the loop still terminates and parks.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a judge dir from a first --assemble call over three standing criticals that ruled f-01 OVERTURN, ruled f-02 UPHOLD, and then exited 3 because a fake clock put the budget out of reach before f-03
And the round records, diff and flags are unchanged
When --assemble is called again with a fake runReviewCall that counts calls per case
Then it prints resumed: true, makes no call for f-01 or f-02, dispatches only f-03, exits 0, and ledger.json still holds the f-01 and f-02 rulings
```

```
Given retry limit 2, a fake runReviewCall that always returns exit 5 (dispositioned "retry") while advancing a fake clock by 600s per call, deadline 300 and budget 540
When graft's loop calls --assemble until it stops exiting 3
Then there are exactly 3 calls in total (exit 3, exit 3, exit 0), runReviewCall ran exactly 3 times, attempts_remaining went 5, 4, 0, and the case parks with park_cause 'phase-1 dispatch disposition "retry" (exit 5)'
```

```
Given a judge dir over one standing critical where a budget stop left f-01 with a persisted reconstruction and no Phase-2 attempt yet
And recon-f-01.json is then replaced by one whose binding names a different case_sha
When --assemble is called again with unchanged inputs
Then f-01 parks with cause "phase-1 reconstruction missing or unbound on resume", runReviewCall is never called for f-01, and the call exits 0
```

- Every `--assemble` call MUST start at least one attempt or exit 0; an exit 3 with no attempt started in that call is a defect.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Shape of the fix | Heartbeat thread inside the CLI; a smaller default deadline; a resumable, budgeted `--assemble` chunked by graft | **Chosen:** resumable and budgeted, chunked by graft |
| Incomplete exit code | Reuse 2; a new code | **Chosen:** 3 |
| Budget precedence | Config only; flag > config > default | **Chosen:** `--budget-secs` > `graft.build_judge_call_budget_secs` > 540 |
| Invalid budget input | Silent fallback everywhere; usage error everywhere; usage error for the flag, fallthrough for config | **Chosen:** usage error for the flag, fallthrough for config |
| Default budget | 480; 540; 570 | **Chosen:** 540 |
| A call that cannot fit one attempt | Refuse and exit 3 at once; always run the first attempt | **Chosen:** always run the first attempt |
| Resume identity | `finding_id` + diff sha + window; add `case_sha` and `run_id` | **Chosen:** add `case_sha` and `run_id` |
| When to count an attempt | After it completes; before it starts | **Chosen:** before it starts, persisted |
| Phase 1 on resume | Re-run and count it; persist the reconstruction | **Chosen:** persist to a bound `recon-<cid>.json` |
| Missing reconstruction on resume | Re-run Phase 1; park | **Chosen:** park |
| Write order per outcome | Ruling file then ledger; ledger then ruling file | **Chosen:** ledger, then ruling file |
| Sweep | Keep FAFF-1248's every-call sweep; sweep only on an identity mismatch | **Chosen:** only on a mismatch, adding `recon-*.json` |
| Ledger write | Plain overwrite; tmp + rename | **Chosen:** tmp + rename |
| graft loop bound | Fixed call count; `attempts_remaining` strictly falling | **Chosen:** `attempts_remaining` strictly falling |

**Resumable over a heartbeat thread or a smaller deadline.** A heartbeat thread cannot fire while `execFileSync` blocks, and even an async dispatch leaves one process alive past the 600s Bash cap, which kills it regardless of heartbeats. A smaller deadline (to fit six attempts in 600s, about 90s) would park healthy slow reviewers; FAFF-1244 recorded code-review Phase 2 calls taking 42 to 320s. Chunking is the pattern graft already prescribes (:353) and uses for CI (:846).

**Exit 3.** Exit 2 already means plumbing failure, which graft must not loop on. 3 is unused by this command and already means "incomplete" in `faff events anchor`.

**Flag usage error, config fallthrough.** The flag is graft's or an operator's explicit request and a typo there is better caught at once, as `--window-start` does. A config typo should leave the judge running on the default, as `resolveBuildJudgeClock` does.

**540.** It leaves 60s under the Bash cap for start-up and writes, stays under the 900s staleness window so one tick per call is enough, and fits the default attempt cost (510) so the progress override never fires at the defaults. 480 would make every default call overshoot; 570 leaves too little headroom for a slow assembly.

**First attempt always runs.** Without it, a budget below the attempt cost would make every call exit 3 with no progress, and graft would loop forever (or stop at once with nothing done). With it, every exit 3 has consumed a bounded attempt, which is what makes `attempts_remaining` fall.

**Identity with `case_sha` and `run_id`.** See WHAT. At the time of writing, `graft.review_rebuttal_round_cap` defaults to 1, so a rebuttal-only round with an unchanged diff is a real path into the judge.

**Count before the attempt.** Counting after would let a Bash kill or crash mid-attempt go uncounted, and a wedged backend that always outlives the call would then retry forever.

**Persist the reconstruction.** At the defaults only one attempt fits a call, so re-running Phase 1 on resume would stop a slow case from ever reaching Phase 2. The file is bound like a ruling file so it cannot be served to a different case, and written mode 0600 like the ledger.

**Park on a missing reconstruction.** The only way to reach it is outside interference with the judge dir; parking keeps the Phase-1 bound exact and fails safe.

**Ledger before ruling file.** `--admit` trusts the ledger's inline ruling first, so the ledger is the record that must never lag.

**Sweep only on a mismatch.** An every-call sweep would delete a partial pass's rulings on every chunk and make resume impossible. On a mismatch nothing on disk can belong to the new pass, so everything it could misread goes, now including reconstructions.

**tmp + rename.** A torn ledger would be read as a mismatch and restart the pass with zero counts. `heartbeat.js` already writes this way.

**`attempts_remaining` as the loop bound.** A fixed call count would need the case count and retry limit in the SKILL prose, which graft does not otherwise know. A strictly falling counter is checkable from the call's own output and also catches a flapping identity.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** FAFF-1248 has merged: ledger entries carry `case_sha`, ruling files carry its `binding`, `bindingFor` / `bindingMatches` exist, `--assemble` sweeps rulings on entry, and `--admit` rejects an unbound ruling. Validation: before starting, grep `build-judge-evidence.js` on `main` for `bindingMatches` and the sweep; if absent, stop, because this spec does not re-specify them.
- **Assumes:** FAFF-1245 lands before this ticket and leaves `cmdAssemble` with a resolved `retryLimit` (`--retry-limit` > `graft.build_judge_retry_limit` > 2). This spec depends only on that resolved value, not on FAFF-1245's helper names or line numbers. Validation: before starting, read `cmdAssemble` on `main` and confirm `graft.build_judge_retry_limit` is read in-process; if FAFF-1245 has not merged, build against today's `--retry-limit` > 2 and leave the config read to FAFF-1245.
- **Assumes:** the Bash tool's maximum `timeout` is 600000ms. Validation: the Bash tool description in the build agent's own harness states its max timeout; if it is lower, the default budget must drop below it with the same 60s headroom.
- **Assumes:** graft passes the same `--dir`, `--issue`, `--diff`, `--out` and optional files on every call of one judge pass, and nothing rewrites the round records or the diff file between calls. Validation: faff-graft :498-504 writes round records only inside the dialogue loop and the diff once before the judge; the identity check makes a violation safe (a fresh start), and the scenario tests prove resume on unchanged inputs.

## 8. DONE

### From WHY
- [ ] A judge pass whose total work exceeds one call's budget completes across several `--assemble` calls, each exiting 3 until the last exits 0, with no case re-dispatched once ruled (resume scenario test)
- [ ] After a simulated kill mid-dispatch, `ledger.json` on disk holds the park causes of every case decided before the kill and the in-flight case's bumped attempt count
- [ ] Still holds: FAFF-1248's stale-OVERTURN and no-binding `--admit` tests pass unchanged
- [ ] `review-call.mjs`, `build-judge-casefile.js` and `DEFAULT_BUILD_JUDGE_DEADLINE_SECS` (480) are unchanged in the diff

### From WHAT
- [ ] `config.js` `DEFAULTS` has `"graft.build_judge_call_budget_secs": "540"` and the `faff config defaults --selftest` expected list includes it; `faff config get graft.build_judge_call_budget_secs` prints `540` in a repo that does not set it
- [ ] Unit: `DEFAULTS["graft.build_judge_call_budget_secs"] === String(DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS)` and `ASSEMBLE_INCOMPLETE_EXIT === 3`
- [ ] `build-judge-evidence.js` exports `resolveBuildJudgeCallBudget`, `adjudicationIdentity`, `bindingMatches`, `DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS` and `ASSEMBLE_INCOMPLETE_EXIT`
- [ ] Every ledger entry that has had at least one attempt carries `judge_progress` with the four fields; an entry with none may lack it, and resume reads an absent `judge_progress` as zero counts
- [ ] The `dispatched` stdout key keeps its fresh-assembly meaning (`order.length` minus the cases parked by this call's assembly); progress across calls is read from `attempts_remaining` and the ledger, never from `dispatched`
- [ ] Still holds: every `ruling-<cid>.json` carries FAFF-1248's binding, now written after the ledger that holds the same ruling inline
- [ ] Every `recon-<cid>.json` is mode 0600 and carries `binding` (equal to `bindingFor(ledger, cid)`) and `stdout`
- [ ] `--assemble` stdout carries `resumed`, `incomplete`, `remaining` and `attempts_remaining` on both exit 0 and exit 3, and the existing keys unchanged

### From HOW (budget resolution)
- [ ] `resolveBuildJudgeCallBudget`: `{}` and `null` -> 540; `graft.build_judge_call_budget_secs: 300` -> 300; `"300"` -> 300; `0`, `-5`, `"abc"`, `2.5` -> 540
- [ ] `cmdAssemble` with `--budget-secs "120"` and an injected `resolveBuildJudgeCallBudget` returning 300 uses 120 (observable through the budget stop with a fake clock), and never calls the injected resolver
- [ ] `fakeDepsAlwaysOverturn` injects `resolveBuildJudgeCallBudget: () => 540` so the shared fixture stays hermetic
- [ ] `cmdAssemble` with `--budget-secs 0`, `abc` or `2.5` returns 2 and writes nothing under `--out`

### From HOW (resume and identity)
- [ ] Identity match: a second call reuses the ledger (`resumed: true`), makes zero `runReviewCall` calls for overturned, parked and pending-with-ruling entries, and dispatches only pending-unruled entries (fake `runReviewCall` counts calls per case id)
- [ ] Identity mismatch on a changed adjudication set: before the first `runReviewCall`, the judge dir holds no `ruling-*.json`, `recon-*.json` or `admit-result.json` from the earlier set; `resumed: false`; counts start at 0
- [ ] Identity mismatch on a case-content change with the same `finding_id` and diff (a different `--acceptance-criteria` file): `case_sha` differs and the pass starts fresh with the sweep
- [ ] A malformed `ledger.json` and a pre-FAFF-1248 ledger (entries without `case_sha`) each start fresh with the sweep
- [ ] On an identity match, no `ruling-*.json` or `recon-*.json` of the pass is deleted (FAFF-1248's every-call sweep no longer runs)
- [ ] An unresolvable backend chain on resume parks only pending-unruled entries; ruled entries keep their `ruling` and `resolution`

### From HOW (budget, attempts and persistence)
- [ ] Budget stop: with a fake clock that makes the second attempt not fit, the call exits 3, `ledger.json` shows the first case's outcome and `judge_progress` counts, and a further call completes with exit 0
- [ ] Attempts bounded across calls: the always-retry scenario above makes exactly `retryLimit + 1` Phase-1 `runReviewCall` calls in total across all calls, and the case parks with the same cause string a single-call run produces
- [ ] Progress guarantee: with `--budget-secs 10` and a clock deadline of 300, every call starts exactly one attempt, writes one stderr advisory line naming both numbers, and exits 3 until the last; `attempts_remaining` falls by at least 1 per call
- [ ] Kill simulation: a fake `runReviewCall` that returns a park-dispositioned exit for `f-01` and throws on `f-02` makes `cmdAssemble` return 2, and `ledger.json` on disk shows `f-01` parked with its cause and `f-02` with `phase1_attempts: 1` and `last_exit: null`
- [ ] Killed last attempt: re-calling that judge dir with `--retry-limit 0` parks `f-02` with cause `phase-1 attempts exhausted: attempt 1 of 1 did not complete` and makes no `runReviewCall` call
- [ ] Phase-1 persistence: when the budget stops the call after Phase 1 succeeds, `recon-f-01.json` exists with a matching binding, and the next call makes zero Phase-1 calls and one Phase-2 call whose context holds `imperativeScrub` of the persisted stdout
- [ ] A missing or wrongly bound `recon-<cid>.json` on resume (last scenario) parks the case with cause `phase-1 reconstruction missing or unbound on resume` and makes no `runReviewCall` call
- [ ] `ledger.json` is written through a `.tmp` file and rename, and stays mode 0600
- [ ] Every existing test in `test/build-judge-evidence.test.mjs` and `test/impure/build-judge-deadline.test.mjs` passes unchanged (FAFF-1248's sweep test re-assembles a changed adjudication set, which is an identity mismatch, so it still sees the sweep)

- [ ] The started-attempt counter behind `budget.allows()` is per invocation: it is set once per `--assemble` call and never reset per case or per phase. Test: a call whose first case parks with no attempt (exhausted at resume), followed by a budget stop, still makes at least one `runReviewCall` before exiting 3
- [ ] A resumed call whose ledger has every entry ruled or parked makes no `runReviewCall`, exits 0 and prints `attempts_remaining: 0`
- [ ] A ledger written after FAFF-1248 but before this ticket (no `judge_progress`) resumes from zero counts; the bound on that one upgrade path is 2 x (retryLimit + 1) attempts per phase, stated in the edge case

### From HOW (`--admit`)
- [ ] Still holds: `cmdAdmit` is unchanged in the diff, and `--admit` on a judge dir left by an exit-3 call exits 2

### From HOW (SKILL.md and docs)
- [ ] `faff-graft/SKILL.md` gains the one "Chunked judge calls" line after the would-be-park judge paragraph, naming the foreground call with `timeout: 600000`, `graft.build_judge_call_budget_secs`, exit `3`, `attempts_remaining`, the `faff heartbeat` tick between calls and the fall-through to `--admit`
- [ ] `SKILL_LINE_BASELINE["faff-graft"]` equals the file's line count after the change (unchanged at 958 if FAFF-1245 added no lines, otherwise raised with a FAFF-1246 note)
- [ ] `.faffrc.example.yaml` no longer says "until that lands, lower build_judge.deadline"; it names the call budget, exit 3 and FAFF-1246
- [ ] `docs/guide/cli.md` :169 and `BUILD_JUDGE_EVIDENCE_USAGE` show `[--budget-secs N]`, exit 3, resume and the mismatch-only sweep
- [ ] `faff validate-adapters`, `faff config check --selftest` and `npm test` pass

### Integration smoke test

```
1. three standing criticals; fake clock advancing 400s per runReviewCall; deadline 300; budget 540; fakes that OVERTURN everything
2. call 1: f-01 Phase 1 runs (first attempt); the next attempt would not fit (400 + 330 > 540) -> exit 3, recon-f-01.json written
3. call 2: f-01 Phase 2 -> OVERTURN -> ledger then ruling-f-01.json (bound); next attempt does not fit -> exit 3
4. calls 3 to 6: f-02 and f-03, one attempt each, same pattern
5. call 6 exits 0 with attempts_remaining 0; attempts_remaining strictly fell on every call
6. --admit, with the latest round listing the same three standing criticals (all now OVERTURN-ruled, so the floor passes): every ruling bound, exit 0, admit true
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4): split recommended**

- **What's there.** The spec covers two separate concerns:
  - **A. Ruling binding.** Ruling files get a `binding` stamp, `--admit` checks `bindingMatches`, and stale `ruling-*` files are swept on a fresh assembly.
  - **B. Budgeted, resumable `--assemble`.** This part brings the call budget, exit 3, the adjudication identity, `judge_progress` counts persisted before each attempt starts, the tmp + rename ledger write, the bound `recon-<cid>.json` Phase-1 persistence, the new config key, the graft loop line and the docs.
  - Taken together, that is 16 "Chosen" decisions, 30-odd DONE items and `build-tier: complex`. That is well past a 1-3 day unit.
- **Why it matters.**
  - A is a fail-open in a governance path, and it can be reached today. `cmdAdmit` (`build-judge-evidence.js` :549-557) falls back to `ruling-<cid>.json` for any non-parked entry with a null inline ruling, and never checks which finding the file belongs to.
  - At the defaults, `--assemble` is very likely to be killed by the 600s Bash cap. That kill leaves the on-disk ledger with every entry `pending` and every ruling null. Any `--admit` that follows, whether graft runs it or an operator does, can read a positional `f-01` OVERTURN from an earlier assembly. With a single standing critical, that one stale OVERTURN is enough to admit.
  - Bundled, the safety fix waits on the riskiest part of the ticket: the resume state machine and the graft prose loop. Both carry more review churn and more chance of a park mid-build.
  - A does not depend on B. Today's `--assemble` always starts fresh, so an unconditional sweep of `ruling-*.json` / `admit-result.json` plus stamping `case_sha` on each entry is enough to bind rulings.
- **What to do.**
  - Split A into its own ticket, raise its priority, and ship it first. Its scope:
    - `case_sha` on ledger entries.
    - The `binding` stamp on ruling files, spread after the verdict fields.
    - The `bindingMatches` check at `--admit` (exit 2, treated as missing).
    - An unconditional sweep at `--assemble` entry.
    - The two `cmdAdmit` fixture updates.
    - The stale-OVERTURN reproduction, the no-binding test and the holdout scenario.
    - The `cli.md` binding clause.

    That is about a day of work, with no graft or config change.
  - Keep FAFF-1246 for B, blocked by the new ticket. On top of A, B adds:
    - Narrowing the sweep to an identity mismatch (plus the `recon-*` kind).
    - Binding `recon-<cid>.json`.
    - The rest of the resume work.
  - B on its own is still at the top of the size range. It hangs together, though: per-attempt persistence without resume delivers nothing anyone can see. Keep it as one unit.

**Workstream fit? (principles 1 + 5)**

No issues. The ticket has no project, which matches the default landing for unsequenced work. Its siblings (FAFF-1228, FAFF-1247, FAFF-1067) and FAFF-1245 all serve one outcome: build-judge adjudication that finishes reliably under unattended graft. If more tickets keep landing in that cluster, it could become an outcome-led project later. That call is for a later pass, not for this ticket.

**Deps surfaced? (principle 6): one implicit follow-up has no ticket**

- **What's there.**
  - The blocker on FAFF-1245 is declared, and the spec's fallback (build against `--retry-limit` > 2 if FAFF-1245 has not merged) does not break that link.
  - The spec defers routing the `built-but-not-admitted` hold's resume back into the judge loop. That appears in OUT OF SCOPE and in Failure modes ("graft's turn ends between chunks ... the out-of-scope follow-up named above"). No ticket exists for it: a Linear search for "built-but-not-admitted" finds only FAFF-996 (Done), FAFF-1246 itself and unrelated work.
  - FAFF-1245 and this ticket both edit `faff-graft/SKILL.md` and `SKILL_LINE_BASELINE`. The spec handles that collision explicitly.
- **Why it matters.** The worst case is about 6 calls per case. A build turn can end partway through that loop, and graft then still falls back to the hold, whose stashed "judge progress" nothing reads. Until the follow-up exists, the user-visible gain from B is mostly honest park causes, not more admits. A dependency that lives only in spec prose cannot be sequenced by tidy or beep-boop.
- **What to do.** File the hold-resume routing follow-up as its own ticket (resume from a hold re-enters `--assemble`, not the dialogue loop), blocked by FAFF-1246. Then cite its ID in OUT OF SCOPE and in Failure modes.

**Risk profile? (principle 7)**

No issues needing a spike.
- The riskiest part is the on-disk resume state machine and the graft agent's own handling of the exit-3 loop. Both follow existing patterns: chunked foreground calls at graft :353, the CI watch at :846, and exit 3 already meaning "incomplete" in `faff events anchor`.
- The fail direction always ends in a park, and `attempts_remaining` must strictly fall, so a misbehaving loop terminates and parks rather than admits.
- Shipping the binding fix first (see right-sizing) is the cheap de-risking step. It closes the safety exposure before the larger, more novel change lands.

**Applied at prep:**

- Split: the ruling binding moved to FAFF-1248 (High, Bug), which blocks this ticket and ships first. This spec now assumes FAFF-1248 has merged, and narrows its sweep to an identity mismatch.
- Filed FAFF-1249, blocked by this ticket: resume from the built-but-not-admitted hold re-enters the judge. It is cited in OUT OF SCOPE and in Failure modes.

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
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
