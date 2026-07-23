# nlspec — FAFF-573: graft build-time premise-superseded close-path (the `superseded` producer)

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-573.

This is a buildable specification for FAFF-573, addressed to the build agent that will implement it and the human reviewers who gate it. It adds the **producer** side of faff's `superseded` run-ledger outcome: a `/faff-graft` build-time close-path that, when an admitted issue's deliverables are found already merged to `main` by other tickets, writes the `supersession.json` evidence artifact FAFF-571 defined, moves the issue Done without opening a PR, and returns a new terminal token from graft's return vocabulary. It is the exact counterpart FAFF-571's consumer was built to receive.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-571 shipped the whole *consumer* of a `superseded` outcome — runcheck accepts the string, `reconcileSuperseded` affirms it consistent when its evidence names delivering tickets verifiably on `main`, disposition treats it clean, events validate it, the run summary gives it a `## Superseded (delivered by prior tickets)` bucket, and **beep-boop step 11.5 already reads `<run-dir>/<issue>/supersession.json` into `ReconcileInput.superseded[]`**. But FAFF-571 deliberately shipped **no producer**: nothing writes `supersession.json`, and graft has no "delivered-elsewhere, close Done without a PR" token. So today a `superseded` outcome is reachable **only by hand-editing the ledger** (as the live run did for FAFF-551). This ticket builds the missing producer so the outcome is reachable by code.

**Problem statement.** When an admitted issue's premise turns out already delivered on `main` by sibling tickets (often ones that merged earlier in the same run), graft today has no honest close: it would build an empty or redundant PR, or the issue would stall. This change gives graft a build-time close-path that records the supersession as first-class evidence and closes the issue Done with no PR.

**Design principles.**

- **Fail closed on unverified delivery.** The close-path auto-closes **only** when it can name ≥1 delivering ticket whose deliverable it has confirmed present on `main`. Any uncertainty — surface not confirmably delivered, no verifiable delivering ticket — means it does **not** close: it falls through to a normal build. This mirrors FAFF-571's consumer posture (absence of proof is a divergence, never a silent pass) at the producing end, so a well-formed artifact is the *only* thing this producer ever writes.
- **Lane integrity.** Writing `<run-dir>/<issue>/supersession.json` and moving the issue Done is **build-lane** work — it needs the run-dir and authoritative access to `main`. It belongs in graft, not prep (whose premise evidence is tracker-surface heuristic, not `main`-verified). This is the boundary that settles the coupled decision below.
- **Additive vocabulary at every seam.** `superseded` is threaded as a new string through graft's return vocabulary, graft's ledger-bucket mapping, and the `concurrency` slot's recorded-bucket set — never a restructuring. The ledger `outcomes` vocabulary and runcheck already accept `superseded` (FAFF-571); this ticket only closes the *producing* half and the concurrency-slot *recording* half.
- **Trusted artifact, not a validated contract.** `supersession.json` stays the trust class of `merge-record.json` — graft-written, no `faff contract` validator, structurally validated at reconcile input-assembly (already built in FAFF-571).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | prose | build flow; Step 2 pre-worktree gates (~L101-150); Step 3 worktree; Step 5 claim; return vocabulary (~L574-583); ledger-bucket mapping (~L591) — the producer's home |
| `plugin/skills/faff-prep/SKILL.md` | prose | the already-shipped-scan surface extraction (~L336-353) this reuses; the premise-superseded PARK the coupled decision keeps |
| `plugin/skills/faff-beep-boop/SKILL.md` | prose | step 11.5 already reads `supersession.json` (~L319); `outcomes` doc already lists `superseded` (~L351) |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | prose | the default `concurrency` occupant — records the terminal bucket; its bucket set (~L34) needs `superseded` |
| `plugin/skills/faff/SKILL.md` | prose | gateway `concurrency` slot contract (~L1102) — the fixed-bucket list needs `superseded` |
| `docs/specs/2026-07-20-faff-571-...-design.md` | prose | the consumer contract this satisfies; §3 fixes the `supersession.json` schema |

**Scope statement.** This sits at the `/faff-graft` build-entry seam — the point where an admitted issue is judged buildable — and is the producing counterpart of FAFF-571's run-end integrity consumer.

## 2. OUT OF SCOPE

- **The FAFF-571 consumer** — vocabulary, reconcile affirmation, disposition, events, run-summary bucket, step-11.5 input assembly. Already shipped and merged. **Extension point:** none needed; this producer writes to the contract it fixed.
- **A `faff contract` validator for `supersession.json`.** Excluded — it stays a trusted graft-written artifact of the `merge-record.json` class, validated structurally at reconcile input-assembly. **Extension point:** `contract-defs.js`, if ever wanted.
- **Auto-revert / reopen on a later-discovered mistaken supersession.** Out of scope — a wrongly-closed issue is reopened by a human, and the consumer already fail-closes a `superseded-unproven` at reconcile. **Extension point:** a future auto-revert follow-up (same class as the post-merge-verification auto-revert seam graft already defers).
- **Changing prep's premise-superseded PARK.** The coupled decision (below) resolves to **keep** prep's park unchanged, so there is no prep code change. **Extension point:** if a future appetite dial ever wants prep to auto-route, it would call this same close-path from the prep lane — deliberately not built now (§6).

## Already shipped against this surface

- **FAFF-571** (Done/merged) — the **consumer** of `superseded`: the terminal vocabulary, `reconcileSuperseded` + `superseded-unproven`, disposition-clean, run-summary bucket, and step-11.5's `supersession.json` read. Related and load-bearing, but **not superseding** — it shipped no producer by design, and verification confirms nothing writes `supersession.json` today. This ticket's premise (build that producer) holds in full.
- Adjacent run-ledger tickets (FAFF-397 ground-truth reconcile, FAFF-554 `outcomes` string-only, FAFF-424 merge-gate level) touch neighbouring seams but deliver no part of this producer.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **build-time premise-superseded** | graft's build-entry judgement that an admitted issue's deliverables are already merged to `main` by other tickets, so there is nothing to build. Distinct from prep's premise-superseded PARK (a pre-admission, tracker-heuristic judgement). |
| **delivering ticket** | a ticket whose own merged work delivered this issue's premise; its ID lands in `supersession.json.superseded_by` and its live terminal state is what reconcile re-observes. |
| **superseded-done** | the new graft return token for "closed Done because delivered elsewhere, no PR opened". Maps to the ledger bucket `superseded`. |

**Type — the supersession evidence artifact** (the FAFF-571 §3 contract this producer emits, restated so the build agent writes it exactly). Written at `<run-dir>/<issue>/supersession.json`.

```
RECORD Supersession:
  issue:             IssueId          # the superseded issue, e.g. "FAFF-573"
  superseded_by:     List<IssueId>    # NON-EMPTY; the delivering tickets — reconcile load-bearing
  delivered_surface: String          # subsystem / paths the delivery covered (human-facing)
  closed_at:         ISO-8601 String  # when the issue was moved Done
  run_id:            String           # the run that recorded the outcome

  CONSTRAINT superseded_by is a non-empty list of issue-id strings
```

`superseded_by` is the only reconcile-load-bearing field; the rest are provenance/reporting. The producer MUST never write an empty or unverified `superseded_by` — if it cannot name ≥1 verified delivering ticket, it does not take the close-path at all.

**Interface — the new graft return token.** Added to graft's return vocabulary (`faff-graft/SKILL.md` ~L574-583):

- `superseded-done` — the build-time premise-superseded gate found the issue's deliverables already merged to `main` by other tickets, wrote `supersession.json`, moved the issue **Done**, and opened **no PR**. Not a build attempt in the defect sense and never `parked`; it **does** enter the run-ledger `admitted` array (unlike the pre-worktree *skip* tokens `ineligible`/`blocked`/`inadmissible`) and lands a terminal bucket, because it is a genuine terminal disposition of an admitted issue.

**Design decision — first-class terminal token vs reusing `shipped`.** Reusing `shipped` would re-introduce exactly the FAFF-571 false-positive (a `superseded` issue has no `merge-record.json`, so reconcile's `shipped ⟹ merge-record` model fails it closed). **Chosen:** a distinct `superseded-done` return token mapping to the `superseded` bucket — the consumer keys on it cleanly.

**Design decision — `supersession.json` trust class.** **Chosen:** trusted graft-written artifact of the `merge-record.json` class; no `faff contract` validator (structurally validated at reconcile input-assembly, already built).

## 4. HOW — Behavior

**Architecture.** The producer threads `superseded` through four prose seams — (1) a new build-time gate in graft that detects + verifies + writes + closes, (2) graft's return vocabulary, (3) graft's ledger-bucket mapping, (4) the `concurrency` slot's recorded-bucket set (gateway contract + the sequential default). Seams (2)-(4) are additive string wiring; seam (1) is the real behaviour.

### 4.1 The build-time premise-superseded gate (graft)

**Placement.** A new gate at build entry, **after** Step 2's pre-worktree gates (eligibility / intake / admissibility) and **before** Step 3 creates a worktree. Pre-worktree is correct: a superseded issue needs no worktree and no spec commit, and the agent is in the main checkout (which *is* `main`), so it can inspect delivery directly and cheaply. On a NONE verdict the gate is a no-op and Step 3 proceeds unchanged, so an ordinary build pays only a cheap surface check.

**Behaviour summary.** Detect whether the spec's declared deliverable surface is already present on `main` via sibling tickets; verify each candidate delivering ticket is genuinely on `main`; and only on a confirmed, non-empty verified set write the artifact and close Done. Any uncertainty falls through to a normal build (fail-closed — never auto-close on doubt).

```
PROCEDURE build_time_premise_superseded_gate(spec, issue, run_dir, mode):
  1. Extract the spec's declared deliverable surface — named files / modules / subsystems —
     REUSING prep's already-shipped-scan surface extraction (do not invent a second extractor).
  2. Assemble candidate delivering tickets: the sibling ticket IDs the spec references
     (blocked-by / related / named in an "## Already shipped against this surface" section)
     that are currently terminal (tracker: Done/Cancelled).
  3. Verify delivery on `main` for each candidate:
       - tracker mode: the candidate is Done/Cancelled AND its deliverable surface is
         observably present on `main` (grep/inspect the named paths on the main checkout).
       - git-only mode (no tracker MCP): best-effort presence on `main`
         (`git log --grep`, `git merge-base --is-ancestor`); unprovable ⇒ NOT verified.
     verified := the subset whose deliverable is confirmed on `main`.
  4. Judge premise coverage (agent call, backed by the verified set as the audit trail):
       IF the issue's premise is NOT substantially covered by `verified`,
          OR `verified` is empty
          OR the judgement is uncertain:
         RETURN NONE            # fall through to Step 3 → normal build (fail-closed)
  5. superseded_by := [ticket IDs in `verified`]           # non-empty by step 4
  6. Autonomous: proceed to close. Interactive: PRESENT the finding + `superseded_by`
     and require an explicit confirm; on decline RETURN NONE (normal build).
  7. Write <run_dir>/<issue>/supersession.json:
       { issue, superseded_by, delivered_surface: <matched surface/paths>,
         closed_at: <now ISO-8601>, run_id }
  8. Move the issue to Done (no In Progress dwell required; no worktree, no branch, no PR).
  9. Log the decision + cited tickets to <run_dir>/<issue>/graft.md.
  10. RETURN superseded-done
```

**Anti-pattern:** writing `supersession.json` with a `superseded_by` assembled from tracker state alone, without confirming the deliverable is on `main`. Why: the consumer re-observes each named ticket live and fail-closes `superseded-unproven` if it isn't delivered — an unverified write turns a clean close into a run-end divergence.

**Anti-pattern:** taking the close-path on *uncertainty* to save a build. Why: a wrongly-closed issue silently drops residual scope; the fail-closed default (fall through to build) is always the safe direction.

### 4.2 Return vocabulary + ledger-bucket mapping (graft)

Add `superseded-done` to graft's **Return values** list (~L574-583) per §3. Extend graft's **Ledger bucket mapping** (~L591): `superseded-done → superseded`. Note explicitly that — unlike the pre-worktree skip tokens (`ineligible`/`blocked`/`inadmissible`, which never enter `admitted`) — a `superseded-done` issue **is** admitted and lands the `superseded` terminal bucket, so runcheck's `admitted − outcomes = ∅` invariant is satisfied (the bucket is already in runcheck's accepted vocabulary via FAFF-571).

### 4.3 Concurrency-slot recorded-bucket set (gateway + default)

The `concurrency` slot records the ledger bucket from graft's return token. Its fixed-bucket vocabulary currently omits `superseded`:

- **Gateway** (`faff/SKILL.md` ~L1102, the authoritative `concurrency` contract): add `superseded` to the fixed-bucket list and map `superseded-done → superseded`.
- **Sequential default** (`faffter-noon-concurrency-sequential/SKILL.md` ~L34): add `superseded` to the "one of the … build buckets" enumeration and the token→bucket mapping.

**Anti-pattern:** teaching only graft's mapping and not the `concurrency` contract. Why: the slot writes the ledger bucket, not graft's raw token — if its vocabulary rejects `superseded` it either drops the outcome or writes an invalid one runcheck then flags.

### 4.4 Reconcile / step-11.5 — no change

beep-boop step 11.5 already reads `<run-dir>/<issue>/supersession.json` for every `superseded` outcome and assembles `ReconcileInput.superseded[]` (FAFF-571). Once this producer writes the artifact and the bucket is recorded, that path lights up unchanged. Confirm (no edit) that the observation half already handles the artifact this producer writes.

### Failure modes

- **The failure:** the gate auto-closes an issue whose premise is only *partially* delivered, dropping the residual delta silently. **How you'd know:** a `superseded` issue whose spec named work not actually present on `main`; a human notices the feature is missing. **What it means:** the step-4 judgement is precision-biased and the fail-closed fall-through is the default — narrow the trigger to *substantial* coverage and, when in doubt, build. A residual-delta issue should fall through to a (possibly narrowed) build, never an auto-close.
- **The failure:** `superseded_by` names a ticket whose commit is on `main` but was later reverted, so the consumer (git-only best-effort) wrongly affirms. **How you'd know:** identical to FAFF-571's documented git-only limit. **What it means:** accepted best-effort limit — tracker mode is authoritative; a stricter git-only posture is a future tightening, not a blocker here.

## 5. Scenarios

```
Given an admitted issue whose spec's declared deliverables are already merged to `main`
  by sibling tickets FAFF-AA, FAFF-BB (both Done, surface present on `main`)
When autonomous /faff-graft reaches the build-time premise-superseded gate
Then it writes <run-dir>/<issue>/supersession.json with superseded_by = ["FAFF-AA","FAFF-BB"],
  moves the issue Done, opens no PR, and returns superseded-done
```

```
Given a superseded-done return recorded by the concurrency slot as the `superseded` bucket
When beep-boop step 11.5 assembles ReconcileInput and reconcile runs at L4
Then reconcileSuperseded returns null (consistent) and the run summary renders the issue under
  ## Superseded (delivered by prior tickets), never under ## Shipped
```

```
Given the build-time gate finds the surface only partially on `main`, or cannot verify any
  delivering ticket's deliverable on `main`
When the gate evaluates its verdict
Then it returns NONE and graft proceeds to a normal build (no supersession.json written)
```

```
Given interactive /faff-graft at the build-time premise-superseded gate with a verified candidate set
When the gate is reached
Then it presents the finding + superseded_by and requires an explicit confirm before closing Done;
  on decline it proceeds to a normal build
```

- The producer MUST NEVER write a `supersession.json` whose `superseded_by` is empty or contains an unverified ticket.
- A `superseded-done` issue MUST enter the run-ledger `admitted` array and land the `superseded` bucket (so runcheck's completeness invariant holds).

## 6. Design Decision Rationale

**Where does the producer live — prep lane or build lane?**
- *Prep lane:* prep already runs a premise-superseded scan, so it could write the artifact and close Done at prep time.
- *Build lane (graft):* graft has the run-dir and authoritative `main` access needed to *verify* delivery, which is what makes the artifact fail-closed-honest.
- **Chosen:** the build lane. Prep's premise evidence is tracker-surface heuristic (recall-biased), not `main`-verified; the auto-Done decision belongs where `main` is authoritative and the run-dir exists.

**The coupled decision — should prep's premise-superseded PARK route into this close-path instead of parking?**
- *Auto-route under appetite:* on `appetite: high`, prep could skip the human and drive the close-path itself, reducing morning triage; the consumer fail-closes a wrong write, so it's "safe".
- *Keep prep's park (human-gated):* prep's evidence isn't `main`-verified; auto-Done-ing from the prep lane either skips verification (unsafe) or duplicates graft's `main`-checking machinery into the wrong lane; and a premise superseded *before the issue is ever admitted* is a genuine scrap-or-keep call (there may be residual delta) the human should see — exactly what park surfaces.
- **Chosen:** **keep prep's premise-superseded PARK unchanged; do not auto-route in v1.** The two mechanisms are complementary and non-overlapping: prep catches *pre-admission* supersession from already-Done siblings → park for human scrap/keep; graft catches *at-build* supersession (deliverables now on `main`, often via mid-run sibling merges) → auto-Done with `main`-verified evidence. This keeps the auto-Done in the lane that can prove it and leaves the ambiguous pre-admission case to the human. The safety net (reconcile fail-closes `superseded-unproven`) protects a wrong *recorded* outcome, but it does not make a wrong *auto-Done* free — a parked issue is recoverable, a silently-closed one with residual delta is lost scope. *(decided: architecture/product)*

**First-class `superseded-done` token vs reusing `shipped`?**
- **Chosen:** distinct token → `superseded` bucket, so the FAFF-571 consumer keys on it cleanly and no `merge-record` false-positive arises.

**Does the concurrency slot need teaching?**
- **Chosen:** yes — the slot writes the ledger bucket from the token, and its fixed-bucket vocabulary (gateway contract + sequential default) currently omits `superseded`; add it in both, or the outcome is dropped/invalid. This is the seam most easily missed.

## 7. Open Questions and Assumptions

**Open Questions:** none — the load-bearing scope question (lane) and the coupled prep-park question are both resolved above.

**Assumptions.**

- **Assumes:** the FAFF-571 consumer is landed and merged — `superseded` in `DELIVERY_PROFILE`, `reconcileSuperseded` + `superseded-unproven`, disposition-clean, run-summary bucket, and step-11.5's `supersession.json` read all exist. *Validation:* `grep -n superseded plugin/skills/faff/bin/lib/reconcile.js` and step 11.5 in `faff-beep-boop/SKILL.md`; confirmed present at spec time (FAFF-571 Done/merged).
- **Assumes:** the surface-extraction and already-shipped-scan logic prep uses is reusable at build time against the main checkout. *Validation:* `faff-prep/SKILL.md` ~L336-345 (surface-area signal extraction) — reuse it, do not fork a second extractor.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `superseded` run-ledger outcome is now reachable **by code** (graft close-path), not only by a hand-edited ledger.
- [ ] The close-path writes a well-formed `supersession.json` naming genuinely-delivering tickets, or does not take the close-path (fail-closed — never a malformed/unverified write).

### From WHAT (types & interfaces)
- [ ] `supersession.json` is written at `<run-dir>/<issue>/supersession.json` conforming to the FAFF-571 §3 schema (`issue`, non-empty `superseded_by`, `delivered_surface`, `closed_at`, `run_id`).
- [ ] `superseded_by` is a non-empty list of verified delivering-ticket IDs; an empty/unverified set means the close-path is not taken.
- [ ] `faff-graft/SKILL.md` return vocabulary (~L574-583) includes `superseded-done` with its semantics (admitted, no PR, moves Done, lands `superseded` bucket).

### From HOW (the build-time gate)
- [ ] graft has a build-time premise-superseded gate, placed after Step 2's pre-worktree gates and before Step 3 worktree creation, that runs the `PROCEDURE` in §4.1.
- [ ] On a NONE verdict the gate is a no-op and graft proceeds to a normal build.
- [ ] Autonomous mode auto-closes on a confirmed, `main`-verified, non-empty verified set; interactive mode requires an explicit confirm and otherwise proceeds to build.
- [ ] The gate moves the issue Done and opens no PR / creates no worktree on the close-path.

### From HOW (ledger-bucket wiring)
- [ ] `faff-graft/SKILL.md` ledger-bucket mapping (~L591) maps `superseded-done → superseded`.
- [ ] The gateway `concurrency` slot contract (`faff/SKILL.md` ~L1102) fixed-bucket list includes `superseded` and maps `superseded-done → superseded`.
- [ ] The sequential default (`faffter-noon-concurrency-sequential/SKILL.md` ~L34) bucket enumeration + mapping include `superseded`.
- [ ] A `superseded-done` issue enters `admitted` and lands the `superseded` bucket, so `runcheck`'s `admitted − outcomes = ∅` invariant holds (no runcheck change needed — vocabulary already accepts `superseded`).

### From HOW (reconcile — confirm, no change)
- [ ] beep-boop step 11.5 already reads `supersession.json` and assembles `ReconcileInput.superseded[]` for the outcome this producer records — confirmed, no edit.

### From Decisions
- [ ] prep's premise-superseded PARK is unchanged (no prep code change); the coupled decision to keep it human-gated is recorded in the shipped spec.

**Integration smoke test.**
```
PROCEDURE smoke():
  1. Drive /faff-graft (autonomous) on an issue whose spec surface is already on `main` via a Done sibling
     → graft writes <run-dir>/<issue>/supersession.json, issue is Done, no PR, returns superseded-done.
  2. Concurrency slot records the `superseded` bucket in the run ledger (not shipped/parked/errored).
  3. faff runcheck <run-dir> → clean (superseded ∈ terminal_states; admitted−outcomes=∅).
  4. beep-boop step 11.5 assembles ReconcileInput.superseded[] from the artifact;
     faff reconcile --level L4 → consistent, disposition pass; run summary renders
     ## Superseded (delivered by prior tickets) citing superseded_by.
  5. Repeat with the surface only partially on `main` → gate returns NONE, a normal build runs,
     no supersession.json written.
```

confidence: high

spec-review: approve

## Methodology critique

*Lens: agile-delivery (faffter-dark-methodology-agile-delivery). Autonomous — advisory, does not gate promotion.*

- **Right-sized?** Yes. A single cohesive concern — the `superseded` producer — landing as one prose close-path in graft plus its additive vocabulary threading. A 1–3 day unit; no independent second concern to split off, no always-ships-together sibling to merge.
- **Workstream fit?** Fits the run-ledger integrity workstream FAFF-571/FAFF-397 established; outcome-named (the producing half of a first-class outcome).
- **Deps surfaced?** Yes — blocked-by FAFF-571 (Done/merged), the consumer contract this satisfies. No implicit unlinked dependency.
- **Risk profile?** Low. No novel integration or external dependency; reuses prep's existing surface-extraction and writes an artifact of an established trust class. No de-risking spike warranted.

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```