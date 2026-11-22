# Shorten the shared core-contract prose

## Scope

Replace only Core contracts and adaptor slots through EOF using the source-batch final text, retaining the original producer-consumer END anchor and restoring the original chosen/punt/assumes/none marker encoding. All preceding current-main bytes remain exact. Restore the existing loader literal never silently to pass in the review-verdict section; the unchanged source guard requires it. Restore the explicit autonomous resolve-attempt requirement in the medium-marker paragraph. This is a new corrected source treatment; prior held input-binding results remain held. Existing consumer tests and lint establish integration, not new model parity.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `faff-core fixes a small set of internal contracts — the verdict states, vocabularies, and classifications` | changed: compressed core-contract wording; same rule retained |
| `Dividing principle: anything the faff- pipeline branches on, counts, gates on, or admits → internal (fixe` | changed: compressed core-contract wording; same rule retained |
| `Skills load independently. When you enter via a slash command (/faff-graft), as a delegated slot, or invo` | changed: compressed core-contract wording; same rule retained |
| `1. Consumers load on entry. Every fixed faff- consumer (graft, tidy, beep-boop, wtf, prep, map, jot) read` | changed: compressed core-contract wording; same rule retained |
| `Conformance clause (binding on every slot occupant). Any skill occupying an adaptor slot (routing_adaptor` | changed: compressed core-contract wording; same rule retained |
| `A sub-skill that delegates to a foreign slot occupant — one faff does not ship — validates it before firs` | changed: compressed core-contract wording; same rule retained |
| `- Scope: foreign occupants only — decided by a deterministic predicate, never an LLM read of the occupant` | changed: compressed core-contract wording; same rule retained |
| `Per Contract loading & conformance above, every consumer already loads this gateway on entry, so this rul` | changed: compressed core-contract wording; same rule retained |
| `Internal contract (fixed): a review returns exactly one value from a closed set of states. Canonical sema` | changed: compressed core-contract wording; same rule retained |
| `One value is a distinct availability axis. One state means "a review ran and a human must judge it"; anot` | changed: compressed core-contract wording; same rule retained |
| `The envelope (canonical) + the consumer-fold. The review producer emits its verdict as a faff-contract:re` | changed: compressed core-contract wording; same rule retained |
| `Internal contract (fixed): the spec-stage approach-critique (the spec_review slot) returns exactly one ve` | changed: compressed core-contract wording; same rule retained |
| `The envelope + the consumer-fold. The spec_review slot (default faffter-noon-spec-review) emits its verdi` | changed: compressed core-contract wording; same rule retained |
| `Internal contract (fixed): delivery returns exactly one outcome from a closed three-value set, each carry` | changed: compressed core-contract wording; same rule retained |
| `Delivery preconditions are a routable not-ready, not a fourth outcome. Mechanical delivery preconditions ` | changed: compressed core-contract wording; same rule retained |
| `The gate is two-tier, and only the lower tier is delegable. The integrity floor — AC-verified + CI-green ` | changed: compressed core-contract wording; same rule retained |
| `"CI-green" means CI ran and is green — not "no CI ran". The floor's CI condition has three outcomes, not ` | changed: compressed core-contract wording; same rule retained |
| `Coercion (fixed): if the producer's native result cannot be mapped onto one of the three outcomes — empty` | changed: compressed core-contract wording; same rule retained |
| `The envelope (canonical) + the consumer-fold. The ship producer emits its result as a faff-contract:deliv` | changed: compressed core-contract wording; same rule retained |
| `Internal contract (fixed): the closed six-verdict vocabulary, the build-queue admission rule (only the tw` | changed: compressed core-contract wording; same rule retained |
| `Adaptor slot: routing_adaptor (default faffidavit-routing) — assigning a verdict from backlog-diagnostics` | changed: compressed core-contract wording; same rule retained |
| `Live-thread reconciliation (fixed — the tracker is the control surface). The spec confidence + markers in` | changed: compressed core-contract wording; same rule retained |
| `Internal contract (fixed): every non-trivial decision is classified as closed / open / external-dependenc` | changed: compressed core-contract wording; same rule retained |
| `The dialect (canonical) + the consumer-fold. This is the canonical home for the spec dialect the retired ` | changed: compressed core-contract wording; same rule retained |
| `- Decision markers — every non-trivial decision carries exactly one: Chosen: X (closed — implementer does` | changed: compressed core-contract wording; same rule retained |
| `The producer emits, the consumer parses. The spec producer emits a faff-contract:spec-readiness block — {` | changed: compressed core-contract wording; same rule retained |
| `Rendering is purely human-facing: no pipeline code branches on, counts, or gates on it, so there is no in` | changed: compressed core-contract wording; same rule retained |
| `Universal-routing rule (load-bearing). "User-facing output" means all human-facing output a sub-skill pro` | changed: compressed core-contract wording; same rule retained |
| `2. Standalone reads on demand. An adaptor invoked directly (e.g. "validate the spec for SHF-123") has no ` | changed: compressed core-contract wording; same rule retained |
| `3. New adaptors are authored to conform. faffter-dark-authoring-adaptors is the author/validate skill tha` | changed: compressed core-contract wording; same rule retained |
| `- How. Only when the predicate above returns exit 1 (foreign, or bundled-but-wrong-slot): invoke the faff` | changed: compressed core-contract wording; same rule retained |
| `- Cache once per run. Validate each distinct occupant once per session/run and cache the verdict — autono` | changed: compressed core-contract wording; same rule retained |
| `- On fail:` | changed: compressed core-contract wording; same rule retained |
| `- Autonomous — park the work unit (cause: slot non-conformant — <slot>:<occupant>), citing the violations` | changed: compressed core-contract wording; same rule retained |
| `- Interactive — surface the violations and stop before using the occupant; the user fixes the occupant (o` | changed: compressed core-contract wording; same rule retained |
| `- On pass — proceed normally; the cached pass means no further checks this run.` | changed: compressed core-contract wording; same rule retained |
| `- Pre-flight (optional, recommended before unattended runs). The runtime gate above surfaces a non-confor` | changed: compressed core-contract wording; same rule retained |
| `- Punt ownership (optional). A Punt: may carry a trailing (decides: <owner>) suffix naming who resolves i` | changed: compressed core-contract wording; same rule retained |
| `- Ratifier tag (optional). A Chosen: may carry a trailing (ratified: human) suffix — Chosen: X (ratified:` | changed: compressed core-contract wording; same rule retained |
| `- Confidence line — the spec ends with confidence: high \| medium \| low on its own line — the authoritativ` | changed: compressed core-contract wording; same rule retained |
| `- Provenance stamp — a single blockquote directly under the H1: > Spec: <producer> · <date> · <mode> · <h` | changed: compressed core-contract wording; same rule retained |
| `- Writing style — skimmable, not coded: no invented labelling schemes (F2, R3, Phase 4); restate the subj` | changed: compressed core-contract wording; same rule retained |
