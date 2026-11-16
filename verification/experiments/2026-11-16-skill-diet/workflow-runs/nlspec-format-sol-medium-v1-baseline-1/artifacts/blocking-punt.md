# Persist recovery tokens

This spec addresses SPEC-3: retain accepted recovery tokens across restart through the existing `TokenStore` interface. It is for the build agent and human reviewers. Implementation depends on an architecture decision recorded under Open Questions.

## WHY

Accepted tokens must survive a process restart. `src/token-store.ts` defines an interface but has no persistence backend, so that interface alone cannot provide durable storage. This change supplies persistence while preserving callers.

**Interface compatibility:** Keep `TokenStore` unchanged.

**Reference context:** `src/token-store.ts` is TypeScript and defines asynchronous `put(token)` and `get(id)`. Token structure and identifier semantics remain those of the existing interface; the supplied source does not define new token fields.

## OUT OF SCOPE

- **Token expiry:** Retention behaviour is a separate feature. A future change would extend `src/token-store.ts`.

## WHAT

```
INTERFACE TokenStore, unchanged:
  put(token): Promise<void>
  get(id): Promise<Token OR null>
```

An accepted token is a token whose `put` operation has completed successfully. Accepted tokens MUST remain available after restart. `get(id)` returns the stored token for a present identifier and null for an absent identifier.

The persistence backend is unresolved. Do not choose or assume SQLite or PostgreSQL.

## HOW

After the architecture owner chooses a backend, implement durable storage behind the existing interface. Backend-specific schema, connection lifecycle and restart mechanics cannot be fixed until that decision is made.

```
PROCEDURE persist_and_read, after backend decision:
  1. On put(token), persist the token in the selected durable backend.
  2. Complete put successfully only when the token is accepted durably.
  3. On get(id), look up the identifier in durable storage.
  4. IF the identifier is absent, return null.
  5. OTHERWISE return the stored token.
  6. After process restart, use the same durable storage to serve get(id).
```

**Anti-pattern:** Substitute an in-memory store. Why: Accepted tokens would disappear on restart.

## Scenarios

```
Given put has successfully accepted a token with identifier I
When the process restarts and get(I) is called against the same durable storage
Then get(I) returns the stored token
```

Absent-token lookup is a simple interface condition checked in DONE.

## DESIGN DECISION RATIONALE

**Should the caller interface change?**

- **Keep `TokenStore`:** Existing callers can continue using the interface.
- **Replace the interface:** Requires caller changes outside the requirement.

**Chosen:** Keep the existing `TokenStore` interface because callers already use it.

**Which backend should store tokens?**

SQLite and PostgreSQL are the supplied alternatives. The snapshot supplies no basis for selecting either; backend-specific pros and cons require the architecture owner's decision. The unresolved choice is recorded below.

## OPEN QUESTIONS AND ASSUMPTIONS

### Open Questions

**Punt:** SQLite or PostgreSQL for durable token storage; the architecture owner must decide before implementation because the increment depends on this choice (decides: architecture).

The completed Punt scan reports one blocking open Punt, zero eligible non-blocking Punts. No backend is assumed.

### Assumptions

No external assumptions are declared.

## DONE

### From WHY and WHAT

- [ ] A token accepted by a successful `put` is returned by `get(id)` after process restart against the same durable storage.
- [ ] `get(id)` returns the stored token for a present identifier.
- [ ] `get(id)` returns null for an absent identifier.
- [ ] The `TokenStore` interface retains the supplied `put` and `get` signatures.

### From HOW

- [ ] Successful `put` completion corresponds to durable acceptance in the backend selected by architecture.

### Integration smoke test

Run after the backend decision is resolved.

```
PROCEDURE smoke_check_token_persistence:
  1. Start the token store using the selected durable backend.
  2. Put a token with identifier I and await successful completion.
  3. Restart the process against the same durable storage.
  4. Assert get(I) returns the stored token.
  5. Assert get of an absent identifier returns null.
```

## Review record

The supplied inherited review is complete: 0 blocker, 0 major, 0 minor findings. All supplied facts were checked; no changes beyond the snapshot are authorised. No fixes or dismissals are required. The architecture Punt remains unresolved as supplied.

confidence: medium

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"punt"}]}
```