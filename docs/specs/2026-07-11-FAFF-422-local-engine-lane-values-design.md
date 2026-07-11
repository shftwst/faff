# FAFF-422 — Local-engine lane values v1 — one-shot dispatch for pure-data-in lanes (methodology, intake)

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-422.

This spec addresses FAFF-422: extending the per-lane `models.*` vocabulary so an allowlisted lane can name a configured local/self-hosted engine and dispatch on it via a direct-API one-shot, instead of a Claude-family Agent-tool subagent. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model: a lane value now selects a transport, not just a model.** Today every `models.*` value is a Claude-family Agent-token, and every producer dispatch is an in-harness Agent-tool subagent. This change makes the lane value a fork: an Anthropic token keeps today's Agent-tool dispatch byte-for-byte; an engine value routes the same producer request out of session, as a direct-API one-shot HTTP call to a configured engine. The lane value determines the execution vehicle — that is the whole mechanism, and the ADR this ticket carries.

**Problem:** every slot dispatch burns a Claude-family token, even for cheap-judgement, pure-data-in producers like `methodology` (issue-critique) and `intake` (discovery brief). FAFF-315/334/372/416 built per-lane model resolution over a closed Anthropic vocabulary; this extends that vocabulary to reach a local engine (e.g. ollama over Tailscale) so those producers run on local judgement.

**Design principles** (would reject an otherwise-valid implementation):

- **Fail-loud everywhere.** An invalid, mis-typed, non-allowlisted, or unreachable engine terminates the dispatch with a named error. Never a silent fall-back to the session model (the FAFF-50 dropped-slot failure mode). No fallback chain in v1 — a silent chain is a silent downgrade wearing resilience clothes.
- **Claude values are byte-for-byte untouched.** An Anthropic token (`inherit|sonnet|opus|haiku|fable`) keeps today's Agent-tool dispatch exactly — never a spawned process. Any diff to the Anthropic path beyond the branch test is a defect.
- **Composes-with-never-subsumes.** The bespoke engine blocks (`faffter_dark.adversarial`, the eval driver) stay authoritative for their lanes. This adds a third consumer of the direct-API idiom, not a unification of the existing two.
- **Config via `faff config` only; secrets via `api_key_env` indirection** (env var *name* in config, never a key).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/config.js` (DEFAULTS :15–68, `MODEL_LANE_VOCAB`/`validateModelLane` :74–92, `EFFORT_LANE_VOCAB` :94–112) | The closed-vocab, fail-loud lane machinery this extends |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (783 lines; `EXIT` :25, `preflight` :352, anthropic first-call classification :471, `api_key_env` resolution :733–741, `providerFamily` :~50) | Provider-family + preflight + key-indirection precedent; NOT generalised (see RATIONALE) |
| `eval/ollama-model.mjs` (FAFF-136) | The true one-shot precedent: `stream:false` direct `/api/chat`, pure request/parse fns, injectable transport, no localhost default, fail-loud parse |
| `plugin/skills/faff/SKILL.md` :230–244 (models/effort lanes), :862–864 (Producer dispatch) | Gateway prose this updates |
| `plugin/skills/faff-prep/SKILL.md` :49, `plugin/skills/faff-jot/SKILL.md` :52 | The two live dispatch sites reading `models.methodology` / `models.intake` |
| `.faffrc.example.yaml` :48–59 (`models:` block — stale), :179–228 (`faffter_dark.adversarial` — engine-object shape precedent) | Config documentation this refreshes |

**Scope statement:** the next incremental extraction of FAFF-69's per-role engine vision onto today's flat lanes (ADR-0038: factory-first, extract-don't-fork — not roles, not a pipeline).

## 2. OUT OF SCOPE

- **Agentic-loop transport (`claude -p` env-redirect) and tool-needing producers** — v2. Extension point: FAFF-423 adds a third branch to the same dispatch fork (see HOW → dispatch procedure) and reuses the `engines:` map.
- **`spec` / `spec_review` / `prep_explore` / `architecture` lanes on local engines** — prep gates the whole pipeline; excluded from the v1 allowlist. Extension point: widen the allowlist in `validateModelLane` + the dispatch guard.
- **Fallback chains / retry semantics** — deliberately absent (fail-loud principle). Extension point: a future `engines.<name>.fallbacks` list on the FAFF-232 pattern, if ever wanted.
- **`build` / implementer lane** — tool-needing by definition; FAFF-423 territory at the earliest.
- **FAFF-69 role DSL** — this stays flat lanes.
- **Subsuming the bespoke engine blocks** (`faffter_dark.adversarial`, eval driver config) — they keep their own shapes and consumers.
- **Migrating tidy/wtf/map's inline methodology invocations** — FAFF-421's territory. Until 421 lands, a `models.methodology` engine value governs only faff-prep's issue-critique and faff-jot's intake dispatch sites — the engine value simply governs fewer call sites; nothing here blocks on 421 (the human's soft "prefer 421 first" preference is sequencing taste, not a dependency).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Engine | A named, configured non-Anthropic inference endpoint: `{provider, model, host, api_key_env, …}` |
| Engine value | A `models.<lane>` value of the form `engine:<name>`, referencing `engines.<name>` |
| Pure-data-in producer | A producer whose dispatch payload contains everything it needs — no tool use, no repo access (`methodology`, `intake`) |
| v1 allowlist | The set of lanes that may carry an engine value: `models.methodology`, `models.intake` |

**Config shape:**

```
# .faffrc.yaml
engines:                      # top-level map, keyed by engine NAME (not by lane)
  studio:
    provider: ollama          # v1 families: ollama | openai-compatible aliases (openai, vllm, openrouter, nvidia, deepseek, gemini)
    model: qwen3-next:80b
    host: http://studio.longhair-escalator.ts.net:11434
    api_key_env:              # env var NAME, optional (LAN ollama needs none)
    reasoning_off: false      # optional, per the adversarial-block idiom
    timeout: 120              # optional, seconds, one attempt

models:
  methodology: engine:studio  # allowlisted — resolves engines.studio
  intake: engine:studio       # allowlisted
  # any other models.* lane given an engine: value FAILS LOUD at read (exit 2)
```

**Chosen:** string-union lane value (`engine:<name>` prefix) + a top-level `engines:` map keyed by engine name — over (a) a bare string union without a prefix, (b) an `engines:` map keyed by lane, (c) a per-lane inline object under `models.<lane>`. The prefix keeps the lane value a scalar, so `MODEL_LANE_VOCAB`/`validateModelLane` extends rather than forks and a bare typo can never collide with a future Anthropic token; keying `engines:` by name lets one definition serve both lanes (methodology and intake typically share the studio host); an inline object would make `models.<lane>` polymorphic (string-or-map), forking every read site and the YAML-subset parser expectations. The engine object's field set deliberately mirrors the `faffter_dark.adversarial` flat-object shape (`.faffrc.example.yaml:179–228`) — same idiom, separate block (compose-not-subsume).

**Chosen:** v1 provider families = `ollama` + the openai-compatible aliases (reusing `providerFamily`'s whitelist semantics from review-call.mjs). `provider: anthropic` inside an `engines:` entry is **refused loudly** at resolution — Anthropic engines are what the Agent-token vocabulary is for; admitting them here would create two spellings of the same dispatch with different transports.

**Resolution + validation surface (all in `config.js`, all fail-loud exit 2 with a named error):**

- `validateModelLane` extension: for the two allowlisted lanes, legal values = the existing Anthropic set ∪ `engine:<name>` (any name — existence checked at resolution). For every other `models.*` lane, an `engine:` value is off-vocabulary and the error names the allowlist: `engine values are only legal on models.methodology | models.intake (FAFF-422 v1 allowlist)`.
- `engine:<name>` where `engines.<name>` is absent or missing `provider`/`model`/`host` → named error listing the configured engine names / the missing field.
- Non-default `models.*` values already echo through `faff config resolved` — engine values ride that for free (a pinned engine is visible in the run banner, never silent).

**Chosen:** the allowlist is enforced **twice** — at config read (`validateModelLane`, catches a mis-set `.faffrc` at `faff config get`) *and* at dispatch (`faff engine call --lane <lane>` refuses a non-allowlisted lane, catches a prose bug passing the wrong lane). Both live in the same CLI; the second guard is ~3 lines and closes the seam where prose could bypass read-time validation. This IS the v1 capability-mismatch guard — enforced, not documented.

**Chosen:** a non-`inherit` `effort.<lane>` combined with an engine value on the same lane is **refused loudly** at dispatch (named error), not silently dropped. Agent-tool reasoning-effort semantics don't map onto arbitrary local engines; per-engine tuning belongs in the engine object (`reasoning_off`, future options), and a configured knob that silently does nothing is the exact masquerade `validateEffortLane`'s FAIL-LOUD exclusion comment already forbids (config.js:106–110).

**New CLI surface:**

```
faff engine call --lane <lane> --system <file> --user <file> [--root DIR]
  stdout: the engine's completion text (the producer output)
  exit 0: ok
  exit 2: usage / config fault (non-allowlisted lane, unknown engine, missing field,
          off-vocabulary value, anthropic-provider engine, effort-lane conflict)
  named non-zero exits (distinct codes, build's numbering): model-not-served ·
  engine-unreachable · auth-failed (declared api_key_env unset, or HTTP 401/403) ·
  malformed-response
```

Exit codes are engine-call's own small taxonomy — it deliberately does NOT reuse review-call's `EXIT` table, because that table encodes review-verdict routing (pass+skip semantics) this ticket forbids. Every non-zero exit is terminal for the dispatch: the caller surfaces/parks per its existing failure handling, and never falls back to the session model.

## 4. HOW — Behavior

**Architecture:** one new resolution seam in `config.js`, one new CLI subcommand (`faff engine call`) owning transport, two dispatch-site prose edits (faff-prep :49, faff-jot :52), gateway + example-config doc updates. No new config channels, no changes to any Agent-tool code path.

**Dispatch procedure** (the transport fork — this is the ADR's subject):

```
PROCEDURE dispatch_producer(lane, payload):
  1. value = `faff config get models.<lane>`        # exits 2 on any invalid value — stop, surface
  2. IF value is an Anthropic token (inherit|sonnet|opus|haiku|fable):
     a. Agent-tool subagent dispatch, exactly as today (model param, effort lane, run_in_background:false)
        — byte-for-byte, per gateway → Producer dispatch
  3. IF value is engine:<name>:
     a. Write system prompt + user payload to files (see prompt assembly)
     b. Run `faff engine call --lane <lane> --system <f1> --user <f2>` via Bash
     c. exit 0 → stdout IS the producer output; proceed to the caller's existing
        normalisation/validation (unchanged — prep renders/omits the critique block,
        jot normalises a non-conformant brief)
     d. non-zero → LOUD failure: surface the named error; autonomous callers park per
        their existing failure path. NEVER re-dispatch on the session model.
```

**Prompt assembly.** A one-shot direct-API call has no tools and no ambient context — unlike an Agent subagent, it cannot read the slot SKILL.md itself. **Chosen:** the dispatch site assembles system = the resolved slot skill's `SKILL.md` contents (resolved per the gateway's sibling-resolution rule, same as any slot); user = the same request payload the prose would have passed to the Agent subagent (issue data + named-output request for `issue-critique`; mode/description/workstream context for `intake`). This is why the allowlist is exactly the pure-data-in producers: their SKILL.md + payload is self-sufficient. Alternative rejected: baking producer prompts into the helper — that would fork the slot's single source of truth and break slot swappability.

**`faff engine call` internals** (build translates; language-agnostic):

```
PROCEDURE engine_call(lane, systemFile, userFile):
  1. Enforce lane allowlist (exit 2 if not methodology|intake)
  2. Resolve models.<lane>; require an engine: value (exit 2 otherwise); resolve engines.<name>
  3. Refuse anthropic provider; refuse non-inherit effort.<lane> (exit 2, named)
  4. IF api_key_env declared: key = env[api_key_env]; unset → auth-failed exit, named
  5. Reachability (family-conditional, see below); failure → named exit
  6. ONE non-streaming completion (ollama: /api/chat with stream:false, per
     eval/ollama-model.mjs; openai-compatible: /v1/chat/completions with stream:false)
  7. Parse fail-loud (missing content field → malformed-response exit, body excerpt in the error)
  8. Print content; exit 0. No retry, no fallback, no second backend.
```

**Reachability — Chosen:** family-conditional, mirroring review-call.mjs's per-family precedent: where the family exposes a probe (ollama `/api/tags`, openai-compatible `/v1/models`), preflight before the completion call — it splits *engine-unreachable* (infra) from *model-not-served* (config fault) into distinct named errors, exactly the distinction review-call's `preflight` (:352) exists for, at the cost of one cheap LAN round trip. A family without a probe would fail classified at first call (the review-call anthropic precedent, :471) — moot in v1 since both admitted families have probes, but the rule is stated so FAFF-423 doesn't reinvent it. Both paths terminate the dispatch with a named error; the probe changes error *quality*, never outcome.

**Anti-pattern:** catching an engine failure at the dispatch site and "helpfully" re-running the producer as an Agent subagent. Why: that is the silent session-model fallback this ticket exists to forbid — a degraded dispatch must be visible, not absorbed.

**Anti-pattern:** generalising review-call.mjs with a `--mode one-shot` flag. Why: its exit taxonomy, chain, deadline, and pass+skip machinery are review-verdict semantics; threading a mode through 783 review-specific lines risks the review lane to save ~150 fresh lines (see RATIONALE).

**Failure modes:**

- **The local model can't hold the envelope** (critique axes / discovery-brief shape) even with the SKILL.md as system prompt. How you'd know: the done-signal end-to-end run returns transport-clean output that the caller's normalisation can't rescue. What it means: transport ships regardless (it's model-agnostic); the *default recommendation* for these lanes stays `inherit` until a given local model proves envelope-capable — a config choice, not a code change. Narrow, don't abandon.
- **Prompt-assembly divergence** — the one-shot payload drifts from what Agent dispatch passes, so engine output quality is unfairly bad. How you'd know: same issue critiqued on `inherit` vs `engine:studio` differs structurally, not just in judgement quality. What it means: fix the payload assembly prose; the "same payload" rule above is the guard.

**Testing posture** (house pattern, per ollama-model.mjs / review-call.mjs): request-builder, response-parser, lane/allowlist/engine resolution are pure and unit-tested; transport injectable; CI makes zero real network calls.

## 5. Scenarios

```
Given engines.studio (ollama, reachable) and models.methodology: engine:studio
When faff-prep requests issue-critique for an issue
Then `faff engine call --lane methodology` runs one non-streaming completion against
     studio and exits 0, and prep's critique block renders from its stdout
     — no Agent-tool dispatch occurs for that producer
```

```
Given models.intake: sonnet
When faff-jot dispatches the intake producer
Then the dispatch is an Agent-tool subagent with model "sonnet" — byte-for-byte today's path
```

```
Given models.methodology: engine:studio and studio's host unreachable
When prep dispatches issue-critique
Then faff engine call exits non-zero naming engine-unreachable, the caller surfaces/parks,
     and no session-model producer run occurs
```

```
Given models.build: engine:studio in .faffrc
When anything runs `faff config get models.build`
Then exit 2, error naming the value and the v1 allowlist (methodology | intake)
```

```
Given models.intake: engine:nope with no engines.nope block
When `faff config get models.intake` (or dispatch) runs
Then exit 2 naming the unknown engine and the configured engine names
```

Assertions (non-functional): CI runs no real network calls for the new code; `faff config resolved` echoes a non-default engine value; secrets never appear in config, argv, or logs (env-name indirection only).

## 6. Design Decision Rationale

- **Config shape?** Inline per-lane object vs lane-keyed map vs name-keyed `engines:` + `engine:<name>` string-union. **Chosen:** name-keyed `engines:` + prefix string-union — scalar lane values keep the existing closed-vocab machinery intact, one engine serves many lanes, the prefix is collision-proof and greppable. (Marked in WHAT.)
- **Reuse/generalise review-call.mjs vs fresh helper?** review-call is the most battle-tested transport in the repo, but its shape is review-semantic: streaming-first, chain/fallback/deadline machinery, and an exit taxonomy whose pass+skip routing is precisely what FAFF-422 forbids. eval/ollama-model.mjs is the true one-shot precedent but pulls eval-only deps (imports cli-driver.mjs) and is ollama-only. **Chosen:** a fresh, small `faff engine call` (CLI subcommand per deterministic-tools-over-prose; ~150 lines on the ollama-model.mjs pattern), borrowing review-call's *idioms* — `providerFamily` mapping, preflight, `api_key_env` resolution — as patterns, not as a shared module in v1. Compose-not-subsume: review-call stays untouched and authoritative for its lane. At the time of writing a shared transport module is premature with two consumers of divergent semantics; FAFF-423 is the natural point to revisit extraction.
- **Probe at dispatch vs fail at first call?** **Chosen:** family-conditional preflight (marked in HOW) — better-*named* errors for free where a probe endpoint exists, review-call precedent both ways.
- **Where does enforcement live?** **Chosen:** read-time + dispatch-time, both in the CLI (marked in WHAT) — prose is never the enforcement layer.
- **Effort lanes × engines?** **Chosen:** loud refusal on the combination (marked in WHAT) — no knob that silently does nothing.

## 7. Open Questions and Assumptions

**Open questions:** none — all three ticket-mandated questions are Chosen above.

**Assumptions:**

- **Assumes:** a reachable ollama engine (the studio Tailscale host, per FAFF-132: `http://studio.longhair-escalator.ts.net:11434`) is configured in the dev `.faffrc.yaml` at build time for the end-to-end done-signal. Validation: `curl <host>/api/tags` before starting; if down, the end-to-end criterion is verified against any reachable ollama and the CI-side coverage stays mock-transport.

## 8. DONE — Definition of Done

### From WHY
- [ ] An Anthropic-token lane value dispatches exactly as today — no diff in the Agent-tool path beyond the branch test (byte-for-byte criterion).

### From WHAT (config + validation)
- [ ] `engines:` map parses via the existing YAML-subset reader; `faff config get engines.<name>.<field>` resolves.
- [ ] `models.methodology` / `models.intake` accept `engine:<name>`; every other `models.*` lane rejects it at read with exit 2 naming the allowlist.
- [ ] Unknown engine name / missing provider|model|host / `provider: anthropic` / unset declared `api_key_env` / non-inherit `effort.<lane>`-with-engine each fail with a distinct named error.
- [ ] Non-default engine values echo in `faff config resolved`.

### From HOW (dispatch + transport)
- [ ] `faff engine call --lane <lane> --system <f> --user <f>` performs one non-streaming completion (ollama `/api/chat` stream:false; openai-compatible `/v1/chat/completions`), prints content, exit 0.
- [ ] Family-conditional preflight: unreachable vs model-not-served are distinct named exits.
- [ ] Non-allowlisted `--lane` refused at dispatch (exit 2) independent of config state.
- [ ] faff-prep :49 and faff-jot :52 prose branch on the resolved value: Anthropic token → Agent tool; `engine:` → `faff engine call`; non-zero exit → surface/park, never session-model fallback.
- [ ] Pure fns unit-tested (`node --test`), transport injectable, zero real network calls in CI.

### From WHY/WHAT (docs — same-PR, docs never go stale)
- [ ] Gateway `faff/SKILL.md` :232 (invocation classes), :236–244 (lane docs + compose-not-subsume), :862–864 (Producer dispatch fork) updated coherently; the bespoke engine blocks explicitly not subsumed.
- [ ] `.faffrc.example.yaml`: new `engines:` block documented; stale `models:` block (:48–59) refreshed to list all current lanes (methodology/intake/spec/spec_review/architecture) — the folded-in doc fix.
- [ ] `docs/cli.md` covers `faff engine call` (FAFF-237 invariant).

### End-to-end (done-signal)
- [ ] methodology or intake configured to the studio ollama engine dispatches end-to-end and returns valid slot output (envelope intact, caller validation unchanged).

**Integration smoke test:** configure `engines.studio` + `models.intake: engine:studio`; run a jot intake dispatch; assert the discovery brief renders and no Agent-tool intake dispatch occurred. Then point `host` at a dead port; assert the named engine-unreachable failure surfaces and nothing runs on the session model.
