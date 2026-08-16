# FAFF-815 — Adversarial YAGNI conservative-rejects an admissible PRDR when its DoD covers more goals than it cites

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-815.

build-tier: complex
spec-review: approve

_Revised 2026-08-16 (spec-review round 1, `revise`): tightened the under-citation admit to fire only on a mis-attributed over-scope overturn via a closed-vocab `challenge.ground` (methodology/major — preserve skeptic authority on non-scope overturns); expanded the predicate-boundary test matrix (QA/minor). New decision Q7._

This is the `spec`-slot deliverable for **FAFF-815** — a bug fix for the two-phase YAGNI gate's adversarial arbitration. Audience: the build agent that will implement it, and the human reviewers who gate this spec. It is buildable from this document plus the named files.

# 1. WHY — Problem and Principles

**Load-bearing model.** The YAGNI gate arbitrates one question — *does this PRDR earn its keep?* — over **three goal sets that must be kept distinct**: **D**, the PRD's *declared* goals; **C**, the goals the PRDR *cites* (its `PRD-goal` field); and **V**, the goals the PRDR's *DoD actually covers*. Today the gate collapses C to a single string and never sees V, so it cannot tell a **citation bug** (V ⊆ D but C ⊊ V — the DoD delivers declared goals it forgot to name) from **gold-plating** (V ⊄ D — the DoD reaches beyond anything the PRD asked for). The fix makes citation a *set* and gives the arbitration V and D so "over-scope" is measured against the declared goal set, not against the single citation.

**Problem statement.** On an L4 link-shortener run, `/faff-plot --autonomous` authored a P0 functional-MVP PRDR whose DoD discharges all five PRD goals but which cited only goal 1; the Phase-2 skeptic overturned it ("cites goal 1 but covers goals 1–5"), the arbitration's unconditional overturn-reject fired, the PRDR stayed `Proposed`, `faff prdr coverage` stayed `covered:false`, and the run dead-ended at decompose with no build work. The pain: a *correctly-scoped* MVP is conservative-rejected because a narrow citation is indistinguishable from over-scope. This change makes citation plural, teaches the arbitration to distinguish under-citation from genuine over-scope, and instructs the authoring lenses to cite every declared goal the DoD covers.

**Design principles.**

- **Scope is judged against the declared PRD goal set, never the single citation.** A functional MVP that delivers several *declared* goals in one PRDR is correct scope, not gold-plating. An implementation that keeps treating "covers more than the one cited goal" as over-scope is rejected.
- **The distinction must be mechanical, not prose-only.** The skeptic is an LLM; AC#1 and AC#3 must hold even when the skeptic mis-attributes. The deterministic over-scope test (`V ⊄ D`) lives in the pure arbitration so the guarantee does not rest on prompt wording alone.
- **Conservative-reject stays the default under doubt.** The gate only *newly* admits the one provably-benign case (under-citation: `V ⊆ D ∧ C ⊊ V`). Absent the new covered-set input, behaviour is byte-identical to today (conservative reject on any overturn) — no silent widening of what admits.
- **Back-compat is non-negotiable.** Existing single-goal `PRD-goal:` records must still parse, validate, cover, and admit unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/prdr.js` | Node.js | PRDR record shape (template/parser/validate), the `new`/`yagni`/`coverage` CLI branches, in-lib selftest |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node.js | `computePrdrYagniVerdict` (the arbitration), `computePrdrYagni` (consumer validator), `computePrdCoverageVerdict` |
| `plugin/skills/faff/bin/lib/adr.js` | Node.js | `adrField` parser reused verbatim by PRDR (colon-anchored — `PRD-goal` and `PRD-goals` are cleanly separable) |
| `plugin/skills/faff/contracts/prdr-yagni.schema.json` | JSON Schema | `additionalProperties:false` verdict shape — must gain the new audit fields |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` | Prompt | `prdr-author` + `yagni-judge` (the singular-citation and singular-scope prose) |
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | Prompt | `prdr-author` + `yagni-judge` rows (the "exceeding the goal → `within_scope:false`" conflation) |

**Scope statement.** This sits at the PRDR upper (YAGNI) gate inside the L4 `/faff-plot` decompose→admit loop, between `prdr-author`/`yagni-judge` (Phase 1), the adversarial skeptic (Phase 2), and `faff prdr admit`/`accept`.

# 2. OUT OF SCOPE

- **Phase-2 transport bug (FAFF-816).** — The sibling ticket covers the Phase-2 challenge running through the wrong transport. **Why excluded:** explicitly assigned to FAFF-816; this ticket is the arbitration/citation logic only. **Extension point:** `plugin/skills/faffter-dark-adversarial-review/SKILL.md` challenge dispatch.
- **Auto-rewriting an under-cited PRDR's stored citation to the covered set.** — When the arbitration admits a residual under-citation, it *emits* the widened covered set as advisory (`cited_goals`) but does **not** write it back into the record. **Why excluded:** introducing a second field-writer of the PRDR record (today `prdrAccept` is the sole `Status` writer) is a distinct, riskier change; the primary AC#2 flip comes from `prdr-author` citing all covered goals up front, so the record is already complete on the normal path. **Extension point:** a future `faff prdr recite`/reconciliation step in `faff-plot` Step 5c, consuming the emitted `cited_goals`.
- **A dedicated `prdr-yagni` adversarial judgement-seam.** — The under-citation/over-scope distinction is formalised deterministically in the pure arbitration (set comparison), not as a new refutation seam. **Why excluded:** the deterministic set-test makes a new seam unnecessary and would broaden the adversarial-review contract. **Extension point:** `plugin/skills/faffter-dark-adversarial-review/SKILL.md` `judgement_seam:` list.
- **Per-goal *depth* over-delivery (gold-plating within a single declared goal).** — The set model classifies scope by *which* declared goals the DoD touches, not *how far* it over-delivers within one goal. **Why excluded:** the ticket's model is set-membership ("covering five goals is correct scope"); depth-of-delivery remains the skeptic's `within_scope` judgement and still rejects via a non-under-citation overturn. **Extension point:** the `yagni-judge` `within_scope` prose.
- **`computePrdDistance` multi-goal semantics.** — Distance (FAFF-535) keeps keying per-entry on the *primary* cited goal. **Why excluded:** distance is an ordering tiebreaker, not gate-decisive for this bug; retaining the primary-goal label avoids churn. **Extension point:** `computePrdDistance` in `contract-defs.js`.

# 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Declared goals (D)** | The PRD's full goal list (`--prd-goals`, a JSON array). |
| **Cited goals (C)** | The goal set the PRDR names in its `PRD-goals` record field (`--prd-goal`, now comma-tolerant). Trace requires `C ≠ ∅ ∧ C ⊆ D`. |
| **Covered goals (V)** | The declared goals the PRDR's DoD actually delivers, as identified by the Phase-1 judge / Phase-2 skeptic (`--dod-covers`, a JSON array). |
| **Under-citation** | `V ⊆ D ∧ C ⊊ V` — the DoD covers only declared goals but names fewer than it covers. A citation bug, not over-scope. |
| **Over-scope (gold-plating)** | `V ⊄ D` — the DoD covers capability that is not any declared PRD goal. |

**PRDR record shape.** Citation becomes a comma-separated set. The parsed record carries both the set and a primary for back-compat consumers:

```
RECORD PrdrRecord:                     # docs/prdr/NNNN-*.md, parsed by listPrdrs
  prd_goals: List<String>              # NEW — the cited set C; parsed from the "PRD-goals:" field,
                                       #   comma-split, trimmed, empties dropped. LEGACY FALLBACK:
                                       #   if "PRD-goals:" absent but "PRD-goal:" present, [that value].
  prd_goal:  String                    # RETAINED — prd_goals[0] (primary); "" if none.
                                       #   Keeps distance/list and any single-goal consumer working.
  CONSTRAINT prd_goals non-empty for a valid record (mirrors today's "PRD-goal present")
```

**Template field.** `prdrTemplate` renders `- **PRD-goals:** <comma-joined C>` in place of `- **PRD-goal:** <g>`.

**YAGNI verdict shape (`prdr-yagni` contract).** Additive fields on the existing verdict (schema is `additionalProperties:false`, so the schema MUST be extended):

```
RECORD PrdrYagniVerdict:
  admit: Boolean
  reason: String
  trace_to_goal: Boolean               # now: C ≠ ∅ ∧ C ⊆ D  (set membership, not single-string)
  cited_goals: List<String>            # NEW — C, echoed for audit (and the advisory widened set on
                                       #   an under-citation admit: C ∪ V)
  dod_covers: List<String>             # NEW — V, echoed for audit
  over_scope: Boolean                  # NEW — V ⊄ D (deterministic gold-plating signal)
  proposal:  { serves_goal, within_scope, verdict: admit|reject, reason }   # unchanged shape
  challenge: { ran, overturns, reason, ground }   # ground NEW — why the skeptic overturned:
                                                  #   "over-scope" | "unserved" | "other"; absent ⇒ "other" (fail-safe)
  grounding_present: Boolean
  conformant: Boolean
  violations: List<String>
```

**CLI flag surface (`faff prdr`).** One meaning per flag, consistent across subcommands:

| Flag | Meaning | Subcommands | Parse |
|---|---|---|---|
| `--prd-goal` | Cited set **C** | `new`, `yagni` | comma-separated string (single value = 1-element set; back-compat) |
| `--prd-goals` | Declared set **D** | `yagni`, `coverage`, `distance` | JSON array (unchanged) |
| `--dod-covers` | Covered set **V** | `yagni` | JSON array (new; arity 1) |
| `--challenge-ground` | Why Phase-2 overturned: `over-scope` \| `unserved` \| `other` | `yagni` | enum string (new; arity 1; absent ⇒ `other`) |

**Coverage input shape.** `--live-prdrs` objects and the internal read gain `prd_goals`; `prd_goal` still accepted as a legacy single:

```
RECORD LivePrdr:
  id: String
  prd_goals: List<String>?             # NEW — the cited set; union across live PRDRs forms citedGoals
  prd_goal:  String?                    # LEGACY — treated as [prd_goal] when prd_goals absent
  dod_verdict: String?
```

**Design decisions** — all markers collected in §6.

# 4. HOW — Behavior

**Architecture and approach.** Three coordinated layers: (A) the record shape carries a citation *set*; (B) the pure arbitration gains V and D and distinguishes under-citation from over-scope; (C) the authoring/judging prose stops conflating "more than cited" with "over-scope." Layers A+C are *prevention* (the normal path: author cites all covered goals, so `C = V`, coverage flips, no overturn). Layer B is the *mechanical guarantee* (AC#1/AC#3 hold even on a mis-aimed overturn, and residual under-citation admits instead of dead-ending).

**A — plural citation (`prdr.js`).**

```
PROCEDURE parse prd_goals (in listPrdrs):
  1. raw := adrField(text, "PRD-goals")          # colon-anchored; will NOT match a "PRD-goal:" line
  2. IF raw is null: raw := adrField(text, "PRD-goal")   # legacy single-goal record
  3. prd_goals := raw ? raw.split(",").map(trim).filter(non-empty) : []
  4. prd_goal := prd_goals[0] ?? ""              # retained primary
```

- `prdrTemplate`: write `- **PRD-goals:** ${prdGoals}` (the comma-joined citation).
- `prdr new`: `--prd-goal` stays required (drift-guard table unchanged); accept a comma-separated value; write it to the `PRD-goals:` field.
- `prdrValidate`: the "missing PRD-goal field" check becomes "missing citation" — pass when *either* `PRD-goals:` or legacy `PRD-goal:` yields a non-empty set.
- `list --json`: emit `prd_goals` alongside `prd_goal`.

**B — the arbitration (`computePrdrYagniVerdict` in `contract-defs.js`).** Behaviour summary: reject on any of the existing preconditions; then reject deterministically on genuine over-scope; then, on an overturn, admit *only* the provably-benign under-citation case, else conservative-reject; else admit.

```
PROCEDURE computePrdrYagniVerdict(input):
  D := dedup(input.prdGoals)                       # declared
  C := dedup(input.citedGoals)                     # cited (from --prd-goal, comma-split)
  V := dedup(input.dodCovers)                      # covered (from --dod-covers; [] when absent)
  ground := input.challengeGround IN {"over-scope","unserved","other"} ? input.challengeGround : "other"  # fail-safe default
  trace_to_goal := C.length > 0 AND C ⊆ D
  over_scope    := V has any member not in D        # V ⊄ D
  under_cited   := (V ⊆ D) AND (C ⊊ V)              # covers only declared goals, cites fewer

  IF NOT trace_to_goal:  admit=false; reason="no PRD-goal trace: cited <C> not all declared PRD goals"
  ELSE IF NOT proposalSupplied:  admit=false; reason="conservative reject … no Phase-1 proposal"
  ELSE IF proposalVerdict == "reject":  admit=false; reason="conservative reject … methodology proposed reject: <r>"
  ELSE IF NOT challengeRan:  admit=false; reason="conservative reject … Phase-2 did not conclude"
  ELSE IF over_scope:                                # AC#3 — deterministic, fires even if skeptic survived
      admit=false
      reason="conservative reject (no gold-plating on doubt) — genuine over-scope: DoD covers <V∖D> beyond the PRD's declared goals"
  ELSE IF overturns:
      IF under_cited AND ground == "over-scope":     # AC#1 — skeptic claimed over-scope, but V⊆D proves under-citation
          admit=true
          cited_goals := C ∪ V                       # advisory widened set (NOT written back — see OUT OF SCOPE)
          reason="admit — the over-scope overturn was mis-attributed under-citation: DoD covers declared goals <V∖C> that were not cited; scope is within the PRD"
      ELSE:                                          # any overturn on non-over-scope grounds (unserved/other/absent) → respect the skeptic
          admit=false
          reason="conservative reject (no gold-plating on doubt) — adversarial challenge overturned (<ground>): <r>"
  ELSE:  admit=true; reason=<survived>

  RETURN { admit, reason, trace_to_goal, cited_goals: (under_cited-admit ? C∪V : C),
           dod_covers: V, over_scope, proposal, challenge, grounding_present, conformant:true, violations:[] }
```

- **Set helpers** are language-agnostic membership/subset checks; dedup preserves first-seen order (mirror `computePrdCoverageVerdict`'s `[...new Set(...)]`).
- **Default V=∅** (no `--dod-covers`): `over_scope=false`, `under_cited=false` → an overturn takes the `ELSE` conservative-reject branch — **byte-identical to today**. This is what keeps every existing overturn-reject test green.

**B (consumer) — `computePrdrYagni`.** Re-derive `over_scope`/`under_cited` from the echoed `cited_goals`/`dod_covers`, and update the `earned` invariant:

```
earned := trace_to_goal AND proposal.verdict=="admit" AND challenge.ran
          AND NOT over_scope
          AND (NOT challenge.overturns OR (under_cited AND challenge.ground=="over-scope"))
```

> **Anti-pattern:** having the consumer re-derive `over_scope` by recomputing `V ⊄ D`. Why: the verdict does not carry D, and re-deriving would need it. Instead the producer *records* `over_scope` as a boolean field and the consumer treats it as authoritative (schema-checked), re-deriving only `under_cited` from `cited_goals`/`dod_covers` (both present) and reading `challenge.ground` straight off the verdict — matching the existing pattern where `computePrdrYagni` trusts the recorded `trace_to_goal`.

**A — coverage (`computePrdCoverageVerdict`).** The cited set becomes the *union* of every live PRDR's `prd_goals`:

```
citedGoals := union over live PRDRs of (p.prd_goals ?? (p.prd_goal ? [p.prd_goal] : [])) , as a Set of strings
uncovered_goals := dedup(D.filter(g NOT in citedGoals))
# covered / satisfied / completion / measure semantics unchanged
```

The `prdr.js coverage` branch's internal read (`livePrdrs = prdrs.map(...)`) includes `prd_goals: p.prd_goals`.

**Edge cases.**
- Empty PRD (`D=∅`): trace_to_goal false (`C⊆∅` only if `C=∅`), coverage vacuously covered — unchanged.
- `C` contains a goal not in D: trace_to_goal false → reject (a mis-cite is still a trace failure).
- `V` supplied but `C=V` and skeptic survives: `over_scope=false`, admit — the normal fixed-bug path.
- `V ⊄ D` **and** skeptic survives: `over_scope` still rejects (stronger AC#3 guarantee than the skeptic alone).
- Legacy record with only `PRD-goal:`: parsed as a 1-element `prd_goals` — covers, traces, admits exactly as before.

**Failure modes.**
- **The failure:** admitting on under-citation silently neuters the adversarial skeptic for legitimate non-scope overturns. **How you'd know:** a PRDR with `serves_goal` genuinely false gets admitted because `under_cited` happened to be true. **What it means:** narrow — the admit branch is gated on `under_cited` (`C ⊊ V`), so a PRDR that cites everything it covers (`C ⊇ V`) can never take it; the skeptic retains full authority there. Proceed.
- **The failure:** coverage does not flip because the admitted PRDR's record still cites the narrow `C`. **How you'd know:** AC#2 e2e shows `covered:false` after admit. **What it means:** proceed — on the primary path `prdr-author` cites all covered goals (`C=V=D`), so coverage flips; the under-citation admit path is a *no-dead-end* safety net, and full flip there is the deferred reconciliation (OUT OF SCOPE), not a regression (the PRDR is Accepted, so the build stage has work).

**C — prose (methodology + orchestration skills).**
- `faffter-noon-methodology-thematic/SKILL.md` → `prdr-author`: instruct citing **every declared PRD goal the DoD covers** (write the full set to `PRD-goals`), not a single ancestor goal. → `yagni-judge`: `within_scope` = "the DoD covers **only declared PRD goals** (`V ⊆ D`)"; covering *several* declared goals in one functional MVP is in-scope; only capability outside the declared set is over-reach.
- `faffter-dark-methodology-agile-delivery/SKILL.md` → `prdr-author` row + `yagni-judge` row: **remove** "exceeding the goal reads as `within_scope: false`" (the conflation) and reframe as "exceeding the **declared PRD goal set** reads as `within_scope:false`; covering multiple declared goals does not."
- `faffter-dark-adversarial-review/SKILL.md`: the overturn criterion for a PRDR is genuine over-scope (capability beyond the PRD's *declared goals*) or an unserved goal — **not** "covers more declared goals than cited" (that is under-citation, a citation fix, supplied to the arbitration as `--dod-covers`). The challenge must also **classify its ground** (`over-scope` | `unserved` | `other`) so the arbitration only overrides a *mis-attributed over-scope* overturn (Q7); an `unserved`/`other` overturn is always respected.
- `faff/SKILL.md` (~line 1114, two-phase arbitration) and `faff-plot/SKILL.md` (~Step 5c): note the arbitration receives `--dod-covers` **and `--challenge-ground`** and distinguishes under-citation (`V⊆D`) from over-scope (`V⊄D`); Step 5c passes the covered set and the challenge ground. Keep additions minimal (AGENTS.md lean/skimmable standard).

# 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The P1 bug is above the complexity bar (a non-obvious observable: covered flips, build gets work). Trivial parser/flag changes get none.

```
Given a PRD with five declared goals g1..g5
  And a P0 PRDR whose DoD discharges all five, authored citing all five (PRD-goals: g1,g2,g3,g4,g5)
  And Phase-1 yagni-judge returns { serves_goal:true, within_scope:true, verdict:admit }
When `faff prdr yagni --prd-goal g1,g2,g3,g4,g5 --prd-goals '[g1..g5]' --proposal admit --challenge survived --dod-covers '[g1..g5]'`
Then admit is true, trace_to_goal is true, over_scope is false
  And `faff prdr admit --upper` yields disposition admit and `faff prdr accept` writes Status: Accepted
```

```
Given the same under-citing PRDR (cites g1, covers g1..g5)
When the skeptic overturns on a NON-scope ground
  `faff prdr yagni --prd-goal g1 --prd-goals '[g1..g5]' --proposal admit --challenge overturned --challenge-ground unserved --dod-covers '[g1..g5]'`
Then admit is false (skeptic authority preserved — the safety-net fires only on an over-scope ground)
```

```
Given the same PRD (declared g1..g5)
  And a PRDR whose DoD covers g1 plus an undeclared capability "analytics dashboard"
When `faff prdr yagni --prd-goal g1 --prd-goals '[g1..g5]' --proposal admit --challenge survived --dod-covers '[g1,"analytics dashboard"]'`
Then admit is false, over_scope is true, and reason names the over-scope goal (genuine gold-plating still rejected)
```

- After accepting the five-goal PRDR, `faff prdr coverage --prd-goals '[g1..g5]'` over the live set returns `covered:true` (the union of cited goals equals D).
- With `--dod-covers` omitted, an `--challenge overturned` verdict is still `admit:false` (back-compat conservative reject).

# 6. DESIGN DECISION RATIONALE

**Q1 — What shape carries a multi-goal citation?**
Options: (a) new comma-separated `PRD-goals:` field with legacy `PRD-goal:` fallback; (b) reinterpret `PRD-goal:` as comma-separated in place; (c) an additional `Covers:` field. (a) reads naturally in the bullet list, keeps `adrField` reuse (its colon anchor means `PRD-goal` never matches `PRD-goals:`, so legacy and new coexist), and needs no data migration; (b) silently changes an existing field's grammar; (c) splits one concept across two fields and complicates trace/coverage.
**Chosen:** a comma-separated `PRD-goals:` record field, with `listPrdrs` falling back to legacy `PRD-goal:` and retaining `prd_goal = prd_goals[0]` as the primary. (decides: architecture)

**Q2 — Where does the under-citation vs over-scope distinction live?**
Options: (a) prose-only (fix the skeptic so it never overturns on under-citation); (b) a deterministic set-test in the pure arbitration. Prose-only is fragile (LLM) and cannot guarantee AC#1/AC#3; the set-test (`over_scope ⟺ V⊄D`, `under_cited ⟺ V⊆D ∧ C⊊V`) makes the guarantee mechanical and testable.
**Chosen:** both, with the deterministic set-test in `computePrdrYagniVerdict` as the load-bearing guarantee and the prose as prevention. (decides: architecture)

**Q3 — Primary mechanism: prevention (cite all up front) or cure (admit under-citation)?**
Prevention (author cites `V`, so `C=V`) is what flips coverage (AC#2) since coverage reads the record; cure alone cannot flip coverage without a record rewrite. Cure is still needed so a residual under-citation admits rather than dead-ends (AC#1).
**Chosen:** prevention is primary (satisfies AC#2 with no rewrite); the arbitration's under-citation admit is the safety-net cure. (decides: product)

**Q4 — Does the arbitration write the widened citation back into the record?**
Rewriting would flip coverage on the cure path too, but introduces a second PRDR field-writer alongside `prdrAccept` (the sole `Status` writer) — added risk for an edge case the primary path already covers.
**Chosen:** no rewrite; emit `cited_goals = C∪V` as advisory and defer reconciliation (extension point in Step 5c). (decides: architecture)

**Q5 — A new `prdr-yagni` adversarial judgement-seam?**
The deterministic set-test removes the need to formalise the distinction as a refutation seam.
**Chosen:** no new seam; reframe the existing adversarial overturn criteria in prose only. (decides: architecture)

**Q6 — Consumer (`computePrdrYagni`) re-derivation of `over_scope`?**
The verdict does not carry D, so the consumer cannot recompute `V⊄D`; it trusts the recorded `over_scope` boolean (schema-checked) and re-derives only `under_cited` from the present `cited_goals`/`dod_covers`, matching how it already trusts recorded `trace_to_goal`.
**Chosen:** record `over_scope` as an authoritative verdict field; consumer trusts it, re-derives `under_cited` locally. (decides: architecture)

**Q7 — How is the under-citation admit kept from overriding a skeptic overturn made on non-scope grounds?** *(raised by spec-review, methodology/major.)*
The blanket "overturn + `under_cited` ⇒ admit" would silently override a Phase-2 overturn whose real ground was *unserved / redundant / off-mission* rather than scope — weakening skeptic authority beyond the AC#1 target. The challenge already carries a free-text `reason`, but LLM prose is not a reliable gate. Options: (a) parse the `reason` string (fragile, model-dependent); (b) require the challenge to emit a **closed-vocabulary `ground`** (`over-scope` | `unserved` | `other`) and fire the under-citation admit only when `ground=="over-scope"` — the skeptic claimed over-scope, and the deterministic `V⊆D` set-test proves that claim was actually under-citation. This is a shape addition to the *arbitration input*, distinct from FAFF-816's *transport* of the challenge.
**Chosen:** add a closed-vocab `challenge.ground`; the under-citation admit fires only on `under_cited ∧ ground=="over-scope"`. Any overturn on `unserved`/`other` grounds — or an absent/unknown ground (fail-safe default `other`) — is respected as a conservative-reject. This scopes the cure to exactly the mis-attributed-over-scope case and preserves full skeptic authority everywhere else. (decides: architecture)

# 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions are closed above.

**Assumptions.**
- **Assumes:** the schema loader validates `prdr-yagni` against `plugin/skills/faff/contracts/prdr-yagni.schema.json` with `additionalProperties:false`, so the three new fields (`cited_goals`, `dod_covers`, `over_scope`) MUST be added to the schema or `schemaCheck` fails. *Validation:* grep the `yagni` CLI branch for `schemaCheck(verdict, "prdr-yagni")` and confirm the schema file is the one loaded before adding fields.
- **Assumes:** `--dod-covers` and `--challenge-ground` are currently-unused flag names in `PRDR_SPEC`. *Validation:* grep `PRDR_SPEC.flags` in `prdr.js` for both (expect absent) before adding each with `arity 1`.

# 8. DONE — Definition of Done

### From WHY
- [ ] A five-goal-covering P0 PRDR that cites all five clears the YAGNI gate and self-accepts (no conservative reject as over-scope).

### From WHAT (record shape)
- [ ] `prdrTemplate` renders `- **PRD-goals:** …`; `prdr new --prd-goal "a,b,c"` writes all three into that field.
- [ ] `listPrdrs` parses `PRD-goals:` (comma-split) into `prd_goals[]`, falls back to legacy `PRD-goal:`, and sets `prd_goal = prd_goals[0]`.
- [ ] `prdrValidate` passes a record with `PRD-goals:` and a legacy `PRD-goal:` record; still flags a record with neither.
- [ ] `list --json` emits `prd_goals`.

### From WHAT (verdict shape + schema)
- [ ] `prdr-yagni.schema.json` includes `cited_goals` (array), `dod_covers` (array), `over_scope` (boolean), and `challenge.ground` (enum `over-scope`|`unserved`|`other`); every produced verdict passes `schemaCheck`.

### From HOW (arbitration)
- [ ] `trace_to_goal` is `C ≠ ∅ ∧ C ⊆ D` (set membership); a single-goal `--prd-goal` still traces.
- [ ] `over_scope` (`V ⊄ D`) conservative-rejects, even when `--challenge survived` (AC#3).
- [ ] An `--challenge overturned --challenge-ground over-scope` with `under_cited` (`V ⊆ D ∧ C ⊊ V`) admits, and `cited_goals` echoes `C ∪ V` (AC#1).
- [ ] An `--challenge overturned` with `under_cited` but ground `unserved`/`other`/absent still conservative-rejects (skeptic authority preserved on non-scope overturns — Q7).
- [ ] An `--challenge overturned` with `C ⊇ V` (cites all covered) still conservative-rejects regardless of ground.
- [ ] With `--dod-covers` omitted (V=∅), an `--challenge overturned` verdict is `admit:false` for any ground (back-compat).
- [ ] `computePrdrYagni` (consumer) `earned` accepts the under-citation admit and rejects an over-scope admit; every produced verdict is `conformant:true`.

### From HOW (coverage)
- [ ] `computePrdCoverageVerdict` computes `citedGoals` as the union of live PRDRs' `prd_goals` (legacy `prd_goal` accepted); the five-goal PRDR flips `covered:true` (AC#2).

### From HOW (prose)
- [ ] `prdr-author` in both methodology skills instructs citing every declared goal the DoD covers.
- [ ] `yagni-judge` in both skills judges `within_scope` against the declared goal *set*; the agile lens's "exceeding the goal → `within_scope:false`" line is reframed to the declared set.
- [ ] The adversarial-review skill's overturn criterion excludes "covers more than cited" as an over-scope ground.
- [ ] `faff-plot` Step 5c passes `--dod-covers`; its prose-regression test still passes.

### From tests
- [ ] `plugin/skills/faff/bin/lib/prdr.js` `prdrSelftest` gains cases for plural parse, over-scope reject, under-citation admit, and multi-goal coverage; `faff prdr --selftest` passes.
- [ ] `test/prdr.test.mjs` (yagni + coverage) and `test/prdr-loop-admit.test.mjs` (the FAFF-495 e2e) extended for the three scenarios; all existing cases stay green.
- [ ] `prdrSelftest` pins the full predicate-boundary matrix (QA/minor — Q7 risk): `V⊄D` (over-scope reject); `V⊆D ∧ C⊊V` with ground `over-scope` (admit) vs ground `unserved` (reject); `V=C=D` (admit on survived); empty `D`/`C`/`V`; and a legacy single-`PRD-goal:` record tracing + covering as a 1-element set.

**Integration smoke test.**
```
1. tmp repo; PRD declares [g1..g5]
2. `faff prdr new "shorten+redirect" --container link-shortener --prd-goal "g1,g2,g3,g4,g5" --provenance loop --status Proposed`
3. yagni := `faff prdr yagni --prd-goal "g1,g2,g3,g4,g5" --prd-goals '[g1..g5]' --proposal admit --challenge survived --dod-covers '[g1..g5]'`  → admit:true
4. adm := `faff prdr admit … --upper {admit,reason} --lower {covered:true,uncovered_goals:[]}`  → disposition admit
5. `faff prdr accept 1 --actor loop --admit-verdict adm`  → Status Accepted on a prdr/ landing branch
6. `faff prdr coverage --prd-goals '[g1..g5]'`  → covered:true   # build stage has work; no dead-end
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Right-sized? (P4)** — *What's there:* one bug fix, but the spec fans across five seams — record shape in `prdr.js` (template/parser/validate + legacy back-compat), the pure arbitration `computePrdrYagniVerdict`/`computePrdrYagni` in `contract-defs.js` (new three-set model, new flag, new verdict fields), union-based `computePrdCoverageVerdict`, the `prdr-yagni.schema.json` extension, and prose reframes in four skills plus orchestration. *Why:* that's the top end of a 1–3 day unit; the one genuine fault line is the plural `PRD-goals:` citation field (a) — a data-model + back-compat concern with its own migration risk — vs. the arbitration correctness fix (b). *What to do:* keep it as one ticket (the three-set model cannot distinguish under-citation without the plural field, so they are a true ship-together pair, and the prose must land with the behaviour or it drifts), but if it overruns, split (a) the citation-field shape + legacy parse as the pre-req and land (b)–(e) on top. Defensible as a single unit as scoped.

**Workstream fit? (P1 + P5)** — *What's there:* no container named in the input, but the ticket sits in a clearly cohesive outcome family — the two-phase YAGNI/coverage gate on machine-authored PRDRs — alongside its Done predecessors FAFF-256 / 495 / 257 and its open sibling FAFF-816. *Why:* the family converges on one outcome (a YAGNI gate that admits admissible functional-MVP PRDRs), so it is not an activity-bucket smell; the only risk is it landing loose in Backlog and losing that lineage. *What to do:* home it with FAFF-816 under the "machine-authored PRDR YAGNI/coverage gate" outcome rather than leaving it project-less. Minor.

**Deps surfaced? (P6)** — *What's there:* FAFF-816 is named as a sibling "Phase-2 transport bug, open, out of scope here," with no blocker link. *Why:* this is the load-bearing finding. FAFF-815's observable success condition is `faff prdr coverage` flipping `covered:true` and the L4 plot run getting *past* decompose — but that outcome flows through the same two-phase gate whose Phase-2 transport FAFF-816 reports as broken. If the corrected `under_cited ⟹ admit` verdict has to transit Phase-2 to reach coverage, then 815's fix is silently ineffective end-to-end until 816 lands, and "out of scope" hides a real prerequisite. *What to do:* decide explicitly which holds — if 815's admit path traverses the 816 transport defect, add `FAFF-815 blockedBy FAFF-816` so sequencing is honest; if the arbitration/coverage change is observable independent of Phase-2 transport, state that independence in the spec so the reviewer isn't left to assume it. Do not leave it as an unlinked prose aside.

**Risk profile? (P7)** — *What's there:* no external-team or novel-integration dependency, but the change re-tunes a deterministic gate that dead-ends L4 plot runs, swapping the current arbitration for a new three-set model (`over_scope ⟺ V⊄D`, `under_cited ⟺ V⊆D ∧ C⊊V`) plus legacy-field back-compat parsing. *Why:* the risk is correctness of the set predicates, not integration — mis-drawing the boundary can either re-introduce the false-reject this fixes or, worse, newly *admit* genuine gold-plating (the opposite failure the gate exists to catch), and it fails silently as an admit/reject flip. *What to do:* not a full de-risking spike, but treat the boundary matrix as the de-risk deliverable — enumerate/property-test the corner cases (`V⊄D`, `V⊆D ∧ C⊊V`, `V=C=D`, empty D/C/V, single legacy `PRD-goal:` vs. plural `PRD-goals:`) before the prose reframes, so the conservative-arbitration change is pinned by tests rather than by narrative.