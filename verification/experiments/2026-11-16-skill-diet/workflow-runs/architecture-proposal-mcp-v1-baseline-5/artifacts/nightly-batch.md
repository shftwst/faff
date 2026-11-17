```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a Node 22 batch command in the existing application deployment. Invoke it nightly through a scheduler on the existing Docker Compose host. Read the existing PostgreSQL timesheet table and transactionally upsert weekly summary rows keyed by the agreed summary dimensions and week. Use a PostgreSQL transaction lock to prevent overlapping runs, and record run success or failure in the existing operational logs. Check the command in GitHub Actions.",
  "rationale": "A nightly batch job is met by a scheduled Node 22 command using the existing runtime and Docker Compose infrastructure. Reads the existing timesheet table and writes weekly summary rows: aggregate that table in PostgreSQL and upsert the results in one transaction from a consistent snapshot. A few thousand reads and a few dozen writes per run fit this bounded database operation. No real-time fan-out or cross-partition ordering: one scheduled execution computes and commits each batch. Use existing infrastructure: reuse the profile's Node 22, PostgreSQL, Docker Compose and GitHub Actions. A lock prevents overlapping runs, and unique summary keys make retries update the same rows.",
  "adr_candidates": [
    {
      "title": "Compute weekly summaries with a scheduled Node batch command",
      "decision": "Run a Node 22 command nightly on the existing Docker Compose host, reusing PostgreSQL and GitHub Actions.",
      "rationale": "The nightly workload of a few thousand reads and a few dozen writes fits the existing infrastructure."
    },
    {
      "title": "Make weekly summary runs transactional and repeatable",
      "decision": "Aggregate the timesheet table from a consistent snapshot, transactionally upsert summaries under unique week-and-dimension keys, and prevent overlapping runs with a database lock.",
      "rationale": "Each run writes complete weekly summaries, and retrying a run updates the same summary rows."
    }
  ],
  "assumptions": [
    "The supplied completed profile-show result is the infrastructure evidence; no additional profile acquisition is needed.",
    "The existing Compose host has a scheduler or can run a local timer that invokes the batch command; the exact scheduler must be confirmed before implementation.",
    "The team will define the nightly execution time, time zone, week boundaries, summary dimensions and treatment of late timesheet edits.",
    "The PostgreSQL deployment has durable storage and permits the required reads, summary writes and transaction lock.",
    "Existing operational logs can expose failed or missed runs to the team; the alert destination must be confirmed."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Compute weekly summaries with a scheduled Node batch command: candidate to record nightly execution on the existing Compose host using Node 22, PostgreSQL and GitHub Actions because the bounded workload fits that infrastructure.
- Make weekly summary runs transactional and repeatable: candidate to record consistent reads, transactional upserts, unique week-and-dimension keys and a database lock so each run commits complete summaries and retries update the same rows.

Candidates are for later review and materialisation by graft Step 4b.

confidence: high