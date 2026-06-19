# FAFF-179 — Gateway-body terseness pass (`faff/SKILL.md`)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-179.

Audience: the build agent performing the edit, and human reviewers gating the merge. This is a prose-refactor spec — the "build" is an edit to one markdown prompt file, verified by mechanical floor + a human judgement reverify.

## 1. WHY — Problem and Principles

**Problem statement.** The FAFF-114 audit named the gateway (`plugin/skills/faff/SKILL.md`, ~36.4k est tokens — ~26% of all faff-family prompt tokens) as the single densest cruft target, but FAFF-115 shipped preamble-only (gateway-restructure descoped) and FAFF-116 explicitly excluded the gateway ("FAFF-115 owns it"). The gateway body's cruft is therefore covered by **neither** ticket — an orphan. This pass closes it: drop the audit's DROP-classed `FAFF-NN` refs, collapse the over-repeated contract ids to one defining mention each, and finish the two paragraph→list conversions the audit flagged.

**Design principles.**

**Content-preserving, not content-changing.** This is a terseness pass, not a semantics pass. No rule, contract, threshold, precedence, or behavioural instruction may change meaning — only its provenance scaffolding and prose shape. Any edit that would alter what an agent *does* on reading the gateway is out of scope and must be rejected, even if it saves tokens.

**The frozen eval anchors are load-bearing strings, not prose.** Five anchors are sliced on byte-for-byte by `eval/cli-driver.mjs`. They are code-as-text. Do not reword, re-case, re-punctuate, or move text across the slice boundary.

**Tie-break KEEP (inherited from FAFF-114).** When a `FAFF-NN` ref's classification is ambiguous against the live file, retain it. False keeps cost a few tokens; false drops erase a load-bearing pointer.

**Reference context.**

| System | Type | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` | Markdown prompt | The sole file edited |
| `docs/audits/FAFF-114-skill-prompt-audit.md` | Audit doc | Keep/drop classification + tie-break rule |
| `eval/cli-driver.mjs` | Node (loaders) | `loadMarkerDialectProse` / `loadReviewVerdictProse` / `loadRoutingVerdictProse` slice the gateway on the 5 anchors |
| `eval/size-census.mjs` + `eval/baselines/prompt-size.json` | Node + JSON | chars/4 est-token gate; baseline re-stamped on merge |
| `test/eval-cli-driver.test.mjs` | Node test | Asserts each loader's START/END boundary resolves |

**Scope statement.** Third and densest link in the lean-prompts chain (FAFF-116 orchestration → FAFF-117 slot skills → **FAFF-179 gateway**); where the chain's real token mass lives.

## 2. OUT OF SCOPE

- **Any non-gateway skill file** — Why: FAFF-116/117 already passed over the orchestration + slot skills and shipped. Extension point: none; Done.
- **Restructuring the gateway into a single-source "home" (ToC, refer-back convention, section homes)** — Why: FAFF-115 deliberately descoped exactly this — the gateway is always loaded, so a `gateway → Section` pointer is authoring discipline, not a runtime lookup. Extension point: FAFF-120's `docs/skill-authoring.md` charter (not loaded at runtime).
- **Rewording/reflowing any of the 5 frozen anchors or the prose the loaders slice between** — Why: byte-for-byte load-bearing. Extension point: an anchor change moves in lockstep with `eval/cli-driver.mjs` + loader tests, under a dedicated ticket.
- **Changing rule semantics, contract shapes, thresholds, or precedence** — Why: content-preserving principle. Extension point: a behavioural ticket.
- **Dropping KEEP-classed refs** (FAFF-108, FAFF-82, FAFF-19, FAFF-80, FAFF-21, and the single defining mention of FAFF-109/81/22) — Why: active rule/contract names a reader must resolve.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| **DROP-classed ref** | A `FAFF-NN` inline ref the FAFF-114 audit classed as provenance/decision-record/background — no instruction a reader must resolve. |
| **KEEP-but-thin ref** | A live contract-id/mechanism name (FAFF-109, FAFF-81, FAFF-22) that should appear **once** at its defining mention; redundant parenthetical repeats dropped. |
| **Frozen anchor** | One of the 5 byte-for-byte strings `eval/cli-driver.mjs` slices on. |
| **Defining mention** | The single occurrence of a KEEP-but-thin id where the concept is introduced — the one kept. |

**The 5 frozen anchors (preserve byte-for-byte):**

```
### Spec readiness (fixed)
**The producer emits, the consumer parses.**
### Review verdict (fixed)
### Delivery outcome (fixed)
### Automation-routing verdict (fixed) → `routing_adaptor`
```

**The DROP set (live re-grep authoritative).** Audit-classed DROP ids present in the live gateway: FAFF-67, FAFF-98, FAFF-7, FAFF-61, FAFF-60, FAFF-50, FAFF-15, FAFF-8, FAFF-18, FAFF-48, FAFF-24, FAFF-110 (plus FAFF-5/1/23/153/147 if any survive). Each is dropped by **removing the parenthetical/clause that carries only the ref**, leaving the host sentence intact and grammatical.

**The COLLAPSE set.** FAFF-109 (≫1 occurrence), FAFF-81, FAFF-22 → reduce to one defining mention each; drop the rest.

**Design decision — what governs a borderline ref.**

- **Chosen:** the **live `grep` of the current file** is authoritative for what's present; the **audit's classification** is authoritative for keep/drop; on any ref the audit doesn't classify or that's ambiguous against live prose, **tie-break KEEP**. Rationale: the audit predates FAFF-116/117 cuts so counts drift, but its keep/drop *judgement* per id is stable and is the contract this ticket was filed against.

## 4. HOW — Behavior

**Approach.** A single-file, mechanical-but-judged edit pass. Work the file top to bottom in three concerns, then verify.

```
PROCEDURE gateway_terseness_pass:
  1. Snapshot the 5 frozen anchor strings (exact bytes) from the live file.
  2. DROP pass:
     a. For each DROP-classed FAFF-NN occurrence, remove only the ref-carrying
        parenthetical/clause; re-read the host sentence — it must still parse and
        mean the same thing.
     b. Never touch a KEEP-classed ref or a frozen-anchor line.
  3. COLLAPSE pass:
     a. For FAFF-109 / FAFF-81 / FAFF-22, keep the single defining mention; drop
        each redundant parenthetical repeat.
  4. PARAGRAPH->LIST pass (only the two audit-flagged sites):
     a. Configuration / CLI-only access rules.
     b. Automation-eligibility precedence (hard-exclude > include > default).
     Convert run-on prose to bullets; preserve every fact and the precedence order.
  5. VERIFY (see DONE): anchors byte-identical, loaders resolve, floor green,
     size-census shows a reduction, re-baseline.
```

**Behaviour summary.** The reader-facing *meaning* of the gateway is identical before and after; only dead provenance, redundant id-repeats, and two run-on paragraphs change.

**Edge cases.**

- **A DROP ref shares a sentence with a KEEP ref** → keep the sentence, excise only the DROP ref's clause. KEEP wins.
- **A FAFF-109 occurrence *is* the defining mention** (e.g. the line explaining the adaptor retirement / producer-emits-consumer-parses) → keep it; it may sit adjacent to a frozen anchor, so edit around the anchor, never through it.
- **Removing a parenthetical leaves doubled spaces / dangling punctuation** → fix the whitespace; part of the edit, not a separate concern.

**Anti-pattern:** rewording a rule to make it shorter. Why: that's a semantics pass; a changed instruction is a behavioural regression the deterministic floor may not catch (only the human judgement reverify would). Drop scaffolding and reshape lists — do not rewrite rules.

**Anti-pattern:** "tidying" a frozen anchor (its capitalisation, spacing, or the `→ routing_adaptor` suffix). Why: the loaders do an exact `indexOf`; a one-byte change throws `START anchor not found` and breaks 3 eval loaders.

## 5. Scenarios

```
Given the gateway has DROP-classed FAFF-NN provenance refs and redundant FAFF-109/81/22 repeats
When the terseness pass is applied
Then eval/size-census.mjs reports a net est-token reduction for plugin/skills/faff/SKILL.md against the recorded baseline
And no rule, contract, threshold, or precedence statement has changed meaning
```

```
Given eval/cli-driver.mjs slices the gateway on 5 byte-for-byte anchors
When the pass completes
Then loadMarkerDialectProse, loadReviewVerdictProse, and loadRoutingVerdictProse all resolve without throwing
And test/eval-cli-driver.test.mjs passes unchanged (each loader's START/END boundary still found, END anchor still excluded)
```

```
Given the gateway is the most behaviour-critical prompt in the suite
When the diff is prepared for merge
Then a human-run frontier judgement reverify is run or explicitly waived-with-rationale per the FAFF-180 smoke-or-waive gate
And the deterministic floor (validate-adapters + node --test + 8 selftests + 3 loaders + size-gate) is green in CI
```

Non-functional assertion: the edit touches exactly one skill file — `plugin/skills/faff/SKILL.md` — plus the re-stamped `eval/baselines/prompt-size.json`. No other skill file changes.

## 6. Design Decision Rationale

**How is the merge gated, given the gateway is behaviour-critical but the full frontier sweep is ~1k `claude -p` runs (FAFF-180)?**
- *Option A — full frontier sweep mandatory:* highest confidence; ~1k runs, disproportionate/impractical — the exact problem FAFF-180 raises.
- *Option B — deterministic floor only:* cheap, in-CI; but the floor tests **plumbing** (anchors resolve, selftests pass), not skill *judgement* — and this is the one prompt where judgement regressions matter most.
- *Option C — floor in CI (hard gate) + a human-run frontier judgement reverify as the merge gate, scoped smoke-or-waive per FAFF-180, full sweep recommended given gateway criticality.*
- **Chosen:** C. The deterministic floor is the automated hard gate; the judgement reverify is the human merge gate, and because the gateway is "doubly load-bearing" (issue's words) the recommendation leans toward at least a scoped smoke rather than a bare waive — operator owns the call, consistent with how FAFF-116/117 concluded.

**Is the audit's keep/drop list or the live file authoritative?**
- **Chosen:** live `grep` for presence/counts, audit for keep/drop judgement, tie-break KEEP for anything unclassified or ambiguous (see §3).

**Should the two paragraph→list conversions be in scope, or split to a follow-up?**
- **Chosen:** in scope. The audit flagged exactly two gateway sites (Configuration/CLI-only, Automation-eligibility precedence); small, local, same "skimmable" objective — splitting would be ceremony.

## 7. Open Questions and Assumptions

**Open Questions.** None. All decisions closed; the merge-gate decision is Chosen-C with an explicit operator call at merge time — a gate, not an open spec question.

**Assumptions.**

- **Assumes:** the FAFF-114 audit's per-id keep/drop classification still applies to the live gateway. *Validation:* before editing, `grep -n 'FAFF-[0-9]' plugin/skills/faff/SKILL.md` and reconcile each hit against the audit's DROP/KEEP lists; any id not in the audit → tie-break KEEP.
- **Assumes:** the 5 frozen anchors in the live file still match what `eval/cli-driver.mjs` searches for. *Validation:* `node --test test/eval-cli-driver.test.mjs` is green **before** starting (baseline) and after.

## 8. DONE — Definition of Done

### From WHY
- [ ] `eval/size-census.mjs --gate --against eval/baselines/prompt-size.json` reports a **net reduction** for `plugin/skills/faff/SKILL.md`.
- [ ] No rule/contract/threshold/precedence statement changed meaning (human-reviewable diff confirms provenance/list-shape only).

### From WHAT
- [ ] Every DROP-classed `FAFF-NN` ref present in the live file (FAFF-67/98/7/61/60/50/15/8/18/48/24/110, + any of 5/1/23/153/147 that survive) is removed, host sentences intact.
- [ ] FAFF-109, FAFF-81, FAFF-22 each appear exactly once (their defining mention).
- [ ] All KEEP-classed refs (FAFF-108/82/19/80/21) retained.

### From HOW (behaviour)
- [ ] The 5 frozen anchors are byte-for-byte identical to pre-edit (exact-string check).
- [ ] `loadMarkerDialectProse`, `loadReviewVerdictProse`, `loadRoutingVerdictProse` all resolve.
- [ ] `test/eval-cli-driver.test.mjs` passes unchanged.
- [ ] The two flagged paragraph→list conversions done (Configuration/CLI-only; Automation-eligibility precedence), every fact + precedence order preserved.

### From HOW (edge cases)
- [ ] No doubled spaces / dangling punctuation left by removed parentheticals.
- [ ] No DROP excision damaged an adjacent KEEP ref or frozen anchor.

### Floor + gate
- [ ] `faff validate-adapters` clean; `node --test` green (incl. 8 selftests + 3 loaders); CI `validate` green.
- [ ] `eval/baselines/prompt-size.json` re-stamped to the new gateway size.
- [ ] Human-run frontier judgement reverify run-or-waived-with-rationale on the PR (FAFF-180 smoke-or-waive; full sweep recommended given gateway criticality).

**Integration smoke test:**
```
1. grep -c 'FAFF-109' plugin/skills/faff/SKILL.md      -> 1
2. node --test test/eval-cli-driver.test.mjs            -> pass (loaders resolve)
3. node eval/size-census.mjs --gate --against eval/baselines/prompt-size.json -> net reduction for the gateway
4. faff validate-adapters                              -> clean
```

confidence: high

## Methodology critique

*Lens: `faffter-dark-methodology-agile-delivery` · output: `issue-critique`*

- **Right-sized?** Yes — one cohesive 1-unit pass over a single file. The three concerns (DROP / COLLAPSE / paragraph→list) share one objective (skimmability) and one blast radius.
- **Workstream fit?** Clean — project *"Skill prompts are lean, deduplicated and skimmable"*; the densest remaining target, picking up where FAFF-116/117 left off.
- **Deps surfaced?** No blocking dependency — FAFF-116/117 are Done. Soft note: the merge-gate decision (Chosen-C) leans on FAFF-180's smoke-or-waive convention, and FAFF-180 is still Backlog — the gate operates by convention, not tooling.
- **Risk profile?** Low integration risk, highest semantic-regression stakes in the suite. Mitigation is in the spec (content-preserving principle + frozen-anchor guard + human judgement reverify as merge gate). No de-risking spike needed.
