# FAFF-708 — base graft worktrees and diffs on the fetched remote default branch

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: high. Full spec on Linear FAFF-708.

> Refreshed 2026-08-05 (autonomous). The 2026-08-03 draft attached earlier reached the spec-review loop cap (`reject-approach`) with three unresolved lens objections. This refresh folds each in as an explicit, closed decision, without changing the overall approach (fetched-remote-default-ref base + coupled diff identity):
> - **Architecture** — a bounded, non-interactive timeout/failure posture for `ls-remote` and `fetch` (§3 *Network posture*, §4).
> - **Infosec** — an explicit decision to not add an origin-identity check, and an integrity boundary for the Markdown-extracted shell the tests execute (§3 *Trust and integrity boundary*, §6).
> - **QA** — every remote-base instruction is a named executable oracle (resume-at-review and Step 8b included), plus explicit coverage for a reachable remote with no symbolic HEAD and the non-`main` path through both direct and hook modes (§5, §8).
> Spec-review re-ran on this refresh (lenses: architectural, infosec, QA; single-pass) and returned `approve`.

This specification addresses FAFF-708 for the build agent and human reviewers. It defines how graft chooses a fresh branch base and how its pre-PR review checkpoints identify the resulting diff.

## 1. WHY — Problem and principles

Graft must treat the fetched remote default branch as current repository truth whenever an `origin` remote exists; the invoking checkout's `HEAD` is only local state and may predate a sibling that has already merged.

`faff merge-gate --execute` merges through GitHub without updating the operator's local default-branch checkout. `setup-worktree.sh` currently branches from that checkout's `HEAD`, which can omit a newly merged dependency, while graft's remaining `git diff main...HEAD` calls can review or checkpoint an inflated, stale-base diff. This change resolves the remote default branch, fetches it before provisioning, creates the worktree from its remote-tracking ref, and uses that same class of ref for graft's remote-backed diff calculations.

**Remote truth is required when a remote exists.** A failed fetch or unresolved remote base must stop worktree creation; silently falling back to stale `HEAD` would preserve the bug.

**Git-only repositories keep working.** When the repository has no `origin` remote, provisioning continues to branch from local `HEAD`, matching graft's existing git-only path.

**One base per operation.** Worktree creation and each diff/hash calculation resolve one base and use that exact ref throughout the operation, so a prose default of `main` cannot drift from the fetched branch.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/setup-worktree.sh` | Bash | Shared direct/hook worktree provisioner; currently runs `git worktree add ... HEAD` (line 56) |
| `plugin/skills/faff-graft/SKILL.md` | Markdown workflow prompt | Defines pre-PR review input, review-progress diff identity, resume-at-review, and Step 8b build-progress; all still name local `main` or hardcode `origin/main` |
| `plugin/skills/faff/bin/lib/prdr.js` | JavaScript | Existing default-branch resolution precedent; this change narrows provisioning to Git's own remote metadata |
| `test/setup-worktree-direct.test.mjs` | JavaScript | End-to-end direct and hook provisioning coverage; currently asserts a branch based on `HEAD` |
| `test/setup-worktree-clobber.test.mjs`, `test/setup-worktree-config.test.mjs` | JavaScript | Protect tracked config at the chosen worktree ref and untracked overlay copying |

This is a graft/worktree correctness change within the git-host boundary; it does not alter merge policy.

## 2. OUT OF SCOPE

- **Fast-forwarding the operator's local default-branch checkout after merge** — correctness no longer needs that checkout to move, and changing a user's checked-out branch has separate cleanliness and concurrency concerns. A follow-up may extend `plugin/skills/faff/bin/lib/merge-gate.js` after defining those conditions.
- **Changing `faff merge-gate`'s local, no-remote base rules** — the reported fault is the remote-backed path. A future issue may consolidate local `main`/`master` resolution in `plugin/skills/faff/bin/lib/merge-gate.js`.
- **Rewriting every historical `main` reference in faff** — only graft's worktree base, review input, review-progress hash, resume-at-review, Step 8b build-progress, and directly coupled remote-backed diff prose are in scope. Other commands retain their own contracts.
- **Supporting a remote with a name other than `origin`** — graft's remote-backed workflow already names `origin` throughout push, fetch, resume, and merge steps. A future git-host abstraction may make the remote configurable.

## 3. WHAT — Vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| remote-backed repository | A repository for which `git remote get-url origin` succeeds |
| git-only repository | A repository with no resolvable `origin` remote |
| remote default branch | The host's default branch name, such as `main` or `master` |
| remote base ref | `refs/remotes/origin/<remote default branch>` after a successful fetch |

### Worktree base result

The shell provisioner needs one internal result; it need not expose a new public CLI.

```text
RECORD WorktreeBase:
  mode: ENUM(remote, local)
  branch_name: Text | absent     # present for remote mode
  ref: GitRef                    # remote-tracking ref or HEAD

  CONSTRAINT mode == remote IMPLIES ref == refs/remotes/origin/<branch_name>
  CONSTRAINT mode == local IMPLIES ref == HEAD
```

### Default-branch resolution

For a remote-backed repository, resolve the branch name from Git's metadata for that exact `origin` remote:

1. Query the remote without mutation using `git ls-remote --symref origin HEAD`.
2. Parse the advertised `ref: refs/heads/<branch> HEAD` record and accept only a valid `refs/heads/…` target.
3. If the remote does not advertise a symbolic HEAD, fail with a default-branch-resolution error; do not guess a branch name.

The provisioner then fetches the named branch explicitly and verifies `refs/remotes/origin/<name>` before creating anything. If no candidate produces a verified remote-tracking ref, provisioning exits non-zero with an error naming `origin` and the default-branch resolution/fetch failure.

**Chosen:** read the remote's advertised HEAD with `git ls-remote --symref` and fail when it is absent or malformed. Do not mutate local Git config, make a separate forge API call, or guess `main`: the remote being fetched is the authority for its own default branch.

### Network posture (bounded, non-interactive) — resolves the architecture objection

The two network commands the remote-backed path adds (`git ls-remote --symref origin HEAD` and the subsequent branch `fetch`) must never block a provisioning run indefinitely or on a hidden credential prompt.

**Chosen:** run both network commands non-interactively and under a bounded wall-clock timeout, and treat exhaustion or non-zero exit as a terminal fetch failure (never a fall-back to `HEAD`):

- Export `GIT_TERMINAL_PROMPT=0` (and rely on the ambient non-interactive credential posture — no `askpass` prompt) for both commands, so a missing/expired credential fails fast instead of hanging on a TTY prompt.
- Wrap each command in `timeout <secs> …`. The bound is `FAFF_GIT_NET_TIMEOUT` when set to a positive integer, else a built-in default of `30` seconds. Resolve the bound once at the top of provisioning and reuse it for both commands.
- A `timeout` exit (124), a credential/authentication failure, or any other non-zero exit from either command is a **terminal provisioning error** — provisioning exits non-zero before `git worktree add`, with stderr naming `origin` and whether resolution or fetch failed. It never degrades to the local-`HEAD` base (that is the git-only-only path, gated solely on `origin` being *absent*).

**Anti-pattern:** wrapping the network commands but still letting a TTY credential prompt hang. Why: the bound must cover the prompt case, so `GIT_TERMINAL_PROMPT=0` and the `timeout` wrapper are paired, not alternatives.

### Trust and integrity boundary — resolves the infosec objection

Two infosec questions, both decided here.

**(a) Does graft validate `origin` against a configured repository identity before its new network read/fetch?**

**Chosen:** no new origin-identity check is added. The configured `origin` remote is already faff's trust boundary for fetch, push, PR creation, and merge; `ls-remote --symref` and `fetch` read from the *same* remote graft already trusts to supply branch contents, so they grant no new authority. A compromised or redirected `origin` is repository compromise outside this ticket's threat boundary and cannot be made safe by cross-checking a forge API that may describe a different repository. The new commands are read-only against an already-trusted remote; adding an identity gate here would be scope creep with no threat it closes.

**(b) The tests locate and execute a shell block extracted from `SKILL.md`. What is the integrity boundary on that Markdown-extracted shell?**

**Chosen:** the extract-and-execute step is a **test-harness-only** operation over **committed, PR-reviewed** content, never a runtime graft behaviour. The integrity boundary is:

- **Source is trusted-by-review.** The extracted fenced block lives in the committed `plugin/skills/faff-graft/SKILL.md`, which reaches the repo only through code review — trusted-command-source class (c) in the gateway's Untrusted-input allowlist (commands defined in committed, PR-reviewed repo config). The test executes repo-authored content, not tracker/comment free-text.
- **Located by a stable structural anchor, not a fuzzy grep.** The test extracts exactly the single fenced block immediately under the stable heading `Remote-backed review diff` (and the correspondingly-headed resume/Step 8b blocks), so a body edit elsewhere in `SKILL.md` cannot smuggle a different command into the executed block.
- **Executed only inside the disposable test fixture.** Execution happens in the test's throwaway git fixture (bare origin + fresh checkout, package install skipped), never against a real repo, secret, or network beyond the local fixture remote.
- **The runtime graft path never extracts-and-executes Markdown.** At graft runtime the agent runs the documented commands directly; only the test harness reads them back out of `SKILL.md` to prove the prose and the behaviour agree. So there is no runtime injection surface introduced by this change.

**Anti-pattern:** a test that greps `SKILL.md` for any `git diff`-shaped line and runs it. Why: without the single-block-under-a-stable-heading anchor, an unrelated documentation edit becomes executable input.

### Git-only compatibility

The absence of `origin` is a deliberate local mode, not a fetch failure. In that mode the provisioner selects `HEAD` and performs no network command.

**Chosen:** preserve `HEAD` only for repositories where `origin` is absent; never use it as recovery for a broken remote-backed repository.

### Graft diff base

Remote-backed graft instructions must pass the resolved remote base ref to:

- the review slot's diff input;
- `cur_hash` for review-progress reconciliation;
- the review phase's descriptions of diff identity;
- the resume-at-review check (currently `git diff origin/main...origin/<branch>`);
- the Step 8b build-progress diff (currently `git diff origin/main...origin/<branch>`);
- build-complete/resume examples that currently hardcode `origin/main` where they mean the remote default branch.

Git-only instructions keep using the locally resolved base already owned by the local merge path.

**Chosen:** thread a descriptive `<remote-base>` / `<base>` value through graft's workflow prose instead of replacing `main` with another hardcoded branch name.

## 4. HOW — Behaviour

### Provision a worktree

Both direct and hook input modes continue into the same provisioning body. The new base selection happens after changing to `CWD` and before `git worktree add`; config copying and package setup remain unchanged.

```text
PROCEDURE resolve_worktree_base(repo):
  0. Resolve net_timeout = FAFF_GIT_NET_TIMEOUT (positive int) else 30; export GIT_TERMINAL_PROMPT=0
  1. IF `git remote get-url origin` fails:
     a. Return WorktreeBase(mode=local, ref=HEAD)   # git-only path: no network command
  2. Resolve candidate default-branch name:
     a. Run `timeout <net_timeout> git ls-remote --symref origin HEAD`
     b. Parse its `refs/heads/<branch>` symbolic target
     c. IF the command times out, fails, or advertises no valid symbolic target, return a terminal resolution error
  3. Fetch only the candidate from origin: `timeout <net_timeout> git fetch origin <candidate>`
  4. IF fetch times out or fails:
     a. Return a terminal provisioning error
  5. Set remote_ref = refs/remotes/origin/<candidate>
  6. IF remote_ref does not resolve to a commit:
     a. Return a terminal provisioning error
  7. Return WorktreeBase(mode=remote, branch_name=candidate, ref=remote_ref)
```

```text
PROCEDURE create_worktree(name, path, base):
  1. Run `git worktree add -b <name> <path> <base.ref>`
  2. IF the command fails:
     a. Preserve the existing non-zero exit and setup log behaviour
     b. Do not copy overlays or install packages
  3. Continue the existing shared setup body
```

**Anti-pattern:** fetch `origin` and still branch from `HEAD`. Why: refreshing remote refs does not move the invoking checkout.

**Anti-pattern:** fetch with `|| true` and fall back to `HEAD`. Why: a transient, timeout, or authentication failure would silently recreate the stale-base defect.

### Compute graft diffs and hashes

Immediately before a remote-backed graft operation needs a diff, query the remote's symbolic HEAD (bounded, non-interactive as above), fetch that branch, and bind `remote_base = origin/<branch>` in the same shell block that computes the diff. The Step 9 review input and its `cur_hash` use one captured diff file: the review consumes that file and the hash is calculated from those exact bytes. This is a fresh gate observation, not a value carried from Step 3 across the session.

Give that fenced shell block the stable preceding heading `Remote-backed review diff`. The resume-at-review block and the Step 8b build-progress block each likewise sit under their own stable headings (`Remote-backed resume diff`, `Remote-backed build-progress diff`) and resolve the advertised default branch rather than hardcoding `origin/main`.

```text
PROCEDURE compute_remote_graft_diff(branch, purpose):
  1. Resolve and fetch remote_base (bounded, non-interactive)
  2. IF remote_base cannot be resolved or fetched:
     a. Stop the current graft step with a terminal operational error
  3. Write `git diff <remote_base>...<branch-or-HEAD>` to one temporary diff file
  4. IF purpose == review_progress_hash:
     a. Hash that same temporary file; do not run a second `git diff`
  5. Return the diff or hash
```

The review slot receives the captured diff file. Review-progress compares its stored Phase-1 hash with the hash of that exact file. Build-progress keeps its existing remote-ref-only property but names the resolved default branch rather than `main`.

**Anti-pattern:** calculate the review input against the remote base but calculate `cur_hash` against local `main`. Why: the checkpoint could then approve a different diff from the one reviewed.

### Edge cases and errors

- An `origin` remote exists but is unreachable or times out: fail before creating the branch or worktree; stderr states that the remote default base could not be fetched.
- The remote advertises a default branch: fetch and use that branch's remote-tracking ref.
- The remote is reachable but does not advertise a symbolic HEAD: fail before worktree creation; no local or hardcoded branch is an honest substitute. (Covered by a named test — §8.)
- The default branch is `master` or another name: use the resolved name; no `main` ref is consulted after resolution succeeds.
- The invoking checkout is dirty or on a feature branch: remote-backed provisioning is unaffected because the new branch starts at the verified remote ref; untracked overlay copying retains its existing rules.
- The requested worktree branch or path already exists: retain `git worktree add`'s existing terminal failure.
- No `origin` exists: use `HEAD` without invoking `git ls-remote` or `git fetch`.

All base-resolution and fetch failures are terminal for the current invocation and may be retried after the remote condition is corrected. Input validation and existing-branch failures remain terminal until their local cause changes.

### Failure modes

- **The prompt changes one diff expression but misses its checkpoint twin.** Review and resume would use different identities. **How you'd know:** a test or prompt assertion finds local `main...HEAD`, or a resume fixture accepts a hash not derived from the review diff. **What it means:** reject the change until all coupled graft references share `<remote-base>`.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```text
Given a local checkout whose HEAD predates a commit on the remote default branch
When setup-worktree provisions a new remote-backed worktree
Then the new branch tip equals the freshly fetched remote default-branch tip
And the new worktree contains the remote-only commit
```

```text
Given a repository with no origin remote
When setup-worktree provisions a new worktree
Then the new branch is based on the invoking repository's HEAD
And provisioning performs no remote fetch
```

```text
Given a reachable origin remote that advertises no symbolic HEAD
When setup-worktree attempts to provision a new worktree
Then provisioning exits non-zero before `git worktree add`
And no branch name is guessed
```

```text
Given an origin remote that cannot be reached, times out, or whose resolved default ref cannot be fetched
When setup-worktree attempts to provision a new worktree
Then provisioning exits non-zero before `git worktree add`
And the requested branch, worktree directory, and Git worktree metadata entry do not exist
```

```text
Given a remote-backed graft branch and a stale local default-branch ref
When graft prepares review input and its review-progress hash
Then both are derived from the same fetched remote default base
And intervening commits absent from the feature branch are not reported as feature changes
```

## 6. DESIGN DECISION RATIONALE

**What should determine a new remote-backed worktree's base?**

- Local `HEAD`: requires no fetch, but is precisely the stale mutable state that caused FAFF-708.
- Fast-forward the local checkout and keep using `HEAD`: can work only when the local checkout is clean, on the default branch, and not contended by another worktree operation.
- Fetched remote default ref: observes merged siblings without changing the operator's checkout and works when the checkout is dirty or on another branch.

**Chosen:** fetched remote default ref — it fixes the correctness boundary directly without mutating the user's checked-out branch.

**How should remote failures behave?**

- Fall back to `HEAD`: keeps provisioning available but can silently omit merged dependencies.
- Fail the invocation: makes the unavailable freshness guarantee visible and retryable.

**Chosen:** fail the invocation when `origin` exists but its default base cannot be fetched and verified — including on a bounded-timeout expiry or a non-interactive credential failure.

**How should repositories without a remote behave?**

- Refuse all provisioning: would regress graft's supported git-only lane.
- Use local `HEAD`: preserves existing semantics where no remote truth exists.

**Chosen:** use local `HEAD` only when `origin` is absent.

**Where should diff-base correctness be fixed?**

- Only in `setup-worktree.sh`: fixes missing dependencies but leaves misleading review/checkpoint diffs.
- In provisioning plus graft's coupled review, hash, resume, and Step 8b instructions: aligns the branch base and the evidence derived from it.

**Chosen:** correct provisioning and every directly coupled graft diff identity — review input, `cur_hash`, resume-at-review, and Step 8b build-progress — in this ticket.

**What should identify the remote's default branch?**

- A separate forge API query: can disagree with the configured `origin` and adds an unrelated authentication path.
- `git ls-remote --symref origin HEAD`: a read-only query to the exact remote graft will fetch.

**Chosen:** query the remote's symbolic HEAD without mutation and fail if the remote does not advertise one.

**What is the integrity boundary on the tests' Markdown-extracted shell?** (infosec)

- Grep any command-shaped line from `SKILL.md`: makes an unrelated doc edit executable.
- Extract exactly the single fenced block under a stable heading, execute only in a disposable fixture, over committed PR-reviewed content, with no runtime extract-and-execute.

**Chosen:** the stable-heading single-block extraction over committed content in a throwaway fixture — the runtime graft path never extracts-and-executes Markdown (see §3 *Trust and integrity boundary*).

The configured `origin` is already faff's trust boundary for fetch, push, PR creation, and merge. Querying its symbolic HEAD does not grant a new authority; it discovers a branch name from the remote already trusted to supply the branch contents. A compromised or redirected `origin` is repository compromise outside this ticket's threat boundary and cannot be made safe by asking a forge API that may describe a different repository. A sibling merge after the captured review diff does not remove feature changes from a three-dot diff; the later merge gate independently re-observes the PR and CI state.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

None. The relevant remote conventions, git-only path, provisioner, and diff expressions are present in this repository.

## Already shipped against this surface

Related, but none supersedes this premise — `setup-worktree.sh:56` still branches off `HEAD` and graft's diff prose still names local `main` / hardcoded `origin/main`, so the bug is live:

- **FAFF-595 (Done)** — de-hooked worktree provisioning into the skill-step `setup-worktree.sh`; this is the provisioner this ticket edits, not a fix of the base selection.
- **FAFF-402 (Done)** — introduced the deterministic build-complete checkpoint whose resume diff currently hardcodes `git diff origin/main...origin/<branch>`; this ticket generalises that hardcode to the resolved default branch.
- **FAFF-532 / FAFF-186 / FAFF-208 (Done)** — config-copy / `.faffrc.yaml` handling in the worktree; orthogonal, retained as non-regression coverage.
- **FAFF-696 / FAFF-481 (Done)** — the evidence pair that reproduced the failure (696 built against a base missing 481's `seat_token_env`). Evidence, not coverage.

## 8. DONE — Definition of Done

### From WHY and WHAT

- [ ] A remote-backed worktree branch starts at the fetched `refs/remotes/origin/<resolved-default>` commit, regardless of the invoking checkout's branch or age.
- [ ] Default-branch selection parses `git ls-remote --symref origin HEAD`, makes no local Git-config write, never guesses `main`, and honours a resolved non-`main` branch.
- [ ] An existing but unresolvable, unreachable, timed-out, or unfetchable `origin` causes a non-zero exit before `git worktree add`.
- [ ] A reachable `origin` that advertises no symbolic HEAD causes a non-zero exit before `git worktree add`, with no guessed branch name.
- [ ] A repository without `origin` still creates its worktree branch from local `HEAD` and does not fetch.

### From HOW — network posture

- [ ] Both `git ls-remote --symref` and `git fetch` run with `GIT_TERMINAL_PROMPT=0` and under a `timeout` bounded by `FAFF_GIT_NET_TIMEOUT` (default 30s); a timeout (exit 124) or credential failure is treated as a terminal provisioning error, never a `HEAD` fall-back.
- [ ] `test/setup-worktree-base.test.mjs` includes a case whose `origin` fetch is made to fail/stall and asserts a non-zero exit before `git worktree add` and no `HEAD`-based branch.

### From HOW — provisioning

- [ ] Direct mode and hook mode share the same base-resolution and worktree-creation body.
- [ ] `test/setup-worktree-base.test.mjs` passes a stale-local-HEAD/newer-remote fixture through both direct and hook mode; each worktree contains the remote-only commit and its branch tip equals the fetched remote tip.
- [ ] A fixture whose remote default is not `main` proves the resolved branch supplies the base, exercised through both direct and hook mode.
- [ ] A fixture whose reachable remote advertises no symbolic HEAD proves provisioning fails before `git worktree add`.
- [ ] Existing tracked `.faffrc.yaml` own-ref protection and untracked overlay copying tests remain green as non-regression coverage; the new base-selection behaviour is covered separately by `test/setup-worktree-base.test.mjs`.
- [ ] Fetch or ref-verification failure occurs before `git worktree add`: the requested branch does not exist, the requested worktree directory does not exist, and `git worktree list --porcelain` has no entry for it. Existing-branch/path failures retain Git's existing atomic `worktree add` behaviour.

### From HOW — graft diff identity (every remote-base instruction is a named executable oracle)

- [ ] Under the stable `Remote-backed review diff` heading in `plugin/skills/faff-graft/SKILL.md`, one fenced block resolves/fetches the advertised default branch and captures `git diff <remote-base>...HEAD` once.
- [ ] That fenced block passes the captured file to review and hashes those exact bytes for review-progress, without a second diff calculation.
- [ ] The resume-at-review block (`Remote-backed resume diff`) and the Step 8b build-progress block (`Remote-backed build-progress diff`) resolve the advertised default branch and contain no literal `origin/main` base.
- [ ] `test/graft-remote-base.test.mjs` extracts and exercises each of the three stable-heading blocks (review diff, resume diff, build-progress diff) via the single-block-under-a-stable-heading anchor, in the stale-checkout fixture: the remote-only prerequisite commit is excluded, the feature commit is included, and the recorded `cur_hash` equals the review block's captured-file digest. The resume block's hash equals the review block's hash for the same diff.
- [ ] `test/graft-remote-base.test.mjs` asserts no in-scope graft diff instruction contains a literal `main...HEAD` or hardcoded `origin/main` base (a prompt-regression guard for the coupled twins).
- [ ] Git-only diff instructions continue to use their locally resolved base.

### Integration smoke test

- [ ] `smoke_test_stale_checkout_provisioning` passes for both direct and hook invocation modes.

```text
PROCEDURE smoke_test_stale_checkout_provisioning:
  1. Create a bare origin whose default branch is `main`
  2. Clone or initialise an invoking checkout at commit A
  3. Add commit B to origin/main without advancing the invoking checkout
  4. Run setup-worktree.sh once in direct mode and once in hook mode, in equivalent fixtures, with package installation skipped
  5. Assert each new branch tip equals commit B
  6. Assert a file introduced by commit B exists in each worktree
  7. Add one feature commit C in the direct-mode worktree
  8. Execute the `Remote-backed review diff` fenced block
  9. Assert the captured diff contains C, excludes B, and hashes to the recorded cur_hash
```

## Methodology critique

- **Right-sized:** this is one coherent 1–3 day change. Worktree base selection, the coupled graft diff instructions (review, resume, Step 8b), the network posture, and their tests must ship together. Fast-forwarding the operator's local default branch stays out of scope because it is independently useful but unnecessary for correctness here.
- **Workstream fit:** the ticket directly supports the project's stated outcome that the delivery loop works across harnesses; direct worktree provisioning must not depend on one harness keeping a local checkout current.
- **Dependencies:** FAFF-696 and FAFF-481 are evidence for the reproduced failure, and FAFF-365 (via the closed FAFF-374) is related context. None is an unfinished prerequisite, so no blocker link is needed.
- **Risk:** Git-reference handling is the only material risk. The stale-checkout, non-`main` default-branch, and no-symbolic-HEAD fixtures make it observable without needing a separate spike.

The remote-backed stale-checkout fixture must run once through direct mode and once through hook mode, asserting the same fetched branch tip in both paths; config-copy parity alone is not sufficient.

confidence: high

spec-review: approve

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
    { "marker": "chosen" }
  ] }
```