# Faff Automation — Implementation Plan

**Date:** 2026-04-20
**Spec:** `docs/superpowers/specs/2026-04-19-faff-automation-design.md`
**Scope:** chaining gates across all faff skills + new `/faff-beep-boop`
skill + cross-cutting rules (cancelled/archived ignore, `.faff/` logging,
configurable skill slots, autonomous-mode contract).

This is purely SKILL.md authoring work — no runtime code, no unit tests.
"Verification" per step is a content/consistency check against the spec's
acceptance criteria plus a dry-run walkthrough of the skill's new flow.

## Execution Order

```
Step 1  ──>  Step 2a ──>  Step 3  ──>  Step 4  ──>  Step 5
             Step 2b ──┤
             Step 2c ──┤
             Step 2d ──┘
```

Step 2a-d can run in parallel but all must complete before Step 3
(beep-boop references shared contracts from all four sub-skills).

## Step 1 — Faff gateway + cross-cutting rules

**Why first:** every other skill references the shared rules defined
here (cancelled/archived ignore, logging layout, config slots,
autonomous-mode contract). Must exist before sub-skills can point at it.

**Files:**
- Modify: `skills/faff/SKILL.md`

**Changes:**
1. Add **Shared Rules** section listing:
   - **D4 (cancelled/archived ignored)**: every faff skill excludes
     cancelled/archived issues and cancelled/archived projects from every
     query, count, and recommendation. No exceptions.
   - **D5 (`.faff/` logging)**: layout (`logs/YYYY-MM-DD/HHMMSS-<skill>.md`
     and `runs/YYYY-MM-DD-beep-boop-HH-MM-SS/`). Required log contents
     (invocation context, MCP calls with inputs/outputs, decisions with
     reasoning, commit SHAs, PR URLs, errors, park causes). Gitignore
     behaviour: add `.faff/` to `.gitignore` on first write.
   - **D6 (configurable skill slots)**: the extended Planning Skills
     block (`spec`, `plan`, `parallel`, `review`, `ship`) and each slot's
     faff default when unset.
2. Add **Autonomous Mode Contract** section:
   - When a sub-skill is invoked in autonomous mode, these rules apply:
     never prompt; log every decision to `.faff/logs/…`; on unexpected
     state → park + log + continue; log entries include expected vs
     observed vs decision vs reason.
   - Each sub-skill's autonomous-branch specifics live in that skill's
     own SKILL.md (pointers only here).

**Verify:**
- `skills/faff/SKILL.md` documents D4, D5, D6, and the autonomous-mode
  contract, each in its own subsection.
- CLAUDE.md example block in the skill shows all five Planning Skills
  slots with "optional — defaults to …" annotations.
- No existing content in `skills/faff/SKILL.md` is removed — only
  appended (gateway purpose, routing table, existing configuration
  preamble remain).

**Rollback:** `git revert` the commit. Gateway-only; no downstream
dependencies yet at this point.

## Step 2a — faff-tidy: chaining + autonomous default

**Files:**
- Modify: `skills/faff-tidy/SKILL.md`

**Changes:**
1. Replace every "suggest /faff-prep" / "suggest /faff-workit" instruction
   with a yes/no gate that invokes via the Skill tool on confirm.
   Current text to replace (from existing SKILL.md):
   - Section "Almost ready (flag)": "For an issue that is ready but has
     no spec, suggest running `/faff-prep ISSUE-XX`" → batch offer:
     "N issues are ready for prep. Run prep on all / pick some / skip?"
     with invocation on confirm.
   - Section "Ready to pick up (promote to Todo)": after confirmation,
     offer yes/no "Prep these now via /faff-prep?".
2. Add **Autonomous Mode** subsection at the end:
   - Auto-archive merged/cancelled issues (per D4 these are already
     excluded from query, but tidy explicitly tombstones stragglers).
   - Auto-reparent obvious orphans: sub-issue whose parent is
     Done/Cancelled/Archived → reparent to grandparent if one exists,
     otherwise remove the parent link.
   - All other findings (dupes, vagueness, too broad, too big, premature,
     stale, unblocked, missing deps, aging, not needed, uncategorised) →
     log to `.faff/logs/…` as morning-review items. No tracker changes.
   - Never auto-split, auto-merge tickets, or delete.

**Verify:**
- No "suggest" or "you should run" language left in the file.
- Autonomous mode subsection lists the two allowed auto-actions and
  explicitly names the categories that are log-only.

**Rollback:** `git revert`. Independent of steps 2b/2c/2d.

## Step 2b — faff-wtf: chaining + autonomous default + parked-issue surfacing

**Files:**
- Modify: `skills/faff-wtf/SKILL.md`

**Changes:**
1. Chaining gates — replace current prose:
   - "run `/faff-prep` on that issue automatically" → keep the behaviour
     but phrase it as a yes/no gate: "Picking up ISSUE-XX. Prep now
     via /faff-prep? (y/n)".
   - "For a full groom, suggest `/faff-tidy`, but do not automatically
     do run it" → yes/no gate: "Run /faff-tidy for a full groom? (y/n)".
   - Section "After the catch-up" bullets — each maps directly to an
     explicit skill invocation with a yes/no gate.
2. Add **Parked Overnight** output section (D11):
   - On invocation, scan `.faff/runs/` for the most recent beep-boop run
     summaries and query the tracker for issues tagged as parked-by-faff
     (tag emitted by beep-boop — see Step 3).
   - If any exist, output under a new "Parked overnight" section above
     "Do this", listing each with: issue id, title, one-line cause
     summary pulled from log, log path.
   - For each parked issue, offer yes/no: open log / re-run /faff-prep /
     leave parked.
   - Skip the section if none.
3. Add **Autonomous Mode** subsection:
   - Return the ready-queue as a plain list (issue id + title + readiness
     flag). No focus recommendation, no "do this" prose, no "heads up".
   - Include the parked-overnight content only if this run found any —
     but do NOT offer remediation gates in autonomous mode (beep-boop is
     building, not triaging).

**Verify:**
- No "suggest" language left.
- Parked Overnight section spec'd for interactive mode with log linkage.
- Autonomous output is strictly the ready-queue list.

**Rollback:** `git revert`. Independent.

## Step 2c — faff-prep: chaining + autonomous default

**Files:**
- Modify: `skills/faff-prep/SKILL.md`

**Changes:**
1. Chaining gates:
   - End of Scenario A success path ("Run `/faff-workit` when you're
     ready to start") → yes/no gate: "Start building now via
     /faff-workit? (y/n)".
   - Scenario B "Build" choice → same (it's already an invocation; just
     reword from redirect to in-conversation Skill invocation).
2. Add **Autonomous Mode** subsection documenting two auto-spec paths:
   - **Stale-refresh:** if an existing spec is present, validate
     freshness against current codebase. If the original design
     decisions still hold (blockers shipped, minor drift, no
     architectural invalidation) → produce an updated spec with the
     changes annotated and reattach. Log the refresh decision + what
     changed.
   - **Fresh-spec:** only when the configured `spec` skill is present
     AND returns a high-confidence self-rating. Self-rating contract:
     the spec skill is asked to return `confidence: high|medium|low` at
     the end of its output. Medium/low → park.
   - If no `spec` skill is configured, the inline spec path is NOT
     available in autonomous mode (no self-rating to gate on) → park.
   - On park: attach a tracker comment with the park cause and log to
     `.faff/logs/…`.
3. Add a note that re-prep triggered in autonomous mode (mid-build by
   faff-workit) follows the same hybrid C+B logic. Output to caller is
   either `refreshed`, `parked`, or `promoted` (moved to Todo).

**Verify:**
- No "suggest" / "redirect to" language left.
- Autonomous subsection names both paths explicitly and the self-rating
  contract.
- Inline path clearly marked as unavailable in autonomous mode.

**Rollback:** `git revert`. Independent.

## Step 2d — faff-workit: chaining + autonomous default + AC verification + merge-confidence gate + review/ship defaults

**Files:**
- Modify: `skills/faff-workit/SKILL.md`

**Biggest change-set.** Three independent additions plus chaining.

**Changes:**
1. **Chaining gates:**
   - Step 6 "present spec and hand off to building" → keep the three-way
     choice (Build/Review/Reprep) but ensure each option is an explicit
     Skill invocation on confirm, not a redirect prompt.
   - Step 7/8 post-PR → yes/no gate: "Pick next ticket via /faff-wtf?
     (y/n)" instead of "decide next ticket via running `/faff-wtf`".
2. **D7 AC verification step** — new section after the existing build
   flow, before PR is opened:
   - For each AC in the spec, identify or write an automated test
     covering it.
   - Run tests; all must pass.
   - For live-exercise ACs (HTTP endpoint, CLI behaviour, filesystem
     side-effect), run the actual command (curl / bash / etc.) and
     capture the result.
   - PR description gets an AC checklist. Tick each as verification
     passes, with a one-line note (test file path or command + observed
     output).
   - ACs that can't be auto-verified (visual, subjective, needs-auth)
     remain unchecked with an inline note explaining why.
   - This section applies in both interactive and autonomous modes.
3. **Review phase** — internal to workit, runs after AC verification and
   before ship decision:
   - If `review` slot is configured in CLAUDE.md, invoke it.
   - Otherwise run the faff built-in lightweight review: diff read,
     AC-to-test coverage confirmation, obvious-bug scan (unused vars,
     commented-out blocks, uncaught promises, mismatched async/sync).
   - Output: pass/fail + list of flagged items. Appended to PR as a
     comment.
4. **D8 merge-confidence gate** — four conditions:
   1. Every AC has a passing automated verification
   2. CI is green
   3. Review step passed (no fails)
   4. No flagged unresolved items in review
   All four hold → merge via configured `ship` skill if set; else
   `gh pr merge`. Any fail → leave PR open with checklist + review
   comment for human.
   - In **interactive mode**, this gate fires when the user confirms
     "merge now" post-PR.
   - In **autonomous mode**, this gate fires automatically at the end
     of the build flow.
5. **Autonomous Mode** subsection:
   - Skip Build/Review/Reprep prompt. Proceed directly to build.
   - Mid-build ambiguity → invoke `/faff-prep` in respec mode. If
     respec returns `parked` → park this issue (WIP commit + draft PR +
     tracker note) and return to caller.
   - After build → run AC verification (step 2 above, mandatory) →
     review phase (step 3) → merge-confidence gate (step 4).
   - Park protocol (shared across autonomous skills): WIP commit if
     worktree exists, PR marked draft, tracker comment with cause,
     `.faff/logs/…` entry.
   - Return to caller (beep-boop): one of `shipped` / `pr-open-for-human`
     / `parked` / `errored`.

**Verify:**
- No "suggest" / "run" language left at decision points — all yes/no
  or short-choice gates.
- AC verification section is mandatory in both modes.
- Merge-confidence gate names all four conditions explicitly.
- Autonomous subsection documents the return values sent back to
  beep-boop.

**Rollback:** `git revert`. Independent of 2a-c.

## Step 3 — Create `/faff-beep-boop`

**Prerequisites:** Steps 1, 2a-d all complete.

**Files:**
- Create: `skills/faff-beep-boop/SKILL.md`

**Structure:**
1. **Frontmatter:** `name: faff-beep-boop`, description referencing
   "overnight unattended", "fire-and-forget", "chew through ready work".
2. **Configuration:** reads same CLAUDE.md as every faff skill; uses the
   `parallel`, `review`, `ship` slots when present.
3. **Invocation modes:**
   - `/faff-beep-boop` — ready-queue (default)
   - `/faff-beep-boop --full` — full pipeline
   - `/faff-beep-boop ISSUE-XX ISSUE-YY …` — explicit list
4. **Ready-queue mode:** iterate every Todo issue with a spec (per D4,
   skipping cancelled/archived). For each, invoke `/faff-workit` in
   autonomous mode. Aggregate returns. Report.
5. **Full mode** — two independent queues:
   - **Tidy pass** (Step 2a autonomous defaults)
   - **Prep queue build** — every non-blocked, non-cancelled, non-archived
     issue lacking a valid spec
   - **Prep queue drain** — apply faff-prep autonomous defaults (Step 2c)
     per candidate until queue empty; never short-circuit on build-queue
     state
   - **Build queue assembly** — collect every issue now with a valid spec
     and no open blockers
   - **Conflict analysis (D10)** — heuristics: spec names same files /
     same module dir (shallow) / blocker-of-another-in-flight / same
     scope tag. When in doubt, serialise. Output: independents +
     serialised-groups.
   - **Build pass** — parallel for independents (using configured
     `parallel` skill if set, else sequential), serial within each
     collision group. Each unit = one worktree + one `/faff-workit`
     autonomous invocation. Inherits Step 2d's AC + merge flow.
   - **Loop** until build queue drained or all remaining parked.
   - Skip build phase if build queue empty; go to reporting. Prep output
     still counts.
6. **Explicit-list mode:** skip discovery; for each listed issue, run
   the spec pass then build pass. Skip ones that don't exist or are
   cancelled/archived (log each skip reason).
7. **Park protocol:** shared with Step 2d — workit itself parks issues;
   beep-boop records parked issues in the run summary and ensures each
   has a `parked-by-faff` tag/comment on the tracker (this is what
   faff-wtf looks for in Step 2b's D11 surfacing).
8. **Reporting:**
   - On completion, write `.faff/runs/YYYY-MM-DD-beep-boop-HH-MM-SS/summary.md`
     listing: shipped (auto-merged), pr-open-for-human (per-issue reason),
     parked (per-issue cause), errored.
   - Post the same summary as a status update to the tracker.
   - Surface the summary in-conversation for the human's catch-up.
9. **Stopping condition:** queue-drain only. Explicitly note that
   `--max N` and `--until HH:MM` are out-of-scope for first cut.
10. **Autonomous contract reference:** all invoked sub-skills receive
    the mode flag "autonomous" (in-conversation signal — the top of the
    invocation explicitly says "running in autonomous mode, skip all
    prompts, park on ambiguity, log everything").

**Verify:**
- All three invocation forms documented.
- Prep queue and build queue are separate and clearly scoped.
- Conflict analysis heuristic explicit.
- Park propagation from workit → tracker tag → wtf surfacing all
  consistent.
- Run summary contents match what wtf expects to find in `.faff/runs/`.

**Rollback:** `git rm skills/faff-beep-boop/SKILL.md`. Sub-skills remain
functional on their own.

## Step 4 — Cross-skill consistency sweep

**Purpose:** catch seams between the five SKILL.md files that each step
couldn't see alone.

**Checks:**
1. Every skill uses the same terminology for autonomous mode (no drift
   between "autonomous mode", "unattended mode", "beep-boop mode").
2. Every skill's autonomous subsection references the shared contract in
   `skills/faff/SKILL.md` rather than re-stating it.
3. Log paths consistent across skills (`.faff/logs/` vs `.faff/runs/`
   used per the D5 rule).
4. Park return values from workit (`shipped`/`pr-open-for-human`/
   `parked`/`errored`) match what beep-boop's reporting expects.
5. CLAUDE.md slot names identical in every reference (`spec`, `plan`,
   `parallel`, `review`, `ship` — no typos, no singular/plural drift).
6. Chaining gate phrasing consistent — all yes/no gates, no stray
   "suggest" or "you should run" left in any of the five skills.
7. Each spec AC from the design doc maps to at least one skill section.

**Verify:**
- `grep -rn "suggest running" skills/` returns no faff-related hits.
- `grep -rn "you should run" skills/` returns no faff-related hits.
- Running through each spec AC and pointing at the section(s) that
  implement it yields no gaps.

**Rollback:** each fix is a small edit; revert individually.

## Step 5 — Manual dry-run walkthroughs

**Purpose:** this is documentation for an AI runtime — the real test is
whether the flow reads cleanly. Walk through each scenario as if
executing the skills, checking that each step has the context it needs.

**Scenarios (read the relevant SKILL.md and trace the decisions):**
1. Interactive: user runs `/faff-wtf` → picks issue → gates through
   prep → build → PR → chain to next `/faff-wtf`. Every gate is yes/no.
2. Interactive: user runs `/faff-tidy` → finds 3 almost-ready issues →
   gates through batch prep.
3. Autonomous: `/faff-beep-boop` (ready-queue) with 4 issues. Trace the
   per-issue flow through workit autonomous → AC verify → review →
   merge or park.
4. Autonomous: `/faff-beep-boop --full` with mixed backlog. Trace prep
   queue drain → build queue assembly → conflict analysis → parallel
   execution.
5. Mid-build ambiguity path: workit hits unresolvable decision →
   invokes `/faff-prep` respec → low-confidence → parks → tracker tag
   written → next morning `/faff-wtf` surfaces it.
6. Empty-build-queue case: `--full` mode where prep output doesn't
   reach ready. Verify pipeline reports prep results and stops cleanly.

**Verify:** for each scenario, every decision point has a defined
answer in the SKILL.md content. No "what does this skill do here?"
gaps. Fix inline.

## Acceptance Criteria Mapping (from spec)

| Spec AC | Step(s) covering it |
|---|---|
| 1. yes/no gates replace "run /faff-*" | 2a, 2b, 2c, 2d, 4 |
| 2. `/faff-beep-boop` invokes in all three forms | 3 |
| 3. All five faff skills have an autonomous-mode branch | 1 (contract), 2a-d, 3 |
| 4. Skills ignore cancelled/archived everywhere | 1, 2a-d, 3 |
| 5. Every invocation produces a `.faff/logs/` entry | 1 (layout), 2a-d, 3 |
| 6. External-skill references via CLAUDE.md slots | 1, 2d, 3 |
| 7. AC verification present in interactive + autonomous | 2d |
| 8. Merge only when four-condition gate satisfied | 2d |
| 9. Conflict analysis partitions ready set | 3 |
| 10. beep-boop produces summary + tracker post | 3 |
| 11. faff-wtf surfaces parked-overnight issues | 2b |

## Commit Strategy

One commit per step (1, 2a, 2b, 2c, 2d, 3, 4, 5). Step 2 sub-steps are
independent so can be individual commits. Commit messages follow repo
convention (`feat(faff-beep-boop): …`, `feat(faff-workit): …`, etc.).

## Out of Scope

Per spec's Out of Scope section:
- `/faff-review` and `/faff-ship` slash commands
- Auto-split / auto-merge of tickets in tidy
- Time-boxed (`--until`) or count-capped (`--max`) runs
- Visual/subjective AC auto-verification

No tests because this is SKILL.md content, not code. "Tests" = the dry-run
walkthroughs in Step 5.
