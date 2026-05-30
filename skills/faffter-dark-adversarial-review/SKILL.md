# faffter-dark-adversarial-review

Adversarial review via a different LLM. Structurally independent second opinion on a diff — catches correlated blind spots by bringing different training biases from the model that wrote the code.

Configure in `.faffrc`:

```yaml
planning_skills:
  adversarial_review: faffter-dark-adversarial-review
```

## When it runs

Invoked by faff-workit Step 9a after the primary review (Step 9) returns `pass`. Never runs if the primary review failed or returned `needs-human`.

## Input

Faff-workit provides:

- The full diff: `git diff main...HEAD`
- The spec (from the issue comment)
- The primary review result (for context, not for agreement — this skill must form its own opinion)

## Output

A single verdict line followed by findings:

```
verdict: pass | fail | needs-human

## Findings

### [severity]: [title]
[description of the issue and why it matters]
```

Severities: `critical` (→ fail), `major` (→ fail if ≥2), `minor` (→ pass, noted), `observation` (→ pass, informational).

**Verdict rules:**
- Any `critical` finding → `fail`
- 2+ `major` findings → `fail`
- 1 `major` finding → `needs-human`
- Only `minor` / `observation` → `pass`

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

## What faff-workit does with the result

This skill returns the verdict + findings. Faff-workit:

1. Merges the verdict with Step 9 (worst signal wins)
2. Posts the findings as a PR comment labelled "Adversarial review (faffter-dark)"
3. If merged verdict is `fail` → iterates (fix, re-run primary review, re-run adversarial review)
4. If merged verdict is `needs-human` → parks

## Rules

- Never agree with the primary review by default. Actively look for what it missed.
- Never invent requirements. Every finding must trace to the spec, the code's own contracts, or a universally expected property (no crashes, no data loss, no security holes).
- Keep findings actionable. "This might be a problem" is not a finding. "This path doesn't handle X, which the spec requires in AC-3" is.
- The local LLM may produce lower-quality output than the primary model. That's fine — the value is independence, not superiority. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.
