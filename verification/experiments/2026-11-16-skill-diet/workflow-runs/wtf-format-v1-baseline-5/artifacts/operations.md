Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Source of truth is the configured issue tracker; this is a snapshot from today's live fetch.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped
- BRF-10  Records each account-recovery attempt · unlocked: BRF-11 (issues the tokens a user needs to recover their account)

### In progress
- BRF-12  Adds the screen users see when recovering an account: building

### Blocked
- BRF-13  Sends the account-recovery emails: blocked by BRF-11 (waiting for recovery tokens)

### Coming up
- BRF-11  Issue recovery tokens (just unlocked by BRF-10; priority source: issue). Chain: BRF-13 → BRF-14
- BRF-14  Audits that recovery emails were delivered: blocked by BRF-13

### Parked work
- BRF-20  Choose how long recovery data is retained: parked by interactive prep; the product retention decision is still open. Unpark: re-run `/faff-prep BRF-20` once the decision is made.
- BRF-21  Repair the importer: parked by an autonomous graft; schema compatibility is unclear. Unpark: re-run `/faff-graft BRF-21`. (log: .faff/runs/run-a/BRF-21/graft.md)

### Awaiting review (adversarial outage)
- BRF-22  Stops duplicate recovery emails being sent: review provider unavailable, attempt 1/3; branch pushed; auto-resumes on the next build drain without rebuilding, no action needed

### Awaiting spec-review (adversarial outage)
- BRF-23  Sets the scope of the token expiry policy: spec-review provider unavailable, held drain 2/4; spec attached; auto-resumes on the next prep drain without re-spec, no action needed

### ADR supersession proposals awaiting ratification
- ADR-0042 (Use token ledger) proposes to supersede ADR-0031 (Use transient tokens), authored by BRF-12: need a durable retry record. Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this
Ordered by the methodology's pick-ordering.

1. BRF-11  Issue the tokens a user needs to recover their account. Once it ships, BRF-13 can send recovery emails, and BRF-14 can audit their delivery after that. (Priority source: issue; just unlocked by BRF-10.)
2. BRF-12  Finish the recovery screen already in progress. (Priority source: issue.)

### Methodology findings

WIP at 1 (cap 3). Below cap: room for up to 2 new starts.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**
  BRF-11  issue recovery tokens  →  unlocks BRF-13 → BRF-14  (2 issues; BRF-13 blocked only by BRF-11, BRF-14 still gated by BRF-13)

**Build queue** (1 ready · 1 fire-and-forget)

  fire-and-forget
    BRF-11  Issue recovery tokens

**Needs your call before automation can pick up:**

  needs-decision-first
    (architecture)
      BRF-30  Choose where rate-limit counters are stored: Punt in spec: Redis or database?
    (product)
      BRF-31  Set who may recover an account: Punt in spec: who can reset an account?
    (unowned)
      BRF-32  Choose the replay window for recovery requests: confidence: medium (spec thin on retry timing); prep attached for review

**Prep queue** (1 candidate, drained by default `/faff-beep-boop`)
- BRF-33  Record when a recovery token is revoked: no spec

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up
- BRF-11  Issue recovery tokens: spec ready (just unlocked by BRF-10) (unlocks 2: recovery emails, then their delivery audit)

### Next steps
- Picking up BRF-11. Start building now via `/faff-graft`? (y/n)
- BRF-20: re-run `/faff-prep BRF-20` or leave parked? (reprep/leave)
- BRF-21: open log, re-run `/faff-graft BRF-21`, or leave parked? (log/regraft/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
