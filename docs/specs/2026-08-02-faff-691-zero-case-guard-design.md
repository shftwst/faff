# FAFF-691 — Refuse a zero-case eval sweep instead of reporting hollow success

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · revision 1 · confidence: high. Full spec on Linear FAFF-691.

This spec is for the build agent implementing FAFF-691, and for the human reviewers gating it. It revises revision 0 in place after a `reject-approach` on two design lenses: the premise ("the paid call happens only inside `runCase`") was wrong — there are **two** paid rep loops, and the second lives in a second production file. The guard mechanism revision 0 designed is sound and is preserved unchanged; what changes is the scope (now two files, six guarded sites) and two message-attribution details. Everything here is checked against `eval/run-evals.mjs` and `eval/run-live-evals.mjs` at `7f9513c`.

## 1. WHY — Problem and Principles

**The load-bearing model.** The frontier model (`claude -p`, which costs real spend) is only ever called from **inside a per-case rep loop** — once per rep, per case. There are two such loops: `runCase` in `eval/run-evals.mjs` (driven via an injected `driver`) and `runLiveCase` in `eval/run-live-evals.mjs` (driven via an injected `model`). Both loops iterate over a `cases` array. So when `cases` is empty, **neither loop runs a rep, zero spend occurs — and the run still reports success.** `summarize([])` returns `status: "complete"`, and every CLI entry point maps `complete → exit 0`. A zero-case run is therefore a hollow green: it resolves nothing, claims completion, and exits clean.

**Problem statement.** Today an eval invocation that resolves to zero cases (a mistyped `--only`, an empty `--cases-dir`, or a live `--kind` with no fixtures) prints a "complete" headline and exits 0, so an operator or a gate believes a baseline was captured or a regression gate passed when nothing ran. The change makes every paid or gate-bearing entry point refuse a zero-case run — fail loud instead of a silent pass — while the one always-advisory path warns instead. This is a small guard: one shared helper, called at six sites across two files, plus tests.

**Design principles.**

- **Fail-closed on an empty run.** A run that grades nothing is never a pass. Every paid lane and every gate lane refuses (non-zero exit) on zero cases; only the lane whose entire contract is "always advisory, always exit 0" downgrades the refusal to a warning. This mirrors the codebase's existing fail-loud convention (`loadBaseline` throws rather than treating an absent baseline as a green).
- **The check is on `cases.length`, nothing derived.** The guard tests the resolved case count directly. It does not derive whether the driver is frontier, local, or a mock, and does not reason about spend — a zero-case run is refused on every driver because there is no legitimate empty-sweep workflow (confirmed against the tests: every `--only` test names a matching id, so it loads exactly one case; none exercises an empty sweep).
- **The message must name the real cause, not the last filter.** Where two independent narrowings can empty the set (an empty `--cases-dir` load followed by an `--only` filter), the message must attribute the emptiness to the narrowing that actually caused it, not to whichever ran last.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/run-evals.mjs` | Node ESM | Five of the six guarded sites live here; hosts the new shared helper (exported). |
| `eval/run-live-evals.mjs` | Node ESM | The sixth site (`runLiveEvals`) — the second paid frontier runner; already imports `summarize` from `run-evals.mjs`, so the helper is trivially importable. |
| `eval/run-evals.mjs` `summarize` (:207) | Node ESM | `summarize([])` → `status:"complete"`; the source of the hollow green both files share. |
| `test/run-evals-cases-dir.test.mjs` | Node ESM | The `--reps 0` spawn-the-real-CLI offline idiom the `run-evals` guard tests reuse. |
| `test/eval-run-live-evals.test.mjs` | Node ESM | The mock-model `assert.rejects` idiom the `runLiveEvals` guard test reuses (see its input-guard test at :243). |

**Scope statement.** This sits at the CLI entry boundary of the two eval runners — the last point before a rep loop spends — and closes a reporting-integrity hole; it does not touch grading, aggregation, or the frontier/local drivers themselves.

## 2. OUT OF SCOPE

- **The rep loops and drivers themselves** (`runCase`, `runLiveCase`, `cli-driver.mjs`, `live-driver.mjs`). Why excluded: the defect is entry-point reporting, not rep mechanics; the loops already behave correctly (zero iterations on empty input). Extension point: none needed — the guard sits above them.
- **`summarize`'s `status:"complete"` on empty input.** Why excluded: `summarize` is shared and correct for its job (an incomplete run is one that hit the deadline ceiling, orthogonal to emptiness); changing it would ripple into every caller. The fix belongs at the entry points that know their own zero-case triggers. Extension point: `eval/run-evals.mjs` `summarize` (:207) — left as is.
- **A `--allow-empty` escape hatch.** Why excluded: no legitimate empty-run workflow exists (verified against tests and docs), so an opt-out would only re-open the hole. Extension point: if one ever emerges, add the flag at the call sites that pass through `assertNonEmptyCases`.
- **Detecting a zero-case run *after* a partial sweep** (e.g. a deadline ceiling with some cases graded). Why excluded: that path already reports `incomplete (ceiling)` and non-zero exit; it is not a hollow green. Extension point: none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Guarded site | A CLI entry function that resolves a `cases` array before a rep loop and must not proceed on zero cases. |
| Refuse | Throw an `Error` so the file's top-level `.catch` prints a diagnostic and sets exit 1. Used by every paid/gate lane. |
| Warn-only | Print an advisory and return 0 without running. Used solely by `softLocalGate`, whose contract is always-exit-0. |
| `loadedCount` | The number of cases the loader returned **before** any `--only` filter — the signal that distinguishes an empty load from an `--only` that matched nothing. |

**The shared helper (in `eval/run-evals.mjs`, exported).** One pure reason-builder plus a throwing wrapper, so the warn-only site can reuse the same message logic without throwing.

```
FUNCTION emptyCaseReason(cases, { entry, only, casesDir, kind, loadedCount }) -> string | null:
  # entry:       a label naming the invocation, e.g. "--against gate" or "--kind reconciliation"
  # only:        the --only value, or null
  # casesDir:    the --cases-dir value (plain sweep only), or null/undefined
  # kind:        the live --kind value (run-live-evals only), or null/undefined
  # loadedCount: cases.length BEFORE the --only filter ran

  IF cases.length > 0: RETURN null                       # non-empty — no refusal
  loadedEmpty = (loadedCount == 0)

  # Precedence — attribute to the narrowing that actually emptied the set:
  IF only AND NOT loadedEmpty:                            # a non-empty load, emptied by --only
    RETURN "<entry>: --only '<only>' matched none of the <loadedCount> loaded case(s)"
  IF casesDir AND loadedEmpty:                            # the load itself was empty, from --cases-dir
    RETURN "<entry>: --cases-dir '<casesDir>' contains no eval cases"
  IF kind AND loadedEmpty:                                # the live adapter loader returned nothing
    RETURN "<entry>: --kind '<kind>' has no live fixtures (its adapter loader returned nothing)"
  RETURN "<entry>: the eval corpus is empty — nothing to run"   # default corpus empty

FUNCTION assertNonEmptyCases(cases, ctx):                 # the refuse form
  reason = emptyCaseReason(cases, ctx)
  IF reason != null: THROW new Error(reason)
```

The precedence is what fixes the message misattribution: rule 1 is gated on `NOT loadedEmpty`, so when an empty `--cases-dir` load is *also* narrowed by `--only`, `loadedEmpty` is true, rule 1 is skipped, and rule 2 names `--cases-dir` — the real cause. `casesDir` and `kind` never co-occur (one is plain-sweep-only, the other live-only), so their relative order is immaterial.

**Design decision — where the helper lives and its shape.** Options: (a) one throwing helper only; (b) a pure reason-builder plus a throwing wrapper. Option (a) forces `softLocalGate` to `try/catch` its own guard to stay exit-0, which reads as catching an error you deliberately raised. Option (b) lets the warn-only site call `emptyCaseReason` directly and print it. **Chosen:** (b) — `emptyCaseReason` (pure) + `assertNonEmptyCases` (throws), both exported from `eval/run-evals.mjs`; `run-live-evals.mjs` imports `assertNonEmptyCases` alongside the `summarize` it already imports.

## 4. HOW — Behavior

**Architecture.** Each guarded site follows the same three-line shape at the point it resolves cases:

```
PROCEDURE guard_a_site(loader, only, ...ctx):
  1. cases = loader()                       # loadCases(dir) | adapter.loader() | loadCases().filter(SMOKE_KINDS)
  2. loadedCount = cases.length             # capture BEFORE the --only filter
  3. IF only: cases = cases.filter(id == only)
  4. Refuse sites:  assertNonEmptyCases(cases, { entry, only, casesDir, kind, loadedCount })
     Warn-only site: reason = emptyCaseReason(cases, {...})
                     IF reason: console.warn(`[gate] ${reason} — soft smoke not run (advisory; exit 0)`); RETURN 0
  5. ... proceed to runEvals / runLiveEvals as today ...
```

**The six sites.** Five refuse; one warns.

| Site (file · function) | Zero-case trigger(s) | `entry` label | Disposition |
|---|---|---|---|
| `run-evals.mjs` · `gateAgainst` (:311) | `--only` no-match | `--against gate` | Refuse |
| `run-evals.mjs` · `updateBaseline` (:334) | `--only` no-match (corpus is always the default non-empty `cases/`) | `--update-baseline` | Refuse |
| `run-evals.mjs` · `compare` (:529) | `--only` no-match | `--compare` | Refuse |
| `run-evals.mjs` · `main` plain sweep (:682-692) | empty `--cases-dir`, or `--only` no-match | `plain sweep` | Refuse |
| `run-evals.mjs` · `softLocalGate` (:613) | `--only` no-match, or no smoke-kind cases | `--gate soft smoke` | **Warn-only** |
| `run-live-evals.mjs` · `runLiveEvals` (:149-158) | `--only` no-match, **or** a `--kind` whose adapter loader returns nothing | `--kind <k>` | Refuse |

**Behaviour summary — why `runLiveEvals` is a refuse site (the corrected premise).** `run-live-evals.mjs` is a second real `claude -p` frontier runner (human-supervised). Its `runLiveEvals` (:154-157) loads `adapter.loader()`, applies the same `--only` filter, then drives `runLiveCase` — its own paid rep loop — per case, and returns `summarize(results)`. Its `main` (:276) returns `summary.status === "complete" ? 0 : 1`. So a zero-case run there is the identical hollow green: `summarize([])` → complete → exit 0 on the paid live lane. It has a **second, new** zero-case trigger the other sites lack: each adapter's loader is kind-filtered (`loadLiveCases().filter(c => c.kind === "reconciliation")` at :74; `loadCases().filter(c => c.kind === "routing")` at :92; `loadLiveCases().filter(c => c.kind === "verdict-build")` at :109), so running `--kind <k>` for a kind with no committed fixtures yields zero cases **without any `--only`**. That is the operator error the guard must catch — you asked to baseline a kind that has nothing to baseline — so it is named explicitly (message rule 3, the `kind` cause), not collapsed into another cause.

**Refuse mechanism — throw, ride the top-level catch.** `assertNonEmptyCases` throws a plain `Error`. Each file already has a top-level `.catch` that turns a thrown error into a diagnostic + exit 1:
- `run-evals.mjs` :703-707 → `console.error("[run-evals] " + message)`; `process.exitCode = 1`.
- `run-live-evals.mjs` :282-286 → `console.error("[run-live-evals] " + message)`; `process.exitCode = 1`.

In `run-live-evals.mjs`, the throw propagates out of `runLiveEvals` (called inside `main`'s `try`), the `finally { repo.teardown() }` (:277-279) still runs, then `.catch` handles it — clean teardown, exit 1. No new top-level plumbing.

**Guard placement in `updateBaseline` — and the accurate rationale.** Place the guard immediately after the `--only` filter (after :344), before `expectedKinds`, `mintCapturePath`, and `foldInAndWriteBaseline`. The precise reason (revision 0 overstated this): with `--only <no-match>`, `progressPath` is set to `null` at :350, so the progress-file truncation at :374 never runs — that concern is not live on the only-trigger, and `updateBaseline` reads the default non-empty corpus so no non-`--only` zero-case can reach this path. What the guard actually prevents is the corruption in `foldInAndWriteBaseline`: with zero cases, `complete = !only && ...` (:402) is false, so the else-overlay (:410) leaves `per_kind` unchanged, **but** `meta.source` is overwritten with a nonsensical `"partial/resumed --update-baseline — 0/0 kinds swept this cycle; rest retained"` plus a fresh `captured_at`/`model`/`base_reps` (:411, :415) — mild baseline-metadata corruption, not a byte-identical no-op — and the partial-sweep warning at :423 (`if (!complete && !only)`) is suppressed because `!only` is false, so the corruption happens silently. The guard fires before any of it.

**`gateAgainst` — the explicit guard is a real behaviour change, and it closes a real hole.** Revision 0 claimed the explicit guard "changes no observable" because `gateAgainst` is already emergently immune (a zero-case run makes every baseline kind read as "kind dropped from the run" → `failed=true` → exit 1). Two corrections:

1. The claim is false as stated. A zero-case `--only` `gateAgainst` run today, before its emergent exit-1, still writes `report/latest.json` (:321) and prints the gate table (:324). An early throw suppresses both. The exit code stays 1, but stdout and the report file change — the guard swaps an emergent, misleading diff for an explicit refusal and skips the now-pointless report/table. That is an improvement, not a no-op; the spec states it as such.
2. The emergent immunity is not total, and this is the guard's strongest justification. A committed baseline with `per_kind: {}` passes `loadBaseline`'s truthy check (`{}` is truthy at :294) yet makes `diffAgainstBaseline` iterate nothing → `failed=false`. So a zero-case run against an empty-`per_kind` baseline **exits 0 today** — a genuine hollow green the "kind dropped" logic cannot catch because there are no kinds to drop. The explicit `cases.length` guard closes it regardless of baseline contents. This decision stays for that reason.

**`softLocalGate` — warn, never throw.** Its contract is always-exit-0 (an advisory drift signal that tolerates an absent or sub-par local model). It calls `emptyCaseReason`, prints a `[gate]` warning if non-null, and returns 0 — it must never throw, or it would break the "soft smoke degrades gracefully" guarantee. This is the one site where a zero-case run is a warning, not a refusal.

**Failure modes.**

- **The failure:** a *seventh* paid rep loop exists somewhere else, still hollow-green. The whole premise turned out wrong once already. **How you'd know:** grep for injected-driver/model rep loops — every `claude -p` spend flows through an injected `driver(c, i)` or `model(...)` called inside a `for` over cases. At `7f9513c` there are exactly two: `runCase` (`run-evals.mjs` :114-148) and `runLiveCase` (`run-live-evals.mjs` :129-145); `compare` reaches spend only via `runEvals → runCase`. **What it means:** proceed — the inventory is two loops, six entry sites; if a future runner adds a third loop, it inherits this same guard at its entry.
- **The failure:** the message misattributes a cause the precedence didn't anticipate. **How you'd know:** the empty-`--cases-dir`+`--only` scenario (below) names `--only` instead of `--cases-dir`. **What it means:** the `loadedCount`/`loadedEmpty` split is the fix; the scenario pins it.

**Anti-pattern:** deriving `isFrontier` (or "is this driver paid?") to decide whether to refuse. Why: a zero-case run is meaningless on every driver, the check is on `cases.length` alone, and a derivation adds a branch that can be wrong. **Anti-pattern:** making `softLocalGate` throw and catching it locally to stay exit-0. Why: it reads as catching your own deliberate error; use the pure `emptyCaseReason` warn form instead.

## 5. Scenarios

```
Given eval/run-evals.mjs run as a plain sweep with --cases-dir pointed at an empty directory
When the plain-sweep entry resolves zero cases
Then it throws, the top-level catch prints "[run-evals] plain sweep: --cases-dir '<dir>' contains no eval cases", and the process exits 1 (no report/latest.json claiming success)
```

```
Given --cases-dir points at an empty directory AND --only <some-id> is also set on the plain sweep
When the guard runs (the empty load is narrowed further by --only)
Then the refusal message names --cases-dir as the cause, not --only (loadedCount is 0, so the --only branch is skipped)
```

```
Given eval/run-evals.mjs --against <baseline> whose committed per_kind block is empty ({}), invoked with --only <no-match>
When gateAgainst resolves zero cases
Then it refuses with exit 1 — instead of today's silent exit 0, where an empty per_kind makes diffAgainstBaseline find nothing to drop
```

```
Given eval/run-live-evals.mjs --kind reconciliation --only <no-match>, with a mock model injected that throws if called
When runLiveEvals resolves zero cases
Then it throws before the rep loop, the mock model is never invoked (zero spend), and the "[run-live-evals] --kind 'reconciliation': --only ..." diagnostic is printed with exit 1
```

```
Given eval/run-live-evals.mjs --kind <k> for a registered kind whose adapter loader returns no fixtures (no --only set)
When runLiveEvals resolves zero cases from the kind-filtered loader
Then it refuses, naming "--kind '<k>' has no live fixtures" (trigger b — the new empty-loader shape)
```

- The `softLocalGate` path MUST warn and return 0 (never throw) when it resolves zero cases — the always-advisory contract holds even on an empty smoke set.

## 6. Design Decision Rationale

**Where does the shared helper live, and what shape?** Options: single throwing helper vs. a pure reason-builder + throwing wrapper. A single throwing helper forces `softLocalGate` to catch its own guard to keep exit-0. **Chosen:** `emptyCaseReason` (pure) + `assertNonEmptyCases` (throws), both exported from `eval/run-evals.mjs`; `run-live-evals.mjs` imports the wrapper next to its existing `summarize` import — rationale: the warn-only site reuses the message logic without a self-catch.

**Refuse on every driver, or only paid ones?** Options: gate on `cases.length` alone vs. derive whether the driver spends. **Chosen:** gate on `cases.length` alone — rationale: no legitimate empty-run workflow exists (verified against tests/docs), so refusing universally is correct and avoids a derivation that could misfire.

**How is the empty-cause message attributed?** Options: precedence over the final post-filter array only (revision 0) vs. a `loadedCount` captured before the `--only` filter. The post-filter-only form blames `--only` when an empty `--cases-dir` was the real cause. **Chosen:** capture `loadedCount` pre-filter; precedence checks `NOT loadedEmpty` before blaming `--only` — rationale: distinguishes "load was empty" from "`--only` matched nothing."

**Is `run-live-evals.mjs` in scope?** It is a second paid frontier runner with the identical hollow-green and a new empty-loader trigger. **Chosen:** yes — `runLiveEvals` is the sixth guarded (refuse) site, and its `--kind`-with-no-fixtures trigger is named explicitly in the message — rationale: leaving it out would fix five of six identical holes.

**Keep the explicit `gateAgainst` guard despite emergent immunity?** **Chosen:** keep it — rationale: a `per_kind:{}` baseline makes the emergent "kind dropped" immunity fail (exit 0 today); the explicit `cases.length` guard closes that real hole and replaces a misleading emergent diff (which also writes a report and prints a table) with a clean refusal.

**`softLocalGate` refuse or warn?** **Chosen:** warn-only, return 0 — rationale: its contract is always-advisory, always-exit-0; a throw would break graceful degradation when the local model is absent.

**Throw or return a code?** **Chosen:** throw an `Error` and ride each file's existing top-level `.catch` (`run-evals.mjs` :703-707; `run-live-evals.mjs` :282-286) — rationale: both catches already map a thrown error to a `[run-evals]`/`[run-live-evals]` diagnostic + exit 1; no new plumbing, and `run-live-evals`'s `finally` teardown still runs.

**Where does the `updateBaseline` guard sit?** **Chosen:** immediately after the `--only` filter, before `foldInAndWriteBaseline`/`mintCapturePath` — rationale: it prevents the `meta.source`/`captured_at` corruption and the suppressed partial-sweep warning that a zero-case `--only` run causes; the progress-file truncation is already dead on the `--only` trigger (`progressPath` is null), so truncation is not the reason.

## 7. Open Questions and Assumptions

None. Every decision is closed (`**Chosen:**`). No `**Punt:**` items and no `**Assumes:**` items — both top-level `.catch` handlers, the two rep loops, and the six sites' triggers are verified present in the source at `7f9513c`, not assumed.

## 8. DONE — Definition of Done

### From WHY
- [ ] A zero-case run on any paid or gate-bearing entry point exits non-zero with a diagnostic naming the cause (no `status:"complete"` / exit 0 on empty cases).
- [ ] The guard tests `cases.length` only — no driver-type/spend derivation anywhere in the guard.

### From WHAT (helper)
- [ ] `emptyCaseReason(cases, ctx)` and `assertNonEmptyCases(cases, ctx)` are exported from `eval/run-evals.mjs`; `run-live-evals.mjs` imports `assertNonEmptyCases`.
- [ ] `emptyCaseReason` returns `null` for a non-empty `cases`, and otherwise a message following the precedence: `!loadedEmpty && only` → `--only`; `loadedEmpty && casesDir` → `--cases-dir`; `loadedEmpty && kind` → `--kind`; else default-corpus-empty.

### From HOW (the six sites)
- [ ] `gateAgainst` refuses on zero cases, including against a baseline whose `per_kind` is `{}` (exit 1, not the current silent exit 0).
- [ ] `updateBaseline` refuses on a zero-case `--only`, placed before `foldInAndWriteBaseline` so no `meta.source`/`captured_at` corruption occurs.
- [ ] `compare` refuses on zero cases.
- [ ] `main`'s plain sweep refuses on an empty `--cases-dir` or an `--only` no-match.
- [ ] `softLocalGate` warns and returns 0 on zero cases — never throws.
- [ ] `runLiveEvals` refuses on zero cases from either trigger (`--only` no-match, or a `--kind` with no fixtures), before the `runLiveCase` loop; its `finally` teardown still runs and the process exits 1.

### From HOW (message attribution)
- [ ] With an empty `--cases-dir` AND `--only` both set, the refusal names `--cases-dir` (not `--only`).

### From HOW (mechanism)
- [ ] Refusal is a thrown `Error` handled by each file's existing top-level `.catch`; no new top-level handler is added.

### Tests
- [ ] `run-evals` guard sites are covered by the `--reps 0` spawn-the-real-CLI offline idiom (per `test/run-evals-cases-dir.test.mjs`), asserting exit 1 and the expected `[run-evals] ...` message per site.
- [ ] The `runLiveEvals` guard is covered by the mock-model `assert.rejects` idiom (per `test/eval-run-live-evals.test.mjs` :243), asserting the injected model is never called on a zero-case run.
- [ ] A `softLocalGate` zero-case test asserts exit 0 and a `[gate]` warning (no throw).

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (this is entry-point control flow, not a graded kind), so no grader `KIND` / eval case / seam-registry row is required.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Run `node eval/run-evals.mjs --cases-dir <empty-tmp-dir> --reps 0`
     → EXPECT exit 1 and stderr contains "[run-evals] plain sweep: --cases-dir" and "contains no eval cases"
     → EXPECT no report/latest.json written for this run
  2. Run `node eval/run-evals.mjs --reps 0`  (default non-empty cases/)
     → EXPECT exit 0 (the guard does not fire on a populated corpus)
  3. In `node --test`: call runLiveEvals({ kind: "reconciliation", only: "no-such-id",
        ctx: { runSkill, tracker, repo, model: () => { throw new Error("must not be called") } } })
     → EXPECT it rejects with /--only/ and the model was never invoked
```

confidence: high