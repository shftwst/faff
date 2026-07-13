# Spec — faff-graft: stage selectively in a build worktree (never `git add -A`)

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-457.

This spec addresses FAFF-457 (build-safety / secret-leak bug). Audience: the build agent implementing the fix, and human reviewers. It closes the vector where a bulk `git add -A` in a build worktree sweeps a stray untracked secret (e.g. `.env`) into a committed, pushed PR — as happened in PR #258.

## 1. WHY — Problem and Principles

**The load-bearing model.** A git worktree accumulates untracked files no one intends to commit — local `.env`, scratch output, copied config. `git add -A` (and `git add .`) stages **all** of them, gated only by `.gitignore`. `.gitignore` is a denylist that is one omission away from a leak. The safe primitive is the inverse: stage an **explicit, intended set of paths** — an allowlist — so an unintended file is never swept in *regardless of gitignore coverage*.

**Problem statement.** faff builds in a worktree, then stages+commits before opening a PR; a `git add -A` there once committed a live-secret `.env` into a pushed PR (#258) because only `.env.claude-box` was gitignored, not `.env`. FAFF-315/PR #259 has since patched `.gitignore` to cover `.env` / `.env.*`, but that is a gitignore *patch*, not a *fix of the mechanism* — the next uncovered secret-class file leaks the same way. This change makes graft (and every other worktree commit path) stage selectively so the leak cannot recur from a gitignore gap.

**Design principles.**

- **Allowlist, not denylist.** Correctness comes from staging only intended paths, not from enumerating what to exclude. The secret-class guard (below) is a cheap backstop, never the primary defence.
- **In-concern, not a scanner.** The guard is a **filename-class** check, not content-based secret scanning. Content scanning was deliberately ruled out of faff's concern — FAFF-103 (pre-commit / CI secret scanning) was correctly cancelled as dev-infra. This spec does **not** reintroduce it.
- **One home for the rule.** Every worktree commit path routes through a single mechanical chokepoint, matching faff's existing pattern (`faff label` / `label.js`). No per-call-site copy of the staging discipline.
- **A security guard fails loud.** Where the intent is a precise commit (the build commit), a staged secret-class path is a hard failure, not a silent drop.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` (≈L654–673) | JS | `faff sentry abort --worktree` WIP commit — does a literal `git add -A` in the build worktree. Primary code site. |
| `plugin/skills/faff-graft/SKILL.md` (Step 7 build → Step 8b push) | prose | The build-commit path — currently leaves committing to the implementer freehand, with no selective-staging discipline. The original PR #258 vector. |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (L59, member-park) | prose | Member-park WIP commit, prescribed as `git add -A && git commit`. |
| `plugin/skills/faff-graft/SKILL.md` (L438, ADR-collision renumber) | prose | `git add -A docs/adr/` — already path-scoped; lower risk but in the same class. |
| `.gitignore` (L23–29) | config | FAFF-315/PR #259 already ignores `.env`/`.env.*`; this spec makes the fix not *depend* on that. |
| `plugin/skills/faff/bin/lib/label.js` + `faff label` | JS/CLI | The precedent for a shared pure-lib + thin CLI verb consumed by both JS and prose call sites. |

**Scope statement.** This lives in faff's build-safety layer: the staging step of every worktree commit the pipeline performs.

## 2. OUT OF SCOPE

- **Content-based secret scanning** — Why excluded: dev-infra, not faff's product concern; FAFF-103 cancelled on exactly this basis. Extension point: a repo's own pre-commit / CI (e.g. gitleaks) outside faff.
- **Env/secret lane-visibility ownership** — Why excluded: that is FAFF-32 (what each lane/actor may *see*); this ticket is only about what gets *staged*. Extension point: FAFF-32.
- **Auditing/repairing history that already leaked** — Why excluded: remediation of a past leak (rotate, rewrite) is operational, not this preventive change. Extension point: an operator runbook.
- **The `.gitignore` contents themselves** — Why excluded: already handled by FAFF-315/PR #259; this change deliberately does not lean on gitignore. Extension point: `.gitignore`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Selective stage | Stage an explicit allowlist: tracked changes (`git add -u`) plus each intended new path named individually — never `-A` / `.` / a bare directory wildcard. |
| Secret-class path | A path whose **basename** matches a fixed filename denylist (below) — independent of gitignore state. |
| Assert mode | Guard hard-fails (non-zero) if any staged path is secret-class. For precise commits (the build commit). |
| Filter mode | Guard leaves secret-class paths unstaged and reports them, so the commit still succeeds. For WIP-preservation commits that must not lose work. |

**The secret-class denylist (fixed, filename-only).** Basename matches (case-insensitive), evaluated after stripping directory:

```
.env                 .env.*         (EXCEPT .env.example, .env.*.example, .env.sample)
*.pem  *.key  *.p12  *.pfx  *.keystore  *.jks
id_rsa*  id_dsa*  id_ecdsa*  id_ed25519*        (but NOT *.pub)
.netrc  .pgpass  *.pgpass
credentials  credentials.json  .npmrc  .pypirc
```

This list is a constant in one module; extending it is a one-line change. It is a **class** guard (does this look like a secrets file?), explicitly not a content scan.

**The shared chokepoint — one implementation, two entry points** (mirrors `label.js` + `faff label`):

```
MODULE bin/lib/stage.js

  CONST SECRET_CLASS_PATTERNS = [ ...as above... ]

  FUNCTION isSecretClass(basename) -> bool
    # true iff basename matches a denylist pattern and is not an *.example/.sample allowlist exception

  FUNCTION stagedPaths(worktree) -> List<path>
    # `git -C <worktree> diff --cached --name-only -z` parsed

  FUNCTION guardStaged(worktree, mode) -> { secretStaged: List<path>, ok: bool, unstaged: List<path> }
    # mode = "assert": ok=false if secretStaged non-empty; unstage nothing
    # mode = "filter": `git -C <worktree> restore --staged <each secret path>`; unstaged=those; ok always true

  FUNCTION selectiveStage(worktree, { trackedChanges: bool, newPaths: List<path> })
    # trackedChanges -> `git -C <worktree> add -u`
    # each newPaths entry -> `git -C <worktree> add -- <path>`  (explicit pathspec, never a wildcard)
```

**CLI surface** (thin wrapper over the lib, for prose call sites — resolve `faff` per gateway → Resolving the executable):

```
faff stage-guard --worktree <dir> --mode assert|filter [--json]
  # runs guardStaged(); assert: exit 0 = clean, exit 1 = secret-class path staged (names on stderr/JSON)
  #                     filter: exit 0 always, JSON lists any paths it unstaged
```

`stage.js` is **pure git-plumbing only** — no tracker MCP, no network — consistent with the other `bin/lib` helpers.

**Design decisions.**

- Shared lib + thin CLI vs. per-site prose discipline. **Chosen:** shared lib (`stage.js`) with a `faff stage-guard` CLI wrapper. JS callers (`sentry.js`) call the lib directly; prose callers (graft/concurrency SKILLs) shell the CLI. One rule, one home, both worlds — exactly the `label.js`/`faff label` split. Rationale: prose-only discipline in three SKILLs would drift; a code-only lib can't be invoked from prose steps.
- Guard behaviour on a staged secret. **Chosen:** two modes — `assert` (hard-fail) for the precise build commit, `filter` (exclude + log, never lose the commit) for WIP-preservation commits. Rationale: a build commit that stages a secret is a defect and must stop loudly; a sentry-abort/member-park WIP commit exists to preserve in-flight work and must still succeed, so it drops the secret-class file and records it rather than aborting resumability.
- Denylist scope. **Chosen:** filename-class only, one small constant list. Rationale: keeps the change firmly in-concern (not a content scanner — FAFF-103 boundary) while catching the exact `.env`-shaped vector that leaked.

## 4. HOW — Behaviour

**Overview.** Three worktree commit paths stop using `git add -A`; each stages an allowlist and passes through the guard.

**A. Build commit (graft Step 7 → Step 8b) — the primary vector.**

```
PROCEDURE build_commit(worktree, intended_new_paths):
  1. selectiveStage(worktree, { trackedChanges: true, newPaths: intended_new_paths })
     # tracked edits via `git add -u`; each new build output added by explicit path — NEVER `git add -A`/`.`
  2. guardStaged(worktree, mode="assert")
     a. IF a secret-class path is staged -> ABORT the commit, surface the path(s) loudly,
        log to .faff/runs/<run-id>/<ISSUE>/graft.md; do NOT push. (Belt-and-braces: selective
        staging should already have prevented it; a hit means an intended path list was wrong.)
  3. git commit ; proceed to Step 8b push
```

The graft SKILL's build/commit prose is amended to state this explicitly: enumerate intended paths, `git add -u` + explicit adds, run `faff stage-guard --mode assert` before commit, never a bulk add.

**B. Sentry-abort WIP commit (`sentry.js`, the current `git add -A` site).** Intent: preserve *all* in-flight work so the run resumes — but never sweep a secret.

```
PROCEDURE wip_commit(worktree):
  1. git add -u                                  # all tracked modifications/deletions (a tracked file
                                                 #   is already in history — it cannot be a stray secret)
  2. FOR each untracked path in `git status --porcelain`:
       IF NOT isSecretClass(basename): git add -- <path>
       ELSE: leave unstaged; collect for the report
  3. guardStaged(worktree, mode="filter")        # belt-and-braces: unstage any secret-class that slipped in
  4. IF staged tree non-empty: git commit -m "wip: sentry abort (resumable) ..."
  5. Report any skipped secret-class paths in the abort payload / log (so the operator knows WIP omitted them)
```

Result: the WIP commit still captures every legitimate in-flight change and still records a resumable sha, but a stray `.env` is never committed.

**C. Member-park WIP commit (concurrency SKILL L59).** Same intent as B; the SKILL's `git add -A && git commit` is replaced by the same selective WIP procedure (reuse `stage.js`, ideally by routing the member-park WIP through the same `sentry.js` path or the CLI).

**D. ADR-collision renumber (graft L438).** Already path-scoped (`git add -A docs/adr/`). Tighten to add only the specific renumbered ADR file(s) by explicit path and run `stage-guard --mode assert` before commit. Lower-risk, folded in for consistency.

**Anti-pattern:** `git add -A` or `git add .` anywhere inside a build worktree. Why: it stages every untracked file, gated only by gitignore, which is one omission from a leak.

**Anti-pattern:** implementing a content scanner to inspect file *bytes*. Why: out of concern (FAFF-103 cancelled); this guard is filename-class only.

**Failure modes.**

- **The failure:** the denylist misses a novel secret-class filename → it could still be staged by the WIP path (which stages untracked-not-denylisted). **How you'd know:** a secret with an unlisted name appears in a WIP commit. **What it means:** narrow — extend the one constant list; the allowlist build-commit path (A) is unaffected because it never stages unnamed untracked files at all.
- **The failure:** an `*.example`/`.sample` allowlist exception is over-broad and lets a real `.env.production.example`-named secret through. **How you'd know:** review of staged tree shows a secrets-bearing `.example`. **What it means:** proceed — `.example` files are conventionally non-secret; if abused, tighten the exception. Low risk.
- **The failure:** selective staging in path A omits a file the build *did* intend, producing an incomplete PR. **How you'd know:** CI/review shows a missing file. **What it means:** proceed — a missing intended file is a visible, recoverable build error; a swept secret is an invisible, unrecoverable leak. The trade is deliberately asymmetric toward safety.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a build worktree containing an untracked, non-gitignored `.env` holding a live secret
When graft runs its build commit (selective stage + `faff stage-guard --mode assert`)
Then `.env` is NOT in the committed/pushed tree, verified via `git ls-tree -r <branch>` (never `gh pr view --json files`, which is stale after force-push)
```

```
Given the same worktree with an untracked `.env`
When a `faff sentry abort --worktree <dir>` WIP commit runs
Then the resumable WIP commit is still created AND `.env` is not staged in it, and the skipped path is reported
```

```holdout
Given a build worktree with an untracked `secrets.pem` (gitignored by nothing) alongside a legitimate new source file
When the build commit stages selectively and the guard runs in assert mode
Then the guard hard-fails on the staged secret-class path if it was staged, and in the passing path only the intended source file is committed — `secrets.pem` never reaches the branch
```

- The build-commit and WIP paths contain **no** `git add -A` / `git add .` (assertion, grep-verifiable across the touched files).
- `faff stage-guard --mode assert` exits non-zero when a secret-class path is staged, zero when clean (assertion).

## 6. DESIGN DECISION RATIONALE

**How should the worktree stage changes?** Options: (a) keep `git add -A`, fix gitignore each time — rejected: leaks on the next gap, already the failure. (b) allowlist selective staging. **Chosen:** (b) — `git add -u` + explicit named new paths; correctness independent of gitignore.

**Where does the rule live?** Options: prose in each SKILL; a JS lib only; a CLI only. **Chosen:** shared `bin/lib/stage.js` + a thin `faff stage-guard` CLI, so JS (`sentry.js`) and prose (SKILLs) share one implementation — the established `label.js` / `faff label` pattern.

**Guard on a staged secret — abort or drop?** **Chosen:** mode-dependent — `assert`/abort for the precise build commit; `filter`/drop-and-report for WIP-preservation commits that must not lose resumability. A single fixed behaviour would either break WIP resumability or let a build commit proceed with a secret.

**Guard breadth?** Options: content scan; filename-class. **Chosen:** filename-class only — stays inside faff's concern (FAFF-103 boundary) while catching the `.env`-shaped vector.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (Minor, non-blocking: the exact denylist membership can be tuned in review; the starting list above is sufficient for the known vector.)

**Assumptions.**

- **Assumes:** the build implementer can enumerate the paths it intends to commit (it created/edited them). Validation: it is the actor that made the changes; `git status` names them. If a path set is genuinely unknowable, that is itself a signal the commit is too broad.
- **Assumes:** `git`, `git restore --staged`, and porcelain status are available in the worktree (already relied on by `sentry.js`). Validation: existing `sentry.js` git calls already assume this.

## 8. DONE — Definition of Done

### From WHY
- [ ] No build-worktree commit path uses `git add -A` or `git add .` (grep of the touched files is clean); the safety no longer depends on `.gitignore` coverage.

### From WHAT (types and interfaces)
- [ ] `bin/lib/stage.js` exists exposing `isSecretClass`, `guardStaged(worktree, mode)`, and `selectiveStage(...)`; the denylist is a single constant.
- [ ] `faff stage-guard --worktree <dir> --mode assert|filter [--json]` exists: assert exits 1 on a staged secret-class path, 0 when clean; filter exits 0 and reports unstaged paths. It makes no tracker/network calls.
- [ ] `.env.example` / `*.example` / `.sample` are treated as non-secret (allowlist exceptions).

### From HOW (behaviour)
- [ ] Graft's build-commit stages tracked changes + explicit new paths and runs `stage-guard --mode assert` before commit/push; the SKILL prose says so explicitly.
- [ ] `sentry.js` WIP commit no longer calls `git add -A`; it stages `git add -u` + non-secret-class untracked paths and reports any skipped secret-class file; a resumable WIP sha is still produced.
- [ ] The concurrency member-park WIP prose (L59) no longer prescribes `git add -A`; it uses the shared selective procedure.
- [ ] The ADR-renumber commit (graft L438) stages the specific renumbered file(s) by explicit path (no `-A`) and passes the guard.

### From HOW (edge cases / born-verifiable)
- [ ] Given an untracked live-secret `.env` in the worktree, after the build commit `git ls-tree -r <branch>` does NOT list `.env`.
- [ ] Given an untracked `.env`, the sentry-abort WIP commit is still created and `.env` is not staged in it.
- [ ] `faff stage-guard --mode assert` returns non-zero when a secret-class path is staged and zero otherwise (unit-testable against a scratch repo).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. init a scratch git repo/worktree; write an untracked `.env` (NOT gitignored) + a tracked edit
  2. run the selective build-commit path
  3. assert: commit exists, tracked edit present, `.env` absent from `git ls-tree -r HEAD`
  4. run `faff stage-guard --mode assert` after force-staging `.env` -> expect exit 1
```

confidence: high

spec-review: approve
