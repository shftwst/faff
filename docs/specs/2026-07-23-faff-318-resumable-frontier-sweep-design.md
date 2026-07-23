# FAFF-318 — Resumable frontier eval sweep via per-kind checkpointing

> Spec: faffter-dark-nlspec · 2026-07-23 · interactive · confidence: high. Full spec on Linear FAFF-318.

_Revised 2026-07-23 — added two DoD items (first-baseline-partial test; atomic temp+rename structural assertion) per the spec-review QA lens._

This spec is the build brief for making a full frontier eval sweep (`node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json`) survive an interruption. It is written for the build agent implementing the change in `eval/run-evals.mjs`, and for the human reviewers who own the frontier baseline. The sweep is a plain-terminal, human-supervised operation (never CI, never nested `claude -p` — ADR-0004), so the resumability here is what lets a multi-hour un-nested run be picked back up after a crash instead of thrown away.

---

## 1. WHY — Problem and Principles

**The load-bearing idea:** a full sweep already computes each kind's aggregate the instant that kind's cases are all done — but it holds every kind in memory and writes the baseline once at the very end. If we persist each kind's aggregate to a small progress file the moment the kind completes, a killed run has already saved everything up to its last completed kind, and a later `--resume` can run only the kinds still missing and fold them into the baseline. The whole feature is: **move the unit of durability from "the whole run" to "one kind."**

**Problem statement.** Today a sweep of ~66+ cases × 20 reps (~1,300+ real `claude -p` calls, multiple hours) accumulates results purely in memory and writes the baseline in a single end-of-run `writeFileSync`; a mid-run kill (session reset, quota exhaustion, rate-limit throw) discards every completed kind, since each rep's isolated temp config dir is also cleaned as the rep finishes. This change persists each kind's aggregate to a resumable progress file as it completes, and adds a `--resume` mode that skips already-recorded kinds and folds the accumulated progress into the final baseline. The observable win: a sweep that dies at hour 2.5 loses at most the in-flight kind, not the whole run.

**Design principles** — constraints that would make an otherwise-valid implementation wrong:

- **The final baseline must never omit a kind.** The `--against` gate treats any baseline kind absent from a run as an unconditional FAIL (`diffAgainstBaseline`, run-evals.mjs:230). A partial or resumed baseline write that dropped a kind would turn every future gate run into a spurious non-regression failure. The fold-in must therefore be merge-aware, never a partial replace.
- **Checkpointing is advisory to the numbers.** The per-kind aggregate written to the checkpoint, the aggregate `summarize` returns, and the number that lands in the baseline must be byte-identical for any kind — they must be computed by one shared aggregation function, never two that can drift. This mirrors the FAFF-320 rule that capture never changes `per_kind`.
- **A fresh re-baseline stays clean and predictable.** A plain `--update-baseline` with no `--resume` is a deliberate clean re-baseline; it must not silently inherit numbers from a stale progress file left by an earlier crashed sweep. Continuing an earlier sweep is opt-in.
- **One model / reps / driver per baseline file.** The baseline's `meta` block is flat (one `captured_at`, one `model`, one `base_reps` for the whole file). A resume must not blend kinds measured under different models or rep counts into one file.
- **Stays out of CI.** The frontier sweep and its gate are human-run; nothing here may be wired into a workflow (guarded by an existing test, eval-baseline-gate.test.mjs:131).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `eval/run-evals.mjs` | Node (builtins only) | The orchestrator this change extends: `runEvals`, `summarize`, `updateBaseline`, `diffAgainstBaseline` |
| `eval/grader.mjs` → `aggregateCase` | Node | Produces the per-case aggregate (accuracy/stability/format_adherence) the checkpoint means over |
| `eval/baselines/frontier.json` | JSON | The committed gate baseline the fold-in writes; 14 kinds, flat `meta` + `per_kind` + `policy` |
| `.faff/eval-runs/<run-id>/judgements.jsonl` | JSONL | FAFF-320 per-rep capture — the deeper salvage material; **not** the resume source (see Out of Scope) |
| `eval/report/` | dir | Where `latest.json` / `compare.json` are written; gitignored; home for the new progress file |

**Scope statement.** This is a robustness change inside the eval harness's `--update-baseline` write path; it touches no grader, no judgement seam, and no gate comparison logic.

---

## 2. OUT OF SCOPE

- **Reconstructing kind aggregates from the FAFF-320 JSONL.** What's excluded: rebuilding `per_kind` by replaying `.faff/eval-runs/<run-id>/judgements.jsonl`. Why excluded: the checkpoint captures the in-process aggregate directly, which is exact and carries no reconstruction caveat (the JSONL lacks `cost_tokens` and requires case-weighted re-grouping to match `summarize`). Extension point: a future `--salvage-from-jsonl <path>` reader in `run-evals.mjs` that produces a progress file from captured reps, feeding the same fold-in.
- **Concurrent or multiple simultaneous sweeps.** What's excluded: coordinating more than one active sweep against the progress file. Why excluded: the sweep is a single human-supervised terminal operation (ADR-0004); there is never a second writer. Extension point: a run-id-scoped progress path plus a lock file, if that ever changes.
- **Auto-pruning old capture/progress files.** What's excluded: cleaning `.faff/eval-runs/` or stale progress files. Why excluded: retention is already manual (eval/README.md). Extension point: a retention sweep keyed on `started_at`.
- **Adopting the FAFF-576 fail-closed argv parser.** What's excluded: replacing this file's local `argFlag`/`argv.includes` parsing. Why excluded: `run-evals.mjs` deliberately does not import the shared parser today; migrating it is a separate concern. Extension point: `plugin/skills/faff/bin/lib/argv.js`.
- **Per-kind provenance inside the committed baseline.** What's excluded: adding `captured_at`/`model`/`reps` to each `per_kind` entry of `frontier.json`. Why excluded: the gate reads only accuracy/stability/format_adherence, tests assert that minimal shape, and per-kind timing lives in the progress file instead. Extension point: extend the baseline `per_kind` record if the gate ever needs per-kind lineage.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Sweep | One `--update-baseline` invocation over the full case set (all kinds). |
| Kind-complete | Every case id for a kind (per `loadCases()`) has been run this sweep. |
| Progress file | The resumable checkpoint at `eval/report/frontier-sweep-progress.json`; accumulates completed kinds across sessions. |
| Fold-in | The end-of-run step that turns the progress file (+ existing baseline) into the written baseline. |
| Complete sweep | The progress file covers every kind in the current expected set. |
| Partial sweep | The progress file covers only some expected kinds (a crash/deadline happened, or `--resume` hasn't drained the remainder yet). |

**Progress file schema** (`eval/report/frontier-sweep-progress.json`):

```
RECORD SweepProgress:
  schema: int                 # 1 — bump on any incompatible shape change
  stamp: RunStamp             # provenance guard; a resume must match it
  kinds: Map<KindName, KindEntry>   # ONE entry per kind, present ONLY when kind-complete

RECORD RunStamp:
  driver: string              # "frontier" (or the driver flag)
  model: string | null        # resolved eval model (frontier) or --model
  base_reps: int              # the sweep's base reps
  started_at: Timestamp       # ISO — when this sweep's stamp was minted

RECORD KindEntry:
  accuracy: float             # identical to summarize's per_kind for this kind
  stability: float
  format_adherence: float | null
  case_ids: List<CaseId>      # the exact case-id set that produced this aggregate
  captured_at: Timestamp      # ISO — when this kind completed (per-kind, operator-visible only)

  CONSTRAINT accuracy/stability/format_adherence == aggregateKind(this kind's CaseResults)
```

**Baseline file — unchanged shape.** The written `frontier.json` keeps its flat `meta` + `per_kind` (three fields per kind) + `policy`. No per-kind field is added — the gate-read shape and its tests stay exactly as they are. `meta` after a fold-in:

```
RECORD BaselineMeta:
  captured_at: Date           # fold-in date (ISO date). Approximation for a resumed multi-day sweep.
  driver: string
  model: string | null
  base_reps: int
  source: string              # notes clean-replace vs partial-overlay + resumed-ness (audit only)
```

**CLI surface:**

- `--update-baseline <path>` — unchanged trigger. Now also writes the progress file incrementally and starts a **fresh** sweep (truncating any existing progress file's stamp + kinds).
- `--resume` — new boolean flag, only meaningful with `--update-baseline`. Reads the existing progress file, validates its stamp against this invocation, skips kinds already recorded (and still valid), runs only the missing kinds, and folds in.
- `--only <id>` — unchanged, but suppresses all checkpoint/resume machinery (see edge cases): a single-case debug run never writes or reads the progress file, and its fold-in is overlay-only.

**Shared aggregation seam.** Factor the per-kind mean currently inlined in `summarize` (run-evals.mjs:164–186) into a pure exported helper, reused by both `summarize` and the checkpoint writer so their numbers cannot diverge:

```
PURE aggregateKind(caseResultsForOneKind) -> { accuracy, stability, format_adherence }:
  accuracy         = mean(cr.accuracy for cr in caseResults)
  stability        = mean(cr.stability for cr in caseResults)
  fa               = [cr.format_adherence for cr in caseResults if cr.format_adherence != null]
  format_adherence = fa.length ? mean(fa) : null
```

**Design decision — checkpoint an aggregate vs reconstruct from JSONL.**
- Checkpoint aggregate directly: exact (same in-process values as `summarize`), carries `cost_tokens`-free but complete accuracy/stability/format, no re-grouping caveat. Con: a second small file to write.
- Reconstruct from FAFF-320 JSONL: no new file. Con: needs case-weighted re-grouping to match `summarize`, cannot recover cost, and couples resume to capture being enabled.

**Chosen:** checkpoint the in-process aggregate directly to a dedicated progress file. Reconstruction from JSONL is a separate salvage path (Out of Scope), not the resume mechanism. Rationale: exactness and independence from the capture opt-in.

**Design decision — is `--resume` a flag or the default?**
- Flag (opt-in): a plain `--update-baseline` always starts clean; continuing an earlier sweep is explicit intent.
- Default (merge-aware writer always resumes): fewer flags, but a fresh re-baseline could silently absorb a stale crashed sweep's numbers.

**Chosen:** `--resume` is an explicit flag over a merge-aware writer. A non-resume `--update-baseline` truncates any prior progress file and runs the full set. Rationale: preserves the "clean, predictable re-baseline" contract; never blends a stale sweep into an intended-fresh one.

**Design decision — meta reconciliation across sessions.**
- Flat meta, single model/reps/driver enforced; `captured_at` = fold-in date (approximation).
- Per-kind provenance in the baseline (each kind carries its own captured_at/model/reps).

**Chosen:** flat meta; `--resume` fail-loud-rejects a stamp whose driver/model/base_reps differ from this invocation, so one file is always one model/reps/driver; `captured_at` becomes the fold-in date, an accepted approximation because `meta` is audit-only and never read by the gate (`diffAgainstBaseline`/`loadBaseline` read only `per_kind` + `policy`). Per-kind `captured_at` lives in the progress file for operator visibility. Rationale: keeps the gate-read baseline minimal and its tests untouched, while keeping the file honest about what it measured.

---

## 4. HOW — Behavior

**Architecture.** Three additions, all inside `run-evals.mjs`, none touching the gate:

1. A `progressPath` parameter threaded through `runEvals` (default `null`, exactly like `judgementsPath`), plus expected-set tracking so `runEvals` can fire a checkpoint write the moment a kind completes.
2. A merge-aware fold-in in `updateBaseline` that reads the progress file (all kinds completed across sessions) and produces the baseline `per_kind`.
3. Resume plumbing in `updateBaseline`: filter cases to the missing kinds, after validating the progress file's stamp.

**Kind-completion detection — the load-bearing mechanic.** Cases are **not** contiguous by kind: `loadCases()` sorts by filename (run-evals.mjs:82–87), so same-kind adjacency is incidental. "Kind K is complete" must be decided by set-membership, not by watching `cr.kind` change between consecutive results.

```
Behaviour summary: maintain, per kind, the set of case-ids still expected; when a case
completes, drop it from its kind's pending set; an emptied set means the kind is done — write it.

PROCEDURE runEvals(cases, driver, ..., progressPath = null):
  1. expected := map from kind -> Set of all case.id in `cases` for that kind
  2. pending  := deep copy of expected            # remaining-per-kind
  3. seenResultsByKind := map kind -> [] (CaseResults accumulated this session)
  4. FOR each case c in cases (in loadCases order):
     a. IF deadline reached (existing deadlineMs seam): mark incomplete; BREAK
     b. cr := runCase(c, driver, ...)              # UNCHANGED, incl. FAFF-320 capture
     c. results.push(cr); seenResultsByKind[c.kind].push(cr)
     d. pending[c.kind].delete(c.id)
     e. IF progressPath != null AND pending[c.kind] is now empty:
          entry := aggregateKind(seenResultsByKind[c.kind])   # shared helper — matches summarize
          writeCheckpointKind(progressPath, c.kind, entry, expected[c.kind])  # atomic
  5. RETURN summarize(results, incomplete)          # summarize UNCHANGED in output
```

`--only` sets `progressPath = null` into `runEvals` (no checkpointing), because a single case can never complete its kind.

**Checkpoint write — atomic, whole-file.** The progress file is small (a dozen kinds). Each kind-completion rewrites the whole object, but via write-temp-then-rename so a crash mid-write never corrupts it.

```
PROCEDURE writeCheckpointKind(path, kind, entry, caseIds):
  1. progress := readProgress(path)   # ALWAYS pre-exists: updateBaseline initialises it
                                        # (fresh: empty kinds + new stamp; resume: prior file)
                                        # so the stamp is never minted here
  2. progress.kinds[kind] := { ...entry, case_ids: sorted(caseIds), captured_at: nowISO() }
  3. write JSON to path + ".tmp"; rename(path+".tmp", path)   # atomic replace
```

**The `--update-baseline` path, with fresh vs resume.**

```
Behaviour summary: fresh runs wipe prior progress and run everything; resume validates the
stamp, runs only missing kinds, then both fold the accumulated progress into the baseline.

PROCEDURE updateBaseline(argv, presets, baselinePath):
  1. cases := loadCases(); only := --only; IF only: cases := cases.filter(id == only)
  2. expectedKinds := set of kinds in cases
  3. stamp := { driver, model (resolveEvalModel/--model), base_reps, started_at: nowISO() }
  4. progressPath := eval/report/frontier-sweep-progress.json
     IF only: progressPath := null                      # --only never checkpoints
  5. IF --resume AND progressPath AND file exists:
        prior := readProgress(progressPath)
        IF prior.stamp.{driver,model,base_reps} != stamp.{driver,model,base_reps}:
           THROW "--resume: progress stamp <prior> does not match this run <stamp>; refusing to blend"
        keep := kinds K in prior.kinds where prior.kinds[K].case_ids == sorted(expected ids for K)
        (a kind whose current case-id set differs is STALE — re-run it, don't keep)
        cases := cases.filter(c => c.kind NOT in keep)   # run only the missing/stale kinds
        # prior progress file is preserved; new completions append into it under the SAME stamp
     ELSE (fresh, or --resume with no file):
        overwrite progressPath with { schema:1, stamp, kinds:{} }   # truncate any stale sweep
  6. judgementsPath := mintCapturePath()                 # FAFF-320 unchanged
  7. summary := runEvals({ cases, driver, baseReps, judgementsPath, progressPath })
  8. foldInAndWriteBaseline(baselinePath, progressPath, expectedKinds, stamp, summary, {only})
  9. RETURN summary.status == "complete" ? 0 : 1
```

**Fold-in — the merge that never drops a kind.**

```
Behaviour summary: a fully-swept run replaces per_kind cleanly (today's semantics, incl. ghost
pruning); a partial run overlays swept kinds onto the existing baseline so no kind is ever dropped.

PROCEDURE foldInAndWriteBaseline(baselinePath, progressPath, expectedKinds, stamp, summary, {only}):
  1. progress := (progressPath ? readProgress(progressPath) : null)
  2. sweptKinds := progress ? keys(progress.kinds) : keys(summary.per_kind)   # --only path uses summary
  3. sweptPerKind := for each K in sweptKinds -> 3-field {accuracy,stability,format_adherence}
        from progress.kinds[K] (or summary.per_kind[K] on the --only path)
  4. prevBaseline := readBaseline(baselinePath) OR null; prevPolicy := prevBaseline?.policy ?? DEFAULT_POLICY
  5. complete := NOT only AND sweptKinds ⊇ expectedKinds
  6. IF complete:
        per_kind := sweptPerKind                        # clean replace — prunes deleted kinds
        source := "real run via --update-baseline"
     ELSE:                                               # partial OR --only
        base := prevBaseline?.per_kind ?? {}
        per_kind := { ...base, ...sweptPerKind }          # overlay: retains un-swept kinds
        source := "partial/resumed --update-baseline — N/M kinds swept this cycle; rest retained"
  7. out := { meta:{ captured_at: todayISODate, driver, model, base_reps, source }, per_kind, policy: prevPolicy }
  8. mkdir; writeFileSync(baselinePath, JSON.stringify(out,null,2)+"\n")
  9. IF NOT complete AND NOT only: WARN loudly which kinds remain + "re-run with --resume to complete"
```

For a full, uninterrupted, non-resumed sweep, `complete` is true and step 6 replaces `per_kind` with the freshly-swept aggregates — **byte-identical to today's behaviour** (a clean re-baseline that prunes any deleted kind). The partial branch is the new salvage path.

**Edge cases and error handling:**

- **`--resume` with no progress file** — non-fatal: warn "no progress file found; running the full sweep", proceed as fresh (nothing to skip).
- **`--resume` stamp mismatch** (different driver/model/base_reps) — terminal: throw before any rep runs; do not blend incompatible numbers.
- **`--resume`, a completed kind's case-id set changed** (cases added/removed since) — that kind is stale: re-run it (don't `keep` it), and its new completion overwrites the stale entry under the same stamp.
- **`--resume` with all kinds already complete** — run zero reps; go straight to a complete fold-in (clean baseline write). Exit 0.
- **First-ever baseline built by a partial sweep** (no existing `frontier.json`) — the overlay has nothing to overlay onto, so only swept kinds are written; warn hard that a first baseline should be a complete sweep. This is the one case where a partial write can still omit kinds — by construction there is no prior value to preserve.
- **Deadline/`incomplete` run** (existing `deadlineMs` seam trips) — completed kinds are already checkpointed; the fold-in takes the partial branch, writes a merged baseline, warns, and `updateBaseline` returns non-zero (preserving today's incomplete → exit 1).
- **`--only <id>`** — no checkpoint read/write; fold-in forced to the overlay branch, so an `--only` run updates exactly that kind and never drops the others (also fixes the latent footgun where today's `--only --update-baseline` replaces `per_kind` with a single kind).
- **Corrupt/unparseable progress file on `--resume`** — terminal: throw with the path; the operator deletes it and starts fresh (a silent fresh-start would discard their intended continuation).

**Failure modes — how this approach could be wrong, and how you'd notice:**

- **The checkpoint aggregate silently diverges from `summarize`.** How you'd know: a test that runs a full sweep with a mock driver, then compares each `progress.kinds[K]` against `summarize(...).per_kind[K]` — any mismatch fails. What it means: the shared `aggregateKind` helper was not actually shared (one path re-inlined the mean) — abandon the divergent path, both must call the one helper.
- **Kind-completion misfires because cases are non-contiguous.** How you'd know: a test with two kinds interleaved by filename order asserts the checkpoint for a kind is written only after its *last* case (not when `cr.kind` first changes). What it means: completion was coded as an adjacency check — narrow to the set-membership rule.
- **A partial write drops a kind and poisons the gate.** How you'd know: a test folds a 1-kind progress file over a 3-kind existing baseline and asserts the written baseline still has all 3 kinds and gates clean against itself. What it means: the fold-in took the replace branch when it should have overlaid — fix the `complete` predicate.

**Anti-pattern:** deciding kind-completion by watching `cr.kind` change between consecutive results. Why: `loadCases()` sorts by filename, so same-kind cases are only incidentally adjacent; the change-watch would checkpoint a kind early and miss its later cases.

**Anti-pattern:** having the checkpoint writer or the fold-in recompute per-kind means with its own inline loop. Why: it can drift from `summarize`; both must call the single `aggregateKind` helper.

**Anti-pattern:** writing the progress file with a plain in-place `writeFileSync`. Why: a crash mid-write (the exact scenario this feature exists for) would corrupt the resume anchor; use temp-write + atomic rename.

---

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

**Kind-completion fires on the last case of a kind, not on adjacency.**
```
Given a case set where kind A and kind B are interleaved by filename order (A1, B1, A2, B2)
When runEvals runs with a mock driver and a progressPath set
Then the progress file gains kind A only after A2 completes (not after B1 changes the kind)
And gains kind B only after B2 completes
```

**Resume runs only the missing kinds and produces a complete baseline.**
```
Given a progress file recording kinds {dupe, vague} complete under a matching stamp
And a case set whose kinds are {dupe, vague, stale}
When --update-baseline --resume runs with a mock driver
Then only the `stale` cases are dispatched to the driver
And the written baseline per_kind contains dupe, vague, and stale
```

**Fold-in never drops a kind (gate safety).**
```
Given an existing frontier.json with per_kind {dupe, vague, stale}
And a progress file (partial) recording only {dupe} freshly swept
When the partial fold-in writes the baseline
Then the written per_kind still contains dupe, vague, and stale
And diffAgainstBaseline(the written baseline, the written baseline) reports failed == false
```

- The written per-kind aggregate MUST equal `summarize(...).per_kind` for the same kind (checkpoint is advisory to the numbers).
- The progress file write MUST be atomic (temp file + rename), leaving no partial JSON on a mid-write crash.
- Nothing in this change MUST reference `run-evals.mjs` or `baselines/frontier` from a CI workflow.

---

## 6. Design Decision Rationale

**Checkpoint the aggregate directly, or reconstruct from the FAFF-320 JSONL?**
- Direct aggregate: exact match to `summarize`, no re-grouping caveat, independent of the capture opt-in. Con: one small extra file.
- JSONL reconstruction: reuses existing capture. Con: needs case-weighted re-grouping to match `summarize`, loses `cost_tokens`, couples resume to capture being on.
- **Chosen:** direct aggregate to `eval/report/frontier-sweep-progress.json`. Reconstruction is a future salvage path, not the resume mechanism.

**`--resume`: explicit flag or default merge-on-resume?**
- Flag: fresh re-baseline stays clean; continuation is intentional.
- Default: fewer flags but risks a fresh run absorbing a stale crashed sweep.
- **Chosen:** explicit `--resume` over a merge-aware writer; non-resume truncates any prior progress file.

**Meta reconciliation across sessions.**
- Flat meta + enforced single model/reps/driver; `captured_at` = fold-in date.
- Per-kind provenance embedded in the baseline.
- **Chosen:** flat meta; `--resume` rejects a mismatched stamp; `captured_at` = fold-in date (approximation, acceptable because the gate never reads `meta`). Per-kind timing lives in the progress file. At the time of writing, `diffAgainstBaseline` and `loadBaseline` read only `per_kind` and `policy`, so extending `meta` buys the gate nothing.

**Complete vs partial fold-in semantics.**
- Always overlay (never drop, but never prunes deleted kinds).
- Always replace (clean, but a partial replace would drop un-swept kinds → gate FAIL).
- **Chosen:** branch on completeness — a complete sweep replaces (today's clean semantics, prunes ghosts); a partial sweep overlays onto the existing baseline (retains un-swept kinds so `--against` stays safe). This also repairs the latent `--only --update-baseline` footgun by routing `--only` through overlay.

**Progress file location.** `eval/report/frontier-sweep-progress.json` — a fixed, deterministic path next to `latest.json`, already gitignored via `eval/report/` (.gitignore:16). A fixed path makes "just re-run with `--resume`" work without the operator tracking a run-id; the in-file stamp guards staleness.

---

## 7. Open Questions and Assumptions

**Open Questions:** none — the design tension is settled above.

**Assumptions:**

- **Assumes:** `run-evals.mjs` remains node-builtins-only (no new dependency) and continues to be excluded from `node --test` CI globs — validate by confirming the new tests live in `test/eval-*.test.mjs` and import `run-evals.mjs`, and that no workflow references it (existing guard at eval-baseline-gate.test.mjs:131 stays green).
- **Assumes:** `eval/report/` stays gitignored so the progress file is never committed — validate with `git check-ignore eval/report/frontier-sweep-progress.json` (confirmed at spec time).
- **Assumes:** every case's `kind` is stable across sessions for a given case id — validate by keying the stale-kind check on `case_ids` per kind; a changed set re-runs the kind.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A sweep killed after some kinds complete leaves those kinds' aggregates in `eval/report/frontier-sweep-progress.json` on disk (mock-driver test simulates a mid-run stop and inspects the file).
- [ ] The frontier gate/sweep is still referenced by no CI workflow (existing guard test stays green).

### From WHAT (types and interfaces)
- [ ] The progress file matches the `SweepProgress` schema: `schema`, `stamp{driver,model,base_reps,started_at}`, and `kinds{<kind>:{accuracy,stability,format_adherence,case_ids,captured_at}}`.
- [ ] The written `frontier.json` keeps its exact prior shape: flat `meta` + three-field `per_kind` + `policy` (eval-baseline-gate.test.mjs assertions unchanged and passing).
- [ ] `aggregateKind` is a single shared pure helper called by both `summarize` and the checkpoint writer.
- [ ] `--resume` is a boolean flag; `--update-baseline` without it starts fresh (truncates prior progress).

### From HOW (behaviour)
- [ ] Kind-completion is decided by case-id set membership over `loadCases()`, not by consecutive-`kind` adjacency.
- [ ] The checkpoint for a kind is written exactly once, after its last case, with numbers equal to `summarize`'s `per_kind` for that kind.
- [ ] `--resume` dispatches driver calls only for kinds missing (or stale) from the progress file.
- [ ] `--resume` throws before any rep when the progress `stamp` (driver/model/base_reps) differs from the current invocation.
- [ ] A complete sweep writes `per_kind` = swept aggregates (clean replace, prunes kinds absent from the current case set) — byte-identical to the pre-change full-run write.
- [ ] A partial sweep writes `per_kind` = existing baseline overlaid with swept kinds; no kind from the prior baseline is dropped.
- [ ] The written baseline (after any partial fold-in over a non-empty prior) gates clean against itself: `diffAgainstBaseline(written, written).failed === false`.

### From HOW (edge cases)
- [ ] `--resume` with no progress file warns and runs the full sweep (non-fatal).
- [ ] `--resume` with all kinds already complete runs zero reps and writes a complete baseline (exit 0).
- [ ] A completed kind whose current case-id set differs from the stored set is re-run, not kept.
- [ ] An `incomplete` (deadline) run writes a merged (overlay) baseline, warns which kinds remain, and returns non-zero.
- [ ] `--only <id>` writes/reads no progress file and its fold-in overlays (never drops other kinds).
- [ ] A corrupt/unparseable progress file on `--resume` throws with the path.
- [ ] **First-ever baseline built by a partial sweep** (no existing `frontier.json` to overlay onto): a partial/incomplete run warns hard ("first baseline should be a complete sweep") and writes only the swept kinds — verified by a mock-driver test that runs a deadline-truncated `--update-baseline` against a temp path with no prior baseline and asserts (a) the warn fired and (b) `per_kind` holds exactly the completed kinds.
- [ ] **The progress file is written via temp-file + atomic rename, never in-place** — a structural assertion that `writeCheckpointKind` writes `<path>.tmp` then renames onto `<path>` (never a direct `writeFileSync` to the live progress path), so a mid-write crash can leave no partial JSON at the resume anchor.

### Advisory-only invariant
- [ ] `JSON.stringify(summarize(results))` is identical whether or not `progressPath` is set (mirrors the FAFF-320 capture invariant).

### Not required (noted)
- No eval-coverage / seam-registry item: this change adds no LLM-judgement seam or grader `KIND` — it is harness I/O and merge logic only.

**Integration smoke test:**
```
PROCEDURE smoke():
  1. cases := two kinds (A: A1,A2 ; B: B1,B2), interleaved by filename, mock driver (deterministic)
  2. run updateBaseline over a temp baseline path + temp progress path, no --resume
  3. ASSERT progress file has kinds A and B, each aggregate == summarize's per_kind
  4. delete kind B from progress file (simulate a crash after A completed)
  5. run updateBaseline --resume over the same paths
  6. ASSERT only B's cases were dispatched, and the final baseline per_kind has BOTH A and B
```

---

confidence: high
spec-review: approve

---

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Right-sized? (principle 4)** — Mostly fine, one rider to name. The spec bundles four things: the shared `aggregateKind` helper, the per-kind checkpoint writer, the `--resume` fold-in, and a latent `--only --update-baseline` fix. The first three are correctly *not* splittable — a checkpoint with no `--resume` to consume it ships no value, and `--resume` with nothing to read ships none either, so they are an always-ship-together unit and belong in one ticket. The `--only` footgun fix is the exception: it's a pre-existing bug, structurally independent of resumability, riding in because it happens to reuse the new overlay path. That reuse makes bundling defensible rather than wrong, but it means the ticket's "done" now covers two outcomes (resumable sweeps *and* a correctness fix). If the `--only` fix turns out to need its own regression coverage or slips, it shouldn't hold resumability hostage — worth a one-line call on whether it stays bundled or splits to a sibling. Left as-is is acceptable; just make the decision consciously rather than by accretion.

**Workstream fit? (principle 1 + 5)** — The ticket sits cleanly; the container name is a mild smell, not an action. "Skill-behaviour harness" is named for the tooling component, not the outcome it delivers. Under the lens that makes sequencing inside the project less meaningful. But this is internal dev-tooling with a small, coherent membership, and FAFF-318 unambiguously belongs wherever the eval-harness work lives, so there's no misfit to fix here. No change needed for this ticket.

**Deps surfaced? (principle 6)** — One edge to encode. FAFF-320 (per-rep capture) is listed as related and is shipped — this work reuses that machinery, so the dependency is real but already satisfied; no blocker link needed. The one to make honest is FAFF-614 (operator runbook): a runbook documenting the `--resume` flow can't be written until that flow exists — that's a downstream dependency. Encode **FAFF-318 blocks FAFF-614** so the runbook isn't pulled ready before the feature lands. FAFF-131/319 (baseline runs) are named without a stated relationship — prior art, not blockers, unless those runs are meant to use `--resume`.

**Risk profile? (principle 7)** — Well de-risked; no action. The one genuinely risky surface is the merge-aware fold-in — it overlays partial results onto the live baseline, and a bug there could silently corrupt the load-bearing `--against` artifact rather than fail visibly. The spec sequences the de-risking correctly: fail-loud run-stamp validation before any overlay, atomic checkpoint writes, "no kind ever dropped" as an explicit invariant, and all ACs exercised via `node --test` with mock drivers. Keep the baseline-corruption cases (stale/mismatched stamp, partial overlay, interrupted write) as the tightest-covered ACs, since that's where the blast radius is. No issues.