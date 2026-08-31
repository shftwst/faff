# FAFF-826 — Measure orchestration fidelity with a read-only shadow comparison

> Spec: faffter-dark-nlspec · 2026-08-31 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-826.

*Refreshed 2026-08-31 — FAFF-947 shipped (merged `f490f46d`), widening `decision-capture`'s registry to the nine decision-kernel predicates. This refresh grows the in-scope replay set from four kernels to nine, expands the replay-adapter table to match, shrinks the uninstrumented-gap list to zero (three commands are now set aside with reasons rather than listed as gaps), and records Punt 1 as resolved (widen-first chosen and shipped). The architecture — committed-corpus boundary, coverage strata, divergence matrix, cost snapshotting, read-only safety, and the `input-uncaptured` guard — is unchanged.*

## Why

The v5 "safe progressive autonomy" programme will only build a coordinator if a measured problem justifies it. Gate 1's coordination question is blunt: does explicit coordination remove a wrong or wasteful divergence, cut orchestration cost, or improve retry and resume behaviour enough to pay for a new loop, new state, and a migration? Today the prompt-driven orchestrator makes the queue, eligibility, termination, and next-step decisions by calling pure kernel functions, but nobody has measured whether the orchestrator actually follows those kernels or drifts from them, and at what cost.

FAFF-826 answers that with evidence rather than opinion. It replays the inputs the orchestrator already fed to the deterministic kernels, recomputes what the kernel prescribed, and compares that against the action the orchestrator actually took. Where they agree, a coordinator adds no *correctness* value for that decision — though it may still cut orchestration cost, which the study measures as a separate axis. Where they diverge, the study grades the divergence by how much it cost. The output is the first hard input to the Gate 1 decision, and a null or negative result (the kernels already govern these decisions faithfully) is a first-class outcome, not a failure.

The capture layer this study reads from already ships. FAFF-821 instrumented the orchestrator's decision points read-only, and FAFF-947 widened that instrumentation to the full decision-kernel set; this ticket builds the analysis that consumes those captures. It writes nothing an operator or the orchestrator can trip on.

## What

A read-only analysis that turns a set of captured decisions into a coordination-fidelity result. It performs five jobs over the captured decision set:

1. replay each captured decision's normalised inputs through the same versioned kernel function that produced the capture;
2. keep only the decisions that can be replayed, and report the rest as coverage strata (uncovered, missing-input) rather than divergences;
3. compare the kernel-prescribed action against the recorded actual action, and grade any divergence by decision kind and material consequence;
4. attach the orchestration cost of the surrounding run (operator intervention, retry, resume, latency, token spend) read from artifacts that already exist; and
5. publish a protocol written before the results, the exact boundary of the decision set it ran against, and the result, all reproducible from a clean checkout.

**Chosen:** the in-scope decision set is the nine kernels that are both instrumented and classified `decision-kernel`: `next`, `eligible`, `run-done`, `queue-state`, `claim-verdict`, `park-verdict`, `project-next`, `run-outward`, `run-start`. The decision-capture registry (`plugin/skills/faff/bin/lib/decision-capture.js`, `KERNEL_REGISTRY`) instruments eleven kernels after FAFF-947: the nine above plus `tier` and `regions`. The state-authority map (`docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`) classifies `tier` as `software-delivery-policy` and `regions` as `harness-and-skill-orchestration`, not `decision-kernel`. Only the intersection of "actually captured" and "classified `decision-kernel`" is a candidate for coordinator transition. `tier` and `regions` captures, if present, are counted and set aside with a stated reason; they are not coordinator-transition decisions.

**Chosen:** the coverage of the decision-kernel surface is complete — every `decision-kernel` command the map names is either instrumented and in scope, or set aside with a stated reason; none is left as an uninstrumented gap. The map classifies twelve commands `decision-kernel`. Nine are now instrumented and replayable (FAFF-947 closed the gap the four-kernel version of this spec reported). The remaining three are set aside, not gaps to backfill:
- `state` — a read-model producer, not a prescribe-an-action predicate: it reads the live filesystem and emits an issue's resolved state (with `status`/`eligible`/`blocked` fixed to `"unknown"`), so it returns no verdict to compare against `selected_action` and cannot be replayed from a captured `normalised_inputs` bundle. FAFF-947 set it aside for exactly this reason; its records classify `uncovered`.
- `run-ledger` — the standalone-interactive mint/outcome-record entry (a record writer, decision-adjacent), not a pure prescribe-an-action predicate.
- `decision-capture` — the instrumentation itself, not a decision the shadow would replay.

This is the ticket's acceptance line that missing instrumentation must not be scored as coordination value, now satisfied by *no missing instrumentation* on the replayable surface: every set-aside command contributes zero to the divergence tally and one line to the set-aside list, and both the in-scope set and the set-aside list are derived from the map + registry on every run, so they can never silently drift.

**Chosen:** the shadow compares the recorded actual action against a fresh replay, not against a re-run of the orchestrator. Each capture already stores the actual harness action in `selected_action` and the inputs in `normalised_inputs`. Replaying the inputs through the pure kernel yields the prescribed action. Divergence is prescribed-versus-actual. This is exactly what "fidelity" means here: whether the LLM orchestrator's chosen action matched the deterministic kernel's verdict for the same inputs.

**Chosen:** run the study on the widened, nine-kernel surface, not on four with the rest reported as a gap. This resolves the original Punt 1 ("run now on four vs widen instrumentation first"): the human chose to widen instrumentation before running the study so its power is not dominated by one or two kernels, and FAFF-947 shipped that widening (merged 2026-08-31). The study now replays all nine instrumented decision-kernel predicates; per-kernel replayable counts are still reported so a thin-coverage kernel is visible in the result rather than hidden.

## How

### The decision set and its boundary

The captured decisions live as `decision-capture` events inside each run's append-only log at `.faff/runs/<run-id>/events.jsonl`, written by `decision-capture record` through `events.js`. `decision-capture export --out DIR` already reads every run under `.faff/runs`, re-redacts each record at the publish boundary, and writes two files: `decision-corpus.jsonl` (one record per line) and `manifest.json` carrying `version`, `generated_at`, `record_count`, and `corpus_sha256`.

**Chosen:** the boundary of the decision set is a `decision-capture export` bundle, and the exported `decision-corpus.jsonl` is committed into the report directory alongside its `manifest.json`, pinned by its `corpus_sha256`. Committing the corpus is load-bearing for reproducibility: `.faff/` is gitignored, so the live run directories the export was drawn from are absent on a clean checkout — re-exporting from them is impossible there. So the study runs against, and reproduces from, the committed corpus, not from live run directories. Reproduction reads the committed `decision-corpus.jsonl`, recomputes its `corpus_sha256`, asserts it matches the `manifest.json`, and re-runs the analysis; an identical hash guarantees identical input. This is the reproducible-from-clean-context property the acceptance boundary requires, resting on the export's existing integrity digest over bytes that now travel with the report rather than any new mechanism.

**Assumes:** decision-capture was enabled for the runs in the bundle (config `capture.decision_kernel` set to `on`). Capture is off by default. Check: the export manifest's `record_count`. A zero or near-zero count is reported as "capture was off or sparse for the observation window," a null result, and the study does not dress an empty set up as agreement.

### Versioned replay

**Chosen:** a replay-adapter table keyed by `(kernel, kernel_version)` maps each captured record to the real exported pure function of that version and normalises its output to the recorded action vocabulary. The study imports and calls the actual kernels, it never reimplements them. The table reuses the same three shape families FAFF-947 recorded in the registry — positional args, an options object, or a normalize-then-derive flat bundle:

| Kernel | Captured `kernel_version` | Function called | Input adaptation | Output normalisation |
|---|---|---|---|---|
| `next` | `next@1` | `next.js :: nextStep(opts)` | pass `normalised_inputs` as the options object | take the verdict, the first element of the returned `[verdict, reason]` tuple |
| `eligible` | `eligible@1` | `eligible.js :: automationEligible(labels, automationDefault, trackerPresent)` | object to positional args, in that order | boolean to the recorded action vocabulary |
| `run-done` | `run-done@1` | `run-done.js :: computeRunDoneVerdict(rawSignals, policy)` | pass `normalised_inputs` as `rawSignals` | take `verdict` from the returned object |
| `queue-state` | `queue-state@1` | `queue-state.js :: deriveQueueState(opts)` | pass `normalised_inputs` as the options object | the `{queue_empty, all_parked}` pair |
| `claim-verdict` | `claim-verdict@1` | `claim-verdict.js :: claimVerdict(claimedAtISO, nowISO, ttlHours)` | object to positional args, in that order | the returned claim verdict |
| `park-verdict` | `park-verdict@1` | `park-verdict.js :: parkVerdict(status, draftPr, parkComment, humanTakeover)` | object to positional args, in that order | the returned park verdict |
| `project-next` | `project-next@1` | `project-next.js :: projectNext(opts)` | pass `normalised_inputs` as the options object | the returned project-next verdict |
| `run-outward` | `run-outward@1` | `run-outward.js :: decideOutward(targetRaw, selfRaw)` | pass the two captured resolved references as positional args, in that order | the returned outward verdict |
| `run-start` | `run-start@1` | `run-start.js :: deriveRunTrigger(normalizeRunTriggerSignals(raw))` | pass `normalised_inputs` as the flat signal bundle through the normalize step | the returned run-trigger verdict |

Two of the new rows carry a shape note FAFF-947 established and the adapter must honour:
- **`run-outward` is positional, not a flat bundle.** `decideOutward` takes two arguments, each normalised into a nested reference object (`{container, repo, source}` and `{container, repo, is_self}`) whose keys collide on `container`/`repo`; a single flat signal list cannot disambiguate them. Each captured resolved reference is passed whole under its argument name. `normalizeTargetRef`/`normalizeSelfRef` are idempotent on an already-resolved reference, so re-normalising a captured reference on replay is a no-op.
- **`run-start` is normalize-then-derive**, like `run-done`. One difference the adapter must honour: `computeRunDoneVerdict` normalizes its raw signals INTERNALLY, whereas `deriveRunTrigger` requires an already-normalized bundle, so the adapter calls `normalizeRunTriggerSignals` EXTERNALLY before `deriveRunTrigger`. Both bindings pass the captured flat signal bundle; only where the normalize step runs differs.

**Chosen:** a record whose `(kernel, kernel_version)` the table cannot match is a version-skew observation, excluded from divergence, counted separately. Only `@1` versions exist in the tree today. If a kernel later ships `next@2` and the bundle still holds `next@1` captures, replaying old inputs through the new function is meaningless. The adapter asserts the in-tree kernel still exports the captured version (the version string decision-capture stamps, sourced from `KERNEL_REGISTRY`); a mismatch is reported, never divergence-graded. This is what "replay through the same versioned kernel that produced the capture" means in practice.

**Chosen:** any kernel input that changes the verdict but sits outside that kernel's `required_inputs` — an "uncaptured-optional-input" — is flagged `input-uncaptured` and excluded from divergence when the capture did not record it. The study derives this exclusion set structurally: for each kernel it compares the set of inputs the function actually reads against that kernel's `required_inputs`, and any input read-but-not-required is a guard case. Re-scanned across the full nine-kernel set at this refresh, exactly two cases exist — the five kernels FAFF-947 added introduce none, because each of their `required_inputs` lists is the function's complete read-set (verified against the source):
- `run-done`'s second argument `policy` (`computeRunDoneVerdict(rawSignals, policy)`) is a methodology override outside `required_inputs`; a record produced under a non-default policy the capture did not record would, replayed against the default ladder, manufacture a false divergence.
- `next`'s `awaitingSpecReview` — `nextStep` destructures seven keys (FAFF-900 added this one) while `KERNEL_REGISTRY.next.required_inputs` still lists six, so `awaitingSpecReview` is an optional input that changes the verdict (an outage-hold routes to `prep`) and is outside `required_inputs`. A record whose real decision was an outage-hold but whose capture omitted the key would replay through the branch as false — a false divergence the version-skew guard cannot catch, because the kernel gained the key within `next@1` without a version bump.

Deriving the exclusion set structurally rather than hardcoding these two is what keeps the guard correct as the kernels evolve: a future optional input on any kernel is guarded the same way rather than silently manufacturing divergences. A record missing any such input for its kernel is `input-uncaptured` and excluded; the exclusion is counted and reported, never scored as divergence.

The two current cases are detected differently, and the protocol states the rule per kernel. `next`'s `awaitingSpecReview` is an options-object key, so its presence or absence is read directly off the captured `normalised_inputs`. `run-done`'s `policy` is a second positional argument the record has no slot for (the capture maps `normalised_inputs` onto `rawSignals` only), so it cannot be read off the record shape. The study therefore treats a `run-done` record as `policy-uncaptured` only when the run's methodology is independently known to be non-default (read from the run's config or ledger); absent that signal it assumes the structural-default ladder and records that assumption in the protocol, so the default-versus-non-default call is a stated protocol rule the human ratifies, never a silent guess.

### Coverage strata, then divergence

The capture already classifies every record via `classifyCoverage` into `replayable`, `non-replayable` (required inputs missing), or `uncovered` (kernel not in the registry).

**Chosen:** the study reports the ticket's three coverage classes by mapping the capture's `non-replayable` onto `missing-input`. The capture's `non-replayable` is populated exactly when required inputs are absent (`classifyCoverage` returns it with a non-empty `missing_inputs` list), which is the ticket's `missing-input`. So the three published classes are `replayable`, `uncovered`, and `missing-input`, aligned one-to-one with the capture vocabulary. Only `replayable` records enter the comparison; `uncovered` and `missing-input` are counted and reported, never scored as divergence. A set-aside command's records (e.g. `state`, if it were ever recorded) classify `uncovered` — the same stratum, never a divergence.

**Chosen:** divergence is attributed by decision kind and material consequence. Decision kind is the kernel name. For each replayable record the study compares the normalised prescribed action against the normalised recorded `selected_action`:

- **agreement**: prescribed equals actual. The baseline; the honest majority outcome for a faithfully-followed kernel.
- **divergence**: prescribed differs from actual, then graded by consequence:
  - **harmless**: the actual action reaches the same durable outcome as the prescribed one (an equivalent route), so a coordinator forcing the kernel verdict would have changed nothing that mattered.
  - **wasteful**: the actual action added avoidable work or cost (an extra attempt, an unnecessary park, a continued run that the kernel would have completed), but did not produce a wrong durable result.
  - **wrong**: the actual action risked or produced an incorrect or unsafe durable outcome the kernel verdict would have prevented.

The result is a matrix of decision kind against consequence, with raw counts and denominators, over all nine in-scope kernels.

**Punt:** the exact boundary between wasteful and wrong per kernel. The study ships a default rule-set (for example, an `eligible` divergence that let an ineligible ticket be touched is `wrong`; a `run-done` `continue`-versus-`run-complete` divergence that only burned budget is `wasteful`; a `claim-verdict` divergence that reclaimed a still-live claim is `wrong`, one that re-acquired a genuinely-stale claim a beat early is `wasteful`). Which side of the line each specific per-kernel case falls on — for all nine kernels, including the five FAFF-947 added — is a judgement the human ratifies before results are read, because it directly shapes the Gate 1 answer. The protocol states the default rules; the human confirms or amends them, and that confirmation is recorded in the protocol before any result is generated.

### Keeping judgement out of the deterministic classification

**Chosen:** the study only replays the nine already-deterministic kernels, so no judgement decision is ever forced into the state machine. The orchestrator's LLM judgement steps (spec confidence, taste calls, anything a worker decided by reasoning) were never captured, because decision-capture only instruments the named kernels. Those decisions surface as `uncovered` or as set-aside commands, never as divergences, and the study never recomputes a judgement decision. Where a kernel itself hands off to a human (for example `nextStep` returning `needs-human` for a medium-confidence spec), that handoff is the kernel's own deterministic prescription and is compared faithfully; the study does not second-guess the human step behind it.

### Orchestration cost, from existing artifacts

**Chosen:** intervention, retry, resume, latency, and token cost are read from artifacts that already exist, with no new instrumentation.

| Signal | Source | Reader precedent |
|---|---|---|
| operator intervention | `needs-human` / park events and the parks block; run-end disposition | `disposition.js`, `park-history.js :: extractParksBlock` |
| retry | attempts per issue in the run ledger | `budget.js :: attemptsFromLedger` |
| resume | run-segment records and resume events in the ledger and event log | `resume.js`, the run-segment IDs in `run-ledger.json` |
| latency | `ts` and `seq` on each event (`seq` authoritative order, `ts` best-effort elapsed time) | `events.js` envelope |
| token cost | per-run and per-attempt spend from transcripts and the ledger | `economics.js` / `budget.js :: measureRunSpend` |

The study reads these from the same `.faff/runs/<run-id>` artifacts the export drew from, joining each captured decision to its run via the record envelope's `run_id`. It builds no new meter and touches no producer.

**Chosen:** the cost signals are computed once and snapshotted as recorded values in `result.json`, because the run artifacts they come from are gitignored and absent on a clean checkout. The corpus digest covers only the decision-capture records, not the ledger/transcript/event artifacts the five cost readers consume, so cost cannot be recomputed from a clean checkout. Rather than bundle and hash those larger artifacts, the study records the computed cost values into `result.json` at analysis time and treats them as frozen outputs. Reproduction therefore asserts byte-identical **corpus-derived** outputs (coverage counts, the divergence matrix, the exclusion lists) recomputed from the committed corpus, and reads the **snapshotted cost values** back from `result.json` rather than recomputing them; where the source run artifacts happen to still be present, cost recomputation is a best-effort cross-check, never the reproducibility guarantee. The report states plainly that cost is a recorded observation joined to the corpus, not a content-addressed reproducible output.

### The safety boundary, guaranteed by construction

**Chosen:** the analysis is a pure `region:factory` `decision-kernel` module that reads files and imports pure kernel functions, and does nothing else. It issues no assignment, no tracker mutation, no protected effect, no merge, and no canonical decision, because it has no code path that could: it does not require the tracker/MCP layer, the effects ledger, the merge gate, or any durable writer. Its inputs are the exported bundle and the read-only run artifacts; its only writes are the report files under `verification/`. This mirrors the read-only posture of `economics.js`, `disposition.js`, and `runcheck` (filesystem reads only, writes nothing to canonical state). Every one of the nine kernel functions it imports is itself pure (verified: their only `fs`/`console` occurrences sit in `cmd*` CLI shells and `*Selftest` blocks, never the pure cores), so importing and calling them causes no side effect. Rollback is trivial and already named in the technical design: decision capture and shadow coordination disable without changing any action.

### Where the deliverables live

**Chosen:** a new pure analysis module plus a published report directory.

- `plugin/skills/faff/bin/lib/shadow-fidelity.js`: the read-only analysis, wired as `faff shadow-fidelity` in `plugin/skills/faff/bin/faff` alongside `decision-capture` and `economics`. It carries a `--selftest` covering the replay-adapter table (all nine kernels), the coverage-to-report mapping, the divergence grading, and the version-skew and `input-uncaptured` exclusions, following the in-process pure-core test convention every kernel in this family uses.
- `verification/reports/FAFF-826-coordination-fidelity/`: the published deliverables, mirroring the `verification/reports/mcp-call-census` shape (a machine result plus a human report):
  - `protocol.md`: the observation window, inclusion rules, kernel versions, input requirements, action-normalisation rules, the ratified consequence rules, and the coverage definitions, written and committed before results.
  - `decision-corpus.jsonl`: the exported corpus itself, committed so the study reproduces from it (the live run directories are gitignored and absent on a clean checkout).
  - `manifest.json`: the pinned bundle boundary (`corpus_sha256`, `record_count`, run IDs).
  - `result.json`: the coverage counts, the decision-kind-by-consequence matrix, the snapshotted cost signals, and the exclusion lists (version-skew, `input-uncaptured`, set-aside).
  - `report.md`: the narrative result, including null and negative findings and the explicit statement of which decisions, if any, carry enough evidence to justify a future bounded coordinator.
- The master RFC names "the coordination-fidelity protocol and result" as a Phase 1 deliverable; `report.md` cross-references it from `docs/rfc/rfc-superdomestique-runtime/v5/`.

## Scenarios

**A replayable agreement (the expected majority case)**
Given a captured `next` decision with `kernel_version` `next@1`, all six required inputs present, coverage `replayable`, and `selected_action` `graft`,
When the study replays `normalised_inputs` through `nextStep` and normalises the verdict,
Then the prescribed action is `graft`, the record is scored `agreement`, and it contributes to the `next` denominator with no divergence.

**A newly-covered kernel replays through its real function**
Given a captured `run-outward` decision with `kernel_version` `run-outward@1`, both `targetRaw` and `selfRaw` present, coverage `replayable`,
When the study replays the two captured resolved references positionally through `decideOutward`,
Then the prescribed outward verdict is compared against the recorded `selected_action` and scored `agreement` or divergence like any other in-scope kernel — the five FAFF-947 kernels are full first-class members of the replay set.

**A wasteful divergence**
Given a captured `run-done` decision, coverage `replayable`, no captured policy, whose recorded `selected_action` is `continue` while the default-ladder replay prescribes `run-complete`,
When the study grades the divergence against the ratified consequence rules and joins the run's token spend,
Then it is recorded under decision kind `run-done`, consequence `wasteful`, with the attached extra token cost of the continued run.

**A missing-input record is not a divergence**
Given a captured `next` decision whose `normalised_inputs` omit `blocked` and `eligible`, so `classifyCoverage` returned `non-replayable`,
When the study processes the bundle,
Then the record is counted under `missing-input` with its exact missing set, is never replayed, and never appears in the divergence matrix.

**A set-aside decision-kernel command is uncovered, not a divergence**
Given the state-authority map classifies `state` as `decision-kernel` but it is set aside (a read-model producer, absent from the registry), and the bundle contains a `state` record,
When the study processes the bundle,
Then the record classifies `uncovered`, appears in the set-aside list with its stated reason, and contributes nothing to any agreement or divergence count.

**Version skew is excluded, not divergence-graded**
Given the tree has advanced `next` to `next@2` while the bundle holds `next@1` captures,
When the replay-adapter checks the in-tree exported version against each record's `kernel_version`,
Then the `next@1` records are listed as version-skew, excluded from divergence, and the report states the skew rather than reporting a false divergence spike.

**Reproduction from a clean context**
Given a fresh checkout with the committed `decision-corpus.jsonl`, `manifest.json`, and `result.json`, and no `.faff/` run directories present,
When the study recomputes the corpus's `corpus_sha256`, asserts it matches the manifest, and re-runs `faff shadow-fidelity` over the committed corpus,
Then the hash matches and the corpus-derived outputs (coverage counts, divergence matrix, exclusion lists) are byte-identical, and the snapshotted cost values are read back from `result.json` unchanged.

**An uncaptured optional input is excluded, not a false divergence**
Given a captured `next` decision whose real outcome was an outage-hold routed to `prep`, but whose `normalised_inputs` omit `awaitingSpecReview` (an optional input outside `next`'s `required_inputs`),
When the study checks each replayable record for an uncaptured optional input its kernel reads,
Then the record is flagged `input-uncaptured`, excluded from divergence, and counted separately — the same guard the `run-done` `policy` case uses — rather than replaying as a false divergence.

**An empty bundle is a null result**
Given `capture.decision_kernel` was off for the observation window, so the export manifest `record_count` is 0,
When the study runs,
Then it reports "no captured decisions: capture was off," makes no fidelity claim, and does not count the absence as agreement or as coordination value.

## Done

- [ ] `faff shadow-fidelity` exists as a pure, read-only `region:factory` module, wired in `plugin/skills/faff/bin/faff`, that reads a `decision-capture export` bundle and the referenced run artifacts and writes nothing to any canonical state (no assignment, tracker mutation, protected effect, merge, or canonical decision).
- [ ] It replays each `replayable` record through the real exported kernel function for that record's `(kernel, kernel_version)` across all nine in-scope kernels: `nextStep`, `automationEligible`, `computeRunDoneVerdict`, `deriveQueueState`, `claimVerdict`, `parkVerdict`, `projectNext`, `decideOutward`, and `deriveRunTrigger ∘ normalizeRunTriggerSignals`; it imports these, and reimplements none. `run-outward` is passed positionally (its two nested refs collide on `container`/`repo`); `run-start` is normalize-then-derive like `run-done`.
- [ ] Records whose version the adapter cannot match are reported as version-skew and excluded from divergence; records missing any optional input their kernel reads that is outside its `required_inputs` are flagged `input-uncaptured` and excluded — derived structurally over the nine-kernel set, which today yields exactly two cases (`run-done`'s `policy` and `next`'s `awaitingSpecReview`; the five FAFF-947 kernels add none).
- [ ] The result reports three coverage classes (`replayable`, `uncovered`, `missing-input`) with raw counts, mapping the capture's `non-replayable` onto `missing-input`; only `replayable` records are compared.
- [ ] Divergence is attributed as a decision-kind (kernel name) by consequence (`harmless` / `wasteful` / `wrong`) matrix with counts and denominators over the nine in-scope kernels, against consequence rules ratified in the protocol before results were generated.
- [ ] The nine kernels are in scope; `tier` and `regions` captures are counted and set aside with a stated reason; the decision-kernel surface has no uninstrumented gap — the three non-replayable `decision-kernel` commands (`state`, a read-model; `run-ledger`, a record-mint entry; `decision-capture`, the instrumentation) are set aside with reasons, derived from the map + registry each run, never hardcoded; none is scored as agreement or coordination value.
- [ ] Operator intervention, retry, resume, latency, and token cost are read from existing artifacts (parks/disposition, `attemptsFromLedger`, run-segment/resume records, event `ts`/`seq`, `measureRunSpend`) with no new instrumentation.
- [ ] `verification/reports/FAFF-826-coordination-fidelity/` holds `protocol.md` (committed before results), the committed `decision-corpus.jsonl`, `manifest.json` (pinned `corpus_sha256`, `record_count`, run IDs), `result.json`, and `report.md`; `report.md` states which decisions, if any, have enough evidence to justify a future bounded coordinator, and keeps null and negative results visible.
- [ ] The published result reproduces from a clean checkout (no `.faff/` runs present): recomputing the committed corpus's `corpus_sha256` matches the manifest, re-running over the committed corpus yields byte-identical corpus-derived outputs (counts, matrix, exclusion lists), and the snapshotted cost values are read back from `result.json` unchanged; cost is a recorded observation joined to the corpus, not a content-addressed reproducible output.
- [ ] `--selftest` covers the replay-adapter table (all nine kernels), the coverage-to-report mapping, the divergence grading, and the version-skew and `input-uncaptured` exclusions (both `run-done` `policy` and `next` `awaitingSpecReview`).
- [ ] An empty or capture-off bundle produces a stated null result, not a pass.

## Open questions and assumptions

**Punt:** the exact per-kernel boundary between `wasteful` and `wrong`, ratified in the protocol before results are generated — now spanning all nine in-scope kernels, including the five FAFF-947 added.

**Assumes:** decision-capture was enabled (`capture.decision_kernel: on`) for the runs in the bundle. *Validation:* the export manifest `record_count`; a zero/near-zero count is reported as a null result, never as agreement.

confidence: high
spec-review: approve
build-tier: complex
