Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Recorded recovery attempts; just unlocked BRF-11, which issues recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Send recovery emails; waiting for BRF-11.

### Parked work

- **BRF-20:** Choose the retention period. Parked during interactive prep because the product retention decision remains open. Once resolved, the unpark route is `/faff-prep BRF-20`.
- **BRF-21:** Repair the importer. Parked during autonomous graft because schema compatibility is unclear. Unpark route: `/faff-graft BRF-21`. Log: `.faff/runs/run-a/BRF-21/graft.md`.

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Attempt 1/3; branch pushed. No action needed: review auto-resumes on the next build drain without rebuilding, or escalates to an ordinary park after the retry bound.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held-drain attempt 2/4; spec attached, review not concluded. No action needed: review auto-resumes on the next prep drain without re-spec, or escalates to an ordinary park past the hold limit.

### ADR supersession proposals awaiting ratification

ADR-0042, Use token ledger, proposes to supersede ADR-0031, Use transient tokens. Authored by BRF-12 because a durable retry record is needed. Disposition: propose-only; awaiting human ratification.

### Do this

1. **BRF-11:** Issue recovery tokens. Priority source: issue; just unlocked by BRF-10. Token issuance starts the chain towards recovery email delivery and its audit.
2. **BRF-12:** Add the recovery screen. Priority source: issue; continue the build.

### Methodology findings

WIP: 1/3; remaining headroom: 2 new starts. No structural findings.

### Automation preview

#### Value chains to unlock

[BRF-11 → BRF-13 → BRF-14]

BRF-14 audits recovery delivery. Shipping BRF-11 makes recovery emails possible: one dependent is blocked only by the head. BRF-14 remains gated by BRF-13.

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens        (none)
```

#### Needs your call before automation can pick up

**architecture**

- **BRF-30:** Select the rate limit store. `needs-decision-first`: Redis or database?

**product**

- **BRF-31:** Set the recovery policy. `needs-decision-first`: Who can reset an account?

**(unowned)**

- **BRF-32:** Choose the replay window. `needs-decision-first`: retained `confidence: medium`; the spec is thin on retry timing.

#### Prep queue

- **BRF-33:** Record token revocation; no spec.

### Structural diagnostics

Structural diagnostics: clean

### Ready to pick up

- **BRF-11:** Issue recovery tokens; spec ready, just unlocked by BRF-10. Promote to Todo? (y/n)

Re-prep BRF-20 via `/faff-prep BRF-20` once the retention decision is resolved? (y/n)

BRF-21: open log / re-run `/faff-prep BRF-21` / leave parked (log/reprep/leave). To resume the build after resolving compatibility, use `/faff-graft BRF-21`.

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

Start building BRF-11 now via `/faff-graft BRF-11`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)