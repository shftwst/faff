# FAFF-1120 — Slice C: tracker-status governed record + resolve the status-set anti-pattern

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1120.

Slice C of FAFF-1108 (govern faff's other protected effects via the Commissaire producer half). The final slice, and the decision-gated one. Slice A (FAFF-1118) gave two effects a real chokepoint; Slice B (FAFF-1119) gave the runner's non-interceptable effects a governed record. This slice does the same governed-record treatment for the last uncovered protected effect: the agent-mediated tracker status writes.

## Decision gate resolution (settled before build)

The `faff status set` anti-pattern (`faff-graft/SKILL.md:581` — "status writes stay agent-mediated throughout faff; no status-set verb exists") is **held governed-record-only**. A CLI status-set verb is not introduced.

**Chosen:** Hold the anti-pattern. Govern tracker status writes with a detection record, not a chokepoint. Rationale: a chokepoint prevents; there is nothing here to prevent. Tracker status is a breadcrumb (the build-claim git ref is the real mutex, `faff-claimed` and the status column are human-facing provenance read by nothing to gate a build), so there is no protected transition a status-set gate could defend. A `faff status set` CLI would also break faff's standing boundary that the CLI stays pure and tracker-agnostic while tracker MCP writes stay agent-side (the same boundary that keeps `label.js` a pure op-descriptor emitter). Reopen only if audit ever needs status *prevention*, which it does not today.

This resolution is recorded as a decisions-register precedent (captured this prep, materialised to `docs/decisions.md` at graft Step 4c under human PR review), satisfying the DoD "the status-set anti-pattern decision is recorded before this slice builds."

## What to build and why

A single shared governed record rule in `faff-graft` SKILL prose that brackets every agent-mediated status `save_issue` write with a declare-before / observe-after pair at `--step tracker-write`, on a governed run only, record-only. It is the exact structural twin of the existing governed label-write record rule (`faff-graft/SKILL.md:298`), which already states these status transitions are `tracker-write` and "out of this slice (deferred to Slice C)". This slice lands that deferral.

**Chosen:** One shared rule, not per-site brackets. Author a single `_**Governed tracker-write record**_` paragraph in graft, mirroring the label-write rule's shape and placement, that "binds every agent-mediated status MCP write from here on" and lists the bound sites. Rationale: the label-write rule already proved this shape; one rule keeps the prose lean and deduplicated (the skill-authoring standard) and avoids five near-identical brackets drifting apart.

**Chosen:** Bracket every graft-owned agent-mediated status write, not only the two the ticket names. The DoD says "each governed status write". The graft-owned sites are:
- Step 5 `→ In Progress` (`SKILL.md:293`), paired with the `faff-claimed` breadcrumb.
- The In Review transition after `gh pr create` (`SKILL.md:567`, `575`).
- The superseded-done `→ Done` move in the build-time premise-superseded gate (`SKILL.md:152`).
- The two claim-holder `In Progress → Todo` hold releases (review-outage hold `SKILL.md:502`; build-review-dialogue hold `SKILL.md:511`).

Each already re-reads live status and performs a forward-only (or the one sanctioned backward-to-Todo) agent-mediated `save_issue`. The shared rule brackets the MCP write at whichever site fires. Rationale: honest coverage of the DoD, and cheap, since all five reuse one declare/observe pattern.

**Chosen:** The declare/observe descriptor is `{kind:"tracker-write", target:"<ISSUE-XX>:<from>-><to>", reversible:true}`. `target` names the issue and the rank transition (e.g. `FAFF-1120:Todo->In Progress`) so `faff effects check` and the audit trail show what moved. `reversible:true` because a status move is monotonic-guarded and re-settable, never a destructive effect. Declare over the intended transition before the write; observe over the achieved transition after it succeeds. Since observe is a subset-or-equal of declare, `computeEscapes` (observed minus declared) never flags a sanctioned status write.

**Chosen:** Add `tracker-write` to the run-start admit `--scope` in both `faff-graft/SKILL.md:164` and `faff-beep-boop/SKILL.md:438`, giving `merge,branch-delete,pr-create,push,label-write,file-write,tracker-write`. Rationale: the scope must admit the kind for the record to bind on a governed run; this is the last kind to add, completing the FAFF-1108 partition.

**Chosen:** Record-only, never a gate. A non-zero exit from either declare or observe is logged (one stderr note) and the status write proceeds. It is never a precondition. Skip the bracket entirely on an ungoverned run (no `<run_dir>/commissaire/governor/governor.json`) and on any status write with no run substrate (git-only, or a no-run-dir path such as `/faff-tidy`'s sweep). This matches the label-write rule's stance exactly: DETECTED, never prevented.

**Chosen:** No code-module change. `tracker-write` is already a first-class member of `EFFECT_KINDS` (`effects.js:67`), and `appendEffectEntries` / `computeEscapes` are reused unchanged from Slice B. The `faff status set` verb is not created, so `state.js` / the CLI dispatch gain no surface. The change is SKILL prose + admit scope + the validate-adapters line-cap baseline for the two edited SKILL files + the decisions-register entry.

**Punt:** The ship-slot `→ Done` write at merge. The `ship` slot (default `faffter-noon-ship`) is a separate producer that owns its own tracker write to Done at Step 10. Bracketing it belongs to the ship producer's own SKILL, across a slot boundary graft does not reach. It is a clean follow-up (govern the ship producer's Done write), filed separately rather than reaching across the boundary here. `(defers: a follow-up ticket)`

**Assumes:** The label-write rule's placement and mechanics (`faff effects declare/observe --run "$(basename "$run_dir")" --issue <ISSUE-XX> --step <step>` piping a descriptor array, bracketing the MCP write, best-effort try/caught) are the correct template. Verified against `SKILL.md:298` this prep.

**Assumes:** origin/main is the build base (currently `af256e47`, carrying Slices A + B). Verified this prep.

## Already shipped against this surface

- FAFF-1118 (Done, #948): pr-create chokepoint + merge-coupled branch-delete coattail. Added `pr-create` to `EFFECT_KINDS` and admit scope. Not superseding: this slice governs tracker-write, a different kind.
- FAFF-1119 (Done, #950): governed records for push, label, ADR/PRDR, worktree-prune. Added `push` to `EFFECT_KINDS`, established the governed-record prose pattern (the label-write rule at `SKILL.md:298`) this slice reuses, and admit scope `...,label-write,file-write`. Not superseding: it explicitly deferred tracker-write status transitions to this slice. This slice extends its pattern to the last kind.

The premise holds: FAFF-1108's DoD is not met until tracker-status is governed, and no Done ticket has governed it.

## Acceptance criteria

1. `faff-graft` SKILL prose carries a single governed tracker-write record rule (twin of the label-write rule), bracketing every agent-mediated status `save_issue` with a `tracker-write` declare-before / observe-after on a governed run, listing the five bound sites (Step 5 In Progress; In Review; superseded-done Done; the two hold releases to Todo).
2. The rule is explicitly record-only: an append failure logs and the status write proceeds; it is never a precondition; it is skipped on an ungoverned run and on any status write with no run substrate.
3. The label-write rule's "Status transitions … out of this slice (deferred to Slice C)" sentence (`SKILL.md:298`) is updated to reflect that Slice C now governs them (no longer deferred).
4. Run-start admit `--scope` includes `tracker-write` in both `faff-graft` and `faff-beep-boop` (`merge,branch-delete,pr-create,push,label-write,file-write,tracker-write`).
5. No `faff status set` CLI verb is introduced; `effects.js`, `state.js`, and the CLI dispatch are unchanged (`tracker-write` already exists as an `EFFECT_KIND`).
6. The status-set anti-pattern hold is recorded as a `## Decisions-register intent` on the ticket this prep, for graft to materialise into `docs/decisions.md` at Step 4c.
7. `validate-adapters` passes with the line-cap baselines for the two edited SKILL files bumped to their new sizes; the full existing suite stays green.
8. An `effects` test asserts a `tracker-write` descriptor passes `effectDescriptorViolations` and round-trips through declare/observe (extends the Slice B effects test coverage), confirming the kind the rule relies on is accepted.

confidence: high
build-tier: mechanical

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    {"marker": "chosen", "topic": "Hold the faff status set anti-pattern; govern tracker-status with a detection record, not a chokepoint"},
    {"marker": "chosen", "topic": "One shared governed tracker-write record rule mirroring the label-write rule"},
    {"marker": "chosen", "topic": "Bracket every graft-owned agent-mediated status write (five sites)"},
    {"marker": "chosen", "topic": "tracker-write descriptor shape and target string"},
    {"marker": "chosen", "topic": "Add tracker-write to admit --scope in graft and beep-boop"},
    {"marker": "chosen", "topic": "Record-only, never a gate; skip on ungoverned/no-substrate runs"},
    {"marker": "chosen", "topic": "No code-module change; tracker-write already an EFFECT_KIND"},
    {"marker": "punt", "topic": "The ship-slot Done write, deferred to a follow-up ticket across the slot boundary"},
    {"marker": "assumes", "topic": "The label-write rule mechanics are the correct template"},
    {"marker": "assumes", "topic": "origin/main (af256e47, Slices A+B) is the build base"}
  ]
}
```
