# Spec — FAFF-352: Wire `faff sentry check` into beep-boop's between-units checkpoints

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-352.

This spec covers making the shipped Sentry derailment detector operationally live in `/faff-beep-boop`: naming the consult at every concrete checkpoint site, bridging `faff effects check` escapes into Sentry's forbidden-side-effect seam, and emitting a per-checkpoint event so `faff audit` and the run summary can prove supervision ran. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model:** beep-boop's governing prose *already* mandates the Sentry consult — the orchestrator section "The interrupt — `faff sentry check`" requires it at every between-units checkpoint, with a complete L4-acts / non-L4-advises handling table and a `sentry-abort` stop reason. What's missing is not policy but **plumbing legibility**: the concrete drain steps never name the call, no event type exists to record that a consult happened, and the one input seam Sentry can't derive itself (`forbidden_side_effect`) is unreachable from the CLI. Detection that leaves no trace is indistinguishable from detection that never ran.

**Problem statement:** `faff sentry check` shipped and the lights-out preflight probes it as an enforced guardrail, but a finished run's audit trail contains zero evidence any consult fired, and the escaped-side-effect signal (`faff effects check`) has no consumer. This change makes the consult observable (a `sentry-checkpoint` event per consult, surfaced by `faff audit` and the run summary) and makes the effects→sentry bridge real (a `--forbidden-side-effect` flag).

**Design principles:**

- **Consume, never re-implement.** The orchestrator captures CLI output and acts on it; no trigger math (attempt counts, staleness, escape computation) moves into skill prose. An implementation that re-derives any trigger in prose is invalid.
- **State the checkpoint once.** The checkpoint procedure gets one canonical home in the beep-boop orchestrator prose; the drain-step sites reference it. Copying the procedure into each step is a lint violation (duplicated blocks) and a drift hazard.
- **Checkpoints are orchestrator-level.** Neither concurrency executor skill mentions Sentry today, and that stays true — executors dispatch builds; the orchestrator supervises between units.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (single file) | All CLI changes: events schema (~line 9141), sentry (~9988), effects (~9529), audit (~10199) |
| `plugin/skills/faff-beep-boop/SKILL.md` | prose | Checkpoint sites (steps 3, 6–7, 8.1), events table (~line 344), run summary template (~455) |
| `docs/guide/cli.md` | prose | `sentry` / `effects` / `audit` entries updated same PR |
| `test/{events,sentry,audit,effects}.test.mjs` | node:test | House pattern: pure cores + `--selftest` + runCli tests |

**Scope statement:** this is the consumer-wiring slice that turns three already-shipped producers (sentry, effects, events) into one working supervision loop inside beep-boop; a 1–2 day slice, one PR, conventional commit.

## 2. OUT OF SCOPE

- **Instrumenting `faff effects declare`/`observe` call-sites** — nothing populates `declared-effects.jsonl` today, and this ticket does not add declare/observe calls to graft/merge chokepoints. Why excluded: that is producer-side instrumentation with its own design surface (which chokepoints, which kinds). Extension point: the graft merge/housekeeping steps in `plugin/skills/faff-graft/SKILL.md` and the merge-gate path in `bin/faff`. Consequence stated honestly in Failure modes: the bridge is live but fires only once producers write the ledger.
- **Sentry-2 `correct` intervention** — the ladder stays `continue | pause | abort`. Extension point: `SENTRY_INTERVENTIONS` in `bin/faff`.
- **Executor-level supervision** — no change to either `concurrency` slot skill. Extension point: none needed; checkpoints stay orchestrator-owned.
- **`/faff-wtf` changes** — wtf reads the run summary; the new supervision line and the existing `sentry-abort` stop reason surface through it unchanged. Extension point: `plugin/skills/faff-wtf/SKILL.md` if a dedicated supervision view is ever wanted.
- **Threshold tuning / new derailment signals** — `sentry.*` config values and `DERAILMENT_SIGNALS` are untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Checkpoint | A between-units boundary where the orchestrator runs budget check + sentry consult: after every prep return, after every build return / before every launch in parallel mode, and at every wave boundary (beep-boop "When the check fires") |
| Consult | One `faff sentry check --json --run-dir <dir>` invocation; always runs, acting is mint-scoped (L4 acts, non-L4 logs + surfaces) |
| Bridge | Passing `faff effects check`'s `any_escape` into Sentry's `forbidden_side_effect` input seam |
| Supervision block | The `faff audit` reconstruction section derived from `sentry-checkpoint` events |

**New event type:**

```
RECORD SentryCheckpointEvent:            # one per consult, orchestrator-emitted
  phase: "run"                           # run-scoped — NOT issue-scoped, no issue field
  type:  "sentry-checkpoint"
  data:  SentryCheckPayload              # the captured `sentry check --json` stdout, verbatim

RECORD SentryCheckPayload:               # existing shape, unchanged (bin/faff cmdSentry)
  run_dir, verdicts[], intervention, tripped, thresholds

CONSTRAINT data carries no top-level `forbidden_side_effect` key
  # the payload shape guarantees this; it matters because Sentry's events-path
  # predicate scans event data for that key — see Failure modes
```

`EVENT_TYPES` gains `"sentry-checkpoint"`; `EVENT_ISSUE_SCOPED` is untouched.

**New CLI flag:**

```
faff sentry check [--forbidden-side-effect]
  # boolean; sets signals.forbidden_side_effect = true on the evaluator input.
  # Trips `forbidden-side-effect-attempt` (severity: trip → intervention: abort
  # per the existing SIGNAL_TRIP_INTERVENTION table). Exit stays 0 (report-only).
```

**Audit reconstruction addition:**

```
RECORD Reconstruction.supervision:       # sibling of the existing `budget` block
  checkpoints: [ { seq, ts, data } ]     # events of type sentry-checkpoint, seq order
  last_intervention: string | null       # data.intervention of the last checkpoint

# text rendering (renderAuditText), one line mirroring the budget line:
#   supervision: N checkpoint(s) · last intervention: <continue|pause|abort|—>
```

All design decisions for this section are closed in **6. Design Decision Rationale**.

## 4. HOW — Behavior

### 4.1 The canonical checkpoint procedure (beep-boop prose)

One home: extend "The interrupt — `faff sentry check`" (beep-boop SKILL.md, currently lines 80–90) into the full procedure. The three checkpoint sites reference it; they do not restate it.

```
PROCEDURE between_units_checkpoint(run_id, run_dir):
  1. Run `faff budget check --json --run-dir <run_dir>`; capture BudgetState.
     Emit budget-checkpoint event (existing behaviour, unchanged).
     Act on breach per the existing budget branch.
  2. Run `faff effects check --run <run_id> --json`; capture {escapes, any_escape}.
     (Missing ledger ⇒ any_escape:false — a clean state, not an error.)
  3. Run `faff sentry check --json --run-dir <run_dir>`,
     appending `--forbidden-side-effect` IFF any_escape is true.
     Capture SentryCheckPayload.
  4. Emit the checkpoint event:
     echo '{"phase":"run","type":"sentry-checkpoint","data":<payload>}' \
       | faff events append --run <run_id>
  5. Act on data.intervention per the existing mint-scoped handling table:
     L4: pause → park implicated issue(s), continue queue;
         abort → `faff sentry abort --run-dir <dir>`, stop dispatching, surface verdicts;
         consult fails → fail closed (stop, needs-human).
     Non-L4: log + surface, proceed. `continue` → proceed either way.
```

**Behavior summary:** every checkpoint now leaves one durable event proving supervision ran, and an escaped side-effect recorded by the effects ledger escalates to the abort intervention at the next checkpoint.

**Effects-check ordering:** step 2 runs before step 3 at the *same* checkpoint (never carried over from the previous one), so the flag reflects the current ledger state.

### 4.2 Skill-prose edit sites (`plugin/skills/faff-beep-boop/SKILL.md`)

- **"The interrupt" section (~80–90):** fold in the procedure above (effects bridge + event emission steps). The handling table is already correct — do not rewrite it.
- **Step 3, prep-queue drain (~133–143):** add one line — after every prep return, run the between-units checkpoint (reference "The interrupt").
- **Step 7, wave drain (~176–178):** add one line — after every build return (and before every launch in parallel mode), run the between-units checkpoint (reference "The interrupt").
- **Step 8.1 (~185):** already names both checks and points at "The interrupt"; verify the pointer covers the new emission/bridge steps — no restatement.
- **Events table (~344):** add row `| Sentry checkpoint | run / sentry-checkpoint (data = sentry check payload) |`.
- **Run summary template (~455–462):** add one header-area line, e.g. `Sentry: N checkpoints · max intervention: <continue|pause|abort>`; and fix the template's `Stop reason:` line (~459) to carry the full stop-reason vocabulary the "Stopping condition" section already defines (`sentry-abort`, `converged/both-dry`, `non-convergence`, `product-incomplete`) — the template has drifted behind the prose.

**Anti-pattern:** copying the checkpoint procedure into steps 3, 7, and 8.1. Why: three copies drift independently; `faff validate-adapters` gates duplicated blocks.

**Anti-pattern:** forking the consult on run level (running sentry only under L4). Why: the existing prose is explicit — the consult always runs; only the *handling* is mint-scoped. Non-L4 consults feed threshold calibration.

### 4.3 `bin/faff` changes

1. **Events (~9141, ~9298):** add `"sentry-checkpoint"` to `EVENT_TYPES`. Extend `eventsSelftest` with a valid `sentry-checkpoint` case (envelope mode, `phase: "run"`, no issue).
2. **Sentry (~9988–10022):** parse `--forbidden-side-effect` in `cmdSentry check`; pass `forbidden_side_effect: true` into the `evaluateDerailment` raw-signals object when present. No change to `normalizeSentrySignals`, the predicates, or the intervention table — the seam already exists; the flag merely reaches it. Exit code unchanged (0, report-only).
3. **Audit (~10199–10337):** in `buildReconstruction`, add the `supervision` block (filter `sentry-checkpoint` events, seq-sorted, mirroring the budget block at ~10245–10253); in `renderAuditText`, add the supervision line after the budget line (~10323); render `—` for `last_intervention` when no checkpoints. Extend `auditSelftest` to cover a run with and without sentry-checkpoint events.
4. **Stale comments/doc strings (same PR — docs never go stale):**
   - The effects region comment (~9335–9338) and the effects COMMANDS entry (~5690) promise the bridge with "no Sentry change". That promise was not satisfiable from the CLI (nothing could set the seam); reword both to name the `--forbidden-side-effect` flag as the bridge's CLI surface.
   - The sentry COMMANDS entry (~5691): add the flag; drop/qualify the `forbidden-side-effect-attempt` "degrades to no-signal until its boundary signal lands" phrasing — the boundary signal now lands via the flag.
   - The audit COMMANDS entry (~5692): mention the supervision block alongside the budget summary.

### 4.4 Docs (`docs/guide/cli.md`, same PR)

- `sentry` row (~line 54): add `--forbidden-side-effect`; update the degraded-signal phrasing.
- `effects` row (~line 81): name the flag as the bridge mechanism.
- `audit` row (~line 51): add the supervision block/line.
- `events` row (~line 79): no type enumeration exists there — no change required.

### 4.5 Edge cases and error handling

- **Consult fails (non-zero exit / unparseable stdout):** L4 fails closed (stop dispatching, needs-human "kill-switch evaluator down" — existing table); non-L4 logs and continues. Emit no `sentry-checkpoint` event on a failed consult — the event asserts a completed consult; the failure is logged in the wave log instead.
- **`faff events append` rejects the emission** (e.g. stale copy-installed binary without the new type): log the rejection, do not retry, continue the run — event emission is observability, never a dispatch gate.
- **Missing effects ledger:** `any_escape: false`, no flag passed — clean state by design (exit 0).
- **Escape latching:** the effects ledger is append-only and accumulative, so once an escape exists every subsequent checkpoint re-trips → intervention `abort` at L4. This is correct guard-rail semantics (an unexplained escape does not become acceptable at the next checkpoint).
- **Abort re-entry:** `faff sentry abort` writes `ledger.abort {status: "aborted-resumable"}`, flips a running owner to `aborted-resumable`, and never writes outcomes — the in-flight issue stays admitted-with-no-outcome, so the existing resume-from-ledger path re-dispatches it (graft re-attaches idempotently). This slice adds nothing to the resume path; it only relies on it (see Assumptions).

### 4.6 Failure modes

- **The failure:** the bridge is live but `declared-effects.jsonl` has no producers, so `forbidden-side-effect-attempt` never fires even on a real escaped effect. **How you'd know:** `faff audit` supervision checkpoints all show no forbidden-side-effect verdict across runs that performed merges/label-writes. **What it means:** proceed — this slice ships the consumer half by design; the producer half is a named follow-on (Out of scope), and the honest state ("bridge armed, signal source unpopulated") is still strictly better than an unconsumed seam.
- **The failure:** a future emitter puts a top-level `forbidden_side_effect: true` key into any event's `data`, latching Sentry's *events-path* predicate permanently for the run. **How you'd know:** sentry trips forbidden-side-effect with `evidence.event_seq` set while `effects check` reports no escape. **What it means:** narrow — the emitted `sentry-checkpoint` payload shape has no such key (constraint in WHAT, asserted by test); keep the flag the sole sanctioned bridge.
- **The failure:** double budget evaluation per checkpoint (orchestrator's own `budget check` + Sentry's internal child call) diverges — Sentry's later call sees slightly higher spend. **How you'd know:** a checkpoint where the budget branch says unbreached but the sentry payload carries a budget-breach verdict. **What it means:** proceed — divergence is directionally safe (later read ≥ earlier spend; a trip on the fresher number is the conservative outcome).

## 5. Scenarios

```
Given a run dir with an initialised ledger
When the orchestrator pipes {"phase":"run","type":"sentry-checkpoint","data":{...}} to `faff events append --run <run-id>`
Then the append exits 0 and the stored record carries the envelope (schema 1, monotonic seq) with no issue field
```

```
Given a declared-effects.jsonl containing an observed effect with no covering declaration
When the orchestrator runs `faff effects check --run <id> --json` (any_escape: true)
  and then `faff sentry check --json --run-dir <dir> --forbidden-side-effect`
Then the payload's verdicts include forbidden-side-effect-attempt with severity trip
  and intervention is abort
```

```
Given an L4 (lights-out-minted) run whose consult returned abort
When the orchestrator runs `faff sentry abort --run-dir <dir>`
Then the ledger reads aborted-resumable, no terminal outcome is written for the in-flight issue,
  and the run summary carries Stop reason: sentry-abort
```

```
Given a finished run whose events.jsonl contains N sentry-checkpoint events
When `faff audit <run-id>` runs
Then the output includes a supervision line with N checkpoint(s) and the last intervention,
  and `--json` exposes supervision.checkpoints in seq order
```

```
Given a non-L4 run whose consult returns a tripped verdict
When the checkpoint completes
Then the sentry-checkpoint event is still emitted, the verdict is logged and surfaced,
  and dispatching continues (no park, no abort)
```

Assertion: a checkpoint emits **exactly one** `sentry-checkpoint` event — a failed consult emits none.

## 6. Design Decision Rationale

**Where do sentry checkpoints fire, and how often?** Options: new cadence decision vs adopt the shipped prose. The ticket raised frequency-vs-cost as an open question, but the orchestrator prose already fixes it (every between-units checkpoint, same boundaries as budget; `faff sentry check` is a pure local evaluator, so per-checkpoint cost is a few file reads plus one budget child call).
**Chosen:** the existing between-units boundaries, unchanged — this ticket cites the settled policy rather than re-deciding it.

**L3 check-and-surface vs L4 abort authority?** The ticket's second open question; also already settled in prose: the consult always runs, acting is mint-scoped (`ledger.level === "L4"` written only by `faff lights-out` at mint) — L4 acts (pause/park, abort/resumable), non-L4 logs + surfaces.
**Chosen:** implement the existing mint-scoped handling table verbatim; no new authority decision.

**Effects bridge: event-path (A) vs CLI flag (B)?** A = write an event whose `data.forbidden_side_effect: true` is read by Sentry's events-path predicate; B = a `--forbidden-side-effect` flag on `sentry check` feeding the orchestrator-hints seam. A needs either a new event type or smuggling the key into an unrelated type's unvalidated `data` (semantic muddle); it also latches for the rest of the run via the event log with no way to attribute the trip to a checkpoint decision. B is a two-line CLI change onto a seam built exactly for orchestrator hints, keeps the trip attributable to the precise checkpoint that observed the escape, and is directly testable. The effects region's "no Sentry change" comment promise was not satisfiable from the CLI either way — it gets rewritten honestly in the same PR.
**Chosen:** B — the `--forbidden-side-effect` flag on `faff sentry check`.

**Effects-check cadence?** `faff effects check` is pure, run-scoped, accumulative, and reads one JSONL file.
**Chosen:** run it at every sentry checkpoint, immediately before the consult — one boundary set, no separate schedule to drift.

**Sentry's internal budget child vs passing `--budget-json` through?** Sentry spawns its own `faff budget check` child, so each checkpoint evaluates budget twice. `--budget-json` exists and could pass the orchestrator's captured BudgetState through — but prose-side JSON pass-through is a known retype hazard, the flag is documented as a hermetic-test hook, and the double evaluation is pure, local, cheap, and directionally safe.
**Chosen:** accept the double evaluation; keep `--budget-json` as the test/diagnostic hook. Revisit only if checkpoint latency ever matters.

**Who emits the checkpoint event?** Budget parity: `faff budget check` does not emit events; the orchestrator captures `--json` and emits `budget-checkpoint` (single-writer event log — only the orchestrator appends).
**Chosen:** mirror exactly — the orchestrator captures the sentry payload and emits `{"phase":"run","type":"sentry-checkpoint","data":<payload>}`; the sentry CLI stays emission-free.

**Audit rendering shape?** Options: render supervision only when checkpoints exist vs always.
**Chosen:** always render, mirroring the budget line — `supervision: 0 checkpoint(s)` on a pre-existing run is the honest reading ("no recorded supervision"), which is precisely the visibility this ticket exists to create.

**Surface in `/faff-wtf`?** wtf reads the run summary; `sentry-abort` stop reason and `faff-parked` labels already flow through it.
**Chosen:** no wtf change — one supervision line in the beep-boop run summary template carries the signal.

## 7. Open Questions and Assumptions

**Open Questions:** none — both ticket-level open questions are settled by existing shipped prose (see the first two decisions above).

**Assumptions:**

- **Assumes:** the aborted-resumable re-entry path exists and works — `applySentryAbort` never writes outcomes, so the in-flight issue is admitted-with-no-outcome and the sequential executor's resume-from-ledger path re-dispatches it. Validation before build: confirm `applySentryAbort` (bin/faff ~9920) writes no `outcomes` entry and that beep-boop's resume prose ("Mid-run compaction is a resume") covers re-entry from an `aborted-resumable` ledger; if re-entry turns out to need its own slice, this ticket still ships (abort still leaves resumable state) but note the gap in the PR.

## 8. DONE — Definition of Done

### From WHAT (schema and surfaces)
- [ ] `EVENT_TYPES` includes `sentry-checkpoint`; `EVENT_ISSUE_SCOPED` unchanged; `echo '{"phase":"run","type":"sentry-checkpoint","data":{}}' | faff events append --run <id>` exits 0
- [ ] `faff sentry check --forbidden-side-effect --json` returns a `forbidden-side-effect-attempt` trip verdict and `intervention: "abort"`; without the flag and with no event-path signal, no such verdict (existing degraded behaviour preserved)
- [ ] `faff audit <run-id> --json` exposes `supervision.checkpoints` (seq order) + `supervision.last_intervention`; text output renders the supervision line (with `0 checkpoint(s)` on a legacy run)

### From HOW (orchestrator prose)
- [ ] beep-boop "The interrupt" section carries the canonical checkpoint procedure (effects check → conditional flag → consult → event emission → mint-scoped handling)
- [ ] Steps 3 and 7 each carry a one-line checkpoint reference; no duplicated procedure block (`faff validate-adapters` clean)
- [ ] Events table has the `sentry-checkpoint` row
- [ ] Run summary template carries the supervision line, and its `Stop reason:` line lists the full stop-reason vocabulary including `sentry-abort`
- [ ] Neither concurrency executor SKILL.md mentions sentry (unchanged)

### From HOW (edge cases)
- [ ] Failed consult: no `sentry-checkpoint` event emitted; L4 handling stays fail-closed per the existing table (prose assertion)
- [ ] Emitted checkpoint `data` is the sentry payload verbatim and contains no top-level `forbidden_side_effect` key (test-asserted)

### From HOW (docs and stale comments)
- [ ] effects region comment + effects/sentry/audit COMMANDS doc strings updated (no surviving "no Sentry change" promise)
- [ ] `docs/guide/cli.md` sentry/effects/audit rows updated in the same PR

### Tests
- [ ] `eventsSelftest` gains the valid `sentry-checkpoint` case; `test/events.test.mjs` covers append acceptance
- [ ] `test/sentry.test.mjs` covers the flag end-to-end via runCli (flag → trip → abort intervention; absent flag → no verdict)
- [ ] Bridge integration test: seeded escape ledger → `effects check` any_escape → flagged `sentry check` → abort
- [ ] `auditSelftest` + `test/audit.test.mjs` cover supervision with N>0 and N=0 checkpoints
- [ ] `faff events --selftest`, `faff sentry --selftest`, `faff audit --selftest`, `faff effects --selftest` all pass

**Integration smoke test:**

```
1. Init a run dir + ledger; append a declared-effects observe entry with no declaration
2. effects check --json            → any_escape: true
3. sentry check --json --forbidden-side-effect --run-dir <dir>
                                   → intervention: abort
4. Pipe {"phase":"run","type":"sentry-checkpoint","data":<step-3 payload>} to events append  → exit 0
5. sentry abort --run-dir <dir>    → ledger aborted-resumable, outcomes untouched
6. audit <run-id>                  → supervision: 1 checkpoint(s) · last intervention: abort
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)** — No issues; the out-of-scope cut is a split done right. The armed-but-unfed bridge would fail the value test only if this slice's value hung on the `forbidden_side_effect` signal — it doesn't. That signal is one input among several Sentry derives *itself* (attempt counts, staleness, budget breach), and every one of those goes from never-consulted to consulted-recorded-and-actionable at each checkpoint the moment this ships; the observability half (`sentry-checkpoint` events + the audit supervision line) is standalone value on top. Meanwhile the producer half (which graft/merge chokepoints declare/observe, which effect kinds) is its own design surface and its own 1–3 day unit — bundling it would make this a ticket-as-epic. The split passes; it needs one follow-through (see deps, finding 1).

**Workstream fit? (principles 1 + 5)** — Finding: this issue is homeless while its whole family is homed. *What's there:* FAFF-352 sits in Backlog with no project, but the Sentry stream — FAFF-327 (fleet supervision), FAFF-324/325/326 (subvertability, corrective integrity, Channel A), FAFF-312 (Done — "Sentry interrupts" governance) — lives in **Trustworthy lights-out — harden & broaden (post-v1)**, and FAFF-352 is the ticket that makes that project's kill-switch guardrail claim *true* rather than nominal. *Why it matters:* project-less Backlog was the right capture-time landing, but this issue is now sequenced (prepped, `faff-automate`); leaving it outside the stream hides it from the stream's completion picture — the project can't honestly be "done hardening supervision" while the consult wiring lives elsewhere. *What to do:* home FAFF-352 in Trustworthy lights-out — harden & broaden (post-v1). On FAFF-327: fleet-scale supervision of a consult nothing invokes supervises nothing — FAFF-352 is a real prerequisite of FAFF-327, not just a sibling. Draw **FAFF-352 blocks FAFF-327** (327 already sits behind FAFF-355; this edge completes its honest prerequisite set).

**Deps surfaced? (principle 6)** — Two findings, one all-clear:

1. **Unticketed follow-on.** The spec's Out-of-scope names producer-side instrumentation of `faff effects declare`/`observe` as "a named follow-on" — but no FAFF ticket exists for it, so the dep lives in prose, not edges. Until it's filed, the failure-mode line ("bridge armed, signal source unpopulated") has no owner and the honest interim state quietly becomes the permanent state. File the follow-on (declare/observe at the graft merge/housekeeping chokepoints named as extension points) and link it related-to FAFF-352, no later than ship.
2. **FAFF-362 collision (Todo — ahead of this Backlog issue in queue order).** "Governance profiles — terminal states, event types, and sentry thresholds become declared vocabulary tables" rewrites exactly the surfaces this spec edits: `EVENT_TYPES` (~9141) and the sentry thresholds region. No relation exists between them. Not a blocker — either order works — but whichever lands second rebases the other's vocabulary change (`sentry-checkpoint` becomes a declared-profile entry under 362's model). Link related-to and let conflict-analysis serialise; don't dispatch both in the same unattended wave without that edge visible.
3. **FAFF-355 checked, clear.** The heartbeat-file work touches the ledger surface Sentry's staleness signal reads, but this spec doesn't touch that read path — keeping Sentry's staleness reader coherent with the new heartbeat file is FAFF-355's duty, not this ticket's. No edge needed.

**Risk profile? (principle 7)** — No spike needed. This is consumer wiring of three shipped pure CLIs onto an existing seam (`--forbidden-side-effect` reaches an evaluator input that already exists), with house test patterns in place and both ticket-level open questions settled by shipped prose rather than re-decided. The one genuine unknown — the aborted-resumable re-entry path — is already carried as a named assumption with a pre-build validation step and a stated degrade path ("this ticket still ships; note the gap in the PR"). That *is* the right-sized de-risking; a separate spike would be ceremony.

confidence: high

spec-review: approve
