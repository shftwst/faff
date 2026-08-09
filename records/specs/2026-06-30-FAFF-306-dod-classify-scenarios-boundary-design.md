# FAFF-306 — Bound the scenarios section so `dod classify` and `admissible` cannot over-capture past a shallower DONE heading

> Spec: faffter-dark-nlspec · 2026-06-30 · autonomous · confidence: high. Full spec on Linear FAFF-306.

This spec addresses **FAFF-306** (Bug). Audience: the build agent implementing the fix, and human reviewers. All changes land in one file — `plugin/skills/faff/bin/faff` — touching the DoD-section parsers (`sectionBody` / `parseScenarios` / `dodClassify` / `admissibleVerdict`) and their `--selftest` tables.

## 1. WHY — Problem and Principles

**The load-bearing model.** The scenarios-section extractor decides *where the SCENARIOS section ends* by heading **level**: it stops at the next heading whose level is `≤` the SCENARIOS heading's own level. That rule silently assumes SCENARIOS and DONE sit at the **same** heading level. When a spec puts SCENARIOS shallower than DONE — `## Scenarios` (h2) followed by `### 2. DONE` (h3) — the deeper DONE heading does **not** stop the section, so it runs to end-of-document and swallows the DONE heading line, the DONE checklist items, the trailing `confidence:` line, and the fenced `faff-contract:spec-readiness` block. Those non-criteria lines then fall to the `prose` class.

**Problem statement.** `faff dod classify` (the deterministic step the code-blind evaluator consumes) mis-bounds the scenarios section on a heading-level mismatch and emits **phantom prose criteria** plus **double-counted** DONE assertions, while `faff admissible --lights-out` stays green — so the two parsers disagree on the same document and the disagreement only surfaces at eval time as spurious `needs-human` punts. This change bounds the scenarios section so it can never bleed past the DONE section (or the trailing producer artifacts), regardless of relative heading level, and applies the identical boundary rule to both parsers so they cannot disagree.

**Design principles:**

- **One boundary rule, two consumers.** `parseScenarios` (admissible) and the scenarios branch of `dodClassify` (via `sectionBody`) currently carry **duplicated** `lvl <= level` break logic. Reconciliation means both recognise the **same** section extent by construction — share one boundary recogniser, do not patch one and leave the other.
- **Fix at the boundary, not by content-filtering generic fences.** `classifyAcceptanceCriteria` deliberately **keeps fence content** (a `Given/When/Then` block lives inside a fence and must be kept). So the fix must not blanket-drop fenced lines — it must stop the *section* before the trailing artifacts, and exclude only the specifically-identifiable producer artifacts (the `faff-contract:` block and the `confidence:` line), never generic scenario fences.
- **Recognition tolerance, not rejection.** `## Scenarios` (unnumbered h2) is a **canonical valid** form (it is the lite producer's documented form and the `ADMISSIBLE_GOOD` selftest form). The defect is the *level mismatch between siblings*, not the unnumbered heading. Do not reject or gate on heading style.

**Reference context:**

| System | Location | Relevance |
|---|---|---|
| `sectionBody` | `plugin/skills/faff/bin/faff` ~L9047 | Scenarios-section extractor used by `dodClassify`; the `lvl <= level` break is the over-capture site. |
| `parseScenarios` | ~L9938 | Admissible's R1 scenario counter; carries its own copy of the same `lvl <= level` break. |
| `parseDoneChecklist` | ~L9969 | Already keys the DONE section by **name** (`headingLevel>0 && /\bdone\b/i`), at any level — the precedent this fix mirrors. |
| `SCENARIOS_HEADING_RE` | ~L9926 | Shared SCENARIOS recogniser (FAFF-300); number- and level-tolerant. |
| `classifyAcceptanceCriteria` | ~L9024 | Splits a section body into criteria; keeps fence **content**, drops fence markers. |
| `dodClassify` / `admissibleVerdict` | ~L9070 / ~L10004 | The two consumers + their `--selftest` tables. |

**Scope statement.** A localised parser-correctness fix inside the faff CLI's DoD-section extraction; it changes no contract shape and no command surface.

## 2. OUT OF SCOPE

- **Prose DONE items defeating zero-punts** — *Why excluded:* that is FAFF-304 (genuinely-prose DONE criteria; admissible passes but the evaluator forces `needs-human`). This fix removes *phantom* prose from mis-bounding only; it must not change how *genuine* prose DONE items classify. *Extension point:* FAFF-304 works the same `classifyCriterion`/`admissibleVerdict` surface — keep this change to the section **boundary** so they compose.
- **Normalising the lite producer's documented heading levels** — *Why excluded:* `faffter-noon-spec` documents `## Scenarios` (h2) but `### 4. DONE` (h3) — itself the mismatched form that triggers this bug. Fixing the *parser* is the robust fix (it must tolerate any author's heading choice); harmonising the producer's own template is a separate prose change. *Extension point:* `plugin/skills/faffter-noon-spec/SKILL.md` §Scenarios/§DONE.
- **Rejecting / hard-gating unnumbered or mismatched headings** — *Why excluded:* `## Scenarios` is a valid canonical form; gating on style would false-fail good specs. The level-mismatch signal is surfaced **advisorily** only (never flips admissibility). *Extension point:* if a future policy wants to *require* consistent DoD heading levels, it layers a new gating check on top of the advisory warning this spec adds.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| SCENARIOS section | The `## Scenarios` / `### N. SCENARIOS` block whose body `dod classify` and `admissible` read for born-verifiable scenario/assertion criteria. |
| DONE heading | Any heading whose text matches `/\bdone\b/i` (the DoD checklist section), at any level — the recogniser `parseDoneChecklist` already uses. |
| Trailing producer artifacts | The standalone `confidence: <high\|medium\|low>` line and the fenced `faff-contract:spec-readiness` block the spec producer appends after DONE. Never criteria. |
| Heading-level mismatch | SCENARIOS heading level ≠ DONE heading level — the structural smell that caused the over-capture. |

**The shared boundary rule (the core interface).** Introduce one recogniser the scenarios extractor consults to decide the section end. The SCENARIOS section ends at the **first** line (scanning forward from the heading) that satisfies **any** of:

```
PREDICATE is_scenarios_section_end(line, scenarios_level, in_fence):
  IF in_fence: return false                       # never end mid-fence (GWT blocks live in fences)
  L := heading_level(line)                         # 0 when not a heading
  1. L > 0 AND L <= scenarios_level       -> true  # existing rule: next equal/higher heading
  2. is_done_heading(line)                -> true  # NEW: a DONE heading at ANY level (the FAFF-306 fix)
  3. line opens a `faff-contract:` fence  -> true  # NEW: trailing contract block (belt-and-suspenders)
  4. line is a standalone confidence line -> true  # NEW: `^\s*confidence:\s*(high|medium|low)\s*$` (i)
  ELSE -> false
```

- `is_done_heading(line)` ::= `heading_level(line) > 0 && /\bdone\b/i.test(line)` — the **same** predicate `parseDoneChecklist` keys its section start on; factor it into one shared helper and reuse it in all three call sites (`parseDoneChecklist` start-scan, `sectionBody`-for-scenarios, `parseScenarios`).
- Rule 3 keys on the fence **info string** containing `faff-contract:` — it does **not** drop generic fences (those carry scenario GWT content and must be kept).
- Rules 3 + 4 also close the residual where a spec has a SCENARIOS section but **no** DONE heading (then rules 1–2 never fire and the section would otherwise run to EOF over the trailing artifacts).

**Design decision — boundary-stop vs content-filter.** Option A: stop the *section* at the boundary (above). Option B: keep the over-wide section but have `classifyAcceptanceCriteria` filter out DONE-heading / confidence / contract lines. **Chosen:** A (boundary-stop). Rationale: B would have to distinguish "fence content to keep" (GWT) from "fence content to drop" (contract) *inside* the shared classifier that PRD strict-check also calls — broader blast radius and a standing trap; bounding the section is the precise, local fix and matches `parseDoneChecklist`'s existing name-keyed design.

## 4. HOW — Behavior

**Architecture.** Three edits, all in `plugin/skills/faff/bin/faff`, plus selftest rows:

1. **Factor the shared recognisers.** Add `isDoneHeading(line)` (= `headingLevel(line) > 0 && /\bdone\b/i.test(line)`) and `isConfidenceLine(line)` (= `/^\s*confidence:\s*(high|medium|low)\s*$/i.test(line)`) and `opensContractFence(line)` (= a fence-open line whose info string contains `faff-contract:`). Repoint `parseDoneChecklist`'s start-scan to `isDoneHeading`.

2. **`sectionBody` (scenarios branch).** Extend the body-collection loop so it breaks on the shared boundary rule, not only `lvl <= level`. Because `sectionBody` is a general helper, add an **optional** boundary-extension parameter (e.g. `opts.extraStop = (line) => boolean`) so the scenarios call passes the DONE/contract/confidence stops while other potential callers keep today's behaviour; `dodClassify` passes that predicate.

```
PROCEDURE sectionBody(specText, headingRe, opts):
  ... locate heading, record `level`, set fence=false ...
  FOR each line after the heading:
    toggle `fence` on a fence marker (and push it), continue
    L := fence ? 0 : heading_level(line)
    IF L > 0 AND L <= level: break                       # existing
    IF NOT fence AND opts.extraStop?(line): break         # NEW: DONE heading / contract fence-open / confidence line
    push line
  return body.join("\n")
```

3. **`parseScenarios` (admissible R1).** Apply the **same** boundary in its counting loop: stop at `lvl <= level` OR `isDoneHeading(line)` OR `opensContractFence(line)` OR (not in fence) `isConfidenceLine(line)`. This drops admissible's silent over-count (it currently counts DONE `Given` lines when it over-scans) — the verdict is unchanged (R1 only needs ≥1), but the count becomes accurate and the two parsers now see the same extent.

4. **`admissibleVerdict` — advisory level-mismatch warning (Defect 2 reconciliation).** After computing R1/R2/R3, compute the SCENARIOS heading level and the DONE heading level; when **both** sections are present and their levels **differ**, append a warning (it is advisory — like R3, it never flips `admissible`):

```
PROCEDURE done_scenarios_level_warning(specText):
  s := level of the first SCENARIOS_HEADING_RE heading (0 if absent)
  d := level of the first isDoneHeading line (0 if absent)
  IF s > 0 AND d > 0 AND s != d:
    return ["R4 advisory: SCENARIOS heading (h"+s+") and DONE heading (h"+d+
            ") are at different levels — normalise them; dod classify reads the same section by name regardless, "+
            "but a level mismatch is the historical over-capture trap (FAFF-306)"]
  return []
```

The warning is the visible reconciliation signal the issue asked for: `admissible` now *surfaces* the exact structural condition that used to desync it from `dod classify`, instead of staying silently green.

**Behavior summary.** After the fix, the same spec body classifies identically whether SCENARIOS is `## Scenarios` (h2) or `### 1. SCENARIOS` (h3) and whether DONE is at the same or a deeper level: the scenarios section stops at the DONE heading, DONE items appear only under `source:"done"` (no double-count), and the `confidence:`/contract lines never become criteria.

**Edge cases:**

- **No DONE heading present** (malformed but parseable spec) — rules 3/4 stop the section at the trailing `confidence:`/contract block; if neither is present, the section ends at EOF as today (no artifacts to misclassify).
- **DONE shallower than or equal to SCENARIOS** (e.g. both h2) — rule 1 already fires at DONE; rule 2 is redundant-but-harmless. Existing selftests (both-h2, both-h3) stay green.
- **A generic GWT fence inside Scenarios** — untouched: `in_fence` guards the boundary rule, and rule 3 keys only on a `faff-contract:` info string, so a plain GWT fence is never a stop.
- **Heading containing "done" inside Scenarios prose** (e.g. a sub-heading `### Done states`) — would stop the section early. Accepted: this mirrors `parseDoneChecklist`'s existing name-keyed behaviour exactly (it has the same property today), and no producer emits such a heading; see Failure modes.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The DONE-name boundary over-triggers.** *The failure:* a legitimate scenarios sub-heading containing "done" truncates the section, dropping real scenarios. *How you'd know:* a spec with such a heading shows fewer `source:"scenarios"` criteria than its body has. *What it means:* proceed — this is identical to `parseDoneChecklist`'s shipped behaviour (consistency beats inventing a second DONE-recogniser), and the producers emit no such heading. Named here so a future reader who *does* hit it knows it is a deliberate, consistent choice.
- **Only one parser fixed.** *The failure:* `parseScenarios` and `sectionBody` diverge again. *How you'd know:* the new agreement selftest (below) fails — it runs the identical mismatched spec through both and asserts the same section extent. *What it means:* the shared recogniser is the mitigation; the selftest is the tripwire.
- **Contract/confidence exclusion drops a real criterion.** *The failure:* an author writes a literal criterion line that looks like a confidence line. *How you'd know:* a `confidence: high`-shaped *criterion* disappears. *What it means:* negligible — `confidence: <token>` is not a GWT scenario or a MUST/comparator assertion, so it was already `prose`, never born-verifiable; losing it changes no admissibility verdict.

**Anti-pattern:** filtering DONE/contract lines inside `classifyAcceptanceCriteria`. Why: that classifier is shared with PRD strict-check and must keep generic fence content (GWT) — bounding the section is the correct, local layer.

## 5. SCENARIOS

```
Given a spec whose SCENARIOS heading is `## Scenarios` (h2) and whose DONE heading is `### 2. DONE` (h3), with a trailing `confidence:` line and a `faff-contract:spec-readiness` block
When `faff dod classify` runs
Then the scenarios source contains only the real scenario/assertion criteria, the DONE items appear once each under source `done` (not double-counted), and no `prose` criterion is the DONE heading, the confidence line, or a contract-JSON line
```

```
Given the same spec body with only the SCENARIOS heading changed to the consistent `### 1. SCENARIOS` (h3) form
When `faff dod classify` runs on both variants
Then the two classifications are identical (same counts, same per-source criteria) — heading level no longer changes the result
```

```
Given the same h2-SCENARIOS / h3-DONE spec
When `faff admissible --lights-out` and `faff dod classify` run on it
Then admissible stays `true` AND emits an advisory level-mismatch warning, and admissible's scenario count equals dod classify's `source:"scenarios"` scenario count (the two parsers agree on section extent)
```

- The fix touches only pure functions (file/stdin in, JSON/verdict out); no tracker, network, or LLM seam is introduced or changed — so no grader `KIND`/eval case applies. Coverage is the `dod --selftest` and `admissible --selftest` tables (the established pattern for these parsers).

## 6. DESIGN DECISION RATIONALE

**How should the scenarios section be bounded against a deeper DONE heading?**
- *Stop at any next heading regardless of level* — fixes the mismatch but forbids any deeper sub-heading inside Scenarios and still over-captures when DONE is absent.
- *Stop at equal/higher heading OR a DONE-named heading OR the trailing artifacts* — fixes the mismatch, preserves deeper non-DONE sub-headings, and closes the no-DONE residual.
- **Chosen:** the latter — a shared boundary rule (equal/higher level OR `isDoneHeading` OR `faff-contract:` fence-open OR a standalone `confidence:` line), mirroring `parseDoneChecklist`'s existing name-keyed design.

**Boundary-stop vs content-filter (where to exclude the trailing artifacts)?**
- **Chosen:** bound the section (option A); do **not** filter inside `classifyAcceptanceCriteria`. Rationale in §3 — keeping the shared classifier's keep-fence-content behaviour intact and the blast radius minimal.

**Reconcile admissible/dod by gating, or by warning?**
- *Reject/normalise unnumbered or mismatched headings at admissibility time* — would false-fail the canonical `## Scenarios` form.
- **Chosen:** make the two parsers share the boundary rule (so they cannot disagree on extent) **and** add a non-gating advisory warning when DoD heading levels mismatch. The shared rule removes the silent disagreement; the warning surfaces the smell without breaking valid specs.

**Where does the shared boundary live so both parsers use it?**
- **Chosen:** factor `isDoneHeading` / `isConfidenceLine` / `opensContractFence` helpers and an optional `extraStop` predicate on `sectionBody`; `dodClassify` and `parseScenarios` consume the same helpers. One source of truth for the boundary.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the defect is reproduced and the fix is local and deterministic.

**Assumptions:**

- **Assumes:** the producer's trailing artifacts are the standalone `confidence: <high|medium|low>` line and a fence whose info string contains `faff-contract:` (validated against `faffter-dark-nlspec`/`faffter-noon-spec` output and the `dod`/`admissible` selftests). *Validation:* grep the producer SKILLs and the existing selftest fixtures before implementing; if a producer emits a differently-tagged trailing block, widen rule 3's match accordingly.

## 8. DONE

### From WHY
- [ ] A spec with `## Scenarios` (h2) + `### N. DONE` (h3) no longer over-captures: `dod classify` produces zero `prose` criteria sourced from the DONE heading line, the `confidence:` line, or the `faff-contract:` block.

### From WHAT / HOW (behaviour)
- [ ] One shared `isDoneHeading(line)` helper (`headingLevel>0 && /\bdone\b/i`) exists and is used by `parseDoneChecklist`, the scenarios branch of `dodClassify`/`sectionBody`, and `parseScenarios` (no duplicated DONE recogniser).
- [ ] The scenarios-section boundary stops at the first of: next heading with level ≤ SCENARIOS level; any DONE heading; a `faff-contract:` fence-open; a standalone `confidence: <high|medium|low>` line — and never mid-fence.
- [ ] DONE checklist items appear exactly once in `dod classify` output, under `source:"done"` (no scenarios/done double-count) for the mismatched-level spec.
- [ ] `parseScenarios` applies the same boundary; admissible's R1 count for the mismatched-level spec equals `dod classify`'s `source:"scenarios"` scenario count.
- [ ] Generic GWT fences inside `## Scenarios` are still parsed as scenarios (keep-fence-content unchanged); a plain bash/console fence is not treated as a contract stop.

### From HOW (admissible reconciliation)
- [ ] `faff admissible --lights-out` on a spec whose SCENARIOS and DONE headings are at different levels returns `admissible:true` AND includes an advisory warning naming the level mismatch; the warning never changes the `admissible` boolean.
- [ ] A spec with consistent DoD heading levels (both h2, or both h3) emits **no** level-mismatch warning (regression guard).

### From scope / parity
- [ ] Genuine prose DONE items still classify as `prose` (FAFF-304's surface is untouched — boundary-only change).
- [ ] Existing `dod --selftest` and `admissible --selftest` cases stay green; new rows cover the mismatched-level spec (over-capture gone), the two-variant identical-classification invariant, the cross-parser agreement, and the consistent-level no-warning guard.
- [ ] `faff dod classify --selftest` and `faff admissible --selftest` both exit 0.
- [ ] The `admissible` usage string (bin `--help`) and `docs/cli.md` reflect the new advisory warning, per the docs-never-go-stale rule (FAFF-237/238).

### Integration smoke test
```
# same body, only the SCENARIOS heading differs between the two files
faff dod classify --spec spec-unnumbered.md --json   # h2 Scenarios / h3 DONE
faff dod classify --spec spec-numbered.md   --json   # h3 SCENARIOS / h3 DONE
# EXPECT: identical criteria+counts; prose count reflects only genuine prose (0 for a clean body)
faff admissible --spec spec-unnumbered.md --lights-out --json   # EXPECT admissible:true + level-mismatch warning
faff dod classify --selftest && faff admissible --selftest       # EXPECT exit 0 both
```

confidence: high
spec-review: approve
