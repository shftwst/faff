# FAFF-166 — Record the carved frontier baselines (verdict-build · shaping · decomposition · confidence-fuzz)

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high. Full spec on Linear FAFF-166.

*Design spec for the build agent and human reviewers. This is a **measurement-and-record** ticket: it runs existing eval runners against the frontier model and records the resulting baselines. No production code change is required — every runner and case already exists.*

## 1. WHY — Problem and Principles

**Problem statement.** Five frontier-baseline carve-outs were deferred across this run's shipped tickets (FAFF-155/157/160/161/163), leaving new eval kinds with no recorded regression reference. FAFF-160's credential-forwarding fix unblocked the live-driver runner, so the deferred sweeps can now run unattended. This ticket runs them and records the numbers — one consolidated baseline ticket instead of five (the FAFF-156 consolidation precedent).

**Design principles:**

- **Never fabricate numbers.** Every recorded figure must come from a real `claude -p` sweep that ran to `status: complete`. A sweep that errors (auth, spawn) records *the error and that no numbers were taken* — never an invented or guessed value. This is the load-bearing principle; an unverifiable baseline is worse than none.
- **Raw stays gitignored; only the summary table is committed.** The raw per-rep JSON lives under `eval/report/` (gitignored). The committable artifact is a markdown table copied into a dated ADR-0004 addendum — the immutable record. Mirror the FAFF-156 / FAFF-163 recording pattern exactly.
- **Smoke before sweep.** Each kind runs a 2-rep smoke first to confirm rendering, envelope parse, and auth before spending a full K=20×N-rep sweep. Cheap insurance against the FAFF-163 "Not logged in" failure mode burning a full run.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `eval/run-live-evals.mjs` | Node (ESM) | Live-driver runner; `--kind` ∈ {reconciliation, routing, verdict-build}. Writes `eval/report/{kind}-live-baseline.json` + `.md` |
| `eval/run-evals.mjs` | Node (ESM) | Black-box runner; `--only ID`, `--reps N`, default `--driver frontier`. Writes `eval/report/latest.json` |
| `eval/grader.mjs` | Node (ESM) | `KINDS` includes shaping/decomposition (gloss-rubric, advisory) and verdict-build (closed-set) |
| `docs/adr/0004-judgement-evals-spike.md` | Markdown | The committable record; this ticket appends a dated addendum |
| `eval/report/FAFF-163-reconciliation-baseline.md` | Markdown | The exact recording format to mirror |

**Scope statement.** This sits in the skill-behaviour harness (FAFF-145 family), extending the standing frontier regression net to the kinds added late in this run.

## 2. OUT OF SCOPE

- **reconciliation baseline** — *already recorded.* The ticket lists it as "now unblocked", but FAFF-163's ADR-0004 addendum (2026-06-16T11:42Z, *after* this ticket was filed) already recorded reconciliation-001/002/003 at a hard **1.00/1.00** post-FAFF-160. No re-run needed. *Extension point:* re-running is a no-op refresh; only repeat it if the reconciliation cases or fixtures change.
- **routing baseline** — already recorded by FAFF-160 (1.00/1.00, ADR-0004 full-suite addendum). Out of scope.
- **New code / new LIVE_KINDS adapters** — every runner and case this ticket needs already exists. No adapter registration, no new case files. *Extension point:* if a future kind needs the live-driver lane, append to `LIVE_KINDS` in `eval/run-live-evals.mjs` (the open registry).
- **Promoting any eval to a hard CI gate** — these baselines are a standing regression *reference*, not a build-blocking assertion. *Extension point:* gating is a separate decision once a kind proves stable across runs.
- **Local / ollama comparison runs** — frontier baseline only. *Extension point:* `node eval/run-evals.mjs --compare` (ADR-0004 local-lane work).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Live-driver lane | Kinds whose fixtures carry a non-backlog shape driven through `runSkill` + a per-kind adapter; run via `run-live-evals.mjs`. Cases live in `eval/cases-live/`. |
| Black-box lane | Kinds rendered as a prompt + extracted rubric and graded against a fixed oracle; run via `run-evals.mjs`. Cases live in `eval/cases/`. |
| Baseline | A recorded `(accuracy, stability)` per case/kind from a real frontier sweep, plus escalation/format metadata. |
| Addendum | A dated, append-only section in ADR-0004 holding the committable summary table. |

**The four baselines to record (the corrected lane assignment):**

```
RECORD BaselineRun:
  kind:        verdict-build | shaping | decomposition | confidence-fuzz
  lane:        live-driver | black-box      # CORRECTED from the ticket's command line
  cases:       Set<case_id>                 # must exist before the run
  command:     the exact runner invocation
  raw_report:  eval/report/*  (gitignored)
  recorded_in: ADR-0004 addendum table       # committable
```

| Kind | Lane | Cases | Run command |
|---|---|---|---|
| verdict-build | **live-driver** | verdict-build-001 (`cases-live/`) | `node eval/run-live-evals.mjs --kind verdict-build` |
| shaping | **black-box** | shaping-001/002 (`cases/`) | full-suite run, or `--only shaping-001` / `--only shaping-002` |
| decomposition | **black-box** | decomposition-001/002 (`cases/`) | full-suite run, or `--only decomposition-001/002` |
| confidence-fuzz | **black-box** | confidence-004/005/006 (`cases/`) | full-suite run, or `--only confidence-004` (×3) |

**Design decision — black-box: full-suite run vs targeted `--only` runs.**

- *Full suite* (`node eval/run-evals.mjs`, no `--only`): one command captures shaping + decomposition + confidence-004/005/006 *and* refreshes every other kind's standing net; `per_kind` aggregates confidence over all six fixtures (exactly what FAFF-157 wanted). Costs ~30+ cases × K reps. Mirrors the 2026-06-16 full-suite addendum precedent.
- *Targeted `--only`*: precise and cheaper (only the 7 new cases), but `--only` takes a single id, so it's 7 separate runs and confidence `per_kind` reflects one case at a time.

**Chosen:** one **full-suite black-box run** for the three black-box kinds, plus one **`--kind verdict-build` live-driver run**. Rationale: two commands total, mirrors the established full-suite addendum precedent, and gives the clean confidence-over-6-fixtures aggregate FAFF-157 asked for. The smoke-first principle still applies (a 2-rep `--only` smoke per new kind before the full suite).

## 4. HOW — Behavior

**Architecture and approach.** No code is written. The build agent (with a logged-in `claude` session) runs the two sweeps, reads the gitignored reports, and appends one dated addendum to ADR-0004 with the summary tables. The PR is docs-only (the ADR addendum); the raw `eval/report/*` files stay gitignored and uncommitted.

**Procedure:**

```
PROCEDURE record_carved_baselines():
  0. PRECONDITION: a valid frontier OAuth session exists
     (~/.claude/.credentials.json present; `claude` logged in).
     IF absent -> STOP and report "Not logged in" (the FAFF-163 failure mode); do not invent numbers.

  1. SMOKE each new kind (2 reps, confirms render + envelope + auth):
     a. node eval/run-live-evals.mjs --kind verdict-build --reps 2
     b. node eval/run-evals.mjs --only shaping-001 --reps 2
     c. node eval/run-evals.mjs --only decomposition-001 --reps 2
     d. node eval/run-evals.mjs --only confidence-004 --reps 2
     IF any smoke errors on auth/render/parse -> fix the environment, re-smoke. Do not proceed to the sweep.

  2. SWEEP (real baselines, K=20 base -> escalate to 50 on disagreement):
     a. LIVE-DRIVER:  node eval/run-live-evals.mjs --kind verdict-build
        -> eval/report/verdict-build-live-baseline.json + .md  (gitignored)
     b. BLACK-BOX:    node eval/run-evals.mjs
        -> eval/report/latest.json  (gitignored)
        captures shaping, decomposition, confidence (001-006), + the rest of the suite

  3. CONFIRM each sweep reported status = "complete" and config isolation held
     (parent ~/.claude.json untouched). A non-complete status is NOT recordable as a baseline.

  4. RECORD — append ONE dated addendum to docs/adr/0004-judgement-evals-spike.md:
     - Headline: run date/time, driver (claude -p frontier / Opus), reps config, isolation status,
       and the gitignored report paths.
     - verdict-build table: per-case accuracy / stability / reps / escalated.
     - shaping + decomposition + confidence-fuzz: per-case (or per_kind) accuracy / stability /
       format / escalated, lifted from latest.json's per_kind / per-case metrics.
     - A short "what this confirms / wobbles worth flagging" finding paragraph (mirror prior addenda).
     - Scope caveat: black-box numbers are model+rubric+fixture, not skill-as-orchestrated;
       verdict-build is the live-driver lane.
     - Cross-reference: note reconciliation + routing already recorded (FAFF-163 / FAFF-160).
```

**Edge cases and error handling:**

- **Auth failure (`Not logged in`)** — terminal for the run. Report it, record no numbers. (FAFF-160's `frontierOpts(...)` cred-forwarding is in place, so this should not recur with a logged-in session; the smoke step catches it early if it does.)
- **A kind wobbles (escalates to 50, sub-1.00)** — this is a *valid recordable result*, not an error. Record the real figure and flag it in the finding paragraph (as the confidence-001 0.80 wobble was flagged). Do not re-run to chase a cleaner number.
- **Smoke renders the wrong prompt for shaping/decomposition** — would indicate a missing render branch; not expected (branches verified at `cli-driver.mjs:471-479`), but the smoke exists to catch it before the full sweep.

**Anti-pattern:** running `node eval/run-live-evals.mjs --kind shaping`. Why: shaping/decomposition are **not** in `LIVE_KINDS` (only reconciliation/routing/verdict-build are) and have no `cases-live/` fixtures — that command fails on an unknown kind. They are black-box kinds; run them via `run-evals.mjs`.

**Anti-pattern:** committing `eval/report/*.json` or `*.md`. Why: that directory is gitignored by design (`.gitignore:18`); only the ADR addendum table is committed.

## 5. SCENARIOS

```
Given a logged-in frontier session and the existing verdict-build-001 live case
When `node eval/run-live-evals.mjs --kind verdict-build` runs to completion
Then eval/report/verdict-build-live-baseline.{json,md} exist with a real per-case accuracy/stability,
     and config isolation held (parent ~/.claude.json untouched)
```

```
Given the existing shaping/decomposition/confidence-004..006 black-box cases
When `node eval/run-evals.mjs` runs to status "complete"
Then eval/report/latest.json carries per_kind metrics for shaping, decomposition, and confidence (over all six fixtures)
```

```
Given both sweeps completed with real numbers
When the build agent records results
Then docs/adr/0004-judgement-evals-spike.md gains exactly one dated addendum containing the verdict-build,
     shaping, decomposition, and confidence-fuzz tables, and no eval/report/* file is staged for commit
```

```
Constraint: every recorded figure traces to a sweep with status = "complete"; no figure is invented,
estimated, or carried over from a sweep that errored.
```

## 6. DESIGN DECISION RATIONALE

**Which kinds does FAFF-166 actually record?**
- Options: (a) all five carve-outs as listed; (b) only the kinds not yet recorded.
- reconciliation (FAFF-163) and routing (FAFF-160) were recorded *after* this ticket was filed.
- **Chosen:** record **verdict-build, shaping, decomposition, confidence-fuzz** — rationale: the other two carve-outs are already discharged in ADR-0004; re-running them is a no-op. The addendum cross-references them so the consolidation is complete on paper.

**Which lane for shaping/decomposition?**
- The ticket's command line says `run-live-evals.mjs --kind`. Code says otherwise: `LIVE_KINDS` lacks them; `cli-driver.mjs` has black-box render branches for them (`:471-479`).
- **Chosen:** black-box via `run-evals.mjs` — rationale: grounded in the code; the ticket's command was an error carried from the live-driver-sibling framing.

**Full-suite vs targeted black-box run?**
- **Chosen:** full suite — rationale: two commands total, matches the precedent addendum, and yields the confidence-over-6-fixtures aggregate FAFF-157 wanted; smoke-first contains the extra cost risk. (Targeted `--only` documented as the cheaper alternative if an operator wants to minimise tokens.)

**Numbers committability?**
- **Chosen:** raw JSON gitignored, summary table committed in the ADR addendum — rationale: the established FAFF-156/163 pattern; keeps the repo free of churny per-rep blobs while preserving the durable record.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking.

**Assumptions:**

- **Assumes:** a valid frontier OAuth session exists (`~/.claude/.credentials.json` present, `claude` logged in). *Validation:* the step-1 2-rep smoke authenticates cleanly; if it returns `Not logged in`, run `claude` login before the sweep. (FAFF-160's `frontierOpts(...)` forwarding makes this work once a session exists.)
- **Assumes:** the shaping/decomposition black-box render branches produce a sensible prompt for their fixtures. *Validation:* the step-1 smoke output for shaping-001/decomposition-001 parses to a valid envelope; verified statically at `cli-driver.mjs:471-479`.
- **Assumes:** this is a human-supervised run (real `claude -p` token cost). *Validation:* the ticket carries `faff-chain-gap-fill` only, no `faff-automate` — it is not autonomous-eligible until blessed.

## 8. DONE — Definition of Done

### From WHY
- [ ] Every recorded figure comes from a sweep with `status: complete`; no fabricated/estimated numbers anywhere in the addendum.
- [ ] Raw reports remain under gitignored `eval/report/`; only the ADR addendum is committed.

### From WHAT / HOW (the sweeps)
- [ ] `node eval/run-live-evals.mjs --kind verdict-build` ran to completion; `eval/report/verdict-build-live-baseline.{json,md}` exist.
- [ ] `node eval/run-evals.mjs` (full suite) ran to `status: complete`; `eval/report/latest.json` carries `per_kind` metrics for shaping, decomposition, and confidence (001-006).
- [ ] A 2-rep smoke ran per new kind before each full sweep.
- [ ] Config isolation held (parent `~/.claude.json` untouched) across both sweeps.

### From HOW (recording)
- [ ] Exactly one dated addendum appended to `docs/adr/0004-judgement-evals-spike.md`.
- [ ] Addendum contains per-case tables for verdict-build, shaping, decomposition, and confidence-004/005/006 (accuracy / stability / format / escalated), a finding paragraph, and the black-box-vs-live-driver scope caveat.
- [ ] Addendum cross-references reconciliation (FAFF-163) and routing (FAFF-160) as already recorded.
- [ ] No `eval/report/*` file is staged for commit.

### From HOW (edge cases)
- [ ] A wobbling kind (sub-1.00 / escalated) is recorded with its real figure and flagged in the finding paragraph — not re-run to chase a cleaner number.
- [ ] An auth failure stops the run and is reported, with no numbers recorded.

**Integration smoke test:**
```
node eval/run-live-evals.mjs --kind verdict-build --reps 2   # completes, writes a report, no "Not logged in"
-> if this works, auth + forwarding + the verdict-build adapter are all connected; the full sweeps are safe to run.
```

confidence: high
