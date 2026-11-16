```faff-contract:architecture-proposal
{
  "chosen_architecture": "A scheduled Node 22 batch command deployed with the existing Docker Compose setup reads timesheets and writes weekly summary rows in the existing PostgreSQL datastore.",
  "rationale": "Nightly batch job: an operator-configured nightly schedule invokes the command. Reads the existing timesheet table: query PostgreSQL directly using a consistent transactional snapshot. Writes weekly summary rows: aggregate by the agreed week and grouping keys, then transactionally upsert summaries under a unique key so reruns are idempotent. A few thousand reads and a few dozen writes per run: one batch process handles the stated workload. No real-time fan-out or cross-partition ordering: each run computes summaries directly from its snapshot. Use existing infrastructure: use the recorded Node 22 runtime, PostgreSQL datastore, Docker Compose deployment and GitHub Actions for checks. Record run success or failure and return a non-zero exit code on failure.",
  "adr_candidates": [
    {"title": "Run nightly summaries as a Node batch command", "decision": "Schedule one Node 22 command in the existing Compose deployment to read PostgreSQL timesheets and transactionally upsert weekly summaries from a consistent snapshot.", "rationale": "A nightly process fits the stated volume and existing infrastructure; unique summary keys make retries safe."}
  ],
  "assumptions": ["The existing deployment host can provide a nightly scheduler; scheduler availability is not established by the profile.", "The reporting timezone, week boundaries and summary grouping keys will be agreed before implementation.", "The existing database permits the required reads and summary writes.", "An operator will monitor failed runs and rerun them; an overlap lock will prevent concurrent instances of this job."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Run nightly summaries as a Node batch command: schedule one Node 22 command on the existing deployment, read a consistent PostgreSQL snapshot and transactionally upsert uniquely keyed weekly summaries. This fits the nightly workload and supports safe retries. Candidate for later review and materialisation by graft Step 4b.

confidence: medium