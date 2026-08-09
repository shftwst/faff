# Spec — FAFF-468: L4 lights-out dial-coherence — point both refusals at `.faffrc.local.yaml` + document the overlay recipe

> Spec: faffter-dark-nlspec · 2026-07-15 · interactive · confidence: high. Full spec on Linear FAFF-468.

Thin build: two refusal-message wordings, one docs recipe, two content-assertions — no gate-logic changes. Builds off `main` (needs FAFF-387's `.faffrc.local.yaml` overlay).

## 1. WHY — Problem and Principles

**Load-bearing model.** The two `dial-coherence` refusals already tell the operator *what* is wrong and *why*; they just don't say *where to fix it*. FAFF-387 (ADR-0067) shipped the fix location: a gitignored `.faffrc.local.yaml` that deep-merges over the committed `.faffrc.yaml`, overlay scalars winning. So the operator can set the two L4-required dials machine-locally without editing the shared committed base — but only if the refusal points them there. This change is the signpost.

**Problem statement.** Today `faff lights-out --check` refuses an L4 launch from this repo's committed `.faffrc.yaml` on `dial-coherence:adversarial-spec-review` and `dial-coherence:gates-fallback`, and neither refusal names a fix location. This change folds a remedy clause naming `.faffrc.local.yaml` (and the target value) into each `detail` string, and documents the exact overlay recipe.

**Design principles.**

**Fix location is the overlay, never the base.** The remedy must name `.faffrc.local.yaml`, not `.faffrc.yaml` — the point of FAFF-387 is machine-local dials that don't perturb the shared committed base. Reject any wording pointing at `.faffrc.yaml`.

**Mirror the existing remedy shape, add no new mechanism.** Every refusal in `dialCoherence` is a bare `{ gate, detail }` — the remedy lives *inside* `detail`, there is no `fix` field. `budget-until-invalid` is the precedent. Reject any implementation adding a structured `fix` field.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/lights-out.js` → `dialCoherence(dial)` | JS | The two `detail` strings being extended; `budget-until-invalid` in `lightsOutPreflight` is the wording precedent. |
| `plugin/skills/faff/bin/lib/config.js` → `loadConfig` (FAFF-387) | JS | Deep-merges `.faffrc.local.yaml` over base via `deepMergeConfig`/`findOverlay`. Already wired — dial inputs read the merged `cfg`. No change here. |
| `test/lights-out.test.mjs` | JS (node:test) | Dial-coherence assertions (currently detail-non-emptiness only) get content-`assert.match`es, mirroring the `budget-until-invalid` precedent. |
| `docs/guide/unattended.md` → `## Going lights-out (L4)` | Markdown | Overlay recipe documented here, in step-1 "Basic preflight", before the `--check` mention. |
| `records/adr/0067-committed-config-posture-two-file-model.md` | Markdown | The overlay model this leans on. Reference, do not modify. |

> **Line numbers move — `main` is fast-moving.** Every location is named by gate string / function name / heading. Re-locate by those anchors; do not trust line numbers.

## 2. OUT OF SCOPE

- **`dial-coherence:adversarial-review` (the `review` slot dial).** Not extended — the ticket scopes only the two dials the committed base trips on. Extension point: `dialCoherence` Rule A `review` branch.
- **Any change to the coherence gate logic or which dials refuse.** Only the `detail` prose grows.
- **Any change to the `.faffrc.local.yaml` overlay merge.** FAFF-387 already merges overlay-over-base and `cmdLightsOut` reads the merged `cfg`; the "probe reads merged config" concern is already satisfied. Extension point: `config.js` `loadConfig` (FAFF-387).
- **Auto-writing/scaffolding the operator's `.faffrc.local.yaml`.** Documents the recipe; does not generate the file.

## 3. WHAT

**Target dial values (confirmed against `main`'s coherent selftest fixture + `ADVERSARIAL_SPEC_REVIEW_OCCUPANTS`):**

```
slots.spec_review := faffter-dark-spec-review   # sole member of ADVERSARIAL_SPEC_REVIEW_OCCUPANTS
gates.fallback    := fail-closed                # the only token dialCoherence Rule B accepts
```

**Refusal shape — unchanged object, extended string.** Stays exactly `{ gate, detail }`. Each `detail` gains a trailing remedy clause in the house shape `<what's wrong> '<value>' <why> — fix <key path> in <file> (set: <value>)`.

**Chosen:** Fold the remedy into the existing `detail` string (no new `fix` field) — minimal surface, consistent with the whole `dialCoherence`/`lightsOutPreflight` refusal corpus.

**Chosen:** Name `.faffrc.local.yaml` (overlay), not `.faffrc.yaml` (committed base), as the fix location.

## 4. HOW — Behavior

**Approach.** Two one-line string edits, one docs addition, two test-assertion additions. No control-flow change.

**Edit 1 — `dial-coherence:adversarial-spec-review` detail.** Locate the refusal whose `gate` is `"dial-coherence:adversarial-spec-review"` and append:
`… — fix slots.spec_review in .faffrc.local.yaml (set: faffter-dark-spec-review)`

**Edit 2 — `dial-coherence:gates-fallback` detail.** Locate the refusal whose `gate` is `"dial-coherence:gates-fallback"` and append:
`… — fix gates.fallback in .faffrc.local.yaml (set: fail-closed)`

Preserve the existing `${...}` interpolation of the offending value; only append the ` — fix …` clause.

**Edit 3 — docs recipe.** In `docs/guide/unattended.md`, under `## Going lights-out (L4)`, in step-1 "Basic preflight", before the `--check` mention, add a short subsection giving the exact overlay to write, referencing ADR-0067 and both dials:

```
# .faffrc.local.yaml  (gitignored; overlays .faffrc.yaml)
slots:
  spec_review: faffter-dark-spec-review
gates:
  fallback: fail-closed
```

**Anti-pattern:** telling the operator to set these in `.faffrc.yaml` — the committed base is shared; per-machine L4 dials belong in the overlay.

**No merged-config work.** `cmdLightsOut` reads the already-merged `cfg`; `resolveSlotOccupant`(spec_review) and the `gates.fallback` dig read off it. Overlay-wins is FAFF-387's, verified on `main`. This ticket writes no config-reading code.

## 5. Scenarios — born-verifiable

```
Given a repo whose merged config trips L4 dial-coherence on spec_review
When `faff lights-out --check` refuses
Then the dial-coherence:adversarial-spec-review detail contains
     ".faffrc.local.yaml" AND "faffter-dark-spec-review"
```

```
Given a repo whose merged config trips L4 dial-coherence on gates.fallback
When `faff lights-out --check` refuses
Then the dial-coherence:gates-fallback detail contains
     ".faffrc.local.yaml" AND "fail-closed"
```

- `docs/guide/unattended.md`'s L4 section MUST document the `.faffrc.local.yaml` overlay recipe with both dials.

## 6. Design Decision Rationale

- **Fold remedy into `detail` vs a `fix` field.** **Chosen:** fold — mirrors every existing refusal + `budget-until-invalid`; a `fix` field would ripple through banner/ledger/JSON/test consumers for no functional gain. (decides: architecture)
- **Overlay vs committed base as fix location.** **Chosen:** `.faffrc.local.yaml` — machine-local L4 dials stay out of the shared base (FAFF-387/ADR-0067). (decides: product)
- **Any gate-logic change?** **Chosen:** none — the merged-config read is already satisfied by FAFF-387 on `main`; scope is detail-wording + docs + content-assertion tests. `VETTED_RECIPES` is empty and `ADVERSARIAL_SPEC_REVIEW_OCCUPANTS` = {`faffter-dark-spec-review`} at write time — revisit if that set changes. (decides: qa)

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.**
- **Assumes:** the branch builds off `main`, which carries FAFF-387's `.faffrc.local.yaml` overlay (`config.js` `loadConfig` deep-merges via `deepMergeConfig`/`findOverlay`; `cmdLightsOut` reads the merged `cfg`). *Validate:* `git grep -n 'faffrc.local' plugin/skills/faff/bin/lib/config.js` returns the FAFF-387 merge block before starting. (Present on `main`; absent on the FAFF-436 branch — build from `main`.)

## 8. DONE — Definition of Done

**From WHY**
- [ ] The `dial-coherence:adversarial-spec-review` detail contains `.faffrc.local.yaml` and `faffter-dark-spec-review`.
- [ ] The `dial-coherence:gates-fallback` detail contains `.faffrc.local.yaml` and `fail-closed`.
- [ ] Both remedy clauses use the house shape `— fix <key path> in .faffrc.local.yaml (set: <value>)`; the `${...}` value interpolation is preserved.

**From WHAT / HOW**
- [ ] The refusal object remains exactly `{ gate, detail }` — no `fix` field.
- [ ] No change to `dialCoherence` gate conditions, `config.js`, or the overlay merge.

**From HOW (docs)**
- [ ] `docs/guide/unattended.md`'s `## Going lights-out (L4)` documents the `.faffrc.local.yaml` overlay recipe, before the `--check` mention, with both dials and a reference to FAFF-387/ADR-0067.

**From SCENARIOS (tests)**
- [ ] `test/lights-out.test.mjs` adds `assert.match` on the two dial-coherence details (mirroring `budget-until-invalid`): spec_review → `/\.faffrc\.local\.yaml/` + `/faffter-dark-spec-review/`; gates → `/\.faffrc\.local\.yaml/` + `/fail-closed/`.
- [ ] The full test suite (`node --test`) stays green.

**Integration smoke test.**
```
1. In a tmp root with a committed base (spec_review = single-pass default, gates.fallback = advisory),
   run `faff lights-out --check --json` (CONTAINED env).
2. proceed == false; find refusals by the two dial-coherence gates.
3. Each detail matches /\.faffrc\.local\.yaml/ + its target value.
```

confidence: high
