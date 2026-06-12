# FAFF-90 — Seeded-repo substrate: a fixed git/repo state a skill run reads

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-90.

This is the nlspec for **FAFF-90 — Seeded-repo substrate**. It specifies a test helper that provisions a deterministic, real git repository plus a real `.faff/` tree on disk, so that the git-grounding half of faff's skills (wtf / map / tidy / graft, via `faff state`) can be exercised reproducibly. Audience: the build agent implementing the helper, and the human reviewers gating it. It builds directly on ADR 0002 (`docs/adr/0002-skill-test-architecture.md`) and the existing `test/` scaffolding (`test/helpers/run-cli.mjs`, `test/cli-coverage.test.mjs`).

---

## 1. WHY — Problem and Principles

**Problem statement.** faff's skills read local git/filesystem state — branches, worktrees, committed and git-only specs, `.faff/runs` park records and run-ledgers — through the `faff state` read-model, which **shells out to real `git` and reads real files** (verified: `resolveGit` in `skills/faff/bin/faff` calls `spawnSync("git", ["-C", root, "branch", "--list", …])` and `git worktree list --porcelain`; `resolveSpec`/`resolveParked`/`resolveLedgerOutcome` read real files under `docs/specs` and `.faff/`). Today there is no reusable way to put that local substrate into a *known, fixed* shape, so any test of the git-grounding half is either non-reproducible or hand-rolls its own temp dir. FAFF-90 provides a single helper that seeds a deterministic real git repo + `.faff/` tree in a temp directory and returns its path, so tests assert against a fixed local state.

**Design principles:**

**Real seam, real substrate.** The CLI is the system under test, and it invokes real `git` and reads real files. The fixture must therefore be a *real* git repo and a *real* `.faff/` tree — not a stub of git nor a fake filesystem — or the test would exercise a different seam than production. This principle is what rules out the otherwise-simpler stub approach (see RATIONALE).

**Determinism is provisioned, not assumed.** A real git repo is non-deterministic by default (ambient user config, author/committer dates, default-branch name, commit hashes). Every such source of variance must be explicitly neutralised at seed time, and assertions must avoid the residue (commit hashes). An implementation that produces a repo whose `faff state` output varies run-to-run is rejected even if it "works once".

**Zero-dependency.** Per ADR 0002: no `package.json`, no devDependency, no lockfile. The helper uses `node:*` only. Invoking real `git` via `node:child_process` is **not** a new dependency — `git` is the CLI's own runtime dependency, already required by `resolveGit`.

**Injection-agnostic.** The helper provisions a repo and hands back its path + a teardown handle. It does **not** point any skill run at the repo — that wiring is FAFF-93's job. The helper must be usable both by a direct `faff state --root <dir>` call (this issue's own tests) and by the future harness, without change.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/bin/faff` (`cmdState`, `resolveGit`, `resolveSpec`, `resolveParked`, `resolveLedgerOutcome`, `findRoot`, `resolveSpecDocsPath`) | JS (CommonJS) | The system under test — defines exactly what the seeded substrate must stand in for. |
| `test/helpers/run-cli.mjs` | JS (ESM, `node:*` only) | Sibling helper pattern the new helper matches: zero-dep ESM, `spawnSync`, exported funcs, `opts.cwd` for fixture dirs. |
| `test/cli-coverage.test.mjs` | JS (ESM) | Existing temp-dir-fixture precedent (`mkdtempSync` + `writeFileSync`, run CLI against it) that this generalises. |
| `docs/adr/0002-skill-test-architecture.md` | Markdown (ADR) | Parent decision record: assert-at-seam, `node:test`, zero-install, `test/` layout. |
| FAFF-89 (mock-tracker, sibling) | — | The **tracker** half of the substrate; composes with FAFF-90 at the FAFF-93 harness. |

**Scope statement.** This helper is the **local-filesystem/git half** of the deterministic test substrate; its sibling FAFF-89 is the tracker half; they compose at the FAFF-93 skill-run harness. It lives under `test/helpers/` as repo-side tooling — no new CLI subcommand, `.faffrc` key, or `.faff/` artefact (consistent with ADR 0002's "purely repo-side tooling" consequence).

---

## 2. OUT OF SCOPE

- **Pointing a skill run at the seeded repo / capturing skill decisions.** — Excluded: that is the injection + decision-capture problem. — Why excluded: it is the harness's responsibility, and ADR 0002 hands skill-decision capture to FAFF-93/FAFF-95. — Extension point: FAFF-93 consumes the helper's returned repo path; the helper stays injection-agnostic.
- **The tracker fixture model.** — Excluded: the mock tracker (in-memory, agent↔MCP boundary) is a different seam. — Why excluded: it is FAFF-89's sibling deliverable; the two compose only at FAFF-93. — Extension point: FAFF-93 wires a FAFF-89 mock-tracker and a FAFF-90 seeded repo together for a full skill run.
- **Asserting `faff state` correctness / new CLI behaviour.** — Excluded: `faff state` already exists (FAFF-65) and is covered by `test/cli-coverage.test.mjs`. — Why excluded: FAFF-90 builds the *substrate*, not new CLI logic; the helper's own smoke test asserts the substrate produces the expected `faff state` reads, not that it changes `faff state`. — Extension point: FAFF-92's coverage tests can adopt this helper to replace ad-hoc fixture dirs.
- **Commit-hash / object-id assertions and history-graph shapes.** — Excluded: the helper does not expose or stabilise commit SHAs. — Why excluded: `faff state` reads branch *names*, worktree *paths*, file *contents/mtimes* — never hashes. — Extension point: if a future test needs deterministic hashes, the seed env already pins author/committer identity + date, so a follow-up could pin `TZ` and tree bytes and add a hash accessor.
- **Non-git VCS, remotes, network fetch.** — Excluded: no `git clone`, no remotes, no submodules. — Why excluded: `resolveGit` only runs `git branch --list` and `git worktree list` against a local `root`; nothing reads a remote. — Extension point: a future helper option could add a bare-remote fixture if a skill ever reads remote-tracking refs.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Seeded repo | A real git repository (or a `.faff`-only non-git tree) provisioned in a temp directory into a fixed, declared state for a test to read. |
| Seed spec | The declarative input object describing what to provision (commits, branches, worktree, specs, `.faff/` records). |
| Committed spec | A spec markdown file under the configured spec-docs path (`docs/specs` by default), matched by `resolveSpec` via the regex `/-<issue>-.*\.md$/i`. |
| Git-only spec | A spec markdown at `.faff/specs/<issue>.md` (case-insensitive), the location-4 store `resolveSpec` reads. |
| Run record | A `.faff/runs/<run-id>/` directory holding `run-ledger.json`, optional `summary.md`, and optional `<ISSUE>/park.md`. |
| Teardown handle | A returned function that removes the temp directory (and any worktree dir) — the cleanup the existing precedent omits. |

**Type definitions** (pseudocode; build agent translates to project style — ESM, `node:*` only):

```
RECORD SeedSpec:
  defaultBranch: String         # default "main"; the fixed init branch name
  git: Boolean                  # default true. false => .faff-only, non-git tree
  commits: List<SeedCommit>     # ordered; applied on defaultBranch. May be empty.
  branches: List<String>        # extra branch names to create (e.g. "feat/FAFF-90-x")
  worktree: SeedWorktree | null # default null; at most one in v1
  specs: List<SeedSpecFile>     # committed and/or git-only spec files
  runs: List<SeedRun>           # .faff/runs/<run-id> records
  files: Map<RelPath, String>   # arbitrary extra working-tree files (e.g. .faffrc.yaml)

RECORD SeedCommit:
  message: String
  files: Map<RelPath, String>   # files written then committed in this commit

RECORD SeedWorktree:
  branch: String                # branch the linked worktree checks out (must be in branches or created)

RECORD SeedSpecFile:
  issue: String                 # e.g. "FAFF-90"
  location: "committed" | "git-only"
  body: String                  # markdown; include a "confidence: <high|medium|low>" line if the test asserts spec rating

RECORD SeedRun:
  runId: String                 # date-prefixed so lexical sort == chronological (e.g. "2026-01-02-test")
  ledger: LedgerObject          # serialised verbatim to run-ledger.json
  summary: String | null        # optional summary.md body
  parks: Map<Issue, String>     # issue -> park.md body; written to <run-id>/<ISSUE>/park.md

RECORD LedgerObject:            # the run-ledger.json shape readLedger/resolveLedgerOutcome consume (VERIFIED)
  run_id: String
  admitted: List<Issue>
  outcomes: Map<Issue, TerminalState>   # {shipped, pr-open, parked, errored, routed-out, unreached-budget}
  # extra keys (e.g. discovered_scope_filed) are tolerated and passed through verbatim

RECORD SeededRepo:              # the helper's return value
  root: String                  # absolute path to the temp repo root (pass as `faff state --root <root>`)
  worktreePath: String | null   # absolute path to the linked worktree dir, if one was seeded
  teardown: Function() -> void  # idempotent; rmSync(root, {recursive,force}) + any worktree dir
```

**Helper interface:**

```
INTERFACE test/helpers/seed-repo.mjs   # ESM, node:* only, mirrors run-cli.mjs style
  EXPORT seedRepo(spec: SeedSpec) -> SeededRepo
```

**Determinism env (applied to every `git` invocation the helper makes):**

```
GIT_CONFIG_GLOBAL  = <devnull>     # neutralise ambient ~/.gitconfig
GIT_CONFIG_SYSTEM  = <devnull>     # neutralise /etc + machine config
GIT_AUTHOR_NAME    = "faff test"
GIT_AUTHOR_EMAIL   = "test@faff.invalid"
GIT_AUTHOR_DATE    = "2026-01-01T00:00:00 +0000"   # fixed
GIT_COMMITTER_NAME = "faff test"
GIT_COMMITTER_EMAIL= "test@faff.invalid"
GIT_COMMITTER_DATE = "2026-01-01T00:00:00 +0000"   # fixed
# default branch fixed via `git init -b <defaultBranch>`
```

**Design decision — fixture substrate: real git tree vs stubbed git.** **Chosen:** Real temporary git repo + real `.faff/` tree on disk, with determinism provisioned explicitly (env above). The stub is rejected because the SUT runs out-of-process and shells to real `git` — only a real tree exercises that boundary. **This is the FAFF-90 analog of FAFF-89's fidelity decision, and the two land oppositely on purpose** (the asymmetry, §5).

**Design decision — git determinism controls.** **Chosen:** Provision all of: fixed `GIT_AUTHOR_*`/`GIT_COMMITTER_*` name+email+date; `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → an OS null device; fixed default-branch via `git init -b <defaultBranch>`; and assert only on hash-free reads.

---

## 4. HOW — Behavior

**Architecture and approach.** `seedRepo(spec)` creates a fresh temp dir (`mkdtempSync(join(tmpdir(), "faff-seed-"))`), provisions the git repo and/or `.faff/` tree from the spec using real `git` (with the determinism env) and `node:fs` writes, then returns `{ root, worktreePath, teardown }`. Tests call `runCli(["state", issue, "--root", root])` and assert the deterministic `faff state` JSON seam. Teardown is registered by the test via `node:test`'s `after(...)`.

```
PROCEDURE seedRepo(spec):
  1. root = mkdtempSync(join(tmpdir(), "faff-seed-"))
  2. env = { ...process.env, ...DETERMINISM_ENV }   # GIT_* + GIT_CONFIG_* → devnull
  3. IF spec.git (default true):
     a. git("init", "-b", spec.defaultBranch || "main")
     b. FOR each commit IN spec.commits: write files, git add -A, git commit -m message
     c. IF spec.commits empty BUT branches/worktree/committed-specs requested: placeholder commit
     d. FOR each name IN spec.branches: git("branch", name)
     e. write committed specs under resolveSpecDocsPath-equivalent ("docs/specs/<date>-<issue>-<slug>.md"), git add -A + commit
     f. IF spec.worktree: worktreePath = join(root, ".worktrees", safe(branch)); git("worktree","add",worktreePath,branch)
  4. ELSE: create root/.faff so findRoot anchors here; do NOT git init
  5. write git-only specs at root/.faff/specs/<issue-lowercased>.md   # NOT committed
  6. FOR each run: write .faff/runs/<runId>/run-ledger.json (+ optional summary.md, <ISSUE>/park.md)
  7. write spec.files (arbitrary extra working-tree files)
  8. teardown = () => { rmSync(worktreePath?, {recursive,force}); rmSync(root, {recursive,force}) }
  9. RETURN { root, worktreePath: worktreePath ?? null, teardown }
```

The internal `git(...args)` runs `spawnSync("git", ["-C", root, ...args], { env })` and **throws** on non-zero status — the asymmetry with `resolveGit` (which swallows to `[null,null]` at read time): a git failure during provisioning is a broken fixture and must fail loud, or tests run against a half-built repo.

**Edge cases and error handling** (all VERIFIED against the CLI at build time):
- *`.faff`-only (non-git) tree* (`spec.git === false`): no `git init`; `findRoot` anchors on `.faff`; `faff state` returns `branch: null`, `worktree: null`.
- *Branch-name matching:* `resolveGit` matches the first branch whose name *contains* the issue id, case-insensitively — seed names like `feat/FAFF-90-seed`.
- *Committed-spec filename:* must contain `-<issue>-` to match `/-<issue>-.*\.md$/i`.
- *Spec confidence parsing:* a body lacking `confidence:` defaults to `high` (stderr note); include `confidence: <rating>` to assert a rating.
- *Newest-run-wins:* `resolveParked`/`resolveLedgerOutcome` iterate run dirs newest-first by lexical run-id sort; encode recency in run-ids.
- *Worktree requires a commit:* the placeholder commit guarantees HEAD has a commit when a worktree/branch is requested.
- *Teardown:* removes the worktree dir then root; idempotent (`force:true` swallows ENOENT).

**Anti-patterns:** asserting on commit hashes (faff state reads none); inheriting ambient git config (skipping the devnull redirect makes the fixture machine-dependent); reusing one seeded repo across tests / not tearing down.

---

## 5. DESIGN DECISION RATIONALE

**Real git tree vs stubbed git.** **Chosen:** Real temporary git repo + real `.faff/` tree. The decisive fact (VERIFIED) is that the SUT is invoked as a child process (`run-cli.mjs` spawns `node faffBin`) and `resolveGit` shells to real `git`; an in-process stub cannot intercept that. **The asymmetry with FAFF-89 is load-bearing:** FAFF-89's seam is agent↔MCP (in-process), so its faithful fixture is an *in-memory* model; FAFF-90's seam is CLI→real-`git`+real-`fs` (on-disk), so its faithful fixture is a *real seeded tree*. Same goal, opposite implementations, because the boundaries differ.

**Determinism controls.** **Chosen:** Pin author/committer name+email+date, neutralise `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` to the OS null device, fix the default branch via `git init -b`, and assert only hash-free reads — the minimal control set that makes every value `faff state` actually reads stable.

**Helper location/shape.** **Chosen:** `test/helpers/seed-repo.mjs`, exporting `seedRepo(spec) -> { root, worktreePath, teardown }`, matching `run-cli.mjs` conventions. No new CLI surface.

---

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** None. (No `**Punt:**` markers — the central decisions are closed `**Chosen:**`.)

**Assumptions:**
- **Assumes:** `git` (a version supporting `init -b`) is on `PATH`. Validation: `git --version` (VERIFIED here: 2.39.5).
- **Assumes:** the `run-ledger.json` shape `{ run_id, admitted[], outcomes{} }` and spec-discovery rules are as read from `skills/faff/bin/faff`. Validation: re-grep `resolveSpec`/`resolveLedgerOutcome`/`readLedger` before coding (done at build time).
- **Assumes:** an OS null device path is available. Validation: use `os.devNull`.

---

## 7. DONE — Definition of Done

### From WHY
- [ ] A single helper provisions a deterministic real git repo + `.faff/` tree and returns its path; running `faff state <issue> --root <path>` against the same seed twice yields byte-identical JSON (modulo the temp-root prefix).
- [ ] The helper uses `node:*` only — no `package.json`, devDependency, or lockfile added.
- [ ] The helper does not point any skill run at the repo; it only returns `{ root, worktreePath, teardown }`.

### From WHAT (types and interfaces)
- [ ] `test/helpers/seed-repo.mjs` exists, is ESM, imports only `node:*`, and exports `seedRepo`.
- [ ] `seedRepo(spec)` returns `{ root: string (absolute), worktreePath: string|null, teardown: function }`.
- [ ] Committed specs are written as `<…>-<issue>-<…>.md` under the spec-docs path and discoverable by `resolveSpec`'s regex.
- [ ] Git-only specs are written at `.faff/specs/<issue-lowercased>.md` and are NOT committed.
- [ ] `run-ledger.json` is written with `{ run_id, admitted, outcomes }` and any extra keys verbatim.
- [ ] Park records are written at `.faff/runs/<run-id>/<ISSUE>/park.md`.

### From HOW (behaviour)
- [ ] Every `git` invocation runs with the fixed `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → `os.devNull`.
- [ ] The default branch is fixed via `git init -b <defaultBranch>` (default `main`).
- [ ] A `.faff`-only tree (`spec.git === false`) is seedable: `faff state` returns `branch: null`, `worktree: null`.
- [ ] A seeded branch whose name contains the issue id resolves as `branch`; a seeded matching worktree resolves as `worktree`.
- [ ] A seeded run-ledger `outcomes[<issue>]` surfaces as `ledger_outcome`; the newest run wins.
- [ ] A seeded `<run-id>/<issue>/park.md` surfaces as `parked: true`; newest run wins.
- [ ] A committed spec body containing `confidence: medium` surfaces as `spec: "medium"`.
- [ ] A `git` failure during provisioning throws (no swallow).

### From HOW (edge cases)
- [ ] `teardown()` removes the temp dir (and any worktree dir) and is idempotent.
- [ ] No commit-hash/object-id is exposed or asserted.

### Integration smoke test
Per §smoke: seed commits/branch/worktree/committed-spec(confidence medium)/run-ledger(shipped), run `faff state FAFF-90 --root root`, assert `issue/spec/branch/worktree/ledger_outcome/parked`, re-seed identical and assert determinism modulo root prefix, then teardown and assert dirs gone.

---

confidence: high
