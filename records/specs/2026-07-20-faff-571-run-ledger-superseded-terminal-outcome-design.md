# nlspec — FAFF-571: a first-class `superseded` run-ledger terminal outcome

> Spec: faffter-dark-nlspec · 2026-07-20 · interactive · confidence: high. Full spec on Linear FAFF-571.

> **Revised 2026-07-20 (refresh).** Resolved the load-bearing scope Punt: this ticket is now **Chosen** as the **consumer-side** first-class `superseded` outcome only. The graft build-time **producer** close-path (emit `superseded-done` + write `supersession.json`) is filed as sibling **FAFF-573** (blocked-by FAFF-571, relates-to FAFF-571). The git-only-verification and prep-park-routing Punts are resolved too (below). Re-rated **medium → high**.

This is a buildable specification for FAFF-571, addressed to the build agent that will implement it and the human reviewers who gate it. It adds a `superseded` terminal outcome to faff's run-ledger vocabulary and teaches the run-end integrity gates (runcheck, reconcile, disposition, run-summary) to treat it as a first-class, consistent, clean outcome — distinct from `shipped`. It is deliberately scoped to the **consumer** side of that outcome; the **producer** that would emit it autonomously is a separate ticket (FAFF-573) and is called out prominently below.

## 1. WHY — Problem and Principles

**The load-bearing model.** The run-ledger records exactly one terminal `outcome` per admitted issue, drawn from a *closed* vocabulary (`DELIVERY_PROFILE.terminal_states`). Every run-end integrity gate — runcheck (completeness), reconcile (ground-truth), disposition (process-exit), the run summary (reporting) — reads that one string and branches on it. Today `shipped` is overloaded to mean two structurally different things: *this run built and merged a PR*, and *the deliverables were already on `main` via other tickets, so this run merged nothing but the work is delivered*. Reconcile's core model is `shipped ⟹ a merge-record.json exists and its head-sha matches the forge`. The second meaning has no merge-record, so it fails that model closed — a false-positive divergence. The fix is to give the second meaning **its own terminal string** so each gate can key on it cleanly, instead of forcing every `shipped` consumer to branch on a sidecar field.

**Problem statement.** When issue FAFF-551 reached Done by premise-supersession (its deliverables already shipped on `main` via FAFF-556/#433, FAFF-557/#434, FAFF-559/#435), the only ledger string that satisfied runcheck's `admitted − outcomes = ∅` invariant was `shipped` — recorded by a hand-applied ledger edit with an `outcome_details.delivery="superseded"` sidecar. That is misleading (it reads as a fresh merge) and, at L4, reconcile would ESCALATE it to a false `needs-human` on a genuinely-complete run (no merge-record → `recorded:null` → `claimed-shipped-unmerged`). This change adds a `superseded` terminal outcome, teaches runcheck to accept it, teaches reconcile to affirm it as *consistent* when its evidence artifact names delivering tickets verifiably on `main`, and gives it its own honest reporting bucket.

**A forward-compatible consumer (read this first).** This ticket ships the **consumer** of a `superseded` outcome and **defines the evidence-artifact contract** (`supersession.json`, §3) that a future producer must satisfy. It ships **no producer**. Today **nothing writes `supersession.json`** — verified: `grep -rn "supersession.json" plugin/ docs/` returns no run-ledger writer (only ADR/PRDR *record*-supersession, an unrelated concept), and graft's return vocabulary has no delivered-elsewhere token. The FAFF-551 case that motivated this bug was a **hand-applied ledger workaround**, not a code path. So until the producer sibling (**FAFF-573**) ships, the only `superseded` outcomes in the wild are **hand-authored** ledger edits. This is deliberate and honest: the consumer lands first with a documented contract, is correct in isolation the moment *any* `superseded` outcome is recorded (by hand now, by FAFF-573's producer later), and fixes both symptoms whenever one is.

**Design principles.**

- **Additive closed-vocabulary change only.** `DELIVERY_PROFILE`'s two lists are closed vocabularies with a byte-identical invariant and a dialect-independence proof (`SECOND_PROFILE`). `superseded` is added as a new string to both — never a restructuring of the lists, never a new nested shape. `validateProfileShape` and the `SECOND_PROFILE` proof must still hold unchanged (they are shape/behaviour checks, agnostic to which strings are present).
- **Fail closed on unproven supersession.** Mirroring reconcile's existing posture (`shipped` with no merge evidence is a divergence, never a silent pass), a `superseded` outcome whose evidence is missing, malformed, or names tickets not verifiably delivered is a **new divergence class**, never a pass. Absence of proof is a divergence.
- **Purity of the reconcile core is preserved.** `reconcile.js` stays a pure, no-I/O classifier. All live observation (tracker/git reads of the delivering tickets' state) happens in the orchestrator's impure evidence-gathering half (beep-boop step 11.5), exactly as it does for `shipped`.
- **Reporting must stay honest.** A `superseded` issue merged no code this run. It gets its own summary section citing the delivering ticket IDs — it is never rendered as a `## Shipped (…)` subsection, because it is now its own terminal bucket, not a shipped-rendering.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node.js | `DELIVERY_PROFILE` (the two closed vocab lists; `terminal_states` 6, `ledger_outcomes` 7), `validateProfileShape`, `SECOND_PROFILE`, `profilesSelftest` |
| `plugin/skills/faff/bin/lib/runcheck.js` | Node.js | `TERMINAL_STATES = new Set(DELIVERY_PROFILE.terminal_states)`; `auditLedger` outcome validation |
| `plugin/skills/faff/bin/lib/reconcile.js` | Node.js | pure core: `reconcileShipped`, `reconcileSibling`, `reconcileCore`, `validateReconcileInput`, `isNamedEntry`, `DIVERGENCE_CLASSES`, `RECONCILE_SELFTEST_CASES` |
| `plugin/skills/faff/bin/lib/disposition.js` | Node.js | `ATTENTION_OUTCOMES` (line 27), `computeDisposition`, `DISPOSITION_SELFTEST_CASES` |
| `plugin/skills/faff/bin/lib/governance-check.js` | Node.js | `resolveTargetIssues` (line ~179) — filters outcomes whose value ∈ `TERMINAL_STATES` |
| `plugin/skills/faff/bin/lib/events.js` | Node.js | `issue-outcome` event's `data.outcome` validated against `DELIVERY_PROFILE.ledger_outcomes` |
| `test/profiles.test.mjs` | Node.js (test) | asserts the exact `terminal_states` / `ledger_outcomes` arrays (lines 47-48) — will need updating |
| `plugin/skills/faff-beep-boop/SKILL.md` | prose | step 11.5 reconcile input assembly; step 11.6 post-merge; run-ledger `outcomes` doc; run-summary buckets |
| `plugin/skills/faff-prep/SKILL.md` | prose | the existing premise-superseded gate — currently PARKS, does not close-Done |
| `plugin/skills/faff-graft/SKILL.md` | prose | graft's return-value vocabulary (~line 574-583) — has no delivered-elsewhere token (the producer, FAFF-573, adds one) |

**Scope statement.** This sits at the run-end integrity layer of `/faff-beep-boop` — the ledger-vocabulary + verification + reporting seam that turns per-issue outcomes into a trustworthy run verdict. **Consumer side only** — see §2.

## 2. OUT OF SCOPE

- **The graft producer close-path (writing `superseded`) → sibling FAFF-573.** Excluded, and now a **filed** sibling ticket (**FAFF-573**, blocked-by FAFF-571). graft has no build-time premise-superseded close-path: its return vocabulary (`ineligible`, `blocked`, `inadmissible`, `shipped`, `pr-open-for-human`, `needs-human`, `retry-later`, `parked`, `errored`) has no "delivered-elsewhere, close Done without a PR" token, and there is no `supersession.json` writer anywhere in `plugin/` or `docs/` (verified). Building that (decide at build time deliverables are on `main`, write the evidence artifact, move the issue Done, return a new token, open no PR) is a non-trivial architectural addition, deferred so the consumer contract lands first. **Extension point:** a new terminal return token in `faff-graft/SKILL.md` (~line 574-583) plus a `supersession.json` writer keyed to the §3 schema here — exactly FAFF-573's scope. Until it lands, `superseded` is reachable only via the manual ledger edit the live run used (§7 Assumptions).
- **A `faff contract` validator for `supersession.json`.** Excluded. `supersession.json` is a trusted graft-written artifact of the *same class as `merge-record.json`* — it has no `faff contract` schema validator; it is validated *structurally* by reconcile's input-assembly step. **Extension point:** if a validator is later wanted, it would live in `contract-defs.js` alongside the other contract definitions.
- **prep's existing premise-superseded PARK behaviour, and whether it should route into the producer close-path.** Excluded — this is a **producer-side** question, moved to **FAFF-573** (it is coupled to the close-path that ticket builds). `faff-prep`'s premise-superseded gate continues to park (cause `premise-superseded`) unchanged by this ticket.
- **Budget / economics / events reasoning-effort vocabularies.** Excluded — unrelated closed vocabularies (`EFFORT_LEVELS`, `QUALITY_GATE_CATCHES`), untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **superseded (outcome)** | A terminal run-ledger outcome: the admitted issue reached Done because its deliverables were already merged to `main` by *other* (delivering) tickets. This run built nothing and opened no PR, but the work is delivered. |
| **delivering ticket** | A ticket named in a superseded issue's evidence artifact whose *own* merged work delivered the superseded issue's premise. Its live terminal state is what reconcile observes. |
| **supersession.json** | The trusted, graft-written evidence artifact for a `superseded` outcome (same trust class as `merge-record.json`). Names the delivering tickets. Written by the future producer (FAFF-573); this ticket only *reads* it. |

**Type — the supersession evidence artifact.** Written at `<run-dir>/<issue>/supersession.json` (by FAFF-573's producer, or by hand today).

```
RECORD Supersession:
  issue:            IssueId          # the superseded issue, e.g. "FAFF-551"
  superseded_by:    List<IssueId>    # NON-EMPTY; the delivering tickets — reconcile load-bearing
  delivered_surface: String          # subsystem / paths the delivery covered (human-facing)
  closed_at:        ISO-8601 String  # when the issue was moved Done
  run_id:           String           # the run that recorded the outcome

  CONSTRAINT superseded_by is a non-empty list of issue-id strings
```

The reconcile-load-bearing field is `superseded_by` (non-empty ticket-id list) — reconcile observes each named ticket's live terminal state through it. `delivered_surface`, `closed_at`, `run_id` are provenance/reporting only. **This §3 schema IS the contract FAFF-573's producer must emit.**

**Type — the reconcile superseded input entry** (assembled by the orchestrator, one per `superseded` ledger outcome, piped on stdin in `ReconcileInput.superseded[]`).

```
RECORD ReconcileSupersededEntry:
  issue:    IssueId          # non-empty string (validated like every ReconcileInput element)
  recorded: Supersession | null   # supersession.json contents, or null if unreadable/missing
  observed: { all_delivered: Boolean, ... }   # orchestrator's live observation of the delivering tickets
```

**Type — `ReconcileInput` (extended).**

```
RECORD ReconcileInput:
  level:     "L1" | "L2" | "L3" | "L4"
  shipped:   List<...>                       # unchanged
  siblings:  List<...>                       # unchanged
  superseded: List<ReconcileSupersededEntry>  # NEW; optional (absent ⇒ [])
```

**Design decision — first-class terminal state, not a `delivery` sub-field on `shipped`.** Reconcile's `shipped ⟹ merge-record` model is exactly what false-positives; a discriminator sub-field forces *every* `shipped` consumer (reconcile, disposition, run-summary, economics, governance-check) to branch on a sidecar to avoid the false-positive. A distinct terminal string lets each gate key on it directly and keeps the summary honest. It is the additive closed-vocab change the `DELIVERY_PROFILE` design exists for. **Chosen:** a first-class `superseded` terminal state.

**Design decision — `supersession.json` trust class.** **Chosen:** `supersession.json` is a trusted graft-written artifact of the same class as `merge-record.json` — no `faff contract` validator; validated structurally by reconcile's input-assembly step (the orchestrator reads it into `recorded`, or passes `recorded: null` when unreadable, which reconcile fails closed).

## 4. HOW — Behavior

**Architecture.** The change threads one new outcome string through five seams: (1) the vocabulary source (`DELIVERY_PROFILE`), (2) runcheck's acceptance, (3) disposition's clean/attention classification, (4) reconcile's consistency classification (a new pure classifier + divergence class + input array), and (5) the orchestrator's evidence-gathering + reporting prose. Seams (1)-(4) are code; seam (5) is `SKILL.md` prose. All five are **consumer** work — none writes a `superseded` outcome (that is FAFF-573).

### 4.1 Vocabulary (`governance-profile.js`)

Add `"superseded"` to **both** closed lists in `DELIVERY_PROFILE`:

```
terminal_states: [..., "superseded"]     # 6 → 7; runcheck's vocab (runcheck accepts the ledger outcome)
ledger_outcomes: [..., "superseded"]     # 7 → 8; events' vocab (an issue-outcome event with
                                         #   data.outcome="superseded" then validates in events.js)
```

Note `ledger_outcomes` already carries an extra member (`claimed-by-peer`) that `terminal_states` does not, so the two lists reach 7 and 8 respectively. `validateProfileShape` needs no change (additive strings; shape unchanged). The `SECOND_PROFILE` dialect-independence proof still holds (its vocab is disjoint; a delivery `superseded` must still be *rejected* under `SECOND_PROFILE`). `profilesSelftest` in this file passes unchanged. `test/profiles.test.mjs` asserts the exact arrays (lines 47-48) and **must be updated** to include `superseded`.

**Anti-pattern:** adding `superseded` to only one of the two lists. Why: `terminal_states` is runcheck's vocabulary and `ledger_outcomes` is events' — a `superseded` accepted by runcheck but rejected by an `issue-outcome` event (or vice-versa) is an inconsistent dialect. Add to both.

### 4.2 runcheck (`runcheck.js`)

`TERMINAL_STATES = new Set(DELIVERY_PROFILE.terminal_states)` picks up `superseded` automatically. `auditLedger` validates `outcomes` values against `profile.terminal_states`, so a `superseded` outcome no longer registers as an `invalid_outcome`. No code change beyond the vocab; `RUNCHECK_SELFTEST_CASES` are unaffected (they use `shipped`). Add one selftest case asserting a `superseded` outcome is accepted (not `invalid`).

### 4.3 disposition (`disposition.js`)

`superseded` must be **CLEAN** — it must NOT be added to `ATTENTION_OUTCOMES` (currently `["parked", "errored", "unreached-budget", "pr-open"]`). Because `computeDisposition` treats any outcome *not* in `ATTENTION_OUTCOMES` as clean, `superseded` is clean by construction *provided* it is in `terminal_states` (else `auditLedger` flags it as an `invalid_outcome` → `incomplete-ledger` item → `needs-attention`). So the correctness dependency is: §4.1 (in `terminal_states`) + leave `ATTENTION_OUTCOMES` unchanged.

**Behaviour summary:** a run whose only non-shipped outcome is `superseded` must exit `clean`.

```
PROCEDURE disposition_over_superseded(ledger):
  1. auditLedger accepts "superseded" (it is in terminal_states) → not an invalid_outcome
  2. "superseded" ∉ ATTENTION_OUTCOMES → no issue-outcome attention item raised
  3. IF no other attention item → disposition = "clean" (exit 0)
```

Add a `DISPOSITION_SELFTEST_CASES` entry: `outcomes: { X: "superseded" }` → `clean`, no attention items. (This case is load-bearing: it proves both that `superseded` is accepted by `auditLedger` and that it is excluded from attention.)

**Anti-pattern:** adding `superseded` to `ATTENTION_OUTCOMES`. Why: it re-introduces the exact false-positive — `faff disposition` would exit `needs-attention` on a genuinely-complete run.

### 4.4 reconcile (`reconcile.js`)

Add a pure classifier `reconcileSuperseded(s)`, a new divergence class, a new input array, and extend the validator, core, and selftest.

**Behaviour summary:** a `superseded` outcome is *consistent* iff its evidence names ≥1 delivering ticket AND the orchestrator observed all of them delivered; otherwise it is a `superseded-unproven` divergence (fail-closed).

```
PROCEDURE reconcileSuperseded(s):
  recorded := s.recorded              # supersession.json contents, or null
  observed := s.observed || {}
  1. IF recorded is null
        OR recorded.superseded_by is not a non-empty array of strings:
       RETURN { class: "superseded-unproven", issue: s.issue,
                detail: "superseded claim with no/invalid supersession.json evidence",
                rollback_proposal: null }
  2. IF observed.all_delivered !== true:
       RETURN { class: "superseded-unproven", issue: s.issue,
                detail: "named delivering tickets not verifiably delivered on main",
                rollback_proposal: null }
  3. RETURN null                      # consistent
```

Wire-in:
- `DIVERGENCE_CLASSES` → append `"superseded-unproven"` (becomes `["phantom-merge", "claimed-shipped-unmerged", "unowned-sibling-mutation", "superseded-unproven"]`).
- `reconcileCore(input)` → iterate `input.superseded[]` (guarded `Array.isArray`), pushing any divergence, alongside the existing `shipped[]` and `siblings[]` loops. The `consistent` / `disposition` computation (L4 ⇒ needs-human, else warn) is unchanged and applies to the new class for free.
- `validateReconcileInput` → reject a non-array `superseded`; validate each element with the *existing* `isNamedEntry` predicate (non-empty string `issue`). Do **not** require `recorded`/`observed` on elements — a missing `recorded` is the fail-closed path (→ `superseded-unproven`) and must reach the core, exactly as a missing `shipped.recorded` does (the existing selftest at reconcile.js:248 proves that pattern for `shipped`).
- `RECONCILE_SELFTEST_CASES` → add: (a) a `superseded` entry with non-empty `superseded_by` + `observed.all_delivered:true` → consistent/pass; (b) `recorded:null` → `superseded-unproven` (L4 needs-human); (c) `superseded_by:[]` → `superseded-unproven`; (d) `observed.all_delivered:false` → `superseded-unproven`; (e) an L3 `superseded-unproven` → `warn`. The "every DivergenceClass is exercised" check then covers the new class automatically. **Note:** the selftest tail count is computed as `RECONCILE_SELFTEST_CASES.length + 16` (the `.length` auto-tracks table growth), and the `validateReconcileInput` element-validation cases likewise mirror the `shipped[...]` cases — add the analogous `superseded[...]` validation checks and adjust only the fixed `+16` addend if you add validate-cases, not for table-case additions.

### 4.5 governance-check (`governance-check.js`)

`resolveTargetIssues` (line ~179) filters `outcomes` whose value ∈ `TERMINAL_STATES` — additive-safe, picks up `superseded` with no change. No edit required; note it as covered.

### 4.6 events (`events.js`)

`EVENT_LEDGER_OUTCOMES = new Set(DELIVERY_PROFILE.ledger_outcomes)` picks up `superseded` from §4.1 automatically — an `issue-outcome` event with `data.outcome: "superseded"` then validates. No code change beyond the vocab; optionally add an event selftest case mirroring the existing `data: { outcome: "shipped" }` valid case (events.js:343).

### 4.7 Orchestrator evidence-gathering (`faff-beep-boop/SKILL.md` step 11.5)

The orchestrator's impure half assembles `ReconcileInput`. Extend it: for every ledger outcome `== "superseded"`, read `<run-dir>/<issue>/supersession.json` into `recorded` (unreadable/missing → `recorded: null`, never dropped or assumed-fine), and observe each `superseded_by` ticket's LIVE terminal state:

```
PROCEDURE observe_superseded(issue, recorded):
  IF recorded is null: append { issue, recorded: null, observed: { all_delivered: false } }; RETURN
  states := for each t in recorded.superseded_by: live_terminal_state(t)
  observed.all_delivered := every state is a delivered/terminal state
  append { issue, recorded, observed }

  # tracker mode (MCP): a ticket's live state is Done / Cancelled ⇒ delivered
  # git-only mode (FAFF-526): no tracker read — best-effort presence of the named
  #   deliverable/commit on main (git log --grep / git merge-base --is-ancestor).
  #   Fail-closed on unprovable presence (⇒ observed.all_delivered=false). See §7 Chosen.
```

Also update the prose docs in the same file:
- Run-ledger `outcomes` doc — add `superseded` to the enumerated bucket list.
- Run-summary reporting (outcome-buckets block) — add a **distinct** bucket `## Superseded (delivered by prior tickets)` citing the `superseded_by` ticket IDs. It is **not** a `## Shipped (…)` subsection.
- Step 11.6 post-merge roll-up + the L4 holdout roll-up — both iterate `shipped` outcomes only; a `superseded` issue never enters the shipped set, so they exclude it by construction. Confirm and add a one-line note that `superseded` is deliberately outside these roll-ups.

**Design decision — holdout / post-merge treatment.** A `superseded` issue merged no code this run, so there is nothing to hold out or post-merge-verify. **Chosen:** exclude `superseded` from the step-11.6 post-merge roll-up and the L4 holdout roll-up (it never enters the `shipped` set they iterate).

**Design decision — reporting surface.** **Chosen:** its own bucket, `## Superseded (delivered by prior tickets)`, citing the delivering ticket IDs — not a `## Shipped` subsection, because `superseded` is now its own terminal bucket.

**Design decision — git-only "verifiably on `main`" verification.** git-only mode has no authoritative terminal-state read for the delivering tickets, so `observed.all_delivered` is derived from best-effort commit/deliverable presence on `main` (`git log --grep` / `git merge-base --is-ancestor`). **Chosen:** best-effort presence, **fail-closed** on unprovable presence (unprovable ⇒ `observed.all_delivered=false` ⇒ `superseded-unproven`), with **tracker-mode as the trustworthy path**. Rejected: making git-only *always* refuse to affirm `superseded` (always `superseded-unproven`) — needlessly punitive given the fail-closed default already prevents a wrong *pass*; the only risk (a named ticket's commit present on `main` but later reverted/reopened) is documented as a known best-effort limit and is a candidate future tightening if it ever bites, not a blocker for this consumer.

### Failure modes

- **The failure:** `superseded` is added to the consumer vocabulary but no producer ever writes it, so the whole feature is exercised only by the manual ledger edit — it is not end-to-end useful until the sibling producer ticket (FAFF-573) lands. **How you'd know:** grep for a `superseded`-writing path (`supersession.json` writer, a new graft return token) finds nothing; no run emits `superseded` without a hand edit. **What it means:** proceed — the consumer slice is cohesive and correct in isolation, and it fixes both symptoms *whenever* a `superseded` outcome is recorded. The producer is the named sibling FAFF-573, not a gap hidden here.
- **The failure:** git-only "verifiably on main" observation is weaker than tracker-mode (no authoritative terminal-state read), so `observed.all_delivered` could be wrong in the *pass* direction if a named ticket's commit is present on `main` but the ticket was later reverted/reopened. **How you'd know:** a git-only run where a delivering ticket's commit is on `main` but its work was reverted — reconcile would (wrongly) pass it consistent. **What it means:** accepted best-effort limit per the §4.7 Chosen — the fail-closed default prevents wrong *needs-human-skips*, tracker-mode is authoritative, and a stricter git-only refusal is a documented future tightening.

## 5. Scenarios

```
Given a run-ledger where an admitted issue's outcome is "superseded"
When faff runcheck audits the ledger
Then the outcome is NOT reported as an invalid_outcome and the run is clean
```

```
Given a "superseded" outcome whose supersession.json names ≥1 delivering ticket
  and the orchestrator observed observed.all_delivered === true
When faff reconcile classifies the ReconcileInput at L4
Then reconcileSuperseded returns null (consistent) and disposition is "pass"
```

```
Given a "superseded" outcome with supersession.json missing (recorded: null) at L4
When faff reconcile classifies the ReconcileInput
Then a "superseded-unproven" divergence is raised and disposition is "needs-human"
```

```
Given a "superseded" outcome whose supersession.json has an empty superseded_by list at L3
When faff reconcile classifies the ReconcileInput
Then a "superseded-unproven" divergence is raised and disposition is "warn" (non-blocking)
```

- The `faff disposition` verdict over a run whose only non-shipped outcome is `superseded` MUST be `clean` (exit 0).
- A run-ledger outcome of `superseded` MUST validate on an `issue-outcome` event's `data.outcome` in `events.js` (it is in `ledger_outcomes`).

## 6. Design Decision Rationale

**New terminal state vs `delivery` sub-field on `shipped`?**
- *Sub-field on `shipped`:* smallest vocab change, but forces every `shipped` consumer to branch on a sidecar to dodge the merge-record false-positive; keeps the reporting overload.
- *First-class `superseded` state:* one additive string; each gate keys on it directly; reconcile's `shipped ⟹ merge-record` model stays untouched; honest reporting.
- **Chosen:** first-class `superseded` terminal state — the additive closed-vocab change `DELIVERY_PROFILE` is designed for.

**Where does supersession evidence get validated?**
- *A `faff contract` validator:* consistent with PRD/spec contracts, but overkill for a trusted internally-written artifact and adds a schema surface.
- *Structural validation at reconcile input-assembly (like `merge-record.json`):* same trust class, no new contract surface, fail-closed on absence.
- **Chosen:** trusted graft-written artifact, structurally validated by reconcile's input assembly (no `faff contract` validator).

**Scope: consumer-only, producer as sibling?** (resolved this refresh)
- *One ticket (consumer + producer):* end-to-end useful in a single merge, but couples a pure additive vocab/reconcile change to a non-trivial graft close-path architectural addition, widening the blast radius and the review surface.
- *Consumer-only, producer split to FAFF-573:* the consumer is a cohesive, self-contained, correct-in-isolation slice with a documented evidence contract; the producer lands after, satisfying that contract. Right-sized per the agile-delivery lens.
- **Chosen:** consumer-only here; producer is sibling **FAFF-573** (blocked-by FAFF-571). Honest cost: until FAFF-573 ships, `superseded` outcomes are hand-authored (§7 Assumptions).

**Holdout / post-merge roll-up treatment of `superseded`?**
- **Chosen:** exclude — a superseded issue merged no code, so there is nothing to hold out or post-merge-verify; it never enters the `shipped` set those roll-ups iterate.

**Reporting surface?**
- **Chosen:** its own `## Superseded (delivered by prior tickets)` bucket citing delivering ticket IDs — not a `## Shipped` subsection.

**git-only verification strictness?** (resolved this refresh)
- **Chosen:** best-effort commit-presence with a fail-closed default, tracker-mode authoritative; a stricter always-refuse git-only posture is a documented future tightening, not needed now (§4.7).

## 7. Decisions and Assumptions

**Resolved this refresh (were Punts).**

- **Chosen:** **Scope = consumer-side only.** The graft build-time premise-superseded **close-path** (decide at build time deliverables are on `main`, write `supersession.json`, move the issue Done, return a new terminal token, open no PR) is **out of scope** and filed as sibling **FAFF-573** (blocked-by FAFF-571, relates-to FAFF-571). This consumer lands first with the §3 evidence-artifact contract FAFF-573 must satisfy. *(decided: architecture — was the load-bearing Punt)*
- **Chosen:** **git-only "verifiably on `main`" = best-effort + fail-closed**, tracker-mode authoritative (§4.7). Not the stricter always-`superseded-unproven` git-only posture — the fail-closed default already prevents a wrong pass-skip, and the sole residual risk (present-but-reverted commit) is a documented best-effort limit + future-tightening candidate. *(decided: architecture)*
- **Chosen:** **prep's premise-superseded PARK is unchanged by this ticket**, and the question of whether it should route into the new close-path is a producer-side concern moved to **FAFF-573**. `faff-prep` keeps parking (cause `premise-superseded`) as today. *(decided: product/scope)*

**Assumptions.**

- **Assumes:** a future producer (**FAFF-573**) writes `<run-dir>/<issue>/supersession.json` conforming to the §3 schema. It does **not** exist today — `grep -rn "supersession.json" plugin/` returns no run-ledger writer (only ADR/PRDR record-supersession, unrelated), and graft has no delivered-elsewhere return token. **This is by design:** the consumer is forward-compatible and fail-closed. Until FAFF-573 ships, the only `superseded` outcomes are **hand-authored** ledger edits (as the live FAFF-551 run did). *Validation:* the grep above; the build agent must NOT assume a producer emits `supersession.json` and MUST keep the `recorded: null` fail-closed path working.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `superseded` ledger outcome no longer false-positives at reconcile: with valid evidence + observed delivery it classifies `consistent`/`pass` at L4 (no `claimed-shipped-unmerged`).
- [ ] A `superseded` outcome is never rendered as freshly merged (`shipped`) in the run summary.

### From WHAT (vocabulary & types)
- [ ] `DELIVERY_PROFILE.terminal_states` contains `superseded` (now 7 entries).
- [ ] `DELIVERY_PROFILE.ledger_outcomes` contains `superseded` (now 8 entries).
- [ ] `test/profiles.test.mjs`'s exact-array assertions (lines 47-48) include `superseded` in both lists and pass.
- [ ] `validateProfileShape(DELIVERY_PROFILE)` and the `SECOND_PROFILE` dialect-independence proof still pass unchanged.
- [ ] `ReconcileInput` accepts an optional `superseded: []` array; each element is `{issue: non-empty-string, recorded?, observed?}`.

### From HOW (runcheck)
- [ ] `auditLedger` does not flag a `superseded` outcome as an `invalid_outcome`; a runcheck selftest case asserts this.

### From HOW (disposition)
- [ ] `superseded` is NOT in `ATTENTION_OUTCOMES`.
- [ ] `computeDisposition` returns `clean` for a ledger whose only non-shipped outcome is `superseded`; a `DISPOSITION_SELFTEST_CASES` entry asserts this.

### From HOW (reconcile)
- [ ] `reconcileSuperseded(s)` returns `null` iff `recorded.superseded_by` is a non-empty string list AND `observed.all_delivered === true`.
- [ ] `reconcileSuperseded(s)` returns a `superseded-unproven` divergence when `recorded` is null, `superseded_by` is empty/invalid, or `observed.all_delivered !== true`.
- [ ] `DIVERGENCE_CLASSES` includes `superseded-unproven`.
- [ ] `reconcileCore` iterates `input.superseded[]` and folds its divergences with the existing level-gating (L4 ⇒ needs-human, ≤L3 ⇒ warn).
- [ ] `validateReconcileInput` rejects a non-array `superseded` and a `superseded[]` element lacking a non-empty string `issue`, but accepts an element missing `recorded` (fail-closed path).
- [ ] `RECONCILE_SELFTEST_CASES` covers consistent + every `superseded-unproven` trigger + an L3-warn case; the "every DivergenceClass exercised" check passes and the tail case count (`.length + 16`, plus any new validate-case addend) is correct.

### From HOW (governance-check)
- [ ] `resolveTargetIssues` treats a `superseded` outcome as a terminal target (verified — additive via `TERMINAL_STATES`, no code change).

### From HOW (events)
- [ ] An `issue-outcome` event with `data.outcome: "superseded"` validates in `events.js` (via `ledger_outcomes`).

### From HOW (orchestrator prose — faff-beep-boop/SKILL.md)
- [ ] Step 11.5 assembles `ReconcileInput.superseded[]` from each `superseded` outcome: reads `supersession.json` → `recorded` (null on unreadable), observes each `superseded_by` ticket's live terminal state → `observed.all_delivered` (tracker Done/Cancelled; git-only best-effort + fail-closed).
- [ ] Run-ledger `outcomes` doc lists `superseded`.
- [ ] Run summary defines a distinct `## Superseded (delivered by prior tickets)` bucket citing `superseded_by` IDs — not a `## Shipped` subsection.
- [ ] A note records that step-11.6 post-merge + L4 holdout roll-ups exclude `superseded` (iterate `shipped` only — no change needed).

### From Decisions / Assumptions
- [ ] Reconcile input assembly tolerates a missing `supersession.json` (fail-closed to `superseded-unproven`), since no producer writes it yet (producer is FAFF-573).

**Integration smoke test.**
```
PROCEDURE smoke():
  1. governance-profile --selftest → PASS (superseded in both lists; SECOND_PROFILE proof holds)
  2. runcheck --selftest, disposition --selftest, reconcile --selftest → all PASS
  3. node test/profiles.test.mjs → PASS (updated exact-array assertions)
  4. echo '{"level":"L4","superseded":[{"issue":"FAFF-551","recorded":{"issue":"FAFF-551","superseded_by":["FAFF-556","FAFF-557","FAFF-559"],"delivered_surface":"x","closed_at":"2026-07-20T07:04:39Z","run_id":"r"},"observed":{"all_delivered":true}}]}' \
       | faff reconcile --run-dir /tmp/x --level L4 --json  → consistent:true, disposition:"pass"
  5. same input with "recorded":null → superseded-unproven divergence, disposition:"needs-human"
```

confidence: high

spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
