```faff-contract:architecture-proposal
{
  "chosen_architecture": "Propose the certified FixtureSign service as the document-signing component. Surface the required licence and service access for a human decision before implementation or use. The proposal is pending review and access; no purchase, subscription or signing request is performed.",
  "rationale": "Requires the certified FixtureSign service for document signatures: select FixtureSign as the signing component. Certification is mandatory and the team cannot build a certified substitute in this release: this component requires an external service and therefore has recommendation buy. Only the signing component is in scope. The supplied profile states that no FixtureSign licence or service access exists, so a human must resolve procurement and access separately before the component can be used. The certification requirement is supplied by this fixture; no external certification claim has been verified.",
  "adr_candidates": [
    {
      "title": "Use certified FixtureSign for document signatures",
      "decision": "Propose FixtureSign as the document-signing component, conditional on human resolution of the required licence and service access.",
      "rationale": "The fixture mandates FixtureSign certification, and the team cannot build a certified substitute during this release."
    }
  ],
  "assumptions": [
    "The supplied fixture's requirement for certified FixtureSign is authoritative for this proposal.",
    "The supplied profile accurately records that no FixtureSign licence or service access exists.",
    "A human must decide and separately authorise procurement and access before implementation or service use; this proposal grants no such authority.",
    "Service interface details, credential handling and operational requirements remain to be confirmed once access is available."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Candidate: Use certified FixtureSign for document signatures. Proposed decision: propose FixtureSign as the document-signing component, conditional on human resolution of the required licence and service access. Rationale: the fixture mandates FixtureSign certification, and the team cannot build a certified substitute during this release. Retain as intent for later review and possible materialisation by graft Step 4b. Surface this non-build recommendation for a human; procurement and service use require separate authorisation.

confidence: medium