---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
---

# Faff — Prep

> **Next step:** `/faff-workit ISSUE-XX` to start building

Turn a vague ticket into something buildable. Prep does the thinking so you can just code.

Faff-prep is an **orchestrator** — it owns the issue tracker lifecycle and codebase exploration, but delegates spec production to a configured skill when available.

## Configuration

Reads project-specific details from `CLAUDE.md` — expects a **Project Tracking** section with issue tracker details (project ID, team key) and git host details (org, repo). Auto-detects which issue tracker and git host MCP servers are available.

### Spec Skill (optional)

If `CLAUDE.md` contains a **Planning Skills** section, faff-prep delegates spec production:

```markdown
## Planning Skills
- spec: superpowers:brainstorming
```

When configured, faff-prep invokes this skill, captures its output, and manages the issue tracker attachment. When not configured, faff-prep produces a lightweight inline spec itself.

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is a high-level design document. It does **not** contain implementation-level details like step-by-step code changes, TDD cycles, or exact commands. Those belong to the implementation phase, where the implementer can feed the spec into their own planning/execution workflow (e.g., superpowers writing-plans, subagent-driven development, or direct implementation).

## Prep Gate

`/faff-workit` requires a spec to exist on the issue before implementation can start. That's the only gate — one artifact.

## Artifact Lifecycle

### Phase 1: Prep (issue tracker only)

During prep, the spec lives **only on the issue tracker** as a comment/document. Nothing is committed to the repo. This means:
- No noisy commits, PRs, or CI runs for planning work
- The spec can be revised and replaced freely
- If the session crashes, the spec is preserved on the issue
- Attached **as soon as it's produced**, not batched

### Phase 2: Build (committed to repo)

When `/faff-workit` starts implementation, it pulls the spec from the issue and commits it to the feature branch as the first commit:
- Spec -> `docs/superpowers/specs/YYYY-MM-DD-<issue>-<name>-design.md`

It ships with the PR alongside the code it describes. The implementer may also produce a detailed plan during implementation — that plan gets committed to the feature branch too, but it's the implementer's concern, not prep's.

### Phase 3: Merged (living documentation)

After the PR merges, the spec lives in the repo as a record of what was built and why.

### Delegated skill output handling

When a delegated skill (e.g., `superpowers:brainstorming`) produces output, it may write files to its default location. Faff-prep:
1. Lets the skill write to its default location
2. Reads the produced file content
3. Attaches the content to the issue as a comment
4. Deletes the local file (it lives on the issue tracker until implementation)

This keeps the delegated skill unchanged — it doesn't need to know about faff.

## Scenarios

### Scenario A: Fresh prep (no existing spec on the ticket)

The ticket has no attached spec. Run the full prep workflow:

**Step 1: Explore (subagent — Explore)**
- Read the issue (title, description, ACs, dependencies, labels)
- Explore the codebase: what exists, current architecture, files/modules involved
- Check blocked-by issues: are they done? What did they produce?
- Surface ambiguities in the current issue description

**Step 2: Spec** (delegated or inline)

If a spec skill is configured:
- Invoke the configured spec skill, passing issue context and explore findings
- Read the skill's output, attach content to the issue as a comment
- Clean up the local file

If no spec skill configured, produce an inline **spec** artifact:
- Design decisions with rationale
- Architecture and approach
- Interface contracts (API endpoints, component props, data schemas)
- Key technical decisions with pros/cons
- Risks, edge cases, what could go wrong
- Acceptance criteria — concrete, testable conditions for done
- If cross-boundary, recommend split

**-> Immediately attach spec to the issue as a comment.**
- If the spec surfaced that the issue should be split, recommend the split
- If there are open questions, note them and leave in backlog
- If clean, **move the issue to Todo** — it's prepped and ready to be picked up. Tell the user: "Prepped and moved to Todo. Run `/faff-workit` when you're ready to start."

### Scenario B: Resume (existing spec found on the ticket)

The ticket already has a spec attached from a previous prep session.

**Step 1: Restore working state**
- Pull the spec from the issue

**Step 2: Validate freshness**
- Read the spec against the current codebase state
- Check: have dependencies shipped since this was scoped? Has the codebase changed in ways that affect the spec?
- Check: are the technical decisions still valid?
- If spec is stale: flag what changed and why it needs updating

**Step 3: Brief the user**
Present a concise summary:
- What this ticket is about
- The proposed design approach (from the spec)
- Key technical decisions already made
- Artifact state: fresh or stale, and why
- Estimated scope/complexity

Then ask:
- **"Iterate"** — revise the spec
- **"Build"** — proceed to implementation (only if spec is fresh). Redirect to `/faff-workit`.
- **"Park"** — stop here, spec stays on the issue.

### Scenario C: Starting an issue (deferred to workit)
When the user says "I'm working on ISSUE-XX" or picks an issue from the catch-up, use `/faff-workit` instead. Workit enforces the prep gate and handles worktree creation and status transitions.

## Re-prepping

At any point, the user can say "reprep this" or "update the spec":

- Produce the revised spec -> replace on the issue immediately
- Add a note: "Revised on [date] — [brief reason]"
- If the issue was already in Todo, it stays in Todo (revised spec doesn't change readiness)

## Where Artifacts Live

| Phase | Location | Purpose |
|-------|----------|---------|
| Prep | Issue tracker (comments) | Persistent, survives across sessions. Source of truth until build begins. |
| Build | Feature branch (e.g. `docs/superpowers/specs/`) | Committed by `/faff-workit` as first commit. Ships with the PR. |
| Merged | Main branch (e.g. `docs/superpowers/specs/`) | Living documentation of design intent. |

The spec is **never** committed during prep. It only enters the repo when building begins.

## Downstream: Implementation Uses the Spec

The spec is input to the implementation phase. The implementer (human or agent) decides their own execution strategy, for example if the user's preference is to use the `superpowers` skills they might:

- Feed the spec into `superpowers:writing-plans` for a detailed step-by-step plan
- Use `superpowers:subagent-driven-development` to break the spec into parallel tasks
- Use `superpowers:executing-plans` for sequential execution with review checkpoints
- Implement directly from the spec without a formal plan

Faff-prep doesn't prescribe the implementation approach. It ensures the "what" and "done criteria" are clear. The "how" is the implementer's call.

## Key Principles
- Prep produces one artifact: the spec (with ACs). That's it.
- The spec answers "what to build, why, and how do we know it's done".
- Implementation details (code, TDD, commands) are not prep's concern.
- Delegate to a configured spec skill when available. Only produce inline as a fallback.
- Nothing is committed until building starts.
- The spec is attached to the issue as soon as it's produced.
- Every ticket should be prepped before building.
