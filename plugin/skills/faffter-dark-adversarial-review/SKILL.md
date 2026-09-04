---
name: faffter-dark-adversarial-review
description: "Adversarial second-opinion code review for the `review` slot: a standard structural pass plus an adversarial review by a different LLM to catch correlated blind spots. Returns the fixed review-verdict (faff contract review-verdict --describe). Swappable review occupant; runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: refutation-code, adr-drift, prdr-yagni
---

# faffter-dark-adversarial-review

Two-phase code review: standard structural review (delegated to `faffter-noon-review`) followed by an adversarial second opinion via a different LLM. Catches correlated blind spots by bringing different training biases from the model that wrote the code.

Plugs into the `review` slot — replaces the default review, not augments it. The hard signal it returns conforms to the gateway Review-verdict contract (canonical semantics: `faff contract review-verdict --describe`). The adversarial phase adds evidence, never a fourth verdict.

Configure in `.faffrc`:

```yaml
slots:
  review: faffter-dark-adversarial-review
```

## When it runs

Invoked by faff-graft Step 9 as the configured `review` skill.

## Two phases

### Phase 1: Standard review (delegated to faffter-noon-review)

Runs the full `faffter-noon-review` five-pass review (AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging). If this returns anything other than the approving verdict, return that signal immediately — no point running the adversarial pass on code that hasn't passed basic review.

### Phase 2: Adversarial review (different LLM)

Only runs if Phase 1 returned the approving verdict. Sends the diff to a structurally different model for an independent second opinion. This is not a repeat of Phase 1 — it targets what same-model review is likely to miss. The backend call is made by the bundled **`review-call.mjs`** helper (preflight + streaming + reasoning-off + token budget) — **not** a hand-rolled API call; see **Backend call** below.

## Input

Faff-graft provides:

- The full diff: `git diff main...HEAD`
- The spec (from the issue comment)
- The Phase 1 review result (for context, not for agreement — Phase 2 must form its own opinion)
- The **`autonomous` signal** — a boolean, `true` on **any** unattended run (L3 overnight *or* L4 lights-out), `false`/absent on an interactive (L2) run. faff-graft forwards it; the slot never resolves it itself. It gates the Phase-2 `critical` escalation (see **Autonomous-run escalation**) and the full-chain-outage annotation (see **Backend call** → the exit-code table). Default it to `false` whenever it is not forwarded — an unresolved signal never escalates and never annotates (fail-safe to interactive semantics).
- The **`lights_out` signal** — a boolean, `true` only on a lights-out (L4) run (L4 = `autonomous ∧ lights_out`); forwarded alongside `autonomous`, orthogonal to it. The Phase-2 escalation and the exit-5 outage annotation key off `autonomous`, not this — so they fire at L3 too. The **one** behaviour that keys off `lights_out` is the **MANDATORY chain-outage fail-closed** (below): L4 is the only place the second opinion is *mandatory* (`dialCoherence` requires the adversarial occupant there) **and** no human is watching at all, so an exhausted chain fails closed — whereas an L3 overnight run keeps today's pass+skip because a morning human reads the loudly-annotated skip.

## Output

Phase 1 returns a hard signal (canonical semantics: `faff contract review-verdict --describe`) per `faffter-noon-review`.

Phase 2 returns a **soft signal** — findings only, no verdict. The adversarial reviewer may be a less capable model; its findings are hypotheses, not rulings. Attribution — naming which backend served the response — is **not** the model's job (see below); the reviewer's job is the finding body:

```
## Adversarial findings — `<provider>/<model>` (chain[<i>], host: <source>)

### [severity]: [title]
[description of the concern and why it might matter]
```

Severities: `critical`, `major`, `minor`, `observation` — but these are the adversarial reviewer's assessment, not a gate decision.

**When there are no findings, emit exactly one section: `### observation: no findings`**. A clean review that emits nothing findings-shaped is indistinguishable from a malformed one — see **Output-format enforcement** below — so a well-behaved model with nothing to report still produces a recognised section, not empty/prose-only output.

**The spec-refuter prompts speak a narrower closed grammar instead** — one of four byte-exact affirmation sentences (`No <lens> objection.`), optionally under a heading. `normaliseCleanRefutation` (`review-call.mjs`) recognises **four** forms and mechanically rewrites any of them to the canonical `### observation: no findings` token before the shape check runs: `bare` (the sentence alone), `headed` (the exact `## Refutation — <lens>` heading then the sentence), `headed+signal` (methodology-only: heading, its no-signal diagnostic line, then the sentence), and `header-wrapped` (the sentence under any other single decorative heading — `# Code review`, `## Second opinion`, and the like). Only the wrapper varies; the affirmation sentence itself stays byte-exact in every form, so a paraphrased or reworded sentence still advances as garbled.

**The header is harness-authored, not model prose — the lens never has to name its own model.** `review-call.mjs` prepends the `## Adversarial findings — <provider>/<model> (chain[<i>], host: <source>)` line itself, from the winning backend's own provenance (`attributionHeader`) — the chain position and host source, not just the provider/model, so the exact serving backend is reconstructible without inference. It normalises the line unconditionally: prepending it when absent, replacing it (never trusting a model-echoed, possibly-wrong tag) when present. A custom `--system` lens — even one that drops any self-naming instruction entirely — still gets a correctly-attributed header; a lens that *does* still self-name produces at most harmless duplication (the transport's line is first and authoritative). Don't instruct the model to name itself; it was never a load-bearing part of the contract, and now it is guaranteed not to be needed.

**Refuted findings arrive pre-downgraded.** Before this output reaches the implementor, `review-call.mjs` runs a deterministic refutation pass over machine-checkable syntax/parse claims (v1 scope): a `critical`/`major`/`minor` finding claiming a context file "won't parse" is downgraded to `severity: observation` with an `[auto-refuted]` title prefix and a `node --check` evidence line, **iff** every file the claim ties to positively passes the check. A refuted finding is never dropped — the downgrade + evidence line is the audit trail of what the reviewer got wrong.

## How findings are handled

The adversarial findings are raised back to the **implementor** (the build agent). The implementor must:

1. **Consider each finding** — read it, understand the concern
2. **Prove or disprove with conviction** — check the code, the spec, the tests. Either demonstrate why the finding is a false positive (cite the specific line, test, or spec clause that addresses it) or acknowledge it as valid.
3. **Log each disposition** — record every finding and its disposition (proven false / valid + fixed / valid + accepted risk with rationale) in the per-issue `.faff/logs` graft log. Per faff-graft Step 9's **collapse-and-log** policy, these dispositions **fold into the single terminal review comment's summary** — never one tracker comment per finding (the granularity rule). That one comment is located/updated by its marker pair per the comment-identity contract (**gateway → Review-findings comment identity**).
4. **Fix if necessary** — if any finding is valid and actionable, fix the code
5. **Re-run primary review** — if fixes were made, re-run Phase 1 to confirm nothing regressed

On an **interactive (L2)** run the adversarial review **never directly blocks the pipeline** — it produces signal that the implementor must address with evidence. On an **autonomous (L3/L4)** run there is one exception: a Phase-2 `critical` escalates the returned hard signal to `needs-human` so the merge stops (see **Autonomous-run escalation**) — no human is awake to weigh a soft `critical`, and on an autonomous run the accused must not be the one to clear its own indictment. A dismissed finding with weak rationale ("I don't think that's a problem") is itself a smell — the disposition must be specific and verifiable.

This soft-signal design reflects that the adversarial model may produce lower-quality findings than the primary model. The value is in surfacing blind spots for consideration, not in gating on a potentially less capable reviewer's judgement.

## Review lens

This is NOT a repeat of the primary review. The adversarial reviewer looks for things a same-model review is structurally likely to miss:

**1. Specification gaming** — does the code technically satisfy the spec while missing the spirit? Look for:
- Trivial implementations that pass ACs without delivering value
- Edge cases acknowledged in the spec but handled with no-ops or swallowed errors
- Tests that assert implementation details rather than behaviour

**2. Implicit assumptions** — what does the code assume that neither the spec nor the code explicitly validates?
- Ordering assumptions (events arrive in sequence, config loads before use)
- Size/cardinality assumptions (fits in memory, single item, non-empty)
- Environment assumptions (file exists, network reachable, permissions granted)

**3. Failure mode blindness** — what happens when things go wrong?
- Missing error paths (what if this throws? what if this returns null?)
- Partial failure (3 of 5 items succeed — what state are we in?)
- Resource leaks (opened but not closed on error path)

**4. Security surface** — changes that expand the attack surface:
- New user input without validation/sanitisation
- Changed auth/authz boundaries
- Secrets in code, logs, or error messages
- SQL/command/template injection vectors

**5. Concurrency and ordering** — race conditions the happy-path author didn't consider:
- Shared mutable state without synchronisation
- Time-of-check to time-of-use gaps
- Event ordering assumptions in async flows

**When this lens finds nothing** — this text is the `--system` prompt (below); the reviewer MUST still emit exactly one recognised finding section, `### observation: no findings`, rather than empty or free-form prose. `review-call.mjs` mechanically enforces findings-shaped output — see **Output-format enforcement** and exits `10`/`11` below — so a clean review that doesn't emit this marker is indistinguishable from a malformed or empty one.

## LLM provider integration

**The network call is made only by the bundled `review-call.mjs` helper** (via `review-spawn.mjs`) — never a hand-rolled request. The cage sandbox blocks a raw call straight to a backend host (recorded under `permission_denials`), so hand-rolling one costs a wasted turn recovering to the sanctioned path; see **Backend call** below for the actual invocation. Everything between here and **Backend call** is backend **configuration** the helper consumes internally on your behalf — not a request shape to construct yourself.

The skill supports any LLM backend. Configure which one it should use in `.faffrc`:

```yaml
adversarial:
  provider: ollama                 # ollama | openai | vllm | openrouter | nvidia | deepseek | gemini | anthropic — ollama is an OpenAI-compatible ALIAS, not a native transport
  model: llama3.1:70b              # provider-specific model identifier
  host: http://localhost:11434/v1  # base URL incl. /v1 — every provider is OpenAI-compatible now (ollama included); a bare (non-/v1) host fails loud at preflight
  api_key_env: NVIDIA_API_KEY      # env var NAME holding the API key (not the key itself)
  reasoning_off: false             # true → send chat_template_kwargs:{thinking:false, enable_thinking:false} (reasoning models)
  # reasoning_extra: {reasoning: {enabled: false}}   # per-model reasoning-control passthrough merged verbatim (deepseek off-switch; north: {thinking: {type: disabled}}); see reasoning_extra below
  timeout: 120                     # seconds — bounds ONE stream attempt
  first_byte_timeout: 60           # seconds — per-attempt first-byte (TTFT) window, DEFAULT-ON (60s).
                                   #   A backend that CONNECTS but streams no first byte within this window
                                   #   fast-fails and the chain advances — a buffering server (LM Studio / MLX)
                                   #   no longer idle-hangs the full `timeout`. Per-backend (inherits like timeout);
                                   #   set 0 to disable. Distinct from `timeout` (gaps between LATER bytes).
  deadline: 480                    # TOTAL wall-clock budget (seconds) across ALL attempts + fallback backends;
                                   #   default 480 (8 min, under the 900s runcheck staleness window) — a human-tunable
                                   #   turn-fit budget so the slow Phase-2 fits one subagent turn (too tight ⇒ more
                                   #   skipped_deadline, too loose ⇒ the stall it prevents returns).
                                   #   this total is SLICED per-backend — each backend gets deadline/remaining-backends,
                                   #   not the whole budget — so a hung primary is abandoned at its slice and the fallbacks still run.
  fallbacks: '[{"provider":"ollama","model":"qwen3-next:80b","host":"http://studio:11434/v1"}]'   # optional
```

**Fallback chain.** The scalar block above is the **primary** backend. An optional `fallbacks` key adds an **ordered list of further backends**, each tried — in order — only when the one before it fails to produce findings (rate-limit, unreachable, persistent transport failure, auth, not-served). The first backend that returns findings wins; the chain reaches a terminal outcome only when **every** backend has failed. This keeps the L4 second-opinion gate firing through a single provider's outage instead of silently `pass+skip`ping.

- **Value is a JSON-string** — a quoted JSON array of backend objects `{provider, model, host, api_key_env?, reasoning_off?, timeout?}`. (The config parser also handles native YAML lists — `faff adversarial-backends` accepts both forms — but the JSON-string form remains the canonical shape for this key; existing configs keep working unchanged.) Omit it for the single-backend behaviour (a one-element chain — unchanged).
- **Each fallback is self-contained** (its own `provider`/`model`/`host` required); omitted optional keys (`api_key_env`, `reasoning_off`, `reasoning_effort`, `reasoning_extra`, `timeout`, `first_byte_timeout`) inherit the primary's — assembled **mechanically** by `faff adversarial-backends`, never hand-`JSON.parse`d by the model (see **Backend call** below).
- **No silent weakening** — an all-failed chain is never more pass-like than today's single backend: a config fault (auth / not-served / unsupported / unconfigured-default-host) anywhere in a fully-failed chain surfaces `needs-human`; only a chain of purely configured-host availability failures `pass+skip`s. The chain loop + terminal precedence live deterministically in `review-call.mjs` (`runReviewChain` / `chainTerminalExit`), not in this prose.

**Transport families (helper-internal — how `review-call.mjs` dispatches on `provider`; not a recipe to call yourself). Two shapes survive (down from three — the native ollama transport was folded onto the OpenAI-compatible path):**

| Provider | Transport | Host | Auth | Notes |
|---|---|---|---|---|
| `ollama` `openai` `vllm` `openrouter` `nvidia` `deepseek` `gemini` | OpenAI-compatible (`/v1/models` + `/v1/chat/completions`, SSE) | `host` = base URL **including `/v1`** (e.g. `https://integrate.api.nvidia.com/v1`; local ollama/oMLX: `http://localhost:11434/v1`; **gemini**: `https://generativelanguage.googleapis.com/v1beta/openai`) | `Bearer` from `api_key_env` (local/no-auth: omit) | One code path for every OpenAI-shaped API. `ollama` is an OpenAI-compatible **alias**, not a native transport — a bare (non-`/v1`) host fails loud at preflight (`unreachable`/`model-not-served`), never a silent pass. `gemini` rides Google's OpenAI-compat base URL — no adaptor of its own |
| `anthropic` | native (`/v1/messages`, named-event SSE) | `host` = `https://api.anthropic.com` | `x-api-key` + `anthropic-version` from `api_key_env` | No preflight (no model-list endpoint — a bad model id surfaces as a 404 → `needs-human`); no `reasoning_off`. Kept native by design — Claude's extended thinking can't cross to a plain `/v1/chat/completions` |

An unknown provider exits `2` (loud), never a silent pass. (A malformed `gemini` key returns HTTP 400 `API_KEY_INVALID`, which the helper classifies as auth → `needs-human`, never a silent `pass+skip`.)

**Anti-pattern: hand-rolling the backend request.** Reconstructing the endpoint path, host, and auth header above into a `python3`/`curl`/raw-HTTP call outside `review-call.mjs` — even though the table gives enough detail to do it. Why: the cage sandbox blocks raw backend egress (`permission_denials`), and recovering from the block to the sanctioned helper wastes a turn. `review-call.mjs` (via `review-spawn.mjs`) is the only network path this skill uses; see **Backend call** below.

**`reasoning_off`** — set `true` for a reasoning model that streams empty `content` unless its hidden think-block is disabled (e.g. NVIDIA `deepseek-*`, Qwen3/MLX-family servers, local ollama/oMLX). It adds `chat_template_kwargs:{thinking:false, enable_thinking:false}` to the OpenAI-compatible payload. `enable_thinking` is the key Qwen3/vLLM/SGLang/HF/MLX chat templates actually read to gate the think phase; `thinking` is retained alongside it for compatibility with any server that reads the older key, at zero cost since unrecognised kwargs are ignored. It is **opt-in** because vanilla OpenAI rejects the unknown field — leave it `false` for GPT-4o/o-series. **Migration note:** the deleted native ollama transport forced thinking off unconditionally, regardless of this flag; the OpenAI-compatible path only disables it when `reasoning_off` is explicitly `true` — a migrated ollama backend that relied on the old implicit always-off behaviour must set it.

**`reasoning_extra`** — a per-backend object merged **verbatim** onto the OpenAI-compatible payload, the escape hatch for a reasoning-control shape faff doesn't model natively. Reasoning models diverge on the wire for the *same* intent, so `reasoning_off` alone (which only emits `enable_thinking`) reaches some and not others. Confirmed per-model recipes: `reasoning_extra: {reasoning: {enabled: false}}` for OpenRouter/**deepseek** (its off-switch — `enable_thinking` is ignored there); `reasoning_extra: {thinking: {type: disabled}}` for Cohere/**north** (ignores top-level `reasoning_effort`); `reasoning_extra: {reasoning_effort: low}` for **qwen3** (which does honour the top-level field). The merge is **fail-closed**: only `reasoning`, `thinking`, `reasoning_effort`, `chat_template_kwargs` are allowed — any other key throws (a typo never silently egresses), and faff-managed transport keys can't be clobbered. It merges **last** (an explicit `reasoning_extra` wins per key over `reasoning_off`/`reasoning_effort`; `chat_template_kwargs` deep-merges one level so it composes with `reasoning_off`).

**Caveat — reasoning-off trades detection depth (measured).** The graded-effort lever does **not** scale to large payloads: reasoning expands to fill the output budget and still empties (a 55KB diff drove qwen to 22K chars of reasoning at a 6K cap, zero findings). Turning reasoning fully *off* is the only lever that yields a parseable verdict on a large payload — but an off reviewer **misses real findings** an on reviewer catches (measured: reasoning-off deepseek returned `no findings` on an `eval "$USER_INPUT"` diff that reasoning-*on* flagged `### critical: command injection`). So reasoning-off is a way to get *a* verdict from a model that would otherwise empty, **not** a rigorous adversarial gate. For a genuinely thorough large-diff review, decompose the payload into chunks small enough that a reasoning-*on* model has budget to both reason and emit.

The key principle is **independence from the primary model**. If Claude wrote the code and ran the primary review, **don't set `provider: anthropic` here** — a same-family reviewer shares the blind spots the second opinion exists to catch. Use a structurally different model family (a local ollama model, a `gemini`, an `openai`/`nvidia`/`deepseek` backend) to maximise the chance of catching correlated blind spots.

**Backend call — the bundled `review-call.mjs` helper (do not hand-roll the API call).** The robust call is a tool, not prose: `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` does model **preflight** (`/v1/models` for every OpenAI-compatible provider, ollama included; anthropic has none), think-suppression (`--reasoning-off`, uniform across every OpenAI-compatible provider), **streaming** (SSE for OpenAI-compatible, named-event SSE for anthropic — so a long response doesn't drop the connection), and a **token budget** with one truncation retry.

**Assemble the chain mechanically — never `JSON.parse` `adversarial.fallbacks` or hand-merge the primary/fallback objects yourself.** Run the bundled **`faff adversarial-backends`** subcommand (resolved the same way as the rest of the CLI — `command -v faff`, else the skill's own install path) and branch on its exit code — this is the **single mechanical path** for both a one-backend config and a multi-backend fallback chain, so there is no per-flag `faff config get provider/host/model/api_key_env/reasoning_off` assembly left to retype:

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
backends_json=$(mktemp)
# Per-consumer: which per-consumer chain this call selects. Set by the CALLING
# seam, never baked into the shared block: the refutation-code (code review) seam
# sets code_review; the prdr-yagni seam sets prdr_review; the adr-drift seam leaves
# it UNSET so it falls through to the shared adversarial.* chain. An unset
# per-consumer key resolves byte-identically to today's shared chain / timeout.
consumer=code_review
"$faff" adversarial-backends ${consumer:+--consumer "$consumer"} > "$backends_json"; backends_exit=$?
if [ -n "$consumer" ]; then timeout=$("$faff" config get "adversarial.$consumer.timeout"); fi
[ -z "$timeout" ] && timeout=$("$faff" config get adversarial.timeout -d 120)
deadline=$("$faff" config get adversarial.deadline -d 480)   # global — not split per-consumer
# Output-token cap (max_tokens): per-consumer override, else global, else the 2000 default.
# Same two-read fallback + [ -n "$consumer" ] guard as timeout (an unset consumer would query the
# malformed `adversarial..max_tokens`). The -gt 0 guard resets a present-but-non-positive-integer
# value (empty/non-numeric/float/0/negative) back to 2000, so no NaN/null/max_tokens:0 reaches the wire.
if [ -n "$consumer" ]; then max_tokens=$("$faff" config get "adversarial.$consumer.max_tokens"); fi
[ -z "$max_tokens" ] && max_tokens=$("$faff" config get adversarial.max_tokens -d 2000)
[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000

case "$backends_exit" in
  0)
    node "$REVIEW_SPAWN" --deadline "$deadline" -- \
    node "$REVIEW_CALL" --backends-json "$backends_json" --timeout "$timeout" --deadline "$deadline" \
      --max-tokens "$max_tokens" \
      ${run_dir:+--run-dir "$run_dir"} \
      --system <review-lens-file> \
      --context <each file the diff touches> \
      --diff <git-diff-file>
    ;;
  3) : ;; # unconfigured — author needs-human directly, below; no chain to call the helper with
  2) : ;; # malformed adversarial.fallbacks JSON — author needs-human directly, below
esac
```

**The call is wrapped in a bounded, killable single-shot process-group spawner — `review-spawn.mjs`, resolved beside `review-call.mjs` (`$REVIEW_SPAWN`, alongside however `$REVIEW_CALL` itself is resolved).** This is a process-lifecycle net only, inserted at this one shell line — it changes nothing about how `review-call.mjs` is invoked or disposed. `review-spawn.mjs` launches `review-call.mjs` in its own process group (`detached:true`) and arms a hard-kill timer at `--deadline` (the same total budget passed to `review-call.mjs`'s own `--deadline`) plus a small `--grace` margin. On the healthy path — the overwhelming majority — `review-call.mjs` exits well inside that budget and the wrapper returns its exit code **verbatim, unchanged** (0/2/4/5/6/7/8/9/10 — every row in the **Exit code → Phase-2 outcome** table below still applies exactly as written; no new row, no new signal). Only if `review-call.mjs` is still alive at `deadline + grace` — a wedged process, or one that self-backgrounded a child and slipped the foreground-only enforcement this skill's own posture already requires (a defence-in-depth backstop under that fence, not a replacement for it) — does the wrapper SIGKILL the **whole process group** (reaching a self-backgrounded child even after it reparents to init — a reparented orphan's process-group id is unchanged by reparenting, so it stays reachable by a group signal even though the orchestrator alone cannot kill it directly) and return exit **`8`**, the same code `review-call.mjs`'s own graceful deadline already produces, so the existing exit-8 disposition (pass + skip, logged loudly, `phase2: skipped-deadline`) applies unchanged. The wrapper logs its own hard-kill firing loudly and distinctly on stderr, so a mis-tuned budget or a genuine slipped-fence event stays diagnosable even though the disposition is identical. See `plugin/skills/faffter-dark-adversarial-review/review-spawn.mjs` and its shared primitive `plugin/skills/faff/bin/lib/killable-spawn.mjs` (relocated there so the shared operation supervisor can import it too) for the implementation; nothing below this point changes.

- **exit `0`** — `$backends_json` holds the primary-first JSON array `review-call.mjs`'s `--backends-json` mapper consumes verbatim (`{provider, model, host, api_key_env?, reasoning_off?, timeout?}`). Invoke `review-call.mjs --backends-json` (via `review-spawn.mjs`, above) and disposition its own exit per the **Exit code → Phase-2 outcome** table below.
- **exit `3`** — `adversarial` is unset, or its `host` is unset (the unconfigured-host signal, preserved mechanically now — never a localhost-defaulted chain). Author `needs-human` directly: an absent/unconfigured provider block must not invisibly disable the review, the same outcome the old `--host-source default` probe produced (exit 6, below) — but without needing to actually dial a documented localhost default first.
- **exit `2`** — the configured `adversarial.fallbacks` value is not valid JSON. Author `needs-human` directly, naming the config fault — a broken config must fail loud, never silently degrade to a `[primary]`-only chain.

**Pass `--run-dir "$run_dir"` whenever faff-graft forwarded a `$run_dir`** (the same value the review-progress checkpoint writes already use — every autonomous L3/L4 dispatch; interactive runs have none and omit it). This is a value **passthrough**, not a decision: the helper reads `<run-dir>/run-ledger.json` itself and derives mandatory-ness from `level: "L4"` (see **MANDATORY chain-outage** below). Append it identically at L3 and L4 — no prose conditional.

- **`--system`** = the review lens above (the five categories), written to a file.
- **`--context`** = **every file the diff touches** — so the reviewer can verify existence/structure claims instead of hallucinating "this heading doesn't exist" from a diff-only view. (A model given only the diff produced confident false criticals; a *more* capable model was *more* wrong for exactly this reason. The touched files are what answer those claims; nothing else belongs here, and faff's own skill prose reaches a reviewer only when the diff actually touches it.)
- **`--diff`** = `git diff main...HEAD` written to a file.
- **Wire shape.** `review-call.mjs` places the shared context+diff block in the cacheable **prefix** position (the builders' `system` slot: `messages[0]` for OpenAI-compatible, top-level `system` for Anthropic) and the `--system` review lens in the trailing `user` turn. The flag names are unchanged; only the wire ordering flips so a prefix-caching backend can reuse the shared prefill. Code review is a single call with no sibling to share a prefix with, so the caching win lands on spec-review's four-lens fan-out, which shares this transport, not here.
- **`--deadline`** = the total wall-clock budget in seconds (`adversarial.deadline`, default `480`), distinct from `--timeout` (one attempt). **The total is SLICED per-backend:** each backend in the chain is granted only `deadline / remaining-backends` (the budget still left, divided among this backend and the untried ones — recomputed each iteration, so a fast-failing backend's slack is re-divided among the survivors), passed as its `hardDeadlineMs`, NOT the whole deadline. A hung/slow backend is therefore abandoned at its slice and the healthy fallbacks still run within the deadline — the failover the chain exists for. The per-attempt clamp bounds each attempt to `min(timeout, slice−now)`, so an over-large per-backend `timeout` is clamped to the slice automatically (the configured value is never rewritten). Deadline-exceeded (the whole chain exhausts its budget with no findings) → exit `8` (below). A single-backend chain, and any chain run with no `--deadline`, behave byte-for-byte as before (the lone backend's slice is the whole budget). Omit only to run unbounded (the earlier behaviour). `review-call.mjs main` also emits an **advisory** stderr `budget:` warning when a backend's `timeout × ~6` worst-case exceeds its per-backend budget (`deadline / num_backends`) — a hint that retries may be truncated; never gating.
- **Every listed backend is explicitly configured**, so `review-call.mjs` derives each one's `host_source` as `"config"` internally — the `--host-source default` localhost-probe path (exit `6`, below) is now **only reachable from `faff adversarial-backends` exit `3`** (the emitter refuses before the helper is ever invoked), never from an in-chain element.

**Exit code → Phase-2 outcome (mechanical — the helper decides, not prose).** The helper returns the **same exit code in both modes** (`review-call.mjs` exit semantics are unchanged); the two mode columns are how *this slot* handles that code. Only **exit 5 diverges** — an autonomous full-chain outage is loudly annotated, never a bare pass (see **Full-chain outage annotation** below):

| exit | meaning | interactive (L2) | autonomous (L3/L4) |
|---|---|---|---|
| `0` | findings on stdout | parse `## Adversarial findings`, disposition each (below) | same |
| `2` | usage error, a genuinely unknown provider (not one of ollama / openai / vllm / openrouter / nvidia / deepseek / gemini / anthropic), **or** a non-transient **request fault** (e.g. HTTP 400/413) that escaped a backend's orchestration function and was caught at the fallback-chain boundary, **or** the assembled review payload (system + context + diff) exceeded the oversized-diff preflight's size threshold and was flagged *before* any backend was dispatched (zero network calls attempted) — a fully-exhausted chain containing only that request-fault class also terminates here, never `5`/pass+skip | **`needs-human`** — a config/request fault, not a review result. | same |
| `4` | configured model **not served** by the host (config fault — e.g. a name typo) | **`needs-human`**, naming the mismatch. **Never** silent `pass` — a misconfigured model must not invisibly disable the review. | same |
| `5` / timeout | provider **unreachable**, `--host-source config` — an **explicitly-configured** host down (incl. an explicit `localhost`), **or** a persistent mid-stream **transport failure** after the bounded retry on a configured host | `pass` + a finding noting the skip — don't block the pipeline on infra; explicit config is the human's call. | `pass` + a **LOUD** skip finding + block field `adversarial_outcome:"chain-outage-skipped"` — never an undifferentiated pass. The morning brief, not a park, surfaces the gap (an outage is no code defect). |
| `6` | provider **unreachable**, `--host-source default` — the localhost fallback because `adversarial.host` was **unset**. **Not reachable from this skill's call path** — every `--backends-json` element is explicitly configured (`host_source:"config"` always), so an unset host is caught earlier by `faff adversarial-backends` exit `3` (above), before the helper is ever invoked; this row documents `review-call.mjs`'s own (unchanged) vocabulary for a caller that still passes the legacy single-backend flags directly | **`needs-human`** — adversarial review configured but no provider set. **Never** silent `pass` — an absent provider block must not invisibly disable the review (same class as exit 4). | same |
| `7` | **auth failed** (cloud `401`/`403`, or the `api_key_env` var is unset) | **`needs-human`** — don't retry with broken credentials. | same |
| `8` | **deadline exceeded** — the total `--deadline` wall-clock budget was hit before any backend produced findings (a *slow-but-healthy* Phase-2, not a config fault) | `pass` + skip the second opinion, **logged loudly** (`phase2: skipped-deadline`) so a mis-tuned budget is visible, never silent. | same — `pass` + skip, logged loudly. **Distinct from the exit-5 outage annotation** (a deadline is a slow-but-healthy backend, not an availability outage) — no `chain-outage-skipped` field. A needs-human-class fault seen on an earlier backend still dominates (the helper returns that code, not `8`). Advisory only — on a **mandatory** chain a deadline exhaustion is remapped to exit `9` (fail-closed), see below. |
| `9` | **mandatory chain-outage** — a **MANDATORY** (L4 lights-out) review's chain exhausted with only *no-opinion* classes (all-unreachable `5`, all-rate-limited `12`, *or* deadline `8`), no structural-inability class (`2`/`4`/`6`/`7`/`11`) present. Only produced when the review resolved **mandatory** — ledger-derived from an L4 `--run-dir`/`FAFF_RUN_DIR`, or forced by an explicit `--lights-out` (see **MANDATORY chain-outage** below) | *not reachable* — mandatory-ness only resolves true on an L4 run | **`unavailable`** — park the PR; author `adversarial_outcome:"mandatory-chain-outage"` (retained forensics-only, no longer load-bearing). No second opinion was obtainable and no human is watching, so the mandatory gate **fails closed** (never pass+skip) — an availability failure, not a `needs-human` verdict. |
| `10` | **malformed (substantive-garble only)** — the winning backend's output is non-empty, not a recognised provider refusal, but is not findings-shaped (no recognised `### <severity>:` finding section) — a reachable-but-degraded, per-backend model-quality symptom (checked **per-backend** inside the fallback chain; a malformed primary still advances to a healthy fallback). An AVAILABILITY class: a fully-exhausted chain containing ONLY this class (mixed with `5`/`8`, in any permutation) terminates at exit `5` (pass+skip), never `10` — see exit `11` below for the structural-inability half of what a malformed exhaustion used to cover wholesale. | `pass` + a finding noting the skip (the chain-exhaustion row above, `5`) — a single-backend garble-only chain resolves the same way. | same — `chain-outage-skipped`, per the exit-5 row above. |
| `11` | **no-findings-content** — the winning backend's output is EMPTY/whitespace-only, or matches the closed-grammar provider-refusal signature (`isProviderRefusal`) — an operator-fixable structural inability (a wrong/incapable/refusing model), not a transient degradation. Checked **per-backend**; an empty/refusing primary still advances to a healthy fallback, but a fully-exhausted chain containing this class (mixed with any availability class, in any permutation) terminates at exit `11` — the structural fault DOMINATES, exactly like `2`/`4`/`6`/`7` — never masked as a `chain-outage-skipped` pass. | **`needs-human`**, naming the empty/refusal output. **Never** silent `pass` — the mechanically-enforced, tightened form of the malformed-output rule below. | same — `needs-human`, human-actionable even at L4 (never remapped to `9`). |
| `12` | **rate-limited** — a backend returned **HTTP 429**. A rate-limited endpoint is NOT retried on the same host (re-hitting a throttle does not clear it); it **advances the fallback chain** to the next backend. An AVAILABILITY class like `5`: checked **per-backend**; a fully-exhausted chain whose non-structural faults are ALL rate-limited terminates at exit `12` (a chain mixing in a genuine unreachable/deadline stays `5`, so a real transient still earns its retry). | `pass` + a finding noting the skip, as the exit-5 row above. | `pass` + a **LOUD** skip finding + `adversarial_outcome:"chain-outage-skipped"`, as the exit-5 row above. On a **mandatory** L4 chain a rate-limited exhaustion is remapped to exit `9` (fail-closed), see below. |

A **transient transport fault during streaming** (HTTP 5xx, a dropped socket — `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up", or a stream timeout) is **retried** a bounded number of times with exponential backoff; only a **persistent** one lands on exit `5`/`6` above. An **HTTP 429 rate-limit is not retried** — re-hitting a throttle never clears it, so a 429 advances the fallback chain and, on a purely-rate-limited exhaustion, lands on exit `12` (above). `--timeout` bounds **each stream attempt and the inter-retry sleeps** — *not* the total wall-clock: worst-case per-backend is **~6× `--timeout`** (3 attempts × 2 `streamOnce`), and a fallback chain composes further. **`--deadline` caps that composed total** — the helper never starts a backend past the budget and re-clamps every attempt to what remains, so the chain fits one subagent turn (exit `8` when it binds). **`OTHER` (exit `1`) is reserved for genuine programmer error** — no transport/infra condition exits `1`, and a non-transient request fault (HTTP 400/413) escaping a backend's orchestration is caught at the fallback boundary and exits `2`, so every exit the helper returns is covered by this table.

**That total is divided per-backend:** each backend gets `deadline / remaining-backends` as its own ceiling, so one hung backend consuming its `~6×timeout` worst-case is bounded to its slice and cannot starve the fallbacks — exit `8` fires only when the *whole* chain exhausts the budget, not when a single backend does.

**The malformed/no-findings boundary (deterministic, not incidental).** `review-call.mjs` validates the winning backend's output shape itself (`validateFindingsShape` — non-empty AND >=1 recognised `### <severity>:` section) so a header-skipping or content-free response can never silently pass as exit `0`. When the shape check fails, a `kind` discriminator (`empty` / `refusal` / `garbled`) — a pure function of the returned content, stable across re-runs of the same fixed input — decides which of the two exit classes applies: **empty or a closed-grammar refusal** → `11` (needs-human, an operator-fixable structural inability that must never be masked as an outage) versus **substantive but non-findings prose** → `10` (an availability/degradation symptom, per-backend only — a garble-only exhausted chain collapses to `5`). This is what makes a full-chain outage's terminal disposition deterministic on a **stable response property**, not on the incidental run-to-run mix of which failure class happened to fire. **A shape-failing response is still checked against `normaliseCleanRefutation`'s four closed clean-refutation forms (`bare` / `headed` / `headed+signal` / `header-wrapped`, see Output above) before the malformed/no-findings split applies** — a byte-exact affirmation sentence under any single decorative header (`header-wrapped`) normalises to the canonical no-findings token and terminates the chain on exit `0`, rather than falling through to `10`.

### Full-chain outage annotation (autonomous exit 5)

On an **autonomous** run where the exit is `5` (every backend in the chain unreachable — a full-chain availability outage), the pipeline is not blocked, but the skip must never read as a silent pass. Do two things when authoring the output:

- **Emit a loud skip header** in place of the normal findings block:

  ```
  ## Adversarial findings — SKIPPED (all backends unreachable)

  This build shipped without adversarial review — every configured backend was unreachable.
  ```

- **Set the contract block** to `{ "signal": "pass", "findings": [], "adversarial_outcome": "chain-outage-skipped" }`. The signal stays `pass` (an infra outage produces no finding to gate on — parking would conflate availability with quality), but the optional `adversarial_outcome` field marks *why* it passed without review. faff-graft forwards the token; the beep-boop orchestrator records the issue id in its ledger's `review_adversarial_skipped` array and renders it in a distinct run-summary subsection, so the run never presents it as an undifferentiated auto-merge.

On an **interactive** exit 5 the behaviour is unchanged: `pass` + a plain finding noting the skip, **no** `adversarial_outcome` field, no loud header — a watched human may reasonably proceed on a dead chain.

This annotation path and the **Autonomous-run escalation** below are **mutually exclusive**: escalation requires Phase-2 findings (exit 0), the outage annotation requires no findings (exit 5) — a single review can never hit both. (A deadline-skip — exit 8 — is a third, distinct case: a slow-but-healthy backend, `pass` + skip with no outage annotation. The **MANDATORY chain-outage** — exit 9, below — is the L4-only fail-closed counterpart of this exit-5 advisory skip: the same no-findings exhaustion, opposite direction, because on L4 the second opinion is mandatory.)

### MANDATORY chain-outage (L4 lights-out — fail closed)

On a **lights-out (L4)** run the adversarial second opinion is *mandatory* — `dialCoherence` refuses to start an L4 run whose `slots.review` is not the adversarial occupant — and no human is watching. So a full-chain exhaustion that obtained **no** opinion must **fail closed**, not pass+skip:

- **The helper derives mandatory-ness itself from the run ledger — no prose→flag translation.** Pass `--run-dir "$run_dir"` on every autonomous invocation (above); `review-call.mjs` reads `<run-dir>/run-ledger.json` and treats `level: "L4"` as mandatory, with `FAFF_RUN_DIR` as the ambient fallback. The slot no longer decides a boolean — it only carries the run-dir **path**, so a dropped/misread `lights_out` signal can no longer silently downgrade the review to advisory. `--lights-out` remains as an explicit deterministic **override** that forces mandatory (tests, or a caller that already resolved L4-ness); the two are OR-composed (`mandatory = ledger || --lights-out`). Unresolved/absent (no run-dir, non-L4 ledger, no flag) ⇒ advisory, byte-for-byte today's behaviour.
- When the review resolves **mandatory** (ledger-derived or flag-forced), the helper remaps a no-opinion exhaustion (all-unreachable `5`, all-rate-limited `12`, or deadline `8`) to **exit `9` (MANDATORY_OUTAGE)**; a config-fault class (2/4/6/7) still **dominates unchanged** (the remap never masks a cause).
- On exit `9`, author the availability signal (a KNOWN fail-closed value distinct from the human-judgement one; canonical semantics: `faff contract review-verdict --describe`) with one finding naming the outage (a location + an action, per the needs-human finding-shape rule), and set `adversarial_outcome:"mandatory-chain-outage"` (forensics-only — the signal now carries the meaning). faff-graft dispositions it EXACTLY as the human-judgement verdict: this is Phase 1's hard signal, so faff-graft's Step 9 parks it pre-PR, unchanged (no PR is opened — same no-PR human handoff today). No graft merge-floor edit is needed either way — the availability signal was already never the approving verdict, so a stray block reaching Step 10 would fail the floor regardless.

**Why this keys off `lights_out`, not `autonomous` (intentional asymmetry).** A Phase-2 `critical` *finding* is a real code defect — even an L3 overnight merge must not land it — so **Autonomous-run escalation** keys off `autonomous` and fires at L3 too. A chain *outage* is infra, not a defect: an L3 overnight run has a **morning human** to whom the loudly-annotated exit-5 skip surfaces the gap, so pass+skip is tolerable there; an L4 lights-out run has **no** human at all, so the only safe direction is to park. Advisory exit `5`/`8` (L1–L3, or any run where mandatory-ness stays unresolved — no L4 ledger and no `--lights-out`) keep today's pass+skip and the `chain-outage-skipped` annotation, unchanged.

### Review-progress checkpoint (autonomous resume)

When faff-graft forwards `$run_dir` + `<ISSUE>` (autonomous L3/L4 only — interactive skips this), write the review-progress checkpoint at the phase boundaries so a re-dispatched build subagent **resumes** instead of repeating the slow Phase-2 (graft Step 9 → **Resume from a review-progress checkpoint**). All writes go through the deterministic CLI — never a hand-rolled JSON edit:

- **Honour a resume hint.** If graft invoked with "skip Phase-1, run only Phase-2" (its diff-identity guard confirmed the checkpointed `phase1.verdict=pass` still matches the current diff), **do not re-run Phase-1** — resume at Phase-2. Absent a hint, run Phase-1 normally.
- **After a Phase-1 approving verdict:** `faff review-progress write "$run_dir" <ISSUE> --phase1-pass --diff-hash <cur_hash>` (any other Phase-1 verdict is already terminal — return, write nothing, no Phase-2).
- **Before the `review-call.mjs` call:** `faff review-progress write "$run_dir" <ISSUE> --phase2 in_flight` — this is the stall window the checkpoint exists to survive.
- **On the call's resolution, map the exit → the phase2 status:** exit `0` → `--phase2 complete --findings <path>`; exit `8` → `--phase2 skipped_deadline`; a `5`/`6`-class unreachable or `12` rate-limited pass+skip → `--phase2 skipped_unreachable`. **Exit `9` (mandatory chain-outage) is a terminal `unavailable`, NOT a skip** — it returns terminal without any `--phase2 skipped*` write (a `skipped_unreachable` status would misrepresent a fail-closed park as a tolerated skip). (A needs-human or unavailable exit returns terminal without a `complete` write.)

The checkpoint is a **hint** — graft reconciles it against git/PR/worktree truth on any disagreement (the diff-identity guard discards a stale `pass`), so it can only ever *save* repeated work, never skip the hard review for the wrong diff.

## Output to faff-graft

Returns Phase 1's hard signal (canonical semantics: `faff contract review-verdict --describe` — the availability value arises only from a MANDATORY chain-outage) plus the adversarial findings and the implementor's dispositions. The adversarial phase does not alter the signal — it adds evidence that the implementor has addressed. Sequencing (iterate, raise PR, park) belongs to faff-graft.

## Contract artifact

After the output above, append **one** fenced code block — tagged `faff-contract:review-verdict`, as the **last** thing in the output — declaring **Phase 1's hard verdict only**, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read) and pipes it to `faff contract review-verdict`. You authored Phase 1's verdict, so you declare it directly; the block mirrors the prose, it is not a second source of truth. (Same pattern the `spec` producer adopted for `faff-contract:spec-readiness`.)

````
```faff-contract:review-verdict
{ "signal": "<Phase 1's verdict — faff contract review-verdict --describe>",
  "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... one per Phase-1 finding ],
  "adversarial_outcome": "chain-outage-skipped"   // OPTIONAL — omit unless the autonomous full-chain-outage case fired
}
```
````

- **Phase 1's verdict only** — *except on the autonomous path*, where a Phase-2 `critical` escalates `signal` to the human-judgement verdict (see **Autonomous-run escalation**). Otherwise `signal` is Phase 1's hard signal; `findings` carries one entry per **Phase-1** finding, each declaring whether it named a code **location** (`location_present`) and a concrete **action/fix** (`action_present`).
- **Phase-2 adversarial hypotheses are NOT the verdict** — they stay prose under `## Adversarial findings` and are **never** entered into `findings[]` (except the single autonomous-escalation carve-out below). Folding soft hypotheses in would misrepresent the hard verdict the gate routes on. The one narrow carve-out is the autonomous `critical` escalation below: there the escalating `critical` *is* the verdict-driver (the signal is `needs-human` **because of** it), so it is entered honestly — scoped strictly to that escalation, off which this rule is unchanged.
- **`adversarial_outcome` is OPTIONAL and additive** — include it **only** in the autonomous full-chain-outage case, set to `"chain-outage-skipped"` (see **Full-chain outage annotation**); omit it on every other path. The contract validator (`faff contract review-verdict`) reads only `signal`+`findings` and **neither rejects nor forwards** unknown fields — its output is rebuilt from `signal`+`findings` alone, so `adversarial_outcome` **never gates the verdict**. It rides instead on the **raw verdict block** graft persists per-issue (`review-verdict.json`), which the beep-boop orchestrator reads **directly** during its reconciliation to populate the ledger's `review_adversarial_skipped` array — not from the contract script's stdout.
- the approving verdict may carry zero findings; every other verdict carries ≥1 (the contract script enforces this — canonical semantics: `faff contract review-verdict --describe`).
- Do **not** include `provenance_present` — that field is spec-specific; the review-verdict extraction the gate routes on is just `{ signal, findings }` (plus the optional `adversarial_outcome` annotation above).
- **One** block, at the very end, machine-only. **Always emit it** — a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your prose — the absent-block fallback.)

## Autonomous-run escalation

On **any autonomous run** (L3 overnight or L4 lights-out), a Phase-2 `critical` finding must **stop the merge**, not merely be logged — no human is awake to weigh a soft `critical`, and the implementor the finding indicts must not be the one to clear it. When the forwarded `autonomous` signal is true, escalate the Phase-2 severity into the hard verdict at the moment you author the `faff-contract:review-verdict` block:

- **Escalation threshold — a single named set.** `ESCALATE_SEVERITIES = { critical }` (v1). Only `critical` escalates; `major` / `minor` / `observation` never do, because a lower-capability adversarial model's `major` findings are too noisy to auto-park a run on. To widen the threshold later, add the severity to this one set (e.g. `{ critical, major }`) — nothing else changes.
- **When it fires — all three must hold:** Phase 1 returned `pass` (so Phase 2 ran), the forwarded `autonomous` signal is true, and at least one Phase-2 finding has a severity in `ESCALATE_SEVERITIES`. The trigger is the **raw** Phase-2 severity, **not** the implementor's disposition of it — a build agent must not be able to disprove its own way past the gate (marking its own homework is the failure this escalation exists to remove). A false-positive `critical` therefore parks the run for a human to clear: a recoverable park is the intended trade against an unrecoverable false auto-merge.
- **What it emits.** Set the block's `signal` to `needs-human`, and fold each escalating `critical` into `findings[]` as `{ "location_present": true, "action_present": true }` — one entry per escalating finding. A gate-worthy `critical` names a location and an action by the actionability bar (see **Rules**), so these are truthful for a well-formed finding and act as the escalation's conformance markers; the substantive per-finding detail lives in the prose `## Adversarial findings`, exactly as on every other path. This satisfies the contract's rule that a `needs-human` signal carries at least one finding naming a location and an action.
- **Fail-safe direction.** When the `autonomous` signal is false, absent, or unresolved, do **not** escalate — author the block exactly as the advisory path does. This fails safe *off* on an unresolvable signal, matching the interactive default.

On an **interactive (L2)** run — `autonomous` false — this section is inert: the block is authored byte-for-byte as it is today, with Phase-2 findings advisory. This escalation (findings present, exit 0) is **mutually exclusive** with the **Full-chain outage annotation** (no findings, exit 5) — a single review can never trigger both.

## ADR drift challenge

This same adversarial engine is also called by faff-graft Step 3b's autonomous ADR-supersession path — a distinct, narrower question from the code review above, sharing only the "different model, independent second opinion" mechanism. Given `{old Decision body, new Decision body, why}`, judge whether the argument for superseding the old ADR with the new one actually holds — return the closed challenge-outcome vocabulary (canonical semantics: `faff contract adr-admission --describe`). This is the `adr-drift` seam (`judgement_seam` above); it feeds `faff adr admit --challenge <outcome>` directly, never the `faff-contract:review-verdict` block above (a different contract, `adr-admission`, consumed by a different caller). Unreachable/unanswered after the normal fallback chain → the caller treats it as the absent outcome (a missing skeptic is a reject, never a pass) — no separate outage-annotation shape is needed here, unlike the review-verdict chain-outage case. **Per-consumer backend:** the `adr-drift` seam is **not** a named per-consumer adversarial consumer — when it reaches the **Backend call** mechanism above it leaves `consumer` UNSET, so it resolves the shared `adversarial.*` chain (byte-identical to today). A future dedicated chain for it is a one-line change (set `consumer=adr_drift`) that inherits the generic seam for free.

## PRDR YAGNI Phase-2 challenge

This same adversarial engine is also called by the upper-gate YAGNI Phase-2 (gateway → **Upper-gate (YAGNI) two-phase arbitration**; faff-plot Step 5c) — a distinct, narrower question than the diff code-review above, sharing only the "different model, independent second opinion" mechanism (as `adr-drift` does).

```
BEHAVIOUR PRDR YAGNI Phase-2 challenge (the prdr-yagni seam):
  SUMMARY: the same adversarial engine, called for the upper-gate Phase-2 — a distinct,
           narrower question than the diff code-review, sharing only the "different model,
           independent second opinion" mechanism (as adr-drift does).
  1. Input  = { AuthoredPrdr, PRD goals, Phase-1 yagni-judge proposal }  # proposal-shaped, NOT a diff
  2. Judge  whether the PRDR is warranted — serves a real PRD goal without exceeding it
  3. Return the closed challenge vocabulary: survived | overturned, with ground
     (over-scope | unserved | other) on an overturn
     (canonical semantics: gateway → Upper-gate arbitration + `faff contract prdr-yagni --describe`)
  4. Transport = invoke the `review` slot as a subagent (a different model, the Phase-2 pattern) —
     never the diff-shaped code-review transport the `refutation-code` seam uses. It feeds
     `faff prdr yagni --challenge <outcome> --challenge-ground <ground>` directly, never the
     `faff-contract:review-verdict` block.
     PER-CONSUMER BACKEND: this is the `prdr_review` consumer. Where this seam
     resolves its adversarial backend chain via `faff adversarial-backends`, thread
     `--consumer prdr_review` (and read `adversarial.prdr_review.timeout`, falling back to
     `adversarial.timeout`) — i.e. set `consumer=prdr_review` in the Backend call mechanism,
     overriding the `code_review` default the refutation-code seam sets. Unset ⇒ byte-identical
     to the shared chain, so a distinct prdr_review chain is opt-in only.
  5. Unreachable/unanswered after the normal fallback chain → the absent outcome
     (caller omits --challenge — a missing skeptic is a reject, never a pass, parking the
     PRDR `phase2-inconclusive`); no separate outage-annotation shape (same as adr-drift).
```

This is the `prdr-yagni` seam (`judgement_seam` above); it feeds `faff prdr yagni --challenge <outcome> --challenge-ground <ground>` directly, never the `faff-contract:review-verdict` block above (a different contract, `prdr-yagni`, consumed by a different caller). Unreachable/unanswered after the normal fallback chain → the caller treats it as the absent outcome (a missing skeptic is a reject, never a pass) — no separate outage-annotation shape is needed here, unlike the review-verdict chain-outage case.

**Anti-pattern:** routing the YAGNI Phase-2 challenge through the diff-shaped code-review transport (the `refutation-code` seam's helper above, hard-wired to a `DIFF UNDER REVIEW:` input and a severity-findings output). Why: that shape mismatch yields an improvised, untrustworthy overturn.

## PRDR YAGNI Phase-2 overturn criterion

When this engine challenges a loop-authored PRDR (the upper-gate Phase 2 — gateway → **Upper-gate (YAGNI) two-phase arbitration**), the **only** over-scope ground for overturning is genuine gold-plating: the DoD covers capability **beyond the PRD's declared goals** (`V ⊄ D`), or a cited goal is unserved. Covering **more declared goals than the PRDR cites is _not_ over-scope** — that is under-citation (a citation bug), supplied to the arbitration as `--dod-covers` and admitted deterministically. Classify every overturn with a closed-vocab **ground** (`over-scope` | `unserved` | `other`, fed as `--challenge-ground`) so the arbitration overrides only a *mis-attributed over-scope* overturn; an `unserved`/`other` overturn is always respected. The under-citation/over-scope *distinction* remains the CLI's deterministic set-test, not part of any refutation seam. The Phase-2 *challenge itself*, however, is a first-class judgement seam — `prdr-yagni`, declared in the frontmatter above and transported per **PRDR YAGNI Phase-2 challenge** — not the diff-shaped `refutation-code` seam.

## Rules

- Never agree with the primary review by default. Actively look for what it missed.
- Never invent requirements. Every finding must trace to the spec, the code's own contracts, or a universally expected property (no crashes, no data loss, no security holes).
- Keep findings actionable. "This might be a problem" is not a finding. "This path doesn't handle X, which the spec requires in AC-3" is.
- The local LLM may produce lower-quality output than the primary model. That's fine — the value is independence, not superiority. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.
