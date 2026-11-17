```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build one Node 22 application for users, projects and timesheet entries, deployed through the existing Docker Compose setup with the existing PostgreSQL datastore and GitHub Actions CI. Store PostgreSQL data on a persistent volume; use schema migrations, foreign keys and database transactions. Protect edits with row versions and reject stale updates within the transaction.",
  "rationale": "Small internal timesheet tool for a handful of users: one application handles the stated workload. Relational users/projects/entries: PostgreSQL tables and foreign keys preserve their relationships. Must survive restarts: a persistent PostgreSQL volume retains committed records; scheduled backups and restore checks support recovery. Concurrent edits need transactional integrity: transactions keep related writes atomic and row-version checks prevent silent overwrites. Use the existing team runtime and deployment: Node 22, Docker Compose, PostgreSQL and GitHub Actions are recorded in the supplied successful profile-show result. No streaming or high-throughput ingestion requirement: synchronous request handling and transactional writes meet the stated processing needs.",
  "adr_candidates": [{"title":"Use the existing Node and PostgreSQL deployment for timesheets","decision":"Run one Node 22 application in Docker Compose with persistent PostgreSQL storage, relational constraints, transactional writes and row-version checks.","rationale":"The existing runtime and datastore support the small internal workload, restart durability and concurrent-edit integrity."}],
  "assumptions": ["The existing Compose host can allocate persistent PostgreSQL storage and backup storage.","The team will confirm the internal authentication mechanism and access rules before implementation.","Backup retention and restore objectives remain to be agreed."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Use the existing Node and PostgreSQL deployment for timesheets: run one Node 22 application in Docker Compose with persistent PostgreSQL storage, relational constraints, transactional writes and row-version checks. The existing runtime and datastore support the small internal workload, restart durability and concurrent-edit integrity. Candidate for later promotion by graft Step 4b; no ADR has been written.

Proposal for later review; production suitability requires human judgement.

confidence: high
