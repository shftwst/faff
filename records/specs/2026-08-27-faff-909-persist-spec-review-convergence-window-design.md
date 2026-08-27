# FAFF-909: persist the spec-review convergence window across a restart or human unpark
> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-909.

This spec is for the build agent implementing FAFF-909, and for the human reviewers who gate it. It fixes two defects in the prep-to-review Spec-review loop: a resumed loop silently overwrites its own round records, and the convergence window it compares over is lost on any interruption. The audience needs the `window.json` schema, the disk-derived round numbering, the new `--window-start` flag, and how faff-prep is rewired to use them.

## 1. WHY — problem and principles

**The load-bearing idea.** The convergence check and the churn check both read a sequence of `round-<n>.json` records and decide whether the reviewer is converging. That decision is only sound if every record in the sequence belongs to one continuous conversation: same spec lineage, same backend, no human decision applied partway through. The boundary of that continuous run is the convergence window `[window_start .. n]`. Today the window lives only in the prep agent's head, and the round counter `n` is also agent-held, so any interruption both loses the window and rewinds the counter over live data.

**Problem statement.** A sentry kill or a human unpark drops the in-memory `window_start` and restarts the round counter at 1, so a resumed loop overwrites `round-1.json` onwards and then computes convergence and churn across records from different conversations. The result is both a false yield and a false park, and a data-loss variant where earlier round records are destroyed. This change persists the window to disk, derives the next round number from disk, and gives the convergence CLI a flag to honour the window the prose already promises.

**Design principles.**

**Fail-safe direction is park, never yield.** The convergence check is a yield gate: `converging: true` grants another loop round instead of parking. Every degrade this change introduces must fail toward parking (do not yield), matching the existing unreadable-dir degrade at `spec-review-convergence.js:343`. A lost or unreadable window marker must never widen into a false yield.

**No fingerprints, no hashing.** The window is a single persisted integer, not a value reconstructed by hashing spec content or backend identity. Nothing this change writes depends on byte-stable re-serialisation across a restart.

**Additive only, no schema change to round records.** The `round-<n>.json` body stays exactly `{verdict, objections}` (the `spec-review-verdict.schema.json` shape). The window marker is a separate sidecar, mirroring how `pinned-reviewer.json` (FAFF-886) sits beside the round records without touching them. The two reviewer-blind detectors keep the "NO schema change" commitment at `spec-review-convergence.js:17`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review-convergence.js` | JavaScript (Node) | `roundFilesInDir`, `detectSpecReviewConvergence`, the `--dir`-only flag spec at line 327 this change extends with `--window-start` |
| `plugin/skills/faff/bin/lib/spec-review-churn.js` | JavaScript (Node) | `roundNumberFromPath`, `readRoundRecord`, the explicit `--prev`/`--curr` scoping the convergence flag mirrors |
| `plugin/skills/faff/bin/lib/spec-review-pin.js` | JavaScript (Node) | `capturePin` (idempotent sidecar write pattern), `specReviewDir` (the one scratch-dir resolver both records and sidecars share) |
| `plugin/skills/faff-prep/SKILL.md` | Markdown prose | Lines 122, 165, 167 hold the agent-held `window_start`, the round-record write, and the windowed churn/convergence reads that this change rewires |
| `plugin/skills/faff/bin/faff` | JavaScript (Node) | The subcommand dispatch table (lines 225 to 228) a new verb registers into |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript (Node) | Region tags and the `--selftest` registry a new module registers into |

**Scope statement.** This sits inside the prep-to-review Spec-review gate in `faff-prep`, on the loop-cap convergence-yield and churn paths only. It changes how the window and the round counter survive an interruption, nothing about how the loop runs when uninterrupted.

## 2. OUT OF SCOPE

- **Surviving the interruption itself.** Making the loop resume automatically after a kill, or holding through a transport outage, is FAFF-900 (graceful spec-review outage handling: in-turn retry plus a resumable outage-hold). Extension point: FAFF-900's resume path would read the same `window.json` this change writes. Coordination is note-only, no shared build.
- **Changing what convergence or churn mean.** The `converging` conjunction (strictly decreasing, blocker-free latest, no new lens) and the churn lens-set rule are unchanged. This change only bounds which records they read. Extension point: the pure comparators `detectSpecReviewConvergence` and `detectSpecReviewChurn`.
- **The same-lens objection-swap gap.** Objections carry no stable id (`{lens, severity}` only), so shedding two `architectural` objections and adding a different one still reads as convergence. That accepted gap (documented at `spec-review-convergence.js:32`) is untouched here.
- **A stable-object fingerprint for round continuity.** Deliberately excluded per the no-fingerprints principle. Extension point: none planned; if a future ticket wants content-level continuity detection it would add its own sidecar, not extend `window.json`.
- **Backend-swap window resets.** The swap-round reset (FAFF-886) already sets `window_start := n` on a fallback round. This change reuses that field and persists it; it does not change swap detection.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Convergence window | The contiguous round range `[window_start .. n]` the convergence and churn checks are allowed to compare over. One continuous reviewer conversation. |
| `window_start` | The 1-indexed round number that opens the current window. Persisted, not agent-held. |
| Scratch dir | The per-spec directory `specReviewDir` resolves: `<run-dir>/<ISSUE>/spec-review` under a run-dir, else `.faff/spec-review/<ISSUE>`. Survives an interruption. |
| Round record | `$scratch/round-<n>.json`, body `{verdict, objections}`, one per review round. |
| Window marker | `$scratch/window.json`, the new sidecar holding `window_start`. |

**The window marker.**

```
RECORD WindowMarker:   # serialised to $scratch/window.json
  window_start: Integer   # >= 1; the round that opens the current window
  # additive-tolerant: unknown fields are ignored, exactly as the round-record reader tolerates extra keys
  CONSTRAINT window_start >= 1
```

**Disk-derived round numbering.** The next round number is `max(roundFilesInDir(dir).n) + 1`, or `1` when the directory is empty, absent, or unreadable. The prep agent stops holding a counter and asks disk each round, so a resumed loop appends `round-<max+1>.json` rather than rewriting `round-1.json`.

**New CLI: `faff spec-review-window`.** A small deterministic verb, housed in a new module `spec-review-window.js` (factory region), that owns both the round-number derivation and the window-marker read/write. It reuses `roundFilesInDir` from `spec-review-convergence.js` (factory to factory require is legal, ADR-0042, the same edge convergence already uses to reach churn).

```
faff spec-review-window --next-round --dir <scratch>   # prints the next round integer (max+1, or 1)
faff spec-review-window --read       --dir <scratch>   # prints the persisted window_start (default 1 if window.json absent)
faff spec-review-window --set N      --dir <scratch>   # writes { "window_start": N } to $scratch/window.json (mkdir -p)
```

- Exactly one of `--next-round` / `--read` / `--set` is required; `--dir` is required.
- `--next-round`: a missing or unreadable directory prints `1` (a fresh loop starts at round 1). This is the write-path counter, so an unreadable dir cannot silently overwrite anything (there is nothing on disk to overwrite).
- `--read`: an absent `window.json` prints `1` (the fail-safe default, see HOW). A present-but-malformed `window.json` is fail-loud (exit 2) — plumbing corruption, never coerced, parity with the round-record readers.
- `--set N`: `N` must parse as an integer `>= 1`; otherwise usage error (exit 2). Creates the scratch dir if needed and writes the marker verbatim.

**Design decision — where the next-round derivation lives.**
- Option A: a flag on `spec-review-convergence`. Rejected: convergence is a read-path comparator, next-round is a write-path counter; overloading it blurs the two.
- Option B: a new `spec-review-window.js` module grouping the marker sidecar and the counter. Chosen: it parallels `spec-review-pin.js` grouping the pin sidecar and `specReviewDir`, and keeps `roundFilesInDir` as the single shared primitive it imports.

**Chosen:** house the round-number derivation and the window-marker read/write in a new `spec-review-window.js` module; import `roundFilesInDir` from `spec-review-convergence.js`.

**New flag on `faff spec-review-convergence`: `--window-start N`.** Extends the flag spec at `spec-review-convergence.js:327`.

```
faff spec-review-convergence --dir <scratch> [--window-start N]
```

- `--window-start` omitted: today's behaviour exactly. Read every `round-<n>.json` in the directory, order numerically, detect. Backward compatible.
- `--window-start N`: read every record as today, then keep only those with round number `>= N` before ordering and detecting. This bounds the comparison to `[N .. max]`, matching how `spec-review-churn` is already window-scoped by its explicit `--prev`/`--curr` paths.
- `N` must parse as an integer `>= 1`; a malformed value is a usage error (exit 2). An `N` greater than the max round on disk leaves fewer than two records in window, so `detectSpecReviewConvergence` returns `converging: false` with its existing "need >=2 rounds" reason — a park, the fail-safe direction.
- The existing degrades are unchanged: unreadable `--dir` still degrades to `converging: false` exit 0; a malformed round record inside the window is still fail-loud exit 2.

**Design decision — flag versus archiving pre-window records.** The ticket's open questions offered archiving pre-window records into a subdirectory so `--dir` stays a whole-directory read.
- Archiving: rejected. It mutates the record layout on disk, adds a move step that can half-complete on a second kill, and diverges from `spec-review-churn`'s explicit-path scoping.
- Flag: chosen. It is a pure read-time filter, leaves every record in place for forensics, and mirrors the sibling CLI.

**Chosen:** add `--window-start N` as a read-time filter; do not archive pre-window records.

## 4. HOW — behaviour

**Architecture.** Three deterministic CLI pieces plus a prose rewire in faff-prep.

1. `spec-review-window.js` provides the pure helpers and the CLI verb: `nextRoundNumber(dir)`, `readWindowStart(dir)`, `writeWindowStart(dir, n)`.
2. `spec-review-convergence.js` gains the `--window-start` filter.
3. `faff-prep/SKILL.md` stops holding the counter and the window in the agent's head and shells to these CLIs instead.

**Next round number.**

```
PROCEDURE nextRoundNumber(dir):
  1. files := roundFilesInDir(dir)          # reuses the existing primitive; readdir may throw
     ON throw (ENOENT / unreadable): RETURN 1
  2. IF files is empty: RETURN 1
  3. RETURN max(f.n for f in files) + 1
```

**Reading the window marker.**

```
PROCEDURE readWindowStart(dir):
  1. raw := read $dir/window.json
     ON ENOENT: RETURN 1                     # fail-safe default (see below)
     ON other read error: fail-loud (exit 2) # a present-but-unreadable sidecar is plumbing corruption
  2. parsed := JSON.parse(raw)
     ON parse error: fail-loud (exit 2)
  3. IF parsed.window_start is not an integer >= 1: fail-loud (exit 2)
  4. RETURN parsed.window_start
```

**Why the absent-marker default is 1, and why that is fail-safe.** When `window.json` is absent (a legacy scratch dir from before this change, or a genuinely lost sidecar), the reader defaults `window_start` to 1, so the convergence check reads the whole directory. Widening the window can only add steps the strictly-decreasing conjunction must satisfy; it can never remove a step. So a too-wide window can only make convergence harder to reach, never easier. A default of 1 therefore cannot manufacture a false yield. It can produce a conservative false park, which is the accepted fail-safe direction for this gate.

**Writing the window marker.**

```
PROCEDURE writeWindowStart(dir, n):
  1. mkdir -p dir
  2. write dir/window.json := JSON.stringify({ window_start: n })
```

**The `--window-start` filter in convergence.**

```
PROCEDURE cmdSpecReviewConvergence(args):
  ... parse --dir (required) and optional --window-start N ...
  1. files := roundFilesInDir(dir)           # unchanged; unreadable dir still degrades to converging:false exit 0
  2. IF --window-start given:
       validate N is integer >= 1 (else usage error exit 2)
       files := [f for f in files if f.n >= N]
  3. read + order + detect over the filtered files, exactly as today
```

**faff-prep rewire (prose).** Three edits, all replacing agent-held state with a disk read.

- **Line 122 (window init).** Replace "Keep a `window_start` (init 1)" with: resolve `window_start` at loop entry from `window_start=$("$faff" spec-review-window --read --dir $scratch)` (returns 1 for a fresh loop). On a swap round, set `window_start := n` and persist it: `"$faff" spec-review-window --set $n --dir $scratch`. Persisting the swap reset is new; the swap detection is unchanged.
- **Line 165 (round-record write and churn).** Derive the round number from disk before each write: `n=$("$faff" spec-review-window --next-round --dir $scratch)`, then write `$scratch/round-$n.json`. The churn read still passes explicit `--prev $scratch/round-<k>.json --curr $scratch/round-<n>.json` with both `k` and `n` inside `[window_start .. n]`.
- **Line 167 (convergence yield).** Pass the window to the CLI: `"$faff" spec-review-convergence --dir $scratch --window-start $window_start`.

**New window on human unpark.**

```
PROCEDURE on_human_unpark(scratch):
  # A human decision changed the spec, so pre-decision rounds are not comparable.
  # The new window opens at the FIRST post-decision review round, which is the round
  # about to be written next.
  1. n_new := nextRoundNumber(scratch)          # e.g. max on disk + 1
  2. writeWindowStart(scratch, n_new)
  3. the first post-unpark round writes round-<n_new>.json; convergence over
     [n_new .. n_new] has < 2 records and parks until a second post-unpark round exists
```

The committed decision says `window_start := current round` on unpark. Read as: the current round of the new, post-decision conversation, which is the first round written after the unpark. Pre-decision records stay on disk for forensics but fall outside the window.

**Edge cases.**

- **Restart mid-loop (the data-loss case).** Round records `round-1 .. round-k` and `window.json` both survive on disk. On resume, `--read` returns the persisted `window_start`, `--next-round` returns `k+1`, and the loop appends `round-<k+1>.json`. No overwrite, window preserved.
- **Restart with `window.json` absent but records present.** `--read` defaults to 1 (fail-safe park-leaning). `--next-round` still returns `k+1` from the surviving records, so the data-loss half is fixed regardless of the marker.
- **Fresh interactive prep, no run-dir.** `specReviewDir` resolves `.faff/spec-review/<ISSUE>`; empty dir → `--next-round` is 1, `--read` is 1. Identical to today's first round.
- **`--set` with a malformed `N`, or a corrupt `window.json` on `--read`.** Fail-loud exit 2, never silently coerced. Matches the round-record fail-loud policy.

**Failure modes.**

- **The failure:** the persisted `window_start` and the on-disk records disagree — for example `window_start` points past the highest round after a partial write. How you would know: `--window-start N` filters to fewer than two records and convergence returns its "need >=2 rounds" park with the totals array short. What it means: proceed. The disagreement resolves to a conservative park, which is the fail-safe direction; no false yield is possible.
- **The failure:** an operator or a stale process writes `round-<n>.json` with a lower `n` than an existing record after this change is deployed, reintroducing an overwrite. How you would know: `--next-round` always returns `max+1`, so the only way to hit a lower `n` is to bypass the CLI and write the path directly. What it means: narrow — the fix holds for every write that goes through `--next-round`; a direct path write bypassing it is out of scope and would be a prep-prose regression caught by the DONE round-numbering oracle.

**Anti-pattern:** deriving the next round number from the agent's own loop counter. Why: that is the exact restart-overwrite defect this ticket fixes; the counter must come from disk every round.

**Anti-pattern:** reconstructing the window by hashing round records or spec content. Why: it reintroduces the byte-stability fragility the no-fingerprints principle rules out, and the window is already a cheap persisted integer.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec-review loop that has written round-1.json, round-2.json, round-3.json under $scratch
When the process is killed and a fresh process resumes the loop under the same $scratch
Then the next round number derived from disk is 4
And round-1.json, round-2.json, round-3.json are still present and unmodified
And a new round-4.json is written, never an overwrite of round-1.json
```

```
Given $scratch contains round-1.json through round-5.json spanning a discontinuity, with window_start persisted as 4
When faff spec-review-convergence --dir $scratch --window-start 4 runs
Then only round-4.json and round-5.json are compared
And rounds 1 through 3 do not contribute to the strictly-decreasing, blocker, or churn signals
```

```
Given a persisted window.json holding window_start 3
When faff spec-review-window --read --dir $scratch runs
Then it prints 3
And a subsequent --set 6 followed by --read prints 6
```

```
Given a human unparks a spec whose $scratch already holds round-1.json and round-2.json
When the unpark handler runs before the next review round
Then window_start is set to 3 (the first post-decision round)
And the next convergence check over [3 .. 3] has fewer than two records and parks until a second post-unpark round exists
```

```
Given a $scratch with round records but no window.json (a legacy or lost-marker dir)
When faff spec-review-window --read --dir $scratch runs
Then it prints 1
And the resulting whole-directory convergence read fails toward park, never toward a false yield
```

## 6. Design decision rationale

**Where does the next-round derivation live?** A flag on `spec-review-convergence` versus a new `spec-review-window.js` module. Flag: overloads a read-path comparator with a write-path counter. New module: groups the marker sidecar and the counter, parallels `spec-review-pin.js`, reuses `roundFilesInDir`. **Chosen:** new `spec-review-window.js` module.

**How does the convergence CLI honour the window?** A `--window-start N` read-time filter versus archiving pre-window records into a subdirectory. Archiving mutates on-disk layout and adds a move that can half-complete on a second kill. The flag is a pure filter that leaves records in place and mirrors `spec-review-churn`'s explicit scoping. **Chosen:** `--window-start N` filter.

**How is the window reconstructed across a restart?** An explicit persisted integer in `window.json` versus a fingerprint derived from round content or backend identity. A fingerprint depends on byte-stable re-serialisation across a restart, which is not guaranteed, and it is more machinery than the problem needs. **Chosen:** persist a single integer; no fingerprint, no hashing. This closes the prior fingerprint byte-stability objection: there is nothing to keep byte-stable, because nothing is hashed.

**What is the resume-check surface?** A dedicated `--resume-check` verb that inspects the records and decides resumability versus an explicit `--window-start N` the caller derives from persisted state. A `--resume-check` that cannot tell whether records are continuous has to choose a default, and on a yield gate a fail-open default (proceed as if continuous) is unsafe. **Chosen:** no `--resume-check` verb. The convergence CLI never decides resumability itself; it bounds the window to what the caller passes, and its only degrade stays the existing fail-safe unreadable-dir to `converging: false`. This closes the prior `--resume-check` fail-open objection: there is no path that fails open, because there is no resume-check to fail.

**What does "window_start := current round" mean on unpark?** The last round on disk versus the first post-decision round. A human decision changed the spec, so the last pre-decision round is not comparable to what follows. The window must open at the first round of the new conversation. **Chosen:** `window_start := nextRoundNumber`, the round about to be written after the unpark.

## 7. Open questions and assumptions

**Open questions.** None. The ticket's committed decisions closed the round-counter, window-persistence, flag-versus-archive, and unpark questions; this spec closes the fingerprint, resume-check, and oracle objections above. No `**Punt:**` remains.

**Assumptions.**

- **Assumes:** the scratch dir resolved by `specReviewDir` survives an interruption, as the ticket states and as FAFF-886's pin sidecar already relies on. Validate: confirm `spec-review-dir` is a pure path resolver that neither creates nor clears the dir (`spec-review-pin.js:123`), and that round records written before an interruption are still readable after.
- **Assumes:** FAFF-900 has not yet landed a window-carrying mechanism. Validate: check whether FAFF-900 is merged; if it landed first, inherit its window read rather than adding a second one. Coordination is note-only.

## 8. DONE — definition of done

### From WHY
- [ ] A resumed loop appends a new round record and does not overwrite any existing `round-<n>.json` (the data-loss half is closed).
- [ ] The convergence and churn checks compare only records inside `[window_start .. n]` after a restart or unpark.

### From WHAT (types and interfaces)
- [ ] `window.json` serialises `{ "window_start": N }` with `N` an integer `>= 1`; extra fields are tolerated on read.
- [ ] `faff spec-review-window --next-round --dir <scratch>` prints `max(roundFilesInDir)+1`, or `1` for an empty, absent, or unreadable dir.
- [ ] `faff spec-review-window --read --dir <scratch>` prints the persisted `window_start`, defaulting to `1` when `window.json` is absent, and exits 2 on a malformed marker.
- [ ] `faff spec-review-window --set N --dir <scratch>` writes the marker and creates the dir if absent; a malformed `N` is a usage error (exit 2).
- [ ] Exactly one of `--next-round` / `--read` / `--set` is required; `--dir` is required.

### From WHAT (convergence flag)
- [ ] `faff spec-review-convergence --dir <scratch>` with `--window-start` omitted behaves byte-identically to today (whole-directory read).
- [ ] `--window-start N` filters to records with round number `>= N` before ordering and detecting.
- [ ] A malformed `--window-start N` is a usage error (exit 2); an `N` past the max round yields `converging: false` with the existing "need >=2 rounds" reason.
- [ ] The existing degrades are unchanged: unreadable `--dir` degrades to `converging: false` exit 0; a malformed in-window round record is fail-loud exit 2.

### From HOW (behaviour)
- [ ] `nextRoundNumber`, `readWindowStart`, `writeWindowStart` are exported and unit-covered (empty dir, populated dir, absent marker, malformed marker).
- [ ] A `window.json` round-trip: `--set N` then `--read` returns `N`.
- [ ] On human unpark, `window_start` is set to the first post-decision round and persisted before the next review round is written.

### From HOW (faff-prep rewire)
- [ ] `faff-prep/SKILL.md` line 122 resolves `window_start` from `--read` and persists the swap-round reset via `--set`, no longer holding it in the agent's head.
- [ ] `faff-prep/SKILL.md` line 165 derives the round number from `--next-round` before each round-record write.
- [ ] `faff-prep/SKILL.md` line 167 passes `--window-start $window_start` to the convergence CLI.

### Wiring
- [ ] `faff spec-review-window` is registered in the `bin/faff` dispatch table and in the `regions.js` region tags and `--selftest` registry.
- [ ] A `--selftest` for `spec-review-window` covers next-round derivation, marker round-trip, and the malformed-marker fail-loud path.
- [ ] `test/spec-review-window.test.mjs` and additions to `test/spec-review-convergence.test.mjs` cover the scenarios above, following the existing import-plus-`runCli` convention.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. scratch := mkdtemp
  2. write round-1.json {14 objections}, round-2.json {13}, round-3.json {8}, all blocker-free architectural
  3. assert `faff spec-review-window --next-round --dir scratch` prints 4
  4. `faff spec-review-window --set 1 --dir scratch`; assert `--read` prints 1
  5. assert `faff spec-review-convergence --dir scratch --window-start 1` yields converging:true, totals [14,13,8]
  6. `faff spec-review-window --set 3 --dir scratch`
  7. assert `faff spec-review-convergence --dir scratch --window-start 3` has < 2 in-window records → converging:false (park)
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```