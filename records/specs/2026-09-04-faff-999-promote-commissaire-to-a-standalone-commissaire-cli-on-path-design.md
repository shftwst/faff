# FAFF-999: Promote Commissaire to a standalone `commissaire` CLI on PATH

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-999.

This spec covers FAFF-999, a Linear issue asking for the existing Commissaire governance
facade to be reachable as its own `commissaire` binary on `PATH`, not only as `faff
commissaire …`. It is written for the build agent that implements it and for a human
reviewer checking scope; it assumes no prior context beyond the codebase itself.

## 1. WHY: Problem and Principles

Every call into Commissaire today runs through `plugin/skills/faff/bin/faff`, an
entrypoint that `require`s over one hundred sibling modules at load time: tracker
integration, scheduling, harness selection, skill orchestration, all of it before it ever reaches
the four modules Commissaire's own handler (`cmdCommissaire` in
`plugin/skills/faff/bin/lib/commissaire.js`) actually needs. Commissaire's handler is
already independent in principle (zero runtime dependencies, requires only
`producer-auth`, `events`, `effects`, and `shared-infra`); it has never been independent
in practice, because the only way to reach it is through a launcher that is not. This
ticket packages the existing handler behind a second, standalone entrypoint that carries
none of that unrelated weight, and puts that entrypoint on `PATH`.

This is entrypoint and packaging work over a surface that already exists, not new
governance depth. Only `effect authorize` (the protected-effect decision, `cmdRequestDecision`)
is built to real depth today. `contract admit`, `effect declare`, `effect observe`, and
`effect reconcile` are real but shallow (authenticated ledger appends and escape
detection). `audit verify` is real (FAFF-977's secret-free replay). `verdict conclude`
and `audit seal` are boundary stubs that shell out to the `faff` binary
(`cmdBoundaryStub` in commissaire.js, `spawnSync`ing `events anchor` / `bundle publish`).
`audit export` is not wired at all. None of that changes here. This spec adds a front
door, not a floor.

**Design principles**

**The standalone binary must never `require` `plugin/skills/faff/bin/faff`.** That file's
module-level `require("./lib/X")` calls execute unconditionally at load time for every
one of its 100-plus sibling modules: tracker, harness, engine, scheduling, all of it. Pulling
in `bin/faff` to reuse its dispatch table would silently reintroduce the exact dependency
graph this ticket exists to strip away, and would make the import-independence guard test
(section 3, below) fail by construction. The standalone binary reaches `cmdCommissaire`
directly, through `plugin/skills/faff/bin/lib/commissaire.js` alone.

**Byte-identical output is the correctness bar, not a nice-to-have.** Where the two
entrypoints diverge in how they format an error or a usage line, they have stopped being
one implementation with two doors; they have become two implementations that happen to
agree today. Every design choice below is made in that direction, including keeping
`faff`-branded wording in shared error and usage text even from the standalone binary
(see Design decisions).

**The boundary-stub verbs' behaviour is unaffected by which entrypoint is used.** The
child-spawn target inside `cmdBoundaryStub` is the `ENTRYPOINT` constant, defined in
`shared-infra.js` as `path.resolve(__dirname, "..", "faff")`, resolving unconditionally to
`plugin/skills/faff/bin/faff`, and never from `process.argv[1]` or any other argv0-derived
value. `verdict conclude` and `audit seal` always shell out to
`bin/faff`, whether they were reached via `faff commissaire verdict conclude` or via
`commissaire verdict conclude`. This is existing behaviour, confirmed by reading the
constant; the runtime spawn dependency it represents is acknowledged and explicitly left
to FAFF-1000, not re-litigated here.

**Reference context**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (CommonJS) | The existing launcher; its `main()` dispatch shell is the pattern the new binary must match byte-for-byte on error/usage output, without importing it |
| `plugin/skills/faff/bin/lib/commissaire.js` | Node (CommonJS) | The unchanged handler both entrypoints call into (`cmdCommissaire`, `COMMISSAIRE_DISPATCH`, `COMMISSAIRE_ALIASES`) |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CommonJS) | Already a dependency of `commissaire.js`; the natural home for the two small helpers this ticket adds, so no new require edge is introduced |
| `plugin/skills/faff/bin/lib/regions.js` | Node (CommonJS) | Owns the existing require-graph walker (`regionsRequireEdges`) this ticket's independence test reuses rather than reimplementing |
| `scripts/link-skills.sh` | Bash | Owns the existing `~/.local/bin/faff` symlink block this ticket mirrors for `commissaire` |
| `records/adr/0122-…md`, `records/adr/0123-…md` | Markdown (ADR) | Both `Proposed`; this ticket is the human delivery decision that accepts them |

**Scope statement.** This sits entirely inside the `faff` skill's bundled CLI
(`plugin/skills/faff/bin/`) and its installer (`scripts/link-skills.sh`); it adds one new
executable and a handful of small, mechanical changes around it. It does not touch
`commissaire.js`'s governance logic.

## 2. OUT OF SCOPE

- **Building `verdict conclude` / `audit seal` to real depth, and building `audit
  export`.** Deferred to FAFF-1000. Extension point: `cmdTerminalVerdict` /
  `cmdSealBundle` in `commissaire.js`, and a new `audit export` entry in
  `COMMISSAIRE_DISPATCH`.
- **The stub verbs' runtime `spawnSync` dependency on the `faff` bin.** The
  import-independence test this ticket adds is scoped to the *static* require graph only;
  making the boundary stubs' runtime process-spawn independent of `bin/faff` (or deciding
  it should stay) is FAFF-1000's acceptance, not this ticket's.
- **Rebranding usage and error text away from the literal `faff commissaire …` wording.**
  Kept unchanged deliberately (see Design decisions); a future ticket can revisit once
  the standalone binary is allowed to present its own identity without breaking parity.
  Extension point: `usage()` and the shared error-catch helper in `shared-infra.js`.
- **Phase 2B, Gate 1/Gate 2, a generic superdomestique CLI, or skill renames.** Parked
  by the delivery decision; no extension point named.

## 3. WHAT: Vocabulary, Types, and Interfaces

**Vocabulary**

| Term | Definition |
|---|---|
| Standalone binary | The new `plugin/skills/faff/bin/commissaire` executable this ticket adds |
| Shim | The standalone binary's own code: argv handling and dispatch into `cmdCommissaire`, nothing else |
| ADR-0123 grammar | `<object> <action> [flags]` (e.g. `contract admit`, `effect authorize`), the tail both entrypoints already accept after their own leading token |
| Import-independence guard | The new test asserting the standalone binary's transitive `require` graph never reaches a scheduling/tracker/skill module |

**New and changed artifacts**

```
RECORD NewFile "plugin/skills/faff/bin/commissaire":
  kind: executable Node CommonJS script, shebang #!/usr/bin/env node, chmod +x
  requires: "./lib/commissaire" (cmdCommissaire), "./lib/shared-infra" (the two new
            helpers below), nothing else; the platform guard's message text lives in
            shared-infra.js, not duplicated here
  requires NOT: "./faff" (see WHY: never require the bin/faff entrypoint)
  exports: { main }, guarded by `require.main === module` exactly like bin/faff, so
           tests can call main(argv) directly without spawning a process

RECORD ChangedFile "plugin/skills/faff/bin/lib/shared-infra.js":
  adds: cliPosixGuard()      -> boolean (true = refused; writes the existing win32 stderr
                                 message unchanged, caller sets exitCode 1 and returns)
        runGovernedDispatch(label: string, handler: fn, args: string[]) -> number
                                 (the existing 3-arm catch from bin/faff's main(), extracted
                                  verbatim: GovernanceProfileError duck-check, base-parse-error,
                                  legacy-config-name; anything else rethrows unchanged)
  CONSTRAINT: both helpers are pure refactors of code that already exists in bin/faff's
              main()/require.main block: no new behaviour, no new require edges (the
              GovernanceProfileError check is a duck-typed property read, not an import)

RECORD ChangedFile "plugin/skills/faff/bin/faff":
  main() and the require.main block call the two shared-infra.js helpers above instead of
  carrying the logic inline: same observable behaviour, one fewer copy of it

RECORD ChangedFile "scripts/link-skills.sh":
  generalizes the single BIN_SRC/BIN_DST pair into an ordered list of CLI binaries
  (faff, commissaire), and the three existing per-bin blocks (--status report, --unlink
  removal, create-path symlink + PATH warning) each loop over that list instead of
  hardcoding one pair (see HOW for the loop shape)

RECORD NewTest "test/commissaire-standalone.test.mjs":
  covers: byte-identical parity between `faff commissaire …` and `commissaire …` for
          every wired verb; the import-independence guard; --unlink/--status parity
```

**Design decisions**

*Shim shape.* Two ways to build the standalone binary: (a) require `bin/faff` and
re-inject `"commissaire"` as a leading argv token so its existing dispatch table handles
everything, or (b) call `cmdCommissaire` directly from `commissaire.js` and duplicate only
the small platform-guard and error-catch wrapper. Option (a) is less code but pulls in
`bin/faff`'s full 100-plus-module require graph at load time, which fails the
import-independence guard by construction and defeats the ticket's purpose. Option (b)
keeps the two small wrapper pieces in one shared place (`shared-infra.js`, already a
`commissaire.js` dependency) rather than duplicating them.
**Chosen:** option (b): direct dispatch into `cmdCommissaire`, with the wrapper logic
extracted to `shared-infra.js` and reused, never duplicated, by both entrypoints.

*Error/usage text branding.* `commissaire.js`'s `usage()` function and the extracted
error wrapper both emit strings that literally say `faff commissaire …` (e.g. `"faff
commissaire admit: --producer and --contract-revision are required\n"`). Left as-is, the
standalone binary prints `faff`-branded text about itself, which reads a little oddly.
Rewriting those strings per-entrypoint would break the byte-identical acceptance
criterion the ticket sets for every wired verb.
**Chosen:** keep the literal text unchanged. Byte-identical output is the acceptance bar
FAFF-999 itself states; a cosmetic rebrand is exactly the kind of change that would
violate it for no functional gain, and is cheap to revisit later once the binary is
allowed to diverge (tracked as an out-of-scope item above, not a punt: the call is
settled by the acceptance criterion, not open).

*link-skills.sh structure.* Three existing blocks (`--status`, `--unlink`, create-path)
each touch the single `BIN_SRC`/`BIN_DST` pair once. Adding `commissaire` by copy-pasting
a second pair into each of the three blocks would triple the surface for a one-line
difference (the binary name) and drift the moment one block is edited and the other
isn't.
**Chosen:** replace the single pair with a short ordered list and loop each block over
it. Mirrors the script's own existing pattern for `TARGET_DIRS` (already a loop over a
list built once).

*Import-independence test mechanism.* `plugin/skills/faff/bin/lib/regions.js` already
owns a require-edge extractor (`regionsRequireEdges(file, fileRegion, sourceSet)`,
exported) used by `regions check`'s factory/governance direction lint. Reimplementing
require-parsing for this ticket's narrower guard would duplicate that logic for no
reason; the existing extractor already ignores comment/string-embedded require-shaped
text, which a naive regex re-implementation would have to re-solve.
**Chosen:** reuse `regionsRequireEdges` to walk the transitive closure from
`commissaire.js` (and the new `bin/commissaire`), and assert the result against a
denylist (see HOW). The denylist itself is a **Chosen**, not a **Punt**: derived directly
from `regions.js`'s own `REGION_MAP` factory entries whose banners name orchestration
concerns: `tracker`, `harness`, `engine`, `next`, `project-next`, `run-start`,
`run-done`, `queue-state`, `lights-out`, `self-intake`, `scenario-matrix`; plus a
blanket rule that no resolved path may leave `plugin/skills/faff/bin/` at all (which
covers every `faffter-*` skill directory without naming each one).

## 4. HOW: Behaviour

**Architecture**

```
                 ┌─────────────────────────┐
faff commissaire │  bin/faff  (main())      │──▶ COMMANDS["commissaire"] ──┐
<object> <action>│  103 require("./lib/X")  │                              │
                 └─────────────────────────┘                              │
                                                                            ▼
                                                              ┌───────────────────────┐
                                                              │ lib/commissaire.js     │
                                                              │  cmdCommissaire()      │
                 ┌─────────────────────────┐                 │  COMMISSAIRE_DISPATCH  │
commissaire      │  bin/commissaire (shim)  │────────────────▶  COMMISSAIRE_ALIASES   │
<object> <action>│  4 requires, total       │                 └───────────────────────┘
                 └─────────────────────────┘
```

Both entrypoints terminate in the same handler, the same dispatch tables, and (for
`verdict conclude` / `audit seal`) the same hardcoded `spawnSync` target. Only the path
to get there differs: one long, one short.

**`bin/commissaire` shim**

```
PROCEDURE main(argv):
  1. IF cliPosixGuard() refused (non-POSIX platform):
       process.exitCode = 1
       RETURN
  2. args = argv (already argv.slice(2) at the call site)
  3. code = runGovernedDispatch("commissaire", cmdCommissaire, args)
  4. process.exitCode = code

IF this file is the process entry point (require.main === module):
  main(process.argv.slice(2))
EXPORT { main }
```

`cmdCommissaire` is synchronous today (every entry in `COMMISSAIRE_DISPATCH` returns a
plain number); the shim does not need `bin/faff`'s belt-and-braces Promise handling.
**Assumes:** this stays true for the life of this ticket; validated by reading
`COMMISSAIRE_DISPATCH`'s eight handlers before merge (none is `async`, none returns a
thenable).

**`shared-infra.js` additions**

```
FUNCTION cliPosixGuard() -> boolean:
  IF process.platform == "win32":
    write the existing stderr message (verbatim, from bin/faff's current require.main block)
    RETURN true
  RETURN false

FUNCTION runGovernedDispatch(label, handler, args) -> number:
  TRY:
    RETURN handler(args)
  CATCH e:
    IF e carries the faffGovernanceProfileError marker property:
      write to stderr, one line: "faff: " + e.message
      RETURN 2
    IF e.message == "base-parse-error":
      write to stderr, one line: "faff " + label + ": cannot proceed — " + e.file + " is malformed (" + e.detail + ")."
      RETURN 2
    IF e.message == "legacy-config-name":
      names = e.legacy (or an empty list if absent), joined with ", "
      write to stderr, one line: "faff " + label + ": cannot proceed — legacy config filename (" + names + "); rename to .faffrc.yaml."
      RETURN 2
    RE-THROW e
```

`bin/faff`'s `main()` is edited to call `runGovernedDispatch(sub, handler, rest)` instead
of carrying this block inline, and its `require.main` guard calls `cliPosixGuard()`
instead of the inline platform check. Same text, same exit codes, one definition.

The two message strings above (`base-parse-error` and `legacy-config-name`) are quoted
character-for-character from the real source, including the en/em dash `bin/faff`'s
current code already emits. Do not "clean up" that punctuation when implementing this
helper: the byte-identical output requirement means the exact characters the existing
code prints today are the target, not a restyled version of them.

**`scripts/link-skills.sh` CLI-binary loop**

```
PROCEDURE (replaces the single BIN_SRC/BIN_DST pair):
  CLI_BINS = [ { name: "faff" }, { name: "commissaire" } ]
    where each entry's src = "$SRC_DIR/faff/bin/<name>", dst = "$HOME/.local/bin/<name>"

  --status block:
    FOR EACH bin IN CLI_BINS:
      report "CLI: <name> → <dst> (linked)" or "CLI: <name> not linked into <dir>"
      (same predicate as today: dst is a symlink AND readlink(dst) == src)

  --unlink block:
    FOR EACH bin IN CLI_BINS:
      IF dst is a symlink AND readlink(dst) == src: remove it, count it, same output shape

  create-path block:
    FOR EACH bin IN CLI_BINS:
      IF src exists on disk:
        ln -sfn src dst
        echo "CLI: <dst> → <src>"
    AFTER the loop, once (not per binary: every dst shares the same ~/.local/bin
    directory, so a per-binary check would print the same PATH warning twice):
      IF dirname(dst) is not on $PATH: print the existing warning once
```

Every observable line link-skills.sh already prints for `faff` is preserved verbatim; the
loop only adds a second, structurally identical set of lines for `commissaire`.

**Import-independence test**

```
PROCEDURE assertCommissaireStandsAlone():
  1. sourceSet = every *.js file under plugin/skills/faff/bin/lib/, plus the entrypoint files
     plugin/skills/faff/bin/faff and plugin/skills/faff/bin/commissaire
  2. seed = [ "plugin/skills/faff/bin/commissaire", "plugin/skills/faff/bin/lib/commissaire.js" ]
  3. visited = {}, queue = seed
     WHILE queue not empty:
       file = queue.pop()
       IF file in visited: CONTINUE
       visited.add(file)
       { edges, malformed } = regionsRequireEdges(file, EMPTY_MAP, sourceSet)
         -- an empty region-attribution map is enough: only edges[].toFile is used here,
            never edges[].toRegion, so no file needs a valid region banner for this walk
       ASSERT malformed is empty. A require regions.js itself could not attribute (a
         non-literal argument, or a spec resolving outside sourceSet) is itself a finding,
         never silently skipped.
       FOR EACH edge IN edges: queue.push(edge.toFile)
  4. DENYLIST = the eleven module basenames named in the Design decisions section above
  5. ASSERT: no file in `visited` has a basename in DENYLIST
  6. ASSERT: no file in `visited` resolves outside plugin/skills/faff/bin/ (catches any
     faffter-* skill or scheduling module DENYLIST forgot to name. In practice, a require
     resolving there would already show up as `malformed` at step 3, since sourceSet is
     scoped to bin/lib/ plus the two entrypoints; this assertion documents the invariant
     directly rather than relying on that as a side effect)
  7. ASSERT (guard-tests-itself): a deliberately-injected extra require edge
     (commissaire.js -> lib/tracker.js, added only inside the test via a temp-copy fixture,
     never in the real source tree) makes step 5 fail, proving the assertion is live, not
     vacuously true because the denylist never matches anything today
```

Step 7 exists because a guard test that can never fail is not a guard. It never mutates
the real `commissaire.js`; it copies the file to a scratch location, appends one
`require("./tracker")` line to the copy, and re-runs the walk against that copy only.

**Existing behaviour left unchanged (validated, not built)**

- `faff commissaire <object> <action>` continues to work exactly as today: `bin/faff`'s
  `COMMANDS["commissaire"]` entry is untouched, still `cmdCommissaire` directly. Both
  entrypoints share one implementation by construction, not by a new compatibility shim.
- `commissaire -h` / `--help` was never specially handled by `bin/faff commissaire -h`
  either (`main()` only intercepts a *top-level* `-h`/`--help`/`help`; a subcommand-level
  flag falls through to the handler, which for `cmdCommissaire` means `resolveCommissaireKey`
  returns `null` and `usage()` prints with exit 2). The standalone binary reaches the same
  `cmdCommissaire` the same way, so this already matches with no special-casing needed.
- `commissaire --selftest` (`commissaireSelftest()`) already spawns its CLI round-trip
  against the hardcoded `ENTRYPOINT` (`bin/faff`), regardless of which binary was used to
  invoke `--selftest` itself. **Assumes:** this remains adequate regression coverage for
  the shared handler after this ticket; the standalone binary's own argv shape gets its
  dedicated coverage from the byte-identical parity scenario below, not from extending
  `commissaireSelftest()`. Validation: run `commissaire --selftest` post-change and confirm
  it still passes unchanged (nothing in `commissaire.js` itself is edited).

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir admitted and declared for producer P1 on issue FAFF-1, step "merge"
When `faff commissaire effect authorize --run-dir DIR --producer P1 --issue FAFF-1 --step merge`
  and `commissaire effect authorize --run-dir DIR --producer P1 --issue FAFF-1 --step merge`
  are each run with the same stdin payload
Then their stdout, stderr, and exit code are byte-for-byte identical
```

```
Given no `--producer` flag is passed to `contract admit`
When the command is run once via `faff commissaire contract admit …` and once via
  `commissaire contract admit …`
Then both print the identical usage-error line (including its literal "faff commissaire"
  wording) and exit 2
```

```
Given the import-independence test's step 7 fixture (a temp copy of commissaire.js with
  one extra require("./tracker") line appended)
When assertCommissaireStandsAlone() walks the require graph from that fixture
Then the assertion fails, proving the denylist check is reachable and not vacuous
```

- `scripts/link-skills.sh --status` reports a `commissaire` row alongside the existing
  `faff` row, both showing `linked` after a fresh `--global` run, an assertion line, not
  a scenario (mechanical CLI-output check, not a behavioural branch).
- `scripts/link-skills.sh --unlink` removes both `~/.local/bin/faff` and
  `~/.local/bin/commissaire` when both point into this repo, and leaves either alone if it
  points elsewhere (foreign symlink), an assertion line, same reasoning.

## 5. DESIGN DECISION RATIONALE

**How should the standalone binary reach `cmdCommissaire` without dragging in `bin/faff`'s
full dependency graph?**
- Option A: `require("./faff")` and re-inject `"commissaire"` as a leading argv token.
  Pro: minimal new code, reuses the exact dispatch shell. Con: `bin/faff`'s 100-plus
  module-level requires execute at load time regardless of which subcommand argv names,
  and that fails the import-independence guard by construction.
- Option B: call `cmdCommissaire` directly, with the small platform-guard/error-wrapper
  logic extracted to `shared-infra.js` (already a dependency) and shared.
**Chosen:** Option B: the only option that satisfies the ticket's own independence
requirement.

**Should the standalone binary's usage/error text drop the literal `faff` prefix so it
reads correctly on its own?**
- Option A: rebrand the strings per-entrypoint (pass a label into `usage()` /
  the error wrapper).
- Option B: keep the strings exactly as they are today, for both entrypoints.
**Chosen:** Option B. FAFF-999's own acceptance criterion is byte-identical output for
every wired verb; rebranding is a direct conflict with that criterion, not a judgement
call to weigh against it.

**How should `scripts/link-skills.sh` gain a second symlinked binary without tripling its
three per-binary blocks?**
- Option A: copy-paste a `commissaire`-specific version of each of the three blocks.
- Option B: generalize the single `BIN_SRC`/`BIN_DST` pair into a short list and loop.
**Chosen:** Option B, matching the script's own existing `TARGET_DIRS` loop pattern.

**How should the import-independence guard be implemented?**
- Option A: a fresh regex-based require scanner written for this ticket.
- Option B: reuse `regions.js`'s already-exported `regionsRequireEdges`.
**Chosen:** Option B, avoiding re-solving comment/string-embedded require detection that
`regionsRequireEdges` already handles, and keeps one definition of "what counts as a
require edge" in the codebase.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumptions**

- **`cmdCommissaire` and every handler in `COMMISSAIRE_DISPATCH` are synchronous** (return
  a plain number, never a Promise). Validation: read `COMMISSAIRE_DISPATCH`'s eight
  entries in `commissaire.js` before merge; none is declared `async` and none returns a
  thenable as of this ticket. If a future verb becomes async, the shim's `main()` needs
  the same Promise-resolution handling `bin/faff`'s `require.main` block already carries;
  not needed today.
- **`commissaireSelftest()`'s existing internal round-trip (which spawns the hardcoded
  `ENTRYPOINT`, i.e. `bin/faff`, for both its "flat" and "object-verb" spelling checks)
  remains adequate regression coverage for the shared handler after this ticket**, and
  does not need to be extended to also spawn the new standalone binary. Validation: run
  `commissaire --selftest` after the change lands and confirm it still passes unchanged;
  it should, because `commissaire.js` itself is not edited by this ticket.

No **Punt:** items remain open. Every multi-option decision above was closed by either
the codebase's existing conventions or FAFF-999's own stated acceptance criteria.

## 7. DONE: Definition of Done

### From WHY
- [ ] `plugin/skills/faff/bin/commissaire` never appears as a `require` target of, nor
      itself `require`s, `plugin/skills/faff/bin/faff` (checked by the import-independence
      test and by code review of the new file's require statements)
- [ ] `verdict conclude` and `audit seal`, run via either entrypoint, are observed
      spawning `plugin/skills/faff/bin/faff` as their child process (same as today;
      regression-checked, not newly built)

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faff/bin/commissaire` exists, is executable (`chmod +x`), has the
      `#!/usr/bin/env node` shebang, and exports `{ main }` guarded by
      `require.main === module`
- [ ] `shared-infra.js` exports `cliPosixGuard` and `runGovernedDispatch`, and `bin/faff`'s
      `main()`/`require.main` block calls them instead of carrying the logic inline
      (no behavioural change, verified by `test/config-strict-base.test.mjs`, which
      already exercises the `base-parse-error`/`legacy-config-name` dispatch paths,
      passing unchanged)
- [ ] `scripts/link-skills.sh` defines an ordered `CLI_BINS` list (`faff`, `commissaire`)
      and all three per-binary blocks (`--status`, `--unlink`, create-path) loop over it

### From HOW (behaviour)
- [ ] `commissaire <object> <action> …` produces byte-identical stdout, stderr, and exit
      code to `faff commissaire <object> <action> …` for every entry in
      `COMMISSAIRE_DISPATCH` (`contract admit`, `effect declare`, `effect authorize`,
      `effect observe`, `effect reconcile`, `verdict conclude`, `audit seal`,
      `audit verify`), across at least one success and one usage-error case per verb
- [ ] The same parity holds for all seven flat-verb aliases (`admit`, `declare`,
      `request-decision`, `observe`, `reconcile`, `terminal-verdict`, `seal-bundle`)
- [ ] The import-independence test (`assertCommissaireStandsAlone`) exists, passes against
      the real source tree, and is shown to fail against the deliberately-tainted fixture
      copy (step 7 of the HOW procedure), proving it is a live assertion
- [ ] `scripts/link-skills.sh --status` reports a `commissaire` line with the same
      linked/not-linked semantics as the existing `faff` line
- [ ] `scripts/link-skills.sh --unlink` removes `~/.local/bin/commissaire` under the same
      foreign-symlink-safe rule as `~/.local/bin/faff`

### From HOW (edge cases)
- [ ] `commissaire` with no arguments, or with `-h`/`--help`, prints the existing
      `usage()` output and exits 2, identically to `faff commissaire` with no arguments
- [ ] `commissaire --selftest` still exits 0 after this ticket lands (unchanged
      `commissaire.js`, regression-checked)

### From OUT OF SCOPE (must NOT regress)
- [ ] Existing FAFF-828 fixtures (`test/commissaire.test.mjs`) and FAFF-977 fixtures
      (`test/fixtures/commissaire/secret-free-replay/`) pass unchanged
- [ ] No change to `verdict conclude` / `audit seal`'s stub behaviour, and no `audit
      export` verb is added

### Integration smoke test
```
PROCEDURE smoke():
  1. Run `bash scripts/link-skills.sh --global` in a scratch HOME
  2. Confirm ~/.local/bin/commissaire is a symlink to plugin/skills/faff/bin/commissaire
  3. mkdtemp a run dir; `commissaire contract admit --run-dir DIR --producer P1
     --contract-revision r1 --scope merge`; confirm exit 0 and the same JSON shape
     `faff commissaire contract admit …` would print for the same inputs
  4. `commissaire audit verify --run-dir DIR`; confirm the same {version, result, …}
     contract FAFF-977's `faff commissaire audit verify` already prints
```

### Docs (from WHY's scope statement)
- [ ] `docs/guide/cli.md`'s "Running it by hand" section gains a short `commissaire`
      locate-and-symlink snippet, mirroring the existing `faff` one
- [ ] `README.md`'s Install section gains one sentence noting Commissaire is also
      reachable as its own `commissaire` binary via the same dev-install symlink script
- [ ] `records/adr/0122-adopt-declared-effects-as-the-first-v5-cutover-slice.md`'s Status
      flips `Proposed` → `Accepted`, and its closing Consequences sentence (which today
      names the parked FAFF-827 gate as the acceptance path) is corrected to name this
      ticket's human delivery decision (2026-09-04) instead
- [ ] `records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md`'s
      Status flips `Proposed` → `Accepted`, with its closing sentence updated the same way

confidence: high
build-tier: complex
