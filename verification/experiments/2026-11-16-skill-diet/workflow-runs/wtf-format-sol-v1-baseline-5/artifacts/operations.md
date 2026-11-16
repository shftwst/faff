Methodology: faffter-noon-methodology-thematic

## What's up - 2026-11-16

**7 days to Recovery beta**

### Milestones

Source: connected issue tracker, live-fetch snapshot for 2026-11-16.

#### Account recovery

| Milestone | Target | Progress |
|-----------|--------|----------|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts; just unlocked BRF-11, issuing recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Coming up

- **BRF-11:** Issue recovery tokens; just unlocked by BRF-10. Priority source: issue. Enables recovery emails and the subsequent delivery audit: [BRF-11 → BRF-13 → BRF-14].
- **BRF-14:** Audit recovery delivery. Blocked by BRF-13.

### Parked work

- **BRF-20:** Choose the retention period. Interactive prep parked because the product retention decision remains open. After resolving it, re-enter via `/faff-prep BRF-20`. No run log supplied. Re-prep via `/faff-prep BRF-20`? (y/n)
- **BRF-21:** Repair the importer. Autonomous graft parked because schema compatibility is unclear. Re-enter via `/faff-graft BRF-21`; log: `.faff/runs/run-a/BRF-21/graft.md`. Open log / re-run `/faff-prep BRF-21` / leave parked? (log/reprep/leave) Resume the build via `/faff-graft BRF-21` after resolving compatibility? (y/n)

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review provider unavailable, attempt 1/3; branch pushed. Auto-resumes next build drain without rebuilding. No action needed; escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Spec-review provider unavailable, held drain 2/4; spec attached. Auto-resumes next prep drain without re-spec. No action needed; escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12 because a durable retry record is needed. Status: propose-only.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. Opens the path to recovery emails and delivery auditing.
2. **BRF-12:** Continue adding the recovery screen. Priority source: issue.

### Methodology findings

WIP: 1, cap: 3. Remaining headroom: 2 new starts. No structural findings.

### Automation preview - fire `/faff-beep-boop`?

**Value chains to unlock**

[BRF-11 → BRF-13 → BRF-14]

Issuing recovery tokens enables recovery emails, then delivery auditing. Of the two dependents, one is blocked only by BRF-11; BRF-14 remains gated by BRF-13.

**Build queue** (1 ready; 1 independent; 0 collision groups)

```
fire-and-forget (independents)     likely-fire (serialised)
  BRF-11  Issue recovery tokens     (none)
```

**Needs your call before automation can pick up:**

**needs-decision-first**

- **(architecture):** BRF-30, select the rate limit store. Punt in spec: Redis or database?
- **(product):** BRF-31, set the recovery policy. Punt in spec: Who can reset an account?
- **(unowned):** BRF-32, choose the replay window. Retained confidence: medium; spec thin on retry timing, attached for review.

**Prep queue** (1 candidate)

```
BRF-33  Record token revocation  no spec
```

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10. Opens the recovery email and delivery audit chain. Promote to Todo? (y/n)

Start building BRF-11 via `/faff-graft BRF-11`? (y/n)

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)