# Spec — FAFF-714: let a scoped `--kind` re-baseline checkpoint and resume

> Spec: faffter-dark-nlspec · 2026-08-03 · interactive · confidence: high. Full spec on Linear FAFF-714.

This spec is for the build agent (and human reviewers) implementing FAFF-714 in `/Users/shftwst/workspace/shftwst/faff`. It changes `updateBaseline` in `eval/run-evals.mjs` so a `--kind` scoped re-baseline checkpoints per-kind and can be resumed, exactly the way the full sweep already does — reusing the existing checkpoint machinery, just pointed at a separate progress file. It is buildable from this document plus the named file.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the resume machinery is already generic. `runEvals` writes a per-kind checkpoint to whatever `progressPath` it's handed, and `updateBaseline`'s `--resume` block reads that file, keeps the kinds whose stored case-id set still matches, and re-runs the rest. FAFF-712 deliberately handed the scoped `--kind` path a `null` progressPath, so a scoped run skipped all of that. FAFF-714 is almost entirely about handing it a *real, distinct* path instead of `null` — the checkpoint/resume/fold code underneath needs only one small guard added so it never blends a different scoped set's leftovers.

**Problem statement.** A `--kind` scoped re-baseline never checkpoints, so when the FAFF-711 run (`--kind refutation-spec,grouping`) died two-thirds through — interrupted at `refutation-spec-006` after `grouping` had finished all its reps — it wrote no baseline and had to restart the whole scoped set, re-paying for the reps that had already completed. This change lets a `--kind` run checkpoint each kind as it finishes and lets `--kind … --resume` skip the finished kinds, at the same per-kind granularity the full sweep has.

**Design principles.**

**A scoped checkpoint must never touch the full-sweep checkpoint, in either direction.** The two are different scopes of run; if they shared `frontier-sweep-progress.json`, a scoped run's fresh-file truncation would wipe a paused full sweep's progress, and a scoped checkpoint would read as full-sweep state on a later `--resume`. They get separate files.

**`expectedKinds` stays the full corpus.** The overlay-vs-replace decision in `foldInAndWriteBaseline` turns on `expected.every(k in swept)`. A scoped run sweeps a subset, so as long as `expectedKinds` is the full corpus the `complete` branch never fires and every un-named kind is retained. This is the same load-bearing ordering FAFF-712 relied on (`expectedKinds` computed at line 389, before the `--kind` narrowing) — do not change it.

**The fold folds only the named kinds.** A resumed scoped run must overlay exactly the kinds the operator named, never whatever else happens to be sitting in the shared scoped file from an earlier, different `--kind` set. Today FAFF-712 gets this for free because it folds from `summary.per_kind` (the cases were narrowed to the named kinds). Once a real progress file is in play, the fold reads from the file, which can hold leftover kinds — so the fold gains an explicit filter to the named set.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/run-evals.mjs` `updateBaseline` | JS | The function changed; parses `--kind`/`--resume`, resolves `progressPath`, runs the resume keep-set logic |
| `eval/run-evals.mjs` `foldInAndWriteBaseline` | JS | Reads swept kinds from the progress file (or summary) and overlays them onto the prior baseline; gains the named-kind filter |
| `eval/run-evals.mjs` `writeCheckpointKind` / `readProgress` | JS | The per-kind checkpoint read/write, reused unchanged |
| `test/eval-resume.test.mjs` | JS | Mock-driver resume tests; the FAFF-712 mutual-exclusion assertion lives here and must change |
| `eval/README.md` (points 3, 5) | Markdown | The re-baseline runbook; documents `--kind` as non-resumable — must be corrected |

**Scope statement.** This sits in the human-run frontier re-baseline path (`--update-baseline`), never in CI or the plain sweep.

## 2. OUT OF SCOPE

- **Per-case resume** — resuming mid-kind (e.g. re-running only `refutation-spec-007` through `010` rather than all of `refutation-spec`). Why excluded: it's a much larger change to the harness's whole checkpoint model, which is per-kind by design. Extension point: `runCase`/`runEvals` in `eval/run-evals.mjs` and the progress-file schema would need a per-case completion record.
- **Changing the full-sweep progress file or its behaviour** — `frontier-sweep-progress.json` and the full `--resume` path are untouched. Why excluded: not this ticket, and the separation is the whole point. Extension point: none needed.
- **`--only` checkpointing** — `--only` stays non-checkpointing (`progressPath` stays `null` for it). Why excluded: a single case can never complete its kind, so a checkpoint would never fire; FAFF-712 already settled this. Extension point: n/a.
- **Auto-cleaning the scoped progress file between different kind-sets** — the file is left on disk after a run (like the full-sweep one). Why excluded: a subsequent non-resume `--kind` run truncates it fresh anyway, and the fold filter defends against stale entries. Extension point: none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Full-sweep progress file | `eval/report/frontier-sweep-progress.json` — the existing checkpoint for a whole-corpus `--update-baseline` run |
| Scoped progress file | `eval/report/frontier-scoped-progress.json` — new; the checkpoint for a `--kind` run |
| Named kinds | The kinds passed to `--kind` (the `scopedKinds` array) |
| Keep-set | The kinds a `--resume` run skips because their stored case-id set matches the current expected set |

**No schema change.** The scoped progress file uses the identical shape the full-sweep file already uses — `{ schema: 1, stamp: { driver, model, base_reps, started_at }, kinds: { <kind>: { accuracy, stability, format_adherence, case_ids, captured_at } } }`. `writeCheckpointKind`/`readProgress` write and read it with no modification.

**Changed function signatures:** none. `foldInAndWriteBaseline` already takes `{ only, scopedKinds }`; the only surface change is the value of `progressPath` for a scoped run (now a path, not `null`) and one added filter line inside the fold.

**Design decision — the scoped progress path.**

- Options: (a) one fixed scoped file `frontier-scoped-progress.json`; (b) a file keyed by the kind-set (e.g. hash of the sorted kinds).
- (a) is simplest and mirrors the full-sweep file's fixed-path convention — the operator just re-runs with `--resume`, no run-id or key to track. Its one wrinkle: two *different* `--kind` sets share the file. That's handled below (the keep-set already ignores non-matching kinds for execution; the fold gains a named-kind filter so it never overlays a leftover set's rows).
- (b) avoids sharing but orphans one file per distinct kind-set on disk and forces the operator (or the code) to reconstruct the key to resume — more moving parts for no real gain, since (a)'s sharing is fully contained.
- **Chosen:** one fixed scoped file `eval/report/frontier-scoped-progress.json`, distinct from the full-sweep file. (decides: architecture)

## 4. HOW — Behavior

**Architecture.** Four edits to `updateBaseline`/`foldInAndWriteBaseline`, plus the test and the runbook.

**1. Drop the mutual-exclusion guard.** Remove the line (currently line 373):

```
if (kindArg && resume) throw new Error("--kind is a self-contained scoped sweep and does not checkpoint; drop --resume");
```

The `if (only && kindArg) throw …` guard on the line above stays — `--only` and `--kind` remain mutually exclusive.

**2. Point a scoped run at the scoped progress file.** Where `progressPath` is resolved (currently lines 408–410), replace the `scopedKinds → null` line so a scoped run gets the distinct path:

```
PROCEDURE resolve progressPath:
  progressPath := reportDir / "frontier-sweep-progress.json"
  IF scopedKinds:  progressPath := reportDir / "frontier-scoped-progress.json"   # FAFF-714 — distinct file
  IF only:         progressPath := null                                          # unchanged — --only never checkpoints
```

`only` and `scopedKinds` are mutually exclusive (guard above), so their relative order here is immaterial; keep the `only → null` assignment last for legibility. Everything downstream — the `if (progressPath != null)` resume/truncate block (lines 412–436), the `runEvals({ …, progressPath })` call, and `writeCheckpointKind` firing per kind — now runs for a scoped sweep unchanged.

**3. Filter the fold to the named kinds.** In `foldInAndWriteBaseline`, the swept-kinds line (currently line 452) reads all kinds present in the progress file. For a scoped run the file can hold leftover kinds from an earlier, different `--kind` set, so restrict to the named set:

```
PROCEDURE compute sweptKinds:
  1. sweptKinds := progress ? keys(progress.kinds) : keys(summary.per_kind)   # existing
  2. IF scopedKinds:  sweptKinds := sweptKinds filtered to those in scopedKinds  # FAFF-714
```

Behaviour this preserves and why it's safe:
- Clean single-set lifecycle (the common case): the file holds exactly the named kinds, so the filter is a no-op — identical to FAFF-712.
- `complete` is `!only && expected.every(k in sweptKinds)`; `expected` is the full corpus and `sweptKinds` is a subset, so `complete` stays `false` → overlay branch → un-named kinds retained. Unchanged from FAFF-712.
- A named kind that didn't finish (never checkpointed) is simply absent from `progress.kinds`, so the fold skips it — the same partial-fold behaviour the full sweep has.

**4. Resume narrowing works as-is.** The `--resume` block builds `expectedIds` from the already-narrowed `cases` (the named kinds only), so its keep-set can only ever contain named kinds. A stored kind from a different scoped set has no entry in `expectedIds`, so `want.length` is `0` and the `if (want.length && …)` keep condition is false — it is neither kept nor (since it's not in `cases`) run. No change needed here.

**Behaviour summary — the resume path end to end.** `--kind A,B --resume`: resolve `progressPath` to the scoped file; if it exists, read it, refuse on a stamp mismatch, keep the named kinds whose stored case-id set matches, narrow `cases` to the rest, run them (checkpointing each as it finishes), then fold the named kinds from the progress file into the baseline, retaining every un-named kind.

**Edge cases.**
- **No scoped progress file on `--resume`.** Existing `else` branch warns ("no progress file … running the full sweep") and writes a fresh `{ schema: 1, stamp, kinds: {} }`. For a scoped run "full sweep" reads slightly oddly — `cases` is already narrowed to the named kinds, so it runs the full *scoped set*. Functionally correct; the wording is cosmetic (noted as a nicety, not required).
- **Non-resume `--kind`.** The `else` branch truncates the scoped file to `{ kinds: {} }` before running — a clean slate each time, so cross-set cruft can't accumulate across non-resume runs.
- **`--kind C,D --resume` when the scoped file holds a completed `A,B`.** If stamps match: keep-set is empty (A,B aren't in this run's expected kinds), so all of C,D run; the fold filter restricts the overlay to C,D even though the file now also contains A,B. If stamps differ: the existing stamp guard throws "refusing to blend" — the operator deletes the file and re-runs, same as the full sweep.

**Anti-pattern:** deriving `expectedKinds` from the narrowed scoped `cases`. Why: it would make `complete` fire and wipe every un-named kind from the baseline — the exact failure FAFF-712's line-389 ordering exists to prevent.

## 5. Failure modes

**Fold overlays a stale kind-set's rows.** If the fold read all of the scoped file's kinds (without the named-kind filter), a `--kind C,D --resume` against a file still holding a prior `A,B` would silently re-write A,B's baseline rows from stale numbers. How you'd know: the test in DONE that folds C,D over a file seeded with a leftover A,B asserts A,B's baseline rows are byte-identical to the prior baseline; it fails if the filter is missing. What it means: the filter (edit 3) is load-bearing, not decorative — do not drop it.

**Scoped and full files collide.** If a scoped run wrote to `frontier-sweep-progress.json`, a paused full sweep's checkpoint would be truncated or misread. How you'd know: the DONE test asserts a scoped run leaves `frontier-sweep-progress.json` untouched (absent or byte-identical). What it means: the distinct path (edit 2) is the guard; a regression here is a silent data-loss bug, so the test is not optional.

## 6. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a scoped progress file recording kind `grouping` complete (its stored case-ids match the corpus)
When updateBaseline runs with `--kind refutation-spec,grouping --resume` and a matching stamp
Then only `refutation-spec`'s cases are dispatched, `grouping` is skipped, and the baseline folds in both
```

```
Given a `--kind` run in progress
When it checkpoints and later completes
Then it writes only to `eval/report/frontier-scoped-progress.json` and leaves `frontier-sweep-progress.json` untouched
```

```
Given a prior baseline with un-named kinds present
When a resumed `--kind` run folds its named kinds in
Then every un-named kind's row is byte-identical to the prior baseline and the run exits 0
```

```
Given a scoped progress file whose stamp's driver/model/base_reps differ from the current run
When `--kind … --resume` runs
Then it throws "refusing to blend" before any rep is dispatched
```

## 7. DESIGN DECISION RATIONALE

**Which progress file does a scoped run use?** Options: a single fixed `frontier-scoped-progress.json`, or a per-kind-set keyed file. Keyed avoids cross-set sharing but orphans files and forces key reconstruction to resume. **Chosen:** single fixed `eval/report/frontier-scoped-progress.json` — mirrors the full-sweep file's fixed-path convention (an operator just adds `--resume`), and the one downside (two kind-sets share it) is fully contained by the keep-set (ignores non-matching kinds for execution) plus the fold's named-kind filter.

**Fold from the progress file or from the summary?** FAFF-712 folded scoped runs from `summary.per_kind` because `progressPath` was `null`. On a resumed run, `summary` holds only the kinds run *this* session, not the ones restored from the checkpoint — so folding from summary would drop the already-complete named kinds. **Chosen:** fold from the progress file (the `progress ? … : summary` branch already does this whenever a progress file exists), filtered to the named kinds. The existing summary path stays as the `--only` fallback.

**Keep the named-kind filter, or trust the file to hold only named kinds?** **Chosen:** add the filter. It's a no-op in the clean single-set lifecycle but is the only thing preventing a leftover kind-set from bleeding into the fold on a shared file — cheap insurance for a real cross-set case.

## 8. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision is closed.

**Assumptions.**

- **Assumes:** `eval/report/` is gitignored, so the new scoped progress file is durable-local and never committed, exactly like the full-sweep file. Validate: `git check-ignore eval/report/frontier-scoped-progress.json` (the sibling file is confirmed gitignored per the FAFF-318 spec; the directory rule covers the new filename too).

## 9. DONE — Definition of Done

### From WHY / principles
- [ ] `expectedKinds` is still computed from the full corpus before the `--kind` narrowing (line-389 ordering unchanged); a scoped run's `complete` flag is `false` and un-named baseline kinds are retained.

### From HOW (edit 1)
- [ ] The `if (kindArg && resume) throw …` guard is removed; `--kind … --resume` is accepted.
- [ ] The `if (only && kindArg) throw …` guard remains; `--only --kind` still throws.

### From HOW (edit 2)
- [ ] A `--kind` run resolves `progressPath` to `eval/report/frontier-scoped-progress.json` (not `null`, not the full-sweep file).
- [ ] `--only` still resolves `progressPath` to `null`.
- [ ] A `--kind` run writes a per-kind checkpoint to the scoped file as each named kind completes.

### From HOW (edit 3)
- [ ] `foldInAndWriteBaseline` restricts `sweptKinds` to the named set when `scopedKinds` is set; a resumed scoped run folds in all named kinds (including ones restored from the checkpoint) and no others.

### From HOW (edit 4 / resume)
- [ ] `--kind A,B --resume` skips a named kind whose stored case-id set matches and runs only the missing named kinds.
- [ ] A stamp mismatch (driver/model/base_reps) throws "refusing to blend" before any rep runs.

### From failure modes
- [ ] A scoped run leaves `eval/report/frontier-sweep-progress.json` untouched (the two files never clobber each other).
- [ ] A `--kind C,D --resume` against a scoped file still holding a leftover completed `A,B` folds in only C,D and leaves A,B's baseline rows byte-identical.

### From tests
- [ ] `test/eval-resume.test.mjs`: the assertion that `--kind … --resume` throws `/--kind is a self-contained scoped sweep/` (lines 238–241) is removed, and the test title/body no longer claims `--resume` is rejected alongside `--kind` (the `--only`+`--kind` rejection assertion stays).
- [ ] A new mock-driver test (no paid reps) seeds the scoped progress file with one named kind complete, runs `--kind <A>,<B> --resume`, and asserts: only the missing named kind's cases dispatched; the scoped file is used and the full-sweep file untouched; un-named baseline kinds byte-identical; exit 0.
- [ ] A mock-driver test asserts a scoped `--resume` stamp mismatch throws before any rep.

### From docs
- [ ] `eval/README.md` points 3 and 5 no longer say `--kind` is rejected with `--resume` / never checkpoints; they describe scoped checkpoint + resume against `frontier-scoped-progress.json`.

**Integration smoke test (pseudocode):**

```
seed frontier-scoped-progress.json with { stamp: matching, kinds: { grouping: {…, case_ids: all of grouping} } }
run updateBaseline(["--driver","frontier","--model","M","--reps","1","--update-baseline",baseline,"--kind","refutation-spec,grouping","--resume"], mockPresets, baseline)
assert: dispatched case-ids ⊆ refutation-spec's cases (grouping skipped)
assert: existsSync(frontier-sweep-progress.json) == false   # full-sweep file never created
assert: written baseline has every prior un-named kind byte-identical, both named kinds refreshed, exit 0
```

confidence: high
