# FAFF-440 — Byte-identical verification harness for the bin/faff module split

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-440.

This is the buildable specification for FAFF-440, a spike-plus-tool ticket: decide whether existing coverage proves output equivalence for the FAFF-441 pure reorganisation of `plugin/skills/faff/bin/faff` (16,652 lines), and — since it does not — build the minimal before/after output-diff harness that gates the split PR.

## 1. WHY — Problem and Principles

**The load-bearing model:** a pure reorganisation is provable by construction — run the same argv matrix against the pre-split and post-split binaries under identical conditions and demand byte-identical stdout, stderr, and exit code per invocation. The whole design reduces to making "identical conditions" real: same install path, same sandbox HOME, same fixture bytes, same environment — so that any surviving difference is attributable to the split and nothing else.

**Problem statement:** FAFF-441 will split the 16,652-line monolith into modules, and nothing today proves the split changed no behaviour. Existing coverage is deliberately partial-field (`test/cli-coverage.test.mjs` asserts "token, not reason" on 4 of 51 subcommands; the ~35 `--selftest` surfaces are in-process pure-function tables that never prove argv→real-stdout-bytes; `test/contract-golden.test.mjs` compares parsed JSON structure, not raw bytes, for 4 outputs). This ticket answers the spike question and ships the gate.

**Spike verdict — settled here, not re-litigated at build time.** The ticket's "if existing coverage is sufficient: doc-only" branch is **closed**. **Chosen:** existing coverage is insufficient; the harness is required. Rationale: no existing test pins raw output bytes, no test invokes the binary via either real install shape (symlink at `~/.local/bin/faff`, copy under `CLAUDE_PLUGIN_ROOT`), and the code most endangered by a split is exactly the install-shape-sensitive code (`HERE = __dirname` at bin/faff:35 feeding `contracts/*.schema.json` resolution, `resolveHookBin` 3-way shape precedence at :4791–4809, `resolveSyncScript` symlink-vs-copy strategies at :9138–9159, raw `process.argv[1]` capture at :14905).

**Design principles** (violating any of these rejects an otherwise-working implementation):

- **Zero normalization.** Equality is raw-byte equality. Any argv row that would need output massaging to compare is excluded (with a recorded reason) rather than normalized — a normalizer is a place for a real deviation to hide.
- **Fail closed.** Setup faults (baseline ref unresolvable, fixture seeding failure, coverage self-check failure, unparseable `--help`) are exit 2, never a silent PASS.
- **Migration gate, not regression suite.** The harness compares against a git ref; it is invoked manually (and optionally as a temporary CI step on the FAFF-441 PR), not wired into the permanent test suite.
- **No gold-plating.** Scoped to gating the split PR: text report, sequential execution, no `--json`, no parallelism.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/helpers/run-cli.mjs` | Node ESM | The `spawnSync → {stdout, stderr, code}` capture seam to replicate (its hardcoded repo-relative bin path is why it can't be used directly) |
| `test/helpers/seed-repo.mjs` | Node ESM | Deterministic real-git fixture provisioner — already neutralises ambient git config, author/committer dates, default branch; documents byte-identical output as its design goal; reuse it |
| `test/contract-golden.test.mjs` | Node ESM | The spawn-and-compare pattern precedent (structural, not byte; superseded here for this purpose) |
| `plugin/skills/faff/bin/faff` | Node CJS | The system under test — 51 top-level `COMMANDS` entries (:16577–16631) |
| `.github/workflows/validate.yml` | YAML | Where FAFF-441 may add the temporary parity step |

**Scope statement:** a one-time verification tool under `scripts/`, shipped in FAFF-440's own PR so FAFF-441 can run it; it gates exactly one PR.

## 2. OUT OF SCOPE

- **The module split itself** — FAFF-441. Extension point: FAFF-441 runs this harness per its recorded recipe.
- **Permanent byte-golden regression coverage** — ongoing regression protection stays with the existing suite. Extension point: `test/golden/contracts/cases.json` is the pattern to extend if byte-pinning is ever wanted long-term.
- **CI wiring of the harness** — a temporary `validate.yml` step is FAFF-441's call on its own branch. Extension point: one step invoking the recipe with `--baseline-ref` = the split PR's merge-base.
- **Parity for side-effecting / network / wall-clock subcommands beyond the exclusion list** — excluded rows are enumerated with reasons (Section 3). Extension point: the harness's `MATRIX` table.
- **Windows support** — the harness runs where CI and the dev box run (Linux/macOS).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| baseline | The pre-split binary tree, materialised from a git ref via a temporary worktree |
| candidate | The post-split binary tree, taken from the current working tree (default) or a second ref |
| row | One argv invocation in the matrix, e.g. `["next", "--selftest"]` |
| shape | An install topology: **S** (symlink at `$HOME/.local/bin/faff` → skill tree) or **C** (full copy under `$CLAUDE_PLUGIN_ROOT/skills/faff/`) |
| capture | The `{stdout: bytes, stderr: bytes, exit: int}` triple for one (row × shape × phase) |
| phase | One full matrix pass with one binary installed: phase A = baseline, phase B = candidate |
| install path P | The single per-shape filesystem location both phases install into, so binary-path-derived output bytes cannot differ between phases |

**Types.**

```
RECORD Row:        args: List<String>; note: String
RECORD Exclusion:  subcommand: String; reason: side-effecting | network | wall-clock | interactive
RECORD Capture:    stdout: Bytes; stderr: Bytes; exit: Int | null
RECORD Mismatch:   shape: "S"|"C"; args: List<String>; fields: Set<"stdout"|"stderr"|"exit">; diff: String (unified excerpt, ~40 lines/stream, + exit codes)
```

**CLI surface.**

```
node scripts/verify-split-parity.mjs --baseline-ref <git-ref> [--candidate-ref <git-ref>] [--keep]
node scripts/verify-split-parity.mjs --selftest
```

- `--baseline-ref` — required in gate mode; resolved via `git rev-parse --verify`; unresolvable → exit 2.
- `--candidate-ref` — optional; default is the current working tree's `plugin/skills/faff/` (the split under review, uncommitted edits included).
- `--keep` — retain the scratch sandbox for post-mortem.
- Exit codes: **0** full parity · **1** ≥1 mismatch · **2** usage/setup fault.

**The argv matrix** (one declared `MATRIX` constant, fixed order):

1. **Dispatch surface:** `--help`, `help`, no-args (exit 2 + USAGE on stderr), one unknown subcommand (exit 2).
2. **All `--selftest` surfaces as subprocesses** — every surface `validate.yml` runs (~40 steps / ~35 surfaces): these execute the pure-function tables through the real argv→dispatch→stdout path, exactly the seam a split can break.
3. **Pure-read/deterministic reads** against the seeded fixture: `config get` (known key + `--json`), `config dump`, `next`, `state`, `eligible --label x --label y`, `labels`, `contract <name>` for every listed name, `dod classify`, `holdout verdict`, `spec-review-lenses`, `container-check`, `corrective-integrity`, `project-next`, `park-history --now <pinned ISO>`, `profile validate/show`, `fixtures validate/show`, `events read`, `regions list/check`, `admissible`, `worktree-root` (no `--assert`).
4. **Hermetic-flag rows:** `budget check --now <pinned>`, `sentry check --now-ms <pinned>`.
5. **Shape-sensitive probes:** `hooks-ensure --dry-run --root <fixture>`, `hooks-ensure --selftest`, `merge-fence --selftest`, `doctor`, plus error-path rows exercising `HERE`-based schema resolution.

**Exclusions** — one declared `EXCLUSIONS` constant, subcommand → reason. At minimum: `heartbeat`, `intake-record` (unpinned timestamps), `gates` beyond `--selftest` (real `duration_ms`), `sync` (mutates install), `worktree-prune` beyond `--selftest`, `merge-gate` / `branch-protection-check` (network/gh), `lights-out`, `audit`, `run-done`, `sentry` non-check verbs, `adr new`/`prdr new` beyond validate/read forms (date-defaulting writes), `profile mine` (`acquired_at`), `fixtures realise`, plus `env`/`effects`/`review-progress`/`build-progress` where wall-clock or mutating. **Every excluded subcommand still gets its `--selftest` row where one exists** — exclusion means "no live-run row", not "untested".

**Coverage self-check (fail-closed):** before phase A, parse the top-level subcommand list from the candidate's `faff --help`; assert every subcommand appears in `MATRIX` or `EXCLUSIONS`. Any gap, or a failed parse → exit 2. This makes the matrix drift-proof against subcommands added between spec and split.

## 4. HOW — Behavior

**Architecture:** one zero-dependency Node ESM script (`node:child_process`, `node:fs`, `node:os`, `node:path` only), reusing `test/helpers/seed-repo.mjs` for the fixture. Sequential, two phases, run-in-place binary swap.

```
PROCEDURE verify_split_parity(baseline_ref, candidate_ref?):
  1. SETUP (any fault → exit 2):
     a. scratch = mkdtemp under os.tmpdir()
     b. Materialise baseline: `git worktree add <scratch>/baseline <baseline_ref>` (detached);
        baseline_src = <scratch>/baseline/plugin/skills/faff
     c. candidate_src = working tree's plugin/skills/faff (or second worktree for --candidate-ref)
     d. Build the fixture TEMPLATE once via seed-repo.mjs at <scratch>/fixture-template
     e. Per-shape install paths (constant across phases):
        S: <scratch>/home/.claude/skills/faff (tree) + symlink <scratch>/home/.local/bin/faff → tree's bin/faff
        C: <scratch>/plugin-root/skills/faff (tree); no symlink
     f. Construct the scrubbed child env (below)
     g. Coverage self-check against candidate --help
  2. FOR phase IN [A: baseline_src, B: candidate_src]:
     a. rm -rf both install trees; copy phase's src into BOTH shape paths (recreate the S symlink)
     b. FOR shape IN [S, C]:
        i.  rm -rf <scratch>/fixture-<shape>; cp -a fixture-template → it (identical bytes incl. .git — no re-seeding, so SHAs match)
        ii. FOR row IN MATRIX (declared order, sequential):
            spawnSync the shape's entrypoint (S: the symlink; C: <plugin-root>/skills/faff/bin/faff)
            with row.args, cwd = the shape's fixture repo, env = scrubbed
            (+ CLAUDE_PLUGIN_ROOT=<scratch>/plugin-root for shape C ONLY); record Capture
  3. COMPARE: Buffer.equals on stdout/stderr, === on exit, per key. Inequality → Mismatch.
  4. REPORT: each Mismatch, then `RESULT: PASS|FAIL (<rows*shapes> comparisons, <n> mismatches)`.
     Cleanup scratch + `git worktree remove` unless --keep. Exit 0/1.
```

**Builder notes (fail-closed hygiene):**

- Cleanup runs in a trap/finally: the baseline `git worktree add` is unregistered on EVERY exit path including exit-2 setup faults (this repo has a known concurrent-worktree-prune hazard — never strand a registered worktree).
- Belt-and-braces: the coverage self-check may additionally cross-check the `--help` parse against a `COMMANDS`-table grep count; a disagreement is a setup fault (exit 2), never silently resolved.

**Why run-in-place swap matters:** `process.argv[1]`, `__dirname`, and `resolveHookBin` output embed the binary's own path. Because both phases install at the *same* absolute paths and run from the *same* fixture paths under the *same* HOME, path-embedding output is byte-identical between phases with no normalization — including cwd-embedded absolute paths in diagnostics (bin/faff:48, :9148).

**Side-effect containment:** every spawn gets a **replaced** (not inherited) env: `HOME=<scratch>/home`, `PATH=<scratch>/home/.local/bin:` + the minimal real dirs holding `node` and `git`, `TZ=UTC`, `LC_ALL=C`, `CLAUDE_PLUGIN_ROOT` only for shape C; all ambient `FAFF_*`/`CLAUDE_*`/`GIT_*` dropped. cwd is always inside the scratch fixture. Even an accidentally side-effecting row can only dirty the sandbox — identically in both phases (fixed row order, identical starting bytes), so intra-shape state evolution stays comparable.

**Edge cases:**

- Baseline ref lacks a matrix subcommand → surfaces as a loud mismatch — correct fail-closed behaviour for a "pure reorganisation" claim.
- spawnSync `r.error` (e.g. ENOENT) → setup fault, exit 2, naming the row.
- `--keep` → scratch path printed in the report footer.
- No retries — the harness is deterministic; a flaky row is a matrix bug (move to EXCLUSIONS or pin), never something to retry past.

**Failure modes:**

- **False PASS via matrix blind spot** (a split-broken path no row exercises, e.g. a lazily-required module only an excluded subcommand loads). The coverage self-check bounds this to within-subcommand blind spots; selftest + pure-read rows exercise every region's load path. Residual named and accepted for a one-PR gate.
- **False FAIL via residual nondeterminism** (an included row secretly reads clock/entropy/locale). Detected by the self-parity selftest failing intermittently on that row → move to `EXCLUSIONS` or pin via a documented hermetic flag — never add a normalizer.
- **Shape simulation diverges from real installs.** Detected via `hooks-ensure --dry-run`/`doctor` captures showing an unexpected resolved-bin path — fix the sandbox layout to match the real installer, not the code.

**Anti-pattern:** normalizing timestamps/paths out of captures — every normalizer is a masked-deviation channel; exclude or pin instead.
**Anti-pattern:** importing from `bin/faff` to enumerate `COMMANDS` — requiring the CJS monolith executes its dispatch; the `--help` parse is the supported read surface.

**Harness self-test (`--selftest`):**

1. Comparator table: synthetic capture pairs — equal → no mismatch; stdout-only / stderr-only / exit-only differences each individually detected and field-attributed.
2. Self-parity smoke: reduced matrix (dispatch rows + 2 selftest rows + 1 pure-read row), baseline = candidate = current tree → PASS.
3. **Mutation kill:** copy the current tree, apply a one-byte change to a user-visible string (e.g. USAGE), compare original vs mutant over the reduced matrix → must FAIL naming the deviating row. Proves the gate can actually catch a deviation.
4. **Coverage-drift kill:** feed the coverage self-check a synthetic `--help` listing containing one extra subcommand name absent from `MATRIX` and `EXCLUSIONS` → must exit 2 naming the uncovered subcommand (the drift-proof claim is itself tested, same testing-the-tester pattern as the mutation kill).

## Scenarios

```
Given the current plugin/skills/faff tree supplied as both baseline and candidate
When scripts/verify-split-parity.mjs runs the full matrix under both shapes
Then it prints RESULT: PASS with zero mismatches and exits 0
```

```
Given a candidate tree differing from baseline by one byte in any matrix-reachable output string
When the harness runs
Then it exits 1 and the report names the deviating row, its shape, the differing field(s), and a diff excerpt
```

```
Given any harness run (pass or fail)
When it completes
Then the real $HOME, ~/.claude, ~/.local/bin, and the repo working tree are byte-unchanged, and no git worktree is left registered (absent --keep)
```

- Assertion: every one of the 51 top-level subcommands appears in `MATRIX` or `EXCLUSIONS`, enforced at runtime (exit 2 on gap).
- Assertion: every matrix row runs under **both** shapes S and C in every gate run.

## 6. DESIGN DECISION RATIONALE

**Is existing coverage sufficient?** **Chosen:** insufficient; harness required — doc-only branch closed (partial-field suite, in-process selftests, zero install-shape invocation).

**Harness home?** Options: permanent `test/` file (implies a stable oracle — but the oracle is a pre-split ref, meaningful for one PR) vs standalone script. **Chosen:** `scripts/verify-split-parity.mjs`, committed in FAFF-440's PR; not wired into the permanent suite.

**How binaries are supplied?** Options: two paths; ref-vs-ref; ref-vs-working-tree. **Chosen:** `--baseline-ref` via temp `git worktree`, candidate = working tree (optional `--candidate-ref`) — matches the FAFF-441 review flow.

**Byte-exactness definition?** Options: normalize known-variable substrings vs exclude + run-in-place swap. **Chosen:** raw stdout+stderr+exit equality, zero normalizations.

**Rows per shape?** Options: per-row shape tags vs everything × both. **Chosen:** full matrix × both shapes — strictly stronger, still cheap (~2×60 spawns/phase).

**Fixture strategy?** Options: re-seed per phase (fresh SHAs → false mismatches) vs seed once + `cp -a`. **Chosen:** seed once via `seed-repo.mjs`, byte-copy per shape per phase — identical `.git` objects by construction.

**Report format?** **Chosen:** text + `RESULT:` line + exit code; no `--json` (no-gold-plating).

**Matrix drift protection?** **Chosen:** runtime coverage self-check against `--help`, fail-closed exit 2 — and the drift path is itself selftested (coverage-drift kill).

**Harness trustworthiness?** **Chosen:** `--selftest` = comparator table + self-parity + one-byte mutation kill + coverage-drift kill — a gate that has never been seen to fail proves nothing.

**Recipe home?** **Chosen:** runnable recipe as a FAFF-441 comment + the script's header comment (the comment cites the script as canonical).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions.**

- **Assumes:** `faff doctor` performs no network calls and confines writes to probes inside resolvable roots. Validation: read `cmdDoctor` (bin/faff:9063 ff.) before finalising the matrix; if it shells to `gh` or writes outside the sandbox, move `doctor` to `EXCLUSIONS` (network) and rely on `hooks-ensure --dry-run` + `--selftest` for shape coverage.
- **Assumes:** `test/helpers/seed-repo.mjs` is importable from a `scripts/` ESM script and its fixture satisfies the pure-read rows' expectations. Validation: import it in the self-parity smoke; extend the template locally in the harness (not seed-repo) if a row needs more.
- **Assumes:** Node resolves a symlinked entrypoint's `__dirname` via realpath, so shape S finds sibling files at the target. Validation: inherent — the shape-S self-parity run fails loudly at setup if not.

## 8. DONE — Definition of Done

### From WHY (spike verdict)
- [ ] The spike answer ("existing coverage insufficient; harness required") stated in the FAFF-441 recipe comment with the three evidence points (partial-field suite, selftests not argv→bytes, no install-shape invocation in `test/`).

### From WHAT (surface and matrix)
- [ ] `scripts/verify-split-parity.mjs` exists, zero-dependency, with `--baseline-ref`, `--candidate-ref`, `--keep`, `--selftest`, exit codes 0/1/2 as specified.
- [ ] `MATRIX` covers: dispatch rows, every validate.yml selftest surface as a subprocess row, the pure-read set, the two hermetic-flag rows, the shape-sensitive probes.
- [ ] `EXCLUSIONS` names every non-matrix subcommand with one of the four reasons; every excluded subcommand with a `--selftest` still has its selftest row.
- [ ] The coverage self-check exits 2 when any `--help`-listed subcommand is in neither list (demonstrable by temporarily deleting a matrix row).

### From HOW (behaviour)
- [ ] Both phases install into identical per-shape paths (run-in-place swap) against byte-copied fixture templates; comparison is `Buffer.equals` raw + exit equality; **zero normalization code present**.
- [ ] Every row runs under shape S (sandbox symlink) and shape C (`CLAUDE_PLUGIN_ROOT` copy), `CLAUDE_PLUGIN_ROOT` set only for C.
- [ ] Child env constructed, not inherited: sandbox `HOME`, minimal `PATH`, `TZ=UTC`, `LC_ALL=C`, no ambient `FAFF_*`/`CLAUDE_*`/`GIT_*`.
- [ ] Mismatch report names row, shape, differing fields, exit codes, bounded diff excerpt; final `RESULT: PASS|FAIL (…)` line.
- [ ] Scratch cleanup removes the temp dir and unregisters the baseline worktree on every exit path via trap/finally (verified absent from `git worktree list`) unless `--keep`.

### From HOW (self-test)
- [ ] `--selftest` passes: comparator table (each field individually detected), self-parity PASS, one-byte mutation kill FAILs naming the deviating row.
- [ ] The coverage-drift kill passes: a synthetic help listing with an uncovered subcommand drives exit 2 naming it (the fail-closed path is demonstrated, not assumed).
- [ ] Full-matrix self-parity (current tree vs itself, both shapes) exits 0 — run once, output pasted into the PR description as evidence.

### From the ticket DoD (recording)
- [ ] A comment on FAFF-441 records the runnable recipe: exact invocation (`node scripts/verify-split-parity.mjs --baseline-ref <merge-base>`), what PASS/FAIL/exit-2 mean, both-shapes coverage claim, pointer to `EXCLUSIONS` for what parity does not cover.
- [ ] The harness committed in FAFF-440's PR (conventional `test:`/`feat:` type).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. ref = current HEAD
  2. node scripts/verify-split-parity.mjs --baseline-ref <ref>   (candidate = clean working tree = HEAD)
  3. ASSERT exit 0, final line "RESULT: PASS"
  4. append one comment line to a USAGE string in the working tree's bin/faff
  5. re-run → ASSERT exit 1 and a mismatch naming a --help/usage row
  6. git checkout -- the touched file
```
