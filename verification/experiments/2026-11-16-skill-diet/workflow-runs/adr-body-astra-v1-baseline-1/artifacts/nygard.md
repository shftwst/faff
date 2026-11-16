## Context

One local service must retain recovery-token state across restart. An existing SQLite database provides persistence without adding a second persistence service. This records ADRWORK-1, Persist recovery tokens in SQLite.

## Decision

Use the existing SQLite database for recovery tokens. Write the token row before acknowledging creation so acknowledged tokens have been persisted.

## Consequences

- Recovery-token persistence depends on the existing database.
- The committed implementation writes before acknowledgement, and a restart test passes.
- Multi-host deployment and throughput have not been tested; this record makes no claim about either.

---

Self-review: The consequences match the supplied committed implementation and restart test. Persistence claims are limited to that evidence.

confidence: high