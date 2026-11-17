```faff-contract:architecture-proposal
{
  "chosen_architecture": "A scheduled Node batch job in the existing Compose deployment, querying Postgres and writing summary rows.",
  "rationale": "The nightly schedule and small load fit one SQL aggregation against the existing database.",
  "adr_candidates": [
    {
      "title": "Schedule weekly summary aggregation",
      "decision": "Run a nightly Node job against existing Postgres.",
      "rationale": "The brief needs batch summaries with a small row count."
    }
  ],
  "assumptions": [
    "The deployment can run a scheduled process."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Schedule weekly summary aggregation: Run a nightly Node job against existing Postgres. The brief needs batch summaries with a small row count.

confidence: medium
