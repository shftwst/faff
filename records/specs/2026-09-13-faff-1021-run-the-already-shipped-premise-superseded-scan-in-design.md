# Run the already-shipped / premise-superseded scan in interactive prep, not just autonomous

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1021.

This spec is for the build agent and human reviewers of faff-prep. It extends faff-prep's existing shared premise-scan safety so it also fires on the interactive fresh-prep path (Scenario A), with a human-confirm disposition in place of the autonomous auto-park. It is a prose change to a single skill file — `plugin/skills/faff-prep/SKILL.md` — not a code change.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff-prep already owns one mechanical premise safety — the "already-shipped scan + premise-superseded gate" shared subroutine: extract the work's surface area, query Done sibling tickets against it, and route the premise down park / narrow / proceed. That subroutine is a shared block invoked from two call sites (autonomous Path 1 and Path 2). This ticket adds a **third call site** — interactive Scenario A — reusing the same subroutine, changing only *when* it runs and *how its result is dispositioned*. No new scanner is written.

**Problem statement.** The scan is invoked only by the two autonomous paths; interactive Scenario A (explore → spec → spec-review) has no premise check. A human-driven prep can therefore elaborate a full spec whose premise is already delivered by Done siblings, burning a spec-production and spec-review cycle before build finally catches it. This change closes that gap so interactive prep catches a superseded premise before it spends the spec.

**Design principles.**

- **Reuse, never fork.** The mechanical name-proximity + Done-query backstop must be the *existing* shared subroutine invoked from a new site — not a second scanner. A second scanner would drift from the autonomous one and defeat the "one mechanical backstop that does not depend on a lucky explore grep" intent (the FAFF-1020 incident's explore grep was case-sensitive and missed `autoDeclareMergeEffects`).
- **Surface, don't settle.** Interactive disposition follows the gateway's *Interactive park resolution (surface, don't settle)* rule: prep surfaces the finding and a recommendation; the human authors the call. Prep never auto-parks and never auto-closes on the interactive path.
- **No friction on the common path.** The overwhelmingly common case is a premise that still holds. That case must proceed with no added prompt and no gate — the scan is a cheap recall-biased query, its result silent unless it finds something.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-prep/SKILL.md` → `### Shared subroutine: already-shipped scan + premise-superseded gate` | Skill prose | The subroutine being reused; defines the scan's four steps + the substantial/partial/none gate |
| `plugin/skills/faff-prep/SKILL.md` → `### Scenario A: Fresh prep` | Skill prose | The interactive path gaining the new call site; today Step 1 explore → Step 1b architecture → Step 2 spec → spec-review |
| `plugin/skills/faff-prep/SKILL.md` → Autonomous `### Path 1` / `### Path 2` | Skill prose | The two existing call sites; their auto-park disposition must stay unchanged |
| `plugin/skills/faff-graft/SKILL.md` → Build-time premise-superseded gate | Skill prose | The build-time twin (main-verified, auto-close); prep's gate stays the pre-admission, tracker-heuristic, human-gated counterpart |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | The CI lint over SKILL.md prose (line caps, stray markers, duplicated blocks) the edit must still pass |

**Scope statement.** This sits entirely inside faff-prep's Scenario A control flow; it adds one invocation of an existing subroutine and its interactive result-handling, nothing outside the skill file.

## 2. OUT OF SCOPE

- **A new/forked scanner or any change to the scan's mechanics.** Why excluded: the ticket's explicit constraint is to reuse the shared subroutine. Extension point: the subroutine at `### Shared subroutine: already-shipped scan + premise-superseded gate` if the scan's *mechanics* ever need to change — but that would change all three sites at once, by design.
- **Any change to autonomous Path 1 / Path 2 disposition.** Why excluded: the ticket requires autonomous behaviour to stay unchanged. Extension point: the Path 1 / Path 2 sections, untouched by this work.
- **Auto-closing / auto-cancelling a superseded interactive ticket.** Why excluded: cancellation is human-gated (appetite hard floor; interactive park resolution). The human authors the scrap; prep may execute the state move only on explicit confirm. Extension point: the build-time gate in faff-graft already owns the main-verified *auto*-close path.
- **A `faff` CLI subcommand for the scan.** Why excluded: the scan is agent-driven tracker heuristic, not a deterministic pure function; no CLI surface is added. Extension point: none planned.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Premise scan | The shared "already-shipped scan + premise-superseded gate" subroutine |
| Superseded premise | An issue whose stated motivation is substantially delivered by Done sibling tickets |
| Interactive disposition | The surface-and-confirm handling of a scan result on the interactive path, in place of the autonomous auto-park |

**The change is prose-only.** There are no types, endpoints, or config keys. The "interface" is the structure of the Scenario A section after the edit:

```
Scenario A: Fresh prep
  Step 1   Explore (subagent)
  Step 1b  Architecture proposal (conditional)
  Step 1c  Premise scan (NEW) — invoke the shared subroutine; interactive disposition
  Step 2   Spec (delegated to the spec slot) — carries the scan's findings section
  ...      Spec-review gate → promote
```

**Design decision — placement.** The ticket offers two placements (before spec, or after spec / before spec-review) and says pick one.

- *Before spec (new Step 1c, after Step 1b):* cheapest — skips spec production entirely on a superseded premise, which is the exact cost the motivating incident (FAFF-1020) burned. Requires the scan's surface source to be the issue + explore findings rather than a produced spec.
- *After spec, before spec-review:* reuses the subroutine's "candidate spec" input verbatim, but pays full spec production even when the premise is dead.

**Chosen:** before spec, as a new Step 1c immediately after Step 1b. Rationale: it directly targets the cost the ticket exists to save (a stale-premise spec never gets elaborated), and it mirrors autonomous Path 1's scan-before-production ordering. The surface-source substitution below keeps it a reuse, not a fork.

**Design decision — surface source pre-spec.** The subroutine's step 1 extracts surface-area signals "from the candidate spec and the issue". At the Step-1c point there is no spec yet.

**Chosen:** substitute the **explore findings + issue** (title, description, ACs) for "the candidate spec" as the surface source; steps 2–4 of the scan (Done-ticket query, one-line summaries, findings) run unchanged. This is a documented input substitution at the call site, not a new scanner — the recall-biased scan tolerates the slightly-less-structured surface, and the explore step already reports "files/modules involved".

**Design decision — where the findings go pre-spec.** The subroutine emits findings "under a new section `## Already shipped against this surface` in the candidate spec"; pre-spec there is no spec to write into.

**Chosen:** the Step-1c scan surfaces its findings to the human interactively, and — on `proceed` or `narrow` — passes them to the Step-2 producer so the produced spec still carries the `## Already shipped against this surface` section (the builder still sees what is already done). The section's reuse is preserved; only its authorship moves one step earlier.

## 4. HOW — Behaviour

**Architecture.** Add one new step to Scenario A and one interactive-disposition wrapper around the shared subroutine's three-way result. The subroutine itself is edited only to note (one line) that its surface source and disposition are supplied by the caller, so the interactive site can feed explore-findings + issue and apply the confirm-disposition without duplicating scan prose.

```
PROCEDURE scenario_a_step_1c_premise_scan(issue, explore_findings):
  1. Invoke the shared already-shipped-scan subroutine with:
       surface_source := explore_findings + issue   # no spec exists yet
  2. Read the subroutine's gate outcome: substantially | partially | none.
  3. IF none (premise holds):
     a. Proceed to Step 2 with NO prompt and NO gate.       # common-path, zero friction
     b. Carry any related-but-not-superseding findings forward so Step 2's
        spec can still emit the `## Already shipped against this surface` section.
  4. IF substantially delivered:
     a. Surface the finding to the human: the matched surface area + at least
        one cited Done ticket ID, plus a recommendation.
     b. Require an EXPLICIT human choice (surviving OFFER gate): scrap / narrow / proceed.
        - scrap   -> stop prep (no spec produced); on the human's explicit confirm,
                     close the issue as superseded (cancelled/duplicate), citing the
                     Done tickets. Never auto-close without the confirm.
        - narrow  -> continue to Step 2 on the narrowed scope; carry the findings
                     section forward.
        - proceed -> continue to Step 2 unchanged; carry the findings forward.
  5. IF partially delivered:
     a. Surface the finding + cited Done IDs + a narrow-to-the-delta recommendation.
     b. Require an explicit human choice: narrow / proceed / scrap (same actions as 4b).
```

**Behaviour summary.** On the interactive path the premise scan runs once, before any spec is produced; a live premise proceeds silently, a superseded or partial premise surfaces the evidence and hands the call to the human.

**Anti-pattern:** writing a second scan implementation inside Scenario A. Why: it would drift from the autonomous scan and reintroduce the single-grep fragility this ticket exists to remove — invoke the shared subroutine.

**Anti-pattern:** auto-parking or auto-closing on the interactive path. Why: interactive disposition is surface-and-confirm; the human authors the scrap/narrow/proceed call (gateway → Interactive park resolution).

**Anti-pattern:** prompting on a premise that still holds. Why: the common path must stay frictionless; the gate fires only on a substantial or partial finding.

**Failure modes.**

- **The failure:** the surface-source substitution (explore findings instead of a spec) yields weaker signals, so a real supersession is missed pre-spec. **How you'd know:** a spec is elaborated whose premise the *autonomous* scan (or the build-time gate) later flags as superseded on the same tickets. **What it means:** proceed — the scan is recall-biased and the build-time gate remains the fail-closed backstop; a miss here is no worse than today's behaviour (no interactive scan at all).
- **The failure:** the new gate adds friction to the common live-premise path. **How you'd know:** interactive prep prompts on issues with no matched Done tickets. **What it means:** a defect — the `none` branch must proceed with no prompt; the scenario below asserts it.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an interactive `/faff-prep` on a Backlog issue with no existing spec
  And Done sibling tickets already deliver the issue's stated premise
When Scenario A reaches the new premise-scan step (before spec production)
Then prep surfaces the matched surface area and at least one cited Done ticket ID
  And requires an explicit human choice of scrap / narrow / proceed
  And produces no spec and auto-parks nothing until the human chooses
```

```
Given an interactive `/faff-prep` on an issue whose premise is only partially delivered
When the premise scan runs
Then prep surfaces the finding with cited Done tickets
  And offers narrow-to-the-delta as a choice alongside proceed and scrap
```

- The premise scan on all three interactive outcomes invokes the *same* shared subroutine as autonomous Path 1 / Path 2 — no second scanner definition exists in the skill file.
- Autonomous Path 1 and Path 2 continue to auto-park a substantially-delivered premise, unchanged by this work.

## 5. DESIGN DECISION RATIONALE

**Where should the interactive scan run?** Options: before spec (Step 1c) vs after spec / before spec-review. Before-spec is cheaper and matches Path 1 ordering; after-spec reuses the "candidate spec" input with no substitution but pays full spec cost on a dead premise. **Chosen:** before spec (Step 1c) — the cost it saves is exactly the cost the ticket was filed to stop burning.

**What is the surface source when no spec exists yet?** Options: run the explore-findings + issue through the existing extraction, or defer the scan until a spec exists. **Chosen:** explore findings + issue as the surface source — a documented call-site substitution that keeps the scan a single shared subroutine.

**Auto-park (as autonomous) or human-confirm?** **Chosen:** human-confirm (scrap / narrow / proceed) — interactive prep has a human present and the gateway forbids the agent settling a scope call; auto-park is an autonomous-only disposition.

**Does the produced spec still carry the findings section?** **Chosen:** yes — on proceed/narrow the pre-spec findings are handed to the producer so the spec keeps its `## Already shipped against this surface` section for the builder.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the ticket delegated the placement choice to prep ("pick one"), which this spec closes with rationale above; no product/architecture question is left open.

**Assumptions.**

- **Assumes:** the shared subroutine `### Shared subroutine: already-shipped scan + premise-superseded gate` exists in `plugin/skills/faff-prep/SKILL.md` with its four-step scan and three-way (substantial/partial/none) gate. *Validation:* grep the heading in the file before editing — it is present today (verified during prep).
- **Assumes:** `faff validate-adapters` is the CI lint over SKILL.md prose. *Validation:* run `faff validate-adapters` after the edit and confirm it passes.

## 7. DONE — Definition of Done

### From WHY
- [ ] Interactive Scenario A runs the premise scan; a superseded-premise interactive prep no longer silently elaborates a full spec.

### From WHAT (structure)
- [ ] `plugin/skills/faff-prep/SKILL.md` Scenario A gains a premise-scan step placed **before** spec production (Step 2), after the architecture-proposal step.
- [ ] The step invokes the existing shared subroutine; no second scanner is added (the file still contains exactly one `### Shared subroutine: already-shipped scan` definition).
- [ ] The subroutine / call site documents that the interactive surface source is explore findings + issue (no spec yet).

### From HOW (behaviour)
- [ ] On a substantially-delivered premise, interactive prep surfaces the matched surface + at least one cited Done ticket ID and requires an explicit human choice (scrap / narrow / proceed) — no silent elaboration, no auto-park, no auto-close.
- [ ] On a partially-delivered premise, interactive prep offers narrow-to-the-delta.
- [ ] On an unrelated premise, interactive prep proceeds with no added prompt and no gate.
- [ ] On proceed/narrow, the produced spec still carries the `## Already shipped against this surface` findings section.

### From HOW (invariants)
- [ ] Autonomous Path 1 and Path 2 auto-park behaviour is unchanged (diff touches Scenario A + a shared-subroutine note only, not the Path 1/Path 2 dispositions).
- [ ] `faff validate-adapters` passes on the edited skill file.

**Integration smoke test:**
```
1. grep the Scenario A section -> a premise-scan step appears before "Step 2: Spec".
2. grep the file -> exactly one "### Shared subroutine: already-shipped scan" heading.
3. run `faff validate-adapters` -> exit 0.
```

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery — issue-critique.*

- **Right-sized?** Yes. A single 1–3 day unit: one prose edit to `plugin/skills/faff-prep/SKILL.md` (a new Scenario A step + a one-line subroutine note). One concern, no independent second concern to split out, no always-ships-together sibling to merge.
- **Workstream fit?** Yes. A prep-stage safety improvement cohesive with the faff-prep pipeline; the same premise-scan family as the autonomous paths and the build-time gate.
- **Deps surfaced?** Clear. The shared subroutine it reuses already exists (dependency satisfied); related tickets FAFF-1012 (Done) and FAFF-1020 (Cancelled, premise-superseded) are the motivating evidence, not blockers. No implicit unlinked dependency.
- **Risk profile?** Low. Reuses an existing subroutine rather than adding a new mechanism; the build-time premise gate remains the fail-closed backstop, so a pre-spec miss is no worse than today. No novel integration or external dependency — no de-risking spike warranted.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
