# Spec — FAFF-109: Retire the `faffidavit-*` artifact adaptors (Option A — retire entirely)

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-109.

**Decision:** Option A — retire the three artifact adaptor **slots** entirely (chosen by the human on 2026-06-11; folded into this spec). Blocker FAFF-108 is Done, so every contract-feeding producer now emits its `faff-contract:<name>` block; the adaptor's only remaining job (locate block → `JSON.parse` → `faff contract <name>`) is deterministic and folds into the consumer.

## 1. WHY

Post-FAFF-77/78/79/80 (deterministic `faff contract <name>` scripts) + FAFF-81/108 (producers emit their `faff-contract:<name>` block), the three artifact adaptors `faffidavit-spec` / `-review` / `-ship` do only: locate the producer's block, `JSON.parse` it, call `faff contract <name>`, return the result. That deterministic shim is the "affidavit middle" FAFF-21 wanted gone. Fold it into the consumers (faff-prep, faff-graft Step 9/10) and retire the slots.

**Design principles.** Deterministic-tools-over-prose (the LLM-free fold); understandable (fewer slots, one less indirection); proportionate (prose + small CLI edits; the `contract` scripts/selftests are untouched).

## 2. The four resolved sub-decisions (agreed at build time)

1. **Chosen — rehome the canonical definitions into the fixed gateway contract sections.** `faffidavit-spec`'s marker table + writing-style + provenance format, and `-review`/`-ship`'s envelopes, move into the gateway Spec-readiness / Review-verdict / Delivery-outcome fixed sections. Producers and consumers reference the gateway, not a deleted adaptor.
2. **Chosen — drop the provenance stamp's `adaptor:` field.** It named the `spec_adaptor` slot, which no longer exists. The stamp keeps `producer · date · mode · confidence`. prep, the producers, and the example update accordingly.
3. **Chosen — `validate-adapters` checks artifact-emission for spec/review/ship producers.** The old "maps onto the `*_adaptor` contract" check becomes "emits its `faff-contract:<name>` block" (the FAFF-81/108 emission).
4. **Chosen — repoint the `resolveSkillsDir` sentinel** (`bin/faff`) from `faffidavit-spec` to `faffidavit-routing` (a surviving sibling).

## 3. OUT OF SCOPE

- **`routing_adaptor` / `faffidavit-routing`** and **`rendering_adaptor` / `faffidavit-rendering`** — they stay; `routing` computes a verdict, `rendering` has no fixed contract. **Chosen:** unchanged (beyond contrast-prose rewording).
- **The CLI `contract` scripts, schemas, and `--selftest`s** — faff-owned, deterministic, called directly by the consumer. **Chosen:** byte-unchanged.
- **Producer artifact emission** — shipped in FAFF-81/108.

## 4. HOW — the change set

**Fold (core):**
- `skills/faff-prep/SKILL.md` — replace `spec_adaptor` delegation: prep locates `faff-contract:spec-readiness` → `JSON.parse` → adds `provenance_present` via its own `> Spec:` regex → calls `faff contract spec-readiness`. Confidence routing + live-thread reconciliation (FAFF-110) unchanged.
- `skills/faff-graft/SKILL.md` Step 9 — locate `faff-contract:review-verdict` → parse → `faff contract review-verdict`.
- `skills/faff-graft/SKILL.md` Step 10 — locate `faff-contract:delivery-outcome` → parse → `faff contract delivery-outcome`; integrity floor + coercion unchanged.

**Delete + rehome:** `rm` `skills/faffidavit-spec` / `-review` / `-ship`; move their canonical defs into the gateway fixed-contract sections (decision 1).

**CLI (`skills/faff/bin/faff`):** remove REGISTRY + SLOT_TYPES + `CONFIG_KEYS` entries for the 3 adaptors; reframe `checksFor` to artifact-emission (decision 3); repoint the sentinel (decision 4). `contract` scripts/selftests untouched.

**Gateway (`skills/faff/SKILL.md`):** drop the 3 adaptor rows from the slot table + `.faffrc` example; reword the 3 contract headers from "→ `X_adaptor`" to "consumed directly via `faff contract <name>`"; rewrite the producer/adaptor taxonomy so only `routing_adaptor` + `rendering_adaptor` remain adaptor slots; fix validate-adapters scope + alias table.

**Producers reword** (reference the gateway contract, not the adaptor): `faffter-noon-spec`, `faffter-dark-nlspec`, `faffter-noon-review`, `faffter-dark-adversarial-review`, `faffter-noon-ship`.

**Others:** `faff-tidy`; `faffidavit-rendering` (contrast prose); `faffter-dark-authoring-adaptors`/FAFF-22 (remove the 3 from the authorable-adaptor list; **add the producer-artifact-emission + fused-wrapper bespoke path** — the third-party conformance route under Option A); `contracts/examples/spec-with-artifact.example.md` (stamp).

## 5. DONE — testable checklist

- [ ] faff-prep, faff-graft Step 9, Step 10 call `faff contract <name>` directly on the located artifact; no `*_adaptor` delegation in the default path.
- [ ] `faffidavit-spec` / `-review` / `-ship` deleted; their canonical defs rehomed into the gateway fixed-contract sections.
- [ ] CLI: REGISTRY/SLOT_TYPES/CONFIG_KEYS entries for the 3 removed; `checksFor` checks artifact-emission; sentinel repointed to `faffidavit-routing`.
- [ ] Gateway: 3 adaptor rows + `.faffrc` lines removed; contract headers reworded; producer/adaptor taxonomy lists only `routing_adaptor` + `rendering_adaptor`.
- [ ] Provenance stamp `adaptor:` field dropped everywhere (prep, producers, example).
- [ ] FAFF-22 (`faffter-dark-authoring-adaptors`) documents the producer-artifact-emission / fused-wrapper bespoke path.
- [ ] `faff validate-adapters` green; `faff contract {spec-readiness,review-verdict,delivery-outcome} --selftest` green.
- [ ] Zero dangling references: `git grep faffidavit-spec|faffidavit-review|faffidavit-ship` returns only intentional mentions (FAFF-22 history / changelog).
- [ ] CLI smoke: `faff config get`, `faff next`, `faff eligible` resolve the skills dir (sentinel fix holds).
- [ ] `faffidavit-routing` / `faffidavit-rendering` unchanged beyond contrast-prose rewording; `contract` scripts/selftests byte-unchanged.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"} ] }
```

*Attached by faff-prep (interactive, 2026-06-11). Option A chosen by the human; the four execution sub-decisions agreed at build time. Self-rated `confidence: high`.*
