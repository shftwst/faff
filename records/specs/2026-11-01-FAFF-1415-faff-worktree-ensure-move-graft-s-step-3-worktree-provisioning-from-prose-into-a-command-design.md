# FAFF-1415: faff worktree ensure — graft's Step 3 worktree provisioning as one command

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1415.

> 2026-11-01 operator amendment (human): `test/graft-remote-base.test.mjs` (FAFF-708) now checks the resume diff identity against `faff worktree ensure`, since this ticket deletes the prose resume block: a checkpoint carrying the review or build-progress block's hash resumes, and one carrying any other hash does not. Builder choices for review, where this spec is silent: (1) a failed `git fetch` in a stale worktree is a warning, and the rebase runs onto the `base_ref` that `worktree-check` just fetched; (2) the root assert also accepts the realpath of the resolved root, so a symlinked `FAFF_WORKTREE_ROOT` is not refused (the worktree must still sit under the same physical directory); (3) a store `build-progress read` exit other than 0 or 3 is also `needs-human store-missing`.

## 1. WHY

Graft's Step 3 finds or creates the build worktree in about 70 lines of prose (faff-graft `SKILL.md` lines 129–198 on `main` at 948a8f1d). The agent re-reads it on every turn of every build and walks it by hand: `git worktree list`, then `faff worktree-check` with a three-way exit switch and five exit-2 reasons, an in-place rebase, `faff worktree-heal`, the autonomous resume-at-review diff-hash check, the resume-store fallback with its two hold causes and two dialogue stages, `faff conventions mine` and `get branch_naming`, the provisioning-script resolution (bundled, `find` fallback, project wrapper), and the `faff worktree-root --assert` backstop.

Worktree reuse and resume are where a build picks up stale state. Every branch above already has a tested primitive; what is untested is the sequencing between them, which lives only in prose. `faff worktree ensure` runs that sequence as one command and returns one result: where the worktree is, how it got there, and what state its work is in.

This is collapse 5 of the 2026-10-22 repo review (`verification/audits/2026-10-22-repo-review-throughput-cull-split.md` §1.4), following the pattern `faff graft admit` (FAFF-1414) set for Step 2.

### Design principles

- **Compose, never re-implement.** The command calls the existing primitives: `faff worktree-check`, `faff worktree-heal`, `faff build-progress read`, `faff resume-store restore`, `faff conventions mine` / `get`, `faff worktree-root`, and the bundled `setup-worktree.sh` and `remote-diff-base.sh`. Where a primitive only exposes a CLI, the command runs it as a child of the same `faff` binary (the pattern `run-checkpoint.ts` uses) and branches on its exit code and JSON exactly as the prose does today.
- **`setup-worktree.sh` stays the provisioner.** The script, the project-wrapper preference (`scripts/setup-worktree.sh` in the repo root) and the gateway's Worktree policy (`references/build.md`) are unchanged. The command decides which script runs and reads its last stdout line; the script still creates the branch, bases it on the fetched remote default (or `FAFF_WORKTREE_BASE_REF`), copies gitignored config and runs setup.
- **The agent reads the tracker; the command reads git.** The command makes no tracker call. The agent passes the tracker's branch hint from Step 1's fetch and, for the hold check, the issue's labels from a fresh read made just before the call.
- **No gate gets weaker.** Per-issue isolation (one worktree per issue, never a fresh-create onto a checked-out path), the staleness certification, the build-claim (Step 5, untouched) and the worktree-root assert all keep their current outcome in both modes. The one behavioural change on a gate is a tightening: the root assert now also covers a reused worktree (section 4.1, Chosen).
- **Typed result, graft-owned routing.** The command returns a disposition, a `mode` and a `resume_at` token in its own vocabulary (`start`, `existing`, `gate`, `review`), never a graft step number. Graft's prose maps those tokens to its steps and keeps the routing (which steps to skip, the dialogue and judge loops), so a graft step renumber never changes this command.

### Reference context

- `worktree-check.js` `cmdWorktreeCheck` — exit 0 fresh, 1 stale, 2 with `reason` ∈ {`no-worktree`, `clobbered-recoverable`, `ambiguous-match`, `no-branch`, `base-unresolvable`, `unreadable-behind`, `git-unavailable`}; JSON carries `worktree_path`, `branch`, `base_ref`, `behind`.
- `worktree-heal.js` `cmdWorktreeHeal` — exit 0 healed, exit 1 `repair-failed`.
- `effects.js` `cmdBuildProgress` — `build-progress read <run-dir> <issue>`: exit 0 with the checkpoint (`build.diff_hash`, `build.branch`), exit 3 none.
- `resume-store.js` `cmdResumeStore` — `restore --run-dir --issue --store-root`: exit 0 prints `cause` (`review-outage`, `build-review-dialogue`, or the `legacy` shape) and an optional `dialogue` object (`fix_rounds_used`, `rebuttal_rounds_used`, `hold_count`, `stage`, `next_round`); exits 1, 2, 3 are faults, exit 4 busy (a peer holds the store lock).
- `lights-out.js` `resolveWorktreeRoot`, `isStrictlyUnderRoot`, `cmdWorktreeRoot` — the single worktree-root resolver and the `--assert` containment predicate.
- `conventions.js` — `conventions mine` writes `.faff/conventions.json`; `conventions get branch_naming` returns `issue-slug`, `tracker-hint` or `slash-scoped`.
- `labels.js` `controlLabels(prefix, names)` — resolves the configured names of the `awaiting-review` and `awaiting-adjudication` roles.
- `plugin/skills/faff-graft/setup-worktree.sh` (direct mode: `<name> [<repo-root>]`, last stdout line is the path; `SKIP_NPM_PACKAGES_INSTALL` and `FAFF_WORKTREE_BASE_REF` honoured) and `remote-diff-base.sh` (prints the fetched `origin/<default>`, or the local default with no `origin`; fail-loud).
- `graft-admit.ts` and `run-checkpoint.ts` — the TypeScript layout, typed `require` views and dependency-injected `Deps` pattern this module follows.

### Already shipped against this surface

- FAFF-948 (Done): `faff worktree-check`, the reuse-path staleness gate this command calls.
- FAFF-1114 (Done): `faff worktree-heal`, the clobbered-admin-metadata repair.
- FAFF-382 (Done): the canonical `faff worktree-root` resolver and `--assert`.
- FAFF-708 (Done): `remote-diff-base.sh`, the shared fail-loud base resolver.
- FAFF-1041 / FAFF-1068 (Done): branch-naming conventions and the run-start conventions cache.
- FAFF-1414 (Done, #1166): `faff graft admit`, the Step 2 extraction this follows.

None delivers a composed Step 3 command, so the premise holds.

## 2. OUT OF SCOPE

- **The rest of Step 3's head.** The governed-run check, the interactive run-substrate mint (`faff run-ledger init-interactive`) and the Commissaire admit (lines 121–127) stay in graft prose, unchanged. They are run-substrate steps that happen to sit under the Step 3 heading; FAFF-1437 owns beep-boop's run open and close, not graft's.
- **Slug derivation.** Turning the issue title into `<slug>` stays with the agent (it is a naming judgement). The command formats the branch name from the slug, the scheme and the tracker hint.
- **What happens after the worktree exists.** Skipping Steps 4–7, the build-review dialogue loop and the chunked judge loop stay in graft prose; the command only says what state the worktree's work is in (`resume_at`).
- **Changing `setup-worktree.sh`, `worktree-check`, `worktree-heal`, `resume-store` or `build-progress`.** Their behaviour and exit codes are unchanged.
- **Beep-boop, the `concurrency` executors and `faff-beep-boop/SKILL.md`.** They rely on graft's isolation guarantee and do not call Step 3 directly; they are unchanged.
- **Commissaire.** This change adds nothing to `faff commissaire` or any `commissaire*` module.

## 3. WHAT

### Interface

```
faff worktree ensure --issue <ID> --mode interactive|autonomous --slug <slug>
                     [--tracker-branch <name>] [--labels <json-array>]
                     [--run-dir <dir>] [--root <repo-root>] [--json]
```

- `--slug` is the agent's slug for the issue title. Required, and it must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase kebab-case, no `/`); anything else is exit 2, so the name the command reports is always the name the provisioning script receives.
- `--tracker-branch` is the tracker's `gitBranchName` from Step 1's fetch, when it supplied one. Omitted in git-only mode. It is untrusted tracker text: the command uses it only when it passes `git check-ref-format --branch` and contains the issue id as a token, and otherwise falls back to `<issue>-<slug>` with a warning.
- `--labels` is the issue's live label set as a JSON array, from a fresh `get_issue` the agent makes immediately before this call (not Step 1's earlier fetch), so a hold label a peer applied or a human cleared since Step 1 is seen. It is read only when the resume-store hold check is reached (autonomous, no worktree, no build-progress checkpoint). It is exit 2 only if that check is reached and the value is missing or unparseable; graft passes it on every autonomous call, and nothing has been created on disk when that exit fires.
- `--run-dir` defaults to `$FAFF_RUN_DIR`. Autonomous mode requires one (the resume checks read `build-progress` from it and `resume-store restore` writes into it); without one it is exit 2, checked before anything else runs.
- `--root` defaults to the main checkout (`findRoot`, mapped from a linked worktree to the main checkout as `cmdWorktreeRoot` does).

### Output

One JSON object on stdout (a one-line summary in text mode):

```json
{
  "issue": "FAFF-1415",
  "disposition": "ready",
  "mode": "fresh",
  "cause": "no-worktree",
  "resume_at": "start",
  "wt": "/Users/me/.faff/worktrees/faff/faff-1415-worktree-ensure",
  "branch": "faff-1415-worktree-ensure",
  "base_ref": "origin/main",
  "behind": null,
  "setup_script": "bundled",
  "graft_skill_dir": "/Users/me/.claude/skills/faff-graft",
  "resume": null,
  "detail": {},
  "warnings": []
}
```

- `graft_skill_dir` is the bundled `faff-graft` directory, which holds `setup-worktree.sh` and `remote-diff-base.sh`. Graft's later steps (8b, 9) use it for their diff blocks; the agent sets `graft_skill_dir` from this field.
- `resume` is `{cause, dialogue}` exactly as `resume-store restore` printed them, on a `resumed-from-store` result; otherwise `null`.
- `setup_script` is `bundled` or `project`, on a `fresh` result; otherwise `null`.
- Every key is present on every result. On a non-`ready` result, `mode`, `resume_at`, `setup_script` and `resume` are `null`; `wt` is the worktree path the blocker concerns when one is known (the stale worktree a rebase conflict or heal failure concerns, the outside-root worktree, the missing result path), else `null`. For `uncertifiable:<reason>`, `wt` is `null`: `worktree-check`'s exit-2 output names no single worktree (an `ambiguous-match` has several); `branch` is the resolved branch name; `graft_skill_dir` is always set.
- `detail` is an object on every result (`{}` when empty) carrying the blocker's data: `worktree_path`, `base_ref` and `behind` from `worktree-check` when its output carries them (a stale result carries all three, `clobbered-recoverable` only `worktree_path`); `reason` alone for `uncertifiable:<reason>`, since `worktree-check`'s exit-2 output is `{issue, error, reason}`; `setup_log` (the script's `setup.log` path) and `exit` for `setup-failed`; `exit` and `stderr` (first line) for `store-restore-failed`; `resolved_root` and `actual` for `root-outside`; `store_path` for the unlabelled-store warning.

### Dispositions

| `disposition` | Meaning | Graft does |
|---|---|---|
| `ready` | The worktree exists and is certified, and (autonomous) is under the resolved root. An interactive worktree outside the root is still `ready`, with the root-outside warning | Continue by `resume_at` (section 4.2) |
| `hand-over` | Interactive only: a state the human must resolve (cause below) | Surface `cause` and the details, stop |
| `parked` | Autonomous only: the same states, which today park | Park protocol, citing `cause` |
| `needs-human` | Autonomous only: the resume store is unusable with a hold label present | Needs-human park, citing `cause` |
| `claimed-by-peer` | Autonomous only: `resume-store restore` exited 4 | Return `claimed-by-peer` |

All dispositions exit 0. Exit 2 (fail-loud) is reserved for bad invocation: a missing or invalid flag (including a slug outside the kebab-case pattern), autonomous mode without a run dir, a missing or unparseable `--labels` when the hold check is reached, a resolved branch name that fails `git check-ref-format --branch`, or an unreadable repo root. Graft treats a non-zero exit as a park (autonomous) or surfaces it (interactive), before Step 4.

### Modes, causes and `resume_at`

`resume_at` says what state the worktree's work is in, in the command's own vocabulary: `start` (nothing committed yet), `existing` (the branch already carries the spec commit from an earlier graft), `gate` (built work verified against the checkpoint or store: re-confirm gates and acceptance before review), `review` (built and gated work held mid-review; `resume.dialogue` says where). Graft maps each to its own steps (section 4.2).

| `mode` | When | `cause` | `resume_at` |
|---|---|---|---|
| `reused` | A worktree for the issue exists and `worktree-check` says fresh | `worktree-fresh` | `existing` |
| `rebased` | It existed, was stale, and the in-place rebase onto `base_ref` was clean | `stale-rebased` | `existing` |
| `healed` | Its admin metadata was clobbered, `worktree-heal` repaired it, and the re-check was fresh or rebased cleanly | `clobbered-healed` | `existing` |
| `resumed` | Autonomous, no worktree, a build-complete checkpoint whose `diff_hash` matches the remote diff; the worktree was recreated from the pushed branch | `checkpoint-match` | `gate` |
| `resumed-from-store` | Autonomous, no worktree, no checkpoint, a hold label, and a valid resume store restored | `store-restored` | `gate` (store cause `review-outage` or `legacy`), `review` (store cause `build-review-dialogue`) |
| `fresh` | A new worktree was created by the provisioning script | `no-worktree` (nothing to reuse, and no resume applied), `checkpoint-mismatch` (a checkpoint existed but did not verify), `store-mismatch` (a store existed but did not verify) | `start` |

Each `ready` result carries exactly one of these `cause` values. On any other disposition `cause` names the blocker:

| `cause` | Autonomous | Interactive |
|---|---|---|
| `rebase-conflict` | `parked`, after `git rebase --abort` | `hand-over`, the rebase left in progress for the human |
| `heal-failed` | `parked` | `hand-over` |
| `uncertifiable:<reason>` (`ambiguous-match`, `no-branch`, `base-unresolvable`, `unreadable-behind`, `git-unavailable`) | `parked` | `hand-over` |
| `setup-script-unresolvable` | `parked` | `hand-over` |
| `setup-failed` (the script exited non-zero or printed no path) | `parked` | `hand-over` |
| `resume-base-unresolvable` (`remote-diff-base.sh` failed during the resume check) | `parked` | — (interactive skips resume) |
| `resume-branch-diverged` (a local branch of that name exists at a different tip than the verified ref) | `parked` | — |
| `resume-recreate-failed` (`git worktree add` failed, or the new worktree is not at the verified tip) | `parked` | — |
| `worktree-missing` (the result path is not an existing directory) | `parked` | `hand-over` |
| `root-outside` | `parked` | `ready`: `mode`, `cause` and `resume_at` stay those of the path taken (for example `reused`, `worktree-fresh`, `existing`); `warnings` names root-outside and `detail` carries `resolved_root` and `actual` |
| `store-missing` (hold label, `build-progress read` on the store exits 3) | `needs-human` | — |
| `store-restore-failed:<exit>` (restore exit 1, 2 or 3) | `needs-human` | — |
| `store-busy` (restore exit 4) | `claimed-by-peer` | — |

## 4. HOW

### 4.1 Procedure

```
ensure(issue, mode, slug, trackerBranch, labels, runDir, root):
  0. validate flags; slug matches ^[a-z0-9]+(-[a-z0-9]+)*$; autonomous requires runDir   -> else exit 2
     graftDir := the bundled faff-graft dir resolved beside this module (bin/lib/../../../faff-graft)
  1. run `faff conventions mine` (best effort; a failure is a warning, the get below still resolves)
     scheme := `faff conventions get branch_naming`
     branch := issue-slug  -> "<issue>-<slug>"
               tracker-hint -> trackerBranch when given AND it passes `git check-ref-format --branch`
                               AND it contains the issue id as a token (tokenMatch, case-insensitive,
                               as worktree-check matches), else "<issue>-<slug>" (+ warning when a hint was dropped)
               slash-scoped -> "feature/<issue>-<slug>"
     branch fails `git check-ref-format --branch` -> exit 2   (only reachable through an issue id git rejects)
  2. chk := `faff worktree-check --issue <issue> --root <root> --json`
     exit 0 -> wt := chk.worktree_path; mode reused, cause worktree-fresh
     exit 1 -> loud stderr note (worktree_path, base_ref, behind)
               git -C chk.worktree_path fetch ; git -C chk.worktree_path rebase chk.base_ref
               clean    -> mode rebased
               conflict -> autonomous: rebase --abort; parked rebase-conflict
                           interactive: hand-over rebase-conflict (rebase left in progress)
     exit 2 reason no-worktree           -> go to 3
            reason clobbered-recoverable -> `faff worktree-heal --issue <issue> --root <root> --json`
                                            exit 0 -> re-run 2 once; its fresh/stale outcome stands, mode healed
                                            exit 1 -> parked | hand-over heal-failed
            any other reason              -> parked | hand-over uncertifiable:<reason>
     on reuse: chk.branch != branch -> warnings += "checked-out branch <b> differs from expected <branch>"
     -> go to 6
  3. autonomous only (interactive goes to 5):
     cp := `faff build-progress read <runDir> <issue>`
     exit 0 -> base := `bash <graftDir>/remote-diff-base.sh`   (failure -> parked resume-base-unresolvable)
               fref := origin/<cp.build.branch> when base starts "origin/", else <cp.build.branch>
               cur  := sha256(stdout bytes of `git diff <base>...<fref>`)
               fref resolves AND cur == cp.build.diff_hash -> recreate(cp.build.branch, fref); mode resumed, resume_at gate, go to 6
               else -> cause checkpoint-mismatch, go to 5
     recreate(b, fref):
       [origin exists: git fetch origin]
       a local branch b exists AND its tip != fref's tip -> parked resume-branch-diverged   (never reset it)
       path := <rootDir>/<safe(b)>, where safe() replaces every "/" with "-" (setup-worktree.sh's SAFE_NAME rule)
               and rootDir is resolveWorktreeRoot's root; path must be strictly under rootDir, else parked resume-recreate-failed
       path is already a registered worktree (git worktree list --porcelain):
         on branch b with HEAD == fref's tip -> reuse it, no add   (a recreate an earlier drain made that worktree-check cannot match)
         otherwise -> parked resume-recreate-failed
       git worktree add <path> <b>        (no -b; with no local b, git creates it from origin/<b>)
       add fails, OR the new worktree's HEAD != fref's tip -> parked resume-recreate-failed
     exit 3 -> go to 4
  4. autonomous, exit 3 above:
     labels missing or unparseable -> exit 2      (nothing has been created yet)
     held := labels contain the resolved awaiting-review OR awaiting-adjudication role name
     NOT held -> a store directory exists at <root>/.faff/resume/<issue>
                   -> warnings += "resume store present but no hold label passed; building fresh", detail.store_path
                 go to 5
     sp := `faff build-progress read <root>/.faff/resume <issue>`
     exit 3 -> needs-human store-missing
     exit 0 -> validate as step 3 (branch resolves, diff hash matches)
               mismatch -> cause store-mismatch, go to 5     (the store is left in place)
               valid    -> r := `faff resume-store restore --run-dir <runDir> --issue <issue> --store-root <root>/.faff/resume`
                           exit 0 -> recreate(sp.build.branch, fref) as in step 3; mode resumed-from-store;
                                     resume_at gate (r.cause review-outage or legacy) or review (build-review-dialogue);
                                     resume := {cause, dialogue} verbatim; go to 6
                           exit 4 -> claimed-by-peer store-busy
                           exit 1|2|3 -> needs-human store-restore-failed:<exit>
  5. fresh create:
     script := <root>/scripts/setup-worktree.sh if it exists (setup_script project),
               else <graftDir>/setup-worktree.sh if it exists (bundled),
               else -> parked | hand-over setup-script-unresolvable
     out := `bash <script> <branch> <root>` (environment passed through unchanged)
     non-zero exit, or empty last stdout line -> parked | hand-over setup-failed (with the setup.log path)
     wt := last stdout line; mode fresh, cause per section 3 (no-worktree | checkpoint-mismatch | store-mismatch); resume_at start
  6. existence, then root assert (every ready path, reused included):
     wt is not an existing directory -> parked | hand-over worktree-missing
     actual := `git -C <wt> rev-parse --show-toplevel`
     resolve the root with resolveWorktreeRoot; under := isStrictlyUnderRoot(root, actual)
     NOT under -> autonomous: parked root-outside ; interactive: warnings += it, stay ready
     actual unresolvable -> warnings += "root assert skipped: <why>"   (never a refusal, as today)
  7. -> ready
```

- **Chosen:** the rebase, heal and resume steps run inside the command, not as descriptors for the agent to execute. They are mechanical git operations whose inputs come from the primitives' JSON, and the review's point is that the agent mis-sequences exactly this; the command uses the JSON paths, never a separately tracked variable, as the prose already requires.
- **Chosen:** an interactive rebase conflict is left in progress (`hand-over`), matching today's "hand the conflict to the human to resolve". An autonomous conflict is aborted before the park, as today, so no half-rebased tree survives.
- **Chosen:** the worktree-root assert now also runs on the reuse paths (`reused`, `rebased`, `healed`). Today it runs only after a fresh create or a resume. A reused worktree outside the resolved root breaks the same isolation property, and the reuse path is the one most likely to predate a `worktree_root` change. In interactive mode this is a warning, as for a fresh create; in autonomous mode it parks. This is the only gate whose outcome changes, and it changes toward refusal.
- **Chosen:** a resume-store mismatch leaves the store in place rather than deleting it. Today's "discard the store" names no deletion verb and `resume-store` has none; leaving it keeps the command non-destructive, and the next drain re-validates it against the then-current branch.
- **Chosen:** the hold check trusts the labels the agent passes, as the prose's hold check trusts the labels the agent read: the command makes no tracker call. Two mitigations narrow the window the review flagged. The agent passes labels from a fresh `get_issue` immediately before the call, not Step 1's fetch. A resume store on disk with no hold label in `--labels` is reported as a warning (with the store path) rather than silently ignored as today. It is not a refusal: `resume-store restore` copies the store and never deletes it, so a store survives every completed hold, and refusing on it would park every later build of that issue.
- **Chosen:** the hold check resolves the two hold labels by role through `controlLabels`, so a configured label prefix or name override works. Today's prose names `faff-awaiting-review` literally for one of them.
- **Chosen:** a non-zero `setup-worktree.sh` exit, or an empty path, is an explicit refusal (`setup-failed`). Today the prose captures the last stdout line without checking the exit, so a failed provision surfaced later as a missing directory.
- **Chosen:** the provisioning script is resolved from the command's own install location. The `find ~/.claude …` fallback is dropped: the command runs from the same install as the bundled script, so the fallback can only find a different install's copy. An unresolvable script parks as today.
- **Chosen:** the `tracker-hint` scheme uses the tracker's branch name only when it contains the issue id as a token. `worktree-check` finds a worktree by the issue id in its path or branch, so a hint without it would create a worktree the next graft cannot find, and the next fresh create would collide with the checked-out branch. Today's prose has the same gap; the command closes it by falling back to `<issue>-<slug>` with a warning. Linear's own branch names carry the identifier, so the fallback does not fire for them.
- **Chosen:** the resume recreate never resets a local branch. When no local branch exists, `git worktree add <path> <branch>` creates it from `origin/<branch>`, which is the ref the diff hash was verified against. When one exists at a different tip, the command parks (`resume-branch-diverged`) rather than check out an unverified tree or discard local commits. After the add, the worktree's `HEAD` must equal the verified tip.
- **Chosen:** every `ready` result names an existing directory. A failed `git worktree add` or a missing path is a refusal, never a `ready` result with a warning; the root assert's skip-on-tooling-failure (row 51) applies only once the directory is known to exist.
- **Chosen:** `resume-base-unresolvable` parks. Today's resume block runs `|| exit 1` in an agent bash block, which leaves the outcome to interpretation; failing closed is the reading that keeps a stale or unverifiable base from being built on.

### 4.2 Caller: graft Step 3

Step 3 keeps, in prose:

- the Worktree-policy pointer line and the governed-run check, interactive mint and Commissaire admit paragraphs, unchanged;
- one `faff worktree ensure` call, passing `--slug` and `--tracker-branch` from Step 1's fetch and, in autonomous mode, `--labels` from a fresh `get_issue` made immediately before the call;
- `wt := .wt` and `graft_skill_dir := .graft_skill_dir`; every later step uses `$wt` with absolute paths, as today;
- a routing table:
  - `ready` → by `resume_at`: `start` → Step 4; `existing` → Step 5 (the spec was committed on the first graft); `gate` → skip Steps 4–7, re-run 7.5 and 8, then Step 9; `review` → skip Steps 4–8 and branch on `resume.dialogue.stage`: `dialogue` or absent re-enters the build-review dialogue loop at `resume.dialogue.next_round`, seeding `{fix_rounds_used, rebuttal_rounds_used, hold_count}` with the caps not reset; `judge` recaptures `--diff` with the Remote-backed review diff block and runs Step 9's chunked judge loop with `--reopen-for-hold <resume.dialogue.hold_count>`. Surface every `warnings` entry;
  - `hand-over` → surface `cause` and the worktree path and stop;
  - `parked` / `needs-human` → park protocol citing `cause`, logged to `.faff/runs/<run-id>/<ISSUE>/graft.md`;
  - `claimed-by-peer` → return `claimed-by-peer`;
  - a non-zero exit → park (autonomous) or surface (interactive), before Step 4.
- On `resumed-from-store`, log "resumed from store" to `graft.md`. On `resume_at: gate` from a `review-outage` store, Step 9 reads the carried `review-progress.json` and restores `outage_retries`, as today.

The `worktree-check` bash block and its exit switch, the Resume-at-review check, the Remote-backed resume diff block, the Resume-store fallback's procedure, the conventions-mine and branch-name paragraphs, the provisioning bash block and the Worktree-root assert block are deleted. The resume-store cause and stage semantics that graft still acts on stay as the routing bullets above.

Also, line-neutral:

- graft `SKILL.md` Configuration ("Worktree provisioning") says `faff worktree ensure` invokes `setup-worktree.sh`, in place of "the Step 3 fresh-create path invokes … directly via the shell";
- `references/build.md` Worktree policy names `faff worktree ensure` as graft's invocation of the script; the policy itself is unchanged.

### 4.3 Module placement and registration

- New TypeScript module `bin/lib/worktree-ensure.ts`, with its committed `tsc` emit `bin/lib/worktree-ensure.js` beside it (ADR-0132). Add the `.ts` to `tsconfig.json` `include`, run `npm run build` in `plugin/skills/faff`, and commit the emit and the updated `build-manifest.json` with the source.
- The source passes `check-no-boundary-cast` (no `as`, non-null `!` or `satisfies`); add `worktree-ensure.ts` to the pinned list in `test/check-no-boundary-cast.test.mjs`.
- Child invocations and git calls go through an injectable `Deps` object (the `run-checkpoint.ts` pattern), so unit tests can drive every branch without a network.
- CLI: a new top-level `worktree` command with one subcommand, `ensure`; region `factory` (its siblings `worktree-check`, `worktree-heal` and `worktree-root` are factory). No `--selftest`: `REGION_SELFTEST_ARGV["worktree"] = null` and a `TEST_FILE_COVERAGE` entry naming `test/worktree-ensure.test.mjs`.
- `docs/guide/cli.md` documents the command, the output object, the disposition, mode and cause tables.
- `SKILL_LINE_BASELINE["faff-graft"]` is lowered to the measured count. `ANCHOR_PHRASES["faff-graft"]` (`run_in_background: true`, `never end a turn`, `foreground-to-terminal`) occur nowhere in Step 3, so none moves.

### 4.4 Edge cases

- **Slash-scoped branches.** `setup-worktree.sh` creates the branch as `tr '/' '-'` of its name, so `feature/<issue>-<slug>` becomes `feature-<issue>-<slug>`, today and after this change. The command reports the branch actually checked out (`git -C <wt> branch --show-current`) in `branch`, and the resume path uses the checkpoint's recorded `build.branch`, never a re-derived name, with the same `/`→`-` rule for its directory name.
- **Untrusted branch names.** The tracker hint and a recorded `build.branch` are the two names the command did not build itself. The hint is validated before use (section 3). A recorded name was validated when it was first created, and git rejects an invalid ref at `git worktree add`, which is then `resume-recreate-failed`. A recorded name written before this change may lack the issue-id token, so `worktree-check` never matches the worktree a recreate makes from it. The next drain then finds the same checkpoint and recreates again; the recreate reuses a registered worktree already at its path when it is on that branch at the verified tip, so the issue resumes at `gate` instead of parking on every drain. Every path the command builds itself (the resume recreate) is checked to be strictly under the resolved root before `git worktree add` runs; a path the provisioning script builds is checked by the step-6 root assert.
- **Git-only mode (no `origin`).** `remote-diff-base.sh` prints the local default and `fref` is the local branch; the resume recreate skips `git fetch` and adds the worktree from the local branch, which survives worktree teardown. `setup-worktree.sh` bases a fresh branch on local `HEAD`, as today.
- **Stacked builds.** `FAFF_WORKTREE_BASE_REF` reaches `setup-worktree.sh` through the unchanged environment.
- **`SKIP_NPM_PACKAGES_INSTALL`.** Passed through to the script unchanged.
- **Heal re-check.** The re-check after a heal runs once. A second `clobbered-recoverable` (or any exit 2) on the re-check is `heal-failed`, never a loop.
- **Diff bytes.** `cur` hashes the raw stdout bytes of `git diff`, which is what `git diff … | sha256sum` hashes in Step 8b's checkpoint write, so the two match.

### 4.5 Rule inventory

Every rule in the Step 3 prose this ticket deletes or replaces (lines 129–198 on `main` at 948a8f1d). "Agent" means the rule stays in the shortened prose.

| # | Prose rule (line) | Command behaviour | Covering test (`worktree-ensure.test.mjs`) | Disposition |
|---|---|---|---|---|
| 1 | Run `git worktree list`, match on the issue id in the path (129) | `worktree-check` does the match | "existing fresh worktree is reused" | changed: one primitive instead of a hand-listed scan |
| 2 | Existing worktree: verify the checked-out branch, warn if not (132) | `warnings` on mismatch | "reused branch mismatch warns" | kept |
| 3 | Reuse-path staleness gate runs before "skip to step 5", both modes (134) | step 2 always runs first | "existing fresh worktree is reused" | kept |
| 4 | Fresh (exit 0) → reuse, skip to Step 5 (141) | `reused`, `resume_at existing` | "existing fresh worktree is reused" | kept |
| 5 | Stale (exit 1) → loud note to stderr, and to graft.md autonomously (142) | stderr note; graft logs `cause` | "stale worktree rebases cleanly" | kept (the graft.md line is agent) |
| 6 | Rebase via the JSON's `worktree_path` and `base_ref`, never a separate variable (142) | uses `chk` fields | "stale worktree rebases cleanly" | kept |
| 7 | Clean rebase → continue the reuse flow (142) | `rebased`, `resume_at existing` | "stale worktree rebases cleanly" | kept |
| 8 | Rebase conflict, autonomous → abort, log, `parked` (142) | `rebase --abort`; `parked rebase-conflict` | "autonomous rebase conflict aborts and parks" | kept |
| 9 | Rebase conflict, interactive → WARN, hand to the human (142) | `hand-over rebase-conflict`, rebase left in progress | "interactive rebase conflict hands over" | kept |
| 10 | Exit 2 is never handled uniformly; read `reason` (143) | branch on `reason` | every exit-2 case below | kept |
| 11 | `no-worktree` → fall through to fresh create (144) | step 3 / 5 | "no worktree creates fresh" | kept |
| 12 | `clobbered-recoverable` → `worktree-heal`, then re-enter the gate (145) | heal, re-check once | "clobbered worktree heals and is reused" | kept |
| 13 | Heal exit 1 → autonomous park, interactive WARN (145) | `parked` / `hand-over heal-failed` | "heal failure parks or hands over" | kept |
| 14 | Never fresh-create onto the surviving dir (145, 146) | no fresh-create (step 5 of section 4.1) from these causes | "uncertifiable never fresh-creates" | kept |
| 15 | Other reasons → autonomous park, interactive WARN, citing the reason (146) | `uncertifiable:<reason>` | "uncertifiable never fresh-creates" (each reason) | kept |
| 16 | Resume-at-review is autonomous only; interactive skips (150) | step 3 gated on mode | "interactive never resumes" | kept |
| 17 | Read `build-progress`; exit 3 → resume-store fallback (150) | step 3 → 4 | "no checkpoint, no hold creates fresh" | kept |
| 18 | Recompute `cur` against the fetched remote default, never a hardcoded ref (150, 152) | `remote-diff-base.sh`, three-dot diff | "checkpoint match resumes" | kept |
| 19 | Remote ref for `origin/*` bases, local branch in git-only (156) | `fref` rule | "git-only checkpoint match resumes" | kept |
| 20 | `remote-diff-base.sh` failure → `exit 1` (155) | `parked resume-base-unresolvable` | "resume base failure parks" | changed: an explicit park in place of an unrouted `exit 1` |
| 21 | Match → recreate from the pushed branch, `git fetch` then `git worktree add <path> <branch>`, no `-b`, not via the hook (160) | `recreate`, same git invocation; refuses a diverged local branch or a failed add | "checkpoint match resumes", "diverged local branch parks", "failed recreate parks", "recreate reuses its own earlier worktree" | changed: two explicit refusals, `HEAD` is checked against the verified tip, and a registered worktree already at the path on that branch and tip is reused |
| 22 | Match → skip Steps 4–7, re-run 7.5 and 8, then Step 9 (160) | `resume_at gate` | "checkpoint match resumes" | kept (the skip is agent routing) |
| 23 | Mismatch or branch gone → discard the checkpoint, fresh create (161) | `checkpoint-mismatch`, step 5; checkpoint not deleted | "checkpoint mismatch creates fresh" | kept |
| 24 | Store fallback only on exit 3 and a hold label (163) | step 4 gate; labels from a fresh read; an unlabelled store on disk is a warning | "no checkpoint, no hold creates fresh", "unlabelled store warns" | changed: the store's presence is reported when no hold label is passed |
| 25 | Both hold labels gate it, read by role (163) | `controlLabels` for both roles | "custom prefix hold label" | changed: `awaiting-review` read by role, not the literal name |
| 26 | Store `build-progress read` exit 3 → needs-human, never a fresh build (163) | `needs-human store-missing` | "hold with missing store needs human" | kept |
| 27 | Store mismatch → discard the store, fresh rebuild (163) | `store-mismatch`, step 5; store left in place | "store mismatch creates fresh, store kept" | changed: the store is not deleted (section 4.1) |
| 28 | Valid store → `resume-store restore` (163) | step 4 restore | "store restore resumes" | kept |
| 29 | Restore exit 1/2/3 → needs-human citing stderr (163) | `needs-human store-restore-failed:<exit>` | "store restore failure needs human" | kept |
| 30 | Restore exit 4 → `claimed-by-peer` (163) | `claimed-by-peer store-busy` | "store busy is claimed-by-peer" | kept |
| 31 | Log "resumed from store" (163) | — | — | kept (agent) |
| 32 | `review-outage` / `legacy` → as RESUME, Step 9 restores `outage_retries` (165) | `resume_at gate`, `resume` carried | "store restore resumes" | kept (the restore is agent) |
| 33 | `build-review-dialogue` → skip 4–8, seed counters, caps not reset (166) | `resume_at review`, `resume.dialogue` carried verbatim | "dialogue-cause store resumes at review" | kept (the seeding is agent) |
| 34 | Stage `dialogue` or absent → dialogue loop at `next_round` (167) | `resume.dialogue.stage` carried verbatim | "dialogue-cause store resumes at review" | kept (the stage branch is agent) |
| 35 | Stage `judge` → recapture diff, chunked judge with `--reopen-for-hold` (168) | `resume.dialogue.stage` carried verbatim | "judge-stage store resumes at review" | kept (the stage branch and judge loop are agent) |
| 36 | No label → the store is never read (170) | step 4 gate | "no checkpoint, no hold creates fresh" | kept |
| 37 | Mine conventions once at the start of Step 3 (172) | step 1 | "conventions cache written" | kept |
| 38 | Branch name via `branch_naming`: issue-slug, tracker-hint (fallback issue-slug), slash-scoped (174) | step 1; a hint that fails `check-ref-format` or lacks the issue id falls back to issue-slug; an invalid slug is exit 2 | "branch naming per scheme", "tracker hint without issue id falls back", "invalid tracker hint falls back", "non-kebab slug exits 2" | changed: the hint must carry the issue id |
| 39 | Resolve the bundled script beside the `faff` binary (176, 180) | `graftDir` from the module's location | "bundled script used" | kept |
| 40 | `find ~/.claude` fallback (181) | not carried | — | dropped: the command runs from the bundled script's own install (section 4.1) |
| 41 | Prefer `scripts/setup-worktree.sh` when present (182) | project wrapper first | "project wrapper preferred" | kept |
| 42 | Last stdout line is the worktree path (183) | `wt` | "no worktree creates fresh" | kept |
| 43 | Script still copies config and runs setup (186) | script unchanged | — | kept (the script) |
| 44 | Unresolvable script → park, never a silent skip (186) | `setup-script-unresolvable` | "missing script parks or hands over" | kept |
| 45 | — (the script's exit was not checked) | `setup-failed` on non-zero or empty output | "failed provision parks or hands over" | changed: new explicit refusal |
| 46 | Later steps use `$wt` with absolute paths (186) | `wt` returned | — | kept (agent) |
| 47 | Root assert after fresh create or resume, before Step 4 (188) | step 6 | "worktree outside root parks" | changed: also covers reuse (section 4.1) |
| 48 | Root assert uses the single canonical resolver (188) | `resolveWorktreeRoot`, `isStrictlyUnderRoot` | "worktree outside root parks" | kept |
| 49 | Outside root, autonomous → refuse pre-build, log, `parked` (197) | `parked root-outside` | "worktree outside root parks" | kept |
| 50 | Outside root, interactive → WARN and continue (197) | `ready` with a warning | "interactive outside root warns" | kept |
| 51 | Assert tooling failure → skip with a log, never a hard fail (198) | warning, stays `ready`, only after the directory is known to exist | "root assert tooling failure warns", "missing worktree path refuses" | kept |
| 52 | `graft_skill_dir=$(dirname "$script")` (152) | `graft_skill_dir` field, always the bundled dir | "graft_skill_dir is the bundled dir" | changed: today it pointed at `scripts/` when the project wrapper won, where `remote-diff-base.sh` does not exist |

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git repo with an origin remote, no worktree for FAFF-9, and branch_naming issue-slug
When faff worktree ensure --issue FAFF-9 --mode interactive --slug demo --json runs
Then it exits 0 with disposition "ready", mode "fresh", cause "no-worktree", resume_at "start", branch "FAFF-9-demo"
And wt is a directory under the resolved worktree root whose checked-out branch is FAFF-9-demo
```

```
Given an existing worktree for FAFF-9 that is one commit behind origin's default branch with no conflicting change
When faff worktree ensure --issue FAFF-9 --mode autonomous --slug demo --labels '[]' --run-dir D --json runs
Then it exits 0 with disposition "ready", mode "rebased", cause "stale-rebased", resume_at "existing"
And the worktree's branch contains origin's new commit
```

```
Given the same conflicting worktree
When faff worktree ensure --issue FAFF-9 --mode interactive --slug demo --json runs
Then it exits 0 with disposition "hand-over" and cause "rebase-conflict"
And git status in that worktree shows a rebase in progress
```

```
Given the same setup but a checkpoint diff_hash that does not match
When faff worktree ensure --issue FAFF-9 --mode autonomous --slug demo --labels '[]' --run-dir D --json runs
Then it exits 0 with mode "fresh" and cause "checkpoint-mismatch", and the checkpoint file is unchanged
```

```
Given no worktree for FAFF-9, no checkpoint in run dir D, and no resume store
When faff worktree ensure --issue FAFF-9 --mode autonomous --slug demo --labels '["faff-awaiting-review"]' --run-dir D --json runs
Then it exits 0 with disposition "needs-human" and cause "store-missing", and no worktree was created
```

```
Given no worktree for FAFF-9, no checkpoint in run dir D, a pushed branch FAFF-9-demo on origin, and a resume store for FAFF-9 stashed by faff resume-store stash with cause build-review-dialogue, whose build-progress diff_hash is the sha256 of git diff origin/main...origin/FAFF-9-demo
When faff worktree ensure --issue FAFF-9 --mode autonomous --slug demo --labels '["faff-awaiting-review"]' --run-dir D --json runs
Then it exits 0 with disposition "ready", mode "resumed-from-store", cause "store-restored", resume_at "review"
And resume.cause is "build-review-dialogue" and resume.dialogue equals the dialogue faff resume-store read prints for FAFF-9
```

```
Given an existing, fresh worktree for FAFF-9 located outside the resolved worktree root
When faff worktree ensure --issue FAFF-9 --mode autonomous --slug demo --labels '[]' --run-dir D --json runs
Then it exits 0 with disposition "parked" and cause "root-outside"
```

## 5. DESIGN DECISION RATIONALE

- **One command, typed result.** The same shape as `graft admit`: the primitives already exist and are tested, so the gain is a tested sequence and a smaller prompt, not new mechanics.
- **Execute the git steps rather than describe them.** A descriptor the agent then executes would keep the exact sequencing risk the ticket removes (rebase against the wrong path, fresh-create onto a checked-out dir). The command is the only place those steps run.
- **Graft keeps the routing.** Skipping steps and re-entering loops are graft's control flow. The command reports the work's state in its own vocabulary (`resume_at`) and passes the store's `dialogue` object through untouched, so it never encodes a graft step number or Step 9's stages.
- **Tighten, never loosen.** The two outcome changes on refusals (`setup-failed`, root assert on reuse) refuse more, and the `resume-base-unresolvable` change names a refusal the prose left implicit.

## 6. DECISIONS AND ASSUMPTIONS

- **Chosen:** the command is `faff worktree ensure` (a `worktree` command with an `ensure` subcommand), as the ticket names it, beside the existing hyphenated `worktree-*` primitives, which are unchanged.
- **Chosen:** the governed-run check, interactive mint and Commissaire admit stay in Step 3's prose (section 2).
- **Assumes:** Step 8b's checkpoint `diff_hash` is `sha256` over the raw bytes `git diff "$base...$fref"` writes to stdout, with no trailing transformation, so the in-process hash equals `sha256sum`'s.
- **Assumes:** `git worktree add <path> <branch>` with an existing local branch of that name checks out the local branch, exactly as today's prose command does; the command issues the same git invocation and inherits git's behaviour.

## 7. DONE

### From WHY
- [ ] `faff worktree ensure` returns, for each mode and refusal cause in section 3, the outcome Step 3's prose reaches for the same repository state, except the changes named in section 4.5 rows 20, 21, 24, 25, 27, 38, 40, 45, 47 and 52.
- [ ] Graft Step 3 calls `faff worktree ensure` and no longer shells `faff worktree-check`, `faff worktree-heal`, `faff build-progress read`, `faff resume-store restore`, `faff conventions mine`, `faff conventions get branch_naming`, `setup-worktree.sh` or `faff worktree-root --assert`.

### From WHAT and HOW
- [ ] Autonomous mode without a run dir exits 2; so does a missing `--issue`, `--mode` or `--slug`, a slug outside `^[a-z0-9]+(-[a-z0-9]+)*$`, and a missing or unparseable `--labels` when the hold check is reached. A reused worktree in autonomous mode with no `--labels` is not exit 2.
- [ ] The output carries `resume_at` (`start`, `existing`, `gate`, `review`) and no graft step number; each `ready` result carries exactly one `cause` from section 3's table.
- [ ] Interactive mode never reads a build-progress checkpoint or a resume store.
- [ ] An autonomous rebase conflict leaves no rebase in progress; an interactive one leaves it in progress.
- [ ] A `clobbered-recoverable` worktree is healed and re-checked once; a heal failure or a second exit 2 is `heal-failed`.
- [ ] No exit-2 reason other than `no-worktree` leads to a fresh create.
- [ ] The resume store and the build-progress checkpoint are never deleted or modified by the command, except through `resume-store restore`.
- [ ] The hold check matches the `awaiting-review` and `awaiting-adjudication` roles under a configured non-default label prefix.
- [ ] With no checkpoint, no hold label and a resume store directory on disk, the result is a fresh create whose `warnings` name the store and whose `detail.store_path` is set.
- [ ] Every result carries every output key; on a non-`ready` result `mode`, `resume_at`, `setup_script` and `resume` are `null` and `detail` carries the blocker's data as section 3 lists.
- [ ] The project wrapper `scripts/setup-worktree.sh` is used when present, else the bundled script; neither is modified.
- [ ] A non-zero script exit or empty output is `setup-failed`.
- [ ] A `tracker-hint` branch name that fails `git check-ref-format --branch` or lacks the issue id as a token is replaced by `<issue>-<slug>`, with a warning.
- [ ] The resume recreate's path is `<root>/<branch with "/" replaced by "-">`, and it is checked to be strictly under the resolved root before `git worktree add` runs.
- [ ] When the recreate path is already a registered worktree on the recorded branch at the verified tip, the recreate reuses it without `git worktree add` and the result is `resumed`; at any other branch or tip it is `resume-recreate-failed`.
- [ ] The resume recreate never resets or deletes a local branch; a diverged local branch is `resume-branch-diverged`, and a failed add or a `HEAD` other than the verified tip is `resume-recreate-failed`.
- [ ] No `ready` result names a path that is not an existing directory.
- [ ] The root assert runs on every `ready` path, including `reused`, `rebased` and `healed`.
- [ ] `graft_skill_dir` is the bundled `faff-graft` directory on every result.
- [ ] The command makes no tracker call.
- [ ] `docs/guide/cli.md` documents the command, its output and its tables.
- [ ] `faff commissaire` and every `commissaire*` module are unchanged by this PR.
- [ ] The command lives in `bin/lib/worktree-ensure.ts` with its committed emit `bin/lib/worktree-ensure.js`; the `.ts` is in `tsconfig.json` `include`, and `build-manifest.json` is updated in the same commit.
- [ ] `worktree-ensure.ts` contains no `as`, non-null `!` or `satisfies`, and `test/check-no-boundary-cast.test.mjs` lists it and passes.
- [ ] `faff regions check` passes, and CI's committed-emit check passes.
- [ ] Graft Step 3 routes every disposition, `resume_at` token and a non-zero exit as section 4.2 lists, and returns only tokens already in graft's return-value list.
- [ ] Graft's Configuration paragraph and `references/build.md` name `faff worktree ensure` as the invoker of `setup-worktree.sh`; the Worktree policy rules are otherwise unchanged.

### Rule inventory
- [ ] Every row in section 4.5 has its listed test case, or is marked agent or dropped with a reason.
- [ ] Every line the PR deletes from `faff-graft/SKILL.md` maps to a row in section 4.5; the PR description lists the mapping by row number.
- [ ] `SKILL_LINE_BASELINE["faff-graft"]` is lowered to the count measured after the branch is rebased on `main`.

### Tests
- [ ] `test/worktree-ensure.test.mjs` covers every row's named case, both modes, git-only, each `branch_naming` scheme, and each `uncertifiable:<reason>`, using temporary git repositories with a bare origin and `SKIP_NPM_PACKAGES_INSTALL=1`, plus injected `Deps` for the store and restore exit codes.
- [ ] `REGION_SELFTEST_ARGV["worktree"] = null` with a `TEST_FILE_COVERAGE` entry naming `test/worktree-ensure.test.mjs`, and `lint-cli-coverage` passes.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

## Methodology critique

_Agile-delivery lens (faffter-dark-methodology-agile-delivery)._

- **Right-sized?** Yes. One TypeScript command over existing primitives and one caller (graft Step 3); about 50 inventory rows, most of them carried unchanged.
- **Workstream fit?** The prose-to-code extraction lane (FAFF-1396, FAFF-1414, FAFF-1435, FAFF-1436).
- **Deps surfaced?** No blocker. [FAFF-1416](https://linear.app/shftwst/issue/FAFF-1416) (`faff pr open`, graft Step 9b) also edits `faff-graft/SKILL.md`, `SKILL_LINE_BASELINE`, `tsconfig.json`, the boundary-cast pin list, `regions.js`, `lint-cli-coverage.js`, `docs/guide/cli.md` and `build-manifest.json`; whichever lands second rebases those lines (mechanical, different steps). Step 3's mine-once paragraph names Step 9b's `pr_title` read; after this ticket the mine runs inside the command, and FAFF-1416 should not re-add it. [FAFF-1428](https://linear.app/shftwst/issue/FAFF-1428) (rule-inventory gate) is related; if it lands first, this PR satisfies it by construction.
- **Risk profile?** Moderate: it runs git operations that change worktrees. Every refusal keeps or tightens today's outcome, and the git steps are covered by real-repo tests.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```