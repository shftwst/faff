```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a Node 22 batch command packaged in the existing Docker Compose deployment and triggered nightly by a host scheduler. Read the existing timesheet table in PostgreSQL and write weekly summary rows in a transaction using a unique summary key and upserts. Take a database advisory lock to prevent overlapping runs and use a consistent database snapshot for each run. Record completion, affected row counts and failures in job logs; make failed runs safely repeatable. Validate the command in existing GitHub Actions CI.",
  "rationale": "Nightly batch job: a nightly scheduler invokes the batch command. Reads the existing timesheet table and writes weekly summary rows: the command queries PostgreSQL and transactionally upserts summaries by week and the required grouping keys. A few thousand reads and a few dozen writes per run: one database-backed process handles this bounded workload. No real-time fan-out or cross-partition ordering: processing runs as one scheduled job over a consistent snapshot. Use existing infrastructure: Node 22, Docker Compose, PostgreSQL and GitHub Actions are evidenced in the supplied profile; the scheduler is an explicit assumption to verify.",
  "adr_candidates": [
    {
      "title": "Run weekly summaries as a nightly database batch",
      "decision": "Use a scheduled Node 22 command in the existing Compose deployment to read PostgreSQL timesheets and transactionally upsert weekly summaries, with a consistent snapshot, an overlap lock and repeatable runs.",
      "rationale": "The nightly schedule and stated read/write volume fit one batch process using the existing runtime, deployment and datastore."
    }
  ],
  "assumptions": [
    "The supplied successful profile-show result describes infrastructure available to this job.",
    "The existing host has a scheduler that can launch the Compose batch command nightly; scheduler availability is not recorded in the profile.",
    "The timesheet schema, summary grouping keys, week boundaries and timezone will be confirmed before implementation.",
    "Re-running a weekly summary may replace its derived values from source data; summary rows have a unique key matching the agreed grouping.",
    "Database credentials can be scoped to read timesheets and write summary rows, and an operator can inspect failed-run logs."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Run weekly summaries as a nightly database batch: candidate to schedule a Node 22 command in the existing Compose deployment, read PostgreSQL timesheets and transactionally upsert weekly summaries with a consistent snapshot, overlap lock and repeatable runs. The stated nightly workload fits the existing infrastructure.

Proposal for later review. Scheduler availability and summary semantics require verification; production suitability remains a human judgement.

confidence: medium