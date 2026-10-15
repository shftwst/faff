# Anchor evidence: CI trust for anchored evidence (base-commit governance-check leg) (FAFF-1278)

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1278.

> Split on 2026-10-14 by product-owner decision from the [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) spec reviewed in rounds 4 to 7. [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) keeps the mint refusal and depends on this ticket.

This spec is for the build agent picking up FAFF-1278 and for its reviewers. It is the CI-trust half of the FAFF-1255 enforcement switch: CI re-validates every new anchor with the base commit's validator, checks that no changed anchor file escapes that check, refuses edits to committed anchors, and code-owner review covers the workflow paths the base commit cannot protect.

## 1. WHY

**The idea the rest depends on.** The governance-check Action extracts the PR's base commit's faff CLI and runs that copy's `faff evidence validate` over the PR's anchors, so a PR cannot weaken the validator, manifest or schemas that judge it. Trusted code also re-discovers the anchors, checks that every changed anchor file was judged, and refuses edits to committed anchors. This ticket ships that leg at a `report` default, so CI judges anchors with trusted code before [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) turns on refusal at mint and flips the default to `require`.

**Problem.** The governance workflow runs entirely from the PR head (`.github/workflows/governance.yml` calls `./.github/actions/governance-check`, whose in-checkout binary is the PR's own `plugin/skills/faff/bin/faff`), so any evidence-schema leg built on head code would trust the code under review. Today that leg is report-only (FAFF-1263) and runs head code.

### Design principles

- **Base-commit code judges PR data.** The CI evidence leg runs the base commit's CLI and bundled schemas. Head-side copies may only add optional fields under the shipped additive rule.
- **Fail closed when the means of checking is missing.** An absent validator, manifest or schema fails the leg; it never reports "nothing to check".
- **CI output carries paths and counts, never violation text.** Same rule FAFF-1263 set for `checkAnchorDir`: the JSONL line validators echo field values in their messages.
- **Report before require.** Schema findings only report until [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) flips the default; integrity findings fail from the start.
- **The merge gate does not move.** `faff merge-gate` and the integrity and merge-floor legs keep routing exactly as today.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/evidence.js` `validateAnchorDir` (~373), `checkAnchorDir` (~435), `classifySchemaChange` (~315), `resolveSchemaSet` (~335), `closedSubschema` (~268), `cmdEvidence` | JS | The validator and additive rule the base leg calls |
| `plugin/skills/faff/bin/lib/governance-check.js` `evaluateAnchorDir` (~262), `evidenceSchemaLeg` (~327), `deriveAnchorDirs` (~350) | JS | CI verb; the report-only leg gains the gating flag; discovery the base leg reuses |
| `.github/actions/governance-check/action.yml` | YAML, bash | Composite Action; gains the base-commit leg |
| `.github/workflows/governance.yml` | YAML | Runs the Action from the PR head with `fetch-depth: 0` |
| `plugin/skills/faff/bin/lib/commissaire-trust.js` (FAFF-1210) | JS | Base-branch trust precedent: read from committed history, never the working tree |
| `plugin/skills/faff/bin/lib/merge-gate.js` `extractRequiredChecks`, `cmdBranchProtectionCheck` | JS | Ruleset reader; gains the code-owner review report |
| `test/faff-924-governance-check-binary-resolution-split.test.mjs`, `test/faff-1047-governance-check-discover-guard.test.mjs` | JS test | Text-extraction harness for Action steps this ticket reuses |

**Scope.** The CI trust half of the FAFF-1255 enforcement switch. It adds no evidence shape and, at its `report` default, fails a PR only on integrity findings.

## Already shipped against this surface

- **FAFF-1256** (#1052): `validateAnchorDir(dir, { bundleDir, candidateDir })` returns `{status: pass|fail|legacy, files[]}` and throws `SchemaUnavailable`; `faff evidence validate` already takes `--require-evidence-schema` (legacy exits 1) and exits 2 on schema-unavailable; torn JSONL tails are skipped with `torn_tail: true`.
- **FAFF-1258** (#1055): the additive rule is built. `classifySchemaChange(base, head)` (allowlist walk; reasons name a pointer, never a value), `resolveSchemaSet` (a changed or unreadable candidate manifest falls back to base for every path; a non-additive or unloadable schema falls back per path), and `faff evidence validate --candidate-schemas <dir>`, reporting `candidate_rejected: [{path, reasons}]` and per-file `schema_source: base|candidate`.
- **FAFF-1263** (#1056): `checkAnchorDir` (never throws, paths and counts only), the post-mint `warnOnEvidenceSchema`, the `report_only` `evidence_schema` leg in `evaluateAnchorDir`, `faff evidence-readiness --since <rev>`, and `test/helpers/evidence-anchor-fixtures.mjs`.
- **FAFF-1262** (#1050): `declaredEffectViolations`, already the `declared-effects.jsonl` line validator in `evidence.js`.

## 2. OUT OF SCOPE

- **Mint refusal, the holdout binding, the v0.3 freeze and switching the default to `require`.** Why: product-owner split on 2026-10-14. Extension point: [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261), which this ticket blocks.
- **Base-commit trust for the integrity, merge-floor and completeness legs.** Why: those legs predate this ticket and run head code today; moving them is a separate trust change. Extension point: the trusted-CLI step added here can run the base `governance-check` too.
- **The Action's fetch-pinned path defect.** It fetches only `bin/faff`, which `require`s `./lib/*`, so it cannot run standalone. Why: pre-existing and tracked as FAFF-1265. Extension point: the "Fetch pinned faff binary" step. This slice reuses that step's output as-is for adopters.
- **Non-additive schema changes and a v0.4 directory.** Why: none is planned; the rule for them is stated, not built. Extension point: `verification/evidence/v0.4/` plus a new bundled copy.
- **Configuring the GitHub ruleset.** Why: repo-settings mutations stay human-only (assert-don't-enforce, `docs/guide/governance-check.md` section 2). This slice ships the CODEOWNERS file, the runbook step and a read-only check.
- **Provenance of evidence bytes.** Schema enforcement checks shape, not who wrote a value; a hand-stamped field that fits the schema passes. Why: the parent puts moving evidence writes to the trusted side of the dispatch cut out of scope, and no gate reads a field added under the additive rule. Extension point: the dispatcher's `EvidenceReturn` persistence; any future gate that reads a new field must bring its own provenance check.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Trusted CLI | The faff CLI whose code judges a PR's anchors in CI: the base commit's copy, or the pinned fetched binary when the repo has no in-checkout faff |
| Candidate schemas | The PR head's `plugin/skills/faff/contracts/evidence-v0.3/` directory, passed to the trusted CLI as `--candidate-schemas` |
| Additive change | A head schema that `classifySchemaChange` (FAFF-1258) reports `additive: true` against the base schema |

### `faff evidence capabilities`

`faff evidence validate <anchor-dir> [--require-evidence-schema] [--json] [--candidate-schemas DIR]` is shipped. This ticket adds one subcommand:

```
faff evidence capabilities --json
```

It prints `{ "validate": ["require-evidence-schema", "candidate-schemas"] }` and exits 0. [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) adds `"holdout-binding"` when it adds the binding check. The Action uses the list to detect what a base CLI can do.

**Chosen:** detect the base CLI's abilities through `capabilities` instead of probing flags. An unknown flag exits 2, the same code as `schema-unavailable`, so the two would be indistinguishable. A base CLI without `capabilities` (every commit before this slice, including today's `main`, which already has `--candidate-schemas`) is treated as having no listed capability, which for `candidate-schemas` is the stricter direction (base schemas only). Under `evidence-schema: require`, when a validated anchor holds `holdout.json` and the base lacks `holdout-binding`, the step writes a `::warning::` and a summary note, `holdout binding not checked: base CLI predates FAFF-1261`. That only arises on [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261)'s own PR, and the mint still enforces the binding there.

### Additive rule

The rule is FAFF-1258's `classifySchemaChange` and `resolveSchemaSet`, used unchanged with one tightening:

**Chosen:** `closedSubschema` also requires an `items` sub-schema on every node whose type includes `"array"`. Today a new optional property `{ "type": "array" }` with no `items` classifies as closed, which would let a head schema add an unconstrained array channel that the base leg then accepts. The tightening only moves more changes to the base schema.

Candidate status in CI output is derived from the report: `n/a` when no candidate was offered (the report has no `candidate_rejected` key), `accepted` when `candidate_rejected` is empty, `rejected` when it holds the manifest entry (`anchor-manifest.json`, "manifest differs"), else `partial`. Every candidate fault selects the base schema; none fails the check on its own. A PR that adds a field to a JSON evidence document and its writer passes; a PR that relaxes a rule is judged by the base schema and its anchor fails if it relied on the relaxation.

**Chosen:** the in-place additive path covers the ten JSON anchor files only. For `events.jsonl` and `declared-effects.jsonl`, two things block it:

- the line validators (`eventViolations`, `declaredEffectViolations`) are base code, which a candidate cannot replace;
- FAFF-1260's per-type payload schemas sit inside `discriminator` mappings, and `classifySchemaChange` reports any change there as non-additive.

So a JSONL record change (a new event type, effect kind, payload field or enum value) never takes the candidate path. It lands in place in schema-first, writer-second order, with the line-validator change in the first PR. [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) writes that rule into `verification/evidence/README.md` when it freezes v0.3.

### governance-check flag

`faff governance-check` gains `--require-evidence-schema`. With it, `evidenceSchemaLeg` returns `report_only: false` with `pass: status === "pass"` (so `legacy`, `fail` and `error` all fail), `evaluateAnchorDir` sets `pass = integrity.pass && merge_floor.pass && evidence_schema.pass`, and a failing leg adds a `reasons` line and an annotation like the other legs. Without the flag, behaviour is FAFF-1263's (report-only). The Action passes the flag only under `evidence-schema: require`. The leg exists only for anchors (`evaluateAnchorDir`); run-dir evaluation has no evidence-schema leg, and the Action's existing anchor-missing step already covers a PR that carries a run dir without an anchor.

### Action changes

New input:

| Input | Default | Meaning |
|---|---|---|
| `evidence-schema` | `report` | Two values. `require` passes `--require-evidence-schema` and fails on the base-commit leg. `report` runs both and never fails on schema findings. Integrity findings (below) fail under either value |

**Chosen:** the input defaults to `report` in this ticket. Committed anchors on `main` are still `legacy` until the writers ship, so `require` now would fail every anchor-carrying PR. [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) flips the default to `require` behind its pre-switch gate. Integrity findings fail from day one, since they flag tampering or a broken check, not writer lag.

A new step, `anchors-touched`, runs before "Discover carried anchor dirs" and invokes no faff binary. It outputs `touched=true|false|error`: `error` when `git diff --name-only "$BASE_SHA" "$HEAD_SHA" -- "$ANCHORS_PATH"` itself exits non-zero (the existing discovery step swallows that with `|| true`), otherwise whether it printed anything. Keeping it in its own step means a crashing head binary in the discovery step cannot stop it being written. Two new steps run **after** "Run governance-check", each gated `if: ${{ !cancelled() && steps.anchors-touched.outputs.touched != 'false' }}`, so they run even when the head verb failed or found nothing:

```
STEP resolve-trusted-cli:
  1. IF check-binary.in-checkout == true:
       PLUGIN := "plugin/skills/faff"                                  # constant in action.yml, never derived from an input
       IF `git cat-file -e "$BASE_SHA:$PLUGIN/bin/faff"` fails:
         output unavailable=true                                       # evidence-validator-unavailable
       ELSE:
         mkdir "$RUNNER_TEMP/faff-base"
         git archive "$BASE_SHA" -- "$PLUGIN" | tar -x -C "$RUNNER_TEMP/faff-base"
         TRUSTED := "$RUNNER_TEMP/faff-base/$PLUGIN/bin/faff"
         CANDIDATE := "$GITHUB_WORKSPACE/$PLUGIN/contracts/evidence-v0.3"   # head copy, data only, absolute
     ELSE:
       TRUSTED := steps.fetch-pinned.outputs.bin; CANDIDATE := ""      # pinned ref, not PR-controlled
  2. caps := `run_trusted evidence capabilities --json` (non-zero -> caps = {})
     IF caps.validate lacks "candidate-schemas": CANDIDATE := ""       # stricter: base schemas only
  3. output trusted, candidate; exit 0

STEP evidence-schema-base:
  0. IF touched == error: integrity_fail "anchor-discovery-failed: git diff exited non-zero"
  1. IF resolve-trusted-cli.unavailable: integrity_fail "evidence-validator-unavailable: base commit has no faff CLI"
  2. ELSE DIRS := git diff --name-only "$BASE_SHA" "$HEAD_SHA" -- "$ANCHORS_PATH"
                  | run_trusted governance-check --derive-anchor-dirs "$GITHUB_WORKSPACE/$ANCHORS_PATH"
     (changed paths are prefixed with "$GITHUB_WORKSPACE/" before piping, so the absolute anchors path matches)
     derive exits non-zero -> integrity_fail "anchor-discovery-failed"   # never an empty, vacuous pass
     # discovery re-run with trusted code, so a PR cannot hide an anchor from this leg
  2a. Coverage: FOR each NUL-separated path of `git diff -z --name-only --diff-filter=AM "$BASE_SHA" "$HEAD_SHA" -- "$ANCHORS_PATH"`
      (paths present in head; -z, so no quoting or newline splitting) that, once prefixed with "$GITHUB_WORKSPACE/",
      does not sit under one of DIRS:
        integrity_fail "anchor-path-unvalidated <sanitised path>"
      # a path the derive dropped (traversal, too shallow, symlink escape) or silently skipped (unstat-able,
      # quoted name) can never land unjudged. One exemption: a file named exactly summary.md at
      # <anchors>/<run>/summary.md, the run-level summary `anchor-run` writes; no leg reads it.
      Also, any changed anchors-path entry whose git mode is 120000 (symlink), from `git diff -z --raw`:
        integrity_fail "anchor-path-unvalidated <sanitised path>"   # validate would read through it
  2b. Immutability: MB := `git merge-base "$BASE_SHA" "$HEAD_SHA"`;
      FOR each record of `git diff -z --name-status --no-renames "$MB" "$HEAD_SHA" -- "$ANCHORS_PATH"`
        with status other than A: integrity_fail "anchor-immutable <path>"   # a committed anchor file was modified or deleted
        with status A whose <anchors>/<run>/<issue> dir already exists at MB: integrity_fail "anchor-immutable <path>"
        # a file added to a committed anchor changes its evidence set
  3. FOR each dir d (already absolute, as the trusted derive printed it): run_trusted evidence validate "$d" --require-evidence-schema --json
                       [--candidate-schemas "$CANDIDATE"]  > "$RUNNER_TEMP/faff-evidence/<n>.json" 2> /dev/null
     # captured to a file, never echoed: the report holds violation text that can carry field values
     exit 0 -> ok; any other exit (including 2, schema-unavailable) -> fail
  4. Append a "### Evidence schema (base commit <short sha>)" section to $GITHUB_STEP_SUMMARY:
     one row per dir with status, failing file paths and statuses, and candidate status; never violation text
  5. output evidence_result = pass | fail (what the validator found, in every mode);
     ::error:: per failing dir under require, ::warning:: under report
  6. output verdict = fail when any integrity_fail was raised (every mode), or when evidence_result = fail
     AND inputs.evidence-schema == require; else pass. Exit 1 when verdict = fail, else exit 0
  # the step runs under `set -euo pipefail` with an ERR/EXIT trap that writes verdict=fail unless
  # step 6 has already written pass, so an unexpected fault never leaves the output empty
```

`integrity_fail` findings (`anchor-discovery-failed`, `anchor-path-unvalidated`, `anchor-immutable`, `evidence-validator-unavailable`) fail the step in every mode: `report` relaxes only schema findings, which is what adopters roll out, never tampering or a broken check.

`run_trusted` runs `node "$TRUSTED" …` with `cwd` set to an empty directory under `$RUNNER_TEMP` and `env -i PATH="$PATH" HOME="$RUNNER_TEMP/faff-home"`, so no config file, `FAFF_*` variable or `findRoot()` walk from the PR checkout can reach the trusted code. Every path argument is absolute. The step captures each report to a file under `$RUNNER_TEMP` and its stderr to `/dev/null`, never letting either reach the job log, and reads only `status`, `files[].path`, `files[].status` and `candidate_rejected[].path` from the file, sanitising each path as `sanitiseDisplay` does before printing. The report file is deleted at the end of the step and never uploaded as an artifact. This keeps the CI log under the same paths-and-counts rule as the mint and the head verb. Every PR-derived string the step prints, anchor dir names in `::error::`/`::warning::` lines and summary rows included, goes through one shell function that applies `sanitiseDisplay`'s rules (control characters to a space, `::` to `: :`) and escapes `|` for the summary table. The report files are deleted by the same ERR/EXIT trap that pins `verdict`, so a fault does not leave them on the runner.

**Chosen:** the Action enforces committed-anchor immutability in the same step. The CI leg's premise is that every anchor in a PR diff is new; a PR that edits or deletes a file of an anchor already on the base branch breaks that premise and would otherwise pass (a deleted dir is skipped by discovery). The merge-base diff ignores base-branch commits made after the PR forked.

"Run governance-check" adds `--require-evidence-schema` when `inputs.evidence-schema == 'require'`.

**Chosen:** the Action's `verdict` output fails closed on the base leg. It is today's expression only when the base leg is positively clean, and `fail` otherwise:

```
(steps.anchors-touched.outputs.touched == 'false'
  || (steps.evidence-schema-base.outcome == 'success' && steps.evidence-schema-base.outputs.verdict == 'pass'))
  && <today's expression> || 'fail'
```

A base step that errors, is cancelled, or ends without writing `verdict` therefore fails the Action, never falls back to the head verb's result. Under `report` a schema-only finding leaves the base `verdict` at `pass`, so the job result and `verdict` always agree; the finding stays visible in `evidence_result`, the summary and the warning annotation. A new Action output `evidence-result` exposes it.

**Chosen:** the base extraction path is a constant in `action.yml`, not derived from the `faff-binary` input, so changing where the trusted CLI comes from requires editing `.github/`, which code-owner review covers.

**Chosen:** extract the base CLI with `git archive "$BASE_SHA" -- plugin/skills/faff`. The workflow already fetches full history (`fetch-depth: 0`), `git archive` reads the object store like FAFF-1210's `git show` reader, needs no token, registers no worktree and runs no hooks, and the CLI resolves its bundled schemas from its own path (`BUNDLE_DIR` relative to `HERE`), so the extracted subtree is self-sufficient. The committed `.js` emit is what runs, so no build step is needed. The repo has no `.gitattributes`, so no `export-ignore` can drop files today; a test pins that.

**Chosen:** the base-commit steps run after the head verb under `!cancelled()` and fail on their own. Gating them on the head verb, or folding their verdict into its step, would let a PR that empties head discovery skip both.

**Chosen:** the trusted CLI re-derives anchor dirs, and the steps are gated on a shell-computed `touched` flag. The existing discovery step runs the head binary's `--derive-anchor-dirs`, which a PR could change to return nothing.

**Chosen:** every changed anchors-path file present in head must sit inside a validated dir (step 2a), or the leg fails. `deriveAnchorDirs` drops traversal, too-shallow and symlink-escaping paths with only a stderr warning, and silently skips a dir it cannot stat, which includes a quoted non-ASCII name from `git diff --name-only`. Without the coverage check, a PR could place an anchor where discovery never looks and the leg would pass over an empty set.

**Chosen:** when the head binary exists but the base commit has none, the leg fails (`evidence-validator-unavailable`). That case is a PR that introduces faff's CLI itself, and there is no trusted code to run.

**What the base commit cannot cover.** GitHub runs the workflow and the composite Action from the PR head, so a PR that edits `.github/` can skip or rewrite these steps, the `touched` computation, and the `faff-binary` input it passes. That is held by required code-owner review, below, stated as the limit. The limit is only real when the ruleset enforces code-owner review, so the pre-switch gate in [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) requires `branch-protection-check` to show it active on main before `require` becomes the default.

### CODEOWNERS

```
# .github/CODEOWNERS
/.github/        <owners>
/verification/   <owners>
```

**Assumes:** the owners are the repository's human admin accounts, read at build time with `gh api repos/shftwst/faff/collaborators --jq '.[] | select(.permissions.admin) | .login'`, excluding the runner identity configured by FAFF-1213. The runner must never be a code owner, or it could approve its own workflow edits.

**Chosen:** `.faff/anchors/` is not a code-owned path, although the FAFF-1263 spec mentions it as a possible narrowing. Every graft PR carries an anchor, so owning that path would require human review on every PR and stop unattended merges, which the parent design never asked for. The base-commit leg plus the immutability check already cover anchor content; FAFF-1263 records the hand-written-anchor case as an accepted risk.

`faff branch-protection-check` reports, from the same ruleset `pull_request` rule it already reads, `code_owner_review: true | false | null` (`require_code_owner_review`; `null` when no `pull_request` rule). Text output appends `code-owner review: required | not required`. The runbook in `docs/guide/governance-check.md` section 2 gains a step: enable "Require review from Code Owners" on the "Main" ruleset, then confirm with `faff branch-protection-check`.

**Chosen:** report the setting, never set it. Same assert-don't-enforce posture as the required-check runbook.

## 4. HOW

### Build order

1. **Spike (scratch branches, not merged).** Push a scratch base branch carrying this ticket's CLI (so `evidence capabilities` exists on the base), then open a throwaway PR against that scratch base carrying one conforming and one broken anchor, with `evidence-schema: require` set on the scratch workflow. Confirm from the job log that the base steps run after a failing head verb under `!cancelled()`, that the `git archive` extraction runs `evidence validate`, that the conforming anchor passes and the broken one fails, and that the verdict is `fail`. Add a third throwaway PR against a scratch base whose `evidence validate` is patched to exit 139 before the step writes `verdict`, and confirm the Action `verdict` is `fail`. Record the run URLs in the PR body. If any behaviour differs, stop and report on FAFF-1278.
2. **Build:** `capabilities`, the `closedSubschema` array tightening, `--require-evidence-schema` on governance-check, the Action steps and input (default `report`), CODEOWNERS, the `branch-protection-check` report, docs.

### Edge cases

- **PR deletes or edits an anchor already on the base branch:** discovery skips a deleted dir as today, and the immutability check fails the PR with `anchor-immutable`.
- **Base branch gained anchors after the PR forked:** whether or not the two-dot `BASE_SHA..HEAD_SHA` diff lists them (that depends on which base sha the event carries), they are absent from the head checkout, so `deriveAnchorDirs` skips them and the coverage check's `--diff-filter=AM` excludes them, and the merge-base immutability diff does not list them. They are not judged as the PR's data.
- **Base CLI predates `capabilities`:** the leg runs base schemas only and checks no holdout binding (warned, see above); a PR adding an optional field and its writer fails until this ticket is on the base. Only FAFF-1278's own PR can hit this, and its anchor uses no new field.
- **Run-level anchors from `anchor-run` (git-only mode):** they live under the same anchors root, so a PR that carries them is judged like any anchor; the run-level `summary.md` is exempt from the coverage check. `anchor-run` byte-copies the run's evidence, so its anchors pass once the writers ship. A git-only adopter whose run straddles the upgrade sets `evidence-schema: report` until its run-level anchors validate; integrity findings still fail. In this repo, tracker-backed runs never mint run-level anchors.
- **Evidence defect found after merge:** an anchor on the base branch is immutable, so a correction needs a new build run, which mints a new `<run>/<issue>` anchor beside the old one. The runbook in `docs/guide/governance-check.md` states this.
- **Fetch-pinned path (adopter):** the trusted CLI is the pinned binary; candidate schemas are never offered. The single-file fetch defect (FAFF-1265) means this path fails today and keeps failing until FAFF-1265 lands.
- **`evidence-schema: report`:** both legs run and summarise; schema findings do not change the exit code, while `integrity_fail` findings still fail it.

### Failure modes

- **The additive rule is too strict for a real change.** How you'd know: a PR that only adds an optional field shows `candidate: partial` with a `candidate_rejected` entry for that schema. What it means: proceed; land the schema change in its own PR first (no anchor), then the writer. A new anchor file follows the same path: its manifest entry and schema land in an anchor-free PR, since any manifest change rejects the candidate wholesale.
- **A PR's own anchor uses a JSONL shape or vocabulary only the PR adds.** The base line validators (`eventViolations`, `declaredEffectViolations`) and enum-bearing schemas know only the base vocabulary, and widening an enum is non-additive. Anchors are minted by the installed CLI (the `~/.claude/skills/faff` copy or the repo's linked checkout), not the feature branch's code, so normally a PR adding an event type or effect kind carries anchors with only old types. How you'd know: a PR adding a type or a record field fails the base leg on an `events.jsonl` or `declared-effects.jsonl` line. What it means: proceed; land the vocabulary or field in a PR whose build run does not emit it, then use it. An installed CLI newer than both base and head (a local install ahead of `main`) fails the same way; the remedy is to re-run the build with an install that matches `main`. This is a standing sequencing rule, which [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) writes into `verification/evidence/README.md`.
- **`git archive` misses a file the CLI needs at runtime.** How you'd know: the base leg exits 2 with a `require` error on a PR that changed nothing under `plugin/`. What it means: block; fix the extraction path before relying on the leg. The integration test runs the extracted CLI end to end.
- **Code-owner review is not enabled in the ruleset.** How you'd know: `faff branch-protection-check` prints `code-owner review: not required`. What it means: the stated limit is open; the human runbook step closes it.

## Scenarios

```
Given a PR whose head edits plugin/skills/faff/contracts/evidence-v0.3/schema/review-verdict-anchored.schema.json to drop "additionalProperties": false, and whose anchor's review-verdict.json carries an extra key
When the governance-check Action runs with evidence-schema: require
And the base commit already includes this ticket
Then the base-commit leg reports candidate "partial" with review-verdict-anchored.schema.json in candidate_rejected, fails the anchor against the base schema, and the job exits non-zero, while `faff governance-check --require-evidence-schema` run with the head binary on the same anchor exits 0
```

```
Given a PR whose head adds an optional typed closed property "notes" to run-ledger.schema.json (bundled and verification copies) and whose anchor carries it (as an installed CLI ahead of the base would mint)
When the governance-check Action runs on a base that already includes this ticket
Then the base-commit leg reports candidate "accepted" and passes
```

```
Given a PR whose head changes governance-check --derive-anchor-dirs to print nothing
When the Action runs on a PR carrying a non-conforming anchor
Then the base-commit leg still discovers the anchor through the base CLI and fails it
```

```
Given the same non-conforming anchor as the first Scenario and the Action input evidence-schema: report
When the governance-check Action runs
Then the base step exits 0 with verdict pass and evidence_result fail, a ::warning:: names the anchor dir, and the Action verdict equals the head verb's
```

```
Given a base step whose trusted CLI is stubbed to crash before the step writes its verdict output
When the governance-check Action runs under either evidence-schema mode
Then the Action verdict is fail
```

- No base-leg summary row, annotation or governance-check leg detail contains violation text or a field value from an evidence file.

## 6. DESIGN DECISION RATIONALE

- **How does CI obtain base-commit code?** Options: a second `actions/checkout` (needs a token, PR-controlled step either way), `git worktree add` (registers a worktree, runs checkout machinery), `git archive` of the plugin subtree. **Chosen:** `git archive` from the already-fetched history.
- **Where does the base-commit leg live: inside `governance-check` or a separate step?** Putting a subprocess in `governance-check.js` breaks its "no subprocess except git rev-parse" posture. **Chosen:** separate Action steps after the head verb, under `!cancelled()`, failing on their own.
- **Who discovers the anchors for the base leg?** The head binary is PR-controlled. **Chosen:** a shell `touched` flag gates the steps and the trusted CLI re-derives the dirs.
- **How does the base CLI learn of additive head changes?** FAFF-1258 built it. **Chosen:** the shipped `--candidate-schemas` and `classifySchemaChange`, with arrays required to declare `items`; JSON documents only, since JSONL shapes are judged by base code.
- **What does a base-step fault do to the Action verdict?** Overriding only on a literal `fail` lets a missing output fall back to head code. **Chosen:** fail closed unless the base leg is positively clean.
- **How is a base CLI without the slice detected?** Exit codes collide with `schema-unavailable`. **Chosen:** `faff evidence capabilities --json`.
- **Base has no CLI but head does?** **Chosen:** fail closed (`evidence-validator-unavailable`).
- **Code-own `.faff/anchors/`?** It would put a human review on every PR. **Chosen:** no; `.github/` and `verification/` only.
- **Set the code-owner rule or report it?** **Chosen:** report via `branch-protection-check`; the human sets it.
- **Default `report` or `require`?** `require` now would fail every PR whose anchor is still `legacy`. **Chosen:** `report` here; [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261) flips it behind its pre-switch gate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** the code owners are the repository's human admin accounts, excluding the FAFF-1213 runner identity. Validation: the `gh api` query in the CODEOWNERS section returns at least one login that is not the runner.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] `faff merge-gate` routes identically on `test/merge-gate-local.test.mjs` and `test/holdout-*.test.mjs` with no fixture edits

### From WHAT (capabilities, CI flag, additive rule)
- [ ] `faff evidence capabilities --json` prints the documented object
- [ ] The `classifySchemaChange` table in `test/evidence-validate.test.mjs` gains: a new optional `{ "type": "array" }` property with no `items` is non-additive; one with closed typed `items` is additive; existing rows pass unedited
- [ ] `governance-check --require-evidence-schema` fails a legacy anchor, an anchor with an invalid file and a validator error, with a `reasons` line; without the flag the result equals FAFF-1263's (leg `report_only: true`, `pass` unchanged)

### From WHAT (Action)
- [ ] A structural test in the FAFF-924 style asserts the `anchors-touched` step sits before discovery and runs no faff binary, and the two new steps sit after `governance-check` and are gated on `!cancelled() && steps.anchors-touched.outputs.touched != 'false'`
- [ ] A test extracts the `resolve-trusted-cli` and `evidence-schema-base` bodies (FAFF-1047 style) and runs them against a temp git repo with base and head commits: base lacking the CLI gives `evidence-validator-unavailable`; base lacking `capabilities` runs without `--candidate-schemas`; a hidden anchor (head discovery stubbed empty) is still found
- [ ] With no `evidence-schema` input the Action runs as `report`; "Run governance-check" passes `--require-evidence-schema` only under `evidence-schema: require`; under `require` a failing base leg gives step exit 1, step `verdict=fail` and Action `verdict=fail`; under `report` the same anchor gives step exit 0, step `verdict=pass`, `evidence_result=fail` and Action `verdict` equal to the head verb's
- [ ] The repo has no `.gitattributes` `export-ignore` under `plugin/skills/faff/` (test asserts)
- [ ] The base extraction path is the literal `plugin/skills/faff` in `action.yml` and no `run_trusted` call reads `inputs.faff-binary` (structural test)
- [ ] For an anchor whose `events.jsonl` `type` holds `S3CR3T-SENTINEL`, the base step's captured stdout and stderr (the job log) never contain it
- [ ] A PR that adds a new file inside an anchor dir present at the merge base fails with `anchor-immutable <path>`
- [ ] `run_trusted` runs with an empty `cwd` and `env -i`; the harness test places a `.faffrc.yaml` and `FAFF_*` variables in the PR checkout and shows the base leg's result unchanged
- [ ] A PR that modifies or deletes a file of an anchor present at the merge base fails with `anchor-immutable <path>` under both `require` and `report`; a PR whose base branch gained anchors after the fork does not
- [ ] A `git diff` that fails (the harness passes a `BASE_SHA` absent from the temp repo) sets `touched=error` and the base step fails with `anchor-discovery-failed` in both modes; a non-zero trusted `--derive-anchor-dirs` does the same
- [ ] A structural test pins the Action `verdict` output expression to the fail-closed form in Action changes; the spike's crash case (build step 1) shows `verdict=fail` on the runner; the report-mode Scenario passes through the harness
- [ ] A harness case with a changed anchors file whose path is too shallow, traverses, escapes by symlink, or has a quoted non-ASCII directory name fails with `anchor-path-unvalidated` under both modes
- [ ] Under `require`, a base CLI without `holdout-binding` and an anchor holding `holdout.json` produces the `holdout binding not checked` warning and summary note
- [ ] A run-level `<anchors>/<run>/summary.md` passes the coverage check; a symlink committed inside a new anchor dir fails with `anchor-path-unvalidated`
- [ ] An anchor dir whose name contains `::`, a newline-free control character or `|` produces annotations and summary rows with those characters neutralised (harness test)
- [ ] `--candidate-schemas` and every `evidence validate` dir argument are absolute in the harness test, Scenarios 3 and 4 report `partial` and `accepted`, and a run with no candidate offered reports `n/a`
- [ ] `test/faff-924-…` and `test/faff-1047-…` pass unedited

### From WHAT (CODEOWNERS and ruleset)
- [ ] `.github/CODEOWNERS` lists `/.github/` and `/verification/` with human owners only; a test asserts the runner login (`runner_github_login` in the automation config block that `readRunnerGhConfig` reads, FAFF-1213) does not appear
- [ ] `extractRequiredChecks` reports `code_owner_review` from the ruleset `pull_request` rule; selftest rows for true, false and no rule
- [ ] `docs/guide/governance-check.md` section 2 has the code-owner runbook step and documents the base-commit leg and `evidence-schema` input; `docs/guide/cli.md` documents `evidence capabilities` and `governance-check --require-evidence-schema`

### From HOW
- [ ] The PR body links the spike runs and states that every runner behaviour held
- [ ] The Scenarios pass through the Action-body test harness against a temp repo whose base commit carries this ticket's CLI

### Integration smoke test

```
PROCEDURE smoke():
  1. Build a temp git repo: commit A copies plugin/skills/faff from this branch; commit B adds a
     conforming anchor under .faff/anchors/run-x/FAFF-1/ (from the bundled valid examples)
  2. Run the extracted resolve-trusted-cli + evidence-schema-base bodies with BASE_SHA=A, HEAD_SHA=B
     under evidence-schema: require -> verdict pass
  3. Commit C edits B's review-verdict.json to drop schema_version and loosens the head schema
     -> base leg verdict fail, candidate partial; under report -> verdict pass, evidence_result fail
  4. Commit D modifies a file of B's anchor -> anchor-immutable under both modes
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** It now fits one unit. It is the CI-trust half of the reviewed FAFF-1261 spec, split by product-owner decision. The largest single piece is the `evidence-schema-base` Action step and its harness tests.

**Workstream fit?** No issues. FAFF-1278 sits under FAFF-1255 with its siblings.

**Deps surfaced?** No issues.
- It depends only on shipped work (FAFF-1256, FAFF-1258, FAFF-1263).
- It blocks [FAFF-1261](https://linear.app/shftwst/issue/FAFF-1261), which flips the Action default to `require`.

**Risk profile?**
- **What's there:** The riskiest unknowns are in the GitHub runner: whether composite-step `if: !cancelled()` behaves as expected, and whether a `git archive` extraction of `plugin/skills/faff` runs standalone. Local harness tests cannot observe either.
- **What to do:** Keep the scratch-branch spike as build step 1.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; split by product owner from FAFF-1261 round-7 spec, not re-reviewed)
