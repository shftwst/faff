---
name: faffidavit-routing
description: "Default `routing_adaptor` — assigns the automation-routing verdict to a spec-gated issue (from diagnostics + confidence + markers + park history), renders it, and validates assignments. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: routing
---

# faffidavit-routing

The default **adaptor** for the `routing_adaptor` slot. It **assigns** an automation-routing verdict to a spec-gated issue — from `backlog-diagnostics` findings + spec confidence + markers + park history — renders the verdicts consumers display, and **validates** an assignment on demand. A `faffidavit-*` skill: it both *defines* its assignment/display dialect and *checks* conformance.

```yaml
slots:
  routing_adaptor: faffidavit-routing   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The automation-routing contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Automation-routing verdict_), **not** here. Fixed there, and unaffected by swapping this slot:

- the closed six-verdict vocabulary and the root-cause class enum shared by repeat-park detection and the calibration log — canonical semantics: `faff contract automation-routing --describe`,
- the **build-queue admission rule** — only the two build-ready verdicts ever enter the queue; all others route out with a one-line reason surfaced in wtf, never silently dropped.

These are the stable boundary between the `methodology` slot and three consumers — `/faff-beep-boop`'s admission gate, `/faff-wtf`'s morning brief, `/faff-graft`'s park logic. Whatever methodology detects the backlog problems, the verdict words that gate admission stay fixed in the gateway. This skill does not get to change them. What it owns is *assignment + display* — how an issue is mapped onto a verdict, and how verdicts are rendered.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-tidy` / `/faff-beep-boop` / `/faff-wtf` read the gateway on entry), so when you run as the `routing_adaptor` slot it is already in context. If you are invoked **standalone** ("why wouldn't SHF-123 fire?"), **Read the sibling `faff/SKILL.md` → _Core contracts and adaptor slots → Automation-routing verdict_ now** before assigning. Refer back to it; never treat the recap below as the source of truth.

## The six verdicts (non-normative recap for assignment)

The adaptor assigns exactly one per Todo issue with a discoverable spec. The authoritative definition is the gateway's; this table is a **non-normative** recap for assignment (gateway wins on any conflict). The columns this adaptor owns are the *assignment conditions* and *consumer behaviour*; the verdict names and their meaning are the gateway's:

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

Renders via the `rendering_adaptor` slot → queue partition grid (form (c)). Compact form:

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

The synthesis gloss (gateway → **Rendering → `rendering_adaptor`**, synthesis gloss) supplies the human-language description for every ID; the diagnosis lines ("Punt in spec: …", "recommend breaking …") follow the prose carve-outs from the rendering contract.

## Validate — wired to the contract script (FAFF-80)

Validation is **conformance by construction** (FAFF-21): this adaptor does **not** prose-check the verdict's *shape*. It **extracts** the assigned verdict into a structured candidate, hands that to the deterministic **contract script**, and returns the script's output. **The contract script `faff contract automation-routing` is the sole source of contract data** — this adaptor never builds the contract data itself, never decides `conformant` / `violations`. That delegation is what `faff validate-adapters` checks (the wiring-check).

**The split:**

- **This adaptor (assignment — the judgement, see Assignment above):** assigns the verdict + root-cause from the issue's inputs (spec confidence + markers + `backlog-diagnostics` + park history), then emits the **extraction JSON** —
  ```
  { "verdict": "<one of the closed six>", "root_cause": "<one of the five, or null>" }
  ```
  Assigning *which* verdict an issue's inputs imply (e.g. `fire-and-forget` requires `confidence: high`; `circular-blocked` requires a cycle finding; `repeat-parked` requires ≥3 same-root-cause parks) remains the adaptor's assignment judgement — it is *input-consistency*, not *shape*.
- **The contract script (shape conformance — deterministic):** validates `verdict` against the closed six and **fails loud** when it isn't one (no safe coerce target — the verdict is *assigned*, not received from a foreign producer, so an out-of-enum verdict is an assignment bug, like spec-readiness); validates `root_cause` against the closed five (a bad one is normalised to `null` + a violation); emits the canonical contract data.

**Invocation + signal mapping:**

```
echo '<extraction JSON>' | faff contract automation-routing
```

| Script exit | Meaning |
|---|---|
| 0 | conformant: `conformant:true`, `violations:[]` (the script's stdout) |
| 1 | non-conformant (e.g. an out-of-enum `root_cause` normalised to null): `violations` name the cause |
| 2 | fail-loud: `verdict` ∉ the closed six, or the extraction is unparseable / not an object |

The contract data consumers read is **the script's stdout, verbatim**. The **build-queue admission rule** (only `fire-and-forget` + `likely-fire` are admitted; the other four route out) and `repeat-parked`'s no-resolve-attempt rule are **gateway / beep-boop semantics** — the script encodes neither.

## Rules

- The six verdicts and the root-cause classes are both closed enums fixed in the gateway, not here. A new state is added there first, or not at all — never invented inline by this adaptor or a consumer.
- This adaptor assigns, renders, and validates the verdict; it does not own *detection* (cycles, ghost-projects, repeat-park patterns come from the methodology slot's `backlog-diagnostics`), the *vocabulary or admission rule* (fixed in the gateway), or *sequencing* (admission, resolve-attempt, park belong to beep-boop / graft).
