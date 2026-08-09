# CI failure triage — classify flaky vs real and act per class in unattended runs

> Spec: faffter-dark-nlspec · 2026-07-06 · interactive · confidence: high. Full spec on Linear FAFF-391.
> Revised 2026-07-06 — flaky-register carrier punt resolved by human ratification: committed register (`operations/ci/flaky-register.json`). No other change.

This spec defines the CI failure-triage capability for FAFF-391: an autonomous build run that hits a red CI result classifies the failure and acts per class instead of applying today's single blunt rule. Audience: the build agent implementing it, and human reviewers of the design. It extends faff-graft's Step 10 merge-confidence gate and adds one deterministic CLI subcommand plus one contract.

## 1. WHY — Problem and Principles

**The load-bearing model:** a CI failure is not one event but a point in a three-axis space — **transience** (transient vs persistent), **fault domain** (infra vs code), and **origin** (this diff vs main-was-already-red) — and two of the three axes are mechanically observable (a clean re-run diffs transience; reading main's head checks decides origin). Triage means: observe the mechanical axes deterministically, spend LLM judgement only on the residue (fault domain when check metadata is ambiguous), coerce that judgement through a closed contract, and route a per-class action. This is the mechanical-classify / LLM-exercise / mechanical-validate triad the evaluator lane already established (ADR-0033), applied to CI.

**Problem:** today the entire triage policy is one prose sentence in faff-graft's Step 10 ci-red branch (re-run once; pass → transient; same failure → one fix attempt or park), and the autonomous flow summary drops even the re-run wording. An unattended run that cannot tell flaky from real either merges on noise or parks on noise, and a persistently flaky test is silently re-run forever with no memory and no filed work. This change makes classification mechanical-first and per-class action explicit, with persistent flakiness quarantined as discovered work.

**Design principles:**

**Triage never weakens the merge floor.** `faff merge-gate` never accepts a caller CI verdict — a triage verdict is not a trust-me-green. A cleared-transient failure proceeds only because the clean re-run made the head-sha checks actually green, and merge-gate independently re-observes them. Any implementation that passes a triage result *into* the merge decision is invalid.

**Classification is deterministic wherever the signal is deterministic.** The LLM reads a failure log only when structured check-run metadata cannot decide the fault domain, and its output is validated against a closed enum — malformed or out-of-enum coerces to `unknown`, and `unknown` routes fail-closed to a park. Never the reverse order (LLM first, mechanics as backstop).

**Memory outlives the run.** A flaky observation that dies with the run ledger (`.faff/` is gitignored) cannot become a persistence signal. The committed register (`operations/ci/flaky-register.json`) is the durable carrier — flaky history survives across runs in the repo itself.

**Reference context:**

| System | Location | Relevance |
|---|---|---|
| Step 10 merge-confidence gate, ci-red branch | `plugin/skills/faff-graft/SKILL.md` (interactive rule + Autonomous Mode flow item 6) | The wiring point this replaces one prose rule in |
| `classifyHeadShaChecks` + `faff merge-gate` | `plugin/skills/faff/bin/faff` | Existing pure CI classifier (`ci-green`/`ci-red`/`no-ci-coverage`/`indeterminate`) and the sole sanctioned merge path; the pattern (pure core + thin impure gh shell, `--selftest`) the new subcommand copies |
| Discovered-scope recording + filing | graft Step 9 recording; beep-boop §10 filing with `faff contain` | The quarantine ticket rides exactly this path |
| Contract machinery | `plugin/skills/faff/contracts/` + CONTRACTS registry + `validate.yml` | 15 existing schemas; ci-triage becomes the 16th |
| Transport-retry precedent | `review-call.mjs` | Retry-with-backoff exists for HTTP only; CI re-runs are a different mechanism, defined here |
| Failure-triage design intent | `design/lights-out-ci-environments.md` ("the first L4 gap"), `design/self-learning.md` (flaky quarantine auto-apply; flaky-test register as committed repo knowledge) | Prior art this spec makes concrete |

**Scope:** this sits inside graft's build/merge pipeline at the ci-red branch of Step 10, in both interactive and autonomous modes; beep-boop sees only the existing return vocabulary plus discovered-scope entries.

## 2. OUT OF SCOPE

- **Post-merge main health** — main going red *after* a merge lands is FAFF-385's concern (separate ticket). Extension point: a post-ship hook after the `ship` producer's `shipped` outcome.
- **Auto-editing tests to skip/quarantine in-code** — the run never modifies test files to silence a flaky (a code change outside the issue's mandate). The filed quarantine ticket is where a human-admitted build does that. Extension point: the quarantine ticket's own spec.
- **The `no-ci-coverage` branch** — unchanged; there is nothing to triage in an empty check set. Triage applies to `ci-red` only.
- **Self-learning auto-tuning** — thresholds stay fixed built-in defaults; feeding triage outcomes into the calibration/appetite machinery is the self-learning lane (`design/self-learning.md`). Extension point: the triage verdict JSON persisted per issue is the future signal source.
- **Non-GitHub CI substrates** — see the Assumptions section; a non-Actions check that cannot be re-run routes to park, not to a bespoke re-trigger. Extension point: the re-trigger step inside the triage procedure.
- **Retrying the adversarial-review or holdout gates** — those slots own their own failure posture (FAFF-227 scoped orchestrator-side flaky-infra out; this ticket is that concern for *CI checks only*).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| clean re-run | Re-triggering the failed checks on the **same head sha** with zero code change — the only re-run whose pass/fail diff carries classification signal |
| transience axis | `transient` (clean re-run went green) / `persistent` (same failure again) / `unknown` |
| fault-domain axis | `infra` (runner/daemon/network/setup fault) / `code` (assertion or check logic failed on the diff) / `unknown` |
| origin axis | `mine` (main's head is green on the failing check) / `main-was-red` (main's head already fails it) / `unknown` |
| flaky signature | Normalised identity of a flaky observation: check-run name plus best-effort failing-test identifier |
| quarantine | Recording a persistent flaky in the register **and** filing it as discovered work — never silently retrying forever |

**Triage verdict** (persisted to `.faff/runs/<run-id>/<ISSUE>/ci-triage.json` and emitted as the contract block):

```
RECORD TriageVerdict:
  pr: Integer
  head_sha: String                 # the sha the failure was observed on
  transience: ENUM { transient, persistent, unknown }
  fault_domain: ENUM { infra, code, unknown }
  origin: ENUM { mine, main-was-red, unknown }
  action: ENUM { proceed-to-merge-gate, fix-attempt, park-errored,
                 park-needs-human }          # derived by the pure core, never free-typed
  evidence:
    reruns_used: Integer            # 0..budget
    main_head_sha: String?          # what origin was judged against
    main_ci_state: String?          # classifyHeadShaChecks output for main's head
    fault_domain_source: ENUM { metadata, llm, none }
    flaky_signatures: List<String>  # matched or newly observed

  CONSTRAINT action is a pure function of (transience, fault_domain, origin)
```

**Flaky register entry** (durable, cross-run — carrier: committed `operations/ci/flaky-register.json`):

```
RECORD FlakyRegisterEntry:
  signature: String                 # flaky signature, the dedupe key
  events: List<{ observed_at, head_sha, run_ref }>
  quarantine_ticket: String?        # tracker id once filed; presence = already quarantined
```

**CLI surface — `faff ci-triage`:** follows the merge-gate shape: a pure classification core (registered in CONTRACTS, `--selftest`-covered, no network) plus a thin impure shell that observes `gh` — reads the PR head's check runs, reads **main's head** check runs via the same check-runs endpoint (`git rev-parse origin/main` → `repos/<repo>/commits/<sha>/check-runs`), reads the flaky register, and emits the TriageVerdict JSON. Exit codes: 0 verdict produced, 2 fail-loud (cannot establish PR identity / bad inputs). It accepts an optional `--fault-domain infra|code|unknown --fault-domain-source llm` input carrying the skill-side LLM tiebreaker (validated against the enum; anything else coerces to `unknown`).

**Contract — `faff-contract:ci-triage`:** schema JSON in `plugin/skills/faff/contracts/`, CONTRACTS registry entry, `validate.yml` selftest line, `docs/guide/cli.md` row — the full new-subcommand checklist (ADR-0014).

**Design decisions** (rationale collected in the Design Decision Rationale section):

- Taxonomy and the deterministic/LLM split — **Chosen:** three axes (transience, fault domain, origin); transience and origin are decided purely mechanically (clean re-run diff; main-head check-runs read); fault domain is mechanical-first from check-run metadata (`startup_failure`, `timed_out`, check never started → infra) with the LLM log-read as tiebreaker only when metadata yields `unknown`, its output coerced through the closed enum.
- v1 delivery shape — **Chosen:** a real `faff ci-triage` subcommand + `faff-contract:ci-triage` contract in v1, not graft-prose hardening with a CLI later. Prose-only guards demonstrably rot (the autonomous flow already dropped the re-run wording that the interactive prose has).
- CLI side-effect boundary — **Chosen:** `faff ci-triage` observes and classifies only; it never re-triggers runs, parks, files tickets, or merges. The skill acts on the verdict; `faff merge-gate` remains the sole merge path.
- Re-trigger mechanism and budget — **Chosen:** `gh run rerun <run-id> --failed` as the primary re-trigger; an empty commit (`--allow-empty` + push) as the fallback when the failed check is not a re-runnable Actions run — noting the empty commit moves the head sha, so classification restarts against the new sha. Budget: **one** clean re-run per distinct head sha, at most **two** re-runs total per issue-build. Close/reopen is rejected as a re-trigger (mutates PR state, races concurrent orchestrators).
- Flaky persistence carrier — **Chosen:** a git-committed register at `operations/ci/flaky-register.json` whose mechanical one-entry append rides the current feature PR. Ratified by human 2026-07-06 (was the spec's one punt). Accumulates cleanly as greppable repo knowledge (the `design/self-learning.md` recommendation); the accepted costs — register hunks in feature diffs, append conflicts under the parallel concurrency executor — are named in failure modes with their revisit trigger. The tracker-ticket-held alternative was rejected: the accumulator would live in tracker state and need a fetch to consult. All register access goes through one small read/append accessor.
- Quarantine shape — **Chosen:** when a flaky signature reaches **3 recorded events**, quarantine = mark the register entry + record a discovered-scope entry (`relationship: "none"`, provenance "persistent flaky observed during build of ISSUE-XX") in the standard `discovered-scope.json`; beep-boop's filing step applies its normal `faff contain` chokepoint. If containment says `outward`, the item is surfaced-not-filed per existing rules — acceptable, because the register (not the ticket) is the durable memory, and `/faff-wtf` surfaces the run summary. Dedupe: a signature whose register entry already carries `quarantine_ticket` is never re-filed.
- Known-flaky failures still gate — **Chosen:** a failure matching a registered flaky signature is **never** treated as green without its own clean re-run passing. The register changes economics only: a matched failure does not consume the autonomous fix attempt, and its event increments the register. Anything else would let the register silently erode the merge floor.
- Main-was-red action — **Chosen:** when origin is `main-was-red`, do not spend the fix attempt and never attempt to fix main from inside a feature-issue mandate: park `needs-human` naming the failing check and main's red head sha, and record a discovered-scope entry ("main is red on <check>") so the repair becomes visible tracked work. (The PR cannot merge anyway — merge-gate observes the red head.)
- Wiring point and orchestrator visibility — **Chosen:** the triage procedure replaces the single prose rule at the top of graft Step 10's ci-red branch, in **both** the interactive rule and the autonomous flow (which today diverge). beep-boop is untouched: it sees the existing return vocabulary (`shipped` / `pr-open-for-human` / `parked` / `errored`) plus ordinary discovered-scope entries. Interactive mode runs the identical mechanical triage but surfaces the classification and asks per Step 11 instead of auto-acting.

## 4. HOW — Behavior

**Overview:** on `ci-red`, graft invokes `faff ci-triage` to observe origin and match the register, performs the bounded clean re-run to resolve transience, optionally supplies the LLM fault-domain tiebreaker back into the CLI, then routes on the verdict's derived `action`. The verdict JSON is persisted per issue; the contract block is validated via `faff contract ci-triage`.

**Triage procedure** (replaces the current one-sentence rule; runs at the top of Step 10's ci-red branch):

```
PROCEDURE triage_ci_red(pr, head_sha):
  1. verdict := faff ci-triage --pr N --issue ID --run-dir DIR     # observes PR head + main head + register
  2. IF verdict.origin == main-was-red:
       record discovered-scope entry ("main is red on <check>")
       park needs-human (cause: main-was-red, evidence: main_head_sha + check name); STOP
  3. IF rerun budget available for this head_sha:
       re-trigger failed checks (gh run rerun --failed; fallback empty commit)
       wait to terminal state (gh pr checks --watch)
       IF green: transience = transient
         → record flaky event(s) against the signature(s) in the register
         → IF any signature reaches 3 events and has no quarantine_ticket:
             record quarantine discovered-scope entry
         → proceed to the merge gate: faff merge-gate re-observes CI itself
           (the triage verdict is NEVER passed to it); STOP
       ELSE: transience = persistent
  4. IF verdict.fault_domain == unknown:                            # metadata could not decide
       read the failure log (in-context LLM judgement, graft-side)
       feed the call back: faff ci-triage ... --fault-domain <infra|code|unknown> --fault-domain-source llm
       # the CLI validates against the closed enum; malformed → unknown
  5. Route on the final verdict.action (table below).
```

**Per-class action table** (the pure core's derivation — `unknown` always falls to the fail-closed row):

| transience | fault domain | origin | action | mode behaviour |
|---|---|---|---|---|
| transient | any | mine | `proceed-to-merge-gate` | both modes: continue; fix attempt NOT consumed |
| persistent | code | mine | `fix-attempt` | autonomous: one fix attempt if the failure is evident from the logs, else park; interactive: ask per Step 11 |
| persistent | infra | any | `park-errored` | park as `errored` per the shared protocol (runner outage, missing secret — not a code defect) |
| any | any | main-was-red | `park-needs-human` | park; discovered-scope entry for the main breakage |
| any `unknown` on a routing axis | | | `park-needs-human` | fail-closed |

**Re-trigger mechanics:** `gh run rerun` needs the workflow **run id**, resolved from the failing check-run's metadata on the head sha; `--failed` limits the re-run to failed jobs. A fix-push during iteration creates a new head sha with a fresh single-re-run allowance, capped at two re-runs total per issue-build — after the cap, transience is `persistent` by fiat. The budget exists so a wobbling check converges to a decision instead of burning CI forever.

**Register updates** are mechanical appends keyed by signature (signature = check-run name + best-effort failing-test identifier extracted from the log; when extraction fails, the check-run name alone — coarser but still a valid dedupe key). No entry is ever deleted autonomously; the quarantine ticket's human-admitted work retires entries.

**Anti-pattern:** passing the triage verdict (or any "it was flaky, trust me" signal) into `faff merge-gate`. Why: merge-gate's contract is that it observes CI itself on the head sha; the cleared-transient path merges only because the checks are *actually* green after the clean re-run.

**Anti-pattern:** re-running after a code change and reading a pass as "it was flaky". Why: the diff changed; the comparison is meaningless. Only a same-sha re-run classifies.

**Edge cases:**

- **`gh` API failure mid-triage** (cannot read main's head, cannot resolve the run id): the affected axis is `unknown` → fail-closed park, mirroring merge-gate's indeterminate posture. Retryable at the transport level; terminal for this triage pass.
- **Multiple failed checks with mixed classes:** the strictest class wins (any persistent-code check → `fix-attempt` path; any unresolved `unknown` → park). One red check is enough to block; triage never averages.
- **Main red on a *different* check than the PR's failure:** origin is `mine` for the failing check — main-was-red is per-check, not per-repo.
- **Concurrent execution:** the parallel executor's rebase-before-merge already forces re-validation on the rebased head; a rebase resets the head sha and with it the re-run allowance (still under the per-build cap).

**Failure modes:**

- **The failure:** a real nondeterministic bug (a race in the product code) classifies as `transient` and merges — the re-run diff cannot distinguish "flaky test" from "flaky code". **How you'd know:** the same signature accumulates register events across unrelated PRs. **What it means:** the quarantine threshold is the safety net — at 3 events it becomes filed, human-visible work; the class is contained, not eliminated. Proceed.
- **The failure:** the committed register generates append conflicts under parallel builds or reviewer friction over register lines in feature diffs. **How you'd know:** rebase conflicts on the register file; review comments on unrelated register hunks. **What it means:** revisit the carrier — the tracker-held alternative exists precisely for this; all access is behind the single accessor, so a carrier swap is contained.
- **The failure:** metadata-based infra detection misclassifies a code failure as `infra` (e.g. a legitimate test timing out reads as `timed_out`). **How you'd know:** an `errored` park whose log shows an assertion, not a runner fault. **What it means:** narrow the metadata pattern set; the LLM tiebreaker order (metadata first) makes this conservative by construction.

## Scenarios

```
Given a PR whose CI is red and a clean re-run on the same head sha goes green
When graft's Step 10 triage runs
Then the build proceeds to faff merge-gate, which independently observes the now-green head,
  the autonomous fix attempt is not consumed,
  and the flaky signature gains a register event
```

```
Given a flaky signature that reaches its third recorded event with no quarantine ticket
When the triage procedure records the event
Then a discovered-scope entry for quarantining that test exists in the run's discovered-scope.json
  and beep-boop's filing step routes it through faff contain like any discovered work
```

```
Given main's head sha is red on the same check that fails the PR
When triage runs
Then the build parks needs-human without spending a fix attempt,
  the park comment names the check and main's head sha,
  and a discovered-scope entry records the main breakage
```

```
Given the gh API cannot resolve main's head checks during triage
When the origin axis evaluates
Then it is unknown and the build parks needs-human (fail-closed), never proceeds
```

Assertions (non-functional):

- `faff ci-triage --selftest` exercises the pure classification core (action derivation for every axis combination, including all-`unknown`) with no network.
- The triage verdict never reaches `faff merge-gate` as an input on any code path.
- At most 2 re-runs occur per issue-build regardless of head-sha churn.

## 6. Design Decision Rationale

**Which axes are deterministic vs LLM?** Options: all-LLM (one log read decides everything — cheap to build, unauditable, violates deterministic-tools-over-prose), all-mechanical (no log read — leaves fault domain `unknown` whenever metadata is ambiguous, over-parking), hybrid per the ADR-0033 triad. **Chosen:** hybrid — transience and origin fully mechanical, fault domain mechanical-first with a validated LLM tiebreaker. Rationale: the two decisive axes have exact mechanical observables; only the residue justifies judgement.

**CLI + contract now, or prose first?** Options: prose-only hardening (small diff, ships fast) vs subcommand + contract (heavier, testable). **Chosen:** subcommand + contract in v1. Rationale: the existing prose rule already drifted between graft's interactive and autonomous sections — the precise failure mode prose guards have in this repo; the pure core is exactly the kind of decision table `--selftest` locks down.

**Where do side effects live?** **Chosen:** CLI observes/classifies; skill acts. Rationale: mirrors merge-gate's pure-core/impure-shell split and keeps `faff merge-gate` the sole merge path and the park protocol skill-owned.

**Re-trigger mechanism?** Options: `gh run rerun --failed` (surgical, same sha), close/reopen (blunt, mutates PR state, races peers), empty-commit push (universal but moves the sha). **Chosen:** `gh run rerun --failed` primary, empty commit fallback, close/reopen rejected. At the time of writing no skill documents any re-trigger — this spec defines it first.

**Flaky persistence carrier?** **Chosen:** committed `operations/ci/flaky-register.json` riding the feature PR — ratified by human 2026-07-06 (was the spec's one punt; tracker-ticket-held state rejected: accumulator in tracker state, fetch to consult). The append-conflict/diff-noise costs are accepted with a named revisit trigger in failure modes; all access behind one accessor keeps a future carrier swap contained.

**Quarantine threshold and shape?** **Chosen:** 3 events per signature, quarantine = register mark + discovered-scope entry, never an autonomous test-file edit. Fixed built-in default (matching the gateway's calibration-threshold precedent of built-in, non-`.faffrc` values); revisit when the self-learning lane makes thresholds evidence-driven.

**Known-flaky economics?** **Chosen:** register match never auto-greens; it only spares the fix attempt and increments history. Rationale: the merge floor is non-delegable; the register is memory, not authority.

**Main-was-red response?** Options: proceed anyway (impossible — merge-gate refuses red), attempt to fix main (mandate violation), park + surface. **Chosen:** park needs-human + discovered-scope entry.

**Wiring?** **Chosen:** both graft Step 10 ci-red call sites (interactive rule and autonomous flow item), converging today's divergent wording onto one procedure; beep-boop untouched.

## 7. Open Questions and Assumptions

**Open questions:** none — the flaky-register carrier (the spec's one punt) was ratified by the human on 2026-07-06: committed `operations/ci/flaky-register.json`. Every other decision was closed at authoring.

**Assumptions:**

- **Assumes:** GitHub Actions is the CI substrate — `gh run rerun --failed` exists and the authenticated `gh` token can re-run workflows. Validation: `gh run rerun --help` succeeds and a probe re-run on a historical run is accepted (or dry-check token scopes via `gh auth status`). Where a failing check is not a re-runnable Actions run, the empty-commit fallback applies; where neither works, transience stays `unknown` → fail-closed park. Per the methodology critique, run this probe as a pre-build gate, not a build-time assumption.
- **Assumes:** the eval seam registry (`eval/seam-registry.json`) and grader `KIND` machinery accept a new judgement seam row for the fault-domain log-read (verified present; listed for its conventions — the DONE eval item depends on them).

## 8. DONE — Definition of Done

### From WHY
- [ ] On `ci-red`, both graft modes execute the same triage procedure — the interactive/autonomous wording divergence in Step 10 is gone.

### From WHAT (CLI + contract)
- [ ] `faff ci-triage` exists: COMMANDS entry, handler, `docs/guide/cli.md` row, `--selftest` covering the pure action-derivation table (every axis combination incl. all-`unknown` → `park-needs-human`), no network in selftest.
- [ ] `faff-contract:ci-triage` schema in `plugin/skills/faff/contracts/`, CONTRACTS registry entry, `validate.yml` selftest line; malformed or out-of-enum LLM fault-domain input coerces to `unknown`.
- [ ] TriageVerdict persisted to `.faff/runs/<run-id>/<ISSUE>/ci-triage.json` for every ci-red triage pass.
- [ ] The committed flaky register exists at `operations/ci/flaky-register.json` behind a single read/append accessor.

### From HOW (behaviour)
- [ ] Clean same-sha re-run green → proceed; `faff merge-gate` is re-invoked and observes CI itself; no code path passes the triage verdict to merge-gate.
- [ ] Re-run budget enforced: one per head sha, two per issue-build; cap exhaustion yields `persistent`.
- [ ] `main-was-red` (per-check, via main-head check-runs) → park needs-human without consuming the fix attempt + discovered-scope entry naming the check.
- [ ] Persistent+infra → park `errored`; persistent+code+mine → existing one-fix-attempt path; any routing-axis `unknown` → park needs-human.
- [ ] Flaky events recorded per signature; third event with no `quarantine_ticket` → discovered-scope quarantine entry; register-matched failures never auto-green and never re-file.
- [ ] FAFF-12's description trimmed of its failure-triage prose (tracker edit) once this ships.

### From DONE (eval coverage)
- [ ] The fault-domain log-read seam registers its grader `KIND`, ≥1 eval case, and the seam-registry row in this ticket (baseline recording stays human-supervised, not required here).

**Integration smoke test:**

```
1. Point a PR at a branch with a check that fails once then passes (fixture workflow or replayed check-run data)
2. Drive graft Step 10 to ci-red → triage → clean re-run → green
3. Assert: ci-triage.json shows transient/mine, merge proceeded via faff merge-gate,
   register gained one event, no fix attempt consumed
```

confidence: high
