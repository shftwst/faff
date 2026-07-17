# faff gates: a CI-workflow gate source — the 4th `discoverRungs` detector

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-533.

**Artifact.** This is the build spec for FAFF-533. It is written for the coding agent that will implement the change and for the human reviewers who gate it. It specifies a fourth gate-source detector for `faff gates discover`/`discoverRungs` — one that reads `.github/workflows/*.yml` — so a repo whose real engineering gates live only in CI resolves `discovery: confident` instead of `discovery: none`.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff gates discoverRungs(root)` is a *deterministic scanner*: it reads a fixed set of the repo's OWN trusted config files, extracts anything that looks like a declared engineering gate, and emits an ordered list of **rungs** (`{kind, name, command, source, cost_rank, required}`) plus a one-word `discovery` classification (`confident` when ≥1 rung resolved, `none` when zero). Everything downstream — the Step 7.5 gate ladder, post-merge verification, the fail-closed park decision — keys off that list and that word. This change adds one more *source file family* to the scan (CI workflow YAML); it invents no new rung shape and no new classification value.

**Problem statement.** `discoverRungs` v1 reads only three sources — pre-commit config, `package.json` scripts, Makefile targets — so faff's own repo, whose real gates (`node --test`, `faff validate-adapters`, `lint-refs`, …) run *exclusively* via `.github/workflows/validate.yml`, resolves `discovery: none`; post-FAFF-522 that routes every autonomous build to needs-human/park, which forced a `gates.fallback: advisory` stopgap into this repo's `.faffrc.yaml` that re-opens the silent-pass hole FAFF-522 closed. This change adds a fourth detector that recognises CI-declared runners and classifies such a repo `confident`, removing the need for the stopgap.

**Design principles.**

- **Trusted-source-only, unchanged.** The new detector reads only the repo's OWN `.github/workflows/*.yml` — never a command from an issue body or third-party comment. It is exactly the same trust posture as the three existing detectors (Step-8 TRUSTED-SOURCE-ONLY).
- **Precise recognition over broad recognition.** A gate rung is only emitted for a command matching a *curated allow-list* of known test/lint/type runners. Fabricating a required rung from an arbitrary CI step (a deploy, an `echo`, a checkout) is the "slow target labelled cheap" failure the existing detectors already guard against by dropping unrecognised names — this detector holds the same line for commands.
- **Read shape, not semantics.** The detector extracts command *text* only; it does not expand `${{ }}` expressions, matrix vars, `env:`, `with:`, or `working-directory`. This mirrors the other detectors (pre-commit reads hook ids, Makefile reads target names) and keeps the scan a pure text pass.
- **Local sources win ties.** When the same gate `kind` is declared both locally (pkg/Makefile/pre-commit) and in CI, dedup must keep the local one. CI is the fallback source, not the preferred one.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` | JavaScript (Node, CommonJS) | Holds `discoverRungs` + the three existing detectors + `gatesSelftest`; the new detector is added here in the same shape. |
| `plugin/skills/faff/bin/lib/post-merge.js` | JavaScript | `verifyPostMerge` finds the `UNIT` rung via `discoverRungs`; a CI-sourced UNIT rung turns its `unverified` ("no UNIT rung discovered") result into a real re-runnable verification. |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | Home of `parseYamlSubset` (the hand-rolled YAML subset parser) — a candidate parse strategy, evaluated and rejected below. |
| `.github/workflows/validate.yml` | YAML | The actual CI file faff's own repo runs; the recognised-runner matching MUST make this file yield `confident` with a `UNIT` rung. |
| `.faffrc.yaml` | YAML | Carries the `gates.fallback: advisory` FAFF-522 stopgap this ticket removes. |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | Step 7.5 prose lists the gate sources; already names "CI config" in the Step-8 resolver enumeration — this change makes the code match that already-documented resolver. |

**Scope statement.** This sits entirely inside `faff gates discover`'s deterministic discovery stage — one more source in the same scanner, feeding the same rung list every gate consumer already reads.

## 2. OUT OF SCOPE

- **Executing CI in a real GitHub runner / re-using GitHub's own results** — Excluded: the detector reads the workflow file to *discover a re-runnable local command*, it does not call the GitHub API or trust a remote check result. Extension point: a future "consume CI status" leg would live in `merge-gate.js` / `governance-check.js`, not here.
- **`${{ }}` / matrix / env / reusable-workflow (`uses:` job) expansion** — Excluded: the detector extracts command text verbatim; it does not resolve GitHub expression context. Extension point: a richer `expandWorkflowCommand()` helper alongside the detector in `gates.js`.
- **GitLab CI / CircleCI / other CI providers** — Excluded: only `.github/workflows/*.yml` is read. Extension point: sibling `discoverGitlabCi(root)` / `discoverCircleCi(root)` detectors added to the `discoverRungs` composition list.
- **A `CLAUDE.md` gate source** — Excluded: still named as a future source in the region comment but out of this ticket. Extension point: a `discoverClaudeMd(root)` detector in the same `discoverRungs` list.
- **Changing `discovery` classification values or the fail-closed policy** — Excluded: FAFF-522's `gates.fallback` semantics and the `confident`/`none` enum are untouched; this change only makes more repos land on the existing `confident` branch.
- **Broadening the recognised-runner allow-list to every conceivable tool** — Excluded: the allow-list ships with the runners needed for faff's own repo plus the common cross-ecosystem ones; adding more is a one-line table edit. Extension point: the `CI_RUNNERS` table defined in HOW.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Rung | A discovered engineering gate: `{kind, name, command, source, cost_rank, required}`. The unit every gate consumer reads. |
| Detector | A function `(root) → List<Rung>` that scans ONE source-file family. There are three today; this adds a fourth. |
| Recognised runner | A command whose text matches an entry in the curated `CI_RUNNERS` allow-list — the only commands that become rungs. |
| `run:` step | A GitHub-workflow step that executes a shell command (the `run:` key), as opposed to a `uses:` step (a pre-built action, which has no command and is skipped). |

**The Rung shape (unchanged — the new detector emits exactly this).**

```
RECORD Rung:
  kind:      Enum{ FORMAT, LINT, TYPECHECK, STATIC_ANALYSIS, UNIT, OTHER }
  name:      String        # human label, e.g. "unit (ci-workflow: node --test)"
  command:   String        # the verbatim, re-runnable command text
  source:    String        # NEW literal: "ci_workflow"  (joins pre_commit | pkg_script | makefile)
  cost_rank: Int           # GATE_COST[kind] + CI_COST_PENALTY
  required:  true
```

**New detector interface.**

```
FUNCTION discoverCiWorkflows(root: Path) -> List<Rung>
  # Reads root/.github/workflows/*.{yml,yaml}; returns a rung per recognised run-command.
  # Missing directory, unreadable file, or zero recognised commands -> [] (never throws).
```

**New recognised-runner classifier.**

```
FUNCTION ciRunnerKind(command: String) -> RungKind | null
  # Returns the RungKind for a recognised runner, or null for an unrecognised command.
  # Distinct from gateKindForName (which classifies a script/target NAME) — this matches a full
  # COMMAND line against a curated allow-list, because gateKindForName's loose name tokens
  # (`check`, `test`) produce false positives when applied to command text.
```

**New constant.**

```
CONST CI_COST_PENALTY = 5
  # Added to GATE_COST[kind] for a CI-sourced rung, so a locally-declared gate of the same kind
  # (pkg/Makefile at base, pre-commit at base-5) wins the dedup-by-kind (lowest cost_rank).
```

**Module export surface.** `discoverCiWorkflows` and `ciRunnerKind` are added to `module.exports` (alongside `discoverMakefile`, `discoverPkgScripts`, `discoverPreCommit`, `gateKindForName`) so they are unit-testable in isolation, matching the existing detector exports.

**Design decisions** — collected with rationale in §6; each carries a canonical marker there. In document order: workflow-YAML parse strategy, recognised-runner allow-list vs reusing `gateKindForName`, command→kind mapping (incl. faff's own gates), CI rung cost precedence, command-extraction fidelity.

## 4. HOW — Behavior

**Architecture.** One new detector function is added to the composition list in `discoverRungs`, after the three existing ones:

```
rungs = [
  ...discoverPreCommit(root),
  ...discoverPkgScripts(root),
  ...discoverMakefile(root),
  ...discoverCiWorkflows(root),   // NEW
]
```

Everything after that line — dedup-by-kind preferring lowest `cost_rank`, the `discovery = rungs.length ? "confident" : "none"` classification, the ladder, post-merge's `rungs.find(r => r.kind === "UNIT")` — is **unchanged**. The new detector's only job is to contribute correctly-shaped rungs.

**Behavior summary — `discoverCiWorkflows`.** Enumerate the workflow files, extract every `run:` step's command line(s), keep the ones a curated allow-list recognises as a real test/lint/type gate, and emit one rung per recognised command.

```
PROCEDURE discoverCiWorkflows(root):
  1. dir = root/.github/workflows
     IF dir does not exist OR is not a directory: RETURN []
  2. files = entries of dir ending in ".yml" or ".yaml" (sorted, for determinism)
  3. rungs = []
  4. FOR each file:
     a. text = read file  (on read error: skip this file, continue)
     b. commands = extractRunCommands(text)          # see below
     c. FOR each command in commands:
          kind = ciRunnerKind(command)
          IF kind == null: CONTINUE                    # unrecognised -> not a gate, drop it
          rungs.push({
            kind,
            name: `${lower(kind)} (ci-workflow: ${command})`,
            command,
            source: "ci_workflow",
            cost_rank: GATE_COST[kind] + CI_COST_PENALTY,
            required: true,
          })
  5. RETURN rungs
```

**Behavior summary — `extractRunCommands`.** A purpose-built line scan (NOT a full YAML parse) that pulls the command text out of every `run:` step, handling both the inline form and the block-scalar form. This is the same posture as `discoverMakefile` (scan `target:` lines) and `discoverPreCommit` (scan `- id:` lines).

```
PROCEDURE extractRunCommands(text):  # returns List<String>, one entry per command line
  out = []
  lines = text split on newlines
  i = 0
  WHILE i < lines.length:
    line = lines[i]
    m = match /^(\s*)-?\s*run:\s*(.*)$/  on line     # a `run:` key (optionally a `- run:` step)
    IF not m:
       i += 1; CONTINUE
    keyIndent = indent width of the `run:` key
    inline = m.group(2) trimmed
    IF inline is a block-scalar indicator ("|", "|-", "|+", ">", ">-", ">+"):
       # collect the indented block body until indentation returns to <= keyIndent
       i += 1
       WHILE i < lines.length AND (lines[i] is blank OR indent(lines[i]) > keyIndent):
          body = lines[i]
          IF body is non-blank:
             out.push(body trimmed)                    # one candidate command per body line
          i += 1
       CONTINUE                                        # i already advanced past the block
    ELSE IF inline is non-empty:
       out.push(strip surrounding quotes from inline)  # inline single-line command
    i += 1
  RETURN out
```

- **One command per line, deliberately.** A `run: |` block may hold many shell lines; each is tested against the allow-list independently, so `validate.yml`'s two-command `lint-refs` step and its `node --test` step each surface their recognised command. Chained one-liners (`a && b`) are matched as a whole line — `ciRunnerKind` uses substring/boundary matching, so a recognised token anywhere in the line still matches.
- **Blank lines inside a block do not terminate it** (they satisfy `indent > keyIndent` vacuously via the blank-line branch), matching real workflow formatting.

**Behavior summary — `ciRunnerKind`.** Match the command against an ordered allow-list of `{pattern, kind}` entries; return the first matching `kind`, else `null`.

```
CONST CI_RUNNERS = [   # ordered; first match wins
  # --- TYPECHECK ---
  { /(^|[^a-z])(tsc|mypy|pyright)([^a-z]|$)/,                       TYPECHECK },
  # --- LINT (incl. faff's OWN CLI gates) ---
  { /(^|[^a-z])(eslint|flake8|ruff|clippy|rubocop|standardrb?)([^a-z]|$)/, LINT },
  { /(^|[^a-z])go\s+vet([^a-z]|$)/,                                 LINT },
  { /(^|[^a-z])(validate-adapters|lint-refs|lint-cli-doc)([^a-z]|$)/, LINT },   # faff's own gates
  # --- FORMAT ---
  { /(^|[^a-z])(prettier|gofmt|rustfmt|black|isort)([^a-z]|$)/,     FORMAT },
  # --- UNIT ---
  { /(^|[^a-z])node\b[^\n]*--test([^a-z]|$)/,                       UNIT },      # node --test
  { /(^|[^a-z])(jest|vitest|mocha|\bava\b|tap|pytest|phpunit|rspec)([^a-z]|$)/, UNIT },
  { /(^|[^a-z])go\s+test([^a-z]|$)/,                                UNIT },
  { /(^|[^a-z])cargo\s+test([^a-z]|$)/,                             UNIT },
]

FUNCTION ciRunnerKind(command):
  n = command.toLowerCase()
  FOR {pattern, kind} in CI_RUNNERS:
     IF pattern.test(n): RETURN kind
  RETURN null
```

**Why this makes `validate.yml` confident.** Its steps run `node plugin/skills/faff/bin/faff validate-adapters` → matches `validate-adapters` → **LINT**; `node plugin/skills/faff/bin/faff lint-refs` / `lint-cli-doc` → **LINT**; and `node --test` → matches `node …--test` → **UNIT**. Result: ≥1 rung ⇒ `discovery: confident`, and a real `UNIT` rung (`command: "node --test"`) that post-merge verification re-runs.

**Edge cases and error handling.**

- **No `.github/workflows/` dir** → `[]` (the common case for a repo with only local gates; discovery unaffected).
- **Unreadable / malformed workflow file** → skip that file, continue (best-effort, like every other detector's `try/catch → return`); never throw out of `discoverRungs`.
- **A `uses:` step (no `run:`)** → produces no candidate command; contributes nothing.
- **A recognised runner named only in a step `name:` or a `#` comment** → NOT matched, because only `run:` values are scanned. (Comment lines never carry a `run:` key at col-0 after `#`.)
- **Same kind in CI and locally** → dedup-by-kind keeps the lower `cost_rank`; the local source (base or base-5) beats CI (base+5). CI wins only when it is the sole source for that kind.
- **Multiple workflow files / repeated recognised commands** → multiple same-kind rungs pre-dedup; `discoverRungs`'s existing dedup collapses them to one per kind.
- **`errored` at run time** (a recognised CI command that needs a tool/env absent locally) → `runRung` already classifies exit 127 / spawn error as `errored` → `needs-human`, never a false `fail`. The detector does not need to pre-validate runnability.

**Failure modes.**

- **The failure: a false-positive rung.** A `run:` line contains a recognised token but is not actually a standalone gate (e.g. `echo "running pytest"`, or a recognised runner buried in a `working-directory`-dependent invocation). **How you'd know:** `faff gates discover --json` lists a rung whose `command` obviously is not a gate, or the ladder reports that rung `errored`/`fail` for a spurious reason. **What it means:** narrow the offending `CI_RUNNERS` pattern (tighten the boundary) — do not widen the scan beyond `run:` values. The allow-list is intentionally curated; over-matching is a bug, under-matching is a safe miss.
- **The failure: the extracted command loses CI context and can't run locally.** `validate.yml`'s `node --test` step sets `FAFF_REQUIRE_DOCKER: "1"`; the extracted `node --test` runs without it. **How you'd know:** the ladder's UNIT rung passes locally but exercises fewer tests than CI (docker-gated tests self-skip when the env is absent — by design, per validate.yml's "must not silently skip" gate which *forces* them on only under that env). **What it means:** proceed — this is acceptable and expected; the ladder is a *local backstop*, not a CI replica. Commands whose *recognition* survives but whose *execution* needs CI-only context surface as `errored → needs-human`, never a false green. Documented limitation, not a defect.
- **The failure: block-scalar boundary mis-scan.** The hand-rolled indent scan mis-detects where a `run: |` block ends, dropping or over-collecting command lines. **How you'd know:** the CI-workflow selftest fixture (a `run: |` block with `node --test` on the second line) fails to yield the expected UNIT rung. **What it means:** the selftest is the guard; fix the indent comparison. This is the single highest-implementation-risk part of the change, which is why it gets a dedicated scenario below.

**Anti-pattern:** reusing `gateKindForName(command)` for CI commands. Why: `gateKindForName`'s UNIT token set includes bare `check` and `test`, which match huge numbers of non-gate command lines (`git checkout`, `faff container-check --selftest`, `pre-commit`), fabricating required rungs from noise. The curated `CI_RUNNERS` allow-list exists precisely to avoid that.

**Anti-pattern:** parsing the workflow with `parseYamlSubset` and walking `jobs.*.steps[].run`. Why: workflow YAML nests under arbitrary job keys, uses block scalars with embedded `${{ }}`, and may carry multi-doc / anchors the subset parser was never built for; every existing detector uses a direct line-scan, and a `run:`-line scan is simpler, consistent, and robust here.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose ONLY gate source is .github/workflows/validate.yml running `node --test`
  and `faff validate-adapters`
When `faff gates discover` runs against it
Then discovery is "confident"
  and the rung list contains a UNIT rung with command "node --test" (source "ci_workflow")
  and a LINT rung sourced from the validate-adapters step
```

```
Given faff's OWN repository root (the real .github/workflows/validate.yml)
When discoverRungs(repoRoot) runs
Then discovery === "confident"
  and there is exactly one rung of kind UNIT after dedup
  and post-merge verifyPostMerge finds that UNIT rung (verdict is no longer "unverified: no UNIT rung discovered")
```

```
Given a workflow file with a block-scalar step:
      - name: tests
        run: |
          echo setup
          node --test
When extractRunCommands parses it
Then "node --test" is among the extracted commands
  and ciRunnerKind("node --test") === UNIT
```

```
Given a repo declaring `test` in package.json scripts AND `node --test` in a CI workflow
When discoverRungs runs
Then exactly one UNIT rung survives dedup
  and it is the package.json rung (lower cost_rank), not the ci_workflow rung
```

## 6. DESIGN DECISION RATIONALE

**How should the workflow YAML be parsed?**
- Options: (a) reuse `parseYamlSubset` and walk `jobs.*.steps[].run`; (b) a purpose-built `run:`-line scan.
- (a) pro: structured; con: `parseYamlSubset` (FAFF-262) handles nested maps/seqs/block-scalars but was not built for arbitrary-keyed job maps, `${{ }}`-laden block scalars, anchors, or multi-doc workflow files — brittle here, and inconsistent with the other three detectors which all line-scan.
- (b) pro: simple, robust, consistent with `discoverMakefile`/`discoverPreCommit`; con: hand-rolled block-scalar boundary logic (mitigated by a dedicated selftest).
- **Chosen:** (b) a purpose-built `run:`-line scan (`extractRunCommands`) — consistent with the existing detectors and robust against workflow-YAML structure the subset parser wasn't designed for.

**Recognised-runner allow-list, or reuse `gateKindForName` on the command?**
- Options: (a) call `gateKindForName(command)`; (b) a new curated `ciRunnerKind` allow-list.
- (a) con: `gateKindForName`'s name-tokens (`check`, `test`) over-match command lines, fabricating rungs from non-gate commands — the exact "slow target labelled cheap" failure the detectors guard against.
- **Chosen:** (b) a new, curated `CI_RUNNERS` allow-list matched by `ciRunnerKind`, kept deliberately narrow. `gateKindForName` stays name-only and untouched.

**How are recognised commands mapped to a kind, including faff's own CLI gates?**
- faff's real gates are `faff validate-adapters` / `lint-refs` / `lint-cli-doc` (static validators) and `node --test` (the suite). Options: enumerate faff's gate subcommands explicitly, or try to infer generically.
- Generic inference of "is this repo's CLI a gate?" is undecidable from text; explicit enumeration is honest and one-line-extensible.
- **Chosen:** map by the `CI_RUNNERS` table — faff's own gates (`validate-adapters`/`lint-refs`/`lint-cli-doc`) → LINT; `node --test`, jest/vitest/mocha/ava/tap/pytest/phpunit/rspec, `go test`, `cargo test` → UNIT; tsc/mypy/pyright → TYPECHECK; eslint/flake8/ruff/clippy/rubocop/`go vet` → LINT; prettier/gofmt/rustfmt/black/isort → FORMAT. The table is the documented extension point.

**How should a CI-sourced rung rank against a locally-declared one of the same kind?**
- The dedup keeps the lowest `cost_rank` per kind; CI must lose to a local source but still resolve when it's the only source.
- **Chosen:** `cost_rank = GATE_COST[kind] + CI_COST_PENALTY` (`CI_COST_PENALTY = 5`), placing CI above pre-commit (base-5) and pkg/Makefile (base) so local sources win dedup, while CI remains discoverable as the fallback source.

**How faithfully is a CI command reconstructed for local re-run?**
- Options: expand `${{ }}`/matrix/`env`/`with`/`working-directory` into a runnable command, or extract verbatim command text only.
- Full expansion re-implements a slice of the GitHub Actions runtime — large, brittle, and out of scope; verbatim text matches every other detector's "read shape, not semantics" posture.
- **Chosen:** extract command text verbatim (strip only surrounding quotes); no expression/env/matrix expansion. Commands needing CI-only context surface at run time as `errored → needs-human`, never a false green. (At the time of writing, `discoverRungs` has no consumer that expands GitHub expression context; revisit if one appears.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is `**Chosen:**`.

**Assumptions.**

**Assumes:** faff's own `.github/workflows/validate.yml` runs `node --test` and `faff validate-adapters`/`lint-refs`/`lint-cli-doc` as `run:` steps (the recognition targets). *Validation:* verified against the file during spec authoring; the acceptance test re-checks it against the real repo root, so a future CI restructure that breaks recognition is caught.

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `faff gates discover` at faff's own repo root resolves `discovery: confident` (was `none`).
- [ ] The `gates.fallback: advisory` stopgap block is removed from `.faffrc.yaml`, and an autonomous build no longer parks at Step 7.5 for lack of a discovered gate on this repo (the fail-closed default now sees a `confident` discovery).

### From WHAT (types and interfaces)
- [ ] `discoverCiWorkflows(root)` is added and exported from `gates.js`; returns `[]` on missing dir / unreadable file / zero recognised commands, and never throws.
- [ ] `ciRunnerKind(command)` is added and exported; returns a `RungKind` for an allow-listed runner and `null` otherwise.
- [ ] Every rung emitted by the new detector has `source: "ci_workflow"`, `required: true`, and `cost_rank === GATE_COST[kind] + 5`.
- [ ] `discoverCiWorkflows` is composed into `discoverRungs` after the three existing detectors; the dedup, `discovery` classification, and ladder code are unchanged.

### From HOW (behaviour)
- [ ] `extractRunCommands` returns the inline `run:` command for a single-line step and each body line for a `run: |` block-scalar step; blank lines inside a block do not terminate it.
- [ ] `ciRunnerKind("node --test") === "UNIT"`; `ciRunnerKind("node …/faff validate-adapters") === "LINT"`; `ciRunnerKind("git checkout") === null`; a `uses:`/`name:`/comment line yields no command.
- [ ] Against `.github/workflows/validate.yml`, the detector yields at least one `UNIT` rung with `command: "node --test"` and at least one `LINT` rung.

### From HOW (edge cases)
- [ ] A repo whose only workflow steps are `uses:`, a `name:` label, and a non-recognised `run:` command resolves `discovery: none` (no fabricated rung).
- [ ] When a kind is declared both in `package.json` and in CI, dedup keeps the local (lower `cost_rank`) rung.
- [ ] A malformed/unreadable workflow file is skipped without throwing.

### From post-merge integration
- [ ] `verifyPostMerge` against faff's repo (or a fixture repo whose only UNIT source is a CI `node --test` step) resolves a real `UNIT` rung and returns `verified-ok`/`verified-fail`, not the `unverified` "no UNIT rung discovered" result.

### From selftest + docs
- [ ] `gatesSelftest` (`faff gates --selftest`) gains cases covering: CI-workflow discovery → confident + UNIT rung; inline vs block-scalar extraction; `uses:`/`name:`-only → none; pkg-vs-CI dedup keeps local; false-positive guard (unrecognised `run:` command dropped). All cases pass.
- [ ] A `node:test` integration test asserts `discoverRungs(repoRoot).discovery === "confident"` with a `UNIT` rung, against the real repo root (encodes the acceptance directly; sits in `test/`).
- [ ] The `gates.js` region comment is updated: sources now read (v2) include `.github/workflows/*.yml`; the "CI jobs as a future source" note is resolved.
- [ ] `docs/guide/cli.md` gates row and `plugin/skills/faff-graft/SKILL.md` Step 7.5 source list both name the CI-workflow source (bringing Step 7.5 in line with the Step-8 resolver enumeration that already lists "CI config").

**Eval coverage.** No LLM-judgement seam is introduced — `discoverCiWorkflows`/`ciRunnerKind` are pure deterministic text matchers. No grader registration required.

**Integration smoke test.**

```
PROCEDURE ci_source_smoke:
  1. mk tmp repo with ONLY: .github/workflows/ci.yml containing a step `run: node --test`
  2. dis = discoverRungs(tmpRepo)
  3. ASSERT dis.discovery === "confident"
  4. ASSERT dis.rungs.some(r => r.kind === "UNIT" && r.source === "ci_workflow" && r.command === "node --test")
  5. run `faff gates discover --root <tmpRepo> --json` -> exit 0, JSON.discovery === "confident"
```

confidence: high
spec-review: approve
