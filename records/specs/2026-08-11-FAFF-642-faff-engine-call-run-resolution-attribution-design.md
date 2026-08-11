# FAFF-642 — `faff engine call` announces which run it attributes codex spend to

> Spec: faffter-dark-nlspec · 2026-07-25 · interactive · confidence: high

This covers the run-resolution path in `faff engine call`. It closes a silent fallback shipped in FAFF-604 and, in doing so, makes `engine.js` resolve a run the same way the rest of the CLI already does.

## 1. WHY — problem and principles

**The load-bearing model.** Everywhere else in `bin/lib`, "which run am I part of?" is answered by a stamped, positive signal before a guessed one: the explicit `--run-dir` flag, then the `$FAFF_RUN_DIR` pointer the orchestrator exports, and only then "the newest directory under `.faff/runs`". That last step is an mtime-shaped ownership signal — the exact class FAFF-229 retired for transcript attribution. `faff engine call` is the only run-resolving call site that skips the middle step, so what should be a last resort is its normal fallback, and it takes that fallback without saying a word.

**Problem.** `resolveSpendSink` (`engine.js:190-201`) has three branches: flag given → used verbatim; no flag → `latestRunDir(root)` → used **silently**; nothing found → a named stderr notice and no metering. The middle branch is the gap: a codex call's whole token spend can land in a sibling run's spend file with no trace of the guess, and with concurrent runs in one repo that is live, not hypothetical. This change inserts the environment pointer into the chain (turning the mtime guess into a genuine last resort), says so on stderr when the guess is still taken, and stamps how the run was resolved into the spend record so the doubt survives past a stderr line nobody reads.

**Design principles.**

**Metering never breaks a dispatch.** The FAFF-604 posture is explicit in code: a sink write fault warns and leaves the exit code alone (`engine-codex.js:236-249`, asserted at `test/engine-call.test.mjs:469-483`). Nothing here may introduce a non-zero exit, a throw, or a refusal on the attribution path. An implementation that refuses to run because attribution is uncertain is wrong regardless of how good its diagnostics are.

**A stamped pointer is evidence; a newest-mtime pick is a guess.** They deserve different treatment. `$FAFF_RUN_DIR` is written by the orchestrator that owns the run (`faff-beep-boop/SKILL.md:372`) and is already trusted as an *ownership match* elsewhere (`prepcheck.js:112`, `runcheck.js:101` compare it against `owner.run_dir`). Sorting directories by mtime is trusted nowhere as attribution — `shared-infra.js:204-211` says so in its own comment.

**Never silently redirect an explicit signal.** If a caller names a run — by flag or by environment — that run is used, even if it looks odd. The sibling *readers* downgrade a flag/env dir with no `run-ledger.json` back to `latestRunDir` (`sentry.js:727`, `quality.js:177`, `economics.js:730`); that is right for a read (you want *some* ledger to report on) and wrong for a write (you would move somebody's spend to a run they never named). `resolveLedgerOrFault`'s comment at `shared-infra.js:244-246` names that silent fallback as the "quietly blind" failure it exists to close.

**Reference context.**

| File | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/engine.js:190-201` | `resolveSpendSink` — the function this ticket changes |
| `plugin/skills/faff/bin/lib/engine.js:242` | Its only call site, inside the codex fork |
| `plugin/skills/faff/bin/lib/engine.js:178` | `--run-dir` flag declaration in `ENGINE_SPEC` |
| `plugin/skills/faff/bin/lib/shared-infra.js:193-226` | `sortRunDirsByMtimeDesc` + `latestRunDir`, with the "not attribution-grade" comment |
| `plugin/skills/faff/bin/lib/shared-infra.js:253-267` | `resolveLedgerOrFault` — the flag → env → latest chain, and the no-silent-redirect note |
| `sentry.js:726-728`, `sentry-poller.js:291`, `quality.js:176-178`, `economics.js:729-731`, `queue-state.js:169`, `disposition.js:193`, `heartbeat.js:306` | The other run-resolving sites, all consulting `$FAFF_RUN_DIR` |
| `prepcheck.js:112`, `runcheck.js:101` | `$FAFF_RUN_DIR` used as a positive ownership match |
| `plugin/skills/faff-beep-boop/SKILL.md:372` | `export FAFF_RUN_DIR="$PWD/.faff/runs/<run-id>"` — the pointer is genuinely set |
| `plugin/skills/faff/SKILL.md:913` | Gateway prose telling producer dispatch to pass `--run-dir "$FAFF_RUN_DIR"` |
| `plugin/skills/faff/bin/lib/engine-codex.js:236-249` | The spend record's shape and the warn-never-fail sink posture |
| `plugin/skills/faff/bin/lib/budget.js:614-650` | `appendEngineSpend` / `readEngineSpend` — the reader ignores unknown fields |
| `test/engine-call.test.mjs:485-509` | The two existing run-resolution tests; the fallback-taken path has none |

**Scope.** One function, one added record field, one line of gateway prose, and the tests that pin them. No change to how spend is measured, summed, or reported.

## 2. OUT OF SCOPE

- **Surfacing mtime-attributed spend in `budget` / `economics` output.** The new field makes it *possible* for a reader to say "this run's engine spend includes records it only got by guessing"; wiring that into a report is a separate change with its own format questions. Extension point: `readEngineSpend` (`budget.js:624`).
- **Changing the sibling readers' ledger-existence downgrade.** Defensible for readers; not touched here.
- **Session-id attribution for engine spend.** A codex `exec --ephemeral` call leaves no session artifact to match against, so there is no second signal to cross-check. Extension point: the record at `engine-codex.js:238-245`.
- **Attribution for the non-codex (HTTP) families.** Only the codex fork meters spend today; the HTTP path has no sink at all. Extension point: `engine.js:257`.
- **A programmatic caller for `faff engine call`.** There is none outside the CLI dispatcher; every real invocation is a shell line an agent runs per the gateway.

## 3. WHAT — resolution result and record shape

| Term | Meaning |
|---|---|
| Spend sink | The closure `resolveSpendSink` returns, appending one record to a run's spend file |
| Attribution source | Which of the three signals produced the run dir |
| Sanity notice | A separate stderr line for a resolved dir that does not look like a run |

```
ENUM AttributionSource:
  "flag"        # --run-dir was passed
  "env"         # $FAFF_RUN_DIR was set and --run-dir was not
  "latest-run"  # neither; newest .faff/runs/* with a run-ledger.json

RECORD EngineSpendRecord:
  ts, engine, provider, model, source        # unchanged
  input, output, cache_write, cache_read     # unchanged
  attribution: AttributionSource             # NEW — how the run dir was chosen
```

`readEngineSpend` (`budget.js:633-648`) reads only `model`, `engine`, and the four token classes and ignores everything else, so the added field is compatible in both directions: old records without it stay readable, new records disturb no existing total.

**Chosen:** add `attribution` to the record rather than relying on stderr alone. An unattended run's stderr is exactly the thing nobody is reading, and "safe to stop watching" means the doubt has to be durable, in the run's own files, not in a terminal that has scrolled away.

**Chosen:** the record gains no session or run identifier — rationale in section 6.

## 4. HOW — behaviour

```
PROCEDURE resolveSpendSink(runDirFlag, root, env):
  1. IF runDirFlag is set:            run_dir = runDirFlag ; source = "flag"
  2. ELSE IF env.FAFF_RUN_DIR is set and non-empty:
                                      run_dir = env.FAFF_RUN_DIR ; source = "env"
  3. ELSE:                            run_dir = latestRunDir(root)   # errors swallowed
                                      source = "latest-run"
  4. IF run_dir is null: write the no-run notice; return null (nothing recorded)
  5. IF source == "latest-run": write the fallback notice, naming run_dir
  6. IF run_dir has no run-ledger.json:
       write the sanity notice naming run_dir and source
       continue anyway — never redirect to another run
  7. Return a sink appending { ...record, attribution: source } to run_dir
```

**The three stderr lines.** All follow the house convention — `faff engine call: ` prefix, lower-case, factual, remedy in parentheses.

| Situation | Line |
|---|---|
| Fallback taken | `faff engine call: no --run-dir and no $FAFF_RUN_DIR — attributing codex spend to the newest run <run_dir> (pass --run-dir to attribute it exactly)` |
| No run at all | `faff engine call: engine call outside a run — spend not metered (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)` |
| Resolved dir isn't a run | `faff engine call: <run_dir> has no run-ledger.json — recording spend there anyway (resolved from <source>)` |

The no-run line keeps its existing leading clause verbatim so the assertion at `test/engine-call.test.mjs:494` still holds; only the parenthetical remedy widens to the phrasing already used at `sentry.js:858`.

**Silence policy.** The flag path and the environment path are both silent on the happy route. `$FAFF_RUN_DIR` is a pointer the run's own orchestrator wrote and that two other subcommands already treat as proof of ownership; warning every time it is used would put a line on stderr for every compliant autonomous dispatch that omits the flag, which trains readers to ignore the channel. The `latest-run` path is the only one that guessed, so it is the only one that speaks.

**Anti-pattern:** falling back from an explicit `--run-dir` or `$FAFF_RUN_DIR` to `latestRunDir` when the named dir has no ledger. Why: that moves a caller's spend into a run they never named, silently — the failure `shared-infra.js:244-246` exists to prevent.

**Anti-pattern:** refusing (non-zero exit) when the environment is set but `--run-dir` was omitted. Why: the environment now *resolves* that case correctly, so refusal would buy nothing and would break the plain ad-hoc call from a shell that happens to have `FAFF_RUN_DIR` exported. It also contradicts the metering-never-breaks-a-dispatch principle.

**Gateway prose.** `plugin/skills/faff/SKILL.md:913` describes the no-flag behaviour as resolving the newest run dir. That parenthetical becomes wrong once the environment is consulted; it gains a clause saying the CLI falls back to `$FAFF_RUN_DIR` first and only guesses the newest run when neither is present. The instruction to pass the flag does not change — an explicit flag is still the only signal that survives an unset or inherited environment.

**Failure mode — a stale inherited `$FAFF_RUN_DIR`.** A shell that exported the pointer during one run and keeps it afterwards will attribute later ad-hoc calls to the finished run, silently, because the environment path doesn't warn. *How you'd know:* spend records with `attribution: "env"` whose timestamps fall after the run ledger's close. *What it means:* accepted, not fixed here — the error direction is over-count on a closed run, the same safe-for-ceilings direction FAFF-604 already lives with, and the `attribution` field makes it diagnosable after the fact. If it shows up in practice, the fix is a liveness check against the pointed-at ledger's `owner.status`, not a new warning.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with one run under .faff/runs containing a run-ledger.json
  And no --run-dir flag and no $FAFF_RUN_DIR
When `faff engine call` resolves the spend sink
Then stderr contains a line naming that run dir as the newest-run fallback
  And the recorded spend record carries attribution "latest-run"
```

```
Given $FAFF_RUN_DIR points at run A and the newest run under .faff/runs is run B
  And no --run-dir flag is passed
When `faff engine call` resolves the spend sink
Then the spend is written to run A, not run B
  And no fallback notice appears on stderr
```

- The dispatch's exit code MUST be identical in all four resolution outcomes for an otherwise-identical call.
- No resolution path may throw: a missing `.faff/runs`, an unreadable candidate, or an empty `$FAFF_RUN_DIR` all resolve to one of the four outcomes.

## 6. Design decision rationale

**Adopt the standard flag → `$FAFF_RUN_DIR` → latest chain?** The status quo makes `engine.js` the only run-resolving site that ignores a signal seven siblings honour, and means every compliant-but-flagless in-run dispatch lands on the mtime guess. **Chosen:** insert `$FAFF_RUN_DIR` between the flag and the scan — it turns the guess from the common case into a real last resort, and it is the order `heartbeat.js:298` already writes down as the house rule.

**Is the environment path silent?** **Chosen:** silent on `env`, notice on `latest-run`. The pointer is a stamped ownership signal that two subcommands already accept as proof, so it is closer to the flag than to the scan. A warning on every flagless in-run dispatch would be noise that teaches readers to skip the channel, costing the fallback notice its whole value.

**Warn or refuse when an in-run dispatcher omits `--run-dir`?** The only way the code could know it is "in a run" is exactly the environment pointer — and once that pointer *resolves* the attribution correctly, the case a refusal would have caught no longer produces a wrong answer. A refusal would then only punish an ad-hoc call from a shell with an inherited export. **Chosen:** warn, never refuse. The harder signal the ticket wanted is delivered as durable evidence in the record, not as an exit code.

**Does the record gain a session or run id?** The transcript-side cross-check works because a child agent's transcript carries a `sessionId` to match against. A codex `exec --ephemeral` call leaves no equivalent artifact, so there is no second signal for an id to be checked against; a run-dir path field would restate the file's own location. **Chosen:** add `attribution` only. It is the one fact the record cannot otherwise reconstruct: whether this spend was attributed on evidence or on a guess.

**Does a resolved dir with no `run-ledger.json` get downgraded, as the sibling readers do?** **Chosen:** no — notice it and use it. The siblings are readers wanting some ledger to report on; this is a writer, and silently relocating a caller's spend is the quietly-blind failure. `appendEngineSpend` creates the directory if needed (`budget.js:614-616`), so the write is safe.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumes:** `$FAFF_RUN_DIR`, when set, points at the run the calling process belongs to. *Validate:* confirm `faff-beep-boop/SKILL.md:372` still exports it at run start, and that no skill exports it for a run other than its own — `grep -rn 'FAFF_RUN_DIR' plugin/skills/*/SKILL.md`.

## 8. DONE

### From WHY
- [ ] `resolveSpendSink` consults `$FAFF_RUN_DIR` between `--run-dir` and `latestRunDir`, matching the order `heartbeat.js:298` states.
- [ ] Taking the `latestRunDir` result emits a stderr line naming the resolved run dir.

### From WHAT
- [ ] Every spend record carries `attribution` set to `"flag"`, `"env"`, or `"latest-run"`.
- [ ] `readEngineSpend` totals are unchanged for records with and without the new field (existing budget tests pass untouched).
- [ ] No session id or run-dir path field is added to the record.

### From HOW (behaviour)
- [ ] `--run-dir` given: no fallback notice, `attribution: "flag"`, the named dir used even when a newer run exists.
- [ ] `$FAFF_RUN_DIR` set and no flag: no fallback notice, `attribution: "env"`, the pointed-at dir used even when a newer run exists.
- [ ] Neither set, a run found: notice fires naming the dir, `attribution: "latest-run"`.
- [ ] Neither set, no run found: the existing notice fires with the widened remedy, nothing recorded.
- [ ] All three lines use the `faff engine call: ` prefix with the remedy in parentheses.

### From HOW (edge cases)
- [ ] A resolved dir with no `run-ledger.json` produces the sanity notice and is still written to — never redirected.
- [ ] An empty-string `$FAFF_RUN_DIR` is treated as unset, falling through to the scan.
- [ ] The exit code is identical across all four outcomes; no path throws.

### Docs and tests
- [ ] `plugin/skills/faff/SKILL.md:913` describes the flag → `$FAFF_RUN_DIR` → newest-run chain, and still instructs in-run dispatches to pass `--run-dir`.
- [ ] `test/engine-call.test.mjs` gains coverage of the fallback-taken path, which has none today.
- [ ] It also gains an env-set-flag-absent case asserting silence and correct destination.
- [ ] The two existing FAFF-604 resolution tests still pass unmodified.

confidence: high

---

## Spec review — `approve` (2026-07-25)

Lenses fired: architectural, infosec, QA (single-pass; selected via `faff spec-review-lenses`, appetite high). Verdict **approve**, no objections. This was the only one of the four sibling specs to clear on the first pass.

The reviewer re-verified every load-bearing claim against `main` at `ec28e4c` rather than taking the spec's word:

- `engine.js:190-201` really does go flag → `latestRunDir`, silently. There is no `FAFF_RUN_DIR` anywhere in `engine.js`.
- All seven named siblings really do consult the pointer — `sentry.js:726`, `sentry-poller.js:291`, `quality.js:176`, `economics.js:729`, `queue-state.js:169`, `disposition.js:193`, `heartbeat.js:306`. The "only run-resolving call site that skips the middle step" framing is a checkable invariant with exactly one violation, and it holds.
- `faff-beep-boop/SKILL.md:372` really does export it at run start.
- `readEngineSpend` really does ignore unknown fields, so `attribution` is compatible in both directions.
- `prepcheck.js:112` and `runcheck.js:101` really do use the pointer as a positive ownership match.

Two test-compatibility risks were checked and found already handled: the existing outside-a-run assertion (`test/engine-call.test.mjs:494`) is a substring regex, so widening the parenthetical remedy is safe; and the exact-shape `assert.deepEqual` on the spend record (`:463-467`) injects its own sink, so putting `attribution` in the sink closure leaves that assertion untouched.

**Two prose points folded in rather than left for the build agent to rediscover:**

**Where `attribution` is set is load-bearing, not incidental.** The field must be added by the sink closure in `resolveSpendSink`, **not** by the record literal in `engine-codex.js:238-245`. §3's record diagram lists it beside the codex-written fields, which obscures that. Moving it into `engine-codex.js` would break the exact-shape assertion at `test/engine-call.test.mjs:463-467`, and would also put a fact the codex call cannot know (how its run was resolved) in the hands of the code that doesn't resolve it.

**The silent destination change deserves naming in §6.** Anyone running `faff engine call` today with `$FAFF_RUN_DIR` set and no `--run-dir` is currently getting latest-run attribution; after this lands they get the env run instead. That is the correct behaviour and the whole point of the ticket — but it is a change of destination for existing callers, not just the removal of a guess. The `attribution` field is what makes it detectable after the fact, and that reasoning belongs in the rationale rather than being reconstructed by a reviewer.

Neither changes the design or the acceptance criteria.

**Retained:**

confidence: high
spec-review: approve

---

**Sequencing note.** FAFF-640 extends the same spend record and reader with a `by_day` map. Both changes are additive and neither needs the other's output, so there is no blocking edge — but they should be sequenced rather than run in parallel, and whichever lands first owns the record's documented shape.
