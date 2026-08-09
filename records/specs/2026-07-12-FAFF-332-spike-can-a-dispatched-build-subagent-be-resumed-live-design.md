# FAFF-332 — Spike: can a dispatched build subagent be resumed live (SendMessage) in the autonomous dispatch path?

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-332.

This spec defines a half-day investigation spike. It addresses FAFF-332 and is written for the build agent that will run the probes and for human reviewers deciding whether live-resume ever gets wired. The deliverable is a recorded finding plus a GO/NO-GO recommendation — **no production change ships from this ticket**.

## 1. WHY — Problem and Principles

**Load-bearing model.** When a dispatched build subagent's turn ends mid-review without returning its terminal token, faff's shipped recovery (FAFF-329 review-progress checkpoint + FAFF-402 build-complete checkpoint, both merged) is a **cold re-dispatch**: a *fresh* subagent is launched and re-attaches idempotently to on-disk state (pushed branch, checkpoints), skipping the expensive build and completed review phases. A **live-resume** would instead continue the *same* agent — retaining its in-context review state and never paying the fresh-subagent boot at all. The harness `SendMessage` tool documents exactly that ("continue a previously spawned agent with its context intact"), but it appears nowhere in faff today, and nobody has verified it works in faff's dispatch shape — where the executor is *blocked* on a foreground Agent call awaiting the token. This spike verifies the primitive empirically and prices the marginal win, so the decision to wire it (or declare the checkpoint path terminal) is made on evidence, not tool-doc optimism.

**Problem statement.** The mid-review stall costs a re-dispatch cold-start even after FAFF-329/FAFF-402 made that re-dispatch cheap. Whether a true live-resume is even *possible* in the autonomous dispatch path is unknown — `SendMessage` is unused in faff and its interaction with a blocked dispatcher is undocumented. This spike answers the four open questions on the ticket and records a GO/NO-GO so live-resume is either ticketed as a real optimisation or permanently closed.

**Design principles:**

**Probe ground truth, not documentation.** Every answer must carry empirical evidence (a probe transcript excerpt) or a citation to observed harness behaviour. Tool-description prose alone is a hypothesis, not a finding — the memory note from the FAFF-329 incident records that a SendMessage-resume "wasn't available" when it was actually needed, so docs and reality are already known to diverge here.

**A NO-GO is a full success.** The spike exists to de-risk; recording "the checkpoint path is the terminal answer" with evidence completes the ticket exactly as well as a GO. Do not stretch probes to manufacture a GO.

**No production change.** Probes run against throwaway subagents and scratch worktrees. The spike's PR diff must touch only documentation and `.faff/` logs — never the executors, graft, or the CLI.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | prose | Dispatches one build subagent per unit and **blocks awaiting its terminal token** — the dispatch shape live-resume must compose with |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | prose | Capped concurrent dispatch, same Agent-tool transport and terminal-token return |
| `plugin/skills/faff-graft/SKILL.md` (Steps 3, 8b, 9) | prose | The shipped cheap-recovery baseline: build-complete + review-progress checkpoints, resume-at-review on re-dispatch (FAFF-402 PR #287, FAFF-329 PR #273) |
| Harness `SendMessage` / `Agent` tool schemas | harness | The primitive under test: resume-by-`agentId` for a completed agent; `run_in_background` dispatch variant |

**Scope statement.** This spike sits in the post-v1 hardening workstream as the de-risking step between FAFF-329's shipped checkpoint recovery and any future live-resume optimisation ticket.

## 2. OUT OF SCOPE

- **Wiring live-resume into the executors** — the whole point of the spike is to decide whether that ticket should exist. Extension point: both concurrency executors' dispatch step (where `BuildDispatch` is launched and the terminal token awaited) is where an `agentId` capture + resume branch would land, in a separate build ticket on GO.
- **Changing the FAFF-329 / FAFF-402 checkpoint recovery** — shipped and correct; it is the baseline the spike prices against, not a subject of change. Extension point: none needed.
- **Derailment kill / `TaskStop`** — FAFF-49 owns hard-kill; this spike is about continuation, not termination. Extension point: FAFF-49.
- **Interactive graft stalls** — a human absorbs those; the spike targets only the autonomous (L3/L4) dispatch path, matching the checkpoint mechanisms' own scoping. Extension point: none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Cold re-dispatch | The shipped recovery: a fresh build subagent launched after a stall, re-attaching to on-disk checkpoints + pushed branch |
| Live-resume | Continuing a previously spawned subagent via `SendMessage` so its conversation context (and any in-flight reasoning state) is retained |
| Blocked dispatcher | The concurrency executor mid-Agent-call, awaiting the subagent's terminal token — able to run no tools until the call returns |
| `agentId` | The harness identifier (format `a…-…`) in an Agent spawn result, which `SendMessage` targets to continue a completed agent |
| Terminal token | The `{ issue, outcome, pr }` result a build subagent returns to the executor |

**The finding record.** The spike's committed deliverable has this shape (a markdown doc, not code):

```
RECORD SpikeFinding:
  question_1_context_retention:   answer + evidence   # does SendMessage-resume retain conversation context and leave the worktree intact?
  question_2_blocked_dispatcher:  answer + evidence   # what can/cannot happen while the executor is blocked on the Agent call?
  question_3_executor_composition: answer + evidence  # does it compose with the sequential and/or parallel executor, and where would agentId capture live?
  question_4_marginal_win:        answer + evidence   # what does live-resume save over the shipped checkpoint path, and at what coupling cost?
  recommendation: GO | NO-GO      # justified against the decision rule in HOW
```

**Design decisions:**

**Where does the finding live?** Options: tracker comment only (cheap, but invisible to the repo); gitignored `design/` doc (invisible to reviewers and CI); committed doc in the spike PR. **Chosen:** commit the finding as `records/specs/`-adjacent documentation — a single doc committed in the spike's PR (a doc is not a production change) — **plus** a one-paragraph summary + recommendation as a tracker comment on FAFF-332. The PR gives the finding review + permanence; the comment gives the tracker its decision record.

**Probe transport?** Options: reason from tool documentation alone; simulate the harness; probe live in a real session with the real Agent + SendMessage tools. **Chosen:** live probes with the real tools against throwaway subagents — documentation already disagrees with an observed incident, so only live behaviour counts as evidence.

**Recommendation vocabulary?** Options: free-prose conclusion; closed GO/NO-GO with explicit criteria. **Chosen:** closed `GO | NO-GO` line judged against the explicit decision rule below, so the follow-up action (file a build ticket / close the line of work) is mechanical.

## 4. HOW — Behavior

**Approach.** Four probes map onto the ticket's four open questions. Run them in the order below — question 2 first, because its answer constrains what "live" can even mean, then the empirical continuation probes, then composition + pricing analysis. Record each probe's raw result (transcript excerpt, exit state, file check) as it lands.

**Probe A — the blocked dispatcher (question 2).** Establish what the executor can do mid-dispatch.

**Probe B — post-return continuation, foreground (question 1, the crux).** Dispatch a trivial foreground subagent with `run_in_background: false` that embeds a nonce in its context and creates a scratch worktree, without reporting either back. `SendMessage` the returned `agentId` asking it to recall both. PASS = correct recall; FAIL = no agentId / refused send / wrong recall.

**Probe C — post-return continuation, background (question 1 variant + question 3 input).** Same protocol with `run_in_background: true`.

**Probe D — executor composition + marginal win (questions 3 and 4, analysis over the probe results).**

**Decision rule (the recommendation is mechanical given the probe results):**

- **GO** — all of: continuation works post-return in at least one dispatch variant usable by an executor; context is genuinely retained (nonce recalled); the resumed agent's output can serve as a terminal token; and the estimated saving is material against the checkpoint baseline.
- **NO-GO** — any of: no resume window exists in the autonomous dispatch shape; context is not retained; the resumed output cannot reach the executor as a usable token; or the saving is immaterial next to the coupling cost. Record the checkpoint path as the terminal answer.

**Edge cases and error handling:** `SendMessage` schema unavailable → load via `ToolSearch`; absence is itself the finding (NO-GO). Probe subagent fails for unrelated reasons → retry once with a simpler payload. Ambiguous result → record as GO-blocked-on-composition and recommend NO-GO with the specific blocker named.

## 5. SCENARIOS

```
Given a trivial foreground-dispatched subagent that embedded a nonce in its context
      and created a scratch worktree, and whose Agent call has returned
When the dispatcher sends SendMessage to its agentId asking for the nonce and a
      worktree check
Then the reply recalls the correct nonce and confirms the worktree exists on disk
      — otherwise the live-resume premise fails and the finding records why
```

```
Given the completed probe results
When the finding doc is written
Then it contains answers with evidence for all four open questions and exactly one
      `Recommendation: GO` or `Recommendation: NO-GO` line consistent with the
      decision rule
```

Non-functional assertions:

- The spike's PR diff touches only documentation and `.faff/` artifacts — zero changes under `plugin/`, `bin/`, or any executable path.
- Total effort respects the ticket's half-day timebox; probes are bounded (one retry max per probe).

## 6. DESIGN DECISION RATIONALE

**Where should the finding live?** Tracker-only is invisible to the repo and reviewers; gitignored `design/` is invisible to the PR flow. **Chosen:** a doc committed in the spike PR + a summary comment on FAFF-332.

**Probe live or reason from docs?** The tool description promises context-intact continuation, but the FAFF-329 incident recorded resume as unavailable in practice. **Chosen:** live probes with the real tools.

**Free-prose conclusion or closed verdict?** **Chosen:** closed `GO | NO-GO` against an explicit decision rule.

**Which question gates the others?** The blocked-dispatcher analysis (question 2) is run first because it collapses "live-resume" to "post-return continuation."

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none for the human — the ticket's four open questions are the spike's work items.

**Assumptions:**

- **Assumes:** the `Agent` and `SendMessage` tools are available (as deferred tools) in the build session. Validation: `ToolSearch` for `select:SendMessage` at probe start; absence is itself a NO-GO finding.
- **Assumes:** the FAFF-329 / FAFF-402 checkpoint behaviour is as documented in `faff-graft` SKILL.md Steps 3, 8b and 9. Validation: read those steps before writing the marginal-win comparison; cite them in the finding doc.

## 8. DONE — Definition of Done

### From WHY
- [ ] The finding doc exists, committed in the spike's PR, and states the load-bearing distinction it verified.

### From WHAT
- [ ] The finding doc contains all four `SpikeFinding` fields, each with evidence, plus exactly one `Recommendation:` line.
- [ ] A tracker comment on FAFF-332 carries the summary + recommendation.

### From HOW (probes)
- [ ] Probe A's structural answer is recorded.
- [ ] Probe B ran, results recorded verbatim.
- [ ] Probe C ran, results recorded.
- [ ] Probe D's composition + marginal-win assessment is recorded.

### From HOW (constraints)
- [ ] The PR diff contains no changes under `plugin/`, `bin/`, or any executable path.
- [ ] All probe artifacts are cleaned up.

## Already shipped against this surface

- **FAFF-329** (Done, PR #273) — review-progress checkpoint + cheap resume-at-review on re-dispatch.
- **FAFF-402** (Done, PR #287) — build-complete checkpoint + push-at-build-complete.

## Methodology critique

*(agile-delivery lens, `faffter-dark-methodology-agile-delivery`)*

- **Right-sized?** No issues — a half-day timeboxed spike with a single recorded deliverable.
- **Workstream fit?** No issues — post-v1 hardening, downstream of shipped FAFF-329/402.
- **Deps surfaced?** No issues — both real dependencies already Done and linked.
- **Risk profile?** No issues — this ticket *is* the de-risking spike; a NO-GO is explicitly a valid outcome.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

---

## As-built note (added at graft time, 2026-07-12)

Probes ran live against this session's own harness (Agent + SendMessage), foreground-dispatcher
structural facts were cross-checked against the shipped `faffter-noon-concurrency-sequential` /
`faffter-dark-concurrency-parallel` SKILL.md text, and Probe A / D also draw on this run's own
FAFF-324 incident (a real stall + cold re-dispatch, corroborated by `events.jsonl`). See the
[FAFF-332 spike result](../spikes/2026-07-12-FAFF-332-live-resume.md) for the full finding and
`Recommendation:` line.
