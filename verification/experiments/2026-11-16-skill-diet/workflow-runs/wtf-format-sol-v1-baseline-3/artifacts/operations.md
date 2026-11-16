Methodology: faffter-noon-methodology-thematic

## What's up - 2026-11-16

**7 days to Recovery beta**

### Milestones

Source of truth: connected issue tracker; live snapshot for 2026-11-16.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts; unlocked BRF-11, which issues recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Send recovery emails; waiting for BRF-11.

### Coming up

- **BRF-11:** Issue recovery tokens; just unlocked by BRF-10. Priority source: issue. This enables recovery emails and the subsequent delivery audit.
- **BRF-14:** Audit recovery delivery; blocked by BRF-13.

### Parked work

- **BRF-20:** Choose the retention period; parked during interactive prep because the product retention decision remains open. After resolving it, re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer; parked during autonomous graft because schema compatibility is unclear. Recovery command: `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails; review provider unavailable, attempt 1/3. Branch pushed; auto-resumes next build drain without rebuilding. No action needed; escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy; spec-review provider unavailable, held drain 2/4. Spec attached; auto-resumes next prep drain without re-spec. No action needed; escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12 because a durable retry record is needed. Disposition: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens, enabling recovery emails and the delivery audit. Priority source: issue; just unlocked by BRF-10.
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP: 1, cap: 3. Remaining headroom: 2 new starts.

### Automation preview - fire `/faff-beep-boop`?

**Value chains to unlock**

```text
[BRF-11 Issue recovery tokens → BRF-13 Send recovery emails → BRF-14 Audit recovery delivery]
```

BRF-11 enables recovery emails and the subsequent delivery audit. One dependent is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready; 1 independent; 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up**

needs-decision-first

- **(architecture):** BRF-30, select the rate limit store. Punt in spec: Redis or database?
- **(product):** BRF-31, set recovery policy. Punt in spec: Who can reset an account?
- **(unowned):** BRF-32, choose the replay window. Retained confidence: medium; spec thin on retry timing, attached for review.

gap-blocked: (none)

circular-blocked: (none)

repeat-parked: (none)

**Prep queue** (1 candidate, drained by default `/faff-beep-boop`)

```text
needs prep
  BRF-33  Record token revocation; no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens; spec ready, just unlocked by BRF-10. Enables recovery emails and the subsequent delivery audit.

Promote BRF-11 to Todo? (y/n)

Start building BRF-11 now via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)