Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Source of truth: connected issue tracker. Snapshot: 2026-11-16.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts. Unlocked BRF-11: issue recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Coming up

- **BRF-11:** Issue recovery tokens; just unlocked by BRF-10. Priority source: issue. The chain leads through recovery emails to BRF-14: audit recovery delivery.
- **BRF-14:** Audit recovery delivery; blocked by BRF-13.

### Parked work

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. Re-enter through `/faff-prep BRF-20` once resolved. Re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Log: `.faff/runs/run-a/BRF-21/graft.md`. Re-enter through `/faff-graft BRF-21` once resolved. Open log / resume via `/faff-graft BRF-21` / leave parked? (log/graft/leave)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review provider unavailable, attempt 1/3; branch pushed. No action needed: auto-resumes next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Spec-review provider unavailable, held drain 2/4; spec attached. No action needed: auto-resumes next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12. Reason: need a durable retry record. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Just unlocked by BRF-10; this puts recovery emails and then delivery auditing within reach. Priority source: issue. Start building via `/faff-graft BRF-11`? (y/n)
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP: 1, cap: 3, remaining headroom: 2. The focus list includes one new start and one item already building. No structural findings.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**

```text
[BRF-11 Issue recovery tokens → BRF-13 Send recovery emails → BRF-14 Audit recovery delivery]
```

BRF-11 opens the path to sending recovery emails and auditing their delivery. One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready, 1 independent, 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up:**

needs-decision-first

- **(architecture): BRF-30:** Select the rate limit store. Punt: Redis or database?
- **(product): BRF-31:** Set the recovery policy. Punt: who can reset an account?
- **(unowned): BRF-32:** Choose the replay window. Retained confidence: medium; spec thin on retry timing and attached for human review.

gap-blocked: (none)

circular-blocked: (none)

repeat-parked: (none)

**Prep queue** (1 candidate)

```text
BRF-33  Record token revocation   no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens; spec ready, just unlocked by BRF-10. Promote to Todo? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
