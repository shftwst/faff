# FAFF-471 — `sentrycheck`: staleness-triggered sentry consult in the Stop-hook family (assist watchdog locus)

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-471.

Spec for FAFF-471 (Backlog, T3). Audience: the build agent implementing the hook half of ADR-0065's composite watchdog, and human reviewers checking it against ADR-0065 and the FAFF-205/233/235 gate lineage. Sibling ticket FAFF-470 (mint-scoped detached poller — the primary half) is specced by a peer in this same run; this spec deliberately covers **only the hook half**.

## 1. WHY — Problem and principles

**Load-bearing model:** every faff Stop hook fires on *every* session's turn-end and looks at the newest run ledger; the FAFF-205 ownership/liveness gate (`runIsOwned` / `runIsHeld`) already classifies that ledger as owned / foreign-held / foreign-abandoned-looking. This ticket adds one more Stop-hook command that, in *exactly* the foreign-abandoned-looking case, spawns the unmodified `faff sentry check` CLI and surfaces its verdict as a non-blocking advisory — turning any other session's turn-end into an opportunistic sentry consult, with zero new detection math.

**Problem:** sentry today runs only when the supervised orchestrator cooperates (FAFF-352 checkpoints), so a wall-clock-runaway run that stops reaching checkpoints starves its own supervisor. ADR-0065 settled a composite fix — detached poller (primary, FAFF-470) + Stop-hook staleness consult (cheap assist, this ticket). This ticket ships the assist: when any session ends a turn while an abandoned-looking foreign run sits on disk, sentry gets consulted and the human gets told.

**Design principles** (each would reject an otherwise-valid implementation):

- **Consume, never re-derive** (ADR-0065): the hook invokes `faff sentry check`; it reimplements no trigger predicate, no threshold, no liveness math.
- **Never trap a foreign session** (FAFF-235): the hook never blocks Stop and never exits non-zero in `--hook` mode. Advisory stderr only.
- **Heartbeat-only liveness** (FAFF-233): the gate reuses `runIsHeld` verbatim; pid is never consulted.
- **Explicitly insufficient alone** (ADR-0065): the solo-overnight threat model has no other session to fire this hook. The hook is additive assist; nothing here may be argued as a reason to descope FAFF-470.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | JS | Registrar: `FAFF_STOP_HOOKS` (L18), `probeServes` (L171), `planStopHooks`; one new string + selftest updates |
| `plugin/skills/faff/bin/lib/runcheck.js` | JS | Gate shape to reuse: `runIsOwned` (L74), `runIsHeld` (L94), `heartbeatStaleSecs` (L63); `--hook` silence discipline |
| `plugin/skills/faff/bin/lib/sentry.js` | JS | The consumed CLI: `sentry check --json` payload, exit 3 indeterminate (FAFF-425); `sentryReadBudget` child-spawn pattern to mirror |
| `plugin/skills/faff/bin/lib/heartbeat.js` | JS | `overlayHeartbeat` / `readHeartbeatFile` — effective heartbeat before the gate runs |
| `plugin/skills/faff/bin/faff` | JS | Dispatch map + usage text; gains one entry |
| `docs/adr/0065-…md` | md | The recorded decision this implements (follow-up #2) |
| `test/runcheck-gate.test.mjs`, `test/hooks-ensure.test.mjs` | JS | Test patterns: `execFileSync`/`spawnSync` + `mkdtempSync` fixture roots + `--selftest` tables |

**Scope:** one new governance-region hook module + one registrar list entry + one dispatch entry; the assist half of ADR-0065's composite.

## 2. OUT OF SCOPE

- **FAFF-470 detached poller** — the primary half; being specced by a peer this run. Extension point: `faff-beep-boop` skill prose at run-mint. Build note: both tickets touch `bin/faff` dispatch — conflict analysis serialises the builds.
- **Acting on the verdict (`faff sentry abort`) from the hook** — this ticket surfaces only (see D5). Extension point: the poller (mint-scoped actor per ADR-0065) or a follow-up ticket after FAFF-466 integrity-gate wiring.
- **Advisory dedup / rate-limiting** — a stale run will re-warn every turn-end, matching runcheck's FAFF-235 posture. Extension point: a per-run sentinel file under the run dir.
- **Andon/paging on trip** — ADR-0065 follow-up #3, gated on FAFF-386. Extension point: the advisory-emit line in the new module.
- **Forged-ledger residual (ADR-0034/FAFF-324 vectors 4/4b)** — named, tracked elsewhere; this hook shares the container/uid boundary and does not claim to close it.
- **`faff doctor` awareness of the new registration** — doctor checks the merge-fence only today; extending it is a separate cleanup.
- **A new staleness knob** — see D3.

## 3. WHAT — Vocabulary, types, interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| foreign run | Newest run ledger where `runIsOwned` is false (no `FAFF_RUN_DIR` match, no `owner.session_id`/`FAFF_SESSION_ID` match) |
| held | `runIsHeld` true: owner present, `status:"running"`, effective heartbeat age ≤ staleness window |
| abandoned-looking | foreign ∧ `owner.status === "running"` ∧ not held — exactly the case runcheck WARNs on |
| consult | One child spawn of `faff sentry check --json --run-dir <dir>` |
| effective heartbeat | `owner.last_heartbeat` after `overlayHeartbeat(ledger, readHeartbeatFile(runDir))` |

**Subcommand name + module home.** Weighed: (a) a thin `--hook` mode on `sentry.js`; (b) reusing `sentry` itself as the `FAFF_STOP_HOOKS` token; (c) a new module + subcommand. (b) is broken by construction: `binInvocation` registers `faff sentry --hook`, under which `cmdSentry` finds no `check|abort` positional and exits 2 — and since its stderr ("expected one of check | abort") doesn't match `probeServes`' only not-served signal (`/unknown subcommand/`), the registrar would happily register a command that **blocks every session end**. (a) muddies the pure L4 supervisory surface with an interactive-session hook and still needs a distinct dispatch token. **Chosen:** new subcommand `sentrycheck`, new module `plugin/skills/faff/bin/lib/sentrycheck.js` (`region:governance`, sibling of runcheck) — family-consistent with `runcheck`/`prepcheck`, a clean single token for `commandInvokesFaffHook` identity.

**CLI surface.** Weighed: full plain-report mode (runcheck shape) vs hook-only minimal (merge-fence shape). Diagnostics already exist as `faff sentry check` itself; a plain mode would duplicate it. **Chosen:** minimal surface — `faff sentrycheck --hook [--root DIR]` and `faff sentrycheck --selftest` only. `--root` is honoured (root for `latestRunDir`; also what `probeServes` passes); against an empty/throwaway root the command exits 0 fast, so `probeServes` clears it.

**Types:**

```
ENUM GateDecision:
  skip-no-run        # no run dir / no ledger resolvable
  skip-unreadable    # ledger present but unparseable (D8: silent)
  skip-owned         # this session owns the run
  skip-not-running   # owner absent, or owner.status != "running" (done/aborted/legacy)
  skip-held          # foreign + live owner (fresh effective heartbeat)
  consult            # foreign + running + not held — abandoned-looking

RECORD ConsultOutcome:
  kind: ok | tripped | indeterminate | consult-failed   # consult-failed = spawn error / timeout / unparseable stdout
  payload?: SentryCheckPayload                          # {run_dir, verdicts[], intervention, tripped, ...} as sentry emits it
  reason?: String                                       # for indeterminate / consult-failed
```

**Module exports** (mirrors runcheck's shape so the selftest and tests drive pure cores): `cmdSentrycheck(args)`, the pure gate function `sentrycheckGateDecision(ledger, runDir, env, nowMs) -> GateDecision` (heartbeat already overlaid by the caller), the advisory formatter, the selftest table + runner. `bin/faff` gains the require, the handler-map entry `"sentrycheck": cmdSentrycheck`, and usage lines (both the header comment block and the printed usage).

**Registrar:** `FAFF_STOP_HOOKS` becomes `["runcheck", "prepcheck", "sentrycheck"]`. Nothing else in hooks-ensure changes — `planStopHooks`, identity, normalization, and probe-gating all generalise over the list already. Selftest tables and `test/hooks-ensure.test.mjs` expectations that enumerate the family (e.g. `added` deep-equals `["runcheck","prepcheck","merge-fence"]`, the "2 command hooks" structural case, `served` fixture lists) must be updated to include the third member.

## 4. HOW — Behavior

**Architecture:** a thin `--hook` handler = cheap local reads (ledger + heartbeat file) → pure gate → at most one child spawn of the unmodified sentry CLI → at most one stderr advisory → exit 0. No writes, ever.

**Gate condition.** Weighed: re-deriving a staleness predicate vs reusing the FAFF-205 gate functions wholesale. **Chosen:** consult iff `!runIsOwned(...) && owner.status === "running" && !runIsHeld(...)` — `runIsOwned`/`runIsHeld` imported from `runcheck.js` (same governance region), heartbeat file overlaid first. Owned, held, done/aborted, and legacy no-owner ledgers all fast-path to silent exit 0 with **no sentry spawn** — a per-turn-end child process on every session would be unacceptable hot-path cost, and an owned run is already covered by FAFF-352 checkpoints + the runcheck backstop.

**Staleness threshold.** **Chosen:** whatever `runIsHeld` already reads — `FAFF_RUN_HEARTBEAT_STALE_SECS` over the 900s default via `heartbeatStaleSecs(env)`. No new knob; the gate only decides *whether to consult* — sentry's own configured thresholds then decide the verdict, and the hook treats sentry as authoritative (a consult that comes back `tripped:false` is silent).

**Consult mechanism.** Weighed: direct require of `sentry.js` internals vs child spawn of the CLI. **Chosen:** child spawn — `spawnSync(process.execPath, [ENTRYPOINT, "sentry", "check", "--json", "--run-dir", runDir], { encoding: "utf8", timeout: SENTRYCHECK_CONSULT_TIMEOUT_MS, input: "" })`, mirroring `sentryReadBudget` — ADR-0065: both executors call the identical, unmodified CLI; no detection-math coupling.

**Action on a tripped verdict.** Weighed: (i) hook calls `faff sentry abort` when the run is L4-minted; (ii) advisory-only at every level. **Chosen:** advisory-only, all levels including L4. Rationale: ADR-0065 scopes acting as *mint-scoped* (ADR-0044) — the poller spawned at run-mint is the mint-scoped actor; an arbitrary foreign session's turn-end hook is not. Concretely: the hook cannot know the run's `--worktree`, so an abort from here would skip the WIP-preserving commit and strand in-flight work; and a heartbeat-only liveness misfire (live-but-quiet run) would let an unrelated session mark a live run `aborted-resumable`. The FAFF-235 posture — a non-owner never mutates a foreign run — extends from "never block" to "never write". The advisory names the exact remedy commands so a human (or the owner) acts deliberately. The L4-acting question is thereby **closed for this ticket** as rejected, recorded in §6; the extension point is named in OUT OF SCOPE.

**Anti-pattern:** emitting the Stop-hook stdout block payload (`{"decision":"block",...}`) from this hook under any input. Why: FAFF-235 — a foreign run's state must never make an unrelated session un-exitable; this hook's only output channel is a stderr notice.

**Anti-pattern:** calling `evaluateDerailment`/predicates in-process. Why: consume-never-re-derive; the CLI boundary is the contract ADR-0065 pins for both executors.

```
PROCEDURE cmdSentrycheck(args):
  1. IF --selftest → run the gate table, return its exit
  2. IF NOT --hook → print one usage line to stderr, return 2
  3. root = --root value ELSE findRoot(); runDir = latestRunDir(root)
  4. IF no runDir → return 0                                  # skip-no-run
  5. TRY ledger = readLedger(runDir) CATCH → return 0         # skip-unreadable (D8)
  6. overlayHeartbeat(ledger, readHeartbeatFile(runDir))      # effective heartbeat (FAFF-355)
  7. decision = sentrycheckGateDecision(ledger, runDir, process.env, Date.now())
  8. IF decision != consult → return 0                        # silent, no child spawned
  9. outcome = spawn `faff sentry check --json --run-dir <runDir>` (bounded timeout, stdin pinned "")
 10. IF outcome.kind == consult-failed OR indeterminate:
       stderr one line: "[warn] faff sentrycheck: latest run <id> looks abandoned
         (heartbeat stale) but the sentry consult was <timed out | indeterminate: reason>
         — not an all-clear; inspect: faff sentry check --run-dir <runDir>"
       return 0                                               # fail-closed surfacing (FAFF-425 posture)
 11. IF outcome.payload.tripped == false → return 0           # sentry authoritative
 12. stderr one line (FAFF-235 warn shape): "[warn] faff sentrycheck: latest run <id>
       looks abandoned; sentry tripped <signal list> — intervention: <intervention>.
       Nothing was acted on from this session. Inspect: faff sentry check --run-dir <runDir>;
       abort resumably: faff sentry abort --run-dir <runDir> --worktree <path>"
     return 0
```

**Gate (pure):**

```
FUNCTION sentrycheckGateDecision(ledger, runDir, env, nowMs) -> GateDecision:
  1. IF runIsOwned(ledger, runDir, env)          → skip-owned
  2. IF NOT (ledger.owner AND owner.status == "running") → skip-not-running
  3. IF runIsHeld(ledger, nowMs, env)            → skip-held
  4. ELSE                                        → consult
```

**Timeout / degrade.** **Chosen:** a module constant `SENTRYCHECK_CONSULT_TIMEOUT_MS = 10000`. `sentry check` itself spawns budget + corrective-integrity children and walks transcripts, so it can be slow; a Stop hook must stay bounded. Timeout, spawn error, non-{0,3} exit, or unparseable stdout → `consult-failed` → the step-10 notice (never silent: FAFF-425's "own fault is not all-clear", surfaced non-blockingly). Exit 3 + parseable payload → `indeterminate` with its `reason`.

**Unreadable ledger.** Weighed: FAFF-425 loud-fault vs runcheck `--hook` parity (parse error → silent 0). **Chosen:** silent, runcheck parity — a turn-end hook in an unrelated session is not this run's supervisor of record, and a permanently corrupt old ledger must not nag every session forever. (The consult path's own faults, step 10, stay surfaced — the distinction is "can't even classify" vs "classified abandoned-looking, then failed".)

**Edge cases:**

- Unparseable effective heartbeat + `status:"running"` → not held → **consult** (sentry decides; its wall-clock predicate handles null ages).
- `owner.status` `"done"` / `"aborted-resumable"` → skip-not-running, regardless of timestamps.
- Both runcheck and sentrycheck may warn on the same turn-end (undispatched queue + sentry trip) — two complementary stderr lines, acceptable.
- probeServes probe (`sentrycheck --hook --root <empty tmpdir>`): step 4 exits 0; `input:""` keeps stdin harmless (the hook never reads stdin).
- Hook registered but sentry regressed: any child failure lands in `consult-failed` → notice + exit 0, never a blocked session.

**Failure modes:**

- **Heartbeat-only liveness misfires on a live-but-quiet run** — the approach assumes stale ⇒ abandoned. How you'd know: an advisory names a run the operator knows is live (or FAFF-355 member ticks show life). What it means: harmless by design (advisory-only, D5); if noisy in practice, that is evidence for the dedup extension, not for acting.
- **Advisory fatigue** — a genuinely dead run re-warns every turn-end until cleaned up. How you'd know: repeated identical `[warn]` lines across turns. What it means: consistent with FAFF-235's existing posture; proceed, dedup is a named extension.
- **Consult latency taxes every turn-end near a stale run** — how you'd know: perceptible Stop lag only when the gate fires. What it means: the timeout bounds it; if 10s proves too generous, narrow the constant — never widen the gate.
- **Assist half mistaken for coverage** — solo-overnight runs get zero benefit from this hook. How you'd know: a stuck solo run with no advisory in any session. What it means: by construction; FAFF-470 is the answer, not a tuning of this hook.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the newest run ledger is foreign (no FAFF_RUN_DIR / FAFF_SESSION_ID match),
      owner.status "running", and its effective heartbeat is older than the staleness window
When any session's Stop event runs `faff sentrycheck --hook`
Then exactly one `faff sentry check --json --run-dir <that dir>` child is spawned,
     one stderr [warn] line names the run id, the tripped signal(s), the intervention,
     and the manual `sentry check` / `sentry abort` remedies,
     the exit code is 0, and the run ledger's bytes are unchanged
```

```
Given the newest run ledger is foreign with owner.status "running"
      and an effective heartbeat fresher than the staleness window
When `faff sentrycheck --hook` runs
Then no sentry child is spawned and the hook is silent (no stdout, no stderr), exit 0
```

```
Given the newest run ledger is owned by this session (FAFF_RUN_DIR points at it),
      with any heartbeat age
When `faff sentrycheck --hook` runs
Then no sentry child is spawned and the hook is silent, exit 0
```

- In `--hook` mode the command MUST always exit 0 and MUST never write a `{"decision": ...}` payload to stdout — for every input in the selftest table, including consult failure and indeterminate.

## 6. Design decision rationale

- **Where does the hook live?** `sentry --hook` mode vs reusing the `sentry` token vs a new module. Reusing `sentry` in `FAFF_STOP_HOOKS` registers `faff sentry --hook`, which exits 2 at runtime yet passes `probeServes` (its stderr lacks "unknown subcommand") — a session-blocking registration. **Chosen:** new `sentrycheck` module + subcommand — family-consistent, probe-safe, keeps sentry.js a pure supervisory span.
- **When to consult?** Always-consult per turn-end vs gate-first. Always-consult costs 3 nested node spawns on every turn-end of every session. **Chosen:** consult only on foreign ∧ running ∧ ¬held — the FAFF-205 gate reused verbatim, exactly the abandoned-looking case.
- **Which staleness window?** New knob vs sentry's `stall_window_secs` vs `FAFF_RUN_HEARTBEAT_STALE_SECS`. **Chosen:** `FAFF_RUN_HEARTBEAT_STALE_SECS` via `heartbeatStaleSecs` — the gate is runcheck-family plumbing; sentry applies its own config to the verdict.
- **How to consult?** In-process require vs CLI child. **Chosen:** CLI child spawn — ADR-0065 pins "identical, unmodified `faff sentry check` CLI" for both executors; mirrors `sentryReadBudget`.
- **Act or advise?** L4-scoped `sentry abort` from the hook vs advisory-only. **Chosen:** advisory-only at every level — acting is mint-scoped (ADR-0044/0065) and belongs to the poller; the hook lacks worktree knowledge (would strand WIP), and a non-owner never writes a foreign run's ledger. At the time of writing FAFF-466 (integrity-gate wiring) is unbuilt; revisiting hook-side acting waits on that seam at minimum.
- **CLI surface?** Plain report mode vs hook-minimal. **Chosen:** `--hook`/`--selftest`/`--root` only — `faff sentry check` is already the diagnostic surface.
- **Consult failure handling?** Silent vs notice. **Chosen:** bounded 10s timeout; failure/indeterminate → non-blocking stderr notice — FAFF-425's fail-closed posture, softened to advisory because FAFF-235 outranks it at a foreign session's turn-end.
- **Unreadable newest ledger?** Loud vs silent. **Chosen:** silent, runcheck `--hook` parity — a hook in an unrelated session never nags on a corrupt artifact it cannot classify.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** the `faff sentry check` CLI contract as shipped exists and is stable — `--json` payload `{run_dir, verdicts, intervention, tripped, ...}`, exit 3 + `{indeterminate:true, reason}` on own-fault. Validate: run `faff sentry check --json --run-dir <fixture>` against a stale fixture before building the parser.
- **Assumes:** FAFF-470's poller exists as a separately-shipping peer ticket — this hook is never the sole watchdog. Validate: confirm FAFF-470 is in the same run's queue; if it parked, note it in the PR, do not widen this scope.
- **Assumes:** Claude Code Stop-hook semantics exist as relied on repo-wide — exit 0 + stderr is a non-blocking notice; only a stdout decision payload blocks. Validate: this is the shipped FAFF-235 behaviour in `runcheck.js` (`[warn]` to stderr); mirror it exactly.

## 8. DONE — Definition of done

### From WHAT (registrar + surfaces)
- [ ] `FAFF_STOP_HOOKS` in `hooks-ensure.js` is `["runcheck", "prepcheck", "sentrycheck"]`; no other registrar logic changed
- [ ] `plugin/skills/faff/bin/lib/sentrycheck.js` exists (`region:governance`), exporting `cmdSentrycheck`, the pure `sentrycheckGateDecision`, the selftest table + runner
- [ ] `bin/faff` dispatches `sentrycheck` (require + handler map + both usage-text homes)
- [ ] `faff sentrycheck --hook --root <empty tmpdir>` exits 0 fast (probeServes clears it); the command never reads stdin
- [ ] `faff hooks-ensure` on a fresh root registers `<bin> sentrycheck --hook` as a third Stop entry; a second run is a byte-stable no-op

### From HOW (gate)
- [ ] Owned run (either ownership signal) → silent exit 0, no sentry child spawned
- [ ] Foreign + held (fresh effective heartbeat, incl. heartbeat-file overlay winning over a stale ledger field) → silent exit 0, no child
- [ ] Foreign + `owner.status != "running"` (done / aborted-resumable / legacy no-owner) → silent exit 0, no child
- [ ] Foreign + running + stale honours `FAFF_RUN_HEARTBEAT_STALE_SECS` override and spawns exactly one `faff sentry check --json --run-dir <dir>`
- [ ] Missing run dir / unreadable ledger → silent exit 0

### From HOW (consult + advisory)
- [ ] `tripped:true` → one stderr `[warn]` line naming run id, signal(s), intervention, and both remedy commands; exit 0; run dir bytes unchanged
- [ ] `tripped:false` → silent exit 0
- [ ] Exit-3/indeterminate, spawn failure, timeout, unparseable stdout → one non-blocking stderr notice ("not an all-clear"), exit 0
- [ ] `--hook` mode never exits non-zero and never writes a stdout decision payload; the module contains no call to `sentry abort` and no ledger write

### From tests
- [ ] `faff sentrycheck --selftest` drives the pure gate table (owned / held / stale-running / done / legacy / unparseable-heartbeat / env-override cases) and passes
- [ ] `test/sentrycheck.test.mjs` drives the real entrypoint against `mkdtempSync` fixture roots (runcheck-gate.test.mjs pattern), covering the three visible Scenarios + the consult-failure notice
- [ ] hooks-ensure selftest tables + `test/hooks-ensure.test.mjs` updated for the three-member Stop family (added/already/served/structural-count expectations); `faff hooks-ensure --selftest` and the full `node --test` suite pass

**Integration smoke test:**

```
1. root = mkdtemp; write .faff/runs/R1/run-ledger.json with
   owner {status:"running", last_heartbeat: now-2000s}, admitted:["X"], outcomes:{}
2. run `faff sentrycheck --hook --root <root>` with a clean env (no FAFF_RUN_DIR/FAFF_SESSION_ID)
3. ASSERT exit 0; stderr matches /\[warn\] faff sentrycheck: .*wall-clock-runaway/;
   stdout has no "decision"; run-ledger.json bytes unchanged
4. rewrite last_heartbeat to now-10s; rerun; ASSERT exit 0 and no output
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Deps surfaced (principle 6) — one finding.** The spec's central design call (advisory-only at every level) is justified by FAFF-470 being the mint-scoped actor, and Assumption 2 states this hook "is never the sole watchdog" — yet no tracker link between 471 and 470 is named. If 470 parks, 471 ships an advisory lane with no actor anywhere, silently narrowing the coverage the ADR-0065 composite promised. What to do: add a relates/blocked-by link (or parent both, with FAFF-472, under one ADR-0065 composite container) so ordering pulls 470 first or together.

Otherwise: right-sized (~1 day, pure gate reuse); the deliberate split holds; risk low — no novel mechanics, all consumed CLIs shipped.
