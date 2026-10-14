# Warn-only evidence-schema check at mint, and a measurable readiness gate for enforcement (FAFF-1263)

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1263.

> Revised on 2026-10-13: five spec-review rounds folded in (readiness moved to a factory-region command, writer merge commits checked by the command, NUL-safe and clean-tree path handling, writer-proof files for the spec-review and holdout writers, no violation text or exception messages in output).

> Revised on 2026-10-14: FAFF-1257 was split into FAFF-1266 (2a), FAFF-1268 (2b) and FAFF-1267 (2c) and is now an umbrella, so the writer tickets are FAFF-1266, FAFF-1267, FAFF-1268, FAFF-1258, FAFF-1259 and FAFF-1260. Round 6 folded in: an anchor counts toward a qualifying run or a writer-proof file only when the commit that added it names its issue; too-shallow paths are split off by depth, not by drop-reason text; the post-merge readiness runs are stated as FAFF-1261's precondition; fixtures for the conforming mint and the smoke test are named.

This spec is for the build agent picking up FAFF-1263 and for its reviewers. FAFF-1263 is the warn-only period of the FAFF-1255 anchored-evidence work. It sits between the writer slices (FAFF-1266, FAFF-1267, FAFF-1268, FAFF-1258, FAFF-1259 and FAFF-1260) and enforcement (FAFF-1261). It wires FAFF-1256's `validateAnchorDir` into the per-PR mint and into `faff governance-check` without blocking anything. It also defines, as a command with an exit code, the criterion FAFF-1261 must meet before it turns refusal on.

## 1. WHY

**The idea the rest depends on.** A committed anchor is an immutable byte record. Re-validating it later gives the same answer as validating it at mint, provided the schemas are the same. So the durable warning record is the committed anchors themselves, not a stderr line or a separate log. The mint and the governance-check leg show the warning when it happens. A new read-only command, `faff evidence-readiness`, counts warnings by re-validating every anchor committed since a given revision, and reports whether the exit criterion is met. FAFF-1261 runs that command and requires exit 0 before it switches on refusal.

**Problem.** The FAFF-1255 spec says mint validation "only warns on stderr" until enforcement, and the FAFF-1263 ticket says enforcement waits for "zero warnings across at least one beep-boop run that covers slices 2 to 5's writers". Neither says how a warning is counted, where it is kept, or what "covers" means. stderr from an unattended beep-boop run is not kept anywhere, so nobody could check the condition. This change shows warnings at the point of minting, keeps them in reproducible form, and turns the criterion into a command.

### Design principles

- **Never change a mint outcome.** The warn-only check must not change the exit code, stdout, the bytes written or the order of writes of `faff events anchor`. A fault inside the check (a missing schema, an exception) is itself only a warning.
- **One validator.** Every check in this slice calls FAFF-1256's `validateAnchorDir`. Nothing here re-implements a schema rule.
- **The count is reproducible.** Anyone who runs readiness at the same commit of `main` gets the same result. The count never depends on a local log, a run dir or a machine. The report names the `head` commit it was computed at, because v0.3 schemas can still change between commits until FAFF-1261.
- **Report-only until FAFF-1261.** The governance-check leg added here never affects `pass`, the exit code, `reasons` or the `::error::` annotations.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` `anchor` handler (~1210-1299) | CJS JS | Per-PR mint; the warn-only call goes after a successful `mintIssueAnchor` |
| `plugin/skills/faff/bin/lib/evidence.js` `validateAnchorDir` (added by FAFF-1256) | CJS JS | The validator every check here calls |
| `plugin/skills/faff/bin/lib/governance-check.js` (`region:factory`) `evaluateAnchorDir` (~262), renderers (~545-590), `deriveAnchorDirs` (~335) | CJS JS | Gains a report-only `evidence_schema` leg; `deriveAnchorDirs` is reused by readiness |
| `plugin/skills/faff/bin/lib/regions.js` `REGION_MAP` | CJS JS | Region direction lint: a governance file never requires a factory file |
| `governance-check.js` `coherence` leg | CJS JS | The existing report-only leg pattern this copies |
| `plugin/skills/faff-graft/SKILL.md` Step 9b ("Anchor the chain head first") | Markdown | Graft must not mistake the warning for a refusal |
| `.faff/anchors/` (384 anchor dirs; 153 in beep-boop runs, checked 2026-10-13) | JSON, JSONL | The record the readiness count reads |
| `docs/guide/cli.md` | Markdown | CLI table rows |

**Scope.** This is the observation layer between the read-only validator (FAFF-1256) and the refusing gate (FAFF-1261); it changes no gate decision.

## 2. OUT OF SCOPE

- **Mint refusal, `--require-evidence-schema`, base-commit validation in CI, CODEOWNERS, draining in-flight run dirs.** Why: these are FAFF-1261. Extension point: FAFF-1261 replaces the warn-only call in the `anchor` handler with a pre-mint refusing call, and folds `legs.evidence_schema` into `pass` in `evaluateAnchorDir`.
- **Writers that stamp `schema_version`.** Why: FAFF-1266, FAFF-1267, FAFF-1268, FAFF-1258, FAFF-1259 and FAFF-1260. Until they land, every mint warns `legacy`, which is the expected state.
- **Schema checks in `anchor-run` and `bundle.js` re-mints.** Why: the FAFF-1255 parent excludes them; they re-mint historic runs. Extension point: the same `validateAnchorDir` call.
- **A persistent warning log or event type.** Why: the committed anchor already records everything a warning would, and a new event type would need a `DELIVERY_PROFILE` entry and a FAFF-1260 payload schema for no extra information. Extension point: an `evidence-schema-warning` event in `events.js`, if a run-local record is ever needed.
- **Validating live run dirs in `governance-check --run-dir`.** Why: the schema leg applies to anchors only (FAFF-1255). Extension point: `evaluateRunDir`.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Warning | One per-PR anchor whose `validateAnchorDir` status is anything other than `pass`: `legacy`, `fail`, or an error such as `schema-unavailable` |
| Cutover revision | The commit on `main` from which warnings are counted. FAFF-1261 passes the merge commit of whichever writer ticket landed last, or a later commit (see edge cases) |
| Window | The per-PR anchor dirs that were first added to git in `<cutover>..HEAD` on the current branch |
| Beep-boop run | An anchor run dir whose name contains `-beepboop-` (today: `run-<date>-<time>-beepboop-<mode>[-<hex>]`). Tracker-backed beep-boop runs mint one per-PR anchor per issue through `faff events anchor` at graft Step 9b (the run-level `anchor-run` is git-only mode), so their anchors pass through the warn-only check |
| Writer tickets | FAFF-1266, FAFF-1267, FAFF-1268, FAFF-1258, FAFF-1259 and FAFF-1260, the six writer slices. A constant in `evidence-readiness.js`. FAFF-1257 is an umbrella since its 2026-10-14 split and is not listed; FAFF-1266 writes no file but changes the reviewer fields and `finding_id` that FAFF-1268's `review-verdict.json` carries |
| Bound anchor | A window anchor `<run>/<ISSUE>` whose adding commit (the oldest first-parent commit in the window that added a file under it) has a subject naming `<ISSUE>` as a whole token, that is, `<ISSUE>` not followed by a digit. Per-PR anchors land in their own issue's squash merge, so this ties the anchor to that issue's merged, reviewed PR (checked 2026-10-14: 364 of 384 committed anchors bind; the 20 that do not are August beep-boop anchors merged under bare PR subjects, all far before any cutover) |
| Qualifying run | A beep-boop run that has at least one anchor in the window, and every one of its window anchors is bound and has status `pass` |
| Routine files | `events.jsonl` (events CLI, payloads closed by FAFF-1260), `run-ledger.json` and `build-progress.json` (FAFF-1258), `ac-checklist.json` and `review-verdict.json` (FAFF-1268), `declared-effects.jsonl` (effects CLI, payloads closed by FAFF-1260), plus the mint-written witnesses `chain-head.json` and `effects-chain-head.json` |
| Writer-proof files | `spec-review-verdict.json` (FAFF-1267's spec-review writer) and `holdout.json` (FAFF-1259's only file). Each must appear in at least one bound window anchor of any run type |
| Occasional files | `landing-progress.json` and `commissaire/producer/pk.json`. Reported, never required |

**Chosen:** the routine, writer-proof and occasional split follows what beep-boop anchors carry today. Every routine file except the two witnesses is produced by a writer from FAFF-1268, FAFF-1258 or FAFF-1260, so observing it with status `ok` shows that writer emitted a conforming file on a real run; a legacy-shaped evidence document has no `schema_version` and cannot pass. Across the 153 committed beep-boop anchors (checked 2026-10-13), every routine file appears in most recent runs: `ac-checklist.json` and `review-verdict.json` are floor-required, `build-progress.json` appears in 22 of 24 anchors from the last six runs, and `declared-effects.jsonl` in 17 of 24. Two files beep-boop runs have never anchored are the only output of a writer the ticket says must be covered: `spec-review-verdict.json` (0 of 153 beep-boop anchors) and `holdout.json` (0 of 153; its 3 committed instances are all in graft runs, since the holdout leg is capability-driven, not level-driven). Requiring them inside a beep-boop run could wait indefinitely, but dropping them would let FAFF-1259's writer reach enforcement unexercised. So each must appear in at least one bound window anchor of any run type, which still means a real run produced it and it passed. `landing-progress.json` has never been anchored (0 of 384), and `pk.json` is Commissaire's, not a FAFF-1255 writer's, so both are reported only. Their writers validate against the same v0.3 schema before writing (parent spec, `write_evidence` step 3), and the report names them when unobserved.

### The exit criterion

```
RECORD ReadinessReport:                           # `faff evidence-readiness --json`
  ready: Boolean
  since: String                                   # resolved full commit sha of the cutover revision
  head: String                                    # resolved HEAD sha
  spec_version: "v0.3"
  window_anchors: Integer                         # count of anchor dirs in the window
  warnings: Integer                               # count of window anchors with status != pass
  warning_anchors: List<{ anchor: String, status: "legacy" | "fail" | "error",
                          files: List<String> }>  # non-ok file paths only; never violation text
  runs: List<{ run: String, beep_boop: Boolean, anchors: Integer, warnings: Integer, qualifying: Boolean }>
  writers: List<{ issue: String, commit: String | null, before_since: Boolean }>   # one per writer ticket
  dropped: List<{ path: String, reason: String }>  # unsafe anchor paths: traversal, symlink escape, unresolvable
  ignored: List<{ path: String, reason: String }>  # paths fewer than three segments below the anchors root, e.g. a README
  unbound_anchors: List<{ anchor: String, commit: String }>  # window anchors whose adding commit does not name their issue
  routine_files: Map<String, { observed: Boolean }>      # observed = present in some qualifying-run anchor
  writer_proof_files: Map<String, { observed: Boolean }>  # observed = present in some bound window anchor of any run
  occasional_files: Map<String, { observed: Boolean }>
  unmet: List<String>                             # human-readable reasons ready is false; empty when ready
```

```
CONSTRAINT ready = (window_anchors >= 1)
               AND (every writers entry has commit != null AND before_since = true)
               AND (dropped is empty)
               AND (warnings = 0)
               AND (at least one run has qualifying = true)
               AND (every routine_files entry has observed = true)
               AND (every writer_proof_files entry has observed = true)
```

**Chosen:** a warning is counted per anchor, not per file or per violation. One anchor is one PR's evidence. A PR either would have minted under enforcement or would have been refused, so the anchor is the unit that matches what FAFF-1261 changes. Per-file detail stays in the report for diagnosis.

**Chosen:** `legacy` counts as a warning. Under FAFF-1261 the mint has no legacy pass (FAFF-1255: "there is no legacy pass at mint"), so a legacy anchor minted after the cutover is exactly a build that enforcement would park.

**Chosen:** the window is defined by git history (anchors first added in `<cutover>..HEAD`), not by run timestamps or the ledger's `base_sha`. Git history is the same on every checkout of `main`. A `base_sha` can be null (interactive runs before FAFF-1028), and run-id timestamps are local clock values.

**Chosen:** readiness checks the cutover revision itself rather than trusting the caller. For each writer ticket it finds the newest first-parent commit on `HEAD` whose subject contains `(<ID>)`, the squash-merge subject convention on `main` (for example `… (FAFF-1179) (#1044)`), and requires that commit to be the cutover or an ancestor of it (`git merge-base --is-ancestor`). A writer with no such commit, or one merged after the cutover, is unmet. A `--since` set too early (before a writer) or a writer not yet merged therefore cannot report `ready`. A `--since` set later than necessary is allowed, since it only shrinks the window and the remaining clauses still need a full qualifying run after it.

**Chosen:** readiness sets aside paths fewer than three segments below the anchors root itself, before calling `deriveAnchorDirs`, by counting segments. They go in `ignored` and do not block, so a committed README under `.faff/anchors/` cannot hold readiness hostage. Every path `deriveAnchorDirs` then drops (a traversal segment, symlink escape or an unresolvable path) goes in `dropped` and blocks readiness, because a path that cannot be checked must not count as clean. No decision reads `deriveAnchorDirs`'s reason text, which is diagnostic prose and may change; the reason is copied into the report for the reader only. Paths that no longer exist on disk (deleted anchors) are skipped by `deriveAnchorDirs` itself and appear in neither list.

**Chosen:** the writer-commit match is exact. A commit matches writer ticket W when its subject contains the literal text `(W)`, parentheses included, so `(FAFF-1266)` never matches `(FAFF-12660)`. A subject naming two tickets matches both. When several first-parent commits match, the newest (first in `git log --first-parent` order) is used. `writers[].commit` is that commit's full sha, or null when none matches.

**Chosen:** `observed` means present. A writer-proof file is `observed` when any bound window anchor contains it; with `warnings = 0` every window anchor passed, so the file conforms. A routine or occasional file F is `observed` when at least one anchor of a qualifying run contains F; every file in such an anchor is `ok`, since the anchor passed. A routine file absent from every qualifying-run anchor (for example a run whose only anchor has no `build-progress.json`) is `observed: false` and blocks readiness until a later qualifying run carries it.

**Chosen:** only bound anchors can make a run qualifying or a writer-proof file observed. A directory named `run-…-beepboop-…` with hand-written conforming files, committed under an unrelated subject, would otherwise satisfy the criterion with no real run and no writer exercised. Binding each anchor to its own issue's merged PR means a fabricated anchor has to travel through a PR for that issue, past its review and the merge gate. Unbound anchors are still validated and still count as warnings when they do not pass, and are listed in `unbound_anchors` for the human pasting the report. **Accepted risk:** a hand-written anchor inside the issue's own reviewed PR still binds. Readiness cannot tell it from a minted one; PR review covers it now, and FAFF-1261's CODEOWNERS rule on `.faff/anchors/` narrows it further.

### Where warnings are recorded

| Place | What it holds | Durable | Role |
|---|---|---|---|
| Committed anchor under `.faff/anchors/<run>/<ISSUE>/` | The exact bytes that were validated | Yes, in git | The authoritative record. Readiness re-validates it |
| `faff events anchor` stderr | One summary line plus up to five file lines per non-pass mint | No | Live signal to the agent or operator at Step 9b |
| `faff governance-check` `evidence_schema` leg | Status and failing file names per anchor in the PR | In the CI job summary and `--json` output | Per-PR visibility for reviewers |
| `faff evidence-readiness` | The count and the criterion | Printed on demand; FAFF-1261 pastes the `--json` output into its PR description | The gate FAFF-1261 runs |

**Chosen:** readiness re-validates using the CLI's bundled v0.3 schemas at the commit it runs on, not the version used at mint, and records that commit as `head`. v0.3 stays draft (editable) until FAFF-1261 lands (FAFF-1256 spec), and enforcement will check against the schemas as they are when it switches on. A warning that a later schema fix clears was never a writer problem. A pass that a later schema tightening breaks is a real problem FAFF-1261 would hit. The result is reproducible per commit, which is why the report carries `head` and why FAFF-1261 re-runs it on the commit it branches from.

### Interfaces

```
faff events anchor --run-dir D --issue I --dest X      # unchanged flags, exit codes and stdout

stderr, appended only when validateAnchorDir(X).status != "pass", after the existing stdout line:
  "faff events anchor: evidence-schema warn-only: <status> <I> (<n> non-conforming file(s)); not a refusal; details: faff evidence validate <X>"
  then, for each non-ok file (at most 5 files, then "(+N more files)"):
  "  <path>: <file status>, <k> violation(s)"            # paths, statuses and counts only, never violation text
on a validator error or exception:
  "faff events anchor: evidence-schema warn-only: error <I>: <reason>; not a refusal"
  <reason> is "schema-unavailable <bundled path>" for that fault, else the exception's class name only
  (e.name, e.g. "TypeError"), never e.message, which can quote evidence content
```

```
faff evidence-readiness --since <rev> [--anchors-root DIR] [--json]   # no flag overrides the writer tickets
  --anchors-root defaults to .faff/anchors
  exit 0  ready
  exit 1  not ready (report says why in `unmet`)
  exit 2  usage error; <rev> does not resolve to a commit; not inside a git work tree;
          bundled manifest or a schema unavailable (the `schema-unavailable` fault from validateAnchorDir)
human output: "evidence-readiness since <short-sha>: READY|NOT READY", then the counts, the per-run
              table, the routine, writer-proof and occasional observed lists, and each `unmet` reason
```

```
governance-check: evaluateAnchorDir(dir, ...) result gains
  legs.evidence_schema: { report_only: true,
                          status: "pass" | "legacy" | "fail" | "error",
                          files: List<{ path, status }>,      # non-ok files only
                          detail: String }
  pass is still integrity.pass AND merge_floor.pass
text renderer:     one "evidence_schema" line in the same layout as the existing coherence line,
                   marked "(report-only)", showing <status> and <detail>
summary markdown:  "| evidence_schema _(report-only)_ | <status> | <detail> |"
--json:            the leg object as above
buildReasons and renderGovernanceCheckAnnotations do not read the leg
evaluateRunDir results carry no evidence_schema leg; renderers guard on its presence
```

**Chosen:** the leg name `evidence_schema` and its result shape are the interface FAFF-1261 builds on. FAFF-1261 adds the flag, folds the leg into `pass` and runs it with the base commit's CLI. This slice adds none of those.

## 4. HOW

### Mint: warn after a successful mint

Summary: after `mintIssueAnchor` has written the anchor, validate the anchor directory and print warnings, then return the exit code the handler returns today.

```
PROCEDURE anchor_handler_tail(dirArg, issueArg, destArg, result):   # replaces the success tail only
  1. Print the existing success line to stdout, unchanged
  2. TRY
       report = validateAnchorDir(destArg, {})       # lazy require("./evidence") here, not at module top
       IF report is an error result (schema-unavailable): write the warn-only error line with that reason
       ELSE IF report.status != "pass": write the warn-only lines (see Interfaces) to stderr
     CATCH any error e:
       write the warn-only error line with reason e.name (never e.message) to stderr
  3. RETURN 0                                         # the same value as today, whatever step 2 found
```

**Chosen:** the mint's stderr lines carry paths, statuses and violation counts only, never violation text. FAFF-1256's violation messages are written never to print values, but this slice does not depend on that: the mint line goes to CI and run logs, so it carries no text the validator composed. A later message change in FAFF-1256 then cannot leak evidence data here. The full messages are one `faff evidence validate <dest>` away, and the summary line says so.

**Chosen:** validate the minted destination, not the run dir before the mint. The destination holds exactly the bytes that get committed and that governance-check and readiness will read. Pre-mint validation of the run dir is a refusal concern, so it belongs to FAFF-1261. Validating after the mint also means a validator crash cannot leave a partial anchor.

**Chosen:** `require("./evidence")` is called inside the handler, not at the top of `events.js`. `evidence.js` requires `events.js` (for `eventViolations` and `splitPhysicalLines`, per the FAFF-1256 spec), so a top-level require in both directions would hand one module a half-loaded export object. By the time the handler runs, both modules are fully loaded.

**Anti-pattern:** returning a non-zero exit, or skipping the warning when the status is `legacy`. Why: the first parks builds before the writers land; the second hides exactly the signal this period exists to surface.

**Anti-pattern:** writing a warning file into the anchor directory. Why: it would be an unmanifested file, which FAFF-1256 reports as `unschemaed` and FAFF-1261 refuses.

### Graft Step 9b

Add one sentence to `faff-graft/SKILL.md` Step 9b, beside the existing anchor-refusal paragraph: an `evidence-schema warn-only` stderr line is not a refusal; exit 0 proceeds to commit and push as normal, and the agent does not park, retry or edit evidence files because of it. No other SKILL changes. The warning is advisory, and readiness reads the committed anchor, not graft's log.

### Governance-check: report-only leg

Summary: `evaluateAnchorDir` calls `validateAnchorDir(dir)` and attaches the result as `legs.evidence_schema`, wrapped so an exception becomes `status: "error"`.

```
PROCEDURE evidence_schema_leg(dir):
  TRY report = validateAnchorDir(dir, {})
      IF report is an error result: RETURN { report_only: true, status: "error", files: [], detail: "validator error: " + its schema-unavailable reason }
      RETURN { report_only: true, status: report.status,
               files: [ {path, status} for f in report.files where f.status != "ok" ],
               detail: status = pass   -> "all files conform to v0.3"
                       status = legacy -> "legacy anchor (no evidence document carries schema_version)"
                       status = fail   -> "<n> file(s) non-conforming: <first 3 paths>" }
      # every path placed in files[] or detail goes through one sanitiser first: control characters
      # (including CR/LF) become a space, and "::" becomes ": :", so no rendered line can be read as a
      # GitHub Actions workflow command; the summary-markdown renderer also escapes "|" as "\|".
      # Anchor file names are PR-authored. The mint's stderr file lines use the same sanitiser.
  CATCH e: RETURN { report_only: true, status: "error", files: [],
                    detail: "validator error: " + <reason as in the mint line: schema-unavailable path or e.name> }
```

The leg runs before the existing `return` in `evaluateAnchorDir`. Text, markdown and JSON renderers show it. The integrity stderr note loop in `cmdGovernanceCheck` is unchanged.

### Readiness: count and decide

Summary: list the anchors added to git since the cutover revision, validate each, group by run, and evaluate the criterion.

```
PROCEDURE readiness(since, anchors_root):
  1. Require a git work tree (`git rev-parse --is-inside-work-tree`); else exit 2
  1a. Require `git status --porcelain --untracked-files=all -- <anchors_root_rel>` to print nothing; else exit 2
      "anchors root has uncommitted changes" (the validated bytes must be the committed bytes at HEAD)
  1b. Require realpath(anchors root) to be inside realpath(repo root); else exit 2 (a symlinked root cannot
      point outside the repo)
  2. Refuse a <since> that starts with "-" (exit 2), so git never reads it as an option
     since_sha = `git rev-parse --verify <since>^{commit}`; failure -> exit 2
     head_sha  = `git rev-parse HEAD`
  2a. FOR each writer ticket W:
        commit = the first sha, in `git log --first-parent --format=%H%x09%s HEAD` output order, whose subject
                 contains the literal "(W)"   # "newest" means first in this order, never commit-date order
        before_since = commit != null AND `git merge-base --is-ancestor <commit> <since_sha>` exits 0
  3. added = `git log -z --diff-filter=A --name-only --format= <since_sha>..HEAD -- <anchors_root_rel>`, split on NUL
     any added path containing a control character (including newline) or "|" -> dropped, reason "unsafe path characters"
     any remaining path with fewer than three segments below <anchors_root_rel> -> ignored (segment count, not reason text)
     { dirs, dropped } = deriveAnchorDirs(<root>/<path> for each remaining path, <root>/<anchors_root_rel>)
                                                                # absolute strings on both sides; deleted paths are skipped
     every deriveAnchorDirs drop -> dropped
  3a. FOR each dir <run>/<ISSUE> in dirs:
        commit = last line of `git log --first-parent --diff-filter=A --format=%H%x09%s <since_sha>..HEAD -- <dir>`
        bound  = commit's subject contains <ISSUE> not followed by a digit; else add { anchor, commit } to unbound_anchors
  4. FOR each dir in dirs (sorted):
       report = validateAnchorDir(dir, {})
       a validateAnchorDir schema-unavailable fault -> exit 2 (the means of checking is missing)
       any other thrown error -> record the anchor as status "error" (counts as a warning); the report carries e.name only
  5. Group dirs by run (the path segment under anchors_root). For each run:
       beep_boop  = run name contains "-beepboop-"
       qualifying = beep_boop AND every one of its window anchors is bound and has status pass
  6. FOR each routine and occasional file F:
       observed = some anchor of a qualifying run contains F
     FOR each writer-proof file F:
       observed = some bound window anchor (any run) contains F
  7. Compute `ready` per the constraint; fill `unmet` with one line per failed clause, e.g.
       "3 warnings in window (see warning_anchors)", "no qualifying beep-boop run",
       "writer FAFF-1259 merged after --since", "1 anchor path dropped (see dropped)",
       "writer-proof file holdout.json not observed in window",
       "routine file build-progress.json not observed"
  8. Print the report (human or --json); exit 0 if ready else 1
```

**Chosen:** readiness is a new factory-region module, `bin/lib/evidence-readiness.js`, registered as the top-level command `faff evidence-readiness` (`REGION_MAP["evidence-readiness"] = "factory"`, a `REGION_SELFTEST_ARGV` entry, a `bin/faff` require and `COMMANDS` entry). It requires `governance-check.js` (factory to factory) for `deriveAnchorDirs` and `evidence.js` (factory to governance, a legal direction) for `validateAnchorDir`. It cannot live in `evidence.js`: that module is governance-region (FAFF-1256), `governance-check.js` is factory-region, and `faff regions check` forbids a governance file requiring a factory file. `governance-check.js` requires `evidence.js` at the top of the file, which is legal and cycle-free, since `evidence.js` never requires `governance-check.js`. The git calls run from the repo root (`findRoot`), use `execFileSync` with an argument array, as `effects-reconcile.js` already does, and never use a shell string. `--anchors-root` is resolved to an absolute path and must be inside the repo root (else exit 2); its repo-relative POSIX form (`anchors_root_rel`) is the pathspec for `git log`. `deriveAnchorDirs` then receives absolute paths on both sides, the repo root joined to each git path and to `anchors_root_rel`, so its prefix match and on-disk checks do not depend on the process working directory.

**Chosen:** `git log` output is read NUL-delimited (`-z`), and a path containing a control character or `|` is a `dropped` entry that blocks readiness. Git allows newlines in file names, and newline-split parsing would make such an anchor vanish from the count without trace.

### Edge cases

- **Writer merge subject not found** (a writer landed without `(FAFF-NNNN)` in its first-parent subject): readiness reports that writer as unmet. Recovery is a human check and a later re-run, never a flag that skips the writer.
- **Run that straddles the cutover** (started under the old writers, some anchors committed after the cutover): its post-cutover anchors are `legacy` or `fail`, so they count as warnings and the run is not qualifying. Recovery: once that run is finished, pass a later cutover revision, such as the merge of the straddling run's last PR. The criterion still needs a full qualifying beep-boop run after the new revision, so moving the revision forward cannot hide a writer that is still broken.
- **Window is empty** (no anchors since the cutover): `ready: false`, unmet "no anchors in window".
- **Anchor added then deleted in the window:** `deriveAnchorDirs` skips paths that no longer exist on disk. A deleted anchor is not counted and is not a dropped entry.
- **Anchor dir modified after it was added:** committed anchors are immutable by convention. Readiness validates the bytes committed at `HEAD` (step 1a refuses a dirty anchors root), which is what CI enforcement would read.
- **Uncommitted or untracked files under the anchors root:** exit 2 with "anchors root has uncommitted changes". Run readiness on a clean checkout.
- **Interactive and fly runs in the window:** their anchors count toward `warnings`, but they never make a run qualifying. Any non-pass anchor blocks readiness whatever its run type.
- **`--anchors-root` outside the repo, a symlinked root that resolves outside it, or a path with `..`:** readiness step 1b checks the root by realpath and exits 2; `deriveAnchorDirs` containment then handles each anchor dir under it.
- **Mint into an existing destination with stale files:** the check validates what is in the destination, the same bytes that would be committed, so a stale extra file is reported.
- **Bundled schema missing at mint:** one `error` warning line, exit 0, anchor written.

### Failure modes

- **The subject-match finds the wrong commit for a writer.** How you'd know: the report's `writers[].commit` for a ticket is not that ticket's merge PR. What it means: the human pasting the report into FAFF-1261 checks the six shas; a mismatch is fixed by re-running at a revision where the newest match is right, never by a skip flag.
- **Beep-boop runs are too rare to reach readiness.** How you'd know: readiness stays `NOT READY` with "no qualifying beep-boop run" weeks after the writers land, because the last beep-boop run before 2026-10-13 was 2026-09-24. What it means: proceed. Starting a beep-boop list run over a few small Todo issues is the intended way to meet the criterion. The ticket requires a beep-boop run, so it is not waived.
- **Holdout runs are too rare to reach readiness.** How you'd know: readiness stays `NOT READY` with "writer-proof file holdout.json not observed in window" (3 of 384 anchors carry it today, all from early October graft runs). What it means: proceed. Run one graft with a holdout scenario after the writers land. Moving `holdout.json` to the occasional set is a one-line change to a constant, and is a product-owner call, not a builder's.
- **Nobody starts the readiness runs.** How you'd know: FAFF-1261 is unblocked but readiness reports "no qualifying beep-boop run" or an unobserved writer-proof file. What it means: the runs are FAFF-1261's precondition, not this slice's build output. The hand-off row in `docs/guide/cli.md` (see DONE) names both runs, so whoever picks up FAFF-1261 starts them first.
- **Occasional files never get observed.** How you'd know: the report lists `landing-progress.json` or `pk.json` as unobserved. What it means: proceed; writer-side validation covers them.

## Scenarios

```
Given a run dir with a valid genesis, ac-checklist.json and review-verdict.json in today's legacy shape
When `faff events anchor` mints it into a temp dest
Then the exit code is 0, stdout is the existing success line, and the dest holds the same files as before this change, each byte-equal to its run-dir source
And stderr carries "evidence-schema warn-only: legacy FAFF-1" and "not a refusal"
```

```
Given the same run dir with v0.3-conforming evidence documents except review-verdict.json missing "rounds_total"
When it is minted and then checked by `faff governance-check --anchor-dir <dest> --json`
Then the mint exits 0 and stderr names review-verdict.json
And the governance-check exit code and `pass` equal what they are with the leg removed, and legs.evidence_schema.status is "fail" with report_only true
```

```
Given a temp git repo with six first-parent commits whose subjects end, in this order, "(FAFF-1266)", "(FAFF-1268)", "(FAFF-1267)", "(FAFF-1258)", "(FAFF-1259)" and "(FAFF-1260)", and no other commit subject naming those tickets
And after them, in this order: a commit "(FAFF-9)" adding one legacy anchor under run-…-graft-FAFF-9/FAFF-9, then commits "(FAFF-10)" and "(FAFF-11)" each adding one v0.3-conforming anchor under run-…-beepboop-list-aaaaaa/FAFF-10 and /FAFF-11 that between them carry every routine file plus spec-review-verdict.json and holdout.json
When `faff evidence-readiness --since <the FAFF-1260 commit> --json` runs
Then it exits 1 with warnings 1, the beep-boop run qualifying, and unmet naming the legacy graft anchor
And re-running with --since set to the graft-anchor commit (so the window holds only the two beep-boop anchors) exits 0
And in every run, writers[].commit for each ticket is the sha of the commit whose subject names it
And re-running with --since set to the FAFF-1258 commit exits 1 with unmet naming FAFF-1259 and FAFF-1260 as merged after --since
```

- The `faff events anchor` exit code is identical, before and after this change, for every existing test fixture.
- No stderr line from the warn-only check, and no readiness output, contains a field value from an evidence file. Only paths, statuses and counts are printed.

## 6. DESIGN DECISION RATIONALE

- **Where are warnings recorded?** Options: stderr only (lost in unattended runs); a new event type in `events.jsonl` (needs a profile entry and a FAFF-1260 payload schema, and is only in run dirs, which are not committed); a sidecar log (machine-local); the committed anchors themselves. **Chosen:** the committed anchors, re-validated by `faff evidence-readiness`, with stderr and the governance-check leg as live views. It needs no new artifact and gives every checkout the same count.
- **What is one warning?** Per violation is noisy; per run hides which PR. **Chosen:** per anchor, which is what enforcement refuses.
- **Does `legacy` count?** **Chosen:** yes; enforcement has no legacy pass at mint.
- **How is the window bounded?** Run-id timestamps are local clocks, and `base_sha` can be null. **Chosen:** git history, anchors first added in `<cutover>..HEAD`.
- **What does "covers slices 2 to 5's writers" mean?** Requiring every file inside a beep-boop run would wait on file types beep-boop has never anchored; requiring only routine files would leave FAFF-1259's holdout writer unexercised. **Chosen:** routine files observed in a qualifying beep-boop run, `spec-review-verdict.json` and `holdout.json` observed in any bound window anchor, and `landing-progress.json` and `pk.json` reported only.
- **Validate before or after the mint?** **Chosen:** after, on the destination; pre-mint validation is a refusal concern for FAFF-1261.
- **Which schemas does readiness use?** **Chosen:** the current bundled v0.3, which are the schemas enforcement will apply.
- **Leg in `pass` now or later?** **Chosen:** report-only now, like `coherence`; FAFF-1261 folds it in.
- **Module load order between `events.js` and `evidence.js`?** **Chosen:** a lazy require inside the `anchor` handler, avoiding a circular top-level require.
- **Which bytes does readiness validate?** The working tree can differ from the committed record. **Chosen:** refuse a dirty or symlink-escaped anchors root, so the validated bytes are the committed bytes at `HEAD`.
- **How are git paths read?** Newline-split output loses newline-bearing names. **Chosen:** NUL-delimited `git log -z`, with unsafe names dropped and blocking.
- **Trust the caller's `--since`, or check it?** A prose instruction to FAFF-1261 is fail-open. **Chosen:** readiness resolves the writer merge commits itself and requires them at or before `--since`.
- **Print violation messages at mint?** Messages are composed by FAFF-1256 and may change. **Chosen:** paths, statuses and counts only, with a pointer to `faff evidence validate`.
- **Where does readiness live?** Inside `evidence.js` would need a governance-to-factory require, which `faff regions check` forbids; moving `deriveAnchorDirs` out of `governance-check.js` widens this slice. **Chosen:** a new factory-region module `evidence-readiness.js` and command `faff evidence-readiness`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1256 is merged, exporting `validateAnchorDir(anchorDir, opts)` from `plugin/skills/faff/bin/lib/evidence.js`. It returns `{ status: "pass" | "fail" | "legacy", files: [{ path, status, violations }] }` and signals `schema-unavailable` either by throwing or by an error result whose message starts with `schema-unavailable`. Validation: on the branch base, `require("./evidence").validateAnchorDir` is a function, and `faff evidence --selftest` exits 0. Handle both error forms.
- **Assumes:** after the six writer tickets merge, someone starts one beep-boop list run and one graft run with a holdout scenario, then runs `faff evidence-readiness`. These runs are operational, not code; this slice cannot perform them because its build precedes the writers. These runs are owned by FAFF-1270 (blocked by the writer tickets and FAFF-1263, blocks FAFF-1261), filed by product-owner decision on 2026-10-14. Validation: the FAFF-1261 hand-off in DONE states it.
- **Assumes:** `deriveAnchorDirs` stays exported from `governance-check.js` (it is in `module.exports` today, line ~1477). Validation: `require("./governance-check").deriveAnchorDirs` is a function.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] For every existing `faff events anchor` test (`test/events-chain.test.mjs`, `test/events-anchor-genesis-guard.test.mjs`, `test/faff-1155-anchor-floor-required.test.mjs`, `test/effects-chain.test.mjs`, `test/commissaire-standalone.test.mjs`, `test/faff-1001-anchor-before-pr-order.test.mjs`, `test/faff-1005-anchor-commit-broad-swallow.test.mjs`) and the `events --selftest` anchor cases: passes with no edits
- [ ] `faff governance-check --selftest` passes, and every existing governance-check test's exit code and `pass` are unchanged

### From WHAT
- [ ] `faff evidence-readiness --json` output matches the ReadinessReport shape; `ready` follows the constraint exactly (one test per failed clause: empty window, a warning, no qualifying run, an unobserved routine file)
- [ ] A `legacy` window anchor counts as one warning; a `fail` anchor with several bad files counts as one warning
- [ ] Readiness exits 2 for an unresolvable `--since`, outside a git work tree, and when the bundled manifest is unavailable
- [ ] `writers` lists all six writer tickets and no entry for FAFF-1257; a subject containing `(FAFF-12660)` does not match FAFF-1266, a subject naming two tickets matches both, and with two matching commits the newer sha is reported; a writer with no matching first-parent commit, or one merged after `--since`, makes `ready` false with an `unmet` line naming it; no flag skips a writer
- [ ] An anchor path dropped for traversal or symlink escape appears in `dropped` and makes `ready` false; a committed `.faff/anchors/README.md` appears in `ignored` and does not change `ready`; in one window holding a symlink-escape anchor and an added-then-deleted anchor, only the first appears in `dropped`
- [ ] Readiness exits 2 when a tracked anchor file under the anchors root is modified but not committed, or an untracked file sits there, and when the anchors root is a symlink resolving outside the repo
- [ ] With two first-parent commits naming `(FAFF-1266)`, the FAFF-1266 entry's `commit` is the one nearer `HEAD` in first-parent order, even when its author date is older
- [ ] A failing anchor file whose name contains `::error::` renders in the governance-check text output, `--json` and `--summary-md` with `: :` in place of `::`; a name with `|` renders as `\|` in one `--summary-md` row
- [ ] Readiness exits 2 for a `--since` starting with `-` and for an unresolvable or outside-the-repo `--anchors-root`; with `--anchors-root` given as an absolute path to the repo's `.faff/anchors`, the report equals the default run's report
- [ ] With `holdout.json` absent from every window anchor, `ready` is false with an `unmet` line naming it; a single interactive-graft window anchor carrying a passing `holdout.json` satisfies the clause
- [ ] When `validateAnchorDir` returns a schema-unavailable error result instead of throwing, the mint prints the `error` warn-only line with that reason and the leg reports `status: "error"`
- [ ] A qualifying run with no `build-progress.json` in any anchor gives `routine_files["build-progress.json"].observed: false` and an `unmet` line naming it
- [ ] `legs.evidence_schema` appears on anchor results with `report_only: true` and the four statuses; it is absent on `--run-dir` results, and the renderers do not throw on its absence

### From HOW (mint)
- [ ] A legacy-shaped mint exits 0; stdout matches the existing `events anchor: … → …` success-line format; the dest holds exactly the files the pre-change mint writes, each byte-equal to its run-dir source (witnesses equal `computeChainHead` output); stderr matches `evidence-schema warn-only: legacy <ISSUE>`
- [ ] A conforming mint prints no warn-only line: the test builds a run dir (valid genesis and chained `events.jsonl` from the existing anchor test helpers, `ac-checklist.json` and `review-verdict.json` copied from FAFF-1256's v0.3 valid examples, `schema_version: 1` added where the manifest requires it), runs `faff events anchor` on it through the CLI, and asserts both that stderr has no warn-only line and that `faff evidence validate <dest>` reports `pass`
- [ ] A non-conforming mint names at most 5 files on stderr, then `(+N more files)`; each file line carries a status and a count, and the summary line names `faff evidence validate <dest>`
- [ ] With `validateAnchorDir` stubbed to throw, and with the bundled manifest removed (temp copy of the plugin tree), the mint exits 0, writes the full anchor, and prints the `error` warn-only line
- [ ] `events.js` has no top-level `require("./evidence")`; `evidence.js` requires neither `governance-check.js` nor `evidence-readiness.js`; `REGION_MAP["evidence-readiness"]` is `"factory"`; `faff evidence-readiness --selftest` exits 0
- [ ] `faff-graft/SKILL.md` Step 9b states that an `evidence-schema warn-only` line is not a refusal; `faff validate-adapters` passes

### From HOW (governance-check)
- [ ] An anchor with an invalid evidence file gives `legs.evidence_schema.status: "fail"` while `pass`, the exit code, `reasons` and annotations equal those of the same anchor with valid evidence
- [ ] Text output has an `evidence_schema:` line marked `(report-only)`; `--summary-md` has the matching row; a `fail` leg's `detail` reads `<n> file(s) non-conforming: <first 3 paths>`

### From HOW (readiness)
- [ ] An added path containing a newline or `|` appears in `dropped` and makes `ready` false; `--summary-md` output for a failing file named with `|` keeps one table row
- [ ] Readiness run from a subdirectory of the repo gives the same report as from the root
- [ ] Readiness counts only anchors first added in `<since>..HEAD` (an anchor added before the cutover and still present is not counted)
- [ ] A run is qualifying only when its name contains `-beepboop-` and all its window anchors are bound and pass
- [ ] Routine and occasional files are reported as observed only when present in a qualifying-run anchor; writer-proof files when present in any bound window anchor
- [ ] An anchor `run-…-beepboop-list-x/FAFF-9` added by a commit whose subject does not name `FAFF-9` (or names only `FAFF-90`) is listed in `unbound_anchors`, its run is not qualifying, and a `holdout.json` it carries is not observed; the same anchor added under a subject ending `(FAFF-9) (#1)` binds
- [ ] With `deriveAnchorDirs`'s drop-reason strings changed in a test double, a committed `.faff/anchors/README.md` is still `ignored` and a symlink-escape anchor is still `dropped`
- [ ] Git is invoked through `execFileSync` with argument arrays (asserted by grep in the test)
- [ ] `docs/guide/cli.md` has a row for `evidence-readiness --since <rev> …` and the governance-check row mentions the report-only `evidence_schema` leg; `test/lint-cli-doc.test.mjs` and `test/lint-cli-coverage.test.mjs` pass; `faff regions check` passes

### From HOW (edge cases)
- [ ] A straddling run (one legacy and one passing anchor in the window) is not qualifying and its legacy anchor is listed in `warning_anchors`
- [ ] An anchor added and then deleted inside the window is not counted
- [ ] No warn-only stderr line or readiness output contains a sentinel string planted in an evidence field (`S3CR3T-SENTINEL`), including as the string value `"schema": "S3CR3T-SENTINEL"` in an `events.jsonl` line (the discriminator-miss path), and the governance-check `evidence_schema` leg's `detail` and `files` (text, `--json` and `--summary-md`); with the validator stubbed to throw an error whose message contains the sentinel, the mint line, the leg and readiness all omit it

### Hand-off to FAFF-1261
- [ ] `docs/guide/cli.md`'s `evidence-readiness` row states that FAFF-1261 requires `faff evidence-readiness --since <rev>` to exit 0 at the commit FAFF-1261 branches from and again at its own head before merge (so a v0.3 schema edit made inside FAFF-1261 is covered), with the `--json` output (which names `head` and the six writer commits) pasted into the FAFF-1261 PR description; and that meeting it needs one beep-boop list run and one graft run with a holdout scenario after the six writer tickets merge, which FAFF-1261 starts first

### Integration smoke test

```
PROCEDURE smoke():
  1. Build a run dir with a valid genesis and legacy floor files for ISSUE-1
  2. `faff events anchor` into a temp dest -> exit 0, stderr has "warn-only: legacy ISSUE-1"
  3. `faff governance-check --anchor-dir <dest> --json` -> legs.evidence_schema.status "legacy", pass unchanged
  4. In a temp git repo: commit the six writer subjects, then two conforming anchors under run-X-beepboop-list-abc123
     that between them carry every routine file plus spec-review-verdict.json and holdout.json, built from FAFF-1256's
     shipped v0.3 valid examples (no writer ticket needs to have merged), each added by a commit whose subject names its issue
  5. `faff evidence-readiness --since <the FAFF-1260 commit> --json` -> exit 0, ready true, warnings 0
  6. Commit one legacy anchor under the same run; re-run -> exit 1, warnings 1, run not qualifying
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues.
- **What's there:** Three pieces that share one outcome (make the warn-only period visible and its exit measurable): the warn-only call in the mint, the report-only governance-check leg, and `faff evidence-readiness`. All three call one existing validator and change no gate.
- **Why:** Together they are a 2 to 3 day unit, and none ships value alone. A mint warning with no counter leaves FAFF-1261 with an unmeasurable gate, and a counter with no live warning hides the signal during the period.

**Workstream fit?** No issues. A child of FAFF-1255, between the writer slices and enforcement, as the parent's slice order intends.

**Deps surfaced?** No issues.
- **What's there:** It depends on FAFF-1256 for `validateAnchorDir` and blocks FAFF-1261, and both links exist in the tracker. The cutover revision depends on FAFF-1266, FAFF-1267, FAFF-1268, FAFF-1258, FAFF-1259 and FAFF-1260 merging. FAFF-1261 is blocked by all of them except FAFF-1266, which reaches it through FAFF-1268, so that ordering is encoded.

**Risk profile?** One schedule risk, outside the code.
- **What's there:** The criterion needs a beep-boop run after the writers land. The last committed beep-boop anchor is from 2026-09-24, so these runs are occasional.
- **Why:** If nobody starts one, FAFF-1261 waits indefinitely while every mint keeps warning, and the period stops being useful.
- **What to do:** When the last writer slice merges, start one beep-boop list run over a few small Todo issues on purpose, and run `faff evidence-readiness` straight after it.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-6 objections fixed; proving runs owned by FAFF-1270)
