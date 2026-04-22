---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
---

# Faff — Prep

> **Next step:** `/faff-workit ISSUE-XX` to start building

Turn a vague ticket into something buildable. Prep does the thinking so you can just code.

Faff-prep is an **orchestrator** — it owns the issue tracker lifecycle and codebase exploration, but delegates spec production to the configured `spec` skill when available.

## Chat naming

**On invocation (interactive mode only):** set the chat name to the issue via `/rename ISSUE-XX: <title>` — e.g. `/rename SHF-75: auth middleware refresh`. Do this before Step 1.

In autonomous mode (invoked by `/faff-beep-boop`), **skip the rename** — beep-boop owns the chat name for the whole run.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol.

### Spec skill (optional)

If `CLAUDE.md` declares a `spec` slot in Planning Skills, faff-prep delegates spec production:

```markdown
## Planning Skills
- spec: superpowers:brainstorming
```

When configured, faff-prep invokes this skill, captures its output, and manages the issue tracker attachment. When unset, faff-prep produces a lightweight inline spec itself.

**Autonomous requirement:** the configured spec skill must return a confidence self-rating (`confidence: high|medium|low`) at the end of its output, and must produce decisions using the canonical markers defined in _Spec Format Contract_ below. Faff-prep uses the confidence rating to gate fresh-spec production in autonomous mode, and relies on the markers so downstream sub-skills (`/faff-workit`, `/faff-beep-boop`) can tell closed decisions from open punts without re-litigating them. A skill that cannot self-rate is still usable in interactive mode; the autonomous path parks instead.

When invoking a delegated spec skill, faff-prep passes the _Spec Format Contract_ as part of the instructions so the delegated skill produces markers the autonomous reader can rely on.

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is a high-level design document. It does **not** contain implementation-level details like step-by-step code changes, TDD cycles, or exact commands. Those belong to the implementation phase, where the implementer can feed the spec into their own planning/execution workflow (e.g., `superpowers:writing-plans`, `superpowers:subagent-driven-development`, or direct implementation).

## Spec Format Contract

Every spec faff-prep produces (delegated or inline, fresh or refreshed) must mark each non-trivial decision with one of the canonical markers below. This is the contract the autonomous reader in `/faff-workit` and `/faff-beep-boop` relies on — without it, the reader falls back to topic-keyword scanning and re-raises closed decisions as human blockers.

**Required markers (one per decision):**

| Marker | Meaning | Example |
|---|---|---|
| `**Chosen:** X` or `**Decision:** X` | Closed. The spec has picked X. Implementer does X. Reader must not re-raise. | `**Chosen:** pino — structured JSON logs, smallest dep footprint of the shortlist.` |
| `**Punt:** X or Y — needs human` | Open. The spec has explicitly deferred this to a human reviewer. Reader escalates. | `**Punt:** enforce via eslint rule or code-review checklist — needs human.` |
| `**Assumes:** X exists` | External dependency. Reader validates presence before build; parks if absent. | `**Assumes:** ISSUE-42 has shipped the auth middleware.` |

**Rules:**

1. Every decision section (tradeoff tables, "X vs Y" comparisons, architecture picks) must conclude with exactly one marker. Prose rationale above the marker is encouraged; the marker is what the reader parses.
2. A spec with a tradeoff table but no concluding marker is **invalid**. In autonomous mode, faff-prep parks rather than attaches. In interactive mode, faff-prep adds the missing marker before attaching (using the spec's own conclusion or flagging it inline if ambiguous).
3. `Punt:` and `Assumes:` markers must appear in a top-level "Open Questions" or "Assumptions" section so the reader can enumerate them quickly.
4. `Chosen:` / `Decision:` applies to any design choice: libraries, patterns, data shapes, naming, scope boundaries. If the spec weighs options and picks one, mark it.
5. No topic-keyword contract. The reader matches on markers, not topic names. A section called "Logging" with `**Chosen:** pino` at the end is closed; a section called "Anything" with `**Punt:** A or B — needs human` is open.

**Validation before attach:** faff-prep scans the spec for:
- At least one canonical marker in any section that presents multiple options.
- No dangling comparisons (tables or "vs" prose without a marker below).
- `Punt:` and `Assumes:` entries grouped in their dedicated sections.

In autonomous mode, validation failure → park. In interactive mode, validation failure → faff-prep adds the missing marker (drawing from the delegated skill's output or user-confirmed choice) before attach.

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
- Spec → `docs/superpowers/specs/YYYY-MM-DD-<issue>-<name>-design.md`

It ships with the PR alongside the code it describes.

### Phase 3: Merged (living documentation)

After the PR merges, the spec lives in the repo as a record of what was built and why.

### Delegated skill output handling

When a delegated spec skill produces output, it may write files to its default location. Faff-prep:
1. Lets the skill write to its default location
2. Reads the produced file content
3. Attaches the content to the issue as a comment
4. Deletes the local file (it lives on the issue tracker until implementation)

This keeps the delegated skill unchanged — it doesn't need to know about faff.

## Scenarios

### Scenario A: Fresh prep (no existing spec)

Apply the shared **Spec discovery** rule first (`skills/faff/SKILL.md`) — check tracker comments, the main description, and committed `docs/` paths. Only if **all three** come up empty, run the full prep workflow:

**Step 1: Explore (subagent)**
- Read the issue (title, description, ACs, dependencies, labels). Skip if cancelled or archived.
- Explore the codebase: what exists, current architecture, files/modules involved
- Check blocked-by issues: are they done? What did they produce?
- Surface ambiguities in the current issue description

**Step 2: Spec** (delegated or inline)

If a `spec` skill is configured, invoke it with the issue context and explore findings. Read its output. Attach the content to the issue as a comment. Clean up the local file.

If no `spec` skill is configured, produce an inline spec artifact:
- Design decisions with rationale — **each closed with a `**Chosen:**` / `**Decision:**` marker per the _Spec Format Contract_**
- Architecture and approach
- Interface contracts (API endpoints, component props, data schemas)
- Key technical decisions with pros/cons — **each concluded with a marker; open questions go in an "Open Questions" section using `**Punt:**`**
- External prerequisites — listed in an "Assumptions" section using `**Assumes:**`
- Risks, edge cases, what could go wrong
- Acceptance criteria — concrete, testable conditions for done
- If cross-boundary, recommend split

Run the marker validation from _Spec Format Contract_ before attaching. In interactive mode, fix missing markers inline. In autonomous mode, a validation failure means **park**.

**→ Immediately attach spec to the issue as a comment.**
- If the spec surfaced that the issue should be split, recommend the split
- If there are open questions, note them and leave the issue in backlog
- If clean, **move the issue to Todo** — it's prepped and ready to be picked up

**Step 3: Chain to build**

Yes/no gate:

> "Prepped and moved to Todo. Start building now via `/faff-workit`? (y/n)"

On confirm, invoke `/faff-workit ISSUE-XX` via the Skill tool in the same conversation.

### Scenario B: Resume (existing spec found)

The ticket already has a spec from a previous prep session. Apply the shared **Spec discovery** rule (`skills/faff/SKILL.md`) — check tracker comments, the main description, and committed `docs/` paths. Any hit counts.

**Step 1: Restore working state** — pull the spec from whichever source had it. If multiple sources exist, use the most recently modified one and note the others in the log.

**Step 2: Validate freshness** — read the spec against the current codebase state. Check: have dependencies shipped since this was scoped? Has the codebase changed in ways that affect the spec? Are the technical decisions still valid? If stale: flag what changed and why it needs updating.

**Step 3: Brief the user** — present a concise summary:
- What this ticket is about
- The proposed design approach (from the spec)
- Key technical decisions already made
- Artifact state: fresh or stale, and why
- Estimated scope/complexity

Then offer a three-way choice (not passive text):

> "What next? (iterate / build / park)"

- **iterate** — revise the spec (loop back to Step 2 of Scenario A)
- **build** — invoke `/faff-workit ISSUE-XX` via the Skill tool (only if spec is fresh)
- **park** — stop here, spec stays on the issue

### Scenario C: Starting an issue (deferred to workit)

When the user says "I'm working on ISSUE-XX" or picks an issue from the catch-up, use `/faff-workit` instead. Workit enforces the prep gate and handles worktree creation and status transitions.

## Re-prepping

At any point, the user (or `/faff-workit` mid-build) can say "reprep this" or "update the spec":

- Produce the revised spec → replace on the issue immediately
- Add a note: "Revised on [date] — [brief reason]"
- If the issue was already in Todo, it stays in Todo

## Where Artifacts Live

| Phase | Location | Purpose |
|-------|----------|---------|
| Prep | Issue tracker (comments) | Persistent, survives across sessions. Source of truth until build begins. |
| Build | Feature branch (e.g. `docs/superpowers/specs/`) | Committed by `/faff-workit` as first commit. Ships with the PR. |
| Merged | Main branch (e.g. `docs/superpowers/specs/`) | Living documentation of design intent. |

The spec is **never** committed during prep. It only enters the repo when building begins.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop` during a prep queue drain, or by `/faff-workit` mid-build for respec), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

Two allowed auto-spec paths:

### Path 1 — Stale-refresh (existing spec on the ticket)

If an existing spec is present and:
- The original design decisions still hold against the current codebase
- Changes are limited to shipped blockers, minor drift, or fresh context that doesn't invalidate the approach

→ produce a refreshed spec with changes annotated, **validate per the _Spec Format Contract_** (every decision section has a canonical marker), reattach to the issue, keep the issue where it is (Todo stays Todo).

If refreshing the spec would require changing an architectural decision, a core interface, or the overall approach → **park** (not a safe auto-refresh).

If the refreshed spec fails marker validation → **park** with cause "spec format contract violated — missing Chosen/Decision/Punt markers".

### Path 2 — Fresh-spec (no existing spec)

Only available when a `spec` skill is configured (see Configuration).

Invoke the configured spec skill (passing the _Spec Format Contract_ in the instructions). Inspect the `confidence:` self-rating at the end of its output, then run marker validation.

- `confidence: high` **and** marker validation passes → attach to issue, move to Todo, return `promoted`
- `confidence: high` **but** marker validation fails → **park** with cause "spec format contract violated — missing Chosen/Decision/Punt markers"
- `confidence: medium` → **park**
- `confidence: low` → **park**

If no `spec` skill is configured, the inline-spec path is **not available** in autonomous mode (no self-rating to gate on). **Park** with cause "no spec skill configured — inline path requires human authorship".

### Park protocol

Follow the shared park protocol (see `skills/faff/SKILL.md`):
- Post a tracker comment with cause (e.g. "low-confidence fresh-spec", "architectural change required in refresh")
- Tag the issue `parked-by-faff`
- Log to `.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` with the full reasoning

### Return values

Return to caller one of:
- `refreshed` — spec updated, issue stays in Todo
- `promoted` — fresh spec attached, issue moved to Todo
- `parked` — see park cause in log
- `errored` — something went wrong (MCP failure, unexpected state); treated as park for purposes of the run
