# Wire the code-blind holdout step into the L4 delivery path + flip the guardrail to enforced

> Spec: faffter-dark-nlspec · 2026-07-01 · interactive · confidence: high · Full spec on the tracker.

This spec is for the build agent and human reviewers. It addresses FAFF-309 (first-slice epic under FAFF-307): add the missing **orchestrator caller** that provisions an env, runs the code-blind holdout evaluator against it, validates the verdict, feeds it through FAFF-277's PRD-coverage bridge into run termination, and tears the env down on every path — then flip the `holdout` lights-out guardrail from *reachable* to *enforced* so the banner reads **ARMED — 8/8 enforced**. The call-site decision — *where* the caller lives — is now **resolved** (ratified by the human, 2026-07-01): this slice wires the step at **ONE call-site, the per-run lights-out/beep-boop phase** (Option 2, detect-and-escalate). The per-issue graft merge-gate (Option 1, prevent) is deferred to sibling **FAFF-311** (blockedBy this ticket), which reuses this slice's call-site-agnostic `holdout_step`.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every primitive of the holdout chain already exists and is Done as pure, human-invocable CLI + two producer slots. `enforced` in the lights-out guardrail table means exactly one thing: *an orchestrator step actually invokes this guardrail in a run's loop.* The `holdout` guardrail is `enforced: false` **only because no orchestrator caller exists** — the env→evaluate chain is reachable (its `--selftest` probe passes) but never fired. This slice adds that one missing caller, then flips the boolean the caller earns.

**Problem statement.** Today the holdout verdict is produced only by a human driving `faff` subcommands by hand; a lights-out run provisions no env and runs no evaluator, so the L4 "isolated holdout marks the work against a spec it never saw" story is documented intent, not a live gate. This change wires the chain into a run and enforces it, closing FAFF-305's honest "reachable-but-not-enforced" banner to "8/8 enforced".

**Design principles.**

- **Re-implement nothing.** The caller is an *orchestration seam*, not new logic. Every contract decision (env readiness, code-blindness, aggregate coherence, PRD roll-up, the `product-incomplete` termination floor) is already a tested pure-CLI gate. The caller composes them; it never forks a rule or re-validates a shape in prose.
- **Code-blindness is structural, not promised.** The evaluator's `code_blind: true` is trustworthy *only because* it was handed the spec + a running env and *nothing else* — never the diff, the codebase, the build history, or the builder's test suite. The caller must preserve this by construction (separate context/worktree), or the verdict is worthless. At the chosen per-run call-site this is **free**: the orchestrator lane never writes code.
- **Provision is a lease; teardown is unconditional.** A provisioned env is a leased resource. Teardown via the handle's `teardown_ref` runs on *every* exit path — success, failure, early not-ready return, and exception — or the run leaks containers.
- **Enforce only what you invoke.** The `enforced` flip is honest only in the same slice as the caller. Flipping the boolean without a live caller re-breaks the FAFF-305 honesty property.

**Scope statement.** This is the caller-and-flip seam between the (Done) holdout producers/bridge and the (Done) lights-out runner, wired at **one** call-site (the per-run lights-out phase). De-risked against **one** in-repo runnable-system spec; the full cross-repo greenfield acceptance is FAFF-310 (which this blocks); the per-issue graft merge-gate is sibling FAFF-311.

## 2. OUT OF SCOPE

- **Cross-repo / greenfield end-to-end acceptance** — FAFF-310 owns the P1 link-shortener unattended architecture→env→evaluate proof.
- **The per-issue graft merge-gate call-site (Option 1, prevent)** — sibling FAFF-311 (blockedBy this ticket), which reuses the same call-site-agnostic `holdout_step`.
- **New env-provisioning mechanisms (cloud preview, persistent staging)** — the `env` slot's docker-compose default is sufficient to de-risk; the handle is the fixed interface.
- **Changing any contract shape** (`env-handle`, `holdout-verdict`, `prd-coverage`, `run-done`) — all Done and tested; the caller consumes them unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| holdout step | The orchestrator procedure this slice adds: provision → evaluate (code-blind) → validate → bridge → teardown. **Call-site-agnostic** by construction, so sibling FAFF-311 reuses it. |
| call-site | *Where* the holdout step is invoked from. **This slice: the per-run lights-out/beep-boop phase.** |
| SUT | The running thing the evaluator exercises. At the per-run call-site: the **integrated post-merge** system. |
| holdout key | The filename stem under `.faff/holdout/<key>.json`. At the per-run call-site: the **run id**. |
| association | The orchestrator-lane `{holdout-key: prdr-id}` map handed to `faff holdout verdicts --association`. At the per-run call-site: `{run-id: project-prdr-id}`. |

**The holdout step (interface).**

```
PROCEDURE holdout_step(spec, prdr_id, key, run_dir):
  # returns one of: meets-spec | gaps | fails | needs-human   (the verdict aggregate)
  # side effects: persists .faff/holdout/<key>.json; feeds prd-coverage; tears env down
  # call-site-agnostic: this slice invokes it from the per-run phase; FAFF-311 reuses it per-issue.
```

## 4. HOW — Behavior

**Architecture.** The holdout step is a single **call-site-agnostic** reusable procedure. This slice invokes it from the **per-run lights-out/beep-boop phase** (a new post-build-wave step, sibling to `runcheck`, before reporting). It runs in the **orchestrator/evaluator lane**, never the implementor lane: it hands the evaluator only the spec and a running env, so `code_blind: true` is true by construction — free at the per-run call-site because the orchestrator lane never writes code. It owns no contract logic — each numbered step is a pipe into an existing tested CLI, and the exit code *is* the gate.

```
PROCEDURE holdout_step(spec, prdr_id, key, run_dir):
  1. env-handle := invoke slots.env (resolve `faff config get slots.env`) with the architecture proposal + infra profile.
     a. IF the producer emitted no handle (recommendation != build): surface the proposal for a human; return needs-human. (Provision nothing.)
  2. Validate the handle: pipe the env-handle block to `faff contract env-handle`.
     a. IF exit != 0 (not ready / no endpoint / no health-checks / no teardown_ref): record needs-human; GOTO teardown.
  3. holdout-verdict := invoke slots.evaluator (resolve `faff config get slots.evaluator`) handing it ONLY { spec, env-handle } — never the diff, codebase, build history, or the builder's tests (separate worktree/context).
  4. Validate the verdict: pipe the holdout-verdict block to `faff contract holdout-verdict`.
     a. IF exit != 0 (not code-blind / prose judged / missing evidence / aggregate incoherent): treat as needs-human (never meets-spec); GOTO teardown.
  5. Persist the validated block to `.faff/holdout/<key>.json` (the evaluator writes it; the caller confirms it landed).
  6. Bridge to PRD coverage:
     a. map := `faff holdout verdicts --association {"<key>":"<prdr_id>"} --dir .faff/holdout`   → { prdr_id: "met" | "gaps" | "fails" | "needs-human" }
     b. coverage := `faff prdr coverage --dod-verdicts <map>`                                    → { satisfied, completion, … }
     c. feed coverage into run termination via `faff run-done --prd-coverage <coverage>` — prd_satisfied === false ⇒ escalate / product-incomplete (the fixed floor; no policy weakens it).
  7. teardown: run env-handle.teardown_cmd (`faff env down --project <teardown_ref>`) on EVERY path above, including the early not-ready/needs-human returns and any exception. A teardown failure is logged loudly; it never changes the verdict.
  8. return holdout-verdict.aggregate.
```

**The per-run call-site (this slice).** Invoke `holdout_step` **once per run** as a new post-build-wave lights-out/beep-boop phase, sibling to `runcheck`, before reporting:

- **SUT = the integrated post-merge system.**
- **Key + association are run-keyed:** `key = run id`; `prdr_id = the run's project PRDR`. The orchestrator hands `{run-id: project-prdr-id}` to step 6.
- **Detect-and-escalate, not prevent.** It runs **after** each graft has already self-merged, so a `fails`/`gaps` aggregate makes the run **escalate and refuse to claim PRD-done** (`prd_satisfied === false` ⇒ `product-incomplete`); it does **not** block a merge. Merge-gating is sibling **FAFF-311**.
- **A new per-run outcome bucket** carries the `product-incomplete` escalation into reporting.

**The enforcement flip (same slice, after the caller is live).**

```
PROCEDURE flip_guardrail():
  1. LIGHTS_OUT_GUARDRAILS[holdout].enforced: false → true.
  2. lightsOutSelftest — update in lockstep: holdout enforced === true; count === 8; "ARMED — 8/8 enforced"; holdout line "enforced" token.
  3. Leave renderLightsOutBanner untouched — it recomputes N/8 from the map and drops the "reachable-but-not-enforced" clause once notEnforced is empty.
  4. Leave the reachability gate untouched — holdout still refuses the run if its probe fails; enforcement and reachability remain orthogonal.
```

**Failure modes.**

- **No in-repo runnable system the `env` slot can stand up** (faff is a Node CLI, not a long-running service) → the de-risk exercises nothing real. **Narrow:** pick the thinnest provisionable in-repo target, or defer the real proof to FAFF-310's greenfield service (a valid, honest outcome to name, not a gap to hide).
- **The per-run call-site evaluates the *post-merge* system**, so a bad feature has already merged before the holdout sees it. This is the **consciously-accepted** trade of detect-and-escalate; prevention is deferred to FAFF-311.

## 5. Scenarios — born-verifiable main objectives

```
Given a lights-out run over one in-repo runnable-system spec whose architecture proposal recommends build
When the per-run holdout phase runs
Then an env-handle is provisioned (status: ready), a code_blind:true holdout-verdict is persisted to .faff/holdout/<run-id>.json,
     that verdict is folded through `faff holdout verdicts --association {run-id: project-prdr-id}` into `faff prdr coverage --dod-verdicts`,
     and the resulting coverage feeds `faff run-done --prd-coverage`.
```

```
Given the holdout step provisioned an env
When the step exits by ANY path (verdict produced, not-ready early return, or exception)
Then the env is torn down via its teardown_ref (no leaked containers).
```

```
Given a non-ready env-handle or a non-blind / incoherent holdout-verdict
When the step validates it
Then the verdict never gate-passes as meets-spec (it is needs-human), prd-coverage stays unsatisfied, and the env is torn down.
```

```
Given the per-run caller is wired and the `holdout` guardrail is flipped to enforced
When `faff lights-out --selftest` runs
Then it asserts holdout enforced === true and an 8/8 enforced count, and the proceed-path banner reads "ARMED — 8/8 enforced".
```

## 8. DONE — Definition of Done

- [ ] The `holdout_step` procedure exists (call-site-agnostic): invokes `slots.env`, validates via `faff contract env-handle`, invokes `slots.evaluator` code-blind (`{spec, env-handle}` only), validates via `faff contract holdout-verdict`, persists `.faff/holdout/<key>.json`, bridges via `faff holdout verdicts --association` + `faff prdr coverage --dod-verdicts` into `faff run-done --prd-coverage`, and tears the env down on every path.
- [ ] Non-ready handle / non-blind / incoherent verdict never rolls up as meets-spec; non-`build` recommendation provisions nothing and surfaces for a human.
- [ ] The step is wired at ONE call-site — the per-run post-build-wave phase (sibling to `runcheck`, before reporting), run-keyed (`{run-id: project-prdr-id}`), detect-and-escalate; a new per-run outcome bucket carries `product-incomplete` into reporting.
- [ ] `LIGHTS_OUT_GUARDRAILS[holdout].enforced` is `true`; `faff lights-out --selftest` asserts holdout enforced and 8/8; the proceed-path banner renders `ARMED — 8/8 enforced` with no trailing clause; `renderLightsOutBanner` and the holdout reachability refusal are untouched.
- [ ] Build-time Assumes validated: if no in-repo runnable-system spec exists, narrow the de-risk and defer the real runnable-system proof to FAFF-310 (noted honestly, not faked).

**Assumes.** An in-repo runnable-system spec exists whose architecture proposal recommends `build` and yields a provisionable (docker-compose) env. *Validation at build:* faff itself is a Node CLI — if none exists, narrow the de-risk to the thinnest provisionable in-repo target and defer the real runnable-system proof to sibling FAFF-310.

confidence: high
