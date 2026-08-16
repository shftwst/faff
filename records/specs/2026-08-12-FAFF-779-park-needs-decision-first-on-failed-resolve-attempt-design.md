# Spec — FAFF-779: park `needs-decision-first` after the first failed resolve-attempt

> Spec: faffter-dark-nlspec · 2026-08-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-779.
> Human resolution folded in: use a short dedicated park-reason line; do not reuse the full run-summary decision text.  
> Delivery constraint retained: full frontier eval sweep, then explicit human sign-off; never auto-merge.

This is the build contract for the coding agent and the human reviewer. It reconciles the contradictory routing prose that currently lets a failed `needs-decision-first` resolve-attempt remain surfaced in Todo, where the eligibility query repeatedly selects it. The change parks that issue on the first failure, records the park through the shared protocol, and preserves the existing human-resolution/unpark path.

## 1. WHY — problem and principles

An automation-eligible Todo issue leaves the eligible pool only when it gains an exclusion such as `faff-parked`. Today a retained-`medium` or open-Punt spec receives `needs-decision-first`; when its bounded resolve-attempt fails, several prompt surfaces describe it as “routed out” or “skipped and surfaced.” It therefore remains Todo without `faff-parked` and is selected again on every autonomous pass. The issue reports six empty drains in one afternoon.

The failed resolve-attempt is not the bug. Genuine product or architecture choices should remain human-owned. The bug is recording that failure as a clean route-out instead of a reversible park.

The canonical contract already points toward the intended behavior:

- `plugin/skills/faff/SKILL.md` → **Resolve-attempt before park** says failures for `needs-decision-first`, `gap-blocked`, and `circular-blocked` park.
- `plugin/skills/faff/bin/lib/contract-defs.js` describes `needs-decision-first` as “resolve-attempt then park.”
- The conflicting surfaces are the gateway autonomous summary, build-pipeline matrix/spec-readiness prose, the routing adaptor recap, and beep-boop queue/reporting prose.
- `park-history.js` already consumes `faff-parks` records and recognizes `punt-not-closed`, `gap`, and `cycle`, but production prompt flow does not currently instruct the shared Park protocol to emit the record.
- `disposition.js` already treats `parked` as attention and `routed-out` as clean; only its explanatory “never attempted” framing becomes stale for this case.

Principles:

- Park on the first failed resolve-attempt. Do not add an N-pass counter that knowingly spends more empty sessions.
- Reuse the shared Park and Unpark protocols. No second label, command, or recovery path.
- Keep disposition change scoped to `needs-decision-first`. Its failed attempt changes from `routed-out` to `parked`; the sibling verdicts already park.
- Put `faff-parks` emission in the shared Park protocol, because every park must be visible to the existing history and disposition readers.
- Keep prompt edits lean and single-sourced per `docs/reference/skill-authoring.md`; point adaptors/orchestrators to the gateway contract instead of duplicating full procedure text.
- The human-facing park reason is a short dedicated line naming the unresolved Punt and its owner. The fuller “what a human needs to decide” explanation remains in the run summary and is not copied verbatim into the park reason.

## 2. OUT OF SCOPE

- Changing verdict assignment or the six-value automation-routing schema.
- Changing `computeAutomationRouting` or adding a new routing verdict.
- Changing runner cadence, Linear queries, or tracker schema.
- Parking successful resolve-attempts.
- Changing interactive ownership of product/architecture decisions.
- Replacing the run summary’s fuller decision explanation.
- Adding a general park-record CLI or a second storage format.
- Changing the 21-day/three-park repeat threshold.
- Automatically clearing the park before a human resolves the Punt.
- Recording or accepting a new frontier baseline as part of deterministic implementation tests.

## 3. WHAT — edit set

### Gateway: `plugin/skills/faff/SKILL.md`

Reconcile the gateway onto one rule:

- In the autonomous-behavior summary, replace the statement that retained `medium` routes out after failure with: attach/retain rating, run the appetite-governed resolve-attempt, and park if that attempt does not produce an admissible answer.
- In the build-pipeline `confidence: medium` row, make the non-proceeding outcome explicit: at `low`/`medium`, and at `high` when the attempt fails, park rather than merely surface unparked.
- In **Spec readiness (fixed)**, retain the durable `medium` rating and `needs-decision-first` mapping, but state that a failed resolve-attempt invokes the shared Park protocol.
- Do not weaken Live-thread reconciliation: a later human resolution still invalidates the retained medium snapshot, triggers narrow prep, and typically re-rates to high.
- Extend **Park protocol (shared)** so each park:
  - preserves WIP and opens/updates a draft PR **only when those artifacts already exist**; a pre-build `needs-decision-first` park has neither and skips both steps without manufacturing a branch, worktree, or PR;
  - posts its human-facing comment and applies `faff-parked`;
  - appends exactly one record to the orchestrator-owned in-run park-record accumulator with `{ issue_id, root_cause_class, timestamp }`;
  - uses the routing adaptor’s assigned root-cause class rather than re-deriving it;
  - uses `punt-not-closed` for this failed `needs-decision-first` case.
- Define the accumulator and render boundary at this single shared locus:
  - the run orchestrator owns one ordered `park_records` array for the run; workers return park facts to the orchestrator and never concurrently edit `summary.md`;
  - a completed Park-protocol invocation contributes exactly one record, after the label/comment park transition succeeds; retries or backstop reconciliation deduplicate by that park transition rather than appending a second record;
  - zero parks render a valid empty `[]`; multiple parks retain occurrence order and may contain the same issue/class again only when they represent distinct completed park transitions in that run;
  - at run-end summary rendering, serialize the complete accumulator once as the canonical fenced `faff-parks` JSON block; no mid-run append to a not-yet-rendered summary file occurs.
- Define the short comment rule at this single shared locus: the reason line names the unresolved Punt and `(decides: <owner>)`; supporting detail may follow under “attempted” and “needed,” but the reason line must not paste the run-summary decision paragraph.

Canonical reason shape:

> **Park reason:** unresolved Punt — `<short decision topic>` (`decides: <owner>`).

The exact topic is derived from the Punt, kept to one line, and excludes the run summary’s recovery/process prose.

### Routing adaptor: `plugin/skills/faffidavit-routing/SKILL.md`

Change the `needs-decision-first` recap cell from “skipped and surfaced” to a lean reference to the shared behavior:

- bounded resolve-attempt;
- on failure, park through the gateway Park protocol;
- root cause `punt-not-closed`;
- short reason line naming the Punt and `decides:` owner.

Do not duplicate the gateway’s full label/comment/record procedure.

### Orchestrator: `plugin/skills/faff-beep-boop/SKILL.md`

Reconcile all relevant queue/reporting surfaces:

- A `promoted-needs-review` candidate remains non-build-admitted until its live-thread-reconciled spec is ready, but a failed/withheld `needs-decision-first` resolve-attempt is recorded as `parked`, not `routed-out`.
- Build-queue assembly must not immediately finalize `needs-decision-first` as clean `routed-out` before the required resolve-attempt/park disposition is applied.
- Run-ledger `outcomes[issue]` is the bare string `"parked"` for this case.
- The run summary places it in Parked, not Routed out.
- Beep-boop’s park backstop confirms the comment, label, `park.md`, and shared `faff-parks` summary record.
- Beep-boop owns the run’s `park_records` accumulator, receives park facts from returns/backstops, deduplicates retries of the same completed transition, and renders it once at run end in the canonical summary template:

  ````markdown
  ```faff-parks
  []
  ```
  ````

  Replace `[]` with the ordered JSON array when parks occurred. Keep this machine-readable block present even for zero parks so `park-history` sees one stable producer shape.
- Keep other non-admitted verdicts and genuinely clean route-outs unchanged.
- Avoid copying the gateway procedure; reference the shared routing and Park contracts.

### Contract and deterministic readers

- Leave `plugin/skills/faff/bin/lib/contract-defs.js` automation-routing schema and computation unchanged. Its existing `needs-decision-first` description remains the canonical check: “resolve-attempt then park.”
- In `plugin/skills/faff/bin/lib/disposition.js`, update the explanatory comment that says every `routed-out` issue was “never attempted.” Clarify that failed `needs-decision-first` attempts are now `parked`; remaining routed-out outcomes stay clean. No logic change.
- Leave `park-history.js` root-cause vocabulary and counting logic unchanged.

### Tests and eval coverage

Add deterministic harness coverage at the behavioral orchestration seam, not only consumer fixtures:

- A `needs-decision-first` candidate with a failed resolve-attempt invokes the Park protocol and yields:
  - `faff-parked`;
  - a short reason line naming the Punt and `decides:` owner;
  - no pasted full run-summary decision text;
  - `faff-parks` record with `root_cause_class: "punt-not-closed"`;
  - run-ledger outcome `"parked"`;
  - Parked summary membership and no Routed-out membership.
- A pre-build failed attempt creates no branch, worktree, or draft PR; a build-stage park with existing WIP/PR still preserves WIP and updates the existing PR as draft.
- The next eligible/build assembly excludes the labeled issue and does not invoke a second resolve/model pass.
- A successful resolve-attempt remains build-admissible and does not park.
- A later human comment resolving the Punt causes narrow prep/live-thread reconciliation, high re-rating where warranted, removal of `faff-parked`, and normal build admission.
- Extend/reuse `test/disposition.test.mjs` to preserve the existing proof that `"parked"` plus a `punt-not-closed` record produces `needs-attention`.
- Extend/reuse `test/faff-tidy-repeat-park.test.mjs` to show three shared-protocol records for the same issue/class are visible to `faff park-history`; include one `gap` or `cycle` case proving the writer is shared rather than Punt-special-cased.
- Exercise the summary producer with zero, one, and multiple parks: it emits exactly one `faff-parks` fence, `[]` for zero, occurrence-ordered records for multiple parks, and exactly one record for one completed transition even when its return/backstop is reconciled twice.
- Add/update routing eval fixtures if needed so the changed judgement seam is born with coverage. Do not pretend the current routing sweep alone proves post-resolve disposition: deterministic harness coverage is the correctness oracle.

## 4. HOW — behavior

```text
PROCEDURE handle_needs_decision_first(issue, spec, appetite):
  reconcile spec against the live tracker thread

  if the Punt was resolved:
    run narrow prep
    re-rate and route from the refreshed spec
    return

  if appetite permits a bounded resolve-attempt:
    consult decisions register
    if no decisive precedent:
      inspect the bounded local context allowed by appetite

    if one admissible answer is established:
      post the existing resolve-attempt audit comment
      continue through normal build admission
      return

  root_cause_class = "punt-not-closed"
  reason = "unresolved Punt — <short topic> (decides: <owner>)"

  invoke shared Park protocol:
    if a branch/worktree already exists:
      preserve its WIP
    if a PR already exists:
      update it as draft
    # a pre-build needs-decision-first park creates neither artifact
    post cause / attempted / human-needed comment using the short reason
    apply faff-parked
    write park.md and normal logs
    return one park fact { issue_id, root_cause_class, timestamp } to orchestrator

  orchestrator records that completed park transition once in park_records

  run-ledger outcomes[issue] = "parked"
  report issue under Parked
  return
```

At run end, the orchestrator writes the summary prose and exactly one fenced block from the ordered accumulator:

````text
```faff-parks
<JSON.stringify(park_records, null, 2)>
```
````

No park worker edits `summary.md`; the run-end renderer is the sole writer of this block. An empty run emits `[]`. Reconciliation of the same completed park transition is idempotent; a genuinely later completed park transition may add another occurrence.

The issue then remains excluded from autonomous eligibility until the human answers the Punt. On the next full drain, live-thread reconciliation routes it through narrow prep; a sufficiently closed spec re-rates high, the Unpark protocol clears `faff-parked`, and the issue becomes eligible.

## 5. Scenarios

### Failed attempt parks immediately

```text
Given an automation-eligible Todo issue with a retained-medium spec
And its open Punt is "compact park reason or full run-summary text" (decides: product)
When automation assigns needs-decision-first
And the bounded resolve-attempt cannot author the product choice
Then the issue receives faff-parked
And its reason line is "unresolved Punt — park-comment wording (decides: product)"
And the comment does not paste the full run-summary decision text
And faff-parks records punt-not-closed
And the run-ledger outcome is "parked"
And the issue appears under Parked, not Routed out
```

### No eligible-pool churn

```text
Given that issue is parked in Todo
When the next eligibility/build-queue pass runs
Then nin[faff-parked, faff-automation-hold] excludes it
And no new verdict or model session is spent on it
```

### Successful attempt remains buildable

```text
Given needs-decision-first whose bounded consult finds one admissible existing precedent
When the resolve-attempt succeeds
Then the existing audit comment is posted
And the issue is not labeled faff-parked
And it proceeds through ordinary admission
```

### Human resolution restores flow

```text
Given the failed-attempt issue is parked
And a human comment chooses the shorter dedicated park-reason line
When the next full drain performs live-thread reconciliation and narrow prep
Then the Punt is closed in the refreshed spec
And confidence is re-rated high
And the Unpark protocol removes faff-parked
And the issue may enter the build queue
```

### Shared record writer

```text
Given one punt park, one gap park, and one cycle park
When each uses the shared Park protocol
Then the run summary contains one correctly classified faff-parks record for each park
And park-history consumes all three without verdict-specific writers
```

### Pre-build park does not manufacture delivery artifacts

```text
Given needs-decision-first fails before build admission
And no worktree, branch, or PR exists for the issue
When the shared Park protocol runs
Then it posts the park comment, applies faff-parked, returns one park fact, and writes normal logs
And it creates no worktree, branch, commit, or PR
```

### Canonical summary record production

```text
Given a run with zero completed park transitions
When the orchestrator renders summary.md
Then it emits exactly one faff-parks fence containing []

Given a run with multiple completed park transitions
When the orchestrator renders summary.md
Then it emits exactly one faff-parks fence containing their occurrence-ordered records
And reconciling one transition twice does not duplicate its record
```

## 6. Decisions and rationale

**Chosen: short dedicated park-reason line.** The park comment uses a single concise reason naming the Punt and `decides:` owner. It does not reuse the full run-summary “what a human needs to decide” paragraph. This keeps the control-plane comment scannable while the run summary retains richer audit context.

**Chosen: first failed attempt parks.** Waiting for repeated route-outs would preserve the waste this ticket exists to remove and require a new counter.

**Chosen: shared Park protocol owns record emission.** `park-history` consumes all park classes, and no production prompt currently owns the write. A Punt-only writer would leave gap/cycle history blind.

**Chosen: orchestrator-owned accumulator, run-end render.** Park workers return facts; the orchestrator records each completed transition once and is the sole `summary.md` writer. This avoids concurrent edits and gives `park-history` a stable fence even when the array is empty.

**Chosen: WIP and draft-PR steps are conditional.** They preserve existing build artifacts but never manufacture delivery artifacts for a pre-build routing park.

**Chosen: `punt-not-closed`.** It precisely describes an unresolved spec Punt and already belongs to the closed root-cause vocabulary.

**Chosen: run-ledger outcome `parked`.** The issue was attempted and needs attention; `routed-out` is the wrong ground truth and is intentionally clean in `disposition`.

**Chosen: schema unchanged.** The automation-routing contract already says “resolve-attempt then park”; the defect is inconsistent consumers/prose, not contract shape.

**Chosen: deterministic tests prove disposition; frontier sweep protects posture.** The existing routing sweep primarily grades verdict assignment. It must pass before merge, but a green sweep is not substituted for direct behavioral assertions.

## 7. Assumptions and failure handling

- **Assumes:** `faff-parked` remains an eligibility exclusion. Validate against the real eligibility/next seam in the deterministic test.
- **Assumes:** Live-thread reconciliation and Unpark remain the sole re-entry mechanism. Test the round trip rather than introducing an `unpark` command.
- **Assumes:** `ROOT_CAUSE_CLASSES` continues to include `punt-not-closed`, `gap`, and `cycle`; fail loudly if a produced class falls outside the closed vocabulary.
- A park with label/comment but no `faff-parks` record is incomplete and fails acceptance.
- A record without `faff-parked` is also incomplete: history visibility does not stop eligibility churn.
- A failed pre-build resolve-attempt that creates a branch, worktree, commit, or PR is a protocol violation.
- A summary with zero or multiple `faff-parks` fences, or with a duplicate record produced only by retry/backstop reconciliation, is malformed producer output.
- Failure to update the ledger to `"parked"` is ground-truth divergence and fails runcheck/reconciliation.
- If summary-record emission cannot be proved at the orchestration seam, do not satisfy the requirement with hand-authored consumer fixtures alone.
- If the paid frontier sweep is unavailable or regresses, leave the PR unmerged and surfaced for a human; do not waive or replace it with a local soft gate.
- The repository currently has no unrelated dirty worktree changes, and all cited surfaces were re-read at HEAD `ce1d599`.

## 8. DONE — definition of done

- [ ] A failed `needs-decision-first` resolve-attempt parks on its first failure.
- [ ] The issue receives `faff-parked` and is absent from the next eligible/build candidate set.
- [ ] The park comment’s dedicated reason line names the unresolved Punt and `decides:` owner.
- [ ] The park reason does not duplicate the full run-summary decision text.
- [ ] The shared Park protocol emits `{ issue_id, root_cause_class, timestamp }`.
- [ ] WIP preservation and draft-PR update occur only when those artifacts already exist; the pre-build case creates none.
- [ ] The orchestrator owns one ordered in-run `park_records` accumulator; workers never edit `summary.md`.
- [ ] Each completed park transition contributes exactly one record; retry/backstop reconciliation is idempotent.
- [ ] Run-end rendering emits exactly one canonical fenced `faff-parks` block, including `[]` when no parks occurred and occurrence-ordered records when multiple parks occurred.
- [ ] The failed-Punt record uses `root_cause_class: "punt-not-closed"`.
- [ ] Gap/cycle parks use the same writer with their existing classes.
- [ ] Run-ledger outcome is the bare string `"parked"`.
- [ ] The run summary classifies the issue as Parked, not Routed out.
- [ ] Gateway, routing adaptor, and beep-boop no longer contradict “resolve-attempt then park.”
- [ ] `automation-routing` schema/computation remains unchanged.
- [ ] `disposition.js` no longer claims this attempted case is a clean route-out.
- [ ] A successful resolve-attempt continues without parking.
- [ ] Human resolution through a tracker comment refreshes/re-rates/unparks through the existing protocols.
- [ ] Deterministic tests prove park emission, eligibility exclusion, ledger/summary disposition, history visibility, and recovery.
- [ ] Skill edits pass `faff validate-adapters` and `faff lint-refs`.
- [ ] Relevant unit/harness tests and the normal repository validation suite pass.
- [ ] The full hard frontier gate passes: `node eval/run-evals.mjs --gate --driver frontier`.
- [ ] A human explicitly signs off on the PR after reviewing the sweep result.
- [ ] The PR is never auto-merged.

## Delivery gate — mandatory

This autonomous-posture change must not auto-merge.

Merge order is fixed:

1. Deterministic tests and normal CI pass.
2. `node eval/run-evals.mjs --gate --driver frontier` completes successfully with no regression.
3. A human reviews the behavioral evidence and explicitly signs off on the PR.
4. Only then may the PR merge.

build-tier: complex
spec-review: approve

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ]
}
```

Self-review:

- No open Punt remains: the human chose the shorter dedicated park-reason line.
- Confidence rises from medium to high because the sole product decision is now closed and the code/prose loci were freshly verified.
- The frontier sweep plus human sign-off remains an explicit delivery gate, not an implementation oracle.
- The main build risk is proving production `faff-parks` emission at the orchestration seam; hand-seeded reader tests alone are insufficient.
- Scope remains cohesive: one disposition correction, with the shared record write required to make that disposition observable end to end.
