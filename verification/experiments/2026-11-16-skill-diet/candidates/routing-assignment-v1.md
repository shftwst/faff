---
name: faffidavit-routing
description: "Default routing_adaptor slot: assign and render automation verdicts from diagnostics, confidence, markers and park history; validate assignments."
user-invocable: false
judgement_seam: routing
---

# faffidavit-routing

Default `routing_adaptor`: assign automation-routing verdicts, render them, and validate assignments on demand.

## Fixed contract and ownership

The gateway fixes the six verdicts, closed root-cause classes and build-queue admission rule. Canonical semantics: `faff contract automation-routing --describe`. Only `fire-and-forget` and `likely-fire` enter the build queue; surface every other issue with a one-line reason in wtf, never silently drop it. Add any new state to the gateway first; never invent one inline.

This adaptor owns assignment and display. The methodology's `backlog-diagnostics` owns detection (cycles, ghost projects and repeat-park patterns); beep-boop/graft own admission, resolve-attempts and parking. Swapping the adaptor never changes the fixed vocabulary or admission rule.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-tidy` / `/faff-beep-boop` / `/faff-wtf` read the gateway on entry), so when you run as the `routing_adaptor` slot it is already in context. If you are invoked **standalone** ("why wouldn't SHF-123 fire?"), **Read the sibling `faff/references/kernel.md` (the shared kernel) → _Core contracts and adaptor slots → Automation-routing verdict_ now**, together with the lane references routing consumes — `faff/references/autonomous.md` (Resolve-attempt before park), `faff/references/methodology.md` (the methodology slot), `faff/references/review.md` (Producer slots vs adaptor slots), and `faff/references/park.md` (Park protocol) — before assigning. Refer back to it; never treat the recap below as the source of truth.

## The six verdicts (non-normative recap for assignment)

The adaptor assigns exactly one per Todo issue with a discoverable spec. The authoritative definition is the gateway's; this table is a **non-normative** recap for assignment (gateway wins on any conflict). The columns this adaptor owns are the *assignment conditions* and *consumer behaviour*; the verdict names and their meaning are the gateway's:

| Verdict | Definition | What `/faff-beep-boop` does |
|---|---|---|
| `fire-and-forget` | Spec `confidence: high`, no **blocking** open Punt (per `faff punt-scan`, `blocking_open_count == 0`), no Assumes markers, no in-queue blocker, conflict analysis says independent, no repeat-park history | Builds in next autonomous run, parallel-safe |
| `likely-fire` | Spec `confidence: high` but in a collision group with other in-queue work | Builds in next autonomous run, serialised within its group |
| `needs-decision-first` | Spec contains an explicit, **not** spec-closed marker — a **blocking** open `Punt:` / `needs human` / `TBD` / "or X if Y" — **or** the spec carries `confidence: medium` (the retained rating is itself the human-call signal — thin rationale or open punts). The adaptor runs `faff punt-scan` and reads its structured output (`blocking_open_count`); the Punt leg fires only on a blocking open Punt (`eligible == false`), never on an eligible non-blocking one, and it reads that eligibility from `punt-scan` rather than re-reading the `(non-blocking)` tag prose itself. `faff punt-scan` covers only `**Punt:**` lines, so the non-Punt-line markers (`needs human` / `TBD` / "or X if Y") are still scanned as before — the leg fires on any such un-spec-closed marker too, exactly as the spec's `assign_verdict` disjunction specifies. The `confidence: medium` leg is unchanged. | Bounded resolve-attempt (gateway → **Resolve-attempt before park**); on failure, parks through the gateway **Park protocol (shared)** — root cause `punt-not-closed`, a short reason line naming the Punt + its `decides:` owner. This adaptor does not duplicate that label/comment/record procedure. |
| `gap-blocked` | Spec assumes external state (tracker issue, project, dep) that doesn't exist | Resolve-attempt; if it fails, skipped and surfaced with the named gap |
| `circular-blocked` | Issue sits in a dep cycle detected by the methodology slot's `backlog-diagnostics` | Resolve-attempt; if it fails, skipped and surfaced with the cycle visualised |
| `repeat-parked` | Parked 3+ times in autonomous runs with the same root-cause class | **Skipped — no resolve-attempt.** The pattern itself is the signal that a human needs to act. Surfaced prominently in wtf. |

Conflict analysis determines collision-group serialisation: use `likely-fire` precisely when it will serialise the issue, so the brief distinguishes parallel work from work queued behind a predecessor.

## Assignment and per-pass storage

For each Todo issue with a discoverable spec, assign exactly one verdict from its confidence, markers, `backlog-diagnostics` and park history. `/faff-tidy` computes this in its backlog-diagnostics phase; standalone invocation explains why an issue would or would not fire.

Tidy's per-pass verdict file is:

- `.faff/runs/<run-id>/automation-verdicts.md` inside the full `/faff-beep-boop` pipeline.
- `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` for standalone tidy.

Wtf and beep-boop reuse that file only within the same pass. Recompute across passes under Always pull fresh. Standalone wtf with no preceding tidy computes inline through this adaptor.

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

## Validate — wired to the contract script

Assign the verdict and root cause from the issue inputs, then emit extraction JSON:

```
{ "verdict": "<one of the closed six>", "root_cause": "<one of the five, or null>" }
```

Input consistency remains this adaptor's judgement: high confidence for `fire-and-forget`, a cycle finding for `circular-blocked`, and at least three same-root-cause parks for `repeat-parked`. The contract CLI checks shape, not whether those inputs support the assigned verdict.

`faff contract automation-routing` is the **sole source of contract data**. Pipe the extraction to it; never build contract data or decide `conformant` / `violations` yourself. This delegation is checked by `faff validate-adapters`.

```
echo '<extraction JSON>' | faff contract automation-routing
```

| Script exit | Meaning |
|---|---|
| 0 | conformant: `conformant:true`, `violations:[]` (the script's stdout) |
| 1 | non-conformant (e.g. an out-of-enum `root_cause` normalised to null): `violations` name the cause |
| 2 | fail-loud: `verdict` ∉ the closed six, or the extraction is unparseable / not an object |

An invalid verdict fails loud rather than being coerced: it is an assignment bug. An invalid root cause becomes `null` with a violation. Return the script's stdout verbatim.

Build-queue admission and `repeat-parked`'s no-resolve-attempt rule remain gateway/beep-boop semantics; the validator encodes neither.
