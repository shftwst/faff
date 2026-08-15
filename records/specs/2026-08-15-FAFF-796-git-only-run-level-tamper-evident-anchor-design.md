# FAFF-796 — Git-only run-level tamper-evident anchor

> Spec: faffter-dark-nlspec · 2026-08-15 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-796.

This is the build spec for FAFF-796, implementing ADR 0109 (`records/adr/0109-tamper-evident-committed-audit-stays-pr-only-for-tracker-backed-runs-git-only-mo.md`). Audience: the build agent (who needs the exact mechanism and its wiring point) and human reviewers (who need to see the decision is faithful to a settled ADR). The decision is settled — this spec implements it, it does not re-open it.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff already mints a committed, tamper-evident *anchor* — a byte-copy of a run's evidence subset plus a CLI-computed hash-chain witness, written under `.faff/anchors/<run>/<issue>/` and re-verified by `governance-check`. Today that anchor is minted **only** at the PR boundary (faff-graft Step 9b). A run that opens no PR mints nothing. This ticket adds a **sibling** anchor for **git-only mode**: minted at run-close instead of at a PR, keyed by run rather than by PR, using the *same* byte-copy + witness core and the *same* two-leg verifier. It is additive — the per-PR anchor is untouched.

**Problem statement.** In git-only mode (ADR 0075) there is no tracker and no PR, so a run that parks or errors on every issue leaves **zero durable, tamper-evident record anywhere** — only the gitignored, ephemeral run-dir. This change mints a committed run-level anchor at run-close for **every** git-only run regardless of outcome, closing that gap.

**Design principles.**

- **Every exit path or none.** The anchor must be minted on *every* run-close path (fully-shipped, partially-parked, all-parked, budget-hit). Minting from only some paths reintroduces the exact "audit stops at a boundary" ambiguity ADR 0109 closes. The mechanism for guaranteeing this is to hang the mint off the **single** orchestrator-exit edit that already runs on every path — not to scatter mint calls across branches.
- **Deterministic tools over prose.** The byte-copy, the witness computation, and the re-verification are mechanical and must live in the `faff` CLI (testable, reproducible), exactly as the per-PR anchor does. The LLM/orchestrator lane owns only the git side-effect (one commit) and the mode gate — mirroring how the per-PR anchor splits `faff events anchor` (CLI) from the `git commit` at graft Step 9b (skill prose).
- **Reuse one core, never fork it.** The witness and the verifier are shared with the per-PR anchor (FAFF-621's composition rule). No second hash-walk, no second witness format, no forked floor-file reader. The one *additive* verifier change — an outcome-aware `merge_floor` leg (below) — is a conditional inside the shared core, not a fork.
- **A non-shipped issue has no merge floor to bind.** The `merge_floor` leg asserts "this *shipped* issue passed its merge floor" (a complete `ac-checklist.json` + `review-verdict: pass`). A parked/errored issue never reached review, so it has no floor files and no floor to assert — mirroring the ADR's own rationale that a non-shipping run has no *merged code* for an anchor to bind. For a run-level anchor, `merge_floor` is therefore **n/a for a non-shipped issue** and evaluated only for a shipped one; **integrity is always on** (the chain must always verify, shipped or not).
- **Evidence subset only, never the raw run-dir.** The committed set is the evidence-class roster ADR 0077 already established (FAFF-519) — ledger + events + summary + per-issue verdicts + CLI witness. This decision creates **no new write-authority class**.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` (`faff events anchor`, ~L1016–1081; `computeChainHead` ~L745–764; `verifyChain`/`verifyLedgerChain` ~L610–739) | Node (CLI) | The per-PR anchor emitter + witness core this reuses. |
| `plugin/skills/faff/bin/lib/governance-check.js` (`deriveAnchorDirs` L300–334; `evaluateAnchorDir` L244–285; `cmdGovernanceCheck` L516–619) | Node (CLI) | Discovery + two-leg verifier; the discovery leg extends here. |
| `plugin/skills/faff-beep-boop/SKILL.md` — "At orchestrator exit" bullet (~L403) | Skill prose | The single run-close ledger edit (`owner.status:"done"` + `stop_reason`); the mint wires here. |
| `plugin/skills/faff/bin/lib/run-ledger.js` (`applyTerminalOutcome` L74–82; `recordOutcome` L284–329) | Node (CLI) | Run-ledger shape + the L2 interactive terminal-outcome writer. |
| `.gitignore` L29–32; `plugin/skills/faff/bin/lib/gitignore-ensure.js` L51 | Git config | The `.faff/*` + `!.faff/anchors/` carve-out shape 2 reuses. |
| `plugin/skills/faff/bin/lib/tracker.js` (`classifyTracker`) + gateway "Tracker availability resolution" | Node + prose | The git-only signal the emitter gates on (resolved once per run). |

**Scope statement.** This is the git-only, run-close half of faff's tamper-evident audit; it sits beside the per-PR (tracker-backed) anchor and shares its verifier, within the `.faff/anchors/` discovery tree.

## 2. OUT OF SCOPE

- **Tracker-backed run anchoring.** Excluded — ADR 0109 keeps tracker-backed audit PR-only *by design* (a non-shipping tracker-backed run has the tracker + `faff disposition` non-zero exit as its record). Extension point: none — this is a settled non-goal, not deferred work.
- **The evidence-branch shape (shape 1).** Excluded — ADR 0109 picks shape 2 (a run-summary commit reusing `.faff/anchors/<run>/`) over FAFF-596's orphan/side-branch. Extension point: a future retention/pruning need would reopen shape 1 as a *fresh* Punt, not inherited here.
- **A routine automated git-only verification trigger (a "git-only CI").** Excluded — there is no CI/PR gate in git-only mode. This ticket makes the anchor *discoverable and verifiable on demand* (via the discovery-leg extension) and *self-verified at mint*; wiring a scheduled/gated re-verification pass is a separate concern. Extension point: a future `faff governance-check --from-tree` invocation from whatever git-only gate is later introduced.
- **Retrospective anchoring of historical runs.** Excluded — mint applies to runs closing after this ships. Extension point: a one-off backfill command, not built here.
- **Any change to `faff events anchor`'s per-PR behaviour, output, or invocation.** Excluded — the per-PR anchor (FAFF-568/623) is frozen; this only *factors out and reuses* its inner mint core (see HOW). Extension point: the shared `mintIssueAnchor` helper.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Per-PR anchor | The existing anchor minted at faff-graft Step 9b when a PR opens, one dir per issue at `.faff/anchors/<run>/<issue>/`. |
| Run-level anchor | The new git-only anchor minted at run-close for the whole run, same on-disk tree, keyed by `run_id`, one subdir per issue the run touched. |
| Witness | The CLI-computed `chain-head.json` (`computeChainHead`) recording head seq + `head_sha256` of `events.jsonl`, re-checked by `verifyChain`. |
| Evidence subset | `run-ledger.json`, `events.jsonl`, `summary.md`, per-issue `ac-checklist.json` / `review-verdict.json` (and the other optional floor files the per-PR anchor already carries), plus the CLI witness. Never the raw run-dir. |
| Run-close choke-point | The single orchestrator edit at run exit that sets `owner.status:"done"` + `stop_reason`, on every exit path. |

**On-disk layout (unchanged tree, new writer).**

```
.faff/anchors/<run_id>/
  summary.md                         # run-level, best-effort (copied if present)
  <ISSUE-A>/                          # one subdir per issue the run touched
    events.jsonl                      # run-scoped, byte-copied
    run-ledger.json                   # run-scoped, byte-copied (final, post-close)
    chain-head.json                   # CLI witness over the final events.jsonl
    ac-checklist.json                 # per-issue floor file, if present
    review-verdict.json               # per-issue floor file, if present
    ...                               # holdout.json / build-progress.json if present
  <ISSUE-B>/
    ...
```

This is byte-identical in shape to what `faff events anchor` writes per issue today; the run-level anchor just writes one such subdir per issue in the run plus a run-level `summary.md`.

**New CLI surface.**

```
INTERFACE  faff events anchor-run --run-dir DIR [--dest DIR]
  # DIR      = $FAFF_RUN_DIR (the .faff/runs/<run_id>/ dir)
  # --dest   = anchors root override; default .faff/anchors/<basename DIR>/
  # Enumerates the issues the run touched from run-ledger.json, mints one
  # per-issue anchor subdir for each (reusing the per-PR mint core), copies
  # run-level summary.md, appends the close event to the chain before
  # witnessing, then self-verifies each minted subdir.
  # Exit: 0 = every subdir minted and self-verified; non-zero = mint/verify
  #       failure (fail loud — never a silent partial anchor).
```

```
INTERFACE  faff governance-check --derive-anchor-dirs ANCHORS_PATH --from-tree [--run RUN_ID]
  # Existing --derive-anchor-dirs reads changed paths from stdin (PR source).
  # --from-tree replaces the stdin source with a filesystem walk of
  # ANCHORS_PATH (optionally scoped to one RUN_ID), emitting the same
  # <run>/<issue> dirs through the same segment-guards + realpath-containment.
  # Each emitted dir is verified by evaluateAnchorDir (with the outcome-aware
  # merge_floor extension below).
```

**Design decisions (WHAT).**

- **Emitter home.** Options: (a) loop the existing `faff events anchor` verb from orchestrator prose per issue; (b) add a thin `faff events anchor-run` verb that internally reuses the per-issue mint core. **Chosen:** (b) — extract the per-PR anchor's inner byte-copy+witness block into a shared helper `mintIssueAnchor(runDir, issue, dest)` and have both `events anchor` (per-PR, unchanged behaviour) and the new `events anchor-run` call it (FAFF-621 composition). A verb keeps the mint deterministic and gives it a `--selftest` home; a prose loop scatters mechanics into the un-lintable orchestrator lane.
- **Issue enumeration source.** **Chosen:** enumerate the run's issue set from the run-close `run-ledger.json` (the per-issue outcome map — the same set `faff disposition` classifies). A run that admitted issues but recorded no outcomes still enumerates its admitted set; an empty run mints only the run-level `summary.md` (no issue subdirs) and exits 0.
- **`summary.md` placement.** **Chosen:** copy run-level `summary.md` to `.faff/anchors/<run_id>/summary.md` (evidence completeness per the ADR subset), **best-effort** — copied if present, skipped if absent, mirroring the optional-floor-file pattern. It is deliberately **not** leg-verified: the two verifier legs operate only on the per-issue `<run>/<issue>/` subdirs (integrity over `events.jsonl`, merge_floor over the floor files) — a run-level `summary.md` at depth 2 is correctly ignored by `deriveAnchorDirs` (too shallow) and needs no verifier change.
- **Verifier semantics for a non-shipped run-level issue.** Today `evaluateAnchorDir.pass = integrity.pass && merge_floor.pass`, and `evaluateMergeFloorLeg` FAILS a dir lacking a complete `ac-checklist.json` + `review-verdict: pass` (governance-check.js L133–145, L283) — correct for the per-PR anchor, which only ever anchors a *shipped* issue. A run-level anchor deliberately anchors non-shipped issues (parked/errored), which have none of those files, so reusing the leg unchanged would fail every non-shipped subdir and defeat the whole feature. **Chosen:** extend `evaluateAnchorDir` so `merge_floor` is **n/a** (pass=true, `detail: "n/a — non-shipped run-level issue"`, joining completeness/budget/liveness) when the anchored issue's outcome — read from the anchor's own committed `run-ledger.json`, the same source FAFF-690 already reads for level-derivation — is non-shipped (parked / errored / routed-out / superseded); it is evaluated as today for a shipped issue (one with a `review-verdict`). Integrity is unconditional. This is a single additive conditional in the shared core, not a fork, and it does **not** change per-PR behaviour (the per-PR anchor only presents shipped issues, which still evaluate `merge_floor`).

## 4. HOW — Behavior

**Architecture and approach.** Three pieces, in dependency order:

1. **Refactor (no behaviour change):** extract the inner mint block of `faff events anchor` (`cmdEvents`'s `anchor` branch in `events.js`) into `mintIssueAnchor(runDir, issue, destDir)` — the byte-copy of `events.jsonl` + `run-ledger.json` + optional floor files, plus the `computeChainHead` witness write. `events anchor` becomes a thin caller; its existing selftest must stay green (proves the extraction is behaviour-preserving).
2. **Emitter:** `faff events anchor-run` (new verb) reuses `mintIssueAnchor` per issue + adds the run-level concerns (issue enumeration, `summary.md`, the close event, self-verify).
3. **Discovery + verifier leg:** `deriveAnchorDirs` grows a filesystem-walk source (`--from-tree`) so the run-level tree is discoverable without a PR diff; `evaluateAnchorDir` is reused with the single additive outcome-aware `merge_floor` conditional (WHAT above) — integrity unconditional, merge_floor n/a for a non-shipped issue.

**Emitter procedure.**

```
PROCEDURE anchor_run(runDir, dest = ".faff/anchors/" + basename(runDir)):
  PRECONDITION: the caller (orchestrator-exit) has already written owner.status:"done"
    + stop_reason to run-ledger.json AND emitted the mandatory post-edit `ledger-write`
    event onto events.jsonl recording the final ledger's recomputed hash (the existing
    beep-boop rule that every direct ledger edit is followed by a `ledger-write`). So the
    final ledger state is already the chain head before anchor_run runs. See A1.
  1. Read run-ledger.json from runDir. Fail loud (non-zero) if absent/unparseable.
  2. Assert the chain is coherent: the on-disk run-ledger.json hash matches the last
     `ledger-write` event (the same ledger-fold the integrity leg checks). If not, the
     precondition was not met — fail loud (non-zero); never witness over an un-chained close.
  3. issues := the run's issue set from the ledger (admitted[] ∪ keys(outcomes{}), A2). May be empty.
  4. FOR each issue in issues:
       a. destSub := dest + "/" + issue
       b. mintIssueAnchor(runDir, issue, destSub)   # shared core: byte-copy + witness over the final chain
  5. IF runDir/summary.md exists: byte-copy it to dest + "/summary.md"   # best-effort (A3)
  6. Self-verify: FOR each destSub, run evaluateAnchorDir(destSub) (with the outcome-aware
     merge_floor); if integrity fails — or merge_floor fails for a *shipped* issue — exit
     non-zero (a broken anchor is never committed silently). A non-shipped issue's n/a
     merge_floor is a pass, so an all-parked run self-verifies cleanly.
  7. Exit 0.
```

**Wiring at the run-close choke-point (orchestrator prose).** In `faff-beep-boop/SKILL.md`'s "At orchestrator exit" bullet — the *same single edit* that sets `owner.status:"done"` + `stop_reason`, and *only* when the run resolved to **git-only mode** (the once-per-run resolved signal) — after writing the ledger close:

```
PROCEDURE orchestrator_exit(runDir):
  1. Write owner.status:"done" + stop_reason to run-ledger.json         # existing edit
  2. Emit the mandatory post-edit `ledger-write` event onto events.jsonl # existing rule (beep-boop)
     (records the final ledger's recomputed hash — this is what makes the close in-chain)
  3. IF run mode == git-only:
     a. faff events anchor-run --run-dir "$FAFF_RUN_DIR"          # mint + self-verify over the final chain
     b. git add .faff/anchors/$(basename "$FAFF_RUN_DIR")/         # carve-out lets this land un-forced
        git commit -m "chore(anchor): run-level evidence anchor for <run_id>"
        # one run-summary commit on the current working branch (shape 2)
  4. Stop the sentry poller  # existing step, unchanged
```

Steps 1–2 are the *existing* close discipline (a direct ledger edit is always followed by its `ledger-write`); anchor-run in step 3 depends on that ordering and asserts it (procedure step 2), so it never witnesses over an un-chained close.

Placing the call at this one choke-point is what discharges the "every exit path" principle — the same guarantee mechanism the `owner.status:"done"` edit itself relies on. Mode-gating lives here (skill lane); the verb is mode-agnostic.

**Discovery-leg procedure.**

```
PROCEDURE derive_anchor_dirs_from_tree(anchorsPath, runId?):
  1. roots := runId ? [anchorsPath + "/" + runId] : immediate child dirs of anchorsPath
  2. FOR each <run> root, FOR each immediate child <issue> dir:
       candidate := anchorsPath + "/" + <run> + "/" + <issue>
       apply the SAME segment guards (no "." / ".." / empty) and realpath-containment
       under anchorsPath that the changed-paths source applies; drop + warn on failure.
  3. Return { dirs: sorted+deduped, dropped }
```

The changed-paths (stdin) source is untouched; `--from-tree` selects the walk source instead. Both feed identical `<run>/<issue>` dirs into `evaluateAnchorDir` — integrity (unconditional) + merge_floor (evaluated for a shipped issue, n/a for a non-shipped one, per the WHAT decision); completeness/budget/liveness n/a as today.

**Edge cases and error handling.**

- **Empty run (no issues admitted).** anchor-run mints no issue subdirs, copies `summary.md` if present, exits 0. The commit still lands (a run-level `summary.md`-only anchor is a valid record of an empty run).
- **`summary.md` absent.** Skipped (best-effort); not an error.
- **`run-ledger.json` absent/unparseable.** Fail loud, exit non-zero — the emitter must not fabricate a witness over missing evidence.
- **A minted subdir fails self-verify.** Exit non-zero *before* the commit step, so a broken anchor is never committed. Terminal, not retryable.
- **Nothing to commit (git reports no change).** Tolerated — the commit step treats "nothing staged" as a no-op success (e.g. a re-run over an already-committed anchor), never an error.
- **Not git-only mode.** The emitter is never called (skill gate); zero behaviour change for tracker-backed runs — the per-PR anchor path is the only anchor, exactly as today.

**Failure modes.**

- **The failure:** the mint fires on some exit paths but not others (e.g. a budget-hit abort bypasses the choke-point), silently recreating the boundary gap. **How you'd know:** a git-only run that budget-aborts leaves no commit under `.faff/anchors/<run>/`. **What it means:** proceed only if the call sits at the *single* edit every path funnels through; if any exit path bypasses that edit, that is a pre-existing orchestrator bug to fix, not a reason to scatter mint calls.
- **The failure:** the witness is taken *before* the run-close event is chained, so the anchor's `events.jsonl` omits the close and the chain head disagrees with the live ledger. **How you'd know:** `evaluateAnchorDir`'s integrity leg passes but the anchored ledger's terminal state predates the close event. **What it means:** the append-then-witness ordering (procedure steps 1–2 before steps 4/6) is load-bearing — keep it.
- **The failure:** the run-level `summary.md` at depth 2 is mistaken for an anchor dir and fed to `evaluateAnchorDir`. **How you'd know:** a spurious verifier run over a non-anchor path. **What it means:** the existing `deriveAnchorDirs` "too shallow" guard already drops depth-<3 paths — the `--from-tree` walk must reuse that guard, not bypass it.
- **The failure:** the outcome-aware `merge_floor` n/a branch is keyed off the wrong signal (e.g. floor-file *absence* rather than the ledger *outcome*), so a shipped issue whose floor files failed to copy is silently waved through as "non-shipped". **How you'd know:** a shipped issue's anchor passes with no `review-verdict`. **What it means:** the n/a branch must be gated on the anchored `run-ledger.json`'s recorded outcome for that issue (a positive non-shipped signal), never on mere file absence — absence of floor files on a *shipped* issue is still a fail.
- **The failure (inherent, documented not fixed):** unlike the per-PR anchor — whose witness is externally pinned by the PR head SHA the merge-gate observes — the git-only witness is self-minted and committed in the *same* commit as the log it witnesses, with no external pin. Its tamper-evidence therefore rests on git-history immutability, not witness independence. **How you'd know:** an actor who can rewrite git history could re-mint a consistent anchor. **What it means:** this is inherent to ADR 0109's settled shape-2 (a run-summary commit, not an external branch/service), so it is a *documented property*, not a defect to fix here — noted so a reader does not over-read "tamper-evident" as "externally pinned".

**Anti-patterns.**

- **Anti-pattern:** a second CLI that re-implements the byte-copy or the witness for the run-level case. Why: forks the hash-walk FAFF-621 forbids; two witnesses drift. Reuse `mintIssueAnchor` + `computeChainHead`.
- **Anti-pattern:** scattering `anchor-run` calls across each park/error/ship branch. Why: guarantees an eventual missed path — the whole point of hanging it off the single close edit is the coverage guarantee.
- **Anti-pattern:** committing the raw run-dir (`.faff/runs/<run>/`) to "be safe". Why: violates the evidence-subset roster (FAFF-519 / ADR 0077); commit only the anchor tree.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git-only run (no tracker) whose issues all park with no PR opened
When the run reaches orchestrator-exit and the ledger close is written
Then a committed anchor exists at .faff/anchors/<run_id>/ with one per-issue
     subdir (events.jsonl + run-ledger.json + chain-head.json, plus any floor
     files) and a run-level summary.md, in a single run-summary commit
```

```
Given a git-only run that fully ships one issue and parks another
When orchestrator-exit runs
Then both issues have anchor subdirs and the anchor is minted once (not per-issue-timed),
     proving the mint is run-level and fires regardless of mixed outcomes
```

```
Given a tracker-backed run (tracker present)
When the run closes
Then no run-level anchor is minted and the per-PR anchor path is unchanged
     (assertion: byte-for-byte no new call in the tracker-backed close path)
```

## 6. Design Decision Rationale

**Where does the run-level mint live — reuse the verb, or a new verb over a shared core?**
Options: prose loop of `faff events anchor` (no new surface, but scatters mechanics into the un-lintable orchestrator lane and cannot self-test the run-level concerns); new `faff events anchor-run` over an extracted `mintIssueAnchor` core (one small refactor, deterministic, selftest-able).
**Chosen:** the new verb over a shared core — honours "deterministic tools over prose" and FAFF-621's "reuse one core", and gives the every-exit-path invariant a single, testable call site.

**How is "every exit path" guaranteed?**
Options: audit each park/error/ship/budget branch to add a mint call (fragile, guarantees an eventual miss); hang the single mint off the one ledger-close edit every path already funnels through.
**Chosen:** hang it off the single close edit — the same coverage mechanism the `owner.status:"done"` write already depends on. The "every exit path" property is a skill-prose invariant (no CLI can enforce it), so it must ride the one edit that is already universal.

**How is the run-level anchor discovered without a PR diff?**
Options: a wholly new discovery command (forks discovery); a second source on `deriveAnchorDirs` that walks the filesystem tree, reusing its segment-guards + containment and feeding `evaluateAnchorDir`.
**Chosen:** the `--from-tree` second source on `deriveAnchorDirs` — ADR 0109's "grow a second discovery source ... both route through the same evaluateAnchorDir core". The stdin/PR source is untouched, so tracker-backed CI behaviour is byte-for-byte unchanged.

**Gitignore carve-out — new line or reuse?**
Options: add a new `!` negation + selftest; reuse the existing `.faff/*` + `!.faff/anchors/` (`.gitignore` L29–32, `gitignore-ensure.js` L51).
**Chosen:** reuse — shape 2 writes under `.faff/anchors/<run>/`, already re-included by the existing negation. This item is **verify-only**: add/confirm a test asserting a run-level path `.faff/anchors/<run>/<issue>/events.jsonl` is not ignored (the existing selftest already covers the per-PR shape; extend it to the run-level shape). A new `!` line is added **only** if implementation diverges from `.faff/anchors/` — it must not.

**How does the verifier pass a non-shipped run-level issue that has no merge floor?**
The per-PR `evaluateAnchorDir` fails any dir without a complete `ac-checklist.json` + `review-verdict: pass` — correct there (it only anchors shipped issues), fatal here (the run-level anchor's whole point is anchoring parked/errored issues, which have neither).
Options: drop the merge_floor leg for run-level anchors entirely (loses the leg for shipped issues in a mixed run); a separate run-level verifier (forks the core, banned); one additive conditional keyed off the anchored ledger's recorded outcome.
**Chosen:** the additive conditional — `merge_floor` n/a for a non-shipped issue (parked/errored/routed-out/superseded), evaluated for a shipped one; integrity always on. Faithful to the ADR's binding rationale (no merged code / no merge floor to bind → nothing to assert) and to "reuse one core". Keyed off the ledger *outcome*, never file absence, so a shipped issue with missing floor files still fails.

**Self-verify at mint — worth it?**
Options: mint and trust; mint then run `evaluateAnchorDir` over each subdir and fail loud on any leg failure.
**Chosen:** self-verify — cheap (the verifier is already in-process and exported), and it guarantees a git-only run never commits a broken anchor even though no CI will catch it later.

## 7. Open Questions and Assumptions

**Open Questions.** None — ADR 0109 settles the decision (mode, shape, commit moment, evidence subset, verifier). No **Punt:**.

**Assumptions.**

- **Assumes:** the mandatory post-edit `ledger-write` event and its chained-append path already exist (the beep-boop rule that every direct ledger edit is followed by a `ledger-write` recording the ledger's recomputed hash; the integrity leg's ledger-fold reads it — see `eventsLedgerFold` in `events.js`). *Validate:* confirm the orchestrator-exit `owner.status:"done"` edit is followed by the `ledger-write` append before `anchor-run` runs (add it if the close edit currently omits it — a prerequisite, not a design change). `anchor-run` itself does **not** append a new event; it relies on that `ledger-write` being the chain head and asserts the ledger-fold is coherent (procedure step 2). This resolves the append-then-witness ordering: the witness is taken over the chain that already includes the close.
- **Assumes:** `run-ledger.json` exposes the run's issue set (validated present: `admitted[]` + the per-issue `outcomes{}` map, run-ledger.js ~L54–67; beep-boop's completeness invariant makes `admitted ⊆ keys(outcomes)` at a clean close). *Validate:* confirm the field names hold and enumerate `admitted[] ∪ keys(outcomes)`. The same ledger's `outcomes[issue]` is the non-shipped/shipped signal the outcome-aware `merge_floor` reads.
- **Assumes:** the run-close hard-floor `summary.md` lives at `$FAFF_RUN_DIR/summary.md`. *Validate:* confirm the path in the beep-boop summary-render step; if named/located differently, adjust the best-effort copy source (its absence is already tolerated, so a miss degrades gracefully).

## 8. DONE — Definition of Done

### From WHY
- [ ] A git-only run that parks/errors on every issue (no PR) produces a committed anchor at `.faff/anchors/<run_id>/` after run-close.
- [ ] The committed evidence subset is exactly ledger + events + summary + per-issue verdicts + CLI witness — never the raw run-dir.

### From WHAT (interfaces)
- [ ] `faff events anchor-run --run-dir DIR` exists; exits 0 on full mint+self-verify, non-zero on any mint/verify failure.
- [ ] `mintIssueAnchor` is extracted and called by both `faff events anchor` (behaviour unchanged — existing selftest green) and `faff events anchor-run`.
- [ ] `faff governance-check --derive-anchor-dirs <path> --from-tree [--run <id>]` walks the anchor tree and emits the same `<run>/<issue>` dirs as the stdin source.

### From HOW (behaviour)
- [ ] The mint is wired at the single orchestrator-exit edit and fires on every exit path (fully-shipped, partially-parked, all-parked, budget-hit) in git-only mode only.
- [ ] The `owner.status:"done"` close is followed by its `ledger-write` event before `anchor-run` runs; `anchor-run` asserts the ledger-fold is coherent and fails loud if the close is not the chain head (append-then-witness ordering).
- [ ] One run-summary commit is made on the current branch, staging only `.faff/anchors/<run_id>/`.
- [ ] `evaluateAnchorDir` verifies each discovered run-level subdir: integrity unconditional; `merge_floor` n/a for a non-shipped issue (keyed off the anchored ledger's `outcomes[issue]`) and evaluated for a shipped one; completeness/budget/liveness n/a.
- [ ] An all-parked run's anchor self-verifies clean (integrity passes, merge_floor n/a → overall pass), so the anchor is committed — the feature's primary case.
- [ ] Per-PR anchor verification is unchanged (a shipped issue still evaluates merge_floor).
- [ ] Run-level `summary.md` is copied best-effort to `.faff/anchors/<run_id>/summary.md` and is not leg-verified.

### From HOW (edge cases)
- [ ] Empty run → only `summary.md` (if present), exit 0, commit still lands.
- [ ] `run-ledger.json` absent/unparseable → fail loud, no anchor.
- [ ] A subdir failing self-verify → non-zero exit before commit; no broken anchor committed.
- [ ] Tracker-backed run → no run-level mint; per-PR anchor path byte-for-byte unchanged.

### From scope item 3 (gitignore)
- [ ] A test asserts `.faff/anchors/<run>/<issue>/events.jsonl` is not git-ignored (existing carve-out reused; no new `!` line unless the path diverges).

### Tests
- [ ] `faff events anchor-run` selftest: clean round-trip (mint → self-verify pass) for a shipped issue, an all-parked run (no floor files → merge_floor n/a → pass), broken-chain fails, un-chained close (no `ledger-write`) fails loud, empty-run case.
- [ ] `evaluateAnchorDir` outcome-aware `merge_floor`: n/a (pass) for a non-shipped anchored issue; still FAILS a *shipped* issue lacking floor files; per-PR (shipped) path unchanged.
- [ ] `governance-check --from-tree` test: 1/2/3-segment + traversal drop parity with the stdin source; end-to-end discover→verify over a fixture all-parked run-level tree yielding overall pass.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Build a fixture run-dir: events.jsonl (valid chain, incl. the post-close `ledger-write`)
     + run-ledger.json (owner.status:"done", 2 parked issues in outcomes{}) + summary.md
  2. faff events anchor-run --run-dir <fixture>          # expect exit 0 (self-verify clean)
  3. Assert .faff/anchors/<run>/{ISSUE-A,ISSUE-B}/chain-head.json exist and summary.md at run root
  4. faff governance-check --derive-anchor-dirs .faff/anchors --from-tree --run <run> \
       | xargs -I{} ...  # discover, then verify each dir
  5. Assert overall pass: integrity on + merge_floor n/a (parked) → pass — plumbing connected
```

## Methodology critique (agile-delivery lens)

- **Right-sized?** No issue. The three scope parts (emitter, verifier discovery+`merge_floor` leg, gitignore verify) are one always-ships-together concern — an anchor nothing can verify is inert, and a verifier extension with no emitter to feed it is dead code. A single 1–3 day unit; splitting would create two halves neither of which delivers value alone. Keep as one issue.
- **Workstream fit?** No issue. Sits in "Graft evidence is tamper-evident end-to-end" — outcome-named and cohesive; a direct sibling of the shipped per-PR anchor (FAFF-568/623).
- **Deps surfaced?** No issue. `blockedBy` → FAFF-623 (Done) is explicit; reuse of FAFF-568/621 machinery and the FAFF-519/ADR-0077 evidence roster is cited in-spec. No implicit dependency left unlinked.
- **Risk profile?** Low, mitigated. The one novel-integration risk is the outcome-aware `merge_floor` conditional touching the *shared* verifier core (per-PR path). Mitigated by the "per-PR behaviour byte-for-byte unchanged" DoD item + a dedicated selftest, and by the fail-closed keying (n/a requires a positive non-shipped outcome, never file absence). Build-tier `complex` but no de-risking spike warranted — the surface is fully grounded in existing, tested code.

confidence: high
build-tier: complex
spec-review: approve
