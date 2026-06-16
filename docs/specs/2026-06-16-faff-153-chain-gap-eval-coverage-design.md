# Spec — chain-gap judgement-eval coverage (LLM prose-parsing half)

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high. Full spec on Linear FAFF-153.

Parsing boundary resolved by human decision (2026-06-16): **full-pipeline**. Adds a judgement-eval kind for the genuinely-LLM half of faff-tidy's chain-gap structural diagnostic, mirroring the splittable kind FAFF-147 shipped.

## 1. WHY

faff-tidy's chain-gap diagnostic has a real LLM-judgement half — reading a spec's free-text implementation advice to decide what referenced-but-untracked work exists — that ships untested. This lands the eval so chain-gap's judgement is measurable for accuracy and run-to-run flakiness like every other kind in `eval/`.

**Principles.**
- **Only the judgement half belongs in `eval/`** — the prose-identification + conservative-skip judgement. The graph-traversal half (given a reference, does a matching ticket exist) is deterministic → a scripted `test/`, mirroring FAFF-152. Do not put graph-traversal in this eval.
- **Mirror the FAFF-147 splittable seams** — `KINDS` entry, a grade branch, a pass-through envelope field, an envelope instruction + verbatim criteria-anchor loader, cases + oracles, a verbatim §5 sub-section, a frontier baseline. No new mechanism.
- **Grade the shipped criteria, not an improvised rubric** — read the chain-gap criteria verbatim from a faff-tidy `SKILL.md` §5 sub-section, exactly as `#### Splittable specs` is.

## 2. OUT OF SCOPE
- The graph-traversal half (deterministic → scripted `test/`).
- A live-driver wiring for chain-gap (ADR 0004 scopes this slice to the `eval/` black-box lane).
- repeat-park (FAFF-152) and splittable (FAFF-147).
- Any change to chain-gap detection behaviour — only a verbatim-criteria anchor sub-section is added to §5.

## 3. WHAT

**Vocabulary.**
- **Reference** — a unit of work the spec's implementation advice names but doesn't necessarily ticket.
- **Sub-type** — one of `sub-ticket` / `upstream` / `downstream` / `peer`.
- **Conservative skip** — a reference deliberately NOT flagged: illustrative-only, explicitly-disclaimed "future work — not ticketed by design", in-scope-for-this-PR, or unitary-spec-no-external-reference.

**Kind registration.**
- `chain-gap` added to `grader.KINDS`, **not** `CLOSED_SET_KINDS` (own grade branch, like splittable).
- Envelope field `chain_gap` — an **array of `{ reference, sub_type }`** objects, `[]` for no-gap-after-skips. Tolerated-absent on other kinds (generic envelope pass-through).
- Criteria anchor: faff-tidy `SKILL.md` `#### Chain gaps` (read verbatim, between the heading and the next `### `).

**Oracle.** Carried in the existing `closed_set` field (so `validateCase`'s default `want` applies, no validateCase change): an array of `{ reference: <synonym-set: string|array>, sub_type: "<enum>" }` entries (`[]` for no-gap/skip cases).

## 4. HOW

Full-pipeline: a case feeds **raw spec prose**; the model identifies references *and* classifies each (applying conservative skips); a new `gradeChainGap` branch scores the emitted set against the oracle — synonym-tolerant on the reference text (reuse splittable's `labelMatchesEntry`/`normLabel`), exact on the `sub_type` enum, set-equality → PASS/FAIL.

```
PROCEDURE build_chain_gap_eval:
  1. Case fixture provides RAW spec prose (mirror splittable's fixture shape).
  2. Model emits chain_gap = [ { reference, sub_type }, ... ]  ([] = no gap, after skips).
  3. Oracle.closed_set = [ { reference: <synonym-set>, sub_type: <enum> }, ... ].
  4. gradeChainGap (modelled on gradeSplittable):
       - each predicted pair matches an oracle entry iff labelMatchesEntry(pred.reference, entry.reference)
         AND pred.sub_type === entry.sub_type (exact enum);
       - matched → canon "oracle:<idx>" + mark covered; unmatched → "extra:<norm reference>:<sub_type>";
       - PASS iff every oracle entry covered AND no extra; signature = sorted canon set.
     chain-gap is NOT in CLOSED_SET_KINDS (own grade() branch).
  5. cli-driver.mjs: add the chain_gap envelope INSTRUCTION + the "#### Chain gaps" criteria-anchor loader
     (fail-loud if the heading moves), mirroring splittable's loader.
  6. >=2 cases incl. >=1 whose oracle is [] driven by a conservative skip.
```

**Edge cases.**
- `chain_gap` on a non-chain-gap case → ignored (grade reads only its kind's field).
- Missing/malformed `chain_gap` on a chain-gap case → empty predicted set → clean FAIL, distinct signature, no crash (the gradeSplittable `Array.isArray` guard stance).
- Out-of-enum `sub_type` → canonicalised verbatim so set-equality FAILs cleanly. No LLM in the grader.

**Anti-patterns.** (1) Wiring the envelope field without a matching envelope INSTRUCTION (FAFF-134/146 silent-no-emit). (2) Grading against an in-driver rubric instead of the verbatim §5 anchor.

## 5. SCENARIOS
- Given raw prose naming an un-ticketed upstream prerequisite, the model emits one `upstream` entry and gradeChainGap PASSes against the oracle (synonym-tolerant reference, exact sub_type).
- Given prose naming only an illustrative / explicitly-disclaimed reference, the model emits `[]` and gradeChainGap PASSes (skip judgement exercised, not just positive detection).
- Given the kind registered, `node --test` is green: grader unit tests cover the `gradeChainGap` branch.
- Assertion: no LLM call in the chain-gap grade path (mechanical, reproducible).
- Assertion: criteria read verbatim from faff-tidy `SKILL.md` (fail-loud if the heading moves).

## 6. DESIGN DECISIONS
- **eval half:** prose-parsing + skip judgement only (graph-traversal → scripted test). **Chosen.**
- **Reuse FAFF-147 seams** vs new mechanism. **Chosen:** reuse.
- **Criteria source:** verbatim `#### Chain gaps` in faff-tidy §5. **Chosen.**
- **Parsing boundary:** **Chosen full-pipeline** (human, 2026-06-16) — measures the whole judgement incl. the failure-prone identify/skip half; classification-only rejected (cleaner oracle but leaves that half untested). Fuzzier reference-identity oracle is the accepted cost, mitigated by splittable's synonym matcher.

## 7. OPEN QUESTIONS & ASSUMPTIONS
- **Open Questions:** none (parsing boundary resolved).
- **Assumes:** FAFF-147 splittable seams present + unchanged (`grep splittable eval/grader.mjs eval/cli-driver.mjs`).
- **Assumes:** a frontier baseline needs a supervised `claude -p` run — **the code + cases + grader land independently of the baseline being recorded**; that one AC is a supervised follow-up, flagged not fabricated.

## 8. DONE
- [ ] `chain-gap` in `KINDS` (not `CLOSED_SET_KINDS`).
- [ ] `chain_gap` envelope field passes through `envelope.mjs`.
- [ ] `chain_gap` envelope INSTRUCTION in `cli-driver.mjs`.
- [ ] Verbatim `#### Chain gaps` sub-section in faff-tidy `SKILL.md` §5 + a fail-loud anchor loader in `cli-driver.mjs`.
- [ ] `gradeChainGap` branch: synonym-tolerant reference, exact sub_type, set-equality.
- [ ] ≥2 `eval/cases/chain-gap-*.json` (raw-prose fixture + oracle), incl. ≥1 empty-oracle conservative-skip case.
- [ ] Frontier baseline recorded — **supervised follow-up; may remain unchecked at PR (flag, don't fabricate).**
- [ ] Out-of-enum / missing / malformed `chain_gap` → distinct signature, clean FAIL, no LLM in grader.
- [ ] `node --test` green (grader unit tests cover `gradeChainGap`).

confidence: high
