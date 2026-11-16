Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- BRF-10: Recovery attempts are now recorded. Just unlocked BRF-11: Issue tokens for account recovery.

### In progress

- BRF-12: Add the account recovery screen. Status: Building.

### Blocked

- BRF-13: Send recovery emails. Waiting for BRF-11.

### Parked work

- **BRF-20:** Choose how long records are retained. Parked during interactive prep because the product retention decision remains open. Once resolved, re-enter via `/faff-prep BRF-20`. Re-run `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Re-enter via `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

### Awaiting review (adversarial outage)

- BRF-22: Prevent duplicate recovery emails. Attempt 1/3; branch pushed. No action needed: review resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- BRF-23: Define the expiry policy. Held drain 2/4; spec attached. No action needed: review resumes on the next prep drain without re-specifying, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12 to provide a durable retry record. The proposal remains propose-only pending human ratification.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. It starts the chain towards recovery emails and delivery auditing.
2. **BRF-12:** Complete the recovery screen already being built. Priority source: issue.

### Methodology findings

WIP: 1/3; remaining headroom: 2. No structural findings.

### Heads up

Recovery beta is 50% complete with 7 days until its 2026-11-23 target.

### Automation preview

**Value chains to unlock**

BRF-14: Audit recovery email delivery; currently blocked by BRF-13.

```text
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 starts the recovery email and delivery audit chain. One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue**

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up**

needs-decision-first

- **architecture:** BRF-30: Select the rate limit store. Punt: Redis or database?
- **product:** BRF-31: Set the account recovery policy. Punt: Who can reset an account?
- **(unowned):** BRF-32: Choose the replay window. Retained confidence: medium; the spec is thin on retry timing.

**Prep queue**

- BRF-33: Record token revocation. No spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- BRF-11: Issue recovery tokens. Spec ready; just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)