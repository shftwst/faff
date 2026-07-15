# FAFF-493 — L4 autonomy-envelope de-risk spike: express topology-write authority as a floor-safe contract, 216-free

> Spec: faffter-dark-nlspec · 2026-07-15 · autonomous · confidence: high. Full spec on Linear FAFF-493.
> _Revised 2026-07-14 (spec-review `revise`, rev 1): vocabulary aligned to the real `admit | propose-only | reject` enum; outward-only reframed as an upstream pre-filter._
> _Revised 2026-07-15 (autonomous stale-refresh): **punts closed by human resolution.** The envelope lives in a **separate referencing artifact / new ADR** (not a dial-table row), composing the appetite-keyed dial via the ADR-0037 L4-forces-`full` pin; **ADR-0069 sequencing is not a precondition** (citing PRDR-0001/0002 prose for outward-only suffices). Sole open output-Punt closed → re-rated **medium → high**; spec-review `approve` retained._

> Spike spec. The deliverable is a **settled decision + a named, conformance-checkable contract shape** — not a built feature.

## 1. WHY — Problem and Principles

**Load-bearing model.** The gateway already owns a *topology-write authority* dial (`plugin/skills/faff/SKILL.md:706-719`) keyed by **appetite** — `low`/`medium`/`high`/`full` — with **no level axis and no L4 row**. L4 reaches the `full` row only indirectly: ADR-0037 pins "at L4 appetite resolves to `full` unconditionally" (`docs/adr/0037-…:17`). So the L4 autonomy envelope the loop needs is not a new dial — it is a *contract that reads the existing `full` grant through the L4 pin and proves it stays inside the two standing floors*. The spike's whole job is to show that contract can be written without reaching for FAFF-216 (parked, feasibility-blocked); if it can't, the track halts.

**Problem statement.** The "top of the loop" plan pass (PRDR 0001) must hold every structure write inside "a defined autonomy envelope — topology-write-authority dial at L4, bounded by the reversibility and human-curated-structure floors, independent of FAFF-216" (`docs/prdr/0001-…:15`), but no such envelope contract exists yet and its feasibility is unproven. This spike answers *whether that envelope is expressible over the existing dial without 216* and, if so, emits the concrete contract FAFF-494/495 build against — failing fast and halting the track if the answer is no.

**Design principles** (any of these, violated, invalidates the spike's output):

- **Express the existing dial — do not grow a new floor.** ADR-0035 fixed "one definitional home" for the dial and its floors ("a grep for the table headers returns a single home", `docs/adr/0035-…:40`) and forbade forking "a second, divergent set of floors" (`:16`). The envelope must *compose with* the standing floors, never restate or relax them.
- **The narrowest scope that funds the loop.** Autonomous container creation is not required to plan a first slice — first-slice **epic** creation is. Prefer the envelope that leaves both floors intact over the one that lifts a floor to buy capability the loop does not yet need.
- **Independence is a proof obligation, not an aspiration.** "216-free" is a DONE criterion with concrete evidence (a clause-by-clause trace), not a claim in prose. A clause that can only be satisfied by 216's re-link/re-prioritise capability is a **halt**, not an edge to paper over.

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| Topology-write authority dial | `SKILL.md:706-719` | The existing appetite-keyed dial; the envelope expresses `full`-at-L4 as a contract over it. |
| ADR-0035 | `docs/adr/0035-…:16,31,40,42` | Decides the dial; reversibility floor (`:31`), one-definitional-home (`:40`), "`full` is the meaningful new capability *and* risk" (`:42`). |
| ADR-0037 | `docs/adr/0037-…:17` | "At L4 appetite resolves to `full` unconditionally" — the only path L4 reaches the dial. |
| faff-plot container floor | `faff-plot/SKILL.md:65,125` | "Containers always confirm… expensive to undo"; "only first-slice epics are appetite-creatable, and only under a confirmed parent." The floor the envelope collides with. |
| Human-curated-structure floor | `SKILL.md:473-485` (principle 3 `:479`), composition `:719` | "Never silently restructure human-curated structure"; propose-and-confirm, provenance-detected; the dial governs faff-authored topology only. |
| `faff prdr admit --actor loop` | `bin/lib/prdr.js:180-211`, `computePrdrAdmissionVerdict` (`contract-defs.js:689`); gateway `SKILL.md:1030-1034` | FAFF-495's existing gate — disposition enum `admit | propose-only | reject`; L4 self-Accepts within 255's two gates + FAFF-222 containment + appetite floor. |
| Contract registry | `bin/lib/contract-defs.js` (~`:1143`+) | Pattern B home: producer-emitted `faff-contract:<name>` block validated by a deterministic `faff contract <name>`. |

**Scope statement.** The de-risk gate at the head of the "top of the loop" track (PRDR 0001); FAFF-494 and FAFF-495 are its two consumers, FAFF-496 is a sibling spike owning the outward-only refusal taxonomy.

## 2. OUT OF SCOPE

- **Authoring ADR 0069 (outward-only).** The outward-only constraint is an **input**, not this spike's deliverable. ADR 0069 does not exist as a file yet (log runs `0001`–`0066`; `0069` forward-referenced only from `docs/prdr/0001-…:15,21` and `docs/prdr/0002-…`). **Why:** the self-directed-target *refusal taxonomy* is sibling spike FAFF-496's. **Resolution 2026-07-15:** authoring ADR-0069 is **not a precondition** for this spike's contract — the envelope cites the outward-only constraint as an `**Assumes:**` grounded in PRDR-0001/0002 prose; formalising ADR-0069 is FAFF-496's job.
- **Enforcing outward-only / self-directed-target refusal.** The envelope operates on an **already-outward-filtered op stream** (see §3 Assumes); the check runs upstream (run-start predicate + FAFF-496). The `l4_topology_envelope` function carries **no target axis** by design.
- **The FAFF-221 "Outward / new-root auto-create" hard-floor row** (`SKILL.md:700,726`). A *different axis* — scope-containment within a run's mandate subtree (`faff contain`), orthogonal to ADR-0069 outward-only. Do not conflate.
- **Lifting the container-confirm floor** (option (ii)). The recommended scope keeps it intact; lifting it is a larger, separate decision.
- **FAFF-216's structural self-curation.** Descoped, feasibility-blocked; the spike's entire premise is proving independence from it. If the envelope *requires* it → halt.
- **Building FAFF-494 / FAFF-495.** They consume the emitted contract; not built here. *(Right-sizing note, rev 1: the Pattern-B validator + fixtures are the emitted contract shape's proof-of-conformance; if their materialisation grows beyond throwaway spike scaffolding it splits to a thin follow-up the consumers pull — see the agile critique.)*

## 3. WHAT — Vocabulary, Types, and Interfaces

**The envelope decision, as a pure function** (the shape the spike must land):

```
FUNCTION l4_topology_envelope(op) -> verdict
  INPUT op:
    kind:        container-create | epic-create | reparent | convert | rehome | cancel | delete
    level:       L1..L4                       # L4 ⇒ appetite pinned full (ADR-0037)
    provenance:  faff-authored | human-curated
    parent_confirmed: bool
    # NOTE: no target/outward axis — outward-only is enforced upstream (§ Assumes)
  OUTPUT verdict:
    disposition: admit | propose-only | reject
    reason:      machine-readable token
    reversible:  bool                          # for FAFF-494's "logged + reversible" answer
```

The verdict vocabulary is deliberately the **admit / propose-only / reject** triad FAFF-495 already speaks (`computePrdrAdmissionVerdict`, `contract-defs.js:689`) — the envelope must not invent a fourth disposition, so a consumer that already reads `faff prdr admit` verdicts reads this one with no vocabulary translation.

**Design decisions** (rationale in §6):

- **Container scope at L4. Chosen: (i)** — the L4 topology-write envelope covers first-slice **epic** creation only; container (initiative/project) creation stays confirm-gated at every level including `full`, and the reversible reparent/convert/rehome ops the dial already grants at `full` remain in-envelope. Option (ii) — lifting the container-confirm floor for L4 — is rejected (§6); it is a strictly larger claim than the issue's "express the existing dial as a contract."
- **Where the envelope lives. Chosen: (a)** — a **separate referencing artifact**: a new L4-envelope ADR (next free number, **not** 0069) + a named contract that *reference* the dial by anchor and **compose it via the ADR-0037 L4-forces-`full` pin** — NOT a new row in the appetite-keyed table (a level row forks its axis and breaks the one-definitional-home policy, `ADR-0035:40`). *(Human resolution 2026-07-15 confirms separate-referencing-artifact over extend-dial-table; the prior "starting lean" is now a settled decision — preserves ADR-0035's one-definitional-home, since a level row would fork the appetite axis.)*
- **Contract shape. Chosen: (b) Pattern B** — a loop-emitted `faff-contract:l4-topology-envelope` block validated by a deterministic `faff contract l4-topology-envelope` registered in `contract-defs.js`, with a Pattern-C-style pure-function decision table as its core logic. FAFF-495 already consumes Pattern B; FAFF-494 needs a validated per-op verdict.
- **Gate routing. Chosen:** plan-time topology-writes route through the EXACT existing `faff prdr admit --actor loop` gate as an added precondition alongside 255's two gates + FAFF-222 containment + appetite floor (`SKILL.md:1030-1034`), never a parallel admission path — keeps idempotence/anti-thrash single-homed (`SKILL.md:717`). Because the envelope's disposition vocabulary is identical to the admit gate's, the verdict composes with no `refuse`↔`reject` remap.
- **Outward-only. Assumes:** the envelope operates on a **pre-filtered op stream** — the outward-only / self-directed-target check ("faff never plans itself") runs **upstream** of this contract (the run-start predicate + FAFF-496's refusal taxonomy), sourced from `docs/prdr/0001-…:15,21` and `docs/prdr/0002-…`. The `l4_topology_envelope` signature deliberately carries **no target axis** and does **not** re-enforce outward-only — enforcing it here would duplicate FAFF-496 and imply a target axis the contract shape doesn't have.
- **ADR 0069 precondition. Chosen: not a precondition** — citing PRDR-0001/0002 prose for the outward-only assumption suffices; the contract may cite outward-only as settled without ADR-0069 authored first. Authoring ADR-0069 is FAFF-496's job, not a blocker for this spike's contract. **(decides: architecture — closed by human resolution 2026-07-15.)**

## 4. HOW — Behaviour of the spike

```
PROCEDURE run_faff_493_spike:
  1. Draft the envelope decision table over the §3 pure function, admitting ONLY:
       - epic-create under a confirmed parent, faff-authored, at L4   -> admit
       - reparent | convert | rehome, faff-authored (reversible)      -> admit  (dial grants at full)
       - container-create (any level)                                 -> propose-only  (floor: always confirm)
       - anything touching human-curated provenance                   -> propose-only  (human-curated floor)
       - cancel | delete (any level)                                  -> reject        (reversibility floor)
  2. Two-floor conformance proof — for EACH admit row, cite the exact reversibility-floor
       (SKILL.md:718, ADR-0035:31) AND human-curated-floor (SKILL.md:479,485,719) clause that permits it.
       An admit row not covered by BOTH floors is a spec defect, not a widening.
  3. 216-independence trace — map EVERY envelope clause to an existing dial row / floor bullet /
       ADR-0035 / ADR-0037 clause. Assert zero clauses require re-link/re-prioritise of EXISTING
       machine-authored structure (FAFF-216's axis).
  4. IF step 2 or 3 fails to close -> HALT. ELSE emit the artifact (§8).
```

**The halt condition (a first-class outcome, never an edge).**

```
HALT the track IF EITHER:
  A. Autonomous first-slice epic-creation at L4 cannot be expressed without an operation that
     re-links or re-prioritises EXISTING machine-authored structure (FAFF-216's axis); OR
  B. Two-floor conformance can be met only by lifting a floor that FAFF-216 owns.
ON HALT: record the failing clause + which 216 capability it demanded; mark the track blocked;
  PRDR 0001 is superseded, not quietly widened (docs/prdr/0001-…:29); emit NO envelope contract.
```

**Timebox.** Short, fail-fast — **one spike session**, bounded to the analysis above with no code beyond the contract definition + fixtures. It does not iterate toward a green build; it closes steps 2–3 and emits, or halts. Steps 2–3 not decisively closed within the session is itself a halt signal.

**Failure modes.** (1) The envelope silently smuggles 216 — a step-3 clause with no non-216 mapping → halt. (2) Reversible reparent/convert/rehome rows touch human provenance → they degrade to `propose-only`; epic-create still holds. (3) Two-gate collision (envelope double-counts a 255 check) → define the envelope as a precondition *composed with*, not duplicating, the admit gates. (4) The record restates a floor instead of citing it → cite by anchor per ADR-0035:40.

**Anti-pattern:** adding an L4 row to the dial table — the table is appetite-keyed; express L4 via the ADR-0037 pin (the separate referencing artifact composes the pin, per the 2026-07-15 resolution).

## 5. SCENARIOS — born-verifiable spike objectives

```
Given the envelope decision table over the §3 pure function
When op {kind: epic-create, level: L4, provenance: faff-authored, parent_confirmed: true}
Then verdict {disposition: admit, reversible: true}, justified by BOTH floors' cited clauses
```
```
When op {kind: container-create, level: L4, provenance: faff-authored}
Then verdict {disposition: propose-only} (container-confirm floor holds at full — faff-plot/SKILL.md:65,125)
```
```
When op {kind: cancel|delete, any level} OR {kind: reparent, provenance: human-curated}
Then reject / propose-only respectively (reversibility + human-curated floors — SKILL.md:718,479)
```
```
Given the completed 216-independence trace
When every envelope clause is mapped to its source clause
Then zero clauses map to (or require) FAFF-216's re-link/re-prioritise capability; mapping is machine-inspectable
```

- The emitted `faff-contract:l4-topology-envelope` block passes `faff contract l4-topology-envelope` on every fixture row.
- The envelope admits **no** disposition outside `admit | propose-only | reject` (parity with `faff prdr admit`).

## 6. DESIGN DECISION RATIONALE

**Container scope: (i) epic-only vs (ii) lift the floor.** (i) keeps both floors intact, is genuinely "express the existing dial" (the issue's scope), and autonomous first-slice epic creation is all the plan pass needs (PRDR 0001 plans *to* first-slice epics). (ii) is a strictly larger claim, contradicts "containers are expensive to undo" and ADR-0035's caution that `full` is where a mis-set DoD does the most structural rearranging (`:42`), and raises the chance of needing 216. **Chosen: (i)** — floor-preserving, in-scope, lowest halt-risk. (ii) documented so no future reader re-proposes it without reopening the floor deliberately.

**Where it lives: (a) separate referencing artifact vs a new dial row.** A new row forks the appetite-keyed axis and breaks one-definitional-home (`ADR-0035:40`); a separate record composes the existing `full` row + ADR-0037 pin + two floors by citation. **Chosen: (a)** — **human-confirmed 2026-07-15** (separate referencing artifact / new ADR + named contract, not a dial-table row).

**Contract shape: A vs B vs C.** Pattern A (dial prose) isn't machine-consumable by FAFF-494; Pattern C (pure table) alone gives no emitted/validated block; Pattern B is what FAFF-495 already consumes and gives FAFF-494 a validated per-op verdict, with the C table as its internal logic. **Chosen: (b) Pattern B.**

**Gate routing: reuse vs parallel.** Parallel = two idempotence homes, divergence risk; reuse = single-homed. **Chosen: reuse**, composed (not duplicated) with the existing admit preconditions — and the shared `admit | propose-only | reject` vocabulary means the compose needs no verdict translation.

**ADR-0069 sequencing: precondition vs cite-prose.** Authoring ADR-0069 before the contract can name outward-only as settled would gate this spike on FAFF-496's deliverable. The outward-only assumption is already grounded in committed PRDR-0001/0002 prose. **Chosen: not a precondition** (human resolution 2026-07-15) — cite the PRDR prose; ADR-0069 authoring stays FAFF-496's.

*Temporal anchor:* at spec time the ADR log ends at `0066` and ADR 0069 is unwritten; the envelope cites PRDR 0001/0002 prose as the outward-only source.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

- **Chosen (was Punt, closed by human resolution 2026-07-15):** ADR 0069 (outward-only) authoring is **not** a precondition — the contract cites PRDR-0001/0002 prose for outward-only as settled; formalising ADR-0069 is FAFF-496's job. **(decides: architecture.)**
- **Assumes:** the op stream is **already outward-filtered** — faff decomposes only OUTWARD from a human PRD; a run-start predicate refuses self-directed targets **upstream** of this envelope. Source: `docs/prdr/0001-…:15,21`, `docs/prdr/0002-…`. Enforcement note: the self-directed-target refusal is discharged upstream (run-start predicate + FAFF-496), **not** by this contract — the §3 signature carries no target axis by design. If FAFF-496 / ADR-0069 later shift the outward-only semantics, the emitted contract needs revalidation.

## 8. DONE — machine-checkable spike-exit criteria

**From WHY**
- [ ] The artifact expresses the envelope as a contract over the existing dial (`SKILL.md:706-719`) via the ADR-0037 L4 pin — no new dial-table row.

**From WHAT (decisions)**
- [ ] Container scope recorded as **(i) epic-only**; container-create → `propose-only` at every level incl. L4.
- [ ] The envelope lives in a **separate referencing artifact** (new ADR, next free number, not 0069) + a named contract; the dial table gains at most a one-line composition anchor, not a row.
- [ ] The contract is **Pattern B**: a `faff-contract:l4-topology-envelope` block + a deterministic `faff contract l4-topology-envelope` validator in `contract-defs.js`, carrying fixtures.
- [ ] Verdict vocabulary is exactly `admit | propose-only | reject` (parity with `faff prdr admit`, `contract-defs.js:689`); the block exposes `reversible` for FAFF-494.
- [ ] Gate routing recorded as **reuse of `faff prdr admit --actor loop`** as an added precondition, not a parallel gate.
- [ ] Outward-only is recorded as an **upstream pre-filter** (run-start predicate + FAFF-496), citing PRDR-0001/0002 prose (ADR-0069 not a precondition); the function signature has no target axis.

**From HOW**
- [ ] Two-floor conformance proof: every `admit` row cites a clause of BOTH floors.
- [ ] 216-independence trace: every clause maps to an existing dial/floor/ADR clause, zero require FAFF-216's capability — OR the track is recorded as **halted** with the failing clause named.
- [ ] The halt condition is a recorded first-class branch: on either trigger, no contract is emitted and PRDR 0001 is marked superseded, not widened.

**From consumers**
- [ ] The block answers, per plot gate, what machine verdict replaces each interactive yes/edit/no (FAFF-494).
- [ ] The verdict is consumable as a precondition to `faff prdr admit --actor loop` (FAFF-495) without a second admission path and without vocabulary translation.

**Integration smoke test:**
```
1. l4_topology_envelope({kind: epic-create, level: L4, provenance: faff-authored, parent_confirmed: true})
   -> expect {disposition: admit, reversible: true}
2. Pipe the emitted faff-contract:l4-topology-envelope block through `faff contract l4-topology-envelope`
   -> exit 0 on conformant fixtures, exit 1 on a container-create-admit fixture, exit 2 on malformed
3. The 216-independence trace lists every clause with a non-216 source mapping
   -> if any clause maps only to 216, the run halts and emits no contract
```

---

confidence: high

---

### Revision 1 — spec-review `revise` fixes (2026-07-14)

Applied the two minor in-place seams from the single-pass review (architectural + infosec, both `minor`, no blocker):

1. **Vocabulary aligned (architectural).** The envelope's third disposition was `refuse`; the real PRDR enum (`computePrdrAdmissionVerdict`, `contract-defs.js:689`) is `reject`. Renamed throughout to `admit | propose-only | reject` so the verdict composes into `faff prdr admit` with **no** `refuse↔reject` remap.
2. **Outward-only reframed as an upstream pre-filter (infosec).** The §3 function has no target axis, so it cannot discharge "never admits a create targeting faff's own repo/backlog." Reframed: the envelope **assumes an already-outward-filtered op stream**; enforcement is delegated upstream (run-start predicate + FAFF-496), pinned in Out-of-scope + a DONE criterion.

Re-rated at rev 1: **confidence: medium** — the sole open Punt (ADR-0069 sequencing / envelope-home) remained.

### Revision 2 — punts closed by human resolution (2026-07-15, autonomous stale-refresh)

The spike's **sole open output-Punt** was closed by a human resolution comment:

1. **Envelope home (decides: architecture) — Chosen: separate referencing artifact.** The L4 autonomy-envelope lives in a **new ADR + named contract** that composes the existing appetite-keyed topology-write dial via the ADR-0037 L4-forces-`full` pin — **not** a new row in the dial table (preserves ADR-0035's one-definitional-home; a level row would fork the appetite axis). Confirms the spec's recorded starting lean.
2. **ADR-0069 sequencing (decides: architecture) — Chosen: not a precondition.** Citing PRDR-0001/0002 prose for the outward-only assumption suffices; authoring ADR-0069 is FAFF-496's job, not a blocker for this spike's contract.

With both punts closed, the `confidence: medium` (which existed **only** because of the open output-Punt) re-rates to **high**. Spec-review re-checked: the architecture-bearing moves (separate ADR + Pattern-B contract composing the dial via the ADR-0037 pin, no new dial row) were already approved (`b4f21123`) and are unchanged by the resolution → **spec-review: approve** retained. Routing: **fire-and-forget**, build-eligible as a spike — the spike still emits its written artifact + the HALT branch if the 216-independence trace fails.

---

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "provenance_present": true, "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```