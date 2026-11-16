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

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. Re-entry: `/faff-prep BRF-20`. Re-prep via `/faff-prep BRF-20` once the decision is resolved? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Re-entry: `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Attempt 1/3; branch pushed. No action needed: resumes next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held drain 2/4; spec attached. No action needed: resumes next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes superseding ADR-0031, Use transient tokens. Authored by BRF-12 because a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. This opens the recovery-email and delivery-audit chain, with BRF-14, Audit recovery delivery, still blocked by BRF-13.
2. **BRF-12:** Add the recovery screen. Priority source: issue; continue the build.

### Methodology findings

WIP: 1/3; room for 2 new starts. No structural findings.

### Automation preview

#### Value chains to unlock

```text
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 opens recovery emails and their delivery audit. Of the 2 dependents, 1 is blocked only by the head; BRF-14 remains gated by BRF-13.

#### Build queue

```text
fire-and-forget (independents)
  BRF-11  Issue recovery tokens
```

#### Needs your call before automation can pick up

**architecture**

- **BRF-30:** Select the rate limit store. `needs-decision-first`: Punt asks Redis or database?

**product**

- **BRF-31:** Set the recovery policy. `needs-decision-first`: Punt asks who can reset an account?

**(unowned)**

- **BRF-32:** Choose the replay window. `needs-decision-first`: retained `confidence: medium`; thin area: retry timing.

#### Prep queue

- **BRF-33:** Record token revocation. No spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 now via `/faff-graft BRF-11`? (y/n)

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)