# FAFF-1478: put human-only-acs.json on the evidence roster

> Spec: faffter-dark-nlspec · 2026-11-15 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1478.

This spec adds `human-only-acs.json` to the per-issue evidence roster that the dispatcher digest-verifies, and to the forge surface the integrity cage and custody snapshot cover. It follows FAFF-1475 (merged) and FAFF-1476 (merged). It is written for the build agent and for the human reviewers who approve it.

Where the ticket text and the code disagree, this spec follows the code. The ticket says the roster is `ac-checklist.json`, `review-verdict.json` and `holdout.json`. In the code, `EVIDENCE_FILES` (the roster behind `faff evidence return` and `faff evidence verify-return`) holds two files, `ac-checklist.json` and `review-verdict.json`. `holdout.json` is in `correctiveIntegrityDirs`, the second roster, and not in `EVIDENCE_FILES`. FAFF-1478 touches both rosters for the new file.

## 1. WHY: problem and principles

**The load-bearing model.** Two separate rosters name the per-issue files a gate trusts. `EVIDENCE_FILES` (in `plugin/skills/faff/bin/lib/evidence.js`) lists the files whose digests a dispatched lane returns and the dispatcher re-hashes. `correctiveIntegrityDirs` (in `plugin/skills/faff/bin/lib/corrective-integrity.js`) lists the paths the integrity cage declares and the custody snapshot hashes. `human-only-acs.json` is on neither. This change appends it to both, by the same single resolver each roster already has, so no new code path, command or module is introduced. "The dispatcher persists the returned copy" means one thing in code: the dispatcher appends the verified digest to the run ledger's `evidence_persisted` entry. The file itself is never rewritten.

**Problem statement.** `faff pr open` mints `human-only-acs.json` and a `human-only-acs-stamp` event, and an unattended merge skips a pending human-only AC on the strength of that file. Unlike `ac-checklist.json` and `review-verdict.json`, the file is not on either roster, so a lane can rewrite the run-dir copy after it returns, or append its own newer stamp, and no digest catches it. This change puts the file on both rosters, so a change to the run-dir copy between the lane's return and the dispatcher's read (or before the merge locus) parks the unit, and the custody snapshot covers the file on the top-level unattended path. It does not close the whole gap. The merge floor decides the skip from the committed anchored copy, which the roster does not digest: this change adds a tamper witness over the run-dir copy, and binding the anchored copy, the actual decision input, is FAFF-1483.

**Design principles.**

**Never weaken the check to make the roster change pass.** A skewed return (old shape against a new dispatcher, or the reverse) parks. It is never accepted by treating a missing key as "no claim, no problem". The 1397 principle (the verifier accepts nothing the exact-key rule rejects) carries over unchanged.

**One resolver per roster.** Every per-file loop reads `EVIDENCE_FILES`, and every path list reads `correctiveIntegrityDirs`. No second hand-written list of the three files, and no hard-coded two-key literals, remain in `evidence.js` after this change.

**Say plainly what the digest covers, and why the run-dir copy is still worth witnessing.** It covers the run-dir copy of the file. That copy is the source the anchor is minted from: `faff events anchor` byte-copies it into the committed anchor, so after the lane has returned, any change to what the merge floor reads that goes through the mint (a re-run of `faff pr open`, a re-mint) must first change the run-dir copy, and the digest catches that. What it cannot catch is a lane that edits the committed anchored file by hand in a later commit, which is the residual FAFF-1483 closes. The merge floor reads the committed, anchored copy and checks it against the events stamp. The roster is a tamper witness over the run-dir copy and over a lane that rewrites the file and appends a newer stamp after it returned. It does not make the content independent of the lane that authored it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/evidence.js` (`EVIDENCE_FILES` line 1458, `evidenceReturn`, `wellFormedReturn`, `claimFromLedger`, `claimFromStdin`, `verifyReturn`, selftest ~1665) | JavaScript, governance region | The digest roster and both verbs; gains one member |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` (`correctiveIntegrityDirs` line 211, selftest 463 to 478) | JavaScript, factory region | The cage and custody roster; gains one member |
| `plugin/skills/faff/bin/lib/integrity-digest.js` (`memberRels` line 138) | JavaScript, factory region | Reads `correctiveIntegrityDirs`; gains the member with no edit |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` (`resolveIntegrity` line 272, `readAnchoredHumanOnly` line 380) | JavaScript | Probe consumer of the roster; reads the anchored copy for the skip. Not edited |
| `verification/evidence/v0.3/schema/run-ledger.schema.json` line 473, mirrored to `plugin/skills/faff/contracts/evidence-v0.3/schema/` by `scripts/evidence-v0.3-compose.mjs` | JSON Schema | `evidence_persisted` items are `additionalProperties:false`; gain one optional property |
| `plugin/skills/faff/references/l4.md` line 67 (obligation 6) | Markdown, skill prose | Canonical `EvidenceReturn` shape; edited |
| `plugin/skills/faff-graft/SKILL.md` lines 555 and 795 | Markdown, skill prose | "seven-entry forge surface" and the lane-side shape; edited in place |
| `plugin/skills/faff/references/kernel.md` line 287 | Markdown | Lists the `correctiveIntegrityDirs()` roster; edited |
| `docs/guide/cli.md` lines 230 and 231 | Markdown | `evidence return` and `evidence verify-return` rows; edited |
| `verification/evidence/v0.3/evidence-documents.md` (the `human-only-acs.json` trust note, lines 158 to 177) and `verification/evidence/README.md` changelog | Markdown | Trust note names FAFF-1478 as the gap; updated |
| `records/adr/0077-two-class-write-authority-for-run-artifacts-evidence-writes-cross-to-the-trusted.md` | Markdown (ADR) | Carries a Consequences bullet per amendment; gains one |
| `test/evidence-return.test.mjs`, `test/corrective-integrity.test.mjs`, `test/integrity-boundary.test.mjs`, `test/integrity-digest.test.mjs` | JavaScript, node:test | Pin the two-file shape and the 7 and 8 entry counts |

**Scope statement.** This is a roster change inside the evidence handoff between `faff-graft` and the two `concurrency` executors, plus the custody and cage roster; it adds no command, module, event type or merge-floor rule.

## 2. OUT OF SCOPE

- **Name:** binding the committed (anchored) copy of `human-only-acs.json` to the ledger digest.
  - **Why excluded:** the merge floor reads the anchored blob and the events stamp, not the run-dir copy this roster digests. A dispatcher check that the anchored blob's bytes equal the ledger digest would make the roster protect the bytes the floor consumes. It is a new check with its own failure modes, and it is not what this ticket names. That follow-up was filed and linked at prep time (2026-11-15): FAFF-1483, in Backlog, `relatedTo` FAFF-1478, FAFF-1475 and FAFF-748. It is not a build deliverable, so no DONE item depends on it.
  - **Related, done at prep:** FAFF-748 and FAFF-517 are linked `relatedTo` from both FAFF-1478 and FAFF-1483.
  - **Extension point:** `faff evidence verify-return` (a `--anchored` read through `readAnchoredBytes` in `merge-gate-floor.js`) or `readHumanOnlyAcs` in `human-only-acs.ts`.
- **Name:** lane isolation so the lane cannot write the run-dir copy at all.
  - **Why excluded:** FAFF-517. At rung 0 the lane and the dispatcher share one run-dir path.
  - **Extension point:** FAFF-517's lane-boundary work.
- **Name:** content authorship. The lane still invokes the writer and chooses what to write.
  - **Why excluded:** FAFF-748 owns moving the writer out of the lane. The digest detects change after return, not a dishonest first write.
  - **Extension point:** FAFF-748.
- **Name:** admission refusals for specs with unmarked human-verified items.
  - **Why excluded:** FAFF-1477.
  - **Extension point:** the admission code FAFF-1477 names.
- **Name:** any change to the skip rule in `readAcFloor`, the stamp mechanism, `faff evidence write human-only-acs`, or `faff pr open`.
  - **Why excluded:** the roster change needs none of them, and FAFF-1475 settled them.
  - **Extension point:** none required.
- **Name:** FAFF-1339, the check that each delegated `ac_id` has a `passed: true` row.
  - **Why excluded:** a different completeness check on a different file.
  - **Extension point:** FAFF-1339.
- **Name:** a version field on `EvidenceReturn`, so a future roster addition could be accepted across releases.
  - **Why excluded:** the strict exact-key shape is the 1397 rule, and a version field would be a new tolerance rule that weakens it. Each roster addition therefore parks an in-flight dispatched run on upgrade, which the release-note line covers.
  - **Extension point:** the `EvidenceReturn` shape in `l4.md` obligation 6.
- **Name:** renaming `evidence_persisted`, or a new evidence contract version.
  - **Why excluded:** the property added is optional and additive; every committed anchor that validated still validates.
  - **Extension point:** the next evidence contract version under `plugin/skills/faff/contracts/`.

## 3. WHAT: vocabulary, types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| roster (digest) | `EVIDENCE_FILES`: the per-issue files `faff evidence return` hashes and `faff evidence verify-return` re-hashes |
| roster (custody) | `correctiveIntegrityDirs(runDir, issue, opts)`: the paths the integrity-boundary declaration names and `faff integrity-digest snapshot` hashes |
| strict shape | a return carries exactly the keys the roster derives, no more and no fewer |
| persisted | the verified digest appended to the ledger's `evidence_persisted`; the file is not rewritten |

**Types.**

```
RECORD EvidenceDigest:
  present: boolean              # false iff sha256 is null
  sha256: Hex64 | null          # leaf sha256 of the file bytes, lowercase

RECORD EvidenceReturn:          # one JSON line, printed by `faff evidence return`
  issue: string
  ac_checklist: EvidenceDigest
  review_verdict: EvidenceDigest
  human_only_acs: EvidenceDigest        # NEW; exactly these four keys, any other key is malformed

RECORD EvidencePersistedEntry:  # item of run-ledger.json evidence_persisted
  issue: string
  ac_sha256?: Hex64
  review_verdict_sha256?: Hex64
  human_only_acs_sha256?: Hex64         # NEW; optional; present iff human-only-acs.json matched

CONSTANT EVIDENCE_FILES = [
  { key: "ac_checklist",   name: "ac-checklist.json",   shaKey: "ac_sha256" },
  { key: "review_verdict", name: "review-verdict.json", shaKey: "review_verdict_sha256" },
  { key: "human_only_acs", name: "human-only-acs.json", shaKey: "human_only_acs_sha256" },   # NEW, third
]

FUNCTION correctiveIntegrityDirs(runDir, issue, opts):
  # no issue: 2 entries; {events:true}: 3          (unchanged)
  # issue:    8 entries (was 7); with {events:true}: 9 (was 8)
  per-issue order: ac-checklist.json, review-verdict.json, holdout.json,
                   human-only-acs.json (NEW), merge-record.json, post-merge-verification.json
```

**Verdict shape.** `faff evidence verify-return` prints `files` with three rows in roster order: `ac-checklist.json`, `review-verdict.json`, `human-only-acs.json`. Every other verdict field keeps its type and meaning. The cause table is unchanged; `<issue>/human-only-acs.json` can now appear in `park_cause`, `paths` and `tampered_paths`.

**Ledger schema.** In both copies of `run-ledger.schema.json`, `evidence_persisted.items.properties` gains `"human_only_acs_sha256": { "type": "string" }`, matching the two existing digest properties (type only, no pattern). It is not in any `required` list.

**Design decisions** are collected in section 6.

## 4. HOW: behaviour

**Behaviour summary.** The lane's last action (`faff evidence return`) now hashes three files instead of two. The dispatcher's `faff evidence verify-return` re-hashes the same three and compares. On agreement it prints one `evidence_persisted` entry that includes `human_only_acs_sha256` when the file matched; the dispatcher appends it to the ledger through obligation 5's re-baseline sequence, exactly as for the other two digests. Before the merge locus, `verify-return --against-ledger` reads the entry back and compares again. Separately, the custody snapshot and the cage declaration cover the file because the roster function lists it.

```
PROCEDURE evidence_return(run_dir, issue):                     # lane side
  1. issue_dir = guard_paths(run_dir, issue)
  2. out = { issue }
  3. FOR each f IN EVIDENCE_FILES, in order:
       leaf = read_leaf_no_follow(issue_dir / f.name)
       IF leaf.kind == absent:        out[f.key] = { present: false, sha256: null }
       ELSE IF leaf.kind != regular:  fail exit 2 "<name> is not a regular file"
       ELSE:                          out[f.key] = { present: true, sha256: leaf.sha256 }
  4. print JSON(out) + newline; exit 0

PROCEDURE well_formed_return(parsed, issue):
  1. keys required = ["issue"] + [f.key FOR f IN EVIDENCE_FILES]      # derived, not literal
  2. IF parsed lacks exactly these keys OR parsed.issue != issue: RETURN false
  3. FOR each f: digest must have exactly {present, sha256}; present boolean;
       present ? sha256 is lowercase hex64 : sha256 is null
  4. RETURN true

PROCEDURE no_claim_digests():                                  # replaces two hard-coded two-key literals
  RETURN map f.key -> { present: false, sha256: null } FOR f IN EVIDENCE_FILES
  # used by claim_from_stdin (stdin "null") and claim_from_ledger (no entry for the issue)

PROCEDURE claim_from_ledger(issue_dir, issue):
  1. entry = last evidence_persisted entry whose issue == issue
  2. IF none: RETURN { noClaim: true, returned: no_claim_digests() }
  3. FOR each f IN EVIDENCE_FILES:
       IF entry[f.shaKey] undefined: returned[f.key] = absent       # omitted digest is an absence claim
       ELSE IF not hex64: fail exit 2 "run-ledger.json evidence_persisted entry for <issue> has a malformed <shaKey>"
       ELSE: returned[f.key] = { present: true, sha256: entry[f.shaKey] }
```

`verify_return` and `evidence_return` need no other change: both already loop over `EVIDENCE_FILES`. The per-file classification (`match`, `absent-both`, `presence-disagreement`, `hash-mismatch`, `not-regular-file`, `no-claim`), the `park_cause` text and the exit codes are unchanged.

**The cage and custody roster.** `correctiveIntegrityDirs` gains `path.join(runDir, issue, "human-only-acs.json")`, after `holdout.json` and before `merge-record.json`. `memberRels` in `integrity-digest.js`, `resolveIntegrity` in `merge-gate-floor.js`, `faff integrity-boundary --run-dir <dir> --issue <id> [--events]` and `faff integrity-digest snapshot|verify --issue <id>` all read that function, so they pick the member up with no edit. Two consequences follow, both already true for `ac-checklist.json`:

- The member is snapshotted byte-exact, and a file absent at snapshot and at verify is recorded `{present:false}` on both sides, so a run that never minted the file does not false-flag.
- A run-dir-grain boundary declaration emitted by an older plugin release names seven entries, so it fails the new roster's coverage test. The merge floor treats that `dir-mismatch` as a violation that refuses above the digest consult, so a merge on such a run is refused, not parked and continued. A launch-grain declaration (the default, the ancestor `<root>/.faff/runs`) covers the new member and is unaffected. The declaration is read from the lane process's environment at exec time and is emitted once per pass, so re-dispatching inside the same pass cannot change it. The recovery is a new pass, or a relaunched cage, under the new release, which emits a launch-grain declaration that covers the new member. The caller audit in the rollout DONE items below bounds how many runs can hit this.

**Obligation 6 order of events (unchanged).** The lane's `faff pr open` (graft Step 9b) mints the file before the lane's final `faff evidence return`, so the digest is taken after the file exists. A run whose `pr open` never minted the file (`unminted`) or never reached Step 9b returns `human_only_acs:{present:false,sha256:null}`, which agrees with the absent file and persists nothing for it.

**Prose edits (in place, no new section).**

- `l4.md` obligation 6: the shape becomes `EvidenceReturn { issue, ac_checklist:{present,sha256}, review_verdict:{present,sha256}, human_only_acs:{present,sha256} }`; "re-hashes `ac-checklist.json` / `review-verdict.json`" gains `/ human-only-acs.json`; one sentence is added to **Honest scope**: for `human-only-acs.json` the digest covers the run-dir copy the lane minted, while merge-gate reads the committed anchored copy against the events stamp, so the digest is a tamper witness and not the bytes the floor consumes. Obligation 7 is unchanged: the merge consumes `ac-checklist.json` and `review-verdict.json` from the run dir, and the pre-merge `--against-ledger` re-verify now covers all three through the same command.
- `faff-graft/SKILL.md` line 795: the shape matches obligation 6. Line 555: "seven-entry" becomes "eight-entry". Both edits are in place and add no line.
- `references/kernel.md` line 287: the roster list gains `<issue>/human-only-acs.json` after `holdout.json`.
- The two executors (`faffter-noon-concurrency-sequential/SKILL.md` line 40, `faffter-dark-concurrency-parallel/SKILL.md` lines 43 and 99) say the shape and exit branches are the gateway's and do not restate them. Their obligation 7 placement prose (sequential line 42, parallel line 103) names `ac-checklist.json` / `review-verdict.json` as the evidence the merge consumes, which stays true because the floor reads those two from the run dir. They are not edited, and a DONE item checks that they stay free of the shape.
- `docs/guide/cli.md` rows for `evidence return` (line 230) and `evidence verify-return` (line 231): the shape, the file order in `files`, and the digest list gain the third file.
- `verification/evidence/v0.3/evidence-documents.md`, `human-only-acs.json` trust note: the sentence "the file is not yet on the dispatcher's evidence roster ... FAFF-1478 adds the file to the roster" becomes a statement that the file is on both rosters since FAFF-1478, what that detects (a change to the run-dir copy after the lane returned, including a rewrite paired with a newer stamp), and the residual (content authorship, FAFF-748; the anchored copy is not digested by the roster; isolation, FAFF-517). The `plugin/skills/faff/contracts/evidence-v0.3/` copy is regenerated by `node scripts/evidence-v0.3-compose.mjs`.
- `verification/evidence/README.md` changelog: one dated entry (v0.3, FAFF-1478): `evidence_persisted` items gain the optional `human_only_acs_sha256`; additive; every committed anchor that validated still gives the same result.
- ADR-0077 Consequences: one bullet, "Human-only AC roster (FAFF-1478 amendment)", stating the file joins the return-by-digest roster and the custody roster, and the honest scope above. The Decision text is unchanged.

**Build order (each commit leaves the tests green).** First one commit with the `EVIDENCE_FILES` and `correctiveIntegrityDirs` edits, the derived `no_claim_digests` helper, and the test changes and count pins they require (updated fixtures, new cases, the 8 and 9 entry counts), so the tests and the code they pin change together. Then the two copies of `run-ledger.schema.json` and the compose run. Then the five selftest deletions, only after the `test/` cases that replace them pass. Prose, docs and records go last, so a reviewer reads the code and tests first.

**Edge cases and error handling.**

- Old-shape return (two keys) from a lane, or a three-key return to an older dispatcher: `verify-return` exits 1 with verdict `malformed`, `park_cause` `evidence-return malformed — <issue>/EvidenceReturn (malformed return)`, and no `integrity_tampered` entry (a transport or version fault is not evidence a file changed). The unit is parked unit-scoped, as for any malformed return. Re-dispatching on matched plugin releases clears it.
- A ledger entry written before this release (no `human_only_acs_sha256`) read by `--against-ledger` while the file now exists on disk is `presence-disagreement`, a mismatch with the path in `tampered_paths`. This only arises in a run that spans a plugin upgrade; re-dispatch writes a fresh entry (the last entry for the issue wins). **Chosen:** this case is deliberately not softened the way a skewed return is. A ledger entry carries no version, so a file that appears after an absent-claim entry cannot be told apart from a forged one, and the honest default is the fail-closed one: the path goes to `tampered_paths` and the unit parks. The release-note line below is the mitigation; the recovery is a fresh dispatch.
- `human-only-acs.json` replaced by a symlink: `not-regular-file` in `verify-return`, exit 2 from `return`, as for the other two files.
- A per-issue custody snapshot taken before the file is minted would read the later file as tamper. No such snapshot exists: the only per-issue snapshot is the top-level custody stamp sub-step (graft line 557), taken after Steps 8 and 9 and so after the Step 9b mint, and the dispatched path holds run-grain baselines only (obligations 5 and 7), whose members exclude per-issue files.
- A re-dispatched lane (rebase conflict, retry) mints and returns afresh; the newest `evidence_persisted` entry is the claim.

**Failure modes: how the approach falls over, and how you would notice.**

- **The failure:** the digest protects a copy no gate reads. The merge floor reads the anchored blob. A lane that commits a different anchored file than the run-dir file it returned a digest for passes `verify-return`.
- **How you would know:** a fixture where the anchored `human-only-acs.json` differs from the run-dir copy still gets `agree` from `faff evidence verify-return`. No test in this ticket asserts otherwise, and the trust note says so.
- **What it means:** narrow. The roster is still worth having, since it catches post-return rewrites and a rewrite plus newer stamp, and it puts the file on the custody snapshot for the top-level unattended path (where there is no `EvidenceReturn`). The binding of the anchored copy is the follow-up in section 2.

**Anti-pattern:** tolerating a missing `human_only_acs` key as "no claim". Why: with the file on disk the result is `no-claim` and a park anyway, and with the file absent it widens what the exact-key rule accepts, which the 1397 principle forbids.

**Anti-pattern:** a second hand-written list of the three file names next to `EVIDENCE_FILES`, or a literal `{ac_checklist, review_verdict}` object. Why: the two literals that exist today in `claimFromLedger` and `claimFromStdin` are what a roster change silently misses.

**Rule inventory.** No skill rule is deleted. The edits restate a shape and a count in place, so no `## Rule inventory` is needed.

**Eval coverage.** No LLM-judgement seam is introduced or changed.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

> Every scenario is run with the `faff` CLI against a fixture run dir at `.faff/runs/<run-id>/` holding `ISSUE-1/` evidence files and, where stated, a `run-ledger.json`. "R" is the run dir. "digest of F" is the output of `faff integrity-digest hash` on F.

```
Given a run dir R with ISSUE-1/ac-checklist.json, ISSUE-1/review-verdict.json and ISSUE-1/human-only-acs.json present
When `faff evidence return --run-dir R --issue ISSUE-1` runs
  and its one printed line is piped, unchanged, into `faff evidence verify-return --run-dir R --issue ISSUE-1`
Then the printed line has exactly the keys issue, ac_checklist, review_verdict and human_only_acs
  and each digest's sha256 equals the digest of its file
  and verify-return exits 0 with verdict "agree"
  and its evidence_persisted has exactly the keys issue, ac_sha256, review_verdict_sha256 and human_only_acs_sha256
```

```
Given a run dir R with ISSUE-1/ac-checklist.json and ISSUE-1/review-verdict.json and no human-only-acs.json
When `faff evidence return --run-dir R --issue ISSUE-1` runs and its line is piped into `faff evidence verify-return`
Then human_only_acs in the printed line is { "present": false, "sha256": null }
  and verify-return exits 0 with verdict "agree"
  and evidence_persisted has no human_only_acs_sha256 key
  and the files row for human-only-acs.json has result "absent-both"
```

```
Given the three evidence files are present and the return line has been captured
When one byte is appended to ISSUE-1/human-only-acs.json
  and the captured line is piped into `faff evidence verify-return --run-dir R --issue ISSUE-1`
Then verify-return exits 1 with verdict "mismatch"
  and park_cause is "evidence-return mismatch — ISSUE-1/human-only-acs.json (returned copy ≠ on-disk copy)"
  and tampered_paths is ["ISSUE-1/human-only-acs.json"]
  and the files row for human-only-acs.json has result "hash-mismatch"
```

```
Given the return line passed `faff evidence verify-return`
  and R/run-ledger.json holds the printed evidence_persisted entry
When ISSUE-1/human-only-acs.json is rewritten with different bytes before the merge locus
  and `faff evidence verify-return --against-ledger --run-dir R --issue ISSUE-1` runs
Then it exits 1 with the human-only-acs.json row result "hash-mismatch"
  and tampered_paths names ISSUE-1/human-only-acs.json
```

```
Given a return line in the old two-file shape, with only issue, ac_checklist and review_verdict keys
When it is piped into `faff evidence verify-return --run-dir R --issue ISSUE-1`
Then verify-return exits 1 with verdict "malformed"
  and park_cause is "evidence-return malformed — ISSUE-1/EvidenceReturn (malformed return)"
  and tampered_paths is empty
  and evidence_persisted is null
```

```
Given only ISSUE-1/human-only-acs.json is present on disk
When the literal line `null` is piped into `faff evidence verify-return --run-dir R --issue ISSUE-1`
Then verify-return exits 1 with verdict "mismatch"
  and park_cause is "evidence-return missing — ISSUE-1/human-only-acs.json (no digest returned for a file on disk)"
  and tampered_paths is empty
```

```
Given a run dir R with ISSUE-1/ac-checklist.json and ISSUE-1/human-only-acs.json present
When `faff integrity-digest snapshot --run-dir R --issue ISSUE-1` is saved as manifest M
  and ISSUE-1/human-only-acs.json is then rewritten
  and `faff integrity-digest verify --run-dir R --issue ISSUE-1 --manifest M --json` runs
Then it exits 1 with verdict "tampered"
  and tampered lists "ISSUE-1/human-only-acs.json"
```

```
Given any run dir path R
When `faff integrity-boundary --run-dir R --issue ISSUE-1 --events` runs
  and `faff integrity-boundary --run-dir R` runs
Then the first prints a v1 declaration of nine comma-separated paths that includes R/ISSUE-1/human-only-acs.json between R/ISSUE-1/holdout.json and R/ISSUE-1/merge-record.json
  and the second prints a declaration of two paths, unchanged
```

```
Given a run dir R where ISSUE-1/human-only-acs.json is a symbolic link to another file
  and ISSUE-1/ac-checklist.json and ISSUE-1/review-verdict.json are regular files
When `faff evidence return --run-dir R --issue ISSUE-1` runs
  and a return line captured earlier from regular files is piped into `faff evidence verify-return --run-dir R --issue ISSUE-1`
Then `evidence return` exits 2, prints nothing on stdout and names human-only-acs.json on stderr
  and verify-return exits 1 with verdict "mismatch"
  and the files row for human-only-acs.json has result "not-regular-file" and disk_sha256 null
```

- The `evidence return` and `evidence verify-return` verbs MUST NOT create, modify or delete any file under R.
- A ledger whose `evidence_persisted` item carries `human_only_acs_sha256` MUST still validate against the bundled `run-ledger.schema.json`, and a ledger item carrying only `ac_sha256` and `review_verdict_sha256` MUST still validate.

## 6. DESIGN DECISION RATIONALE

**Strict or tolerant on the return shape?** Strict: accept only the new three-key shape.

| Option | Pros | Cons |
|---|---|---|
| Strict (exact keys, derived from the roster) | Matches the 1397 rule and the existing `hasExactKeys` check; one code path; no new accepted shape | A lane and dispatcher on different plugin releases park the unit as `malformed` |
| Tolerant (accept the old two-key shape from an older lane) | No skew parks | Needs a rule for the third file: accepting it silently widens the check; parking on it (`no-claim`) gives the same park with a worse message |

**Chosen:** strict. At the time of writing, a lane and the dispatcher that spawned it run one plugin release in one session, so skew only arises when the plugin is upgraded mid-run. The failure is loud, unit-scoped and clears on re-dispatch, and it never appends `integrity_tampered`.

**Add the file to `correctiveIntegrityDirs`, or only to `EVIDENCE_FILES`?** Both.

| Option | What it buys | What it costs |
|---|---|---|
| `EVIDENCE_FILES` only | Dispatcher digest at return and at the pre-merge re-verify (dispatched path) | No cage declaration or custody snapshot; the top-level unattended path, where there is no `EvidenceReturn`, stays uncovered |
| `correctiveIntegrityDirs` only | Cage declaration and custody snapshot (top-level unattended path, and the future mount) | The dispatched path has no digest of the file |
| Both | Each cell of the unattended skip has a witness: dispatched (digest) and top-level (custody stamp) | Changes pinned counts 7 to 8 and 8 to 9 in tests and prose; an older release's run-dir-grain declaration no longer covers the roster |

**Chosen:** both. The cost is one function body, four pinned test counts, one prose count and one prose list. The ancestor-grain declaration used at launch covers the new member already.

**What does "the dispatcher persists the returned copy" mean?** **Chosen:** it means appending the verified digest to the ledger's `evidence_persisted` entry through obligation 5's re-baseline sequence, and nothing more. The file is not rewritten, as for the other two digests (l4.md obligation 6, "the per-issue files are never rewritten"). The ticket's wording, "persists", is read through the shipped 1397 behaviour, not as a new write path.

**Key names and ledger property.** **Chosen:** the return key is `human_only_acs`, the roster `shaKey` and the ledger property are `human_only_acs_sha256`, and the property is optional in the schema. Optional keeps every committed anchor under `.faff/anchors/*/run-ledger.json` valid, and `claimFromLedger` already reads an omitted digest as an absence claim. The new member is third in `EVIDENCE_FILES`, so the `files` rows and `park_cause` precedence put `ac-checklist.json` and `review-verdict.json` first, unchanged.

**Selftest blocks.** `evidence.js` and `corrective-integrity.js` still carry `--selftest` blocks, and AGENTS.md says a change that touches a module with a selftest moves the touched cases into `test/` rather than editing the block. **Chosen:** delete the two return-by-digest checks in the `evidence.js` selftest (the "agrees on untouched files" and "reports a hash mismatch after a change" cases; they iterate `EVIDENCE_FILES` and would throw on a fixture without the third file) and the three count-pinned checks in the `corrective-integrity.js` selftest (the `withIssue.length === 7` case, the no-opts `7 entries` case and the `8 entries` case). `test/evidence-return.test.mjs` and `test/corrective-integrity.test.mjs` already pin the same behaviour and are updated here, so no coverage is lost. Both modules keep their remaining selftest cases, so the governance-region selftest rule is met.

**Where does the digest's honesty limit go, and is the anchored copy bound here?** **Chosen:** state the limit in the trust note, obligation 6 and the ADR bullet, and leave the anchored-copy binding as a follow-up (section 2). Binding it is a new dispatcher check with its own failure modes and is not in the ticket. Doing it here would also tip this ticket into FAFF-1339's neighbourhood.

**Do the concurrency executors need edits?** **Chosen:** no. Both refer to obligation 6 for "the check, the `EvidenceReturn` shape, the exit branches", and a DONE item pins that they stay free of the shape.

**Prose tests that pin the shape.** `evidence-return.test.mjs` pins the shape in a fixture, not in prose, so no prose-pinning test is repointed. If `faff validate-adapters` or another test pins the l4.md or graft sentences, update it to the new sentence, with no weakening of what it asserts.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

Open Questions: none. The ticket's version-skew, cage-membership and "persists" questions are closed in section 6.

**Assumes:** `faff pr open` mints `<run-dir>/<issue>/human-only-acs.json` (FAFF-1476, merged as part of main 06c6b17d) before the lane's final `faff evidence return`. Validate: in `plugin/skills/faff-graft/SKILL.md`, the Step 9b `faff pr open` call (line 472) precedes the "Returned evidence" paragraph (line 795, "as its last action"), and `mintHumanOnlyAcs` in `plugin/skills/faff/bin/lib/pr-open.ts` runs at step 9b, before the anchor.

**Assumes:** `scripts/evidence-v0.3-compose.mjs` mirrors `verification/evidence/v0.3` into `plugin/skills/faff/contracts/evidence-v0.3` and `--check` fails when they differ. Validate: run `node scripts/evidence-v0.3-compose.mjs --check` on a clean tree before editing; it exits 0.

**Assumes:** the top-level custody stamp sub-step in `faff-graft/SKILL.md` is the only caller that takes a per-issue `faff integrity-digest snapshot`, and it runs after Step 9b. Validate: `grep -rn "integrity-digest snapshot" plugin scripts docs` lists only that sub-step and its tests, and no dispatched-lane prose; run before editing.

## 8. DONE: definition of done

No item needs a person to check it, so none carries `needs-human:`.

### From WHY
- [ ] After the change, `faff evidence return` prints a `human_only_acs` digest and `faff evidence verify-return` exits 1 on a changed `human-only-acs.json`, with the cause text in the third scenario.
- [ ] Both rosters name `human-only-acs.json`: the digest roster (`EVIDENCE_FILES`) and the custody roster (`faff integrity-boundary --run-dir R --issue ISSUE-1 --events` prints nine paths including it).

### From WHAT (types and interfaces)
- [ ] `EvidenceReturn` carries exactly the keys `issue`, `ac_checklist`, `review_verdict` and `human_only_acs`; any other key set, including the old two-file shape, exits 1 with verdict `malformed`.
- [ ] `verify-return` prints three `files` rows, in the order `ac-checklist.json`, `review-verdict.json`, `human-only-acs.json`.
- [ ] `evidence_persisted` carries `human_only_acs_sha256` (equal to `faff integrity-digest hash` of the file) iff the file matched, and the ledger schema accepts it as optional in both copies of `run-ledger.schema.json`; `node scripts/evidence-v0.3-compose.mjs --check` exits 0.
- [ ] `correctiveIntegrityDirs` returns 2 entries with no issue, 3 with `{events:true}` and no issue, 8 with an issue, 9 with an issue and `{events:true}`, and `human-only-acs.json` sits between `holdout.json` and `merge-record.json`.
- [ ] No literal two-key `{ac_checklist, review_verdict}` object or hand-written three-file list remains in `evidence.js` outside `EVIDENCE_FILES`.

### From HOW (behaviour)
- [ ] An absent `human-only-acs.json` agrees on both sides (`absent-both`), persists no `human_only_acs_sha256`, and parks nothing.
- [ ] A change to the file after return gives a `hash-mismatch` park naming `ISSUE-1/human-only-acs.json` and adds that path to `tampered_paths`.
- [ ] `--against-ledger` catches a rewrite after the ledger entry as `hash-mismatch`, and a file created after an absent-claim entry as `presence-disagreement`.
- [ ] A skewed (old-shape) return is `malformed`, with no `integrity_tampered` path and the exact `park_cause` in the scenarios.
- [ ] `faff integrity-digest verify` exits 1 naming `ISSUE-1/human-only-acs.json` after the file changes between snapshot and verify, and exits 0 when the file is absent at both.
- [ ] Neither `evidence return` nor `evidence verify-return` writes any file (snapshot the run dir before and after).

### From HOW (edge cases)
- [ ] A symlink at `human-only-acs.json` is `not-regular-file` in `verify-return` and exit 2 from `return`.
- [ ] A ledger entry with no `human_only_acs_sha256` read with the file present on disk is `presence-disagreement`.
- [ ] Ledger items with only the two older digests still validate against the schema.

### Prose, docs and records (each in its own item)
- [ ] `l4.md` obligation 6 states the three-key shape, lists `human-only-acs.json` among the re-hashed files, and carries the one-sentence honest-scope note.
- [ ] `faff-graft/SKILL.md` line 795 states the three-key shape and line 555 says "eight-entry"; the file's line count is not greater than before the edit and `faff validate-adapters` reports no new FAIL.
- [ ] `references/kernel.md` line 287 lists `<issue>/human-only-acs.json` in the `correctiveIntegrityDirs()` roster.
- [ ] `faffter-noon-concurrency-sequential/SKILL.md` and `faffter-dark-concurrency-parallel/SKILL.md` are unchanged and contain neither `human_only_acs` nor the `ac_checklist:{present` shape.
- [ ] `docs/guide/cli.md` rows for `evidence return` and `evidence verify-return` name the third key and file, and `faff lint-cli-doc` passes.
- [ ] The `human-only-acs.json` trust note in `verification/evidence/v0.3/evidence-documents.md` and its bundled copy no longer says the file is off the roster, names FAFF-1478 as delivered, and states the three residuals (content authorship FAFF-748, anchored copy not digested, isolation FAFF-517).
- [ ] `verification/evidence/README.md` has a dated FAFF-1478 changelog entry; ADR-0077 has the FAFF-1478 Consequences bullet and an unchanged Decision text.
- [ ] New prose uses Canadian spelling and no em dashes outside quoted park-cause strings.

### Tests and repository checks (each in its own item)
- [ ] `test/evidence-return.test.mjs` is updated: the fixture's default files include `human-only-acs.json`, the `claim` helper takes three digests, every deep-equal on the printed line and on `evidence_persisted` includes the new key, and new cases cover the tamper-after-return, rewrite-after-ledger, file-created-after-absent-entry, old-shape return and `null`-with-file-on-disk scenarios.
- [ ] `test/corrective-integrity.test.mjs` pins 8 and 9 entries and the new member; `test/integrity-boundary.test.mjs` line 46 pins nine paths; `test/integrity-digest.test.mjs` gains a snapshot, tamper, verify case for the new member.
- [ ] The five selftest cases named in section 6 are removed from `evidence.js` and `corrective-integrity.js`; `faff evidence --selftest` and `faff corrective-integrity --selftest` still pass.
- [ ] `node --test` over the four test files above, `test/evidence-v0.3.test.mjs`, `test/faff-893-custody-stamp.test.mjs`, `test/faff-895-pr-custody-basis.test.mjs` and `test/faff-1475-ac-floor.test.mjs`, `test/faff-1475-human-only-acs.test.mjs` and `test/faff-1475-surfacing.test.mjs` passes, and `faff regions check` and `faff lint-cli-coverage` pass with no module added.

### Rollout
- [ ] The PR description records the result of `grep -rn "integrity-boundary" plugin scripts docs .faff` for callers that emit a run-dir-grain declaration: each caller is listed with whether it keeps working, or the result is "none".
- [ ] The PR description carries two release-note lines. First: do not upgrade the plugin during an in-flight dispatched run; a skewed return parks as `malformed` and clears on re-dispatch, and a ledger entry written before the upgrade can park as a presence disagreement for the same reason. Second: the chain ships a tamper witness over the run-dir copy of `human-only-acs.json`, not custody of the anchored copy the merge floor reads.
- [ ] The PR description names FAFF-1483 as the follow-up that binds the anchored copy, so a reader of the release note can find the open gap.
- [ ] `grep -rn "integrity-digest snapshot" plugin scripts docs` lists no per-issue snapshot taken before Step 9b, and its output is pasted into the PR description.

### Integration smoke test

```
PROCEDURE smoke():
  1. make R = <tmp>/.faff/runs/run-20991231-000000-graft-ISSUE-1 with ISSUE-1/ac-checklist.json,
     ISSUE-1/review-verdict.json and ISSUE-1/human-only-acs.json, and an empty run-ledger.json object
  2. line = run `faff evidence return --run-dir R --issue ISSUE-1`; expect exit 0, four keys
  3. v = run `faff evidence verify-return --run-dir R --issue ISSUE-1` with stdin = line
     expect exit 0, v.verdict == "agree", v.evidence_persisted.human_only_acs_sha256 == digest of the file
  4. write v.evidence_persisted into R/run-ledger.json as evidence_persisted: [entry]
  5. run `faff evidence verify-return --against-ledger ...`; expect exit 0
  6. append one byte to ISSUE-1/human-only-acs.json; re-run step 5
  7. expect exit 1, the human-only-acs.json row result == "hash-mismatch", run dir otherwise unchanged
```

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `over the seven-entry forge surface` | `faff integrity-digest snapshot` covers the eight-entry roster | test/integrity-digest.test.mjs: "a stable tree's snapshot is unchanged by the leaf read: plain, events, symlink and directory members keep their record shapes" | changed: the count follows the roster, now eight entries |
| `review_verdict:{present,sha256} }` per member | `faff evidence return` prints the third digest | test/evidence-return.test.mjs: "return prints one EvidenceReturn line with lowercase hex digests and exits 0" | changed: the lane-side shape gains `human_only_acs` |
| `<issue>/ac-checklist.json` · `review-verdict.json` · `holdout.json`) plus the merge-tail records | `correctiveIntegrityDirs` lists the new member | test/corrective-integrity.test.mjs: "correctiveIntegrityDirs(runDir, issue): 8 entries — 2 base + 4 merge-floor + 2 merge-tail (FAFF-751, FAFF-1478)" | changed: the roster list names `human-only-acs.json` |
| `it re-hashes ac-checklist.json / review-verdict.json to the same leaf sha256` | `faff evidence verify-return` re-hashes three files | test/evidence-return.test.mjs: "a change to human-only-acs.json after the return is a hash-mismatch naming that file as tampered" | changed: the file list gains `human-only-acs.json` and one honest-scope sentence is added |

## 9. APPENDICES

### Appendix A: self-review record

Reviewer: a fresh-reasoning pass inside this producer subagent, against the drafted spec and the repo at origin/main 06c6b17d, as the dispatched-producer form of the inherited review requires. The findings and their resolutions are returned alongside the spec to the caller and are not repeated here.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Output: `issue-critique` for FAFF-1478. Evidence: the spec and the FAFF-1475 worktree at 06c6b17d (read-only). I did not re-read the Linear issue or its relations; the dependency view below comes from the spec and the inputs given.

### Right-sized (principle 4)

**What's there.** One roster change, applied to two rosters (`EVIDENCE_FILES` in `evidence.js`, `correctiveIntegrityDirs` in `corrective-integrity.js`), plus an optional ledger-schema property, about ten prose and doc edits, five selftest deletions and four test files. The code change is small (one array member each, two literals replaced by a derived helper). The spec's repo references check out: `EVIDENCE_FILES` at line 1458, the roster function at lines 211 to 221, and the pinned counts in `test/corrective-integrity.test.mjs` and `test/integrity-boundary.test.mjs`. `corrective.js` only calls the no-issue form, so it is unaffected, as the spec implies.

**Why it matters.** The surface is wide but shallow, and every part serves one outcome: the file gets a witness on both the dispatched path and the top-level path. It fits the 1 to 3 day unit. The two halves could ship separately, but the custody half alone leaves the dispatched path uncovered and the digest half alone leaves the top-level path uncovered, so splitting gives two partial increments and double the review and test-count churn.

**What to do.** Keep it as one ticket. The one thing to trim is optional: the prose edits (graft, kernel, cli.md, trust note, README, ADR-0077) can land in the same PR but should be the last commit, so a reviewer can read the code and tests first. No split, no merge.

### Workstream fit (principles 1 and 5)

**What's there.** FAFF-1478 sits in the FAFF-1475 chain (unattended run skips human-only ACs), downstream of the merged FAFF-1475 and FAFF-1476. The outcome is "an unattended skip of a human AC cannot be forged by the lane after it returns", which is the same outcome as the chain. The spec correctly refuses the neighbouring outcomes (anchored-copy binding, lane isolation, admission refusals, FAFF-1339 completeness).

**Why it matters.** It fits. The only cohesion risk is the section 6 note that binding the anchored copy would "tip this ticket into FAFF-1339's neighbourhood". The spec handles that by exclusion, which keeps the workstream cohesive.

**What to do.** No issues.

### Deps surfaced (principle 6)

**What's there.** Blockers are clean: FAFF-1475 and FAFF-1476 are merged, so nothing blocks the build. The spec names FAFF-1477, FAFF-1339, FAFF-517 and FAFF-748 as out of scope with extension points. Two things are not surfaced as tracker links:

1. The anchored-copy binding follow-up is described as "recommended, not required" and "filed at build time". It is the one dependency that decides whether the chain's protection is real. The roster digests the run-dir copy, and the merge floor reads the anchored blob against the events stamp. The spec's own failure-mode section says a lane that commits a different anchored file than the one it returned a digest for still passes `verify-return`.
2. FAFF-748 (writer out of the lane) is cited as a residual but is not named as a related or downstream link.

**Why it matters.** Filed "at build time" means filed by whoever builds, if they remember. If the release ships on the FAFF-1475 chain with FAFF-1478 as the visible hardening step, readers will assume the skip is tamper-evident end to end. The spec says it is not. An untracked follow-up is unfinished thinking in the sense of principle 6.

**What to do.** File the anchored-copy binding ticket now, project-less Backlog per the default landing rule, with a `relatedTo` link to FAFF-1478 and FAFF-1475. Add FAFF-748 as `relatedTo` as well. Do not make either a blocker of FAFF-1478, since the roster change is useful and complete without them. FAFF-1477 (slice 3) and FAFF-1339 need no link beyond what exists. Keep the release note honest: the chain ships a tamper witness over the run-dir copy, not full custody of the anchored one.

### Risk profile (principle 7)

**What's there.** The change touches the governance-region evidence handoff and the cage and custody roster, so it is on the path every dispatched run takes. Three specific risks:

1. **Strict shape skew.** A lane and a dispatcher on different plugin releases park the unit as `malformed`. The spec chooses strict on purpose and says skew only arises on a mid-run plugin upgrade. That is probably true, but "stability of everything else" is the operator's constraint and this is the one place the change can park healthy work.
2. **Older run-dir-grain declarations.** A declaration emitted by an older release names seven entries and fails the new roster's coverage test. The spec says launch-grain (the default) is unaffected, but does not say how many callers, if any, still emit run-dir-grain declarations.
3. **Selftest deletions in governance-region modules.** Five cases are removed. The spec says equivalent coverage exists in `test/`, and the governance rule is met because other cases remain. This is fine only if the replacement tests really pin the same assertions before the deletions land.

The spec is also strong on the risk of a vacuous check: every behaviour has a scenario, and there is a holdout scenario for presence-disagreement.

**Why it matters.** Risks 1 and 2 are the only ones that can park or refuse work that is currently fine, and both occur at upgrade boundaries. A pre-release chain is exactly where an upgrade between lane and dispatcher is most likely during dogfooding.

**What to do.**
- Build order: land the tests (updated fixtures, new cases, count pins) first, then the roster edits, then the schema, then the selftest deletions, then prose. Each step stays green.
- Before merging, grep for run-dir-grain `integrity-boundary` callers (graft, executors, scripts, `.faff/` configs) and record the result in the PR. If any exist, either keep them working or list them in the release note.
- Add one line to the release note: do not upgrade the plugin during an in-flight dispatched run; a skewed return parks as `malformed` and clears on re-dispatch.
- No de-risking spike needed. The mechanism is already proven by the same roster for two other files.

### Verdict

Right-sized and well-fitted. Ready to build. Two actions outside the code: file and link the anchored-copy follow-up now, and check run-dir-grain declaration callers before merge.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (human, after 5 rounds: 4 minors fixed, none open)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
