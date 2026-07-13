# Spec — FAFF-437: Backlog rehoming pass — plot-hosted, human-gated apply of a `rehome-set`

> Spec: faffter-dark-nlspec · 2026-07-11 · interactive · confidence: high. Full spec on Linear FAFF-437.

This document specifies a new entry mode for `/faff-plot` (`plugin/skills/faff-plot/SKILL.md`): a whole-backlog rehoming pass that dispatches the methodology's `rehome-set` named output, gates the proposal on unconditional human confirmation, and on approval creates outcome-led project containers, re-parents their approved members, and draws the proposed coherence blocker edges. Audience: the build agent implementing the plot prose changes, and human reviewers.

## 1. WHY — Problem and principles

**The load-bearing model.** Under the agile lens, all new work deliberately lands project-less in Backlog (the lens's Default-landing rule — the legibility-preserving inflow counterweight to the lens's topology-write power). That design only works if something later sequences the accumulated loose set into outcome-led projects — and today, nothing does. FAFF-436 supplies the *judgement* half (`rehome-set`: loose backlog in, proposed outcome-led containers + membership + edges out); this issue supplies the *write* half: a plot-hosted pass that renders the proposal, gates it on the human, and applies only what the human approves. Rehoming, never deleting — the pass moves work into homes; it never removes scope.

**Problem statement.** The agile lens's project-less-Backlog default accumulates a loose backlog "pending rehoming" with no skill that performs the rehoming; the agile methodology's own prose (`plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`, Default-landing and convert-path sections) forward-references "a later tidy / plot / methodology pass" that does not exist. This change adds that pass to `/faff-plot`, closing the loop the lens's capture-time default opened.

**Design principles:**

- **Plot is the write locus.** Plot already owns container creation and the containers-always-confirm machinery; map/wtf stay read-only, tidy keeps its per-issue state-coherence write class. No new write class is invented — the pass reuses plot's existing authority, extended to re-parenting pre-existing issues.
- **The human gate is unconditional.** No appetite level auto-applies a rehome proposal. This is a plot-hosted tightening consistent with the gateway's existing "Containers always confirm" floor — see the composition decision in the WHAT section.
- **The methodology owns the grouping opinion; plot owns the loop and the writes.** Plot never invents project names, memberships, or edges — it renders and applies what `rehome-set` proposed and the human approved. Mirrors the existing `ticket-shaping` division exactly.
- **Approval is high-consequence and says so.** The Linear MCP's `save_issue.project` is reassign-only — it cannot null a project — so un-homing an approved rehome is Linear-UI/API-only, manual. The confirm prompt states this explicitly.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff-plot/SKILL.md` | Host skill. Gains the new entry mode; existing brief-recursion mode unchanged. |
| `plugin/skills/faff/SKILL.md` (gateway) | Producer-dispatch pattern (Sibling-skill invocation), Topology-write authority dial, Containers-always-confirm citation in Human-curation assertion 3, Always-pull-fresh + Ignore-cancelled rules, methodology named-output table. |
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | The lens whose Default-landing rule creates the loose backlog this pass drains; will implement `rehome-set` under FAFF-436. |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` | Thematic default; will decline `rehome-set` under FAFF-436 (its existing unanswered-output pattern, e.g. `issue-critique`). |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Lint gate: SKILL_LINE_CAP 600 (plot at 126 — ample headroom), PARA_WORD_CAP 200, duplicate-block detection (shared prose must reference the gateway, never copy it). |

**Scope statement.** This is a prose-only change to `plugin/skills/faff-plot/SKILL.md` (plus a matching mention in the gateway/plot description surfaces if needed); no CLI code changes. It sits between FAFF-436 (the `rehome-set` contract + lens implementations, which it consumes) and the broader FAFF-291 agile-lens outcome-scope cluster.

## 2. OUT OF SCOPE

- **Un-homing / dissolving projects** — the MCP is reassign-only; manual via Linear UI/API. Extension point: a future tracker CLI (`design/linear-cli-output-shape-spec.md` sketches `set_project --none`) would unlock a machine-side undo; nothing here depends on it.
- **Autonomous application at any appetite level** — the human gate is unconditional. Extension point: if a future L4 capability ever wants an unattended rehome, it is a new decision at the gateway Topology-write-authority dial, not a relaxation smuggled in here.
- **Mis-homed ticket movement** (tickets already inside a project) — the input set is project-less Backlog only. Extension point: the agile lens's existing thematic-conversion path handles already-homed work.
- **Re-slicing member content, ordering opinion** — the pass moves tickets whole and draws edges; sequencing within the new projects is the lens's `pick-ordering` job on later passes.
- **A tidy write path; cadence threshold config** — tidy keeps its state-coherence write class; no "offer rehome when loose count > N" knob is added (see the entry-syntax decision).
- **The `rehome-set` contract itself** — FAFF-436 owns the gateway named-output row, the agile-lens implementation, and the thematic decline. This spec designs the caller.

## 3. WHAT — Vocabulary, interfaces, decisions

**Vocabulary:**

| Term | Definition |
|---|---|
| Loose backlog | The fresh-pulled set of issues that are project-less AND in Backlog status AND non-terminal AND not cancelled/archived (gateway Ignore-cancelled rule; terminal and already-homed tickets are structurally outside the input set). |
| Rehome proposal | The `rehome-set` output: proposed outcome-led containers (name + outcome statement), a membership map, proposed coherence blocker edges, an explicit leave-loose set, principle-keyed findings. |
| Leave-loose | An issue the proposal (or a human strike-out) leaves project-less in Backlog — untouched by the apply. |
| Strike-out | A human edit at the confirm gate removing a member from a proposed project; the struck member becomes leave-loose. |

**The `rehome-set` input/output shape.** The pass hands the methodology the loose backlog + the dependency graph + the existing projects, and receives the rehome proposal above.

**Assumes:** FAFF-436's `rehome-set` named output exists with that declared shape — the gateway named-output-table row (Optional), the agile-lens implementation, and the thematic default's graceful decline ("unanswered → caller reports no grouping opinion, writes nothing"). FAFF-436 is Backlog/unbuilt today; the tracker blocker edge FAFF-436 → FAFF-437 exists. Validation before build: confirm the gateway table (`plugin/skills/faff/SKILL.md`, The `methodology` slot section) contains the `rehome-set` row and the agile lens answers it; if the shipped shape differs from the shape above, follow the shipped shape.

**Entry syntax** (ticket open question 1). Options: an explicit argument (`/faff-plot rehome`); a loose-count-triggered offer on bare `/faff-plot`; both.
**Chosen:** explicit argument only — `/faff-plot rehome` enters the rehoming pass; bare `/faff-plot` keeps today's brief-recursion behaviour unchanged. Rationale: a count-triggered offer needs a magic threshold, which the ticket explicitly rules out ("no cadence threshold config"), and deterministic entry fits the deterministic-tools-over-prose tenet. Discoverability is served by plot's skill description and Entry-step prose mentioning the mode, not by a trigger heuristic. When bare `/faff-plot` is invoked standalone with no brief *and the human's stated intent is clearly rehoming* ("sort out the loose backlog"), plot may offer the mode conversationally — a routing judgement, not a threshold.

**Dispatch pattern.** Plot's existing methodology calls (`ticket-shaping`, `prdr-author`) are inline Skill-tool calls today, pending the FAFF-421 migration.
**Chosen:** the new mode dispatches `rehome-set` per the gateway's existing canonical Producer-dispatch pattern (Sibling-skill invocation → Producer dispatch): resolve `slots.methodology` at dispatch (never hardcode), dispatch as an Agent-tool subagent with `run_in_background: false`, resolve `models.methodology` and `effort.methodology` via `faff config get` (`inherit` omits the parameter), single-level nesting fallback in-context when plot is itself a subagent. Rationale: the pattern is already gateway-canonical, so the new mode is not blocked on FAFF-421 (which migrates the *existing* calls); writing the new call correctly from day one avoids adding to FAFF-421's migration surface.

**Composition with the topology-write-authority dial.** The gateway dial grants `high` "rehome a gating chain" and `full` "own project formation end-to-end" — apparently in tension with the unconditional gate.
**Chosen:** the whole-backlog rehoming pass is plot-hosted and inherits plot's "Containers always confirm" floor — every approved rehome group requires creating a container, and no appetite level auto-creates a container, so the entire apply sits behind the confirm gate at every appetite. This is a plot-specific tightening the dial never relaxes: the gateway already states the dial "adds the topology axis to the hard floor; it never relaxes it", and Human-curation assertion 3 explicitly cites jot/plot's containers-always-confirm at every appetite level. The dial's rehome authority continues to govern the methodology's *other, narrower* call sites (gating-chain rehome, MVP scope-cut, thematic conversion — per-issue moves against existing containers). The new plot prose states this composition in one sentence and refers back to the gateway sections rather than restating the dial.

**Confirm-gate mechanics.** **Chosen:** per-proposed-project gating using plot's existing yes/edit/no pattern (plot Step 4), extended with strike-outs:

- Each proposed project is presented (rendered skimmably — see HOW) with an `approve / edit / decline` prompt that states the manual-undo path: *"un-homing is manual (Linear UI/API only — the MCP cannot remove a ticket from a project)"*.
- `edit` = strike-out only: the human names members to remove; struck members become leave-loose; proposed edges touching a struck member are dropped; the trimmed project is re-presented for approve/decline. No re-dispatch to the methodology on edit — the strike is authoritative and subtractive re-shaping avoids proposing struck members back (anti-thrash). Adding members is not an edit path — that is a tracker action the human takes directly.
- `decline` = the whole group's members become leave-loose; nothing written for that group.
- Rationale: reuses the established gate shape; subtractive-only edit keeps the human's judgement final and the gate loop bounded.

**Whether `prdr-author` fires per approved container** (ticket open question 2). **Chosen:** yes — plot's existing Step 5b runs for each newly-created project, with inputs adapted for reparented (not brief-authored) members: `outcome` = the proposal's outcome statement for that container; `child_specs` = the approved members' titles + descriptions (plus attached specs where present); `target` resolves explicit > inherited > methodology-default, unchanged. Same L3 propose-for-approval gate; same manual-authoritative rule (never clobbers a human-set DoD); `skip` leaves the PRDR Proposed. Rationale: an outcome-led project without a DoD is exactly the "bare bucket, not a value stream" the agile lens's own re-homing prose skips — creating DoD-less containers from a pass that exists to make streams sequencable would undercut the lens; the ticket's pointer at Step 5b agrees.

**Zero-write endings.** **Chosen:** three distinct endings, all with zero tracker writes, all logged, one render pattern:

- *Unanswered* (e.g. thematic default declines): report "the configured methodology (<name>) offers no grouping opinion for a backlog rehoming pass" and how to switch lenses (`slots.methodology` in `.faffrc`). Exit cleanly.
- *Answered but empty* (the lens looked and proposes nothing): render the explicit leave-loose set with the lens's principle-keyed findings — "nothing to rehome yet" is information, not an error.
- *All declined*: acknowledge, log the declines, exit cleanly.

**Provenance and labels on created containers.** **Chosen:** each created project carries plot's existing provenance-line convention, naming the pass (e.g. `planned by /faff-plot (rehome pass)`), so faff-authored structure stays detectable per the gateway's provenance rule. No `faff-jot-intake` label and no `faff intake-record` call — those are issue-creation conventions and this pass creates no issues. No per-issue tracker comment on reparented members — the new project membership is already legible in the tracker, and the gateway forbids duplicating legible state; the apply log is the write record.

**Autonomous invocation.** **Chosen:** mirrors plot's existing autonomous fallback: if the rehome mode is somehow invoked autonomously, dispatch `rehome-set`, write the rendered proposal to `.faff/intake/<date>-rehome-proposal.md`, surface it for human review, and write nothing to the tracker. `/faff-beep-boop` does not invoke the pass. Rationale: identical to plot's existing "recurses and writes the skeleton to `.faff/intake/…`" posture; the gate stays human-shaped even when no human is present.

## 4. HOW — Behaviour

**The flow:**

```
/faff-plot rehome
  → pull the loose backlog fresh (project-less + Backlog + non-terminal + not cancelled/archived)
  → dispatch rehome-set (producer dispatch; slots/models/effort resolved via faff config get)
  → render the proposal (per proposed project: name, outcome, members, proposed edges; plus leave-loose set + findings)
  → per proposed project: approve / edit (strike-out) / decline   [unconditional gate]
  → per approved project, apply in order:
      1. create the container (plot's container machinery + provenance line)
      2. re-parent its approved members (save_issue project assignment)
      3. draw the proposed blocker / blocked-by links among approved tickets
      4. Step 5b: prdr-author proposal for the new project (approve / edit / skip)
  → log everything; offer the standard hand-off gates (audit via /faff-map)
```

**Input-set freshness.** The loose backlog is pulled fresh at pass start (gateway Always-pull-fresh). At apply time, each member is re-checked to still be project-less and in Backlog before its reparent — a human may have homed or progressed it mid-conversation; a changed member is skipped with a logged note, never force-moved (gateway gate-freshness rule; Human curation is authoritative).

**Apply order and idempotence.** Container first, then reparents, then edges — the most structural write first, the most degradable last. Edge writes are append-only at the vocabulary level (blocker / blocked-by links, tracker-agnostic per existing convention); an edge that already exists is skipped. Re-running the pass converges: already-homed members drop out of the input set, and the `rehome-set` input includes existing projects, so a re-run can propose homing remaining loose members into a previously-created container rather than duplicating it.

**Partial-apply failure posture.** **Chosen:** finish-forward per project, never roll back:

```
PROCEDURE apply_approved_project(project):
  1. Log intent (container name, member ids, edge list)
  2. Create container — on failure: report, skip this project's remaining writes, continue to next approved project
  3. FOR each member: re-check fresh state → reparent → log
     on a member failure: log it, continue with remaining members
  4. FOR each approved edge: draw if absent → log
     on an edge failure: log it, continue with remaining edges
  5. Report the project's landed state exactly: container id, members moved / skipped / failed, edges drawn / missing
     — with the manual completion steps for anything missing
```

Rationale: rollback would mean deleting a created container or un-homing moved members — the first violates the never-delete hard floor, the second is impossible via the MCP. A partial state is safe because it is convergent (a re-run proposes the remainder) and honest reporting makes it legible. A missing edge degrades to a dependency known only in prose — surfaced as exactly that, since deps-in-edges is the point of drawing them.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The lens proposes junk groupings** (thematic buckets wearing outcome names). How you'd know: the human declines most groups pass after pass — visible in the pass logs. What it means: an FAFF-436 lens-quality problem, not a caller problem; the unconditional gate is precisely the containment.
- **The confirm gate is bypassed by appetite drift** (a future edit reads the dial's `full` row as licence). How you'd know: a container created with no confirm exchange in the log. What it means: the composition sentence in plot's prose exists to prevent this; treat as a regression against this spec's gate scenario.
- **Mid-pass human tracker edits race the apply.** How you'd know: at-apply re-check skips members with a logged "state changed since proposal" note. What it means: working as designed — the human's edit wins.

**Anti-pattern:** re-dispatching `rehome-set` after a strike-out to "re-balance" the group. Why: it can re-propose the struck member, thrashing against the human's explicit judgement; the strike is final for this pass.

**Rendering and logging.** The proposal render goes through the configured `rendering_adaptor` per plot's existing Rendering section (enumerable sets as lists, never run-on paragraphs). The pass logs per the gateway `.faff/logs/` rule: the pulled input set, the dispatch (slot/model/effort resolved), the full proposal, every gate decision (approve/edit/decline, strike-outs), every write with its outcome, and every skip with its reason — enough to resume or audit in a fresh conversation.

**Skill-prose mechanics.** The new mode is a new top-level entry fork in `plugin/skills/faff-plot/SKILL.md` (sibling to the brief-recursion flow, selected by the `rehome` argument), not an extension of the recursion steps — plot's Step 5 creates containers alongside newly-authored children, which is a different write shape from create-container-plus-reparent-pre-existing. Shared rules (dial composition, producer dispatch, pull-fresh, ignore-cancelled) are referenced back to the gateway, never copied — the duplicate-block lint (6+ consecutive duplicated significant lines across skills) enforces this. Plot is at 126 lines against a 600 cap; the addition fits comfortably.

## 5. Scenarios

```
Given an accumulated project-less Backlog and the agile lens configured
When /faff-plot rehome runs and the proposal is rendered
Then per proposed project the name, outcome, members, and proposed edges are shown, plus the leave-loose set — and nothing has been written to the tracker

Given a rendered proposal
When the human approves a proposed project
Then the project exists in the tracker with a plot provenance line, its members are re-parented into it, the approved blocker edges are drawn, and a prdr-author DoD proposal is surfaced for that project

Given a rendered proposal
When the human declines every proposed project
Then zero tracker writes occurred and the pass exits cleanly with the declines logged

Given a proposed project with member X struck out at the edit gate
When the trimmed project is approved and applied
Then X remains project-less in Backlog, no edge touching X is drawn, and the other members are re-parented

Given the thematic default configured as the methodology
When /faff-plot rehome runs
Then the pass reports that the configured lens offers no grouping opinion and exits with zero writes

Given an approved project whose container was created but a member reparent then fails
When the apply completes
Then the pass reports exactly what landed and what is missing with manual completion steps, continues with other approved projects, and deletes nothing
```

Assertion: tickets in a terminal state, cancelled/archived tickets, and already-homed tickets never appear in the input set or receive any write.

Assertion: `faff validate-adapters` stays green after the plot prose change.

## 6. Design decision rationale

All decisions are stated with their markers and rationale inline in the WHAT and HOW sections above; none are re-derived here. The two ticket open questions are both closed: entry is the explicit `/faff-plot rehome` argument (no count threshold — the ticket rules out cadence config, and deterministic entry fits the tenets), and `prdr-author` fires per approved container with member-derived inputs (a DoD-less outcome project would be the bare bucket the agile lens itself refuses to treat as a value stream). Temporal anchor: at the time of writing, FAFF-421 (producer-dispatch migration for plot's existing methodology calls) is unshipped — the new mode follows the gateway-canonical dispatch pattern independently, so nothing here needs revisiting when FAFF-421 lands.

## 7. Open questions & assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** FAFF-436's `rehome-set` named output exists — the gateway named-output-table row, the agile-lens implementation, and the thematic default's graceful decline — with the declared output shape (proposed containers with name + outcome statement, membership map, proposed coherence blocker edges, explicit leave-loose set, principle-keyed findings). Validation before build: read the gateway's The-`methodology`-slot table and the agile lens's `rehome-set` section; if the shipped shape differs, the shipped shape wins. The tracker blocker edge (FAFF-436 blocks FAFF-437) already enforces build order. Consumer-expectation mirror posted to FAFF-436 (2026-07-11) so shape drift is caught at the source.

## 8. DONE — Definition of done

### From WHY / WHAT (entry and dispatch)
- [ ] `/faff-plot rehome` enters the rehoming pass; bare `/faff-plot` behaviour is byte-for-byte-intent unchanged (brief recursion only).
- [ ] The pass pulls the loose backlog fresh (project-less + Backlog + non-terminal + not cancelled/archived) — no reuse of earlier fetches.
- [ ] `rehome-set` is dispatched per the gateway Producer-dispatch pattern: `slots.methodology` resolved at dispatch, Agent-tool subagent with `run_in_background: false`, `models.methodology` / `effort.methodology` resolved via `faff config get`, in-context fallback when plot is itself a subagent.

### From WHAT (gate)
- [ ] The proposal renders per proposed project (name, outcome, members, proposed edges) plus the leave-loose set, through the `rendering_adaptor`, with zero tracker writes before confirmation.
- [ ] Each proposed project gates approve / edit / decline; the prompt states the manual-undo path (un-homing is Linear-UI/API-only).
- [ ] Strike-out at the edit gate makes the member leave-loose, drops its edges, re-presents the trimmed project, and never re-dispatches the methodology.
- [ ] The prose states the composition sentence: the pass inherits plot's containers-always-confirm floor at every appetite; the topology-write dial's rehome authority governs other call sites (gateway references, no copied dial prose).

### From HOW (apply)
- [ ] Approved apply per project runs container-create → member reparents → edge draws, each write logged; members re-checked fresh at apply time and skipped-with-note if changed.
- [ ] Created projects carry the plot provenance line naming the rehome pass; no `faff-jot-intake` label, no `faff intake-record`, no per-member tracker comments.
- [ ] `prdr-author` (Step 5b) fires per newly-created project with `{outcome from the proposal, child_specs from member titles/descriptions/specs, target per the standard resolution}` under the existing approve/edit/skip gate.
- [ ] Partial failure: finish-forward, exact landed-state report with manual completion steps, no rollback, no delete, other approved projects still applied.
- [ ] Zero-write endings: unanswered lens → "no grouping opinion" report naming the lens; empty proposal → leave-loose set rendered; all declined → clean exit. All logged.
- [ ] Autonomous invocation writes the proposal to `.faff/intake/…` and nothing to the tracker; beep-boop never invokes the pass.

### From the lint gate
- [ ] `faff validate-adapters` green (line cap, paragraph cap, no duplicated gateway prose, rendering-ref intact).

**Integration smoke test** (pseudocode):

```
1. Seed a tracker with 6 project-less Backlog issues (2 forming one outcome, 1 cancelled, 1 Done), agile lens configured
2. Run /faff-plot rehome → assert: proposal rendered, cancelled/Done absent from it, zero writes so far
3. Approve one proposed project with one member struck → assert: project exists with provenance line,
   non-struck members re-parented, struck member still loose, approved edges drawn, prdr-author proposal surfaced
4. Re-run the pass → assert: homed members absent from the input set (convergence)
```

confidence: high
spec-review: approve
