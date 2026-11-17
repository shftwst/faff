Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts. Just unlocked BRF-11, which issues recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Parked work

- **BRF-20:** Choose the retention period. Interactive prep parked because the product retention decision remains open. After resolving it, re-enter through `/faff-prep BRF-20`. No run log supplied.
- **BRF-21:** Repair the importer. Autonomous graft parked because schema compatibility is unclear. Re-enter through `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`.

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Attempt 1/3; branch pushed. No action needed: review resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held drain 2/4; spec attached. No action needed: review resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes superseding ADR-0031, Use transient tokens. Authoring issue: BRF-12. Reason: need a durable retry record. The proposal remains propose-only pending human ratification.

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. This starts the two-issue downstream chain through recovery email delivery to BRF-14, which audits recovery delivery.
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP: 1/3; remaining headroom: 2. No structural findings.

### Heads up

Recovery beta is due 2026-11-23, in 7 days, with 50% complete.

### Automation preview

#### Value chains to unlock

```
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 issues recovery tokens, enabling recovery emails and then delivery auditing. Of the two dependents, one is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

#### Build queue

```
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens        (none)
```

#### Needs your call before automation can pick up

Architecture

- **BRF-30:** Select the rate limit store. `needs-decision-first`; Punt: Redis or database?

Product

- **BRF-31:** Set the recovery policy. `needs-decision-first`; Punt: who can reset an account?

(unowned)

- **BRF-32:** Choose the replay window. `needs-decision-first`; retained `confidence: medium`, with retry timing thin in the spec.

#### Prep queue

- **BRF-33:** Record token revocation. No spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10. Promote BRF-11 to Todo? (y/n)

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

Resume prep for the retention decision via `/faff-prep BRF-20`? (y/n)

For BRF-21: open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

Resume the importer build via `/faff-graft BRF-21`? (y/n)

Start building recovery tokens via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
