# Spec: move the resolved backend chain into the per-spec pin sidecar

> Spec: fixture · 2026-10-19 · fixture · fixture/fixture · confidence: high.

This is a committed regression fixture for the ratify-offer scope test: a spec whose design choice
is sound but whose execution has a named gap, so a design lens objects at the *implementation*
level rather than against the choice. It is never built and names no real ticket.

## 1. WHY

Every spec-review round re-resolves the adversarial backend chain from configuration.

## 2. Out of scope

- Changing which backends exist, or their order in configuration.

## 3. HOW — behaviour

### Decision 1: cache the resolved chain in the existing pin sidecar

Options: a new cache file; the existing per-spec pin sidecar; re-resolve every round.

**Chosen:** cache the resolved chain inside the existing per-spec pin sidecar, which already
carries the round-1 reviewer identity for the same loop. Rationale: the sidecar is already the
per-spec home for "what served this loop", so the chain belongs beside it rather than in a second
file with its own lifecycle.

Write it with a plain truncate-then-write so the sidecar always holds the latest chain.

## 4. Scenarios

```
Given a round that has resolved a chain
When the next round starts
Then it reads the chain from the pin sidecar
```

## 5. DONE

- [ ] A second round reads the chain from the pin sidecar.

confidence: high
