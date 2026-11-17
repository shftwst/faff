```faff-contract:architecture-proposal
{
  "chosen_architecture": "Propose the certified FixtureSign service as the document-signing component, accessed through a narrow Node 22 adapter in the existing Docker Compose runtime. The adapter would submit authorised signing requests, retain service request identifiers and return signature results. Integration details remain conditional on verified service documentation, certification scope and access. Refer the required service access and licence decision to a human before implementation or use.",
  "rationale": "Requires the certified FixtureSign service for document signatures: FixtureSign is the proposed signing component. Certification is mandatory and the team cannot build a certified substitute in this release: the required capability is not locally buildable, which supports a buy recommendation. The supplied profile records Node 22 and Docker Compose for the adapter, and explicitly states that no FixtureSign licence or service access exists. Task is only to propose the signing component: the output is a conditional proposal for human review, with no purchase, subscription or service call.",
  "adr_candidates": [
    {
      "title": "Use certified FixtureSign for document signatures",
      "decision": "Propose FixtureSign as the certified signing component behind a Node 22 adapter, conditional on human resolution of licence, service access and certification verification.",
      "rationale": "The brief mandates FixtureSign certification and states that the team cannot build a certified substitute in this release; the profile records no existing licence or access."
    }
  ],
  "assumptions": [
    "The mandatory FixtureSign requirement and inability to build a certified substitute are supplied fixture facts; the service's certification scope has not been independently verified.",
    "No FixtureSign licence or service access exists, as recorded in the supplied profile.",
    "A human must resolve service availability, entitlement, costs and certification suitability before implementation or use; no procurement is authorised here.",
    "A Node 22 integration is feasible, but API behaviour, authentication, retry safety and signature verification must be confirmed from service documentation once access is authorised.",
    "Document handling, retention and access requirements must be settled before sending documents to the service."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Use certified FixtureSign for document signatures: candidate to place FixtureSign behind a Node 22 adapter, conditional on human resolution of licence, service access and certification verification. The brief mandates the certified service and the profile records no entitlement.

Non-build recommendation surfaced for human review. No purchase, subscription, service call or ADR materialisation is performed. Production suitability remains a human judgement.

confidence: medium