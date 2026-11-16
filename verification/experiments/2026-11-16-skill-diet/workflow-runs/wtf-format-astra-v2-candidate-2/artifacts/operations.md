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

- **BRF-20:** Choose the retention period. Interactive prep parked because the product retention decision remains open. Resolve that decision, then re-enter with `/faff-prep BRF-20`. No run log supplied. Re-prep BRF-20 via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Autonomous graft parked because schema compatibility is unclear. Resolve compatibility, then resume with `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave) Resume the build via `/faff-graft BRF-21` once compatibility is resolved? (y/n)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Attempt 1/3; branch pushed. No action needed: review auto-resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held drain 2/4; spec attached. No action needed: review auto-resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes superseding ADR-0031, Use transient tokens. BRF-12 authored the proposal because a durable retry record is needed. Disposition: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11: Issue recovery tokens.** Priority source: issue; just unlocked by BRF-10. This starts the two-issue downstream chain for recovery emails and delivery auditing.
2. **BRF-12: Add the recovery screen.** Priority source: issue; continue the build already in progress.

### Methodology findings

WIP: 1/3; remaining headroom: 2. No structural findings.

### Heads up

Recovery beta is due 2026-11-23, in 7 days, with 50% complete.

### Automation preview

#### Value chains to unlock

BRF-14 audits recovery delivery and remains blocked by BRF-13.

```text
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 opens a two-issue chain: recovery email sending, then delivery auditing. One dependent, BRF-13, is blocked only by the head; BRF-14 remains gated by BRF-13.

#### Build queue

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

#### Needs your call before automation can pick up

**needs-decision-first: architecture**

- **BRF-30:** Select the rate limit store. Punt: Redis or database?

**needs-decision-first: product**

- **BRF-31:** Set the recovery policy. Punt: Who can reset an account?

**needs-decision-first: (unowned)**

- **BRF-32:** Choose the replay window. Retained `confidence: medium`; the spec is thin on retry timing. Human review is needed.

#### Prep queue

- **BRF-33:** Record token revocation. No spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
