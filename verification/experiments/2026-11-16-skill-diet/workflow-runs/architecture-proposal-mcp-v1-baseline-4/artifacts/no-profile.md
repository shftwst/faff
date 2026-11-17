```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a local Python 3 command-line application using the standard-library SQLite interface. Store equipment and checkout records in a SQLite database file in the laptop user's application data directory, with transactional writes and database constraints.",
  "rationale": "Local command-line tool records equipment checkouts on one laptop: a local CLI opens one SQLite database containing equipment and checkout records. Records must survive restart: commit each checkout or return transaction to the on-disk database, with foreign keys and a uniqueness constraint preventing two active checkouts for one item; keep the database outside temporary directories and provide a consistent database backup procedure. No shared-server or cloud requirement: the command reads and writes the laptop's local database. Implementation language is open: Python 3 provides a standard-library SQLite interface for this small local application. The supplied profile-show result exited 3, so this design derives from the brief alone. This is a proposal for later review.",
  "adr_candidates": [
    {
      "title": "Store laptop equipment checkouts in SQLite through a Python CLI",
      "decision": "Build a Python 3 CLI with an on-disk SQLite database in the user's application data directory, transactional checkout and return writes, relational constraints and a consistent backup procedure.",
      "rationale": "The brief requires a local tool on one laptop whose equipment checkout records survive restart and leaves the language open."
    }
  ],
  "assumptions": [
    "No infra profile is available: the supplied profile-show read exited 3. The proposal uses the brief alone.",
    "Python 3 with its SQLite module can be installed or is already available on the target laptop; no runtime was verified.",
    "The application data directory is writable on local persistent storage.",
    "The laptop user controls access through their operating-system account, and a single-laptop workflow meets the access requirements.",
    "The operator will keep database backups if records must survive loss or failure of the laptop."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Store laptop equipment checkouts in SQLite through a Python CLI: candidate to record Python 3, a database in the user's application data directory, transactional checkout and return writes, constraints and a consistent backup procedure. Rationale: the one-laptop CLI needs durable local records and the language is open.

Candidate is intent only, for later review and materialisation by graft Step 4b.

confidence: medium