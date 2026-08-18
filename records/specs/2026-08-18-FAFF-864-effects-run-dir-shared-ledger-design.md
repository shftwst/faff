# FAFF-864: Land the effects declaration into the same ledger the merge observes

> Spec: faffter-dark-nlspec · 2026-08-18 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-864.

_Revised 2026-08-18 after spec review (verdict: revise) — added the builder note on dropping `--run` from `required_flags` (the XOR mechanism, not just its behaviour), flagged the intentional divergence from `verify`'s precedence resolution, noted `check --run-dir` is a secondary confirmation, and added three test cases (trailing-slash `--run-dir`, `check` with no ledger yet, a `--run` no-regression assertion)._

This spec is for the build agent implementing FAFF-864, and for the human and spec-review reviewers gating it. It fixes a defect in the FAFF-860 landing comment: the two commands it emits for a human to copy-paste write to two different effects ledgers, so the merge is recorded as an escaped side-effect even when the human follows the instructions exactly. The change is small and lives in two files.

## 1. WHY

The load-bearing idea: an effects ledger is a single append-only file at a fixed path, `<dir>/declared-effects.jsonl`, and coverage is computed within one file. A step declares the effect it is about to cause; the mechanical actor observes the effect once it happens; `faff effects check` subtracts observed from declared and flags anything observed without a matching declaration as an escaped side-effect. Declaration and observation only cancel out when they land in the same file. If the declare writes to one directory and the observe writes to another, the observe looks orphaned and the merge reads as an escape, which is exactly the condition the ledger exists to catch (FAFF-673, orphaned merge evidence).

**Problem statement.** The FAFF-860 landing comment (shipped in PR #699) prints a two-command block for a human to run on a green build-complete PR: `faff effects declare --run <run> …` followed by `faff merge-gate --run-dir .faff/anchors/<run> … --execute`. The declare resolves its ledger through `resolveRunDir(root, run)` to `.faff/runs/<run>/declared-effects.jsonl` (the live run dir), while merge-gate reads and writes coverage at its `--run-dir` value, `.faff/anchors/<run>/declared-effects.jsonl` (the committed anchor dir). The declaration therefore never covers the merge, and merge-gate prints "observed merge pr:N with no covering declaration … this will read as an escaped side-effect", defeating the comment's own stated purpose of landing with a full audit trail.

**Design principles.**

**Coverage is per directory, and the two commands must name the same directory.** Any fix must make the declare and the merge-gate observe resolve to one ledger path. A fix that leaves them pointing at different directories has not fixed the bug, however tidy it looks.

**The anchor is the only ledger a fresh checkout has.** On a machine that never ran the build, `.faff/runs/` does not exist: `.gitignore` ignores `.faff/*` and carves back only `!.faff/anchors/`, so the committed anchor dir is present at the PR head and the live run dir is not. Landing from such a checkout is the whole point of FAFF-860. The shared ledger must therefore be the anchor dir, never the live run dir.

**FAFF-860's floor-from-anchor design and its no-merge invariant stay untouched.** merge-gate reads its floor artifacts (ac-checklist, review-verdict, holdout, run-ledger) from `--run-dir` precisely because the anchor is what a fresh checkout has; landing-comment.js never merges. Neither behaviour changes here.

**Reference context.**

| File | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | The `faff effects` verb: `declare` / `observe` / `check` / `verify` handlers and the `appendEffectEntries` ledger-append core. This is where `--run-dir` gains meaning for declare/observe/check. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | `warnUncoveredMergeObserves` and `observeMergeEffects` read and append coverage at the `--run-dir` value. Unchanged by this ticket; documented so the build agent does not touch it. |
| `plugin/skills/faff/bin/lib/landing-comment.js` | `renderBody` emits the two-command block. The emit-side fix and its selftest live here. |
| `plugin/skills/faff/bin/lib/shared-infra.js` | `resolveRunDir(root, run, rootExplicit)` maps `--run <run>` to `.faff/runs/<run>`. The reason declare lands in the wrong dir today. |

**Scope.** This is a coherence fix between the effects verb's ledger resolution and the landing comment's emitted commands. It touches the `faff effects` CLI surface and one rendered string; it does not change how effects coverage is computed, hashed, or consumed.

## 2. OUT OF SCOPE

- **The non-graft landing path.** `renderBody`'s non-graft branch prints a `faff effects declare --run <run>` line with a literal `<run>` placeholder and a `--human-override` merge-gate line that carries no `--run-dir` at all. A non-graft change has no committed anchor, so there is no anchor dir to share; the human lands it against their own live run in a real terminal. Nothing in that branch is changed. Extension point: `renderBody` in `landing-comment.js`, the `kind === "non-graft"` branch.
- **merge-gate's ledger read/write.** `observeMergeEffects` and `warnUncoveredMergeObserves` already resolve coverage from `--run-dir` (the anchor). They are correct; the mismatch is entirely on the declare side. Extension point: `merge-gate.js` lines 655 to 690.
- **The coverage algorithm.** `computeEscapes`, `effectTargetMatches`, the schema-2 prev-chain, and `appendEffectEntries` are unchanged. The fix only changes which directory the declare resolves to, not what happens once records are in it.
- **The live-run-dir declare path.** `faff effects declare --run <run>` keeps resolving through `resolveRunDir` exactly as today, for every existing caller (graft Step 10 on the build machine). `--run-dir` is added alongside it, not in place of it.

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| Live run dir | `.faff/runs/<run>/`, created when a run is initialised. Gitignored, so absent on a fresh checkout. |
| Anchor dir | `.faff/anchors/<run>/`, the committed per-PR floor. Present at the PR head on any checkout. Its run-level directory is what merge-gate reads via `--run-dir`. |
| Ledger | `<dir>/declared-effects.jsonl`, the append-only, prev-chained record of declared and observed effects for a run. |

**The `faff effects` flag surface.** `--run-dir` is already a registered flag on `EFFECTS_SPEC.flags` (effects.js line 40, arity 1) and is already accepted by `verify` (line 615). Today `declare` / `observe` / `check` ignore it and resolve only from `--run`. The change teaches those three subcommands to accept `--run-dir` as an alternative to `--run`.

```
SUBCOMMAND effects declare | observe:
  # today: required_flags = ["--run", "--issue", "--step"]
  # after: required_flags = ["--issue", "--step"]; exactly one of --run / --run-dir
  --issue    : required
  --step     : required
  one_of     : --run <id>  XOR  --run-dir <dir>

SUBCOMMAND effects check:
  # today: required_flags = ["--run"]
  # after: required_flags = []; exactly one of --run / --run-dir
  --issue    : optional (narrows the escape scope, unchanged)
  one_of     : --run <id>  XOR  --run-dir <dir>
```

**Builder note — the mechanism, not just the behaviour.** Today `declare` / `observe` / `check` list `--run` in `required_flags` (`EFFECTS_SURFACE`, effects.js lines 47 to 50), and `requireFlags` runs *before* any handler logic (lines 548, 585). If those `--run` entries are left in place, a `--run-dir`-only invocation exits 2 on "missing --run" before the handler ever sees the flag — silently defeating this whole fix. So the build must mirror exactly what `verify` already does: **drop `--run` from `required_flags` for these three subcommands (set it to the `--issue`/`--step`-only set, or `[]` for `check`) and enforce the `--run` XOR `--run-dir` choice in the handler** (effects.js line 49 is the template comment; the `verify` handler at lines 621 to 624 is the working example). The required-flags declaration and the in-handler check are the two halves; changing only the second is the trap.

**One deliberate divergence from `verify`.** `verify` resolves the same flag pair by *precedence* (effects.js line 621: `runDirArg !== null ? runDirArg : …`, with no both/neither error). declare / observe / check add a *stricter* rule: passing both `--run` and `--run-dir` is a caller error and exits 2; passing neither exits 2. This is an intentional divergence, not an inconsistency to smooth over — a write path that records a merge for the audit trail must never silently pick one of two conflicting directories the caller named (see section 6). Leave `verify`'s read-only precedence as-is; do not retrofit the XOR onto it in this ticket.

**Ledger directory resolution.** For declare / observe / check, the resolved directory becomes:

```
IF --run-dir given:   dir = <the --run-dir value, verbatim>
ELSE:                 dir = resolveRunDir(root, run, rootExplicit)   # unchanged
```

`appendEffectEntries` derives `run_id` from `path.basename(dir)` (effects.js line 515) and the chain genesis hashes that basename (events.js line 404). Because `.faff/anchors/<run>` and `.faff/runs/<run>` share the basename `<run>`, the stored `run_id` and the genesis hash are byte-identical whichever flag was used, so a `--run-dir`-resolved ledger is indistinguishable in shape from a `--run`-resolved one.

**The run-dir must already exist (no create-if-missing).** declare / observe keep the existing precheck (effects.js lines 556 to 559): if the resolved dir is absent or not a directory, exit 3 with "run dir missing … initialise the run first". On the fresh-checkout land path the anchor dir is committed and present, so the precheck passes. Keeping the precheck for `--run-dir` means a genuinely missing anchor fails loudly instead of silently minting a ledger under a mistyped path.

**Design decisions.**

**Chosen: direction A, teach declare/observe/check to accept `--run-dir`, and point the landing comment's declare line at the anchor.** Rationale in section 6.

**Chosen: `--run` and `--run-dir` are mutually exclusive (exit 2 if both, exit 2 if neither).** Two conflicting directory sources is a caller bug; resolving it silently to one would hide a mistake in a security-adjacent path.

**Chosen: `observe` gains `--run-dir` alongside `declare`.** They share one handler branch (`cmd === "declare" || cmd === "observe"`), so the flag arrives for both at no extra cost, and the CLI stays symmetric. merge-gate writes its own observe through `appendEffectEntries` directly and does not go through this verb, so this is for CLI callers and for keeping declare/observe consistent, not for the landing flow itself.

**Chosen: `check` gains `--run-dir` too.** Without it, a human on a fresh checkout who runs `faff effects check --run <run>` reads an absent `.faff/runs/<run>` ledger and gets a false "no escape" clean result. The self-verification command must read the anchor: `faff effects check --run-dir .faff/anchors/<run> --issue <ISSUE>`. This `check` is a **secondary** confirmation, not the coverage guarantee: a typo'd `--run-dir` reads an absent ledger as clean (the same tolerant behaviour `--run` has today), so what actually binds coverage to the right anchor is the merge-gate step observing into the same dir the declare wrote — `check` only lets a human eyeball the result afterwards.

## 4. HOW

**The emit-side fix.** In `landing-comment.js`, `renderBody`'s `verdict === "merge-ok"` branch changes one line: the declare command points at the anchor dir instead of the live run.

```
# today (merge-ok branch):
    faff effects declare --run ${run} --issue ${issue} --step merge <<'EOF'
    [{"kind":"merge","target":"pr:${pr}","reversible":true}]
    EOF
    faff merge-gate --pr ${pr} --issue ${issue} --run-dir .faff/anchors/${run} --level ${level} \
      --execute --merge-args "--squash --delete-branch"

# after: the declare names the SAME directory merge-gate reads
    faff effects declare --run-dir .faff/anchors/${run} --issue ${issue} --step merge <<'EOF'
    [{"kind":"merge","target":"pr:${pr}","reversible":true}]
    EOF
    faff merge-gate --pr ${pr} --issue ${issue} --run-dir .faff/anchors/${run} --level ${level} \
      --execute --merge-args "--squash --delete-branch"
```

The single-line region banner at the top of `landing-comment.js` stays single-line (it must pass `faff regions check`).

**End-to-end path once both sides land.**

```
PROCEDURE land_from_landing_comment(pr, issue, run, level):
  1. declare: faff effects declare --run-dir .faff/anchors/<run> --issue <issue> --step merge
     a. handler resolves dir = .faff/anchors/<run> (verbatim, --run-dir branch)
     b. precheck: dir exists (committed anchor) => pass
     c. appendEffectEntries writes seq0 declare{merge, pr:<pr>} to
        .faff/anchors/<run>/declared-effects.jsonl, prev = genesis hash(run)
  2. merge-gate: faff merge-gate --pr <pr> --issue <issue> --run-dir .faff/anchors/<run> --execute
     a. reads floor artifacts from .faff/anchors/<run> (unchanged)
     b. after a confirmed merge, observeMergeEffects(.faff/anchors/<run>, issue, [merge pr:<pr>])
        i.  warnUncoveredMergeObserves reads the SAME ledger, finds the seq0 declare
            covering merge pr:<pr> => NO warning
        ii. appendEffectEntries writes seq1 observe to the same file, prev = hash(seq0)
  3. verify: faff effects check --run-dir .faff/anchors/<run> --issue <issue>
     a. reads the ledger with declare seq0 + observe seq1
     b. computeEscapes: observed merge is covered => any_escape: false
```

**Behaviour summary.** After the fix, the declare and the observe append to one file in seq order (declare seq0, observe seq1), the prev-chain is contiguous, and coverage holds. No "escaped side-effect" warning is printed on either the fresh-checkout or the same-machine path.

**Handler resolution, precisely.**

```
PROCEDURE resolve_effects_dir(cmd, root, run, runDirArg, rootExplicit):
  IF runDirArg != null AND run != null:
     stderr "one of --run or --run-dir, not both"; EXIT 2
  IF runDirArg == null AND run == null:
     stderr "one of --run <id> or --run-dir <dir> is required"; EXIT 2
  IF runDirArg != null:
     dir = runDirArg
  ELSE:
     dir = resolveRunDir(root, run, rootExplicit)
  # declare/observe only: keep the existing existence precheck
  IF cmd in {declare, observe} AND (not exists(dir) OR not isDirectory(dir)):
     stderr "faff effects <cmd>: run dir missing (<dir>) — initialise the run first"; EXIT 3
  RETURN dir
```

**Edge cases.**

- **Anchor dir genuinely absent** (mistyped path, or a diff with no committed anchor reaching this branch): declare exits 3, no ledger written. This is the intended fail-loud, not a create-if-missing.
- **Re-running the block on an already-merged PR:** the declare appends a second declare record (a duplicate); merge-gate takes its already-merged reconcile path and still appends an observe. `computeEscapes` matches observed against any covering declare, so duplicates never manufacture an escape. Safe to re-run.
- **`check` against a fresh checkout with no ledger yet:** an absent `declared-effects.jsonl` reads as clean (`any_escape: false`), the existing tolerant behaviour (effects.js line 594). This is correct before any declare has run.
- **Both `--run` and `--run-dir` on `check`:** exit 2, same rule as declare/observe.

**Anti-pattern:** creating the anchor dir on demand when declare's `--run-dir` target is missing. Why: it would paper over a mistyped path or an anchor that never got committed, minting an orphan ledger nobody reads and masking the real fault. Keep the exit-3 precheck.

**Anti-pattern:** splitting merge-gate so the floor comes from `--run-dir` (anchor) and the effects ledger from the live run dir. Why: this is candidate B, and it reintroduces the fresh-checkout failure the anchor design exists to avoid (see section 6).

## 5. Scenarios

```
Scenario: fresh checkout lands clean with full coverage
Given a machine that never ran the build, checked out at a green build-complete PR head
  And .faff/runs/<run> does not exist but .faff/anchors/<run> is present and committed
When the human runs the landing comment's emitted declare then merge-gate --execute block
Then the declare succeeds (exit 0) writing seq0 to .faff/anchors/<run>/declared-effects.jsonl
  And merge-gate prints no "escaped side-effect" warning
  And the merge observe is written as seq1 to the same ledger with a contiguous prev-chain
```

```
Scenario: same machine as the build still lands clean
Given a machine where .faff/runs/<run> also exists from the build
When the human runs the emitted declare then merge-gate --execute block
Then both the declare and the merge observe land in .faff/anchors/<run>/declared-effects.jsonl
  And no split ledger is produced and no uncovered-observe warning is printed
```

```
Scenario: a human self-verifies coverage after landing
Given a completed landing-comment-driven merge on a fresh checkout
When the human runs: faff effects check --run-dir .faff/anchors/<run> --issue <ISSUE>
Then it reports no escape (any_escape: false)
```

```
Scenario: conflicting directory sources are rejected
Given a caller passes both --run <id> and --run-dir <dir> to effects declare
When the command runs
Then it exits 2 with a one-of-not-both error and writes nothing
```

- The FAFF-860 no-merge invariant holds: `landing-comment.js` still invokes neither the merge verb nor `gh pr merge` on any path.
- The floor-from-anchor read in merge-gate is unchanged: it still reads ac-checklist, review-verdict, holdout, and run-ledger from `--run-dir`.

## 6. Design decision rationale

**Which side of the mismatch do we fix, and how?**

- **Candidate A (chosen): teach declare/observe/check to accept `--run-dir`, and point the landing comment's declare line at the anchor.** Pros: smallest change; `--run-dir` is already a registered flag and `verify` already honours it, so the surface is consistent rather than newly invented; the declare and the observe share one ledger by construction; works identically on a fresh checkout and on the build machine because the anchor is present in both. Cons: adds an either-or flag rule to three subcommands. **Chosen:** candidate A.
- **Candidate B (rejected): split merge-gate so the floor reads from `--run-dir` (anchor) but the effects ledger resolves to the live run dir.** This reintroduces symptom 1: on a fresh checkout `.faff/runs/<run>` does not exist, so the ledger write has nowhere to go and the declare cannot succeed. It also spreads one run's evidence across two directories by design, the opposite of what coverage needs. Rejected.

**Should `--run` and `--run-dir` be mutually exclusive?** Options: last-one-wins, `--run-dir` precedence, or hard error. A silent precedence would let a caller who typed both proceed against a directory they did not mean, in a path whose entire job is a truthful audit trail. **Chosen:** hard error (exit 2) when both are present, and when neither is.

**Should the fix create the anchor dir if it is missing?** Options: create-if-missing, or keep the exit-3 precheck. Create-if-missing would hide a mistyped path or an uncommitted anchor behind a freshly minted orphan ledger. **Chosen:** keep the existing exit-3 precheck; a missing anchor is a loud failure.

**Should `check` also gain `--run-dir`?** Without it the acceptance command `faff effects check --run <run>` reads an absent live-run ledger on a fresh checkout and returns a false clean. **Chosen:** add `--run-dir` to `check`, so the post-land verification reads the anchor.

**Should the landing comment also print the verification command?** It would close the loop for the human, but it adds a line to a comment whose brevity is deliberate, and CI could run the check instead of the human. **Punt:** whether to emit a `faff effects check --run-dir …` line in the merge-ok comment, or leave verification to CI / the human's discretion (decides: product).

## 7. Open questions and assumptions

**Open questions.**

- **Punt:** Whether the merge-ok landing comment should also print `faff effects check --run-dir .faff/anchors/<run> --issue <ISSUE>` as a self-verification line, or leave that to CI. The coverage fix does not depend on this; it is comment-copy polish. (decides: product.)

**Assumptions.**

- **Assumes:** The run-level anchor directory `.faff/anchors/<run>/` is present on the PR-head checkout at land time. Validation: it is committed by the graft flow (the FAFF-860 anchor commit) and `.gitignore` carves it back in via `!.faff/anchors/`; the build agent can confirm with `git show <headRef>:.faff/anchors/<run>/<issue>/run-ledger.json`, the same byte-copy `resolveLevel` already reads.
- **Assumes:** `path.basename(".faff/anchors/<run>")` equals `<run>`, so the stored `run_id` and chain genesis match a `--run`-resolved ledger. Validation: confirmed against `appendEffectEntries` (effects.js line 515) and `appendRecordsUnderLock` (events.js line 404); the build agent should keep this true by not appending a trailing slash to the emitted `--run-dir` value.

## 8. DONE

### From WHAT (flag surface)
- [ ] `effects declare` and `effects observe` accept `--run-dir <dir>` and resolve the ledger dir to it verbatim; with `--run <id>` they still resolve through `resolveRunDir` unchanged.
- [ ] `effects check` accepts `--run-dir <dir>` and reads `<dir>/declared-effects.jsonl`; `--issue` still narrows the escape scope.
- [ ] declare / observe / check exit 2 when both `--run` and `--run-dir` are passed, and exit 2 when neither is passed.
- [ ] declare / observe keep the exit-3 precheck: a missing or non-directory `--run-dir` target writes nothing and exits 3.

### From WHAT (ledger identity)
- [ ] A ledger written via `--run-dir .faff/anchors/<run>` carries `run_id == <run>` and a genesis prev equal to a `--run <run>`-resolved ledger's (identical basename), verified by `faff effects verify --run-dir .faff/anchors/<run>` reporting `verified`.

### From HOW (emit side)
- [ ] `renderBody`'s merge-ok branch emits `faff effects declare --run-dir .faff/anchors/${run} …` (not `--run ${run}`), and its merge-gate line still carries `--run-dir .faff/anchors/${run}`.
- [ ] The non-graft branch is unchanged: its declare keeps the `--run <run>` placeholder and its merge-gate line carries no `--run-dir`.
- [ ] The `landing-comment.js` region banner remains a single line and `faff regions check` passes.

### From HOW (behaviour)
- [ ] On a fresh checkout with only the committed anchor present, the emitted declare then merge-gate `--execute` block runs clean: declare exits 0, merge-gate prints no "escaped side-effect" warning, and the ledger holds declare seq0 then observe seq1 in `.faff/anchors/<run>/declared-effects.jsonl`.
- [ ] After that merge, `faff effects check --run-dir .faff/anchors/<run> --issue <ISSUE>` reports `any_escape: false`.
- [ ] Re-running the emitted block on an already-merged PR produces no escape signal.

### From tests
- [ ] `landingCommentSelftest` gains a case asserting the merge-ok declare line contains `--run-dir .faff/anchors/run-abc` and does not contain `--run run-abc`.
- [ ] `effectsSelftest` (or a `test/effects*.test.mjs` case) covers declare-then-check against a `--run-dir` anchor dir with no live run dir present, asserting a covered merge and `any_escape: false`, plus the both-flags-exit-2 and neither-flag-exit-2 rejections.
- [ ] An integration test exercises the fresh-checkout declare + merge-gate-against-an-anchor-dir path end to end (anchor dir present, live run dir absent) and asserts no uncovered-observe warning and a single contiguous ledger.
- [ ] A trailing-slash `--run-dir` (e.g. `.faff/anchors/run-1/`) resolves to the same `run_id`/genesis as the no-slash form — `path.basename` strips the slash, but the identity is load-bearing so it gets a cheap regression assertion.
- [ ] `effects check --run-dir <dir>` against a valid, existing dir with no `declared-effects.jsonl` yet reads clean (`any_escape: false`) — the tolerant no-ledger case, distinct from a missing dir.
- [ ] A `--run` happy-path assertion (declare/observe/check via `--run <id>` against a live `.faff/runs/<id>`) proves the existing callers are unregressed, rather than leaning on the integration test to catch it.

### Integration smoke test

```
PROCEDURE smoke():
  1. mkdir a temp repo dir; create .faff/anchors/run-1/ (anchor present)
     and DO NOT create .faff/runs/run-1 (fresh-checkout shape)
  2. run: faff effects declare --run-dir .faff/anchors/run-1 --issue FAFF-864 --step merge
          <<< [{"kind":"merge","target":"pr:42","reversible":true}]
     ASSERT exit 0 and .faff/anchors/run-1/declared-effects.jsonl has one declare (seq 0)
  3. append an observe directly via the same core (stand in for merge-gate):
     faff effects observe --run-dir .faff/anchors/run-1 --issue FAFF-864 --step merge
          <<< [{"kind":"merge","target":"pr:42","reversible":true}]
     ASSERT exit 0 and the ledger now has observe seq 1 with prev == hash(seq0 line)
  4. run: faff effects check --run-dir .faff/anchors/run-1 --issue FAFF-864 --json
     ASSERT any_escape == false
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen", "text": "Candidate A: teach effects declare/observe/check to accept --run-dir and point the landing comment's declare line at the anchor dir." },
    { "marker": "chosen", "text": "--run and --run-dir are mutually exclusive: exit 2 when both are present and exit 2 when neither is." },
    { "marker": "chosen", "text": "observe gains --run-dir alongside declare (shared handler branch)." },
    { "marker": "chosen", "text": "check gains --run-dir so post-land self-verification reads the anchor ledger, not the absent live-run ledger." },
    { "marker": "chosen", "text": "Keep the existing exit-3 precheck for declare/observe; no create-if-missing for a missing --run-dir target." },
    { "marker": "chosen", "text": "renderBody merge-ok branch emits the declare with --run-dir .faff/anchors/<run> so declare and merge-gate share one ledger." },
    { "marker": "punt", "text": "Whether to also print a faff effects check --run-dir line in the merge-ok landing comment, or leave verification to CI (decides: product)." },
    { "marker": "assumes", "text": "The run-level anchor dir .faff/anchors/<run>/ is present on the PR-head checkout at land time (committed by graft, carved back in by .gitignore)." },
    { "marker": "assumes", "text": "path.basename(.faff/anchors/<run>) == <run>, so run_id and chain genesis match a --run-resolved ledger." }
  ] }
```
