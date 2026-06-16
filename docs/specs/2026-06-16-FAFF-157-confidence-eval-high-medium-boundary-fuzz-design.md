# Spec — FAFF-157: confidence-eval high/medium boundary fuzz

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-157 (comment 0f580e3a-d284-4cf9-bb84-44eb17c30784).

This is the nlspec design document for FAFF-157, for the build agent and human reviewers. It adds **boundary-fuzz** `confidence` cases to the FAFF-130 judgement-eval corpus — specs deliberately authored to sit on the high/medium line — so the seam where confidence-grading wobbles is *characterised* by a small set of fixtures rather than inferred from the single flaky case (confidence-001). It is a **fixture-only** change: no new kind, no grader logic, no envelope or driver change. The frontier characterisation run (recording how flaky each fuzz case is on a live model) is **human-supervised and carved out** — the shippable build is the new cases plus the deterministic checks that they validate, load, and grade through the existing mock path.

## Already shipped against this surface

Related Done work in the Skill-behaviour harness project — this is the substrate FAFF-157 extends, not coverage of its surface (premise holds, not superseded):

- **FAFF-146** (Done, PR #89) — the `confidence` judgement-eval kind: `CLOSED_SET_KINDS` membership, the `spec_body` fixture shape (`FIXTURE_SHAPE.confidence`), `predictedSet` reading `env.confidence`, the `loadConfidenceRubricProse` rubric loader (anchored on `## Confidence self-rating` … `## Contract artifact` in `faffter-dark-nlspec/SKILL.md`), and `CONFIDENCE_MODE_INSTRUCTION`. **All of this already exists** — FAFF-157 adds *fixtures*, not machinery.
- **FAFF-130** (Done) — the deterministic grader, `loadCases`/`validateCase`, and the per-case stability/accuracy aggregation the fuzz cases are graded by.
- **FAFF-156** (Done) — the full K=20 standing baseline (`eval/report/FAFF-156-standing-baseline.md`) that surfaced confidence-001 at accuracy/stability **0.82** (case-level); the ADR-0004 addendum (2026-06-16) records the **kind mean 0.93**.
- **Sibling precedent — FAFF-150** — ships the isolatable half now and carves the recorded frontier baseline to a human-supervised follow-up (the FAFF-158/160 pattern). FAFF-157 follows that carve-out shape exactly.

## 1. WHY — Problem and Principles

**Problem statement.** The `confidence` kind has exactly one case that wobbles run-to-run on frontier: confidence-001 (kind mean 0.93; case 0.82). It is borderline *by construction* — a small, clean memoisation spec whose only open item is an explicitly non-blocking `**Punt:**`. The rubric routes any Punt → `medium` (`high` requires "no open questions remain"), so the oracle is `medium`; the model reads "doesn't block, correct either way" as `high` ~18% of the time. That single fixture is too thin to tell us *where* the high/medium boundary is stable versus flaky. Before confidence can be leaned on as a hard gate, the seam needs **deliberately-borderline cases** that map out the ambiguous middle.

**Design principles.**

- **Fixtures-not-machinery.** This change adds only `eval/cases/confidence-NNN.json` fixtures. `eval/grader.mjs`, `eval/cli-driver.mjs`, `eval/envelope.mjs` are out of scope. (Conflict-avoidance: the FAFF-145 sibling tickets stack on `grader.mjs` `KINDS`; FAFF-157 deliberately does not.)
- **Single-author oracles on the medium side of the line.** Every fuzz case carries oracle `["medium"]`. The cases differ in *how* they tempt a `high` misread; the oracle is constant.
- **Flakiness is the headline metric, not accuracy.** The point is to measure where the model wobbles. The deterministic build only asserts the cases validate, load, and grade correctly under a fixed mock envelope.
- **Sync the oracle with the shipped rubric.** The oracle reflects `faffter-dark-nlspec/SKILL.md` "## Confidence self-rating" verbatim.

## 2. OUT OF SCOPE

- **Recording the frontier baseline for the fuzz cases** — a human-supervised `claude -p` sweep; `eval/` is CI-excluded. Filed as a separate `faff-automation-hold` follow-up (the FAFF-150 → FAFF-158/160 carve-out pattern).
- **Re-authoring or removing confidence-001** — kept as the live flakiness signal.
- **Changing the confidence grader, fixture shape, rubric loader, or envelope** — all shipped in FAFF-146.
- **Gating regressions against a new numeric floor** — option 3, settled by the carved frontier follow-up.
- **Cases on the medium/low boundary** — the flaky seam is high/medium specifically.

## 3. WHAT

The fuzz cases reuse the existing `confidence` `EvalCase` shape verbatim:

```
RECORD ConfidenceCase (existing, unchanged — FAFF-146):
  id: string                              # "confidence-NNN"
  kind: "confidence"
  fixture: { version: 1, spec_body: string }
  question: "Rate this spec's confidence per the rubric: high, medium, or low?"
  oracle: { closed_set: ["medium"] }      # single-author medium for every fuzz case
```

The corpus goes from 30 → 33. The one assertion that enumerates the total — `test/eval-grader.test.mjs`'s `"all eval/cases load and validate"` (`assert.equal(cases.length, 30)`) — is updated to 33, with a `FAFF-157` comment line.

## 4. HOW

Author three new `eval/cases/confidence-00{4,5,6}.json` fixtures, each a small, near-complete spec body that tempts a `high` misread but is `medium` under the rubric, spanning the boundary's failure modes:

- **confidence-004 — "the thin escape-hatch Punt"** (closest sibling to confidence-001) — a fully-specified change whose only open item is a non-blocking Punt on an optional escape hatch.
- **confidence-005 — "the borderline-rationale Punt"** — clean Chosen markers plus one Punt whose two options are genuinely close and the rationale leans toward one, un-marked.
- **confidence-006 — "the decided-but-flagged Punt"** — every decision Chosen except one phrased as already-leaning-decided but still surfaced as a Punt for confirmation.

The only code edit anywhere is the corpus-count test assertion.

**Anti-patterns:** editing `eval/grader.mjs` / `eval/cli-driver.mjs` / `eval/envelope.mjs`; authoring a fuzz case whose oracle is genuinely arguable; running the live frontier sweep inside this build.

## 6. DESIGN DECISION RATIONALE

**Chosen:** option 2, additive — *add* deliberately-borderline `medium`-oracle fuzz cases and **keep** confidence-001 as the live flakiness signal.
**Chosen:** every fuzz case carries oracle `{ closed_set: ["medium"] }`.
**Chosen:** fixtures-only — no edit to `eval/grader.mjs`, `eval/cli-driver.mjs`, or `eval/envelope.mjs`; the only code edit is the corpus-count assertion.
**Chosen:** ship ≥2 (target 3) cases spanning thin-escape-hatch / borderline-rationale / decided-but-flagged shapes.
**Chosen:** carve the frontier characterisation to a human-supervised follow-up (the FAFF-150/158 pattern).

## 8. DONE — Definition of Done

- [x] ≥2 (target 3) deliberately-borderline `confidence` fuzz cases, each a clean near-complete spec with 1–2 non-blocking Punts and a single-author `medium` oracle.
- [x] confidence-001 retained unchanged.
- [x] Each new case reuses the existing `confidence` `EvalCase` shape.
- [x] No change to `eval/grader.mjs`, `eval/cli-driver.mjs`, or `eval/envelope.mjs`.
- [x] The corpus-count assertion in `test/eval-grader.test.mjs` updated to 33 with a `FAFF-157` comment line; the `≥2 confidence cases` check still passes.
- [x] Each fuzz case grades PASS against mock `{ confidence: "medium" }` and a clean FAIL (signature `["high"]`) against `{ confidence: "high" }`; an out-of-enum token grades a clean FAIL.
- [x] `node --test` passes with the bumped corpus count (228/228).

### Carved follow-up (NOT done-here — human-supervised)
- [ ] **Recorded frontier characterisation for the fuzz cases.** A human-supervised `claude -p` sweep measures each fuzz case's accuracy/stability on frontier. `eval/` is CI-excluded. Filed as a separate `faff-automation-hold` follow-up, blocked-by FAFF-157. The option-1-vs-3 policy decision is made on that evidence.

confidence: high
