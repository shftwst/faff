*Agent-written (Claude Code): FAFF-1418 spec, produced by interactive prep for the operator.*

# FAFF-1418: faff run trigger — move beep-boop's L4 run-start trigger assembly from prose into a command

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1418.

This spec is for the build agent and its reviewers. It replaces beep-boop's §0a ("Run-start trigger — PLAN / drain / refuse", L4 lights-out only) signal assembly with one verb, `faff run trigger`, on the `faff run` dispatcher that FAFF-1435 shipped and FAFF-1436 extended. The run-start kernel itself (`faff run-start`, FAFF-496) is unchanged.

## 1. WHY

**The load-bearing idea:** every read §0a performs is already a CLI call, and the decision is already a kernel (`faff run-start`). What the prose owns is the order of the reads, how each result becomes one of seven booleans, and the fail-safe coercions. That is mechanical, and it is where a misread turns a `refuse` into a `drain`. A command makes the kernel the decision by construction.

- The `run-start` kernel saw zero real decisions in the post-fix decision corpus because the prose assembles its inputs by hand and has to remember the capture driver. The command runs the capture itself.
- §0a is 25 lines of `faff-beep-boop/SKILL.md` (lines 134–158 on `948a8f1d`), re-read on every drain turn although only an L4 lights-out run uses it.
- Two steps stay judgement: invoking the `prd` slot (an LLM producer) and reading the PRD's declared goals. The command stops at a typed `needs-judgement` token for those and takes their results as files.

### Design principles

- **Reimplement no signal.** Each signal stays with its producer: `prd list`/`prd path`, `run-outward`, `contract prd-readiness`, `prdr coverage`, `run-start`. The command spawns them and coerces their results; it re-derives no ladder.
- **Refusal-biased.** Any failed read coerces toward `refuse`, never toward `plan` or `drain`, exactly as the prose does.
- **No ledger write on refuse and fault.** The only ledger write is `faff run-record-prd`, and only on `drain` (licence) or after `plan` (licence and root container). On `fault` nothing at all is written. On `refuse` the run-dir writes are exactly today's: the decision-capture events, plus the two judgement input files under `<run_dir>/trigger/` when the PRD-present path ran; `run-ledger.json` is byte-unchanged and the run is never closed.
- **L3 untouched.** An ordinary L3 run gets `skip` from the classifier alone; `faff run-start` is never consulted.

### Reference context

- `plugin/skills/faff-beep-boop/SKILL.md` §0a, lines 134–158 (step 0 classify, steps 1–7, the capture note, the L4-guard invariant).
- `plugin/skills/faff/bin/lib/run-start.js` (`deriveRunTrigger`, the fixed ladder), `run-outward.js` (`decideOutward`), `run-record-prd.js` (`classifyInheritedRunDir`, write mode), `prd.js` (`prd list --json`, `prd path`), `prdr.js` (`prdr coverage`), `contract-defs-prd.js` (`prd-readiness`, `computePrdCoverageVerdict`).
- `plugin/skills/faff/bin/lib/decision-capture.js`: `mintConsultCorrelationId`, `appendActionMarker` (the in-process pair FAFF-1414's `graft admit` uses).
- `plugin/skills/faff/bin/lib/run.ts` (the `VERBS` table), `run-checkpoint.ts` (the deps-injected spawn pattern).
- `plugin/skills/faff-plot/SKILL.md` line 42 (standalone plot reuses "§0a steps 1–2" and its Active/Frozen filter).

### Already shipped against this surface

- FAFF-496 `faff run-start` (the kernel and its ladder), FAFF-521 `faff run-outward`, FAFF-253 `prd-readiness`, FAFF-257 `prdr coverage`: consumed unchanged.
- FAFF-956/FAFF-1009 in-kernel capture for `run-start` and `run-outward`: reused; the command supplies the correlation id the prose's driver call supplied.
- FAFF-1435 (`faff run summary`, the `faff run` dispatcher) and FAFF-1436 (`faff run checkpoint`, merged as #1169): this adds a third verb.

## 2. OUT OF SCOPE

- Changing the run-start ladder, its verdict or reason vocabulary, or `faff contract run-trigger`.
- `/faff-plot --autonomous` Ignition's own signal assembly (`faff-plot/SKILL.md` lines 192–205). Its target resolution differs (explicit > inherited > methodology-default) and it supplies only `outward`. Moving it onto this command is a possible follow-up, not this ticket.
- Parsing PRD goals in code. Goal strings are matched verbatim against PRDR citations that agents wrote; a parser at one call site would diverge from plot's goal reads. Goals stay an agent read.
- The run ledger mint, owner, budget envelope, Commissaire admit and run close: FAFF-1437 (`run open` / `run close`).
- Invoking `/faff-plot --autonomous` on `plan`: stays in the skill.

## 3. WHAT

### Interface

```
faff run trigger [--run-dir DIR] [--root DIR]
                 [--prd-readiness FILE | --prd-slot-unreachable] [--prd-goals FILE]
                 [--after-plan --correlation-id ID]
                 [--json]
```

- `--run-dir` defaults to `$FAFF_RUN_DIR`. `--root` defaults to the repo root.
- `--prd-readiness FILE`: the `prd` slot's whole output, as written by the skill. The command locates the single fenced `faff-contract:prd-readiness` block in it.
- `--prd-slot-unreachable`: the skill could not invoke the slot. Mutually exclusive with `--prd-readiness`.
- `--prd-goals FILE`: a JSON array of the PRD's declared goal strings, as the skill read them from the PRD file.
- `--after-plan --correlation-id ID`: the post-plot call (§4.1 phase C). `ID` is the `run_start_correlation_id` the deciding call returned.

```
RECORD TriggerResult:
  token: ENUM skip | fault | needs-judgement:prd-inputs | plan | drain | refuse | record-failed | recorded
  classify: { verdict: not-l4 | inherited-l4 | fault, reason: String | null }
  run_dir: String | null
  prd: { present: bool, ambiguous: bool, container: String | null, path: String | null, slot: String | null }
  target: { container: String | null, repo: String | null }
  self: { container: String | null, repo: String | null, is_self: bool }
  outward: OutwardSignal | null          # run-outward's JSON verbatim; null when not consulted or when it failed (diagnostic names which)
  creative_licence: broad | tight | null # contract prd-readiness's validated output when admissible, else null
  coverage: PrdCoverage | null           # prdr coverage's JSON verbatim; null when not consulted or when it failed
  signals: RunTriggerSignals | null      # the seven booleans passed to run-start
  verdict: { verdict, reason } | null    # run-start's own output; null when not consulted; {refuse, null} when it failed
  run_start_correlation_id: String | null
  recorded: { licence: String | null, root_container: String | null } | null
  diagnostics: [String]                  # e.g. prd-slot-unreachable, prd-goals-empty, coverage-failed
```

**Exit codes.** 0 = continue as the token says (`skip`, `needs-judgement:prd-inputs`, `plan`, `drain`, `recorded`). 3 = stop the run, start nothing (`refuse`, `fault`, `record-failed`). 2 = usage error (bad flag combination, unreadable `--prd-goals` file path); prints no TriggerResult.

**Caller rule.** The skill treats exit 2, any exit other than 0 or 3, and a `--json` stdout that does not parse as a TriggerResult as `refuse`: stop, start nothing, surface the stderr. That is the prose's existing "malformed → refuse" coercion, applied to the whole command.

Without `--json` it prints `trigger: <token>` plus `reason: <reason>` when a verdict or classify reason exists, one `diagnostic: <d>` line per entry, and the same exit code.

### Where the code lives

**Chosen:** a new verb `faff run trigger` in `bin/lib/run-trigger.ts`, with a committed `run-trigger.js` emit, registered as `trigger` in `run.ts`'s `VERBS`. It contains no `as`, `!` or `satisfies`; it is added to `tsconfig.json` `include`, to `test/check-no-boundary-cast.test.mjs`'s pinned list and to `build-manifest.json`. `TEST_FILE_COVERAGE.run` gains `test/run-trigger.test.mjs`. No `--selftest`; `run` stays in the factory region. Rationale: the ticket's working name was `faff run-start assemble`, but `faff run-start` is a pure kernel ("no disk beyond its args"); giving it a subcommand that reads disk and spawns producers would break that contract, and `run-start.js` is a legacy JavaScript module. The `faff run` group is where FAFF-1413's run-lifecycle verbs live.

**Chosen:** separate from FAFF-1437's `faff run open`, not folded into it. Rationale:
- §0a runs only on an inherited L4 ledger; `run open` runs on every run.
- `refuse` and `fault` must leave the ledger untouched and start nothing. `run open` exists to write (envelope, baseline, admit, poller), so folding would make the zero-write path a branch inside a writer.
- The `prd` slot invocation sits in the middle of the assembly. `run open` has no judgement seam and should not gain one.
- `run trigger` is a candidate for plot Ignition's assembly too (§2); `run open` never would be.

**Ordering contract with FAFF-1437 (stated, not edited here):** `faff run trigger` runs before `faff run open --adopt-run-dir`; on `refuse`, `fault` or `record-failed`, `run open` never runs.

The module exports a pure `decideTrigger(reads) → Decision` and `runTrigger(args, deps)`, where `deps` injects every spawn, the config read and the clock. `reads` is the already-read values (§4.2). `decideTrigger` spawns nothing; it produces the seven signals and the token. `runTrigger` performs the reads, calls `decideTrigger`, spawns `faff run-start` with those signals, performs the record on `drain`, and emits the capture markers.

## 4. HOW

### 4.1 Procedure

```
PROCEDURE run_trigger(args):
  A. CLASSIFY (every call)
     1. classify := classifyInheritedRunDir({FAFF_RUN_DIR: run_dir}) (in-process; never throws).
        not-l4       → token skip, exit 0. Nothing else is read.
        fault        → token fault, exit 3, reason on stderr. Nothing else is read.
        inherited-l4 → continue on run_dir.

  B. DECIDE (no --after-plan)
     2. prds := `faff prd list --json`. Non-zero or unparseable → prd_present=false, prd_ambiguous=true,
        diagnostic prd-list-failed (refuses at rung 3a; never a silent no-PRD drain).
        Selection: exactly one → it. Zero → no-PRD. Several → keep status Active or Frozen:
        one survivor → it; zero survivors → no-PRD; several → prd_ambiguous=true.
     3. PRD selected → path := `faff prd path <container>`; non-zero, or the file does not exist → no-PRD.
     4. container := selected PRD's container ?? config tracking.container ?? null.
        repo := config tracking.repo ?? null (one read, reused for self.repo).
        self := {repo, container: config tracking.container ?? null, is_self: repo != null AND target.repo == repo}.
        target_resolved := container != null OR repo != null.
     5. prd_present AND NOT prd_ambiguous AND neither --prd-readiness nor --prd-slot-unreachable given
        → token needs-judgement:prd-inputs with prd.path and prd.slot (config slots.prd), exit 0.
        No kernel is consulted on this call: neither run-outward nor run-start runs, so no capture
        base is written that no marker could close.
     6. outward := `faff run-outward --target <T> --self <S> --json` under the run-outward correlation env.
        Non-zero or unparseable → outward=false, diagnostic run-outward-failed.
     7. readiness: --prd-slot-unreachable → admissible=false, diagnostic prd-slot-unreachable.
        Else locate exactly one fenced faff-contract:prd-readiness block in the file; none, several or
        unparseable JSON → admissible=false, diagnostic prd-readiness-block-missing|malformed.
        Else pipe it to `faff contract prd-readiness`: exit 0 + verdict admissible → admissible=true,
        creative_licence := the contract verb's stdout `creative_licence` (its validated output, never
        the raw block); exit 0 + not-ready, exit 1, exit 2 or unparseable stdout → admissible=false,
        creative_licence := null.
     8. coverage (only when prd_present AND admissible): goals := JSON array from --prd-goals.
        Missing flag, unparseable, not an array of strings, or EMPTY → coverage_measurable=false,
        diagnostic prd-goals-missing|prd-goals-empty. Else `faff prdr coverage --container <c>
        --prd-goals <goals>` (no --live-prdrs, no --dod-verdicts); exit 0 + well-formed → measurable=true,
        covered := block.covered === true; else measurable=false, diagnostic coverage-failed.
        Not present-and-admissible → both false.
     9. decision := decideTrigger(reads); verdict := `faff run-start --signals <decision.signals>`
        under the run-start correlation env. Non-zero or unparseable → verdict {refuse, reason null},
        diagnostic run-start-failed.
    10. Capture markers (best-effort, never change the token): run-outward → outward-adopter when
        signals.outward is true, else outward.reason (or run-outward-failed). run-start → refuse or drain
        now; plan is marked by phase C.
    11. drain AND creative_licence != null → `faff run-record-prd --run-dir <d> --prd-creative-licence <l>`.
        Non-zero → token record-failed, exit 3. Else recorded := {licence}.
    12. Token := verdict.verdict (plan | drain | refuse). Exit 0 for plan/drain, 3 for refuse.

  C. AFTER PLAN (--after-plan --correlation-id ID; requires --prd-readiness or --prd-slot-unreachable)
    13. Steps 1–4 and 7 again (the same reads), then the coverage re-read of step 8 over the now-current
        PRDR set: logged in coverage; a failed re-read sets measurable=false and is never read as done.
        This is not a stop condition.
    14. Record when creative_licence != null OR container != null: `faff run-record-prd --run-dir <d>
        --prd-creative-licence <l> [--prd-root-container <c>]`. Non-zero (including a container with no
        licence, which run-record-prd rejects) → token record-failed, exit 3.
    15. Marker: run-start → plan, on correlation id ID. Token recorded, exit 0.
```

**Spawning.** Every child is `process.execPath` with the running CLI's own entrypoint (`path.resolve(__dirname, "..", "faff")`, the `ENTRYPOINT` pattern `run-checkpoint.ts` and `sentry.js` use), never `faff` from `PATH`, so every producer is the same vintage as the command. `deps.spawn` injects it for tests.

**Correlation ids.** For each consult the command mints the id in-process with `mintConsultCorrelationId(root, run_id, "__run__", kernel)`, passes it to the child as `FAFF_DECISION_CORRELATION_ID` / `FAFF_DECISION_ISSUE=__run__`, and writes the marker with `appendActionMarker` on the same id. The run-start id is returned as `run_start_correlation_id` so phase C pairs its `plan` marker with the right base even if a nested plot consulted `run-start` in between and advanced the ordinal. With capture off, the env is inert and no marker is written, as today. This relies on `captureDecisionCore` reading `FAFF_DECISION_CORRELATION_ID` from the environment when no id is passed (`decision-capture.js` line 568 on `948a8f1d`), which is how the prose's `eval "$(faff decision-capture decide … --export)" && faff run-start …` pairing works today.

### 4.2 Decision

`decideTrigger(reads)` takes `{prd_present, prd_ambiguous, target_resolved, outward, prd_admissible, coverage_measurable, coverage_covered, needs_prd_inputs}` after the coercions above and returns `{signals, token_if_no_kernel}`:

- `needs_prd_inputs` true → `needs-judgement:prd-inputs`, no signals.
- Otherwise the seven booleans, each strictly `=== true`, as `faff run-start --signals` expects.

**Chosen:** the command never computes the verdict itself; it spawns `faff run-start`, so the kernel's ladder and its in-kernel capture stay the single source. Rationale: "No ladder logic is re-derived here" (§0a) is the invariant this ticket exists to make mechanical.

**Chosen:** an empty goals array makes coverage unmeasurable (refuse / `coverage-unmeasurable`). Rationale: `computePrdCoverageVerdict` treats `[]` as vacuously covered, so today an agent that read no goals would drain as `prd-covered` on a PRD it never measured. The kernel is documented as refusal-biased; a PRD with no goals cannot be measured.

**Chosen:** several PRDs with zero Active/Frozen survivors is the no-PRD case. Rationale: the prose is silent; standalone plot's entry (`faff-plot/SKILL.md` line 42), which says it mirrors §0a's filter, treats zero survivors as zero PRDs. Keeping both entry points in step is that line's own instruction.

**Chosen:** a failed `prd list` refuses as ambiguous rather than draining as no-PRD. Rationale: the prose has no failure branch for this read; "no PRD" on a read error would drain an L4 run on a PRD it could not see.

### 4.3 Skill changes

- **`faff-beep-boop/SKILL.md` §0a.** Steps 0–7 and the capture note are replaced by:
  1. `faff run trigger --json`. Route on the token (table below). Treat exit 2, other exits and unparseable output as `refuse`.
  2. On `needs-judgement:prd-inputs`: invoke the `prd` slot (via the Skill tool, gateway → **Sibling-skill invocation**) on `prd.path`, write its whole output to `<run_dir>/trigger/prd-readiness.out`; read the PRD file's declared goals into `<run_dir>/trigger/prd-goals.json` as a JSON array of goal strings; if the slot could not be invoked, pass `--prd-slot-unreachable` instead. Call `faff run trigger --prd-readiness … --prd-goals … --json` once more.
  3. A routing table: `skip` → step 1 (tidy) as an ordinary run; `fault` → fail loud, start nothing; `refuse` → surface `verdict.reason` for `/faff-wtf`, start nothing, never close the run; `drain` → step 1 on the same run dir; `plan` → invoke `/faff-plot --autonomous` against `target` (it inherits `FAFF_RUN_DIR`), then `faff run trigger --after-plan --correlation-id <run_start_correlation_id> --prd-readiness … --prd-goals … --json`, then step 1 (converge, don't stop; a still-thin coverage is not a stop condition); `plan` where plot refuses ignition or errors → surface plot's reason for `/faff-wtf`, do not call `--after-plan`, start nothing (the run-start consult stays action-uncaptured, which is the honest record: the planned action was not taken); `record-failed` → fail loud, build nothing.
  4. The L4-guard invariant paragraph stays (it is the must-stay-green statement), shortened to point at `skip`.
- **`faff-plot/SKILL.md` line 42.** "the two mechanical PRD reads `/faff-beep-boop` §0a uses — its steps 1–2" becomes a reference to the same two commands and to `faff run trigger`'s selection rule, keeping the "keep both entry points in step" instruction. No plot behaviour changes.
- **`docs/guide/cli.md`.** One row for `run trigger`.
- `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the new count. `ANCHOR_PHRASES["faff-beep-boop"]` has no phrase in §0a.

### 4.4 Edge cases

- **`FAFF_RUN_DIR` unset (every L3 run).** `skip`, exit 0, with no config read, no spawn and no capture. A test pins that no child process is spawned on this path.
- **Flags on a `not-l4` or `fault` run.** Ignored after classify; the token is still `skip` or `fault`.
- **`--after-plan` without `--correlation-id`, or without readiness input.** Exit 2.
- **`--prd-readiness` and `--prd-slot-unreachable` together.** Exit 2.
- **A readiness file over 1 MiB.** Treated as malformed (admissible=false); never read unbounded.
- **Goal strings.** Passed to `prdr coverage` verbatim; no trimming or dedup by this command (coverage dedups).
- **Capture failures.** Best-effort: a failed mint or marker is recorded as capture's own degraded note and never changes the token or exit code.
- **Concurrent resume takeover during the record.** `run-record-prd` exits 4 (fence yielded) → `record-failed`, exit 3. Never retried.

### 4.5 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

`test/run-trigger.test.mjs`:
- `decideTrigger`: one case per run-start verdict × reason (8), plus `needs-judgement:prd-inputs`.
- Every coercion in §4.1 steps 2–9 with an injected failing child: `prd list` fails, `prd path` fails, missing PRD file, `run-outward` fails, block missing, two blocks, malformed JSON, `contract prd-readiness` exit 1 and exit 2, `not-ready`, slot unreachable, goals missing, goals empty, goals not strings, coverage exit non-zero, coverage unparseable, `run-start` fails. Each lands on the refuse-biased value named in §4.1.
- PRD selection: one; zero; several with one survivor; several with zero survivors (no-PRD); several with two survivors (ambiguous).
- `skip` spawns nothing; `fault` spawns nothing and exits 3.
- `drain` with a licence records it; `drain` on no-PRD records nothing; a record exit 4 yields `record-failed`.
- Phase C: records licence and container, writes the `plan` marker on the given id, and a still-thin re-read still returns `recorded`.
- Capture: with capture on, each consult's base and marker share an id; the `needs-judgement:prd-inputs` call writes no capture base; with capture off, nothing is written.
- `refuse` after the PRD-present path leaves `run-ledger.json` byte-identical.
- One end-to-end run against a real temp repo (fixture PRD, PRDR, L4 lights-out-shaped ledger) with real child processes, for `drain` / `prd-covered`.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given FAFF_RUN_DIR is unset
When `faff run trigger --json` runs
Then it exits 0 with token "skip" and classify.verdict "not-l4"
And verdict is null
```

```
Given FAFF_RUN_DIR names a directory with no run-ledger.json
When `faff run trigger --json` runs
Then it exits 3 with token "fault"
And no file under that directory is created or modified
```

```
Given the same run directory and PRD and an admissible readiness file, and a goals file []
When `faff run trigger --prd-readiness <file> --prd-goals <file> --json` runs
Then it exits 3 with token "refuse" and verdict.reason "coverage-unmeasurable"
And diagnostics includes "prd-goals-empty"
```

```
Given an L4 lights-out-shaped run directory as FAFF_RUN_DIR, tracking.repo set (so the target repo is the self repo) and no PRD file in the PRD directory
When `faff run trigger --json` runs
Then it exits 3 with token "refuse" and verdict.reason "self-directed"
And the run-ledger.json bytes are unchanged
```

## 5. DESIGN DECISION RATIONALE

- **Spawn the producers, don't import them.** Each producer's CLI is its contract and carries its own in-kernel capture. Spawning keeps `run-start` and `run-outward` the sole producers of their records; importing their pure functions would skip the capture and fork the decision from the corpus. FAFF-1436's checkpoint uses the same deps-injected spawn pattern.
- **Files for the two judgement results.** The slot's output and the goal list are what the agent produces; passing them as files keeps them out of argv length limits and makes the call reproducible from the run dir.
- **A third phase rather than a second command.** After `plan`, the remaining work is a re-read and a record against the same inputs; a flag on the same verb keeps the reads in one place.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** `classifyInheritedRunDir`, `mintConsultCorrelationId` and `appendActionMarker` stay exported with their current signatures, and in-kernel capture keeps reading `FAFF_DECISION_CORRELATION_ID` from the environment (all true on `948a8f1d`). A test pins the pairing end to end with capture on.

**Assumes:** the `prd` slot's licence judgement is trusted as today. A PRD the slot is steered by can still yield `broad`; the command only guarantees the licence recorded is the one `contract prd-readiness` validated. Cross-checking the licence against the PRD is out of scope (it would need a second judge).

**Assumes:** FAFF-1437, FAFF-1434 and FAFF-1442 may each land before or after this; whichever lands second rebases the shared lines. FAFF-1437 shares `run.ts`'s `VERBS`, `TEST_FILE_COVERAGE.run`, `docs/guide/cli.md`, `tsconfig.json`, the boundary-cast pin list and `build-manifest.json`. FAFF-1434 shares the `SKILL_LINE_BASELINE["faff-beep-boop"]` line. FAFF-1442 adds a byte baseline per SKILL.md (`prose-baseline.json`); if it lands first, this build also lowers the `faff-beep-boop` and `faff-plot` byte entries, or `validate-adapters` fails the DONE item. No logic overlaps with any of them.

## Rule inventory

Every line §0a deletes maps to a row. "Covering test" is in `test/run-trigger.test.mjs` unless stated.

| # | Prose rule (§0a) | Behaviour | Disposition |
|---|---|---|---|
| T1 | Step 0 runs first: classify the inherited handoff via `run-record-prd --classify` | §4.1 A1, in-process classifier | kept |
| T2 | `not-l4` skips §0a entirely, byte-identical L3 run | `skip`, no spawn | kept |
| T3 | `fault` fails loud: stderr reason, non-zero, start nothing, never mint, never drop to L3 | `fault`, exit 3, no write | kept |
| T4 | `inherited-l4` → `runDir := $FAFF_RUN_DIR`, the one ledger for the run | A1 | kept |
| T5 | §0a never mints and never calls `faff lights-out` | no mint path in the module | kept |
| T6 | Steps 1–5 assemble the seven signals; reuse reads; no ladder re-derived | `decideTrigger` + spawned `run-start` | kept |
| T7 | `prd list --json`: one PRD → its container | B2 | kept |
| T8 | Zero PRDs → no-PRD | B2 | kept |
| T9 | Several → keep Active/Frozen; still several → ambiguous | B2 | kept |
| T10 | (silent) several with zero survivors | no-PRD, matching plot's entry | changed: gap closed |
| T11 | (silent) `prd list` fails | ambiguous → refuse | changed: new fail-safe |
| T12 | `prd path <container>`; file missing → no-PRD | B3 (also a non-zero exit) | kept |
| T13 | container := PRD container ?? `tracking.container` ?? null; no explicit override at this site | B4 | kept |
| T14 | repo := `tracking.repo`, one read reused for `self.repo` | B4 | kept |
| T15 | `target_resolved := container != null OR repo != null` | B4 | kept |
| T16 | `SelfRef` from the same reads; `is_self` by repo-slug match | B4 | kept |
| T17 | `outward` from `run-outward`; non-zero → false | B6 (also unparseable) | kept |
| T18 | Step 4: `slots.prd` unreachable → `prd_admissible=false`, logged as `prd-slot-unreachable` | `--prd-slot-unreachable` | changed: the skill reports it by flag |
| T19 | Step 5: invoke the `prd` slot on the step-2 file | stays in skill; `needs-judgement:prd-inputs` | kept in prose |
| T20 | Locate the block, parse, pipe to `contract prd-readiness`; admissible → true + licence; not-ready / exit 1 / exit 2 / missing → false | B7 | kept |
| T21 | Coverage read only when present and admissible; else both flags false | B8 | kept |
| T22 | Read the PRD's declared goals as a JSON array | stays in skill; `--prd-goals` | kept in prose |
| T23 | `prdr coverage --container --prd-goals`, no `--live-prdrs`/`--dod-verdicts`, consume `.covered` only, no ratio | B8 | kept |
| T24 | Coverage non-zero or malformed → `coverage_measurable=false` | B8 | kept |
| T25 | (none) empty goals array | measurable=false → refuse | changed: new, refusal-biased |
| T26 | Step 7: call `run-start` with the seven signals | B9 spawn | kept |
| T27 | Malformed `--signals` / exit 2 → refuse | B9 `run-start-failed` → refuse; caller rule for the command | kept |
| T28 | No branch mints; every branch reuses `runDir` | no mint path | kept |
| T29 | `plan` → `/faff-plot --autonomous`, inheriting `FAFF_RUN_DIR` | skill routing row | kept in prose |
| T30 | After plot: re-read coverage, logged; failure → unmeasurable, never "done" | C13 | kept |
| T31 | After plot: record licence (and container) via `run-record-prd`; non-zero fails loud, build nothing | C14 → `record-failed` | kept |
| T32 | Converge: fall through to tidy → prep → build; still-thin is not a stop; unconditional at L4 | skill routing row | kept in prose |
| T33 | `drain` → record licence when non-null; null is a no-op; non-zero fails loud | B11 | kept |
| T34 | `refuse` → record and surface the reason; exit §0a before any tracker write; leave `runDir` untouched (never close it) | `refuse`, exit 3; `run-ledger.json` byte-unchanged, no close; only capture events and `trigger/` inputs written | changed: "untouched" stated as ledger-unchanged-and-not-closed |
| T39 | (silent) plot refuses or errors on the `plan` branch | skill routing row: surface, no `--after-plan`, start nothing | changed: gap closed |
| T35 | Capture `run-outward` and `run-start` with the decide driver under `__run__`, then action markers | B6, B9, B10, C15 in-process mint and marker | changed: done by the command |
| T36 | run-outward marker: `outward-adopter` if the run proceeded outward, else the inward token | B10: `outward-adopter` iff `signals.outward` | changed: "proceeded outward" made exact |
| T37 | L4-guard invariant: L3 skips §0a; `run-start` never consulted; level from the inherited ledger only | `skip` test asserts no spawn | kept (paragraph stays, shortened) |
| T38 | A `FAFF_RUN_DIR` naming no readable L4 ledger is a fault, not a silent skip | T3's test | kept |

Counts: 39 rows; 31 kept (4 of them kept in prose), 8 changed (T10, T11, T18, T25, T34, T35, T36, T39), 0 dropped. Corpus replay: not applicable; the post-fix corpus holds zero real `run-start` decisions.

## 7. DONE

### From WHY
- [ ] `faff-beep-boop/SKILL.md` §0a calls `faff run trigger` and routes on `token` in place of steps 0–7 and the capture note, and `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the new count.
- [ ] `faff validate-adapters` passes with no RATCHET finding for `faff-beep-boop` or `faff-plot`.

### From WHAT
- [ ] `faff run trigger --json` prints a TriggerResult with every field in §3 and exits 0, 3 or 2 per §3.
- [ ] `run-trigger.ts` is in `tsconfig.json` `include`, with committed `run-trigger.js` and `build-manifest.json`; `check-no-boundary-cast` passes and its test pins `run-trigger.ts`.
- [ ] `TEST_FILE_COVERAGE.run` names `test/run-trigger.test.mjs`; `faff regions check` and `faff lint-cli-coverage` pass; no selftest block gains a case.
- [ ] The PR diff touches no `commissaire*` file and no line of `run-start.js`, `run-outward.js` or `contract-defs-prd.js`.

### From HOW
- [ ] `decideTrigger` yields signals that drive `faff run-start` to each of the eight verdict × reason pairs, plus `needs-judgement:prd-inputs`.
- [ ] With `FAFF_RUN_DIR` unset, `runTrigger` returns `skip` and its injected spawn is never called.
- [ ] `faff-plot/SKILL.md` no longer references "§0a … steps 1–2".
- [ ] `docs/guide/cli.md` has a `run trigger` row.

### Rule inventory
- [ ] Every line the PR deletes from `faff-beep-boop/SKILL.md` maps to a row T1–T39; the PR description lists the deleted line ranges against row ids.
- [ ] Every `kept` and `changed` row other than the five "kept in prose" or skill-routing rows (T19, T22, T29, T32, T39) has a covering test that exists and passes; those five are checked by the PR description quoting the SKILL.md line that carries each.

### Tests
- [ ] `test/run-trigger.test.mjs`, `test/run-checkpoint.test.mjs` and `test/run-summary.test.mjs` pass under `node --test`.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. One TypeScript verb with a pure decision function, one test file and edits to two SKILL.md files. A 1–3 day unit.
- **Workstream fit?** No issues. Collapse 10 of the 2026-10-22 review's prose-to-command lane, beside FAFF-1413's run verbs.
- **Deps surfaced?** FAFF-1436 is merged (#1169), so `run.ts` has the verb table this extends. FAFF-1437 (`run open`/`run close`) and FAFF-1434 touch the same shared files (`SKILL_LINE_BASELINE`, `run.ts`, `TEST_FILE_COVERAGE`, `tsconfig.json`, `docs/guide/cli.md`) with no logic overlap; whichever lands second rebases. Building after FAFF-1437 (High) saves FAFF-1437 a rebase; the build agent of whichever ticket lands second owns the rebase. FAFF-1442, if it lands first, adds a byte baseline this lowers.
- **Risk profile?** Low. L4-only; the L3 path is a classifier return pinned by a no-spawn test. The two tightenings (empty goals, failed `prd list`) move toward `refuse` only.
