# FAFF-607 — Execute the gateway kernel/reference split

> Spec: faffter-dark-nlspec · 2026-09-01 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-607.

> Revised 2026-09-01 through six spec-review rounds (final: approve). Fixes folded: QA — replaced the non-existent "nine-verb seam suite" with the concatenation-diff oracle; architectural — added the matrix-driven under-read completeness lint, retargeted the line-cap ratchet to the kernel file, and reconciled the REFER_BACK adaptor lint; infosec — kept both safety floors (Untrusted input, Blast-radius boundary) in the kernel. Human-ratified architecture decisions: D3 — separate the bare-`/faff` gateway (`faff/SKILL.md`, routing + narrative + first-run offer) from the kernel sub-skills Read (`faff/references/kernel.md`, Band A), and collapse the inline First-run offer to a one-line `/faff-onboard` pointer; D5 — one coarse `tracker.md`. Confidence raised medium → high once the punts closed.

This is the build spec for FAFF-607, "Execute the gateway kernel/reference split". It is written for the build agent that will carry out the split and for the human reviewers who gate it. The issue is a Size-L restructuring of `plugin/skills/faff/SKILL.md` (the faff gateway) from one monolith that every consuming skill Reads whole into a lean kernel plus a set of on-demand reference files. The related prose-lean work FAFF-487 (trim the biggest static-context contributors) ships separately in PR #814; this spec is the structural split, not the prose trim, and the two coordinate at the shared line-cap baseline.

## 1. WHY — problem and principles

**The one idea.** Every faff sub-skill Reads the whole gateway on entry (`faff-graft` line 14: "Load the gateway first. If `faff/SKILL.md` isn't in context this turn, Read it now"). Under Claude Code progressive disclosure, a bundled file that is not `SKILL.md` stays out of a subagent's context until that subagent explicitly Reads it. So if the gateway is split into a small kernel (`faff/references/kernel.md`) plus lane `references/*.md` files — with the bare-`/faff` routing left in `faff/SKILL.md`, which sub-skills no longer Read (D3) — a block a given subagent never Reads never enters its context and is never billed to it. The whole change turns on that one property; no new runtime feature is needed.

**Problem statement.** The gateway is 1169 lines and about 66,165 estimated tokens (the pinned baseline `eval/baselines/pre-split-snapshot-20260901.json`), and each of an L4 run's ~843 API calls carries it resident and re-billed as `cache_read`, which the tokenomics bench shows is the dominant static-context cost. Roughly 47k of those tokens are lane-scoped prose that most callers never act on. Splitting the monolith into a universal kernel plus lane-scoped references lets each subagent carry only the kernel plus the references its lane consumes, cutting the resident prefix without losing any content.

**Design principles.**

**Single source of truth.** Each block has exactly one home after the split, either the kernel or one reference file. Prose is moved, never copied. The existing duplicated-block lint in `validate-adapters.js` (the `DUP_BLOCK_WINDOW` cross-file check) already fails copied prose across `SKILL.md` files; references must not reintroduce copies by another route.

**Behaviour parity is the ceiling, and it is born-verifiable by construction.** The split relocates prose; it changes no rule, contract, or control flow. The oracle is mechanical, not a behavioural test suite, and its **corpus is exactly the gateway-prose files**: `faff/SKILL.md` + every `faff/references/*.md` (the glob already includes `kernel.md`). Concatenate that corpus and diff it against the pre-split `faff/SKILL.md` monolith; within this corpus the only differences must be block *relocations* (same text, new file) plus **one documented content change** — the First-run block collapses from the inline soft-offer to a one-line `/faff-onboard` pointer in the kernel (the heavy offer stays in `faff/SKILL.md`). Any *other* content edit inside a moved block, or any dropped block, is a defect. The two changes that are NOT in this corpus — the rewritten "Load the gateway" load-lines in the 20 consuming skills, and the `validate-adapters.js` lint edits — live in other files and are verified separately (the load-lines by the orphan/under-read lints, the lint code by its own tests), not by this diff. There is deliberately no dependence on a "nine-verb behaviour suite" — none exists in the tree, so the concatenation-diff (plus the lints and the tokenomics bench below) is the whole parity story.

**Measurement is the authority, not the 2026-07-21 hand map.** The issue's original "≤200-line kernel, six named references" bullet is the pre-measurement hypothesis and is explicitly not settled. Placement is re-derived at build time against the prefix-planner (`eval/prefix-planner.mjs`) and the authoritative per-block manifest `eval/baselines/gateway-usage.json` (FAFF-963), and the saving is proven with `eval/tokenomics.mjs` against the pinned baseline. The kernel is sized to a token target (~16-20k), not to a line count; the ≤200-line figure is superseded.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` | Markdown | The monolith being split into kernel plus references |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node (CommonJS) | Holds `SKILL_LINE_BASELINE` (the ratchet), `anchorResolves` + heading pooling (the anchor lint), and the per-file checks; all three need extending |
| `eval/prefix-planner.mjs` | Node (ESM) | Segments the gateway by heading, scans usage, computes `contiguity_tax`; the tool that weighs clustering |
| `eval/tokenomics.mjs` | Node (ESM) | Prices a per-call prefix; `--fixed <old> --lean <new>` proves the saving |
| `eval/baselines/pre-split-snapshot-20260901.json` | JSON | The pinned before-baseline: gateway 66,165 tok, run cost $132.91, $4.34 saved per 10k prefix tokens shaved |
| `eval/baselines/gateway-usage.json` | JSON | The FAFF-963 authoritative block-to-consumer manifest; the placement authority |
| The 20 consuming skills (see appendix A) | Markdown | Each carries a "Load the gateway" line to be rewritten |

**Scope statement.** This sits under the "Cost-aware model and transport routing" project as the structural half of FAFF-487's static-context trim; the prose-lean half is PR #814.

## 2. OUT OF SCOPE

- **Prose leaning of block content** — Excluded: FAFF-487 (PR #814) owns trimming the words inside blocks. This ticket moves blocks intact. Extension point: the two coordinate only at the shared `SKILL_LINE_BASELINE.faff` value in `validate-adapters.js`.
- **Contract-prose generation** — Excluded: FAFF-598 (DONE, PR #485) already made the `## Core contracts` verdict sections into pointers generated by `faff contract <name> --describe`. Those pointer lines stay in the kernel; only the surrounding descriptive prose moves. Extension point: `faff contract-defs/`.
- **History-growth (the non-prefix half of per-call context)** — Excluded: the issue names it as a separate open question. Extension point: FAFF-486 (context-lifetime reduction).
- **The review-call `--context` payload** — Excluded: FAFF-882 and FAFF-883 own the 262 KB gateway handed to review calls. Extension point: `eval/review-call.mjs`.
- **A new read-on-demand runtime mechanism** — Excluded: the issue floated a possible spike. This spec resolves that no new mechanism is needed (progressive disclosure already gives it), so the spike is not run. Extension point: none required.
- **Rewriting the authoritative matrix** — Excluded: FAFF-963 owns `gateway-usage.json` and its CI lint. This ticket consumes the matrix and reconciles placement against it, it does not redesign it.

## 3. WHAT — vocabulary, structure, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Kernel | `plugin/skills/faff/references/kernel.md`: the universal Band A core every sub-skill Reads. A **separate file** from the bare-`/faff` gateway (`faff/SKILL.md`), so a sub-skill never inherits the routing dispatch it cannot trigger (D3). |
| Bare-`/faff` gateway | `plugin/skills/faff/SKILL.md`: the skill invoked by a bare `/faff` — holds the Routing dispatch table + fallbacks + the "what faff is" narrative + the First-run offer. Loads only on a bare `/faff` invocation; sub-skills do not Read it. |
| Reference | A file under `plugin/skills/faff/references/` holding one lane-scoped cluster, Read only by the skills whose lane consumes it |
| Band A | Near-universal core prose that stays in the kernel (~16k tok) |
| Band B | Gateway-entry-only prose with no sub-skill consumer (~3.2k tok): the "what faff is" narrative and the entry logic |
| Band C | Lane-scoped or role-scoped prose that moves to references (~47k tok) |
| Load-line | The "Load the gateway first / Read `faff/SKILL.md`" instruction in a consuming skill, rewritten to "Read the kernel, then Read the references this skill consumes" |
| Contiguity tax | The prefix-planner metric for how much a skill over-carries under a single shared layer ordering versus carrying exactly what it needs |

**Band placement.** The kernel keeps Band A; references take Band C; Band B leaves the injected prefix.

The bare-`/faff` gateway and the shared kernel sub-skills Read are **separate files** (decision D3): operators enter via a specific skill, never bare `/faff`, so the routing dispatch a sub-skill inherits today is pure dead weight. `faff/SKILL.md` stays the bare-`/faff` skill (routing + narrative); the kernel sub-skills Read is `faff/references/kernel.md`.

```
faff/SKILL.md  (the bare /faff skill — loads ONLY on a bare /faff invocation):
  the top-level Routing command table + Routing fallbacks; the "what faff is" narrative
  + L1-L4 levels tables + mechanical-vs-model-compliance table; the First-run setup offer.
  Sub-skills do NOT Read this file.

KERNEL faff/references/kernel.md  (Band A — what every sub-skill Reads, target ~16-18k tok):
  Configuration; Slots; Sibling-skill invocation; Contract loading & conformance;
  .faff/ logging; Untrusted input (no-execute floor); Blast-radius boundary (safety floor);
  Install health (doctor-at-entry); Ordering & judgement delegation; Interactive next-step offer;
  Rendering pointer; Always pull fresh; Governing principles;
  Core contracts and adaptor slots (pointer lines only); Shared Rules preamble;
  a ONE-LINE first-run pointer ("no .faffrc resolved -> tell the user to run /faff-onboard"),
  NOT the heavy inline soft-offer (that stays in faff/SKILL.md + /faff-onboard).

LEAVES THE SUB-SKILL PREFIX ENTIRELY (Band B, now in faff/SKILL.md only):
  Routing + Routing fallbacks (bare-/faff dispatch — a specific-skill entry never triggers it);
  the "what faff is" narrative + levels tables; the heavy First-run offer machinery.
```

**Reference decomposition (Band C, six coarse files).** Grouped by consumer signature. Exact per-block placement is reconciled against `gateway-usage.json` at build time; the table is the intended carve.

| Reference | Blocks moved | Consumer set |
|---|---|---|
| `references/build.md` | Worktree policy; Issue claim & status monotonicity; Implementor lane | graft, beep-boop, tidy |
| `references/tracker.md` | Spec discovery; Next-step transition; Tracker availability resolution; Lean tracker reads; Satisfied blockers; Ignore cancelled and archived; Re-ground before gate | prep, graft, beep-boop, tidy, wtf, map, jot |
| `references/autonomous.md` | Autonomous Mode Contract; Appetite for destruction; Resolve-attempt before park; Calibration log; Park/Unpark protocol; Install health; Workable vs terminal states | beep-boop, and the autonomous paths of graft, prep, tidy |
| `references/review.md` | Review-verdict prose; Spec-review-verdict prose; Delivery-outcome prose; Review-findings comment identity; Automation-routing-verdict prose (non-pointer prose only; the FAFF-598 pointer lines stay in the kernel) | graft, prep, the review/ship/routing occupants |
| `references/methodology.md` | The methodology slot (14-output table); Transport; Automation eligibility; Human curation is authoritative | the methodology occupants, plus tidy, plot, map, wtf, beep-boop |
| `references/l4.md` | The concurrency slot contract (fixed); Mechanism slot; Evaluator lane; env/transport pointers | the concurrency/evaluator/env/transport/prd occupants, plus the L4 paths of beep-boop and graft |

**Load-line contract (the rewrite pattern).** Each of the 20 consuming skills replaces its single "Load the gateway" line with a two-part instruction. Pseudocode for the shape, not the exact wording:

```
**Load the kernel first.** If faff/references/kernel.md is not in context this turn, Read it now
  (shared rules + fixed-contract pointers). Do NOT Read faff/SKILL.md — that is the bare-/faff
  routing gateway, which a specific-skill entry never needs.
**Then Read the references this skill consumes:** faff/references/<X>.md, faff/references/<Y>.md
  — only these; do not Read references your lane never touches.
```

An autonomous-capable writer (beep-boop, and the autonomous paths of graft, prep, tidy) additionally Reads `references/autonomous.md`. An interactive-only entry (wtf, map, jot, onboard, plot) never lists it, which is what makes acceptance criterion 5 hold.

**Type of the reference index (what the lints enforce).**

```
RECORD ReferenceFile:
  path: string          # faff/references/<name>.md, must exist on disk
  headings: Set<string> # pooled into the anchor-resolution set
  consumers: Set<skill> # >= 1 skill must Read it (no orphan)

CONSTRAINT every ReferenceFile.consumers is non-empty       # orphan lint (FAIL)
CONSTRAINT every "gateway -> **Section**" anchor leaf resolves against
           (kernel.headings UNION all ReferenceFile.headings) # anchor lint, extended scope
```

**Design decision markers.** The decisions are collected in section 6; the canonical markers appear there and in section 7.

## 4. HOW — behaviour

**Architecture and approach.** The split is a pure content relocation plus a lint extension plus a load-line rewrite. Nothing in the `faff` CLI, the contracts, or any skill's control flow changes. The work is a Size-L change, so it ships in slices (decision D6): the first slice proves the mechanism end-to-end on one cluster, then the remaining clusters follow.

**First slice (proves the mechanism).**

```
PROCEDURE first_slice_build_cluster:
  1. Create plugin/skills/faff/references/build.md; MOVE its blocks out of the kernel
     verbatim (cut, not copy).
  2. Rewrite the load-line in faff-graft, faff-beep-boop, faff-tidy to Read the kernel
     + references/build.md.
  3. Extend validate-adapters.js: pool references/*.md headings into the anchor set;
     scan reference bodies for anchor refs; add the orphan-reference FAIL lint.
  4. Retarget the ratchet: add the path-keyed cap on faff/references/kernel.md (committed kernel
     line count) and drop the faff bare-gateway baseline to the new faff/SKILL.md line count;
     reconcile REFER_BACK to accept the kernel path.
  5. Measure: run eval/tokenomics.mjs --transcript <run> --fixed 66165
     --lean <graft-resident = kernel + build.md tokens> --json, diff against the pinned
     baseline. Confirm a real drop on the build-subagent prefix.
  6. Confirm parity by the concatenation-diff oracle: cat the kernel + references/build.md +
     the still-monolithic remainder, diff against the pre-split monolith, expect only the
     build-cluster relocations + the three rewritten load-lines + the lint changes.
```

If the first slice measures a real saving and parity holds, the remaining five references and the other 17 load-lines follow the same steps in one or more further slices. If it does not, the mechanism assumption is wrong and the sweep does not proceed (see Failure modes).

**Anchor resolution across kernel and references.** Today `validate-adapters.js` pools `##`/`###` headings only from `<skill>/SKILL.md` files (the `allSkills` glob at line 762, the heading pool at lines 869-911) and resolves every `-> **Target**` ref against that pool at lines 953-969, at WARN severity. After the split, a `gateway -> **Worktree policy**` anchor points at a heading that now lives in `references/build.md`, which the current pool never reads, so it would warn falsely.

```
PROCEDURE extend_anchor_lint:
  1. After the per-skill heading pass, glob faff/references/*.md.
  2. For each reference file: collect its ## / ### headings into the SAME pooled
     `headings` Set used by anchorResolves.
  3. Also scan each reference body for `-> **Target**` anchors (references cross-refer),
     resolving them against the same pool.
  4. Keep the existing anchor check at WARN for the pre-existing ~200-anchor web
     (a hard gate on first pass would red-CI the tree, per the FAFF-584 note in the code).
  5. The split itself must introduce ZERO new unresolved anchors: every anchor whose
     target moved must still resolve because its heading is now pooled from a reference.
```

**Orphan-reference lint (new, FAIL severity) — the no-reader half.**

```
PROCEDURE orphan_reference_lint:
  1. reference_files := glob faff/references/*.md
  2. FOR each rf in reference_files:
       consumers := skills whose SKILL.md Reads "faff/references/<rf>"
       IF consumers is empty:
         FAIL "reference <rf> is Read by no skill — orphaned; fold it into the kernel
               or delete it"
  3. FOR each skill load-line naming faff/references/<name>:
       IF no such file exists:
         FAIL "<skill> Reads faff/references/<name> which does not exist"
```

**Under-read completeness lint (new, FAIL severity) — the under-read half.** The orphan lint catches a reference *nobody* reads; it does NOT catch the more dangerous case — a skill that *needs* a reference but omits it from its load-line, silently dropping a rule from that lane. This lint closes that, driven by the authoritative matrix so it is not a second guess:

```
PROCEDURE under_read_completeness_lint:
  1. matrix := parse eval/baselines/gateway-usage.json  (block -> consumer skills, FAFF-963)
  2. placement := for each moved block, the reference file it now lives in (from the
     decomposition table; derivable by scanning which references/*.md holds its heading)
  3. FOR each skill S in the 20 consumers:
       needed_refs := { placement[b] : block b whose matrix consumer-set includes S }
       declared_refs := references named in S's load-line
       missing := needed_refs - declared_refs
       IF missing is non-empty:
         FAIL "<S> consumes blocks in <missing> (per gateway-usage.json) but its load-line
               does not Read them — under-read; add them to the load-line"
```

Together the two lints are the machine-checkable whole of the single-source-plus-completeness principle: a reference nobody Reads is dead prose that fell out of the prefix silently (orphan), a Read of a missing reference is a broken load-line (orphan step 3), and a lane that needs a reference but does not Read it is a silently-dropped rule (under-read). The under-read lint depends on `gateway-usage.json` being current (assumption below); a block still classed `unknown` in the matrix is reported as a WARN (cannot compute its consumer set), never a false FAIL.

**Reconcile the existing `REFER_BACK` adaptor lint with D3 (round-4 architectural fix).** `REFER_BACK = /Read[^\n]*\bfaff\/SKILL\.md/` (validate-adapters.js line 116) runs for `case "adaptor"` (line 351) and requires an adaptor's `SKILL.md` to carry a literal `Read … faff/SKILL.md`. `faffidavit-routing` is `type: "adaptor"` (line 15) and one of the 20 consuming skills, so the D3 load-line rewrite ("Read `faff/references/kernel.md`, do NOT Read `faff/SKILL.md`") would either red-CI it (the required literal is gone) or pass only by the "do NOT Read faff/SKILL.md" clause coincidentally matching the regex — silently inverting the guard. The fix: **update `REFER_BACK` so the refer-back requirement is satisfied by reading the kernel** (`faff/references/kernel.md`), not the bare gateway — the guard's intent is "an adaptor refers back to the shared gateway prose", which post-D3 lives in the kernel. Verify `faffidavit-routing` passes `faff validate-adapters` on the rewritten load-line.

**Kernel line-cap ratchet (retargeted for D3 — the round-4 architectural fix).** `SKILL_LINE_BASELINE = { faff: 1170, "faff-beep-boop": 763, "faff-graft": 854 }` is a zero-headroom downward ratchet (lines 876-886): growth fails, a shrink prints a non-failing `RATCHET` advisory. **Post-D3 the file the split keeps lean is `faff/references/kernel.md`, NOT `faff/SKILL.md`** — but the ratchet only iterates directories that contain a `SKILL.md` (the `allSkills` glob, lines 762-763, applied at line 879), so a references file is never line-capped. Two coupled changes are required, or the split's primary lean-target ships ungated:
  1. **Extend the ratchet to cap `faff/references/kernel.md` by path** (a path-keyed baseline entry alongside the dir-keyed ones, or a dedicated kernel cap), set to the committed post-split kernel line count. This is the gate that actually locks the kernel's leanness.
  2. **Drop the existing `faff` (bare-gateway) baseline** to the new, much smaller `faff/SKILL.md` line count (routing + narrative + first-run offer only) so the bare gateway is still ratcheted, just at its own reduced size.
The ≤200-line title figure is not the target for either file; each is sized to its content and its baseline set to the committed line count. Coordinate the `faff` value with PR #814 so the two do not fight over the same constant (see Assumptions).

**Prefix-planner post-split measurement.** `eval/prefix-planner.mjs` segments only `faff/SKILL.md` (line 206, `segmentGateway`). After the split the moved blocks are no longer in that file, so the planner would under-count the gateway. The primary size proof is `tokenomics.mjs --lean` with the hand-measured per-lane prefix, which does not depend on the planner. The planner is extended modestly so `contiguity_tax` stays computable: segment the kernel plus every `references/*.md` as the block set, so the classify/cluster/report path keeps working across the split corpus. This keeps the clustering-granularity check (decision D4) reproducible after the split, not only before it.

**Edge cases and error handling.**

- **A block with two genuine consumer clusters.** Place it in the reference whose consumer set is the superset, or, if the sets are disjoint, keep it in the kernel rather than copy it into two references. Copying is forbidden by the single-source principle and would trip the dedup lint.
- **The top-level `/faff` invocation needs Routing.** Routing stays in `faff/SKILL.md` (the bare-`/faff` skill), which the bare invocation loads; sub-skills never Read that file, so they never carry routing. The dominant win is Band C.
- **Security-floor blocks stay in the kernel.** Both `Untrusted input (no-execute floor)` and `Blast-radius boundary` are Band A and stay in the kernel so every lane carries them unconditionally — a safety floor a subagent could silently fail to Read is fail-open, which the split must never introduce. This is the resolved half of D5: `Blast-radius boundary` does not move to `build.md`.

**Failure modes.**

- **The saving does not materialise.** The approach assumes a subagent only carries references it Reads. How you would know: `tokenomics.mjs --lean <graft prefix>` shows no drop versus the pinned baseline on the first slice, or the measured build-subagent resident prefix is still near 64k. What it means: the progressive-disclosure assumption is wrong for this harness path; abandon the sweep and re-open the mechanism question before touching the other 17 skills. This is why the first slice is measured before the sweep.
- **A skill silently loses content it needs.** Moving a block out of the kernel and forgetting to add the reference to a consumer's load-line drops a rule from that lane. How you would know: the **under-read completeness lint** fails when a skill's load-line omits a reference its `gateway-usage.json` consumer-set requires — this is the primary, mechanical gate for exactly this failure, not a behavioural test. The concatenation-diff additionally proves the block still exists somewhere (it moved, it was not deleted). What it means: fix the load-line; the FAIL blocks merge.
- **Contiguity tax eats the saving.** If clusters are too fine, a skill carries many layers to reach the last one it needs. How you would know: the planner's `contiguity_tax` rises materially against the coarse baseline. What it means: the coarse six-file carve (D4) is preferred precisely to keep the tax low; only split a reference finer if the bench shows disjoint consumer sets and a net win.

**Anti-pattern:** copying a shared block into two references so both consumers "have it locally". Why: it breaks single-source, drifts on the next edit, and trips the `DUP_BLOCK_WINDOW` lint. Keep it in the kernel instead.

**Anti-pattern:** raising the kernel's line cap to fit the kernel. Why: the ratchet is downward-only; the kernel must land under a smaller number, not grow the cap to fit.

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the split has landed
When the corpus faff/SKILL.md + every faff/references/*.md (the glob includes kernel.md) is
     concatenated and diffed against the pre-split faff/SKILL.md monolith
Then within that corpus the only differences are block relocations (same text, new file) and the one
     documented First-run rewrite (inline offer -> kernel pointer) — no other content edit inside a
     moved block, no dropped block. (The load-line rewrites in the 20 skills and the
     validate-adapters.js edits are out-of-corpus and verified separately.)
```

```
Given the split has landed (kernel = faff/references/kernel.md; bare gateway = faff/SKILL.md)
When `faff validate-adapters` runs
Then the kernel's own line-cap (the new path-keyed cap on faff/references/kernel.md) passes, the
     dropped faff bare-gateway baseline passes, and the kernel measures materially smaller than the
     66,165-token monolith (target ~16-18k tok)
```

```
Given the kernel plus references on disk
When `faff validate-adapters` runs its anchor and orphan lints
Then every "gateway -> **Section**" anchor leaf resolves against the pooled kernel+reference
     headings, and every references/*.md file is Read by at least one skill with no orphan
```

- The concatenation-diff parity check, the line-cap gate, and the anchor / orphan / under-read lints are visible to the builder. The two measurement scenarios are held out for the code-blind evaluator: each is a different concrete instantiation of the size-and-cost objective the WHY and the acceptance basis already require, verified against the running artifacts rather than re-derived from prose.

## 6. Design decision rationale

**D1 — Does the split need a new read-on-demand runtime mechanism?**
Options: (a) build a runtime mechanism for shared files; (b) rely on ordinary Claude Code progressive disclosure. Progressive disclosure already keeps a bundled non-`SKILL.md` file out of context until Read, which is exactly the property required.
**Chosen:** ordinary progressive disclosure, no new mechanism, no spike. This resolves the issue's open mechanism question.

**D2 — Which bands go where?**
Band A (universal core) stays in the kernel; Band C (lane-scoped) moves to references; Band B (entry-only narrative) leaves the prefix. Keeping Band A resident is cheap (~16k) and every lane needs it; moving Band C is where the ~47k saving lives.
**Chosen:** the kernel sub-skills Read (`faff/references/kernel.md`) = Band A only; references = Band C; Band B (routing + narrative + first-run offer) stays in the bare-`/faff` `faff/SKILL.md`, which sub-skills do not Read (see D3).

**D3 — Separate the bare-`/faff` gateway from the kernel sub-skills Read.**
Operators enter via a specific skill (`/faff-prep`, `/faff-graft`, …), never bare `/faff`, so the Routing dispatch table and fallbacks — the whole point of a bare-`/faff` invocation — never execute in a sub-skill and are pure dead weight when a sub-skill Reads "the gateway". The narrative and the first-run offer are likewise not sub-skill concerns.
**Chosen:** the bare-`/faff` gateway (`faff/SKILL.md`) and the shared kernel (`faff/references/kernel.md`) are **separate files**. `faff/SKILL.md` keeps Routing + fallbacks + the "what faff is" narrative + the heavy First-run offer machinery, and loads only on a bare `/faff` invocation. Sub-skills Read `faff/references/kernel.md` (Band A) + their lane references, and never Read `faff/SKILL.md`. So routing/narrative/first-run-offer leave every sub-skill and build-subagent prefix outright.
**Chosen (First run):** replace the heavy inline soft-offer (offer + decline-stub write + ensurers) in the kernel with a **one-line pointer** — "no `.faffrc` resolved → tell the user to run `/faff-onboard`". The onboarding machinery already lives in `/faff-onboard`; the bare-`/faff` gateway keeps the full offer for the bare-entry path. This is a small **behaviour change** (inline offer → pointer), the one documented exception to the concatenation-diff parity oracle — see the carve-out note under section 5.
**Chosen (Install health):** the `faff doctor` entry check stays in the kernel (Band A) — it is the one genuinely useful entry check and beep-boop consumes its exit code.

**D4 — Reference clustering granularity: coarse or fine?**
Options: few broad references (one per consumer cluster) or many fine references (near one per block). Fine references only help when consumer sets are disjoint; otherwise they raise the planner's `contiguity_tax` because a skill carries every layer up to the last one it needs. The consumer sets here overlap heavily (tracker-read and build lanes share several skills).
**Chosen:** six coarse references, one per consumer cluster, validated against `contiguity_tax` on a planner bench. Refine a single reference only if the bench shows a disjoint set and a net win.

**D5 — The security-floor and synthesis boundaries.**
The `Blast-radius boundary` placement is now **Chosen**, not punted: it stays in the kernel as a safety floor beside `Untrusted input`, because a safety floor a lane could silently fail to Read is fail-open (spec-review infosec objection). One boundary remains genuinely open: how much of the tracker-availability and lights-out control-plane prose fuses into a single `tracker.md` reference versus staying split — resolved to one coarse `tracker.md` (D4's coarse default), reconciled against the matrix at build.
**Chosen:** `Blast-radius boundary` stays in the kernel (both security floors are universal); one coarse `tracker.md`.

**D6 — One PR or slice by cluster?**
A Size-L change touching 20 skills plus the lints in one PR is hard to review and risky if the mechanism assumption is wrong.
**Chosen:** slice by cluster. First slice = the build/graft cluster (`references/build.md` + the graft/beep-boop/tidy load-lines + the lint extensions + the ratchet), measured end-to-end to prove the saving, then sweep the remaining five references and 17 load-lines.

**D7 — Anchor lint and orphan lint scope.**
Options: leave the anchor lint scanning only `SKILL.md` files, or extend it. Leaving it would false-warn on every moved section and would not catch orphaned references.
**Chosen:** pool `references/*.md` (incl. `kernel.md`) headings into the anchor set, scan reference bodies for anchors, add an orphan-reference FAIL lint plus a missing-reference FAIL, add the matrix-driven under-read completeness FAIL lint (a skill that omits a reference its `gateway-usage.json` consumer-set requires), **reconcile the existing `REFER_BACK` adaptor lint to accept the kernel path** (round-4 fix — else `faffidavit-routing` red-CIs), and **retarget the line-cap ratchet** to a path-keyed cap on `faff/references/kernel.md` while dropping the `faff` bare-gateway baseline (round-4 fix — else the kernel ships ungated). Keep the pre-existing anchor web at WARN. The orphan and under-read lints are complementary halves: no-reader and needed-but-unread.

**D8 — Kernel line-cap value.**
Options: pin to the issue's ≤200-line title figure, or set the baseline to the measured post-split kernel size at the ~16-20k token band.
**Chosen:** size the kernel to the token band; add a **path-keyed cap on `faff/references/kernel.md`** set to its committed line count (the ratchet that actually locks the kernel), and separately drop the `faff` bare-gateway baseline to the new `faff/SKILL.md` size. The ≤200-line figure is the superseded pre-measurement hypothesis. Temporal anchor: at the time of writing the monolith is 1169 lines / 66,165 tok and PR #814 is trimming prose in parallel, so fix both values at merge against the actual committed files.

## 7. Open questions and assumptions

**Open questions.** All architecture punts are resolved (D3 gateway/kernel separation + First-run collapse + Install-health placement; D5 blast-radius kernel floor + one coarse `tracker.md`). One measurement target remains, not a blocker:

- **wtf ≤20k target** — The issue's success metric wants interactive `/faff-wtf` entry at ≤20k real tokens. If the kernel lands at the top of the ~16-18k band, wtf plus its tracker/methodology references may exceed 20k. Treated as a target to measure, not a hard gate; if it overshoots, lean the kernel further (coordinating with PR #814) rather than block the split. Decides: any.

**Assumptions.**

- **FAFF-584's `SKILL_LINE_BASELINE` exists.** Validate: `grep SKILL_LINE_BASELINE plugin/skills/faff/bin/lib/validate-adapters.js` shows `{ faff: 1170, ... }`. Confirmed at spec time; FAFF-584 is DONE (PR #617).
- **The tokenomics harness, prefix-planner, and pinned baseline exist.** Validate: `ls eval/tokenomics.mjs eval/prefix-planner.mjs eval/baselines/pre-split-snapshot-20260901.json`. Confirmed at spec time.
- **The authoritative matrix `gateway-usage.json` is current.** Validate: read `eval/baselines/gateway-usage.json` and confirm every gateway block has a claimed consumer before finalising placement; if a block is `unknown`, narrow it with the planner's `--emit-manifest` and a human pass before moving it.
- **PR #814 (FAFF-487 prose lean) coordinates on the shared baseline.** Validate: before setting the `faff` baseline, check whether #814 has merged; set the ratchet against the actual committed file sizes, not a stale number.

## 8. DONE — definition of done

### From WHY
- [ ] The gateway is split into the bare-`/faff` gateway `plugin/skills/faff/SKILL.md` (routing + narrative + first-run offer), the kernel `plugin/skills/faff/references/kernel.md` (Band A), and the lane references `plugin/skills/faff/references/*.md`; no block appears in more than one place (dedup lint green).
- [ ] Behaviour parity holds by the concatenation-diff oracle over the corpus `faff/SKILL.md` + `faff/references/*.md` (the glob includes `kernel.md`), diffed against the pre-split monolith: within-corpus differences are only block relocations and the one documented First-run rewrite (inline offer → kernel pointer) — no other content edit, no dropped block. (Load-line rewrites and validate-adapters.js edits are out-of-corpus, verified separately.)

### From WHAT (structure)
- [ ] `faff/references/kernel.md` holds only Band A (incl. Install health + the one-line first-run pointer); `faff/SKILL.md` retains Routing + fallbacks + the "what faff is" narrative + the heavy First-run offer; sub-skills Read the kernel, never `faff/SKILL.md`.
- [ ] Six references exist under `references/`, each holding the blocks in the decomposition table, reconciled against `gateway-usage.json`.
- [ ] `references/autonomous.md` is Read only by beep-boop and the autonomous paths of graft/prep/tidy, and by no interactive-only entry.

### From HOW (load-lines)
- [ ] Each of the 20 consuming skills (appendix A) has its "Load the gateway" line rewritten to Read the kernel then Read only the references its lane consumes.
- [ ] No load-line names a reference file that does not exist (missing-reference lint green).

### From HOW (lints)
- [ ] `validate-adapters.js` pools `references/*.md` headings into the anchor set and scans reference bodies for anchors; every `gateway -> **Section**` anchor leaf resolves against kernel+reference headings (no new unresolved anchor introduced by the split).
- [ ] A new FAIL-severity orphan-reference lint fails any `references/*.md` Read by no skill, and fails a load-line naming a reference that does not exist.
- [ ] A new FAIL-severity under-read completeness lint (driven by `gateway-usage.json`) fails any skill whose load-line omits a reference its matrix consumer-set requires; an `unknown`-classed block degrades to WARN, never a false FAIL.
- [ ] The ratchet is retargeted for D3: a path-keyed cap on `faff/references/kernel.md` (set to the committed kernel line count) locks the kernel's leanness, and the `faff` bare-gateway baseline is dropped to the new `faff/SKILL.md` line count; both line-cap gates pass.
- [ ] The `REFER_BACK` adaptor lint accepts reading `faff/references/kernel.md` as satisfying refer-back; `faffidavit-routing` passes `faff validate-adapters` on its rewritten load-line.

### From HOW (measurement)
- [ ] `eval/prefix-planner.mjs` segments the kernel plus `references/*.md` so `contiguity_tax` stays computable post-split.
- [ ] `eval/tokenomics.mjs --fixed 66165 --lean <kernel + graft references> --json` against the pinned baseline shows the build-subagent resident prefix dropping materially from ~64k toward ~25-30k, with a negative run-cost delta versus $132.91.

### From HOW (sequencing)
- [ ] The build/graft cluster ships as the first slice and is measured for parity plus saving before the remaining clusters are swept.

**Eval coverage.** This change introduces no new LLM-judgement seam (it relocates prose and extends deterministic lints), so no grader KIND or eval case is registered by this ticket.

**Integration smoke test.**

```
1. On the feature branch, run `faff validate-adapters` -> exit 0 (line cap, anchors,
   orphan-reference, under-read completeness, dedup all green).
2. Read plugin/skills/faff-graft/SKILL.md -> its load-line Reads the kernel + references/build.md.
3. Concatenation-diff: `cat faff/SKILL.md faff/references/*.md` (the glob includes kernel.md) diffed
   against the pre-split monolith shows only relocations + the one First-run rewrite (parity oracle;
   load-line + lint changes are out-of-corpus, checked separately).
4. Run eval/tokenomics.mjs --fixed 66165 --lean <graft prefix> --json -> negative cost delta.
If these four pass, the split's plumbing is connected.
```

## Appendix A — the 20 consuming skills carrying a load-line

faff-graft, faff-beep-boop, faff-prep, faff-jot, faff-plot, faff-tidy, faff-wtf, faff-map, faff-onboard, faffter-noon-concurrency-sequential, faffter-noon-evaluate, faffter-noon-spec-review, faffter-noon-transport-private-network, faffter-noon-architecture, faffter-noon-env-compose, faffter-noon-prd, faffter-noon-ship, faffter-dark-authoring-adaptors, faffter-dark-spec-review, faffidavit-routing. (Source: `grep -rln 'Load the gateway\|faff/SKILL.md' plugin/skills/*/SKILL.md`, excluding the gateway itself.)

confidence: high
spec-review: approve
build-tier: complex
