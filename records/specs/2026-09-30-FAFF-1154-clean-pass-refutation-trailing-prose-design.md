# FAFF-1154: recognise a clean-pass refutation when guard-clean prose follows the affirmation

> Spec: faffter-dark-nlspec · 2026-09-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1154.

This spec is the buildable artifact for FAFF-1154 (Linear, Bug). It is written for the build agent that will change `normaliseCleanRefutation` and its mirror, and for the human reviewers who gate the spec. It describes a narrow, additive widening of one heavily-iterated function in the adversarial-review transport. Read the "Already shipped against this surface" section first: this is the fifth widening of `normaliseCleanRefutation`, and the exact trailing-prose case FAFF-1053 listed and declined, so the change must extend that lineage without regressing any earlier guard.

## 1. WHY: Problem and principles

**The model to hold in your head.** A spec-refuter speaks a closed grammar: to pass a lens cleanly it emits one byte-exact affirmation sentence (`No <lens> objection.`), optionally under a heading. `normaliseCleanRefutation` rewrites any recognised clean form to the canonical token `### observation: no findings` so the downstream parser sees a clean pass. Today that recognition requires the affirmation to be the **final non-blank line** of the body. When a reasoning model (notably opus-5.5 at high effort) emits the correct affirmation and then explains its reasoning underneath, the affirmation is no longer last, recognition fails, and `parseRefutation` finds no `### <severity>:` section and faults. A correct approval is thrown away as an unparseable error.

**Problem statement.** Status quo: a clean pass is recognised only when its affirmation terminates the body. Pain: a reviewer that appends explanatory prose after a correct clean token has its approval discarded as a parse fault, on the live adversarial spec-review lane and in the `refutation-spec` eval alike. This change teaches the normaliser to skip guard-clean trailing prose and recognise the affirmation that precedes it, while keeping every existing exclusion intact.

**Design principle: the fix site is the normaliser, never the parser.** `parseRefutation` faulting on a body with no `### <severity>:` section is correct behaviour: a findings-less body is a genuine fault, not a silent clean pass (that guard exists to prevent exactly the silent-drop this module was built to remove). The symptom surfaces in the parser; the fix belongs in `normaliseCleanRefutation`, which is what decides whether a body is a recognised clean pass in the first place.

**Design principle: the dangerous direction is silently dropping a real objection.** Widening recognition must never cause a body that carries a genuine finding (a `### <severity>:` section, or a wrong-lens `## Refutation —` heading) to be rewritten to "no findings." A misnormalisation the safe way (rejecting a genuine clean pass) is quiet and costly; the unsafe way (accepting a body that contains an objection) suppresses a real review finding. Every new tolerance is paired with a guard that fails toward rejection.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (`normaliseCleanRefutation`, :758-808) | JavaScript (ESM) | The fix site. Also holds `CLEAN_REFUTATIONS` and the guard regexes (:703-742). |
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` (`parseRefutation`, :128-202) | JavaScript (ESM) | Where the symptom surfaces (:150-155 fault path). Not changed. |
| `eval/review-bench/run-bench.mjs` (`isCleanRefutation`, :178-221) | JavaScript (ESM) | Hand-mirrored clean-pass detector, self-documented as "must match production." |
| `test/adversarial-call.test.mjs` (~:1795-2200) | JavaScript (ESM) | ~30 `normaliseCleanRefutation` cases across FAFF-746/927/942/1053. |

**Scope statement.** This sits entirely inside the adversarial-review clean-refutation recognition path, shared by the production spec-review lane (`runReviewChain`, `classifyCapturedResult`) and the `refutation-spec` eval (`fanRefutationSpec`). It is not eval-only.

## Already shipped against this surface

`normaliseCleanRefutation` has been widened four times, each preserving every earlier exclusion. This is the fifth.

- **FAFF-746** (Done, PR #566), accept the canonical clean prose (`No <lens> objection.`) and the wrong-lens pairing guard (`## Refutation — architectural` + `No QA objection.` stays rejected).
- **FAFF-927**, heading-level, dash-form, and case tolerance for the reserved heading; the level-agnostic severity-heading exclusion.
- **FAFF-942**, the three-line `headed+signal` arm for the methodology no-signal case.
- **FAFF-1053** (Done, PR #910), tolerate **preamble** above the affirmation. It explicitly chose "the affirmation must be the final non-blank line, preamble tolerated" (its Direction 2) over "match the affirmation anywhere / own classification" (its Directions 1 and 3, listed and declined).

FAFF-1154 is exactly the trailing-prose case that FAFF-1053's Direction-2 choice left out. FAFF-1053's acceptance still holds and must not regress: a body whose affirmation is preceded by arbitrary preamble (including ~80 reasoning lines) normalises, and a preamble carrying a genuine `### <severity>:` heading is never swallowed. This change extends the tail-match from "the affirmation is last" to "the affirmation is the last affirmation line, and any lines after it are guard-clean."

## 2. OUT OF SCOPE

- **The refuter briefs (`refute-<lens>.md`).** No brief mentions trailing prose or forbids explanation; trailing prose is model drift, not a contract violation. Tightening a brief to demand "affirmation last, no explanation" is weaker than fixing the parser (models drift regardless of instruction) and is unnecessary once the normaliser tolerates the drift. Excluded deliberately. Extension point: `plugin/skills/faffter-dark-spec-review/refute-<lens>.md` if a future issue decides to constrain reviewer output shape. See the marked decision in section 6.
- **`parseRefutation` and its fault path.** Correct as-is; the fault is the intended behaviour for a genuinely findings-less body. Extension point: `parse-refutation.mjs` only if the clean-token contract itself changes.
- **The malformed/no-findings exit classes (`10`/`11`) and `validateFindingsShape`.** Unchanged; the normaliser runs before that split and its return shape is unchanged, so those consumers keep working as-is.
- **Bold-prose or plain-prose "findings" (`**Major:** ...`).** The severity guard matches ATX headings only, not bold or prose. This is a pre-existing accepted limitation of the preamble guard, carried forward, not fixed here (see Failure modes). Extension point: `SEVERITY_LIKE_HEADING_RE` and the guard loops if a future issue decides to catch non-heading finding shapes.

## 3. WHAT: vocabulary, types, and the discriminator

**Vocabulary.**

| Term | Definition |
|---|---|
| affirmation | One of the four byte-exact sentences in `CLEAN_REFUTATIONS` (`No architectural objection.`, `No infosec objection.`, `No methodology objection.`, `No QA objection.`). |
| affirmation index | The greatest line index whose whole-line text exactly equals an affirmation sentence (the last affirmation line). |
| trailing segment | The non-blank lines after the affirmation index (empty today, since the affirmation is required last). |
| preamble | The non-blank lines before the matched form's first line (FAFF-1053's tolerated region). |
| form | The clean-pass label: `bare` / `headed` / `headed+signal` / `header-wrapped`. |

**The return shape is unchanged.** `normaliseCleanRefutation(content)` still returns `{ content, normalised, lens, form }`, the canonical token on success, the original bytes on rejection. No caller signature changes.

**Decision: fix at the normaliser, not the parser.** The parser fault is a symptom of the normaliser not recognising the clean pass. Options: (a) widen `normaliseCleanRefutation`; (b) add a clean-pass path to `parseRefutation`. Option (b) would duplicate recognition logic across two files and weaken the parser's findings-less-is-a-fault guard. **Chosen:** widen `normaliseCleanRefutation` only; `parseRefutation` is untouched.

**Decision: locate the affirmation as the last affirmation line.** Today the code reads `last = lines[lastIdx]` and matches only that line. To tolerate trailing prose it must find the affirmation among lines that are no longer last. Options: (1) match the first affirmation line; (2) match the last affirmation line; (3) match "the affirmation anywhere" without an anchor. Option (1) regresses the existing stacked-sentence test (`## Summary` + `No architectural objection.` + `No QA objection.` currently normalises on QA, the last). Option (3) has no tie-break and reintroduces the "affirmation anywhere" direction FAFF-1053 declined. **Chosen:** scan from the end for the greatest index whose line exactly equals an affirmation sentence; that is the winning affirmation and lens. When no line after it exists (the common case), behaviour is byte-identical to today. When two different lenses' affirmations appear, the last one wins, the existing tie-break, now stated explicitly, not new ambiguity.

**Decision: the trailing segment carries a bidirectional guard.** The preamble severity guard scans only lines *before* the matched segment; nothing scans after, because nothing can be after today. Tolerating trailing prose removes that free guarantee, so it must be re-added for the tail. Options: accept any trailing prose; or reject when the trailing segment contains a finding-shaped or wrong-lens heading. Accepting any trailing prose would let `No QA objection.` followed by `### major: real finding` be rewritten to "no findings", the dangerous direction. **Chosen:** reject when any trailing-segment line matches `SEVERITY_LIKE_HEADING_RE` (a genuine finding after the affirmation) or `REFUTATION_NAMESPACE_RE` (a wrong-lens or dangling `## Refutation —` heading after the affirmation). Both regexes already exist; this is a second application of them past the affirmation, mirroring the preamble scan before it.

**Decision: the four form labels are unchanged.** `form` is logged (`review-call.mjs:2041`) and asserted in tests; nothing branches on its value in production. Options: introduce a new label for trailing-prose bodies, or keep the four. A trailing-prose body is still a `bare`/`headed`/`headed+signal`/`header-wrapped` clean pass, the trailing prose is orthogonal to how the affirmation is introduced. **Chosen:** keep the four labels; the label is decided by the lines directly above the affirmation exactly as today, and trailing prose never changes it.

## 4. HOW: behaviour

**Approach.** Generalise the single anchor (`lastIdx`) to two: the affirmation index (found by scanning from the end) and the body end. Everything above the affirmation keeps the FAFF-1053 form-detection and preamble-severity logic verbatim, re-anchored from the affirmation index instead of the last line. Everything below the affirmation is validated by the new trailing guard. When the affirmation is last, the trailing segment is empty and the function behaves exactly as it does today.

```
PROCEDURE normaliseCleanRefutation(content):
  1. lines = content, CRLF-normalised, trimmed, split on "\n", blank lines dropped
  2. IF lines is empty:
       RETURN { content: original, normalised: false, lens: null, form: null }   # REJECT: empty
  3. affirmationIdx = the GREATEST i in [0 .. lines.length-1] with lines[i] exactly equal to
       some CLEAN_REFUTATIONS entry.sentence   (scan from the end; first hit going upward)
     IF none found:
       RETURN { content: original, normalised: false, lens: null, form: null }   # REJECT: no affirmation
     entry = the CLEAN_REFUTATIONS entry whose sentence === lines[affirmationIdx]
  4. # NEW: trailing-segment guard (bidirectional extension of the preamble severity scan)
     FOR each line in lines[affirmationIdx+1 .. end]:
       IF SEVERITY_LIKE_HEADING_RE.test(line) OR REFUTATION_NAMESPACE_RE.test(line):
         RETURN { content: original, normalised: false, lens: null, form: null }   # REJECT: finding/wrong-lens after affirmation
  5. # form detection, re-anchored from affirmationIdx (logic identical to today)
     above1 = affirmationIdx-1 >= 0 ? lines[affirmationIdx-1] : null
     above2 = affirmationIdx-2 >= 0 ? lines[affirmationIdx-2] : null
     IF entry.signal != null AND above1 === entry.signal AND above2 === entry.heading:
       form = "headed+signal"; start = affirmationIdx - 2
     ELSE IF above1 === entry.heading:
       form = "headed"; start = affirmationIdx - 1
     ELSE IF above1 != null AND ATX_HEADING_RE.test(above1):
       IF isDecorativeHeader(above1): form = "header-wrapped"; start = affirmationIdx - 1
       ELSE RETURN { ... normalised: false ... }   # REJECT: wrong-lens/severity heading directly above (FAFF-746)
     ELSE:
       form = "bare"; start = affirmationIdx
  6. # preamble severity guard (unchanged)
     FOR i in [0 .. start-1]:
       IF SEVERITY_LIKE_HEADING_RE.test(lines[i]):
         RETURN { ... normalised: false ... }   # REJECT: genuine finding in preamble
  7. RETURN { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form }
```

The only behavioural changes are step 3 (anchor is the last *affirmation* line, not the last line) and step 4 (the new trailing guard). Steps 5-7 are the existing logic re-anchored.

**Decision: reconsideration prose after a clean affirmation classifies as clean.** `test/adversarial-call.test.mjs:2166` currently pins `"No architectural objection.\nActually, let me reconsider that once more."` as rejected. The question is whether trailing musing is a safety judgement a human must make. Options: treat it as clean (structural rule), or `**Punt:**` it as a safety call. The finding contract is the `### <severity>:` section, `parseRefutation` itself treats every severity-less `### ` block as non-finding prose (FAFF-1056), and the shape gate admits a body only for a severity-bearing section. A reviewer that emitted a clean token and then mused, with no finding section anywhere, has structurally emitted no objection. **Chosen:** classify as clean via the structural rule ("no finding section emitted = no objection"); this is a structural fact, not a safety judgement, so it is not punted. The `:2166` assertion flips to accepted (architectural, `bare`).

**Test dispositions: which existing assertions flip, which must not regress.** The build agent must run `test/adversarial-call.test.mjs` and reconcile each red against this table. A red not in the FLIP column is a real regression.

| Fixture (test/adversarial-call.test.mjs) | Today | After | Why |
|---|---|---|---|
| `No architectural objection.\nAdditional prose.` (:1825, FAFF-746 rejected list) | rejected | **FLIP to clean, architectural, `bare`** | Trailing prose is guard-clean (no severity/namespace heading). |
| `No methodology objection.\nAdditional prose.` (:1893, FAFF-942) | rejected | **FLIP to clean, methodology, `bare`** | Guard-clean trailing prose. |
| `## Refutation — methodology` + signal + `No methodology objection.` + `And one more thing.` (:1888, FAFF-942) | rejected | **FLIP to clean, methodology, `headed+signal`** | Affirmation found above guard-clean trailing line; form re-anchored. |
| `No architectural objection.\nActually, let me reconsider that once more.` (:2166, FAFF-1053) | rejected | **FLIP to clean, architectural, `bare`** | Structural rule: no finding section emitted (decision above). |
| `## Refutation — architectural\nNo QA objection.` (:1820/:1972, wrong-lens) | rejected | **STAYS rejected** | Wrong-lens heading directly above the affirmation (step 5 reject arm). |
| `### major: real bug\nNo QA objection.` (:1984) | rejected | **STAYS rejected** | Severity heading directly above the affirmation. |
| preamble + `### critical:` + `## Refutation — architectural` + `No architectural objection.` (:2138) | rejected | **STAYS rejected** | Genuine finding in preamble (step 6 guard). |
| long-preamble lens-mismatch (:2132) | rejected | **STAYS rejected** | Wrong-lens heading directly above. |
| `## Summary\nNo architectural objection.\nNo QA objection.` (:1991) | clean, QA, `bare` | **UNCHANGED** | Last affirmation is QA; earlier one is preamble. |
| long-preamble headed (:2120), severity-preamble bare/header-wrapped (:2154), bare/headed positives (:1798) | clean/rejected as asserted | **UNCHANGED** | Affirmation is last; trailing segment empty; byte-identical path. |

The build agent adds new positive cases for the FLIP behaviours (trailing prose across `bare`, `headed`, `headed+signal`, `header-wrapped`) and new negative cases for the trailing guard (`No QA objection.\n### major: ...` and a trailing `## Refutation — <other lens>`), rather than only editing the flipped assertions.

**Decision: keep the run-bench mirror in step.** `eval/review-bench/run-bench.mjs`'s `isCleanRefutation` is hand-mirrored from production and self-documents "must match production." Options: update it in step, or declare it out of scope. Leaving it stale would silently diverge the bench's clean-pass classification from production for exactly the trailing-prose bodies this fix targets. It is a small subset mirror (bare/headed only). **Chosen:** apply the same last-affirmation-anchor plus trailing-guard change to `isCleanRefutation`, preserving its existing subset scope (it still models neither `header-wrapped` nor `headed+signal`, and a mismatched heading directly above still stays unrecognised). Update its comment to state the trailing tolerance.

**Decision: update the stale comments and SKILL.md docs.** `review-call.mjs:702` asserts "so arbitrary trailing prose is still rejected," and the FAFF-1053 comment (:744-757) states "the affirmation must be the final non-blank line." Both become false. `SKILL.md:62` and `:281` describe the four forms. Options: update the stale text, or leave it. Leaving a comment that contradicts the code is a defect by this repo's own standard. **Chosen:** correct the `:702` and `:744-757` comments to state that guard-clean trailing prose after the affirmation is tolerated while a genuine finding or wrong-lens heading after it still rejects; add one sentence to the SKILL.md forms description noting the trailing tolerance (the four form labels are unchanged). No changelog prose in the comments, state the rule forward.

**Decision: leave the refuter briefs unchanged.** Options: tighten a brief to forbid trailing explanation, or rely on the normaliser. A brief instruction cannot bind a drifting model, and the normaliser fix covers the drift regardless. **Chosen:** no brief change (see OUT OF SCOPE). The parser fix is the real one.

**Failure modes.**

- **The failure:** the trailing guard matches ATX severity/namespace headings only, so a reviewer that writes `No QA objection.` then states a real objection in bold or plain prose (`**Major:** there is a bug`, no `### ` heading) would be accepted as clean, suppressing that objection. **How you'd know:** an eval rep (or a production spec-review) where a refuter that clearly objected in prose is scored `clear`, visible as a clean-pass log line for a body a human reads as objecting. **What it means:** accept. This is the identical limitation the preamble severity guard already carries; the finding contract is the `### <severity>:` section, and a bold-prose "finding" would not parse as a finding even if the affirmation were absent. Narrowing it is a separate issue (OUT OF SCOPE), not a blocker here.
- **The failure:** the "last affirmation wins" tie-break could pick the wrong lens if a reviewer stacked two lenses' affirmations with a real finding between them. **How you'd know:** the winning lens in the log does not match the finding's lens. **What it means:** proceed. A finding between two affirmations is a `### <severity>:` heading directly above the second affirmation (step 5 reject) or in the trailing/preamble segment (guards reject), so a stacked body carrying a real finding rejects rather than mislabels; a stacked body with two clean affirmations is clean either way.

**Anti-pattern:** matching the affirmation anywhere and rewriting to clean whenever one is present. Why: it drops the anchor and reintroduces FAFF-1053's declined Direction 3, letting an affirmation buried inside or beside a genuine finding suppress that finding.

## 5. Scenarios: born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refuter body whose last affirmation line is "No architectural objection." followed only by
      guard-clean explanatory prose ("Additional prose.", a reconsideration musing)
When normaliseCleanRefutation runs
Then it returns { content: "### observation: no findings", normalised: true, lens: "architectural", form: "bare" }
```

```
Given a body "No QA objection." followed by "### major: <a real finding>"
When normaliseCleanRefutation runs
Then it returns normalised: false with the original bytes unchanged (the finding is never swallowed)
```

```
Given a body whose affirmation IS the final non-blank line (any of the four forms, with or without preamble)
When normaliseCleanRefutation runs
Then its result is byte-identical to the pre-change behaviour (no regression for the affirmation-last common case)
```

## 6. Design decision rationale

Each decision below is stated once, at its point of use above; this section indexes them by subject for the reviewer. Fix site: the normaliser, not the parser (section 3). Affirmation locator: the last affirmation line, last-wins tie-break (section 3). Trailing guard: reject on a severity or refutation-namespace heading after the affirmation (section 3). Form labels: the four are unchanged, decided by the lines above the affirmation (section 3). Reconsideration prose: clean by the structural "no finding section = no objection" rule (section 4). run-bench mirror: kept in step (section 4). Comments and SKILL.md docs: corrected (section 4). Refuter briefs: unchanged, out of scope (section 4 and section 2). No temporal anchors apply; the guard regexes and clean-pass grammar are internal to this repo.

## 7. Open questions and assumptions

**Open questions:** none. Every decision is settled by the codebase evidence.

**Assumptions:** none. All referenced symbols (`CLEAN_REFUTATIONS`, `SEVERITY_LIKE_HEADING_RE`, `REFUTATION_NAMESPACE_RE`, `ATX_HEADING_RE`, `isDecorativeHeader`, `CANONICAL_NO_FINDINGS`, both consumer call sites, the run-bench mirror, and the named tests) were verified present at the cited locations during self-review.

## 8. DONE: definition of done

### From WHY
- [ ] A body whose last affirmation line is a canonical affirmation followed only by guard-clean prose normalises to `### observation: no findings` (the reported opus-5.5-at-high-effort case no longer faults).
- [ ] The fix lives in `normaliseCleanRefutation`; `parseRefutation` is not modified.

### From WHAT (discriminator)
- [ ] `normaliseCleanRefutation` returns the unchanged shape `{ content, normalised, lens, form }`.
- [ ] The affirmation is located as the greatest line index equal to an affirmation sentence; the last affirmation wins when several appear.
- [ ] A body whose affirmation is the final non-blank line produces a result byte-identical to the pre-change behaviour.
- [ ] The `form` value is one of the existing four labels, decided by the lines above the affirmation; trailing prose does not introduce or change a label.

### From HOW (behaviour)
- [ ] Guard-clean trailing prose after the affirmation is tolerated across `bare`, `headed`, `headed+signal`, and `header-wrapped` forms (new positive tests, one per form).
- [ ] A trailing segment containing a `### <severity>:` (or level-agnostic `## Critical:`-style) heading rejects (`normalised: false`, original bytes), new negative test.
- [ ] A trailing segment containing a `## Refutation — <lens>` namespace heading rejects, new negative test.
- [ ] `:2166` `"No architectural objection.\nActually, let me reconsider that once more."` normalises to clean, architectural, `bare`.

### From HOW (must-not-regress)
- [ ] `## Refutation — architectural\nNo QA objection.` (wrong-lens, :1820/:1972) stays rejected.
- [ ] `### major: real bug\nNo QA objection.` (:1984) stays rejected.
- [ ] The preamble finding-swallow guard (:2138) and long-preamble lens-mismatch (:2132) stay rejected.
- [ ] `## Summary\nNo architectural objection.\nNo QA objection.` (:1991) stays clean on QA, `bare`.
- [ ] The four flipped assertions (:1825, :1893, :1888, :2166) are updated to their new dispositions; every other red in `test/adversarial-call.test.mjs` is treated as a real regression, not a flip.

### From HOW (mirrors and docs)
- [ ] `eval/review-bench/run-bench.mjs` `isCleanRefutation` applies the same last-affirmation anchor and trailing guard, preserving its bare/headed subset scope, with its comment updated.
- [ ] `review-call.mjs:702` and the FAFF-1053 comment (:744-757) are corrected so no comment claims trailing prose is rejected or the affirmation must be the final non-blank line.
- [ ] `SKILL.md` (:62 and/or :281) notes that guard-clean trailing prose after the affirmation is tolerated; the four form labels are described as unchanged.

### Integration smoke test
```
GIVEN one live refuter lens invoked through the production path
PROCEDURE:
  1. Feed a body: "## Refutation — QA\nNo QA objection.\n\nI checked the diff and found nothing to raise."
  2. runReviewChain (or classifyCapturedResult) calls normaliseCleanRefutation -> normalised:true, lens:"QA"
  3. The chain returns exit 0 with content "### observation: no findings"
  4. parseRefutation("### observation: no findings", "QA") hits the clean fast-path -> { ok:true, outcome:"clear", objections:[] }
EXPECT: a clean pass end-to-end, no fault, no chain advance.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sizing (principle 4): no issues.** One structurally cohesive concern: extend `normaliseCleanRefutation` to anchor on the last affirmation line and add a trailing-segment guard. The bundled parts (production function, the `run-bench` mirror, the two stale comments, the SKILL.md line, the test dispositions) all ship together by necessity, so this is a correct merge, not a split candidate. The "complex" tier reflects test-reconciliation care (several green assertions flip), not scope breadth. One note to weigh, not a split: this is the fifth widening of one function four Done tickets already touched, an architectural-consolidation signal for a future issue, not a reason to resize this one.

**Workstream fit (principles 1 + 5).** The issue carries no project (correct at jot time); the spec is homed in "Skill-behaviour harness", which reads as a capability or test-harness bucket, not a shippable outcome. Leave it project-less in Backlog for now (the correct default landing for a captured bug); when it is sequenced, home it under the outcome it serves (trustworthy adversarial spec-review, or the honest eval-measurement outcome FAFF-1153 sits in), not a harness bucket.

**Surfaced dependencies (principle 6).** This issue gates the FAFF-1153 re-measurement: the 4.8-vs-5.5 comparison cannot be redone honestly until this lands, because the broken normaliser discards opus-5.5-at-high-effort clean passes as parse faults, skewing the comparison FAFF-1153 exists to produce. What to do: make the dependency explicit with a blocker edge so the re-measurement cannot be rerun on the broken path or sequenced before this ships. The FAFF-746/927/942/1053 links are lineage only (all Done), so no live blocker edge is needed there.

**Risk profile (principle 7): no de-risking spike warranted.** Not novel integration, no external dependency, an all-internal function on its fifth pass. The real risk is regression-shaped, specifically the safety-critical direction the spec names (silently rewriting a body carrying a genuine objection to "no findings" on the live lane), and it is already mitigated in the spec: the bidirectional trailing guard fails toward rejection, and the flip / must-not-regress table names every assertion that may change versus every one that must hold. Build to that table; treat any red outside the listed flips as a real regression.

confidence: high
build-tier: complex
spec-review: approve
