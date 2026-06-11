# Spec — FAFF-108: Roll the FAFF-81 producer-artifact pattern out to the review and ship producers

> Spec: faffter-dark-nlspec · 2026-06-10 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-108.

**Preamble.** This spec rolls the proven FAFF-81 pattern (the `spec` producer emits a `faff-contract:spec-readiness` artifact block; its adaptor prefers that block over prose extraction) out to the two remaining producer-emitted contracts: **review-verdict** and **delivery-outcome**. After this change, all three producer-emitted contracts are artifact-first: the producer that authored the verdict/outcome declares it as a structured fenced block, and the adaptor consumes that block deterministically (no LLM re-read) instead of extracting from the producer's native prose. The prose-extraction seam survives only as the fallback for an *absent* block.

This is a **proven-pattern rollout**, not new mechanism. The deliverable is **prose edits to 5 `SKILL.md` files** — 3 producers gain an emission instruction (copied from FAFF-81's wording), 2 adaptors gain an artifact-preferred two-path branch (copied from `faffidavit-spec`'s existing branch). **No CLI code, no CI, no config, no new file format changes.** The contract scripts, their fixtures, and the CI selftests for both target contracts already exist.

## Already shipped against this surface

- **FAFF-77** — the `spec-readiness` contract script + the `faffidavit-spec` wiring to it.
- **FAFF-78 / FAFF-79 / FAFF-80** — the `review-verdict`, `delivery-outcome`, and `automation-routing` contract scripts, each with `{run, fixtures}` in the CLI `CONTRACTS` map and a `--selftest` runner.
- **FAFF-81** — the **proven pattern this copies**: the `spec` producer emits a `faff-contract:spec-readiness` block; `faffidavit-spec` lit up the artifact-preferred branch.

## 1. WHY

The contract-as-code epic (FAFF-21) moves contract data off the LLM prose seam onto deterministic artifacts. Today the **spec** contract is artifact-first (FAFF-81), but **review-verdict** and **delivery-outcome** are still prose-extracted on the common path: the adaptor reads the producer's native output (the reviewer's `signal:` + `## Findings`, the ship producer's `gh pr merge` exit) through an LLM seam every time, even though the producer that wrote that output already knows the structured verdict it represents.

This is the same seam FAFF-81 closed for spec. The producer authored the verdict — the reviewer decided `pass`/`fail`/`needs-human` and which findings name a location and an action; the ship producer ran the merge and knows whether it was confirmed. Having the adaptor re-derive that from prose is a redundant, non-deterministic re-read. The fix: each producer **self-declares** its verdict as a structured `faff-contract:<name>` block, and the adaptor prefers that block — falling back to prose only when the block is absent.

**Design principles (faff's four tenets):**
- **Deterministic-tools-over-prose.** Replace a per-run LLM extraction with a `JSON.parse` of a producer-authored block on the common path. The LLM seam survives only for absence (a third-party producer that emits no block).
- **Configurable-not-opinionated.** Copying FAFF-81's wording keeps every producer/adaptor pair uniform; a producer that omits the block still works (prose fallback).
- **Adoptable-not-all-encompassing.** Proportionate: 5 prose edits, zero new mechanism.
- **Understandable-not-unapproachable.** The block mirrors the prose; the adaptor branch reads identically to the one already in `faffidavit-spec`.

**Reference-context table:**

| Role | File (`skills/…/SKILL.md`) | What it is | This spec |
|---|---|---|---|
| Producer template | `faffter-noon-spec` (§ *Contract artifact (FAFF-81)*) | The emission instruction to copy | read, don't edit |
| Adaptor template | `faffidavit-spec` (§ *The split — artifact-preferred*) | The two-path branch to copy | read, don't edit |
| Producer target | `faffter-noon-review` | Emits `signal:` + `## Findings`; no block | **add** `faff-contract:review-verdict` block |
| Producer target | `faffter-dark-adversarial-review` | Phase 1 hard verdict; Phase 2 soft | **add** block for **Phase 1's verdict only** |
| Producer target | `faffter-noon-ship` | Emits native `gh pr merge` exit | **add** `faff-contract:delivery-outcome` block |
| Adaptor target | `faffidavit-review` | Prose extraction only | **add** artifact-preferred branch |
| Adaptor target | `faffidavit-ship` | Prose extraction only | **add** artifact-preferred branch |
| CLI (unchanged) | `skills/faff/bin/faff` `CONTRACTS` | `review-verdict` + `delivery-outcome` `{run, fixtures}` | verify, change nothing |
| CI (unchanged) | `.github/workflows/validate.yml` | `contract <name> --selftest` for both | verify, change nothing |

**Chosen:** treat FAFF-108 as a mechanical rollout of FAFF-81 — copy the proven producer wording and adaptor branch verbatim-in-spirit, inventing no new mechanism.

## 2. OUT OF SCOPE

- **Any CLI code change.** The `review-verdict` / `delivery-outcome` contract scripts, their fixtures, and the `--selftest` runner already exist; the producer block this spec adds *is* the script's input shape.
- **Any CI change.** `validate.yml` already runs both selftests.
- **Any new config, file format, or CLI subcommand.**
- **A new `validate-adapters` producer-emission check.** `validate-adapters` checks adaptor wiring (already passing). Producer-emission correctness is a runtime concern (fail-loud-on-malformed + fallback-on-absent + selftests). A static check is a **Punt** (§6), not built here.
- **The `automation-routing` contract.** Computed by `faffidavit-routing` from diagnostics — no producer authored it, so no artifact. Out by construction.
- **The `intake`/jot path and the `rendering` slot.** Not fixed contracts — no artifact applies.
- **Retiring the affidavits (FAFF-109).** Separate epic; this only delivers the unblock.
- **The spec producer + `faffidavit-spec`.** Already artifact-first (FAFF-81).
- **Phase-2 adversarial hypotheses.** Soft findings, not a verdict — stay prose; only Phase 1's verdict is declared.

## 3. WHAT

Three producers each emit one structured artifact block declaring the verdict they authored; two adaptors each gain a two-path branch that prefers that block and falls back to prose only on its absence.

### 3.1 The `review-verdict` block (both review producers)

````
```faff-contract:review-verdict
{ "signal": "pass" | "fail" | "needs-human",
  "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... ] }
```
````
- `signal` — the producer's verdict (same value as its `signal:` line).
- `findings` — one entry per finding raised, declaring whether it named a code **location** and a concrete **action/fix**.
- `pass` may carry zero findings; `fail`/`needs-human` carry ≥1 (the script enforces this).

### 3.2 The `delivery-outcome` block (ship producer)

````
```faff-contract:delivery-outcome
{ "outcome": "shipped" | "not-ready" | "failed",
  "reason": "<short cause; may be empty>",
  "corroborated": <bool> }
```
````
- `outcome` — the producer's real delivery result.
- `reason` — short, specific cause; empty for `shipped`.
- `corroborated` — **`true` only when the native result actually confirms the merge/deploy succeeded** (the honesty rule, §4.3). Unconfirmable → `false`.

### 3.3 The self-declaration principle (shared)

**Chosen:** the producer self-declares contract data because it authored that data — exactly as FAFF-81 reasoned for spec markers. The reviewer decided `signal` and raised each finding (so it knows each finding's location/action presence directly); the ship producer ran the merge and read the `gh` exit. The block **mirrors the prose, it is not a second source of truth.**

### 3.4 The adaptor artifact-preferred two-path branch (shared)

Each target adaptor gains the branch already in `faffidavit-spec`, in precedence order:
1. **Producer artifact — preferred, no LLM.** Locate the `faff-contract:<name>` block by info-string, `JSON.parse` its body → the extraction JSON. Present+valid → use; present+**malformed → fail-loud** (`signal: fail`, "contract artifact present but malformed"; do **not** fall back);
2. **Prose extraction — fallback, the LLM seam, only when the block is *absent*.**

**The fallback trigger is *absence*, never *corruption*** (copied from `faffidavit-spec`). **No `provenance_present` field** — that is spec-specific; review/ship extraction JSON is just `{signal, findings}` / `{outcome, reason, corroborated}`.

## 4. HOW — the exact edit per file

### 4.1 `faffter-noon-review` — add `## Contract artifact (FAFF-108)`
After the `## Output` envelope: append **one** `faff-contract:review-verdict` block (§3.1) as the last output. FAFF-81 rules: one block, machine-only, always emit, valid JSON to the exact shape, mirrors prose, malformed-fails-loud, omitting → prose fallback. Per finding: `location_present` = named a code location?, `action_present` = named a concrete fix?

### 4.2 `faffter-dark-adversarial-review` — add the same section (Phase 1 only)
**Chosen:** the block declares **Phase 1's verdict only** (`signal` + Phase-1 findings' location/action presence). Phase-2 adversarial hypotheses are **not** the verdict — they stay prose under `## Adversarial findings` and are **not** entered into `findings[]`.

### 4.3 `faffter-noon-ship` — add `## Contract artifact (FAFF-108)`
After step 5 ("Emit the native result"): append **one** `faff-contract:delivery-outcome` block (§3.2). **Honesty rule — `corroborated: true` ONLY when the native result confirms the merge/deploy**; unconfirmable → `false`, never a phantom `true`. **The script's existing fail-safe stands:** an `outcome:shipped` with `corroborated:false` still coerces → `failed` (CLI fixture `uncorroborated-shipped-coerced`). So honest self-declaration **cannot weaken** the corroboration guard.

### 4.4 `faffidavit-review` — add the artifact-preferred branch
In `## Validate — wired to the contract script (FAFF-78)`, before the current *translation seam*, insert path (1): locate `faff-contract:review-verdict` → `JSON.parse` → present-valid use / present-malformed fail-loud / **absent → fall back to the existing prose extraction (path 2)**. Same extraction JSON to `faff contract review-verdict` unchanged; **no `provenance_present`**.

### 4.5 `faffidavit-ship` — add the artifact-preferred branch
Same as 4.4 for `faff-contract:delivery-outcome` (`{outcome, reason, corroborated}`); the script's `corroborated:false`-shipped → `failed` coercion is unchanged and applies on both paths.

### 4.6 No CLI / CI / config edit
**Chosen:** the diff is exactly the 5 `SKILL.md` files. `CONTRACTS` map fixtures already confirm both block shapes; both `--selftest`s already run in CI; `validate-adapters` wiring is unchanged and passing.

## 5. DESIGN DECISION RATIONALE

- **Chosen — copy FAFF-81, invent nothing.** Proven pattern, mechanical scope. Diverging would mean two artifact conventions.
- **Chosen — producer self-declaration over adaptor re-derivation.** The producer authored the verdict; re-reading its own prose through an LLM is a redundant non-deterministic seam. The script remains the sole source of conformance *computation* — the block is only its *input*.
- **Chosen — fail-loud on malformed, fall back only on absent.** A corrupt block is producer breakage and must surface, not silently degrade. Absence (a third-party producer with no block) is the only legitimate fallback trigger.
- **Chosen — ship `corroborated` honesty rule, fail-safe preserved.** The honesty rule + the unchanged coercion mean self-declaration cannot weaken the corroboration guard.
- **Chosen — Phase-1 verdict only for adversarial review.** Folding soft hypotheses into `findings[]` would misrepresent the hard verdict the gate routes on.
- **Punt — a `validate-adapters` producer-emission check** (§6). Runtime fail-loud + selftests cover correctness; a static check is extra mechanism the proportionate-prose-only scope defers.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Punts:**
- **Punt:** a static `validate-adapters` (or new) check that producers emit their `faff-contract:<name>` block. Today covered at runtime (fail-loud + fallback) + selftests. Defer; revisit if a producer-regression slips the runtime net.
- **Punt:** FAFF-109 (retire the affidavits) builds on this — once review + ship are artifact-first, all producer-emitted contracts consume a structured artifact, so the affidavit prose layer can be retired. That retirement is FAFF-109's scope; this ticket only delivers the unblock.

**Assumes:**
- **Assumes:** the `review-verdict` / `delivery-outcome` script input shapes are stable and exactly as the CLI `CONTRACTS` fixtures encode them. Verified at spec time; the producer blocks are written to those shapes. *Validate:* re-check the fixtures before editing.
- **Assumes:** the `faffidavit-spec` two-path branch is the canonical template, minus the spec-only `provenance_present` half. Verified present/unchanged.
- **Assumes:** the adaptor edits are additive (a precedence-1 path before the existing extraction), so the sole-source-script declaration `validate-adapters` checks is unchanged and still passes.

## 7. DONE — testable checklist

- [ ] `faffter-noon-review` has a `## Contract artifact (FAFF-108)` section instructing one `faff-contract:review-verdict` block (§3.1) as the last output, with the FAFF-81 rules.
- [ ] `faffter-dark-adversarial-review` has the same section scoped to **Phase 1's verdict only**, excluding Phase-2 hypotheses from `findings[]`.
- [ ] `faffter-noon-ship` has a `## Contract artifact (FAFF-108)` section for the `faff-contract:delivery-outcome` block, including the `corroborated: true`-only-when-confirmed honesty rule + the coercion-unchanged note.
- [ ] `faffidavit-review` has an artifact-preferred path (1) before its prose extraction (now path 2): locate → `JSON.parse` → present-valid use / present-malformed fail-loud / absent fall back; no `provenance_present`; absence-not-corruption stated.
- [ ] `faffidavit-ship` has the equivalent path (1) for `faff-contract:delivery-outcome`, same three branches, no `provenance_present`.
- [ ] Each adaptor still declares its contract script the **sole source** of contract data (wiring intact); both yield the same extraction JSON on both paths.
- [ ] **No CLI / config / CI-mechanism change:** the diff is exactly the 5 `SKILL.md` files; no edit to `skills/faff/bin/faff`, no `.faffrc`/schema/subcommand change, no `validate.yml` step added/changed.
- [ ] `faff contract review-verdict --selftest` and `faff contract delivery-outcome --selftest` still pass (pre-exist, unchanged — confirm green).
- [ ] `faff validate-adapters` still passes for `faffidavit-review` and `faffidavit-ship` (wiring unchanged).

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"punt"},{"marker":"punt"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"} ] }
```

---

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4) — clean.** A single cohesive rollout (5 prose edits, sub-day), uniform across the producer/adaptor pairs. Could split review-vs-ship, but they're tiny and share one pattern — keep as one. No split.
- **Workstream fit? (principles 1 + 5) — clean.** "Configurability & contract framework" under FAFF-21; cohesive with the contract-as-code arc.
- **Deps surfaced? (principle 6) — clean.** Parent FAFF-21; **unblocks FAFF-109** (the retire epic, already blocked-by this). No hidden dep — the CLI scripts/fixtures/CI it relies on are all shipped (FAFF-78/79).
- **Risk profile? (principle 7) — very low, no spike.** Prose-only, proven pattern, scripts + CI pre-exist. The one substantive risk — that ship's `corroborated` self-declaration could weaken the merge-confirmation fail-safe — is closed in the spec (the honesty rule + the unchanged uncorroborated→failed coercion). De-risk by confirming both `--selftest`s stay green post-edit (they're unchanged, so they will).

---
*Attached by faff-prep (interactive, 2026-06-10). Spec produced by faffter-dark-nlspec, validated against faffidavit-spec (markers_valid, no violations). Self-rated `confidence: high`.*
