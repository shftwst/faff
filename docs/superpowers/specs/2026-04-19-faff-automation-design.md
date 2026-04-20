# Faff Automation — Design Spec

**Date:** 2026-04-19
**Status:** Approved, ready for implementation plan

## Goal

Make faff skills chain fluently with user-confirmed gates, and add a new
`/faff-beep-boop` skill that runs the whole suite unattended (overnight) on
safe, already-specced tickets — respec-ing only when confident.

## Design Decisions

### D1. Orchestrator-wrapper architecture

`/faff-beep-boop` is a thin orchestrator. It invokes the existing faff
skills (`faff-tidy`, `faff-wtf`, `faff-prep`, `faff-workit`) in sequence.
Each skill learns a small "autonomous mode" branch: when the mode flag is
set, interactive prompts are replaced with deterministic safe-default
decisions. Skill logic stays canonical — beep-boop drives it.

Rejected alternatives: policy-doc file (adds config ceremony for no gain);
self-contained reimplementation (forks workit's build logic — drift risk).

### D2. Chaining pattern (interactive mode)

Every existing "you should run `/faff-*` next" instruction in any faff
skill is replaced with a yes/no gate (or a short-choice prompt where there
is a real branch, e.g. Build / Review / Reprep). On confirm, the next
skill is invoked via the `Skill` tool in the same conversation.

This is a hard rule across all faff skills. Passive "suggest the user
runs…" language is not allowed.

### D3. Autonomous-mode contract

Shared rulebook every faff skill obeys when beep-boop drives it:

- Never prompt. Every gate has a pre-defined autonomous default.
- Write every decision, input, and output to `.faff/logs/…` with enough
  context to resume.
- On unexpected state (missing MCP, failed query, dirty worktree) →
  **park + log + continue** to the next unit of work. Never abort the whole
  run on a single issue.
- Log entries always record: what was expected, what was observed, what
  decision was taken, and why.

Per-skill autonomous defaults:

| Skill | Autonomous behaviour |
|---|---|
| faff-tidy | Auto-archive merged/cancelled. Auto-reparent obvious orphans (e.g. a sub-issue whose parent is Done/Cancelled moves to the grandparent, or loses its parent link). Everything else (dupes, vagueness, splits, aging, stale, etc.) → log for morning review. Never auto-split, auto-merge tickets, or delete. |
| faff-wtf | Return the ready-queue as a list. No focus recommendation, no "do this" prose. |
| faff-prep | Two auto-spec paths: (a) **stale-refresh** — refresh an existing spec if its original design decisions still hold against the current codebase (blockers shipped, minor drift, no architectural invalidation); (b) **fresh-spec** — produce a new spec only when the configured spec skill self-rates **high** confidence. Medium/low self-rating, or ambiguity in refresh → park. Self-rating is produced by the spec skill in a standard form the faff-prep prompt requests; when no spec skill is configured, the faff-prep inline spec path always parks (no self-rating available). |
| faff-workit | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park (WIP commit + draft PR + tracker note). Post-build → review → ship decision. |

### D4. Cancelled/archived ignored universally

All faff skills ignore cancelled issues, archived issues, cancelled
projects, and archived projects at every query point. They are invisible
to every recommendation, count, and queue. This is a shared rule enforced
at the gateway level (`faff` SKILL.md) that every sub-skill inherits.

### D5. `.faff/` logging directory

Every skill invocation writes a structured markdown log. Layout:

```
.faff/
  logs/
    YYYY-MM-DD/
      HHMMSS-<skill>[-<context>].md     # one file per skill invocation
  runs/
    YYYY-MM-DD-beep-boop-HH-MM-SS/      # grouped per beep-boop run
      summary.md
      ISSUE-XX/
        prep.md
        workit.md
        ac-verification.md
      ...
```

Each log captures:
- Invocation context (args, mode, working directory)
- MCP calls made (tool name, relevant inputs, key outputs)
- Decisions with reasoning (e.g. "refreshed spec because blocker ISSUE-60
  shipped and paths in files X,Y unchanged")
- Commit SHAs, PR URLs
- Errors, parks, and their causes

Logs are plain markdown (agent-readable and human-readable). `.faff/` is
added to `.gitignore` on first write; user may un-ignore to commit.

A log contents must be sufficient that a follow-up agent, given the log
file, can pick up intelligently without needing the original conversation.

### D6. Configurable skill slots (no hardcoded names)

No faff skill references `superpowers:*` or `gstack:*` or any other
external skill directly. Integration happens through the existing
`Planning Skills` section of `CLAUDE.md`, extended:

```markdown
## Planning Skills
- spec: superpowers:brainstorming       # existing
- plan: superpowers:writing-plans       # used inside workit, optional
- parallel: superpowers:dispatching-parallel-agents   # beep-boop concurrency, optional
- review: gstack:review                 # pre-PR review, optional
- ship: gstack:land-and-deploy          # merge/deploy mechanism, optional
```

Every slot is optional with a faff default:

| Slot | Default if not configured |
|---|---|
| spec | Inline spec produced by faff-prep (current behaviour) |
| plan | faff-workit builds directly from the spec |
| parallel | beep-boop runs sequentially |
| review | faff's built-in lightweight review: diff read, AC-to-test coverage check, obvious-bug scan |
| ship | Vanilla `gh pr merge` after faff's merge-confidence check passes |

`review` and `ship` are **not** user-invokable slash commands — they are
internal phases of faff-workit, with optional skill delegation.

### D7. AC verification (faff-workit)

Applies in all modes (interactive and autonomous). Before a PR is
considered done:

1. Ensure every AC in the spec has an automated test
2. Run the tests — all must pass
3. For ACs that require live exercise (HTTP endpoint shape, CLI
   behaviour, filesystem side-effect), run the actual command
   (curl/bash/etc) and capture the result
4. PR description includes a checklist of the ACs. Tick each as its
   verification passes, with a one-line note (test file reference, or
   command + observed result)

ACs that cannot be auto-verified (visual, subjective, auth-required)
remain unchecked in the PR with an inline note explaining why, so a human
reviewer knows what to eyeball.

### D8. Merge-confidence gate (faff-workit → ship)

Merge happens only when **all four** conditions hold:

1. Every AC has a passing automated verification
2. CI is green
3. Review step passed
4. No flagged unresolved items in review

If all four hold:
- If `ship` skill configured → invoke it as the delivery mechanism
- Otherwise → `gh pr merge`

If any fail → leave PR open with checklist + review notes for a human.

### D9. `/faff-beep-boop` command

**Invocation:**
- `/faff-beep-boop` — ready-queue mode. Picks up all Todo issues with a
  spec. Nothing else.
- `/faff-beep-boop --full` — full pipeline: tidy → wtf → prep (on safe
  candidates) → workit.
- `/faff-beep-boop ISSUE-XX ISSUE-YY …` — explicit list, skip discovery.

**Pipeline (full mode):**

1. **Tidy pass** — autonomous tidy defaults (D3). Logs everything else.
2. **WTF pass** — build ready-queue (Todo with spec, or specable via D3).
3. **Spec pass (per candidate)** — apply faff-prep autonomous defaults
   (D3): stale-refresh, or high-confidence fresh-spec, or park.
4. **Conflict analysis** — run once over the final ready set (after spec
   pass) and partition issues into independents (parallelisable) and
   collision groups (serialised within group).
   Independents run in parallel; serialised groups run sequentially inside
   themselves but in parallel with other independents.
5. **Build pass (per issue)** — invoke `/faff-workit` in autonomous mode
   against a dedicated worktree. Inherits D7 and D8.
6. **Mid-build ambiguity** (within workit) — invoke `/faff-prep` respec.
   Still ambiguous → park.
7. **Merge decision** (D8) — auto-merge on high confidence, leave PR
   otherwise.
8. **Loop** until the queue is drained or everything remaining is parked.

**Parallelism:** uses the configured `parallel` skill if set; otherwise
sequential. Each parallel unit gets its own worktree.

**Stopping condition:** queue-drain — the run ends when the ready queue is
empty or all remaining issues are parked or blocked.

**Reporting:** on completion, beep-boop writes `runs/…/summary.md` and
posts a status update to the tracker. Summary lists: shipped, auto-merged,
PRs left for human review (with reason per AC), parked (with cause),
errored.

### D10. Conflict analysis heuristic

Issues are considered likely to collide when:
- Their spec names the same files
- Their spec names the same module directory (shallow check)
- One issue declares a blocker that is another in-flight issue
- Same configured scope tag / label indicates shared subsystem

When in doubt, serialise. Parallelism is a speedup, not a correctness
requirement — a false-positive collision is cheap; a false-negative is
expensive.

## Files Affected

**New:**
- `skills/faff-beep-boop/SKILL.md` — new user-facing skill (D9)

**Modified:**
- `skills/faff/SKILL.md` — add universal rules (D4 cancelled/archived, D5
  logging, D6 configurable slots, D3 autonomous-mode contract link)
- `skills/faff-wtf/SKILL.md` — yes/no chaining gates (D2), autonomous
  default (D3)
- `skills/faff-tidy/SKILL.md` — yes/no chaining gates (D2), autonomous
  default (D3)
- `skills/faff-prep/SKILL.md` — yes/no chaining gates (D2), hybrid C+B
  autonomous default (D3)
- `skills/faff-workit/SKILL.md` — yes/no chaining gates (D2), autonomous
  default (D3), AC verification step (D7), merge-confidence gate (D8),
  review/ship slot delegation with defaults (D6)

## Out of Scope

- No `/faff-review` or `/faff-ship` user-invokable skills.
- No auto-split/auto-merge of tickets (tidy never restructures backlog
  without human confirmation).
- No time-boxed or issue-count-capped beep-boop runs in the first cut
  (queue-drain only). Can add later if needed.
- No visual/subjective AC inference — anything that needs human eyes
  stays unchecked in the PR.

## Acceptance Criteria

1. Every existing faff skill's "run /faff-*" instruction is replaced with
   a yes/no gate that invokes the next skill on confirm.
2. `/faff-beep-boop` exists and invokes correctly in all three forms
   (default ready-queue, `--full`, explicit list).
3. All five faff skills have an autonomous-mode branch that follows the
   D3 rulebook.
4. All five skills ignore cancelled and archived issues/projects at every
   query point.
5. Every skill invocation produces a `.faff/logs/` entry with the D5
   contents. `.faff/` is in `.gitignore` (or added on first write).
6. All external-skill references in faff are read from CLAUDE.md slots
   with faff defaults when unset.
7. faff-workit's AC verification step is present and runs in both
   interactive and autonomous mode.
8. faff-workit merges only when the D8 four-condition gate is satisfied,
   via the configured `ship` skill or vanilla `gh pr merge`.
9. beep-boop's conflict analysis runs before the build pass and partitions
   the ready set into parallel/serial groups per D10.
10. beep-boop produces a summary at run end and posts to the tracker.
