# FAFF-23 — Automation hold: keep tickets out of autonomous spec/build until human release

`confidence: high`

## WHY — Problem and scope
The faff pipeline autonomously sweeps the backlog: beep-boop re-queries Backlog+Todo and runs narrow prep on every unblocked Backlog item; prep auto-specs and promotes to Todo; graft auto-builds. The `faff-jot-intake` tag is prep's pickup signal, so every freshly-jotted idea is a live prep candidate. There's no way to capture an idea ("on paper, to think about, way off building") and keep it out of automation until a human decides it's right. This adds a human-set, **tracker-level** marker the autonomous pipeline must skip — while the ticket stays fully visible to read/report skills.

**Design principles**
- **Two-tier, not invisible.** Unlike cancelled/archived (invisible everywhere), held tickets are *visible to humans / read-skills* but *skipped by autonomous action only*.
- **Intrinsic to the ticket, never a run flag.** A run-level opt-in can't protect (another run without it sweeps everything; it assumes a single omniscient runner). The guard lives on the ticket.
- **Human-gated release only.** Automation may never lift a hold.

**Out of scope** (extension points): jot applying the hold by default (separate jot-policy; ties FAFF-24); container-level hold + inheritance (v1 is per-issue); mechanically distinguishing hold *intents* (v1 = one marker, reason in the hold comment); per-repo configurable label name (v1 = fixed default).

## WHAT — Data and interfaces
The marker is a tracker **label**, default `automation-hold`.
- Orthogonal to status: a held Backlog issue stays Backlog but is skipped by autonomous action — no new workflow state.
- A status (out-of-flow "icebox") would proliferate faff's implicit Backlog→Todo→In Progress→Done model and conflict with "only specced items live in Todo"; a held item must still live in *some* status anyway.
- faff already uses labels as control signals: `faff-jot-intake` (prep pickup), `parked-by-faff` (park), `faff-chain-gap-fill` (gap tracking).

**Chosen:** a tracker label `automation-hold`, orthogonal to status.

Relationship to `parked-by-faff`: `parked-by-faff` = automation tried and hit a blocker, and tidy auto-clears it when the blocker resolves. `automation-hold` = a human pre-emptively blocks; **no auto-clear** — only a human removes it. Independent (an issue may carry either, both, or neither).

**Chosen:** distinct, orthogonal label with **no auto-clear** (explicitly unlike `parked-by-faff`); never conflated with it.

**Assumes:** a tracker MCP exposing labels is configured (Linear/GitHub/Jira all do).

## HOW — Behaviour

**Chosen:** implement as a single gateway shared rule **"Automation hold"** in `faff/SKILL.md`, structured like **"Ignore cancelled and archived"**, and *referenced* by each enforcing skill rather than duplicated.

**Detection:** an issue is *held* iff it carries the `automation-hold` label (reuse the label query skills already run for `parked-by-faff`).

**Enforcement — the chokepoint model (complete by construction, not an enumerated call-site list).** All autonomous spec/promote/build flows through exactly three skills:
- **prep + tidy = the only autonomous spec/promote paths.** beep-boop's orchestrator "does no tracker state moves of its own" (beep-boop SKILL.md §8) — every Backlog→Todo move and spec generation goes through **prep** (incl. wave re-entry), and **tidy** is the only other promoter/flagger. prep refuses to spec/promote a held issue, returning a new **`held`** disposition (distinct from `parked`: never entered the ledger, not a blocked attempt); tidy does not apply `stale-spec`/`superseded-spec` tags to a held issue, does not promote it to Todo, and preserves the hold across auto-reparent. Because the only path into the build queue is via Todo, and the only path into Todo is prep/tidy, a held item can never reach the build queue.
- **graft = the only autonomous build path** (beep-boop's build pass only drives `/faff-graft`, §6). Autonomous graft refuses to build a held issue — the build backstop.
- **beep-boop's queue filters are non-load-bearing efficiency early-exits.** Skipping held items at prep-queue build (§2), wave-re-entry selection (§8), and build-queue assembly (§4) avoids wasting a prep/verdict invocation — defence-in-depth, not the guarantee. Held items never enter the run-ledger `admitted` array, so `runcheck` is unaffected.

**Interactive use is allowed** — a human may deliberately `/faff-prep` or `/faff-graft` a held issue. The held-state warning ("this ticket is held — proceeding; the hold stays until you remove it") surfaces at **prep's spec-discovery entry** and **graft's prep-gate (Step 2)**. The hold is never auto-removed.

**Release (multi-path, human-gated):**
- **Tracker edit always works** — remove the `automation-hold` label. The irreducible control-surface baseline.
- **faff-mediated, only on explicit human confirm** — interactive tidy offers "lift the hold on any of these?".
- **Hard rule:** no autonomous path ever removes the label.

**Surfacing (rot-guard):**
- **wtf** — new read-only section **"On hold — awaiting human release: N"**, after *Parked work*, before *Today's Focus*.
- **tidy** — new section **"On hold"**, after *Stuck in prep*, before *Structural diagnostics*. Interactive offers to lift; autonomous only lists.
- Held issues stay visible in all read outputs (counts, map) — not excluded the way cancelled/archived are.

**Git-only mode (no tracker):** no tracker to carry the label, so the hold check is a documented no-op and the feature is effectively unavailable — consistent with git-only's already-minimal autonomous surface.

**Risks / edge cases:** a held issue with a high-confidence spec already in Todo must still be skipped by autonomous build (graft enforces it); held + parked is harmless; removing the hold does not auto-promote.

## DONE
1. Gateway shared rule "Automation hold" defines the label, detection, two-tier behaviour, human-only release, surfacing — structured like "Ignore cancelled and archived".
2. **Chokepoint coverage:** autonomous prep and tidy never spec/promote a held issue, and autonomous graft never builds one; a held Backlog issue stays Backlog across a beep-boop run, never appears in the run-ledger `admitted` array, `runcheck` passes with it present.
3. Autonomous prep (Path 1 & 2) returns the `held` disposition for a held issue (not `parked`, not `promoted`).
4. Autonomous graft refuses to build a held issue.
5. Autonomous tidy does not apply `stale-spec`/`superseded-spec` to a held issue, does not promote it to Todo, hold survives auto-reparent.
6. Interactive prep/graft on a held issue proceeds with a "this is held" warning (prep spec-discovery entry / graft Step 2); hold not auto-removed.
7. No autonomous code path removes the `automation-hold` label.
8. wtf renders "On hold — awaiting human release: N" (after Parked, before Today's Focus); held issues remain in counts.
9. tidy renders an "On hold" section (after Stuck in prep); interactive offers lift, autonomous only lists.
10. Held tickets are NOT excluded from read skills (wtf/map) the way cancelled/archived are.
11. Git-only mode degrades to a documented no-op.

---
*Spec produced by faff-prep (interactive) via faffter-noon-spec; clean-context self-review applied (1 blocker resolved via the chokepoint reframe → high). Markers: 3× Chosen, 1× Assumes, 0 Punt.*
