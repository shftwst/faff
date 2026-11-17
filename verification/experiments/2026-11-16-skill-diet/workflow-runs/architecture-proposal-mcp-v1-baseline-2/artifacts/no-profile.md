```faff-contract:architecture-proposal
{
  "chosen_architecture": "A local Python 3 command-line application stores equipment checkouts in a SQLite database file in the laptop user's application-data directory. Use transactions, database constraints and durable commits for checkout updates; keep the database outside temporary directories and provide a documented backup and restore procedure. Package and run the command locally on the laptop.",
  "rationale": "Local command-line tool: a Python command implements equipment checkout operations on the laptop. Records must survive restart: a persistent SQLite database file retains committed records across application restarts. One laptop: all records and operations reside on that machine. No shared-server or cloud requirement: installation, execution and storage are local. Implementation language is open: Python 3 provides a command-line runtime and a standard-library SQLite interface. The supplied profile-show result exits 3, so this proposal uses the brief alone.",
  "adr_candidates": [
    {
      "title": "Store equipment checkouts locally in SQLite",
      "decision": "Build a Python 3 command-line tool using a persistent SQLite database in the user's application-data directory, with transactional updates and database constraints.",
      "rationale": "Local transactional storage meets restart durability for a command-line tool used on one laptop."
    }
  ],
  "assumptions": [
    "No infra profile is available: the supplied profile-show result exited 3. Runtime and packaging choices are proposals based on the brief alone.",
    "Python 3 with SQLite support can be installed or is available on the target laptop; this remains to be verified.",
    "The database resides on a local filesystem that supports SQLite locking and durable writes.",
    "One laptop remains the scope; equipment identifiers and the rule for an equipment item already checked out will be defined in the implementation spec.",
    "The operator will maintain backups if recovery from laptop or disk loss is required."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Candidate: Store equipment checkouts locally in SQLite. Proposed decision: build a Python 3 command-line tool using a persistent SQLite database in the user's application-data directory, with transactional updates and database constraints. Rationale: local transactional storage meets restart durability for a command-line tool used on one laptop. Retain as intent for later review and possible materialisation by graft Step 4b.

confidence: medium