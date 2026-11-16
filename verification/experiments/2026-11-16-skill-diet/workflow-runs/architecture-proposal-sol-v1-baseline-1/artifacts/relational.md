```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build one Node 22 timesheet application with users, projects and entries modules, backed by the existing PostgreSQL datastore and deployed through the existing Docker Compose target. Use GitHub Actions for migration and application checks.",
  "rationale": "For a small internal timesheet tool for a handful of users, one application serves the stated load. Relational users/projects/entries use PostgreSQL tables with primary keys, foreign keys and database constraints. Records must survive restarts: keep PostgreSQL data on a persistent volume and establish backup and restore procedures. Concurrent edits need transactional integrity: group related writes in database transactions and use row versions with conditional updates to report conflicting edits. Use the existing team runtime and deployment: Node 22, Docker Compose, PostgreSQL and GitHub Actions are evidenced in the supplied profile. No streaming or high-throughput ingestion requirement: process timesheet operations synchronously in the application.",
  "adr_candidates": [
    {
      "title": "Build the timesheet application on the existing Node and Compose stack",
      "decision": "Use one Node 22 application with domain modules, deployed with the existing Docker Compose target and checked in GitHub Actions.",
      "rationale": "The handful of internal users and synchronous operations fit the existing runtime, CI and deployment evidence."
    },
    {
      "title": "Persist timesheets transactionally in PostgreSQL",
      "decision": "Use relational users, projects and entries tables with constraints, transactions, row-version conflict checks, persistent storage and backup and restore procedures.",
      "rationale": "The brief requires relational records to survive restarts and concurrent edits to retain transactional integrity; PostgreSQL is already in the profile."
    }
  ],
  "assumptions": [
    "The supplied completed profile remains representative of the team environment.",
    "The existing Compose host can provide a persistent PostgreSQL volume and backup storage; restore verification remains to be performed.",
    "The team can supply the internal authentication and access requirements before implementation."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Build the timesheet application on the existing Node and Compose stack: candidate to record one Node 22 application with domain modules, Docker Compose deployment and GitHub Actions checks, justified by the handful of internal users and the supplied infrastructure evidence.
- Persist timesheets transactionally in PostgreSQL: candidate to record relational constraints, transactions, row-version conflict checks, persistent storage and backup and restore procedures, justified by restart durability and concurrent-edit integrity.

Proposal for later human review; ADR candidates remain intent.

confidence: high