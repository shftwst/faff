# faffidavit-routing

The automation-routing contract — defines the closed six-verdict vocabulary that says whether `/faff-beep-boop` will run an issue autonomously (and if not, why), the root-cause class taxonomy that repeat-park detection and calibration share, and the display format consumers render. It **assigns** a verdict to a spec-gated issue and **validates** a verdict assignment on demand. A `faffidavit-*` skill: it both *defines* a conformance standard and *checks* conformance.

This is the implicit default for the `routing_contract` slot.

```yaml
planning_skills:
  routing_contract: faffidavit-routing   # the default — explicit for clarity
```

## Why the contract exists

The verdict vocabulary is the stable boundary between the `methodology` slot and three consumers — `/faff-beep-boop`'s admission gate, `/faff-wtf`'s morning brief, and `/faff-workit`'s park logic. The methodology slot is swappable (`faffter-dark-methodology-agile-delivery` already replaces the structural default), so the verdicts must survive a methodology swap: whatever methodology detects the backlog problems, the verdict words that gate admission stay the same. Conversely, a user who wants a different routing policy swaps `routing_contract` without touching the methodology. Keeping this in a contract — not inside a methodology skill or hardcoded in beep-boop — is what makes both swaps safe.

## Two faces

- **Define** (reference): the six verdicts, the root-cause class enum, and the display format below. The methodology slot's `backlog-diagnostics` feeds findings in; consumers read the verdict out.
- **Assign / validate** (invokable): given a spec-gated issue (spec confidence + markers + the methodology's backlog-diagnostics findings + park history), assign exactly one verdict; or, given an existing verdict assignment, confirm it conforms (recognised verdict, inputs consistent with the verdict's definition). Invoked by `/faff-tidy` to compute the per-pass verdict file, and standalone to explain why an issue would or wouldn't fire.

## The six verdicts

Every Todo issue with a discoverable spec gets exactly one verdict. Computed once per faff pass, consumed everywhere.

| Verdict | Definition | What `/faff-beep-boop` does |
|---|---|---|
| `fire-and-forget` | Spec `confidence: high`, no Punt/Assumes markers, no in-queue blocker, conflict analysis says independent, no repeat-park history | Builds in next autonomous run, parallel-safe |
| `likely-fire` | Spec `confidence: high` but in a collision group with other in-queue work | Builds in next autonomous run, serialised within its group |
| `needs-decision-first` | Spec contains explicit `Punt:` / `needs human` / `TBD` / "or X if Y" marker that is **not** spec-closed | Resolve-attempt (gateway → Autonomous Mode Contract → resolve-attempt); if it fails, skipped and surfaced in wtf with the specific decision asked |
| `gap-blocked` | Spec assumes external state (tracker issue, project, dep) that doesn't exist | Resolve-attempt; if it fails, skipped and surfaced with the named gap |
| `circular-blocked` | Issue sits in a dep cycle detected by the methodology slot's `backlog-diagnostics` | Resolve-attempt; if it fails, skipped and surfaced with the cycle visualised |
| `repeat-parked` | Parked 3+ times in autonomous runs with the same root-cause class (see **Root-cause class enum**) | **Skipped — no resolve-attempt.** The pattern itself is the signal that a human needs to act. Surfaced prominently in wtf. |

The vocabulary is **closed**: six verdicts, no more. A routing policy that needs a seventh state is misusing the contract.

### Build-queue admission

`/faff-beep-boop` admits to the build queue **only** `fire-and-forget` and `likely-fire` (the latter into collision groups). All other verdicts route out with a one-line reason captured in the run summary. They appear in `/faff-wtf`'s morning brief — never silently dropped.

### Conflict-analysis integration

When assigning `likely-fire`, the verdict **anticipates** the collision-group serialisation conflict analysis would do anyway. An issue's verdict is `likely-fire` (not `fire-and-forget`) precisely when conflict analysis will serialise it. This keeps morning briefs honest — the human sees up front which issues run in parallel vs. queue behind a predecessor.

## Root-cause class enum (shared taxonomy)

Shared across two consumers: repeat-park detection in the methodology's `backlog-diagnostics`, and the calibration log. Deliberately coarse so the same underlying problem ("the spec doesn't say whether to migrate or fork the table") matches across runs even when the literal park-note text varies.

- `punt-not-closed` — park reason cites a Punt marker the spec didn't close
- `gap` — park reason cites an external state that doesn't exist
- `cycle` — park reason cites a dep cycle
- `spec-ambiguous-external` — park reason cites an external decision the spec can't make alone
- `other` — everything else (rarely matches across runs; effectively prevents false-positive repeat-park flagging)

## Computation locus

The verdict is computed in `/faff-tidy`'s backlog-diagnostics phase, written to:

- `.faff/runs/<run-id>/automation-verdicts.md` when invoked by `/faff-beep-boop` (full pipeline)
- `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` when tidy runs standalone

Other sub-skills (`/faff-wtf`, `/faff-beep-boop`) read this file rather than recomputing — but only within a single faff pass; across passes, always recompute (the "always pull fresh" rule wins, same logic as spec discovery). `/faff-wtf` invoked standalone (no preceding tidy this pass) computes verdicts inline using this same contract.

## Display format (consumed by `/faff-wtf` and `/faff-beep-boop`)

Renders via the `language_contract` slot → queue partition grid (form (c)). Compact form:

```
Build queue (4 ready · 2 fire-and-forget · 2 likely-fire serialised)
  fire-and-forget
    ISSUE-XX  Pino instrumentation — wires structured logging into all handlers · unlocks 3 alerting tickets
    ISSUE-YY  Rate-limit middleware — caps per-IP requests on auth routes
  likely-fire [ISSUE-A → ISSUE-B] (both touch src/auth/)
    ISSUE-A   Session refresh — extends JWT lifetime when active
    ISSUE-B   Logout sweep — purges sessions on password change

Needs your call before automation can pick up:
  needs-decision-first
    ISSUE-ZZ  Email digest — Punt in spec: cron vs. queue-driven send? (decide in 2 min)
  gap-blocked
    ISSUE-WW  Billing webhook retry — spec assumes a "webhook-events" project that doesn't exist; file it or scope the dep down
  circular-blocked
    ISSUE-AA  Onboarding redirect — sits in cycle [AA → BB → CC → AA]; recommend breaking AA→BB by inlining the auth state
  repeat-parked ⚠
    ISSUE-VV  Storage migration (parked 4 runs with same Punt: schema versioning unresolved). Decide.
```

The synthesis gloss (gateway → Synthesis contract, owned by the `language_contract` slot) supplies the human-language description for every ID; the diagnosis lines ("Punt in spec: …", "recommend breaking …") follow the prose carve-outs from the rendering contract.

## Validation

**Checks:**

1. Exactly one verdict per spec-gated issue, drawn from the closed six.
2. The verdict is consistent with its inputs — e.g. `fire-and-forget` requires `confidence: high` and no open markers; `circular-blocked` requires a cycle finding from `backlog-diagnostics`; `repeat-parked` requires ≥3 same-root-cause parks.
3. `repeat-parked` carries no resolve-attempt (the pattern is the signal).

**Output:**

```
signal: pass | fail

## Violations
### [rule]: [where]
[what's wrong] → [the fix]
```

## Rules

- The six verdicts and the root-cause classes are both closed enums. A new state is added here first, or not at all — never invented inline by a consumer.
- The contract assigns and validates the verdict; it does not own *detection* (cycles, ghost-projects, repeat-park patterns come from the methodology slot's `backlog-diagnostics`) or *sequencing* (admission, resolve-attempt, park belong to beep-boop / workit).
- Only `fire-and-forget` and `likely-fire` ever enter the build queue. This admission rule is non-negotiable for autonomous operation.
