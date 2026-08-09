# Intake-Provenance Guard (FAFF-212) — Design Spec

> Spec: faffter-dark-nlspec · 2026-06-22 · interactive · confidence: medium. Full spec on Linear FAFF-212.

A faff-native mechanism that makes "new work entered through the front door" a **deterministic, checkable fact** rather than a prose convention. Audience: the build agent, and human reviewers weighing the enforcement-policy call.

## 1. WHY

**Load-bearing model:** today the only signal a ticket came through `/faff-jot` is the `faff-jot-intake` label — agent-applied, so an agent can stamp it without running intake (FAFF-209). This replaces "trust the label" with a **CLI-written provenance marker** under `.faff/` plus a **graft-time precondition** that reads it. Provenance becomes a side effect of *running the flow*, not a sticker.

**Principles:**
- **Guardrail, not cryptographic control.** Threat model = accidental drift past the front door, not an adversary forging provenance. A local agent can always write a marker — acceptable, because doing so is a deliberate, recorded, *visible* act. We make bypass loud, not impossible.
- **Enforce where the ticket is known** — at `/faff-graft` start (issue ID in hand), never as a global Stop-hook (that is FAFF-205: turn-end hooks with no "which ticket" signal false-block unrelated sessions).
- **Migration before enforcement** — the whole backlog predates the marker; default non-blocking + grandfather the legacy label, or it bricks every ticket on day one.

**Reference:** mirrors `prepcheck` (`.faff/prep/<ISSUE>.json` per-issue marker, `isPrepMarkerOpen`, `--selftest`, `disposition` suppressor — bin/faff ~:750–850); `cmdLabel` descriptor shape (~:1608); deliberately does **not** join `FAFF_STOP_HOOKS` (~:860). Touch points: faff-jot Step 4 (~:75), faff-graft prep-gate (~:87–94).

## 2. OUT OF SCOPE
- **Global `intakecheck --hook`** — reintroduces FAFF-205. Extension: `FAFF_STOP_HOOKS`, only once a per-session graft-in-progress marker exists.
- **Cryptographic provenance** — local-trust can't deliver; threat is drift not forgery.
- **Gating the spec/prep stage** — already covered by graft prep-gate + prepcheck; marker reserves a `prep` block for observability only.
- **Auto-creating intake for a bare ticket** — intake is human-gated; guard refuses/warns, never manufactures provenance.

## 3. WHAT

| Term | Definition |
|---|---|
| Intake provenance | Evidence a ticket entered via `/faff-jot` (or a recorded override), vs the spoofable label |
| Provenance marker | CLI-written `.faff/provenance/<ISSUE>.json` |
| Grandfathered | Legacy ticket: no marker but `faff-jot-intake` label → passed during migration |
| Fast-track | Recorded, reasoned override for a legitimate bypass |

**Marker** — `.faff/provenance/<ISSUE-ID>.json`:
```
RECORD ProvenanceMarker:
  schema: int                 # = 1
  issue:  string
  intake: IntakeRecord
  prep:   PrepRecord?         # reserved, observability only — NOT gated in v1
RECORD IntakeRecord:
  via:    enum { jot, backfill, fast_track }
  ts:     ISO-8601
  reason: string?             # REQUIRED when via == fast_track
  CONSTRAINT (via == fast_track) IMPLIES (reason non-empty)
```

**Config knob:** `intake_gate: warn | block | off`  (default `warn`) — a mechanism value, like `automation_default`/`adr.mode`, not a prose pref (see §6 Q5).

**CLI:**
```
faff intake-record <ISSUE> [--via jot|backfill|fast-track] [--reason "<text>"] [--json]
faff intakecheck   <ISSUE> [--labels <csv>] [--json] [--selftest]
    # exit 0 satisfied · 3 unsatisfied(block) · 2 usage/malformed. --labels passed in (no tracker call).
```

**Decision — marker dir:** **Chosen:** `.faff/provenance/<ISSUE>.json` (clean per-issue namespace parallel to `.faff/prep/`, no collision with jot's existing `.faff/intake/<date>-<slug>.md` logs).
**Decision — verdict source:** **Chosen:** marker-plus-label fallback (marker → satisfied; no marker but label → grandfathered+warn; neither → unsatisfied) — the spoofable label is the *migration bridge*, not trusted forever.

## 4. HOW

```
PROCEDURE intakeVerdict(marker, labels, mode):
  1. IF mode=="off": RETURN {satisfied:true, basis:"gate-off"}
  2. IF marker.intake.via in {jot,backfill,fast_track}: RETURN {satisfied:true, basis:via}
  3. IF labels has "faff-jot-intake": RETURN {satisfied:true, basis:"grandfathered-label", warn:true}
  4. RETURN {satisfied:false, basis:"no-provenance"}

PROCEDURE cmdIntakecheck(issue, labels, mode):
  marker := readProvenanceMarker(issue)        # null if absent/malformed
  v := intakeVerdict(marker, labels, mode)
  satisfied & !warn → exit 0 · satisfied & warn → print warn, exit 0
  unsatisfied & mode=="warn"  → print guidance, exit 0   # WARN NEVER BLOCKS
  unsatisfied & mode=="block" → print guidance, exit 3

PROCEDURE cmdIntakeRecord(issue, via, reason):
  IF via==fast_track & reason empty: exit 2 (write nothing)
  marker.intake := {via, ts:now(), reason if fast_track}; write; emit faff-contract:intake-record

GRAFT precondition (Step ~1, before worktree):
  mode := faff config get intake_gate
  faff intakecheck <issue> --labels <already-fetched labels>
  exit 0 → proceed (surface warn) · exit 3 → interactive STOP (jot/crank-up/fast-track), autonomous return `blocked`
  (NEVER auto-record provenance to self-satisfy)

JOT Step 4: after `faff label add <issue> faff-jot-intake` → `faff intake-record <issue> --via jot`
```

**Fallback chain:** malformed marker → treat as absent + `[warn]`, never crash · `intake:null` → absent for gating · unset `intake_gate` → `warn` · tracker-less → `--labels ""`, marker-only.

**Anti-pattern:** registering `intakecheck --hook` in `FAFF_STOP_HOOKS`. Why: no per-session "which ticket" → audits whole backlog every turn-end → FAFF-205 reintroduced.
**Anti-pattern:** graft auto-running `intake-record` to pass its own check. Why: turns the guard into a no-op.

**Failure modes:** (1) marker is trivially writable → guard changes nothing. *Know:* `fast_track`/bare `jot` markers with no `/faff-jot` log. *Means:* proceed — recorded override is the audit trail (guardrail not control). (2) `warn` ignored by everyone. *Know:* count graft-starts with `no-provenance` warnings. *Means:* the §7 rollout punt — flip default to `block`.

## 5. SCENARIOS
```
Given a raw-tracker-write ticket (no jot), intake_gate=block · When graft starts · Then intakecheck exit 3, graft refuses, points at /faff-jot or fast-track
Given a legacy faff-jot-intake-labelled ticket, no marker, block · When graft starts · Then exit 0 basis grandfathered-label + warning (legacy not bricked)
Given jot created + intake-record --via jot · When graft starts · Then marker exists, exit 0 basis jot, no warning
Given fast-track recorded with --reason "prod outage" · When graft starts · Then exit 0 basis fast_track, reason on marker
Given intake-record --via fast-track with no --reason · Then exit 2, no marker written
```
Non-functional: `intakecheck`/`intake-record` make **zero** tracker/network calls (pure fns + injected fs + `--labels`); `intakeVerdict` has a `--selftest` table for all four bases + warn-never-blocks.

## 6. DESIGN DECISION RATIONALE
- **Q1 provenance signal** — **Chosen:** CLI-written marker via `faff intake-record` (jot calls it). Honest caveat: locally writable → guardrail-against-drift made auditable by `via`/`reason`, not a control. Rejected: trusting the label (the FAFF-209 failure).
- **Q2 enforcement point** — **Chosen:** graft precondition only (ticket known → scoped). Rejected/deferred: a Stop-hook (FAFF-205 false-blocks) unless a per-session marker is built first.
- **Q3 override** — **Chosen:** `intake-record --via fast-track --reason "…"` (reason mandatory) — recorded > silent-routed-around. Mirrors prepcheck `disposition`.
- **Q4 scope** — **Chosen:** intake only; spec stage already covered by prep-gate + prepcheck. Marker reserves `prep` for observability.
- **Q5 faffrc tension** — **Chosen:** one mechanism value `intake_gate`, not a prose pref. Boundary: **config values govern mechanisms; they don't store what the user said they like** (`automation_default`/`adr.mode`/`concurrency_max` are the same category). No key encodes a preference.
- **Q-migration** — **Chosen:** default `warn` + label grandfather bridge + `intake-record --via backfill`. Rationale: backlog predates the marker; block-on-day-one halts in-flight work.

## 7. OPEN QUESTIONS & ASSUMPTIONS
**Punt: rollout policy** — when (if ever) does `intake_gate` default move `warn`→`block`, and is there a dated cutoff after which unmarked+unlabelled tickets stop being grandfathered? Maintainer judgement (too eager disrupts the backlog; never flipping makes the guard advisory). Decide after observing warn-mode `no-provenance` counts. *(This keeps the spec at medium.)*

**Assumes:** `faff config get intake_gate` returns `warn` when unset (FAFF-182 default-aware pattern). *Validate:* check before relying on it in graft.
**Assumes:** `/faff-graft` already fetches the ticket's labels in its opening (so `--labels` needs no new tracker call). *Validate:* check faff-graft Step 1–2; if not, fetch once for the precondition.

## 8. DONE
**WHY** — [ ] a ticket created outside `/faff-jot` is detectable at graft-time (not via the spoofable label).
**WHAT** — [ ] marker matches `ProvenanceMarker` schema · [ ] `intake-record` writes/updates it; `--via fast-track` w/o `--reason` exits 2, writes nothing · [ ] emits `faff-contract:intake-record` descriptor · [ ] `intake_gate` resolves `warn` when unset.
**HOW** — [ ] `intakeVerdict` returns the four bases · [ ] `intakecheck` exits 0/3(block-only)/2 correctly · [ ] `warn` never non-zero, `off` always 0 · [ ] malformed marker → absent + `[warn]`, no crash · [ ] graft runs precondition pre-worktree, refuses(interactive)/`blocked`(autonomous), never self-records · [ ] jot Step 4 calls `intake-record --via jot`.
**Edge** — [ ] tracker-less `--labels ""` gates on marker alone · [ ] zero tracker/network calls.
**Migration** — [ ] legacy labelled+markerless ticket passes (grandfathered+warn) · [ ] `--via backfill` stamps a legacy ticket.
**Tests** — [ ] `intakecheck --selftest` covers four bases + warn-never-blocks + malformed, zero live calls · [ ] `hooks-ensure --selftest` unchanged (no Stop-hook added).

**Smoke:**
```
1. faff intake-record FAFF-TEST --via jot
2. faff intakecheck FAFF-TEST                              → exit 0, basis jot
3. rm .faff/provenance/FAFF-TEST.json
4. faff intakecheck FAFF-TEST --labels "faff-jot-intake"  → exit 0, basis grandfathered-label, warn
5. faff intakecheck FAFF-TEST --labels "" (gate=block)    → exit 3
```

confidence: medium
