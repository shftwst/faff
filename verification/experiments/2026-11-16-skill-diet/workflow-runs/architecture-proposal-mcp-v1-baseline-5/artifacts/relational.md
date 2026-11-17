```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build one Node 22 application with users, projects and entries modules, deployed through the existing Docker Compose target, backed by the existing PostgreSQL datastore. Use foreign keys and database constraints for the relational users/projects/entries model. Store committed records in PostgreSQL on persistent storage. Apply each edit in a transaction and use a row version check to detect concurrent edits without silently overwriting changes. Run schema migrations and application checks through the existing GitHub Actions CI.",
  "rationale": "A small internal timesheet tool for a handful of users fits one application on the profile's existing Node 22 runtime and Docker Compose deployment. Relational users/projects/entries are represented by PostgreSQL tables with foreign keys and constraints. Records must survive restarts: PostgreSQL commits persist on durable storage. Concurrent edits need transactional integrity: transactions make related changes atomic, and version checks detect competing updates for the caller to resolve. Use the existing team runtime and deployment: Node 22, Docker Compose, PostgreSQL and GitHub Actions are evidenced by the supplied profile. No streaming or high-throughput ingestion requirement: ordinary request-driven reads and transactional writes meet the stated workload.",
  "adr_candidates": [
    {
      "title": "Run the timesheet tool on the existing Node and Compose infrastructure",
      "decision": "Build one Node 22 application with users, projects and entries modules; deploy with the existing Docker Compose target and check changes in GitHub Actions.",
      "rationale": "The handful of internal users and existing runtime, deployment and CI support one deployable application."
    },
    {
      "title": "Persist timesheet records and concurrent edits in PostgreSQL",
      "decision": "Use the existing PostgreSQL datastore with persistent storage, relational constraints, transactions and row version checks for edits.",
      "rationale": "Users/projects/entries are relational, records must survive restarts, and concurrent edits need transactional integrity."
    }
  ],
  "assumptions": [
    "The supplied completed profile-show result is the infrastructure evidence for this proposal; the named source files have not been independently inspected.",
    "The existing PostgreSQL deployment can provide persistent storage, credentials and capacity for this tool; storage configuration must be verified before implementation.",
    "Conflicting edits may be rejected with a request to reload and reconcile the latest record.",
    "The team will define access permissions, backup retention and restore requirements before release."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Run the timesheet tool on the existing Node and Compose infrastructure: candidate to record one Node 22 application, domain modules, Docker Compose deployment and GitHub Actions checks because they fit the existing infrastructure and handful of users.
- Persist timesheet records and concurrent edits in PostgreSQL: candidate to record persistent storage, relational constraints, transactions and row version checks because records must survive restarts and concurrent edits need transactional integrity.

Candidates remain proposals for later review and materialisation by graft Step 4b. No ADR has been written and no quality verdict is issued.

confidence: high