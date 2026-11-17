```faff-contract:architecture-proposal
{
  "chosen_architecture": "One Node 22 application on the existing Docker Compose deployment, with users, projects and entries stored in the existing PostgreSQL datastore. Use foreign keys and database constraints for relational integrity, transactions for related writes, and version-checked updates to detect conflicting concurrent edits. Keep PostgreSQL data on persistent storage and maintain tested backups. Run application and migration checks in the existing GitHub Actions CI.",
  "rationale": "Small internal timesheet tool for a handful of users: one application serves the stated load. Relational users/projects/entries: PostgreSQL tables and foreign keys model those relationships. Records must survive restarts: commit records to PostgreSQL on persistent storage. Concurrent edits need transactional integrity: transactions apply related changes atomically, while version-checked updates report conflicts for the user to resolve. Use the existing team runtime and deployment: the supplied profile records Node 22, Docker Compose, PostgreSQL and GitHub Actions. No streaming or high-throughput ingestion requirement: handle entry writes synchronously in application requests. The profile records a local-first preference and no managed service entitlement.",
  "adr_candidates": [
    {
      "title": "Persist timesheets in the existing PostgreSQL datastore",
      "decision": "Run one Node 22 application through existing Docker Compose; store users, projects and entries in PostgreSQL with persistent storage, foreign keys, transactions and version-checked updates.",
      "rationale": "The existing runtime and deployment fit a handful of users; PostgreSQL provides durable relational records and transactional integrity for concurrent edits."
    }
  ],
  "assumptions": [
    "The supplied profile is the infrastructure evidence for this proposal; deployment access and datastore capacity remain to be verified.",
    "The existing PostgreSQL deployment can provide persistent storage, backups and a successful restore exercise before release.",
    "Users can resolve a reported edit conflict by reloading the current record and resubmitting their change.",
    "Internal access controls and user authentication requirements will be settled in the implementation spec."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Candidate: Persist timesheets in the existing PostgreSQL datastore. Proposed decision: run one Node 22 application through existing Docker Compose; store users, projects and entries in PostgreSQL with persistent storage, foreign keys, transactions and version-checked updates. Rationale: the existing runtime and deployment fit a handful of users; PostgreSQL provides durable relational records and transactional integrity for concurrent edits. Retain as intent for later review and possible materialisation by graft Step 4b.

confidence: high