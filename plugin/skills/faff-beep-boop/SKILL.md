---
name: faff-beep-boop
description: "Run ready work unattended: tidy, drain prep, then drain builds. Parks ambiguity for /faff-wtf. Use for overnight, fire-and-forget or running the backlog."
---

# Faff — Beep-Boop

Unattended end-to-end runs of the faff suite. Drives the other faff skills in **autonomous mode** — no prompts, no human in the loop, parks anything ambiguous, logs everything to `.faff/runs/…`. This skill is the orchestrator: it does not reimplement prep, build, or tidy — it invokes the existing faff sub-skills with the autonomous-mode signal set.

**Methodology lens.** The `methodology` slot **always runs** — it defaults to `faffter-noon-methodology-thematic` when `.faff/config.yaml` sets none, and its `pick-ordering` / `build-queue` outputs are Required (gateway → **The `methodology` slot**), so it owns build-queue order. Only the banner is *conditional*: the run summary's first line is `Methodology: [skill-name]` and an opinionated lens (e.g. `faffter-dark-methodology-agile-delivery`) re-sequences by its own logic (value × risk × dep-aware) rather than the thematic default's baseline order. When the slot is the silent thematic default, the banner is omitted and the order is whatever the default's `pick-ordering` returns (priority + chainable unlock value) — beep-boop renders the slot's order and never names a baseline of its own; the slot is never *skipped*. **No WIP gating** — autonomous queues are unbounded regardless of methodology. Admission stays governed by the verdict gate (admit `fire-and-forget` + `likely-fire`, route out the other four verdicts).

## Configuration

**Load the kernel first.** Read `faff/references/kernel.md` if absent this turn. Skip the bare routing gateway `faff/SKILL.md`. Then batch independent Read calls for `faff/references/build.md`, `faff/references/tracker.md`, `faff/references/autonomous.md`, `faff/references/methodology.md`, `faff/references/l4.md` and `faff/references/park.md` in the same request where supported. Finish any clipped or failed reads before acting. The fixed automation-routing admission rule gates the queue. Tidy, prep, graft and their slots inherit the gateway rules.

**Tracker availability is resolved once per run (gateway → Tracker availability resolution).** The run's once-resolved git-only signal (never per wave, step 8.5) **is** the shared tracker-side answer: honour a `tracking.tracker` pin, discover the connector before concluding git-only (never infer absence from an immediately-invisible tool list under a deferred-tool harness), and hold that one resolved answer for the run's lifecycle; delegated skills (tidy/prep/graft) consume it without re-inferring.

Beep-boop uses these `slots` from `.faff/config.yaml` when set:

- `concurrency` — the build-pass executor. Default `faffter-noon-concurrency-sequential` (one build at a time); swap to `faffter-dark-concurrency-parallel` for capped, worktree-isolated concurrency with rebase-before-merge.
- `spec`, `review`, `ship` — passed through to the sub-skills; beep-boop doesn't use them directly.

## Install-health preflight (doctor-at-entry surfacing)

The gateway-load preamble (gateway → **Install health (doctor-at-entry)**) already runs `"$faff" doctor` once on entry; in autonomous mode it never prompts and never runs `faff sync` — that rule is unchanged. What beep-boop adds is **surfacing**: the same doctor exit code is threaded into *this run's own* report, so a dirty install is loud up front instead of discoverable only via a mid-run symptom or the next `/faff-wtf`.

- **exit 1 (install not clean)** — `faff run summary` puts doctor's own `RESULT: …` line first in `.faff/runs/<run-id>/summary.md` (it runs doctor in-process; see `## Reporting`), as a loud warning:

      ⚠ INSTALL-HEALTH: <doctor's RESULT line, verbatim> — remediation: run `faff sync`.

  The same line leads the condensed tracker status post (`## Reporting` → step 2) — the first thing a human reads, not buried after the outcome buckets.
- **exit 0 / exit 2** — no line added; nothing changes.

Surface-only: this never runs `faff sync` itself, and it does not downgrade any issue's spec confidence or annotate a per-build audit trail — install health is a run-wide fact, not evidence about any one build.

## GitHub-auth preflight (run-start, before the build queue is minted)

Run gateway **Entry preflights** at autonomous kickoff. Keep finding messages for the run summary and `/faff-wtf`. Lead the summary and condensed tracker post with an `auth-failed` message, after any install-health line. Put an indeterminate auth advisory in the summary once. Honour the returned block before queue minting. Per-build delivery gates remain in force.

## Invocation

| Form | Behaviour |
|---|---|
| `/faff-beep-boop` | **Full pipeline (default).** Tidy → prep queue drain → build queue drain. The whole shebang. |
| `/faff-beep-boop ISSUE-XX ISSUE-YY …` | **Explicit list.** Skips discovery; operates on the listed issues only. |

All forms run non-interactively (no yes/no gates — the whole point is unattended execution) and accept two optional **cost-budget flags** that combine; the run stops when either fires. See `## Budget flags` below — which also documents the **`--converge`** / **`--no-converge`** flags (within-run convergence — drain execution-discovered scope in the *same* run; on by default, `--no-converge` requests file-and-defer for this run) — and the **`--phases build | prep | all`** phase selector (`## Phase selector`).

## Budget flags

A run's budget is a **BudgetEnvelope**: a set of **ceilings** across four **dimensions** — wall-clock (`until`), build-attempts (`max_attempts`), `tokens`, `cost` — and one **at-ceiling outcome** (`stop` | `narrow` | `escalate`, default `stop`). Any subset of ceilings; an unset dimension is unbounded. The envelope is resolved **once at run start** from the `.faff/config.yaml` `budget:` block, with the `--until`/`--max` flags overriding it. The contract consumed downstream is *ceiling + outcome*; how spend is **accounted** is a swappable producer behind it (the default is `faff budget check`'s transcript-sum).

| Dimension | CLI flag | Config key | Caps | Semantic |
|---|---|---|---|---|
| `until` | `--until HH:MM` | `budget.until` | Wall-clock time | Stop dispatching once local time reaches HH:MM. 24-hour; a past time is next-day (so `06:00` started at 23:00 means 06:00 tomorrow), resolved once against the run's start, and kept across a resume. |
| `max_attempts` | `--max N` | `budget.max_attempts` | Build attempts | Stop once N attempts launched. Counts every build-queue dispatch regardless of outcome (Shipped / PR-open / Parked / Errored). **Not** routed-out (no `/faff-graft` invocation), **not** prep dispatches. |
| `tokens` | — | `budget.tokens` | Token spend | Stop once this run's measured token spend reaches N. Measured from the session transcript; **estimate fallback** labelled `(estimate)` when the transcript is unavailable. |
| `cost` | — | `budget.cost` | Dollar cost | **The recommended default spend governor.** Prices this run's per-model × per-class token spend from the built-in price map, unconditionally (a model the map doesn't know about prices at the map's costliest known rate rather than ever silently undercounting). (the legacy flat `budget.price_per_mtok` scalar is **removed** — a `.faff/config.yaml` that still sets it is ignored, named in a warning at `faff budget check`, and refused outright at `faff lights-out` mint time. `budget.price_per_mtok_by_model`, below, is unaffected.) (Real CI/compute metering is out of scope — `cost` is priced from token spend until a CI-introspection producer lands.) |

```yaml
# .faff/config.yaml — all optional; read only via `faff config get` (so validate-adapters passes)
budget:
  until:          # HH:MM wall-clock        (== --until, now config-settable)
  max_attempts:   # build-attempt count      (== --max)
  tokens:         # token ceiling (transcript-measured; estimate fallback)
  cost:           # dollar ceiling — priced per-model x per-class from the built-in map
  at_ceiling: stop          # stop | narrow | escalate  (L3 default stop; a lights-out run mints escalate when unset)
  price_per_mtok_by_model:  # optional per-model override merged over the built-in map (config wins per-model)
```

**`max_attempts` is a backstop, not an L4 governor.** A tally answers a *cost* question, not a *doneness* one — ticket count is uncorrelated with project size, and stalling a healthy run at attempt N is exactly what an unattended run must not do. So the governors divide by job: **run-done** terminates a run because the work is *done*, **Sentry** interrupts one going *wrong*, **budget** backstops *rogue spend*. Accordingly, at **L3** any ceiling (including `max_attempts` alone) is a legitimate cost idiom with `at_ceiling: stop`; at **L4** (`faff lights-out`) a **spend/time** ceiling (`tokens` / `until` / priced `cost`) is the *mandatory* launch precondition — a `max_attempts`-only envelope is **refused** at preflight (it may ride along only as an extra backstop) — and the run mints `at_ceiling: escalate` when config leaves it unset, so a backstop that binds surfaces as a structured needs-human rather than a silent stop (set `at_ceiling: stop` for L3's quiet stop).

### The check — `faff run checkpoint`

Between units, call `faff run checkpoint` as in **The interrupt**. Its local `faff budget check` reads the ledger, config and transcripts and maps the ceiling policy (`stop`, `narrow`, `escalate`) to the checkpoint action.

Report the meter's spend for this run. It applies the run baseline and counts the selected session's transcript and its own children, excluding foreign or unattributable children regardless of mtime. If the session transcript is unavailable, surface `tokens_source = estimate` (attempts × est_tokens_per_attempt).

### When the check fires

Between units, never mid-unit (a turn's `usage` lands in the transcript only once the turn closes — so token accounting is exact only at these boundaries). The checkpoints: after every prep return (before the next prep candidate), after every build return / before every launch in parallel mode (before the next build issue in the wave), and at every wave boundary (before re-assembling the next queue).

In-flight units finish naturally. There is **no mid-issue cancellation** — a `/faff-graft` run in progress when the budget fires completes normally and lands in its terminal state (which then appears in Shipped / PR-open / Parked / Errored as usual). Under the parallel executor, up to `concurrency_max` issues may finish after the budget fires; that's expected. `max_attempts` fires on **launched** attempts, not returned terminals (identical in sequential mode; in parallel it avoids the overshoot of waiting for the Nth terminal).

### The interrupt — `faff run checkpoint`

Budget backstops *rogue spend*; **Sentry** is the live **derailment interrupt** — it stops a run going *wrong* (thrash, no-progress, repeated-identical-failure, escaped side-effect, wall-clock, liveness). At **every between-units checkpoint** (the same boundaries the budget check fires), make one call — **its one home**; the call-sites (steps 3, 7, 8.1) reference it by name and never restate it (a copy per site is a `faff validate-adapters` duplicated-block violation):

```bash
"$faff" run checkpoint --run-dir "$run_dir" --phase <prep|build|wave> --root "$measure_root" --session-id "$session_id" --json
```

It runs the budget check, the escape checks, the Sentry consult, the checkpoint events, an acting run's abort mark and the andon pump, and returns one `action` (exit 0 keep dispatching, 3 stop). It parks, narrows and authors nothing; route on the result:

| `action` | Do |
|---|---|
| `continue` | Proceed. When `intervention` is `surface`, write a run-scoped surface (run log + `/faff-wtf`). |
| advisory (`acted` false; `intervention` is `pause`, `correct` or `abort`) | Log the verdicts to the run log and surface them (`/faff-wtf`), then proceed. The CLI already appended them to `events.jsonl` (the shared telemetry and threshold-calibration feed). |
| `narrow` | Dispatch only the methodology's cheapest remaining admissible subset; the next checkpoint re-checks. |
| `park-issues` | Run the shared park protocol on `park_issues`; continue the queue. |
| `stop` / `escalate` / `abort` | Stop dispatching; in-flight units finish; exit to reporting with `stop_reason`. `escalate` also emits the structured needs-human signal. |
| `fail-closed` | Stop dispatching; surface needs-human *"kill-switch evaluator down"*; close the run with `sentry-abort`. |
| exit 2, any other non-zero exit, or unparseable output | Handle as `fail-closed`, at every level. |

Each `needs_judgement` entry: `correct-narrowing` → `faff sentry abort --issue <id> --worktree <path>`, then `faff corrective author`; `pause-unattributed` → surface the verdicts.

An aborted run is **resumable by design**, so a disputed abort is a paused night, not lost work — tune the `sentry.*` thresholds, not the model. This checkpoint is **cooperative** (it only runs when the orchestrator reaches it); `faff sentry-poller` is the **detached** lane that covers a run which stops reaching checkpoints at all — same unmodified `sentry check`/`sentry abort` CLI, same acting rule (it enforces the unattended-acts decision identically), on its own timer.

**Unreached issues.** Issues that reached build-ready (spec present, verdict-admitted, partitioned by conflict analysis) but were never dispatched because the budget fired land in a new **Unreached (budget hit)** bucket in the run summary. They are **not parked** — they retain Todo + spec state and the next run picks them up (no tracker comment; their state is unchanged from run start). Un-prepped Backlog candidates whose prep dispatch never fired because `--until` cut prep short do **not** appear in `Unreached` — they stay in Backlog (the prep-queue summary just has smaller counts), and the next run picks them up.

**Within-run convergence (`--converge` / `--no-converge`).** Refuse both flags together at entry, before creating a run. After opening the run and before queue assembly, call `faff run wave-mode --run-dir "$run_dir"` with the supplied flag, adding `--git-only` in git-only mode. Keep its `fold` and `consult` values for all waves. Lights-out entry forces convergence and selects eager filing on build return. Otherwise the flag overrides `convergence.enabled` (default on); converging runs file at the wave boundary. With `fold`, file eligible discovered scope in this run until both tributaries dry up, subject to budget and value/dedup checks. Otherwise defer discovered scope to step 10. `convergence.max_waves` (default 6) bounds consecutive stalled waves, not total depth.

## Phase selector (`--phases build | prep | all`)

`--phases` (closed enum, default/flag-absent `all`; enum-validated here in prose like `--converge`, no CLI subcommand — an invalid value is a fail-closed usage error at run start) scopes a run to one of the pipeline's two phases, for **coordination-free multi-machine throughput**: one **primary** (`all`, the only run that preps) plus N **build workers** (`build`) on one tracker+repo. Builds are deduped by the tracker `In Progress` claim (the claim check in step 4's `faff graft admit` call, cross-machine already), and since only one run preps the duplicate-prep race cannot occur — contention removed, not coordinated; no new shared state. **`all`** (default) is the whole pipeline below, byte-for-byte today.

- **`prep`** — runs tidy + prep (steps 1–3) then stops before step 4; no build attempt; `admitted` stays empty so runcheck is trivially clean. Replaces the `--max 0` specs-only idiom; governed only by `--until` (build-phase budget dims gate a phase that never runs).
- **`build`** — a build worker. Enters at **step 4** and runs the build waves (5–8, incl. chain-unlock re-assembly 8.4); **skips tidy + prep (steps 1–3)**. It performs **zero `faff-prep` dispatches** (single-prepper invariant): the step-3 drain, the step-8.3 narrow-prep on a `next: prep` item, and the step-4 live-thread-reconciliation refresh all route **surface-only** — recorded under the run summary's **Surfaced (prep deferred to primary)** bucket and, for a stale-spec candidate, routed **out** of the build queue (not built on a stale spec, not appended to `admitted`, not re-prepped — a second prepper reopens the duplicate-prep race). This is **routing prep to surface-only, not disabling convergence** (see step 8.5): the build-chaining tributary and the whole convergence loop keep running, only the prep tributary is surfaced. Skipping tidy degrades gracefully — its one build-phase consumer, step-4's `automation-verdicts.md` cache, is simply absent and step 4 already computes any un-cached verdict inline at assembly (the no-tidy → inline path Explicit-list mode uses); its grooming would only overlap the primary's tidy on the shared tracker. An empty build queue exits clean via the wave-1 short-circuit (step 9), a successful run (no idle-poll in v1 — relaunch under `/loop` for a long-lived worker). **L4:** `--phases` and budget are independent axes — a build worker still needs a spend/time ceiling (`--max` alone is refused at preflight). A build-only budget flag under `--phases prep` (e.g. `--max 5`) is accepted with an "inert for a prep-only run" warning, not refused. **Known multi-machine limit:** until a stale-`In Progress` reclaimer ships, a crashed build worker leaves a stale `In Progress` no peer reclaims (clear by hand; risk grows with worker count) — the mode works without that reclaimer but leans on it for robust large-fleet operation.

## Full pipeline (default)

Two independent phases. The **prep queue** drains fully first. Then the **build phase** runs as one or more **waves**: each wave assembles a build queue from the current Todo+spec set, drains it, and re-checks for work newly unlocked by issues that just shipped. The prep queue always runs to completion regardless of whether any wave ends up non-empty. Overnight prep is valuable on its own. **`--phases build | prep | all` (default `all`) scopes which of the two phases run — see Phase selector above; the steps below are the `all` pipeline.**

### 0a. Run-start trigger — PLAN / drain / refuse (L4 lights-out only)

Resolve the binary per gateway → **Resolving the `faff` executable**, then run `faff run trigger --run-dir "$FAFF_RUN_DIR" --json`. It classifies the inherited handoff (`$FAFF_RUN_DIR`; §0a never mints and never calls `faff lights-out`), performs the PRD, target, outward, readiness and coverage reads, spawns `faff run-start` for the verdict, records the creative licence on `drain`, and writes the `run-outward`/`run-start` decision captures itself under `__run__`. Treat exit 2, any exit other than 0 or 3, and stdout that does not parse as a result as `refuse`. On `needs-judgement:prd-inputs`:

1. Invoke the `prd` slot (`prd.slot`) on `prd.path` via the Skill tool (gateway → **Sibling-skill invocation**), and write its whole output to `<run_dir>/trigger/prd-readiness.out`. If the slot cannot be invoked, pass `--prd-slot-unreachable` in place of `--prd-readiness` below.
2. Read the PRD file's declared goals into `<run_dir>/trigger/prd-goals.json` as a JSON array of goal strings.
3. Run `faff run trigger --run-dir "$FAFF_RUN_DIR" --prd-readiness <run_dir>/trigger/prd-readiness.out --prd-goals <run_dir>/trigger/prd-goals.json --json` and route on its token.

| `token` | Action |
|---|---|
| `skip` | Not an inherited L4 run: step 1 (tidy) as an ordinary run |
| `fault` | Fail loud: print `classify.reason`, start nothing, never mint, never drop to L3 |
| `refuse` | Surface `verdict.reason` for `/faff-wtf` and start nothing. The run dir is never closed |
| `drain` | Step 1 (tidy) and the ordinary pipeline, on the same run dir |
| `plan` | Invoke `/faff-plot --autonomous` against `target` (it inherits `FAFF_RUN_DIR`), then `faff run trigger --run-dir "$FAFF_RUN_DIR" --after-plan --correlation-id <run_start_correlation_id> --prd-creative-licence <creative_licence> --prd-root-container <target.container> --json` (values from the deciding call's result). On `recorded`, step 1 on the same run dir; on `record-failed`, exit 2, any other exit or unparseable output, fail loud and build nothing. Converge, don't stop: a still-thin coverage is not a stop condition, and the wave loop runs until `faff run-done` reports the PRD fulfilled or a budget/convergence backstop fires. Unconditional at L4 — no config flag gates this fall-through |
| `plan`, but plot refuses ignition or errors | Surface plot's reason for `/faff-wtf`; do not call `--after-plan`; start nothing |
| `record-failed` | Fail loud: build nothing |

**The load-bearing L4-guard invariant (must stay green).** An ordinary L3 run (no inherited L4 `FAFF_RUN_DIR`) gets `skip` from the classifier alone: `faff run-start` is never consulted, so `refuse/self-directed` never fires on faff's own nightly L3 self-drain. The level comes only from the inherited ledger that `faff lights-out` stamped, never from a flag or a mint here. A `FAFF_RUN_DIR` naming no readable L4 ledger is `fault`, never a silent skip.

### 1. Tidy pass

Invoke the `faff-tidy` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**) in autonomous mode. Applies the auto-actions (archive dead weight, reparent obvious orphans, strip dead references, canonicalise overlooked specs, clear stale park labels) and tags stale-spec / superseded-spec issues so the prep queue picks them up in step 2. Logs remaining findings for morning review.

### 2. Prep queue build

Gather live Backlog/pre-Todo work, stale or superseded Todo specs (treat as missing), and specced Todo prerequisites. Exclude cancelled and archived issues (Linear backlog, `includeArchived: false`; GitHub open). Include all open blocker IDs.

Send ordered `{complete:true,issues:[{id,status,spec,labels,blocked,open_blockers,awaiting_spec_review?}]}` to `faff next prep-queue` on stdin with live labels and **Next-step transition** tokens. Dispatch the returned `prep` IDs. In git-only mode take `awaiting_spec_review` from `faff prepcheck --issue <id> --json`. On a batch error with complete observations, log it and use the per-issue transition for unblocked candidates only.

Prep and graft still enforce eligibility. An issue skipped here never enters `admitted`.

### 3. Prep queue drain

**Foreground-to-terminal (in-flight marker).** The faff-prep dispatch is foreground-awaited — `run_in_background: false` where the harness supports it, **never** `run_in_background: true` — and the drain **never** ends a turn on a "prep agents running" progress report: it ends only with the prep queue drained or a sanctioned hold. This is the local, prep-dispatch-site instance of the orchestrator's **Turn-survival invariant** (_Isolation floor_, below), which already states this posture and the in-flight-marker obligation and binds this prep path — do not restate it here.

Bracket each dispatch with a per-dispatch **in-flight marker** for enumeration/observability — a stranded prep is then visible to `inflightcheck` and to `faff disposition`, not only to `turncheck`'s state check, which already refuses the mid-prep turn-end — mirroring faff-prep's spec-review fan-out (`faff-prep/SKILL.md:167`): `faff inflightcheck --open --key <candidate> --describe prep` before the dispatch, and `faff inflightcheck --close --key <candidate>` after the reconcile below consumes the return.

For each candidate, invoke the `faff-prep` skill via the Skill tool in autonomous mode (foreground-awaited per the posture above; open its in-flight marker first). Possible returns per `skills/faff-prep/SKILL.md` autonomous section:
- `refreshed` — spec updated, issue stays in Todo (contributes to build queue)
- `promoted` — fresh high-confidence spec, moved to Todo (contributes to build queue)
- `promoted-needs-review` — medium-confidence spec attached (rating retained) and moved to Todo; it joins the candidate set but its verdict is `needs-decision-first`, so it routes out of the build queue and surfaces in the morning brief rather than auto-building
- `re-slice-handoff` — **L4 only**: a plot-destined spec-review reject-approach (`faff-prep/SKILL.md` → Spec-review gate) re-sliced the candidate via an autonomous plot re-entry instead of parking; the candidate itself is superseded by its own re-sliced epics rather than attached or promoted. Never enters the `admitted` ledger and is **not** counted as parked — the re-sliced epics land in Backlog with no blockers of their own, so wave re-entry's blocker-closure check (step 8) picks them up on the next wave boundary like any other unblocked candidate, keeping the loop converging rather than stopping
- `ineligible` — issue is not automation-eligible (gateway → **Automation eligibility**); skipped without speccing or promotion. Never enters the `admitted` ledger and is **not** counted as parked — surfaced in the run summary's On-hold bucket, not Parked. `spec-review-held` (see `faff-prep` → _Spec-review-outage disposition_) is a distinct token: a swing-capable spec-review outage survived the in-turn retry ceiling — append the id to `spec_review_outage_pending` (mirrors `review_outage_pending`, never an `outcomes` write since it's never `admitted`); not a park, the next prep drain resumes at review via `faff next`'s `--awaiting-spec-review` arm.
- `parked` — low confidence, contract violation, or architectural change needed; tracker tagged, log written
- `errored` — treated as parked for reporting

**Reconcile every return against attach ground truth before recording it (mandatory, unconditional; the prep-side twin of the build isolation floor's ground-truth reconcile below).** The Stop-hook backstop only bites the session whose turn ends, so a delegated prep return can slip past it — never trust the bucket above from the returned narration alone. Run `faff prepcheck --issue <issue> --run-dir "$FAFF_RUN_DIR" --json` (the on-disk marker, never the returned prose): an attach-expecting return (`refreshed`/`promoted`/`promoted-needs-review`) needs BOTH `state:"attached"` AND a tracker spec-discovery hit (gateway → **Spec discovery**), else MISMATCH; a non-attach-expecting return (`parked`/`ineligible`/`errored`/`re-slice-handoff`) tolerates any marker state (an over-delivering `attached` is benign — record the returned bucket, note it in the run log). On MISMATCH, recover idempotently — gated on the issue being one this run's own prep-queue drain just dispatched (never act on a marker this run didn't itself just produce, regardless of what its `owner` claims): spec-discovery first (the spec already landed → ensure Todo, flip the marker `attached:true`, record the bucket — no second spec comment; an MCP error here is "unknown, do not attach", never a blind re-attach); else complete the attach from the return's artifact (stamp → validate → save_comment → flip marker → Todo); else re-dispatch `faff-prep` for the issue **once** (cap 1) and re-run this reconciliation on the retry — still unresolved → record `errored`, park per protocol, never a phantom `promoted`/`refreshed`/`promoted-needs-review` bucket. Runs until the prep queue is empty. **Never short-circuits on build-queue state.** Once the reconcile has recorded this candidate's bucket, close its in-flight marker — `faff inflightcheck --close --key <issue>` (idempotent; safe on a never-opened or already-closed key). After every prep return, run the between-units checkpoint (see _The interrupt_) before dispatching the next candidate.

### 4. Build queue assembly

Collect every issue that meets readiness (in Todo, with no open *external* blockers — in-queue dependencies are handled by conflict analysis as collision groups, not exclusions) **and has a spec discoverable per the shared Spec discovery rule** (gateway) — tracker comments, tracker description/body, or committed `docs/`. Any hit counts. This includes:

- Issues already in Todo at the start of the run (spec likely on the tracker)
- Issues freshly moved to Todo by the prep queue (spec on the tracker by construction)

Do not require a repo-side spec file at this stage — faff-graft commits the spec to `docs/` only at the start of the build. An absent spec file under the configured **Spec docs path** (default `docs/specs/*-<issue>-*.md`) is not grounds for exclusion; the tracker is the pre-build source of truth. **Query-constrain this fetch to the Todo / unstarted category** it wants, never a whole-tracker pull (gateway → **Workable vs terminal states**: Linear `state` = unstarted + `includeArchived: false`; GitHub `state = open`), so terminal issues (Done/Cancelled/Duplicate) are never fetched, not fetched-then-dropped — admission within the returned set is decided by `faff graft admit` below.

**Admit through `faff graft admit --mode autonomous` (the one admission home: full pipeline, `--phases build`, explicit list, wave re-entry).** Per candidate, capture `observed_at=$(date -u +%FT%TZ)`, then take one live `get_issue` read: labels and status come from this read, never a same-session snapshot from before the run started (gateway → **Re-ground before gate**), Check the issue key against `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` before any write; a key that fails routes out `admit-errored:issue-key` with no write and no call. Build the facts object as faff-graft Step 2's facts block does, with `externally_blocked` true only for an open blocker not in this run's queue (in-queue dependencies stay with conflict analysis). Delete the previous `admit-spec.md`, write the spec about to be admitted (none when no spec was found), and run `printf '%s' "$facts_json" | faff graft admit --mode autonomous --facts - --spec-file "$run_dir/<ISSUE>/admit-spec.md" --run-dir "$run_dir" --json` (no `--wave`, so each call mints a fresh consult id); a failed write leaves no file, so the call exits 2 rather than grading a stale spec. Always `--mode autonomous`: beep-boop reads no per-candidate mode signal. The command runs eligibility (`faff-automate` — gateway → **Automation eligibility**), `next`, the claim check, the intake guard and admissibility in-process and writes their decision captures itself, so this step runs no `decision-capture decide` driver and no `next`/`eligible` `action` call. Log `warnings`; they never gate. Route on `disposition`:

| `disposition` | Action |
|---|---|
| `proceed`, status not `in-review` | The live-thread re-scan, then the routing verdict, then the final call (both below) |
| `proceed` with status `in-review`, `claimed-by-peer` | Status `in-review`: the endgame landing check (below), falling through to "Claimed by peer". Otherwise "Claimed by peer". Never built, admitted or parked |
| `needs-prep` | The prep queue (narrow prep); under `--phases build`, Surfaced (prep deferred to primary) |
| `ineligible`, `blocked` | On-hold (`blocked` carries reason `intake:<reason>`) |
| `inadmissible`, `needs-human`, a non-zero exit | Routed out as `inadmissible:<reason>`, with `reason`, or as `admit-errored:<reason>`; never parked, never admitted |
| `excluded` | Dropped from the queue (`next` said `blocked`, `done` or `none`) |

**Re-scan the live comment thread first (mandatory — gateway → Automation-routing verdict (fixed) → _Live-thread reconciliation_).** Before computing **or trusting a cached** verdict for any spec-gated candidate, fetch its comments and scan everything posted *after* the spec (faff-prep → **Scenario B Step 2a**: Challenge / Resolution / Context / Noise). A **Resolution** (a human picking an option, answering a `**Punt:**`, closing an open decision) or a **Challenge** (a new constraint contradicting the spec) means the attached spec's retained rating is **stale** — the human steered the decision on the control surface. Route that candidate through **narrow prep** (the `faff-prep` skill, autonomous) to fold the resolution in and **re-rate**, then compute the verdict on the refreshed spec — never the pre-resolution snapshot. **Under `--phases build` (see Phase selector) this refresh is surface-only:** the stale candidate is routed **out** of the build queue (not built on a stale spec) and reported under the run summary's Surfaced bucket, never dispatched to `faff-prep` — a build worker never preps (single-prepper invariant). A cached verdict from the tidy pass only reflects the thread as of tidy; any comment since supersedes it. (This is the step whose absence stranded a `medium`-spec issue whose open `**Punt:**` a human had already resolved by comment — it routed out as `needs-decision-first` instead of re-rating to `high` → `fire-and-forget`.) This re-scan is beep-boop's discharge of the steer-loop re-read in gateway → **Human curation is authoritative** assertion 2 — the wave honours a human's mid-flight edit, never an over-ridden snapshot.

**Compute the automation-routing verdict** for every spec-gated candidate. The verdict is normally already in `.faff/runs/<run-id>/automation-verdicts.md` from the tidy pass in step 1 — read it from there to avoid recomputation, **but only after the live-thread re-scan above clears it as current** (a post-tidy Resolution/Challenge invalidates the cache entry and forces the narrow-prep refresh). Any candidate **not** in that cache — an issue prep promoted during a wave (step 8), or one whose spec was refreshed since the tidy pass — is computed **inline** at assembly and written back to the cache; the top-of-run cache only covers the issues tidy saw. **Admit only** the two build-ready verdicts to the build queue (canonical semantics: `faff contract automation-routing --describe`). The rest never enter the build queue, but do not all land the same way: a `needs-decision-first` candidate is not immediately finalized as a clean route-out — it first gets the appetite-governed resolve-attempt (gateway → **Resolve-attempt before park**); a successful attempt proceeds with the audit-trail comment, and a failed (or, at `low` appetite, skipped) attempt invokes the shared **Park protocol (shared)** — `faff-parked`, a short reason line, a `faff-parks` record with root cause `punt-not-closed` — landing the issue in the run summary's **Parked** section, ledger outcome `parked`, never Routed out. Every other non-admitted verdict is unchanged, captured for the run summary's "Routed out" section and `/faff-wtf`'s next morning brief with its verdict-specific diagnosis. **The final call (the last gate).** A candidate that clears the routing verdict, or whose resolve-attempt succeeds, gets one more admission call — a fresh `observed_at`, live read, facts object and `admit-spec.md` holding the spec as it now stands — immediately before the append to `admitted`, with nothing in between. Only its `proceed` with status not `in-review` admits; any other result routes by the table above. The claim check is therefore as fresh as the append and admissibility grades the spec that will be built. Graft's Step 5 claim stays the backstop for a peer that claims the issue after the append, and graft's Step 2 admission the backstop for a direct autonomous `/faff-graft`. Each call writes its own consult captures, so an admitted candidate leaves two `next`/`eligible` pairs. Under `--phases build`, a stale re-scan routes to Surfaced and the final call does not run.

**Endgame-only admission for a stranded `In Review` PR (the cross-executor landing resume).** An `In Review` status is not always a live build — its original executor may have crashed or moved on mid-landing, leaving an open PR whose landing boundary survives only in the off-box Phase-0 recovery bundle. It runs from a `claimed-by-peer` result, or a `proceed`, whose status is `in-review` (the table above), so a stale In Review claim resumes landing and is never rebuilt beside its open PR; check whether the issue is a **resumable landing** — this branch never rebuilds; it only re-enters the landing loop to drive an already-open PR to merged, so a stranded PR is not silently abandoned to a red run every firing. Every ambiguity below collapses to the unchanged `claimed-by-peer` skip, so a genuinely live build is never double-drained:

1. **Store gate.** Run `faff config get bundle_store`. Continue only on a successful `git-remote` result. Otherwise skip as `claimed-by-peer` before restoring anything.
2. **Reconstruct.** Run `faff bundle-recover --issue <ID> --json` even without a local run dir. On refusal or a missing `<run-dir>/<ID>/landing-progress.json`, skip as `claimed-by-peer`.
3. **PR gate.** Read the issue's PR via `gh`. Not open, or the read fails → `claimed-by-peer`.
4. **Budget gate.** `faff landing-progress read <run-dir> <ID>` — `fix_cycles >= 3` means the hard-park budget is already spent → `claimed-by-peer` (never resumable).
5. **Mint the claim.** `faff landing-claim acquire --issue <ID> --claimer-id "<run-id>@<host>" --pr-head-sha <the open PR's current head sha (step 3's read)>`. One call mints-or-fenced-reclaims: exit 0 → this executor holds the claim, proceed; exit 1 → `claimed-by-peer`, no landing pass, nothing further — whether because a live peer's ticked heartbeat is fresh, the existing claim's own recorded `pr_head_sha` no longer matches the head just read at step 3 (the PR moved on since that claim was minted — never reclaim against a stale revision), or any other resolution failure.
6. **Dispatch the endgame-only landing pass.** With the claim held, re-enter `faff-graft`'s landing loop directly for this issue against the reconstructed run dir and the open PR, with step 4's `fix_cycles` as the **starting** budget the loop continues from. Endgame-only: no worktree, no build steps, no tracker `In Progress` claim, and the issue is **not** appended to this run's `admitted` array (nothing was rebuilt this run). Tick the claim's own heartbeat (`faff landing-claim tick --issue <ID> --sha <the claim's current sha>`) at each landing-loop cycle boundary — the cross-box liveness signal a peer would otherwise have to wait a full staleness window to distrust.
7. **Release on terminal disposition.** The loop returning `shipped` or the hard-park `pr-open-for-human` releases the claim (`faff landing-claim release --issue <ID> --sha <the claim's current sha>`) — best-effort, never blocking; a missed release self-heals via the next fenced stale reclaim.
8. **Record the outcome.** A `landing-resumable` return appends the issue id to `landing_resumable` (see _Run ledger_ below) — never the hard-park. `shipped` / `pr-open-for-human` / `errored` land in `outcomes` exactly as an ordinary dispatch would; none of these issues ever enter `admitted`.

**Record to the run ledger.** Append every admitted issue to `admitted`, and write each routed-out issue's `routed-out` outcome immediately, in `.faff/runs/<run-id>/run-ledger.json` (see _Run ledger_). The ledger is what step 11's `runcheck` audits — keep it current as the queue is assembled and drained. For each routed-out or `claimed-by-peer` candidate (the endgame fall-throughs included), run `faff run-ledger record-declined --issue <ID> --reason "<disposition>" --observed-at "$observed_at"`, where `observed_at=$(date -u +%FT%TZ)` is captured per candidate, never shared across candidates, immediately before the live read of the admission call that declined it; make no tracker write for a declined issue after that read, and log a non-zero exit without stopping the drain or changing the disposition.

**Run-start sibling snapshot (feeds step 11.5's reconcile gate).** Each admitted candidate's spec is already read here for the routing-verdict gate above — reuse that read (no extra fetch). Extract every referenced issue id it names (`<issue id=…>` embeds and bare `FAFF-NN`-shaped mentions) that is **not** itself in `admitted`, and for each one record its **current** state-category (terminal — Done/Cancelled — or not) to `<run-dir>/sibling-baseline.json` (`{issue, start_state_terminal}[]`). This is the bounded, deterministic set step 11.5 re-reads live at run-end to catch a non-admitted sibling that flipped terminal mid-run — not an unbounded whole-tracker scan. A sibling later admitted in a subsequent wave (chain-unlock) is simply excluded from the reconcile input by virtue of being in `admitted` by then (see step 11.5). **This write has a run-end consequence:** step 11.5's `ReconcileInput` carries a `sibling_baseline` attestation whose *absence* reads as "the sibling check did not run" — a distinct, loud `sibling-check-unproven` divergence, not a silent pass. Skipping this write (a step aborted mid-run, an unhandled error before the file is flushed) is what produces that attestation gap; there is no separate opt-out.

Exclude anything parked during the prep queue (no valid spec or flagged for human attention). Also exclude anything **not automation-eligible** (gateway → **Automation eligibility**) — though by construction a not-eligible item can't reach here (prep/tidy never promoted it to Todo); this is the defence-in-depth early-exit. **PRD-distance assembly (only under a resolved target PRD; skipped by default):** when §0a resolved a target PRD (`drain / prd-covered` at L4), run `faff prdr distance --container <container> --prd-goals '<goals JSON>' --dod-verdicts '<the wave's DoD-verdict map>'` (reuse §0a/holdout's `--dod-verdicts` map verbatim; absent → all-`unverified`), `JSON.parse` its stdout, and attach it as the batched methodology dispatch's optional `prd-distance` input (gateway → **Standard envelope → Optional input**) so the drain heads for the sibling PRDR nearest a `met` DoD. A non-zero exit or unparseable stdout **degrades to input-absent** (dispatch as today) and is logged — never stalls the drain; no target PRD → no call, byte-identical. beep-boop only assembles and hands over the map, never reordering the queue itself; when the map matched **zero** queue-issue containers, record the silent-no-op tripwire for the summary.

### 5. Conflict analysis

Run once over the build queue. See _Conflict analysis_ below.

### 6. Build pass

Hand the conflict-analysis partition to the **`concurrency` slot** (see _Build-pass execution_ below), which drives the `faff-graft` skill in autonomous mode per issue — sequentially by default, or concurrently when the parallel executor is configured — respecting the partition (independents in parallel where the executor supports it, serial within collision groups). **Annotate each partition entry with the spec's already-read `confidence` and `build-tier`** — the same ratings the routing verdict above read, so no new tracker read — so the executor resolves each unit's `build` dispatch lane with no config check. Independents are ordered per the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**); beep-boop states no ordering of its own. The thematic default supplies priority + chainable unlock value when no methodology is set; an opinionated lens supplies its own (value × risk × dep-aware).

### 7. Wave drain

Keep building until the wave's build queue is drained or everything remaining is parked. Each build return is aggregated. After every build return (and before every launch in parallel mode), run the between-units checkpoint (see _The interrupt_). This is the inner drain loop — when a wave's queue is exhausted, control passes to step 8 (wave re-entry).

**When entry selected eager filing:** On each build's return — after the checkpoint above, before the next launch — reconcile the returned `discovered_scope: {concrete, vague, path}` against the on-disk file (ground truth; a mismatch logs, the file wins), then:

- **No `path`, or no `concrete` item** → nothing to do; a `vague`-only file still surfaces only at the next boundary, exactly as today.
- **A `concrete` item** → file **this build's file now**, invoking **step 10's sub-steps 2–7 unchanged** (containment → appetite → dedup → file → surface → record) over just this file, mandate = the built issue — no new filing sub-steps, only *when*/*over which file* changes.
- **Serial filing is the whole race-safety argument** — per-return filing runs strictly serially, in return order, so build2's search-before-create (sub-step 4) always sees build1's already-committed ticket; no new lock, no structural key.
- **Increment a per-wave eager-filed counter** per create — step 8.0 folds it into `filed_this_wave` below. Either way, continue the wave (aggregate the return, launch/await the next unit).

### 8. Wave re-entry

After a wave drains, scan Backlog and Todo for newly unlocked work. Todo holds only specced items, including blocked ones. Consult `faff next` for each newly unblocked item (gateway → **Next-step transition**). `prep` routes through narrow prep, `graft` rejoins build-queue assembly, and `skip-ineligible`/`needs-human` route out. Prep alone generates or refreshes specs in place and moves Backlog→Todo. The orchestrator never moves tracker state itself.

0. **File this wave's discovered scope before checking budget.** Use this step when convergence is on. Otherwise defer filing to step 10. Run step 10's filing mechanism on only this wave's `discovered-scope.json` files. File concrete, contained, non-duplicate items in Backlog for step 8.2's re-query and surface vague items. Re-scan even after eager filing. Step 10's search-before-create skips tickets already filed.

   Log `filed_this_wave` in the wave log and runaway-cap report. Count step 7 filings once. Only build-queue admissions reset the step-8.5 stall counter. Step 8.3 still checks eligibility. The current run can prep and build its contained filings without a label. Live blockers still govern order.
1. **Between-units checkpoint (budget + Sentry).** Run _The interrupt_ checkpoint with `--phase wave` and route on its `action`. This is the run's last budget gate. On a stopping action, end cleanly and report unreached issues under `## Unreached (budget hit)`. This stops active convergence before re-entry. Unbuilt scope falls back to step 10's file-and-defer path.
2. Re-query **Backlog AND Todo** issues — the fetch **query-constrained** to those two workable categories per gateway → **Workable vs terminal states** (one `list_issues` call per category — backlog + todo/unstarted — with `includeArchived: false`; GitHub `state = open`), so terminal issues (Done/Cancelled/Duplicate) never return, not fetched-then-dropped — excluding anything already touched by an earlier wave (shipped / PR-open / parked / errored — these stay in their bucket; once parked in this run, always parked in this run).
3. For every **Backlog or Todo** issue whose declared blockers are now all closed (shipped earlier in this run or already closed at run start) **and which is automation-eligible** (skip anything not automation-eligible — gateway → **Automation eligibility**), invoke **narrow prep** — the `faff-prep` skill via the Skill tool, autonomous on just that issue. (Prep itself also returns `ineligible` for a not-eligible issue, so this filter is the early-exit, not the guarantee.) Prep handles three cases through its existing autonomous returns (see step 3 of the full pipeline):
   - **Backlog, unspecced** (was blocked from being specced): prep generates a fresh spec and, on high confidence, promotes to Todo (`promoted`).
   - **Backlog, specced** (was specced but never promoted, or was demoted): prep confirms the spec is still valid (or refreshes if stale — upstream work just shipped) and promotes (`refreshed` or `promoted`).
   - **Todo, specced** (was specced-and-blocked, now unblocked): prep confirms or refreshes the spec — staleness matters here since the upstream work just landed; the item stays in Todo (`refreshed`).

   In all three cases prep may instead return `parked` (low confidence) or `errored` — those items are logged and skipped for the rest of the run.

   This is the mechanism that brings mid-run-unlocked chains into the build queue **and** keeps specs honest against upstream work that has just shipped. **Do not** re-run full tidy — tidy fires once at the top of the run. **Under `--phases build` (see Phase selector) narrow prep is surface-only:** a newly-unblocked item returning `next: prep` is recorded under the run summary's "Surfaced (prep deferred to primary)" section and **not** dispatched to `faff-prep` (the single-prepper invariant); a `next: graft` item still rejoins step-4 re-assembly, so the build-chaining tributary is unaffected.
4. Re-run step 4 (build queue assembly). The Todo set now includes any items prep just promoted. Re-assembly inherits step 4's **at-the-gate** discipline (gateway → **Re-ground before gate**): each admission call's live read — the labels, status and claim facts `faff graft admit` judges — is taken **live at this re-entry**, never from the wave-1 read — so an issue a human cranked up *between waves* is correctly judged eligible on re-entry, not on its stale pre-crank labels. Re-running step 4 also **re-assembles the `prd-distance` input** for this wave boundary (one fresh `faff prdr distance` call per wave under a resolved target PRD) — so as siblings advance toward `met` mid-run the ordering re-heads for the now-nearest PRDR; no target PRD in scope → no call, byte-identical to today.
5. **Wave-boundary stop.** With the saved `fold` mode, apply step 8.0. Reset the ledger's `no_progress_waves` when this wave admitted a chain-unlock or eligible discovered issue. Increment once for a wave with no admissions. Filing alone never resets it. At `convergence.max_waves` (default 6), supply `--non-convergence` to the consult. Without `fold`, skip the stall counter.

   With saved `consult` (including every git-only run), call `faff run wave-consult --run-dir "$run_dir" --wave "$w" --budget "$checkpoint_budget"` even at drain. Pass step 8.1's budget and optional methodology `--policy JSON`. Use separate argv values.
   - Tracker: pass `--queue '{"queue_empty":…,"all_parked":…}'` from fresh step 8.4 facts and `--coverage JSON` for the in-scope PRD, otherwise `--no-prd`.
   - Git-only: pass `--git-only` and either `--prd PATH` for an in-scope checklist, even when unreadable. The CLI returns a coverage warning and applies the existing no-coverage fallback. Use `--no-prd` only when no PRD is in scope.

   Log warnings. With decision capture enabled, the CLI records the consult; the action is still yours. A continuation repeats steps 5–8. For a clean completion, save `converged/both-dry` as the stop reason. For a budget stop, save the budget token. On escalation save the returned reason and signal needs-human. Carry the chosen token from the wave report through `run close`. After taking the branch, record it with `faff decision-capture action --run "$run_dir" --issue __run__ --kernel run-done --correlates "$correlation_id" --action "$verdict_taken"` using the consult's ID. Without `consult`, an empty tracker queue exits to reporting; otherwise repeat steps 5–8.

Log each wave's admissions, drain count, `filed_this_wave`, `no_progress_waves`, the `run-done` verdict when consulted, the `faff sentry check` intervention (every run — the consult is advisory except where the run acts on `abort` (run-stop) or `pause` (parks the implicated issue, continues): an unattended run, i.e. L4 or an L3 that declared `autonomous.unattended` / the `sentry_acting` alias), and exit reason under `.faff/runs/<run-id>/wave-N/`; `run-done.json` holds the consult's saved decision. Exit reasons are `drained` (queue empty after build pass), `all-parked` (every remaining issue parked or errored), `budget-hit` (budget gate fired during or at the boundary of this wave), `sentry-abort` (a sentry `abort` intervention fired and the run acted on it — an unattended run: L4, or an L3 with `autonomous.unattended` / the `sentry_acting` alias), or — whenever the `run-done` consult ran — `converged/both-dry` and `non-convergence` (the run-done verdicts above).

**Why this exists:** chains unlocked mid-run (`ISSUE-A` ships → `ISSUE-B`'s blocker clears) are picked up here. The chain's downstream items live in Backlog (per the promotion rule above), which is why prep is the entry point — the orchestrator does not move state directly. Chains visible at first assembly are still handled by step 5's conflict analysis as collision groups — wave re-entry catches the rest.

### 9. Wave-1 empty short-circuit

If wave 1's build queue is empty after assembly (step 4), skip steps 5–8 and proceed directly to reporting. No subsequent waves run — there's nothing for shipped work to chain on. Prep output still counts as a successful run.

### 10. File discovered-scope tickets

After the wave loop converges (and only when builds ran — the wave-1 short-circuit at step 9 skips this), collect the **discovered scope** `/faff-graft` recorded during the run and file the concrete items as Backlog tickets. This is bottom-up source (b) — execution-discovered work (gateway → **Agent Lanes**). It is the one step where beep-boop writes tickets **directly** rather than via tidy — legitimately, as the orchestrator lane (full tracker write). Apply the same filing procedure throughout the run:
- **Convergence on:** file at the wave boundary (step 8.0). If eager filing was selected at entry, also file on each build return (step 7). At run end, file any remaining scope, including work left by a budget stop.
- **Convergence off:** file at run end and defer the new tickets.

1. **Collect.** Glob `.faff/runs/<run-id>/*/discovered-scope.json` (each built issue's file; absent when it found nothing). Every built issue contributes regardless of its terminal outcome — a `shipped`, `pr-open`, or `parked` issue can all carry discovered scope. **Also read the orchestrator-lane file `.faff/runs/<run-id>/orchestrator/discovered-scope.json`** (defects the orchestrator itself hit; see _Orchestrator-lane capture_ below). Orchestrator entries flow through steps 2–7 exactly as implementor entries do, with one difference recorded at step 6: their mandate is the **run's dispatch container**, and — no per-issue mandate issue exists for them — their surface-only target is the run summary + `/faff-wtf` §4 only (no per-issue comment).
2. **Plan.** Use **Containment at the filing chokepoint** with the built issue or the orchestrator's dispatch container as mandate. Vague items surface in the run summary and WTF without probing.
3. **Route.** `may-file` enters dedup. `outward-new-root` takes step 6, regardless of appetite. Log other surface or error outcomes and create nothing.
4. **Dedup before creating.** Match each item's title/surface + relationship target against existing open tickets (a build often "discovers" a downstream the spec already named and tidy already filled; a self-intake defect is deduped against the same open-ticket set as any other item). Skip duplicates; count them.
5. **File** with the MCP using the proposed placement, link and status. Author the chain-gap provenance line ("discovered during build of SHF-XX"). Stamp via the plan's intake arguments after the tracker acknowledges the new issue. **When the item's `priority` is present (not `absent`):** set the tracker priority and post the fixed-shape reason comment per `/faff-graft` → _Discovered scope_ → **The priority-reason comment** (do not restate it), attributed to `/faff-beep-boop`, in the same create call that sets status/relationship/provenance. `entry.priority` was already computed at capture time (graft Steps 7/9/10, or the orchestrator capture below) — this step reads it, it never recomputes it. An item whose `priority` is `absent` (vague, or a legacy entry predating this field) files exactly as before — no tracker priority, no comment. A self-intake proposal uses the self-intake lane and omits `faff-automate`. Retain `outward-self-intake` in the discovered-scope entry. The same optional link and priority handling applies.
6. **Outward-new-root (surface-only, never filed).** For each `outward` item: keep/record its `DiscoveredScopeEntry { containment: "outward-new-root" }`, **create nothing**, surface it in the run summary's discovered-scope section so `/faff-wtf` §4 shows it, **and post a comment on the mandate issue** (the `<ISSUE>` it came from — an already-sanctioned surface, so the comment is in-lane, not scope expansion). **Orchestrator-lane entries have no mandate issue** — skip the per-issue comment; the run summary + `/faff-wtf` §4 are their sanctioned surfaces. Do **not** park the build. The human creating the root later via `/faff-jot` (→ `initiated: interactive`) is the approval.
7. **Record** each acknowledged create with a `discovered-scope-filed` run event: `issue` = new tracker ID, `data.source` = plan containment (`contained` or `outward-self-intake`). Count and log it in `discovered-scope-filed.md`.

Filed tickets are **new work, not admitted issues** — they sit outside runcheck's `admitted − outcomes` invariant and never affect run completeness. Once an eligible discovered ticket is admitted to a wave's build queue (under the convergence loop — see _Within-run convergence_ in Budget flags and the run-done stop at step 8.5), it **is** an admitted issue and gets a terminal outcome like any other, so runcheck's invariant covers it from that point.

#### Containment at the filing chokepoint

Beep-boop and autonomous tidy share `faff discovered-scope-plan --facts FILE|- [--record <run-id> --phase run|tidy]`. Use the sanctioned issue or run dispatch container as `mandate`, and the intended `parent` (null for a new root). Fetch its `ancestry` fresh through the discovered tracker. Supply `confidence`, effective `appetite`, whether the active methodology is `opinionated`, the recorded `relationship`, its `relationship_target` (null for none), and any `prior_containment`. For enabled self-intake, supply `target: {team, repo}` with the fresh destination team and the slug from `git remote get-url origin` (normalize SSH/HTTPS and remove `.git`). Use null for underivable values. No title or description is needed.

The plan runs containment before appetite and reuses the committed-config self-intake check. The optional recording binds the exact supplied observations for audit. It does not establish their truth. Use `may-file` only for its proposed placement and link after semantic dedup. A bad response or exit 2 means log and surface, with no create. Never substitute human-only `fast-track`.

#### Orchestrator-lane capture

graft records implementor-lane scope; the **orchestrator lane** (beep-boop, and tidy/prep in a full-pipeline run) had none, so a faff-tooling defect the orchestrator itself hit (a CLI misbehaving, a config round-trip failing) vanished. `orchestrator_capture(run_id, step_ref, defect)`: compose a `DiscoveredScopeEntry` (`source: "orchestrator"`, `source_ref` = the failing command/step, `confidence: "concrete"` only when the command + observed-vs-expected are both nameable else `vague`, `containment: null`), append to `.faff/runs/<run-id>/orchestrator/discovered-scope.json`, continue the interrupted step — capture NEVER parks/retries/fixes (a pure side-record; the park/retry logic is untouched). Dedupe on append by (title, source_ref) — one per distinct defect per run. Run dir absent → the standalone `.faff/logs/YYYY-MM-DD/HHMMSS-<skill>-discovered-scope.json` fallback; malformed existing file → move aside to `.malformed-<ts>` (evidence preserved), start fresh, surface the move. Never drop an entry or fail the step over bookkeeping. Step 10 (step 1) reads it alongside the per-issue files. **Priority:** relationship is `"none"` and `gate_defect` `false` by construction; when concrete, pipe them through `faff discovered-scope-priority --relationship none --source orchestrator` and store the result as `priority` (CLI failure → `absent`; vague stays `absent`).

### 10b. Per-run holdout phase (L4 lights-out signal only — the enforced holdout guardrail)

Under the **L4 lights-out signal only** (resolve fail-safe **off**; an ordinary L3 run runs no holdout phase), after step 10 and before step 11's `runcheck`, invoke the **holdout step** once per run over the integrated post-merge system. This is the orchestrator caller that makes the `holdout` guardrail **enforced**, not merely reachable — code-blindness is **free** here (the orchestrator lane never writes code, so the evaluator cannot see it). It composes the shipped CLI gates and re-implements none: each step's exit code *is* the gate. Heartbeat `faff heartbeat "$run_dir"` around the evaluate.

**`holdout_step(spec, prdr_id, key, run_dir) → <the closed holdout-verdict aggregate — see `faff contract holdout-verdict --describe`>`** — call-site-agnostic, so the per-issue graft merge-gate reuses it unchanged with a per-issue association. **`spec` is contractually the full view** (`faff dod split --view full` of the tracker spec; git-only: `.faff/specs/<issue>.md` — never a committed builder-view doc), and both callers — this per-run phase and graft Step 10's per-issue holdout gate — resolve and pass exactly that (byte-identical to the raw spec when marker-free, so the contract is a no-op there):

1. **Extract the architecture proposal from the spec** — the fenced `faff-contract:architecture-proposal` block prep landed there when the work warranted one. A malformed block is treated as **absent** and surfaced loudly — never repaired or invented, and never regenerated here (a proposal produced after the build is one the critic never critiqued). Invoke `slots.env` (`faff config get slots.env`) with that proposal + the infra profile → an env-handle; a spec with no proposal block engages the env occupant's **absent-proposal posture** (profile-derived services, explicit note, recommendation treated as `build`). No handle (recommendation ≠ build) → provision nothing, surface the proposal, return `needs-human`.
2. Pipe the handle to `faff contract env-handle`; non-zero (not ready / no endpoint / no health-checks / no teardown_ref) → `needs-human`, go to teardown (a non-ready env is never judged). **Capture standability (trusted side).** The moment this assert resolves — and at the step-1 no-handle return above — record the fact **when `key` is an issue id** via `faff run-ledger capture-capability --issue <key> --sut-env-stood <true|false> --run-dir <run-dir>` (`true` on a ready handle; `false` on a no-handle / not-ready / provisioning-error return). Steps 1-2 run spawner-side (before any dispatch cut), so this is the trusted-side write the per-issue merge floor reads via `resolveCanRun` (`capabilities[issue].sut_env_stood`); a non-issue `key` (the per-run phase, which feeds PRD coverage not the per-issue floor) skips it, and a never-entered `holdout_step` (an attended decline, a zero-born-verifiable short-circuit, or an untriggered run) leaves the fact absent → the floor's live-read fallback → pass-through. A capture error is logged, never surfaced as a step error — the fallback preserves today's posture.
3. **Resolve the cage promise from `<run-dir>/lane-boundary.json`, then dispatch the evaluator code-blind.** **Promise ABSENT** → legacy inline dispatch (byte-for-byte today): invoke `slots.evaluator` (`faff config get slots.evaluator`) **code-blind** — hand it **only** `{spec, env-handle}`, never the diff / codebase / build-history / builder's tests (the lane invariant); then **persist the verdict through the shared writer**: pipe the evaluator's block to `faff holdout record --issue <key> --spec <the same full-view spec file the evaluator received> [--run-dir <run-dir> when `key` is an issue id] [--credentials-env FAFF_HOLDOUT_CREDENTIALS when the handle carries credentials, with that variable set to the handle's `credentials` JSON for this one invocation]` — exit 0 or 1 leaves a record on disk (1 is a fail-closed `needs-human` record), exit 2 is `needs-human` (surface the guard message, go to teardown); the evaluator itself writes no file. **Promise PRESENT** (a `lane: evaluator, container: own, accesses.repo: absent` intent) → **spawner dispatch**: write the evaluation-request artifact `{spec, env-handle endpoint(s), intent}` to the shared `.faff/` volume (transport = shared-volume-integrity-gated — the inbound verdict is integrity-gated before consumption), then spawn the evaluator as a **fresh OS-level process** via `evaluate-call.mjs --spec <file> --endpoint <url> --intent <lane-boundary-file> --key <key> --out <abs run-dir>/<key>/holdout.json --store-out <abs repo root>/.faff/holdout/<key>.json` — it runs `faff evaluator-preflight` **in-cage** (non-zero ⇒ exit 10 ⇒ `needs-human`, teardown, never retried), the inner evaluator emits **criteria + aggregate only**, and the **spawner** derives `code_blind` from the provably-withheld launch (no repo path / worktree cwd / diff) + the preflight pass, stamps `spawner_attested` + `attestation`, and **writes the verdict record** to both paths through the same writer (the inner never does; a record the writer refuses is written fail-closed and the spawner exits 1, read as `needs-human`).
4. Run `faff holdout receipt --key <key> --run-dir <run-dir> --writer-exit <writer or spawner exit>`. Pass `--caged` when step 3 used the spawner. The command validates the store, requiring an identical run copy and attestation for either cage signal. Non-zero gives `needs-human`; go to teardown.
5. Bridge the validated store through `faff holdout verdicts --association {"<key>":"<prdr_id>"} --dir .faff/holdout` → `faff prdr coverage --dod-verdicts <map>` → `faff run-done --prd-coverage <coverage>` (`prd_satisfied === false` ⇒ `escalate` / `product-incomplete`, the fixed floor).
6. **Teardown on every path** (success, early return, exception): `faff env down --project <teardown_ref>` — a teardown failure is logged loudly, never changes the verdict. Return the aggregate.

**Wiring.** Run-keyed: `key = run id`, `prdr_id = the run's project PRDR`, association `{run-id: project-prdr-id}` (matching the run-keyed verdicts→PRDR→coverage bridge). **Detect-and-escalate, not prevent** — it runs after each graft already self-merged, so a `fails` / `gaps` / `needs-human` aggregate makes the run **escalate and refuse to claim PRD-done** (the new **`product-incomplete`** run outcome, surfaced in reporting) and never blocks a merge; per-issue merge-gating is the sibling **graft-gate** call-site that reuses this step unchanged (`/faff-graft` Step 10 → _Holdout gate_, the fourth L4 merge-floor condition). **De-risk:** faff is a Node CLI, not a service — if no in-repo runnable-system spec yields a provisionable env, narrow to the thinnest provisionable target and defer the real runnable-system proof to the greenfield cross-repo acceptance follow-up (a valid, honest outcome, not a gap to hide).

### 11. Run completeness check (mechanical)

Before writing the run summary, run the bundled **runcheck** script — the mechanical backstop for the "never silently defer the queue" guarantee. It reads the run ledger and fails if any admitted issue has no terminal outcome (resolve the `faff` executable per gateway → **Resolver** if it isn't on `PATH`):

```
faff runcheck   # audits the latest .faff/runs/* ledger
```

- **Exit 0 (clean)** — every admitted issue reached a terminal outcome. Proceed to reporting.
- **Exit 3 (undispatched)** — one or more admitted issues never reached a terminal state. The run is **not complete**: return to step 8 and dispatch them, or genuinely park them under a valid category, then re-run runcheck. **Do not** write a "complete" summary while runcheck fails — that is the deferred-queue anti-pattern (gateway → Autonomous Mode Contract), now caught mechanically rather than left to prose compliance.
- **Exit 2 (no/malformed ledger)** — the ledger wasn't maintained; treat as a run-integrity error, reconstruct it from the per-issue dirs + verdict cache, then re-check.

### 11.5. Run-end ground-truth reconcile (blocking at L4, warn at ≤L3)

After `runcheck` and before reporting, compare shipped and superseded claims and sibling states with live evidence. Ledger completeness alone cannot prove delivery.

1. Write the reporting facts file (see _Reporting_ below). Re-read the siblings in `sibling-baseline.json` and the delivering issues named in each superseded unit's `supersession.json`. Record each issue's terminal status (Done/Cancelled) in `tracker.sibling_end_states` or `tracker.supersession_ticket_states`, respectively. In git-only mode supply only delivery or sibling evidence you can prove from git. Omit unavailable observations and use an empty supersession state map when none apply.
2. Run `faff run reconcile --run-dir "$run_dir" --level <L1..L4> --facts "$run_dir/summary-facts.json" --json`. Heartbeat before and after this bounded read. It binds live PR heads or local ancestry to the merge records, checks the named delivering issues, and excludes siblings later admitted. Read only its result. Exit 2 is an input fault: surface it before reporting completion.
3. **Route on `disposition`:**
   - **`pass`** (exit 0, `consistent:true`) — proceed to the run summary unchanged.
   - **`warn`** (exit 1, ≤L3) — **non-blocking**: surface every `Divergence` in the run summary's `## Ground-truth divergences` section (see _Reporting_) and continue to a normal "complete" report. A human reviews it at the next `/faff-wtf`, but the run itself is not held open on it. **A `sibling-check-unproven` warn most likely means step 4's write was skipped this run** — check `<run-dir>/sibling-baseline.json` first before assuming a genuine tracker-side issue.
   - **`needs-human`** (exit 1, L4 lights-out only) — **blocking**: the run **escalates** rather than reporting a clean complete (composes with `faff run-done` → `escalate`, the same channel the holdout roll-up uses) — never a silent green. Surface every `Divergence` (with any `rollback_proposal`) in the run summary; the divergent issue(s) are flagged for human resolution, not auto-reverted (this gate detects and escalates, it never performs recovery).

`runcheck` itself is **unmodified** by this step (purity preserved) — `reconcile` is wired in fully alongside it, never folded into it.

### 11.6. Post-merge verification annotations (informational, never blocking)

`faff run close` collects existing post-merge verification artifacts for shipped issues. Report any faults it returns. Outcomes stay shipped; graft owns tracker comments and discovered scope.

**Run-end synchronicity invariant — the whole tail runs in-turn.** The run-end sequence — step 11 `runcheck` → step 11.5 reconcile → the `faff run close` bracket (including step 11.6) at exit (see _Owner stamp_ → **At orchestrator exit**) — runs **synchronously in-turn**. Its forge/tracker waits stay **heartbeat-bracketed and bounded** (a `--watch`/poll chunk with a `timeout` below the staleness window, re-entered after a heartbeat tick — never a single unbounded blocking call), exactly the discipline `faff-graft/SKILL.md` → **"How to actually wait for CI"** states for CI. **Never** dispatch any run-end step — least of all post-merge verification, the slowest — as a **detached background task the orchestrator then merely awaits**, and **never end the turn with a run-end step still in flight**: an idle unattended parent is reaped and the ledger is left `owner.status:"running"` after a real merge (the very failure this run's disposition `merged-unclosed` kind now detects). This is the run-end restatement of the **Turn-survival invariant** (see _Build-pass execution_) applied to the orchestrator's own final steps, not only its Agent-tool dispatches.

## Run ledger (mechanical completeness)

Use the run directory returned by `faff run open` (see **Owner stamp & heartbeat**). It mints an L3 ledger and genesis event or adopts the lights-out run. Dispatch only after successful open, following step 0a for an inherited L4 run. Use the minted UTC `run-YYYYMMDD-HHMMSS-beepboop-<mode>-<entropy>` ID as returned. Leave legacy directories in place.

The orchestrator maintains `.faff/runs/<run-id>/run-ledger.json`. For direct edits, keep `schema_version` and add only keys the v0.3 `run-ledger` schema lists. After **each direct ledger edit**, append the event below. The CLI hashes the on-disk bytes.

```sh
echo '{"phase":"run","type":"ledger-write"}' | faff events append --run <run-id>
```

**Admissions and outcomes.** Append each build admission (`fire-and-forget` or `likely-fire`) after step 4's final gate, including explicit lists and step 8.4 wave re-entry. Record each terminal outcome as soon as known. Step 11 and the Stop hook require every admitted ID to have a bare terminal string in `outcomes`. An admitted ID without one is undispatched. An object there is malformed (exit 2). Put optional free-form per-issue detail under `outcome_details[issue]`.

For reconciled graft returns, use the gateway concurrency contract's `faff run return-map --outcome TOKEN` result. Record its terminal `bucket` and append the ID to its `annotation` array when named. Complete a merge handoff before recording. Pre-admission returns have no terminal bucket. Resolve an admission contradiction or unknown token before writing. Keep the existing issue-outcome event path.

| Other ledger input | What to record |
|---|---|
| Verdict gate and budget | Step 4 routes candidates per its disposition table. A failed `needs-decision-first` resolve-attempt is `parked`. Record `unreached-budget` for admitted work a breached budget prevented dispatching. Use `routed-out` only for an actual route-out. |
| Declined or claimed by peer | Only `faff run-ledger record-declined` writes `declined[issue] = {reason, at, recorded_at}`. The runner skips a declined candidate unchanged since `at`. |
| Prep holds | Append `spec-review-held` IDs to `spec_review_outage_pending` and `spec-review-pending` IDs to `spec_review_turn_budget_pending`. Both use the prep review-hold label. These prep-only issues never entered the build queue and have no outcome. |
| Adversarial review skipped | At reconciliation, read the issue's `review-verdict.json`. On autonomous `signal: pass` with `adversarial_outcome: "chain-outage-skipped"` (all backends unavailable), append its ID to `review_adversarial_skipped`. Preserve the actual outcome. |
| Post-merge verification | Collected at close (step 11.6). |
| Discovered scope | Count new tickets filed at steps 7 (eager filing), 8.0 and 10 in `discovered_scope_filed`. A filed ticket enters `admitted` only if a later build gate admits it. |

Annotations add detail outside the completeness check. **Reporting** uses them to distinguish a resumable build-review outage from a human park, a landing hold from a hard PR handoff, and a slow prep review from an outage.

**CLI-owned fields.** The mint sets `level` once. Merge-gate and reconcile use the anchored level. A missing level makes the anchor malformed.

- `budget` is set at run start. `faff budget check` uses the saved envelope and `tokens_at_start` to measure this run. An absent budget gives no breaches. New runs use per-model, per-class map pricing. Preserve a legacy run's recorded flat pricing. The CLI maintains per-class event baselines and `tokens_at_last_event`. A missing per-model baseline gives a warned, pro-rated cost estimate.
- `owner` starts `running` with its run ID as the session token and its start and heartbeat timestamps. The Stop hook judges liveness from heartbeats even if the recorded PID has exited. Each tick updates the sidecar. `owner.last_heartbeat` remains the start baseline and fallback. Older ledgers can lack attribution fields. Let the mint stamp harness, model and version.
- `faff run close` writes the summary's `stop_reason` token and owner status together. A normal close sets `done`. Keep a sentry-aborted run `aborted-resumable`. A fail-closed open records `governance-admit-failed`. A fail-closed checkpoint records `sentry-abort`. On legacy ledgers without `stop_reason`, disposition falls back to the abort marker and issue outcomes.

### Owner stamp & heartbeat

- **At run start** (before step 4), capture `measure_root=$PWD` (before any worktree work) and `session_id=$CLAUDE_CODE_SESSION_ID` — every later token call passes them as `--root "$measure_root" --session-id "$session_id"` — then call `run open` and branch on its exit before evaluating anything:

  ```bash
  out=$("$faff" run open --mode <mode> [--until HH:MM] [--max N] --root "$measure_root" --session-id "$session_id" --export); rc=$?
  [ "$rc" -eq 2 ] || eval "$out"   # exports FAFF_RUN_DIR and FAFF_SESSION_ID, so this session's Stop hook recognises its run
  ```

  A run minted by `faff lights-out` passes `--adopt-run-dir "$FAFF_RUN_DIR"` in place of `--mode` and no `--until`/`--max`. `run open` mints or adopts the run, fills `owner.harness`/`model`, writes the budget envelope once and the `budget baseline`, settles Commissaire governance (admit, `admit-required`, the fail-closed paths) through its existing verbs, runs `hooks-ensure`, then starts the sentry poller — which only acts on an unattended run. §0a's `inherited-l4` reuse never calls it. Route on `rc`:

  | `rc` | Action |
  |---|---|
  | `0` | Proceed to step 4. Relay the `hooks-ensure:` line `run open` prints on stderr to the user when it says hooks were added. |
  | `3` | Governance failed closed: `run open` already appended `run-end` (`governance-admit-failed`) and closed the owner, and no build starts. On an adopted run that already had admitted work, run `faff runcheck "$FAFF_RUN_DIR" --json` and park each issue in its `undispatched` per the shared protocol (cause `governance-admit-failed`), so the done run trips no Stop hook. Then go to `## Reporting` (`run summary`); do not call `run close`. |
  | `2`, or unparseable output | Log it and park per the shared protocol, as a mint failure; dispatch nothing. |
- Tick `faff heartbeat "$FAFF_RUN_DIR"` at every wave and issue boundary. Pass `run_dir` in each `BuildDispatch` so graft ticks its owning run during gates and review (Steps 7.5 and 9). The CLI atomically refreshes the heartbeat sidecar. A quiet worktree says nothing about liveness.
- **At orchestrator exit** (every path but a fail-closed `run open`, whose exit 3 already appended `run-end` and closed the owner), after reconciliation, set `close_flags=()` (git-only: `close_flags=(--git-only)`) and run both commands in one foreground shell call:

  ```bash
  "$faff" run close --post-merge-annotations --run-dir "$FAFF_RUN_DIR" --stop-reason "$stop_reason" "${close_flags[@]}" --root "$measure_root" --session-id "$session_id" --json || exit $?
  "$faff" run summary --run-dir "$FAFF_RUN_DIR" --facts "$FAFF_RUN_DIR/summary-facts.json"
  ```

  It refuses (exit 3, nothing written) while an admitted issue has no outcome, except a `sentry-abort` close of a run carrying the abort mark, which reports the resume's work in `undispatched`. Otherwise it appends the `run-end` event, writes `stop_reason` and the owner close in one locked edit, stops the poller, reconciles and concludes each admitted issue on a governed run, mints the git-only run-level anchor and run-close bundle (`--git-only` is step 8.5's once-resolved signal), mints the judge trail and pumps andon (never `audit seal`: bundle publish already seals); a failed step is a fault and the close proceeds. A current terminal consult replaces a `queue-drained` or `all-remaining-parked` token; other tokens pass through. `0` → `## Reporting`; `3` → step 11's dispatch-or-park for `undispatched`, then close again; `2` → log and surface needs-human.

The Stop hook reads local owner and heartbeat state. Run agents tick through `faff heartbeat`. The command `faff run close` closes the owner under lock.

### Stop hook (harness-enforced backstop)

At turn end, `runcheck --hook` backs up step 11. `faff run open` uses `hooks-ensure` to add the supported `runcheck --hook` and `prepcheck --hook` commands idempotently, preserving other settings. Relay its `hooks-ensure:` notice when it adds hooks, explaining the run and same-turn prep-attach checks.

If no ledger resolves, the hook stays silent. A foreign running owner with a fresh heartbeat also stays silent, even with `--recover`. For remaining undispatched admitted work, the hook blocks on an ownership match (`FAFF_RUN_DIR` or `FAFF_SESSION_ID`) or explicit recovery. Otherwise it warns, including for stale, done or ownerless foreign runs. Freshness uses the later of the sidecar and `owner.last_heartbeat` (default 900s, `FAFF_RUN_HEARTBEAT_STALE_SECS`).

## Run-event log (observability substrate)

Alongside the terminal run-ledger, the orchestrator appends an **ordered timeline** of meaningful pipeline transitions to `.faff/runs/<run-id>/events.jsonl` — the structured surface `/faff-wtf`, the morning report, and the L4 runner will *consume* (this slice only **produces** it; nothing human-facing is rendered). The ledger is the end state; the event log is *how the run unfolded*. Emit each via `echo '<payload>' | faff events append --run <run-id>` — the CLI owns the envelope (`schema`/`run_id`/`seq`/`ts`); you supply only `{phase, type, issue?, data?}`. `seq` is the **authoritative** order — `ts` is annotation, never order by it. Append-only and **lock-serialised multi-writer** (every append takes an advisory lock and mints `seq` from the log's own tail, so the orchestrator, `contain --record`, lights-out, and the detached sentry poller can all append concurrently without duplicate seq), a logging **hard-floor** (written even under `logging: essential`). Emit at these existing boundaries — meaningful transitions only, never per-file/test/CI-poll micro-actions (`faff events validate` line-checks a log; `faff events read --run <run-id> [--type T] [--issue I]` is the thin reader for consumers). `data` keys outside a type's schema are dropped with a warning and named in `data.dropped_keys`; the allowed keys per type are in `verification/evidence/v0.3/schema/events/<type>.schema.json`:

**Run start — no separate emit step.** The genesis `run-start` row below is minted ATOMICALLY by `faff run-ledger init-self-drain` (or `mintLightsOut` at L4) as part of the run-dir mint itself, per _Run ledger_ → the mint paragraph — it is no longer a standalone `echo … | faff events append` step run *after* dir+ledger init. Listed here only so the table remains the complete transition inventory; there is nothing left to do at this row.

| Transition | `phase` / `type` | `--tokens`? |
|---|---|---|
| Run start | `run` / `run-start` | no (delta ~0; seeds the baseline) |
| Tidy pass returns (step 1) | `tidy` / `tidy-done` | **yes** |
| Issue admitted to the build queue (step 4) | `run` / `issue-admitted` (issue) | no |
| Prep of an issue start/finish (step 3) | `prep` / `prep-start` · `prep-done` (issue) | done: **yes**; start: no |
| Graft subagent dispatched (step 6) | `build` / `build-start` (issue) | no |
| Graft subagent returns its token | `build` / `issue-outcome` (issue, `data.outcome`, + `data.gate`/`data.rework_turns` on a non-clean build) | **yes** |
| Discovered-scope ticket filed (steps 7 / 8.0 / 10 — the shared filing mechanism) | `run` / `discovered-scope-filed` | no |
| Budget checkpoint | `run` / `budget-checkpoint` (`data` = `BudgetState`) | **yes** |
| Sentry checkpoint | `run` / `sentry-checkpoint` (`data` = the `faff sentry check` payload, verbatim) | no |
| An issue is parked | `prep`\|`build` / `park` (issue) | **yes** |
| Orchestrator exit (any path) | `run` / `run-end` | **yes** |

**Token-tagging the phase-closers.** Pass `--tokens` on the **phase-closing** emissions above (the `--tokens`? column) — `echo '<payload>' | faff events append --run <run-id> --tokens --root "$measure_root" --session-id "$session_id"` (the pinned root+session — so the measurement resolves regardless of the current cwd). The CLI then injects `data.tokens` (the four-class delta `{input, output, cache_write, cache_read}` consumed since the run's last checkpoint) and `data.tokens_source` (`transcript` when metered, `estimate` — with `tokens: null` — when no transcript is readable) into the event, and advances the ledger checkpoint. Counts-only (never prompt/response payload); `schema` stays `1` (additive under the free-form `data`). This is what lets a token-usage pivot attribute spend to a phase **by event** (prep spend = `prep-done`'s delta; build+review = `issue-outcome`'s; tidy = `tidy-done`'s; residual orchestrator = `budget-checkpoint`/`run-end`) rather than guessing from a `ts` window. Do **not** tag the phase-*opening* events — their delta is ~0 and the transcript read is pure cost.

**Quality-tagging the issue-outcome.** On the `issue-outcome` emission, also carry two optional `data` fields so `faff quality` can report park/rework/gate-catch: `data.gate` — the quality gate that caught a **non-shipped** build (`structural` | `adversarial` | `holdout` | `ci`, read from the build's return token / `review-verdict.json` / holdout verdict), omitted on a clean ship or a non-gate park; and `data.rework_turns` — the build's count of gate-driven fix-and-re-run loops (a clean first pass is `0`). Both are single scalars (non-leak), additive under the free-form `data`; `schema` stays `1`.

## Explicit-list mode

`/faff-beep-boop ISSUE-XX ISSUE-YY …`

For each listed issue:
- Skip if cancelled or archived (log the skip with reason).
- Skip if the issue doesn't exist (log and continue).
- Otherwise → step 4's admission call (`faff graft admit --mode autonomous`, above), which is itself the fresh at-queueing read (gateway → **Re-ground before gate**), routed by step 4's table with two explicit-list paths. `needs-prep` — a missing spec, or a `faff-awaiting-spec-review` hold whose resume re-runs only the held review — invokes the `faff-prep` skill (autonomous); apply its return per the full mode prep queue logic. `proceed` → **re-scan the live comment thread before queueing** (gateway → **Automation-routing verdict (fixed) → _Live-thread reconciliation_**; faff-prep → **Scenario B Step 2a**): a **Resolution** or **Challenge** posted after the spec supersedes its retained rating, so route the issue through narrow prep (the `faff-prep` skill, autonomous) to fold it in and re-rate first; otherwise queue it. A present `low` or `medium` spec arrives as `needs-human` and routes out.

After the list is processed:
- **Compute the automation-routing verdict** inline for every spec-gated issue (gateway → **Automation-routing verdict (fixed)**) — there is no tidy pass to read a cached verdict from, **so the live-thread re-scan above is the only thing standing between a stale retained rating and the verdict; it is mandatory, not optional, in explicit-list mode.** Admit only `fire-and-forget` and `likely-fire`, each through step 4's final call; route the other four verdicts out with a one-line reason in the run summary's "Routed out" section.
- Conflict analysis on the set that reached build-ready.
- Build pass per the shared flow.
- Report.

## Conflict analysis

Run `faff build-queue-partition --facts FILE|-` once per nonempty admitted wave, including explicit-list runs. Reuse the specs and live blocker edges already read. In-queue dependencies serialise work within this run; do not park a ticket because its queued blocker has yet to build.

Pass one JSON object with these arrays (use `[]` when empty):

- `issues`: every admitted issue exactly once as `{id, files, directories, surfaces, scope_tags, blocked_by}`. Use repo-relative files and directories named as scope. Shared ancestor paths are not directory facts. For `surfaces`, supply consistent names for shared modules, utilities or symbols the specs say they edit or depend on. For `scope_tags`, use only subsystem labels according to the project's conventions. Use live `blocked_by` IDs.
- `inferred`: the matches below as `{producer, consumer, match_kind, confidence, evidence}`.
- `non_blocking`: directed `{producer, consumer}` pairs explicitly dismissed by a human relation or comment.
- `uncertain_collisions`: pairs of IDs to serialise conservatively when spec scope suggests a collision but the fixed signals cannot express it. Leave ambiguous inferences in `inferred` only.

Use the returned `independents` and `groups` as the partition. Preserve member order and use the methodology's order for independents and group leads. Supply only `declared` dependencies to the existing blocker gates, even when `ordering_cycles` reports no valid order. Inferred edges order the members for this run. Log the partition, `collisions` witnesses and inference evidence in `.faff/runs/<run-id>/conflict-analysis.md`. Correct exit-2 input faults before dispatch; surface unresolved faults rather than inventing a partition.

### Inferred build-order dependencies (heuristic 6)

Before partitioning, read each admitted spec's WHAT/HOW, Chosen and Assumes for surfaces it creates or expects, such as a symbol, endpoint, migration, config key or command. Match consumers to other queued producers by ticket ID (`id_reference`) or clear `paraphrase`. Classify an ID reference or concrete surface match as `firm`. Classify vague, unnamed or multiple plausible matches as `ambiguous`. Quote the evidence and keep this judgement separate from methodology value ordering. External open blockers belong to admission and missing work belongs to chain-gap analysis. Inference never writes a tracker link.

Carry every returned `inferred` row into the run summary's `inferred_deps.edges` with `consumer`, `producer` and a `note` containing its disposition and evidence. Label `ambiguous` and `human-non-blocker` as surfaced only. Pass `inferred_cycles` as ticket-ID chains in `inferred_deps.cycles` and flag them as likely spec errors. Executors use ordered groups and dependency facts; inference quotes are for reporting.

## Build-pass execution (the `concurrency` slot)

The build pass is executed by the configured **`concurrency` slot**, a mechanism slot that consumes the conflict-analysis partition and drives the `faff-graft` skill per issue. It defaults to `faffter-noon-concurrency-sequential` (one build at a time — no worktree contention, no merge races) and is overridable with `faffter-dark-concurrency-parallel` (runs independents concurrently, each in its own worktree, up to `concurrency_max` — default 4 — with rebase-before-merge so a moving `main` can't merge stale-green).

Every executor honours the same slot contract: build every issue in the partition, serialise within collision groups, record each terminal outcome to the run ledger (so `runcheck` can verify completeness), and never weaken the merge gate. A missing slot is never a park reason — it defaults to sequential. The contract is fixed in the gateway → **Mechanism slot (`concurrency`)** → _The `concurrency` slot contract_ — see it for the full obligations.

**Isolation floor (orchestrator invariant).** This floor is the **L3 instance** of the gateway's level-independent context-hygiene delegation tenet (gateway → **Agent Lanes → Implementor**) — one realization of it, not a separate rule. Never run a build inline in the orchestrator; the `concurrency` slot dispatches each build as an **isolated subagent** that does its own worktree/build/review/merge and returns **only** a terminal token `{ issue, outcome, pr }`, so the orchestrator holds only N tokens + the ledger, never N build contexts. This is the orchestrator's floor — it binds even a swapped-in third-party `concurrency` occupant, regardless of how that occupant implements it. The orchestrator reconciles each token against on-disk `.faff/runs/<run-id>/ISSUE-XX/` artifacts + git ground truth (never the subagent transcript) before recording the ledger bucket. **Turn-survival invariant.** **Every** Agent-tool dispatch this orchestrator makes — a build, a prep producer, any producer, and whatever transport other prose here names — must hold a **turn-safe posture**: foreground (**`run_in_background: false`**) when its result is consumed inline, covered by an executor's await-all gate, or harness-tracked-background under a harness that re-invokes the parent on child completion (gateway → **Producer dispatch**); where the stranding premise holds — the autonomous orchestrator runs headless / with a live run dir, so it always does — the orchestrator must **never end a turn with a dispatched agent still in flight**, because an idle unattended parent is reaped and takes the in-flight agent down with it (gateway → **Producer dispatch** for the background-by-default *why*). This binds even the prep-via-Agent-tool path below, without rewriting that transport prose. The **`faff inflightcheck`** Stop hook is this posture's mechanical backstop on the Agent-dispatch arm: a per-dispatch **in-flight marker** written before each Agent dispatch and cleared on its return, so a turn that nonetheless ends with a dispatch still outstanding is refused at turn-end where the stranding premise holds (the autonomous orchestrator runs headless / with a live run dir, so it always does; a harness that re-invokes the parent gets a non-blocking note instead) — the arm `background-fence` abstains from. But `inflightcheck` is **enumeration-based** — it refuses turn-end only for a per-dispatch marker that was explicitly opened, so a dispatch shape nobody bracketed (a subprocess `spawn`, a retry) can still strand the run. The **`faff turncheck`** Stop hook is the **state-based** complement: it reads `owner.status` itself and refuses a **non-terminal turn-end** — a turn ending while the run is still `owner.status:"running"` with a clean queue and nothing legitimately in flight — so a strand is caught regardless of which dispatch type left it. The three compose disjointly, one hook per case: `runcheck` owns an undispatched queue, `inflightcheck` an open marker, `turncheck` the running-but-clean-and-quiet residual. Its detective half is `faff disposition`, which now flags the same bare `owner.status:"running"` state post-mortem (the mid-prep-death blind spot). *Prep-producer isolation is a deferred sibling (the inline prep producer is the same bloat class but its subagent dispatch was scoped out of the build-isolation work); the floor covers builds only until that lands, at which point the prep producer is folded into the same wording.*

## Park protocol and tracker tagging

On a `parked` return (including Step 4), confirm the initiator's tracker comment and reconcile the label or git-only evidence via the shared **Park protocol (shared)**. Reuse the fact and reason in `.faff/runs/<run-id>/ISSUE-XX/park.md`; finalize with the current accumulator and `backstop:true` for worker returns.

## Reporting

All human-facing output beep-boop emits — its run summary, the run-summary tracker status post, park comments, and discovered-scope tickets it files — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule), so enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule). The table-vs-definition-list rule is part of that pass.

After the owner closes, publish these outputs:

### 1. `.faff/runs/<run-id>/summary.md`

Step 11.5 prepares the reporting facts. The close bracket writes `summary.md` and prints it. If `run open` already closed the owner, prepare the facts and execute only the summary command from that bracket.

The renderer derives the outcome buckets and annotation arrays, the header, unit economics, install health, PR numbers, superseded ids, the holdout split and the ground-truth divergences. A missing or malformed facts file renders a `⚠ could not read facts` line at exit 0; exit 2 means the ledger itself is unreadable. Lines built from the facts file end ` _(reported)_`. The facts file carries only what faff's CLI cannot read: tracker reads and in-run judgements.

```
{ "format": 2,
  "tracker": { "titles": {ID: title}, "sibling_end_states": {ID: {"end_state_terminal": bool}}, "supersession_ticket_states": {ID: bool} },
  "run": { "gloss": {ID: text}, "methodology_findings": {"findings": [text], "prd_distance"?: text},
           "verdicts": {"fire_and_forget": N, "likely_fire": N, "routed_out": {"gap-blocked"|"circular-blocked"|"repeat-parked": [{"id", "detail"}]}},
           "resolve_attempts": {"attempted", "succeeded", "failed", "proceeded_medium": [{"id", "inferred", "evidence", "pr"}]} | null,
           "park_records": [{"issue_id", "root_cause_class", "timestamp"}], "reasons": {ID: text}, "inferred_deps": {...} | null,
           "discovered_scope": {"filed": [{"from", "id", "title", "relationship"}], "deduped": N, "surfaced": [{"id", "text", "why"}]} | null,
           "follow_ups": [text], "prep_summary": {...} | null, "tidy_log": path | null, "waves": N } }
```

`tracker.sibling_end_states` and `tracker.superseded_delivered` are the live observations step 11.5 already made for `faff reconcile`. `park_records` is the run's park accumulator (gateway → **Park protocol (shared)**); the command renders it as the `faff-parks` fence.

**Human follow-ups** lists skipped post-merge housekeeping as one-liners: branch/worktree cleanup, tracker status bumps, label cleanup and shell return-to-main. These never block shipped work or stop the queue (gateway Autonomous Mode Contract).

Every touched issue has exactly one outcome bucket. The command renders these splits:

- **Shipped:** auto-merged, appearing once. Subsection precedence: `## Shipped (post-merge verification flagged)` > `## Shipped (human-only ACs called out)` > `## Shipped (adversarial review skipped — chain outage)` > `## Shipped (auto-merged)`. Flagged covers `post_merge_verification_failures` (merged main HEAD failed its declared test rerun; tracker comment and discovered-scope entry filed, never revert or reopen) and `post_merge_verification_unverified` (no verdict obtainable, not a defect). Human-only ACs come from `merge-record.json`'s `ac_called_out` and require human confirmation. Adversarial skipped comes from `review_adversarial_skipped`, a full second-opinion chain outage. All remain `shipped`, never duplicate across subsections.
- **Superseded:** distinct terminal bucket `## Superseded (delivered by prior tickets)`, citing delivering ids. Deliverables already reached `main` through other tickets; this run built nothing and opened no PR. Excluded from shipped-only post-merge/holdout roll-ups.
- **PR open for human review:** `## PR open for human review`, or `## Awaiting landing (resumable)` for `landing_resumable` ids (landing loop's 25-minute budget elapsed, PR open and non-draft, no defect). Both are `pr-open`. A hard-parked 3-cycle `pr-open-for-human` always uses the plain subsection, never `landing_resumable`.
- **Parked:** `## Parked` from `park_records`, or `## Awaiting review (adversarial outage)` for `review_outage_pending` ids, a resumable build-side hold. Both are `parked`. Separately, non-empty `spec_review_outage_pending` renders `## Awaiting spec-review (adversarial outage)` from that array alone: prep ids were never `admitted` and have no outcome bucket. An id never belongs to both outage arrays.
- **Errored**
- **Routed out (not built):** passed spec-gating but verdict was neither `fire-and-forget` nor `likely-fire`; never entered the build pass.
- **Unreached (budget hit):** only when a set budget dimension (`until` / `max_attempts` / `tokens` / `cost`) breached with build-ready work undispatched. On tokens/cost breaches surface `tokens_source` (`transcript` / `estimate`) to distinguish metered and estimated figures. See `## Budget flags`.
- **Claimed by peer:** a live peer holds the issue outside this run's admissions, parks and budget deferrals. If recording the decline failed, pass the observed ID in `run.claimed_by_peer`.

Never invent an outcome bucket that disguises a capacity park. Banned bucket headings: "Deferred", "Queued for next run", "Saved for later", "Not dispatched this conversation", "Build queue ready for next pass". Informational sections (Discovered scope, Resolve-attempts, Inferred build-order deps, Human follow-ups) remain allowed; they do not re-home outcomes.

If the report contains one of those headings AND no budget ceiling was set or breached, the run is incomplete: re-enter the build pass and dispatch the queue. The only legitimate path to ending with a non-empty build queue is a budget dimension firing.

### 2. Tracker status update

When this run's install-health preflight found the install not clean, lead the post with the same `⚠ INSTALL-HEALTH: …` line (see `## Install-health preflight` above) — ahead of everything else.

Post the summary content (or a condensed version) to the tracker as a status update / project comment, so team members see the overnight outcome alongside the issues themselves. **Append the condensed one-line economics form:** `Economics: <tokens_total> tokens (<tokens_source>)[, $<cost_total>] · <shipped_count> shipped · <cost_per_shipped or ZERO-SHIP>` — so the headline cost rides alongside the issues (the full block stays in `summary.md` + the in-conversation output).

### 3. In-conversation output — print the summary in the conversation at the end of the run.

## Stopping condition

The run ends when **any** of:

- Without a wave consult, empty build and (in full mode) prep queues close with `queue-drained`.
- Everything remaining is in a parked / errored state, with no further dispatches possible (`Stop reason: all-remaining-parked`).
- A budget dimension breaches at a between-units check (`faff budget check` returns `breached ≠ []`): `Stop reason = budget-hit(<dims>)` on a `stop` outcome, or `budget-escalated(<dims>)` on an `escalate` outcome (which also emits the structured needs-human signal). `<dims>` names the breached dimension(s) — e.g. `budget-hit(max_attempts)`, `budget-hit(tokens)`. A `narrow` outcome does **not** stop the run — it continues on the methodology's cheapest subset until a `stop` falls through.
- With a wave consult, follow step 8.5 even when the queues are empty.
- (**unattended runs — L4, or an L3 that declared `autonomous.unattended` / the `sentry_acting` alias**) a `faff sentry check` returns `abort` on a run that acts: `Stop reason: sentry-abort` — `faff sentry abort` marks the ledger aborted-resumable, no further builds launch, verdicts surfaced. (A `pause` parks the implicated issue(s) and continues — for an unattended run: L4, or an L3 that declared `autonomous.unattended` / the `sentry_acting` alias; an attended L3 logs + surfaces. Not a run-level stop.)

On a budget-hit/escalate, in-flight units complete naturally — see `## Budget flags` for the full mechanics. Issues admitted to the build queue but not yet dispatched are reported under `## Unreached (budget hit)`; they retain Todo + spec state and the next run picks them up. This is the **only** legitimate way to end with a non-empty build queue; the "Never defers a queue" guarantee is otherwise binding (see `## Guarantees`). `Stop reason` is by which condition fires **first**: a set-and-breached budget wins over a would-be `queue-drained` (surface it — the user wants to know if their budget bound or was moot); several dimensions breaching on one check name all of them in `<dims>`; otherwise keep the reason from the stop that fired.

## Autonomous-mode signal to sub-skills

When beep-boop invokes any sub-skill (the `faff-tidy`, `faff-prep`, `faff-graft` skills, each resolved per gateway → **Sibling-skill invocation**), it prefixes the invocation with an explicit autonomous-mode signal:

> _Running in autonomous mode (invoked by /faff-beep-boop, run <run-id>). Skip all prompts. Park on ambiguity. Log everything to `.faff/runs/<run-id>/`. Return structured result to caller._

Sub-skills honour this per their own `Autonomous Mode` sections.

## Guarantees

- Follow the **no-prompt invariant** in gateway → **Autonomous Mode Contract** throughout L3/L4.
- **Never aborts the run on a single failure.** Park that issue, log, continue with the next unit of work.
- **Never auto-splits tickets** or restructures the backlog beyond what tidy's autonomous defaults allow.
- **Never auto-merges without the three-condition gate** (AC verified + CI green + review returned `pass` — see faff-graft Step 10).
- **Never reports a clean run without confronting the ledger against ground truth** (step 11.5). **Nor does it record a prep-return bucket without the same confrontation** (step 3). Follow those mandatory reconciliation procedures before recording success.
- Dispatch every ready-with-spec queue member, serialising in-queue blockers. Apply gateway → **Autonomous Mode Contract** for valid parks and resumption. Step 11 reconciles all admissions before close.
- **User-set budgets are the one legitimate stop-short.** If `--until HH:MM` or `--max N` fires, the run stops with any unreached build-queue issues reported under `## Unreached (budget hit)` in the summary, and the `Stop reason` line names the flag that fired. The user chose this budget; it is **not** an orchestrator deferral. Unreached issues are not parked; they stay in Todo with their specs, ready for the next run or human attention. See `## Budget flags` for full mechanics.
- **Always wave-loops until queue stability.** Follow step 8’s **Wave-boundary stop** for the queue, stall counter and consult. Use the mode resolved at entry throughout the run.
- **Post-merge housekeeping never halts the queue.** Apply gateway → **Autonomous Mode Contract** for failure handling and _Human follow-ups_, and gateway → **Worktree policy** for issue-scoped `faff worktree-prune --issue <id>`; never repository-wide `git worktree prune`.
- **Always leaves a complete audit trail** under `.faff/runs/<run-id>/`.
- **Always tags parked issues** so `/faff-wtf` surfaces them next morning.
- **Build-queue admission is verdict-gated** (canonical semantics: `faff contract automation-routing --describe`) — only the two build-ready verdicts enter the build queue. Other verdicts route out with a per-issue reason in the run summary's "Routed out" section. This is the same content `/faff-wtf` surfaces in the morning brief — no work is silently dropped.
- **Resolve-attempt before park.** Per the gateway → **Autonomous Mode Contract → Resolve-attempt before park**, the three decision/dependency/cycle-blocked routing verdicts get one bounded inference attempt to derive an answer from local context before parking. Successes proceed with a tracker-comment audit trail; failures park. The repeat-park verdict gets no resolve-attempt — the pattern is the signal.
- **Autonomous WIP is unbounded.** The WIP cap (if the methodology defines one) is human-flow-only. `/faff-beep-boop` is **never** gated on a WIP cap — the whole point of automating is to remove human-flow constraints from machine throughput. PRs awaiting human review are queued for human attention but do not count against any cap inside beep-boop. Admission stays governed by the verdict gate.

## Notes

- Beep-boop is best run when you expect to be away (overnight, during meetings, over a weekend). Results are on the tracker and in `.faff/runs/…`.
- For a quick list of what happened, run `/faff-wtf` — it reads the latest run summary and surfaces parked issues automatically.
- If you want to try beep-boop on a known-good narrow set before trusting it with the whole backlog, use explicit-list mode: `/faff-beep-boop ISSUE-12 ISSUE-15 ISSUE-17`.
- Running over SSH? A dropped connection or a closed laptop lid kills an in-flight run — launch `claude` inside `tmux` (or `mosh` + `tmux` for flaky links) so it survives. See [Running over SSH](../../../docs/guide/unattended.md#running-over-ssh).
