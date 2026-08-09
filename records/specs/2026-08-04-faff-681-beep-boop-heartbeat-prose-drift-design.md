# FAFF-681 — beep-boop's heartbeat prose still describes the pre-FAFF-355 mechanism

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high.

> Revised 2026-08-04 (interactive unblock) — folded the spec-review QA lens's two born-verifiability gaps into the DoD: added a **Born-verifiable oracles (grep)** block that pins the exact base-file string each of the six edits must remove/add, plus a retained-claims grep set. No approach change; the six edits, scope, and markers are unchanged.

This spec is for the build agent correcting the run-liveness heartbeat prose in `plugin/skills/faff-beep-boop/SKILL.md`, and for the human reviewer signing off that the corrected prose matches shipped code. It is a documentation-only change: six spots in one skill file, no runtime code touched.

## Already shipped against this surface

None of these superseded this ticket's premise — the drift is present and unfixed (line 381 still literally reads "field-merges `owner.last_heartbeat = now`"). Listed as reader context so the build agent knows the neighbours:

- **FAFF-234** (Done 2026-06-26) — shipped the *field-merge* heartbeat this prose still describes. The mechanism the code has since moved off.
- **FAFF-355** (Done 2026-07-11) — moved the heartbeat onto the dedicated sidecar file; the mechanism the prose must now describe. It changed the code, not the prose — which is why this drift exists.
- **FAFF-338** (Done 2026-07-14) — last rewrote the same Stop-hook "Ownership + liveness gate" paragraph (Edit 6 below), but for different semantics (warn-not-block, FAFF-235). Edit 6 preserves that warn-not-block wording and changes only the bare-`last_heartbeat` staleness reference to the effective/overlaid heartbeat — no conflict.

## 1. WHY — Problem and Principles

**The load-bearing model.** Since FAFF-355 (Done 2026-07-11), a `faff heartbeat` tick writes exactly one thing: the dedicated single-value file `.faff/runs/<run-id>/heartbeat` (one ISO timestamp + newline, atomic tmp + rename). It never touches the run ledger. The ledger's `owner.last_heartbeat` is now a run-start baseline plus a legacy fallback — it is written once at run start and never advances during the run. Every liveness reader takes the *effective* heartbeat: the newer, by epoch, of the sidecar file and `owner.last_heartbeat` (`overlayHeartbeat` / `effectiveHeartbeatIso` in `plugin/skills/faff/bin/lib/heartbeat.js`). A reader who watches only the bare ledger field sees it frozen at the run-start value and mistakes a healthy run for a stalled one — which is exactly the trap the current prose lays.

**Problem statement.** The beep-boop skill still documents the superseded FAFF-234 mechanism — it says a tick field-merges `owner.last_heartbeat = now` atomically into the ledger. That has been wrong for the ~18 days since FAFF-355 shipped, and it cost roughly twenty minutes of one live autonomous run chasing a liveness bug that did not exist: a frozen `owner.last_heartbeat` looked precisely like the documented field-merge failing. This change rewrites the six drifted spots so the prose describes the sidecar-file mechanism the code actually runs.

**Design principles.**

**Correct the mechanism, keep every true surrounding claim.** The drifted spots sit inside paragraphs that are otherwise accurate — the 900s `FAFF_RUN_HEARTBEAT_STALE_SECS` threshold, refreshing across the whole graft lifecycle (not just at issue boundaries), in-build ticks from the dispatched build subagent, liveness being owner-emitted rather than worktree-mtime-inferred, the `owner.status:"done"` close being the orchestrator's one direct ledger edit. Only the *write target* of a tick is wrong. Rewrite that; leave the rest standing.

**Prose must match code, and say why the design is better — without overclaiming.** The sidecar closes the concurrent-outcome-write race structurally: a single-value tmp+rename file cannot be clobbered by a whole-file ledger write, so there is no interleaving for a tick and an outcome write to lose. The old field-merge could only narrow that race, never close it. State that plainly. This is an attested property of the code, not an enforcement claim needing a linked artifact, so it is described as how the mechanism behaves, not as a guarantee some check upholds.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/heartbeat.js` | JavaScript | Ground truth for the shipped mechanism — the file the prose must now match |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown | The one file this change edits |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | Markdown | Sibling prose that already describes the sidecar correctly (the target voice) |
| `docs/guide/cli.md` | Markdown | The heartbeat + sentry rows, already accurate — a second correct reference |

**Scope.** This sits in the beep-boop skill's run-ledger / owner-stamp / Stop-hook documentation. It is the prose layer over the FAFF-355 liveness mechanism, not the mechanism itself.

## 2. OUT OF SCOPE

- **Any change to `heartbeat.js` or the other liveness readers** — Why excluded: the code is correct and shipped; this ticket is prose catching up to it. Extension point: none needed — the mechanism is done.
- **Dropping or renaming `owner.last_heartbeat`** — Why excluded: the field is still load-bearing as the pre-upgrade/legacy overlay fallback (`effectiveHeartbeatIso` takes the newer of file and field; a pre-FAFF-355 ledger with no sidecar reads its liveness from the field alone). Renaming it to say "run-start baseline" would touch `heartbeat.js`, `runcheck.js`, `sentrycheck.js`, `config.js`, `prepcheck.js` and the ledger schema — a code change well beyond a doc fix. Extension point: a future ticket over the ledger schema + those readers (see Open Questions).
- **A lint or mechanical guard against prose-describes-superseded-mechanism drift** — Why excluded: a stale mechanism *description* is not mechanically checkable the way a dangling path is (the FAFF-678 case). Extension point: covered in Open Questions as a punt, not invented here.
- **The already-correct sibling surfaces** — `faffter-noon-concurrency-sequential/SKILL.md:38`, `faffter-dark-concurrency-parallel/SKILL.md:52`, `docs/guide/cli.md:64` and `:79`. Why excluded: verified accurate against the code (see Assumptions) — editing them would be churn. Extension point: none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| heartbeat sidecar | The dedicated single-value file `.faff/runs/<run-id>/heartbeat` — one ISO timestamp + newline, written atomically (tmp + rename). A `faff heartbeat` tick's only write. |
| effective heartbeat | The liveness instant a reader actually uses: the newer, by parsed epoch, of the sidecar file's timestamp and `owner.last_heartbeat`. Computed by `overlayHeartbeat` / `effectiveHeartbeatIso`. |
| run-start baseline | What `owner.last_heartbeat` now is — written once at run start, never advanced by a tick; serves as the overlay fallback for a pre-FAFF-355 ledger that has no sidecar. |
| field-merge (superseded) | The pre-FAFF-355 (FAFF-234) mechanism the prose wrongly still describes: a tick re-read the ledger and merged `owner.last_heartbeat = now` back into it. |

There are no type or interface changes — this ticket introduces no code. The "types" here are the corrected factual claims the prose must carry, enumerated as the six edits in HOW.

## 4. HOW — Behavior

**Approach.** Edit `plugin/skills/faff-beep-boop/SKILL.md` in place at six spots. Each edit swaps a field-merge description for the sidecar mechanism while preserving the true claims around it. Match the voice of the already-correct sibling prose (`faffter-noon-concurrency-sequential/SKILL.md:38`: "the tick's atomic replace of the dedicated heartbeat file"). No new labelling schemes, no new sections; the prose stays skimmable and passes the house voice.

The six spots, in document order:

```
EDIT 1 — line 349, the ledger JSON example (owner block)
  Was: "last_heartbeat": "2026-06-22T16:07:00Z"  (7 min ahead of started_at 16:00:00Z)
  Now: last_heartbeat equals started_at ("2026-06-22T16:00:00Z"), OR is annotated
       run-start-only. The field must not read as if it advanced during the run.

EDIT 2 — line 363, the owner ** bullet
  Was: "refresh last_heartbeat across the whole graft lifecycle"
  Now: what each tick refreshes is the heartbeat sidecar; owner.last_heartbeat is the
       run-start stamp. Keep "stamp at run start ... close at exit".

EDIT 3 — line 367, the started_at / last_heartbeat sub-bullet
  Was: "last_heartbeat is refreshed across the whole lifecycle"
  Now: owner.last_heartbeat is written once at run start (the run-start baseline); the
       sidecar file is what advances each tick. Keep started_at written once at run start.

EDIT 4 — line 381, the "Refresh ... via faff heartbeat" bullet (the headline defect)
  Was: "the single sanctioned write path: it field-merges owner.last_heartbeat = now
        atomically, re-reading the ledger first so it never clobbers a concurrent
        outcome write"
  Now: the tick writes the dedicated <run-dir>/heartbeat sidecar (atomic tmp + rename)
       and never touches the ledger — which is what structurally closes the
       concurrent-outcome-write race (a single-value tmp+rename file cannot be clobbered
       by a whole-file ledger write; the old field-merge could only narrow that race).
       Keep: refresh across the whole graft lifecycle, in-build ticks from the dispatched
       build subagent (faff-graft Step 7.5 / Step 9), the 900s FAFF_RUN_HEARTBEAT_STALE_SECS
       threshold, owner-emitted-not-worktree-mtime-inferred liveness.

EDIT 5 — line 384, "only via faff heartbeat (the owner.status:'done' close ...)"
  Was: implies faff heartbeat writes the owner block
  Now: faff heartbeat writes the sidecar, not the owner block. Preserve the true point:
       the hook never writes; only the run's own agents write liveness state; the
       owner.status:"done" close at exit is the orchestrator's one direct ledger edit.

EDIT 6 — line 397, the Stop hook "Ownership + liveness gate"
  Was: "last_heartbeat staler than FAFF_RUN_HEARTBEAT_STALE_SECS"
  Now: the hook overlays the sidecar first and checks the EFFECTIVE heartbeat (the newer
       of sidecar file + owner.last_heartbeat), not the bare field. Reference the
       effective/overlaid heartbeat. (runcheck --hook does exactly this: heartbeat.js
       overlayHeartbeat at runcheck.js:210, before the liveness gate.) Preserve FAFF-338's
       warn-not-block semantics on this paragraph — only the staleness reference changes.
```

**Anti-pattern:** rewriting the surrounding true claims while fixing the mechanism. Why: the 900s threshold, the whole-lifecycle refresh cadence, the in-build ticks, and the owner-emitted-liveness rationale are all correct and load-bearing — only the write *target* is wrong. Touch the target, leave the rest.

**Anti-pattern:** describing the sidecar's race-closure as something a check *enforces*. Why: it is a structural property of the write mechanism (tmp+rename of a single-value file), not a guarantee upheld by a linked artifact. Narrating an attested property as an enforced one is itself a documentation bug under the house voice.

**Anti-pattern:** introducing a `faff validate-adapters` violation. Why: this is a faff-skill SKILL.md — the edits must not add a shell-read of the rc file, must not duplicate a governed block, and must leave the file passing `faff validate-adapters`.

## 5. Scenarios

This is a prose correction; its "main objective" is a small set of concrete, greppable facts holding in one file. The observable is mechanical, so these are assertion-form scenarios rather than Given-When-Then.

- The string `field-merge` (and the phrase `field-merges owner.last_heartbeat`) MUST NOT appear in `plugin/skills/faff-beep-boop/SKILL.md` describing a heartbeat tick.
- The ledger JSON example's `owner.last_heartbeat` MUST equal `started_at` (or be annotated run-start-only) — it MUST NOT read as advanced past `started_at`.
- The Stop-hook "Ownership + liveness gate" paragraph MUST reference the effective / overlaid heartbeat, not a bare `last_heartbeat` staleness check.
- The line-381 "Refresh ... via faff heartbeat" bullet MUST state the tick writes the dedicated `<run-dir>/heartbeat` sidecar and never the ledger, AND MUST retain the 900s `FAFF_RUN_HEARTBEAT_STALE_SECS` threshold and the in-build-subagent tick claim.
- `faff validate-adapters` MUST pass over the edited file (no new rc shell-read, no duplicated-block violation).

## 6. DESIGN DECISION RATIONALE

**Should this ticket also drop or rename `owner.last_heartbeat` now that it is only a run-start baseline?**
Options: (a) rename it in code to say what it is; (b) drop it entirely; (c) keep it as-is, document it accurately, punt any rename. Rename/drop touches `heartbeat.js`, `runcheck.js`, `sentrycheck.js`, `config.js`, `prepcheck.js` and the ledger schema, and would break the zero-migration overlay for pre-FAFF-355 ledgers — a real code change with migration risk, not a doc fix.
**Chosen:** (c) keep the field as-is and document it accurately as the run-start baseline + legacy fallback. This ticket is docs-only. The rename is captured as a punt below. (decides: architecture)

**Should this ticket add a mechanical guard against prose-describes-superseded-mechanism drift?**
Options: (a) build a lint like FAFF-678's dangling-path check; (b) no guard, resolve as a punt. FAFF-678's lint works because a dangling path is mechanically checkable — the path either resolves or it doesn't. A stale mechanism *description* has no such mechanical anchor: "this prose describes field-merge but the code writes a sidecar" requires reading both prose and code and understanding both. A regex for `field-merge` catches this one instance, not the class, and would rot into a fragile guard that fails on legitimate future prose.
**Chosen:** (b) no mechanical guard in this ticket — a stale mechanism description is caught by a human or agent reading prose against code, which is what happened here. Gold-plating a lint into a doc fix is out of scope. The general question is punted below. (decides: any)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

**Punt:** Rename or drop `owner.last_heartbeat` to reflect that it is now a run-start baseline, not a live-advancing field. A separate code change over the ledger schema and the five readers listed above, with migration handling for pre-FAFF-355 ledgers. File as a follow-up only if the naming confusion recurs; not required for this fix. (decides: architecture)

**Punt:** A general guard for prose-describes-superseded-mechanism drift. No cheap mechanical check exists (unlike FAFF-678's dangling-path case); worth a follow-up only if this class of drift recurs often enough to justify a heavier detector (e.g. a periodic prose-vs-code audit pass), not a brittle keyword lint. (decides: any)

**Assumptions.**

**Assumes:** `plugin/skills/faff/bin/lib/heartbeat.js` describes the ground-truth mechanism — a tick's only write is `<run-dir>/heartbeat` via tmp+rename (`writeHeartbeatFile`, l.150-152), the ledger read is a read-only `owner.status === "running"` guard (`cmdHeartbeat`, l.437-443), and readers overlay via `overlayHeartbeat` / `effectiveHeartbeatIso` (l.49-82). Validate: re-read those lines before editing; the block comment at l.14 states it directly.

**Assumes:** the sibling surfaces are already correct and need no edit — `faffter-noon-concurrency-sequential/SKILL.md:38`, `faffter-dark-concurrency-parallel/SKILL.md:52`, `docs/guide/cli.md:64` and `:79`. Validate: confirmed accurate against `heartbeat.js` at spec time; re-grep them for `field-merge` before finishing to be sure the fix stays bounded to one file.

## 8. DONE — Definition of Done

### From WHY
- [ ] No occurrence of `field-merge` (or `field-merges owner.last_heartbeat`) describes a heartbeat tick anywhere in `plugin/skills/faff-beep-boop/SKILL.md`.
- [ ] The prose states a tick's only write is the dedicated `<run-dir>/heartbeat` sidecar (atomic tmp + rename) and that it never touches the run ledger.
- [ ] The prose states `owner.last_heartbeat` is a run-start baseline + legacy/overlay fallback, written once at run start.

### From WHAT (corrected claims)
- [ ] The sidecar's race-closure is described as a structural property of tmp+rename, not as an enforced guarantee.
- [ ] Surrounding true claims are retained verbatim in substance: 900s `FAFF_RUN_HEARTBEAT_STALE_SECS`, whole-graft-lifecycle refresh cadence, in-build ticks from the dispatched build subagent, owner-emitted (not worktree-mtime-inferred) liveness, the `owner.status:"done"` close as the one direct ledger edit.

### From HOW (the six edits)
- [ ] Edit 1 (line ~349): the ledger JSON example shows `owner.last_heartbeat == started_at`, or annotates it run-start-only.
- [ ] Edit 2 (line ~363): the owner `**` bullet frames each tick as refreshing the sidecar; `owner.last_heartbeat` is the run-start stamp.
- [ ] Edit 3 (line ~367): the `started_at` / `last_heartbeat` sub-bullet says `owner.last_heartbeat` is written once at run start; the sidecar advances.
- [ ] Edit 4 (line ~381): the headline bullet says the tick writes the `<run-dir>/heartbeat` sidecar, never the ledger, and gives the structural race-closure reason.
- [ ] Edit 5 (line ~384): the sentence reflects that `faff heartbeat` writes the sidecar, not the owner block, while keeping "the hook never writes; the owner.status:'done' close is the one direct ledger edit".
- [ ] Edit 6 (line ~397): the Stop-hook gate references the effective / overlaid heartbeat (newer of sidecar + field), not the bare field; FAFF-338's warn-not-block wording is preserved.

### Born-verifiable oracles (grep)

Every DoD box above is made mechanically checkable here: each edit gets an exact **ABSENT-after** string (the drifted text, verified present in the file at spec time — the base text the oracle diffs against) and a **PRESENT-after** token the corrected prose must carry. Run from repo root against `plugin/skills/faff-beep-boop/SKILL.md` (`BB`); `grep -F` (fixed-string) unless noted. `ABSENT` = returns no match; `PRESENT` = returns a match.

- **Edit 1 — JSON example.** ABSENT: `"last_heartbeat": "2026-06-22T16:07:00Z"`. PRESENT: `"last_heartbeat": "2026-06-22T16:00:00Z"` (equals `started_at`) **or** the same line carries a run-start-only annotation (e.g. `run-start`).
- **Edit 2 — owner bullet (~l363).** ABSENT: `refresh \`last_heartbeat\` **across the whole graft lifecycle**`. PRESENT: the bullet names the sidecar as what a tick refreshes and calls `owner.last_heartbeat` the run-start stamp (grep for `sidecar` within the owner bullet).
- **Edit 3 — sub-bullet (~l367).** ABSENT: `\`last_heartbeat\` is **refreshed across the whole lifecycle**`. PRESENT: `written once at run start` applied to `owner.last_heartbeat`, with the sidecar named as what advances.
- **Edit 4 — headline (~l381).** ABSENT: `field-merges \`owner.last_heartbeat = now\``; additionally a whole-file `grep -nF field-merge BB` returns no line describing a heartbeat tick. PRESENT (all three): `<run-dir>/heartbeat` sidecar named as the tick's only write; an explicit "never touches the ledger" (or equivalent negation); the structural race-closure clause (`tmp` + `rename` single-value file cannot be clobbered by a whole-file ledger write). RETAIN (still match): `FAFF_RUN_HEARTBEAT_STALE_SECS`, `900s`, and the in-build build-subagent tick (`BuildDispatch`).
- **Edit 5 — (~l384).** ABSENT-as-written: the clause reading as if `faff heartbeat` writes the owner block. PRESENT: `faff heartbeat` writes the sidecar; RETAIN the true point `owner.status:"done"` close is the orchestrator's one direct ledger edit, and "the hook … never writes".
- **Edit 6 — Stop-hook gate (~l397).** ABSENT-as-written: a bare-field staleness check (`\`last_heartbeat\` staler than \`FAFF_RUN_HEARTBEAT_STALE_SECS\`` presented as the check target). PRESENT: `effective` / overlaid heartbeat referenced as what the gate checks (newer of sidecar + `owner.last_heartbeat`). RETAIN (FAFF-338 warn-not-block): `WARNs, never blocks` still matches.

**Retained-claims grep set (gap-2 oracle).** After the edits, each token below MUST still `grep -F` match somewhere in `BB` — the true surrounding claims survive the fix:

```
grep -Fq 'FAFF_RUN_HEARTBEAT_STALE_SECS' BB   # staleness threshold name
grep -Fq '900s' BB                            # the threshold value
grep -Fq 'owner.status:"done"' BB             # the one direct ledger edit
grep -Fq 'worktree mtime' BB                  # owner-emitted, not mtime-inferred
grep -Fq 'BuildDispatch' BB                   # in-build tick / run_dir forward
grep -Fq 'WARNs, never blocks' BB             # FAFF-338 warn-not-block preserved
```

(All six must exit 0. `BB` = `plugin/skills/faff-beep-boop/SKILL.md`.)

### From HOW (governance / voice)
- [ ] `faff validate-adapters` passes over the edited file (no new rc shell-read, no duplicated-block violation).
- [ ] The edits read as skimmable house voice — no invented labelling scheme, no PM jargon — matching the sibling prose at `faffter-noon-concurrency-sequential/SKILL.md:38`.

### From OUT OF SCOPE (bounded)
- [ ] No file other than `plugin/skills/faff-beep-boop/SKILL.md` is edited (the sibling surfaces and `heartbeat.js` are untouched).

**Integration smoke test:**

```
PROCEDURE verify_fix:
  BB=plugin/skills/faff-beep-boop/SKILL.md
  1. grep -nF "field-merge" $BB
     -> no line describes a heartbeat tick as a field-merge
  2. grep -nF "heartbeat" $BB
     -> the six spots reference the dedicated <run-dir>/heartbeat sidecar / effective heartbeat
  3. grep -F '"last_heartbeat": "2026-06-22T16:00:00Z"' $BB   # == started_at (or annotated run-start-only)
  4. for t in 'FAFF_RUN_HEARTBEAT_STALE_SECS' '900s' 'owner.status:"done"' 'worktree mtime' 'BuildDispatch' 'WARNs, never blocks'; do
       grep -Fq "$t" $BB || echo "MISSING: $t"   # retained-claims set, expect no output
     done
  5. grep -nF field-merge plugin/skills/faffter-noon-concurrency-sequential/SKILL.md \
       plugin/skills/faffter-dark-concurrency-parallel/SKILL.md docs/guide/cli.md
     -> no matches (siblings stay correct/untouched)
  6. faff validate-adapters  -> exits clean (no new violation on this file)
  7. git status --porcelain  -> only plugin/skills/faff-beep-boop/SKILL.md is modified
```

confidence: high
spec-review: approve · 2026-08-04 (faffter-dark-spec-review, lenses architectural/infosec/methodology/QA, single-pass L3; contract exit 0)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "punt" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
