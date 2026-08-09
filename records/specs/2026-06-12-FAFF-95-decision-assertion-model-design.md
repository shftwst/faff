# FAFF-95 — Decision-assertion model: buckets / ordering / verdicts / mutations

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high.

**Depends:** `blockedBy` FAFF-93 (DONE, `9e51e32`) · `relatedTo` FAFF-94 (DONE, `d474fe4`), FAFF-90, FAFF-88
**Build context:** this spec + `test/helpers/skill-harness.mjs` (the DecisionRecord shape + `makeRecorder`) + `test/faff-tidy.test.mjs` (the refactor target).

---

## 1 · WHY

FAFF-93 shipped a harness that drives a skill and captures its decisions into a **frozen DecisionRecord** (typed views + a `seamLog` whose `seq` is the sole ordering authority). FAFF-93 deliberately owns **no assertion vocabulary and no ordering opinion** — it records, it does not judge. FAFF-94 then wrote the first behavioural test (faff-tidy, 3 scenarios) but had to **hand-roll every assertion inline** against raw record fields.

FAFF-95 delivers a **matcher module** — throwing assertion functions over a captured DecisionRecord — covering the ticket's four categories (bucket membership, work-ordering, routing verdicts, tracker mutations), plus the CLI-result and cross-seam-ordering checks FAFF-94 actually relies on. It then **refactors FAFF-94's test to consume the matchers**, proving them against a real run and removing the bespoke plumbing in one move.

**Governing-principle anchor (gateway: orchestration owns no ordering opinion):** the ordering matcher **asserts the captured order against an EXPECTED order the test author supplies** — it never computes a priority/unlock-value ranking.

---

## 2 · OUT OF SCOPE

- No new `faff` CLI subcommand / `.faffrc` key / `.faff/` artefact / `validate.yml` edit (self-test is auto-discovered by `node --test`).
- No change to the DecisionRecord shape — FAFF-95 reads it, never alters `skill-harness.mjs`.
- No rendering-body goldens (FAFF-96) / rendering-routing assertion (FAFF-97) — a bare `expectRendering(rec, surface)` membership check is the one allowance.
- No read-after-write mutation modelling — mutations are attempts; the "model unchanged after attempt" check stays a direct `tracker.getIssue(...)` assertion (a tracker-model property, not a record property).
- No new skill tests beyond the FAFF-94 refactor.
- No fluent/builder DSL — standalone functions only.

---

## 3 · WHAT — the matcher module's API surface

**Module:** `test/helpers/decision-assert.mjs`. **Self-test:** `test/decision-assert.test.mjs`. Zero-dependency, plain exported JSDoc'd functions, fail-loud. Each matcher returns `undefined` on match and throws `assert.AssertionError` (via `node:assert/strict`) on mismatch.

| Matcher | Signature | Contract |
|---|---|---|
| `expectBucket` | `(rec, name, expectedIds)` | Named bucket exists, id array deep-equals `expectedIds` (order-sensitive). |
| `expectNoBucket` | `(rec, name)` | No bucket of `name` was emitted (key absent). |
| `expectOrder` | `(rec, name, expectedIds)` | The bucket's captured id order equals `expectedIds` — author supplies the ranking; no ranking computed. |
| `expectVerdict` | `(rec, issue, token, source?)` | ≥1 verdict matches `{issue, token}` (and `source` if given). |
| `expectVerdictOrder` | `(rec, expectedIssueIds)` | Verdicts in `seq` order name issues equal to `expectedIssueIds`. |
| `expectMutation` | `(rec, {op, issue?, args?})` | ≥1 mutation attempt matches `op` (and `issue`/`args` subset if given). |
| `expectNoMutation` | `(rec, filter?)` | No mutation attempts at all (no filter) or none matching `filter`. |
| `expectCliResult` | `(rec, subcommand, {exit?, stdoutTrim?, json?})` | The CLI call `argv[0]===subcommand` has the asserted exit / trimmed stdout / parsed-JSON subset. **The non-tautological FAFF-94 core.** |
| `expectSeamOrder` | `(rec, before, after)` | First seam matching `before` has strictly smaller `seq` than first matching `after`. Selectors `{kind, ...fieldMatch}`; `argvHead` sugar matches `payload.argv[0]`. |
| `expectRendering` | `(rec, surface)` | ≥1 rendering with `surface` (membership only; no body). |

**DecisionRecord field reference (verified `skill-harness.mjs`):** `rec.buckets` is a plain object `{name->[ids]}`, key order = emit order, each value the exact array passed to `recordBucket` (un-emitted name absent). `verdicts`/`mutations`/`cliCalls`/`renderings` are arrays of payloads each with `seq`. `seamLog` is `[{seq,kind,payload}]` with `payload.seq` present.

---

## 4 · HOW

### 4a · Matcher implementation
Thin reader-plus-`assert` over documented fields, with a self-diagnosing message. `expectCliResult` does the real `JSON.parse(stdout)` + subset deep-equal — same parse/compare FAFF-94 does inline, behind a name. `expectSeamOrder` resolves each selector to the first matching seam's `seq` and compares; fails loud if a selector matches nothing. All matchers validate the record arg shape loudly (clear AssertionError, not a deep `TypeError`).

### 4b · The FAFF-94 refactor
Refactor all three scenarios' assertion blocks (fixtures / seedRepo / scripts unchanged). Every current assertion maps to a matcher, EXCEPT: (a) read-method/`resultCount` checks (scenario B) stay inline — not one of the four categories; (b) tracker-model checks (`tracker.getIssue(...).state`, `stillParked`) stay inline — a tracker property, not a record property. The real-CLI strength is preserved in full via `expectCliResult`.

---

## 5 · SCENARIOS (born-verifiable, in `test/decision-assert.test.mjs`)
Defining property: **a matcher goes red when the captured decision diverges from the declared expectation.** Each matcher gets pass-on-match + throws-`AssertionError`-on-mismatch; ≥1 case (`expectCliResult`) runs against a record from a real `runSkill` so the parse is proven non-tautological. Missing-key and selector-matches-nothing are loud (AssertionError, not TypeError). The refactored `faff-tidy.test.mjs` stays green and flipping an expected CLI value turns it red.

---

## 6 · DESIGN DECISION RATIONALE

**Decision 1 — API shape + location. Chosen:** standalone throwing functions in `test/helpers/decision-assert.mjs` (house idiom; a builder adds chaining with no payoff for ~10 matchers).

**Decision 2 — Matcher set. Chosen:** `expectBucket/expectNoBucket/expectOrder/expectVerdict/expectVerdictOrder/expectMutation/expectNoMutation/expectCliResult/expectSeamOrder/expectRendering`; read-method/count checks left inline. `expectCliResult` is in scope and load-bearing (FAFF-94's only non-tautological assertions). Ordering matchers never compute a ranking (deep-equal an author-supplied order).

**Decision 3 — Empty/absent policy. Chosen:** positive matchers fail on an absent target (`rec.buckets[name]` undefined → AssertionError); absence is asserted only via the negative matchers. `expectBucket(rec,"x",[])` means "emitted empty" (key present, value `[]`), distinct from `expectNoBucket`.

**Decision 4 — Refactor FAFF-94 (in scope, strength-preserving). Chosen:** refactor all three scenarios via matchers; tracker-model + read-count assertions stay inline by design (not a weakening — they assert the tracker/reads, not the record).

**Decision 5 — Self-test. Chosen:** `test/decision-assert.test.mjs` proves each matcher pass-on-match + throws-`AssertionError`-on-mismatch, with one real-`runSkill`-backed CLI case.

---

## 7 · OPEN QUESTIONS & ASSUMPTIONS
- **Assumes:** `rec.buckets[name]` is the exact order-preserving id array passed to `recordBucket` (verified `skill-harness.mjs` assemble + self-test).
- **Assumes:** `node:assert/strict` raises `assert.AssertionError` (verified — house idiom uses `assert.throws(fn, ErrType)`).
- **Assumes:** FAFF-94 fixtures/scripts unchanged by the refactor; §4b mapping complete.
- No remaining punts.

---

## 8 · DONE (testable checklist)
- [ ] `test/helpers/decision-assert.mjs` exists, zero-dep, exports the 10 matchers; each JSDoc'd, throws `assert.AssertionError` on mismatch.
- [ ] Each matcher reads only documented DecisionRecord fields; none imports/mutates `skill-harness.mjs`.
- [ ] `test/decision-assert.test.mjs` proves per matcher pass-on-match + throws-`AssertionError`-on-mismatch; ≥1 `expectCliResult` case against a real `runSkill`.
- [ ] `test/faff-tidy.test.mjs` refactored: all 3 scenarios via matchers; every assertion mapped or deliberately inline; real-CLI strength preserved (flipping an expected CLI value turns it red).
- [ ] `node --test` green (whole suite); no per-file wiring, no `validate.yml` change.
- [ ] No new dependency; no new `faff` subcommand / `.faffrc` key / `.faff/` artefact.
