---
name: faff-beep-boop
description: "Chew through ready work unattended — overnight or fire-and-forget. Default: drain the Todo queue (all ready-with-spec issues). --full: also run tidy/prep autonomously. Parks anything ambiguous so /faff-wtf can surface it in the morning. Trigger for: 'beep boop' / 'overnight' / 'fire and forget' / 'run the backlog' / 'unattended build'."
---

# Faff — Beep-Boop

Unattended end-to-end runs of the faff suite. Drives the other faff skills in **autonomous mode** — no prompts, no human in the loop, parks anything ambiguous, logs everything to `.faff/runs/…`.

This skill is the orchestrator. It does not reimplement prep, build, or tidy — it invokes the existing faff sub-skills with the autonomous-mode signal set.

## Chat naming

**On invocation (always, regardless of mode):** set the chat name via `/rename beep-boop` before anything else.

**Per-issue update (sequential runs):** immediately before invoking `/faff-workit` or `/faff-prep` for an issue, update the name via `/rename beep-boop: ISSUE-XX` so the chat list reflects the current unit of work. When the issue finishes (any return value — shipped, pr-open-for-human, parked, errored), rename back to plain `/rename beep-boop` before moving to the next issue.

**Parallel runs** (via the `parallel` Planning Skill slot): the main chat is coordinating N concurrent worktrees, not working on a single issue. Keep the name as `/rename beep-boop` for the whole parallel batch. Each worktree's own chat (if the parallel skill spawns visible chats) handles its own per-issue rename.

This takes precedence over any per-issue rename in sub-skills. Beep-boop owns the chat name for the full run — the autonomous-mode guard in `/faff-prep`, `/faff-workit`, `/faff-tidy`, and `/faff-wtf` means those sub-skills skip their own rename step when invoked under beep-boop.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for shared rules (ignore cancelled/archived, `.faff/` logging, Planning Skills slots, autonomous-mode contract, park protocol).

Beep-boop uses these Planning Skills slots from `CLAUDE.md` when set:

- `parallel` — for concurrent build execution across independent issues. Unset → sequential.
- `spec`, `plan`, `review`, `ship` — passed through to the sub-skills; beep-boop doesn't use them directly.

## Invocation

Three forms:

| Form | Behaviour |
|---|---|
| `/faff-beep-boop` | **Ready-queue mode** (default). Picks up all Todo issues with a spec. Skips tidy and prep. Just builds. |
| `/faff-beep-boop --full` | **Full pipeline.** Tidy → prep queue drain → build queue drain. |
| `/faff-beep-boop ISSUE-XX ISSUE-YY …` | **Explicit list.** Skips discovery; operates on the listed issues only. |

All forms run non-interactively. No yes/no gates. The whole point is unattended execution.

## Ready-queue mode (default)

1. Query the tracker for every Todo issue that has a spec attached (per the shared ignore rule — skip cancelled/archived).
2. **Conflict analysis** (see below) — partition the set into independents and collision groups.
3. **Build pass** — invoke `/faff-workit` in autonomous mode per issue. Independents in parallel (via the configured `parallel` skill, if set), collision groups serialised within themselves.
4. Aggregate returns (`shipped` / `pr-open-for-human` / `parked` / `errored`).
5. **Report** (see below).

Ready-queue mode never preps anything. If an issue lacks a spec, it's not in the queue.

## Full mode (`--full`)

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

Collect every issue that now has a valid spec AND meets readiness (no open blockers, in Todo). This includes:
- Issues already in Todo at the start of the run
- Issues freshly moved to Todo by the prep queue

Exclude anything parked during the prep queue (it has no valid spec or is flagged for human attention).

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

Heuristics — issues are considered likely to collide when any of these hold:

1. Their specs name the same files
2. Their specs name the same module directory (shallow check — top-level directory match)
3. One issue declares another in-flight issue as a blocker
4. They share a scope tag / label that indicates a shared subsystem (per project conventions in `CLAUDE.md`)

When in doubt, serialise. Parallelism is a speedup, not a correctness requirement — a false-positive collision costs a little time; a false-negative costs merge conflicts and broken builds.

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

## Prep queue summary (full mode only)
- Refreshed: N
- Promoted: N
- Parked: N
- Errored: N

## Tidy findings (full mode only)
See logs/YYYY-MM-DD/HHMMSS-tidy.md
```

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
- **Mid-run compaction is a resume, not a park.** If the session compacts during a build, the next turn reads `.faff/runs/<run-id>/` + the PR state and continues where it left off. See the gateway's Autonomous Mode Contract for the full rule on forbidden park reasons.
- **Always leaves a complete audit trail** under `.faff/runs/<run-id>/`.
- **Always tags parked issues** so `/faff-wtf` surfaces them next morning.

## Notes

- Beep-boop is best run when you expect to be away (overnight, during meetings, over a weekend). Results are on the tracker and in `.faff/runs/…`.
- For a quick list of what happened, run `/faff-wtf` — it reads the latest run summary and surfaces parked issues automatically.
- If you want to try beep-boop on a known-good narrow set before trusting it with the whole backlog, use explicit-list mode: `/faff-beep-boop ISSUE-12 ISSUE-15 ISSUE-17`.
