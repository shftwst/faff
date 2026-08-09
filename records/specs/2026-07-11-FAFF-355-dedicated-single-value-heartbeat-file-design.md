# FAFF-355 — Dedicated single-value heartbeat file (close the N-writer ledger race)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-355.

This spec defines the work for FAFF-355: move `faff heartbeat`'s write target off the run ledger onto a dedicated per-run single-value file, returning the ledger to a single writer so the parallel executor's documented heartbeat-vs-outcome clobber race is closed by construction. Audience: the build agent and human reviewers. Blocks FAFF-327 (fleet Sentry supervision).

## 1. WHY — Problem and Principles

**Load-bearing model.** Run liveness is a single scalar — "when did something alive last tick?" — but today that scalar lives *inside* the run ledger, so refreshing it requires a full-ledger read-modify-write. Two concurrent full-ledger RMWs (a subagent heartbeat tick and an orchestrator outcome write) can interleave and the loser's write is silently lost. Move the scalar into its own file, written atomically, and the ledger has exactly one writer again: the race ceases to exist structurally, rather than being narrowed by careful sequencing.

**Problem statement.** `faffter-dark-concurrency-parallel/SKILL.md` documents its own unresolved race: under N concurrent build subagents, a `faff heartbeat` field-merge can interleave with a concurrent outcome write and clobber it, and instructs "resolve it before enabling subagent dispatch under parallel mode in anger". `atomicWriteLedger` (tmp + `renameSync`) prevents *torn reads*, not *lost updates* between two RMW cycles. This change gives heartbeats a dedicated file and demotes the ledger's `owner.last_heartbeat` to a run-start baseline + legacy fallback.

**Design principles.**

- **Structural fix, not sequencing discipline.** The race is closed because `faff heartbeat` never writes the ledger at all — not because writers are more carefully ordered. An implementation that keeps any ledger write inside the heartbeat tick path is rejected.
- **Pure cores stay pure.** `runIsHeld`, `runcheckHookDecision`, `prepIsHeld`, `sentryHeartbeatAgeSecs`, `evalWallClock` remain filesystem-free; the file read happens once at each read seam and is overlaid onto the parsed ledger before the pure predicate runs. This preserves the house pure-core + selftest pattern.
- **Fail-safe direction unchanged.** Missing/unparseable heartbeat data degrades exactly as today: `runIsHeld` fails toward not-held; a done run is never resurrected (the `owner.status === "running"` gate stays ledger-sourced).
- **Evidence never lies.** Any diagnostic that names its liveness source (sentry's wall-clock evidence, USAGE strings, docs) must name the actual source after this change.

## 2. OUT OF SCOPE

- **A CLI primitive for orchestrator outcome writes** — the orchestrator's raw load-modify-save of outcomes remains prose-governed. Excluded because with heartbeat off the ledger the orchestrator is the *sole* ledger writer, so no cross-writer race remains to fix. Extension point: a `faff outcome` subcommand beside `cmdHeartbeat`, if a second ledger writer ever appears.
- **Per-subagent heartbeat files** — liveness asks "is this *run* live", not which member ticked. Excluded as speculative granularity. Extension point: suffix the filename (`heartbeat.<issue>`) and take the max at the read seam.
- **Heartbeat cadence / caller changes** — all tick call sites already invoke `faff heartbeat "$run_dir"` and are unchanged by construction — the CLI surface is stable.
- **`latestRunDir` lexical-sort hazard** — `resolveHeartbeatRunDir` resolution order is untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Heartbeat file | `.faff/runs/<run-id>/heartbeat` — a single-value file whose entire content is one ISO-8601 UTC timestamp + trailing newline |
| Effective heartbeat | The liveness instant a reader uses: the max of the heartbeat file's timestamp and the ledger's `owner.last_heartbeat`, either of which may be absent |
| Run-start baseline | The `owner.last_heartbeat` value written once inside the owner stamp when a run ledger is minted (e.g. `faff lights-out`); never refreshed by ticks after this change |

**Heartbeat file format.**

```
FILE .faff/runs/<run-id>/heartbeat:
  content: ISO-8601 UTC timestamp + "\n"     # e.g. "2026-07-05T14:03:22.117Z\n"
  write:   sibling tmp file + rename          # same atomicity idiom as atomicWriteLedger
  absent:  legitimate (legacy run, or run not yet ticked)
```

**Decision — signal home and shape.** One file per run at `.faff/runs/<run-id>/heartbeat`, content a bare ISO timestamp + newline.
**Chosen:** one-file-per-run, bare-ISO content — liveness is a per-run question; a single value needs no structure, and the bare timestamp is greppable and self-describing.

**Decision — read content, not mtime.** The file's mtime is also a candidate liveness signal.
**Chosen:** read the content — the codebase's entire liveness model already runs on `Date.parse` of ISO strings, content survives copy/backup/inspection where mtime is tool-dependent, and it keeps the pure cores drivable with plain strings in selftests.

**Decision — effective heartbeat = max(file, ledger field), fallback indefinite.** Alternatives: file-first-else-field; bounded deprecation of the field.
**Chosen:** max of both, indefinitely — the run-start owner stamp legitimately writes the field once (so both signals coexist inside every new run before its first tick), max is order-independent and fail-safe toward live, it degenerates to file-first after the first tick, and legacy pre-upgrade ledgers keep working with zero migration.

**New/changed pure cores (pseudocode-level; names indicative).**

```
effectiveHeartbeatIso(fileIso | null, fieldIso | null) -> iso | null
  # max by parsed epoch; unparseable input treated as null (fail toward the other source);
  # both null -> null

overlayHeartbeat(ledger, fileIso | null) -> { source: "heartbeat-file" | "owner.last_heartbeat" | null }
  # sets ledger.owner.last_heartbeat = effectiveHeartbeatIso(fileIso, owner.last_heartbeat)
  # when owner exists; reports which source won; no-op on ownerless ledgers
```

**Impure seams (thin, untested-logic-free).**

```
readHeartbeatFile(runDir) -> iso-string | null    # missing/unreadable/blank -> null, silent
writeHeartbeatFile(runDir, nowIso)                # tmp + rename beside the target
```

**`faff heartbeat` CLI surface — unchanged shape.** `heartbeat [RUN_DIR] [--json]`; `--json` still prints `{ run_dir, last_heartbeat, written }`; exit 0 soft no-op / exit 2 malformed ledger. `last_heartbeat` reports the value just written (tick) or the effective heartbeat (no-op).

**Sentry evidence field.** `evalWallClock` evidence currently pins `ledger_field: "owner.last_heartbeat"`.
**Chosen:** replace `ledger_field` with `heartbeat_source: "heartbeat-file" | "owner.last_heartbeat"`, carrying whichever source the overlay reported — evidence that names a source it no longer reads would be false. `test/sentry.test.mjs` and the sentry USAGE line, `docs/guide/cli.md` update in step.

## 4. HOW — Behavior

**Write path — `cmdHeartbeat` re-targeted.** One sentence: the tick keeps its ledger-*read* guard but its only *write* is the heartbeat file.

```
PROCEDURE cmdHeartbeat(args):
  1. resolve runDir (arg -> $FAFF_RUN_DIR -> latestRunDir)          # unchanged
  2. IF no runDir OR no run-ledger.json -> soft no-op               # unchanged: exit 0, written:false
  3. read ledger READ-ONLY; malformed -> stderr + exit 2            # unchanged
  4. IF owner missing OR owner.status != "running":
       -> written:false; last_heartbeat = effectiveHeartbeatIso(readHeartbeatFile(runDir), owner?.last_heartbeat)
       # a done run is never resurrected — and even a stray file write couldn't resurrect it,
       # because runIsHeld still gates on the ledger's owner.status first
  5. ELSE: writeHeartbeatFile(runDir, nowIso); written:true
  6. emit { run_dir, last_heartbeat, written }                      # shape unchanged
```

**Decision — the tick stops writing the ledger entirely (not dual-write).** Dual-write was considered and rejected: it keeps the full-ledger RMW inside the tick, so it narrows nothing — the race survives.
**Chosen:** file-only write with a read-only running-guard — this is the race-closing move; the read-only ledger access races with nothing.

**Decision — fate of `applyHeartbeat` and the heartbeat selftest.**
**Chosen:** delete `applyHeartbeat` (its only callers are `cmdHeartbeat` and the selftest) and rewrite `heartbeatSelftest` around the new pure cores: the running-guard decision, `effectiveHeartbeatIso` (max / null / unparseable table), `overlayHeartbeat` source reporting, and the overlay→`runIsHeld` held-interaction checks. Still zero filesystem I/O.

**Read path — overlay at the four seams.** `runIsHeld(ledger, nowMs, env)` keeps its signature; each call site overlays first, and every site already has the run dir in hand:

```
PROCEDURE read-side wiring:
  1. runcheck --hook: after readLedger(runDir), overlayHeartbeat(ledger, readHeartbeatFile(runDir))
     BEFORE runcheckHookDecision(...)                                 # decision fn stays pure
  2. agency-mode pin (config.js resolveAppetite, env.FAFF_RUN_DIR): same overlay before runIsHeld
  3. prepIsHeld tier (a): tryReadLedger(owner.run_dir) gains the same overlay
     -> prep markers inherit file-first liveness for free
  4. sentry check: overlay once where the ledger is loaded; thread the reported source
     into evalWallClock's evidence.heartbeat_source
```

**Decision — overlay-at-read-seam vs widening predicate signatures.** Alternative: give `runIsHeld` a fourth `fileIso` parameter and thread it through all callers and both selftest tables.
**Chosen:** overlay at the read seam — the pure predicates and both existing selftest tables keep their signatures; the overlay is itself a pure core testable in isolation; four small call-site edits instead of a signature ripple. The overlaid in-memory ledger is never written back on any tick path; the two remaining `atomicWriteLedger` callers (sentry abort, lights-out mint) are orchestrator/supervisory-lane and unaffected.

**Anti-pattern:** overlaying and then persisting the ledger from a read path. Why: it would re-smuggle heartbeat data into a ledger write and blur the single-writer line this change draws.

**Single-writer statement (prose, same PR).** After this change: build subagents touch *only* the heartbeat file; the run ledger's writers are exclusively orchestrator-lane (outcome recording, owner stamp/status, sentry abort's resumable mark, lights-out mint). Prose edits:

- `faffter-dark-concurrency-parallel/SKILL.md` — replace the field-merge paragraph and delete the "unresolved" blockquote: heartbeats go to the dedicated per-run heartbeat file via `faff heartbeat "$run_dir"`; the ledger is orchestrator-only; N concurrent tickers are safe because each tick is an atomic whole-file replace of a single-value file (last-writer-wins is correct for a freshness scalar). No FAFF-NN refs in the new prose.
- `faffter-noon-concurrency-sequential/SKILL.md` — the "Heartbeat ownership follows the single active writer" paragraph updates its mechanism sentence (field-merge → heartbeat file); behaviour is otherwise unchanged.
- bin/faff USAGE (heartbeat, sentry); `docs/guide/cli.md` (heartbeat row, sentry row).

**Edge cases and error handling.**

- Heartbeat file absent → effective heartbeat = ledger field (legacy runs and pre-first-tick runs behave exactly as today).
- File present but blank/unparseable → treated as null, silently; falls back to the field.
- File present, ledger absent → `cmdHeartbeat` soft no-op unchanged; nothing is held.
- Ledger malformed → exit 2, loud, unchanged; no file write.
- Done/unowned run → `written:false`, no file write; no possible resurrection.
- Concurrent ticks from N subagents → atomic whole-file replaces of the same scalar; any interleaving yields *some* recent timestamp — correct by the signal's semantics.

## 5. Scenarios

```
Given a run ledger with owner.status "running" and two admitted issues
When 8 concurrent `faff heartbeat <run_dir>` processes race an orchestrator outcome write
  (ledger rewritten with a new outcomes entry mid-flight)
Then the final ledger contains every outcome written (no lost update),
  every heartbeat exit code is 0, and the heartbeat file parses as a valid ISO timestamp
```

```
Given a legacy run dir with a running owner, a fresh owner.last_heartbeat, and NO heartbeat file
When runcheck --hook evaluates liveness
Then the run is held (silent) — the ledger-field fallback carries legacy runs
```

```
Given a running owner whose ledger field is older than the staleness window
  but whose heartbeat file is fresh
When runcheck --hook, the agency-mode pin, prepIsHeld tier (a), and sentry check each evaluate
Then all four report live/held, and sentry's wall-clock evidence names heartbeat_source "heartbeat-file"
```

```
Given a ledger with owner.status "done"
When `faff heartbeat <run_dir>` runs
Then exit 0 with written:false, no heartbeat file is created, and the run stays not-held
```

Assertion: after a tick on a running run, `run-ledger.json` is byte-identical to its pre-tick content.

## 6. DESIGN DECISION RATIONALE

- **Where does the heartbeat signal live?** One per-run file `.faff/runs/<run-id>/heartbeat`, bare ISO + newline.
- **Content or mtime as the timestamp?** Content — uniform with every existing `Date.parse` liveness path.
- **Fallback semantics?** Max-of-both, indefinite — order-independent, zero-migration, fail-safe toward live.
- **Dual-write or stop writing the ledger?** The tick's only write is the file; ledger access in the tick is read-only.
- **How do readers pick up the file?** Overlay — pure predicates untouched, one new pure core, four call-site edits.
- **Sentry evidence?** `heartbeat_source` carrying the winning source.
- **`applyHeartbeat`?** Delete + rewrite the selftest around the new pure cores.
- **Decision record?** ADR-0015 fixed the field-merge-on-ledger write locus; author a new ADR at graft time amending ADR-0015 — write locus moves to the dedicated file; the ledger field is demoted to run-start baseline + fallback.
- **Concurrency test shape?** A node:test fixture spawning N real `faff heartbeat` child processes racing scripted outcome writes, asserting Scenario-1 outcomes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None. Every decision above is closed; no external dependencies beyond files verified present in-repo.

## 8. DONE — Definition of Done

### From WHAT (file + cores)
- [ ] `.faff/runs/<run-id>/heartbeat` written atomically (tmp + rename), content exactly one ISO timestamp + newline
- [ ] `effectiveHeartbeatIso` returns the max of two ISO inputs; null/unparseable inputs fall back to the other; both-null → null
- [ ] `overlayHeartbeat` sets the owner field to the effective value and reports the winning source; no-ops on ownerless ledgers
- [ ] `faff heartbeat --json` shape unchanged: `{ run_dir, last_heartbeat, written }`

### From HOW (write path)
- [ ] A tick on a running run writes only the heartbeat file; `run-ledger.json` byte-identical before/after
- [ ] Done/unowned/absent-ledger runs: exit 0, `written:false`, no file created; malformed ledger: exit 2
- [ ] `applyHeartbeat` removed; heartbeat selftest rewritten (guard + max/null table + overlay→`runIsHeld` interaction), still no filesystem I/O

### From HOW (read seams)
- [ ] All four consumers evaluate file-first-via-overlay: runcheck `--hook`, agency-mode pin, `prepIsHeld` tier (a), sentry `check`
- [ ] `RUNCHECK_SELFTEST_CASES` extended with a heartbeat-file column: fresh-file/stale-field → held; no-file/fresh-field → held; both-stale → warn; unparseable-file/fresh-field → held
- [ ] Sentry wall-clock evidence emits `heartbeat_source` with the true source; `ledger_field` gone; `test/sentry.test.mjs` updated
- [ ] `test/prepcheck.test.mjs` gains a tier-(a) case where a fresh heartbeat file (stale ledger field) holds the marker

### From HOW (concurrency proof)
- [ ] Concurrent-writers node:test: N spawned `faff heartbeat` processes racing outcome writes → all outcomes present in the final ledger, all ticks exit 0, heartbeat file parses (Scenario 1)

### From WHY/HOW (prose + docs, same PR)
- [ ] Parallel executor SKILL.md drops the "unresolved" caveat blockquote and describes the file model; no FAFF-NN refs in the new prose
- [ ] Sequential executor SKILL.md mechanism sentence updated (field-merge → file); behaviour prose otherwise unchanged
- [ ] bin/faff USAGE (heartbeat + sentry) and `docs/guide/cli.md` (heartbeat + sentry rows) describe the file write path and the fallback
- [ ] ADR authored amending ADR-0015 (write locus → dedicated file; ledger field = run-start baseline + fallback)
- [ ] `test/heartbeat.test.mjs` assertions revised (ledger byte-identical; file created with fresh ISO)

**Integration smoke test:**

```
1. Mint a run dir with a running-owner ledger (stale last_heartbeat)
2. Run `faff heartbeat <run_dir> --json`         -> written:true
3. Assert heartbeat file exists + fresh; ledger bytes unchanged
4. Run `faff runcheck --hook` on that run dir     -> held/silent
5. Run `faff sentry check --run-dir <run_dir>`    -> no wall-clock trip; any evidence names heartbeat_source
```

confidence: high

spec-review: approve
