# Review backend configuration

SuperDomestique resolves configured review chains with `faff adversarial-backends`.
The runtime caller passes that JSON to `review-call.mjs`; it does not construct
HTTP requests or merge fallback objects itself. This page is operator reference,
not an additional document every review must load.

```yaml
adversarial:
  provider: vllm
  model: your-served-model
  host: http://localhost:8000/v1
  timeout: 120
  first_byte_timeout: 60
  deadline: 480
  max_tokens: 2000
  fallbacks: '[{"provider":"openai","model":"your-other-model","host":"https://your-host/v1","api_key_env":"REVIEW_API_KEY"}]'
```

`api_key_env` names an environment variable; it never contains the key itself.
Choose a reviewer from a different model family than the implementor. A model
using the same family does not provide the intended independent second opinion.

| Setting | Meaning |
|---|---|
| `provider`, `model`, `host` | Required identity of each configured backend. An absent host is a configuration fault, not permission to probe an implicit localhost default. |
| `fallbacks` | Ordered fallback backend list. A quoted JSON array is the canonical configuration form; native YAML lists are also accepted. The first backend producing valid findings wins. |
| `timeout` | Per-attempt stream timeout in seconds. The caller defaults to 120. |
| `first_byte_timeout` | First-byte timeout in seconds, default 60; zero disables this window. It is separate from gaps between later bytes. |
| `deadline` | Total chain budget in seconds, default 480. The helper divides the remaining budget among remaining backends so one slow backend cannot consume the fallback budget. |
| `max_tokens` | Output cap. The caller uses a consumer override, then the global value, then 2000. A present invalid/non-positive consumer value resets to 2000. |
| `context_window` | Optional operator-declared served token window. Positive values enable context-window checks; absent or invalid values leave them disabled. SuperDomestique does not infer or write this setting. |
| `reasoning_off` | Opt-in think suppression for compatible servers. Leave false when the server rejects `chat_template_kwargs`. |
| `reasoning_extra` | Per-backend reasoning-control object. Only `reasoning`, `thinking`, `reasoning_effort` and `chat_template_kwargs` are accepted. Explicit values override other reasoning settings; template kwargs merge one level. |

Each fallback supplies its own provider, model and host. Optional auth, reasoning
and timeout settings inherit through the CLI resolver. A malformed chain is an
error; the caller must not silently fall back to the primary alone.

Consumer-specific chains use the same resolver with `--consumer`: code review
uses `code_review`, PRDR review uses `prdr_review`, and ADR drift uses the shared
chain with no consumer. An unset consumer override retains the shared chain.
Timeout and output-cap callers read the consumer value before the global value.
The deadline remains global. Code review's trim toggle reads only
`adversarial.code_review.trim`: literal `false` disables trimming. A global
`adversarial.trim` setting has no effect. Prose review does not trim.

| Provider | Transport and host form |
|---|---|
| `openai`, `vllm`, `openrouter`, `nvidia`, `deepseek`, `gemini` | OpenAI-compatible model preflight and streamed chat completion. Supply the API base path, normally ending in `/v1`; Gemini uses its OpenAI-compatible base path. |
| `anthropic` | Native Messages transport, with named-event streaming and no model-list preflight. `reasoning_off` does not apply. |

Reasoning-control shapes differ by server. Examples represented by the helper
are `{reasoning: {enabled: false}}`, `{thinking: {type: disabled}}` and
`{reasoning_effort: low}`. Confirm the shape against the served model's API.
Disabling reasoning can make a response parseable while reducing defect
detection; it is not evidence of equivalent review quality. Smaller review
payloads can leave room for reasoning and findings.

The helper owns retries, window trimming, output-shape checks, clean-refutation
normalisation and chain precedence. It reports primary-backend skips in its
output. Configuration faults cannot become an advisory availability skip merely
because another backend also failed. The caller must preserve that outcome and
the separate mandatory-review fail-closed handling.
