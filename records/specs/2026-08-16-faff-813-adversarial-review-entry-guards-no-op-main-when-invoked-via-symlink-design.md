# nlspec — FAFF-813: Adversarial-review entrypoint guards no-op under a symlinked install path

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-813.

This spec is the buildable definition for FAFF-813, a bug fix in two Node ESM script entrypoints under `plugin/skills/`. Audience: the build agent implementing the fix, and the human reviewer gating it. It is self-contained — every file, line, and behaviour needed to build and test the change is stated here.

## 1. WHY — Problem and Principles

**The load-bearing model.** A Node ESM script that wants to "run `main()` only when executed directly, but stay silent when imported by a test" compares two URLs: `import.meta.url` (what module am I?) against a URL built from `process.argv[1]` (what script did the user launch?). Node resolves `import.meta.url` through symlinks to the file's **real** path by default. So the two URLs only match when the launched path is *also* canonical. When the launched path runs through a symlink, they diverge and the guard silently decides "I was imported" — so `main()` never runs.

**Problem statement.** faff installs each skill by symlinking the whole `plugin/skills/<skill>/` directory into `~/.claude/skills/<skill>` (see `scripts/link-skills.sh`), so production invocation is literally `node ~/.claude/skills/faffter-dark-spec-review/aggregate.mjs …` — where `process.argv[1]` is the symlink path but `import.meta.url` is the repo realpath. The two hrefs differ, the entry guard is false, and `main()` **silently no-ops**: exit 0, empty stdout, on a gate component. The fix canonicalises `process.argv[1]` through `fs.realpathSync` before building the comparison URL, so the guard fires whether launched by real path or symlink.

**Design principles.**

**Each skill directory is symlinked independently, so a script may not import across skill directories.** The install links `plugin/skills/<skill>/` as a unit; a cross-directory `import` would resolve fine in the repo checkout but break under the very symlink layout this bug lives in. Any shared logic must therefore be duplicated inline per file, not extracted to a common module. This principle would cause rejection of an otherwise-tidy "shared helper module" implementation.

**A gate component must fail loud, never silent.** Both scripts already embody this (aggregate.mjs refuses to vote on an empty/inconsistent set; fan-out.mjs refuses a malformed request set). The whole defect is a silent exit 0. The fix, and the test that guards it, must convert this failure mode into a loud, CI-visible one.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node ESM (.mjs) | Guard at line 217; has a `--selftest` branch already |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node ESM (.mjs) | Guard at line 181; has **no** `--selftest` branch yet |
| `test/spec-refute-aggregate.test.mjs` | node:test | Exact FAFF-464 precedent to mirror at lines 128-148 |
| `test/fan-out.test.mjs` | node:test | fan-out.mjs's test file; new symlink case lands here |
| `scripts/link-skills.sh` | bash | The `--global` `ln -s` per-directory install that reproduces the bug |
| `.github/workflows/validate.yml` | GitHub Actions | Runs `node --import ./test/hermetic-env.mjs --test` over `test/**/*.test.mjs`; auto-picks-up both test files, no workflow change needed |

**Scope statement.** This locates entirely in the two named `.mjs` entry guards plus their two test files; nothing else in the review pipeline changes.

## Already shipped against this surface

- **FAFF-464** (Done) — *"aggregate.mjs CLI-entrypoint guard is URL-fragile — silent no-op when the invoking path has a special char"*. Fixed the **percent-encoding** variant of this same guard by adopting `pathToFileURL(process.argv[1])` (the current code). It is **related but not superseding**: it did not canonicalise `process.argv[1]` through the realpath, so the symlinked-install variant this ticket fixes remains open. Its test at `test/spec-refute-aggregate.test.mjs:128-148` is the precedent the new symlink regression test mirrors. Premise of FAFF-813 still holds — the symlink no-op is a genuine, distinct, unfixed defect.

## 2. OUT OF SCOPE

- **The four `fileURLToPath`-shape guards** — `eval/score-error-rates.mjs:252`, `scripts/mcp-call-census.mjs:291`, `scripts/token-breakdown.mjs:566`, `eval/gen-cases-seeded.mjs:694`, each of the form `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])`.
  - **Why excluded** — they share the *same* realpath-vs-symlink root cause but a *different* guard shape, and this ticket's WHAT is scoped to the two `pathToFileURL(process.argv[1]).href` files. This is the ticket's open question answered: yes, others share the class; they are deliberately deferred, not overlooked.
  - **Extension point** — a follow-up ticket applies the same canonicalisation to the `fileURLToPath(import.meta.url) === process.argv[1]` shape (compare `fileURLToPath(import.meta.url) === realpathSync(process.argv[1])`, guarded identically). See Design Decision Rationale for the marker.
- **The symlink-robust `endsWith("<file>.mjs")` guards** (e.g. `review-call.mjs`, `review-spawn.mjs`, `evaluate-call.mjs`) — no `import.meta.url` equality, so not affected. No change; listed only so the build agent does not "fix" them.
- **Refactoring the guard into a shared library** — rejected on the cross-directory-import principle above; noted here so it is not reintroduced during build.

## 3. WHAT — Types and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Entry guard | The `if (import.meta.url === …)` block that runs `main()` only on direct invocation |
| Install symlink | The `~/.claude/skills/<skill>` → repo `plugin/skills/<skill>/` directory symlink created by `scripts/link-skills.sh --global` |
| Canonical href | `pathToFileURL(realpathSync(argv1)).href` — the symlink-resolved comparison URL |

**The comparison helper** (added inline, identically, to *both* files):

```
FUNCTION entrypoint_href(argv1) -> string | null:
  # Returns the href to compare against import.meta.url, or null when there is
  # nothing safe to compare (so the guard is simply false and main() does not run).
  IF argv1 is falsy (undefined / empty):
    RETURN null
  TRY:
    RETURN pathToFileURL(realpathSync(argv1)).href   # symlink-resolved (the fix)
  CATCH (e.g. ENOENT, odd path):
    RETURN pathToFileURL(argv1).href                 # FAFF-464 raw-path behaviour, unchanged
```

- `import.meta.url` is itself already a realpath, so comparing it against `realpathSync(argv1)` is the correct canonical-vs-canonical comparison.
- The `catch` fallback preserves the exact pre-fix (FAFF-464) semantics for a missing/odd `argv1`: it never throws, and it never *newly* fires when the old code would not have.
- **`entrypoint_href` is exported from each module** (a named export, alongside the functions each file already exports for its unit tests — `aggregate`/`strictMajority`/… in aggregate.mjs, `validateRequests`/`fanOut`/`main` in fan-out.mjs). Exporting it makes its three branches directly unit-testable without spawning a subprocess — in particular the `realpathSync`-throw fallback, which cannot be reached by spawning the script (the script's own `process.argv[1]` always resolves), so it is only reachable by calling the helper with a synthetic non-existent path.

**Import deltas** (one-token additions to existing lines — no new import statements):

| File | Existing line | Becomes |
|---|---|---|
| aggregate.mjs | `import { readFileSync } from "node:fs";` (line 13) | `import { readFileSync, realpathSync } from "node:fs";` |
| fan-out.mjs | `import { readFileSync } from "node:fs";` (line 21) | `import { readFileSync, realpathSync } from "node:fs";` |

`pathToFileURL` is already imported in both (`aggregate.mjs:14`, `fan-out.mjs:23`).

**fan-out.mjs `--selftest` surface** (new). fan-out.mjs's `main(argv, {spawnFn})` is called with an already-sliced argv (`main(process.argv.slice(2))` at line 182), so the flag test operates directly on `argv`:

```
# Inside main(argv, {spawnFn}), as the FIRST branch, before readRequestsInput
# (which reads stdin and would otherwise block):
IF argv includes "--selftest":
  RETURN selftest()      # 0 on pass, non-zero on fail; prints the success string on pass
```

**Design decision — what fan-out `--selftest` asserts.** Options: (a) a pure `validateRequests` check over known-good and known-bad inputs; (b) a trivial `fanOut` with an injected fake `spawnFn`. Option (b) is what the *unit tests* already do and would require importing `EventEmitter` into the production file to fabricate a fake child. Option (a) is pure, adds no new production import, is instantaneous, and mirrors aggregate.mjs's pure `selftest()`. **Chosen:** a pure `validateRequests`-based `selftest()` printing exactly `fan-out --selftest: ok\n` to stdout and returning 0 on pass; on failure, writing the failed assertion names to stderr and returning non-zero. Rationale: keeps the production file zero-new-dependency and the selftest fast and side-effect-free; the injected-spawn path stays exercised by the existing unit tests.

## 4. HOW — Behaviour

**Overview.** Three mechanical edits per concern: (1) both guards call `entrypoint_href(process.argv[1])`; (2) fan-out.mjs gains a `selftest()` and a `--selftest` branch; (3) both test files gain a symlink-invocation regression case. No behaviour changes on any non-entrypoint path.

**The guard rewrite (both files).** Replace the single `if` line with the helper call. aggregate.mjs currently at line 217:

```
# BEFORE (aggregate.mjs:217)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}

# AFTER
if (import.meta.url === entrypoint_href(process.argv[1])) {
  process.exit(main(process.argv));
}
```

fan-out.mjs currently at line 181-183:

```
# BEFORE (fan-out.mjs:181)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

# AFTER
if (import.meta.url === entrypoint_href(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
```

The existing FAFF-464 comment above each guard stays and is extended with one sentence noting the realpath canonicalisation and why (symlinked install path).

**Design decision — where the helper lives.** Options: a shared module imported by both; or an inline copy in each file. A shared module would sit in one skill directory and be imported from the other, which breaks under the per-directory install symlink (the exact layout this bug concerns). **Chosen:** an inline `entrypoint_href` copy in each file (≈6 lines), duplicated deliberately. Rationale: the cross-directory-import principle in WHY forecloses the shared module; a self-contained zero-dependency script is the established shape of both files.

**Design decision — degradation on a missing/odd `argv1`.** Options: (a) on any failure, treat as "not the entrypoint" and skip `main()`; (b) fall back to the raw-path href (pre-fix behaviour) on a `realpathSync` throw, and skip only when `argv1` is falsy. **Chosen:** option (b) — falsy `argv1` returns `null` (guard false, `main` does not run); a `realpathSync` throw falls back to `pathToFileURL(argv1).href`. Rationale: this degrades safely without crashing on either shape, and the fallback is byte-for-byte the FAFF-464 behaviour, so the change is a strict superset — it can only *newly fire* the guard for the symlink case it is meant to fix, never suppress a case that previously worked.

**fan-out.mjs `selftest()` mechanics.**

```
FUNCTION selftest():
  fails = []
  ASSERT validateRequests([{ lens: "architectural", argv: [] }]).ok is true   # known-good
  ASSERT validateRequests([]).ok is false                                     # empty → refused
  ASSERT validateRequests(null).ok is false                                   # non-array → refused
  ASSERT validateRequests([{ lens: "x", argv: [1] }]).ok is false             # non-string argv → refused
  IF any assertion failed:
    write "fan-out --selftest: FAIL\n" + failed names to stderr
    RETURN 1
  write "fan-out --selftest: ok\n" to stdout
  RETURN 0
```

The success string is exactly `fan-out --selftest: ok` (aggregate.mjs already prints `aggregate --selftest: ok`). The exact assertion set above mirrors `validateRequests`'s real contract — confirm each expected `.ok` against the function's current behaviour at build time and adjust the fixtures (not the intent) if its validation rules differ.

**Anti-pattern:** running `--selftest` *after* `readRequestsInput(argv)`. Why: that call reads `--requests FILE` or stdin (fd 0); placed first, an interactive `--selftest` with no piped input would block on stdin. The `--selftest` branch must be the first statement in `main`.

**Anti-pattern:** extracting `entrypoint_href` into a shared cross-skill module. Why: the two files live in separately-symlinked skill directories; a cross-directory import breaks under the install layout.

## 5. Scenarios — born-verifiable

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The symlinked-invocation behaviour is the entire point of the ticket, so it is expressed as scenarios, not left as prose.

```
Given aggregate.mjs reachable through a symlink whose path differs from its realpath
When it is launched as `node <symlink-path>/aggregate.mjs --selftest`
Then stdout contains "aggregate --selftest: ok" and the exit code is 0 (never an empty exit-0 no-op)
```

```
Given fan-out.mjs reachable through a symlink whose path differs from its realpath
When it is launched as `node <symlink-path>/fan-out.mjs --selftest`
Then stdout contains "fan-out --selftest: ok" and the exit code is 0
```

```
Given fan-out.mjs at its real repository path (no symlink)
When it is launched as `node <real-path>/fan-out.mjs --selftest`
Then stdout still contains "fan-out --selftest: ok" and the exit code is 0 (no regression)
```

The exported `entrypoint_href` helper's degradation branches are born-verifiable at the unit level (the throw-fallback branch is unreachable by spawning the real script, so it is asserted by calling the exported helper directly):

```
Given the exported entrypoint_href helper
When it is called with a synthetic path that does not exist (realpathSync throws ENOENT)
Then it returns pathToFileURL(rawPath).href (the FAFF-464 raw-path fallback) and does not throw
```

```
Given the exported entrypoint_href helper
When it is called with a falsy argv1 (undefined / empty string)
Then it returns null (so the entry guard is false and main() does not run)
```

**Design decision — the regression test approach.** The production install symlinks a *directory*; a *file* symlink reproduces the identical divergence because Node realpath-resolves `import.meta.url` either way (the symlink path stays in `process.argv[1]`, the realpath appears in `import.meta.url`). Both scripts are zero-dependency (aggregate.mjs imports only node stdlib; fan-out.mjs's sibling `review-call.mjs` is resolved via realpath-derived `HERE` and is not touched by `--selftest`), so a lone file symlink runs. **Chosen:** mirror the FAFF-464 precedent (`test/spec-refute-aggregate.test.mjs:128-148`) but swap `copyFileSync` for `symlinkSync` — `mkdtempSync` a temp dir, `symlinkSync(REAL_SCRIPT, join(dir, "<name>.mjs"))`, `spawnSync(process.execPath, [symlinkPath, "--selftest"])`, assert non-empty expected stdout and exit 0; and assert the real-path invocation still passes. Rationale: reuses a proven pattern, requires only adding `symlinkSync` to the node:fs import in each test file, and runs in CI with no workflow change.

**Test-file import deltas:**

| File | Add to imports |
|---|---|
| `test/spec-refute-aggregate.test.mjs` | `symlinkSync` to the existing `node:fs` import (already has `copyFileSync, mkdtempSync, rmSync`; `spawnSync`, `AGG` path const already present) |
| `test/fan-out.test.mjs` | `symlinkSync` (and `rmSync`) to `node:fs`; `spawnSync` from `node:child_process`; a `FANOUT` script-path const built from `HERE` (this file currently imports `main`/`fanOut` directly and has no spawn-based CLI test yet) |

## 6. DESIGN DECISION RATIONALE

**Should the four `fileURLToPath`-shape guards be fixed in this ticket?**
- Fix now: one sweep closes the whole bug class. Con: outside the ticket's stated WHAT, four extra files and their tests, scope creep on a targeted bug fix.
- Defer: keeps this change small and reviewable; the class is documented with an extension point.
- **Chosen:** defer to a follow-up ticket — this answers the ticket's open question (yes, others share the realpath-vs-symlink class) while honouring the WHAT's two-file scope. The follow-up applies `fileURLToPath(import.meta.url) === realpathSync(process.argv[1])` with the same falsy/throw guard.

**Where does the comparison helper live — shared module or inline per file?**
- Shared module: one definition, no duplication. Con: cross-skill-directory import breaks under the per-directory install symlink.
- Inline per file: ~6 duplicated lines. Pro: each script stays self-contained and zero-dependency.
- **Chosen:** inline per file — the install layout forbids the cross-directory import, and self-containment is these files' established shape.

**How does the guard degrade on a missing/odd `process.argv[1]`?**
- Skip `main()` on any failure: simplest, but changes behaviour for the odd-path case that FAFF-464 handled.
- Falsy → skip; `realpathSync` throw → fall back to raw-path href: never crashes, and is a strict superset of prior behaviour.
- **Chosen:** the second — safe degradation that only ever *adds* the symlink-firing case, never removes a previously-working one.

**What does fan-out.mjs `--selftest` assert, and what does it print?**
- Injected-`spawnFn` `fanOut`: exercises the transport, but needs `EventEmitter` imported into the production file.
- Pure `validateRequests` checks: no new import, instantaneous, mirrors aggregate.mjs's pure selftest.
- **Chosen:** pure `validateRequests` over known-good/known-bad inputs, printing `fan-out --selftest: ok`; returns 0 on pass, non-zero (names on stderr) on fail.

**How is the symlink no-op guarded in CI?**
- New workflow / package.json script: unnecessary; there is no package.json and the validate workflow already globs `test/**/*.test.mjs`.
- node:test case in the two existing test files, symlink variant of the FAFF-464 pattern: auto-collected by CI.
- **Chosen:** add a `symlinkSync`-based regression case to each test file; no workflow change.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is closed with a `**Chosen:**` marker. The ticket's sole open question (do other entrypoints share the guard?) is resolved: yes, four `fileURLToPath`-shape files do, and they are deliberately deferred to a follow-up (see Out of Scope and Design Decision Rationale).

**Assumptions.** None external — all imports (`realpathSync`, `pathToFileURL`, `symlinkSync`, `spawnSync`) are Node stdlib already available in the repo's test environment; the build agent can confirm by checking the existing imports named in the tables above.

## 8. DONE — Definition of Done

**From WHY**
- [ ] `node <symlinked-path>/aggregate.mjs --selftest` prints `aggregate --selftest: ok` and exits 0 (no longer an empty exit-0 no-op).
- [ ] `node <symlinked-path>/fan-out.mjs --selftest` prints `fan-out --selftest: ok` and exits 0.

**From WHAT (types and interfaces)**
- [ ] `aggregate.mjs` imports `realpathSync` from `node:fs` (line 13 extended, no new statement).
- [ ] `fan-out.mjs` imports `realpathSync` from `node:fs` (line 21 extended, no new statement).
- [ ] Each file defines an inline `entrypoint_href(argv1)` returning `null` on falsy `argv1`, `pathToFileURL(realpathSync(argv1)).href` normally, and `pathToFileURL(argv1).href` on a `realpathSync` throw.
- [ ] `entrypoint_href` is a named export from each module (alongside the functions each file already exports for tests).
- [ ] `fan-out.mjs` has a `selftest()` that prints exactly `fan-out --selftest: ok` on pass and returns 0.

**From HOW (behaviour)**
- [ ] `aggregate.mjs:217` guard compares `import.meta.url === entrypoint_href(process.argv[1])`.
- [ ] `fan-out.mjs:181` guard compares `import.meta.url === entrypoint_href(process.argv[1])`.
- [ ] `fan-out.mjs` `main` handles `--selftest` as its first branch, before `readRequestsInput`.
- [ ] No shared cross-skill-directory module is introduced; the helper is inline in each file.

**From HOW (edge cases)**
- [ ] A falsy `process.argv[1]` leaves the guard false and does not run `main()` (no throw).
- [ ] A `realpathSync` throw (ENOENT/odd path) falls back to the raw-path href without throwing.

**From Scenarios (regression tests)**
- [ ] `test/spec-refute-aggregate.test.mjs` has a `symlinkSync`-based case invoking aggregate.mjs via a symlink path and asserting non-empty `aggregate --selftest: ok` / exit 0.
- [ ] `test/fan-out.test.mjs` has a `symlinkSync`-based case invoking fan-out.mjs via a symlink path and asserting `fan-out --selftest: ok` / exit 0.
- [ ] Both test files also assert the real-repo-path `--selftest` invocation still passes (no regression).
- [ ] A unit test calls the exported `entrypoint_href` with a synthetic non-existent path and asserts it returns `pathToFileURL(rawPath).href` without throwing (the `realpathSync`-throw fallback branch — unreachable by spawning the real script).
- [ ] A unit test calls the exported `entrypoint_href` with a falsy `argv1` and asserts it returns `null`.
- [ ] Both cases pass under `node --import ./test/hermetic-env.mjs --test` with no workflow change.

**From OUT OF SCOPE**
- [ ] The four `fileURLToPath`-shape files are left unchanged and recorded as a deferred follow-up.

**Integration smoke test:**

```
PROCEDURE symlink_entrypoint_smoke():
  1. dir = mkdtempSync(tmpdir + "/faff-symlink-")
  2. link = join(dir, "aggregate.mjs"); symlinkSync(REAL_AGGREGATE_PATH, link)
  3. res = spawnSync(process.execPath, [link, "--selftest"], { encoding: "utf8" })
  4. ASSERT res.status === 0 AND res.stdout matches /aggregate --selftest: ok/
  5. (repeat 2-4 for fan-out.mjs → /fan-out --selftest: ok/)
  6. rmSync(dir, { recursive: true, force: true })
```

## Methodology critique

**Right-sized?** No issues. This is a single 1-3 day unit: one bug class (the symlink-vs-realpath guard mismatch) fixed in two ESM entrypoints, with the two touched test files mirroring the fix and the `--selftest` branch added to `fan-out.mjs` purely to give its new regression test the same invocation affordance `aggregate.mjs` already has. The two production files are the *same* fix applied twice and always ship together; the selftest branch is in service of verifying that fix, not an independent concern. Nothing to split, nothing to merge — the "complex" build-tier reflects reasoning depth, not scope sprawl (4 files, no cross-module architecture, all Node stdlib).

**Workstream fit?** No issues. FAFF-813 carries no project/workstream, which is the correct default landing for a captured bug — project-less in Backlog until a later pass sequences it into an outcome. `faff`, `faff-jot-intake`, and `faff-automate` are labels, not workstreams, so there is no activity-named or mixed-outcome container to flag here.

**Deps surfaced?** The spec explicitly carves the *same* bug class in four more files (the `fileURLToPath(import.meta.url) === process.argv[1]` guard variant) out to "a follow-up ticket," but FAFF-813's only edges are three Related-to links (FAFF-464 Done, FAFF-808, FAFF-310) and no blocks/blockedBy — and the spec never says which, if any, of those *is* that follow-up. FAFF-813 itself correctly needs no blocker (it's a self-contained stdlib fix, and FAFF-464 — the `copyFileSync` precedent the new `symlinkSync` tests mirror — is properly linked and already Done), so no load-bearing `blockedBy` is missing. The gap is forward, not backward: the deferred four-file follow-up is real, named work, and if it isn't captured as a linked ticket it silently evaporates when FAFF-813 closes, leaving four still-vulnerable entrypoints with no trail back to this deferral decision. Confirm the deferred follow-up is one of the existing Related-to edges (FAFF-808 / FAFF-310) and that its scope actually enumerates those four files — or file it and link it. Related-to is the right edge here (a sibling follow-up, not a prerequisite of FAFF-813); no `blockedBy` should be added to FAFF-813.

**Risk profile?** No issues. The change is Node stdlib only (`fs.realpathSync`, `pathToFileURL`), the guard-fixing approach is already proven by the Done FAFF-464 variant, confidence is high, and every decision is closed with a Chosen marker with no open Punts. There is no novel integration, external-team dependency, or unproven approach to de-risk, so no spike is warranted.

confidence: high
build-tier: complex
spec-review: approve
