# FAFF-311 — Wire the code-blind holdout at the per-issue graft gate (gate/prevent)

> Spec: faffter-dark-nlspec · 2026-07-01 · interactive · confidence: high · spec-review: approve. Attached on Linear FAFF-311.

This spec is the buildable design for adding a **second call-site** for FAFF-309's reusable code-blind `holdout_step`: inside the `faff-graft` build flow, as a per-issue **merge-blocking gate**. Audience: the build agent implementing the graft-side wiring. The two architectural questions the earlier draft escalated (insertion point, per-issue↔run bridge) were **ratified by the human on 2026-07-01** and are now **Chosen** — see §4 Decisions 1 & 4, §6, and §7.

## 1. WHY — Problem and Principles

**The load-bearing model.** A code-blind holdout is an *evaluator* that judges a running feature against its spec's born-verifiable DoD **without ever seeing the code** — its verdict is trustworthy precisely because the codebase was never one of its inputs. FAFF-309 wires that evaluator at the **per-run** phase: it *detects and escalates* a bad feature **after** each graft has already self-merged to `main`. Detect-after-merge cannot *prevent* a bad merge. This slice adds the missing call-site — the same `holdout_step`, invoked **per-issue while the worktree is still pre-merge** — so a failing holdout **blocks the merge before it reaches `main`** (gate, not just detect).

**Problem statement.** Today `faff-graft` merges on a 3-condition floor (AC-verified + CI-green + review-pass) with **no reference to the holdout at all**; a feature that passes review but silently fails its spec's observable behaviour still merges. This change makes a per-issue code-blind verdict a precondition of merge, so a spec-failing feature is stopped at the gate.

**Design principles.**

- **Code-blindness is structural, never promised.** The evaluator's verdict is only worth anything if the evaluating context genuinely never received the code. A gate that *asks* a code-aware context to "pretend" it can't see the code is worthless. The wiring must make blindness a fact of the process boundary.
- **Never weaken the existing merge floor — even while extending it.** The integrity floor is non-delegable. The settled insertion point (Decision 1) *grows* the floor from 3 to 4 conditions rather than relaxing it: the holdout sits *inside* the same protection as AC/CI/review, never alongside or below it.
- **Reuse, don't reinvent.** FAFF-309 owns the `holdout_step` engine (env→evaluator transport + verdict validation). This slice is a *call-site*, not a second engine.
- **Fail closed.** A non-blind, incoherent, or `fails` verdict blocks; a missing/unreadable verdict blocks (never silently passes). Only a validated `meets-spec` lets the merge proceed.

## 2. OUT OF SCOPE

- FAFF-309's per-run detect path — 309 builds the engine and wires the post-merge run-phase call-site; this slice adds only the pre-merge graft call-site.
- Building/altering the `holdout_step` engine itself — it is 309's deliverable; 311 only *invokes* it.
- Reworking FAFF-277's PRDR fold — the run-keyed PRDR roll-up stays as-is; this slice consumes the per-issue block *before* the fold (Decision 4 → Option A).
- Env provisioner internals (FAFF-30) / evaluator internals (FAFF-34).
- The lights-out banner enforced-flip — FAFF-309 owns it.
- Env-reuse across collision-group members — deferred as a v1 non-goal (state-contamination risk).

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| `holdout_step` | FAFF-309's reusable, call-site-agnostic step: provision env → run evaluator code-blind → validate + persist a `holdout-verdict`. |
| per-issue verdict | A `holdout-verdict` keyed to the single issue being built (`.faff/holdout/<issue>.json`), before any PRDR/run roll-up. |
| the merge floor | `faff-graft` Step 10's fixed, non-delegable set of merge preconditions. This slice **extends** it from 3 (AC-verified, CI-green, review-pass) to **4** (… + holdout-meets-spec). |
| holdout-block | The new terminal outcome when the per-issue holdout does not pass: the merge is refused. |

**Gate-pass predicate (the only pass condition):**

```
holdout_pass(verdict) :=
  `faff contract holdout-verdict` exits 0     # well-formed, code_blind:true, aggregate matches derivation
  AND verdict.aggregate == "meets-spec"
# anything else — fails | gaps | needs-human | exit≠0 | missing file — is holdout-block
```

## 4. HOW — Behavior

### Decision 1 — where the gate sits (CHOSEN)

**Chosen (ratified 2026-07-01):** **Option B — a 4th non-delegable Step-10 merge-floor condition.** The holdout is asserted **last** in the graft merge gate, after `AC-verified ∧ CI-green ∧ review-pass` are all green, so an env is provisioned only for otherwise-mergeable features (fewest envs) and the holdout lands **inside** the protected non-delegable floor where the concurrency contract forbids weakening it.

**The accepted cost — this edits a protected invariant in two places.**
1. The Step-10 merge floor grows from **3** conditions to **4** (… ∧ holdout-meets-spec).
2. The **concurrency executor's per-issue obligation set** grows accordingly (obligation-4): every concurrency occupant that merges must assert the holdout condition too.

Both edits must land **in lockstep** — a 4-condition floor that only one executor honours is worse than none.

### Decision 2 — how the evaluating context is made code-blind (CLOSED)

**Chosen:** the code-blind sub-context is a **fresh OS-level process** (an evaluate-call helper analogous to `review-call.mjs`), spawned from the graft gate, carrying **only the spec text + the `env-handle` (endpoint URL)** — never a repo path, and with `cwd` outside the worktree. Blindness is therefore **structural**.

```
PROCEDURE run_holdout_gate(issue, spec, worktree):
  1. env_handle ← holdout_step.provision(spec)          # env slot; ready, else holdout-block
  2. verdict_block ← holdout_step.evaluate(spec, env_handle.endpoint)   # FRESH PROCESS: spec + endpoint ONLY
  3. holdout_step.persist(verdict_block → .faff/holdout/<issue>.json)
  4. gate ← `faff contract holdout-verdict` <<< verdict_block
  5. holdout_step.teardown(env_handle.teardown_ref)      # ALWAYS — every exit path
  6. IF gate.exit == 0 AND verdict_block.aggregate == "meets-spec": RETURN pass
     ELSE: RETURN holdout-block(reason = aggregate | "non-blind" | "incoherent" | "missing")
```

Env teardown is unconditional. A teardown failure is logged + surfaced, never swallowed, never blocks the queue.

### Decision 3 — blocked-merge disposition (CLOSED)

**Chosen:** reuse existing graft dispositions — **no new ledger bucket**. Under Option B (PR already opened at 9b), a holdout-block → return **`pr-open-for-human`** → ledger bucket `pr-open`. The PR is flipped to draft and the feature surfaced with the verdict's `aggregate` + `violations` as the reason. Autonomous graft never retries a holdout-block automatically.

### Decision 4 — per-issue verdict vs the run-keyed FAFF-277 bridge (CHOSEN)

**Chosen (ratified 2026-07-01):** **Option A — persist-once / consume-twice.** The evaluator persists the per-issue block to `.faff/holdout/<issue>.json`; the graft gate reads **that raw block directly** (keyed by the issue being built) to **block the merge BEFORE FAFF-277's PRDR fold**; the **same file** later feeds the existing `faff holdout verdicts --association` → `faff prdr coverage` run roll-up **unchanged** at run termination. One artifact, two consumers. Net-new plumbing is a small **issue-scoped lookup** — either a thin `faff holdout verdict --issue <id>` surface returning the single block's gate result, or graft reads the file and pipes it to the existing `faff contract holdout-verdict`.

### Decision 5 — env cost ×N mitigation (CLOSED)

**Chosen:** v1 mitigations = (a) **Option-B ordering** — assert holdout *last*, after AC+CI+review are green; (b) **skip provisioning entirely when `faff dod classify` reports zero born-verifiable criteria** (short-circuit to holdout-block/`needs-human`, reason "no born-verifiable criteria"). Env-reuse across collision-group members is deferred (state-contamination risk).

**Failure modes.**

- **Poisoned blindness:** the "fresh process" is handed a repo path or inherits the worktree `cwd`, so it *can* see the code. Harden the process boundary (explicit `cwd`, no repo arg).
- **Incomplete protected-invariant edit:** the 4th condition is added to graft but **not** wired into the concurrency obligation set → a parallel build merges without the holdout. The gateway merge-floor contract and the concurrency obligation-N invariant must be updated **in lockstep**.
- **Env flakiness at ×N:** treat an env `status:failed` as an env fault distinct from a feature `fails` — never silently a feature failure.
- **`holdout_step` not call-site-agnostic:** if 309 shipped only per-run wiring → park (not build-admissible).

## 5. Scenarios — born-verifiable main objectives

```
Given a built feature whose running behaviour violates its spec's born-verifiable DoD
When the per-issue holdout gate runs in graft
Then the evaluator returns aggregate:"fails" and the merge is BLOCKED (holdout-block), the feature never reaching main
```
```
Given a built feature that satisfies its spec's born-verifiable DoD and AC+CI+review are green
When the per-issue holdout gate runs (asserted last on the 4-condition merge floor)
Then the verdict is code_blind:true meets-spec, the gate passes, and the merge proceeds to ship
```
```
Given a holdout verdict with code_blind:false (or a malformed/incoherent block, or a missing verdict file)
When the gate evaluates it via `faff contract holdout-verdict`
Then the gate does NOT pass (holdout-block) — a non-blind or unvalidated verdict never merges
```
```
Given the holdout gate runs and its evaluation throws or the env provisioner errors mid-run
When the gate exits by any path (success, block, or exception)
Then the provisioned env is torn down (teardown_ref invoked) and no env is left running
```
```
Given a per-issue holdout verdict was produced and persisted at the graft gate
When the run later reaches its termination roll-up
Then the same .faff/holdout/<issue>.json block feeds `faff holdout verdicts --association` into the run-keyed PRD-coverage bridge unchanged
```

Assertion (non-functional): the gate provisions **at most one** env per gated issue, and **zero** when `faff dod classify` reports no born-verifiable criteria.

## 7. Resolved decisions and assumptions

- **Graft insertion point (Decision 1) → Option B.** A 4th non-delegable Step-10 merge-floor condition, holdout asserted last; edits the merge floor 3→4 and the concurrency obligation-4 invariant in lockstep.
- **Per-issue → run-keyed bridge (Decision 4) → Option A.** Persist-once/consume-twice.
- **Assumes:** FAFF-309 shipped the reusable, call-site-agnostic `holdout_step` (env → code-blind evaluator via fresh-process transport → `holdout-verdict` validation), genuinely call-site-agnostic. Confirmed merged (PR #237, `holdout_step(spec, prdr_id, key, run_dir)` in faff-beep-boop/SKILL.md, declared call-site-agnostic for the per-issue graft merge-gate). Build-admissible.
- **Assumes:** the `env` and `evaluator` slots resolve to code-blind-capable producers (defaults `faffter-noon-env-compose` / `faffter-noon-evaluate`, both Done).

## 8. DONE — Definition of Done

- [ ] A built feature whose running behaviour fails its spec's born-verifiable DoD is blocked from merging at the per-issue graft gate.
- [ ] The existing merge floor (AC/CI/review) is never *relaxed* — only *extended*.
- [ ] The gate passes **only** when `faff contract holdout-verdict` exits 0 AND `aggregate == "meets-spec"`; `fails`/`gaps`/`needs-human`/non-`code_blind`/malformed/missing all → holdout-block.
- [ ] The gate reads the per-issue `.faff/holdout/<issue>.json` block directly (before any PRDR fold), keyed to the issue.
- [ ] The evaluating context is a fresh OS-level process given only spec + `env-handle` endpoint — no repo path, `cwd` outside the worktree.
- [ ] The gate reuses FAFF-309's `holdout_step` (no second engine).
- [ ] **Protected-invariant edit:** the Step-10 merge floor is extended 3→4 conditions, holdout asserted last, updated in **both** the gateway merge-floor contract **and** the concurrency executor's obligation set (obligation-4) in lockstep.
- [ ] A holdout-block returns `pr-open-for-human`→`pr-open` (PR flipped to draft, verdict surfaced, no autonomous retry).
- [ ] The provisioned env is torn down on **every** exit path; a teardown failure is logged/surfaced without blocking the queue.
- [ ] The same per-issue verdict file feeds `faff holdout verdicts --association` run roll-up unchanged.
- [ ] At most one env per gated issue; zero when `faff dod classify` reports no born-verifiable criteria.
- [ ] An env `status:failed` is surfaced distinct from a feature `fails`.
- [ ] The issue-scoped lookup (thin `faff holdout verdict --issue <id>` or graft-reads-file + `faff contract holdout-verdict`) is implemented + tested.
- [ ] FAFF-309 confirmed merged with a call-site-agnostic `holdout_step`.

confidence: high

*Prepped by /faff-prep (interactive) · spec slot faffter-dark-nlspec · methodology faffter-dark-methodology-agile-delivery. Both architectural Punts ratified 2026-07-01 → Chosen (insertion point → Option B; bridge → Option A). Full spec on Linear FAFF-311.*
