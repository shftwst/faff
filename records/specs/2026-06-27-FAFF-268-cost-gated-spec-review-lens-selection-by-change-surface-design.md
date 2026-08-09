# Cost-gated spec-review lens selection by change-surface — design spec

> Spec: faffter-dark-nlspec · 2026-06-27 · autonomous · confidence: high. Full spec on Linear FAFF-268.

> Revised 2026-06-27 (autonomous narrow-prep) — folded in the human Decision comment resolving the change-surface-derivation + lens-skip-safety Punt (§7 Punt → Chosen; re-rated medium → high), reflected the new `blockedBy` FAFF-266 + FAFF-267 edges in §7 Assumes, and noted the deferred symmetric-skip follow-up as out-of-scope (§2).

This spec is for the build agent and human reviewers. It designs the **lens-selection step** that sits ahead of the spec-review producer (the `spec_review` slot scaffolded by FAFF-265), deciding *which* of the four review lenses fire and *how deep* they go, so spec-review cost is proportionate to the change rather than a flat four-lens (adversarial-at-L4) pass on every spec.

## 1. WHY — Problem and Principles

**Load-bearing model.** Spec-review cost is the product of two independent dials: **which lenses run** (architectural · infosec · methodology · QA) and **how deep each runs** (single-pass vs adversarial). FAFF-268 owns *both selection dials* — it never evaluates a spec itself. It hands a chosen lens-set + depth to the reviewer that FAFF-266 (L1–L3 single-pass) and FAFF-267 (L4 adversarial refuters) implement. Selection is the cheap gate in front of the expensive reviewer.

**Problem statement.** A four-lens review — adversarial at L4 — on *every* spec over-spends on a one-line config tweak and is overkill for trivial change. Left flat, the gate is either disabled (defeating its purpose) or burns budget on changes that never needed three of the four lenses. This change makes the gate proportionate: it fires lenses selectively by **change-surface** and scales depth by **level + appetite**.

**Design principles** (each would reject an otherwise-valid implementation):

- **Fail-safe selection — cost-gating only ever *removes* a lens when it is confidently safe to.** When the change-surface is ambiguous or unclassifiable, *all* lenses fire. Under-reviewing a spec is the failure this gate exists to prevent; saving a lens is only ever an optimisation on a confidently-classified surface. This mirrors faff's opt-in fail-safe posture and the already-shipped scan's recall tuning.
- **Skips are safe-direction only — never skip toward higher risk.** A lens is dropped only when classification confidently shows the surface does not need it; the gate never *infers* a lens away in the risky direction. infosec and QA are **sticky** (see §6). This is the durable safety invariant that holds across this slice and the deferred symmetric-skip follow-up.
- **Selection is advisory input, not a contract change.** The fixed `spec-review-verdict` contract (FAFF-265) is untouched. FAFF-268 only *chooses the producer's inputs* (lens-set + depth) ahead of invocation; the producer still emits the same `{ verdict, objections, conformant, violations }` block. No new verdict, lens, or severity is introduced — the four lens names and three severities are frozen by FAFF-265.
- **Recall-tuned signal extraction.** Deriving the change-surface from a spec is heuristic. A false positive costs one wasted lens-pass; a false negative skips a needed review. Tune toward firing — reuse, do not reinvent, faff-prep's already-shipped-scan surface-extraction (named paths, module/dir names, named subsystems).

**Scope statement.** This is the proportionality layer of FAFF-9's spec-stage approach-review, sitting between the spec body and the lens reviewers — it selects, it does not review.

## 2. OUT OF SCOPE

- **The lens evaluation logic** — what each lens actually checks and how objections are produced. *Why:* owned by FAFF-266 (L1–L3 single-pass) and FAFF-267 (L4 refuters). *Extension point:* the `spec_review` producer the selection hands its lens-set to.
- **Wiring the reviewer into the prep→build-admission seam** (the `reject-approach` backward edge). *Why:* FAFF-266 owns that seam. *Extension point:* faff-prep's spec-review invocation site.
- **Adversarial depth mechanics** (per-lens refuters, second-model machinery). *Why:* FAFF-267. *Extension point:* the `mode: adversarial` branch of the depth selection.
- **Per-lens severity→verdict mapping.** *Why:* reviewer judgement, explicitly out of FAFF-265's contract shape. *Extension point:* the producer.
- **Aggressive / symmetric skip-gating** — bidirectional inference that would also drop sticky lenses (infosec/QA) or skip in the higher-risk direction on a proven-clean surface. *Why:* deferred follow-up slice per the §7 human decision — v1 ships additive-only / safe-direction skips first, and tightens once spec-derived classification reliability is measured against real specs. *Extension point:* the `apply_appetite` / classification-confidence step, widened in a later slice.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Change-surface | The set of surface tags a spec is classified as touching (e.g. config, auth-security, data-schema) |
| Surface signal | A heuristic hit (named path, module/dir name, named subsystem) extracted from a spec that implies a surface tag |
| Lens-set | The subset of the four frozen lenses selected to fire for a given spec |
| Depth / mode | `single-pass` (L1–L3, FAFF-266) or `adversarial` (L4, FAFF-267) |

**Proposed surface taxonomy** (the tag vocabulary the selection classifies into — extensible, recall-tuned):

```
ENUM SurfaceTag:
  config             # config files, flags, defaults — no architecture-bearing logic
  auth-security      # auth, session, token, crypto, secrets, permissions
  data-schema        # persistence schema, migrations, data model
  public-api         # externally-consumed interface / contract surface
  infra-deploy       # CI, IaC, container, deploy config
  ui                 # user-facing presentation
  pure-logic         # internal algorithm/behaviour, no cross-cutting surface
  architecture-bearing  # introduces/changes a module boundary or cross-slice structure
```

**Type definitions:**

```
RECORD LensSelection:
  lenses: Set<Lens>        # subset of {architectural, infosec, methodology, QA} — frozen by FAFF-265
  mode: single-pass | adversarial
  rationale: String        # which signals drove the set + mode (audit trail)

RECORD SurfaceClassification:
  tags: Set<SurfaceTag>    # empty ⇒ unclassified ⇒ fail-safe fire-all
  signals: List<{ tag, evidence }>   # the hits that produced each tag
```

**Surface → lens mapping** (positive-fire rules; the always-fire baseline is the QA lens — every spec gets at least an acceptance/verifiability pass):

| Surface tag | Fires | Skips (when surface is *only* this) |
|---|---|---|
| `auth-security` | **infosec** (always) | — |
| `architecture-bearing` | **architectural** | — |
| `data-schema` | architectural + infosec | — |
| `public-api` | architectural + methodology | — |
| `config` (only) | QA baseline (+ infosec, sticky in v1) | **architectural** |
| `ui` (only) | QA + methodology (+ infosec, sticky in v1) | architectural |
| `pure-logic` (only) | architectural + QA (+ infosec, sticky in v1) | — |
| unclassified / ambiguous | **all four** (fail-safe) | — |

> **v1 scope (§7 Chosen).** The only lens the additive-only v1 skips on a confidently-trivial surface is **architectural** (and methodology where the positive-fire rules don't add it); **infosec + QA are sticky and always fire** in v1. The "Skips → infosec" reductions this table targets are the *deferred symmetric-skip follow-up* (§2 out-of-scope), not v1 behaviour. Read the table as the eventual target mapping with infosec held sticky until classification reliability is measured.

**Depth by level + appetite:**

| Level | Mode | Appetite effect |
|---|---|---|
| L1–L3 | `single-pass` (FAFF-266) | `low` widens the lens-set (fires more, skips less); `high`/`full` permit confident skips |
| L4 | `adversarial` (FAFF-267) | appetite never narrows below the fail-safe set; depth stays adversarial |

**Design decisions** — see §6; each tradeoff concludes with a marker.

## 4. HOW — Behavior

**Where it plugs in.** A selection step runs *immediately before* the `spec_review` producer is invoked (the seam FAFF-266 creates in prep→build-admission). It reads the spec body + runtime level + configured appetite, produces a `LensSelection`, and passes it as the producer's input. It writes nothing to the contract and gates nothing itself.

**Derivation — from the spec's *declared* surface, not an inferred diff.** Signals are extracted from the spec's Reference-context table, WHAT interfaces/types, OUT OF SCOPE extension points, and the explore findings — the surfaces the spec *names*. An inferred diff (guessing the files the spec would change) is not used: before code exists it is unreliable and circular. (Resolved by the human Decision 2026-06-27: declared-surface derivation, recall-biased, reusing prep's surface extraction — see §7 Chosen.)

```
PROCEDURE select_lenses(spec, level, appetite):
  1. signals := extract_surface_signals(spec)         # reuse already-shipped-scan extractor; recall-tuned
  2. tags := classify(signals)                         # map signals → SurfaceTag set
  3. IF tags is empty OR classification is low-confidence:
       lenses := ALL_FOUR                              # fail-safe (principle 1)
     ELSE:
       lenses := QA_BASELINE ∪ STICKY(infosec)         # v1: infosec + QA always fire
       FOR each tag in tags: lenses ∪= fires_for(tag)  # positive-fire only; never skip a tag's required lens
  4. mode := (level == L4) ? adversarial : single-pass
  5. lenses := apply_appetite(lenses, appetite)        # low widens; high/full permit confident safe-direction skips (architectural); never below fail-safe set at L4, never drop infosec/QA in v1
  6. RETURN LensSelection{ lenses, mode, rationale: signals→tags→fires summary }
```

**Failure modes:**

- **The failure** — spec-derived classification mislabels an auth-touching spec as `config`-only, skipping infosec. *How you'd know* — an infosec-relevant issue ships through a reduced lens-set; surfaced by a later infosec finding on merged code. *What it means* — v1 contains this by keeping **infosec sticky** (never skipped via inference) and shipping additive-only / safe-direction skips per §7; only the architectural lens is dropped on a confidently-trivial surface. Symmetric infosec-skip is the deferred follow-up, gated on measured derivation reliability.
- **The failure** — recall-tuned extraction over-fires, so cost-gating saves nothing. *How you'd know* — selected lens-sets are near-always all-four in practice. *What it means* — proceed; over-firing is the safe direction, and the rationale audit trail shows whether tuning needs sharpening.

**Anti-pattern:** deriving change-surface by asking the model to imagine the diff. Why: pre-code diff inference is unreliable and circular — classify from what the spec *declares*, not what it might touch.

## 5. SCENARIOS — main objectives, born verifiable

```
Given a spec whose only named surface is a config flag/default
When select_lenses runs at L2
Then the architectural lens is skipped (QA + infosec still fire, sticky in v1) and mode is single-pass
```

```
Given a spec that names auth / session / token / secrets surfaces
When select_lenses runs at any level
Then infosec is in the lens-set (never skipped)
```

```
Given a spec whose surface cannot be confidently classified (no signals, or mixed/ambiguous)
When select_lenses runs
Then all four lenses fire (fail-safe)
```

```
Given the pipeline is running at L4
When select_lenses runs
Then mode is adversarial and the lens-set is never narrowed below the fail-safe set by appetite
```

Composition constraint (non-functional): the `LensSelection` the producer receives must compose with the FAFF-266 reviewer's input interface and leave the FAFF-265 `spec-review-verdict` contract output unchanged.

## 6. DESIGN DECISION RATIONALE

**What does the selection do when the change-surface is ambiguous?**
Options: fire-all (safe, costs tokens) vs fire-minimal (cheap, risks missing infosec). **Chosen:** fire-all on ambiguity — cost-gating only ever removes a lens on a *confidently* classified surface. Under-review is the failure mode the gate exists to prevent; recall over precision.

**Does FAFF-268 change the spec-review contract or add a selection contract?**
Options: extend the verdict contract vs keep selection as advisory producer-input. **Chosen:** selection is advisory input to the producer, contract unchanged — the four lenses + three severities + verdict enum stay frozen (FAFF-265). FAFF-268 chooses inputs, never output shape.

**How is the change-surface signal extracted?**
Options: new extractor vs reuse the already-shipped-scan surface extraction. **Chosen:** reuse the recall-tuned already-shipped-scan extractor (named paths, module/dir names, named subsystems) — one home for surface extraction, already validated in faff-prep. (Confirmed by the human Decision 2026-06-27.)

**What sets review depth?**
Options: appetite-driven vs level-driven vs both. **Chosen:** level sets mode (single-pass L1–L3 / adversarial L4, matching the FAFF-266/267 split); appetite modulates skip-aggressiveness *within* a level and never narrows below the fail-safe set at L4. Depth tracks where on the L1→L4 ladder the run sits; appetite only tunes how confidently lenses are skipped.

## 7. RESOLVED DECISIONS AND ASSUMPTIONS

**Resolved decision (was the open Punt — closed by human Decision 2026-06-27):**

- **Chosen: change-surface derivation source + how far to trust it for *skipping*.** Two coupled calls, both resolved by the human:
  - **(a) Derivation source** — derive the change-surface from the spec's ***declared* surface**: its WHAT, the files/modules/subsystems it names, and its `**Assumes:**`. **Recall-biased** (over-include). Reuse prep's existing already-shipped-scan surface-area extraction; do **not** predict the build diff (pre-code diff inference is unreliable and circular).
  - **(b) Skip trust — additive-only / safe-direction for v1.** Skips are **safe-direction only**: only *low-risk* lenses may be dropped on a confidently-trivial surface (e.g. skip the **architectural** lens on a config-only change). **infosec + QA are sticky** — infosec always fires when the spec touches auth / secrets / external input / data handling **or** when the surface is uncertain, and is never inferred away in v1; QA is the always-fire baseline. The gate **never skips toward higher risk**. Ship this additive-only v1 now; **defer aggressive/symmetric skipping** (bidirectional drops, dropping sticky lenses on a proven-clean surface) to a follow-up slice (§2 out-of-scope) — this is the split the agile lens flagged, and it is fine to take it.

  *Rationale:* a mis-derived "config-only" that skips architectural or infosec silently under-reviews and undermines the whole gate; the safe-direction + sticky-infosec constraints make under-review structurally hard, and additive-only first lets derivation reliability be measured on real specs before the gate is trusted to drop more.

**Assumptions:**

- **Assumes:** FAFF-266 defines the `spec_review` invocation seam in prep→build-admission that consumes a `LensSelection` (lens-set + depth) — the producer→consumer interface this selection feeds. **Now a hard `blockedBy` edge** (FAFF-268 blockedBy FAFF-266): the build is gated behind FAFF-266's reviewer and composes over it.
- **Assumes:** FAFF-267 defines the `mode: adversarial` per-lens refuter path for L4. **Now a hard `blockedBy` edge** (FAFF-268 blockedBy FAFF-267): the build is gated behind FAFF-267's refuters and the L4 depth selection composes over them.

## 8. DONE — Definition of Done

### From WHY
- [ ] A config-only spec runs a reduced lens-set (architectural skipped); an auth-touching spec always includes infosec (proportionate gate)

### From WHAT (types and interfaces)
- [ ] `LensSelection` carries a lens-set ⊆ the four frozen lenses, a `single-pass|adversarial` mode, and a rationale string
- [ ] No new lens, severity, or verdict is introduced; the FAFF-265 contract output is unchanged
- [ ] Surface→lens mapping fires infosec on any `auth-security` signal and skips architectural only on a confidently-classified non-architecture surface

### From HOW (behaviour)
- [ ] Change-surface is derived from the spec's declared surface (not an inferred diff)
- [ ] Ambiguous/unclassified surface fires all four lenses (fail-safe)
- [ ] **v1 is additive-only / safe-direction:** only the architectural lens is dropped on a confidently-trivial surface; **infosec + QA always fire** and are never inferred away; the gate never skips toward higher risk; symmetric/aggressive skipping is deferred (§2)
- [ ] Level sets mode (L1–L3 single-pass / L4 adversarial); appetite never narrows below the fail-safe set at L4
- [ ] The selection produces a rationale audit trail of signals→tags→fired lenses

### From HOW (composition)
- [ ] The `LensSelection` composes with the FAFF-266 reviewer input and leaves the `spec-review-verdict` contract output unchanged

**Integration smoke test:**

```
GIVEN a spec naming only a config default
WHEN select_lenses(spec, level=L2, appetite=high) runs
THEN it returns LensSelection{ lenses ⊉ {architectural}, infosec ∈ lenses (sticky), mode=single-pass } with a rationale citing the config signal
```

confidence: high
