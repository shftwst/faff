# FAFF-372 — Dispatch interactive L2 slot producers as Agent-tool subagents (not inline Skill)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-372.

This is the build spec for FAFF-372, for the build agent (`/faff-graft`) and human reviewers. It migrates faff's **interactive L2 producer** invocations from inline `Skill`-tool calls to **Agent-tool subagent dispatch**, so the orchestrator keeps control across the producer boundary (no mid-turn stall) and each producer can take a per-lane `models:` model.

## 1. WHY — Problem and Principles

**The load-bearing model — producer dispatch vs. chaining handoff.** A faff orchestrator invokes a sibling skill in two structurally different ways, and only one of them is broken:

- **Producer dispatch** — the orchestrator invokes a *slot producer* (spec / methodology / spec_review / intake), **consumes its returned output** (a spec body, a `faff-contract:*` block, a critique), and then **must resume its own work** (attach → validate → gate → promote). The producer is a subroutine; control has to come back.
- **Chaining handoff** — the orchestrator offers a gate ("build now?") and, on confirm, **hands control to a sibling that takes over the conversation** (prep → graft, jot → prep/plot, graft → prep/wtf). Nothing resumes; the sibling is the new driver.

The **Skill tool breaks producer dispatch**: it injects the sub-skill's `SKILL.md` as a **user-role message**, so producing the sub-skill's output reads as *answering a fresh user request* and the caller's **turn ends** — the orchestrator never resumes to attach/gate/promote. Observed ~5× across different sessions and different models (model-independent ⇒ structural, not a reasoning lapse). Decisive tell: within one session, three `Skill`-tool producer calls each ended the turn, while **Agent-tool** dispatches (Explore subagents) did **not** — a subagent returns its output as a **tool result**, so the orchestrator keeps control and continues in the same turn.

**The fix** is to run each producer in an **Agent-tool subagent**: the producer executes in an isolated throwaway context and returns its output as a **tool result** to the orchestrator — no turn boundary, immune to the regression. This is the pattern the **build lane already uses** (the `concurrency` slot dispatches `/faff-graft` as an isolated subagent returning a terminal token — `faff/SKILL.md` L263; `faffter-noon-concurrency-sequential/SKILL.md` L30). FAFF-372 extends that proven shape to the interactive prep-stage producers. **Chaining handoffs stay on the Skill tool** — you *want* control to transfer there; a subagent would run graft in a throwaway context and discard it.

**Second benefit — per-producer model lanes.** An Agent-tool dispatch takes a `model` parameter, so a migrated producer can consume a `models:` lane (`models.spec` / `models.spec_review` / `models.methodology` / `models.intake`), exactly as the build lane consumes `models.build`. The gateway explicitly records today's limitation (`faff/SKILL.md` L226): *"A slot invoked inline via the Skill tool runs in the same session and inherits the session model — no `models:` key can change that; giving such a slot its own model requires re-shaping its invocation into a subagent/helper dispatch."* This refactor is that re-shaping.

**Design principles.**

- **Transport change only — contracts and producers untouched.** Producers still emit their `faff-contract:*` blocks; the orchestrator still locates the block in the returned text, `JSON.parse`s it, and pipes it to `faff contract …`. The consumer-folds are already **transport-agnostic** (they parse "the producer's returned output", not "the Skill message") — nothing in them changes. Producer `SKILL.md` prose does not change (a producer never knows its caller).
- **Single-level subagent nesting is the safety boundary.** faff deliberately keeps build-lane nesting **one level deep** (FAFF-201/226): the build subagent runs `faff-graft` *and its review* in-context — "the orchestrator never invokes `review-call.mjs` nor runs a review phase itself." A producer subagent dispatched from a context that is **itself** a subagent would double-nest. So this slice migrates only **top-level interactive** orchestrators (prep, jot), where the producer subagent is single-level.
- **Human gates stay in the orchestrator.** The crank-up / build / resolve-or-park gates are the orchestrator's, unmoved — the subagent produces an artifact, it never gates.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| Build-lane subagent dispatch (the pattern to copy) | `faffter-noon-concurrency-sequential/SKILL.md` L30; `faffter-dark-concurrency-parallel/SKILL.md` L31; gateway L263 | Agent-tool dispatch + `model` param + terminal-return; the proven precedent. |
| prep's existing explore subagent (in-file precedent) | `faff-prep/SKILL.md` L208–210 | Already an Agent-tool dispatch that resolves `models.prep_explore`; the migrated producers copy its shape. |
| prep producer sites to migrate | `faff-prep/SKILL.md` L217–219 (spec), L49 (methodology), L107–108 (spec_review) | The three interactive producer dispatches. |
| jot producer site to migrate | `faff-jot/SKILL.md` L52 (intake) | The interactive intake dispatch. |
| Consumer-folds (unchanged, transport-agnostic) | `faff-prep/SKILL.md` L59 (spec-readiness), L109 (spec-review-verdict); gateway L944 | Parse the returned text for the `faff-contract:*` block — no dependency on Skill vs Agent. |
| Gateway prose to amend | `faff/SKILL.md` L833–853 (Sibling-skill invocation), L226 (Model selection caveat) | Add the producer-dispatch-vs-chaining-handoff note; soften the L226 caveat for migrated producers. |
| `models:` CLI machinery | `plugin/skills/faff/bin/faff` L325–327 (DEFAULTS), L334–336 (`MODEL_LANE_VOCAB`), L901 (`config resolved` loop), L832/839–845 (`config defaults --selftest`) | Where the four new lane keys slot in, mirroring `models.build` / `models.prep_explore`. |
| Graft's review/ship (deliberately OUT — see below) | `faff-graft/SKILL.md` L302 (review), L386 (ship) | Runs inside the single build subagent in autonomous mode — a nested Agent dispatch would double-nest. |

**Scope statement.** A transport swap for the interactive prep/jot producer dispatches, plus four new `models:` lane keys and two gateway prose notes — the contract and producer layers are untouched.

## 2. OUT OF SCOPE

- **Graft's `review` and `ship` producer dispatches.** Why excluded: in autonomous mode `/faff-graft` runs **inside** the build subagent (`concurrency` lane), which "does its own … review" in-context — the orchestrator never runs a review phase itself (FAFF-201/226 single-level isolation). Migrating graft's review/ship to a *nested* Agent subagent would double-nest, the exact thing that isolation forbids. It needs its own mode-aware design (Agent in interactive top-level graft, in-context under the autonomous build subagent). Extension point: a follow-up ticket; graft Step 9 / Step 10.
- **Autonomous producer dispatch (beep-boop prep-queue drain).** Why excluded: autonomous prep may itself run under a beep-boop subagent, so dispatching producer subagents from it would double-nest (same boundary as graft's review). This slice is **interactive-only**. Extension point: a follow-up that settles whether autonomous prep is top-level or nested, then migrates accordingly. The four `models:` keys this slice adds are already usable there once that lands.
- **Chaining handoffs (prep→graft, jot→prep/plot, graft→prep/wtf).** Why excluded: these transfer control to a sibling that takes over — they are *not* producer subroutines, so they must **stay** on the Skill tool (a subagent would run and then discard the new driver). `faff-prep/SKILL.md` L252/L285, `faff-jot/SKILL.md` L70/L84, `faff-graft/SKILL.md` L94/L457.
- **A harness fix to the Skill-tool return semantics.** Why excluded: out of faff's control (the alternative the ticket rejects). Extension point: none in faff.
- **Producer `SKILL.md` changes.** Why excluded: producers are caller-agnostic; they emit the same output regardless of transport. Extension point: none — do not touch them.
- **The contract layer.** Why excluded: the consumer-folds are transport-agnostic; `faff contract …` is unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Producer dispatch | Orchestrator invokes a slot producer, consumes its returned output, and resumes its own work. Migrates to Agent-tool. |
| Chaining handoff | Orchestrator hands control to a sibling that takes over the conversation. Stays on Skill-tool. |
| Producer subagent | An Agent-tool subagent (`subagent_type: general-purpose`) that runs the configured slot producer and returns its full output (incl. the `faff-contract:*` block) as a tool result. |

**The producer-subagent dispatch shape** (mirrors the build lane + prep's explore):

```
PROCEDURE dispatch_producer(slot_name, producer_inputs):
  1. producer := faff config get slots.<slot_name>        # canonical name or namespaced override
  2. model   := faff config get models.<slot_name>        # inherit | sonnet | opus | haiku | fable
  3. Agent(
       subagent_type: "general-purpose",
       model: (model == "inherit") ? OMIT : model,        # inherit → omit the param (byte-for-byte)
       prompt: "Invoke the <producer> skill (resolve per gateway Sibling-skill invocation) with these
                inputs: <producer_inputs>. Return its FULL output verbatim — including the fenced
                faff-contract:* block — as your final message. Do not summarise or add commentary."
     )
  4. RETURN the subagent's tool-result text            # the producer's output, parsed as today
```

The subagent invokes the slot skill inside its **own** throwaway context; whatever turn-boundary behaviour the Skill tool has is contained there (the subagent "ending its turn" *is* it returning its output). The orchestrator receives a clean tool result and continues — the whole point.

**New config keys** — four lanes, each mirroring `models.build` exactly:

```
models.spec         : inherit | sonnet | opus | haiku | fable    (default inherit)
models.spec_review  : inherit | sonnet | opus | haiku | fable    (default inherit)
models.methodology  : inherit | sonnet | opus | haiku | fable    (default inherit)
models.intake       : inherit | sonnet | opus | haiku | fable    (default inherit)
```

Resolution is CLI-only (`faff config get models.<lane>`); an off-vocabulary value **fails loud at read** (exit 2, names the legal set), never a silent inherit — identical to `models.build` (`bin/faff` L334–345).

## 4. HOW — Behavior

**Architecture.** Four orchestrator-prose touch-points (prep ×3, jot ×1) rewrite each producer dispatch from "invoke via the Skill tool" to the `dispatch_producer` shape above; four new keys land in the `bin/faff` `models:` machinery; two gateway notes are added; the `models-config` test gains the new-lane cases. No producer skill, no consumer-fold, no contract changes.

**1. prep — the three interactive producer dispatches (`faff-prep/SKILL.md`).**

- **Step 2 spec** (L217–219): dispatch the `spec` slot as a producer subagent with `model := faff config get models.spec`, passing the issue context + explore findings as `producer_inputs`. The subagent returns the spec body + `confidence:` line + `faff-contract:spec-readiness` block as its tool result. Everything after (attach-state marker, provenance stamp, consumer-fold validation, attach) is unchanged — it operates on the returned text exactly as on inline output today.
- **Methodology critique** (L49): dispatch the `methodology` slot's `issue-critique` as a producer subagent with `model := faff config get models.methodology`, passing the issue + attached spec. Render the returned `## Methodology critique` block as today.
- **spec_review gate** (L107–108): dispatch the `spec_review` slot as a producer subagent with `model := faff config get models.spec_review`, passing the spec body + selected lens-set + mode + the `## Methodology critique` block + repo architecture context. The subagent returns the `faff-contract:spec-review-verdict` block; the consumer-fold parses it exactly as today.

The order is unchanged (produce → attach → confidence gate → spec-review gate → promote); only each producer's transport changes, and the orchestrator now **resumes cleanly** between them in one turn.

**2. jot — the intake dispatch (`faff-jot/SKILL.md` L52).** Dispatch the `intake` slot as a producer subagent with `model := faff config get models.intake`, passing the detected mode + starting description + (single-item) workstream/naming/priority context. The returned discovery brief is consumed as today.

**3. Chaining handoffs — unchanged.** prep→graft (L252/L285), jot→prep/plot (L70/L84), graft→prep/wtf (L94/L457) stay Skill-tool invocations. They transfer control; there is nothing to resume.

**4. `bin/faff` — the four new lane keys.** Add to `DEFAULTS` (each `"inherit"`), to `MODEL_LANE_VOCAB` (each the closed set `["inherit","sonnet","opus","haiku","fable"]`), to the `config resolved` surfacing loop (extend `["build","prep_explore","eval"]` with the four), and to the `config defaults --selftest` coverage list + assertions. `validateModelLane` already handles any key present in `MODEL_LANE_VOCAB` — no new validation logic, just table rows.

**5. Gateway prose (`faff/SKILL.md`).**
- **Sibling-skill invocation** (L833–853): add a short note distinguishing **producer dispatch** (a slot whose output the orchestrator consumes and resumes after → dispatch as an **Agent-tool subagent**, single-level, taking a `models:` lane) from a **chaining handoff** (control transfers to a sibling that takes over → **Skill tool**). Name the single-level-nesting boundary (a producer subagent is only dispatched from a top-level, non-subagent orchestrator).
- **Model selection** (L226): soften the caveat — the migrated interactive producers now *do* take a `models:` lane; the remaining inline-Skill slots (graft review/ship, autonomous producer dispatch) are the ones still pinned to the session model, pending their own migration.

**6. Tests (`test/models-config.test.mjs`).** Add cases: each of `models.spec` / `models.spec_review` / `models.methodology` / `models.intake` defaults to `inherit`; an off-vocabulary token fails loud (exit 2); `config resolved` surfaces a non-default value. Extend the `config defaults --selftest` expected-coverage set (`bin/faff` L832).

**Edge cases / error handling.**

- **Subagent returns text with no `faff-contract:*` block** (producer error, or the skill didn't resolve in the subagent) → the existing consumer-fold handles it: spec-readiness falls back to reading the prose markers (its absent-block path); spec-review-verdict fails safe to `needs-human` → park (no silent-admit). No new error path.
- **`model` resolves to an invalid token** → `faff config get` exits 2 at read, naming the legal set; the orchestrator surfaces it and does not dispatch (parity with `models.build` — never a silent fallback).
- **`inherit`** → omit the `model` param; the subagent runs on the session model — byte-for-byte today's behaviour, so an unconfigured repo sees no change except the transport swap.

**Failure modes.**

- **The failure:** a `general-purpose` subagent may not resolve the faff *producer* slot skills in its available-skills list (the build lane proves `faff-graft` resolves, but that does not guarantee every producer does). Then the subagent can't run the producer and returns off-format text with no contract block. **How you'd know:** the build-time validation dispatch (Assumes A1) returns no `faff-contract:spec-readiness` block, or a "skill not found" message. **What it means:** fall back to **inlining the producer's instructions into the Agent prompt** (the orchestrator passes the producer role + inputs directly, not by skill-name) — heavier but transport-equivalent, and the consumer-fold is unchanged. Validate before committing to invoke-by-name.
- **The failure:** the "no mid-turn stall" outcome is a harness/model *behaviour*, not deterministic code, so it cannot be asserted by a unit test — only observed in a live interactive run. **How you'd know:** a manual `/faff-prep` run either flows unbroken (produce → attach → gate → promote) or stalls after a producer. **What it means:** the core AC is verified **manually** (named in DONE as a manual check); the mechanical parts (new `models:` keys, config selftest, unchanged consumer-folds) carry the automated coverage. A green test suite is necessary but not sufficient — the manual run is the real proof.

**Anti-patterns.**

- **Anti-pattern:** migrating a chaining handoff (prep→graft) to an Agent subagent. Why: it would run graft in a throwaway context and discard the driver the human is meant to watch — handoffs must transfer control, not subroutine it.
- **Anti-pattern:** dispatching a producer subagent from a context that is itself a subagent (graft's review under the autonomous build subagent). Why: double-nesting breaks the FAFF-201/226 single-level isolation. That case is out of scope here.
- **Anti-pattern:** changing a producer's `SKILL.md` to "know" it runs as a subagent. Why: producers are caller-agnostic; the transport is entirely the orchestrator's concern.

## 5. SCENARIOS

```
Given an interactive /faff-prep on a fresh ticket, with models.spec / models.methodology / models.spec_review unset (inherit)
When prep dispatches the spec, methodology, and spec_review producers as Agent-tool subagents
Then each returns its faff-contract:* block as a tool result, the orchestrator resumes in the SAME turn through attach → confidence gate → spec-review gate → promote, with no mid-turn stall
```

```
Given models.spec = sonnet configured
When prep dispatches the spec producer
Then the Agent-tool dispatch passes model: "sonnet", and faff config get models.spec returns "sonnet" (exit 0)
```

```
Given models.spec_review = gpt-5 (off-vocabulary) configured
When faff config get models.spec_review is read at dispatch
Then it exits 2 naming the legal set (inherit|sonnet|opus|haiku|fable), and the orchestrator does not dispatch on a silent fallback
```

```
Given a chaining handoff (prep → graft on a "build now? y" confirm)
When the gate is confirmed
Then graft is invoked via the Skill tool (control transfers), NOT as an Agent subagent
```

Assertion (non-functional): the `faff-contract:spec-readiness` and `faff-contract:spec-review-verdict` consumer-folds are byte-for-byte unchanged — they parse the returned text identically whether it arrived via Skill or Agent.

## 6. DESIGN DECISION RATIONALE

**Which invocations migrate — all Skill-tool sites, or only producer dispatches?**
Options: (a) migrate every Skill-tool sibling call; (b) migrate only producer dispatches, keep chaining handoffs on Skill. (a) would run graft/plot/wtf in throwaway subagents and discard the driver the human watches — wrong for a control transfer. The stall only affects invocations where the orchestrator must *resume*.
**Chosen:** (b) — migrate producer dispatches (orchestrator consumes output + resumes); chaining handoffs stay Skill-tool.

**How does the subagent run the producer — invoke the slot skill by name, or inline its instructions?**
Options: (a) the subagent invokes the configured slot skill by canonical name via its own Skill tool (mirrors the build subagent running `faff-graft`); (b) the orchestrator inlines the producer's instructions into the Agent prompt. (a) reuses the proven build-lane shape and duplicates no `SKILL.md`; (b) is heavier but avoids any subagent skill-resolution dependency.
**Chosen:** (a) invoke-by-name via `subagent_type: general-purpose`, with (b) as the validated fallback (Assumes A1) if producer skills don't resolve inside a subagent.

**What scope is one right-sized slice?**
Options: (a) all producers everywhere (prep + jot + graft + autonomous); (b) interactive prep + jot only. Graft's review/ship and autonomous prep both run under an existing subagent, so migrating them would double-nest (FAFF-201/226) and needs a mode-aware design — a separate concern.
**Chosen:** (b) — interactive prep (spec/methodology/spec_review) + jot (intake); graft review/ship and autonomous producer dispatch are OUT OF SCOPE follow-ups. Right-sized, and it fixes the exact observed stall.

**New `models:` keys — reuse `models.build`'s machinery or invent a new shape?**
**Chosen:** four new keys (`models.spec` / `models.spec_review` / `models.methodology` / `models.intake`) that reuse the existing `DEFAULTS` + `MODEL_LANE_VOCAB` + `validateModelLane` + `config resolved` machinery verbatim (default `inherit`, closed Agent-token set, fail-loud). No new resolution logic — table rows only.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking — the scope cut (interactive-only; graft/autonomous deferred) closes the design questions this slice would otherwise raise.

**Assumptions.**

- **A1 — the faff producer slot skills resolve inside a `general-purpose` subagent's available-skills list.** Validation: before wiring all four sites, dispatch a throwaway `general-purpose` subagent that invokes `faffter-noon-spec` with trivial inputs and confirm it returns a `faff-contract:spec-readiness` block. If it does not, switch to the inline-instructions fallback (Design decision 2, option b) for the dispatch shape — the rest of the spec is unchanged. (Partially discharged already: the build lane runs `faff-graft` in a subagent successfully.)
- **A2 — the Agent-tool `model` parameter accepts the closed Agent-token set (`sonnet`/`opus`/`haiku`/`fable`) and omitting it inherits the session model.** Validation: the build lane already passes `models.build` tokens to the Agent tool this way (`faffter-noon-concurrency-sequential/SKILL.md` L30) — treat as established; smoke-test one non-`inherit` dispatch.
- **A3 — the `bin/faff` `models:` machinery is at the lines cited** (`DEFAULTS` ~L325, `MODEL_LANE_VOCAB` ~L334, `config resolved` loop ~L901, selftest ~L832). Validation: grep for `MODEL_LANE_VOCAB` and the `["build", "prep_explore", "eval"]` loop before editing; add rows, don't restructure.

## 8. DONE — Definition of Done

### From WHY / HOW (the transport migration)
- [ ] prep's three producer dispatches (spec L217–219, methodology L49, spec_review L107–108) are rewritten to the Agent-tool producer-subagent shape (resolve `slots.<name>` + `models.<name>`, dispatch, consume the returned `faff-contract:*` block).
- [ ] jot's intake dispatch (L52) is rewritten to the same producer-subagent shape.
- [ ] Chaining handoffs (prep→graft L252/L285, jot→prep/plot L70/L84, graft→prep/wtf L94/L457) are **unchanged** — still Skill-tool.
- [ ] graft's review (L302) and ship (L386) dispatches are **unchanged** (explicitly out of scope; a comment/prose note records why — single-level nesting).
- [ ] **Manual check:** an interactive `/faff-prep` on a fresh ticket runs producer → attach → confidence gate → spec-review gate → promote in one unbroken flow with **no mid-turn stall** after any producer. (Harness behaviour — verified by a live run, not an automated test; named here as the core AC's manual proof.)

### From WHAT (config keys)
- [ ] `models.spec`, `models.spec_review`, `models.methodology`, `models.intake` exist in `DEFAULTS` (each `"inherit"`) and `MODEL_LANE_VOCAB` (each `["inherit","sonnet","opus","haiku","fable"]`).
- [ ] `faff config get models.spec` (etc.) returns `inherit` by default; an off-vocabulary token exits 2 naming the legal set.
- [ ] `faff config resolved` surfaces a non-default value for each of the four lanes.
- [ ] `faff config defaults --selftest` covers the four new keys and passes.

### From HOW (contract layer unchanged)
- [ ] The `faff-contract:spec-readiness` and `faff-contract:spec-review-verdict` consumer-folds are unmodified; producer `SKILL.md` files are unmodified.

### From HOW (gateway prose)
- [ ] `faff/SKILL.md` Sibling-skill invocation gains the producer-dispatch (Agent, single-level) vs. chaining-handoff (Skill) note.
- [ ] `faff/SKILL.md` L226 Model-selection caveat is updated to reflect that migrated interactive producers now take a `models:` lane.

### From tests
- [ ] `test/models-config.test.mjs` gains default/invalid-token/resolved cases for the four new lanes; the suite passes under `node --test`.
- [ ] `faff validate-adapters` stays green (fewer Skill-tool sites is allowed; no new delegation-literal violations).

**Integration smoke test.**

```
1. faff config get models.spec                      → inherit (exit 0)
2. faff config get models.spec -d …; set models.spec_review=potato; faff config get models.spec_review → exit 2, names legal set
3. node --test test/models-config.test.mjs          → pass (incl. the four new lanes)
4. Manual: interactive /faff-prep <ticket> → spec → attach → gate → promote, one unbroken turn, no stall after a producer
```

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```

confidence: high
