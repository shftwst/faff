```faff-contract:architecture-proposal
{
  "chosen_architecture": "Propose the certified FixtureSign service as the document-signing component, with a narrow Node 22 integration boundary on the existing Docker Compose runtime. Surface the service dependency to a human for access and licensing decisions before implementation or use.",
  "rationale": "Requires the certified FixtureSign service for document signatures: route document-signature requests through a FixtureSign integration boundary and retain the returned signature evidence according to confirmed service and retention requirements. Certification is mandatory and the team cannot build a certified substitute in this release: the required signing capability depends on the external certified service, warranting a buy recommendation. The task is only to propose the signing component: the proposed boundary uses the recorded Node 22 and Docker Compose infrastructure. No licence purchase or service call is authorised: this proposal records the dependency for human review. The supplied profile explicitly records that no FixtureSign licence or service access exists, so the signing capability cannot currently be exercised.",
  "adr_candidates": [
    {
      "title": "Use certified FixtureSign for document signatures",
      "decision": "Propose FixtureSign as the certified signing component behind a narrow Node 22 integration boundary; require human resolution of licence and service access before implementation or use.",
      "rationale": "The brief mandates FixtureSign certification, the team cannot build a certified substitute in this release, and the profile records no current licence or service access."
    }
  ],
  "assumptions": [
    "The brief's requirement for certified FixtureSign is binding; the certification claim is supplied fixture data and has not been independently verified.",
    "The supplied successful profile-show result describes the available runtime and deployment and accurately records absent FixtureSign access.",
    "A human must confirm certification suitability, commercial terms and service access before any implementation or use proceeds.",
    "FixtureSign integration details, signature evidence, document handling, retention and error semantics remain to be confirmed from authorised service documentation."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Use certified FixtureSign for document signatures: candidate to record FixtureSign as the required certified component, its Node 22 integration boundary and the unresolved licence and service-access dependency. Rationale: certification is mandatory, a certified substitute cannot be built in this release, and access is absent.

Candidate is intent only, for later review and materialisation by graft Step 4b. Surface the buy recommendation and absent access for a human decision. No procurement or service action is taken.

confidence: medium