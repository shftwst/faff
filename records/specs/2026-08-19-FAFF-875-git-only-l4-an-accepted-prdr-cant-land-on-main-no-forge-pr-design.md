# FAFF-875 — `faff prdr land --local`: land an Accepted doc-only PRDR onto main in a no-remote repo

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high · build-tier: standard. Full spec on Linear FAFF-875.

## Why

In an L4 git-only run, a PRDR is authored (`Proposed`), ratified, and Accepted via `faff prdr accept`. That command commits the `Status: Accepted` flip onto a **doc-only** landing branch `prdr/NNNN-slug` (off the base branch) and switches back — so the accepted record lives only on that branch, never on `main` (`prdr.js:213-261`).

There is then **no decided path onto `main`** in git-only mode:

- git-only has no forge PR to merge, and
- `faff merge-gate --local` is build-shaped — it requires `--issue`/`--run-dir`, an AC checklist, a review verdict, and a fresh CI-equivalent gate ladder (`merge-gate.js:768-973`), none of which a doc-only record commit can satisfy.

So an Accepted PRDR is stranded on its branch and container coverage read from `main` reports uncovered (the observed 0/5 in `run-20260818-192940-lights-out`). This closes the git-only third step after author + ratify + accept — the direct successor to FAFF-463 (Done), which formalised `faff prdr accept` but assumed a forge PR + build-gated merge.

This spec is built on the human decision recorded on the ticket (2026-08-19): a **dedicated** `faff prdr land --local` path, not a `merge-gate --local` waiver and not a generic merge-gate bypass.

## What

Add a new PRDR subcommand: `faff prdr land --local <number> [--base <branch>] [--root <dir>] [--json]`.

It lands the Accepted, doc-only PRDR commit for `<number>` from its `prdr/NNNN-slug` branch onto the local base branch by a fast-forward-only advance, records the landing, and recomputes container coverage from the updated base. It is a sibling landing gate to `merge-gate --local` — narrower (doc-only, PRDR-shaped preconditions) and reusing the same ff-only base-advance primitive — never an overload of it.

## How

### D1 — A dedicated `land` action, never a merge-gate overload

**Chosen:** Implement `land` as one more `if (action === "land")` branch inside `cmdPrdr` (`prdr.js:307`, the flat action chain), plus `--local` (arity 0) added to `PRDR_SPEC.flags` (`prdr.js:20-31`) and a `land: { required_flags: ["--local"] }` entry in `PRDR_SURFACE.subcommands` (`prdr.js:39-51`). No `bin/faff` change is needed (`prdr` already maps to `cmdPrdr`); add the `land`/`--local` surface to the existing `prdr` row of `docs/guide/cli.md` (CI-lint-enforced by `faff lint-cli-doc`).

**Rationale:** `merge-gate --local`'s floor (AC + review verdict + CI-equivalent via `decideFloor`, `contract-defs.js:1958-1969`) is exactly right for a code merge and must stay unchanged. Waiving it for a doc-only branch would erode the code-merge floor for everyone; a separate command keeps the two floors independent. This settles the ticket's open question #1 (dedicated path, not a `merge-gate --local` doc-only waiver, not a generic bypass).

**Punt:** `--local` is the only supported mode in v1 (there is no remote/forge PRDR-landing path — a forge repo lands the accept branch via an ordinary PR). The flag is required so the command reads as deliberately git-only and leaves room for a future non-local mode without a breaking default.

### D2 — Availability gate: no-remote repo, Accepted-only, accept-branch-only

**Chosen:** Before any mutation, refuse (exit 2) unless **all** hold:

1. **No remote.** `gitRemoteEmpty(cwd) === true` (`merge-gate.js:726-735`). `null` (indeterminate) or a present remote → refuse with "repo has a remote (or its remote-state is indeterminate) — land an Accepted PRDR via the forge PR path", mirroring `merge-gate --local`'s first bypass-guard. Indeterminate fails toward "has a remote" (fail-closed).
2. **The record is Accepted.** The target PRDR's `Status` (read from the `prdr/NNNN-slug` branch tip) starts with `Accepted` (`/^Accepted/i`); a `Proposed`/`Rejected`/`Superseded` record → refuse. Accept is the sole writer of `Status: Accepted` (`prdr.js:250`), so this pins landing to a genuinely-ratified record.
3. **Created through `faff prdr accept`.** The landing branch resolves as `${prdr.accept_branch_prefix}${num}-${adrSlug(title)}` (default prefix `prdr/`, `config.js:129`; `prdr.js:232`). Refuse if that branch does not exist locally (`git show-ref --verify refs/heads/<landing>`), so `land` only ever advances a branch the accept gesture produced.

`gitRemoteEmpty` (the live git-remote axis) is the operative predicate. The tracker-pin axis (`classifyTracker`, `tracker.js`) is a config assertion about tracker availability, a different axis; v1 gates on the git-remote fact only (parity with `merge-gate --local`).

### D3 — Preconditions: clean base, ff-descendant, paths under the PRDR dir, candidate validation

**Chosen:** After the availability gate and before landing, assert (refuse, exit 1, on any failure):

1. **Clean base.** The base branch's working tree/index is clean where `land` will touch it — `git status --porcelain` on the worktree that holds `base` is empty (mirrors the peer-worktree dirty guard `merge-gate.js:941-951`). Refuse rather than clobber a dirty base.
2. **Fast-forward descendant.** The landing tip is a descendant of base: `git merge-base --is-ancestor <base> <landing>` holds (the ff-only ancestry check, `merge-gate.js:845`). If base moved so the tip is no longer a descendant → refuse "rebase the accept branch onto <base> first (ff-only)". Non-ff is out of scope.
3. **Path-segment-safe, wholly under the PRDR dir.** Enumerate the paths the land would introduce — the files touched by the accept commit(s) on `base..landing` (`git diff --name-only <base> <landing>`, argv-array, never a shell string). Assert **every** path is segment-anchored under the resolved PRDR directory: with `prefix = resolvePrdrDocsPath(...)` (trailing slash already stripped, `config.js:584`), a path `f` passes only when `f === prefix || f.startsWith(prefix + "/")`, and no path segment is `.`/`..`/empty. Follow the existing segment-anchored precedent `deriveAnchorDirs` (`governance-check.js:320-339`) rather than a naive prefix match. **Rationale (infosec):** `doc_only` containment is the sole guard against `land` moving `main` to an arbitrary tip; a bare `startsWith(prefix)` would admit siblings like `records/prdr-notes/evil.js` because the resolver strips the trailing slash. A segment-anchored pathspec pins it. Any path outside the PRDR dir → refuse "land refuses: <path> is outside the PRDR directory <prefix> (doc-only landing only)".
4. **Candidate validation.** Run the FAFF-463 validators against the candidate tree: `prdrValidate(dir)` (structural, `prdr.js:137-173`) plus `prdrGitTier(dir, root, cfg)` (git-awareness, `prdr.js:186-200`). Any FAIL → refuse and print it, exactly as `faff prdr validate` does (`prdr.js:343-351`).

### D4 — Atomic old-base-SHA advance; in-place ff when the invoking worktree holds base

**Chosen:** Extract the inline ff-only base-advance out of `cmdMergeGateLocal` into a reusable, exported helper `landBaseFfOnly({ cwd, base, tipSha, baseShaBefore })` and have **both** `cmdMergeGateLocal` and `prdr land` call it. This is a behaviour-preserving refactor of `merge-gate.js:896-968` (the "reuse the same ff-only machinery" seam the round-1 review correctly found does not yet exist). The helper reads `baseShaBefore` immediately before advancing and:

- **Case A — base checked out nowhere else:** `git update-ref refs/heads/<base> <tipSha> <baseShaBefore>`. The third `<old-value>` arg makes this an **atomic compare-and-swap** — git rejects it if `base` moved since `baseShaBefore` was read, so a concurrent advance aborts the land with no partial state (`merge-gate.js:960-968`).
- **Case B — base checked out in exactly one clean peer worktree:** `git -C <peer> merge --ff-only <landing>` (refuse if the peer is dirty or if >1 worktree holds base), so that worktree's index/working tree refresh (`merge-gate.js:937-957`).
- **Case C (net-new) — base checked out in the INVOKING worktree:** this is the ordinary git-only single-worktree PRDR flow (`faff prdr accept` switched you back to base). `merge-gate --local` deliberately *excludes* the invoking worktree (`merge-gate.js:916-928`), so `landBaseFfOnly` must add it: when the invoking worktree's HEAD is `base`, land via in-place `git -C <cwd> merge --ff-only <landing>` (refuse if the invoking worktree is dirty). A bare `update-ref` here would advance the ref while leaving the invoking worktree's index reflecting the old tree (phantom staged-deletes) — the in-place ff refreshes both.

**Rationale:** `update-ref --old-value` is the only base-SHA CAS in the codebase and is exactly the "advance the expected old base SHA atomically" the decision names; Case C is the seam merge-gate omits precisely because it never lands in its own worktree, whereas the PRDR flow normally does.

### D5 — Record the landing

**Chosen:** On a successful advance, persist a landing record and emit a JSON result on stdout: `{ prdr: <num>, file, base, old_base_sha: <baseShaBefore>, new_base_sha: <tipSha>, landed: true, coverage: <recomputed verdict> }`. Persist a `prdr-landing-<num>.json` of the same shape under the run dir when `--run-dir`/`--issue` are supplied (reusing the `writeMergeRecord` locus/shape where practical); otherwise the stdout JSON is the record. This is the auditable "record the landing" the decision requires.

**Punt:** The exact persisted-record path (run-dir artifact vs. a PRDR-adjacent note) is a small implementation choice; the stdout JSON is the load-bearing record and is always emitted.

### D6 — Recompute coverage from the updated base; base/main-only

**Chosen:** After the advance, recompute container coverage from the **updated base** and include it in the result. Reuse the existing coverage producer: build `livePrdrs` from the live (non-superseded) PRDR set read from the updated base tree and pass it through `computePrdCoverageVerdict({ prdGoals, livePrdrs })` (`contract-defs.js:1723-1755`) — the same computation `faff prdr coverage` runs (`prdr.js:503-546`), with `--prd-goals` an optional passthrough (default: read live PRDRs from the base tree, the static-coverage convenience).

Because coverage counts a goal as covered from **citation** by a live record present on the base tree — never from `Accepted` status (`contract-defs.js:1728-1738`) — an Accepted-but-**unmerged** PRDR (still only on its `prdr/NNNN` branch) is **not** counted; only landing it onto base makes it count. This settles the ticket's open question #2 (coverage stays base/main-only).

**Chosen (reader):** In the common Case C / peer-worktree flows the working tree ends up reflecting the new base, so `listPrdrs(dir)` reads the landed record directly. For Case A (`update-ref`-only, invoking worktree not on base) the working tree does **not** reflect the new base, so recompute must read the PRDR dir from the new base ref, not the stale working tree — enumerate the records at `new_base_sha` via a ref-pinned read (`git ls-tree`/`git show <new_base_sha>:<prdrDir>/...`, the ref-pinned read precedent at `merge-gate.js:312`, `landing-comment.js:124`). This keeps the recompute correct in every landing case.

### D7 — Generic `merge-gate --local` stays unchanged

**Chosen:** No change to `cmdMergeGateLocal`'s floor, its `decideFloor` inputs, or its no-CI-coverage leg (`contract-defs.js:1965`: `no-ci-coverage` + `no_ci_policy === "needs-human"` → block). The only merge-gate edit is the behaviour-preserving extraction of `landBaseFfOnly` (D4); `merge-gate --local`'s existing selftest and `test/merge-gate-local.test.mjs` must pass byte-for-byte in outcome.

**Assumes:**

- The git-only single-worktree L4 flow described in `prdr.js` `prdrAccept`: accept created `prdr/NNNN-slug` off the base and left the invoking worktree on the base branch. Multi-worktree layouts are handled by Cases A/B; a detached/anomalous layout refuses fail-closed.
- `gitRemoteEmpty` is the canonical "no-remote" predicate and treats an unreadable remote state as "has a remote" (fail-closed).
- The configured PRDR directory resolves via `resolvePrdrDocsPath` (here `records/prdr/`), trailing slash stripped, and holds only PRDR records (doc-only).
- Coverage's contract semantics (citation-based, status-blind) from FAFF-255/FAFF-815 are unchanged; `land` only changes *which tree* the recompute reads.

## Done — acceptance criteria

1. `faff prdr land --local <number>` exists and is registered in `PRDR_SURFACE.subcommands` + `docs/guide/cli.md` (`faff cli-surface --json` lists it; `faff lint-cli-doc` passes).
2. On a repo **with** a remote, or an indeterminate remote state, `land --local` refuses with exit 2 and directs to the forge PR path; it never advances base.
3. Landing a **non-Accepted** PRDR refuses; landing when the `prdr/NNNN-slug` accept branch is **absent** refuses.
4. Landing refuses (exit 1) when the accept branch is **not a fast-forward descendant** of base, when the **base is dirty**, or when **any** changed path in `base..landing` is **outside** the configured PRDR directory — including sibling-prefix escapes such as `records/prdr-notes/x.js` (segment-anchored check), and traversal segments (`.`/`..`).
5. Candidate validation (`prdrValidate` + `prdrGitTier`) runs and any FAIL blocks the land.
6. On success in a single-worktree git-only repo (invoking worktree on base): base fast-forwards to the accept-branch tip via in-place `git merge --ff-only`, the invoking working tree/index reflect the landed record, and the command emits `{ landed: true, old_base_sha, new_base_sha, coverage }` plus a persisted landing record.
7. A **concurrent base move** during the Case-A `update-ref` compare-and-swap aborts the land (no partial advance); the command refuses and reports the moved base.
8. Recomputed coverage read from the updated base reflects the just-landed PRDR; an Accepted-but-**unmerged** PRDR (not landed) is **not** counted (a `land`-then-`coverage` sequence moves the relevant goal from uncovered to covered, while `accept` alone does not).
9. `merge-gate --local`'s floor and no-CI behaviour are unchanged: its selftest and `test/merge-gate-local.test.mjs` pass with identical outcomes after the `landBaseFfOnly` extraction.
10. Tests cover the above: new cases in `test/prdr.test.mjs` (or a new `test/prdr-land-local.test.mjs`, reusing `test/merge-gate-local.test.mjs`'s no-remote `scaffoldRepo` fixture) and extended `prdrSelftest()` cases (`faff prdr --selftest` passes) exercising remote-present refusal, non-Accepted refusal, missing/non-ff branch refusal, path-escape refusal, happy-path ff advance + coverage recompute, and CAS-abort on a base move.

confidence: high
spec-review: approve

## Methodology critique

Agile-delivery lens (`faffter-dark-methodology-agile-delivery`, `issue-critique`):

- **Right-sized?** Yes — one cohesive 1–3 day unit: a new `prdr land --local` subcommand plus a behaviour-preserving `landBaseFfOnly` extraction it shares with `merge-gate --local`. The extraction and the new command are one always-ships-together concern (the command needs the seam), so no split.
- **Workstream fit?** Yes — sits squarely in the "Top of the loop" project as the git-only completion of the PRDR author→ratify→accept→**land** lifecycle FAFF-463 began.
- **Deps surfaced?** FAFF-463 (Done) is the load-bearing predecessor and is already linked (Relates to). No unlinked implicit dependency; the `merge-gate --local` machinery it reuses is in-repo.
- **Risk profile?** Low–moderate: the one real risk is the net-new Case C (advancing base in the invoking worktree) and the compare-and-swap atomicity — both are covered by dedicated ACs (#6, #7) and selftest cases, and the refactor is fenced by AC #9 (merge-gate outcomes byte-unchanged). No de-risking spike warranted.

_Autonomous prep: this critique is informational and does not gate promotion._
