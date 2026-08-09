# Engineering-quality gates before CI — cost-ordered gate ladder in faff-graft (FAFF-11)

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: medium. Full spec on Linear FAFF-11.

This spec defines an **engineering-quality gate ladder** that runs the repository's *own declared* cheap checks (format / lint / type-check / static-analysis / unit) **before** spending on remote CI, inside faff-graft's build loop. Audience: the build agent implementing it, and the human reviewers gating that build. It is written for a coding agent with only this spec as context.

## Already shipped against this surface

Adjacent Done tickets in the same project, **related but not superseding** this premise (re-verify their live status before building):

- **FAFF-3** — *Merge-confidence gate rubber-stamps when a diff has no CI ("CI green by absence")*. Touches the Step 10 CI-green semantics, **downstream** of this ladder; does not deliver a pre-CI engineering-gate ladder.
- **FAFF-4** — *ship slot precondition checks*. Touches Step 10/11 delivery mechanics; orthogonal to the engineering gates.

Neither ships a declared-check ladder before review/CI, so FAFF-11's premise still holds.

## 1. WHY — Problem and Principles

**The load-bearing model.** A lights-out faff run burns money on remote CI. The cheapest place to catch a lint error, a type error, or a failing unit test is *locally, before CI spins up* — and almost every repo *already declares* those checks (a `pre-commit` config, `package.json` scripts, a `Makefile`, the cheap jobs in its CI workflow). So faff should **run what the project already says to run, cheapest-first, fail-fast** — not prescribe a tool taxonomy. The gate ladder is an *economic shift-left*, ordered by cost: local checks first, the expensive remote CI matrix last.

**Problem statement.** faff has pre-PR *code review* (the `review` slot) but does not enforce the cheap *engineering* gates (format/lint/type/static-analysis/unit) before review and CI. This is the engineering-practice axis — distinct from `methodology` (the delivery axis: scope/value/sequencing) — a genuine slot/step gap. This change adds a cost-ordered gate ladder to faff-graft that discovers and runs the repo's declared checks before review and before CI.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Run-what-the-project-declares, don't prescribe.** At autonomy L1–L3 faff imposes *which* tools run only insofar as the repo already opted into them. A built-in tool taxonomy (e.g. "always run eslint") is wrong below L4. *(Governing tenet: configurable-not-opinionated, adoptable-not-all-encompassing.)*
- **Determinism in the CLI, judgement out.** Discovery and execution of checks are a deterministic CLI helper, mirroring the existing `cmdXxx` pattern; no LLM "decides what counts as a gate" at runtime. *(deterministic-tools-over-prose.)*
- **Cost-ordered, fail-fast.** Cheapest/most-local rung first; stop (or surface) on first failing rung before paying for the next. The whole point is to not spend a review pass or a CI matrix on code that doesn't format/lint/type-check.
- **Reconcile with Step 8, don't duplicate it.** faff-graft Step 8 already resolves the repo's test+lint command and runs the full suite + lint pre-PR. The ladder must *generalise* that resolution, not bolt a second, divergent command-resolver beside it.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (Step 8 AC verification, Step 9 review) | Markdown prose | Step 8 already resolves+runs test/lint pre-PR; Step 9 (review) runs pre-PR before the PR/CI. The ladder slots **before** Step 9 and **subsumes** Step 8's resolution. |
| `plugin/skills/faff/bin/faff` (`cmdXxx` pattern, `CONTRACTS`, `cmdContract`) | Node (dependency-free, single entrypoint) | Home for a new `faff gates discover` / `faff gates run` helper and (optionally) a `quality-gates` contract entry mirroring `review-verdict`. |
| `plugin/skills/faff/SKILL.md` (Slots table, "producer emits, consumer parses") | Markdown prose | Slot/contract pattern for the optional `gates` slot override; `adr` is the precedent for an advisory producer with no gated contract. |
| `plugin/skills/faff/contracts/review-verdict.schema.json` | JSON Schema | Shape to mirror for the proposed `quality-gates` contract. |

**Scope statement.** A new cost-ordered **gate ladder step in faff-graft** (graft-step, with an optional `gates` slot override), positioned *before* the review slot, generalising Step 8's command resolution — it is the engineering-practice gate that runs the repo's own declared checks before paying for review/CI.

## 2. OUT OF SCOPE

- **Where gates physically execute** — what's excluded: choosing local-worktree vs CI-runner vs provisioned ephemeral environment. **Why excluded:** this is the *environment* question, owned by FAFF-12 (Lights-out CI & environments), not this ladder. **Extension point:** the ladder's `execution_target` is a single seam (`PROCEDURE run_rung`) that FAFF-12 fills; until then it runs in the worktree sandbox (the same place Step 8 already runs). *(See Open Question Q1.)*
- **Per-dollar gate-selection learning** — what's excluded: ranking/selecting gates by defects-caught-per-dollar per repo. **Why excluded:** ties to design-register idea E (self-learning); needs a calibration corpus that does not exist yet. **Extension point:** the ladder emits a structured per-rung result (rung name, duration, pass/fail) into the per-issue log; a future learner reads that history. *(Future, not a punt — out of scope.)*
- **Spec-scenario ↔ test mapping** — what's excluded: asserting "the spec's scenarios each have a corresponding test." **Why excluded:** depends on FAFF-10 (BDD scenarios) being a structured, machine-readable artifact. **Extension point:** the unit/test rung exposes the resolved test command + result; FAFF-10 can later cross-reference scenarios. The enforceable thing *this* ticket ships is "tests exist and pass for the changed surface," not scenario-mapping.
- **Test-first ("you wrote the test first") enforcement** — what's excluded: any attempt to verify TDD ordering. **Why excluded:** unverifiable after the fact; faff stays out of it (see WHAT → vocabulary, "TDD reframed").
- **Prescriptive tool taxonomy at L1–L3** — what's excluded: a built-in "always run eslint/mypy/clippy" list. **Why excluded:** violates run-what-the-project-declares. **Extension point:** L4 strict mode (HOW → autonomy gradient) is the only place faff may add a check the repo lacks.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Gate ladder | The ordered set of rungs run cheapest-first before review/CI. |
| Rung | One declared check (e.g. format, lint, type-check, static-analysis, unit) with a resolved command and a cost rank. |
| Declared check | A check the repo *already opted into*: a `pre-commit` hook, a `package.json` script, a `Makefile` target, or a cheap CI job — not a faff-prescribed tool. |
| Cost rank | A coarse ordering (lower = cheaper/more-local) used to sequence rungs. |
| Autonomy gradient | L1–L2 surface/advisory · L3 run+gate on declared checks · L4 strict (may add checks the repo lacks). |
| "TDD" (reframed) | **Not** test-first; the enforceable surrogate is *tests exist and pass for the changed surface* — the unit/test rung. |

**Type definitions** (language-agnostic):

```
ENUM RungKind: FORMAT | LINT | TYPECHECK | STATIC_ANALYSIS | UNIT | OTHER

RECORD Rung:
  kind: RungKind
  name: String                 # human label, e.g. "lint (package.json: npm run lint)"
  command: String              # resolved from a TRUSTED source only (see HOW → discovery)
  source: ENUM{ pre_commit, pkg_script, makefile, ci_job, claude_md, fallback }
  cost_rank: Int               # lower = cheaper/more-local; sequencing key
  required: Bool               # L3: declared checks are required; advisory rungs (L1-L2) are not

RECORD RungResult:
  kind: RungKind
  name: String
  command: String
  status: ENUM{ pass, fail, skipped, errored }
  duration_ms: Int
  detail: String               # truncated stdout/stderr tail for the log

RECORD GatesOutcome:
  signal: ENUM{ pass, fail, needs-human }   # ladder verdict the graft-step branches on
  discovery: ENUM{ confident, partial, none }  # how reliably checks were discovered (see Q2)
  rungs: List<RungResult>
  violations: List<String>     # contract-violation strings (mirrors review-verdict shape)
```

**CLI surface (new, mirrors the existing `cmdXxx` pattern in `bin/faff`):**

- `faff gates discover [--json]` — deterministically inspect the repo (pre-commit config, package.json scripts, Makefile, CI workflow, CLAUDE.md) and emit the ordered `List<Rung>` it would run, plus a `discovery` classification (`confident` / `partial` / `none`). Read-only. Exit `0` ok, `2` usage.
- `faff gates run [--json]` — discover then execute the rungs cheapest-first in the worktree sandbox; emit `GatesOutcome`. Exit `0` all-pass, `1` ≥1 fail, `2` usage. (Execution target is the worktree until FAFF-12 — see Q1.)

**Contract artifact (proposed `quality-gates`, mirroring `review-verdict`):** the gate-ladder producer emits a `faff-contract:quality-gates` block; the graft-step `JSON.parse`s it and pipes to `faff contract quality-gates`, branching on the script's `signal` (a malformed/unknown signal coerces to `needs-human`, never `pass` — the same coercion rule as `review-verdict`). Schema shape mirrors `contracts/review-verdict.schema.json`:

```
quality-gates.schema.json (shape):
  signal:     enum [pass, fail, needs-human]      # required
  rungs:      array of { kind, status }            # required (presence, not full detail)
  conformant: boolean                              # required
  violations: array of string                      # required
```

**Design decisions** (each closes with a canonical marker; rationale collected in §6):

- **Chosen:** Gate ladder is a **graft-step** with an **optional `gates` slot override** — *not* a mandatory new prescriptive slot. The default behaviour is a faff-owned graft-step running the repo's declared checks; a repo that wants a custom runner sets `slots.gates`.
- **Chosen:** Default behaviour **discovers and runs the repo's own declared checks**; faff prescribes no tool taxonomy at L1–L3.
- **Chosen:** Gates run **before** the `review` slot (Step 9) and therefore before the PR/CI (Step 9b). No review pass or CI matrix is spent on code that fails a cheap rung.
- **Chosen:** The ladder **generalises Step 8's command resolution**: Step 8's existing test+lint resolver becomes the discovery source for the UNIT and LINT rungs; the AC test-green requirement folds in as the UNIT rung. Step 8 is not duplicated — its resolution logic is the ladder's discovery, and AC verification consumes the ladder's UNIT-rung result.
- **Chosen:** "TDD" is enforced as **"tests exist and pass for the changed surface"** (the UNIT rung), never test-first.
- **Chosen:** Discovery + execution are a **deterministic CLI helper** (`faff gates discover` / `faff gates run`), keeping the heuristic (a tool) separate from any judgement.
- **Punt:** **Where gates execute** (worktree vs CI-runner vs ephemeral env) — needs human; ties FAFF-12. *(Q1.)* **Interim default (built):** worktree sandbox, `execution_target` left as the single FAFF-12 seam.
- **Punt:** **Discovery-fallback policy** when heterogeneous configs can't be parsed confidently (skip-silently vs advisory-surface vs fail-closed) — needs human. *(Q2.)* **Interim default (built):** advisory-surface (`signal: pass` + surface), routed through a config knob so fail-closed is selectable.
- **Assumes:** FAFF-3 (CI-green-by-absence) and FAFF-4 (ship-precondition) are Done and adjacent-not-superseding. *(Validated 2026-06-22: both Done — PR #46 / #47 — and neither shipped a declared-check ladder.)*

## 4. HOW — Behavior

**Architecture and approach.** A new faff-graft step (call it **Step 7.5: Engineering gate ladder**) runs after build (Step 7), before AC verification's full-suite run and before review (Step 9). It calls the `gates` slot if configured, else the default graft-step, which calls `faff gates run`. The CLI does the deterministic work: discover declared checks, order by cost, run cheapest-first, emit `GatesOutcome` + the `faff-contract:quality-gates` block. The graft-step pipes the block to `faff contract quality-gates` and branches on the verdict.

**Discovery (deterministic, trusted-source-only).** Commands come **only** from the repo's own trusted declarations — never a command transcribed from an issue description or third-party comment (the gateway → **Untrusted input** no-execute rule, the same constraint Step 8 obeys).

```
PROCEDURE discover_rungs(repo):
  rungs := []
  # cheapest/most-local first — cost_rank ascending
  IF exists(.pre-commit-config.*):        add rungs from declared hooks  (cost_rank ~ per hook stage)
  IF exists(package.json scripts):        add format/lint/typecheck/test scripts that are present
  IF exists(Makefile targets):            add fmt/lint/check/test targets that are present
  IF exists(CLAUDE.md documents commands): add the documented test/lint command  (Step 8's source)
  classify_cheap_ci_jobs(.github/workflows/*):  add the cheap, locally-runnable jobs (lint/type subset)
  discovery := confident IF >=1 rung resolved with high certainty
             | partial   IF some resolved but configs ambiguous
             | none      IF nothing resolvable
  RETURN sort_by(cost_rank, rungs), discovery
```

**Behaviour summary — run the ladder.** Run each rung cheapest-first; on the first failing *required* rung, stop and return `fail` (don't pay for the rest, or for review/CI). Advisory rungs (L1–L2) never gate.

```
PROCEDURE run_ladder(autonomy_level, appetite):
  rungs, discovery := discover_rungs(repo)

  # Autonomy gradient -> which rungs gate:
  IF autonomy_level in {L1, L2}:
     run rungs advisory-only; surface results; signal := pass   # no gate
  ELSE IF autonomy_level == L3 (default autonomous, beep-boop):
     run declared rungs; each declared rung is required
  ELSE IF autonomy_level == L4 (strict):
     ALSO add checks the repo lacks (e.g. a static-analysis pass);
     treat absence of tests for changed code as a fail

  results := []
  FOR rung in rungs ORDERED BY cost_rank ASC:
     r := run_rung(rung)            # execution_target = worktree sandbox until FAFF-12 (Q1)
     results.append(r)
     IF rung.required AND r.status == fail:
        RETURN GatesOutcome{ signal: fail, discovery, rungs: results }   # fail-fast: stop here

  # discovery-fallback policy (Q2) decides the signal when nothing/partial was found:
  IF discovery == none:  signal := apply_fallback_policy()   # PUNT default below
  ELSE:                  signal := pass
  RETURN GatesOutcome{ signal, discovery, rungs: results }
```

**Step 8 reconciliation (the overlap the explore flagged).** Step 8 already resolves+runs test+lint pre-PR. Concretely:

```
PROCEDURE reconcile_with_step8():
  1. Step 7.5 (ladder) runs FIRST: discover_rungs() reuses Step 8's resolution order
     (CLAUDE.md -> package.json -> Makefile -> pyproject/pytest/tox -> Cargo -> go.mod -> CI config).
  2. The ladder's UNIT rung IS the test run; its LINT rung IS the lint run.
  3. Step 8 then consumes the ladder's UNIT-rung result for AC verification — it does NOT
     re-resolve or re-run the suite from scratch; the full-suite backstop is the UNIT rung
     at the top cost_rank.
  4. Net: one resolver (in the CLI), one suite run, gates ordered cheapest-first; Step 8's
     "find the runner, don't guess" requirement is satisfied by discover_rungs().
```

**Anti-pattern:** A second command-resolver living in the ladder, diverging from Step 8's. Why: two resolvers drift; the repo's runner must have exactly one source of truth (`faff gates discover`).

**Anti-pattern:** Running gates *after* opening the PR / firing CI. Why: defeats the fail-fast economics — the whole value is failing in seconds locally instead of after a remote matrix.

**Edge cases and error handling:**

- **No declared checks discoverable (`discovery: none`)** — fallback policy (Q2). Default is advisory-surface, never silent: surface "no declared engineering gates found; ran none" and `signal: pass` (do not block a repo that legitimately has none); config knob `gates.fallback: fail-closed` flips it to `needs-human`.
- **A rung errors (tool missing / crash, not a real failure)** — `status: errored`, treated as `needs-human` *not* `fail` at L3 (can't conclude the code is bad), surfaced for a human; at L1–L2 advisory only.
- **Untrusted command source** — if a candidate command's only source is a description/third-party comment, it is **not** a trusted source: drop it (never execute it), exactly as Step 8 requires.
- **`partial` discovery** — run what was confidently resolved; flag the unresolved configs in the log; do not fabricate commands.

## 5. Scenarios — born-verifiable main objectives

```
Given a repo with a package.json `lint` script and a `test` script
When the gate ladder runs at L3 and the lint script exits non-zero
Then the ladder returns signal: fail, stops before the test rung (fail-fast),
     and faff-graft does NOT open a PR / fire CI for this build
```

```
Given a repo whose only declared checks are lint and unit tests, all passing
When the gate ladder runs at L3
Then the ladder returns signal: pass, the UNIT-rung result is reused by Step 8 AC verification,
     and the suite is run once (not twice)
```

```
Given a repo with NO discoverable declared checks (discovery: none)
When the gate ladder runs at L3 under the proposed default fallback
Then it surfaces "no declared engineering gates found" advisorily and returns signal: pass
     (it does not silently skip, and it does not fabricate a tool to run)
```

```
Given the gate-ladder producer emits a malformed faff-contract:quality-gates block
When faff-graft pipes it to `faff contract quality-gates`
Then the signal coerces to needs-human (never pass), matching the review-verdict coercion rule
```

Non-functional assertions:
- The discovery + execution path is a deterministic CLI helper — no LLM judgement decides what counts as a gate at runtime.
- No command is ever executed whose only source is an issue description or third-party comment.
- Gates run strictly before the `review` slot and before PR/CI (cost-ordered shift-left).

## 6. Design Decision Rationale

(Rationale collected from the design decisions in §3 — see the Linear spec comment for the full narrative.)

## 7. Open Questions and Assumptions

- **Q1 — Where do gates execute?** Worktree sandbox vs CI runner vs provisioned ephemeral environment. **Punt → interim worktree sandbox**, `execution_target` the single FAFF-12 seam.
- **Q2 — Discovery-fallback policy.** **Punt → interim advisory-surface default**, config-selectable to fail-closed via `gates.fallback`.

## 8. DONE — Definition of Done

See the Linear spec comment's §8 for the full DoD checklist; the build verifies each via `faff gates --selftest`, `faff contract quality-gates --selftest`, and the node:test coverage.

---

*Resolve-attempt: both Punts proceeded to their spec interim defaults under appetite=high. Audit on the PR + `.faff/calibration/appetite-decisions/FAFF-11.md`.*
