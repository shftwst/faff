# Default landing for new work = pure backlog, no project (agile lens)

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Build spec for FAFF-293.

The deliverable is **prose-only** — three `SKILL.md` surfaces and nothing else (no new CLI subcommand, contract block, or eval seam).

## 1. WHY — Problem and Principles

**The load-bearing model:** *appetite is the topology-write-authority dial, and the default-landing rule is its matched-pair legibility-preserver.* The gateway already defines that dial (gateway → **Appetite for destruction → Topology-write authority**): as appetite rises, the methodology gains more power to reorganise the tracker's shape. The dial already names its own counterweight — "new work lands in plain backlog, never auto-filed into a project" — because a predictable, human-owned inflow keeps the control plane legible. This change is the operative rule that **realises** that counterweight in the capture path; it references the dial, it does not redefine it.

**Problem.** New work currently lands inside a project at capture time, so non-spine scope accretes into whatever project is handy while real blockers linger elsewhere. Under the agile lens the default home for an unsequenced ticket should instead be **pure Backlog, no project**, with sequencing into an outcome-led project deferred to a later explicit step.

**Design principles.**
- **Methodology owns the opinion (configurable-not-opinionated).** "Where new work lands" is a topology opinion, so it belongs to the configured `methodology` slot. The rule fires **only** under the agile lens. The thematic default is unchanged.
- **Reference, don't redefine.** The gateway dial is the single definitional home; new prose states the operative rule forward and anchors to that dial by within-prose anchor.
- **Self-contained prose.** The edited surfaces carry **no** external `FAFF-NN` / `ADR NNNN` references — meaning inlined; within-prose anchors only.

## 2. OUT OF SCOPE
- Redefining/extending the Topology-write authority dial.
- The thematic default's landing behaviour.
- Greenfield project kickoff (explicit human project-creation gesture).
- The sibling topology-write grants (reparent / rehome / convert).
- A new `faff` subcommand / contract block / config key.
- Re-homing already-landed tickets out of inflated projects.

## 3. WHAT — the rule

> Under the agile methodology lens, newly captured work defaults to **project-less Backlog**. Sequencing it into an outcome-led project is a later explicit step (tidy / plot / methodology), never a capture-time default. The explicit new-project path stays available as a deliberate human/plot choice. Greenfield project kickoff is exempt.

**Appetite mapping (mirrors the dial; does not restate it).**

| Appetite | Default-landing behaviour under the agile lens |
|---|---|
| `low` | Surface the recommendation only — zero topology writes; the human places the ticket. |
| `medium` and up | Apply the default — new captured work is created project-less in Backlog (the dial's named low-judgement op). |

**Mechanism.** jot acts on whichever shape the methodology's `ticket-shaping` returns — a proposed container ⇒ confirm-and-create as today; none ⇒ project-less Backlog (skip `prdr-author`). jot never branches on the methodology's name; the opinion lives in the lens. prdr-author is unchanged — it already fires only when a project container is created, so the no-project default simply never triggers it (matching the existing flat-set carve-out).

## 4. HOW — three coordinated prose edits

- **Gateway (`plugin/skills/faff/SKILL.md`).** The `ticket-shaping` contract row states the operative methodology-gated default-landing rule (the `container` field is the landing decision; agile ⇒ project-less Backlog; thematic ⇒ unaffected), anchored to the **Appetite for destruction → Topology-write authority** dial. The dial's table/guardrails are not restated. (Folded into the existing contract row to respect the gateway's hard line cap.)
- **faff-jot (`plugin/skills/faff-jot/SKILL.md`).** The single-item intro and a Step-4 "Default landing" note: jot acts on the shaped container (none ⇒ project-less Backlog, skip prdr-author; a container ⇒ confirm-and-create), the "under new project" path stays as the deliberate opt-in branch, greenfield exempt, no branching on methodology name.
- **Agile lens (`faffter-dark-methodology-agile-delivery/SKILL.md`).** A distinct, additive subsection states the ticket-shaping default-landing opinion (project-less Backlog; outcome project only when sequencable-now) tied to the lens's appetite integration. Does not touch the reparent/rehome prose.

## 5. SCENARIOS — born-verifiable objectives

```
Given the agile lens and appetite medium-or-high
When faff-jot captures a single-item feature/bug/idea (non-greenfield)
Then the ticket is created in Backlog with no project
And the "under new project" path remains offered as a deliberate, non-default choice
```
```
Given the thematic default is configured
When faff-jot captures a single-item ticket
Then landing behaviour is unchanged (workstream/project home as before)
```
```
Given the agile lens and appetite low
When new work is captured
Then no topology write occurs — the no-project-Backlog landing is surfaced as a recommendation only
```

Non-functional assertions:
```
ASSERT new prose in gateway, faff-jot, agile-lens SKILL.md carries no external FAFF-NN or ADR-NNNN reference
ASSERT no surface restates the Topology-write authority dial's table / guardrails / invariants
ASSERT the change adds no faff subcommand, contract block, config key, or eval seam
```

## 8. DONE

- [x] Agile-lens default landing for newly captured work is project-less Backlog; prose states it forward and anchors to the dial (no duplication).
- [x] Methodology-gated: fires only under the agile lens; thematic default unchanged (thematic-lens prose untouched).
- [x] Appetite mapping present: `low` surfaces only; `medium`-and-up applies the default.
- [x] Gateway: concise operative statement, within-prose anchor to the dial; dial table not restated.
- [x] faff-jot: single-item + discovered-scope default no-project Backlog under agile; explicit new-project path available; greenfield exempt; prdr-author unchanged.
- [x] Agile lens: distinct additive subsection tied to appetite integration, reparent/rehome prose untouched.
- [x] No external FAFF-NN / ADR-NNNN refs in added prose; within-prose anchors only.
- [x] No `faff` subcommand, contract block, config key, or eval seam — prose-only across three SKILL.md files.
- [x] `faff validate-adapters` passes; `faff lint-refs` exit 0; full `node --test` suite green.

confidence: high
