```faff-contract:architecture-proposal
{
  "chosen_architecture": "One Node 22 timesheet application deployed through the existing Docker Compose setup, with relational users, projects and entries in the existing PostgreSQL datastore.",
  "rationale": "Small internal timesheet tool for a handful of users: one application serves the modest workload. Relational users/projects/entries: PostgreSQL tables use primary keys, foreign keys and constraints to preserve relationships. Records must survive restarts: persist PostgreSQL data on a durable Compose volume and provide backup and restore procedures. Concurrent edits need transactional integrity: commit related changes in database transactions and use row-version checks to reject stale edits. Use the existing team runtime and deployment: Node 22 and Docker Compose match the supplied profile; GitHub Actions runs migration and application checks. No streaming or high-throughput ingestion requirement: ordinary request-driven reads and writes meet the stated load.",
  "adr_candidates": [
    {"title": "Use the existing Node and Compose deployment for timesheets", "decision": "Build one Node 22 application and deploy it through the existing Docker Compose setup.", "rationale": "The profile records this runtime and deployment, and one application fits a handful of internal users."},
    {"title": "Persist transactional timesheet records in PostgreSQL", "decision": "Use the existing PostgreSQL datastore with relational constraints, durable storage, transactions and row-version checks for edits.", "rationale": "Users, projects and entries require relational integrity, survival across restarts and safe concurrent edits."}
  ],
  "assumptions": ["The existing PostgreSQL instance has capacity for this small workload.", "The deployment can provide a persistent PostgreSQL volume and an operator-owned backup and restore procedure; these remain to be verified.", "Internal user access and authentication requirements will be confirmed before implementation."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Use the existing Node and Compose deployment for timesheets: build one Node 22 application on the recorded deployment to serve the small internal workload. Candidate for later review and materialisation by graft Step 4b.
- Persist transactional timesheet records in PostgreSQL: use relational constraints, durable storage, transactions and row-version checks to meet durability and concurrent-edit integrity requirements. Candidate for later review and materialisation by graft Step 4b.

confidence: high