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
  - Just unlocked BRF-11, which issues the tokens used to recover an account. Once BRF-11 ships, recovery emails (BRF-13) can go out, followed by the delivery audit (BRF-14).

### In progress

- **BRF-12:** Adds the account-recovery screen. Status: Building.

### Blocked

- **BRF-13:** Sends account-recovery emails. Blocked: waiting for BRF-11.

### Parked work

Issue: BRF-20, choose how long recovery data is retained
Source: interactive prep
Cause: product retention decision remains open
Unpark: `/faff-prep BRF-20`
────────────────────────────────────────
Issue: BRF-21, repair the importer
Source: autonomous graft
Cause: schema compatibility is unclear
Unpark: `/faff-graft BRF-21`
Log: `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)

- **BRF-22:** Stops duplicate recovery emails being sent. Branch pushed; review attempt 1/3. Resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Sets the scope of the token expiry policy. Spec attached; held drain 2/4. Resumes on the next prep drain without re-spec. No action needed.

### ADR supersession proposals awaiting ratification

- **ADR-0042** (Use token ledger) proposes to supersede **ADR-0031** (Use transient tokens).
  - Authored by: BRF-12
  - Why: Need a durable retry record

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

WIP is 1 of 3, so up to 2 new starts fit.

1. **BRF-11:** Issue recovery tokens. Priority from the issue; just unlocked by BRF-10. Shipping it clears the last blocker on BRF-13 (recovery emails), which then opens BRF-14 (delivery audit).
2. **BRF-12:** Finish the recovery screen already in build. Priority from the issue.

### Methodology findings

- **WIP:** 1 of 3, headroom 2.
- **Structural findings:** none.

### Automation preview

**Value chains to unlock**

```
BRF-11  issue recovery tokens  →  unlocks BRF-13 → BRF-14   (2 issues; 1 blocked only by BRF-11, BRF-14 still gated by BRF-13)
```

**Build queue**

```
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens         (none)
```

**Needs your call**

- **architecture**
  - **BRF-30:** Pick where rate-limit counts are stored. Punt: Redis or database?
- **product**
  - **BRF-31:** Set who may recover an account. Punt: Who can reset an account?
- **(unowned)**
  - **BRF-32:** Choose the replay window for recovery retries. No open punt; spec retained at confidence: medium and is thin on retry timing. Give it a once-over.

**Prep queue**

- **BRF-33:** Record when a recovery token is revoked. No spec.

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10.

### Next steps

- Picking up BRF-11. Start building now via `/faff-graft`? (y/n)
- Promote BRF-11 to Todo? (y/n)
- BRF-20: re-run `/faff-prep BRF-20` once the retention decision is made, or leave parked? (reprep/leave)
- BRF-21: open log / re-run `/faff-graft BRF-21` / leave parked? (log/rerun/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)