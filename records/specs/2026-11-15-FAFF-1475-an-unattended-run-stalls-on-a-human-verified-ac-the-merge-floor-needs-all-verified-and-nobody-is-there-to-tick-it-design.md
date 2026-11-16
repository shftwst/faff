*Agent-written (Claude Code), at the operator's request: FAFF-1475 spec, revision 4 (2026-11-15), produced by interactive prep after spec-review round 3. Operator decisions recorded in section 3: do both, admission and call-out-and-skip; revise around an anchored human-only file; file tickets, revise to r3; fix three defects (r4), promote, no more rounds.*

# FAFF-1475: an unattended run must not stall on a human-verified AC

> Spec: faffter-dark-nlspec · 2026-11-15 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1475.

This spec is the design record for one change that ships as three tickets: FAFF-1476 (slice 1, marker parse and mint), FAFF-1475 (slice 2, the skip paired with its surfacing) and FAFF-1477 (slice 3, admission refusals). Sections 1 to 4 are shared by all three. Section 8 splits the Definition of Done by ticket, and FAFF-1475's own DONE is slice 2 only. The operator decided the direction on 2026-11-14 and approved this revision (r4) on 2026-11-15 ("Fix 3 defects (r4), promote, no more rounds"). Every claim about existing code below was read in the repository on 2026-11-15; file and line references are given so the builder can re-check them.

## 1. WHY

**The load-bearing model.** The merge floor may skip a pending human-only criterion only on facts that trusted code derived, never on a field the builder's checklist carries. `faff pr open` is that trusted code. It reads the spec exactly as graft captured it, works out which done-items the spec author tagged `needs-human:`, notes whether the run is unattended, and freezes both facts into one new anchored file, `human-only-acs.json`, whose digest it stamps into the hash-chained events ledger. Both floors, `faff merge-gate` and the governance-check Action, read that file (and its stamp) and nothing else to decide the skip. A skipped criterion stays `passed:false` and is called out in the merge result, the merge record and the run summary.

**Problem.** A spec can carry a done-item only a person can check, such as "prices match the published pricing page". Graft records it `passed:false` with `{kind:"human"}`, so `all_verified` is false and `readAcComplete` refuses the merge. On an unattended run (L4, or L3 declared unattended) nobody ticks it, so the run stalls. FAFF-1199 (PR 1142) and FAFF-1261 (PR 1086) both stalled this way and were cleared by hand.

**Design principles.**

- **Fail closed to attended.** A missing, unreadable, unstamped or inconsistent `human-only-acs.json` means no skip. The attended path is byte-identical to today.
- **The checklist cannot opt out of an AC.** Nothing in `ac-checklist.json` marks a criterion skippable, and its schema does not change. A machine-checkable AC the builder gives up on still blocks.
- **Called out, never dropped.** A skip and its surfacing ship together, in one ticket (FAFF-1475). No release carries the skip without the merge record and run summary lines.
- **One fact, one reader.** The unattended fact is frozen at mint into the same file the human-only ids sit in, so the two floors cannot disagree and no operator-set input has to be kept in step.
- **A stale file never outlives its mint.** Any mint fault, and every run that reaches the mint step, removes the file from both the run dir and the committed anchor destination before anything else happens.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/pr-open.ts` | TypeScript | `faff pr open`; step 9 returns `already-open`, step 10 (line 293) spawns `faff events anchor`, step 11 (line 302) runs `git add -- <dest>`; step 6 already writes one evidence file the same way |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `mintIssueAnchor` (line 1749); `optionalFloorFiles` at line 1788 is the anchor copy list |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` | JavaScript | `gitRun` (20), `resolveAnchorLevel` (55), `alreadyMergedReconcile` (120), `writeMergeRecord` (192), `resolveIntegrity` (249), `readAcComplete` (319) |
| `plugin/skills/faff/bin/lib/merge-gate.js`, `merge-gate-local.js` | JavaScript | build the `floor` object (lines 226 and 243) |
| `plugin/skills/faff/bin/lib/governance-check.js` | JavaScript | `evaluateMergeFloorLeg` (138), `evaluateAnchorDir` (264), `evaluateRunDir` (552) |
| `plugin/skills/faff/bin/lib/admissibility.js`, `ac-id.js` | JavaScript | `dodClassify` and `parseDoneChecklist`; `parseLocalAcId` |
| `plugin/skills/faff/bin/lib/evidence.js` | JavaScript | the `WRITERS` map (line 1283), `guardWriterPaths`, `writeTerminalReviewVerdict` (line 1018, the precedent for a writer that stamps an event), the manifest-driven validator |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | `mainWorktreeRoot` (line 610), the existing main-checkout resolver |
| `plugin/skills/faff/bin/lib/run-summary.ts` | TypeScript | shipped subsections (around line 509) |
| `verification/evidence/v0.3/` | JSON, Markdown | source of the evidence schemas, event schemas and manifest; `scripts/evidence-v0.3-compose.mjs` mirrors it into `plugin/skills/faff/contracts/evidence-v0.3/` |

**Scope.** This sits between graft's Step 8 checklist and the merge floor. FAFF-224 and FAFF-1072 already guard the admission side and the integrity side.

## 2. OUT OF SCOPE

- **Admission refusals** (refuse or rewrite an untagged human-judgement done-item at the lights-out gate). Why: separate, heuristic, changes admission for every existing spec, and is not needed for the stall fix. It is slice 3, filed as FAFF-1477 (Low priority, blocked by FAFF-1475). Extension point: `admissibleVerdict` in `admissibility.js`, beside the `BANNED_VAGUE` check.
- **Waiving machine-checkable ACs.** Why: the operator's intent covers only ACs a machine cannot check. Extension point: none.
- **Changing the attended or interactive merge.** Why: an open human AC keeps blocking until a person ticks it. Extension point: none.
- **FAFF-1339** (merge floor checks every delegated criterion has a passed checklist row). Why: it is blocked by FAFF-1475 in the tracker and builds on `readAcFloor`, which slice 2 creates. Extension point: `readAcFloor` in `merge-gate-floor.js`.
- **Adding `human-only-acs.json` to the evidence roster** (the `EvidenceReturn` digests, `correctiveIntegrityDirs` in `corrective-integrity.js`, and the `l4.md` obligation text). Why: the roster change ripples through exact-shape contracts and both concurrency occupants, and is its own ticket, FAFF-1478 (blocked by FAFF-1475). Extension points: `correctiveIntegrityDirs` and `EVIDENCE_FILES` in `evidence.js`.
- **Lane isolation** (the lane cannot write the evidence files at all). Why: FAFF-517, deferred in Backlog.
- **A new verification tier.** Why: a tier enum change ripples into the holdout record and contract defs for no gain. Extension point: `TIER_VERIFIER` in `admissibility.js`.
- **Git-only runs.** Why: `faff pr open` is a no-op with no remote (pr-open.ts step 2), so no file is minted and `merge-gate --local` blocks as today. It still reads the same anchored file if a future step mints one. Extension point: the step that anchors git-only runs (`events anchor-run`).
- **`faff governance-check` over a live run dir** (`evaluateRunDir`, line 552; its `evaluateMergeFloorLeg` call is at line 575). Why: a live run dir is lane-writable and has no committed anchor, so it passes no `humanOnly` input and stays attended.
- **Posting the call-out as a PR comment at merge.** Why: the merge result, merge record and run summary already carry it. Extension point: the merge-gate execute path.

## 3. WHAT

**Vocabulary.**

| Term | Meaning |
|---|---|
| human-only item | a DONE item whose text, after any `[ac-N]` id, begins `needs-human:` followed by a non-empty reason, authored in the spec |
| human-only set | the qualified `ac_id`s of the human-only items of one spec, for example `faff-9#ac-2` |
| captured spec | `<main checkout>/.faff/graft/<ISSUE>/captured-spec.md`, saved at graft Step 1 before the worktree exists (`faff-graft/SKILL.md:79`) |
| unattended | `level === "L4"`, or `level === "L3"` with `declaredUnattendedFromConfig(cfg)`; the rule `resolveIntegrity` already uses at `merge-gate-floor.js:271` |
| stamp | a `human-only-acs-stamp` event in the hash-chained `events.jsonl`, carrying the SHA-256 of the exact bytes of `human-only-acs.json` |
| called out | a human-only criterion left `passed:false` and skipped at an unattended merge, then listed in the outputs |

**Marker syntax.** `- [ ] [ac-2] needs-human: Prices match the published pricing page (external fact, no API)`. The optional `[ac-N]` id comes first, because `parseLocalAcId` strips only a leading lowercase `[ac-N] ` (`ac-id.js:23`). `dodClassify` then strips `needs-human:` and its whitespace (`admissibility.js:307` loop), sets the row's `human_only`, and classifies the remaining text. An empty reason is not a marker: the item stays literal, `human_only` is false, and a stderr advisory is written, as the existing `holdout:` DONE advisory does. A marker outside the DONE section is ignored.

```
RECORD ClassifyRow:                 # one per criterion of faff dod classify --json
  ...existing fields unchanged...
  human_only: boolean               # true only for a needs-human: DONE item; false on every other row
  # a human_only row is pinned to verification_tier "delegated" and verifier "ac-checklist"

RECORD HumanOnlyAcs:                # <run-dir>/<ISSUE>/human-only-acs.json, schema_version 1
  schema_version: 1
  faff_version: string?             # stamped by the writer like every evidence document
  issue: string                     # equals --issue, case-insensitive
  level: "L1" | "L2" | "L3" | "L4"  # the run-ledger level read at mint
  unattended: boolean               # resolveUnattended(level, config) at mint
  human_only: List<AcId>            # unique, each parses with parseAcId and names this issue; may be empty

  CONSTRAINT level in {L1, L2}  implies unattended == false
  CONSTRAINT level == L4        implies unattended == true

RECORD HumanOnlyAcsStamp:           # events.jsonl record, type human-only-acs-stamp, phase build, issue-scoped
  data.issue: string
  data.sha256: string               # 64 lowercase hex, SHA-256 of the written human-only-acs.json bytes
  # appended by the writer after the file lands; the latest stamp for an issue is the one that counts

RECORD AcFloor:
  complete: boolean
  called_out: List<AcId>            # empty unless complete came from the skip rule

RECORD MergeResult:                 # additive
  ...existing fields...
  ac_called_out: List<AcId>         # [] when none

RECORD MergeRecord:                 # merge-record.json, additive; its schema is open (additionalProperties true)
  ...existing fields...
  ac_called_out: List<AcId>?        # written only when non-empty
```

`ac-checklist.json` and its schema are unchanged. A skipped criterion is an ordinary `passed:false` row, so `all_verified` still equals every criterion passed and stays false.

**What the code does today (verified 2026-11-15).** These facts changed the design from the first draft.

| Fact | Where | Consequence |
|---|---|---|
| `readAcFloor` exists nowhere in the repository | whole-repo grep | it is a new function of slice 2, and FAFF-1339 extends it later |
| `faff pr open` runs in the build lane, including a dispatched lane; the dispatcher merges afterwards | `faff-graft/SKILL.md:495`; `references/l4.md` obligations 6 and 7 | the mint is not "after the builder can no longer write"; the trust claim is stated as in-lane, not lane-proof |
| the relocation (FAFF-748, 749, 750, 751) is built: the dispatcher persists and digest-verifies `ac-checklist.json`, `review-verdict.json` and `holdout.json` through `EvidenceReturn`, while the lane still authors their content | tracker state given by the operator, 2026-11-15; `corrective-integrity.js:211` roster | `human-only-acs.json` is outside that roster in this change; see the trust decision below |
| `mintIssueAnchor` creates the destination if absent and byte-copies into it; nothing in it deletes a file already there | `events.js:1749-1827` (`mkdirSync` at 1753, copy loop at 1791-1794) | a file removed from the run dir survives in a destination left by an earlier run; the mint must remove it itself |
| `PrOpenDeps.removeFile` ignores its argument and removes only the safe-body temp directory | `pr-open.ts:415-417` | it cannot delete the run-dir or anchor copy; the build adds a new dependency for that |
| `events anchor` byte-copies a fixed list of files from the run dir into the anchor; nothing hashes them afterwards | `events.js:1788`; the integrity leg re-hashes only the events and effects chains (`governance-check.js:217-259`) | a new file joins the list; without the stamp, no integrity leg covers it, exactly as for `ac-checklist.json` |
| an event type is a closed vocabulary: it needs a delivery-profile entry, a per-type schema, a composed `run-event.schema.json`, an example pair and a `logs.md` row; `evidence-terminal-only` (FAFF-1277) is the precedent for a writer appending one | `governance-profile.js:138,148`; `schema/events/evidence-terminal-only.schema.json`; `logs.md:68`; `evidence.js:1018-1039`; the type is also named in `scripts/evidence-v0.3-compose.mjs`, `test/evidence-payload-coverage.test.mjs`, `test/faff-1353-write-core-issue-scoped.test.mjs` | mechanical to add |
| merge-gate already reads `level` from the head-pinned committed anchor blob, by `git show <head>:<anchor>/run-ledger.json` with a Contents API fallback | `merge-gate-floor.js:55-96`; `merge-gate.js:173` | the new file and `events.jsonl` are read the same way, at the same head |
| the Action reads the anchor directory of the PR head; anchor dirs come from the PR's changed paths | `governance-check.js:264-302`, `deriveAnchorDirs` (408) | no config or flag is needed on the Action side |
| `faff evidence validate` fails a file in an anchor that has no manifest entry; the manifest has twelve entries, pinned by a test and a selftest line; the mint-time schema check is warn-only and the Action's evidence-schema leg is opt-in (`--require-evidence-schema`) | `anchor-manifest.md`; `test/evidence-v0.3.test.mjs:50,79`; `evidence.js:1579`; `events.js:1711`; `governance-check.js:307,828` | a manifest entry, a schema and examples are required in `verification/evidence/v0.3`, then mirrored by the compose script |
| `delegated[]` rows are closed to six keys, but built from named keys, never copied from classify rows | `holdout-record.js:29,132-133,244-257` | a `human_only` key on classify rows never reaches `delegated[]`; no change there |
| DONE ids are positional by item index, and `[ac-N]` is stripped only at the start of the item | `admissibility.js:352-355`; `ac-id.js:23-28` | the marker after the id changes no id; the full and builder views give the same DONE ids because `dod split` withholds only Scenarios units (`test/dod.test.mjs:150-158`) |
| `evidence.js` is governance region, `admissibility.js` is factory region, and governance must not require factory; `shared-infra.js` may be required by both | `regions.js` header; `shared-infra.js:1-7` | the writer validates a document it is given; the derivation lives in `pr-open.ts` (factory), and the shared reader lives in a new governance module |
| `pr-open.ts` has no main-checkout resolver; it runs in the worktree and its `git` dependency uses that cwd | `pr-open.ts:396-397` | the build adds a dependency that wraps `mainWorktreeRoot` (`shared-infra.js:610`), which returns null on any probe failure |
| graft Step 8 already leaves a human AC unticked with "Needs human verification: <reason>" in `verified`, and `renderAcChecklist` prints it | `faff-graft/SKILL.md:306-320` | the PR body already shows the criterion; no render change |
| `evidence-documents.md` lists each anchored file with its writer and carries the trust paragraph for the checklist | `verification/evidence/v0.3/evidence-documents.md:10-15,147-150`; mirror at `plugin/skills/faff/contracts/evidence-v0.3/evidence-documents.md` | slice 1 adds a row and a trust note there; `anchor-manifest.md` also states "twelve files" and changes with the manifest |

**Design decisions.**

- **Both mechanisms, as the operator decided.** **Chosen:** do both: admission refuses or rewrites human-only done-items, and any human-only AC that remains is called out and skipped at merge on unattended runs; attended behaviour is unchanged. Operator words: "there should be no human ACs in unattended mode (or they should be allowed to be called out but skipped)". Slices 1 and 2 deliver the call-out-and-skip half and the minting it needs; the admission half is slice 3, FAFF-1477.
- **Trust root for the skip.** **Chosen:** a new anchored file `human-only-acs.json`, minted by `faff pr open` and read by both floors, with its digest stamped into the events ledger; `spec-commit.json` and every other file the build lane writes are not consulted for the skip. Rationale: `spec-commit.json` is a run-dir file outside the anchor, and its hash only proves the committed spec matches its own record. The new file is derived from the main-checkout captured spec by faff code, not authored by the lane, but it is written inside the lane, so its trust is weaker than the checklist's on one axis. The trust decision below says exactly which.
- **Where the human-only set comes from.** **Chosen:** `faff pr open` derives it by running `faff dod classify` over the captured spec in the main checkout, which it locates itself through a new `mainCheckout` dependency wrapping `mainWorktreeRoot`; there is no path flag, so the lane cannot point it at another file. Rationale: the captured spec is the file `faff spec verify` and graft Step 8 grade against, and it is not the worktree copy the builder edits. Derived, not authored: the lane never writes the ids.
- **The unattended fact.** **Chosen:** computed once at mint as `resolveUnattended(level, config)` from the run-ledger `level` and the main checkout's config, written into the file, and read from it by both floors. The Action gets no `--unattended` input, and the base-branch workflow owns nothing. Rationale: one frozen fact cannot drift between floors, and the PR head's config stays out of the gate. Changing config after mint takes effect on the next mint, never retroactively.
- **How the floors read the file.** **Chosen:** merge-gate, `--local` and the already-merged reconcile read the file blob and the anchored `events.jsonl` blob from the head-pinned commit as raw bytes through the new `readAnchoredBytes` (next decision); governance-check reads both from the anchor dir with `fs.readFileSync` and no encoding. The reader returns `null`, meaning no skip, unless: the JSON parses, `schema_version` is 1, `issue` matches, `level` equals the anchored ledger level, `unattended` obeys the level constraints above, every id parses and names this issue, and the latest `human-only-acs-stamp` event for the issue carries the SHA-256 of the file's exact bytes. Rationale: these checks cost nothing beyond one more blob read and turn a hand-edited file, a level or ticket mismatch, or a missing stamp into a stall instead of a skip.
- **Byte-exact reads.** **Chosen:** the floors read blobs as raw bytes through a new helper `readAnchoredBytes(cwd, repo, anchorPath, headSha)` in `merge-gate-floor.js`, created in slice 1 with the reader module and unused by the floors until slice 2: `git show <head>:<path>` with `encoding: "buffer"`, no trim and a 64 MiB `maxBuffer`, then a Contents API fallback that decodes `content` from base64 without trimming and returns null when no inline content comes back. The reader takes bytes and decodes UTF-8 only to parse. `gitRun` and `resolveAnchorLevel` are unchanged and not reused. Evidence: `gitRun` trims stdout and keeps the default 1 MiB buffer (`merge-gate-floor.js:20-24`), while writers end evidence files with a newline (`evidence.js:740,1171`) and the stamp hashes exact bytes, so through `gitRun` every legitimate read would mismatch and the untrimmed base64 path (`:87`) would disagree. Limit: GitHub documents no inline Contents API content above 1 MB, so on the pure-remote path a larger `events.jsonl` yields null and the run stays attended.
- **Tier.** **Chosen:** `human_only` is a boolean on the classify row; the tier stays `delegated` and the verifier `ac-checklist`, pinned even when the item text carries a code-surface signal. Rationale: the checklist already receives DONE items by id, and a new tier touches `TIER_VERIFIER`, `holdout-record.js` pairing checks and contract defs.
- **Where the skip is decided.** **Chosen:** a new `readAcFloor(runDir, issue, humanOnly)` beside `readAcComplete`, where `humanOnly` is the reader's output or `null`. Five call sites use it: `merge-gate.js`, `merge-gate-local.js`, `alreadyMergedReconcile`, the governance-check anchor leg, and (passing `null`) the governance-check live-run-dir leg. `readAcComplete` and `decideFloor` are unchanged, and `decideFloor` still pushes "ACs not all verified" on every non-skip case. Rationale: one rule, no forked copy. The two floors keep their own failure texts: the governance leg says "ac-checklist.json missing/incomplete" (`governance-check.js:142`) and the merge-gate legs say "ACs not all verified" (`contract-defs-floor.js:112`, `merge-gate-floor.js:122`).
- **Classifier version.** **Chosen:** the floor never re-runs `dod classify`; the classifier version matters only at mint, and the file freezes its result. Rationale: a later classifier change cannot alter merge outcomes for an already-minted PR.
- **What the trust claim is, and the roster.** **Chosen:** state the trust plainly and close the roster gap in its own ticket. The dispatcher persists and digest-verifies `ac-checklist.json`, `review-verdict.json` and `holdout.json` through `EvidenceReturn` while the lane authors their content; `human-only-acs.json` is outside that roster in this change. Its content is derived by faff code from the captured spec but written in the lane, and `faff evidence write human-only-acs` is directly callable by the lane. That is the same authorship as the checklist and weaker on the tamper-after-write axis. FAFF-1478 (blocked by FAFF-1475) adds the file to the roster (the `EvidenceReturn` digests, `correctiveIntegrityDirs`, the `l4.md` obligation text); FAFF-517 (lane isolation, deferred) would stop the lane writing at all. What this buys: editing prose (the worktree spec, the PR body) or a checklist field cannot produce a skip, because the set comes from the main-checkout captured spec through code; a direct call of the writer can, at the same trust level as writing `passed:true` through `faff evidence write ac-checklist`.
- **Ledger stamp.** **Chosen:** include it. The writer appends one `human-only-acs-stamp` event (`data.issue`, `data.sha256`) to the run dir's `events.jsonl` after the file lands, in slice 1; the reader requires the latest stamp for the issue to match the file's SHA-256, in slice 2. If the append fails the writer deletes the file it wrote and exits 2. The stamp rides into the anchor because `mintIssueAnchor` byte-copies `events.jsonl` (`events.js:1755`); `evidence-terminal-only` (`evidence.js:1018-1039`) is the appending-writer precedent, though it appends before its file lands, so the rollback is new logic. It catches a hand edit of the anchored file alone, and any edit of the file followed by a chain re-hash not matched by a newer stamp: the reader then returns no skip. It does not stop a lane that appends its own newer `human-only-acs-stamp` for an edited file, through `faff events append` or the writer, and re-runs `faff events anchor`. Code check: `faff events append` reads any event from stdin and requires only a profile phase and type and issue scope (`events.js:1179-1215`, `eventViolations` 207-217), and the delivery profile limits no type to an emitter (`governance-profile.js:138,148`; `data.writer` on `evidence-terminal-only`, `evidence.js:965`, is a label, not an identity), so once the type is in the profile any lane that can run the CLI can append a valid stamp. That is the same trust level as writing `passed:true`, closed only by FAFF-1478 and FAFF-517; the stamp is a check against a careless or injected single-file edit, not a lane-proof seal. Version skew: an older faff or Action validating an anchor with the new type or file warns and does not refuse by default: the mint-time schema check only writes to stderr (`events.js:1711`, call at 1498), and the evidence-schema leg is report-only without `--require-evidence-schema` (`governance-check.js:307,330-333,828`), which nothing in this repo's `action.yml` or workflows passes. With the flag, an older validator would be expected to refuse the unmanifested file and unknown type. Slice 1's soak covers the default case.
- **Stale anchored copy.** **Chosen:** the mint removes `human-only-acs.json` from both places before it does anything else, on every run that reaches the mint. In `faff pr open` a new step between step 9 and step 10 (after the `already-open` return, before `events anchor`) runs `git rm -f --ignore-unmatch --quiet -- <dest>human-only-acs.json` and deletes the run-dir copy `<run-dir>/<issue>/human-only-acs.json` through a new `removeStale` dependency. Every mint fault leaves both places empty. Rationale from the code: `mintIssueAnchor` never deletes from the destination (`events.js:1749-1827`) and step 11 stages the destination without removing anything (`pr-open.ts:302`), so deleting only the run-dir copy would leave an earlier mint's file in place; removing the destination copy first lets step 11 record a deletion or a modification. An earlier mint's stamp stays in the ledger, harmless with no file to match.
- **Re-mint on an open PR.** **Chosen:** option (c), no new surface: a stale or rejected file, or a flipped L3 flag, is remedied by adding a commit (`git commit --allow-empty`) and running `faff pr open` again; the mint stays after step 9. Evidence: step 9 returns `already-open` only when the open PR's `headRefOid` equals local HEAD and `git ls-tree HEAD -- dest` is non-empty (`pr-open.ts:285-288`). A new commit makes the heads differ, so the run falls through to removal, mint, anchor, add, commit and push (`:292-331`), and step 14 returns `already-open` after the push (`:333`). An unchanged-head re-run returns at step 9 before any mint and changes nothing. Rejected: (a) minting before step 9 writes the file and a stamp on a run that then commits nothing, so nobody commits them; (b) a flag or subcommand adds CLI surface for a rare repair. Slice 1 stays inert.
- **Where the call-out is recorded.** **Chosen:** `merge-gate` writes `ac_called_out` into `merge-record.json` (only when non-empty) and into its result JSON, and `run-summary.ts` renders a section from the merge records. There is no new run-ledger key and no beep-boop copy step. This refines the operator's "ledger key" wording, forced by the code: the ledger schema is closed (`run-ledger.schema.json`, `additionalProperties:false`) and the key would be an agent-copied prose step that can be skipped, whereas the merge record is written by the same code that makes the decision, its schema is open, and `run-summary.ts` already reads it (`run-summary.ts:774`). The PR body needs no change (table above), and `disposition.js` needs none.
- **Slice shape and tickets.** **Chosen:** three tickets, now filed. FAFF-1476 is slice 1 (marker parse and mint; blocks FAFF-1475). FAFF-1475 is slice 2 (the skip paired with its surfacing). FAFF-1477 is slice 3 (admission refusals; blocked by FAFF-1475; Low priority). FAFF-1475's own DONE is slice 2 only, FAFF-1476's DONE is slice 1, FAFF-1477's is slice 3. Slice 1 may merge alone because it changes no merge behaviour. Slice 2 is not built until slice 1 has minted the file in at least one real `faff pr open` anchor (a soak): slice 1 is the first code to put a new file, manifest entry and event type into real anchors, and a defect found only after the skip depends on it would show as unattended stalls with no obvious cause.
- **FAFF-1339 interaction.** **Chosen:** FAFF-1339 is blocked by FAFF-1475 in the tracker, so slice 2 lands first. FAFF-1339 then excludes human-only ids when it checks that every delegated `ac_id` has a passed checklist row. It cannot read the flag from `holdout.json` (closed `delegated[]` rows), so it reads `human-only-acs.json` through the same reader module, and it extends `readAcFloor` rather than adding a second function.

## 4. HOW

**Slice 1: mint (ticket FAFF-1476).**

```
PROCEDURE mint_human_only_acs(issue, runDir, dest):   # new step in faff pr open, after step 9, before the anchor step (step 10); skipped when step 9 returns already-open
  1. REMOVE FIRST, always:
       git rm -f --ignore-unmatch --quiet -- dest/human-only-acs.json     # tracked copy from an earlier anchor commit
       removeStale(dest/human-only-acs.json)                              # untracked copy from an earlier faulted run
       removeStale(runDir/issue/human-only-acs.json)
  2. mainRoot = mainCheckout()
     IF null: warn "human-only-acs.json not minted: main checkout not resolved"; RETURN
  3. captured = mainRoot/.faff/graft/<issue>/captured-spec.md
     IF unreadable: warn "human-only-acs.json not minted: captured spec unreadable"; RETURN
  4. rows = run `faff dod classify --spec captured --issue issue --json`
     IF it exits non-zero: warn; RETURN
  5. ids = ac_id of every row with source "done" and human_only true, in order
  6. level = the level field of runDir/run-ledger.json (the file the anchor step copies next)
     cfg = config loaded from mainRoot, never the worktree
     IF level is unreadable or not in L1..L4: warn; RETURN
  7. unattended = resolveUnattended(level, cfg)
  8. pipe { issue, level, unattended, human_only: ids } to `faff evidence write human-only-acs --run-dir runDir --issue issue`
     (the writer validates, writes the file, appends the human-only-acs-stamp event, and on a failed append deletes the file and exits 2)
     IF it exits non-zero: warn; removeStale(runDir/issue/human-only-acs.json); RETURN
  9. continue; the anchor step copies the file because events.js lists it in optionalFloorFiles, and copies the stamp because it copies events.jsonl
```

Step 1 is the only place the destination is cleared, so a run that reaches the mint starts from nothing and a later fault leaves nothing behind. Step 11 of `faff pr open` (`git add -- <dest>`, `pr-open.ts:302`) then records a deletion, a modification or an addition. Every failure is a warning in the `faff pr open` result and never a refusal, so PRs open exactly as before and simply carry no skip. The file is written even when `ids` is empty, so FAFF-1339 can read one file for every issue. When step 9 returns `already-open` (open PR, unchanged head, tracked anchor) none of the removal, mint or stamp runs and nothing changes; see the re-mint decision.

`resolveUnattended(level, cfg)` is extracted from `resolveIntegrity` (`merge-gate-floor.js:271`) and both call it.

**Slice 2: read and decide (ticket FAFF-1475).**

```
PROCEDURE read_human_only_acs(fileBytes, eventsBytes, issue, anchoredLevel):    # slice 1's governance module human-only-acs.ts
  1. parse fileBytes (decoded as UTF-8) as JSON; IF not an object: RETURN null
  2. REQUIRE schema_version == 1, issue matches, level == anchoredLevel
  3. REQUIRE unattended is a boolean, and the level constraints hold (L1/L2 false, L4 true)
  4. REQUIRE human_only is a list of unique strings, each parseAcId-valid and naming this issue
  5. stamp = the data.sha256 of the LAST human-only-acs-stamp event for this issue in eventsBytes (decoded as UTF-8)
     REQUIRE stamp exists and equals sha256(fileBytes)
  6. RETURN { unattended, ids }       # any failed REQUIRE returns null

PROCEDURE readAcFloor(runDir, issue, humanOnly):
  1. IF readAcComplete(runDir, issue): RETURN { complete: true, called_out: [] }
  2. IF humanOnly is null OR NOT humanOnly.unattended: RETURN { complete: false, called_out: [] }
  3. doc = parse ac-checklist.json; on any fault RETURN not complete
  4. REQUIRE doc.all_verified === false and doc.criteria is a non-empty array
  5. pending = criteria where passed !== true
  6. REQUIRE every pending criterion has a string ac_id in humanOnly.ids
       and a non-empty verifications list whose every entry is kind "human"
  7. REQUIRE at least one criterion has passed === true
  8. RETURN { complete: true, called_out: ac_ids of pending }
```

Where `humanOnly` comes from: merge-gate, `--local` and the reconcile read the head-pinned blobs (`human-only-acs.json` and `events.jsonl`) at the same head through `readAnchoredBytes`, and pass `anchoredLevel` from that read. A blob that cannot be read yields `null`. The governance-check anchor leg reads both from the anchor dir and takes `anchoredLevel` from the anchor's own `run-ledger.json`, which `evaluateAnchorDir` already parses (`governance-check.js:280`). `evaluateMergeFloorLeg(runDir, issue, level, humanOnly)` gains the fourth argument; absent means attended.

Every merge-gate result that evaluates the AC leg carries `ac_called_out`: the floor result and the already-merged reconcile result. `writeMergeRecord` gains a trailing optional `acCalledOut` argument, passed at the merge-ok call sites (`merge-gate.js:314,331`, `merge-gate-local.js:325`, `merge-gate-floor.js:133`). The governance-check floor result carries `ac_called_out`, and its text renderer prints one line naming the called-out ids.

**Slice 2: surfacing (ticket FAFF-1475).**

- **Run summary.** `run-summary.ts` reads `ac_called_out` from each shipped issue's `merge-record.json` and renders `## Shipped (human-only ACs called out)` listing each issue with its ids and "merged unattended; a person must confirm these criteria". An issue appears under exactly one shipped subsection, with precedence post-merge flagged, then called out, then adversarial skipped, then auto-merged. A line in a higher-precedence subsection for an issue that is also called out names its called-out ids too, so a call-out is never hidden.
- **Beep-boop prose.** `faff-beep-boop/SKILL.md` (around line 601) lists the new subsection beside the existing ones.
- **Graft prose.** Step 8 (`faff-graft/SKILL.md`): a classify row with `human_only` stays unticked with `Needs human verification: <reason>` and `{kind:"human"}`, and is never ticked by the builder; any other AC that cannot be auto-verified is not called out, so it blocks an unattended merge. Step 9b: the `faff pr open` description says it also writes `human-only-acs.json` from the captured spec.

**Slice 1: spec authors and docs.** One bullet is added to the DONE guidance of `faffter-noon-spec` and `faffter-dark-nlspec`: tag a done-item only a person can check with `needs-human: <reason>`, after any `[ac-N]` id; every other done-item must be machine-checkable. `evidence-documents.md` gains a row for `human-only-acs.json` (writer: `faff evidence write human-only-acs`, called by `faff pr open`) and a trust note that states the roster gap and cites FAFF-1478; `anchor-manifest.md` changes "twelve" to "thirteen" and gains the row; `logs.md` gains the `human-only-acs-stamp` row; the `verification/evidence/README.md` changelog gains an entry.

**Compatibility.** No checklist schema change, no `schema_version` bump, no migration. A PR anchored before slice 1 has no file, so it blocks as today, and `faff pr open` returns `already-open` for it without re-minting until the branch gets a new commit. A spec with no marker mints an empty set. The Action workflow and `action.yml` are unchanged.

**What an attacker can do (paired rewrite and its siblings).**

| Attack | Outcome |
|---|---|
| The lane adds `needs-human:` to the worktree spec and rewrites `spec-commit.json` to match | No effect. `faff pr open` derives from the main-checkout captured spec, never the worktree copy or `spec-commit.json`; the AC is not in the set and blocks. Graft Step 8's `spec verify` also reports a mismatch. |
| The lane deletes the file, or the captured spec is absent at mint | No skip; the run stalls as today. Safe. |
| A first mint succeeded, a later run's mint faults (after a new commit) | The mint removed both copies first, so the new anchor commit deletes the old file. No skip from a superseded mint. |
| The lane hand-edits the anchored file after mint to add an id or set `unattended`, with or without re-hashing the chain, and appends no newer stamp | The file no longer matches the latest stamp, so the reader returns no skip and the run stalls. Safe unless the lane also appends a newer stamp (next row). |
| The lane edits the file, appends its own newer `human-only-acs-stamp` through `faff events append` or the writer, and re-runs `faff events anchor` | Residual, and not stopped by the stamp: no history is rewritten, the chain stays valid and the CLI writes a matching witness. Same trust level as `passed:true`; closed only by FAFF-1478 and FAFF-517. The edit is visible as a changed `human-only-acs.json` path in the PR diff, and every skipped id is listed in the merge result, the merge record and the run summary afterwards. The Action runs on every head, so a new head sha is not a detection. |
| The lane pipes a well-formed document of its own choosing to `faff evidence write human-only-acs` | Residual, and the same trust level as writing `passed:true` through `faff evidence write ac-checklist`: the writer checks shape, not derivation. The stamp is valid because faff wrote it. Same list-it-afterwards visibility. FAFF-1478 adds the dispatcher digest check; FAFF-517 would stop the lane writing. |
| The lane rewrites the captured spec in the main checkout and the worktree spec in lockstep before `pr open` | Residual. The mint reads the rewritten capture. Nothing re-reads the tracker, because the CLI is tracker-agnostic. It shows as `needs-human:` on a machine-checkable AC in the PR's spec file, and the run summary lists the id afterwards. |

The residuals are the same class as the anchored `level` (FAFF-690) and the lane-authored `ac-checklist.json` (ADR-0077, ADR-0140), and the skip adds no power over them: a lane willing to forge can already write `passed:true` for any criterion, and the merge still needs review, CI and the holdout. What the design buys is that no prose edit and no checklist-field edit produces a skip, that a careless or injected edit of the anchored file fails the stamp check, and that every skip is listed for a person afterwards. The tamper-after-write gap for this file closes only with FAFF-1478 (dispatcher persist and digest check) and FAFF-517 (lane isolation).

**Failure modes.**

- **The failure:** the mint is skipped silently (captured spec missing, classify faults). **How you'd know:** a `faff pr open` warning, and a stalled run whose pending criterion is human with no skip. **What it means:** the safe direction; fix the capture, add a commit and re-run.
- **The failure:** a spec author tags a machine-checkable item `needs-human:`. **How you'd know:** the item appears in `ac_called_out` and the run summary after the merge. **What it means:** a review matter, since the tag is author-declared; narrow by spec review.
- **The failure:** the L3 config flag changes between mint and merge. **How you'd know:** the file's `unattended` disagrees with live config. **What it means:** the minted value governs by design; to re-mint, add a commit (`git commit --allow-empty`) and re-run `faff pr open`, because an unchanged head returns `already-open` before the mint.
- **The failure:** a file or stamp is present but the reader rejects it, so a legitimately minted run stalls. **How you'd know:** an unattended run stalls on a human-only criterion although `human-only-acs.json` is in the anchor. **What it means:** the safe direction; add a commit and re-run `faff pr open`, which replaces both file and stamp.
- **The failure:** the soak in slice 1 shows the stamp or manifest entry breaking real anchors. **How you'd know:** `faff events anchor` warns, or `faff evidence validate` fails an anchor. **What it means:** fix slice 1 before slice 2 starts; this is what the soak is for.

**Anti-pattern:** a `waived` or `called_out` field on the checklist criterion. Why: the builder writes the checklist, so the field would let it waive a machine-checkable AC.

**Anti-pattern:** reading the unattended fact from the PR-head config or a workflow input in the governance-check leg. Why: the PR head is builder-writable, and a second source of the fact lets the floors disagree.

**Anti-pattern:** a hash of the worktree spec compared with `spec-commit.json` as the trust root. Why: both files are lane-writable and agree by construction after a paired rewrite.

## 5. SLICES

| Slice | Ticket | Ships | Merge behaviour | Depends on |
|---|---|---|---|---|
| 1: marker and mint | FAFF-1476 (blocks FAFF-1475) | `needs-human:` parse and `human_only` on classify rows; `human-only-acs.json` schema, manifest entry, examples and compose; `faff evidence write human-only-acs` with the stamp; the `human-only-acs-stamp` event type; the governance reader and validator module and `readAnchoredBytes`; `events.js` copy list; the `pr open` mint with removal first; `resolveUnattended`; producer-skill DONE bullet; docs | none | none |
| 2: skip and surfacing | FAFF-1475 | `readAcFloor`; the five call sites; the stamp check in the reader; `ac_called_out` in the merge result and `merge-record.json`; run-summary section; graft and beep-boop prose | an unattended pending human-only criterion no longer blocks | slice 1 merged, and soaked in at least one real `faff pr open` anchor |
| 3: admission | FAFF-1477 (Low priority; blocked by FAFF-1475) | `admissibleVerdict` refuses an untagged DONE item matching a `HUMAN_JUDGEMENT` pattern list, and a spec whose every DONE item is `needs-human:` | admission of lights-out specs | slice 2 |

Scenario ownership: the first seven scenarios in section 6 (classify, mint, unreadable capture, re-run after a new commit, faulted-leftover, ac-checklist writer, byte-exact read) are slice 1's and FAFF-1476's; every scenario after them is slice 2's and FAFF-1475's, and its fixtures need slice 1's file and stamp.

## 6. SCENARIOS

```
Given a spec whose DONE item 2 reads "[ac-2] needs-human: Prices match the published pricing page" and whose other items are plain
When faff dod classify --json runs on it with --issue FAFF-9
Then the row for item 2 has human_only true, verification_tier delegated and ac_id faff-9#ac-2, and every other row has human_only false and an unchanged ac_id
```

```
Given a run at level L4 with a captured spec whose DONE item 2 is tagged needs-human:
And the worktree copy of the spec and spec-commit.json have been rewritten to tag a different, machine-checkable item
When faff pr open runs
Then the anchor directory carries human-only-acs.json with issue FAFF-9, level L4, unattended true and human_only ["faff-9#ac-2"] only
And the anchored events.jsonl contains a human-only-acs-stamp event for FAFF-9 that is the latest for that issue, whose sha256 equals the SHA-256 of the anchored human-only-acs.json
```

```
Given a run whose captured spec cannot be read
When faff pr open runs
Then it still opens the PR, its result carries a warning that human-only-acs.json was not minted, and the anchor directory has no such file
```

```
Given a first faff pr open committed an anchor directory holding human-only-acs.json
And the captured spec has since become unreadable and a new commit has been added, so the branch head differs from the open PR's head
When faff pr open runs again
Then the new anchor commit deletes human-only-acs.json from the anchor directory, the run dir has no such file, and the result carries a warning that it was not minted
```

```
Given a faulted mint left an untracked human-only-acs.json in the anchor destination and in the run dir
And no open PR has the current head, so faff pr open reaches the mint
When faff pr open runs and the new mint succeeds
Then the committed anchor file equals the newly written file byte for byte and the older content is gone
```

```
Given a checklist document with all_verified true and one criterion passed false
When faff evidence write ac-checklist runs on it
Then it exits 1 and writes no file
```

```
Given a committed anchor holding a human-only-acs.json that ends in a newline and an events.jsonl larger than 1 MiB that carries its stamp
When readAnchoredBytes reads each blob at the commit's head
Then each returned byte sequence equals the committed bytes exactly, and the SHA-256 of the file's bytes equals the sha256 of its stamp event
```

```
Given an anchored human-only-acs.json with level L4, unattended true and human_only ["faff-9#ac-2"], and a matching stamp in the anchored events.jsonl
And a checklist with one passed:true criterion and one passed:false criterion with ac_id faff-9#ac-2 and verifications [{kind:"human"}]
When faff merge-gate runs on the PR
Then the ACs blocker is absent, ac_called_out is ["faff-9#ac-2"], and the merge record carries ac_called_out ["faff-9#ac-2"]
```

```
Given the same checklist and an anchored file with level L2 and unattended false
When faff merge-gate runs
Then the verdict blocks with "ACs not all verified" and ac_called_out is []
```

```
Given an anchored file that says level L4 and unattended true, but an anchored run-ledger.json that says level L2
When the already-merged reconcile runs for the PR, and separately when faff merge-gate --local runs on the same fixture
Then both refuse with "ACs not all verified" and ac_called_out is []
```

```
Given an anchored human-only-acs.json that was edited after mint to add faff-9#ac-3, so its SHA-256 no longer equals the latest stamp
And a pending criterion faff-9#ac-3 with verifications [{kind:"human"}]
When faff merge-gate runs
Then the verdict blocks with "ACs not all verified" and ac_called_out is []
```

```
Given an anchored human-only-acs.json with no human-only-acs-stamp event in the anchored events.jsonl
When faff merge-gate runs on a checklist that would otherwise be skipped
Then the verdict blocks with "ACs not all verified"
```

```
Given an L3 run whose configuration declared it unattended when faff pr open minted the file, so the file says level L3 and unattended true
When faff merge-gate and faff governance-check --anchor-dir both run on the same head
Then both pass the AC leg and both report ac_called_out ["faff-9#ac-2"]
```

```
Given an L3 run whose configuration did not declare it unattended at mint, so the file says unattended false
When faff merge-gate and faff governance-check --anchor-dir both run on the same head
Then both block with an AC failure
```

```
Given an anchor directory with the file and its stamp and no --unattended flag or workflow input
When faff governance-check --anchor-dir runs
Then the merge_floor leg passes and its result lists ac_called_out
And with the file deleted from the directory the leg fails with the governance leg's own reason "ac-checklist.json missing/incomplete", while faff merge-gate on the same condition reports "ACs not all verified"
```

```
Given an unattended L4 anchored file listing faff-9#ac-2 and a pending criterion faff-9#ac-3 that is a machine-checkable item not in human_only
When faff merge-gate runs
Then the verdict blocks with "ACs not all verified"
```

```
Given a ledger shipped issue whose merge-record.json carries ac_called_out ["faff-9#ac-2"]
When faff run-summary renders
Then the output has the section "Shipped (human-only ACs called out)" listing faff-9#ac-2, and the issue is absent from "Shipped (auto-merged)"
```

- The merge floor MUST NOT read the unattended fact from any file other than the anchored human-only-acs.json.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

Open Questions: none. The wiring questions are resolved in the verified-facts table in section 3.

Assumes: none. "Slice 2 after a soaked slice 1" is a sequencing rule, not an outside assumption.

## 8. DONE

### Slice 1 (tracked under FAFF-1476, not this ticket's DONE)

These items are the acceptance list for FAFF-1476. They stay here as the design record. Slice 1 may merge alone because it changes no merge behaviour.

#### From WHY and WHAT
- [ ] `faff dod classify --json` returns `human_only: true` for a `needs-human:` DONE item with a non-empty reason and `human_only: false` for every other row; a human-only row has tier `delegated` and verifier `ac-checklist`, and the other rows' `id` and `ac_id` values are unchanged
- [ ] `needs-human:` with an empty reason leaves the item literal and writes a stderr advisory
- [ ] `human-only-acs.schema.json`, one valid and one invalid example, and a manifest entry for `human-only-acs.json` (versioned by field) exist under `verification/evidence/v0.3/`, and `node scripts/evidence-v0.3-compose.mjs --check` exits 0
- [ ] The `human-only-acs-stamp` event type has a delivery-profile entry (event type and issue-scoped), a per-type schema, a composed `run-event.schema.json` entry, a valid and an invalid example, and a `logs.md` row, and the files that name `evidence-terminal-only` (`scripts/evidence-v0.3-compose.mjs`, `test/evidence-payload-coverage.test.mjs`, `test/faff-1353-write-core-issue-scoped.test.mjs`) cover the new type
- [ ] `faff evidence write human-only-acs` writes the file with `schema_version` 1, appends one `human-only-acs-stamp` event whose `data.sha256` equals the SHA-256 of the written bytes, and refuses, exiting 1 and writing nothing, an issue mismatch, an L1 or L2 document with `unattended` true, an L4 document with `unattended` false, a duplicate id, and an id naming another ticket
- [ ] When the stamp append fails, or the run dir has no `events.jsonl`, the writer deletes any file it wrote, exits 2 and leaves no file behind
- [ ] `events.js` lists `human-only-acs.json` in `optionalFloorFiles`, and an anchor minted from a run dir holding the file carries it byte-identical, and carries the stamp in the copied `events.jsonl`
- [ ] `human-only-acs.ts`, in the governance region, exports the reader of section 4, taking the file and events as bytes, and returns `null` for each failure it lists (unparseable JSON, wrong `schema_version`, issue mismatch, level mismatch, a violated level constraint, a malformed or foreign id, a missing stamp, a mismatched stamp); nothing in the floors calls it until slice 2

#### From HOW (mint)
- [ ] `faff pr open` mints the file from the main-checkout captured spec after step 9 and before the anchor step, through a new `mainCheckout` dependency wrapping `mainWorktreeRoot`; it takes no spec-path flag and reads config from the main checkout; a re-run with an unchanged head and a tracked anchor returns `already-open` and runs none of the removal, mint or stamp, while a re-run after a new commit re-mints
- [ ] `readAnchoredBytes` in `merge-gate-floor.js` returns the exact committed bytes (no trim, `maxBuffer` 64 MiB), falls back to an untrimmed Contents API decode, returns null without inline content, leaves `gitRun` and `resolveAnchorLevel` unchanged, and is not called by the floors until slice 2
- [ ] Before every mint, `faff pr open` runs `git rm -f --ignore-unmatch` on `<dest>human-only-acs.json` and deletes the run-dir copy and any untracked destination copy through a new `removeStale` dependency (not the existing `removeFile`, which removes only the safe-body temp directory)
- [ ] On any mint fault, including a null main checkout, an unreadable captured spec, a classify failure, an unreadable level and a writer failure, `faff pr open` warns, leaves neither copy in place, and still proceeds
- [ ] `resolveIntegrity` and the mint both call `resolveUnattended`
- [ ] With slice 1 only, `faff merge-gate` and `faff governance-check` results for a fixture anchored with and without the file are identical

#### From HOW (docs and producer skills)
- [ ] `evidence-documents.md` carries a `human-only-acs.json` row and a trust note that names the roster gap and FAFF-1478, in `verification/evidence/v0.3/` and in the regenerated plugin mirror; `anchor-manifest.md` says thirteen files and lists the new row
- [ ] `faffter-noon-spec` and `faffter-dark-nlspec` each carry the one-bullet marker guidance in their DONE section

#### From HOW (tests, in their own items)
- [ ] New tests in `test/` (not `--selftest`) cover every slice 1 scenario and run under `node --test`, in `test/faff-1475-human-only-acs.test.mjs`
- [ ] A reader unit test passes for a fixture file ending in a newline and a committed `events.jsonl` larger than 1 MiB: the SHA-256 of the bytes `readAnchoredBytes` returns equals the SHA-256 of the committed file, and a stubbed Contents API response decodes to the same bytes
- [ ] The manifest-count cases move out of the `evidence.js` selftest (line 1579) into `test/evidence-v0.3.test.mjs` (lines 50 and 79) and expect thirteen entries
- [ ] Each new or edited TypeScript module (`human-only-acs.ts`, `pr-open.ts`) has its committed `.js` emit and `build-manifest.json` regenerated, and `faff regions check` and `lint-cli-coverage` pass

### Slice 2 (FAFF-1475's DONE)

Slice 2 is not built until slice 1 is merged and has minted `human-only-acs.json` and its stamp in at least one real `faff pr open` anchor. Its items depend on slice 1's reader module and event type being on `main`.

#### From HOW (merge floor)
- [ ] The soak is evidenced before the floor change merges: this PR's description cites one merged PR whose anchor carries `human-only-acs.json` and a matching `human-only-acs-stamp` event, by PR number
- [ ] With an unattended anchored file whose stamp matches, every pending criterion in `human_only` with human-only verifications, and at least one passed criterion, no AC blocker fires, `ac_called_out` lists the pending ids, and `merge-record.json` carries them
- [ ] With the file absent, `unattended` false, the reader returning null, a missing or mismatched stamp, an anchored level that disagrees with the file, or the level at L1 or L2, the AC blocker fires exactly as today and `ac_called_out` is `[]`
- [ ] A pending criterion outside `human_only`, without an `ac_id`, with a non-human verification, or with no passed criterion in the checklist keeps the AC blocker
- [ ] merge-gate, `merge-gate --local`, the already-merged reconcile and the governance-check anchor leg all decide through `readAcFloor`, and they agree for an L3 run declared unattended at mint and for one that was not; the `--local` case is covered on fixtures only
- [ ] The governance-check live-run-dir leg passes no `humanOnly` and blocks as today
- [ ] Every merge-gate result that evaluates the AC leg carries `ac_called_out` as an array
- [ ] The governance-check leg's failure text stays "ac-checklist.json missing/incomplete" and the merge-gate legs' stays "ACs not all verified"

#### From HOW (surfacing)
- [ ] `run-summary` renders `## Shipped (human-only ACs called out)` from `merge-record.json`, applies the stated precedence, and names called-out ids in any higher-precedence line for the same issue
- [ ] The governance-check text output names called-out ids when the leg passes by skip
- [ ] Graft Step 8, graft Step 9b and beep-boop's shipped-subsection list describe the rule, and `faff validate-adapters` and the prose-size ratchet pass
- [ ] If any graft or beep-boop sentence is deleted rather than reworded, this spec's PR carries a `## Rule inventory` with a row per deleted rule and `faff rule-inventory check` passes

#### From HOW (files that must not change or must stay in step)
- [ ] `ac-checklist.schema.json` is byte-identical to before and `action.yml` has no new input
- [ ] `holdout-record.js` and `contract-defs-registry.js` are unchanged

#### From HOW (tests, in their own items)
- [ ] New tests in `test/` (not `--selftest`) cover every slice 2 scenario and run under `node --test`: `test/faff-1475-ac-floor.test.mjs` and `test/faff-1475-surfacing.test.mjs`
- [ ] The existing tests at `test/merge-gate-local.test.mjs:166` and `test/merge-gate-controlflow.test.mjs:277` still pass unmodified
- [ ] Each new or edited TypeScript module (`run-summary.ts`, and `human-only-acs.ts` if slice 2 touches it) has its committed `.js` emit and `build-manifest.json` regenerated, and `faff regions check` and `lint-cli-coverage` pass

### Slice 3 (FAFF-1477)

Its Definition of Done is written when FAFF-1477 is prepared; it is blocked by FAFF-1475.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. write a captured spec with two DONE items, item 2 tagged needs-human:, plus one scenario
  2. write a checklist through faff evidence write: item 1 passed, item 2 unticked with a human method
  3. run faff pr open on an L4 run; expect human-only-acs.json in the anchor with human_only [item 2 id], unattended true, and a matching stamp in the anchored events.jsonl
  4. run faff merge-gate on that PR; expect no AC blocker and ac_called_out = [item 2 id]
  5. edit the anchored file by one id without touching the events; expect the AC blocker (file-only edit)
  6. make the captured spec unreadable and re-run faff pr open with no new commit; expect already-open and an unchanged anchor, then add an empty commit and re-run; expect the anchor to lose human-only-acs.json
```

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (human, after round 3)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery (issue-critique, FAFF-1475, revised spec r3)

**Edges checked in Linear (read-only, relations included).** All five stated edges are in place.

- FAFF-1476 blocks FAFF-1475. FAFF-1475 lists it as its only blocker.
- FAFF-1475 blocks FAFF-1477, FAFF-1478 and FAFF-1339, and each of those lists FAFF-1475 as its only blocker.
- FAFF-1476 has no blockers.
- All five issues are in Backlog, with no project, parent or milestone.
- Priorities at the time of the check: FAFF-1475 and FAFF-1476 are High, FAFF-1478 is Medium, FAFF-1477 is Low, and FAFF-1339 has none. FAFF-1478 was raised to High afterwards, on purpose.

**Earlier points**

| Earlier point | Status |
|---|---|
| Split decision | Resolved. Three tickets exist, and FAFF-1475's DONE is slice 2 only. |
| Edges | Resolved. The chain is 1476 -> 1475 -> {1477, 1478, 1339}, with no cycle and no cross-links. |
| Trust root | Resolved as a statement, open as a risk. The weaker trust is stated plainly and tracked as FAFF-1478. It is not closed (see Risk profile). |
| B-with-C pairing | Resolved. The skip and its surfacing stay in one ticket, and slice 3 is the separable half. |
| Soak | Was prose only. Now a checkable slice 2 DONE item. |

### Right-sized

- **What's there.** FAFF-1475 (slice 2) bundles the new `readAcFloor`, five call sites, the merge-record and merge-result fields, the run-summary section with its precedence rule, governance-check text output, graft and beep-boop prose with a possible rule inventory, and three test files covering about 12 scenarios. FAFF-1476 (slice 1) is the larger of the two by item count, at about 16 DONE items. It spans both regions, a new event type with schema, examples, composed schema and `logs.md` row, a classifier change, the `pr open` mint with its removal step, two producer skills and the docs.
- **Why it matters.** Both tickets are probably above the 1 to 3 day unit. The slice 2 bundle is justified, because the skip must not ship without its call-out. Slice 1 has no such constraint, so a failure inside it blocks the whole chain.
- **What to do.** Keep slice 2 as one ticket. In its DONE order, put the surfacing items before the floor change, so the commit that enables the skip lands last. Consider splitting FAFF-1476 along a seam the spec already draws: the pure parse (the classifier row plus the two producer-skill bullets) can merge alone, and the mint half is where the new-file risk sits. This is optional if the build agent handles the whole slice in one pass.

### Workstream fit

- **What's there.** The five issues are one outcome: an unattended run no longer stalls on a human-only AC, with a trust follow-up and an admission follow-up. They all sit project-less in Backlog, which matches the default landing rule. FAFF-1339 is unrelated in outcome and shares only the `readAcFloor` code path. It has no priority and no labels.
- **Why it matters.** Not a fault today. If a grouping pass later proposes a project for the loose cluster, the outcome is "unattended runs merge without stalling on human-only criteria", and FAFF-1339 should stay out of it.
- **What to do.** No action now. When FAFF-1339 is next groomed, give it a priority.

### Deps surfaced

- **What's there.** The tracker edges are complete and honest. Two load-bearing dependencies were still prose: the soak (merged is not soaked, so FAFF-1475 becomes pickable the moment slice 1 merges) and the document dependency (FAFF-1476 is prepped from a spec attached to FAFF-1475, which FAFF-1476 blocks).
- **Why it matters.** Automation routes on the blocker graph, and a rule that exists only in prose will be missed by a beep-boop pass.
- **What to do.** Done in this revision: slice 2's DONE now opens with a checkable soak item (a merged PR number whose anchor carries the file and a matching stamp), slice 1's DONE has a reader item, and FAFF-1476's description points at revision 3 and asks for a linked real anchor after it merges.

### Risk profile

- **What's there.** The highest-uncertainty work, the first real anchors carrying a new file, a new manifest entry and a new event type, is front-loaded into slice 1 and soaked before the skip depends on it. That is the right order. One risk is not de-risked: once FAFF-1475 merges, unattended runs can skip a human-only AC on a trust root the spec calls weaker than the checklist's on the tamper-after-write axis. FAFF-1478 closes that gap and is the ticket that ripples through the exact-shape `EvidenceReturn` contract, so it is the most uncertain remaining piece.
- **Why it matters.** The skip goes live at L4 before the roster gap is closed. The exposure window was open-ended while FAFF-1478 sat at Medium with no ordering commitment.
- **What to do.** Done: FAFF-1478 is High on purpose and lists the contract sites it must change. For FAFF-1477, keep the pattern list narrow at first and test it against a sample of existing admitted specs before it refuses anything.