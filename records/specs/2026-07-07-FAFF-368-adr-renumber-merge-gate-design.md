# Spec — FAFF-368: re-validate ADR numbering at the merge gate, renumber on collision

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-368.

_Revised 2026-07-07 — spec-review QA-minor: added a negative scenario + DoD test asserting out-of-`--ref-scope` back-refs stay byte-identical and a dangling out-of-scope ref fail-closed BLOCKs._

**Artifact:** a design spec for the build agent (and human reviewers) implementing a mechanical guard against concurrent-graft ADR-number collisions. It adds a deterministic `faff adr renumber` CLI subcommand, sharpens the `adr validate` duplicate message, and wires a graft Step-10 check that renumbers a just-created ADR when the merge-target tree already holds its number.

---

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff adr new` allocates an ADR number at *branch-base time* (max existing number + 1, read once with no lock or reservation — `adrNextNumber`, `bin/faff:5313`). That allocation is a **read of a snapshot**, so two branches that base off the same `main` both read the same max and both mint the same next number. Nothing between allocation and merge re-checks it. The fix is to move the collision check to the **last moment before merge** — the one point where the incoming ADR and the peer's already-merged ADR are both visible on one tree — and renumber the incoming one there.

**Problem statement.** Concurrent grafts allocate the same ADR number at build time and both merge, landing a duplicate on `main` that reddens `faff adr validate` / `test/adr.test.mjs`; because every open branch inherits that tree, the duplicate then **fails CI on every open PR** until an out-of-band hotfix renumbers one. This spec adds a mechanical guard at the graft merge gate that detects the duplicate against the merge-target tree and renumbers the incoming ADR to a free number before ship, so the broken tree never reaches `main`.

**Design principles.**

- **Deterministic tools over prose.** Renaming a file, editing a heading number, and fixing canonical back-refs is mechanical and testable — it belongs in a CLI subcommand with unit tests (`adr --selftest` + `test/adr.test.mjs`), not free-handed in graft prose. Graft *orchestrates* (detects, calls, re-validates); the CLI *mutates*.
- **Never touch main's untouched files.** Under a live duplicate, two files share the number — the peer's (already on `main`) and ours (born this PR). The guard mutates only the ADR **this PR added** and back-refs **this PR introduced**. Rewriting a ref that could resolve to the peer's same-numbered ADR would be a new defect (the exact class this guards against).
- **Fail-closed, never merge-a-broken-tree.** If the collision can't be safely resolved (main already broken independently, ambiguous target, re-validate still red after renumber), the guard **blocks the merge and parks `needs-human`** — it never merges on a red `adr validate`.
- **Proportionate.** The dominant real case (PR #264/#265: two plain new ADRs both at 0043, no supersession) has *zero* cross-refs — file-rename + heading-edit fully resolves it. Back-ref fixing covers the rarer Step-3b-supersession sub-case; don't build a repo-wide prose rewriter for it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (ADR region, ~5270–5555) | Node CLI | `adrNextNumber`, `adrValidate`, `listAdrs`, `recordSupersededBy`/`recordSupersedesSet`, `cmdAdr` dispatch, `adrSelftest` — all reused/extended |
| `plugin/skills/faff-graft/SKILL.md` Step 4b (190–205), Step 10 (375–407) | Skill prose | ADR materialisation at build time; the merge-confidence gate + concurrent rebase-revalidate window where the guard is inserted |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (46–55) | Skill prose | Merge-lock + rebase-onto-latest-main-then-re-confirm-green; the rebase is what surfaces the peer's ADR on the incoming tree |
| `test/adr.test.mjs` (169 lines) | Node test | Where the new subcommand's unit tests + the two-branch collision regression land |
| `.github/workflows/validate.yml` (59–62, `push: main` trigger) | CI | Existing post-merge `faff adr validate` — the defence-in-depth backstop, improved only by the sharper message |

**Scope statement.** This sits at the graft merge gate (Step 10), immediately before the `ship` handoff, in the same window the concurrent executor already rebases and re-confirms CI — it is the merge-time counterpart to build-time allocation.

---

## 2. OUT OF SCOPE

- **Eager `faff adr new --at-merge` reservation** — Why excluded: renumbering lazily at the merge gate *is* the reservation, just deferred to the moment collision is observable; an eager reservation needs cross-branch coordination the tracker/repo doesn't provide and is fully subsumed. Extension point: if ever wanted, `cmdAdr` `new` action (`bin/faff:5529`) gains a reservation store — not needed here.
- **Repo-wide prose back-ref rewriting** (specs, SKILL.md, `// ADR-NNNN` comments) — Why excluded: the renumbered ADR is `Proposed`, born this PR, its number cited by nobody yet, so no external prose points at it. Extension point: a future `faff adr renumber --rewrite-prose` scanning `docs/`/`plugin/` — deliberately not built.
- **Changing when the number is *allocated*** (FAFF-16 owns `adrNextNumber` semantics) — Why excluded: this spec accepts branch-base allocation and corrects at merge; re-architecting allocation is FAFF-16's call. Extension point: `adrNextNumber` / the `new` action.
- **Renumbering an ADR that anyone has already superseded across PRs / any non-`Proposed` ADR on main** — Why excluded: the guard only ever moves the *incoming, this-PR* ADR; established ADRs on `main` are immovable. Extension point: none — deliberately refused.
- **A brand-new CI workflow job** — Why excluded: `validate.yml` already runs `faff adr validate` on `push: main`; the defence-in-depth ask ("fails fast, names the colliding pair") is met by the message improvement on the existing job. Extension point: `.github/workflows/validate.yml`.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Incoming ADR | The ADR file **added by this PR's diff** under `records/adr/` (`git diff --diff-filter=A <merge-base>..HEAD -- records/adr/`). The only file the guard may renumber. |
| Merge-target tree | The working tree after the branch has main's latest merged in — under the concurrent executor, the rebased head. This is the tree the peer's ADR is now visible on. |
| Colliding number | An ADR number present more than once in the merge-target tree, flagged by `adr validate` as `duplicate ADR number NNNN`. |
| Ref-scope | The set of ADR files this PR added or modified — the only files whose canonical back-refs the renumber may rewrite. |

**New CLI subcommand.**

```
faff adr renumber <selector> --to <target> [--ref-scope <file>[,<file>...]] [--root <dir>]

  selector    a records/adr filename (e.g. 0043-events-not-rpc.md) OR a bare number.
              A bare number is REJECTED when it is duplicated in the tree
              (ambiguous under exactly the collision this addresses) — the
              caller must pass the filename to disambiguate.
  --to        a 4-digit target number OR the literal `next`
              (resolves to adrNextNumber against the current tree).
  --ref-scope comma/space list of ADR filenames within which canonical back-refs
              to the moved number may be rewritten. Default: the moved file only.
              (Graft passes the branch's added/modified ADR set.)
  --root      root override, mirrors `adr new`/`validate` (for tests).

  exit 0  → renamed + re-validated clean; stdout: "<oldpath> -> <newpath>"
  exit 1  → problem (target occupied, ambiguous selector, post-move validate
            still red, selector not found); stderr names the problem; NO partial
            move is left behind (rename is applied only after target is confirmed free)
  exit 2  → usage error
```

**`adr validate` duplicate message — sharpened.**

```
before:  duplicate ADR number 0043
after:   duplicate ADR number 0043 — 0043-foo.md, 0043-bar.md
```

The message now lists **every** filename sharing the number (collected from `listAdrs`), so both the CI backstop and the graft guard can identify *which* files collide without a second scan.

**Design decision — where the renumber logic lives.**

| Option | Pro | Con |
|---|---|---|
| Graft prose orchestrates raw `git mv` + inline heading/ref edits | no CLI change | non-deterministic, untestable, duplicates regex logic already in `bin/faff` |
| **New `faff adr renumber` subcommand** | deterministic, unit-tested via `adr --selftest`, reuses `listAdrs`/`recordSupersededBy` regexes, git-agnostic | one new subcommand to maintain |

**Chosen:** a new `faff adr renumber` subcommand; graft only detects, invokes, stages, and re-validates. (Deterministic-tools principle.)

**Design decision — file move mechanism.**

**Chosen:** `fs.renameSync` inside the CLI (consistent with `new`/`supersede`, which are pure-`fs`); no `git` invocation in the CLI. Graft stages the rename with `git add -A records/adr/` and commits — git detects the rename by content similarity, so history is preserved without coupling the CLI to a git context (tests run in tmp dirs).

**Design decision — back-ref rewrite scope.**

**Chosen:** the renumber rewrites canonical `Superseded by <prefix>-<old>` and `Supersedes: <prefix>-<old>` refs **only within the ref-scope set** (default: the moved file). Graft supplies the branch's added/modified ADR files as `--ref-scope`. Rationale: under a live duplicate, a ref elsewhere could legitimately point at the peer's same-numbered ADR; bounding to this-PR-touched files makes the rewrite unambiguous and never touches main's untouched records. The common plain-new-ADR case has an empty ref set — a pure rename + heading edit.

---

## 4. HOW — Behavior

### 4.1 The `faff adr renumber` subcommand

**Summary:** move one ADR file to a free number, fix its heading, fix in-scope back-refs to it, and re-validate — atomically enough that a failure leaves no half-renamed tree.

```
PROCEDURE adr_renumber(dir, selector, target, refScope):
  1. adrs = listAdrs(dir)
  2. Resolve selector → source:
     a. IF selector matches a filename → source = that file
     b. ELSE IF selector is a number:
        - matches = adrs with that number
        - IF matches.length > 1 → EXIT 1 "ambiguous: NNNN is duplicated; pass a filename"
        - IF matches.length == 0 → EXIT 1 "no ADR NNNN"
        - source = matches[0]
     c. ELSE EXIT 1 "no ADR matching <selector>"
  3. Resolve target:
     a. IF target == "next" → newNum = adrNextNumber(dir)
     b. ELSE newNum = zero-pad(target, 4)
     c. IF any adr (other than source) already has newNum → EXIT 1
        "target ADR <newNum> is occupied"     # never move onto an occupied slot
     d. IF newNum == source.num → EXIT 0 (no-op)
  4. oldNum = source.num ; newFile = "<newNum>-<source.slug>.md"
  5. Rewrite source file text:
     a. heading  "# ADR <oldNum> —" → "# ADR <newNum> —"
     b. (source is also in refScope) rewrite its own canonical refs to oldNum → newNum
  6. fs.rename(source.file → newFile) ; write rewritten text to newFile
  7. FOR each f in refScope where f != source.file:
        rewrite canonical `Superseded by <ADR|PRDR>-<oldNum>` and
        `Supersedes: …-<oldNum>` → newNum   (reuse the recordSuperseded* regexes)
  8. problems = adrValidate(dir)
  9. IF problems non-empty → EXIT 1, print each "FAIL  <p>"   # do not claim success on a red tree
 10. EXIT 0, print "<oldpath> -> <newpath>"
```

**Anti-pattern:** renaming the file before confirming the target slot is free. Why: it can strand the tree mid-move and manufacture a *second* collision. Confirm free (step 3c) first.

**Anti-pattern:** rewriting refs across all ADRs regardless of scope. Why: under the live duplicate, a `Supersedes: ADR-<old>` on an untouched main file may point at the peer's ADR; rewriting it corrupts main's record.

### 4.2 The graft Step-10 guard

**Summary:** when the PR adds an ADR, validate the merge-target tree and, on a duplicate that names the incoming file, renumber it to the next free number — folded into the existing rebase-revalidate so a *single* CI re-confirm covers the renumbered head.

Placement (`faff-graft/SKILL.md` Step 10): after the integrity floor asserts and, **under the concurrent executor**, after the rebase/merge-of-`main` onto the branch but **before** the "re-confirm CI green on the rebased head" step — so the renumber commit is part of the head CI validates. Under sequential execution the branch already sees prior merges, so the check runs on `HEAD` and is near-always a clean no-op (cheap defence in depth).

```
PROCEDURE adr_merge_guard(pr, branch, mergeTarget):
  1. added = git diff --diff-filter=A <merge-base(mergeTarget)>..HEAD -- records/adr/
  2. IF added is empty → RETURN (no ADR in this PR; guard is a no-op)
  3. problems = `faff adr validate`
  4. IF no `duplicate ADR number` problem → RETURN (numbering clean)
  5. FOR each "duplicate ADR number NNNN — f1, f2, …" problem:
     a. incoming = the colliding file that is in `added`
     b. IF none of the colliding files is in `added`:
        # main is already broken independently of this PR — not ours to fix
        → BLOCK: park needs-human, surface "pre-existing duplicate ADR NNNN on
          merge target, not introduced by this PR", leave PR open. STOP.
     c. IF more than one colliding file is in `added` (this PR added a dup within itself):
        → renumber each-but-one, same mechanism.
     d. refScope = git diff --diff-filter=AM <merge-base>..HEAD -- records/adr/
     e. run `faff adr renumber <incoming> --to next --ref-scope <refScope>`
        - non-zero exit → BLOCK: park needs-human with the CLI's stderr. STOP.
  6. re-run `faff adr validate` → MUST be exit 0; else BLOCK needs-human. STOP.
  7. git add -A records/adr/ ;
     git commit -m "docs(adr): renumber <ISSUE-XX> ADR <old>→<new> (merge-time collision)"
  8. push ; proceed into the existing "re-confirm CI green on the (renumbered) head"
     step → then the ship handoff.  faff merge-gate observes CI on the new head sha.
```

**Edge cases and error handling.**

- **No ADR in the PR** → step 2 short-circuits; zero cost, the overwhelmingly common path.
- **Clean numbering** → step 4 returns; a rebase surfaced no collision.
- **Pre-existing broken main** (duplicate not involving this PR's added file) → `needs-human`, never renumber a file this PR didn't create. Terminal, park.
- **Renumber CLI fails** (occupied target after a racing third merge, ambiguity, still-red validate) → `needs-human`; the merge does not proceed.
- **Renumber commit changes head → CI must re-run.** Folding the guard *before* the single CI re-confirm makes the renumbered commit the head CI validates. If CI does not run on the new head, `faff merge-gate` (which observes CI on the head sha) blocks or reports `no-ci-coverage` — fail-closed, never a silent merge.
- **Supersession sub-case** (incoming ADR superseded an existing one at Step 3b): the existing ADR carries `Superseded by ADR-<oldIncoming>` and is in the branch diff (ref-scope), so step 7 of the CLI rewrites it to the new number; symmetric `adr validate` passes by construction.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the renumber commit lands but CI doesn't auto-trigger on the new head (e.g. a `push`-only diff), so `merge-gate` sees no check on the head sha. **How you'd know:** `merge-gate` returns `no-ci-coverage` / `not-ready` and the PR sits unmerged. **What it means:** correct fail-closed behaviour, not a defect — park/surface; the operator re-triggers CI. Not a reason to bypass the head-sha check.
- **The failure:** ref-scope is too narrow and a legitimate this-PR back-ref to the moved ADR lives in a file not in the diff set (shouldn't happen — refs born this PR are in the diff). **How you'd know:** the step-6 re-validate reports `asymmetric supersession` or `missing ADR-<old>`. **What it means:** BLOCK needs-human (never merge red); investigate whether the diff-set computation missed a file. A red re-validate is the designed backstop, not a silent pass.
- **The failure:** two peers race such that between renumber-to-`next` and merge a *third* branch merges the same `next` number. **How you'd know:** the winning branch's own guard fires on *its* next rebase (the check is idempotent and re-runs per rebase). **What it means:** proceed — the guard is convergent under the merge-lock; each serialised merge re-checks.

---

## 5. SCENARIOS — born-verifiable main objectives

```
Given main holds 0043-peer.md, and this PR's branch adds 0043-mine.md (same number)
When the graft merge guard runs on the merge-target tree
Then `faff adr renumber 0043-mine.md --to next` moves it to the next free number,
     `faff adr validate` exits 0, and the peer's 0043-peer.md is untouched
```

```
Given a tree with two ADRs numbered 0043 (0043-foo.md, 0043-bar.md)
When `faff adr validate` runs
Then it exits 1 and prints "duplicate ADR number 0043 — 0043-foo.md, 0043-bar.md"
     (both filenames named)
```

```
Given this PR added 0043-new.md that supersedes existing 0041-old.md
      (0041-old.md carries "Status: Superseded by ADR-0043", both in ref-scope)
When 0043-new.md is renumbered to 0044
Then 0041-old.md's back-ref becomes "Superseded by ADR-0044" and symmetric
     supersession validates clean
```

```
Given a PR whose diff adds no file under records/adr/
When the graft merge guard runs
Then it is a no-op — no validate call decides the merge, no renumber, no new commit
```

```
Given a merge-target tree with a duplicate ADR number whose colliding files are
      BOTH already on main (none added by this PR)
When the graft merge guard runs
Then it does NOT renumber, blocks the merge, and parks needs-human naming the
     pre-existing duplicate
```

```
Given `faff adr renumber 0043-mine.md --to 0041` where 0041 is occupied
When the subcommand runs
Then it exits 1 "target ADR 0041 is occupied" and leaves the tree unchanged
     (no partial rename)
```

```
Given this PR adds 0043-mine.md, and an unrelated main record 0030-other.md carries
      a back-ref "Supersedes: ADR-0043" pointing at the peer's same-numbered ADR
      (0030-other.md is NOT in --ref-scope)
When 0043-mine.md is renumbered to next with --ref-scope covering only this-PR ADRs
Then 0030-other.md is byte-identical afterwards — its out-of-scope back-ref is never
     rewritten; and if a renumber ever leaves a genuine dangling/asymmetric ref, the
     step-6 re-validate is red and the guard BLOCKs needs-human (never a silent green)
```

---

## 6. DESIGN DECISION RATIONALE

**Where does the renumber logic live — CLI subcommand or graft prose?**
Options: (a) graft free-hands `git mv` + `sed`-style edits; (b) new `faff adr renumber` subcommand. (a) is untestable and re-implements the canonical-ref regexes already in `bin/faff`. **Chosen:** (b) — deterministic, unit-tested through `adr --selftest` + `test/adr.test.mjs`, reuses `listAdrs`/`recordSupersededBy`/`recordSupersedesSet`. Governing principle: deterministic-tools-over-prose.

**Should `adr validate`'s duplicate message name the colliding files?**
Options: keep number-only; name the pair. **Chosen:** name every filename sharing the number — it serves both the CI backstop (the ticket's "name the colliding pair") *and* the graft guard's identification of the incoming file, at trivial cost (`listAdrs` already read).

**How wide is the back-ref rewrite?**
Options: rewrite everywhere; bound to this-PR-touched files. **Chosen:** bound to a `--ref-scope` set (default: moved file only; graft passes the branch's added/modified ADRs). Rewriting globally risks corrupting a ref that legitimately points at the peer's same-numbered ADR under the live duplicate. The common case has an empty ref set.

**File move mechanism — `git mv` or `fs.rename`?**
**Chosen:** `fs.rename` inside the CLI (git-agnostic, matches `new`/`supersede`, tmp-dir-testable); graft stages with `git add -A` so git records the rename by similarity.

**When does the guard run, given a renumber changes the head sha?**
Options: renumber after CI re-confirm (needs a second CI pass); fold into the rebase-revalidate before the single CI re-confirm. **Chosen:** fold in — the renumbered commit becomes the head CI validates once; `faff merge-gate`'s head-sha CI observation stays authoritative and fail-closed.

**How is the incoming ADR identified?**
**Chosen:** `git diff --diff-filter=A <merge-base>..HEAD -- records/adr/` — the file this PR added. Robust under a duplicate number (identifies by *file*, not number).

**Eager `--at-merge` reservation?**
**Chosen — rejected:** lazy renumber at the merge gate *is* the reservation, deferred to when collision is observable; an eager reservation needs cross-branch coordination the repo can't provide. Documented in OUT OF SCOPE.

**A new CI job for defence in depth?**
**Chosen — no:** `validate.yml` already runs `faff adr validate` on `push: main`; the sharper message satisfies "fails fast and names the colliding pair". No new workflow.

**Pre-existing-broken-main / ambiguous collision?**
**Chosen:** the guard never renumbers a file this PR didn't add; a duplicate not involving the incoming file, or any post-renumber red validate, blocks and parks `needs-human`. Fail-closed over merge-a-broken-tree.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions are closed above.

**Assumptions.**

- **Assumes** the concurrent executor's rebase-onto-latest-`main`-before-ship (concurrency SKILL.md 46–55) runs before the guard, so the peer's merged ADR is present on the incoming tree. *Validate:* confirm Step 10's concurrent clause (line 390) still rebases + re-confirms CI on the rebased head before the ship handoff.
- **Assumes** `faff merge-gate` observes CI on the PR **head** sha (per FAFF-376 / the Step-10 prose at line 386). *Validate:* confirm merge-gate re-reads CI on head sha, so a renumber commit forces a fresh CI observation.
- **Assumes** ADR files this PR introduces carry canonical back-refs only within the branch diff set. *Validate:* the step-6 re-validate is the backstop — a red result blocks, so a violated assumption fails loud, never merges.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A concurrent same-number collision no longer reaches `main`: with main holding `NNNN-peer.md` and the branch adding `NNNN-mine.md`, the merge gate renumbers the incoming ADR and `faff adr validate` exits 0 before ship.

### From WHAT (CLI subcommand)
- [ ] `faff adr renumber <filename> --to next` moves the file to `adrNextNumber`, rewrites its heading, and prints `<old> -> <new>` on exit 0.
- [ ] `--to <NNNN>` onto an occupied slot exits 1 "target ADR NNNN is occupied" with the tree unchanged (no partial rename).
- [ ] A bare-number selector that is duplicated exits 1 "ambiguous … pass a filename".
- [ ] `--ref-scope` bounds back-ref rewriting; a `Superseded by ADR-<old>` in an in-scope file becomes `<new>`, and an out-of-scope file is never edited.
- [ ] `--root` override works (tests exercise a tmp dir); the subcommand invokes no `git`.
- [ ] Post-move `adrValidate` is red → the subcommand exits 1 and does not report success.
- [ ] `faff adr` usage line and `docs/cli.md` list `renumber` (docs updated same PR).

### From WHAT (validate message)
- [ ] `faff adr validate` on a duplicated number prints `duplicate ADR number NNNN — <file1>, <file2>[, …]` naming every colliding file.

### From HOW (graft guard)
- [ ] Step 10 guard is a no-op when the PR's diff adds no `records/adr/` file (no validate-driven merge decision, no commit).
- [ ] On a duplicate whose colliding set includes the this-PR-added file, the guard renumbers that file to `next`, commits `docs(adr): renumber … (merge-time collision)`, and proceeds to the CI re-confirm on the renumbered head.
- [ ] The guard is placed before the concurrent CI re-confirm so a single CI pass covers the renumbered head; `faff merge-gate` observes CI on the new head sha.
- [ ] A duplicate whose colliding files are all pre-existing on main (none added by this PR) blocks the merge and parks `needs-human`, renumbering nothing.
- [ ] A non-zero `renumber` exit, or a still-red re-validate, blocks the merge (`needs-human`) rather than merging.
- [ ] The supersession sub-case (incoming ADR superseded an existing one at Step 3b) re-validates symmetric after renumber.

### From HOW (edge cases)
- [ ] Idempotent/convergent under the merge-lock: re-running the guard on an already-clean tree is a no-op.

### Tests
- [ ] `adr --selftest` gains cases: renumber happy path, occupied-target refusal, ambiguous-bare-number refusal, ref-scope-bounded back-ref rewrite, post-move re-validate.
- [ ] `test/adr.test.mjs` gains a two-branch same-number collision regression: build a tree with a duplicate, run the renumber, assert `validate` exits 0 + the peer file is byte-unchanged.
- [ ] `test/adr.test.mjs` asserts an out-of-`--ref-scope` file that references the moved number is **byte-identical** after renumber (the ref-scope bound holds); and a renumber that would leave a dangling/asymmetric out-of-scope ref fails the step-6 re-validate → exit 1 (never a silent green).
- [ ] `test/adr.test.mjs` asserts the sharpened duplicate message names both filenames.
- [ ] The real-repo `validate` regression (exit 0 + `OK —`) still passes.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. tmp records/adr with 0001..0003 clean; add 0003-dup.md (duplicate of 0003)
  2. run `faff adr validate --root tmp`
     → exit 1, message "duplicate ADR number 0003 — 0003-<a>.md, 0003-dup.md"
  3. run `faff adr renumber 0003-dup.md --to next --root tmp`
     → exit 0, prints "…/0003-dup.md -> …/0004-dup.md"
  4. run `faff adr validate --root tmp`
     → exit 0, "OK — 4 ADR(s) … valid."
```

---

## Already shipped against this surface

Premise-superseded scan over Done tickets on this surface (`faff adr` CLI, `records/adr/`, faff-graft Step 10, `validate.yml`): **premise still holds — proceed.**

- **FAFF-16** (Done — ADRs, the `faff adr` CLI + numbering) — *related, not superseding.* It delivered the numbering the collision root-causes to (branch-base allocation); it does not ship a merge-gate collision guard. This spec accepts FAFF-16's allocation semantics and adds the merge-time correction.
- No Done ticket ships a mechanical ADR-collision guard. The FAFF-322 spec explicitly names this hazard as *manual-only mitigation* ("re-checked immediately before merge — the concurrent-graft ADR-collision precedent") — confirming the gap this fills.

---

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "title": "Renumber logic lives in a new deterministic CLI subcommand", "marker": "chosen" },
    { "title": "adr validate duplicate message names the colliding files", "marker": "chosen" },
    { "title": "Back-ref rewrite bounded to a ref-scope (this-PR-touched files)", "marker": "chosen" },
    { "title": "File move via fs.rename; CLI git-agnostic, graft stages/commits", "marker": "chosen" },
    { "title": "Guard folded into rebase-revalidate before the single CI re-confirm", "marker": "chosen" },
    { "title": "Incoming ADR identified via git diff --diff-filter=A", "marker": "chosen" },
    { "title": "Eager --at-merge reservation rejected (subsumed by lazy renumber)", "marker": "chosen" },
    { "title": "Reuse existing push:main CI validate for defence-in-depth; no new workflow", "marker": "chosen" },
    { "title": "Pre-existing-broken-main / ambiguous collision blocks needs-human", "marker": "chosen" }
  ] }
```

---

## Methodology critique

**Banner:** Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4) — soft split candidate.**
  - *What's there:* the spec carries two structurally independent concerns — a standalone deterministic `faff adr renumber` CLI primitive (git mv, heading edit, bounded back-ref rewrite, re-validate; exit 0/1/2, independently exercised by `--selftest` + `test/adr.test.mjs`), and the faff-graft Step-10 orchestration guard that consumes it. The sharpened `adr validate` message and CI note are minor riders on the same outcome.
  - *Why it matters:* the primitive ships and tests without touching the merge gate; the guard is pure orchestration on top. Two independent units in one ticket blur burn-down and force the risky wiring to wait on (or rush) the primitive.
  - *What to do:* acceptable to keep as one ticket if it genuinely lands in 1–3 days (they always ship together for the outcome — renumber alone creates no user value, so a hard merge-into-siblings isn't warranted). But if the primitive proves fiddly, split `faff adr renumber` (+ its selftest/regression tests) ahead of the Step-10 guard so the primitive can be proven before it's wired live — see risk profile.

- **Workstream fit? (principles 1, 5) — No issues.**
  - Correctly project-less in Backlog (the lens's default landing). The outcome is single and cohesive — "a concurrent ADR-number collision can't reach main" — with no mixed-purpose bundling. No activity-named or thematic container to convert.

- **Deps surfaced? (principle 6) — No blockers needed; one verification.**
  - *What's there:* `relatedTo FAFF-16/312/334/350`, no `blockedBy`. The spec builds only on already-shipped infra it names — `faff adr validate`, `faff adr next-number`, the push:main validate workflow, and the faff-graft Step-10 merge gate (live per recent FAFF-376/-346 work).
  - *Why it matters:* an unshipped prerequisite hiding behind a `relatedTo` edge would let this be pulled "ready" while actually blocked.
  - *What to do:* nothing structural — the referenced surfaces exist, so no `blockedBy` edge is missing. Just confirm `faff adr next-number` / `faff adr validate` are on main at graft time (they are per project history); the `relatedTo` edges read as context, not load-bearing deps.

- **Risk profile? (principle 7) — novel integration on a chokepoint, largely self-de-risked.**
  - *What's there:* the guard performs an automated git mv + heading + back-ref rewrite mid-graft, folded before the concurrent CI re-confirm — a novel write inside the merge gate, the most sensitive chokepoint in the pipeline.
  - *Why it matters:* an incorrect renumber/back-ref rewrite during the gate could corrupt the merge target; surprises here land at the worst possible moment.
  - *What to do:* the spec already de-risks well — fail-closed `block → needs-human` on pre-existing-broken-main / ambiguous / non-zero-renumber / still-red-revalidate, plus the two-branch collision regression test and `--selftest`. That standalone-primitive-first, prove-before-wiring shape *is* the de-risking spike; formalising it as the split above (primitive + tests land and are proven, then the Step-10 guard) is the risk-aware sequencing this principle wants. No separate spike ticket needed beyond that.
