# Spec: FAFF-1131 — Judge-trail retains per-round objection history, not just the endpoint

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1131.

This is a design-level spec for the build agent and human reviewers. It defines what to build to make the durable judge-trail carry per-round spec-review convergence history, and how `faff judge-history` surfaces it. The change is confined to `plugin/skills/faff/bin/lib/judge-trail.js` and its test. FAFF-1131 ships the retention; its sibling slice FAFF-1132 bounds the retained corpus and is out of scope here.

## 1. WHY — Problem and Principles

**The model to hold first.** A multi-round spec review produces one `round-<n>.json` per round, each carrying that round's `objections` array. The convergence loop narrows objections round-on-round until the review settles. The durable judge-trail mint currently copies only the *latest* round's objections (its standing-residue proxy) into `refs/faff/judge-trail/<run_id>`, so every earlier round is read for enumeration and then discarded. This spec keeps each in-window round's objections verbatim, as a new per-issue trail member, and gives `judge-history` a query surface that returns them.

**Problem statement.** For a review that took several rounds, the trail lets you reconstruct where the spec landed but not how it got there, so the round-on-round objection history that would drive audit and calibration is gone once the run-dir is swept. This change retains the per-round objections in the trail and lets `faff judge-history` return them. The result is audit and calibration material, not a safety input.

**Design principles.**

- **The trail is audit and calibration material, never a run-control input.** Nothing in the accept path, merge, or park may gain a dependency on this data. The FAFF-946 "option 3" resolution decoupled the trail from the L4 safety story; the judge only ever rules on the final standing residue. Per-round history is strictly additive record-keeping.
- **The mint stays best-effort at run close.** It must never gate a run close, a merge, or a park. A failure to write per-round data degrades exactly as the current mint does: log and proceed.
- **Verbatim, never re-derived.** Per-round objections are copied byte-faithful from each round record. The mint does not re-interpret, re-score, or ledger-enrich earlier rounds.
- **No new plumbing at the boundary.** `window_start` is already on disk in the mint's reach; read it in-process. Do not add a CLI argument, and do not touch the beep-boop call site or the spec-review loop.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/judge-trail.js` | Node (region:factory) | The only file changed: mint/pack writer + `judge-history` reader |
| `plugin/skills/faff/bin/lib/spec-review-convergence.js` | Node (region:factory) | Exports `roundFilesInDir(dir)` — already required by judge-trail.js |
| `plugin/skills/faff/bin/lib/spec-review-window.js` | Node (region:factory) | Exports `readWindowStart(dir)` — the in-process window source to add |
| `plugin/skills/faff/bin/lib/spec-review-pin.js` | Node (region:factory) | Defines `specReviewDir(issue, runDir)` = `<runDir>/<issue>/spec-review` |
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` | Node (region:factory) | Prior art: `readStandingResidue(dir, windowStart)` filters `f.n >= windowStart` |
| `test/judge-trail.test.mjs` | Node test | The only trail test; single-round today; gains multi-round fixtures |

**Scope statement.** This slice sits inside the FAFF-994 durable judge-trail (mint writer plus `judge-history` reader), extending what one issue's subtree records and what the reader can return.

## 2. OUT OF SCOPE

- **The storage bound (hard write cap + two-phase truncation).**
  - *Why excluded:* it is the explicit remit of sibling slice FAFF-1132; FAFF-1131 ships retention, FAFF-1132 bounds it.
  - *Extension point:* the per-round writer in `buildIssueSubtree` / a new `collectObjectionsByRound` helper in `judge-trail.js`, where FAFF-1132 will apply the `OBJECTIONS_BLOB_WRITE_CAP` and truncation.

- **FAFF-928 raw response bodies (`<scratch>/raw/round-<n>.<lens>.<...>.txt`).**
  - *Why excluded:* they are large (per-file byte-capped, many files per pass), the trail packer never reads them today, and their storage bound is FAFF-1132's concern; the structured per-round objections satisfy this slice's core objective. This is a decided exclusion with the reason recorded, not a deferred question. See the Design Decision Rationale.
  - *Extension point:* `buildIssueSubtree` in `judge-trail.js` (a future member would pack from `<specReviewDir>/raw`), bounded by FAFF-1132.

- **Ledger enrichment of earlier rounds (`contested_source`, ledger-carried `lens`/`severity`).**
  - *Why excluded:* the ledger reflects the *final* assembled residue and index-matches only the latest round via the `p-NN` scheme; earlier rounds have different objection counts and no stable ledger mapping. `contested_source` is a final-assembly concept and does not apply per-round.
  - *Extension point:* `collectObjections` retains its existing ledger enrichment for the standing-residue `objections.json`; the per-round member stays verbatim.

- **Changing `manifest.lenses` semantics.** It continues to mean the standing-residue lens set (deduped, sorted, from `collectObjections`). Per-round data does not alter it.

- **Any change to the accept path, the spec-review loop, or the beep-boop mint call site.** `window_start` is read in-process, so no call site changes.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Round record | `<specReviewDir>/round-<n>.json` = `{ verdict, objections }`, one per review round |
| Standing residue | The latest in-window round's objections; what the judge ruled on and what `objections.json` records today |
| Convergence window | The round range `[window_start .. max]`; rounds below `window_start` predate a resume and are excluded |
| Per-round history | The verbatim objections of every in-window round, the new member this slice adds |

**Round objection shape (verbatim, existing on disk).**

```
RECORD Objection:            # exactly as it sits in round-<n>.json
  lens: String               # e.g. "infosec" | "architectural" | "methodology" | "qa"
  severity: String           # e.g. "blocker" | "major" | "minor"
  claim: String
  evidence: String
  predicted_consequence: String | null
  spec_anchor: String
  # NOTE: no contested_source in the round record (that is a ledger/final-assembly field)
```

**New per-issue trail member: `objections-by-round.json`.**

```
RECORD RoundObjections:
  round: Integer             # the round number n from round-<n>.json
  window_start: Integer      # the resolved window_start applied to this issue (>= 1)
  objections: List<Objection># the round record's objections array, verbatim

TYPE ObjectionsByRound = List<RoundObjections>   # ascending by round; in-window rounds only
```

- **New member, not a redefinition.** The existing `objections.json` keeps its current meaning: the standing-residue-only array with ledger enrichment. `objections-by-round.json` is a distinct file. This avoids the naming collision entirely.
- **Empty case.** When there are no in-window rounds (or no round files), `objections-by-round.json` is `[]`. It is always written, so a reader can distinguish "no per-round data retained" (member absent, an older trail) from "review had no in-window rounds" (member present, empty array).

**Design decision — naming and shape.** Options: (a) new `objections-by-round.json` member keeping `objections.json` = standing-residue-only; (b) redefine `objections.json` to carry cross-round data (breaking). **Chosen:** (a) — a new member. The FAFF-1019 round-3 "objections.json cross-round union" idea exists only in ticket text, never in code, and redefining a shipped member for no gain breaks readers.

**Manifest change (`buildIssueSubtree` → `manifestCore`).**

```
RECORD ManifestCore:         # additions marked; everything else unchanged
  schema_version: Integer    # bump 1 -> 2 (see decision below)
  issue: String
  run_id: String
  built_spec_sha: String
  spec_blob: String | null
  objections: "objections.json"                     # unchanged, standing residue
  objections_by_round: "objections-by-round.json"   # NEW pointer
  rulings: "rulings.json"
  admit_result: String | null
  outcome: String
  lenses: List<String>       # unchanged: standing-residue lens set
  # witness_sha computed over this core, as today (canonicalJSON + sha256)
```

- **Design decision — pointer in the witnessed core.** The new pointer name goes in `manifestCore` alongside `objections`/`rulings`, so `witness_sha` covers it exactly as it covers the existing pointers. **Chosen:** add `objections_by_round` to `manifestCore`. Note the pre-existing property (unchanged by this slice): `witness_sha` covers manifest fields, not the blob *bytes* of `objections.json`/`rulings.json`; the per-round blob inherits the same tamper-detection scope, no weaker and no stronger than the members already shipped.

- **Design decision — schema_version bump.** A trail minted before this slice has no `objections-by-round.json` and no pointer. **Chosen:** bump `SCHEMA_VERSION` 1 → 2. Readers use it to tell old trails (no per-round data) from new. `judge-history --rounds` against a v1 trail degrades gracefully (see HOW).

**`window_start` sourcing.** **Chosen:** read `window_start` in-process via `readWindowStart(specReviewDir)`, imported from `spec-review-window.js`. This is a factory-to-factory require, the same edge class judge-trail.js already uses for `roundFilesInDir`. Absent `window.json` → `1` (fail-safe, existing contract). No CLI argument; the beep-boop call site is untouched.

**`judge-history` reader surface — new `--rounds` flag.**

```
faff judge-history [--issue ID] [--run RUN_ID] [--lens L] [--outcome O] [--rounds] [--root DIR] [--json]
```

- Default (no `--rounds`): behaviour unchanged — one record per (run_id, issue) from `manifest.json` only, no objection blobs fetched.
- With `--rounds`: each record additionally carries `objections_by_round` (the parsed `ObjectionsByRound` array), fetched per record from the trail blob via the existing `showBlob(root, sha, "<issue>/objections-by-round.json")`.

```
RECORD JudgeHistoryRecord:   # + field present only under --rounds
  run_id, issue, outcome, lenses, manifest, tamper_suspect   # unchanged
  objections_by_round: ObjectionsByRound | null   # NEW; null when the blob is absent (v1 trail) or unreadable
```

- **Design decision — how a caller asks and what returns.** Options: a `--rounds` flag that enriches records vs. a separate subcommand vs. always fetching. **Chosen:** a `--rounds` opt-in flag. It keeps the default read cheap (no per-record blob fetch, the current cost profile), which matters because `judge-history` with no `--run` filter enumerates every trail ref. The AC requires this surface: today `judge-history` returns no objections at all through its own CLI.

## 4. HOW — Behavior

**Architecture and approach.** Two verbatim copy points, both inside `judge-trail.js`, mirroring the existing `collectObjections` → `buildIssueSubtree` path.

1. **Writer.** A new pure helper `collectObjectionsByRound(specReviewDir)` reads `readWindowStart(specReviewDir)`, filters `roundFilesInDir(specReviewDir)` to in-window rounds, and reads each round's `objections` verbatim. `buildIssueSubtree` writes the result as `objections-by-round.json`, adds the manifest pointer, and bumps the schema version. Everything else in the mint (staging, `write-tree`, `commit-tree`, ref update/push, write-once no-op, best-effort skip-on-error) is unchanged.

2. **Reader.** `judgeHistory(filters, opts)` gains an `opts.rounds` (or `filters.rounds`) path: when set, after building each manifest record, fetch and parse the per-round blob at the same commit and attach it. `cmdJudgeHistory` passes the new flag and renders it.

**Writer pseudocode.**

```
PROCEDURE collectObjectionsByRound(specReviewDir):
  1. windowStart = readWindowStart(specReviewDir)      # absent window.json -> 1
  2. rounds = roundFilesInDir(specReviewDir)            # [] on any read error
  3. out = []
  4. FOR each f in rounds WHERE f.n >= windowStart (ascending by n):
     a. parsed = JSON.parse(read(f.path)); on parse error, SKIP this round
     b. objections = Array.isArray(parsed.objections) ? parsed.objections : []
     c. out.push({ round: f.n, window_start: windowStart, objections })   # verbatim, no enrichment
  5. RETURN out                                          # [] when no in-window rounds
```

```
PROCEDURE buildIssueSubtree(runDir, issue, specReviewDir, judgeDir):   # additions only
  ... existing: ledger, admitResult, objections, rulings, specText, outcome, lenses ...
  objectionsByRound = collectObjectionsByRound(specReviewDir)
  files["objections-by-round.json"] = JSON.stringify(objectionsByRound, null, 2) + "\n"
  manifestCore.schema_version = 2
  manifestCore.objections_by_round = "objections-by-round.json"
  ... existing: witness_sha over manifestCore, write manifest.json ...
```

**Reader pseudocode.**

```
PROCEDURE judgeHistory(filters, opts):                  # additions only
  ... existing enumeration + per-issue readManifestRecord ...
  IF opts.rounds:
     FOR each record rec with a resolvable (sha, issue):
       bytes = showBlob(root, rec._sha, `${rec.issue}/objections-by-round.json`)
       IF bytes == null: rec.objections_by_round = null      # v1 trail or absent
       ELSE:
         TRY   rec.objections_by_round = JSON.parse(bytes)
         CATCH rec.objections_by_round = null                 # unreadable, never throw
  RETURN { ok: true, records }
```

```
PROCEDURE cmdJudgeHistory(args):                        # additions only
  parse --rounds (arity 0) into JUDGE_HISTORY_SPEC
  result = judgeHistory({...filters}, { root, rounds: values["--rounds"] })
  IF --json: print records (each carries objections_by_round when --rounds)   # unchanged path otherwise
  ELSE, per record: existing summary line; when --rounds, also print one line per round:
        `  round <n> (window_start=<ws>): <k> objection(s) [lenses: ...]`
```

**Behaviour summary.** The writer copies each in-window round's objections into a new trail member; the reader, on request, hands them back. No interpretation happens at either end.

**Edge cases and error handling.**

- **No round files / unreadable dir:** `roundFilesInDir` returns `[]`; `objections-by-round.json` is `[]`. Not an error.
- **`window_start` above every round number:** every round is excluded; member is `[]`. Correct (pre-window rounds are meant to be dropped).
- **Malformed `window.json`:** `readWindowStart` throws `WindowMarkerError` on a malformed marker (not on absence). The mint is best-effort per issue: catch it, treat `window_start` as `1` for that issue's per-round pass, and continue rather than abort the issue subtree. (An absent marker already yields `1` without throwing.)
- **A single round record unparseable:** skip that round only; other in-window rounds still recorded.
- **Reader against a v1 trail (`--rounds`):** `objections-by-round.json` blob is absent; `showBlob` returns null; record carries `objections_by_round: null`. No error, no tamper flag change.
- **Reader blob present but unparseable (`--rounds`):** `objections_by_round: null`; the record's existing `tamper_suspect` (manifest-scoped) is unaffected — the per-round blob is not part of the witness envelope's byte scope, consistent with the other member blobs.

**Failure modes.**

- **The failure:** the per-round objections may not be the calibration signal expected, because the *round-record* objections are pre-ledger (no `contested_source`, and lens/severity are the reviewer's raw values, not the assembled ledger's). A consumer expecting ledger-grade fields per round would read incomplete data.
  - *How you'd know:* per-round entries never carry `contested_source`; downstream calibration that keys on it finds it only in the standing-residue `objections.json`.
  - *What it means:* proceed. This is intended (see Out of Scope); the standing residue remains the enriched, judge-ruled record. Documented so no one "fixes" it by index-matching the ledger to earlier rounds.

- **The failure:** unbounded growth. Full per-round retention across all in-window rounds, for every issue in every run, grows the trail without limit.
  - *How you'd know:* trail ref/pack size climbs with review round counts over time.
  - *What it means:* narrow via FAFF-1132, not here. This slice deliberately ships the growth and hands the bound to the sibling. See Assumptions.

**Anti-patterns.**

- **Anti-pattern:** re-deriving or ledger-enriching earlier rounds' objections. Why: the ledger index-matches only the final residue; forcing it onto earlier rounds fabricates associations. Copy verbatim.
- **Anti-pattern:** adding a `--window-start` (or any) CLI argument to `judge-trail mint`. Why: `window_start` is on disk in the mint's reach; read it via `readWindowStart(specReviewDir)`. New argv would also force a beep-boop call-site change this slice forbids.
- **Anti-pattern:** reusing the name `objections.json` for per-round data. Why: it silently redefines a shipped member and breaks readers; use the new `objections-by-round.json`.
- **Anti-pattern:** having `judge-history` fetch the per-round blob by default. Why: the default path stays manifest-only and cheap across an unfiltered ref enumeration; per-round fetch is opt-in behind `--rounds`.
- **Anti-pattern:** letting a per-round write failure abort the mint or gate the run close. Why: the trail is best-effort audit material; failures log and proceed.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec review that ran 3 in-window rounds (round-1..3.json, window_start absent -> 1)
When faff judge-trail mint runs at run close
Then the issue subtree contains objections-by-round.json with 3 entries, rounds 1,2,3 ascending,
     each entry's objections equal to that round record's objections array verbatim
```

```
Given a minted trail with per-round data for a >1-round review
When faff judge-history --run <run_id> --issue <issue> --rounds --json runs
Then the returned record carries objections_by_round listing each round's objections,
     and without --rounds the same query returns no objections_by_round field
```

- The mint MUST remain best-effort: a per-round write or `readWindowStart` fault for one issue skips or defaults that issue and never fails the run close.
- The accept path, merge, and park MUST gain no dependency on the trail (unchanged invariant).

## 6. DESIGN DECISION RATIONALE

**How should per-round objections be stored on disk?**
- New `objections-by-round.json` member: keeps `objections.json` intact; distinct shape `[{round, window_start, objections}]`. Pro: no breakage, clear separation. Con: one more member.
- Redefine `objections.json`: no new member. Con: breaks every existing reader; the "cross-round union" it would implement was never built.
- **Chosen:** new `objections-by-round.json` member — clean, additive, no reader breakage.

**Should the manifest gain a pointer, and should it be witnessed?**
- **Chosen:** add `objections_by_round` to `manifestCore` (thus inside `witness_sha`), mirroring `objections`/`rulings`. Blob bytes are not hashed, exactly as today's members are not; tamper scope is unchanged.

**Bump `SCHEMA_VERSION`?**
- **Chosen:** 1 → 2. Lets readers distinguish trails with per-round data from those without, and lets `--rounds` degrade cleanly on v1 trails.

**Where does `window_start` come from?**
- CLI argument on `mint`: rejected — forces a beep-boop call-site change this slice forbids.
- **Chosen:** `readWindowStart(specReviewDir)` in-process (factory-to-factory require, same edge class as `roundFilesInDir`). Absent marker → 1.

**How does a caller retrieve per-round objections?**
- Always-fetch: rejected — costly across unfiltered ref enumeration.
- Separate subcommand: rejected — duplicates enumeration/filtering.
- **Chosen:** opt-in `--rounds` flag that enriches records; default path unchanged and cheap.

**Are earlier rounds ledger-enriched?**
- **Chosen:** no. Verbatim round-record objections only; the ledger index-matches the final residue alone, so `contested_source`/ledger `lens`/`severity` stay on the standing-residue `objections.json`.

**FAFF-928 raw response bodies: durable or excluded?**
- Include: inherits the storage-growth concern FAFF-1132 owns; bodies are large and many.
- **Chosen:** out of scope with the reason recorded. Rationale: they are large and per-file byte-capped, their storage bound is FAFF-1132's remit, the trail packer never reads them today, and the structured per-round objections satisfy the core objective. Recorded here so the AC's "durable or explicitly out of scope with the reason recorded" is met by an explicit exclusion.

**Full history or bounded last-N rounds in slice 1?**
- Bounded last-N now: pre-empts FAFF-1132 and risks two competing bound designs.
- **Chosen:** full in-window history in slice 1; FAFF-1132 owns the cap and truncation. Typical convergence is 2–5 rounds, so the immediate corpus is small; the bound is the sibling's job.

At the time of writing, `judge-history` surfaces no objections of any kind through its own CLI (it reads `manifest.json` only), so the `--rounds` surface is genuinely new, not a variation on an existing objection output.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Every decision in scope is closed above.

**Assumptions.**

- **Assumes:** FAFF-1132 will provide the storage bound (hard `OBJECTIONS_BLOB_WRITE_CAP` + two-phase truncation) for the retained per-round corpus. Until it lands, the per-round member grows unbounded by design. Validation: confirm FAFF-1132 exists as the sibling slice and is sequenced to follow FAFF-1131 before relying on any bound; do not add a cap in this slice.
- **Assumes:** `readWindowStart` is exported from `spec-review-window.js` and requiring it from `judge-trail.js` is an allowed factory-to-factory edge. Validation: confirmed against the codebase (`spec-review-window.js` exports it and already requires `roundFilesInDir` from another factory module; `faff regions check` forbids only governance→factory edges, and judge-trail.js is region:factory).

## 8. DONE — Definition of Done

### From WHY
- [ ] For a >1-round review, the minted trail lets a caller reconstruct each round's objections, not only the final residue.
- [ ] The mint remains best-effort: a per-round write fault for one issue skips/defaults it and never fails the run close, merge, or park.
- [ ] No accept-path, merge, park, spec-review-loop, or beep-boop call-site change is made.

### From WHAT (types and interfaces)
- [ ] `objections-by-round.json` is written per issue as `[{ round, window_start, objections }]`, ascending by round, in-window only, `[]` when no in-window rounds.
- [ ] Existing `objections.json` is unchanged (standing residue with ledger enrichment); `manifest.lenses` still means the standing-residue lens set.
- [ ] `manifestCore` gains `objections_by_round: "objections-by-round.json"` and `schema_version` is `2`; `witness_sha` is computed over the updated core.
- [ ] Per-round objections are verbatim from each round record (no `contested_source`, no ledger enrichment).

### From HOW (behaviour)
- [ ] `window_start` is read via `readWindowStart(specReviewDir)` in-process; no new CLI argument on `mint`.
- [ ] Rounds with `n < window_start` are excluded from `objections-by-round.json`.
- [ ] `faff judge-history --rounds` returns `objections_by_round` per record; without `--rounds` records carry no such field and no per-round blob is fetched.
- [ ] `faff judge-history --rounds` against a pre-slice (schema_version 1) trail returns `objections_by_round: null` per record and exits 0.

### From HOW (edge cases)
- [ ] Malformed `window.json` is caught per issue and treated as `window_start = 1` (or the issue is skipped), never aborting the mint.
- [ ] An unparseable single round record is skipped; other in-window rounds are still recorded.
- [ ] An unparseable/absent per-round blob under `--rounds` yields `objections_by_round: null` without throwing and without changing `tamper_suspect`.

### From tests
- [ ] `test/judge-trail.test.mjs` gains a multi-round fixture (>= 3 rounds) proving per-round retention and that `judge-history --rounds` returns each in-window round.
- [ ] A test proves `window_start` exclusion (a pre-window round is absent from `objections-by-round.json`).
- [ ] A test proves `--rounds` against a v1-shaped trail returns `objections_by_round: null` and exit 0.
- [ ] The `judgeTrailSelftest()` table covers `collectObjectionsByRound` (verbatim copy + window filter) as a pure-core check.

**Integration smoke test.**

```
1. Seed <root>/.faff/runs/<run_id>/<issue>/spec-review/{round-1.json,round-2.json,round-3.json}
   with distinct objections arrays; no window.json (window_start -> 1).
2. Run: faff judge-trail mint --run-dir <run_dir>          # local bundle_store
3. Run: faff judge-history --run <run_id> --issue <issue> --rounds --json
4. Assert: the record's objections_by_round has 3 entries (rounds 1,2,3),
   each objections array equal to the seeded round record's objections.
```

confidence: medium
build-tier: complex
