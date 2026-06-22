---
name: faffter-dark-adversarial-review
description: "Adversarial second-opinion code review for the `review` slot: a standard structural pass plus an adversarial review by a different LLM to catch correlated blind spots. Returns the fixed pass/fail/needs-human verdict. Swappable review occupant; runs as a configured slot, not the user `/` menu."
user-invocable: false
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
    provider: ollama                 # ollama | vllm | openai | gemini | anthropic | openrouter
    model: llama3.1:70b             # provider-specific model identifier
    host: http://localhost:11434     # required for ollama/vllm, ignored for cloud providers
    api_key_env: OPENROUTER_API_KEY # env var name for cloud provider API key (not the key itself)
    timeout: 120                     # seconds
```

**Provider details:**

| Provider | Host | Auth | Notes |
|---|---|---|---|
| `ollama` | `host` field (default `http://localhost:11434`) | None | Local, free, private |
| `vllm` | `host` field (e.g. `http://localhost:8000`) | Optional `api_key_env` | OpenAI-compatible API, self-hosted, GPU-accelerated |
| `openai` | OpenAI API | `api_key_env` | GPT-4o, o1, etc. |
| `gemini` | Google AI API | `api_key_env` | Gemini 2.5 Pro/Flash — large context window, different architecture |
| `anthropic` | Anthropic API | `api_key_env` | Claude models — use a different model from whatever wrote the code |
| `openrouter` | OpenRouter API | `api_key_env` | Any model via single API — good for testing different biases |

The key principle is **independence from the primary model**. If Claude wrote the code and ran the primary review, don't configure Claude here. Use a structurally different model (different architecture, different training data, different fine-tuning) to maximise the chance of catching correlated blind spots.

**Backend call — the bundled `review-call.mjs` helper (do not hand-roll the API call).** The robust call is a tool, not prose (FAFF-183): `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` does model **preflight** (against `/api/tags`), `think:false` (so a reasoning model doesn't return empty `content`), **streaming** (so a long response doesn't drop the connection), and a **token budget** with one truncation retry. Resolve the host/model/timeout from `faffter_dark.adversarial` via `faff config get`, then invoke:

```bash
node "$REVIEW_CALL" --host "$host" --model "$model" --timeout "$timeout" \
  --host-source "$host_source" \
  --system <review-lens-file> \
  --context plugin/skills/faff/SKILL.md --context <each file the diff touches> \
  --diff <git-diff-file>
```

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
| `4` | configured model **not served** by the host (config fault — e.g. a name typo) | **`needs-human`**, naming the mismatch. **Never** silent `pass` — a misconfigured model must not invisibly disable the review. |
| `5` / timeout | provider **unreachable**, `--host-source config` — an **explicitly-configured** host down (incl. an explicit `localhost`) | `pass` + a finding noting the skip — don't block the pipeline on infra; explicit config is the human's call. |
| `6` | provider **unreachable**, `--host-source default` — the localhost fallback because `faffter_dark.adversarial.host` was **unset** | **`needs-human`** — adversarial review configured but no provider set. **Never** silent `pass` — an absent provider block must not invisibly disable the review (FAFF-213, same class as exit 4). |

Malformed/empty content from a reachable+served model → `needs-human` with the raw output (a human decides). Auth failure (cloud providers) → `needs-human`; don't retry with broken credentials.

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
