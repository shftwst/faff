---
name: faff-wtf
description: "Where to focus — what shipped, what's stuck, what to work on next, and what an overnight beep-boop run parked. Trigger for: 'wtf' / 'what should I work on' / 'catch me up' / 'what happened' / 'what's blocked' / 'what's next', 'Where to focus', 'what's happening', 'where are we', 'where we at', 'whats up', 'the 411', 'lowdown'."
---

# Faff — WTF (Where To Focus)

> **Next steps:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building

Pull current state from your issue tracker and git, figure out what matters, tell you what to do.

## Configuration

**Load the gateway first.** This skill is usually entered directly (slash command or delegated slot), so the gateway is **not** automatically in context. If `~/.claude/skills/faff/SKILL.md` isn't already loaded this turn, **Read it now** — it holds the fixed contracts and shared rules this skill applies: the shared `.faffrc` configuration (`tracking` / `planning_skills`), the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, the park protocol, and the **fixed automation-routing + spec-readiness contracts** wtf displays. Loading it here means any slot wtf delegates to inherits these ambiently. WTF falls back to git-only mode if no tracker MCP is available.

**Shared work-ordering rule.** Anywhere this skill suggests, ranks, or recommends work — "Coming Up", "Today's Focus", "Ready to pick up", "Build queue" independents, parked-overnight triage — apply the same lexicographic order used by `/faff-tidy`:

1. **Priority** (issue-level OR any ancestor in the tracker hierarchy — parent, grandparent, or higher container, whatever the tracker calls it; respect both, inherit from the nearest ancestor that has a value)
2. **Chainable unlock value** — count of direct + transitive dependents (issues whose blockers list this one). An issue gating a chain of five beats an isolated issue at the same priority. Especially important for surfacing what's worth firing `/faff-beep-boop` at.

When the consuming project's CLAUDE.md flags a current workstream, weight issues in that workstream up.

**Reflect newly unlocked potential.** When summarising recently completed work, explicitly call out what each shipped issue **unblocked** — issues whose blockers cleared in the last 24-48 hours and are now ready (or one step closer to ready). This belongs in "Recently Completed" alongside the ship list, and these unlocked issues should rise to the top of "Coming Up" / "Today's Focus" / "Ready to pick up" because they represent *just-realised* potential the human/automation hasn't acted on yet.

## Always pull the whole picture fresh from the issue tracker

**A catch-up with stale data cannot be trusted.**

Every invocation re-fetches every milestone, every In Progress / Blocked / Recently Completed / Coming Up issue, every blocker link, every status field, every recent activity timestamp. No reusing the fetch from earlier in the same conversation. No trusting a snapshot in `.faffrc` or any static file. No reading a prior `.faff/logs/` file as a substitute for live data.

A briefing that mixes fresh-now data with 30-minute-old data is **silently wrong**. The reader trusts "What's up" as a coherent moment-in-time picture. If a PR merged, a status changed, a blocker resolved, or an issue got parked between partial fetches, the focus recommendation and beep-boop queue analysis produce confidently incorrect output — and the human acts on it. Better slow-and-correct than fast-and-lying. If the fetch budget is too high, scope the run smaller (single project) — never use partial freshness across a wider scope.

## What it does

**Rendering rules.** Every issue surfaced in any section below uses the synthesis contract (gateway → **Synthesis contract**) — tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. Build-queue and prep-queue sections render as the queue partition grid (`rendering_adaptor` slot, default `faffidavit-rendering` — form (c)). Cycles render as the cycle bracket / cycle box form. Structural diagnostics findings and calibration signals are pulled from the most recent `.faff/logs/YYYY-MM-DD/HHMMSS-tidy*.md` files; if none exists in the current pass, wtf runs the structural-diagnostics computation inline (same logic, same output location). When a `methodology` skill is configured under `planning_skills`, the first line of output is `Methodology: [skill-name]` and a new `### Methodology findings` section sits after `### Today's Focus`.

Run through these sections in order:

### 1. Timeline Check
- Read tracker/project config from `.faffrc` (`tracking`); milestones are always fetched live, never from config
- **Always re-fetch milestones and their completeness live** — never rely on cached snapshots or values written into `.faffrc`. Source of truth is the tracker. Call whichever tracker MCP is configured (use its list-milestones equivalent — autodetect from the available MCP, don't hardcode) per project / workstream id to pull current milestone target dates and progress percentages.
- Calculate where we are relative to milestone target dates
- Flag if any milestone is at risk based on remaining work vs time
- Render one table per project with columns `Milestone | Target | Progress` (see Output Format)

### 2. Issue Tracker State
- **In Progress:** Issues currently being worked on
- **Blocked:** Issues that are blocked and why
- **Recently Completed:** Issues closed since last briefing (last 24-48 hours). For each, list any issues it just **unblocked** (dependents whose last remaining blocker was this one). These newly-unlocked issues are the freshly-realised potential of the recent shipping.
- **Coming Up:** Next unstarted issues to surface, ordered per the shared work-ordering rule (priority, then chainable unlock value). Issues unblocked in the last 24-48 hours bubble to the top of this list — they represent the highest-leverage uncaptured potential.

Query using the project/team details from `.faffrc` (`tracking.project_id` / `tracking.team_key`). Exclude cancelled and archived per the shared rule.

### 3. Git Activity
- **Recent Commits:** Last 24-48 hours of commits on active branches
- **Open PRs:** Any PRs awaiting review or merge
- **Branch Status:** Active feature branches and their state
- **CI Status:** Any failing builds or checks

### 4. Parked Overnight

Surface every issue faff has parked — whether by an overnight `/faff-beep-boop` run **or** interactively (a manual `/faff-prep` / `/faff-workit` that hit low confidence, an unresolved punt the user chose to leave, or a build-time ambiguity). The manual L1 user parks too, and that work must resurface here — not only beep-boop's.

Sources:
- Most recent `.faff/runs/*-beep-boop-*/summary.md` (if any beep-boop run logs exist). Use `Bash(ls "$PWD/.faff/runs/" 2>/dev/null)` to check for existence — do **not** use Glob, which silently misses dot-prefixed directories in some environments (e.g. Docker containers).
- Tracker query for issues tagged `parked-by-faff` (or the tracker's equivalent label that beep-boop writes on park)

For each parked issue, surface:
- Issue id and title
- One-line cause summary pulled from the log or the tracker comment
- Path to the full log in `.faff/runs/…`

Skip this section entirely if there are no parked issues (no `parked-by-faff`-labelled issues and no parked items in run logs).

### 5. Today's Focus
Based on the above, recommend 2-3 specific things to focus on today, **selected and ordered per the shared work-ordering rule** (priority → chainable unlock value):
- **Never suggest cancelled or archived** issues or projects as candidates (shared rule)
- Prefer issues unblocked in the last 24-48 hours — recent shipping has just put them in play and they're the freshest source of leverage
- Within priority bands, prefer high chainable unlock value — picking up an issue that gates a chain of five beats an isolated issue at the same priority
- Flag if something blocked needs attention first
- Note any dependencies that are about to unblock downstream work — call out the size of the chain that would open up

### 5a. Methodology findings (rendered only when a `methodology` skill is configured)

**Value chains to unlock (rendered when any ready issue has chainable unlock value ≥ 2).** Above the focus picks, surface the **chains** themselves so the human can decide what's worth firing `/faff-beep-boop` at — this is the L2 "identify value chains to unlock" view. For each ready (or about-to-be-ready) issue that gates others, render the chain it opens, not just a count:

```
SHF-12  add auth-token service        →  unlocks SHF-18 → SHF-19 → SHF-23   (3 issues, all currently blocked only by SHF-12)
SHF-40  extract the billing client    →  unlocks SHF-41, SHF-42             (2 issues, parallel once SHF-40 ships)
```

Render the head issue (the one to build now), an arrow, then the transitive dependents in dependency order (a chain `A → B → C`) or as a flat set when they fan out in parallel. Note how many of the chain are blocked **only** by the head (i.e. would all become ready the moment it ships) versus still gated by other work. Order the chains by total unlock value. This is the one place wtf tells the L2 user *which lever ships the most downstream value*, rather than leaving chain-spotting to them. Skip the block when nothing has unlock value ≥ 2.

Request the `standup-digest` output from the configured `methodology` skill and render what it returns. The digest carries a WIP status, an optional sequencing diagnosis, and the top structural findings — the methodology decides their content; faff-wtf only places and trims them.

- **WIP coupling.** When the digest reports WIP at cap, `### Today's Focus` recommends **completion of in-flight only** — no new starts. Below cap, allow up to the digest's remaining-headroom count of new starts.
- **Highlight, not firehose.** Render at most two structural findings here, ordered by the digest's severity. If more exist, end with "(more in `/faff-tidy`)".

Skip the entire `### 5a` subsection if no `methodology` skill is configured.

### 5b. Beep-boop queues (always render, even when empty)

Show what `/faff-beep-boop` would pick up right now, computed per the **Automation-routing contract** (gateway). This section is **always present** — even with empty queues, render the headers with "(none)" so the human can see at a glance whether kicking off a run is worth it.

**Build queue (verdicts admitted: `fire-and-forget` + `likely-fire`).** Renders as the queue partition grid (`rendering_adaptor` slot, default `faffidavit-rendering` — form (c)). Independents are ordered per the shared work-ordering rule (priority → chainable unlock value). Collision groups are serialised within themselves and ordered by their lead issue's priority+unlock-value.

**Needs your call before automation can pick up.** Renders the four non-admitted verdicts in this order: `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`. Each issue carries the synthesis gloss + a one-line diagnosis (the Punt being asked, the named gap, the cycle visualised, or the repeat-park count and root-cause class). `needs-decision-first` has **two causes** — name which one in the diagnosis: a spec `**Punt:**` (show the decision being asked), or a retained `confidence: medium` rating (prep attached the spec for review rather than auto-building — show the rating explicitly and the area the spec was thin on). A medium-confidence spec with no open punt would otherwise render with an empty diagnosis; surfacing the rating is the whole point — it tells the human "give this a once-over" even when there's no single decision to make. `repeat-parked` ⚠ is rendered prominently — pattern parks are the strongest signal the human needs to act.

**Prep queue (drained by default `/faff-beep-boop` full pipeline).** Backlog/pre-Todo issues unblocked (or blocked only by in-queue work), with no discoverable spec or a stale/superseded spec flagged by tidy. List as flat bullets — no conflict analysis needed at prep stage. Apply the synthesis contract for the gloss.

### 5c. Structural diagnostics (always render — at least the status line)

Read the most recent tidy log (`.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`) for `backlog-diagnostics` findings. If no tidy ran this pass, request the `backlog-diagnostics` output from the configured methodology skill (default `faffter-noon-methodology-structural`). Render a one-line status if all clean (`Structural diagnostics: clean ✓`); otherwise render the findings in the format that output defines.

Repeat-parks, orphaned+repeat-parked, and **chain-gap** findings (any sub-type — sub-ticket / upstream / downstream / peer) additionally surface in `### 7. Heads up` so the user sees the urgent patterns prominently, not just in the diagnostics dump. Chain gaps are first-class Heads-up material: when a ticket's spec references work no ticket tracks, picking up the ticket leaves the broader purpose unfulfilled with no breadcrumb for what's next. Tag each Heads-up chain-gap entry with the sub-type so the human can scan-read.

### 5d. Calibration signals (rendered only when threshold crossed)

Read `.faff/calibration/` summary (computed by tidy if it ran, otherwise inline) and surface any signals that crossed the threshold (default ≥4 events of the same root-cause class in the last 14 days, configurable in `.faffrc`). See gateway → **Autonomous Mode Contract → Calibration log**.

Each signal renders as a paragraph with the count, pattern, period, and three suggested next actions. Signals are advisory — the user decides whether to act.

Skip this section entirely if no signals crossed the threshold.

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
- **Build queue non-empty:** yes/no "Build queue has N issues (M independents, K collision groups), plus P prep candidates. Run `/faff-beep-boop` (full pipeline — tidy + prep + build)? (y/n)". On confirm, invoke `/faff-beep-boop`. On deny, move on.
- **Prep queue non-empty with build queue empty:** yes/no "Nothing ready to build, but N prep candidates. Run `/faff-beep-boop` (default full pipeline) to drain the prep queue (will also build anything that lands at confidence: high)? (y/n)".

Keep the tracker in sync with reality. No one starts building without a spec.

## Output Format

Tabular output follows the `rendering_adaptor` slot's _Tabular data: markdown tables vs definition lists_ rule (default `faffidavit-rendering`) — drop markdown tables for any cell over ~30 chars or any prose cell; use definition-list blocks with `─` × 40 separators instead.

Keep it concise and scannable. Use this structure:

(when a `methodology` skill is configured, the first line is)

```
Methodology: [skill-name]
```

(followed by the standard layout below)

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
- ISSUE-XX  [synthesis gloss for the shipped issue] · unlocked: ISSUE-AA, ISSUE-BB ([synthesis gloss for the unlocked issues])

### In progress
- ISSUE-XX  [synthesis gloss] — [brief status note]

### Blocked
- ISSUE-XX  [synthesis gloss] — blocked by [reason]

### Parked overnight
- ISSUE-XX  [synthesis gloss] — parked: [cause summary] (log: .faff/runs/…/ISSUE-XX/)

### Do this
Ordered by priority → chainable unlock value. Items freshly unblocked by recent shipping bubble to the top.

1. ISSUE-XX  [synthesis gloss + unlock-chain consequence in plain English]. (Priority source: issue/ancestor; "just unlocked by ISSUE-YY" if applicable.)
2. ISSUE-YY  …
3. ISSUE-ZZ  …

### Methodology findings (rendered only when a methodology skill is configured)

WIP at 2 (cap 3). Below cap — recommending one new start.

Sequencing: current order would ship value at week 6. Value-aware ordering (ISSUE-A → ISSUE-B first) would ship at week 3. ISSUE-X (currently first) creates no standalone value; ISSUE-A unlocks the same downstream and ships value itself.

Workstream "Bugs Q2" is activity-named — sequencing inside it has no shared outcome. Consider regrouping by user-facing change.

(more in /faff-tidy)

### Heads up
- Repeat-park ⚠: ISSUE-VV  [gloss] — parked 4 runs same root cause; demoted to Backlog (decide via /faff-prep --refresh)
- Orphaned + repeat-parked ⚠: ISSUE-ZZ  [gloss] — parent project cancelled; parked 3 times; is this still wanted?
- Chain gap ⚠ (sub-ticket): ISSUE-AA  [gloss] — umbrella In Progress; spec enumerates 8 deliverables, 3 covered (2 PRs direct + 1 carved sub-ticket), 5 un-ticketed. No actionable next-step sub-ticket — /faff-workit can't advance it. (Methodology skill may auto-carve; default chain-offers /faff-prep --split.)
- Chain gap ⚠ (upstream): ISSUE-CC  [gloss] — spec assumes "auth refresh has shipped" prereq, but no ticket exists for that work. (Methodology skill may file the prereq + add blocker link; default offers "file gap issue".)
- Chain gap ⚠ (peer): ISSUE-EE  [gloss] — spec references "consumer-side changes in billing-events service", no peer ticket in workstream. (Methodology skill may file the peer + tag the workstream; default offers "file gap issue".)
- [Any risks, approaching deadlines, or flags]

### Beep-boop queues

**Build queue** (4 ready · 2 fire-and-forget · 2 likely-fire serialised)

  fire-and-forget
    ISSUE-XX  [synthesis gloss] · unlocks 3 alerting tickets
    ISSUE-YY  [synthesis gloss]

  likely-fire [ISSUE-A → ISSUE-B] (both touch src/auth/)
    ISSUE-A   [synthesis gloss]
    ISSUE-B   [synthesis gloss]

**Needs your call before automation can pick up:**

  needs-decision-first
    ISSUE-ZZ  [synthesis gloss] — Punt in spec: [decision asked] (decide in N min)
    ISSUE-QQ  [synthesis gloss] — confidence: medium (spec thin on [area]); prep attached for review

  gap-blocked
    ISSUE-WW  [synthesis gloss] — spec assumes [named gap]; [recommended fix]

  circular-blocked
    ISSUE-AA  [synthesis gloss] — sits in cycle [AA → BB → CC → AA]; recommend [break-edge]

  repeat-parked ⚠
    ISSUE-VV  [synthesis gloss] (parked N runs with same root cause: [class]). Decide.

**Prep queue** (N candidates, drained by default `/faff-beep-boop`)
- ISSUE-ZZ  [synthesis gloss] — [no spec | stale spec | superseded spec]

(Render "(none)" under any empty subsection rather than omitting it.)

### Structural diagnostics

Structural diagnostics: clean ✓

(Or, when findings exist, render the full block in the format the methodology slot's `backlog-diagnostics` output defines.)

### Calibration signals

(Skipped when no signals threshold-crossed; otherwise render each signal as a paragraph.)

### Ready to pick up
- ISSUE-XX  [synthesis gloss] — [why it's ready now; flag "(just unlocked by ISSUE-YY)" if applicable, "(unlocks N)" if it gates downstream work]
```

Skip any section that has nothing to report — **except the Beep-boop queues section**, which is always rendered. If both queues are empty, write "Build queue: (none)" and "Prep queue: (none)" so the human can see the run would have no work.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see `~/.claude/skills/faff/SKILL.md`) and these specifics:

**Output:** a plain ready-queue list — issue id, title, readiness flag (`ready` or `needs-prep`). No focus recommendation, no "Do this", no "Heads up", no chat-style prose.

**Return to caller (beep-boop):** `{ ready: [...], needs_prep: [...], blocked: [...], verdicts: { fire_and_forget: [...], likely_fire: [...], needs_decision_first: [...], gap_blocked: [...], circular_blocked: [...], repeat_parked: [...] }, structural_diagnostics_findings: N, calibration_signals: N }`.

**No chaining gates in autonomous mode** — beep-boop decides what to do with the queue. No remediation offers for parked issues either; triage is the human's job, not beep-boop's.

Log the query results and the returned lists to `.faff/logs/YYYY-MM-DD/HHMMSS-wtf.md`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Read working pattern notes from `.faffrc` (`tracking.working_patterns`) if available — respect the user's schedule when recommending focus
- Work-ordering everywhere = priority (issue OR any ancestor) → chainable unlock value. Same rule as `/faff-tidy`.
- Recent ships unlock latent potential — surface what each shipped issue unblocked, and float those just-unlocked issues to the top of "Coming Up" / "Today's Focus" / "Ready to pick up"
- Every surfaced issue uses the synthesis contract — plain-English gloss + unlock-chain consequence when non-trivial. Tracker IDs are breadcrumbs, not the load-bearing handle.
- Build-queue and prep-queue sections render as the queue partition grid per the visualisation contract — never as long prose lists.
- Structural diagnostics and calibration signals are pulled from the latest tidy log (or computed inline if tidy didn't run this pass). Repeat-parks, orphaned+repeat-parked, and chain gaps (any sub-type — sub-ticket / upstream / downstream / peer) always surface in `### Heads up`, not just in the diagnostics dump — a chain gap means a focus pick on the ticket leaves the broader purpose unfulfilled with no breadcrumb for what's next, and the human needs that visible before picking it up.
- When a `methodology` skill is configured, the output gains a `Methodology: [skill-name]` first line and a `### 5a. Methodology findings` section after Today's Focus. Both are skipped silently when no methodology is configured.
- WIP recommendations are human-facing only. Autonomous in-flight work (issues `/faff-beep-boop` is currently building or has a PR open for) does not count against the human's WIP cap — the human reviews one PR at a time.
- The Methodology findings section is the highlight, not the firehose. At most two structural findings; `/faff-tidy` surfaces the full set.
