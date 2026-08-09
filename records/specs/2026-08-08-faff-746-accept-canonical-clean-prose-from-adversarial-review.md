# FAFF-746: Accept canonical clean prose from adversarial-review backends
> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-746.

This specification addresses FAFF-746, the clean-response parser defect. It is for the build agent implementing the parser change and the reviewers verifying that adversarial review still fails closed.

## 1. WHY: Problem and principles

The parser currently treats a backend response as usable only when it contains a recognised `### <severity>:` section. The four spec-review prompts also define exact clean-response sentences, but a backend that follows that clean form can still receive exit 10 because the parser does not recognise it. This change mechanically converts only those prompt-defined clean forms into the existing `### observation: no findings` token before shape validation.

**Fail closed.** Acceptance must use a closed grammar. Sentiment, substring, prefix, fuzzy, and arbitrary `No ... objection.` matching are prohibited.

**Provider-neutral.** The parser must recognise the contract emitted by the prompts, not the backend that happened to emit it.

**Compatibility-preserving.** Existing severity-shaped content must remain byte-identical through the new normalisation step.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JavaScript ESM | Contains `runReviewChain`, `validateFindingsShape`, and the exit 10 path |
| `test/adversarial-call.test.mjs` | Node test | Covers shape validation, chain fallback, logging, and `main` output |
| `plugin/skills/faffter-dark-spec-review/refute-*.md` | Markdown prompts | Defines the four canonical clean responses |
| `.faff/runs/run-20260807-155342-beepboop-list/` | Run evidence | Records successful Gemini transport followed by malformed exit 10 |

**Scope.** This is a local deterministic parser change in the existing adversarial-review harness.

## 2. OUT OF SCOPE

- **Prompt-only correction:** Changing the prompts without accepting their documented output leaves the parser contract inconsistent. Future prompt wording changes belong in the four `refute-*.md` files and their contract tests.
- **Semantic classification:** Inferring whether arbitrary prose means "no findings" is excluded. A future classifier would require a separate judgement seam and eval coverage.
- **Provider-specific handling:** Gemini-specific branches are excluded. Provider adaptation belongs in the existing transport functions.
- **Transport and configuration:** API payloads, authentication, model names, timeouts, and paid-provider configuration are unchanged.
- **Review aggregation:** Spec-review verdict aggregation and its contract remain unchanged.

## 3. WHAT: Vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Canonical clean refutation | One of the four exact prompt-defined no-objection sentences, optionally preceded by its matching exact refutation heading |
| Canonical no-findings token | `### observation: no findings` |
| Clean-like content | Content resembling a clean refutation but not matching the closed grammar exactly |

### Clean grammar

The refutation heading is composed as `## Refutation `, Unicode `U+2014` encoded as UTF-8 bytes `E2 80 94`, one space, and the lens name. Prompt-contract tests compare the full extracted heading string byte-for-byte. The allowlist contains four entries:

```text
CLEAN_REFUTATIONS:
  architectural:
    heading_lens = "architectural"
    sentence = "No architectural objection."
  infosec:
    heading_lens = "infosec"
    sentence = "No infosec objection."
  methodology:
    heading_lens = "methodology"
    sentence = "No methodology objection."
  QA:
    heading_lens = "QA"
    sentence = "No QA objection."
```

A payload matches only when, after normalising line endings and removing outer whitespace and blank separator lines, its nonblank lines are exactly one of:

```text
<allowlisted sentence>
```

```text
<matching allowlisted heading>
<allowlisted sentence>
```

The heading and sentence lenses must match. Nonblank line content remains case-sensitive and punctuation-sensitive.

### Pure helper

```text
RECORD CleanRefutationNormalisation:
  content: String
  normalised: Boolean
  lens: architectural | infosec | methodology | QA | null
  form: bare | headed | null
```

The exported pure helper receives backend content and returns:

- the canonical no-findings token, `normalised = true`, the matched lens, and the matched form for an exact clean match;
- the original content byte-for-byte, `normalised = false`, `lens = null`, and `form = null` otherwise.

No existing public function signature or exit code changes.

## 4. HOW: Behaviour

### Architecture and approach

Add the pure clean-refutation helper beside `splitFindings` and `validateFindingsShape`. In the successful backend branch of `runReviewChain`, call it before `validateFindingsShape`. Validate and return the helper's content.

```text
PROCEDURE normalise_clean_refutation(content):
  1. Preserve original content
  2. Convert CRLF and CR line endings to LF for matching only
  3. Remove outer whitespace
  4. Split into lines and remove blank separator lines
  5. IF exactly one nonblank line equals an allowlisted sentence:
       return canonical token, normalised true, matching lens, form bare
  6. IF exactly two nonblank lines equal a matching allowlisted heading and sentence:
       return canonical token, normalised true, matching lens, form headed
  7. Return original content, normalised false, lens null, form null
```

```text
PROCEDURE accept_successful_backend(result):
  1. Normalise result.content with normalise_clean_refutation
  2. Validate normalisation.content with validateFindingsShape
  3. IF validation fails:
       record MALFORMED 10
       advance or terminate exactly as today
  4. IF normalised:
       compute the lowercase SHA-256 digest of the original response bytes
       log exactly one normalisation event in the stable format below
  5. Return the existing winner object with content assigned to normalisation.content
```

The event format is exact:

```text
normalized: clean refutation backend=<provider>/<model> lens=<lens> form=<bare|headed> response_sha256=<64 lowercase hex characters>
```

Before any backend dispatch, `main` rejects an empty system prompt or empty diff with existing `EXIT.USAGE`. The spec-review command assembly must supply at least one non-empty `--context` file. A command-contract test checks the three input classes. These checks prove that the backend received a real review request; they do not claim that the response proves model engagement.

Clean-like content with mismatched lenses, near-miss wording, or extra nonblank prose is not normalised. It continues through the existing validator and remains malformed unless it independently contains a valid recognised severity section.

Existing canonical severity-shaped output bypasses normalisation and remains byte-identical.

**Anti-pattern:** Relax `validateFindingsShape` to accept general prose. Why: it would turn refusals, rambling, and ambiguous output into successful reviews.

**Anti-pattern:** Match any sentence beginning with `No`. Why: it would convert unknown model prose into a trusted no-findings result.

### Edge cases and error handling

- Empty and whitespace-only content remains malformed.
- Mismatched heading and sentence lenses remain malformed.
- Missing periods, changed capitalisation, added qualifiers, Markdown emphasis, or arbitrary lens names remain malformed.
- Extra prose or additional unrecognised headings prevent clean normalisation.
- A payload containing a recognised severity section retains the current findings-shaped behaviour.
- A malformed primary still records exit 10 and advances to a fallback.
- A chain containing only malformed output still terminates with exit 10.
- Normalisation logs include provider/model, lens, matched form, and a SHA-256 response digest, but never the raw backend response.

### Failure modes

- **Prompt and allowlist drift:** A prompt changes without updating the parser map. A test reading all four prompt files would fail. Update both contracts together.
- **Over-acceptance:** A clean-like but ambiguous response exits 0. Negative helper and chain tests would fail. Narrow the grammar rather than adding heuristics.
- **Compatibility regression:** Existing canonical content changes before output. Byte-identity tests would fail. Preserve the original string whenever the helper does not match.

## Scenarios

```text
Given each lens in {architectural, infosec, methodology, QA}
And each form in {bare sentence, matching heading plus sentence}
When runReviewChain validates each of the eight successful responses
Then every case returns exit 0, the expected lens and form, and content "### observation: no findings"
```

```text
Given the primary returns the architectural heading followed by "No QA objection."
And the fallback returns "### observation: no findings"
When runReviewChain validates the chain
Then the primary records MALFORMED 10 and the fallback wins with exit 0
```

```text
Given a single backend returns the architectural heading followed by "No QA objection."
When runReviewChain validates the chain
Then the chain terminates with exit 10
```

```text
Given a backend returns an existing severity-shaped finding
When the clean-refutation helper examines it
Then the helper returns the original content byte-for-byte and existing validation behaviour is unchanged
```

```text
Given one checked-in refuter prompt changes its heading or clean sentence fixture
When the prompt-contract test compares the exact extracted form to the allowlist
Then the test fails and names the affected lens
```

## 6. DESIGN DECISION RATIONALE

**How should clean prose be recognised?**

- Closed exact allowlist: deterministic, reviewable, and fail-closed.
- General regular expression or sentiment classification: broader compatibility but permits ambiguous model prose.

**Chosen:** Use the four exact prompt-defined heading and sentence pairs, with no fuzzy or arbitrary lens matching.

The bare form remains accepted because the paid Gemini run that triggered FAFF-746 returned the observed bare sentence `No infosec objection.`. The headed form remains the preferred prompt-directed form.

**Where should normalisation occur?**

- Before `validateFindingsShape` in `runReviewChain`: one provider-neutral acceptance seam covering every backend and fallback.
- Inside `validateFindingsShape`: would make validation mutate or conceal the content actually returned.
- In each transport adaptor: duplicates policy and couples output grammar to providers.

**Chosen:** Use an exported pure helper immediately before existing shape validation in the successful backend path.

**How should normalisation be observable?**

- Emit a concise chain log: preserves operational evidence without exposing raw response text.
- Log nothing: makes successful recovery indistinguishable from native canonical output.
- Include raw output: unnecessary and potentially noisy.

**Chosen:** Log the backend, matched lens, matched form, and response digest in one exact event while keeping stdout canonical and excluding raw response prose.

**What request evidence is required before clean normalisation can run?**

- Check only transport success: permits an accidental empty review request to become no-findings.
- Check review inputs before dispatch: rejects an empty system or diff and requires spec-review context without pretending this proves model engagement.

**Chosen:** Require non-empty system and diff inputs before backend dispatch, and require at least one context file on the spec-review call path.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

None. The required prompts, parser seam, exit code, and tests are present in the repository.

## 8. DONE: Definition of Done

### From WHY

- [ ] All four prompt-defined clean sentences can produce a valid no-findings result without provider-specific logic.
- [ ] Ambiguous or malformed prose continues to fail closed.

### From WHAT

- [ ] An exported pure helper implements the four-entry exact allowlist and returns content, normalisation state, lens, and matched form.
- [ ] The optional heading is accepted only when its lens matches the sentence lens.
- [ ] Canonical severity-shaped input is returned byte-for-byte unchanged.
- [ ] A prompt-contract test compares each full extracted heading and sentence byte-for-byte, including heading `U+2014` as UTF-8 `E2 80 94`, and names the lens on drift.

### From HOW

- [ ] `runReviewChain` normalises successful backend content before `validateFindingsShape`.
- [ ] Parameterised tests cover all four bare sentences and all four matching heading-plus-sentence forms.
- [ ] Tests cover outer whitespace, blank separator lines, and CRLF input.
- [ ] Negative tests cover empty content, mismatched lenses, extra prose, extra unrecognised headings, near-miss wording, changed case, missing punctuation, and arbitrary `No ... objection.` text.
- [ ] A chain test proves an accepted clean primary returns exit 0, the primary winner, no malformed failure class, and canonical content.
- [ ] The chain-level assertion checks `runReviewChain(...).content` equals the canonical token, not the raw backend sentence.
- [ ] A chain test proves a rejected clean-like primary records MALFORMED 10 and advances to a healthy fallback.
- [ ] A single-backend malformed chain still terminates with exit 10.
- [ ] A `main` test proves accepted clean prose produces the canonical attribution header and no-findings token on stdout.
- [ ] Empty system or diff content returns existing `EXIT.USAGE` before dispatch, and the spec-review command-contract test requires at least one non-empty context file.
- [ ] Normalisation produces exactly one stderr event matching `normalized: clean refutation backend=<provider>/<model> lens=<lens> form=<bare|headed> response_sha256=<64 lowercase hex characters>` with the stubbed values.
- [ ] The event digest equals SHA-256 over the original response bytes, and raw response prose is absent from the log.
- [ ] Existing malformed, fallback, canonical-output, and byte-identity tests remain green.
- [ ] `node --test test/adversarial-call.test.mjs` passes.
- [ ] No new eval `KIND` or seam-registry row is added because the change is deterministic parsing, not LLM judgement.

### Integration smoke test

```text
1. Stub one reachable backend to return the exact infosec heading plus "No infosec objection."
2. Invoke main with the existing system and diff fixtures
3. Assert exit 0
4. Assert stdout contains the canonical attribution header
5. Assert stdout ends with "### observation: no findings"
6. Assert runReviewChain.content equals "### observation: no findings"
7. Assert stderr contains exactly one normalisation event with the stubbed backend, infosec lens, headed form, and correct SHA-256 digest
```

## Methodology critique

No issues.

FAFF-746 is a cohesive 1–3 day parser-and-test change with no external dependency, and its closed grammar plus negative and prompt-contract tests cover the main over-acceptance and drift risks.

## Producer self-review audit

- **minor: Prompt drift was initially detectable only through parser failures.** Resolved by requiring a test that reads all four refuter prompts and checks the allowlisted heading and sentence pairs.
- **minor: A broad whitespace rule could admit altered substantive lines.** Resolved by limiting tolerance to line-ending normalisation, outer whitespace, and blank separator lines while keeping nonblank heading and sentence text exact.
- **Verification result:** The chosen seam matches the existing pure-helper pattern in `review-call.mjs`; no false assumptions, unresolved punts, interface mismatches, or scope additions remain. The review found no blocker or major findings, so the high rating is available.

## Spec-review revision audit

- **Architectural:** The winner path now assigns `content: normalisation.content`; the heading byte contract is exact; the smoke test uses the prompt-directed headed form.
- **Infosec:** The bare form is tied to recorded paid-Gemini evidence; dispatch rejects empty system or diff input; spec-review requires context; the audit event records backend, lens, form, and response digest.
- **QA:** The event has an exact oracle; scenarios cover all eight accepted forms, prompt drift, fallback success, and single-backend exit 10.

spec-review: approve
confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```

