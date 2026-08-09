# FAFF-673 — A sanctioned, explainable human-merge path for legitimate non-graft changes

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-673.

**Artifact:** an nlspec for the build agent and human reviewers. It closes the gap where `faff merge-gate` refuses a legitimate change that never came through `/faff-graft`, names no remedy, and — if a human merges anyway — leaves evidence that a later `faff audit` cannot account for. The operator's A-vs-B decision is **closed** (2026-08-08): non-graft landing stays a human action, the merge floor stays exception-free, and the human path must leave an explainable trail. This spec builds that answer; it does not reopen it.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate`'s verdict is produced by the *provenance-blind* pure core `decideFloor` (contract-defs.js:1593): given the floor inputs it returns `refuse` whenever ACs aren't all verified or the review verdict isn't `pass`. A change that never went through graft has *no* AC checklist and *no* review verdict, so `decideFloor` refuses with `["ACs not all verified", "review verdict is missing (need pass)"]` — both true, both artifacts of the change having no spec/graft origin. The gate governs the *agent*, not the operator: a human may still merge. The fix is not to weaken the floor — it is to (a) *name the human remedy* beside those blockers, and (b) make the sanctioned human merge leave an **explainable record** — a `faff effects declare --step merge` declaration paired with the merge landing, plus a justification on the override artifact — that `faff audit` reads and accounts for, so reconciliation never trips over an orphaned fragment.

**Problem statement.** Today the refusal names the two blockers and stops, and the sanctioned mechanism that already exists (`--human-override`, FAFF-375) writes `merge-gate-override.json` with no justification and is read by *nothing* (confirmed: reconcile.js, audit.js, governance-check.js all ignore it). So a legitimate non-graft artifact — a spike's findings, a docs capture, a one-line fix — has nowhere to go but park, and a human who merges it manufactures exactly the unexplainable evidence (an unread override, an escaped merge side-effect, a landing no audit can account for) the operator ruled out.

**Design principles:**

- **The pure floor is untouchable.** `decideFloor` stays provenance-blind and byte-identical (its same-inputs-same-verdict selftest invariant is load-bearing). Every change here is *shell-level* (in `cmdMergeGate`/`cmdMergeGateLocal`) or in a *reader* (`faff audit`). No agent-reachable carve-out is added to the floor.
- **Non-graft landing is human-only.** The remedy is a *human* action gated by the existing TTY+`--interactive` fence (`fenceHumanFlags`, merge-gate.js:85). Nothing here gives an autonomous lane a way to route around the floor.
- **No merge without an explainable record.** An override that carries no justification, or a human merge that skipped the declaration, is precisely the orphaned evidence this ticket exists to prevent — so the sanctioned path *requires* both the declaration and the reason, and `faff audit` flags their absence rather than passing it silently (fail-closed, mirroring the reconcile/audit house rule).
- **Reuse the existing surfaces.** The record is the *existing* `merge-gate-override.json` extended with one field + the *existing* `declared-effects.jsonl` declaration + the *existing* `merge-record.json` landing evidence — never a new store. The consumer is the *existing* `faff audit` coherence model — never a new verb.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js:1593` (`decideFloor`) | JS | The provenance-blind floor — **read-only reference**, never edited |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`cmdMergeGate` :827, `cmdMergeGateLocal` :646-825, `fenceHumanFlags` :85, override writes :729/:958, `observeMergeEffects` :556 (PR-path only, called :997/:1012), `writeMergeRecord` :387 (both paths; local at :823), `emit` :890) | JS | Where the remedy line + the extended override record live; **note the PR/local asymmetry** below |
| `plugin/skills/faff/bin/lib/effects.js` (`cmdEffects` :383, `appendEffectEntries` :359, `computeEscapes` :79, `effectTargetMatches` :73) | JS | The declare/observe ledger the sanctioned path writes and audit reuses |
| `plugin/skills/faff/bin/lib/audit.js` (`buildReconstruction` :62, `cmdAudit` :293, `readProvenance` :42) | JS | The consumer that reads the record and emits the accounting disposition |
| `plugin/skills/faff-graft/SKILL.md:460` (Step 10) | Markdown | The in-graft `declare→merge` precedent the human path mirrors |
| `docs/guide/unattended.md` (`## What keeps it honest` :79) | Markdown | Where the human-merge remedy is documented |

**PR/local path asymmetry (load-bearing — drives §3/§4.3).** The merge chokepoint has two landing paths with **different** mechanical-observe behaviour:
- **PR path** (`cmdMergeGate`): after the merge it fires **both** `observeMergeEffects` (:997/:1012) **and** `writeMergeRecord` (:994/:1009).
- **Local / git-only path** (`cmdMergeGateLocal`, ends :823): fires **only** `writeMergeRecord` (:823) — it emits **no** merge observe at all.

So the audit covering-check cannot be keyed on a merge *observe* uniformly: on the local path there is no observe to cover. The covering evidence is therefore **path-aware** (§4.3): the declaration is required on both paths; the *landing* is evidenced by a covered merge observe on the PR path and by `merge-record.json` on the local path.

**Scope statement.** This sits at the merge chokepoint and its run-end forensics: it adds a *named, recorded, audited* human exit for non-graft changes to the same floor that (unchanged) governs graft-produced changes.

## 2. OUT OF SCOPE

- **A sanctioned autonomous non-graft path.** — *Excluded:* the autonomous lane still may only reach `merge-ok` through the full floor; non-graft stays human-only. *Why:* the operator rejected it (expands the trust surface an agent can reason into). *Extension point:* none by design.
- **Any change to `decideFloor` / the graft merge path.** — *Excluded:* the floor for graft-produced changes is exactly as-is. *Why:* the operator ruled the floor stays exception-free. *Extension point:* n/a — the pure core is frozen.
- **Wiring `observeMergeEffects` into the local merge fall-through.** — *Excluded:* the local path keeps emitting only `writeMergeRecord`. *Why:* adding a merge observe to the local path would make `warnUncoveredMergeObserves` begin firing on **all** graft-local merges (an unscoped blast-radius change to a working path); the covering check is instead made path-aware (§4.3), keying the local landing on `merge-record.json`. *Extension point:* a future ticket could unify observe emission across both paths and then simplify §4.3 to a single observe-based check.
- **A fully run-less out-of-band manual merge (no faff run dir at all).** — *Excluded:* a raw `git push && gh pr merge` with no faff run leaves no faff run-dir or floor artifacts and produces no observe (invisible by design, per the effects observation-surface ADR). *Why:* there is nothing to orphan and nothing to reconcile — the "no orphaned fragments" concern only arises when a non-graft *attempt* started a run-dir/floor artifacts. *Extension point:* the sanctioned path below applies whenever a run dir exists; a run-less fix is simply not in faff's observation surface.
- **Distinguishing machine- vs hand-authored merge-floor evidence (FAFF-698, now Done).** — *Excluded:* this spec designs the record to *compose* with that but does not build the classifier. *Why:* separate, already-shipped ticket. *Extension point:* the `source: "human-override"` marker on the extended override record (§3) is the field FAFF-698's classifier keys on.
- **Wiring `faff reconcile` / `faff governance-check` to read the record.** — *Excluded:* the single consumer built here is `faff audit`. *Why:* `reconcile` keys on ledger `shipped` outcomes (reconcile.js:41), which a non-graft merge does not have; `audit` already scans the run dir substrates. *Extension point:* `reconcileShipped`/`governance-check.js` could later add a human-merge arm reading the same artifact.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Non-graft change | A change with no graft-produced spec/AC/review artifacts — a spike's findings, a docs capture, a one-line fix |
| Non-graft floor signature | The specific refuse signature that identifies a non-graft origin: `ac_complete === false` AND `review_verdict === "missing"` |
| Sanctioned human-merge path | `faff effects declare --step merge` (the declaration) → `faff merge-gate … --human-override --interactive --override-reason "…"` (the audited merge) |
| Explainable record | The union of: the `declared-effects.jsonl` merge **declaration**, the merge **landing** evidence (a covered merge observe on the PR path; `merge-record.json` on the local path), and the `reason` on `merge-gate-override.json` |
| Accounted-for human-merge | An audit disposition: a run whose human-merge left a well-formed explainable record — clean, not a coherence finding |

**Extended override record.** `merge-gate-override.json` (per-issue, `<run-dir>/<issue>/merge-gate-override.json`) gains two fields; existing fields are unchanged:

```
RECORD MergeGateOverride:
  pr: Number | absent          # PR path only; absent on --local (unchanged) — also the path discriminator §4.3
  issue: String                # unchanged
  head_sha: String             # unchanged
  blockers: Array<String>      # the refused floor blockers (unchanged)
  overridden_at: ISO8601       # unchanged
  reason: String               # NEW — non-empty; "what merged + why no floor applies"
  source: "human-override"     # NEW — literal; the hand-authored marker FAFF-698 composes with
```

**New CLI flag.** `faff merge-gate … --override-reason "<text>"` (arity 1). Required whenever `--human-override` is present; a non-empty string.

**Pure helper (new, in merge-gate.js, exported for test):**

```
FUNCTION nonGraftFloorSignature(floor) -> Boolean
  # keyed on the SAME floor inputs decideFloor saw — never re-derives, never touches decideFloor
  RETURN floor.ac_complete === false AND floor.review_verdict === "missing"
```

**Extended `fenceHumanFlags` input (merge-gate.js:85, pure).** Add one violation:

```
IF i.human_override AND (i.override_reason is absent OR empty)
   violations.push('--human-override requires --override-reason "<what merged + why no floor applies>"')
```

**Audit accounting (new, computed inside the pure `buildReconstruction`).** Per issue, from the substrates the `cmdAudit` wrapper now reads and hands in (mirroring the existing `provenanceMap` seam): the per-issue `merge-gate-override.json`, the per-issue `merge-record.json`, and the run's `declared-effects.jsonl`:

```
RECORD HumanMergeAccounting:      # attached to each issue's reconstruction entry, or absent
  present: Boolean                # a merge-gate-override.json exists for this issue
  reason: String | null
  declare_present: Boolean        # declared-effects has a kind_of_entry:"declare" merge entry at step "merge"
  landing_covered: Boolean        # path-aware: PR → a merge observe present AND not escaped; local → merge-record.json present
  accounted_for: Boolean          # present AND reason non-empty AND declare_present AND landing_covered
```

A new coherence finding class `human_merge_unexplained` (issue-scoped) is raised when `present && !accounted_for`.

**Design decisions** are collected in §6; each carries its marker there.

## 4. HOW — Behavior

### 4.1 Naming the remedy in the refusal (gap #1)

**Summary:** when `merge-gate` refuses on the non-graft signature, it appends a remedy line naming the human path — nothing else about the refusal changes, and the pure floor is untouched.

Both refuse branches (`cmdMergeGate` PR path :954-964 / fall-through to `emit`; and `cmdMergeGateLocal` :725-734) gain a shell-level remedy, keyed on `nonGraftFloorSignature(floor)` over the *same* floor record already assembled for `decideFloor`:

```
PROCEDURE refuse_branch(floor, result):
  1. { verdict, blockers } = decideFloor(floor)          # UNCHANGED pure call
  2. IF verdict == "refuse" AND NOT (interactive AND humanOverride):
     a. IF nonGraftFloorSignature(floor):
        result.remedy = NON_GRAFT_REMEDY_STRING
     b. return emit(result, 1)                            # emit renders remedy after blockers
```

`emit` (:890) renders `result.remedy`, when present, as a trailing line after the `✗ <blocker>` lines (text mode) and as a `remedy` field (`--json`) — exactly the precedent set by `fenceHumanFlags`'s remedy, `anchorRefusal`'s remedy, and the no-merge-method error.

`NON_GRAFT_REMEDY_STRING` (single, exported constant) reads, in substance:

> This change has no graft origin (no ACs, no review). If it is a legitimate non-graft change (a spike's findings, a docs capture, a one-line fix), landing it is a **human** action, not an autonomous one: declare the merge effect (`faff effects declare --run <run> --issue <issue> --step merge`) then merge it yourself with `faff merge-gate … --human-override --interactive --override-reason "<what merged + why no floor applies>"`. The declaration and the reason are the explainable record `faff audit` reconciles.

**Anti-pattern:** deriving the remedy inside `decideFloor` or gating it on provenance there. Why: that would make the pure core provenance-aware and break its same-inputs-same-verdict invariant. The remedy is *shell-level only*.

**Anti-pattern:** printing the remedy for *every* refuse. Why: a graft change refused for a failing review (`review_verdict === "fail"`) or red CI is not a non-graft change; naming the human-merge remedy there would invite an operator to override a floor that graft should re-clear. The signature (`!ac_complete && review_verdict === "missing"`) is what distinguishes "never went through graft" from "graft change not yet cleared."

### 4.2 The sanctioned path leaves an explainable record (gaps #2, #3)

**Summary:** the human path is *declare-then-merge-through-merge-gate*, so the landing is evidenced (a covered observe on the PR path; a merge-record on the local path) and the override artifact carries a justification. A bare raw `gh pr merge` is never the sanctioned path.

1. **`--override-reason` is required and fenced.** `cmdMergeGate` threads `--override-reason` into `fenceHumanFlags` (both the PR path :887 and, via the shared arg parse, into `cmdMergeGateLocal`). An `--human-override` with an absent/empty reason is a **loud exit-2 caller error** — never a silent override. This is the guard that makes "no merge without a reason" true by construction.

2. **The override write carries the record.** Both override writes (:729 local, :958 PR) add `reason` (from `--override-reason`) and `source: "human-override"` to the JSON. Everything else about the write and the fall-through-to-execute is unchanged — after the override write, control still falls through to the real merge:
   - **PR path:** fires `observeMergeEffects` (:997/:1012) **and** `writeMergeRecord` (:994/:1009).
   - **Local path:** fires `writeMergeRecord` (:823) **only** — no observe (see §1 asymmetry). This is intentional and unchanged; the covering check accommodates it (§4.3).

3. **The declaration pairs the landing.** The remedy instructs the human to run `faff effects declare --step merge` (mirroring graft Step 10's `[{kind:"merge",target:"pr:"+pr,reversible:true}]`) *before* the merge. On the **PR path**, when the human declares, `observeMergeEffects` → `warnUncoveredMergeObserves` finds the covering declaration and emits **no** "escaped side-effect" warning; `faff effects check` reports no escape. If the human skips the declare on the PR path, the existing uncovered-observe warning (:547) fires — the exact "escaped side-effect" signal. On the **local path** there is no observe, so there is no escape warning either way; the declaration is still required (audit checks `declare_present`, §4.3) and its absence is caught at audit, not at merge. This is why the path must route *through* `merge-gate --human-override`, not a raw `gh pr merge` (which produces no observe and no merge-record — invisible by design).

**Edge cases:**
- **No run dir yet.** `faff effects declare` requires an existing run dir (effects.js:411 → exit 3). The sanctioned path presupposes one (the autonomous run that produced the non-graft artifact, or a held merge, already minted it). A truly run-less fix is out of scope (§2) — nothing to orphan.
- **`--override-reason` without `--human-override`.** Ignored (the reason is only meaningful paired with an override) — no error; symmetric with an unused merge flag.
- **Override write fails (I/O).** Unchanged: exit 2, no merge (:730/:959).

**Failure mode — the remedy could invite floor-weakening.** *The failure:* an operator reads the remedy and overrides a change that *should* have gone through graft. *How you'd know:* the override record carries `source:"human-override"` and the full `blockers` list; a review of overrides whose blockers include CI/holdout legs (not just the non-graft signature) surfaces misuse. *What it means:* proceed — the record makes misuse *visible and auditable*, which is the operator's stated bar ("explainable"), not preventable at the gate (the gate governs the agent, not the human).

### 4.3 `faff audit` accounts for the human-merge (gaps #2, #3 — the consumer)

**Summary:** `faff audit` reads the extended override record, the merge-record, and the declared-effects ledger and emits an **accounted-for** disposition for a well-formed human-merge, or a `human_merge_unexplained` coherence finding when the record is incomplete — so reconciliation accounts for the landing instead of tripping over it. The landing check is **path-aware** to respect the PR/local observe asymmetry (§1).

The `cmdAudit` wrapper (:293) reads three substrates and hands them to the pure `buildReconstruction` (mirroring how it already reads `provenanceMap`):
- per issue: `<run-dir>/<issue>/merge-gate-override.json` (if present);
- per issue: `<run-dir>/<issue>/merge-record.json` (if present) — the local-path landing evidence;
- once: `<run-dir>/declared-effects.jsonl` (already the effects ledger).

`buildReconstruction` (pure) computes `HumanMergeAccounting` per issue:

```
PROCEDURE account_human_merge(issue, overrideRec, mergeRecord, effectsEntries):
  1. IF no overrideRec for issue: RETURN absent
  2. declare_present = effectsEntries.any(e => e.issue == issue AND e.step == "merge"
                          AND e.kind_of_entry == "declare" AND e.effect.kind == "merge")
  3. IF overrideRec.pr is present:                          # PR path
        escapes = computeEscapes(entriesFor(issue), issue).escapes
        landing_covered = mergeRecord present-and-merged
                          AND NOT escapes.any(x => x.step=="merge" AND x.escaped.any(k => k.kind=="merge"))
     ELSE:                                                  # local path — no observe emitted
        landing_covered = mergeRecord present-and-merged
  4. accounted_for = overrideRec.reason is non-empty AND declare_present AND landing_covered
  5. IF present AND NOT accounted_for:
        coherence.human_merge_unexplained.push({ issue, reason_present, declare_present, landing_covered })
        coherence.clean = false
  6. RETURN { present:true, reason:overrideRec.reason, declare_present, landing_covered, accounted_for }
```

An **accounted-for** human-merge does **not** make coherence unclean — it is rendered as an explicit line (`human-merge: <issue> accounted-for (reason: …)`), so the landing is *explained on the audit*, not flagged. An override that is `present && !accounted_for` (missing reason, missing declaration, or no merge landing / an uncovered escaped merge on the PR path) is the `human_merge_unexplained` finding — the "orphaned unexplainable evidence" the operator ruled out, now surfaced rather than silent.

**Anti-pattern:** teaching `reconcile` about this instead of `audit`. Why: `reconcile`'s input is one entry per ledger `shipped` outcome (reconcile.js:41); a non-graft human-merge has no `shipped` outcome, so it would never reach `reconcile`. `audit` already reconstructs from run-dir substrates and is the surface the operator named.

**Anti-pattern:** keying the landing check on a merge *observe* uniformly. Why: the local path emits no observe (§1), so a uniform observe-keyed check would mis-handle every legitimate local human-merge. The declaration is the common requirement; the landing evidence is path-specific.

**Failure mode — the override may exist without a matching merge landing.** *The failure:* an override is written but the merge never lands (a later gh/git failure), leaving a dangling override. *How you'd know:* audit sees `override present` but no merged `merge-record.json` → `landing_covered:false` → `human_merge_unexplained`. *What it means:* proceed — this is the correct fail-closed reading (a dangling override is exactly an orphaned fragment; audit names it).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a change with no AC checklist and no review-verdict (a non-graft origin)
When `faff merge-gate` is run and decideFloor refuses
Then the refusal names the two floor blockers AND appends the human-merge remedy line naming `faff effects declare --step merge` and `--human-override --interactive --override-reason`
```

```
Given a graft-produced change refused only for a failing review verdict (review_verdict == "fail")
When `faff merge-gate` refuses
Then the non-graft remedy line is NOT appended (the signature does not match)
```

```
Given a human runs the sanctioned PR path: `faff effects declare --step merge` then `faff merge-gate --pr N --human-override --interactive --override-reason "spike findings; no spec floor applies"`
When the merge lands and observeMergeEffects fires
Then no "escaped side-effect" warning is emitted (the observe is covered) AND merge-gate-override.json carries a non-empty `reason` and `source:"human-override"`
```

```
Given a human runs the sanctioned LOCAL path: `faff effects declare --step merge` then `faff merge-gate --local --human-override --interactive --override-reason "docs capture; no spec floor applies"`
When the merge lands (writeMergeRecord fires; no observe on the local path)
Then merge-gate-override.json carries a non-empty reason + source AND `faff audit` accounts for it via the merge-record + declaration (no false human_merge_unexplained)
```

```
Given a run dir whose issue has a well-formed override record, a merge declaration, and merge landing evidence (covered observe on PR, or merge-record on local)
When `faff audit <run>` runs
Then the issue is reported as an accounted-for human-merge and coherence stays clean
```

## 6. Design Decision Rationale

**Where does the remedy live, and when does it fire?**
- *Options:* (a) inside `decideFloor`; (b) shell-level in the refuse branches, keyed on the non-graft signature; (c) shell-level on every refuse.
- (a) breaks the pure core's provenance-blind, same-inputs-same-verdict invariant — rejected. (c) would name a floor-weakening remedy on graft changes merely awaiting review/CI — rejected. (b) reuses the `fenceHumanFlags`/`anchorRefusal` shell-remedy precedent and fires only on the true non-graft tell.
- **Chosen:** a shell-level remedy in `cmdMergeGate`/`cmdMergeGateLocal` refuse branches, gated by `nonGraftFloorSignature(floor)` over the same floor inputs `decideFloor` saw — `decideFloor` untouched.

**What is the explainable record, and how is a justification captured?**
- *Options:* (a) a new per-merge record/store; (b) extend the existing `merge-gate-override.json` with a `reason` (+ `source`) field supplied by a required `--override-reason` flag.
- (a) violates "reuse existing surfaces" and duplicates the artifact that already exists. (b) fills the exact gap FAFF-375 left (the override carries `blockers`+`overridden_at` but no justification and is read by nothing) and composes with FAFF-698 via `source`.
- **Chosen:** extend `merge-gate-override.json` with `reason` (required, non-empty) + `source:"human-override"`, captured by a new `--override-reason` flag that is loud-required whenever `--human-override` is used.

**How does the human merge stay non-escaping, and how is the landing evidenced on each path?**
- *Options:* (a) let the human raw `gh pr merge` and record the reason only; (b) route the merge through `faff merge-gate --human-override` after a `faff effects declare --step merge`, with a **uniform** merge-observe covering check; (c) route through `merge-gate --human-override` after the declare, with a **path-aware** covering check (PR → covered observe; local → merge-record).
- (a) produces no observe/merge-record (invisible by design) — the merge would still read as an escaped/unaccounted side-effect. (b) is broken for the local path: `cmdMergeGateLocal` (merge-gate.js:646-825) fires only `writeMergeRecord` (:823) and **no** `observeMergeEffects` (which is PR-path-only, :997/:1012), so a uniform observe-keyed check would false-flag every legitimate local human-merge. Wiring an observe into the local fall-through would make `warnUncoveredMergeObserves` fire on all graft-local merges — an unscoped blast-radius change (§2). (c) respects the existing PR/local asymmetry: the declaration is the common requirement on both paths, and the landing is evidenced by the artifact each path actually writes.
- **Chosen:** the sanctioned path is declare-then-merge-through-`merge-gate`; the audit landing check is **path-aware** — PR path requires a covered (non-escaped) merge observe, local path requires a merged `merge-record.json`; both require the merge declaration. A bare raw `gh pr merge` is never the sanctioned path.

**Which surface consumes the record?**
- *Options:* (a) `reconcile`; (b) `governance-check`; (c) `audit`.
- (a) keys on ledger `shipped` outcomes a non-graft merge lacks — it would never see the merge. (b) is viable but heavier and less naturally per-run-dir. (c) already reconstructs a run from its on-disk substrates (events + ledger + provenance) and reports coherence, and reuses `computeEscapes` for the PR-path covering check.
- **Chosen:** `faff audit` reads the override + merge-record + declared-effects and emits an accounted-for disposition / a `human_merge_unexplained` finding; `reconcile`/`governance-check` are extension points.

**Is this one slice or several?**
- *Options:* (a) split remedy / record / consumer / docs into separate tickets; (b) one coherent slice.
- The four parts are interlocking — the remedy names a record, the record is only explainable if a consumer reads it, and the docs describe the whole path. Splitting would ship a remedy pointing at an unread artifact (the exact FAFF-375 failure). The change is bounded: one constant + one pure helper + one fence line + two override-write edits in merge-gate.js, a substrate read + path-aware accounting in audit.js, and one docs section.
- **Chosen:** a single slice (remedy + record + one consumer + docs).

## 7. Open Questions and Assumptions

None. The A-vs-B product decision is closed by the operator; every decision above is `Chosen`.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] `decideFloor` (contract-defs.js:1593) is byte-unchanged and its `--selftest` still passes.
- [ ] No agent-reachable path reaches `merge-ok` without the full floor (the remedy/override remain human-only, TTY+`--interactive` fenced).

### From WHAT (types and flags)
- [ ] `--override-reason "<text>"` (arity 1) is accepted by `merge-gate` on both PR and `--local` paths.
- [ ] `merge-gate-override.json` written on both paths carries non-empty `reason` and `source:"human-override"`, plus all existing fields (`issue`, `head_sha`, `blockers`, `overridden_at`, and `pr` on the PR path).
- [ ] `nonGraftFloorSignature(floor)` returns true iff `ac_complete === false && review_verdict === "missing"`, false otherwise (exported, unit-tested). **Signature-boundary test:** a graft-shaped floor (`review_verdict === "fail"`, or `ac_complete === true`, or `ci-red`) returns false — a graft floor never matches the non-graft key.

### From HOW (§4.1 remedy)
- [ ] On a non-graft-signature refuse, `merge-gate` output includes the remedy line after the `✗` blockers (text) / a `remedy` field (`--json`), naming `faff effects declare --step merge` and `--human-override --interactive --override-reason`.
- [ ] On a refuse whose signature does NOT match (e.g. `review_verdict === "fail"`, or `ci-red`), the remedy line is absent.
- [ ] The remedy fires identically from `cmdMergeGateLocal`'s refuse branch.

### From HOW (§4.2 sanctioned path)
- [ ] `--human-override` without a non-empty `--override-reason` is a loud exit-2 caller error (via `fenceHumanFlags`), never a silent override.
- [ ] **PR path:** after a `faff effects declare --step merge` covering the merge, a `--human-override` merge produces no "escaped side-effect" warning and `faff effects check` reports no escape for that (issue, `merge`); the fall-through still fires `observeMergeEffects` + `writeMergeRecord`.
- [ ] **Local path:** a `--human-override` merge fires `writeMergeRecord` only (no observe — unchanged); the override JSON still carries `reason` + `source`.

### From HOW (§4.3 consumer — path-aware)
- [ ] `faff audit` reads `<run-dir>/<issue>/merge-gate-override.json` + `<run-dir>/<issue>/merge-record.json` + `declared-effects.jsonl` and, for a well-formed record (non-empty reason + merge declaration + path-appropriate landing: covered observe on PR / merge-record on local), reports the issue as an accounted-for human-merge WITHOUT making coherence unclean.
- [ ] `faff audit` raises a `human_merge_unexplained` coherence finding (coherence not clean) for each unexplained trigger: (i) empty/absent reason, (ii) missing merge declaration, (iii) no merge landing (dangling override) OR an uncovered/escaped merge observe on the PR path. **One explicit test per trigger.**
- [ ] A legitimate **local** human-merge (override + declaration + merge-record, no observe) is reported accounted-for and does NOT false-flag as `human_merge_unexplained`.
- [ ] `reconcile`'s `--selftest` and existing dispositions are unchanged (no regression from this ticket).

### From docs
- [ ] `docs/guide/unattended.md` `## What keeps it honest` documents the human-merge remedy: a legitimate non-graft change is a human `declare→merge-through-merge-gate` action leaving a reason + a declaration + a landing that `faff audit` accounts for.

### Integration smoke test
```
1. In an existing run dir with an issue that has no AC/review artifacts:
   faff merge-gate --pr N --issue I --run-dir R            # → refuse, blockers + remedy line
2. echo '[{"kind":"merge","target":"pr:N","reversible":true}]' \
     | faff effects declare --run R --issue I --step merge  # declaration
3. faff merge-gate --pr N --issue I --run-dir R \
     --human-override --interactive --override-reason "spike findings; no spec floor" --squash
                                                            # → merges; no escaped-side-effect warning
4. faff audit R                                             # → "human-merge: I accounted-for", coherence clean
```

## Already shipped against this surface

Autonomous already-shipped scan (Done siblings in team Faff on the merge-gate / effects / audit surface). **Premise still holds** — no Done work delivers this ticket's remedy, record, or audit consumer. Related-but-not-superseding:
- **FAFF-698** (Done 2026-08-08) — distinguishes machine- vs hand-authored merge-floor evidence in interactive graft. Adjacent, not superseding: it does not name the refusal remedy, define the human-merge record, or wire an audit consumer. This spec's `source:"human-override"` field is designed to compose with FAFF-698's classifier.
- **FAFF-690 / FAFF-435 lineage** (Done) — F3 already-merged reconcile + F4 completion backstop. Handles graft/ledger reconciliation, not the non-graft human-merge accounting this ticket adds.
- **FAFF-375** (Done) — added `--human-override` + `merge-gate-override.json`, but left it justification-less and read by nothing (the exact gap this ticket closes).

Direct code ground truth (explore): the refusal names no remedy, `merge-gate-override.json` carries no reason field, and reconcile.js / audit.js / governance-check.js all ignore it. Premise load-bearing → proceed.

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**right-sized?** No issues — the "single slice" call is correct, so don't split it. Parts 1–3 are the write side (remedy, `--override-reason`, declare-then-merge) and part 4 is the read side that consumes the record they produce — a genuine producer/consumer interlock on one artifact, not a "while we're at it" bundle. Splitting write from read would ship a remedy pointing at an artifact nothing reads yet (the FAFF-375 half-feature failure). The estimate sits inside the 1–3 day band. Keep it whole.

**workstream fit?** The build scope now rides on the same "Weigh up" decision ticket whose A-vs-B question the operator closed on 2026-08-08, so the ticket's "done" conflates "decision made" (already true) with "code shipped" (not yet). The build scope itself is cohesively single-outcome (an explainable audit trail for the non-graft human-merge path) and the FAFF-698 / FAFF-690 / FAFF-375 lineage converges on it. Optional/minor: spin the residual into its own build ticket (blocked-by the closed decision) if you want the status legibility; confirm it lands in the merge-gate / governed-autonomy stream.

**deps surfaced?** No issues — the lineage is explicit and every referenced ticket (FAFF-698 evidence classifier, FAFF-690 F3/F4 reconcile lineage, FAFF-375 `--human-override` surface) is Done, so no load-bearing blocker link is missing. The `faff effects declare` machinery + `declared-effects.jsonl` are existing shipped substrate (FAFF-383/FAFF-690 lineage).

**risk profile?** Residual uncertainty concentrates in the `audit.js` accounting (accounted-for vs `human_merge_unexplained`: the unexplained triggers plus the floor-signature key and the PR/local path-awareness). A mis-keyed signature or a missed trigger would falsely clear an unexplained merge or falsely flag a clean one. De-risked in DONE with an explicit test per unexplained trigger, a signature-boundary test (a graft floor must not match the non-graft key), and a local-path accounted-for test.

---

*Autonomous prep (run-20260808-235832-fly-l3). The operator's 2026-08-08 Decision + sharpening comments supersede the prior low-confidence parks (Live-thread reconciliation): the A-vs-B question is closed, so this fresh spec builds Option A. spec-readiness contract: pass (exit 0). spec-review: approve (revise→approve, 1 iteration — the local-path covering-check asymmetry was fixed in place).*

confidence: high
spec-review: approve