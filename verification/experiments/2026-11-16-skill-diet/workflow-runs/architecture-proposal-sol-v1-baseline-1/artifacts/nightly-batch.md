```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a Node 22 batch command in the existing Docker Compose deployment. Schedule one nightly invocation on the existing host. Read the existing PostgreSQL timesheet table and transactionally upsert weekly summary rows in the same datastore; check the command in GitHub Actions.",
  "rationale": "A nightly batch job is met by a host schedule invoking the batch container once each night. Reads the existing timesheet table and writes weekly summary rows is met by a PostgreSQL aggregation and upsert keyed by the summary dimensions and week. A few thousand reads and a few dozen writes per run fits one bounded database transaction with a consistent snapshot. A transaction-scoped advisory lock prevents overlapping runs, and unique summary keys make retries idempotent. No real-time fan-out or cross-partition ordering: one scheduled aggregation completes each run without a distributed ordering mechanism. Use existing infrastructure: the supplied profile evidences Node 22, GitHub Actions, Docker Compose and PostgreSQL.",
  "adr_candidates": [
    {
      "title": "Generate weekly summaries with a nightly Node batch command",
      "decision": "Schedule one Node 22 command in the existing Compose environment to aggregate PostgreSQL timesheets and upsert weekly summaries in a consistent-snapshot transaction, using an advisory lock and unique summary keys.",
      "rationale": "The nightly cadence and few thousand reads and few dozen writes fit the existing runtime and datastore; locking and idempotent writes support overlap prevention and retry."
    }
  ],
  "assumptions": [
    "The existing host supports a scheduler and can invoke the batch container with database credentials.",
    "The team will confirm the week boundary, timezone and summary dimensions before implementation.",
    "The existing PostgreSQL deployment has persistent storage and sufficient capacity for the stated run size.",
    "The completed profile remains representative; schedule failures will be logged and surfaced through the existing operational process."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Generate weekly summaries with a nightly Node batch command: candidate to record the scheduled Node 22 command in Compose, PostgreSQL aggregation and transactional upserts, consistent snapshot, advisory lock and unique summary keys. The nightly cadence and stated volume fit the existing infrastructure; the lock and keys support overlap prevention and retries.

Proposal for later human review; the schedule and ADR remain proposed.

confidence: high