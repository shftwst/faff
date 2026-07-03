# FAFF-315 — Per-lane model selection: the `models:` config surface + dispatch wiring

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: high. Full spec on Linear FAFF-315.

This is a **build spec** (not a spike): add a `.faffrc` `models:` mapping and wire it through every dispatch point that can actually consume a model, so frontier judgement can be pinned to the lanes where it is the trust anchor while cheaper models run the gated bulk. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model:** in faff, only three kinds of invocation can run on a different model — (a) a **true subagent** dispatched via the Agent tool (which takes a `model` parameter), (b) an **out-of-session helper process** that owns its own engine call (the `review-call.mjs` pattern), and (c) a **spawned `claude -p`** (the eval driver, which takes `--model` + env redirect). Everything else — every Skill-tool-inline slot invocation (spec, spec_review, the structural review pass, ship, adr, methodology, routing, rendering) — runs *in the same session* and structurally inherits the session model. A "per-slot model" config that ignored this would be a lie for most slots; the honest v1 wires the lanes that can consume it and documents the constraint for the rest.

**Problem:** faff swaps *skills* per slot but has no *model* knob — the model is session/dispatch-level, so build bulk, exploration, and eval runs all silently bill to whatever the account default is (during Fable week, the fast-burning frontier pool), and there is no way to pin frontier judgement to a trust-anchor lane. ADR-0038 carved this ticket out by name as the narrow, additive, safe-on-main FAFF-69 rung; the FAFF-315 ticket comment (2026-07-02) adds a second concrete consumer with two guards — the eval driver must never inherit the account default (budget guard) and must run each surface's eval on the model that surface uses in production (validity guard).

**Design principles:**

**Unset ⇒ byte-for-byte today.** With no `models:` block, every dispatch inherits exactly as now — no new consult, no behaviour change. A missing key is never a park reason (the gateway slot rule, applied to models).

**Wire only what can consume; document what can't.** The v1 lane set is exactly the real actuation points (Agent-tool subagents + the eval driver). Inline slots get the constraint documented where a reader would look, not a config key that silently does nothing — a no-op knob is worse than no knob.

**CLI-only resolution, fail-loud on invalid.** Every read goes through `faff config get models.<lane>` (never hand-read the rc); a configured value outside the lane's legal vocabulary fails loud at dispatch — a misconfigured model must not silently fall back to the session default (the FAFF-50 / dropped-slot principle).

**Compose with the shipped different-model surfaces, don't subsume them.** `faffter_dark.adversarial` (provider/model/host for the adversarial reviewer) stays authoritative for its lane — it handles non-Anthropic engines the Agent-tool vocabulary cannot express. `models:` covers the in-harness Anthropic lanes + the eval driver; the relationship is documented in one place.

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| BuildDispatch (the build-lane hook) | `faffter-noon-concurrency-sequential/SKILL.md` :30, `faffter-dark-concurrency-parallel/SKILL.md` :31 — prose literal `{ issues, run_id, run_dir, session_id, mode_signal }` | The only true-subagent build dispatch; gains a `model` field consumed by the Agent-tool call |
| prep subagents | `faff-prep/SKILL.md` :208 (explore subagent), :145 (clean-context verify note) | Agent-tool dispatches that can take a model |
| Config machinery | `bin/faff` `dig()` ~:252 (dotted paths — zero change needed), `DEFAULTS` ~:266–293, `config defaults --selftest` expected list ~:769–774, `config resolved` echo ~:803–823 | Where `models.*` registers, self-tests, and shows in the run banner |
| Parser | `parseYamlSubset` + FAFF-262 `parseSeq` (~:178–229) — native maps/lists parse | A `models:` map needs no parser change; the adversarial SKILL's "parser stores arrays as scalars" note (:120) is stale post-FAFF-262 |
| Adversarial-review model block | `faffter-dark-adversarial-review/SKILL.md` :102–152 (`faffter_dark.adversarial`, review-call.mjs; `anthropic` explicitly unsupported → exit 2) | The shipped non-Anthropic precedent `models:` composes with, never subsumes |
| Eval driver | `eval/README.md` :74–78, :100–115 (`cli-driver.mjs` `frontierOpts` passes no `--model` → inherits account default; local lane env-redirect + `--model`; `FAFF_EVAL_LOCAL_*`) | The second consumer (ticket comment): pin the frontier driver's model, never the account default |
| Inline-invocation constraint | gateway `SKILL.md` :808–828 (Sibling-skill invocation), FAFF-201 spec :13 (Skill tool runs inline, single-level subagenting) | Why most slots cannot take a per-slot model at v1 |
| Sanction + vocabulary | ADR-0038 :38/:43 (the safe-on-main carve-out), FAFF-69 body (`engine:` on role invocation — the eventual home this surface maps onto) | The direction this rung proves |

**Scope statement:** the first FAFF-69 rung built on main (per ADR-0038 clause 4), sitting between the shipped slot model and the deferred capability/role DSL; it is the durable knob that outlives the Fable window.

## 2. OUT OF SCOPE

- **Per-slot models for Skill-tool-inline slots** (spec, spec_review, structural review, ship, adr, methodology, routing_adaptor, rendering_adaptor) — structurally impossible without re-shaping each into a subagent/helper dispatch; that re-shaping is a future rung (per-slot, judged case-by-case). Extension point: each slot's invocation prose in its consumer skill; the constraint is documented in the gateway `models:` block.
- **Subsuming `faffter_dark.adversarial`** — the adversarial reviewer keeps its own provider/model/host block (it speaks non-Anthropic wire formats the Agent vocabulary cannot). Extension point: a future `models.review_adversarial` alias could *point at* that block; not now.
- **The evaluator helper's model** — the holdout evaluate-call helper is specified as "the `review-call.mjs` pattern" but graft-side; when its helper is built it takes its own engine block mirroring the adversarial precedent. Extension point: the evaluate-call helper's config block; the gateway `models:` doc names this seam.
- **Ensemble/strategy fan-out, per-step overrides, role envelopes** — the FAFF-69 reframe, deferred per ADR-0038.
- **Model-fidelity measurement** — FAFF-129/319/321 own "measure before assigning"; this ticket only makes the assignment expressible (and the eval comment's validity guard wireable).
- **Re-baselining evals on the pinned model** — pinning the eval driver changes baseline lineage; recording/accepting new baselines is the human-supervised FAFF-319/321 work, coordinated not blocked.

## 3. WHAT — Vocabulary, Config Surface, and Wiring

**Vocabulary:**

| Term | Definition |
|---|---|
| lane (here) | A dispatch point that can actually consume a model: `build`, `prep_explore`, `eval` at v1 |
| Agent-token | The Claude Code Agent-tool `model` vocabulary: `sonnet` \| `opus` \| `haiku` \| `fable` |
| inherit | The absent-key semantics: dispatch exactly as today (session/account default) |

**The config surface** (documented in the gateway schema block, mirroring the `slots:` layout):

```
models:                # optional; every key optional; unset ⇒ inherit (byte-for-byte today)
  build: sonnet        # Agent-token — the concurrency executors' build subagents
  prep_explore: haiku  # Agent-token — faff-prep's explore + clean-context verify subagents
  eval: claude-sonnet-4-6   # model id passed to the eval frontier driver's `claude -p --model`
```

- **`models.build` / `models.prep_explore`** — value vocabulary is the **closed Agent-token set**. **Chosen:** closed-set validation at read time with fail-loud on an unknown token (surface the bad value + the legal set; never silently inherit) — a misconfigured model is the dropped-slot failure mode.
- **`models.eval`** — value is a model id string handed to `claude -p --model` (open vocabulary — the CLI validates it). **Chosen:** the frontier eval driver's default becomes the **pinned registry default `claude-sonnet-4-6`** when `models.eval` is unset — never the account default (the ticket comment's budget guard); an explicit `run-evals --model <id>` flag overrides both (the validity guard's per-surface escape hatch).
- **Resolution is CLI-only:** `faff config get models.<lane>` (dotted-path `dig()` already works); `models.*` entries join the `DEFAULTS` registry (`build`/`prep_explore` default `inherit`; `eval` default `claude-sonnet-4-6`), the `config defaults --selftest` expected list, and the `config resolved` echo (a non-default model must show in the run banner, not be silent). **Chosen:** no new subcommand — the existing `config` machinery carries the whole surface; the closed-set check is a small table + selftest beside `DEFAULTS`.

**The dispatch wiring:**

- **BuildDispatch gains a `model` field** in both concurrency executors' prose literal: `{ issues, run_id, run_dir, session_id, mode_signal, model }` — populated from `faff config get models.build` at dispatch-assembly time; `inherit` (or unset) ⇒ omit the Agent-tool `model` param entirely (today's call, byte-for-byte). The executor passes it to the Agent-tool call that spawns the build subagent.
- **faff-prep's subagent dispatches** (the Step-1 explore subagent; the producer's clean-context verify subagent) resolve `models.prep_explore` the same way at their dispatch points: token ⇒ pass as the Agent-tool `model` param; `inherit` ⇒ omit.
- **The eval frontier driver** (`cli-driver.mjs` `frontierOpts` / `run-evals.mjs`): resolve `models.eval` (CLI if a `.faffrc` is reachable, else the registry default) and pass `--model <id>` on the `claude -p` spawn; support `--model` as an explicit driver flag overriding config. The local lane (`FAFF_EVAL_LOCAL_*`) is untouched.
- **Documentation wiring:** the gateway schema block gains the `models:` section including (i) the inline-slot constraint ("slots invoked inline via the Skill tool inherit the session model — a per-slot model there requires re-shaping into a subagent/helper dispatch"), (ii) the composition note (adversarial review + future evaluate-call helper keep their own engine blocks), and (iii) the eval budget/validity guard rationale. The stale parser note in `faffter-dark-adversarial-review/SKILL.md` (:120 "the faff config parser stores arrays as scalars") is corrected in the same PR (docs never go stale; the claim is about the config machinery this ticket extends).

**Design decisions (rationale in section 6):**

- **Chosen:** lane-keyed flat map (`models.build`), not slot-keyed — because most slots cannot consume a model, and lanes name the real actuation points.
- **Chosen:** closed Agent-token vocabulary for in-harness lanes; fail-loud on unknown.
- **Chosen:** `models.eval` pinned registry default `claude-sonnet-4-6`; account default never inherited by the eval driver.
- **Chosen:** compose with (never subsume) `faffter_dark.adversarial`; evaluator-helper model is a documented seam.
- **Chosen:** no new CLI subcommand; the `config` machinery + DEFAULTS registry carry the surface.

## 4. HOW — Behaviour

**Resolution at a dispatch point (all three lanes follow this shape):**

```
PROCEDURE resolve_lane_model(lane):
  1. value := `faff config get models.<lane>`        # CLI-only; registry default applies
  2. IF lane in {build, prep_explore}:
     a. IF value == "inherit" (or key absent):  return OMIT   # today's call, no model param
     b. IF value in AGENT_TOKENS:               return value
     c. ELSE: FAIL LOUD — name the bad value + legal set; do not dispatch on a silent fallback
  3. IF lane == eval:
     a. explicit --model flag wins; else value (registry default claude-sonnet-4-6)
     b. pass as `claude -p --model <value>`     # CLI errors loudly on an unknown id
```

**BuildDispatch assembly (both executors):** resolve once per run at queue-assembly time (not per issue — one run, one build model), stamp into every `BuildDispatch`, and log the resolved value in the run banner via `config resolved`.

**Edge cases:**

- `.faffrc` absent entirely → registry defaults (`inherit`/`inherit`/`claude-sonnet-4-6`) — the eval driver is pinned even in a config-less repo (the budget guard holds by default).
- A worktree copy of `.faffrc` lags the main checkout → same as any config drift; config is pulled-not-pushed at each dispatch (the existing rule).
- `models.build: fable` under an account whose plan lacks Fable → the Agent tool errors at dispatch; that error surfaces as a normal dispatch failure (park/errored), not a silent downgrade. Named, not handled specially.
- Eval baseline lineage: the first pinned-model eval run is **not comparable** to baselines recorded on another model — the driver's report header must name the resolved model (it becomes part of the baseline identity), and re-baselining is FAFF-319/321's human-supervised step.

**Failure modes — how the approach could be wrong, and how you'd notice:**

- **The lane set is wrong** (a consumer needs per-issue or per-phase granularity, not per-run). How you'd know: a real run wants haiku for docs-only issues and sonnet for code issues, and the single `models.build` can't express it. What it means: narrow v1 stands (one knob per lane); per-issue routing is a future rung on the same key (`models.build` grows a matcher), not a redesign — note the extension point, don't build it.
- **Fail-loud is too aggressive** (a typo'd token bricks an overnight run at the first dispatch). How you'd know: a parked run with cause "invalid models.build token". What it means: correct behaviour — the alternative (silent inherit) burns the wrong budget invisibly; the park message names the fix. Not softened.
- **The pinned eval default surprises** (numbers shift because the driver stops inheriting the account model). How you'd know: first post-merge eval run diverges from the recorded baseline. What it means: expected and intended (the validity guard); the report header naming the model makes it diagnosable; FAFF-319/321 re-baseline.

**Anti-pattern:** adding a `models.<slot>` key for an inline slot "for symmetry". Why: it cannot take effect; a knob that does nothing erodes trust in every knob.

**Anti-pattern:** hand-reading `.faffrc` for the model at any dispatch point. Why: the CLI-only rule exists because hand-reads silently dropped configured slots twice.

## Scenarios

```
Given .faffrc with models.build: sonnet
When the concurrency executor assembles a BuildDispatch
Then the Agent-tool call that spawns the build subagent carries model: "sonnet"
     and `faff config get --json` / `config resolved` shows the non-default value
```

```
Given no models: block anywhere
When any wired dispatch point fires (build, prep explore, eval driver with no --model)
Then the build/prep dispatches are byte-for-byte today's calls (no model param),
     and the eval driver passes --model claude-sonnet-4-6 (the pinned registry default)
```

```
Given models.build: gpt-5 (not an Agent-token)
When the executor resolves the build lane
Then dispatch fails loud naming the bad value and the legal set — no silent inherit
```

```
Given run-evals --driver frontier --model claude-opus-4-8
When the driver spawns claude -p
Then --model claude-opus-4-8 is passed (flag beats config beats registry default)
     and the report header names the resolved model
```

Non-functional assertion: with `models:` unset, no new `faff config get` failures, no test regressions, and zero behaviour change outside the eval driver's pinned default.

## 6. DESIGN DECISION RATIONALE

**Lane-keyed or slot-keyed?** Slot-keyed reads natural (`models.review`) but most slots are Skill-tool-inline and cannot consume a model — dead knobs. **Chosen:** lane-keyed by real actuation point (`build`, `prep_explore`, `eval`); the FAFF-69 extraction later maps lanes onto `role.invocation[mode].engine` (ADR-0038's vocabulary note honoured — this shape migrates as a rename, not a redesign).

**Closed vocabulary or free string for Agent lanes?** Free strings defer errors to the Agent tool with murkier messages, and invite non-Anthropic ids that can never work there. **Chosen:** the closed Agent-token set with fail-loud validation; non-Anthropic engines belong to the helper-process pattern (adversarial precedent).

**Pin the eval default or inherit?** Inheriting preserves old behaviour but is precisely the budget hazard the ticket comment documents (eval bulk silently on the account default — Fable during the window). **Chosen:** pinned registry default `claude-sonnet-4-6`; explicit `--model` for deliberate runs; report header names the model so baseline lineage is visible.

**Subsume the adversarial block into `models:`?** One surface reads tidy but the adversarial lane needs provider/host/fallback-chain fields the flat map can't hold, and that block is shipped, tested, and load-bearing. **Chosen:** compose — `models:` for in-harness Anthropic lanes + eval; `faffter_dark.adversarial` stays authoritative for its lane; relationship documented once in the gateway block.

**New subcommand (`faff models resolve`) or ride `config`?** A dedicated resolver is more machinery than three keys warrant (proportionality). **Chosen:** ride the existing `config` machinery — DEFAULTS entries + selftest + `config resolved` echo + a small closed-set table; revisit only if lanes multiply.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none escalated — no `Punt:` markers.

**Assumptions:**

- **Assumes:** the Agent tool accepts `model: 'sonnet'|'opus'|'haiku'|'fable'` on subagent dispatch (present in the current harness). Validation: confirm against the harness tool schema at build start; if the vocabulary differs, the closed set follows the harness, not this spec.
- **Assumes:** `BuildDispatch` is prose-defined only in the two concurrency SKILL.mds (:30/:31) with no schema/CLI struct to migrate. Validation: grep before editing.
- **Assumes:** `dig()`/`DEFAULTS`/`config defaults --selftest`/`config resolved` are at ~`bin/faff:252/:266/:769/:803` as explored. Validation: grep before editing.
- **Assumes:** `eval/cli-driver.mjs` `frontierOpts` passes no `--model` today and `run-evals.mjs` owns the driver flags. Validation: read both before wiring; keep the local-lane env-redirect untouched.
- **Assumes:** the `faffter-dark-adversarial-review/SKILL.md:120` parser note is stale post-FAFF-262 (arrays parse natively). Validation: run the parser selftest before correcting the prose.

## 8. DONE — Definition of Done

### From WHAT (config surface)
- [ ] `faff config get models.build` / `models.prep_explore` / `models.eval` resolve, with registry defaults `inherit`/`inherit`/`claude-sonnet-4-6`; `config defaults --selftest` covers the family; `config resolved` echoes non-default `models.*` values.
- [ ] An invalid Agent-token for `models.build`/`models.prep_explore` fails loud at resolution (test proves the message names the value + legal set; no silent inherit).
- [ ] The gateway schema block documents `models:` with the inline-slot constraint, the adversarial/evaluator composition note, and the eval guard rationale.

### From WHAT (dispatch wiring)
- [ ] Both concurrency executors' `BuildDispatch` literals carry `model`, resolved once per run from `models.build`, passed as the Agent-tool `model` param; `inherit`/unset ⇒ param omitted (byte-for-byte).
- [ ] faff-prep's explore-subagent dispatch prose resolves `models.prep_explore` the same way.
- [ ] The eval frontier driver passes `--model` from flag > config > pinned registry default, never the account default; the report header names the resolved model; the local lane is untouched.
- [ ] The stale parser-array note in the adversarial SKILL.md is corrected.

### From HOW (behaviour)
- [ ] With `models:` unset: build/prep dispatch calls are unchanged (no model param), full test suite green, `validate-adapters` green.
- [ ] Tests: DEFAULTS/selftest coverage for `models.*`; the fail-loud invalid-token path; the eval driver's flag>config>default precedence (unit-level, no live model call).

**Eval coverage:** not applicable — model *selection* is mechanical plumbing (deterministic resolution + parameter pass-through); it introduces no new LLM-judgement seam. (The judgement quality of models *chosen* per lane is FAFF-129/319/321's measurement domain.)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. echo "models: {build: sonnet, eval: claude-sonnet-4-6}" style block into a temp .faffrc copy
  2. faff config get models.build → "sonnet"; config resolved shows it
  3. faff config get models.eval in a config-less dir → "claude-sonnet-4-6" (registry default)
  4. node --test → suite green; defaults --selftest covers models.*
  5. grep both concurrency SKILLs → BuildDispatch literal carries model
```

confidence: high
spec-review: approve
