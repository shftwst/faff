Methodology: faffter-noon-methodology-thematic

## What's up - 2026-11-16

**7 days to Recovery beta**

### Milestones

Source of truth is the configured issue tracker. Snapshot below; re-query the tracker's milestones per project for the live view.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped
- BRF-10  Records each account-recovery attempt · unlocked: BRF-11 (issues recovery tokens)

### In progress
- BRF-12  Adds the account-recovery screen: building

### Blocked
- BRF-13  Sends account-recovery emails: blocked, waiting for BRF-11

### Parked overnight
- BRF-20  Chooses the retention period: parked in interactive prep because the product retention decision remains open (no run log). Unpark by re-running `/faff-prep BRF-20` once the decision is made.
- BRF-21  Repairs the importer: parked in an autonomous build because schema compatibility is unclear (log: .faff/runs/run-a/BRF-21/graft.md). Unpark by re-running `/faff-graft BRF-21`.

### Awaiting review (adversarial outage)
- BRF-22  Removes duplicate recovery emails: review provider unavailable, attempt 1/3. Branch pushed; auto-resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)
- BRF-23  Scopes the expiry policy: spec-review provider unavailable, held drain 2/4. Spec attached; auto-resumes on the next prep drain without re-spec. No action needed.

### ADR supersession proposals awaiting ratification
- ADR-0042 "Use token ledger" proposes to supersede ADR-0031 "Use transient tokens" (authored by BRF-12): need a durable retry record. Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this
Ordered by the methodology's pick-ordering.

1. BRF-11  Issue recovery tokens; BRF-13 (recovery emails) is waiting on it. (Priority source: issue; just unlocked by BRF-10.)
2. BRF-12  Finish the recovery screen already being built. (Priority source: issue.)

### Methodology findings

WIP at 1 (cap 3). Below cap: up to 2 new starts.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**
  BRF-11  issue recovery tokens  →  unlocks BRF-13 → BRF-14  (2 issues; 1 blocked only by BRF-11, BRF-14 still gated by BRF-13)
  BRF-14: audits recovery delivery.

**Build queue** (1 ready · 1 fire-and-forget · 0 likely-fire)

  fire-and-forget
    BRF-11  Issue recovery tokens

**Needs your call before automation can pick up:**

  needs-decision-first
    (architecture)
      BRF-30  Selects the rate-limit store. Punt in spec: Redis or database?
    (product)
      BRF-31  Sets the account-recovery policy. Punt in spec: who can reset an account?
    (unowned)
      BRF-32  Chooses the replay window. confidence: medium (spec thin on retry timing); prep attached for review

**Prep queue** (1 candidate, drained by default `/faff-beep-boop`)
- BRF-33  Records token revocation: no spec

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up
- BRF-11  Issue recovery tokens: spec ready; just unlocked by BRF-10

### Next steps
- Picking up BRF-11. It already has a spec. Start building now via `/faff-graft`? (y/n)
- Promote BRF-11 to Todo? (y/n)
- BRF-20: re-run `/faff-prep` or leave parked? (reprep/leave)
- BRF-21: open log, re-run `/faff-graft` or leave parked? (log/regraft/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
