---
name: faffter-dark-adversarial-review
description: "Adversarial second-opinion code review for the `review` slot: a standard structural pass plus an adversarial review by a different LLM to catch correlated blind spots. Returns the fixed pass/fail/needs-human verdict. Swappable review occupant; runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: refutation-code
---

# faffter-dark-adversarial-review

Two-phase code review: standard structural review (delegated to `faffter-noon-review`) followed by an adversarial second opinion via a different LLM. Catches correlated blind spots by bringing different training biases from the model that wrote the code.

Plugs into the `review` slot — replaces the default review, not augments it. The hard signal it returns conforms to the gateway Review-verdict contract: `pass` / `fail` / `needs-human` in that envelope. The adversarial phase adds evidence, never a fourth verdict.

Configure in `.faffrc`:

```yaml
slots:
  review: faffter-dark-adversarial-review
```

## When it runs

Invoked by faff-graft Step 9 as the configured `review` skill.

## Two phases

### Phase 1: Standard review (delegated to faffter-noon-review)

Runs the full `faffter-noon-review` five-pass review (AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging). If this returns `fail` or `needs-human`, return that signal immediately — no point running the adversarial pass on code that hasn't passed basic review.

### Phase 2: Adversarial review (different LLM)

Only runs if Phase 1 returned `pass`. Sends the diff to a structurally different model for an independent second opinion. This is not a repeat of Phase 1 — it targets what same-model review is likely to miss. The backend call is made by the bundled **`review-call.mjs`** helper (preflight + streaming + `think:false` + token budget) — **not** a hand-rolled API call; see **Backend call** below.

## Input

Faff-graft provides:

- The full diff: `git diff main...HEAD`
- The spec (from the issue comment)
- The Phase 1 review result (for context, not for agreement — Phase 2 must form its own opinion)

## Output

Phase 1 returns a hard signal (`pass` / `fail` / `needs-human`) per `faffter-noon-review`.

Phase 2 returns a **soft signal** — findings only, no verdict. The adversarial reviewer may be a less capable model; its findings are hypotheses, not rulings. The output **must name the model used** (`provider/model`) as its first line — so a finding can be investigated/tuned in retrospect, and so a quality difference between models is attributable (FAFF-183: a 27B and an 80B gave materially different findings on the same diff).

```
## Adversarial findings — `<provider>/<model>`

### [severity]: [title]
[description of the concern and why it might matter]
```

Severities: `critical`, `major`, `minor`, `observation` — but these are the adversarial reviewer's assessment, not a gate decision.

## How findings are handled

The adversarial findings are raised back to the **implementor** (the build agent). The implementor must:

1. **Consider each finding** — read it, understand the concern
2. **Prove or disprove with conviction** — check the code, the spec, the tests. Either demonstrate why the finding is a false positive (cite the specific line, test, or spec clause that addresses it) or acknowledge it as valid.
3. **Log each disposition** — record every finding and its disposition (proven false / valid + fixed / valid + accepted risk with rationale) in the per-issue `.faff/logs` graft log. Per faff-graft Step 9's **collapse-and-log** policy (FAFF-184), these dispositions **fold into the single terminal review comment's summary** — never one tracker comment per finding (the granularity rule). That one comment is located/updated by its marker pair per the comment-identity contract (**gateway → Review-findings comment identity**, FAFF-202).
4. **Fix if necessary** — if any finding is valid and actionable, fix the code
5. **Re-run primary review** — if fixes were made, re-run Phase 1 to confirm nothing regressed

The adversarial review **never directly blocks the pipeline**. It produces signal that the implementor must address with evidence. A dismissed finding with weak rationale ("I don't think that's a problem") is itself a smell — the disposition must be specific and verifiable.

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

## LLM provider integration

The skill supports any LLM backend. Provider and model are configured in `.faffrc`:

```yaml
faffter_dark:
  adversarial:
    provider: ollama                 # ollama | openai | vllm | openrouter | nvidia | deepseek
    model: llama3.1:70b              # provider-specific model identifier
    host: http://localhost:11434     # ollama/vllm: base host. openai-compatible: base URL incl. /v1
    api_key_env: NVIDIA_API_KEY      # env var NAME holding the API key (not the key itself)
    reasoning_off: false             # true → send chat_template_kwargs:{thinking:false} (reasoning models)
    timeout: 120                     # seconds
    fallbacks: '[{"provider":"ollama","model":"qwen3-next:80b","host":"http://studio:11434"}]'   # FAFF-232, optional
```

**Fallback chain (FAFF-232).** The scalar block above is the **primary** backend. An optional `fallbacks` key adds an **ordered list of further backends**, each tried — in order — only when the one before it fails to produce findings (rate-limit, unreachable, persistent transport failure, auth, not-served). The first backend that returns findings wins; the chain reaches a terminal outcome only when **every** backend has failed. This keeps the L4 second-opinion gate firing through a single provider's outage instead of silently `pass+skip`ping.

- **Value is a JSON-string** — a quoted JSON array of backend objects `{provider, model, host, api_key_env?, reasoning_off?, timeout?}`; the skill `JSON.parse`s it. (The config parser has handled native YAML lists since FAFF-262, but the JSON-string form remains the canonical shape for this key — existing configs keep working unchanged.) Omit it for the single-backend behaviour (a one-element chain — unchanged).
- **Each fallback is self-contained** (its own `provider`/`model`/`host` required); omitted optional keys (`api_key_env`, `reasoning_off`, `timeout`) inherit the primary's.
- **No silent weakening** — an all-failed chain is never more pass-like than today's single backend: a config fault (auth / not-served / unsupported / unconfigured-default-host) anywhere in a fully-failed chain surfaces `needs-human`; only a chain of purely configured-host availability failures `pass+skip`s. The chain loop + terminal precedence live deterministically in `review-call.mjs` (`runReviewChain` / `chainTerminalExit`), not in this prose.

**Two transport families** — `review-call.mjs` dispatches on `provider`:

| Provider | Transport | Host | Auth | Notes |
|---|---|---|---|---|
| `ollama` | ollama (`/api/tags` + `/api/chat`) | `host` (default `http://localhost:11434`) | none | Local, free, private |
| `openai` `vllm` `openrouter` `nvidia` `deepseek` | OpenAI-compatible (`/v1/models` + `/v1/chat/completions`, SSE) | `host` = base URL **including `/v1`** (e.g. `https://integrate.api.nvidia.com/v1`, `http://localhost:8000/v1`) | `Bearer` from `api_key_env` | One code path for every OpenAI-shaped API |

`gemini` / `anthropic` have **native** wire formats and are **not** handled by the helper — point them at an OpenAI-compatible base URL or add a dedicated adaptor; an unknown provider exits `2` (loud), never a silent pass.

**`reasoning_off`** — set `true` for a reasoning model that streams empty `content` unless its hidden think-block is disabled (e.g. NVIDIA `deepseek-*`). It adds `chat_template_kwargs:{thinking:false}` to the OpenAI-compatible payload (the analogue of ollama's always-on `think:false`). It is **opt-in** because vanilla OpenAI rejects the unknown field — leave it `false` for GPT-4o/o-series.

The key principle is **independence from the primary model**. If Claude wrote the code and ran the primary review, don't configure Claude here. Use a structurally different model to maximise the chance of catching correlated blind spots.

**Backend call — the bundled `review-call.mjs` helper (do not hand-roll the API call).** The robust call is a tool, not prose (FAFF-183): `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` does model **preflight** (ollama `/api/tags` or OpenAI-compatible `/v1/models`), think-suppression (ollama `think:false`; OpenAI-compatible `--reasoning-off`), **streaming** (NDJSON or SSE — so a long response doesn't drop the connection), and a **token budget** with one truncation retry. Resolve `provider`/`host`/`model`/`timeout`/`api_key_env`/`reasoning_off` from `faffter_dark.adversarial` via `faff config get`, then invoke:

```bash
node "$REVIEW_CALL" --host "$host" --model "$model" --timeout "$timeout" \
  --host-source "$host_source" \
  --provider "$provider" --api-key-env "$api_key_env" ${reasoning_off:+--reasoning-off} \
  --system <review-lens-file> \
  --context plugin/skills/faff/SKILL.md --context <each file the diff touches> \
  --diff <git-diff-file>
```

**When `faffter_dark.adversarial.fallbacks` is set (FAFF-232)** — build the ordered chain and pass it as one `--backends-json` file instead of the single-backend flags above. Resolve the block as JSON (`faff config get --json faffter_dark.adversarial`), `JSON.parse` the `fallbacks` string, assemble `[primary, ...fallbacks]` (each `{provider, model, host, host_source:"config", api_key_env?, reasoning_off?, timeout?}`, omitted optional keys inheriting the primary's), write it to a temp file, and invoke `node "$REVIEW_CALL" --backends-json <file> --system … --context … --diff …`. The helper iterates the chain; the **exit-code → outcome table below is unchanged** — the chain only changes *which* exit the helper returns. With no `fallbacks` key, use the single-backend invocation above verbatim (a one-element chain).

- **`--provider`** = the configured provider (omit → defaults to `ollama`). **`--api-key-env`** = the env var **name** (the helper reads the key from `process.env`; the key is never on the command line). **`--reasoning-off`** = pass only when `reasoning_off: true`.
- **`--system`** = the review lens above (the five categories), written to a file.
- **`--context`** = the **gateway** (`plugin/skills/faff/SKILL.md`) **plus every file the diff touches** — so the reviewer can verify existence/structure claims instead of hallucinating "this heading doesn't exist" from a diff-only view. (FAFF-183: a model given only the diff produced confident false criticals; a *more* capable model was *more* wrong for exactly this reason.)
- **`--diff`** = `git diff main...HEAD` written to a file.
- **`--host-source`** (FAFF-213) = the **provenance** of `$host`: never silently substitute the localhost default. Resolve it off the `faff config get` exit status — `faff config get faffter_dark.adversarial.host` **exits non-zero (3) when the key is unset**:
  - **Key resolves** (exit 0) → `$host_source=config`; pass `$host` as-is.
  - **Key unset** (non-zero exit) → `$host_source=default`; pass the documented `http://localhost:11434` so the probe can run and produce the distinct exit 6. Do **not** treat the resulting outage as `pass+skip` — an absent provider block must not invisibly disable the review (the same principle as the model-not-served exit-4 case). Keying off "non-zero exit ⇒ unconfigured" (not a specific code) keeps this robust if the CLI's unset-key code changes.

**Exit code → Phase-2 outcome (mechanical — the helper decides, not prose):**

| exit | meaning | outcome |
|---|---|---|
| `0` | findings on stdout | parse `## Adversarial findings`, disposition each (below) |
| `2` | usage error, or an unsupported provider (`gemini`/`anthropic`/unknown) | **`needs-human`** — a config fault, not a review result. |
| `4` | configured model **not served** by the host (config fault — e.g. a name typo) | **`needs-human`**, naming the mismatch. **Never** silent `pass` — a misconfigured model must not invisibly disable the review. |
| `5` / timeout | provider **unreachable**, `--host-source config` — an **explicitly-configured** host down (incl. an explicit `localhost`), **or** a persistent mid-stream **transport failure** after the bounded retry (FAFF-227; incl. a persistent **HTTP 429 rate-limit** — FAFF-228) on a configured host | `pass` + a finding noting the skip — don't block the pipeline on infra; explicit config is the human's call. |
| `6` | provider **unreachable**, `--host-source default` — the localhost fallback because `faffter_dark.adversarial.host` was **unset**, **or** a persistent mid-stream **transport failure** (FAFF-227; incl. a persistent **HTTP 429 rate-limit** — FAFF-228) on the default host | **`needs-human`** — adversarial review configured but no provider set. **Never** silent `pass` — an absent provider block must not invisibly disable the review (FAFF-213, same class as exit 4). |
| `7` | **auth failed** (cloud `401`/`403`, or the `api_key_env` var is unset) | **`needs-human`** — don't retry with broken credentials. |

A **transient transport fault during streaming** (HTTP 5xx, a dropped socket — `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up", a stream timeout, or an **HTTP 429 rate-limit** — FAFF-228) is **retried** a bounded number of times with exponential backoff before it counts as a failure; only a **persistent** one lands on exit `5`/`6` above (FAFF-227/228). `--timeout` bounds **each individual stream attempt and the inter-retry sleeps** — *not* the total wall-clock: worst-case total wall-clock is **~6× `--timeout`** (3 attempts × 2 `streamOnce`) under stream + truncation + transport-retry composition (FAFF-228 doc correction). **`OTHER` (exit `1`) is reserved for genuine programmer error — no transport/infra condition (now including a rate-limit) exits `1`**, so every exit the helper returns is covered by this table.

Malformed/empty content from a reachable+served model → `needs-human` with the raw output (a human decides).

## Output to faff-graft

Returns Phase 1's hard signal (`pass` / `fail` / `needs-human`) plus the adversarial findings and the implementor's dispositions. The adversarial phase does not alter the signal — it adds evidence that the implementor has addressed. Sequencing (iterate, raise PR, park) belongs to faff-graft.

## Contract artifact (FAFF-108)

After the output above, append **one** fenced code block — tagged `faff-contract:review-verdict`, as the **last** thing in the output — declaring **Phase 1's hard verdict only**, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read) and pipes it to `faff contract review-verdict`. You authored Phase 1's verdict, so you declare it directly; the block mirrors the prose, it is not a second source of truth. (Same pattern the `spec` producer adopted for `faff-contract:spec-readiness`.)

````
```faff-contract:review-verdict
{ "signal": "<Phase 1's verdict: pass|fail|needs-human>",
  "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... one per Phase-1 finding ] }
```
````

- **Phase 1's verdict only.** `signal` is Phase 1's hard signal; `findings` carries one entry per **Phase-1** finding, each declaring whether it named a code **location** (`location_present`) and a concrete **action/fix** (`action_present`).
- **Phase-2 adversarial hypotheses are NOT the verdict** — they stay prose under `## Adversarial findings` and are **never** entered into `findings[]`. Folding soft hypotheses in would misrepresent the hard verdict the gate routes on.
- `pass` may carry zero findings; `fail` / `needs-human` carry ≥1 (the contract script enforces this).
- Do **not** include `provenance_present` — that field is spec-specific; the review-verdict extraction is just `{ signal, findings }`.
- **One** block, at the very end, machine-only. **Always emit it** — a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your prose — the absent-block fallback.)

## Rules

- Never agree with the primary review by default. Actively look for what it missed.
- Never invent requirements. Every finding must trace to the spec, the code's own contracts, or a universally expected property (no crashes, no data loss, no security holes).
- Keep findings actionable. "This might be a problem" is not a finding. "This path doesn't handle X, which the spec requires in AC-3" is.
- The local LLM may produce lower-quality output than the primary model. That's fine — the value is independence, not superiority. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.
