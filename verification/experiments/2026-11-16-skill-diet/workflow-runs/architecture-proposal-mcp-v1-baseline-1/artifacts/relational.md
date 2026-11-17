```faff-contract:architecture-proposal
{
  "chosen_architecture": "A single Node 22 application with users, projects and entries modules, deployed through the existing Docker Compose deployment and backed by the existing PostgreSQL datastore. Store relational users/projects/entries with foreign keys and constraints. Run each entry edit in a transaction with a version check; reject stale versions so concurrent edits cannot silently overwrite changes. Persist PostgreSQL data on a durable Compose volume, manage schema changes with migrations, and test backup restoration before release. Run migration and transaction checks in the existing GitHub Actions CI.",
  "rationale": "A small internal timesheet tool for a handful of users fits one application on the existing team runtime and deployment: the supplied profile records Node 22, Docker Compose, PostgreSQL and GitHub Actions. Relational users/projects/entries are represented by PostgreSQL tables with foreign keys. Records must survive restarts: a durable database volume retains committed data across application and database restarts. Concurrent edits need transactional integrity: transactions, constraints and version checks preserve consistency and expose editing conflicts. No streaming or high-throughput ingestion requirement is stated; synchronous request handling meets the stated workload. The profile records a local-first preference and no managed service entitlement.",
  "adr_candidates": [
    {
      "title": "Run the timesheet tool on the existing Node and Compose deployment",
      "decision": "Build one Node 22 application with users, projects and entries modules and deploy it through the existing Docker Compose deployment and GitHub Actions CI.",
      "rationale": "The small internal user group and existing runtime, deployment and CI support one application."
    },
    {
      "title": "Persist timesheets transactionally in PostgreSQL",
      "decision": "Use the existing PostgreSQL datastore with foreign keys, constraints, durable volume storage, migrations, backups and transactional version-checked edits.",
      "rationale": "Relational records must survive restarts, and concurrent edits require transactional integrity and visible conflicts."
    }
  ],
  "assumptions": [
    "The supplied successful profile-show result describes infrastructure available to this tool; service versions and capacity will be verified before implementation.",
    "The existing Compose host provides durable storage that survives container replacement; backup storage and restoration procedures must be confirmed before release.",
    "The workload remains a handful of internal users without streaming or high-throughput ingestion.",
    "Internal access controls and authentication requirements will be confirmed during specification."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Run the timesheet tool on the existing Node and Compose deployment: build one Node 22 application with users, projects and entries modules, using existing Compose deployment and GitHub Actions CI. The small internal user group and existing infrastructure support one application.
- Persist timesheets transactionally in PostgreSQL: use the existing datastore with foreign keys, constraints, durable volume storage, migrations, backups and transactional version-checked edits. Relational records must survive restarts, and concurrent edits require transactional integrity and visible conflicts.

Both entries are candidates for later review and materialisation by graft Step 4b. Production suitability remains subject to human review.

confidence: high