Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

**Account recovery**

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10:** Record recovery attempts.
  - Just unlocked **BRF-11:** issue recovery tokens.

### In progress

- **BRF-12:** Add the recovery screen. Status: Building.

### Blocked

- **BRF-13:** Send recovery emails. Waiting for BRF-11.

### Parked work

Issue: BRF-20
Work: Choose the retention period
Parked by: interactive prep
Cause: the product retention decision is still open
Unpark: `/faff-prep BRF-20`
────────────────────────────────────────
Issue: BRF-21
Work: Repair the importer
Parked by: autonomous graft
Cause: schema compatibility is unclear
Unpark: `/faff-graft BRF-21`
Log: `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)

- **BRF-22:** Deduplicate recovery emails. Review attempt 1/3. The branch is pushed, so it resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)

- **BRF-23:** Scope the expiry policy. Held drain 2/4. The spec is attached, so it resumes on the next prep drain without re-specifying. No action needed.

### ADR supersession proposals awaiting ratification

- **ADR-0042 (Use token ledger)** proposes to supersede **ADR-0031 (Use transient tokens)**.
  - **Authored by:** BRF-12
  - **Why:** Need a durable retry record

Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11:** Issue recovery tokens. Priority set on the issue; just unlocked by BRF-10. Once it ships, BRF-13 can send recovery emails, and that opens BRF-14.
2. **BRF-12:** Finish the recovery screen already in progress. Priority set on the issue.

### Methodology findings

- **WIP:** 1 of 3, with headroom for 2 new starts.
- **Structural findings:** none.

### Automation preview

**Value chains to unlock**

```
BRF-11  Issue recovery tokens  →  unlocks BRF-13 → BRF-14   (2 issues; 1 blocked only by BRF-11, BRF-14 still gated)
```

BRF-14 audits recovery delivery and is still gated by BRF-13, which sends the recovery emails.

**Build queue**

```
fire-and-forget (independents)          likely-fire (serialised)
  BRF-11  Issue recovery tokens           (none)
```

**Needs your call**

- **architecture**
  - **BRF-30:** Select the rate-limit store. Punt: Redis or database?
- **product**
  - **BRF-31:** Set the recovery policy. Punt: Who can reset an account?
- **(unowned)**
  - **BRF-32:** Choose the replay window. Retained `confidence: medium`; the spec is thin on retry timing.

**Prep queue**

- **BRF-33:** Record token revocation. No spec yet.

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up

- **BRF-11:** Issue recovery tokens. Spec ready; just unlocked by BRF-10.

---

- Start building BRF-11 now via `/faff-graft`? (y/n)
- BRF-21 was parked by an autonomous graft: open log / re-run `/faff-graft BRF-21` / leave parked? (log/rerun/leave)
- Promote BRF-11 to Todo? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
