# FAFF-441 — Split `bin/faff` into modules behind a thin entrypoint (pure refactor, byte-identical)

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-441.

This spec is the build plan for FAFF-441: decompose the 16,659-line `plugin/skills/faff/bin/faff` into CommonJS modules behind a thin dispatch entrypoint, with zero observable behaviour change, gated by the FAFF-440/442 byte-identical parity harness. Audience: the build agent executing the split, and the human second-opinion reviewer of the split PR.

## 1. WHY — Problem and Principles

**The load-bearing model:** the adversarial-review context rule (the FAFF-183 rule: review context = the gateway `SKILL.md` plus every touched file) makes review cost proportional to *file* size, not *diff* size. Splitting the CLI into modules therefore restores reviewability by construction — a one-module diff ships that module (~1–3k lines) instead of the whole 16,659-line file — and nothing about the review rule itself changes. The refactor's correctness is proven mechanically, not by inspection: the shipped parity harness (`scripts/verify-split-parity.mjs`, FAFF-440/442) compares every matrix subcommand's stdout/stderr/exit byte-for-byte against the merge-base baseline under both install shapes.

**Problem statement:** any diff touching `bin/faff` ships all 16,659 lines (~261k tokens) as review context, which exceeds every phase-2 reviewer window in the adversarial-review fallback chain — the L4 second-opinion gate is structurally unavailable for exactly the file carrying most of faff's deterministic machinery, and the file is unnavigable for humans. This change splits the file into modules resolved relative to the entrypoint, behaviour byte-identical.

**Design principles:**

**Byte-identical is the gate, not a goal.** Every design choice below is subordinate to `node scripts/verify-split-parity.mjs --baseline-ref <merge-base>` printing `RESULT: PASS`. Where a cleaner structure would change any observable output, the structure loses.

**Pure move, no tidying.** Code moves verbatim: no renames, no dead-code deletion, no style normalisation, no comment rewording beyond the specific stale-claim sweeps named in this spec. The pure-move diff character is half the justification for the one-time review exemption; a "small cleanup" invalidates it. Any behaviour defect discovered mid-split is carved into a follow-up ticket, never fixed in this PR.

**No guard goes vacuous.** The `regions` direction lint currently reads its own single file; a split that leaves it scanning only the thin entrypoint would make it pass while enforcing nothing — a silent guard-off. The lint must keep enforcing the same invariant over the new module set within this PR.

**Dependency-free stays dependency-free.** `node:` builtins only, no npm deps, no bundler, no build step, no `package.json`. The single shebang entrypoint is preserved at its current path.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/faff` | The file being split — 16,659 lines, 53 subcommands, machine-tagged with ADR 0042 region banners |
| `scripts/verify-split-parity.mjs` | The byte-identity gate (FAFF-440/442) — subcommand matrix × both install shapes, coverage self-check fails closed |
| `docs/adr/0042-three-tier-region-model…` | The region model (shared-infra / governance / factory / shell) whose banners pre-tag the split; predicts the lint retires post-modularisation |
| `eval/run-evals.mjs` (`classifyDiffSurface`, line 391) | Diff-surface classifier whose CLI clause matches only `/\/bin\/faff$/` — must learn the module directory |
| `test/corrective-integrity.test.mjs` | Imports `bin/faff` as CJS-default from ESM and destructures three exported names |
| `test/eval-gate.test.mjs`, `test/holdout-evaluate-integration.test.mjs` | The other two path-referencing tests — must stay green untouched or minimally repointed |
| `.github/workflows/validate.yml` (lines ~173–179) | CI gates: `regions --selftest`, `regions check`, `regions selftest --region governance`, plus per-subcommand selftest steps |
| `docs/guide/cli.md:3`, `plugin/skills/faff/SKILL.md:96` | Prose carrying the stale "single dependency-free Node script" claim post-split |

**Scope statement:** this is an internal restructuring of the bundled CLI's source layout; every consumer — skills prose, hooks, CI, tests, both install shapes — continues to invoke `plugin/skills/faff/bin/faff` exactly as today.

## 2. OUT OF SCOPE

- **Any behaviour change or subcommand surface add/remove** — why: the parity gate and the review exemption both rest on "nothing observable changed"; extension point: follow-up tickets, one per discovered defect or wanted change.
- **Retiring the `regions` text lint in favour of require-graph enforcement** — why: removing a subcommand is a surface change, and replacing the lint core changes `regions --selftest` output (a parity-matrix row); extension point: a follow-up ticket (filed as part of this PR's DONE) covering lint retirement, `validate.yml` step updates, parity-matrix row updates, `docs/guide/cli.md` regions row, and the ADR 0042 status flip.
- **Renaming or moving the entrypoint** — why: ticket-excluded; every install shape, hook, and test references `bin/faff`; extension point: none anticipated.
- **npm deps / bundler / build step** — why: ticket-excluded; the dependency-free property is a governing principle; extension point: none.
- **Review-context excerpting (per-file caps)** — explicitly REJECTED in the ticket, not deferred. Do not reopen.
- **Physical package extraction of the governance layer** (ADR 0042's eventual end-state) — why: this split is its precursor, not its delivery; extension point: the governance modules under `bin/lib/` become the extraction unit.

## 3. WHAT — Vocabulary, Layout, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Region | ADR 0042 tier: `shared-infra`, `governance`, `factory`, or `shell`; encoded today as banner tags `// === region:<name> — <desc> ===` |
| Banner span | The code between one region banner and the next — 44 spans exist today |
| Entrypoint | `plugin/skills/faff/bin/faff` — shebang, mode 755, extensionless CommonJS |
| Module | A `.js` CommonJS file under `plugin/skills/faff/bin/lib/`, `require()`d (directly or transitively) by the entrypoint |
| Install shapes | Symlink (`~/.local/bin/faff` → repo file; skill dirs symlinked whole) and copy (whole `plugin/` subtree copied under `CLAUDE_PLUGIN_ROOT`) |
| Parity gate | `scripts/verify-split-parity.mjs --baseline-ref <merge-base>` → `RESULT: PASS` |
| Direction invariant | shared-infra references no region's identifiers; governance references shared-infra only; factory references both; shell references everything |

**Target layout:**

```
plugin/skills/faff/bin/
  faff              # thin entrypoint: shebang, requires, COMMANDS, USAGE, main(), export tail
  lib/
    shared-infra.js # findRoot, run-ledger helpers, latestRunDir, YAML subset, HERE, ENTRYPOINT
    runcheck.js     # governance modules: one per banner span …
    heartbeat.js
    budget.js
    …
    config.js       # factory modules: one per banner span / subcommand cluster …
    contracts.js
    lights-out.js
    regions.js
    …
```

**Module boundary rules** (the layered shared-lib + surfaces shape — see decision rationale):

- Default: **one module per banner span**, named for the span's subject in kebab-case, opening with its region banner verbatim as the first line(s) of the file.
- Adjacent spans serving the same subcommand merge into one module (e.g. `economics` + `economics breakdown`; `contract definitions + dispatch` with the governance `contract validation engine` kept separate — it is a different region).
- Handlers physically mislocated in today's banner spans move to homes matching their content: `cmdAdmissible`, `cmdDod`, `cmdHoldout`, `cmdHoldoutVerdict`, `cmdSpecReviewLenses` (lines 14041–14560) sit inside the `lint-cli-doc` span and must be traced out into their own module(s). The builder traces actual `function cmd*` bodies plus supporting helpers — 53 handler functions — never banner ranges alone. Similarly, `review-progress` / `build-progress` handlers live inside other governance spans; their module home follows the code, and one module may export several handlers.
- Hard cap: **no module exceeds ~3,000 lines** (largest natural cluster today is 1,265 lines — comfortable margin).
- **Shared helpers get exactly one home.** A helper referenced from multiple spans is exported from its defining module and imported everywhere else — never copy-pasted. Region-crossing shared helpers follow the direction invariant (a helper used by governance and factory belongs in shared-infra or governance, never factory).

**The entrypoint** keeps the whole dispatch shell and nothing else:

```
#!/usr/bin/env node
<header comment, swept for stale single-file phrasing>
one require per lib module (eager, at top)

const COMMANDS = { "config": cmdConfig, … }   # all 53 keys, verbatim order
const USAGE = `…`                              # moved verbatim

function main(argv) { … }                      # verbatim, incl. -h/--help/help handling

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { correctiveIntegrityProbe, integrityGate, correctiveIntegrityDirs };
```

That is ~730 lines / ~45KB (USAGE alone is 42KB of long usage-text lines) — thin relative to the file, well inside every reviewer window even stacked with the gateway `SKILL.md` (~186KB) and the largest module.

**Install-shape-sensitive sites and their disposition:**

| Site (today) | Count | Disposition |
|---|---|---|
| `const HERE = __dirname` (line 35), used as `path.resolve(HERE, "..", "..", …)` | 5 uses | `shared-infra.js` exports `HERE = path.resolve(__dirname, "..")` — identical value (`…/bin`) from one level deeper; all consumers import it. One home for path anchoring. |
| `spawnSync(process.execPath, [__filename, …])` self-respawns (lines 10672, 11967) | 2 | Replace `__filename` with `ENTRYPOINT` exported from `shared-infra.js` as `path.resolve(__dirname, "..", "faff")` — stable under both install shapes (Node resolves the entrypoint symlink to its realpath before module resolution, so `lib/` and the entrypoint always co-locate). |
| `fs.readFileSync(__filename)` in the regions subsystem (lines 15981, 15998→spawn, 16025) | 3 | Repointed per the regions decision below: source scans read the entrypoint + every `lib/*.js`; the member spawn uses `ENTRYPOINT`. |
| `fs.realpathSync(process.argv[1])` / bare `process.argv[1]` (lines 4807, 9160, 14912) | 3 | Unchanged — `argv[1]` is the true running entrypoint regardless of module layout. |
| Shebang + mode 755 | 1 | Entrypoint keeps both; lib modules need neither. The parity harness already asserts the exec bit. |

**Export tail:** the entrypoint re-exports `correctiveIntegrityProbe`, `integrityGate`, `correctiveIntegrityDirs` (required in from the corrective-integrity module) so `test/corrective-integrity.test.mjs`'s ESM default-import destructure is untouched.

**Eval-gate classifier:** `classifyDiffSurface` in `eval/run-evals.mjs` classifies a diff touching only new `bin/lib/*.js` files as `prose` today (the CLI clause matches only `/\/bin\/faff$/`, and `.js` doesn't match `\.mjs$`). Extend the CLI clause so any file under `plugin/skills/faff/bin/` classifies `substantive`, and add a matching case to `test/eval-gate.test.mjs`. This is the one deliberate out-of-`bin/faff` code change in the PR; it keeps an existing gate correct rather than changing CLI behaviour.

## 4. HOW — Behaviour

**Approach overview:** materialise the module skeleton, move spans verbatim, wire destructured requires, centralise the path anchors, repoint the regions subsystem's three self-source inputs, then prove byte-identity against the merge-base. All modules load eagerly at entrypoint start, so the post-split process state at `main()` matches today's whole-file-parsed state, and any wiring fault (missing export, cycle, typo) faults every subcommand loudly — which the parity matrix catches on its first row.

**Pre-flight — duplicate-name census.** Same-region duplicate top-level names are legal today (the lint only rejects cross-region duplicates), and in a single file a later `function f()` re-declaration silently shadows an earlier one for *all* callers. Splitting such a pair into two modules would re-bind the earlier span's calls to its own local version — a behaviour change parity might only catch if the matrix exercises that path. Before moving anything:

```
PROCEDURE duplicate_name_census:
  1. Collect column-0 top-level names (function/const/let/var) per banner span
  2. IF any name is defined in more than one span:
     a. Determine which definition wins today (last in file order for functions)
     b. Ensure every referencing module imports exactly that winner
     c. Record the case in the PR body (it is evidence for the reviewer, not a fix)
  3. IF the two definitions differ and both have live callers → STOP: that is a
     latent defect; carve a follow-up ticket, do not resolve it in this PR
```

**Require wiring — destructured, eager, acyclic.**

- Every cross-module import is destructured: `const { findRoot, HERE } = require("./shared-infra");`. Never namespace-style (`const si = require(…); si.findRoot()`) — the repointed direction lint skips dotted access (property-access-skip soundness), so namespace imports would blind the boundary guard.
  **Anti-pattern:** namespace-object requires for sibling modules. Why: dotted references are invisible to the direction lint — the guard goes blind while appearing green.
- Requires sit at the top of each module, *after* its region banner, so the require lines fall inside the tagged span and the destructured identifiers stay visible to the lint.
- The require graph must be acyclic. The direction invariant makes cross-region cycles impossible if honoured; cross-module cycles *within* factory are the real hazard. Where two factory modules would mutually reference, either merge them (respecting the 3,000-line cap) or hoist the shared helper to its single home.
  **Anti-pattern:** lazy per-command `require()` inside `main()` to dodge a cycle. Why: it hides load faults until that command runs and diverges from today's everything-parsed-up-front semantics; cycles are resolved structurally, not deferred.

**The regions subsystem — keep the surface, repoint the inputs.** The subcommand, its lint core (`regionsCheckFile`, the source stripper, the fixture selftest), `REGION_MAP`, and `REGION_SELFTEST_ARGV` all survive byte-for-byte in a `regions.js` module. Three inputs change:

```
PROCEDURE regions_repoint:
  region_sources = [ENTRYPOINT] + sorted(lib/*.js)

  regions check:
    1. Parse banner spans PER FILE (each module opens with its banner; the thin
       entrypoint carries the shell banner)
    2. Collect top-level definitions across ALL files (union)
    3. Run the existing direction scan per span against the union's forbidden sets
       — a governance module destructure-requiring a factory name is caught at the
       require line and at every call site, same invariant as today
    4. Cross-region duplicate detection runs over the union (same rule, now spanning files)
    5. PASS output line and exit codes unchanged

  regions selftest (member runner):
    1. Stale-null scan reads region_sources instead of __filename
       (regionsFnRange runs per file; handler function names survive export —
        COMMANDS[c].name still resolves)
    2. Member spawn uses ENTRYPOINT instead of __filename
    3. Per-member table output unchanged

  regions --selftest (fixture selftest):
    unchanged — it writes synthetic fixtures to tmp and never read __filename;
    its REGION_MAP ↔ COMMANDS bijection and allowlist checks keep working via
    the injected COMMANDS (below)
```

`cmdRegions` needs `COMMANDS` (bijection check, stale-null function names), but `COMMANDS` lives in the entrypoint and the entrypoint requires `regions.js` — a direct back-require would be a cycle. Invert the dependency: the entrypoint registry binds it at dispatch (`"regions": (args) => cmdRegions(args, COMMANDS)` or an equivalent late-bound injection). No observable change.

**Behaviour summary of the whole change:** after the split, running any `faff <subcommand>` parses the entrypoint, eagerly loads every module, and dispatches through the same `COMMANDS` map to the same handler bodies — every byte written to stdout/stderr and every exit code is identical to today, under both install shapes, which is exactly what the parity gate asserts.

**Edge cases and error handling:**

- **Help paths:** `-h` / `--help` / `help` / no-arg / unknown-subcommand output comes verbatim from the entrypoint's `USAGE` + `main()` — byte-identical by construction.
- **ESM import of the entrypoint:** `require.main === module` is false, no subcommand runs, the default export carries the three corrective-integrity names — unchanged.
- **Symlinked invocation:** Node resolves `~/.local/bin/faff` to its realpath before setting the entrypoint's module paths, so sibling `require("./lib/…")` resolves inside the real (or copied) tree under both install shapes; no `--preserve-symlinks` caveats apply because faff never sets that flag.
- **Parity exclusions:** `sync`, `gitignore-ensure` (mutate the install) and `gates` (live `duration_ms`) stay excluded; the harness's coverage self-check (exit 2 on any subcommand in neither MATRIX nor EXCLUSIONS) needs no change because the subcommand list is unchanged.

**Failure modes — how this approach falls over, and how you'd notice:**

- **Parity-matrix blind spots.** The matrix exercises selftests and pure commands; live verbs (docker-backed `env up/seed`, excluded `sync`/`gates`) aren't byte-compared. The load-fault class is closed by eager requires (any wiring fault fails *every* matrix row), so the residual exposure is logic that only runs under live side effects. How you'd know: `node --test` integration suites (docker-gated tests run for real in CI) and the CI per-subcommand selftest steps. What it means: acceptable residual — named here so the reviewer weighs it, not discovers it.
- **Same-name shadowing flips a binding.** Covered by the pre-flight census; if the census is skipped and parity still passes, the defect surfaces only on the unexercised path. How you'd know: the census grep is a DONE item with its result recorded in the PR body. What it means: a non-empty census with divergent bodies stops the PR (follow-up ticket), it does not get resolved inline.
- **The reviewer-window premise doesn't hold.** If the gateway `SKILL.md` plus a max-size module still exceeds the smallest phase-2 window, the split's headline benefit is missing even though everything is green. How you'd know: the representative one-module-diff measurement in DONE comes back over budget. What it means: narrow — shrink the module cap and re-slice; never abandon the split (navigability alone justifies it) and never reopen excerpting.
- **The repointed regions lint is quietly weaker.** Union-scan mistakes (per-file line arithmetic, preamble exemption drift) could make the lint pass on a real violation. How you'd know: the injected-violation scenario below — a synthetic governance→factory reference in a scratch copy must exit 1 naming both ends. What it means: the lint repoint is not done until that scenario passes.

**Anti-pattern:** "tidying while moving" — renames, dead-code removal, comment improvements beyond the named sweeps. Why: it breaks the pure-move diff character underwriting the one-time review exemption; parity can pass while review integrity is lost.

**Docs sweep (same PR):** `docs/guide/cli.md:3` and `plugin/skills/faff/SKILL.md:96` lose the "a single dependency-free Node script" phrasing in favour of accurate wording (dependency-free Node CLI: one entrypoint plus modules under `bin/lib/`, still no npm/install/build); `plugin/skills/faff/SKILL.md:110` "one Node entrypoint for all bundled helpers" stays true and stays put. The entrypoint's own header comment (lines 26–28, "Just a Node file") gets the same accuracy sweep — comments are not behaviour. Historical `docs/specs/*` and ADR 0042 are append-only provenance: untouched; ADR 0042's status handling rides the regions-retirement follow-up ticket.

**Review path for this PR (one-time):** the split PR touches the whole file, so it cannot pass phase-2 adversarial review under the unmodified context rule. Substitute: human second-opinion review, recorded in the PR body as an explicit exemption justified by (a) the mechanical byte-identical gate, (b) the pure-move diff character evidenced by the census + move log, (c) full suite green. This exemption is for this PR only and sets no precedent.

## 5. Scenarios

```
Given the split branch and its merge-base with main
When  node scripts/verify-split-parity.mjs --baseline-ref <merge-base> runs from any checkout (including a linked worktree)
Then  it exits 0 printing RESULT: PASS, covering the full matrix under both install shapes
```

```
Given a diff touching exactly one module under bin/lib/ (plus, at most, the entrypoint registry)
When  the review context is assembled under the unmodified FAFF-183 rule (gateway SKILL.md + every touched file)
Then  the measured context (bytes/4 token estimate) is below the smallest configured phase-2 reviewer window in the adversarial fallback chain
```

```
Given a scratch copy of the split tree with one synthetic governance→factory reference injected into a governance module
When  faff regions check runs against that copy
Then  it exits 1 with a VIOLATION line naming both the referencing and defining ends — proving the repointed lint is not vacuous
```

```
Given an ESM test importing the entrypoint as a CJS default export
When  it destructures correctiveIntegrityProbe, integrityGate, correctiveIntegrityDirs
Then  all three are functions and test/corrective-integrity.test.mjs passes untouched
```

Non-functional assertions:

- No `__filename` self-respawn remains anywhere under `bin/` (grep returns zero); both respawn sites use `ENTRYPOINT`, which resolves to an existing mode-755 file under both install trees.
- Every module ≤ ~3,000 lines; the entrypoint contains no business logic (dispatch shell only).
- `faff --help` output is byte-identical to the merge-base.

## 6. Design Decision Rationale

**Which module boundary shape — per-subcommand surfaces or layered shared-lib + surfaces?** Per-subcommand (53 modules keyed to the registry) is mechanical but scatters the shared helpers and cuts across the ADR 0042 region tiers; layered span-aligned modules reuse a boundary the codebase already machine-enforces, keep each region's future extraction unit intact, and land every module at 83–1,265 lines. **Chosen:** layered, banner-span-aligned modules (corrected for the mislocated handlers), with `shared-infra.js` as the one dependency-root.

**Where does the dispatch shell live — in the entrypoint or a `shell.js` module?** A `shell.js` module makes the entrypoint ~15 lines but creates a shell↔regions require cycle (`COMMANDS` needs `cmdRegions`; `cmdRegions` needs `COMMANDS`) or forces exporting `COMMANDS` from the entrypoint. Keeping USAGE + `COMMANDS` + `main()` in the entrypoint holds the whole dispatch surface in one visible place at ~730 lines — thin in every sense that matters (every line is dispatch plumbing; ~12k tokens stacks comfortably with the gateway inside all reviewer windows). **Chosen:** the entrypoint keeps the full dispatch shell; `cmdRegions` receives `COMMANDS` by injection at dispatch.

**Module format — `.js` CommonJS, `.mjs` ESM, or extensionless?** No `package.json` exists anywhere in the repo, so `.js` defaults to CommonJS — plain synchronous `require()` from the extensionless CJS entrypoint, on any Node version, preserving the `module.exports` tail with zero interop risk. `.mjs` would force `require(esm)` semantics (Node-version-sensitive) for no benefit; extensionless modules fight tooling. **Chosen:** `.js` CommonJS modules, eagerly required.

**Path anchoring — flat siblings in `bin/`, or a `lib/` subdirectory with centralised anchors?** Flat siblings keep `__dirname` depth identical (zero path edits) but dump ~40 files next to the executable; a `lib/` subdirectory keeps `bin/` clean and forces the healthier structure the ticket asks for anyway — exactly one home for root-resolution. The risk is one line: `shared-infra.js` computing `HERE = path.resolve(__dirname, "..")`, verified by the parity gate. **Chosen:** modules under `bin/lib/`; `shared-infra.js` exports `HERE` and `ENTRYPOINT`; every path-anchor consumer imports them.

**The regions subsystem — retire, repoint, or leave reading only the entrypoint?** Retiring removes a subcommand (surface change, out of scope) and breaks the two parity-matrix regions rows; leaving it pointed at the thin entrypoint makes CI's direction gate pass vacuously (a silent guard-off); repointing keeps the surface and the selftest output byte-identical while the invariant keeps being enforced across the module set — and destructured requires keep cross-file references visible to the existing scanner unmodified. **Chosen:** repoint (union source scan + `ENTRYPOINT` spawn), keep the lint core byte-for-byte, and file a follow-up ticket for the ADR-0042-predicted retirement in favour of require-graph enforcement (that ticket also owns the ADR status flip and the matrix/CI/doc row updates).

**Self-respawn sites — `ENTRYPOINT` constant or `process.argv[1]`?** `argv[1]` equals the entrypoint during CLI runs but equals the test runner when the file is imported; a static `ENTRYPOINT` derived from `shared-infra.js`'s own location is correct in every execution mode and under both install shapes. **Chosen:** `ENTRYPOINT` from `shared-infra.js` at both respawn sites and the regions member spawn.

**Export tail — re-export from the entrypoint or repoint the test?** The ticket allows minimally repointing `test/corrective-integrity.test.mjs`, but a three-name re-export in the entrypoint costs one line and keeps the test as an untouched consumer proving the public import surface didn't move. **Chosen:** entrypoint re-exports the three names; the test stays untouched.

**Eval-gate classifier — extend the regex, name modules `.mjs`, or accept the misclassification?** Naming modules `.mjs` just to match the existing `\.mjs$` clause would force ESM (rejected above); accepting means future module-only diffs get soft-gated as `prose` — a quiet gate weakening. Extending the CLI clause to cover the CLI's directory is a one-line change plus a test case, outside `bin/faff` but squarely "keep an existing gate correct". **Chosen:** extend `classifyDiffSurface` to classify any file under `plugin/skills/faff/bin/` as `substantive`, with a new case in `test/eval-gate.test.mjs`.

**Docs and ADR 0042 — sweep now or defer?** The two "single script" prose claims go stale the moment the PR merges (docs never go stale — same-PR rule); ADR 0042's Status field, by contrast, is provenance whose honest flip point is when the lint actually retires. **Chosen:** sweep `docs/guide/cli.md` + gateway `SKILL.md` + the entrypoint header comment in this PR; ADR 0042 status rides the regions-retirement follow-up.

**Review path for this PR — force the normal gate, or documented human exemption?** The normal phase-2 gate is structurally impossible for a whole-file diff (that impossibility is the ticket's WHY); the ticket prescribes the substitute. **Chosen:** human second-opinion review recorded in the PR body as an explicit one-time exemption, justified by the parity gate + pure-move character + green suite.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** the FAFF-440/442 parity harness exists, is merged, and is green against an unsplit tree. Validation: before moving any code, run `node scripts/verify-split-parity.mjs --baseline-ref $(git merge-base HEAD main)` on the fresh branch and confirm `RESULT: PASS` (a red harness pre-split means the gate, not the split, needs fixing first).
- **Assumes:** every phase-2 reviewer window in the configured adversarial fallback chain accommodates the gateway `SKILL.md` (~186KB ≈ ~47k tokens) plus one max-size module (~3k lines ≈ ~15k tokens) plus the entrypoint (~12k tokens). Validation: resolve the configured chain via `faff config get` (never retype backend strings), take the smallest backend's context window, and compare against the measured representative context from the Scenarios section before declaring DONE.

## 8. DONE — Definition of Done

### From WHY (review economics restored)
- [ ] A representative one-module diff's review context (gateway `SKILL.md` + touched files, unmodified FAFF-183 rule) is measured (bytes/4 token estimate) and is below the smallest configured phase-2 reviewer window; the measurement is recorded in the PR body.

### From WHAT (layout and interfaces)
- [ ] `bin/faff` contains only: shebang, header comment, eager requires, `COMMANDS` (53 keys, unchanged), `USAGE` (moved verbatim), `main()`, the `require.main` gate, and the three-name export tail — no business logic.
- [ ] All other code lives in `bin/lib/*.js` CommonJS modules; no module exceeds ~3,000 lines; the mislocated handlers (`cmdAdmissible`, `cmdDod`, `cmdHoldout`, `cmdHoldoutVerdict`, `cmdSpecReviewLenses`) sit in content-matching modules, not a `lint-cli-doc` module.
- [ ] Shared helpers each have exactly one defining module; a duplicate-body grep across `bin/` finds no copy-pasted top-level function.
- [ ] `shared-infra.js` exports `HERE` (value identical to today's) and `ENTRYPOINT`; all five former `path.resolve(HERE, …)` consumers import `HERE`; grep finds no `__filename` under `bin/` used for respawn or self-read outside the repointed regions module.
- [ ] `module.exports` on the entrypoint carries exactly `{ correctiveIntegrityProbe, integrityGate, correctiveIntegrityDirs }`; `test/corrective-integrity.test.mjs` passes untouched.
- [ ] `classifyDiffSurface` classifies any file under `plugin/skills/faff/bin/` as `substantive`; the new case in `test/eval-gate.test.mjs` passes; the pre-existing entrypoint assertion passes unchanged.

### From HOW (behaviour and guards)
- [ ] The duplicate-name census ran before the move; its result (empty, or resolved-winner evidence) is recorded in the PR body; no divergent-duplicate defect was fixed inline.
- [ ] All cross-module imports are destructured (no namespace-object sibling requires — grep-checkable); all requires are top-of-module after the region banner; the require graph is acyclic.
- [ ] `faff regions check`, `faff regions --selftest`, and `faff regions selftest --region governance` are green over the split tree with byte-identical output; the injected-violation scenario (synthetic governance→factory reference in a scratch copy) exits 1 naming both ends.
- [ ] `node scripts/verify-split-parity.mjs --baseline-ref <merge-base>` exits 0 with `RESULT: PASS`.
- [ ] Full `node --test` green; every per-subcommand `--selftest` CI step green; CI green on the PR HEAD sha.
- [ ] Both install shapes verified by the harness's `installTrees` coverage (symlink + copy); the three path-referencing tests (`test/eval-gate.test.mjs`, `test/holdout-evaluate-integration.test.mjs`, `test/corrective-integrity.test.mjs`) are green, untouched except the named eval-gate addition.

### From docs and process
- [ ] `docs/guide/cli.md:3`, `plugin/skills/faff/SKILL.md:96`, and the entrypoint header comment no longer claim a single-file layout; `SKILL.md:110`'s "one Node entrypoint" is retained; historical specs and ADR 0042 body untouched.
- [ ] A follow-up ticket exists for regions-lint retirement (require-graph enforcement, `validate.yml` steps, parity-matrix rows, `docs/guide/cli.md` regions row, ADR 0042 status flip).
- [ ] The PR body records the one-time human second-opinion review exemption with its three-part justification; any behaviour defect found mid-split is ticketed, not fixed in this PR.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. From a linked worktree on the split branch:
     node scripts/verify-split-parity.mjs --baseline-ref $(git merge-base HEAD main)
     → expect exit 0, "RESULT: PASS"
  2. node plugin/skills/faff/bin/faff --help          → byte-identical to merge-base
  3. node plugin/skills/faff/bin/faff regions check   → "PASS  regions check: …", exit 0
  4. node --test                                      → green
If step 1 alone passes, the plumbing is connected; steps 2–4 are belt-and-braces.
```

confidence: high
spec-review: approve
