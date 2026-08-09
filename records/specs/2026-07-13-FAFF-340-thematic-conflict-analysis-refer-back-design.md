# FAFF-340 — Thematic lens: refer back to beep-boop's conflict analysis

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-340.

## WHY

The thematic methodology lens's `build-queue` output (`plugin/skills/faffter-noon-methodology-thematic/SKILL.md:188–194`) carries its own four-heuristic **"Conflict analysis (safe for parallel)"** recap. It is a silent duplicate of beep-boop's canonical Conflict analysis section (`plugin/skills/faff-beep-boop/SKILL.md:366`, `## Conflict analysis`) that has since **drifted and now contradicts** the canon:

- Its heuristic 2 — *"Specs name same **top-level** directory → collision"* — is the exact rule beep-boop heuristic 2 explicitly rules out: *"a shared **top-level** directory alone is **not** a collision … top-level matching spuriously serialises half the queue"* (the rule is deepest-shared-directory).
- It omits beep-boop heuristics **3** (named shared module / util / symbol) and **6** (inferred producer→consumer) — and heuristic 6's methodology-agnostic homing in conflict analysis was the point of an accepted ADR (build-order inference), precisely so it holds under the thematic default.

Audit `verification/audits/2026-07-04-faff-323-whole-system-coherence.md` → **R2 / T6**. The project's skill-authoring standard is explicit: shared prose has one home — reference it, never copy. A recap that exists is a recap that can rot; this one did.

## WHAT

Replace the inline recap at `SKILL.md:188–194` — the `**Conflict analysis (safe for parallel):**` heading, its four numbered heuristics, and the trailing *"Independents run in parallel; collision groups serialise within themselves."* line — with a **single refer-back line** pointing at beep-boop's canonical section, using the codebase's established sibling-skill refer-back convention (`faff-beep-boop → **Conflict analysis**`, matching e.g. `faff-prep → **Scenario B Step 2a**`).

No behavioural change. beep-boop's `## Conflict analysis` stays the single executable source; the thematic lens's `build-queue` already defers the actual partition to it (the `concurrency` executor consumes beep-boop's partition). The edit removes a contradictory, drifted copy — it does not add, correct, or relocate any heuristic.

## HOW

**Chosen:** Replace lines 188–194 with a one-line refer-back that (a) names the canonical section via the sibling convention and (b) preserves only the local framing the `build-queue` output needs — that independents run in parallel and collision groups serialise within themselves — expressed as a pointer, not a re-listed heuristic set. Concretely, of the form:

> **Conflict analysis:** partition the admitted set into independents (parallel-safe) and collision groups (serialised within the group, parallel across groups) per the canonical heuristics — see `faff-beep-boop` → **Conflict analysis**. Single home: do **not** recap the heuristics here.

Exact wording is the implementer's call within the skill-authoring house style; the load-bearing requirements are the refer-back target and the zero-heuristic content.

**Chosen:** Do **not** restate any of the six heuristics inline — not even a corrected heuristic 2. The drift happened *because* a recap existed to rot; a pointer that lists zero heuristics cannot drift. This is the only fix consistent with the "reference it, never copy" rule.

**Assumes:** beep-boop's `## Conflict analysis` section exists and remains the canonical home (confirmed present at `faff-beep-boop/SKILL.md:366`, heuristics 1–6). If a future edit renames or moves it, this refer-back must be re-pointed — an in-repo prose anchor, not an external reference.

Leave surrounding lines untouched: the `**Ordering:**` line (186) already references collision groups — keep it; the `**Wave structure:**` line (196) is unaffected. This is a within-`build-queue` surgical replacement of the 188–194 block only.

## DONE — acceptance criteria

1. `faffter-noon-methodology-thematic/SKILL.md` no longer contains the phrase *"top-level directory"* in the build-queue conflict-analysis context (the contradictory heuristic is gone).
2. The `build-queue` section contains a refer-back to beep-boop's Conflict analysis using the sibling-skill convention (`faff-beep-boop → **Conflict analysis**`), and lists **zero** conflict-analysis heuristics inline.
3. None of the six heuristics (same-files / same-directory / named-shared-surface / declared-blocker / shared-scope-tag / inferred-producer→consumer) is restated anywhere in the thematic lens.
4. `faff validate-adapters` passes (line/paragraph caps, no stray markers, no duplicated-block flag) for the edited file.
5. No behavioural or CLI change; no section of the file other than the 188–194 replacement is altered.

confidence: high
spec-review: approve

## Methodology critique

*Agile-delivery lens (issue-critique):*

- **Right-sized?** Yes — a single, trivial doc-hygiene unit (one refer-back replacing one drifted recap). No split, no merge.
- **Workstream fit?** Yes — a `faff-chain-gap-fill` item from the FAFF-323 coherence audit (R2/T6); cohesive with the dedup pass.
- **Deps surfaced?** None — self-contained; the one dependency (beep-boop's canonical section) already exists.
- **Risk profile?** Negligible — prose-only, no runtime surface, gated by `faff validate-adapters`.

No issues.
