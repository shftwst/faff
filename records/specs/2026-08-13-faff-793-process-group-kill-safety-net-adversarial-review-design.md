# FAFF-793 — Bounded, killable process-group spawner around the adversarial-review invocation

> Spec: faffter-dark-nlspec · 2026-08-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-793.
> build-tier: complex

This spec is for the build agent and human reviewers. It defines a small OS-level safety net that wraps the Phase-2 adversarial-review backend call so a review process that ever slips the self-backgrounding fence cannot orphan a child to init and run unkillable. It mirrors the *process pattern* of `evaluate-call.mjs` (a zero-dependency `.mjs` spawner: pure core, injectable spawn, a deadline, a stable exit family, a `--selftest`), not its wire format.

## 1. WHY — Problem and Principles

**The load-bearing model.** A child launched into its **own process group** stays in that group even after its parent dies and it reparents to init — reparenting changes a process's parent (PPID), never its process-group id (PGID). So if the wrapper launches the review invocation as a group leader (PGID equal to its PID) and holds that PGID, it can later signal the *whole group* with `process.kill(-pgid, SIGKILL)` and reap every descendant — including one that self-backgrounded and reparented to init (PPid 1). That single fact is the entire safety net.

**Problem statement.** The self-backgrounding re-run-loop mechanism is already *prevented* by the FAFF-491 / FAFF-530 three-layer foreground fence plus FAFF-465's fence-matcher extension, but nothing terminates a child that ever slips that fence — e.g. a variable-spliced `node "$REVIEW_CALL"` whose helper token the fence regex never sees. Such an orphaned `review-call.mjs` child, reparented to init, is currently unkillable by the orchestrator (permission denied) — the exact FAFF-465 repro signature. This change converts that residual from "prohibited" to "impossible": a defence-in-depth backstop under the fence, not a replacement for it.

**Design principles.**

- **Transparent to the verdict.** The wrapper is a process-lifecycle net only. It must not change the review verdict or disposition semantics: `review-call.mjs`'s exit code passes through unchanged, so `faffter-dark-adversarial-review`'s existing exit-code→outcome table and the review-progress checkpoint keep working byte-for-byte on the healthy path.
- **The graceful path stays graceful.** `review-call.mjs` already self-terminates on its own `--deadline` (exit 8). The wrapper's hard group-kill must only fire *after* that budget, as a backstop for a process that failed to self-terminate — never pre-empting the healthy deadline-8 path.
- **Backstop, not sandbox.** The net catches a naive self-backgrounded orphan that reparents to init but *retains* the group. A child that deliberately calls `setsid` into its own session escapes any process-group kill — that class is what the FAFF-491/530 fence prevents, and it stays out of this net's remit.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (mjs) | The invocation being wrapped — pure HTTP transport; owns `--timeout`/`--deadline` exit family (0/2/4/5/6/7/8/9/10). |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Shells the Phase-2 call (`node "$REVIEW_CALL" --backends-json …`); the one call site this wrapper is inserted in front of. |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Node (mjs) | The process pattern being mirrored (pure core + injectable spawn + deadline + exit family + `--selftest`). |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node (mjs) | The other spawner of `review-call.mjs` children (spec-review lenses); a future consumer of the shared kill primitive — see OUT OF SCOPE. |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | Node | The codebase's existing `detached:true` spawn precedent (detach-and-forget); this wrapper uses `detached:true` for the opposite purpose — to own and later kill the group. |

**Scope statement.** This sits between the build subagent's Phase-2 shell command and `review-call.mjs`, in the `faffter-dark-adversarial-review` skill; it changes how the review process is *launched and reaped*, nothing about what it does.

## 2. OUT OF SCOPE

- **fan-out.mjs process-grouping** — the spec-review lens spawner also spawns `review-call.mjs` children without a group kill. It is bounded today by `review-call.mjs`'s internal `--deadline`; process-grouping its children is a follow-up that *consumes* the shared primitive this ticket introduces. **Why excluded:** keeps this a single 1–3 day unit against the FAFF-465 Phase-2 repro. **Extension point:** `fan-out.mjs`'s `runOne` swaps its bare `spawn` for the shared spawn+kill primitive.
- **Changing the review deadline budget or its exit semantics** — the `faffter_dark.adversarial.deadline` / exit-8 handling is FAFF-329/FAFF-617 territory. **Why excluded:** the wrapper reuses the existing budget, it does not re-tune it. **Extension point:** `faffter_dark.adversarial.*` config.
- **A hermetic engine cage** — process-group kill is not isolation of the network/filesystem/argv surface. **Why excluded:** that is FAFF-384's evaluator-cage remit, a different subsystem. **Extension point:** `evaluate-call.mjs` cage.
- **Defeating deliberate daemonisation (`setsid` double-fork)** — see WHY's backstop principle. **Why excluded:** prevented upstream by the fence. **Extension point:** the FAFF-491/530 fence matcher.
- **Live-resume of a killed review** — resolved NO-GO by FAFF-332; checkpoint + re-dispatch is the terminal recovery. **Why excluded:** no harness resume primitive exists. **Extension point:** the review-progress checkpoint, unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| process group | A set of processes sharing a PGID; `kill(-pgid, sig)` signals every member regardless of its parent. |
| group leader | The process whose PID equals its PGID; created here by launching the child `detached:true` (Node calls `setsid`). |
| reparent-to-init | When a process's parent exits, the OS reassigns its parent to init (PPid 1); its PGID is unchanged, so a group kill still reaches it. |
| single-shot | The wrapper spawns exactly one target, waits once, reaps once, exits — no restart, no loop. |

**The spawner interface.** A new bundled `.mjs`, `plugin/skills/faffter-dark-adversarial-review/review-spawn.mjs`, invoked in place of the bare `node review-call.mjs …`:

```
review-spawn.mjs --deadline <seconds> [--grace <seconds>] -- <command> [args...]
  --deadline S   total wall-clock budget for the wrapped invocation (the same value the SKILL passes review-call.mjs as --deadline)
  --grace   S    extra margin after --deadline before the hard group-kill (default: a small bounded constant, GRACE_SECONDS)
  --            everything after this is the target argv, run unmodified (typically: node <review-call path> --backends-json … --deadline S …)
```

```
RECORD SpawnOutcome:
  status: ENUM { exited, killed-deadline, killed-abort, spawn-failed }
  innerExit: int | null      # the target's own exit code when status=exited; null when signal-killed
  signal: string | null      # e.g. "SIGKILL" when the group was killed
  wrapperExit: int           # the code review-spawn itself returns (see exit mapping)
```

**Exit family (mirrors review-call.mjs's family; pass-through-biased).**

```
ENUM WrapperExit:
  # On a normal inner exit, review-spawn returns the inner's own code verbatim (0/2/4/5/6/7/8/9/10 — every code review-call can emit).
  DEADLINE       = 8    # the wrapper's hard group-kill fired (inner failed to self-terminate within --deadline + --grace)
  ABORTED        = 130  # SIGINT/SIGTERM to the wrapper → group killed, wrapper exits (standard 128+signal convention)
  USAGE          = 2    # bad wrapper args (no `--`, non-numeric --deadline)
  SPAWN_FAILED   = 1    # the target could not be spawned (ENOENT etc.)
```

**Design decision — reuse vs. extract.** `evaluate-call.mjs` exposes no reusable real process-group spawner (its agentic spawn is injected; its only real spawn is a non-grouped `spawnSync` preflight), so there is nothing to "reuse directly". The choices are: (a) inline the detach+deadline+kill logic in the new wrapper only; (b) put the OS primitive in a shared, injectable, zero-dependency helper the wrapper calls, so `fan-out.mjs` can adopt it later without duplication. **Chosen:** (b) — a shared helper module `killable-spawn.mjs` (pure timeout→kill core + injectable `spawnFn`/`killFn` + `--selftest`) beside `review-call.mjs`, consumed by `review-spawn.mjs` now and available to `fan-out.mjs` later. Rationale: the kill discipline is the load-bearing, testable part; keeping it in one place mirrors how `review-call.mjs` centralises the transport that both call sites reuse verbatim.

**Design decision — where the wrapper is inserted.** The Phase-2 call is a *direct shell* `node review-call.mjs …` in `SKILL.md`, not routed through `fan-out.mjs`. **Chosen:** insert the wrapper at that shell line — the SKILL invokes `node review-spawn.mjs --deadline "$deadline" -- node "$REVIEW_CALL" --backends-json … --deadline "$deadline" …`. `review-call.mjs` keeps its own `--deadline` (graceful exit 8 on the healthy path); the wrapper's `--deadline` + `--grace` is the strictly-later hard backstop. Rationale: one call site, minimal prose change, and the graceful path is untouched.

## 4. HOW — Behavior

**Architecture and approach.** `review-spawn.mjs` launches the target in its own process group, arms a single deadline timer, and reaps the group exactly once — on inner exit (defensive straggler sweep), on deadline (hard kill), or on an abort signal (hard kill). It then returns the mapped exit code. The pure core is the timeout→kill *decision* and the exit mapping; the spawn, the timer, the kill, and the signal handlers are injected so `--selftest` exercises the logic with zero real processes.

```
PROCEDURE run(argv):
  1. Parse argv into { deadlineSec, graceSec=GRACE_SECONDS, target: [cmd, ...args] }.
     a. IF no `--` separator, or target empty, or deadlineSec not a positive number → print usage, return USAGE(2).
  2. child := spawnFn(cmd, args, { detached: true, stdio: "inherit" })   # detached → setsid → child is group leader, pgid === child.pid
     a. On synchronous throw or child 'error' before start → return SPAWN_FAILED(1).
  3. pgid := child.pid            # group leader id; killing -pgid reaps the whole group
  4. settled := false            # single-settle guard (mirrors fan-out.mjs's `settled` discipline)
  5. Arm hard-kill timer at (deadlineSec + graceSec) * 1000:
       IF not settled: settled := true; killGroup(pgid, "SIGKILL"); resolve { status: "killed-deadline" }
  6. Install SIGINT/SIGTERM handlers:
       IF not settled: settled := true; killGroup(pgid, "SIGKILL"); resolve { status: "killed-abort" }
  7. On child 'exit' (code, signal):
       IF not settled: settled := true; clear timer; killGroup(pgid, "SIGKILL"|swallow-ESRCH); resolve { status: "exited", innerExit: code, signal }
  8. Map the resolved outcome → wrapperExit (mapOutcomeExit) and return it.

PROCEDURE killGroup(pgid, signal):
  TRY killFn(-pgid, signal)          # negative pid → whole process group
  CATCH e: IF e.code === "ESRCH" swallow (group already gone) ELSE log-and-swallow   # never throw out of a reaper
```

**Behavior summary.** On the healthy path the child exits (usually 0, or a graceful 8 on its own deadline) well before `deadline + grace`; the wrapper clears its timer, sweeps the group defensively (no-op when already empty), and returns the child's own code. The hard kill only fires when the child is still alive at `deadline + grace` — the pathological wedged / slipped-fence case — where it SIGKILLs the whole group and returns 8.

**Edge cases and error handling.**

- **Deadline mapping.** A wrapper-fired deadline kill returns **8** so `SKILL.md`'s existing exit-8 row (pass + skip, logged loudly, `phase2: skipped-deadline`) dispositions it with no new verdict semantics — the AC's "no change to disposition" requirement. It is distinguished in the wrapper's own stderr log (a hard-kill backstop firing is loud, distinct from `review-call.mjs`'s graceful self-exit 8), so a mis-tuned budget or an actual slipped-fence event is visible in the log even though the disposition is identical.
- **Already-exited group.** After a normal child exit, `killGroup` may hit `ESRCH` (no such group) — swallowed, never surfaced as a fault.
- **Signal ordering.** `exit`, the timer, and an abort signal can race; `settled` guarantees exactly one reap-and-resolve, every later event a no-op (the fan-out.mjs single-settle pattern).
- **stdio.** `stdio: "inherit"` so `review-call.mjs`'s findings on stdout and diagnostics on stderr flow through to the caller unchanged — the wrapper is invisible in the output stream.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the orphan deliberately `setsid`'d into its own session, so `kill(-pgid)` never reaches it. **How you'd know:** after a wrapper deadline kill, a `review-call.mjs`/`node` process with PPid 1 in a *different* session is still running. **What it means:** proceed — out of scope by design (the fence prevents deliberate daemonisation); this net targets the reparent-to-init-but-same-group class only.
- **The failure:** the wrapper's hard kill pre-empts a healthy-but-slow review that would have self-exited 8, changing timing behaviour. **How you'd know:** wrapper deadline kills coincide with reviews that were within budget. **What it means:** `--grace` exists precisely to prevent this — the wrapper deadline is strictly later than `review-call.mjs`'s own; if it still races, widen `GRACE_SECONDS`.

**Anti-pattern:** re-implementing `review-call.mjs`'s deadline/retry logic in the wrapper. Why: the wrapper is a process-lifecycle net, not a transport; the inner keeps its own budget and the wrapper only backstops a failure to honour it.

**Anti-pattern:** killing by the child's PID instead of `-pgid`. Why: that is exactly the reparent-to-init orphan the orchestrator already cannot kill; only the group signal reaches it.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a wrapped review invocation that self-backgrounds a child which reparents to init (PPid 1) but stays in the launched process group
When the wrapper's (deadline + grace) timer fires
Then the whole process group is SIGKILLed and no descendant (including the reparented orphan) survives
```

```
Given a review-call child that exits 0 before the deadline
When it exits
Then the wrapper clears its timer, performs no spurious kill of an already-exited group, and returns exit 0 unchanged
```

```
Given the wrapper receives SIGTERM (an orchestrator/sentry abort)
When the signal is handled
Then the wrapper SIGKILLs the process group and exits 130, leaving no orphan
```

- The wrapper adds no change to review verdict/disposition: every `review-call.mjs` exit code (0/2/4/5/6/7/8/9/10) passes through unchanged on a normal inner exit; only a wrapper-fired hard kill synthesises exit 8.

## 5. Design Decision Rationale

**Standalone wrapper script, or fold the kill into `fan-out.mjs`?** The Phase-2 review call is a direct shell invocation, not a fan-out; folding into fan-out would leave the actual repro path unwrapped. **Chosen:** a standalone `review-spawn.mjs` wrapping the direct call — rationale: it covers the FAFF-465 repro site directly, and the shared `killable-spawn.mjs` primitive still lets fan-out adopt the same discipline later.

**Reuse `evaluate-call.mjs`'s spawner, or build fresh?** `evaluate-call.mjs` has no reusable real process-group spawner (injected agentic spawn; non-grouped preflight `spawnSync`). **Chosen:** build fresh, mirroring its *process pattern* (pure core + injectable spawn + deadline + exit family + `--selftest`) — rationale: there is nothing to import; the ticket's "mirroring evaluate-call.mjs" means the shape, not a shared function.

**Resume-safe checkpoint handoff for the spawner?** **Chosen:** none. Rationale: FAFF-332 (spike, Done) concluded live-resume is NO-GO; checkpoint + idempotent re-dispatch is the terminal recovery, and the wrapper is transparent (exit-code pass-through) so `SKILL.md`'s existing review-progress checkpoint writes bracket the call unchanged.

**What exit code does a wrapper-fired kill return?** Options: a bespoke new code, or reuse 8. A new code forces a change to `SKILL.md`'s outcome table (and risks changing disposition — an AC violation). **Chosen:** reuse 8 (deadline), distinguished only in the wrapper's own log — rationale: identical disposition, zero new verdict semantics.

**Kill signal — SIGTERM-then-SIGKILL, or SIGKILL directly?** The target is a wedged/slipped-fence process that already ignored its own deadline. **Chosen:** SIGKILL the group directly — rationale: a graceful term is pointless for a process that failed to self-terminate, and the single-shot net must be certain; `review-call.mjs`'s own graceful exit already happened (or didn't) before this backstop.

## 6. Open Questions and Assumptions

**Open Questions:** none. The two open questions on the ticket resolve to facts: FAFF-332 (Done, NO-GO) closes the resume-handoff question; the reuse question resolves because `evaluate-call.mjs` exposes nothing to reuse.

**Assumptions.**

- **Assumes:** the host OS is POSIX with process groups and `setsid` semantics (Node `detached:true` → `setsid`; `process.kill(-pgid, …)` signals the group). *Validation:* faff runs on Linux/macOS (the sentry-poller already relies on `detached` spawn); confirm `process.kill(-pgid)` is available on the target platform before build. Windows is not a faff target.
- **Assumes:** `review-call.mjs` retains its own internal `--deadline` (exit 8) as the first-line graceful bound. *Validation:* `grep -n "deadline" review-call.mjs` — present today (FAFF-329/FAFF-617); the wrapper is a strictly-later backstop, not a replacement.

## 7. DONE — Definition of Done

### From WHY
- [ ] A review process that self-backgrounds a child reparenting to init (PPid 1, same group) is terminated single-shot by the wrapper — no surviving orphan (the FAFF-465 repro signature is reaped, not left running).
- [ ] The wrapper composes forward with FAFF-465's deterministic-exhaustion fix by pass-through (no shared state; exit codes unchanged).

### From WHAT (interface + decisions)
- [ ] `review-spawn.mjs` exists in `faffter-dark-adversarial-review/`, invoked as `--deadline S [--grace S] -- <command> [args…]`.
- [ ] The OS process-group primitive lives in a shared, injectable, zero-dependency `killable-spawn.mjs` with a `--selftest`.
- [ ] Bad args (missing `--`, non-numeric `--deadline`) return exit 2; a spawn failure returns exit 1.

### From HOW (behaviour)
- [ ] The target is launched `detached:true` (own process group; pgid === child.pid) with `stdio:"inherit"`.
- [ ] On normal inner exit, the wrapper returns the child's own exit code verbatim (0/2/4/5/6/7/8/9/10 all pass through) and performs no spurious kill of an already-exited group (ESRCH swallowed).
- [ ] On (deadline + grace) elapse, the wrapper `process.kill(-pgid, "SIGKILL")`s the whole group and returns exit 8, logging the hard-kill backstop loudly and distinctly from a graceful exit 8.
- [ ] On SIGINT/SIGTERM, the wrapper kills the group and exits 130.
- [ ] Exactly one reap-and-resolve occurs under any race of exit/timer/signal (single-settle guard).

### From HOW (integration)
- [ ] `faffter-dark-adversarial-review/SKILL.md`'s Phase-2 call routes `node review-call.mjs …` through `review-spawn.mjs` with the same `--deadline`; the exit-code→outcome table and the review-progress checkpoint are unchanged.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the wrapper is deterministic); no grader row required.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Run: node review-spawn.mjs --deadline 2 --grace 1 -- node -e "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"
     # a child that ignores termination and never exits
  2. Assert: the command returns within ~3s with exit 8 (deadline backstop fired)
  3. Assert: no `node -e` process from step 1 survives (ps shows none) — the group was reaped
  4. Run: node review-spawn.mjs --deadline 5 -- node -e "process.exit(7)"
  5. Assert: returns exit 7 immediately (inner code passed through, no kill delay)
```

## Methodology critique

Agile-delivery lens (issue-critique). Autonomous prep writes this; it does not block promotion.

- **Right-sized?** Single 1–3 day unit — one wrapper script (`review-spawn.mjs`), one shared primitive (`killable-spawn.mjs`), one `SKILL.md` prose edit at the single Phase-2 call site, plus `--selftest` and a smoke test. One cohesive concern (the process-group kill net); no independent second concern to split out.
- **Workstream fit?** Sits squarely in the adversarial-review robustness lineage (FAFF-491 / FAFF-530 fence → FAFF-465 residual → this backstop). Cohesive with that outcome even though the ticket carries no explicit project.
- **Deps surfaced?** Correctly framed as *compose, not block*: FAFF-465 (Todo, human-hold) is not a hard blocker because the wrapper is transparent (exit-code pass-through); the fence it backstops (FAFF-491/530) is already Done. No missing blocked-by link.
- **Risk profile?** Low — process groups are standard POSIX and the codebase already ships a `detached:true` spawn (sentry-poller). The one real limitation (a deliberate `setsid` double-fork escapes the group kill) is honestly scoped out and covered upstream by the fence. No de-risking spike warranted.

No blocking methodology objection.

confidence: high
spec-review: approve
