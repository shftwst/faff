# faffter-dark-holdout

Holdout test generation and execution via a different LLM. Produces test cases the build agent has never seen — edge cases, adversarial inputs, boundary conditions, failure modes — from scenarios written at prep time.

Configure in `.faffrc`:

```yaml
planning_skills:
  holdout_tests: faffter-dark-holdout
```

## Two-phase lifecycle

This skill runs at two distinct points in the pipeline:

### Phase 1: Scenario generation (called by faff-prep)

After the spec is attached to the issue, faff-prep invokes this skill to generate holdout scenarios from the spec's Definition of Done / acceptance criteria.

**Input:**
- The spec (just attached to the issue)

**Output:**
Pseudocode test scenarios in the standard format, returned to faff-prep for attachment as a separate issue comment with `<!-- faff:holdout-scenarios -->` marker.

```markdown
<!-- faff:holdout-scenarios -->
## Holdout scenarios for ISSUE-42

### Edge: empty input
- setup: no items in the collection
- action: call aggregate()
- assert: returns empty result, not null/error

### Boundary: max capacity
- setup: collection at MAX_SIZE
- action: call add(item)
- assert: rejects with CapacityError, collection unchanged
```

Scenario names follow `<category>: <description>` where category is one of: `Edge`, `Boundary`, `Adversarial`, `Failure`, `Concurrency`, `Regression`.

**Generation lens — what to target:**

1. **Boundary conditions** — min, max, zero, one, off-by-one, overflow, empty, full
2. **Adversarial inputs** — null, undefined, wrong type, too large, malformed, unicode edge cases, injection attempts
3. **Failure paths** — what the happy-path developer forgot: network down, disk full, permission denied, timeout, partial write
4. **Concurrency** — parallel calls, race conditions, interleaving, stale reads
5. **Spec-gaming detection** — scenarios that pass if the code does the right thing but fail if it just returns a hardcoded value or no-ops the hard parts
6. **Regression anchors** — scenarios derived from the spec's "risks" or "edge cases" sections that pin known-tricky behaviour

**Scenario quality rules:**
- Each scenario must be derivable from the spec. Don't invent requirements — test the ones that exist from angles the build agent won't have considered.
- Each scenario must be independent — no ordering dependencies between scenarios.
- Aim for 5–15 scenarios per spec. Fewer for trivial issues, more for complex ones. Quality over quantity.
- Prefer scenarios that would catch specification gaming (trivial implementations that technically pass the ACs).

### Phase 2: Test execution (called by faff-workit Step 9b)

After all reviews pass, faff-workit invokes this skill to translate the holdout scenarios into executable tests and run them.

**Input:**
- The holdout scenarios (from the issue comment, fetched by faff-workit)
- The full diff: `git diff main...HEAD`
- The spec
- Existing test files in the project

**Output:**
- Executable test files written to `.faff/runs/<run-id>/holdout-tests/`
- Test execution results
- A structured result for faff-workit to post as a PR comment

```
verdict: pass | fail

## Results

### pass: Edge: empty input
aggregate() returns [] when collection is empty

### fail: Boundary: max capacity
Expected CapacityError, got silent success — item was added beyond MAX_SIZE

## Test source
<full test code here for the PR comment's <details> block>
```

**Translation rules:**
- Detect the project's test framework from existing test files (jest, pytest, vitest, go test, etc.)
- Generate tests in the same language and framework as the existing test suite
- Each scenario becomes one test case — named to match the scenario title
- Tests must be runnable in isolation (no shared state between them)
- Import paths must resolve against the actual codebase (read the diff to understand file locations)

**Execution:**
- Run the generated tests locally via the project's test runner
- Capture pass/fail per scenario
- On failure, capture the assertion message and actual vs expected values

**Verdict rules:**
- All scenarios pass → `pass`
- Any scenario fails → `fail`

## LLM provider integration

Provider and model are configured in `.faffrc`:

```yaml
faffter_dark:
  holdout:
    provider: ollama                 # ollama | vllm | openai | gemini | anthropic | openrouter
    model: llama3.1:70b             # provider-specific model identifier
    host: http://localhost:11434     # required for ollama/vllm, ignored for cloud providers
    api_key_env:                     # env var name for cloud provider API key (not the key itself)
    timeout: 120                     # seconds
```

**Provider details:**

| Provider | Host | Auth | Notes |
|---|---|---|---|
| `ollama` | `host` field (default `http://localhost:11434`) | None | Local, free, private |
| `vllm` | `host` field (e.g. `http://localhost:8000`) | Optional `api_key_env` | OpenAI-compatible API, self-hosted, GPU-accelerated |
| `openai` | OpenAI API | `api_key_env` | GPT-4o, o1, etc. |
| `gemini` | Google AI API | `api_key_env` | Gemini 2.5 Pro/Flash — large context window |
| `anthropic` | Anthropic API | `api_key_env` | Claude models — use a different model from whatever wrote the code |
| `openrouter` | OpenRouter API | `api_key_env` | Any model via single API |

The key principle is **independence from the primary model**. The holdout generator must not be the same model that wrote the code, or it risks generating tests the code was already optimised to pass.

**Prompt construction:**

Phase 1 (generation):
1. System prompt: the generation lens above (the six categories)
2. User message: the spec
3. Response format instruction: pseudocode scenario format

Phase 2 (translation + execution):
1. System prompt: "translate these pseudocode scenarios into executable tests using the project's test framework"
2. User message: the scenarios, the diff, and a sample of existing test files (for framework/style detection)
3. Response format instruction: complete test files, runnable as-is

**Fallback behaviour:**

- Provider unreachable → log warning, skip holdout step. Do not block the pipeline on infrastructure issues.
- Timeout → same as unreachable.
- Malformed response (can't extract test code) → return `fail` with the raw response as context. Let the iteration loop or human deal with it.
- Auth failure → skip with warning. Don't retry with broken credentials.

## Stability contract

**Scenarios are generated once at prep time and never regenerated.** If a holdout test fails and the build iterates, the same scenarios are re-run against the updated code. This prevents the LLM from generating a different, easier set on retry.

**Test translation may vary between iterations** — the same scenarios translated against a different diff may produce slightly different test code (different imports, different setup). This is acceptable because the scenarios (the intent) are stable; only the mechanical translation changes.

## What faff-workit does with the result

This skill returns verdict + per-scenario results + test source. Faff-workit:

1. Posts a PR comment with pass/fail summary and full test source in a `<details>` block
2. If verdict is `fail` → iterates (fix code, re-run primary review, re-run same holdout tests). Up to 3 iterations, then `needs-human`.
3. Cleans up `.faff/runs/<run-id>/holdout-tests/` when the run directory is cleaned up

## Rules

- Never generate scenarios that require external services, network access, or infrastructure not present in the local dev environment.
- Never generate flaky tests. Each scenario must be deterministic given the same code.
- Never test internal implementation details. Test observable behaviour — inputs and outputs, side effects, error responses.
- If the spec is too vague to derive meaningful scenarios, return fewer scenarios rather than inventing requirements. 3 solid scenarios beat 15 speculative ones.
- The LLM may produce lower-quality test code than the primary model would. That's fine — the value is testing from a different perspective. Fix obvious syntax errors in the generated tests before running; don't fail the gate because the holdout model can't write valid imports.
