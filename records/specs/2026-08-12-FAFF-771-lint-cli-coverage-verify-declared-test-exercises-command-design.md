# FAFF-771 — lint-cli-coverage: verify the declared test file exercises the command, not merely that it exists

> Spec: faffter-dark-nlspec · 2026-08-12 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-771.
> build-tier: complex
> spec-review: approve

## Already shipped against this surface

- **FAFF-581** (Done, PR #605, "registry-derived CLI selftest battery, coverage gate, worktree-prune in CI, publish-only coverage") — shipped `lint-cli-coverage` itself: the registry-derived `uncovered`/`orphaned` checks plus the `fs.existsSync` **existence** check on `TEST_FILE_COVERAGE` files. Its ACs were registry-membership + existence only; **content-exercise was explicitly out of scope**. FAFF-771's delta (assert the declared file *invokes* the command token) is exactly the gap FAFF-581 left — premise still load-bearing.
- Related test-governance gates already Done (context, not superseding): FAFF-237 (`docs/cli.md` covers every subcommand — `lint-cli-doc`), FAFF-281 (eval-coverage gate in validate-adapters), FAFF-92/FAFF-91 (CLI test-runner coverage). None deliver the coverage-file content-exercise check.

---

This is the nlspec-format design spec for **FAFF-771** — _lint-cli-coverage: verify the declared test file exercises the command, not merely that it exists_. Audience: the build agent who will implement the gate change, and the human reviewers gating this spec. It is a design document (WHY / OUT OF SCOPE / WHAT / HOW / SCENARIOS / DONE), not step-by-step code; the build agent translates the pseudocode into the repo's zero-dependency Node CLI style.

## 1. WHY — Problem and Principles

**The load-bearing model.** `lint-cli-coverage` proves a claim of the form "command X is tested by file F". Today it only proves *F exists on disk* — not that *F actually drives X*. This change adds the missing half: read F and confirm it invokes X as a CLI subcommand. The whole gate turns on the difference between a file's **existence** and a file's **exercise of a command** — a declaration that names a real file which no longer runs the command is a stale, silently-passing lie, and closing that gap is the entire ticket.

**Problem statement.** The `TEST_FILE_COVERAGE` map (in `plugin/skills/faff/bin/lib/lint-cli-coverage.js`) declares, for each deliberately-no-standalone-selftest command, the `test/*.mjs` file that exercises it — and the gate asserts only `fs.existsSync` on that path. A declared file that is renamed's target, emptied, or repurposed to test something else still passes, so a coverage declaration can rot to a false claim undetected (this is a fail-open axis found by FAFF-581's own adversarial review). This change makes the gate additionally assert that the declared file *references the command as a CLI invocation*, so the declaration cannot go stale in silence.

**Design principles.**

- **Structural match, never a naive substring — the FAFF-581 crux.** The gate's own header comment (§3) forbids grep-guessing coverage because "an incidental string mention would read as coverage and the gate would fail OPEN." A `text.includes("sync")` content check would reintroduce exactly that failure. The new check must anchor the command token to an *argv/call position* (a quoted token that is an element of a spawn/run argument list), so a mention in a comment or in unrelated prose does not count.
- **Fail-closed, mirroring the sibling gate.** FAFF-771 says explicitly "keep it fail-closed." The new content check reads file contents; an IO error while reading a file that exists is a hard tooling failure (exit 2), not a silent pass. This deliberately does *not* inherit the existing existence check's fail-open `catch { exists = true }` precedent.
- **Must pass all five declared files today — a hard constraint.** The five current declarations (`sync`, `validate-adapters`, `labels`, `state`, `doctor`) all exercise their command through a subprocess spawn, but via *heterogeneous* call shapes (see Reference context). The chosen matcher MUST accept all five as-is; a matcher strict enough to false-fail any of them is wrong by construction.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/lint-cli-coverage.js` | Node (CJS) | The gate being extended; existence check at L77–82, `ok` at L84, exports at L145 |
| `plugin/skills/faff/bin/lib/lint-cli-doc.js` | Node (CJS) | The mirror: `parseDocumentedCommands` reads content and parses a structured token set with an anchored regex; exit 2 on unreadable file. The pattern FAFF-771 follows |
| `test/helpers/run-cli.mjs` | Node (ESM) | Shared `runCli([cmd, ...])` spawn seam most declared tests use |
| `test/lint-cli-coverage.test.mjs` | Node (ESM) | Current gate test — real-tree only, **no** fixture negative harness yet |
| `test/lint-cli-doc.test.mjs` | Node (ESM) | The `runOnDoc` fixture harness (temp root → fabricated file → `--root` → assert exit + named offender) to mirror |

The five declared files exercise their command as a quoted token in a spawn argument list, in three distinct shapes verified in-tree:

| Command | Declared file | Invocation shape (verified) |
|---|---|---|
| `sync` | `test/sync.test.mjs` | `run(["sync", "--dry-run", …])` and `execFileSync("node", [cliCopy, "sync"])` |
| `validate-adapters` | `test/validate-adapters-prose-defaults.test.mjs` | `spawnSync(process.execPath, [BIN, "validate-adapters", …])` |
| `labels` | `test/claim-verdict.test.mjs` | `runCli(["labels"])` |
| `state` | `test/cli-coverage.test.mjs` | `runCli(["state", …])` |
| `doctor` | `test/doctor.test.mjs` | `run("doctor", "--target", …)` — bare first arg, **no array** |

**Scope statement.** This is a hardening of one existing CI gate (`.github/workflows/validate.yml` L105); it changes no command's public behaviour and adds no new subcommand.

## 2. OUT OF SCOPE

- **Auto-discovery of coverage by grep.** Excluded — this issue *keeps* the explicit `TEST_FILE_COVERAGE` declaration model (FAFF-581 §3). Why: the whole design premise is declared-not-guessed; the content check verifies an *existing* declaration, it never manufactures one. Extension point: none intended — auto-discovery is a rejected direction, not a deferred one.
- **Asserting the test file actually *passes* / covers meaningful assertions.** Excluded — that is the job of the test suite and coverage aggregator (`scripts/coverage-aggregate.mjs`), not a static lint. Why: statically proving a test is *effective* is undecidable; this gate proves only that the declared file *references the command as an invocation*. Extension point: the V8-coverage aggregator already measures executed lines per FAFF-581.
- **Multi-token command invocations (e.g. `config get`).** Excluded — every current `TEST_FILE_COVERAGE` key is a single `[a-z-]` token, so the matcher checks only the first token. Why: no declared key is multi-word today. Extension point: if a future multi-word command is declared, extend the matcher to check the token *sequence*; noted in HOW.
- **Tightening the pre-existing existence check's fail-open `catch { exists = true }`.** Excluded from the hard requirement — see Open Questions (a `**Punt:**`). Why: it is a separable pre-existing behaviour on a call (`fs.existsSync`) that does not normally throw; folding it in risks scope creep. Extension point: same function, `missingFiles` loop at L78–82.
- **Extending the same content check to selftest-covered (non-null `REGION_SELFTEST_ARGV`) commands.** Excluded — those are exercised by the region selftest sweep, which *runs* them; existence/exercise of a `test/*.mjs` file is not the coverage mechanism for them. Why: different coverage axis. Extension point: `regions selftest`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Declaration | An entry `cmd → relPath` in `TEST_FILE_COVERAGE` claiming `relPath` exercises `cmd` |
| Exercises | The declared file's text contains the command token as a quoted string in an argv/call position (not merely anywhere) |
| Stale declaration | A declaration whose file exists but no longer exercises the command — the fail-open axis this closes |
| Argv position | A quoted token immediately preceded (ignoring whitespace) by `[`, `(`, or `,` — i.e. an element of a call/array argument list |

**New pure function (exported, mirrors `parseDocumentedCommands`/`hasSelftest`):**

```
FUNCTION exercisesCommand(fileText: String, cmd: String) -> Boolean
  # True iff `cmd` appears in fileText as a quoted token in an argv/call position.
  # Pure, filesystem-free, deterministic — the unit under selftest.
  RETURN  ARGV_TOKEN_REGEX(cmd).test(fileText)
```

where the structural matcher is:

```
ARGV_TOKEN_REGEX(cmd) = new RegExp( "[\\[(,]\\s*(['\"])" + escapeRegex(cmd) + "\\1" )
  # A quoted token exactly equal to cmd (same opening/closing quote via backref),
  # immediately preceded by '[', '(', or ',' — an argv element or a call's first arg.
  # escapeRegex escapes regex metachars; cmd is [a-z-] today so only defensive.
```

**Violation surface (new array, folded into the existing verdict shape).**

```
RECORD CoverageVerdict:            # the --json payload, extended
  ok: Boolean                      # AND of all violation arrays being empty
  commands: Int
  uncovered: String[]              # unchanged (FAFF-581)
  orphaned: String[]               # unchanged (FAFF-581)
  missingFiles: String[]           # unchanged — "cmd → rel" for declared-but-absent
  notExercised: String[]           # NEW — "cmd → rel" for exists-but-does-not-exercise

  CONSTRAINT ok == (uncovered.length==0 AND orphaned.length==0
                    AND missingFiles.length==0 AND notExercised.length==0)
```

**Exit contract (unchanged categories, one new trigger).** `0` clean · `1` any violation array non-empty (every offender named) · `2` hard tooling failure — now including *a declared file that exists but cannot be read*.

**Design decision — matcher strictness.** Options: (a) quoted token in argv position (regex anchored to `[`/`(`/`,`); (b) any standalone quoted token `"cmd"` anywhere; (c) a shared full CLI-call scanner. **Chosen:** (a) — see Design Decision Rationale.

## 4. HOW — Behavior

**Architecture and approach.** Add one pure helper `exercisesCommand(text, cmd)` next to `hasSelftest`/`diffCoverage`, export it, and extend the file loop in `cmdLintCliCoverage` (currently L77–82) so that for each declaration it: checks existence (unchanged → `missingFiles`); if present, reads the file (fail-closed on read error → exit 2); then applies `exercisesCommand` (false → `notExercised`). Fold `notExercised` into `ok`, into the `--json` payload, and into the human FAIL output. Extend `lintCliCoverageSelftest` with positive/negative cases for the new helper, and add a fixture-based negative harness to `test/lint-cli-coverage.test.mjs`.

**Behavior summary.** For every coverage declaration, the gate now answers two questions instead of one: does the file exist, and does it invoke the command — surfacing a stale declaration as a named, fail-closed violation.

```
PROCEDURE check_declarations(root, TEST_FILE_COVERAGE):
  missingFiles := []
  notExercised := []
  FOR EACH (cmd, rel) IN TEST_FILE_COVERAGE:
    full := path.join(root, rel)
    IF NOT fs.existsSync(full):
       a. missingFiles.push(`${cmd} → ${rel}`)      # unchanged; do NOT read
       b. CONTINUE
    TRY:
       text := fs.readFileSync(full, "utf8")
    CATCH readError:                                 # file exists but unreadable
       a. emit hard-tooling-failure message naming full
       b. RETURN exitCode 2                          # FAIL-CLOSED — never a silent pass
    IF NOT exercisesCommand(text, cmd):
       a. notExercised.push(`${cmd} → ${rel}`)
  RETURN { missingFiles, notExercised }
```

```
PROCEDURE verdict_and_output(uncovered, orphaned, missingFiles, notExercised, json):
  1. ok := uncovered==[] AND orphaned==[] AND missingFiles==[] AND notExercised==[]
  2. IF json: print { ok, commands, uncovered, orphaned, missingFiles, notExercised }; RETURN ok?0:1
  3. IF ok: print PASS line (extend wording: "…every one selftest- or exercised-test-file-covered"); RETURN 0
  4. print one FAIL line per offender in each array, e.g.:
       "FAIL  ✗ stale coverage: ${cmd} → ${rel} (file exists but does not invoke ${cmd} as a subcommand)"
  5. write stderr summary including notExercised.length; RETURN 1
```

**Edge cases and error handling.**

- **Declared-but-absent file:** `missingFiles`, exit 1 — unchanged; the read is not attempted, so absence never reaches the exit-2 path.
- **Present-but-unreadable file:** exit 2 (hard tooling failure). Precedence: existence is checked first, so only genuine read errors hit exit 2. **uid-robust inducer for the test:** point the declared coverage path at a **directory** (or a path whose parent is a file) so `fs.existsSync` returns true but `readFileSync` throws `EISDIR` **regardless of uid** — a `chmod 000` inducer is bypassed by root, which is common in CI containers, and would silently degrade the exit-2 case to a non-test.
- **Token as a substring of a longer token** (`"stateful"`, `"sync-status"`, `"prestate"`): no match — the backref requires a closing quote *immediately* after `cmd`, and the anchor requires an opening quote immediately before it, so only the exact quoted token matches.
- **Token only in prose/comment** (`// exercises the sync command`, or bare `"sync failed"` where the quote is not closed right after the token): no match — not in argv position / not an exact closed token.
- **Belt-and-braces declaration for a command that also has a non-null selftest:** unchanged — still allowed; the content check applies uniformly and passes because the file does invoke the command.
- **`--root` fixture semantics:** as today, `uncovered`/`orphaned` derive from the compiled `COMMANDS`/`REGION_SELFTEST_ARGV` (root-independent); only the file existence/exercise checks read from `root`. Fixture tests therefore control only the file side.

**Failure modes.**

- **The failure:** the argv-position regex is a heuristic for "invokes the command", not a proof; a quoted token equal to `cmd` sitting in an unrelated *data* array (`["doctor", "who"]`) would match without being a CLI invocation, i.e. a residual (much narrower) fail-open. **How you'd know:** a declaration passes the gate while the file demonstrably never spawns the command — caught only by human review or by the command later showing zero executed lines in the V8 coverage roll-up. **What it means:** proceed — this residual is strictly smaller than today's existence-only check and than a naive substring, and it is the FAFF-581-aligned "structural, not grep" answer; accepted, not a gap to close in this issue.
- **The failure:** the five real files use three different call shapes; a regex tuned to one shape silently false-fails another (e.g. missing the bare `run("doctor", …)` form because it assumed an array). **How you'd know:** the real-tree test (`--root REPO`) goes red naming a real command as `notExercised`. **What it means:** narrow — the matcher must admit the `[`, `(`, and `,` prefixes together; the real-tree green test is the guard that this holds.

**Anti-pattern:** `text.includes(cmd)` or `text.includes('"'+cmd+'"')` unanchored. Why: reintroduces the incidental-mention fail-open the gate's own header forbids (FAFF-581 §3).
**Anti-pattern:** making the content check fail *open* on read error (`catch { /* pass */ }`) to match the existence check's style. Why: FAFF-771 explicitly requires fail-closed; a swallowed read error is a silent pass.
**Anti-pattern:** parsing the test file's AST or importing it. Why: over-engineered and fragile for a zero-dependency lint (ADR 0002); a structural regex over text is sufficient and matches the sibling `lint-cli-doc`.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the live repository tree (all five declared files invoke their command)
When `faff lint-cli-coverage` runs
Then it exits 0 and prints PASS — the content check false-fails none of the five heterogeneous call shapes
```

```
Given a --root fixture where a declared file exists but its body invokes no command (e.g. only a comment mentioning the token)
When `faff lint-cli-coverage --root <fixture>` runs
Then it exits 1 and names that "cmd → rel" as a stale/not-exercised coverage violation
```

- `exercisesCommand` MUST return true for each verified invocation shape: `["sync"`, `[BIN, "validate-adapters"`, `runCli(["labels"])`, `["state",`, and the bare `run("doctor",`.
- `exercisesCommand` MUST return false for an incidental mention (token in a comment / unclosed string) and for a longer token that merely contains the command as a substring.

## 6. Design Decision Rationale

**How strict should "exercises the command" be?**
- (a) Quoted token in argv position — anchored regex `[[(,]\s*(['"])cmd\1`. Pro: rejects prose/comment mentions; admits all three real call shapes (array-first, array-later, bare-arg); zero-dependency; mirrors `lint-cli-doc`'s anchored-regex philosophy. Con: a quoted token in an unrelated data array still matches (bounded residual).
- (b) Any standalone quoted `"cmd"` anywhere. Pro: simplest. Con: matches quoted mentions in comments/strings — closer to the forbidden fail-open.
- (c) Shared full CLI-call scanner / AST. Pro: most precise. Con: over-engineered, fragile, adds surface for a lint; violates the zero-dep simplicity bar.

**Chosen:** (a) — it is the smallest change that is *structural, not substring* (satisfying FAFF-581 §3), provably admits all five declared files, and stays within the zero-dependency house style. The residual (a) leaves is strictly smaller than (b) and than today's existence-only check.

**How should an IO error be handled?**
- Inherit the existence check's fail-open `catch → pass`. Con: violates FAFF-771's explicit "keep it fail-closed."
- Treat a read error on an existing file as a hard tooling failure (exit 2), mirroring `lint-cli-doc`'s unreadable-doc behaviour.

**Chosen:** exit 2 on read error — fail-closed, consistent with the sibling gate; a declared file that exists but cannot be read is a real tooling problem, never a silent pass.

**Where should the violation surface?**
- Reuse `missingFiles`. Con: conflates "absent" with "present-but-stale" — worse diagnostics.
- A distinct `notExercised` array folded into `ok`, `--json`, and the FAIL output.

**Chosen:** distinct `notExercised` array — keeps the two failure kinds separately named for the operator, matching how `uncovered`/`orphaned`/`missingFiles` are already distinct.

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** Should this issue *also* tighten the pre-existing existence-check `catch { exists = true }` (L80) to fail-closed, or leave it as a separable follow-up? The new content check is fail-closed regardless; the question is only whether to harden the adjacent legacy branch in the same PR. Recommendation: leave as-is to keep scope tight, since `fs.existsSync` does not normally throw — but a reviewer may prefer folding it in. *(decides: any)*

**Assumptions.**

- **Assumes:** the de-facto convention holds — every declared test exercises its command as a quoted token in a spawn/run argument list. Validation: the build agent runs `faff lint-cli-coverage` against the real tree after implementing; all five must pass (this is the hard AC and the guard). If any real file uses a call shape outside `[`/`(`/`,`-prefixed quoting, widen the anchor before landing.
- **Assumes:** all `TEST_FILE_COVERAGE` keys remain single `[a-z-]` tokens. Validation: the matcher checks one token; if a multi-word key is ever declared, the OUT-OF-SCOPE extension point applies.

## 8. DONE — Definition of Done

### From WHY
- [ ] A declared file that exists but no longer invokes its command is reported as a violation (previously passed) — demonstrated by a fixture test.
- [ ] The check is structural (argv-position), not a naive `includes` — an incidental token in a comment/string does not satisfy coverage.

### From WHAT (types and interfaces)
- [ ] `exercisesCommand(fileText, cmd)` exists, is pure/filesystem-free, and is added to the module's `module.exports` (alongside `diffCoverage`/`hasSelftest`).
- [ ] `--json` payload includes a `notExercised: string[]` field of `"cmd → rel"` entries, and `ok` is the AND of `uncovered`/`orphaned`/`missingFiles`/`notExercised` all being empty.

### From HOW (behaviour)
- [ ] For each declaration: absent file → `missingFiles` (exit 1, read not attempted); present file read-error → exit 2; present file not exercising the command → `notExercised` (exit 1).
- [ ] Human output prints one FAIL line per `notExercised` offender naming `cmd → rel` and the reason ("file exists but does not invoke `cmd`"), and the stderr summary counts include `notExercised`.
- [ ] The PASS line wording reflects "exercised" coverage, not mere existence.

### From HOW (edge cases)
- [ ] `exercisesCommand` returns true for all five verified shapes (`["sync"`, `[BIN, "validate-adapters"`, `["labels"]`, `["state",`, `run("doctor",`).
- [ ] `exercisesCommand` returns false for a substring token (`"stateful"`, `"sync-status"`) and for a prose/comment mention.
- [ ] The live repo tree still passes: `faff lint-cli-coverage` exits 0 (hard AC).

### From tests (DoD)
- [ ] `lintCliCoverageSelftest` gains positive + negative `exercisesCommand` cases (mirroring `lintCliDocSelftest`'s FP guards) and still passes via `regions selftest --region factory`.
- [ ] `test/lint-cli-coverage.test.mjs` gains a fixture harness (mirroring `runOnDoc`) with: a not-exercised negative case (exit 1, offender named), an unreadable-file case (exit 2) induced **uid-robustly** — declare the coverage path as a **directory** so `readFileSync` throws `EISDIR` regardless of uid (do NOT rely on `chmod 000`, which root bypasses in CI containers) — and a `--json` assertion that `notExercised` is `[]` on the real tree.

**Integration smoke test.**

```
1. Build a temp root; mirror the real TEST_FILE_COVERAGE files into it
   (copy each declared file from REPO so the list can change without editing the test).
2. Overwrite exactly ONE mirrored file with a body that mentions the command only in a comment.
3. Run `faff lint-cli-coverage --root <tmp> --json`.
4. ASSERT exit == 1, parsed.ok == false, and parsed.notExercised contains that one "cmd → rel".
5. ASSERT no other array (uncovered/orphaned/missingFiles) reports that command.
```

confidence: medium