```faff-contract:architecture-proposal
{
  "chosen_architecture": "A Node service in docker-compose using the existing Postgres database.",
  "rationale": "The existing Node/Compose profile fits the small load. Postgres transactions provide transactional integrity for concurrent edits and durable storage to survive restarts.",
  "adr_candidates": [
    {
      "title": "Keep timesheets in Postgres",
      "decision": "Use the existing relational database with transactions.",
      "rationale": "Relational records need durability and transactional integrity."
    }
  ],
  "assumptions": [
    "The existing database has capacity for the small load."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Keep timesheets in Postgres: Use the existing relational database with transactions. Relational records need durability and transactional integrity.

confidence: medium
