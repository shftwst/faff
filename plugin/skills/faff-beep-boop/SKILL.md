---
name: faff-beep-boop
description: "Chew through ready work unattended — overnight or fire-and-forget. Default: full pipeline (tidy → prep queue drain → build queue drain). Parks anything ambiguous so /faff-wtf can surface it in the morning. Trigger for: 'beep boop' / 'overnight' / 'fire and forget' / 'run the backlog' / 'unattended build'."
---

# Faff — Beep-Boop

Unattended end-to-end runs of the faff suite. Drives the other faff skills in **autonomous mode** — no prompts, no human in the loop, parks anything ambiguous, logs everything to `.faff/runs/…`.

This skill is the orchestrator. It does not reimplement prep, build, or tidy — it invokes the existing faff sub-skills with the autonomous-mode signal set.

**Methodology lens.** The `methodology` slot **always runs** — it defaults to `faffter-noon-methodology-structural` when `.faffrc` sets none, and its `pick-ordering` / `build-queue` outputs are Required (gateway → **The `methodology` slot**), so the build-queue order always comes through it. What's *conditional* is only the display banner: the run summary's first line is `Methodology: [skill-name]` and an opinionated lens (e.g. `faffter-dark-methodology-agile-delivery`) re-sequences by its own logic (value × risk × dep-aware) rather than the structural default's baseline order. When the slot is the silent structural default, the banner is omitted and the order is whatever the default's `pick-ordering` returns (priority + chainable unlock value) — beep-boop renders the slot's order and never names a baseline of its own; the slot is never *skipped*, because its outputs are load-bearing. **No WIP gating** — autonomous queues are unbounded regardless of methodology. Admission stays governed by the verdict gate (admit `fire-and-forget` + `likely-fire`, route out the other four verdicts).

## Configuration

**Load the gateway first.** Beep-boop is the autonomous entry point; if `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. It gates the queue on the **fixed automation-routing admission rule**; every skill it delegates to (tidy, prep, graft + their slots) inherits the gateway ambiently.

Beep-boop uses these `slots` from `.faffrc` when set:

- `concurrency` — the build-pass executor. Default `faffter-noon-concurrency-sequential` (one build at a time); swap to `faffter-dark-concurrency-parallel` for capped, worktree-isolated concurrency with rebase-before-merge.
- `spec`, `review`, `ship` — passed through to the sub-skills; beep-boop doesn't use them directly.

## Invocation

Two forms:

| Form | Behaviour |
|---|---|
| `/faff-beep-boop` | **Full pipeline (default).** Tidy → prep queue drain → build queue drain. The whole shebang. |
| `/faff-beep-boop ISSUE-XX ISSUE-YY …` | **Explicit list.** Skips discovery; operates on the listed issues only. |

All forms run non-interactively. No yes/no gates. The whole point is unattended execution.

All forms also accept two optional **cost-budget flags** that can be combined; the run stops when either fires. See `## Budget flags` below.

## Budget flags

Two composable flags cap the cost of a run. Pass either, both, or neither. Both work with both invocation forms (default full pipeline, explicit-list).

| Flag | Caps | Semantic |
|---|---|---|
| `--until HH:MM` | Wall-clock time | Stop dispatching new units once local time reaches HH:MM. 24-hour format. Past times interpret as next-day same time (so `--until 06:00` started at 23:00 means 06:00 tomorrow). |
| `--max N` | Build attempts | Stop dispatching new build issues once N attempts have been launched. Counts every build-queue dispatch regardless of outcome (Shipped / PR-open / Parked / Errored). Does **not** count issues routed out at the verdict gate (they never got a `/faff-graft` invocation). Does **not** count prep dispatches. |

### Phase scope

- **`--until`** gates **both phases**. Between prep candidates AND between build issues, the orchestrator checks the wall clock. If HH:MM passes mid-prep-drain, no new prep dispatches; in-flight prep finishes; the build phase is skipped entirely (entering it would trip the same gate). If HH:MM passes mid-wave, no new build issues launched; in-flight builds drain; wave re-entry is skipped.
- **`--max N`** gates **build only**. Prep dispatches don't consume the count. The gate is checked before every build-issue launch and at every wave boundary.

### When the check fires

Between units, never mid-unit. Specifically:

- After every prep return, before launching the next prep candidate.
- After every build return (or before every launch in parallel mode), before dispatching the next build issue in the same wave.
- At every wave boundary, before re-assembling the next wave's build queue.

In-flight units finish naturally. There is **no mid-issue cancellation** — a `/faff-graft` run in progress when the budget fires completes normally and lands in its terminal state (which then appears in Shipped / PR-open / Parked / Errored as usual). Under the parallel executor, up to `concurrency_max` issues may finish after the budget fires; that's expected.

### Launch-counted, not terminal-state-counted

`--max N` fires when the count of **launched** build attempts reaches N, not the count of returned terminal states. In sequential mode the two are identical. Under the parallel executor, counting launches prevents the `concurrency_max - 1` overshoot you'd get from waiting for the Nth terminal state — every launch eventually terminates, so terminal-state count converges to exactly N anyway (or to whatever was launched when `--until` fired first, if both budgets are set).

### Unreached issues

Issues that reached build-ready (spec present, verdict-admitted, partitioned by conflict analysis) but were never dispatched because the budget fired land in a new **Unreached (budget hit)** bucket in the run summary. They are **not parked** — they retain Todo + spec state and the next run picks them up. No tracker comment is added (their state is unchanged from run start).

Un-prepped Backlog candidates whose prep dispatch never fired because `--until` cut prep short do **not** appear in `Unreached`. They remain in Backlog (their pre-run state, unchanged); the prep-queue summary just has smaller counts than possible. The next run picks them up.

### Default behaviour (no flags)

If neither flag is passed, behaviour is unchanged from the no-budget run. The run ends by queue emptiness or all-remaining-parked, exactly as before.

## Full pipeline (default)

Two independent phases. The **prep queue** drains fully first. Then the **build phase** runs as one or more **waves**: each wave assembles a build queue from the current Todo+spec set, drains it, and re-checks for work newly unlocked by issues that just shipped. The prep queue always runs to completion regardless of whether any wave ends up non-empty. Overnight prep is valuable on its own.

### 1. Tidy pass

Invoke the `faff-tidy` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**) in autonomous mode. Applies the auto-actions (archive dead weight, reparent obvious orphans, strip dead references, canonicalise overlooked specs, clear stale park labels) and tags stale-spec / superseded-spec issues so the prep queue picks them up in step 2. Logs remaining findings for morning review.

### 2. Prep queue build

Gather every issue that is:
- Not cancelled or archived (shared rule)
- **Automation-eligible** — skip anything **not automation-eligible** (gateway → **Automation eligibility**: no `faff-automate` under the opt-in default, or a `faff-automation-hold`)
- Not explicitly blocked
- In Backlog or similar pre-Todo state
- Lacking a valid spec (no spec, or spec marked stale)
- **Flagged by the tidy pass as a prep candidate** — issues tagged stale-spec (need refresh) or superseded-spec (need fresh spec). These are active issues already in Todo with a spec that's no longer valid; prep's stale-refresh or fresh-spec autonomous paths decide whether they rejoin the build queue or park for human attention.

**Decide membership via `faff next`, not by re-deriving these criteria by hand** (gateway → **Next-step transition**): map each issue's fetched state to the flags and consult `faff next` — an issue belongs in the prep queue iff it returns `next: prep`. The bullets above are the human-readable shape of that same transition.

This is the prep queue. The eligibility-exclusion here (and at build-queue assembly / wave re-entry) is an **efficiency early-exit, not the guarantee** — prep and graft are the chokepoints that actually enforce eligibility (gateway → **Automation eligibility**), so a not-eligible issue can't slip through even if a filter is missed. Items skipped here never enter the run-ledger `admitted` array, so `runcheck` is unaffected.

### 3. Prep queue drain

For each candidate, invoke the `faff-prep` skill via the Skill tool in autonomous mode. Possible returns per `skills/faff-prep/SKILL.md` autonomous section:
- `refreshed` — spec updated, issue stays in Todo (contributes to build queue)
- `promoted` — fresh high-confidence spec, moved to Todo (contributes to build queue)
- `promoted-needs-review` — medium-confidence spec attached (rating retained) and moved to Todo; it joins the candidate set but its verdict is `needs-decision-first`, so it routes out of the build queue and surfaces in the morning brief rather than auto-building
- `ineligible` — issue is not automation-eligible (gateway → **Automation eligibility**: no `faff-automate` under opt-in, or a `faff-automation-hold`); skipped without speccing or promotion. Never enters the `admitted` ledger and is **not** counted as parked — surfaced in the run summary's On-hold bucket, not Parked
- `parked` — low confidence, contract violation, or architectural change needed; tracker tagged, log written
- `errored` — treated as parked for reporting

Runs until the prep queue is empty. **Never short-circuits on build-queue state.**

### 4. Build queue assembly

Collect every issue that meets readiness (in Todo, with no open *external* blockers — in-queue dependencies are handled by conflict analysis as collision groups, not exclusions) **and has a spec discoverable per the shared Spec discovery rule** (gateway) — tracker comments, tracker description/body, or committed `docs/`. Any hit counts. This includes:

- Issues already in Todo at the start of the run (spec likely on the tracker)
- Issues freshly moved to Todo by the prep queue (spec on the tracker by construction)

Do not require a repo-side spec file at this stage — faff-graft commits the spec to `docs/` only at the start of the build. An absent spec file under the configured **Spec docs path** (default `docs/specs/*-<issue>-*.md`) is not grounds for exclusion; the tracker is the pre-build source of truth.

**Gate eligibility via `faff next` first** (gateway → **Next-step transition**): consult `faff next` per candidate; only issues returning `next: graft` are build-eligible (`prep` rejoins the prep queue, `skip-ineligible`→On-hold, `needs-human`→routed-out, `blocked`/`done`/`none`→excluded). `faff next`'s `--blocked` carries **external** blockers only — in-queue dependencies stay with conflict analysis. Then, on the `graft`-eligible set:

**Re-scan the live comment thread first (mandatory — gateway → Automation-routing verdict (fixed) → _Live-thread reconciliation_).** Before computing **or trusting a cached** verdict for any spec-gated candidate, fetch its comments and scan everything posted *after* the spec (faff-prep → **Scenario B Step 2a**: Challenge / Resolution / Context / Noise). A **Resolution** (a human picking an option, answering a `**Punt:**`, closing an open decision) or a **Challenge** (a new constraint contradicting the spec) means the attached spec's retained rating is **stale** — the human steered the decision on the control surface. Route that candidate through **narrow prep** (the `faff-prep` skill, autonomous) to fold the resolution in and **re-rate**, then compute the verdict on the refreshed spec — never the pre-resolution snapshot. A cached verdict from the tidy pass only reflects the thread as of tidy; any comment since supersedes it. (This is the step whose absence stranded a `medium`-spec issue whose open `**Punt:**` a human had already resolved by comment — it routed out as `needs-decision-first` instead of re-rating to `high` → `fire-and-forget`.) This re-scan is beep-boop's discharge of the steer-loop re-read in gateway → **Human curation is authoritative** assertion 2 — the wave honours a human's mid-flight edit, never an over-ridden snapshot.

**Compute the automation-routing verdict** for every spec-gated candidate. The verdict is normally already in `.faff/runs/<run-id>/automation-verdicts.md` from the tidy pass in step 1 — read it from there to avoid recomputation, **but only after the live-thread re-scan above clears it as current** (a post-tidy Resolution/Challenge invalidates the cache entry and forces the narrow-prep refresh). Any candidate **not** in that cache — an issue prep promoted during a wave (step 8), or one whose spec was refreshed since the tidy pass — is computed **inline** at assembly and written back to the cache; the top-of-run cache only covers the issues tidy saw. **Admit only** `fire-and-forget` and `likely-fire` verdicts to the build queue.

Issues routed out of the build queue (the other four verdicts) are captured for the run summary's "Routed out" section — they appear in `/faff-wtf`'s next morning brief with the verdict-specific diagnosis.

**Claim-before-admit (multi-orchestrator safety — FAFF-82).** Before appending a verdict-admitted issue to `admitted`, re-read its **live** tracker status (gateway → **Issue claim & status monotonicity**). If a peer already claimed it — status already `In Progress` / `In Review` / `Done` set by someone else — give it the **`claimed-by-peer`** disposition: **do not** append it to `admitted` (so `runcheck`'s `admitted − outcomes == ∅` invariant stays true), and **do not** park it (a peer is building it). Surface it in the run summary's "Claimed by peer" line. The same re-read runs at wave re-entry re-assembly (step 8.4), so an issue freed by a crashed peer is re-admittable later. (graft's own Step 5 claim is the backstop — it re-checks and skips if a peer claimed the issue between assembly and dispatch.)

**Record to the run ledger.** Append every admitted issue to `admitted`, and write each routed-out issue's `routed-out` outcome immediately, in `.faff/runs/<run-id>/run-ledger.json` (see _Run ledger_). The ledger is what step 11's `runcheck` audits — keep it current as the queue is assembled and drained.

Exclude anything parked during the prep queue (no valid spec or flagged for human attention). Also exclude anything **not automation-eligible** (gateway → **Automation eligibility**) — though by construction a not-eligible item can't reach here (prep/tidy never promoted it to Todo); this is the defence-in-depth early-exit.

### 5. Conflict analysis

Run once over the build queue. See _Conflict analysis_ below.

### 6. Build pass

Hand the conflict-analysis partition to the **`concurrency` slot** (see _Build-pass execution_ below), which drives the `faff-graft` skill in autonomous mode per issue — sequentially by default, or concurrently when the parallel executor is configured — respecting the partition (independents in parallel where the executor supports it, serial within collision groups). Independents are ordered per the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**); beep-boop states no ordering of its own. The structural default supplies priority + chainable unlock value when no methodology is set; an opinionated lens supplies its own (value × risk × dep-aware).

### 7. Wave drain

Keep building until the wave's build queue is drained or everything remaining is parked. Each build return is aggregated. This is the inner drain loop — when a wave's queue is exhausted, control passes to step 8 (wave re-entry).

### 8. Wave re-entry

After the wave drains, re-check the tracker for work newly unlocked by issues that just shipped. Faff's promotion rule is that **only specced items live in Todo**, but Todo can hold specced-and-blocked items too — so a chain unlock can land in either bucket. Wave re-entry scans both, **consults `faff next` per newly-unblocked item** (gateway → **Next-step transition**) to decide its step — `prep` routes through narrow prep, `graft` rejoins build-queue assembly, `skip-ineligible`/`needs-human` route out — rather than prose-deciding. Every newly-unblocked item that returns `prep` routes through narrow prep. Prep is the single mechanism that handles spec generation, in-place refresh, and the Backlog→Todo move; the orchestrator does no tracker state moves of its own.

1. **Budget check.** If `--until HH:MM` is set and the wall clock has passed HH:MM, OR `--max N` is set and N build attempts have been launched, exit to reporting with `Stop reason: budget-hit (--until …)` or `budget-hit (--max N)` accordingly. The wave re-entry step is the last point at which the budget gate fires for the run; if it fires here, the run ends cleanly with any unreached issues reported under `## Unreached (budget hit)` in the summary.
2. Re-query **Backlog AND Todo** issues per the shared ignore rule, excluding anything already touched by an earlier wave (shipped / PR-open / parked / errored — these stay in their bucket; once parked in this run, always parked in this run).
3. For every **Backlog or Todo** issue whose declared blockers are now all closed (shipped earlier in this run or already closed at run start) **and which is automation-eligible** (skip anything not automation-eligible — gateway → **Automation eligibility**), invoke **narrow prep** — the `faff-prep` skill via the Skill tool, autonomous on just that issue. (Prep itself also returns `ineligible` for a not-eligible issue, so this filter is the early-exit, not the guarantee.) Prep handles three cases through its existing autonomous returns (see step 3 of the full pipeline):
   - **Backlog, unspecced** (was blocked from being specced): prep generates a fresh spec and, on high confidence, promotes to Todo (`promoted`).
   - **Backlog, specced** (was specced but never promoted, or was demoted): prep confirms the spec is still valid (or refreshes if stale — upstream work just shipped) and promotes (`refreshed` or `promoted`).
   - **Todo, specced** (was specced-and-blocked, now unblocked): prep confirms or refreshes the spec — staleness matters here since the upstream work just landed; the item stays in Todo (`refreshed`).

   In all three cases prep may instead return `parked` (low confidence) or `errored` — those items are logged and skipped for the rest of the run.

   This is the mechanism that brings mid-run-unlocked chains into the build queue **and** keeps specs honest against upstream work that has just shipped. **Do not** re-run full tidy — tidy fires once at the top of the run.
4. Re-run step 4 (build queue assembly). The Todo set now includes any items prep just promoted.
5. If the new build queue is empty, exit to reporting.
6. Otherwise run steps 5–7 again (conflict analysis → build pass → wave drain), then return to step 8.

Termination is by queue emptiness: each wave shrinks the pool of unreached issues and parked issues stay parked, so the loop converges. No iteration cap.

Log each wave's admissions, drain count, and exit reason under `.faff/runs/<run-id>/wave-N/`. Exit reasons are `drained` (queue empty after build pass), `all-parked` (every remaining issue parked or errored), or `budget-hit` (budget gate fired during or at the boundary of this wave).

**Why this exists:** chains unlocked mid-run (`ISSUE-A` ships → `ISSUE-B`'s blocker clears) are picked up here. The chain's downstream items live in Backlog (per the promotion rule above), which is why prep is the entry point — the orchestrator does not move state directly. Chains visible at first assembly are still handled by step 5's conflict analysis as collision groups — wave re-entry catches the rest.

### 9. Wave-1 empty short-circuit

If wave 1's build queue is empty after assembly (step 4), skip steps 5–8 and proceed directly to reporting. No subsequent waves run — there's nothing for shipped work to chain on. Prep output still counts as a successful run.

### 10. File discovered-scope tickets

After the wave loop converges (and only when builds ran — the wave-1 short-circuit at step 9 skips this), collect the **discovered scope** `/faff-graft` recorded during the run and file the concrete items as Backlog tickets. This is bottom-up source (b) — execution-discovered work (gateway → **Agent Lanes**; `design/planning-loop.md`). It is the one step where beep-boop writes tickets **directly** rather than via tidy — legitimately, as the orchestrator lane (full tracker write).

1. **Collect.** Glob `.faff/runs/<run-id>/*/discovered-scope.json` (each built issue's file; absent when it found nothing). Every built issue contributes regardless of its terminal outcome — a `shipped`, `pr-open`, or `parked` issue can all carry discovered scope.
2. **Gate per item:**
   - `vague` items → never filed. Aggregate for the run summary + the next `/faff-wtf` morning brief only.
   - `concrete` items → **appetite-gated** (gateway → **Appetite for destruction**, _Execution-discovered auto-create_ row): `low` surfaces only; `medium` files only with an opinionated methodology; `high` (default) files every concrete item; `full` always files.
3. **Dedup before creating.** Match each item's title/surface + relationship target against existing open tickets, **including `faff-chain-gap-fill` tickets tidy created this run** — a build often "discovers" a downstream the spec already named and tidy already filled. Skip duplicates; count them.
4. **File** each surviving item per the `faff-chain-gap-fill` recipe (see `/faff-tidy` → _Chain gaps_ — do not restate it): status `Backlog`, tag `faff-chain-gap-fill`, the recorded relationship link to the originating issue, and a "discovered during build of SHF-XX" provenance line in the description. The next run's tidy + prep pass picks them up — depth grows one layer per run.
5. **Record** the filed count to the ledger's informational `discovered_scope_filed` field (see Run ledger) and log per-item (id, source issue, relationship, gate decision) under `.faff/runs/<run-id>/discovered-scope-filed.md`.

Filed tickets are **new work, not admitted issues** — they sit outside runcheck's `admitted − outcomes` invariant and never affect run completeness. (Within-run convergence — prepping and building these in the *same* run until both bottom-up tributaries run dry — is a documented future extension, not done here; see `design/planning-loop.md`.)

### 11. Run completeness check (mechanical)

Before writing the run summary, run the bundled **runcheck** script — the mechanical backstop for the "never silently defer the queue" guarantee. It reads the run ledger and fails if any admitted issue has no terminal outcome (resolve the `faff` executable per gateway → **Resolver** if it isn't on `PATH`):

```
faff runcheck   # audits the latest .faff/runs/* ledger
```

- **Exit 0 (clean)** — every admitted issue reached a terminal outcome. Proceed to reporting.
- **Exit 3 (undispatched)** — one or more admitted issues never reached a terminal state. The run is **not complete**: return to step 8 and dispatch them, or genuinely park them under a valid category, then re-run runcheck. **Do not** write a "complete" summary while runcheck fails — that is the deferred-queue anti-pattern (gateway → Autonomous Mode Contract), now caught mechanically rather than left to prose compliance.
- **Exit 2 (no/malformed ledger)** — the ledger wasn't maintained; treat as a run-integrity error, reconstruct it from the per-issue dirs + verdict cache, then re-check.

## Run ledger (mechanical completeness)

beep-boop maintains a machine-readable ledger at `.faff/runs/<run-id>/run-ledger.json` so the completeness guarantee is checkable by `runcheck` (step 11) and the Stop hook (below) rather than resting on prose alone:

```json
{ "run_id": "<run-id>", "admitted": ["SHF-1", "SHF-2"], "outcomes": { "SHF-1": "shipped" }, "discovered_scope_filed": 0 }
```

- **`admitted`** — every issue the verdict gate admits to the build queue (`fire-and-forget` + `likely-fire`). Append at step 4 (build queue assembly) and at every wave re-entry re-assembly (step 8.4). Explicit-list mode appends each admitted issue the same way.
- **`outcomes`** — written the moment an issue reaches a terminal bucket: `shipped`, `pr-open`, `parked`, `errored`, `routed-out` (routed out by the verdict gate at step 4), or `unreached-budget` (admitted but a budget flag fired before dispatch). These are exactly the run-summary buckets — the ledger is the structured twin of the summary.

The invariant runcheck enforces: `admitted − outcomes.keys() == ∅`. Any admitted issue with no recorded outcome is an undispatched queue, not a finished run.

- **`discovered_scope_filed`** (informational) — the count of execution-discovered tickets filed at step 10. These are **new** tickets, not admitted build-queue issues, so they are **outside** the invariant above and never affect `runcheck`. The field exists so the count is auditable alongside the run summary.

### Stop hook (harness-enforced backstop)

Step 11 is agent-run, so it shares the failure mode it guards against — a non-compliant run could skip it. The Stop hook closes that gap: it runs `runcheck --hook` outside the agent's control when the session ends and blocks Stop with a reason if the latest run left admitted issues undispatched. On first autonomous run, register faff's Stop-hook command set deterministically — **run `faff hooks-ensure`** (never hand-edit `settings.json`):

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
"$faff" hooks-ensure
```

`hooks-ensure` (FAFF-192) idempotently ensures **both** faff Stop-hook commands are in `.claude/settings.json` — `runcheck --hook` (this backstop) and `prepcheck --hook` (faff-prep's same-turn-attach guard, FAFF-178) — non-destructively (a byte-stable no-op when already present), and **skips** any command the resolved `faff` can't serve (a stale/copy install) rather than wiring a session-blocking hook. In `--hook` mode runcheck stays silent for any session without an open beep-boop ledger, so it never disrupts ordinary work — it only fires when a beep-boop run left admitted issues undispatched. Tell the user when the hook set is added and why.

## Explicit-list mode

`/faff-beep-boop ISSUE-XX ISSUE-YY …`

For each listed issue:
- Skip if cancelled or archived (log the skip with reason).
- Skip if the issue doesn't exist (log and continue).
- If spec missing → invoke the `faff-prep` skill (autonomous). Apply return per the full mode prep queue logic.
- If spec present → **re-scan the live comment thread before queueing** (gateway → **Automation-routing verdict (fixed) → _Live-thread reconciliation_**; faff-prep → **Scenario B Step 2a**). A **Resolution** or **Challenge** posted after the spec supersedes its retained rating — route the issue through narrow prep (the `faff-prep` skill, autonomous) to fold it in and re-rate first; otherwise queue for build.

After the list is processed:
- **Compute the automation-routing verdict** inline for every spec-gated issue (gateway → **Automation-routing verdict (fixed)**) — there is no tidy pass to read a cached verdict from, **so the live-thread re-scan above is the only thing standing between a stale retained rating and the verdict; it is mandatory, not optional, in explicit-list mode.** Admit only `fire-and-forget` and `likely-fire`; route the other four verdicts out with a one-line reason in the run summary's "Routed out" section.
- Conflict analysis on the set that reached build-ready.
- Build pass per the shared flow.
- Report.

## Conflict analysis

Before the build pass, partition the ready set into **independents** (safe to build in parallel) and **collision groups** (must be serialised within the group, though parallel with other groups).

**Critical framing:** conflict analysis is the mechanism that handles **in-queue dependencies**. Issue A depending on issue B, where B is in the same run's queue, is a collision group — not a park. "Serialise A behind B" is the answer. Parking A because "B isn't Done yet" when B is literally about to be built in this same run is the failure mode that breaks the pipeline: a chain of 5 issues all parking for "depends on earlier" means nothing ships. The chain is the whole point of overnight automation.

**Verdict integration.** When the automation-routing verdict is computed (by tidy in the full pipeline, or inline in explicit-list mode), `likely-fire` is assigned precisely to issues that conflict analysis will serialise into a collision group with another in-queue issue. This means conflict analysis here is **confirming** the partition the verdict already implies — not reclassifying. Output of conflict analysis is the concrete (independents, groups) partition; the verdict was the up-front signal.

Heuristics — issues are considered likely to collide when any of these hold:

1. **Same file(s).** Their specs name one or more of the same files — exact path overlap.
2. **Same directory at full-path granularity.** Their specs touch the same directory taken as a **full path from the repo root** — e.g. both under `src/auth/`. A shared *top-level* directory alone is **not** a collision: two issues both somewhere under `src/` (one in `src/auth/`, one in `src/billing/`) are independent. Match on the deepest shared directory the specs actually name, not the first path segment — top-level matching spuriously serialises half the queue.
3. **Named shared module / util / symbol.** One spec names a module, utility, component, service, or symbol (in a `**Chosen:**` decision, the approach, or an `**Assumes:**`) that the other also edits or depends on — even when the file paths differ. A declared shared dependency collides: two issues that both modify `src/lib/auth.ts`'s exported `verifyToken`, or both extend the same base component, will conflict regardless of which files name it. Use what the specs *declare* (no import-graph build is required); a shared named surface is the collision signal.
4. **Declared blocker.** One issue declares another in-queue issue as a blocker — serialise the dependent behind the blocker. Both still build in this run.
5. **Shared scope tag / label** that indicates a shared subsystem (per project conventions in `CLAUDE.md`).

When in doubt, serialise. Parallelism is a speedup, not a correctness requirement — a false-positive collision costs a little time; a false-negative costs merge conflicts and broken builds. The full-path rule (2) trims the false positives that collapse the queue to near-sequential; the named-shared-surface rule (3) catches the false negatives that bare path-matching misses. The parallel executor's rebase-before-merge step (see the `concurrency` slot) is the backstop for any collision that slips through both.

**What conflict analysis does NOT do:** it does not park issues. Everything that reached build-ready (spec present, not cancelled/archived, no external dependency missing from the run's combined queue) gets built — either as an independent or as an element of a serialised group. If you find yourself writing "park SHF-X because SHF-Y is Todo" during conflict analysis, stop: SHF-Y is Todo *in this run's queue*, so the correct action is `[SHF-Y, SHF-X]` as a serialised collision group, not a park.

Output of conflict analysis:

```
{
  "independents": ["ISSUE-A", "ISSUE-B", "ISSUE-C"],
  "groups": [
    ["ISSUE-D", "ISSUE-E"],
    ["ISSUE-F", "ISSUE-G", "ISSUE-H"]
  ]
}
```

Log the partition and the reasoning ("ISSUE-D and ISSUE-E both touch `src/auth/`") to `.faff/runs/<run-id>/conflict-analysis.md`.

## Build-pass execution (the `concurrency` slot)

The build pass is executed by the configured **`concurrency` slot**, a mechanism slot that consumes the conflict-analysis partition and drives the `faff-graft` skill per issue. It defaults to `faffter-noon-concurrency-sequential` (one build at a time — no worktree contention, no merge races) and is overridable with `faffter-dark-concurrency-parallel` (runs independents concurrently, each in its own worktree, up to `concurrency_max` — default 4 — with rebase-before-merge so a moving `main` can't merge stale-green).

Every executor honours the same slot contract: build every issue in the partition, serialise within collision groups, record each terminal outcome to the run ledger (so `runcheck` can verify completeness), and never weaken the merge gate. A missing slot is never a park reason — it defaults to sequential. The contract is fixed in the gateway → **Mechanism slot (`concurrency`)** → _The `concurrency` slot contract_ — see it for the full obligations.

## Park protocol and tracker tagging

Beep-boop itself rarely parks — its sub-skills do. But when a sub-skill returns `parked` for an issue, beep-boop ensures:

1. The tracker comment written by the sub-skill is present on the issue.
2. The issue carries the `faff-parked` tag (or tracker-equivalent label). If the sub-skill didn't apply it, beep-boop does.
3. The per-issue log directory (`.faff/runs/<run-id>/ISSUE-XX/`) has the `parked` reason written to a top-level `park.md`.

This is what `/faff-wtf` looks for to surface parked issues in the morning.

## Reporting

All human-facing output beep-boop emits — its run summary, the run-summary tracker status post, park comments, and discovered-scope tickets it files — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule), so enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule). The table-vs-definition-list rule is part of that pass.

On run completion, produce:

### 1. `.faff/runs/<run-id>/summary.md`

When a `methodology` skill is configured, the first line of the summary file is the literal string:

    Methodology: [skill-name]

(followed by the existing summary layout below). When no methodology is configured, this line is omitted and the file starts with the `# Beep-Boop Run …` heading as normal.

```markdown
# Beep-Boop Run — YYYY-MM-DD HH:MM:SS
Mode: [full | explicit-list]
Duration: Xh Ym
Waves: N
Stop reason: queue-drained | all-remaining-parked | budget-hit (--until HH:MM) | budget-hit (--max N)

## Methodology findings (rendered only when a methodology skill is configured)

(One-line summary of how the lens shaped this run — e.g. "Re-ordered 2 collision groups for value-aware sequencing; no methodology violations surfaced." Or list the diagnoses the methodology surfaced during the run, one per line, as it returned them.)

## Build queue verdicts at admission
- fire-and-forget: N
- likely-fire: N
(admitted: N total)

## Routed out (not built — needs human action)

needs-decision-first (N)
- ISSUE-AA  [synthesis gloss] — Punt in spec: [decision asked]
- ISSUE-QQ  [synthesis gloss] — confidence: medium (spec thin on [area]); attached for review, not built

gap-blocked (N)
- ISSUE-BB  [synthesis gloss] — spec assumes [named gap]

circular-blocked (N)
- ISSUE-CC  [synthesis gloss] — in cycle [CC → DD → EE → CC]

repeat-parked ⚠ (N)
- ISSUE-DD  [synthesis gloss] — parked N runs same root cause: [class]

## Resolve-attempts (appetite high/full)
- Attempted: N
- Succeeded (proceeded with audit trail): N
- Failed (parked): N

### Proceeded on medium confidence: N
> These shipped autonomously on an inferred answer. The audit-trail comment is on each PR — review before merge if you disagree; faff re-parks on a dissenting comment. Full record in `.faff/calibration/appetite-decisions/`.
- ISSUE-PP  [synthesis gloss] — inferred [answer] from [evidence]; PR #nnn (audit comment posted)

## Shipped (auto-merged): N
- ISSUE-XX: title (PR #nnn)

## PR open for human review: N
- ISSUE-YY: title (PR #nnn) — reason: CI failing on e2e; AC3 requires visual review

## Parked: N
- ISSUE-ZZ: title — reason: low-confidence fresh-spec (log: ISSUE-ZZ/prep.md)

## Errored: N
- ISSUE-WW: title — MCP timeout during build

## Unreached (budget hit): N
- ISSUE-VV: title — admitted to build queue, not dispatched (--until 06:00 fired before launch)

## Discovered scope (execution-reported): N filed
- ISSUE-XX → filed SHF-NN (downstream): "title" — discovered during build, Backlog/`faff-chain-gap-fill` (next run preps it)
- Deduped (already tracked): N
- Surfaced only (vague, or low appetite): N
  - ISSUE-YY: "logging inconsistent across handlers" — vague, not filed

## Human follow-ups: N
- ISSUE-XX: delete local branch `feat/issue-xx` (cleanup skipped — shell was inside worktree)
- ISSUE-YY: remove worktree `~/.faff/worktrees/faff/issue-yy` (cleanup skipped — permission denied)
- ISSUE-ZZ: bump tracker status to Done (MCP returned 5xx during post-merge update)

## Prep queue summary (full mode only)
- Refreshed: N
- Promoted: N
- Promoted (needs review, medium confidence): N
- Parked: N
- Errored: N

## Tidy findings (full mode only)
See logs/YYYY-MM-DD/HHMMSS-tidy.md
```

The **Human follow-ups** section captures post-merge housekeeping that was skipped so the run could continue — branch/worktree cleanup, tracker status bumps, label cleanup, shell return-to-main. See the gateway's Autonomous Mode Contract ("Post-merge housekeeping failures never halt the queue"). These are one-liners the human can clear in a minute the next morning; none of them block shipped work, so none of them justify stopping the pipeline.

**The outcome buckets are exhaustive.** Every issue touched by the run lands in exactly one of:

- **Shipped**
- **PR open for human review**
- **Parked**
- **Errored**
- **Routed out (not built)** — spec-gated successfully but the verdict was not `fire-and-forget` / `likely-fire`, so it never entered the build pass.
- **Unreached (budget hit)** — appears **only** when `--until` / `--max` was passed and fired with a non-empty build queue remaining; reached build-ready but wasn't dispatched before the budget fire (see `## Budget flags`).
- **Claimed by peer** (FAFF-82) — a peer orchestrator holds it (built by another live run); **not** a deferral and **not** a park, and it never entered this run's `admitted` array, so it does not affect `runcheck`.

Do **not** invent additional sections. These are all **banned** — euphemisms for "Parked on capacity grounds", which is forbidden:

- "Deferred"
- "Queued for next run"
- "Saved for later"
- "Not dispatched this conversation"
- "Build queue ready for next pass"

If the report contains one of those headings AND no budget flag was set, the run is incomplete: re-enter the build pass and dispatch the queue. The only legitimate path to ending with a non-empty build queue is a user-set budget firing.

### 2. Tracker status update

Post the summary content (or a condensed version) to the tracker as a status update / project comment, so team members see the overnight outcome alongside the issues themselves.

### 3. In-conversation output

Print the summary in the conversation at the end of the run.

## Stopping condition

The run ends when **any** of:

- The build queue is empty AND (in full mode) the prep queue is empty (`Stop reason: queue-drained` — the normal exit).
- Everything remaining is in a parked / errored state, with no further dispatches possible (`Stop reason: all-remaining-parked`).
- A user-set budget fires: `--until HH:MM` reaches its time, or `--max N` reaches its launch count (`Stop reason: budget-hit (--until …)` or `budget-hit (--max N)`).

On budget-hit, in-flight units complete naturally — see `## Budget flags` for the full mechanics. Issues admitted to the build queue but not yet dispatched are reported under `## Unreached (budget hit)` in the run summary; they retain Todo + spec state and will be picked up by the next run. This is the **only** legitimate way for the run to end with a non-empty build queue; the "Never defers a queue to the next run" guarantee is otherwise binding (see `## Guarantees`).

`Stop reason` is determined by which condition fires first:

- If a budget was set AND fired during the run, `Stop reason = budget-hit (...)` regardless of whether the run "would have" exited as `queue-drained` on the next check. Surface the budget — the user wants to know whether their budget was binding or moot.
- If both budgets fire on the same check, name the one that fired first; if simultaneous, name both.
- Otherwise, `Stop reason = queue-drained` or `all-remaining-parked` per the conditions above.

## Autonomous-mode signal to sub-skills

When beep-boop invokes any sub-skill (the `faff-tidy`, `faff-prep`, `faff-graft` skills, each resolved per gateway → **Sibling-skill invocation**), it prefixes the invocation with an explicit autonomous-mode signal:

> _Running in autonomous mode (invoked by /faff-beep-boop, run <run-id>). Skip all prompts. Park on ambiguity. Log everything to `.faff/runs/<run-id>/`. Return structured result to caller._

Sub-skills honour this per their own `Autonomous Mode` sections.

## Guarantees

- **Never aborts the run on a single failure.** Park that issue, log, continue with the next unit of work.
- **Never auto-splits tickets** or restructures the backlog beyond what tidy's autonomous defaults allow.
- **Never auto-merges without the three-condition gate** (AC verified + CI green + review returned `pass` — see faff-graft Step 10).
- **Never parks work on "scope" or "capacity" grounds.** Every ready-with-spec issue gets attempted. "Too many to do in one session" is explicitly forbidden (see the gateway contract). The run ends when the queue drains or everything remaining is genuinely parked by the three valid categories — not by the orchestrator deciding to do fewer.
- **Never "defers" a queue to the next run.** Identifying a build queue (independents + collision groups, waves mapped) and then ending the run with that queue undispatched is **the same failure as parking it**, regardless of the wording in the summary. Phrases like "12-issue build queue not dispatched this conversation", "queue unblocked, ready for next pass", "deferred to next /faff-beep-boop", "single-conversation context budget" are all banned summaries — they describe a run that bailed on the build pass after doing the analysis. If conflict analysis surfaced a non-empty build queue, the build pass **must** be entered; the run is not complete until the queue drains, every remaining issue is in one of the three valid park categories, or the harness terminates the session externally. Compaction mid-build is a resume from `.faff/runs/<run-id>/`, not a reason to stop short.
- **User-set budgets are the one legitimate stop-short.** If `--until HH:MM` or `--max N` fires, the run stops with any unreached build-queue issues reported under `## Unreached (budget hit)` in the summary, and the `Stop reason` line names the flag that fired. This is **not** a deferral by the orchestrator — the user chose the budget. Unreached issues are not parked; they stay in Todo with their specs, ready for the next run or human attention. See `## Budget flags` for full mechanics.
- **Always wave-loops until queue stability.** The build phase is wave-based — after each wave's queue drains, the orchestrator re-assembles to pick up work unlocked by issues that just shipped. The run ends only when a wave assembles to an empty build queue. Termination is by emptiness; there is no iteration cap.
- **Never parks chained issues for being chained.** Issue A depending on in-queue issue B is a collision group, not a park pair. If the whole queue is one serialised chain, build it as one serialised chain.
- **Mid-run compaction is a resume, not a park.** If the session compacts during a build, the next turn reads `.faff/runs/<run-id>/` + the PR state and continues where it left off. See the gateway's Autonomous Mode Contract for the full rule on forbidden park reasons.
- **Post-merge housekeeping never halts the queue.** Branch delete, worktree remove, shell return-to-main, tracker bumps, label cleanup — if any of them fails, skip it, log it, accumulate it under _Human follow-ups_ in the run summary, and proceed to the next issue. Never prompt for confirmation. See the gateway's Autonomous Mode Contract for the principle.
- **Always leaves a complete audit trail** under `.faff/runs/<run-id>/`.
- **Always tags parked issues** so `/faff-wtf` surfaces them next morning.
- **Build-queue admission is verdict-gated.** Only `fire-and-forget` and `likely-fire` verdicts enter the build queue. Other verdicts route out with a per-issue reason in the run summary's "Routed out" section. This is the same content `/faff-wtf` surfaces in the morning brief — no work is silently dropped.
- **Resolve-attempt before park.** Per the gateway → **Autonomous Mode Contract → Resolve-attempt before park**, `needs-decision-first` / `gap-blocked` / `circular-blocked` issues get one bounded inference attempt to derive an answer from local context before parking. Successes proceed with a tracker-comment audit trail; failures park. `repeat-parked` gets no resolve-attempt — the pattern is the signal.
- **Autonomous WIP is unbounded.** The WIP cap (if the methodology defines one) is human-flow-only. `/faff-beep-boop` is **never** gated on a WIP cap — the whole point of automating is to remove human-flow constraints from machine throughput. PRs awaiting human review are queued for human attention but do not count against any cap inside beep-boop. Admission stays governed by the verdict gate.

## Notes

- Beep-boop is best run when you expect to be away (overnight, during meetings, over a weekend). Results are on the tracker and in `.faff/runs/…`.
- For a quick list of what happened, run `/faff-wtf` — it reads the latest run summary and surfaces parked issues automatically.
- If you want to try beep-boop on a known-good narrow set before trusting it with the whole backlog, use explicit-list mode: `/faff-beep-boop ISSUE-12 ISSUE-15 ISSUE-17`.
- Running over SSH? A dropped connection or a closed laptop lid kills an in-flight run — launch `claude` inside `tmux` (or `mosh` + `tmux` for flaky links) so it survives. See [Running over SSH](../../../docs/unattended.md#running-over-ssh).
