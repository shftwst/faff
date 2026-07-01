# L4 dial-coherence preflight — refuse reckless unattended level+slots+gates combinations

> Spec: faffter-dark-nlspec · 2026-07-01 · interactive · confidence: high. Full spec on Linear FAFF-298.

This spec addresses **FAFF-298**. The audience is the build agent extending the bundled `faff` CLI, plus human reviewers of the L4 launch gate. It specifies a new dial-coherence assertion folded into the shipped `faff lights-out` preflight: a launch-time refusal of dial *combinations* that are individually fine but jointly reckless for an unattended (L4) run.

## 1. WHY — Problem and Principles

**The load-bearing model.** The lights-out runner already refuses on *individually*-unsafe launch conditions — a bare (un-contained) host, no budget ceiling, an unreachable guardrail or slot. What it does **not** yet check is whether the *combination* of dials — the slot occupants and the engineering-gate fallback — is coherent **as a set**. Each dial can be valid in isolation while the tuple is a foot-gun (the classic example: an L4 run wired to a non-adversarial reviewer, which silently removes the second-opinion machinery the level's trust model is built on). This spec adds a pure coherence pass over the already-assembled dial profile, run inside the preflight, that refuses such tuples with a named reason before any work is admitted.

**Problem statement.** Today an operator can launch an unattended run whose dials are each separately accepted but jointly unsafe — e.g. an L4 run wired to the *non-adversarial* review default, which silently removes the second-opinion machinery that L4's trust model is built on. The pain is a run that *looks* armed (the banner shows reachable slots) while a keystone of the level's safety is absent. This change adjudicates the dial tuple at launch and fail-closed-refuses incoherent ones.

**Appetite is out of scope for this pass.** Appetite is **not** a coherence dimension at L4: a sibling ticket makes L4 force `appetite: full` (appetite becomes level-scoped), so there is nothing for this preflight to ceiling — this pass never inspects appetite at all. See §7 → *Resolved decisions*.

**Design principles.**

**Fail-closed on ambiguity.** An unrecognised or unclassifiable dial combination refuses, never proceeds. This mirrors the runner's existing posture: absence or ambiguity at the boundary is a refusal, not a silent pass. An unknown slot occupant where the rule needs to know "is this adversarial?", or any tuple the rule set can't confidently classify as coherent → refuse.

**Composition, not re-implementation.** The coherence pass reads the dial profile the wrapper already assembles and returns refusals in the existing `{gate, detail}` shape. It folds into the existing refusals array so the banner, the persisted run-ledger, and the process exit code already carry the named refusal with no new plumbing. It re-implements none of the basic preflight's reachability/presence probes — by the time it runs, those have already passed, so its sole job is the *joint* incoherence the individual checks structurally cannot see.

**Only catch what the basic checks miss.** The basic preflight already guarantees, at the point this pass runs: the review slot reachable, the spec_review slot configured and reachable, a budget ceiling set, all guardrail contracts live, the host contained, and the floor assertions holding. The coherence pass must add *only* joint-incoherence value; duplicating a single-dial reachability check here would be redundant and is out of scope.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `lightsOutPreflight(probes)` | Node (JS) | The pure preflight core this extends; returns `{proceed, refusals, armed, banner, floor}` |
| `plugin/skills/faff/bin/faff` → `cmdLightsOut(args)` | Node (JS) | The thin wrapper that already assembles `dial_profile = {slots:{review, spec_review}, gates}` and records it in the ledger but never adjudicates it |
| `plugin/skills/faff/bin/faff` → `lightsOutSelftest()` | Node (JS) | The in-memory fixture table this extends with reckless/coherent cases |
| `docs/guide/cli.md` (the `lights-out` row) | Markdown | The doc-coverage row whose description text must be refreshed to mention dial-coherence |

**Scope statement.** This is a launch-time gate inside the L4 runner's preflight — it sits between the basic single-dial preconditions and the mint-the-ledger step, and gates whether an unattended run starts at all.

## 2. OUT OF SCOPE

- **Appetite ceilings under L4.** — appetite is level-scoped — FAFF-308 forces `appetite: full` at L4, so there is no appetite range for this pass to ceiling and this pass never reads appetite. Extension point: FAFF-308.
- **The FAFF-18 level-recipe schema itself.** — the named-vetted-recipe feature is a separate, unbuilt concern. Extension point: this spec leaves a forward-compatible seam (a `recipe`-vetted short-circuit) so when the recipe schema lands, a vetted recipe is recognised as coherent without re-deriving the rule set here.
- **Runtime / mid-run dial enforcement.** — this is a *launch-time* preflight assertion.
- **Per-surface / per-issue dial variation.** — slots are global-per-project at launch.
- **The other bin/faff changes in this run (FAFF-299 / FAFF-300).** — independent concerns.
- **Widening the basic preflight's single-dial checks.** — already gated.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Type definitions.**

```
RECORD DialProfile:
  level: Enum { L4 }
  slots: RECORD:
    review: String | null
    spec_review: String | null
  gates_fallback: String         # gates.fallback config: advisory|fail-closed (or unrecognised)
  recipe: String | null          # the named vetted recipe, when present; else null

RECORD CoherenceRefusal:
  gate: String                   # stable id, e.g. "dial-coherence:adversarial-review"
  detail: String                 # human-readable named reason carried into the banner/ledger
```

**The classification helper.**

```
SET ADVERSARIAL_REVIEW_OCCUPANTS = { "faffter-dark-adversarial-review" }
SET ADVERSARIAL_SPEC_REVIEW_OCCUPANTS = { "faffter-dark-spec-review" }

FUNCTION isAdversarial(occupant, kindSet) -> Bool:
  RETURN occupant != null AND kindSet.contains(occupant)
```

**Chosen (where the check lives):** in the runner's preflight — add a pure `dialCoherence(dialProfile)` returning `CoherenceRefusal[]`, called from `lightsOutPreflight`, its refusals concatenated into the existing refusals array.

**Chosen (rule set):** standalone hardcoded fail-closed rule set now, with a forward-compatible `recipe`-vetted short-circuit seam. A non-null vetted `recipe` is treated as coherent-by-construction; absent a recipe, the standalone rules adjudicate.

## 4. HOW — Behavior

```
PROCEDURE dialCoherence(dial):
  1. IF dial.recipe is a non-null vetted recipe:
     a. RETURN []        # vetted-by-construction short-circuit (forward-compat seam)
  2. refusals := []
  3. # Rule (A) — L4 requires adversarial review machinery.
     IF NOT isAdversarial(dial.slots.review, ADVERSARIAL_REVIEW_OCCUPANTS):
       refusals.add({ gate: "dial-coherence:adversarial-review", detail: ... })
     IF NOT isAdversarial(dial.slots.spec_review, ADVERSARIAL_SPEC_REVIEW_OCCUPANTS):
       refusals.add({ gate: "dial-coherence:adversarial-spec-review", detail: ... })
  4. # Rule (B) — engineering gate ladder must fail closed under lights-out.
     IF dial.gates_fallback != "fail-closed":
       refusals.add({ gate: "dial-coherence:gates-fallback", detail: ... })
  5. RETURN refusals
```

**Edge cases.**

- **Null / missing occupant name.** `isAdversarial(null, …)` returns false → refuses.
- **Unknown occupant name.** Refuses fail-closed (deliberate false-positive cost, named so self-correcting).
- **Unrecognised `gates.fallback` value.** Treated as not-`fail-closed` → refuses.
- **Recipe present but not in the vetted set.** Falls through to the standalone rules — no auto-pass.

## 5. SCENARIOS — born-verifiable main objectives

```
Given an L4 lights-out launch whose review slot is the non-adversarial default and every basic precondition passes
When the preflight runs
Then it refuses with gate "dial-coherence:adversarial-review" and the banner/ledger records that named reason
```

```
Given an L4 lights-out launch with gates.fallback = "advisory" and every basic precondition passes
When the preflight runs
Then it refuses with gate "dial-coherence:gates-fallback"
```

```
Given an L4 lights-out launch with adversarial review + adversarial spec_review + gates.fallback = "fail-closed"
When the preflight runs
Then dialCoherence returns no refusals and (basic preconditions also met) the run proceeds and mints the ledger
```

```
Given a launch carrying a vetted recipe name
When dialCoherence runs
Then it short-circuits to no refusals (vetted-by-construction)
```

Assertion (non-functional): every coherence refusal carries a `gate` id prefixed `dial-coherence:` and a non-empty `detail`.

## 7. RESOLVED DECISIONS, OPEN QUESTIONS, AND ASSUMPTIONS

**Resolved decisions.**

- **Appetite is out of scope for the coherence pass.** L4 forces `appetite: full` (appetite is level-scoped), handled by **FAFF-308**. `DialProfile` carries no `appetite` field. This narrows FAFF-298 to Rules (A) and (B) plus the vetted-`recipe` short-circuit.

**Open Questions (non-blocking future work).**

- **Punt:** broader reckless-combination rule membership beyond (A)/(B).
- **Punt:** capability-vs-name allowlist (occupant self-declares adversariality) vs the name allowlist shipped here.

## 8. DONE — Definition of Done

- [ ] A reckless dial *combination* is refused at preflight with a named `dial-coherence:*` reason.
- [ ] The coherence pass adds only joint-incoherence checks.
- [ ] A pure `dialCoherence(dialProfile)` exists returning `CoherenceRefusal[]` (`{gate, detail}`), with no I/O.
- [ ] An `isAdversarial(occupant, kindSet)` classifier returns false for null/unknown occupants.
- [ ] `dialCoherence` refusals are concatenated into `lightsOutPreflight`'s existing refusals array.
- [ ] Rule (A): a non-adversarial `review`/`spec_review` occupant refuses with `dial-coherence:adversarial-review` / `dial-coherence:adversarial-spec-review`.
- [ ] Rule (B): `gates.fallback != "fail-closed"` refuses with `dial-coherence:gates-fallback`.
- [ ] A non-null vetted `recipe` short-circuits to no refusals.
- [ ] A null/unknown occupant refuses fail-closed; an unrecognised `gates.fallback` refuses fail-closed; a non-vetted `recipe` falls through.
- [ ] Each coherence refusal's named reason appears in the rendered banner and the persisted run-ledger.
- [ ] `docs/guide/cli.md`'s `lights-out` row description is refreshed to mention dial-coherence.
- [ ] `lights-out --selftest` fixtures cover: each reckless rule refuses with its named gate; a coherent tuple proceeds; a vetted recipe short-circuits.

confidence: high
spec-review: approve
