```faff-contract:architecture-proposal
{
  "chosen_architecture": "Use the certified FixtureSign service as the document-signing component, subject to human authorisation and obtaining the required licence and service access. The signing boundary accepts a document and signing request, submits them through FixtureSign's documented interface once access is authorised, and returns the service's signature result and certification evidence. Verify the applicable certification, interface, document-handling terms and result-verification procedure before implementation. This proposal covers only the signing component.",
  "rationale": "Requires the certified FixtureSign service for document signatures is met by selecting FixtureSign as the signing provider. Certification is mandatory is met by requiring verification of the applicable FixtureSign certification before use. The team cannot build a certified substitute in this release, as stated in both the brief and supplied profile; the required component therefore receives a buy recommendation. The task is only to propose the signing component is met by limiting this design to its request/result boundary. No licence purchase or service call is authorised: this recommendation is surfaced for a human, with no procurement or service operation performed. The profile records no FixtureSign licence or service access, so implementation and use depend on a later human decision and access provision.",
  "adr_candidates": [
    {
      "title": "Use certified FixtureSign for document signatures",
      "decision": "Propose FixtureSign as the signing component, conditional on human authorisation, verified applicable certification, and provision of the required licence and service access.",
      "rationale": "FixtureSign certification is mandatory and the team cannot build a certified substitute in this release; access and procurement remain human responsibilities."
    }
  ],
  "assumptions": [
    "The supplied fixture's requirement for FixtureSign certification is authoritative for this proposal; no independent certification verification has been performed.",
    "No FixtureSign licence or service access currently exists, as recorded in the supplied successful profile-show result.",
    "A human must decide whether to obtain the required access and authorise implementation and service use.",
    "FixtureSign's interface, certification scope, authentication, data retention and signature-verification procedures will be checked using authorised documentation before implementation.",
    "The surrounding application and document storage are outside this signing-component proposal."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Use certified FixtureSign for document signatures: propose FixtureSign as the signing component, conditional on human authorisation, verified applicable certification, and provision of the required licence and service access. Certification is mandatory and the team cannot build a certified substitute in this release; access and procurement remain human responsibilities.

This non-build recommendation requires human review. The ADR entry is a candidate for later review and materialisation by graft Step 4b. Production suitability remains subject to human review.

confidence: medium