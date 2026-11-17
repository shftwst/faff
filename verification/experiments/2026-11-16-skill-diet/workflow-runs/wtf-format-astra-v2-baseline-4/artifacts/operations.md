Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Source: connected issue tracker, completed live-fetch snapshot.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts. Unlocked BRF-11, which issues recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Coming up

- **BRF-11:** Issue recovery tokens; just unlocked by BRF-10. The recovery email and delivery audit chain follows.
- **BRF-14:** Audit recovery delivery. Blocked by BRF-13.

```text
[BRF-11 → BRF-13 → BRF-14]
```

### Parked work

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. After resolving it, re-run `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Log: `.faff/runs/run-a/BRF-21/graft.md`. After resolving compatibility, resume via `/faff-graft BRF-21`? (y/n)

BRF-21: open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review provider unavailable, attempt 1/3; branch pushed. Auto-resumes on the next build drain without rebuilding. No action needed; escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Spec-review provider unavailable, held drain 2/4; spec attached. Auto-resumes on the next prep drain without re-spec. No action needed; escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12; a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. This starts the chain toward sending recovery emails and auditing delivery.
2. **BRF-12:** Continue building the recovery screen. Priority source: issue.

### Methodology findings

WIP is 1, cap 3, with headroom for 2 new starts. The focus list recommends one new start and one continuation. No structural findings.

### Automation preview: fire `/faff-beep-boop`?

**Value chains to unlock**

```text
[BRF-11 → BRF-13 → BRF-14]
 Tokens    Emails    Delivery audit
```

BRF-11 gates two downstream issues. One, BRF-13, is blocked only by the head; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  BRF-11  Issue recovery tokens       (none)
```

**Needs your call before automation can pick up:**

needs-decision-first

- **architecture:** BRF-30, select the rate limit store. Punt: Redis or database?
- **product:** BRF-31, set the recovery policy. Punt: Who can reset an account?
- **(unowned):** BRF-32, choose the replay window. Retained confidence: medium; spec thin on retry timing, attached for review.

**Prep queue** (1 candidate)

```text
needs prep
  BRF-33  Record token revocation; no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10.

BRF-11: Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)