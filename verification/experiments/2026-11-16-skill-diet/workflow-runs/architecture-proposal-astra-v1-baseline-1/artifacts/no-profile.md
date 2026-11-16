```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a local Python command-line application using SQLite through the standard library. Store equipment and checkout records in an on-disk database under the laptop user's application-data directory. Apply schema migrations, enable foreign keys, commit each checkout or return in a transaction and retain full synchronous durability. Provide a consistent database backup operation.",
  "rationale": "Local command-line tool records equipment checkouts on one laptop: a local CLI reads and writes equipment and checkout tables in one SQLite file. Records must survive restart: committed transactions persist in the on-disk database, with backups supporting recovery. No shared-server or cloud requirement: the process and storage operate entirely on the laptop. Implementation language is open: Python supplies CLI and SQLite facilities in its standard library. The supplied profile-show result exited 3, so this proposal uses the brief alone.",
  "adr_candidates": [{"title":"Persist laptop equipment checkouts in SQLite","decision":"Build a Python CLI with an on-disk SQLite database, transactional checkout updates and a consistent backup operation.","rationale":"Local transactional storage meets the single-laptop workflow and restart durability requirement."}],
  "assumptions": ["No infra profile is available; no team runtime or deployment preference is inferred.","A supported Python installation can be provided on the laptop; availability has not been checked.","The database resides on writable local storage and checkout records fit within the laptop's available capacity.","The team will specify backup location and retention before operational use."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Persist laptop equipment checkouts in SQLite: build a Python CLI with an on-disk SQLite database, transactional checkout updates and a consistent backup operation. Local transactional storage meets the single-laptop workflow and restart durability requirement. Candidate for later promotion by graft Step 4b; no ADR has been written.

Proposal for later review; production suitability requires human judgement.

confidence: medium
