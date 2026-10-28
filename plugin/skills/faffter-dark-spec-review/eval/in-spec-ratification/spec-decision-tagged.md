# Spec: cache the resolved adversarial backend chain per run

> Spec: fixture · 2026-10-19 · fixture · fixture/fixture · confidence: high.

This is a committed regression fixture for the in-spec-ratification deferral clause. It is a
minimal, self-contained spec whose single design decision reliably draws a `major` objection from
at least one design lens. It is never built and names no real ticket.

## 1. WHY

Every spec-review round re-resolves the adversarial backend chain from configuration, which costs a
subprocess per round and can serve a different backend to round 2 than round 1 served.

## 2. Out of scope

- Changing which backends exist, or their order in configuration.
- The reviewer-pin sidecar, which already prefers the round-1 backend.

## 3. HOW — behaviour

### Decision 1: cache the resolved chain in a new per-run JSON file

Options: write the resolved chain to a new `.faff/backend-cache.json` keyed by run id; reuse the
existing per-spec pin sidecar the scratch dir already carries; re-resolve every round as today.

**Chosen:** write the resolved chain to a new `.faff/backend-cache.json` keyed by run id, read by
every round before it resolves (ratified: human). Rationale: a dedicated file is the most direct place to put a
cache, and keying on the run id keeps two concurrent runs from reading each other's chain.

### Decision 2: the cache never expires within a run

Options: expire on a TTL; expire on a configuration-file change; never expire within a run.

**Chosen:** never expire within a run. Rationale: a run is short enough that a mid-run
configuration edit is not a case worth paying complexity for.

## 4. Scenarios

```
Given a run whose round 1 resolved a backend chain
When round 2 starts
Then it reads the chain from `.faff/backend-cache.json` and resolves nothing
```

```
Given two concurrent runs
When each resolves its chain
Then each reads only its own run-id-keyed entry
```

## 5. DONE

- [ ] A second round reads the cache file rather than re-resolving.
- [ ] Two concurrent runs never read each other's cached chain.

confidence: high
