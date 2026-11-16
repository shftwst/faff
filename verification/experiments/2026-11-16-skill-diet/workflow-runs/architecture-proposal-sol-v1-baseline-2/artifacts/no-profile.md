```faff-contract:architecture-proposal
{
  "chosen_architecture": "A local Python command-line application stores equipment checkout records in a SQLite database file on the laptop.",
  "rationale": "Local command-line tool: one Python executable entry point handles checkout and return commands on the laptop. Records must survive restart: commit each operation to an on-disk SQLite database with equipment and checkout constraints, and provide a database backup procedure. One laptop: the application and database run locally. No shared-server or cloud requirement: deployment is a local installation with no hosted dependency. Implementation language is open: Python provides command-line and SQLite support in its standard library. The supplied profile-show result exits 3, so this proposal uses the brief alone.",
  "adr_candidates": [
    {"title": "Keep equipment checkouts in a local SQLite database", "decision": "Build a Python CLI using an on-disk SQLite database and commit each checkout or return in a transaction.", "rationale": "Local transactional storage preserves records across application restarts and fits operation on one laptop."}
  ],
  "assumptions": ["No infra profile is available: the supplied profile-show result exits 3; runtime and deployment choices are proposed from the brief alone.", "Python is installable on the laptop; its availability has not been verified.", "The database file will live in a persistent user data directory with suitable filesystem permissions.", "The operator will back up the database; retention requirements remain to be confirmed."],
  "recommendation": "build"
}
```

## ADR promotion intent

- Keep equipment checkouts in a local SQLite database: build a Python CLI that commits checkout and return transactions to a persistent laptop database. Local storage meets the restart durability requirement. Candidate for later review and materialisation by graft Step 4b.

confidence: medium