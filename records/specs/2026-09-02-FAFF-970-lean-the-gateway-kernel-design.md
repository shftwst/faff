# Spec: FAFF-970 — Lean the gateway kernel from ~28.6k toward the ~16-18k target

> Spec: faffter-dark-nlspec · 2026-09-02 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-970.

> Revised 2026-09-02: the three open punts were resolved with the operator. Calibration log now moves to `methodology.md` (Phase 4, a clean win); Interactive park resolution is firmly included in `park.md`; the review-verdict loader decouple is filed as follow-up FAFF-971 (out of scope here). Confidence raised medium → high.

This document specifies the work for FAFF-970 ("Lean the gateway kernel from ~28.6k toward the ~16-18k target"), the follow-up to FAFF-607 (the gateway kernel/reference split, merged as PR #819). It is written for the build agent that will relocate kernel blocks and ratchet the line baseline, and for the human reviewer who gates the result. It assumes the post-split HEAD layout: a shared `plugin/skills/faff/references/kernel.md` plus six lane references (`autonomous.md`, `build.md`, `l4.md`, `methodology.md`, `review.md`, `tracker.md`).

## 1. WHY — problem and principles

**The one idea:** moving a block out of the kernel always shrinks the kernel by that block's tokens, but it only shrinks a given skill's per-call prefix when that skill does not already Read the reference the block lands in. So the lever is to relocate a block into a reference read by a *narrower* set than "everyone who Reads the kernel", and the win is the tokens that every non-consumer of the block no longer carries. Where a block's consumers are already broad, or the consumers include the interactive read skills, relocation buys almost nothing and prose reduction is the only real lever.

**Problem statement.** FAFF-607 landed the kernel at 28,634 tokens (591 lines, per the `KERNEL_LINE_BASELINE` constant in `plugin/skills/faff/bin/lib/validate-adapters.js`), well above the split spec's aspirational 16-18k target; the prefix-planner reports the true universal core (blocks with `consumers: "all"`) is only 15,290 tokens, so roughly 13.3k of lane-scoped or canonical prose is still carried by every sub-skill. This spec relocates the blocks that can safely leave, measures each move, and ratchets the line baseline down to lock each reduction.

**Design principles that govern the implementation.**

**Relocation, not rewrite.** Every move in this ticket is text-preserving: the block's bytes move from the kernel into a reference unchanged, so the FAFF-607 concatenation-diff parity oracle still holds modulo documented content changes. Prose *reduction* of the retained blocks is a different activity, owned by FAFF-487, and is out of scope here.

**Kernel size and per-lane prefix are the metrics for a move; the contiguity tax is not.** Per the ticket's "Reading the contiguity tax" heuristic, the tax is the decision signal when *splitting a reference finer*, not when *moving a block from the kernel into a reference*. For the moves in this ticket, a near-flat tax with a shrinking kernel is the correct and expected outcome; the tax is watched only as a guardrail against accidental fragmentation, confirmed against real per-lane prefixes with `eval/tokenomics.mjs`.

**The interactive read skills must not be pushed into autonomous.md.** faff-wtf and faff-map must never *need* to Read `autonomous.md` (the FAFF-607 acceptance criterion: interactive wtf loads no autonomous-contract prose). Any block a real interactive wtf or map run consumes must therefore not be placed in `autonomous.md`. This is not lint-enforced (see the lint quirk in the reference table below), so the author honours it by construction.

**Security floors and coarse clustering stay per `docs/decisions.md`.** The security-floor blocks (Untrusted input, Blast-radius boundary) stay in the kernel; reference clustering defaults coarse, split finer only when the contiguity tax shows a genuinely disjoint consumer set and a net per-lane win; the kernel remains its own file.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/references/kernel.md` | Markdown | The shared kernel being leaned (591 lines, 28,634 tok) |
| `eval/baselines/gateway-usage.json` | JSON | Human-owned block to consumer matrix; the authoritative consumer set the under-read lint reads |
| `eval/prefix-planner.mjs` | JavaScript (ESM) | Reports universal floor, per-audience layers, contiguity tax; `--check-manifest` structural lint |
| `eval/tokenomics.mjs` | JavaScript (ESM) | Prices a given per-call prefix; confirms a move touched real per-lane tokens |
| `eval/cli-driver.mjs` | JavaScript (ESM) | Holds the `_START`/`_END` anchor constants that slice fixed-verdict prose for the eval loaders |
| `test/eval-cli-driver.test.mjs` | JavaScript (ESM) | `ANCHOR_REGISTRY` rows with `file:` fields the anchor consts must agree with |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript (CJS) | `KERNEL_LINE_BASELINE` ratchet, orphan-reference lint, under-read completeness lint |

**Scope statement.** This work sits entirely within the gateway kernel/reference layer that FAFF-607 created; it changes where prose lives and the line baseline that locks it, not what any skill does.

## 2. Out of scope

- **Prose reduction of retained blocks.** What's excluded: leaning the wording of the fixed-verdict cluster, Model & effort, Unpark, Chaining, or the fat universal-floor blocks (Configuration, Slots, Sibling-skill invocation, Contract loading). Why excluded: that is FAFF-487's charter and is not relocation; mixing it in breaks the parity oracle. Extension point: FAFF-487, "Lean prompt extension driven by economics."
- **Decoupling the review-verdict loader slice.** What's excluded: re-pointing `GATEWAY_VERDICT_END` so the Review-verdict slice stops spanning Spec-review-verdict, which would let Review-verdict and Delivery-outcome relocate independently. Why excluded: it changes the bytes the eval loader returns, so it is not a text-preserving relocation and needs its own validation. Extension point: a follow-up ticket against `eval/cli-driver.mjs` `loadReviewVerdictProse` and its `ANCHOR_REGISTRY` rows (see the Open Questions).
- **Moving the wtf/map-constrained lifecycle blocks that no relocation helps.** What's excluded: Model & effort, Unpark, Chaining leaving the kernel to shrink wtf/map. Why excluded: relocation cannot shrink an interactive read skill's prefix for a block it consumes, because the block can only land in a reference that skill still Reads (kernel, tracker, or methodology), and these three have no reference home that a meaningful set of carriers skip. (Calibration log is the exception and IS moved, in Phase 4 — it lands in `methodology.md`, which 8 carriers do not Read, so they drop it; see the relocation lemma in Design decision rationale.) Extension point: FAFF-487 prose lean, or a later split of `methodology.md` if the tax shows a real seam.
- **Reaching the 16-18k target by relocation alone.** What's excluded: any claim that this ticket alone lands the kernel at 16-18k. Why excluded: the universal floor is 15,290 tok and the retained non-movable blocks add roughly 7k, so relocation floors at ~23-24k (see the projection in Design decision rationale). Extension point: the FAFF-487 prose lean is the remainder.

## 3. WHAT — vocabulary and the block inventory

**Vocabulary.**

| Term | Definition |
|---|---|
| Carrier | A skill whose `SKILL.md` Reads `faff/references/kernel.md`; there are 20 today. The under-read lint checks only carriers. |
| Consumer | A skill listed in a block's `consumers` array in `gateway-usage.json`; the block's prose is content it needs. |
| Placement | Which reference file physically holds a block's heading; the under-read lint derives this from the heading location, not from the matrix. |
| Load-line | The "Load the kernel first ... Then Read the lane references" sentence in a skill's `SKILL.md` that names the references it Reads. |
| Anchor slice | A `[_START, _END)` region of a file that `eval/cli-driver.mjs` extracts; END sentinels are the *following* block's heading, so block order is load-bearing to the slice. |

**The kernel block inventory this ticket acts on.** Consumer sets and token counts are from `eval/baselines/gateway-usage.json` (verified against `node eval/prefix-planner.mjs`).

| Block (kernel heading) | Tok | Consumers | wtf/map consumer? | Anchored? | Disposition |
|---|---|---|---|---|---|
| Ticket templates (born-structured create boundary) | 1577 | jot, plot | no | no | **Move → new `create.md`** |
| Control-label provisioning — `faff label` | 1282 | jot, plot, tidy, beep-boop, graft, prep, concurrency-parallel, methodology-thematic | no | no | **Move → `autonomous.md`** |
| Park protocol (shared) | 926 | prep, graft, beep-boop, tidy, plot, faffidavit-routing | no | no | **Move → new `park.md`** |
| Interactive park resolution (surface, don't settle) | 604 | prep, tidy | no | no | **Move → `park.md`** (with Park protocol) |
| Calibration log | 884 | graft, beep-boop, tidy, wtf | wtf | no | **Move → `methodology.md`** (Phase 4) |
| Model & effort selection (`models:` / `effort:`) | 1616 | beep-boop, prep, jot, tidy, plot, map, wtf, +3 non-carriers | wtf, map | no | Keep kernel-side; FAFF-487 |
| Unpark protocol (shared) | 593 | tidy, wtf, map, prep, graft, beep-boop | wtf, map | no | Keep kernel-side; FAFF-487 |
| Chaining pattern | 605 | jot, plot, prep, graft, tidy, wtf, map, beep-boop | wtf, map | no | Keep kernel-side; FAFF-487 |
| Review verdict (fixed) | 493 | noon-review, dark-adversarial-review, dark-spec-review, graft, beep-boop | no | `GATEWAY_VERDICT` | Keep kernel-side (anchor-locked to cluster) |
| Spec-review verdict (fixed) | 322 | prep, noon-spec-review, dark-spec-review, wtf, beep-boop | wtf | (rides `GATEWAY_VERDICT` slice) | Keep kernel-side |
| Delivery outcome (fixed) | 1434 | noon-ship, graft, concurrency-sequential, concurrency-parallel, authoring-adaptors | no | (END sentinel for `GATEWAY_VERDICT`) | Keep kernel-side (anchor-locked to cluster) |
| Automation-routing verdict (fixed) | 622 | routing, tidy, wtf, beep-boop, prep | wtf | `GATEWAY_ROUTING` | Keep kernel-side |
| Spec readiness (fixed) | 1304 | 12 consumers (broad) | no | `MARKER_DIALECT` | Keep kernel-side (broad + anchored) |

**The lint quirk that makes the wtf/map AC the author's job.** `validate-adapters.js`'s `namedRefs` counts any `faff/references/<file>.md` string anywhere in a skill's text as a declared read. faff-wtf and faff-map each name `autonomous.md` twice: once in a "never Reads `faff/references/autonomous.md`" sentence and once in their rare "when invoked autonomously" section. So the lint treats both as autonomous.md readers and will not FAIL a wtf/map-consumed block placed there. The AC is honoured by not placing a wtf/map-consumed block in `autonomous.md`, verified behaviourally, not by the lint.

**The three fixed-verdict anchor slices (why the cluster is locked).** From `eval/cli-driver.mjs`:

```
GATEWAY_VERDICT_START = "### Review verdict (fixed)"
GATEWAY_VERDICT_END   = "### Delivery outcome (fixed)"   # slice spans Review + Spec-review
GATEWAY_ROUTING_START = "### Automation-routing verdict (fixed) → `routing_adaptor`"
GATEWAY_ROUTING_END   = "### Spec readiness (fixed)"      # END sentinel is the next block's heading
MARKER_DIALECT_START  = "### Spec readiness (fixed)"
MARKER_DIALECT_END    = "**The producer emits, the consumer parses.**"   # intra-block phrase
```

The Review-verdict loader returns everything from the Review-verdict heading up to the Delivery-outcome heading, which is Review-verdict *and* Spec-review-verdict together. Automation-routing's END sentinel is the Spec-readiness heading. So the five contracts form one ordered, contiguous run in a single file: Review, Spec-review, Delivery, Automation-routing, Spec readiness. Two of them (Spec-review, Automation-routing) are wtf-consumed. Moving the run to `review.md` would force wtf to Read `review.md` and over-carry ~3.2k it does not consume. Relocating only Review and Delivery would require re-pointing `GATEWAY_VERDICT_END`, a loader byte change, which is out of scope. The cluster therefore stays kernel-side in this ticket.

## 4. HOW — the phased relocation

Each phase is a self-contained relocation: cut the block's bytes from `kernel.md`, paste them verbatim into the target reference, update the affected skills' load-lines if needed, re-measure, and ratchet `KERNEL_LINE_BASELINE`. Phases are ordered by ascending risk so an early stop still banks the clean wins.

**The relocation procedure (applied per block).**

```
PROCEDURE relocate(block, target_reference):
  1. Cut the block's exact lines (heading through the line before the next heading) from kernel.md.
  2. Append them verbatim to target_reference (create the file if new), preserving heading level.
  3. For each CARRIER that is a CONSUMER of the block, ensure its load-line names target_reference;
     add it only where absent (Control-label needs none; see per-phase notes).
  4. If target_reference is new, confirm at least one skill Reads it (orphan lint) — true by step 3.
  5. Re-run: node eval/prefix-planner.mjs            # kernel_tokens down, tax near-flat
             node eval/prefix-planner.mjs --check-manifest   # exit 0
             node eval/tokenomics.mjs --lean <new per-lane prefix>   # confirm real per-lane move
  6. Lower KERNEL_LINE_BASELINE in validate-adapters.js to the new line count to lock the reduction.
  7. Run the lint + full test suite (DONE integration test) — all green before the next phase.
```

**Phase 1 — Ticket templates → new `create.md`.** Create `plugin/skills/faff/references/create.md` (the born-structured create lane) and relocate Ticket templates into it. Its only consumers are jot and plot; both are carriers, so add `faff/references/create.md` to the jot and plot load-lines. No other carrier reads `create.md`, so no other lane over-carries. Interactive wtf and map, which do not consume Ticket templates and do not Read `create.md`, each drop 1,577 tok. Kernel drops ~1,577 tok.

**Phase 2 — Control-label provisioning → `autonomous.md`.** Relocate Control-label into the existing `autonomous.md`. Its six carrier-consumers (jot, plot, tidy, beep-boop, graft, prep) already declare `autonomous.md` in their load-lines, so no load-line edits are required and the under-read lint stays green. Its two non-carrier consumers (concurrency-parallel, methodology-thematic) do not Read the kernel and so are outside the under-read check; confirm at build time that neither has a runtime path that needs Control-label prose it no longer reaches (see Failure modes). No wtf/map consumer, so `autonomous.md` is a permitted home and the AC holds. Interactive wtf and map do not actually Read `autonomous.md`, so they each drop 1,282 tok. Kernel drops ~1,282 tok.

**Phase 3 — Park protocol and Interactive park resolution → new `park.md`.** Create `plugin/skills/faff/references/park.md` and relocate both Park protocol and Interactive park resolution into it. Park protocol's consumers (prep, graft, beep-boop, tidy, plot, faffidavit-routing) are exactly the carriers to add `faff/references/park.md` to; none is wtf/map, so wtf and map each drop 926 tok. Interactive park resolution's consumers (prep, tidy) are a subset of Park's, so they already Read `park.md` and no further load-line edit is needed for it. Including it is a clean win by the same lemma as Phase 4: graft, beep-boop, plot, and faffidavit-routing carried it via the kernel before and carry it via `park.md` now (they Read `park.md` for Park protocol), so it is token-neutral for them, not a regression — while the 14 skills that do not Read `park.md` each drop its 604 tok. Kernel drops 926 + 604 = 1,530 tok.

**Phase 4 — Calibration log → `methodology.md`.** Relocate Calibration log into the existing `methodology.md`. All four consumers (graft, beep-boop, tidy, wtf) already declare `methodology.md` in their load-lines, so no load-line edit is needed and the under-read lint stays green; `methodology.md` (not `autonomous.md`) is the home, so the wtf AC holds. By the relocation lemma this is a clean win: the four consumers and every other `methodology.md` reader carried Calibration via the kernel before and carry it via `methodology.md` now (neutral), while the 8 carriers that do not Read `methodology.md` (onboard, noon-architecture, noon-prd, noon-evaluate, noon-ship, noon-env-compose, noon-transport, concurrency-sequential) each drop its 884 tok. Kernel drops ~884 tok. Note: this does not shrink wtf (it consumes Calibration and still Reads it via `methodology.md`), but it shrinks the kernel and the 8 non-methodology carriers with no downside.

**Behaviour summary.** After Phases 1 to 4, the kernel has shed Ticket templates, Control-label, Park protocol, Interactive park resolution, and Calibration log: roughly 5,273 tok, landing the kernel near 23.4k, with the two interactive read skills wtf and map each ~2.8k lighter (they do not consume any relocated block placed in a reference they do not Read; wtf keeps Calibration via `methodology.md`, which it Reads anyway).

**Edge cases and error handling.**

- **A relocated block's heading must stay unique in the corpus.** The anchor-existence and manifest lints resolve headings against a pooled set across kernel plus references. Moving a heading is fine; duplicating one would make an anchor ambiguous. Do not leave a stub heading behind in the kernel.
- **New reference with no reader fails the orphan lint.** `create.md` and `park.md` each acquire a reader in step 3 of the same phase, so the orphan lint never sees an unread reference at a green checkpoint.
- **Manifest token drift is advisory, not a gate.** `--check-manifest` does structural and reference checks (exit 1 on drift, exit 2 on missing/unparseable); token-count drift is surfaced only by `--drift`, which never fails CI. Re-run `--emit-manifest` if a heading rename is needed; a pure relocation needs no matrix consumer edit because consumers are unchanged.
- **Line baseline is a downward ratchet.** `validate-adapters.js` emits `RATCHET` when the kernel is below `KERNEL_LINE_BASELINE`; lower the constant to the exact new line count each phase. Never raise it.

**Failure modes.**

- **The move shrinks the kernel but not the intended per-lane prefix.** How you'd know: `eval/tokenomics.mjs --lean` shows the affected lanes' real per-call tokens unchanged even though `prefix-planner` reports a smaller kernel. What it means: the target reference is read by the same set that read the kernel, so nothing skipped the block; for Phases 1 to 3 this would show up as wtf/map not dropping the expected tokens. Narrow the placement or back the move out.
- **Control-label's non-carrier consumers silently lose content.** How you'd know: concurrency-parallel or methodology-thematic has a runtime path that referenced Control-label prose that lived in the kernel; after the move to `autonomous.md`, which those two do not Read, that path has no source. What it means: because they are non-carriers they never Read the kernel either, so they already reach Control-label some other way or not at all; confirm at build time by grepping both skills for a Control-label dependency. If one genuinely needs it, prefer a placement both can Read, or leave Control-label kernel-side. A null finding here is the expected, valid outcome.
- **The contiguity tax rises after a new reference.** How you'd know: `prefix-planner` reports a materially higher `contiguity_tax` after Phase 1 or 3. What it means: the new boundary fragmented a cohesive cluster rather than exposing a seam; per the ticket heuristic, back the split out and fold the block back.

**Anti-pattern:** relocating a wtf/map-consumed block to `autonomous.md` because the lint stays green. Why: the `namedRefs` quirk makes the lint green while a real interactive wtf/map run loses the content, breaking the FAFF-607 AC that the lint cannot see.

**Anti-pattern:** moving the fixed-verdict cluster to `review.md` to bank ~4.2k. Why: two of the five contracts are wtf-consumed and the anchor slices lock all five contiguous, so wtf would be forced to Read `review.md` and over-carry the ~3.2k of contracts it does not consume, blowing the ≤20k wtf goal in the wrong direction.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the post-split HEAD with kernel.md at 28,634 tok
When Phases 1 and 2 relocate Ticket templates and Control-label
Then node eval/prefix-planner.mjs reports the kernel reduced by ~2,859 tok
And node eval/prefix-planner.mjs --check-manifest exits 0
```

```
Given Control-label has been relocated to autonomous.md
When the interactive faff-wtf and faff-map prefixes are priced with eval/tokenomics.mjs
Then each interactive read skill's real per-call prefix drops by the relocated block's tokens
And neither faff-wtf nor faff-map Reads autonomous.md on an interactive run
```

```
Given a new reference create.md holding Ticket templates, read only by jot and plot
When node --import ./test/hermetic-env.mjs --test test/*.test.mjs runs
Then the orphan-reference lint passes (create.md has readers)
And the under-read lint passes (jot and plot declare create.md)
```

```
Given the fixed-verdict cluster is left kernel-side unchanged
When node --test test/eval-cli-driver.test.mjs runs
Then the GATEWAY_VERDICT, GATEWAY_ROUTING, and MARKER_DIALECT anchors resolve against references/kernel.md
And no ANCHOR_REGISTRY file field needs to change
```

## 6. Design decision rationale

**D1 — Which kernel blocks relocate, and which stay?**
Options: (a) relocate every non-`keep` block; (b) relocate only the blocks whose consumer set excludes the interactive read skills and whose placement is anchor-free; (c) relocate nothing, lean by prose only.
Option (a) breaks the wtf/map AC and over-carries lanes. Option (c) forgoes real, safe kernel reductions.
**Chosen:** option (b) — relocate Ticket templates, Control-label, Park protocol, Interactive park resolution, and (per D5) Calibration log, because their consumers exclude the interactive read skills from the placement or the block lands in a reference those skills already Read, they carry no eval anchor, and each has a reference home read by a narrower set than the kernel.

**D2 — Where does Control-label live?**
Options: a new dedicated reference read by exactly its eight consumers; `autonomous.md`; keep kernel-side.
A dedicated reference is a second new file for a block whose carrier-consumers already share `autonomous.md`. `autonomous.md` needs zero load-line edits, is permitted because no wtf/map consumer exists, and drops the block from interactive wtf/map.
**Chosen:** `autonomous.md`, with a build-time confirmation that the two non-carrier consumers do not need in-kernel Control-label prose. Temporal anchor: at the time of writing, concurrency-parallel and methodology-thematic do not Read `kernel.md`.

**D3 — Do the two clean fixed-verdict contracts (Review verdict, Delivery outcome) relocate?**
Options: move them to `review.md`; move the whole cluster; keep kernel-side.
The anchor slices bundle Review-verdict with Spec-review-verdict and chain Delivery, Automation-routing, and Spec readiness as END sentinels, and two of the five are wtf-consumed. Separating the clean two needs a loader byte change (re-pointing `GATEWAY_VERDICT_END`), which is not a text-preserving relocation.
**Chosen:** keep the fixed-verdict cluster kernel-side in this ticket; lean it via FAFF-487 prose reduction, and file the loader-decoupling as a follow-up (see Open Questions).

**D4 — How far does relocation get the kernel?**
Universal floor is 15,290 tok. Retained non-movable blocks total roughly: fixed-verdict cluster 4,175 + Model & effort 1,616 + Unpark 593 + Chaining 605, about 6,989 tok, plus the small canonical keep-blocks. Relocating the ~5.3k of clean movers (Phases 1 to 4) lands the kernel near 23.4k.
**Chosen:** frame the DONE as a relocation to ~23.4k with the baseline ratcheted, and name the FAFF-487 prose lean as the explicit, coordinated remainder to 16-18k, rather than asserting 16-18k by relocation alone.

**D5 — The relocation lemma (why Calibration and Interactive park resolution are clean wins).**
Moving a block from the kernel into a reference R, when *every* consumer of the block already Reads R, is a strict improvement: the kernel shrinks by the block's tokens; every carrier that does not Read R drops those tokens (it carried the block via the kernel before, and now it is in R, which that carrier does not Read); every carrier that does Read R is neutral (it carried the block via the kernel before and via R now, same total); and the under-read lint stays green with zero load-line edits, because every consumer already declares R.
**Chosen:** apply the lemma to Calibration log → `methodology.md` (all four consumers Read `methodology.md`; 8 non-methodology carriers drop 884) and to Interactive park resolution → `park.md` (both consumers Read `park.md` once Park protocol lands there; 14 non-park.md carriers drop 604). Neither is the "measure a possible graft regression" the pre-resolution draft feared — that regression does not exist, because graft carried both blocks via the kernel already. The lemma's precondition (consumers ⊆ R-readers) is what makes these safe and is checked before each move.

## 7. Open questions and assumptions

**Open questions.** All three prep-time punts were resolved with the operator on 2026-09-02 and are now Chosen decisions above:

- **Resolved (was: Calibration home):** Calibration log moves to `methodology.md` (Phase 4, D5 clean-win lemma). No longer open.
- **Resolved (was: review-verdict loader decouple):** filed as follow-up FAFF-971 ("Decouple the review-verdict eval loader slice"); out of scope for this ticket, which keeps the fixed-verdict cluster kernel-side. No longer open.
- **Resolved (was: Interactive park resolution over-carry):** included in `park.md` (Phase 3, D5). The feared graft over-carry does not exist, so no measurement gate is needed.

**Assumptions.**

- **Assumes:** the `save-pre-split-baseline` branch (tip f958c841) remains the parity oracle for the concatenation diff. Validate: `git rev-parse save-pre-split-baseline` resolves before starting.
- **Assumes:** concurrency-parallel and methodology-thematic reach any Control-label behaviour they need without in-kernel prose. Validate: grep both `SKILL.md` files for a Control-label dependency before Phase 2; if either needs it, revisit the placement.
- **Assumes:** FAFF-487 is the owner of the prose reduction that carries the kernel from ~23-24k to 16-18k. Validate: confirm FAFF-487 is open and scoped for the retained blocks before promising the remainder.

## 8. DONE — definition of done

### From WHY
- [ ] `node eval/prefix-planner.mjs` reports the kernel reduced from 28,634 tok by the Phase 1 to 4 relocations (target near 23.4k), and the reduction is reported with the tokenomics bench.
- [ ] The contiguity tax reported by `prefix-planner` is not materially higher than the 19,320 tok/call baseline after all moves.

### From WHAT (inventory and constraints)
- [ ] Ticket templates lives in `create.md`; Control-label lives in `autonomous.md`; Park protocol and Interactive park resolution live in `park.md`; Calibration log lives in `methodology.md`.
- [ ] The five fixed-verdict contracts remain contiguous and in order in `kernel.md`; no anchor constant or `ANCHOR_REGISTRY` `file:` field changed.
- [ ] No wtf/map-consumed block was placed in `autonomous.md`.

### From HOW (behaviour)
- [ ] `node eval/prefix-planner.mjs --check-manifest` exits 0 after every phase.
- [ ] jot and plot load-lines name `create.md`; the Park protocol carriers name `park.md`; no load-line edit was needed for Control-label.
- [ ] `KERNEL_LINE_BASELINE` in `validate-adapters.js` is lowered to the exact post-relocation kernel line count.
- [ ] The interactive faff-wtf and faff-map per-call prefixes, priced with `eval/tokenomics.mjs`, each dropped by the relocated blocks they do not consume.

### From HOW (edge cases and lints)
- [ ] The orphan-reference lint passes (both new references have readers).
- [ ] The under-read completeness lint passes (every carrier-consumer of a relocated block declares its new reference).
- [ ] `node --import ./test/hermetic-env.mjs --test test/*.test.mjs` is green across all 210 test files, including `test/eval-cli-driver.test.mjs`, `test/validate-adapters.test.mjs`, and `test/faff-679-bracket-writes.test.mjs`.

### Companion artifact
- [ ] A post-lean snapshot records the kernel token count, per-lane prefixes for the affected skills, and the contiguity tax before and after, so the next lean (FAFF-487) starts from a measured baseline.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. git rev-parse save-pre-split-baseline    # oracle present
  2. Apply Phase 1 (Ticket templates → create.md), edit jot + plot load-lines.
  3. node eval/prefix-planner.mjs             # kernel_tokens down ~1,577; tax near-flat
  4. node eval/prefix-planner.mjs --check-manifest   # exit 0
  5. Lower KERNEL_LINE_BASELINE to the new line count.
  6. node --import ./test/hermetic-env.mjs --test test/*.test.mjs   # all green
  # If steps 3 to 6 pass, the relocation plumbing is connected; repeat per phase.
```

## Appendix A — projected kernel trajectory

| Step | Move | Kernel tok (approx) | wtf/map prefix effect |
|---|---|---|---|
| Baseline | — | 28,634 | — |
| Phase 1 | Ticket templates → create.md | 27,057 | −1,577 each |
| Phase 2 | Control-label → autonomous.md | 25,775 | −1,282 each |
| Phase 3a | Park protocol → park.md | 24,849 | −926 each |
| Phase 3b | Interactive park resolution → park.md | 24,245 | neutral for wtf/map |
| Phase 4 | Calibration log → methodology.md | 23,361 | neutral for wtf (keeps it via methodology.md) |
| Remainder | FAFF-487 prose lean of retained + floor blocks | ~16-18k target | prose-driven |

Numbers are pre-measurement estimates from the `gateway-usage.json` token counts; the build re-measures with the planner and ratchets to the real line count at each step.

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen", "topic": "which blocks relocate vs stay (D1)" },
    { "marker": "chosen", "topic": "Control-label home is autonomous.md (D2)" },
    { "marker": "chosen", "topic": "fixed-verdict cluster stays kernel-side; loader decouple filed as FAFF-971 (D3)" },
    { "marker": "chosen", "topic": "frame DONE as relocation to ~23.4k, FAFF-487 the remainder (D4)" },
    { "marker": "chosen", "topic": "the relocation lemma: Calibration → methodology.md and Interactive park resolution → park.md are clean wins (D5)" },
    { "marker": "assumes", "topic": "save-pre-split-baseline branch is the parity oracle" },
    { "marker": "assumes", "topic": "non-carrier consumers do not need in-kernel Control-label prose" },
    { "marker": "assumes", "topic": "FAFF-487 owns the prose-lean remainder to 16-18k" }
  ] }
```
