# FAFF-526 — Git-only local-merge path — ship a build without a remote/PR/CI

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-526.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): the `merge-fence`-hardening security punt is closed — **the fence extension is bundled into this ticket, not a fast-follow**. Scoped precisely: the `merge-fence` PreToolUse hook additionally denies raw base-branch **mutation** (`git merge <feature>` on the base branch, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>`) and **only when the repo has no git remote** (mirroring the `--local` gate's remote-presence activation guard); it must NOT block base-branch **consumption** (`git merge <base>` from a feature branch). Re-rated **medium → high** (the one security punt resolved into scope).

This spec is for the build agent implementing FAFF-526 and for the human reviewers gating it. It adds a **git-only local-merge branch** to `faff merge-gate` so a purely-local system-under-test (no remote, no `gh`, no CI — the external-verification SUTs) can complete the graft ship step and a full autonomous drain can finish, **and** extends `merge-fence` to mechanically fence raw local base-branch mutation on no-remote repos. It touches `merge-gate.js` and `merge-fence.js` (the CLIs), and the `faff-graft` / `faffter-noon-ship` / `faff-beep-boop` skill prose that sequence the merge. It assumes familiarity with the merge-gate keystone (FAFF-350 / ADR-0043) and the graft ship steps (7.5, 8, 8b, 9, 9b, 10, 11).

## Refresh (operator resolution, 2026-07-16)

The former §6 security Punt ("extend merge-fence, and how broadly?") is now **Chosen** and **in scope**:

- **The `merge-fence` PreToolUse hook additionally denies raw base-branch mutation** — `git merge <feature>` while on the base branch, `git update-ref refs/heads/<base>`, and `git push . HEAD:<base>` — via a new sibling matcher `matchesRawLocalBaseMerge` alongside the existing `matchesRawGhMerge`.
- **Activation guard: only when the repo has no git remote** — mirror the `--local` gate's own remote-presence activation guard (`git remote` empty ⇒ fence active; non-empty ⇒ fence dormant, unchanged behaviour).
- **Must NOT block base-branch consumption** — `git merge <base>` run *from a feature branch* is a legitimate update and stays allowed. Only *mutation of the base branch itself* is denied.
- **Rationale (folded into WHY):** on a bare local repo there is no forge/PR/CI trail, so this fence is what makes `--local` *mechanical* rather than compliance-dependent; scoped to no-remote it is dormant on every remote-backed repo → **zero impact on L1–L3 remote workflows**. The remedy string points offenders at `faff merge-gate --local`.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate`'s merge decision is already a *pure floor* (`decideFloor` in `contract-defs.js`) fed by a `floor` object, wrapped in a thin impure shell that today sources every leg from GitHub (`gh repo view`, `gh pr view`, `gh api …/check-runs`). The three-condition floor is **AC-verified + review-`pass` + CI-green**. On a repo with no remote, the *CI-green* leg has no forge to observe — but CI is only a **remote re-run** of the same engineering gates graft already ran locally at Step 7.5. So the git-only path does **not** invent a new check: it **substitutes the CI-green leg with a fresh local `faff gates run` on the final state** (the "CI equivalent", fail-closed) and substitutes the impure `gh pr merge` with a local `git merge`. The AC leg (Step 8) and review leg (Step 9) already run pre-PR and are unchanged. `decideFloor` itself never changes — the local path just populates its `floor` object from local sources.

**Problem statement.** graft's ship step is PR/CI/remote-centric — Step 8b `git push origin`, Step 9b `gh pr create` (CI fires), then `faff merge-gate --pr <n>` (the sole sanctioned `gh pr merge`). A purely-local SUT cannot run any of those, and the lights-out preflight does not refuse for it (it probes only local guardrails), so the run starts then errors/stalls at push/PR. This adds a sanctioned git-only merge mode that merges the feature branch to the base branch locally, gated on the identical three-condition floor — **and** hardens `merge-fence` so that on a no-remote repo the only way code lands on the base branch is that gate.

**Design principles:**

- **The floor is never weakened.** The git-only path merges only when AC-verified **and** review-`pass` **and** the local `faff gates run` is green — the same three legs, fail-closed on any missing/indeterminate signal. It is a *branch* of the floor, never a bypass. `decideFloor` is reused verbatim; the local path may only *populate* its inputs, never re-decide them.
- **Detected, never forced.** The local path is taken only when there is genuinely no pushable remote. A repo with a remote keeps the PR/CI/merge-gate path unchanged — even one that is momentarily offline (prefer to fail loud on the PR path over silently dropping to an un-CI'd local merge). This makes the mode bypass-proof: `--local` cannot be used to skip CI on a remote repo.
- **The gate observes the CI-equivalent itself.** Mirroring the FAFF-350 keystone property ("the gate observes CI itself on the head sha, never trusts a caller verdict"), `merge-gate --local` runs `faff gates run` **fresh at merge time** on the final branch tip — it does not trust graft's earlier Step-7.5 result handed in by a caller.
- **One sanctioned merge locus — now mechanically fenced on no-remote repos.** There is exactly one code path that lands code on the base branch locally: `faff merge-gate --local`. graft and the `ship` producer never call a raw `git merge` into the base branch — and on a no-remote repo `merge-fence` now **mechanically denies** the raw local base-branch mutation spellings, so this is no longer prose-discipline alone.
  - **The forge branch-protection backstop, replaced on no-remote repos.** On the PR path, GitHub branch protection is an independent mechanical wall. In git-only mode that forge wall is absent — so this ticket supplies the *local* mechanical wall: `merge-fence`'s new `matchesRawLocalBaseMerge` matcher, active only when `git remote` is empty, denies `git merge <feature>` on the base branch, `git update-ref refs/heads/<base>`, and `git push . HEAD:<base>`, leaving `faff merge-gate --local` (with its own fail-closed floor) as the only path onto the base branch. On any remote-backed repo the matcher is dormant, so remote workflows are untouched.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JS (Node) | `cmdMergeGate` — the sole merge shell; gains the `--local` branch |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JS | `decideFloor` (`CONTRACTS["integrity-floor"]`) — reused unchanged |
| `plugin/skills/faff/bin/lib/gates.js` | JS | `faff gates run` — the local CI-equivalent source |
| `plugin/skills/faff/bin/lib/merge-fence.js` | JS | PreToolUse deny of raw `gh pr merge` (`matchesRawGhMerge`); gains `matchesRawLocalBaseMerge` (no-remote-gated) |
| `plugin/skills/faff/bin/lib/post-merge.js` | JS | `post-merge-check` — already git-sha-driven; verify no-PR behaviour |
| `plugin/skills/faff/bin/lib/reconcile.js` | JS | `reconcile` — pure verb; caller supplies evidence |
| `plugin/skills/faff-graft/SKILL.md` | prose | Steps 8b/9b no-ops; Step 10 local-path selection |
| `plugin/skills/faffter-noon-ship/SKILL.md` | prose | default `ship` producer — git-only precondition + `--local` invocation |
| `plugin/skills/faff-beep-boop/SKILL.md` | prose | Step 11 reconcile evidence from git ground-truth |
| `docs/external-verification/` | scaffolds | the git-only SUTs (FAFF-310) that exercise this end-to-end |

**Scope statement.** This is the merge-locus's git-only sibling condition (selected by remote-absence detection) **plus** the no-remote-gated `merge-fence` hardening that mechanically enforces the single-locus guarantee.

---

## 2. OUT OF SCOPE

- **Non-fast-forward local merge policy** — what's excluded: reconciling divergent local histories with a real merge commit when the branch is not fast-forwardable. **Why excluded:** git-only SUTs run single-session/sequential, so the base branch rarely moves under a build; the ff-only path plus rebase-first covers them. **Extension point:** `merge-gate.js` `--local` branch — add a non-ff arm (`git merge --no-ff`) behind a `graft.local_merge_method` knob.
- **A full shell-aware matcher that catches *every* obfuscated raw local merge spelling** — what's excluded: a general shell parser. **Why excluded:** `merge-fence.js` is the *outermost* guardrail, not a security boundary (a regex is not a shell parser); this ticket denies the **common literal** raw local base-mutation forms (`git merge <feature>` on base, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>`) on no-remote repos, and the real boundary remains "`--local` is the only sanctioned local-merge path + it self-guards on remote-presence". Exotic obfuscations are out of scope. **Extension point:** widen `matchesRawLocalBaseMerge`'s pattern set.
- **Tracker-present-but-remote-absent combos** — what's excluded: special handling for a repo that has a tracker MCP but no git remote. **Why excluded:** detection keys purely on remote-presence and is tracker-orthogonal, so this case works by construction (local merge lands, findings still post to the tracker issue) with no extra code. **Extension point:** none needed; noted so it is not re-litigated.
- **Deploy after local merge** — the default `ship` producer merges and stops in both PR and local modes; "shipped" means "merged to the base branch". **Extension point:** a deploy-capable `ship` producer.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| PR path | Today's ship path: push → `gh pr create` (CI fires) → `faff merge-gate --pr <n>` → `gh pr merge` |
| Local path (git-only merge) | The new path: no push, no PR, `faff merge-gate --local` → local `git merge` of the feature branch onto the base branch |
| CI-equivalent | A fresh `faff gates run` on the final branch tip, standing in for the absent remote CI in the floor's CI-green leg |
| Base branch (local) | The branch the feature merges into — resolved locally (feature's fork point, else `main`/`master` by existence), since `origin/HEAD` is unavailable |
| Pushable remote | A configured git remote (`git remote` non-empty) that a PR could be opened against |
| Base-branch mutation | A raw command that lands/moves the base branch ref: `git merge <feature>` while on base, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>`. Denied by the new fence on no-remote repos. |
| Base-branch consumption | `git merge <base>` run *from a feature branch* to update it — a legitimate operation, never fenced. |

**Local floor inputs (populated by the `--local` branch, consumed by the unchanged `decideFloor`):**

```
RECORD LocalFloorInputs:
  ac_complete: bool          # readAcComplete(runDir, issue) — UNCHANGED source (Step-8 ac-checklist.json)
  review_verdict: string     # readReviewVerdict(runDir, issue) — UNCHANGED source (Step-9 review-verdict.json)
  ci_state: string           # DERIVED from the fresh `faff gates run` (mapping below), NOT from gh
  head_sha_matches: bool     # true — the local gates ran on the exact branch tip being merged
  level: "L1|L2|L3|L4"       # UNCHANGED (run-ledger governs)
  holdout: string            # UNCHANGED — L4 holdout is env-based, forge-independent
  no_ci_policy: string       # "needs-human" default (unchanged) — fail-closed when no gates discovered
  integrity: string          # resolveIntegrity(...) — UNCHANGED
```

**CI-equivalent mapping — `GatesOutcome.signal` → `floor.ci_state`** (this is the whole substitution; `decideFloor`'s CI leg blocks on `ci-red` / `indeterminate` / uncovered, and requires `head_sha_matches`):

| `faff gates run` signal | `ci_state` fed to `decideFloor` | `head_sha_matches` | Floor effect |
|---|---|---|---|
| `pass` (all required rungs green) | `ci-green` | `true` | CI leg satisfied |
| `fail` (a required rung failed) | `ci-red` | `true` | **refuse** (fail-closed) |
| `needs-human` (a rung errored/crashed) | `indeterminate` | `true` | **refuse** (fail-closed) |
| `discovery: none` (no declared gates) | `no-ci-coverage` | `true` | **refuse** under default `no_ci_policy: needs-human` (fail-closed) |

**The `merge-fence` extension — `matchesRawLocalBaseMerge` (new, no-remote-gated):**

```
RECORD LocalBaseMergeFence:      # evaluated by the PreToolUse merge-fence hook, ONLY when `git remote` is empty
  active: bool                   # true iff `git remote` returns empty (no pushable remote); else the matcher is a no-op
  denied_patterns:               # raw base-branch MUTATION (deny → remedy: faff merge-gate --local)
    - `git merge <feature>`  while HEAD is the base branch (base-branch mutation)
    - `git update-ref refs/heads/<base> …`
    - `git push . HEAD:<base>`  (and `git push <local-path> HEAD:<base>`)
  allowed (never denied):
    - `git merge <base>`  run from a feature branch (base-branch CONSUMPTION — a legitimate update)
    - the sanctioned `faff merge-gate --local … --execute` internal merge
```

**Local merge record** — `merge-gate --local` writes `<run-dir>/<issue>/merge-record.json` via the existing `writeMergeRecord`, shaped identically to the PR path so `post-merge-check` and `reconcile` read it unchanged:

```
RECORD MergeRecord (local mode):
  pr: 0                      # no PR in git-only mode; writeMergeRecord does pr: Number(pr), so a null/sentinel input is STORED as 0 (harmless: reconcile/post-merge read head_sha, never pr)
  head_sha: string           # the sha that landed on the base branch (== feature tip on a ff)
  merged: true
  integrity: string          # integrity.display, as today
```

**CLI surface — `faff merge-gate --local`:**

```
faff merge-gate --local --issue <ID> --run-dir <DIR> [--branch <B>] [--base <BASE>] [--level <L>] --execute
```

- `--local` selects the git-only branch. `--pr` is **not required** (and is ignored) in this mode; `--issue` + `--run-dir` stay required.
- `--branch` defaults to the current worktree branch; `--base` defaults to the locally-resolved base branch.
- **Bypass-guard:** in `--local` mode, if a pushable remote is detected (`git remote` non-empty), **refuse fail-loud (exit 2)** — "repo has a remote; use the PR path". This makes `--local` un-abusable as a CI skip.
- The human-only flag fencing (`--human-override`, `--allow-no-ci`) and `--merge-args` allowlist carry over unchanged.

**Design decisions** (all collected in §5):

- **Chosen:** `--local` is a **git-only branch of `faff merge-gate`**, not a sibling verb — reuses `decideFloor` and keeps one merge locus.
- **Chosen:** detection predicate is **remote-absence** (`git remote` empty ⇒ local; non-empty ⇒ PR path), tracker-orthogonal and bypass-proof.
- **Chosen:** the CI-equivalent is a **fresh** `faff gates run` at merge time, mapped onto `floor.ci_state`; `decideFloor` unchanged.
- **Chosen:** **ff-only** local merge (rebase-first if not ff-able); non-ff is out of scope.
- **Chosen:** `reconcile.js` and `post-merge.js` need **no logic change** — the orchestrator degrades its evidence-gathering to git ground-truth.
- **Chosen (was Punt — resolved 2026-07-16):** extend `merge-fence` in **this** ticket with `matchesRawLocalBaseMerge`, denying raw base-branch **mutation** (`git merge <feature>` on base, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>`) **only when the repo has no remote**, while never fencing base-branch **consumption** (`git merge <base>` from a feature branch). Scoped to no-remote so it is dormant on every remote-backed repo (zero L1–L3 impact).

---

## 4. HOW — Behavior

**Architecture and approach.** Detection happens once, at the graft ship boundary, and flows down: with no pushable remote, Step 8b (push) and Step 9b (PR create) become no-ops, and Step 10 hands off to the `ship` producer in local mode, which invokes `faff merge-gate --local`. Inside `cmdMergeGate`, an early `--local` branch skips every `gh` call, resolves the base branch locally, runs the fresh CI-equivalent, populates the `floor` object (CI-green leg from the gates mapping), calls the **unchanged** `decideFloor`, and on `merge-ok` performs a local `git merge` and writes the merge record. In parallel, the PreToolUse `merge-fence` hook — active only on a no-remote repo — denies any raw base-branch mutation so that gate is the sole path onto the base branch.

**`merge-gate --local` — the merge shell (pseudocode):**

```
PROCEDURE cmdMergeGate_local(issue, runDir, branch, base, level):
  1. Bypass-guard: IF `git remote` is non-empty:
       REFUSE exit 2 "repo has a remote; use the PR path"   # detected-not-forced, bypass-proof
  2. branch := branch OR current worktree branch
     base   := base OR resolveLocalBase()                    # feature fork-point, else main/master by existence
  3. Assert ff-able: IF NOT `git merge-base --is-ancestor <base> <branch>`:
       REFUSE failed:"base branch moved; rebase <branch> onto <base> first"   # ff-only
  4. head_sha := `git rev-parse <branch>`                    # the tip the gates run against and that lands
  5. gates := run `faff gates run --json` FRESH on <branch>  # the CI-equivalent (never reuse Step-7.5)
     ci_state := map gates.signal per the WHAT table         # pass→ci-green, fail→ci-red, needs-human→indeterminate, none→no-ci-coverage
  6. floor := { ac_complete: readAcComplete(runDir,issue),
                review_verdict: readReviewVerdict(runDir,issue),
                ci_state, head_sha_matches: true,
                level, holdout: (level=="L4" ? readHoldout(runDir,issue) : "not-applicable"),
                no_ci_policy: "needs-human",
                integrity: resolveIntegrity(runDir,issue,level).state }
  7. { verdict, blockers } := decideFloor(floor)             # UNCHANGED pure core
  8. IF verdict == "refuse": emit(result, exit 1)            # fail-closed, identical to PR path
  9. IF mode == "check-only": emit(merge-ok, exit 0)         # no merge
  10. Re-assert head_sha unchanged since step 4 (single-session guard), then:
        `git merge --ff-only <branch>` onto <base>           # or update-ref <base>→<head_sha> (ff)
        writeMergeRecord(runDir, issue, /*pr*/ null, head_sha, integrity.display)
        emit(merge-ok merged, exit 0)
```

**`merge-fence --local-base` extension (pseudocode) — the mechanical single-locus wall:**

```
PROCEDURE matchesRawLocalBaseMerge(command, cwd):
  IF `git remote` (in cwd) is NON-EMPTY: return false        # dormant on any remote-backed repo (zero L1–L3 impact)
  base := resolveLocalBase(cwd)
  # deny raw base-branch MUTATION:
  IF command is `git merge <X>` AND current branch == base: return true   # landing a feature onto base
  IF command matches `git update-ref refs/heads/<base> …`:  return true
  IF command matches `git push . HEAD:<base>` (or `git push <localpath> HEAD:<base>`): return true
  # never deny base-branch CONSUMPTION:
  IF command is `git merge <base>` AND current branch != base: return false   # a feature updating from base
  return false
# On a match the hook DENIES with remedy: "land code on the base branch via `faff merge-gate --local`, not a raw git merge"
```

**Behaviour summary.** Steps 1–2 detect/guard and resolve refs; steps 3–5 build the CI-equivalent; steps 6–7 reuse the exact floor decision; steps 8–10 either fail-closed refuse or land the merge locally and record it. The fence matcher, dormant unless the repo has no remote, denies the raw base-mutation spellings so the gate is the only landing path.

**graft ship-step changes (prose):**

- **Step 8b (push):** in local mode, **skip the push** (no remote). The build-progress checkpoint still writes, with `diff_hash` computed from the **local** three-dot diff (`<base>...<branch>`) instead of `origin/main...origin/<branch>`; the branch ref survives worktree teardown via the shared object store, so resume re-adds a worktree from the local branch.
- **Step 9b (PR create):** in local mode, **no-op** — no PR is opened. Review (Step 9) already ran pre-PR against the local diff (`<base>...HEAD`) and reached `pass`; the flow proceeds straight to Step 10.
- **Step 10 (merge-confidence gate):** detect local path (remote-absence); the CI-green condition (condition 2) is satisfied by the fresh local `faff gates run` the gate runs, not by forge CI. Hand off to the `ship` producer with the local-path signal.

**`ship` producer (`faffter-noon-ship`) changes (prose):** in local mode, the step-1 delivery-precondition probes (`git push --dry-run`, `gh auth status`, merge-method, actions-policy) are **no-ops** (there is no remote to be not-ready against — the default never emits `not-ready:precondition:*` in local mode), and step-3 invokes `faff merge-gate --local --issue … --run-dir … --level … --execute` instead of `--pr`. `merge-ok` → `outcome: shipped, corroborated: true`; `refuse`/fail-loud → `failed:<blocker>`, exactly as the PR path.

**`reconcile` / `post-merge-check` graceful degrade (no logic change):**

- **`post-merge-check`** is already git-sha-driven: it reads `merge-record.json` `head_sha`, does a **best-effort `git fetch origin <sha>` (failure ignored)**, then `git worktree add --detach <sha>` and runs the UNIT rung. In git-only the sha is locally reachable (the merge just happened locally), so the ignored fetch failure is harmless and verification works with **zero forge calls**. Its `--pr` flag is stored but never used for a forge call — pass a sentinel (see edge cases).
- **`reconcile`** is a pure verb; the **orchestrator** (beep-boop Step 11) gathers `observed`. In git-only mode it gathers from git instead of the forge: `observed.pr_merged := git merge-base --is-ancestor <recorded.head_sha> <base>` succeeds, and `observed.merged_head_sha := recorded.head_sha`. `reconcileShipped` then classifies **consistent** exactly as for a PR merge — no `reconcile.js` change. A missing/unprovable local merge stays fail-closed to `claimed-shipped-unmerged`.

**Edge cases and error handling:**

- **Base branch not fast-forwardable** — refuse `failed:"rebase first"` (ff-only); graft rebases and retries, or parks on conflict (same as any merge conflict → `failed:<reason>`).
- **No declared gates in the SUT (`discovery: none`)** — maps to `no-ci-coverage` → **refuse fail-closed** under the default `no_ci_policy: needs-human`. A git-only build with no CI-equivalent cannot land.
- **`faff gates run` errors/crashes** — `needs-human` → `indeterminate` → refuse (never merge on an unconcludable gate).
- **Head sha moved between the gates run and the merge** — re-assert at step 10 and refuse if changed (the local analogue of the PR path's `--match-head-commit` head-pin).
- **`--local` on a repo that has a remote** — refuse exit 2 (bypass-guard); the caller should be on the PR path. The fence matcher is likewise dormant here (remote present).
- **`git merge <base>` from a feature branch on a no-remote repo** — **allowed** (base-branch consumption, a legitimate update); the fence matcher explicitly returns false for it.
- **`post-merge-check --pr` in git-only** — `--pr` is required by its arg parser but unused for any forge call; pass a sentinel (`--pr 0`) or relax the flag to optional so `record.pr` is `null`. **Anti-pattern:** deriving a fake PR number. Why: it would pollute the artifact and imply a forge object that doesn't exist.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** the "CI-equivalent = local gates" substitution silently under-covers because the SUT declares no gates, so `discovery: none` is treated as green and un-CI'd code lands. **How you'd know:** a git-only drain merges a build whose gates never ran. **What it means:** *narrow* — the `no-ci-coverage` → fail-closed mapping is the guard; the born-verifiable scenario below pins it. If it ever mapped to `pass`, that is the regression to catch.
- **The failure:** `--local` is abused (or mis-selected) on a repo that *has* a remote, skipping real CI. **How you'd know:** a merge lands via `--local` on a repo with `origin`. **What it means:** *abandon that path* — the step-1 bypass-guard makes it exit 2; the scenario below asserts it.
- **The failure:** the fence over-fires and denies a legitimate `git merge <base>` from a feature branch (base-branch consumption), stalling routine feature updates on a no-remote SUT. **How you'd know:** a feature-branch `git merge <base>` is denied on a no-remote repo. **What it means:** *narrow* — the matcher must return false for consumption; the born-verifiable scenario pins allowed-consumption vs denied-mutation.
- **The failure:** the local merge lands but `reconcile` reports `claimed-shipped-unmerged` because the orchestrator still gathered forge evidence. **How you'd know:** a clean git-only drain ends with an L4 `needs-human` reconcile divergence. **What it means:** *narrow* — the beep-boop Step 11 evidence-gathering must branch to git ground-truth in git-only mode.

**Anti-pattern:** adding a second, un-gated local-merge verb (e.g. `faff merge-local`). Why: it splits the merge locus and invites a floor-bypass; the `--local` branch of the one gate is deliberate.

**Anti-pattern:** fencing base-branch *consumption* (`git merge <base>` from a feature). Why: it is a legitimate update and denying it breaks routine work; the fence targets only base-branch *mutation*.

---

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Born-verifiable main objectives (Given/When/Then). These sharpen the WHAT; they are not a restatement of DONE.

```
Given a local-git repo with no remote, a clean build (Step-8 ac-checklist all_verified, Step-9 review-verdict pass, and a passing `faff gates run`)
When the ship step runs `faff merge-gate --local --issue <ID> --run-dir <DIR> --execute`
Then the feature branch is merged onto the base branch locally, no PR is opened and no push occurs, merge-gate exits 0 (merge-ok), and merge-record.json carries the landed head_sha
```

```
Given a local-git repo with no remote and a build whose `faff gates run` returns signal=fail
When `faff merge-gate --local` runs
Then decideFloor receives ci_state=ci-red, the gate refuses (exit 1) with a CI blocker, and nothing is merged onto the base branch
```

```
Given a local-git repo with no remote and a build whose Step-9 review-verdict.json is not "pass" (or Step-8 ac-checklist all_verified=false)
When `faff merge-gate --local` runs
Then the gate refuses (exit 1) on the review (resp. AC) leg — the identical fail-closed floor as the PR path — and nothing merges
```

```
Given a repo WITH a configured git remote (git remote non-empty)
When the graft ship step runs
Then the PR path is selected unchanged (push → gh pr create → faff merge-gate --pr), the local path is never taken, passing `--local` exits 2 (bypass-guard), and the merge-fence local-base matcher is dormant (remote present)
```

```
Given a completed git-only local merge (merge-record.json with the local head_sha) and a beep-boop L4 run-end reconcile
When beep-boop Step 11 gathers `observed` from git (is-ancestor of base ⇒ pr_merged=true, merged_head_sha=recorded.head_sha) and pipes the ReconcileInput
Then reconcile classifies the shipped outcome consistent (no divergence), with no forge call — and post-merge-check verifies the UNIT rung at the local head_sha with no PR
```

```
Given a beep-boop/lights-out drain over several ready tickets in a git-only SUT, each with a clean build
When the drain runs unattended
Then every clean ticket merges locally and the drain completes over multiple tickets (no stall at push/PR), while any ticket with a failing gate/AC/non-pass review is refused fail-closed and parked
```

---

## 5. DESIGN DECISION RATIONALE

**Sibling `faff merge-local` verb vs. a `--local` branch of `faff merge-gate`?**
- *Sibling verb* — pro: keeps `cmdMergeGate` PR-only and clean; con: **two merge loci**, the merge-fence and every "sole sanctioned path" invariant now guard two commands, and the floor decision risks divergence.
- *`--local` branch* — pro: one command, one merge locus, `decideFloor` reused verbatim (the floor cannot drift or weaken), arg-validation/level-resolution/integrity/human-flag-fencing all reused; con: a few more conditionals in `cmdMergeGate`.
- **Chosen:** the **`--local` branch of `faff merge-gate`** — rationale: FAFF-350/ADR-0043 make "one sanctioned merge locus + one floor core" the keystone; a branch preserves both, a sibling verb breaks both. The extra conditionals are cheap next to a second locus to keep honest.

**How is git-only detected — and can it be forced?**
- Options: (a) tracker-absence (existing git-only signal); (b) `gh` absence; (c) remote absence.
- **Chosen:** **remote absence** (`git remote` empty). Rationale: it is the property that actually determines "can a PR be opened", it is bypass-proof (an offline remote still routes to the PR path and fails loud rather than silently dropping CI), and it is tracker-orthogonal so a tracker-tracked-but-remote-less repo works with no special case. `gh`-absence-with-a-remote is a misconfig, not a local-merge trigger. Never forced: `--local` self-refuses when a remote exists. **The same remote-absence predicate gates the `merge-fence` extension** — one activation rule for both.

**Reuse `decideFloor`, or add a local floor decision?**
- **Chosen:** reuse `decideFloor` unchanged; map the local `faff gates run` outcome onto the existing `ci_state` slot. Rationale: the floor's guarantee ("AC + review + CI, fail-closed") must be byte-identical across paths; a second decision core is exactly the drift risk this avoids. The CI-equivalent literally *is* the CI signal, fed into the same slot.

**Reuse Step-7.5 gates, or re-run fresh at merge?**
- **Chosen:** **fresh** `faff gates run` at merge time. Rationale: parity with the keystone property that the gate observes CI *itself* on the final head sha rather than trusting a handed-in verdict; the PR path's CI is likewise a fresh remote re-run, not graft's earlier local result.

**ff-only vs. non-ff local merge?**
- **Chosen:** **ff-only** (rebase-first if the base moved). Rationale: git-only SUTs are single-session/sequential so the base rarely moves; ff lets the merge be a safe `git merge --ff-only`/`update-ref` with no worktree-checkout contention on the base branch, and a non-ff need degrades cleanly to "rebase first". Non-ff is a bounded extension point, not a day-one need.

**Change `reconcile`/`post-merge-check`, or degrade the caller's evidence?**
- **Chosen:** **no CLI logic change**; the orchestrator (beep-boop Step 11) gathers `observed` from git ground-truth in git-only mode, and `post-merge-check` is already git-sha-driven. Rationale: `reconcile` is deliberately a pure verb whose `observed` is caller-assembled from "git/forge state"; supplying git-confirmed merge evidence is a faithful use of that seam, and it keeps the divergence-classification logic single-sourced.

**Extend `merge-fence` here (bundled) vs. fast-follow — and how broadly? (was Punt — resolved 2026-07-16)**
- Options: (a) track the fence hardening as a fast-follow; (b) bundle it into this ticket, scoped to no-remote, denying only the common literal base-mutation spellings.
- (a) leaves the single-locus guarantee resting on prose discipline alone for the exact window this ticket ships the local-merge capability — the forge branch-protection wall is gone with no local wall to replace it.
- **Chosen:** (b) bundle it. On a bare local repo there is no forge/PR/CI trail, so the fence is what makes `--local` *mechanical* rather than compliance-dependent. Scope it precisely: deny raw base-branch **mutation** (`git merge <feature>` on base, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>`), **never** base-branch **consumption** (`git merge <base>` from a feature), and **only when `git remote` is empty** (mirroring the `--local` activation guard). Because it is dormant on every remote-backed repo, there is **zero impact on L1–L3 remote workflows**. A full shell-aware matcher for exotic obfuscations stays out of scope (the fence is the outermost guardrail, not the boundary).

---

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the `merge-fence` hardening Punt is resolved (2026-07-16): the extension is in scope, scoped to no-remote base-branch mutation, allowing base-branch consumption (see §5 and the WHAT/HOW/DONE fence sections).

**Assumptions:**

- **Assumes:** the git-only SUTs declare engineering gates that `faff gates run` discovers (pre-commit / `package.json` scripts / `Makefile`). *Validate:* run `faff gates run --json` in a scaffolded SUT (`docs/external-verification/scaffold-p1-*.sh`) and confirm `discovery` ≠ `none`; if a SUT legitimately has none, the `no-ci-coverage` → fail-closed refusal is the correct (not accidental) behaviour.
- **Assumes:** a feature branch ref survives worktree teardown via the shared object store, so Step-8b resume can re-add a worktree from the local branch without a push. *Validate:* create a worktree + branch, remove the worktree, confirm `git rev-parse <branch>` still resolves in the main checkout.
- **Assumes:** `writeMergeRecord` tolerates a `null`/absent `pr` without throwing and still writes a readable `head_sha`. *Validate:* confirmed at `merge-gate.js:246` — it does `pr: Number(pr)`, so a `null`/sentinel input is **stored as `0`** (`Number(null) === 0`), never throws; `reconcile`/`post-merge` read only `head_sha`, so the stored `pr: 0` is harmless. The assumption holds, no change needed unless a future reader depends on `merge-record.pr` (in which case relax `--pr` to optional and store an explicit `null`).
- **Assumes:** `merge-fence.js` exposes a `resolveLocalBase(cwd)` (or the `--local` branch's base-resolver is shareable) so the fence matcher can name `<base>` the same way the merge does. *Validate:* the fence's base resolution and `merge-gate --local`'s `resolveLocalBase()` agree on the same base branch for a given repo (share one helper).

---

## 7. DONE — Definition of Done

### From WHY
- [ ] A local-git repo with no remote can complete graft's ship step: a clean build merges to the base branch locally with no PR and no push.
- [ ] The git-only path merges only on the identical three-condition floor (AC-verified + review-`pass` + local-gates-green); no leg is weakened.
- [ ] On a no-remote repo, the only path that lands code on the base branch is `faff merge-gate --local` — raw base-branch mutation is mechanically denied by `merge-fence`.

### From WHAT (types and interfaces)
- [ ] `faff merge-gate --local --issue <ID> --run-dir <DIR> [--branch] [--base] [--level] --execute` exists; `--pr` is not required in this mode.
- [ ] `faff gates run` `signal` maps onto `floor.ci_state` per the WHAT table: `pass`→`ci-green`, `fail`→`ci-red`, `needs-human`→`indeterminate`, `discovery:none`→`no-ci-coverage`.
- [ ] Local-mode `merge-record.json` carries `head_sha` (the landed sha) and `pr: 0` (a null/sentinel input coerced by `writeMergeRecord`'s `Number(pr)`), read unchanged by `post-merge-check`/`reconcile` (which key off `head_sha`, never `pr`).

### From WHAT (merge-fence extension — resolved 2026-07-16)
- [ ] `merge-fence` gains `matchesRawLocalBaseMerge`, active **only** when `git remote` is empty (dormant on any remote-backed repo).
- [ ] On a no-remote repo it DENIES `git merge <feature>` while on the base branch, `git update-ref refs/heads/<base>`, and `git push . HEAD:<base>`, with a remedy pointing at `faff merge-gate --local`.
- [ ] It NEVER denies `git merge <base>` run from a feature branch (base-branch consumption), nor the sanctioned `faff merge-gate --local … --execute` internal merge.
- [ ] On a repo WITH a remote, the matcher is a no-op (regression: existing `matchesRawGhMerge` behaviour byte-identical).

### From HOW (behaviour)
- [ ] `cmdMergeGate`'s `--local` branch skips all `gh` calls, resolves the base branch locally, runs a **fresh** `faff gates run`, populates the `floor` object, and calls the **unchanged** `decideFloor`.
- [ ] On `merge-ok`, it performs a fast-forward local merge of the branch onto the base and writes the merge record; on `refuse` it exits 1 and merges nothing.
- [ ] graft Step 8b skips the push in local mode and computes `diff_hash` from the local `<base>...<branch>` diff.
- [ ] graft Step 9b opens no PR in local mode; the flow proceeds from a Step-9 `pass` straight to Step 10.
- [ ] graft Step 10 detects the local path (remote-absence) and hands off to the `ship` producer in local mode.
- [ ] The default `ship` producer no-ops its remote precondition probes in local mode and invokes `faff merge-gate --local`.
- [ ] beep-boop Step 11 gathers `reconcile` `observed` from git ground-truth in git-only mode (`is-ancestor of base` ⇒ `pr_merged=true`, `merged_head_sha=recorded.head_sha`).

### From HOW (edge cases)
- [ ] `--local` on a repo with a configured remote refuses fail-loud (exit 2) — the bypass-guard.
- [ ] `discovery: none` in local mode refuses fail-closed (`no-ci-coverage` under `no_ci_policy: needs-human`).
- [ ] `faff gates run` = `fail`/`needs-human` in local mode refuses (`ci-red`/`indeterminate`).
- [ ] A non-fast-forwardable base refuses `failed:"rebase first"` (ff-only).
- [ ] The head sha is re-asserted between the gates run and the merge; a moved head refuses.
- [ ] `post-merge-check` verifies the UNIT rung at the local `head_sha` with no forge call; `--pr` is passed as a sentinel (`--pr 0`) and `record.pr` is `0`/unused.

### From detection / non-forcing
- [ ] A repo WITH a remote uses the PR/CI/merge-gate path unchanged (regression: PR-path behaviour byte-identical) and the fence matcher stays dormant.
- [ ] A full beep-boop/lights-out drain over a git-only SUT completes across multiple clean tickets; a failing gate/AC/non-pass review ticket is refused fail-closed and parked.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the CI-equivalent is deterministic `faff gates run`; `decideFloor` is pure; the fence matcher is deterministic string/ref matching) — no grader registration required.

**Integration smoke test:**

```
PROCEDURE smoke_git_only_merge():
  1. Scaffold a no-remote SUT (docs/external-verification/scaffold-p1-*.sh); make a clean feature branch.
  2. Write ac-checklist.json {all_verified:true} and review-verdict.json {signal:"pass"} under <run-dir>/<ISSUE>/.
  3. Run: faff merge-gate --local --issue <ISSUE> --run-dir <run-dir> --execute
  4. Assert exit 0, `git log <base>` now contains the feature commit, no PR/remote exists, merge-record.json head_sha == the landed sha.
  5. From a feature branch, attempt `git update-ref refs/heads/<base> <sha>` → assert the merge-fence hook DENIES it; attempt `git merge <base>` → assert it is ALLOWED.
  6. Run faff post-merge-check --issue <ISSUE> --pr 0 --run-dir <run-dir>; assert it resolves the sha and runs the UNIT rung with no forge call.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## ADR promotion intent

Autonomous prep (appetite: high) records one architecturally-significant, cross-slice decision for `/faff-graft` to materialise via `faff adr new` on the feature branch:

- **Git-only local merge as a sanctioned BRANCH of the single merge locus, mechanically fenced on no-remote repos (not a bypass)** (WHY principles + DECISION RATIONALE: `faff merge-gate --local` reuses `decideFloor` verbatim, substitutes the CI-green leg with a fresh local `faff gates run`, is remote-absence-detected never forced, keeps merge-gate the one place code lands on the base branch, and `merge-fence`'s new `matchesRawLocalBaseMerge` — active only when `git remote` is empty — mechanically denies raw base-branch mutation while allowing base-branch consumption). Durable and cross-slice: it extends the FAFF-350 / ADR-0043 merge-gate keystone with a second condition-branch AND a local mechanical single-locus wall, and defines the git-only ship posture the external-verification SUTs (FAFF-310) depend on. Consequences = the forge branch-protection backstop is replaced (on no-remote repos) by the scoped fence, dormant on every remote-backed repo (zero L1–L3 impact).
