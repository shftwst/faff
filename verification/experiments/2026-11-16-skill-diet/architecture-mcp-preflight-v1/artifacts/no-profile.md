```faff-contract:architecture-proposal
{
  "chosen_architecture": "A local command-line program with a SQLite file on the laptop.",
  "rationale": "Local persisted records fit the single-laptop checkout workflow and survive restart without a shared server.",
  "adr_candidates": [
    {
      "title": "Persist local checkouts in SQLite",
      "decision": "Use one local SQLite database file.",
      "rationale": "The brief requires local records that survive restart."
    }
  ],
  "assumptions": [
    "No infra profile is available.",
    "A runtime suitable for a local CLI can be installed after human review."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Persist local checkouts in SQLite: Use one local SQLite database file. The brief requires local records that survive restart.

confidence: medium
