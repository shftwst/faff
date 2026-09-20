# Spec — FAFF-1053: normalise a clean refutation that trails visible reasoning preamble

> Spec: faffter-dark-nlspec · 2026-09-15 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1053.

This is the buildable nlspec for FAFF-1053, addressed to the build agent implementing the fix and the human reviewers gating it. It changes the INSIDE of one pure function, `normaliseCleanRefutation`, in `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, so a byte-exact canonical clean refutation is recognised when it sits at the **tail** of a body, not only when it is the whole body. The call site and the four preserved rejection classes are unchanged.

## 1. WHY — Problem and Principles

**The load-bearing model.** A spec-refuter lens that finds a real problem emits `### <severity>: …` and parses fine. A lens that finds *nothing* emits one of four byte-exact canonical affirmations (e.g. `## Refutation — architectural` then `No architectural objection.`). Today the no-findings path is recognised only when that affirmation is the **entire** body — the matcher splits the whole body into non-blank lines and every arm gates on `lines.length` being exactly 1/2/3. A reasoning model that streams ~80 lines of visible deliberation into the content channel before the canonical affirmation therefore fails every arm on line-count and falls through to `malformed` (exit 10). The verdict is discarded on **position, not content** — the strongest (primary) reviewer is skipped and the chain advances to a weaker fallback. This is a quiet, clean-biased quality downgrade: the failure only bites lenses that found nothing.

**Problem statement.** A correct no-findings refutation preceded by any preamble is classified `malformed`, so the primary reviewer's correct verdict is thrown away and a weaker backend serves instead. The fix recognises the canonical affirmation at the **final non-blank lines** of the body regardless of preceding prose. It does so without loosening any of the four rejection classes three prior tickets deliberately preserved.

**Design principles.**

**Clean means clean — never swallow a real finding.** Loosening from whole-body to tail matching opens a new hazard the whole-body premise closed for free: a body that carries a genuine `### <severity>:` finding *and* happens to end with a canonical affirmation must NOT normalise, or a real finding is silently discarded. The whole-body arms were safe because a body with a finding could never be exactly 1–3 lines. Tail matching removes that free guard, so the fix must re-add it explicitly (see Failure modes and the preamble severity guard).

**Loosen position, not grammar.** Every substantive byte of each affirmation stays case- and punctuation-sensitive and matched by equality against the frozen `CLEAN_REFUTATIONS` table. The change relaxes *where* the affirmation may appear, never *what* counts as one. The four preserved exclusions (lens-mismatch, refutation-namespace, severity-worded headings, near-miss spellings) must route through the exact same `isDecorativeHeader` + per-entry-heading-equality logic they do today.

**Change the inside, not the seam.** A raw-source test pins the three call-site tokens (`validateFindingsShape(originalContent)`, `normaliseCleanRefutation(originalContent)`, the `if(!shape.ok && !normalisation.normalised)` gate). The fix lives entirely inside `normaliseCleanRefutation`; the call site is not touched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM (`.mjs`) | `normaliseCleanRefutation` (709–737), `CLEAN_REFUTATIONS` (668–673), `isDecorativeHeader` + regexes (698–707), the `runReviewChain` call site (1931–1948) |
| `test/adversarial-call.test.mjs` | Node test | Fixtures for FAFF-746 / 942 / 927; the call-site token pin (2497–2507); the primary-skip/advance integration tests |
| `eval/review-bench/run-bench.mjs` | Node ESM | An independent, non-CI mirror copy `isCleanRefutation` (178–201) of the bare/headed grammar, commented "no looser, no stricter" |

**Scope statement.** This sits in the adversarial-review `review` slot's chain classifier — the step that decides whether a backend's raw response is a served verdict, a normalisable clean-pass, or a skip-and-advance failure.

## 2. OUT OF SCOPE

- **The stderr note wording on a binned body (Direction 4).** — Excluded. After this fix, the preamble+affirmation body normalises and is no longer binned; the remaining binned-with-affirmation cases are the deliberately-rejected ones. Distinguishing the note there is a cosmetic diagnostic, not a correctness fix. **Extension point:** the `firstSkipReason` / `reason` string built at `review-call.mjs:1937` and surfaced by the FAFF-1039 primary-skip note.
- **`--reasoning-off` being inert under `--backends-json`.** — Excluded. The chain mapper reads `reasoningOff` per chain element, so the CLI flag is a no-op in JSON-backends mode; this is a separate surface with its own fix. **Extension point:** the chain-element mapper that reads `reasoningOff`. (The issue explicitly says the spec need not fix it.)
- **`reasoning_off` / think-suppression as a workaround.** — Excluded and rejected as a fix direction: the issue records that suppression produced a *different* malformed body, so it does not solve the problem.
- **A new "contains-affirmation-but-also-prose" classification (Direction 3).** — Excluded. Directions 1/2 (tail matching) are strictly more contained and require no new exit class or caller change.
- **Changing the exit-code taxonomy or the `runReviewChain` advance behaviour.** — Excluded. A genuinely malformed body must still classify `malformed` and still advance, exactly as today.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Affirmation | The byte-exact `No <lens> objection.` sentence for a lens (`CLEAN_REFUTATIONS[i].sentence`). |
| Canonical clean refutation | One of four closed forms: `bare` (sentence), `headed` (heading + sentence), `headed+signal` (heading + signal + sentence; methodology only), `header-wrapped` (one decorative header + sentence). |
| Preamble | The non-blank lines that precede the matched tail segment — the model's visible reasoning, expected to be free prose. |
| Tail segment | The final 1–3 non-blank lines that constitute a canonical clean refutation. |
| Finding-swallow | Normalising a body that also carries a genuine `### <severity>:` finding, discarding that finding. The hazard the preamble guard prevents. |

**The function contract (unchanged signature, extended behaviour).**

```
FUNCTION normaliseCleanRefutation(content) -> {
  content:    string          # CANONICAL_NO_FINDINGS when normalised, else the original body
  normalised: boolean         # true iff a canonical clean refutation was recognised
  lens:       string | null   # the owning lens when normalised
  form:       "bare" | "headed" | "headed+signal" | "header-wrapped" | null
}
```

`form` keeps its existing four labels — no new label is introduced (a preamble+headed body is still `form: "headed"`; the preamble is not part of the label). The caller at 1943–1948 is unchanged: when `normalised` is true it returns `EXIT.OK` with `content = CANONICAL_NO_FINDINGS` and logs `lens`/`form`.

**Reused module internals (do not redefine).** `CLEAN_REFUTATIONS` (frozen, 668–673), `CANONICAL_NO_FINDINGS` (655), `ATX_HEADING_RE`, `SEVERITY_LIKE_HEADING_RE`, `REFUTATION_NAMESPACE_RE`, `isDecorativeHeader` (698–707). The preamble severity guard reuses `SEVERITY_LIKE_HEADING_RE` (level-agnostic) — no new severity regex.

**Design decision — match position.** Whole-body-only (status quo) vs last-N-lines (tail). **Chosen:** tail matching (Directions 1+2 combined) — require the affirmation to be the **final non-blank line**, with heading/signal, where present, **immediately above** it. It is the most contained shape that satisfies AC1 while preserving AC2/AC3/AC4 through the existing equality/decorative logic. See Rationale.

## 4. HOW — Behavior

**Architecture.** Replace the four whole-body length-gated arms with a single tail-anchored decision keyed on the **last non-blank line**. Determine `entry` by `entry.sentence === lines[last]`; then walk upward at most two lines to classify the form; then apply the preamble severity guard before returning `normalised: true`. Bare/headed/headed+signal/header-wrapped all fall out of the same upward walk, so no existing no-preamble body changes label.

**Behavior summary.** The affirmation must terminate the body. The line(s) directly above it decide the form. Anything further above is preamble and is accepted only if it contains no severity-worded heading. A heading directly above the affirmation that is neither the entry's own heading nor a decorative header (i.e. a wrong-lens refutation-namespace or severity heading) stays rejected exactly as today.

```
PROCEDURE normaliseCleanRefutation(content):
  1. lines <- content, CRLF-normalised, trimmed, split on "\n", blank lines dropped   # unchanged prelude (711)
  2. IF lines is empty: RETURN not-normalised
  3. last  <- lines[len-1]; above1 <- lines[len-2] or null; above2 <- lines[len-3] or null
  4. FIND entry in CLEAN_REFUTATIONS WHERE entry.sentence === last
     IF none: RETURN not-normalised                       # AC3: no canonical affirmation anywhere
  5. Determine form + the index `start` of the tail segment's first line:
     a. IF entry.signal != null AND above1 === entry.signal AND above2 === entry.heading:
          form="headed+signal"; start = len-3
     b. ELSE IF above1 === entry.heading:
          form="headed";        start = len-2
     c. ELSE IF above1 != null AND ATX_HEADING_RE matches above1:
          # a heading sits directly above the affirmation but is NOT this lens's heading
          IF isDecorativeHeader(above1): form="header-wrapped"; start = len-2
          ELSE: RETURN not-normalised                     # AC2: wrong-lens namespace / severity heading stays rejected
     d. ELSE:                                              # above1 is null or plain prose
          form="bare";          start = len-1
  6. PREAMBLE GUARD: IF any of lines[0 .. start-1] matches SEVERITY_LIKE_HEADING_RE:
       RETURN not-normalised                              # clean-means-clean: never swallow a real finding
  7. RETURN { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form }
```

**Why the upward walk is ordered most-specific-first.** `headed+signal` (3) is tested before `headed` (2) before `header-wrapped`/`bare`, so a body whose tail satisfies a longer arm never collapses to a shorter label. This reproduces today's per-entry-then-decorative precedence (the FAFF-927 form-precedence guard) at the tail rather than over the whole body.

**Why step 5c rejects rather than falling to bare.** If an ATX heading sits directly above the affirmation and it is not this lens's own heading, it is either a decorative wrapper (→ `header-wrapped`, accepted) or a namespace/severity heading (→ rejected). It must never be treated as "bare with a heading in the preamble", or the FAFF-746 lens-mismatch (`## Refutation — architectural` + `No QA objection.`) would leak through. `bare` (5d) is reachable only when the line above the affirmation is not an ATX heading at all.

**Edge cases.**
- **Empty / single-line bodies.** Empty → not-normalised (also caught upstream by `validateFindingsShape`). Single line equal to a sentence → `bare` (above1 null).
- **CRLF and blank separators.** Handled by the unchanged prelude at step 1 — line endings and blank lines are formatting, not content.
- **Affirmation appears mid-body, not last.** No tail match (step 4 keys on `lines[last]`) → not-normalised. Correct: only a *terminating* affirmation is a verdict.
- **Wrong-lens pairing with preamble** (e.g. 80 lines of prose, then `## Refutation — architectural`, then `No QA objection.`). Entry = QA; above1 is a non-QA refutation-namespace heading → step 5c reject. Stays rejected, as the no-preamble form does.

**Anti-pattern:** parsing the `## Refutation — <lens>` heading to extract the lens name. Why: the lens is always taken from `entry.lens` via exact `sentence`/`heading` equality; introducing a heading parser reopens the case-/punctuation-drift holes FAFF-927 closed.

**Anti-pattern:** returning `normalised: true` for a body whose preamble contains `### <severity>:`. Why: the caller uses `normalisation.content` unconditionally when `normalised` is true (1948), so this discards a real finding even when `validateFindingsShape` judged the body findings-shaped. The step 6 guard is mandatory, not optional.

**Failure modes.**

- **The failure — finding-swallow via preamble.** A reasoning body deliberates through a `### critical: …` line and *then* emits a canonical affirmation at the tail. Without the guard, tail matching normalises it to `no findings` and the caller (1948) serves `CANONICAL_NO_FINDINGS`, silently dropping a real finding. **How you'd know:** the swallow-guard scenario/unit test fails; in the wild, a served clean-pass whose raw bytes contained a `### <severity>:` section. **What it means:** the step 6 `SEVERITY_LIKE_HEADING_RE` guard is load-bearing — proceed only with it in place.
- **The failure — form reclassification (AC4 regress).** If the upward walk is ordered least-specific-first, a no-preamble `headed` body matches `bare` on its last line and relabels. **How you'd know:** the FAFF-746/927/942 fixtures assert specific `form` values and would flip. **What it means:** keep the most-specific-first ordering; the existing fixtures are the tripwire.
- **The failure — bench mirror drift.** `eval/review-bench/run-bench.mjs`'s `isCleanRefutation` keeps its own bare/headed copy; if production loosens and the mirror does not, bench shape classification diverges from production for exactly the preamble case. It does not gate CI, so drift is silent. **How you'd know:** a bench run classifies a preamble+affirmation response as `NOT-shaped`/`findings-shaped` where production serves it clean. **What it means:** update the mirror in the same change (see Rationale).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refuter body of ~80 non-blank prose lines followed by "## Refutation — architectural",
      a blank line, then "No architectural objection." as the final non-blank line
When normaliseCleanRefutation runs on the raw body
Then it returns { normalised: true, lens: "architectural", form: "headed", content: CANONICAL_NO_FINDINGS }
```

```
Given a body of preamble prose followed by "## Refutation — architectural" then "No QA objection." (lens-mismatched)
When normaliseCleanRefutation runs
Then it returns normalised: false (the wrong-lens refutation namespace stays excluded from the decorative arm, as with no preamble)
```

```
Given a genuinely malformed body (non-empty, non-refusal) with no canonical affirmation as its final line
When normaliseCleanRefutation runs, then runReviewChain classifies it
Then normalisation is false, shape.kind is "garbled", the body classifies malformed (exit 10) and the chain advances
```

```
Given each existing no-preamble fixture — bare, headed, headed+signal (methodology), header-wrapped (decorative header + sentence)
When normaliseCleanRefutation runs
Then each still returns its existing form label ("bare" / "headed" / "headed+signal" / "header-wrapped"), so no current body reclassifies
```

- The `runReviewChain` call site keeps the three pinned source tokens (`validateFindingsShape(originalContent)`, `normaliseCleanRefutation(originalContent)`, `if (!shape.ok && !normalisation.normalised) {`) verbatim.

## Already shipped against this surface

The fix is the fourth widening of this one normaliser and must not regress the rejection classes the first three preserved. Each kept the exact-line-count premise; FAFF-1053 is the preamble case none of them cover.

- **FAFF-746 (Done)** — accepted canonical clean prose in `bare`/`headed` forms and established the lens-mismatch rejection (`## Refutation — architectural` + `No QA objection.` stays rejected). Preserved by step 5c + per-entry heading equality.
- **FAFF-927 (Done, PR #855)** — accepted a clean refutation under any single decorative header (`header-wrapped`) and hardened the near-miss namespace rejections (`### Refutation —`, `## Refutation -`, `## refutation —`) and level-agnostic severity-heading exclusion. Preserved by reusing `isDecorativeHeader` / `REFUTATION_NAMESPACE_RE` / `SEVERITY_LIKE_HEADING_RE` unchanged and by the most-specific-first ordering.
- **FAFF-942 (Done)** — added the three-line `headed+signal` methodology no-op arm. Preserved as step 5a, tested first in the upward walk.

## 6. Design Decision Rationale

**Which fix direction — tail matching vs a new class vs think-suppression?**
- Direction 3 (new "affirmation-plus-prose" class): rejected — needs a new label and caller branch; not contained.
- Think-suppression (`reasoning_off`): rejected — the issue records it produced a *different* malformed body; it does not solve the problem.
- **Chosen:** Directions 1+2 — match the last non-blank lines against the existing arms, requiring the affirmation to be the final line with heading/signal immediately above. Contained to the inside of one pure function; reuses every preserved exclusion.

**Preamble guard severity — canonical `### <severity>:` only, or level-agnostic?**
- Canonical `### <severity>:` (the `SEV`/`splitFindings` form) is the minimal guard to stop a `validateFindingsShape`-positive swallow.
- **Chosen:** the level-agnostic `SEVERITY_LIKE_HEADING_RE` already in the module — a `## Critical: …` in the preamble also blocks normalisation. This matches FAFF-927's own reasoning (a severity finding at any ATX level must not be treated as clean) and is strictly safer with no new regex.

**Where does the swallow guard live — inside the function or at the call site?**
- Call site (return `originalContent` when `shape.ok`): possible, but risks the pinned-token test and splits the "is this genuinely clean?" judgement across two places.
- **Chosen:** inside `normaliseCleanRefutation`, as step 6. It keeps the function's contract honest (`normalised: true` ⇒ safe to swallow), leaves the call site and its pinned tokens untouched, and is single-responsibility.

**Bench mirror (`eval/review-bench/run-bench.mjs` `isCleanRefutation`) — update or let it drift?**
- Leave it: it does not gate CI, so drift is invisible until a bench run disagrees with production.
- **Chosen:** update the mirror in the same change to tail-match its `bare`/`headed` arms (the subset it already mirrors) and apply the same preamble severity guard, honouring its "no looser, no stricter" comment on the shared grammar. It stays a subset mirror (it never carried `headed+signal`/`header-wrapped`), so only the bare/headed arms move. Note its `shape()` gives `clean-pass` precedence over `SEV`, so the guard is what stops the bench masking a real finding the same way production would without step 6.

*Temporal anchor:* at the time of writing, `CLEAN_REFUTATIONS` has four frozen entries and only `methodology` carries a `signal`; the upward walk's step 5a is reachable only for that lens.

## 7. Open Questions and Assumptions

**Open Questions.** None — all decisions are closed above.

**Assumptions.**

- **Assumes:** the raw-source call-site pin (`test/adversarial-call.test.mjs` ~2497–2507) asserts exactly the three tokens listed in Scenarios and nothing about the *inside* of `normaliseCleanRefutation`. *Validate:* read that test before editing; if it also pins internal line-count arms, adjust the fixtures rather than the call site.
- **Assumes:** `SEVERITY_LIKE_HEADING_RE`, `ATX_HEADING_RE`, `REFUTATION_NAMESPACE_RE`, and `isDecorativeHeader` remain defined and module-local at 698–707. *Validate:* confirm they are still in scope inside `normaliseCleanRefutation` before reusing them.
- **Assumes:** the caller at 1943–1948 continues to use `normalisation.content` when `normalised` is true. *Validate:* re-read the call site; the step 6 guard's necessity depends on this staying true.

## 8. DONE — Definition of Done

### From WHY
- [ ] A body whose final non-blank lines are a canonical clean refutation normalises to `### observation: no findings` regardless of preceding prose (AC1).
- [ ] The primary reviewer is no longer skipped for a correct-but-preambled no-findings verdict (integration: the preamble+headed body serves `winnerIndex === 0`, not a fallback).

### From WHAT (types / interfaces)
- [ ] `normaliseCleanRefutation` keeps its return shape; `form` stays one of `bare` / `headed` / `headed+signal` / `header-wrapped` / `null` (no new label).
- [ ] `lens` continues to come from `entry.lens` via `sentence`/`heading` equality — no heading is parsed for a lens name.

### From HOW (behaviour)
- [ ] The affirmation is recognised only as the final non-blank line; a mid-body affirmation does not normalise.
- [ ] `headed+signal` is matched before `headed` before `header-wrapped`/`bare` (most-specific-first), so no no-preamble body reclassifies (AC4).
- [ ] A heading directly above the affirmation that is neither the entry's own heading nor a decorative header returns `normalised: false` (AC2: lens-mismatch / namespace / severity stays rejected), with and without preamble.

### From HOW (edge cases / failure modes)
- [ ] A preamble containing a `SEVERITY_LIKE_HEADING_RE` match returns `normalised: false` (finding-swallow guard); a served clean-pass never has a `### <severity>:` section in its raw bytes.
- [ ] A genuinely malformed body with no canonical affirmation as its final line still classifies `malformed` (exit 10) and the chain still advances (AC3).
- [ ] The `runReviewChain` call site retains the three pinned source tokens verbatim.
- [ ] `eval/review-bench/run-bench.mjs` `isCleanRefutation` is updated to tail-match its `bare`/`headed` arms with the same preamble severity guard, keeping parity with production on the shared grammar.

### Tests
- [ ] New fixtures in `test/adversarial-call.test.mjs`: preamble+headed normalises to `form: "headed"`; preamble+lens-mismatch rejects; preamble-with-severity-heading rejects (swallow guard); the four existing forms keep their labels; a preambled malformed body advances the chain serving `winnerIndex > 0` while the preambled clean body serves `winnerIndex === 0`.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a body = 80 lines of prose + blank + "## Refutation — architectural" + blank + "No architectural objection."
  2. runReviewChain over a two-element chain whose primary returns that body
  3. ASSERT result.exit === EXIT.OK, result.content === CANONICAL_NO_FINDINGS,
            result.winnerIndex === 0, result.primarySkipped === null
```

build-tier: complex
confidence: high
