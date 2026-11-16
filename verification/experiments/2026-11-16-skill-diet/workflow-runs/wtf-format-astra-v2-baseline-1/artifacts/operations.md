Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Source: configured issue tracker, fetched for this brief.

#### Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- BRF-10 records recovery attempts; it just unlocked BRF-11, which issues recovery tokens.

### In progress

- BRF-12 adds the recovery screen. Status: Building.

### Blocked

- BRF-13 sends recovery emails and is waiting for BRF-11.

### Coming up

- BRF-11 issues recovery tokens, just unlocked by BRF-10.
- BRF-14 audits recovery delivery and remains blocked by BRF-13.

### Parked work

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. Resolve that decision, then re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Log: `.faff/runs/run-a/BRF-21/graft.md`. Resume via `/faff-graft BRF-21` once compatibility is resolved? (y/n)

### Awaiting review (adversarial outage)

- BRF-22 deduplicates recovery emails. Review provider unavailable, attempt 1/3; branch pushed. No action needed: review resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- BRF-23 scopes the expiry policy. Spec-review provider unavailable, held drain 2/4; spec attached. No action needed: review resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. BRF-12 authored the proposal because a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042 via `faff adr supersede 0031 --by 0042`? (y/n)

### Do this

1. BRF-11: Issue recovery tokens. Priority source: issue; just unlocked by BRF-10.
2. BRF-12: Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP at 1 (cap 3), with room for 2 new starts. The focus list includes one new start and one in-flight issue. No structural findings.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**

```text
[BRF-11 Issue recovery tokens → BRF-13 Send recovery emails → BRF-14 Audit recovery delivery]
```

BRF-11 opens the recovery-email and delivery-audit chain. One dependent, BRF-13, is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11 Issue recovery tokens        (none)
```

**Needs your call before automation can pick up**

needs-decision-first

- **architecture:** BRF-30 selects the rate limit store. Punt: Redis or database?
- **product:** BRF-31 sets recovery policy. Punt: Who can reset an account?
- **(unowned):** BRF-32 chooses the replay window. Retained confidence: medium; spec thin on retry timing, attached for review.

**Prep queue** (1 candidate)

```text
needs prep
  BRF-33 Record token revocation: no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- BRF-11: Issue recovery tokens. Spec ready; just unlocked by BRF-10. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
