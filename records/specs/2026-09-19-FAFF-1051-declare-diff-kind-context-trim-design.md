# Declare the diff kind so the context trim stops truncating prose inputs

> Spec: faffter-dark-nlspec · 2026-09-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1051.

This spec covers FAFF-1051 (spec-review supplies almost no repo context: the diff-anchored trim discards about 96% when the "diff" is a spec). The audience is the build agent that will change `review-call.mjs`, plus the human reviewing that change.

## Refresh annotations (2026-09-19, autonomous)

This spec was refreshed by an autonomous faff-prep re-entry that folded the post-spec tracker thread and re-rated. No design decision changed; the approach ("declare the diff kind") is unchanged.

- **Folded — operator resolution (2026-09-16, "Decision (operator): build now").** The operator unparked the issue, moved it to Todo, and explicitly satisfied the `needs-decision-first` promotion gate this medium-confidence spec was waiting on ("This decision is the promotion gate a needs-decision-first medium-confidence spec waits on; it is now satisfied. Next step: /faff-graft FAFF-1051."). The one open item that held the rating at medium — whether a refuter given intact context finds more stale-reuse defects — is carried as a gated follow-up DONE item with a named owner and a defined null outcome, so it is not lost by building now. With that decision folded, section 7 carries no open question and no open Punt (14 Chosen, 1 documented Assumes with a validate-before-building step), so the retained rating is re-rated **medium → high** and the spec is build-eligible.
- **Folded as context — FAFF-1048 recurrence with figures (2026-09-19).** The spec-review context trim recurred on a live FAFF-1048 spec-review round (four lenses, `spark-qwen-3-8`, backends healthy at exit 0). Measured: the assembled context bundle went 285,369 → 4,657 bytes once the relevance trim ran (~98% of repo context elided). Confirming repro: a markdown spec passed as `--diff` yields `paths=0 identifiers=0`, a real unified diff yields `paths=1 identifiers=1`. Operator workaround `--context-trim-bytes 0` restores the full bundle. This is a context-assembly (trim-predicate) degradation, not a transport outage — it **reinforces** the spec's premise (the diff-anchored trim discards prose context) rather than superseding it, so the premise remains load-bearing.

## 1. WHY

### The model

`trimContextFiles` reduces each context file to the regions a unified diff makes relevant. Relevance comes from two anchor kinds: lines inside a diff hunk's touched range, and lines naming an identifier the hunk's body mentions. That relevance model only means anything when the `--diff` argument really is a unified diff. Three callers pass something else: the spec-review occupant passes a markdown spec, and faff-prep's spec-judge passes a spec snapshot on both of its calls. For those inputs there are no anchors to find, and the code answers by keeping the first 12 lines of every file over 2 KB and eliding the rest. Keeping 12 lines is not a relevance decision, it is truncation. Everything below follows from separating the two: anchored reduction is relevance, unanchored reduction is truncation, and truncation is only defensible against a budget.

### Problem statement

`spec_review` passes a markdown spec as `--diff`, so `parseDiffTouched` finds no `@@` hunks, returns an empty touched-path map and an empty identifier set, and every context file above 2 KB is cut to 12 lines. On the measured FAFF-996 round-2 pass the assembled context went from 301506 bytes to 12935, so the refuters saw about 4% of the repo context and every one of the five blocking objections had to come from the dispatching agent reading the tree by hand. This change has the caller declare which kind of input it is passing, gives the prose kind a budget-driven head-line reduction instead of a relevance reduction it cannot perform, and leaves the unified kind byte-identical.

### Design principles

**The trim cannot infer what its input is, so the caller declares it.** Inference was tried on paper and fails in both directions, each direction breaking a different caller. Downward: a markdown spec that quotes `@@ -1,3 +1,4 @@` inside a fenced block opens a hunk in `parseDiffTouched` and collects identifiers from the quoted body, which is a routine shape for a spec describing a code change, so a text-shape test calls the spec a diff. Upward: a deletion-only diff contributes no touched ranges at all, because `addRange` is called only on `+` lines, and the identifiers harvested from `-` lines are by definition names absent from the post-change file, so an anchor-yield test calls a real diff prose. Both were measured against the tree, not reasoned about: a spec quoting one hunk yields `touchedByPath` size 0 and identifiers `{ hunksParsed }`, and the deletion diff `-function deadHelperXyz() { / -  return legacyThingAbc(); / -}` yields `touchedByPath` size 0 with identifiers `{ deadHelperXyz, legacyThingAbc }`. No predicate over the text separates those two cases, because there is nothing in the text to separate.

**A declared input kind is not a consumer-aware threshold.** The ticket's first direction, rejected here and still rejected, is a per-caller tuning of a policy number, which leaves the trim guessing what its input is and leaves the next non-diff caller broken. A kind is a fact about the input that only the caller can know, declared once per call site, after which the trim applies the right model rather than a guessed one. The default is `unified`, so every caller that says nothing keeps today's behaviour exactly.

**Reduction without a relevance model is truncation, and truncation is only defensible against a budget.** The prose kind has no relevance model, ever, so its reduction is head retention measured against a byte budget, and it does nothing at all below that budget. The budget covers the whole prompt, because what a backend rejects is the whole request, not one component of it. The ceiling it derives from is a named constant with one home, not a threshold borrowed from the relevance pass.

**A budget bounds how much is cut, but not how little is kept.** A head short enough to stop answering the question the context was supplied to answer costs the payload bytes and buys nothing, so the prose ladder has a retention floor and stops there, reporting the shortfall rather than cutting past it. The unified path's 12-line floor is what this ticket exists to stop, so no prose rung reaches it.

**`code_review` stays byte-identical, by construction rather than by predicate.** FAFF-915 exists because reasoning reviewers empty out on large payloads. `code_review` passes no `--diff-kind`, so it runs the unified path, and the unified path's only change is one extra advisory line on stderr, which alters no byte of any payload sent to any backend. Nothing about the shape of its diff, deletion-only included, can reach the prose path.

### Reference context

| File | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | Holds every function this spec changes: the six `DEFAULT_*` trim constants (lines 144 to 149), `TRIM_WINDOW_LADDER` (288), `tightenToTarget` (298), `elisionMarker` (329), `parseDiffTouched` (341), `headReduce` (439), `trimOneFile` (452), `trimContextFiles` (521), the flag parser (about 1449), `main`'s usage-fault exit pattern (1988), the two trim call sites in `main` (about 2068 and 2085), and the FAFF-903 prefix swap the purity invariant protects (2148). Main edit site. |
| `plugin/skills/faffter-dark-spec-review/build-lens-requests.mjs` | Node ESM | Assembles each lens's argv at line 43. Where the spec-review occupant declares the prose kind. Second edit site. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown prose | Lines 108, 120 and 124 describe that argv; line 161 is the per-lens transcript rule. Third edit site. |
| `plugin/skills/faff-prep/SKILL.md` | Markdown prose | Lines 210 and 211: the spec-judge's two `review-call.mjs` calls, both passing the spec snapshot as `--diff`. Fourth edit site, prose only. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown prose | Lines 232 and 233: `code_review` passes every file the diff touches as `--context` and `git diff main...HEAD` as `--diff`. The regression boundary. Not edited. |
| `test/adversarial-call.test.mjs` | Node test | FAFF-915 trim cases, roughly lines 3480 to 3700. Every fixture there is unified, so none of them change. |
| `test/adversarial-context-window.test.mjs` | Node test | FAFF-1039 ladder and window cases. `fixture`, `denseFixture` and `nonMonotonicFixture` are all unified, so none of them change. |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node ESM | Passes each `LensRequest.argv` through verbatim and returns each lens's `stderr`. Not edited; named because the new flag rides that argv and the transcript change reads that field. |

One naming trap in `review-call.mjs`: `minFileBytes`, `maxAnchorLines` and `retainedCeiling` are option-bag field names, and the constants holding their defaults are `DEFAULT_MIN_FILE_TRIM_BYTES`, `DEFAULT_MAX_ANCHOR_LINES` and `DEFAULT_RETAINED_CEILING`. This spec uses the option name when it means the option and the constant name when it means the default.

### Scope

This adds one declared input kind to the adversarial-review transport, one budget-driven reduction for that kind, and the declaration itself in the two skills that pass prose. It changes no contract, no exit code, and no existing flag's meaning.

## 2. OUT OF SCOPE

- **Inferring the input kind from the diff text.** Excluded on evidence, per the first design principle: the two failing directions are measured, not hypothesised. Extension point: none wanted. If a later ticket revisits it, `parseDiffTouched`'s returned `hunks` count is the observable it would have to beat.
- **A trim-ratio quality signal that gates a round.** Direction 3 on the ticket. Excluded because gating on it means widening the `spec-review-verdict` path, which is a separate change with its own review. Extension point: `fan-out.mjs` already returns `stderr` per lens and already carries `primarySkipped` as a derived-but-unconsumed field; a future consumer reads the trim notes from there once the transcript change below persists them.
- **A consumer-aware trim threshold.** Direction 1 on the ticket. Excluded per the second design principle. Extension point: `--context-trim-bytes` at `review-call.mjs:1449` already exists, so a caller that wants a different threshold needs no new code.
- **An operator-facing knob for the prose ceiling.** The ceiling ships as a named constant with a test-only escape hatch, the same treatment `--max-payload-bytes` already documents for itself, and no `SKILL.md` presents it as something to tune. The operator who needs a tighter bound already has the exact one: `context_window` on the backend, which the window pass honours precisely where the ceiling can only approximate. Extension point: `--context-trim-bytes` is the shape a later operator-facing flag would copy.
- **An anchor parser that reads file paths out of markdown spec prose.** Excluded because it is a new relevance model needing its own evidence, and because it would be redundant here: the spec-review occupant already passes exactly the files the spec names as `--context`, so a path-anchoring pass over the spec would mark every supplied file relevant, which is what the prose path gives for free. Extension point: `parseDiffTouched`.
- **Changing which files spec-review supplies as `--context`.** Pruning or ranking the context set is a separate question from what the trim does to it. Extension point: `buildLensRequests`' `contextPaths`.
- **Declaring `context_window` on more backends.** In flight on the `chore/faffrc-context-windows` branch, not this ticket. Nothing in this spec may depend on a declared window; see the ceiling decisions in sections 3 and 6. That declaration is nonetheless the exact bound on a backend's hard request cap, which the prose ceiling only stands in for, so the two changes are complementary rather than alternatives.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| Diff kind | What the caller declares its `--diff` argument to be: `unified` (a real unified diff, the default) or `prose` (a document, to which no diff-relevance model applies). |
| Prose ceiling | The byte budget for the whole prompt under the prose kind: the context files, plus the `--diff` document, plus a fixed reserve for the per-lens brief. Below it the prose path does nothing. |
| Context budget | The prose ceiling less the `--diff` bytes and the brief reserve. What head fit actually measures the context files against, so the ceiling bounds the payload rather than one component of it. |
| Head fit | Reducing each context file that is both above `minFileBytes` and longer than `headLines` lines to its first `headLines` lines plus one elision marker, over a descending ladder, stopping at the first rung that meets the context budget. |
| Retention floor | The smallest head rung the prose ladder descends to. Below it a retained head stops answering the question the context was supplied to answer, so the ladder stops and reports the shortfall instead of cutting further. |
| Head-only regime | The window-targeted trim's mode under the prose kind: the ladder tightens head lines instead of the anchor window, because there are no anchors for a window to expand. |

### Types

```
RECORD TrimReport:                     # the second half of trimContextFiles' return, widened
  trimmed: Boolean                     # a reduction path RAN, NOT "bytes fell". Today's code
                                       # already sets it true whenever the reduce path runs, and
                                       # the existing stderr note is gated on that meaning.
  bytesBefore: Integer
  bytesAfter: Integer
  reason: Enum{ disabled, under-threshold, no-relevance-model,
                head-fit, head-fit-floored, head-fit-declined, trimmed }   # NEW
  kind: Enum{ unified, prose }                                     # NEW
  hunks: Integer                       # NEW; hunk headers parsed. Always 0 under the prose kind,
                                       # which never parses the diff.
  headLines: Integer | null            # NEW; the adopted head rung on a head-fit reason, else null
  contextBudgetBytes: Integer | null    # NEW; the ceiling less the diff bytes and the brief
                                        # reserve. Null under the unified kind, which has no ceiling.
  filesTotal: Integer                  # NEW

  CONSTRAINT trimmed == true IFF reason is one of { "trimmed", "head-fit", "head-fit-floored" }
  CONSTRAINT kind == "prose" implies hunks == 0
  CONSTRAINT headLines != null IFF reason is one of { "head-fit", "head-fit-floored" }
  CONSTRAINT contextBudgetBytes != null IFF kind == "prose"
  CONSTRAINT reason == "head-fit" implies bytesAfter <= contextBudgetBytes
  CONSTRAINT reason == "head-fit-floored" implies headLines == DEFAULT_PROSE_HEAD_FLOOR
```

```
INTERFACE trimContextFiles(opts) -> { contextFiles, report: TrimReport }
  opts.diffKind: Enum{ "unified", "prose" }          # NEW, default "unified"
  opts.proseCeilingBytes: Integer                    # NEW, default DEFAULT_PROSE_CEILING_BYTES,
                                                     # set by --context-prose-ceiling-bytes
  # every other option unchanged: contextFiles, diff, thresholdBytes, window,
  # minFileBytes, headLines, maxAnchorLines, retainedCeiling

INTERFACE headReduceBundle(contextFiles, headLines, opts) -> Array<ContextFile>
  # NEW export: one rung of head retention over a whole bundle. Implemented as
  # trimOneFile(f.text, [], EMPTY_SET, { ...opts, headLines }) per file, so the small-file
  # protection, the elision marker and the clamped head count are the existing ones, not
  # a second copy. The ONE home for "reduce this bundle to head lines": headFit and
  # tightenToTarget both reach it through here.

INTERFACE headFit({ contextFiles, budgetBytes, opts })
  -> { contextFiles, headLines, bytes, fitted }
  # NEW export: the ladder search over TRIM_HEAD_LADDER against the context budget. Returns the
  # first rung that fits, else the retention floor (TRIM_HEAD_LADDER's last rung) with fitted
  # false. It never descends past the floor. It does not build a TrimReport and does not apply
  # the grew-instead-of-shrank clamp; trimContextFiles owns both.

INTERFACE parseDiffTouched(diff) -> { touchedByPath, identifiers, hunks }
  # hunks is NEW and additive: the number of hunk headers parsed. No existing caller or
  # test deep-equals this return, so widening it is safe.

INTERFACE trimOneFile(text, touchedRanges, identifiers, opts) -> String
  # UNCHANGED in signature, body and output. Not split, not moved.

INTERFACE tightenToTarget(opts) -> { contextFiles, prefix, bytes, contextBytes, window, headLines, mode, fitted }
  opts.diffKind: Enum{ "unified", "prose" }          # NEW, default "unified"
  # headLines and mode are NEW fields; every existing field keeps its meaning
  mode: Enum{ "anchored", "head-only" }
  # window is the adopted rung's anchor window in "anchored" mode and null in "head-only",
  # where no anchor window was applied and reporting one would be a lie.
```

```
CONSTANT TRIM_HEAD_LADDER = [800, 400, 300, 200, 150, 100]   # NEW, frozen. See section 6.
CONSTANT DEFAULT_PROSE_HEAD_FLOOR = 100                      # NEW; the retention floor

  CONSTRAINT length(TRIM_HEAD_LADDER) == length(TRIM_WINDOW_LADDER)
  CONSTRAINT last(TRIM_HEAD_LADDER) == DEFAULT_PROSE_HEAD_FLOOR
  CONSTRAINT DEFAULT_PROSE_HEAD_FLOOR > DEFAULT_TRIM_HEAD_LINES   # the prose ladder never reaches
                                                                  # the 12-line truncation
  CONSTRAINT TRIM_HEAD_LADDER is strictly descending

CONSTANT DEFAULT_PROSE_CEILING_BYTES = 589824              # NEW; 576 KB. See section 6.
CONSTANT PROSE_BRIEF_RESERVE_BYTES =
  round(DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN)   # NEW; 6000 B today, composed from
                                                # the two constants review-call.mjs:2088 already
                                                # reserves the brief with, not a third number.
                                                # Rounded so a future fractional divisor still
                                                # yields an integer byte budget.
```

### Design decisions in the WHAT

**How does the trim learn that its input is not a diff?**

The measurements in the first design principle rule out reading it off the text. The remaining options are a declared kind or a per-caller threshold, and the threshold was already rejected as direction 1.

**Chosen:** a declared kind. `review-call.mjs` takes `--diff-kind unified|prose`, defaulting to `unified`; `trimContextFiles` and `tightenToTarget` take the matching `diffKind` option. An unrecognised value is rejected in `main` with the usage line and `EXIT.USAGE` (2), the pattern `main` already uses for eight other argument faults at `review-call.mjs:1988` onward. It deliberately does **not** mirror `--expect`: `--expect`'s throw comes out of `parseArgs`, escapes `main` uncaught, and the module bootstrap at lines 2228 to 2231 catches it into `EXIT.OTHER` (1). Exit 1 has no row in the spec-review occupant's per-lens outcome table (`faffter-dark-spec-review/SKILL.md` lines 138 to 142 map 0, 5/12 and 6/2/4/7 and nothing else), so a typo would hand that occupant a lens result it has no rule for. Exit 2 is already mapped there to `unavailable`, kind `config-fault`, so the caller sees a named outcome and the gate fails safe. `--expect`'s exit-1 hole is pre-existing, is not fixed here, and this flag simply does not join it. Silent coercion to the default is the option ruled out: it would hand a prose caller today's 96% loss with no signal. An older copy of `review-call.mjs` ignores an unknown flag, so a mixed checkout degrades to today's behaviour rather than failing.

**What does the prose kind do instead of anchoring?**

**Chosen:** nothing below the prose ceiling, and a head fit down to the context budget above it, stopping at a retention floor of 100 lines rather than at today's 12. The caller supplied those files deliberately and there is no relevance signal to apply, so whole-file retention is what it asked for; the ceiling bounds what that costs. The ceiling is a constant, not a declared window, so the reduction is reachable on a configuration where no backend declares `context_window` at all: `spark-glimmer` in this repository's own `.faffrc.yaml` declares none. Head retention rather than dropping whole files, because an elided file body still carries `elisionMarker`'s in-payload sentinel, so the model can see it is reading a cut file; a dropped file is invisible to the model, and a reviewer reasoning confidently about a file it does not know is missing is the failure FAFF-915's whole-file context rule was written to prevent.

**What does the window-targeted trim do under the prose kind?**

Without a change here the ladder is inert in this regime: every rung varies `window`, `trimOneFile`'s unanchored branch ignores `window` entirely, so all six rungs return the same bytes and `tightenToTarget` reports that no rung shrank anything. A genuinely over-window prose payload would then reach the per-backend guard, skip the primary, and possibly exhaust the chain.

**Chosen:** under the prose kind the ladder tightens head lines over `TRIM_HEAD_LADDER` through `headReduceBundle`, and reports `mode: "head-only"`. The two budgets compose in order rather than competing: the byte-gated pass bounds the bundle at the ceiling with no declaration needed, then the window pass tightens further when a declared window is narrower than the ceiling leaves room for. On a wide declared window the ceiling binds first and the head-only ladder never fires, which is the correct outcome and not a reachability hole.

The retention floor applies here too, and that is a deliberate consequence worth naming. A narrow declared window (a 32K backend, say) can leave a target no rung reaches, where today's anchored ladder would have bottomed out at a 12-line head and fitted. Under the prose kind it does not fit, `tightenToTarget` returns `fitted: false`, `main` writes its existing `STILL OVER the usable window` suffix, and the per-backend guard skips that backend with `PRIMARY_SKIP_SIGNAL`. That is the better outcome: a 12-line-per-file payload is the truncation this ticket exists to stop, so shipping one to fit a narrow window buys a review that cannot find anything, where a skip falls through to a backend that can. No new mechanism is added for it; all three parts already exist.

## 4. HOW

### How the pieces connect

```
main
 |
 |-- trimContextFiles(diffKind)                   <-- byte-gated pass, FAFF-915
 |     |-- thresholdBytes <= 0 --> identity, "disabled"                 [unchanged]
 |     |-- kind "prose" --> no diff parse, no anchors                   [NEW]
 |     |     |-- budget := ceiling - diffBytes - briefReserve
 |     |     |-- bytes <= budget --> identity, "no-relevance-model"
 |     |     |-- else headFit down to the budget   --> "head-fit"
 |     |                                     floor  --> "head-fit-floored"
 |     |                                   no gain  --> "head-fit-declined"
 |     |-- kind "unified" --> today's byte gate + anchored reduction    [unchanged]
 |           |-- plus an advisory note when report.hunks == 0           [NEW]
 |
 |-- assembleUserMessage
 |
 |-- if the primary declares a context_window and the estimate overflows it:
       tightenToTarget(contextFilesRaw, diff, target, diffKind)  <-- window pass, FAFF-1039
         |-- kind "unified" --> mode "anchored", TRIM_WINDOW_LADDER     [unchanged]
         |-- kind "prose"   --> mode "head-only", TRIM_HEAD_LADDER      [NEW]
```

### Behaviour summary

`trimContextFiles` is told what kind of input it was handed. Under `unified` it behaves exactly as it does today. Under `prose` it never parses the diff, returns its input untouched below the context budget, and head-fits down to that budget above it, stopping at the retention floor.

```
PROCEDURE trim_context_files(contextFiles, diff, thresholdBytes, diffKind, opts):
  1. bytesBefore := sum of utf8 byte length of each file's text
  2. IF thresholdBytes <= 0:
     a. Return identity, { trimmed: false, reason: "disabled", kind: diffKind, hunks: 0,
        headLines: null, filesTotal, bytesBefore, bytesAfter: bytesBefore }
  3. IF diffKind == "prose":
     a. budget := opts.proseCeilingBytes - utf8ByteLength(diff) - PROSE_BRIEF_RESERVE_BYTES
     b. IF bytesBefore <= budget:
          Return identity, { trimmed: false, reason: "no-relevance-model", hunks: 0,
             contextBudgetBytes: budget, ... }
     c. fit := head_fit(contextFiles, budget, opts)
     d. IF fit.bytes >= bytesBefore:
          Return identity, { trimmed: false, reason: "head-fit-declined", hunks: 0,
             headLines: null, bytesAfter: bytesBefore, contextBudgetBytes: budget, ... }
     e. Return fit.contextFiles, { trimmed: true, hunks: 0,
          reason: fit.fitted ? "head-fit" : "head-fit-floored",
          headLines: fit.headLines, bytesAfter: fit.bytes, contextBudgetBytes: budget, ... }
  4. IF bytesBefore <= thresholdBytes:
     a. Return identity, { trimmed: false, reason: "under-threshold", hunks: 0, ... }
  5. { touchedByPath, identifiers, hunks } := parse_diff_touched(diff)
  6. FOR each file f:
     a. ranges := every range from touchedByPath whose path pathsMatch(f.path)
     b. out[f] := trim_one_file(f.text, ranges, identifiers, opts)
  7. Return out, { trimmed: true, reason: "trimmed", hunks, headLines: null, ... }

PROCEDURE head_reduce_bundle(contextFiles, headLines, opts):
  1. Return contextFiles.map(f => { path: f.path,
       text: trim_one_file(f.text, [], EMPTY_SET, { ...opts, headLines }) })

PROCEDURE head_fit(contextFiles, budgetBytes, opts):
  1. FOR h in TRIM_HEAD_LADDER:
     a. out := head_reduce_bundle(contextFiles, h, opts)
     b. bytes := sum of utf8 byte length of out
     c. IF bytes <= budgetBytes:
          Return { contextFiles: out, headLines: h, bytes, fitted: true }
  2. Return { contextFiles: out, bytes,                  # the last iteration's, i.e. the floor rung
              headLines: DEFAULT_PROSE_HEAD_FLOOR, fitted: false }
```

`head_fit` step 1c takes the first rung that fits, so the most retention that meets the budget wins. When no rung fits it adopts the floor rung outright rather than the smallest bundle it saw, which is deliberate: a tracked minimum is not guaranteed to be the floor, because bundle bytes are not monotone in `h` at one boundary (below). Adopting the floor is what makes `reason == "head-fit-floored" implies headLines == DEFAULT_PROSE_HEAD_FLOOR` true by construction, and the grew-instead-of-shrank clamp at step 3d is what protects the case where the floor rung is the larger one.

Step 3d of `trim_context_files` is the same clamp `main` already applies around `tightenToTarget`, for the same measured reason: on a file whose lines are shorter than an elision marker, every rung pays more in markers than it saves, so a reduction can be larger than its input. Returning a bigger bundle while reporting a reduction is the one outcome worth a distinct reason. It is checked before the floored case, so a bundle that both grew and missed the budget keeps its original bytes.

Step 3a can go non-positive: a `--diff` document larger than the whole ceiling leaves no budget for context at all. The trim cannot reduce the diff, which under this kind is the spec itself, so head fit runs straight to the floor and reports `head-fit-floored` with a non-positive `contextBudgetBytes`. Only the caller can shorten a spec, and the note says so.

`parseDiffTouched` gains a `hunks` counter incremented where the hunk-header regex already matches, and nothing else about it changes. `trimOneFile` is not touched at all.

```
PROCEDURE tighten_to_target(contextFiles, diff, targetBytes, diffKind, assembleFn):
  1. diffBytes := utf8 byte length of diff
  2. mode := "head-only" IF diffKind == "prose" ELSE "anchored"
  3. best := null
  4. FOR rung index i from 0 to length(TRIM_WINDOW_LADDER) - 1:
     a. IF mode == "anchored":
          trimmed := trim_context_files(contextFiles, diff, thresholdBytes: 1,
                      diffKind: "unified", window: TRIM_WINDOW_LADDER[i]).contextFiles
          rungWindow := TRIM_WINDOW_LADDER[i]; rungHead := DEFAULT_TRIM_HEAD_LINES
        ELSE:
          trimmed := head_reduce_bundle(contextFiles, TRIM_HEAD_LADDER[i], defaults)
          rungWindow := null; rungHead := TRIM_HEAD_LADDER[i]
     b. prefix := assembleFn(trimmed, diff); bytes := utf8 length of prefix
     c. contextBytes := bytes - diffBytes
     d. IF targetBytes is null OR contextBytes <= targetBytes:
          Return { trimmed, prefix, bytes, contextBytes, window: rungWindow,
                   headLines: rungHead, mode, fitted: true }
     e. IF best is null OR bytes < best.bytes: best := this rung's result
  5. Return { ...best, mode, fitted: false }
```

The first-fit rule, the minimum-across-rungs rule and the returned field names are unchanged; the head-only regime only changes which knob each rung moves.

First fit is sound in the head-only regime, and the argument is short. For a file of `L` lines, `headReduce` returns the whole file when `h >= L` and `h` kept lines plus exactly one marker when `h < L`, so across the rungs below `L` bytes rise with `h` and the first rung that fits is the largest rung that fits. The one non-monotone step is the boundary where a rung first exceeds `L`: the whole file can be *smaller* than the rung below it by the marker's length, on a file whose last lines are shorter than a marker. That does not break first fit, which only ever adopts a rung it has measured against the budget. It is why `head_fit` adopts the floor rung by name rather than a tracked minimum, and why the minimum tracking stays here: the anchored regime genuinely needs it (`review-call.mjs:282` records that a smaller anchor window does not always yield a smaller prefix), and a second code path for the same search is how the two drift.

### The operator-facing notes

At the byte-gated call site the existing note fires only on `reason == "trimmed"` and keeps its exact current wording. Five notes are added, one per new reason plus the advisory:

```
reason "trimmed" AND report.hunks == 0, in addition to the existing note:
[note] FAFF-1051 the --diff parsed as 0 unified-diff hunks, so the reduction above is head
truncation, not relevance; if this input is not a unified diff, pass --diff-kind prose

reason "no-relevance-model":
[note] FAFF-1051 --diff-kind prose: no diff-relevance model applies; all <filesTotal> context
files supplied intact (<bytesBefore> B, under the <contextBudgetBytes> B context budget =
<ceiling> B ceiling - <diffBytes> B diff - <PROSE_BRIEF_RESERVE_BYTES> B brief reserve)

reason "head-fit":
[note] FAFF-1051 --diff-kind prose: <bytesBefore> → <bytesAfter> context bytes, head-reduced to
<headLines> lines per file against the <contextBudgetBytes> B context budget

reason "head-fit-floored":
[note] FAFF-1051 --diff-kind prose: <bytesBefore> → <bytesAfter> context bytes at the
<headLines>-line retention floor, still <bytesAfter - contextBudgetBytes> B over the
<contextBudgetBytes> B context budget; the ladder does not cut below the floor. Reduce the
--context set, shorten the --diff document, or declare context_window on the backend.

reason "head-fit-declined":
[note] FAFF-1051 --diff-kind prose: <bytesBefore> B is over the <contextBudgetBytes> B context
budget but no head rung was smaller, KEEPING the untrimmed context
```

At the window-targeted call site the note reports the rung by mode: `tightened to trim-window <window>` in the anchored regime exactly as today, and `tightened to head-lines <headLines>` in the head-only regime. Nothing else about that note changes, including the `STILL OVER the usable window` suffix and the `clamped to floor` suffix.

### The caller edits

Two skills pass a document as `--diff`, across three places that assemble an invocation:

| Call site | Edit |
|---|---|
| `build-lens-requests.mjs` line 43 | Push `--diff-kind prose` beside the existing `--diff`. Its header comment's "byte-identical to the old argv" claim is updated to name the one added pair. |
| `faffter-dark-spec-review/SKILL.md` lines 108, 120, 124 | The argv listings gain the flag, so the prose and the helper agree. |
| `faff-prep/SKILL.md` lines 210, 211 | The spec-judge's two calls gain the flag. Prose only, no code: those calls are assembled in SKILL.md, not by a helper. |

`code_review` in `faffter-dark-adversarial-review/SKILL.md` is deliberately not edited. Its absence of a `--diff-kind` is what makes the unified default the regression boundary rather than a convention.

### The transcript change

`plugin/skills/faffter-dark-spec-review/SKILL.md` line 161 writes only a served lens's stdout to `$pin_dir/round-<n>-<lens>.md`, so the trim notes do not reach that file. They are not lost everywhere: `fan-out.mjs` returns each lens's `stderr`, and past rounds persisted it by other routes, so `.faff/spec-review/FAFF-931/results.json` carries `context trim: 582007 → 8446` and `.faff/spec-review/FAFF-360/round-7-architectural.md` line 7 carries the FAFF-915 note inside the transcript itself. What is missing is a rule making it reliable. Add a rule to the per-lens transcript section requiring each served lens's `LensResult.stderr` to be written into the same transcript under its own heading, after the stdout body, so a later trim-ratio consumer has one place to read rather than three shapes to guess between.

### Edge cases

- **`--context-trim-bytes 0`.** Returns identity with `reason: "disabled"` at step 2, before the kind is consulted, under both kinds. The operator asked the byte-gated pass not to reduce and that answer outranks the ceiling. The window-targeted pass still runs and still reduces, per the override already documented at `review-call.mjs:1442`.
- **A deletion-only or rename-only unified diff.** Unchanged from today: a deletion-only diff still anchors through the identifiers its removed lines name, and a rename-only diff parses no hunks, so its bundle is head-reduced at 12 lines exactly as now. The new advisory note fires on the rename-only case, correctly: that reduction is truncation. Improving it is not this ticket, and nothing here makes it worse.
- **One unanchored file inside an otherwise anchored unified bundle.** Unchanged: that file is head-reduced at 12 lines, which is part of what FAFF-915 buys.
- **A prose bundle whose files are all below `minFileBytes`.** Every rung returns them untouched, so no rung beats `bytesBefore`, the clamp at step 3d of `trim_context_files` fires, and the context passes through whole with `reason: "head-fit-declined"`. The 5 MB `checkPayloadSize` preflight and the per-backend guard handle any residual, unchanged.
- **A file shorter than the rung's head lines.** `headReduce` returns it whole with no marker, so an early rung can leave a small file identical to its input while reducing a large one. This is also the one place bundle bytes are not monotone in the rung: the whole file can be smaller than the next rung down by a marker's length, on a file whose trailing lines are shorter than a marker. Neither search is harmed, because each only ever adopts a rung it measured, and `head_fit` names the floor rung rather than inferring it from a minimum.
- **An unrecognised `--diff-kind` value.** `main` writes the usage line and returns `EXIT.USAGE` (2), which the spec-review occupant's per-lens outcome table maps to `unavailable`, kind `config-fault`. It does not throw, because a throw lands on exit 1, which that table does not map.
- **A `--diff` document larger than the whole prose ceiling.** The context budget goes non-positive, no rung can fit it, and the bundle lands at the retention floor with `reason: "head-fit-floored"`. The trim never reduces the `--diff` argument, which under this kind is the spec itself, so this is a caller-side problem and the note says which lever to pull.
- **A payload over the backend's hard request cap.** Over-length is a **rejection, not a truncation**: the measured primary refuses a request above 262144 tokens outright rather than cutting it, so there is nothing to degrade and the request errors. Four bounds stand between the trim and that error, and the two exact ones both need a declared `context_window`: `checkPayloadSize`'s 5 MB preflight (far above any real cap, so it catches only runaway inputs), the prose ceiling added here (unconditional but coarse), the window pass (exact, given a declaration), and the per-backend guard in `runReviewChain` (exact, given a declaration; it skips a backend whose window the prefix exceeds and raises `PRIMARY_SKIP_SIGNAL`). A rejection that still gets through is an HTTP error on that backend, classified by the transport's existing status mapping and followed by a chain advance, which is unchanged behaviour for a backend that refuses a request.
- **An elided prose file carries a `FAFF-915 relevance trim` marker.** `elisionMarker` writes `... <n> line(s) elided (FAFF-915 relevance trim) ...`, and the prose path emits that text although no relevance model ran, so the in-payload marker attributes the cut to something that did not happen. The text is deliberately left alone: it is a fixed sentinel the survival oracle and the golden tests key on, and its guarantee, that it can never equal a real source line, holds only while it is fixed. The stderr note is where the prose reduction is described accurately; the marker's job in the payload is the narrower one of announcing that a cut happened at all.

### Failure modes

- **A prose caller forgets the flag.** It silently gets today's 96% loss, which is the failure this ticket exists to fix, reappearing by omission. How you would know: the advisory note on stderr, which fires precisely when a reduction ran over a zero-hunk parse. That is the one thing text inspection can honestly say, so it is emitted as an observation rather than used as a gate. What it means: add the declaration at that call site. The known prose callers are declared here and the assumption below records how to check for another.
- **The ceiling is a judgement calibrated on one machine.** Too high and a prose payload still overruns an undeclared backend's real cap; too low and the change under-delivers the context it exists to supply. How you would know: too high shows as a primary that errors or times out, surfaced by `PRIMARY_SKIP_SIGNAL` or a served-backend header naming `chain[i]` for `i > 0`; too low shows as a `head-fit` note on a bundle the operator expected to pass intact, and the extreme case shows as `head-fit-floored`, which names the shortfall in bytes. What it means: retune the one constant, or declare `context_window` on the backend, which is the exact bound and the one the ceiling is only standing in for. The operator most at risk is the one on a small backend, because a ceiling sized for a 262K machine is several times a 32K window; that operator is served by the window pass rather than by this constant, which is why the ceiling sits near the top of what a large backend accepts rather than near the middle of what a small one does.
- **The benefit may not exist, and there is already one datum against it.** The claim that a refuter given intact files finds stale-reuse defects is unvalidated. All five FAFF-996 objections came from an agent with full tool access reading the tree, not from a single-shot model reading a supplied bundle; a single-shot refuter may still miss `spec-judge-casefile.js:609` with the whole file in front of it.

  The partial answer already in hand cuts against the premise. Round 2 of this spec's own review ran with the trim off and 100% of the bundle supplied: 365481 bytes of context plus the 46775-byte spec, roughly 137K tokens, no `FAFF-915` note on any lens's stderr. The four lenses still produced objections that were almost entirely spec-internal, and every tree-grounded finding in that round came from a separate verification pass rather than from a refuter. That is one round, on one spec, with one backend, so it is evidence rather than a result, but it is the same shape the ticket describes for FAFF-996 and it points at the lens briefs rather than at the trim.

  How you would know: re-run the FAFF-996 round-2 spec through spec-review after this lands and count how many of the five named defects any lens raises, reading the result as confirming or overturning that partial answer rather than as opening the question. What it means: a null result is a valid outcome and does not invalidate the change, because supplying 4% of the context was wrong regardless; it would redirect the next ticket at the lens briefs. The re-run has an owner, named in section 6 and filed as a DONE item, so it does not sit here unowned.

### Anti-patterns

**Anti-pattern:** redefining `trimmed` to mean "bytes actually fell". Why: the existing code sets it whenever the reduce path runs, and the existing stderr note plus every test reading it are gated on that meaning. The report's `bytesBefore`/`bytesAfter` already answer the bytes question; changing `trimmed` would silently change which runs emit the FAFF-915 note.

**Anti-pattern:** deriving the kind from the diff text as a fallback when the flag is absent. Why: it is the inference the first design principle rules out on measured evidence, and a fallback is the same inference with a quieter name.

**Anti-pattern:** letting the window ladder tighten `headLines` in the anchored regime. Why: today every rung there runs at `DEFAULT_TRIM_HEAD_LINES`; pairing a 400-line head onto rung 0 would enlarge head-reduced files and change the payload `code_review` sends.

**Anti-pattern:** writing a second head-reduction loop inside `tightenToTarget` instead of calling `headReduceBundle`. Why: the second copy would have to restate the small-file protection and the marker emission, and the two would drift on the next change to either.

**Anti-pattern:** making any part of the trim depend on the lens, the round, the wall clock or which backend is about to serve. Why: the four spec-review lenses share one byte-identical prefix by construction (`review-call.mjs:2148`, FAFF-903), and the measured prefix-cache hit on that prefix is worth about 19x (a 6.4K-token document: 3.09s cold, 0.31s warm). The cache matches on exact prefix, so one differing byte early throws away every hit after it. A per-lens trim would lose that silently: the review still returns, the findings still parse, and nothing in the suite gets slower by a number anyone reads. The purity invariant in section 5 is the guard, and the argv-identity DONE item is what makes it decidable.

**Anti-pattern:** changing `elisionMarker`'s text to mention the prose kind. Why: the marker is a fixed sentinel the survival oracle and the golden tests key on, and it can never equal a real source line only because it is fixed. The cost is that a head-fitted prose payload carries a `FAFF-915 relevance trim` attribution for a cut no relevance model made; that wart is accepted and recorded in the edge cases.

**Anti-pattern:** naming a tracker ID in either edited `SKILL.md`. Why: `faff lint-refs` enforces `docs/guide/` and `plugin/skills/*/SKILL.md` against tracker refs and would fail the build. The stderr note text inside `review-call.mjs` is not skill prose and follows the existing `FAFF-915` / `FAFF-1039` convention there.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a context bundle above the 48 KB byte threshold and under the context budget
  and --diff-kind prose
When the byte-gated trim runs
Then every context file is returned byte-identical to its input
  and the report carries reason "no-relevance-model", kind "prose" and hunks 0
  and report.contextBudgetBytes equals the ceiling less the diff bytes less the brief reserve
  and stderr carries the intact note naming the file count, the byte count and the budget
```

```
Given a context bundle above the context budget, with files long enough to head-reduce smaller
  and --diff-kind prose
When the byte-gated trim runs
Then the report carries reason "head-fit" and a headLines value drawn from TRIM_HEAD_LADDER
  and bytesAfter is at or below report.contextBudgetBytes
  and each file the rung actually shortened carries exactly one elision marker
```

```
Given a context bundle still above the context budget at the retention floor
  and --diff-kind prose
When the byte-gated trim runs
Then the report carries reason "head-fit-floored" and headLines equal to DEFAULT_PROSE_HEAD_FLOOR
  and no file is reduced below DEFAULT_PROSE_HEAD_FLOOR lines
  and stderr names the residual bytes over budget and the three levers that close it
```

```
Given a context bundle above the 48 KB byte threshold
  and a real unified diff touching one of those files, with no --diff-kind passed
When the byte-gated trim runs
Then the output reproduces the committed baseline goldens byte for byte
  and the report carries reason "trimmed" and kind "unified"
  and the existing FAFF-915 note is emitted with its current wording
```

```
Given a deletion-only unified diff whose removed lines name identifiers
  and a context bundle above the byte threshold, with no --diff-kind passed
When the byte-gated trim runs
Then the output reproduces the committed baseline golden for that case byte for byte
  and that golden was generated from the merge-base module, which the suite has no
      deletion-only fixture for today
```

- The trimmed context for a given (contextFiles, diff, kind, options) MUST stay a pure function of those inputs, so the four spec-review lenses keep a byte-identical shared prefix. The stake is measured: the prefix cache matches on exact prefix, and a hit on it is worth about 19x (3.09s cold against 0.31s warm on a 6.4K-token document), so one lens-dependent byte early in the prefix costs lenses 2 to 4 their entire prefill. FAFF-903 arranged that prefix at `review-call.mjs:2148`; this invariant is what keeps it.
- No diff-touched line MUST be dropped by any path added or changed here.
- A `--diff-kind unified` call MUST send the same payload bytes as the pre-change code for every input, the advisory stderr line excepted.

## 6. Design decision rationale

**Which of the ticket's three directions?**

- Consumer-aware threshold: the smallest change, but it tunes a policy number per caller while leaving the trim guessing what its input is, and `--context-trim-bytes 0` would also switch off the size protection the byte gate legitimately provides.
- Anchor-yield gate: attractive, and it was the first draft of this spec. It fails on a deletion-only diff, where `addRange` fires on no line and the removed lines' identifiers name nothing present in the post-change file, so the yield is zero on a real diff and `code_review` would ship the whole bundle. Measured: that diff against a 125779-byte context file reports `{"trimmed":true,"bytesBefore":125779,"bytesAfter":369}` today, so the gate would have turned a 369-byte payload into a 125779-byte one on a pure dead-code removal, and into megabytes on a multi-file deletion.
- Trim-ratio signal: useful, but it reports the damage rather than preventing it, and gating on it widens a contract.

**Chosen:** a declared input kind, which is none of the three as stated but is what survives the objections to all three. The trim-ratio signal is kept in reduced form, as the transcript persistence plus the zero-hunk advisory, so a later ticket can consume both without re-deriving anything.

**Amending the "repair the predicate, not the caller" principle.**

The first draft of this spec held that a consumer-aware fix leaves the predicate broken for the next non-diff caller, which is still true and is why direction 1 is still rejected. What the draft got wrong is that the predicate it proposed was itself uncomputable. A predicate over the diff text cannot separate a document that quotes a hunk from a diff, nor a real diff that anchors nothing from a document, and both mistakes are live: the first is a routine shape for a spec about a code change, the second is a routine shape for a dead-code removal.

**Chosen:** the principle becomes "repair the model, and let the caller state the one fact the model cannot derive". The caller declares what it is passing; the trim decides everything else. That keeps the property the original principle was protecting, which is that no caller tunes the trim's numbers, while dropping the claim the evidence does not support.

**Head retention or whole-file dropping in the prose path?**

Dropping whole files keeps the survivors complete, which suits the stale-reuse defect class better, since a helper's definition can sit anywhere in a file and a 100-line head often misses it. It was rejected anyway: a dropped file is invisible in the payload, so the model cannot tell it is reasoning without it, while an elided body carries `elisionMarker` in place and announces the cut. FAFF-915's own `--context` rule exists because a model with a partial view produced confident false criticals, and an invisible omission is the most partial view there is.

**Chosen:** head retention over a descending ladder, with whole-file dropping left unbuilt.

**The head ladder's rung values, and where it stops.**

Round 2's standing objection: the previous ladder ended at `DEFAULT_TRIM_HEAD_LINES`, so a large prose bundle could land at exactly today's 12-line cut. That is the truncation the ticket exists to stop, arriving by a different route, and it arrived precisely in the large-bundle case the ceiling was supposed to bound.

The objection is right and the floor moves. Twelve lines of a source file is its licence header and its first import. The defect class the ticket names is stale reuse, which asks whether a helper already exists in a file; 100 lines carries a module's imports, its exported surface and its first function or two, which is the read that question needs. So `DEFAULT_PROSE_HEAD_FLOOR = 100` is a named constant with a constraint asserting it is strictly above `DEFAULT_TRIM_HEAD_LINES`, and the prose ladder never reaches the unified path's floor.

Stopping means a bundle can still be over budget at the floor. That residual is bounded in practice rather than in principle: a 100-line head lands at roughly 4 KB, so the floor meets a 576 KB ceiling for any bundle under about 140 files, and the spec-review occupant supplies the files a spec names (this spec names seven). A bundle that misses the budget at the floor is pathological, and the honest answer there is `head-fit-floored` plus a note naming the shortfall, not a quieter cut that buys nothing.

The rung values `[800, 400, 300, 200, 150, 100]` are a judgement, not a measurement. The shape is coarse at the top and fine near the floor: most bundles fit on the first rung, so the early steps should be cheap to skip, while near the floor a fine step avoids cutting 50 lines more than the budget asked for. The ladder keeps `TRIM_WINDOW_LADDER`'s length so the head-only regime indexes the same rung count. There is still no review-bench measurement of how many head lines a refuter actually needs; FAFF-904's bench pass is where these get retuned, which is why they are named constants beside the existing ones rather than inline numbers.

**Chosen:** `[800, 400, 300, 200, 150, 100]`, frozen, same length as `TRIM_WINDOW_LADDER`, ending at `DEFAULT_PROSE_HEAD_FLOOR = 100`. No rung reaches `DEFAULT_TRIM_HEAD_LINES`. A bundle still over budget at the floor adopts the floor, reports `head-fit-floored`, and says so on stderr.

**What does the ceiling measure?**

Round 2 found that the ceiling compared itself to the summed context bytes only. The `--diff` document is never bounded by it, and neither is the per-lens brief. What a backend rejects is the whole request, so a ceiling that bounds one component is not bounding the thing that fails.

**Chosen:** the ceiling is a prompt-side budget over the whole request, and head fit measures the context files against what is left of it. `trimContextFiles` already receives the `--diff` text, so it subtracts those bytes exactly; the lens brief is not in scope of that call, so it is covered by `PROSE_BRIEF_RESERVE_BYTES`, composed from `DEFAULT_BRIEF_RESERVE_TOKENS` and `DEFAULT_BYTES_PER_TOKEN`, the two constants `main` already reserves the brief with at `review-call.mjs:2088`, rather than a third number. A fixed reserve rather than the real brief is the same deliberate choice FAFF-1039 records there: measuring the actual per-lens brief would make the trimmed prefix differ per lens, which is exactly what the purity invariant forbids and what the 19x prefix-cache figure prices.

**The prose ceiling's value, and why the prose path needs a budget of its own at all.**

The window-targeted trim cannot be the prose path's only budget, because it lives entirely inside `if (primaryWindow)` at `review-call.mjs:2084` and `primaryWindow` is `chain[0].contextWindow`, which is null whenever no backend declares `context_window`. That is the default configuration, and the gap is easy to miss here precisely because this repository declares a window on most of its own backends: `spark-glimmer` in `.faffrc.yaml` declares none, so the undeclared path is live even here. With no window declared and no ceiling, an unreduced prose bundle would meet nothing between the trim and the 5 MB `checkPayloadSize` refusal, so the measured 301506-byte case would ship where 12935 bytes ship today, with no bound at all on a larger one.

Round 2 set it at `393216`, justified as half the smallest window this repository's `.faffrc.yaml` declares. That derivation reads a config value, the config value is one operator's, and the number cuts far too early: the round-2 review's own bundle was 365481 bytes of context, 93% of a ceiling that was measuring only the context.

The operator's measured sweep of `spark-qwen-3-8` (recorded as a context comment on FAFF-1051) gives three facts that set the altitude. They are one machine's, and they are read here as the shape of a curve.

| Measured fact | What it bounds |
|---|---|
| Prefill dominates and is superlinear: 128K tokens costs 122.31s TTFT, 247K costs 353.05s, so the last measured doubling costs 2.89x for 1.93x the tokens while attention share goes 48% to 64% | the ceiling belongs below the doubling where cost stops tracking size |
| One full-length request holds a quarter of the 1048576-token pool for about six minutes and evicts a large share of the prefix cache, degrading every other request's hit rate while it runs | the ceiling belongs well below the hard cap, because that eviction costs the run the 19x prefix hit this transport is built around |
| The hard cap is 262144 tokens, prompt plus completion, and an over-length request is rejected rather than truncated | the ceiling plus the configured completion cap must leave real slack, not sit on the edge |

`589824` is 576 KB, 196608 tokens at the module's conservative 3.0 bytes-per-token divisor, which over-estimates. Checked against those three bounds on the measured machine: with `adversarial.spec_review.max_tokens` at 15000 the whole request estimates at 211608 of the 262144 cap, 19% clear of rejection; and it sits inside the 128K-to-247K step rather than at its top, so it stays short of both the 2.89x multiplier and the six-minute pool occupancy.

Checked against real usage, measuring the whole payload the way the ceiling now does:

| | bytes | tokens at 3.0 | % of the new ceiling |
|---|---|---|---|
| Round-2 bundle (365481 context + 46775 spec + 6000 reserve) | 418256 | 139419 | 71% |
| The same plus a second file the size of `review-call.mjs` (148900 B) | 567156 | 189052 | 96% |
| The ceiling | 589824 | 196608 | 100% |

The bundle that sat at 93% of the round-2 ceiling now sits at 71% of a stricter one, and the extra file that used to tip it onto the ladder no longer does. The second row is the honest limit of the headroom: the ceiling is a backstop, not room to grow into.

None of this makes the ceiling a substitute for a declared window. An operator on a 32K backend is served by the window pass, which knows the real number; the ceiling's only job is to bound the configuration where nothing else does. That is why it sits near the top of what a large backend accepts rather than near the middle of what a small one does: a ceiling low enough to protect a 32K backend would cut every bundle on a 262K one, while the operator who has the small backend closes the gap exactly with one line of `context_window`.

**Chosen:** `DEFAULT_PROSE_CEILING_BYTES = 589824`, a named constant with a `proseCeilingBytes` option and a `--context-prose-ceiling-bytes` flag carrying the same test-only-escape-hatch comment `--max-payload-bytes` carries, so `main`'s prose notes are testable without a 576 KB fixture. Retuned in one place when a bench pass gives a better number.

**What does this change do about the hard request cap?**

Over-length is a rejection, not a truncation: the measured primary refuses a request above 262144 tokens outright (`allow_auto_truncate=False`) rather than cutting it to fit. There is nothing to degrade, so the failure is an error rather than a worse review, and the previous draft did not mention it anywhere.

**Chosen:** the transport does not try to learn a backend's hard cap. `context_window` is the declaration for it, and a backend that declares one is bounded exactly by the window pass; nothing in this spec depends on that declaration existing. The prose ceiling bounds the undeclared configuration coarsely, `head-fit-floored` names the residual in bytes and the three levers that close it, and a rejection that still happens surfaces as an HTTP error on that backend followed by a chain advance, which is unchanged behaviour. The cap is written into the edge cases so the next reader of this path does not have to rediscover that the failure mode is an error rather than a cut.

**What oracle makes "byte-identical to the pre-change function" checkable?**

Two DONE items assert the unified path is byte-identical to the code before this change. Round 2's QA lens is right that this names no oracle a test can call: once the change lands the pre-change function is gone, and the suite has no deletion-only fixture to compare against either, which is the case round 1's blocking finding turned on.

**Chosen:** golden files generated from the parent commit's module before the module is edited. `test/fixtures/trim-baseline/` holds one golden per case plus `regenerate.mjs`, which takes a path to a `review-call.mjs` copy, runs the fixture set through that copy's `trimContextFiles` and `tightenToTarget`, and writes the outputs. The build's first step writes `git show <merge-base>:plugin/skills/faffter-dark-adversarial-review/review-call.mjs` to a temp path, points `regenerate.mjs` at it, and commits the goldens; the test then asserts the post-change module reproduces those bytes. The fixture set is the existing unified cases plus a deletion-only diff the suite does not have today.

**Widening the report, or a separate return value?**

**Chosen:** widen `TrimReport` with `reason`, `kind`, `hunks`, `headLines`, `contextBudgetBytes` and `filesTotal`. The report already exists, has exactly one consumer (`main`), and the added fields are additive, so every existing read of `report.trimmed` keeps working. `trimmed` keeps the meaning the code already gives it, which is that a reduction path ran.

**Should DONE gate on a refuter actually finding a stale-reuse defect?**

The ticket's third acceptance criterion asks for a defect of the FAFF-996 shape to be findable by a refuter lens. That is a property of a model's output on one prompt, not of this code: it is not reproducible run to run, it cannot fail a build honestly, and writing it as a checkbox would invite a build agent to claim it by assertion.

Round 2 judged the refusal honest but ownerless: the re-run sat in the failure modes with no ticket and no trigger, and an honest refusal with an unowned measurement behind it tends to become a permanent one.

**Chosen:** leave it deliberately unvalidated by DONE, say so in DONE rather than quietly omitting it, and give the re-run a named owner. A DONE item requires a follow-up tracker issue to exist before this one closes, titled "Measure whether a refuter given intact context finds the FAFF-996 defect class", related to FAFF-1051, carrying the procedure (re-run the FAFF-996 round-2 spec through spec-review, count how many of the five named defects any lens raises), the trigger (this change landing on the default branch), and the defined null outcome (no defect raised redirects the next ticket at the lens briefs, not at the trim). The round-2 datum recorded in the failure modes is the partial answer that follow-up either confirms or overturns.

## 7. Open questions and assumptions

### Open questions

None. Every decision above carries a `**Chosen:**`.

### Assumptions

**Assumes:** the callers named in section 4 are every caller that passes a non-diff document as `--diff`. Validate before building with both greps, in this order:

```
grep -rn -e '--diff' plugin/skills/
grep -rln 'review-call.mjs' plugin/skills/
```

Then read every hit and decide what that call's `--diff` argument actually is.

The trailing space matters and is the reason this is spelled out. The round-2 draft gave `grep -rn -- "--diff " plugin/skills/`, which structurally cannot match `faff-prep/SKILL.md` lines 210 and 211, where the flag is written backticked inside a sentence ("the spec snapshot as `--diff`") rather than on a shell line. That is how the round-1 draft missed faff-prep, and shipping the trailing-space form as the verification step reproduces the miss. The form above has no trailing space, uses `-e` so the pattern is not read as an option, and matches `--diff-kind` too, which is a harmless superset.

At the time of writing the two greps turn up `faffter-dark-adversarial-review/SKILL.md` line 233 (a real `git diff`, correctly left on the unified default), `faffter-dark-spec-review` (declared prose here), and `faff-prep/SKILL.md` lines 210 and 211 (declared prose here). A fourth prose caller found during the build gets the same one-line declaration and a DONE item; it does not change the design.

## 8. DONE

### From WHY

- [ ] A `trimContextFiles` call with `diffKind: "prose"`, a bundle over the 48 KB byte threshold and under the context budget, returns the input array and `report.bytesAfter == report.bytesBefore`.
- [ ] `test/fixtures/trim-baseline/` exists, holding one golden output file per baseline case plus `regenerate.mjs`, which takes a path to a `review-call.mjs` copy and writes that copy's `trimContextFiles` and `tightenToTarget` outputs for the fixture set. The goldens are generated by pointing it at `git show <merge-base>:plugin/skills/faffter-dark-adversarial-review/review-call.mjs` and are committed **before** the module is edited, so the baseline is the pre-change function rather than a claim about it.
- [ ] The baseline fixture set includes a deletion-only unified diff, which the suite does not contain today.
- [ ] A `trimContextFiles` call with no `diffKind` and a real unified diff touching a bundle member reproduces the committed golden bytes exactly, for both an addition diff and the deletion-only diff.

### From WHAT (types and interfaces)

- [ ] `trimContextFiles`' report carries `reason`, `kind`, `hunks`, `headLines`, `contextBudgetBytes` and `filesTotal`, and `reason` is one of `disabled`, `under-threshold`, `no-relevance-model`, `head-fit`, `head-fit-floored`, `head-fit-declined`, `trimmed`.
- [ ] `trimmed == true` if and only if `reason` is `"trimmed"`, `"head-fit"` or `"head-fit-floored"`, asserted directly, and no other change to `trimmed`'s meaning is made.
- [ ] `report.headLines` is a member of `TRIM_HEAD_LADDER` when `reason` is `"head-fit"` or `"head-fit-floored"` and `null` for every other reason, asserted directly rather than by presence.
- [ ] `report.contextBudgetBytes` is an integer equal to `proseCeilingBytes - Buffer.byteLength(diff, "utf8") - PROSE_BRIEF_RESERVE_BYTES` under `kind: "prose"` and `null` under `kind: "unified"`, asserted for both kinds; `PROSE_BRIEF_RESERVE_BYTES` is `Math.round(DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN)` and introduces no new numeric literal.
- [ ] `parseDiffTouched` returns `hunks`, equal to the number of hunk headers parsed: 0 for a markdown document with no `@@` line, 1 for a single-hunk diff, and 0 under `diffKind: "prose"` because the diff is never parsed.
- [ ] `trimOneFile` is unmodified: its four-argument signature, its body and its output are unchanged, and the six existing direct `trimOneFile` cases in `test/adversarial-call.test.mjs` pass unmodified.
- [ ] `headReduceBundle` is exported and delegates per file to `trimOneFile` with empty ranges and an empty identifier set, so a file below `minFileBytes` is returned identical, a file with at most `headLines` lines is returned identical with no marker, and a longer one is returned as `headLines` lines plus exactly one elision marker. It is called by both `headFit` and `tightenToTarget`'s head-only branch.
- [ ] `trimOneFile` is invoked from exactly two call sites in `review-call.mjs` after the change, `trimContextFiles`' unified branch and `headReduceBundle`, asserted by a source scan of the module counting occurrences of `trimOneFile(` outside its own declaration. There is exactly one such call site today (line 546), so the assertion is a decidable count rather than a judgement about what a loop is for.
- [ ] Every file `headReduceBundle` actually shortens carries exactly **one** elision marker, counted per file across a multi-file bundle, and a file it leaves whole carries none. This owns the marker claim the head-fit scenario makes.
- [ ] `TRIM_HEAD_LADDER` is frozen, strictly descending, the same length as `TRIM_WINDOW_LADDER`, and ends at `DEFAULT_PROSE_HEAD_FLOOR`, each asserted; `DEFAULT_PROSE_HEAD_FLOOR > DEFAULT_TRIM_HEAD_LINES` is asserted directly, so no prose rung can reach the 12-line cut.
- [ ] `DEFAULT_PROSE_CEILING_BYTES` is exported and equals 589824; `trimContextFiles` accepts a `proseCeilingBytes` override; `--context-prose-ceiling-bytes` sets it in `main` and is commented as a test-only escape hatch, so the prose-path tests need no 576 KB fixture.
- [ ] `tightenToTarget` returns `headLines` and `mode` alongside its existing fields; on an anchored bundle `mode` is `"anchored"`, `headLines` equals `DEFAULT_TRIM_HEAD_LINES` and `window` is the adopted rung from `TRIM_WINDOW_LADDER`; on a prose bundle `mode` is `"head-only"`, `headLines` is the adopted rung from `TRIM_HEAD_LADDER` and `window` is `null`. Both `headLines` values are asserted as integers equal to the named constants, never merely present.

### From HOW (behaviour)

- [ ] `thresholdBytes: 0` returns the exact input array and `reason: "disabled"` under both kinds, including a prose bundle far above the ceiling, so the disabled gate still wins.
- [ ] A unified bundle under the byte threshold returns `reason: "under-threshold"`, unchanged.
- [ ] A prose bundle above the context budget with a rung that fits returns `reason: "head-fit"` and `bytesAfter <= report.contextBudgetBytes`.
- [ ] A prose bundle that no rung fits returns `reason: "head-fit-floored"`, `headLines == DEFAULT_PROSE_HEAD_FLOOR`, and no file reduced below `DEFAULT_PROSE_HEAD_FLOOR` lines; the head-fit-floored stderr note names `bytesAfter`, `report.contextBudgetBytes` and the difference between them, so an operator can size the shortfall without recomputing it.
- [ ] A prose call whose `--diff` document alone exceeds `proseCeilingBytes` yields a non-positive `report.contextBudgetBytes` and `reason: "head-fit-floored"`, rather than throwing or returning a negative-length reduction.
- [ ] A prose bundle above the context budget whose files are all below `minFileBytes` returns `reason: "head-fit-declined"`, the exact input array, and `bytesAfter == bytesBefore`, and the declined clamp is checked before the floored case, so a bundle that both grew and missed the budget keeps its original bytes.
- [ ] `tightenToTarget` on a prose bundle returns `mode: "head-only"` and a prefix strictly smaller than the untrimmed assembly for a target below it.
- [ ] `tightenToTarget` on a prose bundle with a target no rung reaches returns `fitted: false` and `headLines == DEFAULT_PROSE_HEAD_FLOOR`, never a head below the floor; `main` writes its existing `STILL OVER the usable window` suffix and leaves the per-backend guard to skip, with no new mechanism added.
- [ ] `tightenToTarget` on a unified bundle reproduces the committed baseline goldens byte for byte, generated from the merge-base module the same way as the `trimContextFiles` ones; `test/adversarial-context-window.test.mjs`' ladder, monotonicity and minimum-tracking cases pass unmodified.
- [ ] `--diff-kind prose` reaches `trimContextFiles` and `tightenToTarget` from `main`; `--diff-kind unified` and an absent flag both take the unified path; any other value makes `main` write the usage line and return `EXIT.USAGE` (2), asserted as the numeric exit, and never throws past `main`.
- [ ] Running `main` with `--diff-kind prose` and a context under the context budget writes the intact note naming `filesTotal`, `bytesBefore` and `contextBudgetBytes`, and writes neither the `FAFF-915 context trim` note nor the zero-hunk advisory.
- [ ] Running `main` with `--diff-kind prose` and `--context-prose-ceiling-bytes` set below the bundle writes the head-fit note, naming `bytesBefore`, `bytesAfter`, the adopted `headLines` rung as an integer, and `contextBudgetBytes`.
- [ ] Running `main` with a real unified diff and an oversized context writes the `FAFF-915 context trim` note with its current wording and no new note.
- [ ] Running `main` with a zero-hunk `--diff` and no `--diff-kind` writes both the `FAFF-915 context trim` note and the zero-hunk advisory.
- [ ] The window-targeted note renders `head-lines <n>` with `n` the adopted `TRIM_HEAD_LADDER` rung in the head-only regime, and `trim-window <n>` in the anchored regime.

### From HOW (the callers)

- [ ] `buildLensRequests` emits `--diff-kind prose` on every lens's argv, asserted in `test/`; the rest of the argv is byte-identical to today's.
- [ ] Across the four lenses' `LensRequest.argv`, every element that feeds the shared prefix is identical: the `--context` list, `--diff`, `--diff-kind`, `--backends-json`, `--timeout` and `--max-tokens` match element for element, and only `--system`, `--lens` (and the round-scoped raw-body flags) differ. This is the decidable half of the purity invariant, and it is what a future per-lens trim would break.
- [ ] `trimContextFiles` called twice with the same `(contextFiles, diff, diffKind, opts)` returns byte-identical text for every file, with no dependence on call order, clock or backend.
- [ ] `faffter-dark-spec-review/SKILL.md`'s three argv listings and `faff-prep/SKILL.md`'s two spec-judge calls name `--diff-kind prose`.
- [ ] `faffter-dark-adversarial-review/SKILL.md`'s `code_review` invocation names no `--diff-kind`.

### From HOW (the transcript)

- [ ] `plugin/skills/faffter-dark-spec-review/SKILL.md`'s per-lens transcript section requires each served lens's `LensResult.stderr` to be written into `round-<n>-<lens>.md` under its own heading, added as a separate line rather than appended to the existing 173-word paragraph, which sits under the 200-word `paragraph` lint cap.
- [ ] Both edited `SKILL.md` files name no tracker ID.
- [ ] `node plugin/skills/faff/bin/faff validate-adapters` and `node plugin/skills/faff/bin/faff lint-refs` both exit 0.

### Deliberately not validated by DONE

The ticket's third acceptance criterion, that a stale-reuse defect of the FAFF-996 shape becomes findable by a refuter lens, has no DONE item asserting the defect is found, and the build is not gated on it. It is a property of a model's output rather than of this code. What **is** gated is that the measurement has an owner:

- [ ] A follow-up tracker issue exists before this one closes, titled "Measure whether a refuter given intact context finds the FAFF-996 defect class", related to FAFF-1051, stating the procedure (re-run the FAFF-996 round-2 spec through spec-review and count how many of the five named defects any lens raises), the trigger (this change landing on the default branch), the partial answer already in hand (round 2 of this spec's own review supplied 100% of the bundle and produced almost entirely spec-internal objections), and the defined null outcome (no defect raised redirects the next ticket at the lens briefs, not at the trim).

### Integration smoke test

```
PROCEDURE smoke():
  1. Write a markdown file with no "@@" lines as the diff, and two context files
     of 40 KB each, so the bundle is above the 48 KB threshold and under the context budget.
  2. Run main with --diff-kind prose and a stub backend that captures the assembled prefix.
  3. Assert the captured prefix contains the LAST line of BOTH context files
     (nothing was elided) and contains no elision marker.
  4. Assert stderr contains the intact note and not the FAFF-915 trim note.
```

### Suite

- [ ] `node --import ./test/hermetic-env.mjs --test test/` exits 0.

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```