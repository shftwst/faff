Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Records each account-recovery attempt.
  - Just unlocked **BRF-11:** issues the tokens a user needs to recover an account.

### In progress

- **BRF-12:** Adds the account-recovery screen. Status: Building.

### Blocked

- **BRF-13:** Sends account-recovery emails. Blocker: waiting for BRF-11.

### Parked work

- **BRF-20:** Chooses how long recovery data is kept.
  - Parked by: interactive prep
  - Cause: the product decision on the retention period is still open.
  - Unpark: `/faff-prep BRF-20`
- **BRF-21:** Repairs the importer.
  - Parked by: autonomous graft
  - Cause: schema compatibility is unclear.
  - Unpark: `/faff-graft BRF-21`
  - Log: `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)

- **BRF-22:** Stops duplicate recovery emails. Attempt 1/3; branch pushed. Resumes automatically on the next build drain, without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Sets the scope of the token expiry policy. Held drain 2/4; spec attached. Resumes automatically on the next prep drain, without re-spec. No action needed.

### ADR supersession proposals awaiting ratification

- **ADR-0042 (Use token ledger)** proposes to supersede **ADR-0031 (Use transient tokens)**.
  - Authored by: BRF-12
  - Why: a durable retry record is needed.

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue. Just unlocked by BRF-10.
2. **BRF-12:** Finish the recovery screen already in progress. Priority source: issue.

### Methodology findings

- **WIP:** 1 of 3, so up to 2 new starts fit.

### Automation preview

Value chains to unlock:

```
BRF-11  Issue recovery tokens  →  unlocks BRF-13 → BRF-14   (2 issues; 1 blocked only by BRF-11, BRF-14 still gated by BRF-13)
```

BRF-14 audits that recovery emails were delivered. Shipping BRF-11 lets recovery emails go out, and delivery auditing can follow.

Build queue:

```
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens         (none)
```

Needs your call:

- **architecture**
  - **BRF-30:** Selects the store for rate limiting. Punt: Redis or database?
- **product**
  - **BRF-31:** Sets who may reset an account. Punt: Who can reset an account?
- **(unowned)**
  - **BRF-32:** Chooses the replay window. Retained `confidence: medium`; the spec was thin on retry timing.

Prep queue:

- **BRF-33:** Records token revocation. No spec yet.

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10.

---

- Ratify supersession of ADR-0031 by ADR-0042? (y/n)
- BRF-20: re-prep via `/faff-prep BRF-20`? (y/n)
- BRF-21: open log / re-run `/faff-graft BRF-21` / leave parked (log/regraft/leave)
- Picking up BRF-11. Start building now via `/faff-graft`? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
