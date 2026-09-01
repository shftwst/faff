# nlspec: integration-tier delegation so the code-blind holdout stops false-blocking on criteria only integration tests can verify (FAFF-961)

> Spec: faffter-dark-nlspec · 2026-09-01 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-961.
>
> Scope note: this is the first of two slices split out of the original finding. It handles the `integration` tier only (the down-migration case). The `not-yet-reachable` tier and its deferred-with-obligation carrier are [FAFF-962](https://linear.app/shftwst/issue/FAFF-962), which is blocked by this ticket. See section 2.

This spec addresses the `integration`-tier half of Linear issue FAFF-961. The change lives in two places: the pure classifier `plugin/skills/faff/bin/lib/admissibility.js` (a new per-criterion tier field on `dod classify`) and the evaluator prompt `plugin/skills/faffter-noon-evaluate/SKILL.md` (tier-aware routing before the exercise loop).

## 1. WHY — problem and principles

**The load-bearing idea.** The code-blind holdout evaluator is handed a spec plus a *running* system and nothing else: it can only run running-stack checks (poke the live app from outside). But `faff dod classify` today tags every criterion by *shape* only (`scenario` / `assertion` / `prose`) and the holdout treats every non-prose criterion as its own to judge. Some born-verifiable criteria are structurally beyond a running-stack-only judge: a down-migration cannot be observed on a stack that only ever migrates forward. Such a criterion is genuinely verified — by the build's own integration tests, which the review/merge lane runs — but the holdout cannot be that verifier, so it returns `needs-human`, drags the epic's aggregate to `needs-human`, and false-blocks the epic. This change adds a second axis to classification: which *verification tier* can observe a criterion. The holdout then judges only the running-stack criteria it can actually observe, and delegates the integration-tier ones to the lane that can.

**Problem statement.** During an outward-facing L4 drain, epic E2 (the database layer) built cleanly and passed its own tests, but the holdout could not sign off a down-migration DoD criterion (it cannot roll a forward-only stack back), so that criterion came back `needs-human`, the aggregate rolled up to `needs-human`, and the attach-safety rule refused to attach E2; epics E3 through E6 all depend on E2, so the run halted. This slice tags each DoD criterion by verification tier and delegates `integration`-tier criteria away from the code-blind holdout to the review/merge test floor, so the holdout's aggregate reflects only the running-stack subset it is competent to judge and no longer false-blocks on a criterion a different verifier already covers.

**Design principles.**

**The tier tag is an additive orthogonal axis, never a fourth `class` value.** This follows the FAFF-812 precedent verbatim (the born-verifiability oracle lint, which deliberately rejected a fourth class and carried its finding on an additive `oracle_less` boolean so every consumer switching on the three-value `class` keeps working). The `class` enum is load-bearing far beyond this module: the holdout-verdict contract's `HOLDOUT_CLASSES`, the evaluator's born-verifiable-versus-prose split, and ADR-0029's prose-to-needs-human rule all switch on exactly those three values. Tier is a separate field alongside `class`, `holdout`, and `oracle_less`.

**The default tier is `running-stack`, and a criterion is only moved off it on a strong, specific signal.** Tagging a genuinely running-stack criterion as integration-tier *removes it from the holdout's judged set*, weakening verification, so the derivation is conservative toward keeping criteria as `running-stack`: only a narrow, phrase-specific keyword match or an explicit author marker moves a criterion off the default.

**Tier is derived deterministically, never by an LLM in this slice.** Matching the whole module's stance (`classifyCriterion`, `hasObservableOracle`, `BANNED_VAGUE` are all hand-tuned string rules), tier comes from two deterministic sources: an explicit author/planner marker in the spec (mirroring FAFF-275's `holdout:` marker machinery) and a narrow in-source keyword heuristic.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` | Node.js | Home of `dodClassify`, `classifyAcceptanceCriteria`, `classifyCriterion`, the FAFF-275 holdout markers (`isHoldoutFenceOpen`, the `holdout:` bullet prefix), and the FAFF-812 `oracle_less` post-pass this change mirrors. |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Markdown prompt | The code-blind holdout evaluator. Its "How it evaluates" classify-and-split step (lines 37 to 40) is where tier-aware routing is inserted; its line-38 runtime "no surface exposed → needs-human" fallback is the backstop this layers over. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node.js | `computeHoldoutVerdict` / the holdout-verdict contract. Deliberately *untouched* by this change (see the decision on where tier lives). |
| `test/dod.test.mjs` | Node.js test | CLI JSON assertions over `dod classify`; the pattern the new tier tests follow. |

**Scope.** This is one additive field on `dod classify` (plus its derivation and a count), and one routing rule in the evaluator prompt. It sits beside FAFF-275's holdout axis and FAFF-812's oracle_less axis in the same classifier, and it changes which criteria the holdout exercises, not how it judges the ones it does.

## 2. OUT OF SCOPE

- **The `not-yet-reachable` tier and its deferred-with-obligation carrier — FAFF-962.** What's excluded: handling a criterion whose surface is not exposed at the current epic's slice (the connection-string-leak / DB-error-with-no-web-route case). Why excluded: it cannot be verified by anyone at this slice, so it is neither running-stack (the holdout can't poke it) nor integration (no test covers a surface that does not exist yet). Making it correct requires *defer-with-obligation* — exclude it from the epic holdout so the epic attaches, but record a criterion-scoped obligation the project PRD-coverage gate holds open until some epic verifies it. The FAFF-961 exploration established there is no carrier for that today (`faff prdr coverage` collapses each epic to one DoD-verdict string, discarding criteria), so it is a multi-contract feature, not an additive one. It is [FAFF-962](https://linear.app/shftwst/issue/FAFF-962), blocked by this ticket. **Interim behaviour is unchanged and non-regressing:** an unmarked criterion with no exposed surface is not tagged, stays `running-stack` (the default), the holdout tries to exercise it, finds no surface, and returns `needs-human` via the existing line-38 runtime fallback — exactly as today.

- **Echoing tier onto the holdout-verdict contract.** What's excluded: adding a `verification_tier` field to `holdout-verdict.schema.json` / `computeHoldoutVerdict`. Why excluded: the schema is `additionalProperties: false` on both the top object and each criterion item, so an echo forces a schema change and a golden-file update for zero routing benefit; tier is fully consumed upstream at classify time, and a delegated criterion simply does not appear in the verdict's criteria array (see HOW). Extension point: the `holdout-verdict` schema and `CONTRACT_DESCRIBES["holdout-verdict"]`.

- **Changing the holdout aggregate derivation (`deriveHoldoutAggregate`) or the merge-gate L4 floor.** Why excluded: the routing is done by the evaluator *before* it builds the verdict array, so the existing derivation applies unchanged to the running-stack subset. Extension point: `deriveHoldoutAggregate` in `contract-defs.js`.

- **QA spec-review lens LLM tier-tagging.** What's excluded: having the `QA` spec-review lens emit a per-criterion tier by LLM judgement. Why excluded: the deterministic marker-plus-keyword derivation is the authoritative machine carrier, and the spec-review-verdict is not an evaluator input. Extension point: a future issue lets the lens *raise an objection* prompting the author to add a marker, never become a second runtime carrier.

- **Widening the integration keyword vocabulary to a configurable list.** Why excluded: the module's tunable constants (`BANNED_VAGUE`, `OBSERVABLE_TOKENS`) are in-source and grown from real misses; a config surface is premature. Extension point: the `INTEGRATION_TIER_MARKERS` constant is the single edit site.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Verification tier | Which verifier can observe a criterion. This slice defines two values: `running-stack` and `integration`. Orthogonal to `class` (shape) and to `holdout` (builder-visibility). FAFF-962 adds a third value, `not-yet-reachable`. |
| `running-stack` | Observable by poking the live running system from outside: an HTTP response, an exit code, a file's on-disk state. The code-blind holdout's remit. The default. |
| `integration` | Born-verifiable, but only by an integration-test harness the running-stack-only judge cannot drive: a down-migration on a forward-only stack, a rollback, a reversal. Verified by the review/merge test floor (which runs the build's own tests and reads the diff), never by the holdout — the code-blind holdout cannot read those tests, so it delegates rather than judging. |
| Review/merge test floor | The build's own tests, run and gated by the review slot and the merge-gate. The verifier for `integration`-tier criteria. This slice does not add a per-criterion link to it; it relies on the existing test floor and the review lane confirming the criterion is tested. |

**The tier enum and the field shape (additive).** `dodClassify` gains a per-criterion string field and a top-level count map, both additive. `counts`, `class`, `source`, `holdout`, `holdout_counts`, `oracle_less`, and `oracle_less_count` are all untouched.

```
ENUM VerificationTier = "running-stack" | "integration"    # FAFF-962 widens this with "not-yet-reachable"

RECORD Criterion:                    # existing shape + one new field
  text: string
  class: "scenario" | "assertion" | "prose"    # UNCHANGED
  source: "scenarios" | "done"                 # UNCHANGED
  holdout: boolean                             # UNCHANGED (FAFF-275)
  oracle_less: boolean                         # UNCHANGED (FAFF-812)
  verification_tier: VerificationTier          # NEW — default "running-stack"

RECORD DodClassifyResult:            # existing shape + one new top-level field
  criteria: List<Criterion>                    # UNCHANGED (now each carries verification_tier)
  counts: { scenario, assertion, prose }       # UNCHANGED — still sums to criteria.length
  holdout_counts: { holdout, visible }         # UNCHANGED (FAFF-275)
  oracle_less_count: integer                   # UNCHANGED (FAFF-812)
  verification_tier_counts:                    # NEW — a map over the tier values in use
    { "running-stack": int, "integration": int }

  CONSTRAINT counts.scenario + counts.assertion + counts.prose == criteria.length          # preserved
  CONSTRAINT sum(verification_tier_counts values) == criteria.length
  CONSTRAINT every criterion's verification_tier is one of the enum values
```

**The two deterministic derivation sources.**

*1. Explicit author/planner marker* (mirrors FAFF-275's holdout markers, recognised in the `## Scenarios` section body only):

- **Bullet prefix:** a criterion bullet beginning `integration:` (case-insensitive). The prefix is stripped before `classifyCriterion` runs and is never part of the stored `text` — exactly as `holdout:` is stripped today.
- **Fenced info string:** a GWT fence opened with an `integration` info string (backtick or tilde fence). Every criterion unit inside carries that tier — mirroring `isHoldoutFenceOpen`.

*2. Integration keyword heuristic* (a narrow in-source token set, applied to any criterion the marker did not tier, over *both* the scenarios-sourced and done-sourced criteria so the same text tiers identically wherever it appears):

```
CONSTANT INTEGRATION_TIER_MARKERS =    # migration-reversal family — deliberately minimal, grown from real misses
  { "down-migration", "down migration", "migrate down", "downward migration",
    "rollback", "roll back", "rolled back",
    "revert the migration", "reverse the migration", "reversible migration" }
```

**Precedence** (first match wins, per criterion):

1. An explicit `integration` marker (bullet prefix or enclosing tier fence) → `integration`.
2. Else an `INTEGRATION_TIER_MARKERS` substring hit → `integration`.
3. Else → `running-stack` (the conservative default).

**Design decision — tier as an additive field, not a fourth class.** Three options:

- A fourth `class` value. Con: breaks every consumer switching on the three-value `class` and its `counts` — the holdout-verdict contract's `HOLDOUT_CLASSES`, ADR-0029's prose rule, the evaluator's born-verifiable split. Exactly what FAFF-812 rejected.
- Fold tier into `oracle_less`. Con: `oracle_less` is a boolean scoped to `assertion` only; tier is an enum spanning `scenario` too (a down-migration is often a GWT scenario). It does not fit.
- An additive `verification_tier` enum field alongside `class`.

**Chosen:** an additive `verification_tier` enum field plus a top-level `verification_tier_counts` map, mirroring FAFF-275's additive `holdout` / `holdout_counts` and FAFF-812's additive `oracle_less` / `oracle_less_count`. Integration-tier is a **new axis orthogonal** to the observable/prose classes, not a fold-in.

## 4. HOW — behaviour

**Approach.** Two edits. First, in `admissibility.js`: teach the Scenarios-section parser to recognise the `integration` marker forms (bullet prefix and fenced info string), and add a post-pass in `dodClassify` that sets `verification_tier` from marker-or-keyword-or-default and sums `verification_tier_counts`. `cmdDod` needs no change (it serialises whatever `dodClassify` returns; the `dod classify` JSON has no on-disk schema). Second, in `faffter-noon-evaluate/SKILL.md`: after `dod classify`, partition by tier and exercise only running-stack criteria; delegate `integration` criteria by excluding them from the emitted verdict's criteria array and recording them in the human-readable evidence.

**Deriving the tier in `dodClassify`.**

```
PROCEDURE dodClassify(specText):    # additive edits only
  ... build criteria as today, now also carrying an author-marked tier from the parser ...
  FOR each criterion c:
    IF c already carries an explicit integration marker (from the Scenarios parser):
      c.verification_tier := "integration"
    ELSE IF any INTEGRATION_TIER_MARKERS token is a substring of lowercase(c.text):
      c.verification_tier := "integration"
    ELSE:
      c.verification_tier := "running-stack"
  result.verification_tier_counts := tally of c.verification_tier over all criteria
  RETURN result   # counts, holdout_counts, oracle_less_count all otherwise unchanged
```

The marker recognition rides the existing `classifyAcceptanceCriteria` machinery. Where that function reads a bullet's `holdout:` prefix and a fence's `holdout` info string today, it additionally reads an `integration:` bullet prefix and an `integration` fence info string, carrying the recognised tier out on each unit. The keyword heuristic and default run in the `dodClassify` post-pass, over both sources, so the same criterion text tiers identically from either source.

**Anti-pattern:** flipping an integration criterion's `class` to `prose`. Why: that changes `counts`, breaks the born-verifiable-shape signal every consumer reads, and conflates "the holdout can't observe this" with "this is unverifiable prose" — an integration-tier criterion *is* born-verifiable, just by a different verifier. Carry the finding on `verification_tier` only.

**Anti-pattern:** matching a bare word like "migration" or "database" as an integration marker. Why: forward migrations and ordinary DB assertions are running-stack-observable; only the reversal family ("down-migration", "rollback") signals the integration tier. Keep `INTEGRATION_TIER_MARKERS` phrase-specific, as `INTERNAL_SUBJECT_MARKERS` is.

**Tier-aware routing in the evaluator** (`faffter-noon-evaluate/SKILL.md`, the classify-and-split step at lines 37 to 40).

```
PROCEDURE evaluate_classify_and_route(spec, env):
  1. classified := faff dod classify --spec <spec> --json
  2. Partition classified.criteria by verification_tier:
       running-stack -> the JUDGED set    (the holdout exercises these)
       integration   -> the DELEGATED set (the holdout structurally cannot verify;
                        the review/merge test floor does)
  3. Within the JUDGED set, apply the existing split unchanged:
       prose            -> needs-human, evidence_present:false (ADR-0029, never machine-judged)
       scenario/assertion -> exercise against the running env; met/unmet with evidence,
                            or needs-human with a note if the env exposes no surface
                            (the existing line-38 runtime fallback, kept as the backstop)
  4. Build the verdict's criteria array from the JUDGED set ONLY.
     DELEGATED (integration) criteria are EXCLUDED from the verdict array — the holdout
     cannot and does not judge them; they remain DONE requirements the builder must
     implement and test and the review/merge test floor enforces. The standard
     deriveHoldoutAggregate then reflects only the running-stack subset.
  5. Record every DELEGATED criterion — its text, its tier, and the reason (delegated to
     the review/merge test floor) — in the human-readable evidence report alongside the
     block (never inside the block).
```

**Why delegate rather than mark `needs-human`.** A down-migration (`integration`) genuinely *is* verifiable — by the review/merge test floor, which runs the build's own tests — and the code-blind holdout simply cannot be that verifier: it is forbidden from reading the builder's test suite and only pokes the running system. Recording it `needs-human` would drag the aggregate to `needs-human` and false-block the epic, which is exactly the FAFF-961 stall. Excluding it lets the running-stack subset roll up to `meets-spec` so the epic attaches, while the criterion stays a DONE requirement the review/merge lane confirms is tested. The holdout-verdict contract is untouched: it validates whatever array it is given (aggregate matches derivation, prose is needs-human, met/unmet carry evidence), and it does not cross-check the array against the classifier's full criteria count.

**Relationship to the existing line-38 runtime fallback — layer over, do not replace.** The tag is a *proactive* pre-filter at classify time (a criterion known to be integration-tier is never exercised, avoiding a wasted or ambiguous poke and never forcing the aggregate to `needs-human`). The line-38 fallback stays as the *reactive* backstop: a running-stack-tagged criterion that turns out at runtime to expose no surface still fails closed to `needs-human` with a note. This backstop is also what covers the future `not-yet-reachable` cases until FAFF-962 handles them explicitly — an unmarked no-surface criterion stays `running-stack` and blocks via the fallback, exactly as today. No regression.

**Interaction with the holdout axis.** `verification_tier` and `holdout` are orthogonal fields, but an `integration` tier means the code-blind holdout does not exercise the criterion, so also marking it `holdout:` (reserving it *for* the code-blind evaluator) is incoherent. The evaluator routes on tier: an `integration` criterion is delegated regardless of the `holdout` flag. `dodSplit`'s builder view is unaffected — a tier marker is not a holdout marker (`isHoldoutFenceOpen` matches only the exact `holdout` info string), so an integration criterion stays in the builder view and is still built; it is only *verified* differently (the review/merge lane).

**Failure modes.**

- **The failure:** the integration keyword set is the wrong shape — real specs phrase integration-tier criteria in ways `INTEGRATION_TIER_MARKERS` does not catch and the author did not mark, so the holdout still tries to exercise them and hits the runtime fallback, re-blocking. How you'd know: an L4 drain stalls on a `needs-human` criterion whose text names an integration-only behaviour with no marker. What it means: narrow — grow `INTEGRATION_TIER_MARKERS` from the real miss (as `BANNED_VAGUE` grows) and/or the author adds a marker; do not escalate to an LLM in this slice.
- **The failure:** over-tagging to `integration` — the keyword heuristic (or an over-eager marker) moves a genuinely running-stack criterion into the DELEGATED set, so the holdout stops checking it and, if no covering integration test exists, nothing does. How you'd know: a criterion the running stack *could* have exercised is absent from the verdict array; a build passes the holdout with a known running-stack behaviour unchecked. What it means: this is the dangerous direction, guarded three ways — the conservative running-stack default, the deliberately-minimal (migration-reversal-only) keyword set, and the review/merge lane, which reads the diff and is responsible for confirming an `integration`-tier criterion is actually tested (the holdout structurally cannot). This is why `integration` is *delegated*, not *dropped*: the criterion stays a DONE requirement the review lane enforces, so "verified by nobody" requires both a mis-tag and a review-lane miss.

## 5. Scenarios

The behavioural objective above the complexity bar is the derivation's discrimination between the two tiers and the evaluator's delegation of the integration tier. Trivial wiring (adding a field, summing a count) gets no scenario.

```
Given a DoD scenario enclosed in an integration-tier fence (Given a migrated database / When the down-migration runs / Then the schema reverts)
When faff dod classify runs over the spec
Then that criterion's verification_tier is "integration" and its class is unchanged ("scenario")
```

```
Given the unmarked DoD assertion "The rollback MUST restore the previous schema"
When faff dod classify runs over the spec
Then the criterion's verification_tier is "integration" (matched by the keyword heuristic)
```

- An unmarked running-stack assertion ("The API MUST return 200 on /healthz") keeps `verification_tier: "running-stack"` — the conservative default holds unless a marker or the narrow keyword set fires.
- `verification_tier_counts` MUST sum to `criteria.length`, and `counts.scenario + counts.assertion + counts.prose` MUST still equal `criteria.length` (no existing count changes; the two new fields are additive).
- Given a classification with running-stack criteria that are all met plus one `integration` criterion, when the evaluator routes and emits its verdict, then the `integration` criterion is EXCLUDED from the verdict array, the aggregate is `meets-spec` (the delegated criterion does not drag it to `needs-human`), and the `integration` criterion is listed in the evidence report as delegated to the review/merge lane.

## 6. DESIGN DECISION RATIONALE

**Where does tier live on the output — a fourth class, a fold-in, or a new field?**

- Fourth `class` value: rejected. Breaks `HOLDOUT_CLASSES`, ADR-0029, `counts`, and the evaluator split. FAFF-812 already set this precedent.
- Fold into `oracle_less`: rejected. `oracle_less` is a boolean scoped to `assertion`; tier is an enum spanning `scenario`.
- **Chosen:** an additive `verification_tier` enum field plus `verification_tier_counts`, orthogonal to `class`/`holdout`/`oracle_less`.

**How is tier derived — keyword heuristic, QA lens, author marker, or a mix?**

- LLM QA-lens: rejected for this slice. It is non-deterministic and its output (the spec-review-verdict) is not an evaluator input, so it cannot be the runtime carrier.
- **Chosen:** an explicit author marker (mirroring FAFF-275, deterministic) as the primary source, plus a narrow deterministic keyword heuristic as the integration-tier backstop, with `running-stack` as the conservative default. The authoritative tier lives on the `dod classify` output only.

**How does the evaluator route the integration tier — mark `needs-human`, or delegate by exclusion?**

- Mark `needs-human`: rejected. Any `needs-human` verdict forces the aggregate to `needs-human`, reproducing the exact FAFF-961 stall for a criterion a different verifier already covers.
- **Chosen:** delegate by excluding integration criteria from the holdout verdict array (kept as DONE requirements the review/merge test floor enforces) and recording them in the evidence report. The running-stack subset can then reach `meets-spec`; the criterion is verified by its proper tier; the exclusion is auditable.

**Why split the `not-yet-reachable` case out (FAFF-962)?**

- `not-yet-reachable` cannot use the same delegation. It has no covering test either (the surface does not exist yet), so excluding it silently is fail-open, and recording it `needs-human` re-creates the stall. It needs *defer-with-obligation* — a criterion-scoped obligation the project PRD-coverage gate holds open — which the shipped `faff prdr coverage` cannot express (it collapses each epic to one DoD-verdict string). That is a multi-contract feature, so it is its own ticket. This slice delivers the clean, self-contained integration half with no regression to the not-yet-reachable path (which keeps blocking via the runtime fallback, as today).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None for this slice — the `not-yet-reachable` design question moved to [FAFF-962](https://linear.app/shftwst/issue/FAFF-962).

**Assumptions.**

- **Assumes:** `dodClassify` still builds its criteria from the two sources (`## Scenarios` via `classifyAcceptanceCriteria`, `### N. DONE` via `parseDoneChecklist`) and returns the `{ criteria, counts, holdout_counts, oracle_less_count }` shape. Validation: read `dodClassify` (lines 187 to 217) and `classifyAcceptanceCriteria` (lines 107 to 139) before editing; confirm the criterion-push sites and the marker-parsing structure match this spec before adding the field and the marker forms.
- **Assumes:** the FAFF-275 holdout marker machinery (`isHoldoutFenceOpen`, the `holdout:` bullet prefix, the fence-info-string handling in `classifyAcceptanceCriteria`) exists as the template for the `integration` marker. Validation: grep `isHoldoutFenceOpen` and `holdout:` in `admissibility.js`; mirror the fence-and-bullet recognition.
- **Assumes:** the evaluator SKILL.md's classify-and-split step (lines 37 to 40) is the routing insertion point and its verdict block is built from the judged criteria. Validation: read `faffter-noon-evaluate/SKILL.md` "How it evaluates"; confirm the classify step and the "Force prose to needs-human" step are where routing slots in.
- **Assumes:** the review/merge test floor is the operative verifier for `integration`-tier criteria — the review slot reads the diff and the merge gate runs the build's tests. Validation: the review slot already covers AC coverage and test presence; delegation relies on that existing responsibility, not a new per-criterion link.

## 8. DONE — definition of done

### From WHY
- [ ] `faff dod classify` over a spec containing a down-migration criterion tags it `verification_tier: "integration"` (via marker or keyword) and does not change its `class`.
- [ ] The change never alters the `admissible` verdict and never changes any existing `class`, `counts`, `holdout`, `holdout_counts`, `oracle_less`, or `oracle_less_count` value.

### From WHAT (types and derivation)
- [ ] Each `Criterion` in `dodClassify`'s output carries a `verification_tier` that is one of `"running-stack"`, `"integration"`, defaulting to `"running-stack"`.
- [ ] `dodClassify`'s result carries `verification_tier_counts` (a map over the tier values) that sums to `criteria.length`.
- [ ] `counts.scenario + counts.assertion + counts.prose == criteria.length` still holds.
- [ ] An `integration:` bullet prefix (case-insensitive) in the Scenarios section is recognised, tiers the criterion, and is stripped from the stored `text` (as `holdout:` is).
- [ ] An `integration` fence info string in the Scenarios section tiers every unit inside it.
- [ ] An unmarked criterion whose text contains an `INTEGRATION_TIER_MARKERS` token (e.g. "rollback", "down-migration") tiers `"integration"`; an unmarked criterion with neither a marker nor a keyword hit tiers `"running-stack"`.
- [ ] `INTEGRATION_TIER_MARKERS` exists as an in-source constant.
- [ ] Precedence holds: an explicit `integration` marker wins over the keyword heuristic, which wins over the `running-stack` default.

### From HOW (evaluator routing)
- [ ] `faffter-noon-evaluate/SKILL.md` reads `verification_tier` after `dod classify` and partitions criteria into a running-stack JUDGED set and an `integration` DELEGATED set before the exercise loop.
- [ ] The evaluator exercises only running-stack criteria. `integration` (DELEGATED) criteria are EXCLUDED from the `holdout-verdict` criteria array, so `deriveHoldoutAggregate` reflects only the running-stack subset (running-stack all met + one `integration` criterion rolls up to `meets-spec`, not `needs-human`).
- [ ] The SKILL.md prose states that `integration` criteria are delegated to the review/merge test floor (the code-blind holdout cannot read the builder's tests and does not verify them), not silently dropped, and remain DONE requirements the review lane confirms are tested.
- [ ] The evaluator records each DELEGATED criterion (text, tier, reason) in the human-readable evidence report, never inside the contract block.
- [ ] The tier routing layers over the existing line-38 runtime "no surface → needs-human" fallback (which still fires for a running-stack criterion that exposes no surface at runtime, including the not-yet-reachable cases FAFF-962 will handle); the SKILL.md prose states the layering.
- [ ] The holdout-verdict contract, schema, and `deriveHoldoutAggregate` are unchanged (no tier field echoed onto the verdict; the routing only changes which criteria populate the array).

### From HOW (selftest and tests)
- [ ] `dod --selftest` (`dodSelftest` in `admissibility.js`) gains cases for: an `integration`-marked scenario tiering `integration` with class unchanged; a keyword-matched unmarked assertion ("rollback") tiering `integration`; an unmarked plain assertion staying `running-stack`; and `verification_tier_counts` summing to `criteria.length`.
- [ ] `test/dod.test.mjs` gains CLI JSON assertions mirroring the existing holdout tests: a spec exercising both tiers, asserting each criterion's `verification_tier`, the counts sum invariant, and that `counts`/`holdout_counts` are unchanged shape.
- [ ] The existing FAFF-275 / FAFF-812 selftest and `test/dod.test.mjs` checks still pass (green) — the new field and marker do not perturb holdout parsing, `dodSplit`'s builder view, or the oracle_less post-pass.

This work adds no new or changed LLM-judgement grader `KIND`: the tier derivation is deterministic (marker plus keyword) and the evaluator's LLM judgement (exercise, met/unmet) is unchanged in kind, so no eval-coverage DONE item is required. The evaluator's `judgement_seam` frontmatter (`holdout`, `holdout-exercise`, `holdout-live`) is unchanged.

### Integration smoke test
```
faff dod --selftest
# exit 0; all existing checks plus the new verification_tier checks pass
```

confidence: high
build-tier: complex