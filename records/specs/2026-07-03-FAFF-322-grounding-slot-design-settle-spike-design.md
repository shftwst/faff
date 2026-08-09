# FAFF-322 — Design-settle spike: the `grounding` slot (contract shape, default occupant, trust model)

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: high. Full spec on Linear FAFF-322.

This is the spec for a **design-settle spike**, not a code build. It scopes the work of closing the four design questions blocking FAFF-127 (the pluggable `grounding` slot) and landing them as durable decisions. Audience: the agent running the spike, and human reviewers checking the spike stayed inside its box.

## 1. WHY — Problem and Principles

**The load-bearing model:** `grounding` is a pluggable slot whose occupant fetches evidence (ranked snippets / scored claims + provenance) for a consumer to weigh — and the design's whole job is to make *"advisory, never a verdict"* true **by contract shape**, not prose discipline: the contract returns evidence and structurally cannot carry a verdict, so no consumer can ever treat grounding output as a decision. Everything the spike settles hangs off that one constraint.

**Problem:** FAFF-127 carries three open design questions (contract shape, default occupant, external-endpoint trust model) and FAFF-128 adds a fourth (consumer wiring order + advisory-by-construction); building before they're settled risks a contract that leaks verdicts or an unsafe outbound-calling occupant. The questions are long-horizon cross-file reasoning — the methodology consumer, the FAFF-256 forward-interface, the FAFF-69 vocabulary, an untrusted-endpoint trust model — which is exactly what the fable window is for. This spike settles all four and lands them as an ADR + a build-ready FAFF-127 spec + a FAFF-128 wiring direction.

**Design principles:**

**Decisions, not a design note.** Every question closes with a decision + rationale in the ADR. The test of done is that FAFF-127's build becomes mechanical — its open-questions section empties.

**Narrow-boundary over binary** (the ADR-0029 / ADR-0039 spike precedent). If a question resists full settlement inside the timebox, settle the narrow core, name the residual explicitly, and file the costed follow-up — never emit a vague "needs more thought".

**Shipped ground truth is not re-litigable.** The forward-interface already in the tree — the `prdr-yagni` contract's `grounding_present` field, the gateway's "grounding is advisory… sharpens within-scope when present, never blocks" line, FAFF-256's Chosen D2 — is committed behaviour the design must honour. The spike designs *toward* it, not over it.

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| Contract registry + validator | `plugin/skills/faff/bin/faff` (`CONTRACTS` ~:6051, `cmdContract` ~:6265, `schemaCheck` ~:5170) | The `faff contract <name>` pattern the new contract mirrors |
| Simplest schema template | `plugin/skills/faff/contracts/spec-readiness.schema.json` | 34-line template shape for `grounding-evidence.schema.json` |
| Slot defaults registry | `plugin/skills/faff/bin/faff` ~:267–279 | Where a `grounding` slot key would be declared (13 slots today, no `grounding`) |
| Shipped forward-interface | `prdr-yagni` fixtures (`bin/faff` ~:6138–6147), gateway `SKILL.md` ~:963, `records/specs/2026-06-27-FAFF-256-prdr-yagni-guard-design.md` | "Advisory when present, never required" — committed consumer behaviour |
| Untrusted-input floor | gateway `SKILL.md` ~:467–481; `gates` TRUSTED-SOURCE-ONLY (`bin/faff` ~:6284) | The data-not-instructions rule fetched evidence must inherit |
| L4 cage / blast radius | ADR-0010, `faff container-check`, ADR-0034/0039 | Where an outbound-calling occupant sits; ADR-0039's shared-fs forge caveat |
| Methodology named-outputs | gateway `SKILL.md` ~:935–967; both methodology `SKILL.md`s | The consumer interface FAFF-128 wires grounding into |
| Slot-model sanction | ADR-0038 | The slot model is the "first working rung" of FAFF-69's generalisation — a new slot is the sanctioned increment, not the deferred reframe |

**Scope statement:** this spike is the design gate between the fable-week umbrella (FAFF-314) and the FAFF-127 → FAFF-128 build chain; it writes docs and tracker artifacts only.

## 2. OUT OF SCOPE

- **Building the `grounding` slot** — that is FAFF-127, made mechanical by this spike. Extension point: slot-defaults registry (`bin/faff` ~:267), a new `contracts/grounding-evidence.schema.json`, a `CONTRACTS` entry + fixtures, `validate-adapters` type-map row.
- **Wiring the methodology consumer** — that is FAFF-128. Extension point: the named-outputs sections of `faffter-noon-methodology-thematic/SKILL.md` and `faffter-dark-methodology-agile-delivery/SKILL.md`.
- **Any real occupant** (RAG store, assistant endpoint, MCP knowledge server, thin local-docs reader) — occupants come after the seam exists. Extension point: a new occupant skill validated by slot conformance.
- **The FAFF-69 capability/role/invocation DSL** — deferred per ADR-0038. The spike borrows its vocabulary (`requires` floors, role `accesses` envelopes) to *express* the trust decision, but must not build or depend on the DSL.
- **Non-methodology consumers** (spec / review / routing consulting grounding) — FAFF-128's documented-seam question; the ADR names the seam, later tickets wire it.

## 3. WHAT — Vocabulary and the Four Questions

**Vocabulary:**

| Term | Definition |
|---|---|
| grounding slot | `.faffrc` `slots.grounding` — a pluggable evidence-fetcher consulted at decision time |
| occupant | The configured skill/endpoint filling the slot (RAG, MCP knowledge server, local docs, …) |
| evidence | Ranked snippets or scored claims + provenance; never a verdict, recommendation, or pass/fail |
| provenance | Source identity + locator + retrieval time attached to every claim, so a grounded decision is auditable |
| consumer | A slot that folds evidence into its own judgement (first: the methodology lens) |
| no-op default | Unset slot ⇒ byte-for-byte today's behaviour ("absence never blocks") |
| forward-interface | The already-shipped `grounding_present` datapoint + "advisory when present" prose the design must honour |

The spike answers four questions. For each, the spec records the **evidence-anchored starting hypothesis** from prep's explore — an input the spike must confirm or refute, **not** a pre-made decision (see Design Decision Rationale, spike-shape decision 4).

**Q1 — Query → evidence contract shape.** What a consumer passes and what grounding returns. Starting hypothesis: mirror the `faff-contract:<name>` pattern with a `grounding-evidence` contract validated by `faff contract grounding-evidence`; query carries `{consumer, decision_type, subjects[], question}`; response carries evidence only. Sketch (spike input, to confirm/refute):

```
RECORD GroundingQuery:
  consumer: SlotName            # who is asking (methodology, later spec/review)
  decision_type: String         # e.g. "yagni-within-scope", "ticket-shaping"
  subjects: List<String>        # issue IDs / artifact names under decision
  question: String              # the natural-language ask

RECORD GroundingEvidence:
  status: ENUM { ok, empty, unavailable }   # unavailable ⇒ consumer proceeds as if unset
  claims: List<Claim>           # ranked; may be empty
  violations: List<String>      # contract-validation channel, mirrors sibling contracts

RECORD Claim:
  claim: String                 # the evidence statement / snippet
  score: Float                  # per-claim relevance/confidence — an attribute of evidence
  provenance: RECORD { source: String, locator: String, retrieved_at: Timestamp }

CONSTRAINT schema has additionalProperties: false and NO verdict / recommendation /
           pass-fail / aggregate field — evidence-not-verdict is enforced by shape
```

**Q2 — Default occupant.** Pure no-op vs a thin "local docs / ADRs" reader. Starting hypothesis: **pure no-op default** — FAFF-256's shipped record already treats absence as the designed baseline ("absence never blocks"), and a reading default would make every decision path do I/O nobody asked for; the thin local-docs reader becomes the first *optional* occupant demonstrating the seam.

**Q3 — External-endpoint trust / lane model.** Where an outbound-calling occupant sits and how its output is handled. Starting hypothesis: evidence is **untrusted data by classification** — it inherits the gateway's data-not-instructions floor exactly as tracker free-text does (never executed, never treated as an imperative); the occupant is invoked from the orchestrator/methodology side (a consumer calling *out*), outbound network access sits behind the L4 container boundary that `faff container-check` asserts, and any on-disk evidence artifact inherits ADR-0039's shared-fs forge caveat (the build lane could forge it — so evidence for gate-adjacent decisions must be fetched/held orchestrator-side, not read back off a shared worktree).

**Q4 — Consumer wiring order + advisory-by-construction.** Which named-outputs consume grounding first and how "advisory, never an override" holds structurally. Starting hypothesis: first consumers are the shipped `yagni-judge` `within_scope` sub-judgment (already fetch-shaped) plus `ticket-shaping` and `pick-ordering` (FAFF-128's named candidates); advisory-by-construction = the contract returns evidence only (Q1's shape constraint) **and** the consumer's own contract keeps the judgement fields (`principle`, `diagnosis`, `action`) producer-owned, with grounding surfacing only as cited provenance inside the finding.

## 4. HOW — Spike Method and Deliverables

**Method — refutation-log spike** (the FAFF-278/ADR-0039 shape): per question, state the hypothesis, then adversarially attempt to break it against repo ground truth and threat cases, recording each attempt + outcome in a refutation log; a hypothesis that survives becomes the decision, one that breaks is replaced or narrowed.

```
PROCEDURE run_spike:
  1. Re-verify ground truth (the Assumes list below) against the tree
  2. FOR each question Q1..Q4:
     a. State the hypothesis (from WHAT)
     b. Attempt ≥2 distinct refutations (repo-contradiction, threat case,
        consumer-breaks, YAGNI/over-engineering)
     c. Record each attempt + outcome in the refutation log
     d. Close: Decision (survived / amended / narrowed) + rationale + residuals
  3. Author the ADR (Context / Decision / Consequences), number via
     `faff adr next-number` at authoring time; re-check before merge
  4. Refresh the FAFF-127 spec from the decisions (all former open questions
     become Chosen/Assumes markers) + post the FAFF-128 wiring-direction comment
  5. Land ADR + refutation log via PR on this ticket's branch
```

**Deliverable placement:**

- **ADR + refutation log** → committed on this ticket's branch, shipped by PR (the FAFF-278 precedent: `records/adr/00NN-….md` + the log alongside).
- **Refreshed FAFF-127 spec** → attached to FAFF-127 as a tracker comment (the prep lifecycle: a spec lives on the tracker until *its* build starts), carrying full spec-readiness markers + a confidence line so FAFF-127 is build-ready without another prep pass.
- **FAFF-128 wiring direction** → a tracker comment on FAFF-128 (direction, not a full spec — FAFF-128 still gets its own prep when its turn comes).

**Timebox:** one fable-week working day. On overrun: land the settled questions, narrow the rest per the narrow-boundary principle, file costed follow-ups.

**Failure modes — how the spike could be wrong, and how you'd notice:**

- **The trust question doesn't settle cleanly.** The failure: no boundary short of "build the FAFF-69 role model" safely admits an outbound occupant. How you'd know: the Q3 refutation log keeps producing unmitigated threat cases (evidence forging, prompt-injection-via-snippet, credential exposure on the outbound call). What it means: **narrow, don't abandon** — settle the contract + no-op default + local-read-only occupants, and record "no external-endpoint occupant is sanctioned yet" as an explicit ADR boundary with its unblocking precondition named.
- **Evidence-not-verdict proves too strict.** The failure: real consumers turn out to need something judgement-shaped (e.g. an aggregate "relevant/not"), tempting a verdict field back in. How you'd know: the Q4 walk-through of `within_scope` / `ticket-shaping` can't compose raw claims without one. What it means: the per-claim `score` stays (an evidence attribute); any *aggregate* judgement moves consumer-side — if that split fails the walk-through, the contract shape is wrong and the ADR must say so, not fudge it.
- **The no-op default hides a dead seam.** The failure: shipping a slot nothing exercises leaves the contract unproven (the FAFF-256 `grounding_present` field is presence-only, not shape-exercising). How you'd know: no fixture/golden case would fail if the evidence schema were wrong. What it means: the ADR's Consequences must require FAFF-127 to ship contract fixtures + golden cases exercising the full evidence shape even with the no-op default — the seam is proven by tests, not by an occupant.
- **Premise drift.** The failure: FAFF-127/128 move (built, re-sliced, cancelled) between spec and spike. How you'd know: step 1's ground-truth re-verify. What it means: re-scope or park; do not design against a stale target.

**Anti-pattern:** settling Q1–Q4 in this spec. Why: the spike *is* the settlement — pre-deciding here collapses the refutation step into confirmation bias; hypotheses are inputs, the ADR is the output.

**Anti-pattern:** writing production code or the actual `grounding-evidence` schema file during the spike. Why: the deliverable is decisions (docs + tracker); the schema ships with FAFF-127's build, where its fixtures and golden tests live in the same PR.

## Scenarios

```
Given the accepted ADR and refreshed FAFF-127 spec
When FAFF-127's build agent reads the spec with only it as context
Then every former FAFF-127 open question resolves to a Chosen/Assumes marker
     and no Punt escalates a question the ADR settled
```

```
Given the contract shape the ADR decides
When a hypothetical occupant returns a payload carrying any verdict,
     recommendation, or pass/fail field
Then the specified `faff contract grounding-evidence` validation rejects it
     by schema shape (additionalProperties: false), not by prose rule
```

```
Given `slots.grounding` unset under the decided design
When any consumer decision path runs
Then behaviour is byte-for-byte today's — no query, no I/O, no output change
```

Non-functional assertions:

- The ADR names where an outbound-calling occupant sits relative to the L4 container boundary, and classifies fetched evidence as untrusted data under the gateway floor.
- Every Q1–Q4 decision in the ADR cites ≥2 recorded refutation attempts in the log.
- The spike ships no production code and no schema file — docs + tracker artifacts only.

## 6. DESIGN DECISION RATIONALE

These are the **spike-shape** decisions this spec closes. The four design questions themselves are the spike's work product, not decisions of this spec.

**One ADR or four?** Four per-question ADRs would fragment one interlocking design (the trust model constrains the contract shape; the contract shape is what makes Q4 structural). **Chosen:** a single ADR covering Q1–Q4, one section per question — mirroring ADR-0039's multi-part decision shape.

**Spike method?** A free-form design essay is cheap but unfalsifiable; the house precedent (FAFF-263/ADR-0029, FAFF-278/ADR-0039) is hypothesis → adversarial refutation → decision-or-narrowing. **Chosen:** refutation-log spike, ≥2 distinct refutation attempts per question, log committed with the ADR.

**Where deliverables land?** Options: everything in the PR; everything on the tracker; split. A committed FAFF-127 spec would violate the prep lifecycle (specs live on the tracker until their build); a tracker-only ADR would violate the ADR log's append-only repo home. **Chosen:** split — ADR + refutation log via PR on this branch; refreshed FAFF-127 spec as a tracker comment on FAFF-127; FAFF-128 gets a wiring-direction comment.

**Do the explore hypotheses bind the spike?** Pre-deciding would make the refutation step theatre; ignoring the explore would waste verified ground truth. **Chosen:** the WHAT hypotheses are evidence-anchored starting points the spike must confirm or refute — the ADR may overturn any of them with recorded rationale, and an overturned hypothesis is a *successful* spike outcome, not a failure.

**Timebox posture?** Open-ended design risks the fable-week doctrine (frontier time is the scarce input); too tight forces binary GO/NO-GO calls the precedent warns against. **Chosen:** one fable-week working day, with the narrow-boundary principle as the overrun valve (land settled cores, file costed follow-ups).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none escalated. Q1–Q4 are the spike's scoped deliverable — closing them *is* the work — so this spec carries no `Punt:` markers; a human decision is not needed to start.

**Assumptions:**

- **Assumes:** FAFF-127 and FAFF-128 exist, are in Backlog, and are unbuilt. Validation: fetch both from the tracker at spike start (verified 2026-07-03 by prep; re-verify — the plot re-slice collision precedent makes peer drift real).
- **Assumes:** the contract registry pattern (`CONTRACTS` ~`bin/faff:6051`, `cmdContract` ~:6265, `schemaCheck` ~:5170) and the `spec-readiness.schema.json` template are current. Validation: grep/read before authoring the ADR's contract-shape section.
- **Assumes:** the shipped forward-interface is as explored — `grounding_present` in the `prdr-yagni` fixtures (~`bin/faff:6138–6147`), the gateway advisory line (~`SKILL.md:963`), FAFF-256 spec Chosen D2. Validation: read all three at spike start.
- **Assumes:** the next ADR number is free at authoring time (expected 0040). Validation: `faff adr new` / `faff adr next-number` at authoring, re-checked immediately before merge (the concurrent-graft ADR-collision precedent).

## 8. DONE — Definition of Done

### From WHY
- [ ] An ADR (Context / Decision / Consequences) is accepted on this ticket's branch covering **all four** questions, each closed with a decision + rationale, with any residuals named as explicit boundaries + costed follow-up tickets cited.

### From WHAT (the four questions)
- [ ] Q1: the ADR specifies the query → evidence contract shape (fields, status enum, provenance record) and states the structural no-verdict guarantee (`additionalProperties: false`, no verdict-shaped field).
- [ ] Q2: the ADR names the shipped default occupant behaviour and its rationale, including what "unset ⇒ byte-for-byte today" requires of consumers.
- [ ] Q3: the ADR states the trust classification of fetched evidence, the lane the occupant is invoked from, the outbound-call boundary relative to the L4 container, and addresses ADR-0039's forge caveat for on-disk evidence.
- [ ] Q4: the ADR names the first consumer named-outputs and the by-construction mechanism keeping grounding advisory (contract-side shape + consumer-side judgement ownership).

### From HOW (deliverables and method)
- [ ] The refutation log is committed alongside the ADR, with ≥2 recorded refutation attempts per question, each with an outcome.
- [ ] A refreshed FAFF-127 spec is attached to FAFF-127 as a tracker comment, satisfying the spec-readiness contract (markers + confidence line) with FAFF-127's open-questions section fully resolved to markers.
- [ ] A wiring-direction comment is posted on FAFF-128 naming first consumers + the advisory mechanism.
- [ ] The spike's PR contains docs/tracker artifacts only — no production code, no schema file.
- [ ] `faff adr validate` passes after the ADR lands.
- [ ] Timebox respected, or the overrun narrowing (what settled, what was narrowed, follow-ups filed) is recorded in the ADR.

**Eval coverage:** not applicable — the spike introduces no LLM-judgement runtime seam (it is a design pass producing docs and tracker artifacts; the seams it designs are built and registered under FAFF-127/128).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Open the merged ADR → each of the four questions has a Decision subsection
  2. Run `faff adr validate` → exit 0
  3. Open FAFF-127 → newest comment is a spec whose open-questions section
     contains only Chosen/Assumes markers + a confidence line
  4. Open FAFF-128 → a wiring-direction comment exists citing the ADR
  5. `git diff main` on the spike PR → only docs/ (+ tracker-side artifacts) changed
```

confidence: high
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. A one-day timeboxed spike is inside the 1–3-day unit. The four questions read as one decision (the trust model constrains the contract shape; the contract shape is what makes the wiring structural), so they do not split into independent units — and the spec's narrow-boundary valve handles overrun without inflating the ticket.
- **Workstream fit? (principles 1 + 5)** — Observation, no action forced. FAFF-322 sits project-less in Backlog, which is the sanctioned default landing for newly captured work. Its real value stream is the grounding chain (FAFF-322 → FAFF-127 → FAFF-128); if that chain gets sequenced as a deliverable, it belongs in an outcome-named container (e.g. "Grounded decisioning"), not the time-themed fable-week umbrella (FAFF-314) — a time-box is a schedule, not an outcome. Nothing to do at prep time.
- **Deps surfaced? (principle 6)** — One check to make. FAFF-322 → FAFF-127 is drawn (this issue blocks FAFF-127). The spec's deliverables also commit FAFF-128 direction, and FAFF-128's own description says it consumes FAFF-127's contract — verify the FAFF-127 → FAFF-128 `blockedBy` edge exists in the tracker and draw it if it only lives in prose, so automation sequences the chain honestly.
- **Risk profile? (principle 7)** — No issues; this ticket *is* the de-risking move. The spike pulls the novel-integration risk (untrusted external endpoints) ahead of the FAFF-127 build, and the spec names the riskiest question's failure mode with a narrowing outcome rather than a binary GO/NO-GO.

---

*Spec-review: **approve** (faffter-noon-spec-review, single-pass; lenses fired: architectural, infosec, QA — methodology skipped by the change-surface cost-gate; zero objections). Verdict validated via `faff contract spec-review-verdict` (exit 0), 2026-07-03.*
