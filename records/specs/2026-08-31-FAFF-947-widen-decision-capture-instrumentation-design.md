# FAFF-947 — Widen decision-capture instrumentation to the remaining decision-kernel predicates

> Spec: faffter-dark-nlspec · 2026-08-31 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-947.

## Why

FAFF-821 shipped `faff decision-capture`: a read-only recorder that watches the orchestrator's pure decision functions, writes down the inputs each one saw and the action the harness actually took, and stamps every observation with a coverage class (`replayable` / `non-replayable` / `uncovered`). That data is the raw material for the FAFF-826 coordination-fidelity study, which will replay each recorded input bundle through the same pure function in shadow and check that a proposed new coordinator would have chosen the same action — the gate that has to go green before any decision can be cut over to a new implementation.

The study is only as good as its coverage. FAFF-821 seeded the recorder's registry with six kernels (`next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions`), but only four of those are the eligibility/queue/termination/next-step predicates the runtime's state-authority map actually classifies as the **decision kernel** (`next`, `eligible`, `queue-state`, `run-done`; `tier` is delivery-routing policy and `regions` is structural lint — both were seeded for breadth, neither is a decision-kernel predicate). The map names more decision-kernel predicates than that, and until they are in the registry every observation of them records as `uncovered` — invisible to the study.

This ticket widens the registry so the study runs on the fuller decision-kernel surface. It is a registry-declaration change: it tells the recorder how to classify observations of five more predicates, and keeps the recorder's own born-verifiable checks honest about the new set. It changes no behaviour of the four kernels already covered, adds no new capture side effects, and stays off by default exactly as FAFF-821 left it.

## What

The state-authority map (`docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`) classifies twelve commands as `decision-kernel`. Four are already in the registry. Of the remaining eight, two are excluded on principle and one does not fit the replay contract, leaving five predicates to add.

**Chosen:** add exactly five registry entries — `claim-verdict`, `park-verdict`, `project-next`, `run-outward`, `run-start`. Each is a pure function that takes a resolved input bundle and returns a prescribed verdict, which is precisely what the shadow study replays. Their contracts, verified against the source and each kernel's own selftest:

| New kernel | Pure function (module) | Call contract | Shape family |
|---|---|---|---|
| `claim-verdict` | `claimVerdict` (`claim-verdict.js`) | `claimVerdict(claimedAtISO, nowISO, ttlHours)` — 3 positional | positional |
| `park-verdict` | `parkVerdict` (`park-verdict.js`) | `parkVerdict(status, draftPr, parkComment, humanTakeover)` — 4 positional | positional |
| `project-next` | `projectNext` (`project-next.js`) | `projectNext({ current, kind, total, active, done, hasDod, dodMet })` — 7-key options object | options-object |
| `run-outward` | `decideOutward` (`run-outward.js`) | `decideOutward(targetRaw, selfRaw)` — 2 positional, each a resolved reference object | positional |
| `run-start` | `deriveRunTrigger` ∘ `normalizeRunTriggerSignals` (`run-start.js`) | `deriveRunTrigger(normalizeRunTriggerSignals(raw))` — normalize-then-derive over a 7-key flat signal bundle | normalize-then-derive |

**Chosen:** `state` is set aside, not instrumented — this is the load-bearing call. `faff state` (`state.js`) is classified `decision-kernel` by the map, but it does not fit the replay contract the other five satisfy, for two independent reasons, either of which is disqualifying:

- *It prescribes no action.* The shadow study replays a captured input bundle through a pure function and compares the function's verdict to the `selected_action` the harness took. `state` returns no verdict — it emits a **read-model**: the issue's resolved state (spec presence, eligibility, parked/blocked flags) rendered in `faff next`'s vocabulary, with `status`/`eligible`/`blocked` always the literal `"unknown"` (and `parked` a real disk-resolved value, not a decision output). It is the function that *produces the inputs* `faff next` later decides on; it sits upstream of a decision, it is not itself one. There is nothing to compare a replayed output against.
- *It is impure and cannot be replayed from a captured bundle.* `state`'s functions take `(root, issue)` and read the live filesystem (`fs.readdirSync`/`fs.readFileSync` over committed and git-only specs, `.faff/runs` park records and the ledger) and shell out to `git` (`spawnSync`). Its own banner states it plainly: local sources only, no tracker, no network, no mutation. To replay it you would have to reconstruct the exact filesystem and git state at capture time — which a `normalised_inputs` bundle neither carries nor could carry. The recorder captures a bundle of named values; `state`'s inputs are the disk.

`state` is therefore set aside for the same class of reason `run-ledger` and `decision-capture` are (below): the registry is the set of **pure prescribe-an-action predicates the study can replay**, and `state` is a read-model producer that belongs on the other side of that line.

**Chosen:** `run-ledger` and `decision-capture` stay excluded, consistent with the ticket and the map. Both are classified `decision-kernel` in the map but both carry `state_changing: yes` and neither prescribes an action from a captured bundle. `run-ledger` is the standalone-interactive mint/outcome-record entry point (its bytes land on `run-ledger.json` via `heartbeat.js`), and `decision-capture` is this very instrumentation. The map itself flags them as record-mint / instrumentation rows, not pure predicates — so the exclusion is derived from the map's own classification, not asserted.

**Assumes:** the map's decision-kernel set is the authoritative gap list, and this ticket closes it for the replayable members. Check: the map's `decision-kernel` rows are `claim-verdict`, `decision-capture`, `eligible`, `next`, `park-verdict`, `project-next`, `queue-state`, `run-done`, `run-ledger`, `run-outward`, `run-start`, `state` (verified by grep against `STATE-AUTHORITY-MAP-v5.md`). Subtract the four already registered, the two record-mint/instrumentation exclusions, and the one read-model, and exactly the five above remain. No decision-kernel predicate is left unaccounted for.

## How

### The registry entries

Each new entry follows the FAFF-821 shape exactly — a `version` string plus a `required_inputs` list — added to `KERNEL_REGISTRY` in `plugin/skills/faff/bin/lib/decision-capture.js`. The `required_inputs` list is what `classifyCoverage` uses: an observation whose `normalised_inputs` object carries every listed key is `replayable`; one missing any is `non-replayable` with the absent keys named; a kernel absent from the registry is `uncovered`.

The three shape families already present in the registry each dictate how `required_inputs` is derived, and every new entry reuses one of them:

- **Options-object kernels** (existing precedent: `next`, `queue-state`, `tier`) — `required_inputs` is the top-level option keys.
- **Positional kernels** (existing precedent: `eligible`, `regions`) — `required_inputs` is the positional parameter names, in order; each captured value is the whole argument, scalar or object.
- **Normalize-then-derive kernels** (existing precedent: `run-done`) — `required_inputs` is the flat named signal keys the normalize step reads, not the raw argument name.

The five entries, with `version` and `required_inputs` derived from the verified contracts and each kernel's selftest:

**Chosen:** `claim-verdict` (positional) — `version: "claim-verdict@1"`, `required_inputs: ["claimedAtISO", "nowISO", "ttlHours"]`. The three positional argument names of `claimVerdict`, in order, matching how `eligible` recorded its positional arguments.

**Chosen:** `park-verdict` (positional) — `version: "park-verdict@1"`, `required_inputs: ["status", "draftPr", "parkComment", "humanTakeover"]`. The four positional argument names of `parkVerdict`, in order.

**Chosen:** `project-next` (options-object) — `version: "project-next@1"`, `required_inputs: ["current", "kind", "total", "active", "done", "hasDod", "dodMet"]`. All seven top-level keys of `projectNext`'s options object. Unlike `tier` — where the registry deliberately dropped an optional key that contributes nothing when omitted — every one of these seven is load-bearing (`dodMet` gates the DoD-tightened Done path, `hasDod` guards it, the three counts drive the all-done rollup), so none is optional and all seven are required.

**Chosen:** `run-start` (normalize-then-derive) — `version: "run-start@1"`, `required_inputs: ["target_resolved", "outward", "prd_present", "prd_ambiguous", "prd_admissible", "coverage_measurable", "coverage_covered"]`. The seven flat signal keys `normalizeRunTriggerSignals` reads — the same normalize-then-derive treatment `run-done` received, since `run-start` is its mirror predicate and shares the shape.

**Chosen:** `run-outward` (positional, not normalize-then-derive) — `version: "run-outward@1"`, `required_inputs: ["targetRaw", "selfRaw"]`. This one needs a stated reason, because `run-outward` also normalizes its inputs and could superficially look like a `run-done`-style flat-bundle kernel. It is not, and must not be recorded as one: `decideOutward` takes **two** arguments, each normalized into a **nested** reference object (`{container, repo, source}` and `{container, repo, is_self}`) whose key namespaces **collide** — both carry `container` and `repo`. A single flat signal list cannot represent two references that share key names without ambiguity, so the flat-normalized-keys treatment `run-done`/`run-start` use is unavailable here. `run-outward` is therefore recorded as a positional kernel — each resolved reference captured whole under its argument name — exactly as `eligible` and `regions` capture their positional arguments. The argument names `targetRaw`/`selfRaw` match the function signature literally, following the `eligible`/`regions` precedent of using the real parameter identifiers. `normalizeTargetRef`/`normalizeSelfRef` are idempotent on an already-resolved reference, so the study re-normalizing a captured reference on replay is a no-op — capturing the resolved reference loses nothing.

### Keeping the registry's own checks honest

`decision-capture.js` carries a born-verifiable selftest that pins the registry to an exact name set, and a companion test asserts the recorder never depends on any kernel module. Adding five entries means three declarations elsewhere in the same module and its test must move in lockstep, or the suite fails:

- **`KERNEL_REGISTRY_RATIFIED_NAMES`** must become the sorted eleven-name set: `claim-verdict`, `eligible`, `next`, `park-verdict`, `project-next`, `queue-state`, `regions`, `run-done`, `run-outward`, `run-start`, `tier`. The selftest asserts `Object.keys(KERNEL_REGISTRY).sort()` equals this list exactly, so a stale six-name list fails immediately.
- **The selftest's assertion label** (the FAFF-821 line that reads "seeds EXACTLY the 6 ratified kernels (next/eligible/tier/run-done/queue-state/regions)") must be updated to name the eleven, so the passing message does not lie about what it checked.
- **The purity test** in `test/decision-capture.test.mjs` loops over `["next", "eligible", "tier", "run-done", "queue-state", "regions"]` asserting `decision-capture.js` requires none of them (so `selected_action` can only come from the caller, never be computed inside the recorder). The five new kernel modules must be added to that loop; the property still holds — the recorder requires no kernel module — and the test should prove it for the widened set. **The test's own name string** also hard-codes the count — it reads "purity: decision-capture.js never requires any of the *six* kernel modules" — and must be updated to name eleven in lockstep, or it becomes a test whose title asserts six while it checks eleven (the same lying-label failure the selftest-label update above guards against).

The existing selftest assertion that *every* entry carries a non-empty `required_inputs` and a version string needs no edit; the five new entries satisfy it by construction, and it is the guard that catches a malformed addition.

### Record calls are out of scope — registry entries only

**Chosen:** this ticket adds registry entries (and the born-verifiable-check updates above) only. It wires no `decision-capture record` invocations at any orchestrator decision point. This matches what FAFF-821 actually shipped. A grep across the plugin and skill prose finds no `decision-capture record` call site anywhere — not in any `SKILL.md`, not in a CLI shell, not automatically. FAFF-821 delivered the registry, the `record`/`list`/`export` CLI, the coverage classifier, the shape validator, the event-vocabulary classification, and the docs; it did **not** wire the actual capture calls at the points where `next`, `eligible`, `queue-state`, and `run-done` are consulted. Those four have registry entries and no live capture site either. Widening the registry to match is the same class of change, and keeps this ticket a clean declaration change with no new call sites and no new side effects.

**Punt:** where each kernel's `record` call is wired — deferred to a human; it belongs to FAFF-826's rollout, not here. Placing a capture call means identifying each predicate's real consult point in the orchestration flow, resolving its normalised inputs there, and piping them to `record` — a decision about the shadow study's data-collection wiring that FAFF-826 owns, applies uniformly across all covered kernels (the original four included), and should make once rather than piecemeal per registry-widening ticket. Nothing in this ticket blocks it: the registry entry is the contract the eventual call must satisfy, and it is complete without the call.

### How FAFF-826 binds the new entries

The shadow study's replay adapter binds each observation by its `(kernel, kernel_version)` pair to the exported pure function it must replay through. This ticket does not build the adapter, but the registry entries only pay off if the binding target for each is unambiguous, so the acceptance boundary names them:

| `kernel` / `kernel_version` | Bound pure function | Replay call the adapter reconstructs |
|---|---|---|
| `claim-verdict` / `claim-verdict@1` | `claimVerdict` (`claim-verdict.js`) | `claimVerdict(i.claimedAtISO, i.nowISO, i.ttlHours)` |
| `park-verdict` / `park-verdict@1` | `parkVerdict` (`park-verdict.js`) | `parkVerdict(i.status, i.draftPr, i.parkComment, i.humanTakeover)` |
| `project-next` / `project-next@1` | `projectNext` (`project-next.js`) | `projectNext(i)` (options object) |
| `run-outward` / `run-outward@1` | `decideOutward` (`run-outward.js`) | `decideOutward(i.targetRaw, i.selfRaw)` |
| `run-start` / `run-start@1` | `deriveRunTrigger` ∘ `normalizeRunTriggerSignals` (`run-start.js`) | `deriveRunTrigger(normalizeRunTriggerSignals(i))` |

(`i` is the observation's `normalised_inputs`.) The `run-start` binding is normalize-then-derive, identical in shape to the `run-done` binding the adapter already has to support; the other four are direct calls.

### Safety posture — unchanged from FAFF-821

**Chosen:** no change to the capture safety posture, and no change to the four already-covered kernels. Capture stays read-only, best-effort-fail (every failure path swallowed, logged to `.faff/logs/decision-capture.jsonl`, and answered with exit 0), and off by default behind config `capture.decision_kernel == "on"`. This ticket touches only `KERNEL_REGISTRY`, the ratified-name list, one selftest label, and one test loop — the classifier, validator, CLI shell, event vocabulary, and the `next`/`eligible`/`queue-state`/`run-done` entries are untouched, so their behaviour and coverage are unaffected.

## Scenarios

**Coverage of a fully-supplied new kernel**
Given capture is enabled and a `run-outward` decision point supplies `normalised_inputs` carrying both `targetRaw` and `selfRaw`,
When `faff decision-capture record --kernel run-outward` runs,
Then the observation records `coverage: "replayable"`, `kernel_version: "run-outward@1"`, and an empty `missing_inputs`.

**Partial inputs on a new kernel are named, not dropped**
Given capture is enabled and a `claim-verdict` observation supplies only `claimedAtISO` and `nowISO`,
When it is recorded,
Then `coverage` is `"non-replayable"` and `missing_inputs` is exactly `["ttlHours"]`.

**A set-aside command still records, but as uncovered**
Given capture is enabled and a `state` invocation is recorded (whether or not any inputs are supplied),
When it is recorded under `--kernel state`,
Then `coverage` is `"uncovered"`, `kernel_version` is `""`, and `missing_inputs` is empty — because `state` is deliberately absent from the registry — and the observation is itself a well-formed, appended record.

**The ratified-set assertion reflects the widened registry**
Given the registry now holds eleven kernels,
When `faff decision-capture --selftest` runs,
Then the ratified-names assertion passes against the sorted eleven-name set and reports the eleven it checked, and the "every entry has a version and non-empty required_inputs" assertion passes for all eleven.

**The recorder still depends on no kernel module**
Given the purity test loops over all eleven kernel module names,
When it inspects `decision-capture.js`'s requires,
Then none of the eleven is required — `selected_action` can still only come from the caller.

**The four original kernels are unaffected**
Given a `next` observation with its six inputs,
When it is recorded after this change,
Then its coverage, `kernel_version` (`next@1`), and behaviour are byte-for-byte what they were before — this ticket adds entries, it does not alter existing ones.

## Done

- [ ] `KERNEL_REGISTRY` in `decision-capture.js` gains exactly five entries — `claim-verdict`, `park-verdict`, `project-next`, `run-outward`, `run-start` — each with the `version` and `required_inputs` specified in **How**, derived from the verified function contract and validated against that kernel's selftest.
- [ ] `state`, `run-ledger`, and `decision-capture` are **not** added; a code comment on the new `run-outward` / `run-start` entries records why `run-outward` is positional rather than flat-bundle, and a comment records why `state` is absent (read-model, not a replayable predicate).
- [ ] `KERNEL_REGISTRY_RATIFIED_NAMES` is the sorted eleven-name set; `decision-capture --selftest` passes, including the "exactly the ratified set" assertion and the "every entry has a version + non-empty required_inputs" assertion.
- [ ] The selftest's ratified-set assertion label names the eleven kernels (no stale "6 ratified" text).
- [ ] The purity test in `test/decision-capture.test.mjs` loops over all eleven kernel module names and still asserts `decision-capture.js` requires none of them; its own test-name string names eleven (no stale "six kernel modules" text); the suite passes.
- [ ] A `record --kernel <new-kernel>` call with all `required_inputs` present yields `coverage: "replayable"`; with one missing yields `coverage: "non-replayable"` naming the absent key(s); an unregistered kernel (e.g. `state`) yields `coverage: "uncovered"` — demonstrated for at least one new kernel of each shape family (positional, options-object, normalize-then-derive).
- [ ] No new `decision-capture record` call site is added anywhere; capture remains read-only, best-effort-fail, and off by default (`capture.decision_kernel`).
- [ ] The `next` / `eligible` / `queue-state` / `run-done` entries and all capture behaviour outside the registry are unchanged (diff touches only the registry, the ratified-name list, the one selftest label, and the one test loop).
- [ ] Each new entry's `(kernel, kernel_version)` binds to the pure function named in the FAFF-826 binding table, so the study can replay it.

## Open questions and assumptions

**Punt:** where each kernel's `decision-capture record` call is wired at its orchestrator consult point — deferred to a human, owned by FAFF-826's uniform data-collection rollout (which covers the original four kernels too), not this registry-declaration ticket.

**Assumes:** the map's twelve `decision-kernel` rows are the authoritative gap list. *Validation:* grep `decision-kernel` in `STATE-AUTHORITY-MAP-v5.md`; subtract the four registered + two record-mint/instrumentation exclusions + one read-model, leaving exactly the five instrumented.

confidence: high
spec-review: approve
