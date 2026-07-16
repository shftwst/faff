# Spec — FAFF-494a: Autonomous plot re-entry — the gate-answering harness core

> Spec: faffter-dark-nlspec · 2026-07-16 · interactive · confidence: high. Full spec on Linear FAFF-494.

This is the buildable design for **FAFF-494a**, the core of autonomous top-down planning. It **revises** the prior medium-confidence FAFF-494 spec against a landed blocker (FAFF-515) and a scope split (494b → FAFF-521).

## 1. WHY — Problem and Principles

`/faff-plot` already decomposes an application-scale brief top-down into initiatives → projects → first-slice epics, but **interactively**: at every level it stops and asks a human a per-level gate. This ticket ships a harness that, for each of those human gates, **computes an automated verdict from a shipped deterministic contract** (`faff contract l4-topology-envelope`) instead of asking — recursing top-down, doing every reversible admitted op idempotently, and parking cleanly the moment the contract says `propose-only`. The gate→verdict seam is the whole ticket; everything else is the driver, the logging, and the parking around it.

**What changed since the prior spec (the revise).**
- **Blocker FAFF-515 landed** (merged PR #395, commit `3884e63`). The `l4-topology-envelope` `container-create` verdict now **admits** a loop-authored container contained under the run's admitted root PRD (`contained_under_accepted_prd===true` at L4). Full-depth autonomous planning is **reachable**: one human PRD Accept at the root lets the harness auto-create the whole container tree *and* the epics under it. Prior Punt **P4 (reachability) is closed**.
- **The split landed.** Run-start OUTWARD-only *enforcement* + refusal taxonomy moved to **FAFF-521** (494b). Prior §3 and Punt **P1** are not in this ticket; it ships only a ~5-line stub ignition guard.
- **The ignition surface is decided** (operator): `/faff-plot --autonomous`, self-minting its own L4 run-ledger via the lights-out preflight. Prior Punt **P3 is closed**.

**Design principles** (each would cause rejection of an otherwise-valid build):
- **The contract decides; the harness never re-judges topology authority.** Every gate answer is `faff contract l4-topology-envelope`'s disposition, taken only after the CLI validates it. No hand-rolled reversibility/containment check — that logic is `l4TopologyDecision`, and duplicating it is drift-by-construction.
- **Reversible-by-construction.** The envelope `reject`s every irreversible op (`cancel`/`delete`) unconditionally, so the harness *structurally cannot* take an irreversible answer.
- **Finish forward; never roll back.** A refused branch parks and the pass continues its siblings; rollback would itself be a destructive topology write.
- **Author, never admit, at the project tier.** At Step 5b the harness authors a `Proposed` PRDR and stops. Admission is FAFF-495.

## 2. OUT OF SCOPE
- **Run-start OUTWARD-only enforcement + refusal taxonomy** → **FAFF-521** (494b). This ticket ships only the ~5-line stub guard; 521 replaces its body.
- **PRDR admission at the project tier** → **FAFF-495** (parallel track). Step-5b authors `Proposed`; 495 wires the admit call after it.
- **The full run-start trigger + refusal taxonomy** → **FAFF-496**.
- **Interactive plot behaviour** — unchanged; the `--autonomous` branch is additive.
- **Autonomous *rehome* pass** — rehome keeps its own `.faff/intake/…` write-and-surface fallback.

## 3. WHAT — the op record (piped to `faff contract l4-topology-envelope`)

```
RECORD Op:
  kind: Enum{container-create, epic-create, reparent, convert, rehome, cancel, delete}   # L4_ENVELOPE_OP_KINDS
  level: Enum{L1, L2, L3, L4}                    # always "L4" for this harness
  provenance: Enum{faff-authored, human-curated} # human-curated ⇒ always propose-only
  parent_confirmed: Boolean                      # gates epic-create admit
  contained_under_accepted_prd: Boolean          # gates container-create admit
```

The CLI **re-derives** the expected verdict from `op` via `l4TopologyDecision` and rejects a non-conforming claim (Pattern-B validator — never trusts a declared disposition). The harness builds the op honestly, pipes it, acts on the validated disposition.

**Chosen — where the topology judgement lives:** the harness computes `op` from run/tracker state, calls the contract, branches on the returned disposition; it re-implements none of `l4TopologyDecision`. (Rejected: a harness-local reversibility/containment check — forks the authority table.)

## 3b. Honest op construction (write-time, not agent-asserted) — spec revision r2

The three admit-gating booleans are **derived from live reads**, never hard-coded or carried from a cached read:

- **`contained_under_accepted_prd`** is the verdict of `faff contain <node> --parent <resolved-parent> --ancestry <ancestry> --record <run-id> --phase plot`, where `<ancestry>` is read **live from the tracker at construction time** (the node's parent chain up to the run ledger's `prd_root_container`). `contained` (exit 0) → `true`; `outward` (exit 3) → `false`. **Chosen:** the boolean is *the recorded contain verdict*, not an agent assertion — so the audit trail exists by construction.
- **`parent_confirmed`** is `true` **only** for a parent created/confirmed earlier in *this* pass (tracked in the pass's created-set) or the admitted root itself — never inferred for a pre-existing node.
- **`provenance`** is `faff-authored` **only** for a node this pass created (or a prior loop node bearing the `initiated: autonomous` stamp); anything else is `human-curated`. **When in doubt → `human-curated`** (fail-safe to propose-only).

**Chosen — write-time containment gate.** Every autonomous container/epic create is **immediately preceded by its recorded `faff contain --record … --phase plot` containment-check**. A create with no matching recorded `contained` verdict is an integrity violation `faff audit` flags — turning the backstop from advisory into a mechanical, born-verifiable gate.

### Added DONE items (r2)
- [ ] `contained_under_accepted_prd` / `parent_confirmed` / `provenance` are derived from live reads (tracker ancestry + the pass created-set), never hard-coded — grep shows no literal `true` at the op-build site.
- [ ] Every autonomous container/epic create is preceded by a recorded `containment-check` event (via `faff contain --record … --phase plot`); a create lacking a matching recorded `contained` verdict fails `faff audit`.
- [ ] The integration smoke asserts `faff audit` runs **clean** (no `containment_mismatches`, no unrecorded creates) after the 2-node pass.

### Residual (bounded, out of this ticket's threat model)
`faff audit` recomputes from the *recorded* ancestry, so it catches an unrecorded create or one whose recorded verdict was `outward` — but not a *falsified live ancestry read* (a same-context agent lying to itself at construction time). That is the custody/write-authority axis (FAFF-518 digest custody, FAFF-519 write-authority), **not** this harness's job. **Assumes:** the live tracker read at construction time is truthful; adversarial self-falsification is deferred to that track. Blast radius here is bounded regardless: cancel/delete are structurally rejected (worst case is a *reversible* extra create), every node is stamped `initiated: autonomous` (attribution + one-query undo), and ignition is manual-only.

## 4. HOW — the gate→verdict mapping (the core seam)

| Interactive plot gate | Op (`kind` / key fields) | Disposition | Autonomous action |
|---|---|---|---|
| Container under the accepted root | `container-create`, L4, faff-authored, `contained_under_accepted_prd=true` | **admit** | create idempotently, stamp `initiated: autonomous`, log; descend |
| Container **outside** the accepted root | `container-create`, …`contained_under_accepted_prd=false` | **propose-only** | create nothing; surface; HALT descent; park (`plot-halt: would-need-new-root`) |
| First-slice epic under a confirmed project | `epic-create`, L4, faff-authored, `parent_confirmed=true` | **admit** | create idempotently, stamp, `intake-record --initiated autonomous`, log |
| Epic under an unconfirmed parent | `epic-create`, …`parent_confirmed=false` | **propose-only** | surface; HALT descent; park |
| Reparent/convert/rehome of a **loop-authored** node | `reparent`\|`convert`\|`rehome`, faff-authored | **admit** | do idempotently (reversible), stamp, log |
| Any op on **human-curated** structure | any kind, `provenance=human-curated` | **propose-only** | never restructure; surface + park |
| Cancel/delete | `cancel`\|`delete` | **reject** | never taken — a reject halts + logs a refusal |
| Step-5b project DoD | *(not an envelope op — see §8)* | n/a | author a `Proposed` PRDR; never admit (FAFF-495) |

**Anti-pattern:** re-checking reversibility/containment in the harness before calling the contract (the contract *is* that check). **Anti-pattern:** rolling back created nodes when a sibling parks (rollback is a destructive write the envelope rejects anyway; finish forward, stamp everything `initiated: autonomous`).

**Fail-safe:** contract fail-loud (malformed op / disposition mismatch) → treat as a park, never an implicit admit. Absence of a clean `admit` is never a write.

## 5. HOW — Ignition (`/faff-plot --autonomous`) + the stub guard

**Chosen:** a new `--autonomous` argument to `/faff-plot`, which self-mints its own **L4 run-ledger via the lights-out preflight**, then runs the §4 driver. (Rejected: a dedicated `faff plot` subcommand — larger surface, no reuse; a beep-boop-carried ledger — beep-boop doesn't invoke plot.)

**The stub ignition guard (this ticket ships ~5 lines only):** a single fail-closed refusal point asserting the pass ignited behind a minted L4 ledger — the *shape* FAFF-521 hardens into the full OUTWARD-only run-start enforcement. **Chosen:** manually ignited only — `/faff-beep-boop` does not invoke it (unchanged).

## 6. HOW — Decompose-only HALT
Two triggers stop descent while the pass finishes siblings:
1. **Branch not concretely derivable** → park `plot-halt: branch needs discovery`, continue siblings, create nothing.
2. **Would need a new root (outward)** → confirmed via `faff contain <mandate> --parent <p> --ancestry <json> --record <run-id> --phase plot`; an `outward` verdict means not contained under the admitted root; create nothing, surface for `/faff-jot`, park. `faff contain` is pure and records a `containment-check` event so `faff audit` can recompute-and-compare (detective control).

**Assumes:** `faff contain --phase plot` is accepted. Today `event_phases` is `run|tidy|prep|build` — `plot` is absent, so `--phase plot` exits 2. Validate; if it exits 2, add `"plot"` to `event_phases` (one-line change, in scope). *(decides: architecture)*

## 7. HOW — Logging, reversibility, parking
- **Logging:** every gate answer is one durable entry `{op, disposition, reason, outcome}` (outcome ∈ created/proposed-only/refused/skipped-idempotent) per the gateway `.faff/logging` rule.
- **Reversibility:** every created node stamped `initiated: autonomous` (the marker a human greps to undo the pass); the envelope rejects `cancel`/`delete` so the harness can't take an irreversible answer — reversibility is structural.
- **Parking:** any `propose-only`/`reject`/fail-loud parks via the shared Park protocol; the pass finishes forward and surfaces the park set for `/faff-wtf`. No rollback.

## 8. HOW — Step-5b defers (author `Proposed`, never admit)
For each created project: call the methodology's `prdr-author` → `faff prdr new --provenance loop --status Proposed`; do **not** admit. Admission (`faff prdr admit` two-gate → `prdr accept --actor loop`) is FAFF-495; both the author path and the admit producer are shipped (FAFF-463/255), so this boundary is buildable now with no hard blocker. The `Proposed` record is the handoff point 495 picks up.

**Assumes:** `faff prdr new --provenance loop --status Proposed` writes a `Proposed`, loop-provenance record (verified shipped — prdr.js).

## 9. DONE — Definition of Done

**Gate→verdict seam**
- [ ] For each gate the harness builds an `op` (`level:"L4"`) and pipes `{op, verdict}` to `faff contract l4-topology-envelope`; it writes only on a validated `admit`.
- [ ] No local re-implementation of `l4TopologyDecision` (grep shows the branch reads the CLI disposition only).
- [ ] `container-create` under the accepted root → admit → created; outside → propose-only → not created + parked.
- [ ] `epic-create` under a confirmed parent → admit; unconfirmed → propose-only.
- [ ] A `human-curated`-provenance op is never written (propose-only), verified by a test op.

**Ignition**
- [ ] `/faff-plot --autonomous` self-mints an L4 run-ledger and refuses (fail-closed) if the stub guard finds none; the stub is a single refusal point (~5 lines) marked with FAFF-521 as its hardening extension.
- [ ] Interactive `/faff-plot` + `/faff-plot rehome` behaviour byte-unchanged; `/faff-beep-boop` still does not invoke plot.

**HALT**
- [ ] A not-derivable branch parks `plot-halt: branch needs discovery` and the pass continues siblings, creating nothing.
- [ ] An outward branch is recorded via `faff contain … --record <run-id> --phase plot` with an `outward` verdict; nothing created; surfaced for `/faff-jot`.

**Logging / reversibility / parking**
- [ ] Every gate answer writes one `.faff/` log entry `{op, disposition, reason, outcome}`.
- [ ] Every created node carries `initiated: autonomous`, discoverable by one query.
- [ ] No `cancel`/`delete` op is ever performed (contract rejects; harness logs refused).
- [ ] Any propose-only/reject/fail-loud parks via the shared Park protocol; the pass finishes forward and surfaces the park set.

**Step 5b**
- [ ] Each created project gets exactly one `Proposed` PRDR via `faff prdr new --provenance loop --status Proposed`; none admitted.

**Integration smoke**
```
1. Mint an L4 ledger with an admitted root PRD container R.
2. /faff-plot --autonomous over a two-node brief: child container C under R, one epic E under C.
3. ASSERT container-create op for C → admit → C created, stamped initiated: autonomous.
4. ASSERT epic-create op for E (parent_confirmed=true) → admit → E created + stamped.
5. ASSERT a Proposed PRDR authored for C's project tier, none admitted.
6. ASSERT one log entry per gate; zero cancel/delete ops.
```

## 10. Open Questions and Assumptions
**Open Questions:** none. (Prior Punts P1/P3/P4 resolved — by the split, the operator decision, and the FAFF-515 landing.)

**Assumptions:**
- `faff contain --phase plot` — needs a one-line `event_phases` addition (in scope). *(decides: architecture)*
- `faff prdr new --provenance loop --status Proposed` authors a `Proposed` loop record (verified shipped).
- The lights-out preflight mints an L4 run-ledger the ignition guard can assert on (verified in gateway prose).

confidence: high
