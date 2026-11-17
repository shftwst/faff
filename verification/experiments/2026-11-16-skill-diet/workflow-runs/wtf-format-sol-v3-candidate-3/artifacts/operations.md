Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Recorded recovery attempts, just unlocking BRF-11, which issues recovery tokens.

### In progress

- **BRF-12:** Adds the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Sends recovery emails; waiting for BRF-11.

### Parked work

- **BRF-20:** Chooses the retention period. Interactive prep parked it because the product retention decision remains open. Re-entry: `/faff-prep BRF-20` after that decision is resolved. No run log supplied.
- **BRF-21:** Repairs the importer. Autonomous graft parked it because schema compatibility is unclear. Re-entry: `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`.

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicates recovery emails. Attempt 1/3; branch pushed. No action needed: review resumes at the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Defines the expiry policy. Held drain 2/4; spec attached. No action needed: review resumes at the next prep drain without re-specifying, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, "Use token ledger", proposes to supersede ADR-0031, "Use transient tokens". BRF-12 authored the proposal because a durable retry record is needed. Disposition: propose-only; awaiting human ratification.

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. Shipping tokens enables recovery emails and then delivery auditing.
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

BRF-14 audits recovery delivery and remains blocked by BRF-13.

### Methodology findings

WIP: 1/3; remaining headroom: 2 new starts. No structural findings.

### Heads up

Recovery beta is due on 2026-11-23, seven days away, at 50% complete.

### Automation preview

#### Value chains to unlock

```text
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 supplies recovery tokens for email delivery and subsequent delivery auditing. Of the two dependents, one is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens        (none)
```

#### Needs your call before automation can pick up

**needs-decision-first**

**architecture**

- **BRF-30:** Select the rate limit store. Punt: Redis or database?

**product**

- **BRF-31:** Set the recovery policy. Punt: Who can reset an account?

**(unowned)**

- **BRF-32:** Choose the replay window. Retained `confidence: medium`; the spec is thin on retry timing and needs human review.

#### Prep queue

- **BRF-33:** Record token revocation; no spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens; spec ready, just unlocked by BRF-10.

Promote BRF-11 to Todo? (y/n)

Resolve the retention decision and re-prep BRF-20 via `/faff-prep BRF-20`? (y/n)

BRF-21: open log / re-run `/faff-prep BRF-21` / leave parked (log/reprep/leave).

Resume the importer build via `/faff-graft BRF-21` once schema compatibility is resolved? (y/n)

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

Start building BRF-11 now via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)