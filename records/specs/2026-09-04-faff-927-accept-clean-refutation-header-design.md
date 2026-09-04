# FAFF-927 — accept a clean refutation under any single decorative header

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-927.

> Revised 2026-09-04 — re-prepped against the current code after FAFF-942 (Done, #788) shipped the `headed+signal` form and fixed the sole observed incident; folds the 2026-09-03 human resolution (paraphrase-loosening deferred to FAFF-928); re-rated medium → high; supersedes the 2026-08-28 draft. The FAFF-992/park.md coordination the earlier context implied was erroneous and is dropped (FAFF-927 touches only `review-call.mjs`).

**Ticket:** FAFF-927 (adversarial-review classifier: broaden clean-refutation acceptance to a header-wrapped form).
**Slot / file:** the `review` and `spec_review` backend classifier, `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, plus its live-chain tests in `test/adversarial-call.test.mjs` and the contract doc `plugin/skills/faffter-dark-adversarial-review/SKILL.md`.
**Status of the original incident:** already fixed. The one observed FAFF-927 misclassification (the methodology no-critique no-op being read as garble) was resolved by FAFF-942 (PR #788, 2026-08-30), which added the `headed+signal` clean form. This ticket is a forward-looking hardening only; there is no currently-failing case to reproduce (the triggering body was never retained, which is FAFF-928's job).
**Blocked by:** FAFF-928 (retain raw backend bodies), In Progress, edits the same file; it must land first.

This is a refresh of the prior FAFF-927 spec. The prior spec modelled the baseline as "bare + headed" and proposed adding the header-wrapped form on top of that. Both halves are now stale: FAFF-942 already shipped a third baseline form (`headed+signal`) and already fixed the observed incident. The scope below is redrawn against the current three-form baseline.

---

## 1. WHY

### The model: a closed grammar that translates a clean refutation into the no-findings token

A spec-review or adversarial-review lens that finds nothing to object to is instructed to emit one short, fixed affirmation. The classifier `normaliseCleanRefutation` recognises that closed set of clean phrasings and rewrites them to the single findings-shaped token `CANONICAL_NO_FINDINGS` (`### observation: no findings`, `review-call.mjs` line 483), so a genuinely-clean review passes the downstream findings-shape gate instead of being mistaken for empty or garbled output.

The grammar is closed and byte-sensitive on purpose. Line endings, outer whitespace, and blank separator lines are treated as formatting and normalised away; every substantive byte stays case- and punctuation-sensitive. Anything outside the grammar is returned unchanged and falls through to the shape check, where it is classified as empty, refusal, or garble and the chain advances.

Current baseline (three recognised clean forms, `review-call.mjs` lines 495 to 513):

| Form | Shape (non-blank lines) | Example | Added by |
|------|-------------------------|---------|----------|
| `bare` | 1 line: the affirmation sentence | `No infosec objection.` | FAFF-746 |
| `headed` | 2 lines: the exact `## Refutation — <lens>` heading, then the sentence | `## Refutation — architectural` + `No architectural objection.` | FAFF-746 |
| `headed+signal` | 3 lines: heading, the lens's own no-signal diagnostic line, then the sentence | `## Refutation — methodology` + `no methodology signal available.` + `No methodology objection.` | FAFF-942 |

The `headed+signal` arm is methodology-only: a lens carries an optional `signal` field in `CLEAN_REFUTATIONS` (lines 488 to 493), and only methodology declares one. FAFF-942 froze the table with `Object.freeze` and pinned that middle line to exact bytes. That arm is what resolved the sole observed FAFF-927 incident, so the observed trigger is closed already.

The gap this ticket closes is narrow. The `headed` form only recognises the exact canonical `## Refutation — <lens>` heading. A well-behaved backend that wraps the correct byte-exact affirmation sentence under some other single heading (for example `# Code review`, `## Second opinion`, `### Assessment`) is not recognised today, so a genuinely-clean review is misfiled as garble (EXIT.MALFORMED, 10) and the chain advances or, at worst, exhausts. FAFF-927 adds one more recognised form, `header-wrapped`: a byte-exact affirmation sentence under any single decorative (non-severity, non-Refutation-namespace) header.

### Design principles

- **The clean / malformed boundary stays deterministic.** Acceptance is a pure function of the returned bytes. The new form keeps the closed, byte-exact discipline: exactly two non-blank lines, the second byte-identical to one of the four affirmation sentences. Nothing is inferred from the absence of findings.
- **Err strict.** When a response is ambiguous, leave it unaccepted and let it advance. A surviving false finding merely costs the implementor a disproof cycle; a wrongly-swallowed real finding is silent and expensive. So the grammar never widens the sentence itself, only the decorative wrapper around it.
- **Reuse the shipped machinery.** The new form composes with FAFF-942's arms inside the same `normaliseCleanRefutation`, returns the same `CANONICAL_NO_FINDINGS` token, and terminates on the existing EXIT.OK normalised-clean path (`review-call.mjs` line 1574). No new exit code, no new call site, no change to the shape taxonomy.

### Reference context (verified against the live tree)

| What | Where | Line(s) |
|------|-------|---------|
| Exit-code table (EXIT.OK, MALFORMED, NO_FINDINGS_CONTENT) | `review-call.mjs` | 41 |
| `CANONICAL_NO_FINDINGS` token | `review-call.mjs` | 483 |
| `CLEAN_REFUTATIONS` frozen table (+ optional `signal`) | `review-call.mjs` | 488 to 493 |
| `normaliseCleanRefutation` (bare / headed / headed+signal arms) | `review-call.mjs` | 495 to 513 |
| `SEVERITY_HEADING_RE`, `HEADING_LINE_RE` | `review-call.mjs` | 397 to 398 |
| `validateFindingsShape` (empty / refusal / garble) | `review-call.mjs` | 466 to 477 |
| `isProviderRefusal` closed refusal grammar | `review-call.mjs` | 444 to 457 |
| Chain accept path: shape check, normalise call, gate, EXIT.OK return | `review-call.mjs` | 1558 to 1574 |
| Live-chain harness (`runReviewChain`, `scriptedRunReview`) | `test/adversarial-call.test.mjs` | 17, 869 |
| FAFF-746 unit cases (bare/headed, tolerance, rejected-set, prompt contract) | `test/adversarial-call.test.mjs` | 1747 to 1801 |
| FAFF-942 unit cases (headed+signal, closed negatives, methodology-only) | `test/adversarial-call.test.mjs` | 1805 to 1864 |
| Refuter prompts (canonical clean sentences + methodology no-signal) | `plugin/skills/faffter-dark-spec-review/refute-*.md` | see section 8 |
| SKILL contract doc (malformed / no-findings boundary, exit table) | `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | 60, 233 to 241 |

### Scope statement

Add exactly one recognised clean form, `header-wrapped`, to `normaliseCleanRefutation`: a byte-exact affirmation sentence preceded by a single decorative header line. Keep the four affirmation sentences byte-exact. Reuse the EXIT.OK normalised-clean termination. Preserve the FAFF-746 rejected-set and the FAFF-942 `headed+signal` behaviour unchanged. Add an adversarial de-risking test proving a decorative header wrapping a non-affirmation body still advances as garble. Update the SKILL boundary note and exit table prose. No other file changes.

---

## 2. OUT OF SCOPE

- **Raw-body retention (FAFF-928).** Capturing the raw backend body that triggered a misclassification is FAFF-928's job and is the reason no live failing case exists for FAFF-927. FAFF-927 assumes it, does not do it.
- **The review-bench mirror `eval/review-bench/run-bench.mjs`.** That harness carries its own copy of the clean-refutation grammar (lines 178 to 194), and it is already behind: it recognises only bare and headed, not even FAFF-942's `headed+signal`. Re-syncing the bench copy to the production grammar is a separate follow-up, not part of this ticket; the production classifier is the source of truth.
- **Fuzzy or paraphrase matching of the affirmation sentence.** Accepting a lightly-reworded sentence (for example a dropped full stop, a pluralisation, added emphasis) stays rejected. See the deferred Punt in section 7.
- **Exit-taxonomy changes.** No new exit code, no change to the empty / refusal / garble discriminator or to EXIT.MALFORMED versus EXIT.NO_FINDINGS_CONTENT routing.
- **The park-reconsider work.** FAFF-927 touches only `review-call.mjs` and its tests and doc; it is unrelated to any park.md change.

---

## 3. WHAT

### Vocabulary

- **Affirmation sentence:** one of the four byte-exact clean phrasings, keyed by lens: `No architectural objection.`, `No infosec objection.`, `No methodology objection.`, `No QA objection.`.
- **Canonical heading (`## Refutation — <lens>`):** the exact structured heading each refuter prompt emits above its sentence. Lens-consistency between this heading and its sentence is enforced by the `headed` arm.
- **Decorative header:** a single ATX markdown heading line (`#` through `######` followed by whitespace and text) that is neither a severity finding heading (`SEVERITY_HEADING_RE`) nor part of the reserved `## Refutation — …` namespace. This is the wrapper the new form tolerates.
- **The three existing forms** (`bare`, `headed`, `headed+signal`) as in the section 1 table.
- **The new form (`header-wrapped`):** exactly two non-blank lines, a decorative header then a byte-exact affirmation sentence; lens is keyed off the sentence.

### The closed table (`CLEAN_REFUTATIONS`, unchanged)

The frozen four-entry table stays exactly as FAFF-942 left it. FAFF-927 adds no entry and no field; the `header-wrapped` arm reads the same `sentence` values already present.

| lens | heading | sentence | signal |
|------|---------|----------|--------|
| architectural | `## Refutation — architectural` | `No architectural objection.` | (none) |
| infosec | `## Refutation — infosec` | `No infosec objection.` | (none) |
| methodology | `## Refutation — methodology` | `No methodology objection.` | `no methodology signal available.` |
| QA | `## Refutation — QA` | `No QA objection.` | (none) |

### The `normaliseCleanRefutation` contract (with the new arm)

Input: the raw backend content string. Output: `{ content, normalised, lens, form }`.

- Whitespace handling is unchanged: CRLF folded to LF, outer whitespace trimmed, blank lines dropped before matching.
- On a match, returns `{ content: CANONICAL_NO_FINDINGS, normalised: true, lens: <matched lens>, form: <"bare"|"headed"|"headed+signal"|"header-wrapped"> }`.
- On no match, returns `{ content: <original, byte-identical>, normalised: false, lens: null, form: null }`.
- The four forms are tried so that the most specific label wins: a body that satisfies both `headed` (exact canonical heading, lens-consistent) and `header-wrapped` is reported as `headed`, so no existing form's label regresses.
- The `header-wrapped` arm accepts iff there are exactly two non-blank lines, the first is a decorative header, and the second is byte-identical to one of the four affirmation sentences.

**Chosen:** add the `header-wrapped` arm to `normaliseCleanRefutation`, keyed off a byte-exact affirmation sentence under one decorative header; leave `CLEAN_REFUTATIONS` and the other three arms unchanged, returning the same `CANONICAL_NO_FINDINGS` token on the same EXIT.OK path.

---

## 4. HOW

### The decorative-header predicate

```
function isDecorativeHeader(line):
    if line does not match ATX heading  /^#{1,6}\s+\S/      -> return false   # not a heading at all
    if line matches SEVERITY_HEADING_RE                      -> return false   # ### critical|major|minor|observation : ...
    if line matches  /^##\s+Refutation\s+—/  (U+2014 em dash)-> return false   # reserved namespace, lens-consistency lives in the headed arm
    return true
```

Two exclusions, both deliberate:

- **Severity headings** are excluded because a `### major: …` line makes the content genuinely findings-shaped; swallowing it as clean would hide a real finding. `validateFindingsShape` would already treat such content as ok, so `normaliseCleanRefutation` must never claim it.
- **The `## Refutation — …` namespace** is excluded because that heading is the canonical structured heading whose lens must agree with its sentence. Agreement is checked by the `headed` arm; a mismatched pair such as `## Refutation — architectural` over `No QA objection.` is genuinely inconsistent and stays rejected. Every other decorative wrapper a model realistically emits (`# Code review`, `## Summary`, `## Second opinion`, `### Assessment`) is outside the namespace and is accepted.

### The broadened procedure (composes with FAFF-942)

```
function normaliseCleanRefutation(content):
    lines = content, CRLF->LF, trimmed, split on "\n", blank lines removed

    for entry in CLEAN_REFUTATIONS:
        if lines == [entry.sentence]:                                  return CLEAN(entry.lens, "bare")
        if lines == [entry.heading, entry.sentence]:                   return CLEAN(entry.lens, "headed")
        if entry.signal != null
           and lines == [entry.heading, entry.signal, entry.sentence]: return CLEAN(entry.lens, "headed+signal")   # FAFF-942, unchanged

    # FAFF-927: any single decorative header wrapping a byte-exact affirmation sentence
    if lines.length == 2 and isDecorativeHeader(lines[0]):
        for entry in CLEAN_REFUTATIONS:
            if lines[1] == entry.sentence:                             return CLEAN(entry.lens, "header-wrapped")

    return { content: original, normalised: false, lens: null, form: null }

  where CLEAN(lens, form) = { content: CANONICAL_NO_FINDINGS, normalised: true, lens, form }
```

The first loop is the existing three-arm baseline, byte-for-byte. The new block runs only after every exact per-entry arm has failed, so no existing form's `form` label changes and the `headed+signal` methodology case is untouched. The chain accept path (`review-call.mjs` line 1559 to 1574) needs no edit: it already calls `normaliseCleanRefutation`, already gates the non-findings `continue` on `!shape.ok && !normalisation.normalised`, and already returns the normalised content on EXIT.OK with the `normalized: clean refutation … form=<form>` log line. A new `form` value flows through that log unchanged.

### Edge cases

| Input (non-blank lines shown) | Result | Why |
|-------------------------------|--------|-----|
| `## Second opinion` + `No QA objection.` | accepted, lens QA, `header-wrapped` | decorative header, byte-exact sentence |
| `# whatever` + `No infosec objection.` | accepted, lens infosec, `header-wrapped` | any ATX level counts |
| `## Refutation — architectural` + `No architectural objection.` | accepted, lens architectural, `headed` | exact arm wins first; label preserved |
| `## Refutation — architectural` + `No QA objection.` | rejected (byte-identical, unaccepted) | reserved namespace excluded from decorative set; `headed` needs lens agreement |
| `## Refutation — unknown` + `No architectural objection.` | rejected | reserved namespace excluded; no canonical heading match |
| `### major: real bug` + `No QA objection.` | rejected | severity heading excluded; this is findings-shaped, must not be swallowed |
| `## Notes` + `The diff drops error handling.` | rejected -> garble -> advance | second line is not an affirmation sentence |
| `## Notes` + `No QA objections.` (plural) | rejected | sentence not byte-exact |
| `## Notes` + `No architectural objection.` + `No QA objection.` | rejected (three non-blank lines) | two-line grammar; stacked sentences are not clean |
| ` \r\n# Review\r\n\r\nNo infosec objection.\r\n ` | accepted, `header-wrapped` | outer whitespace / CRLF / blank separators normalised, as the other arms |

### Anti-patterns

- **No fuzzy or paraphrase matching.** The affirmation sentence stays byte-exact. A dropped full stop, a pluralisation, a lower-cased first letter, or `**bold**` emphasis all reject. Only the wrapper widens, never the sentence.
- **No inferring clean from absence.** The classifier never treats "no findings section present" as clean. Clean is recognised only by a positive byte-exact sentence match; everything else advances to the shape check.
- **No opening the header to multiple lines or to setext underlines.** The header is one ATX line. A multi-line or setext-underlined header does not match and simply advances as garble, which is safe.

### Failure modes

- **False-clean (the one that matters):** an adversarial or degraded backend emits a decorative header over a byte-exact affirmation sentence while real problems exist. The closed two-line, byte-exact grammar bounds this: a response carrying real findings has severity headings or extra lines and cannot match. The severity-heading and Refutation-namespace exclusions remove the two shapes where a wrapper could plausibly sit above hidden findings. The adversarial de-risking test (section 5, scenario 4) pins the guarantee that a decorative header over a non-affirmation body still advances.
- **Label regression:** guarded by trying the exact arms first, so `headed` and `headed+signal` keep their labels.
- **Namespace over-broadening:** guarded by the reserved-namespace exclusion, which keeps the two FAFF-746 lens-mismatch fixtures rejected.

---

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

1. **Decorative header, clean pass (the core add).** A backend returns `## Second opinion` then `No architectural objection.`. `normaliseCleanRefutation` accepts it as `header-wrapped`, lens architectural; the chain returns EXIT.OK with `CANONICAL_NO_FINDINGS` and logs `form=header-wrapped`. Previously this advanced as garble.

2. **Existing forms unchanged.** The bare sentence, the exact `headed` pair, and the methodology `headed+signal` three-line no-op all normalise exactly as before, with their existing `form` labels. FAFF-942 and FAFF-746 behaviour is byte-identical.

3. **Live-chain acceptance.** In a two-backend `runReviewChain`, a primary that fails and a fallback that returns `## Review` + `No infosec objection.` yields EXIT.OK, winner = the fallback, content = `CANONICAL_NO_FINDINGS`, via `scriptedRunReview`.

4. **Adversarial de-risking (AC #2, the holdout the test must pin).** A backend returns a decorative header `## Notes` over a non-affirmation body, for example `The diff removes the null check in parseDiff.`. It is not normalised, fails `validateFindingsShape` as garble, is classified EXIT.MALFORMED (10), and the chain advances. A genuinely-malformed response still advances; the broadening did not weaken the garble gate.

5. **Holdout, stacked sentences.**

---

## 6. DESIGN DECISION RATIONALE

**Decision 1: broaden the wrapper, not the sentence.**
The observed and plausible clean-response variation is in the heading a backend chooses to print, not in the affirmation wording (the prompts fix the wording). Widening the wrapper to any single decorative header captures the realistic variation while the byte-exact sentence keeps the false-clean surface closed. The rejected alternative, loosening the sentence to a fuzzy match, is the deferred Punt in section 7 and is explicitly not taken now.
**Chosen:** widen only the decorative wrapper; keep the four affirmation sentences byte-exact.

**Decision 2: exclude the severity and `## Refutation — …` namespaces from "decorative".**
A literal "any header" reading would flip two FAFF-746 rejected fixtures (`## Refutation — architectural` + `No QA objection.` and `## Refutation — unknown` + `No architectural objection.`) into accepted, and would risk swallowing a `### major:` finding under a wrapper. Excluding severity headings prevents swallowing real findings; excluding the reserved Refutation namespace keeps lens-consistency enforced by the `headed` arm and preserves the FAFF-746 rejected-set exactly. The realistic decorative wrappers a model emits all sit outside both namespaces, so the practical acceptance is unchanged from the intent.
**Chosen:** define decorative as an ATX heading that is neither a severity heading nor in the `## Refutation — …` namespace.

**Decision 3: reuse the EXIT.OK normalised-clean termination; no new exit and no new call site.**
The chain accept path already routes a successful normalisation to EXIT.OK with the canonical token and a `form`-tagged log line. A fourth `form` value needs no branching there. Adding an exit code or a second call site would fragment a deterministic path for zero behavioural gain.
**Chosen:** the `header-wrapped` form flows through the existing `review-call.mjs` line 1559 to 1574 path unchanged.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Deferred question, paraphrase loosening.** Should the classifier ever accept a lightly-reworded affirmation sentence (dropped full stop, pluralisation, added emphasis)? A human settled the disposition on 2026-09-03: defer, do not decide it inside FAFF-927. Land FAFF-928 (retain raw bodies) first and decide from a real retained body rather than from a hypothetical. This does not block the core fix; the core fix ships at the closed byte-exact grammar regardless.
**Punt:** decide paraphrase-loosening from a real retained body after FAFF-928 lands; not now (decides: qa).

**Assumptions.** FAFF-928 lands first (it is the declared blocker and edits the same file, so FAFF-927 rebases onto it). FAFF-942's `headed+signal` arm and the frozen `CLEAN_REFUTATIONS` table are shipped and stay; FAFF-927 composes with them and changes neither. The refuter prompts continue to emit the four byte-exact affirmation sentences and the methodology no-signal line, as the FAFF-746 and FAFF-942 prompt-contract tests already assert.
**Assumes:** FAFF-928 merges before FAFF-927; FAFF-942's headed+signal arm and frozen table remain in place unchanged.

---

## 8. DONE

1. `normaliseCleanRefutation` (`review-call.mjs` lines 495 to 513) gains a `header-wrapped` arm: exactly two non-blank lines, a decorative header (ATX heading, excluding severity headings and the `## Refutation — …` namespace) then a byte-exact affirmation sentence; returns `{ content: CANONICAL_NO_FINDINGS, normalised: true, lens, form: "header-wrapped" }`. The exact per-entry arms run first so `bare` / `headed` / `headed+signal` labels do not regress.
2. `CLEAN_REFUTATIONS` is unchanged: no new entry, no new field.
3. The chain accept path (`review-call.mjs` line 1559 to 1574) is unchanged; the new `form` value flows through the existing EXIT.OK normalised-clean return and the `normalized: clean refutation … form=header-wrapped` log line.
4. New unit tests in `test/adversarial-call.test.mjs`:
   - a decorative header over each of the four byte-exact sentences normalises to the canonical token with `form: "header-wrapped"` and the sentence-keyed lens;
   - CRLF / outer-whitespace / blank-separator tolerance holds for the new arm, matching the existing arms;
   - the two FAFF-746 lens-mismatch fixtures (`## Refutation — architectural` + `No QA objection.`, `## Refutation — unknown` + `No architectural objection.`) stay rejected (byte-identical, unaccepted);
   - a `### major: …` severity heading over an affirmation sentence stays rejected (findings-shaped, never swallowed);
   - the AC #2 adversarial de-risking test: a decorative header over a non-affirmation body is not normalised, and through `runReviewChain` / `scriptedRunReview` it is classified EXIT.MALFORMED (10) and the chain advances;
   - the stacked-sentences holdout (one decorative header, two affirmation sentences) stays rejected.
5. The full FAFF-746 rejected-set (`test/adversarial-call.test.mjs` lines 1769 to 1784) and the FAFF-942 `headed+signal` tests (lines 1805 to 1864) continue to pass unmodified.
6. `SKILL.md` is updated: the "malformed / no-findings boundary" note (around line 241) and the clean-refutation description (line 60) name the four recognised forms including `header-wrapped`; the exit table wording is unchanged (no new exit).
7. Out of scope and untouched: `eval/review-bench/run-bench.mjs` (the bench mirror, already behind at bare/headed and re-synced separately), the refuter prompt files, FAFF-928 raw-body retention, any fuzzy/paraphrase matching, and the exit taxonomy.

confidence: high
build-tier: standard
spec-review: approve (scoped-refresh single-pass 4-lens, 2026-09-04)
