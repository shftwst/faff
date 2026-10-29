_Agent-written (Claude Code) spec, from /faff-prep. Revised 2026-10-29 after spec-review rounds 3 to 5. Changes: recursive scans for both legs, a base-tree ratchet when the base has no allowlist, git run from the repository root, push events ratcheted against `before`, exhaustive and behaviourally tested CI branches, and `.ts`-only sources. This supersedes comment de5a7e09._

# FAFF-1431: Fail CI on a new bin/lib JavaScript module that has no TypeScript source

> Spec: faffter-dark-nlspec · 2026-10-29 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1431.

## 1. WHY

ADDENDUM-1 decision 1 (b), taken 2026-10-03, made TypeScript the authoritative source language and new V5 modules TypeScript-first. ADR-0132 settled how that ships: layout (d), with `x.ts` as the source and a committed `tsc` emit `x.js` beside it. On 2026-10-29 the operator restated the rule for contributors: new `plugin/skills/faff/bin/lib/` modules are TypeScript (PR #1162 adds it to AGENTS.md).

Nothing enforces the rule. On `origin/main` `bin/lib` holds 188 `.js` files, and 176 of them have no `.ts` source. Every module added outside the Commissaire and governor cluster since the decision is plain JavaScript, including every prose-to-code extraction (`land.js`, `spec-commit.js`, `prep-attach.js`, `faff-version.js`). Two open PRs add more: #1157 adds `drain-filter.js`; #1156 adds `prep-attach.js` and `judge-dispositions.js` (both now being converted in that PR).

The only check today runs the other way. `faff regions check` fails (exit 2, `EMIT-MISSING`) when a `.ts` has no committed `.js` sibling (FAFF-1170). Nothing fails a new `.js` that has no `.ts`.

There is a second gap of the same kind. `tsconfig.json`'s `include` lists files by name, and CI's type-check and stale-emit steps (FAFF-1171) cover only what `include` names. A `.ts` that is not in `include` is never type-checked, and its `.js` is never rebuilt from it. It would pass `regions check` with a hand-written `.js` beside it, so the module is TypeScript in name only.

### Design principles

- **Mechanical, not review judgement.** The rule fails CI on the PR that breaks it, through a check CI already runs.
- **The allowlist only shrinks.** Today's JavaScript modules are listed once. Converting a module removes its entry, and a stale entry fails the check, so the list cannot quietly keep a converted module.
- **Extend the check that already owns `.ts`/`.js` pairing.** No new command, no new CI step.
- **Commissaire gains nothing.** No `commissaire*` module changes.

### Reference context

- `plugin/skills/faff/bin/lib/regions.js`
  - `regionTsSources()` (line 47): lists `.ts` files in `bin/lib`, or in `FAFF_EMIT_COVERAGE_TS_DIR` when the test-only seam is set.
  - `regionsEmitCoverage(tsFiles)` (line 56): returns `{ missing }` for any `.ts` without a sibling `.js`.
  - `cmdRegions` `check` (line 1205): runs the emit-coverage floor first (exit 2 on any miss), then the require-graph lint (exit 2 malformed, exit 1 violations).
  - `regionsExitFor` (line 858): `malformed` → 2, `violations` → 1, else 0.
- `plugin/skills/faff/tsconfig.json`: `include` is an explicit list of 12 `.ts` paths under `bin/lib/`, no glob.
- `.github/workflows/validate.yml`
  - line 115 runs `faff regions check` in every PR's validate job.
  - lines 425–480: the TypeScript job derives emit paths from `tsconfig.json` `include`, deletes them, rebuilds and runs `git diff --exit-code`.
- `test/emit-coverage.test.mjs`: the FAFF-1170 tests, including the command-level test that drives `regions check` through `FAFF_EMIT_COVERAGE_TS_DIR`.
- `bin/lib` on `origin/main` also holds `killable-spawn.mjs` and `peer-cred-helper.py`.

### Already shipped against this surface

- **FAFF-1170 (Done):** the `.ts`-without-`.js` emit-coverage floor in `regions check`. This ticket adds its inverse beside it.
- **FAFF-1171 (Done):** CI type-check and stale-emit gate over `tsconfig.json` `include`. This ticket closes the gap where a `.ts` is left out of `include`.
- **FAFF-1172 (Done):** `faff doctor` reports a stale emit. Unchanged.

None of them fails a new JavaScript module, so the premise holds.

## 2. OUT OF SCOPE

- Converting any existing module (FAFF-1432).
- Files outside `plugin/skills/faff/bin/lib/` (skill-local `.mjs` helpers, `bin/faff`, `test/`).
- Non-JavaScript files in `bin/lib` (`peer-cred-helper.py`).
- Changing the stale-emit CI job.
- Any skill prose. This change edits no `SKILL.md` or reference prose, so no rule inventory is needed.

## 3. WHAT

`faff regions check` gains a **TS-first leg**. It fails when:

1. **A new JavaScript module has no TypeScript source.** A `.js`, `.mjs` or `.cjs` file anywhere under `bin/lib`, at any depth, has no `.ts` sibling and is not listed in the allowlist. Diagnostic: `TS-FIRST — <file>: new bin/lib module has no TypeScript source (write <base>.ts and commit its emit; see AGENTS.md)`.
2. **An allowlist entry is stale.** The entry names a file that no longer exists, or that now has a `.ts` source. Diagnostic: `TS-FIRST — <file>: allowlist entry is stale (remove it from legacy-js-modules.json)`.
3. **A TypeScript source is not in `tsconfig.json` `include`.** Diagnostic: `TS-FIRST — <file>.ts: not listed in tsconfig.json include, so CI never type-checks it or rebuilds its emit`.
4. **The allowlist grew** (only with `--base <ref>`). An allowlist entry is absent from the allowlist at `<ref>`. Diagnostic: `TS-FIRST — <file>: added to legacy-js-modules.json since <ref>; new modules are TypeScript, the allowlist only shrinks`.

**Diagnostics never print a raw interpolated value.** Every file name and the `--base` ref in a `TS-FIRST` line are printed `JSON.stringify`-quoted, so a value holding a newline or control character cannot forge a second log line. A scanned file name containing a control character is itself `malformed` (exit 2).

**`--base` accepts only a plain ref.** A value outside `[A-Za-z0-9._/-]`, or one starting with `-`, is a usage error (exit 2) before git runs. The ref is passed to git as one argv element, never through a shell.

The allowlist is a new committed file, `plugin/skills/faff/legacy-js-modules.json`: a sorted JSON array of `bin/lib`-relative paths (today all are bare file names, because `bin/lib` has no subdirectories), one per line, holding every JavaScript module that has no `.ts` source on the build's base branch.

**Chosen:** the leg lives in `regions.js` and `regions check`, not a new lint or command. Rationale: `regions check` already owns `.ts`/`.js` pairing, already runs in every PR's validate job, and already has the fixture-dir test seam. A new command would need its own CI step, coverage registration and docs row for the same question.

**Chosen:** the edit to `regions.js` stays JavaScript. It is a small addition (two pure functions and one call site) to an existing 1,246-line JS module, which the AGENTS.md rule leaves as JS. Converting `regions.js` is FAFF-1432-style work, not this ticket's.

**Chosen:** the allowlist is a JSON file beside `tsconfig.json`, not a constant in `regions.js`. Rationale: it is data with 176 entries, it changes on every conversion, and one-entry-per-line JSON gives a one-line diff per conversion. A constant would add 176 lines of data to a code module that already carries a selftest block.

**Chosen:** `.mjs` and `.cjs` count as JavaScript modules. Rationale: otherwise a new module escapes the rule by changing its extension. `killable-spawn.mjs` goes on the allowlist like any other existing module.

**Chosen:** only `.ts` counts as a TypeScript source. A `.ts` pairs only with the `.js` of the same path, because `tsconfig.json` compiles `.ts` to CommonJS `.js`. A new `.mjs` or `.cjs` can therefore never be paired, and always needs an allowlist entry, which rule 4 then refuses. A `.mts` or `.cts` file under `bin/lib` is `malformed` (exit 2) with a diagnostic saying `bin/lib` sources are `.ts`. None exist today. Rationale: the build emits only `.ts`→`.js`, so recognising other TypeScript extensions would admit pairs nothing builds.

**Chosen:** no exemption for helper or fixture modules. Rationale: every file in `bin/lib` ships in the plugin. New test helpers belong in `test/` under the AGENTS.md "tests live in test/" rule, and the existing `fixtures.js`, `review-fixture-paths.js`, `merge-gate-selftest.js` and `config-write-selftest.js` are covered by the allowlist like everything else.

**Chosen:** violations of rules 1, 2 and 4 exit **1** (`violations`); rule 3 exits **2** (`malformed`), the same class as `EMIT-MISSING`. Rationale: rules 1, 2 and 4 are policy violations in a well-formed tree, while a `.ts` outside `include` means the governed emit cannot be proved fresh, the same failure class FAFF-1170 already maps to 2.

### How "only shrinks" is enforced

- **Removal is forced.** A converted or deleted module whose entry remains fails rule 2.
- **Addition fails CI.** Without a ratchet, a PR could add `evil.js` and its allowlist entry together and pass, which would turn the rule back into review judgement. So rule 4 compares the allowlist with the PR's base.

**Chosen:** `regions check` gains an optional `--base <ref>` flag that enables rule 4, and CI passes it on pull requests. Rationale:
- Without `--base`, `regions check` stays a pure local-tree check that runs offline and in every lane, exactly as today.
- With it, the leg reads the base allowlist through `git show <ref>:plugin/skills/faff/legacy-js-modules.json`.
- **A base with no allowlist file is not a pass.** The leg instead derives the base set from the base tree: `git ls-tree -r --name-only <ref> plugin/skills/faff/bin/lib/`, keeping the JS files with no TypeScript sibling at `<ref>`. Any allowlist entry not in that derived set fails rule 4. This covers the PR that builds this ticket, and any PR whose base predates it. So a PR that adds `legacy-js-modules.json`, `evil.js` and an `evil.js` entry together, against such a base, still fails: `evil.js` is not an unpaired module at the base.
- **Git runs from the repository root.** Every git call uses `git -C <toplevel>`, where `<toplevel>` comes from `git rev-parse --show-toplevel` run beside `regions.js`. The `<ref>:<path>` pathspec therefore resolves the same from any working directory.
- **Any other git failure** (an unknown ref, git missing, no repository) is `malformed` (exit 2). It never passes, so a broken base read cannot disable the ratchet.

**The CI change.** The `regions check` step in `validate.yml` passes every event value through `env:` (`EVENT: ${{ github.event_name }}`, `BASE_REF: ${{ github.base_ref }}`, `BEFORE: ${{ github.event.before }}`) and never interpolates one into `run:`. It then branches on `$EVENT`, and each branch validates only its own value:
- **`pull_request`:** the checkout is the PR's merge commit (the `actions/checkout` default), so an entry `main` removed while the PR was open is already absent from the tree being checked, unless the PR itself re-adds it. Rule 4's diagnostic still ends with `(rebase onto <ref> if it converted this module)` for the conflict case. Fail unless `$BASE_REF` matches `^[A-Za-z0-9._/-]+$` and does not start with `-`. Then `git fetch --depth=1 origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"` and `faff regions check --base "origin/$BASE_REF"`. The explicit refspec is needed because the checkout action's single-ref clone doesn't guarantee a remote-tracking ref. Inside double quotes a value is never re-parsed for `$(...)`, so the quoted fetch is already safe; the regex makes that independent of quoting.
- **`push`:** exactly three cases, nothing else:
  - **40 hex characters, not all zeros:** `git fetch --depth=1 origin "$BEFORE"` and `faff regions check --base "$BEFORE"`. So a direct push to `main` is ratcheted against the commit it replaced, not waved through. If that fetch fails (for example after a force-push made the commit unreachable), the step fails with a diagnostic naming the unreachable `before` commit and the likely force-push. It never skips the ratchet.
  - **All zeros (a newly created branch):** run `faff regions check` without `--base`. That push has no prior commit to compare, and its later PR into `main` is ratcheted.
  - **Any other value** (empty, short, non-hex): the step fails, naming the value JSON-quoted. A malformed payload never silently drops the ratchet.
- **Any other event:** `faff regions check` without `--base`, as today.
- `faff`'s own `--base` validation is the second line of defence, and a 40-hex SHA passes it.

**A rename is a removal plus an addition.** Renaming `old.js` to `new.js` stales the `old.js` entry (rule 2), and `new.js` is a new module (rules 1 and 4). That is deliberate: a renamed module is a new module, so it is written in TypeScript.

**The allowlist checks itself.** Any wrong allowlist fails the check on the real tree:
- missing a JS module → rule 1;
- naming a file that doesn't exist, or that has a `.ts` source → rule 2;
- malformed → exit 2.

So "the real tree passes `regions check`" proves the generated file is exactly the set of unpaired modules.

### Modules that land between this spec and the build

The allowlist is generated at build time from the build's base, not frozen at today's 176.

- **A JavaScript module that merges to `main` before this ticket builds** (for example `drain-filter.js`, if #1157 lands first) is on the base, so it goes on the allowlist. The build PR lists every module allowlisted beyond today's 176 and adds them to FAFF-1432's conversion list.
- **A module that is still in an open PR when this ticket merges** fails CI on rebase and must convert before it merges. #1156's modules are already converting.

## 4. HOW

### 4.1 Pure functions in `regions.js`

- `regionsJsModules(dir)`: lists `.js`, `.mjs` and `.cjs` files under `dir` recursively, as `dir`-relative paths with `/` separators, sorted. A symlinked directory under `dir` is `malformed` (exit 2) rather than skipped, so a link can't hide a module. TypeScript sources are listed the same way. **Chosen:** the FAFF-1170 emit floor (`regionTsSources`) switches to the same recursive lister, so a `bin/lib/sub/x.ts` with no committed `sub/x.js` exits 2 at the emit floor. Rationale: a recursive TS-first leg over a flat emit floor would let a nested `.ts` ship with no committed emit. CI's `git diff --exit-code` ignores untracked files, so it would not catch that either. The FAFF-1170 tests use a flat fixture, so their results don't change.
- `regionsTsFirst({ jsFiles, tsFiles, allowlist, include })`: returns `{ violations: [string], malformed: [string] }`.
  - **rule 1:** each `jsFiles` entry whose path has no `.ts` of the same path in `tsFiles` and whose relative path is not in `allowlist` goes to `violations`.
  - **rule 2:** each `allowlist` entry that is not a current JS file, or whose base has a TypeScript source, goes to `violations`.
  - **rule 3:** each `tsFiles` entry whose `bin/lib/<name>` path is absent from `include` goes to `malformed`.
  - **rule 4**, when a `baseAllowlist` array is passed (the base file, or the set derived from the base tree): each `allowlist` entry absent from `baseAllowlist` goes to `violations`.
  - **names:** a `jsFiles` or `tsFiles` name containing a control character goes to `malformed`. Every name in an output line is `JSON.stringify`-quoted.
- Pure: no fs or git inside `regionsTsFirst`. Exported beside `regionsEmitCoverage`.
- `regionsReadBaseAllowlist(ref)`: the only git-touching helper, run as `git -C <toplevel>`. It returns the base allowlist when `<ref>` has the file. When git reports the path does not exist at `<ref>`, it returns the set derived from `<ref>`'s tree (see "How only shrinks is enforced"). Any other failure throws, which the caller maps to `malformed`.

### 4.2 Wiring into `regions check`

- Runs immediately after the emit-coverage floor and before the require-graph lint, so a well-formed TS tree is required before the graph is linted.
- **Inputs:**
  - the scan dir comes from the existing `FAFF_EMIT_COVERAGE_TS_DIR` seam or `__dirname`;
  - the allowlist and `tsconfig.json` are read from `plugin/skills/faff/` for a real run.
  - **When the seam is set,** the leg reads `tsconfig.json` and `legacy-js-modules.json` from the seam dir itself, so a fixture carries its own `include` and allowlist and never meets the real `tsconfig.json`. **Chosen:** one seam, not three. Rationale: a fixture is self-contained, rule 3 can be exercised through the seam, and no second seam can disagree with the scan dir.
  - **Rule 3 matches on the `bin/lib`-relative path:** a `.ts` passes when `include` lists `bin/lib/<path>.ts`. A seamed fixture writes its `include` in the same form.
  - **The existing FAFF-1170 tests are unaffected.** Its command test writes a `.ts` with no `.js`, so it exits 2 at the emit floor, which runs first, before the TS-first leg reads anything. The real-tree test passes once the allowlist is committed. Neither changes expectation.
- **An absent or unparseable allowlist or `tsconfig.json`** is `malformed` (exit 2) with a diagnostic naming the file. It is never read as an empty list, because an empty allowlist would fail all 176 modules and a missing one must be loud, not a flood.
- **Output:**
  - each violation and malformed line prints to stderr with the `TS-FIRST` prefix;
  - `malformed` → exit 2; otherwise any `violations` → exit 1; otherwise continue to the require-graph lint;
  - the PASS line gains `, every bin/lib module has a TypeScript source or a legacy allowlist entry`.

### 4.3 The allowlist file

- `plugin/skills/faff/legacy-js-modules.json`: a JSON array of `bin/lib`-relative paths, sorted, one string per line, ending with a newline.
- Generated once at build time by listing the base's `bin/lib` JS modules that have no `.ts` sibling. The generation is a one-off step in the build, not a shipped command.
- A short header is not possible in JSON; the purpose and the shrink-only rule are documented in AGENTS.md and the `cli.md` regions row.

### 4.4 Docs

- **`docs/guide/cli.md`, `regions` row:** add the TS-first leg, its four rules, `--base`, exit codes, and the allowlist file.
- **AGENTS.md TypeScript section** (as amended by PR #1162): replace "the check that fails a new `.js` module with no `.ts` source is FAFF-1431" with "`faff regions check` fails a new `.js` module with no `.ts` source; existing modules are listed in `plugin/skills/faff/legacy-js-modules.json`, and converting one removes its entry". If #1162 has not merged when this builds, add the same sentence to the section.

### 4.5 Edge cases

- **A `.ts` and `.js` pair with no `include` entry:** rule 3 fails (exit 2).
- **A `.d.ts` file:** not a module source. It is ignored by rule 3 and not counted as a TypeScript sibling. None exist today.
- **An allowlist entry that escapes `bin/lib` or has a non-JS extension:** `malformed` (exit 2). An entry is a `bin/lib`-relative path ending `.js`, `.mjs` or `.cjs`, with no leading `/`, no `..` segment and no backslash.
- **A duplicate allowlist entry:** `malformed` (exit 2).
- **An unsorted allowlist:** `malformed` (exit 2). This keeps conversion diffs to one line.

### 4.6 Tests (in `test/` only)

New file `test/ts-first.test.mjs` (or new cases in `test/emit-coverage.test.mjs`). No `--selftest` case is added to `regions.js`'s existing block. No new command, so `REGION_SELFTEST_ARGV` and `TEST_FILE_COVERAGE` are unchanged.

- **pure:** a JS file with no `.ts` and no allowlist entry → one violation.
- **pure:** the same file allowlisted → none.
- **pure:** a JS file with a `.ts` sibling → none.
- **pure:** an `.mjs` with no `.ts` and no entry → one violation.
- **pure:** an allowlist entry for a file that has a `.ts` → stale violation.
- **pure:** an allowlist entry for a missing file → stale violation.
- **pure:** a `.ts` absent from `include` → malformed.
- **command:** a fixture dir with a new un-allowlisted `.js` → exit 1, stderr matches `TS-FIRST`.
- **command:** a fixture `.ts` with a `.js` sibling but no `include` entry → exit 2.
- **command:** a missing allowlist file → exit 2 naming the file.
- **command:** an unsorted or duplicate allowlist → exit 2.
- **command:** an allowlist entry that escapes (`../x.js`, `/x.js`) or has a non-JS extension (`notes.txt`) → exit 2, not a rule-2 violation.
- **command:** a new `sub/evil.js` in a subdirectory of the fixture dir, with no `.ts` and no entry → exit 1 naming `sub/evil.js`.
- **command:** a symlinked directory in the fixture dir → exit 2.
- **command:** a fixture `sub/x.ts` with no `sub/x.js` → exit 2 at the emit floor (`EMIT-MISSING` naming `sub/x.ts`).
- **workflow, static:** a test reads `validate.yml` and asserts that the `regions check` step routes `github.base_ref`, `github.event.before` and `github.event_name` only through `env:`, with no `${{` inside its `run:` script.
- **workflow, behavioural:** the test extracts the step's `run:` script and executes it under `bash` with stub `git` and `faff` executables first on `PATH`. The stubs record their argv; `git fetch` can be made to fail. One case per branch, each asserting exit status and recorded argv:
  - `pull_request` with `BASE_REF=main` → `git fetch --depth=1 origin +refs/heads/main:refs/remotes/origin/main`, then `faff regions check --base origin/main`.
  - `pull_request` with `BASE_REF='x$(id)'` → non-zero, and no `git` or `faff` call.
  - `push` with a 40-hex `BEFORE` → `faff regions check --base <sha>`.
  - `push` with a 40-hex `BEFORE` whose fetch fails → non-zero, and no `faff` call.
  - `push` with an all-zero `BEFORE` → `faff regions check` with no `--base`.
  - `push` with `BEFORE=abc` → non-zero.
  - `workflow_dispatch` → `faff regions check` with no `--base`.
- **command:** a fixture `x.mts` → exit 2.
- **command:** in a temp git repo whose base commit has no allowlist file and an unpaired `old.js`, a head that adds the allowlist with `old.js` and `evil.js` plus an `evil.js` file → `--base` exits 1 naming `evil.js`; with only `old.js` → exit 0.
- **command:** `regions check --base <ref>` run from a subdirectory (`plugin/skills/faff/`) gives the same result as from the repository root.
- **command:** `--base` with a value containing `$` or starting with `-` → exit 2 before git runs.
- **command:** a seamed fixture with its own `tsconfig.json` listing `bin/lib/probe.ts` and a `probe.ts` + `probe.js` pair → exit 0; the same without the `include` entry → exit 2.
- **command:** the real tree passes (exit 0).
- **pure:** an entry present in the allowlist but absent from `baseAllowlist` → violation.
- **pure:** rule 4 against a base set derived from the base tree (no base allowlist file): an entry not in the derived set → violation.
- **pure:** a scanned name with a newline → malformed, and the output line contains the JSON-quoted name with no raw newline.
- **command:** in a temp git repo whose base commit has a smaller allowlist, `regions check --base <base>` with an added entry → exit 1 naming the entry.
- **command:** `--base` naming an unknown ref → exit 2.
- **command:** a rename fixture (`old.js` allowlisted, renamed to `new.js`) → exit 1 with both the stale and the new-module diagnostics.
- **real tree:** the committed `legacy-js-modules.json` equals the set of `bin/lib` `.js`/`.mjs`/`.cjs` files with no TypeScript sibling, computed independently in the test.

## Scenarios

- **Given** a PR adds `bin/lib/new-thing.js` with no `new-thing.ts` and no allowlist entry, **when** CI runs `faff regions check`, **then** it exits 1 with `TS-FIRST — new-thing.js: new bin/lib module has no TypeScript source`.
- **Given** a PR converts `spec-commit.js` to `spec-commit.ts` but leaves `spec-commit.js` in `legacy-js-modules.json`, **when** `faff regions check` runs, **then** it exits 1 naming the stale entry.
- **Given** a PR adds `bin/lib/x.ts` and its committed `x.js` but does not add `bin/lib/x.ts` to `tsconfig.json` `include`, **when** `faff regions check` runs, **then** it exits 2 naming `x.ts`.
- **Given** a PR adds `bin/lib/evil.js` and adds `evil.js` to `legacy-js-modules.json`, **when** CI runs `faff regions check --base "origin/main"`, **then** it exits 1 with `TS-FIRST — "evil.js": added to legacy-js-modules.json since "origin/main"`.
- **Given** a PR whose base predates the allowlist adds the allowlist with an entry for a new `evil.js`, **when** CI runs `regions check --base`, **then** it exits 1, because `evil.js` is not an unpaired module in the base tree.
- **Given** a PR adds `bin/lib/sub/evil.js` with no TypeScript source, **when** `faff regions check` runs, **then** it exits 1 naming `sub/evil.js`.
- **Given** a direct push to `main` adds `bin/lib/evil.js` and its allowlist entry, **when** CI runs the `regions check` step on the `push` event with a 40-hex `before`, **then** it runs `faff regions check --base <before>`, which exits 1 naming `evil.js`.
- **Given** a `push` event whose `before` is `abc`, **when** the step runs, **then** it fails before calling `faff`.
- **Given** the real tree after this change, **when** `faff regions check` runs, **then** it exits 0.

## Rule inventory

Not applicable: this change edits no skill prose.

## 5. DESIGN DECISION RATIONALE

- **`regions check` over a new lint:** one check owns `.ts`/`.js` pairing in both directions, with no new CI step or command registration.
- **JSON allowlist over a code constant:** data that changes per conversion stays out of a code module; one line per entry keeps each conversion a one-line diff.
- **Base comparison behind `--base`:** a tree-only check can't tell a legacy entry from one added to admit the PR's own module, so the ratchet needs the base. Putting it behind a flag keeps the default `regions check` pure and offline. CI supplies the base on pull requests, and the `before` commit on pushes.
- **The `include` leg in the same ticket:** without it a `.ts` outside `include` satisfies "has a TypeScript source" while CI never type-checks it, which would make the new rule satisfiable in name only.
- **Generated at build time:** a JS module that lands on `main` in the window is grandfathered and listed for conversion rather than breaking `main`.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** PR #1156's conversion of `prep-attach` and `judge-dispositions` lands before or with this build. If it doesn't, those two modules are on the base as JS and are allowlisted and listed for FAFF-1432 like any other.

**Assumes:** CI's validate job keeps running `faff regions check` on every PR (`validate.yml` line 115).

## 7. DONE

### From WHY
- [ ] A PR that adds a new JavaScript module to `bin/lib` with no TypeScript source fails `faff regions check` with exit 1.
- [ ] A TypeScript source in `bin/lib` that is not in `tsconfig.json` `include` fails `faff regions check` with exit 2.

### From WHAT and HOW
- [ ] `plugin/skills/faff/legacy-js-modules.json` exists, is sorted with one `bin/lib`-relative path per line, and lists exactly the build base's `bin/lib` `.js`/`.mjs`/`.cjs` files with no `.ts` sibling.
- [ ] The build PR's description lists every allowlisted module beyond the 176 counted on 2026-10-29, and each is added to FAFF-1432.
- [ ] A stale allowlist entry (file removed, or `.ts` now present) fails `faff regions check` with exit 1.
- [ ] An absent, unparseable, unsorted or duplicate-entry allowlist, or an entry that escapes `bin/lib` or has a non-JS extension, fails with exit 2, naming the file.
- [ ] A new JS module in a subdirectory of `bin/lib` fails rule 1, and a symlinked directory under `bin/lib` exits 2.
- [ ] `--base` rejects a value outside `[A-Za-z0-9._/-]` or starting with `-` with exit 2, and `validate.yml` passes the base ref through `env`, never interpolated into `run:`.
- [ ] The existing `test/emit-coverage.test.mjs` cases pass unchanged.
- [ ] `.mjs` and `.cjs` files are covered by rule 1.
- [ ] With `--base <ref>`, an allowlist entry absent at `<ref>` fails with exit 1. A base with no allowlist file is checked against the set derived from the base tree, never passed, and any other git failure exits 2. The result does not depend on the working directory.
- [ ] `validate.yml` runs `faff regions check --base "origin/<base_ref>"` on pull requests, and `--base "<event.before>"` on a push with a non-zero `before`. On every other event it runs without `--base`. Each branch validates only its own value, so a push never fails on an empty `BASE_REF`.
- [ ] A `bin/lib/sub/x.ts` with no committed `sub/x.js` fails the emit floor with exit 2.
- [ ] On `push`, a `before` that is neither 40-hex nor all zeros, or whose fetch fails, fails the step. Only an all-zero `before` runs without `--base`.
- [ ] The behavioural workflow test runs the extracted step script for each event case in section 4.6, and asserts the recorded `git` and `faff` argv.
- [ ] A `.mts` or `.cts` file under `bin/lib` exits 2. Only `.ts` pairs with `.js`.
- [ ] Diagnostics print every file name JSON-quoted, and a scanned name containing a control character exits 2.
- [ ] A renamed allowlisted module fails as a stale entry plus a new module.
- [ ] `regionsTsFirst` and `regionsJsModules` are exported from `regions.js`, and `regionsTsFirst` reads no files.
- [ ] No `commissaire*` module changes: `git diff --stat` over `plugin/skills/faff/bin/lib/commissaire*` is empty.
- [ ] `docs/guide/cli.md`'s `regions` row documents the TS-first leg, its exit codes and the allowlist.
- [ ] AGENTS.md's TypeScript section names `faff regions check` and `legacy-js-modules.json` as the enforcement.
- [ ] `faff regions check` passes on the real tree.

### Tests
- [ ] The cases in section 4.6 exist in `test/` and pass.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```

## Methodology critique

_faffter-dark-methodology-agile-delivery, issue-critique._

- **Right-sized? No issues.** It's one check in an existing command, a generated data file, a docs row, and tests. That fits a single 1–3 day unit. The `include` leg (rule 3) belongs in the same change rather than a sibling ticket, because without it rule 1 can be satisfied in name only.
- **Workstream fit? No issues.** It's the enforcement half of the TypeScript-first rule, and its outcome is named: CI rejects a new JavaScript module.
- **Deps surfaced? Soft, and recorded.** These are ordering notes, not blockers:
  - PR #1162 (the AGENTS.md rule): the docs step handles either merge order.
  - PR #1156 (the in-PR conversion): the generated allowlist handles either order.
  - PR #1157, which adds `drain-filter.js`: it either lands first and is allowlisted, or rebases onto this change and converts. The spec names this.
- **Risk profile? Low.** It's a pure local filesystem check with no external dependency. The failure mode is a false CI failure on an unexpected file shape, which the fixture tests cover.

