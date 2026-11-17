```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a Node 22 batch command in the existing Docker Compose deployment. Invoke it nightly through a host timer. Read the existing PostgreSQL timesheet table and transactionally upsert weekly summaries using a unique summary-grain key. Acquire a PostgreSQL advisory lock for each run, use a consistent source snapshot and log completion or failure. Exercise the command in existing GitHub Actions CI.",
  "rationale": "Nightly batch job: a host timer invokes the batch command once each night. Reads the existing timesheet table and writes weekly summary rows: SQL aggregation and transactional upserts calculate and persist summaries, with reruns replacing the same summary keys. A few thousand reads and a few dozen writes per run: a single bounded database transaction handles the stated volume. No real-time fan-out or cross-partition ordering: each scheduled run computes summaries from one consistent snapshot. Use existing infrastructure: the supplied successful profile-show result records Node 22, Docker Compose, PostgreSQL and GitHub Actions.",
  "adr_candidates": [{"title":"Compute weekly summaries with a scheduled transactional batch","decision":"Run a Node 22 command nightly on the existing Compose host, using PostgreSQL snapshot reads, a run lock and idempotent summary upserts.","rationale":"The stated nightly workload fits the existing runtime and database, while transactional replacement makes retries safe."}],
  "assumptions": ["The existing deployment host supports a nightly timer; the profile does not record a scheduler.","The team will define the week boundary, time zone, summary grouping key and treatment of late timesheet edits before implementation.","The batch role has permission to read timesheets and write summary rows.","A failed run can be retried and operations will monitor its exit status and completion log."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Compute weekly summaries with a scheduled transactional batch: run a Node 22 command nightly on the existing Compose host, using PostgreSQL snapshot reads, a run lock and idempotent summary upserts. The stated nightly workload fits the existing runtime and database, while transactional replacement makes retries safe. Candidate for later promotion by graft Step 4b; no ADR has been written.

Proposal for later review; production suitability requires human judgement.

confidence: medium
