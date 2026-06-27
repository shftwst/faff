# Spec — L4 adversarial per-lens spec refuters (FAFF-267)

> Spec: faffter-dark-nlspec · 2026-06-27 · autonomous · confidence: high. Full spec on Linear FAFF-267.

This is the build spec for FAFF-267, for the build agent and human reviewers. It defines the L4 (lights-out) face of FAFF-9's spec-stage review: a swappable `spec_review` slot occupant that runs each review lens as an **independent adversarial refuter** and aggregates the refutations onto the fixed `spec-review-verdict` contract. It extends — does not replace — FAFF-266's L1–L3 single-pass reviewer, and reuses the existing `faffter-dark-adversarial-review` transport rather than reinventing it.

## 1. WHY — Problem and Principles

**Load-bearing model.** At L4 nobody is in the room to sanity-check a spec before code is written, so spec review must be **adversarial**: instead of one reviewer checking a checklist (which shares the spec author's blind spots), each lens runs as a *separate pass prompted to refute the spec from its angle*, and a verdict is gated on how many lenses refute and how hard. This is the spec-stage analog of the code-stage `faffter-dark-adversarial-review` gate, one altitude up.

**Problem statement.** FAFF-266 ships a single-pass four-lens checklist reviewer that catches the obvious — but a single pass run by one model inherits that model's correlated blind spots, exactly the failure the L4 evaluator lane exists to close. This change runs the four lenses as independent refuters gated on majority/severity, so a bad approach is bounced back to prep before any code exists.

**Design principles.**

- **Lenses are dialect; the verdict is the contract.** What each lens looks at is the reviewer's business; the only fixed surface is the `spec-review-verdict` shape (FAFF-265 / ADR-0025). Per ADR-0025 the severity→verdict *mapping* is deliberately reviewer judgement, not contract — this spec is where that mapping lives.
- **Independence is the mechanism, not a detail.** The value over FAFF-266 is decorrelation. A single prompt that enumerates four lenses re-correlates them through one context; one isolated pass per lens does not. Reject any implementation that collapses the lenses into a single pass to save tokens — that is FAFF-266, not this.
- **Reuse the proven transport.** The independent-model call is `review-call.mjs` (preflight, streaming, token budget, fallback chain, exit-code→outcome). Do not hand-roll an API call and do not fork the helper.
- **A down refuter never silently approves.** Mirroring the code-review gate: a provider outage on a configured/default host surfaces `needs-human`, never a quiet `approve`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown/skill | The exact precedent: a "dark" adversarial occupant of the `review` slot. This is its `spec_review` twin. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (ESM) | Artifact-agnostic independent-model transport reused verbatim as the refuter call. |
| `plugin/skills/faffter-noon-spec-review/SKILL.md` | Markdown/skill | The default `spec_review` occupant (FAFF-266's single-pass checklist) this extends. |
| `plugin/skills/faff/contracts/spec-review-verdict.schema.json` | JSON Schema | The fixed verdict shape every lens aggregates onto (FAFF-265). |
| `docs/adr/0025-distinct-spec-review-slot-fixed-spec-review-verdict-contract.md` | Markdown/ADR | Establishes the slot + contract; states severity→verdict mapping is FAFF-266/267's judgement. |

**Scope statement.** This occupies the existing `spec_review` slot at the spec→build-admission seam (FAFF-266's seam); it is the L4 recipe's chosen occupant, configured by the human, not a new pipeline stage.

## 2. OUT OF SCOPE

- **Learned per-repo infosec threat prior.** v1's infosec refuter uses a generic threat checklist (authz/authn, secrets, blast radius, input surface). A repo-specific learned threat prior is design-register **E** and a future ticket. *Extension point:* the infosec lens's `--system` prompt file + an optional grounding input, swappable later without touching the aggregation.
- **Cost-gated lens selection by change-surface.** *Which* lenses fire for a given issue is **FAFF-268**. This spec consumes an `enabled_lenses` set as input and never decides it. *Extension point:* the `enabled_lenses` parameter resolved upstream by FAFF-268.
- **The single-pass L1–L3 reviewer itself.** The four-lens checklist, the `reject-approach` backward-routing edge to prep, and the seam wiring are **FAFF-266**. This extends them; it does not re-implement them.
- **The PRDR/product-altitude YAGNI gate.** FAFF-256 (Done) owns the product-altitude adversarial review. This is the spec altitude. They share transport only (see §4).
- **Modifying `review-call.mjs`.** The helper is reused as-is. Any need to change it is a separate change with its own review.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Lens | One review angle: `architectural`, `infosec`, `methodology`, `QA`. |
| Refuter | One independent pass of one lens, prompted to *break* the spec from that lens's angle and emit lens-scoped objections. |
| Refutation | A lens's structured objections + per-objection severity from a single refuter pass. |
| Enabled lenses | The subset of lenses that fire for this issue, supplied as input (decided upstream by FAFF-268; defaults to all four). |
| Aggregation | The deterministic rule mapping the set of refutations onto a single `spec-review-verdict`. |

**Type definitions.**

```
ENUM Lens: architectural | infosec | methodology | QA
ENUM Severity: critical | major | minor | observation   # reuses the adversarial-review vocabulary

RECORD Objection:
  lens: Lens
  severity: Severity
  summary: String              # the concrete refutation (what breaks, why it matters)

RECORD Refutation:
  lens: Lens
  outcome: refuted | clear | unavailable   # unavailable = transport failed for this lens
  objections: List<Objection>              # empty iff outcome == clear
  model: String                            # "provider/model" used, for attribution

# Output maps onto the FIXED spec-review-verdict contract (FAFF-265 — unchanged):
RECORD SpecReviewVerdict:
  verdict: approve | revise | reject-approach | needs-human
  objections: List<{ lens, severity }>     # founded-verdict invariant: approve => empty; else >=1
```

The contract's `severity` enum is `blocker | major | minor`. The refuters speak the adversarial vocabulary (`critical | major | minor | observation`); aggregation maps it onto the contract enum: `critical → blocker`, `major → major`, `minor → minor`, and `observation` is advisory and never gates.

**Design decisions** (full rationale in §6; collected markers here):

- **Slot occupancy.** **Chosen:** ship as a distinct "dark" occupant of the **existing** `spec_review` slot (`faffter-dark-spec-review`), the human configures it in the L4 recipe — mirroring `faffter-dark-adversarial-review` ↔ `faffter-noon-review`.
- **Per-lens independence.** **Chosen:** one independent refuter pass per enabled lens (separate `review-call.mjs` invocation each), never a single pass enumerating all lenses.
- **Transport reuse.** **Chosen:** reuse `review-call.mjs` verbatim; supply the spec as the reviewed artifact via `--diff`, repo context via `--context`, and the lens refutation prompt via `--system`.
- **Methodology lens.** **Chosen:** the methodology refuter *consumes* the `methodology` slot's `issue-critique` rather than recomputing value/scope.
- **Aggregation rule.** **Chosen:** the concrete majority/severity composition in §4.
- **Shared-mechanism boundary with FAFF-256.** **Chosen:** the shared machinery is `review-call.mjs` + the "a different model challenges, the loop never self-grades" discipline; artifact, lens count, arbiter, and contract are altitude-specific and not shared.
- **Infosec context (v1).** **Chosen:** generic infosec checklist, no learned prior.
- **Base reviewer.** **Assumes:** FAFF-266's `spec_review` reviewer exists (see §7 Assumptions).

## 4. HOW — Behavior

**Architecture.** The occupant is invoked at the same seam FAFF-266 wires (spec rated → spec-reviewed → admitted). It resolves the enabled-lens set from its input (default all four), runs one refuter per enabled lens through `review-call.mjs`, then aggregates.

```
PROCEDURE spec_review(spec, enabled_lenses, repo_context):
  1. refutations = []
  2. FOR lens IN enabled_lenses:                 # independent passes — order-independent
     a. system  = lens_refutation_prompt(lens)   # the lens's "break this spec" prompt file
        IF lens == methodology:
           system += methodology_signals()        # issue-critique from the methodology slot
     b. exit, out = review_call(
           --system  system,
           --context [gateway, ...spec-named files in repo_context],
           --diff    spec)                         # the spec is the artifact under scrutiny
     c. refutations.append( interpret(lens, exit, out) )
  3. RETURN aggregate(refutations, count(enabled_lenses))
```

**Per-lens transport interpretation** (reuses `review-call.mjs`'s exit-code→outcome table verbatim):

```
PROCEDURE interpret(lens, exit, out):
  - exit 0  -> parse findings; outcome = refuted IF any gating objection else clear
  - exit 5  -> outcome = unavailable, kind = infra-configured     # explicit host down
  - exit 6/2/4/7 -> outcome = unavailable, kind = config-fault    # default-host down / unsupported / not-served / auth
```

**Aggregation — the majority/severity gate** (this is the reviewer judgement ADR-0025 keeps out of the contract):

```
PROCEDURE aggregate(refutations, n_enabled):
  unavailable   = [r for r in refutations if r.outcome == unavailable]
  forcedReject  = (any gating objection is critical) OR (refuted_count >= ceil((n_enabled+1)/2))
  # 1. Transport floor — a down refuter never silently approves:
  IF any r in unavailable has kind == config-fault:
     RETURN needs-human, objections = gating ++ name(config-fault lenses)   # human must fix
  IF count(unavailable) > 0 AND NOT forcedReject:
     RETURN needs-human, objections = gating ++ name(unavailable lenses)    # cannot vote with a missing lens
  # 2. Severity gate:
  IF any gating objection.severity == critical:
     RETURN reject-approach, gating
  # 3. Majority gate (strict majority of ENABLED lenses refuted):
  IF refuted_count >= ceil((n_enabled + 1) / 2):
     RETURN reject-approach, gating
  # 4. Minority, non-critical -> fixable in place:
  IF refuted_count > 0:
     RETURN revise, gating
  # 5. Clean:
  RETURN approve, []
```

A lens "refuted" means it returned at least one **gating** objection (critical/major/minor); an observation-only or empty pass is "clear". For `needs-human` from the transport floor the objections name the missing lens(es) at `blocker` severity, so the founded-verdict invariant always holds.

**Output.** Emit exactly one `faff-contract:spec-review-verdict` fenced block (the consumer locates it, `JSON.parse`s it, pipes it to `faff contract spec-review-verdict`). Founded-verdict invariant holds by construction.

**Shared-mechanism boundary with FAFF-256.**

| | FAFF-256 (Done, product altitude) | FAFF-267 (this, spec altitude) |
|---|---|---|
| **Shared** | `review-call.mjs` transport + "a different model challenges; the loop never self-grades" | same transport, same discipline |
| Artifact reviewed | a loop-authored PRDR | a spec |
| Challenger shape | one Phase-2 skeptic challenging a `yagni-judge` proposal | one refuter per enabled lens |
| Arbiter | `faff prdr yagni` | the `aggregate()` majority/severity rule above |
| Contract emitted | `prdr-yagni` | `spec-review-verdict` |

Both occupants consume the same `review-call.mjs`; neither forks it. Everything above the transport is altitude-specific.

**Failure modes.**

- **The failure:** per-lens passes share the same backend model, re-correlating blind spots. **Mitigation:** configure the refuter backend to a model structurally different from the spec author's; proceed.
- **The failure:** `review-call.mjs` carries diff-specific framing that biases a model reading a spec-as-`--diff`. **Mitigation:** the helper is artifact-agnostic; if framing bias appears, the narrow fix is a thin additive flag in a separate change — do not fork it. A watch-item, not a blocker.
- **The failure:** majority math is wrong for a 1- or 2-lens enabled set. **Mitigation:** the `ceil((n+1)/2)` rule is exercised by tests for n in {1,2,3,4}.

**Anti-pattern:** collapsing the four lenses into one `review-call.mjs` pass to save tokens — that re-correlates the blind spots and reduces this to FAFF-266.

**Anti-pattern:** treating a provider outage as `approve` — it silently disables the L4 gate.

## 5. SCENARIOS

```
Given an enabled-lens set of all four lenses and a spec
When two lenses return clear and two return refuted with max severity major (no critical)
Then the verdict is revise (2 refuted < strict majority of 4 = 3); a third refuting lens flips it to reject-approach
```

```
Given any enabled lens returns an objection with severity critical
When aggregation runs
Then the verdict is reject-approach regardless of how many other lenses are clear
```

```
Given the infosec refuter's backend is unreachable on a default (unset) host (review-call.mjs exit 6)
  and the remaining clear lenses do not by themselves force reject-approach
When aggregation runs
Then the verdict is needs-human (a down lens never silently approves), naming the missing lens
```

```
Given all enabled lenses return clear
When aggregation runs
Then the verdict is approve with objections: []  (founded-verdict invariant)
```

Non-functional assertions:
- Each enabled lens is a *separate* `review-call.mjs` invocation (independence is observable as N process calls for N enabled lenses).
- The emitted block validates against `faff contract spec-review-verdict` (exit 0) for every produced verdict.
- `review-call.mjs` is consumed unmodified (no diff to the helper file in this change).

## 6. DESIGN DECISION RATIONALE

**A new slot, a flag, or a new dark occupant of the existing slot?** **Chosen:** a distinct dark occupant of the existing slot — exact `faffter-dark-adversarial-review` ↔ `faffter-noon-review` precedent; the human selects it in the L4 recipe, zero new registration beyond a skill.

**One pass or one-per-lens?** **Chosen:** one independent refuter per enabled lens — decorrelation is the only thing this buys over FAFF-266, so it is non-negotiable.

**Reuse vs reinvent the transport.** **Chosen:** reuse `review-call.mjs` — it already solves preflight, streaming, token budget, the fallback chain, and the exit-code→outcome discipline (incl. down→needs-human). The spec is passed as the `--diff` artifact; repo files as `--context`.

**The composition threshold.** **Chosen:** `critical` is a hard veto (any one → `reject-approach`); a strict majority of enabled lenses refuting → `reject-approach`; a non-critical minority → `revise`; clean → `approve`; an unresolvable transport failure that could swing the vote → `needs-human`. FAFF-268 may later weight lenses by change-surface, which only changes *which* lenses are enabled, not this rule.

**Shared boundary with FAFF-256.** **Chosen:** share the transport + non-self-grading discipline only.

**Infosec threat context.** **Chosen:** generic checklist for v1; the learned per-repo prior (register E) is a clean future extension.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking.

**Assumptions:**

- **Assumes:** FAFF-266's `spec_review` reviewer exists. FAFF-267 extends its lens prompts into independent refuters and its aggregation into the majority/severity gate. The build is **serialised after FAFF-266**.
- **Assumes:** an independent adversarial backend is configured for the refuter (`faffter_dark.adversarial` or a spec-review-specific block), structurally different from the spec author's model. Absent/default-host → the gate surfaces `needs-human` by design, never silent approve.

## 8. DONE — Definition of Done

### From WHY
- [ ] A spec passing through the L4 `spec_review` occupant receives a contract-valid `spec-review-verdict` aggregated from independent per-lens refutations.

### From WHAT (types and interfaces)
- [ ] Each enabled lens runs as a separate refuter pass producing `{lens, outcome, objections[], model}`.
- [ ] The emitted `faff-contract:spec-review-verdict` block validates against `faff contract spec-review-verdict` (exit 0) for `approve`/`revise`/`reject-approach`/`needs-human`.
- [ ] The founded-verdict invariant holds: `approve` ⇒ `objections: []`; any other verdict ⇒ ≥1 objection.

### From HOW (behaviour)
- [ ] One `review-call.mjs` invocation per enabled lens, each with a lens-specific `--system` refutation prompt and the spec as `--diff`.
- [ ] The methodology lens consumes the methodology slot's `issue-critique`/map/tidy signals; it does not recompute value/scope.
- [ ] Aggregation implements: any `critical` → `reject-approach`; strict majority refuted (`ceil((n_enabled+1)/2)`) → `reject-approach`; non-critical minority → `revise`; all clear → `approve`.
- [ ] A refuter transport failure (review-call.mjs exit 2/4/6/7, or exit 5 that could swing the vote) → `needs-human`, never silent `approve`.
- [ ] The occupant shares `review-call.mjs` with FAFF-256 and does **not** fork it (no diff to the helper).

### From HOW (edge cases)
- [ ] Majority math is correct for enabled-lens counts of 1, 2, 3, and 4 (tested).
- [ ] A `config-fault` unavailable lens forces `needs-human` even when other lenses are clear.

### Integration smoke test
```
Configure the dark spec_review occupant + an independent adversarial backend.
Feed a deliberately weak spec through the seam.
Expect: N refuter calls for N enabled lenses, a reject-approach verdict citing the objecting lens,
        a contract-valid emitted block, and the work routed back to prep (FAFF-266's backward edge).
```

confidence: high
