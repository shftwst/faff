---
name: faffter-dark-adversarial-review
description: "Adversarial second-opinion code review for the `review` slot: a standard structural pass plus an adversarial review by a different LLM to catch correlated blind spots. Returns the fixed pass/fail/needs-human verdict. Swappable review occupant; runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-dark-adversarial-review

Two-phase code review: standard structural review (delegated to `faffter-noon-review`) followed by an adversarial second opinion via a different LLM. Catches correlated blind spots by bringing different training biases from the model that wrote the code.

Plugs into the `review` slot — replaces the default review, not augments it. The hard signal it returns conforms to the `review_adaptor` slot (default `faffidavit-review`): `pass` / `fail` / `needs-human` in that envelope. The adversarial phase adds evidence, never a fourth verdict.

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

Only runs if Phase 1 returned `pass`. Sends the diff to a structurally different model for an independent second opinion. This is not a repeat of Phase 1 — it targets what same-model review is likely to miss.

## Input

Faff-graft provides:

- The full diff: `git diff main...HEAD`
- The spec (from the issue comment)
- The Phase 1 review result (for context, not for agreement — Phase 2 must form its own opinion)

## Output

Phase 1 returns a hard signal (`pass` / `fail` / `needs-human`) per `faffter-noon-review`.

Phase 2 returns a **soft signal** — findings only, no verdict. The adversarial reviewer may be a less capable model; its findings are hypotheses, not rulings.

```
## Adversarial findings

### [severity]: [title]
[description of the concern and why it might matter]
```

Severities: `critical`, `major`, `minor`, `observation` — but these are the adversarial reviewer's assessment, not a gate decision.

## How findings are handled

The adversarial findings are raised back to the **implementor** (the build agent). The implementor must:

1. **Consider each finding** — read it, understand the concern
2. **Prove or disprove with conviction** — check the code, the spec, the tests. Either demonstrate why the finding is a false positive (cite the specific line, test, or spec clause that addresses it) or acknowledge it as valid.
3. **Log to tracker** — post a comment on the issue with each finding and its disposition (proven false / valid + fixed / valid + accepted risk with rationale)
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

**Prompt construction:**

1. System prompt: the review lens above (verbatim — the five categories and their sub-points)
2. User message: the diff, preceded by the spec in a `<spec>` block
3. Response format instruction: verdict line + findings in the format above

**Fallback behaviour:**

- Provider unreachable → log warning, return `pass` with a finding noting the skip. Do not block the pipeline on infrastructure issues.
- Timeout → same as unreachable.
- Malformed response (no parseable verdict) → return `needs-human` with the raw response as a finding. Let a human decide.
- Auth failure (bad/expired key) → return `needs-human` with the error. Don't retry with broken credentials.

## Output to faff-graft

Returns Phase 1's hard signal (`pass` / `fail` / `needs-human`) plus the adversarial findings and the implementor's dispositions. The adversarial phase does not alter the signal — it adds evidence that the implementor has addressed. Sequencing (iterate, raise PR, park) belongs to faff-graft.

## Rules

- Never agree with the primary review by default. Actively look for what it missed.
- Never invent requirements. Every finding must trace to the spec, the code's own contracts, or a universally expected property (no crashes, no data loss, no security holes).
- Keep findings actionable. "This might be a problem" is not a finding. "This path doesn't handle X, which the spec requires in AC-3" is.
- The local LLM may produce lower-quality output than the primary model. That's fine — the value is independence, not superiority. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.
