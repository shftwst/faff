```faff-contract:architecture-proposal
{
  "chosen_architecture": "A local Python 3 command-line application using the standard-library SQLite driver and a SQLite database file in the user's local application data directory. Represent equipment and checkouts as relational records with foreign keys and constraints, and commit each checkout or return atomically. Use SQLite durable commits on local storage, a busy timeout for overlapping invocations, schema migrations and a documented database backup and restore command. Package the CLI for the laptop after confirming its operating system and available runtime.",
  "rationale": "A local command-line tool is met by a Python CLI running on the laptop. Records equipment checkouts is met by equipment and checkout tables with constraints preventing invalid active checkouts. Records must survive restart is met by a persistent SQLite database file and committed transactions. One laptop is met by local file storage and bounded locking between CLI invocations. No shared-server or cloud requirement is stated; the application runs locally. The implementation language is open, so Python 3 with its standard-library SQLite driver is a proposed implementation choice. Profile show exited 3: this proposal uses the brief alone and assumes no infra profile.",
  "adr_candidates": [
    {
      "title": "Store equipment checkouts in a local SQLite database",
      "decision": "Build a Python 3 CLI with the standard-library SQLite driver, storing equipment and checkout records in a persistent local database with constraints, atomic transactions, migrations and backup/restore support.",
      "rationale": "A single-laptop CLI needs records to survive restart; local transactional storage meets the stated scope."
    }
  ],
  "assumptions": [
    "No infra profile is available: the supplied profile-show result exited 3. Runtime and deployment choices are proposals based on the brief alone.",
    "The laptop can run a supported Python 3 release; its operating system and installation method must be confirmed before implementation.",
    "The database will live on a writable local filesystem with working SQLite locking and durability semantics.",
    "Checkouts are managed on one laptop; multi-device synchronisation is outside the stated scope.",
    "The user will select a backup destination and retention period; restore behaviour must be verified before release."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Store equipment checkouts in a local SQLite database: build a Python 3 CLI using the standard-library SQLite driver and a persistent local database with constraints, atomic transactions, migrations and backup/restore support. A single-laptop CLI needs records to survive restart; local transactional storage meets the stated scope.

This is a candidate for later review and materialisation by graft Step 4b. Production suitability remains subject to human review.

confidence: medium