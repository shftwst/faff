# FAFF-971 — Decouple the review-verdict eval loader slice so Review+Delivery contracts can relocate

> Spec: faffter-dark-nlspec · 2026-09-03 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-971.

This spec addresses Linear issue **FAFF-971** — *Decouple the review-verdict eval loader slice so Review+Delivery contracts can relocate*. It is written for the build agent that will make the change and for the human reviewers gating it. The change is small and mechanical: one constant re-point plus one test assertion, with the bulk of the spec devoted to naming exactly what must and must not change so the builder does not manufacture spurious edits.

## 1. WHY — Problem and Principles

**The load-bearing model.** `loadReviewVerdictProse` in `eval/cli-driver.mjs` builds the review-verdict eval rubric by cutting a slice out of the gateway kernel between two heading sentinels and folding it with a second slice from the review producer's own skill. The slice is defined by a START heading and an END heading, and the END heading is *exclusive* — the cut stops just before it. The bug is purely in which heading END points at: it currently points two blocks too far down, so the slice swallows a neighbouring contract it was never meant to include.

**Problem statement.** Today `GATEWAY_VERDICT_END = "### Delivery outcome (fixed)"`, but in `plugin/skills/faff/references/kernel.md` the Delivery-outcome heading is the *next-but-one* block after Review verdict — the Spec-review-verdict block sits between them — so the gateway slice spans Review verdict AND Spec-review verdict together. This feeds the review-verdict eval prose it does not need (a latent correctness smell) and anchor-locks all five contiguous fixed-verdict contracts as one run, blocking FAFF-970 from relocating the two narrow-consumer contracts (Review verdict, Delivery outcome) out of the kernel. Re-pointing END to the Spec-review-verdict heading makes the slice stop at the end of the Review-verdict block, returning only the Review-verdict contract.

**Design principle — change only the gateway slice's END boundary; touch nothing else.** The whole value of this ticket is a narrowing that is provably inert everywhere except the one slice. An implementation that also edits the anchor registry row, adds an `endCount` override, or touches the review-producer half of the fold has misunderstood the change and must be rejected. The registry row keys off the constant's *name* (`GATEWAY_VERDICT_END`), not its value, and the end-count check resolves the value dynamically — so re-pointing the value is complete on its own.

**Design principle — the narrowing must be locked by a test, not just observed.** Nothing today asserts against the Spec-review-verdict prose appearing in the slice — the current slice includes it and no test checks either way. The narrowing is only real if a regression that widens the slice again turns a test red. That means adding a positive exclusion assertion, not relying on the existing Delivery-outcome exclusion (which already passed before this change and stays true after).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/cli-driver.mjs` | JavaScript (ESM) | Declares the anchor constants and `loadReviewVerdictProse`; the one-line change lives here (line 245) |
| `plugin/skills/faff/references/kernel.md` | Markdown | Holds the five contiguous fixed-verdict contract headings the slice cuts against |
| `eval/live-driver.mjs` | JavaScript (ESM) | Second consumer of `loadReviewVerdictProse` (imported line 29, called line 132 in `buildVerdictBuildPrompt`) for the verdict-build live eval |
| `test/eval-cli-driver.test.mjs` | JavaScript (ESM) | Content-assertion test, anchor registry, and the FAFF-669/687 anchor checks |

**Scope statement.** This is a loader-boundary correction inside the eval harness; it unblocks a later kernel-lean relocation (FAFF-970) but performs no relocation itself.

## 2. OUT OF SCOPE

- **Relocating the Review-verdict or Delivery-outcome contracts out of `kernel.md`.** Why excluded: this ticket only decouples the loader so relocation *becomes possible*; the move itself is FAFF-970 or a later lean. Extension point: FAFF-970, editing `kernel.md` section ordering and any loader `file`/anchor rows that follow.
- **Editing the `ANCHOR_REGISTRY` row for `GATEWAY_VERDICT_START`.** Why excluded: the row references the constant *name* `GATEWAY_VERDICT_END`, which is unchanged; the FAFF-687 check resolves its value dynamically via `anchorValue(row.end)`. Extension point: none needed — the row is correct as written. (The filed WHAT says "update the ANCHOR_REGISTRY row"; on inspection this is a no-op on the row. See Design Decision Rationale.)
- **Adding an `endCount` override to the registry.** Why excluded: the new END value `"### Spec-review verdict (fixed)"` occurs exactly once in `kernel.md` (line 421), same as the old value's count of one, so the default `endCount` of 1 still holds. Extension point: `ANCHOR_REGISTRY` row `endCount` field, only if a future duplicate heading is introduced.
- **Touching the review-producer rubric half of the fold** (`REVIEW_VERDICT_START`/`REVIEW_VERDICT_END`, sourced from `faffter-noon-review/SKILL.md`). Why excluded: re-pointing the gateway END affects only the gateway slice; the review-producer half is untouched by construction.
- **`test/eval-gate.test.mjs` changes.** Why excluded: that file tests `run-evals.mjs` gate plumbing and has no dependency on `loadReviewVerdictProse` or the slice boundaries. Extension point: none for this ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Gateway slice | The portion of `kernel.md` cut between `GATEWAY_VERDICT_START` and `GATEWAY_VERDICT_END` by `sliceAnchored`; one of the two halves `loadReviewVerdictProse` folds. |
| Exclusive END anchor | `sliceAnchored` computes `md.slice(start, end)` where `end = indexOf(endAnchor, …)`; the slice stops just before the END heading text, so the END block itself is never included. |
| Review-producer rubric half | The second fold source, sliced from `faffter-noon-review/SKILL.md` between `REVIEW_VERDICT_START`/`REVIEW_VERDICT_END`; unaffected by this change. |
| Anchor registry row | An `ANCHOR_REGISTRY` entry keyed by a `*_START` constant name, naming the skill/file and the `end` constant *by name*; drives the FAFF-669/687 uniqueness and end-count checks. |

**The single interface change.** In `eval/cli-driver.mjs`, one constant value changes:

```
# eval/cli-driver.mjs line 245
CONSTANT GATEWAY_VERDICT_END:
  before: "### Delivery outcome (fixed)"
  after:  "### Spec-review verdict (fixed)"
  # value only; the constant NAME is unchanged, so all name-keyed machinery is inert
```

`GATEWAY_VERDICT_START` (line 244), `sliceAnchored` (247–253), the review-producer constants, and the fold join (`"\n\n---\n\n"`) are all unchanged.

**The single test change.** In `test/eval-cli-driver.test.mjs`, the content-assertion test (317–329) gains one assertion locking the new exclusion:

```
ASSERT NOT prose.includes("### Spec-review verdict (fixed)")
  # message: "stops before the Spec-review-verdict block (the new gateway END anchor)"
```

The existing `!prose.includes("### Delivery outcome (fixed)")` (line 327) stays and stays true — it is now stronger than needed but harmless as a redundant guard. All positive assertions (Review-verdict header, malformed→needs-human coercion, pass-5 header, verbatim revert test, `## Verdict rules`) stay true, because the Review-verdict block and the review-producer rubric are both still in the slice.

**Design decision — where to place the new lock.** The exclusion could ride the existing content-assertion test or be a new test. Adding it to the existing test keeps the fold's positive-and-negative assertions in one place and matches the pattern of the sibling Delivery-outcome exclusion on line 327. **Chosen:** add the Spec-review-verdict exclusion assertion inside the existing "folds the gateway's fixed contract and the review producer's rubric verbatim" test — one place, mirroring the adjacent Delivery-outcome guard.

## 4. HOW — Behavior

**Approach.** Change the value of `GATEWAY_VERDICT_END` to the Spec-review-verdict heading; add the exclusion assertion; run the suite. The mechanism is entirely in `sliceAnchored`'s exclusive-END behaviour.

```
PROCEDURE sliceAnchored(md, start_anchor, end_anchor):   # unchanged; shown for the boundary reasoning
  1. start := indexOf(start_anchor)          # "### Review verdict (fixed)" region
  2. end   := indexOf(end_anchor, start + len(start_anchor))
  3. RETURN md.slice(start, end).trim()       # stops just BEFORE end_anchor
```

With `end_anchor = "### Spec-review verdict (fixed)"` (kernel line 421), step 3 returns the text from the Review-verdict heading up to just before the Spec-review-verdict heading — i.e. only the Review-verdict contract. With the old `"### Delivery outcome (fixed)"` (line 427) it returned Review verdict + Spec-review verdict together. Both fold sources still exist, so `loadReviewVerdictProse` still returns `gatewayContract + "\n\n---\n\n" + reviewRubric`, with the gateway half now narrower.

**Both consumers receive the narrower slice — verify both surfaces.** `loadReviewVerdictProse` has two callers, and both correctly want the narrower slice (neither ever needed Spec-review-verdict prose):

- **verdict-revert** via `eval/cli-driver.mjs` — exercised by `eval/cases/verdict-revert-001.json` and `verdict-revert-002.json`.
- **verdict-build** via `eval/live-driver.mjs` `buildVerdictBuildPrompt` (line 132, FAFF-155) — exercised by `eval/cases-live/verdict-build-001.json`.

The builder verifies both eval surfaces are unaffected in substance: the review-verdict rubric each prompt is built from still carries the Review-verdict contract and the review-producer rubric, and the graders' pass/fail/needs-human behaviour is unchanged. (Live cases need not be executed against a model for this ticket; the substantive check is that the folded rubric content is correct and the offline test suite is green.)

**Why the name-keyed checks stay green without edits.**

```
FAFF-669 start-uniqueness (814–820): counts GATEWAY_VERDICT_START's VALUE — unchanged → still 1.
FAFF-669 registry coverage (823–829): counts *_START constant NAMES (expects 29) — no name added → still 29.
FAFF-687 end-count (843–855): counts row.end's resolved VALUE in the after-start window.
  old value "### Delivery outcome (fixed)": occurs once after start.
  new value "### Spec-review verdict (fixed)" (kernel line 421): occurs once after start.
  → endCount stays 1; no override; check passes.
Registry coverage both directions (823–829, 883–889): by NAME → unaffected.
```

**Anti-pattern:** editing the `ANCHOR_REGISTRY` row at line 776 to "reflect the new END". Why: the row names the *constant* `GATEWAY_VERDICT_END`, not its value; the value is resolved dynamically by `anchorValue(row.end)`. Editing the row is a spurious change that the filed WHAT's wording ("update the ANCHOR_REGISTRY row") can mislead a builder into making.

**Anti-pattern:** adding an `endCount` override. Why: the new END value occurs exactly once in the after-start window, so default 1 already holds; an override is dead configuration.

**Anti-pattern:** relying only on the existing Delivery-outcome exclusion (line 327) as proof of the narrowing. Why: that assertion passed *before* this change too, so it cannot catch a regression that re-widens the slice to include Spec-review verdict but still stops before Delivery outcome. The new Spec-review-verdict exclusion is the assertion that actually locks the boundary.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The one behavioural objective above the complexity bar is the slice boundary itself — a non-obvious observable (which contract text survives the cut).

```
Given eval/cli-driver.mjs with GATEWAY_VERDICT_END re-pointed to "### Spec-review verdict (fixed)"
When loadReviewVerdictProse(DEFAULT_PLUGIN_DIR) is called
Then the returned prose includes "### Review verdict (fixed)", the malformed→needs-human coercion
     statement, the review producer's "### 5. Human-judgement flag" header, the verbatim revert test,
     and "## Verdict rules"
And  the returned prose does NOT include "### Spec-review verdict (fixed)"
And  the returned prose does NOT include "### Delivery outcome (fixed)"
```

The holdout re-instantiates the stated exclusion rule (Spec-review-verdict prose must be absent) via a different concrete marker — a body phrase rather than the heading — so it verifies behaviour the body already requires without being the sole statement of any requirement.

## 6. Design Decision Rationale

**Where to re-point `GATEWAY_VERDICT_END`.**
- *Option — point at `"### Delivery outcome (fixed)"` (status quo):* includes Spec-review verdict in the slice; feeds unneeded prose and anchor-locks five contracts. Rejected — this is the bug.
- *Option — point at `"### Spec-review verdict (fixed)"`:* stops the slice at the end of the Review-verdict block (kernel line 421), returning exactly the Review-verdict contract. Occurs once in the after-start window, so FAFF-687 stays at endCount 1.
- **Chosen:** `GATEWAY_VERDICT_END = "### Spec-review verdict (fixed)"` — narrowest correct boundary, no other machinery disturbed.

**Whether to edit the `ANCHOR_REGISTRY` row (line 776).**
- *Option — edit the row:* the filed WHAT says "update the ANCHOR_REGISTRY row", suggesting a change. But the row is `{ skill: "faff", file: "references/kernel.md", end: "GATEWAY_VERDICT_END" }` — it names the *constant*, unchanged. Editing it would be a no-op at best, a mistake at worst.
- **Chosen:** leave the row unchanged — the filed instruction is, on inspection, a no-op on the row; the real test-side change is the content-assertion exclusion, not a registry edit.

**How to lock the narrowing in tests.**
- *Option — rely on the existing Delivery-outcome exclusion (line 327):* it was already true before this change, so it cannot detect a re-widening to Spec-review verdict. Insufficient.
- *Option — add a positive `!prose.includes("### Spec-review verdict (fixed)")` assertion:* fails red if the slice ever re-includes the Spec-review-verdict block.
- **Chosen:** add the Spec-review-verdict exclusion assertion to the existing content-assertion test, alongside the Delivery-outcome guard.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed with a `**Chosen:**` marker.

**Assumptions.** None requiring external validation — all boundary facts (heading order and uniqueness in `kernel.md`, the exclusive-END semantics of `sliceAnchored`, the name-keyed registry and end-count checks, the two consumers) are verified in the explore findings against the current codebase. The build agent should re-confirm before starting by reading `eval/cli-driver.mjs` lines 244–273 and `plugin/skills/faff/references/kernel.md` lines 413–427.

## 8. DONE — Definition of Done

### From WHY
- [ ] The review-verdict eval rubric no longer contains Spec-review-verdict prose — the latent correctness smell is gone.
- [ ] The five fixed-verdict contracts are no longer anchor-locked as one run: the gateway slice for the review verdict stops at the Review-verdict block boundary, so Review verdict and Delivery outcome can later be relocated independently.

### From WHAT (interface)
- [ ] `GATEWAY_VERDICT_END` in `eval/cli-driver.mjs` equals `"### Spec-review verdict (fixed)"`; `GATEWAY_VERDICT_START`, `sliceAnchored`, the review-producer constants, and the fold join are unchanged.
- [ ] The content-assertion test in `test/eval-cli-driver.test.mjs` includes an assertion `!prose.includes("### Spec-review verdict (fixed)")`.

### From HOW (behaviour)
- [ ] `loadReviewVerdictProse(DEFAULT_PLUGIN_DIR)` returns prose that includes the Review-verdict contract heading + the malformed→needs-human coercion statement, the review producer's pass-5 header, the verbatim revert test, and `## Verdict rules`.
- [ ] That same prose excludes both `"### Spec-review verdict (fixed)"` and `"### Delivery outcome (fixed)"`.
- [ ] Both consumers are confirmed unaffected in substance: verdict-revert (`eval/cli-driver.mjs`; `eval/cases/verdict-revert-001.json`, `verdict-revert-002.json`) and verdict-build (`eval/live-driver.mjs` `buildVerdictBuildPrompt`; `eval/cases-live/verdict-build-001.json`).

### From HOW (no-op guards — must NOT change)
- [ ] The `ANCHOR_REGISTRY` row for `GATEWAY_VERDICT_START` (line 776) is unchanged.
- [ ] No `endCount` override is added; the FAFF-687 end-count check passes with the default `endCount` of 1.
- [ ] FAFF-669 start-anchor uniqueness (start count 1) and registry-coverage (29 start-anchor names) checks pass unchanged.

### From testing
- [ ] The full test suite is green (`npm test`, or at minimum `test/eval-cli-driver.test.mjs`; `test/eval-gate.test.mjs` is independent and stays green).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. prose := loadReviewVerdictProse(DEFAULT_PLUGIN_DIR)
  2. ASSERT prose.includes("### Review verdict (fixed)")
  3. ASSERT prose.includes("## Verdict rules")
  4. ASSERT NOT prose.includes("### Spec-review verdict (fixed)")
  5. ASSERT NOT prose.includes("### Delivery outcome (fixed)")
  # if these hold, the slice boundary is correct and both consumers get the intended rubric
```

## Already shipped against this surface

The already-shipped scan against the *Cost-aware model & transport routing* project found two Done tickets on this surface — both related, neither superseding:

- **FAFF-970 (Done) — "Lean the gateway kernel from ~28.6k toward the ~16-18k target"** is the ticket FAFF-971 was filed as an enabler for. FAFF-970 shipped its kernel lean *without* relocating the Review-verdict and Delivery-outcome contracts out of `kernel.md` — precisely because the loader slice was anchor-locked, which is the coupling FAFF-971 removes. Verified against the live code: `GATEWAY_VERDICT_END` still equals `"### Delivery outcome (fixed)"` (`eval/cli-driver.mjs:245`) and the five fixed-verdict headings are still contiguous in `kernel.md`. So FAFF-971's change is undone, and its standalone justification (the correctness smell — the review-verdict eval still being fed Spec-review-verdict prose) is still live.
- **FAFF-607 (Done) — the gateway kernel/reference split** moved the fixed Review-verdict contract into the shared kernel (the reason `loadReviewVerdictProse` reads `kernel.md`, per its own line 257 comment). Context, not overlap.

Because FAFF-970 shipped without waiting on this decoupling, the "enabler for FAFF-970" framing is now forward-looking: the decoupling enables a *later* kernel lean to relocate Review verdict and Delivery outcome, and fixes the standing correctness smell today. The premise holds; scope is unchanged.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Per-issue lens for FAFF-971 — "Decouple the review-verdict eval loader slice so Review+Delivery contracts can relocate" (Project: *Cost-aware model & transport routing*; Size: S; Backlog). Surface-only — this is a read-only critique; no tracker mutations proposed.

### Right-sizing (Principle 4)

**What's there.** The whole unit is a one-line constant re-point (`GATEWAY_VERDICT_END`) plus one added content assertion. That is comfortably inside a 1-3 day unit — in fact well under a day, at the micro end of the scale.

**Why it matters.** Micro-tickets fragment the picture, but this one is a clean, standalone, atomic deliverable with an honest done-bar, so the size is a feature, not a smell. It is not a split candidate (there is only one concern). It is also not a merge candidate: the deliberately-deferred contract *relocation* is a separate outcome (moving Review + Delivery contracts) that does not ship together with this narrowing — this ticket ships standalone, ahead of it.

**What to do.** Accept the size as-is. No split, no merge.

### Workstream fit (Principles 1 + 5)

**What's there.** The ticket sits in project *Cost-aware model & transport routing*, but its outcome — narrowing an eval-harness loader slice to unblock a later kernel contract relocation — is enabling-work descended from FAFF-970's kernel-lean, not visibly a cost-aware-routing increment.

**Why it matters.** A project is a sequencing unit; when a member ticket converges on a different outcome (kernel/eval structure) than the project's stated one (cost-aware routing), "done" for the project blurs and sequencing inside it gets noisier. This is a workstream-fit smell, named against project *Cost-aware model & transport routing* so a human can discount it if the boundary is deliberate.

**What to do.** Confirm the home. If the kernel-lean / contract-relocation thread has its own outcome stream (the one FAFF-970 belonged to), this reads as a better fit there; if it is deliberately parked here to ride alongside the routing work, that is a human call worth making explicit rather than leaving implicit.

### Surfaced dependencies (Principle 6)

**What's there.** The spec states "No relocation of contracts (that is a later ticket)" but names no ID for that later ticket and declares no blocker edge. The relocation ticket depends on this narrowing landing first, yet that dependency lives only in prose. FAFF-970 (Done), FAFF-607 (Done), and the FAFF-669/687 anchor-check infra are related but not blockers — they are already shipped, so no gap there.

**Why it matters.** An implicit dependency held in spec prose is unfinished thinking — the downstream relocation ticket cannot be sequenced honestly against this one, and automation routing cannot see the edge. This is the one open dependency the ticket leaves unencoded.

**What to do.** If the later relocation ticket exists, add a `blockedBy` link from it to FAFF-971 so the sequencing is honest. If it does not exist yet, file it and link it, so the deferred half of "Review+Delivery contracts can relocate" (the title's own promise) is not lost.

### Risk profile (Principle 7)

**What's there.** Mechanically this is near-zero risk: no novel integration, no external dependency. The anchor re-point rides existing, well-guarded infra — `sliceAnchored` fails loud on a missing anchor, and the FAFF-687 `ANCHOR_REGISTRY` guard (which keys off the constant *name*, so no row edit is needed) holds `endCount` at 1, matching the single occurrence of `### Spec-review verdict (fixed)` in the after-start window. No de-risking spike is warranted.

**What it understates.** The change is mechanically trivial but *semantically* load-bearing for two eval consumers — `verdict-revert` (cli-driver) and `verdict-build` (live-driver) — which will now receive a narrower rubric. The added assertion (`!prose.includes("### Spec-review verdict (fixed)")`) and a green suite prove the *string slice* is what's expected; they do not prove the two consumers grade the same way once the Spec-review-verdict prose is gone. If either eval's model grading currently leans on that prose, narrowing could shift eval output without breaking a single unit test.

**What to do.** No spike, but strengthen the acceptance: verify eval-output parity for `verdict-revert` and `verdict-build` (that the narrower rubric does not move their grading), not only that the content-assertion test and full suite are green. That closes the one residual risk the "mechanical" framing hides.

### Summary

Genuinely right-sized (if anything, small) and low-risk, with strong existing test guards and all structural spec claims verified against the code. Two things to resolve before build: (1) surface the deferred relocation ticket as an explicit blocker link rather than prose (Principle 6), and (2) confirm the ticket's home against the *Cost-aware model & transport routing* outcome, since it reads as kernel-lean enabling-work (Principles 1 + 5). One acceptance gap worth closing: prove eval-consumer grading parity, not just slice-content and suite-green (Principle 7).

> Autonomous note: this critique is advisory and does not block promotion. Its three points (workstream home, the unencoded relocation-ticket dependency, and eval-consumer grading parity) surface for human review via /faff-wtf. Point 3 (grading parity) is a sensible extra acceptance check the builder may adopt; the spec's stated done-bar already covers substance-of-slice-content and suite-green.

confidence: high
