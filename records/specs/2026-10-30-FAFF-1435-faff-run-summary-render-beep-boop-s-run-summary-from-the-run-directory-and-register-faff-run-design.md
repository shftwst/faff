_Agent-written (Claude Code), FAFF-1435 prep at the operator's request. Revised 2026-10-29 — facts narrowed by source, operator decision. Round-7 findings fixed and reviewed in round 8 (2026-10-30); round-8 findings fixed and reviewed in round 9 (2026-10-30); round-9 findings fixed in place. Accepted by the operator 2026-10-30 (human accept after round 9)._

# FAFF-1435: faff run summary — render beep-boop's run summary from the run directory, and register faff run

> Spec: faffter-dark-nlspec · 2026-10-29 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1435.

This spec is for the build agent and its reviewers. It is slice A of the FAFF-1413 re-slice, and covers `faff run summary` plus the `faff run` dispatcher that slices B (FAFF-1436) and C (FAFF-1437) extend. It was reworked on 2026-10-29 around the operator's design decision in §3.

## 1. WHY

**The load-bearing idea:** a run summary is computed from the run directory, the repo config, the install (`faff doctor`) and the forge (GitHub, through merge-gate's own `gh` path). Only two kinds of input come from the orchestrator: tracker reads, which faff's CLI never makes, and in-run judgements not yet recorded anywhere. Every line built from those is labelled as reported by the orchestrator, so computed and reported are visibly different.

**Problem.** Reporting §1 of `faff-beep-boop/SKILL.md` (l. 581–721 on `origin/main` `bfe1cbd6`) is the largest deterministic block in beep-boop, and it is read on every turn of every drain. The 2026-10-27 grading put 30 Fly drains at $1,170, and 21 drains that admitted nothing still cost $144. Its render rules are enforced nowhere but prose. A first design that had the orchestrator transcribe command outputs into the facts file failed five review rounds: transcription drift and binary skew were the recurring findings.

### Design principles

**Compute, don't transcribe.** If the run dir or config holds it, the command reads it through the owning module's own function. No command output is ever copied through the facts file.

**No faff shell-out.** Every faff computation is an in-process library call. The command spawns no `faff` subprocess and resolves nothing from `PATH`. The one external process is `gh`, run through `merge-gate-gh`'s `ghJson` exactly as merge-gate runs it, with the same runner credential resolution and no new credential.

**Never fail the summary on an input.** A missing, unreadable or malformed facts file renders a visible `could not read facts` line at exit 0. A failed doctor or forge read renders a visible `could not read <source>: <reason>` line at exit 0. A missing single fact degrades to the bare id.

**Reported lines are labelled.** Every rendered markdown line whose content comes from the facts file ends with ` _(reported)_`. A section built only from facts carries the label on its heading. The one exemption is the inside of the `faff-parks` fence, which must stay byte-exact JSON for `park-history.js`. Its section heading (`## Parked`) carries the label instead.

**Never invent a bucket, never let data become structure.** The section list is fixed, and every facts string is neutralised (4.3), so no value can create a heading, fence or list item.

### Reference context

| System | Relevance |
|---|---|
| `faff-beep-boop/SKILL.md` "Reporting" §1 (l. 581–721) | The template and rules replaced. |
| `bin/lib/reconcile.js` (governance) | `reconcileCore(input)`, and `validateReconcileInput`, to be exported. |
| `bin/lib/budget.js` (governance) | `envelopeFromLedger`, `measureRunSpend`, `computeBudgetState`; the `budget check` composition inside `cmdBudget` (l. 901), to be extracted. |
| `bin/lib/economics.js` (factory) | `computeUnitEconomics(ledger, opts)`; the opts resolution inside `cmdEconomics` (l. 1202), to be extracted. |
| `bin/lib/shared-infra.js` | `readLedger`. |
| `bin/lib/events.js` | `parseJsonlEntries` and the event record shape. |
| `bin/lib/heartbeat.js` | `readHeartbeatFile` (the `<run-dir>/heartbeat` sidecar). |
| `bin/lib/holdout-record.js` | `HOLDOUT_REASON_CODES`. |
| `bin/lib/park-history.js` | The `faff-parks` block parser (the repeat-park counting seam). |
| `bin/lib/config.js` | `loadConfig`, for `slots.methodology`. |
| `bin/lib/gates-doctor.js` (factory) | `resolveDoctorScanSet`, `gatherDoctorState`, `buildDoctorJson`: the install-health result `faff doctor` reports. |
| `bin/lib/merge-gate-gh.js` | `ghJson` and `resolveRunnerGhEnv`: merge-gate's forge path. |
| `bin/lib/merge-gate-floor.js` | `<run-dir>/<ISSUE>/merge-record.json`, the recorded merge (`head_sha`, PR). |
| `<run-dir>/sibling-baseline.json` | The run-start sibling snapshot reconcile's baseline check reads. |
| `contracts/evidence-v0.3/schema/run-ledger.schema.json` | The ledger schema. |
| `bin/lib/land.js` (FAFF-1396) | The pattern for a factory command with injected `deps`. |
| `tsconfig.json`, `validate.yml` stale-emit step, `scripts/check-no-boundary-cast.mjs` with `test/check-no-boundary-cast.test.mjs` | The TypeScript pipeline (ADR-0132). |

**Scope.** This is the first verb of `faff run`, in the factory region. Factory→governance requires are legal. It adds no Commissaire surface.

### Already shipped against this surface

`faff economics`, `faff budget check` and `faff reconcile` compute the figures today, but only behind their CLIs. Nothing renders the summary. The premise holds.

## 2. OUT OF SCOPE

- **`faff run checkpoint` and `open`/`close`.** These are FAFF-1436 and FAFF-1437. Extension point: `run.ts`'s verb table.
- **Reporting §2 (tracker post) and §3 (in-conversation print).** The skill posts and prints what `run summary` returns.
- **The `rendering_adaptor` normalise pass.** The skill still routes the output through it.
- **Tracker reads.** faff's CLI never calls the tracker, so tracker observations stay a fact (`facts.tracker`).
- **Recording in-run judgements as events.** That is FAFF-1439, after which each `facts.run` key moves to computed.
- **Behaviour changes to `faff economics`, `budget check` or `reconcile`.** The extractions are refactors; each CLI's output stays byte-identical.

## 3. WHAT

### The operator's design decision

**Chosen:** (ratified: human) `faff run summary` computes everything it can itself. It calls reconcile, budget check and economics as in-process library functions (no shell-out, no `PATH` resolution), and reads the run ledger and events directly, against the shapes their owning modules define. Only facts that exist nowhere on disk come from the orchestrator's facts file, and a missing or malformed facts file never fails the render. Nothing is embedded verbatim from another command's output.

Operator's words, 2026-10-29: "4 y", accepting option 4 (compute in-process, enumerate the facts) in the coordinator's question.

### Interface

```
faff run summary --run-dir DIR [--facts FILE] [--root DIR] [--session-id ID] [--out FILE]
faff run <unknown-verb>   → exit 2, usage lists the registered verbs (summary only, in this slice)
```

- `--root` / `--session-id` default to `ledger.budget.measure_root` / `ledger.budget.measure_session_id`, and are passed to the economics and budget library calls.
- Writes `<run-dir>/summary.md` (or `--out`) atomically and prints the same bytes.
- **Exit codes:** 0 rendered (including with facts problems); 2 usage, or a ledger that is unparseable or missing a core field (`owner.started_at`, `admitted`, `outcomes`). Without those there is nothing to summarise.

### What is computed, and from where

| Section input | Source on disk | Owner and function |
|---|---|---|
| Outcomes, admitted, annotation arrays, `stop_reason`, `level`, `discovered_scope_filed`, budget envelope | `run-ledger.json` | `shared-infra` `readLedger`; field names per the v0.3 run-ledger schema |
| Mode | the run id (`run-…-beepboop-<mode>-<entropy>`) | `run-ledger.js` naming |
| Methodology skill | repo config `slots.methodology` | `config.js` `loadConfig` |
| Sentry checkpoint count and max intervention | `events.jsonl` `sentry-checkpoint` records, `data.intervention` | `events.js` `parseJsonlEntries` |
| Duration endpoint | newest of `<run-dir>/heartbeat`, `owner.last_heartbeat` and the last event's `ts` | `heartbeat.js` `readHeartbeatFile` |
| Unit economics | transcripts and ledger | `economics.js` `economicsForRun()` (extracted, below) |
| Budget state (for `tokens_source` on Unreached) | ledger and transcripts | `budget.js` `budgetCheckForRun()` (extracted, below) |
| Install health | the install itself | `gates-doctor.js`: `gatherDoctorState(resolveDoctorScanSet(…))` then `buildDoctorJson`, in-process |
| PR numbers | `<run-dir>/<ISSUE>/merge-record.json`, then `<run-dir>/<ISSUE>/landing-loop.json` (`pr`); else the forge | disk; then `ghJson(["pr","list","--search","<ISSUE> in:title","--state","all","--json","number,headRefName"])`, accepting only a head branch that starts with the lower-cased issue id |
| Ground-truth divergences | a ReconcileInput assembled by the command, then `reconcileCore` | `reconcile.js` (export `validateReconcileInput`); assembly below |
| Superseded delivering ids | `<run-dir>/<ISSUE>/supersession.json` `superseded_by` | graft's supersession record (`faff-graft` Step 3, item 6) |
| Holdout environment-gap split | `.faff/holdout/<run-id>.json` `needs_human_reasons` | `holdout-record.js` `HOLDOUT_REASON_CODES` |

**ReconcileInput assembly:**
- `level` comes from `ledger.level`.
- `shipped[]`: each `shipped` outcome. Its `recorded` is that issue's `merge-record.json`. Its `observed` (`pr_merged`, `merged_head_sha`) comes from `ghJson(["pr","view",<pr>,"--json","state,mergeCommit"])` on the forge.
- `superseded[]`: `recorded` is `supersession.json`; `observed.all_delivered` comes from `facts.tracker.superseded_delivered`.
- `siblings[]`: identity and start state come from `sibling-baseline.json`, `admitted` from the ledger, and `end_state_terminal` from `facts.tracker.sibling_end_states`.
- `sibling_baseline` is the attestation step 11.5 already builds, not the file itself: when `<run-dir>/sibling-baseline.json` reads, `{captured: true, entry_count: <its entry count>}`; when it is missing or unreadable, the field is left out (never `{captured: false}`). The file is an array of sibling entries, which `validateReconcileInput` rejects as a `sibling_baseline`.

**Absent tracker observations never become divergences.** When `facts.tracker` is absent or unreadable, the command leaves out the parts that need it: the `superseded[]` and `siblings[]` entries. It runs `reconcileCore` on `shipped[]` and `sibling_baseline` alone. That is valid input: `entry_count` is at least the empty `siblings[]` length, and `reconcileSiblingBaseline` (`reconcile.js` l. 120–129) returns no divergence when `captured === true`, so a readable baseline file yields no `sibling-check-unproven`. When `sibling-baseline.json` is missing or unreadable, `sibling_baseline` is left out and reconcile's `- [sibling-check-unproven] run: …` line renders. That line is a disk fact (step 4's snapshot was never written), not a fabrication, and it renders whether or not facts are present. The section then adds `- could not read tracker observations: superseded and sibling checks not run _(reported input missing)_`. reconcile's fail-closed classes therefore fire only on evidence that was actually supplied, and a missing facts file never fabricates `superseded-unproven` or `unowned-sibling-mutation` lines.

**The summary renders; it does not gate.** Step 11.5's existing `faff reconcile` call, fed by the orchestrator's own tracker reads, still decides the run's disposition (`pass` / `warn` / `needs-human`). A missing or partial facts file therefore cannot turn an L4 `needs-human` into a completed run; it can only leave the summary's tracker-dependent lines out, and the `could not read tracker observations` line says so.

A forge read that fails leaves that issue's `observed` empty, which reconcile already treats fail-closed (`claimed-shipped-unmerged`). A `could not read forge: <reason>` line is added to the section, so a forge outage is never mistaken for a real divergence.

**Extractions (refactors, existing JS stays JS):**
- **`economics.js`:** move the opts resolution and computation out of `cmdEconomics` into an exported `economicsForRun(runDir, { root, sessionId, env })` that returns the object `faff economics --json` prints. `cmdEconomics` becomes a thin wrapper over it.
- **`budget.js`:** extract the `check` composition out of `cmdBudget` into an exported `budgetCheckForRun(runDir, { root, sessionId, env })` that returns the `BudgetState` that `faff budget check --json` prints.
- **`reconcile.js`:** add `validateReconcileInput` to the exports.

`budget.js` and `reconcile.js` are governance modules that carry selftests. Per AGENTS.md, any selftest case the extraction touches moves to `test/`, and nothing is added to the selftest blocks. An equivalence test (4.5) pins each CLI's output to its new function.

**Chosen:** extract and export, rather than re-compose the exported pieces inside `run-summary.ts`. Rationale: re-composing would duplicate the CLIs' resolution order (session precedence, epochs, pricing source), which is the drift class the redesign exists to remove. With one function per figure, the CLI and the summary cannot disagree.

### The facts file: tracker reads and in-run judgements only

**Chosen:** (ratified: human) the fourteen first-draft facts are sorted by source, and each source is handled one way. Operator's words, 2026-10-29: "y", to the four-way plan.

| Source | First-draft facts | Handling |
|---|---|---|
| Tracker reads | `issues.title`; reconcile's tracker observations (sibling end states, supersession delivery) | Passed in, because faff's CLI never calls the tracker: `facts.tracker`. |
| `faff doctor` | `install_health` | Computed in-process (`gates-doctor.js`). No longer passed. |
| Forge (GitHub) | `issues.pr`; reconcile's shipped-merge observations | Computed: from disk records first, then `gh` through `merge-gate-gh`. A failure renders a could-not-read line at exit 0. No longer passed. |
| In-run judgements and counts | `issues.gloss`, `methodology_findings`, `verdicts`, `resolve_attempts`, `park_records`, `reasons`, `inferred_deps`, `discovered_scope` (deduped and surfaced), `follow_ups`, `prep_summary`, `tidy_log`, `waves` | Passed in for now: `facts.run`. Only the filed-ticket count is already on disk (`ledger.discovered_scope_filed`), and it is read from there. Event `data` is strictly validated and carries none of the others. FAFF-1439 records them as events when they happen, after which they move to computed. |

```
RECORD SummaryFacts:                      # every field optional except format
  format: 2
  tracker: {
    titles: Map<IssueId, String>,
    sibling_end_states: Map<IssueId, { end_state_terminal: bool }>,
    superseded_delivered: Map<IssueId, bool>
  }
  run: {
    gloss: Map<IssueId, String>,
    methodology_findings: { findings: [String], prd_distance?: String },
    verdicts: { fire_and_forget: Int, likely_fire: Int,
                routed_out: Map<"gap-blocked"|"circular-blocked"|"repeat-parked", [ { id, detail } ]> },
    resolve_attempts: { attempted, succeeded, failed, proceeded_medium: [ { id, inferred, evidence, pr } ] } | null,
    park_records: [ { issue_id, root_cause_class, timestamp, … } ],
    reasons: Map<IssueId, String>,
    inferred_deps: Object | null,
    discovered_scope: { filed: [ { from, id, title, relationship } ], deduped: Int, surfaced: [ { id, text, why } ] } | null,
    follow_ups: [String],
    prep_summary: { refreshed, promoted, promoted_needs_review, parked, errored } | null,
    tidy_log: String | null,
    waves: Int
  }
```

`format: 1` files, the earlier draft's shape, are not read. They take the could-not-read-facts path.

### Where the code lives

**Chosen:** `bin/lib/run.ts` (the dispatcher, verb table `{ summary }`) and `bin/lib/run-summary.ts` (the renderer), TypeScript with committed `tsc` emits `run.js` and `run-summary.js`. Rationale:
- New modules are TypeScript by the operator's rule (ADR-0132, layout d). Importers require them extensionless.
- Factory region, registered as `REGION_SELFTEST_ARGV.run = null` and `TEST_FILE_COVERAGE.run = "test/run-summary.test.mjs"`. `regions.js` demands a selftest only of governance members.

**TypeScript constraints:**
- No `as`, `!` or `satisfies` anywhere (`check-no-boundary-cast`).
- Untyped JSON (the ledger, events, facts, holdout and supersession records) is read through `Reflect.get` and narrowed with type guards.
- Add `run.ts` and `run-summary.ts` to the pinned module list in `test/check-no-boundary-cast.test.mjs`.

**Build steps:** add both files to `tsconfig.json` `include`, run `cd plugin/skills/faff && npm install && npm run build`, and commit `run.js`, `run-summary.js` and `build-manifest.json`.

## 4. HOW

### 4.1 Render procedure

```
PROCEDURE run_summary(run_dir, facts_path):
  1. L := readLedger(run_dir). Unparseable, or a core field missing or mistyped → exit 2.
     Any other field that fails its schema type renders "- (could not read <field>: <reason>)" in its section.
  2. F := read facts_path. Absent, unreadable, invalid JSON, or format ≠ 2 → F := {} and
     note := "⚠ could not read facts: <reason>" (rendered first, below). Unknown keys → a final "⚠ facts: unknown key(s) …" line, with each key name passed through factText().
  3. E := parseJsonlEntries(events.jsonl). Unreadable → header shows "Sentry: (events unreadable)".
  4. econ := economicsForRun(run_dir, {root, sessionId}). Throws → "Unit economics unavailable (<message>)".
     doctor := buildDoctorJson(gatherDoctorState(resolveDoctorScanSet(…))). Throws → "could not read install health: <message>".
  5. input := assemble ReconcileInput (§3) from disk, the forge and facts.tracker; validateReconcileInput(input) → error renders
     "could not read reconcile input: <e>"; else ground := reconcileCore(input). Each failed forge read adds a could-not-read line.
     Skipped when the run has no shipped or superseded outcome, no siblings, and no sibling-baseline.json.
  6. budget := budgetCheckForRun(...) only when some outcome is `unreached-budget`. Throws → "(tokens_source unknown)".
  7. Emit:
     a. note (when set); then the install-health warning when doctor reports the install not clean
        ("⚠ INSTALL-HEALTH: <doctor's RESULT line> — remediation: run `faff sync`").
     b. "Methodology: <slots.methodology>" when the config sets it.
     c. "# Beep-Boop Run — <owner.started_at, UTC>"; "Mode: <from run id> · Duration: <started_at → endpoint>";
        "Waves: <F.run.waves | ?> _(reported)_ · Sentry: <count> checkpoints · max intervention: <max>"; "Stop reason: <L.stop_reason | (not recorded)>".
     d. Sections A4–A23 in template order (Appendix A), each under its Rule-inventory rule.
  8. Write atomically (tmp + rename), print, exit 0.
```

Determinism holds for a fixed disk, config and forge response. The command never reads the clock, and the `env` it passes to `economicsForRun` / `budgetCheckForRun` is built only from the ledger (`measure_session_id`, `measure_root`), never from the ambient environment. So the same run dir, transcripts and config always render the same bytes. Ids without a `facts.tracker.titles` entry render as `- <ID>`, and an issue with no PR on disk or on the forge drops the `(PR #n)` suffix. Any line carrying a facts value (a title, gloss, reason, detail, finding, follow-up or count) ends with ` _(reported)_`.

### 4.2 Section sources that need a rule

- **Ground-truth divergences (A19):** one line per `reconcileCore` divergence, `- [<class>] <issue or "run">: <detail>`. The heading suffix is `warn` for `disposition: warn` and `ESCALATED` for `needs-human`. reconcile's own level gating comes from the assembled input's `level` (`ledger.level`).
- **Product-incomplete (A18):** environment gaps are `HOLDOUT_REASON_CODES` minus `human-only`, plus the legacy `unspecified`. A code in neither set lists under `unrecognised reason codes`.
- **Superseded (A11):** delivering ids come from each issue's `supersession.json` `superseded_by`. A missing or invalid file renders the id with `(supersession record missing)`.
- **`faff-parks` block (A13):** `JSON.stringify(F.run.park_records ?? [])`, byte for byte, in a fence of `max(3, longest backtick run + 1)` backticks. It is exempt from neutralisation so `park-history.js` can parse it.

### 4.3 Neutralisation

Every string from the facts file passes through one helper, `factText()`, before entering the markdown. The rule is by source: any value read from `F`. The helper collapses newlines to spaces, and backslash-escapes a leading markdown block marker (`#`, a backtick or `~` run, `>`, `-`, `*`, `+`, `|`, or a digit followed by `.`). Strings computed from disk (reconcile details, supersession ids) go through the same helper, because their origin is ultimately tracker or forge text. So does every error text derived from the facts file, including the `JSON.parse` message in the `⚠ could not read facts: <reason>` line, which can quote the file verbatim.

### 4.4 Skill change

Reporting §1's template block is replaced by:
- the `SummaryFacts` shape (pointing at this spec);
- `faff run summary --run-dir "$FAFF_RUN_DIR" --facts <file>`.

Step 11.5 keeps its existing `faff reconcile` call, and also writes its tracker observations (sibling end states and supersession delivery) into `facts.tracker`. The kept prose is:
- the outcome-bucket list;
- the banned-heading rule;
- §2 and §3.

Lower `SKILL_LINE_BASELINE["faff-beep-boop"]`. `ANCHOR_PHRASES["faff-beep-boop"]` (l. 185–198, 569) are outside the replaced range.

### 4.5 Tests (in `test/` only, `node --test`, no `--selftest`)

`test/run-summary.test.mjs`:
- one fixture per conditional section (A1–A23), asserting the section renders when its rule holds and is absent when it does not;
- fixtures built by the real writers (`init-self-drain`, `record-outcome`, `events append`), with ledgers validated against the v0.3 schema;
- facts problems: absent, invalid JSON, `format` missing, an unknown key; each exits 0 with its `⚠` line; and a malformed facts file whose bytes include `\n## Deferred` yields a one-line `⚠` reason and no `## Deferred` heading;
- a ledger missing `admitted` exits 2, and a mistyped annotation array renders its could-not-read line;
- neutralisation: a property case putting `"x\n## Deferred"` into every facts string field in turn, with no `## Deferred` heading in the output;
- a `faff-parks` round-trip through `park-history.js`, including a backtick run;
- determinism: the same fixture rendered with the clock stubbed to two times, with a different ambient `CLAUDE_CODE_SESSION_ID`, and with `ghJson` stubbed to the same responses, byte-identical;
- reconcile in-process: with `ghJson` stubbed to report one shipped PR merged on a different head, the assembled input yields a `phantom-merge` line, and the result deep-equals `faff reconcile --run-dir <dir> --level <L> --json` given the same assembled input on stdin (`cmdReconcile` already reads a `ReconcileInput` from stdin, `reconcile.js` l. 230; no CLI change);
- forge failure: `ghJson` stubbed to fail renders `could not read forge` lines and exits 0;
- no tracker facts: a run with superseded outcomes, siblings and `sibling-baseline.json`, but no facts file, renders no `superseded-unproven`, `unowned-sibling-mutation` or `sibling-check-unproven` line, the assembled input passes `validateReconcileInput`, and it does render the `could not read tracker observations` line;
- missing baseline: the same run without `sibling-baseline.json` leaves `sibling_baseline` out and renders exactly one `- [sibling-check-unproven] run:` line;
- doctor in-process: an unclean doctor state renders the `⚠ INSTALL-HEALTH` line with doctor's RESULT text, and a throwing doctor renders its could-not-read line;
- PR lookup order: a `merge-record.json` PR wins over `landing-loop.json`, which wins over the forge, and a forge hit whose head branch doesn't start with the issue id is ignored;
- labelling: every markdown line outside the `faff-parks` fence that contains a facts value ends with ` _(reported)_`; the two `⚠` facts-file diagnostics do not; the `## Parked` heading carries it; no line built only from disk, doctor or forge does;
- no faff subprocess: every `child_process` spawn except `merge-gate-gh`'s `gh` call is stubbed to throw, and the render still succeeds;
- `faff run bogus` exits 2.

`test/economics-budget-extract.test.mjs`: `faff economics --json` and `faff budget check --json` print exactly `economicsForRun()` and `budgetCheckForRun()` for two fixture runs, one with a closed span and one with no transcript, plus the selftest cases the extraction touched, moved here.

**Chosen:** a synthetic reference fixture with the structure of `run-20261024-044511-beepboop-list-f66619` (its outcomes, waves and sentry checkpoints) and invented ids, titles and paths. It is rendered to a committed golden in-process, with `ghJson` injected as a stub returning fixed responses (the `land.js` `deps` pattern), so the golden never depends on a live `gh`. The builder also compares a local render of the real run with its prose `summary.md`, and lists in the PR description any departure that no A-row explains. That comparison is informational and is not an acceptance criterion; the committed golden is. No production run data is committed.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir whose ledger has outcomes {"Q":"pr-open"}, landing_resumable ["Q"] and empty outage arrays
When `faff run summary --run-dir D` runs with no facts file
Then it exits 0, the output's first line is "⚠ could not read facts: …",
  and it contains "## Awaiting landing (resumable): 1" and no "Awaiting spec-review" heading
```

```
Given a ledger with outcomes {"X":"shipped"}, review_adversarial_skipped ["X"] and post_merge_verification_failures [{issue:"X",…}]
When `faff run summary` runs
Then X appears under "## Shipped (post-merge verification flagged)" and under no other Shipped heading
```

```
Given an L4 ledger with outcomes {"S":"shipped"}, S/merge-record.json with head_sha "aaa", and a forge that reports S's PR merged at head "bbb"
When `faff run summary` runs
Then the output has a ground-truth heading ending "ESCALATED" and a line starting "- [phantom-merge] S"
```

## 5. DESIGN DECISION RATIONALE

- **Where each figure comes from.**
  - **Chosen:** (ratified: human) in-process computation from disk and config, with facts only for what exists nowhere on disk (§3).
  - Rejected: transcribed command output in facts, because it drifts; and shelling out, because of `PATH` and binary skew.
- **Extract functions, or re-compose exported pieces.**
  - **Chosen:** extract `economicsForRun` and `budgetCheckForRun` (§3).
- **Facts failure semantics.**
  - **Chosen:** never fail the render. A visible `⚠ could not read facts` line at exit 0, matching the missing-fact invariant. The run always ends with its ledger-sourced summary.
- **The A9 tie-break.**
  - **Chosen:** post-merge flagged wins. A defect signal outranks an outage annotation, and the prose left the case open.
- **Test fixture.**
  - **Chosen:** synthetic, built by the writers, with a real-run comparison in the PR (4.5).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** `.faff/holdout/<run-id>.json` carries `needs_human_reasons` as a count map. Validate against its writer before building A18. If the shape differs, render the writer's actual shape and record that in the PR.

## Rule inventory (slice A)

Covering tests are cases in `test/run-summary.test.mjs` unless named otherwise. Lines from `facts.tracker` or `facts.run` carry the ` _(reported)_` label (A26).

| # | Prose rule (Reporting §1) | Command behaviour (source) | Covering test | Disposition |
|---|---|---|---|---|
| A1 | The install-health warning is the first line when not clean (a facts-problem line, when present, comes first) | doctor in-process | "install-health first", "doctor in-process" | changed: computed at render time, not passed in |
| A2 | "Methodology: <skill>" when configured | config `slots.methodology` via `loadConfig` | "methodology line" | changed: from config, not facts |
| A3 | Header: Mode, Duration, Waves, Sentry count and max, Stop reason | run id, facts.run.waves (reported), heartbeat/events, `sentry-checkpoint` `data.intervention`, ledger | "header", "determinism", "unreadable events" | changed: mode computed |
| A4 | Unit economics; ZERO-SHIP; empty lines omitted; degraded warning | `economicsForRun()` in-process | "economics", economics-budget-extract | changed: in-process, not a CLI call |
| A5 | Methodology findings only when configured; PRD-distance tripwire | facts.run.methodology_findings (reported), gated on config | "methodology on/off" | kept |
| A6 | Verdict counts and admitted total | facts.run.verdicts (reported), ledger.admitted | "verdicts" | kept |
| A7 | Routed out by class | facts.run.verdicts.routed_out (reported) | "routed out" | kept |
| A8 | Resolve-attempts (appetite high/full) | facts.run.resolve_attempts (reported) non-null | "resolve attempts on/off" | kept |
| A9 | Shipped under exactly one of `## Shipped (auto-merged)`, `## Shipped (adversarial review skipped — chain outage)`, `## Shipped (post-merge verification flagged)` | ledger arrays; post-merge flagged wins a tie | "shipped split", "tie-break" | changed: the tie-break is new |
| A10 | Post-merge-flagged only when either array is non-empty | ledger | "post-merge on/off" | kept |
| A11 | Superseded only on at least one `superseded` outcome; cite delivering ids | ledger + `<ISSUE>/supersession.json` | "superseded", "supersession missing" | kept |
| A12 | PR-open vs Awaiting landing by `landing_resumable` | ledger | "landing split" | kept |
| A13 | Parked list and the `faff-parks` block (`[]` for zero) | facts.run.park_records (reported) | "parks block", "parks round-trip" | kept |
| A14 | Awaiting review (outage) only when `review_outage_pending` is non-empty | ledger | "review outage" | kept |
| A15 | Awaiting spec-review (outage / slow), each only when non-empty | ledger | "spec-review arrays" | kept |
| A16 | Errored | ledger + facts.run.reasons (reported) | "errored" | kept |
| A17 | Unreached only on a breach with work left; `tokens_source` on a tokens/cost breach | outcomes `unreached-budget`; `budgetCheckForRun()` | "unreached", "budget fn throws" | changed: in-process budget state |
| A18 | Product-incomplete only when the L4 holdout ran; environment gaps apart from human-only | holdout record + `HOLDOUT_REASON_CODES` | "holdout split", "unknown code" | kept |
| A19 | Ground-truth divergences only when 11.5 found one; warn ≤ L3, ESCALATED at L4 | `reconcileCore` on an input assembled from disk, the forge (`ghJson`) and facts.tracker | "divergences", "reconcile equivalence", "forge failure", "no tracker facts" | changed: computed, not transcribed |
| A20 | Inferred deps only when at least one | facts.run.inferred_deps (reported) | "inferred deps" | kept |
| A21 | Discovered scope counts | facts.run.discovered_scope (reported) + ledger.discovered_scope_filed | "discovered scope" | kept |
| A22 | Human follow-ups | facts.run.follow_ups (reported) | "follow-ups" | kept |
| A23 | Prep summary and Tidy only in full mode | mode from run id; facts | "full mode only" | changed: mode computed |
| A24 | Exhaustive buckets; banned headings never appear | fixed section list + `factText()` | "no banned headings" (holdout), "hostile values" | kept |
| A25 | A non-empty end queue is legal only on a budget fire | not in this command | (skill text) | kept in prose (not deleted) |
| A26 | (none) | every facts-sourced markdown line ends ` _(reported)_`; the `faff-parks` fence is exempt and its heading is labelled | "labelling" | changed: new, operator decision; the `⚠ could not read facts` and `⚠ facts: unknown key(s)` diagnostics are about the file, not facts values, so they pass through `factText()` and are not labelled |

**Captured kernels:** `run summary` composes no captured decision kernel. `reconcileCore` is not one of the captured kernels, so no corpus-replay check applies.

## 7. DONE

### From WHY
- [ ] `faff-beep-boop/SKILL.md` Reporting §1's template is replaced by the `SummaryFacts` shape and a `faff run summary` call, and `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered.
- [ ] `faff validate-adapters` passes with no RATCHET finding for `faff-beep-boop`.

### From WHAT
- [ ] `faff run summary --run-dir D` writes `D/summary.md` and prints the same bytes, exit 0.
- [ ] `faff run summary` with no facts file, or with a facts file of invalid JSON, exits 0 and its first line starts `⚠ could not read facts`.
- [ ] `faff run summary` exits 2 when the ledger lacks `admitted`.
- [ ] `faff run bogus` exits 2 with a usage line naming `summary`.
- [ ] `faff economics --json` and `faff budget check --json` output is unchanged, and equals `economicsForRun()` / `budgetCheckForRun()` (`test/economics-budget-extract.test.mjs`).
- [ ] `reconcile.js` exports `validateReconcileInput`.
- [ ] The install-health line comes from `gates-doctor.js` in-process. No facts key carries install health.
- [ ] Forge reads go only through `merge-gate-gh`'s `ghJson`, and a failed read renders `could not read forge` at exit 0.
- [ ] Every rendered markdown line outside the `faff-parks` fence that contains a `facts.tracker` or `facts.run` value ends with ` _(reported)_`.
- [ ] `faff run` is registered in `COMMANDS`, `REGION_MAP` (factory), `REGION_SELFTEST_ARGV` (null) and `TEST_FILE_COVERAGE`, and documented in `docs/guide/cli.md`. `faff regions check`, `faff lint-cli-coverage` and `faff lint-cli-doc` pass.
- [ ] `run.ts` and `run-summary.ts` are in `tsconfig.json` `include`, with committed `run.js`, `run-summary.js` and `build-manifest.json`. CI's stale-emit step passes.
- [ ] `check-no-boundary-cast` passes, and `test/check-no-boundary-cast.test.mjs` lists `run.ts` and `run-summary.ts`.
- [ ] No selftest block gains a case. Any touched `budget`/`reconcile` selftest case is moved to `test/`.
- [ ] The PR diff touches no `commissaire*` file.

### From HOW
- [ ] Each conditional section A4–A23 renders only under its rule in the Rule inventory.
- [ ] With every `child_process` spawn other than `merge-gate-gh`'s `gh` stubbed to throw, `run summary` still renders, so no faff subprocess is used.
- [ ] The ground-truth section built from the assembled input matches `faff reconcile --json` given that input on stdin.
- [ ] With no facts file, a run with superseded outcomes, siblings and a readable `sibling-baseline.json` renders no `superseded-unproven`, `unowned-sibling-mutation` or `sibling-check-unproven` line.
- [ ] Rendering the same run dir twice at different times, with the same forge responses, gives byte-identical output.
- [ ] A `"x\n## Deferred"` value in any facts string field produces no `## Deferred` heading.

### Rule inventory
- [ ] Every line the PR deletes from `faff-beep-boop/SKILL.md` maps to a row A1–A26. The PR description lists the deleted line ranges against row ids.

### Tests
- [ ] `test/run-summary.test.mjs` and `test/economics-budget-extract.test.mjs` pass under `node --test`, including the synthetic golden.
- [ ] No file under `test/fixtures/run-summary/` contains data from a production run dir.

**Integration smoke test:**

```
build the synthetic reference fixture in a tmp run dir; write its facts file
faff run summary --run-dir T --facts F   → exit 0; T/summary.md equals the committed golden outside the ground-truth section (the live CLI may reach the forge)
```

## Appendix A: section order

The section order follows the template:
- the facts-problem and install-health lines, Methodology, then the header;
- unit economics;
- methodology findings;
- verdicts, routed out, resolve-attempts;
- the three shipped variants;
- superseded, PR open, awaiting landing, parked;
- the outage holds;
- errored, unreached, product-incomplete;
- ground-truth divergences;
- inferred deps, discovered scope, human follow-ups;
- prep summary, tidy findings.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. It is one verb plus two refactor extractions and one export, with two test files. The extractions are small and behaviour-neutral, pinned by equivalence tests. That is still a 1–3 day unit.
- **Workstream fit?** No issues. It is slice A of the FAFF-1413 re-slice, in the prose-to-command lane.
- **Deps surfaced?** No issues. It blocks FAFF-1436, which blocks FAFF-1437. It touches the governance modules `budget.js` and `reconcile.js` only through additive exports.
- **Risk profile?** No issues. The equivalence tests guard the refactor risk, and there is no novel integration.