# FAFF-936 — Ground the spec-review refuters in the PRD goals, not just its non-goals

> Spec: faffter-dark-nlspec · 2026-08-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-936.
> build-tier: complex

This spec is for the build agent implementing FAFF-936, and for the human reviewer at the build gate. It extends an existing, shipped mechanism (FAFF-907's ratified-scope deferral) so the `faffter-dark-spec-review` adversarial refuters stop treating a ratified product goal as an unmitigated defect. Scope note: the boundary is the **occupant**, not the autonomy level — `faffter-dark-spec-review` runs its full adversarial behaviour at whatever level it is configured (L1–L4), so this change fires whenever dark runs and is never gated to L4. It is a clean mirror of a merged pattern plus one small assembler addition; read the WHY, then the two touch-points (the assembler in section 3, the lens prose in section 4).

## 1. WHY — Problem and Principles

**The load-bearing idea.** A spec-review refuter is only correct if it distinguishes *a defect* from *a decision that was already made on purpose*. FAFF-907 taught the design lenses to defer to ratified *exclusions* (the PRD's `## Non-goals` plus settled precedents/tradeoffs). It never taught them to defer to ratified *inclusions* (the PRD's positive goals). So a refuter can still object, round after round, to a requirement the product deliberately chose.

**Problem statement.** In a live L4 run speccing a link shortener, the infosec refuter objected every round that the design "shares an open, unauthenticated link", which is the ratified product goal for that service. The `## Ratified scope` block carried the non-goals but not the goals, so the goal read as an unmitigated defect and the loop churned. FAFF-930's judge would eventually terminate the loop, but only after the rounds are burned, and the objection should never have fired at blocker or major in the first place.

**Design principles.**

- **A ratified goal is settled input, not a defect.** An objection whose whole content is "the product should not do X" when X is a listed ratified goal is contesting a decision the human already made. It is recorded as an observation, not a gating objection. This is the exact symmetric twin of FAFF-907's non-goals deferral.
- **Deferral never silences a real defect.** Deferral applies only to an objection that contests a listed goal *as a goal*. The *implementation* of that goal is critiqued at full severity, and a `critical` is never deferred by any lens. A PRD goal must never become a way to launder a genuine exploit, an injectable input, or a fail-open path past the gate.
- **Mirror the proven path; add no new transport.** FAFF-907 already built the file, the container resolution, the byte-identical `--context` delivery, and the shared-prefix cache. Goals ride all of it. Reject any design that adds a new file, flag, or delivery channel for goals.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/ratified-scope.js` | Node (dependency-free) | Assembles/validates the `## Ratified scope` block; the only code change |
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,qa}.md` | Markdown prompts | The design-lens refuter briefs that gain the deferral clause |
| `plugin/skills/faffter-dark-spec-review/refute-methodology.md` | Markdown prompt | Receives the block for cache parity only; gains no clause |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown | The occupant's "Defer to ratified scope" section, extended to cover goals |
| `plugin/skills/faff/bin/lib/prd.js` | Node | Owns `prdDir`/`prdSlug` and the `## Goals & success metrics` template heading |
| `docs/guide/cli.md` | Markdown | The `ratified-scope` CLI row, gated by `lint-cli-doc` |
| `eval/review-bench/` + `eval/cases/` + `eval/grader.mjs` | Node + JSON | The refutation-spec eval kit and its byte-identical lens copies |

**Scope statement.** This sits at the spec-to-build-admission seam of the `faffter-dark-spec-review` occupant — the adversarial `spec_review` reviewer, which runs whenever it is the configured occupant, at any autonomy level (not only L4) — inside the ratified-scope deferral mechanism FAFF-907/919/910 established.

## 2. OUT OF SCOPE

- **The other `spec_review` occupant (`faffter-noon-spec-review`)** — what's excluded: adding goals-grounding to the single-pass reviewer. Why excluded: the boundary here is **occupant, not autonomy level** — `faffter-noon-spec-review` has zero ratified-scope plumbing, so porting the whole assembly-and-deferral apparatus into it is a larger, separate change. (`faffter-dark-spec-review`, the occupant this ticket alters, runs its full adversarial behaviour at whatever level it is configured — the change is never gated to L4.) FAFF-907 likewise only touched the dark occupant. Extension point: a follow-up ticket wiring `faff ratified-scope` assembly plus the deferral clauses into `plugin/skills/faffter-noon-spec-review/SKILL.md`.
- **Reading goals from a PRDR rather than the PRD** — what's excluded: sourcing goals from the "nearest PRDR" instead of the PRD's `## Goals & success metrics`. Why excluded: `ratified-scope` already resolves the PRD file by container; a PRDR's goals are citations of PRD goals, and "which PRDR is nearest" is an orchestration-ordering concern (FAFF-535). The ticket title says "PRD/PRDR"; this narrows to the PRD. Extension point: if PRDR-scoped goals are ever wanted, `assemble()` would take a resolved PRDR path from the orchestration layer, not compute nearness itself.
- **Enforcing goal authenticity** — what's excluded: proving the goals in the block were genuinely assembled from a committed PRD. Why excluded: `--validate` is a shape check by committed FAFF-919 decision, never an authenticity gate; goals inherit that exactly as non-goals do. Extension point: any authenticity gate would be a cross-cutting change to `validate()` for all subsections at once, not goals-specific.
- **Automatic baseline re-sweep** — what's excluded: refreshing `eval/baselines/frontier.json` `per_kind.refutation-spec` from a full model run. Why excluded: baseline acceptance is a human-supervised step, exactly as in FAFF-907. Extension point: the operator runs the scoped `--update-baseline --kind refutation-spec` sweep after merge.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Ratified goal | A bullet under the PRD's `## Goals & success metrics` heading, a product decision the human ratified by writing the PRD |
| Ratified goals subsection | The `### Ratified goals: PRD <container> (<path>)` block inside `## Ratified scope`, new in this change |
| Goal-as-goal objection | A refuter objection whose content is "the product should not do X" where X is a listed ratified goal (contests the decision itself) |
| Implementation objection | An objection to *how* a goal is delivered (an enumerable code, an injectable input, a fail-open path); never deferred |

**The assembler surface (`ratified-scope.js`).** Mirror the existing non-goals reader exactly.

```
CONSTANT GOALS_HEADING_RE = /^\s*##\s+goals\b/i
  # matches "## Goals & success metrics", "## Goals"; does NOT match "## Non-goals"
  # (verified: the \b word-boundary rejects "## Goalsomething")

FUNCTION goalsSection(prdText) -> string | null
  # sectionBody(prdText, GOALS_HEADING_RE) — the SAME shared fence-aware scanner
  # nonGoalsSection uses; stops at the next equal-or-higher heading (i.e. at "## Non-goals").

# placeholderOnly() is reused unchanged: a goals body trimming to "" or "_TODO._" is treated as absent
# (the prd.js template seeds "## Goals & success metrics" with "_TODO._").
```

**`assemble(root, container)` — the extended shape.** One extra extraction from the PRD text already read, one extra term in the emptiness test.

```
RECORD Goals:
  container: string        # the resolved container
  source_path: string      # path.relative(root, prdPath) — same as nonGoals
  body: string             # the raw "## Goals & success metrics" body, verbatim

# assemble() reads the PRD file ONCE (as today) and extracts BOTH sections from that text:
#   goals    = goalsSection(text),    kept only when not placeholderOnly
#   nonGoals = nonGoalsSection(text), kept only when not placeholderOnly   # unchanged
# exit-3 (nothing ratified) now also requires goals == null:
#   IF nonGoals == null AND goals == null AND precedents == [] AND tradeoffs == []  -> exit 3
```

**`render(goals, nonGoals, precedents, tradeoffs)` — signature gains `goals` as the first parameter.** The goals subsection is emitted first among the PRD-sourced subsections (positive frame before exclusions), before non-goals, before precedents, before tradeoffs. The arity change touches the three existing `render()` callers: `assemble()` and the two `render(...)` calls inside `ratifiedScopeSelftest()`; update all three.

```
### Ratified goals: PRD `<container>` (<source_path>)

<goals.body trimmed>
```

**`validate(text)` — accept the new subsection.** Add `hasGoals = lines.some(l => /^### Ratified goals: PRD /.test(l))` and include it in the "at least one subsection" disjunction, so a goals-only block is well-formed and a goals-bearing block still validates.

**Design decisions.**

- **Goals live in the SAME `## Ratified scope` block, delivered by the SAME file.** No new file, flag, or transport; the occupant appends the one block to all four lenses byte-identically, and it rides the shared-prefix cache exactly as today. **Chosen:** one block, one file, one transport — mirror the non-goals path end to end.
- **Goals subsection ordering: goals first, then non-goals, then precedents, then tradeoffs.** Nothing downstream depends on subsection order (`validate` checks presence, not order; the block is generated fresh per round to an ephemeral scratch file, never a committed artifact), so ordering is a readability call. **Chosen:** goals first — "what we are building" reads before "what we are deliberately not building".
- **Source is the PRD `## Goals & success metrics`, read directly by container, with no PRDR coupling.** **Chosen:** read the PRD file `ratified-scope` already resolves; PRDR nearness is out of scope (see OUT OF SCOPE).
- **Scope is the `faffter-dark-spec-review` occupant, not `faffter-noon-spec-review` — an occupant boundary, not a level gate.** **Chosen:** alter the dark occupant only. The deferral clause lives in the dark occupant's lens prose and fires whenever that occupant runs, at ANY autonomy level (L1–L4) — it is never conditioned on L4. `faffter-noon-spec-review` is untouched (it has no ratified plumbing); wiring it is a separate follow-up. Confirmed with the operator: alter dark, leave noon.

## 4. HOW — Behavior

**Architecture and approach.** Three touch-points, in dependency order.

1. **`ratified-scope.js`** gains the goals reader, extraction, render subsection, and validate arm above. This is the only executable change.
2. **The three design-lens briefs** (`refute-architectural.md`, `refute-infosec.md`, `refute-qa.md`) and the occupant `SKILL.md` gain a "Defer to ratified goal" clause beside the existing "Defer to ratified scope" clause. `refute-methodology.md` gains nothing (it receives the block only to keep the shared-cache prefix byte-identical, and never acts on it).
3. **The eval kit** copies the three changed lens briefs verbatim into `eval/review-bench/lenses/`, regenerates the request payloads, and adds two fixtures.

**No change to `faff-prep` or the occupant transport.** faff-prep already runs `faff ratified-scope --assemble [--container c]` at the start of every round and writes the block to `$scratch/ratified-scope.md`; the goals subsection appears inside that same block automatically once `assemble()` emits it. The occupant already appends that one file to all four lenses' `--context`. Neither the per-round assembly step nor the fan-out delivery needs a line changed. This is one fewer touched file than FAFF-907, which had to add the assembly step itself.

**The deferral decision the refuter makes (design lenses only).**

```
PROCEDURE weigh_objection(objection, ratified_scope_block):
  1. IF objection.severity == critical:
       raise it as a gating objection   # never deferred, by any clause
  2. ELSE IF objection only restates a listed non-goal or a settled-precedent/tradeoff scope:
       record as observation citing the settling line   # FAFF-907, unchanged
  3. ELSE IF objection contests a listed RATIFIED GOAL *as a goal*
            (objects to the product decision itself, not to how it is built):
       record as observation citing the goal line        # NEW (FAFF-936)
  4. ELSE:
       raise it normally   # includes an IMPLEMENTATION objection against a ratified goal
```

**The lens clause (design lenses: architectural, infosec, QA).** Add this beside the existing "Defer to ratified scope" paragraph in each of the three design briefs. The core rule is identical across the three; only the closing example is tuned to the lens (mirroring how FAFF-907 tuned each lens's "critical is never deferred" sentence). The exact text a build agent writes into each file:

Architectural (`refute-architectural.md`):

```
**Defer to ratified goal.** The `## Ratified scope` block may also carry a `### Ratified
goals` subsection (the PRD's ratified `## Goals & success metrics`). An objection that
contests a listed ratified goal *as a goal* — objecting to the product decision itself,
not to how it is built — is already settled: record it as an `observation` citing the
goal line, not a gating objection. The *implementation* of that goal is still critiqued
at full severity: an over-built, tightly-coupled, or unsound way of delivering the goal
is raised normally. A `critical` is never deferred by this clause.
```

Infosec (`refute-infosec.md`) — same first three sentences, closing example tuned:

```
... The *implementation* of that goal is still critiqued at full severity: an injectable
input, a logged secret, or a fail-open path in how the goal is delivered is raised
normally, even when the goal itself is public/unauthenticated by design. A `critical` is
never deferred by this clause.
```

QA (`refute-qa.md`) — same first three sentences, closing example tuned:

```
... The *implementation* of that goal is still critiqued at full severity: a goal with no
born-verifiable scenario, or a DONE item that cannot be decided, is raised normally. A
`critical` is never deferred by this clause.
```

**Anti-pattern:** writing a fourth clause into `refute-methodology.md`. Why: the methodology lens receives the block only for cache-prefix parity and must not act on ratified scope or goals; giving it a deferral clause breaks the FAFF-907 invariant.

**Anti-pattern:** deferring an objection because it *mentions* a ratified goal. Why: deferral is only for an objection whose entire gating content is the goal-as-goal. The instant the objection names a defect in delivering the goal, it is an implementation objection and is raised at full severity.

**The occupant `SKILL.md` section update.** Extend the existing "Defer to ratified scope — a settled non-goal is not a defect" paragraph (the one naming the design lenses and the critical carve-out) with the parallel goal rule: the block may also carry a `### Ratified goals` subsection; a design lens defers a goal-as-goal objection as a cited observation, critiques the goal's *implementation* at full severity, never defers a `critical`, and the methodology lens still receives-but-ignores the whole block. Keep it to the same register and length as the existing sentence; do not restate the whole mechanism.

**Failure modes.**

- **The failure:** the goals regex matches `## Non-goals` and folds exclusions into the goals subsection, or the non-goals regex starts matching goals. **How you'd know:** the `ratified-scope.js` selftest and `ratified-scope.test.mjs` assertions for a PRD carrying both sections would show goals body text under the non-goals subsection or vice-versa. **What it means:** proceed only with the `\b`-anchored `GOALS_HEADING_RE` verified against both headings (already confirmed: goals=true/non=false for `## Goals & success metrics`, goals=false/non=true for `## Non-goals`).
- **The failure:** the deferral over-fires and silences a genuine implementation defect once any ratified goal is present (a PRD goal launders an exploit past the gate). **How you'd know:** the guard fixture `refutation-spec-016` would grade as a miss (infosec drops out of the objecting set). **What it means:** the clause wording is wrong; narrow "as a goal" until the guard fixture refutes again. This is the single most important thing to get right and is why the guard fixture is mandatory, not optional.
- **The failure:** goals presence flips the exit-3 emptiness result, so a PRD with only goals (no non-goals, no precedents) now assembles a block where it used to exit 3, changing behaviour for existing repos unexpectedly. **How you'd know:** a selftest case with a goals-only PRD asserting exit 0 plus a goals-only-validates assertion. **What it means:** this is the intended new behaviour (a goals-only PRD *should* now produce a block); name it explicitly in tests so it is a decision, not a surprise.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a PRD whose `## Goals & success metrics` has real bullets and whose `## Non-goals` has real bullets
When `faff ratified-scope --assemble --container <c>` runs
Then stdout carries a `### Ratified goals: PRD <c> (<path>)` subsection with the goals body verbatim,
     ahead of the `### Non-goals:` subsection, and the block validates clean
```

```
Given a PRD whose ONLY ratified content is `## Goals & success metrics` (no non-goals, no scoped precedent, no tradeoff)
When `faff ratified-scope --assemble --container <c>` runs
Then it exits 0 (not 3) and emits a goals-only block that `--validate` accepts
```

```
Given a PRD whose `## Goals & success metrics` body is the `_TODO._` placeholder
When assemble runs
Then no `### Ratified goals` subsection is emitted (placeholder is treated as absent, exactly like non-goals)
```

```
Given the link-shortener case: a `## Ratified scope` block whose `### Ratified goals` lists "anyone can resolve a short code without authentication — public redirect is the product"
When the infosec design lens refutes a spec that implements exactly that public redirect and nothing insecure beyond it
Then infosec raises NO blocker or major "shares an open, unauthenticated link" objection (it defers to the goal as a cited observation), and the aggregate verdict is approve
```

```
Given a `### Ratified goals` block listing the public-redirect goal, but a spec that ALSO logs the caller's Authorization token verbatim and unlinks a path taken unvalidated from the request
When the infosec design lens refutes it
Then infosec still raises a critical implementation objection (the deferral clause does not touch it), and the aggregate verdict is reject-approach
```

No scenario is withheld as a holdout: this change ships prompt prose, an assembler function, and eval fixtures, with no running feature surface for a code-blind evaluator to exercise. The guard scenario above is verified by the `refutation-spec-016` eval fixture, not by a withheld env check.

## 6. DESIGN DECISION RATIONALE

**Emit goals in the same block, or a new goals-specific channel?** Options: (a) same `## Ratified scope` block via the same file and `--context` delivery; (b) a second file/flag for goals. (a) reuses the proven non-goals path, the shared-prefix cache, and needs zero faff-prep or transport change; (b) adds surface for no benefit. **Chosen:** (a) — mirror the non-goals path exactly.

**Goals subsection ordering.** Options: goals first, or goals after non-goals. Nothing downstream reads order. **Chosen:** goals first, for readability (inclusions before exclusions).

**One shared clause, or per-lens tuned clauses?** Options: (a) byte-identical clause in all three design lenses; (b) shared core rule with a lens-tuned closing example. Byte-identity is only required between a lens's plugin copy and its eval copy, never across lenses. **Chosen:** (b) — matches FAFF-907's per-lens tuning and makes each lens's implementation-vs-goal example concrete for that lens.

**Does the deferral apply to `critical`?** **Chosen:** no. The `critical`-never-deferred guard is inherited verbatim from FAFF-907; a real exploit, data-loss, or fail-open path is always raised, which is what makes symmetric deferral safe.

**Alter which occupant — dark, or also noon?** Options: (a) the `faffter-dark-spec-review` occupant only; (b) also `faffter-noon-spec-review`. (b) requires porting the entire ratified-scope apparatus into an occupant that has none. **Chosen:** (a). The change fires whenever dark is the configured reviewer, at any autonomy level — occupant, not level, is the boundary; it is never gated to L4. `faffter-noon-spec-review` (no ratified plumbing) is a separate follow-up. Confirmed with the operator.

**Source the goals from the PRD or a PRDR?** **Chosen:** the PRD's `## Goals & success metrics`, read by the container `ratified-scope` already resolves. PRDR nearness is FAFF-535's ordering concern, out of scope.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None. The one scope judgement (alter the `faffter-dark-spec-review` occupant only, ungated by level; leave `faffter-noon-spec-review`) is a Chosen confirmed with the operator, not an unresolved punt.

**Assumptions.**

- **Assumes:** the shared `sectionBody` scanner exported by `admissibility.js` handles the `## Goals & success metrics` heading identically to `## Non-goals` (fence-aware, stops at the next equal-or-higher heading). Validation: the build agent confirms `nonGoalsSection` already calls `sectionBody(prdText, NON_GOALS_HEADING_RE)` and that `goalsSection` will call it with `GOALS_HEADING_RE`; no scanner change is needed, and the goals-and-non-goals selftest case proves the boundary.
- **Assumes:** the PRD template's goals heading is exactly `## Goals & success metrics` (per `prd.js` `prdTemplate()`), and the `GOALS_HEADING_RE` also matches a bare `## Goals`. Validation: confirmed against `prd.js` line 80 and the regex boundary check in this spec.

## 8. DONE — Definition of Done

### From WHY
- [ ] A ratified goal listed in the block no longer reads as an unmitigated defect: the link-shortener defer-and-approve fixture (`refutation-spec-015`) grades to an empty objecting-lens set.

### From WHAT (assembler)
- [ ] `GOALS_HEADING_RE` matches `## Goals & success metrics` and `## Goals`, and does not match `## Non-goals` or `## Goalsomething`.
- [ ] `goalsSection(prdText)` returns the `## Goals & success metrics` body via the shared `sectionBody` scanner, and returns absent for an empty or `_TODO._` body (`placeholderOnly` reused).
- [ ] `render()` emits a `### Ratified goals: PRD <container> (<path>)` subsection with the goals body verbatim, ordered before the non-goals subsection.
- [ ] `validate()` accepts a block whose only subsection is `### Ratified goals: PRD `, and still accepts a block that carries goals alongside other subsections.
- [ ] `assemble()` exit-3 (nothing ratified) now also requires goals absent; a goals-only PRD assembles at exit 0.

### From HOW (lens prose)
- [ ] `refute-architectural.md`, `refute-infosec.md`, `refute-qa.md` each carry a "Defer to ratified goal" clause with the goal-as-goal-defers / implementation-critiqued / critical-never-deferred rule; `refute-methodology.md` carries no such clause.
- [ ] The occupant `SKILL.md` "Defer to ratified scope" section names the `### Ratified goals` subsection and the goal-as-goal-vs-implementation rule, and still states the methodology lens receives-but-ignores the block.
- [ ] `faff-prep/SKILL.md` and the occupant transport are unchanged (goals ride the existing per-round assembly and `--context` delivery).

### From HOW (edge cases / failure modes)
- [ ] The guard fixture `refutation-spec-016` (a ratified goal present, plus a genuine critical implementation defect) still refutes: infosec is in `must_object`.

### From eval + docs
- [ ] `eval/review-bench/lenses/refute-{architectural,infosec,qa}.md` are byte-identical to their plugin sources and `test/review-bench-lens-parity.test.mjs` passes.
- [ ] The `requests/` and `requests-shared-prefix/` payloads for the three design lenses are regenerated (`node eval/review-bench/build-requests.mjs`) and embed the current lens text.
- [ ] `eval/cases/refutation-spec-015.json` (defer-and-approve, `closed_set: []`) and `refutation-spec-016.json` (`lens_bounds.must_object: ["infosec"]`) exist and grade as specified under `eval/grader.mjs`.
- [ ] The `docs/guide/cli.md` `ratified-scope` row mentions the `## Goals & success metrics` source, and `lint-cli-doc` passes.
- [ ] **Mechanical merge-gate:** at least one previously-refuting design lens now defers on `refutation-spec-015` (empty objecting set) AND `refutation-spec-016` still refutes (infosec objects). No baseline re-sweep is required in DONE.

### Eval coverage
- [ ] The change touches the `refutation-spec` judgement seam; the two fixtures above register under the existing `refutation-spec` KIND (already in `eval/grader.mjs` `KINDS`/`CLOSED_SET_KINDS`), so no new grader KIND or seam-registry row is needed. Recording/accepting the baseline is a separate human-supervised step and is not required here.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Write a temp PRD with real "## Goals & success metrics" + "## Non-goals" bodies.
  2. Run `faff ratified-scope --assemble --container <c>` against that temp root.
  3. ASSERT exit 0, stdout contains "### Ratified goals: PRD" ahead of "### Non-goals: PRD",
     and `faff ratified-scope --validate` accepts the emitted block.
  4. Run `node --import ./test/hermetic-env.mjs --test test/ratified-scope.test.mjs test/review-bench-lens-parity.test.mjs`
     and the ratified-scope in-module selftest; all pass.
```

## 9. APPENDICES

None required.

confidence: high