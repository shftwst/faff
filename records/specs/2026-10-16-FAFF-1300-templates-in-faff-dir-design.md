# Spec: Template overrides live in `.faff/templates/` (FAFF-1300)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1300.
> build-tier: complex

This is the build contract for FAFF-1300. Audience: the build agent that implements it, and the human reviewers who gate it. It covers one CLI resolver, one config key, three repointed consumers, the prose and doc corrections the ticket lists, and the test coverage that holds all of it.

## Corrections to the explore findings

Three anchors in the explore findings are wrong. Build against these instead.

| Claim in the findings | Verified state |
|---|---|
| `TRACKING_KEYS` is "near `config.js:911-923`" | `TRACKING_KEYS` is at `plugin/skills/faff/bin/lib/config.js:1215-1233`. Lines 911-923 are `ISOLATION_LANE_VOCAB`. |
| The ADR-template tests live in `test/adr.test.mjs` | They live in `test/adr-format.test.mjs` (fixture writer at `:29-30`, `template_path` assertion at `:78`, degrade-message assertion at `:93`). `test/adr.test.mjs` is a different file and does not touch templates. |
| `native-map` coverage lives only in the CLI `--selftest` | `test/native-map.test.mjs` exists and drives the real CLI (`MAP_REL` at `:18`, absent-map case at `:242`, present-map case at `:258`). The CLI selftest at `native-map.js:344` also exists. Both need updating. |

One claim in the dispatch brief is also wrong and the spec corrects it below under **Where the config key has to be registered**: neither `config check`'s known-key lint nor the `WRITABLE_NAMESPACES` drift guard reads leaf keys, so neither forces a `.faffrc.example.yaml` line. The line is still wanted, for a different and weaker reason.

Everything else in the findings held: `adr.js:462`, `native-map.js:46-47`, `create.md:34,37,60,78,80`, the dispatch arms at `config.js:3237-3263`, the subcommand allowlist at `config.js:35-40`, and `resolveDocsPath` at `config.js:1180`.

## 1. WHY, problem and principles

**The load-bearing model.** Today each of the three template consumers carries its own hard-coded string for where committed template overrides live: a constant in `adr.js`, a constant in `native-map.js`, and a literal path written into agent prose in `create.md`. Moving the directory therefore means editing the rule in three places and spelling a two-location fallback out three times, once of them in prose that no test can check. This slice replaces all three with a single CLI resolver, `faff config templates-path`, that owns the new-path-first, old-path-fallback rule. After this change the directory's location is one function and one config key, and the three consumers only ask.

**Problem statement.** Committed template overrides sit at the repo-root `.faff-templates/` directory, outside the `.faff/` directory faff controls, which leaves an adopting project with a faff-specific folder at its root. The original reason for keeping them outside is now factually wrong: FAFF-568 changed the ignore line to `.faff/*` so git descends, and FAFF-1299 adds `!/templates/` to faff's own `.faff/.gitignore`. This slice moves the overrides to `.faff/templates/` behind a resolver, keeps the old location readable with a deprecation notice, and corrects the obsolete prose.

### Design principles

**The dual-path rule lives in exactly one place.** This is the whole point of the slice, and it is the test the implementation has to pass before anything else. If the resolved path or the fallback condition appears anywhere other than the resolver, the change has failed, even if every acceptance criterion passes. ADR-0128's standing rule (resolve via the CLI, never hand-read the file) already applies to the ADR template; this extends the same posture to the other two consumers.

**One resolved path has one interpretation base.** A resolved path is only single-owner if every consumer turns it into the same absolute directory. The CLI consumers do `path.join(root, rel)`. The `create.md` prose consumer has no `root` to join against, so left to itself it would resolve the same string against its own working directory, and the two lanes would read two different directories for the same configured value. The resolver therefore owns the join as well as the string.

**Stdout stays a bare path.** The six existing docs-path resolvers each `console.log` the resolved relative path and nothing else, and callers capture that stdout as a path. Any diagnostic this resolver produces must go somewhere a path-capturing caller will not swallow it. A notice on stdout would corrupt every caller.

**A notice's remedy must be correct in the state that produced it.** The deprecation notice names a command the operator will run. There are two distinct deprecated states, and the command that fixes one corrupts the other, so the notice text is a function of the state, not a constant.

**Absent templates resolve byte-identically to today.** The regression floor is a repo with no template present anywhere. Its `faff adr new` output, its `faff native-map get` output, and the create-time fill step must be byte-for-byte what they are today. This is the condition FAFF-1085 wrote into `adr.js:457-461` and it still binds.

**faff never deletes or moves a committed file.** The migration is the operator's own `git mv` or `rm`. faff names the command and gets out of the way. This matches FAFF-1302's chosen migration posture and `gitignore-ensure.js:13-48`'s append-only stance, both for the same reason: a file faff moves on the operator's behalf can carry values faff cannot judge.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js:1180-1203` | JavaScript (CommonJS) | `resolveDocsPath` plus its seven existing bindings. The new resolver is registered beside them and reuses the shared helper. |
| `plugin/skills/faff/bin/lib/config.js:1215-1233` | JavaScript | `TRACKING_KEYS`, the `tracking.*` write allowlist. |
| `plugin/skills/faff/bin/lib/config.js:35-40, 3237-3263` | JavaScript | The `config` subcommand allowlist and the six docs-path dispatch arms the new verb mirrors. |
| `plugin/skills/faff/bin/lib/adr.js:462, 494-495, 503` | JavaScript | `ADR_TEMPLATE_REL_PATH`, the two degrade messages that embed it, and the single `path.join`. `adr.js:51` already requires `config.js`, so the resolver is in reach with no new dependency. |
| `plugin/skills/faff/bin/lib/adr.js:59, 66` | JavaScript | `adrDir` and `supersededDir`, the precedent for the `path.join(root, resolved)` base every CLI consumer uses. |
| `plugin/skills/faff/bin/lib/native-map.js:12, 46-49, 227, 237, 242-254, 266, 306` | JavaScript | `NATIVE_MAP_DIR`, `NATIVE_MAP_REL` and all six sites that interpolate it, the module header comment, the `--dry-run` early return, the existence guard, the `mkdirSync`, and the read target. `native-map.js:40` already requires `config.js`. |
| `plugin/skills/faff/references/create.md:34, 37, 60, 78, 80, 83` | Agent prose | The per-type override tier, including the obsolete rationale sentence at `:60` and the out-of-scope seam note at `:83` that this slice closes. |
| `plugin/skills/faff/bin/lib/shared-infra.js:492` | JavaScript | `LEGACY_CONFIG`, the repo's precedent for keeping a legacy-name path alive long after a rename. Cited as the reason the fallback is not removed here. |

**Scope statement.** This is the second of four tickets moving faff's own bookkeeping inside `.faff/` so an adopting project's root `.gitignore` carries no faff lines. FAFF-1299 provides the `.faff/.gitignore` carve-outs this ticket consumes; FAFF-1302 moves the config files; FAFF-1301 warns about a literal `.faff/` root line that would defeat all of it.

**Discharging a four-times-deferred seam.** The `tracking.templates_path` key this slice adds is the exact extension point four prior specs each deferred to the same follow-up: FAFF-14 (`records/specs/2026-06-10-FAFF-14-...-design.md:188`, which punted it and named `spec_docs_path` as the model), FAFF-1081 (`:51`), FAFF-1083 (`:42`), and FAFF-1085 (`:56`). FAFF-14's own prose named the mechanics precisely: mirror `spec_docs_path`, add `templates_path` to `TRACKING_KEYS`, resolve via `faff config get`. The seam note at `create.md:83` is the live record of that deferral and this slice deletes it.

## 2. Out of scope

**FAFF-1299's `.faff/.gitignore` writer.** This ticket does not touch `gitignore-ensure.js`. It assumes `!/templates/` is already carved out there. FAFF-1299 now carries a **blocker edge to this ticket in the tracker** (added 2026-10-15), so the dependency is enforced by the tracker as well as by this spec; the implementer still runs the pre-build validation in the Assumptions section, because a landed ticket is not the same as a verified carve-out in this working tree. Extension point: `FAFF_GITIGNORE_PATTERNS` and the `.faff/.gitignore` pattern set in `plugin/skills/faff/bin/lib/gitignore-ensure.js`.

**FAFF-1302's config-file move.** `.faffrc.yaml` to `.faff/config.yaml` is a separate slice with its own resolver and its own migration notice. Nothing here depends on it and nothing here should anticipate it. Extension point: `CANONICAL_CONFIG` / `LEGACY_CONFIG` at `shared-infra.js:491-492`.

**Removing the `.faff-templates/` fallback.** Deliberately deferred; see the Design Decision Rationale for why, and the follow-up note below. Extension point: the `templatesFallbackRel` helper this slice adds, which is the single place a removal would delete.

**Containment-checking `tracking.templates_path`.** A configured value can point anywhere the six sibling docs-path keys can, and by standing operator decision is not containment-checked, uniform with `tracking.adr_docs_path` (recorded at `adr.js:61-66`; `resolveDocsPath` at `config.js:1180` validates nothing beyond a trim either). This slice does not change that policy for the new key or any sibling. What it does fix is the *two bases* defect, which is a consistency bug rather than a policy question. Extension point: `resolveDocsPath` at `config.js:1180`, the one place a containment rule would go for all seven keys at once.

**Local-mode (`--local`) support for a committed template directory.** `gitignore-ensure`'s `--local` pattern set writes a literal `.faff/` line into `.git/info/exclude` (`gitignore-ensure.js:66`, documented at `faff-onboard/SKILL.md:146`). Git never descends past a literal directory line, so faff's own `.faff/.gitignore` is never read and a file under `.faff/templates/` is excluded. This is consistent with what local mode means (nothing faff-related is committed at all, which is why that pattern set has no anchors carve-out either) but it is a behaviour change for a local-mode repo that today commits `.faff-templates/`. Not fixed here. Extension point: `FAFF_GITIGNORE_PATTERNS_LOCAL` at `gitignore-ensure.js:66`, under FAFF-1299.

**Mining an existing template directory at onboard time.** `faff-onboard` reports the native map it wrote; it does not go looking for a `.faff-templates/` directory to migrate. Unchanged. Extension point: `faff-onboard/SKILL.md` step 3b.

**Historical records.** `records/specs/**` and `docs/rfc/rfc-superdomestique-runtime/v5/**` keep their original wording. Those are records of what was decided when, not live documentation. Do not rewrite them.

## 3. WHAT, vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| templates directory | The directory holding committed template overrides: the ADR template, the native-template map, and the per-type `<type>.md` ticket templates. One directory, three kinds of file. |
| canonical templates directory | `.faff/templates`, the new location. The resolver's preferred answer and the only directory any writer targets. |
| deprecated templates directory | `.faff-templates`, the old repo-root location. Read-only from this slice forward. |
| the fallback state | Unset key, `.faff-templates/` present, `.faff/templates/` absent. The resolver answers the deprecated directory. |
| the shadowed state | Unset key, both directories present. The resolver answers the canonical directory and the deprecated one is dead weight. |
| the resolver | `faff config templates-path` on the CLI, `resolveTemplatesPath(root, data, create)` in `config.js`. The single owner of the dual-path rule. |

### The config key

```
tracking.templates_path: String | unset
  # A repo-root-relative directory. Trailing slashes are stripped on read,
  # matching every tracking.*_docs_path sibling.
  # SET   -> that directory, unconditionally. No presence check, no fallback,
  #          no deprecation notice.
  # UNSET -> the presence ladder in resolveTemplatesPath (below).
  CONSTRAINT member of TRACKING_KEYS (writable via `faff config set` / `config init`)
  CONSTRAINT no DEFAULTS registry entry (the unset value is computed, not a constant)
  CONSTRAINT not containment-checked, uniform with the six docs-path siblings
```

**Design decision, why the key is writable at all.** The ticket asks only for a path move; a bare constant swap would satisfy its acceptance criteria. Options: (a) a hard-coded `.faff/templates` with a hard-coded fallback, (b) a configurable key resolved through `faff config`. Option (a) is a smaller diff but leaves the four-times-deferred seam open and leaves the resolver without a reason to exist as a `config` verb, which in turn leaves `create.md` naming a literal path in prose. Option (b) is what FAFF-14 named and what the six docs-path siblings already establish.

**Chosen:** the configurable key, resolved through `faff config templates-path`, per the human decision of 2026-10-15. It closes the seam FAFF-14, FAFF-1081, FAFF-1083 and FAFF-1085 each deferred, and it gives `create.md` a CLI call to make instead of a path to name.

### The CLI surface

```
faff config templates-path [--create] [--absolute] [--root DIR]
  stdout: the resolved directory, one line, no trailing slash
          default    -> repo-root-relative (identical to the six siblings)
          --absolute -> path.join(root, rel), the exact absolute directory
                        the CLI consumers read
  stderr: at most one deprecation notice per process (see HOW)
  exit:   0 always (the resolver always has an answer; a missing directory is not an error)
```

Shape-identical to its six siblings in its default form, including the bare-path stdout and the `--create` flag. It is a `config` sub-verb, not a new top-level command, so `faff lint-cli-doc` (which parses base commands only, `lint-cli-doc.js:20-27`) and `faff lint-cli-coverage` (base subcommands only) are both already satisfied by the existing `config` rows. The verb list at `docs/guide/cli.md:30` is still updated, for the reader.

**Design decision, how a non-CLI consumer gets an interpretation base.** Every CLI consumer turns the resolved relative path into a directory with `path.join(root, rel)`, the pattern `adrDir` (`adr.js:59`) and `supersededDir` (`:66`) already set. The `create.md` prose consumer has no `root` variable; it has a shell and a working directory. Options: (a) the prose joins the relative answer onto its own working directory, (b) the prose discovers the repo root itself and joins, (c) the resolver prints the absolute directory on request and the prose uses it verbatim.

Option (a) is what unqualified prose does by default, and it is wrong whenever the agent's working directory is not the repo root, or whenever the configured value is absolute or starts `../`: `tracking.templates_path: /etc/faff` makes `faff adr format` read `<root>/etc/faff/adr.md` while the prose lane reads `/etc/faff/<type>.md`. Two lanes, one configured value, two directories, and the prose lane is the one no test covers. Option (b) puts repo-root discovery into prose, which is a second rule for prose to get wrong, and `findRoot` already exists in `shared-infra.js` for exactly this reason.

**Chosen:** option (c). `--absolute` prints `path.join(root, rel)` and the `create.md` prose uses that string with no further joining, so the interpretation base is computed once, inside the resolver, for both lanes. This is a consistency fix, not a policy change: nothing is validated or rejected, and absorbing a leading `/` is `path.join`'s ordinary behaviour, already how the six siblings treat an absolute `tracking.adr_docs_path`. A `../` value still escapes the repo, now identically in both lanes rather than differently, which is the settled posture the Out of scope section records.

**Anti-pattern:** having the `create.md` prose join the resolver's relative answer onto its own working directory. Why: it is a second interpretation base for one resolved string, it diverges from the CLI consumers for any absolute or `../` value, and it diverges for every agent whose working directory is not the repo root.

### The resolver

```
RECORD TemplatesResolution:            # conceptual; the function returns the rel string
  rel: String                          # repo-root-relative, no trailing slash
  state: canonical | fallback | shadowed | configured | absent
```

```
FUNCTION templatesFallbackRel(root) -> (String, State)   # pure except two fs.existsSync calls
  # Only reached when tracking.templates_path is UNSET. Emits no output.
  canon := exists(root + "/.faff/templates")
  depr  := exists(root + "/.faff-templates")
  IF canon AND depr     -> RETURN (".faff/templates", shadowed)
  IF canon              -> RETURN (".faff/templates", canonical)
  IF depr               -> RETURN (".faff-templates", fallback)
  RETURN (".faff/templates", absent)        # neither present: the canonical answer
```

```
FUNCTION resolveTemplatesPath(root, data, create) -> String
  1. configured := dig(data, "tracking.templates_path")
  2. IF configured is truthy:
       rel := trim(configured), trailing slashes stripped
       # configured wins outright: no presence check, no notice
  3. ELSE:
       (rel, state) := templatesFallbackRel(root)
       IF state == fallback: emitDeprecationNotice(fallback)      # see HOW
       IF state == shadowed: emitDeprecationNotice(shadowed)      # different text
  4. IF create: mkdir -p (root + "/" + rel)
  5. RETURN rel
```

**Design decision, reuse `resolveDocsPath` or write a standalone resolver.** `resolveDocsPath` (`config.js:1180`) already handles the configured-value-wins head, the trailing-slash trim, and the `--create` mkdir, and `resolveAdrSupersededDocsPath` (`:1202`) shows how to drive it with a computed unset default via its `fallbackRel` parameter. Reusing it would be the smaller diff. The hazard: JavaScript evaluates arguments eagerly, so `resolveDocsPath(root, data, create, "tracking.templates_path", null, templatesFallbackRel(root))` computes the fallback even when the configured value wins. For `resolveAdrSupersededDocsPath` that is harmless (the discarded call only reads config). Here the discarded call would decide whether a deprecation notice fires, so an operator who has explicitly configured `tracking.templates_path` would still see a notice about a directory the resolver did not use.

**Chosen:** a standalone `resolveTemplatesPath` with the shape above, which decides the fallback only on the unset branch. It may delegate the trim and the mkdir to `resolveDocsPath` once the branch is settled, but the notice decision must sit outside the argument list. Writing it as four explicit steps costs about ten lines and removes a bug the eager-evaluation shortcut would guarantee.

**Anti-pattern:** passing `templatesFallbackRel(root)` as `resolveDocsPath`'s `fallbackRel` argument. Why: the argument is evaluated whether or not the unset branch is taken, so the notice fires for operators who configured the key explicitly.

### Where the config key has to be registered

| Registration site | Anchor | Required by |
|---|---|---|
| `TRACKING_KEYS` entry `"tracking.templates_path"` | `config.js:1215-1233`, after `tracking.spike_docs_path` | `faff config set` and `faff config init` both refuse a key outside this list (`config.js:1384-1385`). Without it the key is unwritable. |
| `CONFIG_SURFACE.subcommands["templates-path"]` with `required_flags: []` | `config.js:35-40` | The `config` arg gate refuses an unlisted sub-verb. |
| The dispatch arm, including the `--absolute` flag | `config.js:3237-3263`, beside the six siblings | Where the verb actually runs. |
| `module.exports` entries for `resolveTemplatesPath` and `resetTemplatesDeprecationNotice` | `config.js:3432` | `adr.js` and `native-map.js` import the resolver; the selftests import the reset. |
| A commented `# templates_path:` line under `tracking:` in `.faffrc.example.yaml` | beside `spec_docs_path` through `spike_docs_path`, `.faffrc.example.yaml:74-84` | Documentation parity only. See the correction below. |

**Correction to the dispatch brief on the example file.** The brief states that `config check`'s known-key lint and the `WRITABLE_NAMESPACES` drift guard both read `.faffrc.example.yaml` and therefore force a line for the new key. Verified: both inspect **top-level key names only**. `knownKeyLint` is explicitly "PURE: known-key (schema) lint over a document's TOP-LEVEL key NAMES only" (`config.js:2485-2492`); the drift guard takes `Object.keys(parseYamlSubset(exampleText))` and diffs against `WRITABLE_NAMESPACES` (`config.js:2171-2182`), and the test that mirrors it checks the same top-level set (`test/config-set.test.mjs:87-97`). `tracking` is already a member. So a new `tracking.*` leaf requires no example-file line to keep either check green.

**Chosen:** add the line anyway, commented out. The reason is documentation parity with the six siblings documented at `.faffrc.example.yaml:74-84`, not a lint. Commented rather than live, for the same reason `adr_superseded_docs_path` is commented at `:78-83`: an uncommented value ships a live pin to everyone who copies the template, and here that pin would silently switch the fallback off for a repo that still has `.faff-templates/`. The comment states the computed default and that an explicit value disables the fallback.

## 4. HOW, behaviour

### Architecture

```
tracking.templates_path (config)          .faff/templates/   .faff-templates/
            |                                    |                  |
            +------------------------------------+------------------+
                                 |
                   resolveTemplatesPath(root, data, create)
                     stdout: bare rel path (or absolute with --absolute)
                     stderr: one deprecation notice per process, text per state
                                 |
        +------------------------+------------------------+
        |                        |                        |
   adr.js resolveAdrFormat   native-map get/set      create.md fill step
   (path.join(root, rel),    (path.join(root, rel),  (`faff config
    then "adr.md")            then "native-           templates-path
                              templates.yaml")        --absolute`,
                                                      then "<type>.md")
```

Three consumers, one resolver, no consumer holding a path literal, a fallback rule, or an interpretation base of its own.

### The deprecation notice

The notice fires only on the unset-key branch, and only in the two states where a deprecated directory exists. The two states need different remedies, so there are two texts.

```
TEMPLATES_DEPRECATED_MSG     # the fallback state: .faff-templates/ only
faff: template overrides at .faff-templates/ are deprecated; move them to .faff/templates/
      (`git mv .faff-templates .faff/templates`) or set tracking.templates_path.
```

```
TEMPLATES_SHADOWED_MSG       # the shadowed state: both directories present
faff: overrides at .faff-templates/ are deprecated and are now ignored; .faff/templates/ wins.
      Move any file you still need into .faff/templates/, then delete .faff-templates/.
      Do not `git mv` the whole directory: .faff/templates/ already exists, so the move
      would nest it as .faff/templates/.faff-templates/.
```

**Design decision, where the notice goes.** Options: (a) stdout alongside the path, (b) stderr, (c) a `--json` field on `config templates-path`, (d) emitted only by the consuming command rather than the resolver. Option (a) is disqualified outright: the six siblings' stdout is a bare path and callers capture it, so a notice there corrupts every caller, including the `create.md` prose lane that reads the resolver's stdout and joins `<type>.md` onto it. Option (c) does not help, because none of the six siblings has `--json` and the consumers that do have it (`native-map get --json`, `adr format --json`) parse stdout. Option (d) puts the notice back in three places, which contradicts the slice's whole purpose.

**Chosen:** stderr, emitted by the resolver, at most once per process. Stderr is where `adr.js` already writes its template degrade messages (`adr.js:494-495, 512`), so the precedent and the operator's expectations are both set. All three consumers inherit the notice for free by calling the resolver, and no stdout contract changes.

**Design decision, one notice text or two.** Options: (a) one fixed text, as the round-1 draft had it; (b) one text per deprecated state. Option (a) is wrong, not merely terse. Its remedy is `git mv .faff-templates .faff/templates`, and in the shadowed state the destination already exists, so git moves the source *inside* it and the operator ends up with `.faff/templates/.faff-templates/`, a directory faff reads nothing from, created by a command faff told them to run, in the state this design already calls its most confusing.

**Chosen:** option (b), two texts selected by the resolver's state. The fallback text keeps the directory-level `git mv`, which is correct because the destination does not exist. The shadowed text names a file-level migration and explicitly warns the directory-level `git mv` off, because the nesting failure is silent and would otherwise be discovered only by an operator wondering why their edits do nothing. Coverage: a scenario and a DONE item per state, each asserting the remedy its own state requires.

**Anti-pattern:** reusing the fallback text in the shadowed state, or softening it to a remedy-free "the old directory is ignored". Why: the first instructs a destructive-looking nesting move, and the second leaves the operator with a dead directory and no stated way to clear it.

```
FUNCTION emitDeprecationNotice(state)
  # Module-level latch: once per process, regardless of state or root.
  IF noticeEmitted: RETURN
  noticeEmitted := true
  msg := state == shadowed ? TEMPLATES_SHADOWED_MSG : TEMPLATES_DEPRECATED_MSG
  stderr.write(msg + "\n")

FUNCTION resetTemplatesDeprecationNotice()      # EXPORTED, for in-process test harnesses
  noticeEmitted := false
```

**Why a latch.** Nothing in the design guarantees one resolution per command, and the counts will drift as consumers are added: `adr.js` resolves the ADR format from two separate verbs (`adr format` at `:705`, `adr new` at `:765`) and `native-map` from both `get` and `set`. The sharper case is the selftests, which resolve many times in one process; `adr.js`'s own selftest calls `resolveAdrFormat` eight times (`:1032-1059`), and today's unlatched degrade message prints once per call there. A latch makes the notice count independent of the call count, which is what a test can assert.

**Design decision, how a latched notice stays assertable.** A module-level latch with no reset makes every notice assertion in a single-process harness order-dependent. `adr --selftest` runs every template case in one process (`adr.js:1029-1059`) and this slice adds both a fallback case and a shadowed case to it, each expecting the notice on stderr: the first case consumes the latch and the second observes nothing, so whichever runs second fails for a reason that has nothing to do with the behaviour under test. Options: (a) export a reset the in-process harnesses call; (b) rule that every notice assertion runs in its own subprocess; (c) key the latch per root.

Option (c) is already rejected below as an anti-pattern and does not solve the `adr --selftest` case anyway, because the fallback and shadowed cases use different roots only by convention. Option (b) is the right rule for the `.test.mjs` suites, which already drive the real CLI and therefore get a fresh process per case for free, but it cannot be the whole answer: `adr --selftest` and `native-map --selftest` are in-process by construction and are themselves gated DONE items.

**Chosen:** both, split by harness. Export `resetTemplatesDeprecationNotice` from `config.js`; every in-process selftest case that asserts on the notice calls it first, which makes each case's expectation independent of case order. Every `.test.mjs` notice assertion invokes the real CLI, so it is already a fresh process and asserts on that process's stderr with no reset involved. Each affected DONE item below names which of the two mechanisms it relies on, so the criterion is decidable without re-deriving this paragraph.

**Anti-pattern:** latching per `root`. Why: the only caller that resolves against more than one root is a selftest, which is exactly the caller that wants one line per case, and a per-root map is state no production path needs. The exported reset gives the selftests per-case control without putting a map in the production path.

**Anti-pattern:** calling `resetTemplatesDeprecationNotice` from any non-test code path. Why: the latch's whole purpose is that a single command emits one notice however many times it resolves, and a production reset reintroduces the per-call repetition the latch exists to remove.

### `--create` semantics

**Design decision.** Options: (a) no `--create` flag, (b) `--create` mkdirs the resolved directory, (c) `--create` always mkdirs `.faff/templates` regardless of resolution. Option (a) breaks sibling consistency and leaves `native-map set` to mkdir by hand, which is a path literal outside the resolver. Option (c) can produce an empty `.faff/templates/` next to a populated `.faff-templates/`, which then wins the next resolution and silently shadows the operator's real templates.

**Chosen:** option (b). `--create` mkdirs the **resolved** directory, exactly as the six siblings do. The consequences are benign in each case: on the canonical branch it creates `.faff/templates/`; on the fallback branch it mkdirs a directory that by definition already exists, so it is a no-op; with the key configured it creates the configured directory. It therefore never creates the deprecated directory fresh and never creates a shadowing empty canonical directory.

### Unset-key resolution, all four cases

| Directories present | State | stdout (default) | stderr | Why |
|---|---|---|---|---|
| only `.faff/templates/` | canonical | `.faff/templates` | silent | The canonical location, nothing to warn about. |
| only `.faff-templates/` | fallback | `.faff-templates` | `TEMPLATES_DEPRECATED_MSG` | The ticket's "old path on its own still works and prints the deprecation notice". The directory-level `git mv` is correct here. |
| both | shadowed | `.faff/templates` | `TEMPLATES_SHADOWED_MSG` | The ticket's "`.faff/templates/` wins". The notice still fires, with the file-level remedy, because the directory-level `git mv` would nest the source inside the destination. |
| neither | absent | `.faff/templates` | silent | Byte-identical behaviour. See below. |

**Why the shadowed case still prints a notice.** The alternative is silence, on the grounds that nothing is broken. Rejected: the shadowed directory is the single most confusing state in this design, since an operator editing `.faff-templates/adr.md` would see no effect and no explanation. The notice is the only signal available, which is also why its remedy has to be the correct one for this state rather than the fallback state's.

**Why neither-present is byte-identical.** All three consumers test for file presence and degrade silently on absence: `resolveAdrFormat` returns `nygardDefault()` on `ENOENT` (`adr.js:504`), `cmdNativeMapGet` emits a miss when the file does not exist (`native-map.js:306-309`), and the `create.md` fill step falls through to tier 3. The two `adr.js` degrade messages fire only on a file that exists and is unusable (`adr.js:494-495`), so a resolved-but-absent path produces no output at all. The resolver itself is silent in this case and does not mkdir without `--create`. Therefore the only observable difference is the path string inside a message that never prints.

### Consumer 1, the ADR template (`adr.js`)

```
PROCEDURE resolveAdrFormat(root)                      # replaces adr.js:501-520
  1. IF root is falsy: RETURN nygardDefault()         # unchanged, the no-root guard
  2. [data] := loadConfig(root)
  3. templatesRel := resolveTemplatesPath(root, data, false)   # no --create on a read
  4. templateRel  := templatesRel + "/adr.md"
  5. templatePath := join(root, templateRel)
  6. read templatePath:
     a. ENOENT                  -> RETURN nygardDefault()                  # unchanged
     b. other read error        -> stderr(degradeMsg(templateRel)); RETURN degraded nygard
  7. names := extractLevel2Headings(text)
  8. IF names empty            -> stderr(degradeMsg(templateRel)); RETURN degraded nygard
  9. ... remainder unchanged, with template_path := templateRel
```

Changes required:

- Delete the `ADR_TEMPLATE_REL_PATH` constant (`adr.js:462`).
- `ADR_TEMPLATE_DEGRADE_MSG` and `ADR_TEMPLATE_NO_DECISION_MSG` (`adr.js:494-495`) currently interpolate the constant at module load. They become functions of the resolved relative path, so the message names the file actually read. Call sites at `:511` and the no-Decision site.
- `resolveAdrFormat` gains a `loadConfig` call. It already has `root`, and `adr.js:51` already imports `loadConfig` from `config.js`, so no new dependency.
- The resolved `template_path` field in `faff adr format --json` reports the resolved relative path, so a repo on the canonical path reports `.faff/templates/adr.md`.
- Update the header comment at `adr.js:455-461`, which names `.faff-templates/<type>.md` and `.faff-templates/adr.md` as the activation surface. File-presence activation is unchanged; only the directory moves.
- Update the selftest fixtures at `adr.js:1038, 1046, 1052, 1057` to write under `.faff/templates/`, and add the fallback and shadowed cases listed in DONE. Each of those two new cases calls `resetTemplatesDeprecationNotice()` before resolving, because the harness is single-process.

**Anti-pattern:** keeping `ADR_TEMPLATE_REL_PATH` as `".faff/templates/adr.md"` and adding a second constant for the fallback. Why: that is the three-copies-of-the-rule state this slice exists to remove, and it puts the directory literal back in `adr.js`.

### Consumer 2, the native-template map (`native-map.js`)

Reads honour both locations through the resolver. The write target is the canonical directory only.

```
PROCEDURE nativeMapReadRel(root, data)                # the READ target
  RETURN resolveTemplatesPath(root, data, false) + "/native-templates.yaml"

PROCEDURE nativeMapWriteRel(root, data)               # the WRITE target
  # Deliberately NOT the read resolver: a write never lands in the deprecated dir.
  configured := dig(data, "tracking.templates_path")
  rel := configured ? trim(configured) : ".faff/templates"
  RETURN rel + "/native-templates.yaml"
```

**Every `NATIVE_MAP_REL` and `NATIVE_MAP_DIR` interpolation, enumerated.** The non-functional assertion forbids `.faff-templates` anywhere in `native-map.js`, which forces the constants out of all seven sites below, not just the obvious write path. Each anchor was verified in the current file.

| Anchor | Site | Replacement |
|---|---|---|
| `:12` | Module header comment, "Writes/overwrites the committed `.faff-templates/native-templates.yaml`" | Prose: "the committed native-template map, under the directory `faff config templates-path` resolves". |
| `:49` | `NATIVE_MAP_HEADER`, which hard-codes the path into the written file's first line | Becomes a function of the write-relative path, so a written file names its own location. |
| `:227` | The `empty-mappings` `--json` `path` field | `nativeMapWriteRel(root, data)`. Machine-read; covered by a DONE item. |
| `:243-249` | The `unchanged` `--json` `path` field and the human "no changes (…) already up to date" line | `nativeMapWriteRel(root, data)`, in both. The `path` field is machine-read; covered by a DONE item. |
| `:251` | The no-`--force` "already exists with different content" refusal on stderr | `nativeMapWriteRel(root, data)`. |
| `:256` | The `mkdirSync` of `path.join(root, NATIVE_MAP_DIR)` | The parent directory of the write-relative path. |
| `:266` | The success line, "wrote N mapping(s) to …" | `nativeMapWriteRel(root, data)`. |
| `:306` | `cmdNativeMapGet`'s `targetPath` and its `--json` `path` field | `nativeMapReadRel(root, data)`, so an operator on the deprecated path sees `.faff-templates/native-templates.yaml` in the JSON while the notice explains it on stderr. `emitNativeMapGetMiss` is unchanged. |

Note the ordering constraint at `:227`: the `empty-mappings` branch returns before the write target is otherwise needed, so the write-relative path has to be in hand earlier than it is today. Resolve it once, near the top of `cmdNativeMapSet`, after the payload validation.

`cmdNativeMapSet` (`native-map.js:203`) also gains an existence guard over both paths:

```
PROCEDURE cmdNativeMapSet existence guard               # extends native-map.js:242-254
  writeRel := nativeMapWriteRel(root, data)
  readRel  := nativeMapReadRel(root, data)
  1. IF exists(writeRel):
       a. IF content identical  -> IF --dry-run: print the preview, exit 0   # see below
                                   ELSE: no-op, exit 0                       # unchanged
       b. IF no --force         -> IF --dry-run: stderr the refusal as an advisory,
                                                 print the preview, exit 0
                                   ELSE: stderr names writeRel; exit 2       # unchanged
  2. ELSE IF readRel != writeRel AND exists(readRel):
       # A map exists ONLY at the deprecated path. Writing writeRel would leave
       # the deprecated file in place and silently dead.
       a. IF no --force -> stderr:
            "faff native-map set: a map already exists at <readRel>; it is deprecated
             and would be shadowed by <writeRel>. Migrate it with
             `mkdir -p <dirname(writeRel)> && git mv <readRel> <writeRel>`, or re-run
             with --force to write the new path and leave the old file in place."
          exit 2
       b. IF --force -> proceed, and name <readRel> in the success output as a file
          the operator should now remove. faff does not delete it.
  3. write writeRel
```

The guard's remedy is deliberately **file-level**, with an explicit `mkdir -p` of the destination directory. Only one file is at stake, and the destination directory may or may not already exist (it exists whenever the canonical directory holds an `adr.md` but no map). A directory-level `git mv` would be wrong in exactly that case, for the same nesting reason the shadowed notice warns about; the file-level form with the `mkdir -p` is correct in both.

**Design decision, the shadow guard.** Options: (a) `set` checks only its own write target, as today; (b) `set` checks both and refuses without `--force`. Option (a) means an operator with an existing `.faff-templates/native-templates.yaml` runs `native-map set`, gets a clean exit, and ends up with two map files where the old one is dead and the new one is authoritative, with no signal. That failure is invisible precisely because the new path wins on read, so everything appears to work.

**Chosen:** option (b). The guard reuses the existing `--force` gate rather than inventing a flag, and the refusal message carries the file-level migration command. It keeps the ticket's "`native-map set` writes only the new path" true while making the half-migrated state loud instead of silent.

**Design decision, `--dry-run` versus the shadow guard.** `--dry-run` returns at `native-map.js:237`, before the `:242-254` existence block the guard extends. Left alone, `native-map set --dry-run` on a deprecated-only repo previews a clean write and says nothing, and the operator meets the exit-2 refusal only on the real run. Options: (a) leave the early return where it is and accept the silent preview; (b) move the guard ahead of the early return so `--dry-run` exits 2 as the real run would; (c) run the guard ahead of the early return but emit it as an advisory on stderr, with `--dry-run` still exiting 0 and still writing nothing.

Option (a) is a preview that does not predict the command it previews, which is the one job a dry run has. Option (b) breaks `--dry-run`'s standing contract, that it never fails and always prints the text a real write would produce; `test/native-map.test.mjs` and the ticket's own dry-run criterion both rest on that.

**Chosen:** option (c), applied to **every** branch of the guard rather than only the shadowed-map one. Resolve both paths and run the existence check before the `--dry-run` return; on any branch that would refuse or no-op a real run, write that branch's text to stderr prefixed as an advisory, then print the preview and exit 0.

The per-branch sweep matters because the guard now sits ahead of the early return at `native-map.js:237`, so every branch it can take is reachable under `--dry-run` where previously none was. Step 1a is the one that bites: an existing byte-identical canonical map is a no-op-exit-0 on a real run, and left alone it would make `--dry-run` exit 0 printing **nothing**, against this spec's own rule that `--dry-run` keeps its stdout. Today's code cannot reach that state because `:237` returns first, so this is a regression the reordering introduces rather than a pre-existing gap. Step 1b gets the same treatment for the same reason. `--dry-run` keeps its exit code and its stdout, and gains a warning about the state the real run will refuse. As a consequence the deprecation notice now also fires under `--dry-run` on a deprecated-only repo, because the read resolver is called where previously it was not; this is the intended behaviour and is pinned by a DONE item rather than left to discovery.

**Anti-pattern:** routing `native-map set`'s target through the read resolver. Why: on a repo with only `.faff-templates/` the read resolver answers `.faff-templates`, so the write lands in the deprecated directory, which the ticket forbids.

### Consumer 3, the per-type overrides (`references/create.md`)

This is the only template read outside the CLI. The prose stops naming paths, stops joining anything against its own working directory, and calls the resolver.

```
resolve_override_template(type):        # create.md tier 2, replacing the path literals
  dir := run `faff config templates-path --absolute`
                                        # stdout is the absolute directory; use it verbatim,
                                        # do NOT join it onto the working directory.
                                        # stderr may carry the deprecation notice, which is
                                        # informational and is not a failure.
  IF the command fails for any reason: treat as no override; fall to tier 3
  path := dir + "/" + type + ".md"
  IF not exists(path): RETURN MISS              # tier 3, unchanged
  RETURN level-2 heading sequence of path        # unchanged parse
```

Prose edits, by anchor:

- `:34` and `:37`: tier 2 becomes "a committed override file at `<templates-path>/<type>.md`, where `<templates-path>` is what `faff config templates-path --absolute` resolves", with the parenthetical at `:37` following the same form.
- `:60`, the **Override files** paragraph: this is a correction, not a repoint. The current sentence says overrides are "deliberately outside the gitignored `.faff/` directory (the `.faff/`-dir-only ignore is append-only and git's parent-exclusion rule blocks a `!.faff/templates/` carve-out, so the store sits outside `.faff/`)". That clause is now false, not merely stale: FAFF-568 changed the root line to `.faff/*` so git descends, and FAFF-1299 puts `!/templates/` in faff's own `.faff/.gitignore`. Replace the parenthetical with the current fact, and **keep the second half**, which is still true and still load-bearing: a multi-line per-type map is not cleanly readable through the scalar and block-scalar config CLI, so files remain the override surface and the config key only says *where*.
- `:78`: the unknown-type example becomes `<templates-path>/foo.md`, or drops the path and names just `foo.md`.
- `:80`: the git-only-mode sentence stops naming `.faff-templates/` and says overrides are read through the resolver, identically in git-only mode.
- `:83`: delete the `tracking.templates_path` out-of-scope seam clause. It is built here. The control-label seam in the same sentence stays.

**Anti-pattern:** spelling the fallback out in the `create.md` prose ("look in `.faff/templates/`, then `.faff-templates/`"). Why: that is the fourth copy of the rule, in the one consumer no test can check. The prose asks the resolver and gets one answer.

### Documentation

**Design decision, the `.faff-templates` literal in `docs/guide/cli.md`.** Two criteria over that one file pull against each other: the non-functional assertion forbids the literal anywhere in it, while the `templates-path` verb entry has to document the fallback and the stderr notice, and both of those *are* the deprecated directory. Options: (a) drop the assertion for that file entirely; (b) describe the fallback without naming the old directory; (c) scope the assertion to the rows that are repoints, and carve out the one entry whose subject is the deprecation.

Option (a) loses the check that the two repointed rows were actually repointed. Option (b) produces reference documentation that tells a reader a fallback exists but not what it falls back to, which is useless at the exact moment they need it.

**Chosen:** option (c). The assertion becomes: in `docs/guide/cli.md` the literal `.faff-templates` appears **only** within the `config templates-path` verb entry, and nowhere else in the file. That is strictly stronger than "does not appear in the two repointed rows" and it lets the one entry that documents the deprecation name its subject. The three prose files keep the absolute prohibition, because none of them documents the deprecation.

- `docs/guide/cli.md:30`: add `templates-path` to the inline `config <…>` verb list, with `--absolute`, and one sentence on what it resolves, naming the `.faff-templates` fallback and that the notice goes to stderr. This is the carved-out entry.
- `docs/guide/cli.md:40`, the `native-map set` row: replace the `.faff-templates/native-templates.yaml` literal with the resolved location, and state the shadow guard and its `--dry-run` advisory.
- `docs/guide/cli.md:178`, the `adr … format` row: replace the two `.faff-templates/adr.md` literals with the resolved location.
- `plugin/skills/faff-onboard/SKILL.md:132, 139, 156`: three mentions. Step 4b's prose, the "committed like the rest of `.faff-templates/`" sentence, and step 7's commit recommendation each name the resolved path instead. Step 7's recommendation becomes "commit `.faffrc.yaml` and the map at `.faff/templates/native-templates.yaml`".
- `plugin/skills/faffter-noon-adr/SKILL.md`: the only template reference is `resolved_format` at `:28`, which already tells the producer to run `faff adr format --json` and author against its `sections`. That is correct as written and needs no change; the ticket lists this file, and the honest answer is that routing through `faff adr format` already insulated it. Check `:3` and `:10`, which mention `.faff-templates/adr.md` in the description and intro prose, and repoint those.

Each edited skill prompt stays within the `docs/reference/skill-authoring.md` lint rules that `faff validate-adapters` enforces, which for these edits means not growing a paragraph past the cap while rewording.

### Failure modes

**The migration is silently inert because FAFF-1299 has not landed.** A file written to `.faff/templates/` in a repo whose root `.gitignore` carries `.faff/*` with no `!/templates/` carve-out and no `.faff/.gitignore` is ignored by git. The CLI works perfectly and the override is simply never committed. How you would know: `git check-ignore -v .faff/templates/adr.md` names the winning rule, and `git status --porcelain .faff/templates/` is empty where it should show an untracked file. What it means: stop and land FAFF-1299's carve-out first. The tracker now enforces this with a blocker edge, but the edge gates scheduling, not the state of this working tree, so the Assumption below still carries a validation command.

**The repo has a literal `.faff/` root ignore line.** Git never descends, so faff's own `.faff/.gitignore` is never read and every carve-out is void, including `!/templates/`. The explore findings verified this directly: with a literal `.faff/` line, `git check-ignore -v` attributes `.faff/.gitignore`, `.faff/anchors/**` and `.faff/templates/adr.md` all to `.gitignore:1:.faff/`. How you would know: the same `git check-ignore -v` output, which names `.faff/` rather than a `.faff/.gitignore` rule. What it means: the one-line hand fix is `.faff/` to `.faff/*`. FAFF-1301 adds the `config check` finding that surfaces this; until it lands, the check is manual. Not fixed here.

**An operator follows the notice's remedy and makes things worse.** A notice is only as good as its command. The shadowed state is the live instance: a directory-level `git mv` onto an existing destination nests the source inside it, so the operator's templates end up somewhere faff never reads and the notice they followed is what put them there. How you would know: `.faff/templates/.faff-templates/` exists, and the notice has stopped firing because `.faff-templates/` no longer exists at the root, so the operator has no signal left at all. What it means: the per-state notice text and the file-level `native-map set` remedy are both load-bearing correctness, not wording, and the DONE items that assert each remedy against its own state are what stops a regression here.

**The deprecation window never closes.** The fallback is cheap to keep and nobody is accountable for removing it, so `.faff-templates/` support outlives its purpose and every future reader has two locations to reason about. How you would know: no `.faff-templates/` removal ticket exists some releases from now. What it means: file the follow-up at implementation time rather than trusting it to be remembered. The removal itself is correctly out of this slice; the ticket for it is not.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with no templates directory at either location and no tracking.templates_path
When `faff adr new` and `faff native-map get --type bug --json` are run
Then both outputs are byte-identical to the same commands before this change
And `faff config templates-path` prints `.faff/templates` with nothing on stderr
```

```
Given a repo with a parseable adr.md in BOTH `.faff/templates/` and `.faff-templates/`,
      with different level-2 headings in each, and no tracking.templates_path
When `faff adr format --json` is run
Then `template_path` is `.faff/templates/adr.md`
And `sections` are the headings from the `.faff/templates/` copy
And stderr carries the shadowed notice, exactly once, whose remedy is the file-level move
And stderr does NOT contain the string `git mv .faff-templates .faff/templates`
```

```
Given a repo with `tracking.templates_path: records/tpl` set in .faffrc.yaml
      and a populated `.faff-templates/` directory present
When `faff config templates-path` is run
Then stdout is `records/tpl`
And stderr is empty, because a configured value wins outright and the ladder never runs
```

```
Given a repo at <root> with `tracking.templates_path: /etc/faff` set in .faffrc.yaml
When `faff config templates-path --absolute` is run from a working directory that is NOT <root>
Then stdout is `<root>/etc/faff`
And that is the same directory `faff adr format` reads `adr.md` from
```

```
Given a repo with `native-templates.yaml` present ONLY in `.faff-templates/`
      and a `.faff/templates/` directory that already exists holding only `adr.md`
When `faff native-map set --team SHF --tracker linear` is run without --force
Then it exits 2, writes nothing, and names both the deprecated file and a file-level
     `mkdir -p` plus `git mv` of that one file
And the message does NOT instruct a directory-level move of `.faff-templates`
```

```
Given a repo with `native-templates.yaml` present ONLY in `.faff-templates/`
When `faff native-map set --team SHF --tracker linear --dry-run` is run
Then it exits 0, writes nothing, and prints the same preview text a real run would
And stderr carries the shadowed-map advisory, so the preview predicts the real run's refusal
```

Non-functional assertions:

- `faff config templates-path` MUST write exactly one line to stdout, containing no whitespace other than the trailing newline, in every one of the four presence cases, in both its default and `--absolute` forms.
- The string `.faff-templates` MUST NOT appear in `plugin/skills/faff/references/create.md`, `plugin/skills/faff-onboard/SKILL.md`, or `plugin/skills/faffter-noon-adr/SKILL.md` after this change.
- In `docs/guide/cli.md` the string `.faff-templates` MUST appear only within the `config templates-path` verb entry, which documents the fallback, and nowhere else in the file.
- A configured `tracking.templates_path` MUST resolve to the same absolute directory in the CLI lane (`path.join(root, rel)`) and the `create.md` prose lane (`--absolute` stdout, used verbatim), for every value including an absolute one and one beginning `../`.

## 6. Design decision rationale

**Should a CLI resolver replace the per-consumer dual-path rule?** Options: a bare constant swap plus a hard-coded fallback in each consumer; or one `faff config templates-path` resolver backed by `tracking.templates_path`. The constant swap is a smaller diff but writes the fallback rule three times, once in `create.md` prose that no test reads, and leaves the four-times-deferred config seam open. **Chosen:** the resolver plus the config key, mirroring the six docs-path resolvers, per the human decision of 2026-10-15. It closes the seam FAFF-14 (`:188`), FAFF-1081 (`:51`), FAFF-1083 (`:42`) and FAFF-1085 (`:56`) each explicitly deferred, and it is what FAFF-14's own punt prescribed.

**When should the `.faff-templates/` fallback be removed?** Options: remove it in this slice, so there is only ever one location; or keep it with its notice and file a removal ticket. Removing it now would break any repo with a committed override the moment it upgrades, with no window to migrate, and the repo's own precedent runs the other way: `LEGACY_CONFIG` at `shared-infra.js:492` still errors loudly on `.faffrc.yml` and `.faffrc` long after the rename, because a deprecation window is its own deliberate decision with its own evidence. **Chosen:** keep the fallback and its notice in this slice; the removal is a follow-up ticket, filed at implementation time rather than trusted to memory. This is a decision, not an open question.

**Where does the deprecation notice go?** Covered in full under HOW. **Chosen:** stderr, from the resolver, latched to once per process, because the six siblings' stdout is a bare path that callers capture and a notice there would corrupt every one of them.

**One notice text or one per deprecated state?** Covered under HOW. **Chosen:** one per state, because the fallback state's directory-level `git mv` nests the source inside the destination when both directories exist, so a fixed text hands the operator a corrupting command in the one state this design calls its most confusing.

**How does a latched notice stay assertable in a single-process harness?** Covered under HOW. **Chosen:** export `resetTemplatesDeprecationNotice` for the in-process selftests and run every `.test.mjs` notice assertion in its own CLI subprocess, because `adr --selftest` runs every template case in one process and two cases each expecting the notice would otherwise be order-dependent.

**Does `templates-path` take `--create`?** Covered under HOW. **Chosen:** yes, mkdiring the resolved directory, which is sibling-consistent and never creates either a fresh deprecated directory or a shadowing empty canonical one.

**Does `native-map set` guard against a map at the deprecated path?** Covered under HOW. **Chosen:** yes, refusing without `--force` and naming a file-level migration, because the unguarded outcome is a dead file and an authoritative one with no signal distinguishing them.

**Does `--dry-run` run the shadow guard?** Covered under HOW. **Chosen:** yes, as a stderr advisory ahead of the preview, keeping exit 0 and the existing stdout, because a preview that does not predict the real run's refusal fails the only job a dry run has.

**Does the new resolver reuse `resolveDocsPath`?** Covered under WHAT. **Chosen:** a standalone `resolveTemplatesPath` that may delegate the trim and mkdir, because `resolveDocsPath`'s `fallbackRel` argument is eagerly evaluated and would fire the notice for operators who configured the key.

**How does the non-CLI consumer get an interpretation base?** Covered under WHAT. **Chosen:** `--absolute`, printing `path.join(root, rel)` for the prose lane to use verbatim, because one resolved string resolved against two bases is two directories for one configured value, and the prose lane is the one no test covers. This is a consistency fix within the settled no-containment-check posture, not a change to it.

**Is the `.faffrc.example.yaml` line live or commented?** Covered under WHAT. **Chosen:** commented, matching `adr_superseded_docs_path` at `:78-83`, because a live value shipped in the template would silently disable the fallback for anyone who copies it.

**Is `create.md:60` repointed or rewritten?** Options: swap the path and leave the rationale; or correct the rationale. The rationale states that git's parent-exclusion rule blocks a `!.faff/templates/` carve-out, which was true under the pre-FAFF-568 `.faff/` line and is false now. **Chosen:** rewrite the parenthetical to state the current mechanism (`.faff/*` lets git descend; `.faff/.gitignore` carries `!/templates/`), and keep the surviving half of the original reasoning, that a multi-line per-type map is not cleanly readable through the scalar config CLI, so files remain the override surface.

**Does the `docs/guide/cli.md` literal ban hold for the whole file?** Covered under HOW. **Chosen:** no, it is scoped so the literal may appear only inside the `config templates-path` verb entry, because that entry's subject is the deprecation and a fallback described without naming what it falls back to is useless reference documentation.

At the time of writing, FAFF-1301 and FAFF-1302 are unbuilt and carry no blocker edges to this ticket. FAFF-1299 is also unbuilt but now **blocks** FAFF-1300 in the tracker, an edge added 2026-10-15. If FAFF-1299's carve-out set changes shape, the Assumption below is what to re-validate.

## 7. Open questions and assumptions

**Open questions.** None. Both questions the ticket raised are closed above as `**Chosen:**` decisions: the resolver (closed by the human on 2026-10-15) and the fallback's removal (closed from the `shared-infra.js:492` precedent, deferred to a follow-up ticket).

**Assumptions.**

**Assumes:** FAFF-1299's `!/templates/` carve-out exists in faff's own `.faff/.gitignore`, so a file committed under `.faff/templates/` is not ignored. FAFF-1299 now blocks this ticket in the tracker (edge added 2026-10-15), so scheduling is enforced; what remains is the pre-build validation that the carve-out is actually present in this working tree, because the acceptance criterion "a file in `.faff/templates/` is committed" cannot be met without it and a landed ticket is not a verified tree.

*How to validate before starting:* in the repo root, run `git check-ignore -v .faff/templates/adr.md`. A silent exit 1 means the path is not ignored and the assumption holds. Output naming `.gitignore:…:.faff/*` means the carve-out is missing: land FAFF-1299 first, or, if that is not an option, add `!.faff/templates/` to the root `.gitignore` after the `.faff/*` line as a temporary measure and say so in the PR, since git honours a negation only after the matching ignore line (`gitignore-ensure.js:61`). Output naming a literal `.faff/` line is the worse case: git is not descending at all, so no carve-out anywhere will work, and the one-line fix is `.faff/` to `.faff/*`.

## 8. DONE, definition of done

Where a criterion asserts on the deprecation notice, it names its harness mechanism: **subprocess** (a fresh CLI process per case, so the latch is fresh by construction) or **in-process + reset** (a selftest case that calls `resetTemplatesDeprecationNotice()` first). No notice criterion is order-dependent on another.

### From WHY

- [ ] `git grep -n '\.faff-templates' plugin/skills/faff/bin/lib/` returns hits in `config.js` only, and none in `adr.js` or `native-map.js`.
- [ ] `git grep -n '\.faff-templates' plugin/skills/faff/references/create.md plugin/skills/faff-onboard/SKILL.md plugin/skills/faffter-noon-adr/SKILL.md` returns nothing.
- [ ] `git grep -n '\.faff-templates' docs/guide/cli.md` returns hits only inside the `config templates-path` verb entry.
- [ ] `records/specs/**` and `docs/rfc/**` are untouched by this change.

### From WHAT, the config key and CLI surface

- [ ] `TRACKING_KEYS` includes `"tracking.templates_path"`; asserted in `configSetSelftest` alongside the existing docs-path allowlist checks at `config.js:2282-2283`.
- [ ] `faff config set tracking.templates_path records/tpl` writes the key and exits 0; `faff config get tracking.templates_path` reads it back as `records/tpl`.
- [ ] `faff config templates-path` exits 0 and prints exactly one line with no trailing slash, in all four presence cases.
- [ ] `faff config templates-path --create` creates the resolved directory; run in a temp root with neither directory present, `.faff/templates/` exists afterwards and `.faff-templates/` does not.
- [ ] `resolveTemplatesPath` and `resetTemplatesDeprecationNotice` are both exported from `config.js`, and `CONFIG_SURFACE.subcommands` carries a `templates-path` entry.
- [ ] `.faffrc.example.yaml` carries a commented `# templates_path:` line under `tracking:`, and `node --test test/config-set.test.mjs` still passes.
- [ ] `faff lint-cli-doc` and `faff lint-cli-coverage` both pass.

### From WHAT, one interpretation base

- [ ] `faff config templates-path --absolute --root <root>` prints `path.join(root, rel)`, byte-identical to the directory `adrDir`-style `path.join(root, resolved)` produces, in all four presence cases.
- [ ] With `tracking.templates_path: /etc/faff`, `--absolute` prints `<root>/etc/faff`, and `faff adr format --json` reads its `adr.md` from that same directory. Asserted from a working directory that is not `<root>`.
- [ ] With `tracking.templates_path: ../shared/tpl`, `--absolute` prints the directory beside `<root>`, not one beside the working directory, and `faff adr format` reads from it. Asserted from a working directory that is not `<root>`.
- [ ] `references/create.md` tier 2 calls `faff config templates-path --absolute` and uses its stdout verbatim; it contains no instruction to join the result onto the working directory or the repo root.

### From HOW, the resolution ladder

- [ ] Unset key, only `.faff/templates/` present: resolves `.faff/templates`, stderr empty. **Subprocess.**
- [ ] Unset key, only `.faff-templates/` present: resolves `.faff-templates`, stderr carries `TEMPLATES_DEPRECATED_MSG`, whose remedy is `git mv .faff-templates .faff/templates`. **Subprocess.**
- [ ] Unset key, both present: resolves `.faff/templates`, stderr carries `TEMPLATES_SHADOWED_MSG`, whose remedy is the file-level move; stderr does not contain the string `git mv .faff-templates .faff/templates`. **Subprocess.**
- [ ] Unset key, neither present: resolves `.faff/templates`, stderr empty, and no directory is created. **Subprocess.**
- [ ] Key set to `records/tpl` with `.faff-templates/` present: resolves `records/tpl`, stderr empty. **Subprocess.**
- [ ] A trailing slash in a configured value is stripped: `records/tpl/` resolves to `records/tpl`.
- [ ] Resolving twice in one process emits the notice once: call `resetTemplatesDeprecationNotice()`, then `resolveTemplatesPath` twice against the same fallback root, and capture one notice. **In-process + reset**, asserted in `configSetSelftest` or a `.test.mjs` that imports `config.js` directly.
- [ ] `resetTemplatesDeprecationNotice()` makes the next resolution emit again: reset, resolve, reset, resolve, and capture two notices. **In-process + reset.**
- [ ] `git grep -n 'resetTemplatesDeprecationNotice' plugin/skills/faff/bin/lib/` shows the definition and export only; every call site is under `test/` or inside a `--selftest` function.

### From HOW, the ADR template consumer

- [ ] `faff adr format --json` with a parseable `adr.md` in `.faff/templates/` reports `template_path: ".faff/templates/adr.md"` and that file's headings.
- [ ] With the same file only in `.faff-templates/`, it reports `template_path: ".faff-templates/adr.md"` and that file's headings, plus `TEMPLATES_DEPRECATED_MSG` on stderr. **Subprocess.**
- [ ] With different parseable files in both, `.faff/templates/` wins on both `template_path` and `sections`, and stderr carries `TEMPLATES_SHADOWED_MSG`. **Subprocess.**
- [ ] With no `adr.md` anywhere, `faff adr new` output is byte-identical to the pinned golden at `test/adr-format.test.mjs:43`.
- [ ] A present-but-empty or heading-less `adr.md` at the canonical path degrades to Nygard and the degrade message names `.faff/templates/adr.md`; the assertion at `test/adr-format.test.mjs:93` is updated to that string.
- [ ] A template with headings but no `## Decision` still disables the L3 contradiction seam, and the note names the resolved path.
- [ ] `node --test test/adr-format.test.mjs` passes, with fixtures writing under `.faff/templates/` and new cases for the fallback and shadowed branches. Both new notice cases drive the real CLI, so each is a **subprocess**.
- [ ] `node plugin/skills/faff/bin/faff adr --selftest` passes, with the four fixture writers at `adr.js:1038-1058` moved to `.faff/templates/`, plus a fallback case and a shadowed case. Each of those two asserts its own notice text **in-process + reset**, and passes in either order.

### From HOW, the native-template map consumer

- [ ] `faff native-map get --type bug --json` reads a map at `.faff/templates/native-templates.yaml` and reports that path in its `path` field.
- [ ] With the map only at `.faff-templates/native-templates.yaml`, the read succeeds and `path` reports that file, with `TEMPLATES_DEPRECATED_MSG` on stderr and stdout still valid JSON. **Subprocess.**
- [ ] With maps at both, the canonical one wins.
- [ ] `faff native-map set` with no existing map writes `.faff/templates/native-templates.yaml` and creates the directory.
- [ ] `faff native-map set` with an empty `mappings` payload and `--json` reports `path: ".faff/templates/native-templates.yaml"` in its `empty-mappings` object, and the same with a configured key reports the configured write path. Covers `native-map.js:227`.
- [ ] `faff native-map set` re-run with identical content and `--json` reports `path: ".faff/templates/native-templates.yaml"` in its `unchanged` object, and the human form names the same path. Covers `native-map.js:243-249`.
- [ ] The no-`--force` "already exists with different content" refusal names the write path, not the deprecated one. Covers `native-map.js:251`.
- [ ] The success line names the write path. Covers `native-map.js:266`.
- [ ] `faff native-map set` with a map only at the deprecated path exits 2 without `--force`, writes nothing, and the stderr message names the deprecated file plus a file-level `mkdir -p` and `git mv` of that one file. Asserted both with `.faff/templates/` absent and with it already present holding an unrelated file; the message does not instruct a directory-level move in either case.
- [ ] The same command with `--force` writes the canonical path, leaves the deprecated file on disk, and names it in the output.
- [ ] The written file's header line names the path it was actually written to. Covers `native-map.js:49`.
- [ ] `faff native-map set --dry-run` prints text whose header matches what a real write would produce, and writes nothing.
- [ ] `faff native-map set --dry-run` on a repo whose map is only at the deprecated path exits 0, writes nothing, and carries the shadowed-map advisory on stderr alongside `TEMPLATES_DEPRECATED_MSG`. **Subprocess.**
- [ ] `faff native-map set --dry-run` against an existing byte-identical canonical map exits 0 and prints the same preview text an empty-repo dry run produces, rather than exiting 0 silently. This is the step-1a branch the guard's reordering newly makes reachable. **Subprocess.**
- [ ] `node --test test/native-map.test.mjs` passes, with `MAP_REL` at `:18` repointed and new cases for the fallback read, the both-present read, the shadow guard in both destination states, the two `path` fields, and the dry-run advisory.
- [ ] `node plugin/skills/faff/bin/faff native-map --selftest` passes; any notice assertion in it is **in-process + reset**.

### From HOW, the per-type override consumer

- [ ] `references/create.md` tier 2 instructs the agent to run `faff config templates-path --absolute` and join `<type>.md`, and names no directory literal.
- [ ] The `create.md:60` **Override files** paragraph no longer claims the `.faff/` ignore blocks a carve-out, states the current `.faff/*` plus `.faff/.gitignore` mechanism, and retains the config-CLI-readability half of the original rationale.
- [ ] The `tracking.templates_path` out-of-scope seam clause at `create.md:83` is deleted; the control-label seam in the same sentence survives.
- [ ] `faff validate-adapters` passes on every edited `SKILL.md` and reference.

### From HOW, documentation

- [ ] `docs/guide/cli.md:30` lists `templates-path` and its `--absolute` flag in the `config` verb set, and describes the fallback (naming `.faff-templates`, the one carved-out literal) and the stderr notice.
- [ ] The `native-map set` row at `docs/guide/cli.md:40` names the resolved location and no literal, and states the shadow guard and its `--dry-run` advisory.
- [ ] The `adr … format` row at `docs/guide/cli.md:178` names the resolved location and no literal.
- [ ] All three `.faff-templates` mentions in `faff-onboard/SKILL.md` (`:132`, `:139`, `:156`) are repointed, including step 7's commit recommendation.
- [ ] `faffter-noon-adr/SKILL.md` carries no `.faff-templates` literal; `resolved_format` at `:28` still routes through `faff adr format --json` unchanged.

### From the Assumptions section

- [ ] `git check-ignore -v .faff/templates/<file>` exits 1 (not ignored) for the file this slice commits, and `git status --porcelain .faff/templates/` shows it.
- [ ] A template file is committed under `.faff/templates/` in this repo, satisfying the ticket's fourth acceptance criterion.

### Gate ladder

- [ ] `faff regions selftest` passes.
- [ ] `node --test` passes across `test/`.
- [ ] `faff regions check` passes, with no new `.ts` sources introduced (this slice edits `.js` modules only).

### Integration smoke test

```
 1. mkdtemp a root; `git init`; write `.faff/.gitignore` with /*, !/.gitignore, !/templates/
 2. Assert `faff config templates-path --root <root>` prints `.faff/templates`, stderr empty
 3. mkdir `<root>/.faff-templates`; write a valid adr.md with headings `## A` / `## Decision`
 4. Assert `faff config templates-path` now prints `.faff-templates` and the fallback notice,
    with the directory-level `git mv`, is on stderr
 5. Assert `faff adr format --json --root <root>` reports template_path `.faff-templates/adr.md`
    and sections [A, Decision]
 6. mkdir `<root>/.faff/templates`; write a DIFFERENT valid adr.md there
 7. Assert `faff config templates-path` now prints `.faff/templates` and the SHADOWED notice is
    on stderr, and that stderr contains no directory-level `git mv .faff-templates` instruction
 8. rm -rf `<root>/.faff-templates`
 9. Assert step 5's output is identical except template_path is `.faff/templates/adr.md` and the
    sections are the canonical file's, and stderr is now empty
10. Assert `faff config templates-path --absolute` prints `<root>/.faff/templates`, run from a
    working directory that is not <root>
11. Assert `git check-ignore -v .faff/templates/adr.md` exits 1, and the file stages
```

If that path works, the resolver, the fallback, both notice texts, the one interpretation base, one consumer, and the gitignore carve-out are all connected.

## Self-review findings and resolutions

A fresh pass over the draft against the codebase, run in-context per the producer's inherited quality bar. Round-2 rows are marked; the round-1 rows below them are retained because the reviewer verified and upheld them.

| Round | Severity | Finding | Resolution |
|---|---|---|---|
| 2 | major | The notice latch has no reset, yet the spec put notice assertions in `adr --selftest`, which runs every template case in one process (`adr.js:1029-1059`). The added fallback case and shadowed case each expect the notice; the first consumes the latch and the second sees nothing. The "resolving twice in one process" item inherited the same dependency. Verified the harness is single-process as described. | Exported `resetTemplatesDeprecationNotice` for the in-process selftests and ruled every `.test.mjs` notice assertion a fresh CLI subprocess, with the decision recorded under HOW and the split stated as a rule. Every notice DONE item now names **subprocess** or **in-process + reset**, so no criterion is order-dependent, and a new DONE item keeps the reset out of production paths. |
| 2 | major | The single notice text's remedy, `git mv .faff-templates .faff/templates`, is wrong in the both-present state: with the destination present, git moves the source inside it and produces `.faff/templates/.faff-templates/`. No scenario or DONE item distinguished the two states' remedies. | Split the notice into `TEMPLATES_DEPRECATED_MSG` and `TEMPLATES_SHADOWED_MSG`, selected by the resolver's state, with the shadowed text naming a file-level migration and warning the directory-level move off explicitly. Added a scenario per state, a negative assertion that the shadowed stderr does not carry the directory-level command, DONE items per state, a failure mode for an operator following a wrong remedy, and smoke-test steps 6 and 7. The same reasoning applied to the `native-map set` guard, whose remedy became `mkdir -p` plus a file-level `git mv`, correct whether or not `.faff/templates/` already exists. |
| 2 | major | Four `NATIVE_MAP_REL` interpolations were unenumerated: the `empty-mappings` `--json` `path` (`:227`), the `unchanged` JSON `path` plus its human line (`:243-249`), the `--force` refusal (`:251`), and the success line (`:266`). Verified all four in the current file. The spec's own non-functional assertion forces the constant out of every one. | Replaced the prose change list with a seven-row anchor table covering `:12`, `:49`, `:227`, `:243-249`, `:251`, `:256`, `:266` and `:306`, each with its replacement. Noted the ordering constraint that `:227` returns before the write target is otherwise needed, so it must be resolved earlier. Added DONE items for both machine-read `path` fields and for the refusal and success lines. |
| 2 | minor | `--dry-run` returns at `native-map.js:237`, before the `:242-254` block the new guard extends, so `set --dry-run` on a deprecated-only repo previewed a clean write with no warning. Verified the early return's position. | Pinned it: the guard runs ahead of the early return and emits a stderr advisory, with `--dry-run` keeping exit 0, keeping its stdout, and still writing nothing. Recorded as a three-option decision, with the consequence that the deprecation notice now also fires under `--dry-run`, plus a scenario and a DONE item. |
| 2 | minor | Two criteria over `docs/guide/cli.md` conflicted: the non-functional assertion banned the literal `.faff-templates` in the file while a DONE item required that file to describe the fallback and the notice, whose text contains the literal. | Carved out the one entry whose subject is the deprecation. The assertion is now "the literal appears only within the `config templates-path` verb entry", which is stronger than exempting the file and still lets the reference name what the fallback falls back to. The three prose files keep the absolute ban. Decision recorded, grep item split accordingly. |
| 2 | minor | A configured `tracking.templates_path` had two interpretation bases: the CLI consumers do `path.join(root, rel)` while the `create.md` prose consumer would concatenate against its own working directory, so `/etc/faff` meant `<root>/etc/faff` in one lane and `/etc/faff` in the other, in the one lane no test covers. | Added `--absolute`, which prints `path.join(root, rel)` for the prose lane to use verbatim, so the base is computed once inside the resolver. Added a design principle, the decision, an anti-pattern, two scenarios, four DONE items, a non-functional assertion, and a smoke-test step. Deliberately **not** proposed: containment-checking the key, which `adr.js:61-66` records as a settled operator decision; the Out of scope section now says so explicitly and names `resolveDocsPath` as where such a rule would go for all seven keys at once. |
| 2 | minor | The spec said three times that FAFF-1299 carries no blocker edge to this ticket. The edge was added to the tracker on 2026-10-15. | Corrected in the Out of scope section, the migration-inert failure mode, the rationale's temporal anchor, and the Assumption. The `**Assumes:**` is kept as the pre-build validation step, with the reason stated: the edge gates scheduling, not the state of the working tree. FAFF-1299's new `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` and `gitignoreDirHazardLines` do not bear on this ticket and are not referenced. |
| 2 | minor | Producer conformance, not a spec defect: the round-1 reviewer's `faff-contract:spec-review-verdict` block declared 2 objections while its prose reported 5 findings. The verdict routed to `revise` either way, so nothing downstream was mis-gated, but a consumer parsing the block deterministically would have seen three fewer objections than the reviewer found. All six items in the dispatch were legitimate and all are applied above. | Recorded here as an observation for the reviewer's own conformance, not acted on in the spec body. Flagging it is the only action available to a producer; the block is the reviewer's artifact. |
| 1 | major | The dispatch brief's claim that `config check`'s known-key lint and the `WRITABLE_NAMESPACES` drift guard force a `.faffrc.example.yaml` line is wrong. Both read top-level key names only (`config.js:2485-2492`, `:2171-2182`, mirrored by `test/config-set.test.mjs:87-97`), and `tracking` is already a member. | Corrected in the spec rather than repeated. The example-file line is kept for documentation parity and the real reason is stated. Writing the brief's claim into the DONE list would have produced a criterion no test could fail. |
| 1 | major | My first draft reused `resolveDocsPath` with `templatesFallbackRel(root)` as the `fallbackRel` argument, copying `resolveAdrSupersededDocsPath:1202`. JavaScript evaluates that argument even when the configured value wins, so the deprecation notice would fire for operators who had explicitly set the key. | Changed to a standalone `resolveTemplatesPath` with explicit ordered steps, and the trap recorded as an anti-pattern so the implementer does not re-derive the shortcut. Upheld by the round-1 reviewer and retained unchanged. |
| 1 | major | `native-map set` writing only the canonical path, as the ticket specifies, silently strands an existing map at the deprecated path: the new file wins on read, the old one is dead, and the existing `--force` guard checks only the write target (`native-map.js:242-254`). | Added the both-paths existence guard with its refusal message and migration remedy, plus a scenario and a DONE item. Round 2 corrected the remedy's form and extended the guard across the `--dry-run` boundary. |
| 1 | minor | Three anchors in the explore findings are wrong: `TRACKING_KEYS`'s location, the ADR test filename, and the claim that `native-map` has no `.test.mjs`. | Corrected in a dedicated section at the top with verified anchors. Upheld by the round-1 reviewer and retained. |
| 1 | minor | My first draft justified the once-per-process notice latch by claiming `adr new` resolves the format twice in one process. It does not: `adr format` (`:705`), `adr new` (`:765`) and `adrLiveDecisions` (`:632`) each resolve once per verb, and `adrLiveDecisions` resolves outside its loop. | Rationale replaced with the verified case: `adr.js`'s own selftest calls `resolveAdrFormat` eight times (`:1032-1059`). Upheld by the round-1 reviewer and retained. |
| 1 | minor | The ticket lists `faffter-noon-adr/SKILL.md` as needing a reference update, but its `resolved_format` instruction at `:28` already routes through `faff adr format --json` and is correct as written. | Said so plainly rather than inventing an edit, and scoped the change to the `.faff-templates` literals in its description and intro prose at `:3` and `:10`. |
| 1 | minor | `gitignore-ensure --local` writes a literal `.faff/` line (`gitignore-ensure.js:66`), so git never descends and a local-mode repo cannot commit anything under `.faff/templates/`. | Recorded as an explicit out-of-scope item with its mechanism and its extension point. It is consistent with local mode committing nothing, but it is a behaviour change and the spec should not be silent about it. |
| 1 | minor | The acceptance criterion "byte-identical when no template is present" needed a reason, not an assertion: the resolved path appears in the two `adr.js` degrade messages. | Verified those fire only on a file that exists and is unusable (`adr.js:494-495, 504-512`), so an absent file produces no output in which the path could differ, and wrote the argument into the spec. |

**Round-2 rating.** Three majors this round, all three resolved in the spec rather than carried forward, and no blockers. The inherited cap forecloses `high` on one blocker or three *unresolved* majors; none is unresolved here, and each one's resolution is pinned by a named anchor plus at least one DONE item and, where behavioural, a scenario. The six dispatch items are applied in full and the one producer-conformance observation is recorded without acting on another party's artifact. Every non-trivial decision carries exactly one chosen marker; no punt marker was introduced; the single assumes marker is now a tracker-enforced dependency whose validation command is unchanged, which strengthens rather than weakens it.

confidence: high
spec-review: accept (fixes applied, rounds 1-2; no reviewer approve issued)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
