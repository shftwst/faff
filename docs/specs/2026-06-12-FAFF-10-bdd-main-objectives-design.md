# Spec — FAFF-10: BDD scenarios for main spec objectives (born-verifiable)

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high. Full spec on Linear FAFF-10.

> **Revised 2026-06-12 (prep refresh-in-place).** Two changes: (1) both open Punts resolved by human decision → **Chosen: a new `## Scenarios` section, proportionate** (complexity bar). (2) Terminology refreshed for FAFF-109 — the `spec_adaptor` / `faffidavit-spec` layer was **retired**; readiness is now the producer-emitted `faff-contract:spec-readiness` block verified by `faff contract spec-readiness`. The approach is unchanged (scenarios are added producer prose the contract doesn't parse); only the references are corrected. Rating moves medium → high. Supersedes the 2026-06-11 medium spec.

**Refresh note (freshness re-validated).** The two `spec` producers now live under **`plugin/skills/`** (FAFF-121 relocation) — paths corrected below. `faffidavit-spec` no longer exists (FAFF-109); the readiness *contract* is unaffected by extra producer prose either way, so the core premise holds.

## 1. WHY

**Problem.** Today Given-When-Then appears only for holdouts; the main spec objectives are prose, leaving a gap between "what we want" and "how we'll know." Expressing main objectives as scenarios collapses that gap. The change lives in the `spec` producers' output format (`faffter-noon-spec`, `faffter-dark-nlspec`), not the readiness contract.

**Design principles:**

**Contract-compatible, producer-local.** The fixed spec-readiness contract — markers, confidence line, provenance, verified by `faff contract spec-readiness` (the post-FAFF-109 model: producers emit a `faff-contract:spec-readiness` block, the consumer parses it) — is **unchanged**. This is a producer output-format addition only; scenarios are extra prose the contract neither parses nor requires. Any change that touches the readiness contract is out of scope (would be breaking).

**Skimmable, not bloat.** Specs must stay skimmable (house rule). BDD for *every* objective risks doubling spec length — the integration must be proportionate.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-spec/SKILL.md` · `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown (prose contract) | The producers whose output format gains main-objective scenarios |
| `faff contract spec-readiness` (`plugin/skills/faff/bin/faff`) | Node, zero-dep | The readiness contract — must stay unaffected; validate via its `--selftest` |

**Scope.** First slice under Verifiable delivery; a producer-format change.

## 2. OUT OF SCOPE

- **Changing the spec-readiness contract** — markers/confidence/provenance and `faff contract spec-readiness` unchanged.
- **Holdout BDD** — already exists; this extends to main objectives.
- **A test runner for the scenarios** — scenarios are spec prose, not executable here (executable BDD is a separate, larger idea).

## 3. WHAT

**The format addition** — both `spec` producers emit Given-When-Then for the spec's **main objectives** (the WHAT/HOW requirements), alongside the existing prose, so each objective has a born-verifiable scenario.

**Design decisions:**

**Where do main-objective scenarios live in the arc? — Chosen (resolves former Punt, human decision 2026-06-12): a new `## Scenarios` section.** Not woven inline per objective, not folded into DONE. A dedicated section keeps the WHAT prose and the DONE checklist intact and gives scenarios one skimmable home. Rationale: inline-per-objective bloats the WHAT and fights skimmability; folding into DONE couples the checklist to BDD and risks restating it (the anti-pattern below).

**Always-on vs proportionate — Chosen (resolves former Punt, human decision 2026-06-12): proportionate.** Main-objective Given-When-Then is emitted only for objectives **above a complexity bar**, not for every objective on every spec. Rationale: the house skimmability rule outranks blanket consistency; trivial objectives gain nothing from a scenario and cost length. The producer judges the bar (a non-trivial behavioural objective with a non-obvious observable outcome).

**Both producers or the lite default first? — Chosen:** apply to **both** `faffter-noon-spec` and `faffter-dark-nlspec` so the format is consistent across the `spec` slot's occupants; the heavy producer already has the structural room, the lite one needs the most care for bloat (the proportionate bar matters most there).

**Contract compatibility — Chosen:** no readiness-contract change — scenarios are additional producer prose; the `faff-contract:spec-readiness` block and `faff contract spec-readiness` are unaffected.

## 4. HOW

Both producers' output-format sections gain a `## Scenarios` step: for each main objective **above the complexity bar**, render

```
Given <precondition>
When <the change/action>
Then <the observable, testable outcome>
```

in a dedicated `## Scenarios` section, so a reader sees objectives and their verification together without inflating WHAT or DONE.

**Anti-pattern:** duplicating the DONE checklist as GWT. Why: DONE already mirrors the body; scenarios should sharpen the WHAT's main objectives, not restate DONE. (The new-section + complexity-bar choices exist precisely to avoid this.)

## 5. DESIGN DECISION RATIONALE

**Producer-format, not contract.** **Chosen:** keeping it producer-local means it composes with the existing `faff contract spec-readiness` flow and doesn't ripple into graft/tidy's contract reads.

**New section + proportionate** — **Chosen** (§3): a dedicated `## Scenarios` section confined to above-bar objectives is the placement+coverage combination that keeps specs skimmable while making non-trivial objectives born-verifiable. The rejected alternatives (inline-always-on, fold-into-DONE) both pressure skimmability or duplicate DONE.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** None — both former Punts are resolved (placement = new `## Scenarios` section; coverage = proportionate complexity bar).

**Assumptions:**
- **Assumes:** the spec-readiness contract does not parse or require objective-scenarios (confirmed — `faff contract spec-readiness` checks markers/confidence/provenance only). Validate: `faff contract spec-readiness --selftest` unaffected by added producer prose.
- **Assumes:** the producers live at `plugin/skills/faffter-noon-spec/` and `plugin/skills/faffter-dark-nlspec/` (post-FAFF-121). Validate at build: confirm the paths before editing.

## 7. DONE

### From WHAT
- [ ] Both `spec` producers' output-format sections document emitting a `## Scenarios` section of Given-When-Then for main objectives above a complexity bar (proportionate, not always-on).
- [ ] The spec-readiness contract is unchanged; `faff validate-adapters` + `faff contract spec-readiness --selftest` still pass.

### From HOW
- [ ] A produced spec shows above-bar main objectives with paired Given-When-Then in a `## Scenarios` section, without duplicating the DONE checklist.
- [ ] Specs stay skimmable (no wholesale length doubling); trivial objectives get no scenario.

**Integration smoke test:**
```
Produce a spec via each producer → above-bar main objectives carry GWT in a ## Scenarios section;
trivial objectives don't; validate-adapters PASS; faff contract spec-readiness --selftest PASS
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
