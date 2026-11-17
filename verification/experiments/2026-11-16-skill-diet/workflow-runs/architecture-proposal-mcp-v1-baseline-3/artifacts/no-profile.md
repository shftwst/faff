```faff-contract:architecture-proposal
{
  "chosen_architecture": "Build a local Python 3 command-line tool using the standard-library SQLite interface. Store equipment and checkout records in a SQLite database file in the laptop user's application-data directory. Use transactions and relational constraints for checkout changes, and retain the database independently of the CLI process. Provide a local backup and restore procedure for the database file.",
  "rationale": "Local command-line tool: Python provides a local CLI and a standard-library SQLite interface. Records equipment checkouts on one laptop: equipment and checkout tables live in one local database file. Records must survive restart: committed transactions persist in the database file outside process memory. No shared-server or cloud requirement: command execution and persistence remain on the laptop. Implementation language is open: Python 3 is a proposed language choice, subject to checking its availability. Profile show exited 3, so this proposal uses the brief alone.",
  "adr_candidates": [
    {
      "title": "Keep equipment checkout records in a local SQLite database",
      "decision": "Build a Python 3 CLI using standard-library SQLite, with transactional writes to a persistent database file on the laptop and a local backup and restore procedure.",
      "rationale": "The brief requires one-laptop command-line use and records that survive restart, with the implementation language open."
    }
  ],
  "assumptions": [
    "No infra profile is available: the supplied profile-show result exited 3. No team runtime, CI or deployment capability is inferred.",
    "Python 3 with SQLite support is available on the laptop or can be installed through a separately authorised implementation step.",
    "The laptop has a writable local application-data directory on persistent storage.",
    "The tool serves one laptop user; shared access is outside the supplied requirements.",
    "Equipment identifiers, checkout fields and return rules will be confirmed before implementation."
  ],
  "recommendation": "build"
}
```

## ADR promotion intent

- Keep equipment checkout records in a local SQLite database: candidate to build a Python 3 CLI with transactional SQLite persistence and a local backup and restore procedure, because the brief requires durable checkout records on one laptop and leaves the language open.

Proposal for later review, based on the brief alone. Runtime availability requires verification; production suitability remains a human judgement.

confidence: medium