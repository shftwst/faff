# ADR 0123 — Commissaire's CLI is a noun-verb object grammar, grammar-first over the existing handlers

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-09-02
- **Issue:** FAFF-977

## Context

The Commissaire facade (FAFF-828) shipped as seven flat verb subcommands under `faff commissaire`: `admit`, `declare`, `observe`, `request-decision`, `reconcile`, `terminal-verdict`, `seal-bundle`. The V5 technical design specifies the surface differently, as a noun-verb grammar `commissaire <object> <action>` over a set of governed objects: `contract admit`, `evidence register`, `effect decide`, `observation append`, `reconcile`, `verdict decide`, and `audit seal | export | verify` (`docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md`, the first-facade logical operations). The flat surface dropped the object dimension. That happened because the tickets and measurements framed the facade as "six conceptual verbs"; the object-then-action shape the design carried was never put forward as an option, so the terser grammar was adopted by default rather than by decision.

The cost of the flat surface is not cosmetic. It is a list of verbs with no grouping, so operations on the same object do not sit together, the top level grows a fresh token per operation, and the CLI stops teaching the object model the design is built on (Commissaire governs objects, and actions are done to them). The extensibility loss becomes concrete now: FAFF-977 adds the design's `audit verify` operation, and `audit` is the one object with three actions (`seal`, `export`, `verify`). Adding `verify` as a flat top-level verb, divorced from `seal-bundle` and the still-unbuilt `audit export`, is the point at which the missing grouping bites.

Three facts make the change cheap and timely:

1. **Nothing is built as an object.** There is no `Contract`, `Effect`, `Verdict`, or `Audit` type or module. What exists is a flat `cmdCommissaire` dispatcher, record *kinds* on one shared ledger (`KIND_AUTHOR`, keyed by a `kind_of_entry` string on a single generic envelope), and pure cores (`evaluateDecisionRequest`, `chokepointPermit`, `verifyAuthLeg`, `computeEscapes`). `terminal-verdict` and `seal-bundle` are boundary stubs that shell out to `faff events anchor` / `faff bundle publish`. So adopting the object grammar is additive over a flat verb list, not a migration away from an existing object model.
2. **Commissaire is meant to stand on its own.** The architecture diagrams name a standalone `commissaire CLI` over the typed command registry, with the `faff` launcher keeping governance aliases during the compatibility window (`ARCHITECTURE-DIAGRAMS-v5.md`, sections 3.4 and 4.6). The surface should therefore be coherent on Commissaire's own terms.
3. **faff-side naming overlap is not a constraint.** `faff contract` (the validator surface) and `faff effects` (effect-descriptor tooling) share words with the proposed objects, but faff's command names are subject to change and Commissaire may separate from them. The object model is chosen for Commissaire's internal sense, and the `commissaire` namespace (and eventual standalone binary) disambiguates.

## Decision

Adopt a noun-verb object grammar for the Commissaire surface, **grammar-first**: the objects are CLI namespaces over the existing handlers and record kinds, with no rewrite of the cores. The objects are anchored to the governance moments Commissaire owns, plus accountability over the record:

| Governance moment | Object | Actions | Backed today by |
|---|---|---|---|
| May work begin, under what agreement | `contract` | `admit` | `cmdAdmit` → `admission` record |
| May it cause a protected effect | `effect` | `declare`, `authorize`, `observe`, `reconcile` | `declare`/`observe` handlers, `evaluateDecisionRequest`, `chokepointPermit`, `computeEscapes` |
| May it be accepted | `verdict` | `conclude` | `terminal-verdict` stub → `accepted_under_contract` |
| Can it be held to account | `audit` | `seal`, `export`, `verify` | `seal-bundle` stub; `verifyAuthLeg` |

The resulting surface:

```
commissaire contract admit
commissaire effect declare
commissaire effect authorize
commissaire effect observe
commissaire effect reconcile
commissaire verdict conclude
commissaire audit seal
commissaire audit export
commissaire audit verify
```

Sub-decisions:

- **`effect` owns its full lifecycle** (`declare`, `authorize`, `observe`, `reconcile`). Reconcile is an effect action, not a bare verb: `computeEscapes` compares declared against observed effects per `(issue, step)`, which is exactly the effect stream's reconciliation event in the design. This is the change that stops reconcile being a loose top-level verb.
- **`effect authorize`**, not `decide`. `decide` never says what is being decided; `authorize` names the operation directly (seek authority for a protected effect, receiving a grant or deny) and is grounded in the design's own word for this stage of the effect stream ("intent, **authority**, attempt, observation, reconciliation"). `permit` and `gate` are deliberately left for the separate chokepoint enforcement act (`chokepointPermit`) rather than spent on the decision. The neutral `rule` was the runner-up; `authorize` was preferred for saying plainly what the effect operation grants.
- **`verdict conclude`**, not `decide`, `render`, or `ruling`. `ruling` is a noun and would break the imperative-verb pattern every other action follows. `conclude` carries the finality of a terminal verdict (it is the act that concludes the governed work) in a way the neutral `render` and the vaguer `decide` do not.
- **`audit` is the governance evidence record**: `seal` freezes it, `export` ships it, `verify` authenticates it. `verify` replays the auth leg (producer HMACs and Commissaire signatures) from published `pk.json` and holds whether or not a seal exists yet, which keeps FAFF-977's `audit verify` honest on an unsealed run.
- **The seven flat verbs are retained as compatibility aliases** mapping to the object-verb handlers (`admit` → `contract admit`, `request-decision` → `effect authorize`, `terminal-verdict` → `verdict conclude`, `seal-bundle` → `audit seal`, and so on). An alias never carries a second implementation, per the design's compatibility-launcher rule.
- **Naming is chosen for Commissaire's internal coherence.** Overlap with `faff contract` and `faff effects` is accepted, not designed around.

**Future direction, recorded not built.** The records evolve from the single `kind_of_entry` envelope into the design's typed per-object envelopes (`ContractProposal`, `ReconciliationDecision`, `AuditSeal`, and the `run` / `work-item` / `effect` stream `RecordEnvelope`). Grammar-first is the first step toward typed objects as the records: the CLI names the objects now, and the record layer grows into per-object types later without re-grammaring the surface.

**Objects deliberately left room for.** The design also names obligations, independence, and waivers as Commissaire concerns. They are enforced today inside `effect decide` (scope, assurance floor, evidence freshness) and are not built as surfaces. The grammar leaves clean slots (`contract obligations`, an `independence` object, `waiver grant`) so they attach later without disturbing the existing objects.

## Consequences

- **FAFF-977 lands as `audit verify`**, under the `audit` object, rather than as a flat top-level `verify`. This is the first operation authored directly under the new grammar.
- **Implementation is a registry re-grouping**, not a core change: introduce the object nesting in `cli-surface.js` / `COMMISSAIRE_SURFACE`, route each object-verb to its existing handler, and register the seven flat verbs as aliases. `evaluateDecisionRequest`, `chokepointPermit`, `verifyAuthLeg`, and `computeEscapes` are untouched.
- **FAFF-980 carries the grammar re-grouping** of the remaining objects, with FAFF-977 landing the `audit` object first and sitting on top of it. FAFF-978 (facade hardening) is in review on this same surface, so FAFF-980 is sequenced after it (recorded as a blocked-by relation) to avoid collision.
- **The design's original nouns are reconciled.** `evidence register` and `observation append` are recognised as effect actions (`effect declare`, `effect observe`), not separate top-level objects, matching what the code actually writes. The design text should be updated to the object set `contract` / `effect` / `verdict` / `audit`.
- **Two untracked follow-ons now have a grammar to land under:** the standalone `commissaire` CLI front-end (the diagrams' "commissaire CLI, Phase 2A") and `audit export` (the ninth design operation, still unbuilt).
- **This ADR was accepted by the FAFF-999 standalone-`commissaire`-CLI delivery decision (human, 2026-09-04).** It records the grammar decision; FAFF-977 and FAFF-980 materialised the grammar over the existing handlers, and FAFF-999 ships it as the standalone `commissaire` binary this ADR anticipated (the "commissaire CLI front-end" consequence above).
