# FAFF-1406: faff prep attach and collate-evidence --from-judge: move prep's stamp, marker and judge dispositions from prose into commands

> Spec: faffter-dark-nlspec · 2026-10-28 · interactive · claude-code/unknown · faff 0.43.0 · confidence: high. Full spec on Linear FAFF-1406.

This spec is for the build agent that implements FAFF-1406 and for the humans who review it. It is the prep half of the FAFF-1404 split: FAFF-1404 shipped the graft half (`faff spec commit`, `faff spec verify`) as PR #1152. This half turns two pieces of `faff-prep/SKILL.md` prose into commands: the stamp, tier, marker and validation ritual that runs at every attach, and the evidence dispositions prep builds by hand on the judge path. It follows the third action in `verification/audits/2026-10-22-repo-review-throughput-cull-split.md` §1.4.

**Amended after review (2026-10-28).** After spec-review round 3, the operator ruled that new commands carry no `--selftest` blocks and are tested only under `test/`. Sections 3, 4.3, the DONE list and the methodology critique were amended to match. The review rounds did not see that edit.

## 1. WHY

**The model this spec turns on:** a command can guarantee an ordering and a byte-exact record, and prose cannot. Both defects below happened because an agent was told, in prose, to perform a deterministic step by hand: write a marker before rendering, and translate one closed vocabulary into another. Each command does that step itself and prints a typed token. The agent keeps only what needs judgement or a tracker call, because the CLI cannot reach the tracker.

**Problem.** Prep's attach ritual is about 50 lines of `faff-prep/SKILL.md` (the provenance stamp, build-tier and attach-state marker sections), and attach has silently failed twice. Prep also tells the agent to pass a judge outcome as a disposition, which `collate-evidence` rejects (logged in run `run-20261020-191739-beepboop-list-d57076`). This change moves both steps into commands, starts writing the `spec_sha256` field that graft's shipped `source_check` already reads, and lowers the `faff-prep` line baseline.

### Design principles

**The CLI never touches the tracker.** Every tracker write stays an agent MCP call. The command renders the body to a file, and a second call records that the agent's post succeeded. This is the existing `faff label` and `faff landing-comment` pattern.

**The typed token is the signal.** As in `faff land` and `faff spec commit`, each call prints one token from a closed set and the skill routes on it. Where judgement is still needed the token is `needs-judgement` with a reason. The command never makes an LLM call.

**The marker is written first.** Once stage has read a spec, it writes the open marker before any step that can fail, so `prepcheck --hook` always has something to catch. An unreadable spec writes no marker, because there is nothing to attach.

**No decision kernel is consulted.** Neither command calls `next`, `eligible`, `run-done` or `queue-state`.

### Reference context

All `bin/lib` paths are under `plugin/skills/faff/`. Line numbers are against `origin/main` at `8f35ba88`.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-prep/SKILL.md` lines 57 to 109, 322, 357, 484, 624, 648 | Markdown | Prose replaced or rewritten |
| `bin/lib/spec-commit.js` (FAFF-1404, #1152) | JavaScript | Shape precedent; `sourceCheck` reads `.faff/prep/<ISSUE>.json` `spec_sha256` and today always reports `no-marker` |
| `bin/lib/land.js`, `test/land.test.mjs`, `test/spec-commit.test.mjs` | JavaScript | Flag spec, pure core, injectable deps, typed tokens |
| `bin/lib/prepcheck.js` | JavaScript | `isPrepMarkerOpen`, `classifyPrepIssue`, `readParkCause` read the marker |
| `bin/lib/park-reconsider.js` | JavaScript | `apply_git_only_unpark` clears `disposition` and the `park` sub-object |
| `bin/lib/tier.js` | JavaScript | `extractSpecFeatures`, `tier`, `DEFAULT_PREP_PARAMS` |
| `bin/lib/harness.js` | JavaScript | `harnessIdentify` |
| `bin/lib/faff-version.js` (governance) | JavaScript | `resolveFaffVersion` |
| `bin/lib/contract-defs-review.js` | JavaScript | `computeSpecReadiness`, `SPEC_JUDGE_OUTCOMES` |
| `bin/lib/evidence-collate.js` (governance) | JavaScript | `collateSpecReviewRounds`, `applyDispositions`, `renderSpecReviewComment` |
| `bin/lib/spec-review.js` | JavaScript | `cmdCollateEvidence`, `SPEC_REVIEW_SPEC`, `SPEC_REVIEW_USAGE` |
| `bin/lib/spec-judge-evidence.js`, `bin/lib/spec-judge-casefile.js` | JavaScript | `readStandingResidue` (not exported), `correctionApplied`, ledger shape |
| `bin/lib/validate-adapters.js` line 65 | JavaScript | `SKILL_LINE_BASELINE["faff-prep"]` is 688 |

**Scope.** The fourth prose-to-command collapse in the §1.4 sequence, after `faff land` and FAFF-1404's graft half. It covers the prep attach seam and the judge-path evidence seam, and nothing else in `faff-prep`.

### Already shipped against this surface

- **FAFF-1404** (Done, #1152, `b7883697`): `faff spec commit` records `source_check` from the marker's `spec_sha256`. Nothing writes that field yet, so every build records `no-marker`. This ticket is the writer.
- **FAFF-1395** (Done): the `faff <version>` stamp segment and the marker's `faff_version` field, which this command now writes.
- **FAFF-1267** (Done): `collate-evidence` and its `--dispositions` validator, which `--from-judge` feeds.
- **FAFF-1271** (Done): `spec-review carry-check` ignores the stamp and `build-tier:` lines, so a re-stage on a stale refresh still carries.

## 2. OUT OF SCOPE

- **Mechanical dispositions for the refuter-approve and human-accept paths.** FAFF-1409 owns it. *Extension point:* a sibling mode in `bin/lib/judge-dispositions.js`, registered on the same `collate-evidence` verb.
- **A spec length preflight against the tracker's comment cap.** FAFF-1349 owns it. *Extension point:* the stage procedure in `bin/lib/prep-attach.js`, after step 7. Record that as a tracker edge too: FAFF-1349 blocked by FAFF-1406, so its preflight is planned against a stage procedure that exists.
- **Making graft's `source_check` blocking.** FAFF-1407 owns it; this ticket only supplies the digest. FAFF-1407 must not land first, because the field it would block on has no writer until this ticket lands. Record that as a tracker edge: FAFF-1407 blocked by FAFF-1406.
- **Detecting a content edit between `--admit` and `--from-judge`.** `spec-judge-evidence --admit` would have to persist the digest of the spec it judged. *Extension point:* `cmdAdmit` in `spec-judge-evidence.js`, plus a comparison in `judge-dispositions.js`. File it as a Backlog ticket.
- **Authoring the git-only `park` ParkCause sub-object.** It stays with the park protocol (`references/park.md`). `--park` preserves one if present and never writes one.
- **`faff hooks-ensure` registration.** It stays in prep prose.
- **The kernel's stamp format line** (`references/kernel.md` line 454). Unchanged; the command implements it.
- **The graft side.** Shipped in FAFF-1404.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Attach marker | `.faff/prep/<ISSUE>.json` in the main checkout. `prepcheck --hook` blocks session end while it is open: `spec_produced` true, `attached` not true, and no `disposition: "parked"`. |
| Stamp | The `> Spec: …` blockquote directly under the spec's H1. |
| Stage | The first `prep attach` call: marker, stamp, tier, validation, and either a body to post or the git-only write. |
| Confirm | The second call, after the agent's tracker post succeeded. It closes the marker. |
| Standing residue | The objections in the latest round file at or after the judge's `window_start`. The judge's propositions `p-01…p-NN` are these objections, in order. |

### Commands

```
faff prep attach --issue ID --spec FILE --mode interactive|autonomous
                 [--git-only] [--gate-history N] [--extraction FILE] [--root DIR] [--json]
faff prep attach --issue ID --confirm --comment-id ID [--root DIR] [--json]
faff prep attach --issue ID --park [--root DIR] [--json]

faff spec-review collate-evidence --dir SCRATCH --from-judge --spec FILE
                 [--judge-dir DIR] [--comment]
```

**Chosen:** one new `COMMANDS` key, `prep`, with the verb `attach`, plus a flag on the existing `spec-review collate-evidence` verb. The issue fixes the first name. A flag on `collate-evidence` keeps one evidence renderer and one digest line.

`--root` defaults to the repo root `findRoot()` resolves, as other commands do. `--confirm`, `--park` and `--spec` are mutually exclusive; exactly one is required. `--issue` must match `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` (the `ISSUE_RE` `spec-commit.js` uses) or the call exits 2 before any path is built, so neither the marker nor the git-only store can be written outside `.faff/`.

### Types

```
RECORD AttachMarker:                       # .faff/prep/<ISSUE>.json; schema-less, additive
  issue: String
  spec_produced: true
  attached: Bool                           # false at stage; true only via --confirm or the git-only write
  mode: "tracker" | "git-only"
  ts: ISO-8601                             # stage time
  owner: { session_id?, run_dir?, pid }    # FAFF_SESSION_ID / FAFF_RUN_DIR / process.pid; unset ones omitted
  harness: String
  model: String
  faff_version: String                     # "unknown" when unresolved
  spec_sha256: Hex64                       # NEW: sha256 of the stamped bytes staged for posting
  body_path: AbsolutePath                  # NEW: the staged file confirm re-hashes
  comment_id?: String                      # NEW: set by --confirm
  attached_at?: ISO-8601                   # NEW: set by --confirm or the git-only write
  disposition?: "parked"                   # set by --park
  park?: ParkCause                         # preserved, never written, by this command

RECORD AttachResult:                       # stdout (--json) for every prep attach call
  issue: String
  token: "ready-to-post" | "attached" | "invalid" | "needs-judgement" | "parked" | "errored"
  reason?: String                          # e.g. "no-readiness-block", "no-h1", "git-only-marker-parked"
  violations?: List<String>                # from computeSpecReadiness, on "invalid"
  body_path?: Path                         # on "ready-to-post": the stamped spec to post byte for byte
  spec_sha256?: Hex64
  confidence?: "high" | "medium" | "low" | "unknown"
  build_tier?: "mechanical" | "standard" | "complex"
```

**Chosen:** `faff land`'s exit convention, as `faff spec commit` uses: every typed token exits 0, `errored` exits 2, and usage errors exit 2 through `usageError`. Prep routes on the token, never the exit code.

### Token routing (what the skill does)

| Token | Skill action |
|---|---|
| `ready-to-post` | Post `body_path`'s content byte for byte with `save_comment`, then call `--confirm --comment-id <returned id>` |
| `attached` | Continue to the spec-review gate |
| `invalid` | Interactive: add the missing markers and stage again. Autonomous: `--park`, then the park protocol |
| `needs-judgement:no-readiness-block` | Read the markers and confidence from the prose into extraction JSON (the absent-block fallback), then stage again with `--extraction` |
| `needs-judgement:git-only-marker-parked` | Run the git-only Unpark contract first; never strip the park by hand |
| `parked` | Park protocol |
| `errored`, or any exit with no parseable token | Interactive: surface the reason. Autonomous: if a marker exists, `--park` then the park protocol; if none exists (an unreadable spec, or install skew), log the reason to the prep log and return `errored` to the caller, which already treats it as a park for the run |

**Chosen:** a call that prints no parseable token (for example an older CLI that answers `unknown subcommand`) routes as `errored`. The skill and the CLI can be out of step for one install, and that case must fail loud rather than skip the marker.

## 4. HOW

### 4.1 `faff prep attach`

**Summary:** stage writes the marker first, stamps and validates the spec, and either hands back a body to post or (git-only) writes the store and closes the marker. Confirm closes the marker after the agent's post succeeded.

```
PROCEDURE stage(issue, spec_path, mode, git_only, gate_history, extraction_path):
  1. Read spec_path. Unreadable → errored, no marker written.
  2. existing := the current marker, if any.
     IF git_only AND existing.disposition == "parked" → needs-judgement,
        reason "git-only-marker-parked"; write nothing; stop.
  3. Write AttachMarker { issue, spec_produced:true, attached:false,
     mode: git_only ? "git-only" : "tracker", ts, owner, harness, model, faff_version }
     before any later step, replacing any existing marker, so a later failure still
     leaves an open marker for prepcheck.
  4. Find the H1: the first line starting "# " outside a fence. None → invalid, reason "no-h1".
  5. Build the stamp:
       producer   := config slots.spec (registry default applied)
       date       := today, YYYY-MM-DD
       id         := harnessIdentify()             -> "<harness>/<model>"
       version    := resolveFaffVersion().version  -> "faff <version>"
       confidence := token of the last standalone "confidence:" line outside fences when it is
                     exactly high, medium or low (case-insensitive, lowercased); anything else,
                     or no such line, → "unknown". No other text from the line enters the stamp
       tail       := git_only ? "" : " Full spec on <TrackerName> <issue>."
       line       := "> Spec: <producer> · <date> · <mode> · <id> · faff <version> · confidence: <confidence>.<tail>"
     IF the first non-blank line after the H1 starts with "> Spec:" → replace that line.
     ELSE insert a blank line and the stamp line directly under the H1.
  6. Remove every "build-tier:" line outside fences, then insert one "build-tier:" line on
     the line after the standalone confidence line (no confidence line: on the line after
     the stamp). Compute the tier with extractSpecFeatures + tier(DEFAULT_PREP_PARAMS) over
     that text, setting gate_history when given, and write the value into the line. The
     value never changes any feature (line count, DONE items, scenarios, confidence), so
     `faff tier` on the written-back file prints the same value.
  7. Readiness extraction:
       IF extraction_path given → parse it as { confidence, decisions }; unparseable → errored
       ELSE count "faff-contract:spec-readiness" fences:
         0  → write the stamped spec back; token needs-judgement, reason "no-readiness-block"; stop
         >1 or the one body does not JSON.parse → errored
     provenance_present := the stamped text has a line matching ^> Spec:
     result := computeSpecReadiness({ ...extraction, provenance_present })
       fail-loud  → errored
       violations → write the stamped spec back; token invalid with violations; stop
  8. Write the stamped spec back to spec_path. spec_sha256 := sha256(stamped bytes).
     Record spec_sha256 and body_path (spec_path made absolute) on the marker.
  9. IF git_only: write the stamped bytes to <root>/.faff/specs/<issue>.md (create the
     directory if missing), then set attached:true and attached_at → token attached.
     ELSE → token ready-to-post, body_path = spec_path.

PROCEDURE confirm(issue, comment_id):
  1. Read the marker. Missing, unparseable, or spec_produced != true → errored, reason "no-staged-spec".
  2. Read body_path and hash it. Unreadable, or sha256 != spec_sha256 → errored,
     reason "spec-changed-since-stage"; the marker stays open. Stage again, post the new
     body, and confirm again.
  3. Set attached:true, comment_id, attached_at. Keep every other field. → token attached.

PROCEDURE park(issue):
  1. Read the marker. Missing, unparseable, or spec_produced != true → errored, reason "no-staged-spec".
     Park never writes a marker that claims a spec was produced.
  2. Set disposition:"parked", keeping every other field, including any park sub-object. → token parked.
```

- **TrackerName** comes from config `tracking.tracker`: `linear`→`Linear`, `github`→`GitHub`, `jira`→`Jira`, otherwise the raw value with its first letter capitalized.
- **Atomic writes.** Every marker and store write goes to a temp file in the same directory and is renamed into place, as `spec-review-pin.js`'s `atomicWriteJSON` does, so prepcheck never reads a half-written marker.
- **Every post is staged.** Any edit to the spec after a stage (a revise round, the retained `spec-review:` line, the methodology critique, a refresh) is followed by a fresh stage and confirm before the next post. Stage is idempotent apart from `date`, `ts` and the version: the stamp and tier lines are replaced, never duplicated.

**Chosen:** split attach into stage and confirm, with confirm requiring the `--comment-id` that `save_comment` returned and re-hashing the staged `body_path` against `spec_sha256`. The CLI cannot see the post, so the marker flips only after the agent reports one. The re-hash makes "the posted file is the staged file" a check rather than a rule: an edit after stage leaves the marker open. The CLI cannot prove the post happened, and it does not need to for safety: the id is recorded for audit, and a spec that never reached the tracker is found by graft's Step 2 spec discovery, which routes the issue back to prep.

**Chosen:** the git-only path writes `.faff/specs/<issue>.md` and closes the marker within the stage call. No tracker call is involved, so there is nothing to confirm.

**Chosen:** with no readiness block, return `needs-judgement:no-readiness-block` and re-enter through `--extraction`. Reading markers from prose is the one LLM seam left in this ritual, and the token makes it explicit instead of a hidden model call.

**Chosen:** in git-only mode, stage refuses a marker that carries `disposition: "parked"`. There the marker is the park record, and the kernel's git-only Unpark contract forbids a bare disposition strip that leaves a run-ledger outcome reading `parked`. In tracker mode the label is the park record, so stage replaces the marker as today's prose does.

**Chosen:** call `harnessIdentify`, `resolveFaffVersion`, `extractSpecFeatures` with `tier`, and `computeSpecReadiness` in-process rather than shelling out to `faff harness identify`, `faff version`, `faff tier` and `faff contract`. All four are exports of factory or governance modules, which a factory module may require, and shelling out would add four process spawns and four output parses.

**Assumes:** FAFF-1404 has merged, so `bin/lib/spec-commit.js` reads `marker.spec_sha256` in `sourceCheck`. It merged as `b7883697` (#1152) on 2026-10-27. *Check:* `git grep -n spec_sha256 origin/main -- plugin/skills/faff/bin/lib/spec-commit.js` shows the read. If it does not, stop and report the contradiction.

**Anti-pattern:** writing the marker after validation. Why: a validation failure or crash would leave no open marker, which brings back the silent non-attach the marker exists to catch.

**Anti-pattern:** the skill posting a copy of the spec it holds in context instead of `body_path`. Why: the posted bytes would differ from `spec_sha256`, which is what graft's `source_check` compares.

### 4.2 `collate-evidence --from-judge`

**Summary:** build the dispositions from the judge's own files, so prep never types a disposition value on the judge path.

The proposition-to-objection mapping is mechanical only for the latest round. `window_start` is a round number, not an objection index: `readStandingResidue` keeps the round files numbered `window_start` or higher and returns the whole objection list of the highest-numbered one. `spec-judge-evidence --assemble` builds `p-(i+1)` from the i-th entry of that list (zero-based), and `collateSpecReviewRounds` keys the same objection `<n>#<i>` with the same zero-based index over the same file. The ledger keeps `window_start` but not the objection key, so the key is derived as `<n>#<i>`. Objections from earlier rounds were never judged and have no ruling.

| Judge state for the key | Disposition | `disposition_rationale` |
|---|---|---|
| Ledger entry `resolution: "parked"` | `open` | omitted |
| `AFFIRM_SPEC` | `refuted` | ruling `rationale` |
| `UPHOLD_REVIEW` or `SYNTHESIZE`, `correctionApplied` true | `fixed` | ruling `correction.summary` |
| `UPHOLD_REVIEW` or `SYNTHESIZE`, `correctionApplied` false | `open` | ruling `rationale` |
| `PRD_BOUNDARY` | `open` | ruling `rationale` |
| Key from an earlier round (no proposition) | `open` | omitted |

An empty or non-string rationale is omitted, never written as `""`.

```
PROCEDURE from_judge(dir, judge_dir, spec_path):
  1. collated := collateSpecReviewRounds(dir, secrets)        # unchanged, all rounds
  2. ledger := read judge_dir/ledger.json; unreadable, or no order[] / entries{} → exit 2
  3. residue := readStandingResidue(dir, ledger.window_start), extended to also return
     the latest in-window round's number n (existing callers ignore the new field)
     residue unreadable or malformed → exit 2
     residue length != ledger.order length → exit 1 "ledger and round <n> disagree"
  4. spec_text := read spec_path; unreadable → exit 2
  5. FOR i, pid IN ledger.order:
       entry := ledger.entries[pid]; key := "<n>#<i>"; item := collated objection with that key
       entry missing, item missing, item.lens != entry.lens, or item.severity != entry.severity → exit 1
       IF entry.resolution == "parked" → open
       ELSE ruling := read judge_dir/ruling-<pid>.json; missing or malformed → exit 2
            ruling.outcome not in SPEC_JUDGE_OUTCOMES → exit 1
            map per the table, using correctionApplied(entry, ruling, spec_text)
  6. Every other collated key → open
  7. record := applyDispositions(collated.record, built list, secrets)   # the --dispositions validator
  8. Print the record JSON, or renderSpecReviewComment(record, collated.rounds) with --comment
```

- `--from-judge` together with `--dispositions` is a usage error (exit 2), as is `--from-judge` without `--spec`.
- `--judge-dir` defaults to `<dir>/judge`, matching `spec-judge-evidence --out`.
- Export `readStandingResidue` from `spec-judge-evidence.js` rather than copying it, so the mapping can never read a different round from the one `--assemble` used.
- `SPEC_REVIEW_SPEC` gains `--from-judge` (arity 0), `--spec` and `--judge-dir` (arity 1); `SPEC_REVIEW_USAGE` gains the same.

**Chosen:** the dispositions in the table. `fixed` requires the same `correctionApplied` test `admitRollup` uses, so on the same spec file the evidence comment cannot call a proposition fixed when admission called it unresolved. `PRD_BOUNDARY` and an unapplied correction stay `open`, because admission treats both as unresolved.

**Chosen:** `--spec` is the spec file passed to `spec-judge-evidence --admit`, and prep runs `--from-judge` at the same terminal seam, before any edit except a re-stage. A re-stage cannot change a `correctionApplied` result. The test needs the verification literal present now and absent from the ledger's `pre_ruling_spec_content`; the stamp and `build-tier:` lines never carry a ruling's literal (the judge's verification literal is at least 24 characters of spec content), so changing them can turn neither condition. The whole-file hash condition only matters when the spec is byte-identical, and then the literal test already fails. A test pins this: re-staging the spec between `--admit` and `--from-judge` leaves every disposition unchanged. A content edit between the two is not detected: `--admit` persists no digest of the file it judged, so there is nothing to compare against. The prose keeps the two calls adjacent, and recording the admitted digest is a follow-up (see OUT OF SCOPE).

**Chosen:** earlier-round keys get `open`. Here `open` means the files show no settlement, the only one of the four values they support. Whether a later round restated an earlier objection cannot be decided mechanically, and `fixed` would claim something nobody checked.

**Chosen:** the mapping core goes in a new factory module, `bin/lib/judge-dispositions.js`, which `spec-review.js` calls. `evidence-collate.js` is governance and must not require the factory `spec-judge-casefile.js`.

### 4.3 Registration and regions

**Chosen:** both new modules, `bin/lib/prep-attach.js` and `bin/lib/judge-dispositions.js`, are region `factory`, each with the banner `// === region:factory — <name> — FAFF-1406: <summary> ===` on line 2 or 3. They require factory and governance modules only, and nothing in governance requires them.

- `COMMANDS` in `bin/faff`: `prep: cmdPrep` through the `lazy` helper.
- `REGION_MAP` in `regions.js`: `prep: "factory"`. `REGION_SELFTEST_ARGV`: `prep: null`, with `TEST_FILE_COVERAGE` in `lint-cli-coverage.js` naming `test/prep-attach.test.mjs`. Neither new module carries a `--selftest` block: tests live in `test/` only (operator decision, 2026-10-28).
- `docs/guide/cli.md`: a row for `prep attach`; the `spec-review collate-evidence` row's usage gains `--from-judge --spec <file> [--judge-dir <dir>]`.

### 4.4 Prose rewrites

**faff-prep/SKILL.md**

- Replace _Provenance stamp (populate at attach)_, the build-tier paragraph and _Attach-state marker (write at produce time)_ (lines 61 to 109) with one short section, _Stage and attach (`faff prep attach`)_. It says when to stage (the instant the producer returns, before rendering, and again before every re-post), the token routing table from section 3, and the `hooks-ensure` snippet, which stays.
- Line 59, the consumer-fold paragraph: steps (1) to (4) become "stage runs the readiness fold"; the absent-block fallback sentence points at `needs-judgement:no-readiness-block`.
- Lines 484 (Scenario A), 624 (Path 1 re-stamp), 648 (Path 2 Step 3) and 357: each becomes one reference to that section with its call-site `--mode`. Line 624's carry-check sentence stays.
- Line 322: the judge-path clause becomes "judge path → `faff spec-review collate-evidence --dir $scratch --from-judge --spec <spec-file> --comment > comment.md`". The refuter-approve and human-accept clauses stay as they are.
- The faff-prep `ANCHOR_PHRASES` ("never end a turn", "in-flight marker") live in the Spec-review gate section and are not touched.

**validate-adapters.js:** lower `SKILL_LINE_BASELINE["faff-prep"]` to the new exact size (`wc -l` plus 1), with a `FAFF-1406 -N faff-prep` note at the front of the inline comment in the house style. `ANCHOR_PHRASES` is unchanged.

### 4.5 Rollout

This rewrites the attach ritual every prep runs, including the marker `prepcheck --hook` blocks on. The first prep after merge must be an attended interactive one, and no unattended prep drain uses the new command before it succeeds. The PR description states this, and the operator updates the installed skill and the `faff` on `PATH` together.

### 4.6 Edge cases

- **Stage twice before confirm** (a revise round): the marker is replaced with a fresh `ts`, `owner` and `spec_sha256`, and stays `attached:false`.
- **Confirm without a staged marker:** `errored`. It never invents a marker.
- **Confirm on a marker already `attached:true`** (a second post of the same staged body): returns `attached` and records the new `comment_id`; `spec_sha256` stays the last staged value.
- **No `confidence:` line, or one carrying anything but `high`, `medium` or `low`:** the stamp says `confidence: unknown`, and `computeSpecReadiness` reports the invalid confidence (`invalid`).
- **A `> Spec:` line elsewhere** (for example in a fenced example): only the first non-blank line after the H1 is replaced, and fenced lines are never touched.
- **`--gate-history` not a non-negative integer:** usage error, exit 2.
- **`--comment-id`:** stored as given, not format-checked, because it differs by tracker.
- **`--from-judge` with an empty ledger** (`order: []`): `--assemble` writes one when the standing residue is empty, so the lengths agree and every collated key is `open`, exit 0. An empty ledger beside a non-empty residue fails step 3's length check, exit 1.

### 4.7 Failure modes

| The failure | How you'd know | What it means |
|---|---|---|
| Linear normalizes markdown on save | `spec-commit.json` shows `source_check: "mismatch"` on builds whose tracker spec nobody edited | Expected to be possible; the check stays advisory. FAFF-1407 must compare a normalized form before making it blocking |
| The agent posts a copy it holds in context instead of `body_path` | Same signal, with a visibly different spec on the tracker; confirm cannot see this, only an edited `body_path` | Tighten the prose; the check is doing its job |
| `--assemble` changes how it builds the residue (for example dedupe across rounds) | The length or lens check in `from_judge` exits 1 on a real run | The mechanical mapping is broken; record the source key on each ledger entry instead |
| The installed CLI lags the skill | The first stage prints `unknown subcommand`, routed as `errored` | Update the install before prepping; the marker gap is surfaced, not silent |

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec file whose H1 has no stamp, carrying one valid readiness block and a "confidence: high" line
When  faff prep attach --issue EX-1 --spec s.md --mode interactive --json runs
Then  the token is "ready-to-post"
And   .faff/prep/EX-1.json has attached:false and spec_sha256 equal to the sha256 of s.md
And   s.md's first non-blank line after the H1 starts "> Spec: " and contains "· interactive ·" and "Full spec on"
And   s.md has exactly one "build-tier:" line
```

```
Given the state after the scenario above
When  faff prep attach --issue EX-1 --confirm --comment-id c-123 --json runs
Then  the token is "attached"
And   the marker has attached:true and comment_id "c-123"
And   faff prepcheck --issue EX-1 classifies the issue as attached
```

```
Given a spec with no faff-contract:spec-readiness fence
When  faff prep attach --issue EX-2 --spec s.md --mode autonomous --json runs
Then  the token is "needs-judgement" with reason "no-readiness-block"
And   the marker exists with attached:false
```

```
Given a scratch dir whose latest in-window round has two objections, a judge ledger with p-01 ruled AFFIRM_SPEC and p-02 parked, and one objection in an earlier round
When  faff spec-review collate-evidence --dir scratch --from-judge --spec s.md runs
Then  it exits 0
And   the latest round's first objection is "refuted", its second is "open", and the earlier-round objection is "open"
```

- No `faff prep attach` or `collate-evidence --from-judge` invocation makes a network call or a tracker call.

## 5. DESIGN DECISION RATIONALE

**Should attach post through the CLI, or render and confirm?**
- Post through the CLI: impossible, since the CLI has no tracker access by invariant.
- Emit a fenced descriptor like `label-op`: adds an agent-side parser for what is one body.
- Write the body to a file and confirm with the returned id: matches `landing-comment`, and the marker flips only on proof.
- **Chosen:** render to `body_path`, confirm with `--comment-id`.

**What should `needs-judgement` mean in attach?**
- Fold the prose-reading fallback into the command: requires an LLM call.
- Fail when there is no block: breaks producers that never emit one.
- **Chosen:** `needs-judgement:no-readiness-block` with `--extraction` re-entry.

**What should stage do with a parked marker?**
- Always replace it: in git-only mode that strips the park record while a run-ledger outcome may still read `parked`.
- Always refuse: blocks every tracker-mode re-prep, where the label, not the marker, is the park record.
- **Chosen:** refuse in git-only mode only, and route to the git-only Unpark contract.

**How do judge outcomes map to dispositions?**
- The first proposal (UPHOLD/SYNTHESIZE applied → fixed, AFFIRM → refuted, park → open) left out `PRD_BOUNDARY`, unapplied corrections and earlier-round keys.
- **Chosen:** the table in 4.2, aligned with `admitRollup`'s resolved and unresolved sets, with `open` wherever the files show no settlement.

**Shell out or call in-process?**
- **Chosen:** in-process, for the reasons in 4.1. At the time of writing every needed function is exported except `readStandingResidue`, which this change exports.

**Exit codes?**
- **Chosen:** `land`'s and `spec commit`'s convention: the typed token is the signal, `errored` exits 2.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1404 merged (`b7883697`, #1152), so `spec-commit.js` reads `marker.spec_sha256`. *Check:* `git grep -n spec_sha256 origin/main -- plugin/skills/faff/bin/lib/spec-commit.js`. Build on an `origin/main` that contains that commit.

## 7. DONE

### From WHY
- [ ] On a fresh spec, `faff prep attach` writes `.faff/prep/<ISSUE>.json` with `attached:false` before it reads the H1, so a spec with no H1 still leaves an open marker (`token: invalid`, `reason: no-h1`, marker present).
- [ ] After stage and confirm, `faff spec commit` on a captured copy of the posted `body_path` records `source_check: "match"`.
- [ ] On the judge path, `collate-evidence --from-judge --comment` produces a comment that `parseSpecReviewComment` accepts, with no disposition value supplied by the caller.

### From WHAT (commands and types)
- [ ] `faff prep attach` accepts the flags in section 3; an unknown flag, a missing required flag, more than one of `--spec`, `--confirm` and `--park`, or an `--issue` such as `../x` or `EX-1/..` exits 2 and writes nothing.
- [ ] `--json` output for every call matches `AttachResult`, and `token` is always one of the listed values.
- [ ] The marker gains `spec_sha256` at stage and `comment_id` and `attached_at` at confirm, and keeps `owner`, `harness`, `model` and `faff_version`.
- [ ] Every typed token exits 0 and `errored` exits 2.

### From HOW (prep attach)
- [ ] The stamp has the exact shape `> Spec: <producer> · <date> · <mode> · <harness>/<model> · faff <version> · confidence: <level>. Full spec on <Tracker> <ISSUE>.`, with no trailing sentence under `--git-only`.
- [ ] Staging the same file twice leaves exactly one `> Spec:` line under the H1 and exactly one `build-tier:` line.
- [ ] The `build-tier:` value equals what `faff tier <spec_path> [--gate-history N]` prints for the file stage wrote back, including at a `spec_lines` tier boundary.
- [ ] A spec failing `computeSpecReadiness` returns `invalid` with the contract's violation strings; two readiness blocks, or one that does not parse, return `errored`.
- [ ] `--extraction FILE` replaces block detection, and `provenance_present` is still computed by the command.
- [ ] `--confirm` with no staged marker returns `errored`; `--confirm` without `--comment-id` exits 2.
- [ ] `--confirm` after the staged file was edited returns `errored` with reason `spec-changed-since-stage` and leaves the marker `attached:false`.
- [ ] `--park` sets `disposition:"parked"`, keeps an existing `park` sub-object unchanged, and `faff prepcheck --issue` then classifies the issue as parked.
- [ ] `--park` with no marker returns `errored` with reason `no-staged-spec` and writes no marker.
- [ ] Under `--git-only`, stage writes `.faff/specs/<ISSUE>.md` with the stamped bytes and returns `attached`.
- [ ] Under `--git-only`, stage on a marker with `disposition:"parked"` returns `needs-judgement` with reason `git-only-marker-parked` and leaves the marker byte-identical.
- [ ] Marker writes are atomic: no reader observes a partial file (temp file and rename in the marker's directory).

### From HOW (collate-evidence --from-judge)
- [ ] Each row of the 4.2 table produces its stated disposition and rationale.
- [ ] Re-stamping the stamp and `build-tier:` lines of the spec between `--admit` and `--from-judge` leaves every disposition unchanged.
- [ ] Earlier-round keys are `open` with no rationale.
- [ ] A ledger whose length, lens or severity disagrees with the latest round exits 1; a missing `ruling-<pid>.json` for a non-parked proposition exits 2.
- [ ] `--from-judge` together with `--dispositions`, or without `--spec`, exits 2.
- [ ] `readStandingResidue` is exported from `spec-judge-evidence.js`, returns the latest round's number, and `judge-dispositions.js` imports it instead of reimplementing it.

### From HOW (registration, prose, ratchet)
- [ ] `faff regions check` passes with `prep-attach.js` and `judge-dispositions.js` each carrying a `region:factory … FAFF-1406` banner.
- [ ] `faff lint-cli-doc` and `faff lint-cli-coverage` pass with the new and changed `docs/guide/cli.md` rows.
- [ ] `REGION_SELFTEST_ARGV.prep` is `null`, `TEST_FILE_COVERAGE.prep` is `test/prep-attach.test.mjs`, and neither `prep-attach.js` nor `judge-dispositions.js` contains a `--selftest` block.
- [ ] `faff-prep/SKILL.md` no longer contains the marker JSON schema or the stamp field list, and calls `faff prep attach` at the Scenario A, Path 1 and Path 2 attach sites.
- [ ] `faff-prep/SKILL.md`'s judge-path evidence clause calls `collate-evidence --from-judge`.
- [ ] `faff-prep/SKILL.md` routes a call with no parseable token as `errored`.
- [ ] `SKILL_LINE_BASELINE["faff-prep"]` equals the file's new size, `ANCHOR_PHRASES` is unchanged, and `faff validate-adapters` reports no RATCHET and no FAIL for `faff-prep`.

### Rollout
- [ ] The PR description states that the first prep after merge is an attended interactive one, before any unattended prep drain uses `faff prep attach`.

### Tests
- [ ] `test/prep-attach.test.mjs` and `test/judge-dispositions.test.mjs` exist, run under `node --test`, and pass. They follow `test/spec-commit.test.mjs`: a pure core driven with fake deps, plus real CLI runs on a `mkdtempSync` fixture repo.

### Integration smoke test

```
PROCEDURE smoke():
  1. tmp repo with a .faff/config.yaml (tracking.tracker: linear) and a fixture spec s.md
     (one holdout fence, a valid readiness block)
  2. faff prep attach --issue EX-1 --spec s.md --mode autonomous --json   → ready-to-post
  3. faff prep attach --issue EX-1 --confirm --comment-id c1 --json       → attached
  4. faff prepcheck --issue EX-1                                           → attached
  5. cp s.md .faff/graft/EX-1/captured-spec.md; git worktree add wt -b feat
  6. faff spec commit --issue EX-1 --title "Fixture" --spec .faff/graft/EX-1/captured-spec.md
       --worktree wt --run-dir rd --json                                   → committed, source_check "match"
```

confidence: high
build-tier: complex
spec-review: accept (human, after round 3)

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Outcome: no blocking issues. The unit is right-sized after the FAFF-1404 split, its blocker is Done, and it carries one self-hosting risk to sequence around.

- **Right-sized (principle 4):** no issues. Two modules (about 200 and 90 lines) with tests under `test/`, one flag on an existing verb, one export, three registration sites and prose at six sites in one skill. It lowers one baseline. A 1 to 2 day unit.
- **Workstream fit (principles 1 and 5):** no issues. Project-less Backlog. FAFF-1404, FAFF-1405 and FAFF-1406 share an outcome (build and prep lanes cannot drift silently from prose instructions), a candidate cluster for a later rehoming pass.
- **Deps surfaced (principle 6):** FAFF-1404 is Done (#1152), so the blocker has cleared. FAFF-1409 is already blocked by this ticket. Two related links are missing and worth adding: FAFF-1407 (blocking `source_check`) only has data once this ticket writes `spec_sha256`, and FAFF-1349's length preflight would live in this ticket's stage procedure.
- **Risk profile (principle 7):** two risks to sequence around.
  - **Self-hosting:** this rewrites the attach ritual every prep runs, including the marker `prepcheck --hook` blocks on. Make the first prep on the new command an attended one before any unattended prep drain uses it.
  - **Skill and CLI skew:** the installed skill and the `faff` on `PATH` can come from different revisions (on 2026-10-28 the main checkout's CLI had no `faff version`). The spec routes an unparseable result as `errored`, so skew fails loud; the operator should update both together when this lands.
