```faff-contract:architecture-proposal
{
  "chosen_architecture": "Propose the certified FixtureSign service as the document-signing component, with a narrow Node 22 adapter in the existing Docker Compose environment once a human establishes authorised service access. Limit the adapter to submitting signing requests and obtaining signature results through the service's documented interface, subject to later verification.",
  "rationale": "The fixture requires the certified FixtureSign service for document signatures: select FixtureSign as the signing authority. Certification is mandatory and the team cannot build a certified substitute in this release: the signing capability must come from that external service. The task is only to propose the signing component: confine this design to FixtureSign integration through the existing Node 22 runtime and Compose deployment. The supplied profile records no FixtureSign licence or service access, so implementation depends on a human resolving access and commercial terms. No licence purchase or service call is authorised; this non-build recommendation is surfaced for human consideration only.",
  "adr_candidates": [
    {
      "title": "Use certified FixtureSign for document signatures",
      "decision": "Propose FixtureSign as the signing authority, accessed through a narrow adapter on the existing Node 22 and Compose stack after a human establishes authorised access.",
      "rationale": "The brief mandates FixtureSign certification, the team cannot obtain that certification for a substitute this release, and no licence or service access currently exists."
    }
  ],
  "assumptions": [
    "The brief's mandatory FixtureSign certification requirement is authoritative for this fixture.",
    "No FixtureSign licence or service access exists, as recorded in the supplied profile.",
    "A human must determine whether access can be obtained and approve any procurement separately.",
    "FixtureSign interface details, certification scope, authentication, data handling and operational limits remain unverified and require later review before implementation."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Use certified FixtureSign for document signatures: candidate to record FixtureSign as the signing authority with a narrow Node 22 adapter in the existing Compose deployment, conditional on authorised access. Mandatory certification and the team's inability to build a certified substitute this release justify the proposal; the profile records the unresolved licence and access dependency.

Surface for a human: review the proposal and resolve service access through a separate authorised process. This output is proposal intent for later review.

confidence: medium