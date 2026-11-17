Methodology: faffter-noon-methodology-thematic

## What's up - 2026-11-16

**7 days to Recovery beta**

### Milestones

Source of truth: the connected issue tracker, live snapshot for 2026-11-16.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts. Just unlocked BRF-11, issuing recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Coming up

- **BRF-11:** Issue recovery tokens; just unlocked by BRF-10. Priority source: issue. Opens the recovery email and delivery audit chain.
- **BRF-14:** Audit recovery delivery. Blocked by BRF-13.

### Parked work

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. Re-enter with `/faff-prep BRF-20` after resolving it; no run log supplied. Re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Re-enter with `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log, re-prep via `/faff-prep BRF-21`, or leave parked? (log/reprep/leave) Resume the build via `/faff-graft BRF-21` once compatibility is resolved? (y/n)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review provider unavailable, attempt 1/3; branch pushed. No action needed: resumes next build drain without rebuilding, or escalates to an ordinary park at the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Spec-review provider unavailable, held drain 2/4; spec attached. No action needed: resumes next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

- **ADR-0042, Use token ledger**, proposes to supersede **ADR-0031, Use transient tokens**. Authored by BRF-12; a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Just unlocked by BRF-10; enables recovery email sending, followed by delivery auditing. Priority source: issue.
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP: 1, cap: 3, remaining headroom: 2. Below cap; the focus list includes one new start and one continuation. No structural findings.

### Automation preview - fire `/faff-beep-boop`?

**Value chains to unlock**

```text
[BRF-11 → BRF-13 → BRF-14]
```

BRF-11 opens recovery email sending and then delivery auditing. One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready, 1 fire-and-forget, 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up:**

needs-decision-first

- **(architecture): BRF-30**, select the rate limit store. Punt: Redis or database?
- **(product): BRF-31**, set the recovery policy. Punt: Who can reset an account?
- **(unowned): BRF-32**, choose the replay window. Retained confidence: medium; spec thin on retry timing, attached for review.

**Prep queue** (1 candidate, drained by default `/faff-beep-boop`)

```text
needs-prep
  BRF-33  Record token revocation; no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10. Opens recovery email sending and delivery auditing.

Promote BRF-11 to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)