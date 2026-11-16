Methodology: faffter-noon-methodology-thematic

## What's up: 2026-11-16

**7 days to Recovery beta**

### Milestones

Account recovery

| Milestone | Target | Progress |
|---|---|---|
| Recovery beta | 2026-11-23 | 50% |

### Shipped

- **BRF-10** Record recovery attempts: keeps a record of each account-recovery attempt.
  - Just unlocked **BRF-11** Issue recovery tokens: issues the tokens used to recover an account.

### In progress

- **BRF-12** Add recovery screen: the screen a user works through to recover an account. Status: Building.

### Blocked

- **BRF-13** Send recovery emails: emails users during account recovery. Waiting for BRF-11.

### Parked work

- **BRF-20** Choose retention period: decide how long the retained data is kept.
  - **Cause:** the product retention decision is still open.
  - **Parked by:** interactive prep (no run log).
  - **Unpark:** `/faff-prep BRF-20` once the decision is made.
- **BRF-21** Repair importer: fix the broken importer.
  - **Cause:** schema compatibility is unclear.
  - **Parked by:** autonomous graft.
  - **Unpark:** `/faff-graft BRF-21`.
  - **Log:** `.faff/runs/run-a/BRF-21/graft.md`

### Awaiting review (adversarial outage)

- **BRF-22** Deduplicate recovery emails: stop the same recovery email going out more than once. Outage retry 1/3; branch pushed. Resumes on the next build drain without rebuilding. No action needed.

### Awaiting spec-review (adversarial outage)

- **BRF-23** Scope expiry policy: set out what the expiry policy covers. Held drain 2/4; spec attached. Resumes on the next prep drain without re-spec. No action needed.

### ADR supersession proposals awaiting ratification

- **ADR-0042** Use token ledger proposes superseding **ADR-0031** Use transient tokens.
  - **Authored by:** BRF-12 (Add recovery screen).
  - **Why:** need a durable retry record.
  - Ratify supersession of ADR-0031 by ADR-0042? (y/n)

### Do this

1. **BRF-11** Issue recovery tokens. Priority source: issue. Just unlocked by BRF-10. Shipping it lets recovery emails go out (BRF-13), which in turn opens **BRF-14** Audit recovery delivery: checking that recovery messages were delivered.
2. **BRF-12** Add recovery screen: finish the in-flight build. Priority source: issue.

### Methodology findings

- **WIP:** 1 of 3, headroom for 2 new starts.
- **Structural findings:** none.

### Automation preview

**Value chains to unlock**

```
BRF-11  issue recovery tokens  →  unlocks BRF-13 → BRF-14   (2 issues; 1 blocked only by BRF-11, BRF-14 still gated by BRF-13)
```

**Build queue**

```
fire-and-forget (independents)        likely-fire (serialised)
  BRF-11  Issue recovery tokens         (none)
```

**Needs your call**

- architecture
  - **BRF-30** Select rate limit store: choose where rate-limit counts are kept. Punt: Redis or database?
- product
  - **BRF-31** Set recovery policy: decide the rules for account recovery. Punt: Who can reset an account?
- (unowned)
  - **BRF-32** Choose replay window: pick how long a replay is allowed. Retained confidence: medium; the spec is thin on retry timing, so give it a once-over.

**Prep queue**

- **BRF-33** Record token revocation: record when a recovery token is revoked. No spec.

### Structural diagnostics

Structural diagnostics: clean ✓

### Ready to pick up

- **BRF-11** Issue recovery tokens: spec ready; just unlocked by BRF-10.

---

- Picking up BRF-11. Start building now via `/faff-graft`? (y/n)
- Promote BRF-11 to Todo? (y/n)
- BRF-20 parked: re-run `/faff-prep BRF-20` or leave parked? (reprep/leave)
- BRF-21 parked: open log / re-run `/faff-graft BRF-21` / leave parked? (log/regraft/leave)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 1 prep candidate. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
