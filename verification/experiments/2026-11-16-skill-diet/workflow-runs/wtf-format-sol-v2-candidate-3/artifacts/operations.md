Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Recorded recovery attempts; just unlocked BRF-11, issuing recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Send recovery emails; waiting for BRF-11.

### Parked work

- **BRF-20: Choose the retention period.** Interactive prep parked because the product retention decision remains open. Resolve the decision, then re-enter via `/faff-prep BRF-20`. Re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21: Repair the importer.** Autonomous graft parked because schema compatibility is unclear. Re-enter via `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave) Resume building via `/faff-graft BRF-21`? (y/n)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Attempt 1/3; branch pushed. No action needed: review resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held drain 2/4; spec attached. No action needed: review resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes superseding ADR-0031, Use transient tokens. Authored by BRF-12; a durable retry record is needed. This remains propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11: Issue recovery tokens.** Priority source: issue; just unlocked by BRF-10. This puts recovery-email delivery in reach, followed by BRF-14, auditing recovery delivery. BRF-13 needs this first.
2. **BRF-12: Add the recovery screen.** Priority source: issue; continue the current build.

### Methodology findings

WIP: 1/3; remaining headroom: 2 new starts. No structural findings.

### Automation preview

#### Value chains to unlock

[BRF-11 → BRF-13 → BRF-14]

BRF-11 enables recovery-email delivery and its audit. One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens        (none)
```

#### Needs your call before automation can pick up

needs-decision-first

- **architecture:** BRF-30, select the rate limit store. Punt: Redis or database?
- **product:** BRF-31, set the recovery policy. Punt: Who can reset an account?
- **(unowned):** BRF-32, choose the replay window. Retained confidence: medium; thin area: retry timing.

#### Prep queue

- **BRF-33:** Record token revocation; no spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens; spec ready, just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)