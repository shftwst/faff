---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
---

# Faff — Prep

> **Next step:** `/faff-workit ISSUE-XX` to start building

Turn a vague ticket into something buildable. Prep does the thinking so you can just code.

Faff-prep is an **orchestrator** — it owns the issue tracker lifecycle and codebase exploration, but delegates spec production to the configured `spec` skill when available.

**Delivery-lead lens.** When `mode: delivery-lead` is active (gateway → **Delivery-lead methodology**), the first line of output is `Delivery-lead view: on` and a `## Delivery critique` block is appended to the spec output (after the main spec body, before any chaining gates). Skipped silently when the mode is off.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol.

### Spec skill (optional)

If `CLAUDE.md` declares a `spec` slot in Planning Skills, faff-prep delegates spec production:

```markdown
## Planning Skills
- spec: superpowers:brainstorming
```

When configured, faff-prep invokes this skill, captures its output, and manages the issue tracker attachment. When unset, faff-prep produces a lightweight inline spec itself.

**Autonomous requirement:** the configured spec skill must return a confidence self-rating (`confidence: high|medium|low`) at the end of its output, and must produce decisions using the canonical markers defined in _Spec Format Contract_ below. Faff-prep uses the confidence rating to gate fresh-spec production in autonomous mode, and relies on the markers so downstream sub-skills (`/faff-workit`, `/faff-beep-boop`) can tell closed decisions from open punts without re-litigating them. A delegated skill that cannot self-rate is downgraded to interactive-only; autonomous mode falls through to the inline path instead of parking.

When invoking a delegated spec skill, faff-prep passes the _Spec Format Contract_ as part of the instructions so the delegated skill produces markers the autonomous reader can rely on.

**Inline path is autonomous-capable.** When no `spec` skill is configured (or the configured one can't self-rate), faff-prep produces the inline spec itself and self-rates it — it has full visibility into the explore findings, the Spec Format Contract, and the resulting markers, so it can honestly assess whether the spec is high/medium/low confidence. The inline path is never a park reason on its own; the same confidence gate applied to delegated output also applies to the inline output.

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is a high-level design document. It does **not** contain implementation-level details like step-by-step code changes, TDD cycles, or exact commands. Those belong to the implementation phase, where the implementer can feed the spec into their own planning/execution workflow (e.g., `superpowers:writing-plans`, `superpowers:subagent-driven-development`, or direct implementation).

**Delivery critique block (rendered only when `mode: delivery-lead` is active).**

After the main spec body, append a `## Delivery critique` section answering, for the issue being prepped:

- **Right-sized?** (principle 4) Does the scope fit a single 1–3 day unit? Does the spec cover two structurally independent concerns? If yes to the latter, recommend a split. If the issue is paired with a sibling that always ships together, recommend a merge.
- **Workstream fit?** (principles 1 + 5) Is the issue in an outcome-named workstream? Is that workstream cohesive (single outcome)? If either fails, recommend the regrouping move.
- **Deps surfaced?** (principle 6) Does the spec reference any other ticket's output (by ID or clear paraphrase) without a declared blocker link? If yes, flag each implicit dep with the recommended action (link it, or remove the reference).
- **Risk profile?** (principle 7) Does the issue introduce novel-integration / external-dep / unproven-approach risk that warrants a de-risking spike before the full scope is committed? If yes, recommend the spike.

Each answer renders the relevant diagnosis from the methodology's principle (full what's there / why / what to do shape) when there's something to surface; "No issues" when the principle's check passes.

In autonomous prep (e.g. driven by `/faff-beep-boop`'s prep queue), the critique block is written to the spec but does **not** block confidence-high promotion. It surfaces in the next `/faff-wtf` for the human.

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

**Writing style: skimmable, not coded**

The marker contract above governs structure. This rule governs prose. A reader skimming the spec — without holding the source ADR, parent ticket, or blocker list in their head — must be able to follow what each section is about on first pass.

Concrete prohibitions:

- **No invented labelling schemes.** Don't introduce ad-hoc codes like `X1`, `F2`, `R3`, `W2a`, `Phase 4` and then cross-reference them throughout the spec. They force the reader to hold the full list in memory to decode any single line. If you need to refer back to earlier work, restate the subject ("the audit-error-registry relocation", "the cleanup PR for the entitlements route") rather than using a code.
- **Ticket numbers are fine** — `#123`, `SHF-247`, `ENG-42` are real, stable identifiers. The rule bans codes the spec invents, not codes that exist in the tracker. When citing a related ticket, prefer `SHF-247 (audit-error registry relocation)` over either `SHF-247` alone or `F5` alone.
- **Restate subjects on every cross-reference.** "F5 shim", "PR 4's deletions", "Phase 6", "test classes #1–#9" are opaque. Spell out what each is — "the audit-error-registry shim", "the webhook-route cleanup PR", "the cleanup phase", "the cross-tenant isolation tests".
- **Inherited codes from the source ADR or parent ticket are the most common offender.** If ADR-0016 uses `F1...F8` to label foundation phases, the spec must translate each into a descriptive subject before referencing it. The ADR is one document; the spec is another. The reader of the spec may not have the ADR open.
- **Descriptive lead columns in tables.** A row reading `PR 4 / W2 / in-app syncBilling impl / shim from W1` requires the reader to remember what `W2` and `W1` mean. Lead with a descriptive column ("Cleanup PR for the syncBilling webhook") or break into named subsections instead of relying on the code grid.
- **Prefer standalone prose sentences over compressed bullet walls.** Three sentences that each make sense in isolation beat a five-bullet wall whose meaning depends on having read the preceding section.

This rule applies equally to the inline path and to delegated `spec` skill output (faff-prep passes this contract to the delegated skill).

**Validation before attach:** faff-prep scans the spec for:
- At least one canonical marker in any section that presents multiple options.
- No dangling comparisons (tables or "vs" prose without a marker below).
- `Punt:` and `Assumes:` entries grouped in their dedicated sections.

In autonomous mode, validation failure → park. In interactive mode, validation failure → faff-prep adds the missing marker (drawing from the delegated skill's output or user-confirmed choice) before attach.

## Inline-spec subagent review (mandatory, all sizes)

When faff-prep produces an inline spec (i.e. no `spec` skill is configured, or the configured one is unavailable), dispatch a clean-context subagent to review the freshly generated spec against the codebase **before** attaching it to the tracker. This applies in **both** interactive and autonomous mode, **regardless of issue size**, and it runs in addition to marker validation and self-rating — not instead of them.

**Why:** by the time the inline spec is drafted, the prep agent's context is saturated with explore findings, rationale-as-it-was-being-formed, and the framing it locked in early. That context makes it hard to spot: missed conventions in the codebase, decisions that don't fit the existing architecture, vague or untestable ACs, `**Punt:**` items that the codebase actually answers, `**Assumes:**` entries that aren't true, or scope creep that crept in mid-drafting. A reviewer with fresh context — given only the spec and the codebase — sees the spec the way `/faff-workit` will see it. Catching these issues at prep is an order of magnitude cheaper than catching them mid-build, and the cost of one subagent dispatch is negligible relative to the cost of building from a flawed spec — true for an XS spec just as much as for an XL one.

**No size threshold.** Don't skip the review for "small" issues. Small specs go wrong in the same ways large ones do (vague ACs, false `**Assumes:**`, missed convention) — they're just shorter, which makes the review faster, not unnecessary. If you find yourself reasoning "this is a one-line change, the review is overkill", that's the same capacity-shaped rationalisation banned by the gateway's forbidden-park-reasons list. Just dispatch.

**Dispatch.** Use the `Agent` tool with `subagent_type: Explore` (read-only — the reviewer must not edit the spec; it returns findings, prep applies them).

The subagent prompt must include:

1. The full spec content (markers and all).
2. The issue title, description, and any blocked-by/dependency context.
3. The explicit review brief — paraphrased, not copy-pasted from a template:
   - "You are reviewing a freshly drafted spec against the codebase. You have **clean context** — use it. Read the spec, then explore the codebase to verify each claim it makes."
   - Specific checks to run (see "What the reviewer must check" below).
   - Output format: structured findings, one entry per issue spotted, each with severity (`blocker` / `major` / `minor`) and a one-line proposed fix or open question.
4. An instruction to keep the review under ~400 words of findings — prep needs signal, not a second draft of the spec.

**What the reviewer must check** (the prompt should enumerate these explicitly so the subagent doesn't drift into general code review):

- **Codebase fit.** Does each `**Chosen:**` decision match how the codebase already does similar things? Flag decisions that introduce a new pattern when an established one exists, or that ignore an existing utility/abstraction the spec author seems to have missed.
- **Assumes-validity.** For every `**Assumes:**` entry, can the reviewer confirm the assumed thing actually exists in the repo (file, dep, function, branch state)? Flag any that don't.
- **Punt-resolvability.** For every `**Punt:**` entry, is the answer actually findable in the codebase? Sometimes the spec author punted on something the code already decides — in which case the punt should be a `**Chosen:**`.
- **AC testability.** Is each AC concrete and testable? Flag anything vague ("works correctly", "is performant") or anything that lacks a clear pass condition.
- **Skimmability.** Does the spec invent labelling schemes (`X1`, `F2`, `R3`, `W2a`, `Phase 4`) and cross-reference them throughout? Does any section assume the reader is holding the source ADR, parent ticket, or blocker list in their head? Flag every invented code that should be a descriptive subject ("the audit-error-registry shim" rather than "F5") — and flag inherited codes from a source ADR that the spec propagated wholesale instead of translating. Tracker ticket numbers (`#123`, `SHF-247`) are not the target — they're stable identifiers, not invented codes.
- **Scope creep.** Does the spec promise things outside the issue's stated intent? Flag anything that reads like an opportunistic refactor smuggled into the spec.
- **Missing surface.** Are there obvious code paths or edge cases the spec doesn't address that the codebase shows are relevant (existing tests, neighbouring features, error-handling conventions)?
- **Interface mismatch.** Do the proposed interface contracts (API shapes, component props, data schemas) match how callers in the codebase already work?

**Acting on the findings:**

| Finding severity | Interactive mode | Autonomous mode |
|---|---|---|
| `blocker` (spec is wrong about a fact in the codebase, contains an Assumes that doesn't hold, or the Chosen decision contradicts established convention without acknowledging it) | Surface to user, revise inline before attach | Revise the spec to address the finding (apply the proposed fix, or convert the affected `**Chosen:**` to a `**Punt:**` with the conflict noted). Re-self-rate. If the revision drops confidence to medium/low, follow the standard gate (park). If a blocker can't be fixed without architectural reframing, **park** with cause "subagent review surfaced unresolvable blocker — needs human" |
| `major` (vague AC, scope creep, missed edge case) | Surface to user, fix or note inline | Fix in the spec where mechanical (tighten an AC, drop an out-of-scope item); leave as `**Punt:**` with the reviewer's note where judgement is needed. Self-rating may downgrade accordingly |
| `minor` (style, naming, would-be-nice clarification) | Optionally fix; otherwise log and move on | Fold into the spec where trivial; otherwise log and proceed |

**Self-rating downgrade rule:** if the subagent review surfaces ≥1 `blocker` or ≥3 `major` findings, the inline spec **cannot** be self-rated `high` regardless of how the prep agent felt about it pre-review. Cap at `medium` minimum, which (in autonomous mode) means park. This stops the prep agent from rationalising past honest findings. Applies to every inline spec, regardless of size.

**Logging.** Append the subagent's full output to the prep log (`.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` or `.faff/runs/<run-id>/ISSUE-XX/prep.md`), then append the resolution decisions (which findings were applied, which were left as `**Punt:**`, which were dismissed and why). The audit trail must show that the review ran and what was done with it — a missing review log on an inline spec is itself a process failure.

**Why mandatory and not optional:** "optional" review steps degrade to "skipped" review steps. If a future invocation is tempted to skip this on capacity grounds ("this issue is small", "the explore was thorough enough", "the spec is only three lines"), refuse the temptation — the same logic that bans capacity-based parks (see `skills/faff/SKILL.md` Autonomous Mode Contract) applies here.

**When NOT to run it:**

- Delegated `spec` skill output (the delegated skill is responsible for its own quality bar — its self-rating gates on it).
- Stale-refresh path (Path 1 in autonomous): the original spec was already vetted; refresh changes are scoped, not whole-cloth.

## Prep Gate

`/faff-workit` requires a spec to exist on the issue before implementation can start. That's the only gate — one artifact.

## Artifact Lifecycle

### Phase 1: Prep (issue tracker only)

During prep, the spec lives **only on the issue tracker** as a comment. Nothing is committed to the repo. This means:
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

**Before attaching (inline spec only, all sizes):** dispatch the clean-context subagent review per _Inline-spec subagent review_ above. Apply its findings (revise, downgrade self-rating, or park) before moving to attach.

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

**Step 1: Restore working state** — pull the spec from whichever source had it. If multiple sources exist, use the most recently modified one and note the others in the log. **Note the spec comment's timestamp** — you'll use it in the next step.

**Step 2a: Scan comments since the spec for substantive thread changes.** Fetch all comments on the issue (whichever tracker MCP is configured) and look at every comment posted **after** the spec comment. Categorise each:
- **Challenge** — questions, pushback, or new constraints that contradict or undermine a decision in the spec ("this won't work because…", "we now need to support X", "Y was deprecated since you wrote this").
- **Resolution** — decisions or answers that close out a Punt/Assumes/TBD marker in the spec, or otherwise commit to a direction the spec left open.
- **Context** — substantive information that doesn't challenge or resolve but is worth knowing while building: a relevant link, a related discovery, a constraint to watch out for, a stakeholder note. Doesn't force re-prep but **must be surfaced** to the user (interactive) or carried into the spec annotations (autonomous refresh) so it doesn't get lost.
- **Noise** — status pings, "+1", "any update?", unrelated chatter. Ignore.

If any challenge or resolution exists, the spec is **out of date** even if the codebase hasn't moved — the conversation has. Treat this exactly like a stale-spec finding: the spec must be re-prepped (or refreshed) to incorporate the comment thread before any build can proceed. Context-only comments do not force re-prep but should be appended to the spec as an annotation block (and shown in the brief). Log each challenge / resolution / context entry with its commenter, timestamp, and a one-line summary.

**Step 2b: Validate freshness against the codebase** — read the spec against the current code state. Check: have dependencies shipped since this was scoped? Has the codebase changed in ways that affect the spec? Are the technical decisions still valid? If stale: flag what changed and why it needs updating.

**Step 3: Brief the user** — present a concise summary:
- What this ticket is about
- The proposed design approach (from the spec)
- Key technical decisions already made
- **Comment-thread state since the spec** — list any challenges, resolutions, and context items found in Step 2a (or "none" if clean). Context items are surfaced too so the user sees them; they don't block build by themselves.
- Artifact state: fresh / fresh-with-context / stale-by-codebase / stale-by-discussion / both, and why
- Estimated scope/complexity

If Step 2a surfaced challenges or resolutions, the default action is **iterate** — the user shouldn't be offered `build` until the spec absorbs the thread. Context-only threads do not force iterate; the user can still pick `build` knowing the context.

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

Two allowed auto-spec paths. Both invoke the shared subroutine documented immediately below at the points named in their respective sections.

### Shared subroutine: already-shipped scan + premise-superseded gate

Both autonomous paths invoke this subroutine at the explicit step boundary documented in their sections. The subroutine asks: *given Done sibling tickets in the same project, is this spec's premise still load-bearing?* The answer routes the spec down park / narrow / proceed.

**1. Already-shipped scan.** Four steps:

1. **Extract surface-area signals** from the candidate spec and the issue: named file paths, top-level module / directory names, named subsystems (e.g. *"audit workflow"*, *"prompt substrate"*, *"HMAC envelope"*). Heuristic — false positives cost a few tokens, false negatives miss matches.
2. **Query Done tickets in the same project (and initiative when one is named).** Use whichever tracker MCP is configured (per gateway auto-detect, no hardcoded tool names). Filter to Done / Completed / Closed. Match on the surface-area signals from step 1, plus name proximity to the candidate spec's title or subsystem labels.
3. **Pull a one-line summary of each match** — title plus the first line of description or the most recent significant comment.
4. **Emit findings under a new section** `## Already shipped against this surface` in the candidate spec. If no matches, omit the section.

Surface-area extraction is heuristic. Tune toward **recall** — false positives cost human review time but do not produce wrong parks; false negatives miss real overlaps and let prep elaborate stale-premise specs. When surface-area signals miss, fall back to querying Done tickets in the same initiative by name.

**2. Premise-superseded gate.** After the scan emits findings, prep evaluates: *given the `## Already shipped against this surface` findings, is the spec's stated motivation still load-bearing?* Three outcomes:

- **Substantially delivered** — significant portion of the premise is already covered by Done tickets. → **Park** with cause `premise-superseded`. The park comment **must** cite at least one Done ticket ID and the matched surface area or subsystem name. Without that evidence the cause is invalid and prep must not use it (it degrades into a forbidden capacity excuse per gateway → Autonomous Mode Contract).
- **Partially delivered** — some of the premise is covered, but a real delta remains. → **Narrow** the spec to the remaining delta. Explicitly call out what's already done so the implementer doesn't redo it; note this in the `## Already shipped against this surface` section. Proceed with the rest of the path on the narrowed scope.
- **Premise still holds** — no substantial coverage by Done work. → **Proceed** unchanged. The `## Already shipped against this surface` section may still appear with related-but-not-superseding findings as reader context.

The substantial / partial / not-at-all judgement is the prep agent's call, backed by the explicit audit trail (the cited Done tickets and matched surface area) so a reviewer can check the call.

**Orthogonal to the existing confidence gate.** This gate fires *before* the confidence + marker validation gate at the end of Path 2 below (the `confidence: high / medium / low` bullets). Both gates must pass for the spec to attach. They evaluate different signals at different points — the premise gate asks "is the spec's motivation still load-bearing?", the confidence gate asks "is the spec internally well-formed?". Neither subsumes the other.

**Park-protocol compatibility.** `premise-superseded` parks apply the standard `parked-by-faff` label per the shared park protocol below. Downstream surfacers (`/faff-wtf`, `/faff-beep-boop`) carry the cause string transparently — no special handling there.

### Path 1 — Stale-refresh (existing spec on the ticket)

**Always run the post-spec comment scan first** (Scenario B Step 2a in the interactive flow): fetch all comments after the spec, classify each as challenge / resolution / context / noise. Treat any challenge or resolution as a freshness trigger equivalent to codebase drift. Context-only threads are not a freshness trigger on their own, but **must be carried into the refreshed spec as an annotation block** so the information survives — never silently drop them.

**Then run the shared already-shipped scan + premise-superseded gate** (documented above). Outcomes apply to Path 1 as follows:

- **Park (substantially delivered)** — exit Path 1 immediately. Park with cause `premise-superseded`, citing Done ticket IDs and matched surface area in the park comment.
- **Narrow (partially delivered)** — the spec narrows to the remaining delta. **The Path 1 subagent-review exemption is preserved** for the narrow case (the original spec was already vetted; narrowing is a scoped reduction, not whole-cloth, matching the same rationale as the existing exemption documented in _Inline-spec subagent review_'s `When NOT to run it` list). The narrowing rationale and cited Done tickets in the `## Already shipped against this surface` section are the audit trail. Continue with the rest of Path 1 on the narrowed scope.
- **Proceed (premise holds)** — continue unchanged.

If the narrowing crosses architectural lines (e.g. the remaining delta requires a different module structure than the original spec assumed), defer to the existing architectural-change park rule below — park rather than reattach.

If an existing spec is present and:
- The original design decisions still hold against the current codebase **and** against any post-spec challenges/resolutions
- Changes are limited to shipped blockers, minor drift, context comments to fold in as annotations, or comment-thread resolutions that close out an existing Punt/Assumes — none of which invalidate the approach

→ produce a refreshed spec with changes annotated (cite each post-spec comment that drove a change or was folded in as context), **validate per the _Spec Format Contract_** (every decision section has a canonical marker), reattach to the issue, keep the issue where it is (Todo stays Todo).

If refreshing the spec would require changing an architectural decision, a core interface, or the overall approach — including when a post-spec comment **challenges** a core decision — → **park** (not a safe auto-refresh; the conversation needs human resolution).

If the refreshed spec fails marker validation → **park** with cause "spec format contract violated — missing Chosen/Decision/Punt markers".

### Path 2 — Fresh-spec (no existing spec)

Available in **both** delegated and inline modes — autonomous never parks merely because no `spec` skill is configured.

**Step 1 — produce the spec.** Either:

- **(delegated)** If a `spec` skill is configured: invoke it, passing the _Spec Format Contract_ in the instructions. The skill returns the spec body plus a `confidence:` self-rating at the end of its output.
- **(inline)** If no `spec` skill is configured (or the configured one can't self-rate): produce the inline spec yourself per Scenario A Step 2 (explore findings → design decisions with `**Chosen:**`/`**Decision:**` markers, open questions in `**Punt:**`, prerequisites in `**Assumes:**`, ACs).

**Step 2 — run the shared already-shipped scan + premise-superseded gate** (documented above) on the just-produced spec. Outcomes apply to Path 2 as follows:

- **Park (substantially delivered)** — exit Path 2 immediately. Park with cause `premise-superseded`, citing Done ticket IDs and matched surface area in the park comment.
- **Narrow (partially delivered)** — the spec narrows to the remaining delta. Continue with Step 3 on the narrowed scope. (Inline path: the subagent review in Step 3 fires on the narrowed spec — Path 2's review is mandatory regardless of how the spec arrived at its final scope.)
- **Proceed (premise holds)** — continue with Step 3 unchanged.

**Step 3 — validate and review the spec.** Run marker validation per _Spec Format Contract_. Then:

- **(delegated)** The spec skill already produced a `confidence:` self-rating in Step 1. No additional subagent review (the delegated skill is responsible for its own quality bar).
- **(inline)** **Dispatch the clean-context subagent review per _Inline-spec subagent review_ above** (mandatory for every inline spec, regardless of size) and apply its findings (revise the spec, fold blockers, leave open questions as `**Punt:**`) before self-rating. Self-rating is a deliberate honest assessment based on:

- `high` — the explore phase surfaced clear answers, every non-trivial decision has a `**Chosen:**` marker with rationale, no `**Punt:**` markers escalate genuine product/architecture questions, and the ACs are concrete and testable.
- `medium` — the spec is mostly clean but has 1–2 `**Punt:**` markers on substantive choices, or one or more decisions where the rationale feels thin and a human would likely want to weigh in.
- `low` — multiple `**Punt:**` markers, or the explore phase couldn't pin down the underlying intent of the ticket, or core architecture is genuinely unclear.

Apply the same gate to either output:

- `confidence: high` **and** marker validation passes → attach to issue, move to Todo, return `promoted`
- `confidence: high` **but** marker validation fails → **park** with cause "spec format contract violated — missing Chosen/Decision/Punt markers"
- `confidence: medium` → **park** with cause "medium confidence — needs human review of open punts"
- `confidence: low` → **park** with cause "low confidence — explore could not resolve core questions"

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

## Notes

- When `mode: delivery-lead` is active (gateway → **Delivery-lead methodology**), the output gains a `Delivery-lead view: on` first line and a `## Delivery critique` block on every prepped spec. The critique surfaces principles 1, 4, 5, 6, 7 findings for the issue. In autonomous prep, the critique is written to the spec but does not block confidence-high promotion.
