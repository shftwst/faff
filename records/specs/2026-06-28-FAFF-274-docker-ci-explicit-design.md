# Make the env integration test's docker dependency explicit in CI

> Spec: faffter-dark-nlspec · 2026-06-28 · autonomous · confidence: high. Full spec on Linear FAFF-274.

This is the build spec for **FAFF-274**, a CI/test-harness hardening follow-up to FAFF-270 (live compose provisioning). Audience: the build agent implementing the change, and the human reviewers of the resulting PR. It turns one silent coverage-erosion hole into a loud, fail-fast guard.

## 1. WHY — Problem and Principles

**Load-bearing model.** A docker-gated test that *skips* when docker is absent is indistinguishable, in a green CI run, from one that *passed* — unless something external asserts the test actually ran. The fix is to make "docker was here and the integration test ran" a checked precondition on the lane that promises it, not an unstated hope.

**Problem statement.** FAFF-270's live provision→seed→teardown is covered by a docker-gated integration test in `test/env.test.mjs` that runs when `docker info` succeeds and *skips* (never fails) otherwise. On today's CI lane (`validate.yml`, `ubuntu-latest`) docker is present so it genuinely runs (PR #207: real postgres lifecycle, `# skipped 0`). The hole: the skip is silent — if a future runner ever lacked docker (restricted/self-hosted runner, daemon fails to start, `act`), the test would quietly skip and CI would still go green, degrading "tested" → "not run" with no signal.

**Design principles.**

- **The fallback must survive.** The in-test skip-gate is correct behaviour for a genuinely docker-less local/dev `node --test`. The guard adds a *CI-lane-scoped* loud failure on top of it; it does not delete the graceful local skip. An implementation that makes a docker-less local run fail is wrong.
- **Loud over clever.** The failure must name the cause in plain words ("docker required on this lane / the env integration test was skipped"), not surface as an opaque assertion deep in buffered TAP output a human has to decode.
- **Same failure mode FAFF-270 exists to prevent.** A `status: ready` nobody checked is exactly the trap; this issue closes its relocation into the test lane.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` | YAML (GitHub Actions) | The CI lane; the final step runs `node --test`. The guard is added here. |
| `test/env.test.mjs` | JavaScript (node:test) | Holds the docker-gated integration test (`dockerAvailable()` → `{ skip }`). Self-defending assertion added here. |

**Scope statement.** A two-part guard spanning the CI workflow and the one docker-gated test it must not let skip silently — no change to the env provisioning code itself.

## 2. OUT OF SCOPE

- **Sibling seed-loader follow-ups (redis / mongo / S3).** — Why excluded: independent work tracked separately; this issue is only about the docker-skip visibility. Extension point: their own tickets; this guard naturally covers any future docker-gated test that opts into the same env var.
- **Removing or weakening the in-test skip-gate.** — Why excluded: the graceful local skip is a feature, not the bug. Extension point: none — it stays.
- **A generic "no test may silently skip" CI policy across the whole suite.** — Why excluded: over-broad; other tests skip legitimately and a blanket TAP-skip-count gate would be brittle. Extension point: if a global policy is ever wanted, it would live as its own `node --test` reporter/wrapper ticket.
- **Making docker a hard dependency of local development.** — Why excluded: contributors without docker must still run the non-docker suite. Extension point: none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| docker-expecting lane | A CI lane that is *supposed* to have docker available (today: `validate.yml` on `ubuntu-latest`). On such a lane, a skipped docker-gated test is a defect, not a graceful degrade. |
| skip-gate | The in-test `{ skip: DOCKER ? false : "docker unavailable" }` option that turns the integration test into a no-op when docker is absent. |
| require-docker signal | An environment variable the CI lane sets to declare "docker MUST be present and this test MUST run here." |

**Interface — the require-docker signal.**

```
ENV FAFF_REQUIRE_DOCKER
  semantics: set + non-empty  → docker-gated env test MUST run; absence of docker is a FAILURE, not a skip
             unset / empty    → legacy behaviour: docker absent → graceful skip (local/dev)
  set by:    validate.yml, on the `node --test` step only (lane-scoped)
  read by:   test/env.test.mjs, when computing the integration test's skip option
```

**Design decisions.**

- **How to assert the test ran.** Options: (a) parse the TAP `# skipped` count in a CI step; (b) an env-var-gated assertion inside the test that flips skip→fail on the require-docker lane. **Chosen:** (b) `FAFF_REQUIRE_DOCKER` — it is specific to *this* test (a future legitimately-skipped test won't trip it), needs no fragile TAP text parsing, and defends even if the workflow-level docker check is later reordered or removed. (a) rejected: brittle and global; couples the guard to TAP output format.
- **Whether to also add a workflow-level `docker info` pre-step.** Options: env-gate alone; env-gate + an explicit `docker info` step. **Chosen:** both — they close different gaps. The pre-step fails fast with a crystal-clear lane-level message *before* the test phase runs (good DX, no TAP-decoding); the env-gate is the precise per-test "this specific test actually executed" assertion that also catches docker-present-but-test-skipped (e.g. a `dockerAvailable()` flake). Each is ~3 lines; neither subsumes the other.
- **Scope of the env var.** Options: workflow-global env; step-scoped env. **Chosen:** step-scoped on the `node --test` step only — other (current or future) test invocations are not forced to require docker.

## 4. HOW — Behavior

**Architecture and approach.** Two complementary edits, no provisioning-code change:

1. **`test/env.test.mjs`** — make the integration test self-defending. Read the require-docker signal; when it is set and docker is unavailable, *run* the test (don't skip) so its body fails loudly. Concretely, the skip option becomes a three-way and the test body asserts docker presence first.

```
REQUIRE_DOCKER := truthy(process.env.FAFF_REQUIRE_DOCKER)
DOCKER         := dockerAvailable()            # unchanged: `docker info` probe

skipOption := DOCKER          ? false                       # docker here → run
            : REQUIRE_DOCKER  ? false                       # required but absent → RUN so it can FAIL
            :                   "docker unavailable"         # local/dev → graceful skip

PROCEDURE integration_test (skip: skipOption):
  1. assert DOCKER is true,
       message: "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the env integration test (FAFF-274)"
  2. ... existing up → seed → teardown body, unchanged ...
```

2. **`.github/workflows/validate.yml`** — two changes around the existing final `node --test` step:
   - Add a step (immediately before the test step) that asserts `docker info` succeeds, failing the job with a clear message (a GitHub `::error::` annotation) when it does not.
   - Set `FAFF_REQUIRE_DOCKER: "1"` in the `env:` of the `node --test` step (lane-scoped).

```
- name: Assert docker present (env integration test must not silently skip — FAFF-274)
  run: |
    docker info >/dev/null 2>&1 || {
      echo "::error::docker unavailable on a lane that must run the env integration test (FAFF-274)"
      exit 1
    }

- name: Run skill/CLI behaviour tests (node:test)
  env:
    FAFF_REQUIRE_DOCKER: "1"
  run: node --test
```

**Edge cases and error handling.**

- **docker daemon present in pre-step but flaky at test time** → pre-step passes, but the test's own `dockerAvailable()` returns false; with `FAFF_REQUIRE_DOCKER` set the env-gate makes the test *fail* (not skip). Both layers needed — this is the case the pre-step alone misses.
- **Local `node --test` (no env var)** → `FAFF_REQUIRE_DOCKER` unset → skip-gate path unchanged → docker-less run passes with the integration test skipped. No regression.
- **Local run *with* docker** → `DOCKER` true → test runs exactly as today, env var irrelevant.
- **`FAFF_REQUIRE_DOCKER` set empty-string** → treated as unset (truthy check on non-empty), so it degrades safe to the local-skip path. Only a non-empty value arms the guard.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the env-gate arms but the assertion message/skip wiring is mis-ordered (e.g. `skip` still true when required), so a required-but-absent docker still skips silently — the exact hole, unclosed. **How you'd know:** a deliberate dry-run with `FAFF_REQUIRE_DOCKER=1` and docker stopped must show the test *failing*, not `# skipped`. **What it means:** proceed only once that dry-run fails as expected.
- **The failure:** the pre-step's `docker info` check passes on a lane where the test still can't reach the daemon (socket perms), so CI greens while the test skipped. **How you'd know:** `# skipped` count for the env test > 0 despite a green pre-step. **What it means:** the env-gate (layer 2) is what actually catches this — confirm it fires.

**Anti-pattern:** gating the guard by parsing `node --test` TAP `# skipped N` in a shell step. Why: any unrelated future skip trips it, and it couples CI to TAP output formatting — the env-var-in-test approach is specific and robust.

**Anti-pattern:** removing the `"docker unavailable"` skip branch entirely to "force" docker everywhere. Why: it breaks every docker-less local `node --test`, violating the surviving-fallback principle.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a CI lane that is supposed to have docker (FAFF_REQUIRE_DOCKER=1)
When docker is unavailable on that lane
Then the job fails loudly with a clear message naming docker / the env integration test (FAFF-274)
  And CI does not go green
```

```
Given a genuinely docker-less local developer run (FAFF_REQUIRE_DOCKER unset)
When `node --test` runs
Then the suite passes
  And the env integration test is skipped via the intact skip-gate
```

```
Given the current CI lane where docker IS present
When `node --test` runs with FAFF_REQUIRE_DOCKER=1
Then the env integration test runs (not skipped) exactly as on PR #207
```

## 6. DESIGN DECISION RATIONALE

**How do we assert the docker-gated test actually ran?**
- *Options:* parse TAP `# skipped` in a CI step (global, text-coupled, brittle); env-var-gated in-test assertion (specific, robust).
- **Chosen:** `FAFF_REQUIRE_DOCKER` env-var-gated in-test assertion — scoped to exactly the test that must not skip; no TAP parsing; survives reordering/removal of the workflow docker step.

**Do we also add a workflow `docker info` pre-step?**
- *Options:* env-gate only; env-gate + explicit pre-step.
- **Chosen:** both — the pre-step gives a fast, human-clear lane-level failure before the test phase; the env-gate is the precise per-test ran-assertion and catches the daemon-flake case the pre-step misses. Low cost, complementary, neither alone covers both gaps.

**Workflow-global or step-scoped env var?**
- *Options:* job/workflow-level `env`; step-level `env` on the test step.
- **Chosen:** step-scoped — only the `node --test` step declares the require-docker contract; nothing else is coerced.

At the time of writing the repo has no `package.json` (zero-dependency, node:test only) and node v22 on CI (v20 pinned in `setup-node`); both edits are dependency-free and need no new tooling.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the CI lane that runs `node --test` is the docker-expecting lane (today the single `validate` job in `validate.yml`). Validation: confirm `validate.yml` has exactly one `node --test` invocation and it is on the `ubuntu-latest` `validate` job before adding the pre-step + `env:` there.
- **Assumes:** `dockerAvailable()` in `test/env.test.mjs` remains the `execFileSync("docker", ["info"], …)` probe. Validation: read the function before wiring the env-gate to its `DOCKER` result; reuse it, do not re-probe.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a docker-expecting lane with docker absent, CI fails loud with a clear message (does not go green).

### From WHAT (interface)
- [ ] `FAFF_REQUIRE_DOCKER` is read by `test/env.test.mjs` and set (value `"1"`) on the `node --test` step in `validate.yml`, step-scoped.

### From HOW (behaviour — test)
- [ ] The env integration test's skip option is three-way: docker present → run; required-but-absent → run (so it fails); neither → skip with `"docker unavailable"`.
- [ ] The test body asserts docker presence first, with a message naming `FAFF_REQUIRE_DOCKER` and FAFF-274.

### From HOW (behaviour — workflow)
- [ ] `validate.yml` has a `docker info` pre-step (before `node --test`) that fails the job with a clear `::error::` message when docker is absent.
- [ ] The `node --test` step sets `FAFF_REQUIRE_DOCKER: "1"` in its `env:`.

### From HOW (edge cases)
- [ ] A docker-less local `node --test` (env var unset) still passes, with the integration test skipped (no regression).
- [ ] An empty-string `FAFF_REQUIRE_DOCKER` degrades to the local-skip path (only non-empty arms the guard).

### From SCENARIOS
- [ ] Dry-run with `FAFF_REQUIRE_DOCKER=1` and docker stopped shows the env test FAILING (not `# skipped`).
- [ ] Current docker-present lane still shows the env test running (`# skipped 0` for it).

**Integration smoke test (pseudocode):**

```
# layer 2 (test self-defence), the load-bearing assertion:
FAFF_REQUIRE_DOCKER=1 docker-stopped → `node --test` → exit ≠ 0, env test reported failed (not skipped)
unset                 docker-stopped → `node --test` → exit 0, env test skipped
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
