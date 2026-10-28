# FAFF-1404: faff spec commit and faff spec verify: graft commits the reviewed spec byte for byte and checks it before grading

> Spec: faffter-dark-nlspec · 2026-10-27 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1404.

This spec is for the build agent that implements FAFF-1404 and for the humans who review it. It turns graft's Step 4 spec commit from skill prose into a command, and adds a command that checks the committed spec just before Step 8 grades acceptance criteria. It follows the third action in `verification/audits/2026-10-22-repo-review-throughput-cull-split.md` §1.4.

## 1. WHY

**The model this spec turns on:** a command can guarantee a byte-exact copy, and prose cannot. The defect below happened because an agent was told, in prose, to perform a deterministic step by hand: copy a spec without changing it. The command does that step itself and hands back a typed token. The agent keeps only what needs judgement or a tracker call, because the CLI cannot reach the tracker.

**Problem.** Graft's Step 4 lets the agent write the committed spec, and in run `run-20261020-191739-beepboop-list-d57076` a build lane committed a condensed rewrite and graded its acceptance criteria against it. This change moves the spec commit into a command, checks the committed spec again before grading, and lowers graft's line baseline.

### Design principles

**The CLI never touches the tracker.** Every tracker write stays an agent MCP call. Graft still reads the spec from the tracker at Step 2 and hands the commands a local file.

**The typed token is the signal.** As in `faff land`, each command prints one token from a closed set and the skill routes on it. Where judgement is still needed, the token is `needs-judgement` with a reason. The command never makes an LLM call.

**Bytes are written by the command, not relayed by the agent.** Any file whose bytes must match a source is written by the command from that source. The agent never pipes spec text through a shell variable or retypes it.

**No kernel decision moves.** Neither command consults `next`, `eligible`, `run-done` or `queue-state`, so shipping this inside the FAFF-974 collection window (ends 2026-10-31) changes no captured decision.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` lines 47, 236 to 256, Step 8 (line 370 on) | Markdown | Step 4 replaced; Step 8 gains one verify call |
| `bin/lib/land.js`, `test/land.test.mjs` | JavaScript | Shape precedent: flag spec, pure core, injectable deps, typed tokens, `--selftest` |
| `bin/lib/faff-version.js` (FAFF-1395, PR #1138) | JavaScript | `resolveFaffVersion` for `SpecCommitRecord.faff_version` |
| `bin/lib/admissibility.js` | JavaScript | `dodSplit(text, "builder")` |
| `bin/lib/conventions.js`, `bin/lib/config.js` | JavaScript | `commit_subject` scheme; `spec-docs-path` resolver |
| `bin/lib/validate-adapters.js` lines 65 and 74 to 78 | JavaScript | `SKILL_LINE_BASELINE`, `ANCHOR_PHRASES` |

All `bin/lib` paths are under `plugin/skills/faff/`.

**Scope.** This is the third prose-to-command collapse in the §1.4 sequence after `faff land`. It covers the graft spec-commit seam and nothing else in the graft skill.

### Size and recommended split

The split recommended at prep has been applied. The original unit sat at the top of a 1 to 3 day range and covered both the prep attach seam and the graft spec-commit seam. This unit now holds one module of roughly 170 lines, its selftest and tests, the graft prose rewrite and one baseline change.

**Chosen:** split along the seam the original spec named, with this ticket as the graft side and FAFF-1406 as the prep side, blocked by this ticket.

| Part | Ticket | Contents | Baseline it lowers |
|---|---|---|---|
| Graft side | FAFF-1404 (this spec) | `faff spec commit`, `faff spec verify`, the Step 2 capture, graft Step 4 and Step 8 prose | `faff-graft` |
| Prep side | FAFF-1406 | `faff prep attach`, `collate-evidence --from-judge`, the `readStandingResidue` export, `judge-dispositions.js`, prep prose | `faff-prep` |

The two parts share no module. The only coupling is the `spec_sha256` field on the prep marker: FAFF-1406 writes it, and `faff spec commit` reads it as advisory input and works without it.

## 2. OUT OF SCOPE

- **The prep side of the original ticket:** `faff prep attach`, `collate-evidence --from-judge`, the `readStandingResidue` export, `bin/lib/judge-dispositions.js`, the `faff-prep/SKILL.md` rewrite and the `faff-prep` baseline. These are FAFF-1406, which is blocked by FAFF-1404.
- **Making the source-digest check blocking.** This spec records it as advisory only (see 4.1). Tracked as FAFF-1407. *Extension point:* the `source_check` branch in `bin/lib/spec-commit.js`.
- **A merge-time check of the committed spec digest in `governance-check`.** Tracked as FAFF-1408. *Extension point:* a governance-region reader of `<run-dir>/<ISSUE>/spec-commit.json`. A governance module may not require the factory `spec-commit.js`, so the record format must be read without that import.
- **Mechanical dispositions for the refuter-approve and human-accept paths.** Tracked as FAFF-1409, which follows FAFF-1406. *Extension point:* a sibling mode beside FAFF-1406's `--from-judge` on the same `collate-evidence` verb.
- **Auto-restoring a mismatched committed spec.** Discarding a lane's edit is a judgement call. Tracked as FAFF-1410. *Extension point:* a `--restore` flag on `faff spec verify`.
- **The spec-review round and hold commands** (audit §1.4, ninth item). *Extension point:* `faff spec-review round` / `hold`.
- **Graft Steps 4b and 4c** (ADR and decisions materialization).
- **Decision-capture action markers for FAFF-974.** *Extension point:* the token emit site in each command.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Prep marker | `.faff/prep/<ISSUE>.json` in the main checkout, written by prep. `faff spec commit` reads only its `spec_sha256` field: the sha256 of the spec bytes prep staged for posting. FAFF-1406 adds that field. |
| Builder view | `dodSplit(spec, "builder")`: the spec with `holdout`-marked scenarios removed. It is byte-identical to the input when there are none. |
| Captured spec | The full spec text graft read at Step 2, from the tracker comment or `.faff/specs/<ISSUE>.md`, saved to a file before the worktree exists. |

### Commands

```
faff spec commit --issue ID --title TEXT --spec FILE --worktree DIR --run-dir DIR
                 [--prep-root DIR] [--json]
faff spec verify --issue ID --spec FILE --worktree DIR [--run-dir DIR] [--json]
faff spec --selftest
```

**Chosen:** one new `COMMANDS` key, `spec`, with verbs `commit` and `verify`. The issue fixes the name.

`--prep-root` is the main checkout that holds `.faff/prep/`; it defaults to the git common-dir's parent of `--worktree`.

### Types

```
RECORD SpecCommitRecord:                   # <run-dir>/<ISSUE>/spec-commit.json
  issue: String
  path: RepoRelativePath                   # <spec-docs-path>/YYYY-MM-DD-<issue>-<slug>-design.md
  commit: GitSha
  committed_sha256: Hex64                  # sha256 of the builder view as written
  source_sha256: Hex64                     # sha256 of the captured spec file
  holdouts_withheld: Int
  source_check: "match" | "mismatch" | "no-marker"   # vs spec_sha256 in .faff/prep/<ISSUE>.json; advisory
  faff_version: String

RECORD SpecResult:                         # stdout (--json) for spec commit / verify
  issue: String
  token: "committed" | "already-committed" | "needs-judgement" | "verified" | "mismatch" | "errored"
  reason?: String
  path?: RepoRelativePath
  commit?: GitSha
  source_check?: "match" | "mismatch" | "no-marker"
  differs?: List<"head" | "working-tree">  # on "mismatch"
```

**Chosen:** follow `faff land`'s exit convention. Every typed token exits 0 except `errored` (exit 2, and usage errors exit 2 through `usageError`), with one exception: `faff spec verify` exits 1 on `mismatch`. Verify is a predicate, and a later governance caller (FAFF-1408, see Out of scope) will want to read it by exit code, as `faff contract` callers do.

### Token routing (what the skill does)

| Command | Token | Skill action |
|---|---|---|
| spec commit | `committed`, `already-committed` | Continue to Step 5 |
| spec commit | `needs-judgement:committed-spec-differs` or `needs-judgement:uncommitted-file-at-path` | Autonomous: park needs-human. Interactive: surface both paths |
| spec commit | `errored` | Refuse the build, as today's split failure does. Never commit the full spec instead |
| spec verify | `verified` | Grade ACs against `path` |
| spec verify | `mismatch` | Do not grade ACs. Autonomous: park needs-human. Interactive: surface |
| spec verify | `errored` | Do not grade ACs, the same as `mismatch`: verify fails closed. Autonomous: park needs-human. Interactive: surface the reason |

## 4. HOW

### 4.1 `faff spec commit`

**Summary:** write the builder view of the captured spec into the worktree, commit only that file, and record its digest in the run directory for `spec verify`.

```
PROCEDURE spec_commit(issue, title, spec_path, worktree, run_dir, prep_root):
  0. issue must match ^[A-Za-z][A-Za-z0-9]*-[0-9]+$, else usage error (exit 2). title := title with
     every run of whitespace or control characters (newlines included) replaced by one space, trimmed;
     empty after that → usage error (exit 2).
  1. source := read spec_path as bytes. Unreadable → errored.
  2. builder := dodSplit(source, "builder").text. A throw → errored, reason
     "builder-split-failed". Nothing is written, and there is never a full-spec fallback.
  3. dir  := spec-docs-path resolver run against worktree (creating the directory as --create does)
     slug := title lowercased; each run of characters outside [a-z0-9] becomes one "-";
             leading and trailing "-" trimmed
     rel  := dir/<today YYYY-MM-DD>-<issue>-<slug>-design.md     # issue id exactly as passed
     rel must resolve inside worktree/dir (realpath containment); otherwise errored, reason "path-outside-spec-dir".
  4. Existing spec for this issue: list dir in HEAD and keep the names whose issue field equals issue,
     parsing the filename grammar: the name is <YYYY-MM-DD>-<id>-<rest>.md, where <id> is the
     tracker-key-shaped token directly after the date (^[0-9]{4}-[0-9]{2}-[0-9]{2}-([A-Za-z][A-Za-z0-9]*-[0-9]+)-),
     compared to issue case-insensitively. An id that appears later in the slug never matches.
     No shell glob is used, so no metacharacters apply.
       no match                            → continue to step 5
       every match has bytes == builder    → token already-committed (rewrite the record if absent)
       any match differs from builder      → token needs-judgement, reason "committed-spec-differs",
                                             path = the first differing file, paths = every match;
                                             write nothing. This wins over already-committed, so one
                                             identical file never hides a divergent one.
  5. If worktree/rel already exists (an untracked or modified file HEAD does not hold):
       its bytes == builder → do not rewrite; commit it in step 7 as is
       its bytes differ     → token needs-judgement, reason "uncommitted-file-at-path", path = rel;
                              write nothing and leave the file untouched
     Otherwise write builder to worktree/rel as exact bytes (no trailing-newline normalization),
     and remember that this call created the file.
  6. subject := commit_subject scheme from conventions:
       conventional    → "docs(<issue>): add spec for <title>"
       bare-imperative → "Add spec for <title> (<issue>)"
  7. git -C worktree add -- rel; git -C worktree commit -m subject -- rel.
     Commit failure → delete the file only if this call created it in step 5 → errored with git's exit code.
  8. source_check := compare sha256(source) with the spec_sha256 field of
     prep_root/.faff/prep/<issue>.json:
       no marker or no field → "no-marker"; equal → "match"; else "mismatch".
  9. Write SpecCommitRecord to run_dir/<issue>/spec-commit.json → token committed.
```

- The issue id goes into the filename exactly as passed, after step 0 has checked it against the tracker-key shape. Most committed specs use the uppercase id (`records/specs/2026-10-20-FAFF-1356-…-design.md`), but a few are lowercase (`2026-10-24-faff-1112-…`), so the existing-spec match compares the id case-insensitively.
- Today's prose captures the builder view with `builder_view=$(…)`, and shell command substitution strips trailing newlines. Writing in-process removes that silent byte change.
- `faff_version` on the record is `resolveFaffVersion().version`, called in-process.
- Until FAFF-1406 lands, the prep marker has no `spec_sha256` field, so `source_check` is `no-marker` on every build. That is expected and is not a failure. The field contract this command reads is fixed here so FAFF-1406 can write to it: `spec_sha256` is the lowercase hex sha256 of the exact bytes prep staged for posting. A fixture test exercises `match` and `mismatch` now, and FAFF-1406's DONE list must include a real-marker check that `spec commit` reads its field as `match`.

**Chosen:** validate the issue id against `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` and collapse whitespace and control characters in the title before either is used. Both come from the tracker, so neither may steer the write path, the existing-spec match or the commit message; a newline in the title could otherwise add trailer lines to the commit.

**Chosen:** never overwrite or delete a file the command did not create. An untracked file at `rel` with different bytes is a lane's or an earlier attempt's work, so the command stops with `needs-judgement` instead of choosing between two versions.

**Chosen:** the command writes and commits the file itself; the agent never handles the bytes. That is the only way to enforce "committed spec byte-identical to the reviewed spec" at commit time.

**Chosen:** the source check is advisory. It is recorded and printed, and never changes the token. Prep's `spec_sha256` covers the bytes it staged for posting, and graft's captured file comes back through the tracker MCP. Whether a Linear comment survives that round trip byte for byte is unverified, so a blocking check could stop every build on a markdown normalization. Recording it gives the evidence to decide later (FAFF-1407, see Out of scope).

### 4.2 `faff spec verify` (before AC verification)

**Summary:** check, just before Step 8 grades acceptance criteria, that the spec file the grader will read is still the builder view of the captured spec, both in HEAD and in the working tree.

```
PROCEDURE spec_verify(issue, spec_path, worktree, run_dir):
  1. expected := dodSplit(read spec_path, "builder").text
  2. dir  := the spec-docs-path resolver run against worktree (no --create)
     path := run_dir/<issue>/spec-commit.json .path if that record exists, else the single match in HEAD
             by spec commit's step 4 filename grammar. Zero or several → errored with the list.
     path must resolve inside worktree/dir (realpath containment), whichever source supplied it;
     otherwise errored, reason "path-outside-spec-dir". A record never points the grader outside
     the spec directory.
  3. head := the blob at HEAD:path;  wt := worktree/path read as bytes
  4. differs := [ "head" if head != expected ] + [ "working-tree" if wt != expected ]
  5. differs empty → token verified (exit 0); else token mismatch with differs (exit 1)
```

**Chosen:** compare against the captured spec re-split now, not only against the recorded digest. A resumed build reuses a worktree whose commit was recorded in an earlier run directory, and every graft run captures the spec at Step 2 anyway. Checking the working tree as well as HEAD catches an uncommitted rewrite, which is the file the grader actually reads.

**Chosen:** call verify from graft immediately before Step 8 sources the AC list, and pass the verified `path` to `faff dod classify --spec`. The logged defect was a later lane rewriting the committed spec after Step 4, so a commit-time guarantee alone would not have caught it.

### 4.3 Registration and regions

**Chosen:** the new module `spec-commit.js` is region `factory`, with the banner `// === region:factory — <name> — FAFF-1404: <summary> ===` on line 2 or 3. It requires factory and governance modules only in the allowed direction, and nothing in governance requires it.

- `COMMANDS` in `bin/faff`: `spec: cmdSpec` via the lazy-require helper.
- `REGION_MAP`: `spec: "factory"`.
- `REGION_SELFTEST_ARGV`: `spec: ["spec", "--selftest"]`.
- `docs/guide/cli.md`: one row for `spec commit|verify`.

### 4.4 Prose rewrites

**faff-graft/SKILL.md**

- Step 2: save the captured spec to `.faff/graft/<ISSUE>/captured-spec.md` in the main checkout, exactly as read. This capture is the one copy still written by the agent rather than a command, because only the agent can read the tracker. A paraphrase here would pass both `spec commit` and `spec verify`, since both compare against the captured file. The check over this link is `source_check`, which needs FAFF-1406's `spec_sha256` to fire and stays advisory until FAFF-1407; this residual risk is accepted for this ticket and listed in the failure modes (the tracker comment body, or a byte copy of `.faff/specs/<ISSUE>.md`). Step 2 runs before standalone interactive graft mints `$run_dir` (Step 3), so the capture cannot live in the run directory. `.faff/.gitignore` already ignores everything under `.faff/` except named entries.
- Step 4 (lines 236 to 256): replace with the `faff spec commit` call, its token routing, and the existing-worktree skip rule. The holdout-withholding rationale shrinks to one sentence: the command commits the builder view and never the full spec.
- Step 8: before sourcing the AC list, call `faff spec verify` and route on its token; pass the verified `path` to `faff dod classify --spec`.
- The `ANCHOR_PHRASES` for faff-graft live at lines 353 and 863 and are not touched.

**validate-adapters.js:** lower `SKILL_LINE_BASELINE["faff-graft"]` to the exact new size (`wc -l` plus 1), with a `FAFF-1404 -N` note in the inline comment in the house style. `ANCHOR_PHRASES` is unchanged.

### 4.5 Edge cases

- **spec commit when the worktree has other staged changes:** `commit -- rel` commits only the spec path.
- **spec commit when the prep marker is missing or has no `spec_sha256`:** `source_check` is `no-marker` and the token is unaffected. This is every build until FAFF-1406 lands.
- **spec verify with no `--run-dir` record and no committed file:** `errored`, reason "no-committed-spec". Graft treats it like `mismatch` and does not grade ACs.
- **An issue id with `/`, `..` or glob characters, or a multi-line title:** step 0 refuses the id; the title is collapsed to one line.
- **Another issue's spec whose slug contains this issue's id** (for example `2026-10-20-FAFF-9-fix-ex-3-flake-design.md` when committing EX-3): not a match, because the filename grammar reads only the id after the date.
- **Two committed files for the same issue, one identical and one not:** `needs-judgement:committed-spec-differs`, naming both.
- **A resumed worktree with an uncommitted spec draft at `rel`:** identical bytes are committed as they are; different bytes return `needs-judgement:uncommitted-file-at-path` and the draft is left untouched.

### 4.6 Failure modes

| The failure | How you'd know | What it means |
|---|---|---|
| Linear normalizes markdown on save, so `source_check` is `mismatch` on unedited specs (observable only once FAFF-1406 writes `spec_sha256`) | `spec-commit.json` shows `source_check: "mismatch"` on builds whose tracker spec nobody edited | Expected, given 4.1's choice. Keep the check advisory; any future blocking check must compare a normalized form or digest the fenced readiness block only |
| The lane edits the spec to make an AC pass | `spec verify` returns `mismatch` | Working as intended; the park carries the evidence |
| The agent paraphrases the spec at the Step 2 capture | Nothing before FAFF-1406 lands. After it, `source_check` is `mismatch` on that build | The accepted residual risk of this ticket: commit and verify guarantee fidelity to the captured file, not to the tracker. FAFF-1406 makes it visible and FAFF-1407 makes it blocking |
| FAFF-1406 writes `spec_sha256` in a different form (for example uppercase hex, or a digest of the unstamped spec) | `source_check` is `mismatch` on the first builds after FAFF-1406 lands | The field contract in 4.1 was not followed; fix the writer. The check is advisory, so nothing was blocked |

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec with one holdout-fenced scenario, and a git worktree with no spec committed for EX-3
When  faff spec commit --issue EX-3 --title "Add a thing" --spec s.md --worktree wt --run-dir rd --json runs
Then  the token is "committed"
And   HEAD's last commit touches exactly one file, matching docs/specs/*-EX-3-add-a-thing-design.md
And   that file's bytes equal faff dod split --view builder of s.md
And   rd/EX-3/spec-commit.json records the same path and committed_sha256
```

```
Given the state after the scenario above, and a later commit that removes one DONE line from the committed spec
When  faff spec verify --issue EX-3 --spec s.md --worktree wt --run-dir rd --json runs
Then  the token is "mismatch", differs includes "head", and the exit code is 1
```

- No `faff spec` invocation makes a network call or a tracker call.

## 5. DESIGN DECISION RATIONALE

**Should the byte-identity guarantee stop at commit time?**
- Commit only: misses the logged defect, which was a later rewrite.
- Verify against the recorded digest only: fails on resumed builds whose record is in an earlier run directory.
- **Chosen:** commit writes the bytes, and verify re-splits the captured spec and checks HEAD and the working tree before Step 8.

**Should the tracker round trip be checked as a blocker?**
- Blocking: unverified Linear byte fidelity could stop every build.
- Not at all: loses the evidence needed to decide later.
- **Chosen:** advisory `source_check`, recorded on every commit.

**Shell out or call in-process?**
- **Chosen:** in-process. `dodSplit`, `resolveFaffVersion`, the `spec-docs-path` resolver and the `commit_subject` scheme are all pure exports of factory or governance modules, which a factory module may require. Shelling out to `faff dod split` or `faff version` would add process spawns and a second parse of each output, and command substitution would strip the trailing newlines the byte-identity guarantee depends on.

**Exit codes?**
- **Chosen:** `land`'s convention (typed token is the signal; `errored` exits 2), with verify's `mismatch` exiting 1 because it is a predicate.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1395 (PR #1138) has merged before this build starts, giving `resolveFaffVersion()` in `bin/lib/faff-version.js`, which supplies `SpecCommitRecord.faff_version`. *Check:* `git log --oneline -- plugin/skills/faff/bin/lib/faff-version.js` on the base branch shows the merge, and `node plugin/skills/faff/bin/faff version --json` prints `{"version":…,"source":…}`. FAFF-1395 merged to `main` on 2026-10-27 as `3f496e05`, so the build branch must be cut from an `origin/main` that contains that commit. If the base does not contain it, fetch and rebase first; if the export is still missing after that, stop and report the contradiction.

## 7. DONE

### From WHY
- [ ] Graft's committed spec equals `faff dod split --view builder` of the captured spec, byte for byte, including trailing newlines.
- [ ] The committed filename carries the issue id exactly as passed to `--issue` (an uppercase id stays uppercase).

### From WHAT (commands and types)
- [ ] `faff spec commit` and `faff spec verify` accept the flags in section 3; an unknown flag or a missing required flag exits 2.
- [ ] `--json` output for each call matches `SpecResult`, and `token` is always one of the listed values.
- [ ] `spec-commit.json` carries every `SpecCommitRecord` field.
- [ ] Every typed token exits 0 except `errored` (exit 2) and `spec verify`'s `mismatch` (exit 1).

### From HOW (spec commit and verify)
- [ ] spec commit's commit contains exactly one path, and its subject follows the resolved `commit_subject` scheme (`conventional` and `bare-imperative` both covered).
- [ ] A second spec commit with the same input returns `already-committed` and creates no commit.
- [ ] spec commit with a differing committed spec for the issue already in HEAD returns `needs-judgement` with reason `committed-spec-differs` and writes nothing.
- [ ] A failed `git commit` leaves no new file in the worktree and returns `errored`.
- [ ] An `--issue` value outside `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` (for example `../x-1` or `EX-*`) exits 2 and writes nothing.
- [ ] A `--title` containing a newline produces a single-line commit subject, and the commit message has no extra lines.
- [ ] An untracked file at `rel` with different bytes returns `needs-judgement` with reason `uncommitted-file-at-path` and is left byte-identical; with identical bytes, the file is committed and the token is `committed`.
- [ ] A failed `git commit` never deletes a file that existed before the call.
- [ ] A committed spec for another issue whose slug contains this issue's id (`…-FAFF-9-fix-ex-3-flake-design.md` for `--issue EX-3`) is not treated as a match.
- [ ] With two committed files for the issue, one identical to the builder view and one not, spec commit returns `needs-judgement` with reason `committed-spec-differs` and lists both.
- [ ] `source_check` is `match`, `mismatch` or `no-marker` according to the prep marker's `spec_sha256`, is `no-marker` when that field is absent, and never changes the token. A fixture marker whose `spec_sha256` is the lowercase hex sha256 of the captured spec gives `match`.
- [ ] spec verify returns `mismatch` with `differs: ["head"]` for a committed rewrite and `["working-tree"]` for an uncommitted one.
- [ ] Graft's Step 8 prose routes verify's `errored` the same as `mismatch`: ACs are not graded.
- [ ] spec verify with a `spec-commit.json` whose `path` resolves outside the spec directory returns `errored` with reason `path-outside-spec-dir`.

### From HOW (registration, prose, ratchet)
- [ ] `faff regions check` passes with `spec-commit.js` carrying a `region:factory … FAFF-1404` banner.
- [ ] `faff lint-cli-doc` and `faff lint-cli-coverage` pass with the new `docs/guide/cli.md` row.
- [ ] `faff spec --selftest` exits 0 and is wired in `REGION_SELFTEST_ARGV`.
- [ ] `faff-graft/SKILL.md` Step 2 saves the captured spec to `.faff/graft/<ISSUE>/captured-spec.md`.
- [ ] `faff-graft/SKILL.md` Step 4 calls `faff spec commit`, Step 8 calls `faff spec verify` before sourcing the AC list, and neither step contains the `builder_view=$(` shell capture.
- [ ] `SKILL_LINE_BASELINE` for `faff-graft` equals the file's new size, `ANCHOR_PHRASES` is unchanged, and `faff validate-adapters` reports no RATCHET and no FAIL for that skill.

### Tests
- [ ] `test/spec-commit.test.mjs` exists, runs under `node --test`, and passes. It follows `test/land.test.mjs`: a pure core driven with fake deps, plus real CLI runs on a `mkdtempSync` fixture repo.

### Integration smoke test

```
PROCEDURE smoke():
  1. tmp repo with docs/, a .faff/config.yaml, and a fixture spec s.md (one holdout fence, a valid readiness block)
  2. cp s.md .faff/graft/EX-1/captured-spec.md; git worktree add wt -b feat
  3. faff spec commit --issue EX-1 --title "Fixture" --spec .faff/graft/EX-1/captured-spec.md
       --worktree wt --run-dir rd --json                                   → committed, source_check "no-marker"
  4. faff spec verify --issue EX-1 --spec .faff/graft/EX-1/captured-spec.md --worktree wt --run-dir rd
                                                                           → verified, exit 0
```

confidence: high
build-tier: complex
spec-review: accept (human, after round 2)

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

The first critique (2026-10-27) recommended splitting along the spec's prep and graft seam. The operator chose the split, and this spec is now the graft side. The prep side is [FAFF-1406](https://linear.app/shftwst/issue/FAFF-1406), blocked by this ticket, and should land second.

- **Right-sized:** no issues after the split. This unit is two commands, one module and the graft prose, lowering only the `faff-graft` baseline.
- **Workstream fit:** no issues. Project-less Backlog; FAFF-1404, FAFF-1405 and FAFF-1406 share an outcome and are a candidate cluster for a later rehoming pass.
- **Deps surfaced:** FAFF-1395 has merged (2026-10-27, `3f496e05`), so it no longer blocks; build on an `origin/main` that contains it. FAFF-1405 edits the same `faff-graft/SKILL.md` and baseline, so whichever lands second rebases (related link added). FAFF-1349 names graft Step 4 as an over-long-spec failure seam that this ticket's commands replace (related link added). The four named follow-ups are filed: FAFF-1407, FAFF-1408, FAFF-1409 and FAFF-1410.
- **Risk profile:** Linear byte fidelity is unverified, so `source_check` stays advisory and is `no-marker` until FAFF-1406 lands. This half does not touch prep's turn-end guard.
