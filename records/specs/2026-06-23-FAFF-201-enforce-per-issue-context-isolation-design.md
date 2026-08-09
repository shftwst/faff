# FAFF-201 — Enforce per-issue context isolation in beep-boop (subagent-per-build)

> Spec: faffter-dark-nlspec · 2026-06-23 · autonomous · confidence: high. Full spec on Linear FAFF-201.

> **Refreshed 2026-06-23 (autonomous, stale-refresh)** — folded the **FAFF-226 spike resolution (GO)** posted on this thread. The spike validated the spec's single load-bearing assumption end-to-end — a build subagent runs `faff-graft` to a terminal token via the Skill tool + Bash, with review completing inside it (Phase 1 inline `pass` + Phase 2 NVIDIA via `review-call.mjs` → `pass`) and **no mid-review stall**. With that risk resolved and the two remaining Open Questions explicitly out-of-scope for the sequential-default deliverable, the rating moves **medium → high**. Changes are in §4 (load-bearing failure mode now annotated *validated*), §7 (the load-bearing Assume marked validated + the 504 flaky-infra caveat carried into the build), §8 (the assumption-validation DONE item ticked-by-spike), and the methodology critique risk-profile line. The design (subagent-per-build) is unchanged — only the risk is now retired.

> **Prior revision 2026-06-23** — corrected the load-bearing assumption after the FAFF-226 spike's first finding: there is **no third-level "review sub-subagent."** `faff-graft` runs the `review` slot via the Skill tool *inline*, and `faffter-dark-adversarial-review` Phase 2 calls an LLM via the `review-call.mjs` Node/Bash helper — neither is an Agent/Task subagent. So FAFF-201 has exactly **one** subagent (the build); the real assumption is the narrower "a subagent can use the Skill tool + Bash and run graft to a terminal token without a mid-review stall."

This spec is for the build agent implementing FAFF-201, and for the human reviewer gating it. It defines how `/faff-beep-boop` stops accreting each build's working set into the orchestrator window — by making per-issue context isolation a **dispatch mechanism** in the `concurrency` slot rather than an unenforced lane *intent*.

## 1. WHY — Problem and Principles

**The load-bearing model.** beep-boop's whole scaling story is: the orchestrator holds *N terminal tokens + one on-disk ledger*, never *N full build contexts*. A build's working set (worktree edits, full adversarial-review output, CI logs, spec bodies) must live in a **throwaway context** that is discarded the moment the build returns its terminal token. Today that throwaway context is the orchestrator's own conversation, because the `Skill` tool runs a sub-skill **inline** — so nothing is thrown away. This spec moves each build into a **subagent** whose context *is* the throwaway, so the orchestrator re-absorbs only `{issue, outcome, pr}`. Note the subagent is a *single* level: inside it, graft runs review via the Skill tool inline and shells `review-call.mjs` via Bash — there is no further nested subagent.

**Problem statement.** Status quo: the `concurrency` slot drives `faff-graft` via the Skill tool inline, so every build's working set accretes into the orchestrator. Pain: a long run bloats the orchestrator until the build pass *appears* to hit a context ceiling and checkpoints — a self-inflicted limit, not a real one (observed 2026-06-21, the FAFF-200 graft run fully in-context). This change makes the concurrency slot dispatch each build as a subagent that returns only a terminal token, keeping the orchestrator window flat across an arbitrarily long queue.

**Design principles.**

- **Deterministic tools over prose.** The isolation guarantee must be a named dispatch mechanism in the slot contract (and conformance-lintable), not a "try to stay lean" exhortation — strengthening prose is the very thing this ticket exists to escape.
- **Single active ledger writer.** The run-ledger has exactly one writer at any instant. Whoever is *active* owns the writes; ownership follows execution, never overlaps. (Honours the existing "write the ledger authoritatively, never load-modify-save by racing writers" rule.)
- **Disk is the coupling, not context.** The orchestrator and the build communicate through on-disk artifacts (`run-ledger.json`, `.faff/runs/<run-id>/ISSUE-XX/*`) and the returned token — never through shared conversation context. This is what makes the build context genuinely disposable.

**Reference context.**

| System | Role | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md:29` | Sequential executor (default `concurrency`) | The inline-dispatch site to change |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md:26-35` | Parallel executor (`concurrency` swap) | Second inline-dispatch site; capped scheduling, collision groups |
| `plugin/skills/faff-beep-boop/SKILL.md` | Orchestrator | Names the isolation requirement; owns ledger + sequencing |
| `plugin/skills/faff/SKILL.md` Agent Lanes | Lane model | Already frames lanes as "structurally isolated contexts"; this spec makes the Implementor's token-only return *mechanically* true (the gateway does **not** yet state token-only return — this spec adds it) |
| `plugin/skills/faff-graft/SKILL.md:277` | graft → `review` via Skill tool (inline) | Confirms the build subagent is single-level — review is not a further subagent |
| FAFF-205 (shipped) ledger `owner` stamp + `FAFF_RUN_DIR`/`FAFF_SESSION_ID` | runcheck session-scope | Heartbeat must stay warm while the build runs in a subagent |
| FAFF-226 (Done — GO) | De-risking spike | **Validated** the one load-bearing assumption end-to-end before this loop is wired (see §4, §7) |
| FAFF-227 (related) | `review-call.mjs` transport-retry | The 504 flaky-infra caveat the spike surfaced — fix at source (see §7) |

**Scope statement.** This sits at the orchestrator→executor boundary of the L3 build pass: it changes *how* a build is dispatched, not what a build does.

## 2. OUT OF SCOPE

- **Fresh-session/process dispatch (mechanism 1).** Excluded — the maintainer chose subagent-per-build; separate-process dispatch needs runner/harness support and overlaps L4 lights-out infra. Extension point: a future `concurrency` executor could spawn `claude -p` per build behind the same slot contract this spec defines.
- **Prep-queue subagent dispatch.** Excluded from *this* ticket to keep it a single shippable concern (build-pass isolation). The prep producer re-loading full spec bodies into the orchestrator on attach is the same bloat class and should get the same treatment — but as an independent unit. Extension point: the prep-queue drain in `faff-beep-boop/SKILL.md` + the prep producer return path. **Punt** recorded for whether it's a fast-follow or folded later (Open Questions).
- **FAFF-87 within-run convergence.** Excluded — orthogonal loop control; it *consumes* this dispatch contract but doesn't change it. Extension point: beep-boop wave re-entry.
- **FAFF-35 run observability.** Excluded — the morning/in-flight surface reads the same on-disk artifacts; no change here. Extension point: `.faff/runs/<run-id>/` consumers.
- **Worktree policy.** Unchanged — one worktree per build is already mandatory (`faff/SKILL.md`). This adds *context* isolation atop the existing *filesystem* isolation.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Build subagent | A subagent (Agent/Task tool) dispatched by the `concurrency` executor that runs one issue's (or one collision-group chain's) `faff-graft` to a terminal state in its own context. Single-level: inside it, review runs via the Skill tool inline + the `review-call.mjs` Bash helper, not a further subagent. |
| Terminal token | The structured value a build subagent returns to the orchestrator — the *only* thing that crosses back. |
| Active writer | The single agent (orchestrator or one build subagent) permitted to write the run-ledger at a given instant. |

**Terminal-token type.** The subagent returns exactly this record; the orchestrator reconciles it into the ledger `outcomes` map. `outcome` reuses the **existing ledger `outcomes` vocabulary** (`faff-beep-boop/SKILL.md` outcomes map) — no new values.

```
RECORD TerminalToken:
  issue:   IssueId                 # e.g. "FAFF-201"; echoes the dispatched issue
  outcome: Outcome                 # ENUM below — the EXISTING 6-value ledger outcome set, unchanged
  pr:      PrRef | null            # PR number/url when one was opened; null for parked/errored/routed-out

ENUM Outcome:
  shipped | pr-open | parked | errored | routed-out | unreached-budget

CONSTRAINT outcome == shipped     => pr != null
CONSTRAINT outcome == pr-open     => pr != null
```

**`claimed-by-peer` is NOT a build-subagent outcome.** It is a *reporting disposition* resolved at queue assembly **before** dispatch (FAFF-82): a peer-claimed issue is never appended to `admitted`, so it never gets an `outcomes` entry and is never dispatched. A build subagent therefore can only ever return one of the six ledger outcomes above. (This keeps `runcheck`'s `admitted − outcomes == ∅` invariant intact.)

**Build-subagent dispatch input.** What the orchestrator passes into each subagent (in its prompt, since subagents do not inherit shell env reliably):

```
RECORD BuildDispatch:
  issues:        List<IssueId>     # one for an independent; the ordered chain for a collision group
  run_id:        RunId             # so the subagent writes the right .faff/runs/<run-id>/ paths
  run_dir:       Path              # absolute .faff/runs/<run-id> (substitutes for FAFF_RUN_DIR)
  session_id:    RunId             # substitutes for FAFF_SESSION_ID (FAFF-205 owner match)
  mode_signal:   "autonomous"      # the existing autonomous-mode signal string
```

**Where the contract lives.** Two layers, both required:

- **Chosen:** The `concurrency`-slot contract is the home of the dispatch mechanism. Both executors — `faffter-noon-concurrency-sequential` (default) and `faffter-dark-concurrency-parallel` — change their per-issue dispatch from "invoke `faff-graft` via the Skill tool inline" to "dispatch `faff-graft` as a build subagent." The slot is already framed as "a mechanism slot," so the mechanism belongs here.
- **Chosen:** beep-boop carries a one-line floor, not the mechanism. `faff-beep-boop/SKILL.md` adds an explicit *"never run a build (or prep producer) inline in the orchestrator; the `concurrency` slot dispatches it as an isolated subagent"* floor — so a swapped-in third-party `concurrency` occupant inherits the requirement even though the default skills implement it. Rationale: the requirement is the orchestrator's invariant; the implementation is the slot's job. The gateway Agent-Lanes **Implementor** paragraph also gains the now-true wording — that it returns *only* a terminal token to the orchestrator — so the lane model and the mechanism agree.

## 4. HOW — Behavior

**Architecture.** The orchestrator's build pass becomes a dispatch-and-reconcile loop. For each unit (an independent issue, or a collision-group serial chain), the executor dispatches a build subagent, blocks awaiting it, then reconciles the returned token into the ledger. The subagent runs `faff-graft` (which itself does worktree add → build → review → merge) entirely in its own context; on return that context is discarded.

```
PROCEDURE build_pass(units, run_id, run_dir, session_id):
  1. FOR each unit in methodology-ordered units:          # sequential default
     a. orchestrator writes run-ledger owner.last_heartbeat = now   # it is the active writer here
     b. dispatch BUILD SUBAGENT with BuildDispatch{ unit.issues, run_id, run_dir, session_id, "autonomous" }
     c. AWAIT subagent  -> token: TerminalToken            # orchestrator blocked; subagent is now active writer
     d. reconcile: read .faff/runs/<run_id>/ISSUE-XX/ from disk; ledger.outcomes[token.issue] = token.outcome
     e. orchestrator resumes as active writer; persist ledger authoritatively (no load-modify-save)
  2. when all units terminal: ledger.owner.status = "done"
```

**What the build subagent does** (it is `faff-graft` in autonomous mode, plus heartbeat duty):

```
PROCEDURE build_subagent(dispatch):
  1. invoke faff-graft (Skill tool) autonomously on dispatch.issues, using dispatch.run_dir for logs
     (graft runs review via the Skill tool inline + the review-call.mjs Bash helper — still one subagent)
  2. PERIODICALLY (issue boundary within a chain, and inside the slow review/merge wait):
        write <run_dir>/run-ledger.json owner.last_heartbeat = now   # subagent is the sole active writer
  3. on terminal state per issue: write <run_dir>/ISSUE-XX/graft.md + per-issue ledger artifacts to disk
  4. RETURN TerminalToken{ issue, outcome, pr }   # for a chain: return the list, one token per member
```

**Heartbeat ownership follows the active writer (the race-free core).** Because the orchestrator **blocks** awaiting the subagent, exactly one of them is active at any instant in sequential mode:

- Between dispatches, the orchestrator is active and refreshes `owner.last_heartbeat`.
- During a dispatched build, the subagent is active and refreshes it (it has `run_dir`).

No concurrent writers → no race → `runcheck` never sees a legitimately-running session as abandoned. This preserves FAFF-205 exactly: the `owner` stamp keeps moving across the whole graft lifecycle.

**Reconcile from disk, not from context.** The orchestrator reads `.faff/runs/<run-id>/ISSUE-XX/` artifacts to verify what the subagent did (per the "verify subagent claims against ground truth" discipline) and writes the `outcomes` map itself. The token is the subagent's *claim*; disk + git are the *truth* the orchestrator reconciles against before persisting.

**Collision groups.**

- **Chosen:** one build subagent per collision-group serial chain (not one per member). The parallel executor already runs a group's members serially within one concurrency slot; keeping the whole chain in one subagent keeps its shared rebase-before-merge context together and still isolates the *group* from the orchestrator. Independents get one subagent each. (Rationale in §6.)

**Edge cases and error handling.**

- **Subagent dies / returns no token.** Treat as the existing "silent return ≠ park" rule: the orchestrator does NOT trust absence; it reconciles PR/CI/worktree/`graft.md` ground truth from disk and either records the real terminal outcome or re-dispatches the remaining step. Terminal (no auto-retry loop) — surfaced for the run.
- **Review errors on a transport fault (the spike's 504 caveat).** When a build subagent's review backend (`review-call.mjs`) fails on a **transport** error — HTTP 5xx / dropped connection, surfacing as the unmapped `exit 1` / `OTHER` the FAFF-226 spike hit (NVIDIA 504) — the orchestrator applies the **flaky-infra re-run posture** (re-dispatch the build), **not** a hard `errored` terminal. Distinguish from a genuine review `fail` (a real verdict): a transport fault left no verdict on disk. The durable source fix is **FAFF-227** (`review-call.mjs` retries the transport error internally); until it lands, the orchestrator's re-run posture is the floor.
- **Token `outcome` disagrees with disk** (e.g. token says `shipped` but no merged PR). Disk/git wins; the orchestrator records the ground-truth outcome and logs the discrepancy. Retryable only if ground truth shows an incomplete-but-resumable state.
- **Compaction mid-build.** The orchestrator resumes from `run-ledger.json`: an `admitted` issue with no `outcomes` entry is re-dispatched as a fresh build subagent (idempotent — graft re-attaches to its existing worktree/branch/PR). Resumability is unchanged because nothing build-specific was ever held in orchestrator context.

**Failure modes — how the approach could be wrong, and how you'd notice.**

- **Subagent can't use the Skill tool / Bash, or graft stalls mid-review — the load-bearing risk · VALIDATED GO by FAFF-226 (2026-06-23).** The build subagent must invoke `faff-graft` via the Skill tool, which runs `review` via the Skill tool inline and shells `review-call.mjs` via Bash. If a subagent can't use those tools, or graft ends its turn with review in flight (the known "slow review stalls graft subagent" failure — Phase-1 done, Phase-2 not, no BUILD RESULT), the build returns no token. **How you'd know:** a build subagent returns no token or an `errored` token with a `graft.md` showing review never completed. **Resolution:** the **FAFF-226 spike ran this end-to-end and returned GO** — a real build subagent invoked `faff-graft` via the Skill tool, review **completed** inside it (Phase 1 inline `pass` + Phase 2 NVIDIA via `review-call.mjs` → `pass`), **no mid-review stall**, and a structured terminal token returned cleanly. The narrow fallback (inline review / mechanism-1 for the review step only) is therefore **not** needed. The *only* residue is the transport-fault re-run posture above (§4 edge cases) + FAFF-227. (Note: there is *no* third-level subagent to fail; review is Skill-tool-inline + a Node helper, per `faff-graft/SKILL.md:277` and `faffter-dark-adversarial-review/SKILL.md:26-32`.)
- **Parallel-mode heartbeat contention.** With N concurrent build subagents, more than one agent is "active," so single-active-writer no longer holds for `owner.last_heartbeat`. **How you'd know:** `runcheck` false-blocks or a stale-heartbeat warning fires during a healthy parallel run. **What it means:** the parallel-mode heartbeat owner is unresolved — see the Punt; the sequential default is unaffected.
- **Isolation not actually achieved.** A subagent that returns verbose prose (not just the token), or an executor that still reads the subagent's transcript, would re-bloat the orchestrator. **How you'd know:** the orchestrator-context assertion in the DONE smoke test fails (build working-set strings present after a build). **What it means:** the return path or executor prose is wrong — fix before merge.

**Anti-pattern:** the orchestrator parsing the subagent's free-text transcript for outcome. Why: that re-imports the build context this whole change exists to keep out — read the disk artifacts + the structured token only.

**Anti-pattern:** the subagent and orchestrator both writing the ledger at the same instant. Why: load-modify-save races corrupt outcomes (a real prior incident). Ownership must follow the single active writer.

## 5. SCENARIOS — main objectives, born verifiable

```
Given a beep-boop run with K admitted independent issues and the sequential concurrency default
When the build pass completes
Then the orchestrator context contains only K terminal tokens + the ledger
  And no build's worktree edits / adversarial-review output / CI logs appear in the orchestrator context
```

```
Given a build is running inside a dispatched build subagent during a slow review/merge wait
When runcheck's Stop hook audits the run
Then owner.last_heartbeat is fresh (refreshed by the active subagent)
  And the run is NOT classified abandoned
```

```
Given a build subagent's review backend fails on a transport fault (HTTP 5xx / dropped connection, exit 1 / OTHER)
When the orchestrator handles the returned state
Then the build is re-dispatched under the flaky-infra re-run posture
  And it is NOT recorded as a hard errored terminal
```

```
Given a build subagent returns outcome=shipped but disk/git shows no merged PR
When the orchestrator reconciles the token
Then the ground-truth (disk/git) outcome is recorded, not the token's claim
  And the discrepancy is logged
```

```
Given the orchestrator is compacted mid-build (an admitted issue with no outcomes entry)
When the run resumes from run-ledger.json
Then that issue is re-dispatched as a fresh build subagent
  And the build re-attaches to its existing worktree/branch/PR (idempotent)
```

Non-functional assertions:

- The `concurrency`-slot contract (both executors) **names subagent dispatch**; no remaining "invoke faff-graft via the Skill tool inline" instruction survives in either executor SKILL.md.
- `faff validate-adapters` passes for both edited executor skills and beep-boop.

## 6. DESIGN DECISION RATIONALE

**Where does the isolation contract live?** Options: (a) beep-boop owns the full mechanism; (b) the `concurrency` slot owns it; (c) both — orchestrator names the invariant, slot implements it. (a) leaks executor detail into the orchestrator and breaks for swapped occupants; (b) lets a third-party `concurrency` occupant silently skip isolation. **Chosen:** (c) — beep-boop carries a one-line "never inline; dispatch as a subagent" floor; both default executors carry the dispatch instruction. Invariant lives with the orchestrator, mechanism with the slot.

**One subagent per member, or per collision-group chain?** Per-member maximises isolation but splits a chain's shared rebase-before-merge context across contexts, forcing re-derivation. **Chosen:** one subagent per chain — the chain is already serial within one slot, and group-level isolation already keeps it out of the orchestrator. Independents remain one-each.

**Heartbeat ownership.** Options: orchestrator-only (can't — it's blocked awaiting), subagent-only (can't cover between-dispatch gaps), or follow-the-active-writer. **Chosen:** active-writer ownership — race-free in sequential mode because exactly one agent runs at a time. (Parallel mode is a Punt.)

**Does prep get the same treatment now?** **Chosen (scope):** no — ship build-pass isolation as one unit; file prep-producer isolation as an independent sibling. Same mechanism, separable concern; bundling them violates right-sizing.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** Parallel-mode (`faffter-dark-concurrency-parallel`) heartbeat ownership when N subagents run concurrently — needs human. The FAFF-205 `owner` stamp is per-run, but parallel mode has no single active writer. Candidate directions: a dedicated orchestrator-side heartbeat thread, a max-of-per-subagent-heartbeats reducer, or a per-subagent liveness file `runcheck` maxes over. **Out-of-scope for this deliverable:** the sequential default is fully specified and unaffected; this gates only enabling subagent dispatch *under the parallel executor*, which is a separate follow-on. Resolve before that follow-on, not before this build.
- **Punt:** Whether prep-producer subagent isolation is a fast-follow this cycle or folded later — needs human. **Out-of-scope for this deliverable:** build-pass isolation does not depend on it (it is a separable sibling, §2/§6).

**Assumptions.**

- **Assumes (VALIDATED 2026-06-23 — FAFF-226 GO):** a dispatched build subagent can use the **Skill tool** (to run `faff-graft`, which runs `review` via the Skill tool inline) and **Bash** (the `review-call.mjs` review backend, git, gh), and graft runs to a terminal token without a mid-review stall. There is **no** third-level subagent (review is Skill-tool-inline + a Node helper — `faff-graft/SKILL.md:277`, `faffter-dark-adversarial-review/SKILL.md:26-32`). This was the load-bearing assumption; the **FAFF-226 spike confirmed it end-to-end** (Skill + Bash work; review completed Phase 1 + Phase 2; no stall; clean terminal token). No NO-GO fallback is needed. **Carry into the build:** the spike hit a transient NVIDIA **HTTP 504 → `review-call.mjs` exit 1** (unmapped `OTHER`) that needed a manual retry — the dispatch loop must apply the flaky-infra re-run posture to a review *transport* fault rather than recording a hard `errored` (see §4 edge cases). Source fix tracked by **FAFF-227** (`review-call.mjs` transport-retry).
- **Assumes:** the Agent/Task tool is available to the orchestrator in beep-boop's run environment (it is, in Claude Code interactive + autonomous). **Validate:** confirm the tool is present before the build pass; if absent, the run cannot isolate and must surface that, not silently fall back to inline.
- **Assumes:** a subagent can write to `<run_dir>` on the shared filesystem (same clone). **Validate:** the subagent writes its first heartbeat and the orchestrator reads it back before the build proper begins.

## 8. DONE — Definition of Done

### From WHY
- [ ] After a sequential build pass over K independent issues, the orchestrator context holds only K terminal tokens + the ledger — no build working-set strings present (smoke test below).
- [ ] A long queue no longer drives the orchestrator into a self-inflicted context-limit checkpoint attributable to accreted build context.

### From WHAT (contract location + types)
- [ ] Both `faffter-noon-concurrency-sequential` and `faffter-dark-concurrency-parallel` dispatch each build as a subagent; neither retains an inline "invoke faff-graft via the Skill tool" build instruction.
- [ ] `faff-beep-boop/SKILL.md` carries the "never run a build/prep inline; the concurrency slot dispatches an isolated subagent" floor.
- [ ] The gateway Agent-Lanes Implementor paragraph states it returns only a terminal token to the orchestrator.
- [ ] The build subagent returns a `TerminalToken{ issue, outcome, pr }` whose `outcome` is one of the existing **six** ledger values; `shipped`/`pr-open` imply `pr != null`; `claimed-by-peer` is never returned (resolved pre-dispatch).

### From HOW (behaviour)
- [ ] The orchestrator reconciles outcomes from on-disk `.faff/runs/<run-id>/ISSUE-XX/` artifacts + git ground truth, not from the subagent transcript.
- [ ] `owner.last_heartbeat` is refreshed by whichever of {orchestrator, active build subagent} is currently executing; it stays fresh through a slow review/merge wait.
- [ ] A collision-group serial chain runs in one subagent; independents run one subagent each.
- [ ] A build subagent whose review failed on a **transport** fault (exit 1 / OTHER — the spike's 504 class) is re-dispatched under the flaky-infra re-run posture, not recorded as a hard `errored`.

### From HOW (edge cases)
- [ ] A subagent that returns no token triggers ground-truth reconciliation (PR/CI/worktree/graft.md), not a blind park.
- [ ] A token outcome contradicting disk/git is overridden by ground truth and logged.
- [ ] Resume-from-ledger re-dispatches an admitted-but-no-outcome issue as a fresh subagent; graft re-attaches idempotently.

### From assumptions
- [x] The load-bearing assumption (graft runs to a terminal token inside one subagent, no mid-review stall) is **validated by FAFF-226 (GO, 2026-06-23)** before the loop is wired — no NO-GO fallback needed; carry the transport-fault re-run posture (FAFF-227) into the build.

### From contract conformance
- [ ] `faff validate-adapters` passes for both executors and beep-boop.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. seed two independent admitted issues (or use a scripted-driver fixture) in a test run-id
  2. run the sequential build pass with subagent dispatch
  3. assert: ledger.outcomes has both issues; each token's outcome is in the enum
  4. assert: orchestrator context does NOT contain known build working-set markers
            (e.g. the adversarial-review banner string / a worktree path) for either issue
  5. assert: owner.last_heartbeat advanced during the run; runcheck --hook does not block
```

## Methodology critique

_(agile-delivery lens · Methodology: faffter-dark-methodology-agile-delivery)_

**right-sized?** (principle 4) — **No issues.** Prep-producer isolation is scoped out as an independent sibling (§2, §6) despite being the same bloat class — the correct call; bundling a second structurally-independent concern would make the ticket ship-when-both-land. Build-pass isolation stands alone as a coherent 1–3 day unit. Mechanism-1, FAFF-87, FAFF-35 are scoped as extension points, not folded in.

**workstream fit?** (principles 1 + 5) — **No issues.** Outcome-named ("orchestrator holds only the ledger"), one cohesive deliverable: the orchestrator window stays flat across an arbitrarily long queue.

**deps surfaced?** (principle 6) — FAFF-205 (the per-run `owner` heartbeat stamp the active-writer design preserves) and FAFF-82 (`claimed-by-peer` resolved pre-dispatch) are shipped → benign. **FAFF-226** (the de-risking spike) is **Done with GO** — the dep is satisfied, not just linked. FAFF-227 (`review-call.mjs` transport-retry) is the source fix for the spike's 504 caveat; carried as a build note, not a blocker.

**risk profile?** (principle 7) — The one load-bearing assumption (graft runs to a terminal token inside one subagent, no mid-review stall) was isolated in the **FAFF-226** spike that gated this build and has now **resolved GO** — the unknown was pulled to the front per principle 7 and is retired. The only residual is a transport-fault re-run posture (cheap, bounded, FAFF-227-tracked). Parallel-mode heartbeat is correctly punted and explicitly out-of-scope for the sequential-default deliverable (sequential default unaffected).

**Net:** right-sized, well-named, cohesive, deps satisfied, the single load-bearing risk **de-risked GO** ahead of the build via FAFF-226 — buildable as the sequential-default deliverable.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "punt" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
