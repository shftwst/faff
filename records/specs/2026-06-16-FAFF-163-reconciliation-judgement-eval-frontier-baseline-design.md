# FAFF-163 — Record the reconciliation judgement-eval frontier baseline (human-supervised)

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high
> Parent FAFF-145 · blocked-by FAFF-154 (MERGED, PR #95) · related FAFF-131 / FAFF-158 / FAFF-160

## WHY

FAFF-154 (PR #95, merged) shipped the `reconciliation` judgement-eval **deterministically**: the `ThreadFixture` format, three committed `eval/cases-live/reconciliation-*.json` cases (single-author per-comment `id:label` oracles), the `reconciliationLiveDriver` wiring over FAFF-158's shared `makeLiveDriver` seam, and a model-free dry-smoke (mock model, zero spawn). Its DONE **explicitly carved** the recorded **frontier baseline** to a human-supervised follow-up (FAFF-154 spec §8) — exactly the FAFF-131 / FAFF-156 / FAFF-159 pattern: a recursive `claude -p` sweep races the parent session's `~/.claude.json` and costs real tokens, so an unattended run cannot reliably perform it and **must not fake it**.

This ticket records that baseline. Without it the `reconciliation` kind has a passing *wiring* proof but **no measured signal** of how the frontier model actually classifies a live post-spec thread (Challenge / Resolution / Context / Noise) — so a regression in the verbatim Step-2a rubric or the prompt builder would ship undetected, defeating the "tracker is the control plane" guarantee the reconciliation surface exists to protect.

**Distinct from the ADR 0004 full-suite baseline.** The 2026-06-16 ADR 0004 addendum baselined the **black-box** `eval/cases/` closed-set kinds (incl. the black-box `routing` cases). `reconciliation` is a **live-driver** kind — its cases live in `eval/cases-live/` and drive via `runSkill` + `reconciliationLiveDriver`, a different input-assembly path the black-box `loadCases()` sweep provably never touches. This is genuinely new coverage.

This ticket **is** authorised to run frontier `claude -p` (the human removed the hold, added `faff-automate`, and confirmed they want it run). Eligibility note only; labels unchanged.

## WHAT

Two things ship.

1. **A small live-driver frontier RUNNER** (`eval/run-live-evals.mjs`) — because **no existing runner drives a live-driver with the real model over `cases-live/` and records a baseline**. `run-evals.mjs`'s `main()` drives only `loadCases()` (the black-box `cases/` sweep); it never calls `loadLiveCases()` or `driveReconciliationCase`. The runner mirrors `run-evals.mjs`'s structure (K reps · adaptive escalation · `aggregateCase` · `summarize` · report write) but over the **live-driver lane** (`loadLiveCases()` + a per-kind drive adapter + `makeLiveModel`).
   - **Coordinated with FAFF-160 (one runner, not two)** — see Decision 1. The runner is parameterised by a **per-kind drive adapter**; FAFF-163 registers `reconciliation`, FAFF-160 registers `routing`.

2. **The recorded reconciliation baseline** — real `claude -p` reps over the three committed `reconciliation-*.json` cases, captured as:
   - `eval/report/reconciliation-live-baseline.json` (the `summarize()` dump — **gitignored**, matching the existing `eval/report/*.json` convention), and
   - `eval/report/FAFF-163-reconciliation-baseline.md` — a human-readable standing-baseline table mirroring `FAFF-156-standing-baseline.md` (per-case accuracy / stability / format / reps / escalated + the config-isolation-OK line + a per-comment label breakdown), and
   - an **optional committable ADR addendum** to `records/adr/0004-judgement-evals-spike.md` recording the headline reconciliation numbers (the FAFF-131 / FAFF-156 pattern — the one durable, version-controlled record).

**Not in scope:** any change to `reconciliationLiveDriver`, `grader.mjs`, the cases, or the dry-smoke (FAFF-154 shipped those green). FAFF-160's routing baseline run itself (this ticket builds the shared runner + registers reconciliation; FAFF-160 registers routing and runs its own baseline).

## HOW

### Decision 1 — ONE shared live-driver runner, parameterised by a per-kind drive adapter (coordinated with FAFF-160)

FAFF-163 (reconciliation) and FAFF-160 (routing) hit the **identical gap**: their live-driver (`reconciliationLiveDriver` / `routingLiveDriver`) is not run by `run-evals.mjs`'s black-box sweep, and each needs K real `claude -p` reps recorded as a baseline. Building two near-duplicate runners is the anti-pattern FAFF-158's `makeLiveDriver` seam already rejected one layer down.

**Chosen: a single `eval/run-live-evals.mjs`, parameterised by a per-kind DRIVE ADAPTER, registered by both tickets.** The runner owns the rep loop / escalation / aggregation / report write (lifted from `run-evals.mjs`); each kind supplies a tiny adapter:

```
// per-kind adapter: { loader, driveCase }
//   loader()            -> live EvalCases for this kind (loadLiveCases().filter(kind))
//   driveCase(c, deps)  -> Promise<{ rawText | env, tokens }>  // binds the kind's live-driver, runs one rep
const LIVE_KINDS = {
  reconciliation: { loader: reconCases, driveCase: driveReconciliationCase },   // FAFF-163 (this ticket)
  routing:        { loader: routingCases, driveCase: driveRoutingCase },        // FAFF-160 (registers here)
};
```

**Why an adapter, not a shared `driveCase` — the load-bearing asymmetry (verified, NOT assumed):**
- reconciliation cases live in `eval/cases-live/` and drive through the FAFF-93 harness via `driveReconciliationCase(c, { runSkill, tracker, repo, model })` (the fixture is injected through the harness substrate).
- routing's live cases do **not exist in `cases-live/` yet** — `eval/cases/routing-*.json` are the **black-box** cases (already baselined by FAFF-159). `routingLiveDriver` reads its fixture as a **plain config field**, and **no `driveRoutingCase` helper exists**. FAFF-160 must add `cases-live/routing-*.json` + a `driveRoutingCase` adapter.

So the two kinds genuinely differ in their per-rep drive shape; the runner must NOT hard-code reconciliation's `runSkill` path. The adapter is the seam. **FAFF-163 builds the runner + the `reconciliation` adapter + leaves the `LIVE_KINDS` registry open; FAFF-160 adds the `routing` entry (its cases + `driveRoutingCase`).** Both touch `eval/run-live-evals.mjs` — flagged for conflict analysis (Decision 6).

### Decision 2 — The runner mirrors `run-evals.mjs`, reusing every kind-agnostic primitive

The runner is a thin live-lane twin of `run-evals.mjs main()`. For each case it loops `K` reps, each rep calling the kind's `driveCase`, parses/grades via the **existing** `grade(c, env)` (reconciliation is already in `CLOSED_SET_KINDS`), and aggregates via the **existing** `aggregateCase` / `summarize` (both kind-agnostic). **Reuse, don't re-implement:** `BASE_REPS` (20), `MAX_REPS` (50), `aggregateCase`, `summarize`, `hasDisagreement`, `erroredRep` are all exported from `run-evals.mjs` / `grader.mjs` — the runner imports them. The only new code is the per-kind `LIVE_KINDS` dispatch + the live `makeLiveModel` wiring + the report writer.

```
node eval/run-live-evals.mjs --kind reconciliation [--reps N] [--only ID] [--bin claude] [--plugin-dir P | --no-plugin]
```

- `--reps` defaults to `BASE_REPS` (20), adaptive escalation to `MAX_REPS` (50) on rep disagreement — identical policy to the black-box runner (so the reconciliation baseline is comparable to FAFF-156's).
- `--plugin-dir` / `--no-plugin` carry the FAFF-133 plugin-load semantics (default = repo plugin + verbatim rubric; `--no-plugin` = the improvise control).

### Decision 3 — Config isolation is per-rep, inherited from `makeLiveModel` (FAFF-138)

The recursive-`claude -p`/`~/.claude.json` race (ADR-0003) is **already solved at the model layer**: `makeLiveModel()` (`eval/live-driver.mjs`) does its own per-call `mkdtempSync(CLAUDE_CONFIG_DIR)` + `forwardCredentials` (FAFF-138) + best-effort cleanup. The runner does **not** re-implement isolation — it injects `makeLiveModel()` as the `model` and inherits it. **Chosen:** the runner constructs `const model = makeLiveModel({ bin, pluginDir })` once and passes it into each `driveCase` rep; isolation is the model's contract, not the runner's. The runner's post-run report asserts the config-isolation-OK line (parent `~/.claude.json` untouched) exactly as `FAFF-156-standing-baseline.md` does.

### Decision 4 — The record format mirrors FAFF-156 (the established precedent)

**Chosen:** reuse the FAFF-156 record shape verbatim so baselines are comparable across kinds:
- `eval/report/reconciliation-live-baseline.json` — the raw `summarize()` dump (**gitignored**; `eval/report/*.json` is already gitignored — verify, Decision 5).
- `eval/report/FAFF-163-reconciliation-baseline.md` — the standing-baseline table: one row per case (`case | kind | accuracy | stability | format | reps | escalated`), the driver/config-isolation header lines, plus a **per-comment label breakdown** (which `id:label` the model flips on, since reconciliation accuracy is per-comment within a case — the signal the parent FAFF-145 cares about).
- **Optional committable ADR addendum** to `records/adr/0004-judgement-evals-spike.md` — the headline reconciliation accuracy/stability/format, dated, marked human-supervised. This is the only version-controlled artefact (the `eval/report/` files are gitignored evidence). Optional because the `.md` standing-baseline + ADR addendum partly overlap; the human running the sweep picks whether the ADR note is worth committing (low appetite for ADR churn → skip; the standing-baseline `.md` is the canonical record either way).

### Decision 5 — `eval/report/` gitignore + the `.md` baseline must be committable

The `*.json` dumps are gitignored evidence (regenerable); the human-readable standing-baseline `.md` is the **retained record** and must be committable. **Verify at build:** confirm `eval/report/` `.gitignore` rule scopes `*.json` (not the whole dir) so `FAFF-163-reconciliation-baseline.md` commits while `reconciliation-live-baseline.json` stays ignored — mirror exactly how `FAFF-156-standing-baseline.md` already lives committed alongside gitignored `*.json` in `eval/report/`. If the rule ignores the whole dir, the `.md` baseline relocates next to the ADR (`records/adr/`) — note in the build.

### Decision 6 — Files touched + conflict surface with FAFF-160

| File | FAFF-163 | FAFF-160 |
|---|---|---|
| `eval/run-live-evals.mjs` (**NEW, shared**) | creates the runner + `reconciliation` adapter | adds the `routing` adapter entry |
| `eval/live-driver.mjs` | none | adds `driveRoutingCase` |
| `eval/cases-live/routing-*.json` | none | creates |
| `eval/report/FAFF-163-reconciliation-baseline.md` | creates | — |
| `eval/report/*.json` | writes (gitignored) | writes (gitignored) |
| `records/adr/0004-*.md` | optional addendum | optional addendum |

**Coordination:** `eval/run-live-evals.mjs` is the shared new file. Whichever ticket builds first creates the runner + its kind's adapter + leaves `LIVE_KINDS` open; the second adds its entry (a small append, low conflict). The ADR addendum is the other shared touchpoint — both append a dated section; if both land near-simultaneously, the second rebases its addendum below the first. **Build FAFF-163 first if both queued** (it creates the runner the simpler way — reconciliation's `driveReconciliationCase` already exists; routing needs a new helper + new cases first).

## DONE

Shippable DONE:

1. **`eval/run-live-evals.mjs` exists** — a live-driver frontier runner mirroring `run-evals.mjs` structure, driving a per-kind adapter over `loadLiveCases()` with K reps + adaptive escalation, reusing `aggregateCase` / `summarize` / `grade` unchanged. It registers the `reconciliation` adapter (`driveReconciliationCase`) and leaves `LIVE_KINDS` open for FAFF-160's `routing` entry.
2. **The runner injects `makeLiveModel()`** for the real `claude -p` path; config isolation is inherited per-rep (FAFF-138), not re-implemented.
3. **The recorded reconciliation baseline exists:** `eval/report/reconciliation-live-baseline.json` (gitignored) + `eval/report/FAFF-163-reconciliation-baseline.md` (committable, FAFF-156 format, with per-comment breakdown), produced from a **real human-supervised `claude -p` sweep** over the three committed cases — never faked.
4. **Optional committable ADR addendum** to `records/adr/0004-*.md` with the headline numbers (human decides whether to commit it).
5. **No change** to `reconciliationLiveDriver` / `grader.mjs` / the cases / the dry-smoke; the existing `node --test` suite stays green (the runner is `claude -p`-spawning, so it is excluded from `node --test` exactly as `run-evals.mjs` is).
6. **Coordination note** recorded so FAFF-160's build extends the same runner (one runner, two kinds), not a parallel copy.

### Scenarios

**Scenario 1 — the runner records the reconciliation baseline (the happy path).**
GIVEN the three committed `eval/cases-live/reconciliation-*.json` cases and a human-supervised session authorised to run `claude -p`,
WHEN `node eval/run-live-evals.mjs --kind reconciliation` runs K≈20 reps per case (escalating to 50 on disagreement),
THEN each rep drives `reconciliationLiveDriver` via `driveReconciliationCase` with `makeLiveModel`, grades through the existing `reconciliation` path, and the run writes `reconciliation-live-baseline.json` + `FAFF-163-reconciliation-baseline.md` with per-case accuracy/stability/format and a per-comment label breakdown,
AND the parent `~/.claude.json` is untouched (config-isolation-OK line present).

**Scenario 2 — config-race safety under the recursive sweep.**
GIVEN the runner is invoked from inside a Claude Code session (the ADR-0003 race condition),
WHEN each rep spawns `claude -p`,
THEN isolation comes from `makeLiveModel`'s per-call `CLAUDE_CONFIG_DIR` + forwarded credentials (FAFF-138) — the runner adds no isolation of its own and never writes the shared global config,
AND no rep dies on a corrupted `~/.claude.json`.

**Scenario 3 — FAFF-160 extends the same runner (coordination).**
GIVEN FAFF-163 shipped `eval/run-live-evals.mjs` with the `reconciliation` adapter and an open `LIVE_KINDS` registry,
WHEN FAFF-160 is built,
THEN it adds a `routing` entry (`cases-live/routing-*.json` + `driveRoutingCase`) to the SAME runner file — one runner, two kinds — rather than creating a second runner,
AND `node eval/run-live-evals.mjs --kind routing` records the routing baseline through the identical rep/aggregate/report machinery.

**Scenario 4 — never fake the baseline.**
GIVEN an unattended/interactive build that cannot reliably run the recursive `claude -p` sweep,
WHEN it reaches this ticket,
THEN it builds the runner + the adapter (deterministic, model-free) but does NOT fabricate baseline numbers — the recorded baseline requires a real human-supervised sweep, and an empty/placeholder report is a park-not-ship signal (the FAFF-131 / FAFF-156 / FAFF-159 discipline).

## Punts / Assumes

- **Assume:** `aggregateCase`, `summarize`, `hasDisagreement`, `erroredRep`, `BASE_REPS`, `MAX_REPS` are exported and kind-agnostic (verified — `grader.mjs` / `run-evals.mjs` exports; reconciliation already in `CLOSED_SET_KINDS`). The runner reuses them; it adds no new aggregation maths.
- **Assume:** `makeLiveModel()` owns per-rep config isolation (verified — `eval/live-driver.mjs` does its own `mkdtempSync` + `forwardCredentials`). The runner does not duplicate it.
- **Assume:** `eval/report/` gitignores `*.json` but not `*.md` (must verify at build, Decision 5 — `FAFF-156-standing-baseline.md` lives committed alongside gitignored dumps, strong precedent). If the rule is whole-dir, the `.md` relocates next to the ADR.
- **Assume:** the three committed reconciliation cases are the full baseline set (FAFF-154 shipped exactly three; no new cases here).
- **Punt:** the **per-rep return contract** of `driveCase` — reconciliation's `driveReconciliationCase` returns `{ record, bucket }`, whereas the runner's rep loop wants `{ env | rawText, tokens }` to feed `grade`. The adapter normalises this (reconciliation: rebuild `{ reconciliation: <bucket-as-map> }` for `grade`, read tokens from the record). This is small wiring, resolvable at build from the existing `grade(c, { reconciliation: map })` shape the dry-smoke already uses (`grade(c, { reconciliation: oracleMap(c) })`) — flagged so FAFF-160's `driveRoutingCase` adopts the SAME normalised adapter return, keeping the runner kind-uniform. NOT a blocking architectural decision (appetite-high resolve-attempt: the dry-smoke proves the grade shape; resolve inline at build).

## Methodology critique

Structural lens (default `faffter-noon-methodology-structural`): this is a **leaf chain-gap-fill** under FAFF-145, blocked-by a now-MERGED FAFF-154 — no open dependency, unlocks nothing downstream itself (it records evidence). Its value is **coverage completeness** for the judgement-eval suite, not unlock value. The right-sizing is sound: deterministic runner (buildable unattended) + a human-supervised record step (correctly NOT auto-runnable) cleanly split, matching the FAFF-131/156/159/160 family precedent. The one structural risk is the **shared-runner coordination with FAFF-160** — two leaf tickets touching one new file; the spec resolves it by mandating one parameterised runner with an explicit build-order preference (FAFF-163 first) and a small-append second entry, which is the minimal-conflict shape. No cycle, no ghost-project pointer, no repeat-park history.

---

_Provenance: prepared **autonomously** by /faff-beep-boop (run 2026-06-16-05-13-59), spec slot faffter-dark-nlspec, appetite high. No human in the loop for this spec; the baseline-recording step it specifies is human-supervised by design._

```faff-contract:spec-readiness
{
  "confidence": "high",
  "provenance_present": true,
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ]
}
```

