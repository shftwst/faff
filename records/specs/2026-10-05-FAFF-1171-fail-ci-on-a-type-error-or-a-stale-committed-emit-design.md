# Fail CI on a type error or a stale committed emit (FAFF-1171)

> Spec: faffter-dark-nlspec · 2026-10-05 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1171.

This spec is for the build agent and human reviewers. It specifies a new `typecheck`
CI job that makes the TypeScript foundation's two definition-of-done lanes (the source
type-checks, and the committed `.js` emit is not stale) enforced in CI rather than on
developer machines alone. It builds directly on the FAFF-1170 toolchain already merged
to `main`.

## 1. WHY — Problem and Principles

**The load-bearing model.** Under ADR-0132 layout (d) the repository ships the TypeScript
sources (`bin/lib/producer-auth.ts`, `bin/lib/commissaire.ts`) **and** their compiled
`.js` emit **side by side**, and every install path runs the committed `.js` (extensionless
`require("./commissaire")` resolves `.js`, never `.ts`). That is what keeps adopters on
plain JavaScript and Node 20. Its one cost, stated in the ADR, is that a `.ts` edit left
unrebuilt leaves a **stale committed emit** the whole world then runs. This ticket is the
freshness gate the ADR names as the safety net that makes layout (d) safe.

**Problem statement.** Every CI workflow in the repo pins Node 20, and direct `.ts`
execution needs Node 22.18 or later, so today nothing in CI type-checks the source or
proves the committed emit matches it. A developer who edits a `.ts` and forgets to rebuild
pushes a stale emit, and a type error in a `.ts` source is invisible to CI. This change
adds a second-runner job that type-checks the source, rebuilds the emit, fails if the
committed emit drifted, and runs the test suite on the newer runtime.

**Design principles.**

- **Additive only — the Node 20 lanes stay byte-identical.** The existing `validate`,
  `unit`, `coverage-report`, `validate-macos`, and `env-rootless` jobs must not change.
  The emit is what adopters run, so the Node 20 matrix must keep testing it exactly as
  today; the new job is a pure addition. This is a DONE criterion, not just a preference.
- **The gate lives in CI, not in developer discipline.** A pre-push hook may help locally,
  but the CI check is the authority; the design never relies on a hook having run.
- **Reproducible toolchain or no gate.** The stale-emit check compares a fresh `tsc` emit
  against the committed bytes, so the compiler version must be pinned (it is: `typescript
  ~5.9.0` in `package.json` plus the committed `package-lock.json`) or the gate flaps.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` | GitHub Actions | The workflow this job is added to; holds the Node 20 `validate` + `unit` matrix. |
| `plugin/skills/faff/package.json` | JSON | `build` script (`tsc -p tsconfig.json`); devDeps `typescript ~5.9.0`, `@types/node ^20.19.0`; `"type":"commonjs"`. |
| `plugin/skills/faff/tsconfig.json` | JSON | `module=commonjs`, `moduleDetection=force`, `types=[node]`, `include` = the two `.ts` sources. No `outDir` so emit lands beside source. |
| `plugin/skills/faff/package-lock.json` | JSON | Makes `npm ci` deterministic; `node_modules/` is gitignored in the skill dir. |
| `plugin/skills/faff/bin/lib/{producer-auth,commissaire}.{ts,js}` | TS + emit | The two source/emit pairs the gate governs. |
| `test/check-no-boundary-cast.test.mjs` | node:test | A TS-compiler-API test that **self-skips on Node 20** (typescript not installed there) and runs once typescript is present — the concrete "test against `.ts` source" lane. |
| ADR-0132 | record | Scopes this ticket: `tsc --noEmit` + `npm run build` + `git diff --exit-code` on the emit paths, on a Node 22+ runner. |
| FAFF-987 note (top of `validate.yml`) | comment | Explains why `validate` is the single branch-protection-required check gating the sharded suite. |

**Scope statement.** This sits at the CI freshness boundary of the v5 "Commissaire ships
from type-checked TypeScript source" project, between FAFF-1170 (toolchain + first
conversion, done) and FAFF-1173 (next conversion, blocked on this gate).

## 2. OUT OF SCOPE

- **A `pre-push` hook in `.githooks/` that rebuilds the emit** — the ticket says "consider"
  it, and "the CI check stays the gate either way." It is a local convenience, not the gate,
  and adds developer-machine surface this spec deliberately does not depend on. *Extension
  point:* `.githooks/pre-push` (the repo already sets `core.hooksPath` to `.githooks/` for
  the DCO `prepare-commit-msg` hook), running `npm --prefix plugin/skills/faff run build`
  and refusing the push on a resulting diff.
- **Converting any further `bin/lib` module to TypeScript** — FAFF-1173 converts
  `commissaire` with validated input boundaries; this ticket gates whatever `.ts` tree
  exists, it does not grow it. *Extension point:* add the source to `tsconfig.json` `include`;
  the path-less `git diff` step then covers its emit automatically (see HOW).
- **The `faff doctor` stale-emit check** — FAFF-1172 is the local-doctor twin of this CI
  gate; separate ticket. *Extension point:* `faff doctor`.
- **Sharding or speeding up the new job** — the single-run suite baseline (~517s per the
  FAFF-987 note) fits comfortably inside a job timeout; sharding the source lane is a later
  optimisation, not needed here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Emit | The committed `.js` a `tsc` build produces from a `.ts` source, living beside it under the same basename (layout d). |
| Stale emit | A committed `.js` that does not match what `tsc` produces from the current `.ts` — the drift this gate catches. |
| Source lane | Running checks against the `.ts` sources on a Node 22.18+ runner, versus the Node 20 "emit lane". |
| Freshness gate | The `tsc --noEmit` + `npm run build` + `git diff --exit-code` sequence that fails CI on a type error or stale emit. |

**The new job's shape (GitHub Actions).** One job added to `.github/workflows/validate.yml`,
named `typecheck` (the name becomes the branch-protection required-check context):

```
JOB typecheck:
  runs-on: ubuntu-latest
  timeout-minutes: 20
  steps:
    1. actions/checkout@v4
    2. actions/setup-node@v4 with node-version: 24   # optional: cache npm, keyed on the skill lockfile
    3. (working-directory plugin/skills/faff) npm ci
    4. (working-directory plugin/skills/faff) npx tsc --noEmit -p tsconfig.json   # type error -> fail
    5. (repo root) rm each tsconfig `include` entry's committed .js emit, then
       (working-directory plugin/skills/faff) npm run build                       # POSITIVE proof: emit must reappear
    6. (repo root) git diff --exit-code          # a deleted-not-regenerated OR drifted emit -> fail
    7. (repo root) node --test test/check-no-boundary-cast.test.mjs  # un-skip FLOOR: fail if reported skipped
    8. (repo root) run the full node:test suite on Node 24 against the fresh build (see HOW)
```

**Stale-emit detection (steps 5-6) — remove-then-rebuild, then a path-less
`git diff --exit-code` from the repo root. Positive proof, not a differential-only check.**
**Chosen:** before `npm run build`, **remove** each committed emit (the `.js` for every
`tsconfig.json` `include` entry — derived from `include`, so no hand-kept path list), then
build, then run a **path-less** `git diff --exit-code` from the repo root.

**Rationale.** A differential-only check (`build` then `diff`) passes **vacuously** if the
build stops emitting — a `noEmit:true`, a gitignored `outDir`, or an `include` that no
longer matches the source would make `npm run build` exit 0 writing nothing, leaving the
(stale) committed emit untouched and the diff clean: a false green over a stale emit.
Removing the emit first turns the check into **positive proof**: the build must *regenerate*
each emit or the deletion itself shows in `git diff` (a deleted tracked file is a diff),
failing the job loud. The path-less diff is then exact — `npm ci` writes only the gitignored
`node_modules/`, and `tsc` writes only the `include` set's tracked `.js` — and it
**auto-covers every current and future module** without a lockstep path list. This closes
both the FAFF-1173-onward un-listed-module fail-open and the vacuous-build fail-open, and
honours the principle that the gate lives in CI, not in developer discipline. The considered
alternatives — a hard-coded two-path list (lockstep is discipline, not a gate) and a
build-then-diff with no removal (fails open on a vacuous build) — are both rejected.

## 4. HOW — Behaviour

**Architecture and approach.** The job runs the freshness gate in the build
directory (`plugin/skills/faff/`, where `package.json`/`tsconfig.json` live — not the repo
root), then runs the test suite from the repo root on Node 24. `npm ci` installs the
build-time-only `typescript` + `@types/node` into the gitignored `node_modules/`; they are
fully erased from the emit, so the shipped artifact stays dependency-free.

**Step order is load-bearing.**

```
PROCEDURE typecheck_job:
  1. checkout, setup-node 24, npm ci            # toolchain present and deterministic (lockfile)
  2. tsc --noEmit -p tsconfig.json              # TYPE ERROR -> non-zero exit -> job fails here
  3. rm each include entry's .js emit           # positive-proof setup (see steps 5-6 rationale)
  4. npm run build                              # must REGENERATE every removed emit
  5. (repo root) git diff --exit-code           # deleted-not-regenerated OR drifted -> non-zero -> fail
  6. (repo root) node --test check-no-boundary-cast.test.mjs  # UN-SKIP FLOOR: fail if reported skipped
  7. node --test suite on Node 24               # source-lane coverage + newer-runtime proof
```

`tsc --noEmit` runs **before** the build so a type error fails fast on its own step with a
clear signal, independent of the emit comparison.

**The source lane (steps 7-8) — what "test against source / direct `.ts`" concretely means.**
The committed node:test files import the modules by their `.js` path (e.g.
`commissaire.test.mjs` imports `../plugin/skills/faff/bin/lib/commissaire.js`), and Node 20
**cannot** resolve a `.ts` import (ADR-0132 evidence: `require("./x.ts")` is
`MODULE_NOT_FOUND` on Node 20). Repointing the shared test imports at `.ts` would therefore
break the Node 20 lane — which the ticket's own DONE forbids. So the source lane is realised
two ways, neither of which touches a test import:

1. **TS-compiler-API tests run for real.** `check-no-boundary-cast.test.mjs` (and the
   TS-brand fixtures) drive the TypeScript compiler API directly over the `.ts` sources and
   **self-skip on Node 20** because typescript is not installed there. On this job, `npm ci`
   installs typescript under `plugin/skills/faff/node_modules/`, and that is **exactly where
   the test resolves it**: `resolveTypescript()` uses
   `createRequire(path.join(PLUGIN, "package.json"))` then `require("typescript")`, so the
   require is anchored at `plugin/skills/faff/package.json` — **not** the test file, the
   `scripts/` helper, or the suite's cwd. The resolution base is a fixed property of
   `scripts/check-no-boundary-cast.mjs`, independent of where `node --test` is launched from,
   so running the suite from the repo root does not change it. `npm ci` under
   `plugin/skills/faff` therefore un-skips these tests, giving direct `.ts`-source coverage
   Node 20 never gets. (No `NODE_PATH` tweak or root-level install is needed; the test already
   anchors its own resolver at the plugin dir.)
2. **The suite runs on Node 24 against the freshly-built emit.** After the build and the
   stale-emit proof (steps 5-6), "the emit" and "the source's emit" are the same bytes, and
   the whole suite is additionally proven green on the newer runtime.

**Un-skip floor (step 7) — fail loud if leg 1 silently degrades.** Leg 1's whole value rests
on the compiler-API test *not* skipping. A silent skip would leave the job **green** while
that coverage vanishes — a mass-skip-shaped hole with no signal, the same failure class the
`validate-macos` lane guards with its test-count floors. So a **dedicated step** runs
`node --test test/check-no-boundary-cast.test.mjs` on its own and **fails if the runner
reports it skipped** (assert the TAP summary has `# skipped 0` and a non-zero `# pass`),
turning the un-skip from an asserted property into a fail-loud floor. This is belt-and-braces
with the grounded resolution fact above: even if `resolveTypescript()` is later refactored to
anchor elsewhere, this floor catches the regression as a red job rather than a silent green.

```
PROCEDURE source_lane_suite:                      # the full-suite step, from the repo root
  env DOCKER_HOST = unix:///nonexistent/...        # dead socket: docker-gated tests self-skip (as the Node 20 unit job does)
  node --import ./test/hermetic-env.mjs --test     # PATHLESS discovery (the only cross-version-safe form; FAFF-987 note)
```

The invocation mirrors the `unit` job's step (hermetic-env preload, dead `DOCKER_HOST`,
pathless `--test`) but unsharded and on Node 24; `FAFF_REQUIRE_DOCKER` stays unset so the
real-container tests self-skip here (they stay required on the Node 20 `env-rootless` lane).

**Branch protection.** The ticket requires the job to join the branch-protection required
set next to `validate`. **Chosen:** add `typecheck` as a **distinct required status check**,
honouring the ticket's explicit wording. **Rationale:** the ticket says "add the job to the
branch-protection required set"; a distinct required check is the direct reading and makes
the gate visible on every PR. The considered alternative — route it through `validate` via
`needs: [typecheck]` plus a guard step, so the existing single required check gates it
transitively (the FAFF-987 pattern) — avoids a branch-protection edit but hides a second,
semantically distinct gate behind `validate`'s name and contradicts the ticket's instruction;
rejected. Updating the branch-protection required set is a **repo-settings action the PR
cannot perform itself** (see Assumptions) — the PR delivers the job; an admin adds the
context to the required set.

**Edge cases and error handling.**

- **Clean branch** — `tsc --noEmit` passes, `npm run build` produces no diff, the suite
  passes on Node 24; job green.
- **`npm ci` with no network / lockfile drift** — fails loud on step 3; a setup fault, not
  a false pass. The committed lockfile keeps this deterministic.
- **A new `.ts` module added by a later conversion** — automatically gated: the path-less
  `git diff --exit-code` (step 6) covers every tracked emit, so a new module's drift fails
  the job with no path list to extend. This composes with the FAFF-1170 `regions check`
  emit-coverage leg (which fails on a `.ts` lacking its committed `.js`): `regions check`
  asserts the emit *exists*, this job asserts it is *fresh*.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** `tsc` emit is not byte-stable across environments (newline, comment, or
  compiler-version drift), so a clean PR reddens on step 6. **How you'd know:** a PR that
  touches no `.ts` fails `git diff --exit-code` on the emit paths. **What it means:**
  proceed — the confound is already closed: `tsconfig.json` pins `newLine: lf` and
  `removeComments: false`, typescript is pinned `~5.9.0` with a committed lockfile, and
  ADR-0132's status note records the emit byte-stable across two consecutive builds. If it
  still flaps, the compiler version is the first thing to pin harder.
- **The failure:** a test that passes on Node 20 fails on Node 24 (runtime behaviour drift),
  so the new job reddens for a reason unrelated to this gate. **How you'd know:** the suite
  is green on the Node 20 `unit` matrix but red only on `typecheck`. **What it means:**
  narrow — guard or skip that specific test on the newer lane (the repo already does this,
  e.g. `commissaire-bare-claude` skipped on macOS), rather than weakening the gate. Not
  expected (pathless discovery is cross-version safe per the FAFF-987 note), but named.
- **The failure:** the job is added but silently never required (branch-protection edit not
  applied), so a stale emit still merges. **How you'd know:** a merged PR whose `typecheck`
  run was red, or a required-set listing without `typecheck`. **What it means:** the
  out-of-band admin step (Assumptions) is the completion of this ticket, tracked as a human
  follow-up, not something the PR can self-assert.
- **The failure:** the gate's own mechanism degrades to a vacuous pass — `tsc` stops emitting
  (`noEmit`/`outDir`/`include` drift) so `git diff` is trivially clean, or the compiler-API
  test silently skips so leg 1 contributes nothing — a **false green**. **How you'd know:**
  without the guards, neither shows any signal; *with* them, step 5's remove-then-rebuild
  fails on a non-regenerated emit (the deletion shows in the diff) and step 7's un-skip floor
  fails on a reported skip. **What it means:** proceed — the positive-proof build and the
  un-skip floor convert both vacuous-pass vectors into red jobs.

**Anti-pattern:** repointing the shared node:test imports from `.js` to `.ts` to force a
"direct `.ts`" suite. Why: it breaks the Node 20 lane (`MODULE_NOT_FOUND`), violating the
ticket's "Node 20 lane unchanged" DONE.

**Anti-pattern:** editing any Node 20 job to "harmonise" versions or steps. Why: the emit
lane must keep testing the committed `.js` on Node 20 exactly as adopters run it.

## 5. Scenarios

```
Given a branch that edits plugin/skills/faff/bin/lib/commissaire.ts but leaves the
      committed commissaire.js unrebuilt
When the typecheck job runs
Then npm run build regenerates commissaire.js, the path-less git diff --exit-code reports a
     diff, and the job fails
```

```
Given a branch that introduces a type error in a .ts source under bin/lib
When the typecheck job runs
Then tsc --noEmit exits non-zero and the job fails on the type-check step, before build
```

```
Given a branch with a fresh emit and no type errors
When the typecheck job runs
Then tsc --noEmit passes, npm run build produces no diff on the emit paths, the node:test
     suite passes on Node 24, and the job is green
```

```
Given the Node 24 runner has run npm ci (typescript installed)
When the un-skip floor step runs node --test test/check-no-boundary-cast.test.mjs
Then the test executes against the .ts sources (not skipped), the TAP summary shows
     # skipped 0 with a non-zero # pass, and the step passes
```

```
Given a tsconfig.json edited to noEmit:true (or otherwise producing no emit)
When the job removes each include entry's .js emit and runs npm run build
Then the removed emits are not regenerated, git diff --exit-code reports the deletions, and
     the job fails (no vacuous green over a stale emit)
```

```
Given the un-skip floor step and a change that makes check-no-boundary-cast.test.mjs skip
      (e.g. typescript unresolvable)
When node --test runs that file
Then the TAP summary reports it skipped and the step fails loud, rather than the job going
     green with leg 1 contributing nothing
```

- The existing `validate`, `unit`, `coverage-report`, `validate-macos`, and `env-rootless`
  jobs MUST remain byte-identical: the PR diff to `validate.yml` adds only the `typecheck`
  job and changes no other job's `node-version` or steps.

## 6. Design Decision Rationale

**Which Node version for the source lane — 22 or 24?**
Options: 22 (minimum that runs direct `.ts`, 22.18+) vs 24 (active LTS).
**Chosen:** 24 — the ticket's stated default, the active LTS at time of writing, and the
version ADR-0132's resolution experiment used (24.15). 22.18+ is the floor; 24 clears it
and is the forward-looking pin.

**How is the branch-protection gate enforced — distinct required check or transitive via
`validate`?**
Options: a distinct required `typecheck` context (needs a branch-protection edit) vs
`validate` gaining `needs: [typecheck]` + a guard step (no edit, but hides the gate).
**Chosen:** distinct required check `typecheck` — matches the ticket's explicit instruction
and keeps the two semantically different gates separately visible.

**How is "test against source (direct `.ts`)" achieved without breaking Node 20?**
Options: repoint shared test imports to `.ts` (breaks Node 20) vs run the suite on the
Node 24 runner where `npm ci` un-skips the TS-compiler-API tests and the emit is freshly
rebuilt.
**Chosen:** the latter — the only option consistent with the ticket's "Node 20 lane
unchanged" DONE; `.ts`-source coverage comes from the compiler-API tests plus fresh-build
equivalence, not from rewriting imports.

**Stale-emit detection — explicit emit-path list, or a path-less diff?**
Options: a hard-coded two-path `git diff` list kept in lockstep with `tsconfig.json`
`include` (drift for a future un-listed module goes ungated — a discipline-bound fail-open)
vs a path-less `git diff --exit-code` from the repo root after build.
**Chosen:** the path-less diff plus a remove-then-rebuild positive-proof. The build writes
only the tracked emit (`node_modules` is gitignored), so a path-less diff is exact,
auto-covers every future module, and needs no lockstep discipline; removing the emit first
also closes the vacuous-build (`noEmit`) false-green — directly honouring the "gate in CI,
not discipline" principle.

**Do we keep the test imports on `.js`?**
**Chosen:** yes, unchanged — see the source-lane decision above; this is the mechanical
consequence that preserves the Node 20 lane.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. The ticket's only open question (runner 22 vs 24) is
resolved to 24 above.

**Assumptions.**

- **Assumes:** an operator with repository-admin rights adds the `typecheck` context to the
  branch-protection required set after the PR merges. *Validation:* this is a GitHub
  repo-settings action the PR itself cannot perform; the build agent records it as a human
  follow-up in the PR body and run summary, and a reviewer confirms the required-set entry.
  The PR delivers and wires the job; the required-set addition is the out-of-band completion.
- **Assumes:** `plugin/skills/faff/package-lock.json` is present and current (it is on
  `main`). *Validation:* `npm ci` fails loud if the lockfile is missing or out of sync, so a
  drifted lockfile is caught by the job itself.

## 8. DONE — Definition of Done

### From WHY
- [ ] A deliberately stale committed emit on a test branch fails the `typecheck` job (the stale-emit `git diff --exit-code` step).
- [ ] A type error in a `.ts` source fails the `typecheck` job (the `tsc --noEmit` step).
- [ ] The Node 20 lanes (`validate`, `unit`, `coverage-report`, `validate-macos`, `env-rootless`) are unchanged — the `validate.yml` diff adds only the `typecheck` job.

### From WHAT (job shape)
- [ ] `typecheck` job added to `.github/workflows/validate.yml`, `runs-on: ubuntu-latest`, `node-version: 24`, with a job timeout.
- [ ] npm/tsc steps run with `working-directory: plugin/skills/faff`.
- [ ] Steps run in order: `npm ci` → `tsc --noEmit` → remove-each-emit + `npm run build` → path-less `git diff --exit-code` (repo root) → un-skip floor → the full source-lane suite.
- [ ] Stale-emit detection is a path-less `git diff --exit-code` from the repo root (not a hard-coded list), so drift in any tracked emit — current or future — fails the job.
- [ ] The build is positive-proof: each `tsconfig.json` `include` entry's committed `.js` is removed before `npm run build`, so a vacuous build (e.g. `noEmit`) that regenerates nothing fails the `git diff` (the deletion shows), not a false green.
- [ ] An un-skip floor runs `node --test test/check-no-boundary-cast.test.mjs` as its own step and fails if the runner reports it skipped (`# skipped 0`, non-zero `# pass`), so leg 1 cannot silently contribute nothing.

### From HOW (source lane)
- [ ] The full node:test suite runs on Node 24 with the hermetic-env preload, pathless `--test`, and a dead `DOCKER_HOST` so docker-gated tests self-skip.
- [ ] `check-no-boundary-cast.test.mjs` executes (not skipped) on this job and passes — enforced by the dedicated un-skip floor step, not merely asserted.

### From HOW (branch protection)
- [ ] The PR body and run summary record the out-of-band step: add the `typecheck` context to the branch-protection required set next to `validate`.

**Integration smoke test:**

```
# On a clean PR branch:
1. Open a PR -> the `typecheck` job runs on `pull_request`.
2. tsc --noEmit passes; npm run build leaves no diff; the Node 24 suite passes -> job green.
3. Push a commit that edits a .ts without rebuilding -> `typecheck` goes red on git diff.
4. Revert that commit; rebuild -> `typecheck` goes green again.
```

## Already shipped against this surface

- **FAFF-1170 (#996, merged to `main` 2026-10-05)** — converted `producer-auth` and
  `commissaire` to TypeScript under layout (d), landed `tsconfig.json` / `package.json` /
  `package-lock.json`, the `npm run build` script, the committed `.js` emit, and the
  `regionsEmitCoverage` leg in `faff regions check`. This is the **foundation** FAFF-1171
  gates, not a supersession — the freshness gate itself is not yet in any workflow, so the
  premise holds in full.
- **ADR-0132 (FAFF-1168)** — ratified layout (d) and names this ticket's exact teeth
  (`tsc --noEmit` + `npm run build` + `git diff --exit-code`, Node 22+). Honoured, not
  reopened: the committed-emit approach, CommonJS, verify-the-`.js`-emit, the `@types/node`
  build-time devDep, and the decision to sequence this freshness gate after FAFF-1170 are
  settled inputs, cited here as `**Chosen:**`/`**Assumes:**` rather than re-litigated.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes. One cohesive concern — the CI freshness gate (type-check + stale-emit) as a single new job. `Size: S`, deliverable well inside a 1-3 day unit. The pre-push hook is correctly held out rather than bundled, so the unit stays single-purpose.
- **Workstream fit?** Good. Sits in the outcome-named project "Commissaire ships from type-checked TypeScript source" as the freshness-gate increment ADR-0132 explicitly sequenced after FAFF-1170. No cross-cutting leakage.
- **Deps surfaced?** Yes. `blockedBy` FAFF-1170 (merged — a satisfied edge) and `blocks` FAFF-1173 (the next conversion) are both linked; this gate is the thing FAFF-1173 depends on. No implicit dependency is missing.
- **Risk profile?** Low-to-moderate and already de-risked. The one real risk (is the `tsc` emit byte-stable enough to diff?) was proven on real runtimes in the ADR-0132 experiment and re-confirmed by FAFF-1170; the spec names it as a failure mode with its observable. No de-risking spike warranted.

## Spec-review history

Adversarial spec-review (`faffter-dark-spec-review`, lenses architectural/infosec/QA, backend `z-ai/glm-5.3-flash`) converged over three rounds: round 1 `reject-approach` (architectural major — a wrong claim about where the compiler-API test resolves typescript; infosec minor), round 2 `reject-approach` (two minors — a silent-skip hole and a vacuous-build false-green), round 3 `approve` (all lenses clear). The architectural major was corrected by grounding the resolution base against source; the two minors were closed by the un-skip floor and the remove-then-rebuild positive proof now in the spec.

confidence: high
spec-review: approve
build-tier: complex
