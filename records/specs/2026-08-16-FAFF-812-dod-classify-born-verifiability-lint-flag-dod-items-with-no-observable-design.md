# nlspec: born-verifiability oracle lint for `faff dod classify` (FAFF-812)

> Spec: faffter-dark-nlspec · 2026-08-15 · interactive · confidence: high

This spec addresses Linear issue FAFF-812, "dod classify born-verifiability lint — flag DoD items with no observable oracle". It is written for the build agent implementing the lint and for human reviewers gating the change. The whole change lives in one module, `plugin/skills/faff/bin/lib/admissibility.js`, and its selftest.

## 1. WHY — problem and principles

**The load-bearing idea.** Today the classifier grants "born-verifiable" status on the *shape* of a line's wording — a `Then`, a `MUST`, or a comparator — and never asks what the line asserts *about*. A well-formed assertion whose subject is internal code ("no timestamp comparison MUST happen in the api") reads as an assertion and passes clean, even though nothing outside the code can exercise it. An oracle is what the code-blind holdout evaluator can drive from outside the running feature: an HTTP response, a process exit code, a file's state. The lint adds a second question on top of the existing shape check: does an assertion name an observable the holdout can reach, or is it a claim about the code's internals with no external oracle?

**Problem statement.** A born-verifiable-DoD system under test shipped the DoD line "no timestamp comparison happens in the api" — an internal-code prohibition with no HTTP oracle, so with aligned clocks in one compose stack a `time.Now()`-in-Go build passed every scenario and nothing exercised the prohibition. `faff dod classify` did not flag it; only the adversarial QA lens caught it, which dents the premise that a DoD can be fully born-verifiable with zero needs-human punts. This change adds a deterministic lint to `dod classify` that flags any assertion-class DoD item asserting over internal code rather than an observable.

**Design principles.**

**The lint is additive and never gating.** It mirrors FAFF-304's prose-DONE advisory: a new field on the classifier's return value and a per-criterion flag, surfaced on the same advisory channel. It must not change any existing count, class, or the `admissible` verdict. A criterion that was `assertion` before stays `assertion`; the lint only annotates it with a separate "no observable oracle" flag. This keeps every existing consumer of the `dod classify` JSON working unread, exactly as FAFF-275's holdout fields did.

**The predicate is a deterministic keyword/structural heuristic, tuned from real misses, never escalated to an LLM.** This matches the whole module's stance: `classifyCriterion`, `BANNED_VAGUE`, and `PROSE_DONE_STOPWORDS` are all hand-tuned string rules with a stated recall/precision bias. The oracle check is one more such rule. It checks form, not semantics — it cannot judge whether an oracle a line names is *truly* reachable, only whether the line names one at all.

**The lint only judges assertion-class items, not prose or scenarios.** A Given/When/Then scenario is born-verifiable by construction (it states an observable Then). A prose-class item is already flagged by FAFF-304's advisory as a forced needs-human punt. The gap FAFF-812 closes is the assertion class specifically: the one class that reads born-verifiable and is trusted as such. Widening the lint to prose or scenarios would duplicate FAFF-304 and misclassify valid GWT.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` | Node.js | Home of `classifyCriterion`, `dodClassify`, `cmdDod`, `dodSelftest`, and the FAFF-304 `proseDoneAdvisory`/`renderProseDoneWarning` pair the new advisory mirrors |
| `plugin/skills/faff/bin/lib/prd.js` | Node.js | `prdStrictCheck` — the PRD `--strict` form-check whose shape (iterate criteria, push one violation string per offender) this lint mirrors |

**Scope.** This is one new pure predicate plus one new advisory over the existing `dodClassify` output, wired into the classifier's return value and covered by `dod --selftest`. It sits between the shape classifier (`classifyCriterion`) and the FAFF-304 prose advisory in the same module.

## 2. OUT OF SCOPE

- **Changing the `admissible` verdict or gating on the new flag.** Why excluded: the ticket asks for a lint (an advisory signal), not a new gate; gating risks blocking real work on a heuristic's false positives. Extension point: `admissibleVerdict` in `admissibility.js` already threads advisories through its `warnings[]` — a future issue could add the oracle advisory there beside `renderProseDoneWarning`, if wanted, without touching this lint's core.

- **Re-classifying internal-code assertions as a fourth class.** Why excluded: adding an `oracle-less` class value would break every consumer that switches on the three-value `class` (`scenario`/`assertion`/`prose`) and their counts. Extension point: the per-criterion boolean flag (below) is the additive, non-breaking carrier; a future consumer reads the flag, not a new class.

- **Semantic reachability checking (does the named oracle actually exist in the SUT).** Why excluded: that is the evaluator's and human's job, exactly as `prdStrictCheck` checks form not semantics (see its header comment in `prd.js`). Extension point: the holdout evaluator (`cmdHoldoutVerdict`) already runs code-blind against the running feature and is where true reachability is exercised.

- **Prose-class and scenario-class items.** Why excluded: prose is already covered by FAFF-304's advisory; scenarios are born-verifiable by their observable `Then`. Extension point: none needed — the lint is scoped to the assertion class by design.

- **Widening the observable vocabulary to a configurable list.** Why excluded: the module's tunable constants (`BANNED_VAGUE`, `PROSE_DONE_STOPWORDS`) are in-source, tuned from real misses; a config surface is premature. Extension point: the `OBSERVABLE_TOKENS` / `INTERNAL_SUBJECT_MARKERS` constants (below) are the single edit site when the vocabulary needs tuning.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Observable | Something the code-blind holdout can exercise from outside the running feature: an HTTP response (status, header, body), a process exit code, a file's on-disk state, stdout/stderr, a CLI output. Not the internals of the code. |
| Oracle | The observable an assertion is checked against. An assertion "bears an oracle" when its subject is an observable. |
| Internal-code subject | The assertion is about what the code does or doesn't do internally ("no timestamp comparison happens in the api", "the handler doesn't call `time.Now`"), with no externally reachable effect named. |
| Oracle-less assertion | An `assertion`-class criterion (it has the born-verifiable *shape* — `MUST` or a comparator) whose subject is internal code, not an observable. The exact target FAFF-812 flags. |

**The predicate.** A pure function decides, for one criterion's text, whether it names an observable oracle. It is consulted only for `assertion`-class items.

```
FUNCTION hasObservableOracle(text) -> boolean:
  # true  = the assertion names an observable the holdout can reach
  # false = oracle-less (internal-code subject) — the flagged case
```

Two in-source token sets drive it, tuned from real misses (mirroring `BANNED_VAGUE`):

```
CONSTANT OBSERVABLE_TOKENS =        # presence of any → an oracle is named
  { http, https, status, "status code", response, header, body,
    endpoint, route, request, "exit code", "exit status", exits, returns,
    stdout, stderr, output, file, "on disk", written, persisted,
    "200", "201", "400", "401", "403", "404", "409", "422", "500",
    "GET ", "POST ", "PUT ", "PATCH ", "DELETE ", "/" }     # a URL path slash

CONSTANT INTERNAL_SUBJECT_MARKERS = # phrasings that assert over code internals
  { "in the api", "in the code", "in the handler", "in the service",
    "internally", "under the hood", "no ... happens", "never calls",
    "does not call", "doesn't call" }
```

**Design decision — how the predicate combines the two sets.** Three combinations were considered:

- Require an observable token (allowlist only). Pro: precise; only lines naming a known observable pass. Con: high false-positive rate on valid assertions using vocabulary not yet in the set (e.g. "the queue depth MUST be < 10" names an observable the token set does not list) — flags too much, erodes trust.
- Flag on an internal-subject marker (denylist only). Pro: precise on the observed miss; low false-positive rate. Con: an internal-code prohibition phrased without a listed marker slips through (false negative).
- Flag only when a criterion has an internal-subject marker AND no observable token. Pro: the observed miss ("no timestamp comparison happens in the api" — has "in the api", has no observable token) is flagged; a genuine observable-MUST ("the API MUST return 200") is not flagged because "return", "200", and "/healthz" carry observable tokens; a valid-but-unlisted-vocabulary assertion is not flagged unless it also carries an internal-subject marker. Con: an internal prohibition phrased with neither a marker nor an observable token still passes.

**Chosen:** flag an assertion when it carries an internal-subject marker AND names no observable token. This is recall-biased toward *not* flagging (it stays quiet unless a line actively signals an internal subject), which matches the module's advisory-not-gate posture: a false negative is a missed lint (the status quo, no regression), a false positive is a wrongly-flagged valid assertion (erodes trust in an advisory). The bias is stated so a future tuner knows which way to lean. The observed miss is covered; the two regression cases (a real GWT scenario, a real observable-MUST) stay born-verifiable.

**Acknowledged false-positive/negative bias.** False negatives (internal prohibitions with neither a marker nor an observable token, e.g. a bare "timestamps are compared correctly") pass unflagged — acceptable, it is the current behaviour, no regression, and such a line would classify as prose anyway and be caught by FAFF-304. False positives (a valid assertion that happens to contain an internal-subject marker and no observable token) are the failure to guard against; the marker set is deliberately narrow and phrase-specific ("in the api", not the bare word "api") to keep them rare.

**The classifier's return shape (additive).** `dodClassify` gains a per-criterion boolean and a top-level advisory, both additive — `counts`, `class`, `holdout`, and every existing field are untouched.

```
RECORD Criterion:                    # existing shape + one new field
  text: string
  class: "scenario" | "assertion" | "prose"    # UNCHANGED
  source: "scenarios" | "done"                 # UNCHANGED
  holdout: boolean                             # UNCHANGED (FAFF-275)
  oracle_less: boolean                         # NEW — true only when class=="assertion" AND NOT hasObservableOracle(text); false for every non-assertion item

RECORD DodClassifyResult:            # existing shape + one new top-level field
  criteria: List<Criterion>          # UNCHANGED (now each carries oracle_less)
  counts: { scenario, assertion, prose }       # UNCHANGED — still sums to criteria.length
  holdout_counts: { holdout, visible }         # UNCHANGED (FAFF-275)
  oracle_less_count: integer                   # NEW — count of criteria with oracle_less==true

  CONSTRAINT counts.scenario + counts.assertion + counts.prose == criteria.length   # preserved
  CONSTRAINT oracle_less_count == number of criteria where oracle_less==true
  CONSTRAINT every oracle_less==true criterion has class=="assertion"
```

**The advisory pair (mirrors FAFF-304).** Two pure functions parallel `proseDoneAdvisory` and `renderProseDoneWarning`:

```
FUNCTION oracleLessAdvisory(specText) -> { count, items } | null
  # null when zero oracle-less assertions; else the flagged criteria

FUNCTION renderOracleLessWarning(adv) -> string
  # deterministic "oracle-less-assertion advisory:" prefixed single line,
  # items whitespace-collapsed + truncated ~50 chars (same style as renderProseDoneWarning)
```

## 4. HOW — behaviour

**Approach.** Add `hasObservableOracle` as a pure predicate beside `classifyCriterion`. Set `oracle_less` on each criterion at the point `dodClassify` builds the criterion objects (both the scenarios-source and done-source loops), and sum `oracle_less_count`. Add the `oracleLessAdvisory`/`renderOracleLessWarning` pair beside the FAFF-304 pair. `cmdDod` needs no change — it serialises whatever `dodClassify` returns. Extend `dodSelftest` with the observed miss and the two regression cases. Export the new functions in `module.exports`.

**The predicate.**

```
PROCEDURE hasObservableOracle(text):
  1. lc := lowercase(text)
  2. hasObservable := any token in OBSERVABLE_TOKENS is a substring of lc
                      (path-slash and HTTP-verb tokens matched as written)
  3. hasInternalMarker := any marker in INTERNAL_SUBJECT_MARKERS matches lc
     (the "no ... happens" / "never/doesn't call" markers are matched by a small
      regex each, not a literal substring — see below)
  4. RETURN NOT (hasInternalMarker AND NOT hasObservable)
     # i.e. oracle-less  ==  hasInternalMarker AND NOT hasObservable
     # bears an oracle    ==  everything else
```

The "no ... happens" family is matched structurally, not as a fixed string, so wording varies:

```
REGEX internal-negation := /\bno\b .* \b(happen|happens|occur|occurs|comparison|call|calls)\b/
REGEX internal-never     := /\b(never|does not|doesn't|do not|don't)\b .* \b(call|calls|happen|compare|read|write)\b/
```

**Anti-pattern:** matching the bare word "api" or "code" as an internal-subject marker. Why: those words appear in plenty of valid observable assertions ("the API MUST return 200"); only the phrase "in the api" / "in the code" signals an internal subject. Match phrases, not bare nouns.

**Anti-pattern:** flipping an oracle-less assertion's `class` to `prose`. Why: that changes `counts`, breaks the born-verifiable-shape signal every consumer reads, and loses the information that the line *is* shaped as an assertion. Carry the finding on the additive `oracle_less` flag only.

**Wiring into `dodClassify`.**

```
PROCEDURE dodClassify(specText):   # additive edits to the existing body
  ... build criteria exactly as today ...
  FOR each criterion c:
    c.oracle_less := (c.class == "assertion") AND NOT hasObservableOracle(c.text)
  result.oracle_less_count := count of criteria where oracle_less == true
  RETURN result   # counts, holdout_counts, criteria all otherwise unchanged
```

Set `oracle_less` where each criterion object is constructed (the `criteria.push({...})` sites in both the scenarios loop and the done loop), or in a single pass over `criteria` before the counts are computed — either is acceptable; the single post-pass is simpler and keeps the two push sites untouched.

**The advisory (mirrors `proseDoneAdvisory`).**

```
PROCEDURE oracleLessAdvisory(specText):
  1. classified := dodClassify(specText)   # try/catch → null on parse throw, as proseDoneAdvisory does
  2. oracleLess := classified.criteria WHERE oracle_less == true
  3. IF oracleLess is empty: RETURN null
  4. RETURN { count: oracleLess.length, items: oracleLess }

PROCEDURE renderOracleLessWarning(adv):
  trunc := s -> collapse-whitespace(s).trim().slice(0,50)
  items := adv.items.map(trunc).join(" | ")
  RETURN "oracle-less-assertion advisory: " + adv.count +
         " assertion(s) name no observable oracle (a MUST/comparator over internal code the holdout cannot exercise): " + items
```

**Failure modes.**

- **The failure:** the token/marker heuristic is the wrong shape — real DoDs phrase internal-code prohibitions in ways neither `INTERNAL_SUBJECT_MARKERS` nor the negation regexes catch, so the lint stays quiet on the very lines it exists to flag. How you'd know: the selftest's observed-miss case passes but a wider sweep over real specs (or a repeat of the adversarial-QA finding) shows an oracle-less line still classified clean. What it means: narrow — extend the marker set / regexes from the new real miss, exactly as `BANNED_VAGUE` is grown; do not escalate to an LLM.
- **The failure:** false positives erode trust — a valid observable assertion trips a marker and no observable token, gets flagged, and reviewers learn to ignore the advisory. How you'd know: the advisory fires on a criterion a human confirms is genuinely observable. What it means: narrow the marker that fired (make it more phrase-specific) or add the missing observable token; the recall-biased default (quiet unless a marker fires) keeps this rare by construction.

## 5. Scenarios

The behavioural objective above the complexity bar is the predicate's discrimination between the observed miss and the two regression cases. Trivial wiring (adding a field, summing a count) gets no scenario.

```
Given the DoD assertion "no timestamp comparison MUST happen in the api"
When faff dod classify runs over the spec
Then the criterion's class is "assertion" AND its oracle_less flag is true
```

```
Given the DoD assertion "The API MUST return 200 on /healthz"
When faff dod classify runs over the spec
Then the criterion's class is "assertion" AND its oracle_less flag is false
```

- A Given/When/Then scenario ("Given X, When Y, Then Z holds") MUST keep class "scenario" and oracle_less false (the lint never touches non-assertion classes).
- The `oracle_less_count` MUST equal the number of criteria whose oracle_less is true, and `counts.scenario + counts.assertion + counts.prose` MUST still equal `criteria.length` (no existing count changes).

## 6. DESIGN DECISION RATIONALE

**Where does the finding live on the output — new class, new flag, or new count only?**

- New fourth `class` value: rejected. Breaks every consumer switching on the three-value class and their `counts`.
- New count only (no per-criterion flag): rejected. A consumer could see `oracle_less_count > 0` but not learn *which* criteria, and the advisory renderer needs the per-item texts.
- **Chosen:** an additive per-criterion `oracle_less` boolean plus a top-level `oracle_less_count`, mirroring FAFF-275's additive `holdout`/`holdout_counts`. Non-breaking by construction; carries both the per-item detail and the aggregate.

**What scope does the lint judge — all criteria, or assertions only?**

- All criteria: rejected. A GWT scenario has an observable `Then` by construction and would need special-casing; prose is already covered by FAFF-304 and would double-flag.
- **Chosen:** assertion-class only. That is the one class trusted as born-verifiable on shape alone and the exact gap the ticket names. `oracle_less` is defined as always false for non-assertion classes so the flag is unambiguous.

**Predicate combination rule.** Covered in section 3 under "how the predicate combines the two sets" — **Chosen:** flag when an internal-subject marker is present AND no observable token is present, recall-biased toward silence.

**Relationship to FAFF-304 and FAFF-306 (delta, not duplication).** FAFF-304's advisory flags *prose*-class DONE items (forced needs-human by the evaluator). FAFF-306 fixed section-boundary over-capture. Neither touches an assertion-shaped line whose subject is internal code — that line classifies as `assertion` and passes both clean. This lint is the distinct third gap: it annotates assertion-class items with an oracle check. At the time of writing, `classifyCriterion` grants `assertion` on `MUST` or a comparator with no subject inspection; this decision can be revisited if the classifier ever gains subject awareness natively.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The predicate rule, the output shape, and the advisory are all pinned above.

**Assumptions.**

- **Assumes:** `dodClassify` still constructs its criteria from the two sources (`## Scenarios` via `classifyAcceptanceCriteria`, `### N. DONE` via `parseDoneChecklist`) and returns the `{ criteria, counts, holdout_counts }` shape. Validation: read `dodClassify` in `admissibility.js` before editing; confirm the criterion-push sites and the return object match section 3's `DodClassifyResult` before adding the field.
- **Assumes:** the FAFF-304 pair `proseDoneAdvisory` / `renderProseDoneWarning` exists in the same module as the mirror template. Validation: grep `proseDoneAdvisory` in `admissibility.js`; copy its try/catch-to-null and truncation shape.

## 8. DONE — definition of done

### From WHY
- [ ] `faff dod classify` flags the DoD assertion "no timestamp comparison MUST happen in the api" as oracle-less (its criterion has `class:"assertion"` and `oracle_less:true`)
- [ ] The lint never changes the `admissible` verdict and never changes any existing `class`, `counts`, `holdout`, or `holdout_counts` value

### From WHAT (types and predicate)
- [ ] `hasObservableOracle(text)` is a pure function returning `false` for an internal-subject-marked assertion with no observable token, `true` otherwise
- [ ] `OBSERVABLE_TOKENS` and `INTERNAL_SUBJECT_MARKERS` (plus the two internal-negation regexes) exist as in-source constants
- [ ] Each `Criterion` in `dodClassify`'s output carries an `oracle_less` boolean; it is `true` only when `class=="assertion"` and `hasObservableOracle` is false, and `false` for every non-assertion criterion
- [ ] `dodClassify`'s result carries `oracle_less_count` equal to the number of `oracle_less==true` criteria
- [ ] `counts.scenario + counts.assertion + counts.prose == criteria.length` still holds

### From WHAT (advisory)
- [ ] `oracleLessAdvisory(specText)` returns `null` when there are zero oracle-less assertions, else `{ count, items }`; it coerces a parse throw to `null` (fail-safe), mirroring `proseDoneAdvisory`
- [ ] `renderOracleLessWarning(adv)` returns a single deterministic line prefixed `oracle-less-assertion advisory:` with items whitespace-collapsed and truncated ~50 chars
- [ ] `hasObservableOracle`, `oracleLessAdvisory`, and `renderOracleLessWarning` are added to `module.exports`

### From HOW (behaviour) and selftest
- [ ] `dod --selftest` includes the observed-miss case: "no timestamp comparison MUST happen in the api" → `oracle_less:true`
- [ ] `dod --selftest` includes a regression case: "The API MUST return 200 on /healthz" → `assertion` with `oracle_less:false`
- [ ] `dod --selftest` includes a regression case: a Given/When/Then scenario → `scenario` with `oracle_less:false`
- [ ] `dod --selftest` asserts `oracle_less_count` equals the count of `oracle_less==true` criteria and the pre-existing FAFF-304/306 checks still pass (green)

### Integration smoke test
```
faff dod --selftest
# exit 0; all existing checks plus the three new oracle-less checks pass
```

Also run over a spec inline:
```
printf '## Scenarios\n\n- The API MUST return 200 on /healthz\n- no timestamp comparison MUST happen in the api\n\n## 8. DONE\n- [ ] x\n' | faff dod classify --spec -
# expect JSON where the /healthz assertion has oracle_less:false,
# the "no timestamp comparison" assertion has oracle_less:true,
# oracle_less_count == 1, and counts is unchanged from today
```

confidence: high