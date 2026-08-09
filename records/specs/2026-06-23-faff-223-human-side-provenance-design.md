# Spec: FAFF-223 — Human-side provenance from tracker gestures (no human CLI)

> Spec: producer faffter-dark-nlspec · 2026-06-23 · mode autonomous · confidence high. Full spec below.

This is the build spec for FAFF-223, the human-side half of the provenance family. Audience: the build agent implementing it, and the human reviewer gating the spec. It completes the provenance model so a human who creates a ticket directly in the tracker is never sent to a terminal to satisfy an intake gate.

## Already shipped against this surface

Related Done siblings in this project — context, **not** superseding (the human-gesture-as-intake-provenance delta is delivered by none of them):

- **FAFF-212** (Done) — the *machine*-side intake guard: `intakecheck` / `intakeVerdict`, the `.faff/provenance/<ISSUE>.json` marker, and `intake-record`. This ticket extends that exact seam with a label-derived basis + interactive bypass.
- **FAFF-218** (Done) — eligibility-label write-abstention (`faff-automate` is `tracker_owned`; the CLI refuses to mutate it). This is the **trust anchor** that makes basis #1 sound: a present `faff-automate` proves a human gesture by construction.
- **FAFF-125** (Done) — the mechanical eligibility gate (a *different* axis — "may auto-build?" vs intake's "entered through the front door?"). Untouched here.
- **FAFF-220** (Done — merged to main after this spec was drafted) — provenance schema 1→2 + the optional `initiated: interactive|autonomous` audit field on the marker, plus `--initiated` on `intake-record`. The human-gesture path composes forward with it (stays marker-absent-but-accepted; does not depend on `initiated`).

Premise still holds: the human-side gesture-as-intake-provenance is not delivered by any Done sibling. Proceed.

## 1. WHY — Problem and Principles

**Load-bearing model.** A write-abstained label is a trustworthy proof of a human action. After FAFF-218, the faff CLI *refuses* to write `faff-automate` — so the label's mere presence is admissible evidence that a human toggled it in the tracker UI. This spec turns that proof into a new, distinctly-named *intake-provenance basis*, and makes the intake gate stop hard-blocking the human at the keyboard.

**Problem statement.** Status quo: under `intake_gate: block`, a human who creates a ticket directly in the tracker has no creation hook, so faff offers only `faff intake-record <ISSUE> --via backfill` — a CLI gesture — to satisfy the gate. That turns a migration tool into a steady-state human ceremony, violating the zero-CLI-human-surface rule (FAFF-19). This change derives provenance from the human's existing tracker gesture (setting `faff-automate`) and stops interactive graft from blocking on intake at all.

**Design principles.**

- **Provenance burden stays machine-side; the human surface stays native-tracker, zero-CLI (FAFF-19).** Any remedy that requires the human to type a faff command is wrong by construction. The human's only act is a tracker gesture.
- **The two axes stay distinct.** Eligibility ("may auto-build?") and intake ("entered through the front door?") are separate. `faff-automate` is the eligibility gesture; admitting it as an *intake* basis must not merge the verdicts — it adds a new, distinctly-named basis so the audit trail stays legible (a reviewer can tell label-derived provenance from a jot marker).
- **The human at the keyboard is the sanction.** Interactive graft of a hand-created ticket must never route the human to a terminal — the same principle as interactive jot. `intake_gate: block` is meaningful only for *autonomous* graft.
- **Derive live; write nothing.** The human path writes no synthetic provenance marker — writing one would itself be a CLI/machine ceremony contradicting the zero-CLI principle. Provenance is derived live from the label at check time.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (dependency-free) | The CLI: `intakeVerdict`, `cmdIntakecheck`, `intakeGuidance`, selftest tables, label registry, USAGE |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | Step 2 intake-provenance precondition — the consumer that runs `intakecheck` in both modes |

**Scope statement.** This sits at the intake-provenance gate (FAFF-212's `intakecheck`/`intakeVerdict`), extending it with a label-derived basis and an interactive bypass; it is the human-side counterpart to FAFF-212 (agent intake) and FAFF-218 (write-abstention).

## 2. OUT OF SCOPE

- **FAFF-220 `initiated` field** — now merged to main (schema 2, `initiated` audit field, `--initiated` flag). The human-gesture path must not *depend* on it. **Forward-composition:** interactive-mode presence can independently stamp `initiated: interactive` at the marker level; this spec stays marker-absent-but-accepted and does not pre-empt it. No change to FAFF-220's machinery.
- **FAFF-217 creation-containment** — a separate epic for the agent-creation case; not touched here.
- **The eligibility model / `faff eligible`** — unchanged. This spec reads the `faff-automate` label as evidence; it does not alter how eligibility is computed.
- **Any new tracker-write by faff** — write-abstention (FAFF-218) is preserved. No code path here adds or removes a label or writes a provenance marker for the human path.
- **The `intake-record --via` enum and the no-downgrade guard** — unchanged. `backfill` the *mechanism* stays; only its documented audience changes (requirement #3).
- **A dedicated "human-sanctioned" write-abstained label** — explicitly not built. A human who wants provenance *without* automating is self-contradictory: not automated ⇒ no autonomous consumer ⇒ the intake gate never fires for that ticket. The case needs no mechanism.
- **git-only mode** — there are no labels in a git-only tracker, so neither eligibility nor this label-derived basis applies; both degrade exactly as the gateway already specifies. No new handling.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| intake provenance | Evidence a ticket entered through a sanctioned front door before it is auto-built |
| eligibility | Whether a ticket may be auto-built (the `faff-automate`/`faff-automation-hold` axis) — a *different* axis from intake |
| write-abstained label | A `tracker_owned: true` label the faff CLI refuses to mutate (FAFF-218); its presence proves a human tracker action |
| eligibility-gesture | The NEW intake-provenance basis: a human-set `faff-automate` admitted as intake evidence |
| interactive bypass | Under `--interactive`, an unsatisfied verdict in block-mode returns exit 0 (human is the sanction) instead of exit 3 |

**The new basis.** `intakeVerdict` gains one branch returning a distinctly-named basis. Naming it distinctly (not reusing `jot`/`backfill`) is what keeps the audit trail legible.

```
ENUM IntakeBasis:
  gate-off              # mode === "off"
  jot | backfill | fast_track   # recorded marker via
  grandfathered-label   # legacy faff-jot-intake label (warn)
  eligibility-gesture   # NEW: human-set faff-automate present, no marker
  no-provenance         # none of the above
```

**`intakeVerdict(marker, labels, mode)` — extended pure verdict.**

```
FUNCTION intakeVerdict(marker, labels, mode) -> { satisfied, basis, warn? }:
  IF mode === "off"               -> { satisfied: true, basis: "gate-off" }
  via = marker?.intake?.via
  IF via IN {jot, backfill, fast_track} -> { satisfied: true, basis: via }
  IF labels CONTAINS "faff-jot-intake"  -> { satisfied: true, basis: "grandfathered-label", warn: true }
  IF labels CONTAINS "faff-automate"    -> { satisfied: true, basis: "eligibility-gesture" }   # NEW
  -> { satisfied: false, basis: "no-provenance" }
```

**Decision — precedence of the new basis vs the grandfathered label.** A recorded marker (`jot`/`backfill`/`fast_track`) is the strongest signal and must win — keep it first. The `eligibility-gesture` branch goes *after* `grandfathered-label`: both are label-derived, but a ticket carrying `faff-jot-intake` is a genuine migration case that should surface its `warn`, whereas `eligibility-gesture` is a clean steady-state pass with no warn. Order does not change which tickets pass (the bases are not mutually exclusive in a way that flips `satisfied`), only which basis/warn is reported when both labels are present. **Chosen:** marker > grandfathered-label > eligibility-gesture — strongest-evidence-first, and the migration warn is preserved.

**Decision — does `eligibility-gesture` carry `warn`?** No. Unlike `grandfathered-label` (a spoofable legacy bridge that warrants a migration warning), a write-abstained `faff-automate` is a *trustworthy* proof by construction (FAFF-218). A clean pass, no warn. **Chosen:** `eligibility-gesture` is satisfied without `warn`.

**`cmdIntakecheck` — new `--interactive` flag.** A boolean flag (joins the existing boolean-flag handling in `parseIntakeArgs`, which already treats bare `--foo` as `true`). Under `--interactive`, an unsatisfied verdict that would exit 3 in block-mode instead prints a `[warn]`-style notice and exits 0.

```
faff intakecheck <issue> [--labels csv] [--interactive] [--json] [--root DIR]
```

**Decision — flag vs prose for the interactive bypass.** Putting the "human is the sanction" rule in graft prose would make it untested judgement. The CLI is the deterministic seam. **Chosen:** add `--interactive` to `intakecheck`; the bypass is mechanical and selftest-covered. Autonomous graft calls `intakecheck` *without* `--interactive` → unchanged block behaviour.

## 4. HOW — Behavior

**Architecture.** Three surgical changes, all at the existing intake seam, plus three prose/help rewrites. `intakeVerdict` already receives `labels` (graft and prep already pass `--labels`), so the new basis is a pure addition — no new fetch, no new tracker call.

**`cmdIntakecheck` exit logic with `--interactive`.** The interactive bypass applies only to the unsatisfied-under-block case; everything else is unchanged.

```
PROCEDURE cmdIntakecheck(args):
  IF "--selftest" IN args: return intakecheckSelftest()
  parse args -> { issue, flags }
  interactive = flags["--interactive"] === true
  ... existing: resolve root, labels, mode; read marker; v = intakeVerdict(...)
  ... existing json / satisfied / warn printing unchanged ...

  IF v.satisfied: return 0
  IF mode === "block":
     IF interactive:
        # human at the keyboard IS the sanction (parity with interactive jot)
        print "[warn] " + interactiveBypassNotice(issue, v.basis)
        return 0
     ELSE:
        print intakeGuidance(issue, v.basis)
        return 3
  # warn / off never block
  print "[warn] " + intakeGuidance(issue, v.basis)
  return 0
```

**Behaviour summary — the interactive notice.** A one-line `[warn]` telling the human that intake provenance is absent but the interactive session itself is the sanction, so the build proceeds. It must NOT instruct the human to run any CLI command (that would reintroduce the zero-CLI violation). A short notice; it may reuse `intakeGuidance`'s text *minus* the imperative remedies, or a dedicated one-liner.

```
PROCEDURE interactiveBypassNotice(issue, basis):
  return "{issue}: no intake provenance ({basis}), but interactive build — "
       + "the human at the keyboard is the sanction; proceeding."
```

**`intakeGuidance` rewrite (requirement #3).** Currently leads with `intake-record --via backfill` as the remedy for a "legacy backlog ticket". Per requirement #3, backfill is reframed as a migration / agent-orchestrator tool, NOT the documented human steady-state remedy. The human remedy becomes the tracker gesture.

```
PROCEDURE intakeGuidance(issue, basis):
  return
    "faff intakecheck: {issue} has no genuine intake provenance ({basis}). "
  + "New work must enter through the front door. "
  + "Human remedy (zero-CLI): set the faff-automate label on {issue} in the tracker — "
  + "a write-abstained human gesture that faff reads as intake provenance; "
  + "or capture a genuinely new idea via /faff-jot (no issue id). "
  + "(Migration / agent-orchestrator only: faff intake-record {issue} --via backfill "
  + "for bulk legacy backfill; --via fast-track --reason \"<why>\" for a recorded override. "
  + "Legacy faff-jot-intake-labelled tickets are grandfathered through with a warning.)"
```

**Decision — should the guidance text be eligibility-aware (only say "set faff-automate" on the eligible path)?** `intakeGuidance(issue, basis)` has no eligibility context in its signature, and threading it through would be a larger change for no gain: a not-eligible ticket has no autonomous consumer, so its intake gate never fires — the human never sees this guidance for a not-eligible ticket. Setting `faff-automate` is always the correct human steady-state remedy when the gate *does* fire. **Chosen:** keep the simple signature; state "set `faff-automate`" unconditionally. **Anti-pattern:** adding an `eligible` parameter to `intakeGuidance`. Why: the gate only fires on the eligible path, so the conditional would be dead.

**`faff-graft/SKILL.md` Step 2 rewrite (requirement #2).** Currently both modes run `intakecheck` identically and exit 3 blocks both. The new prose: interactive passes `--interactive` (never blocks, surfaces the notice, proceeds to Step 3); autonomous calls without `--interactive` (unchanged — exit 3 → `blocked` disposition). The interactive remedy list that pointed the human at `intake-record --via backfill` is removed; with `--interactive` there is no block to remedy.

```
PROCEDURE graft_step2_intake(issue, labels, interactive):
  mode = `faff config get intake_gate`
  IF interactive:
     run `faff intakecheck {issue} --labels "{csv}" --interactive`
     # exit always 0; surface any [warn] line, then proceed to Step 3
  ELSE:  # autonomous — unchanged
     run `faff intakecheck {issue} --labels "{csv}"`
     # exit 0 → proceed (surface [warn]); exit 3 → return `blocked` disposition, log cause, pre-worktree
  graft NEVER runs intake-record itself to self-satisfy the guard
```

**CLI USAGE help rewrite (requirement #3).** The `intakecheck` USAGE line gains `[--interactive]` and its semantics; the `intake-record` USAGE line reframes `--via backfill` as a migration / agent-orchestrator tool, not a human remedy.

**Failure modes.**

- **The failure:** the new basis silently over-collapses the two axes — a reviewer can no longer distinguish label-derived intake from a real front-door entry, eroding the audit trail. **How you'd know:** `intakecheck --json` returns `basis: "eligibility-gesture"` (distinct from `jot`/`backfill`); a selftest asserts the basis string. **What it means:** proceed — the distinct basis name is the mitigation, asserted by test.
- **The failure:** `--interactive` leaks into the autonomous path (e.g. graft passes it in both modes by mistake), neutering the autonomous block. **How you'd know:** the autonomous selftest case (`block`, no provenance, not interactive) would still exit 3; a code review of Step 2 confirms autonomous omits the flag. **What it means:** proceed — covered by selftest + the explicit two-call Step-2 structure.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a human-created ticket carrying a human-set faff-automate label and no provenance marker
When intakecheck runs under intake_gate: block
Then it exits 0 with basis "eligibility-gesture" and no [warn] (no CLI/backfill needed)
```

```
Given a hand-created ticket with no provenance marker and no faff-automate label
When interactive graft runs intakecheck --interactive under intake_gate: block
Then it exits 0 with a [warn] notice (human is the sanction) — the human is not sent to a terminal
```

```
Given the same no-provenance ticket
When autonomous graft runs intakecheck WITHOUT --interactive under intake_gate: block
Then it exits 3 (unchanged) and graft returns the `blocked` disposition
```

```
Given the documented remedies for a blocked human ticket
When a human reads intakeGuidance / the graft Step-2 prose / the CLI help
Then the documented human remedy is "set faff-automate in the tracker", and --via backfill is described as migration / agent-orchestrator only
```

## 6. DESIGN DECISION RATIONALE

**Does accepting `faff-automate`-as-provenance over-collapse the two axes 212/218 kept separate?**
- *Option A — merge eligibility into intake:* rejected; collapses the axes, illegible audit trail.
- *Option B — new distinctly-named intake basis:* admits the write-abstained label (trustworthy by FAFF-218) as a NEW basis while keeping eligibility and intake distinct.
- **Chosen:** Option B (`eligibility-gesture`). The axes stay distinct: eligibility = "may auto-build?", intake = "entered through the front door?". The intake gate only ever matters on the eligible path anyway (a not-eligible ticket has no autonomous consumer). The distinct name keeps the audit trail legible.

**Need a dedicated write-abstained "human-sanctioned" label?**
- **Chosen:** No. A human who wants provenance without automating is self-contradictory — not automated ⇒ no autonomous consumer ⇒ the intake gate never fires. The case needs no mechanism. Confirm and close.

**How does interactive graft stop hard-blocking?**
- *Option A — prose-only "interactive proceeds":* rejected; untested judgement in prose.
- *Option B — `--interactive` flag on intakecheck:* the bypass is mechanical and selftest-covered; the CLI stays the deterministic seam.
- **Chosen:** Option B. Under `--interactive`, unsatisfied-under-block returns exit 0 with a `[warn]` notice; autonomous (no flag) is unchanged.

**Composition with FAFF-220's `initiated` field.**
- **Chosen:** the human-gesture path does NOT depend on `initiated` (now merged to main). Stay marker-absent-but-accepted: derive provenance live from the label, write no synthetic marker. FAFF-220's interactive-presence stamp of `initiated: interactive` composes forward at the marker level; this spec neither blocks on nor pre-empts it. (Recorded as an Assumption / extension point.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all prep design questions resolved above.

**Assumes:**

- **FAFF-218 write-abstention is in force** — `faff-automate` is `tracker_owned: true` and the CLI refuses to mutate it, so its presence proves a human gesture. *Validate:* confirm `CONTROL_LABELS` entry for `faff-automate` has `tracker_owned: true` and `labelOp` reads the flag. **The `eligibility-gesture` basis is only sound because FAFF-218 makes the CLI write-abstain on `faff-automate`** — if FAFF-218 ever regressed, this basis would become agent-spoofable (the FAFF-209 failure the marker was built to close). State this trust dependency in the HOW for the next reader.
- **FAFF-220 `initiated` field exists on main** — schema 2 + `--initiated`. The human path must not *reference* or depend on it; it stays marker-absent-but-accepted, composing forward.
- **Graft and prep already pass `--labels` to `intakecheck`** — the new basis needs no new fetch. *Validate:* confirmed graft Step 2 passes `--labels`; the new branch only reads the already-injected `labels`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A human-created ticket with a human-set `faff-automate` and no marker passes `intakecheck` with no CLI/backfill (exit 0).
- [ ] No new tracker-write and no synthetic provenance marker is written for the human path (write-abstention preserved).

### From WHAT (types and interfaces)
- [ ] `intakeVerdict` returns `{ satisfied: true, basis: "eligibility-gesture" }` (no `warn`) when `labels` contains `faff-automate` and there is no marker.
- [ ] Basis precedence is marker > `grandfathered-label` > `eligibility-gesture` (a recorded marker still wins; `faff-jot-intake` still surfaces its warn).
- [ ] `cmdIntakecheck` accepts a boolean `--interactive` flag.

### From HOW (behaviour)
- [ ] `intakecheck --interactive` exits 0 (not 3) under `intake_gate: block` with no provenance, printing a `[warn]`-style notice.
- [ ] The interactive notice contains no instruction to run any faff CLI command.
- [ ] Autonomous `intakecheck` (no `--interactive`) still exits 3 under `block` with no provenance.
- [ ] `intakeGuidance` text names "set `faff-automate` in the tracker" as the human remedy and frames `--via backfill` as migration / agent-orchestrator only.
- [ ] `faff-graft/SKILL.md` Step 2: interactive passes `--interactive` and never sends the human to a terminal; autonomous omits the flag and still returns `blocked` on exit 3; the old interactive `intake-record --via backfill` remedy is removed.
- [ ] The CLI USAGE line for `intakecheck` documents `--interactive`; the `intake-record` USAGE line reframes `--via backfill` as migration/agent-orchestrator.

### From HOW (selftest)
- [ ] `INTAKECHECK_SELFTEST_CASES` gains a case for `[null, ["faff-automate"], "block", { satisfied: true, basis: "eligibility-gesture", exit: 0 }]`.
- [ ] A selftest case asserts the interactive-exit-0-under-block path **paired against** the same case without `--interactive` still yielding exit 3. Extend `intakeExit`/the table to take an `interactive` dimension.
- [ ] `faff intakecheck --selftest` passes (exit 0) with the extended table.

### Unchanged (regression guards)
- [ ] The `intake-record --via` enum and the no-downgrade guard are unchanged (backfill the mechanism stays).
- [ ] `faff intake-record --selftest` still passes.

**Integration smoke test.**

```
1. In a repo with intake_gate: block, create no provenance marker for FAFF-XXX.
2. faff intakecheck FAFF-XXX --labels "faff-automate"          -> exit 0, basis=eligibility-gesture
3. faff intakecheck FAFF-XXX --labels ""                        -> exit 3 (autonomous block)
4. faff intakecheck FAFF-XXX --labels "" --interactive          -> exit 0, [warn] notice
5. faff intakecheck --selftest                                  -> RESULT: PASS
```

confidence: high
