# Make the `node --test` suite hermetic against ambient faff state (env / `.faff/runs/` / `.faffrc`)

> Spec: faffter-dark-nlspec · 2026-08-12 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-785.

This is the build spec for FAFF-785. Its audience is the build agent that will make the suite hermetic, and the human reviewers of the resulting PR. It turns the reported symptom — "~20 cases fail on unmodified `main` in a self-hosting checkout" — into a scoped, born-verifiable change grounded in a live reproduction on this repo.

## 1. WHY — Problem and Principles

**The load-bearing model:** a `node --test` case is only a signal about the *diff* if its result is independent of the machine it runs on. Today many cases silently read three ambient inputs — the process environment, the repo-root `.faff/runs/` history, and the repo-root `.faffrc.yaml` — so on a checkout that is itself a live faff repo they measure the *environment*, not the code. Hermeticity is the property being restored: same code in, same result out, regardless of ambient faff state.

**Problem statement.** On a clean CI checkout the suite is green, but on the self-hosted L3 runner (FAFF-643/FAFF-609, "your laptop is the factory") the same suite runs inside a live faff repo with a populated `.faff/runs/` history, an operator shell full of `FAFF_*`/`CLAUDE_*` variables, and a possibly-dirty `.faffrc.yaml`. Roughly two dozen cases assume none of that exists and fail. This makes the runner's post-merge UNIT-rung verification return `verified-fail` on essentially every merge, eroding a gate that is supposed to reflect the diff.

**Design principles.**

- **A hermetic test depends on nothing it did not itself create.** Any case that asserts "clean/empty faff state" must construct that state in a fixture (tmpdir cwd, controlled config, scrubbed env), never inherit it from the checkout. This is the FAFF-561 / FAFF-467 house pattern, applied at suite scale.
- **Fix the leak at the seam, not case-by-case where avoidable.** The dominant vector is one seam — child processes inheriting the operator's environment. Close it once centrally rather than editing dozens of call sites; reserve per-case edits for the residual cwd/config reads.
- **Do not mask regressions to quiet the gate.** The correct fix is a hermetic suite that is genuinely green on clean `main`, not a runner-side filter that hides real failures behind "pre-existing" bookkeeping.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/helpers/run-cli.mjs` | JS (node:test) | Shared CLI spawn seam; `cwd` defaults to repo root, `env` passes through `process.env` — both leak vectors |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JS | `findRoot()` / `latestRunDir()` — how the CLI discovers the ambient `.faff/runs/` history a test then reads |
| `test/models-config.test.mjs` | JS (node:test) | FAFF-467 class: per-test `mkdtempSync` + `cwd: dir` isolation — the pattern to mirror |
| `test/impure/worktree-root.test.mjs` | JS (node:test) | FAFF-561 (Done): the ambient-worktree isolation sibling |
| `.github/workflows/validate.yml` | YAML | Runs bare `node --test`; the one place a suite-level preload is wired in |

**Scope statement.** This sits entirely in the test harness plus its CI invocation; it changes how tests are isolated, not what any production CLI command does.

## 2. OUT OF SCOPE

- **A first-class `FAFF_STATE_DIR` CLI env redirect.** — A production env var that redirects the `.faff` state root would let a single suite-level guard also fix the cwd/`.faff/runs` reads. Why excluded: it expands the CLI's public env contract and is a design decision beyond a test-hygiene bug; the established house pattern (FAFF-467/561) isolates in tests, not by adding CLI env surface. Extension point: `plugin/skills/faff/bin/lib/shared-infra.js` `findRoot()` / `latestRunDir()` would grow an env override; file it as its own ticket if the runner later wants central redirection.
- **The `test/impure/setup-worktree-*.test.mjs` git/worktree-state failures.** — 5 observed failures (FAFF-532/186/595/708 cases) persist even with the environment scrubbed; they are driven by ambient git state (real `git fetch`/worktree against `origin`, tracked-vs-untracked `.faffrc.yaml`, default-branch resolution), not the `.faff/runs`+env class this ticket targets. Why excluded: distinct vector, sibling to FAFF-561's ambient-git family. Extension point: `test/impure/setup-worktree-*.test.mjs` — handle under a dedicated follow-up in the FAFF-561 family.
- **Changing the L3 runner's post-merge UNIT-rung logic (e.g. baseline-diff against `main`).** — Why excluded: once the suite is hermetic the runner's post-merge rung passes on clean `main` and a baseline-diff is unnecessary; adding one risks masking real regressions (principle 3). Extension point: the runner's post-merge verification step (FAFF-643) — revisit only if a hermetic suite still proves noisy.
- **The `oracle-triage` "FAFF-670 extension record" case and the residual `sentry-poller` "fix-review-thrash" case.** — Why excluded: the former reads real repo git/working-tree state (dirty tree / `origin_commit`), a git-state concern like the impure set; the latter is a single env-independent case adjacent to the now-Done FAFF-686 poller flake and needs its own root-cause. Extension point: `test/oracle-triage.test.mjs` and `test/sentry-poller.test.mjs` — fold into the git-state follow-up or a targeted flake pass.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Hermetic case | A test whose pass/fail depends only on the code under test and fixtures it creates, never on ambient env / `.faff/runs/` / `.faffrc` |
| Leak vector | An ambient input a case reads without meaning to: (1) inherited env, (2) default-cwd `.faff/runs/` history, (3) default-cwd `.faffrc.yaml` |
| Control-env keys | The `FAFF_*` and faff-relevant `CLAUDE_*` process-env variables that steer faff behaviour and must not leak into test children |
| Suite-preload | A module loaded via `node --import` before any test file, so its effect on `process.env` is inherited by every spawned child |

**The three leak vectors (grounded in this repo's reproduction).**

- **Vector 1 — inherited environment (dominant).** `test/helpers/run-cli.mjs` spawns with `env: opts.env ?? process.env`, and several per-file helpers (`sentry.test.mjs`, `config-strict-base.test.mjs`, others) spawn with `{ ...process.env, ... }`. Any ambient `FAFF_*`/`CLAUDE_*` value therefore reaches the child CLI. Scrubbing these keys from `process.env` before the suite runs dropped the non-impure failing set from ~19 to 2 in the live reproduction.
- **Vector 2 — default-cwd `.faff/runs/` history.** `run-cli.mjs` defaults `cwd` to the repo root; `latestRunDir(findRoot(cwd))` then discovers the checkout's real run history, so "no run at all" assertions (e.g. `sentry.test.mjs` FAFF-425) fail because there *is* a run history.
- **Vector 3 — default-cwd `.faffrc.yaml`.** The same default cwd means config-resolution cases read the repo's own (possibly dirty) `.faffrc.yaml` instead of a fixture (e.g. `config-strict-base.test.mjs` malformed-base assertions, `appetite-resolution`, `convergence-resolution`).

**The control-env key set** (scrubbed by the suite-preload). Defined by prefix minus a small exempt-list, so a newly-added faff-behaviour variable is covered by construction while the one CI test-orchestration signal survives:

```
EXEMPT = { "FAFF_REQUIRE_DOCKER" }   # CI test-orchestration, NOT a faff-runtime-behaviour leak
SCRUB  = ({ every process.env key matching /^FAFF_/ } ∪ { every key matching /^CLAUDE_/ }) \ EXEMPT
```

The observed offenders in the live run were `FAFF_RUN_DIR`, `FAFF_SESSION_ID`, `FAFF_WORKTREE_ROOT`, `FAFF_MODEL`, `FAFF_EFFORT`, `FAFF_WINDOW_TOKENS`, `FAFF_WINDOW_HOURS`, `FAFF_DROP_BACKENDS`, `FAFF_SPEC_REVIEW_SLOT`, `FAFF_REVIEW_SLOT`, `FAFF_ISSUE_IDS`, `FAFF_DRAIN_TIMEOUT`, and `CLAUDE_CODE_SESSION_ID` — the prefix rule subsumes all of them. `FAFF_REQUIRE_DOCKER` is exempt because `.github/workflows/validate.yml` sets it to make docker-gated cases *fail loud rather than silently skip* (FAFF-274); scrubbing it in-process would re-open exactly the silent-skip hole that guarantee closed.

**Design decisions.**

- **How to close Vector 1 — central preload vs shared helper vs per-file edits.** Options: (a) a suite-preload module loaded via `node --import` that deletes the control-env keys from `process.env` once, so every child (shared and per-file spawner) inherits a clean env; (b) route every spawn through one scrubbed helper — but that is 45+ `runCli` sites plus the per-file `execFileSync`/`spawnSync` helpers, high churn and easy to regress; (c) edit each failing file's env — most churn, no guard against the next case. **Chosen:** (a) a suite-preload module (`test/hermetic-env.mjs`) — one file, inherited by all children, zero per-test churn, and it also covers per-file helpers that never touch `run-cli.mjs`.
- **How the preload is activated.** The preload only helps if it loads before test files. **Chosen:** invoke the suite as `node --import ./test/hermetic-env.mjs --test` in every runner (the `validate.yml` coverage step and any local/CI `node --test` invocation), and document it as the canonical way to run the suite. A bare `node --test` remains valid on a clean checkout; the preload is what makes a *dirty* checkout match it. Verified empirically during prep (node 22, multi-file + `--test-concurrency=4`): the `--import` scrub reaches each per-file test-runner child and the CLI grandchildren they spawn.
- **How to close Vectors 2 and 3.** **Chosen:** apply the established FAFF-467/561 per-test fixture pattern — `mkdtempSync` a temp dir, write the controlled `.faffrc.yaml` the case needs (or none), and pass `cwd: <dir>` — to each residual case that reads the repo-root `.faff/runs/` or `.faffrc`. The env-preload alone does not redirect cwd, so these need the fixture even after Vector 1 is closed.
- **Whether to also change `run-cli.mjs`'s default cwd.** **Chosen:** leave the default cwd at repo root. Many cases legitimately run against the real repo tree; flipping the default would break them. Isolation is opt-in per case via the `cwd` fixture, matching today's helper contract.
- **Whether to exempt any control-env key from the scrub.** **Chosen:** exempt exactly `FAFF_REQUIRE_DOCKER`. It is a CI test-orchestration signal (validate.yml sets it so docker-gated cases fail loud rather than skip — FAFF-274), not a faff-runtime-behaviour input; scrubbing it in-process would silently re-open the skip hole that guarantee closed. No other key qualifies today. **Acknowledged residual (spec-review):** exempting one key is a bounded, deliberate exception to principle 1 — a self-hosting operator who exports `FAFF_REQUIRE_DOCKER=1` without docker reintroduces one env-driven fail-loud; the hermetic default is simply to leave it unset (docker-gated cases then self-skip). This is a knowing tradeoff to preserve the FAFF-274 CI guarantee, flagged here for the human's call.

## 4. HOW — Behavior

**Architecture and approach.** Two independent, composable changes:

1. **`test/hermetic-env.mjs` — the suite-preload.** At module load (before any test file), delete every control-env key from `process.env`. Because it is loaded via `node --import`, the mutation happens in the parent test-runner process (and, via execArgv forwarding, in each per-file test child), so every `spawnSync`/`execFileSync` child — whether via `run-cli.mjs` or a per-file helper — inherits the already-scrubbed environment. No test file needs to change to benefit from it.

2. **Per-case fixtures** for the residual Vector-2/Vector-3 cases the preload cannot reach (cwd-driven reads of `.faff/runs/` and `.faffrc`).

**Behaviour summary — the preload.** It makes the process environment look like a clean CI checkout with respect to faff, so that any child CLI resolves config and run-state from fixtures/defaults rather than the operator's shell.

```
PROCEDURE hermetic_env_preload():   # runs once, at --import load time
  1. EXEMPT := { "FAFF_REQUIRE_DOCKER" }
  2. FOR each key IN Object.keys(process.env):
       a. IF (key matches /^FAFF_/ OR key matches /^CLAUDE_/) AND key NOT IN EXEMPT:
            delete process.env[key]
  3. (No return; side effect is the scrubbed process.env every child inherits.)
```

**Anti-pattern:** scrubbing by enumerating a fixed name list. Why: the next `FAFF_*` variable added anywhere would silently re-open the leak; match by prefix.

**Anti-pattern:** deleting a broad set like all of `process.env` or unrelated keys (`PATH`, `HOME`, `TMPDIR`, `NODE_V8_COVERAGE`). Why: children need those to run and CI needs `NODE_V8_COVERAGE` passthrough (FAFF-581); scope the deletion to the two faff-owned prefixes only, minus the `EXEMPT` set.

**Behaviour summary — a fixtured case.** A case that asserts clean/empty faff state builds that state in a tmpdir and points the CLI at it.

```
PROCEDURE isolate_case():
  1. dir := mkdtempSync(join(tmpdir(), "faff785-"))
  2. IF the case needs a specific config: writeFileSync(join(dir, ".faffrc.yaml"), <fixture>)
     ELSE: leave dir with no .faffrc.yaml (the "clean" case)
  3. run the CLI with { cwd: dir }   # findRoot() resolves to dir; latestRunDir(dir) is null
  4. assert on the deterministic result
  5. rmSync(dir, { recursive: true, force: true })
```

**Edge cases and error handling.**

- **Precedence with an explicitly-passed env.** A case that passes its own `env` to `runCli` still gets the scrubbed baseline first (the preload already ran in the parent/child), then its own overrides — behaviour is byte-identical to today for a case that sets exactly the keys it needs.
- **Coverage passthrough must survive.** `NODE_V8_COVERAGE` is not `FAFF_*`/`CLAUDE_*`, so the prefix scrub leaves it intact; the `run-cli.mjs` passthrough (FAFF-581) keeps working.
- **Docker-gated cases (`FAFF_REQUIRE_DOCKER`).** Exempt from the scrub (see the `EXEMPT` set), because it is the CI signal that turns a docker-gated case into a hard failure instead of a silent skip (FAFF-274). It therefore survives into the test-file process and any child, and the docker gate keeps working unchanged.

**Failure modes.**

- **The failure:** the exact ambient failing set is environment-dependent, not a fixed 20 — the live reproduction showed 27 with a full operator shell, ~2 (non-impure) with the env scrubbed. A fix "verified" only against one machine's 20 could miss cases that only fail under a different ambient set. **How you'd know:** after the fix, a case still fails when run with a deliberately hostile env (`FAFF_RUN_DIR`, `FAFF_MODEL`, etc. all set) and a populated `.faff/runs/`. **What it means:** narrow — add the missed case to the fixtured set; the preload + fixture pattern is still correct, the coverage was incomplete.
- **The failure:** the `EXEMPT` set is wrong — either it lets a real behaviour-leak through (an exempted key that does steer runtime faff), or it scrubs a second CI-orchestration key it shouldn't. **How you'd know:** a formerly-failing case still fails with the preload on (leak let through), or a CI lane self-skips / mis-counts (orchestration key wrongly scrubbed). **What it means:** narrow the `EXEMPT` set to exactly the CI-orchestration keys; at the time of writing `FAFF_REQUIRE_DOCKER` is the only one.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a checkout with a populated .faff/runs/ history and an operator shell exporting
      FAFF_RUN_DIR, FAFF_MODEL, FAFF_SESSION_ID (and other FAFF_*/CLAUDE_* vars)
When the suite is run as `node --import ./test/hermetic-env.mjs --test`
Then the previously env-driven failures (config-strict-base, sentry "no run", appetite-resolution,
     convergence-resolution, sentrycheck, the lights-out ambient-config/session cases) all pass
```

```
Given the same hostile checkout
When a single fixtured case (e.g. sentry "no run at all") runs
Then it constructs its own tmpdir cwd with no .faff/runs/ and asserts the all-clear result,
     independent of the checkout's real run history
```

```
Given a docker-gated case that must fail-loud (not skip) when docker is required
When the suite runs with FAFF_REQUIRE_DOCKER=1 exported and the preload active
Then FAFF_REQUIRE_DOCKER survives the scrub (it is EXEMPT) and is visible to the case and its children,
     so a docker-required case fails loud on missing docker rather than silently skipping
     (the CI docker-lane test-count floor holds)
```

```
Given a pristine checkout (empty .faff/runs/, no ambient FAFF_*/CLAUDE_*)
When the suite is run once WITH the preload and once WITHOUT it
Then the two runs produce identical pass/fail results — the preload is a verifiable no-op on a clean checkout
```

- The suite run on a clean checkout (empty `.faff/runs/`, no ambient `FAFF_*`) MUST remain green — the change is a no-op there.

## 6. DESIGN DECISION RATIONALE

**Central preload vs per-site scrub for the environment vector?**
- Options: suite-preload via `--import`; a single scrubbed spawn helper; per-file env edits.
- Preload: one file, inherited by all children including per-file spawners, zero per-test churn. Helper: forces migrating 45+ `runCli` sites plus per-file `execFileSync`/`spawnSync` helpers, and the next hand-rolled spawn re-opens the leak. Per-file: most churn, no guard.
- **Chosen:** suite-preload (`test/hermetic-env.mjs`) — the leak is one property of the parent process env; fix it once where every child inherits it.

**Prefix match vs explicit key list for the scrub set?**
- **Chosen:** prefix match `/^FAFF_/` and `/^CLAUDE_/`, minus an `EXEMPT` set. Rationale: a frozen list rots the moment a new control var is added; the prefix is the actual invariant ("faff-owned env is not test input").

**Any exemption from the prefix scrub?**
- **Chosen:** exempt `FAFF_REQUIRE_DOCKER` only. Rationale: it is CI test-orchestration (fail-loud-not-skip, FAFF-274), not a runtime-behaviour leak; a blanket scrub would silently convert required docker cases into skips. The `EXEMPT` set is the narrow escape hatch, currently a single key. (See the acknowledged bounded-residual note in Section 3.)

**Fixtures vs a new CLI env redirect for the cwd/`.faff/runs` vector?**
- **Chosen:** per-test `mkdtempSync` + `cwd` fixtures (FAFF-467/561 pattern). Rationale: matches the shipped house pattern, adds no CLI public-env surface. A `FAFF_STATE_DIR` redirect is documented as an out-of-scope extension if central redirection is later wanted.

**Rely on hermeticity vs baseline-diff the runner's post-merge rung?**
- **Chosen:** rely on hermeticity; do not add a baseline-diff. Rationale: a hermetic suite passes on clean `main` so the rung is honest; a diff-filter could hide real regressions (principle 3). At the time of writing the runner already reproduces-on-main to classify; that stays as a classifier, not a mask.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The two ticket "open questions" are answered by the reproduction:
- *Is the failing set exactly 20 and stable?* No — it is environment-dependent (27 with a full operator shell here; ~2 non-impure with env scrubbed). The **classes** are stable; the count is not. The fix targets the classes, so exact count is not load-bearing.
- *Do these fail in clean CI too, or only self-hosting?* Primarily self-hosting — the dominant vector is ambient env, which clean CI lacks; scrubbing it recovers ~17/19 non-impure cases. They are nonetheless genuine test-hygiene bugs (a hermetic test must not read ambient state at all), so the same fix serves both framings.

**Assumptions.**

- **Assumes:** the CI `node --test` invocation(s) in `.github/workflows/validate.yml` and any local/`scripts/` runner can be changed to `node --import ./test/hermetic-env.mjs --test`. Validate: grep the repo for `node --test` invocations (`.github/workflows/`, `scripts/`, docs) and update each; the build agent confirms none is out of reach.
- **Assumes:** node's `--import` preload's `process.env` mutation reaches the CLI grandchildren spawned by per-file test children. Validate: verified empirically during prep on node 22 (multi-file + `--test-concurrency=4`, hostile env: with the preload each per-file child and its spawned grandchild saw `FAFF_RUN_DIR` undefined and the exempt `FAFF_REQUIRE_DOCKER` surviving; without it the grandchild saw the leaked value) — the build agent re-confirms on the CI node version (20).

## 8. DONE — Definition of Done

### From WHY
- [ ] Running the full suite on this self-hosting checkout (populated `.faff/runs/`, full `FAFF_*`/`CLAUDE_*` operator shell) via the documented preload invocation yields zero failures attributable to the env / `.faff/runs` / `.faffrc` vectors. The attribution boundary is deterministic — the ONLY permitted remaining failures are the exact out-of-scope set named in Section 2: the `test/impure/setup-worktree-*.test.mjs` cases (FAFF-532/186/595/708), the `oracle-triage` FAFF-670 extension-record case, and the `sentry-poller` fix-review-thrash case. Any failure outside that named set is in scope and must be fixed.

### From WHAT (leak vectors)
- [ ] Vector 1 closed: a spawned faff child sees no `FAFF_*`/`CLAUDE_*` key (bar the `EXEMPT` set).
- [ ] Vector 2 closed: cases asserting "no run"/empty history use a tmpdir cwd with no `.faff/runs/`.
- [ ] Vector 3 closed: config-resolution cases use a tmpdir cwd with the fixture `.faffrc.yaml` they need (or none).

### From HOW (behaviour)
- [ ] `test/hermetic-env.mjs` deletes exactly the `/^FAFF_/` and `/^CLAUDE_/` keys from `process.env` at load (bar `EXEMPT`), and nothing else.
- [ ] The suite is invoked with `node --import ./test/hermetic-env.mjs --test` in `.github/workflows/validate.yml` (and any other `node --test` runner), and this is documented as the canonical run command.
- [ ] `NODE_V8_COVERAGE`, `PATH`, `HOME`, `TMPDIR` survive the scrub (coverage passthrough still works).
- [ ] The formerly env-driven files pass: `config-strict-base`, `sentry`, `sentrycheck`, `appetite-resolution`, `convergence-resolution`, and the ambient-config/session `lights-out` cases.

### From HOW (edge cases)
- [ ] `FAFF_REQUIRE_DOCKER` is exempt from the scrub, so a docker-gated case still fails-loud (never silently skips) — CI docker-lane test-count floor holds.
- [ ] A clean checkout (empty `.faff/runs/`, no ambient `FAFF_*`) stays green — the change is a no-op there.

**Automated oracle vs manual smoke.** The core mechanism (a spawned child sees no `FAFF_*`/`CLAUDE_*` key, exempt-key survives) is asserted **automatically** by the holdout scenario and the docker-exemption scenario in Section 5 — those are the born-verifiable oracle a build must satisfy. The procedure below is the illustrative manual sanity check (nlspec smoke tests are not exhaustive and are not themselves a gate); it exists to let a human confirm the plumbing end-to-end, not to replace the scenario assertions.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. export FAFF_RUN_DIR=/tmp/whatever FAFF_MODEL=sonnet   # simulate operator shell
  2. run: node --import ./test/hermetic-env.mjs --test test/config-strict-base.test.mjs test/sentry.test.mjs
  3. assert: exit 0, no "not ok" lines
  4. run the same two files WITHOUT the preload and WITH those vars set
  5. assert: the previously-observed failures reappear — specifically config-strict-base and sentry each
     emit >=1 "not ok" line that the preload run did not, confirming the preload is the cause
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
