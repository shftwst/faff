Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- BRF-10 recorded recovery attempts. This just unlocked BRF-11, issuing recovery tokens.

### In progress

- BRF-12 adds the recovery screen. Status: Building.

### Blocked

- BRF-13 sends recovery emails. Waiting for BRF-11.

### Parked work

- **BRF-20: Choose the retention period.** Interactive prep stopped because the product retention decision remains open. Once resolved, re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21: Repair the importer.** Autonomous graft stopped because schema compatibility is unclear. Resume via `/faff-graft BRF-21` once resolved. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

### Awaiting review (adversarial outage)

- **BRF-22: Deduplicate recovery emails.** Attempt 1/3; branch pushed. No action needed: review resumes next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23: Scope the expiry policy.** Held drain 2/4; spec attached. No action needed: review resumes next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes superseding ADR-0031, Use transient tokens. BRF-12 authored the proposal because a durable retry record is needed. Disposition: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11: Issue recovery tokens.** Priority source: issue. Just unlocked by BRF-10; starts the recovery-email and delivery-audit chain.
2. **BRF-12: Add the recovery screen.** Priority source: issue. Continue the build.

### Methodology findings

WIP: 1/3; room for 2 new starts. No structural findings.

### Automation preview

**Value chains to unlock**

BRF-14 audits recovery delivery and is blocked by BRF-13.

```
[BRF-11 → BRF-13 → BRF-14]
```

One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13. Shipping tokens enables recovery emails, followed by auditing delivery.

**Build queue**

```
fire-and-forget (independents)     likely-fire (serialised)
  BRF-11  Issue recovery tokens     (none)
```

**Needs your call before automation can pick up**

Architecture

- **BRF-30: Select the rate limit store.** `needs-decision-first`; Punt: Redis or database?

Product

- **BRF-31: Set the recovery policy.** `needs-decision-first`; Punt: Who can reset an account?

(unowned)

- **BRF-32: Choose the replay window.** `needs-decision-first`; retained `confidence: medium`, thin on retry timing.

**Prep queue**

- **BRF-33: Record token revocation.** No spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11: Issue recovery tokens.** Spec ready; just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)