```faff-contract:architecture-proposal
{
  "chosen_architecture": "Use the certified FixtureSign signing service, conditional on human procurement and access approval.",
  "rationale": "The required certification is unavailable to an in-house implementation in this release. A non-build recommendation needs human review before any action.",
  "adr_candidates": [
    {
      "title": "Require certified FixtureSign signatures",
      "decision": "Propose the certified service subject to human approval.",
      "rationale": "Certification is mandatory and not locally buildable in the release."
    }
  ],
  "assumptions": [
    "No licence or service access exists; a human must approve procurement."
  ],
  "recommendation": "buy"
}
```

## ADR promotion intent

- Require certified FixtureSign signatures: Propose the certified service subject to human approval. Certification is mandatory and not locally buildable in the release.

confidence: medium
