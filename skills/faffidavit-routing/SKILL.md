# faffidavit-routing

The default **adaptor** for the `routing_adaptor` slot. It **assigns** an automation-routing verdict to a spec-gated issue — from `backlog-diagnostics` findings + spec confidence + markers + park history — renders the verdicts consumers display, and **validates** an assignment on demand. A `faffidavit-*` skill: it both *defines* its assignment/display dialect and *checks* conformance.

```yaml
planning_skills:
  routing_adaptor: faffidavit-routing   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The automation-routing contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Automation-routing verdict_), **not** here. Fixed there, and unaffected by swapping this slot:

- the closed **six-verdict vocabulary** (`fire-and-forget`, `likely-fire`, `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`),
- the **build-queue admission rule** — only `fire-and-forget` + `likely-fire` ever enter the queue; all others route out with a one-line reason surfaced in wtf, never silently dropped,
- the **root-cause class enum** (`punt-not-closed`, `gap`, `cycle`, `spec-ambiguous-external`, `other`) shared by repeat-park detection and the calibration log.

These are the stable boundary between the `methodology` slot and three consumers — `/faff-beep-boop`'s admission gate, `/faff-wtf`'s morning brief, `/faff-workit`'s park logic. Whatever methodology detects the backlog problems, the verdict words that gate admission stay fixed in the gateway. This skill does not get to change them. What it owns is *assignment + display* — how an issue is mapped onto a verdict, and how verdicts are rendered.

## The six verdicts (fixed — recap for assignment)

The adaptor assigns exactly one per Todo issue with a discoverable spec. Defined fully in the gateway; recapped here so assignment is unambiguous:

| Verdict | Definition | What `/faff-beep-boop` does |
|---|---|---|
| `fire-and-forget` | Spec `confidence: high`, no Punt/Assumes markers, no in-queue blocker, conflict analysis says independent, no repeat-park history | Builds in next autonomous run, parallel-safe |
| `likely-fire` | Spec `confidence: high` but in a collision group with other in-queue work | Builds in next autonomous run, serialised within its group |
| `needs-decision-first` | Spec contains an explicit `Punt:` / `needs human` / `TBD` / "or X if Y" marker that is **not** spec-closed, **or** the spec carries `confidence: medium` (the retained rating is itself the human-call signal — thin rationale or open punts) | Resolve-attempt; if it fails, skipped and surfaced in wtf with the specific decision asked (for a bare `medium` with no explicit marker, "confirm or bump the spec") |
| `gap-blocked` | Spec assumes external state (tracker issue, project, dep) that doesn't exist | Resolve-attempt; if it fails, skipped and surfaced with the named gap |
| `circular-blocked` | Issue sits in a dep cycle detected by the methodology slot's `backlog-diagnostics` | Resolve-attempt; if it fails, skipped and surfaced with the cycle visualised |
| `repeat-parked` | Parked 3+ times in autonomous runs with the same root-cause class | **Skipped — no resolve-attempt.** The pattern itself is the signal that a human needs to act. Surfaced prominently in wtf. |

### Conflict-analysis integration

When assigning `likely-fire`, the verdict **anticipates** the collision-group serialisation conflict analysis would do anyway. An issue's verdict is `likely-fire` (not `fire-and-forget`) precisely when conflict analysis will serialise it. This keeps morning briefs honest — the human sees up front which issues run in parallel vs. queue behind a predecessor.

## Adaptor (this skill's dialect)

### Assignment

Given a spec-gated issue (spec confidence + markers + the methodology's `backlog-diagnostics` findings + park history), assign exactly one verdict by the definitions above. Invoked by `/faff-tidy` to compute the per-pass verdict file, and standalone to explain why an issue would or wouldn't fire.

### Computation locus

The verdict is computed in `/faff-tidy`'s backlog-diagnostics phase, written to:

- `.faff/runs/<run-id>/automation-verdicts.md` when invoked by `/faff-beep-boop` (full pipeline)
- `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` when tidy runs standalone

Other sub-skills (`/faff-wtf`, `/faff-beep-boop`) read this file rather than recomputing — but only within a single faff pass; across passes, always recompute (the "always pull fresh" rule wins, same logic as spec discovery). `/faff-wtf` invoked standalone (no preceding tidy this pass) computes verdicts inline using this same adaptor.

### Display format (consumed by `/faff-wtf` and `/faff-beep-boop`)

Renders via the `language_adaptor` slot → queue partition grid (form (c)). Compact form:

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

The synthesis gloss (gateway → Synthesis contract, owned by the `language_adaptor` slot) supplies the human-language description for every ID; the diagnosis lines ("Punt in spec: …", "recommend breaking …") follow the prose carve-outs from the rendering contract.

## Validate

**Checks:**

1. Exactly one verdict per spec-gated issue, drawn from the closed six.
2. The verdict is consistent with its inputs — e.g. `fire-and-forget` and `likely-fire` require `confidence: high` and no open markers; any spec below `confidence: high` is never build-admitted (a bare `confidence: medium` maps to `needs-decision-first`); `circular-blocked` requires a cycle finding from `backlog-diagnostics`; `repeat-parked` requires ≥3 same-root-cause parks.
3. `repeat-parked` carries no resolve-attempt (the pattern is the signal).

**Output:**

```
signal: pass | fail

## Violations
### [rule]: [where]
[what's wrong] → [the fix]
```

## Rules

- The six verdicts and the root-cause classes are both closed enums fixed in the gateway, not here. A new state is added there first, or not at all — never invented inline by this adaptor or a consumer.
- This adaptor assigns, renders, and validates the verdict; it does not own *detection* (cycles, ghost-projects, repeat-park patterns come from the methodology slot's `backlog-diagnostics`), the *vocabulary or admission rule* (fixed in the gateway), or *sequencing* (admission, resolve-attempt, park belong to beep-boop / workit).
