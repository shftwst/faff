---
name: faff-beep-boop
description: "Chew through ready work unattended — overnight or fire-and-forget. Default: full pipeline (tidy → prep queue drain → build queue drain). --ready: build-only pass over Todo issues that already have a spec. Parks anything ambiguous so /faff-wtf can surface it in the morning. Trigger for: 'beep boop' / 'overnight' / 'fire and forget' / 'run the backlog' / 'unattended build'."
---

# Faff — Beep-Boop

Unattended end-to-end runs of the faff suite. Drives the other faff skills in **autonomous mode** — no prompts, no human in the loop, parks anything ambiguous, logs everything to `.faff/runs/…`.

This skill is the orchestrator. It does not reimplement prep, build, or tidy — it invokes the existing faff sub-skills with the autonomous-mode signal set.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for shared rules (ignore cancelled/archived, `.faff/` logging, Planning Skills slots, autonomous-mode contract, park protocol).

Beep-boop uses these Planning Skills slots from `CLAUDE.md` when set:

- `parallel` — for concurrent build execution across independent issues. Unset → sequential.
- `spec`, `plan`, `review`, `ship` — passed through to the sub-skills; beep-boop doesn't use them directly.

## Invocation

Three forms:

| Form | Behaviour |
|---|---|
| `/faff-beep-boop` | **Full pipeline (default).** Tidy → prep queue drain → build queue drain. The whole shebang. |
| `/faff-beep-boop --ready` | **Ready-queue only.** Picks up all Todo issues with a spec. Skips tidy and prep. Just builds. Use when you've already prepped and specifically want a build-only pass. |
| `/faff-beep-boop ISSUE-XX ISSUE-YY …` | **Explicit list.** Skips discovery; operates on the listed issues only. |

All forms run non-interactively. No yes/no gates. The whole point is unattended execution.

## Ready-queue mode (`--ready`)

1. Query the tracker for every Todo issue (per the shared ignore rule — skip cancelled/archived).
2. **Spec-gate every candidate using the shared Spec discovery rule** (see gateway). Check **all three** locations for each Todo issue: tracker comments, tracker description/body, and committed `docs/` in the repo. A hit in **any** of them counts. **Do not short-circuit on the repo check alone** — during the pre-build phase, specs normally live on the tracker (faff-prep writes there; faff-workit moves them into `docs/` only when it starts building). An empty `docs/superpowers/specs/` does **not** mean "no spec"; the tracker is the primary source.
3. **Conflict analysis** (see below) — partition the set of spec-gated issues into independents and collision groups.
4. **Build pass** — invoke `/faff-workit` in autonomous mode per issue. Independents in parallel (via the configured `parallel` skill, if set), collision groups serialised within themselves. Workit pulls the spec from wherever discovery found it and commits it to `docs/` as the first commit on the build branch.
5. Aggregate returns (`shipped` / `pr-open-for-human` / `parked` / `errored`).
6. **Report** (see below).

Ready-queue mode never preps anything. If spec discovery finds nothing across all three sources, the issue is not in the queue (log it so `/faff-wtf` can surface it). Use `--ready` when you've already prepped and specifically want a build-only pass — otherwise prefer the default full pipeline, which also drains the prep queue.

## Full pipeline (default)

Two independent queues, drained in order: **prep queue** first, **build queue** second. The prep queue always runs to completion regardless of whether the build queue ends up non-empty. Overnight prep is valuable on its own.

### 1. Tidy pass

Invoke `/faff-tidy` in autonomous mode. Applies the auto-actions (archive dead weight, reparent obvious orphans, strip dead references, canonicalise overlooked specs, clear stale park labels) and tags stale-spec / superseded-spec issues so the prep queue picks them up in step 2. Logs remaining findings for morning review.

### 2. Prep queue build

Gather every issue that is:
- Not cancelled or archived (shared rule)
- Not explicitly blocked
- In Backlog or similar pre-Todo state
- Lacking a valid spec (no spec, or spec marked stale)
- **Flagged by the tidy pass as a prep candidate** — issues tagged stale-spec (need refresh) or superseded-spec (need fresh spec). These are active issues already in Todo with a spec that's no longer valid; prep's stale-refresh or fresh-spec autonomous paths decide whether they rejoin the build queue or park for human attention.

This is the prep queue.

### 3. Prep queue drain

For each candidate, invoke `/faff-prep` in autonomous mode. Possible returns per `skills/faff-prep/SKILL.md` autonomous section:
- `refreshed` — spec updated, issue stays in Todo (contributes to build queue)
- `promoted` — fresh high-confidence spec, moved to Todo (contributes to build queue)
- `parked` — medium/low confidence or architectural change needed; tracker tagged, log written
- `errored` — treated as parked for reporting

Runs until the prep queue is empty. **Never short-circuits on build-queue state.**

### 4. Build queue assembly

Collect every issue that meets readiness (no open blockers, in Todo) **and has a spec discoverable per the shared Spec discovery rule** (gateway) — tracker comments, tracker description/body, or committed `docs/`. Any hit counts. This includes:
- Issues already in Todo at the start of the run (spec likely on the tracker)
- Issues freshly moved to Todo by the prep queue (spec on the tracker by construction)

Do not require a repo-side spec file at this stage — faff-workit commits the spec to `docs/` only at the start of the build. An absent `docs/superpowers/specs/*-<issue>-*.md` is not grounds for exclusion; the tracker is the pre-build source of truth.

Exclude anything parked during the prep queue (no valid spec or flagged for human attention).

### 5. Conflict analysis

Run once over the build queue. See _Conflict analysis_ below.

### 6. Build pass

Invoke `/faff-workit` in autonomous mode per issue, respecting the partition (parallel where safe, serial within collision groups).

### 7. Loop

Keep building until the build queue is drained or everything remaining is parked. Each build return is aggregated.

### 8. Skip-build short-circuit

If the build queue is empty after assembly (step 4), skip steps 5–7 and proceed directly to reporting. Prep output still counts as a successful run.

## Explicit-list mode

`/faff-beep-boop ISSUE-XX ISSUE-YY …`

For each listed issue:
- Skip if cancelled or archived (log the skip with reason).
- Skip if the issue doesn't exist (log and continue).
- If spec missing → invoke `/faff-prep` autonomous. Apply return per the full mode prep queue logic.
- If spec present → queue for build.

After the list is processed:
- Conflict analysis on the set that reached build-ready.
- Build pass per the shared flow.
- Report.

## Conflict analysis

Before the build pass, partition the ready set into **independents** (safe to build in parallel) and **collision groups** (must be serialised within the group, though parallel with other groups).

**Critical framing:** conflict analysis is the mechanism that handles **in-queue dependencies**. Issue A depending on issue B, where B is in the same run's queue, is a collision group — not a park. "Serialise A behind B" is the answer. Parking A because "B isn't Done yet" when B is literally about to be built in this same run is the failure mode that breaks the pipeline: a chain of 5 issues all parking for "depends on earlier" means nothing ships. The chain is the whole point of overnight automation.

Heuristics — issues are considered likely to collide when any of these hold:

1. Their specs name the same files
2. Their specs name the same module directory (shallow check — top-level directory match)
3. **One issue declares another in-queue issue as a blocker** — serialise the dependent behind the blocker. Both still build in this run.
4. They share a scope tag / label that indicates a shared subsystem (per project conventions in `CLAUDE.md`)

When in doubt, serialise. Parallelism is a speedup, not a correctness requirement — a false-positive collision costs a little time; a false-negative costs merge conflicts and broken builds.

**What conflict analysis does NOT do:** it does not park issues. Everything that reached build-ready (spec present, not cancelled/archived, no external dependency missing from the run's combined queue) gets built — either as an independent or as an element of a serialised group. If you find yourself writing "park SHF-X because SHF-Y is Todo" during conflict analysis, stop: SHF-Y is Todo *in this run's queue*, so the correct action is `[SHF-Y, SHF-X]` as a serialised collision group, not a park.

Output of conflict analysis:

```
{
  "independents": ["ISSUE-A", "ISSUE-B", "ISSUE-C"],
  "groups": [
    ["ISSUE-D", "ISSUE-E"],
    ["ISSUE-F", "ISSUE-G", "ISSUE-H"]
  ]
}
```

Log the partition and the reasoning ("ISSUE-D and ISSUE-E both touch `src/auth/`") to `.faff/runs/<run-id>/conflict-analysis.md`.

## Parallel execution

If `parallel` slot is configured in CLAUDE.md Planning Skills, invoke it to run the independents concurrently (each in its own worktree). Collision groups become sequential sub-tasks within a parallel slot.

If unset, run sequentially across the whole build queue.

## Park protocol and tracker tagging

Beep-boop itself rarely parks — its sub-skills do. But when a sub-skill returns `parked` for an issue, beep-boop ensures:

1. The tracker comment written by the sub-skill is present on the issue.
2. The issue carries the `parked-by-faff` tag (or tracker-equivalent label). If the sub-skill didn't apply it, beep-boop does.
3. The per-issue log directory (`.faff/runs/<run-id>/ISSUE-XX/`) has the `parked` reason written to a top-level `park.md`.

This is what `/faff-wtf` looks for to surface parked issues in the morning.

## Reporting

On run completion, produce:

### 1. `.faff/runs/<run-id>/summary.md`

```markdown
# Beep-Boop Run — YYYY-MM-DD HH:MM:SS
Mode: [ready-queue | full | explicit-list]
Duration: Xh Ym

## Shipped (auto-merged): N
- ISSUE-XX: title (PR #nnn)

## PR open for human review: N
- ISSUE-YY: title (PR #nnn) — reason: CI failing on e2e; AC3 requires visual review

## Parked: N
- ISSUE-ZZ: title — reason: low-confidence fresh-spec (log: ISSUE-ZZ/prep.md)

## Errored: N
- ISSUE-WW: title — MCP timeout during build

## Human follow-ups: N
- ISSUE-XX: delete local branch `feat/issue-xx` (cleanup skipped — shell was inside worktree)
- ISSUE-YY: remove worktree `.worktrees/issue-yy` (cleanup skipped — permission denied)
- ISSUE-ZZ: bump tracker status to Done (MCP returned 5xx during post-merge update)

## Prep queue summary (full mode only)
- Refreshed: N
- Promoted: N
- Parked: N
- Errored: N

## Tidy findings (full mode only)
See logs/YYYY-MM-DD/HHMMSS-tidy.md
```

The **Human follow-ups** section captures post-merge housekeeping that was skipped so the run could continue — branch/worktree cleanup, tracker status bumps, label cleanup, shell return-to-main. See the gateway's Autonomous Mode Contract ("Post-merge housekeeping failures never halt the queue"). These are one-liners the human can clear in a minute the next morning; none of them block shipped work, so none of them justify stopping the pipeline.

### 2. Tracker status update

Post the summary content (or a condensed version) to the tracker as a status update / project comment, so team members see the overnight outcome alongside the issues themselves.

### 3. In-conversation output

Print the summary in the conversation at the end of the run.

## Stopping condition

Queue-drain only. The run ends when:
- The build queue is empty AND (in full mode) the prep queue is empty, OR
- Everything remaining is in a parked/errored state

Time-boxed runs (`--until HH:MM`) and count-capped runs (`--max N`) are **out of scope** for this first cut. May be added later.

## Autonomous-mode signal to sub-skills

When beep-boop invokes any sub-skill (`/faff-tidy`, `/faff-prep`, `/faff-workit`), it prefixes the invocation with an explicit autonomous-mode signal:

> _Running in autonomous mode (invoked by /faff-beep-boop, run <run-id>). Skip all prompts. Park on ambiguity. Log everything to `.faff/runs/<run-id>/`. Return structured result to caller._

Sub-skills honour this per their own `Autonomous Mode` sections.

## Guarantees

- **Never aborts the run on a single failure.** Park that issue, log, continue with the next unit of work.
- **Never auto-splits tickets** or restructures the backlog beyond what tidy's autonomous defaults allow.
- **Never auto-merges without the three-condition gate** (AC verified + CI green + review returned `pass` — see faff-workit Step 10).
- **Never parks work on "scope" or "capacity" grounds.** Every ready-with-spec issue gets attempted. "Too many to do in one session" is explicitly forbidden (see the gateway contract). The run ends when the queue drains or everything remaining is genuinely parked by the three valid categories — not by the orchestrator deciding to do fewer.
- **Never parks chained issues for being chained.** Issue A depending on in-queue issue B is a collision group, not a park pair. If the whole queue is one serialised chain, build it as one serialised chain.
- **Mid-run compaction is a resume, not a park.** If the session compacts during a build, the next turn reads `.faff/runs/<run-id>/` + the PR state and continues where it left off. See the gateway's Autonomous Mode Contract for the full rule on forbidden park reasons.
- **Post-merge housekeeping never halts the queue.** Branch delete, worktree remove, shell return-to-main, tracker bumps, label cleanup — if any of them fails, skip it, log it, accumulate it under _Human follow-ups_ in the run summary, and proceed to the next issue. Never prompt for confirmation. See the gateway's Autonomous Mode Contract for the principle.
- **No Bash approval prompts anywhere in the run.** Every `Bash` call made by beep-boop or any sub-skill it invokes must follow the gateway's **decompose, don't wrap** rule (see `skills/faff/SKILL.md` Autonomous Mode Contract): atomic binary invocations only, no shell expansion or substitution, no wrapper scripts. A single approval prompt anywhere in the pipeline — during workit's build/test/CI commands, during prep's tracker writes, during tidy's cleanup — halts the whole run. The cost of decomposition is always lower than the cost of a halt.
- **Always leaves a complete audit trail** under `.faff/runs/<run-id>/`.
- **Always tags parked issues** so `/faff-wtf` surfaces them next morning.

## Notes

- Beep-boop is best run when you expect to be away (overnight, during meetings, over a weekend). Results are on the tracker and in `.faff/runs/…`.
- For a quick list of what happened, run `/faff-wtf` — it reads the latest run summary and surfaces parked issues automatically.
- If you want to try beep-boop on a known-good narrow set before trusting it with the whole backlog, use explicit-list mode: `/faff-beep-boop ISSUE-12 ISSUE-15 ISSUE-17`.
