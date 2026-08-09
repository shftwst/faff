# FAFF-488 — Reliable per-subagent four-class token capture under build isolation: pin the orchestrator's measurement root + session, keep the single-writer emit

> Spec: faffter-dark-nlspec · 2026-07-13 · interactive · confidence: high. Full spec on Linear FAFF-488.

## 1. WHY — Problem and Principles

`faff budget check` and `faff economics` silently degrade to a flat estimate (`tokens_source:"estimate"`, `tokens = attempts × est_tokens_per_attempt`, `per_issue:[]`, no four-class split) whenever the run's transcripts aren't resolvable — and that is *exactly* the beep-boop autonomous case, where the builds that dominate spend run as isolated Agent-tool subagents in their own worktrees. The four-class breakdown (`input`/`output`/`cache_write`/`cache_read`) and per-issue attribution vanish precisely when subagent grafts are the whole story.

The mechanism is not a missing feature — the emit path is already wired. beep-boop's orchestrator already emits a token-tagged `build`/`issue-outcome` event (`--tokens`) when each graft subagent returns (`faff-beep-boop/SKILL.md:367`), and `faff events append --tokens` already computes a four-class delta since the run's last checkpoint (`events.js:224-279`). The degrade is a **resolution robustness gap** in how the orchestrator *measures*:

- **Root mis-resolution.** The token walk keys the transcript project directory off `cwd` (`transcriptBaseDir(cwd,env)`, `budget.js:301-306` — `~/.claude/projects/<cwd-with-slashes-dashed>`). `findRoot()` is `.git`-*file*-tolerant (`shared-infra.js:19-27`), so from a linked worktree it resolves to the **worktree** dir, encoding the wrong project directory → the orchestrator's own `<sid>.jsonl` isn't there → `sessionOwnedTranscriptFiles` returns `null` → `source:"estimate"` with no fault (`budget.js:399-401`, `430-434`). Agent-thread cwd resets between calls, so this is a live hazard even for a single orchestrator.
- **Session mis-resolution.** The session id comes **only** from `env.CLAUDE_CODE_SESSION_ID` (`budget.js:432,457`; `economics.js:610,737`). There is **no `--session-id` flag anywhere**. A subagent "does not inherit shell env reliably" (the stated reason `BuildDispatch.session_id` is forwarded explicitly — `faffter-noon-concurrency-sequential/SKILL.md:30`), and a headless orchestrator turn that lacks a stable exported `CLAUDE_CODE_SESSION_ID` at the moment it runs `budget check` / `economics` / `events append --tokens` degrades to estimate — and `per_issue` is *additionally* gated on `sid` being set (`economics.js:737`), so it empties even when the four-class total survives.

**Principles (invariants this change must not break):**
- **Counts-only, non-leak.** `data.tokens` is exactly `{input,output,cache_write,cache_read}` non-negative integers, or `null` with `tokens_source:"estimate"` — nothing else (`events.js:101-121`). No prompt/response payload ever crosses.
- **Single-writer on `events.jsonl`.** The orchestrator is the sole writer; build subagents return a token and the orchestrator emits (`faff-beep-boop/SKILL.md:358`, FAFF-408). `seq` is an unlocked line count (`events.js:171`) — a concurrent writer corrupts it.
- **Detect-and-warn, never gate.** FAFF-428 posture: an estimate degrade surfaces in `warnings[]` (`budget.js:680-684`), never a new non-zero exit and never a fabricated count.
- **Explicit path, never inferred.** The precedent is `faff heartbeat "$run_dir"` taking `run_dir` as an explicit arg (`heartbeat.js:170-178`) rather than trusting ambient resolution.
- **Governance→factory import direction.** `economics` may import `budget`, never the reverse.

## 2. OUT OF SCOPE

- **Pricing / cost model.** No change to `price_per_mtok`, map pricing (FAFF-427), or any dollar figure — this is counts plumbing only.
- **Gate / contract semantics.** No new ceiling, no gate on the four-class split, no change to the `faff-contract` shapes or to what causes a non-zero exit.
- **Candidate (a) — subagent writes `events.jsonl` directly.** Rejected (see §6); not built.
- **A second token-attribution census.** No new walk that could diverge from the single `sessionOwnedTranscriptFiles` selection (the FAFF-229 guard-rail). We fix *what the existing walk is pointed at*, not add a parallel one.
- **Cross-project-dir child sweep.** Scanning multiple `~/.claude/projects/<encoded>` bases at once is explicitly deferred pending validation of where isolated-worktree child transcripts land (see §7 Assumes).
- **`--by effort` reconciliation.** The events-sourced effort pivot (`economics.js:519-584`) and its `coverage_pct` are untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Effective measurement env** — the env object handed to the token walk. Today it is hardcoded `process.env`. After this change it is `process.env` overlaid with an explicit session id when the caller supplies one:
> `effectiveEnv = sessionIdFlag ? { ...process.env, CLAUDE_CODE_SESSION_ID: sessionIdFlag } : process.env`

**New flag `--session-id <id>`** on the three token commands (`faff budget check`, `faff economics`, `faff events append --tokens`). Selects which session's transcript is metered by overriding `CLAUDE_CODE_SESSION_ID` in the effective env. Absent ⇒ today's behaviour byte-for-byte (read from ambient env). It is a *selector*, not a payload — non-leak by construction.

**Existing flag `--root <path>`** — already parsed by all three (`budget.js:535`, `economics.js:677`, `events.js:183`). This change makes the orchestrator *always pass it*, and threads its value into the same effective-env transcript resolution.

**Ledger field `budget.measure_root`** (string, orchestrator-written once at run start) — the absolute path of the **main checkout** captured while the orchestrator's cwd is the main repo, before any worktree work. The stable `--root` value every later token call passes, immune to cwd drift. Absent ⇒ callers fall back to `--root` from context or `findRoot()` (today's behaviour); its presence is a robustness upgrade, never a hard dependency.

**`TerminalToken{ issue, outcome, pr }`** — unchanged. No token field is added (the subagent never measures; see §6). The shape stays closed and identical across both concurrency skills and `faff-graft`.

**Interfaces touched:**

| Surface | Change |
|---|---|
| `budget.js` `cmdBudget` (check) | parse `--session-id`; build effective env; pass it to `measureTokensByModelClass` (L581) |
| `economics.js` `cmdEconomics` | parse `--session-id`; build effective env; pass to `measureTokensByModelClass` (L718) **and** to the per-issue block (`attributePerIssueCosts` + `transcriptBaseDir`, L737-738) |
| `events.js` events-append `--tokens` | parse `--session-id`; build effective env; pass to `measureTokensByClass` (L232) |
| `faff-beep-boop/SKILL.md` | capture `budget.measure_root` at run start; pass `--root <measure_root> --session-id <orchestrator session id>` on every `budget check` / `economics` / `events append --tokens` call |
| `faffter-noon-concurrency-sequential/SKILL.md`, `faffter-dark-concurrency-parallel/SKILL.md` | no shape change; reaffirm orchestrator-emits (token capture stays on the orchestrator side) |

## 4. HOW — Behavior

**CLI — thread an explicit session into the existing measurement.**
- Each of the three commands parses an optional `--session-id`. When present, it constructs the effective env (`{...process.env, CLAUDE_CODE_SESSION_ID: <flag>}`) and passes that in place of the bare `process.env` currently handed to the measure functions.
- `--root` already flows to `cwd:` of the measure call; no change to its parsing, only to whether the orchestrator supplies it.
- In `economics`, the *same* effective env feeds the per-issue block so `attributePerIssueCosts(transcriptBaseDir(root, effectiveEnv), sid, …)` uses the pinned root+session — restoring `per_issue` on the same runs the four-class total is restored.
- **No behaviour change when neither flag is passed.** Ambient `process.env` + `findRoot()` remains the default, so every existing call site and test is byte-identical.
- **Degrade path is unchanged.** If the pinned root+session still yields no `<sid>.jsonl` (a genuinely transcript-less run), `sessionOwnedTranscriptFiles` returns `null`, the command emits `source:"estimate"` with `tokens:null`, advances nothing, and the FAFF-428 warning fires. Estimate stays the *honest* answer when there is truly nothing to meter — we never fabricate a count.

**Orchestrator (beep-boop) — pin root + session at every token call.**
- At run start (cwd = main checkout, before worktree work), capture the main-checkout absolute path and write it to `budget.measure_root` alongside `tokens_at_start` (`faff-beep-boop/SKILL.md:337`).
- On every measurement — the run-start `budget check` baseline, each per-return `events append --tokens` for `issue-outcome`, `budget-checkpoint`/`run-end`, and any `economics` render — pass `--root "$measure_root" --session-id "$SESSION_ID"`, where `$SESSION_ID` is the orchestrator's own session id (the same value already stamped into every `BuildDispatch.session_id`).
- Per-subagent four-class spend is thereby captured exactly as designed: each `issue-outcome` delta since the last checkpoint ≈ that subagent's build spend, now on the transcript path instead of a null estimate. **No new emit, no new writer** — the existing single-writer `issue-outcome --tokens` emission simply resolves correctly.

**Concurrency skills — unchanged emit topology.** Build subagents continue to return only `TerminalToken{issue,outcome,pr}`; the orchestrator continues to be the sole `events.jsonl` writer. Subagents never measure (their worktree cwd would mis-resolve the root and their in-subagent measure would return the whole-run cumulative, not their own delta) and never write events (unlocked `seq` race).

## 5. SCENARIOS — born-verifiable main objectives

**S1 — cwd ≠ root no longer degrades (the key missing fixture).**
```
Given an orchestrator session <sid> whose <sid>.jsonl transcript lives under the MAIN checkout's project dir
  And the process cwd is a linked worktree (findRoot() would resolve to the worktree)
When `faff budget check --root <main-checkout> --session-id <sid>` runs
Then spent.tokens_source == "transcript"
  And spent.tokens is a four-class object with non-negative integers (not null)
  And no "estimate / may under-report" warning is emitted
```

**S2 — economics restores per-issue on the pinned path.**
```
Given the S1 setup plus an owned agent-*.jsonl child carrying sessionId == <sid> and a sibling .meta.json naming ISSUE-XX
When `faff economics --root <main-checkout> --session-id <sid>` runs
Then tokens_source == "transcript"
  And per_issue is non-empty and includes an entry keyed to ISSUE-XX
```

**S3 — honest estimate still degrades cleanly.**
```
Given a run whose <sid>.jsonl transcript does not exist under the pinned root (genuinely transcript-less)
When `faff budget check --root <main-checkout> --session-id <sid>` runs
Then spent.tokens_source == "estimate" with spent.tokens == null-equivalent flat figure
  And the FAFF-428 estimate warning is present in warnings[]
  And the exit code is unchanged (no new non-zero exit)
```

**S4 — no flags ⇒ byte-for-byte today.**
```
Given no --session-id flag and no --root flag
When `faff budget check` / `faff economics` / `faff events append --tokens` run
Then resolution uses ambient process.env + findRoot() exactly as before this change
  And every pre-existing test's output is unchanged
```

**S5 — counts-only non-leak preserved.**
```
Given `faff events append --tokens --root <r> --session-id <sid>` on the transcript path
When the event is validated by `faff events validate`
Then data.tokens is exactly {input,output,cache_write,cache_read} non-negative integers
  And no extra field, no session id, and no prompt/response text appears in the event
```

**S6 — single-writer invariant intact.**
```
Given a parallel concurrency run at concurrency_max > 1
When each build subagent returns a TerminalToken and the orchestrator emits issue-outcome --tokens for it
Then every events.jsonl line was written by the orchestrator process only
  And no subagent wrote events.jsonl
  And seq is a gap-free ascending line count
```

## 6. DESIGN DECISION RATIONALE

**Chosen: Candidate (b) — orchestrator emits per-subagent tokens; harden its measurement — over Candidate (a) — subagent writes the event itself.** Rationale: (b) keeps the single-writer invariant (orchestrator is the sole `events.jsonl` writer, as FAFF-408 already prescribes), sidesteps the unlocked-`seq` race that ≤`concurrency_max` parallel subagents would create, and measures from the orchestrator's own reliable env/cwd. (a) would force real concurrency safety onto `seq`, would have each subagent mis-resolve `findRoot()` to its worktree, and would have a subagent's own measure return the *whole-run cumulative* (orchestrator + all owned children), not its own delta — three hazards for zero benefit, since the orchestrator is already positioned to emit `issue-outcome` the instant a subagent returns.

**Chosen: Add `--session-id` to `budget check` / `economics` / `events append`, threaded into the effective measurement env.** Rationale: the session id today comes *only* from ambient `CLAUDE_CODE_SESSION_ID`, and a headless/detached orchestrator turn can lack it at the moment it measures — the exact "does not inherit shell env reliably" problem `BuildDispatch.session_id` was created to solve. An explicit selector makes the transcript choice deterministic, matches the `heartbeat "$run_dir"` "explicit, never inferred" precedent, and — because it *selects* a transcript rather than carrying any payload — is non-leak by construction. It also re-enables `per_issue` (gated on `sid`) on the same runs.

**Chosen: Make the orchestrator always pass `--root <main-checkout>`, capturing it once at run start as `budget.measure_root`.** Rationale: `--root` already exists on all three commands; the only gap is that beep-boop relies on default `findRoot()`, which is `.git`-file-tolerant and resolves to a worktree under cwd drift. Capturing the main-checkout path at run start (when cwd is unambiguously main) and passing it explicitly thereafter removes the resolution from the mercy of whatever cwd the process happens to hold — the same robustness `heartbeat` gets from an explicit `run_dir`.

**Chosen: Preserve the FAFF-428 detect-and-warn posture — estimate stays the honest fallback.** Rationale: when a run is *genuinely* transcript-less, estimate is correct; the fix targets only the case where a transcript *exists* but the wrong root/session was resolved. No new non-zero exit, no fabricated count, warning-only degrade — the counts channel never lies.

**Chosen: No changes to `TerminalToken` or the concurrency dispatch shapes.** Rationale: the shape is closed and duplicated across both concurrency skills and `faff-graft`; adding token fields would spread a measurement responsibility onto the subagent (which cannot measure its own delta reliably) and churn three files for nothing. Capture stays on the orchestrator via the existing emit.

**Chosen: Effective-env overlay lives in each command handler, not in the shared measure functions.** Rationale: keeps the change additive and the governance→factory import direction clean (no new cross-module import; `economics` still only imports `budget`). The measure functions keep their `env`-parameter contract; callers just supply a better env.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes: an isolated-worktree build subagent's `agent-*.jsonl` child transcript lands under the *orchestrator-session* project dir** (`transcriptBaseDir(main-checkout)`), so a single-base sweep from the pinned `measure_root` still finds every owned child via `childOwningSession == sid`. *How to validate:* the S1/S2 worktree-cwd fixture asserts an owned child is swept; additionally — and load-bearingly — the integration smoke must run against a **real isolated dispatch** and confirm which `~/.claude/projects/<encoded>` directory the subagent `agent-*.jsonl` files actually appear in (a hand-placed fixture that satisfies S1 would give a false green while a real run still degrades). **If false** (children land under the *worktree*'s encoded project dir), the pinned-root single-base sweep under-counts, and a follow-up is required to sweep the union of `{measure_root, each worktree root}` bases — deliberately out of scope here until the landing location is confirmed, because building a multi-base sweep speculatively risks re-introducing the FAFF-229 over-count guard-rail.

**Punt: is there a legitimate fully-headless orchestrator run (cron / RemoteTrigger) with *no* Claude session transcript at all?** *Decides:* whether estimate is ever the correct-by-design terminal answer for a run (in which case this change must not try to eliminate it) versus always a resolution defect. Current position treats a transcript-less run as honestly-estimated (S3) and does not fabricate counts; a human should confirm no headless launch path is expected to *always* be transcript-less before anyone tries to make estimate impossible.

**Assumes: the orchestrator holds its own session id at run start** (the same value it stamps into every `BuildDispatch.session_id`) and can pass it as `--session-id`. *How to validate:* confirm `CLAUDE_CODE_SESSION_ID` is populated at the run-start baseline call in an autonomous beep-boop run; if it is genuinely absent even at run start, there is no transcript to meter and S3 (honest estimate) is the correct outcome — not a bug this change can fix.

## 8. DONE — Definition of Done

### §3/§4 — CLI surface
- [ ] `faff budget check` accepts `--session-id <id>`; when present, builds the effective env and passes it to `measureTokensByModelClass` (replacing the bare `process.env` at `budget.js:581`).
- [ ] `faff economics` accepts `--session-id <id>`; the same effective env feeds both `measureTokensByModelClass` (L718) and the per-issue block (`attributePerIssueCosts` + `transcriptBaseDir`, L737-738).
- [ ] `faff events append --tokens` accepts `--session-id <id>`; effective env feeds `measureTokensByClass` (L232).
- [ ] `--session-id` overlays `CLAUDE_CODE_SESSION_ID` onto `process.env` only for the measurement; it is never written into any event `data` (non-leak).
- [ ] Absent both `--session-id` and `--root`, all three commands are byte-for-byte identical to pre-change behaviour.
- [ ] Import direction preserved: no new import of `economics` from `budget`; effective-env construction lives in the command handlers.

### §4 — Orchestrator (beep-boop)
- [ ] Run-start step captures the main-checkout absolute path into `budget.measure_root` alongside `tokens_at_start`.
- [ ] Every `budget check` / `economics` / `events append --tokens` call in the orchestrator passes `--root "$measure_root" --session-id "$SESSION_ID"`.
- [ ] Both concurrency skills reaffirm orchestrator-only emission; `TerminalToken` shape unchanged; subagents never measure or write `events.jsonl`.

### §5 — Scenarios (tests)
- [ ] S1 fixture: transcript under main-checkout project dir, process cwd = a linked worktree; `--root/--session-id` yields `tokens_source:"transcript"` with a four-class object and no estimate warning. *(the key missing coverage)*
- [ ] S2: per-issue attribution non-empty on the pinned path with an owned child + `.meta.json`.
- [ ] S3: genuinely transcript-less run still degrades to estimate with the FAFF-428 warning and unchanged exit code.
- [ ] S4: no-flags path is byte-for-byte unchanged (existing suite green).
- [ ] S5: `faff events validate` confirms `data.tokens` is exactly the four classes, no session id / payload leak.
- [ ] S6: parallel run — every `events.jsonl` line written by the orchestrator only; `seq` gap-free.

### Integration smoke test
- [ ] From a linked-worktree cwd, run the sequence a real orchestrator makes — run-start `budget check` baseline (writes `measure_root`), a token-tagged `issue-outcome` append for a simulated subagent return, then `faff economics` — all with `--root "$measure_root" --session-id "$sid"`, and assert the final `economics` output shows `tokens_source:"transcript"`, a populated four-class total, and non-empty `per_issue` — i.e. the FAFF-488 degrade does not reproduce. **Discharge the §7 transcript-location Assumes here against a real isolated dispatch, not a synthetic fixture.**

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "punt" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **right-sized?** — Yes. One cohesive observability concern (restore four-class + per_issue capture under subagent isolation), ~1–2 days. Not splittable into independently-shippable halves: the `--session-id` flag ships nothing on its own, and the orchestrator pinning needs the flag — they always ship together, so this is correctly one unit. No always-ships-together sibling to fold in.
- **workstream fit?** — No issues. Project-less Backlog, outcome-named title, `faff-jot-intake` — the agile default for new hardening.
- **deps surfaced?** — No issues. The relates-to FAFF-408/410/409/201 are all *relates*, not blockers: FAFF-408's four-class tagging and FAFF-410's `--by class` are already in the code (verified), so nothing this issue needs is unbuilt; FAFF-201 is the *cause* of the bug, not a blocker on the fix.
- **risk profile?** — The one non-trivial axis. The fix rests on a linchpin: isolated child `agent-*.jsonl` land under the **orchestrator-session** project dir (so a root+session-pinned single-base sweep finds them). The spec correctly flags this as an `Assumes` and requires it be closed by the integration smoke against a **real** isolated dispatch — a synthetic S1 fixture alone would give a false green. Guarded in-build validation rather than a separate spike; acceptable provided the smoke is the vehicle that closes it.

*Prepped interactively via /faff-prep 2026-07-13. confidence: high · spec-review: approve. One non-blocking Punt (headless-no-transcript) + two Assumes (child-transcript location — the load-bearing one; orchestrator session-id at run start).*
