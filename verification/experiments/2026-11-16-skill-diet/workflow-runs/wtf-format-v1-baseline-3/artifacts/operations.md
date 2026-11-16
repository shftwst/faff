Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Snapshot from the tracker; re-query it for the live view.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped
- BRF-10  Records each account-recovery attempt. Unlocked: BRF-11 (issues the tokens used to recover an account).

### In progress
- BRF-12  Adds the screen people use to recover their account: building.

### Blocked
- BRF-13  Sends recovery emails: blocked, waiting for BRF-11.

### Parked work
- BRF-20  Chooses how long recovery data is kept: parked during interactive prep; the product retention decision is still open. Unpark: answer the decision, then run `/faff-prep BRF-20`. No run log (interactive park).
- BRF-21  Repairs the importer: parked by an autonomous graft run; schema compatibility is unclear. Unpark: `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)
- BRF-22  Stops duplicate recovery emails going out: review provider unavailable, attempt 1/3. Branch pushed; auto-resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)
- BRF-23  Defines the scope of the expiry policy: spec-review provider unavailable, held drain 2/4. Spec attached; auto-resumes on the next prep drain without re-spec. No action needed.

### ADR supersession proposals awaiting ratification
- ADR-0042 (Use token ledger) proposes to supersede ADR-0031 (Use transient tokens), authored by BRF-12: need a durable retry record. Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this
Ordered by the methodology's pick-ordering.

1. BRF-11  Issue the tokens used to recover an account. Shipping it lets the recovery emails (BRF-13) go ahead, and the recovery-delivery audit (BRF-14) after that. (Priority source: issue; just unlocked by BRF-10.)
2. BRF-12  Finish the recovery screen already in build. (Priority source: issue.)

### Methodology findings

WIP at 1 (cap 3). Below cap, with room for 2 new starts; recommending one new start (BRF-11).

No structural findings.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**
  BRF-11  Issue recovery tokens  →  unlocks BRF-13 → BRF-14  (2 issues; BRF-13 blocked only by BRF-11, BRF-14 still gated by BRF-13)

**Build queue** (1 ready · 1 fire-and-forget · 0 likely-fire)

  fire-and-forget
    BRF-11  Issue recovery tokens · opens the recovery emails and delivery audit

**Needs your call before automation can pick up:**

  needs-decision-first
    (architecture)
      BRF-30  Pick where rate-limit counts are stored: Punt in spec: Redis or database?
    (product)
      BRF-31  Set the account recovery policy: Punt in spec: who can reset an account?
    (unowned)
      BRF-32  Choose the replay window: confidence: medium (spec thin on retry timing); prep attached for review

**Prep queue** (1 candidate, drained by default `/faff-beep-boop`)
- BRF-33  Record token revocations: no spec

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up
- BRF-11  Issue recovery tokens: spec ready (just unlocked by BRF-10) (unlocks 2)

### Next steps
- Picking up BRF-11. It already has a spec: start building now via `/faff-graft`? (y/n)
- BRF-20: re-run `/faff-prep` or leave parked? (reprep/leave)
- BRF-21: open log, re-run `/faff-graft`, or leave parked? (log/regraft/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
