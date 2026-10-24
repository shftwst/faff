# Repository review: throughput, the slot cull, and the faff / SuperDomestique split

> Dated review at `a0e443e8a428` (main, 2026-10-22). Written to be worked from: each finding carries a proposed action and a checkbox. Status marks are the reviewer's at the pinned commit; re-check before acting on any number.

This is a point-in-time review, not continuous enforcement. It answers four questions the maintainer asked: where is the delivery time going, what in the repository should not be there, how does the work line up against the v5 direction, and whether to cull the slot residents and split the product. Counts come from `git`, `grep`, `wc`, the run directories under `.faff/runs/`, and the Linear FAFF team on the review date.

## Summary

1. The repository is not short of engineering. It is short of throughput. Three things eat it: the orchestration skills are prose an LLM re-interprets every run; the tool files its own defects faster than it closes them; and six of the seven v5 evidence gates have never been sat, so evidence cannot replace prose.
2. Cull the slot residents by collapsing the noon/dark vocabulary, not by deleting folders. Make the dark set the default, fold the three noon dependencies into their dark skill, give the adversarial skills a graceful degrade, and shrink the configurable surface from 17 slots to 5.
3. Do not fork. The repository has been public since April 2026. "Go public" means position and promote. Keep one implementation, tag the seam so it is measurable, make governance opt-in on the public path, and publish two artifacts from one repository at Gate 2, exactly as the v5 technical design already says.
4. The single largest acceleration lever is converting about 1,425 lines of deterministic sequencing and prose-implemented rules in `faff-beep-boop`, `faff-graft` and `faff-prep` into composer CLI commands. Three collapses remove about 550 of those lines and three of the five orchestrator defects the last run logged.

## Part 1: where the time goes

### 1.1 One run, measured

Run `run-20261020-191739-beepboop-list-d57076`: FAFF-1355 and FAFF-1356, both small, both shipped green.

| Phase | Wall clock | Note |
|---|---|---|
| Prep, two specs, five review rounds | 26 min | Healthy |
| FAFF-1356 build | 3 h 26 min | 2 h 8 min with no progress event before the sentry tripped (`stall_window_secs` is 7200) |
| FAFF-1355 build | 1 h 38 min | Started after 1356 finished |
| Whole run | 5 h 45 min | 240M tokens: 238M cache reads, 2M cache writes, 0.48M output |

The two builds were serialised because both specs touch `plugin/skills/faff/bin/lib/gates.js` (`conflict-analysis.md`, heuristic 1). Earlier runs show the same shape: 2 h to 6 h 35 min per run for one to three tickets (`.faff/runs/run-2026*beepboop*/summary.md`).

### 1.2 Why builds serialise: the god files

Eight files in `bin/lib` exceed 2,000 lines: `config.js` 3,881, `contract-defs.js` 3,725, `merge-gate.js` 3,184, `gates.js` 2,405, `events.js` 2,326, `lights-out.js` 2,266, `bundle.js` 2,197, `sentry.js` 2,009. Almost any two tickets touch one of them, so conflict analysis puts them in one serial group and the parallel executor runs one lane at a time.

- [x] **Action:** split `config.js`, `gates.js` and `merge-gate.js` along their existing section banners before any other refactor. Measure the effect as the share of beep-boop waves with more than one concurrent lane.
  - **Split shipped 2026-10-23 (FAFF-1389, FAFF-1390, FAFF-1391; #1109 to #1111).** Each file is now a facade that re-exports every name it exported before, over modules that require each other directly. Function bodies moved unchanged.

    | File | Before | Facade | Modules | Largest module |
    |---|---|---|---|---|
    | `config.js` | 3,881 | 392 | 6 | 925 |
    | `gates.js` | 2,551 | 36 | 7 | 745 |
    | `merge-gate.js` | 3,184 | 339 | 8 | 905 |

  - **Not along banners for `config.js`.** It had one real banner, so its cuts follow cohesion.
  - **One banner was wrong.** The FAFF-848 banner in `gates.js` said `gates run` never touches the reporting path; that has been false since FAFF-849. The banner now states what still holds, and the require graph enforces it.
  - **Guards that named a module exactly** (`governor-admin`, `commissaire-trust`, `commissaire-standalone`, and the source-reading `merge-gate` tests) now cover the new `config-*` and `merge-gate-*` modules too.
  - **Measurement pending.** The share of beep-boop waves with more than one concurrent lane needs runs on the split tree; none had run when this was ticked.

### 1.3 The gate is slow and runs many times per build

- 416 test files; 218 spawn child processes; 1,656 spawn call sites; 77 run `git init`; 11 touch docker.
- Local gate about 11 minutes (an overestimate; see the corrected action below). Since FAFF-1356 only `floor(shards/4)` shards run at once because one `sentry-poller` timing test fails under load.
- FAFF-1356's build ran the gate seven times for its measurement procedure alone.

- [x] **Action:** move the timing-sensitive and docker tests into a serial lane and run the rest at full width. Expected 2 to 3x on the local gate. **Corrected 2026-10-23 (FAFF-1382):** the premise was wrong.
  - **The gate was not 11 minutes.** Measured in a clean worktree of `main` on the 8-core host, the gate took 286 s and UNIT 242 s, the same on two runs.
  - **The cost was CLI startup, not scheduling.** `bin/faff` loaded all 151 modules on every spawn, 230 to 290 ms against about 60 ms for one module, and the tests spawn the CLI thousands of times.
  - **The load failures came from layered concurrency:** shards, each running Node's own pool of files.
  - **What shipped:**
    - Lazy module loading in `bin/faff`, which took UNIT from 242 s to 159 s.
    - A gate-owned pool running one file per process, as wide as the core count, with only `sentry-poller` in the serial lane. That took UNIT to 138 to 148 s and the gate to 180 to 189 s.
    - Together, about 40% off UNIT, not 2 to 3x.
- [x] **Action:** add an in-process mode for `runCli` in the spawn-heavy tests (`judge-trail`, `merge-gate-controlflow`, `adversarial-call`), calling the exported `cmd*` handlers instead of a fresh Node process. **Superseded 2026-10-23 (FAFF-1383):** not done as written.
  - **Spawn cost is no longer the large term.** After lazy loading, a CLI spawn costs about 65 ms. Timed one file at a time on `main`, the suite is 930 s of CPU, and the three files named here are not in the slowest 15.
  - **The large terms were inside the commands:**
    - `validate-adapters` took about 1 s on any input, because the gateway-manifest planner re-normalised every skill's text once per block.
    - `hooks-ensure` probed every hook subcommand twice.
    - The `project-next` grid spawned the CLI 320 times to check a pure predicate.
  - **What shipped:** a fix for each of those three. On the same filesystem, UNIT went from 136 to 149 s to 106 to 107 s and the gate from 177 to 191 s to 147 to 148 s.
  - **Left alone:** `sentry.test.mjs` drives the real CLI on purpose; moving it in-process would save about 1 s of wall-clock time. `env.test.mjs` is real Docker work.
- [ ] **Action:** `faff gates run --budget-secs N --resume` with the exit-3 re-invoke idiom the spec judge already uses, so a lane can poll a long gate across foreground calls. This is orchestrator defect 3 from the last run.

### 1.4 The orchestrator is prose

Line classification of the three orchestration skills (approximate; A = deterministic sequencing, B = judgement, C = prose-implemented rules, D = explanation):

| File | Lines | A | B | C | D |
|---|---|---|---|---|---|
| `faff-beep-boop/SKILL.md` | 777 | 28% | 5% | 39% | 28% |
| `faff-graft/SKILL.md` | 957 | 45% | 6% | 18% | 25% |
| `faff-prep/SKILL.md` | 622 | 28% | 13% | 22% | 33% |

Judgement is 5 to 13 percent of each file. About 1,425 lines of A plus C are re-read into context on every turn (the 238M cache-read tokens above) and re-interpreted on every run. `SKILL_LINE_BASELINE` in `validate-adapters.js` is at zero headroom for all three files, so a clarifying sentence fails CI.

Of the five orchestrator defects recorded in `.faff/runs/run-20261020-191739-beepboop-list-d57076/orchestrator/discovered-scope.json`:

| Defect | Lives in | Prevented by a composer command? |
|---|---|---|
| `collate-evidence` rejects the disposition prep tells you to pass | prose (prep line 277) | yes, `collate-evidence --from-judge` |
| `faff events validate --run` hangs on an open stdin | code | no, needs a code fix |
| Build lane stalls when `gates run` outlasts the 10-minute tool cap | code gap (no chunk mode) | yes, `gates run --budget-secs --resume` |
| A paraphrased spec was committed | prose (graft 245 to 248) | yes, `faff spec commit` |
| A CI-only acceptance criterion forces a second anchor | code/design (`ac-checklist` kinds) | no, needs a `ci-at-merge` kind |

The ten largest A plus C collapses, ranked by prose removed:

| # | Command | Replaces | Lines | New code needed |
|---|---|---|---|---|
| 1 | `faff land --pr --issue --run-dir --level` | graft Step 10 landing loop, fix cycle, ADR/PRDR guard, custody stamp, Commissaire merge half, post-merge tail (graft 610 to 827, 886 to 895) | ~215 | the observe/switch/budget state machine; `run_fix_cycle` stays agent-side behind a `needs-fix` exit token |
| 2 | `faff run summary --run-dir` | beep-boop Reporting template (581 to 730) | ~150 | a renderer for the template and its "rendered only when" rules |
| 3 | `faff checkpoint --run-dir` | beep-boop budget, effects, reconcile-merges, sentry, events, andon sequence (83 to 127, 267, 737) | ~45 | composer; the attendedness × intervention acting table becomes code |
| 4 | `faff run open` / `faff run close` | beep-boop ledger mint, poller, baseline, admit, close sequence (392 to 451) | ~45 | composer; the governance fail-closed path becomes a tested branch |
| 5 | `faff worktree ensure --issue --run-dir` | graft Step 3 (157 to 235) | ~79 | composer returning `{wt, mode, cause}` |
| 6 | `faff graft admit --issue` | graft Step 2 gate chain (73 to 141) | ~60 | one disposition enum |
| 7 | `faff pr open --run-dir --issue` | graft Step 9b (540 to 592) | ~53 | composer; tracker transition stays an emitted descriptor |
| 8 | `faff prep attach --issue --spec --mode` | prep stamp, tier, marker, validate (55 to 110, attach sites) | ~70 | marker write, stamp insertion, re-stamp rule |
| 9 | `faff spec-review round` / `hold` | prep round write, convergence, outage rules (122 to 130, 208 to 210, 233 to 298) | ~90 | round write-then-pipe order and hold-file counters |
| 10 | `faff run-start assemble` | beep-boop run-start trigger (139 to 163) | ~26 | signal assembler |

- [x] **Action, first:** `faff land`. It is the one place a prose misstep reaches `main`, and the `concurrency` executors must call the same command so the dispatch-cut path cannot drift. Done 2026-10-24: FAFF-1396 (#1119), first used live on FAFF-1112 (#1120), where it returned `ready` on its first call.
- [ ] **Action, second:** the run lifecycle trio (`run open/close`, `checkpoint`, `run summary`). Almost all pure reads of the run directory.
- [ ] **Action, third:** `prep attach`, `spec commit`, `collate-evidence --from-judge`. Under 300 lines of code; closes two of the five logged defects and the twice-recurring silent non-attach that `prepcheck` exists for.
- [ ] Each collapse lowers the matching `SKILL_LINE_BASELINE` entry and keeps or relocates the `ANCHOR_PHRASES` sentences, or `validate-adapters` reports RATCHET and the gain is not locked in.
- [ ] Each command exits with a typed `needs-judgement` token where B work remains, rather than absorbing an LLM call.

This does not pre-empt v5 Gate 1. These are sequencing mechanics, not kernel decisions (`next`, `run-done`, `queue-state` already exist in code). Composed commands would also emit the action markers the coordination-fidelity study is missing on 52 of 58 decisions, so prose collapse is the enabler of the coordination evidence, not a substitute for it.

### 1.5 The backlog grows faster than it drains

Linear FAFF team on 2026-10-22:

| Measure | Value |
|---|---|
| Open issues (Backlog, Todo, In Progress) | about 265 |
| Created in the last 30 days | more than 250, about half closed |
| Open with no project | 134 |
| Open with no priority | 146 |
| Open on `faff-automation-hold` | 58 |
| Creator | one account for every issue |

The 80 most recently created titles are almost all faff fixing faff (anchor mint, punt-scan, config check, holdout cage, evaluator posture). Each shipped ticket files two to four follow-ups through discovered scope.

- [x] **Action:** discovered scope below High becomes a comment on the parent, not a ticket. **Declined 2026-10-24 (maintainer):** a comment on a closed parent hides discovered scope. Every concrete item stays a ticket; set a priority at filing instead, so the backlog is triageable rather than smaller.
- [ ] **Action:** one triage pass over the 134 project-less issues: project, priority, or close.
- [x] **Action:** cancel P-FAFF-73 (capability/role model replaces slots, 8 issues) and P-FAFF-74 (grounding slot, 3 issues). Both are platform construction the v5 master defers until Gate 1. Done 2026-10-22: both projects and all 11 issues cancelled.

### 1.6 Commit mix since 2026-09-22

170 non-merge commits, one author. Rough buckets by subject and touched paths:

| Stream | Share | Examples |
|---|---|---|
| v5 critical path (governor, TypeScript emit, facade v0.3, map refresh) | ~25% | `ea720f84`, `7c80247d`, `475c0362`, `a0b895a4`, `ba76839f` |
| Spec-review and build-review adjudication (not in the v5 pack) | ~22% | `78950b15`, `cb1a9f15`, `3501de7f`, `def57470`, `a84dedbe` |
| Orchestrator and prose-skill defects, config, onboarding | ~20% | `2084139b`, `3861159c`, `583e632d`, `87417f60`, `f9c5b7f4` |
| Releases, eval baselines, test flakiness | ~14% | `1875adc7`, `64720be6`, `cff71c3c`, `49eb6dac`, `545edc94` |
| Evidence-schema hardening | ~10% | `2695d5af`, `b76edaa3`, `d506fed1` |
| Software Delivery binding (holdout, DoD) | ~9% | `05a42d50`, `d335b1f1`, `a0e443e8` |

About a third of the effort moved the strategy. The largest single stream is unplanned.

## Part 2: v5 against the repository

### 2.1 Phase status

| Phase or slice | Status | Evidence |
|---|---|---|
| 0A harden and recover | shipped | FAFF-823 accepted 2026-08-30 |
| 0B outward evidence baseline | built, gate FAFF-824 not sat | blockers FAFF-740 and FAFF-588 merged; no commit references 824 |
| 1 state-authority map | shipped, refreshed | FAFF-825, FAFF-1162 |
| 1 cutover slice: declared effects | shipped | ADR-0122 |
| 1 coordination-fidelity study | stalled | 6 of 58 replayable decisions graded; 52 lack an action marker; FAFF-1174 and FAFF-974 unstarted |
| 1 acceptance gate FAFF-827 | not sat | |
| 2A facade and noun-verb grammar | shipped | ADR-0123, standalone `commissaire` binary |
| 2A envelope, producer auth, E-B merge gate, out-of-process governor | shipped, deeper than planned | ADRs 0135 to 0137; facade v0.3 |
| 2A contract admission: obligations, independence, waivers | not started | admission checks scope only |
| 2A second producer (FAFF-1030) | parked | |
| 2A gate FAFF-829 | not sat | |
| 2B one-shot comparison (FAFF-830/831) | not started; now unblocked by the governor | |
| Gate 1 (FAFF-832) and everything after | not started | |
| TypeScript track | 12 `.ts` of about 165 lib files, all Commissaire | ADR-0132; no factory conversion scheduled |

`ADDENDUM-1-v5.md` has read "draft, not yet accepted" since 2026-09-27 while decisions 1, 3 and 6 were acted on.

### 2.2 Strategic holes

1. **Gate debt.** The master is evidence-gated, and six of seven gates have no evidence sat against them. The facade keeps deepening with one producer, while the master says a protocol stabilises only after two real producers use it.
2. **The coordination question is starved while prose drives the defect rate.** About 47 orchestrator-touching fixes landed in the window; the fidelity study cannot answer Gate 1 because the markers were never captured. See 1.4.
3. **v5 is silent where the repository is loudest.** Review adjudication is the largest code stream and is exactly the independence evidence Commissaire should consume, yet the merge floor's review evidence is still self-declared (J-D). Harness support is a closed two-entry list in `harness.js`. Distribution is one plugin containing both products.
4. **Two languages by default.** All TypeScript is Commissaire. No ADR says whether factory modules convert.

### 2.3 Critical path

- [x] **One human gate day.** Sit FAFF-824 and FAFF-827; accept ADDENDUM-1 and settle its decision 2. Done 2026-10-23: both narrowed, decision 2 (a), ADDENDUM-1 accepted; see [the gate session record](2026-10-22-v5-gate-session-824-827.md).
- [ ] **Freeze governance depth** (no facade v0.4, FAFF-1282) until FAFF-1030, the live capture with an outside producer, has run.
- [ ] **Collapse the prose** per 1.4, which emits the fidelity markers.
- [ ] **FAFF-1174 then FAFF-974:** the post-fix fidelity corpus.
- [ ] **FAFF-830/831:** the one-shot comparison, now unblocked.
- [ ] **Admit `review-verdict` as a producer-signed fact** and add obligations and independence to `contract admit`, so Gate 1 has a real qualifying event and the adjudication stream points at v5.
- [ ] **FAFF-832, Gate 1.**
- [ ] **ADR on TypeScript scope:** governance only, or a conversion queue starting with the files the Commissaire closure requires.

## Part 3: the slot cull

### 3.1 Inventory

22 slot residents: 14 `faffter-noon-*`, 6 `faffter-dark-*`, 2 `faffidavit-*`. Registry defaults live in `DEFAULTS` at `bin/lib/config.js` lines 72 to 92; the kernel's slots table is at `plugin/skills/faff/references/kernel.md` lines 105 to 150.

Facts that change the decision:

- Every slot resolves to a default, so unset slots still run `faffter-noon-adr`, `-ship`, `-intake`, `-prd`, `-evaluate`, `-env-code-interface` and `-transport-private-network` in this repository today. "Never use" mostly means "never chose".
- Three dark skills depend on the noon skill for the same slot: `faffter-dark-adversarial-review/SKILL.md` lines 27 to 29 hand phase 1 to `faffter-noon-review`; `faffter-dark-nlspec/SKILL.md` line 234 runs `faffter-noon-spec`'s self-review; `faffter-dark-methodology-agile-delivery/SKILL.md` lines 36 and 51 build on thematic's `crank-up-set` and `prdr-author`.
- Only `faffter-noon-spec-review` and `faffter-noon-concurrency-sequential` are deletable as they stand, and both need the registry default moved.
- `lights-out.js` lines 248 to 249 hard-code the dark review and spec-review occupants, so L4 is unaffected by any of this.
- With no second-provider backend configured, `faffter-dark-spec-review` resolves every lens to needs-human and `faffter-dark-adversarial-review` produces no signal. A subscription-only adopter who copies this repository's config gets nothing from either.
- Deleting a folder is not caught by `validate-adapters` (it only lints folders that exist); a missing default surfaces at runtime.
- Tests and eval anchors read many `SKILL.md` files by path (`eval/cli-driver.mjs`, `test/eval-cli-driver.test.mjs` lines 872 to 907), so renames are mechanical but non-trivial.

| Skill | Slot | Default | Judgement |
|---|---|---|---|
| faffidavit-rendering | rendering_adaptor | yes | keep, rename |
| faffidavit-routing | routing_adaptor | yes | keep, rename |
| faffter-dark-adversarial-review | review | no | make default; absorb noon-review |
| faffter-dark-authoring-adaptors | none | n/a | keep only while foreign occupants are supported |
| faffter-dark-concurrency-parallel | concurrency | no | make default; `concurrency_max=1` replaces the sequential skill |
| faffter-dark-methodology-agile-delivery | methodology | no | make default; absorb thematic's shared parts |
| faffter-dark-nlspec | spec | no | make default; absorb noon-spec's self-review |
| faffter-dark-spec-review | spec_review | no | make default; add single-pass degrade |
| faffter-noon-adr | adr | yes | internalise (not a slot) |
| faffter-noon-architecture | architecture | yes | internalise |
| faffter-noon-concurrency-sequential | concurrency | yes | delete after default moves |
| faffter-noon-env-code-interface | env-code-interface | yes | internalise under env |
| faffter-noon-env-compose | env | yes | internalise |
| faffter-noon-evaluate | evaluator | yes | internalise |
| faffter-noon-intake | intake | yes | internalise (stalest, 2026-06-29) |
| faffter-noon-methodology-thematic | methodology | yes | fold into agile, then delete |
| faffter-noon-prd | prd | yes | internalise |
| faffter-noon-review | review | yes | fold into adversarial, then delete |
| faffter-noon-ship | ship | yes | internalise |
| faffter-noon-spec | spec | yes | fold into nlspec, then delete |
| faffter-noon-spec-review | spec_review | yes | delete after degrade exists |
| faffter-noon-transport-private-network | transport | yes | internalise under env |

### 3.2 Decision

Cull by collapsing the vocabulary, not by deleting folders.

- [ ] Make the dark set the registry default for `spec`, `spec_review`, `review`, `methodology`, `concurrency`.
- [ ] Fold `faffter-noon-review`, `faffter-noon-spec`'s self-review and thematic's shared parts into their dark skill as sections; delete the noon folders.
- [ ] Give `faffter-dark-spec-review` and `faffter-dark-adversarial-review` a graceful degrade: no backend configured means single-pass on the session model, loudly labelled in the verdict. This retires `faffter-noon-spec-review`.
- [ ] `concurrency_max: 1` replaces `faffter-noon-concurrency-sequential`.
- [ ] Shrink the configurable surface from 17 slots to 5 (`spec`, `spec_review`, `review`, `methodology`, `concurrency`). The rest become internal steps until a second user asks to swap one.
- [ ] Rename the `faffter-noon`, `faffter-dark` and `faffidavit` prefixes to plain names (spec, spec-review, review, methodology-agile, concurrency, rendering, routing). Update the eval anchors and the `REGISTRY` in `validate-adapters.js` lines 16 to 36.
- [x] Cancel P-FAFF-73 and P-FAFF-74. Done 2026-10-22 (see 1.5).

## Part 4: the split

### 4.1 Facts

- `shftwst/faff` has been public since 2026-04-16 under Apache-2.0 (ADR-0105), 3 stars, 0 forks, releases through v0.42.0. "Go public" means position and promote.
- `regions.js` enforces governance (31 modules) never requiring factory (117), with 3 shared-infra and 1 shell. The rule is clean and CI-enforced, but `commissaire*`, `governor*`, `integrity-digest`, `bundle*`, `judge-trail`, `merge-gate`, `governance-check` and `lights-out` are all **factory**. The regions boundary is a purity boundary inside Commissaire, not the product boundary.
- The `commissaire` binary's static closure is 34 modules (21 governance, 10 factory, 3 shared-infra), standalone-asserted by `test/commissaire-standalone.test.mjs`. Zero modules are commissaire-only; all 34 are also in `faff`'s 158-module closure. About 100 factory modules import the flight-recorder cores (`events`, `heartbeat`, `runcheck`, `sentry`, `budget`, `evidence`, `effects`) in-process.
- `merge-gate.js` requires `commissaire-trust`, `commissaire-verify`, `effects`, `events`, `integrity-digest`, `corrective-integrity`, `container-check`, `sentry`, `redact` at load.
- `faff-graft/SKILL.md` runs `commissaire contract status` on every lane (line 160) and parks on a malformed answer; it calls seven `commissaire` verbs across lines 160 to 165, 562 to 564 and 652 to 655. `faff-beep-boop/SKILL.md` lines 442 to 448 admit the run and close it through `effect reconcile`, `verdict conclude`, `judge-trail mint`.
- 138 `faff` subcommands; 109 are referenced by some `SKILL.md` or reference; 29 by none. 19 are used only by beep-boop or L4.
- Tests: 339 `*.test.*` files; 20 governance-only, 83 factory-only, 29 mixed, 207 spawn the CLI and exercise both.
- Tracked size about 45 MB: `records/` 22 MB (884 specs), `plugin/` 8 MB, `test/` 6 MB, `.faff/anchors` 5 MB (2,915 committed files), `eval/` 3 MB, `verification/` 2.5 MB.
- TECHNICAL-DESIGN-v5 line 828: "The preferred migration is a compatibility facade over one implementation. A separate classic package or maintained release line is a fallback only if Gate 2 approves an incompatible package split. A repository fork is avoided because it duplicates fixes, schemas, and governance rules."

### 4.2 Decision

One repository, one implementation, two published artifacts at Gate 2. Positioning and documentation split now.

- [ ] Add an `owner: software-delivery | commissaire` tag to each `REGION_MAP` entry in `regions.js`, and a lint that software-delivery modules import governance cores only through a named allowlist. The lint output is the seam map.
- [ ] Relabel the ten factory-region Commissaire files (`commissaire*`, `governor*`, `integrity-digest`, `bundle-seal-core`, `corrective-integrity`, `container-check`, `peer-cred`) once their `loadConfig` and `deriveAnchorDirs` references are factored out.
- [ ] Make governance opt-in on the public path: no `commissaire` on PATH means ungoverned, labelled, continue. Today an L2 graft parks when `contract status` is malformed.
- [ ] Separate the lab notebook from the product in the reader's eye: README and docs route to `records/`, `verification/` and `.faff/anchors`, but the front door is the plugin. Consider whether anchors need to live in this repository's history or in a dedicated evidence store; today they grow at 80 to 180 files a month.
- [ ] Rewrite the front door as two audiences: "faff, the AI delivery lifecycle plugin" and "SuperDomestique / Commissaire, the governance runtime it can plug into". Keep the formal naming rule in `positioning-and-language.md`.
- [ ] Decide the package split at Gate 2, not before.

### 4.3 Public-readiness blockers for the skills plugin

In priority order. Items 1 to 7 are about a weekend; the rest is writing and renaming.

1. [ ] Document the tracker MCP install and `gh auth` as prerequisites in README and `/faff-onboard`; both fail silently today.
2. [ ] `hooks-ensure` defaults to writing six Stop hooks into the committable `.claude/settings.json`; default to `settings.local.json` or ask first.
3. [ ] Replace `shftwst/faff` and the `SHF (Shftwst)` example in `faff-onboard/SKILL.md` and `references/kernel.md` with placeholders.
4. [ ] Add an `engines` floor; make `faff doctor` check Node, `gh` and tracker-pin reachability; guard `faff sync` for plugin installs (it needs a source checkout).
5. [ ] Keep the maintainer's `.faff/config.yaml` out of the public tree (it names a Linear team, tailnet hosts and eight backends) and ship a `config.example.yaml` that runs on a Claude subscription alone.
6. [ ] State per dark slot which need a non-Claude API key, and fail with that message rather than "needs-human".
7. [ ] Pick one config name; purge `.faffrc.yaml` from `config.js` comments, two skills, four docs and AGENTS.md.
8. [ ] A GitHub Issues walkthrough, or label GitHub and Jira "untested": tracker.md has no adapter layer, and Linear's MCP verbs are the generic vocabulary (`save_issue` 14, `save_comment` 6, `get_issue` 5).
9. [ ] Glossary rows for the 13 coined terms with none (jot, plot, wtf, beep-boop, faffter, faffidavit, andon, custody, anchor, affidavit, lights-out, dryness, convergence).
10. [ ] Strip or index the 4,821 `FAFF-NNN` breadcrumbs in `bin` comments.
11. [ ] Neutralise the tailnet hostname (11 sites across plugin and docs) and the fixture paths in `budget.js`, `self-intake.js`, `run-outward.js`.
12. [ ] Eyeball `records/spikes/2026-10-06-faff-1109/` transcripts for credentials; the secret-pattern scan found only selftest fixtures elsewhere.

## Part 5: hygiene

### 5.1 Delete or ignore

- [x] `build-req.err`, `resolve.stderr` (both empty), `eval-55.log`, `scratch-specs/` (empty), `docs/specs/2026-10-03-FAFF-1168-emitted-js-layout-spike-design.md.tmp`. Removed from the working tree; none was tracked.
- [x] The 760 KB `pyyaml-*.whl` at the root: untracked and not ignored. Removed; `*.whl` and `*.tmp` are now in `.gitignore`.
- [x] Gitignore `eval/baselines/opus-5-5.json`; keep the dated `-reference-` snapshot committed.
- [ ] Locally: `evidence/` (20 MB, ignored) and `.faff/.backup-fly-2026-09-02`, `.faff/fable-week`, `.faff/prep-scratch` (378 MB total under `.faff/`).

### 5.2 Misplaced

- [x] Three tracked specs in `docs/specs/` (FAFF-474, 438, 941) exist nowhere else; moved to `records/specs/`. The `docs/specs` default in `config.example.yaml` and `faff-tidy/SKILL.md` is the adopter default per `docs/README.md` and stays.
- [ ] `docs/decisions.md` is hard-coded in `decisions.js` line 63 and is the only record left under `docs/`; move behind a config key or document the exception.
- [ ] Archive `docs/rfc/rfc-superdomestique-runtime/{v2,v3,v4}/`, critiques 1 to 5 and both carry-forward documents (untouched since 2026-08-16) under `archive/`, updating the v5 links.

### 5.3 CLI surface debt

- 138 `faff` subcommands plus 19 `commissaire`; 29 unreferenced by any skill.
- 15 commands named `*check`; `runcheck`, `inflightcheck` and `prepcheck` each define their own stale window.
- 13 spec-review knobs as separate commands (`spec-review-churn`, `-convergence`, `-window`, `-pin`, `-reputation`, `-lenses`, `-iteration-cap`, `-dir`, plus the build-review set).
- Pairs: `label`/`labels`, `profile`/`profiles`, `merge-fence`/`merge-gate`, `next`/`project-next`; four reconcile/recover variants.
- `landing-claim` and `landing-comment` have zero test references.
- 400 exports across the 20 largest modules are referenced nowhere outside their own file; three look truly dead (`contract-defs.CAPABILITY_READS`, `evidence.resetEvidenceSchemaCache`, `conventions.CONVENTIONS_SURFACE`).
- 126 modules carry a `--selftest` block run by `regions selftest`: a second test system inside production code. The local exclusion in `.faff/config.yaml` cites FAFF-561 "until it clears"; FAFF-561 is Done.
- Duplicated helpers: `resolveRunDir` defined three times (`shared-infra.js` 589, `runcheck.js` 148, `sentry-poller.js` 360); six differently named JSON-read helpers; 49 inline `JSON.parse(readFileSync)` sites; 18 separate atomic-write implementations.

- [ ] Fold the spec-review knobs into `faff spec-review <verb>`.
- [x] Re-checked the `regions selftest` exclusion: `--region all` passes on a dirty `.faff/` (138 members, about 53 s). Kept the exclusion for gate speed, since CI runs both regions, and corrected its stated reason in `.faff/config.yaml`.
- [ ] Move the run-dir, JSON-state and staleness helpers into `shared-infra.js`.
- [ ] Decide `landing-claim` / `landing-comment`: test or remove.

### 5.4 Docs

- [x] README line 3: "autonymous".
- [ ] Six guide pages never say SuperDomestique: skills, configuration, governance-check, walkthroughs, verify-run-evidence, adopting-by-change-class.
- [ ] `job-surface-probe.yml` is dispatch-only FAFF-654 tooling; archive if that work is finished.
- [ ] `eval/cases-seeded/` is 450 generated files with a generator; decide committed or regenerated.

## Method and limits

Seven read-only passes: slot inventory, hygiene, code health, v5 progress, split seam, public readiness, prose classification. Percentages for line classes and commit buckets are approximate. Token totals come from `faff economics` on the last run with `reconciles=false`, so cost is not stated. Linear counts were taken on 2026-10-22 and will drift. No file was changed by the review.
