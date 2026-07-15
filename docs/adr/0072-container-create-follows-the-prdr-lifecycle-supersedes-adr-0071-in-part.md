# ADR 0072 — Container-create follows the PRDR lifecycle — supersedes ADR-0071 in part

- **Status:** Proposed
- **Date:** 2026-07-15
- **Issue:** FAFF-515
- **Supersedes (in part):** ADR-0071 — only its `container-create → propose-only, any level` row and that row's container-confirm-floor citation. Every other ADR-0071 row (epic-create scope, reparent/convert/rehome, human-curated, cancel/delete), its two-floor methodology, and its 216-independence trace stay in force. This is the ADR log's **first supersede-in-part**; the back-pointer mechanic follows the ADR-0004 `**Amended:**` header precedent (the log's only prior amend header — no full `Superseded` flip, since ADR-0071's other decisions are not retired).

## Context

ADR-0071 shipped the L4 topology-write envelope with a deliberately preserved floor: `container-create → propose-only` at every level including `full`, documented in its Consequences precisely "so no future reader re-proposes it without reopening the floor deliberately." This ADR is that deliberate reopening (FAFF-515), grounded in a unification ADR-0071 did not consider:

**A tracker container (initiative/project) and a git PRDR are the same abstraction in different media** — a scoped node with a definition of done. FAFF-245 pairs a project 1:1 with a PRDR: the container *is* the tracker-medium home of exactly one PRDR (its DoD). Only the write path (`save_project` vs a `docs/prdr/` commit) and the reversal mechanic (archive/reparent vs revert-via-PR) are medium-specific; the governing rules are medium-independent. The PRDR lifecycle already has a two-gate rule — the human Accepts the **root** once; everything contained beneath an Accepted root is loop-admittable (`faff prdr admit --actor loop`, FAFF-495's gate). A bespoke per-container confirm on the tracker side therefore (a) puts a loop-created project and a loop-created epic — the same safety class: reversible, provenance-stamped, contained, non-PR-gated tracker writes — in different regimes for no principled reason, and (b) **double-charges the human**: the PRD admission at run-start was already the scoping gesture, and waking the human to "confirm these 5 projects" defeats the lights-out capability FAFF-494 exists to deliver.

## Decision

**`container-create` (initiative/project) is governed by the PRDR lifecycle rules applied to the tracker medium, not a bespoke topology rule.** The unification, rule for rule:

| PRDR rule (git) | Container rule (tracker) — same rule |
|---|---|
| `--provenance loop`, born `Proposed` | container stamped `initiated: autonomous` (the FAFF-494/495 harness's stamp) |
| loop supersedes **loop** PRDRs, never **human** | loop (re)shapes **loop** containers, never restructures **human** ones (provenance is the discriminator) |
| FAFF-222 containment — can't escape the parent's scope | container can't escape the human PRD's subtree (`faff contain ⇒ contained`) |
| reversible (status flip / revert-via-PR) | reversible (archive / reparent) |
| two-gate: human Accepts the ROOT; loop admits contained sub-PRDRs (`--actor loop`) | same: human Accepts the root PRD; loop creates + admits contained sub-containers |

**The changed row** (`l4TopologyDecision`, `bin/lib/contract-defs.js` — all other rows and the outermost-in floor ordering unchanged):

| `op` | `disposition` | `reversible` |
|---|---|---|
| `container-create`, `L4`, `faff-authored`, `contained_under_accepted_prd: true` | `admit` | `true` |
| `container-create` — not L4, or signal false | `propose-only` | `true` |

**The signal.** The op gains one caller-asserted boolean, `contained_under_accepted_prd` — true iff (a) the run's ledger records an admissible root PRD (`prd_root_container`, persisted at L4 mint beside `prd_creative_licence` from the run-start `prd-readiness` gate's `admissible` verdict — the "human-Accepted root PRD" referent is **run-scoped**, not a new PRD `Status:` value), and (b) `faff contain` returns `contained` for the op's target parent chain against that root's subtree. Same trust posture as `parent_confirmed`: detective, not preventive (FAFF-354); the pure decision function never reads the tracker or the ledger. Required on every op kind; absent/non-boolean fails loud (exit 2). Fail-safe direction: no admitted root PRD ⇒ null ledger record ⇒ signal false ⇒ container-create stays confirm-gated — which makes this a **no-op for faff-on-itself** (no self-PRD by policy, ADR-0069) and unlocks only the greenfield/adopter case.

**Gate-routing composition clause.** ADR-0071's Decision routes plan-time topology writes through `faff prdr admit --actor loop` ("never a parallel admission path") — a clause that never contemplated an admitted container-create class. The composition is **with, not through, that gate**, sequentially: the envelope admits the *tracker write* (may this container exist?); the paired PRDR is then authored (`--provenance loop`, born `Proposed`) and content-gated by `faff prdr admit --actor loop` (is this DoD warranted — trace-to-goal, YAGNI, coverage?); a rejected PRDR reverses the container (archive/reparent — the admit row's `reversible: true` is load-bearing). Two single-purpose gates in sequence over two artifacts — not a parallel admission path, and no double-gate.

**Tier scope.** The unification covers the PRDR-carrying tier (initiative/project) only. Epics carry specs, not PRDRs — they stay governed by spec-readiness and ADR-0071's epic-create row unchanged. **Widened `parent_confirmed` definition (documentation, no code change):** for full-depth decomposition to compose, `parent_confirmed` on an `epic-create` op is *defined* as satisfied when the parent was human-confirmed **or** envelope-admitted under the accepted root — otherwise epics under loop-admitted containers would silently re-require the per-container human confirm this ADR removes.

## Two-floor conformance citation (the new admit row)

Per ADR-0071's methodology, the new `admit` row cites both floors:

- **Reversibility floor** — container-create is pure scope-addition ("`full` adds scope … but never removes it", gateway `SKILL.md` hard floor) and reversible via archive/reparent, tracker-native, no data loss. Cancel/delete stay `reject` at every level; nothing here touches that row.
- **Human-curated-structure floor** — a loop-authored container contained under the accepted root never touches human-curated structure: the root PRD Accept *is* the propose-and-confirm gate applied at the root, once — the same shape as the epic row's "parent-confirm is the gate applied one level up." The human-curated floor row stays ordered **before** the container-create row, so `provenance: human-curated` pre-empts a true signal (fixture-pinned: `conformant-container-create-human-curated-with-signal-propose-only`).

## 216-independence

A fresh create, never a re-link/re-prioritise of existing machine-authored structure — ADR-0071's trace extends, it does not reopen. This unlocks create-all-the-way-down; restructuring an *existing* container (even loop-authored) is still FAFF-216's axis and still gated.

## Counter to FAFF-493's rejection reasoning

The FAFF-493 spec (§6) out-scoped this lift on two grounds, both answered rather than waved off:

- *"Containers are expensive to undo"* — the expense was per-container **human attention**, now correctly charged once at the root; the container itself is reversible (archive/reparent), provenance-stamped, and contained, so the undo mechanic is tracker-native and lossless.
- *"Raises the chance of needing FAFF-216"* — the boundary is kept: **creation** is admitted, restructuring existing containers remains 216's axis and remains gated. The widened envelope adds no re-link/re-prioritise capability.

## Consequences

- **One human Accept at the root buys full-depth autonomous decomposition below it.** FAFF-494's plan pass creates contained containers without waking the human per container; FAFF-495's `faff prdr admit --actor loop` is the container-create content authority (the sequential composition above).
- **Every other ADR-0071 boundary is unchanged**: outward / new-root container-create stays gated (a new root PRD needs a human Accept; the outward-only floor and `faff contain` chokepoints are untouched); human-curated containers are never restructured; cancel/delete stay `reject`; the envelope op stays target-axis-free (FAFF-493's do-not-conflate Chosen holds — outwardness is folded into the asserted signal's *semantics*, computed by the caller via `faff contain`, never a new op axis).
- **Outward-only stays a soft precondition — inherited and restated against the widened admit.** ADR-0071 flagged that changes to the envelope's `op` shape need revalidation against the outward-only assumption; this ADR both makes such a change (the new field) and lifts the one floor ADR-0071 preserved, so the flag binds *harder* here: the upstream outward pre-filter (run-start predicate + refusal taxonomy) is **FAFF-496's job and is not yet built** — until it ships, outward enforcement rests on the caller-asserted signal's semantics plus the detective `faff audit` recompute (ledger `prd_root_container` + fresh `faff contain`), not a preventive mechanism. If FAFF-496 later shifts outward-only's semantics, this admit row needs revalidation — flagged, not blocking, exactly as ADR-0071 flagged it.
- **The refuse path is regression-locked**: `contained_under_accepted_prd: false ⇒ propose-only` is pinned as an inline fixture and a golden case (`test/golden/contracts/cases.json`), so the fail-safe direction cannot silently drift.
- **Note on ADR numbering:** ADR-0071's Context forward-references "ADR-0069" as a future outward-only ADR — a stale numbering collision (0069 is the Accepted no-self-PRD ADR). This ADR cites outward-only from the PRDR-0001/0002 prose and FAFF-496, never as "ADR-0069"; do not propagate the stale reference.
