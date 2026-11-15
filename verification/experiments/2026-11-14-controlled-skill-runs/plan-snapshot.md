# Controlled skill runs implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Production migration remains paused until the outstanding work lands and the release is cut. This plan covers evaluation tools and fixtures only.

**Goal:** Produce bounded, reproducible Claude runs that measure the released prose and a later CLI extraction on identical inputs, with independently checked effects and complete usage accounting.

**Architecture:** An external scenario registry defines required coverage and expected outcomes. Each execution gets its own tracker and filesystem fixture; the host records tool attempts, responses and resulting state. A bounded Claude adapter executes the unchanged prose against these ports. The comparison checks each execution against its obligations before comparing old and new.

**Tech stack:** Node built-ins, existing ESM eval helpers, `node --test`, Claude Code on an authenticated host. New tools stay under `eval/`; no shipped CLI module changes.

**Spec:** [Migration audit](../../../verification/audits/2026-11-14-skill-determinism/implementation-plan.md), [adversarial review](../../../verification/audits/2026-11-14-skill-determinism/astra-adversarial-review.md), [sealed baseline](../../../verification/baselines/skill-determinism/pre-release-f767bdd1/README.md).

## Current state and launch decision

| Item | State |
|---|---|
| Pinned pre-release source | `f767bdd1c0a78f6259c335742c1567a074f512a0` at `/Users/shftwst/.codex/worktrees/a713/faff` |
| Static baseline and existing tests | Captured and sealed; retain unchanged |
| Evaluation model setting | `claude-opus-5-5`, effort `medium`, resolved from the repository configuration |
| Provider support for that identifier and effort | Must be verified on the execution host; configuration is not proof of availability |
| Claude executable in this environment | Absent |
| Draft trace comparator | Present, but known coverage, terminal-evidence and unsafe-number gaps prevent use as an acceptance gate |
| Existing judgement runner | Useful rubric tests; lacks the effect and usage capture required here |
| Live controlled runs | Not started |
| Production changes | Remain paused |

Planning and independent review use x-high where available. Deterministic tests use no model. The initial Claude execution setting is the explicit model and medium effort above. Confirm the production lane's dispatch settings before treating this as a production baseline; any other lane settings become separate comparison strata. Never replace an unavailable model with an account default.

**Launch decision now:** proceed with fixture and harness preparation. Start the five-execution baseline calibration only after the readiness checks below pass on a Claude-capable host. This can happen before the in-flight merges. A released commit and a candidate are required for the later migration comparison, not for calibration.

## Global constraints

- Keep the sealed baseline unchanged and preserve its source worktree. Put evaluation work in an isolated branch/worktree or as separate evaluation files; do not alter skill bodies, defaults, production modules or installations.
- No live tracker writes, production branches, merges or deployments during controlled runs. Snapshot real inputs read-only; execute effects against isolated targets.
- Test names and results must distinguish synthetic fixtures, historical observations, scripted recorder checks, real-model checkpoint runs and complete workflows.
- Node 20 remains the emitted-runtime floor. Use ESM under `eval/` and tests under `test/`. New `plugin/skills/faff/bin/lib/` modules, if later authorised, require TypeScript and committed emit; none is needed here.
- Preserve raw evidence. Missing usage, model identity, effect result or scenario coverage produces an incomplete result, never success or an imputed zero.
- Preserve operator Git identity and signed-off commits when committing. No commits or publication are required for this planning phase.

## Review focus

| Failure condition | Required behaviour | Owning task |
|---|---|---|
| Both captures omit the same case, or carry an unsafe integer | Reject before comparison | 1 |
| A write succeeds but its acknowledgement is lost | Record actual state and uncertainty; expose an unnecessary retry | 2 |
| The model claims completion without the required state | Independent state inspection rejects the claim | 2 |
| A child process hangs, changes model or stops reporting usage | Stop with preserved evidence; do not expand the batch | 3 |
| Runtime instructions, cache state or fixtures differ between arms | Report an unpaired comparison or separate treatment | 4 |

## Cases and evidence boundaries

The first paid calibration uses five comment-handling families: create when no managed comment exists; preserve human text around a complete pair; replace a legacy open-only region; reconcile duplicates by complete-pair preference and age; ignore a quoted or unmarked imitation. These are synthetic fixtures derived from current prose. Their independently written expected bodies must remain outside the model's input.

| Additional material | Use | Exclusion |
|---|---|---|
| Frozen historical decision inputs | Preserve real input shapes and identify missing context | Their recorded verdicts are not expected-outcome authorities |
| Existing judgement fixtures | Verify driver wiring and rubric handling | They do not establish full workflow behaviour or prefix savings |
| Fully frozen real tickets, comments, dependencies and Git revisions | Later realistic checkpoints and complete workflows | A ticket with missing state cannot pass a completeness check |
| Held-out cases | Later confirmation once development is stable | Create and reserve separately; exposed development cases cannot become unseen holdouts |

Indented markers, equal/missing timestamps, optional author preference, nested pairs and fenced marker text remain unresolved. Track them explicitly as blocked coverage. Resolve their intended policy before expanding the extraction's compatibility claim; do not invent expected outputs just to make the gate green.

Twenty pairs initially means five families with four repetitions each. Report five families and twenty paired executions separately. Repetition estimates variability on those inputs; it does not provide twenty independent task families or prove a population-wide two-percentage-point non-inferiority claim.

## File map

| File | Responsibility |
|---|---|
| `eval/control-parity/schema.mjs` | Strict values, registry validation, trace validation, independent obligations and comparison |
| `eval/control-parity/tracker.mjs` | Isolated mutable tracker, durable fixture state, fault injection and host-side capture |
| `eval/control-parity/claude-driver.mjs` | Prompt binding, isolated model invocation, streaming usage and bounded process lifecycle |
| `eval/control-parity/run.mjs` | Preflight, baseline calibration and paired scheduling; immutable result directories |
| `eval/control-parity/fixtures/review-comments.json` | Model-visible development inputs |
| `eval/control-parity/registry.json` | Required cases, input hashes, source obligations, expected effects and final state |
| `test/control-parity-schema.test.mjs` | Missing coverage, typed evidence, numeric and structural adversaries |
| `test/control-parity-tracker.test.mjs` | Actual effects, lost acknowledgement, restart and preservation failures |
| `test/control-parity-claude.test.mjs` | Fake-process transport, usage, limits, model identity and isolation |
| `test/control-parity-run.test.mjs` | Readiness, schedules, immutable output and stopping rules |

Keep the earlier `eval/control-parity.mjs` schema-1 comparator identifiable as a draft; do not silently grant it schema-2 acceptance authority. Reuse existing pure prompt and grading helpers where faithful. Do not use the existing read-only mock tracker's recorded mutation intent as evidence that an effect occurred.

## Task 1: Independent registry and strict comparison

**Interfaces:** `validateRegistry(value) -> Registry`; `validateTrace(trace, registryEntry) -> Validation`; `compareRuns(registry, baseline, candidate) -> {status, differences, coverage}`. Status is `pass`, `fail` or `incomplete`; CLI exits are 0, 1 and 2 respectively.

The registry names every required scenario, its input and policy hashes, source rule references, expected effect operations/arguments, expected terminal status and final state. A trace carries schema version, scenario/attempt identity, input/policy/prompt/runtime hashes, ordered events and host-observed final state. Terminal payloads require a status, a registry-defined reason code and final-state hash. Effect results reference exactly one preceding attempt and declare `applied`, `rejected` or `unknown`; unresolved attempts cannot support completion.

Preserve the complete raw execution separately. The semantic comparison includes tracker reads with their results, effect attempts/results and terminal state. Model explanations and pure local computation calls are outside that comparison, but remain in raw capture and cost accounting. Freeze this projection before comparing a candidate; never drop an inconvenient effect or reorder events to obtain equality. A baseline that violates an independent obligation is an existing defect to resolve, not a valid target to copy or an automatic licence to change behaviour.

- [ ] Write tests proving two runs that both omit required case B fail when the registry requires A and B. Reject duplicates and unexpected cases.
- [ ] Write tests rejecting empty terminal/result payloads, results before attempts, repeated result IDs, events after terminal and mismatched final-state hashes.
- [ ] Reject non-JSON values and numbers that can collapse distinct evidence. For this schema, numeric fields must be safe integers; monetary amounts use decimal strings or integer micro-units. Reject unsafe JSON numbers before equality; no coercion of IDs.
- [ ] Implement validation and comparison. Object key order may be canonicalised; arrays, effect order and string bytes must remain significant. Check each arm against the registry before comparing arms.
- [ ] Run `node --test test/control-parity-schema.test.mjs`. Prove the unmodified control passes and every seeded omission, bypass, changed body, swapped effect or unsafe-number example fails.

## Task 2: Observe actual effects in isolated fixtures

**Interfaces:** `createFixtureTracker({directory, initialState, faults}) -> {ports, readState, close}`; `captureScenario({driver, fixture, registryEntry, directory}) -> Trace`. The driver gets only declared ports and visible inputs; it cannot access the registry or host recorder.

- [ ] Write the five development inputs and separate expected outcomes, with exact human prefix/suffix strings and source references. Mark the cases synthetic. Hash both inputs and obligations before real-model runs.
- [ ] Write tests in which an attempted mutation never applies, an applied mutation loses its acknowledgement, a retry duplicates a create, and a driver returns completion without state changes. Require the observer and oracle to distinguish all four.
- [ ] Implement file-backed fixture state and record calls around actual operations, including errors. Read final state independently from disk after the driver returns. IDs and clock values belong to the fixture; do not normalise away meaningful differences.
- [ ] Add restart tests that reopen persisted state. Add a controlled concurrent human edit and prove a stale full-body replacement is visible as lost text. Do not invent remote compare-and-swap support to make the case safe.
- [ ] Run `node --test test/control-parity-tracker.test.mjs test/control-parity-schema.test.mjs`. Then run baseline-versus-baseline with an explicitly scripted control and decoy drivers. Label this recorder validation, not observed prose behaviour.

The fixture's persistence establishes local simulated effects only. Real connector pagination, CAS, readback and idempotency remain separate qualification requirements. An unresolved lost acknowledgement must allow a blocked outcome; a claim of exactly-once remote delivery is not available without a proved mechanism.

## Task 3: Bounded Claude adapter with real accounting

**Interfaces:** `probeClaude({binary, model, effort}) -> Capabilities`; `runClaudeScenario({ports, promptBundle, settings, limits, evidenceDirectory}) -> DriverResult`. Use an injected process adapter in tests so CI makes no model calls.

- [ ] Test missing binary, unsupported model/effort, non-zero exit, malformed/truncated event output, missing final record, timeout and signal interruption. Every path retains raw non-secret stdout/stderr and a terminal attempt record.
- [ ] Test streamed duplicate usage records: aggregate by request identity using final/max counters rather than summing cumulative copies. Preserve served model, input, cache-read/write buckets, output and available timing/cost fields. Test unknown cost separately from zero cost.
- [ ] Inspect the installed Claude version and help before selecting machine-readable output and tool-isolation flags. Verify parsing and invocation with fixtures before readiness. The first paid calibration scenario also serves as the live transport probe; retain its settings and usage and verify them before admitting the next scenario. Do not assume this checkout's old wrapper captures those fields.
- [ ] Bind exact skill-source bytes and their declared load closure for the tested checkpoint. Record any unavoidable harness instruction overhead separately. Restrict all available effects to fixture ports; no host shell, live MCP connections or production Git credentials. Verify this restriction with a planted escape request.
- [ ] Use a true tool adapter where the installed CLI supports controlled fixture tools. If a host-mediated completion loop is necessary, declare it as a checkpoint-specific measurement arm; it cannot certify native tool execution or full per-turn prefix savings. No silent adapter substitution.
- [ ] Implement hard attempt, turn and process-time limits, durable per-request progress and process-group termination. Do not inherit the judgement runner's adaptive escalation or change the output budget between arms.
- [ ] Run `node --test test/control-parity-claude.test.mjs`. Reconcile a captured usage fixture by hand and with the parser before any paid scenario.

Initial limits: one worker, at most five calibration attempts total, no automatic retry, at most twelve model turns per attempt, 8,192 output tokens per model request, ten minutes per attempt and sixty minutes for the batch including overhead. The first required scenario doubles as the transport probe; there is no extra paid ping. Confirm the selected model and adapter support the output ceiling; absent enforceable limits, readiness fails. Any changed limit creates a revised manifest before more calls.

The initial planning allowance is $10 for calibration, not an asserted price or prepaid authorisation. Verify pricing and the CLI's cost semantics before admission. Reserve a conservative worst-case request cost against remaining allowance before each request, including cache treatment and any applicable multipliers. If the CLI cannot expose or bound those charges, report the cap as unenforceable and stop before launch; do not present a CLI estimate as an invoice. A request whose usage is missing retains its reservation and prevents another request until reconciled.

## Task 4: Freeze readiness and run schedule

**Interfaces:** `prepareExperiment({sourceRoot, registry, settings, limits, out}) -> Manifest`; `preflight(manifest) -> Readiness`; `runBaseline(manifest, readiness) -> Report`; `runPairs(manifest, baselineRoot, candidateRoot, readiness) -> Report`.

- [ ] Write tests that source/fixture/settings changes invalidate readiness, existing output directories cannot be overwritten, a missing required case blocks launch, and a failed/unknown attempt cannot disappear from the denominator.
- [ ] Implement readiness binding to source commit/tree, source and runtime prompt hashes, registry, fixtures, binary/version, requested model/effort, available served-model evidence, isolation capabilities, parser version and limits. Store only hashes of private auth/config where needed; never credentials.
- [ ] Predeclare the exact attempt list and randomised order. Each pair uses identical fixture/policy/model/effort and independent environments. If the same baseline is reused after a candidate appears, also rerun the old source alongside the candidate to detect service drift.
- [ ] Record cache hits and misses from provider usage. New CLI config directories do not prove provider caches are cold. Use verified cache isolation if available; otherwise report observed cache strata and make no cold-cache causal claim. Never transfer task state or outputs between arms.
- [ ] Run `node --test test/control-parity-schema.test.mjs test/control-parity-tracker.test.mjs test/control-parity-claude.test.mjs test/control-parity-run.test.mjs`, then the existing unit suite. Keep the original signing workaround process-local if fixture commits require it.
- [ ] Obtain an independent review of the recorder, expectation independence, limits and failure paths. The earlier audit review does not count as review of newly written harness code.
- [ ] Freeze a readiness report. Mark `ready_for_baseline_calibration` only when the zero-cost checks pass. The report distinguishes fixture-tested transport from live transport not yet observed; the first calibration scenario resolves that distinction before further attempts. A candidate comparison additionally requires independently passing old and new outcomes, complete pair coverage and a declared semantic comparison.

## When to start

| Stage | Earliest start | Stop or completion condition |
|---|---|---|
| Fixture and recorder work | Now, before pending merges | Tasks 1 to 4 pass without production changes |
| Five baseline calibration attempts | Before merges if readiness passes on a Claude-capable host | Five attempts or first stop condition; no automatic expansion |
| Release baseline | After the released commit and package are identified | New source/discovery/config snapshot plus affected controls rerun |
| Five paired smoke cases | After the first candidate exists | Each arm satisfies obligations and capture is complete |
| Twenty paired checkpoint executions | After smoke and measured-cost review | Fixed schedule completes; failures remain visible |
| New production tickets | After checkpoint and relevant connector/workflow gates pass | Small monitored deployment; only one version writes production state |

No need to wait for new tickets to test a bounded operation. Fresh production tickets are a later practical check. The pinned source remains usable even if merges finish while harness work is underway.

## Claude runbook

Readiness checks that can be run now, on the host intended to execute Claude:

```bash
cd /Users/shftwst/.codex/worktrees/a713/faff
git rev-parse HEAD
claude --version
claude --help
node plugin/skills/faff/bin/faff config get eval.model
node plugin/skills/faff/bin/faff config get eval.effort
```

Expected source is `f767bdd1c0a78f6259c335742c1567a074f512a0`; expected configured arm is `claude-opus-5-5` and `medium`. Use the installed CLI's documented authentication check. If this worktree is not accessible from that host, create a separate checkout at the exact commit and copy the reviewed evaluation tools and manifests; record its path and hashes. Do not run from a moving main checkout.

**The following is the planned interface, not an existing runnable command.** Task 4 must implement and test it, then supply the actual manifest path and a fresh output directory:

```bash
node eval/control-parity/run.mjs preflight --manifest /absolute/path/experiment.json --out /absolute/path/preflight-new
node eval/control-parity/run.mjs baseline --manifest /absolute/path/experiment.json --readiness /absolute/path/preflight-new/readiness.json --out /absolute/path/calibration-new
```

The second command starts the bounded Claude executions automatically. No interactive switch of this planning chat's model is needed. Its manifest pins the Claude model and medium effort explicitly. Do not substitute the current `run-evals.mjs --gate` or `--update-baseline` commands: those have different scope, accounting and escalation behaviour.

Expected artifacts: manifest, readiness report, attempt schedule, per-attempt raw events and prompt/input hashes, usage ledger, effect traces, final state snapshots, oracle results, timing summary and failure/incomplete counts. End with `calibration_complete`, `failed` or `incomplete`; calibration completion alone does not approve migration.

## Time estimates and interpretation

Harness preparation and review are separate from model execution; no completion date is established by this plan. First calibrate measured runtime before scheduling a larger batch.

| Work | Planning duration |
|---|---|
| Existing deterministic suite | About 3 minutes, measured in the sealed baseline |
| Five baseline attempts at 5 to 10 minutes each, one worker | 25 to 50 minutes plus setup, bounded by the declared batch deadline |
| Five paired smoke cases, two isolated workers | Roughly 30 to 90 minutes including resets |
| Twenty paired executions, two workers | Roughly 2 to 4 hours including resets |
| Full build/review workflows | Measure a representative pilot first; checkpoint timings cannot predict them |

The model timing rows are assumptions, not measurements. Expand to two workers only after isolation, aggregate spend reservations and process-memory limits pass. Compare total usage/cost and elapsed time, including retries and failures; do not count a smaller prompt as a saving if output or retry growth consumes it. Default changes and model/effort changes remain separate experiments.

## Self-review and unresolved work

- The initial model identifier is configured but not provider-verified, and the configured eval arm is not automatically every production lane's dispatch arm.
- Existing sources establish the requested defects in the old runner: output-size estimates, escalation to fifty, read-only mutation recording and completion status that does not itself establish per-case success.
- The fixture tracker and Claude adapter are planned, not implemented. No paid baseline or ready-to-run migration gate is claimed.
- Indeterminate comment policies and remote connector guarantees remain explicit blockers to their own compatibility claims.
- Frozen historical inputs are development evidence, not unseen holdouts or complete tickets.
- The pre-release reference, released baseline and candidate comparison have distinct roles; pending merges are not migration effects.
