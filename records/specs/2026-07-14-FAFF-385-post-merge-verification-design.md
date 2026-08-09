# FAFF-385 — Post-merge verification: detect a broken merge, park to human (no auto-revert)

> Spec: faffter-dark-nlspec · 2026-07-14 · interactive · confidence: high. Full spec on Linear FAFF-385.

**Revised on 2026-07-14 — replaces the 2026-07-06 attachment on this issue.** The human Resolution comment (2026-07-14) closed both of the ticket's open questions with answers that **change the mechanism** the earlier spec chose: the health signal moves from *observing existing push-to-main CI check-runs* to *re-running the project's own declared test command directly*, and the recovery path narrows from *opening a never-merged revert PR* to *a tracker comment + a discovered-scope entry, nothing else*. Auto-revert is no longer even a Channel-D relay in this ticket — it is a wholly separate follow-up. Everything below is written fresh against the resolved scope; nothing from the superseded spec is assumed to carry over.

This spec addresses FAFF-385, split seam (a) only. Audience: the build agent implementing it and human reviewers deciding the recovery-authority boundary.

## 1. WHY — Problem and Principles

**The load-bearing gap:** today "shipped" means "merged" — once `faff merge-gate` merges a PR, nothing re-checks the merged code, and `runcheck` certifies the run clean because clean means complete, not correct. A plausible-but-wrong PR auto-merged unattended is the critical review's project-killing scenario, and today it leaves no trace at all inside faff's own tooling.

**Resolved scope (human decision, 2026-07-14 — both of the ticket's open questions closed):**

- **Chosen:** verification only, no auto-revert. *Citing the Resolution:* "(a) post-merge verification only — detect + park-to-human. (b) auto-revert mechanics is carved out to a follow-up (`blockedBy` this ticket)... autonomously reverting merged `main` is a destructive-adjacent side-effect the hard floor parks anyway, so it needs its own careful design, not a rider on the verification slice."
- **Chosen:** "smoke" = re-run the project's own declared verification command against the merged `main` HEAD, resolving the runner **the same way `faff gates` already does** (the UNIT rung — `node --test` for this repo). *Citing the Resolution:* "resolve the project's test/verification runner the same way `faff gates` already does... A running-env probe (deployed-service canary) is out of scope for v1... Rationale: substrate-agnostic, reuses the existing runner resolver, and needs no deployed service." On failure → "park-to-human + a discovered-scope entry (mirrors the ci-red posture); never an auto-action in v1."

**Design principles:**

- **Reuse the one resolver, never a second one.** `plugin/skills/faff/bin/lib/gates.js`'s `discoverRungs`/`runLadder` is already the sanctioned, trusted-source-only (package.json / Makefile / pre-commit) test-command resolver faff-graft Step 7.5/Step 8 consume. This spec reuses it — filtered to the `UNIT` rung — rather than inventing a parallel detector.
- **The check's own failures are not load-bearing; a real failure is.** A genuine post-merge test failure must be loud (tracker comment + discovered-scope entry). An inability to obtain a verdict (no `UNIT` rung declared, execution/worktree error) degrades to a loud `unverified` annotation and the queue continues — a repo with no discovered test command must not park every merge.
- **No new merge or revert path.** This step never calls the forge's merge command, never runs a repository revert, never opens a PR. It only observes and annotates. `faff merge-gate` remains the sole sanctioned merge path (ADR-0043).
- **Status monotonicity holds.** The issue is already `Done` by the time this step runs (graft Step 10's `shipped` branch). A verification failure is recorded as a comment + a discovered-scope entry, never a status flip, never a re-open (mirrors the existing "a Done issue is never machine-reverted" rule).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/gates.js` (`discoverRungs` 107-123, `runRung` 128-143, `runLadder` 157-176, `gateKindForName` 30-38, `cmdGates` 183-218) | The UNIT-rung resolver this reuses verbatim — it must not be reinvented. |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`writeMergeRecord` 242-249, `mergeRecordPath` 229-231) | `faff merge-gate` already writes `<run-dir>/<issue>/merge-record.json` (`{pr, head_sha, merged, merged_at, integrity}`) on every merge-ok path (FAFF-397) — the authoritative merge sha this check reads, no second sha resolution. |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`CONTRACTS` object 1142-1386, `computeQualityGates`/`contractQualityGates` 165-201 as the pattern to clone) | Where the new `CONTRACTS["post-merge-verification"]` entry is registered. |
| `plugin/skills/faff/contracts/quality-gates.schema.json` + `plugin/skills/faff/contracts/README.md` | The schema-file convention (`plugin/skills/faff/contracts/<name>.schema.json`) this clones. |
| `plugin/skills/faff-graft/SKILL.md` Step 10 (heading 419; `shipped` arm 431 interactive / 538 autonomous mirror; ci-red 448/539; discovered-scope mechanism 403-417) | The hook point — insert between "merged/deployed" and "worktree eligible for cleanup," and the discovered-scope entry shape to extend. |
| `plugin/skills/faff-beep-boop/SKILL.md` (`review_adversarial_skipped` 304/318, `review_outage_pending` 319, discovered-scope filing 218-230) | The annotation-array precedent this mirrors, and the existing filer that will pick up the new discovered-scope entries. |
| `records/adr/0043-...` | Confirms `faff merge-gate` as the sole sanctioned merge path — this step never touches it. |

**Scope statement:** this is seam (a) of FAFF-385's split — detect + park-to-human only. Seam (b) (auto-revert mechanics) is out of scope and named as a follow-up below.

## 2. OUT OF SCOPE

- **Auto-revert (seam b).** Reverting or re-merging is not attempted, proposed, or scaffolded here. **Follow-up:** file a new ticket for auto-revert mechanics, `blockedBy` FAFF-385, once this ships (per the Resolution — not filed as part of this prep pass). It will need its own design against FAFF-325/326's unbuilt corrective-integrity chain and FAFF-37's recovery story.
- **Running-env probe / deployed-service canary.** Out of scope for v1 per the Resolution — deferred to the env-slot/holdout machinery (overlaps FAFF-12). Extension point: a future `post_merge.health_source` config key naming an alternative signal beyond "re-run the declared UNIT rung."
- **Observing existing CI check-runs on the merge sha.** This was the superseded 2026-07-06 spec's mechanism; the Resolution replaces it with a direct re-run of the declared command. Not carried forward.
- **FAFF-12's overlapping prose.** FAFF-12 (Lights-out CI & environments) names promotion/rollback territory that overlaps this ticket's boundary. Per the ticket body, trimming FAFF-12's prose to avoid double-coverage is a follow-up once this scopes up — not done in this pass.
- **Pre-merge CI triage.** Separate ticket, FAFF-391 (already `blockedBy` FAFF-385 in the tracker — building this clears that blocker).
- **FAFF-383's effects-ledger wiring.** Already shipped (Done, PR #333) — this spec does not depend on it and does not extend it, though a future health-input source could consume `faff effects check` escapes (named as an extension point, not built here).
- **Sentry predicate extension.** `DERAILMENT_SIGNALS` (ADR-0034 AC5) is a closed allowlist; extending it is separate sentry work. The per-issue artifact this spec writes is machine-readable input for a future predicate.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| merge sha | The commit `faff merge-gate` merged onto `main`, read from `merge-record.json`'s `head_sha` |
| UNIT rung | The single rung of kind `UNIT` that `discoverRungs` (`gates.js`) resolves for the repo — the project's own declared test/verification command |
| verification verdict | `verified-ok` \| `verified-fail` \| `unverified` — this check's outcome for one merged PR |

**Per-issue artifact** — written by the CLI into the run dir, read by the beep-boop orchestrator at reconciliation (same pattern as `merge-record.json` / `review-verdict.json`):

```
RECORD PostMergeVerification:               # <run-dir>/<ISSUE>/post-merge-verification.json
  issue: IssueId                            # immutable
  pr: Integer
  merge_sha: CommitSha                      # from merge-record.json, or --sha override
  verdict: ENUM verified-ok | verified-fail | unverified
  basis: String                             # e.g. "npm run test exit 0", "npm run test exit 1", "no UNIT rung discovered"
  command: String | null                    # the resolved UNIT-rung command actually run, null on unverified-by-no-rung
  discovered_scope_ref: String | null        # set on verified-fail once the discovered-scope entry is appended
  checked_at: Timestamp
```

**Ledger annotations** — additive top-level arrays on the beep-boop run ledger, mirroring `review_adversarial_skipped` / `review_outage_pending` (annotations, not buckets). The issue's `outcomes` entry stays `shipped`; `TERMINAL_STATES` (`runcheck.js:18`) is untouched.

```
post_merge_verification_failures:   [ { issue, pr, merge_sha, command } ]   # verified-fail
post_merge_verification_unverified: [ issue-id, ... ]                       # unverified
```

**CLI surface** (registered in the subcommand registry, ADR-0014; `docs/guide/cli.md` row required by the `lint-cli-doc` gate):

```
faff post-merge-check --issue ID --pr N --run-dir DIR [--sha SHA] [--json]
exit 0 verified-ok · 1 verified-fail · 2 fail-loud (bad inputs) · 3 unverified
```

Pure core `decidePostMergeVerification(extraction)` registered as `CONTRACTS["post-merge-verification"]`, with `plugin/skills/faff/contracts/post-merge-verification.schema.json`, rows in `test/golden/contracts/cases.json`, covered by the `validate.yml --selftest` step (mirrors `computeQualityGates`/`contractQualityGates`, `contract-defs.js:165-201`). The impure shell (in `gates.js` or a small sibling module) resolves the sha, checks out an ephemeral worktree, runs the rung, and writes the artifact; the CLI's own exit code is the mechanical signal graft branches on — no LLM judgement in the loop.

**Config** (`.faffrc`, read via `faff config get`):

```
post_merge.check: on | off           # default on; consulted in autonomous mode only
```

No `wait_seconds` knob is needed (unlike a CI-polling design) — the check runs the command directly and synchronously, bounded by the same 10-minute `spawnSync` timeout `runRung` (`gates.js:132`) already enforces on every gate rung.

**Discovered-scope entry extension.** The existing entry shape (`faff-graft/SKILL.md:403-417`, `source: "build"|"review"`) gains a third value, `source: "post-merge"`, for entries this check appends. The field is prose-defined, not schema-validated anywhere in the CLI (confirmed — no `EFFECT_KINDS`-style enum guards it), so this is a purely additive documentation change with no migration.

## 4. HOW — Behavior

**Architecture:** graft Step 10's `shipped` arm gains one inline step, between "merged/deployed" and "the worktree becomes eligible for cleanup" (interactive: `faff-graft/SKILL.md:431`; autonomous mirror: `:538`). The build subagent — still holding issue/pr/run-dir context — invokes the CLI directly; the CLI resolves, executes, decides, and persists the artifact; graft acts on the exit code inline (tracker comment + discovered-scope append on `verified-fail`); the orchestrator later reads the artifact at reconciliation and writes the ledger annotation authoritatively (never the subagent).

```
PROCEDURE post_merge_verify(issue, pr, run_dir, sha_override):   # graft Step 10, shipped arm, autonomous only
  1. merge_sha := sha_override OR read <run_dir>/<issue>/merge-record.json . head_sha
     (fail-loud, exit 2, if neither is available — this should never happen on a `shipped` path
      since `faff merge-gate` writes this record on every merge-ok call, FAFF-397)
  2. { rungs, discovery } := discoverRungs(repo_root)      # gates.js, UNCHANGED, reused verbatim
     unit_rung := rungs.find(r => r.kind === "UNIT")
     IF unit_rung is undefined:
        verdict := unverified; basis := "no UNIT rung discovered"; command := null
        GOTO step 5
  3. tmp := mkdtemp()
     TRY:
       git worktree add --detach <tmp> <merge_sha>       # exactly what's on main, isolated
       (best-effort `git fetch origin <merge_sha>` first if the sha isn't locally resolvable)
       result := runRung(unit_rung, tmp)                 # gates.js, UNCHANGED, reused verbatim
     FINALLY:
       git worktree remove --force <tmp>                  # ALWAYS, success or failure path
  4. Classify (pure core):
     a. result.status === "pass"                → verified-ok    (exit 0)
     b. result.status === "fail"                 → verified-fail  (exit 1)
     c. result.status === "errored" (incl. a worktree/fetch failure) → unverified (exit 3)
  5. Write post-merge-verification.json with verdict + basis + command + merge_sha
```

```
PROCEDURE on_verified_fail(issue, pr, merge_sha, command, basis):   # graft, after exit 1
  1. Tracker comment on the (already Done) shipped issue:
     "Post-merge verification failed on <merge_sha>: `<command>` — <basis tail, truncated>.
      This does not revert or reopen the issue; see the linked discovered-scope entry."
  2. Append a discovered-scope entry (source: "post-merge") to
     .faff/runs/<run-id>/<ISSUE-XX>/discovered-scope.json:
     { "title": "Fix regression: <command> fails on merged main (<short-sha>)",
       "description": "<basis>", "relationship": "none", "source": "post-merge",
       "source_ref": "post-merge-verification.json", "confidence": "concrete", "containment": null }
  3. Issue status stays Done (monotonicity); the comment + discovered-scope entry are the human surface
  4. Continue the queue — never halt, never prompt
```

**Edge cases and error handling:**

- Fallback precedence for the verdict: `verified-fail` (the rung actually failed) > `verified-ok` (it passed) > `unverified` (anything else — no rung, worktree/fetch/spawn error). Never guess ok.
- `unverified` (exit 3): log loudly, annotate, proceed to cleanup. Retryable by a human (`faff post-merge-check` is idempotent and re-runnable given `--sha`); terminal for the run.
- CLI exit 2 (fail-loud — no merge sha resolvable) seen by graft: treat as `unverified` for queue purposes; never blocks cleanup.
- Interactive mode: the step does not run at all — the human watches the build/tests natively (mirrors the container/branch-protection preflights' autonomous-only posture).
- Ephemeral worktree cleanup is unconditional (`FINALLY`) — a crash mid-run-ladder must not leave a stray `git worktree` entry; `git worktree remove --force` runs on every path including the errored one.

**Failure modes:**

- **The failure:** the repo has no declared `UNIT` rung (only lint/format declared) → chronic `unverified`, and the check silently stops meaning anything. **How you'd know:** `post_merge_verification_unverified` grows on every run. **What it means:** the repo needs to declare a test script the same way Step 7.5 already expects — this is a repo-hygiene gap, not a bug in the check.
- **The failure:** the UNIT rung is flaky (passes pre-merge, fails post-merge with no code change) → a spurious `verified-fail` + discovered-scope entry the human closes as noise. **How you'd know:** repeated `verified-fail` entries the human dismisses without a code change. **What it means:** proceed at v1 — this is the same tests-are-imperfect-signal risk every CI-based gate already carries; a re-run-once step is a named future refinement, not v1.
- **The failure:** the signal only measures the test suite, not correctness — a plausible-but-wrong PR with a green post-merge test suite still reads `verified-ok`. **How you'd know:** post-merge human-found regressions on `verified-ok` merges. **What it means:** expected; this closes the *observed* gap (nobody re-runs tests post-merge today), not the oracle gap (holdout/evaluator territory, L4).

**Anti-pattern:** treating `verified-fail` as grounds to revert, re-open the issue, or flip its status. Why: status monotonicity is a standing rule and auto-revert is explicitly out of scope (Section 2) — the comment + discovered-scope entry are the only sanctioned actions.

**Anti-pattern:** re-running the full gate ladder (format/lint/typecheck/static) post-merge. Why: those already gated pre-merge at Step 7.5 and in CI on the exact same merged diff; re-running them here answers a question already answered and burns the run's time budget for no new signal — only the `UNIT` rung is re-checked.

## 5. Scenarios

```
Given an autonomous run merged PR N for issue X (outcome shipped)
  and the repo declares a UNIT rung (e.g. `npm test` / `node --test`)
  and re-running that command against the merged main HEAD fails
When graft runs faff post-merge-check at Step 10's shipped arm
Then exit is 1, <run-dir>/X/post-merge-verification.json has verdict verified-fail,
  the shipped issue (still Done) gets a tracker comment naming the command + failure,
  .faff/runs/<run-id>/X/discovered-scope.json gains one entry with source "post-merge",
  the run ledger's post_merge_verification_failures contains {X, N, sha, command},
  no PR is opened, no revert happens, and the next queued issue is still dispatched
```

```
Given the same setup but the re-run passes
When the check runs
Then exit is 0, verdict verified-ok, no comment, no discovered-scope entry, cleanup proceeds
```

```
Given a repo with no declared UNIT rung (only a lint script)
When the check runs
Then exit is 3, verdict unverified, the ledger's post_merge_verification_unverified contains the issue,
  the run summary renders it under a distinct heading, and the queue continues
```

Assertions: the machine never merges, reverts, or reopens anything; `TERMINAL_STATES` is unchanged; a `verified-fail` run still audits `clean` under `runcheck` completeness while the failure is visible in the summary; the ephemeral worktree never survives the step.

## 6. DESIGN DECISION RATIONALE

**Scope — verification-only, or verification + auto-revert?** Closed by the human Resolution (2026-07-14): auto-revert is a destructive-adjacent side-effect the hard floor parks anyway, and needs its own design against the unbuilt FAFF-325/326 corrective-integrity chain. **Chosen:** verification-only; auto-revert is a named follow-up (Section 2), not built or scaffolded here.

**Health signal — re-run the declared UNIT rung, or observe existing push-to-main CI check-runs (the superseded spec's choice)?** Closed by the Resolution's Q2 answer: substrate-agnostic, reuses the existing `faff gates` resolver, needs no deployed service and no CI-provider API call at all. **Chosen:** re-run the `UNIT` rung via `discoverRungs`/`runRung` (`gates.js`), never the check-runs API.

**Which rung(s) to re-run — the full ladder, or `UNIT` only?** Format/lint/typecheck/static already gated the exact same merged diff pre-merge (Step 7.5 + CI); re-running them post-merge re-answers an already-answered question. **Chosen:** `UNIT` only — the correctness-facing rung "smoke" actually means per the Resolution.

**Execution target — the graft feature-branch worktree in place, or an ephemeral detached worktree at the merge sha?** The feature worktree may carry post-merge-irrelevant local state (a just-completed ADR renumbering commit, a stale checkout); "smoke = re-run against the merged `main` HEAD" needs exactly that commit, isolated. **Chosen:** an ephemeral `git worktree add --detach` at the merge sha, always removed in a `FINALLY`.

**Merge sha resolution — re-derive via a fresh PR-view call, or read the already-written `merge-record.json`?** `faff merge-gate` already writes `<run-dir>/<issue>/merge-record.json` (`head_sha`, FAFF-397) on every merge-ok path — the exact sha it just pinned via `--match-head-commit`. Re-deriving it would be a second, divergent observation of the same fact. **Chosen:** read `merge-record.json`; `--sha` stays as an explicit human-invoked override only.

**Hook point — graft Step 10 tail (`shipped` arm), the `ship` producer, or a beep-boop checkpoint?** The `ship` producer's contract is about the merge act, not post-merge facts; a beep-boop checkpoint runs after the subagent (and its pr/run-dir context) is gone. The Step 10 tail has the actor alive with full context, immediately after `shipped`. **Chosen:** inline in graft Step 10's `shipped` arm, before cleanup, autonomous-mode only (mirrors the container/branch-protection preflights — a human watches CI/tests natively in interactive mode).

**Recovery posture — mirror ci-red's park protocol literally (flip PR to draft), or a post-merge-specific action?** The PR is already merged and closed and the issue already `Done`, so there is no open PR to flip and status monotonicity forbids reopening. **Chosen:** a tracker comment (same "comment, never a status flip" choice the superseded spec already made) plus a discovered-scope entry (`source: "post-merge"`) that beep-boop's existing discovered-scope filer turns into a Backlog ticket — the same "surface concrete follow-up, never silently swallow it" shape ci-red uses, relocated to the one channel that still works once the merge is final.

**Ledger representation — a new terminal bucket, or additive annotation arrays?** A new bucket breaks the `runcheck` completeness invariant and forces a migration; `review_adversarial_skipped`/`review_outage_pending` are the shipped precedent for shipped-with-a-flag via additive top-level arrays fed from a per-issue artifact at orchestrator reconciliation. **Chosen:** `post_merge_verification_failures` + `post_merge_verification_unverified`; `outcomes` stays `shipped`.

**Contract surface — extend `delivery-outcome`, or a new contract?** `delivery-outcome` is the ship producer's claim about the merge act, already schema-validated; the verification verdict is a later, different fact from a different actor (a standalone CLI step, not the producer). **Chosen:** a new `CONTRACTS["post-merge-verification"]` + `post-merge-verification.schema.json`; `delivery-outcome` untouched.

**No-rung / error semantics — fail-closed, or loud `unverified`?** Fail-closed would park every merge in a repo with no declared `UNIT` rung, punishing exactly the repos that can least verify (mirrors `gates.js`'s own `discovery:none` fallback reasoning). **Chosen:** a distinct `unverified` verdict, its own exit code (3), its own ledger array and run-summary heading — loud, never blocking.

**Config surface — a `wait_seconds` polling knob (the superseded design), or none?** The check runs the command directly and synchronously rather than polling an external CI provider, so there is nothing to wait on beyond the rung's own execution — already bounded by `runRung`'s existing 10-minute `spawnSync` timeout. **Chosen:** a single `post_merge.check: on|off` knob; no polling knob.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — both of the ticket's original open questions (split seam? what does "smoke" mean?) are closed by the human Resolution comment (2026-07-14), recorded as `**Chosen:**` entries in Section 6 above, not as Punts.

**Assumptions:**

- **Assumes:** `<run-dir>/<issue>/merge-record.json` exists by the time this step runs. True on every `shipped` path — `faff merge-gate`'s `writeMergeRecord` (FAFF-397) writes it on every merge-ok call, and `shipped` is only returned after exactly that call succeeds. Validation: inspect one from a recent shipped run before building.
- **Assumes:** the merge sha is reachable from the graft worktree's git object store (or fetchable via a targeted `git fetch origin <merge_sha>`) so `git worktree add --detach` can resolve it. Validation: exercise the worktree-add step against a recent merge commit in this repo before building; a fetch/worktree-add failure classifies as `unverified` (Section 4), never a fail-closed park.
- **Assumes:** FAFF-365 (merge-gate post-merge partial-success re-check) and FAFF-383 (effects declare/observe at the merge chokepoint) are both already shipped and untouched by this spec — confirmed Done in the already-shipped scan below. This spec adds a sibling CLI subcommand + graft prose only; no edits to `merge-gate.js`'s existing functions or to the effects-declare call site.

## 8. DONE — Definition of Done

### From WHY
- [ ] An autonomously merged PR whose merged main HEAD fails its own declared `UNIT` rung is no longer silent — a tracker comment + a discovered-scope entry exist, and a human can see it via `/faff-wtf`.

### From WHAT
- [ ] `faff post-merge-check` exists with the specified flags and exit codes 0/1/2/3
- [ ] Reuses `discoverRungs`/`runRung` (`gates.js`) filtered to the `UNIT` rung — no second, divergent test-command resolver
- [ ] `decidePostMergeVerification` is a pure core registered as `CONTRACTS["post-merge-verification"]`, with `plugin/skills/faff/contracts/post-merge-verification.schema.json`, cases in `test/golden/contracts/cases.json`, and `--selftest` coverage green in `validate.yml`
- [ ] `<run-dir>/<issue>/post-merge-verification.json` matches the `PostMergeVerification` record (verdict, basis, command, merge_sha)
- [ ] Ledger gains additive `post_merge_verification_failures` / `post_merge_verification_unverified` arrays; `TERMINAL_STATES` unchanged; `runcheck` audits a `verified-fail` run as complete
- [ ] `post_merge.check` (default on) resolves via `faff config get`
- [ ] `docs/guide/cli.md` gains the subcommand row (`lint-cli-doc` gate green)
- [ ] `faff-graft/SKILL.md`'s discovered-scope entry prose documents the new `source: "post-merge"` value

### From HOW
- [ ] graft Step 10's `shipped` arm invokes the check (both the interactive narrated bullet at ~line 431 and the autonomous mirror at ~line 538), after `shipped`, before worktree cleanup; interactive mode skips it entirely
- [ ] `verified-fail` → tracker comment on the (already Done) shipped issue naming the failing command, plus a `discovered-scope.json` entry (`source: "post-merge"`); no PR opened, no revert, no status flip
- [ ] `unverified` (no `UNIT` rung, or worktree/fetch/execution error) degrades to a loud annotation + proceeds; never blocks cleanup or the queue
- [ ] the ephemeral detached worktree is always removed (success or failure path) — verified via `git worktree list` before/after in the integration smoke test
- [ ] beep-boop orchestrator populates the two annotation arrays from the per-issue artifact at reconciliation (subagent never writes the ledger) and the run summary renders distinct "post-merge verification failed" / "unverified" sections
- [ ] no code path merges or reverts anything — grep confirms no new forge-merge / repository-revert call sites

**Integration smoke test:**

```
1. In a run-dir fixture, place a merge-record.json for issue X (pr N, head_sha = a commit
   in this repo whose test suite currently fails, e.g. a fixture with a failing node --test case)
2. Run: faff post-merge-check --issue X --pr N --run-dir DIR --json
3. Assert exit 1, artifact verdict == verified-fail, a discovered-scope entry was appended,
   and `git worktree list` shows no leftover entry
4. Re-run against a merge-record.json pointing at a green commit → exit 0, verdict verified-ok
5. Run against a fixture repo with no declared UNIT rung (lint script only) → exit 3, verdict unverified
```

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen","section":"WHY — Resolved scope","text":"verification only, no auto-revert; citing the human Resolution 2026-07-14"},{"marker":"chosen","section":"WHY — Resolved scope","text":"smoke = re-run the declared UNIT rung via the faff gates resolver, not a CI check-runs observation"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"UNIT rung only, not the full gate ladder"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"execution target: ephemeral detached worktree at the merge sha"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"merge sha resolution: read merge-record.json, not a fresh PR-view call"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"hook point: graft Step 10 shipped arm, autonomous-only"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"recovery posture: tracker comment + discovered-scope entry, never a status flip or PR"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"ledger representation: additive annotation arrays, mirroring review_adversarial_skipped"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"contract surface: new CONTRACTS[post-merge-verification], delivery-outcome untouched"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"no-rung semantics: loud unverified, never fail-closed"},{"marker":"chosen","section":"DESIGN DECISION RATIONALE","text":"config surface: single post_merge.check on/off knob, no polling knob"}]}
```
