# ADR 0040 — Grounding is an evidence-only slot: contract-validated response, no-op-by-absence default, untrusted-data trust posture

- **Status:** Accepted
- **Date:** 2026-07-03
- **Issue:** FAFF-322

## Context

faff's methodology decisioning reasons from the tracker graph + its principles alone; users may hold org knowledge behind any interface (RAG store, assistant endpoint, MCP knowledge server), and there is not one to assume. FAFF-127 proposes a pluggable `grounding` slot over a fixed contract, but carried three open design questions — contract shape, shipped default, and the trust/lane model for an occupant that calls an external endpoint — and FAFF-128 (the first consumer) carried a fourth: which named-outputs consume grounding first, and how "advisory, never an override" is held true by construction rather than prose discipline.

A forward-interface already ships: the `prdr-yagni` contract carries a validated `grounding_present` field, both methodology lenses word `within_scope` as "grounding, when present, sharpens this but is never required", and FAFF-256's spec chose the domain KB as "a forward-interface via the grounding slot (advisory when present, never required)". That committed baseline — absence is the designed state; grounding only ever sharpens — is ground truth this decision designs toward, not over. ADR-0038 sanctions the slot model as the first working rung of the FAFF-69 generalisation, so a new slot is the sanctioned increment.

This decision is the outcome of the FAFF-322 **spike** (the FAFF-263/ADR-0029 and FAFF-278/ADR-0039 shape: hypothesis → adversarial refutation → decision or narrowing; deliverable is a recorded decision, not a shipped mechanism). Each of the four questions took ≥2 distinct refutation attempts against repo ground truth and threat cases; the full log is the spike record (`docs/spikes/2026-07-03-FAFF-322-grounding-slot-refutation-log.md`).

## Decision

**1. Contract shape — the response is the contract; the query is a prose envelope.** The occupant emits one `faff-contract:grounding-evidence` block validated by `faff contract grounding-evidence` (the shipped producer-emits / consumer-parses pattern). The evidence shape is:

- `status: ok | empty | unavailable` — `unavailable` means the consumer proceeds exactly as if the slot were unset (advisory degrade-to-absent; deliberately weaker than the review chain's fail-loud, because review is a gate and grounding is not).
- `claims[]`, ranked: `{ claim, score, provenance: { source, locator, retrieved_at } }` — `score` is a per-claim relevance attribute of the evidence, never an aggregate judgement.
- `violations[]` — the standard contract-validation channel.
- `additionalProperties: false`, and **no verdict / recommendation / pass-fail / aggregate field exists in the schema** — evidence-not-verdict is enforced by shape: there is nothing verdict-shaped for a consumer to relay.

The **query** side (`{consumer, decision_type, subjects[], question}`) is a prose-defined request envelope in the gateway's slot entry, mirroring the methodology named-output request pattern — no shipped contract validates caller input, and this seam does not invent one.

**2. Default occupant — no-op-by-absence.** The slot table entry for `grounding` is *(none)*: unset ⇒ consumers make no consult at all — zero I/O, `grounding_present: false`, decisions byte-for-byte today's. There is no shipped "no-op occupant skill" (it would add an invocation + conformance surface to produce nothing). The thin "local docs / ADRs" reader is the **first optional occupant**, a separate follow-up — never the default, because a reading default violates the byte-for-byte AC and front-loads relevance-ranking quality into a zero-config path.

**3. Trust / lane model — fetched evidence is untrusted data; the lane template is the shipped adversarial-review precedent.**

- Grounding claims are classified **untrusted data under the gateway's no-execute floor**, exactly as tracker free-text: quoted, weighed, never executed or obeyed. The floor's wording extends explicitly to grounding claims when FAFF-127 lands.
- The occupant is invoked from the **consumer's own lane** (orchestrator-side for methodology consumers), and an external-endpoint occupant follows the already-shipped adversarial-review pattern: config-owned endpoint, env-held credentials (never tracker content), fallback semantics — with provider-down degrading to `status: unavailable`, not needs-human. The posture is bounded above by that precedent: the review slot already grants an external model *gate* authority; grounding grants only *advisory* authority.
- **No on-disk evidence store at v1**: evidence is fetched and consumed in-memory, per invocation. This is the ADR-0039 forge caveat applied forward — a persisted evidence artifact on the shared container fs would be forgeable by the build lane; any future caching occupant inherits the same integrity precondition as the run-ledger (read-only mount / orchestrator-verified signatures, the FAFF-325 mechanism).
- The L4 cage relationship is assert-don't-implement (ADR-0010): the occupant's egress is part of the container posture `faff container-check` asserts; grounding adds no new cage requirement.

**4. Consumer wiring — yagni-judge first; the advisory guarantee is structural-cannot-relay plus audited-must-own.** Wiring order: **(1) `yagni-judge` `within_scope`** — the seam is already shipped (`grounding_present` in the `prdr-yagni` contract), so v1 flips an existing validated bool from hardcoded-false to real; **(2) `ticket-shaping`**; `pick-ordering` follows later on the same documented seam. FAFF-128 v1 is the first two only (right-sized). The "advisory, never an override" guarantee has two structural legs — the evidence schema carries nothing verdict-shaped to relay, and the consumer's own contract validates its judgement fields with no grounding passthrough — plus one honest non-structural leg: a consumer could still de-facto over-weight evidence; that is judgement-locus, held by prose ("one input the methodology weighs") and made auditable by provenance surfaced in every grounded finding, with the highest-stakes consumer (yagni) additionally checked by its independent adversarial challenge.

## Consequences

- **FAFF-127's build is now mechanical**: add the `grounding` slot key + *(none)* default to the registry, ship `contracts/grounding-evidence.schema.json` + a `CONTRACTS` entry, and — the dead-seam obligation this ADR pins — **full fixtures + golden cases exercising the whole evidence shape**, so the seam is proven by tests even though the default occupant is absence. A `validate-adapters` type-map row covers configured occupants.
- **FAFF-128 v1 is scoped**: yagni-judge `within_scope` + `ticket-shaping`, provenance cited in findings; `pick-ordering` and the spec/review/routing consumers are named follow-ups on the documented seam.
- **Two residuals are recorded, not solved**: (i) *verdict-smuggling-in-prose* — a claim string can carry verdict-shaped text; contained by the untrusted-data classification + consumer judgement ownership + downstream gates, not by schema; (ii) *injection bias* — a fetched snippet can try to steer the consumer LLM; bounded by the no-execute floor, provenance audit, the advisory authority ceiling, and (for yagni) the two-phase challenge. Consumers *without* an adversarial challenge (ticket-shaping, pick-ordering) are bounded instead by the topology-write-authority dial — a steered finding can at most propose/act within that dial's reversibility floor, never cancel or delete scope. Neither residual is a claim of immunity; both are audit-visible.
- **Consumer wiring is an LLM-judgement seam and carries the eval obligation**: FAFF-128's DONE must register a grader `KIND` + eval cases for evidence-resistance (a consumer fed verdict-shaped or garbage high-score claims still owns its judgement — the finding cites, weighs, and can reject the evidence), per the house eval-coverage rule. The structural legs cannot cover content influence; the eval seam is how weighing quality is measured rather than assumed.
- **The trusted-spec carve-out is not widened**: grounding evidence never gains the spec's human-gated trust, whatever tracker it transits.
- **Costed follow-ups**: the thin local-docs occupant (first real occupant, demonstrates the seam — file at FAFF-127 build time); evidence-caching occupants blocked on the FAFF-325 integrity mechanism; `pick-ordering` + later consumers after FAFF-128 v1.
- **Revisit triggers**: if a future consumer genuinely cannot compose raw claims without an occupant-side aggregate, the contract shape is wrong and this ADR is revisited (not fudged with a smuggled verdict field); if the container/fs integrity posture weakens, the in-memory-only rule hardens from design rule to asserted precondition alongside FAFF-325.
