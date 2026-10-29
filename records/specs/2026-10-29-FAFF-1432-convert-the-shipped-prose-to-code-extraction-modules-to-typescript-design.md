_Agent-written (Claude Code), at the operator's request. Revised 2026-10-29 after spec-review rounds 1–5; supersedes comment 61b18be3._

# FAFF-1432: Convert the shipped prose-to-code extraction modules to TypeScript

> Spec: faffter-dark-nlspec · 2026-10-29 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1432.

## 1. WHY

ADDENDUM-1 decision 1 (b), taken 2026-10-03, made TypeScript the authoritative source language for new V5 modules. ADR-0132 fixed how that ships: layout (d), with the `.ts` source, a committed `tsc` emit beside it under the `.js` name, and unchanged extensionless importers. The prose-to-code extractions that shipped before the rule reached contributors (AGENTS.md, PR #1162) were written as plain JavaScript. They are the coordinator's typed ports-to-be. Converting them now, while they are small and their behaviour is fresh, costs less than converting them after more code depends on them.

### Design principles

- **Behaviour-preserving only.** The conversion adds types. It changes no exported name, no output, no exit code and no file the command writes.
- **Two different diffs, two different jobs.** The one-time *equivalence check* (4.2) compares the new emit with main's hand-written `.js` once, in the PR, and its accepted differences are committed. It never runs as a standing CI step. The ongoing *stale-emit check* is CI's existing remove, rebuild, `git diff --exit-code` over the committed emit. It compares the emit with itself rebuilt, never with the old hand-written file, so a later compiler or config change regenerates the emit rather than failing on it.
- **Equivalence rests on three legs, not one:**
  - an executable equivalence check (4.2) shows that every changed statement is either toolchain preamble or a committed, justified allow entry;
  - a committed strict-mode audit clears the one run-time semantic the preamble adds;
  - the existing tests and both selftests exercise the result.
- **Follow the existing converted modules.** `decision-policy.ts` and `commissaire.ts` are the pattern: `import type` for types, `const x = require("./x")` for values, and the module keeps its `module.exports = { … }` object.

### Reference context

| Path | Role |
|---|---|
| `plugin/skills/faff/bin/lib/land.js` | FAFF-1396, `faff land` (313 lines, region factory, has a `--selftest` block) |
| `plugin/skills/faff/bin/lib/spec-commit.js` | FAFF-1404, `faff spec commit` / `spec verify` (392 lines, region factory, has a `--selftest` block, already `"use strict"`) |
| `plugin/skills/faff/bin/lib/gates-progress.js` | FAFF-1405, the progress file and fingerprints behind `gates run --budget-secs/--resume` (289 lines, new in FAFF-1405, no selftest) |
| `plugin/skills/faff/tsconfig.json` | explicit `include` list; strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `erasableSyntaxOnly` |
| `plugin/skills/faff/build-manifest.json`, `scripts/build-manifest.js` | sha256 of every `.ts` input and `.js` output; rewritten by `npm run build` |
| `.github/workflows/validate.yml` `typecheck` job | type-check, remove-then-rebuild, path-less `git diff --exit-code` stale-emit check |
| `plugin/skills/faff/bin/lib/regions.js` | `REGION_MAP`; `land`, `spec` and `gates` are all `factory` |
| `scripts/check-no-boundary-cast.mjs`, `test/check-no-boundary-cast.test.mjs` | FAFF-1170's boundary-contract lint. It walks every `.ts` in `tsconfig` `include` and refuses `as`, `<T>x`, `!` and `satisfies`, an `any` return from a named boundary reader, and an untyped `require` of `./producer-auth`, `./ids` or `./result`. Its test self-skips without the `typescript` package, and the `typecheck` job runs it under an un-skip floor. |
| `test/land.test.mjs`, `test/spec-commit.test.mjs`, `test/gates-progress.test.mjs`, `test/gates-budget.test.mjs` | the direct tests; each `require`s the `.js` path explicitly |

No skill prose changes in this ticket, so it needs no rule inventory.

### Already shipped against this surface

- FAFF-1170, FAFF-1171, FAFF-1172 (Done): the toolchain, the CI stale-emit check and the `faff doctor` stale-emit report. Used unchanged.
- FAFF-1180 and the Commissaire conversions (Done): the module pattern this follows.
- None of them converts these modules, so the premise holds.

## 2. OUT OF SCOPE

- `prep-attach.js` and `judge-dispositions.js`. PR #1156 converts them before it merges.
- `landing-comment.js`. It is FAFF-860's module, not an extraction; FAFF-1396 did not touch it.
- FAFF-1405's edits to pre-existing modules (`gates-cli.js`, `gates-select.js`, `gates-exec.js`, `gates-config.js`, `gates.js`, `config-core.js`). Those were small edits to existing JavaScript, which stays JavaScript.
- Moving the `land` and `spec` `--selftest` cases into `test/`. That is FAFF-1419.
- Any behaviour change, including FAFF-1429's warnings pass-through in `spec-commit`.
- Typing the JavaScript modules these three import.

## 3. WHAT

| Before | After |
|---|---|
| `bin/lib/land.js` (hand-written) | `bin/lib/land.ts` (source) + `bin/lib/land.js` (committed emit) |
| `bin/lib/spec-commit.js` (hand-written) | `bin/lib/spec-commit.ts` + emit |
| `bin/lib/gates-progress.js` (hand-written) | `bin/lib/gates-progress.ts` + emit |
| `tsconfig.json` `include`: 12 entries | 15 entries (the three `.ts` files added) |
| `build-manifest.json` | regenerated by `npm run build` |
| — | `plugin/skills/faff/scripts/ts-equivalence.js` (new build-tooling script) |
| — | `test/ts-equivalence.test.mjs` with fixtures under `testdata/typescript/equivalence/`, and `test/ts-conversion-exports.test.mjs` |
| — | `verification/ts-conversion/FAFF-1432/equivalence-allow.json` and `strict-mode-audit.json` (committed evidence) |
| `test/check-no-boundary-cast.test.mjs` pinned source list | the three new `.ts` files appended |
| `typecheck` job un-skip floor: one test file | two (`ts-equivalence.test.mjs` added) |

Importers do not change: `bin/faff` keeps `require("./lib/land")` and `require("./lib/spec-commit")`, `gates-cli.js` and `gates-select.js` keep `require("./gates-progress")`, and the tests keep requiring the `.js` path.

## 4. HOW

### 4.1 Module shape

**Chosen:** follow `decision-policy.ts`. Values from JavaScript modules are bound with `const { … } = require("./x")`; types from TypeScript modules come in with `import type`; the file ends with the same `module.exports = { … }` it has today, with the same keys in the same order. Rationale: it is the shape ADR-0132's layout was proved on, and it keeps the export object byte-identical in the emit.

**Chosen:** the module header comment (`// === region:factory — … ===`) stays as the first comment in the `.ts`. `removeComments: false` carries it into the emit, where the region lint and readers find it.

**Chosen:** type the module's own data and exports: option objects, return shapes, the progress-file record, the land state and decision tokens, and the spec-commit record. No explicit `any` annotation appears in the three `.ts` files. Values returned by untyped JavaScript dependencies stay as `require` returns them, matching the precedent. Rationale: typing the dependencies is a separate conversion; the gain here is typed ports on these modules.

**Chosen:** the three files pass `scripts/check-no-boundary-cast.mjs` with no change to its allow-list, so no `as`, `<T>x`, `!` or `satisfies` appears in them. None of the three requires `./producer-auth`, `./ids` or `./result` today, and none defines a function with a boundary-reader name. Rationale: the lint is FAFF-1170's control over every included `.ts`, and widening its allow-list would weaken it.

**Chosen:** read untyped JSON the way PR #1156's conversion does. Property reads on a parsed value whose type is `unknown` go through a module-local helper, `function get(v: unknown, k: string): unknown { return Reflect.get(Object(v), k); }`. Values are then narrowed with `typeof` and `Array.isArray` checks the existing code already performs. Where the current code already validates a parsed shape (for example `validProgress` in `gates-progress`), that function gains a type-predicate return (`x is ProgressFile`), which is type-only. No new validation is added. Each helper is module-local, matching #1156, because a shared helper module is a separate decision. Rationale: the lint forbids casts, so this is the cast-free route #1156 proved. Its one semantic difference, covered in 4.2, is that `Object(null)` makes a read on `null` or `undefined` return `undefined` instead of throwing.

**Chosen:** keep each `--selftest` block (`landSelftest`, `specSelftest`) and its cases, typed in place but otherwise unchanged. Rationale: this ticket changes no behaviour, and migrating selftests is FAFF-1419's scope. It adds no selftest and no case.

**Chosen:** `GatesProgressError` stays a `class … extends Error`, and its fields are typed with `declare reason: …;` and `declare detail: …;`. Constructor parameter properties are refused by `erasableSyntaxOnly`. A plain field declaration is refused by this spec: under `target: es2022`, `tsc` emits it as a class field (`reason;`), which defines the property before the constructor body runs. A probe at prep confirmed this. A `declare` field emits nothing, so the emit carries no class-field noise.

### 4.2 Equivalence: what may differ, and how it is checked

**Chosen:** check equivalence mechanically, with a committed script and a committed record of every accepted difference. A difference that is justified only in a PR description can't be checked from the tree.

**The script.** `plugin/skills/faff/scripts/ts-equivalence.js` takes a base git ref, an allow file and a list of emit paths. For each path it:
1. reads the base bytes with `git show <ref>:<path>` and the emit from disk;
2. parses both with the TypeScript compiler API, using the build-time `typescript` devDependency;
3. prints both with one `ts.createPrinter({ removeComments: true })`, so formatting and comments drop out;
4. drops a leading `"use strict";` directive from **both** sides, since `spec-commit.js` already has one on main, and drops the emit's `Object.defineProperty(exports, "__esModule", …)` statement;
5. diffs the printed statements, and matches each differing hunk against the allow file's entries for that path. An entry is `{ path, kind, before, after, reason }`:
   - `before` and `after` are the printed statement text. `before` is `""` for an inserted statement, and `after` is `""` for a removed one.
   - `kind` is one of `reflect-get-helper`, `reflect-get-read` or `undefined-guard`.
   - `reason` is non-empty.
   - The script refuses an entry whose `kind` is outside that set, or whose `before` and `after` are both empty.

It exits:
- **0** when every differing hunk matches an allow entry, and every allow entry matches a hunk, so a stale entry can't hide anything;
- **1** with a unified diff of each unmatched hunk, or with the list of unused allow entries;
- **2** on a usage error, an unreadable base or emit, a malformed allow file, or a missing `typescript` package.

**The committed evidence** for this conversion lives in `verification/ts-conversion/FAFF-1432/`:
- `equivalence-allow.json`: one entry per accepted difference, of exactly three kinds:
  - **`reflect-get-helper`:** the insertion of the module-local `get` helper from 4.1, at most one per module, with `before: ""`.
  - **`reflect-get-read`:** a property read rewritten to `get(…)`. Each `reason` says why the receiver can't be `null` or `undefined` there, or that the original read was already guarded.
  - **`undefined-guard`:** a guard added for `noUncheckedIndexedAccess` (see 4.4). It may be two hunks, the bound local and the guard, each its own entry. Each `reason` says why the value is present, and which original statement would already have thrown.
- `strict-mode-audit.json`: one row per strict-mode change for `land` and `gates-progress`, each with a `status` (`refused-by-tsc`, `absent` or `present-safe`) and a non-empty `evidence` string.

| Strict-mode change | Expected clearing |
|---|---|
| assignment to an undeclared variable throws | `refused-by-tsc` |
| duplicate parameter names, octal literals, `with` | `refused-by-tsc` |
| `this` is `undefined` in a plain function call | `present-safe`: on main, the only `this` is in the `GatesProgressError` constructor, called with `new` |
| `arguments` stops aliasing parameters; `arguments.callee` throws | `absent` (none on main) |
| writing a read-only property or a non-writable global throws | `absent` or `present-safe`, by grep |
| `delete` of an unqualified name is a syntax error | `refused-by-tsc` |
| `eval` gets its own scope | `absent` (none on main) |

**Chosen:** accept strict mode for `land` and `gates-progress` (`spec-commit` already has it), cleared by this audit. Rationale: strict mode is what the toolchain emits, and its run-time effects are a closed list that can be checked item by item.

The script runs in the PR as `node scripts/ts-equivalence.js --base origin/main --allow ../../../verification/ts-conversion/FAFF-1432/equivalence-allow.json bin/lib/land.js bin/lib/spec-commit.js bin/lib/gates-progress.js`, from `plugin/skills/faff`. It isn't a standing CI step, because the base files stop existing once this merges. The committed allow file and audit are the lasting record. The test suite and the stale-emit check are the standing protection. The script lives in `scripts/` beside `build-manifest.js`; that is build tooling, not a `bin/lib` module, so it is JavaScript. Later conversions reuse it with their own evidence directory.

### 4.3 Build

`cd plugin/skills/faff && npm install && npm run build`, then commit the three `.ts`, the three regenerated `.js`, `tsconfig.json` and `build-manifest.json`. The development floor is Node 22.18; adopters still run the emit on Node 20.

**Chosen:** one PR with one commit per module, plus a final commit for `tsconfig.json`, `build-manifest.json`, the script, its tests and the evidence directory if the build can't be split per module. Rationale: the three conversions are independent and mechanical, about 1,000 lines in total, and each one is checked as its own emit. Three tickets would triple the PR overhead for no extra review signal.

**Chosen:** no hard ordering against FAFF-1429, which changes `spec-commit.js`, or against PR #1156, which adds two `.ts` files. Whichever lands second rebases.
- If FAFF-1429 lands first, its change is carried into `spec-commit.ts`.
- If this lands first, FAFF-1429 edits the `.ts` and rebuilds.
- `test/check-no-boundary-cast.test.mjs` pins the exact ordered list of `tsconfig` `include` sources, 12 on main today. This PR appends its three, and whichever of this PR and #1156 lands second rebases that list.

### 4.4 Edge cases

- **A test that imports the module by path** keeps working, because the emit stays at the `.js` path.
- **`regions check`** treats a `.ts` and `.js` pair as one module (FAFF-1169) and fails a `.ts` with no committed `.js`. It must still pass.
- **`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are type-only.** They change nothing at run time. The risk is the code edited to satisfy them:
  - **an optional key** is typed `?: T | undefined`, never fixed by dropping an assignment;
  - **an index read** that `tsc` reports as possibly `undefined` is fixed type-only where the current code allows: a declared `T | undefined` local that existing code already checks, or a loop or destructure the current code already uses.
- **When an index read can't be fixed type-only:**
  - The boundary-cast lint forbids `!`, so the fix is a guard that throws on `undefined`. It may bind the read to a local first: `const row = rows[i]; if (row === undefined) throw new Error("…");`. The local then replaces the read at its uses.
  - It goes immediately before a use that would already throw a `TypeError` on `undefined`, so the only observable change is the error's message and type, on a path that can't occur.
  - Every hunk it creates is an entry in `equivalence-allow.json` with its reason.

## Scenarios

```
Given a checkout of the PR branch with node_modules installed under plugin/skills/faff
When  the three emitted .js files are deleted and npm run build is run in plugin/skills/faff
Then  npm run build exits 0
And   git status --porcelain prints nothing
```

```
Given a checkout of the PR branch
When  node --test test/land.test.mjs test/spec-commit.test.mjs test/gates-progress.test.mjs test/gates-budget.test.mjs is run
Then  it exits 0 and its summary reports fail 0
And   git diff --name-only origin/main -- test/land.test.mjs test/spec-commit.test.mjs test/gates-progress.test.mjs test/gates-budget.test.mjs prints nothing
```

```
Given a checkout of the PR branch
When  faff land --selftest and faff spec --selftest are run
Then  each exits 0 and prints RESULT ok land selftest (0 failures) and RESULT ok spec selftest (0 failures) respectively
```

```
Given a checkout of the PR branch
When  faff land --pr 0 is run, and faff gates run --budget-secs 0 is run
Then  each exits 2, as on origin/main
And   their first stderr lines are faff: missing-value: --pr, --issue and --run-dir are required and faff: invalid-value: --budget-secs expects an integer from 1 to 480
```

## 5. DESIGN DECISION RATIONALE

- **Why these three and not `landing-comment`?** The ticket covers the prose-to-code extractions. `landing-comment` predates them (FAFF-860) and FAFF-1396 never edited it.
- **Why not convert the pre-existing gates modules too?** FAFF-1405 made small edits to them, and the rule says small edits to existing JavaScript stay JavaScript. Converting them is a module-sized decision, not a side effect.
- **Why keep the selftests?** Moving them changes test behaviour and belongs with FAFF-1419. Keeping them means the conversion's only claim is "same behaviour, now typed".
- **Why compare printed syntax trees rather than run a differential test?** The modules call `gh`, `git` and the file system, so a differential run would need the same fakes the existing tests already provide. The tests cover behaviour. The printer comparison covers what tests can miss: an executable statement that changed in a path no test reaches.
- **Why an allow file rather than a fixed set of permitted shapes?** The boundary-cast lint forces two kinds of executable change: `Reflect.get` reads and undefined guards. Each one is safe only for a reason specific to its site. A fixed shape either rejects legitimate fixes, such as a guard on a bound local, or admits unjustified ones. A committed entry per hunk, with its reason, keeps every change visible, checkable from the tree, and justified where it happens. Rejecting stale entries stops the file from hiding anything.
- **Why accept strict mode?** Strict mode is part of what the toolchain emits, and refusing it would need a non-default compiler setting for three files. The committed audit covers the run-time differences.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

**Assumes:** `tsc` 5.9 emits `module.exports = { … }` unchanged under `module: commonjs`, as it does for `decision-policy.ts` today. The equivalence check and the export-names test confirm it for these three files.

**Assumes:** none of the three modules depends on sloppy-mode behaviour. The committed strict-mode audit checks this item by item; a hit is a defect to fix inside the conversion, without changing behaviour.

## 7. DONE

### From WHY
- [ ] `land.ts`, `spec-commit.ts` and `gates-progress.ts` exist under `plugin/skills/faff/bin/lib/`, and each has a committed `.js` emit beside it built by `npm run build`.
- [ ] No importer changes: `bin/faff`, `gates-cli.js`, `gates-select.js` and every test still require the extensionless or `.js` path.

### From WHAT and HOW
- [ ] `tsconfig.json` `include` lists the three new `.ts` files, and `build-manifest.json` is the one `npm run build` writes.
- [ ] `plugin/skills/faff/scripts/ts-equivalence.js` exists. The 4.2 command, run from `plugin/skills/faff` against `origin/main` with `verification/ts-conversion/FAFF-1432/equivalence-allow.json`, exits 0.
- [ ] Every entry in `equivalence-allow.json` has a `kind` in the three-kind set from 4.2 and a non-empty `reason`, and has at most one `reflect-get-helper` per path. A test asserts this.
- [ ] `verification/ts-conversion/FAFF-1432/strict-mode-audit.json` has one row for each strict-mode change in the 4.2 table, for each of `land` and `gates-progress`. Each row's `status` is one of `refused-by-tsc`, `absent` or `present-safe`, with non-empty `evidence`. A test asserts this.
- [ ] `test/ts-equivalence.test.mjs` runs the script over committed fixture pairs under `testdata/typescript/equivalence/`:
  - **Exit 0** for a pair that differs only by toolchain preamble. One such pair has a base that already starts with `"use strict";`.
  - **Exit 0** for a pair whose only differences are an inserted `get` helper and one rewritten read, with matching `reflect-get-helper` and `reflect-get-read` entries.
  - **Exit 0** for a pair whose only difference is a bound-local undefined guard, with matching `undefined-guard` entries.
  - **Exit 1, naming the statement,** for each of these with no allow entry: a reordered statement, an emitted class field, a changed string literal, a `Reflect.get` substitution.
  - **Exit 1, naming the entry,** for an allow entry that matches no hunk.
  - **Exit 2** for an allow entry with an empty `reason`, a `kind` outside the set, or both `before` and `after` empty.
  - **Skips the way `check-no-boundary-cast.test.mjs` does** when the `typescript` package is absent.
- [ ] The `typecheck` job's un-skip floor in `.github/workflows/validate.yml` also runs `test/ts-equivalence.test.mjs`, and fails unless it reports `# skipped 0` and a non-zero `# pass`.
- [ ] `node scripts/check-no-boundary-cast.mjs` exits 0 with the three new files in `include`. Its allow-list is unchanged, and `test/check-no-boundary-cast.test.mjs`'s pinned source list includes the three new files and passes.
- [ ] `GatesProgressError`'s fields are `declare` fields, and its emit contains no class field declaration.
- [ ] `test/ts-conversion-exports.test.mjs` holds, as committed literal arrays, each module's export names on main in order, and asserts that `Object.keys(require(...))` equals them. The baseline stays fixed after merge, so a later change that drops or reorders an export fails the test. No `--selftest` case is added.
- [ ] No explicit `any` annotation appears in the three `.ts` files.
- [ ] `faff land --selftest` and `faff spec --selftest` still print `RESULT ok … (0 failures)`, and no selftest case is added or removed.
- [ ] No `commissaire*` file changes, and no skill `SKILL.md` or reference file changes.

### Tests and checks
- [ ] `test/land.test.mjs`, `test/spec-commit.test.mjs`, `test/gates-progress.test.mjs` and `test/gates-budget.test.mjs` pass, and none of them is modified.
- [ ] The full `node --test` suite passes, so every module that imports these three is exercised as well as the direct tests.
- [ ] The CI `typecheck` job passes: type-check, remove-then-rebuild, and an empty `git diff --exit-code`. This compares the committed emit with a fresh build, not with the old hand-written file.
- [ ] `faff regions check` and `faff lint-cli-coverage` pass.
- [ ] `faff gates run` passes.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery, issue-critique._

- **Right-sized (principle 4):** no issues. Three independent, mechanical conversions of about 1,000 lines in total, one commit each. It is within a single 1–3 day unit. Splitting into three tickets would add PR and review overhead without adding review signal, because each conversion is already reviewed as its own emit diff.
- **Workstream fit (principles 1 and 5):** no issues. It completes the prose-to-code lane's move onto TypeScript (ADDENDUM-1 decision 1 (b)), alongside FAFF-1431's enforcing check.
- **Dependencies surfaced (principle 6):** one soft dependency, already handled. FAFF-1429 also edits `spec-commit.js`. The spec makes the later of the two rebase, so neither blocks the other. No blocker link is needed.
- **Risk profile (principle 7):** low. The run-time changes are strict mode in two files and any `Reflect.get` reads or undefined guards the boundary-cast lint forces. Each is cleared by a committed audit or allow entry, and the existing tests run on top. No spike is needed, because PR #1156 already proved the method on two modules.