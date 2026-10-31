*Agent-written (Claude Code): FAFF-1444 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1–3.*

# FAFF-1444: Budget `until` ceiling never breaches — anchor the deadline at the run's start

> Spec: faffter-dark-nlspec · 2026-10-30 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1444.

This spec is for the build agent and its reviewers. It fixes one gate defect in `faff budget check`: the `until` wall-clock ceiling is resolved against the current time on every check, so it can never breach. The fix resolves the deadline against the run's original start, in the timezone the run was minted in.

## 1. WHY

**The load-bearing idea:** "a past time is next-day" is a launch rule. It must be applied once, against the instant the run started, not again on every check.

**Problem.**
- `untilToEpoch(hhmm, nowMs)` (`plugin/skills/faff/bin/lib/budget.js` l. 322–331) builds today's HH:MM and adds 24 hours when that is at or before `nowMs`.
- `budgetCheckCompose` calls it with the check's own clock (`budget.js` l. 1177: `untilToEpoch(env.ceilings.until, nowMs)`).
- `computeBudgetState` breaches `until` only when `now_epoch >= until_epoch` (l. 430). Because the deadline is always later than `nowMs`, `until` can never breach.
- Every consumer reads the budget through this one site: `faff sentry check` (`budget-breach`), `faff run-done --budget`, and `faff run checkpoint` (FAFF-1436, PR #1169). So `beep-boop --until 06:00` and an `until`-only L4 governor (`faff lights-out` accepts `budget.until` as its spend/time ceiling) never stop a run.
- The selftest only drives `computeBudgetState` with a hand-set `until_epoch`, so nothing caught it. FAFF-1436's build reproduced it two ways (`discovered-scope.json`), and FAFF-1436's scenarios 4 and 5 (5 is a holdout) cannot pass until it is fixed. FAFF-1444 blocks FAFF-1436 in the tracker for that reason.

### Design principles

**Never weaken a gate.** Where the anchor is unknown, the ceiling counts as reached, never as unbounded. The current bug is the never-breaching direction; the fix must not keep any path that lands there.

**One read site, one new mint field.** Every ledger mint already records `owner.started_at`, and a resume keeps the prior owner in `owner_history`, so the anchor instant needs no new state. "06:00" also needs a timezone, and the ledger records none today, so each mint records its UTC offset in one new owner field, `utc_offset_min`.

### Reference context

- `plugin/skills/faff/bin/lib/budget.js`: `parseHHMM` l. 308, `untilToEpoch` l. 322, `resolveUntil` l. 339, `computeBudgetState` l. 426, `budgetCheckCompose` (the `runStartMs` resolution at l. 986–987 and the call at l. 1177), `envelopeFromLedger` l. 1472.
- `plugin/skills/faff/bin/lib/resume.js` `applyResumeToLedger` l. 152: pushes the prior `owner` onto `owner_history` and writes a new `owner` whose `started_at` is the resume instant.
- Mints that write `owner.started_at`: `run-ledger.js` `buildInteractiveLedger` l. 108 and `buildSelfDrainLedger` l. 133; `lights-out.js` mint l. 1188.
- `test/budget.test.mjs`: `fixture`, `baseLedger` (`owner.started_at: "2026-06-23T15:00:00Z"`), and the FAFF-302 `--now-ms` clock seam.

### Already shipped against this surface

- **FAFF-364:** a malformed `until` degrades to a warning and never breaches at `budget check`; `faff lights-out` refuses to mint with one. This fix keeps both behaviours unchanged.
- **FAFF-302:** the explicit `--now-ms` / `--now` clock seam the tests use.
- **FAFF-312:** `until` counts as an L4 spend/time governor at mint. It does nothing until this fix lands, which is why this is a gate defect.

The premise holds: no Done ticket anchors the deadline.

## 2. OUT OF SCOPE

- **Extending a resumed run's deadline.** A resume keeps the original deadline (see §4.2). Giving an operator a way to set a new deadline on `faff lights-out --resume` would be a new feature. **Extension point:** `lights-out.js` resume arguments plus a recorded override in `budget.envelope`.
- **Persisting the resolved deadline in the ledger.** Not needed, because the anchor is already durable. **Extension point:** `budget.envelope` in the lights-out mint.
- **The `--until ISO` wording in `faff lights-out`'s usage string** (`lights-out.js` l. 782). The parser accepts only `HH:MM`; the usage text is stale. That is a one-line docs fix and belongs in its own ticket, so this diff stays one behaviour change.
- **FAFF-1436's scenario wording.** That spec is accepted, so this ticket does not edit it. §4.4 notes what its scenarios 4 and 5 need.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| run origin | The earliest parseable `started_at` among `ledger.owner_history[*]` and `ledger.owner`. It is the instant the run was first minted, and it survives resumes. |
| origin offset | The `utc_offset_min` recorded on the same owner entry as the run origin: the minting process's UTC offset in minutes (UTC+1 is `60`). |
| deadline | The absolute instant the `until` ceiling resolves to: the first HH:MM, in the origin offset, strictly after the run origin. |

### Interface

**Ledger.** Every CLI mint and every resume writes `owner.utc_offset_min: integer` beside `owner.started_at`: `-new Date(started_at).getTimezoneOffset()` in the writing process. Readers treat a missing or non-integer value as absent.

**`faff budget check`** keeps its flags, exit codes and existing fields. Three things change:

```
spent.until_at: ISO-8601 string | null
                                    # key present ONLY when ceilings.until is non-null.
                                    # A string: the anchored deadline this check compared against.
                                    # null: the anchor was unusable, so until is treated as reached.
warnings[]: gains one possible entry, "budget.until has no usable run-start anchor (<reason>) — until treated as reached",
            where <reason> is "owner.started_at missing or unparseable" or "run start is in the future"
warnings[]: gains "budget.until resolved in this box's timezone (the run records no UTC offset)"
            when the origin entry has no utc_offset_min (a ledger minted before this fix)
```

- `breached` contains `"until"` once the check's clock is at or after the deadline.
- For a run with a usable anchor, the deadline is the same on every check, whatever the check's clock.

### Where the code lives

Small edits to existing JavaScript modules, so they stay JavaScript:
- `plugin/skills/faff/bin/lib/budget.js`: `runOrigin`, `untilToEpochAtOffset`, and the call site.
- `plugin/skills/faff/bin/lib/run-ledger.js` (`buildInteractiveLedger`, `buildSelfDrainLedger`), `lights-out.js` (the mint owner block) and `resume.js` (`applyResumeToLedger`'s new owner): write `utc_offset_min`.

Tests go in `test/budget.test.mjs`, plus one case each in the existing `test/` files for the run-ledger, lights-out and resume writers.

## 4. HOW

### 4.1 Procedure

```
FUNCTION runOrigin(ledger) -> { ms, offset_min } | null:     # pure, exported
  candidates := []
  FOR o IN (ledger.owner_history if an array else []) + [ledger.owner]:
    IF o is an object AND Date.parse(o.started_at) is finite:
      append { ms: Date.parse(o.started_at),
               offset_min: o.utc_offset_min if an integer in [-840, 840] else null }
  RETURN the candidate with the smallest ms (first such on a tie), or null when empty

FUNCTION untilToEpochAtOffset(hhmm, anchorMs, offsetMin) -> epoch-ms | null:   # pure, exported
  parsed := parseHHMM(hhmm); IF null: RETURN null
  wall := anchorMs + offsetMin * 60000                 # the anchor as wall-clock, read as UTC fields
  t := Date.UTC(year(wall), month(wall), day(wall), parsed.h, parsed.min) - offsetMin * 60000
  IF t <= anchorMs: t += 24h
  RETURN t

CONSTANT ORIGIN_SKEW_MS = 300000                       # 5 min: tolerated cross-box clock skew

In budgetCheckCompose, replacing l. 1177:
  IF env.ceilings.until == null:
    untilEpoch := null; no until_at key                 # unchanged: no ceiling
  ELSE IF runDir == null:                               # the legitimately-empty surface (no run)
    untilEpoch := untilToEpoch(env.ceilings.until, nowMs)   # unchanged from today: nothing to govern
    until_at := ISO(untilEpoch)
  ELSE:
    origin := runOrigin(ledger)
    IF origin == null:
      reason := "owner.started_at missing or unparseable"
    ELSE IF origin.ms > nowMs + ORIGIN_SKEW_MS:
      reason := "run start is in the future"
    IF reason is set:
      untilEpoch := nowMs                               # fail toward breaching
      until_at := null
      warnings += "budget.until has no usable run-start anchor (<reason>) — until treated as reached"
    ELSE IF origin.offset_min != null:
      untilEpoch := untilToEpochAtOffset(env.ceilings.until, origin.ms, origin.offset_min)
      until_at := ISO(untilEpoch)
    ELSE:                                               # pre-fix ledger: no recorded offset
      untilEpoch := untilToEpoch(env.ceilings.until, origin.ms)   # this box's local timezone, as today
      until_at := ISO(untilEpoch)
      warnings += "budget.until resolved in this box's timezone (the run records no UTC offset)"
  spent.until_at := until_at   (key present only when env.ceilings.until != null)
```

- `untilToEpoch` itself is unchanged. It is still used for the no-run surface and for pre-fix ledgers, with its second argument now the anchor rather than the clock in the latter case. Its doc comment is updated to say so.
- `runStartMs` (l. 986–987, the current owner's `started_at`) is unchanged and still feeds `elapsed_ms` and the token baseline windows. Only the `until` deadline uses the run origin.
- The `--until` flag still wins over the recorded or config value (FAFF-364 precedence), and is anchored the same way.
- The missing-anchor warning joins the existing `warnings` array and mirrors to stderr like the other `budget check` warnings. Exit stays 0, because a non-zero exit is read as unbreached by `sentryReadBudget` and `run-done --budget`.

### 4.2 Decisions

**Which instant anchors the deadline.**

| Option | Effect |
|---|---|
| The check's clock (today) | Never breaches. This is the bug. |
| The current owner's `started_at` | Shifts on every `lights-out --resume`: a run resumed after its deadline would get another day. |
| The run origin (earliest `started_at` across `owner_history` and `owner`) | Fixed for the whole run, including across resumes. |
| A deadline persisted at mint | Needs a new ledger field and a write at every mint path, including beep-boop's prose-written envelope; pre-fix ledgers would still lack it. |

**Chosen:** the run origin. It is already durable on every ledger, covers every mint path including pre-fix ledgers, and cannot drift on resume.

**A run resumed after its deadline.** **Chosen:** it breaches at the first check after the resume. The operator's `until` is a wall-clock instruction for the run, and a resume does not restate it. To keep working past it, the operator mints a new run. Granting a fresh day on resume is the never-breaching direction this ticket removes.

**Pre-fix ledgers, and a missing, unparseable or future anchor.** Every ledger minted by `run-ledger init-interactive`, `run-ledger init-self-drain` or `faff lights-out` carries `owner.started_at`, so a pre-fix ledger needs no migration: its deadline is now computed from its origin. A ledger with an `until` ceiling but no parseable `started_at` anywhere can only come from a hand-written or corrupt ledger. A `started_at` more than five minutes in the future is the same class of corrupt input. **Chosen:** treat `until` as reached, print `until_at: null` and warn, naming which case it was. The alternatives are worse: falling back to the check's clock is the current never-breach bug, and exiting non-zero reads as unbreached to `sentryReadBudget` and `run-done --budget` (fail-open).

**Whose timezone "06:00" is in.** The checking process's local timezone is today's rule, but the checks need not run where the run was minted: a run minted in a UTC container and checked from a host in UTC+1 would get a deadline an hour apart, and offsets can differ by up to a day. **Chosen:** the minting process's UTC offset, recorded on the owner at mint. That is the operator's wall-clock when they set the ceiling, and every box then resolves the same instant. A fixed offset means a run that crosses a daylight-saving change resolves `until` in the offset it started in, which is at most an hour off the new local time; that is documented, not corrected. A ledger minted before this fix has no offset; it resolves in the checking box's timezone, as today, with a warning, because there is no recorded fact to prefer and those ledgers are in-flight runs that age out.

**A start exactly at HH:MM.** **Chosen:** keep `untilToEpoch`'s strict "after" rule (`t <= anchor` rolls a day). A run started at 06:00 with `--until 06:00` runs until 06:00 the next day. That matches the documented launch rule, and changing it is not this ticket.

### 4.3 Docs

- `plugin/skills/faff-beep-boop/SKILL.md` l. 65, the `until` row: one in-place edit adding "resolved once against the run's start, and kept across a resume". It must not change the line count (`SKILL_LINE_BASELINE`).
- `docs/guide/cli.md`, the `budget check` row (l. 126): one sentence on the deadline anchor, `spent.until_at`, and the missing-anchor warning.

### 4.4 Edge cases

- **Midnight.** Run origin 23:55, `until 23:58`, check at 00:02 the next day: deadline 23:58 on the origin's day, so the check is breached.
- **A long run.** Run origin 23:00, `until 06:00`: deadline 06:00 the next day, so a check at 05:59 is not breached and a check at 06:00 is.
- **Timezone.** HH:MM is wall-clock in the run's recorded offset. Tests pin `TZ=UTC` in the child env and set `utc_offset_min` in the fixture, so the expected instants are fixed and the offset is exercised independently of the box.
- **Cross-box.** A check whose process timezone differs from the recorded offset resolves the same deadline as one in the minting timezone.
- **Malformed `until`.** Unchanged (FAFF-364): `ceilings.until` is null, so no deadline is computed and no `until_at` key is printed.
- **No run.** `cmdBudget` still calls `budgetCheckCompose` on the legitimately-empty surface, with `runDir` null and `ledger` `{}` (`budget.js` l. 942–944). That path keeps today's clock-relative deadline: there is no run to stop, so it never takes the missing-anchor branch and never warns. It prints `until_at` when an `until` ceiling is configured.
- **A future run start.** A `started_at` more than five minutes after the check's clock comes from a corrupt or hand-written ledger; anchoring on it would push the deadline past the bogus date and never breach. It takes the same fail-toward-breaching branch as a missing anchor, with its own warning reason. Up to five minutes ahead is tolerated as clock skew between boxes and anchors normally.
- **FAFF-1436's scenarios.** Scenario 4 (attended L3, `until` in the past, `stop`) and scenario 5 (L4, `owner.started_at` within the last ten minutes, `until` in the past, `escalate`) breach on the fixed tree when "in the past" means after the run origin and before now. In scenario 5 that is a minute inside the last ten. An `until` time before the run origin resolves to the next day and does not breach. That reading is the deadline rule this ticket defines, not a new requirement on FAFF-1436. The one action it needs sits with FAFF-1436's holdout coordinator (the operator's session, which runs that holdout after FAFF-1444 merges): put the anchor rule in the evaluator's env handle, or have the operator tighten scenario 5's wording. This ticket's DONE does not depend on it.
- **Existing tests.** Several `test/budget.test.mjs` cases set a well-formed `until` (`"06:00"`) on `baseLedger()`, whose origin is 2026-06-23. Under the fix those report `breached: ["until"]`. Their assertions concern warnings only, so they should still pass. If one fails, the builder fixes the fixture's intent (pins `--now-ms` before the deadline), never an assertion about breach behaviour.

### 4.5 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

`budget` is a governance-region module with a selftest. Its `untilToEpoch` rows (l. 1585–1592) stay valid because the function is unchanged; no selftest case is added.

In `test/budget.test.mjs`, each case runs the CLI with `TZ=UTC` and `--now-ms`:
Fixtures set `owner.utc_offset_min: 0` unless the case says otherwise.
- "origin before deadline": origin 2026-10-29T23:00Z, `until 06:00`; at 05:59Z the next day `breached` excludes `until`; at 06:00Z it includes it; both report `spent.until_at` `2026-10-30T06:00:00.000Z`.
- "past deadline the same day": origin 05:00Z, `until 06:00`, check at 07:00Z: `breached` includes `until`. This is the case that fails on `main`.
- "midnight": origin 23:55Z, `until 23:58`, check at 00:02Z: breached.
- "resume keeps the origin": `owner_history[0].started_at` 23:00Z, `owner.started_at` 07:00Z the next day, `until 06:00`, check at 07:05Z: breached, `until_at` 06:00Z.
- "missing anchor": `until 06:00`, an owner with no `started_at` and no `owner_history`: breached includes `until`, `until_at` is null, `warnings` names the missing anchor, exit 0.
- "future anchor": `owner.started_at` 2027-01-01T00:00Z, `until 06:00`, check at 2026-10-30T07:00Z: breached includes `until`, `until_at` is null, `warnings` names "run start is in the future".
- "skew tolerated": `owner.started_at` 07:03Z, `until 06:00`, check at 07:00Z: not breached, `until_at` 06:00Z the next day, no warning.
- "no run": `budget.until 06:00` configured, no run dir under the root, check at 07:00Z: `breached` excludes `until`, there is no anchor warning, and `until_at` is 06:00Z the next day.
- "recorded offset wins": origin 2026-10-30T03:00Z with `utc_offset_min: 60`, `until 06:00`, check at 05:30Z with `TZ=UTC`: breached, `until_at` 2026-10-30T05:00:00.000Z. The same fixture with the offset key removed reports not breached, `until_at` 06:00Z and the no-offset warning.
- "stable": two checks of one anchored run at different `--now-ms` print the same `until_at`.
- "no until": a run with no `until` ceiling prints no `until_at` key.
- Unit tests of the exported `runOrigin` (the earliest entry's instant and offset; offset null when absent or out of range; null for no parseable `started_at`) and `untilToEpochAtOffset` (offsets -300, 0, 60 and 330, and the roll-over when the HH:MM is at or before the anchor).
- Writers: `buildInteractiveLedger`, `buildSelfDrainLedger` and the lights-out mint each write an integer `owner.utc_offset_min`; `runOrigin(applyResumeToLedger(l))` equals `runOrigin(l)` for a ledger with history, so a resume never moves the origin.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run ledger whose owner.started_at is 2026-10-30T05:00:00Z with utc_offset_min 0 and a budget until ceiling of 06:00, with TZ=UTC
When `faff budget check --run-dir D --root R --now-ms <2026-10-30T07:00:00Z> --json` runs
Then it exits 0
And breached includes "until"
And spent.until_at is "2026-10-30T06:00:00.000Z"
```

```
Given a run ledger whose owner.started_at is 2026-10-29T23:00:00Z with utc_offset_min 0 and a budget until ceiling of 06:00, with TZ=UTC
When `faff budget check --json` runs at 2026-10-30T05:59:00Z and again at 2026-10-30T06:00:00Z (via --now-ms)
Then the first reports breached without "until" and the second reports breached with "until"
And both report spent.until_at "2026-10-30T06:00:00.000Z"
```

```
Given a run ledger with a budget until ceiling of 06:00 and an owner block with no started_at and no owner_history
When `faff budget check --json` runs
Then it exits 0
And breached includes "until" and spent.until_at is null
And warnings names the missing run-start anchor
```

```
Given a run ledger whose owner.started_at is 2026-10-30T03:00:00Z with utc_offset_min 60, and a budget until ceiling of 06:00
When `faff budget check --json` runs at 2026-10-30T05:30:00Z (via --now-ms) once with TZ=UTC and once with TZ=America/New_York
Then both runs exit 0 with breached including "until"
And both report spent.until_at "2026-10-30T05:00:00.000Z"
```

## 5. DESIGN DECISION RATIONALE

- **Anchor at the run origin, not the current owner or a new field.** See §4.2: it is already durable, covers every mint path and pre-fix ledgers, and does not move on resume.
- **Missing anchor counts as reached.** The only other directions are the current never-breach bug or a non-zero exit that consumers read as unbreached.
- **Add `spent.until_at`.** Without it the deadline is invisible, which is how this bug went unnoticed. It is present only when an `until` ceiling is set, so output for runs without one is byte-identical.
- **Leave `untilToEpoch` unchanged and add `untilToEpochAtOffset` beside it.** The local-time function stays right for the no-run surface and pre-fix ledgers, and its selftest rows stay valid with no move into `test/`. The offset version is pure arithmetic on UTC fields, so it does not depend on the box's timezone.
- **Record the mint offset rather than an IANA zone name.** An offset is one integer computable with no timezone database; a zone name would track daylight saving but needs `Intl` zone conversion for every check. The one-hour daylight-saving error over a single run is accepted.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** no writer other than the three mints and `applyResumeToLedger` replaces `ledger.owner` wholesale; every other write merges fields into the existing owner. The prep check found none (`grep -rn "\.owner = \|owner: {" plugin/skills/faff/bin/lib/*.js`: the remaining hits are selftest fixtures and `run-ledger.js` `applyTerminalOutcome`, which keeps the existing object). The builder re-runs that grep and lists the hits in the PR description; the resume-preserves-origin test in §4.5 checks the one writer that does replace it.

## 7. DONE

### From WHY
- [ ] On a run whose origin is before today's HH:MM and whose check clock is after it, `faff budget check` reports `breached` containing `"until"`. It does not on `main`.

### From WHAT
- [ ] `faff budget check --json` prints a `spent.until_at` key exactly when an `until` ceiling is set. For a run with a usable anchor it is an ISO-8601 string, the same on every check of that run.
- [ ] A ledger with an `until` ceiling and no parseable `started_at`, or one more than five minutes in the future, reports `until` breached, `spent.until_at: null`, a `warnings` entry naming which case it was, and exit 0.
- [ ] With no run under the root, a configured `until` produces no anchor warning and no `until` breach, and prints `spent.until_at` as the clock-relative deadline (the first HH:MM after the check's clock).

### From HOW
- [ ] The deadline is computed from the earliest parseable `started_at` across `owner_history` and `owner`. A resumed ledger whose original start is before HH:MM and whose resume is after it breaches at the first check.
- [ ] The deadline is resolved in the origin entry's `utc_offset_min`: the same ledger gives the same `until_at` under `TZ=UTC` and `TZ=America/New_York`. A ledger with no recorded offset resolves in the box's timezone and warns.
- [ ] `run-ledger init-interactive`, `run-ledger init-self-drain`, the `faff lights-out` mint and `lights-out --resume` write an integer `owner.utc_offset_min`, and a resume leaves `runOrigin` unchanged.
- [ ] The PR description lists the owner-writer grep hits from §6, each classified as a mint, a resume or a field merge.
- [ ] `elapsed_ms` and the token baselines still use the current owner's `started_at`; the existing `test/budget.test.mjs` cases pass with no assertion weakened.
- [ ] A malformed `until` still yields no breach, a warning and exit 0 (FAFF-364), and prints no `until_at` key.
- [ ] `faff-beep-boop/SKILL.md` l. 65 says the deadline is resolved once against the run's start and kept across a resume, with the file's line count unchanged; `faff validate-adapters` passes.
- [ ] `docs/guide/cli.md`'s `budget check` row documents the anchor, `spent.until_at` and the missing-anchor warning.

### Tests
- [ ] The §4.5 cases exist in `test/budget.test.mjs` and pass under `node --test`; `budget --selftest` passes with no case added.
- [ ] The PR diff touches no `commissaire*` file.

**Integration smoke test:**
```
mint a ledger with owner.started_at = today 05:00Z, config budget.until "06:00"
TZ=UTC faff budget check --run-dir D --root R --now-ms <today 07:00Z> --json
EXPECT breached ⊇ ["until"], spent.until_at = today 06:00Z
```

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. A call-site change and two pure helpers in `budget.js`, a one-field addition to three owner writers, tests and two doc edits. About a day.
- **Workstream fit?** No issues. It is a governance gate defect discovered by FAFF-1436's build and filed as its own ticket.
- **Deps surfaced?** One to name: FAFF-1436's holdout scenarios 4 and 5 depend on this fix, so FAFF-1444 blocks FAFF-1436 and should merge before FAFF-1436's holdout runs; the holdout coordinator briefs the evaluator on the anchor rule (§4.4). It edits no file PR #1169 changes (`budget.js`, `run-ledger.js`, `lights-out.js` and `resume.js` are untouched there) except `docs/guide/cli.md`, where the two rows are adjacent (a trivial rebase).
- **Risk profile?** The risk is in the direction of change: runs that set `until` will now actually stop, including resumed L4 runs past their deadline. That is the intended behaviour, pinned by the resume and missing-anchor scenarios. No novel integration.
