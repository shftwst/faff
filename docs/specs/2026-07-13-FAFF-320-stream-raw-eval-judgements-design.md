# Stream raw eval judgements to `.faff` as each rep completes

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-320.

This spec defines a durable, append-only per-rep capture layer for the black-box judgement-eval sweep (`eval/run-evals.mjs`). Its audience is the build agent implementing it and the human reviewers who run and calibrate frontier sweeps. It turns the raw model judgement — currently held only transiently and thrown away — into an on-disk artifact that survives a mid-sweep kill and lets calibration read predicted-vs-oracle without re-running.

## 1. WHY — Problem and Principles

**The load-bearing model.** A frontier sweep is ~1,300 sequential `claude -p` reps over minutes-to-hours. Each rep's raw judgement text (`out.rawText`) exists in memory for exactly one loop iteration — long enough to parse an envelope and grade it — then is overwritten when the next rep runs. The aggregate (`per_kind`) is the only thing persisted, and only once, atomically, at the very end. So the single most valuable calibration artifact ("model predicted X, oracle wanted Y") is the exact thing discarded. The fix is to **append each rep's raw judgement to a durable append-only JSONL the instant the rep completes, before the next rep starts** — so the disk always holds every finished rep.

**Problem statement.** Today a killed or crashed sweep loses everything (no partial on disk; the per-rep temp `CLAUDE_CONFIG_DIR` is cleaned as each rep finishes), and even a *completed* sweep leaves no raw outputs to inspect, forcing calibration (FAFF-319) to re-run cases just to see what the model said. This change streams each rep's raw judgement to `.faff/eval-runs/<run-id>/judgements.jsonl` as it completes, so a `SIGKILL` loses at most the in-flight rep and calibration reads the captured data instead of regenerating it.

**Design principles.**

- **Capture is advisory, never a grading input.** Per ADR-0004 the LLM judge stays strictly advisory; this log is for human inspection and calibration only. It must not feed any gate, oracle, or `per_kind` computation. Writing it must not change any pass/fail outcome.
- **Durability ordering is the whole point.** The append for rep *i* must be flushed to disk *before* rep *i+1*'s driver call begins. A synchronous append satisfies this by construction; an async/buffered write would defeat the crash-salvage guarantee.
- **Zero new dependencies.** The eval harness is deliberately node-builtins-only. The writer uses `node:fs` (`appendFileSync`/`mkdirSync`) inline — it must not import the `faff` CLI (a separate binary) even though that binary has the analogous `events.jsonl` pattern.
- **Never perturb the I/O-free test path.** The pure `runCase`/`runEvals` functions are unit-tested with mock drivers and zero spawn/zero I/O. Capture must be opt-in (a path threaded from the CLI entry point, defaulting to absent) so those tests stay file-free — the same escape hatch the existing `deadlineMs = null` default uses.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/run-evals.mjs` (`runCase` ~L46–77) | JS (ESM, builtins-only) | The rep loop where `rawText`/`env`/`rr`/`c.oracle` are all in hand — the insertion point. |
| `eval/cli-driver.mjs` (`makeCliDriver` ~L640–665) | JS | Returns `{ rawText, tokens }`; captures stdout *before* the `finally` `rmSync` of the cfgDir — capture must read `out.rawText`, never the cfgDir. |
| `plugin/skills/faff/bin/faff` (`events append` ~L10087) | JS | Precedent append-only-JSONL pattern (`appendFileSync(path, JSON.stringify(rec)+"\n")` with a run-dir guard) — mirrored inline, not imported. |
| `.faff/calibration/README.md` | Markdown | Documents the exact pain (regenerate per-case detail because raw was dropped) and is where the inspection recipe should be recorded. |
| `.gitignore` (`.faff/`) | — | Whole `.faff/` tree already gitignored — no new ignore rule needed. |

**Scope statement.** A robustness/observability addition to the black-box judgement-eval lane; it sits beside the existing aggregate write, not on the gate path.

## 2. OUT OF SCOPE

- **Resumable sweep / `--resume` / aggregate checkpoint (FAFF-318).** — This ticket delivers only the raw per-rep capture spine. FAFF-318's resume layer (skip already-completed kinds on restart, a *merge-aware* `per_kind` writer that folds into the existing baseline rather than replacing it, and `meta` reconciliation across sessions) is deliberately separate. **Extension point:** a future `--resume` reads this JSONL (or the 318 checkpoint derived from it) and reconstructs completed-kind aggregates via `summarize()`; the merge-aware baseline writer lives in `updateBaseline` (`run-evals.mjs`). See the DESIGN DECISION RATIONALE for why these stay two tickets.
- **Live-driver lane (`eval/run-live-evals.mjs` `runLiveCase`).** — The parallel live-lane rep loop has the same crash-salvage gap but is not what motivated this ticket (the 4.5h frontier black-box sweep). **Extension point:** thread the same `judgementsPath` through `runLiveEvals → runLiveCase` and append at the same point; keep `test/eval-run-live-evals.test.mjs` green by defaulting the path absent.
- **Automatic retention/pruning of old `.faff/eval-runs/` dirs.** — No auto-GC in v1; retention is bounded per-rep (see the `rawText` cap) and documented, not enforced. **Extension point:** a `faff`-side cleanup or a size note in the calibration README.
- **A bespoke inspection CLI/reader.** — DONE is satisfied by a documented `jq` recipe (WHAT/HOW below); a purpose-built reader is a later nicety, not this ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| rep | One `claude -p` invocation for one case (`runCase`'s loop body). |
| run-id | A per-sweep identifier minted at the CLI entry point; names the capture dir `.faff/eval-runs/<run-id>/`. |
| judgement record | One JSONL line capturing a single completed rep (success or errored). |

**The judgement record (one JSONL line per completed rep):**

```
RECORD JudgementRecord:
  run_id:       String            # the sweep's run-id
  ts:           ISO-8601 String   # capture time (new Date().toISOString())
  case_id:      String            # c.id
  kind:         String            # c.kind
  rep:          Int               # rep index i (0-based)
  status:       "graded" | "errored"   # which loop branch produced this rep
  raw_text:     String | null     # out.rawText, capped to RAW_CAP bytes (null if no rawText, e.g. driver threw)
  raw_truncated: Bool             # true iff raw_text was capped
  envelope:     Object | null     # parsed judgement envelope (null on parse failure / driver error)
  graded:       String | null     # rr.graded: "PASS"|"FAIL"|"PARTIAL"|"ERRORED" (null if grading never ran)
  score:        Number | null     # rr.score (null if grading never ran)
  signature:    String | null     # rr.signature — canonical judgement identity (null if grading never ran)
  oracle:       Object            # c.oracle (closed_set | ordering | gloss_rubric) — what the rep is scored against

  CONSTRAINT one line, newline-terminated, JSON.stringify with no embedded newlines
```

- `RAW_CAP` is a module-level constant (default 16384 bytes). Judgement envelopes are small; this bounds the pathological case (a runaway model dump × ~1,300 reps) while leaving virtually all real outputs intact. Truncation sets `raw_truncated: true` and keeps the leading `RAW_CAP` bytes (the envelope/parse-relevant head).
- **Errored reps are captured too.** A driver error (`run-evals.mjs:56`) yields `status:"errored"`, `raw_text:null`, `envelope:null`, `graded:"ERRORED"`. An envelope-parse error (`:68`) yields `status:"errored"`, `raw_text` = the (bounded) `out.rawText` that failed to parse — this is the *most* valuable case for debugging parse failures — `envelope:null`.

**Capture interface (threaded, opt-in):**

```
runEvals({ cases, driver, baseReps, maxReps, judgementsPath = null })   # judgementsPath: absolute path or null
  → passes judgementsPath into each runCase(...)
runCase(c, driver, { baseReps, maxReps, judgementsPath = null })
  → after each rep completes, if judgementsPath != null, append one JudgementRecord line
```

**Design decisions:** see DESIGN DECISION RATIONALE (§6) — every choice below carries its marker there.

## 4. HOW — Behavior

**Architecture and approach.** A single new module-local helper `appendJudgement(judgementsPath, record)` does a guarded synchronous append. `runCase` gains an optional `judgementsPath`; at the end of each loop iteration — on the happy path *and* both error branches — it builds a `JudgementRecord` from the values already in hand and appends it. The path is minted once at the CLI entry point and threaded down; when absent, capture is a no-op (the test path).

**Run-id minting and threading (at the CLI entry point):**

```
PROCEDURE mint_capture_path():
  1. run_id := `${YYYYMMDD}-${HHMMSS}`     # date-prefixed so lexical sort == chronological, matching .faff/runs/
  2. dir := join(repoRoot, ".faff", "eval-runs", run_id)
  3. return join(dir, "judgements.jsonl")   # dir is created lazily on first append
```

- Minted for **full sweeps**: the top-level eval run (`main`) and `--update-baseline` (the multi-hour sweep that motivated this). The run-id is printed to stdout at sweep start so the human knows where capture lands.
- **Not** minted for the soft-local pre-PR gate (`softLocalGate`'s small-diff path) — a quick check, not a sweep worth salvaging — which passes `judgementsPath: null`, and never for the injected-`runEvalsFn` test path. This keeps every existing mock-driver test I/O-free.

**The append (mirrors the `bin/faff events` guard, inline):**

```
PROCEDURE appendJudgement(judgementsPath, record):
  1. IF judgementsPath is null: return                      # opt-out / test path
  2. mkdirSync(dirname(judgementsPath), { recursive: true }) # lazy, idempotent
  3. appendFileSync(judgementsPath, JSON.stringify(record) + "\n")   # SYNCHRONOUS — flushed before return
```

**Insertion in the rep loop** (`runCase`, the three completion points):

```
PROCEDURE runCase_rep_body(c, i, out, judgementsPath):
  # happy path — after grading (current L64):
  Given a graded rep (rr, env, out.rawText in hand)
    append JudgementRecord{ status:"graded", raw_text: cap(out.rawText), envelope: env,
                            graded: rr.graded, score: rr.score, signature: rr.signature, oracle: c.oracle, ... }
  # driver-error branch (current L56):
  Given driver threw (no out)
    append JudgementRecord{ status:"errored", raw_text:null, envelope:null, graded:"ERRORED",
                            score:null, signature:null, oracle: c.oracle, ... }
  # envelope-error branch (current L68):
  Given envelope parse failed (out.rawText present, no env)
    append JudgementRecord{ status:"errored", raw_text: cap(out.rawText), envelope:null, graded:"ERRORED",
                            score:null, signature:null, oracle: c.oracle, ... }
```

Because `appendFileSync` is synchronous and runs at the end of iteration *i*, the record is on disk before `driver(c, i+1)` is called at the top of iteration *i+1* — the crash-salvage guarantee.

**Inspection recipe (documented, satisfies the reader DONE item).** Record a `jq` one-liner in `.faff/calibration/README.md` for predicted-vs-oracle per case, e.g.:

```
jq -c 'select(.case_id=="confidence-001") | {rep, predicted: .envelope, graded, oracle}' \
  .faff/eval-runs/<run-id>/judgements.jsonl
```

and an aggregate-derivation note: `per_kind` accuracy/stability is reconstructable from the captured `score`/`signature` per rep grouped by `kind` (the source material FAFF-318's resume would consume).

**Failure modes.**

- **The append silently no-ops (path threading bug) → no capture, sweep still "succeeds".** *How you'd know:* the `.faff/eval-runs/<run-id>/` dir is absent or empty after a run; the integration smoke test (below) asserts a line lands. *What it means:* a wiring defect, fix the threading — not a data-loss-on-crash regression since nothing else depends on the file.
- **Unbounded `raw_text` blows up disk on a long sweep.** *How you'd know:* `judgements.jsonl` far exceeds ~(reps × RAW_CAP). *What it means:* the cap isn't being applied; assert `raw_truncated`/length in the unit test.
- **A synchronous append stalls the sweep on slow disk.** *How you'd know:* per-rep wall-time rises with a fast model. *What it means:* acceptable at ~1,300 sequential reps (a few KB each) against local disk; if it ever matters, batch-flush is the extension — but that trades away the per-rep crash guarantee, so it is explicitly not v1.

**Anti-pattern:** reading the raw output back from the per-rep `CLAUDE_CONFIG_DIR`. Why: it is `rmSync`'d in the driver's `finally` (FAFF-139) before grading; the only durable source is `out.rawText`, captured as a string at the driver return. Capture from `out.rawText`, never the cfgDir.

**Anti-pattern:** making capture feed `summarize`/`per_kind` or any gate. Why: ADR-0004 keeps the judge advisory; capture is inspection-only and must not alter any pass/fail outcome.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a sweep run with a capture path and a driver that yields N reps for a case
When the case's reps complete
Then judgements.jsonl contains exactly one JSON line per completed rep, each parseable and carrying case_id/kind/rep/oracle
```

```
Given a rep whose envelope fails to parse
When that rep completes (the envelope-error branch)
Then its record has status="errored", envelope=null, and raw_text set to the (bounded) failing output
```

```
Given runCase/runEvals invoked with no capture path (the mock-driver test path)
When the reps run
Then no file is created and no filesystem write occurs
```

```
Assertion: each rep's record is flushed to disk before the next rep's driver call begins (synchronous append; a kill after rep i leaves reps 0..i captured).
Assertion: raw_text never exceeds RAW_CAP bytes; raw_truncated is true exactly when it was capped.
```

## 6. DESIGN DECISION RATIONALE

**One ticket or two — does raw per-rep capture subsume FAFF-318's aggregate checkpoint?**
Options: (a) merge — make this ticket also deliver resume; (b) keep two — this is capture only, 318 is resume built on top.
- (a) pros: one write-as-you-go spine; cons: bundles two independent concerns (durable capture vs merge-aware resume), balloons scope past a single unit, and couples a low-risk observability add to the load-bearing `--against`/`per_kind` merge semantics.
- (b) pros: right-sized single unit; capture is independently valuable (calibration reads it *today*) and independently shippable; 318's real complexity (skip-completed-kinds, merge-into-existing `per_kind`, cross-session `meta` reconciliation) is untouched and can build on this log. cons: 318 remains open.
- **Chosen:** (b) keep two tickets — this ticket is the pure per-rep capture spine; FAFF-318's resume/checkpoint layer stays separate and consumes this log. Rationale: the aggregate is *derivable* from the raw log, but deriving-and-merging it safely is exactly 318's load-bearing work; folding it in here would over-size the ticket and entangle a benign inspection log with gate-affecting baseline semantics. (Settles the ticket's first open question.)

**Full `rawText` vs bounded snippet + parsed envelope?**
Options: full rawText always; envelope only; envelope + bounded rawText.
- **Chosen:** capture the full parsed **envelope** (small, the calibration workhorse) **plus** `rawText` bounded to `RAW_CAP` (default 16 KB) with a `raw_truncated` flag. Rationale: the envelope answers "predicted vs oracle" for calibration; rawText matters most on *parse failures* (where the envelope is null and you need to see what the model actually emitted), so it is retained but capped so a pathological output can't bloat a 1,300-rep sweep. 16 KB comfortably exceeds a normal judgement envelope. (Settles the ticket's second open question and the retention/size DONE note.)

**Capture only completed graded reps, or errored reps too?**
- **Chosen:** capture **every** completed rep, including both error branches. Rationale: crash-salvage must not have holes, and parse-failure reps are the highest-value debugging capture (the errored-rep raw output is precisely what you inspect to fix a miscalibrated oracle or a broken envelope contract).

**How is capture gated so tests stay I/O-free?**
- **Chosen:** thread an optional `judgementsPath` (default `null`) through `runEvals → runCase`; mint it only at full-sweep CLI entry points, pass `null` from the soft-local gate and never from injected test drivers. Rationale: mirrors the established `deadlineMs = null` opt-out; unconditional writing would make the existing zero-I/O mock-driver tests start touching the filesystem.

**Where does the run-id come from (none exists today)?**
- **Chosen:** mint a date-prefixed `YYYYMMDD-HHMMSS` run-id at the CLI entry point, naming `.faff/eval-runs/<run-id>/judgements.jsonl`, printed at sweep start. Rationale: matches the existing `.faff/runs/<run-id>/` scheme so lexical sort == chronological; keeps capture out of the pure functions (they only receive the resolved path).

**Write mechanism.**
- **Chosen:** inline `appendFileSync(path, JSON.stringify(record)+"\n")` with a lazy `mkdirSync`, mirroring `bin/faff events append`. **Assumes:** the eval harness stays node-builtins-only, so the `faff` CLI's helper is copied in spirit, not imported.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — both questions the ticket asked prep to settle are resolved above (two tickets; envelope + bounded rawText).

**Assumptions:**

- **Assumes:** `eval/run-evals.mjs` remains zero-dependency / node-builtins-only. *Validate:* confirm the file's import block still pulls only from `node:*` before adding `appendFileSync` (it already imports `writeFileSync`/`mkdirSync` from `node:fs`).
- **Assumes:** `out.rawText` continues to hold the full raw judgement string at the driver return (captured before the cfgDir `rmSync`). *Validate:* confirm `makeCliDriver` still returns `{ rawText, tokens }` with `rawText = res.stdout` before any implementation.

## 8. DONE — Definition of Done

### From WHY
- [ ] A completed sweep leaves a durable `.faff/eval-runs/<run-id>/judgements.jsonl` with the raw judgements; nothing is discarded that calibration needs.
- [ ] Capture does not alter any gate/oracle/`per_kind` outcome (advisory-only; a run's pass/fail is byte-identical with capture on vs off).

### From WHAT (types and interfaces)
- [ ] Each line is a valid `JudgementRecord` with `run_id, ts, case_id, kind, rep, status, raw_text, raw_truncated, envelope, graded, score, signature, oracle`.
- [ ] `raw_text` is capped to `RAW_CAP`; `raw_truncated` is true exactly when capping occurred.
- [ ] Errored reps (driver-error and envelope-parse-error branches) each produce a record with `status:"errored"`.

### From HOW (behaviour)
- [ ] Each rep's record is appended synchronously at the end of its loop iteration, before the next rep's driver call — a kill after rep *i* leaves reps 0..*i* on disk.
- [ ] `judgementsPath` defaults absent through `runEvals`/`runCase`; the soft-local gate and injected-driver tests pass no path and write nothing.
- [ ] The run-id is minted at the CLI entry (`main`, `--update-baseline`) as `YYYYMMDD-HHMMSS` and printed at sweep start.
- [ ] `.faff/calibration/README.md` gains a documented `jq` recipe surfacing model-predicted (`envelope`) vs `oracle` per case, plus a note that `per_kind` is derivable from the captured `score`/`signature`.

### From HOW (edge cases)
- [ ] A driver-error rep records `raw_text:null`, `envelope:null`, `graded:"ERRORED"`.
- [ ] An envelope-parse-failure rep records the bounded failing `raw_text` and `envelope:null`.

### From scope
- [ ] No auto-pruning and no live-lane change land in this ticket (both named as extension points).

**Eval coverage.** This ticket adds no LLM-judgement seam (it is pure I/O around the existing loop), so no new grader `KIND`/eval case is required.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. tmp := mkdtemp; path := join(tmp, "judgements.jsonl")
  2. runEvals({ cases: [oneMockCase], driver: async () => envOf(...), baseReps: 2, maxReps: 2, judgementsPath: path })
  3. ASSERT readFileSync(path) has 2 newline-terminated JSON lines, each JSON.parse-able with case_id === oneMockCase.id
  4. run the SAME with judgementsPath omitted → ASSERT no file created
```

confidence: high
