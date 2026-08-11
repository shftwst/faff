# FAFF-500 — Per-phase explore-vs-synthesis token & turn attribution (`faff economics --by phase`)

> Spec: faffter-dark-nlspec · 2026-07-14 · interactive · confidence: medium. Full spec on Linear FAFF-500.

FAFF-408 gave us `--tokens` phase deltas at the prep/build boundary, but a single `prep-start`→`prep-done` window brackets the *cheap-lane explore subagent* and the *expensive frontier synthesis* together. This spec adds a read-only, retro-capable `--by phase` axis to `faff economics` that splits a run's four-class token spend (and turn/tool-call counts) into **prep-explore** (cheap child) vs **prep-synthesis** (expensive parent) vs **build** — so a grounding/leaner-prompt intervention can be judged against the part that actually costs money, not the part that's already cheap.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** A run owns an *ordered* set of transcript files: `files[0]` is the parent orchestrator session (the frontier *synthesis*), `files[1:]` are FAFF-229-owned `agent-*.jsonl` children (the explore subagent and any build subagents). The phase a child belongs to isn't written on the child — it's inferred by asking *which run-window its records fall inside*, where the windows come from `events.jsonl` (`prep-start`/`prep-done`, `build-start`/`issue-outcome`). Retain file identity + bracket by window and the prep window resolves into two distinct populations (parent-synthesis records vs explore-child records) that the current flattened reader collapses into one.

**Problem statement.** Today `prep-start`→`prep-done` is one undivided window over both the cheap explore child and the expensive parent synthesis, so we can't tell whether an intervention cut the frontier cost or just the cheap lane. This spec pivots the existing run-owned transcript walk into per-phase buckets, using `events.jsonl` windows to separate explore from synthesis. The result is a reporting axis, not a new meter.

**Design principles.**

- **Reconcile-by-construction or don't ship the number.** The phase buckets must sum, four-class, to the exact flat `measureTokens` top-line over the *same* files — mirroring how `--by class` reconciles (economics.js:421-426). A number that doesn't reconcile is a bug, not a rounding note.
- **Undercount-not-misattribute.** When a window boundary is unusable (missing/unreliable event `ts`) or a record falls in no window, the record goes to an explicit `unattributed` bucket surfaced in the reconciliation line — never guessed into prep or build. This is the FAFF-229 ownership-gate philosophy applied to phase.
- **Reporting consumer only (FAFF-359).** economics.js (factory) imports from budget.js/events.js (governance); never mutates a producer. No ledger schema change, no new event type.
- **Non-leak (FAFF-407 §5).** Emit only counts, sizes, names, model-ids, phase-labels and derived costs — never transcript or event payload content.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/economics.js` | Host: `BY_AXES` (:169), `cmdEconomics` axis dispatch (:800-828), `readRunTranscriptRecords` (:606-627), `readRunEvents` (:591-604), `economicsEffortBreakdown` (:529-584) — closest sibling axis |
| `plugin/skills/faff/bin/lib/budget.js` | Reused: `sessionOwnedTranscriptFiles` (:399-428, `files[0]`=main), `childOwningSession` (:368-379), `sumTranscriptFileByModelClass` (:316-338), `TOKEN_DELTA_CLASSES`/`TOKEN_CLASS_FROM_USAGE` |
| `plugin/skills/faff/bin/lib/events.js` | `EVENT_TYPES` incl. `prep-start`/`prep-done`/`build-start`/`issue-outcome`; `seq` authoritative, `ts` best-effort (header :4-7) |
| `scripts/token-breakdown.mjs` | Source of the tool-indexing pattern to *port* (`indexToolUse` :132-142) — NOT a host (no run-scoping, no FAFF-229 gate) |
| `test/economics.test.mjs` | Fixture helpers `withTranscripts`/`withRecords`/`withEvents`; effort integration test (:456-502) is the DoD template |

**Scope statement.** One additional value in `BY_AXES` and one dispatch branch inside `cmdEconomics`, plus a per-file-retaining reader and a pure phase-breakdown core — the same shape the effort/mcp axes already occupy.

---

## 2. OUT OF SCOPE

- **Forward live per-file checkpoint** — a `budget.tokens_at_last_event_by_file` (or a `prep-explore-done --tokens` boundary event) that would let *live* `prep-done` deltas be split at emit time. **Why excluded:** FAFF-500 is framed read-only/retro; `budget.tokens_at_last_event` is a single scalar and splitting it live is a forward-only producer change. **Extension point:** a new issue-scoped event type + a per-file checkpoint in budget.js (conditional follow-up — see Open Questions).
- **Per-issue phase sub-breakdown** — this axis aggregates each phase *class* across the whole run. **Extension point:** the window list already carries `issue`; a `--by phase --group issue` variant would fan the buckets per issue.
- **Splitting `build` into build-orchestration vs build-child.** The ticket asks for explore-vs-synthesis-vs-build, treating build as one. **Extension point:** the phase core already knows main-vs-child; add a fourth bucket via the same `isMain` flag.
- **Retiring `scripts/token-breakdown.mjs`.** It stays a throwaway spike; we port its tool-indexing, we don't depend on it.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Phase window | A `[start, end]` pair of `events.jsonl` records for one issue+phase: prep = `prep-start`→`prep-done`; build = `build-start`→`issue-outcome`. Paired by `seq` order, delimited on the `ts` clock. |
| Main file | `files[0]` from `sessionOwnedTranscriptFiles` — the parent orchestrator `<sid>.jsonl`. Its prep-window records = **prep-synthesis**. |
| Child file | `files[1:]` — a FAFF-229-owned `agent-*.jsonl`. A prep-window child = **prep-explore**; a build-window child = **build**. |
| Turn | One assistant record. |
| Tool-call | One `tool_use` content block inside a record. |
| Unattributed | A record whose `timestamp` matches no window (or whose window boundary lacks a usable `ts`) — surfaced, never folded into a phase. |

**Type definitions.**

```
RECORD PhaseWindow:
  phase: "prep" | "build"
  issue: string
  start_seq, end_seq: int        # authoritative order
  start_ts, end_ts: string|null  # best-effort clock; null ⇒ window unusable

RECORD FileRecords:
  file: string
  is_main: bool                  # true for files[0] only
  records: Record[]

ENUM PhaseBucketKey: "prep-explore" | "prep-synthesis" | "build" | "unattributed"

RECORD PhaseRow:
  key: PhaseBucketKey
  input, output, cache_write, cache_read, total: int
  turns, tool_calls: int
  cost: number | null            # dominant-model rate card; null if unpriced

RECORD PhaseBreakdown:
  axis: "phase"
  source: "transcript" | "estimate"
  priced_at_model: string | null
  cost_basis: "estimate"
  rows: PhaseRow[]              # fixed order: prep-explore, prep-synthesis, build, unattributed (occurring only)
  reconciliation:
    grand_total, top_line_total: int|null
    reconciles: bool             # grand_total === top_line_total
    coverage_pct: number|null    # 100*(grand - unattributed)/top_line
    windows_found, events_malformed: int
  CONSTRAINT sum(rows.four_class) === top_line_total   # incl. unattributed
```

**Interfaces (economics.js).**

- `BY_AXES` (:169) gains `"phase"`.
- New I/O reader `readRunTranscriptRecordsByFile(cwd, env, runStartMs) → { files: FileRecords[], source }` — per-file-retaining sibling of `readRunTranscriptRecords` (which flattens and loses origin). Walks the *same* `sessionOwnedTranscriptFiles` set; `files[0].is_main = true`.
- New pure core `phaseWindowsFromEvents(events) → PhaseWindow[]` — pairs start/end per issue+phase by `seq`.
- New pure core `economicsPhaseBreakdown(fileRecords, windows, priceMap, dominant, topLineTotal, eventsMalformed) → PhaseBreakdown`.
- `renderEconomicsBreakdown` gains a `phase` branch mirroring the effort table (adds `turns`/`tool_calls` columns).
- `module.exports` gains the three new names.

**Chosen — host.** **Chosen:** economics.js `--by phase`, not a `token-breakdown.mjs` extension — token-breakdown reads *every* `.jsonl` flat, corpus-wide, with no run-scoping and no FAFF-229 ownership gate; economics.js is the only home where the census is already correctly scoped.

**Chosen — reader.** **Chosen:** a per-file-retaining sibling `readRunTranscriptRecordsByFile`, leaving the flat reader byte-unchanged for existing callers — the existing reader flattens all owned files into one array with no origin tag, the exact split we need.

---

## 4. HOW — Behavior

**Architecture.** Unlike the transcript-only axes (`class`/`model`/`day`/`mcp`) and the events-only axis (`effort`), `phase` is a **join**: it needs the per-file transcript census *and* the event windows. The `cmdEconomics` phase branch reads both, builds windows, then buckets each record by (window-phase × file-identity).

```
PROCEDURE cmdEconomics --by phase:
  1. Resolve run dir + priceMap as today.
  2. IF measuredSource != "transcript": emit estimate-source empty breakdown.
  3. { files } = readRunTranscriptRecordsByFile(root, env, runStartMs)
  4. { events, malformed } = readRunEvents(runDir)
  5. windows = phaseWindowsFromEvents(events)
  6. dominant = economicsDominantModel(flatten(files))
  7. bd = economicsPhaseBreakdown(files, windows, priceMap, dominant, measuredTotal, malformed)
  8. render (or --json alongside econ, as effort does)
```

```
PROCEDURE phaseWindowsFromEvents(events):
  1. Sort events by seq (authoritative; ts best-effort).
  2. Pair each issue-scoped prep-start with next prep-done for that issue → PhaseWindow(prep).
  3. Pair each build-start with next issue-outcome for that issue → PhaseWindow(build).
  4. Record start_ts/end_ts from each event's envelope ts (may be null/absent).
  5. A start with no matching end, or a boundary with no usable ts, yields a window
     flagged unusable (its records fall to unattributed) — never dropped silently.
```

```
PROCEDURE economicsPhaseBreakdown(files, windows, priceMap, dominant, topLine, malformed):
  buckets = { prep-explore, prep-synthesis, build, unattributed }
  FOR each FileRecords f, each record r in f.records:
    u = usageOf(r)
    w = usable window whose [start_ts, end_ts] contains r.timestamp
    key = w is null            → "unattributed"
        | w.phase == "build"   → "build"
        | f.is_main            → "prep-synthesis"   # parent, in prep window
        | else                 → "prep-explore"     # child, in prep window
    IF u: add r's four classes to buckets[key] (+ grandTotal)
    IF r is assistant turn: buckets[key].turns += 1
    FOR each tool_use block in r: buckets[key].tool_calls += 1
  rows = fixed-order occurring buckets, each priced via economicsRowCost(counts, dominant, priceMap)
  reconciliation:
    grand_total = Σ row.total;  reconciles = (grand_total === topLine)
    coverage_pct = topLine>0 ? 100*(grand_total - unattributed.total)/topLine : null
```

**Behavior.** Turn = assistant record per bucket; tool-call = `tool_use` block per bucket (ported from token-breakdown's `indexToolUse`, counting per bucket not building an MCP id-map). Reconciliation is total (all four buckets incl. `unattributed`), so it holds even when windows are incomplete — the coverage gap moves to `unattributed`, the sum stays exact.

**Edge cases.**
- **No `events.jsonl`** (retro over a pre-events run) → `windows=[]` → every record `unattributed`, `coverage_pct=0`, `reconciles=true`, `source="transcript"`. Honest empty split, not an error.
- **No resolvable transcript** → `source:"estimate"`, empty rows (parity with class/model/day).
- **Concurrent/interleaved windows** — a record's `timestamp` could sit in two issues' windows. Precedence: innermost/most-recent (latest `start_seq` still containing the ts); ties → build over prep (terminal phase).
- **Unpriced dominant model** → `cost:null` per row.

**Failure modes.**
- Event `ts` is best-effort/sandbox-unreliable, so the bracket can misplace a near-edge record or drop a child to `unattributed` on a missing boundary ts. **How you'd know:** high `unattributed` share / `coverage_pct` well below 100 on runs that clearly had prep+build. **What it means:** the total is still sum-correct (reconciles), but the *split* is low-confidence for that run; persistent low corpus-wide coverage is the concrete trigger to file the forward per-file checkpoint follow-up — the signal, not a hidden defect.
- `prep-explore` is disambiguated purely file-level (child-in-prep-window), assuming the only prep-window child is the explore subagent. **How you'd know:** a prep window owning >1 child. **What it means:** narrow — today prep dispatches exactly one explore child (`models.prep_explore`); revisit if that changes.

**Anti-patterns.** (1) Re-reading transcripts a second time for the phase census — the phase core must pivot the *same* record set so it reconciles by construction. (2) Bracketing on event `ts` as authoritative — edge ambiguity must land in `unattributed`, not be guessed.

---

## 5. SCENARIOS — born-verifiable

```
Given a run: files[0] (parent synthesis) + one prep-window child (explore) + one
     build-window child (build), and events.jsonl with prep/build start+end (ts)
When faff economics --by phase --json runs over that run dir
Then rows are keyed prep-explore/prep-synthesis/build (fixed order); the explore
     child's four-class tokens land in prep-explore, the parent's prep-window records
     in prep-synthesis, and both build-window populations in build
```
```
Given the same run
When the phase breakdown is produced
Then the four-class sum across ALL buckets (incl. unattributed) equals the flat
     measureTokens top-line over the same files; reconciliation.reconciles === true
```
```
Given a run dir with NO events.jsonl (retro over the existing corpus)
When faff economics --by phase runs
Then it exits 0, source === "transcript", every token lands in unattributed,
     coverage_pct === 0, reconciles === true — an honest empty split, not an error
```
```
Given a run where the prep window's boundary event carries no usable ts
When the phase breakdown is produced
Then the parent's prep-window records fall to unattributed (not guessed into
     prep-synthesis), reconciles stays true, coverage_pct reflects the gap
```

- Non-leak: the breakdown JSON contains only counts, four-class integers, turns, tool_calls, phase-labels, model-id, derived cost — no transcript/event payload string.

---

## 6. OPEN QUESTIONS AND ASSUMPTIONS

- **Punt:** File the forward per-file checkpoint (a `prep-explore-done --tokens` boundary event, or `budget.tokens_at_last_event_by_file`) as a follow-up — OR leave retro-only permanently? This is a **conditional, non-blocking** decision that does **not** gate building the retro pass: it is answered *by* running this pass over the corpus. Low `coverage_pct` / large `unattributed` ⇒ forward checkpoint warranted; a clean retro split ⇒ retro-only stands. The resolution mechanism is the very metric this ticket ships.
- **Assumes:** a run's `events.jsonl` carries `prep-start`/`prep-done`/`build-start`/`issue-outcome` with an envelope `ts`. *Validate:* runs predating the events lane hit the "no events.jsonl → all unattributed, exit 0" edge — no crash.
- **Assumes:** `sessionOwnedTranscriptFiles` returns `files[0]` = the parent `<sid>.jsonl`. *Validate:* the per-file reader marks `is_main` on index 0 only; a unit assertion pins this.

---

## 7. DONE — Definition of Done

**From WHY**
- [ ] `--by phase` is read-only: no ledger write, no new event type, no producer touched (grep confirms only economics.js + tests change).
- [ ] Phase buckets sum four-class to the flat `measureTokens` top-line over the same files (reconciliation test).

**From WHAT**
- [ ] `BY_AXES` includes `"phase"`; an unknown `--by` value still exits 2 naming the set.
- [ ] `readRunTranscriptRecordsByFile` returns `FileRecords[]` with `is_main === true` for index 0 only; walks the same owned-file set; degrades to `source:"estimate"` with no transcript.
- [ ] `phaseWindowsFromEvents` pairs prep-start↔prep-done and build-start↔issue-outcome per issue by `seq`; an unmatched start or ts-less boundary yields no usable window.
- [ ] `economicsPhaseBreakdown` emits rows keyed `prep-explore`/`prep-synthesis`/`build`/`unattributed` (fixed order, occurring only), each with four-class + `turns` + `tool_calls` + `cost`.
- [ ] Three new names exported in `module.exports`.

**From HOW**
- [ ] Prep-window child tokens → `prep-explore`; parent prep-window records → `prep-synthesis`; build-window populations → `build`.
- [ ] `turns` counts assistant records per bucket; `tool_calls` counts `tool_use` blocks per bucket.
- [ ] Cost per row priced at the run's dominant model, `null` when unpriced.
- [ ] `--json` emits `{ ...econ, breakdown }` (effort parity); text render adds `turns`/`tool_calls` columns.
- [ ] No `events.jsonl` → exit 0, all `unattributed`, `coverage_pct:0`, `reconciles:true`, `source:"transcript"`.
- [ ] No resolvable transcript → `source:"estimate"`, empty rows.
- [ ] A ts-less window boundary → its records `unattributed` (not guessed); reconciliation exact; `coverage_pct` reflects the gap.
- [ ] Interleaved windows resolve innermost-latest-`start_seq`, build-over-prep on ties.

**From non-functional**
- [ ] Non-leak: the breakdown JSON contains no transcript/event payload string (assert a planted `SECRET-*` payload never appears).

**Eval coverage** — n/a (deterministic pivot; no LLM-judgement seam).

**Integration smoke test.** Extend `test/economics.test.mjs`: fixture = `<sid>.jsonl` (parent, records inside both prep+build windows) + `agent-explore.jsonl` (prep window) + `agent-build.jsonl` (build window) + events.jsonl (prep-start/done, build-start/issue-outcome with ts) + run-ledger. Run `economics --by phase --json`; assert per-bucket totals, `reconciles===true`, `grand_total===flat top-line`; plus a second run over a run dir with **no** events.jsonl → all unattributed, exit 0.

---

confidence: medium
