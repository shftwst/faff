# SPEC — FAFF-27: Generative architecture & infra proposal

> Spec: faffter-dark-nlspec · 2026-06-28 · interactive · confidence: medium · spec-review: approve

> **Preamble.** FAFF-27 builds the *generative/proposer* half of faff's architecture story. FAFF-16 only **records** ADRs; FAFF-9 (shipped, 265–268) is the spec-stage **critic**. FAFF-27 is the **proposer**: given a brief/spec + the team's infra profile, it proposes a best-fit, production-grade, scalable architecture + infra, reasoned (ADR-producing). It emits a fixed **proposal envelope** (chosen architecture + rationale + ADR candidates + assumptions); the proposing *strategy* is the swappable producer behind a new `architecture` slot. v1 scope: **propose + human-review (L3)** — the machine proposes concrete, born-verifiable decisions; "is this production-grade?" stays a human gate. Autonomous proposal-quality judgement is a named L4 punt.

## 1 · WHY

faff has a hole in its architecture pipeline:

| Stage | Skill / slot | Role | Status |
|---|---|---|---|
| **Propose** architecture | *(none yet)* | generative — reads infra, proposes a best-fit design | **FAFF-27 — this spec** |
| **Critique** a chosen architecture | `faffter-noon-spec-review` `architectural` lens | adversarial — reviews the spec's design | Shipped (FAFF-9) |
| **Record** the decision | `adr` slot (`faffter-noon-adr`) + `faff adr new` | authors the Nygard body once Chosen | Shipped (FAFF-16/196) |
| **Acquire** the infra profile | `profile` slot (`faff profile mine`) | mines the repo for infra evidence | Shipped (FAFF-26/231) |

The proposer is the missing first box. Without it, a slice's architecture is whatever the spec author free-handed; the critic and the human have nothing *generated from the team's actual infra* to weigh. FAFF-27 turns the shipped infra profile into a reasoned proposal that lands in a spec, where FAFF-9's critic and the human then judge it.

**Why a slot.** The proposer's *strategy* (cost-first? cloud-native? boring-tech-first?) is exactly what faff keeps swappable. Mirrors the proven FAFF-265 contract+slot+producer triad 1:1, inheriting its CI lint surface.

**Why build-biased.** Local-first tenet. A "buy" answer is a *procurement* decision (FAFF-28's epic), not a buildable architecture — so it's routed out, never actioned here.

## 2 · OUT OF SCOPE

- **Recording ADRs** — proposer emits *candidates as intent*; graft Step 4b materialises. No `faff adr new` call here.
- **Critiquing the proposal** — FAFF-9's shipped `architectural` lens does that, downstream.
- **Building the architecture** — the build stage acts; the proposer only proposes.
- **Actioning a buy/hybrid recommendation** — routed to FAFF-28 (unbuilt → v1 surfaces for a human).
- **Autonomous proposal-quality judgement** — explicit L4 Punt; v1 is propose + human-review.
- **Acquiring / extending the infra profile** — consume FAFF-26 schema as-is via `faff profile show`.

## 3 · WHAT

### 3.2 The proposal-envelope RECORD (fixed contract `architecture-proposal`)

```
RECORD ArchitectureProposal:
  chosen_architecture : string        # concise name/shape of the proposed design
  rationale           : string        # WHY this fits the infra profile + brief
  adr_candidates      : ADRCandidate[]# decisions worth promoting to ADRs (may be empty)
  assumptions         : string[]      # born-verifiable assumptions/constraints
  recommendation      : "build" | "buy" | "hybrid"   # build-biased; buy/hybrid routes out
  violations          : string[]      # contract convention (empty = conformant)

RECORD ADRCandidate: { title: string, decision: string, rationale: string }
```

Contract exits: `0` pass · `1` violations (empty `chosen_architecture`, bad `recommendation`, malformed item) · `2` fail-loud (non-object).

### 3.3 Registration surface (mirror FAFF-265, file-for-file)

1. `plugin/skills/faff/contracts/architecture-proposal.schema.json` (new)
2. `bin/faff` `CONTRACTS` registry + `contractArchitectureProposal` compute fn + inline fixtures
3. `bin/faff` `DEFAULTS["slots.architecture"] = "faffter-noon-architecture"`
4. `bin/faff` `config resolved` SLOTS + `expected` selftest list (add `architecture`)
5. `bin/faff` `SLOT_TYPES.architecture = producer-architecture`
6. `bin/faff` `REGISTRY["faffter-noon-architecture"] = producer-architecture`
7. `bin/faff` `checksFor` case `producer-architecture` → asserts the `faff-contract:architecture-proposal` block
8. `plugin/skills/faffter-noon-architecture/SKILL.md` (new default producer, `user-invocable:false`)
9. `plugin/skills/faff/SKILL.md` slot-table row
10. `.faffrc.example.yaml` slot example + `test/golden/contracts/cases.json` cases
11. `.github/workflows/validate.yml` `faff contract architecture-proposal --selftest` step
12. `docs/cli.md` slot + contract docs

## 4 · HOW

### 4.1 Proposer procedure

```
PROCEDURE faffter-noon-architecture(brief_or_spec):
  profile := run("faff profile show --json")        # exit 3 ⇒ no profile → record assumption, proceed; NEVER `mine`
  chosen, rationale := derive_architecture(brief_or_spec, profile)   # fit to runtimes/ci/deploy_targets/paas_available/prefs
  recommendation := "build"                          # build-biased default; "buy"/"hybrid" if best fit not locally buildable
  adr_candidates := decisions_worth_an_ADR(chosen, rationale)
  assumptions    += born_verifiable_constraints(chosen, profile)
  emit `faff-contract:architecture-proposal` = ArchitectureProposal{…}
  emit `## ADR promotion intent` (one entry per candidate)
  # proposes only — writes nothing under records/adr/, makes NO `faff adr new` call
```

### 4.2 Proposer/critic seam

```
FAFF-27 proposer ──emits──▶ proposal envelope ──lands in──▶ a spec
                                                              └─▶ FAFF-9 architectural lens reviews THAT spec
```
No logic overlap — proposer *generates*, critic *judges*; they meet only through the spec artifact.

### 4.5 Failure modes

| Failure | Behaviour |
|---|---|
| No infra profile (exit 3) | record assumption, propose against brief only; never `mine` |
| Malformed envelope | contract exit 2 → consumer never reads "pass" |
| Field violation | exit 1 → surfaced, not silently passed |
| Buy/hybrid, FAFF-28 unbuilt | surface for human; never auto-action |
| **"Is this production-grade?"** | **NOT machine-judged in v1.** Per FAFF-263/ADR-0029, prose-quality stays human/needs-human; the proposing analog is unmeasured. v1 emits concrete born-verifiable decisions; the quality verdict is the human gate. Autonomous judgement = L4 Punt. |

## 5 · SCENARIOS (born-verifiable)

1. *Given* an infra profile + brief, *When* the proposer runs, *Then* it emits a `faff-contract:architecture-proposal` block that `faff contract architecture-proposal` accepts (exit 0).
2. *Given* a best-fit third-party product, *When* `recommendation:"buy"`, *Then* the envelope passes **and** the buy is surfaced for a human / FAFF-28 — no procurement action, no ADR write.
3. (assertion) Any proposer run makes **no `faff adr new`** call and writes nothing under `records/adr/`; candidates appear only as `## ADR promotion intent`.
4. *Given* empty `chosen_architecture` (or `recommendation:"rent"`), *Then* contract exit 1 with the field in `violations`.
5. *Given* a non-object input, *Then* contract exit 2.
6. *Given* `faff profile show` exit 3, *Then* the proposer emits a valid envelope with an explicit "no infra profile" assumption and no `faff profile mine` call.
7. *Given* unset `slots.architecture`, *Then* `faff config get slots.architecture` → `faffter-noon-architecture`; `config resolved` lists it as `producer-architecture`.
8. (assertion) `faff validate-adapters` passes `faffter-noon-architecture` on the `producer-architecture` check.
9. (assertion) `faff contract architecture-proposal --selftest` green; `validate.yml` step green.
10. (assertion) No review/verdict logic added; only proposer↔critic contact is the spec artifact.

## 6 · DESIGN DECISION RATIONALE

- **Chosen** — new `architecture` slot + `architecture-proposal` contract + `faffter-noon-architecture` producer (mirror FAFF-265 triad).
- **Chosen** — envelope shape `{chosen_architecture, rationale, adr_candidates[], assumptions[], recommendation}`.
- **Chosen** — consume infra via `faff profile show` (shipped read path).
- **Chosen** — ADR candidates as `## ADR promotion intent` (deferred materialisation; no direct `faff adr new`).
- **Chosen** — proposer/critic split; no shared logic.
- **Chosen** — proposes-not-commits (envelope + intent only; actioning is graft's, building is the build stage's).
- **Chosen (scope)** — v1 = propose + human-review (L3).
- **Punt** — autonomous proposal-quality judgement → L4 (possibly a FAFF-263-style proposer-quality spike). Non-blocking for v1.
- **Assumes** — FAFF-28 procurement gate (unbuilt); v1 surfaces buy/hybrid for a human.
- **Assumes** — FAFF-26 infra-profile field set is adequate input (FAFF-26 deferred exact consumed fields; validate before build).

## 7 · OPEN QUESTIONS + ASSUMPTIONS

**Open / Punt**
- (Punt, L4) How is "production-grade / scalable" judged *without a human*? Out of v1; deferred to L4, likely a dedicated proposer-quality spike. **Main confidence driver.**
- (Open) Exact `recommendation`-routing handshake with FAFF-28 once it lands (v1 just surfaces).

**Assumptions to validate before build**
- FAFF-28 unbuilt → v1 surfaces buy/hybrid; no auto-routing.
- FAFF-26 infra-profile field set sufficient for proposal input — confirm coverage at build start; raise rather than extend schema in this slice.

## 8 · DONE (mirrors body 1:1, testable)

- [ ] `contracts/architecture-proposal.schema.json` exists, shaping §3.2.
- [ ] `architecture-proposal` registered in `CONTRACTS` + compute + fixtures; `faff contract architecture-proposal` → 0/1/2. *(Sc 1,4,5)*
- [ ] `slots.architecture` default `faffter-noon-architecture`; in `config resolved` + `expected`. *(Sc 7)*
- [ ] `SLOT_TYPES`/`REGISTRY`/`checksFor` `producer-architecture` wired. *(Sc 8)*
- [ ] `faffter-noon-architecture/SKILL.md` (user-invocable:false) emits the contract block + `## ADR promotion intent` + confidence; passes `validate-adapters`. *(Sc 3,8)*
- [ ] Consumes infra via `faff profile show`; handles exit 3 with assumption, no `mine`. *(Sc 6)*
- [ ] Makes **no `faff adr new`** call; writes nothing under `records/adr/`. *(Sc 3)*
- [ ] `recommendation ∈ {build,buy,hybrid}`; buy/hybrid surfaced, not actioned. *(Sc 2)*
- [ ] Gateway slot row + `.faffrc.example.yaml` + `docs/cli.md` updated.
- [ ] `validate.yml` selftest step (green) + `cases.json` cases. *(Sc 9)*
- [ ] No review/verdict logic added. *(Sc 10)*
- [ ] v1 ships propose + human-review; autonomous proposal-quality judgement recorded as an L4 follow-up (not implemented).

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"chosen"}, {"marker":"punt"}, {"marker":"assumes"}, {"marker":"assumes"} ] }
```
