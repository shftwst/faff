# Correct the re-baseline runbook and FAFF-614's instructions (FAFF-671)

> Spec: faffter-dark-nlspec · 2026-07-28 · interactive · confidence: high. Full spec on Linear FAFF-671.

This spec covers a documentation-correctness chore against `eval/README.md`'s "Re-baseline runbook" section and the Linear issue FAFF-614 that points at it, plus one small deterministic test that stops the same numbers going stale again. The audience is the build agent making the edits and the human reviewing the diff. Every factual claim below was verified first-hand against the working tree at `23ccf2d` (2026-07-28); line numbers refer to that state of `eval/README.md` (194 lines) and `eval/run-evals.mjs`.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** `eval/README.md`'s re-baseline runbook is not reference material anyone reads casually — it is the operating procedure for a multi-hour sweep that spends real money and cannot be un-spent. It was written at `1a9b6e8` (2026-07-23 16:08), ninety-five minutes before FAFF-318 landed at `1283c41` (17:43), and it has never caught up with that change or the four case-corpus additions since. An operator following it today would run the wrong command, expect the wrong model, budget for the wrong number of reps, and destroy their own crash-recovery state without ever being told they had a choice. Fixing prose is the whole job; the reason it is urgent is that the prose is load-bearing for a spend decision.

**Problem statement.** The runbook and FAFF-614's description both describe an `eval/` harness that stopped existing five days ago — no resume, 79 cases, a `claude-sonnet-4-6` model pin, and a `--only` failure mode the code no longer has. An operator picking up FAFF-614 opens these instructions first and gets nine separate wrong statements, one of which is a command that runs the sweep and writes no baseline at all. This change rewrites both against the code as it is, and adds a deterministic test so the arithmetic cannot drift again unnoticed.

### Design principles

**The runbook states what the code does, verified line by line — it never restates what a spec once decided.** Every one of the nine defects traces to the same root: the section was written from FAFF-319's spec text rather than from the harness, so it froze at spec time and the code moved. The implementer must open `eval/run-evals.mjs` and confirm each corrected sentence against the function that implements it, citing the line in the commit message rather than in the README itself (line numbers in prose are their own staleness source).

**One source of truth, and it lives in the repo.** FAFF-614 today restates the runbook's contents inline — five bullets duplicating five README points — which is exactly how the two drifted apart. After this change FAFF-614 points at `eval/README.md` and carries only what is specific to *that* run (the precondition, the model decision, what to commit). A reader must not be able to find two versions of the cost arithmetic.

**Traps are stated as traps, not as neutral facts.** The `--resume` correction is not "there is now a resume flag". It is "if your sweep dies and you re-run the plain command, you silently lose the ability to resume". A runbook that documents a capability without documenting how you forfeit it is worse than one that documents neither, because it invites the operator to reach for the plain command with false confidence.

### Reference context

| What it is | Where | Why it matters here |
|---|---|---|
| The runbook being corrected | `eval/README.md`, lines 151–194 (six numbered points), plus defects at lines 18, 39, 103, 148 | The file this ticket edits |
| The sweep orchestrator, the authority for every corrected claim | `eval/run-evals.mjs` | `updateBaseline` at :334, `foldInAndWriteBaseline` at :390, `resolveEvalModel` at :476, `BASE_REPS`/`MAX_REPS` at :21–22, `loadCases` at :82, CLI dispatch at :680 |
| The pinned eval model, currently `claude-opus-5` | `.faffrc.yaml` (`models:` → `eval:`) | Flipped from `claude-opus-4-8` in `969d0f0`, 2026-07-27 |
| The committed baseline whose `per_kind` block the gate reads | `eval/baselines/frontier.json` | Holds 14 kinds; its `meta` block (dated 2026-06-16) has **no `model` key** |
| The operator ticket that follows the runbook | Linear FAFF-614 | Description restates five runbook points inline, all stale |
| Existing resume test suite, the pattern for the new guard test | `test/eval-resume.test.mjs` (16 `test(` blocks) | Shows the deterministic, zero-spawn test style this repo uses for `eval/` |

**Scope statement.** This sits directly in front of FAFF-614 (the paid operator sweep) as one of its four open blockers, alongside FAFF-669 (arm the four unarmed kinds) and FAFF-670 (triage the seven never-reviewed oracles). It is the cheapest of the four and the only one the operator reads before doing anything else.

---

## 2. OUT OF SCOPE

**Running the sweep, or any part of it.** This ticket produces correct instructions; FAFF-614 produces the baseline. No model call, paid or free, is made by this work. Extension point: FAFF-614.

**Deciding which model the sweep runs on.** The choice between `claude-opus-5` (current config) and `claude-opus-4-8` (what ADR-0089's recorded production sweep used) is an operator spend-and-comparability call, not a documentation edit. This ticket surfaces the decision on FAFF-614 and makes the runbook state resolution accurately whichever way it goes. Extension point: the FAFF-614 comment this ticket posts; the decision itself is recorded there before the operator starts.

**Per-kind model lineage — recording or asserting which model produced which baseline row.** The sweep already stamps run-level `meta.model` from `stamp.model` (`run-evals.mjs:415`), so there is no recording gap at run level, and per-kind lineage is FAFF-638's subject. This ticket notes in the runbook that the *currently committed* baseline predates that stamping and carries no `model` key, so the operator knows the comparison they are about to break. It adds no assertion, warning, or pin. Extension point: FAFF-638.

**Arming the four unarmed eval kinds, and triaging the seven never-reviewed oracles.** Both are separately ticketed corpus-correctness work that also blocks FAFF-614. The runbook's corrected kind-gap sentence states the arithmetic (14 baseline kinds vs 29 corpus kinds) and nothing about whether those kinds are fit to measure. Extension points: FAFF-669 and FAFF-670.

**Editing `records/specs/2026-07-23-faff-319-calibrate-judgement-eval-oracles-design.md:109`.** It restates the same six elements including the 79-case figure and the no-resume framing, but it is explicitly time-scoped ("79 at spec time") and is a historical record of what FAFF-319 decided. Historical specs are not maintained against later code. Extension point: none — deliberately frozen.

**Adding a `--list` / `--dry-run` flag to `run-evals.mjs` so the operator can print the corpus totals before spending.** Genuinely useful, and the natural home for a "confirm before you spend" step, but it is a CLI feature with its own tests and usage-banner surface, not a doc correction. Extension point: a new flag beside `--cases-dir` in `main`'s dispatch, `run-evals.mjs:680`.

---

## 3. WHAT — the defect inventory, and what replaces each

### Vocabulary

| Term | Definition |
|---|---|
| The runbook | The `## Re-baseline runbook (FAFF-319) — the operator sweep` section, `eval/README.md:151–194`, six numbered points |
| The corpus | The 84 `.json` files in `eval/cases/`, spanning 29 distinct values of the case `kind` field |
| The progress file | `eval/report/frontier-sweep-progress.json`, written per completed kind by `updateBaseline`, read by `--resume`. `eval/report/` is gitignored, so it is durable-local, never committed |
| The gate gap | The kinds present in `eval/cases/` (29) but absent from `eval/baselines/frontier.json`'s `per_kind` block (14), so contributing nothing to the regression gate. Currently 15 |
| The plain sweep | `node eval/run-evals.mjs` with no baseline path — runs the full corpus, writes `eval/report/latest.json`, and touches no baseline |

### The defect inventory

Eleven edits across `eval/README.md`, plus two on Linear. The first two rows are defects the ticket's six points do not cover; both were found by reading the code and both are more severe than several items the ticket did list.

| Defect | Where | What it says now | What is actually true |
|---|---|---|---|
| **The documented command does not re-baseline.** Severity: this is the worst defect in the file. | `README:165` | `node eval/run-evals.mjs --update-baseline` with a trailing `# writes eval/baselines/frontier.json` comment | `--update-baseline` takes a **path argument**. `argFlag` (`:221`) returns `argv[i+1]`; with nothing after the flag that is `undefined`, so `main`'s `if (updatePath)` at `:681` is false and control falls through to the plain sweep. The operator pays for a multi-hour full-corpus run and gets `eval/report/latest.json` and **no baseline**. `docs/guide/releasing.md:27` already has the correct form |
| **Point 3's stated reason is now wrong** (its advice is still right) | `README:171–175` | "`--update-baseline` writes `per_kind` **wholesale** … `--only spec-verdict` would write a baseline containing *only* `spec-verdict` and **silently drop every other kind's row**" | FAFF-318 fixed exactly this. `foldInAndWriteBaseline` (`:390`) computes `complete = !only && …`; on the `--only` path it takes the else branch and **overlays** swept kinds onto the prior baseline (`:410`), retaining every un-swept row, and warns loudly. `--only` also sets `progressPath = null` (`:352`), so it never checkpoints and can never be resumed |
| Gate-section rep range, an older snapshot of the same arithmetic | `README:18` | "a ~**780–1,950**-run, multi-hour sweep" (39 cases × 20 / × 50) | `--gate --driver frontier` routes to `gateAgainst` (`:309`), which calls `loadCases()` unfiltered — the same 84-case corpus. The range is **1,680–4,200** |
| Pieces-table case count | `README:39` | "`EvalCase` fixtures + human oracles (12: 2 per kind)" | 84 files across 29 distinct kinds, roughly 2.9 per kind |
| Running-it cost warning | `README:103` | "~12 cases × K=20 base (+ escalation to ~50) ≈ 240+ reps" | 84 cases × 20 ≈ 1,680 base reps, escalating toward 4,200 |
| Stale future tense for shipped work | `README:148` | "the source material FAFF-318's resume/checkpoint **would consume**" | FAFF-318 shipped at `1283c41` and the machinery is live |
| The gate gap | `README:153–155` | "the **8** judgement-eval kinds still contribute **nothing** to the regression gate" | The 8 is a relic of FAFF-319's scope. `per_kind` holds **14** keys; the corpus holds **29** kinds; the gap is **15** |
| Model resolution | `README:169–171` | precedence `--model` > `models.eval` > "the baked-in `claude-sonnet-4-6`", read as though sonnet is what you get | The precedence is stated correctly but reads misleadingly. `.faffrc.yaml` sets `models.eval: claude-opus-5`, so `resolveEvalModel` (`:476`) always returns from the config lookup at `:485` and the `EVAL_MODEL_FALLBACK` at `:472` is unreachable in this repo |
| Point 4's cost arithmetic | `README:177–180` | "**79** live case files × **20** base reps ≈ **1,580** … worst case ≈ **3,950**" | **84** × 20 = **1,680**; × 50 = **4,200**. Stale by the five `holdout-seed-*` files FAFF-563 added at `927f5dd` |
| Point 5 in full | `README:182–187` | "**There is no resume — this is an accepted operating condition.** … If interruptions prove chronic, ship FAFF-318 first" | `--resume` is live: parsed at `:337`, wired at `:352–376`, in the usage banner at `:657`, covered by 16 tests in `test/eval-resume.test.mjs`. The trap the current text walks the operator into is described in HOW below |
| Point 6's artifact list | `README:189–194` | `eval/baselines/frontier.json` and the `judgements.jsonl` capture | Also `eval/report/frontier-sweep-progress.json`, written throughout the sweep and left on disk after both success and failure — the artifact `--resume` needs |
| FAFF-614's description | Linear | Restates five runbook points inline, every one of them stale | Points at the runbook, keeps only run-specific content |
| FAFF-614's title | Linear | "…for the 8 judgement-eval kinds (FAFF-319 runbook)" | Carries the same relic 8 as `README:153` |

### The freshness guard

A new deterministic test, `test/eval-readme-freshness.test.mjs`, derives the numbers from code and asserts they appear in the README. No process spawns, no model calls — it runs under the ordinary `node --test test/` glob alongside the other `eval-*` tests.

```
RECORD DerivedFreshnessFacts:
  case_count:     Integer   # loadCases().length
  kind_count:     Integer   # distinct `kind` across loadCases()
  base_reps:      Integer   # BASE_REPS export
  max_reps:       Integer   # MAX_REPS export
  baseline_kinds: Integer   # Object.keys(baseline.per_kind).length
  gate_gap:       Integer   # kind_count - baseline_kinds

  DERIVED base_total  = case_count * base_reps    # 1,680 today
  DERIVED worst_total = case_count * max_reps     # 4,200 today
```

Every one of these is already reachable: `loadCases` (`:82`), `BASE_REPS` (`:21`), `MAX_REPS` (`:22`) are exported, and the baseline is plain JSON on disk.

---

## 4. HOW — Behaviour

### Approach

Read `eval/run-evals.mjs` and `.faffrc.yaml` first, confirm each row of the defect inventory above against the code, then make eleven edits to `eval/README.md`, add one test file, and make two Linear edits plus one comment. Nothing else in `eval/README.md` needs touching — the Pieces table's other rows, the two-lanes section, the driver descriptions, the auth/isolation section and the raw-capture section were all checked against `cli-driver.mjs`, `live-driver.mjs`, `ollama-model.mjs` and the capture path and are accurate.

### Point 5, rewritten — the resume trap

This is the edit that carries the most operator risk, so it gets stated as a procedure rather than left to prose interpretation. What the operator needs to understand is that the plain command and the resume command are not "the same thing, one with recovery" — the plain command **actively destroys** the state the resume command needs, before it runs a single rep.

```
The truncation path, as implemented (run-evals.mjs:352-376):

PROCEDURE updateBaseline(argv):
  1. progressPath ← eval/report/frontier-sweep-progress.json
     IF --only was passed: progressPath ← null    # never checkpoints, never resumable
  2. IF progressPath is not null:
     a. IF --resume was passed AND the progress file exists:
        i.   Read it; throw if unparseable ("delete it and start fresh")
        ii.  Compare its stamp {driver, model, base_reps} against this run's
             → mismatch throws, refusing to blend two different sweeps
        iii. Keep each kind whose stored case-id set still matches the corpus
        iv.  Filter those kinds out of `cases` — run only what is missing
        v.   LEAVE THE PROGRESS FILE IN PLACE
     b. ELSE (no --resume, OR --resume with no file present):
        i.   IF --resume: warn "no progress file; running the full sweep"
        ii.  OVERWRITE the progress file with an empty {schema, stamp, kinds:{}}
             ← THE TRAP. Unconditional, before any rep runs.
```

So: an operator whose sweep dies at hour three, and who re-runs the plain `--update-baseline <path>` — precisely what point 5 currently instructs — does not merely redo the suite. They overwrite the record of which kinds already completed, and the run they could have resumed becomes one they cannot. The prior spend's judgement data survives in `judgements.jsonl`, but the resumability does not.

The replacement text must carry four things: `--resume` exists and is the correct response to an interruption; the plain command silently truncates the progress file first, so reach for `--resume` *before* re-running anything; the stamp must match, meaning a resumed run has to use the same driver, model and `--reps` as the run it continues, and a mismatch throws rather than blending; and `--only` never checkpoints, so a run with `--only` is never resumable.

**Anti-pattern:** rewriting point 5 as "FAFF-318 shipped, use `--resume`". Why: that is the half of the change that makes the operator *more* likely to lose progress, because it grants confidence in recovery without naming the one action that forfeits it.

### The model paragraph, rewritten

State the precedence as implemented, then state what it actually resolves to in this repo today, then describe the fallback as what it is:

- `--model` on the command line wins.
- Otherwise `faff config get models.eval`, which in this repo is set (`.faffrc.yaml`) and currently returns `claude-opus-5`.
- Only if that lookup returns empty or the config CLI is unavailable does the baked-in `claude-sonnet-4-6` apply — a safety net this repo's configuration never reaches, not the expected outcome.
- The run prints `[run-evals] frontier model: …` at start (`:497`). Confirm it matches the model recorded on FAFF-614 before letting it spend.

Add one sentence of comparability warning, without deciding anything: the currently committed `eval/baselines/frontier.json` `meta` block predates FAFF-315's pinning and carries **no `model` key**, and ADR-0089's recorded production sweep ran on `claude-opus-4-8`. The next `--update-baseline` will stamp whatever resolves at run time, and nothing in the harness compares that against the previous sweep or warns on a change.

**Anti-pattern:** writing "the model is `claude-opus-5`" as a flat statement of fact. Why: it is a config value that changed four days ago in a commit about something else entirely (`969d0f0`, whose stated subject was codex spawn family and faffrc slots), and hardcoding today's value into prose is the identical failure this whole ticket exists to fix. Describe the resolution and name the current value as current.

### Point 3, rewritten

Keep the instruction — do not pass `--only` with `--update-baseline` — and replace the reason. Two accurate reasons remain: a run narrowed by `--only` produces a **partial** baseline (`foldInAndWriteBaseline` overlays the swept kinds onto the prior ones and prints a `⚠ PARTIAL baseline` warning naming the kinds still missing), and it sets `progressPath = null`, so it checkpoints nothing and cannot be resumed. Say plainly that the older warning about silently dropping every other kind's row no longer applies — FAFF-318's overlay fixed it — so a reader who remembers the old text knows why it changed. Re-baseline is still always the full suite.

### The freshness guard, behaviour

```
PROCEDURE eval-readme-freshness test:
  1. facts ← derive from loadCases(), BASE_REPS, MAX_REPS, and the parsed
             eval/baselines/frontier.json
  2. readme ← read eval/README.md as text
  3. FOR each expected number in {case_count, kind_count, base_total,
                                  worst_total, gate_gap}:
     a. Format it the way the README writes numbers (thousands separator
        for values ≥ 1000, e.g. "1,680")
     b. Assert the README contains it
     c. On failure, the assertion message names the derived value, where it
        came from, and which README section needs updating — so the next
        person who adds a case file is told what to edit, not just that
        something mismatched
```

The check is containment, not position: it asserts the correct numbers are present somewhere in the file, and does not pin them to line numbers or surrounding wording. That is deliberate — an assertion coupled to phrasing would fail on every innocuous prose edit and get deleted, which is worse than no guard.

**Anti-pattern:** generating the README's numbers from code at build time, or templating the section. Why: `eval/README.md` is a hand-written document read by humans in a git diff; a generated block would need a generator, a check-in step, and a CI job to stay honest, which is a great deal of machinery to protect five integers.

### Failure modes

**The guard test passes for the wrong reason.** A number like `84` is short enough to appear incidentally elsewhere in a 194-line file — in a line reference, a percentage, a date. The test would then be satisfied by a coincidence while point 4 still said 79. How you would know: deliberately break it during development — edit point 4 to say 79 and confirm the test fails. If it does not, the assertion needs to be scoped to the runbook section rather than the whole file. What it means: narrow the search window to the runbook section's text before landing, rather than shipping a guard that cannot fail.

**The numbers move again between this ticket landing and FAFF-614 running.** FAFF-669 and FAFF-670 both also block FAFF-614 and both may change the corpus — FAFF-670 explicitly contemplates excluding the five `holdout-seed-*` files, which would take the corpus from 84 to 79 and the rep range from 1,680–4,200 to 1,580–3,950. How you would know: the guard test fails on their branch, which is exactly the intended behaviour. What it means: proceed. The guard makes that a caught, one-line fix on whichever ticket changes the corpus, rather than another silent five-day drift. It is worth saying so in the corrected point 4, so that whoever hits the failing test understands they are meant to update the prose and not delete the assertion.

**The operator never records the model decision and runs the sweep anyway.** This ticket can post the question on FAFF-614; it cannot make anyone answer it. How you would know: the resulting `frontier.json` `meta.model` is whatever `.faffrc.yaml` happened to hold, and FAFF-636's cross-model diff has no recorded intent to compare against. What it means: accept it. FAFF-614 has three other open blockers, so there is time; and the corrected runbook's own "confirm the printed model before letting it spend" step puts the question in front of the operator at the last possible moment regardless.

---

## 5. Scenarios

Two of the corrections carry non-obvious observable outcomes; the rest are prose replacements verifiable by reading the file, and get no scenario.

```
Given an operator following the corrected runbook's point 2 verbatim
When they run the command exactly as written in the README code block
Then control reaches updateBaseline (not the plain-sweep fall-through)
 And eval/baselines/frontier.json is the file written at the end
```

```
Given a corpus that has grown or shrunk since eval/README.md was last edited
When `node --test test/` runs
Then test/eval-readme-freshness.test.mjs fails
 And its message names the derived case count, the derived rep totals, and
     the README section that needs updating
```

- The corrected runbook contains no statement that `eval/` has no resume capability, and no statement that FAFF-318 is unshipped or optional.
- No number in `eval/README.md` disagrees with what `eval/run-evals.mjs` and `eval/cases/` produce at the commit that lands this change.
- FAFF-614's description contains no restatement of the runbook's cost arithmetic, model precedence, or resume behaviour — only a pointer to `eval/README.md` and content specific to that run.

---

## 6. Design Decision Rationale

**Where does the correction land — the README only, or the README and FAFF-614?** Options: fix `eval/README.md` and leave FAFF-614 alone (smallest diff, but the ticket the operator actually opens still carries five stale bullets); fix both, with FAFF-614 reduced to a pointer; or fold the runbook into FAFF-614 and delete the README section (the runbook then lives outside the repo, where no test can guard it and it is invisible in a code review). **Chosen:** fix both, with FAFF-614 reduced to a pointer plus run-specific content — the ticket's own acceptance asks for "one source rather than two drifting copies", and the repo is the right home because it is the copy that can be tested and reviewed.

**The command at `README:165` is missing its path argument — fix it here, or file it?** It is not on the ticket's list of six, and adding to a chore's scope deserves justification. But it is discovered by reading the same lines this ticket is already rewriting, it is a one-token fix, and its consequence is the most expensive failure in the whole document: a multi-hour paid run that produces no baseline. **Chosen:** fix it here, and call it out explicitly in the commit message and PR description as a defect found beyond the ticket's list — filing it separately would leave a known-broken command in a runbook this very change is touching.

**Point 3's stated reason is stale in the operator's favour — rewrite it, or leave it as a harmless over-warning?** Leaving it is tempting: the advice ("never `--only` with `--update-baseline`") is still correct, and an over-strict warning costs nothing operationally. But the reason given is now false, and a runbook containing a demonstrably false mechanism trains the reader to distrust the rest of it — which matters enormously in a document whose other points they must follow exactly. **Chosen:** keep the instruction, replace the reason with the two that still hold (partial baseline via the overlay path, and no checkpointing because `--only` sets `progressPath = null`), and note that the old wholesale-drop failure was fixed by FAFF-318.

**How much of `--resume` does point 5 need to describe?** Options: a one-liner ("`--resume` shipped; use it"); the full flag semantics; or the flag plus the truncation trap and the stamp-match constraint. The one-liner is the dangerous option — it grants recovery confidence without naming the action that forfeits recovery. **Chosen:** flag, trap, and stamp constraint, with the trap stated first — the operator reaching for point 5 has just had a sweep die, and the first thing they need to be told is what *not* to type.

**How should the model paragraph describe `claude-sonnet-4-6`?** Options: leave the precedence chain as-is (logically correct, but a reader reasonably concludes sonnet is what they get); state only the current resolved value (accurate today, stale the next time `.faffrc.yaml` changes — the exact failure this ticket is fixing); or state the precedence, name what it resolves to today, and describe the baked-in value as an unreachable safety net. **Chosen:** the third. It stays true when the config changes and still tells today's operator what to expect on screen.

**Which model should the sweep actually run on — `claude-opus-5` or `claude-opus-4-8`?** This is a genuine decision with real consequences: `claude-opus-5` is materially more expensive across 1,680–4,200 reps, and it is not comparable to ADR-0089's recorded production sweep on `claude-opus-4-8`, which in turn shapes what FAFF-636's cross-model diff can claim. It also arrived incidentally — `969d0f0`'s stated subject was codex spawn family and faffrc slots, not a model bump. But it is a spend-and-comparability judgement belonging to the person paying, and no documentation edit can substitute for it. **Chosen:** surface it, do not decide it. This ticket posts the question as a comment on FAFF-614 — laying out the cost delta, the ADR-0089 comparability break, the fact that the committed baseline carries no `model` key at all, and the FAFF-636 consequence — and makes the runbook's confirm-the-printed-model step point at that recorded decision. The build agent must not change `.faffrc.yaml`, must not add a pin or an assertion, and must not treat the absence of an answer as a reason to stop: this ticket's own work is complete once the question is recorded. The decision is FAFF-614's precondition, not this ticket's.

**Does the staleness guard land here, or as a follow-up?** The ticket sets its own bar: "if it is more than an hour, follow-up." Everything the guard needs is already exported (`loadCases`, `BASE_REPS`, `MAX_REPS`) and the baseline is plain JSON, so the test is a short file with no new machinery and no new dependency. Against that, there is no precedent in `test/` for guarding a document's numbers, and a badly-scoped assertion could become a nuisance that gets deleted. **Chosen:** in scope, with the containment-not-position discipline described in HOW. The case for deferring rests on it being speculative, and it is not — the corpus grew by five files in five days and nobody noticed, which is the entire ticket. Deferring the guard means shipping correct numbers with the same zero protection that let them rot the first time.

**How does the guard assert — regex over the whole file, scoped to the runbook section, or a structured extraction?** Whole-file containment is simplest but can pass on a coincidental match; a structured extraction (parsing the numbers out of specific sentences) is precise but breaks on any rephrasing; section-scoped containment sits between them. **Chosen:** containment scoped to the runbook section's text, verified during development by deliberately reverting point 4 to `79` and confirming the test fails. A guard that cannot be made to fail is not a guard.

**What about `records/specs/2026-07-23-faff-319-…-design.md:109`, which restates the same six elements?** It is the one real in-repo duplicate of the runbook's content — no skill file or `AGENTS.md` duplicates it. But it is a historical design record, explicitly time-scoped ("79 at spec time"). **Chosen:** leave it entirely untouched, and add nothing to it. Historical specs record what was decided when; editing them to match later code destroys the record. Mention it in the PR description so a reviewer grepping for `1,580` is not surprised to find a second hit.

**Should FAFF-614's title change too?** The title reads "…for the 8 judgement-eval kinds", carrying the same relic 8 as `README:153`, and it is the first thing anyone sees in a backlog view. **Chosen:** yes — retitle to drop the stale count, since a corrected description under a stale title reproduces the drift in the most visible place. Keep the FAFF-319 runbook reference.

---

## 7. Open Questions and Assumptions

**Open Questions.** None block this build. The model choice is deliberately closed for build purposes — this ticket records the question on FAFF-614 and proceeds; the operator answers it there before spending, per the decision above.

**Assumptions.**

**Assumes:** the build agent has Linear write access to FAFF-614 (edit description, edit title, post a comment). Validate before starting: read FAFF-614 and confirm a write is possible in this environment. If it is not, make the `eval/README.md` and test changes, and leave the three FAFF-614 actions as a clearly-stated, copy-pasteable block in the PR description for a human to apply — do not silently drop them, and do not treat their absence as a reason to park the README work.

---

## 8. DONE — Definition of Done

### From WHY (the pain is gone)
- [ ] Reading `eval/README.md` end to end surfaces no statement contradicted by `eval/run-evals.mjs`, `eval/cases/`, `eval/baselines/frontier.json`, or `.faffrc.yaml` at the landing commit.
- [ ] The commit message cites the `run-evals.mjs` function or line that authorises each corrected claim.

### From WHAT (the defect inventory — each checkable by reading the file)
- [ ] `README:165`'s command includes its baseline path: `node eval/run-evals.mjs --update-baseline eval/baselines/frontier.json`.
- [ ] `README:18` states the frontier reverify as a **1,680–4,200**-run sweep.
- [ ] `README:39`'s Pieces row states 84 case files across 29 kinds, not "12: 2 per kind".
- [ ] `README:103`'s warning states 84 cases × 20 base ≈ 1,680 reps, escalating toward 4,200.
- [ ] `README:148` describes FAFF-318's resume/checkpoint as shipped, in the past or present tense.
- [ ] `README:153–155` states the gate gap as **15** kinds — 29 in `eval/cases/`, 14 in the baseline's `per_kind` — with no surviving "8".
- [ ] Point 4 states **84** case files, **1,680** base reps, **4,200** worst case, and notes that the guard test will flag these if the corpus changes.
- [ ] Point 6 lists `eval/report/frontier-sweep-progress.json` alongside `eval/baselines/frontier.json` and the `judgements.jsonl` capture, and notes `eval/report/` is gitignored so the progress file is durable-local.

### From HOW (behaviour)
- [ ] Point 5 states that `--resume` exists; that a plain `--update-baseline` overwrites the progress file before running any rep, so reaching for it after an interruption forfeits resumability; that a resumed run must match the prior run's driver, model and `--reps` or it throws rather than blending; and that `--only` never checkpoints.
- [ ] Point 5 contains no claim that resume does not exist, and no "ship FAFF-318 first" remedy.
- [ ] The model paragraph gives the precedence as `--model` > `models.eval` > baked-in fallback, names `claude-opus-5` as what `models.eval` currently returns, describes `claude-sonnet-4-6` as a safety net this repo's config never reaches, and notes the committed baseline's `meta` has no `model` key while ADR-0089's sweep used `claude-opus-4-8`.
- [ ] Point 3 keeps "never `--only` with `--update-baseline`" and gives the partial-baseline and no-checkpointing reasons, replacing the wholesale-drop claim.
- [ ] `.faffrc.yaml` is unmodified; no model pin, assertion, or lineage check was added anywhere.

### From HOW (the freshness guard)
- [ ] `test/eval-readme-freshness.test.mjs` exists, derives case count, kind count, base and worst rep totals, and the gate gap from `loadCases` / `BASE_REPS` / `MAX_REPS` / the baseline JSON, and asserts each appears in the runbook section.
- [ ] The test spawns no process and makes no model call; `node --test test/` passes.
- [ ] The test was proven to fail: reverting point 4's case count to 79 makes it fail with a message naming the derived value and the section to update.

### From the decisions (Linear side)
- [ ] FAFF-614's description points at `eval/README.md` → Re-baseline runbook, and restates none of the cost arithmetic, model precedence, or resume behaviour.
- [ ] FAFF-614's description retains what is specific to that run: the un-nested prohibition, the FAFF-319 precondition, what to keep and commit.
- [ ] FAFF-614's title no longer says "8 judgement-eval kinds".
- [ ] A comment on FAFF-614 records the model question — `claude-opus-5` vs `claude-opus-4-8`, the cost delta across 1,680–4,200 reps, the ADR-0089 comparability break, the unlabelled current baseline, and the FAFF-636 consequence — as a decision the operator makes before starting.
- [ ] `records/specs/2026-07-23-faff-319-calibrate-judgement-eval-oracles-design.md` is untouched, and the PR description says why.

### Integration smoke test

```
PROCEDURE verify the corrected runbook end to end:
  1. Extract the command from README point 2's code block, verbatim.
  2. Confirm by inspection of run-evals.mjs:680-681 that argFlag returns a
     non-empty path for that argv, so `if (updatePath)` is true and control
     reaches updateBaseline rather than the plain-sweep fall-through.
     (Inspection only — this sweep is operator-owned and must NOT be run.)
  3. Run `node --test test/` — eval-readme-freshness passes, and every
     existing eval-* test still passes untouched.
  4. Grep eval/README.md for "79", "1,580", "3,950", "780", "1,950", "240",
     and "no resume" — all absent from the runbook section.
  5. Grep eval/README.md for "1,680" and "4,200" — each present at least
     twice (the gate section and point 4).
```

confidence: high
