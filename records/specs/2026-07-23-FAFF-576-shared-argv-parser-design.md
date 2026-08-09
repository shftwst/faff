# Shared argv parser for the faff CLI — fail-closed flag handling across all subcommands

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-576.

This spec addresses FAFF-576. It is written for the build agent implementing the change and for human reviewers. It replaces ~40 copy-pasted, fail-open argv-reading snippets in `plugin/skills/faff/bin/lib/` with one declared-flags parser, so that an unknown flag or a value-flag missing its value is rejected with exit 2 instead of silently accepted.

## 1. WHY — Problem and Principles

**The load-bearing model.** Every faff subcommand today reads its flags by scanning the raw `args` array with `args.indexOf(flag)` and taking the *next* array element as the value. That scan has two blind spots baked in: a flag it doesn't recognise is simply never looked for (so an unknown flag is invisible, never rejected), and `args[i+1]` is taken as the value with no check that a value is actually there (so a value-flag immediately followed by another flag binds that flag-looking token as its value). One declared-flags parser — the subcommand states which flags it accepts and each flag's arity — closes both blind spots in a single place, and every migrated subcommand inherits the fix.

**Problem statement.** The faff CLI is fail-closed on flag *values* (closed enums everywhere — `L1|L2|L3|L4`, `opt-in|opt-out`) but fail-open on the *flags themselves*: `faff next --status done --spec high --bogus-flag-xyz` exits 0 with normal output, and `faff reconcile --run-dir --json --level L3` binds the string `"--json"` as the run-dir value and silently loses the `--json` flag (both verified live at HEAD 4c3bce0). In a CLI whose flags flip gate verdicts (`--not-eligible`, `--recover`, `--parked`), a typo'd flag is a silent no-op that can change an automation decision. This change makes the flag surface fail-closed: an unknown flag or a missing value is a loud exit 2.

**Design principles.**

**One parser, declared per subcommand — never a per-site heuristic.** The fix is a single shared parser plus a per-subcommand flag *declaration*; it is explicitly not a smarter copy-pasted snippet. If a reviewer sees a new `args.indexOf("--foo")` value-read added to a migrated command, that is a regression regardless of whether it happens to work.

**Valid input behaviour is preserved byte-for-byte.** The change only *adds* rejection of input that is already malformed (unknown flag, missing value). Any invocation that produces correct output today must produce identical output after migration. The only observable behaviour change is on input that is already a latent bug.

**Fail-closed on ambiguity.** Where the old code silently guessed (missing value, duplicate of a single-valued flag, an out-of-enum value), the parser rejects with exit 2 and a usage message rather than guessing. This is the whole point of the ticket; the parser never invents a lenient fallback.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node CJS | Dispatch shell — `main(argv)` peels `[sub,...rest]`, calls `COMMANDS[sub](rest)`; already exits 2 on an unknown subcommand (the exit-2 convention this extends to flags) |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node CJS | The shared-primitive tier (path anchors, YAML parse, ledger read). The new parser joins this tier as a sibling module |
| `plugin/skills/faff/bin/lib/eligible.js` | Node CJS | Reference migration shape — a small `cmdXxx(args)` with a `--selftest` short-circuit, a value-flag `get` closure, and a repeated `--label` loop |
| `plugin/skills/faff/bin/lib/adr.js` | Node CJS | Home of the exported `adrFlag` helper (line 390), imported by 5 modules — a shared fail-open reader to retire |
| `plugin/skills/faff/bin/lib/lint-cli-doc.js` | Node CJS | Registry-driven lint (COMMANDS ↔ docs). Sibling pattern for the completion-gate fuzz test |

**Scope statement.** This sits at the CLI input boundary — the seam between raw `process.argv` and every subcommand handler in `bin/lib/`. It changes how flags are parsed, not what any subcommand does with them.

## 2. OUT OF SCOPE

- **Restructuring the subcommand dispatch / COMMANDS registry.** Why excluded: the dispatch shell in `bin/faff` is correct and already exits 2 on unknown subcommands; only the per-handler flag reads change. Extension point: handlers keep their `cmdXxx(args)` signature.
- **A `--key=value` general option syntax as the primary form.** Why excluded: the CLI is space-separated (`--flag value`) throughout and no caller uses `=`-form for flags today; the parser *accepts* `=`-form as an escape hatch (§3) but migration does not rewrite any call site to use it. Extension point: the parser's tokeniser already splits on the first `=`.
- **Migrating boolean-presence checks that are not flag inputs.** Why excluded: `args.includes("--selftest")` / `args.includes("--hook")` pre-parse short-circuits are control-flow, not value reads; they stay, but the flags they test must still be *declared* in the command's spec so the unknown-flag check does not reject them (§4).
- **FAFF-577 (malformed base `.faffrc.yaml` → degraded ceilings).** Why excluded: same fail-closed-input *outcome*, different *surface* (YAML config parse, not argv) and no shared code path. Extension point: `shared-infra.js` `parseYamlSubset` / `hasMeaningfulYamlContent`; tracked separately on FAFF-577.
- **Localisation / help-text generation from specs.** Why excluded: usage strings already live in `bin/faff` USAGE and `docs/guide/cli.md`; auto-generating them from the flag specs is a future convenience. Extension point: a spec → usage-line renderer.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Flag | A `--name` (or short `-x`) token on the command line |
| Value-flag | A flag that consumes the following token as its value (arity 1), e.g. `--run-dir DIR` |
| Boolean flag | A flag whose mere presence is the signal (arity 0), e.g. `--json` |
| Positional | A non-flag token consumed by position, e.g. the `get` in `config get KEY`, or a run-dir argument |
| Command spec | The per-subcommand declaration of accepted flags + positional arity the parser validates against |

**Type definitions.**

```
RECORD FlagSpec:
  arity: 0 | 1                 # 0 = boolean (presence), 1 = takes exactly one value
  enum: List<String>?          # optional closed value set; value only valid if a member (arity-1 only)
  repeatable: Boolean          # default false; true ⇒ value collected into a list, flag may appear >1×
  aliases: List<String>?       # alternate spellings, e.g. ["-d"] for --default, ["--held"] for a deprecated alias

RECORD CommandSpec:
  flags: Map<canonicalFlagName, FlagSpec>   # keyed by the canonical "--name"
  positionals: { min: Int, max: Int|null, name: String }?   # null max = unbounded; omit ⇒ {min:0,max:0}
  # nested sub-verbs (config get / label add) are handled by the HANDLER, not the parser:
  # the handler reads positionals[0] as the verb, selects the per-verb CommandSpec, re-parses the rest

RECORD ParseResult:
  values: Map<canonicalFlagName, String | List<String> | true>
    # boolean present ⇒ true; value-flag ⇒ its String (or List<String> if repeatable); absent ⇒ key not present
  positionals: List<String>
  errors: List<ParseError>     # empty ⇒ success

RECORD ParseError:
  code: "unknown-flag" | "missing-value" | "bad-enum" | "duplicate-flag" | "too-many-positionals" | "too-few-positionals"
  flag: String?                # the offending flag, when applicable
  detail: String               # human-readable, for the usage message
```

**Interfaces.**

```
# The pure parser — no I/O, no process.exit. This is what the selftest table exercises.
FUNCTION parseArgs(argv: List<String>, spec: CommandSpec) -> ParseResult

# The thin emit-and-exit helper handlers call on a non-empty errors list.
# Writes the formatted errors + the command's usage line to stderr, returns 2.
FUNCTION usageError(errors: List<ParseError>, usage: String) -> 2
```

Both are exported from the new module and imported by handlers exactly as `shared-infra` helpers are imported today.

**Design decisions.**

- **Module home.** **Chosen:** a new sibling module `plugin/skills/faff/bin/lib/argv.js`, joining the shared-primitive tier alongside `shared-infra.js`, imported directly by handlers (`const { parseArgs, usageError } = require("./argv")`). Rationale: FAFF-441 established one module per concern; `shared-infra.js` is already ~515 lines of path/config/ledger primitives and argv parsing is a distinct concern. The ticket's "in shared-infra" names the shared-primitive *layer*, which `argv.js` joins — it does not require folding the code into that one file. (Optionally re-export the two functions from `shared-infra.js` for a single import point; not required.)

- **Parse returns, handler exits.** **Chosen:** `parseArgs` is pure and returns a `ParseResult`; the handler checks `result.errors` and calls `usageError(...)` to emit + return 2. Rationale: every `cmdXxx` handler already returns an integer exit code and the codebase does not throw for usage errors; a pure parser is also what the `--selftest` case table can exercise without spawning a process. Rejected: throwing a typed error caught in `main()` — it would centralise usage strings away from the handler that owns them and diverge from the return-int convention.

- **Missing-value detection.** **Chosen:** an arity-1 flag whose next token is absent, or begins with `--`, is a `missing-value` error. Rationale: no value in this CLI's vocabulary (issue ids, paths, ISO dates, closed enums, gitkeys) begins with `--`, so a `--`-prefixed successor is unambiguously the next flag, not a value — this is exactly the `reconcile --run-dir --json` bug. A single-dash `-x` token is treated as a possible short-flag/alias, not a value, on the same basis.

- **Escape hatch for `--`-leading values.** **Chosen:** accept `--flag=value` form in the tokeniser (split on the first `=`), so a value that must begin with `--` can still be passed. Rationale: removes the one ambiguity the missing-value rule introduces, at trivial cost, without requiring any call site to adopt it.

- **Duplicate of a single-valued flag.** **Chosen:** a non-`repeatable` value-flag appearing more than once is a `duplicate-flag` error (exit 2), not silent last-/first-wins. Rationale: the whole ticket is fail-closed-on-ambiguity; `args.indexOf` silently took the *first*, so a second occurrence was a silent no-op — precisely the class being retired. Repeatable flags (`--label`, `--run-dir` on governance-check, `--present-label`) declare `repeatable: true` and collect into a list.

- **Unknown-flag scope.** **Chosen:** any token beginning with `-` that is neither a declared flag/alias nor a declared flag's `=`-form, and is not the bare `--`/`-` sentinels, is an `unknown-flag` error. Positionals (non-`-` tokens) are never "unknown" — they are collected and validated against `positionals` arity. Rationale: keeps positional-taking commands (`config get KEY`) working while catching typo'd flags.

- **`--selftest` / `--hook` interaction.** **Chosen:** the existing `if (args.includes("--selftest")) return …Selftest()` (and `--hook`) short-circuits stay *before* `parseArgs`; every command that accepts these still declares them as arity-0 flags in its spec, so a combined invocation that reaches the parser (e.g. `--hook --json`) does not trip unknown-flag. Rationale: preserves today's control flow with zero behaviour change on the short-circuit path.

## 4. HOW — Behavior

**Architecture and approach.** `argv.js` exports `parseArgs` + `usageError`. Each `cmdXxx(args)` handler is migrated to: (1) keep any `--selftest`/`--hook` short-circuit, (2) build (or reference a module-level constant) its `CommandSpec`, (3) call `parseArgs(args, SPEC)`, (4) on `errors.length` return `usageError(errors, USAGE)`, (5) read typed values from `result.values` / `result.positionals` instead of ad-hoc `indexOf`. Sub-verb commands select the per-verb spec from `positionals[0]` then parse the remainder.

**The parse procedure.**

```
PROCEDURE parseArgs(argv, spec):
  values := {}; positionals := []; errors := []
  seen := {}                                  # flag → times seen (for duplicate detection)
  i := 0
  WHILE i < argv.length:
    tok := argv[i]
    IF tok == "--":                           # explicit end-of-flags sentinel
       positionals.push(all remaining argv[i+1..]); BREAK
    IF tok starts with "-" AND tok != "-":
       (name, inlineValue) := split tok on first "=" (inlineValue = null if no "=")
       decl := resolve name (or its alias) in spec.flags
       IF decl is null:
          errors.push({unknown-flag, flag:name}); i++; CONTINUE
       canonical := decl's canonical name
       seen[canonical] := (seen[canonical] or 0) + 1
       IF seen[canonical] > 1 AND NOT decl.repeatable:
          errors.push({duplicate-flag, flag:canonical}); # continue parsing to collect all errors
       IF decl.arity == 0:
          IF inlineValue != null: errors.push({bad-arity, flag:canonical, "takes no value"})
          values[canonical] := true; i++
       ELSE  # arity 1
          value := inlineValue
          IF value == null:
             next := argv[i+1]
             IF next == undefined OR next starts with "--":
                errors.push({missing-value, flag:canonical}); i++; CONTINUE
             value := next; i += 2
          ELSE i++
          IF decl.enum AND value NOT IN decl.enum:
             errors.push({bad-enum, flag:canonical, detail: value + " not in " + decl.enum})
          IF decl.repeatable: values[canonical] := (values[canonical] or []).append(value)
          ELSE values[canonical] := value
    ELSE:
       positionals.push(tok); i++
  # positional arity
  IF spec.positionals:
     IF positionals.length < spec.positionals.min: errors.push({too-few-positionals})
     IF spec.positionals.max != null AND positionals.length > spec.positionals.max: errors.push({too-many-positionals})
  ELSE IF positionals.length > 0: errors.push({too-many-positionals})
  RETURN { values, positionals, errors }
```

```
PROCEDURE usageError(errors, usage):
  FOR e IN errors: write to stderr "faff: " + format(e)
  write to stderr usage
  RETURN 2
```

**Behavior summary.** `parseArgs` walks the args once, classifying each token as sentinel / flag / positional, validating arity + enum + duplicates, and accumulating *all* errors (not fail-fast) so one invocation reports every problem. It performs no I/O and never exits; the handler decides what to do with a non-empty `errors` list.

**Edge cases and error handling.**

- Bare `-` (stdin convention) and `--` (end-of-flags) are sentinels, never unknown flags.
- Multiple errors accumulate; `usageError` prints them all before the usage block. All error paths return exit 2 (the established usage/malformed code) — retryable only by the human fixing the command line; terminal to the run.
- An arity-0 flag given `=value` (`--json=x`) is an error (boolean takes no value).
- A repeatable flag absent entirely ⇒ its key is absent from `values` (handlers default to `[]`).

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** a migrated command silently changes valid-input behaviour (e.g. a flag that used to accept a value beginning with `-` from a real caller). **How you'd know:** an existing `test/*.test.mjs` that drives the CLI via child_process flips from pass to fail, or a beep-boop run errors on a command that worked before. **What it means:** narrow — that command's spec is wrong (a flag mis-declared arity/enum), fix the spec, not the parser.
- **The failure:** an existing test *codified* the fail-open behaviour (asserted that `--run-dir --json` binds `"--json"`, or that a bogus flag exits 0). **How you'd know:** that test fails after migration. **What it means:** proceed — the test asserted the bug; update it to expect exit 2. Audit the 118-file suite for such assertions during migration.
- **The failure:** the migration is incomplete — some subcommand still fail-open. **How you'd know:** the registry-driven fuzz test (§8) reports that subcommand's `--bogus` invocation exiting 0. **What it means:** proceed — migrate the named command; the test is the mechanical checklist.

**Anti-pattern:** adding a fresh `args.indexOf("--foo")` value read to a migrated handler. Why: it reintroduces the exact fail-open class in a command that was fixed, invisible to the spec. **Anti-pattern:** a "universal" spec shared across unrelated commands. Why: unknown-flag rejection depends on each command declaring *only* the flags it actually accepts; a catch-all spec defeats the check.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a subcommand migrated to parseArgs with a declared flag set
When it is invoked with a flag not in that set (e.g. `faff next --status done --bogus-flag-xyz`)
Then it exits 2 and writes a usage message naming the unknown flag (today: exit 0, normal output)
```

```
Given a value-flag (arity 1) whose next token is another flag or end-of-args
When invoked as `faff reconcile --run-dir --json --level L3`
Then it exits 2 with a missing-value error for --run-dir (today: binds "--json" as the run-dir, drops --json)
```

```
Given a value-flag declared with an enum
When invoked with an out-of-enum value (e.g. `--level L9`)
Then it exits 2 with a bad-enum error naming the accepted set
```

- The parser accumulates and reports every error in one pass (not fail-fast on the first).
- A repeatable flag given multiple times collects all values; a non-repeatable flag given twice is a duplicate-flag exit 2.

## 6. DESIGN DECISION RATIONALE

**Where does the parser live?** Options: (a) new `bin/lib/argv.js` sibling; (b) fold into `shared-infra.js`; (c) inline helper re-copied but hardened. **Chosen:** (a) `bin/lib/argv.js` — one module per concern (FAFF-441), keeps `shared-infra.js` from growing further, directly importable. Rejected (b): mixes an unrelated concern into the path/config/ledger primitive file. Rejected (c): re-copying is what created the 26-site problem.

**Parse-and-return vs parse-and-exit vs throw.** **Chosen:** pure `parseArgs` + `usageError` helper. Rejected throw-and-catch-in-main: diverges from the return-int handler convention and moves usage strings away from their owning handler. Rejected parse-internally-exits: an impure parser can't be unit-tested by the `--selftest` table.

**Missing-value rule — how strict?** **Chosen:** next token absent or `--`-prefixed ⇒ missing value, with `--flag=value` as the escape hatch. Rejected "accept any next token including `--foo`": that *is* the reconcile bug. At the time of writing, no faff CLI value begins with `--`, so the rule is unambiguous; revisit if a future value-flag needs `--`-leading values (the `=`-form already covers it).

**Duplicate single-valued flag.** **Chosen:** exit 2. Rejected last-wins / first-wins: both silently accept a contradictory command line, the ambiguity class the ticket exists to close.

**Migration completeness — tranche vs all.** **Chosen:** migrate every flag-accepting subcommand, ordered by stakes (gate-flipping commands first: `next`, `reconcile`, `admissible`, `eligible`, `run-done`/`run-start`/`run-outward`, `budget`, `sentry`, `merge-gate`, `governance-check`, `lights-out`, `contain`; then the long tail), with the registry fuzz test (§8) as the completion gate. Rationale: the ticket frames it as retiring the whole class "in one move," and partial migration leaves a mixed fail-open/fail-closed surface that is hard to reason about. Partial migration is *safe* (unmigrated commands keep working, just still fail-open), so the tranche order is about sequencing risk, not a scope cut. Note: the migration unit is the *subcommand* (declare its full flag set), which is wider than the 26 value-flag closures — the census (28 closures + 12 inline value-reads + `adrFlag`'s 5 importers) measures density, not the unit count.

**Retire `adrFlag`.** **Chosen:** delete the exported `adrFlag` (adr.js:390) and migrate its 5 importers (admissibility, ci-triage, merge-gate, prd, prdr) to `parseArgs`. Rejected keeping an `adrFlag` shim over `parseArgs`: it would preserve a value-read call shape that omits unknown-flag rejection.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. (The methodology critique below independently raises right-sizing — a scope/increment observation for the human, not a design unknown; it does not gate the spec.)

**Assumptions:**

- **Assumes:** the CLI's flag-value vocabulary contains no value that legitimately begins with `--` (validation: grep the migrated call sites' value domains — issue ids, paths, ISO dates, enums, gitkeys — before finalising the missing-value rule; the `--flag=value` escape hatch covers any exception found).
- **Assumes:** the node `--test` suite (`test/*.test.mjs`) is the canonical harness and new parser tests join it (validation: `ls test/` and confirm the `.test.mjs` + child_process pattern already in use, e.g. `test/queue-state.test.mjs`).

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff next --status done --spec high --bogus-flag-xyz` exits 2 with a usage message (was exit 0)
- [ ] `faff reconcile --run-dir --json --level L3` exits 2 with a missing-value error for `--run-dir` (was: `--json` bound as run-dir)

### From WHAT (module + types)
- [ ] `bin/lib/argv.js` exists, exporting `parseArgs(argv, spec)` (pure, returns `{values, positionals, errors}`) and `usageError(errors, usage)` (returns 2)
- [ ] `FlagSpec` supports `arity` 0/1, optional `enum`, `repeatable`, and `aliases`
- [ ] `parseArgs` accepts `--flag value` and `--flag=value`; treats `--` and `-` as sentinels

### From HOW (behaviour)
- [ ] Unknown flag → `unknown-flag` error → exit 2 via `usageError`
- [ ] Arity-1 flag with absent or `--`-prefixed next token → `missing-value` → exit 2
- [ ] Out-of-enum value on an enum flag → `bad-enum` → exit 2 naming the accepted set
- [ ] Duplicate of a non-repeatable flag → `duplicate-flag` → exit 2; repeatable flag collects a list
- [ ] Positional arity under/over the declared `{min,max}` → exit 2; positional-taking commands (`config get KEY`) still work
- [ ] Errors accumulate across one pass (multiple problems reported together), not fail-fast

### From HOW (migration)
- [ ] Every flag-accepting subcommand in `COMMANDS` is migrated to declare a `CommandSpec` and parse via `parseArgs`; no `args.indexOf(<flag>)` value-read remains in a migrated handler
- [ ] The exported `adrFlag` (adr.js) is removed and its 5 importers migrated
- [ ] Valid-input behaviour is unchanged: the pre-existing CLI test suite passes (with any test that asserted the old fail-open behaviour updated to expect exit 2, and such updates called out in the PR)

### From HOW (durability)
- [ ] A registry-driven test iterates `COMMANDS` and asserts each flag-accepting subcommand, given a `--definitely-not-a-flag-xyz` token alongside otherwise-valid args, never exits 0 — the mechanical guard against a future subcommand regressing to fail-open (commands needing valid positional fixtures are supplied them; any command legitimately exempt is listed with a reason)

### Selftest / eval
- [ ] `argv.js` ships a selftest case table (matcher table) exercising `parseArgs` across unknown-flag, missing-value, bad-enum, duplicate, repeatable, positional-arity, `=`-form, and sentinel cases — surfaced as `test/argv.test.mjs` in the node `--test` harness (optionally also as a `faff`-level `--selftest` for parity with sibling commands)

**Integration smoke test:**

```
1. node bin/faff next --status done --spec high --bogus-flag-xyz    → exit 2, stderr names --bogus-flag-xyz
2. node bin/faff reconcile --run-dir --json --level L3              → exit 2, missing value for --run-dir
3. node bin/faff eligible --label faff-automate --default opt-in    → exit 0, prints "true" (valid input unchanged)
4. node --test test/argv.test.mjs                                    → PASS
```