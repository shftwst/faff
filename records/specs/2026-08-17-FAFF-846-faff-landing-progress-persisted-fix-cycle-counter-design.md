# Spec — FAFF-846: `faff landing-progress` (persisted fix-cycle counter)

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-846.

This is the build spec for FAFF-846. Its audience is the build agent that will implement the verb and the human reviewers of the resulting PR. It specifies a new pure-fold CLI verb and its on-disk record, built as a direct sibling of the already-shipped `review-progress` / `build-progress` checkpoints in `plugin/skills/faff/bin/lib/effects.js`.

## 1. WHY — Problem and Principles

**The load-bearing idea:** this ticket lands a *persistence primitive and its schema* on its own, ahead of the risky landing loop that will consume it. A per-issue fix-cycle counter has to survive a firing boundary (a beep-boop run ending and a later run resuming the same issue), so it lives on disk as a record, not in memory. Freezing that record's shape now lets the downstream consumers build against a *landed* contract rather than a projected one.

**Problem statement.** FAFF-844 (autonomous land-time fixing) needs a persisted per-issue count of how many conflict/regression fix cycles it has spent, bounded so it hard-parks rather than looping forever; FAFF-842 (cross-firing resume) and the Phase 0 bundle (FAFF-819 sweep, FAFF-820 restore) all read that same artifact. Building the counter inside the landing loop would couple a low-risk, independently-testable unit to the highest-risk feature in the set. This ticket delivers only the counter — the record, the pure fold, the CLI verb, and the selftest — so the shared schema is frozen first.

**Design principles.**

- **Mirror the `review-progress` precedent, do not reinvent it.** The record placement, the atomic tmp+rename write, the malformed-reads-as-null tolerance, the `read`-absent-is-exit-3 convention, and the pure-fold-plus-thin-CLI split are all already established by `reviewProgressPath` / `reviewProgressApplyPhase1` / `cmdReviewProgress` / `reviewProgressSelftest`. This verb is the same shape with a different fold. Divergence from that precedent is a defect unless the WHAT below calls it out explicitly.
- **The fold is total and pure.** `landingProgressApplyFixCycle` touches no tracker, no network, no filesystem, no git — same determinism invariant the sibling folds hold. It is a value-to-value function; the CLI wrapper owns all I/O.
- **The cap is enforced at record time, never silently clamped.** The record refuses a 4th fix cycle with a loud non-zero exit. The caller (FAFF-844) is responsible for hard-parking at 3; the record must not paper over a caller bug by clamping a 4th write to 3.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` (`reviewProgress*`, lines ~103–268) | Node.js (CommonJS) | The precedent this verb mirrors: path helper, pure fold, `cmd*` wrapper, selftest. New symbols land in this same file. |
| `plugin/skills/faff/bin/lib/effects.js` (`buildProgress*`, from ~line 270) | Node.js | Second instance of the same checkpoint shape — confirms the pattern, not a one-off. |
| `plugin/skills/faff/bin/faff` (dispatch table ~line 180, require ~line 41) | Node.js | Where `review-progress` → `cmdReviewProgress` is wired; the new verb registers the same way. |
| `plugin/skills/faff/bin/lib/regions.js` (`REGION_MAP` ~line 47, `REGION_SELFTEST_ARGV` ~line 267) | Node.js | `review-progress` / `build-progress` are `governance`-region members with a `--selftest` argv; the new verb joins them. |
| `docs/guide/cli.md` (rows ~152–153) | Markdown | CI-lint-enforced CLI reference (`faff lint-cli-doc`); a new verb needs a row or the lint fails. |
| `test/effects.test.mjs` | Node test runner | Where `review-progress` behaviour is covered end-to-end via the built CLI. |

**Scope statement.** This is a leaf utility in the faff CLI's checkpoint family — a persisted counter consumed later by the landing loop and the Phase 0 recovery bundle, wired into the same dispatch, region, doc, and test surfaces as its siblings.

## 2. OUT OF SCOPE

- **Landing-loop integration** — the code that *calls* `record-fix-cycle` and hard-parks at 3. *Why excluded:* that is FAFF-844, the risky unit this split deliberately defers. *Extension point:* FAFF-844's graft/landing-loop code invokes `faff landing-progress record-fix-cycle …` and reads the count.
- **Cross-firing resume consumption** — reading the record on a later executor to resume a stranded PR. *Why excluded:* FAFF-842. *Extension point:* FAFF-842 calls `faff landing-progress read`.
- **Phase 0 bundle sweep/restore** — including `landing-progress.json` in the immutable recovery bundle. *Why excluded:* FAFF-819 / FAFF-820. *Extension point:* those tickets add the file to the bundle manifest; this ticket only guarantees its path and schema.
- **Any change to** the landing loop, graft, `merge-gate.js`, `faffter-noon-ship`, `disposition.js`, or `faff-beep-boop`. *Why excluded:* stated non-goal — this ticket is additive-only. *Extension point:* the consumers above.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Fix cycle | One attempt by the (future) landing loop to resolve a conflict or CI regression on a PR. The counter records how many have been spent for an issue. |
| Firing boundary | The end of one beep-boop run and the start of a later one; state that must survive it lives on disk. |

**Record schema.** Written to `<run_dir>/<issue>/landing-progress.json` (via a `landingProgressPath(runDir, issue)` helper mirroring `reviewProgressPath`).

```
RECORD LandingProgress:
  issue: String                 # the issue id, e.g. "FAFF-846"
  fix_cycles: Int               # 0..3; INVARIANT fix_cycles == length(history)
  last_head_sha: String | null  # PR head sha stamped by the most recent fix cycle; null before the first
  history: List<HistoryEntry>   # append-only, one entry per fix cycle
  updated_at: String            # ISO-8601, stamped on every fold

RECORD HistoryEntry:
  cycle: Int                    # 1-based ordinal of this fix cycle (== its index+1 in history)
  kind: "conflict" | "regression"
  failing_checks: List<String>  # the checks that were failing (may be empty)
  tried: List<String>           # what the fix cycle attempted (may be empty)
  at: String                    # ISO-8601 timestamp of this cycle

  CONSTRAINT fix_cycles == length(history)
  CONSTRAINT fix_cycles <= 3
```

**Kind vocabulary.** A `LANDING_FIX_KINDS = new Set(["conflict", "regression"])` constant in `effects.js`, mirroring how `REVIEW_PHASE2_STATUSES` gates the sibling verb's status flag. An unknown `--kind` is rejected by the CLI.

**Pure fold.**

```
FUNCTION landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso) -> LandingProgress
  # Pure: no tracker, no network, no filesystem, no git. Total over its inputs.
  # Appends exactly one history entry, increments fix_cycles, stamps last_head_sha + updated_at.
```

**Design decision — the fold does not itself enforce the cap.** Two options: (a) the fold throws / returns an error at a 4th call; (b) the fold stays total and the *CLI* rejects the 4th before ever calling the fold.
**Chosen:** (b). The fold stays a total value-to-value function (matching `reviewProgressApply*`, none of which signal errors); the exit-2 rejection of a 4th record lives in `cmdLandingProgress`, which reads the existing record and refuses when `fix_cycles >= 3` before folding. Keeping the guard in the CLI keeps the fold trivially unit-testable and side-effect-free, and puts the loud failure at the I/O boundary where the exit code is observable.

**CLI surface.**

```
faff landing-progress read              <run-dir> <issue>
faff landing-progress record-fix-cycle  <run-dir> <issue> --kind <conflict|regression> --head-sha <sha> [--failing-checks a,b] [--tried x,y]
faff landing-progress clear             <run-dir> <issue>
faff landing-progress --selftest
```

Positional shape `<sub> <run-dir> <issue>` mirrors `cmdReviewProgress` exactly (`positional[0]` sub, `[1]` run-dir, `[2]` issue).

**Design decision — which `record-fix-cycle` flags are required.** `--kind` and `--head-sha` are required (a fix cycle without a kind is unclassifiable; `last_head_sha` is a named schema field the record exists to carry). `--failing-checks` and `--tried` are optional and default to `[]` — a cycle may legitimately have recorded neither, and forcing them would reject valid calls.
**Chosen:** `--kind` + `--head-sha` required (missing → exit 2); `--failing-checks` / `--tried` optional, comma-split into string lists, default empty.

## 4. HOW — Behavior

**Architecture.** One new region in `effects.js` holding four symbols — `LANDING_FIX_KINDS`, `landingProgressPath`, `landingProgressApplyFixCycle`, `cmdLandingProgress`, `landingProgressSelftest` — added to the file's `module.exports`. `bin/faff` gains a `require` destructure for `cmdLandingProgress` and a `"landing-progress": cmdLandingProgress` dispatch-table entry. `regions.js` gains `"landing-progress": "governance"` in `REGION_MAP` and `"landing-progress": ["landing-progress", "--selftest"]` in `REGION_SELFTEST_ARGV`. `docs/guide/cli.md` gains one row. `test/effects.test.mjs` gains coverage.

**The pure fold.**

```
PROCEDURE landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso):
  1. base := (existing is a non-null object) ? existing : {}
  2. history := (base.history is an array) ? copy(base.history) : []
  3. cycle := length(history) + 1
  4. entry := { cycle, kind, failing_checks: (failingChecks ?? []), tried: (tried ?? []), at: nowIso }
  5. history := history + [entry]
  6. RETURN {
       issue: (base.issue ?? issue),
       fix_cycles: length(history),          # invariant: == length(history) by construction
       last_head_sha: (headSha ?? base.last_head_sha ?? null),
       history,
       updated_at: nowIso
     }
```

The fold derives `fix_cycles` from `length(history)` rather than incrementing a separate integer, so the `fix_cycles == length(history)` invariant holds by construction and cannot drift.

**The CLI wrapper.**

```
PROCEDURE cmdLandingProgress(args):
  1. IF "--selftest" in args: RETURN landingProgressSelftest()
  2. positional := args without leading-dash tokens
     sub := positional[0]; runDir := positional[1]; issue := positional[2]
  3. IF sub not in {read, record-fix-cycle, clear} OR not runDir OR not issue:
       stderr(usage); RETURN 2
  4. file := landingProgressPath(runDir, issue)
     readExisting := () => try JSON.parse(readFile(file)) catch -> null   # malformed reads as null

  5. IF sub == "read":
       rec := readExisting()
       IF not rec: RETURN 3               # absent — NOT an error
       stdout(JSON.stringify(rec)); RETURN 0

  6. IF sub == "clear":
       # idempotent: absent file is a no-op success
       IF file exists: removeFile(file)
       RETURN 0

  7. # sub == "record-fix-cycle"
     kind := get("--kind")
     IF kind not in LANDING_FIX_KINDS: stderr(bad-kind); RETURN 2
     headSha := get("--head-sha")
     IF not headSha: stderr(missing --head-sha); RETURN 2
     existing := readExisting()
     IF existing AND existing.fix_cycles >= 3:
        stderr("landing-progress: fix_cycles already at 3 — caller must hard-park, never record a 4th"); RETURN 2
     failingChecks := split(get("--failing-checks"))    # comma-split, default []
     tried := split(get("--tried"))                     # comma-split, default []
     rec := landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso())
     mkdirp(dirname(file)); atomicWrite(file, rec)      # tmp + rename, mirroring cmdReviewProgress
     stdout(JSON.stringify(rec)); RETURN 0
```

**Atomic write.** Byte-for-byte the sibling's pattern: `fs.mkdirSync(dirname, {recursive:true})`, write `JSON.stringify(rec, null, 2) + "\n"` to `file + ".tmp"`, `fs.renameSync(tmp, file)`.

**Edge cases and error handling.**

- **Absent record on `read`** → exit 3 (not an error), no stdout. Retryable/expected — the caller treats exit 3 as "no cycles yet."
- **Malformed on-disk file** → `readExisting()` returns null. On `read` that yields exit 3; on `record-fix-cycle` a null existing seeds a fresh record at cycle 1 (schema-tolerant, matching the sibling's `catch -> null`).
- **Bad `--kind`, missing `--head-sha`, missing positional, unknown sub** → exit 2 with a usage/reason line on stderr. Terminal — a caller bug, surfaced loud.
- **`record-fix-cycle` at `fix_cycles == 3`** → exit 2, no write. The record is never mutated to a 4th cycle; no silent clamp to 3.
- **`clear` when absent** → exit 0 (idempotent).

**Anti-pattern:** clamping a 4th `record-fix-cycle` to `fix_cycles = 3` and returning 0. Why: it hides a caller that failed to hard-park, which is exactly the bug the cap exists to surface.

**Anti-pattern:** enforcing the `<= 3` cap inside the pure fold. Why: it makes the fold partial and couples a policy limit to a value transform; the guard belongs at the CLI I/O boundary where the exit code is observed.

## 5. SCENARIOS — born-verifiable main objectives

```
Given no landing-progress record for FAFF-XX under run-dir R
When `faff landing-progress read R FAFF-XX` runs
Then it exits 3 and prints nothing
```

```
Given no record for FAFF-XX
When `record-fix-cycle R FAFF-XX --kind conflict --head-sha abc --failing-checks ci/test --tried rebase` runs three times (heads abc, def, ghi)
Then after each run fix_cycles is 1, 2, 3, history has that many entries with cycle 1..N, and last_head_sha is the most recent head
And a fourth `record-fix-cycle` exits 2 without modifying the file (fix_cycles stays 3)
```

```
Given a record exists for FAFF-XX
When `faff landing-progress clear R FAFF-XX` runs, then runs again
Then both runs exit 0 and the file is absent afterward (idempotent)
```

- The fold `landingProgressApplyFixCycle` is total: for any `existing` (null, valid record, or the object `{}`) it returns a record satisfying `fix_cycles == length(history)`.
- `record-fix-cycle` rejects an unknown `--kind` with exit 2.
- `landing-progress --selftest` exits 0.

## 6. DESIGN DECISION RATIONALE

**Where does the `<= 3` cap live?** Options: fold-enforced (partial fold) vs CLI-enforced (total fold).
**Chosen:** CLI-enforced. Keeps the fold pure/total like every `reviewProgressApply*` sibling; the loud exit-2 lives where an exit code is meaningful. At the time of writing, no sibling fold signals errors — matching them keeps the selftest a straight-line value assertion.

**Counter as a stored integer vs derived from history length?** A separate stored `fix_cycles` integer can drift from `history` on a partial write.
**Chosen:** derive `fix_cycles = length(history)` in the fold so the stated invariant holds by construction.

**Required flags for `record-fix-cycle`.**
**Chosen:** `--kind` + `--head-sha` required; `--failing-checks` / `--tried` optional (default `[]`). Rationale in the WHAT.

**Freeze the field names now?** The issue's open question asks which field names to freeze for FAFF-819/820/842 to build against.
**Chosen:** freeze exactly the names in the WHAT schema (`issue`, `fix_cycles`, `last_head_sha`, `history[].{cycle,kind,failing_checks,tried,at}`, `updated_at`). Freezing them here *is* the resolution of that open question — landing the primitive first exists precisely to make this schema authoritative. A later consumer needing an added field extends the record additively (unknown fields tolerated by the schema-tolerant read), never renames these.

**Region membership.**
**Chosen:** `governance` region with a `--selftest` argv entry, identical to `review-progress` / `build-progress`, so `faff regions` coverage and the governance-member-has-a-selftest lint both pass.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The issue's sole open question (final field names) is closed by the WHAT schema above — see the rationale. **Assumes:** the downstream consumers (FAFF-819/820/842/844) accept an additively-extensible record and will not need any of the frozen field names *renamed*; if a consumer later requires a rename, that is a schema-migration ticket, not a silent change here.

**Assumptions.**

- **Assumes:** the `effects.js` atomic-write + `readExisting`-catches-to-null helpers behave as read in the current file (lines ~166–224). *Validation:* the build agent re-reads `cmdReviewProgress` before mirroring it.
- **Assumes:** `regions.js` still keys `REGION_MAP` / `REGION_SELFTEST_ARGV` by verb name and enforces "every governance member has a selftest" (line ~751). *Validation:* run `faff regions --selftest` after wiring.
- **Assumes:** `docs/guide/cli.md` is the surface `faff lint-cli-doc` checks. *Validation:* run `faff lint-cli-doc` after adding the row.

## 8. DONE — Definition of Done

### From WHAT (types and record)
- [ ] `landingProgressPath(runDir, issue)` returns `<run-dir>/<issue>/landing-progress.json`.
- [ ] Record written matches the schema: `{ issue, fix_cycles, last_head_sha, history:[{cycle,kind,failing_checks,tried,at}], updated_at }`.
- [ ] `LANDING_FIX_KINDS` = `{conflict, regression}`; unknown kind rejected.

### From WHAT (fold)
- [ ] `landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso)` is pure (no fs/net/tracker/git) and total.
- [ ] Every fold result satisfies `fix_cycles == length(history)`.
- [ ] The fold stamps `last_head_sha` (from `headSha`) and `updated_at` (from `nowIso`), and appends exactly one history entry with `cycle == length(history)`.

### From HOW (CLI behaviour)
- [ ] `read` exits 3 (no output) when absent; exits 0 with the JSON record when present.
- [ ] `record-fix-cycle` exits 2 on bad `--kind`, on missing `--head-sha`, on missing positionals, and on an existing `fix_cycles == 3` (no write, no clamp).
- [ ] `record-fix-cycle` writes atomically via tmp+rename, mirroring `cmdReviewProgress`.
- [ ] `clear` is idempotent (exit 0 whether or not the file exists; file absent afterward).
- [ ] A malformed on-disk file reads as null (schema-tolerant).

### From HOW (wiring)
- [ ] `bin/faff` requires `cmdLandingProgress` from `effects.js` and registers `"landing-progress"` in the dispatch table.
- [ ] `regions.js` lists `landing-progress` in `REGION_MAP` (`governance`) and `REGION_SELFTEST_ARGV`.
- [ ] `docs/guide/cli.md` has a `landing-progress` row; `faff lint-cli-doc` passes.

### From WHAT (selftest)
- [ ] `landingProgressSelftest` mirrors `reviewProgressSelftest` (pure-fold unit checks); `faff landing-progress --selftest` exits 0.

### From WHY
- [ ] No change to the landing loop, graft, `merge-gate.js`, `faffter-noon-ship`, `disposition.js`, or `faff-beep-boop` (verify via diff scope).

**Integration smoke test.**

```
# from a clean run-dir R:
faff landing-progress read R FAFF-1 ; test $? -eq 3
faff landing-progress record-fix-cycle R FAFF-1 --kind conflict --head-sha aaa --failing-checks ci/x --tried rebase   # -> fix_cycles 1
faff landing-progress record-fix-cycle R FAFF-1 --kind regression --head-sha bbb                                       # -> fix_cycles 2
faff landing-progress read R FAFF-1 | grep '"fix_cycles":2'
faff landing-progress clear R FAFF-1 ; test $? -eq 0
faff landing-progress read R FAFF-1 ; test $? -eq 3
```

confidence: high
build-tier: complex
spec-review: approve

## Methodology critique

Agile-delivery lens (`faffter-dark-methodology-agile-delivery`), issue-level, advisory — surfaced for `/faff-wtf`, non-blocking on an autonomous promotion.

- **Right-sized?** No issues. This is a deliberately-carved single unit — the persistence primitive split out of the risky FAFF-844 landing loop so a low-risk, independently-testable artifact lands first. One cohesive concern (a record + its fold + its verb + its selftest), estimable at well under a day; no second independent concern hiding inside it.
- **Workstream fit?** No issues. Sits cleanly in the Phase 0 outcome, cohesive with the recovery-bundle and cross-firing-resume work that consumes the same artifact.
- **Deps surfaced?** No issues. The blocks-edges to FAFF-844 and FAFF-842 and the relates-edges to FAFF-819/FAFF-820 are all recorded on the tracker; the spec's OUT OF SCOPE names each consumer as the extension point. The stated purpose — freeze the schema before the consumers build against it — is itself the dependency-ordering rationale.
- **Risk profile?** No issues. A leaf utility mirroring an already-shipped precedent (`review-progress`/`build-progress`); no novel integration or external dependency, so no de-risking spike is warranted.
