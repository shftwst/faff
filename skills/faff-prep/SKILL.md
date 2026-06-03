---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
---

# Faff — Prep

> **Next step:** `/faff-graft ISSUE-XX` to start building

Turn a vague ticket into something buildable. Prep does the thinking so you can just code.

Faff-prep is an **orchestrator** — it owns the issue tracker lifecycle and codebase exploration, but **always delegates spec production to the `spec` slot** (default `faffter-noon-spec`). It never drafts the spec body itself; its job is to explore, invoke the producer, gate on the result, and manage attachment.

**Methodology lens.** When a `methodology` slot is configured, prep appends a **`## Methodology critique`** block after the spec body (before any chaining gates), per gateway → **The `methodology` slot** (display convention).

## Configuration

**Load the gateway first.** This skill is usually entered directly (slash command or delegated slot), so the gateway is **not** automatically in context. If `~/.claude/skills/faff/SKILL.md` isn't already loaded this turn, **Read it now** — it holds the fixed contracts and shared rules this skill applies: the shared `.faffrc` configuration (`tracking` / `planning_skills`), the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, the park protocol, and the **fixed spec-readiness contract** prep gates on. Loading it here means the `spec` and `spec_adaptor` slots prep delegates to inherit these ambiently.

### Spec slot (always delegated)

Spec production is **always** delegated to the `spec` slot. The slot defaults to `faffter-noon-spec` (the lite nlspec arc) when `.faffrc` doesn't set one:

```yaml
planning_skills:
  spec: superpowers:brainstorming   # optional override; unset → faffter-noon-spec
```

Faff-prep invokes the configured/default `spec` skill with the issue context and explore findings, captures its output, and manages the issue tracker attachment. It does **not** carry a fallback copy of the spec arc — the default producer always exists, so there is no "inline" path to fall through to.

**Producer requirements (the slot contract relies on):** the `spec` skill must (a) return a confidence self-rating (`confidence: high|medium|low`) at the end of its output, (b) produce decisions using the canonical markers defined by the `spec_adaptor` slot (default `faffidavit-spec`), and (c) discharge its own quality bar — for `faffter-noon-spec` that's the clean-context self-review before it returns (see its `SKILL.md` → _Self-review before returning_). Faff-prep gates on the returned confidence rating; the markers let downstream sub-skills (`/faff-graft`, `/faff-beep-boop`) tell closed decisions from open punts without re-litigating them. A `spec` skill that genuinely can't self-rate is usable interactively but cannot be driven autonomously — configure a producer that can (the default does).

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is a high-level design document. It does **not** contain implementation-level details like step-by-step code changes, TDD cycles, or exact commands. Those belong to the implementation phase, where the implementer can feed the spec into their own planning/execution workflow (e.g., `superpowers:writing-plans`, `superpowers:subagent-driven-development`, or direct implementation).

**Methodology critique block (rendered only when a `methodology` skill is configured).**

After the main spec body, **request the `issue-critique` output from the configured methodology** (gateway → **The `methodology` slot**, an Optional named output) — pass the issue + its spec, and render what the lens returns. faff-prep does not impose the critique's shape; the configured methodology decides what it cares about. If the methodology doesn't answer `issue-critique` (e.g. the structural default), **omit the block**.

For reference, the agile-delivery lens answers `issue-critique` along these axes — right-sized? (principle 4: single 1–3 day unit, or two independent concerns → split; always-ships-together sibling → merge), workstream fit? (principles 1+5: outcome-named and cohesive), deps surfaced? (principle 6: implicit dep with no blocker link), risk profile? (principle 7: novel-integration/external-dep risk → de-risking spike) — each rendered as a full what's-there / why / what-to-do diagnosis when there's something to surface, "No issues" when the check passes. A different methodology returns its own axes.

In autonomous prep (e.g. driven by `/faff-beep-boop`'s prep queue), the critique block is written to the spec but does **not** block confidence-high promotion. It surfaces in the next `/faff-wtf` for the human.

## Spec contract

Every spec faff-prep attaches (freshly produced by the `spec` slot, or refreshed) must satisfy the contract defined by the `spec_adaptor` slot (default `faffidavit-spec`): the canonical decision markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`), the marker rules, the skimmable-not-coded writing style, and the pre-attach validation. faff-prep does not redefine that contract — it passes it to the producer and validates against it before attach. References to "_spec contract_" elsewhere in this skill mean the slot's contract.

When invoking a delegated `spec` skill, faff-prep passes the slot's contract in the instructions. Validation is delegated to the `spec_adaptor` slot and runs before attach: autonomous failure → park; interactive failure → add the missing marker before attach.

## Spec quality bar (owned by the producer)

The clean-context review of a freshly drafted spec — dispatching a fresh-context subagent to verify every claim against the codebase before the spec is trusted — is the **producer's** responsibility, not prep's. The gateway makes a delegated `spec` skill responsible for its own quality bar; the default producer discharges it via its own _Self-review before returning_ step (see `faffter-noon-spec/SKILL.md`), which runs for every fresh spec regardless of size, applies the same `blocker`/`major`/`minor` severities, and enforces the self-rating downgrade rule (≥1 blocker or ≥3 major → can't self-rate `high`). prep does not re-run that review — it trusts the producer's self-rating and the markers, then applies its own gates below.

What prep still owns around the producer's output:

- **Marker validation** against the `spec_adaptor` slot before attach (autonomous failure → park; interactive → add the missing marker).
- **Logging.** Append the producer's returned review findings + resolutions to the prep log (`.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` or `.faff/runs/<run-id>/ISSUE-XX/prep.md`) alongside prep's own decisions. A missing review record from the producer is a process failure — prep notes it.
- **The confidence gate** (`high` → promote; `medium` → attach + retain; `low` → park), applied to whatever rating the producer returns.

**Refresh exemption.** On the stale-refresh path (Path 1 in autonomous), prep refreshes an already-vetted spec itself rather than re-invoking the producer — a scoped, annotated change, not a whole-cloth redraft — so the producer's self-review does not re-fire. If a refresh would require a whole-cloth redraft, prep re-invokes the producer (which self-reviews) instead.

## Prep Gate

`/faff-graft` requires a spec to exist on the issue before implementation can start. That's the only gate — one artifact.

## Artifact Lifecycle

### Phase 1: Prep (issue tracker only)

During prep, the spec lives **only on the issue tracker** as a comment. Nothing is committed to the repo. This means:
- No noisy commits, PRs, or CI runs for planning work
- The spec can be revised and replaced freely
- If the session crashes, the spec is preserved on the issue
- Attached **as soon as it's produced**, not batched

### Phase 2: Build (committed to repo)

When `/faff-graft` starts implementation, it pulls the spec from the issue and commits it to the feature branch as the first commit:
- Spec → `<spec-docs-path>/YYYY-MM-DD-<issue>-<name>-design.md` — `<spec-docs-path>` is the configured **Spec docs path** (default `docs/specs/`; see the gateway's **Spec docs location**)

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

Apply the shared **Spec discovery** rule first (`~/.claude/skills/faff/SKILL.md`) — check tracker comments, the main description, and committed `docs/` paths. Only if **all three** come up empty, run the full prep workflow:

**Step 1: Explore (subagent)**
- Read the issue (title, description, ACs, dependencies, labels). Skip if cancelled or archived.
- Explore the codebase: what exists, current architecture, files/modules involved
- Check blocked-by issues: are they done? What did they produce?
- Surface ambiguities in the current issue description

**Step 2: Spec** (delegated to the `spec` slot)

Invoke the configured/default `spec` skill (default `faffter-noon-spec`) with the issue context and explore findings. The producer runs its own clean-context self-review and returns the spec body, that review's findings, and a `confidence:` self-rating. Read its output, attach the content to the issue as a comment, and clean up any local file the producer wrote.

Run the marker validation from the _spec contract_ before attaching. In interactive mode, fix missing markers inline. In autonomous mode, a validation failure means **park**. Log the producer's returned review findings + resolutions to the prep log.

**→ Immediately attach spec to the issue as a comment.**
- If the spec surfaced that the issue should be split, recommend the split
- If there are open questions, note them and leave the issue in backlog
- If clean, **move the issue to Todo** — it's prepped and ready to be picked up

**Step 3: Chain to build**

Yes/no gate — confidence-aware:

> **`confidence: high`:** "Prepped and moved to Todo. Start building now via `/faff-graft`? (y/n)"
> **`confidence: medium`:** "Prepped at medium confidence (N open punt(s) / thin rationale: …). Moved to Todo but flagged for review. Resolve the open items now, or build anyway? (resolve/build/leave)"
> **`confidence: low`:** "Prepped at low confidence — explore couldn't resolve [the core question]. Resolve it together now, or park for later? (resolve/park)"

On `high` confirm (or `medium` → `build`), invoke `/faff-graft ISSUE-XX` via the Skill tool in the same conversation. On `medium` → `resolve` (or `low` → `resolve`), walk the open punts/unknowns with the user and re-attach. On `medium` → `leave`, stop — the spec stays on the tracker at its retained `medium` rating, which `/faff-wtf` surfaces as `needs-decision-first` (no park label needed; it's attached-pending-review, not parked). On `low` → `park`, **apply the shared Park / Unpark protocol** (gateway): tag the issue `parked-by-faff` and log the cause, so `/faff-wtf`'s _Parked work_ section resurfaces it for the manual user. Interactive parks must carry the label just like autonomous ones — otherwise a hand-parked spec silently disappears.

### Scenario B: Resume (existing spec found)

The ticket already has a spec from a previous prep session. Apply the shared **Spec discovery** rule (`~/.claude/skills/faff/SKILL.md`) — check tracker comments, the main description, and committed `docs/` paths. Any hit counts.

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
- **build** — invoke `/faff-graft ISSUE-XX` via the Skill tool (only if spec is fresh)
- **park** — stop here; apply the shared Park / Unpark protocol (tag `parked-by-faff`, log the cause) so `/faff-wtf`'s _Parked work_ section resurfaces it. The spec stays on the issue.

### Scenario C: Starting an issue (deferred to graft)

When the user says "I'm working on ISSUE-XX" or picks an issue from the catch-up, use `/faff-graft` instead. Graft enforces the prep gate and handles worktree creation and status transitions.

## Re-prepping

At any point, the user (or `/faff-graft` mid-build) can say "reprep this" or "update the spec":

- Produce the revised spec → replace on the issue immediately
- Add a note: "Revised on [date] — [brief reason]"
- If the issue was already in Todo, it stays in Todo

## Where Artifacts Live

| Phase | Location | Purpose |
|-------|----------|---------|
| Prep | Issue tracker (comments) | Persistent, survives across sessions. Source of truth until build begins. |
| Build | Feature branch, under the configured **Spec docs path** (default `docs/specs/`) | Committed by `/faff-graft` as first commit. Ships with the PR. |
| Merged | Main branch, under the configured **Spec docs path** (default `docs/specs/`) | Living documentation of design intent. |

The spec is **never** committed during prep. It only enters the repo when building begins.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop` during a prep queue drain, or by `/faff-graft` mid-build for respec), follow the shared autonomous contract (see `~/.claude/skills/faff/SKILL.md`) and these specifics:

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
- **Partially delivered** — some of the premise is covered, but a real delta remains. → **Narrow** the spec to that delta, calling out what's already done (in the `## Already shipped against this surface` section) so the implementer doesn't redo it. The narrow is then handled **per the calling path**: a fresh-spec caller (Path 2) re-invokes the producer on the narrowed scope, so its clean-context self-review fires on the narrowed spec; a stale-refresh caller (Path 1) refreshes the already-vetted spec in place, so the self-review is **exempted** (a scoped reduction, not a whole-cloth redraft, matching the producer's own _Self-review before returning_ → _When NOT to run_ narrowing exemption). If the narrowing crosses architectural lines (the remaining delta needs a different module structure than the original spec assumed), **park** under the architectural-change rule instead of reattaching. Either way the cited Done tickets are the audit trail; continue the rest of the path on the narrowed scope.
- **Premise still holds** — no substantial coverage by Done work. → **Proceed** unchanged. The `## Already shipped against this surface` section may still appear with related-but-not-superseding findings as reader context.

The substantial / partial / not-at-all judgement is the prep agent's call, backed by the explicit audit trail (the cited Done tickets and matched surface area) so a reviewer can check the call.

**Orthogonal to the existing confidence gate.** This gate fires *before* the confidence + marker validation gate at the end of Path 2 below (the `confidence: high / medium / low` bullets). Both gates must pass for the spec to attach. They evaluate different signals at different points — the premise gate asks "is the spec's motivation still load-bearing?", the confidence gate asks "is the spec internally well-formed?". Neither subsumes the other.

**Park-protocol compatibility.** `premise-superseded` parks apply the standard `parked-by-faff` label per the shared park protocol below. Downstream surfacers (`/faff-wtf`, `/faff-beep-boop`) carry the cause string transparently — no special handling there.

### Path 1 — Stale-refresh (existing spec on the ticket)

**Always run the post-spec comment scan first** (Scenario B Step 2a in the interactive flow): fetch all comments after the spec, classify each as challenge / resolution / context / noise. Treat any challenge or resolution as a freshness trigger equivalent to codebase drift. Context-only threads are not a freshness trigger on their own, but **must be carried into the refreshed spec as an annotation block** so the information survives — never silently drop them.

**Then run the shared already-shipped scan + premise-superseded gate** (above): **Park** (substantially delivered) exits Path 1 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues unchanged; **Narrow** (partially delivered) is handled per the subroutine — for Path 1 that means refreshing in place with the self-review exempted. Continue Path 1 on the narrowed scope.

If an existing spec is present and:
- The original design decisions still hold against the current codebase **and** against any post-spec challenges/resolutions
- Changes are limited to shipped blockers, minor drift, context comments to fold in as annotations, or comment-thread resolutions that close out an existing Punt/Assumes — none of which invalidate the approach

→ produce a refreshed spec with changes annotated (cite each post-spec comment that drove a change or was folded in as context), **validate per the _spec contract_** (every decision section has a canonical marker), reattach to the issue, keep the issue where it is (Todo stays Todo).

If refreshing the spec would require changing an architectural decision, a core interface, or the overall approach — including when a post-spec comment **challenges** a core decision — → **park** (not a safe auto-refresh; the conversation needs human resolution).

If the refreshed spec fails marker validation → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers".

### Path 2 — Fresh-spec (no existing spec)

Always delegated to the `spec` slot (default `faffter-noon-spec`) — autonomous never parks merely because no `spec` override is configured; the default producer always exists.

**Step 1 — produce the spec.** Invoke the `spec` slot, passing the _spec contract_ in the instructions. The producer runs its own clean-context self-review and returns the spec body, the review findings + resolutions, and a `confidence:` self-rating at the end of its output. (The self-review and the self-rating downgrade rule live in the producer — see `faffter-noon-spec/SKILL.md` → _Self-review before returning_.)

**Step 2 — run the shared already-shipped scan + premise-superseded gate** (above) on the just-produced spec: **Park** (substantially delivered) exits Path 2 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues to Step 3; **Narrow** (partially delivered) is handled per the subroutine — for Path 2 that means re-invoking the producer on the narrowed scope (its self-review fires). Continue to Step 3.

**Step 3 — validate and gate the spec.** Run marker validation per the _spec contract_. The producer already ran its clean-context self-review and returned a `confidence:` self-rating in Step 1 — prep does **not** re-review; it trusts the producer's rating (the producer is responsible for its own quality bar) and logs the returned review findings. The rating means:

- `high` — every non-trivial decision has a `**Chosen:**` marker with rationale, no `**Punt:**` escalates a genuine product/architecture question, the ACs are concrete and testable, and the self-review surfaced no `blocker` / fewer than 3 `major`.
- `medium` — mostly clean but 1–2 substantive `**Punt:**` markers, thin rationale a human would want to weigh in on, or a self-review that forced a downgrade.
- `low` — multiple `**Punt:**` markers, intent the explore couldn't pin down, or a self-review `blocker` that needed architectural reframing.

Apply the gate to the producer's output:

- `confidence: high` **and** marker validation passes → attach to issue (rating retained on the spec), move to Todo, return `promoted`
- `confidence: high` **but** marker validation fails → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers"
- `confidence: medium` → attach to issue **with the `confidence: medium` line retained**, move to Todo, return `promoted-needs-review`. Do **not** strip the rating — it is the re-spec signal: the routing verdict for a retained `medium` is `needs-decision-first` (gateway), so an autonomous run gives it a resolve-attempt and otherwise surfaces it in `/faff-wtf` rather than auto-building. The spec is visible on the tracker for a human to read, resolve the open punts, and bump to `high`.
- `confidence: low` → **park** with cause "low confidence — explore could not resolve core questions"

### Park protocol

Follow the shared park protocol (see `~/.claude/skills/faff/SKILL.md`):
- Post a tracker comment with cause (e.g. "low-confidence fresh-spec", "architectural change required in refresh")
- Tag the issue `parked-by-faff`
- Log to `.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` with the full reasoning

### Return values

Return to caller one of:
- `refreshed` — spec updated, issue stays in Todo
- `promoted` — fresh high-confidence spec attached, issue moved to Todo (build-eligible)
- `promoted-needs-review` — medium-confidence spec attached (rating retained) and moved to Todo; visible for human triage but **not** build-admitted — its routing verdict is `needs-decision-first`
- `parked` — see park cause in log (low confidence, contract violation, or architectural change needed)
- `errored` — something went wrong (MCP failure, unexpected state); treated as park for purposes of the run

## Notes

- When a `methodology` slot is configured, prep appends a `## Methodology critique` block to every prepped spec (invoking the methodology for issue-level findings). In autonomous prep the critique is written but does not block confidence-high promotion.
