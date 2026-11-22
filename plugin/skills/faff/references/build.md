# Faff gateway reference — build lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Implementor (innermost lane)

**Visibility:** Codebase (full read/write), spec, architectural context, test suite.
**Not concerned with:** Tracker state, project-level sequencing, stakeholder communication.

The most active lane, where development happens:
- Architectural planning, technical decision-making, and spec interpretation/implementation
- Code, tests, and documentation changes, with fix→review iteration loops

Faff-graft's build phase implements the spec, without managing the backlog or choosing the next work. **Context-hygiene delegation is a level-independent primitive:** at L1-assist / L2 / L3 / L4, a disposable **bare-executor** can take self-contained heavy work (build, repo exploration/grounding, large test runs) to reduce orchestrator context. This cost/context purpose is separate from parallelism and the `concurrency` slot's parallelism/worktree isolation. Give it only the spec, worktree path, definition-of-done and gate to run; it returns a compact diff or terminal token `{ issue, outcome, pr }` plus gate verdict. It loads no faff-skill context: no gateway, contracts or `faff-graft` SKILL.md.

The orchestrator retains process, gates and human interaction, reconciling returns against on-disk artifacts and git truth, never the transcript. The bare-executor schema, compaction cadence and isolation mechanics are documented here, not built here. Use **Sibling-skill invocation → Producer dispatch** for transport. L3/L4 concurrency executors and beep-boop's isolation floor are level-coupled instances of this rule.


### Issue claim & status monotonicity (multi-orchestrator safety)

Graft acquires `refs/faff/build-claims/<issue>` in the configured `bundle_store`. The default `local` shares that ref among linked worktrees of one Git repository. Independent clones have separate claims. With `git-remote`, clones sharing `origin` contend for one remote ref. Git-only uses the same store selection. Tracker status and the configured `claimed` role record progress.

- Read live status and eligibility labels together at admission. Follow `faff graft admit` for owned, peer-held, stale and missing refs. Skip completed or merged work. A `claimed-by-peer` refusal stays out of the autonomous ledger's `admitted` array. Interactive graft reports the refusal.
- Graft Step 5 owns acquisition and release. Run `faff build-claim acquire` before work, keep the acquired SHA, and confirm it immediately before the first worktree write or commit. A refused acquisition, unavailable store or superseded SHA stops the build. Release against that SHA. Git-only skips tracker writes.
- Read live status immediately before every status write. Advance through `Backlog < Todo < In Progress < In Review < Done`. Skip a forward move already reached. Only the following two paths can move `In Progress` back to `Todo`:
  - **Claim-holder hold.** On a pre-PR Step 9 `hold`, preserve the resumable checkpoints under `.faff/resume/<issue>/`, apply the returned awaiting-review or awaiting-adjudication role, release the holder's own claim and requeue. Use the Step 9 notice and disposition.
  - **Tidy stale-claim reclaim.** Require live `In Progress`, a `stale` verdict from `faff claim-verdict` using `claim_ttl_hours`, and the configured `claimed` label. Move to Todo, remove the label, attempt `faff build-claim release-if-stale` and post the reclaim comment. A live ref survives stale tracker age. Surface a human-set or unprovable stale claim for a human.

Leave `In Review` and `Done` intact on either requeue path.

### Worktree policy

**This section is the single canonical definition of how faff uses git worktrees.** `/faff-graft` owns the mechanism (`faff worktree ensure` runs `setup-worktree.sh`); `/faff-beep-boop` and the `concurrency` slot rely on the isolation guarantee. All three reference this section rather than restating it — any divergence is a bug.

- **Location: `~/.faff/worktrees/<repo>/<branch>` by default; override with the `worktree_root` config key (or the `FAFF_WORKTREE_ROOT` env var).** Worktrees live **entirely outside the repo directory** — so they never appear in `git status`, never get committed, and need no `.gitignore` — and a separate tree from the build is exactly what gives **holdout / evaluator work isolation** from the implementation (the L4 verification story). The home-dir default is writable both on a normal host and inside repo-only bind-mounts/containers (where the repo's *parent* often isn't writable, so a true sibling can't be created); it's namespaced by `<repo>` so multiple projects don't collide. A configured `worktree_root` is used as-is (it's per-repo, since the config is). One worktree per work unit (issue/branch). (`git worktree add` has **no** default checkout location — the path is always chosen by the caller; `.git/worktrees/` is git's own per-worktree *metadata* dir, not a checkout location, and a checkout placed there collides with it.)
  - *Caveat in ephemeral containers:* when the worktree root is container-local (not host-mounted) but the repo is, a destroyed container leaves the checkout gone while git's metadata (in the mounted `.git/worktrees/`) dangles — `faff worktree-prune` (below) clears it. This is housekeeping, never a queue-halt (see below).
  - **Prune is mechanically scoped — never repo-wide.** Bare `git worktree prune` removes every dangling entry in the shared clone and can wipe a concurrent peer's admin dir when its checkout briefly appears absent. Always use **`faff worktree-prune --issue <id>`** (or `--branch` / `--own <path>`, resolving via **Resolving the `faff` executable**). It removes only this run's own dangling dirs, protects live peers and skips unproven ownership fail-safe. `--selftest` exercises the classification table.
- **Branch.** Each worktree is a **new branch off `HEAD`**, named for the work unit (the issue id / slot name, `/`→`-`). Re-entering the same issue **reuses** its existing worktree (match on the issue id in the worktree path) — the spec commit and branch creation happen once; subsequent `/faff-graft` runs resume in place.
- **Provisioning** (performed by `setup-worktree.sh`, run by `faff worktree ensure` or a legacy `WorktreeCreate` hook): create the worktree + branch, copy gitignored local config into it (`.env*`, `.claude/settings.local.json`), then run the project's package-manager install / `setup` target. Skip the install with `SKIP_NPM_PACKAGES_INSTALL=1` — e.g. a Linux container with a macOS bind-mounted worktree, where installing would write platform-wrong binaries.
- **Per-issue isolation is the contract.** Every build — sequential or parallel — runs in its **own** worktree; two builds never share one. This is what makes the `faffter-dark-concurrency-parallel` executor safe to run independents concurrently. A build agent (Implementor lane) sees only its worktree.
- **Dirty worktree → park.** An unexpectedly dirty worktree is an autonomous park reason (see the Autonomous Mode Contract); a parked unit commits its WIP to its branch first (see the Park protocol).
- **Cleanup is post-merge housekeeping.** Removing a merged worktree (and its branch) is housekeeping that **never halts the queue** — if it fails (shell still inside it, permission error), skip + log + continue, and surface it under the run's _Human follow-ups_ (see the Autonomous Mode Contract → post-merge housekeeping).

