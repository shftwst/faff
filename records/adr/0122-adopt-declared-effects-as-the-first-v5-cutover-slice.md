# ADR 0122 — Adopt declared effects as the first V5 cutover slice

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-08-31
- **Issue:** FAFF-944

## Context

The V5 Phase 1 programme needs one external-producer cutover slice chosen on the evidence of the state-authority map (`docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`, FAFF-825) before Phase 2A can prove the external Commissaire protocol against it. A wrong first slice introduces the second canonical history the master RFC's Phase 1 exit evidence forbids, so the choice is made on the map and recorded here rather than made in passing.

The scored candidate brief (`CUTOVER-SLICE-SELECTION-v5.md`, FAFF-944) scores five candidate slices against the map on ten criteria. The brief informs; it does not decide. Two candidates stand out on different axes, and they pull apart: **Recovery-bundle publish and verify** is the safest and best-assured today (journal class J-C throughout, additive-only, no second canonical history), but it maps to facade verb 6 (seal and export an audit bundle) — the verb an external producer exercises last and least. **Declared effects** maps to facade verb 3 (request a protected-effect decision) — on the path of every consequential effect in every run — but its present effect-control class is E-C (after-the-fact detection) rather than the E-B (mediated-gateway prevention) that prevention-class effects need.

This decision resolves that tradeoff. It is a human judgement about what the first cutover is *for* — de-risk the safest thing, or prove the protocol on the verb that matters most — which the map deliberately does not settle.

## Decision

Adopt **Declared effects** as the first V5 cutover slice: the `effects.js` declare/observe/check machinery and the `effects-chain-head.json` witness, mapping to facade verb 3, request a protected-effect decision.

The reasoning is that the first cutover should prove the protocol on the verb exercised first and most, not the one exercised last. Verb 3 sits on the path of every consequential effect in every run, so it exercises the external facade hardest and is the slice most likely to make a real external second producer necessary — which is the whole point of Phase 2A. Recovery-bundle (verb 6) fires only on recovery and is exercised least, making it the least valuable first proof despite its clean assurance position. Verb 3 is also one of the facade's genuinely atomic operations, unlike the compound entries 4 and 6 (recorded as unknown U1 in the selection document), so the slice's facade boundary is a single well-defined operation rather than a fused pair.

The known cost is accepted knowingly: the slice's present effect class is E-C detection, one rung below the E-B prevention that a protected-effect decision provides. Closing that gap is not extra or deferred work — it *is* the Phase 2A deliverable for this verb (the mediated protected-effect-decision gateway), and Phase 2A's own exit evidence proves it. Detection is not traded away for prevention: the observe-and-reconcile loop (facade verb 4) persists alongside the new decision gate, so the slice ends Phase 2A able to both prevent a bad effect before it lands and detect one that occurred through an ungoverned path.

The other three candidates were not chosen:

- **Run-end ground truth** maps to the terminal-verdict verb (verb 5), which every workflow needs — but only once, at the very end, not first or most; and its work-item terminal verdict is entirely unmodelled today, and its facade boundary spans the compound verb 4 plus verb 5.
- **Merge floor** carries the brief's only unproven-assurance flag: it gates on J-D self-declared review and CI evidence with no map-named mechanism to raise it, and maps to no facade verb at all (it is SuperDomestique's own Software Delivery policy, not a Commissaire concern).
- **Corrective authority** is a control *over* producers rather than a verb they call, and maps to no facade verb directly.

## Consequences

This decision fixes the first slice Phase 2A (FAFF-828) builds against. It constrains that phase to deliver the mediated protected-effect-decision gateway that raises the slice from E-C to E-B, and to prove it under Phase 2A's own exit evidence. It leaves the current E-C effects mechanism running unchanged until that cutover — this ticket builds nothing.

The span trace found no `broken` invariant: the only intentionally-changed invariant family (Effect) carries a cited test, a migration rule (translated), and a rollback path (rule 7), so nothing escalates to FAFF-827 on the broken-invariant axis ahead of the ordinary acceptance review. Two questions are carried forward as unknowns in the selection document: whether the effect-stream readers (`merge-gate.js` `requireWitness`, `governance-check.js`) need code changes at cutover or are insulated by a transparent compatibility reader (U2, routed to FAFF-828), and whether the facade's two compound verbs should be split before Phase 2A implements them (U1, routed to FAFF-827 and the Phase-2A facade design).

This ADR was accepted by the FAFF-999 standalone-`commissaire`-CLI delivery decision (human, 2026-09-04), which ships the facade this slice targets. The Phase-1 acceptance gate FAFF-827 that would otherwise flip it is parked (`paused`) pending a second Commissaire consumer; for the purpose of this cutover the delivery decision stands in for it.
