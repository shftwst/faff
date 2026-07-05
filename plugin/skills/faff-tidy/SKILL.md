---
name: faff-tidy
description: "Groom the backlog in both directions — find problems (dupes, vague tickets, stale blockers, dead weight), surface structural diagnostics (cycles, ghost-project pointers, repeat-parks, splittable specs), and promote ready issues to Todo. Trigger for: 'tidy' / 'clean up' / 'backlog' / 'groom' / 'mess'."
judgement_seam: dupe, vague, stale, superseded, splittable, chain-gap
---

# Faff — Tidy

> **Next step:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-graft ISSUE-XX` to start building an issue that's prepped

Tidy the backlog. Looks both ways in one pass:

- **Down:** find the mess — dupes, vagueness, dead weight, stale specs, stale blockers, aging issues, orphans, uncategorised, splittable, blocked
- **Up:** find issues that are actually ready and promote them to Todo, are parallelisable, or done

## Configuration

**Load the gateway first.** If `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. tidy assigns against the **fixed automation-routing contract**; its `methodology` / `routing_adaptor` slots inherit the gateway ambiently.

**Consuming-project CLAUDE.md is context.** Read the consuming project's `CLAUDE.md` (and any docs it points at) before tidying. Treat it as clues to organisation and current workstream priority — what areas the project cares about right now, what's been deprioritised, naming conventions for groupings. Use this to inform priority calls when ordering ready/promotion suggestions and to spot mis-grouping in "Uncategorised".

**Cancelled work is noise — ignore it entirely.** Do not surface cancelled entities — issues, or whatever the tracker calls higher-level groupings — in any summary, finding, or bucket. The only exception: if a **cancelled ancestor** (parent, grandparent, or any higher-level container, regardless of what the tracker calls it) still has **non-cancelled descendants**, ask the human (interactive) or log for human review (autonomous) whether those descendants should be cancelled too. Never auto-cancel.

**Never offer to add labels.** Labelling is `/faff-prep`'s job. Tidy does not suggest, apply, or chain into label changes — not for "Uncategorised", not for spec health, not anywhere. If categorisation is genuinely missing, flag the issue for `/faff-prep` instead.

**Description ≠ spec** (gateway → **Spec discovery**). A populated description is not a spec; never promote an issue to Todo on the strength of one. That's a `/faff-prep` candidate, not a ready issue.

**Comments are mandatory in spec discovery.** Per the shared rule (gateway → **Spec discovery**, "Comments are not optional"), you **must** fetch each issue's comments via the configured tracker MCP before bucketing it for spec health or readiness. Descriptions-only classification is a **broken run** that mis-classifies the common case as "needs prep". If there are too many issues to comment-fetch individually, batch-fetch or scope the run smaller; never substitute description-only sampling, and never hedge with "comments not checked": complete the discovery and re-classify before reporting.

**Methodology lens.** When a `methodology` slot is configured, tidy adds **bucket 7 (Methodology findings)** — surface-only, no auto-actions (display convention: gateway → **The `methodology` slot**).

## Always pull fresh

Every invocation re-fetches the whole active backlog live per the shared **Always pull fresh** rule (gateway): every active issue, both-direction blocker links, the comment thread on every issue being classified, status, ancestors, labels. Tidy is the **highest-stakes** case of that rule because **tidy acts**: a stale grooming pass strips a now-needed link, mis-classifies a freshly-specced issue as needs-prep, or flags a live issue as orphaned-by-cascade when it isn't. Acting on stale data is the one thing tidy must never do. Tidy's scope is **every active issue in the team / project** (or a smaller structural scope, announced explicitly); it never inherits another skill's already-filtered surface, including `/faff-wtf`'s briefing slice, since a pre-filtered subset hides the dupes, orphans, cycles, and ghost pointers tidy exists to find.

## Process

**Tidy acts. It does not just list.** Any finding with a mechanical, unambiguous fix is applied — not reported as an observation for the human to do later. "X, Y, Z reference cancelled blocker W" is not a finding to surface; it is an instruction to strip the references. Surfacing cascading cancellations as prose in a summary, with no action taken, is the failure mode to avoid.

Query all backlog issues from the issue tracker. **Exclude cancelled and archived per the shared rule.** **For every active issue you intend to classify (spec health, almost-ready, ready), fetch its comments first** — the spec usually lives there. Skipping the comment fetch and falling back to descriptions invalidates the entire spec-health pass. Sort each into one of three buckets:

### 1. The mess (needs action)

- **Dupes:** Two issues covering the same work
- **Vagueness:** Issues with no clear deliverable — what even is this?
- **Too broad:** Single issues spanning multiple domains that should be split
- **Too big:** Single issues spanning too much effort that could be split
- **Premature:** Issues depending on work or decisions that don't exist yet
- **Spec health** — run the shared **Spec discovery** rule per active issue. **Note the spec comment's timestamp and scan all comments posted after it.** Classify each post-spec comment as **challenge** (questions / pushback / new constraints contradicting the spec), **resolution** (decisions that close out a Punt/Assumes/TBD in the spec), **context** (substantive info worth knowing — links, related discoveries, stakeholder notes — that doesn't challenge or resolve but should be folded into the spec as an annotation), or **noise** (status pings, "+1", unrelated chatter). Then classify the issue:
  - **Overlooked:** A spec exists but not in a canonical discovery location — e.g. draft in an old comment thread, a markdown file on a stale branch, an unlinked document. Or: the issue is in Todo (past the prep gate) but spec discovery finds nothing at all. **Action (mechanical):** move/link the spec to a canonical location (tracker comment or the configured spec-docs path, default `docs/specs/…`) so prep and graft can find it. If no spec exists anywhere but the issue is in Todo, demote the issue back to Backlog and flag for `/faff-prep` — crossing the prep gate without a discoverable spec is a broken state.
  - **Challenged:** The spec is fine on its own terms but post-spec comments contain unresolved challenges or fresh resolutions that the spec doesn't reflect — the conversation has moved on even if the codebase hasn't. **Action:** in interactive mode, surface for `/faff-prep` in refresh mode (prep's Step 2a will fold the comment-thread changes into the spec). In autonomous mode, follow `/faff-prep` autonomous stale-refresh rules — refresh if the challenges/resolutions are non-architectural and absorbable; park if a challenge contests a core decision.
  - **Context-pending:** Post-spec comments contain only context items (no challenges, no resolutions) that haven't been folded into the spec yet. The spec is still buildable as-is, but the context risks getting lost between now and build. **Action:** in interactive mode, flag for `/faff-prep` in refresh mode so the context is annotated into the spec — but mark the flag as low-priority (build can proceed without it; this is a hygiene fix). In autonomous mode, log it; do not push it through the prep queue ahead of stale/challenged candidates. A context-only finding never blocks promotion to build.
  - **Stale:** Spec's design decisions no longer hold against the current codebase — deps listed in the spec have since shipped with different shapes, architecture has moved on, files the spec names have been renamed/deleted, or the spec predates a significant refactor. **Action:** in interactive mode, surface for `/faff-prep` in refresh mode. In autonomous mode, follow `/faff-prep` autonomous stale-refresh rules (refresh only if the original design still holds; else park).
  - **Superseded:** Another ticket has since shipped that changes the approach this spec assumes — e.g. the spec planned to extend module X, but a subsequent PR replaced X with module Y. The spec is not just stale; its premise is wrong. **Action:** flag for human re-prep or cancellation (the work may no longer be wanted, or may need a completely different plan). Do not auto-refresh — the new direction requires human judgement.
  - **Flagged (medium-confidence):** the attached spec retains a `confidence: medium` rating — prep attached it for human triage rather than auto-building (its routing verdict is `needs-decision-first`). Read the rating against the post-spec comment scan. **Action:** if the comments have since closed the spec's open `**Punt:**` items, flag for `/faff-prep --refresh` to bump the rating to `high` (it then becomes build-eligible). If the open items are still unresolved, surface it as a pending spec decision in the morning brief. A retained `medium` is **never** Ready on its own — it does not promote to a build candidate until the rating is bumped.
- **Dead references to cancelled/archived work (mechanical cleanup — strip the links).** Any active issue carrying a blocker / blockedBy / parent / sub-issue / related / dependency pointer to a cancelled or archived issue. The reference is always dead — a cancelled issue cannot unblock, parent, or depend on anything. Action: remove the link from the active issue. This is not a judgement call and is applied in both interactive and autonomous modes. Whether the active issue itself is still wanted after cleanup is a **separate** question (see "Orphaned by cascade" below).
- **Orphaned by cascade:** Active issues whose rationale depended on a chain of now-cancelled work — e.g. "cost metric + alert on observability stack" when all four observability issues were cancelled in a mass sweep. After dead-reference cleanup these issues have no remaining justification. Flag for human judgement (cancel / redirect / leave as-is). Do not auto-cancel; the call belongs to the human.
- **Unblocked:** Issues whose only remaining blockers are Done. After confirming the blocker actually produced what was needed, remove the (now-satisfied) blocker link and re-evaluate readiness.
- **Missing deps:** Issues that clearly need something not listed in their blockers
- **Dead weight:** Merged/cancelled issues still cluttering the backlog
- **Aging:** Old issues that are likely never be worked upon
- **Not needed:** Issues that are not needed any longer
- **Orphaned:** Issues without a parent project, or sub-issues with a Done/Cancelled parent issue
- **Descendants of cancelled ancestors:** Active issues with any cancelled ancestor in the chain (immediate parent or further up — whatever container types the tracker uses). Surface for human decision: cancel them, reparent them, or leave standalone. Never auto-cancel.
- **Uncategorised:** Issues that are clearly mis-grouped against the consuming project's CLAUDE.md / docs (wrong parent, wrong ancestor, wrong grouping). Surface as a flag for `/faff-prep` — **never propose labels here**.
- **Stale park label:** Issues still carrying the `faff-parked` label (or tracker equivalent) that fall into either of two sub-cases:
  - **State moved on:** issue is now In Progress, In Review, Done, Cancelled, or Archived. The label exists so `/faff-wtf` surfaces work that needs human attention; once a human has picked it up, merged it, or killed it, the label is noise.
  - **Park reason no longer applies:** read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`. The park is invalid if (a) the reason matches a pattern now forbidden by the autonomous contract (session compaction, context length, topic-keyword match on a spec-closed decision, edits to files that only take effect after merge like CI/IaC/Dockerfile/netlify.toml), (b) the reason cited a specific blocker issue ID and that blocker is now Done/Merged/Cancelled, or (c) the reason cited a spec punt and the spec has since been updated to close that punt with a `Chosen:`/`Decision:` marker.

For each, state the problem and recommend a specific action (split, merge, archive, update deps, clarify, promote, flag for `/faff-prep`, reparent). **Never recommend label changes** — that's `/faff-prep`.

### 2. Ready to pick up (promote to Todo)

An issue is ready when:
- Nothing is blocking it (or blockers are already Done)
- You can tell what "done" looks like
- The deliverable is concrete, not hand-wavy
- No big architectural questions to answer first
- Not a dupe of something else
- **Has a real spec** per the shared **Spec discovery** rule (canonical tracker comment, committed under the configured spec-docs path — default `docs/specs/…` — or equivalent). A populated description is **not** a spec — issues with only a description are **never** ready; they go to "Almost ready" for `/faff-prep`.
- **Automation-eligible** — an issue that is **not automation-eligible** (gateway → **Automation eligibility**: lacks `faff-automate` under the opt-in default, or carries `faff-automation-hold`) is **never** auto-promoted to Todo, however otherwise-ready it looks; an otherwise-ready-but-not-cranked-up issue appears in the **On hold** section below as a crank-up candidate, not here. (Autonomous tidy must also not tag a not-eligible issue `stale-spec`/`superseded-spec` — see Autonomous Mode.)

**Decide readiness via `faff next`, not by re-checking these criteria by hand** (gateway → **Next-step transition**): map each issue's fetched state to the flags and consult `faff next` — `graft` ⇒ ready (promote candidate), `prep` ⇒ "Almost ready" (needs `/faff-prep`), `skip-ineligible` ⇒ the **On hold** section, `needs-human`/`blocked` ⇒ not ready. The bullets above are the human-readable shape of that transition. The labels + status mapped to those flags are **sourced from the live backlog re-fetch this pass took** (gateway → **Always pull fresh** + **Re-ground before gate**) — the promote gate reads eligibility at the gate, never from a stale snapshot, so an issue a human cranked up just before this run promotes on its live labels.

**Order ready issues via the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**) — tidy states no ordering of its own; it renders the order the methodology returns (the thematic default supplies priority + chainable unlock value when no methodology is set). Present ready issues in that order so the human (or `/faff-beep-boop`) picks up the right thing first.

### 3. Almost ready (flag)

Issues that are close but need one small thing — a blocker that's still In Progress, one unresolved question, an unclear acceptance criterion, **or solid info in the description but no spec in any canonical discovery location** (description alone never counts — those go here, for `/faff-prep`).

### 4. Stuck in prep — needs human decision

Issues currently carrying the `faff-parked` label (or tracker equivalent) where the park is **still valid** — i.e. the autonomous-mode auto-removal rules above did **not** clear it, because the park reason is genuinely subjective or judgement-bound: an architectural call to make, scope to decide, a punt the spec didn't close, an explicit "needs human" marker. These are real blockers on a human, not noise.

For each, read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md` and surface it concisely so the human knows what decision is being asked of them. When the blocker is an open `**Punt:**` carrying a `(decides: <owner>)` tag (gateway → Spec readiness → Punt ownership), include the owner token in the one-line diagnosis so the reader sees who owns the call — e.g. `FAFF-BB  [gloss] — open punt (decides: product): cron vs queue-driven send`. No grouping change: tidy surfaces punts per issue, and the tag is display metadata on the existing line.

**Order this bucket via the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**), the same as Ready — tidy states no ordering of its own. A parked issue gating a long chain tends to surface near the top, especially in autonomous runs where unblocking it lets `/faff-beep-boop` chew through the chain on the next pass.

### 4a. On hold (not automation-eligible)

Issues that are **not automation-eligible** (gateway → **Automation eligibility**) **and** otherwise notable — i.e. an explicitly-held ticket (`faff-automation-hold`), or an otherwise-ready ticket that simply hasn't been cranked up (`faff-automate`) under the opt-in default. The eligibility read that sorts an issue into (or out of) this section — and that drives the crank-up offers below — is the **live** label set from this pass's re-fetch (gateway → **Re-ground before gate**), so an issue a human just cranked up no longer surfaces as a crank-up candidate on stale labels. (Do **not** list every unlabelled backlog ticket — under opt-in that's most of the backlog; scope this to held tickets + would-be-ready-but-not-cranked-up ones.) **Distinct from "Stuck in prep":** parked work is automation-blocked (it tried and stopped); these are human-blocked pre-emptively, with no auto-clear. The job of this section is to keep held-back work visible **and** give the human a basis to decide *what to crank up* — not just a list of ids.

**Render each held issue with the shared On-hold-entry form** — `rendering_adaptor` slot → **Canonical visual forms → (f) On-hold entry** (default `faffidavit-rendering`). That single shared form is the canonical definition; `/faff-wtf` §4b renders the same form, so the two stay DRY — do not re-specify the fields here. It carries, per held issue: the grounded synthesis gloss, then the three release-decision signals (**reversibility tier** — coarse/advisory `low-risk` / `higher-risk` from the gateway side-effect-outside-PR taxonomy · **standalone-ness** — `independent` / `blocks N` / `blocked by N` from the relation graph · **unlock value** — `unlocks N` direct+transitive dependents), then the hold reason + how to release. The signals are mechanical reads of state tidy already pulls fresh (the relation graph, the chainable-unlock metric — an objective graph fact).

**Order the section via the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**) over the held issues — tidy states no risk/unlock ordering of its own; the methodology decides (the thematic default surfaces the best release candidates first). The On-hold-entry signals (reversibility tier, blocks-N, unlock-N) still render as objective facts.

**Crank-up-set proposals (rendered when a `methodology` slot answers `crank-up-set`).** After the flat On-hold list, request the `crank-up-set` output from the configured methodology (gateway → **The `methodology` slot**) and render the ranked batches as cards — the **root** via the On-hold-entry form + the **slice** via the value-chain arrow render (`rendering_adaptor`), with per-member badges (would-build / would-need-prep / would-still-need-decision from `faff next --if-eligible`), the hypothetical-verdict distribution one-liner, the stop-reason, and deferred-with-reason members. **Omit** when no methodology is configured / no not-eligible items / no qualifying root (degrades to the flat list above).

**Interactive batch crank-up (per crank-up-set card).** In **interactive** tidy, end each Crank-up-set card with a single confirm: **"Crank up this set (N items) for the next drain? (y/n)"** — listing every member explicitly first, defaulting to the **smallest coherent slice** (extending depth is an explicit opt-in). On `y`, the crank-up is **advisory (FAFF-218)** — the eligibility labels are tracker-owned (the faff CLI refuses to write them), so **list exactly the listed members and tell the human to add `faff-automate` to each in the tracker** (one click per item on the board); faff runs no `faff label` write. On `n`, nothing changes. **Do not auto-promote** — members become automation-eligible and a subsequent `/faff-beep-boop` drains them prep→build (zero pipeline changes). Log the approved set + stop-reason + members to `.faff/runs/<run-id>/` for the calibration loop. **Human-gated at every appetite, including `full`** — autonomous tidy, `/faff-wtf`, and `/faff-beep-boop` never crank up from this flow; appetite tunes which sets are *proposed* (the `crank-up-set` output), never this gate. This batches the existing single crank-up below; it changes nothing about beep-boop's eligibility-exclusion or the gateway invariant that *a not-eligible issue can never reach the build queue*.

**Interactive tidy** also offers single crank-up (outside a proposal card): "Make any of these automation-eligible? (pick / none)" — on confirm, the action is **advisory (FAFF-218)**: tell the human to **add `faff-automate` to each chosen issue in the tracker** (one click on the board) — faff never runs `faff label` for it (the CLI refuses); for an explicitly-held ticket, removing its `faff-automation-hold` in the tracker is the separate hard-stop control. Either way the issue rejoins normal eligibility next pass; it is **not** auto-promoted. **Autonomous tidy only lists — it never cranks up or lifts** (eligibility is always human-gated; gateway → **Automation eligibility**).

tidy's crank-up and `/faff-jot ISSUE-XX`'s crank up/crank down are **complementary entry points to the same `faff-automate` eligibility primitive**: tidy is the **grooming-batch** entry ("crank up across the On-hold items I'm reviewing"); jot is the **ticket-centric** entry ("crank up/crank down *this* named ticket"). Both human-gated, no canonical-owner conflict. See `faff-jot` → **Existing-ticket interactor**.

### 5. Structural diagnostics

A separate pass that examines the **shape of the backlog itself**, not individual issues. Request the `backlog-diagnostics` output from the configured methodology skill (default `faffter-noon-methodology-thematic`) — it detects the categories of structural problem and applies the mechanical fixes where the resolution is unambiguous. See that output for the full definitions and fix rules, and gateway → **Automation-routing verdict (fixed)** (the root-cause class enum) for the shared park-classification taxonomy it uses.

Categories detected:

- **Dependency cycles** — blocker graph cycles of any length, computed over the full active-issue graph (Tarjan / DFS-with-coloring).
- **Ghost-project pointers** — issue specs or descriptions naming a tracker container (project, initiative, milestone) that does not exist.
- **Repeat-park patterns** — active issues parked 3+ times in the last 21 days with the same root-cause class.
- **Splittable specs** — specs that cover two structurally independent concerns, each a valid ticket-sized unit. Restricted to specs already flagged stale/challenged — do not sweep every spec every run.
- **Chain gaps** — any active ticket whose spec's implementation advice references work no ticket tracks, breaking the chain from current state to fulfilling the spec's purpose. Four sub-types: **sub-ticket gap** (umbrella's enumerated deliverables un-ticketed; `/faff-graft` has nothing to pick up to advance the umbrella), **upstream gap** (spec names a prerequisite that has no ticket — "blocked by X", "needs Y first", "assumes Z has shipped"), **downstream gap** (spec names follow-up work that has no ticket — "subsequent PR will...", "leaves W for later", "after this, wire up V"), **peer gap** (spec implementation advice describes parallel work that must also happen but has no ticket — consumer wire-up, integration changes, related refactor). The most insidious failure: a tidy that reports a clean queue while the active-ticket graph can't actually deliver on the specs sitting in front of it because some piece of the implied work isn't ticketed. Run this every pass — every tidy invocation must independently check chain reachability for every active ticket, regardless of what the previous pass found. Detection is conservative: skip unitary specs with no external references, skip when an actionable next-step exists, skip illustrative references, skip explicitly-disclaimed "future work — not ticketed by design". Cross-reference: complements delivery-methodology principle 6 (hidden deps), which catches the inverse — referenced work that *does* have a ticket but is missing a declared blocker link.
- **Orphaned + repeat-parked** — cross-reference of orphaned-by-cascade with repeat-park; the combination is a strong "is this still wanted?" signal.

Also computes the **automation-routing verdict** (see gateway → **Automation-routing verdict (fixed)**) for every Todo+spec'd issue and writes it to `.faff/runs/<run-id>/automation-verdicts.md` (full pipeline) or `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` (standalone). Other sub-skills (`/faff-wtf`, `/faff-beep-boop`) read this file rather than recomputing within the same pass.

Level-2 mechanical fixes (auto-applied in autonomous; offered in interactive):

| Detection | Mechanical fix |
|---|---|
| Cycle with one defensive-not-load-bearing edge | Strip the defensive edge; log cycle, stripped edge, reasoning |
| Ghost-project pointer with clear name-match to existing container | Repoint to existing container; log the move |
| Repeat-park (3+ same root-cause), issue still in Todo | Demote to Backlog; tag `repeat-parked` (or tracker equivalent); log the demotion |

Surface-only by default — **except chain gaps**, whose auto-create is governed by the `appetite` dial (see the Chain gaps entry):

- **Splittable specs** — interactive: surface the spec (with the two independent concerns) for the human to split manually — there is **no auto-split command**; autonomous: log only
- **Chain gaps** — auto-create vs surface is governed by the `appetite` dial (gateway → **Appetite for destruction**, chain-gap row): **`high` (default) and `full` auto-create** every *identifiable* gap with no methodology required; `medium` auto-creates only when an opinionated methodology (e.g. agile) is configured; `low` surfaces only. When **surfacing** (low appetite, or the ambiguity downgrade below): interactive offers to file the missing sub-ticket(s) for sub-ticket gaps and "file gap issue" for upstream / downstream / peer; autonomous logs only. When **auto-creating** in **autonomous** mode (chokepoint #2 — autonomous-by-construction), each gap first passes `autonomous_file_check` (single-sourced at `/faff-beep-boop` → _Containment at the filing chokepoint_ — do not restate it) **before** the create: the **mandate is the active ticket the gap was detected against** (chain-gap detection runs per active ticket); the intended parent comes from the sub-type (sub-ticket → the umbrella; upstream/downstream/peer → the linked ticket — a prerequisite that belongs to no existing subtree is the `--root`/outward case). Fetch that parent's ancestry **fresh** and call `faff contain`. `contained` → fall through to the per-sub-type create below. `outward` (exit 3) → **create nothing at any appetite including `full`** (the hard floor); instead record a `DiscoveredScopeEntry { containment: "outward-new-root" }`, surface it for `/faff-wtf` §4, and comment on the mandate (the active ticket). Interactive auto-create needs no check — the human present is the sanction. When **auto-creating** (post-`contained`), file per sub-type, in both interactive and autonomous runs:
  - **Sub-ticket gap:** one Backlog sub-ticket per un-ticketed deliverable on the parent.
  - **Upstream gap:** one Backlog ticket for the prerequisite + add a blocker link from the active ticket to it.
  - **Downstream gap:** one Backlog ticket for the follow-up + link it as "blocked-by" the active ticket.
  - **Peer gap:** one Backlog ticket for the parallel work in the same workstream / under the same parent (if applicable).

  All created tickets: title derived from the spec reference line, description = the referenced prose + back-link to the source ticket, status `Backlog`, tag `faff-chain-gap-fill` via `faff label add <issue> faff-chain-gap-fill` and its descriptor's write (gateway → **Control-label provisioning**) so `/faff-prep`'s next queue pass picks them up. **In autonomous mode, stamp `initiated: autonomous`** on the create (`faff intake-record <new> --via jot --initiated autonomous`, FAFF-220). Log every created ticket id + sub-type + source spec line + relationship target (parent / blocker / blocked-by / sibling). Downgrade to surface-only when the reference is ambiguous (no clear deliverable per line, no nameable target for the relationship, prose-y rather than action-verb-led) — auto-creating phantom tickets is expensive to clean up.
- **Orphaned + repeat-parked** — surface only (cancelling is destructive; always human)

Output rendered in the new `### Structural diagnostics` section of tidy's output (see Output format below).

#### Splittable specs

Splittable-spec detection is the one structural diagnostic that is genuine LLM inspection (not a graph/history fact): it reads a spec and judges whether it covers two structurally independent concerns. The criteria the judgement applies:

- **Splittable specs** — specs that cover two structurally independent concerns, each a valid ticket-sized unit. Restricted to specs already flagged stale/challenged — do not sweep every spec every run.

The eval harness reads this sub-section verbatim — between the `#### Splittable specs` heading and the next `### ` heading — so the splittable eval measures the shipped criteria, not an improvised rubric.

#### Chain gaps

Chain-gap detection's prose-parsing half is genuine LLM inspection (the graph-traversal half — does a matching ticket exist — is deterministic). It reads an active ticket's implementation-advice prose and identifies references to work no ticket tracks, then classifies and skips. The criteria the judgement applies:

- **Identify** references in the implementation-advice prose — work the spec names but doesn't necessarily ticket.
- **Classify** each reference by its prose markers into exactly one sub-type:
  - **upstream** — a prerequisite ("blocked by X", "needs Y first", "assumes Z has shipped", "depends on", "prerequisite").
  - **downstream** — follow-up work ("subsequent PR will…", "leaves W for later", "after this, wire up V", "follow-up ticket", "next phase").
  - **peer** — parallel work that must also happen for the change to be useful ("consumer-side changes in X", "also needs Y in the same workstream", "integration changes in service Z", "related refactor").
  - **sub-ticket** — an umbrella's enumerated remaining deliverables (multi-PR, multi-phase, "PR 1 / PR 2", "Step N of M", numbered lists with PR-shaped action verbs) with no sub-ticket for the next deliverable.
- **Conservative skips** — do NOT flag a reference that is: illustrative-only (not load-bearing); explicitly disclaimed ("future work — not ticketed by design"); in scope for the current PR; or a unitary spec with no external reference. Emit `[]` when no real gap remains after skips.

The eval harness reads this sub-section verbatim — between the `#### Chain gaps` heading and the next `### ` heading — so the chain-gap eval measures the shipped criteria, not an improvised rubric.

### 6. Calibration signals

Read `.faff/calibration/` at end of every tidy pass. See gateway → **Autonomous Mode Contract → Calibration log** for the capture points and the immutability invariant.

Surface signals when threshold crossed (≥4 events of the same root-cause class in the last 14 days):

> _Calibration signal:_ Your autonomous mode parked 4 issues in the last 14 days flagged `needs-decision-first` on `Punt: pino vs winston`. All 4 completed interactively without questions. The codebase has used pino since SHF-92 shipped (3 months ago). Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to update their specs with `Chosen: pino`, or (c) ignore — no change.

Signals are **advisory only**. Tidy never auto-applies rule changes based on calibration data — the user (or future spec iterations) reads the signal and decides whether to act.

### 7. Methodology findings (rendered only when a `methodology` skill is configured)

Request the `backlog-diagnostics` output from the configured methodology skill, passing the backlog state. The methodology decides which categories to detect and how; faff-tidy renders the findings it returns. Surface-only in 2a — no mechanical fixes auto-applied; every finding is surfaced for human action.

Each finding renders its full diagnosis (what's there / why it's a problem / what to do) as the methodology returns it. The 2b spec adds mechanical fixes (auto-rename, auto-split, auto-regroup, file gap issues).

Output rendered in the new `### Methodology findings` section of tidy's output (see Output format below). Skip the entire bucket 7 if no `methodology` skill is configured.

### 8. State coherence (container status follows its children)

tidy is the **write counterpart to read-only `/faff-map`**: it owns the orchestrator lane's **state-coherence grooming** — reconciling a container's status when it makes no sense against its children. (`/faff-map` reports and never mutates; a build only ever writes its own issue's claim/ship. This sweep is initiated **only** from tidy, never map, never a build.) The transition is **derived from child state, forward-only, monotonic, and trivially human-reversible** — bookkeeping, not a judgement call.

Decide each transition with the pure **`faff project-next`** predicate (gateway → resolving the `faff` executable; **no tracker access** — tidy supplies the rollup, the CLI returns the move). Per active **container** — a project, or a **parent issue** with sub-issues:

1. **Build the child rollup** over the container's children (ADR 0012 `containerParent` membership; **exclude cancelled/archived** per the shared rule): `total` = remaining children · `active` = In Progress + In Review · `done` = Done/Completed.
2. **Map the container's native status → category**: `planned` (Backlog/Planned/Todo) · `started` (In Progress) · `completed` (Done) · `cancelled`.
3. **Call** `faff project-next --current <category> --kind <project|issue> --total N --active N --done N [--has-dod]`. Pass `--has-dod` for a **project that carries a release-gate/DoD** (FAFF-245) — the predicate then **defers** its Done to FAFF-259 (the DoD-gated Done is a deliverable-shippable *judgement*, out of scope here). Omit it for a no-DoD project (children-done → Done coherence is the default).
4. **On `action: advance`** — **re-read the container's live status immediately before writing** (multi-orchestrator safety; mirror graft's live-status re-read), then apply the new status via the tracker MCP (`save_project` for a project, `save_issue` for a parent issue). The write is idempotent and forward-only, so a re-run / concurrent sweep converges. A **failed MCP write** is an unexpected-state condition — handle it per the shared autonomous contract (log + continue, never abort the whole sweep on one container); the next pass retries (the transition is still derivable). **On `action: noop`** — do nothing. **On a `{error}` verdict** (an unmapped native status) — the predicate fail-closes (exit 2, no transition); skip the container and log, never guess a category.

v1 transitions (all the predicate ever emits): project → **In Progress** when a first child starts · **parent issue → In Progress** when any child is in progress · project → **Done** when **all** children are Done **and** the project has **no** DoD. The predicate's forward-only guard means a container is **never** moved backward — a quiet or cancelled child never un-starts a container, and a `completed`/`cancelled` container is terminal. In **git-only mode** there are no containers to reconcile — the sweep is a no-op.

**Autonomous** applies advances without prompting (it is reversible, child-derived bookkeeping reflecting already-authorised work); **interactive** offers them (see Output and chaining). Log every applied transition (`container id, kind, current→desired, reason`) to the tidy log.

**On-demand `prdr-author` (L3 propose-for-approval, interactive only).** A project with **no DoD/PRDR** (`--has-dod` would be absent — no FAFF-245 record under it) is the grooming-time home for the **on-demand** authoring call-site (gateway → **The `methodology` slot**, `prdr-author`). When a `methodology` slot is configured, tidy **offers** to propose one: request the methodology's **`prdr-author`** with the project's `{outcome, child_specs, target}` (`target` resolves `explicit > inherited > methodology-default`), which writes the `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`, then surface the proposed `## Definition of done` and gate — "Project <p> has no DoD. Propose one (target: <t>)? (propose / skip)". Like the crank-up offers, this is **advisory + human-gated**: on `propose`, tidy authors the `Proposed` PRDR and tells the human to flip `Status: Accepted` in the tracker (tidy never self-Accepts — that is FAFF-255's human gesture). A **pre-existing human-set DoD is never clobbered** (re-read first — gateway → **Manual changes are authoritative (`prdr-author`)**). **Autonomous tidy only lists DoD-less projects — it never proposes or admits** (admission is human-gated at L3; the L4 lights-out runner self-admits via `faff prdr admit`, not tidy). Skip the offer entirely when no methodology is configured **or** the configured methodology does not answer `prdr-author` (the Optional output's graceful degradation — gateway → **The `methodology` slot**): no proposal is made and the human authors the DoD directly.

## Output and chaining

All human-facing output tidy emits — its terminal buckets, the chain-gap tickets it files, and the park comments it writes — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule), so enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule). The table-vs-definition-list rule is part of that pass.

Present findings grouped by bucket. Skip any bucket with no findings.

Output renders three new sections in addition to the existing buckets:

- `### Structural diagnostics` — present when the methodology slot's `backlog-diagnostics` output found anything. Format follows the `rendering_adaptor` slot (default `faffidavit-rendering`). Skip if no findings.
- `### Calibration signals` — present when threshold-crossing patterns were found in `.faff/calibration/`. Skip if no signals.
- `### Methodology findings` — present only when a `methodology` skill is configured **and** bucket 7 surfaced anything. Lists the findings the methodology returned, each with its full diagnosis. No auto-actions; the human reads, decides, acts.

All three sections precede the existing buckets in tidy's output.

After presenting, drive action via yes/no gates (never passive suggestions):

- **Mess fixes:** "Apply the recommended actions for the mess? (y/n, or 'pick' to choose per issue)". On confirm, apply them.
- **Stuck-in-prep → resolve:** "N issues are parked waiting on a human decision, ordered by the methodology's `pick-ordering`. Walk through them now? (y/n, or 'pick')". On confirm, present each with its park reason and the decision being asked, then offer to remove the park label / re-run `/faff-prep` once the human commits to a direction.
- **Almost-ready → prep:** "N issues are almost ready — missing a spec. Run `/faff-prep` on all / pick some / skip? (all/pick/skip)". On `all` or `pick`, invoke the `faff-prep` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**) for the chosen issues.
- **Ready → promote:** "N issues are ready for Todo, ordered by the methodology's `pick-ordering`. Promote all / pick some / skip? (all/pick/skip)". On confirm, move them.
- **After promotion → build:** "Start building one of these now via `/faff-graft`? (y/n)". On confirm, ask which (default to the top of the methodology's `pick-ordering`) and invoke.
- **Structural diagnostics found cycles or ghost pointers (mechanical fixes auto-applied):** "Auto-applied N mechanical fixes (M cycles stripped, K ghost pointers repointed, L repeat-parks demoted). Review the log? (y/n)" — on confirm, print the structural-diagnostics findings + log path.
- **Structural diagnostics surfaced splittable specs:** "N specs look splittable (each covers two independent concerns). Review them now? (y/n, or 'pick')". On confirm, present each with the two concerns the diagnostic identified so the human can split it — re-prep it, or file separate tickets. faff does **not** auto-split: splitting a spec is a human judgement call, so this gate surfaces and recommends, it never carves automatically.
- **Structural diagnostics surfaced chain gaps (low appetite, or ambiguous references):** "N chain gap(s) across M ticket(s) — spec'd work no ticket tracks (sub-ticket / upstream / downstream / peer). Walk through them now? (y/n, or 'pick')". On confirm, present each with: the active ticket, sub-type, referenced work, what's covered (sub-ticket gaps only), what's un-ticketed, and the recommended action. Offer to file the missing sub-ticket(s) for sub-ticket gaps; offer "file gap issue" for upstream / downstream / peer (creates a Backlog ticket with the appropriate relationship — blocker / blocked-by / sibling — to the active ticket).
- **Structural diagnostics auto-created chain-gap tickets (`high`/`full` appetite, or `medium` with an opinionated methodology):** "Auto-created N ticket(s) to fill chain gaps across M active ticket(s) (e.g. SHF-AA: 5 sub-ticket-gap deliverables → 5 Backlog sub-tickets; SHF-CC: upstream prereq created + blocker link). Review the log? (y/n)" — on confirm, print the chain-gap findings + the created-ticket list (id, sub-type, source spec line, relationship target) + log path. In autonomous mode the auto-create runs without a gate; this gate is interactive-only post-action confirmation.
- **Calibration signal threshold crossed:** "N calibration signal(s) surfaced. Show details? (y/n)" — on confirm, print the signal block(s) with the recommended actions.
- **Methodology findings (surface-only in 2a):** "N methodology findings surfaced. Walk through them now? (y/n, or 'pick')". On confirm, present each with its diagnosis and the recommended action — the human applies the fix (rename, split, regroup, link). No auto-actions in 2a.
- **State-coherence transitions (bucket 8):** "N container(s) are out of step with their children (e.g. PROJ-X → In Progress: first child started; PROJ-Y → Done: all children done, no DoD). Apply the forward-only transitions? (y/n, or 'pick')". On confirm, re-read each container's live status and apply via the tracker MCP. (Autonomous applies these without a gate; this gate is interactive-only.)

Every chain point is an explicit gate. No "you should run" language.

## Autonomous Mode

When invoked autonomously (e.g. by `/faff-beep-boop` in its default full-pipeline mode), follow the shared autonomous contract (see the sibling `faff/SKILL.md`) and these specifics:

**Not-eligible issues are exempt from autonomous mutation (gateway → Automation eligibility).** Before any auto-action or prep-queue tagging below, skip issues that are **not automation-eligible** (no `faff-automate` under opt-in, or a `faff-automation-hold`): do **not** tag them `stale-spec`/`superseded-spec` (that feeds `/faff-beep-boop`'s prep queue), do **not** promote them to Todo, and do **not** auto-change eligibility labels (crank-up is human-gated — only interactive tidy cranks up, see the On hold section). Mechanical housekeeping that doesn't enter the autonomous pipeline still applies and must **preserve** eligibility — e.g. an auto-reparented not-eligible issue stays not-eligible.

**Autonomous tidy never silently restructures human-curated structure (gateway → Human curation is authoritative, assertion 3).** Its auto-actions are confined to its **own** housekeeping — stale faff-labels, dead references to cancelled/archived issues, and *obvious* orphans (a sub-issue whose parent is Done/Cancelled/Archived). It never autonomously re-prioritises, re-sequences, re-groups, or re-parents structure a human curated, and never cancels/deletes (the appetite hard floor). Anything beyond its own housekeeping is **surfaced for human decision** (propose-and-confirm), not auto-applied.

**Auto-actions (applied without prompting):**
- **Auto-strip dead references to cancelled/archived issues.** For every active issue, remove any link — blocker, blockedBy, parent, sub-issue, related, dependency — pointing at a cancelled or archived issue. This is mechanical and always safe; a cancelled issue cannot block or depend on anything. Post a single consolidated tracker comment per cascade (e.g. "After SHF-114 was cancelled, stripped blocker references from SHF-115/116/117/118/119"). Log every stripped link with the active issue id, the dead target id, and the link type.
- **Auto-canonicalise overlooked specs.** When the **Spec discovery** rule finds a spec in a non-canonical location (old comment thread, stale branch, unlinked document), copy it to the canonical location — tracker comment on the issue, or the configured spec-docs path (default `docs/specs/…`) if a feature branch exists for the issue. Log the move. If an issue is in Todo with no spec at any discovery location, demote to Backlog and log as "broken prep gate — no spec found"; do not invoke `/faff-prep` from tidy (that's `/faff-beep-boop`'s prep queue job in the default full pipeline).
- **Auto-archive dead weight:** merged or cancelled issues still sitting in the backlog. Move to archive/closed state as the tracker supports.
- **Auto-reparent obvious orphans:** a sub-issue whose parent is Done, Cancelled, or Archived. Reparent to the grandparent if one exists; otherwise remove the parent link.
- **Auto-remove stale `faff-parked` labels.** Remove via `faff label remove <issue> faff-parked` and its descriptor's write (gateway → **Control-label provisioning**) in two cases:
  1. **State moved on:** issue is now In Progress, In Review, Done, Cancelled, or Archived. The label's only consumer is `/faff-wtf`; once a human has picked up, merged, or killed the issue, the label just adds noise.
  2. **Park reason no longer applies and can be cleanly verified.** Read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`. Auto-remove when exactly one of these holds:
     - The reason matches a pattern **now forbidden** by the autonomous contract (any of: session compaction, context length, too-many-turns, topic-keyword match on a spec-closed decision, edits to files that only take effect after merge like `netlify.toml` / `.github/workflows/*.yml` / `Dockerfile` / `package.json` dep bumps / IaC / migration SQL files that weren't executed pre-merge). These parks were never valid under the current rules — clear without prompting.
     - The reason cited a specific blocker issue ID and that blocker is now Done, Merged, or Cancelled — live-fetch the blocker state from the tracker, don't rely on cached data.
     - The reason cited a spec punt (`Punt:`, `needs human`, `TBD`, "or X if Y") and the spec now closes that same topic with a `Chosen:` / `Decision:` marker per the gateway Spec-readiness contract.
  3. **Do not remove** when the park reason is subjective ("architectural change needed", "scope unclear"), vague, or missing. Those are judgement calls — leave the label on and log the finding as "stale park label — needs human" for the next `/faff-wtf`.

  For every auto-removal, log the issue id, original park reason, and the specific rule that invalidated it to `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`. Post a tracker comment noting the removal and the reason.
- **Strip defensive-only edges in dep cycles.** Detected by the methodology slot's `backlog-diagnostics`. When one edge of a cycle is determined to be defensive-not-load-bearing (the spec for the parent doesn't reference the child's output), strip that edge. Log the cycle, stripped edge, and reasoning per that output's mechanical-fix rules.
- **Repoint ghost-project pointers with clear name-match.** When an issue's spec or description names a tracker container that doesn't exist, and a live container's name clearly maps to the missing reference (string proximity), repoint the issue. Log the move.
- **Demote `repeat-parked` Todos to Backlog.** When an active issue is in the methodology's `backlog-diagnostics` repeat-park set, demote from Todo to Backlog and tag with `repeat-parked` (or tracker equivalent). Logs the demotion. The issue is clearly not Todo-ready; leaving it as Todo lies to the queue. The qualifying set (parked repeatedly in the same root-cause class within the rolling window) comes from the methodology's `backlog-diagnostics`, which is now backed by the deterministic `faff park-history` seam — tidy consumes that output and does **not** re-count or call the seam itself.
- **Apply container state-coherence transitions** (bucket 8). Per active container, build the child rollup, call `faff project-next`, and apply any `advance` forward-only via the tracker MCP (re-reading live status immediately before the write). This is reversible, child-derived bookkeeping reflecting work a human already authorised by making a child eligible — not work-creation, and never a backward move (the predicate's monotonicity guard) — so it applies without prompting. A `--has-dod` project's Done is deferred (FAFF-259); parent-issue Done is out of scope. Log each applied transition. (This is the one place autonomous tidy writes *container* status; it still never re-prioritises, re-groups, or re-parents human-curated structure.)

**Prep-queue candidates (handed to `/faff-beep-boop`'s prep queue in the default full pipeline; log-only otherwise):**
- **Stale specs** — tag the issue so `/faff-beep-boop` (default full pipeline) picks it up during the prep queue drain. Prep's autonomous stale-refresh path decides the outcome: if the original design still holds → `refreshed` (stays Todo, becomes a build candidate); if an architectural change is needed → park. If prep refreshes to `confidence: high`, the issue automatically enters the build queue in the same run — a stale-spec issue can be refreshed and shipped in a single overnight pass with no human in the loop.
- **Challenged specs** — same handling as stale: tag for the prep queue, prep's autonomous stale-refresh path absorbs post-spec challenges/resolutions if non-architectural, parks if a challenge contests a core decision. Worth annotating the log with the source comments so the human (or `/faff-wtf`) can see what changed.
- **Superseded specs** — tag the issue so the prep queue picks it up as a **fresh-spec** candidate (not a refresh — the original premise is wrong). Prep's autonomous fresh-spec path gates on confidence: `confidence: high` → `promoted` (enters build queue); `medium` → `promoted-needs-review` (attached, rating retained, routes out as `needs-decision-first` for human triage); `low` → park. This is the same loop: if a high-confidence fresh spec lands, beep-boop builds it in the same run; a medium one is attached-and-surfaced, and a low one is parked for the morning.
- When tidy is invoked standalone (not as part of the default full pipeline), these become log-only — no prep queue is running to hand them to. Log as "needs refresh" / "needs refresh (challenged)" / "needs fresh-spec" so the next default `/faff-beep-boop` run or interactive `/faff-prep` picks them up.

**Log-only (no tracker changes in autonomous mode):**
- Dupes, vagueness, too broad, too big, premature, unblocked-by-done, missing deps, aging, not needed, uncategorised (mis-grouping flagged for `/faff-prep`, never as a label suggestion)
- **Orphaned-by-cascade** — active issue whose rationale depended on a now-cancelled chain — surface for human judgement on cancel / redirect, never auto-cancel
- **Descendants of cancelled ancestors** — active issues under any cancelled ancestor in the tracker hierarchy — surface for human decision (cancel / reparent / leave), never auto-cancel
- **Stuck in prep (still-valid parks)** — issues whose park label survived auto-cleanup because the park reason is subjective/judgement-bound. Log each with: issue id, park reason, priority (issue or ancestor), and chainable unlock count (objective facts). Order the log via the methodology's `pick-ordering` so `/faff-wtf` and the morning human reviewer see the highest-leverage decisions first.
- **Splittable specs** — surface only in structural mode; do not auto-split. Splitting lands when a methodology skill is configured.
- **Chain gaps** — auto-create is appetite-gated (gateway → **Appetite for destruction**, chain-gap row): at `high` (default) and `full`, auto-create every identifiable gap; at `medium`, only when an opinionated methodology is configured; at `low`, **log only** — one entry per gap with active ticket id, sub-type (sub-ticket / upstream / downstream / peer), source spec line, referenced work, and (for sub-ticket gaps) enumerated-deliverable count + covered count (sub-tickets + merged PRs by direct ref) + un-ticketed-remainder breakdown. When auto-creating: **first run `autonomous_file_check`** (chokepoint #2; single-sourced at `/faff-beep-boop` → _Containment at the filing chokepoint_) with the active ticket as mandate — `outward` (a prerequisite belonging to no existing subtree) creates nothing at any appetite including `full`, recording `containment: outward-new-root` + surfacing for `/faff-wtf` + commenting on the active ticket; `contained` proceeds to the missing ticket(s) per sub-type with the appropriate relationship — parent for sub-ticket gaps, blocker for upstream, blocked-by for downstream, sibling-in-workstream for peer. Title from the spec reference line, description = referenced prose + back-link to source ticket, status `Backlog`, tag `faff-chain-gap-fill` via `faff label add` (**Control-label provisioning**), and stamp `initiated: autonomous` (`faff intake-record <new> --via jot --initiated autonomous`). Log every created ticket id + sub-type + source spec line + relationship target + containment verdict. Downgrade to log-only when the reference is ambiguous (no clear deliverable, no nameable relationship target, prose-y rather than action-verb-led). Post one consolidated tracker comment per active ticket — example for the umbrella case: "Auto-carved 5 un-ticketed deliverables from SHF-AA's spec into sub-tickets SHF-XX/YY/ZZ/WW/VV — see chain-gap detection in `/faff-tidy` logs." Example for the cross-ticket case: "Chain-gap auto-fill on SHF-CC: created SHF-XX (upstream prereq, now blocking CC) and SHF-YY (downstream follow-up, blocked-by CC) from spec references — see `/faff-tidy` logs for sources."
- **Orphaned-by-cascade + repeat-parked combination** — strong "is this still wanted?" signal; cancelling is destructive; always surface for human.
- **Methodology-finding relation recommendations** — when a spec comment or methodology diagnosis names a recommended `blocks` / `blocked-by` relation (e.g. *"Spec recommends blocker link until SHF-X fully merges"*), tidy never auto-creates the relation. Log as a finding with: source ticket, recommended target, the verbatim recommendation text, and a current-state snapshot of the target (open / Done / Cancelled / Archived; close date if applicable). The finding surfaces in `/faff-wtf`'s next morning brief; the human reviews and creates the relation manually if still applicable.

Record each finding in `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` with the issue id, category, and recommended action. These surface in the morning via `/faff-wtf` for human review.

**Never in autonomous mode:** auto-split, auto-merge tickets, delete issues, add/remove/restructure labels (that's `/faff-prep`'s domain), change ancestor/grouping assignments, auto-cancel descendants of cancelled ancestors, or promote an issue to Todo on the strength of a description alone.

**Return to caller (beep-boop):** `{ archived: N, reparented: N, refs_stripped: N, park_labels_cleared: N, cycles_stripped: N, ghost_pointers_repointed: N, repeat_parks_demoted: N, container_transitions_applied: N, splittables_surfaced: N, chain_gaps_surfaced: { subticket: N, upstream: N, downstream: N, peer: N }, chain_gap_tickets_created: { subticket: N, upstream: N, downstream: N, peer: N }, orphaned_repeat_parked_surfaced: N, calibration_signals: N, automation_verdicts_path: .faff/runs/<run-id>/automation-verdicts.md, logged: N, findings_path: .faff/logs/… }`. `container_transitions_applied` counts bucket-8 forward-only container status writes (project/parent-issue → In Progress, project → Done where no DoD). `chain_gap_tickets_created` is non-zero when the appetite dial admits auto-create (`high`/`full`, or `medium` with an opinionated methodology); otherwise chain gaps land in `chain_gaps_surfaced`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Fix the mess first, then promote — a ready issue that's actually a dupe shouldn't get promoted
- Cancelled work is invisible to tidy except for the "non-cancelled descendants of cancelled ancestors" prompt
- Description ≠ spec. Ever.
- **Comments are mandatory** in spec discovery (gateway → **Spec discovery**): fetch them before classifying; descriptions-only is invalid output.
- Spec health is **not just** does-a-spec-exist; it includes scanning post-spec comments for challenges, resolutions, and context. Challenges/resolutions → "Challenged" → re-prep, not ready. Context-only → "Context-pending" → low-priority annotate-into-spec, doesn't block build.
- Labels are `/faff-prep`'s job. Tidy never proposes them.
- Promotion order = readiness gate → the configured methodology's `pick-ordering` (the thematic default orders by priority → chainable unlock value; gateway → **Ordering & judgement delegation**)
- The same methodology `pick-ordering` orders the "Stuck in prep — needs human decision" bucket — surface the highest-leverage parks first
- When a `methodology` slot is configured, tidy adds bucket 7 (Methodology findings) — surface-only in 2a (no mechanical fixes); 2b adds them.
