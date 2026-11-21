---
name: faff-tidy
description: "Groom the backlog: find duplicates, vague work, stale blockers and structural problems; promote ready issues to Todo. Use for tidy, clean up or groom."
judgement_seam: dupe, vague, stale, superseded, splittable, chain-gap, resolved-elsewhere
---

# Faff — Tidy

> **Next step:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-graft ISSUE-XX` to start building an issue that's prepped

Tidy the backlog. Looks both ways in one pass:

- **Down:** find the mess — dupes, vagueness, dead weight, stale specs, stale blockers, aging issues, orphans, uncategorised, splittable, blocked
- **Up:** find issues that are actually ready and promote them to Todo, are parallelisable, or done

## Configuration

**Load the kernel first.** If `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references tidy consumes: `faff/references/build.md`, `faff/references/tracker.md`, `faff/references/autonomous.md`, `faff/references/methodology.md`, `faff/references/park.md`. tidy assigns against the **fixed automation-routing contract**; its `methodology` / `routing_adaptor` slots inherit the gateway ambiently.

**Consuming-project CLAUDE.md is context.** Read the consuming project's `CLAUDE.md` (and any docs it points at) before tidying. Treat it as clues to organisation and current workstream priority — what areas the project cares about right now, what's been deprioritised, naming conventions for groupings. Use this to inform priority calls when ordering ready/promotion suggestions and to spot mis-grouping in "Uncategorised".

**Cancelled work is noise — ignore it entirely.** Do not surface cancelled entities — issues, or whatever the tracker calls higher-level groupings — in any summary, finding, or bucket. The only exception: if a **cancelled ancestor** (parent, grandparent, or any higher-level container, regardless of what the tracker calls it) still has **non-cancelled descendants**, ask the human (interactive) or log for human review (autonomous) whether those descendants should be cancelled too. Never auto-cancel.

**Never offer to add labels.** Labelling is `/faff-prep`'s job. Tidy does not suggest, apply, or chain into label changes — not for "Uncategorised", not for spec health, not anywhere. If categorisation is genuinely missing, flag the issue for `/faff-prep` instead.

**Description ≠ spec** (gateway → **Spec discovery**). A populated description is not a spec; never promote an issue to Todo on the strength of one. That's a `/faff-prep` candidate, not a ready issue.

**Resolve tracker availability first (gateway → Tracker availability resolution).** Before any discovery, resolve tracker-vs-git-only per the shared rule — honour a `tracking.tracker` pin (`faff tracker probe`), discover the connector before concluding absence, and resolve the mode **once** for this tidy pass — so a deferred-tool harness doesn't read a connected tracker as absent and skip comment-fetching wholesale.

**Comments are mandatory in spec discovery.** Per the shared rule (gateway → **Spec discovery**, "Comments are not optional"), you **must** fetch each issue's comments via the configured tracker MCP before bucketing it for spec health or readiness. Descriptions-only classification is a **broken run** that mis-classifies the common case as "needs prep". If there are too many issues to comment-fetch individually, batch-fetch or scope the run smaller; never substitute description-only sampling, and never hedge with "comments not checked": complete the discovery and re-classify before reporting.

**Methodology lens.** When a `methodology` slot is configured, tidy adds **bucket 7 (Methodology findings)** — surface-only, no auto-actions (display convention: gateway → **The `methodology` slot**).

## Always pull fresh

Every invocation re-fetches the whole active backlog live per the shared **Always pull fresh** rule (gateway): every active issue, both-direction blocker links, the comment thread on every issue being classified, status, ancestors, labels. Tidy is the **highest-stakes** case of that rule because **tidy acts**: a stale grooming pass strips a now-needed link, mis-classifies a freshly-specced issue as needs-prep, or flags a live issue as orphaned-by-cascade when it isn't. Acting on stale data is the one thing tidy must never do. Tidy's scope is **every active issue across every configured team** — the resolved team-set (`tracking.teams`, legacy `tracking.team_key` as a one-team set), fetched live per team per **Always pull fresh** — or a smaller structural scope, announced explicitly; it never inherits another skill's already-filtered surface, including `/faff-wtf`'s briefing slice, since a pre-filtered subset hides the dupes, orphans, cycles, and ghost pointers tidy exists to find. **Cycle and stale-blocker detection traverse cross-team edges** as a natural consequence of running over the one unioned graph — a blocker link between two configured teams is one edge in that graph, never split into a per-team subgraph and re-stitched.

## Process

**Tidy acts. It does not just list.** Any finding with a mechanical, unambiguous fix is applied — not reported as an observation for the human to do later. "X, Y, Z reference cancelled blocker W" is not a finding to surface; it is an instruction to strip the references. Surfacing cascading cancellations as prose in a summary, with no action taken, is the failure mode to avoid.

Query all backlog issues from the issue tracker. **Exclude cancelled and archived per the shared rule.** **For every active issue you intend to classify (spec health, almost-ready, ready), fetch its comments first** — the spec usually lives there. Fetch them leanly (gateway → **Lean tracker reads**): pass an explicit `limit` sized to the issue's thread rather than the default 50, and request no expansion the classification pass won't read. Skipping the comment fetch and falling back to descriptions invalidates the entire spec-health pass. Sort each into one of three buckets:

### 1. The mess (needs action)

- **Dupes:** Two issues covering the same work
- **Vagueness:** Issues with no clear deliverable — what even is this?
- **Too broad:** Single issues spanning multiple domains that should be split
- **Too big:** Single issues spanning too much effort that could be split
- **Premature:** Issues depending on work or decisions that don't exist yet
- **Spec health** — run the shared **Spec discovery** rule per active issue. **Note the spec comment's timestamp and scan all comments posted after it** — read them newest-first with an explicit `limit` sized to the post-spec window (gateway → **Lean tracker reads**). Classify each post-spec comment as **challenge** (questions / pushback / new constraints contradicting the spec), **resolution** (decisions that close out a Punt/Assumes/TBD in the spec), **context** (substantive info worth knowing — links, related discoveries, stakeholder notes — that doesn't challenge or resolve but should be folded into the spec as an annotation), or **noise** (status pings, "+1", unrelated chatter). Then classify the issue:
  - **Overlooked:** A spec exists but not in a canonical discovery location — e.g. draft in an old comment thread, a markdown file on a stale branch, an unlinked document. Or: the issue is in Todo (past the prep gate) but spec discovery finds nothing at all. **Action (mechanical):** move/link the spec to a canonical location (tracker comment or the configured spec-docs path, default `docs/specs/…`) so prep and graft can find it. If no spec exists anywhere but the issue is in Todo, demote the issue back to Backlog and flag for `/faff-prep` — crossing the prep gate without a discoverable spec is a broken state.
  - **Challenged:** The spec is fine on its own terms but post-spec comments contain unresolved challenges or fresh resolutions that the spec doesn't reflect — the conversation has moved on even if the codebase hasn't. **Action:** in interactive mode, surface for `/faff-prep` in refresh mode (prep's Step 2a will fold the comment-thread changes into the spec) — if closing the challenge means an architecture / scope / taste call, that resolution follows the gateway's **Interactive park resolution (surface, don't settle)** rule: surface it and hand off, don't settle it on the human's behalf. In autonomous mode, follow `/faff-prep` autonomous stale-refresh rules — refresh if the challenges/resolutions are non-architectural and absorbable; park if a challenge contests a core decision.
  - **Context-pending:** Post-spec comments contain only context items (no challenges, no resolutions) that haven't been folded into the spec yet. The spec is still buildable as-is, but the context risks getting lost between now and build. **Action:** in interactive mode, flag for `/faff-prep` in refresh mode so the context is annotated into the spec — but mark the flag as low-priority (build can proceed without it; this is a hygiene fix). In autonomous mode, log it; do not push it through the prep queue ahead of stale/challenged candidates. A context-only finding never blocks promotion to build.
  - **Stale:** Spec's design decisions no longer hold against the current codebase — deps listed in the spec have since shipped with different shapes, architecture has moved on, files the spec names have been renamed/deleted, or the spec predates a significant refactor. **Action:** in interactive mode, surface for `/faff-prep` in refresh mode — same gateway rule as Challenged: surface the redesign call, don't settle it. In autonomous mode, follow `/faff-prep` autonomous stale-refresh rules (refresh only if the original design still holds; else park).
  - **Superseded:** Another ticket has since shipped that changes the approach this spec assumes — e.g. the spec planned to extend module X, but a subsequent PR replaced X with module Y. The spec is not just stale; its premise is wrong. **Action:** flag for human re-prep or cancellation (the work may no longer be wanted, or may need a completely different plan). Do not auto-refresh — the new direction requires human judgement.
  - **Flagged (medium-confidence):** the attached spec retains a `confidence: medium` rating — prep attached it for human triage rather than auto-building (its routing verdict is `needs-decision-first`). Read the rating against the post-spec comment scan. **Action:** if the comments have since closed the spec's open `**Punt:**` items, flag for `/faff-prep --refresh` to bump the rating to `high` (it then becomes build-eligible). If the open items are still unresolved, surface it as a pending spec decision in the morning brief. A retained `medium` is **never** Ready on its own — it does not promote to a build candidate until the rating is bumped.
- **Dead references to cancelled/archived work (mechanical cleanup — strip the links).** Any active issue carrying a blocker / blockedBy / parent / sub-issue / related / dependency pointer to a cancelled or archived issue. Cancelled/archived references are dead. Action: remove the link from the active issue. Apply this mechanical cleanup in both modes. Whether the active issue itself is still wanted after cleanup is a **separate** question (see "Orphaned by cascade" below).
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
  - **State moved on:** issue is now In Review, Done, Cancelled, or Archived — the label exists so `/faff-wtf` surfaces work needing human attention, and once a human has picked it up, merged it, or killed it, the label is noise. An `In Progress` + `faff-parked` issue is the nuanced case (it is usually a live faff *mid-build park*, not a human takeover — see the autonomous rule's `faff park-verdict` narrowing); interactive tidy only **surfaces** it either way, so the distinction changes nothing here (interactive never auto-strips).
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
- **Automation-eligible** — an issue that is **not automation-eligible** (gateway → **Automation eligibility**: lacks `faff-automate`) is **never** auto-promoted to Todo, however otherwise-ready it looks. This is the **mechanical gate**, not an operator prompt: interactive tidy neither surfaces eligibility nor offers to change it. (Autonomous tidy must also not tag a not-eligible issue `stale-spec`/`superseded-spec` — see Autonomous Mode.)

**Decide readiness via `faff next`, not by re-checking these criteria by hand** (gateway → **Next-step transition**): map each issue's fetched state to the flags and consult `faff next` — `graft` ⇒ ready (promote candidate), `prep` ⇒ "Almost ready" (needs `/faff-prep`), `skip-ineligible` ⇒ **silently excluded** (the mechanical gate drops it from the promote set — no interactive surface), `needs-human`/`blocked` ⇒ not ready. The bullets above are the human-readable shape of that transition. The labels + status mapped to those flags are **sourced from the live backlog re-fetch this pass took** (gateway → **Always pull fresh** + **Re-ground before gate**) — the promote gate reads labels at the gate, never from a stale snapshot. `skip-ineligible` is `faff eligible`'s verdict; tidy runs on a fetched tracker backlog.

**Methodology transport.** Batch `pick-ordering`, `backlog-diagnostics` and `promotion-readiness` per pass. Request `prdr-author` separately per project. Follow **Transport (per-output dispatch grain)** in `faff/references/methodology.md`.

**Order ready issues via the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**) — tidy states no ordering of its own; it renders the order the methodology returns (the thematic default supplies priority + chainable unlock value when no methodology is set). Present ready issues in that order so the human (or `/faff-beep-boop`) picks up the right thing first.

### 3. Almost ready (flag)

Issues that are close but need one small thing — a blocker that's still In Progress, one unresolved question, an unclear acceptance criterion, **or solid info in the description but no spec in any canonical discovery location** (description alone never counts — those go here, for `/faff-prep`).

### 4. Stuck in prep — needs human decision

Issues currently carrying the `faff-parked` label (or tracker equivalent) where the park is **still valid** — i.e. the autonomous-mode auto-removal rules above did **not** clear it, because the park reason is genuinely subjective or judgement-bound: an architectural call to make, scope to decide, a punt the spec didn't close, an explicit "needs human" marker. These are real blockers on a human, not noise.

For each, read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md` and surface it concisely so the human knows what decision is being asked of them. When the blocker is an open `**Punt:**` carrying a `(decides: <owner>)` tag (gateway → Spec readiness → Punt ownership), include the owner token in the one-line diagnosis so the reader sees who owns the call — e.g. `ISSUE-BB  [gloss] — open punt (decides: product): cron vs queue-driven send`. No grouping change: tidy surfaces punts per issue, and the tag is display metadata on the existing line. Surfacing here is the whole job — if the human then asks tidy (or a follow-up `/faff-prep`) to resolve the park, the gateway's **Interactive park resolution (surface, don't settle)** rule governs: the agent surfaces the decision and may recommend, it does not author the settled call itself.

**Order this bucket via the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**), the same as Ready — tidy states no ordering of its own. A parked issue gating a long chain tends to surface near the top, especially in autonomous runs where unblocking it lets `/faff-beep-boop` chew through the chain on the next pass.

### 5. Structural diagnostics

Inspect backlog structure using the single `backlog-diagnostics` result from batched **Methodology transport** (default `faffter-noon-methodology-thematic`). Share it with surface-only pass 2a. Use its category definitions and fix rules, and the root-cause classes in gateway → **Automation-routing verdict (fixed)**. Apply only unambiguous mechanical fixes.

Categories detected:

- **Dependency cycles** from the shared structural floor.
- **Ghost-project pointers** — issue specs or descriptions naming a tracker container (project, initiative, milestone) that does not exist.
- **Repeat-park patterns** — active issues parked 3+ times in the last 21 days with the same root-cause class.
- **Splittable specs** — specs that cover two structurally independent concerns, each a valid ticket-sized unit. Restricted to specs already flagged stale/challenged — do not sweep every spec every run.
- **Chain gaps** — any active ticket whose spec's implementation advice references work no ticket tracks, breaking the chain from current state to fulfilling the spec's purpose. Four sub-types: **sub-ticket gap** (umbrella's enumerated deliverables un-ticketed; `/faff-graft` has nothing to pick up to advance the umbrella), **upstream gap** (spec names a prerequisite that has no ticket — "blocked by X", "needs Y first", "assumes Z has shipped"), **downstream gap** (spec names follow-up work that has no ticket — "subsequent PR will...", "leaves W for later", "after this, wire up V"), **peer gap** (spec implementation advice describes parallel work that must also happen but has no ticket — consumer wire-up, integration changes, related refactor). The most insidious failure: a tidy that reports a clean queue while the active-ticket graph can't actually deliver on the specs sitting in front of it because some piece of the implied work isn't ticketed. Run this every pass — every tidy invocation must independently check chain reachability for every active ticket, regardless of what the previous pass found. Detection is conservative: skip unitary specs with no external references, skip when an actionable next-step exists, skip illustrative references, skip explicitly-disclaimed "future work — not ticketed by design". Cross-reference: complements delivery-methodology principle 6 (hidden deps), which catches the inverse — referenced work that *does* have a ticket but is missing a declared blocker link.
- **Orphaned + repeat-parked** — cross-reference of orphaned-by-cascade with repeat-park; the combination is a strong "is this still wanted?" signal.
- **Resolved-elsewhere finding-tickets** — an open finding-ticket (one whose description carries a findings-log anchor, e.g. `.faff/logs/…-findings.md` + `finding F<n>`) whose fix appears to have already merged under a *different* ticket number. The pass: (1) assemble a **fix corpus** from the fetched Done/merged tickets + their linked PRs + committed specs under the spec-docs path, annotating each with its anchors, cited ticket-ids, and text; (2) pipe `{ finding_tickets, fix_corpus }` to **`faff findings-reconcile`** (the pure correlation CLI — anchor co-reference + tracker/citation relation, self-reference guard, `strong`/`weak` per the merged-deterministic rule; exit 2 → log the fault and skip this category for the pass, never a silent empty result); (3) for findings the helper did **not** mark `strong`, apply **symptom-similarity** (the LLM judgement — see the `#### Resolved-elsewhere` criteria below), which only ever yields `weak` advisory evidence.

For every Todo+spec'd issue, compute the verdict per gateway → **Automation-routing verdict (fixed)**. Write `.faff/runs/<run-id>/automation-verdicts.md` (full pipeline) or `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` (standalone). Within this pass, `/faff-wtf` and `/faff-beep-boop` read that file without recomputing.

Level-2 mechanical fixes (auto-applied in autonomous; offered in interactive):

| Detection | Mechanical fix |
|---|---|
| Cycle with one defensive-not-load-bearing edge | Strip the defensive edge; log cycle, stripped edge, reasoning |
| Ghost-project pointer with clear name-match to existing container | Repoint to existing container; log the move |
| Repeat-park (3+ same root-cause), issue still in Todo | Demote to Backlog; tag `faff-parked` (via the single-select state-group verb `faff label transition <issue> parked --present-label <each state label currently on the issue>` and its descriptor's write, gateway → **Control-label provisioning** — `faff-parked` is what removes the issue from the pool, and the transition clears any other state-group label first); post a park comment per the Park protocol with a demotion-specific reason (root-cause class + count over the rolling 21-day window); log the demotion |

Surface-only by default — **except chain gaps**, whose auto-create is governed by the `appetite` dial (see the Chain gaps entry):

- **Splittable specs** — interactive: surface the spec (with the two independent concerns) for the human to split manually — there is **no auto-split command**; autonomous: log only
- **Chain gaps** — auto-create vs surface is governed by the `appetite` dial (gateway → **Appetite for destruction**, chain-gap row): **`high` (default) and `full` auto-create** every *identifiable* gap with no methodology required; `medium` auto-creates only when an opinionated methodology (e.g. agile) is configured; `low` surfaces only. When **surfacing** (low appetite, or the ambiguity downgrade below): interactive offers to file the missing sub-ticket(s) for sub-ticket gaps and "file gap issue" for upstream / downstream / peer; autonomous logs only. Autonomous creates require the shared plan at `/faff-beep-boop` → **Containment at the filing chokepoint** (`--phase tidy` with a run, omit recording standalone). Use the active ticket as mandate and the sub-type's intended parent. A `may-file` plan permits dedup and the proposed create only. A self-intake proposal uses its own lane without `faff-automate`. Surface `outward-new-root` for wtf, record that containment and comment on the mandate. Interactive creates retain human sanction. When **auto-creating** (post-`contained`), file per sub-type, in both interactive and autonomous runs:
  - **Sub-ticket gap:** one Backlog sub-ticket per un-ticketed deliverable on the parent. (`--relationship parent`, below.)
  - **Upstream gap:** one Backlog ticket for the prerequisite + add a blocker link from the active ticket to it. (`--relationship blocker`.)
  - **Downstream gap:** one Backlog ticket for the follow-up + link it as "blocked-by" the active ticket. (`--relationship blocked-by`.)
  - **Peer gap:** one Backlog ticket for the parallel work in the same workstream / under the same parent (if applicable). (`--relationship peer`.)

  All created tickets: title derived from the spec reference line, description = the referenced prose + back-link to the source ticket, status `Backlog` so `/faff-prep`'s next queue pass picks them up. **In autonomous mode, stamp `initiated: autonomous`** on the create (`faff intake-record <new> --via jot --initiated autonomous`). After the MCP acknowledges each create, log its id, sub-type, source spec line, relationship target and priority. Downgrade to surface-only when the reference is ambiguous (no clear deliverable per line, no nameable target for the relationship, prose-y rather than action-verb-led) — auto-creating phantom tickets is expensive to clean up.

  - **Priority:** for every sub-type above, derive `--relationship` per the parenthetical and call `faff discovered-scope-priority --relationship <that value> --source chain-gap` (chain-gap items never carry `--gate-defect` — they're derived from spec prose, not a build/review/orchestrator-time gate judgement) — net result: upstream High, downstream/sub-ticket Medium, peer Low. Set the tracker priority and post the fixed-shape reason comment per `/faff-graft` → _Discovered scope_ → **The priority-reason comment** (do not restate it), attributed to `/faff-tidy`, in the same create that sets status/relationship/provenance. A CLI failure degrades to no tracker priority + no comment, logged, never a guess.
- **Orphaned + repeat-parked** — surface only (cancelling is destructive; always human)
- **Resolved-elsewhere finding-tickets** — **surface only, both modes, every appetite** (write authority is a deliberate slice boundary). Render `strong` and `weak` candidates as separate sub-lists, each with its evidence (fix refs + kind + merged flag) and a pointer to the settled disposition convention: close **Done with a comment trail, never Duplicate** — case 1 (fix shipped under the finding's own decomposition: deliverable → resolver → PR/SHA table) or case 2 (unrelated resolver: resolver + PR + SHA, relationship stated, verification evidence cited) — naming which case applies when determinable. Nothing is auto-closed or cancelled.

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

#### Resolved-elsewhere

The symptom-similarity layer of the resolved-elsewhere diagnostic is genuine LLM inspection (the anchor/citation half is `faff findings-reconcile` — deterministic). It runs only over finding-tickets the helper did **not** already mark `strong`, comparing the finding's symptom text (title + description) against the merged-fix corpus. The criteria the judgement applies:

- **Match** a finding to a merged fix only on a clear semantic correspondence — the same defect mechanism and the same surface (module/subsystem/behaviour), not merely the same topic area. Two distinct bugs in one subsystem are NOT a match.
- **Evidence produced is always `symptom-similarity` kind and the candidate is always `weak`** — advisory, rendered in the separate weak sub-list, never promoted to `strong` (only deterministic evidence with a merged fix does that).
- **Conservative skips** — do NOT match on: shared vocabulary alone (both mention "budget" or "worktree"); a fix that addresses a neighbouring symptom but a different root cause; or any fix that is not actually merged. Emit no match when unsure — a missed weak candidate costs nothing (the deterministic core still fires); a phantom match wastes human review.

The eval harness reads this sub-section verbatim — between the `#### Resolved-elsewhere` heading and the next `### ` heading — so the resolved-elsewhere eval measures the shipped criteria, not an improvised rubric.

### 6. Calibration signals

Read `.faff/calibration/` at end of every tidy pass. See gateway → **Autonomous Mode Contract → Calibration log** for the capture points and the immutability invariant.

Surface signals when threshold crossed (≥4 events of the same root-cause class in the last 14 days):

> _Calibration signal:_ Your autonomous mode parked 4 issues in the last 14 days flagged `needs-decision-first` on `Punt: pino vs winston`. All 4 completed interactively without questions. The codebase has used pino since SHF-92 shipped (3 months ago). Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to update their specs with `Chosen: pino`, or (c) ignore — no change.

Signals are **advisory only**. Tidy never auto-applies rule changes based on calibration data — the user (or future spec iterations) reads the signal and decides whether to act.

### 7. Methodology findings (rendered only when a `methodology` skill is configured)

Consume the **same** pass `backlog-diagnostics` result — the single batched request (**Methodology transport** above), not a second dispatch — passing the backlog state. The methodology decides which categories to detect and how; faff-tidy renders the findings it returns. Surface-only in 2a — no mechanical fixes auto-applied; every finding is surfaced for human action.

Each finding renders its full diagnosis (what's there / why it's a problem / what to do) as the methodology returns it. The 2b spec adds mechanical fixes (auto-rename, auto-split, auto-regroup, file gap issues).

Output rendered in the new `### Methodology findings` section of tidy's output (see Output format below). Skip the entire bucket 7 if no `methodology` skill is configured.

### 8. State coherence (container status follows its children)

tidy is the **write counterpart to read-only `/faff-map`**: it owns the orchestrator lane's **state-coherence grooming** — reconciling a container's status when it makes no sense against its children. (`/faff-map` reports and never mutates; a build only ever writes its own issue's claim/ship. This sweep is initiated **only** from tidy, never map, never a build.) The transition is **derived from child state, forward-only, monotonic, and trivially human-reversible** — bookkeeping, not a judgement call.

Decide each transition with the pure **`faff project-next`** predicate (gateway → resolving the `faff` executable; **no tracker access** — tidy supplies the rollup, the CLI returns the move). Per active **container** — a project, or a **parent issue** with sub-issues:

**Capture (Tier-2 mint-and-silence, `FAFF_RUN_DIR`-guarded, issue `__run__`).** When a run dir is present (an L3 self-drain or an L4 run, never a standalone interactive tidy), run each container's consult as `eval "$(faff decision-capture decide --run <run> --issue __run__ --kernel project-next --export)" && faff project-next …` (each tool call is a fresh shell, so an export in a separate call never reaches the consult), so each container's in-kernel base carries a non-empty correlation_id and stops logging the empty-id note. This rollup has no single downstream action, so it emits **no** `decision-capture action` marker (it lands `action_uncaptured` by design). Follows the core-loop driver pattern; best-effort, never gates.

1. **Build the child rollup** over the container's children (`containerParent` membership; **exclude cancelled/archived** per the shared rule): `total` = remaining children · `active` = In Progress + In Review · `done` = Done/Completed.
2. **Map the container's native status → category**: `planned` (Backlog/Planned/Todo) · `started` (In Progress) · `completed` (Done) · `cancelled`.
3. **Evaluate the release gate — lazily, has-dod ∧ all-done only.** For a project that carries a release-gate/DoD — i.e. it would receive `--has-dod` — whose rollup shows `done == total`, compute `--dod-met` **before** calling the predicate. No coverage call is made for any other container (no DoD, or DoD but children still open):
   a. **Verdicts.** When this invocation holds an issue/run→PRDR association (e.g. beep-boop's run-keyed `{run-id: project-prdr-id}` map) and `.faff/holdout/` exists, fetch `faff holdout verdicts --association <assoc> --dir .faff/holdout`. A non-zero exit → empty verdict map (fail-safe), log the stderr summary. Outside a run context (no association held) → empty map, gate not-passed — this is by design (the leash: DoD projects are held open until a run supplies verdicts), not a defect.
   b. **Coverage.** Call `faff prdr coverage --container <project name> --dod-verdicts <verdicts JSON>` — **no** `--prd-goals` (an empty goal list makes `covered` trivially true, so `satisfied ⟺ completion.all_met`: exactly "every live PRDR under this container has a met DoD"). A non-zero exit or unparseable stdout → gate not-passed, held open, log loudly ("coverage producer failed") — never advance on a broken producer.
   c. **Gate := `coverage.satisfied === true`.**
   d. **Log the gate line** `{container, gate, reason: coverage.reason}` — the reason string distinguishes unmet from unverified.
4. **Call** `faff project-next --current <category> --kind <project|issue> --total N --active N --done N [--has-dod] [--dod-met]`. Pass `--has-dod` for a project carrying a release-gate/DoD; pass `--dod-met` too **iff** step 3 computed `gate === true` (never pass `--dod-met` without `--has-dod` — the predicate rejects that combination as malformed). Omit both for a no-DoD project (children-done → Done coherence is the default, unchanged).
5. **On `action: advance`** — **re-read the container's live status immediately before writing** (multi-orchestrator safety; mirror graft's live-status re-read), then apply the new status via the tracker MCP (`save_project` for a project, `save_issue` for a parent issue). The write is idempotent and forward-only, so a re-run / concurrent sweep converges. A **failed MCP write** is an unexpected-state condition — handle it per the shared autonomous contract (log + continue, never abort the whole sweep on one container); the next pass retries (the transition is still derivable). **On `action: noop`** — do nothing. **On a `{error}` verdict** (an unmapped native status, or a malformed `--dod-met`/`--has-dod` pair) — the predicate fail-closes (exit 2, no transition); skip the container and log, never guess a category.

`faff project-next` advances a project to In Progress when its first child starts, and a parent issue to In Progress when any child is in progress. Only projects advance to Done: all children must be Done and any DoD release gate must pass. An unmet or unverified gate holds the project open (reason "all-children-done: release gate not passed — held open (DoD authoritative)"). Never move a container backward. Completed and cancelled containers are terminal. Git-only mode has no containers to reconcile.

**Autonomous** applies advances without prompting (it is reversible, child-derived bookkeeping reflecting already-authorised work — for the DoD-gated advance specifically, the judgement was discharged upstream by a human Accepting the PRDR and the code-blind evaluator producing the verdict; the tracker write here is mechanical); **interactive** offers them (see Output and chaining). Log every applied transition (`container id, kind, current→desired, reason`) to the tidy log, plus the gate line from step 3 for every has-dod all-done container evaluated (whether or not it advanced).

**Name-drift observability.** While building the rollup, also list any **live PRDR** whose `container` field matches no active project by name — log it (`container slug, live PRDR id`) for human review. A renamed project silently drops its has-dod signal and would otherwise flip Done via the no-DoD rule despite carrying a live, unevaluated DoD; this sweep makes that hazard observable, not auto-reconciled.

**On-demand `prdr-author` (L3 propose-for-approval, interactive only).** A project with **no DoD/PRDR** (`--has-dod` would be absent — no PRDR record under it) is the grooming-time home for the **on-demand** authoring call-site (gateway → **The `methodology` slot**, `prdr-author`). When a `methodology` slot is configured, tidy **offers** to propose one: request the methodology's **`prdr-author`** with the project's `{outcome, child_specs, target}` (`target` resolves `explicit > inherited > methodology-default`), which writes the `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`, then surface the proposed `## Definition of done` and gate — "Project <p> has no DoD. Propose one (target: <t>)? (propose / skip)". This is **advisory + human-gated**: on `propose`, tidy authors the `Proposed` PRDR and tells the human to ratify by running **`faff prdr accept <n>`** — the sole writer of `Status: Accepted`, which commits the record to a `prdr/…` landing branch for a small PR (tidy never self-Accepts and never a hand-edit — that is the human's gesture). A **pre-existing human-set DoD is never clobbered** (re-read first — gateway → **Manual changes are authoritative (`prdr-author`)**). **Autonomous tidy only lists DoD-less projects — it never proposes or admits** (admission is human-gated at L3; the L4 lights-out runner self-admits via `faff prdr admit`, not tidy). Skip the offer entirely when no methodology is configured **or** the configured methodology does not answer `prdr-author` (the Optional output's graceful degradation — gateway → **The `methodology` slot**): no proposal is made and the human authors the DoD directly.

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
- **Structural diagnostics surfaced resolved-elsewhere finding-tickets:** "N open finding-ticket(s) look already fixed under other ticket numbers (M strong / K weak). Review them now? (y/n, or 'pick')". On confirm, present each with its evidence (fix refs, kind, merged flag) and the disposition recipe (close Done with the case-appropriate comment trail — never Duplicate). faff does **not** auto-close: dispositioning is the human's call, so this gate surfaces and recommends only.
- **Structural diagnostics surfaced chain gaps (low appetite, or ambiguous references):** "N chain gap(s) across M ticket(s) — spec'd work no ticket tracks (sub-ticket / upstream / downstream / peer). Walk through them now? (y/n, or 'pick')". On confirm, present each with: the active ticket, sub-type, referenced work, what's covered (sub-ticket gaps only), what's un-ticketed, and the recommended action. Offer to file the missing sub-ticket(s) for sub-ticket gaps; offer "file gap issue" for upstream / downstream / peer (creates a Backlog ticket with the appropriate relationship — blocker / blocked-by / sibling — to the active ticket).
- **Structural diagnostics auto-created chain-gap tickets (`high`/`full` appetite, or `medium` with an opinionated methodology):** "Auto-created N ticket(s) to fill chain gaps across M active ticket(s) (e.g. SHF-AA: 5 sub-ticket-gap deliverables → 5 Backlog sub-tickets; SHF-CC: upstream prereq created + blocker link). Review the log? (y/n)" — on confirm, print the chain-gap findings + the created-ticket list (id, sub-type, source spec line, relationship target) + log path. In autonomous mode the auto-create runs without a gate; this gate is interactive-only post-action confirmation.
- **Calibration signal threshold crossed:** "N calibration signal(s) surfaced. Show details? (y/n)" — on confirm, print the signal block(s) with the recommended actions.
- **Methodology findings (surface-only in 2a):** "N methodology findings surfaced. Walk through them now? (y/n, or 'pick')". On confirm, present each with its diagnosis and the recommended action — the human applies the fix (rename, split, regroup, link). No auto-actions in 2a.
- **State-coherence transitions (bucket 8):** "N container(s) are out of step with their children (e.g. PROJ-X → In Progress: first child started; PROJ-Y → Done: all children done, no DoD). Apply the forward-only transitions? (y/n, or 'pick')". On confirm, re-read each container's live status and apply via the tracker MCP. (Autonomous applies these without a gate; this gate is interactive-only.)

Every chain point is an explicit gate. No "you should run" language.

## Autonomous Mode

When invoked autonomously (e.g. by `/faff-beep-boop` in its default full-pipeline mode), follow the shared autonomous contract (see the sibling `faff/references/autonomous.md`) and these specifics:

**Eligibility (gateway → Automation eligibility).** Skip issues without `faff-automate` for auto-actions/prep tagging: never tag `stale-spec`/`superseded-spec`, promote to Todo or change tracker-owned eligibility labels. Nonpipeline mechanical housekeeping still applies; preserve eligibility, including on reparenting.

**Human curation is authoritative (gateway, assertion 3).** Only own housekeeping is autonomous: stale faff-labels, cancelled/archived references and obvious orphans (parent Done/Cancelled/Archived). Never reprioritise/resequence/regroup/reparent human-curated structure or cancel/delete (appetite hard floor). Beyond these exceptions, surface for human decision (propose-and-confirm).

**Auto-actions (no prompting):**

| Housekeeping | Condition, action and record |
|---|---|
| Dead references | Every active issue: remove blocker, blockedBy, parent, sub-issue, related and dependency links to cancelled/archived issues. Post one tracker comment per cascade. Log the active id, dead target id and link type for each removed link. |
| Overlooked specs | Copy a **Spec discovery**-found noncanonical spec to the issue tracker comment, or configured spec-docs path (default `docs/specs/…`) if its feature branch exists; log. Todo without a spec at any discovery location: demote to Backlog; log "broken prep gate — no spec found". Never invoke `/faff-prep`; `/faff-beep-boop` owns the default full-pipeline prep queue. |
| Dead weight | Archive/close merged/cancelled backlog issues as tracker supports. |
| Obvious orphans | Parent Done/Cancelled/Archived: reparent to grandparent if present, else unlink parent. |

**Stale `faff-parked`.** Use `faff label remove <issue> faff-parked` and descriptor write (gateway → **Control-label provisioning**) only on either basis below.

1. **State moved on: `faff park-verdict`, never status alone.** `strip-ok`: In Review/Done/Cancelled/Archived; `n/a`: below In Progress. For In Progress, fetch tracker facts:
   - `draft_pr`: linked open DRAFT PR, `present`/`absent`.
   - `park_comment`: most-recent faff park comment, `build` (mid-build, blocked-on-external or resume-preserved), `nonbuild` (prep punt, low-confidence, gap or cycle), or `none`.
   - `human_takeover`: `true` if, after that park comment, a human moved the issue to In Progress or posted a non-faff comment. Otherwise `false`.

   Run `faff park-verdict --status in-progress --draft-pr <present|absent> --park-comment <build|nonbuild|none> --human-takeover <true|false>`; never re-derive its predicate. `strip-ok`: remove; `protect`: retain and log "valid mid-build park, label retained"; `surface`: retain and log "stale park label — needs human" for `/faff-wtf`. Live mid-build parks retain eligibility guard (`faff next --parked` ⇒ `needs-human`).

   **Capture:** Tier-1, `FAFF_RUN_DIR`-guarded, per issue `--issue <issue>`, best-effort, never gating; no run dir (standalone interactive tidy) mints nothing. Run `eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel park-verdict --export)" && faff park-verdict …` in one command. After label disposition, emit `faff decision-capture action --run <run> --issue <issue> --kernel park-verdict --action strip-ok|protect|surface` for the actual branch, never a re-emitted verdict.
2. **Reason no longer applies:** read tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`; exactly one basis must hold:
   - Autonomous-contract forbidden pattern: session compaction, context length, too-many-turns, topic-keyword match on a spec-closed decision, or edits taking effect only after merge (`netlify.toml`, `.github/workflows/*.yml`, `Dockerfile`, `package.json` dep bumps, IaC or migration SQL not executed pre-merge). Clear without prompting.
   - The park reason names a blocker issue ID. Live-fetch it and confirm Done/Merged/Cancelled.
   - Cited spec punt (`Punt:`, `needs human`, `TBD`, "or X if Y") now closed on the same topic by `Chosen:`/`Decision:` under the gateway Spec-readiness contract.
3. **Subjective/vague/missing reason** ("architectural change needed", "scope unclear"): retain; log "stale park label — needs human" for `/faff-wtf`.

Every auto-removal: log issue id, original reason and specific invalidating rule to `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`; post tracker comment explaining removal and reason.

**State-only label cleanup.** No reason parsing/no-longer-applies branch. Use descriptor write; log each removal. Preserve live In Progress claim provenance.

| Label and removal command | Resolved states | Orphaned resume cleanup |
|---|---|---|
| `faff label remove <issue> faff-awaiting-review` | In Review, Done, Cancelled | Remove `.faff/resume/<issue>/` if present. |
| `faff label remove <issue> faff-awaiting-spec-review` | Off Backlog: Todo, In Progress, In Review, Done, Cancelled | Remove `.faff/resume/<issue>/spec-review-hold.json` if present, or whole `.faff/resume/<issue>/` only if otherwise empty; never `.faff/spec-review/<issue>/` convergence-window scratch. |
| `faff label remove <issue> faff-claimed` | No longer In Progress: In Review, Done, Cancelled | None. Backstop graft's terminal/retry-later breadcrumb clear. |

**Stale claim reclaim.** Each active In Progress issue: tidy reads tracker facts; CLI decides liveness.

1. `claimed_at`: latest transition into In Progress. Linear: latest matching `get_issue.stateHistory` entry's `startedAt`; GitHub: latest claim timeline event's `created_at`; Jira: latest claim-state changelog transition. Never Linear's issue-level `startedAt`: retry-later's In Progress → Todo → In Progress does not reset it. Connector no-capability: surface; log "stale-claim check unavailable on <connector>", continue; never guess/default age.
2. Run `faff claim-verdict --claimed-at <claimed_at> --now <now> --ttl-hours $(faff config get claim_ttl_hours)`. `live`: do nothing. `stale` without `faff-claimed`: leave status untouched, log "stale claim, no `faff-claimed`, needs human"; human-set/unprovable claims are surface-only.
3. Only `stale` + `faff-claimed`: re-read live status immediately before write; move In Progress → Todo, `faff label remove <issue> faff-claimed`, then `faff build-claim release-if-stale --issue <issue>` (best-effort, always exit 0). Lease-matched-delete `refs/faff/build-claims/<issue>` only if its holder is stale under machine-aware, heartbeat-only `buildClaimStaleAware`; live heartbeating builds retain the ref even with hours-stale tracker age. Never acquire a build claim. The ref, not rebase-before-merge, is the mutex: live peers still refuse Step-5 acquire; re-queue for next pass only.
4. After reclaim, post one tracker comment: "reclaimed a `faff-claimed` stale claim (age > `claim_ttl_hours`); released the build-claim ref; moved to Todo for re-queue". Log `{issue, age_secs, ttl_secs, ref_released, action: reclaimed}` using actual release result. **git-only mode:** tracker/label writes no-op, but `faff build-claim release-if-stale` still runs; the ref on `origin` is its only cross-host claim.

**Claim capture:** same Tier-1 guards/best-effort/no-mint rules as park capture. Run `eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel claim-verdict --export)" && faff claim-verdict …` in one command. After actual disposition, emit `faff decision-capture action --run <run> --issue <issue> --kernel claim-verdict --action live` (left the claim) or `--action stale` (reclaimed at step 3).

Second sanctioned In Progress → Todo backward move (gateway **Issue claim & status monotonicity**), fenced to In Progress + `stale` + `faff-claimed`; never touch In Review/Done. **git-only mode:** no reclaim path (no shared tracker; same-host is covered by the local heartbeat). Distinct from the merge-time governance **anchor** git-evidence check.

- **Strip defensive-only edges in dep cycles.** Detected by the methodology slot's `backlog-diagnostics`. When one edge of a cycle is determined to be defensive-not-load-bearing (the spec for the parent doesn't reference the child's output), strip that edge. Log the cycle, stripped edge, and reasoning per that output's mechanical-fix rules.
- **Repoint ghost-project pointers with clear name-match.** When an issue's spec or description names a tracker container that doesn't exist, and a live container's name clearly maps to the missing reference (string proximity), repoint the issue. Log the move.
- **Demote `repeat-parked` Todos to Backlog.** When an active issue is in the methodology's `backlog-diagnostics` repeat-park set, demote from Todo to Backlog, then apply `faff-parked` — via the single-select state-group verb `faff label transition <issue> parked --present-label <each state label currently on the issue>` and its descriptor's write (gateway → **Control-label provisioning**), which clears any other state-group label before adding `parked`. `faff-parked` is what actually removes the issue from the buildable/eligible pool (`faff next --parked` ⇒ `needs-human`). Post a park comment per the shared **Park protocol** (step 3 — steps 1–2, WIP commit / draft PR, are N/A: a Backlog demotion has no branch or worktree): the reason is **demotion-specific**, the repeat-park pattern itself (root-cause class + count over the rolling 21-day window, e.g. "repeat-parked 3 times in 21 days in root-cause class `gap-blocked`") — never a verbatim forbidden-pattern raw reason, so the stale-`faff-parked` auto-remove sweep above (case 3, subjective/judgement-bound) leaves it in place rather than stripping it on the next pass. Logs the demotion. The issue is clearly not Todo-ready; leaving it as Todo lies to the queue. The qualifying set (parked repeatedly in the same root-cause class within the rolling window) comes from the methodology's `backlog-diagnostics`, which is now backed by the deterministic `faff park-history` seam — tidy consumes that output and does **not** re-count or call the seam itself.
- **Apply container state-coherence transitions** without prompting. Follow **8. State coherence (container status follows its children)** for each active container, including the lazy DoD gate, `faff project-next`, the live status reread immediately before each tracker write, and all transition, gate and name-drift logs. This is the only autonomous tidy write to container status. Preserve human priorities, grouping and parentage.

**Prep-queue candidates (handed to `/faff-beep-boop`'s prep queue in the default full pipeline; log-only otherwise):**
- **Stale specs** — tag the issue so `/faff-beep-boop` (default full pipeline) picks it up during the prep queue drain. Prep's autonomous stale-refresh path decides the outcome: if the original design still holds → `refreshed` (stays Todo, becomes a build candidate); if an architectural change is needed → park. If prep refreshes to `confidence: high`, the issue automatically enters the build queue in the same run — a stale-spec issue can be refreshed and shipped in a single overnight pass with no human in the loop.
- **Challenged specs** — same handling as stale: tag for the prep queue, prep's autonomous stale-refresh path absorbs post-spec challenges/resolutions if non-architectural, parks if a challenge contests a core decision. Worth annotating the log with the source comments so the human (or `/faff-wtf`) can see what changed.
- **Superseded specs** — tag the issue so the prep queue picks it up as a **fresh-spec** candidate (not a refresh — the original premise is wrong). Prep's autonomous fresh-spec path gates on confidence: `confidence: high` → `promoted` (enters build queue); `medium` → `promoted-needs-review` (attached, rating retained, routes out as `needs-decision-first` for human triage); `low` → park. Beep-boop builds high-confidence fresh specs in the same run; medium stays attached-and-surfaced, low parked for the morning.
- When tidy is invoked standalone (not as part of the default full pipeline), these become log-only — no prep queue is running to hand them to. Log as "needs refresh" / "needs refresh (challenged)" / "needs fresh-spec" so the next default `/faff-beep-boop` run or interactive `/faff-prep` picks them up.

**Log-only (no tracker changes in autonomous mode):**
- Dupes, vagueness, too broad, too big, premature, unblocked-by-done, missing deps, aging, not needed, uncategorised (mis-grouping flagged for `/faff-prep`, never as a label suggestion)
- **Orphaned-by-cascade** — active issue whose rationale depended on a now-cancelled chain — surface for human judgement on cancel / redirect, never auto-cancel
- **Descendants of cancelled ancestors** — active issues under any cancelled ancestor in the tracker hierarchy — surface for human decision (cancel / reparent / leave), never auto-cancel
- **Stuck in prep (still-valid parks)** — issues whose park label survived auto-cleanup because the park reason is subjective/judgement-bound. Log each with: issue id, park reason, priority (issue or ancestor), and chainable unlock count (objective facts). Order the log via the methodology's `pick-ordering` for `/faff-wtf` and the morning human reviewer.
- **Splittable specs** — surface only in structural mode; do not auto-split. Splitting lands when a methodology skill is configured.
- **Chain gaps** follow the shared plan in **Structural diagnostics** above. For log-only gaps, record the active ticket, sub-type, source spec line and referenced work. For sub-ticket gaps include enumerated deliverables, coverage from sub-tickets and directly referenced merged PRs, and the remainder. For acknowledged creates, also log the created ID, relationship, containment and priority. Post one consolidated comment per active ticket listing the acknowledged tickets and their roles. The separate priority-reason comment stays on each new ticket.
- **Orphaned-by-cascade + repeat-parked combination** — strong "is this still wanted?" signal; cancelling is destructive; always surface for human.
- **Methodology-finding relation recommendations** — when a spec comment or methodology diagnosis names a recommended `blocks` / `blocked-by` relation (e.g. *"Spec recommends blocker link until SHF-X fully merges"*), tidy never auto-creates the relation. Log as a finding with: source ticket, recommended target, the verbatim recommendation text, and a current-state snapshot of the target (open / Done / Cancelled / Archived; close date if applicable). The finding surfaces in `/faff-wtf`'s next morning brief; the human reviews and creates the relation manually if still applicable.

Record each finding in `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` with the issue id, category, and recommended action. These surface in the morning via `/faff-wtf` for human review.

**Never in autonomous mode:** auto-split, auto-merge tickets, delete issues, add/remove/restructure labels (that's `/faff-prep`'s domain), change ancestor/grouping assignments, auto-cancel descendants of cancelled ancestors, or promote an issue to Todo on the strength of a description alone.

**Return to caller (beep-boop):** `{ archived: N, reparented: N, refs_stripped: N, park_labels_cleared: N, stale_claims_reclaimed: N, stale_claims_surfaced: N, cycles_stripped: N, ghost_pointers_repointed: N, repeat_parks_demoted: N, container_transitions_applied: N, splittables_surfaced: N, resolved_elsewhere_surfaced: { strong: N, weak: N }, chain_gaps_surfaced: { subticket: N, upstream: N, downstream: N, peer: N }, chain_gap_tickets_created: { subticket: N, upstream: N, downstream: N, peer: N }, orphaned_repeat_parked_surfaced: N, calibration_signals: N, automation_verdicts_path: .faff/runs/<run-id>/automation-verdicts.md, logged: N, findings_path: .faff/logs/… }`. `stale_claims_reclaimed` counts `In Progress → Todo` reclaims (stale + `faff-claimed`); `stale_claims_surfaced` counts stale claims left untouched for a human (no `faff-claimed`, or connector without claim-age capability). `container_transitions_applied` counts bucket-8 forward-only container status writes (project/parent-issue → In Progress, project → Done where no DoD). `chain_gap_tickets_created` is non-zero when the appetite dial admits auto-create (`high`/`full`, or `medium` with an opinionated methodology); otherwise chain gaps land in `chain_gaps_surfaced`.

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
