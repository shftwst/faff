# FAFF-1397: obligation 6 returns evidence digests, not evidence bodies

> Spec: faffter-dark-nlspec · 2026-10-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1397.

This spec fixes the obligation 6 evidence check (gateway `concurrency` slot contract, `plugin/skills/faff/references/l4.md` line 67) so a clean dispatched build is no longer parked when its evidence contains `<`, `>` or `&`. It is written for the build agent that implements it and for the human reviewers who approve it.

## 1. WHY: problem and principles

**The load-bearing model.** Obligation 6 compares two hashes: the leaf sha256 of the bytes the lane says it wrote, and the leaf sha256 of the file on disk. Today the lane carries the first hash implicitly, by pasting the whole file body into its return, and the dispatcher re-hashes that pasted text. The subagent return channel is not byte-transparent: it HTML-escapes `<` and `>` (seen in the observed run; `&` is treated the same way here, since HTML escaping covers it too). The fix moves the hashing to a CLI on each side of the dispatch cut, so the only thing that crosses the return channel is 64 lowercase hex characters per file, which no escaping rule touches.

**Problem statement.** In run `run-20261024-044511-beepboop-list-f66619` the lane building FAFF-1112 returned `ac-checklist.json` (15,598 bytes, three lines containing `<`, `>` or `&`) with `<unknown>` as `&lt;unknown&gt;`, so the returned body's sha256 differed from the untouched on-disk file; `review-verdict.json` (no angle brackets) matched. Read literally, obligation 6 parks every clean build whose evidence contains one of those characters, and the orchestrator in that run had to hash by hand and unescape to see that the build was clean. This change replaces the body with a CLI-computed digest on the lane side and a CLI verifier on the dispatcher side, so the check has no transport-sensitive input and no hand-computed hash.

**Design principles.**

**Never weaken the check to make it pass.** The verifier must not accept anything the current rule would reject on a byte-transparent channel. An HTML-unescape fallback, a whitespace-tolerant compare, or a field-scoped compare all widen what passes, so all three are rejected.

**Hashing happens in code, never in the conversation.** Neither side computes or compares a sha256 by reading bytes and reasoning about them. Both sides call `faff evidence`, which uses the same hasher `integrity-digest` uses (`sha256` and `digestLeaf` in `plugin/skills/faff/bin/lib/integrity-digest.js`).

**The verifier is read-only.** It reads the two per-issue files and the returned JSON, and prints a verdict. It writes nothing, so it can be run twice (once on return, once just before the merge locus) and it adds no member to obligation 5's Class A writer roster.

**Detection is unchanged in kind.** The check still detects a third party changing a per-issue evidence file between the lane's return and the dispatcher's read. It still makes no claim about content trust; that stays the code-blind holdout's job (obligation 4).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/references/l4.md` line 67 | Markdown (skill prose) | Canonical obligation 6 rule; rewritten here |
| `plugin/skills/faff/references/l4.md` line 69 | Markdown | Obligation 7 merge locus; gains a pre-merge re-verify and drops the "dispatcher-persisted" wording |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` lines 97 to 103 | Markdown | Parallel executor placement prose for obligations 6 and 7 |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` lines 40 and 42 | Markdown | Sequential executor placement prose for obligations 6 and 7 |
| `plugin/skills/faff-graft/SKILL.md` line 884 | Markdown | Lane side: what a dispatched graft returns |
| `plugin/skills/faff/bin/lib/evidence.js` | JavaScript (CommonJS) | `faff evidence` verbs; gains `return` and `verify-return` |
| `plugin/skills/faff/bin/lib/integrity-digest.js` lines 57 and 69 | JavaScript | `sha256(bytes)` and `digestLeaf(abs)` (symlink-aware) reused |
| `plugin/skills/faff/contracts/evidence-v0.3/schema/run-ledger.schema.json` line 434 | JSON Schema | `evidence_persisted` item `{issue, ac_sha256?, review_verdict_sha256?}`, unchanged |
| `records/adr/0077-two-class-write-authority-for-run-artifacts-evidence-writes-cross-to-the-trusted.md` | Markdown (ADR) | Mandates "lanes return the data, dispatcher persists"; gains a FAFF-1397 amendment |
| `docs/guide/cli.md` lines 198 to 205 | Markdown | `faff evidence` verb rows; gains two rows |
| `plugin/skills/faff/bin/lib/validate-adapters.js` line 65 | JavaScript | `SKILL_LINE_BASELINE` (`faff-graft: 893`) |

**Scope statement.** This is a change to the dispatched-lane evidence handoff between `faff-graft` and the two `concurrency` executors, plus two read-only `faff evidence` verbs; interactive top-level graft is untouched.

## 2. OUT OF SCOPE

- **Name:** a content-carrying evidence channel for the read-only-mount world (FAFF-517).
  - **Why excluded:** at rung 0 the lane and the dispatcher share one run-dir path, so a returned body adds nothing beyond its hash (section 4, "Why the body adds nothing today"); a channel that carries content is only needed once a mount stops the lane writing the run-dir copy.
  - **Extension point:** FAFF-517's lane-boundary work; `faff evidence return` can gain a transport-safe content field (for example base64) at that point, and `verify-return` can persist it.
- **Name:** other subagent-returned text that the return channel may escape (spec bodies returned by `spec` producers, `faff-contract:*` blocks returned by review and evaluator subagents).
  - **Why excluded:** none of them is hashed or byte-compared against a file, so escaping cannot cause a false park through them (audit in section 4, "Exposure audit"); content fidelity of those returns is a separate defect class.
  - **Extension point:** a future ticket on the producer return path (`plugin/skills/faff/references/kernel.md`, Sibling-skill invocation, Producer dispatch).
- **Name:** the shape of the `integrity_tampered` ledger array.
  - **Why excluded:** obligation 5 prose says `{issue, paths}` objects are appended, but the v0.3 schema (`run-ledger.schema.json` line 128) types the items as strings. That mismatch predates this ticket and is obligation 5's, not obligation 6's. Noted, not filed.
  - **Extension point:** obligation 5 in `l4.md` line 66 and `run-ledger.schema.json` line 128.
- **Name:** renaming `evidence_persisted`.
  - **Why excluded:** after this change the dispatcher records verified digests rather than writing files, so the name is slightly stale, but renaming it is a v0.3 schema change with anchor and governance-check consequences for no behavioural gain.
  - **Extension point:** the next evidence contract version (`plugin/skills/faff/contracts/`).
- **Name:** any decision-kernel call site (`next`, `eligible`, `claim-verdict`, `park-verdict`, `run-start`, `run-outward`, `run-done`, `queue-state`, `project-next`).
  - **Why excluded:** the FAFF-974 coordination-fidelity collection window forbids altering them, and this fix does not need to.
  - **Extension point:** none required.
- **Name:** moving the ledger append into the CLI.
  - **Why excluded:** it would add a new Class A writer to obligation 5's enumerated roster (section 6, decision "Does the verifier write the ledger?").
  - **Extension point:** `faff integrity-digest rebaseline` already folds Class A writes; a later ticket could add `verify-return --record` that reports the written sha256 for it.

## 3. WHAT: vocabulary, types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| EvidenceReturn | The sibling field a dispatched graft returns next to its `TerminalToken{issue,outcome,pr}`. The token is unchanged. |
| leaf sha256 | The 64-hex sha256 of a file's bytes as computed by `integrity-digest.js` `sha256`, with symlinks recorded and never followed (`digestLeaf`). |
| evidence file | One of `<run-dir>/<ISSUE>/ac-checklist.json` or `<run-dir>/<ISSUE>/review-verdict.json`. |
| return verdict | The JSON object `faff evidence verify-return` prints. |

**EvidenceReturn, new shape.**

```
RECORD EvidenceReturn:
  issue: IssueId                       # bare token, same rule as --issue in evidence.js (ISSUE_ID_RE)
  ac_checklist: EvidenceDigest
  review_verdict: EvidenceDigest

RECORD EvidenceDigest:
  present: Bool                        # true iff the evidence file exists on disk as the lane saw it
  sha256: Hex64 | null                 # leaf sha256 of the file's bytes; lowercase [0-9a-f]{64}

  CONSTRAINT present == false  <=>  sha256 == null
  CONSTRAINT no other keys           # a legacy "body" key makes the return malformed
```

The JSON form is exactly what `faff evidence return` prints, for example:

```
{"issue":"FAFF-1112","ac_checklist":{"present":true,"sha256":"522a…f2"},"review_verdict":{"present":true,"sha256":"d5be…18"}}
```

The lane copies that one line into its structured return verbatim. It never edits it, re-orders it or recomputes it. When the lane has no EvidenceReturn to give (the verb failed, or graft ended before it could run), the return carries `EvidenceReturn: null`.

**Lane-side verb.**

```
INTERFACE faff evidence return --run-dir <dir> --issue <id>
  stdin: not read
  stdout: one EvidenceReturn JSON line, trailing newline
  exit 0: printed
  exit 2: usage error, --run-dir/--issue rejected by guardWriterPaths, an evidence file that is
          a symlink or not a regular file, or the hasher is unavailable. Nothing printed on stdout;
          one-line reason on stderr.
```

**Dispatcher-side verb.**

```
INTERFACE faff evidence verify-return --run-dir <dir> --issue <id>
  stdin: the returned EvidenceReturn JSON, or the literal JSON null when the lane returned none
         (an interactive TTY on stdin is refused with exit 2, never a hang)
  stdout: one ReturnVerdict JSON line on exit 0 and exit 1; nothing on exit 2
  exit 0: verdict "agree"
  exit 1: verdict "mismatch" or "malformed"
  exit 2: usage error, path rejected by guardWriterPaths, or hasher unavailable (stderr reason)

INTERFACE faff evidence verify-return --against-ledger --run-dir <dir> --issue <id>
  stdin: not read
  claim source: the LAST evidence_persisted entry for --issue in <run-dir>/run-ledger.json;
                no entry means the claim is "both files absent"
  stdout / exits: as above; a ledger that is missing or does not parse is exit 2
  precondition (stated in prose, not checked by the verb): obligation 5's run-grain verify
                passed immediately before this call, so the ledger entry is custody-trusted

RECORD ReturnVerdict:
  verdict: ENUM { agree, mismatch, malformed }
  issue: IssueId                        # always --issue, never taken from stdin
  files: List<FileResult>               # exactly two, ac-checklist.json then review-verdict.json;
                                        # empty when verdict == malformed
  evidence_persisted: EvidencePersisted | null
                                        # non-null only when verdict == agree and >= 1 file present
  park_cause: String | null             # non-null iff verdict != agree
  paths: List<String>                   # run-dir-relative paths of the files the cause names
  tampered_paths: List<String>          # the subset of paths whose result is presence-disagreement,
                                        # hash-mismatch or not-regular-file; empty for no-claim and malformed

RECORD FileResult:
  file: ENUM { "ac-checklist.json", "review-verdict.json" }
  returned_present: Bool
  disk_present: Bool
  returned_sha256: Hex64 | null
  disk_sha256: Hex64 | null             # null when absent or not a regular file
  result: ENUM { match, absent-both, presence-disagreement, hash-mismatch, not-regular-file, no-claim }
                                        # no-claim: no digest was available for a file that is on disk
                                        # (stdin null, or --against-ledger with no entry)

RECORD EvidencePersisted:               # identical to the v0.3 run-ledger item; schema unchanged
  issue: IssueId
  ac_sha256?: Hex64                     # present iff ac-checklist.json matched
  review_verdict_sha256?: Hex64         # present iff review-verdict.json matched
```

**Park causes.** These keep the existing obligation 6 and obligation 5 cause format, including its `—` separator, because they are machine strings matched by people reading park comments, not new prose:

| Condition | `park_cause` | Ledger `integrity_tampered` entry |
|---|---|---|
| presence disagreement on a file | `evidence-return mismatch — <issue>/<file> (presence disagreement)` (existing) | yes |
| hash mismatch on a file | `evidence-return mismatch — <issue>/<file> (returned copy ≠ on-disk copy)` (existing) | yes |
| no claim for a file that is on disk (`EvidenceReturn: null`, or `--against-ledger` with no entry) | `evidence-return missing — <issue>/<file> (no digest returned for a file on disk)` (new) | no: the lane's tooling or the orchestrator's first check failed, which is not evidence that a file changed |
| on-disk file is a symlink or not a regular file | `evidence-return mismatch — <issue>/<file> (on-disk copy is not a regular file)` (new) | yes |
| malformed return (bad JSON, wrong keys, legacy `body`, bad hex, issue differs from `--issue`, constraint broken) | `evidence-return malformed — <issue>/EvidenceReturn (malformed return)` (new) | no: a malformed return is a transport or lane fault, not evidence that a file changed |
| verifier exit 2 | `evidence-return verification unavailable — <stderr first line>` (new; mirrors obligation 5's exit-2 cause) | no, as obligation 5's exit 2 |

When both files fail, the cause names the first failing file in `files` order and `paths` lists every failing file.

**`integrity_tampered` entries.** Obligation 6 appends each string in `tampered_paths` (never `paths`, which also names `no-claim` files) (for example `FAFF-1112/ac-checklist.json`) to the ledger's `integrity_tampered` array, which is the shape the v0.3 schema types (`run-ledger.schema.json` line 128, items are strings). The rewritten obligation 6 says this directly and no longer refers to obligation 5's `{issue, paths}` wording. That obligation 5 wording still disagrees with the schema; fixing it stays out of scope (section 2), but obligation 6 no longer inherits it.

**Unchanged surfaces.** `TerminalToken{issue,outcome,pr}` (the "no token/spend field, ever" invariant holds; EvidenceReturn stays a sibling), the `evidence_persisted` schema, `merge-gate.js` `readAcComplete`/`readReviewVerdict`, the Step 9b anchor byte-copy, and `governance-check`.

## 4. HOW: behaviour

**Architecture.** Graft keeps its Step 8 and Step 9 writes exactly as today. At its return, a dispatched graft runs `faff evidence return` and pastes the printed line as its EvidenceReturn. On each subagent return the dispatcher runs obligation 5's run-grain verify first (unchanged), then pipes the returned line into `faff evidence verify-return` and branches on the exit code. On agreement it appends the printed `evidence_persisted` entry to the ledger through obligation 5's re-baseline sequence (unchanged, Class B hand-chained ledger edit). It no longer rewrites the evidence files. Immediately before obligation 7's merge locus asserts the floor for a `pr-ready` member, the dispatcher runs obligation 5's run-grain verify and then `faff evidence verify-return --against-ledger`, which compares the files on disk with the `evidence_persisted` entry the ledger already holds. Nothing from the lane's return is kept in conversation context past the first check.

**Why the re-verify reads the ledger, not the held return.** The ledger is a member of obligation 5's run-grain custody chain, so a change to its `evidence_persisted` entry is detected by the run-grain verify that runs first. A held EvidenceReturn lives only in conversation context, and compaction can drop it. Re-deriving it from disk at merge time would hash the current state and always agree, which is the laundering the re-verify exists to prevent. Reading the custody-protected ledger entry gives the re-verify a source that survives compaction and that no lane can rewrite undetected.

**Why the body adds nothing today.** The lane writes the evidence files at `<FAFF_RUN_DIR>/<ISSUE>/`, and `FAFF_RUN_DIR` is the orchestrator's run dir in the main checkout (confirmed in the observed run: `/…/faff/.faff/runs/run-20261024-044511-beepboop-list-f66619/FAFF-1112/ac-checklist.json`; `guardWriterPaths` in `evidence.js` line 550 accepts a run dir under either the working or the main checkout). The dispatcher's "persist" wrote the returned body to that same path. The persist only ran after the hashes matched, so it always rewrote the identical bytes to the identical path. Every guarantee the body gave is therefore given by its hash: tampering between the lane's return and the dispatcher's read changes the on-disk hash and is detected either way. The FAFF-749 spec already recorded that the persisted copy had no reader of its own in slice 1, and since FAFF-750 the merge reads that path, which holds the same bytes.

**Lane side.** Summary: hash the two files in code and hand back only the digests.

```
PROCEDURE evidence_return(run_dir, issue):
  1. issue_dir = guardWriterPaths(run_dir, issue)            # exit 2 on rejection
  2. FOR name IN ["ac-checklist.json", "review-verdict.json"]:
     a. abs = issue_dir / name
     b. IF lstat(abs) fails with ENOENT: digest[name] = { present: false, sha256: null }
     c. ELSE leaf = digestLeaf(abs)
        IF leaf.symlink OR abs is not a regular file: EXIT 2 "<name> is not a regular file"
        digest[name] = { present: true, sha256: leaf.sha256 }
     d. hasher failure from sha256() propagates as EXIT 2
  3. PRINT { issue, ac_checklist: digest["ac-checklist.json"],
             review_verdict: digest["review-verdict.json"] } as one JSON line
  4. EXIT 0
```

Graft prose (line 884) becomes: a dispatched graft runs `"$faff" evidence return --run-dir "$run_dir" --issue <ISSUE>` as its last action before returning and returns the printed line as `EvidenceReturn`, verbatim; on a non-zero exit it returns `EvidenceReturn: null` and names the stderr line in its trace. A legitimately absent file (a `retry-later` that wrote no `review-verdict.json`, an early park or errored state) comes out as `present:false` with no special handling.

**Dispatcher side.** Summary: re-hash the files in code, compare with what the lane reported, and print a verdict the orchestrator branches on without interpretation.

```
PROCEDURE verify_return(run_dir, issue, stdin):
  1. issue_dir = guardWriterPaths(run_dir, issue)            # exit 2 on rejection
  2. IF stdin is a TTY: EXIT 2 (usage)
  3. parsed = JSON.parse(stdin)                               # parse failure -> step 4 malformed
  4. IF parsed == null:
        returned = { ac_checklist: {present:false, sha256:null},
                     review_verdict: {present:false, sha256:null} }
     ELSE IF NOT well_formed(parsed, issue):                  # Appendix A
        PRINT { verdict:"malformed", issue, files:[], evidence_persisted:null,
                park_cause:"evidence-return malformed — <issue>/EvidenceReturn (malformed return)",
                paths:["<issue>/ac-checklist.json", "<issue>/review-verdict.json"] }
        EXIT 1
     ELSE returned = parsed
  5. FOR (key, name) IN [(ac_checklist, "ac-checklist.json"), (review_verdict, "review-verdict.json")]:
     a. r = returned[key]
     b. disk = lstat(issue_dir / name): absent | regular | other
     c. IF disk == other: result = not-regular-file, disk_sha256 = null
        ELSE IF no_claim AND disk == regular: result = no-claim     # no_claim: stdin null or no ledger entry
        ELSE IF r.present != (disk == regular): result = presence-disagreement
        ELSE IF disk == absent: result = absent-both
        ELSE: disk_sha256 = digestLeaf(...).sha256            # hasher failure -> EXIT 2
              result = (disk_sha256 == r.sha256) ? match : hash-mismatch
  6. IF every result IN {match, absent-both}:
        entry = { issue } plus ac_sha256 / review_verdict_sha256 for each match
        evidence_persisted = (entry has a sha field) ? entry : null
        PRINT { verdict:"agree", ..., park_cause:null, paths:[] }; EXIT 0
  7. ELSE PRINT { verdict:"mismatch", ..., evidence_persisted:null,
                  park_cause per the cause table, paths: failing files }; EXIT 1
```

**Orchestrator branch (l4.md obligation 6 rewrite).**

```
PROCEDURE on_subagent_return(member, token, evidence_return):
  1. obligation 5 run-grain verify (unchanged); non-zero -> obligation 5 park, stop
  2. v = faff evidence verify-return --run-dir R --issue member  < evidence_return (or null)
  3. exit 0: IF v.evidence_persisted != null:
                append v.evidence_persisted to run-ledger.json evidence_persisted[]
                through obligation 5's re-baseline sequence (Class B, unchanged)
             proceed to token reconcile / obligation 7
  4. exit 1, verdict mismatch: unit-scoped park (faff-parked + comment, bucket parked),
             cause = v.park_cause, append each string of v.tampered_paths to integrity_tampered;
             never halts a wave
     exit 1, verdict malformed: unit-scoped park, cause = v.park_cause,
             no integrity_tampered entry
  5. exit 2: unit-scoped park, cause "evidence-return verification unavailable — <stderr line 1>",
             no integrity_tampered entry
  6. discard evidence_return; nothing from it is needed again

PROCEDURE before_merge_locus(member):              # obligation 7, new step ahead of floor assert
  1. obligation 5 run-grain verify; non-zero -> obligation 5 park, never merge
  2. v = faff evidence verify-return --against-ledger --run-dir R --issue member
  3. exit 0 -> continue to the floor assert; no ledger write
  4. exit 1 / exit 2 -> park as steps 4 / 5 above; never merge
```

The pre-merge re-verify replaces the protection the dispatcher's rewrite used to give and closes more: the rewrite only overwrote a change landing in the instant between check and rewrite, while the re-verify catches any change to the files between the return check and the merge, including one made by a sibling lane in the parallel executor (FAFF-749 named sibling-lane mutation of a per-issue directory as a residual).

**Placement prose.** Both executors keep their placement paragraphs and refer back to obligation 6; only the wording changes: "raw-bytes leaf-sha256 identity" becomes "`faff evidence verify-return`", "persist the returned body to the run-dir path" is removed, and "against the dispatcher-persisted `ac-checklist.json` / `review-verdict.json`" in the obligation 7 placements becomes "against the dispatcher-verified". Neither placement restates the verifier's rules.

**ADR-0077 amendment.** Add one Consequences bullet, "Return by digest (FAFF-1397 amendment)", stating: for `ac-checklist.json` and `review-verdict.json` the lane returns per-file leaf sha256 digests, the dispatcher verifies them in code and records them, and it no longer rewrites the files because at rung 0 that rewrite reproduced identical bytes at the identical path; a content-carrying return is reintroduced when FAFF-517's mount stops the lane writing those paths. The Decision text stays as written; the amendment follows the existing "Cut-keying invariant (FAFF-750 amendment)" precedent.

**Exposure audit (how other checks were examined).** A grep of `plugin/skills/**/*.md` (excluding `contracts/`) for `sha256`/`sha-256` on lines that also mention `return`, `subagent` or `lane` finds eight lines: `l4.md` 66, 67, 69; the parallel executor 78 and 99; the sequential executor 40 and 42; `faffter-noon-ship` 47. Only `l4.md` 67 and its two placements (parallel 99, sequential 40) hash subagent-returned text. The others hash files or CLI output the orchestrator produced itself (`integrity-digest verify`, `--record-result`, `corrective author`'s reported sha256) or pass a hex sha256 into a subagent, and hex is immune to entity escaping. A second grep for `raw bytes`, `byte-identical`, `byte-exact`, `returned body`, `returned copy` finds no other comparison of returned text against a file. The build agent re-runs both greps after the edit and records the result in the PR body (DONE item).

**Edge cases.**

- `EvidenceReturn: null` with both files absent on disk: verdict `agree`, `evidence_persisted: null`, no ledger write (today's "neither parks nor persists").
- `EvidenceReturn: null` with a file present on disk: `no-claim`, unit parked, no `integrity_tampered` entry. A lane whose `faff evidence return` failed is a tooling fault, not tamper.
- An explicit claim that disagrees with disk (`present:false` with the file on disk, or `present:true` with it absent): `presence-disagreement`, which is recorded as tamper.
- Legacy return carrying `body`: `malformed`, exit 1, park. No unescape, no hashing of the body (section 6).
- Uppercase hex, short hex, or `sha256` non-null with `present:false`: `malformed`.
- A chain returns one EvidenceReturn per member; the dispatcher runs the verifier once per member with that member's `--issue`.
- Stdin holding valid JSON for a different issue: `malformed` (the verifier never trusts the returned `issue`).

**Failure modes.**

- **The failure:** the lane transcribes the CLI line wrongly (a dropped or changed hex digit), and a clean build parks as `hash-mismatch`.
  - **How you'd know:** the park comment's verdict shows `returned_sha256` differing from `disk_sha256` while `faff evidence return` re-run on the same files reproduces `disk_sha256` and the lane's own trace shows the CLI output.
  - **What it means:** proceed. 64 hex characters per file is far less to copy than the 15.6 KB body the lane copied faithfully in the observed run; if this shows up repeatedly, the next step is a structured return field filled by the harness, not a looser compare.
- **The failure:** the return channel transforms something other than `<`, `>`, `&` (for example quote characters), breaking the JSON.
  - **How you'd know:** `malformed return` park causes on builds whose files verify clean when re-run by hand.
  - **What it means:** narrow. The verdict is fail-closed, so nothing merges wrongly; the transport needs its own ticket.
- **The failure:** the conversation is compacted between the return check and the merge locus.
  - **How you'd know:** nothing visible; that is the point of the design. The re-verify reads the ledger entry, not the conversation.
  - **What it means:** proceed. If the first check never ran (no `evidence_persisted` entry while files exist), the re-verify finds no claim for a file on disk and parks with `no-claim`. It fails closed and never merges unverified evidence.
- **The failure:** dropping the body leaves FAFF-517 with no content channel when the mount lands.
  - **How you'd know:** FAFF-517's prep finds the lane can no longer write the run-dir evidence path.
  - **What it means:** proceed now; FAFF-517 adds a content field to `faff evidence return` (OUT OF SCOPE, first item).

**Anti-pattern:** hashing the returned body after HTML-entity unescape. Why: the dispatcher would be guessing which transform the transport applied, which FAFF-749 forbids ("the dispatcher never guesses a body"), and an unescape makes `&lt;` in a file equal to `<` in a return, widening what passes.

**Anti-pattern:** the orchestrator computing a sha256 itself (with `shasum`, `integrity-digest hash`, or by reasoning). Why: that is the hand-hashing seen in the observed run, and it is exactly the step that a transport quirk corrupts.

**Anti-pattern:** having `verify-return` write the evidence files or the ledger. Why: the files would be rewritten with their own bytes, and a ledger write would make the verifier a new Class A writer outside obligation 5's roster.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a dispatched lane whose ac-checklist.json contains "<unknown>" and "->"
  and whose review-verdict.json contains no angle brackets
When the lane returns the line printed by `faff evidence return`
  and the dispatcher pipes that line, as received through the return channel, into `faff evidence verify-return`
Then verify-return exits 0 with verdict "agree"
  and evidence_persisted carries both files' leaf sha256 values, equal to `faff integrity-digest hash` of each file
  and no park is recorded for the unit
```

```
Given a lane returned an EvidenceReturn for ac-checklist.json and review-verdict.json
When a process appends one byte to ac-checklist.json after the return and before the dispatcher's check
Then verify-return exits 1 with verdict "mismatch"
  and park_cause is "evidence-return mismatch — <issue>/ac-checklist.json (returned copy ≠ on-disk copy)"
  and only that unit is parked; sibling units in the same wave keep running
```

```
Given a lane return that passed verify-return on return
When ac-checklist.json is modified after that check and before the merge locus
Then the pre-merge re-verify exits 1, the unit is parked, and slots.ship is never invoked for it
```

```
Given a member whose return check agreed and whose evidence_persisted entry is in the ledger
  and the dispatcher's conversation has since been compacted
When ac-checklist.json is modified before the merge locus
  and the dispatcher runs the run-grain verify and `faff evidence verify-return --against-ledger`
Then verify-return exits 1 with result "hash-mismatch", the unit is parked, and slots.ship is never invoked
```

```
Given a pr-ready member with ac-checklist.json on disk and no evidence_persisted entry in the ledger
When the dispatcher runs `faff evidence verify-return --against-ledger` before the merge locus
Then verify-return exits 1 with result "no-claim", the unit is never merged,
  and no integrity_tampered entry is written
```

```
Given an EvidenceReturn whose JSON the return channel has broken
When it is piped into verify-return
Then verify-return exits 1 with verdict "malformed"
  and the unit is parked with no integrity_tampered entry
```

```
Given an EvidenceReturn in the old shape, carrying ac_checklist.body instead of ac_checklist.sha256
When it is piped into verify-return
Then verify-return exits 1 with verdict "malformed" and never hashes the body
```

- Neither `faff evidence return` nor `faff evidence verify-return` writes any file.

## 6. DESIGN DECISION RATIONALE

**What crosses the return channel?**

- Raw body (today): breaks on entity escaping; makes the lane transcribe files up to 37,872 bytes (largest `ac-checklist.json` under `.faff/runs/`).
- Base64 body plus digest: immune to entity escaping and keeps a content channel, but asks the lane to copy up to about 50 KB of base64 with no redundancy, a new false-park source, while the content it carries is byte-identical to the file already at the same path.
- Digest only, computed by a CLI: immune to escaping, 64 hex characters per file, same detection guarantee.

**Chosen:** digest only, computed by `faff evidence return`. Rationale: at rung 0 the body never carried information its hash did not (section 4, "Why the body adds nothing today"), and the digest has the smallest transport surface. At the time of writing FAFF-517's read-only mount is not built; when it is, a content field returns with it (OUT OF SCOPE).

**Does this contradict ADR-0077?** ADR-0077's Decision says lanes "return the data in their terminal payload; the dispatcher verifies the digest bracket, then persists". The tree and the issue's suggested fix disagree on that sentence, so the spec surfaces it rather than editing around it.

- Keep the body to honour the ADR text: keeps a no-op rewrite and the transport fault.
- Amend the ADR with the reason the rewrite is a no-op at rung 0.

**Chosen:** amend ADR-0077 with a "Return by digest (FAFF-1397 amendment)" Consequences bullet, following the FAFF-750 amendment precedent. Rationale: the ADR's goal (trust comes from who could have written the file, with tamper detected before consumption) is kept by the hash compare and strengthened by the pre-merge re-verify; the rewrite gave neither. A reviewer who reads the ADR as requiring a content channel at rung 0 should flag this decision.

**Where does the hashing live?**

- A new `faff evidence-return` command; flags on `integrity-digest`; verbs on `faff evidence`.

**Chosen:** two verbs on `faff evidence` (`return`, `verify-return`), reusing `guardWriterPaths` from `evidence.js` and `sha256`/`digestLeaf` from `integrity-digest.js`. Rationale: `faff evidence` already owns these two files' writers (`write ac-checklist`, `write review-verdict`), and the 2026-10-22 repo review (section 1.4) points orchestrator prose at commands that return typed tokens.

**Does the verifier write the ledger?**

- Verifier appends `evidence_persisted` itself and reports the ledger's new sha256 for a Class A `rebaseline`.
- Verifier prints the entry; the orchestrator appends it through the existing Class B re-baseline path.

**Chosen:** print only. Rationale: keeps obligation 5's Class A roster unchanged, keeps the verifier idempotent so the pre-merge re-verify can reuse it, and the ledger append was already a Class B hand-chained edit before this change.

**What does the pre-merge re-verify compare against?**

- The EvidenceReturn held in conversation context; a fresh `faff evidence return` at merge time; the custody-protected ledger entry.

**Chosen:** the ledger's `evidence_persisted` entry, read by `verify-return --against-ledger` right after obligation 5's run-grain verify. Rationale: conversation context does not survive compaction, and a fresh hash at merge time always agrees with disk, so it detects nothing. The ledger entry sits inside the run-grain chain, so it survives compaction and a change to it is caught first. Raised by all three refuting lenses in spec review round 1.

**Is a malformed return recorded as tamper?**

- Record it in `integrity_tampered`; park without a tamper record.

**Chosen:** park without a tamper record. Rationale: a malformed return shows the transport or the lane failed, not that a file changed, and `integrity_tampered` is read as evidence of tamper. The park stays fail-closed either way.

**When does this ship relative to the FAFF-974 collection window?**

- Merge and release normally; hold the release until collection stops (2026-10-31 at the latest).

**Chosen:** merge and release normally, and record the version boundary in the FAFF-974 `runs.md` when the release publishes. Rationale: the release changes no decision-kernel call site, and each run's version is already recorded, so the park population can be split by version in the report; holding it would cost up to a week of false parks in unattended runs. Confirmed by the FAFF-974 sitter on 2026-10-24 (human decision).

**Does the dispatcher still rewrite the evidence files?**

- Keep a read-then-rewrite of the on-disk bytes after a match; drop it.

**Chosen:** drop it, and add a pre-merge re-verify against the ledger entry. Rationale: rewriting a file with its own bytes is a no-op; the re-verify covers the window from return check to merge, which the rewrite never covered.

**What happens to a return in the old `body` shape?**

- Accept and hash after HTML-entity unescape; accept and hash raw; refuse as malformed.

**Chosen:** refuse as `malformed`, exit 1, park. Rationale: the lane and the dispatcher resolve the same `faff` binary in one session (graft line 91, `command -v faff`), so an old-shape return from a new-version run does not arise in practice; unescaping would be the dispatcher guessing a body, which FAFF-749 forbids.

**What does the verifier do when it cannot verify?**

- Treat as mismatch; treat as obligation 5's exit 2.

**Chosen:** exit 2 with a unit-scoped park and no `integrity_tampered` entry, mirroring obligation 5's exit-2 handling. Rationale: a missing hasher is an environment fault, and obligation 5 already separates it from tamper.

**Keep the `evidence_persisted` name?**

**Chosen:** keep the name and schema. Rationale: renaming is a v0.3 schema change for no behavioural gain (OUT OF SCOPE).

**Park-cause wording for the new failures.**

**Chosen:** reuse the existing cause format and its separator, adding two parentheticals (`on-disk copy is not a regular file`, `malformed return`) and one exit-2 cause shaped like obligation 5's. Rationale: park causes are a matched string family; one format keeps them greppable.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ADR-0077 amendment (section 6, "Does this contradict ADR-0077?") was accepted by the human on 2026-10-24.

**Assumptions.**

- **Assumes:** the subagent return channel leaves JSON punctuation (`{`, `}`, `"`, `:`, `,`), letters, digits and `-` unchanged, so the EvidenceReturn line (which contains no `<`, `>` or `&`) crosses it byte for byte. Validation: the observed run already shows this, since `review-verdict.json` (5,493 bytes of JSON with quotes and colons, no angle brackets) came back with a matching sha256; if the builder runs a dispatched test build to compare the received EvidenceReturn line with the lane's `faff evidence return` stdout, that run is labelled as an instrumentation test in the FAFF-974 `runs.md` before it starts, so protocol v2 excludes it.
- **Assumes:** a dispatched lane's `FAFF_RUN_DIR` is the orchestrator's run dir, so the lane's and the dispatcher's `--run-dir` name the same directory. Validation: in the observed run, `run-ledger.json`'s `evidence_persisted[0].ac_sha256` (`522a278b…c8df2`) equals `faff integrity-digest hash` of `FAFF-1112/ac-checklist.json` in the same run dir.

## 8. DONE: definition of done

### From WHY
- [ ] A dispatched build whose `ac-checklist.json` contains `<`, `>` and `&` passes obligation 6 with `verify-return` exit 0 when the files are untouched (first scenario).
- [ ] No obligation 6 prose (l4.md, both executors, graft) asks any agent to compute, compare or paste a sha256 or a file body by hand.

### From WHAT (types and interfaces)
- [ ] `faff evidence return --run-dir <dir> --issue <id>` prints one JSON line matching the EvidenceReturn record, with lowercase 64-hex `sha256` for present files and `null` for absent ones, and exits 0.
- [ ] `faff evidence return` exits 2 with nothing on stdout when an evidence file is a symlink, when `--run-dir` is outside `.faff/runs/`, or when `--issue` fails the issue-id rule.
- [ ] `faff evidence verify-return` prints a ReturnVerdict with `files` in the order `ac-checklist.json`, `review-verdict.json`, and `issue` equal to `--issue`.
- [ ] `verify-return` exit codes are 0 for `agree`, 1 for `mismatch` and `malformed`, 2 for usage, path rejection, TTY stdin, or hasher unavailable (nothing on stdout for 2).
- [ ] `evidence_persisted` in the verdict validates against the `evidence_persisted` item schema in `run-ledger.schema.json` and is `null` when no file matched.
- [ ] Each park cause in the section 3 cause table is produced verbatim by its condition.
- [ ] `TerminalToken{issue,outcome,pr}` text is unchanged in graft and both executors; EvidenceReturn is still described as a sibling field.
- [ ] `docs/guide/cli.md` has one row each for `evidence return` and `evidence verify-return`, and `evidence.js` `USAGE` lists both.

### From HOW (behaviour)
- [ ] `l4.md` obligation 6 describes the digest-only EvidenceReturn, the `verify-return` call, the exit-code branch (0 append, 1 unit park with `integrity_tampered`, 2 unit park without), and no longer tells the dispatcher to rewrite the evidence files.
- [ ] `l4.md` obligation 7 runs obligation 5's run-grain verify and then `verify-return --against-ledger` before asserting the floor, parks on non-zero, and says "dispatcher-verified" where it said "dispatcher-persisted".
- [ ] No obligation 6 or 7 prose tells the dispatcher to keep an EvidenceReturn in conversation context past the first check.
- [ ] `verify-return --against-ledger` reads the last `evidence_persisted` entry for `--issue`; with no entry and a file on disk it gives `no-claim`; with a missing or unparseable ledger it exits 2.
- [ ] A `malformed` verdict parks the unit without an `integrity_tampered` entry; a `mismatch` verdict appends each `tampered_paths` string to `integrity_tampered` (none for a `no-claim`-only mismatch), and the result validates against `run-ledger.schema.json`.
- [ ] FAFF-517 carries a comment naming the content-carrying return it inherits (OUT OF SCOPE, first item), and keeps its tracker relation to FAFF-1397, so its prep sees the obligation from the link as well as the text.
- [ ] Graft line 884 tells a dispatched lane to return the `faff evidence return` line verbatim, or `EvidenceReturn: null` on a non-zero exit.
- [ ] The parallel executor (lines 99, 103) and sequential executor (lines 40, 42) placement prose refer to `faff evidence verify-return` and do not restate its rules.
- [ ] ADR-0077 carries the "Return by digest (FAFF-1397 amendment)" Consequences bullet; its Decision text is unchanged.
- [ ] Neither verb creates, modifies or deletes any file (checked by snapshotting the run dir before and after in a test).
- [ ] No decision-kernel call site (`next`, `eligible`, `claim-verdict`, `park-verdict`, `run-start`, `run-outward`, `run-done`, `queue-state`, `project-next`) changes in the diff.
- [ ] The PR body records the two exposure-audit greps from section 4 and their results after the edit.

### From HOW (edge cases)
- [ ] stdin `null` with both files absent gives `agree`, `evidence_persisted: null`; stdin `null` with a file present gives `no-claim` and no `integrity_tampered` entry.
- [ ] A return carrying `body`, an uppercase or short hex, `present:false` with a non-null `sha256`, an extra key, or an `issue` different from `--issue` each give `malformed`.
- [ ] A symlink at an evidence path gives `not-regular-file` in `verify-return`.

### Repository checks
- [ ] A new `test/evidence-return.test.mjs` (node:test, `runCli` helper, fixture pattern from `test/evidence-write.test.mjs`) covers every DONE item above that names CLI behaviour, including a round trip where the EvidenceReturn line is passed through an HTML-entity escape of `<`, `>`, `&` before `verify-return` and still agrees.
- [ ] `faff evidence --selftest` passes and covers one agree and one mismatch case for the new verbs.
- [ ] `faff validate-adapters` reports no new FAIL; `faff-graft/SKILL.md` stays at or under 893 lines, and `SKILL_LINE_BASELINE["faff-graft"]` is lowered to the new line count if it shrank.
- [ ] New prose in the edited Markdown files uses Canadian spelling and no em dashes outside the quoted park-cause strings.

### Integration smoke test

```
PROCEDURE smoke():
  1. make a run dir under .faff/runs/ with ISSUE-1/ac-checklist.json containing "<unknown> -> &"
     and ISSUE-1/review-verdict.json containing no angle brackets
  2. line = run `faff evidence return --run-dir R --issue ISSUE-1`; expect exit 0
  3. received = html_escape(line)                     # simulate the transport; hex JSON is unchanged
  4. v = run `faff evidence verify-return --run-dir R --issue ISSUE-1` with stdin = received
  5. expect exit 0, v.verdict == "agree",
     v.evidence_persisted.ac_sha256 == `faff integrity-digest hash` of ac-checklist.json
  6. append one byte to ISSUE-1/ac-checklist.json; re-run step 4
  7. expect exit 1, v.files[0].result == "hash-mismatch", run dir otherwise unchanged
```

## 9. APPENDICES

### Appendix A: `well_formed(parsed, issue)`

```
well_formed(p, issue) is true iff all hold:
  - p is a JSON object with exactly the keys issue, ac_checklist, review_verdict
  - p.issue is a string equal to issue
  - for k in [ac_checklist, review_verdict]:
      p[k] is an object with exactly the keys present, sha256
      p[k].present is a boolean
      p[k].present == true  -> p[k].sha256 matches ^[0-9a-f]{64}$
      p[k].present == false -> p[k].sha256 is null
```

### Appendix B: self-review record

Run in-context (this producer is a dispatched subagent), against the draft and the codebase.

| Severity | Finding | Resolution |
|---|---|---|
| major | The draft first described the change as "no change to detection". Dropping the dispatcher's rewrite does remove a (very small) property: the rewrite overwrote any change landing between check and rewrite. | Applied: added the pre-merge re-verify (section 4, obligation 7 step) so the change is strictly stronger, and recorded it as a decision. |
| major | ADR-0077's Decision text mandates a body return and dispatcher persist; the issue's suggested direction contradicts it. Silently editing the prose would leave the ADR and the tree disagreeing. | Applied: surfaced as its own decision in section 6 with the rung-0 reasoning, plus an amendment bullet in ADR-0077 as a DONE item. |
| minor | Obligation 5 prose appends `{issue, paths}` objects to `integrity_tampered`, but the v0.3 schema types items as strings. | Noted under OUT OF SCOPE, not filed; `verify-return` emits `paths` and leaves the ledger shape to obligation 5. |
| minor | Draft named a test file by guess. | Checked `test/evidence-write.test.mjs` for the fixture and `runCli` pattern and named the new file to match. |
| minor | Draft had the verifier read empty stdin as "no EvidenceReturn", which hangs on a TTY. | Applied: the literal JSON `null` means none; TTY stdin exits 2 (the `findings-reconcile` precedent in `docs/guide/cli.md`). |
| minor | Checked whether any test pins obligation 6's prose (`grep` for `ac_checklist`, `evidence-return mismatch`, `obligation 6` in `test/` and `bin/`). | None found; no test update needed beyond the new file. |
| none | Checked: `integrity-digest.js` exports `sha256`; `digestLeaf` is module-private (exported list at line 653 omits it). | Builder exports `digestLeaf` or reimplements its four lines over the exported `sha256`; recorded here so it is not a surprise. |

Verified against the tree: `evidence_persisted` has no code consumer under `plugin/skills/faff/bin` or `test/`; the observed run's ledger holds one `evidence_persisted` entry and the FAFF-1112 files sit under the main-checkout run dir; `faff-graft` baseline is 893 in `validate-adapters.js` line 65; `guardWriterPaths` accepts a working-checkout or main-checkout run dir.

Blockers: 0. Majors: 2 (both applied). The rating cap does not apply.

confidence: high
build-tier: complex
spec-review: accept (human, 2026-10-24; round 2 `revise` on 2 minors, both fixed in this revision)

> Revised 2026-10-24 after spec review rounds 1 and 2: the pre-merge re-verify reads the custody-protected ledger entry, not a held return; malformed and no-claim parks write no tamper record; `integrity_tampered` entries are schema-typed strings; release timing and collection-window labelling are decided; FAFF-517 gets a comment and keeps its relation.
