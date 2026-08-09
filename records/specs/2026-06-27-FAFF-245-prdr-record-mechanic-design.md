# PRDR Record Mechanic — Immutable, Supersedable Product-Requirements Decision Records

> Spec: faffter-dark-nlspec · 2026-06-26 · confidence: high (both Punts resolved 2026-06-27). FAFF-245.

**Artifact:** design spec for **FAFF-245** (re-framed). Defines the **record artifact + `faff prdr` CLI** — the foundational primitive of the PRDR layer. Stops at the *record mechanic*: authoring (FAFF-251), the two-gate bound (FAFF-255), adversarial review (FAFF-256), and DoD roll-up (FAFF-257) are sibling tickets.

> **Supersedes** the previously-attached `project-dod.yaml` manifest spec (reframed onto the PRD/PRDR layer). The manifest format + its readers + the withdrawn ADR-0014 intent are **not** carried forward.

## 1. WHY

faff has the decision-axis ADR (`faff adr`, numbered + supersedable) and now the product-axis root PRD (`faff prd`, FAFF-252, one immutable doc per container). It lacks the **product-axis decision record** — the supersedable decomposition between the immutable PRD and the per-slice spec. A monolithic PRD decays; the fix (`design/prdrs.md`) is to treat each product decision as a discrete record with the ADR mechanic (immutable, status-tracked, supersedable) so *current product truth = the non-superseded accepted set*. This ships the record + the CLI that writes it; nothing that judges or rolls up.

**Principles:** immutable + supersedable (never edited in place); mirror the ADR/PRD CLIs, don't reinvent; record-don't-judge (shape-validate only); lean validation (presence, not prose-shape).

## 2. OUT OF SCOPE
- Machine-authoring (L3 propose / L4 self-define) → **FAFF-251** (calls `prdr new`, fills the body).
- Two-gate bound + recursive-invariant enforcement → **FAFF-255** (reads `prdr list --live`).
- PRDR adversarial review (YAGNI guard) via methodology slot → **FAFF-256**.
- Per-PRDR DoD → PRD termination roll-up + status/gate verdicts → **FAFF-257**.
- Evaluator-checked completion → FAFF-34. Auto-applying the tracker container-link → orchestrator (CLI emits the line).

## 3. WHAT
```
ENUM PrdrStatus: Proposed | Accepted | Rejected | Superseded   # ADR enum minus Deprecated, plus Rejected
ENUM Provenance: human | loop

RECORD Prdr:
  number: Int            # global NNNN — stable identity for supersession (mirror ADR)
  slug, title, container: String   # container = the PRD container-slug it serves
  prd_goal: String       # cited PRD goal (provenance up the spine)
  status: PrdrStatus ; provenance: Provenance ; date: Date
  supersedes: Set<Int> ; superseded_by: Int?
  body: Markdown         # ## Context · ## Decision · ## Scope · ## Definition of done
  CONSTRAINT a record is live (Proposed/Accepted/Rejected) XOR superseded_by set
  CONSTRAINT supersession refs symmetric (old.superseded_by==new.number AND new.supersedes∋old.number)
```
**File:** `docs/prdr/NNNN-slug.md` (metadata header + the four body sections).
**CLI `faff prdr`:** `path` · `new <title> --container <slug> --prd-goal <g> [--provenance] [--status]` · `list [--json] [--container <slug>] [--live]` · `supersede <old> --by <new>` · `validate` · `--selftest`. New `tracking.prdr_docs_path` key (default `docs/prdr/`).

**Chosen — identity:** global `NNNN` + a `Container:` field (reuses the ADR supersession machinery verbatim; `--container` filter serves FAFF-257). Rejected slug-only (can't supersede) + container-scoped numbering (breaks the reusable validator).
**Chosen — PRD distinct from PRDR** (settled by FAFF-252 shipping the PRD as its own slug-keyed artifact; a PRDR *cites* its container's PRD).
**Chosen — status enum** `Proposed|Accepted|Rejected|Superseded`.

## 4. HOW
Three additive pieces: `cmdPrdr` fused from `cmdAdr`+`cmdPrd`; a `prdr_docs_path` resolver; **reuse** `adrField`/`adrSlug`/the supersession ref-parsers/the symmetric validator (no fork — call them, or factor a prefix-parameterised `recordSupersede`). `supersede` is the only in-place write (old Status value → "Superseded by PRDR-N"; new gains one idempotent "Supersedes: PRDR-old"); refuses self/double-supersede. `validate` = metadata present + status enum + contiguous numbering + four body sections present + **symmetric** supersession refs — never section *content*.

**Failure modes:** (a) bare mechanical supersede lets the loop replace product ends → *narrow*: 245 records provenance + the linker; authority *enforcement* is FAFF-255 (the record layer is not the safety boundary). (b) presence-only DoD admits a vacuous DoD → proceed (born-verifiable enforcement is FAFF-254/257). (c) global-numbering race → same as `adr new`; validate's duplicate check + orchestrator serialisation.
**Anti-patterns:** re-introducing the deleted manifest engine; asserting *what* a DoD says; forking the ADR helpers.

## 5. Scenarios
- No `docs/prdr/` → `list` empty, `validate` OK (0) — additive-only, no behaviour change.
- `prdr new "Booking flow" --container portal --prd-goal "..."` → `docs/prdr/0001-booking-flow.md` with full metadata + 4 sections; stdout = path only.
- `prdr supersede 1 --by 2` → 0001 "Superseded by PRDR-0002", 0002 "Supersedes: PRDR-0001", validate confirms symmetric.
- double-supersede refused, writes nothing.
- `prdr list --container portal --live --json` → only non-superseded (FAFF-257's input).

## 7. Resolved decisions (both Punts closed, human 2026-06-27)
- **P1 — provenance-authority enforcement locus → CHOSEN: enforce in the FAFF-255 gate; `faff prdr supersede` stays a pure mechanical linker.** Mirror `adr supersede` verbatim — **no** `--actor`/authority concept in the record CLI. The record layer *records* provenance (the `Provenance:` field) but is **not** the safety boundary; the recursive-setpoint invariant (a loop may not move its own setpoint; its enclosing loop may) is enforced one rung up, in FAFF-255's admission gate.
- **P2 — DoD-section validation depth → CHOSEN: presence-only; defer born-verifiable shape to FAFF-254/257.** `prdr validate` checks the four body sections **exist** (mirror `prd validate`'s lenient presence check) and **never** asserts *what* the `## Definition of done` says — a `_TODO_` DoD passes presence.

**Assumes:** FAFF-252's `faff prd` + resolver shipped (✓); the ADR supersession helpers reusable (✓); `faff prdr` is unclaimed (✓).

## 8. DONE
Mirrors the body 1:1 — the artifact + `tracking.prdr_docs_path` + the `prdr` actions (`path`/`new`/`list`/`supersede`/`validate`) + lenient symmetric presence-only validate + `--selftest`; additive-only (no `docs/prdr/` ⇒ unchanged). Smoke: new→new→supersede→validate→`list --live`→ fresh-repo empty.

confidence: high
