# Spec — FAFF-204: faff sync resolves the repo root for link-skills.sh

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high

This is the build spec for FAFF-204, a follow-up bug to FAFF-200 (the install-health auto-heal). Audience: the build agent implementing the fix, and human reviewers gating it. It specifies how `faff sync` should locate `scripts/link-skills.sh` by default so the doctor-at-entry self-heal works without a hand-passed `--script` override.

## 1. WHY — Problem and Principles

**Problem statement.** `faff sync` (the FAFF-200 repair for a stale copy-install) resolves its default `link-skills.sh` path by walking four directories up from the running CLI binary, which only lands on the repo when the CLI is a symlink into it — i.e. only when the install is already healthy. In the exact state sync exists to fix (skills installed as real-file copies), the walk-up lands at `$HOME`, so sync fails with `cannot find link-skills.sh at $HOME/scripts/link-skills.sh` and every auto-heal needs a manual `--script <abs path>`. This change makes sync resolve the repo root from an anchor that survives the copy-install state, so the repair is zero-touch as FAFF-200 intended.

**Design principles.**

**Anchor on something the broken state can't corrupt.** The resolution must not depend on the CLI binary being a symlink into the repo — that property is precisely what's absent in a copy-install. The working anchor is the process's working directory: `faff sync` is run from inside the repo (the doctor-at-entry flow and the confirmed FAFF-200 workaround both ran from the repo working tree). Resolution that walks up from cwd to a `.git`/`.faff` marker holds in both linked-dev and copy-install states. Reject any implementation that re-derives the repo only from `process.argv[1]`'s location.

**Fail loud, naming what was tried.** When no anchor resolves a readable `link-skills.sh`, exit non-zero (2) with a message listing every candidate path attempted — never a silent no-op and never a single misleading path. This preserves the existing fail-loud contract and the *understandable, not unapproachable* tenet.

**Dependency-free.** The CLI is a single dependency-free Node script. Prefer the in-file `findRoot` `.git`/`.faff` walk over spawning `git rev-parse`, which adds a process dependency and fails outside a git checkout for no gain.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `cmdSync()` | Node (no deps) | The function being fixed; default-path resolution lives here |
| `plugin/skills/faff/bin/faff` → `findRoot(start)` | Node | Existing shared helper: walks up to a `.git`/`.faff` ancestor; the reliable anchor |
| `scripts/link-skills.sh` | Bash | The wrapped script; resolves its own `REPO_ROOT` from `BASH_SOURCE`, so once handed the right path it links correctly |
| `test/sync.test.mjs` | Node test | Existing sync tests; drive sync only via `--script`, so the default path is untested |

**Scope statement.** This sits entirely inside the `faff sync` subcommand's default-script-path resolution; nothing else in the install-health chain (`faff doctor`, `hooks-ensure`, the gateway doctor-at-entry preamble) changes.

## 2. OUT OF SCOPE

- **Changing `link-skills.sh` itself** — Why excluded: the script already resolves its own repo root correctly from `BASH_SOURCE`; the bug is solely in how the CLI *finds* the script. Extension point: `scripts/link-skills.sh` if its own resolution ever regresses.
- **Autonomous auto-run of sync** — Why excluded: FAFF-200 deliberately forbids autonomous `faff sync` (it mutates `~/.claude` outside the PR flow); this fix only makes the *interactive* repair zero-touch. Extension point: the gateway doctor-at-entry preamble (interactive branch).
- **The `faff doctor` detection logic** — Why excluded: doctor already correctly detects copy-installs; only the repair's path resolution is broken. Extension point: `cmdDoctor()`.
- **Resolving the repo when cwd is genuinely outside any faff checkout** — Why excluded: there is no general way to locate the repo with no anchor at all; the correct behaviour is to fail loud and let the human pass `--script`. Extension point: a future `.faffrc`/env hint for repo location, if a real need appears.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Copy-install (stale) | faff skills installed as real-dir copies under `~/.claude/skills/` instead of symlinks into the repo; the CLI binary is then a real file, not a symlink — repo changes are not live |
| Linked-dev install | The healthy state: each skill dir and the CLI on PATH are symlinks into the repo working tree |
| Repo anchor | A directory containing a `.git` or `.faff` marker, identifying the repo root |
| Candidate script path | A fully-resolved absolute path to `scripts/link-skills.sh` that a resolution strategy proposes |

**Resolution interface.** `cmdSync` gains an internal resolver that returns the first readable candidate plus the ordered list of all candidates it tried (for the fail-loud message). Pseudocode shape:

```
PROCEDURE resolve_script_path(args) -> { path: AbsPath | null, tried: List<AbsPath> }:
  # --script override wins outright and is NOT validated-then-fallen-back-from:
  # an explicit override that doesn't exist must fail loud naming exactly it.
  IF args has "--script":
     RETURN { path: override IF readable ELSE null, tried: [override] }

  candidates := ordered list of strategy outputs (see HOW)
  FOR each c IN candidates:
     IF c is a readable file: RETURN { path: c, tried: candidates-so-far-including-c }
  RETURN { path: null, tried: candidates }
```

**Preserved external surface (unchanged).** The `--dry-run`, `--json`, and `--script` flags; the JSON result shape `{ script, ran, dry_run, exit, ok }`; the exit-code passthrough (`link-skills.sh` exit `0→0`, `2→2`, any other non-zero `→1`); and the `--global --replace [--dry-run]` argv handed to the script. None of these change.

**Design decision — resolution strategy.** Walk-up-from-self vs cwd-anchor vs git-subprocess. **Chosen:** a layered resolver — `--script` override first, then cwd-anchored `findRoot` + `scripts/link-skills.sh`, then walk-up-from-self as a secondary fallback — because the cwd anchor is the only one that survives the copy-install state, while keeping walk-up-from-self covers the rare case of running sync from outside the repo tree with a symlinked CLI. Rationale and rejected options in §6.

## 4. HOW — Behavior

**Architecture and approach.** Replace the single hard-coded walk-up computation in `cmdSync` with an ordered resolver. The override path is honoured verbatim (and, if unreadable, fails loud against exactly that path — matching today's behaviour and `test/sync.test.mjs`'s nonexistent-`--script` case). Otherwise the resolver tries each strategy in precedence order and returns the first candidate that is a readable file. If none is readable, it fails loud listing every candidate it tried.

**Resolution order (default, no `--script`).**

```
PROCEDURE default_candidates() -> ordered List<AbsPath>:
  out := []
  # Strategy 1 — cwd/repo anchor (survives copy-install): the reliable primary.
  root := findRoot(process.cwd())            # nearest ancestor with .git or .faff, else cwd
  out.append( join(root, "scripts", "link-skills.sh") )

  # Strategy 2 — walk up from the CLI's own resolved location (legacy; works only
  # when the CLI is a symlink into the repo, i.e. linked-dev run from elsewhere).
  self := realpathSync(process.argv[1])  catch  process.argv[1]
  selfRoot := resolve(dirname(self), "..", "..", "..", "..")
  selfCandidate := join(selfRoot, "scripts", "link-skills.sh")
  IF selfCandidate not already in out: out.append(selfCandidate)

  RETURN out
```

**Run procedure (unchanged below the resolve step).**

```
PROCEDURE cmdSync(args):
  1. { path, tried } := resolve_script_path(args)
  2. IF path is null:
     a. stderr: "faff sync: cannot find link-skills.sh (tried: <tried joined by ', '>)"
     b. RETURN 2                       # fail-loud, names every candidate
  3. linkArgs := ["--global", "--replace"] + (["--dry-run"] IF --dry-run)
  4. r := spawnSync("bash", [path, ...linkArgs], stdio per --json)
  5. IF r.error: stderr "faff sync: failed to run <path>: <msg>"; RETURN 2
  6. result := { script: path, ran: not dry_run, dry_run, exit: r.status, ok: r.status==0 }
  7. emit result (json) or human line, exactly as today
  8. RETURN  r.status==0 ? 0 : (r.status==2 ? 2 : 1)
```

**Edge cases and error handling.**

- **`--script` given but unreadable** → fail loud naming exactly that path, exit 2 (unchanged; the override is never silently replaced by a fallback — an explicit choice that's wrong should not be papered over).
- **cwd inside the repo, copy-install** → Strategy 1 resolves `<repo>/scripts/link-skills.sh`; the fix's main path.
- **cwd outside any repo, CLI symlinked (linked-dev, run from `/tmp`)** → Strategy 1 yields `<cwd>/scripts/link-skills.sh` (unreadable, skipped); Strategy 2 resolves via the symlinked CLI. Covered.
- **cwd outside any repo, copy-install** → both strategies miss → fail loud listing both candidates, exit 2. Correct: there is no anchor, the human must pass `--script`. Terminal.
- **Duplicate candidates** (Strategy 1 and 2 resolve the same path) → de-duplicated so the fail-loud list doesn't repeat a path.

**Anti-pattern:** validating the `--script` override and silently falling through to the default strategies when it's unreadable. Why: it hides the human's typo behind a possibly-wrong default and breaks the existing exit-2 contract for a bad `--script`.

**Anti-pattern:** spawning `git rev-parse --show-toplevel` to find the root. Why: adds a subprocess + git dependency to a deliberately dependency-free CLI, and `findRoot` already encodes the same `.git` anchor (plus `.faff`) in-process.

## 5. SCENARIOS

```
Given a stale copy-install (faff skills are real-dir copies, the CLI binary is not a symlink into the repo)
  and the shell's working directory is inside the repo working tree
When `faff sync --dry-run` is run with no --script
Then it resolves <repo>/scripts/link-skills.sh and invokes it with --global --replace --dry-run
  and exits 0 (no manual --script needed)
```

```
Given a working directory with no .git/.faff anchor and a CLI that cannot be resolved back to a repo
When `faff sync` is run with no --script
Then it exits 2
  and stderr names every candidate path it tried
```

```
Given an explicit --script pointing at a path that does not exist
When `faff sync --script /nope/link-skills.sh` is run
Then it exits 2 and stderr names that exact path (the override is never silently replaced)
```

## 6. DESIGN DECISION RATIONALE

**Which anchor resolves the repo root by default?**

- *Walk up from `process.argv[1]` (status quo).* Pro: no cwd assumption. Con: lands at `$HOME` in the copy-install state — the exact failure. Rejected as the primary.
- *`git rev-parse --show-toplevel`.* Pro: authoritative inside a git checkout. Con: subprocess + git dependency in a dependency-free CLI; fails outside a checkout; no advantage over the in-file `.git` walk. Rejected.
- *Follow the `faff` skill symlink target back to the repo.* Pro: precise when symlinked. Con: in a copy-install there is no symlink to follow — useless in the broken state. Rejected as primary; subsumed by Strategy 2's `realpath` walk for the linked case.
- *cwd-anchored `findRoot` (`.git`/`.faff` walk-up), with the self-walk retained as a secondary fallback.* Pro: survives the copy-install state, dependency-free, reuses an existing tested helper; the self-walk fallback still covers running a linked-dev install from outside the repo. Con: relies on cwd being in (or under) the repo — true for the doctor-at-entry repair flow, and the fail-loud path handles the rest.

**Chosen:** the layered resolver — `--script` → cwd `findRoot` → self-walk — fail loud naming all candidates if none resolves. It fixes the reported failure, keeps the change minimal and proportionate to a Size-S bug, and preserves every existing flag, exit code, and JSON shape.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the resolution strategy is settled by §6.

**Assumptions.**

- **Assumes:** `faff sync` is invoked from within the repo working tree in the doctor-at-entry repair flow. Validation: the gateway *Install health* preamble runs in the user's session whose cwd is the project repo, and the confirmed FAFF-200 workaround ran from `/Users/shftwst/workspace/shftwst/faff`; the build agent confirms `findRoot(process.cwd())` reaches the repo from the repo root before relying on Strategy 1, and the fail-loud path covers the case where it doesn't.
- **Assumes:** `findRoot(start)` already exists in `plugin/skills/faff/bin/faff` and walks to a `.git`/`.faff` ancestor (else returns start). Validation: grep the CLI for `function findRoot` (present at the time of writing, lines ~33-41).

## 8. DONE — Definition of Done

### From WHY
- [ ] On a copy-install with cwd inside the repo, `faff sync` (and `--dry-run`) resolves the script and runs with no `--script` override — the reported `$HOME/scripts/link-skills.sh` failure no longer occurs.

### From WHAT (interfaces)
- [ ] An explicit `--script` path is honoured verbatim; if unreadable, sync exits 2 naming exactly that path (unchanged from today).
- [ ] The JSON result shape stays `{ script, ran, dry_run, exit, ok }`; `--dry-run`, `--json`, `--script` flags unchanged.
- [ ] Exit-code passthrough unchanged: script `0→0`, `2→2`, any other non-zero `→1`.

### From HOW (behaviour)
- [ ] Default resolution tries cwd-anchored `findRoot` first, then the self-walk fallback, returning the first readable candidate.
- [ ] `--global --replace` (plus `--dry-run` when asked) is the argv handed to the resolved script.

### From HOW (edge cases)
- [ ] With no readable candidate, sync exits 2 and stderr lists every candidate path tried.
- [ ] Duplicate candidates are de-duplicated in the tried-list.
- [ ] No `git` subprocess is introduced; resolution stays dependency-free.

### From tests
- [ ] `test/sync.test.mjs` gains coverage for default (no-`--script`) resolution: a temp repo dir with `.git` + `scripts/link-skills.sh` (a stub), run with cwd set there, resolves the stub and runs it.
- [ ] A test asserts the fail-loud branch: no anchor → exit 2 with stderr naming the candidates.
- [ ] All existing sync tests still pass.

**Integration smoke test.**

```
1. Create temp dir T with: T/.git/ (empty marker) and T/scripts/link-skills.sh (stub that logs argv, exits 0)
2. Run `node <repo>/plugin/skills/faff/bin/faff sync --dry-run --json` with cwd = T, no --script
3. Assert: exit 0; parsed JSON .script == T/scripts/link-skills.sh; stub argv log contains "--global --replace --dry-run"
```

## Methodology critique

(agile-delivery lens, `issue-critique`)

- **Right-sized?** Yes. Single 1-day unit: one resolver change in one function plus two tests. No independent second concern to split out; the test addition always ships with the code change. No merge candidate.
- **Workstream fit?** Fits the FAFF-200 install-health auto-heal workstream cohesively — it closes the gap that left that feature needing a manual override. Outcome-named (zero-touch self-heal).
- **Deps surfaced?** Related-to FAFF-200 (Done) is recorded; no open blocker. The fix depends on the existing `findRoot` helper, which is present — no implicit cross-ticket dep.
- **Risk profile?** Low. No novel integration or external dependency; reuses a tested in-file helper and a tested wrapped script. No de-risking spike warranted. The one residual risk (cwd not in the repo) is handled by the fail-loud fallback rather than a wrong default.

confidence: high
