# Spec — FAFF-561: isolate `test/worktree-root.test.mjs` from ambient host worktree state

> Spec: faffter-dark-nlspec · 2026-08-11 · autonomous · confidence: high. Full spec on Linear FAFF-561.

This is the build spec for FAFF-561, a test-isolation (test-hygiene) bug. Audience: the build agent making the change, and human reviewers. It fixes a flaky test file without any product/CLI behaviour change.

## 1. WHY — Problem and Principles

**The load-bearing model.** `test/worktree-root.test.mjs` exercises the real `faff worktree-root` CLI by spawning it as a child process (via the `runCli` helper). The child inherits the *ambient* process environment. The resolver's **`default`-source branch** is the only one that runs a live git probe (`mainWorktreeRoot()` → `git rev-parse --git-common-dir`) and reads the home directory — so its result is a function of the host's git-worktree topology and environment at test time, not of the throwaway fixture repo the test set up. The test therefore isn't hermetic: the same assertions pass or fail depending on what else is checked out on the machine.

**Problem statement.** Under concurrent build worktrees (the `faff post-merge-check` path runs `node --test` from a live detached worktree under `~/.faff/worktrees/faff/`), ~10 of 2134 tests flake, concentrated in this file — the `--assert: the resolved root itself is NOT strictly under` and `single-source: from a linked worktree, the resolved root equals the main-checkout root` assertions. They pass 8/8 in isolation and cannot be reproduced by re-running the exact shas in a clean worktree, which proves the flake tracks ambient host state, not any code diff (FAFF-559, the diff live at the time, is a SKILL.md-prose-only change that cannot affect `node --test`). This change makes the file deterministic regardless of host worktree state.

**Design principles.**

- **Isolate without changing what is tested.** The flaky assertions verify the `default` source specifically (`source: "default"`, `root = HOME/.faff/worktrees/<basename(repo)>`). The isolation must keep those assertions exercising that exact branch — including its live git probe anchored to the *fixture* repo — not route around it.
- **Sandbox the spawned child, not just one variable.** Overriding `HOME` alone (today's state) is insufficient: the leak is through the child's inherited environment reaching the git probe. The fix sanitises the child environment the resolver actually runs under.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/worktree-root.test.mjs` | Node (ESM) | The file under fix; `baseEnv()` builds the child env. |
| `test/helpers/run-cli.mjs` | Node (ESM) | `runCli` spawns `node <faffBin> <args>` with `{cwd, env}`; `env` (when supplied) *replaces* the child env. |
| `plugin/skills/faff/bin/lib/lights-out.js` | Node (CJS) | `cmdWorktreeRoot` / `resolveWorktreeRoot` — the resolver; `default` branch does the git probe + home read. |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CJS) | `findRoot` (cwd walk) and `mainWorktreeRoot` (`git rev-parse --git-common-dir`) — the only git-touching path. |
| `test/link-skills-worktree.test.mjs` | Node (ESM) | Convention precedent: "sanitise the child environment rather than merely overriding HOME" — deletes offending ambient vars / builds a minimal `{HOME, PATH}` env. |
| `test/lights-out.test.mjs` | Node (ESM) | Same worktree-root subsystem; uses mkdtemp HOME + explicit env deletes. |

**Scope statement.** This sits entirely in the test layer for the `faff worktree-root` resolver — no change to the resolver or any product code.

## 2. OUT OF SCOPE

- **Any change to `resolveWorktreeRoot` / `mainWorktreeRoot` / `findRoot` or the `worktree-root` CLI.** Why excluded: the resolver is correct; the defect is test hermeticity, not resolution logic. Extension point: if a future issue wants the resolver itself to ignore ambient git-context env, that is a product change in `plugin/skills/faff/bin/lib/shared-infra.js`, specced separately.
- **The other ~2 non-worktree-root failures in the original flaky run.** Why excluded: only the two named `worktree-root.test.mjs` assertions were captured before the ephemeral worktree was torn down, and the ticket Scope bounds this to `worktree-root.test.mjs`. Extension point: a follow-up test-hygiene sweep across the suite for ambient-state sensitivity (a natural sibling of FAFF-476's git-identity lesson) — file if the broader flake recurs after this fix.
- **A shared "hermetic child env" test helper.** Why excluded: this fix touches one file; extracting a reusable helper is a refactor with its own blast radius. Extension point: `test/helpers/` — promote the sanitiser there if a third test needs it.

## 3. WHAT — the environment-isolation contract

**Vocabulary.**

| Term | Definition |
|---|---|
| Default-source case | A `worktree-root` invocation with no `FAFF_WORKTREE_ROOT` env and no `worktree_root` config, so the resolver takes the `default` branch (git probe + home read). |
| Ambient git-context vars | Environment variables git honours for repository discovery even under `git -C <dir>`: `GIT_DIR`, `GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CEILING_DIRECTORIES`. When the suite runs inside a build worktree these are set in the ambient environment and, inherited by the child, redirect its probe off the fixture repo. |
| Hermetic child env | A controlled environment for the spawned resolver that carries only what it legitimately needs, so no ambient host state reaches it. |

**The change — `baseEnv` becomes a hermetic-env builder.** Today:

```
baseEnv(repo, extra) = { ...process.env, HOME:'/home/faff-test', ...extra, FAFF_WORKTREE_ROOT: extra.FAFF_WORKTREE_ROOT ?? '' }
```

The `...process.env` spread is the leak: it forwards ambient git-context vars into the child, which reach the `git -C <fixtureRepo> rev-parse --git-common-dir` probe. The fix builds the child env from a controlled base so the spawned resolver sees only the fixture repo.

**Interface (behavioural, not a literal implementation):**

```
FUNCTION baseEnv(repo, extra = {}):
  # Controlled base — enough for `node` + `git` to run, nothing ambient that
  # steers repo discovery. PATH is required (node + git must be found).
  base = { HOME: <fixed sentinel home>, PATH: process.env.PATH }
  # Default-source: FAFF_WORKTREE_ROOT must be ABSENT (empty ⇒ falls through to default).
  env = { ...base, ...extra }
  IF extra does not set FAFF_WORKTREE_ROOT: env.FAFF_WORKTREE_ROOT = ""
  RETURN env
```

- No `...process.env` spread. The only forwarded ambient value is `PATH` (so `node`/`git` resolve); no `GIT_*`, no ambient `FAFF_*`, no ambient `HOME`.
- `HOME` stays a fixed sentinel (`/home/faff-test`) so the existing `path.join(HOME, ...)` assertions are unchanged.
- The `extra` escape hatch is preserved verbatim for the env-source test (`FAFF_WORKTREE_ROOT: "/custom/wt"`) and, via the on-disk `.faffrc.yaml` fixture, the config-source test.

**Design decision.** **Chosen:** build the child env from a controlled base (drop the `...process.env` spread; forward only `PATH`, plus the fixed `HOME` and empty `FAFF_WORKTREE_ROOT`) rather than deny-listing individual `GIT_*` vars. Rationale in §6.

## 4. HOW — Behaviour

**Approach.** One function changes: `baseEnv`. Every `runCli` call in the file already routes its env through `baseEnv`, so sanitising it there fixes all cases with no per-test edits. The env-source and config-source tests keep working because they pass their source via `extra` / the on-disk fixture, both of which survive the controlled base.

**Regression guard (the load-bearing new test).** Add one test that reproduces the ambient leak deterministically and proves isolation, so the fix is verifiable without needing a live concurrent-worktree host:

```
PROCEDURE test_default_source_ignores_ambient_git_context:
  1. repo = tmpRepo()                                   # fixture main checkout
  2. bogus = a path to an unrelated throwaway git dir   # NOT repo
  3. env = baseEnv(repo) BUT injected with ambient git-context vars pointing at `bogus`
        (GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE = bogus)
  4. out = JSON.parse(runCli(["worktree-root","--json"], { cwd: repo, env }).stdout)
  5. ASSERT out.source === "default"
  6. ASSERT out.root === path.join(HOME, ".faff/worktrees", basename(repo))
        # i.e. the probe anchored to `repo`, NOT to `bogus`
```

The guard asserts the observable the two flaky assertions depend on (default root anchored to the fixture repo) under an injected ambient environment — turning an environment-dependent flake into a deterministic, always-runnable regression test.

**Anti-pattern:** switching the flaky tests to a `FAFF_WORKTREE_ROOT` override to "make them deterministic". Why: that flips `source` from `default` to `env` and skips the git probe entirely — the tests would then no longer verify the `default` branch that actually flakes, converting a real assertion into a vacuous one.

**Anti-pattern:** deleting `GIT_*` from a `...process.env` spread but leaving the spread in. Why: it re-introduces the same class of leak the moment another ambient variable (a future `GIT_*`, a `FAFF_*`, a tool var) influences the child; the controlled base closes the class, an allow-list beats a deny-list here.

**Failure modes.**

- **The failure:** the real ambient vector is *not* the git-context env vars (e.g. it is `os.tmpdir()`/`TMPDIR` resolving under a checkout, or a git config global). **How you'd know:** the new regression guard passes, but the full suite still flakes under concurrent worktrees on the host. **What it means:** narrow — widen the isolation to also pin `TMPDIR` to a fresh temp dir and/or set `GIT_CONFIG_GLOBAL=/dev/null` in the controlled base; the controlled-base approach already removes most of this class, so the delta is small.
- **The failure:** dropping `...process.env` starves the child of a var `node`/`git` needs on some platform. **How you'd know:** `worktree-root` child exits non-zero / the existing 8 tests regress locally or in CI. **What it means:** proceed — add the specific missing var (e.g. `SystemRoot` on Windows) to the controlled base; the suite's target is POSIX (per FAFF-580's stated portability floor), so `{HOME, PATH}` is expected to suffice.

## 5. Scenarios

```
Given the full suite is run from a live build worktree under ~/.faff/worktrees/faff/ with sibling worktrees checked out
When test/worktree-root.test.mjs runs
Then the "--assert: root itself NOT strictly under" and "single-source linked-worktree" assertions pass deterministically
```

- The whole file remains a pure test-layer change: `node --test test/worktree-root.test.mjs` passes with no product-code diff.

## 6. Design decision rationale

**How should the default-source tests be isolated from ambient host state?**

- **Option A — `FAFF_WORKTREE_ROOT` override on the flaky tests.** Pro: trivial. Con: flips `source` to `env`, skips the git probe — the tests stop verifying the branch that flakes. Rejected.
- **Option B — deny-list ambient `GIT_*` vars from the existing `...process.env` spread.** Pro: minimal diff. Con: leaves the leak class open to any other ambient var; a deny-list is a moving target.
- **Option C — build the child env from a controlled base (`{HOME, PATH}` + explicit source vars).** Pro: closes the whole ambient-leak class; matches the documented harness convention (`link-skills-worktree.test.mjs`, `lights-out.test.mjs`); keeps the `default` branch (and its probe, now anchored to the fixture repo) under test. Con: must ensure the child still has what `node`/`git` need — covered by forwarding `PATH` and the POSIX floor.

**Chosen:** Option C — a controlled hermetic child env in `baseEnv`, plus a regression guard that injects ambient git-context vars and asserts the probe stays anchored to the fixture repo.

At the time of writing the observed vector is the ambient git-context environment reaching `git rev-parse --git-common-dir` in the child; Option C neutralises that class regardless of the precise variable, and the Failure-modes section names the signal and the small widening (TMPDIR / GIT_CONFIG_GLOBAL) if the vector proves broader.

## 7. Open questions and assumptions

**Open questions.** None blocking. (The "are the other ~2 failures ambient-sensitive?" question from the ticket is resolved as OUT OF SCOPE — bounded to `worktree-root.test.mjs` per the ticket Scope, with a follow-up sweep named as the extension point.)

**Assumptions.**

- **Assumes:** `test/helpers/run-cli.mjs` continues to *replace* (not merge) the child env when `env` is supplied. Validate: confirm `runCli` passes `env: opts.env ?? process.env` to `spawnSync` (it does today) before relying on `baseEnv` being the sole env source.
- **Assumes:** `node` and `git` are resolvable via `process.env.PATH` in the CI/runner environment. Validate: the existing suite already spawns `node`/`git` via `PATH`, so forwarding `PATH` preserves that.

## 8. DONE — Definition of Done

### From WHY
- [ ] `test/worktree-root.test.mjs` passes deterministically when the full suite is run from inside a live build worktree with sibling worktrees present (no dependence on host worktree state).

### From WHAT (env-isolation contract)
- [ ] `baseEnv` no longer spreads `...process.env`; the child env carries only a controlled base (`HOME` sentinel + `PATH`) plus `FAFF_WORKTREE_ROOT` (empty unless `extra` sets it) and any `extra`.
- [ ] No ambient `GIT_*` (or other ambient) variable reaches the spawned resolver in the default-source cases.

### From HOW (behaviour)
- [ ] The existing 8 tests still pass, and the env-source (`FAFF_WORKTREE_ROOT: "/custom/wt"`) and config-source (`.faffrc.yaml` fixture) tests still resolve `source: "env"` / `"config"` respectively.
- [ ] A new regression test injects ambient git-context vars (`GIT_DIR`/`GIT_COMMON_DIR`/`GIT_WORK_TREE`) pointing at an unrelated dir and asserts `source === "default"` and `root === path.join(HOME, ".faff/worktrees", basename(repo))`.

### From HOW (failure modes)
- [ ] The regression guard fails against the pre-fix `baseEnv` (spread present) and passes against the fixed one — proving it actually catches the leak.

**Integration smoke test:**

```
1. node --test test/worktree-root.test.mjs   → all tests pass (existing 8 + regression guard)
2. faff worktree-root --selftest             → exit 0 (resolver unchanged)
```

## Already shipped against this surface

- **FAFF-382** (Done) created `faff worktree-root` and this test file — it is the *origin* of the ambient-leaky `baseEnv`, not a fix for the flake. Premise stands.
- **FAFF-476** (Done) — "assertions on a commit made INSIDE a faff CLI child go false-red (no repo-local git identity)" — a sibling test-hygiene lesson about CLI-child test isolation, but a different symptom (git identity) in different tests. Related context, not superseding.
- No Done ticket delivers ambient-worktree isolation for `test/worktree-root.test.mjs`. → Proceed.
