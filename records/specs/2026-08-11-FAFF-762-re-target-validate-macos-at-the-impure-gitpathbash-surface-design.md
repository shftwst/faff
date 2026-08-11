# Spec — FAFF-762: Re-target `validate-macos` at the impure git/path/bash surface

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-762.

*nlspec-format build spec. Audience: the coding agent implementing FAFF-762, plus human reviewers gating the CI change. It supersedes the current `validate-macos` job body in `.github/workflows/validate.yml` (lines 262–298).*

## 1. WHY — Problem and Principles

**Load-bearing model.** A cross-OS CI lane only earns its runtime when it exercises code that can *behave differently on that OS*. macOS diverges from Linux on the **impure surface** — real `git` worktree provisioning, path/filesystem resolution, bundled bash scripts calling POSIX utils (BSD vs GNU), temp-dir semantics, process spawning. Pure `--selftest` cores (enum/string/integer logic over in-memory inputs) are OS-invariant by construction: running them a second time on macOS re-proves nothing. This spec moves the macOS lane off the invariant layer and onto the divergent one.

**Problem statement.** `validate-macos` today re-runs only the pure `--selftest` cores on `macos-latest` — the layer *least* likely to diverge across OS — and skips git worktree provisioning + path resolution + bundled bash, the layer where macOS actually differs. Evidence it is low-value: the region-map selftest drift regressions (FAFF-758, FAFF-752) were caught by the Linux `validate` lane alone; the macOS lane added no unique signal. This change re-targets the job at Docker-free impure exercises that run natively on macOS.

**Design principles.**

**No re-proving the invariant.** Do not duplicate a pure `--selftest` on macOS to pad the job. If an exercise's outcome cannot differ by OS, it belongs on the Linux lane only. The macOS lane's every step must plausibly diverge across OS (real git, real fs, real subprocess, real bash).

**Docker-free by hard constraint.** `macos-latest` hosted runners have no Docker daemon. Every macOS exercise must run with zero container dependency. Docker-gated integration (env/holdout, FAFF-371 rootless) stays on the Linux `env-rootless` lane — untouched by this ticket.

**Fail loud on silent shrinkage.** The lane must not go green having run almost nothing. The current `count < 40` selftest floor is replaced by an analogous floor over the impure exercise set: if the discovered/run exercise count drops below a known threshold, the job errors instead of quietly thinning out.

**Reuse the existing test substrate.** The repo already ships deterministic, Docker-free integration harnesses (`seed-repo.mjs`, `run-cli.mjs`, the `setup-worktree-*` spawn tests). The lane composes these rather than inventing a parallel bespoke shell driver.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` (L262–298) | YAML/bash | The `validate-macos` job body this spec rewrites |
| `plugin/skills/faff-graft/setup-worktree.sh` | bash | Flagship impure surface: `git worktree add` + config-copy over POSIX utils |
| `plugin/skills/faff-graft/remote-diff-base.sh` | bash | Base-ref resolver with the one solved macOS accommodation (`timeout`→`gtimeout`) |
| `plugin/skills/faff/bin/lib/state.js` | JS | `faff state` — impure, **no `--selftest` branch at all** |
| `plugin/skills/faff/bin/lib/worktree-prune.js` | JS | `faff worktree-prune` — **no real-git/real-fs coverage anywhere in repo** |
| `plugin/skills/faff/bin/lib/lights-out.js` (L136) | JS | `faff worktree-root --assert` real findRoot/loadConfig path |
| `plugin/skills/faff/bin/lib/config.js` | JS | `faff config spec-docs-path --create` impure mkdir path |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js` (L180) | JS | Real `--selftest` precedent; non-selftest real invocation is added surface |
| `test/helpers/seed-repo.mjs` | JS | `seedRepo(spec)` — real git repo + determinism env; template + extension point |
| `test/helpers/run-cli.mjs` | JS | `runCli(args,{cwd,env})` — real-entrypoint CLI seam |
| `test/setup-worktree-{direct,base,clobber,config}.test.mjs` | JS | Existing bash-spawn tests; `-direct` enumerates the 17-binary checklist |

**Scope statement.** This is a CI-hardening change confined to the `validate-macos` job and the test files it drives; it does not alter product code, the Linux lanes, or branch-protection policy.

## 2. OUT OF SCOPE

- **Making `validate-macos` a required status check on main.** Why excluded: that is a branch-protection governance decision, made once the lane demonstrably tests something macOS-specific worth gating on. Extension point: repository Settings → branch protection rules for `main` (see Open Questions).
- **The full `node --test` suite on macOS.** Why excluded: Docker-dependent tests self-skip without `FAFF_REQUIRE_DOCKER` but the *full* run is broad and slow, and its docker-gated members prove nothing on macOS. Extension point: this ticket runs a **targeted, floored subset** (§3 manifest), not the whole suite; a future ticket could widen the glob.
- **A dedicated shellcheck / BSD-vs-GNU portability lint.** Why excluded: grounded evidence shows no live BSD-vs-GNU flag mismatch in faff's own scripts beyond the already-solved `timeout`→`gtimeout` fallback; `setup-worktree.sh` uses only portable POSIX utils and contains no `realpath`/`readlink -f`/`stat`. A real-exercise lane catches actual divergence better than a static lint on a surface with no known defect. Extension point: a follow-up ticket may add `shellcheck` as a separate lint job if a concrete portability defect surfaces (see Design Decision Rationale).
- **`faff next` on the macOS lane.** Why excluded: `nextStep()` is fully pure (no fs/git/subprocess) and already covered by its own `--selftest`; it cannot diverge by OS. Extension point: n/a — it is deliberately absent; only its impure sibling `faff state` is included.
- **Inventing a `realpath` / case-insensitive-FS acceptance criterion.** Why excluded: no `realpath`/`readlink -f`/`stat` call exists in this surface; asserting on absent behaviour is ungrounded. Extension point: add only if a future path-resolution feature introduces such a call.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Pure selftest | A `--selftest` invocation over in-memory synthetic inputs; OS-invariant. |
| Impure surface | Code touching real `git`, filesystem, subprocess, or bundled bash — the OS-divergent layer. |
| Impure macOS lane | The rewritten `validate-macos` job body: a floored set of Docker-free impure exercises. |
| Manifest | The discoverable set of impure test files the lane runs (a filesystem glob), analogous to today's grep-derived selftest list. |
| Sanity floor | A minimum count that fails the job loud when the exercise/manifest set shrinks below it. |
| Dangling admin dir | A `.git/worktrees/<id>/` entry whose checkout directory has been removed — `worktree-prune`'s target state. |

**Manifest and floors (the lane's contract shape).**

```
RECORD ImpureMacosLane:
  manifest_glob: string          # e.g. "test/impure/*.test.mjs" — the discoverable exercise set
  file_floor: integer            # min matched files; fail loud below (mirrors the count<40 guard)
  test_floor: integer            # min `# tests N` reported by `node --test`; catches mass self-skip
  docker: FORBIDDEN              # FAFF_REQUIRE_DOCKER MUST be unset on this lane
  CONSTRAINT file_floor <= (count of impure test files at authoring time)
  CONSTRAINT test_floor  <= (count of `# tests` the manifest reports at authoring time)
```

**Impure exercise set (what the manifest must cover).** Each row is a native-macOS, Docker-free exercise; the flagship first.

| # | Exercise | Surface it proves | Coverage delta |
|---|---|---|---|
| 1 | Run real `setup-worktree.sh <name> <repo-root>` (direct mode, `SKIP_NPM_PACKAGES_INSTALL=1`, `CLAUDE_PLUGIN_ROOT`, `FAFF_WORKTREE_ROOT`) against a scratch repo → assert worktree dir lands, branch created, gitignored config (`.faffrc.local.yaml`) copied | bash + `git worktree add` + config-copy over POSIX utils | Flagship; strongest divergence-per-second |
| 2 | Real `git worktree add` lifecycle then `faff worktree-root --assert <path>` | real findRoot / mainWorktreeRoot / loadConfig (its selftest is synthetic) | Closes the real-path gap |
| 3 | Seed a **dangling admin dir** then `faff worktree-prune --own <path>` (also assert `--dry-run`/`--json`) → only the dangling own admin dir removed | git-porcelain parse + selective `rmSync` | **Net-new coverage anywhere in repo** |
| 4 | `faff state <issue> --json` against a seeded tree (spec + branch + worktree + run) → assert spec/git/parked fields populated | readdir/stat/readFile + two real `git` spawns | **Net-new** — no `--selftest` branch exists |
| 5 | `faff config spec-docs-path --create` against seeded repo → assert dir created + path reported | `loadConfig` + `existsSync` + `mkdirSync` | Impure fs surface |
| 6 | `faff gitignore-ensure --root <fixture>` (non-selftest) → assert idempotent append to real `.gitignore` | append-only fs edit against a real file | Added surface beyond the existing selftest |
| 7 | External-binary resolution checklist: assert each of the 17 utils `setup-worktree.sh` direct-mode touches resolves on the runner (`bash git node env sh basename dirname tr date mkdir cp cat grep rm head find sed uname`) | PATH / util availability on macOS | Cheap high-value guard |

Exercises 1, 2, 5, 6 largely exist in `setup-worktree-*.test.mjs`, `worktree-root.test.mjs`, and the CLI tests; 3 and 4 are **net-new** and require a seed extension (§4).

**Seed extension interface (for exercise 3).**

```
FUNCTION seedRepo(spec):
  # existing: spec.commits / branches / specs / runs / worktree
  # NEW: spec.danglingWorktree?: { name: string }
  #   -> `git worktree add` a real linked worktree, then remove its checkout dir
  #      (rmSync recursive) leaving `.git/worktrees/<id>/` dangling, returning its admin path
  RETURNS { root, worktreePath, danglingAdminPath?, teardown }
  CONSTRAINT danglingAdminPath points under root/.git/worktrees/ and its gitdir target no longer exists
```

## 4. HOW — Behavior

**Architecture and approach.** Replace the `validate-macos` selftest step with a step that runs the impure manifest via `node --test`, with `FAFF_REQUIRE_DOCKER` unset so docker-gated tests self-skip and the impure Docker-free tests run natively. The manifest is a dedicated glob (proposal: relocate/author the impure integration tests under `test/impure/` — a rename is transparent to the Linux `node --test` run, which globs all tests regardless). Two floors guard against silent shrinkage.

```
PROCEDURE validate_macos_job:
  1. checkout + setup-node 20   (unchanged)
  2. matched = files matching <manifest_glob>
  3. IF count(matched) < file_floor:
       echo "::error::impure manifest shrank to <count> (expected >= <file_floor>) — glob likely broke"
       exit 1
  4. Run `node --test <matched...>` with FAFF_REQUIRE_DOCKER UNSET, capture output
  5. Parse `# tests N` from the TAP summary
  6. IF N < test_floor:
       echo "::error::only <N> impure tests ran (expected >= <test_floor>) — tests likely mass-skipped"
       exit 1
  7. Exit nonzero if `node --test` reported any failure   (its own exit code)
```

**Behaviour summary — flagship exercise (1).** Provision a throwaway git repo, run the bundled provisioner exactly as `faff-graft` calls it, and assert the worktree materialised with config copied — proving bash + git + POSIX-util provisioning works on macOS.

```
PROCEDURE exercise_setup_worktree:
  1. seedRepo({ gitignored: [".faffrc.local.yaml"] })  -> root
  2. spawn bash setup-worktree.sh "feature/x" root
       env: SKIP_NPM_PACKAGES_INSTALL=1, CLAUDE_PLUGIN_ROOT=<plugin>, FAFF_WORKTREE_ROOT=<tmp>
  3. Assert exit 0 AND stdout is the printed worktree path
  4. Assert <worktree_path> exists AND `git -C root branch --list feature-x` non-empty
  5. Assert <worktree_path>/.faffrc.local.yaml exists (untracked config copied)
  6. teardown (rmSync recursive)
```

**Behaviour summary — net-new prune exercise (3).** Create a genuinely dangling worktree admin dir, prune only own dangling entries, and assert no repo-wide prune ran.

```
PROCEDURE exercise_worktree_prune:
  1. { root, danglingAdminPath } = seedRepo({ danglingWorktree: { name: "gone" } })
  2. runCli(["worktree-prune", "--own", <ownPath>, "--json"], { cwd: root })
  3. Assert exit 0 AND danglingAdminPath no longer exists
  4. Assert a still-live worktree's admin dir is untouched (selective removal, not `git worktree prune`)
```

**Edge cases and error handling.**

- **`jq` absence on the runner.** Direct-mode `setup-worktree.sh <name> <root>` never reads stdin and never invokes `jq` (§ script L16–19); the flagship exercise MUST use direct mode so the lane does not depend on `jq` being installed. Do not exercise hook mode on this lane.
- **No `origin` remote on the scratch repo.** `setup-worktree.sh` branches off local `HEAD` when no `origin` exists (L74–77); the seed repo has no remote, so `BASE_REF=HEAD` — assert against that, do not require a fetched remote base.
- **Determinism env.** Reuse `seed-repo.mjs`'s `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null` + pinned author/committer env so exercises are byte-stable on the runner's ambient git config.
- **`faff state <issue>` missing positional.** `<issue>` is required (exit 2 if absent); the exercise MUST pass a real issue id present in the seed.

**Failure modes.**

- **The failure:** the impure lane runs but every test self-skips (e.g. a helper mis-detects the runner and bails), so the job goes green having asserted nothing — the exact "silent shrinkage" the old `count < 40` guard existed to prevent.
  - **How you'd know:** the `# tests N` count parsed in step 5 falls below `test_floor`; the file glob may still match, so the file floor alone would not catch it.
  - **What it means:** proceed only with **both** floors wired; the test-count floor is the load-bearing one for mass-skip.
- **The failure:** the macOS lane still exercises no genuinely OS-divergent code — the exercises pass identically to Linux and add no unique signal (the very defect this ticket cites for the old lane).
  - **How you'd know:** over time, no macOS-only red ever appears while Linux stays green (same pattern as FAFF-758/FAFF-752). A synthetic check: temporarily break a POSIX-util assumption (e.g. a GNU-only flag) and confirm the macOS lane, not Linux, goes red.
  - **What it means:** if the lane never diverges, revisit whether even the impure surface justifies a second OS — a valid negative outcome to name, feeding the required-check Punt.
- **The failure:** `node --test` on macOS pulls in a Docker-requiring test that hard-fails instead of self-skipping.
  - **How you'd know:** the lane errors with a docker/daemon-connection message rather than a skip.
  - **What it means:** the manifest glob is over-broad — narrow it to the impure-only directory; do not set `FAFF_REQUIRE_DOCKER`.

**Anti-pattern:** Padding the manifest with pure `--selftest` files to clear the floor. Why: it re-proves OS-invariant logic and reintroduces the exact low-value coverage this ticket removes.

**Anti-pattern:** Running the whole `test/` tree on macOS to hit the floor. Why: out of scope; it drags in slow docker-gated members and dilutes the divergence signal.

## 5. Scenarios

```
Given a scratch git repo with an untracked .faffrc.local.yaml and no origin remote
When the impure macOS lane runs setup-worktree.sh in direct mode with SKIP_NPM_PACKAGES_INSTALL=1
Then a worktree directory is created, its branch exists, .faffrc.local.yaml is copied in, and the printed stdout path resolves
```

```
Given a seeded repo containing a dangling .git/worktrees/<id> admin dir and one live worktree
When `faff worktree-prune --own <path>` runs
Then only the dangling own admin dir is removed and the live worktree's admin dir is untouched
```

```
Given a seeded tree with a spec doc, a matching feature branch, and a run under .faff/runs for issue FAFF-XXX
When `faff state FAFF-XXX --json` runs on macOS
Then the JSON reports the resolved spec, the git branch/worktree, and the parked/ledger fields populated from the real tree
```

- The `validate-macos` job MUST run with `FAFF_REQUIRE_DOCKER` unset and MUST NOT invoke any Docker command.
- The lane MUST fail loud (nonzero exit, `::error::`) when the matched manifest file count drops below `file_floor` OR the reported `# tests` count drops below `test_floor`.
- The 17 external binaries `setup-worktree.sh` direct-mode touches MUST each resolve on the runner.

## 6. Design Decision Rationale

**Replace vs augment the pure selftest run?**
- *Augment* (keep pure selftests + add impure): pros — no coverage removed; cons — re-proves OS-invariant logic, keeps the low-value layer the ticket indicts, pads runtime.
- *Replace* (impure only; pure stays on Linux): pros — every macOS second buys divergence coverage; the pure suites remain fully covered by the Linux `validate` lane; cons — loses the (redundant) macOS pure run.
- **Chosen:** Replace. The pure `--selftest` cores are OS-invariant and already green on Linux; the ticket explicitly says do not duplicate them on macOS to fill the job.

**Bespoke shell driver vs reuse `node --test` + existing helpers?**
- *Shell driver*: pros — no test-file coupling; cons — reinvents the determinism env, git seeding, and CLI seam the repo already ships; more bash to maintain on the very surface we distrust.
- *`node --test` subset*: pros — reuses `seed-repo.mjs` determinism, `run-cli.mjs`, and the `setup-worktree-*` spawn tests; docker tests self-skip without `FAFF_REQUIRE_DOCKER`; cons — must scope the glob to avoid the full suite.
- **Chosen:** `node --test` over a scoped impure manifest. It reuses proven substrate and keeps the lane close to how developers already write these tests.

**Which impure exercises (the ticket's central open question)?**
- Candidates weighed by divergence-per-second and coverage delta (§3 table). `setup-worktree.sh` + a real worktree lifecycle is the strongest per the ticket's own steer; `worktree-prune` and `faff state` are net-new coverage anywhere in the repo; `config spec-docs-path --create` and `gitignore-ensure` add cheap real-fs surface; the 17-binary checklist is near-free.
- **Chosen:** The seven-exercise set in §3, flagship = `setup-worktree.sh` lifecycle. `faff next` is excluded as fully pure.

**Sanity-floor mechanism?**
- *File-count only*: catches a broken glob but not mass self-skip. *Test-count only*: catches mass-skip but not a glob that matches zero files cleanly.
- **Chosen:** Both floors — `file_floor` (mirrors the existing `count < 40` guard) plus `test_floor` from the `# tests N` summary.

**Dedicated shellcheck / BSD-vs-GNU portability lint?**
- Grounded evidence: no live BSD-vs-GNU mismatch in faff's own scripts beyond the solved `timeout`→`gtimeout` fallback; no `realpath`/`readlink -f`/`stat` in the surface. A real-exercise lane on macOS catches actual divergence; a static lint on a defect-free surface is speculative maintenance.
- **Chosen:** Out of scope for this ticket (not punted — the evidence closes it). A follow-up may add `shellcheck` if a concrete portability defect ever surfaces. *At the time of writing, the only macOS accommodation the scripts have ever needed is the `timeout`/`gtimeout` fallback.*

**Should `validate-macos` become a required check on main?**
- **Punt:** Required-check status is a branch-protection governance decision, appropriate only once the lane demonstrably gates on something macOS-specific worth blocking merges over. Deferred to a human. *(decides: maintainer)*

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** Should `validate-macos` become a required status check on `main` once re-targeted? Needs a human branch-protection policy call — weigh hosted-macOS-runner flakiness/cost against the value of gating merges on impure-surface coverage. Not blocking for this ticket, which only re-targets what the lane runs. *(decides: maintainer)*

**Assumptions.**

- **Assumes:** `macos-latest` GitHub-hosted runners provide `git` and (via `setup-node@v4`) Node 20, and the 17 POSIX utils in exercise 7 are on PATH. Validation: exercise 7 is itself the check — it fails loud if any is missing.
- **Assumes:** Docker-gated `node --test` cases self-skip when `FAFF_REQUIRE_DOCKER` is unset (they do not hard-require a daemon). Validation: before finalising, run the chosen manifest locally with `FAFF_REQUIRE_DOCKER` unset and confirm no docker-connection error; if any test hard-fails, it does not belong under the impure glob.
- **Assumes:** relocating impure test files under the `test/impure/` glob does not perturb the Linux `node --test` run (which globs all `test/**`). Validation: confirm the Linux `validate` job still discovers and runs the relocated files after the move.

## 8. DONE — Definition of Done

### From WHY
- [ ] `validate-macos` no longer runs any pure `--selftest` command (the grep+`count < 40` block at L277–298 is removed).
- [ ] Every step the lane runs touches real git, real fs, real subprocess, or bundled bash (no OS-invariant step remains).

### From WHAT (manifest + floors)
- [ ] The lane discovers its exercises via a dedicated manifest glob (e.g. `test/impure/*.test.mjs`), not a hand-maintained list embedded in the job.
- [ ] A `file_floor` guard fails the job loud (`::error::`, exit 1) when matched files drop below the authoring-time count.
- [ ] A `test_floor` guard fails the job loud when the `# tests N` summary drops below the authoring-time count.
- [ ] `seedRepo` supports a `danglingWorktree` spec producing a real dangling `.git/worktrees/<id>` admin dir and returning its path.

### From HOW (behaviour — exercises)
- [ ] Exercise 1: real `setup-worktree.sh` direct-mode run lands a worktree, creates the branch, copies untracked `.faffrc.local.yaml`, and prints the worktree path to stdout.
- [ ] Exercise 2: `faff worktree-root --assert <path>` returns exit 0 for a path under the resolved root and exit 1 otherwise, over a real `git worktree`.
- [ ] Exercise 3: `faff worktree-prune --own <path>` removes only the dangling own admin dir and leaves a live worktree's admin dir intact.
- [ ] Exercise 4: `faff state <issue> --json` over a seeded tree reports populated spec/git/parked fields; a missing positional exits 2.
- [ ] Exercise 5: `faff config spec-docs-path --create` creates the docs dir and reports its path.
- [ ] Exercise 6: `faff gitignore-ensure --root <fixture>` idempotently appends to a real `.gitignore`.
- [ ] Exercise 7: all 17 named external binaries resolve on the runner, else the job errors.

### From HOW (edge cases)
- [ ] The flagship exercise uses direct mode and does not depend on `jq`.
- [ ] The seed repo has no `origin`, and the exercise asserts against a `HEAD` base ref.
- [ ] The lane runs with `FAFF_REQUIRE_DOCKER` unset and issues no Docker command.

### From scope
- [ ] Docker/env/holdout integration remains only on the Linux `env-rootless` lane (unchanged).
- [ ] `faff next` (pure) is not added to the macOS lane.
- [ ] No shellcheck/portability-lint job is added under this ticket.
- [ ] No `realpath`/case-insensitive-FS acceptance criterion is invented.

**Integration smoke test (happy-path plumbing).**

```
PROCEDURE macos_lane_smoke:
  1. On macos-latest: checkout + setup-node 20
  2. matched = glob(test/impure/*.test.mjs); assert count >= file_floor
  3. node --test matched   # FAFF_REQUIRE_DOCKER unset
  4. Assert exit 0, `# tests N` >= test_floor, `# fail 0`
  # If this is green, the impure macOS plumbing is connected.
```

## Already shipped against this surface

Related Done work reviewed for premise-supersession — **none supersedes this ticket** (premise still load-bearing; these are reader context so the implementer reuses rather than rebuilds):

- **FAFF-580** (Done 2026-07-24) — created the current pure-`--selftest` `validate-macos` smoke lane. This ticket *re-targets* exactly that lane; FAFF-580 is the origin, not a duplicate.
- **FAFF-595 / FAFF-532 / FAFF-186** (Done) — established `setup-worktree.sh` invoked from the skill step and fixed its config-copy semantics (`.faffrc.yaml` tracked-vs-overlay handling). Grounds exercise 1's config-copy assertions.
- **FAFF-633** (Done) — a prior macOS-divergence bug (`integrity-digest` hardcoded `/usr/bin/sha256sum`), evidence that real macOS-divergence defects do occur and a macOS impure lane has signal to catch.
- **FAFF-442 / FAFF-382** (Done) — worktree-registry / lights-out worktree-root behaviour that exercises 2–3 lean on.

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Right-sized?** The ticket is one CI-hardening deliverable, but it carries a genuinely separable shared-infra prerequisite: extending `test/helpers/seed-repo.mjs` with a `danglingWorktree` spec (NET-NEW), which gates exercise 3 (`worktree-prune --own`). That fixture edit is reusable harness work that stands apart from the workflow retarget itself — it isn't a `validate.yml` change, and other impure tests may come to lean on the same seed spec. Bundled, it blurs progress: the retarget can't be reviewed or land cleanly until the seed work is done, and a two-week-looking "In Progress" hides which half is stuck. What to do: if the `danglingWorktree` extension is genuinely an hour of work, keep it inline but sequence it first; if it grows on contact, split it into its own prerequisite ticket so the retarget sequences behind a landed fixture. Otherwise the 7-exercise set converges on a single outcome (validate-macos exercises the impure, OS-divergent surface) and is right-sized at its upper bound.

**Workstream fit?** No issues. A standalone CI hardening chore with no currently-actionable outcome project to name correctly lands project-less in Backlog — this is the default-landing case, not a workstream gap. Leaving it loose is the right call, not a smell.

**Deps surfaced?** No cross-ticket blocker links are missing — the spec is self-contained, and the one Punt (should validate-macos become a required check on `main`) is correctly scoped out as a human branch-protection call, not a hidden prerequisite. The only real dependency is internal: the `danglingWorktree` seed extension must ship before exercise 3 can exercise `worktree-prune --own`. Because it lives inside the ticket, no tracker link is owed — but if the seed extension is split out per the right-sizing note, that ordering becomes a real `blockedBy` edge (retarget blockedBy seed-fixture) and should be declared so sequencing stays honest.

**Risk profile?** The ticket is itself a de-risking move (CI now covers the impure surface), but the unknowns cluster in two places worth pulling forward. First, the two Assumes are the load-bearing risk: docker-gated tests self-skipping when `FAFF_REQUIRE_DOCKER` is unset, and macos-latest actually providing all 17 external utils. If the util assumption is wrong, exercise 7 discovers it late on a runner you don't control, and if self-skip misfires the job can go green-while-empty. The `test_floor` (parsed `# tests N`) is the right guard against mass self-skip — good, that de-risks the first Assume in-band. Second, the two NET-NEW pieces (the `danglingWorktree` seed spec and `faff state --json` over a seeded tree) have no existing `--selftest` to mirror, so they carry the most novelty. What to do: verify the macos-latest 17-util assumption cheaply and up front (a one-line probe or a quick check of the runner image manifest) before committing to the full 7-exercise scope, and build the net-new seed fixture first so its unknowns surface early rather than landing bundled at the end — the fail-loud `file_floor` + `test_floor` pair is the sanity backstop, keep both non-negotiable.

---

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ] }
```
