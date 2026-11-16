```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a local Python 3 command-line tool using SQLite through the standard library. Store equipment and checkout records in a database file in the laptop user's application-data directory. Commit each checkout or return in a database transaction.",
  "rationale": "A local command-line tool records equipment checkouts on one laptop: a Python command exposes checkout, return and record-list operations over a local SQLite database. Records must survive restart: commit transactions to a durable database file outside temporary directories, retaining SQLite durability settings and providing a documented backup and restore procedure. No shared-server or cloud requirement: all operations and storage stay on the laptop. The implementation language is open: Python 3 supplies both command-line parsing and SQLite access in its standard library. The supplied profile read exited 3, so this proposal uses the brief alone.",
  "adr_candidates": [
    {
      "title": "Store local equipment checkouts in SQLite",
      "decision": "Build a Python 3 CLI with transactional SQLite storage in the user's application-data directory and a documented backup and restore procedure.",
      "rationale": "The tool runs on one laptop and needs records to survive restart; local transactional file storage meets those stated needs."
    }
  ],
  "assumptions": [
    "No infra profile is available: the supplied profile-show result exited 3. This proposal is based on the brief alone.",
    "Python 3 with SQLite support is available or can be installed on the laptop; this has not been verified.",
    "The application-data directory is on persistent local storage writable by the operator.",
    "One laptop and one local operator context remain sufficient; backup location and retention will be confirmed before implementation."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Store local equipment checkouts in SQLite: candidate to record a Python 3 CLI, transactional SQLite storage in the user's application-data directory and a documented backup and restore procedure. One-laptop operation and restart durability justify the decision.

Proposal for later human review, with runtime availability unverified.

confidence: medium