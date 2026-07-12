# FAFF-275 — Holdout-scenario selection: the `holdout:` marker + the `faff dod` split

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-275.

This is the buildable spec for FAFF-275. Audience: the build agent implementing it, and the human reviewers gating the PR. It specifies the `holdout:` marker on spec scenarios, the split logic in `faff dod classify`, a new `faff dod split` view subcommand, and the selection rules the spec producers apply at spec-write time — the settled deferral from FAFF-34 v1a that makes the evaluator a true *holdout* judge.

## 1. WHY — Problem and Principles

**The load-bearing model.** A holdout is a scenario the spec states but the builder never sees — marked in place at spec-write time, mechanically split out of the builder's view, and reserved for the code-blind evaluator. The scenario language does not change (FAFF-10's "one language, two visibilities"): a `holdout:` marker on a scenario flips only its *visibility*, and one deterministic tool (`faff dod`) is the sole authority on which criteria sit on which side of the line.

**Problem statement.** Today the evaluator (FAFF-34 v1a) exercises the *whole* born-verifiable DoD — every scenario it marks against was also in front of the builder, so a builder can (even innocently) optimise toward the letter of the visible scenarios rather than the behaviour the body requires. This change adds the withholding substrate: a marker to select holdout scenarios at spec-write time, and the deterministic split that separates the builder view from the full spec.

**Design principles.**

**One language, two visibilities.** A holdout scenario is written in the same Given/When/Then + assertion forms, in the same `## Scenarios` section, as every other scenario. The marker changes who sees it, never what it is. No second section, no second format.

**The split is deterministic; only the selection is judgement.** *Which* scenarios to withhold is the spec producer's call (LLM, at spec-write time, under the authoring rules below). *What is withheld* — parsing the marker, flagging criteria, producing the builder view — is pure CLI, so builder and evaluator can never disagree about the line's position.

**A holdout tests generalisation, never undisclosed requirements.** A holdout scenario must verify behaviour the spec body (WHAT/HOW) already requires. The builder builds from the body; the holdout checks the built thing generalises beyond the visible examples. A requirement stated *only* in a holdout scenario would make the evaluator fail the builder on something it was never told — forbidden by the authoring rules.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`classifyCriterion`, `classifyAcceptanceCriteria`, `dodClassify`, `cmdDod`, `dodSelftest`, shared boundary recognisers — all in `plugin/skills/faff/bin/lib/admissibility.js`) | Node (deps-free) | Where the marker parsing, the extended classify output, and the new `dod split` live |
| `plugin/skills/faffter-noon-spec/SKILL.md` (Scenarios section) · `plugin/skills/faffter-dark-nlspec/SKILL.md` (section 5) | prose producers | Where the marker forms + selection rules are documented for spec authors |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose producer | The consumer of `dod classify`; gets a one-line informational note |
| `docs/guide/cli.md` (rows for `admissible` / `dod classify`) · `.github/workflows/validate.yml` (`dod --selftest`) | docs / CI | Documentation + existing selftest wiring the change extends |
| `plugin/skills/faff-graft/SKILL.md` (Step 4, Step 10 _Holdout gate_) · `plugin/skills/faff-beep-boop/SKILL.md` (§10b `holdout_step`) | prose | The named extension points for the deferred enforcement wiring — **not modified here** |

**Scope statement.** This is the selection + split substrate of the L4 evaluator lane — downstream of FAFF-10's scenario model and FAFF-34's harness, upstream of the graft/beep-boop wiring that will hand each lane its view.

## 2. OUT OF SCOPE

- **Builder-view enforcement wiring** — making faff-graft commit/hand the builder view (Step 4 spec commit + build-subagent dispatch through `faff dod split --view builder`) and making the holdout gates (graft Step 10, beep-boop §10b) hand the evaluator the full tracker spec; also whether the committed spec is restored to the full view post-merge. *Extension point:* `faff-graft/SKILL.md` Step 4 + Step 10 _Holdout gate_, `faff-beep-boop/SKILL.md` §10b — each calls the `dod split` interface shipped here. *Why excluded:* consumption is a separate careful pass over graft's resume/RESUME and merge-gate paths — the same produce-then-wire slicing FAFF-34 used (its consumers were FAFF-277/309/311). Until it lands, the marker is descriptive, not enforced (named residual, see Failure modes). **This follow-up must be filed as a Backlog ticket at ship time (discovered scope), back-linked to FAFF-275.**
- **Mechanical selection** — auto-picking which scenarios to withhold (every-Nth, coverage-balanced, etc.). v1 selection is producer judgement under the authoring rules. *Extension point:* the producers' Scenarios prose, or a future `faff dod suggest-holdout`.
- **`holdout-verdict` contract rev** — carrying per-criterion holdout provenance in the evaluator's verdict block. The verdict judges the full DoD; which criteria were holdout is recoverable from the spec via `dod classify`. *Extension point:* `plugin/skills/faff/contracts/holdout-verdict.schema.json`.
- **Mechanical redundancy check** — verifying a holdout scenario's behaviour really is stated in the body (the generalisation principle). LLM-shaped and speculative; the spec-review lenses + park routing cover it for now. *Extension point:* a spec-review QA-lens check, or `faff admissible` advisory.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Holdout scenario | A `## Scenarios` criterion carrying the `holdout:` marker — withheld from the builder view, evaluated code-blind post-build. |
| Visible scenario | An unmarked criterion — present in every view. |
| Builder view | The spec text with holdout-marked scenario units removed and a withheld-count note inserted. What the builder is (after the wiring follow-up) handed and what ships on the feature branch. |
| Full view / full spec | The spec as authored, holdout markers included. Lives on the tracker; what the evaluator and the admission gates read. |

**The marker — two forms, one per scenario shape.**

1. **Fenced GWT block:** the fence info string is `holdout` — every criterion unit inside that fence is a holdout. Recognition: fence-open line matching `` /^\s*(?:```|~~~)\s*holdout\s*$/i ``. Example: a GWT block whose opening fence line is ```` ```holdout ```` instead of a bare ```` ``` ````.

2. **Assertion bullet:** the bullet text begins `holdout:` (case-insensitive) — `- holdout: The p99 latency MUST be < 200ms`. The prefix is stripped *before* classification, so the criterion's class is computed on the real text and the stored `text` is the stripped form.

The marker is recognised **only inside the `## Scenarios` section** (the same section extent `dod classify` and `admissible` already share, FAFF-306). A `- [ ]` DONE item beginning `holdout:` is left literal (no strip, `holdout: false`) and draws a stderr advisory — DONE mirrors the body 1:1 and is never withheld (it feeds graft Step 8's AC checklist and the merge-gate floor).

**Chosen:** marker syntax = fence-info `holdout` for GWT blocks + `holdout:` bullet prefix for assertions — human-skimmable in any rendered view, deterministic to parse, and zero change to the criterion text the classifier sees.

**Extended `faff dod classify` output (additive only).**

```
RECORD ClassifiedCriterion:
  text: String        # the criterion text (bullet-prefix form: prefix already stripped)
  class: Enum{ scenario, assertion, prose }   # classifyCriterion, unchanged
  source: Enum{ scenarios, done }             # unchanged
  holdout: Boolean    # NEW — true iff marker-carried; only source=scenarios can be true

RECORD ClassifyOutput:
  criteria: List<ClassifiedCriterion>
  counts: { scenario: Int, assertion: Int, prose: Int }   # UNCHANGED — still sums to criteria.length
  holdout_counts: { holdout: Int, visible: Int }          # NEW — holdout + visible == criteria.length
```

**Chosen:** additive output — per-criterion `holdout` flag + a separate top-level `holdout_counts`; the existing `counts` object is untouched, so every shipped consumer (the evaluator's born-verifiable split, graft Step 10's zero-born-verifiable short-circuit) keeps working unread.

**Chosen:** DONE items are never holdout — the closed-loop rule (DONE mirrors the body; withholding a DONE item would silently break AC verification and the merge-gate ac-checklist floor). Marker there = literal text + stderr advisory naming this rule.

**The new subcommand — `faff dod split`.**

```
faff dod split --spec <path|-> --view builder|full
```

Prints the requested view of the spec to stdout. `--view full` is the identity (byte-for-byte). `--view builder` removes each holdout-marked scenario unit and inserts one note. Exit `0` on success (including a no-marker spec), `2` on usage error (missing/unknown `--view`) or unreadable spec. Pure — no tracker/network/LLM, matching `dod classify` / `admissible` (ADR-0020 discipline).

**Chosen:** the split is a sibling subcommand `faff dod split --view builder|full`, not a flag on `classify` — classify emits criterion JSON, split emits spec text; overloading one command with two output types would muddle every call site. The required `--view` makes each future call site self-documenting.

**Chosen:** the builder-view note is a single blockquote line inserted directly under the `## Scenarios` heading — `> N holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.` — emitted only when N ≥ 1. One summary line (not per-removal placeholders) keeps the view skimmable and leaks no position information.

**Chosen:** over-withholding is an *advisory*, never a gate — when the builder view retains zero born-verifiable `source: scenarios` criteria while the full spec had ≥ 1, `dod split --view builder` warns on stderr and still exits 0. Split is a report/transform tool; gating belongs to its consumers (the wiring follow-up, `faff admissible` at admission), per the report-only precedent of `holdout verdicts`.

**Chosen:** the `holdout-verdict` contract is unchanged — the evaluator continues to judge the full DoD (holdout + visible + DONE); no schema rev, no new contract. `faffter-noon-evaluate` gets a one-line note: criteria may carry `holdout: true`; evaluate the full set regardless.

**Selection rules (the producers' authoring contract — added to both spec producers' Scenarios prose).**

- Marking is **optional** — a spec with zero holdouts is fully valid (status quo).
- Mark a **minority subset**: guideline one-in-three, never more than half — and **never all** born-verifiable scenarios; the builder must retain at least one (the visible subset is what admissibility and the builder's own verification build against).
- **The generalisation rule (load-bearing):** a holdout scenario must verify behaviour the body already requires — never be the sole statement of a requirement. Prefer a different concrete instantiation of a stated rule (other values, another path) over a new behaviour.
- **DONE items are never marked.**

**Chosen:** selection stays producer judgement at spec-write time, bounded by the rules above — the selection question ("which scenario would a teaching-to-the-test builder miss?") needs understanding of the spec's intent, which is exactly the LLM's side of the deterministic-tools-over-prose boundary.

## 4. HOW — Behavior

**Architecture and approach.** All parsing changes live in the existing pure functions; the marker is consumed at unit-formation time so classification, counting, and splitting can never disagree.

```
FUNCTION classifyAcceptanceCriteria(sectionText):        # extended, additive
  track fence state AND the fence info string on each fence-open line
  holdout_fence <- info string matches /^holdout$/i      # reset on fence close
  FOR each unit formed (list item | GWT block | bare line):
    IF unit began as a bullet whose text matches /^holdout:\s*/i:
       strip the prefix from text; unit.holdout <- true
    ELSE unit.holdout <- holdout_fence at the unit's lines
    classify stripped text via classifyCriterion (unchanged)
  RETURN [{text, kind, holdout}]

FUNCTION dodClassify(specText):                          # extended, additive
  scenarios units  -> {text, class, source:"scenarios", holdout}
  done items       -> {text, class, source:"done", holdout:false}
                       (item text matching /^holdout:/i  -> stderr advisory, text kept literal)
  counts (unchanged) + holdout_counts {holdout, visible}

FUNCTION dodSplit(specText, view):                       # new, pure
  IF view == full: RETURN specText                       # identity, byte-for-byte
  # builder view: operate ONLY within the Scenarios section extent
  #   (SCENARIOS_HEADING_RE .. scenariosBoundaryStop / equal-or-higher heading — the FAFF-306 shared boundary)
  1. remove each holdout fence: fence-open line .. matching fence-close line inclusive
  2. remove each holdout bullet: the bullet line + its continuation lines (up to the blank/next unit)
  3. collapse a doubled blank line left by a removal (never touch bytes outside removed spans)
  4. IF removed N >= 1: insert the withheld-note blockquote directly under the Scenarios heading
  RETURN text
```

**Behaviour summary.** The marker is read in exactly one place (unit formation / span scanning over the shared section boundary), so `classify`'s flags and `split`'s removals are two projections of the same parse — the coherence invariant below makes that testable.

**Coherence invariant (the split's correctness definition):** `dodClassify(dodSplit(spec, builder))` equals `dodClassify(spec)` minus the `holdout: true` criteria — same texts, classes, and sources for everything that remains, and `holdout_counts.holdout == 0` in the builder view.

**Edge cases and error handling.**

- **No markers anywhere** → `--view builder` output is byte-identical to the input (no note, no whitespace churn). The common case must be a guaranteed no-op.
- **A holdout fence containing multiple Given groups** → all units in the fence are holdout, and the note counts each criterion unit (the count is criteria withheld, not fences removed).
- **Marker outside the Scenarios section** (e.g. a `holdout:` bullet in HOW) → not recognised: no flag, no strip, no removal. The marker's jurisdiction is the Scenarios section only.
- **`holdout:`-prefixed DONE item** → literal text, `holdout: false`, stderr advisory (see WHAT). Never stripped, never removed by split.
- **All scenarios marked holdout** → builder view keeps the (now empty-of-scenarios) section + note; stderr advisory fires (over-withholding); exit 0. The full spec — which is what `faff admissible` reads at admission — still passes R1, so admission is unaffected; the *wiring follow-up* decides what a starved builder view means at its gates.
- **Unknown/missing `--view`, unreadable spec** → exit 2 with a usage line (mirror `cmdDod`'s existing error shape).
- **`~~~` fences** → both fence styles are recognised for the marker, matching the existing fence recognisers.

**Compatibility assertions (things that must NOT change).**

- `faff admissible` on the **full** spec is marker-blind: a marked scenario counts toward R1 exactly as unmarked (fence info never mattered to `parseScenarios`; a `holdout:` bullet's body still carries its MUST/comparator). Marked-vs-unmarked parity is a selftest.
- `classifyAcceptanceCriteria` is shared with `prdStrictCheck` (PRD acceptance criteria) and `admissible`'s classification: the added `holdout` field is additive and ignored there; the bullet-prefix strip applies uniformly (a PRD criterion is never expected to carry the prefix; if one does, behaviour is uniform and harmless).
- `counts` still sums to `criteria.length`; the existing `dod --selftest` cases pass unmodified.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the marker without the wiring is a placebo — until graft hands the builder view, the builder still sees every holdout scenario, and `holdout: true` is descriptive, not enforced. **How you'd know:** `grep "dod split" plugin/skills/faff-graft/SKILL.md` is empty — the wiring follow-up hasn't landed. **What it means:** proceed — this slice is the substrate, exactly as FAFF-34 shipped blind-by-construction before FAFF-309/311 wired its gates; the follow-up is named in OUT OF SCOPE and must be filed at ship time.
- **The failure:** the generalisation rule is prose-only — a producer marks a scenario that *is* the sole statement of a requirement, and the evaluator fails the builder on undisclosed behaviour. **How you'd know:** holdout-blocks whose violations name behaviour absent from the spec body (the park comment carries the aggregate + violations). **What it means:** acceptable v1 residual — holdout-blocks always route to a human, never auto-retry; if it recurs, the mechanical redundancy check (OUT OF SCOPE) earns its ticket.
- **The failure:** withholding degrades build quality even when used correctly (the builder genuinely needed the withheld example to disambiguate the body). **How you'd know:** issues with holdouts park at the holdout gate at a visibly higher rate than issues without. **What it means:** narrow — tighten the selection guideline (fewer, more-redundant holdouts) before touching the mechanics.

**Anti-pattern:** recognising the marker in a second place (e.g. split re-implementing its own bullet regex subtly differently from classify). Why: two parsers = two opinions about the visibility line; both projections must come from the shared unit/span scan.

**Anti-pattern:** making `dod split --view builder` fail (exit 1) on over-withholding. Why: split is a pure transform; a gate verdict here would fork gate logic away from the consumers that own admission decisions.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a spec whose Scenarios section has one GWT block in a ```holdout fence and one in a plain fence
When `faff dod classify --spec - --json` runs
Then the fenced-holdout criterion has holdout true, the plain one false, and holdout_counts is {"holdout":1,"visible":<the rest>}
```

```
Given the bullet `- holdout: The p99 latency MUST be < 200ms` in a spec's Scenarios section
When `faff dod classify` runs
Then the stored criterion text is `The p99 latency MUST be < 200ms` (prefix stripped), class `assertion`, holdout true
```

```
Given a spec with exactly one holdout-marked scenario
When `faff dod split --spec - --view builder` runs
Then stdout omits the marked block, carries the `> 1 holdout scenario(s) withheld…` blockquote directly under the Scenarios heading, and is otherwise byte-identical to the input
```

```
Given a spec containing no holdout markers
When `faff dod split --spec - --view builder` runs
Then stdout is byte-identical to the input and exits 0
```

```
Given any spec
When `faff dod split --spec - --view full` runs
Then stdout is byte-identical to the input
```

```
Given a holdout-marked spec
When `dod classify` runs on the full text and on the `--view builder` output
Then the builder-view criteria equal the full-view criteria minus the holdout ones (texts, classes, sources unchanged) and its holdout_counts.holdout is 0
```

```
Given a DONE checklist item `- [ ] holdout: the API MUST return 200`
When `faff dod classify` runs
Then the item's text is kept literal, holdout is false, and a stderr advisory names the DONE-never-withheld rule
```

```
Given a spec whose every born-verifiable scenario is holdout-marked
When `faff dod split --spec - --view builder` runs
Then a stderr advisory names over-withholding and the exit code is still 0
```

Non-functional assertions:

- The extended `faff dod classify` and the new `faff dod split` MUST be pure (no tracker, no network, no LLM).
- The marker MUST NOT change `faff admissible`'s counts or verdict on the full spec (marked-vs-unmarked parity).
- `faff dod split --view builder` on a marker-free spec MUST be a byte-identical no-op.
- Missing/unknown `--view` MUST exit 2.

## 6. DESIGN DECISION RATIONALE

**How is a scenario marked?** Options: (a) fence-info string + bullet prefix; (b) an HTML comment (`<!-- holdout -->`); (c) a separate `## Holdout` section; (d) a bold `**Holdout:**` marker in the Chosen/Punt family. **Chosen:** (a) — visible in every rendered view (an HTML comment vanishes on Linear/GitHub render and gets lost in edits), keeps one scenario language in one section (a separate section breaks FAFF-10's "one language, two visibilities" and forks the parsers), and stays out of the spec-readiness decision-marker family (overloading `**…:**` would entangle the visibility flag with the readiness contract).

**Where does the split logic live?** Options: a `--view` flag on `classify`; a new `dod split`; a standalone `faff holdout split`. **Chosen:** `faff dod split` — same `dod` namespace as the classification it must stay coherent with (the issue's own naming), without overloading `classify`'s JSON output with a text-emitting mode; `holdout` as a namespace is already taken by verdict plumbing (`faff holdout verdicts/verdict`).

**Does the evaluator's verdict change?** **Chosen:** no — contract untouched (rationale in WHAT). The evaluator judges the full DoD; provenance is derivable from the spec.

**Wire the enforcement now or defer?** Options: include graft/beep-boop handoff wiring; ship the substrate only. **Chosen:** defer (OUT OF SCOPE) — the issue's own scope statement is "the `holdout:` marker on scenarios + the split logic in `faff dod classify`", and the produce-then-wire slicing is the proven pattern here (FAFF-34 → 277/309/311). The split subcommand shipped here is the wiring's complete interface.

**Who selects, and under what bound?** **Chosen:** producer judgement under the minority-subset + generalisation rules (rationale in WHAT); mechanical selection is OUT OF SCOPE until the judgement version shows its failure shape.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions.**

- **Assumes:** the FAFF-306 shared boundary seams (`classifyAcceptanceCriteria`, `sectionBody`/`scenariosBoundaryStop`, `parseScenarios`, `parseDoneChecklist`) are stable extension points. *Validation:* the existing `dod --selftest` and `admissible --selftest` cases pass without modification alongside the new cases.
- **Assumes:** the deferred wiring follow-up can consume `faff dod split --view builder|full` as-is (graft Step 4 + build dispatch take the builder view; graft Step 10 / beep-boop §10b hand the evaluator the full tracker spec). *Validation:* the extension points named in OUT OF SCOPE reference only this interface; nothing in this slice depends on the wiring.
- **Assumes:** a `holdout` fence info string renders benignly (an unknown language = plain code block) on Linear/GitHub. *Validation:* eyeball this attached spec's render on the tracker.

## 8. DONE — Definition of Done

### From WHY
- [ ] A spec author can mark a scenario `holdout:` and one deterministic tool reports the builder/evaluator visibility split — the withholding substrate FAFF-34 deferred exists.

### From WHAT (marker + classify)
- [ ] `faff dod classify` emits per-criterion `holdout` and top-level `holdout_counts {holdout, visible}`; `counts` is unchanged and still sums to `criteria.length`.
- [ ] The fence-info form (```` ```holdout ````, `~~~holdout`) marks every criterion unit inside the fence; the bullet-prefix form strips `holdout:` before classification (class computed on the stripped text).
- [ ] Only `source: "scenarios"` criteria can be `holdout: true`; a `holdout:`-prefixed DONE item stays literal with `holdout: false` and a stderr advisory naming the DONE-never-withheld rule.

### From WHAT (split)
- [ ] `faff dod split --spec <path|-> --view builder|full` exists; `full` is identity; `builder` removes marked units and inserts the single withheld-note blockquote under the Scenarios heading (only when ≥ 1 withheld); missing/unknown `--view` or unreadable spec exits 2.
- [ ] A marker-free spec's builder view is byte-identical to the input.

### From HOW (coherence + compatibility)
- [ ] Coherence selftest: `dodClassify(dodSplit(spec, builder))` == full classification minus the holdout criteria.
- [ ] Marked-vs-unmarked parity selftest: `faff admissible` returns the same counts/verdict for a spec with and without its holdout markers.
- [ ] The pre-existing `dod --selftest` cases pass unmodified; the new cases are added to the same table (already wired in `.github/workflows/validate.yml`).

### From HOW (edge cases)
- [ ] A marker outside the Scenarios section is not recognised (no flag, no strip, no removal).
- [ ] Over-withholding (builder view retains zero born-verifiable scenario-section criteria while the full spec had ≥ 1) warns on stderr and exits 0.

### From WHAT (authoring + docs)
- [ ] Both spec producers' Scenarios prose (`faffter-noon-spec`, `faffter-dark-nlspec`) documents the two marker forms + the selection rules (optional; minority subset, never all; the generalisation rule; DONE never marked); `faff validate-adapters` passes.
- [ ] `faffter-noon-evaluate/SKILL.md` carries the one-line note: criteria may carry `holdout: true`; evaluate the full set regardless.
- [ ] `docs/guide/cli.md`: the `dod classify` row is updated (holdout fields) and a `dod split` row is added; the `faff` usage/help text lists `dod split`.

### Eval coverage
- [ ] The holdout-selection judgement (mark a minority, generalisation rule respected) is registered in the eval seam registry with its grader `KIND` + ≥ 1 eval case in this ticket (baseline recording stays a separate human-supervised step).

### Integration smoke test (plumbing-connected path)

```
PROCEDURE smoke():
  spec    <- a minimal spec: Scenarios with one plain GWT fence, one ```holdout fence,
             one `- holdout: … MUST …` bullet; a DONE list with one plain item
  full    <- `faff dod classify --spec spec --json`
  assert full.holdout_counts == { holdout: 2, visible: <the rest> }
  builder <- `faff dod split --spec spec --view builder`
  assert builder omits both marked units AND contains "2 holdout scenario(s) withheld"
  bview   <- `faff dod classify --spec builder --json`
  assert bview.criteria == full.criteria minus the two holdout entries
  assert `faff dod split --spec spec --view full` == spec (byte-identical)
```

## Already shipped against this surface

Related Done work — context, none of it supersedes this premise (grep-verified: no `holdout` marker parsing exists in the CLI):

- **FAFF-34** (evaluator harness v1a) — explicitly deferred this exact slice (its OUT-OF-SCOPE bullet 1 + settled deferral name the `holdout:` marker + `dod classify` split).
- **FAFF-10** (BDD scenarios, PR #64) — the scenario model the holdout subset is drawn from; both producers already carry the "one language, two visibilities" line this fills in.
- **FAFF-277 / FAFF-309 / FAFF-311** — holdout *verdict* consumption (coverage bridge, L4 delivery path, per-issue merge gate); they gate on the evaluator's output and are untouched by selection.
- **FAFF-300 / FAFF-306** — the shared Scenarios/DONE boundary recognisers this change extends.

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery*

- **Right-sized? (P4) — No issues.** One cohesive 1–3-day unit: two pure-function extensions + one subcommand + selftests + docs + small producer-prose additions, all shipping together (the prose is dead without the parser and vice versa). The enforcement wiring is correctly out, per the FAFF-34 produce-then-wire precedent.
- **Workstream fit? (P1 + P5) — No issues.** Squarely in "Trustworthy lights-out — harden & broaden (post-v1)"; it discharges a settled FAFF-34 deferral.
- **Deps surfaced? (P6) — minor.** FAFF-10 and FAFF-34 are Done and linked. The **enforcement-wiring follow-up is not yet filed** — without it the marker is descriptive only. Graft's discovered-scope pass (or the human) should file it and back-link, so the deferral is honest in the graph, exactly as FAFF-34's deferrals were.
- **Risk profile? (P7) — No issues.** Deterministic, additive, selftest-covered; the two judgement risks (placebo-until-wired, prose-only generalisation rule) are named in Failure modes with observables.

confidence: high
spec-review: approve
