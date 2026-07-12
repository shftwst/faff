# FAFF-464 — Make aggregate.mjs's CLI-entrypoint guard URL-safe

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-464.

This spec describes the fix for the fragile CLI-entrypoint guard in the L4 spec-reviewer's `aggregate.mjs`. Audience: the build agent implementing the one-line fix and its regression test, plus human reviewers checking the born-verifiable DONE.

## 1. WHY — Problem and Principles

**Load-bearing model.** A Node script that is *both* an importable module *and* a runnable CLI decides "am I being run directly?" by comparing `import.meta.url` (always a `file://` URL, percent-encoded) against a string built from `process.argv[1]` (a raw filesystem path). When the invoking path contains a URL-special character, the two representations diverge and the equality silently fails — so `main()` never runs.

**Problem statement.** `aggregate.mjs:212` guards its CLI entrypoint with `import.meta.url === ` + a hand-built `` `file://${process.argv[1]}` `` string. Invoked from a path containing a URL-special char (e.g. a `models.build_by_confidence` budget-branch worktree dir with `×` in the name), the guard's comparison fails, `main()` is skipped, and the process exits 0 with empty stdout — a silent no-op on a gate component. This fix replaces the hand-built `file://` string with `pathToFileURL`, which percent-encodes the path identically to `import.meta.url`.

**Design principles.**

- **Fail-loud over fail-silent on a gate.** `aggregate.mjs` rolls the L4 refutations up to the spec-review verdict; a silent empty output is a false-clean that could pass an empty aggregate. The guard must fire regardless of the invoking path.
- **No behaviour change when run as a module.** The import-time guard must stay false under `import` (the tests import the pure functions); only direct-CLI detection is being made robust.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node ESM | The file being fixed; line 212 is the fragile guard. |
| `test/spec-refute-aggregate.test.mjs` | Node test | Imports the pure exports and spawns the mjs as a CLI subprocess; regression lands here. |
| `node:url` `pathToFileURL` | Node stdlib | Correct, percent-encoding path→`file:` URL conversion. |

**Scope statement.** A localised correctness fix to one entrypoint guard in the spec-review slot occupant; no contract, interface, or aggregation-logic change.

## 2. OUT OF SCOPE

- **Aggregation logic / severity map / contract shape** — **Why excluded:** the bug is purely in entrypoint detection; `main()`/`aggregate()` are correct. **Extension point:** `aggregate()` and `SEVERITY_MAP` in the same file.
- **A repo-wide entrypoint-guard helper** — **Why excluded:** `aggregate.mjs:212` is the *only* `file://`-plus-`process.argv[1]` guard in the codebase (grep-confirmed; `env.js:396`'s `file://` is a seed-DB endpoint URL, not an entrypoint guard). A shared helper is unwarranted for one call site. **Extension point:** if a second CLI-dual-mode `.mjs` appears, factor a shared `isMainModule()` helper then.

## 3. WHAT — Vocabulary, Types, and Interfaces

No new types, vocabulary, or interfaces. The change is confined to the module-tail entrypoint guard:

```
# before (fragile — raw path in a hand-built file:// string)
IF import.meta.url == ("file://" + process.argv[1]) THEN run main

# after (robust — percent-encoded via pathToFileURL)
IF import.meta.url == pathToFileURL(process.argv[1]).href THEN run main
```

`pathToFileURL` is added via a new `import { pathToFileURL } from "node:url";` (the file currently imports only `readFileSync` from `node:fs`).

**Design decision — string-compare vs `pathToFileURL`.** Hand-building the `file://`-prefixed path under-encodes special chars; `pathToFileURL(p).href` is the stdlib-canonical conversion that matches `import.meta.url`'s encoding. **Chosen:** `import.meta.url === pathToFileURL(process.argv[1]).href` — the fix named in the ticket, minimal and stdlib-correct.

## 4. HOW — Behavior

**Approach.** Add the `node:url` import, replace the line-212 guard expression, leave the guarded body (`process.exit(main(process.argv))`) untouched.

```
PROCEDURE entrypoint_guard:
  1. Compute selfUrl = import.meta.url                      # e.g. file:///…/aggregate.mjs (percent-encoded)
  2. Compute invokedUrl = pathToFileURL(process.argv[1]).href
  3. IF selfUrl == invokedUrl:                              # run directly as a CLI
     a. process.exit(main(process.argv))
  4. ELSE: do nothing                                        # imported as a module — guard stays false
```

**Edge cases.**

- **Imported (no direct invocation)** — `process.argv[1]` is the *importer's* path, not `aggregate.mjs`, so `invokedUrl != selfUrl`; the guard stays false. Unchanged behaviour; the pure-function tests continue to import cleanly.
- **`process.argv[1]` undefined** (e.g. REPL) — `pathToFileURL(undefined)` throws. Not a regression path: today's hand-built string also never equals `selfUrl`, and no faff caller invokes `aggregate.mjs` without a script path. Not handled; out of scope.

**Failure modes.** None above the complexity bar — this is a mechanical single-expression correctness fix with a directly observable outcome (guard fires / doesn't).

**Anti-pattern:** re-introducing a hand-built `file://`-prefixed string anywhere as an entrypoint check. Why: it under-encodes special chars and re-opens this exact silent-no-op.

## 5. SCENARIOS — born-verifiable main objectives

```
Given aggregate.mjs is invoked directly as a CLI from a working directory whose path contains a URL-special character (e.g. "×")
When a valid single-lens refutation JSON is piped to it on stdin with --n 1
Then main() runs and it writes a faff-contract:spec-review-verdict block to stdout (exit 0 with a non-empty block — never a silent empty exit 0)
```

```
Given aggregate.mjs is imported as a module (as test/spec-refute-aggregate.test.mjs does)
When the module is loaded
Then the entrypoint guard evaluates false and main() does not run (the pure exports import cleanly, no side effects)
```

## 6. DESIGN DECISION RATIONALE

**How should the CLI-entrypoint guard detect direct invocation?**

- **Hand-built `file://`-plus-`process.argv[1]` string** (status quo) — under-encodes URL-special chars; equality silently breaks on such paths → silent no-op. Rejected.
- **`pathToFileURL(process.argv[1]).href`** — stdlib-canonical, percent-encodes to match `import.meta.url`. **Chosen** — exactly the fix the ticket prescribes; zero new dependencies (`node:url` is stdlib).

At the time of writing, `aggregate.mjs` is the only file in the repo using the fragile pattern, so no shared helper is warranted.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the fix is fully specified by the ticket and grounded in the code.

**Assumptions:**

- **Assumes:** `node:url`'s `pathToFileURL` is available. Validation: it is Node stdlib (repo runs Node ≥ 22); no install needed.

## 8. DONE — Definition of Done

### From WHY
- [ ] Invoking `aggregate.mjs` directly from a path containing a URL-special char runs `main()` (guard fires) rather than exiting 0 with empty stdout.

### From WHAT / HOW (behaviour)
- [ ] The line-212 guard reads `import.meta.url === pathToFileURL(process.argv[1]).href`.
- [ ] `pathToFileURL` is imported from `node:url`.
- [ ] No hand-built `file://`-prefixed entrypoint-guard string remains in `aggregate.mjs`.

### From HOW (edge cases)
- [ ] Importing `aggregate.mjs` (as the test does) still does not run `main()` — the guard stays false; existing pure-function tests pass unchanged.

### Regression test
- [ ] A test in `test/spec-refute-aggregate.test.mjs` spawns `aggregate.mjs` as a CLI from a temp dir whose path contains a URL-special char, pipes a valid single-refutation JSON with `--n 1`, and asserts exit 0 **with a non-empty `faff-contract:spec-review-verdict` block** (fails against the pre-fix guard, passes after).

### Full suite
- [ ] `aggregate.mjs --selftest` and the existing `test/spec-refute-aggregate.test.mjs` cases pass.

**Integration smoke test:**

```
1. Create temp dir "/tmp/faff-×-<rand>" reachable to the repo checkout.
2. From that dir: printf '[{"lens":"architectural","outcome":"clear","objections":[]}]' | node <path>/aggregate.mjs --n 1
3. Assert: exit 0 AND stdout contains "faff-contract:spec-review-verdict".
```

confidence: high
