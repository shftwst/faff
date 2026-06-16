# FAFF-114 — Skill-prompt cruft + cross-skill duplication audit

Status: inventory artifact (read-only audit; edits zero `SKILL.md`). Consumed by FAFF-115 (single-source/gateway restructure), FAFF-116 (orchestration-skill terseness), FAFF-117 (slot-skill terseness), FAFF-120 (charter/lint).

Every field is tagged **[M]** (mechanical — scripted, reproducible) or **[J]** (judgement — keep/drop, naming). The cleanup tickets are human-gated; this audit *recommends*, it does not cut. **Tie-break: when ambiguous, KEEP** (never auto-drop a possibly-load-bearing ref).

## Census header [M] — live at 2026-06-16 (re-measured; the ticket's 21/70/32 is stale)

| Metric | Value |
|---|---|
| `file_count` | **23** faff-family `SKILL.md` (`faff`, `faff-*`, `faffidavit-*`, `faffter-*`) |
| `total_lines` | **5,119** |
| `faffnn_total` | **76** `FAFF-NN` occurrences |
| `faffnn_gateway` | **36** (47% of all refs are in `faff/SKILL.md` alone) |
| `distinct_refs` | **25** distinct `FAFF-NN` numbers |

**Per-file lines (largest):** `faff` 909 · `faff-beep-boop` 444 · `faff-graft` 384 · `faff-prep` 321 · `faffidavit-rendering` 311 · `faff-wtf` 297 · `faff-tidy` 279 · `faffter-dark-nlspec` 228 · `faffter-noon-methodology-structural` 226 · `faff-map` 219. **Smallest:** `faffter-noon-concurrency-sequential` 39 · `faffter-dark-concurrency-parallel` 53 · `faffter-noon-ship` 69.

Regenerate: `for f in plugin/skills/{faff,faff-*,faffidavit-*,faffter-*}/SKILL.md; do wc -l "$f"; done` and `grep -roE 'FAFF-[0-9]+' plugin/skills/{faff,faff-*,faffidavit-*,faffter-*}/SKILL.md | wc -l`.

## 1. Issue-reference verdicts [M ref/count · J verdict/reason]

Classified by **distinct ref** (the nature of a ref is consistent across its occurrences); the count column maps each verdict onto all 76 occurrences. Verdict per the keep/drop threshold (Decision 2): **DROP** = pure provenance / decision-record / parenthetical-background the reader never acts on. **KEEP** = active rule's name/title · a contract id the reader must resolve · a control-label/mechanism name · a live cross-skill pointer.

| Ref | Occ. | Verdict | Reason |
|---|---|---|---|
| FAFF-109 | 24 | **KEEP-but-thin** | Live contract id (retired-adaptor consumer-fold — the reason a slot was retired, cross-referenced across producers). KEEP the defining mentions in `### Spec/Review/Delivery (fixed)`; **DROP the ~15 redundant parenthetical repeats** — 24 occurrences of one id is itself cruft. |
| FAFF-81 | 8 | **KEEP-but-thin** | Contract id (`faff-contract:spec-readiness` block). KEEP the defining ref; drop redundant repeats. |
| FAFF-22 | 7 | **KEEP-but-thin** | Mechanism name (fused provider-wrapper authoring). KEEP where it points to the wrapper; drop parenthetical repeats. |
| FAFF-108 | 3 | **KEEP** | Contract id (`faff-contract:review-verdict` block). |
| FAFF-82 | 4 | **KEEP** | Active rule name/title — `### Issue claim & status monotonicity (… FAFF-82)`; readers look it up. |
| FAFF-19 | 1 | **KEEP** | Active rule name/title — `### Human curation is authoritative (FAFF-19)`. |
| FAFF-80 | 1 | **KEEP** | Contract-script id (`faff contract …` validation). |
| FAFF-21 | 1 | **KEEP** | Mechanism cross-pointer (the FAFF-22 wrapper references it). |
| FAFF-67 | 3 | **DROP** | Provenance/background (stale-snapshot incident residue). |
| FAFF-98 | 2 | **DROP** | Decision-record (jot freeze/thaw → promote/demote rename, "tracked by FAFF-98"). |
| FAFF-7 | 2 | **DROP** | Background ("the corruption fix" / FAFF-7) — the rule stands without the number. |
| FAFF-61 | 2 | **DROP** | Decision-record ("Migration (FAFF-61)") — the eligibility rule is self-contained. |
| FAFF-60 | 2 | **DROP** | Provenance (methodology decision residue). |
| FAFF-50 | 2 | **DROP** | Provenance — "the failure FAFF-50 closed" (verified DROP example). |
| FAFF-15 | 2 | **DROP** | Provenance (tracker-inference background; verified DROP). |
| FAFF-5 | 2 | **DROP** | Provenance/background. |
| FAFF-1 | 2 | **DROP** | Background (the FAFF-1 vacuous-green hole) — the CI-classification rule reads without it. |
| FAFF-8 | 1 | **DROP** | Decision-record ("FAFF-8 Punt C" untrusted-input decision). |
| FAFF-18 | 1 | **DROP** | Provenance (verified DROP example). |
| FAFF-48 | 1 | **DROP** | Provenance (CI-gate background). |
| FAFF-24 | 1 | **DROP** | Provenance (routing background). |
| FAFF-23 | 1 | **DROP** | Provenance. |
| FAFF-110 | 1 | **DROP** | Provenance. |
| FAFF-153 | 1 | **DROP** | Provenance (chain-gap eval kind — the eval reads the anchor, not the prose number). |
| FAFF-147 | 1 | **DROP** | Provenance (splittable eval anchor — same). |

**Headline:** of 76 occurrences, ~**41 are KEEP-relevant** but concentrated in 4 contract/mechanism ids (FAFF-109/81/22/108) that are **massively over-repeated** — the single biggest FAFF-NN cut is collapsing those parenthetical repeats to one load-bearing mention each. ~**24 occurrences across ~17 distinct refs are clean DROPs** (provenance/decision-records). The gateway alone (36 refs) is the densest target.

## 2. Paragraph-instead-of-list findings [M-scan · J-subject] (representative)

The high-line-count files concentrate run-on prose enumerating sets/conditions inline. Representative offenders (the cleanup ticket should re-scan exhaustively — this is a sampled flag set, not a complete line-by-line index, per the 0.5-day timebox):

| File | Enumerated subject [J] | Recommended form [J] |
|---|---|---|
| `faff/SKILL.md` (Configuration / CLI-only) | the config-read access rules + the "what silently dropped slots" cases | bulleted list |
| `faff/SKILL.md` (Automation eligibility) | the precedence rules (hard-exclude > include > default) stated partly in prose | already partly a list; finish the conversion |
| `faff-beep-boop/SKILL.md` (Reporting / buckets) | the exhaustive-outcome-buckets sentence + the banned-heading list run inline | bulleted list |
| `faff-graft/SKILL.md` (Step 10 merge gate) | the ci-green/ci-red/no-ci-coverage branches as dense prose | ordered/branch list |
| `faff-tidy/SKILL.md` (§1 The mess) | the spec-health sub-classifications (overlooked/challenged/stale/superseded) | list (largely already) |
| `faffidavit-rendering/SKILL.md` | rendering-form rules in prose paragraphs | table/list |

## 3. Duplication clusters [M-files/lines · J-name/home/action] — live grep -l counts

| Cluster [J] | Files [M] | Canonical home [J] | Action [J] | Owner [J] |
|---|---|---|---|---|
| "Load the gateway first" entry preamble | **9** | `none yet` (gateway `### Entry preamble` to be created) | establish-home-then-reference | FAFF-115 |
| Rendering / `rendering_adaptor` routing | **14** | `faff/SKILL.md → ### Rendering … rendering_adaptor` | reference-only (verify each isn't restating) | FAFF-116/117 |
| Untrusted-input no-execute floor | **10** | `faff/SKILL.md → ### Untrusted input (no-execute floor)` | reference-only | FAFF-116/117 |
| Automation eligibility | **7** | `faff/SKILL.md → ### Automation eligibility` | reference-only (mostly already) | FAFF-116 |
| Autonomous Mode Contract preamble | **6** | `faff/SKILL.md → ### Autonomous Mode Contract` | reference-only | FAFF-116 |
| Agent Lanes | **6** | `faff/SKILL.md → ## Agent Lanes` | reference-only | FAFF-116 |
| Spec readiness (fixed) producer contract | **6** | `faff/SKILL.md → ### Spec readiness (fixed)` | reference-only (faff-prep re-defines ~20 lines) | FAFF-115/117 |
| Spec discovery | **5** | `faff/SKILL.md → ### Spec discovery (…)` | reference-only | FAFF-116 |
| Park / Unpark protocol | **5** | `faff/SKILL.md → ### Park protocol (shared)` | reference-only (faff-prep carries detail) | FAFF-116 |
| Next-step transition / `faff next` | **5** | `faff/SKILL.md → ### Next-step transition …` | reference-only | FAFF-116 |
| Ignore cancelled & archived | **4** | `faff/SKILL.md → ### Ignore cancelled and archived` | reference-only (verify) | FAFF-116 |
| Worktree policy | **4** | `faff/SKILL.md → ### Worktree policy` | reference-only (faff-graft restates detail) | FAFF-115/116 |
| Issue claim & status monotonicity | **3** | `faff/SKILL.md → ### Issue claim & status monotonicity (… FAFF-82)` | reference-only (faff-graft restates ~10 lines) | FAFF-116 |

**Headline:** the gateway homes mostly **exist** and most clusters **already refer back** — the residual duplication is (a) the un-homed **"Load the gateway first" preamble** (9 files, FAFF-115 creates the home) and (b) a handful of skills that **restate** rather than reference (faff-prep on Spec-readiness ~20 lines; faff-graft on status-monotonicity ~10 lines + worktree detail). The big surface-area numbers (Rendering 14, Untrusted-input 10) are mostly legitimate refer-backs — FAFF-116/117 should **verify, not assume**, before cutting.

## Recommended worklist priority (for the chain)

1. **FAFF-115** — create the `### Entry preamble` home (the one un-homed cluster) + restructure; collapse the 9 preambles to one-line pointers. Preserve the 5 frozen eval anchors (see FAFF-115 spec).
2. **FAFF-116** (orchestration skills) — the FAFF-NN DROPs (esp. the gateway's 36 + the FAFF-109/81/22 over-repeats), the restate-vs-reference fixes (graft/prep), the paragraph-to-list conversions.
3. **FAFF-117** (slot skills) — slot-skill FAFF-NN DROPs + paragraph conversions.
4. **FAFF-120** — codify the keep/drop threshold + the lists-not-paragraphs rule as the authoring charter + lint.

*Census is reproducible (re-run the commands above); verdicts are judgement, each with its reason, so a reviewer can contest any call. Disposal of this doc is a one-line follow-up once FAFF-115/116/117 close.*
