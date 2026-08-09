# Spec — Invert automation eligibility to fail-safe opt-in (`faff-automate`), configurable default

> _Spec · producer: faffter-dark-nlspec · adaptor: faffidavit-spec · 2026-06-10 · mode: interactive · confidence: high_

_Revised 2026-06-10 — resolved the shipped-default Punt to **opt-in** (human decision); confidence medium → high._

This spec is for the build agent and human reviewers. It inverts faff's autonomous-pipeline eligibility from opt-out to a configurable, fail-safe-by-default model, touching the gateway contract, the four pipeline skills, the bundled CLI, the control-label manifest, and `/faff-jot`'s ticket interactor.

## 1. WHY — Problem and Principles

**Problem statement.** Today eligibility is **opt-out**: every ticket is automatable unless a human adds `faff-automation-hold`. A human who files a ticket and forgets the label has silently made it eligible for autonomous spec/build — a mistake that fails *toward acting*. The safe posture is opt-in: a forgotten label means "left alone."

**Design principles.**

- **Fail-safe over fail-dangerous.** The default for an *unlabelled* ticket must be the safe one — a missing label can never escalate a ticket into autonomous action. Any implementation where label-absence can mean "automatable" under the shipped default is wrong.
- **Configurable, not opinionated.** The posture is a `.faffrc` knob with a safe shipped default, not a hard-coded stance — mirrors the existing `appetite` dial.
- **Atomic inversion.** A half-applied inversion (some chokepoints check `held`, others `automate`) leaves the pipeline disagreeing with itself about eligibility — strictly more dangerous than either consistent model. The core inversion lands as one atomic change.
- **Single source of truth.** Eligibility is one gateway contract every chokepoint refers back to.

## 2. OUT OF SCOPE

- **Per-ticket reason capture for `faff-automate`** — FAFF-19's concern.
- **Bulk migration tooling** — the inversion is backward-compatible without it (§5).
- **Renaming `faff-automation-hold`** — it keeps its name + hard-exclude meaning.
- **The `/faff-jot` promote/demote rename** — split to FAFF-98 to keep the core atomic; HOW still documents the target behaviour.
- **Test-harnessing the prose-skill chokepoints** — the separate FAFF-88→97 initiative.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| automation-eligible | A ticket the **autonomous** pipeline may spec / promote / build. Read-only skills are never gated. |
| `faff-automate` | New control label: explicit **include**. |
| `faff-automation-hold` | Existing label: explicit **exclude** (hard stop) — retained. |
| `automation_default` | `.faffrc` knob for an **unlabelled** ticket. Ships **opt-in**. |

```
ENUM AutomationDefault: "opt-in" | "opt-out"   DEFAULT "opt-in"

FUNCTION automation_eligible(labels, default) -> Bool:
  IF "faff-automation-hold" IN labels: RETURN false   # hard exclude wins
  IF "faff-automate"        IN labels: RETURN true    # explicit include
  RETURN (default == "opt-out")                       # unlabelled ⇒ knob
```

**Chosen:** precedence hold > automate > default — both labels coexist.
**Chosen:** configurable knob (`faff config get automation_default -d opt-in`), not a hard invert.
**Chosen:** gateway contract (rewrite §"Automation hold" → §"Automation eligibility"), not per-skill.

**CLI surface.**

```
faff next --status <S> --spec <C> [--eligible|--not-eligible] [--parked] [--blocked]
  # replaces --held. nextStep(): if (!eligible) return ["skip-ineligible", ...]
faff labels [--names]          # CONTROL_LABELS gains faff-automate; hold retained
faff config get automation_default -d opt-in
```

## 4. HOW — Behavior

Each autonomous chokepoint asks "is it automation-eligible?" (computed from the two labels + resolved `automation_default`) instead of "is it held?". Interactive paths stay ungated (warn + proceed, never auto-bless).

- **prep:** ineligible ⇒ skip spec/promote (was `held`).
- **tidy:** ineligible ⇒ exclude from Ready; "Not automation-eligible" bucket; skip mutation.
- **graft:** ineligible ⇒ refuse to build, return skip.
- **beep-boop:** ineligible ⇒ skip at queue assembly; `ineligible` disposition; wave filter.

**Anti-pattern:** checking `faff-automate` while ignoring `faff-automation-hold` — drops the hard-exclude.
**Anti-pattern:** landing the CLI/gateway change without all four chokepoints in the same change — half-inverted pipeline is fail-dangerous.

**Release / blessing (jot, tidy — target behaviour; jot rename split to FAFF-98).** freeze/thaw → promote/demote over `faff-automate`; the hold add/remove remains the hard-stop control.

**Migration — Chosen: none.** Under shipped opt-in, existing `faff-automation-hold` tickets are already ineligible (unlabelled-for-automate), so the holds are redundant-but-harmless hard stops; they keep working. `automation_default: opt-out` restores today's behaviour exactly.

**Edge cases.** Both labels ⇒ ineligible (hold wins). Unset knob ⇒ opt-in via `-d`. Invalid value ⇒ anything ≠ `"opt-out"` treated as opt-in (fail-safe coercion).

## 5. DESIGN DECISION RATIONALE

- **Hard invert vs configurable?** **Chosen:** configurable (configurable-not-opinionated tenet).
- **Do both labels coexist?** **Chosen:** yes, hold > automate > default.
- **Shipped default — opt-in vs opt-out?** **Chosen: opt-in** (human, 2026-06-10) — fail-safe is the whole point; ship as a deliberate breaking change with `automation_default: opt-out` as the documented restore-old-behaviour escape hatch.
- **Encoding?** **Chosen:** gateway contract (single source).
- **Migration?** **Chosen:** none (backward-compatible).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — shipped-default resolved to opt-in (2026-06-10).

**Assumptions.**
- **Assumes:** FAFF-47 manifest + ensure-before-tag is shipped/usable for adding `faff-automate`. *Validate:* `faff labels --names` lists the four control labels.
- **Assumes:** `faff config get <key> -d <default>` is the live read path. *Validate:* `faff config get appetite -d high` returns a value.

## 7. DONE — Definition of Done

### From WHY
- [ ] Unset `automation_default` (ships opt-in) ⇒ an unlabelled ticket is **not** eligible (`faff next` ⇒ `skip-ineligible`).
- [ ] `automation_default: opt-out` ⇒ unlabelled eligible again (legacy restored).
- [ ] Release notes call out opt-in as a deliberate breaking change + the opt-out escape hatch.

### From WHAT (types + CLI)
- [ ] `automation_eligible()` implements hold > automate > default — covered by `faff next --selftest`: hold-only⇒ineligible; automate-only⇒eligible; both⇒ineligible; neither+opt-in⇒ineligible; neither+opt-out⇒eligible.
- [ ] `faff labels --names` includes `faff-automate`; `faff-automation-hold` still listed.
- [ ] `faff config get automation_default -d opt-in` ⇒ `opt-in` when unset.
- [ ] `faff next` accepts the eligibility flag in place of `--held`; selftest + usage updated.

### From HOW (chokepoints)
- [ ] All four chokepoints (prep, tidy, graft, beep-boop) gate on eligibility, in the **same** change — no surviving hold-only autonomous gate.
- [ ] Gateway §"Automation hold" rewritten to §"Automation eligibility"; the four skills refer back to it.
- [ ] Interactive prep/graft remain ungated.

### From HOW (edge cases + migration)
- [ ] Both-labels ⇒ ineligible (selftest). Invalid value ⇒ opt-in coercion (selftest). Existing held tickets need no migration.

### Validation backstop
- [ ] `faff validate-adapters` and the full CLI `--selftest` pass; `faff next --selftest` covers every truth-table row.

**Integration smoke test.**
```
GIVEN automation_default unset (⇒ opt-in)
  faff next --status todo --spec high                 ⇒ skip-ineligible
  faff next --status todo --spec high --eligible      ⇒ graft
WITH automation_default: opt-out
  faff next --status todo --spec high                 ⇒ graft
```

## Methodology critique (faffter-dark-methodology-agile-delivery)

- **Right-sized (P4):** big; core inversion stays atomic, jot rename split to FAFF-98.
- **Workstream fit (P1+P5):** clean (Configurability & contract framework).
- **Deps (P6):** FAFF-47 + appetite pattern shipped; captured as Assumes.
- **Risk (P7):** high blast radius; de-risk via `faff next --selftest` truth table first.

confidence: high
