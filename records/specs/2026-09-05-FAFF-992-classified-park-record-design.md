# Scoped classified park record and prevention boundary (FAFF-992)

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-992.

> Refreshed 2026-09-04 — dropped the stale FAFF-927 coordination (the `blockedBy FAFF-927` edge was spurious: FAFF-927 edits `review-call.mjs`, never `park.md`, and has been removed). This ticket now owns the park-versus-hold boundary prose solely; its only dependency is FAFF-900 (Done, #771). Non-substantive to the approach; the `spec-review: approve` verdict is retained.

## Preamble

FAFF-992 is the classification-and-prevention half of the FAFF-991 umbrella (autonomous re-entry for a lights-out `needs-human` park). It ships three things and nothing more: the reconsider axis and cited-input reference on the park record (the `faff-parks` wire format and the git-only prep marker), faff-prep writing them at park time, and the park-versus-hold boundary prose plus the LLM-classification grader that gates the sibling ticket's autonomous re-open. The resume-time reconsider, the shared unpark contract, and every consumer of the classified record are FAFF-993 (named in section 2). This spec is written for the build agent and for the L4 spec-review lenses.

Every file reference, line behaviour, and enum below was verified against the current tree under `plugin/skills/faff/**`, `plugin/skills/faff-prep/SKILL.md`, and `eval/**`. The installed `~/.claude/skills` copies are stale and were not consulted.

---

## 1. WHY

**The load-bearing model.** A park is a promise that a human will make a call. Some parks name a genuine human call (scope, taste, architecture); others were forced by a machine-fixable condition (a truncated review config, a backend that was down) and only look like human calls. FAFF-991 splits parks by whether their cause is machine-checkable so a later pass can recover the machine ones. That split needs a place to live on the park record before anything can read it. FAFF-992 is that record: a classified, machine-readable park that carries whether its cause is machine-checkable and, when it is, the exact external input the cause cited.

**Problem statement.** Today every park record is `{issue_id, root_cause_class, timestamp}` with `root_cause_class` in a closed five, and it carries no signal for whether the cause was a human judgment call or a machine-fixable condition. Without that signal, no downstream pass can tell a scope park (never auto-recoverable) from a config-fault park (recoverable once the config changes), so FAFF-993's autonomous re-open has nothing safe to read. FAFF-992 adds the signal and the grader that keeps it honest.

**Design principle (rejects an implementation): a human-judgment park is never marked machine.** The reconsider disposition is `human` unless the classifier can positively prove the cause is machine-checkable and name the specific external input it cited. A scope, taste, or architecture park, or any cause the classifier could not prove machine-checkable, is `human`. An implementation that defaults an unclassified or ambiguous park to `machine`, or that widens the machine class to a whole cause-class label without a cited input, violates this and must be rejected: in doubt, the park is `human`.

**Design principle (rejects an implementation): the reconsider axis is orthogonal to the closed five root-cause classes.** `root_cause_class` drives repeat-park counting in `park-history.js` (`computeParkHistory`, the twenty-one-day window and the three-same-class threshold) and must stay closed at five. An implementation that encodes the machine-versus-human distinction by adding a sixth root-cause class widens that enum and breaks the counting window; it must be rejected. The distinction is a separate `reconsider` field plus a cited-input reference.

**Design principle (rejects an implementation): the record stays byte-compatible with the existing readers.** `park-history.js`'s `computeParkHistory` reads only `issue_id`, `root_cause_class`, `timestamp`; `prepcheck.js`'s `classifyPrepIssue` reads only `disposition`, `spec_produced`, `attached`, `owner`, `ts`. The new fields are added so both readers ignore them for free. An implementation that changes what those readers key on, or that makes the existing `park-history` or `prepcheck --selftest` fail, violates this and must be rejected.

### Reference-context: files this slice touches

| File | What it does today | What FAFF-992 changes |
|---|---|---|
| `plugin/skills/faff/bin/lib/park-history.js` | `ROOT_CAUSE_CLASSES` closed at five (lines 31 to 33); `addParkRecord` / `renderParksBlock` own the `faff-parks` wire format; `computeParkHistory` reads `issue_id` / `root_cause_class` / `timestamp` only | Adds `reconsider` and `cited_input` to the park record; the five-class enum and the counting reader are unchanged |
| `plugin/skills/faff/bin/lib/prepcheck.js` | `classifyPrepIssue` reads named keys and ignores unknown ones (lines 205 to 227); marker records `owner.run_dir` | Tolerates a new `park` sub-object under `disposition:"parked"`; `classifyPrepIssue` stays byte-compatible; a new selftest case asserts a park-bearing marker still classifies `parked` |
| `plugin/skills/faff/references/park.md` | Park protocol step 3 appends `{issue_id, root_cause_class, timestamp}` from the routing_adaptor's assigned class; no machine-versus-human axis; no park-versus-hold boundary | Records the reconsider disposition and cited-input at park time; adds the park-versus-hold boundary prose |
| `plugin/skills/faff-prep/SKILL.md` | Scenario A `low` → park and Scenario B `park` record `disposition:"parked"` on the marker and log the cause | The same park-time write also records the `ParkCause` and captures the cited-input fingerprint |
| `eval/seam-registry.json` | KIND → surface SSOT (its `_comment` says thirty-four KINDs); read by `eval/grader.mjs` and `faff validate-adapters` | Adds the `park-reconsider-classification` KIND row (surface `faff-prep`); the count moves to thirty-five |
| `eval/grader.mjs` | `KINDS` enum array (line 253) + `CLOSED_SET_KINDS` (line 254); `assertRegistryConsistent` (lines 293 to 303) fails loud unless `Object.keys(registry.kinds) === KINDS` | Adds `park-reconsider-classification` to **both** `KINDS` and `CLOSED_SET_KINDS` in one edit |
| `eval/cases/` | One JSON per grader case (`{id, kind, fixture, question, oracle}`) | Adds `park-reconsider-classification-NNN.json` cases: `human` for scope/taste/architecture, `machine` for the reproduced config-fault |

**Scope statement.** FAFF-992 extends the park record with an orthogonal reconsider axis plus a cited-input reference, makes faff-prep write both at park time, states the park-versus-hold boundary in `park.md`, and registers the grader that gates FAFF-993's autonomous re-open. It adds no operator command, no resume behaviour, and no unpark path.

---

## 2. OUT OF SCOPE

**The FAFF-993 pieces (Ticket 2 of the split, `blockedBy` this ticket).** FAFF-992 produces the classified record and the grader; FAFF-993 consumes them. These belong to FAFF-993, not here:

| FAFF-993 piece | One-line description |
|---|---|
| `classifyReEntry` pure core | The resume-time re-entry decision (input-changed versus fail-closed reasons) |
| `apply_git_only_unpark` helper | The shared git-only unpark write (clear ledger outcome, clear marker, append event) |
| `faff park-reconsider` verb | The internal compute verb and its `cli-surface.js` surface registration |
| `resumeLightsOut` reconsider pass | The autonomous seam that re-queues reconsiderable parks at resume |
| Interactive `/faff-prep` re-invoke unpark | The interactive seam's git-only disposition clear |
| `park-reconsidered` event | The run-scoped unpark-log event in `governance-profile.js` |
| `reconstructResumePlan` reconsider bucket | Routing an admitted mid-run `parked` outcome away from `plan.terminal` |

The grader registered here is a hard gate on FAFF-993's autonomous re-open: FAFF-993 must not ship its autonomous seam until this grader passes. FAFF-992 states that dependency; the gate wiring on the autonomous seam is FAFF-993's.

**Backend and multi-file cited inputs (bear on the shipped schema).** The `CitedInput.kind` enum ships both `config-file` and `backend`, but only `config-file` is fingerprintable as content. A `backend` cited input, and any cause that cites several files or an environment variable, have no single-`ref` content fingerprint; how their change is detected is FAFF-993/architecture's call. FAFF-992's schema carries the `backend` enum value so the record can name a backend cause, but a cause that is not a single fingerprintable config file is recorded `reconsider: "human"` until that detection mechanism is decided (section 7). This bears on the schema because it fixes the shape (`ref` + `fingerprint`, single file) the classifier is allowed to mark `machine`.

---

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Reconsider disposition | A field on a park record: `machine` (the cited input is machine-checkable and a later pass may reconsider it) or `human` (a scope, taste, or architecture call that never auto-reconsiders) |
| Cited external input | The specific external thing a `machine` park depends on: a config file (with the keys the fault cited) or a backend reference, plus a content fingerprint captured at park time |
| In-turn-recoverable | A machine cause a bounded in-turn retry can clear this turn (a transient backend blip); the prevention boundary routes it to a hold, never a park |
| Elapsed-input-change | A machine cause only an external change over elapsed operator time can clear (a config edit); stays a park, recorded `reconsider: "machine"` with a cited input |
| Park-versus-hold boundary | The `park.md` rule deciding whether a machine cause becomes a hold (in-turn-recoverable) or a park (elapsed-input-change or human) |
| Park-time classification | The existing step that assigns `root_cause_class` at park time (the routing_adaptor's assignment, recorded by faff-prep); FAFF-992 extends it to also assign `reconsider` and capture the cited input |

### The park record (extended)

The `faff-parks` wire format in `park-history.js` is `{issue_id, root_cause_class, timestamp}` with `root_cause_class` in the closed five `punt-not-closed | gap | cycle | spec-ambiguous-external | other`. FAFF-992 adds an orthogonal reconsider axis and a cited-input reference. The `root_cause_class` enum stays closed at five (it drives repeat-park counting and must not silently widen).

```
RECORD ParkRecord:
  issue_id          : STRING                 # unchanged
  root_cause_class  : ENUM(five)             # unchanged, drives repeat-park counting
  timestamp         : ISO-8601               # unchanged: the park instant
  reconsider        : ENUM { "machine", "human" }   # NEW; absent on a legacy record reads as "human"
  cited_input       : CitedInput OR null     # NEW; non-null only when reconsider == "machine"

RECORD CitedInput:
  kind        : ENUM { "config-file", "backend" }
  ref         : STRING            # a REPO-ROOT-RELATIVE config path, or a backend identifier
  keys        : [STRING]          # optional: the config keys the fault named
  fingerprint : STRING            # content hash of the cited input captured AT PARK TIME
```

**Canonical marker.** A park record with no `reconsider` field reads as `human`. Only `reconsider: "machine"` with a non-null `cited_input` carrying a `fingerprint` and a `config-file` `ref` is a well-formed machine record; a `backend` cited input, or any missing field, is a cause that stays `human` for autonomous purposes (backend detection is punted, section 7). `park-history.js`'s `computeParkHistory` still keys only on `issue_id` / `root_cause_class` / `timestamp`, so `addParkRecord` and `renderParksBlock` round-trip the new fields as opaque payload.

### The git-only park marker (extended)

`.faff/prep/<issue>.json` is owned by `prepcheck.js`. `classifyPrepIssue` builds its payload from named keys only (`spec_produced`, `attached`, `disposition`, `owner`, `ts`) and never rejects an unknown key, so the cause record is added under a new `park` sub-object without disturbing the five-state classifier. The marker already records `owner.run_dir` (prepcheck.js lines 112, 129), which FAFF-993's interactive seam will later reuse; FAFF-992 does not touch it.

```
RECORD PrepMarker (git-only, the field this slice adds):
  ...existing: spec_produced, attached, disposition, owner{run_dir,session_id,pid}, ts...
  park : ParkCause OR absent          # NEW; present only when disposition == "parked"

RECORD ParkCause:
  reconsider   : ENUM { "machine", "human" }
  cause_class  : ENUM(five)           # mirrors the faff-parks root_cause_class
  parked_at    : ISO-8601             # the park timestamp, distinct from marker.ts
  cited_input  : CitedInput OR null
```

**Canonical marker.** The git-only cause record lives on the prep marker, not an adjacent file, so a single reader and single writer own it and `prepcheck`'s existing unknown-key tolerance carries it for free. A marker with `disposition:"parked"` and no `park` sub-object reads as a `human` park (fail-safe: an un-upgraded or hand-written park is never machine). `classifyPrepIssue` returns `state: "parked"` for such a marker exactly as it does today; the `park` sub-object does not change the state or the exit code.

---

## 4. HOW

### Park-time write flow

At park time, faff-prep already writes `disposition:"parked"` on the marker and appends the `{issue_id, root_cause_class, timestamp}` record (park.md Park protocol step 3, faff-prep Scenario A `low` → park and Scenario B `park`). FAFF-992 extends that same write:

```
AT PARK TIME (faff-prep, both the interactive low->park and the autonomous prep-queue park):
  1. classify the cause  (EXISTING step: the routing_adaptor assigns root_cause_class;
                          FAFF-992 EXTENDS it to also assign reconsider in {machine, human})
  2. IF reconsider == "machine":
        determine cited_input:
          kind := "config-file" for a fingerprintable single config file, else "backend"
          ref  := the repo-root-relative config path (or a backend identifier)
          keys := the config keys the fault named (optional)
          IF kind == "config-file" AND ref is a single repo-root file:
             fingerprint := content-hash(ref)     # captured NOW, at park time
          ELSE:
             # not a single fingerprintable file -> downgrade, per the canonical marker
             reconsider := "human" ; cited_input := null
     ELSE:
        cited_input := null
  3. append ParkRecord {issue_id, root_cause_class, timestamp, reconsider, cited_input}
        to the in-run park-record accumulator (addParkRecord — dedup unchanged)
  4. write PrepMarker.park = ParkCause {reconsider, cause_class: root_cause_class,
                                        parked_at: timestamp, cited_input}
        alongside the existing disposition:"parked" write
```

The classification in step 1 is the LLM seam the grader gates. Step 2's downgrade is what keeps a non-fingerprintable cause honest: the schema can name a `backend` cause, but faff-prep only records `machine` for a cause it can actually fingerprint now, so FAFF-993 never faces a `machine` record it cannot check. The content-hash function is any stable content digest of the file bytes; the same function must be reused at reconsider time by FAFF-993, so it is a shared helper, not an inline hash.

**Canonical marker.** The park-time write records `reconsider` and `cited_input` on both the `faff-parks` accumulator record and the prep marker's `park` sub-object, and it captures the fingerprint at park time (not at read time). A cause it cannot fingerprint as a single repo-root config file is downgraded to `human` at write time, never left as an unverifiable `machine` record.

### The park-versus-hold boundary (park.md prose)

The prevention half is a boundary rule in `park.md`, owned solely by this ticket. It partitions a machine cause by regime:

```
             machine cause
                  |
      +-----------+-----------+
      |                       |
 in-turn-recoverable    elapsed-input-change
 (transient blip)       (config edit)
      |                       |
   HOLD                    PARK, reconsider = machine
   (faff-awaiting-           cited_input + fingerprint
    spec-review; FAFF-900)   (FAFF-993 reconsiders it later)
   never a park
```

The prose states: a machine cause a bounded in-turn retry can clear this turn (a transient backend blip) routes to the existing `faff-awaiting-spec-review` hold (FAFF-900, Done), never a park; a config-fault is not in-turn-recoverable (no elapsed time, no input-change signal in-turn) and stays a park, recorded `reconsider: "machine"` with its cited input. A human-judgment cause (scope, taste, architecture) is unaffected by this boundary and parks `reconsider: "human"`.

**Canonical marker.** An in-turn-recoverable machine cause routes to a hold and never reaches the park record; only an elapsed-input-change machine cause is recorded `reconsider: "machine"`. This keeps the classified `machine` park record meaning exactly one thing: a cause that needs elapsed external change, which is the only thing FAFF-993's autonomous seam is licensed to reconsider.

### How the grader is wired

The park-time assignment of `reconsider: machine|human` is an LLM-judgement seam on `faff-prep`. The grader registration matches the existing closed-set KINDs (`routing`, `spec-verdict`, `holdout`), so it adds zero new grade math:

| Wiring point | Change |
|---|---|
| `eval/seam-registry.json` | Add `"park-reconsider-classification": { "surface": "faff-prep", "status": "designed" }` on first landing, flipping to `"covered"` once cases are committed; update the `_comment` KIND count from thirty-four to thirty-five |
| `eval/grader.mjs` | Add `park-reconsider-classification` to **both** the `KINDS` enum array (line 253) **and** `CLOSED_SET_KINDS` (line 254), in the same edit: the load-time `assertRegistryConsistent` (lines 293 to 303) fails loud unless `Object.keys(registry.kinds)` equals `KINDS` exactly, so adding the registry row without the `KINDS` member throws `seam-registry KINDS drift` on every grader load. The assigned `reconsider` is one closed value, oracle is a single-element `closed_set`, `env` carries the assigned disposition; a missing/garbage value grades a clean FAIL, no crash |
| `plugin/skills/faff-prep/SKILL.md` frontmatter | Add `park-reconsider-classification` to `judgement_seam:` (currently `reconciliation, prep-architecture-trigger`) so `faff validate-adapters` reconciles frontmatter against the registry |
| `eval/cases/park-reconsider-classification-NNN.json` | At least one case per side: a scope/taste/architecture park with `oracle.closed_set: ["human"]`; the reproduced-incident config-fault (a cited config file) with `oracle.closed_set: ["machine"]` |

The gate fails if any scope/taste/architecture case is assigned `machine`. This is the hard gate FAFF-993's autonomous re-open depends on: FAFF-993 must not ship its autonomous seam until this grader passes.

**Canonical marker.** The grader is a closed-set KIND on the `faff-prep` surface, registered in the seam registry, wired into `KINDS` + `CLOSED_SET_KINDS`, declared in faff-prep's `judgement_seam:` frontmatter, and backed by at least one `human` and one `machine` eval case; the `human` side is the gate that stops a scope/taste/architecture park being marked `machine`.

### Failure modes above the complexity bar

| Failure | How it shows up | How you would notice |
|---|---|---|
| A human park is mis-classified `machine` at park time | A taste/scope park would later be auto-reconsidered by FAFF-993 | The `park-reconsider-classification` grader fails on the `human` case; the record also fail-safes to `human` on any absent field |
| `cited_input.fingerprint` captured wrong at park time | FAFF-993's later reconsider fires (or never) regardless of edits | The park-record selftest asserts a `machine` record carries a non-empty `fingerprint` and a `config-file` `ref`; a `backend`/multi-file cause is downgraded to `human` |
| Adding `reconsider` breaks repeat-park counting | `park-history` miscounts or crashes | `park-history --selftest` still passes: `computeParkHistory` keys only on the three original fields; a new selftest case round-trips a record carrying the new fields |
| Adding `park` breaks the prep classifier | `prepcheck --selftest` fails, or a park-bearing marker misclassifies | `prepcheck --selftest` still passes; a new case asserts a `park`-bearing `disposition:"parked"` marker classifies `parked`, exit 0 |
| Grader KIND added to the registry but not the `KINDS` enum | Every grader load throws `seam-registry KINDS drift` | The wiring names both edits; a run of the grader over the new cases loads cleanly and grades |

### Anti-patterns

**Anti-pattern: encode machine-versus-human as a sixth root-cause class.** Adding a class widens the `ROOT_CAUSE_CLASSES` enum and breaks `computeParkHistory`'s window. The distinction is a separate orthogonal `reconsider` field.

**Anti-pattern: mark a non-fingerprintable cause `machine`.** A `backend`, multi-file, or environment-variable cause has no single-`ref` content fingerprint. Recording it `machine` hands FAFF-993 a record it cannot check; the park-time write downgrades it to `human` (backend detection is punted, section 7).

**Anti-pattern: default an ambiguous park to `machine`.** An unclassified, legacy, or hand-written park reads as `human`. The classifier only writes `machine` when it can positively prove the cause is machine-checkable and name the cited input.

**Anti-pattern: register the grader KIND in the seam registry without adding it to the `KINDS` enum.** The load-time `assertRegistryConsistent` requires `Object.keys(registry.kinds) === KINDS`; a half-edit throws on every grader load. Add both in one edit.

**Anti-pattern: change what the existing readers key on.** `computeParkHistory` and `classifyPrepIssue` must stay byte-compatible. The new fields are additive payload the existing readers ignore.

---

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

**A config-fault park is recorded machine with a fingerprinted cited input.**
Given faff-prep parks a spec-review `needs-human` on a config-fault whose cause cites a single repo-root config file; when the park-time write runs; then the `faff-parks` record and the marker `park` sub-object both carry `reconsider: "machine"`, a `CitedInput {kind: "config-file", ref: <repo-root path>, fingerprint: <content hash captured now>}`, and `cause_class` in the closed five, and the reproduced-incident config-fault is the grader's positive `machine` case.

**A genuine human-judgment park is recorded human and carries no cited input.**
Given faff-prep parks a scope, taste, or architecture call; when the park-time write runs; then both records carry `reconsider: "human"` and `cited_input: null`, and the grader's `human` case for that park asserts it is never assigned `machine`.

**A backend or multi-file cause is downgraded to human at write time.**
Given a machine cause that cites a backend or several files (no single fingerprintable config file); when the park-time write runs; then step 2's downgrade records `reconsider: "human"` with `cited_input: null`, because the shipped path fingerprints a single config file only (section 7 punt).

**A legacy park record reads as human.**
Given a `faff-parks` record with no `reconsider` field, or a `disposition:"parked"` marker with no `park` sub-object; when any reader that cares about reconsider reads it; then it reads as `human` and is never treated as machine.

**park-history counting is unchanged by the new fields.**
Given a `faff-parks` block whose records carry `reconsider` and `cited_input`; when `faff park-history --now <iso>` runs; then `computeParkHistory` counts by `issue_id` / `root_cause_class` / `timestamp` exactly as before, and `park-history --selftest` passes.

**A park-bearing marker still classifies parked.**
Given `.faff/prep/<issue>.json` with `disposition:"parked"` and a `park` `ParkCause` sub-object; when `faff prepcheck --issue <issue>` runs; then `classifyPrepIssue` returns `state: "parked"`, exit 0, and `prepcheck --selftest` passes.

**The park-versus-hold boundary routes an in-turn blip to a hold, not a park.**
Given a transient backend blip a bounded in-turn retry can clear; when the `park.md` boundary is applied; then the cause routes to the `faff-awaiting-spec-review` hold (FAFF-900), never a park, so no `machine` park record is written for it.

**The grader gates the human side.**
Given the `park-reconsider-classification` eval cases; when the grader runs; then it passes only when every scope/taste/architecture case is assigned `human` and the config-fault case is assigned `machine`; a scope park assigned `machine` fails the gate.

---

## 6. Design decision rationale

Every decision below is carried from the FAFF-991 umbrella (adversarially approved, verdict approve) and scoped to FAFF-992. None is re-opened here.

**The reconsider axis is orthogonal to the closed five root-cause classes.** Options: new root-cause classes; a separate axis. New classes would break `park-history.js`'s window logic. **Chosen:** keep `ROOT_CAUSE_CLASSES` closed at five and add an orthogonal `reconsider` field plus a cited-input reference (umbrella rationale, carried).

**The cited-input record lives on the prep marker.** Options: extend the marker; an adjacent file. **Chosen:** extend the marker; `classifyPrepIssue` ignores unknown keys, so one writer owns it and the five-state classifier stays byte-compatible (umbrella rationale, carried).

**Change detection is a content fingerprint, not file mtime.** Options: mtime versus `parked_at`; a content hash. Mtime changes on a no-op rewrite and misses an atomic replace. **Chosen:** a content fingerprint captured at park time, recomputed later by FAFF-993 (umbrella rationale, carried; FAFF-992 owns only the park-time capture).

**Fail safe on any ambiguous or legacy park.** Options: default an unclassified park to `machine`; default it to `human`. A `machine` default would let a mis-recorded park be auto-reconsidered. **Chosen:** absent, legacy, or non-fingerprintable is `human`, and the park-time write downgrades a non-single-file cause to `human` rather than recording an uncheckable `machine` (umbrella fail-closed principle, carried to the write side).

**Register a grader for the machine-versus-human classification, as a hard gate.** Options: no grader; register a grader KIND with eval cases. The reconsider disposition rides on the same LLM seam that assigns `root_cause_class`; a mis-classification would let FAFF-993 auto-reconsider a human park. **Chosen:** register the `park-reconsider-classification` KIND (surface `faff-prep`, closed-set) with eval cases gating on never assigning a scope/taste/architecture park `machine`, including the reproduced config-fault as a positive `machine` case; it is a hard gate on FAFF-993's autonomous re-open (umbrella rationale, carried; the grader is built in this ticket).

---

## 7. Open questions and assumptions

**Punt: backend cited-input change detection needs human (decides: architecture).** A `config-file` cited input fingerprints cleanly. A `backend` cited input has no obvious content to hash, and "the backend is now reachable" is a liveness probe, not a change diff. FAFF-992 ships the `backend` enum value so the record can name a backend cause, but the park-time write downgrades a backend cause to `human`; how a backend change is detected is decided when FAFF-993 (or a follow-up) builds the autonomous reconsider. This is the holdout scenario in section 5.

**Punt: multi-file or environment-variable cited inputs need human (decides: architecture).** If a config-fault cites several files or an environment variable, the single `ref` plus `fingerprint` shape needs either a fingerprint list or an explicit not-fingerprintable rule. The shipped path assumes a single repo-root config file; a multi-source cause is recorded `reconsider: "human"` until the shape is resolved.

**Assumes: the FAFF-900 hold machinery exists (Done).** The park-versus-hold boundary routes in-turn-recoverable causes to the existing `faff-awaiting-spec-review` hold (FAFF-900, Done, #771). FAFF-992 states the boundary prose; it does not build or re-verify the hold machinery. Assumes the FAFF-900 hold and its resume path exist as shipped.

**Assumes: the park-time classification step exists and is extended, not replaced.** The reconsider axis rides on the same park-time classification that assigns `root_cause_class` (the routing_adaptor's assignment, recorded by faff-prep at park.md Park protocol step 3). FAFF-992 extends that step to also assign `reconsider` and capture the cited input. Assumes that classification step exists; this ticket adds fields to it, it does not introduce a new classifier.

---

## 8. DONE

- [ ] `park-history.js` `ParkRecord` carries `reconsider` and `cited_input`; a record with neither reads as `human`; `ROOT_CAUSE_CLASSES` stays closed at five and `computeParkHistory` still keys only on `issue_id` / `root_cause_class` / `timestamp`. Covered by `park-history --selftest` still passing plus a new `park-records.test.mjs` case that round-trips a record carrying the new fields through `addParkRecord` / `renderParksBlock` / `extractParksBlock` and asserts counting is unchanged.
- [ ] `.faff/prep/<issue>.json` carries a `park` `ParkCause` sub-object when `disposition:"parked"`; `classifyPrepIssue` is byte-unchanged (unknown-key tolerance). Verified by the existing `prepcheck --selftest` still passing plus a new `PREPCHECK_ISSUE_SELFTEST_CASES` case asserting a `park`-bearing `disposition:"parked"` marker still classifies `parked`, exit 0.
- [ ] `CitedInput` records `kind`, `ref` (repo-root-relative for `config-file`), optional `keys`, and `fingerprint`; a `machine` record carries a non-empty `fingerprint` and a `config-file` `ref`, and a backend/multi-file cause is recorded `reconsider: "human"` with `cited_input: null`. Covered by a park-record selftest case per branch.
- [ ] faff-prep writes `reconsider`, `cause_class`, `parked_at`, and `cited_input` at park time on both the `faff-parks` accumulator record and the marker `park` sub-object, capturing the fingerprint at park time via a shared content-hash helper (the same helper FAFF-993 recomputes with); a non-single-file cause is downgraded to `human` at write time. Covered by the park-time write flow in `park.md` / `faff-prep/SKILL.md` and a fixture asserting the marker shape.
- [ ] `park.md` states the park-versus-hold boundary: an in-turn-recoverable machine cause routes to the `faff-awaiting-spec-review` hold (FAFF-900), never a park; an elapsed-input-change config-fault stays a park recorded `reconsider: "machine"`; a human-judgment cause parks `reconsider: "human"`. This ticket owns the boundary prose solely (no external coordination dependency).
- [ ] The `park-reconsider-classification` grader KIND is registered: a row in `eval/seam-registry.json` (surface `faff-prep`, status `designed` then `covered`) with the `_comment` KIND count updated to thirty-five; added to **both** `eval/grader.mjs` `KINDS` (line 253) **and** `CLOSED_SET_KINDS` (line 254) in one edit, so the load-time `assertRegistryConsistent` (which requires `Object.keys(registry.kinds) === KINDS`) does not throw `seam-registry KINDS drift`; declared in `faff-prep/SKILL.md` `judgement_seam:` frontmatter. `faff validate-adapters` reconciles frontmatter against the registry, and the grader loads and grades, both passing.
- [ ] `eval/cases/park-reconsider-classification-NNN.json` carries at least one `human` case per scope/taste/architecture and one `machine` case (the reproduced-incident config-fault with a cited config file); the grader fails if any scope/taste/architecture case is assigned `machine`. This grader is the hard gate FAFF-993's autonomous re-open depends on (dependency stated; the autonomous-seam gate wiring is FAFF-993's).

confidence: high
build-tier: complex
spec-review: approve (scoped-slice single-pass 4-lens; round 1 revise on a grader-wiring omission, round 2 approve, 2026-09-04; refreshed 2026-09-04 to drop stale FAFF-927 coordination, verdict retained)