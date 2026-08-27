# FAFF-919: faff ratified-scope — assemble and validate the ratified-scope block

> Spec: faffter-dark-nlspec · 2026-08-27 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-919.

_Revised spec (round 3). The three design questions that parked round 2 have been decided by a human: (1) `--validate` stays a shape-only well-formedness check, kept as-is; (2) the round-2 DONE oracles are accepted as sufficient for a plain-CI ticket, kept as-is; (3) Option A — `admissibility.js` is left completely untouched, the new command reuses the existing exported `sectionBody`, and deduping `acceptanceSection` onto the shared scanner is deferred to FAFF-923. This half is plain-CI mergeable: an ordinary `node --test` run settles every done item._

This is the build spec for FAFF-919, the deterministic foundation split out of FAFF-907 ("let the spec-review design lenses defer to an already-ratified scope exclusion"). It defines a new read-only CLI command, `faff ratified-scope`, that assembles a plain-markdown `## Ratified scope` block from files committed to the repository and validates the shape of a supplied block; for its section scan it reuses the shared scanner `admissibility.js` already exports, adding no scanner and changing no shipped code. It is written for the build agent that will implement the command and its test, and for the human who reviews the merge. This half is plain-CI mergeable: an ordinary `node --test` run settles every done item. No eval sweep, no posture-change hold, no prompt edits.

## Already shipped against this surface

A scan of Done tickets in the Faff team against this ticket's surface (`faff ratified-scope`, the `admissibility.js` heading-scan helper, `docs/decisions.md`, `docs/prd/`) found related-but-not-superseding work; the premise still holds and this ticket proceeds unchanged:

- **FAFF-448** — "Decisions register — ADR-lite committed precedents that the resolve-attempt rules consult" (Done). Shipped `docs/decisions.md` and the `decisions.js` reader (`listEntries`, `kebabSlug`) that this command reads for its settled-precedents half. A dependency that already exists, not an overlap.
- **FAFF-264** — "Dedup the three docs-path resolvers into one parameterised helper" (Done). Shipped `resolveDocsPath` / `resolvePrdDocsPath`, which this command mirrors to resolve the PRD path. Reused, not re-built.
- No Done ticket ships `faff ratified-scope`; a full-repo search found no existing `ratified scope` reference. FAFF-907 (the calibration half) is not Done — it is blocked by this ticket.

## 1. WHY: problem and principles

The load-bearing idea: a ratified-scope block is an assembled excerpt, not a judgement. `faff ratified-scope` reads two committed sources (a PRD's non-goals section and the settled precedents in `docs/decisions.md`), splices their text into a fixed markdown shape, and prints it. It never parses the meaning of what it copies and never writes a file. Everything downstream that reasons about scope reads that block; this command only produces it and checks its shape.

**Problem statement.** FAFF-907's spec-review methodology verdict found two changes wearing one ticket and split them at the merge gate. The calibration half (FAFF-907, which this ticket blocks) teaches the design lenses to defer to a ratified exclusion, and it can only merge behind an eval sweep. This half is the deterministic machinery that half depends on: the command that assembles the block. Building it separately lets it land on ordinary CI ahead of the review-gated calibration half.

### Design principles

**A spec may never ratify its own scope.** Every citation the command emits comes from a file committed to the repository: the PRD's `## Non-goals` section, or a `docs/decisions.md` entry carrying a non-empty `Scope` field. The spec body under review is never an input. This boundary is why the block is assembled by a faff command over committed files rather than read out of the artifact being gated.

**The block carries excerpts and citations, never instructions.** The emitted markdown holds a fixed heading, a fixed provenance sentence, the verbatim non-goals text, and precedent citations. It contains no sentence that tells any reader what to do with the content. Deferral rules live in the calibration half's prompts, out of scope here.

**The absent-source case is empty, not an error.** A container with no PRD and no scoped decisions produces no block and a distinct exit code, not a failure. faff dogfoods itself and has no `docs/prd/` directory (ADR-0069 rules faff out of having a PRD), so the PRD half is always empty at faff's own root. The exit code there is then decided by the precedents half alone: as of writing, faff's `docs/decisions.md` holds one entry and it carries a non-empty `Scope`, so `faff ratified-scope --assemble` at faff's own root emits a precedents-only block and exits 0. The exit-3 "nothing ratified" path is a real code path, but it is asserted against a fixture with no PRD and no scoped decision, never against the live root (the live root's exit code is data-dependent — see the DONE list note). This is correct behaviour, not a gap to paper over.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | JavaScript (CommonJS) | The dispatcher. Eagerly requires each `lib/<name>.js`, maps subcommand strings to handlers in the single `COMMANDS` object literal (ADR-0014), and derives USAGE + the `lint-cli-doc` check from `Object.keys(COMMANDS)`. |
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript (CommonJS) | Exports the shared scanner `sectionBodyRange` / `sectionBody` (lines 150-179) and `headingLevel`. This command's `nonGoalsSection` becomes the first external caller of `sectionBody`, with its default boundary. The module's separate hand-rolled `acceptanceSection` (lines 300-313) is **not** touched by this ticket; deduping it onto the shared scanner is deferred to FAFF-923. |
| `plugin/skills/faff/bin/lib/decisions.js` | JavaScript (CommonJS) | Read-only reader over `docs/decisions.md`. `listEntries(root)` returns `{topic, id, chosen, rationale, scope, matches, date, adr}` per entry (line 83). `kebabSlug(topic)` yields the citation id. An absent file is a clean empty list; only a genuinely unreadable file throws. |
| `plugin/skills/faff/bin/lib/prd.js` | JavaScript (CommonJS) | `prdDir(root)` resolves the PRD directory via config (`loadConfig(root)` reads `.faffrc.yaml`), `prdSlug(name)` slugs a container name, `prdTemplate` fixes the `## Non-goals` heading with a `_TODO._` placeholder body. Exports at line 336. |
| `plugin/skills/faff/bin/lib/argv.js` | JavaScript (CommonJS) | The shared fail-closed flag parser: `parseArgs(args, SPEC)`, `usageError(errors, usage)`. |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript (CommonJS) | `findRoot(start)` walks up to `.git`/`.faff`; the `--root` default. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (CommonJS) | `faff contract <name> [--in FILE]` reads its input from `--in FILE` else stdin (`fs.readFileSync(inFile)` else `fs.readFileSync(0, "utf8")`, line 3002). This command mirrors that input source but adds a byte cap the precedent lacks (see the validate section). |
| `plugin/skills/faff/bin/lib/tier.js` | JavaScript (CommonJS) | Closest template: a flat, pure-over-a-file command with `parseArgs` + `--json` + `--selftest`. |
| `test/decisions.test.mjs` | JavaScript (ESM) | Closest test template: builds a temp fixture repo with `mkdtempSync`, writes `docs/decisions.md`, runs with `--root <tmpdir>`. |
| `test/helpers/run-cli.mjs` | JavaScript (ESM) | `runCli(args, {cwd, input, env})` spawns the real `bin/faff` as a child and returns `{stdout, stderr, code}`. Because it is a child spawn, a test-process `fs` monkeypatch cannot observe the child's syscalls — the write/read/network guards below therefore run the handler in-process, not through `runCli`. |
| `docs/guide/cli.md` | Markdown | The CI-lint-enforced per-subcommand reference (`faff lint-cli-doc`, FAFF-237). Every `COMMANDS` key needs a row or the check fails. |

**Scope statement.** This sits at the read-only reader tier of the faff CLI, alongside `faff decisions` and `faff next`: a pure function over committed files with no tracker call, no network, and no writes.

## 2. OUT OF SCOPE

- **Prep and occupant wiring.** What's excluded: the faff-prep step that runs the command into `$scratch/ratified-scope.md`, and the `faffter-dark-spec-review` occupant appending it to the lens context. Why: that is the calibration half's plumbing, gated behind the eval sweep. Extension point: `plugin/skills/faff-prep/SKILL.md` (the run-ledger read and the scratch write) and `plugin/skills/faffter-dark-spec-review/SKILL.md`, in FAFF-907. When FAFF-907 wires prep, its invocation is `faff ratified-scope --assemble --container <c>` (the surface this ticket ships).
- **Refuter-prompt edits and the deferral rule.** What's excluded: the `## Ratified scope` clause in `SKILL.md` and the per-lens clauses in `refute-architectural.md` / `refute-infosec.md` / `refute-qa.md`. Why: prose-driven autonomous-posture change, held behind the sweep. Extension point: the four prompt surfaces named above, in FAFF-907.
- **Eval fixtures and the review-bench refresh.** What's excluded: `refutation-spec-011.json` / `-012.json`, and the `eval/review-bench/lenses/refute-*.md` copies. Why: they test lens behaviour, which this ticket does not change. This command introduces no LLM-judgement seam, so it needs no eval case of its own. Extension point: `eval/cases/`, in FAFF-907.
- **Deduping `acceptanceSection` onto the shared scanner.** What's excluded: rewriting `admissibility.js`'s hand-rolled `acceptanceSection` (lines 300-313) to route through `sectionBody`. Why: `acceptanceSection` feeds the shipped `faff admissible --strict` gate, and the two scanners diverge on two edge inputs (an h1 after the section; a fenced `## ` line), so folding it would silently move a shipped gate's boundary — a review-gated change that does not belong in a plain-CI dedup. This ticket reuses the shared scanner for its own new call site only and leaves `admissibility.js` untouched. Extension point: a separate shipped-gate-change ticket, **FAFF-923**.
- **Any behaviour change to how the lenses review today.** What's excluded: the design lenses' current gating behaviour is untouched. Why: this ticket ships only the block producer. Extension point: the aggregation and prompt surfaces, in FAFF-907.
- **Authenticity or provenance verification of a supplied block.** What's excluded: `--validate` proving a block was actually produced by `--assemble` from committed files. `--validate` checks shape only — a hand-authored block that carries the heading, the provenance-anchor prefix, and any one expected subsection passes. Why: a structural check in isolation cannot re-derive the source files without defeating the point of validating a block on its own; authenticity would need a signature or a re-assembly, neither of which this surface owns. Extension point: a future signed-block or re-assembly comparison, in FAFF-907's consumer if it ever needs trust rather than shape.
- **Following a linked-mode PRD's URL.** What's excluded: dereferencing a `**PRD:** <url>` header to fetch a remote PRD. Why: the command is offline and pure; a linked PRD legitimately yields no local non-goals section. Extension point: a future network-capable resolver; not planned.

## 3. WHAT: vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Ratified-scope block | The plain-markdown document `faff ratified-scope --assemble` prints: a fixed `## Ratified scope` heading, a fixed provenance sentence, an optional non-goals section, and an optional settled-precedents list. Plain markdown, never a `faff-contract:*` JSON block. |
| Non-goals section | The verbatim body of a PRD's `## Non-goals` heading, when it resolves non-empty and is not the scaffold placeholder. |
| Settled precedent | A `docs/decisions.md` entry carrying a non-empty `Scope` field (v1 rule; see below). Entries with an empty `Scope` are skipped. |
| Placeholder-only | A `## Non-goals` body that, once trimmed, is empty or equals `prdTemplate`'s `_TODO._` marker. Treated as absent. |
| Heading-scan helper | The shared fence-aware section-body scanner `sectionBody(text, headingRe)` already exported by `admissibility.js`. This command is its first external caller; it passes no boundary option. |
| Well-formed block | A block that passes `--validate`'s structural check: the exact heading line, the provenance-anchor prefix, and at least one recognised subsection. Well-formedness is a shape property, not proof of authenticity. |

**What qualifies as a settled precedent (v1 rule).** The rule is purely structural: a `docs/decisions.md` entry qualifies if and only if its `Scope` field is a non-empty string. The command does **not** attempt to distinguish a descriptive `Scope` ("the v1 checkout deployment") from an exclusionary one — the register's own reader documents `Scope` as descriptive and never consults it for matching (`decisions.js`, `matchDecision` comment), and `validateEntries` already requires every valid entry to carry a non-empty `Scope`, so in a well-formed register every entry qualifies. This is intentional v1 behaviour: the block **cites** the precedent (topic, chosen, scope, all verbatim) and asserts nothing about whether the scope is an exclusion. The calibration half (FAFF-907) decides how a lens uses the citation; this command only copies it.

### The `faff ratified-scope` command

A flat command (no second-token subcommand vocabulary), so it needs no `*_SURFACE` declaration in `cli-surface.js`: `assembleSurfaces()` defaults any `COMMANDS` key absent from `DISPATCH_SURFACES` to `{kind:"flat", subcommands:{}, spec:null}`, and the bijection selftest is derived from `COMMANDS` itself.

```
COMMAND faff ratified-scope:
  MODE (exactly one required):
    --assemble           # assemble the block from committed sources and print it
    --validate           # structurally check the shape of a supplied block

  --container <name>     # assemble only. The PRD container whose non-goals to read. Optional.
  --root <dir>           # assemble only. Repository root. Default: findRoot().
  --in <file>            # validate only. The block to check. Default: stdin.
  --json                 # validate only. Emit {valid, problems} instead of a human line.
  --selftest             # run the in-process selftest table.

MODE --assemble:
  READS   <root>/<prdDir>/<prdSlug(container)>.md   # only when --container is given
          <root>/docs/decisions.md                  # always
          <root>/.faffrc.yaml                        # via prdDir's loadConfig, when --container is given
  WRITES  nothing
  STDOUT  the `## Ratified scope` markdown block (exit 0), else empty (exit 3)

  EXIT 0  at least one of {non-goals section, >=1 scoped precedent} resolved; block on stdout
  EXIT 3  nothing ratified; stdout empty
  EXIT 2  usage error, or an unreadable/malformed source (fail loud)

MODE --validate:
  READS   --in <file>, else stdin — capped at VALIDATE_MAX_BYTES (see below)
  WRITES  nothing
  STDOUT  a human "OK"/"INVALID" line, or {valid, problems} under --json

  EXIT 0  the block is well-formed (shape only)
  EXIT 1  the block is malformed or empty (fail loud, problems listed)
  EXIT 2  usage error, the --in file is unreadable, or the input exceeds VALIDATE_MAX_BYTES
```

**Chosen:** `--assemble` and `--validate` are explicit, mutually exclusive modes, exactly one required; neither or both is an exit-2 usage error. Rationale: FAFF-919's acceptance criteria dictate the `faff ratified-scope --assemble --container <c>` form, and a symmetric `--validate` flag reads better than an implicit bare default. The FAFF-907 source spec sketched a flagless assemble-and-print form; this ticket owns the command surface, and FAFF-907 (blocked by this ticket) will call the shipped form. See the design-decision rationale for the rejected bare-default alternative.

**Chosen:** `--validate` reads its input from `--in FILE` else stdin, but **bounded**. Rationale: the `--in` else stdin source mirrors `faff contract <name>` (`contract-defs.js` line 3002); reusing it keeps the CLI's input conventions uniform. The precedent reads unbounded (`fs.readFileSync(0)` buffers arbitrarily large stdin), which is a memory-exhaustion vector on a constrained CI or agent host. This new surface does not inherit that flaw: it caps the read at `VALIDATE_MAX_BYTES` and exits 2 loud when exceeded. See the validate section for the cap value and mechanism.

**Chosen:** `--json` is meaningful only with `--validate` (it emits `{valid, problems}`); passing it with `--assemble` is an exit-2 usage error. Rationale: the assemble output is markdown, which is itself the machine-consumable artifact, so a JSON wrapper would add a second output shape for no consumer; the fail-closed CLI ethos rejects an ignored flag rather than silently dropping it.

### The assembled block

```
RECORD RatifiedScopeBlock:
  heading:    "## Ratified scope"          # fixed, exact
  provenance: Text                         # fixed sentence, exact (see below)
  non_goals:  Optional<Section>            # present iff a PRD non-goals section resolved non-empty and non-placeholder
    container:    Text                     # the --container value
    source_path:  Path                     # PRD path relative to root, e.g. docs/prd/checkout-service.md
    body:         Text                     # the `## Non-goals` section body verbatim, unparsed
  precedents: List<Precedent>              # possibly empty; entries with empty Scope skipped
    id:     Slug                           # decisions.kebabSlug(topic), the citation handle
    topic:  Text
    chosen: Text                           # may be null/blank; rendered as-is
    scope:  Text                           # non-empty by construction

  CONSTRAINT non_goals absent AND precedents empty  =>  exit 3, no block emitted
  CONSTRAINT the block contains only excerpts and citations, no instruction to any reader
```

The fixed provenance sentence (emit verbatim), and the stable anchor prefix the validator keys on:

```
PROVENANCE_SENTENCE := "Assembled by `faff ratified-scope` from files committed to this repository. The spec under review is not a source and cannot write to any of these files."
PROVENANCE_ANCHOR   := "Assembled by `faff ratified-scope`"   # the stable prefix, checked by --validate
```

Rendered block (non-goals present, one scoped precedent):

```markdown
## Ratified scope

Assembled by `faff ratified-scope` from files committed to this repository. The spec under review is not a source and cannot write to any of these files.

### Non-goals: PRD `checkout-service` (docs/prd/checkout-service.md)

- No horizontal scaling in v1. One api instance, one region.
- No connection pooler and no read replica.

### Settled precedents (docs/decisions.md)

- **Single-instance rate limiting for v1** (`single-instance-rate-limiting-for-v1`)
  - Chosen: the limiter keeps its counters in process.
  - Scope: the v1 checkout deployment; any per-client throttle on it.
```

When the non-goals section is absent, its `### Non-goals: …` block is omitted entirely; when no scoped precedent resolves, the `### Settled precedents …` block is omitted entirely. At least one of the two is always present in an emitted block (otherwise exit 3).

**Anti-pattern:** emitting the `## Ratified scope` heading and provenance sentence with neither subsection. Why: assemble returns exit 3 (no block) in that case, and `--validate` treats a heading-plus-provenance-only block as malformed. The two modes must stay symmetric.

## 4. HOW: behaviour

### The non-goals scanner (reuses the shared scanner, no change to admissibility.js)

`admissibility.js` already exports the scanner: `sectionBody(text, headingRe, opts)` returns the joined body text of the first heading matching `headingRe` (found outside code fences), running to the next heading of equal-or-higher level, an optional `opts.extraStop` predicate, or EOF; `null` when no such heading exists. `nonGoalsSection` (new, in `ratified-scope.js`) reuses that exported `sectionBody` with its **default** boundary for `/^\s*##\s+non-goals/i`. It passes no option, copies no scanner logic, and does not modify `admissibility.js`.

`sectionBody` / `sectionBodyRange` are already exported and currently have no external callers (only in-file `dodClassify` / `dodSplit` use them); this command becomes the first external caller. That is the whole extent of the shared-helper reuse.

```
FUNCTION nonGoalsSection(prdText):                        # new, in ratified-scope.js — existing default scanner
  RETURN sectionBody(prdText, /^\s*##\s+non-goals/i)
```

The module's separate hand-rolled `acceptanceSection` (lines 300-313), which stops at any `## ` heading and is not fence-aware, feeds `prdStrictCheck` → `classifyAcceptanceCriteria` → the `faff admissible --strict` gate for external PRDs. It is **left untouched** by this ticket. Its divergence from the shared scanner on two edge inputs (an h1 after the section; a fenced `## ` line) and its dedup onto the shared scanner are deferred to FAFF-923 (see the design-decision rationale).

**Anti-pattern:** copying `sectionBody`'s logic into `ratified-scope.js`, or adding a third scanner for non-goals. Why: the shared scanner is already exported for exactly this reuse; add a call site, not a copy.

**Anti-pattern:** "tidying" `admissibility.js`'s `acceptanceSection` in this ticket while touching the shared scanner. Why: `acceptanceSection` feeds the shipped `faff admissible` gate; folding it onto the fence-aware, equal-or-higher-boundary shared scanner would silently move that gate's section boundary on inputs (a) an h1 after the section and (b) a fenced `## ` line. That gate-boundary change is a separate reviewable ticket, FAFF-923, not this plain-CI dedup.

### Assembling the block

```
PROCEDURE assemble(root, container):
  1. non_goals := null
  2. IF container is given:
     a. prd_path := path.join(prdDir(root), prdSlug(container) + ".md")   # prdDir reads .faffrc.yaml via loadConfig
     b. IF fs.existsSync(prd_path):
        i.   text := readFileSync(prd_path)          # a read throw => exit 2 (unreadable source)
        ii.  body := nonGoalsSection(text)
        iii. IF body is not null AND not placeholderOnly(body):
               non_goals := { container, source_path: relative(root, prd_path), body }
  3. precedents := []
     FOR entry IN decisions.listEntries(root):        # absent docs/decisions.md => [] (not an error)
       IF entry.scope is a non-empty string:
         append { id: entry.id, topic: entry.topic, chosen: entry.chosen, scope: entry.scope }
  4. IF non_goals is null AND precedents is empty:
       RETURN { exit: 3, block: "" }
  5. RETURN { exit: 0, block: render(non_goals, precedents) }

PREDICATE placeholderOnly(body):
  t := body.trim()
  RETURN t === "" OR t === "_TODO._"

PROCEDURE render(non_goals, precedents):
  out := ["## Ratified scope", "", PROVENANCE_SENTENCE, ""]
  IF non_goals is not null:
    out += ["### Non-goals: PRD `" + non_goals.container + "` (" + non_goals.source_path + ")", "",
            non_goals.body.trim(), ""]              # trim leading/trailing blank lines only
  IF precedents is non-empty:
    out += ["### Settled precedents (docs/decisions.md)", ""]
    FOR p IN precedents:
      out += ["- **" + p.topic + "** (`" + p.id + "`)",
              "  - Chosen: " + (p.chosen ?? ""),
              "  - Scope: " + p.scope]
    out += [""]
  RETURN out.join("\n")
```

`decisions.listEntries(root)` treats an absent `docs/decisions.md` as a clean empty list (see `decisions.js` line 83); only a genuinely unreadable file throws. `render` preserves the ordering `listEntries` returns (document order in the register). A precedent's `chosen` may be blank; render it as an empty value rather than skipping the sub-bullet, so the shape is uniform.

### Validating a block — a well-formedness check, not a trust gate

The validator is a deterministic **structural** check: it confirms a block has the shape `assemble` emits. It parses nothing semantic, reads no source file, and does **not** prove the block was actually produced by `assemble`.

```
PROCEDURE validate(text):
  problems := []
  lines := text.split(/\r?\n/)
  IF text.trim() === "":
    RETURN { valid: false, problems: ["empty input"] }
  IF no line equals "## Ratified scope" exactly:
    problems += "missing the `## Ratified scope` heading"
  IF text does not contain PROVENANCE_ANCHOR:                 # the stable prefix only — see below
    problems += "missing the provenance sentence"
  has_non_goals  := some line matches /^### Non-goals: PRD /
  has_precedents := some line equals "### Settled precedents (docs/decisions.md)"
  IF NOT (has_non_goals OR has_precedents):
    problems += "no non-goals section and no settled-precedents section (an empty block is never emitted)"
  RETURN { valid: problems.length === 0, problems }
```

**"Missing provenance" is defined precisely: the `PROVENANCE_ANCHOR` prefix is absent from the text.** The validator checks only that stable prefix, not the full sentence — a future one-word tweak to the sentence's tail must not silently start rejecting live blocks; the assemble side remains the single source of the exact wording. The malformed-provenance test therefore pins the anchor-absent case (a block whose provenance line does not begin with `` Assembled by `faff ratified-scope` ``), not a full-sentence mismatch.

**Chosen:** `--validate` is a well-formedness check only — it is **not** an authenticity or provenance gate. Rationale: the check reads no source file, so it cannot re-derive the committed non-goals or precedents to prove the block matches them; a block anyone hand-crafts with the heading, the anchor prefix, and any one expected subsection passes. This is deliberate — validating a block in isolation is the point — but it means the pass carries no trust. The assemble side owns the exact text; the validate side only confirms the container is the right shape to be consumed.

**Anti-pattern:** treating a `--validate` pass as proof the block was assembled from committed files. Why: `--validate` checks shape, not origin. FAFF-907's consumer must obtain the block by running `--assemble` itself (or from a trusted producer), never by trusting an arbitrary supplied block merely because it validates. A validate-pass gates malformed input out; it does not gate untrusted input in.

### Bounding the validate input

```
CONSTANT VALIDATE_MAX_BYTES := 1048576     # 1 MiB

PROCEDURE readValidateInput(in_file):
  # A well-formed ratified-scope block is a few hundred bytes to a few KiB; 1 MiB is ~1000x
  # headroom and still bounds a hostile or accidental multi-GB stdin/file on a constrained host.
  IF in_file is given:
    st := fs.statSync(in_file)                          # throw => exit 2 (unreadable --in file)
    IF st.size > VALIDATE_MAX_BYTES:
      stderr "faff ratified-scope --validate: input exceeds " + VALIDATE_MAX_BYTES + " bytes"; EXIT 2
    RETURN fs.readFileSync(in_file, "utf8")
  ELSE:
    # stdin (fd 0): read in bounded chunks so an unbounded pipe never buffers past the cap.
    raw := read fd 0 into a buffer, stopping once total read > VALIDATE_MAX_BYTES
    IF total read > VALIDATE_MAX_BYTES:
      stderr "faff ratified-scope --validate: input exceeds " + VALIDATE_MAX_BYTES + " bytes"; EXIT 2
    RETURN raw.toString("utf8")
```

The file path uses `statSync` to reject an oversize file before reading a single byte. The stdin path reads in bounded chunks (a `fs.readSync` loop into a fixed buffer, or an equivalent capped read) rather than `fs.readFileSync(0)`, so a hostile `yes | faff ratified-scope --validate` cannot exhaust memory. Exceeding the cap is an exit-2 error with a loud stderr line, not a silent truncation (truncating could turn a malformed oversize block into a spuriously valid one).

**Chosen:** the cap is 1 MiB (`VALIDATE_MAX_BYTES = 1048576`). Rationale: a real ratified-scope block is a few hundred bytes to a few KiB (a heading, one sentence, a short non-goals excerpt, a handful of precedents); 1 MiB leaves roughly three orders of magnitude of headroom for an unusually large but legitimate block while still bounding the worst case to a fixed, small allocation. A tighter cap risks rejecting a legitimately large register's precedents list; a looser cap weakens the guard for no benefit.

### Command handler

```
PROCEDURE cmdRatifiedScope(args):
  IF args includes "--selftest": RETURN ratifiedScopeSelftest()
  parsed := parseArgs(args, RATIFIED_SCOPE_SPEC)
  IF parsed.errors: RETURN usageError(parsed.errors, USAGE)

  assemble_mode := parsed.values["--assemble"] === true
  validate_mode := parsed.values["--validate"] === true
  IF assemble_mode === validate_mode:                          # neither or both
    RETURN usageError([{code:"mode", detail:"exactly one of --assemble / --validate is required"}], USAGE)

  IF assemble_mode:
    IF parsed.values["--in"] or parsed.values["--json"]: usage error, exit 2   # validate-only flags
    root := parsed.values["--root"] || findRoot()
    container := parsed.values["--container"] ?? null
    TRY: result := assemble(root, container)
    CATCH read error: stderr "faff ratified-scope: cannot read <path> (<msg>)"; RETURN 2
    IF result.exit === 0: process.stdout.write(result.block.endsWith("\n") ? result.block : result.block + "\n")
    RETURN result.exit                                         # 0 or 3

  # validate_mode
  IF parsed.values["--container"] or parsed.values["--root"]: usage error, exit 2  # assemble-only flags
  in_file := parsed.values["--in"]
  TRY: raw := readValidateInput(in_file)                       # bounded; may EXIT 2 on oversize / unreadable
  CATCH: stderr "faff ratified-scope --validate: cannot read <in_file> (<msg>)"; RETURN 2
  v := validate(raw)
  IF parsed.values["--json"]: console.log(JSON.stringify(v))
  ELSE IF v.valid: console.log("OK — well-formed ratified-scope block")
  ELSE: FOR p IN v.problems: process.stderr.write("INVALID: " + p + "\n")
  RETURN v.valid ? 0 : 1
```

`RATIFIED_SCOPE_SPEC` follows the sibling pattern:

```
RATIFIED_SCOPE_SPEC = { flags: {
  "--assemble":  { arity: 0 },
  "--validate":  { arity: 0 },
  "--container": { arity: 1 },
  "--root":      { arity: 1 },
  "--in":        { arity: 1 },
  "--json":      { arity: 0 },
  "--selftest":  { arity: 0 },
}, positionals: { min: 0, max: 0, name: "(none)" } }
USAGE = "usage: faff ratified-scope (--assemble [--container <c>] [--root <dir>] | --validate [--in <file>] [--json])"
```

### Wiring

- Add `const { cmdRatifiedScope } = require("./lib/ratified-scope");` to the require block in `bin/faff`, in alphabetical position among the sibling requires.
- Add `"ratified-scope": cmdRatifiedScope,` to the `COMMANDS` object literal in `bin/faff`. Placement is free (the object is not ordered-significant); put it near `"decisions"` and `"prd"` for readability.
- Add one row to `docs/guide/cli.md` in the same reader-commands table that holds the `decisions` / `prd` rows, matching the existing single-line `` | `command …` | description | `` format. Confirm the exact table by reading the file; the `decisions` row is the nearest sibling to mirror.

### Edge cases

| Condition | Behaviour |
|---|---|
| `--assemble`, no `--container`, no `docs/decisions.md` | exit 3, empty stdout. |
| `--assemble --container <name>`, PRD file absent | PRD half skipped; precedents half alone decides the exit code. Not an error. |
| PRD in linked mode (a `**PRD:**` header, no `##` sections) | `nonGoalsSection` finds no heading, returns null; PRD half skipped. Not an error. |
| `## Non-goals` present but body is `_TODO._` or empty | Treated as absent (`placeholderOnly`). |
| `docs/decisions.md` present, every entry has empty `Scope` | Precedents list empty; exit code decided by the non-goals half. |
| `docs/decisions.md` genuinely unreadable (permissions, malformed read) | `listEntries` throws; caught; exit 2, loud stderr. |
| `--validate` on empty stdin | `{valid:false}`, exit 1, problem "empty input". |
| `--validate` input exceeds `VALIDATE_MAX_BYTES` (oversize `--in` file or unbounded stdin) | exit 2, loud stderr; no allocation past the cap. |
| `--validate` provenance line does not begin with the anchor prefix | exit 1, problem "missing the provenance sentence". |
| `--validate` on assemble's own well-formed output | exit 0. (Shape round-trip: `assemble | validate` is well-formed. Not an authenticity claim.) |
| Both `--assemble` and `--validate`, or neither | exit 2 usage error. |
| `--in` with `--assemble`, or `--container`/`--root` with `--validate` | exit 2 usage error (wrong-mode flag). |

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fixture root with docs/prd/demo.md carrying a real `## Non-goals` section
  And docs/decisions.md carrying one entry with a non-empty Scope
When `faff ratified-scope --assemble --root <root> --container demo` runs
Then it exits 0
  And stdout begins with "## Ratified scope"
  And stdout contains the non-goals body verbatim and the decision's Scope text
```

```
Given a fixture root whose docs/prd/demo.md `## Non-goals` body is exactly `_TODO._`
  And whose docs/decisions.md entries all have an empty Scope field
When `faff ratified-scope --assemble --root <root> --container demo` runs
Then it exits 3
  And stdout is empty
```

```
Given the well-formed block produced by a prior `--assemble` run
When it is piped to `faff ratified-scope --validate`
Then the command exits 0
```

## 6. Design decision rationale

**Should `--assemble` be an explicit flag, or the bare default with `--validate` as the only flag?**

| Option | For | Against |
|---|---|---|
| Explicit `--assemble` + `--validate`, exactly one required | Matches FAFF-919's stated AC (`--assemble --container`); symmetric; no hidden default | Diverges from the FAFF-907 source spec's flagless sketch |
| Bare default assembles, `--validate` switches | One fewer flag on the common path | The AC names `--assemble`; a bare default that silently assembles is less discoverable and collides with `--selftest`-style bare invocations |

**Chosen:** explicit `--assemble` and `--validate`, exactly one required. FAFF-919's acceptance criteria write `faff ratified-scope --assemble --container <c>` directly, and this ticket owns the surface FAFF-907 will later call. The FAFF-907 source spec's flagless form predates the split; it is superseded here and its prep wiring (out of scope) will use `--assemble`.

**Where does `--validate` read its input, and is it bounded?**

Options: a positional file argument; `--in FILE` else stdin; stdin only. Bounding: unbounded (mirror the precedent) vs a fixed byte cap.

**Chosen:** `--in FILE` else stdin, bounded at 1 MiB. The `--in` else stdin source mirrors `faff contract <name>` (`contract-defs.js`), the established input contract for a faff command that validates a supplied document, so a caller can both pipe and point at a file. The precedent's read is unbounded; this surface adds a fixed cap (`statSync` guard for files, chunked capped read for stdin) so an oversize file or a hostile unbounded pipe exits 2 loud rather than exhausting memory. The precedent's flaw is noted but not fixed here (out of scope); the new surface simply does not inherit it.

**How strict is validation, and what does a pass mean?**

Options: full re-parse and re-assembly comparison; structural presence checks (heading, provenance anchor, at least one subsection); heading presence only.

**Chosen:** structural presence checks — a well-formedness check, not an authenticity gate. A full re-assembly comparison would require the validator to re-read the source files, which defeats the point of validating a block in isolation and couples it to source content it does not own. Heading-only is too loose: it would accept the empty-block shape that `assemble` never emits. The middle option is deterministic, symmetric with `assemble`, and rejects exactly the malformed and empty cases the AC names. A pass proves the block is the right shape to be consumed; it proves nothing about origin, so a downstream consumer must obtain the block from `--assemble` itself, never trust an arbitrary block because it validates. The provenance check anchors on the stable sentence prefix (`PROVENANCE_ANCHOR`) so the assemble side stays the single source of the exact wording.

**Is the block a `faff-contract:*` JSON block?**

**Chosen:** no. The block is plain markdown (an assembled excerpt with citations), so nothing is added to `contract-defs.js` or a `.schema.json`, and `faff contract <name>` validators are unrelated. The explore of the repository found no existing `ratified scope` reference anywhere; this is genuinely new plain-markdown surface.

**Does this ticket fold `acceptanceSection` onto the shared scanner (Option A vs Option B)?**

| Option | For | Against |
|---|---|---|
| **A: leave `admissibility.js` untouched.** New command reuses the exported default `sectionBody`; `acceptanceSection` dedup deferred to FAFF-923 | No shipped gate boundary moves; the ticket stays a pure additive read-only command; plain-CI-sized | The `acceptanceSection` duplicate scanner survives one more ticket |
| B: dedup `acceptanceSection` onto the shared scanner in this ticket | Removes the duplicate now | The two scanners diverge on (a) an h1 after the section and (b) a fenced `## ` line, and `acceptanceSection` feeds the shipped `faff admissible --strict` gate — folding it would silently move that gate's boundary, a review-gated change that does not fit a plain-CI dedup |

**Chosen: Option A.** The new command reuses the existing default `sectionBody` (fence-aware, stops at the next equal-or-higher heading) for its `nonGoalsSection`, and `admissibility.js` is **not** modified. `acceptanceSection`'s divergence on two edge inputs (an h1 after the section; a fenced `## ` line) and its proper dedup onto the shared scanner are deferred to a separate shipped-gate-change ticket, **FAFF-923**. Rationale: folding `acceptanceSection` onto the shared scanner would silently move the shipped `faff admissible` gate boundary for external PRDs; the safe, plain-CI-sized change is to not touch it. At the time of writing, `sectionBody` and `sectionBodyRange` already live in `admissibility.js`, are exported, and have no external callers, so reuse is a single new call site with no code change to the module.

**Keep or drop the "opens only these files" read-trace assertion?**

**Chosen:** drop it to a non-asserted note; keep no-write and no-network as the asserted guarantees. Rationale: `prdDir(root)` resolves through `loadConfig(root)`, which reads `.faffrc.yaml`, and `findRoot` (the `--root` default) probes ancestor directories, so an exact "opens only {PRD, decisions.md}" allowlist is brittle and would fail on legitimate config resolution. The load-bearing security properties are that the command never writes and never reaches the network; both are asserted in-process below. Confidentiality (not reading unrelated files) is guaranteed by construction here — the command only ever opens the resolved PRD path, `docs/decisions.md`, and the config `prdDir` consults — and a brittle path-allowlist test buys little over that. A future ticket may add a read-trace if the surface grows.

## 7. Open questions and assumptions

### Open questions

None. Every decision above is closed by repository precedent or a plain v1 rule.

### Assumptions

**Assumes:** `prdDir(root)` and `prdSlug(name)` are exported by `plugin/skills/faff/bin/lib/prd.js` and resolve a container name to its PRD path the same way `faff prd path <container>` does. *Validate:* confirm both appear in `prd.js`'s `module.exports` (they do, line 336), and that `path.join(prdDir(root), prdSlug(container) + ".md")` equals what `faff prd path <container>` prints for a fixture root. Note `prdDir` reads `.faffrc.yaml` via `loadConfig`.

**Assumes:** `sectionBody(text, headingRe)` is exported by `admissibility.js` and, with no `opts` passed, scans fence-aware to the next equal-or-higher heading. *Validate:* confirm `sectionBody` appears in `admissibility.js`'s `module.exports` (it does, line ~1247), and read `sectionBodyRange` / `sectionBody` (lines 150-179) to confirm the default boundary. Do **not** pass an option and do **not** edit `admissibility.js`; `nonGoalsSection` is a new default call site.

**Assumes:** `decisions.listEntries(root)` returns per-entry `{topic, id, chosen, scope, …}` and treats an absent `docs/decisions.md` as an empty list. *Validate:* read `decisions.js` lines 83-100; the selftest already asserts the absent-file case, and `validateEntries` (line ~105) requires a non-empty `Scope` on every valid entry.

## 8. DONE: definition of done

### From WHY

- [ ] `faff ratified-scope --assemble --root <fixture>` on a fixture with no PRD and a `docs/decisions.md` whose entries all have an empty `Scope` exits 3 with empty stdout. (The exit-3 path is asserted against this fixture, never the live faff root; at the live root the sole `docs/decisions.md` entry carries a non-empty `Scope`, so the live root emits a precedents-only block and exits 0 — data-dependent, not a fixed expectation.)

### From WHAT (command surface)

- [ ] `faff ratified-scope` exists, is registered in `COMMANDS` in `bin/faff`, and appears in `docs/guide/cli.md`.
- [ ] `node plugin/skills/faff/bin/faff cli-surface --selftest` passes with the new command present, without a `*_SURFACE` declaration added.
- [ ] `node plugin/skills/faff/bin/faff lint-cli-doc` passes (the new row covers the new `COMMANDS` key).
- [ ] Exactly one of `--assemble` / `--validate` is required; neither or both exits 2.
- [ ] Wrong-mode flags exit 2: `--in`/`--json` with `--assemble`; `--container`/`--root` with `--validate`.

### From WHAT (assembled block)

- [ ] `--assemble --container <c>` emits a block whose first line is `## Ratified scope`, followed by the exact provenance sentence.
- [ ] The non-goals section renders as `### Non-goals: PRD \`<container>\` (<relpath>)` with the PRD `## Non-goals` body verbatim, when that body is non-empty and non-placeholder.
- [ ] Each scoped precedent renders as `- **<topic>** (\`<id>\`)` with `- Chosen:` and `- Scope:` sub-bullets, in `listEntries` order.
- [ ] A `## Non-goals` body that is empty or equals `_TODO._` is treated as absent.
- [ ] A `docs/decisions.md` entry with an empty `Scope` is skipped; an entry with any non-empty `Scope` is cited (the v1 structural rule, descriptive vs exclusionary not distinguished).
- [ ] With no non-goals section and no scoped precedent, `--assemble` exits 3 with empty stdout.
- [ ] `--assemble` exits 2 with a loud stderr line on an unreadable source (PRD read throw, or `docs/decisions.md` read throw).

### From WHAT (validation)

- [ ] `--validate` exits 0 on a well-formed block (heading present, provenance-anchor prefix present, at least one expected subsection).
- [ ] `--validate` exits 1, listing the problem(s), on a malformed block (missing heading; provenance line not beginning with the `PROVENANCE_ANCHOR` prefix; or heading-plus-provenance with no subsection) and on empty input.
- [ ] `--validate` reads from `--in FILE` when given, else stdin; an unreadable `--in` file exits 2.
- [ ] `--validate` input over `VALIDATE_MAX_BYTES` (oversize `--in` file, sized via `statSync`; or unbounded stdin, read in bounded chunks) exits 2 with a loud stderr line and allocates no buffer larger than the cap. (Verified in-process: feed the handler a >1 MiB input and assert exit 2 + the stderr line; assert the stdin read path never calls `fs.readFileSync(0)` unbounded — for example by grepping the source for a bounded read, or by a spy that caps the chunk loop.)
- [ ] A `--validate` pass is documented and tested as a shape check only: a hand-crafted block with the heading, anchor prefix, and one subsection validates, and a test asserts this to pin that `--validate` is not an authenticity gate.
- [ ] `assemble` output piped to `--validate` exits 0 (shape round-trip).
- [ ] `--json` with `--validate` emits `{valid, problems}`.

### From HOW (shared scanner reuse)

- [ ] `ratified-scope.js`'s `nonGoalsSection` calls the existing exported `sectionBody` with its default boundary (no option passed), and no scanner logic is copied into `ratified-scope.js`.
- [ ] `admissibility.js` is unmodified by this ticket, and `acceptanceSection` is left exactly as-is. (Trivially proven by `node plugin/skills/faff/bin/faff admissible --selftest`, `... dod --selftest`, and `... prd --selftest` still passing — this ticket touches none of their code.)

### From HOW (no-write / no-network, in-process)

- [ ] `--assemble` writes no file, asserted by a **global** in-process write-guard: the test requires `ratified-scope.js`, monkeypatches every `fs` write entry point (`writeFileSync`, `appendFileSync`, `mkdirSync`, `writeSync`, `openSync` for a write flag, `rmSync`, `renameSync`, `truncateSync`) to throw, then drives `assemble` / `cmdRatifiedScope` in-process across the fixtures — any write call fails the test. The guard is global (patched on the shared `fs` module all libs require), not scoped to a fixture-tree diff, so a write-then-delete or an out-of-root write is caught. (`runCli` spawns a child, so this guard must run in-process, not through `runCli`.)
- [ ] `ratified-scope.js` makes no network call, asserted by a static dependency-graph check: the test asserts `ratified-scope.js`'s `require` set is a subset of the allowlist `{node:fs, node:path, ./admissibility, ./decisions, ./prd, ./argv, ./shared-infra}` (and transitively pulls in no `http`/`https`/`net`/`dns`/`tls`/`fetch`), so no network-capable module is reachable.

### From HOW (edge cases)

- [ ] `--assemble --container <name>` with the PRD file absent skips the PRD half and still emits the precedents half when non-empty.
- [ ] A linked-mode PRD (a `**PRD:**` line, no `##` sections) yields no non-goals half and is not an error.

### Selftest and test file

- [ ] `faff ratified-scope --selftest` passes and mirrors the pure-function cases (assemble, render, placeholderOnly, validate, the `VALIDATE_MAX_BYTES` boundary).
- [ ] `test/ratified-scope.test.mjs` passes and covers: both halves present, PRD only, precedents only, neither (exit 3 fixture), placeholder-only non-goals, missing PRD file, linked-mode PRD, `--validate` well-formed / malformed / empty / oversize, the shape-only (not authenticity) assertion, wrong-mode-flag usage errors, and the in-process no-write and no-network guards.
- [ ] The full `node --test` suite stays green. No eval sweep is required (this command introduces no LLM-judgement seam).

### Integration smoke test

```
PROCEDURE smoke():
  1. Build a fixture root with:
     a. docs/prd/demo.md carrying a real `## Non-goals` section (two bullets)
     b. docs/decisions.md carrying one entry with a non-empty Scope
  2. Run (via runCli): faff ratified-scope --assemble --root <fixture> --container demo
     ASSERT exit 0
     ASSERT stdout first line === "## Ratified scope"
     ASSERT stdout contains both non-goals bullets verbatim and the decision's Scope text
     # No-write is asserted by the global in-process write-guard test, NOT here — runCli is a child spawn.
  3. Pipe that stdout into (via runCli): faff ratified-scope --validate
     ASSERT exit 0
  4. Pipe an empty string into: faff ratified-scope --validate
     ASSERT exit 1
```

## Appendix A: fixture shapes for the test

A PRD fixture with a real non-goals section (written to `<root>/docs/prd/demo.md`):

```markdown
# PRD — demo

- **Container:** demo
- **Status:** Active
- **Date:** 2026-08-27
- **Mode:** authored

## Non-goals

- No horizontal scaling in v1. One api instance, one region.
- No connection pooler and no read replica.

## Acceptance criteria

- Given a request, When it arrives, Then it is served.
```

A linked-mode PRD fixture (no `##` sections):

```markdown
# PRD — demo

- **PRD:** https://example.invalid/prd/demo
```

A decisions register with one scoped entry (written to `<root>/docs/decisions.md`, following the `decisions.js` selftest shape):

```markdown
# Decisions register

## Single-instance rate limiting for v1
- Chosen: the limiter keeps its counters in process.
- Rationale: v1 runs one api instance.
- Scope: the v1 checkout deployment; any per-client throttle on it.
- Matches: rate limiting for v1
- Date: 2026-08-27
```

A register for the exit-3 fixture omits the `- Scope:` line on every entry, so `listEntries(...).scope` reads null and each entry is skipped.

## Methodology critique

**Right-sized? (principle 4)** No issues. The ticket is the deterministic half of a merge-gate split that FAFF-907's own spec review already called ("two changes wearing one ticket"), and the split landed on the right seam. What is left here is one coherent 1-3 day unit: a new `faff ratified-scope` command plus its one test file, reusing an already-exported scanner with no change to `admissibility.js`. The `acceptanceSection` dedup that round 2 folded in has been pulled back out to FAFF-923: folding it would move a shipped `faff admissible` gate boundary, a review-gated change that does not belong in a plain-CI ticket. Pulling it out is a correct scope decision, not under-scoping — the command needs the shared scanner only as a read-only caller, which it already can be.

**Workstream fit? (principles 1 + 5)** No issues. Project-less Backlog is the correct capture default here (labels faff-automate, faff-jot-intake), not a misfile. FAFF-919 and FAFF-907 do converge on a single outcome, the ratified-scope capability, so they read as an outcome pair rather than unrelated work sharing a bucket; FAFF-923 (the deferred `acceptanceSection` dedup) is a third, independent follow-up on the same surface. A small cluster is below the bar for manufacturing a project, so leaving them loose is the right call for now. Worth a watch only: once the cluster grows past two or three, it becomes a genuine outcome-led project candidate rather than staying loose.

**Deps surfaced? (principle 6)** No issues. The one load-bearing ticket edge, "blocks FAFF-907", is explicit and points the right way: the deterministic half must merge before the calibration half that depends on it. FAFF-923 is a follow-up, not a blocker of this ticket (this ticket ships without touching `acceptanceSection`). The spec's Assumes on existing exported helpers hide no unlinked blocker: every assumed export exists on main today — `sectionBody` / `sectionBodyRange` from admissibility.js, `listEntries` from decisions.js, `prdDir` / `prdSlug` from prd.js — so the code-level deps are already shipped.

**Risk profile? (principle 7)** No issues, and the one live vector round 2 carried is now removed from this ticket. Under Option A the command is uniformly low risk: deterministic, plain-markdown output, no new contract or schema, and a read-only reuse of an already-exported scanner with **no** edit to `admissibility.js`, so the shipped `faff admissible` gate cannot move. The gate-boundary risk that a dedup would create is carried by FAFF-923, where it can be reviewed on its own. The remaining guards to build strictly are the no-write and no-network in-process assertions and the `VALIDATE_MAX_BYTES` bound, none of which touch shipped code.

confidence: high
build-tier: complex

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
    { "marker": "assumes" }
  ] }
```