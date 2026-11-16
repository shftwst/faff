Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Source: connected issue tracker, snapshot dated 2026-11-16.

#### Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- BRF-10: Record recovery attempts. Unlocked BRF-11: Issue recovery tokens.

### In progress

- BRF-12: Add the recovery screen. Building.

### Blocked

- BRF-13: Send recovery emails. Waiting for BRF-11.

### Coming up

1. BRF-11: Issue recovery tokens; just unlocked by BRF-10. Priority source: issue.
2. BRF-14: Audit recovery delivery; blocked by BRF-13.

The recovery dependency chain is [BRF-11 → BRF-13 → BRF-14].

### Parked work

- BRF-20: Choose the retention period. Interactive prep parked because the product retention decision remains open. Resolve the decision, then resume with `/faff-prep BRF-20`. No run log supplied.
- BRF-21: Repair the importer. Autonomous graft parked because schema compatibility is unclear. Resolve compatibility, then resume with `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`.

### Awaiting review (adversarial outage)

- BRF-22: Deduplicate recovery emails. Branch pushed; review provider unavailable, attempt 1/3. No action needed: resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- BRF-23: Scope the expiry policy. Spec attached; spec-review provider unavailable, held drain 2/4. No action needed: resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12; a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. BRF-11: Issue recovery tokens. Just unlocked by BRF-10; priority source: issue. The chain continues through recovery emails to delivery auditing.
2. BRF-12: Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP is 1 against a cap of 3, leaving room for 2 new starts. The focus list includes one new start and one in-flight issue. No structural findings.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**

[BRF-11 → BRF-13 → BRF-14]

BRF-11 issues recovery tokens; BRF-13 sends recovery emails; BRF-14 audits delivery. Of the 2 dependents, 1 is blocked only by BRF-11. BRF-14 remains gated by BRF-13.

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up**

needs-decision-first

- **architecture:** BRF-30: Select the rate limit store. Punt: Redis or database?
- **product:** BRF-31: Set the recovery policy. Punt: Who can reset an account?
- **(unowned):** BRF-32: Choose the replay window. Retained confidence: medium; the spec is thin on retry timing and is attached for human review.

**Prep queue** (1 candidate)

```text
needs prep
  BRF-33  Record token revocation; no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- BRF-11: Issue recovery tokens. Spec ready; just unlocked by BRF-10. The downstream chain covers sending recovery emails and auditing delivery.

Promote BRF-11 to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Resume BRF-20 prep via `/faff-prep BRF-20` after resolving the retention decision? (y/n)

For BRF-21: open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

Resume BRF-21's build via `/faff-graft BRF-21` after resolving schema compatibility? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
