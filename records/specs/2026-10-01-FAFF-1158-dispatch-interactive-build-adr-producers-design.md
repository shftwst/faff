# FAFF-1158 — Dispatch the interactive-path build and ADR producers as subagents so their configured model applies

> Spec: faffter-dark-nlspec · 2026-10-01 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1158.

This spec is for the build agent implementing FAFF-1158, and for the human reviewers of that change. It makes the per-lane model/effort routing that faff already resolves actually bite on the interactive graft path, by re-shaping two generative producers (the Step 7 build and the Step 4b ADR-body author) from inline in-session invocations into subagent dispatches carrying a resolved model. It also adds the one missing config key (`models.adr`) the ADR lane needs.

## 1. WHY — Problem and Principles

**The load-bearing model.** A `models.<lane>` / `effort.<lane>` config value can only change the model a step runs on when that step is dispatched as a subagent (the Agent tool's `model` parameter) or an out-of-session helper. A slot invoked inline via the Skill tool runs in the orchestrator's own session and inherits the session model, so no `models:` key can touch it (kernel.md:162). Two generative producers on the interactive graft path run inline today, so their configured model is silently inert.

**Problem statement.** `models.build` / `models.build_by_confidence` / `models.build_by_tier` and `effort.build*` are honoured only by the autonomous concurrency executors, which resolve the model and pass it as the `model` param when they dispatch a build subagent; interactive top-level graft builds inline at Step 7 and the ADR body is authored inline at Step 4b, both at the operator's session model. An operator who sets `models.build_by_confidence.high = sonnet` sees it apply to overnight beep-boop runs but not to an interactive `/faff-graft`, and there is no `models.adr` lane at all. This change dispatches both producers as subagents at the resolved model when graft runs top-level, so the config applies on the interactive path too.

**Design principles.**

- **Byte-identical autonomous path.** On the beep-boop / concurrency path the model is already applied when the executor dispatches the whole graft subagent, so graft's inline Step 7 build already runs at the resolved model. The fix must change only the top-level case and leave the dispatched-subagent case exactly as today. The discriminator is single-level nesting: dispatch when graft is top-level, stay inline when graft is itself a dispatched subagent (double-nesting is forbidden, mirroring the spec/architecture producers' in-context fallback at kernel.md:339).
- **Reuse the existing resolver, add no routing logic.** The interactive orchestrator resolves the build model through the same `faff models build-for` / `faff effort build-for` CLIs the autonomous path uses, reading the `build-tier:` and `confidence:` lines already retained on the attached spec. No new tracker read, no new resolution path.
- **Fail-loud on a bad token.** A misconfigured model/effort token must fail loud at the CLI (exit 2 naming the legal set), never silently fall back to the session model (the FAFF-50 dropped-slot failure mode). `inherit` means omit the param.
- **Orchestrator keeps the gates, the human, and the ledger.** The dispatched build is a bare-executor (Implementor lane): task in, compact result out. The orchestrator retains AC verification, review, PR, merge, and all human interaction, and reconciles the return against on-disk artifacts and git ground truth, never the subagent transcript.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 7 (line 322) | Markdown prose | The build step that currently "still builds inline today"; the interactive dispatch seam goes here. |
| `plugin/skills/faff-graft/SKILL.md` Step 4b sub-step 2 (line 260) | Markdown prose | "Author the body via the `adr` slot" — the inline ADR-body invocation to re-shape into a Producer dispatch. |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` §2 (and the parallel sibling) | Markdown prose | The `BuildDispatch`-to-subagent pattern to mirror: resolved model as the `model` param, `inherit` omits it, foreground, never inline via Skill. |
| `plugin/skills/faff/references/build.md` lines 5–16 (Implementor lane) | Markdown prose | The bare-executor contract: task (spec + worktree + DoD + which gate) in, compact result (diff + terminal token + gate verdict) out, no faff-skill context. |
| `plugin/skills/faff/references/kernel.md` lines 162, 169, 337–339 | Markdown prose | The gateway seam: which producers take `models:` lanes, and the Producer dispatch transport + single-level-nesting rule. |
| `plugin/skills/faff/bin/lib/config.js` `MODEL_LANE_VOCAB` (346), `DEFAULTS` (192), `validateModelLane` (356), `config defaults --selftest` `expected`/vocab block (2700–2790), resolved-echo loop (2882) | JavaScript | Where `models.adr` is declared, validated, selftested, and surfaced — mirror the existing `models.spec` lane exactly. |
| `plugin/skills/faff/bin/lib/config.js` `resolveBuildModelForIssue` (3048), `cmdModels` (3060); `plugin/skills/faff/bin/lib/effort.js` `resolveBuildEffort` / `cmdEffort` | JavaScript | The pure resolvers the interactive orchestrator calls: `faff models build-for --tier <t> --confidence <c>`, `faff effort build-for --tier <t>`. Unchanged. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` `SKILL_LINE_BASELINE` (65), `KERNEL_LINE_BASELINE` (64) | JavaScript | The downward line-cap ratchet: `faff-graft` is pinned at 952, the kernel at 468. Any prose growth must bump the baseline by the exact net delta or validate-adapters FAILs "(line cap)". |

**Scope statement.** This sits at the graft build/ADR seam and the config model-lane registry; it changes how two producers are invoked on the top-level path and adds one config key, and touches nothing in the autonomous execution path's behaviour.

## 2. OUT OF SCOPE

- **`ship` (graft Step 10 — the governed merge).** The merge stays in-session. It is a governed, interlocked side effect, not a generative producer, and delegating it is a separate concern. Why excluded: operator non-goal on the ticket; the merge-gate interlock assumes the orchestrator's own session. Extension point: a future `models.ship` lane plus a ship-producer dispatch, if ever wanted, would live at Step 10 and `slots.ship`.
- **`review` (graft Step 9).** Already model-routed through the `adversarial.*` engine block; `models.review` is a deliberate no-op. Why excluded: review's model selection is owned by its own engine config, not the Agent-token lane set. Extension point: none needed; the routing already exists.
- **The six already-dispatched prep/jot producers** (`prep_explore`, `spec`, `spec_review`, `intake`, `methodology`, `architecture`). Why excluded: already re-shaped to subagents and already take `models:` lanes (kernel.md:162). Extension point: n/a, except the shared nesting limitation noted below.
- **An `effort.adr` lane.** The ADR body is small and fires rarely; an effort dial is unjustified, and the effort-lane set deliberately excludes the generative prep/spec-class producers (config.js EFFORT_LANE_VOCAB, HARD EXCLUSION comment at 208). Why excluded: no value for the cost; mirrors the spec/architecture lanes which also get a model lane but no effort lane. Extension point: `EFFORT_LANE_VOCAB` + `DEFAULTS["effort.adr"]`, if ever justified.
- **The general nested-model limitation across all producers.** When any orchestrator is itself a subagent, its producer sub-calls fall back in-context, so a nested producer's configured model does not apply nested (kernel.md:339 single-level nesting). This is pre-existing and intrinsic to single-level nesting; it is not introduced or widened by this change. Why excluded: architectural property of the whole dispatch model, not this seam. Extension point: a multi-level dispatch budget design, a separate ticket. See the **Punt** in DESIGN DECISION RATIONALE.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Top-level graft | A `/faff-graft` running in the operator's own session with no orchestrator above it: it minted its own L2 run substrate at Step 3 (no orchestrator pre-set `FAFF_RUN_DIR`). The live interactive case. |
| Dispatched graft | A graft running as a subagent dispatched by the `concurrency` executor (autonomous path); `FAFF_RUN_DIR` was pre-set by its orchestrator. |
| Bare-executor | A disposable subagent that takes only the task (spec + worktree + DoD + which gate) and returns a compact result (diff + terminal token + gate verdict), loading no faff-skill context (build.md:14). |
| Producer dispatch | The Agent-tool-subagent transport for a consume-and-resume slot whose output the orchestrator consumes then resumes after; resolves `models.<slot>` as the `model` param (kernel.md:337). |
| Retained spec fields | The `confidence:` and `build-tier:` lines faff-prep stamps on the attached spec; graft already holds them, so no tracker read is needed to resolve the build model. |

**The `models.adr` lane (new config key).** A simple scalar model lane, mirroring `models.spec` exactly:

```
models.adr : one of { "inherit", "sonnet", "opus", "haiku", "fable" }   # DEFAULT "inherit"
  # "inherit" => omit the Agent-tool model param (byte-for-byte today)
  # validated by validateModelLane at config get / set / init (fail-loud, exit 2)
  # NO models.adr engine:<name> value (not on the pure-data-in allowlist) — rejected at read
```

**The interactive build-dispatch payload (Step 7, top-level only).** Mirrors the concurrency executor's `BuildDispatch`, reduced to the bare-executor's task:

```
RECORD InteractiveBuildDispatch:
  issue        : IssueId
  run_dir      : Path          # the exact $run_dir graft minted at Step 3 — never latestRunDir
  session_id   : String
  spec         : the builder-view spec (DoD) the executor builds to
  worktree     : Path          # the provisioned worktree
  gate         : "Step 7.5 gate ladder"   # which gate the executor runs
  model        : ModelToken | OMITTED     # resolved; OMITTED when "inherit"
  effort       : EffortLevel | OMITTED     # resolved; OMITTED when "inherit"
  mode_signal  : "interactive"
```

The executor returns a **compact result**: the **uncommitted worktree diff** (`git diff` over the dirty worktree — it does NOT stage or commit), the Step-7.5 `faff-contract:quality-gates` verdict, and a `TerminalToken { issue, outcome, pr }` shape for the build (no PR yet at this stage — `outcome` reflects build/gate completion). The orchestrator reconciles against on-disk artifacts and git ground truth, not the transcript, then performs the selective staging + commit itself (see §4.1 — the secret-leak guard stays in the orchestrator).

**Resolver interfaces (unchanged CLIs, called by the interactive orchestrator).**

```
faff models build-for --tier <build-tier> --confidence <confidence>   # STDOUT: model token | "inherit"; exit 0 ok, 2 invalid/usage
faff effort build-for  --tier <build-tier>                            # STDOUT: effort level | "inherit"; exit 0 ok, 2 invalid/usage
faff config get models.adr                                           # STDOUT: resolved token ("inherit" default); exit 0 ok, 2 invalid
```

`<build-tier>` and `<confidence>` are read off the `build-tier:` and `confidence:` lines of the attached spec graft already holds.

## 4. HOW — Behaviour

### 4.1 The interactive build dispatch (Step 7)

**Summary.** When graft runs top-level, Step 7 resolves the build model and effort from the retained spec fields and dispatches the build as a bare-executor subagent at that model instead of building inline; when graft is itself a dispatched subagent, Step 7 stays inline exactly as today.

```
PROCEDURE step7_build(spec, worktree, run_dir, mode):
  # The discriminator is the CAPTURED Step-3 mint-vs-skip branch (did THIS graft mint its own run
  # substrate, or inherit a pre-set one?), threaded forward as state — NOT a bare `[ -n "$FAFF_RUN_DIR" ]`
  # re-test at Step 7, which is set in BOTH cases (top-level graft exports it at the Step-3 mint).
  1. IF graft is a dispatched subagent (it INHERITED a pre-set FAFF_RUN_DIR; Step 3 SKIPPED the mint):
       -> build INLINE, exactly as today.          # the resolved model already applied at the graft dispatch
                                                    # (single-level nesting — never double-nest)
       RETURN
  2. ELSE (top-level graft — Step 3 MINTED its own run substrate):
       a. tier := the spec's retained `build-tier:` line
          conf := the spec's retained `confidence:` line
       b. model  := `faff models build-for --tier <tier> --confidence <conf>`   # exit 2 => fail loud, do not build
          effort := `faff effort build-for --tier <tier>`                        # exit 2 => fail loud, do not build
       c. Dispatch a bare-executor subagent (Agent/Task tool, run_in_background: false where the
          harness supports foreground) with an InteractiveBuildDispatch:
            - model  resolved != "inherit"  -> pass as the Agent-tool `model` param;  "inherit" -> OMIT the param
            - effort resolved != "inherit"  -> pass as the dispatch's reasoning-effort arg; "inherit" -> OMIT it
            - NEVER run the build inline via the Skill tool on this branch.
       d. Block awaiting the compact result: the UNCOMMITTED worktree diff + the Step-7.5 gate verdict
          + terminal token. The executor implements and runs the gate ladder over the dirty worktree; it
          does NOT stage or commit.
       e. Reconcile the return against the worktree + git ground truth, then the ORCHESTRATOR performs
          the existing Step-7 selective staging (`git add -u` + each intended new file by explicit path,
          never `git add -A`) + `faff stage-guard --worktree . --mode assert` + commit — the PR #258
          secret-leak guard stays in the orchestrator's skill context, never delegated to the
          context-less executor. Continue to Step 8.
```

**What the dispatched executor owns, and what the orchestrator keeps.** The bare-executor owns the Step 7 implement plus the Step 7.5 engineering gate ladder (the `gate` named in its task), and returns the uncommitted worktree diff and the `faff-contract:quality-gates` verdict. **Staging, `faff stage-guard`, and the commit stay with the orchestrator** — the context-less executor (build.md:14: "loads no faff-skill context") carries no staging policy, so delegating the commit would drop the PR #258 selective-staging secret-leak guard; the orchestrator holds that skill context and commits the executor's returned diff itself. The orchestrator also keeps Step 8 (AC verification), Step 9 (review), Step 9b (PR), Step 10 (merge), Step 11, and all human dialogue. This is lighter than the autonomous concurrency path, whose subagent runs the whole remaining graft to PR-ready (and carries the staging guard because the whole SKILL is dispatched); here the dispatched unit stops after build + gate and the orchestrator stays resident to stage/commit and to drive the interactive AC/review/PR steps and the human choices. This matches the Implementor-lane contract (build.md:16: the orchestrator retains the process, the gates, and all human interaction).

**Decision — staging + commit stay in the orchestrator (the secret-leak guard).** Options: (a) the executor stages + commits (returns a committed diff); (b) the executor returns an uncommitted worktree diff and the orchestrator does the selective-staging allowlist + `faff stage-guard` + commit. (a) drops the PR #258 `.env`-leak guard, because a bare-executor loads no faff-skill context and the dispatch payload carries no staging policy; the autonomous path keeps the guard only because the whole SKILL is dispatched. **Chosen:** (b) — the guard is a skill-context behaviour, so it stays where the skill context is; the executor only implements + gates.

**Interactive sub-decisions during the build.** The existing Step 7 rule (interactive mode asks the user when a spec gap arises) still holds. A bare-executor cannot prompt the operator, so an unresolved spec gap is returned to the orchestrator as a compact "needs operator decision" result rather than guessed inside the subagent; the orchestrator surfaces it to the operator and re-dispatches. (On the inline branch this is unchanged.)

**Foreground posture.** The dispatch obeys the Step 7–9b foreground rule already in graft: `run_in_background: false` where the harness supports it; an always-background interactive harness is safe because it tracks the child across turn-end and re-invokes the parent (kernel.md:337).

### 4.2 The ADR-body dispatch (Step 4b sub-step 2)

**Summary.** Re-shape "Author the body via the `adr` slot" from an inline Skill-tool invocation into a Producer dispatch resolving `models.adr`, with the same single-level-nesting fallback as the sibling producers.

```
PROCEDURE step4b_author_adr_body(decision, spec, issue, related_adrs):
  resolve slots.adr = `faff config get slots.adr`
  IF graft is top-level (not a dispatched subagent):
    -> dispatch the resolved adr slot as a Producer subagent (kernel.md -> Sibling-skill invocation ->
       Producer dispatch), resolving `models.adr`:
         - a resolved Agent-token -> the Agent-tool `model` param;  "inherit" -> OMIT it
         - pass the producer: the decision (Chosen line + spec rationale), the spec, the issue,
           and `faff adr list --json`
         - consume its returned body + advisory confidence: as the tool result
  ELSE (graft is itself a dispatched subagent):
    -> invoke the adr producer IN-CONTEXT (inline), exactly as today — single-level nesting
  # the body-handling, confidence routing (sub-step 3), contradiction detection (3b), and commit (4)
  # are UNCHANGED downstream of how the body was produced
```

The ADR body is a generative producer output (Nygard Context/Decision/Consequences), so it is a legitimate Producer dispatch like `spec`/`architecture`. Low urgency: it fires only when an `## ADR promotion intent` is located, so most grafts never reach it, but the pattern is cheap once the model lane exists.

### 4.3 The `models.adr` config key

Add the key everywhere the existing per-lane scalar model keys (`models.spec`, `models.architecture`) are declared, so it is surfaced consistently:

1. `DEFAULTS["models.adr"] = "inherit"` (config.js:192 region, beside `models.spec`).
2. `MODEL_LANE_VOCAB["models.adr"] = ["inherit", "sonnet", "opus", "haiku", "fable"]` (config.js:346 region).
3. The `config defaults --selftest` `expected` array (config.js:2712 region) gains `"models.adr"`.
4. The vocab selftest block (config.js:2751 region) gains `validateModelLane("models.adr", DEFAULTS["models.adr"])` plus a reject-an-invalid-token assertion.
5. The `config resolved` run-banner echo loop (config.js:2882) gains `"adr"` in the `models` lane list so a pinned `models.adr` is visible, not silent.
6. Optionally, kernel.md's producer-lane enumerations (lines 162 and 169) gain `adr` so the gateway's list of lanes stays accurate. (Gateway edit — mind the kernel baseline.)

`validateModelLane` already rejects an `engine:<name>` value on any `models.*` key not on the `ENGINE_LANE_KEYS` allowlist, so `models.adr` fails loud on an engine value for free (config.js:363) — no code change needed for that guard; the selftest at 2777 region may gain a matching reject assertion for parity.

### 4.4 Failure modes

- **The failure:** the interactive dispatch resolves a model but the autonomous path's byte-identical guarantee is broken (a dispatched graft starts dispatching its build again, double-nesting). How you'd know: a beep-boop run shows a build subagent dispatched from inside a graft subagent, or the heartbeat wiring doubles up. What it means: the discriminator was implemented as a bare `[ -n "$FAFF_RUN_DIR" ]` re-test (set in both cases) instead of the captured Step-3 mint-vs-skip branch; thread the Step-3 decision forward as state so a dispatched graft is recognised and stays inline.
- **The failure:** the resolver reads a stale or missing `build-tier:`/`confidence:` line and resolves the wrong model (or errors). How you'd know: `faff models build-for` returns an unexpected token, or the dispatch runs at an unintended model. What it means: the spec's retained fields are the single source; if absent, `build-for` routes to the `default` bucket (never guesses `high`) and `inherit` keeps today's behaviour — acceptable, not a block.
- **The failure:** a bad `models.adr` token silently inherits instead of failing loud. How you'd know: `faff config get models.adr` on an off-vocabulary value exits 0. What it means: the vocab/selftest wiring is incomplete; `validateModelLane` must be reached on the `config get` path (it is, via the chain at config.js:2685).
- **Anti-pattern:** forking a second build-model resolver for the interactive path. Why: the autonomous path's `faff models build-for` is pure and already reads tier+confidence; a parallel resolver would drift.
- **Anti-pattern:** running the interactive build inline via the Skill tool on the top-level branch "just to keep it simple." Why: inline inherits the session model, which is the exact bug this closes.

## 5. Scenarios

```
Given an interactive top-level /faff-graft on a prepped issue whose spec retains confidence: high
  and build-tier: standard, with models.build_by_confidence.high = sonnet configured
When Step 7 runs
Then graft resolves the build model via faff models build-for --tier standard --confidence high,
  and dispatches the build as a subagent with the Agent-tool model param set to sonnet
  (not inline at the operator's session model)
```

```
Given a beep-boop autonomous run dispatching graft as a subagent (FAFF_RUN_DIR pre-set)
When that graft reaches Step 7
Then the build runs INLINE within the graft subagent exactly as today (no second dispatch),
  because the resolved model already applied when the concurrency executor dispatched graft
```

```
Given models.adr = opus configured and an interactive top-level graft that locates an
  ## ADR promotion intent at Step 4b
When the adr body is authored
Then the adr producer is dispatched as a subagent with the Agent-tool model param set to opus,
  and its returned body feeds the unchanged commit path
```

```
Given models.adr is unset
When faff config get models.adr runs
Then it prints "inherit" and exits 0; and faff config defaults --selftest passes with models.adr
  registered in the expected set and accepted by validateModelLane
```

```
Given models.adr = gpt-5 (off-vocabulary) configured
When faff config get models.adr runs
Then it exits 2 naming the legal set { inherit, sonnet, opus, haiku, fable } — never a silent inherit
```

## 6. DESIGN DECISION RATIONALE

**What should the dispatched interactive build-executor own?**
Options: (a) just Step 7 implement + Step 7.5 gate ladder, returning diff + gate verdict (the bare-executor contract); (b) the whole remaining graft to PR-ready, as the concurrency executor's subagent does. (b) would strand the orchestrator: interactive graft must stay resident for the AC/review/PR/merge steps and the operator's Build/Review/Reprep choices, which a disposable subagent cannot drive.
**Chosen:** (a) — the Step-7 bare-executor owns implement + gate ladder and returns a compact result; the orchestrator keeps Steps 8–11 and all human interaction. Matches the Implementor-lane contract (build.md:16).

**How does the interactive orchestrator resolve the model?**
**Chosen:** `faff models build-for --tier <build-tier> --confidence <confidence>` and `faff effort build-for --tier <build-tier>`, both read off the attached spec's retained lines, passed as the Agent-tool `model` / reasoning-effort args; `inherit` omits them. The same pure resolvers the autonomous path uses (config.js `resolveBuildModelForIssue`, effort.js `resolveBuildEffort`). No new logic, no tracker read.

**Is the behaviour change (interactive build at the resolved, possibly cheaper, model) accepted?**
**Chosen:** yes — operator decision 2026-10-01, recorded on the ticket. The interactive build then runs at the resolved model rather than the operator's session model; the orchestrating session stays on its own model. This is the intended effect, not a regression.

**How is `models.adr` declared?**
**Chosen:** mirror `models.spec` exactly — a `DEFAULTS` entry (`"inherit"`), a `MODEL_LANE_VOCAB` entry (the closed five-token set), the `config defaults --selftest` `expected` + vocab assertions, and the `config resolved` echo. No matcher (no `build_by_*` equivalent), no effort lane. The engine-value rejection comes free from the existing `validateModelLane` allowlist guard.

**Does the single-level-nesting fallback belong in this ticket, or is it a separate concern?**
The guard (dispatch when top-level, inline when graft is a dispatched subagent) is in scope for both the build and the ADR producer: it is the exact mechanism that makes the interactive fix safe and keeps the autonomous path byte-identical, mirroring the spec/architecture producers (kernel.md:339).
**Punt:** the broader limitation that any nested producer's configured model cannot apply when its parent orchestrator is itself a subagent is pre-existing across all producers and intrinsic to single-level nesting. Resolving it needs a multi-level dispatch design (decides: architecture). It is cross-referenced under OUT OF SCOPE and is non-blocking for this increment.

## 7. Open Questions and Assumptions

**Open Questions.**
- **Punt (non-blocking):** the general nested-model limitation across all producers — a multi-level dispatch design, deferred to its own ticket (decides: architecture). It does not block this increment; the top-level interactive case is fully served.

**Assumptions.**
- **Assumes:** the attached spec carries `confidence:` and `build-tier:` lines at graft time. Validation: faff-prep's build-tier stamp (faff-prep/SKILL.md:84) writes `build-tier:` adjacent to `confidence:` at attach; graft retains both. If a `build-tier:` is absent on an older spec, `faff models/effort build-for` with an absent `--tier` falls through to the confidence/scalar chain (config.js `resolveBuildModelForTier` returns null on an absent tier) — graceful, not a block.
- **Assumes:** graft can distinguish top-level from dispatched. Validation: Step 3 already draws this line — it mints the L2 run substrate only for "standalone/top-level interactive graft" and skips when `FAFF_RUN_DIR` was pre-set by an orchestrator (faff-graft/SKILL.md:162). The dispatch condition reuses that same signal; no new state.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a top-level interactive graft with `models.build_by_confidence.high = sonnet` and a `confidence: high` spec, Step 7 dispatches the build as a subagent with the `model` param = `sonnet`, not inline at the session model.
- [ ] The interactive dispatch **records the resolved model (and effort) in a checkable place** — the per-issue run log (`<run_dir>/<ISSUE>/graft.md`) and/or a `data.model` event — mirroring the autonomous executor's "record the resolved per-issue model on the BuildDispatch / run log, never silent". This is the mechanism the behaviour-DoD above is verified against (the model-dispatch scenario is otherwise not directly observable, the same reason the effort arm is `holdout`-marked).
- [ ] On a beep-boop dispatched graft, Step 7 still builds inline (no second dispatch) — the autonomous path is byte-identical (the inline-branch prose is untouched).

### From WHAT (config key)
- [ ] `DEFAULTS["models.adr"] = "inherit"` and `MODEL_LANE_VOCAB["models.adr"]` = `["inherit","sonnet","opus","haiku","fable"]` added (config.js).
- [ ] `faff config get models.adr` prints `inherit` (exit 0) when unset; exits 2 naming the legal set on an off-vocabulary value.
- [ ] `faff config defaults --selftest` passes with `models.adr` in the `expected` array and a `validateModelLane("models.adr", …)` accept + reject assertion in the vocab block.
- [ ] `faff config resolved` echoes a pinned `models.adr` (the `models` lane echo loop includes `adr`).

### From HOW (build dispatch)
- [ ] faff-graft Step 7 prose dispatches the build as a bare-executor subagent when graft is top-level, resolving `faff models build-for --tier <build-tier> --confidence <confidence>` as the `model` param and `faff effort build-for --tier <build-tier>` as the reasoning-effort arg; `inherit` omits each.
- [ ] The top-level branch never runs the build inline via the Skill tool; the dispatched-subagent branch stays inline.
- [ ] A `faff models build-for` / `faff effort build-for` exit 2 fails loud and does not build.

### From HOW (ADR dispatch)
- [ ] faff-graft Step 4b sub-step 2 dispatches the `adr` producer as a subagent resolving `models.adr` when graft is top-level, and invokes it in-context when graft is a dispatched subagent; the downstream body-handling/commit path is unchanged.

### From constraints (lint/line-cap)
- [ ] `faff validate-adapters` is green: `SKILL_LINE_BASELINE["faff-graft"]` is bumped from 952 by the exact net line delta of the Step 7 + Step 4b edits (and `KERNEL_LINE_BASELINE` from 468 if kernel.md's lane lists are edited), with a forward-stated one-line rationale appended to the baseline comment (no war-story, no transcript idiom).
- [ ] No ticket refs introduced into SKILL.md prose (faff-graft currently has zero; keep it so). The stray-marker lints stay clean.

### Integration smoke test
```
faff config set models.adr opus
faff config get models.adr            # -> opus, exit 0
faff config defaults --selftest       # -> PASS (models.adr registered + vocab accept/reject)
faff config set models.adr gpt-5      # -> exit 2, names the legal set
faff validate-adapters                # -> green (baseline matches actual faff-graft line count)
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ] }
```
