# FAFF-1467: collate-evidence writes spec-review-verdict.json itself

> Spec: faffter-dark-nlspec · 2026-11-04 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1467.

This spec covers FAFF-1467. When `faff spec-review collate-evidence --comment` renders the `## Spec-review evidence` comment, it also writes the anchored `spec-review-verdict.json` from that comment, in the same call. A new `faff spec-review write-evidence` verb gives prep's paths-only carry the same write. It is written for the build agent and for human reviewers.

## 1. WHY

**The load-bearing idea.** The evidence file is a copy of the comment, made on the machine that made the comment. Prep already holds the collated record when it renders the comment. If the command that prints the comment also writes the file, through the existing writer's parse, redact, anchor and validate path, then no later agent step has to remember to do it. The comment stays the only carrier that crosses machines. The file only spares a build on the same machine the tracker fetch.

**Problem.** In an adopter repo, 8 of the last 41 anchors on main carry `spec-review-verdict.json`. In 11 traced issues prep posted the evidence comment, but the build agent never ran the writer, because graft Step 9b.1 is prose that tells it to find the comment and pass it to `faff pr open --spec-review-evidence`. In one more issue the 46 KB evidence was too large for a comment, and prep improvised an attachment that graft never reads. Replaying those comments through `faff evidence write spec-review-verdict` exits 0, so the data was always good. Only the hand-off step was lost. This change moves the write into the deterministic command prep already runs at the terminal review seam, so a skipped build step can no longer drop the evidence.

**Design principles.**

**No tracker I/O.** faff CLI commands stay tracker-agnostic. Neither `collate-evidence` nor `write-evidence` reads or writes the tracker. Prep still posts the comment.

**One writer, one document shape.** The file must be byte-identical to what `faff evidence write spec-review-verdict` produces from the same comment. Reject any implementation that builds the anchored document from the in-memory record by a second code path.

**Do not weaken the run-dir guard.** `guardWriterPaths` keeps refusing any `--run-dir` outside `.faff/runs/`. The interactive location gets its own separate check that is just as narrow. It is not added to the run guard as an exception.

**Code replaces prose; prose only shrinks.** The SKILL.md edits only say what the command now does and where its warning goes. They add no step the agent must remember in order for the file to exist.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review.js` (`cmdCollateEvidence` :103-141, flags :65, dispatch :151, selftest collate cases :240-259) | JS (legacy, factory region) | Hosts the write and the new verb |
| `plugin/skills/faff/bin/lib/evidence.js` (`guardWriterPaths` :714-733, `writeEvidenceFile` :737-749, `writeSpecReviewVerdict` :797-810, exports :1616-1623) | JS (legacy, governance region) | The writer this reuses; gains the scratch placement check |
| `plugin/skills/faff/bin/lib/evidence-collate.js` (`renderSpecReviewComment` :148-167, `parseSpecReviewComment` :170-187) | JS (legacy, governance) | Renders and re-parses the comment; unchanged |
| `plugin/skills/faff/bin/lib/spec-review-pin.js` (`specReviewDir` :297-300) | JS | Defines the two scratch layouts this spec derives from |
| `plugin/skills/faff/bin/lib/events.js` :1788 | JS | Mint best-effort copies `<runDir>/<issue>/spec-review-verdict.json` into the anchor |
| `plugin/skills/faff-prep/SKILL.md` :263 (terminal seam), :553 (carry exit 0) | prose | The two seams that produce evidence comments |
| `docs/guide/cli.md` :185 | docs | `collate-evidence` reference row |

**Scope.** This is the producer half of the evidence hand-off between prep and graft. The reader half (FAFF-1468) and the mint refusal (FAFF-1357) build on it.

## 2. OUT OF SCOPE

- **How `faff pr open` finds the file.** Why excluded: it is FAFF-1468, which is blocked by this ticket. Extension point: `pr-open.ts` around :235-241, where the lookup order would be run-dir file, then `.faff/spec-review/<ISSUE>/spec-review-verdict.json`, then `--spec-review-evidence`.
- **Refusing a mint when the file is missing.** Why excluded: it is FAFF-1357. Extension point: the optional-floor copy in `events.js` :1788.
- **Stamping the digest into the spec's `spec-review:` line, or recording it in the anchored file.** Why excluded: FAFF-1357 owns the stamp and the matching rule. The digest is already printed on the comment's `sha256:` line, so this spec adds nothing new to expose it. Recording it inside `spec-review-verdict.json` would be a v0.3 schema change. Extension point: `anchoredSpecReview` in `evidence.js` and the `spec-review-verdict.json` schema in `contracts/evidence-v0.3/`.
- **Graft Step 9b.1 prose.** Why excluded: graft still needs it until FAFF-1468 lands, because nothing reads the scratch file before then. Extension point: `plugin/skills/faff-graft/SKILL.md` Step 9b.1, which FAFF-1468 trims.
- **The interactive iterate carry-check (`faff-prep/SKILL.md` :471).** Why excluded: that path tells the user the review carried forward and posts no evidence comment, so there is nothing to write. Extension point: the same `write-evidence` verb if that path ever starts posting a comment.
- **The improvised attachment for oversized evidence.** Why excluded: once the file exists, the size of the comment no longer matters for the anchor. Whether a 46 KB comment can still be posted is a tracker-side limit and stays with prep's existing behaviour.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| scratch dir | The directory `faff spec-review-dir` prints and prep passes as `--dir`. In run mode it is `<runDir>/<ISSUE>/spec-review`. In interactive mode it is `.faff/spec-review/<ISSUE>`. |
| evidence target | The directory `spec-review-verdict.json` is written into. In run mode it is `<runDir>/<ISSUE>`, the parent of the scratch dir and the directory the mint copies from. In interactive mode it is the scratch dir itself. |
| placement | Working out the evidence target and issue id from the scratch dir alone. |

### Placement

```
RECORD Placement:
  issue: String          # matches ISSUE_ID_RE, contains no ".."
  target_dir: Path       # real path of the evidence target
  mode: ENUM { run, interactive }

FUNCTION placeSpecReviewEvidence(scratchDir) -> Placement      # evidence.js, governance
  THROWS WriterFault(message)                                    # no placement; nothing written
```

```
PROCEDURE placeSpecReviewEvidence(scratchDir):
  1. root = findRoot()
     real = realpath(isAbsolute(scratchDir) ? scratchDir : join(root, scratchDir))   # a relative --dir resolves against the repo root, never the cwd
     IF it fails or is not a directory → WriterFault("--dir is not a directory")
  2. roots = [root] plus mainWorktreeRoot(root) when it differs     # same pair guardWriterPaths uses
  3. Interactive check, tried first:
     FOR each r in roots:
       srRoot = realpath(r/.faff/spec-review)    # skip r when this does not exist
       IF srRoot != realpath(r) + "/.faff/spec-review":   # .faff or .faff/spec-review is itself a symlink
         WriterFault(".faff/spec-review resolves outside the repository")
       IF dirname(real) == srRoot:
         issue = basename(real)
         IF issue fails ISSUE_ID_RE or contains ".." → WriterFault("--dir is not a valid spec-review scratch dir")
         RETURN { issue, target_dir: real, mode: interactive }
  4. Run check:
     IF basename(real) == "spec-review":
       issueDir = dirname(real); issue = basename(issueDir); runDir = dirname(issueDir)
       target = guardWriterPaths(runDir, issue)      # unchanged guard: runDir must be inside .faff/runs/
       RETURN { issue, target_dir: target, mode: run }
  5. WriterFault("--dir is neither <run-dir>/<ISSUE>/spec-review nor .faff/spec-review/<ISSUE>")
```

The interactive check is anchored at the repository root at both levels. First, `.faff/spec-review` must resolve to exactly `<real root>/.faff/spec-review`: if `.faff` or `.faff/spec-review` is itself a symlink, placement refuses, so a planted parent link cannot carry the write outside the repository. Second, the scratch dir's real parent must equal that directory: a symlinked `.faff/spec-review/<ISSUE>` that points elsewhere resolves to some other parent, so it fails step 3. It then fails step 5, unless it happens to land under `.faff/runs/`, where the run guard applies. The two checks cannot both match: an interactive scratch's parent is `.faff/spec-review`, and a run scratch's grandparent lies inside `.faff/runs`.

**Deliberate duplication of the scratch layout.** `placeSpecReviewEvidence` (governance) restates the two layouts `specReviewDir` (factory, `spec-review-pin.js`) produces, because governance must not require factory. The duplication is pinned by a test, not left to review: for both modes, `placeSpecReviewEvidence(specReviewDir(issue, runDir))` must return the expected placement. A layout change on either side fails that test.

**Chosen:** derive the run dir and issue from `--dir` and add no `--run-dir`/`--issue` flags. Prep already passes exactly the directory `specReviewDir` computed. Separate flags would add a way for the two to disagree and would change prep's call lines for no gain.

**Chosen:** the interactive location is guarded by a separate `placeSpecReviewEvidence` check that accepts exactly the direct children of `<root>/.faff/spec-review/`, for the working checkout or its main worktree. `guardWriterPaths` is not edited, and `faff evidence write` keeps its `--run-dir`-only contract.

### Writer split

```
FUNCTION writeSpecReviewVerdictTo(issueDir, text, secrets) -> { written: Path } | { refused: [String] }
  # body of today's writeSpecReviewVerdict after its guard: parseSpecReviewComment → redactKnownSecrets
  # → anchoredSpecReview → schema + specReviewWriterViolations → writeEvidenceFile(issueDir, "spec-review-verdict.json", doc)

FUNCTION writeSpecReviewVerdict(runDir, issue, text, secrets)       # behaviour unchanged
  = writeSpecReviewVerdictTo(guardWriterPaths(runDir, issue), text, secrets)
```

Export `placeSpecReviewEvidence` and `writeSpecReviewVerdictTo` from `evidence.js`. `spec-review.js` lazy-requires `./evidence` inside the two functions that need it. A factory module requiring a governance module is allowed (regions.js :8-10, ADR-0042), and `cmdCollateEvidence` already lazy-requires `./judge-dispositions` the same way.

### CLI surface

`faff spec-review collate-evidence --dir <scratch> … --comment`. Flags are unchanged. The command now has a side effect: after rendering, it writes the evidence file.

- stdout: the rendered comment, unchanged and byte for byte.
- stderr on success: `faff spec-review collate-evidence: wrote <path>`.
- stderr when no file is written: `faff spec-review collate-evidence: warning: spec-review-verdict.json not written: <reason>`.
- Exit codes are unchanged. A failed write never changes the exit code.

`faff spec-review collate-evidence` without `--comment` stays read-only and writes nothing.

`faff spec-review write-evidence --dir <scratch> --file <comment.md | ->` is a new action on the existing `spec-review` command, so no new `regions.js` entry is needed. It reads a comment or spec text that holds a `## Spec-review evidence` section, places it, and writes the file through `writeSpecReviewVerdictTo`.

- Exit 0: written. stdout is the path.
- Exit 1: refused, for example no section, digest mismatch or schema violation. Each reason goes on stderr as `refused: <message>`. Nothing is written.
- Exit 2: usage error, `--dir` or `--file` missing, `--file` unreadable, placement fault, redaction-config fault, or IO fault. Nothing is written.

Add `write-evidence` to `SPEC_REVIEW_USAGE`.

**Chosen:** cover the carry path with the new `write-evidence` verb rather than a flag on `carry-check` or a mode of `collate-evidence`. `carry-check` is a pure classifier, and `collate-evidence` collates rounds, but the carried comment has no rounds. A separate verb that shares placement and the writer keeps each command doing one job.

## 4. HOW

### collate-evidence --comment

When it renders the comment, `collate-evidence --comment` attempts the write from that exact text, then prints the text.

```
PROCEDURE cmdCollateEvidence(values):        # steps up to rendering unchanged
  1. … collate, fold dispositions as today; any failure exits as today with nothing printed or written
  2. IF NOT values["--comment"]: print JSON.stringify(record); RETURN 0      # no write
  3. text = renderSpecReviewComment(record, collated.rounds)
  4. P = "faff spec-review collate-evidence: "
     TRY:
       p = placeSpecReviewEvidence(dir)
       r = writeSpecReviewVerdictTo(p.target_dir, text, secrets)       # same secrets resolved in step 1
       IF r.refused:
         removeIfPresent(p.target_dir/spec-review-verdict.json)       # the new input is refused: no earlier review may stand in
         stderr P + "warning: spec-review-verdict.json not written: " + r.refused.join("; ")
       ELSE: stderr P + "wrote " + r.written
     CATCH WriterFault or SchemaUnavailable as e:
       IF p was placed: moveAsideIfPresent(p.target_dir/spec-review-verdict.json → spec-review-verdict.stale.json)
       stderr P + "warning: spec-review-verdict.json not written: " + e.message   # plus the stale path when the move-aside itself failed
     # any other exception propagates: a bug fails loud
  5. stdout.write(text); RETURN 0
```

**Chosen:** a failed write is a stderr warning, and the command still prints the comment and exits 0. The comment is the cross-machine carrier and must not be lost to a local file fault. Prep's rule is that any non-zero exit is logged and never blocks promotion, and with a non-zero exit there is nothing to post. A missing file stays visible: the warning goes to `prep.md`, and FAFF-1357 is the gate that refuses a mint without it.

**Chosen:** the file is built by re-parsing the rendered comment, not from the in-memory record. This guarantees that the file equals what `faff evidence write spec-review-verdict` produces from the posted comment, and that the digest check runs on the same bytes prep posts.

**Anti-pattern:** writing before rendering, or writing in plain mode. Why: plain mode is prep's first call, before dispositions exist. A write there would anchor an unsettled record. The terminal `--comment` call would overwrite it, but a crash in between would leave the wrong record in place.

**Chosen:** after a successful placement, a failed write never leaves an earlier review at the canonical path. A writer refusal (the new comment is bad) removes the existing `spec-review-verdict.json`. A fault (IO or schema unavailable, where the new input may be fine) moves it aside to `spec-review-verdict.stale.json`, so a transient disk or permission error keeps the old copy for a human but nothing reads it as current. If the move itself fails, the warning names the stale path. Either way the canonical failure state is "no file", which the warning reports and FAFF-1357 refuses at mint. A placement fault touches nothing, because no target is known. `write-evidence` follows the same rule.

**Chosen:** the anchored document does not depend on the run dir. `anchoredSpecReview` (evidence.js :753) takes only the collated content, so the same comment yields the same bytes in any target; the builder must keep it that way and must not add run-dir provenance to the file.

**Anti-pattern:** catching every exception in step 4. Why: a programming error would then show only as a warning that nobody reads. Only the two known fault classes are downgraded.

### write-evidence

```
PROCEDURE cmdWriteEvidence(values):
  1. IF --dir or --file missing → exit 2
  2. text = (--file == "-") ? stdin : readFile(--file);  unreadable → exit 2
  3. secrets = resolveKnownSecretValues(findRoot());  failure → exit 2
  4. TRY p = placeSpecReviewEvidence(--dir); r = writeSpecReviewVerdictTo(p.target_dir, text, secrets)
     CATCH WriterFault or SchemaUnavailable → if placed, move an existing file aside; stderr message; exit 2
  5. IF r.refused → remove an existing file; each reason on stderr as "refused: …"; exit 1
  6. stdout r.written; exit 0
```

### Prep prose (minimal)

Change `faff-prep/SKILL.md` :263 (terminal seam). That line is one paragraph of 194 words, and `faff validate-adapters` fails any prose line over 200 words (`PARA_WORD_CAP`). The file is 611 lines against a `SKILL_LINE_BASELINE` of 612. Edit the line in place with these two replacements and add no new line:

- Replace `(audit-only — gates nothing; a legitimately-absent record is a first-class state)` with `(audit-only; gates nothing)`. The next sentence already says an all-clean review posts nothing.
- Replace `Any non-zero exit: log it and continue, never block promotion.` with ``That `--comment` call also writes `spec-review-verdict.json`; log any stderr `warning:` line or non-zero exit in `prep.md` and continue, never block promotion.``

The result is about 197 words. Nothing else in that paragraph changes, including "post `comment.md` byte for byte" and the git-only append.

Change `faff-prep/SKILL.md` :553 (Exit 0 carry). When the earlier fenced block and `sha256:` line were copied in, save the composed comment as `$scratch/carry-comment.md` and run `faff spec-review write-evidence --dir $scratch --file $scratch/carry-comment.md`. A non-zero exit is logged and never blocks. When no block was copied, run nothing. Extend the existing bullet in place, so the line count does not change.

Change `docs/guide/cli.md`. Extend the `collate-evidence` row (:185) with the write side effect and its warning, and add a `spec-review write-evidence` row with its exit codes.

### Edge cases

- **Clean first-round approve.** Prep posts nothing and runs no `--comment` call, so no file is written. This is by design and FAFF-1357's `evidence: none` covers it.
- **Re-run of the seam, or a later carry.** On success, `writeEvidenceFile` renames over the old file: the same comment produces identical bytes, and a newer comment replaces an older one. On a failed write, the old file is removed (refusal) or moved aside to `spec-review-verdict.stale.json` (fault), so a stale review never survives at the canonical path.
- **Prep run from a subdirectory.** `specReviewDir` prints a relative `.faff/spec-review/<ISSUE>`; placement resolves it against the repo root, so the cwd does not matter.
- **`.faff` or `.faff/spec-review` is a symlink.** Placement refuses even when the link target is inside the repository; prep never creates either as a link, so a link means tampering or an unsupported layout.
- **Interactive scratch in a linked worktree.** `.faff/spec-review/<ISSUE>` resolves under the working checkout, which is `roots[0]`. A scratch under the main worktree also matches.
- **Run dir outside `.faff/runs/` (a stray `$FAFF_RUN_DIR`).** `guardWriterPaths` refuses it. The result is a warning with no file, and the comment is still printed.
- **Round files and the evidence file sharing the interactive scratch.** Every round reader filters on `^round-(\d+)\.json$` (evidence-collate.js :90, spec-review-convergence.js :149, spec-review-round.js `numberedFiles`), so `spec-review-verdict.json` and its `.tmp-<pid>` sibling are never read as rounds.
- **Git-only.** Prep appends the comment to the committed spec. The scratch dir still exists, so the write succeeds, but nothing reads it until FAFF-1468.
- **Oversized evidence.** The file has no size limit. Whatever prep does with a comment the tracker rejects, the anchor no longer depends on it.

### Failure modes

- **The failure.** The 11 traced issues may have lost the file for a reason other than the skipped step, for example a run dir that was cleaned up before graft minted. **How you'd know.** After this lands, adopter anchors on main still lack `spec-review-verdict.json` for issues whose `prep.md` logs `wrote <path>`. **What it means.** The write side is fixed and the loss is downstream. Proceed with FAFF-1468, and investigate run-dir lifetime there.
- **The failure.** Interactive prep followed by a build on another machine never sees the file. **How you'd know.** That is expected: the comment is the carrier there. **What it means.** Proceed. This spec only spares a build on the same machine its tracker fetch.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run-mode scratch dir <runDir>/FAFF-9/spec-review under .faff/runs holding round-1.json with one objection and round-2.json approving
When faff spec-review collate-evidence --dir <scratch> --dispositions d.json --comment runs
Then stdout is the rendered evidence comment, exit is 0, and <runDir>/FAFF-9/spec-review-verdict.json exists
And that file's bytes equal the file faff evidence write spec-review-verdict --run-dir <otherRunDir> --issue FAFF-9 writes from the same stdout into a second, separate run dir
```

```
Given .faff/spec-review is a symlink to a directory outside the repository, holding FAFF-9/ with valid rounds
When faff spec-review collate-evidence --dir .faff/spec-review/FAFF-9 --dispositions d.json --comment runs
Then exit is 0, stdout is the full evidence comment, stderr contains "warning: spec-review-verdict.json not written", and no spec-review-verdict.json exists in the link target
```

```
Given <runDir>/FAFF-9/spec-review-verdict.json exists from an earlier review
When faff spec-review write-evidence --dir <runDir>/FAFF-9/spec-review --file comment.md runs with a comment whose sha256 line does not match
Then exit is 1 and <runDir>/FAFF-9/spec-review-verdict.json no longer exists
```

```
Given an interactive scratch dir .faff/spec-review/FAFF-9 holding one objection-bearing round and one approving round
When faff spec-review collate-evidence --dir .faff/spec-review/FAFF-9 --dispositions d.json --comment runs
Then .faff/spec-review/FAFF-9/spec-review-verdict.json exists with schema_version 1 and exit is 0
```

```
Given .faff/spec-review/FAFF-9 is a symlink to a directory outside the repository
When faff spec-review write-evidence --dir .faff/spec-review/FAFF-9 --file comment.md runs
Then exit is 2 and no spec-review-verdict.json is written in the symlink target
```

```
Given a comment whose fenced block was edited after rendering so its sha256 line no longer matches
When faff spec-review write-evidence --dir <valid scratch> --file comment.md runs
Then exit is 1, stderr contains "refused: digest mismatch", and no file is written
```

- faff spec-review collate-evidence without --comment MUST NOT create spec-review-verdict.json in any directory.
- faff evidence write spec-review-verdict with a --run-dir outside .faff/runs MUST still exit 2.

## 6. DESIGN DECISION RATIONALE

**How does the interactive write get past the `.faff/runs` guard?**
Options: (a) widen `guardWriterPaths` to also accept `.faff/spec-review`; (b) a separate placement check that accepts exactly the direct children of `.faff/spec-review/`; (c) write interactive evidence under a fake run dir. Option (a) weakens a governance guard for every writer, including `ac-checklist` and `review-verdict`. Option (c) invents state the mint and FAFF-1468 would have to know about.
**Chosen:** (b). It is narrow, it is real-path checked, and it leaves the run guard untouched.

**Explicit `--run-dir`/`--issue` flags, or derive them from `--dir`?**
Flags are explicit, but they can disagree with `--dir`, and they need prep call-site edits. Derivation reuses the layout `specReviewDir` already fixes.
**Chosen:** derive them from `--dir`.

**How is the carry path covered?**
Options: a flag on `carry-check`, a stdin mode on `collate-evidence`, or a new `write-evidence` action. `carry-check` is a pure classifier, and `collate-evidence` has no rounds to collate in a carry.
**Chosen:** the new `spec-review write-evidence` action, which shares placement and the writer with `collate-evidence`, so the judge path, the dispositions path and the carry path all produce the file through one function.

**Should a write failure fail the command?**
Failing loses the comment, because prep cannot post what was never printed, and prep's rule never blocks promotion anyway. Succeeding silently would repeat today's invisible loss.
**Chosen:** warn on stderr, exit 0, and print the comment. Prep copies the warning into `prep.md`.

**Should collate-evidence print the digest separately for FAFF-1357?**
The comment already ends in `sha256: <hex>`, which is the block digest. A second output channel would change stdout, which prep posts byte for byte.
**Chosen:** no new output. FAFF-1357 reads the digest from the comment's `sha256:` line, and how the mint matches it to the file is FAFF-1357's call.

**Build the file from the in-memory record or from the rendered comment?**
**Chosen:** from the rendered comment, through `writeSpecReviewVerdictTo`, so the file equals what a replay of the posted comment would write.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None.

**Assumptions.**

**Assumes:** beep-boop run dirs live under `<root>/.faff/runs/`, in the working checkout or the main worktree, as `guardWriterPaths` already requires for every evidence writer. To validate, check that `test/evidence-write.test.mjs` builds its run dir as `.faff/runs/run-…` and that the mint copies from `<runDir>/<issue>/`.

## 8. DONE

### From WHY
- [ ] `collate-evidence --comment`, run against a run-mode scratch, leaves `<runDir>/<ISSUE>/spec-review-verdict.json` on disk with no further command.
- [ ] The diff adds no `require` of `node:http`, `node:https`, `node:net` or any tracker adapter module to `spec-review.js` or `evidence.js`.
- [ ] `guardWriterPaths` is byte-unchanged, and `faff evidence write spec-review-verdict` with a `--run-dir` outside `.faff/runs` still exits 2.

### From WHAT
- [ ] `placeSpecReviewEvidence` returns `mode: interactive` for a direct child of a real `.faff/spec-review/` and `mode: run` for `<runDir>/<ISSUE>/spec-review` with `runDir` under `.faff/runs/`. It throws `WriterFault` for any other directory, for a symlinked child that resolves outside, for a `.faff` or `.faff/spec-review` that is itself a symlink, and for an invalid issue id.
- [ ] A test in `test/` asserts that, for both modes, `placeSpecReviewEvidence(specReviewDir(issue, runDir))` returns the expected `target_dir` and `mode`, pinning the duplicated scratch layout.
- [ ] `writeSpecReviewVerdict(runDir, issue, …)` delegates to `writeSpecReviewVerdictTo`, and every existing case in `test/evidence-write.test.mjs` passes unchanged.
- [ ] `placeSpecReviewEvidence` and `writeSpecReviewVerdictTo` are exported from `evidence.js`.
- [ ] `SPEC_REVIEW_USAGE` lists `write-evidence --dir <scratch> --file <file|->`.

### From HOW
- [ ] `collate-evidence --comment` stdout is byte-identical before and after this change for the same inputs, and on success stderr includes exactly one line `faff spec-review collate-evidence: wrote <path>` (existing `skipped …` lines may also appear).
- [ ] On a placement fault or a writer refusal, `collate-evidence --comment` exits 0, prints the comment, and stderr includes exactly one line beginning `faff spec-review collate-evidence: warning: spec-review-verdict.json not written:`.
- [ ] After a placed-but-refused write from either command, no `spec-review-verdict.json` remains in the target. After a placed write that faults, an earlier file is at `spec-review-verdict.stale.json`, not the canonical path.
- [ ] A relative `--dir` of `.faff/spec-review/<ISSUE>` places correctly when the command runs from a subdirectory of the repository.
- [ ] `collate-evidence` without `--comment` writes no file.
- [ ] The `--from-judge --spec … --comment` path writes the same file as the `--dispositions` path when both resolve to the same dispositions.
- [ ] `write-evidence` exits 0 and writes the file for a carry comment. It exits 1 with `refused:` for a digest mismatch or a missing section, and exits 2 for missing flags, an unreadable `--file`, or a placement fault.
- [ ] The file `collate-evidence` writes is byte-identical to the file `faff evidence write spec-review-verdict` writes from its stdout.
- [ ] `faff-prep/SKILL.md` :263 carries the two in-place replacements, and :553 carries the `write-evidence` call. No other prose changes.
- [ ] `faff-prep/SKILL.md` stays at or under 611 lines, its :263 line stays at or under 200 words, and `faff validate-adapters` passes with `SKILL_LINE_BASELINE` unchanged.
- [ ] `docs/guide/cli.md` documents the `collate-evidence` side effect and the `write-evidence` row.

### From HOW (edge cases)
- [ ] Running the terminal seam twice leaves one file whose bytes match the latest comment.
- [ ] Round readers ignore `spec-review-verdict.json` in an interactive scratch. A test runs `collateSpecReviewRounds` on a dir that holds the file and reports no skip for it.

### Tests
- [ ] New tests live in `test/`, for example `test/spec-review-evidence-write.test.mjs`, run under `node --test`, and cover every item above using a temp git root with `.faff/runs` and `.faff/spec-review`, as `test/evidence-write.test.mjs` does.
- [ ] The collate-evidence cases in the `spec-review.js` selftest (:240-259) move into `test/` and are deleted from the selftest block. No new selftest cases are added to either module.
- [ ] `node --test` over `test/` and `faff regions check` pass.

### Integration smoke test

```
1. git init tmp root; mkdir .faff/runs/run-X/FAFF-9/spec-review
2. write round-1.json (revise, one architectural major) and round-2.json (approve, [])
3. write d.json = [{ key: "1#0", lens: "architectural", disposition: "fixed" }]
4. faff spec-review collate-evidence --dir .faff/runs/run-X/FAFF-9/spec-review --dispositions d.json --comment > c.md
5. assert exit 0; c.md ends with a sha256 line; .faff/runs/run-X/FAFF-9/spec-review-verdict.json exists
6. faff evidence write spec-review-verdict --run-dir .faff/runs/run-X --issue FAFF-9 < c.md
7. assert the file bytes are unchanged by step 6
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4).** No issues. The spec covers one concern: the machine that renders the evidence comment also writes the evidence file. The two entry points share one placement check and one writer, so `collate-evidence --comment` and `write-evidence` are a single deliverable. They are not two independent units. The work sits at the top of the 1–3 day range, and `build-tier: complex` reflects that. A narrower slice is possible. The interactive placement (`.faff/spec-review/<ISSUE>`) has no reader until FAFF-1468 lands, so it could move into FAFF-1468. Keeping it here leaves this ticket as the whole producer and FAFF-1468 as a pure reader, which is the cleaner cut. No split is recommended.

**Workstream fit? (principles 1 + 5).** FAFF-1467 has no project, and neither do its closest siblings: FAFF-1468 (`pr open` finds the evidence), FAFF-1357 (the mint refuses when owed evidence is missing) and FAFF-1449 (graft finds the comment only when the heading leads the body). All four are in Backlog. They converge on one outcome, "spec-review evidence reaches every anchor on main", and the sequencing inside that outcome is real: producer, then reader, then refusal. While they stay loose, nothing orders them as a group, and the next pick-ordering pass can schedule FAFF-1357 before the producer exists. A rehoming pass would decide whether to create an outcome-led home for this cluster. This finding is surfaced only. Nothing is written.

**Deps surfaced? (principle 6).** There is one gap and one stale description.
- Section 1 says FAFF-1357 "builds on" this ticket, and FAFF-1357's refusal only works once the file reliably exists. In the tracker, though, FAFF-1357 is only `relatedTo` FAFF-1467. If FAFF-1357 were built first, the mint would refuse lanes on the same skipped step this ticket removes, and those lanes would park instead of merging. The fix is a link: FAFF-1467 blocks FAFF-1357.
- Step 3 of FAFF-1357's proposed change still says "Graft writes the verdict file when it commits the spec at Step 4". This ticket makes that path unnecessary. If the description is left as it is, a later prep of FAFF-1357 may re-specify a second writer, which goes against this spec's "one writer, one document shape" principle. FAFF-1357's description should be revised to say it consumes the file this ticket produces.
- FAFF-1468 is already correctly `blockedBy` FAFF-1467. FAFF-1449 needs no link to this ticket. It concerns graft's fallback comment lookup, which still matters for builds on another machine, and it belongs with FAFF-1468.

**Risk profile? (principle 7).** Low novelty. The spec reuses the existing writer, leaves `guardWriterPaths` unchanged, and adds no tracker I/O. The risky part is the value claim, not the build. The spec's first failure mode admits the 11 lost files may have a downstream cause, such as a run dir cleaned up before graft minted. If so, the value of this ticket in run mode, where the mint copies `<runDir>/<ISSUE>/spec-review-verdict.json` directly, would not appear even after it lands. A small check before building would retire that risk: for two or three of the traced beep-boop lanes, confirm that prep's scratch dir and graft's mint used the same `<runDir>/<ISSUE>`, and that it still existed at mint time. If they match, this ticket delivers value in run mode as soon as it lands, without waiting for FAFF-1468. If they differ, the run-dir lifetime question belongs ahead of FAFF-1468 rather than inside it.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (operator, 2026-11-04; round-2 minors fixed in place, no round 3)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
