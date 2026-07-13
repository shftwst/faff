# Spec — FAFF-432: Sweep README + architecture.md L4 staleness so every doc agrees lights-out shipped

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-432.

This spec is for the build agent (and human reviewers). It scopes a **documentation-consistency sweep**: three docs currently give three different answers on whether the L4 (lights-out) rung exists. `faff lights-out` is shipped — its surface is documented in `docs/guide/unattended.md:36–48` — yet `README.md` and `docs/guide/architecture.md` still describe L4 / the evaluator lane as unbuilt. This change makes both stale docs agree with `unattended.md` and with the shipped CLI. No code, tests, or behaviour change — prose only.

## 1. WHY — Problem and Principles

**The load-bearing model:** these docs are *claims about what exists*, and one shipped surface (`faff lights-out` + the code-blind holdout evaluator) has three contradictory descriptions across the doc set. Consistency here is a factual-accuracy fix, not an editorial preference.

**Problem statement.** `README.md:31` says L4 is "the frontier … Not built yet" and `docs/guide/architecture.md:11` says "the evaluator lane is a documented-but-future L4 capability" — both contradict `docs/guide/unattended.md:36–48`, which documents the shipped `faff lights-out` entry point (fail-closed preflight, L4 run-ledger mint, code-blind holdout verdict gating the merge). Three docs, three answers, on the ladder's top rung. This is a staleness defect: docs never "go stale" on their own, so the contradiction reads as either "L4 is vapourware" or "the docs are unreliable" — both cost credibility on the upper half of the ladder, and an autonomous reader keying a decision off "L4 isn't real yet" would be wrong.

**Design principles.**

- **`docs/guide/unattended.md:36–48` is the authoritative description of the shipped L4 surface** — this sweep aligns the other two docs *to it*, it does not re-adjudicate what shipped. Where wording must be chosen, match `unattended.md`'s framing (lights-out as the shipped L3→L4 entry point held up by adversarial review + code-blind holdout).
- **Do not overclaim.** The v1 lights-out surface is a *basic* fail-closed preflight; richer dial-coherence and the adversarial-promotion machinery are follow-ons. State that lights-out *shipped* without implying every enforcement leg is fully wired (e.g. `evaluator-preflight` is built-and-tested but not yet called from the live holdout dispatch — see `docs/guide/cli.md:39`). "Shipped, v1, with named follow-ons" is the accurate register — the same register FAFF-339 uses for the gateway.
- **Consistency-only, minimal churn.** Touch only the lines that assert L4 / the evaluator lane is unbuilt. Preserve each doc's existing structure, voice, and surrounding claims.

**Scope statement.** This is the README + guide half of the L4-framing correction; the gateway half is a separate, independently-landable peer (FAFF-339).

## 2. OUT OF SCOPE

- **The gateway's "L4 not built yet" framing (`plugin/skills/faff/SKILL.md`)** — FAFF-339's job. Peer, not blocker. This ticket must **not** edit `plugin/skills/faff/SKILL.md`.
- **`docs/guide/cli.md:39` (`evaluator-preflight` "ship-not-wire" note)** — factually correct; changing it would introduce a new inaccuracy.
- **`docs/adr/*` L4 entries** — ADRs are point-in-time history, not current-state claims; not retro-edited.
- **Any behavioural / CLI / test change** — prose sweep only.

## 3. WHAT — the edits

Four lines across two files assert L4 / the evaluator lane is unbuilt. Each must change to agree that `faff lights-out` (L4) shipped, in the "shipped v1 with follow-ons" register.

**`README.md`**

- **Line 25** — levels table L4 row, *Entry point* cell, currently `lights-out (frontier)`. Set the L4 *Entry point* cell to name `faff lights-out` (the shipped command) and drop the "(frontier)" not-yet connotation.
- **Line 31** — L4 narrative bullet, currently states lights-out is "the frontier … Not built yet." Rewrite so it states lights-out **shipped** — name `faff lights-out` as the single self-checking entry point that turns L3 into L4 — and delete "Not built yet." Preserve the "adversarial review + isolated holdout" description.

**`docs/guide/architecture.md`**

- **Line 9** — lanes table Evaluator row, *Lane* cell, currently `**Evaluator** *(future, L4)*`. Drop the `*(future, L4)*` "future" qualifier; label the lane as the L4 (lights-out) lane.
- **Line 11** — prose after the table. Remove "(once built)" and replace the "Today only the orchestrator and implementor lanes are active; the evaluator lane is a documented-but-future L4 capability" sentence with prose stating the evaluator lane is the L4 lights-out lane, active on the `faff lights-out` path. Keep the "isolation is by design / can't mark its own homework" point. **Do not** assert every enforcement leg is fully wired.

## 5. SCENARIOS — born-verifiable

```
grep -rniE "not built yet|documented-but-future|\(future, ?L4" README.md docs/guide/
# expect: no matches
```

All three docs (`README.md`, `docs/guide/architecture.md`, `docs/guide/unattended.md`) agree `faff lights-out` (L4) shipped; no doc claims L4/the evaluator lane is unbuilt or purely future; no overclaim against `cli.md:39`.

## 8. DONE

- [ ] README line 25: *Entry point* cell names `faff lights-out`, "(frontier)" removed.
- [ ] README line 31: states `faff lights-out` (L4) shipped; "Not built yet" gone.
- [ ] architecture.md line 9: "(future, L4)" gone; lane labelled L4 / lights-out.
- [ ] architecture.md line 11: "(once built)" and "documented-but-future L4 capability" gone; evaluator lane described as shipped L4 lights-out lane, without overclaiming full wiring.
- [ ] All three docs agree; no new contradiction against `cli.md:39`.
- [ ] Gateway, `cli.md:39`, `docs/adr/*` unmodified.

confidence: high
