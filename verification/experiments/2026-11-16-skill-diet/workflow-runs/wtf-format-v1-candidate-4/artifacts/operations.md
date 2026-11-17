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
  - Just unlocked BRF-11: issues the tokens a user needs to recover an account.

### In progress

- **BRF-12:** Adds the account-recovery screen. Status: Building.

### Blocked

- **BRF-13:** Sends account-recovery emails. Waiting for BRF-11.

### Parked work

- **BRF-20:** Choose the data retention period.
  - Cause: the product decision on retention is still open.
  - Parked by: interactive prep.
  - Unpark: `/faff-prep BRF-20`
- **BRF-21:** Repair the importer.
  - Cause: schema compatibility is unclear.
  - Parked by: autonomous graft.
  - Unpark: `/faff-graft BRF-21`
  - Log: `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review attempt 1/3; the branch is pushed. It resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the token expiry policy. Held drain 2/4; the spec is attached. It resumes on the next prep drain without re-spec. No action needed.

### ADR supersession proposals awaiting ratification

- **ADR-0042 (Use token ledger)** proposes to supersede **ADR-0031 (Use transient tokens)**.
  - Authored by: BRF-12 (the recovery screen work).
  - Why: the system needs a durable record of retries.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority set on the issue. Just unlocked by BRF-10. Shipping it lets BRF-13 send recovery emails, which in turn opens BRF-14.
2. **BRF-12:** Finish the recovery screen already in progress. Priority set on the issue.

### Methodology findings

- **WIP:** 1 of 3, so there is room for 2 new starts.
- **Structural findings:** none.

### Automation preview

**Value chains to unlock**

```
BRF-11  issue recovery tokens  →  unlocks BRF-13 → BRF-14   (2 issues; BRF-13 blocked only by BRF-11, BRF-14 still gated by BRF-13)
```

BRF-14 audits delivery of recovery emails.

**Build queue**

```
fire-and-forget (independents)
  BRF-11  Issue recovery tokens
```

**Needs your call**

- **architecture**
  - **BRF-30:** Select the store that backs rate limiting. Punt: Redis or database?
- **product**
  - **BRF-31:** Set the account-recovery policy. Punt: who can reset an account?
- **(unowned)**
  - **BRF-32:** Choose the replay window. Spec retained at confidence: medium; it was thin on retry timing. Give it a once-over.

**Prep queue**

- **BRF-33:** Record token revocation. No spec yet.

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10.

### Next steps

- Picking up BRF-11. Start building now via `/faff-graft`? (y/n)
- Promote BRF-11 to Todo? (y/n)
- BRF-20: re-prep via `/faff-prep BRF-20`? (y/n)
- BRF-21: open log / re-run `/faff-graft BRF-21` / leave parked? (log/regraft/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
