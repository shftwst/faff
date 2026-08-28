# Relax review-bench `shape()` clean-pass detection to mirror the product's closed clean-refutation grammar

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-905.

This spec addresses FAFF-905 for the build agent and human reviewers. The review-bench harness scores each backend response by *shape*; a header-wrapped clean pass — the exact form the refuter prompts tell the model to emit — is being scored `NOT-shaped` instead of `clean-pass`. The fix realigns the benchmark's `shape()` classifier with the grammar the production aggregator already accepts.

## 1. WHY — Problem and Principles

**The load-bearing model.** The benchmark carries its *own* copy of the "is this a clean pass?" test, separate from the product code. Production learned to accept a header-wrapped clean pass in FAFF-746 (`review-call.mjs` → `normaliseCleanRefutation`); the benchmark's copy never did. The two have drifted, and the benchmark is now stricter than the code it benchmarks.

**Problem statement.** `shape()` in `eval/review-bench/run-bench.mjs` tests `CLEAN.includes(t)` where `t` is the *entire* trimmed response, so a clean pass wrapped in a `## Refutation — <lens>` header falls through to `NOT-shaped`. This mislabels a genuinely-passing response as unusable, corrupting the summary rows and the captured `<lens>.content.md` reference outputs used as fine-tuning material. The change relaxes the classifier to recognise the same bare-or-headed clean-pass grammar production already accepts.

**Design principles.**

- **The benchmark mirrors the product, it does not diverge from it.** The classifier must accept exactly what the production aggregator accepts — no looser (green-lighting responses production would reject) and no stricter (the present bug). The reference grammar is `CLEAN_REFUTATIONS` + `normaliseCleanRefutation` in `review-call.mjs`.
- **No product-path change.** Exploration confirmed the product aggregator is not affected; touching it would be out of scope and risk-bearing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/review-bench/run-bench.mjs` (`shape()`, `CLEAN`, lines 155–162) | JavaScript (ESM) | The defect site; `shape()` output feeds the summary row at line 254 |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (`normaliseCleanRefutation`, `CLEAN_REFUTATIONS`, lines 248–272) | JavaScript (ESM) | The production clean-refutation grammar to mirror; accepts `bare` and `headed` forms, blank-separator-tolerant |
| `eval/review-bench/README.md` (shape doc, lines 187–188) | Markdown | Documents `clean-pass` as only the bare sentence; needs the headed form added |

**Scope statement.** A benchmark-harness classifier fix in `eval/review-bench/`; it changes scoring/labelling only, and touches no production review path.

## 2. OUT OF SCOPE

- **The product aggregator (`review-call.mjs` / `faff contract spec-review-verdict`).** Why excluded: exploration confirmed `normaliseCleanRefutation` (FAFF-746) already accepts the header-wrapped clean pass as `form: "headed"` and is wired into `main()` at `review-call.mjs:1280`; a live L4 review does not drop this response. Extension point: none needed — the product path is correct.
- **Tightening the refuter lens prompts to forbid a header on a clean pass.** Why excluded: the refuter prompts (`refute-<lens>.md`) *deliberately* permit `## Refutation — <lens>` followed by the bare sentence, and production accepts that form; forbidding it would diverge the prompt contract from the production aggregator for no benefit. Extension point: `plugin/skills/faffter-dark-spec-review/refute-*.md` if the prompt contract is ever revisited.
- **Re-labelling already-captured historical results** (e.g. the cited `openai-unsloth-Qwen3.8-27B-NVFP4-roff-*` run). Why excluded: fixing the classifier corrects labels going forward; a bulk re-score of past captures is separate. Extension point: a re-score pass over `eval/review-bench/results/` if historical labels matter.
- **Extracting a single shared clean-grammar module** imported by both bench and product. Why excluded: `run-bench.mjs` is a self-contained kit (imports only node builtins) brought in by FAFF-904; a cross-tree import from `eval/` into `plugin/skills/` is a larger structural change than this bugfix warrants. Extension point: a shared `clean-refutation` helper both trees import, if drift recurs.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| clean pass | A refuter response stating the lens found nothing, using its exact canonical sentence (e.g. `No methodology objection.`) |
| bare form | The canonical sentence alone, on its own line |
| headed form | The `## Refutation — <lens>` header line followed by the canonical sentence, blank separator lines permitted between/around them |
| shape | The benchmark's per-response classification: `EMPTY` / `clean-pass` / `findings-shaped` / `NOT-shaped` |

**The closed grammar to mirror** (from `review-call.mjs` `CLEAN_REFUTATIONS`) — four `{ lens, heading, sentence }` triples:

```
architectural : "## Refutation — architectural" + "No architectural objection."
infosec       : "## Refutation — infosec"       + "No infosec objection."
methodology   : "## Refutation — methodology"   + "No methodology objection."
QA            : "## Refutation — QA"            + "No QA objection."
```

Note the em-dash (`—`, U+2014) in each heading — byte-exact matching, as in production.

**`shape()` contract (unchanged signature).**

```
FUNCTION shape(content: string) -> "EMPTY" | "clean-pass" | "findings-shaped" | "NOT-shaped"
  # ordering of tests is load-bearing: EMPTY first, then clean-pass, then findings-shaped, else NOT-shaped
```

**Design decision — matching strategy.** Options: (a) open-ended "any line equals one of the CLEAN sentences" contains-match; (b) mirror production's closed bare-or-headed grammar. (a) is looser than production and would score responses `clean-pass` that the real aggregator rejects, breaking the "benchmark mirrors product" principle. (b) keeps bench and product in lockstep. **Chosen:** (b) — mirror the closed grammar (bare form, or headed form with blank separators filtered), matching `normaliseCleanRefutation`.

**Design decision — share vs replicate the grammar.** Options: (a) import `normaliseCleanRefutation`/`CLEAN_REFUTATIONS` from the plugin tree; (b) replicate the closed grammar inline in `run-bench.mjs`. **Chosen:** (b) — replicate inline, keeping `run-bench.mjs` self-contained (it imports only node builtins); a shared module is noted as an out-of-scope future option if drift recurs.

## 4. HOW — Behavior

**Approach.** Replace the single full-content equality test with a helper that recognises the same bare-or-headed grammar production uses. Keep the existing test order so `EMPTY` and `findings-shaped` behaviour is untouched.

```
PROCEDURE shape(content):
  1. t := trim(content)
  2. IF t is empty: RETURN "EMPTY"
  3. IF isCleanRefutation(t): RETURN "clean-pass"
  4. IF SEV matches t: RETURN "findings-shaped"
  5. RETURN "NOT-shaped"

PROCEDURE isCleanRefutation(content):
  1. lines := content, normalise CRLF/CR -> LF, trim, split on "\n",
       drop every line whose trim() is empty        # blank-separator tolerance
  2. FOR each {heading, sentence} in the four CLEAN triples:
     a. IF lines == [sentence]:            RETURN true    # bare form
     b. IF lines == [heading, sentence]:   RETURN true    # headed form
  3. RETURN false
```

**Behaviour summary.** `isCleanRefutation` reproduces `normaliseCleanRefutation`'s acceptance set (bare and headed, blank-line-tolerant, byte-exact on the substantive lines) but returns a boolean rather than the normalised token the bench does not need.

**Edge cases.**

- **Header present, sentence absent / wrong lens sentence** (e.g. header for methodology but sentence for QA) → not accepted (each triple pairs its own heading and sentence), falls through to `findings-shaped`/`NOT-shaped` exactly as production's per-entry match.
- **Extra prose beyond the two substantive lines** (a header + sentence + a trailing paragraph) → more than the allowed line count → not `clean-pass` (matches production's strict `lines.length === 1|2` bound).
- **Leading/trailing or inter-line blank lines** → filtered before the length/equality check, so the repro's `## Refutation — methodology`⏎⏎`No methodology objection.` is accepted.
- **Findings-shaped responses** → unchanged: they carry a `### <severity>:` line, fail `isCleanRefutation`, and are caught by the existing `SEV` test.

**Anti-pattern:** matching a clean-pass with a loose `content.includes(sentence)` substring test. Why: it would accept a *findings* response that merely mentions "No methodology objection." in prose, and is looser than the production aggregator — breaking the mirror.

**Failure mode — silent re-drift.** The failure: the bench copy and the production grammar diverge again when one side gains a new accepted form (e.g. a fifth lens, or a punctuation change). How you'd know: a bench run scores a `clean-pass` (per production) as `NOT-shaped`, or vice-versa — the same class of summary-row surprise this ticket started from. What it means: proceed with the inline replica now (lowest-risk), and treat a recurrence as the trigger to extract the shared module named in OUT OF SCOPE.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a methodology refuter response "## Refutation — methodology\n\nNo methodology objection."
When run-bench scores it via shape()
Then the shape is "clean-pass" (not "NOT-shaped")
```

```
Given a bare clean-pass response "No QA objection."
When shape() classifies it
Then the shape is "clean-pass"
```

```
Given an empty or whitespace-only response
When shape() classifies it
Then the shape is "EMPTY" (unchanged ordering)
```

## 6. DESIGN DECISION RATIONALE

**Is the defect on the product path or benchmark-only?** Options: benchmark-only fix vs product + benchmark fix. Evidence: `normaliseCleanRefutation` (`review-call.mjs:260-272`) already accepts the `headed` form and is called in `main()` at line 1280; the refuter prompts (`refute-*.md`) instruct exactly that form. **Chosen:** benchmark-only — the production aggregator is correct; the bug is the bench's out-of-sync copy of the grammar.

**Which matching strategy?** **Chosen:** mirror production's closed bare-or-headed grammar (see WHAT) rather than an open contains-match — keeps the benchmark a faithful mirror of what production accepts, no looser, no stricter.

**Share or replicate the grammar?** **Chosen:** replicate inline in `run-bench.mjs` to keep the kit self-contained; extracting a shared module is a larger structural change deferred to OUT OF SCOPE, with silent re-drift named as its trigger.

At the time of writing, the four canonical sentences and headers are byte-identical between `run-bench.mjs`'s `CLEAN` array and `review-call.mjs`'s `CLEAN_REFUTATIONS`; the replica must stay in step if either changes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Both questions the ticket raised are resolved by exploration — the product aggregator accepts the header-wrapped clean pass (so the fix is benchmark-only), and the classifier is relaxed rather than the lens prompt tightened.

**Assumptions:**

- **Assumes:** the production clean-refutation grammar remains the four `CLEAN_REFUTATIONS` triples in `review-call.mjs` (bare + headed forms). Validation: before building, diff `run-bench.mjs`'s `CLEAN` array against `review-call.mjs`'s `CLEAN_REFUTATIONS` sentences/headings and confirm they are byte-identical.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `## Refutation — methodology`-headed `No methodology objection.` response scores `clean-pass` in the benchmark summary (the ticket's repro no longer shows `NOT-shaped`).

### From WHAT / HOW (behaviour)
- [ ] `shape()` returns `clean-pass` for the headed form of all four lenses (architectural, infosec, methodology, QA), blank separator lines tolerated.
- [ ] `shape()` still returns `clean-pass` for the bare form (existing behaviour preserved).
- [ ] `shape()` returns `findings-shaped` for a response with a `### <severity>:` section even if it also contains a clean-pass sentence as a substring (no loose substring match).
- [ ] `shape()` returns `EMPTY` for empty/whitespace input and `NOT-shaped` for unrecognised content (ordering and existing buckets unchanged).
- [ ] A header-with-mismatched-lens-sentence, or header+sentence plus extra prose, does NOT score `clean-pass` (mirrors production's per-triple, bounded-length match).

### From HOW (reference alignment)
- [ ] The benchmark's accepted clean-pass set matches `normaliseCleanRefutation`'s (bare + headed, byte-exact substantive lines); no production file is modified.

### From docs
- [ ] `eval/review-bench/README.md` shape doc (lines 187–188) documents that `clean-pass` accepts both the bare sentence and the `## Refutation — <lens>`-headed form.

**Integration smoke test:**

```
Feed shape() the exact repro string "## Refutation — methodology\n\nNo methodology objection.";
assert it returns "clean-pass".
Feed it "No architectural objection."; assert "clean-pass".
Feed it a "### major: x" finding; assert "findings-shaped".
```

confidence: high
build-tier: complex
spec-review: approve