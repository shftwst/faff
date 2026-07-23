# Spec — FAFF-540: `--converge` non-convergence backstop counts filings, not admissions

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-540.

This spec is for the build agent hardening `/faff-beep-boop`'s within-run convergence backstop, and for the human reviewing that change. It is a **prose-only correctness fix** to one orchestrator skill file — no CLI or code change. The verification that established "prose-only" is recorded in the WHY below so the reviewer can confirm it without re-deriving it.

## 1. WHY — Problem and Principles

**The load-bearing model.** Under `--converge`, a `/faff-beep-boop` run keeps re-entering build waves until both bottom-up tributaries (execution-discovered scope and chain-unlocks) run dry. A safety counter — `no_progress_waves` — is meant to catch a loop that keeps *re-entering* without actually converging, and at `K = convergence.max_waves` (default 6) it fires the `non-convergence` escalate through `faff run-done`. That counter's whole value is that it measures **genuine convergence progress**. The bug is that it measures the wrong thing.

**Problem statement.** The backstop resets `no_progress_waves` to 0 whenever `filed_this_wave > 0` — i.e. whenever the wave *filed* any execution-discovered ticket. But under the `opt-in` automation default (faff's shipped default), an autonomously-filed intake / chain-gap ticket lands in Backlog **without** `faff-automate` (correct — eligibility is the human's tracker act; the filing path literally cannot write that label, FAFF-218). Such a ticket can never be admitted to a build queue *this run* — it is file-and-defer work, not this-run convergence. So filing purely-unbuildable tickets is counted as progress it isn't: the counter is held open by work that will never build this run, and the `non-convergence` escalate that should eventually fire is deferred, letting a genuinely-stalled `--converge` run extend past useful life.

**Verification done (why this is prose-only).** The `no_progress_waves` counter, its reset/increment rule, and `filed_this_wave` exist **only in orchestrator prose** in `plugin/skills/faff-beep-boop/SKILL.md` (the non-convergence backstop paragraph in step 8.5, and the tracking sentence in step 8.0). They are **not** implemented in any CLI: `faff run-done` receives a pre-computed `--non-convergence` boolean and nothing more (`plugin/skills/faff/bin/lib/run-done.js` — `non_convergence: args.includes("--non-convergence")`, escalate rung covered by `--selftest`, which passes). `grep` for `no_progress_waves` / `filed_this_wave` across `plugin/skills/faff/bin/` returns no code hits. Therefore the orchestrator decides *when* to pass `--non-convergence`, and the defect is entirely in that decision's wording. The fix corrects the prose predicate; no code or CLI test changes.

**Design principle — measure convergence by admission, not by filing.** In-run convergence progress on the discovered-scope tributary happens only when a filed ticket is actually **admitted to a build queue this run**. Under `opt-in` that never happens; under `opt-out` (or when a human cranks a filed ticket up between waves) it does. So the single honest progress signal for *both* tributaries is: **did this wave admit at least one issue to the build queue?** A chain-unlock admits; an eligible discovered-scope filing admits; an unbuildable filing does not. This collapses the two-disjunct rule to one correct signal.

**Design principle — preserve the deep-chain-drain reset.** A run productively draining a long chain (building chain-unlocks, filing no *new* discovered items) must **not** false-escalate. It doesn't: chain-unlocks are admissions, so the admission signal still resets on them. The backstop must catch only a re-entry with genuinely no admitted progress on either axis.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` (step 8.5 non-convergence backstop; step 8.0 filing) | Markdown (skill prose) | The **only** file this change edits — the reset predicate + the `filed_this_wave` framing. |
| `plugin/skills/faff/bin/lib/run-done.js` | JS (pure CLI) | The terminating predicate that consumes `--non-convergence`. Read to confirm the counter is not in code. **Unchanged.** |

**Scope statement.** This tightens one safety counter inside the opt-in `--converge` loop; it changes nothing about the normal dryness/budget termination, the file-and-defer fallback, or the `run-done` interface.

## 2. OUT OF SCOPE

- **Whether `--converge` should default ON (FAFF-534, Todo).** Independent design decision. This fix hardens the backstop regardless of the default; if `--converge` later defaults ON it only makes the fix matter more. Extension point: FAFF-534.
- **Any change to `faff run-done` or its `--non-convergence` semantics.** The predicate already escalates correctly on the boolean; only the orchestrator's decision to pass it is wrong. Extension point: `run-done.js` if the escalate mapping ever changes.
- **Changing `convergence.max_waves` (default 6) or making the cap the primary exit.** The cap stays a reported runaway backstop; dryness + budget remain the normal exit. Extension point: the budget/dryness prose in step 8.5.
- **Reworking `filed_this_wave` logging or the wave-log schema.** `filed_this_wave` remains a logged diagnostic; only its role in the *reset* changes.

## 3. WHAT — Vocabulary and the corrected rule

**Vocabulary.**

| Term | Definition |
|---|---|
| `filed_this_wave` | Count of new concrete execution-discovered items filed as Backlog tickets during this wave's step-8.0 pass. A logged diagnostic; under `opt-in` these are unbuildable (no `faff-automate`). |
| newly-admitted issue | An issue appended to this wave's (or the next wave's re-assembled) build queue's `admitted` set — a `fire-and-forget`/`likely-fire`-verdict chain-unlock, or a discovered-scope filing that passed the step-8.3 automation-eligibility filter. |
| `no_progress_waves` | Ledger counter of consecutive wave re-entries that admitted no new work on either tributary. At `K = convergence.max_waves` it drives `--non-convergence` → `run-done` escalate. |

**The corrected reset/increment predicate** (replaces the current `filed_this_wave > 0 OR built ≥1 newly-admitted` disjunction):

```
AT each wave-boundary stop (step 8.5), after re-assembly (step 8.4) has determined
the next wave's admitted set:

  admitted_this_wave := count of issues newly admitted to the build queue by this
                        wave's drain + the re-assembly for the next wave
                        (chain-unlocks AND discovered-scope filings that passed
                         the step-8.3 eligibility filter)

  IF admitted_this_wave >= 1:
     no_progress_waves := 0            # genuine convergence progress on a tributary
  ELSE:
     no_progress_waves := no_progress_waves + 1

  IF no_progress_waves >= convergence.max_waves:   # default 6
     pass --non-convergence to `faff run-done`      # → escalate/non-convergence (reported)
```

**Chosen:** the reset keys on **admission to the build queue this wave**, not on `filed_this_wave`. `filed_this_wave` is retained purely as a logged diagnostic (step 8.0 tracking sentence + step 8.5 wave log) and never resets the counter on its own. Rationale: under `opt-in`, a filed-but-unbuildable ticket is file-and-defer work, not in-run convergence, so counting it as progress holds the stall counter open on work that will never build this run; admission is the only signal that is true progress on either tributary under both eligibility defaults.

## 4. HOW — Behaviour

**The edit** (`plugin/skills/faff-beep-boop/SKILL.md`):

1. **Step 8.5 non-convergence backstop sentence.** Rewrite the reset clause from "reset to 0 when the wave made progress on either bottom-up tributary (`filed_this_wave > 0` or it built ≥1 newly-admitted issue), increment only when both were dry" to key the reset on **≥1 newly-admitted issue this wave** (chain-unlock or an eligible discovered-scope filing that cleared step 8.3), incrementing when the wave admitted none. Keep the existing "resetting on either tributary is deliberate — a deep chain still draining is not stalled" rationale, re-expressed in terms of admissions (a chain-unlock is an admission, so the deep-drain case still resets). Keep the "cap never decides the normal exit; firing it is always reported" clause verbatim.

2. **Step 8.0 tracking sentence.** Change "Track the count of new concrete items filed (`filed_this_wave`) for the step-5 non-convergence backstop" so `filed_this_wave` is described as a **logged diagnostic** (wave log + runaway-cap report), explicitly **not** the counter's reset trigger. Fix the stale "step-5" cross-reference to point at the step-8.5 backstop while here (drive-by clarity; the backstop lives at 8.5, not step 5).

3. **Step 8.5 wave-log line (the "Log each wave's … `filed_this_wave`, `no_progress_waves` …" sentence).** Unchanged — both values are still logged; only the reset semantics moved.

**Anti-pattern:** treating any tracker write during a wave as convergence progress. Why: under the opt-in default, filing is deliberately decoupled from buildability (eligibility is the human's act), so a filing signal over-counts progress and defeats the very backstop it feeds.

**Anti-pattern:** adding the counter logic to `faff run-done` or a new CLI. Why: `run-done` is a pure predicate that already escalates on the boolean; the orchestrator owns wave state and is the correct home for the counter, matching how every other RunSignal (`filed_this_wave`, wave counts) is orchestrator-computed.

**Failure modes.**

- **The failure:** the fix is framed as closing an infinite loop, but under normal tracker-mode dynamics a wave that admits nothing new usually re-assembles to an **empty** queue, so `run-done` returns `run-complete/drained` and the run exits before the counter ever matters — making the change look inert.
  **How you'd know:** a `--converge` test where a wave files only unbuildable tickets shows the run terminating `converged/both-dry` rather than incrementing `no_progress_waves`.
  **What it means:** proceed — the fix is still correct and load-bearing for the cases where `run-done` *does* keep returning `continue` while admitting nothing: a git-only run whose `faff queue-state derive` faults and defaults to `work-remaining/continue` (step 8.5 git-only clause), or carried admitted-but-unbuilt work across a re-entry. In those cases the old rule would reset forever and the `non-convergence` escalate would never fire; the new rule increments correctly. The change is a strict hardening — it never *causes* a false escalate (a genuinely-progressing run always admits), it only stops a false *reset*.

- **The failure:** a filed ticket a human cranks up (adds `faff-automate`) between waves is missed as progress.
  **How you'd know:** after the crank-up, step 8.4's at-the-gate re-read admits it, so `admitted_this_wave ≥ 1` and the counter resets.
  **What it means:** proceed — the admission signal captures the mid-run crank-up for free, no special-casing.

## 5. DESIGN DECISION RATIONALE

**What resets the stall counter — filings or admissions?**
- *Options:* (a) keep `filed_this_wave > 0 OR admitted ≥1` (status quo); (b) key solely on admissions to the build queue; (c) count only *eligible* filings plus admissions.
- Option (a) is the bug — over-counts unbuildable filings under opt-in. Option (c) is redundant: an eligible filing that clears step 8.3 *becomes* an admission, so "eligible filings + admissions" collapses to "admissions".
- **Chosen:** option (b) — reset iff the wave admitted ≥1 issue to the build queue. It is the minimal, honest signal, satisfies both acceptance criteria exactly, and needs no new tracker read (the admitted set is already computed at step 4 / step 8.4).

**Prose fix or code guard?**
- *Options:* edit orchestrator prose; or move the counter into a CLI guard (e.g. a `faff converge-progress` verb).
- **Chosen:** prose fix only. Verification showed the counter is prose-owned and `run-done` already escalates correctly on the boolean; introducing a CLI verb would relocate orchestrator-owned wave state for no correctness gain and contradicts the existing design (every RunSignal is orchestrator-assembled and handed to the pure predicate). A CLI guard is a possible future refactor, not this fix.

**Keep or drop `filed_this_wave`?**
- **Chosen:** keep it as a logged diagnostic. It still informs the wave log and the runaway-cap report and is cheap; only its reset role is removed. Dropping it would lose useful observability of the discovered-scope tributary.

**Assumes:** `plugin/skills/faff-beep-boop/SKILL.md` is the live orchestrator skill source and the build ships the edit (not the plugin-cache copy). *Validate at build: confirm the file under `plugin/skills/` is the one linked into the active install (`faff doctor`), and edit there.*

**Assumes:** `faff run-done`'s `--non-convergence → escalate/non-convergence` mapping is unchanged and `--selftest`-covered. *Validate at build: `faff run-done --selftest` passes (confirmed at spec time, 2026-07-22).*

## 6. SCENARIOS — born-verifiable objectives

```
Given a --converge run under the opt-in automation default,
When a build wave files only unbuildable (no-faff-automate) Backlog tickets
     and admits no new issue to the build queue,
Then no_progress_waves is incremented (not reset) at the wave-boundary stop.
```

```
Given a --converge run at no_progress_waves = K-1 (K = convergence.max_waves),
When the next wave again admits no new issue to the build queue,
Then no_progress_waves reaches K and the orchestrator passes --non-convergence
     to faff run-done, which returns escalate/non-convergence (reported, never silent).
```

```
Given a --converge run productively draining a deep chain,
When a wave files zero new discovered items but admits ≥1 chain-unlocked issue,
Then no_progress_waves is reset to 0 (the deep-drain case is not a stall).
```

```
Given a --converge run under opt-out (or a human cranks a filed ticket up mid-run),
When a wave's discovered-scope filing passes the step-8.3 eligibility filter
     and is admitted to the build queue,
Then no_progress_waves is reset to 0 (an admitted filing is genuine progress).
```

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the acceptance criteria fully determine the reset predicate.

**Assumptions:** (both from §5)
- The live orchestrator source is `plugin/skills/faff-beep-boop/SKILL.md`; the edit ships from there. *Validate: `faff doctor` + confirm the linked path before editing.*
- `faff run-done`'s escalate mapping is unchanged and selftest-covered. *Validate: `faff run-done --selftest`.*

## 8. DONE — Definition of Done

### From WHY
- [ ] The step-8.5 non-convergence backstop no longer resets `no_progress_waves` on `filed_this_wave > 0` alone; the reset keys on ≥1 newly-admitted build-queue issue this wave.
- [ ] The change is prose-only in `plugin/skills/faff-beep-boop/SKILL.md`; no CLI/code file is modified.

### From WHAT (the corrected rule)
- [ ] A wave that files only unbuildable (no-`faff-automate`) Backlog tickets does **not** reset `no_progress_waves` (increments it). *(Acceptance criterion 1.)*
- [ ] A wave that admits at least one buildable ticket (chain-unlock or eligible filing) resets `no_progress_waves` to 0 as today. *(Acceptance criterion 2.)*
- [ ] `filed_this_wave` remains tracked and logged (step 8.0 tracking sentence + step 8.5 wave log) as a diagnostic, described as **not** the reset trigger.

### From HOW (edits + cross-reference)
- [ ] The step-8.0 tracking sentence's stale "step-5 non-convergence backstop" reference is corrected to the step-8.5 backstop.
- [ ] The "deep chain still draining is not stalled" rationale is preserved, re-expressed via admissions.
- [ ] The "cap never decides the normal exit; firing it is always reported" clause is preserved verbatim.

### From HOW (no regressions)
- [ ] `faff run-done --selftest` still passes (the `non-convergence → escalate` rung is untouched).
- [ ] `faff validate-adapters` passes on the edited `SKILL.md` (no line-cap / duplicated-block regressions).

**Integration smoke test:**
```
1. Read plugin/skills/faff-beep-boop/SKILL.md step 8.5 backstop paragraph.
2. Assert the reset condition names "admitted ≥1 ... build queue" and does NOT
   reset on `filed_this_wave > 0` alone.
3. Assert step 8.0 describes filed_this_wave as a logged diagnostic.
4. Run `faff validate-adapters` and `faff run-done --selftest` → both pass.
```

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. A single, cohesive correctness concern — one reset predicate plus a stale cross-reference, all in one skill file, well under a one-day unit. No split (it is not two independent concerns) and no merge (no always-ships-together sibling).
- **Workstream fit?** Yes. Outcome-named (the convergence backstop measures genuine progress) and cohesive with the `--converge` termination machinery it hardens.
- **Deps surfaced?** Yes. Its origin ticket FAFF-536 (self-hosting core-defect intake) is already Done, so it is a free-standing follow-up with no open blocker; FAFF-534 (converge-default-ON) is correctly out-of-scope, not a dependency.
- **Risk profile?** Low. No novel integration or external dependency; a prose-only predicate change guarded by `faff run-done --selftest` and `faff validate-adapters`. No de-risking spike warranted.

No issues.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
