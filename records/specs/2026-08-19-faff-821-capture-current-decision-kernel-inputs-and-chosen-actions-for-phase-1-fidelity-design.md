# FAFF-821 — Capture current decision-kernel inputs and chosen actions for Phase 1 fidelity

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-821.
> build-tier: complex

> **Revised 2026-08-19 (autonomous refresh).** Folded in the human decision **"seed decision registry"** (Linear comment, 2026-08-19) which **closes the single §7 architecture punt**: the first versioned registry is ratified to contain **exactly six** seed kernels — `next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions` — with each kernel's normalised-input canon derived from its current signature + `--selftest`, decisions outside those names recorded `uncovered`, and capture read-only/revisable by a later protocol version. §7's open question becomes a `**Chosen:**` decision (see §7); re-rated **medium → high**. No architectural change — the spec already shipped exactly this seed set as its defensible default; the human has ratified it.

This is the buildable nlspec for **FAFF-821**, an instrumentation ticket in the *SuperDomestique-runtime* Phase 1 workstream (project *"A current unattended run survives executor loss at safe boundaries"*). Audience: the build agent implementing the capture path, and the human reviewers gating the PR. It builds on the existing tamper-evident event journal (`lib/events.js`, FAFF-564), the redaction core (`lib/redact.js`, FAFF-107), and the recovery-bundle precedent (`lib/bundle.js`, FAFF-819). Its output — a durable, redacted, chain-anchored corpus of decision observations — is consumed by **FAFF-826** (read-only shadow comparison) and gated into the overlap by **FAFF-823**; it is the data-capture prerequisite named in the RFC's *Coordination-fidelity study* (`docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`).

---

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's decisions today are made by *pure CLI kernel functions* (`faff next`, `faff eligible`, `faff tier`, `faff run-done`, `faff queue-state`, `faff regions`) that the prompt-driven skills shell and then act on. To later ask *"would an explicit coordinator have made the same call?"* (FAFF-826), we must first record, at each such decision point, exactly **what the kernel saw and what the harness then did** — as durable, replayable evidence — **without** moving any authority off the current prompt-driven path. This ticket adds that recording layer and nothing else: it observes, it never decides.

**Problem statement.** Right now a kernel decision leaves no durable, normalised trace tying *inputs → chosen action → run/work-item identity → causation*, so orchestration fidelity cannot be measured. This change captures that trace at selected replay points into the existing event journal. It performs no assignment, protected effect, or canonical decision — it is read-only instrumentation.

**Design principles.**

**Capture is authority-inert — it only ever appends an observation.** The writer performs no assignment, no protected effect, and no canonical decision; it never mutates the run-ledger's authority fields. Its sole side effect is appending one `decision-capture` event. **Anti-pattern:** letting the capture path read-modify-write the ledger or gate a run on a capture result. Why: that moves authority onto the instrumentation and breaks the ticket's core boundary ("performs no assignment, protected effect, or canonical decision").

**A capture failure degrades measurement, never the authoritative run.** A missing, malformed, or disabled observation must leave current outcomes byte-identical. The capture call is best-effort: it swallows and logs its own errors and always returns success to its caller, so no authoritative step can be blocked or changed by instrumentation trouble. **Anti-pattern:** raising from the capture path into the orchestration flow. Why: it would let a measurement defect change an authoritative outcome — the exact inversion this ticket forbids.

**Never fork integrity or redaction — reuse the journal's guarantees.** The observation is written through `appendEventRecord`, so it inherits the FAFF-564 hash chain, the `seq`/`run_id` stamping, and the FAFF-107 known-secret redaction by construction. **Anti-pattern:** a bespoke `decision-capture.jsonl` with its own writer. Why: it would re-implement (and eventually drift from) redaction and tamper-evidence — the same "never forked" rule `lib/bundle.js` states in its header.

**Coverage is computed from the record, never asserted by the caller.** Whether a decision is `replayable`, `non-replayable`, or `uncovered` is derived by the pure core from (is the named kernel known?) and (are all its required inputs present?). A caller cannot label its own decision replayable. **Anti-pattern:** trusting a `coverage` flag supplied on the command line. Why: self-asserted coverage lets a lossy capture masquerade as replayable and silently corrupts the fidelity denominator.

**Kernel purity is preserved.** The pure kernel functions (`next.js`, `eligible.js`, …) stay I/O-free; capture is a *separate* verb the orchestrator shells after consulting a kernel, never a write injected inside the kernel function. **Anti-pattern:** calling the journal from inside `nextStep()`. Why: it destroys the purity/`--selftest`-ability those modules are built on.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` | Node, zero-dep | The append-only, hash-chained journal. `appendEventRecord(dir, run, payload, ts)` is the redacting append API; `eventViolations(obj, requireEnvelope, profile)` is the pure per-type validator; `verifyChain(dir)` proves integrity. The `agent-dispatch` block in `eventViolations` is the precedent for a structured, closed-vocab `data.*` payload. |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node | `DELIVERY_PROFILE.event_types` / `issue_scoped_types` — the closed vocabularies a new `decision-capture` type is added to (`PROFILE_KEYS` validates the profile shape). |
| `plugin/skills/faff/bin/lib/redact.js` | Node, zero-dep | `redactKnownSecrets` / `resolveKnownSecretValues` — already wired into `appendEventRecord`, so capture inherits redaction. |
| `plugin/skills/faff/bin/lib/run-ledger.js`, `.faff/runs/<id>/run-ledger.json` | Node / JSON | Run identity (`run_id` = dir basename) and work-item roster (`admitted[]`, `outcomes{}`). Source of the `run_id`/`issue` a record carries. |
| `plugin/skills/faff/bin/lib/next.js`, `eligible.js`, `tier.js`, `run-done.js`, `queue-state.js`, `regions.js` | Node, pure | The "decision kernel" per `docs/rfc/.../critique-3.md:56` — the named functions whose inputs/actions are captured. Each already carries a `--selftest`. |
| `plugin/skills/faff/bin/lib/bundle.js` (FAFF-819) | Node | Precedent for "usable from a clean analysis context": a redacted, manifest-digested, independently-verifiable export that never forks `events.js`/`redact.js`/`integrity-digest.js`. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node | `CONTRACTS` registry + `--describe`; the extension point if FAFF-826 later needs a standalone record contract (see OUT OF SCOPE). |

**Scope statement.** This is a new, self-contained capability under the deterministic-decision-kernel governance region: one new `lib/decision-capture.js` pure core + CLI verb, one additive event type, one config toggle, and a corpus reader/export — all additive to the existing runtime surface, behind the current `faff` surface, changing no authoritative behaviour.

---

## Already shipped against this surface

Related Done work was scanned (project + name proximity on the capture surface). None supersedes this ticket's premise — they are the infrastructure it reuses, or adjacent-but-different subsystems:

- **FAFF-564 / FAFF-568** (events.jsonl tamper-evident hash chain + anchoring) and **FAFF-107** (secret redaction) — the guarantees this capture path *inherits*, not duplicates.
- **FAFF-819 / FAFF-820 / FAFF-845** (Phase 0 recovery bundles) — the redacted, manifest-digested, clean-context-verifiable export *pattern* the corpus export reuses; a different payload (recovery vs decision corpus).
- **FAFF-93 / FAFF-95 / FAFF-122** (Skill-behaviour harness, a different project) — capture skill decisions into an in-memory `DecisionRecord` in a **test** substrate for assertion. This ticket is the orthogonal live-run counterpart: durable, redacted, journal-anchored records in real runs for the fidelity study. No shared artifact; explicitly *not* the same deliverable.
- **FAFF-383** (instrument faff *effects* declare/observe at graft chokepoints) — effects telemetry for the sentry bridge, a different subsystem from decision-kernel input/action capture.

Verdict: **premise holds — proceed.**

---

## 2. OUT OF SCOPE

- **The shadow-coordinator comparison / fidelity scoring** — replaying captured inputs through a kernel, normalising the harness action, and classifying divergence as harmless/wasteful/wrong. **Why excluded:** that is **FAFF-826** (the ticket this one `blocks`); FAFF-821 only produces the corpus. **Extension point:** FAFF-826 reads the `decision-capture` records (via the corpus reader below) and adds the replay+compare pass.
- **Publishing the coordination-fidelity protocol** (observation window, inclusion rules, action-normalisation canon). **Why excluded:** the protocol is a separate Phase-1 deliverable authorised by **FAFF-823**; this ticket ships the mechanism and the human-ratified seed registry (§7), not the protocol's broader inclusion canon. **Extension point:** the `KERNEL_REGISTRY` may be *expanded* beyond the six seed kernels by a later protocol version (the seed set is explicitly revisable — §7).
- **Orchestration-cost capture** (token, elapsed-time, intervention counts per decision). **Why excluded:** the ticket names inputs, action, identity, and causation; cost is a fidelity-study input FAFF-826 owns and is already partly available on other event payloads (`data.tokens`, `data.effort`). **Extension point:** an optional `cost` sub-object on the record `data`, added when FAFF-826 needs it.
- **A standalone `faff-contract:decision-capture` block** (a `CONTRACTS` entry + `--describe`). **Why excluded:** v1 validates the record shape inside `eventViolations` (mirroring `agent-dispatch`), which is sufficient for a captured-in-journal record; a standalone contract is only needed if a *non-journal* consumer must validate a loose record. **Extension point:** add `CONTRACTS["decision-capture"]` in `contract-defs.js` reusing the same pure `decisionCaptureViolations` core.
- **Auto-instrumenting every kernel call site in the skills.** **Why excluded:** wiring the `faff decision-capture record` call into each SKILL.md replay point is prose-layer work; v1 ships the mechanism + one reference call site against the now-ratified seed set. **Extension point:** the skill prose adds a capture shell after each named kernel consult, one line each.
- **Retention / compaction of the corpus.** **Why excluded:** volume-bound storage and proof-preserving compaction are a named later concern in the RFC risk table, not a Phase-1 capture requirement. **Extension point:** a future `faff decision-capture prune` over the exported corpus.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Decision kernel | The set of pure CLI functions the skills consult for decisions (`next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions`). Named per `critique-3.md:56`; ratified as the Phase-1 seed set (§7). |
| Replay point | A decision point where the harness consults a named kernel and then acts. The unit a `decision-capture` record describes. |
| Named kernel version | A stable per-kernel version string (e.g. `next@1`) minted in the registry, stamped on every record so a replay knows which function shape produced the action. |
| Coverage | The record's replay class: `replayable` (known kernel, all required inputs present), `non-replayable` (known kernel, ≥1 required input missing), `uncovered` (no named kernel prescribes this decision). |
| Causation reference | A pointer to the prior journal position the decision followed from — `{ seq, sha256 }` of the current chain head at capture time — so a record's place in the run's causal order is durable. |

**Type definitions.**

```
RECORD DecisionCapture:                 # lives as event.data on a type="decision-capture" event
  kernel: String                        # e.g. "next"; must be non-empty
  kernel_version: String                # resolved from KERNEL_REGISTRY, e.g. "next@1"; "" when uncovered
  normalised_inputs: Object             # the complete arg-set the kernel was (or would be) given; keys are the kernel's declared input keys
  selected_action: Object | String      # the action the harness actually took, in the kernel's output vocabulary
  coverage: Enum{replayable, non-replayable, uncovered}   # COMPUTED by the core, never trusted from input
  missing_inputs: List<String>          # required keys absent from normalised_inputs; non-empty IFF coverage=non-replayable
  causation: RECORD{ seq: Int, sha256: Hex }   # current chain head at capture; sha256 is 64 lowercase hex
  # run_id and issue are NOT in data — they are the event envelope's own run_id + issue fields

RECORD KernelSpec:                       # one per named kernel in KERNEL_REGISTRY
  name: String                          # "next"
  version: String                       # "next@1"
  required_inputs: List<String>         # keys that MUST be present for a replay; drives coverage

CONSTRAINT coverage=uncovered  IFF  kernel NOT IN KERNEL_REGISTRY
CONSTRAINT coverage=non-replayable  IFF  (kernel IN KERNEL_REGISTRY) AND (required_inputs \ keys(normalised_inputs) ≠ ∅)
CONSTRAINT coverage=replayable  IFF  (kernel IN KERNEL_REGISTRY) AND (required_inputs ⊆ keys(normalised_inputs))
```

**Event-envelope shape.** The record is the `data` of an ordinary journal event:

```
{ schema: 2, run_id, seq, ts, prev, phase: "run", type: "decision-capture", issue: "<work-item>", data: <DecisionCapture> }
```

- `type: "decision-capture"` is added to `DELIVERY_PROFILE.event_types` and to `issue_scoped_types` (a decision is about one work item). `phase` is `"run"` (the kernel decisions live in the run phase; not a new phase).
- `run_id` and `issue` are stamped by the envelope, giving run identity and work-item identity for free.

**CLI surface.**

```
faff decision-capture record --run <id> --issue <id> --kernel <name> [--action <json>]   # reads normalised_inputs (and optional action) as JSON on stdin
    → appends one decision-capture event; exit 0 always on the happy path AND on best-effort-swallowed failure (see HOW); prints the minted {seq, coverage} as JSON
faff decision-capture list [--run <id> | --all-runs] [--coverage <class>]                # emits matching decision-capture records as JSONL from the journal(s)
faff decision-capture export --out <dir>                                                 # collects records across run dirs into one redacted, manifest-digested corpus (bundle.js pattern)
faff decision-capture --selftest                                                         # in-process pure-core tests, per the house convention
```

- The three verbs register in `COMMANDS` (`bin/faff`) and are documented in `docs/guide/cli.md` (else `faff lint-cli-doc` fails) and covered by `faff lint-cli-coverage`.
- `KERNEL_REGISTRY` (in `lib/decision-capture.js`) is the single source of truth for named kernels, their versions, and required-input keys. Seeded set (human-ratified — §7): `next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions`.

---

## 4. HOW — Behavior

**Architecture and approach.** A new pure module `plugin/skills/faff/bin/lib/decision-capture.js` owns (a) the `KERNEL_REGISTRY`, (b) a pure `classifyCoverage(kernel, normalised_inputs)` → `{coverage, kernel_version, missing_inputs}`, (c) a pure `buildRecord(...)` assembling the `DecisionCapture`, and (d) `decisionCaptureViolations(data)` — the field-shape validator invoked from `eventViolations` for `type="decision-capture"`. The CLI verb is a thin impure shell: read config toggle → read stdin JSON → `classifyCoverage` → `buildRecord` → `appendEventRecord`. No kernel function is modified.

**Record procedure.**

```
PROCEDURE decision_capture_record(run, issue, kernel, stdin_json):
  1. IF config `capture.decision_kernel` != "on":        # default off
     a. RETURN exit 0, no event written (disabled ⇒ no-op, outcomes unchanged)
  2. Parse stdin_json → { normalised_inputs, selected_action }.  On parse failure → go to BEST-EFFORT-FAIL.
  3. { coverage, kernel_version, missing_inputs } = classifyCoverage(kernel, normalised_inputs)
        # kernel unknown ⇒ coverage=uncovered, kernel_version="", missing_inputs=[]
        # kernel known, some required key absent ⇒ coverage=non-replayable, missing_inputs=[...those keys]
        # kernel known, all required present ⇒ coverage=replayable
  4. head = current chain head of run's events.jsonl → causation = { seq: head.seq, sha256: head.sha256 }
  5. data = buildRecord(kernel, kernel_version, normalised_inputs, selected_action, coverage, missing_inputs, causation)
  6. violations = eventViolations({phase:"run", type:"decision-capture", issue, data}, requireEnvelope=false)
     IF violations non-empty → BEST-EFFORT-FAIL(violations)
  7. appendEventRecord(runDir, run, {phase:"run", type:"decision-capture", issue, data})   # redacts + chains + stamps seq/prev
  8. PRINT { seq, coverage } as JSON; RETURN exit 0

BEST-EFFORT-FAIL(reason):
  - Write reason to stderr and to `.faff/logs/…` (a degraded-capture note); RETURN exit 0.
  - Rationale: a capture defect must never surface as a non-zero exit the orchestrator could trip on.
```

**Coverage classification (the born-verifiable core).**

```
PROCEDURE classifyCoverage(kernel, normalised_inputs):
  spec = KERNEL_REGISTRY[kernel]
  IF spec is absent:      RETURN { coverage: "uncovered", kernel_version: "", missing_inputs: [] }
  missing = spec.required_inputs FILTER (k -> k NOT IN keys(normalised_inputs))
  IF missing non-empty:   RETURN { coverage: "non-replayable", kernel_version: spec.version, missing_inputs: missing }
  RETURN { coverage: "replayable", kernel_version: spec.version, missing_inputs: [] }
```

**Corpus reader / export.**

- `list` walks the selected run dir(s), streams each `type="decision-capture"` line (optionally filtered by `--coverage`), and prints them as JSONL. Records are already redacted and chained on disk, so a reader in a clean analysis context needs nothing else.
- `export` mirrors `lib/bundle.js`: collect the matching records, run `redactKnownSecrets` again at the publish boundary (belt-and-braces, as `bundle.js` does), compute a manifest digest via `lib/integrity-digest.js`, and write `<out>/decision-corpus.jsonl` + a manifest. It reuses `verifyChain`/`buildManifest` — never forks them. This satisfies "the captured corpus is usable from a clean analysis context."

**Edge cases and error handling.**
- **Disabled** (`capture.decision_kernel` unset/`off`): no event, exit 0 — the default posture, so shipping this changes nothing until explicitly enabled.
- **Unknown kernel**: recorded as `coverage=uncovered` (not dropped, not an error) — "decisions outside a named kernel are labelled uncovered rather than counted as divergence." Per the ratified seed set (§7), the stateful modules `critique-3.md` also names (budget, liveness, resume, gate, ledger) are **not** in the seed registry, so their decisions record `uncovered` until a later protocol version adds them.
- **Missing required input**: recorded as `coverage=non-replayable` with `missing_inputs` — "missing inputs mark the decision non-replayable."
- **Journal append failure / lock contention / malformed data**: best-effort-swallowed, exit 0, logged — never propagates.
- **Redaction**: automatic via `appendEventRecord`; a secret appearing in `normalised_inputs`/`selected_action` is replaced with `[REDACTED]` before the bytes are hashed.

**Failure modes — how the approach falls over, and how you'd notice.**
- **The failure:** capture is best-effort and disabled-by-default, so a Phase-1 study could run against a corpus that is silently sparse (most decisions never captured because the toggle was off or call sites were missing). **How you'd know:** `faff decision-capture list --all-runs | wc -l` is near-zero, or the replayable/uncovered/non-replayable counts have a tiny denominator relative to run count. **What it means:** proceed only after confirming enablement + call-site coverage; this is exactly the RFC risk *"Coordinator is built from missing-data evidence → improve instrumentation or fail the coordination question."*
- **The failure:** `normalised_inputs` is captured in a shape that does not actually reconstruct the kernel call (a lossy or renamed key), so a record marked `replayable` cannot in fact be replayed by FAFF-826. **How you'd know:** FAFF-826's replay of a `replayable` record throws or yields a shape error rather than a verdict. **What it means:** the per-kernel `required_inputs` canon (derived per §7 from each kernel's signature + `--selftest`) is wrong or incomplete — narrow to the kernels whose input shape is confirmed against `--selftest`.

**Anti-pattern:** capturing the kernel's *own output* as `selected_action` instead of the action the harness actually took. Why: the whole point of fidelity is comparing prescribed vs actual — recording the prescription as the action makes every decision trivially "faithful" and destroys the measurement.

---

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the decision kernel `next` is in KERNEL_REGISTRY with required_inputs including "status" and "spec"
  And capture is enabled (capture.decision_kernel: on)
When `faff decision-capture record --run R --issue FAFF-1 --kernel next` is given complete normalised inputs and the chosen action on stdin
Then one type="decision-capture" event is appended to R's events.jsonl with coverage="replayable"
  And the event carries run_id=R, issue=FAFF-1, kernel_version="next@1", and a causation {seq, sha256} matching the prior chain head
  And `faff events verify --run-dir R` still reports the chain verified
```

```
Given capture is enabled and a required input key for `next` is omitted from the normalised inputs
When the record verb runs
Then the appended record has coverage="non-replayable" and missing_inputs lists exactly the absent required key(s)
```

```
Given capture is enabled and --kernel names a function not in KERNEL_REGISTRY
When the record verb runs
Then the appended record has coverage="uncovered", kernel_version="", and missing_inputs=[]
```

```
Given capture is DISABLED (capture.decision_kernel unset or "off")
When the record verb runs
Then no event is appended and the command exits 0 — the authoritative journal is byte-identical to a run without instrumentation
```

- The captured `selected_action` MUST be the harness's actual action, never the kernel's prescribed output (assertion).
- A secret value present in normalised_inputs MUST appear as `[REDACTED]` in the on-disk record (assertion).

---

## 6. DESIGN DECISION RATIONALE

**Where do capture records live — a new log, or the existing event journal?**
Options: (a) a bespoke `.faff/runs/<id>/decision-capture.jsonl`; (b) the existing `events.jsonl` with a new `type`. (a) gives a clean single-purpose stream but must re-implement redaction, hash-chaining, `seq` ordering, and export integrity. (b) inherits all of those from `appendEventRecord` and keeps one causal order.
**Chosen:** (b) the existing journal with `type="decision-capture"` — reuses redaction + tamper-evidence + identity by construction, matching the "never forked" rule `bundle.js` already enforces, and gives causation ordering for free.

**How is coverage decided?**
Options: (a) the caller passes a `coverage` flag; (b) the pure core computes it from kernel-membership + required-input presence.
**Chosen:** (b) computed — a caller must not be able to mislabel a lossy capture as replayable; computation makes the replayable/non-replayable/uncovered classes trustworthy denominators for the fidelity study.

**Where does emission live — inside the kernel functions, or a separate verb?**
Options: (a) instrument inside `nextStep()` et al.; (b) a standalone `faff decision-capture record` verb the orchestrator shells after consulting a kernel.
**Chosen:** (b) — keeps the kernel functions pure and `--selftest`-able (the property the whole decision surface is built on) and keeps capture authority-inert.

**How is a capture failure handled?**
Options: (a) fail loud (non-zero exit); (b) best-effort swallow + log, always exit 0.
**Chosen:** (b) — the ticket requires that a missing/malformed observation degrade measurement, never the authoritative run; a non-zero exit could be tripped on by an orchestrator and change an outcome.

**What is a "named kernel version"?** No versioning exists in code today (`CUSTODY_VERDICT_SCHEMA_VERSION`, `BUNDLE_MANIFEST_VERSION` are per-artifact, not per-kernel).
**Chosen:** a per-kernel string minted in `KERNEL_REGISTRY` (e.g. `next@1`), bumped when a kernel's input/output shape changes — the minimal stamp that lets a later replay know which function shape produced the action. (At the time of writing there is no per-module version to reuse.)

**Does the record need a standalone `faff-contract` entry?**
**Chosen (for v1):** validate the record shape in `eventViolations` (as `agent-dispatch` is validated), not a `CONTRACTS` entry — sufficient for a captured-in-journal record; a standalone contract is an extension point (OUT OF SCOPE) for a non-journal consumer.

---

## 7. RESOLVED DECISIONS AND ASSUMPTIONS

**Resolved decisions.**

- **Chosen: the authoritative Phase-1 replay-point inclusion set is the six-kernel seed registry.** The first versioned `KERNEL_REGISTRY` contains **exactly six** seed kernels — `next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions` — and no others. Each kernel's complete `required_inputs` (its normalised-input canon) is **derived from that kernel's current signature and `--selftest`** (see the Assumes below for the validation step). Decisions made by any function **outside** these six names are recorded `coverage=uncovered`, never counted as divergence. The registry is **read-only** for the fidelity study and **may be revised (expanded) by a later protocol version**. **Rationale:** ratified by the human decision *"seed decision registry"* (Linear FAFF-821 comment, 2026-08-19) — this spec had shipped exactly this seed set as a defensible Phase-1 default, and the human has now ratified it as the authoritative inclusion set, closing the prior architecture punt. The stateful modules `critique-3.md` also names (budget, liveness, resume, gate, ledger) are deliberately **out** of the seed set; their decisions record `uncovered` until a later protocol version adds them. **Impact of the boundary:** decisions by non-seed functions surface as `uncovered` (by design, not a defect); the fidelity denominator for Phase 1 is exactly these six kernels.

**Assumptions.**

- **Assumes:** the six seed kernels are the pure, I/O-free functions described in the explore findings (`lib/next.js`, `eligible.js`, `tier.js`, `run-done.js`, `queue-state.js`, `regions.js`), each with a stable input arg-set. *Validate:* run each function's `--selftest` and read its input signature before declaring its `required_inputs` (this is exactly the canon-derivation the ratified decision above prescribes).
- **Assumes:** `appendEventRecord` redacts `data` before hashing (FAFF-107 wiring). *Validate:* grep `redactKnownSecrets` in `events.js:appendEventRecord`; assert a seeded secret in `normalised_inputs` appears `[REDACTED]` on disk (the redaction scenario).
- **Assumes:** adding a member to `DELIVERY_PROFILE.event_types`/`issue_scoped_types` is the sanctioned way to introduce an event type (`PROFILE_KEYS`-validated), as `bundle-store-unavailable`/`agent-dispatch` were. *Validate:* confirm `eventViolations` reads the profile's vocabularies rather than a hardcoded list.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A kernel decision produces a durable, redacted, chain-anchored record tying normalised inputs → selected action → run/work-item identity → causation, with no change to any authoritative outcome.

### From WHAT (types and interfaces)
- [ ] `decision-capture` is a member of `DELIVERY_PROFILE.event_types` and `issue_scoped_types`; `PROFILE_KEYS` validation still passes.
- [ ] A `decision-capture` event matches the envelope shape; `data` matches the `DecisionCapture` record; `run_id`/`issue` come from the envelope.
- [ ] `KERNEL_REGISTRY` seeds **exactly** `next`, `eligible`, `tier`, `run-done`, `queue-state`, `regions` (the ratified seed set — §7), each with a `version` and `required_inputs` derived from its signature + `--selftest`.
- [ ] `faff decision-capture record|list|export` are registered in `COMMANDS`, documented in `docs/guide/cli.md` (`faff lint-cli-doc` passes), and covered (`faff lint-cli-coverage` passes).

### From HOW (behaviour)
- [ ] `classifyCoverage` returns `uncovered` for an unknown kernel, `non-replayable` + `missing_inputs` when a required input is absent, `replayable` when all required inputs are present.
- [ ] `coverage` is computed by the core; a caller-supplied coverage value is ignored.
- [ ] The record is written via `appendEventRecord` (inherits redaction + chaining); `faff events verify` reports the chain still verified after a capture.
- [ ] A seeded secret in `normalised_inputs` is `[REDACTED]` in the on-disk record.
- [ ] `causation` is `{seq, sha256}` of the chain head at capture time.

### From HOW (edge cases)
- [ ] With `capture.decision_kernel` unset/`off`, the verb writes no event and exits 0 (authoritative journal byte-identical).
- [ ] A malformed payload / append failure exits 0, logs a degraded-capture note, and appends no event.

### From HOW (corpus)
- [ ] `faff decision-capture list --all-runs [--coverage <class>]` emits matching records as JSONL from a clean context.
- [ ] `faff decision-capture export --out <dir>` writes a redacted, manifest-digested corpus reusing `redact.js`/`integrity-digest.js`/`events.js` (no fork).

### Tests
- [ ] `lib/decision-capture.js` ships a `--selftest`; `test/decision-capture.test.mjs` spawns the real CLI over a scratch `.faff/runs/<id>` tree and asserts the scenarios above (following `test/events-chain.test.mjs` conventions).

**Integration smoke test:**
```
seed a scratch run dir R with a genesis events.jsonl
set capture.decision_kernel: on
echo '{"normalised_inputs":{"status":"backlog","spec":"none"},"selected_action":"prep"}' \
  | faff decision-capture record --run R --issue FAFF-1 --kernel next
assert: exit 0; last line of R/events.jsonl is type="decision-capture", coverage="replayable", issue="FAFF-1"
assert: faff events verify --run-dir R  → verified
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** *What's there:* one coherent capability, but the spec is tier `complex` — a new `lib/decision-capture.js`, an event-vocabulary change, three CLI verbs (`record`/`list`/`export`), a config toggle, and a bundle-style corpus export. *Why it matters:* that is more than one 1–3 day unit, and the `export` corpus-publisher is separable from the capture core. *Recommended action:* consider splitting `export` (+`list`) into a follow-on that FAFF-826 pulls in, shipping the capture core (`record` + event type + coverage classification) first. Non-blocking — the seam is already drawn in OUT OF SCOPE.
- **Workstream fit (principles 1+5).** *What's there:* FAFF-821 sits in the outcome-named project *"A current unattended run survives executor loss at safe boundaries"*, but its own outcome is *measure orchestration fidelity*, not executor-loss recovery. *Why it matters:* a cohesion smell — capture-for-fidelity may belong to a coordination-study workstream. *Recommended action:* confirm the project home, or note FAFF-821 as the fidelity-measurement thread within it; not a blocker for building.
- **Surfaced deps (principle 6).** *What's there:* FAFF-821 `blocks` FAFF-823 (authorises the Phase-1 overlap) and FAFF-826 (the study). The prior open question about the ratified inclusion set is now **closed** by the human seed-registry decision (§7). *Why it matters:* the seed registry is now a ratified, self-contained Phase-1 starting point, so FAFF-821 no longer waits on the protocol to land first. *Recommended action:* none blocking — the human has confirmed the seed set unblocks the mechanism; a later protocol version may expand the registry. Reused infra deps (FAFF-564/107/819) are correctly Done, not blockers.
- **Risk profile (principle 7).** *What's there:* the value rests on an assumption — that captured `normalised_inputs` actually reconstruct the kernel call (named in Failure modes), now bounded to the six ratified seed kernels. *Recommended action:* a thin de-risking spike capturing one kernel (`next`) end-to-end and confirming FAFF-826 can replay it would validate the input-normalisation canon before instrumenting all six. Optional; the failure mode is already documented and the `--selftest`-derivation step (§7) mitigates it.

## Confidence self-rating

Self-review (in-context, per the inherited quality bar) found no `blocker` and fewer than three `major`: the mechanism is fully grounded against the verified code surface (events/redact/governance-profile/bundle) and every claim traces to a real file. The single substantive open item at the prior rating — the §7 architecture punt over the ratified Phase-1 inclusion set / input canon — has now been **closed by the human "seed decision registry" decision** (2026-08-19), which ratifies exactly the seed set this spec already shipped. No substantive `**Punt:**` remains; the remaining `**Assumes:**` markers are ordinary build-time validations (run each kernel's `--selftest`). Re-rated **high**.

confidence: high
spec-review: approve