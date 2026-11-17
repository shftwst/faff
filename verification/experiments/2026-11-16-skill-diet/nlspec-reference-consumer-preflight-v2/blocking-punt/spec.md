# SPEC-3: Persist recovery tokens

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.45.0 · confidence: medium. Full spec on Linear SPEC-3.

This spec addresses SPEC-3 for the build agent and human reviewers.

## 1. WHY
Durable storage keeps accepted tokens available after restart. The interface exists but has no persistence backend. Implementation waits for an architecture decision.

Reference context:

| System | Language | Relevance |
|---|---|---|
| src/token-store.ts | TypeScript | Existing interface or implementation used by this change |

## 2. OUT OF SCOPE
- Token expiry: excluded as a separate feature; extend src/token-store.ts.

## 3. WHAT
INTERFACE TokenStore:
  put(token): Promise<void>
  get(id): Promise<Token | null>
The existing interface is unchanged.

## 4. HOW
PROCEDURE put(token): persist token using the backend selected by architecture.
PROCEDURE get(id): return stored token or null. Do not implement a backend before the decision.

## Scenarios
```
Given a token was accepted and the service restarted
When get reads its id
Then it returns the stored token
```

## 6. DESIGN DECISION RATIONALE
**Change the caller interface?** Keeping it avoids caller changes; replacing it expands scope. **Chosen:** keep the existing TokenStore interface.

## 7. OPEN QUESTIONS AND ASSUMPTIONS
**Punt:** SQLite or PostgreSQL for durable token storage; the increment depends on this unresolved choice (decides: architecture).

## 8. DONE
### From WHY / WHAT / HOW
- [ ] Accepted tokens MUST survive restart.
- [ ] get MUST return the stored token or null when absent.
- [ ] TokenStore interface MUST remain unchanged.

Integration smoke test: persist a token, restart the service and read that token.

## Review record
Supplied completed review: no blocker, major or minor findings. No resolution changes or dismissed findings.

confidence: medium
build-tier: standard
admissibility: admissible

```faff-contract:spec-readiness
{"confidence": "medium", "decisions": [{"marker": "chosen"}, {"marker": "punt"}]}
```
