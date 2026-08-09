# Record the measured frontier baseline for the routing live-driver (human-supervised)

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-160 (comment 023e6086-038d-42c9-b5bf-f041becf701c).

This is the nlspec build spec for **FAFF-160**, for the build agent and human reviewers. It defines a small **live-driver baseline runner** and the **out-of-band baseline record** it produces. FAFF-158 shipped the routing live-driver (`routingLiveDriver`) + the shared `makeLiveDriver` core + a model-free dry-smoke, and carved the *measured frontier baseline* out of scope (recursive `claude -p` + config-race + cost ⇒ an unattended run cannot reliably do it and must not fake it). The hold has since been lifted and the human has authorised this human-supervised run. This spec settles the open exploration the prep brief flagged: **there is no existing runner that drives `routingLiveDriver` with `makeLiveModel` over the routing cases for K reps** — so building that runner is part of the deliverable.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-159 (Done) recorded the frontier baseline for the routing kind's **black-box** `cases/routing-*.json` lane (the self-contained eval-prompt path, driven by `run-evals.mjs main()` → `frontierDriver`). FAFF-158 added a *second* code path for the same six verdicts — the **live-driver input-assembly path** (`routingLiveDriver` → `buildRoutingPrompt` → `runSkill` → the `routing` grade), exercised in CI only by a mock model. That path's real-model accuracy/stability/format is **unmeasured**: `run-evals.mjs main()` drives only `loadCases()` (the `cases/` black-box sweep) via the CLI drivers, and there is **no entrypoint** that binds `routingLiveDriver` to `makeLiveModel` over the cases for K reps and aggregates a baseline. This ticket builds that runner and records the baseline.

**Design principles.**

- **Never fabricate a measured number.** Every figure in the recorded baseline comes from a real `claude -p` rep. A run that cannot spawn the model writes *nothing* and fails loud — it never invents or estimates a baseline. This is why the ticket is human-supervised, not autonomous-buildable end-to-end.
- **Mirror the established baseline-record convention, don't invent one.** FAFF-150 (modedetect) and FAFF-156 already set the pattern: per-case raw rep JSON + a standing-baseline `.md` table under `eval/report/` (gitignored / out-of-band), plus a committable ADR addendum. This ticket reuses that exact shape.
- **Reuse the shipped seams; add only the runner.** `routingLiveDriver`, `makeLiveModel`, `buildRoutingPrompt`, the `routing` grade path, `aggregateCase`/`summarize`, config-isolation (`forwardCredentials` + per-rep `CLAUDE_CONFIG_DIR`, FAFF-138) all exist and are unchanged. The runner is thin glue over them — it must not re-cut the driver, the grader, or the isolation.
- **Seam-faithful at the harness boundary.** Each rep drives through the **real** FAFF-93 `runSkill` harness (the live-driver issues its `listIssues` seam-read), exactly as the dry-smoke test does — not a bare `model(prompt)` call.

**Reconciliation with the merged FAFF-163 runner (build-time note).** FAFF-163 shipped `eval/run-live-evals.mjs` as the SHARED live-lane runner with an open `LIVE_KINDS` registry (`{ loader, driveCase }` adapters normalising to `{ env, tokens }`), and registered only `reconciliation`. Per FAFF-163's in-file handoff and FAFF-160's coordination, this build **appends a `routing` entry to that registry** rather than creating a new file — a small additive append, no core change, the reconciliation adapter left intact. Routing cases are read straight from `eval/cases/routing-*.json` (NOT duplicated into `cases-live/`), via a `driveRoutingCase` helper mirroring `driveReconciliationCase`.

## 2. OUT OF SCOPE

- **Any change to `routingLiveDriver`, `makeLiveDriver`, `buildRoutingPrompt`, the grader, or the isolation primitives** — they shipped in FAFF-158/149 and are the measured surface; changing them invalidates the baseline.
- **The reconciliation (prep) live baseline** — a distinct carved FAFF-145 child. The reconciliation adapter stays intact (additive).
- **Promoting the routing live-driver into CI / `node --test`** — ADR-0003 fixes the CI policy (live drivers are local/on-demand only).
- **Adding `routing-*.json` to `cases-live/`** — the routing fixtures already live in `cases/`; the runner reads `fixture`+`oracle` straight from `cases/routing-*.json`.
- **A frontier-vs-local compare for the live lane** — the baseline is a single frontier measurement.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Routing case | A `eval/cases/routing-NNN.json` object: `{ id, kind:"routing", fixture:{issue,spec,diagnostics,conflict,park_history}, question, oracle:{closed_set:[verdict]} }` |
| Live-driver lane | The path `runSkill` → `routingLiveDriver.drive` → `buildRoutingPrompt` → injected model → `routing` bucket |
| Rep | One real `claude -p` invocation of the live-driver over one case (config-isolated per rep) |
| Baseline record | Per-case raw rep JSON + a standing-baseline `.md` table under `eval/report/` (gitignored), plus a committable ADR addendum |

**Routing adapter (new — appended to `LIVE_KINDS` in `eval/run-live-evals.mjs`).**

```
routing: {
  loader:   () => loadCases().filter(c => c.kind === "routing"),   // cases/, NOT cases-live/
  driveCase: (evalCase, { runSkill, tracker, repo, model }) =>
               driveRoutingCase(evalCase, { runSkill, tracker, repo, model })
               -> { env: { verdict }, tokens }                     // the normalised rep-loop contract
}
```

**`driveRoutingCase` (new — in `eval/live-driver.mjs`, mirroring `driveReconciliationCase`).** Binds the case's `fixture` into `routingLiveDriver`, drives it through `runSkill({ skill: "faff-tidy" })`, reads the recorded `routing` bucket's single verdict, and returns the DecisionRecord + verdict. The adapter normalises `{ record, verdict }` into `{ env: { verdict }, tokens }` so `grade(evalCase, env)` runs the existing `routing` closed-set path unchanged.

## 4. HOW — Implementation

- **`driveRoutingCase(evalCase, { runSkill, tracker, repo, model, pluginDir })`** in `eval/live-driver.mjs`, verbatim-symmetric with `driveReconciliationCase`: construct `routingLiveDriver({ model, fixture: evalCase.fixture, caseId: evalCase.id })`, `await runSkill({ skill: "faff-tidy", tracker, repo, driver })`, return `{ record, verdict: record.buckets.routing?.[0] ?? null }`.
- **`routing` adapter** appended to `LIVE_KINDS`: `loader` filters `loadCases()` to `kind === "routing"`; `driveCase` calls `driveRoutingCase` and normalises to `{ env: { verdict }, tokens }`. A missing/out-of-enum verdict yields `{ verdict: null }` → `grade` scores a clean FAIL, never a throw (the runner's existing try/catch is the backstop).
- The runner's rep loop, escalation, `aggregateCase`/`summarize`, report writers, and `main()` (`--kind routing`) are **reused unchanged** — the append is the only code change to the runner.
- **The human-supervised run:** smoke `node eval/run-live-evals.mjs --kind routing --only routing-001 --reps 2`; full sweep `node eval/run-live-evals.mjs --kind routing --reps 20` (K=20 base, adaptive→50). Six cases. Under FAFF-138 isolation.

## 5. Open Questions / Assumptions

- **Assumes:** `routingLiveDriver`, `makeLiveModel`, `buildRoutingPrompt`, `frontierOpts`/`forwardCredentials`, `grade`/`aggregateCase`/`summarize`, the `test/helpers/*` harness, and the merged `LIVE_KINDS` registry all exist on `main` (verified — FAFF-163 merged b67bce0).
- **Assumes:** the six `eval/cases/routing-00{1..6}.json` each carry `fixture` (`issue`+`spec`) and `oracle.closed_set` (verified).
- **Assumes:** the human has working frontier `claude -p` auth so the supervised run can spawn.

No open `**Punt:**` markers — the runner shape, the cases, and the record format are all settled by Chosen markers.

## 6. DONE — Acceptance Criteria

1. **The runner extension exists and is unit-tested.** `eval/run-live-evals.mjs`'s `LIVE_KINDS` carries a `routing` adapter (`{ loader, driveCase }` normalising to `{ env: { verdict }, tokens }`); `eval/live-driver.mjs` exports `driveRoutingCase` (injected `runSkill`/`tracker`/`repo`/`model`). A mock-model unit test (`node --test`, zero spawn) asserts a sane `CaseResult` on a correct and a wrong verdict via the routing adapter.
2. **Importing the runner spawns nothing** — only `main()` reaches `makeLiveModel`; the unit test never invokes a real model.
3. **The frontier baseline is measured and recorded out-of-band** — a human-supervised K=20 (adaptive→50) sweep over the six routing cases recorded under `eval/report/` (gitignored). Every number traces to a real rep; nothing is fabricated. (Blocked on auth ⇒ recorded as a human follow-up, not faked.)
4. **Config isolation verified** — the baseline record notes the parent `~/.claude.json` was untouched (FAFF-138 isolation).
5. **The committable artifact ships.** `records/adr/0003-live-driver-spike.md` carries an addendum recording the routing live-driver runner extension + the baseline headline (or the blocked-on-auth note) + the runner location + a pointer to the gitignored `eval/report/` record.
6. **No shipped seam changed.** `routingLiveDriver`, `makeLiveDriver`, `buildRoutingPrompt`, the grader, the isolation primitives, AND the FAFF-163 reconciliation adapter are untouched (additive only).
