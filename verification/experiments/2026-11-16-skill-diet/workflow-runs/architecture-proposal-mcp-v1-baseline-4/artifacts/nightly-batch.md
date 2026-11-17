```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a Node 22 batch command in the existing Docker Compose deployment, triggered nightly by a scheduler on the existing deployment host. Read the existing PostgreSQL timesheet table and transactionally upsert weekly summary rows in the same datastore. Validate the command and migrations through the existing GitHub Actions CI.",
  "rationale": "Nightly batch job: schedule the command once each night with an explicit configured timezone. Reads the existing timesheet table and writes weekly summary rows: aggregate entries by the agreed week and summary dimensions, then upsert into a summary table with a unique key for those dimensions. A few thousand reads and a few dozen writes per run: one SQL aggregation and a bounded transactional upsert handle the stated workload. Use a consistent database snapshot for aggregation and commit summary writes atomically; serialise overlapping runs with a PostgreSQL advisory lock and make reruns idempotent through the unique key. No real-time fan-out or cross-partition ordering: the scheduled command performs one batch per run. Use existing infrastructure: Node 22, Docker Compose, PostgreSQL and GitHub Actions are present in the supplied profile. Record run completion, row counts and failures through the existing operational logs. This proposal awaits human review.",
  "adr_candidates": [
    {
      "title": "Generate weekly summaries with a nightly Node batch command",
      "decision": "Schedule a Node 22 command nightly on the existing deployment host, running in the Compose environment and using PostgreSQL aggregation, transactional summary upserts and an advisory lock.",
      "rationale": "The nightly workload is a few thousand reads and a few dozen writes against an existing table; atomic, idempotent updates support retries and overlapping-run protection on the recorded infrastructure."
    }
  ],
  "assumptions": [
    "The supplied successful profile-show result describes available team infrastructure.",
    "The existing deployment host can trigger a scheduled Compose command; the scheduler mechanism and operator ownership must be confirmed.",
    "The team will confirm week boundaries, timezone, summary dimensions and how late timesheet edits affect recalculation before implementation.",
    "The existing PostgreSQL deployment has sufficient capacity and the batch identity can read timesheets and write summaries.",
    "The existing operational logging can expose job failures to its operator."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Generate weekly summaries with a nightly Node batch command: candidate to record the nightly host trigger, Compose execution, PostgreSQL aggregation, transactional summary upserts and advisory lock. Rationale: the stated batch volume fits the recorded infrastructure, while atomic and idempotent updates make retries safe.

Candidate is intent only, for later review and materialisation by graft Step 4b.

confidence: medium