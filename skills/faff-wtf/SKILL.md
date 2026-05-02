---
name: faff-wtf
description: "Where to focus — what shipped, what's stuck, what to work on next, and what an overnight beep-boop run parked. Trigger for: 'wtf' / 'what should I work on' / 'catch me up' / 'what happened' / 'what's blocked' / 'what's next', 'Where to focus', 'what's happening', 'where are we', 'where we at', 'whats up', 'the 411', 'lowdown'."
---

# Faff — WTF (Where To Focus)

> **Next steps:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building

Pull current state from your issue tracker and git, figure out what matters, tell you what to do.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol. WTF falls back to git-only mode if no tracker MCP is available.

**Shared work-ordering rule.** Anywhere this skill suggests, ranks, or recommends work — "Coming Up", "Today's Focus", "Ready to pick up", "Build queue" independents, parked-overnight triage — apply the same lexicographic order used by `/faff-tidy`:

1. **Priority** (issue-level OR any ancestor in the tracker hierarchy — parent, grandparent, or higher container, whatever the tracker calls it; respect both, inherit from the nearest ancestor that has a value)
2. **Chainable unlock value** — count of direct + transitive dependents (issues whose blockers list this one). An issue gating a chain of five beats an isolated issue at the same priority. Especially important for surfacing what's worth firing `/faff-beep-boop` at.

When the consuming project's CLAUDE.md flags a current workstream, weight issues in that workstream up.

**Reflect newly unlocked potential.** When summarising recently completed work, explicitly call out what each shipped issue **unblocked** — issues whose blockers cleared in the last 24-48 hours and are now ready (or one step closer to ready). This belongs in "Recently Completed" alongside the ship list, and these unlocked issues should rise to the top of "Coming Up" / "Today's Focus" / "Ready to pick up" because they represent *just-realised* potential the human/automation hasn't acted on yet.

## Bash discipline (mandatory)

These rules apply to every `Bash` call in this skill — interactive and autonomous alike. Approval prompts break the user's flow in interactive mode and halt the run in autonomous mode; the fix is the same either way. Canonical: `skills/faff/SKILL.md` → **Bash command hygiene**. Mechanical reminders, restated here so they're visible at point of use:

- **Rule 0:** never `grep`/`rg`/`find`/`ls`/`cat`/`head`/`tail`/`sed`/`awk`/`echo >` via `Bash`. Use `Grep`/`Glob`/`Read`/`Edit`/`Write`. They never trip approval.
- **Rule 0.5:** never `cd` via `Bash`, **especially never `cd <dir> && git ...`** — the sandbox flags this as a "bare-repository-attack" pattern by name. Use `git -C <dir> ...` for git, or pass absolute paths.
- **Rule 0.6:** never shell-parse a file. No `awk file`, `sed file`, `jq file`, `cat file | …`. Use `Read` (with `offset`/`limit`) or `Grep`.
- **No `&&`-chains, `;`-chains, `|`-pipelines, `$(...)`, backticks, `$((...))`, process substitution, heredoc-to-interpreter, or multi-step shell.** One atomic binary invocation per `Bash` call; chain via separate tool calls.

Canonical trap: `cd /path && git show HEAD:file | head -80` violates Rules 0, 0.5, **and** the `&&`/pipeline ban in one line. Fix: `git -C /path show HEAD:file` as one atomic call (no `head` — let Bash return the output and truncate in your own context).

## What it does

Run through these sections in order:

### 1. Timeline Check
- Read project context from `CLAUDE.md` (tracker details, milestones)
- **Always re-fetch milestones and their completeness live** — never rely on cached snapshots or values written into `CLAUDE.md`. Source of truth is the tracker. Call whichever tracker MCP is configured (use its list-milestones equivalent — autodetect from the available MCP, don't hardcode) per project / workstream id to pull current milestone target dates and progress percentages.
- Calculate where we are relative to milestone target dates
- Flag if any milestone is at risk based on remaining work vs time
- Render one table per project with columns `Milestone | Target | Progress` (see Output Format)

### 2. Issue Tracker State
- **In Progress:** Issues currently being worked on
- **Blocked:** Issues that are blocked and why
- **Recently Completed:** Issues closed since last briefing (last 24-48 hours). For each, list any issues it just **unblocked** (dependents whose last remaining blocker was this one). These newly-unlocked issues are the freshly-realised potential of the recent shipping.
- **Coming Up:** Next unstarted issues to surface, ordered per the shared work-ordering rule (priority, then chainable unlock value). Issues unblocked in the last 24-48 hours bubble to the top of this list — they represent the highest-leverage uncaptured potential.

Query using the project/team details from `CLAUDE.md`. Exclude cancelled and archived per the shared rule.

### 3. Git Activity
- **Recent Commits:** Last 24-48 hours of commits on active branches
- **Open PRs:** Any PRs awaiting review or merge
- **Branch Status:** Active feature branches and their state
- **CI Status:** Any failing builds or checks

### 4. Parked Overnight

Scan for issues parked by a prior autonomous run (typically `/faff-beep-boop`).

Sources:
- Most recent `.faff/runs/*-beep-boop-*/summary.md` (if any beep-boop run logs exist). Use `Bash(ls "$PWD/.faff/runs/" 2>/dev/null)` to check for existence — do **not** use Glob, which silently misses dot-prefixed directories in some environments (e.g. Docker containers).
- Tracker query for issues tagged `parked-by-faff` (or the tracker's equivalent label that beep-boop writes on park)

For each parked issue, surface:
- Issue id and title
- One-line cause summary pulled from the log or the tracker comment
- Path to the full log in `.faff/runs/…`

Skip this section entirely if there are no parked issues.

### 5. Today's Focus
Based on the above, recommend 2-3 specific things to focus on today, **selected and ordered per the shared work-ordering rule** (priority → chainable unlock value):
- **Never suggest cancelled or archived** issues or projects as candidates (shared rule)
- Prefer issues unblocked in the last 24-48 hours — recent shipping has just put them in play and they're the freshest source of leverage
- Within priority bands, prefer high chainable unlock value — picking up an issue that gates a chain of five beats an isolated issue at the same priority
- Flag if something blocked needs attention first
- Note any dependencies that are about to unblock downstream work — call out the size of the chain that would open up

### 5b. Beep-boop queues (always render, even when empty)

Show what `/faff-beep-boop` would pick up right now, partitioned the same way beep-boop itself would partition it. This section is **always present** in interactive-mode output — if a queue is empty, show the header with "(none)". The human should be able to see at a glance whether kicking off a `/faff-beep-boop` run is worth it.

For each queue below, apply the shared **Spec discovery** rule and the autonomous-mode park criteria (three valid park categories only — see gateway). Do **not** pre-park issues for scope, chained dependencies, or in-queue blockers; beep-boop's conflict analysis will serialise those.

**Build queue (ready for `/faff-beep-boop`):** Todo issues with a discoverable spec, not cancelled/archived, not blocked by work outside the current run's queue. Run the same conflict analysis beep-boop would (files/modules/scope-tags/in-queue blocker links) and present as:

- **Independents** (parallel-safe), ordered per the shared work-ordering rule (priority → chainable unlock value): ISSUE-XX, ISSUE-YY, …
- **Collision groups** (serialised within each group, groups themselves ordered by the lead issue's priority + unlock value): [ISSUE-A → ISSUE-B], [ISSUE-C → ISSUE-D → ISSUE-E]

Chained issues belong in collision groups, **not** in a separate "blocked" list. If A depends on in-queue B, write `[B → A]`, not "A blocked by B".

**Prep queue (drained by the default `/faff-beep-boop` full pipeline):** Backlog/pre-Todo issues that are unblocked (or blocked only by in-queue work), with no discoverable spec or with a stale/superseded spec flagged by tidy. These are candidates `/faff-beep-boop` would push through `/faff-prep` before building. List as flat bullets — no conflict analysis needed at prep stage.

**Fire-and-forget callout:** within the build queue, mark any issue whose spec is self-rated `confidence: high` and has no Punt/Assumes markers with a `★` — these are the lowest-risk targets for a quick autonomous run.

### 6. Risks and Flags
- Anything overdue or slipping
- Approaching milestone deadlines
- Items that have been in progress too long without movement

### 7. Ready to pick up (lightweight tidy)
Quick scan for backlog issues that are now unblocked, well-prepped, and ready to pick up. Apply the shared work-ordering rule (priority → chainable unlock value) and mention the top 1-2 candidates. Issues unblocked within the last 24-48 hours by recent shipping take precedence — they're the leverage that just appeared.

## Chaining

All hand-offs are yes/no gates (or short-choice where a real branch exists). No passive "run /faff-*" language.

After presenting the output:

- **Picked a focus item:** "Picking up ISSUE-XX. Prep now via `/faff-prep`? (y/n)" — on confirm, invoke `/faff-prep` via the Skill tool. If the issue already has a spec, the gate becomes "Start building now via `/faff-workit`? (y/n)".
- **Multiple picked:** invoke `/faff-prep` (or `/faff-workit` if already prepped) on the first; note the rest for later.
- **"Done" reported by user:** move the issue to Done (no further chain).
- **"Blocked" reported by user:** mark blocked, ask the blocking reason.
- **"Reprep" or "update the spec":** yes/no "Re-prep via `/faff-prep`? (y/n)".
- **Full groom:** "Run a full groom via `/faff-tidy`? (y/n)".
- **Parked overnight issue:** for each, offer three-way choice "open log / re-run `/faff-prep` / leave parked (log/reprep/leave)". On `log`, print the log file contents. On `reprep`, invoke `/faff-prep` via the Skill tool. On `leave`, move on.
- **Ready to pick up candidate:** yes/no "Promote to Todo? (y/n)".
- **Build queue non-empty:** three-way "Build queue has N issues (M independents, K collision groups), plus P prep candidates. Run `/faff-beep-boop` (full pipeline — tidy + prep + build) / `/faff-beep-boop --ready` (build-only, the current build queue) / skip? (full/ready/skip)". On `full`, invoke `/faff-beep-boop`. On `ready`, invoke `/faff-beep-boop --ready`. On `skip`, move on.
- **Prep queue non-empty with build queue empty:** yes/no "Nothing ready to build, but N prep candidates. Run `/faff-beep-boop` (default full pipeline) to drain the prep queue (will also build anything that lands at confidence: high)? (y/n)".

Keep the tracker in sync with reality. No one starts building without a spec.

## Output Format

Keep it concise and scannable. Use this structure:

```
## What's up — [date]

**[Y] days to [next milestone]**

### Milestones

Source of truth is the configured issue tracker. Snapshot below — re-query via the tracker MCP's list-milestones equivalent per project / workstream id for the live view.

#### [Project Name]

| Milestone | Target | Progress |
|-----------|--------|----------|
| [ID · Name] | YYYY-MM-DD | NN% |

(Repeat one table per project.)

### Shipped
- ISSUE-XX: [title] — unlocked: ISSUE-AA, ISSUE-BB (or "unlocked: none" if it gated nothing)

### In progress
- ISSUE-XX: [title] — [brief status note]

### Blocked
- ISSUE-XX: [title] — blocked by [reason]

### Parked overnight
- ISSUE-XX: [title] — parked: [cause summary] (log: .faff/runs/…/ISSUE-XX/)

### Do this
Ordered by priority → chainable unlock value. Items freshly unblocked by recent shipping bubble to the top.

1. [Most important thing and why — note priority source (issue/ancestor) and unlock count if >0; flag with "(just unlocked)" if it became ready in the last 24-48h]
2. [Second thing]
3. [Third thing if applicable]

### Heads up
- [Any risks, approaching deadlines, or flags]

### Beep-boop queues

**Build queue** (N ready, `/faff-beep-boop --ready` to build-only) — ordered by priority → chainable unlock value

Independents:
- ISSUE-XX: [title] ★    ← ★ = fire-and-forget (confidence: high, no Punt/Assumes)
- ISSUE-YY: [title] (unlocks 3)    ← annotate non-trivial unlock counts so the leverage is visible

Collision groups (serialised within each; groups ordered by lead issue's priority + unlock value):
- [ISSUE-A → ISSUE-B]: [short reason — e.g. "both touch src/auth/"]
- [ISSUE-C → ISSUE-D → ISSUE-E]: [reason]

**Prep queue** (N candidates, drained by default `/faff-beep-boop`)
- ISSUE-ZZ: [title] — [no spec | stale spec | superseded spec]

(Render "(none)" under any empty subsection rather than omitting it.)

### Ready to pick up
- ISSUE-XX: [title] — [why it's ready now; flag "(just unlocked by ISSUE-YY)" if applicable, "(unlocks N)" if it gates downstream work]
```

Skip any section that has nothing to report — **except the Beep-boop queues section**, which is always rendered. If both queues are empty, write "Build queue: (none)" and "Prep queue: (none)" so the human can see the run would have no work.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Output:** a plain ready-queue list — issue id, title, readiness flag (`ready` or `needs-prep`). No focus recommendation, no "Do this", no "Heads up", no chat-style prose.

**Return to caller (beep-boop):** `{ ready: [...], needs_prep: [...], blocked: [...] }`.

**No chaining gates in autonomous mode** — beep-boop decides what to do with the queue. No remediation offers for parked issues either; triage is the human's job, not beep-boop's.

Log the query results and the returned lists to `.faff/logs/YYYY-MM-DD/HHMMSS-wtf.md`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Read working pattern notes from `CLAUDE.md` if available — respect the user's schedule when recommending focus
- Work-ordering everywhere = priority (issue OR any ancestor) → chainable unlock value. Same rule as `/faff-tidy`.
- Recent ships unlock latent potential — surface what each shipped issue unblocked, and float those just-unlocked issues to the top of "Coming Up" / "Today's Focus" / "Ready to pick up"
