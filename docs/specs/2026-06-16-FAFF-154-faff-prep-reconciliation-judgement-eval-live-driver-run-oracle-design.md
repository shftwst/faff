# FAFF-154 — faff-prep reconciliation judgement-eval: live-driver run + oracle

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high. Full spec on Linear FAFF-154.

_Revised 2026-06-16 (interactive reprep): resolved the oracle-authoring Punt → single-author. Re-rated medium → high._

## WHY

FAFF-146 (PR #89, merged) shipped the **reconciliation design** but deliberately did **not** run it end-to-end: the live-driver was parameterised, a prep reconciliation prompt builder (`buildReconciliationPrompt`) + driver (`reconciliationLiveDriver`) + verbatim rubric loader (`loadReconciliationProse`) were authored and unit-wired through `runSkill({ skill: "faff-prep" })` with a mock model — but **no `ThreadFixture` cases, no human Challenge/Resolution/Context/Noise oracle, and no measured frontier baseline** were produced (FAFF-146 spec §6 Chosen slice-split + §7 oracle Punt). This ticket completes the **execution-entangled half**: the reconciliation surface is the only one of prep's three judgement surfaces (confidence · marker · reconciliation) that rides the **live-driver lane** rather than the black-box lane, because it must read an issue + a `spec_comment` anchor + a post-spec comment thread through the FAFF-93 harness, not a flat self-contained prompt.

Without this, faff-prep's Scenario B Step 2a / the gateway's fixed **Live-thread reconciliation** verdict-gate property (the human-steers-via-comment control surface, FAFF-19/110) has **no eval coverage at all** — a model that silently mis-classifies a human's mid-flight Resolution as Noise would ship undetected, defeating the entire "tracker is the control plane" guarantee.

This ticket is **not automation-eligible** (label `faff-chain-gap-fill`, no `faff-automate`) — noted, labels unchanged.

## WHAT

Four things ship (deterministic, model-free), one carves out.

**Ships (model-free, in `eval/`):**
1. The **`ThreadFixture` format** — ratified (issue + `spec_comment` anchor + post-spec `thread[]`), already consumed by `buildReconciliationPrompt` / `reconciliationLiveDriver`.
2. **≥2–3 `reconciliation-*.json` case files** — each a `ThreadFixture` + a per-comment `id:label` closed-set oracle. The oracle-authoring policy is now **settled (single-author)**, so the cases ship **now** with single-author per-comment `id:label` labels.
3. **Harness wiring** so the reconciliation cases are driven through the live-driver seam (NOT the black-box CLI driver, which has no reconciliation branch).
4. A **model-free dry-smoke** — mock model → `reconciliationLiveDriver` → recorded `reconciliation` bucket → graded through the existing `reconciliation` grade path (the routing dry-smoke at `test/eval-live-driver.test.mjs:252` is the template).

**Carves out (deferred follow-up):** the recorded **frontier baseline** (human-supervised real `claude -p` reps) — a separate `faff-automation-hold` ticket per the FAFF-150/158 pattern. NOT in this shippable DONE.

No open Punt remains. The oracle-authoring decision (single-author) is resolved below.

## HOW

### Decision 1 — The `reconciliationLiveDriver` is already on `makeLiveDriver`; this is a verify, not a re-cut

The coordination constraint ("coordinate one refactor, not two" with FAFF-148/155) is **already discharged**: FAFF-158 (PR #92, merged) landed the shared `makeLiveDriver` core AND re-pointed `reconciliationLiveDriver` onto it (`eval/live-driver.mjs:231–251` — the prep driver is a thin `makeLiveDriver({ skill: "faff-prep", buildPrompt, readEnvelope })` wrapper, behaviour-preserved). The routing driver (FAFF-158) and the verdict-build driver (FAFF-155) are the other two wrappers over the same core.

**Chosen:** FAFF-154 does **not** re-point or re-cut the driver — it inherits the shipped `makeLiveDriver` wrapper unchanged. The remaining work is the **cases + oracle + harness-wiring + dry-smoke**, not driver surgery. Any code change to `reconciliationLiveDriver` itself is out of scope unless a case exposes a wiring gap.

### Decision 2 — The `ThreadFixture` shape

The shape `reconciliationLiveDriver` + `buildReconciliationPrompt` already read (`eval/live-driver.mjs:74–87`, guard at `:235`), matching the grader `FIXTURE_SHAPE.reconciliation = ["issue", "spec_comment", "thread"]` (`eval/grader.mjs:67`):

```
{
  "version": 1,
  "issue":        { "id", "title", "description" },
  "spec_comment": { "id", "posted_at", "body" },          // the anchor; everything after it is classified
  "thread":       [ { "id", "posted_at", "author", "body" }, … ]   // chronological, all after the anchor
}
```

The reference instance already lives inline in the test as `THREAD_FIXTURE` (`test/eval-live-driver.test.mjs:110`). FAFF-154 promotes this into committed `eval/cases-live/reconciliation-*.json` files (one per case).

**Chosen:** ratify this exact shape; the case JSON carries it under `fixture`, exactly as `marker-*.json` carries `fixture.sections`. No new fields.

### Decision 3 — How a `ThreadFixture` reaches the live-driver (the harness seam)

**Chosen:** config-field (a) — pass the `ThreadFixture` to `reconciliationLiveDriver({ fixture })`; the `listIssues` seam-read keeps the run seam-faithful. This matches the two sibling live-drivers (routing, verdict-build) and needs zero harness change.

### Decision 4 — Where the reconciliation cases are loaded / driven (the sharp wiring call)

`eval/run-evals.mjs` `loadCases()` (`:21`) loads **every** `cases/*.json` unconditionally and drives each via the **black-box CLI driver**, which has **no `reconciliation` branch**. `reconciliation` is **live-driver-only**.

**Chosen:** option (a) — a separate live-fixture location (`eval/cases-live/reconciliation-*.json`) + a live-driver runner, so a reconciliation case is **never** loaded by the black-box `loadCases()` sweep. Keeps the black-box sweep total-over-`cases/`; mirrors the FAFF-146 lane separation. **Assumes:** `eval/cases/*.json` is consumed only by `run-evals.mjs`'s black-box sweep (verified — `loadCases` is the sole reader; the live-driver tests inline their fixtures today).

### Decision 5 — The model-free dry-smoke (the shippable CI proof)

**Chosen:** add a reconciliation dry-smoke mirroring the routing one (`test/eval-live-driver.test.mjs:252–290`) — for each committed `reconciliation-*.json`: load it, drive `reconciliationLiveDriver` with a mock model emitting the oracle's exact `id:label` map → PASS; emit one wrong label → clean FAIL with a distinct signature, no throw. Zero spawn, CI-gating.

### Decision 6 — The verbatim rubric the live pass carries

**Chosen:** no rubric change — the live pass carries the shipped verbatim Step-2a prose unchanged. Cases must be authored so their oracle labels are defensible **against that exact verbatim rubric** (a Challenge contradicts a spec decision; a Resolution closes a Punt/decision; Context is substantive-but-non-blocking; Noise is pings/+1).

### Decision 7 — The case oracles (the per-comment closed-set) — settled: single-author

**Chosen:** single-author oracle authoring — one human labels each post-spec comment (challenge/resolution/context/noise); that label is the case's `oracle.closed_set` ground truth. Consistent with every existing eval case, the only practical policy for a solo project, upgradeable to double-labelled-reconciled later. Because the policy is now settled, the cases ship **now** with single-author per-comment `id:label` oracles.

### Edge cases / fail-safes (inherited, asserted by the dry-smoke)

- A missing/garbage `reconciliation` envelope field → empty set → clean FAIL, never a crash (`eval/grader.mjs:150` `pairsOf` guard).
- An out-of-enum label → passed through verbatim so `setEqual` fails it cleanly with a distinct signature.
- The mock-model envelope must be tagged exactly `` ```faff-eval:judgement `` (the harness `parseJudgementEnvelope` contract).

## Scenarios

### Scenario 1 — A clean post-spec thread (challenge + resolution + context + noise)
A spec_comment anchors; the thread has one Challenge, one Resolution, one Context, one Noise. The live pass classifies all four; the dry-smoke asserts the recorded `reconciliation` bucket equals the oracle `id:label` set → PASS.

### Scenario 2 — A resolution that closes an open Punt
The spec_comment carries an open `**Punt:**`; a later comment resolves it. The oracle labels that comment `resolution`. Proves the eval covers the exact control-surface property the gateway fixes.

### Scenario 3 — Noise-only thread (negative control)
Only status pings / +1s after the spec. Oracle labels all `noise`. Proves the model doesn't hallucinate Challenges/Resolutions from chatter.

### Scenario 4 — Grader fail-safe (dry-smoke, model-free)
A mock model emits one wrong label → the grader returns a clean FAIL with a distinct signature, no throw.

## DONE (acceptance criteria)

1. **`ThreadFixture` format ratified** — ≥2–3 committed `reconciliation-*.json` fixtures (issue + `spec_comment` anchor + post-spec `thread[]`), each with a per-comment **single-author** `id:label` `oracle.closed_set`, passing `validateCase` (kind `reconciliation`, `FIXTURE_SHAPE` fields present).
2. **Cases cover the four labels** — across the case set, all of challenge / resolution / context / noise appear, including a Resolution-closes-Punt case (Scenario 2) and a noise-only negative control (Scenario 3).
3. **Harness wiring** — the reconciliation cases are driven through `runSkill` + `reconciliationLiveDriver` (Decision 4 option a), never the black-box `loadCases()` / CLI-driver sweep; a reconciliation case is provably not picked up by the black-box `run-evals.mjs` run.
4. **Driver inherited, not re-cut** — `reconciliationLiveDriver` remains the shipped `makeLiveDriver` wrapper; no bespoke driver added.
5. **Model-free dry-smoke (CI-gating, zero spawn)** — for each committed case: mock model emitting the oracle map → driver → recorded `reconciliation` bucket → `grade` PASS; one wrong/missing label → clean FAIL, distinct signature, no throw.
6. **Verbatim rubric carried** — the live prompt folds in `loadReconciliationProse` (Step 2a) unchanged; a pluginDir-null baseline omits it (the control).
7. **Existing suite stays green** — `node --test` passes; the live-driver/grader tests are not regressed.
8. **Carve-out filed (separate bucket, not this DONE)** — the recorded frontier baseline (human-supervised real `claude -p` reps) is a separate `faff-automation-hold` follow-up ticket (FAFF-150/158 pattern), NOT in this DONE.

## Carve-out (discovered scope, blocked-by FAFF-154)

The human-supervised frontier baseline for the reconciliation kind — real `claude -p` reps over the committed `reconciliation-*.json` cases, recording the standing accuracy/stability baseline + (per the FAFF-131 pattern) any ADR note. `faff-automation-hold` follow-up; cannot run in an unattended/interactive build (needs human-supervised real-model calls), so it is split OUT of this shippable DONE.
