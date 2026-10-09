# FAFF-1228: Diagnose empty HTTP 200 completions from adversarial backends before adding a retry

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1228.

This spec is for the build agent implementing FAFF-1228 and for the humans reviewing it. Adversarial backends sometimes answer HTTP 200 with no content, which `review-call.mjs` classifies as exit 11 (needs-human) once the chain is exhausted. Nothing records why the body was empty. This ticket makes every review call record the provider's finish reason, whether the stream finished, and the reasoning and content lengths, so the retry decision (now FAFF-1247) can be made from logged occurrences instead of a guess.

## 1. WHY

**The idea the rest turns on.** The stream parsers in `review-call.mjs` already read `finish_reason` (or Anthropic's `stop_reason`), but reduce it to two booleans (`truncated`, `done`) and throw the value away, along with all reasoning text and any `usage` block. The fix is to have each parser also return a small `completion` record (finish reason, whether the stream finished, content length, reasoning length, token usage) and to carry that record to the two places an operator already looks: the `--raw-dir` capture preamble and the `[chain] ...` stderr line. No classification, exit code or retry changes.

**Problem.**

- Production spec-review keeps 19 empty bodies under `.faff/spec-review/*/raw/` (about 5% of OK responses on `z-ai/glm-5.3-flash`, about 8% on `deepseek-v4-flash-0731`). Every one is a preamble with `byte_length: 0` and nothing else.
- The suspected cause (reasoning eating the whole `max_tokens`, `content: null`, `finish_reason: "length"`, already measured once in `eval/review-bench/results/DIAG-sharedprefix-deepseek/summary.json`) cannot be confirmed or ruled out for any of them, because no artefact records the finish reason or reasoning length.
- A stream that ends with no `finish_reason` and no `[DONE]` (a cut stream) also lands as `status: "ok", content: ""` and exit 11 today, indistinguishable from a true empty 200, because `runReview*` discards `done`.

### Design principles

**Observability only.** Exit codes, the `classifyCapturedResult` tokens, the chain's advance/terminate behaviour and the request payload stay byte-for-byte as today. Any change in disposition belongs to FAFF-1247.

**Lengths, never reasoning text.** Reasoning is counted, not stored or logged. Content keeps its existing handling (already captured in the raw body).

**Additive surfaces.** New preamble lines and stderr fields are appended where no existing reader keys on position; every current test passes unchanged.

**Provider strings are untrusted.** A `finish_reason` value reaches a file preamble and a stderr line, so it is sanitised to a short token before either sees it.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`: `accumulateSse` (:1178), `accumulateAnthropic` (:1237), `streamOnceOpenAi` (:1510), `runReviewOpenAi` (:1523, ok return :1549), `streamOnceAnthropic` (:1557), `runReviewAnthropic` (:1572, ok return :1592) | JavaScript (ESM) | Parsers and orchestrations that gain the `completion` record |
| same file: `classifyCapturedResult` (:1888), `captureRawResponseBody` (:1917), `runReviewChain` contract-mode empty branch (:2149-2157) and refuter non-findings branch (:2161-2172) | JavaScript (ESM) | Raw preamble and stderr surfaces |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` (:131-138), `build-lens-requests.mjs` (:60) | Shell in prose, JavaScript | Spec review passes `--raw-dir "$pin_dir/raw"`, so preambles land under `.faff/spec-review/<ISSUE>/raw/` |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (:246-258) | Shell in prose | Code review Phase 2 invokes review-call through `review-spawn.mjs` with no `--raw-dir` |
| `test/adversarial-call.test.mjs` (accumulators :299-323, :456-497; truncation re-call :84; FAFF-465 empty chain tests :2597-2690; raw capture :3966-4112), `test/impure/review-call-served-exit.test.mjs` | JavaScript (`node:test`) | Existing tests that must pass unchanged, and homes for new ones |
| `eval/review-bench/run-bench.mjs` `foldOpenai` (:198-210) | JavaScript | Prior art: already folds `finish`, reasoning and usage for the bench; not changed |

**Collision check with FAFF-1067** (true first-byte TTFT, Backlog). FAFF-1067 reworks the `streamWithFirstByte` (:1334) / `onFirstByte` / `realStream` (:1460) seam. This ticket changes what `streamOnce*` does with the string that seam returns (the accumulator call) and nothing upstream of it: `streamWithFirstByte`, `realStream` and the `onFirstByte` callback are untouched. The two tickets edit the same file, so a textual rebase may be needed, but there is no semantic overlap.

**Scope.** Two parser extensions, pass-through in two orchestrations, preamble and stderr additions in `review-call.mjs`, and tests. No SKILL.md, config, payload or `eval/` change.

**How the acceptance line is met.** This ticket's acceptance is narrowed to "every review call records finish_reason and reasoning/content lengths" (eval moves to FAFF-1250, below):

- every `review-call.mjs` call computes the record on every OK result;
- spec review retains it on disk for every OK classification, in the `--raw-dir` preamble;
- code review gets the stderr line only: the fields appear on the line of every non-served OK result and nothing is retained on disk (see OUT OF SCOPE, raw capture in code review).

**Chosen:** split the ticket. This ticket ships the observability; the decision between a single same-backend retry on an empty 200 and keeping exit 11 with the cause surfaced moves to FAFF-1247 (filed, blocked by FAFF-1228). No retained artefact records a finish reason for any past empty, so the ticket's own acceptance ("the retry decision is made from logged occurrences") cannot be met until this logging has run.

**Chosen:** move the eval slice (an optional `completion` field on eval judgement records, filled by drivers that can see one) to FAFF-1250, blocked by FAFF-1228. It is not on FAFF-1247's evidence path: the observed eval empties came through the frozen GLM spike transport or `claude -p`, neither of which would fill it. `sanitizeFinishReason` stays exported from `review-call.mjs` so FAFF-1250 can import it.

## 2. OUT OF SCOPE

- **The retry/budget decision.** Whether to add a same-backend retry on an empty 200 before exit 11, its budget effect (`budgetWarnings`, per-attempt clamp) and its interaction with FAFF-465's determinism premise and FAFF-1239's abort check. Why excluded: the evidence does not exist yet. Extension point: FAFF-1247; `runReviewOpenAi` / `runReviewAnthropic` `streamCall` closures.
- **Any classification change for a cut stream.** A cut-empty stream stays exit 11. Why excluded: observability first; changing it alters dispositions. Extension point: FAFF-1247, keyed on `completion.done`.
- **Raw capture in code review.** Code review Phase 2 does not pass `--raw-dir`; it keeps only the stderr line. Why excluded: adding retention to code review is a new artefact location and lifecycle, not diagnosis. Extension point: the `review-spawn.mjs` invocation in `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (:246).
- **Requesting usage from backends that only send it on request.** No `stream_options: { include_usage: true }` is added to the payload; `usage` is recorded only when the backend sends it unasked. Why excluded: it changes the request wire for every OpenAI-compatible backend. Extension point: `buildOpenAiPayload` (:1142).
- **Per-attempt records.** The truncation re-call and transport retries fold into one `completion` per chain element (the final attempt's). Why excluded: the raw capture is already one record per chain element. Extension point: `streamCall` in `runReview*`.
- **The 2026-10-08 GLM spike.** `records/spikes/2026-10-08-glm-5-3-refutation/run.mjs` is a frozen record and is not edited. Why excluded: records are history. Extension point: FAFF-1247 can re-run the spike with its own logging in `complete()`.
- **`eval/review-bench/run-bench.mjs`.** Its `foldOpenai` reads `delta.reasoning_content` but not `delta.reasoning`. Why excluded: a separate bench tool with its own output. Extension point: `foldOpenai` could reuse the new `accumulateSse` completion.
- **Eval judgement records.** An optional `completion` field on `buildJudgementRecord`, filled by the direct ollama driver and null from `claude -p`. Why excluded: split by spec review to keep this ticket on FAFF-1247's evidence path. Extension point: FAFF-1250; `buildJudgementRecord` / `runCase` in `eval/run-evals.mjs` and `makeDirectOllamaDriver` in `eval/ollama-model.mjs`, importing `sanitizeFinishReason` from `review-call.mjs`.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Completion record | The per-call diagnostic record defined below: finish reason, finished flag, content and reasoning lengths, token usage |
| Empty 200 | An OK-status result whose content trims to empty, classified `empty` and exit 11 today |
| Cut stream | A response body that ended with no finish reason and no `[DONE]` / `message_stop` (`done: false`) |
| Length re-call | The existing single retry at `numPredict * 2` that `runReview*` makes when the first attempt reports `truncated` |

### Types

```
RECORD Completion:
  finish_reason: String | null    # ALWAYS sanitised: null, or a value returned by sanitizeFinishReason; never a raw provider string
  done: Boolean                   # same meaning as accumulateSse/accumulateAnthropic's existing `done`
  content_len: Integer >= 0       # length of the returned content string (UTF-16 code units, String.length)
  reasoning_len: Integer >= 0     # total length of reasoning text seen; the text itself is never kept
  usage: Map<String, Number> | null   # numeric token counts only (see below); null when none was sent
  length_retried?: Boolean        # set ONLY by runReview*: true when the length re-call ran

CONSTRAINT completion never contains reasoning text, content text, or any non-numeric usage value
CONSTRAINT finish_reason == sanitizeFinishReason(finish_reason)   # any producer of a Completion upholds this
```

`truncated` (the token budget cut the answer: `finish_reason` `length` / `max_tokens`) and `completion.done` (the stream reached a finish marker at all) are independent: a stream can be truncated and done, or neither. Tallies key on `finish_reason`, not on either boolean.

### Interfaces

```
PURE FUNCTION accumulateSse(text) -> { content, truncated, done, completion: Completion }
PURE FUNCTION accumulateAnthropic(text) -> { content, truncated, done, completion: Completion }
  # content / truncated / done keep their exact current values and meaning

PURE FUNCTION sanitizeFinishReason(v) -> String | null
  # non-string or empty -> null; else replace every char outside [A-Za-z0-9_.:-] with "_", cap at 64 chars
  # idempotent: sanitizeFinishReason(sanitizeFinishReason(v)) == sanitizeFinishReason(v)

PURE FUNCTION pickUsage(u) -> Map<String, Number> | null
  # u not a plain object -> null
  # iterate Object.keys(u) (own keys only); skip "__proto__", "constructor", "prototype"
  # keep each key ending in "_tokens" whose value is a finite number, verbatim
  # plus "reasoning_tokens" from u.completion_tokens_details.reasoning_tokens when a finite number
  # stop once 16 keys are kept (USAGE_MAX_KEYS = 16)
  # build into Object.create(null), then copy into a plain {} with the same skip list; no keys -> null

PURE FUNCTION mergeUsage(a, b) -> Map<String, Number> | null
  # b == null -> a; a == null -> b
  # else copy a then b into a fresh object via the same skip list, b winning; stop at USAGE_MAX_KEYS

PURE FUNCTION formatCompletionLog(completion) -> String
  # "" when completion is not an object
  # else " finish_reason=<fr|none> done=<true|false> reasoning_len=<n> content_len=<n>"   (leading space)
  # fr = sanitizeFinishReason(completion.finish_reason) re-applied here (a no-op on clean input)

runReviewOpenAi / runReviewAnthropic, ok branch:
  { status: "ok", content, truncated, completion: { ...final_attempt.completion, length_retried: Boolean } }
  # every non-ok status is unchanged and carries no completion
```

- Export `sanitizeFinishReason`, `pickUsage`, `mergeUsage`, `formatCompletionLog` and `USAGE_MAX_KEYS` from `review-call.mjs` for tests; `sanitizeFinishReason` is also FAFF-1250's import.
- `usage` keeps the provider's own field names (`prompt_tokens`, `completion_tokens`, `total_tokens`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, ...). There is no renaming, so one recipe reads what the provider said.

### Raw preamble lines (new)

Inserted after `# sha256:` and before `# ---`, only when `result && result.completion` is an object:

```
# finish_reason: <value>            # "none" when null and done is true; "none (stream ended without a finish)" when null and done is false
# done: <true|false>
# content_len: <n>
# reasoning_len: <n>
# usage: <compact JSON of usage>    # "none" when null
# length_retried: <true|false>      # line present only when the field is set
```

The existing `# truncated:` line keeps its meaning (the body byte-cap, not a finish reason). The new lines use different names so the two are never confused.

## 4. HOW

### Parsing the OpenAI-compatible stream

`accumulateSse` keeps its loop and adds three accumulators. Behaviour summary: every frame contributes to content exactly as today, and additionally to the reasoning count, the last finish reason and the last usage block.

```
PROCEDURE accumulateSse(text):
  1. content = "", truncated = false, done = false, sawData = false
     finish = null, reasoningLen = 0, usage = null
  2. FOR each line starting "data:" (as today):
       a. "[DONE]" -> done = true; continue
       b. parse JSON (skip bad frame as today) -> j
       c. IF j.usage is present: u = pickUsage(j.usage); IF u != null: usage = u      # last non-null wins
       d. choice = j.choices?.[0]                                                    # may be absent on a usage-only chunk
       e. content piece: unchanged (delta.content ?? message.content)
       f. reasoningLen += reasoningPieceLen(choice?.delta) + reasoningPieceLen(choice?.message)
       g. IF choice?.finish_reason: finish = sanitizeFinishReason(choice.finish_reason); done/truncated as today
  3. IF NOT sawData (non-streamed fallback): as today, plus
       usage = pickUsage(j.usage); reasoningLen = reasoningPieceLen(choice?.message);
       finish = sanitizeFinishReason(choice?.finish_reason)
  4. RETURN { content, truncated, done,
              completion: { finish_reason: finish, done, content_len: content.length, reasoning_len: reasoningLen, usage } }

PROCEDURE reasoningPieceLen(obj):
  a = (typeof obj?.reasoning === "string") ? obj.reasoning.length : 0
  b = (typeof obj?.reasoning_content === "string") ? obj.reasoning_content.length : 0
  RETURN max(a, b)
```

- `max`, not sum, per frame: some vLLM builds send the same text under both names during the `reasoning_content` -> `reasoning` transition, and OpenRouter sends `reasoning`. Taking the larger counts either field once and never double-counts a mirrored pair.
- `reasoning_details` (OpenRouter's structured form) is ignored; `reasoning` carries the same text.
- `step 2.f` reads `choice.message` too because the streamed loop already reads `message.content` for a provider that puts a whole message in a `data:` frame.

**Chosen:** reasoning counted as the per-frame `max` of the two field lengths, as above.

**Chosen:** `usage` keeps only top-level finite-number `*_tokens` fields verbatim, plus `reasoning_tokens` lifted from `completion_tokens_details`. Cost, ids and nested objects are dropped. `reasoning_tokens` is kept because it is the direct measure of reasoning eating the budget (FAFF-918 notes it reads 0 on some vLLM builds, so it is supporting evidence next to `reasoning_len`, not a replacement).

**Chosen:** lengths are `String.length` (UTF-16 code units). They are only compared with each other and with token counts for rough proportion; the existing `# byte_length:` line already gives exact content bytes.

**Chosen:** `finish_reason` is sanitised at parse time with `sanitizeFinishReason`, and the two render sites (`formatCompletionLog` and the raw preamble) re-apply it defensively. Parse-time sanitising makes the `Completion` invariant hold for everything this ticket builds; the idempotent re-apply at render means a future producer that builds a `Completion` from a raw provider value (FAFF-1250's ollama driver, for one) cannot slip a newline into a preamble line or a stderr line.

**Chosen:** usage maps are built prototype-safe and capped at 16 keys (`USAGE_MAX_KEYS`). Provider JSON is untrusted: a `__proto__` key copied with plain assignment or spread could pollute or reshape the result, and an unbounded key set would let one response inflate every preamble line it lands on. Real providers send at most about six token fields.

**Anti-pattern:** storing reasoning text "just for diagnosis". Why: it can be large, can echo untrusted diff/context content into logs, and the length answers the question.

### Parsing the Anthropic stream

```
PROCEDURE accumulateAnthropic(text):   # additions only; text_delta, done and truncated unchanged
  - content_block_delta with delta.type "thinking_delta" and string delta.thinking: reasoningLen += delta.thinking.length
  - message_start: IF j.message.usage present: usage = mergeUsage(usage, pickUsage(j.message.usage))
  - message_delta: IF j.delta.stop_reason: finish = sanitizeFinishReason(j.delta.stop_reason)
                   IF j.usage present:     usage = mergeUsage(usage, pickUsage(j.usage))   # delta values override start
  - non-streamed fallback: reasoningLen = sum of (block.type "thinking" ? block.thinking.length : 0);
                           finish = sanitizeFinishReason(j.stop_reason); usage = pickUsage(j.usage)
  - completion built exactly as in accumulateSse
  # merge is mergeUsage (prototype-safe, capped); never a bare { ...a, ...b } on provider objects
```

- `redacted_thinking` blocks carry no text and contribute 0.
- The existing test that asserts `thinking_delta` is dropped from content still passes: only the length is counted.

### Passing the completion through `runReview*`

```
streamCall (both families):
  1. out = streamOnce(...)                     # now carries out.completion
  2. retried = false
  3. IF out.truncated: out = streamOnce(... numPredict * 2 ...); retried = true
  4. RETURN { ...out, completion: { ...out.completion, length_retried: retried } }

ok return:
  { status: "ok", content: r.out.content, truncated: r.out.truncated, completion: r.out.completion }
```

- `streamOnceOpenAi` / `streamOnceAnthropic` need no change: they already return the accumulator's whole result.
- On the length re-call the record is the final (second) attempt's. `length_retried: true` with `finish_reason: "length"` and `content_len: 0` is exactly the "reasoning ate the doubled budget too" signature FAFF-1247 needs.
- A transport retry (`streamWithTransportRetry`) re-runs the whole `streamCall`; the record is from the attempt that completed.

**Chosen:** the final attempt's completion plus a `length_retried` flag, not an array of per-attempt records (see OUT OF SCOPE, per-attempt records).

### Classification stays unchanged

`classifyCapturedResult`, `validateFindingsShape`, `mapResultExit`, `CHAIN_NEEDS_HUMAN` and every `continue` / return in `runReviewChain` are untouched. A cut-empty stream (`done: false`, `content_len: 0`) remains `empty` / exit 11; only the preamble and the stderr line distinguish it.

**Chosen:** no classification change for a cut stream in this ticket. Splitting it into, say, a transport-class exit would change chain dispositions (exit 5 retries, exit 11 parks) before anyone has seen how often it happens.

### Raw preamble

In `captureRawResponseBody`, after building the existing preamble lines and before `"# ---"`:

```
IF result is an object AND result.completion is an object:
  c = result.completion
  safe = sanitizeFinishReason(c.finish_reason)          # defensive re-apply; a no-op on clean input
  fr = safe != null ? safe
       : (c.done ? "none" : "none (stream ended without a finish)")
  append "# finish_reason: " + fr
  append "# done: " + String(c.done === true)
  append "# content_len: " + c.content_len
  append "# reasoning_len: " + c.reasoning_len
  append "# usage: " + (c.usage ? JSON.stringify(c.usage) : "none")
  IF typeof c.length_retried == "boolean": append "# length_retried: " + c.length_retried
```

- This runs for every classification that has an OK result (`findings`, `clean`, `contract`, `empty`, `refusal`, `malformed`), not only `empty`, so FAFF-1247 has a served baseline to compare against.
- Stubs (`result: null`) and non-ok results carry no completion and keep today's preamble byte-for-byte.
- The only existing preamble reader in the repo (`bodyOf` in `test/adversarial-call.test.mjs` :3966) splits on `# ---\n`; inserting lines before it is safe.

**Chosen:** preamble lines for every OK classification, inserted before the `# ---` sentinel.

### Stderr line

Append `formatCompletionLog(result.completion)` to the end of each OK-status non-served line in `runReviewChain`, in both verb forms:

| Branch | Today's line (unchanged prefix) | After |
|---|---|---|
| Contract mode, advancing (:2153) | `[chain] <tag> empty (contract mode: empty content) → advancing (exit 11)` | same + ` finish_reason=<x> done=<b> reasoning_len=<n> content_len=<n>` |
| Contract mode, exhausted (:2155) | `exhausted: <tag> produced empty output (contract mode) (exit 11)` | same + suffix |
| Refuter, advancing (:2168) | `[chain] <tag> <empty\|refusal\|malformed> (<reason>) → advancing (exit <11\|10>)` | same + suffix |
| Refuter, exhausted (:2170) | `exhausted: <tag> produced non-findings output (<reason>) (exit <11\|10>)` | same + suffix |

- `fr` renders as `sanitizeFinishReason(finish_reason)` (re-applied at render, see the sanitisation decision) or `none`; `done=false` marks a cut stream.
- When `result.completion` is absent (every `scriptedRunReview` / injected `runReviewFn` fake in the existing tests), the suffix is `""` and the line is byte-identical to today.
- `firstSkipReason` (FAFF-1039's primary-skip note) is not changed.
- Consumers checked: no production code parses these lines. `fan-out.mjs` matches only `TRUNCATION_SIGNAL` and `PRIMARY_SKIP_SIGNAL` by whole-line equality (:42-51), which a suffixed `[chain]` line can never equal. The tests match with regexes on the prefix, `exit 11` and `→ advancing` (:2614, :2633, :2651), all still satisfied. FAFF-361 fixed `[chain] <tag> <reason> → advancing` as the asserted prefix, which stays intact.

**Chosen:** append at the end of the line, for the empty, refusal and malformed kinds and the contract-mode empty. Appending keeps every existing prefix and the `(exit N)` token in place for anyone grepping them; covering refusal and malformed costs nothing and shows whether a garbled body was itself a `length` cut.

### Code review keeps stderr only

Code review Phase 2 (`plugin/skills/faffter-dark-adversarial-review/SKILL.md` :246) runs review-call through `review-spawn.mjs` with no `--raw-dir`; spec review passes it (`faffter-dark-spec-review/SKILL.md` :131-138). Code review therefore records the new fields on its stderr line only, which reaches the graft transcript but is not retained on disk.

**Chosen:** do not add `--raw-dir` to code review here. Spec review alone produces the bulk of the observed empties (19 retained), at a rate that will give FAFF-1247 dozens of occurrences within days of `/faff-beep-boop` use.

### How FAFF-1247 will read this

- **Primary source:** raw preambles under `.faff/spec-review/<ISSUE>/raw/*.txt` (local, gitignored). Empty ones are named `*.empty.txt` or `*.empty.retry-<k>.txt`.
- **Tally empties by finish reason:**

```
grep -h '^# finish_reason:' .faff/spec-review/*/raw/*.empty*.txt | sort | uniq -c
```

- **Empties with reasoning but no content, per model:** `grep -l '^# reasoning_len: [1-9]' .faff/spec-review/*/raw/*.empty*.txt | xargs grep -h '^# model:' | sort | uniq -c`
- **Served baseline for the same models:** the same greps over `*.findings*.txt` / `*.clean*.txt` / `*.contract*.txt`.
- **Code review and anything without `--raw-dir`:** the stderr line in transcripts and in spec-review's retained `round-*.md` / `lens-results-*.json`: `grep -ho 'finish_reason=[^ ]* done=[a-z]*' <files> | sort | uniq -c` (these files repeat lines, so dedupe before counting rates).

### Edge cases

- **Usage-only final chunk with `choices: []`** (OpenRouter style). `choice` is undefined; content, reasoning and finish are untouched; `usage` is captured.
- **Usage repeated cumulatively on every chunk.** Last non-null wins, which is the final cumulative value.
- **`finish_reason` present but no `[DONE]`.** `done` is already true from the finish reason (today's behaviour); `finish_reason` is set.
- **`[DONE]` but no `finish_reason`.** `done: true`, `finish_reason: null`, preamble prints `none`.
- **Cut stream** (body ended with neither). `done: false`, `finish_reason: null`, preamble prints `none (stream ended without a finish)`, stderr `finish_reason=none done=false`; exit 11 unchanged.
- **Whitespace-only content.** Classified `empty` as today; `content_len` is non-zero, which is itself diagnostic.
- **A non-string `finish_reason`** (number, object). `sanitizeFinishReason` returns null.
- **A usage object with `__proto__`, `constructor` or `prototype` keys, or more than 16 `*_tokens` keys.** The listed keys are skipped; keeping stops at 16; `Object.prototype` is untouched.
- **`finish_reason` with a newline or control characters.** Replaced with `_`; the preamble and stderr stay one line per field.
- **Body over `RAW_BODY_MAX_BYTES`.** `# truncated: true` as today; `content_len` reports the full content length, not the capped one.
- **Non-ok results and stubs** (deadline, invalid backend, transport-failed). No completion, preamble and stderr unchanged.

### Failure modes

- **The empties stop happening, or happen only on backends that send no finish reason.** How you'd know: after a week of beep-boop, the `uniq -c` tally is tiny or mostly `none`. What it means: proceed; FAFF-1247 then decides on what little exists, or widens capture (code review `--raw-dir`, `stream_options.include_usage`).
- **A backend sends reasoning under a field name not read here.** How you'd know: empties with `finish_reason=length`, `reasoning_len=0` and `usage.reasoning_tokens` > 0 (or `completion_tokens` near `max_tokens`). What it means: narrow; add the field to `reasoningPieceLen`. `usage` is the cross-check that makes this visible.
- **Cut streams never reach the accumulator.** If a backend drops the connection abruptly, `realStream` rejects (transport fault, exit 5 path) rather than resolving a partial body, so `done: false` empties may be rare by construction. How you'd know: zero `done=false` lines while transport-failed counts persist. What it means: proceed; that is evidence that cut streams are not the empty-200 cause.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fake OpenAI-compatible server that answers every chat POST for model A with HTTP 200 and SSE frames carrying only delta.reasoning text (200 characters total), then a frame with finish_reason "length", then [DONE]
And review-call.mjs is run as a child process with a one-element chain [A], --raw-dir <tmp>, --lens QA, --round 1
When the call completes
Then the process exits 11, the server received exactly 2 chat POSTs (max_tokens N then 2N), and <tmp> holds exactly one file round-1.QA.0-openai-A.empty.txt whose preamble contains "# finish_reason: length", "# done: true", "# content_len: 0", "# reasoning_len: 200" and "# length_retried: true" before "# ---"
And stderr contains a line starting "exhausted: openai/A produced non-findings output (empty content) (exit 11)" and ending " finish_reason=length done=true reasoning_len=200 content_len=0"
```

```
Given runReviewChain with a two-element chain and an injected runReviewFn whose first result is { status: "ok", content: "", completion: { finish_reason: null, done: false, content_len: 0, reasoning_len: 0, usage: null, length_retried: false } } and whose second result is findings-shaped
And shared.rawDir set
When the chain runs
Then the result is exit 0 served by index 1, failureClasses is [11], the index-0 raw file preamble contains "# finish_reason: none (stream ended without a finish)" and "# done: false", and the advancing stderr line ends with " finish_reason=none done=false reasoning_len=0 content_len=0"
```

- Every existing test in `test/adversarial-call.test.mjs` and `test/impure/` MUST pass with no edit.
- No completion record, preamble line or stderr line MUST ever contain reasoning text.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Ticket scope | Observability and retry together; observability now, retry in a follow-up | **Chosen:** split; retry to FAFF-1247 |
| Eval slice | Keep eval judgement records here; move to a sibling ticket | **Chosen:** move to FAFF-1250 |
| Where the diagnostic lives | New fields spread on the parser result; one nested `completion` record | **Chosen:** one nested `completion` record |
| Reasoning count across field names | Read one field; sum both; per-frame max | **Chosen:** per-frame max |
| Usage shape | Whole provider object; numeric `*_tokens` verbatim plus `reasoning_tokens`; normalised names | **Chosen:** numeric `*_tokens` verbatim plus `reasoning_tokens` |
| Length unit | Bytes; UTF-16 code units | **Chosen:** `String.length` |
| Finish reason safety | Raw value; sanitise at each surface; sanitise at parse | **Chosen:** sanitise at parse, re-applied idempotently at render |
| Usage object safety | Plain spread; prototype-safe build with a key cap | **Chosen:** prototype-safe, capped at 16 keys |
| Length re-call record | First attempt; final attempt; both | **Chosen:** final attempt plus `length_retried` |
| Cut-stream classification | New exit class; keep exit 11 | **Chosen:** keep exit 11 |
| Raw preamble coverage | Empty only; every OK classification | **Chosen:** every OK classification |
| Stderr placement | Inside the reason parenthesis; append to line end | **Chosen:** append to line end, all non-findings kinds |
| Code review raw capture | Add `--raw-dir`; stderr only | **Chosen:** stderr only |

**Split.** The ticket's own acceptance requires a decision from logged occurrences, and none exist: the 19 retained production empties and the 3 eval empties carry no finish reason. Deciding now would be a guess. FAFF-1247 holds the decision, blocked on this ticket.

**Eval slice to FAFF-1250.** Spec review (methodology, right-sizing) found the eval field adds no evidence about the observed empties: the GLM refutation empties ran through the frozen spike transport or `claude -p`, and only the direct ollama driver could fill it. Moving it keeps this build to the review-call path FAFF-1247 reads. FAFF-1250 depends on this ticket only for the `sanitizeFinishReason` import and the `Completion` shape.

**One nested record.** The orchestrations and capture code pass one value through instead of five, and `content` / `truncated` / `done` keep their current meaning for every existing caller and test. Spreading fields onto the result would also have put `content_len` beside `content` with no grouping.

**Per-frame max.** Reading only `reasoning_content` (as `run-bench.mjs` does) misses OpenRouter, the backend with the most empties. Summing double-counts a build that mirrors both names. Max per frame is correct for one field, both fields mirrored, or either alone.

**Usage verbatim and numeric.** Provider names differ (`completion_tokens` vs `output_tokens`); normalising them invites a mapping bug in a diagnostic. Numeric-only keeps strings and nested objects (which could carry ids or prose) out of logs. `reasoning_tokens` is the one nested value worth lifting.

**`String.length`.** Cheap, matches how the content is already held, and exact bytes are already in `# byte_length:`. At the time of writing no consumer needs byte-exact reasoning size.

**Sanitise at parse, re-apply at render.** Two surfaces today, more later; one sanitiser at the source means this ticket's producers cannot forget it, and the idempotent re-apply at each render site covers a producer added later. The allowed set covers every finish reason seen in practice (`stop`, `length`, `content_filter`, `tool_calls`, `end_turn`, `max_tokens`, `stop_sequence`).

**Prototype-safe, capped usage.** The usage block is the one provider object whose keys (not just values) reach a log line. Skipping `__proto__` / `constructor` / `prototype` and building on a null-prototype object closes prototype pollution; the 16-key cap bounds the preamble line for a hostile or buggy provider.

**Final attempt plus flag.** The final attempt is what produced the classified content, so its record explains the classification. The flag says the budget was already doubled, which is the most useful fact about the first attempt. An array would complicate the preamble format for a rare path.

**Keep exit 11 for cut streams.** A new class would change chain disposition (and the judge's park/retry) on unmeasured data. Logging `done=false` is enough for FAFF-1247 to decide.

**Every OK classification in the preamble.** Rates need a denominator: the finish reasons and reasoning lengths of served responses from the same model show what normal looks like.

**Append to line end.** FAFF-361 made the `[chain] <tag> <reason> → advancing` prefix the contract and tests key on `(exit N)`; appending touches neither. Putting the fields inside the parenthesis would also change FAFF-1039's `firstSkipReason`, which reuses the reason text.

**Stderr only for code review.** Adding `--raw-dir` to code review means choosing a retention directory and lifecycle inside graft's worktree, a separate decision. Spec review already yields enough occurrences.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The retry decision is not open here; it is owned by FAFF-1247.

**Assumptions:**

- **Assumes:** OpenRouter includes a `usage` object on the final SSE chunk without `stream_options.include_usage`, and vLLM does not unless asked. Validation: not required to build (usage is optional and null is handled); after merge, the first OpenRouter preamble shows `# usage: {...}`, and a vLLM one shows `# usage: none`.
- **Assumes:** FAFF-1247 and FAFF-1250 exist and are blocked by FAFF-1228. Validation: the Linear issue relations; nothing in the build depends on them.

## 8. DONE

### From WHY
- [ ] No exit code, classification token, chain advance/terminate behaviour or request payload changes: every existing test in `test/adversarial-call.test.mjs` and `test/impure/` passes with no edit
- [ ] An empty 200 with `finish_reason: "length"` and reasoning-only deltas is retained with its finish reason and reasoning length (impure test below)
- [ ] A cut-empty stream is distinguishable from a true empty 200 in both the preamble and the stderr line, and still exits 11

### From WHAT (types and helpers, unit tests)
- [ ] `sanitizeFinishReason`: `"stop"` -> `"stop"`; `"a\nb"` -> `"a_b"`; a 100-character string -> 64 characters; `""`, `null`, `5`, `{}` -> `null`
- [ ] `pickUsage({ prompt_tokens: 10, completion_tokens: 2000, total_tokens: 2010, cost: 0.1, id: "x", completion_tokens_details: { reasoning_tokens: 1990 } })` deep-equals `{ prompt_tokens: 10, completion_tokens: 2000, total_tokens: 2010, reasoning_tokens: 1990 }`; `pickUsage({ cost: 1 })` and `pickUsage(null)` are `null`; a string-valued `*_tokens` is dropped
- [ ] `pickUsage(JSON.parse('{"__proto__": {"polluted_tokens": 1}, "prompt_tokens": 3}'))` returns `{ prompt_tokens: 3 }` only, and afterwards `({}).polluted_tokens === undefined` and `Object.prototype` has no new own keys; the same holds for `mergeUsage` with such an input
- [ ] `pickUsage` of an object with 20 finite `k<n>_tokens` keys returns exactly 16 keys
- [ ] A hand-built `Completion` with `finish_reason: "a\nb"` renders `finish_reason=a_b` in `formatCompletionLog` and `# finish_reason: a_b` in the `captureRawResponseBody` preamble, with no extra line in either
- [ ] `formatCompletionLog(undefined)` is `""`; `formatCompletionLog({ finish_reason: null, done: false, content_len: 0, reasoning_len: 0, usage: null })` is `" finish_reason=none done=false reasoning_len=0 content_len=0"`

### From HOW (accumulateSse, unit tests)
- [ ] `finish_reason: "stop"` with content `"x"` -> completion `{ finish_reason: "stop", done: true, content_len: 1, reasoning_len: 0, usage: null }`
- [ ] Reasoning-only deltas (`delta.reasoning` totalling 8 characters) then `finish_reason: "length"` -> content `""`, truncated true, completion `finish_reason: "length"`, `reasoning_len: 8`, `content_len: 0`
- [ ] Content frames with no `finish_reason` and no `[DONE]` -> `done: false`, `finish_reason: null`
- [ ] A frame with `delta.reasoning_content: "abcd"` counts 4; a frame with both `reasoning: "abc"` and `reasoning_content: "abc"` counts 3, not 6
- [ ] A final `{ choices: [], usage: {...} }` chunk sets `usage`; two usage chunks keep the last
- [ ] Non-streamed `{ choices: [{ message: { content: "", reasoning: "zz" }, finish_reason: "length" }], usage: { completion_tokens: 5 } }` -> `reasoning_len: 2`, `finish_reason: "length"`, `usage: { completion_tokens: 5 }`

### From HOW (accumulateAnthropic, unit tests)
- [ ] `thinking_delta` lengths sum into `reasoning_len` and content still excludes them
- [ ] `message_delta.stop_reason` -> `finish_reason`; `message_start.message.usage` merged with `message_delta.usage`, delta values winning
- [ ] Non-streamed: `thinking` block lengths -> `reasoning_len`, top-level `stop_reason` and `usage` captured
- [ ] No `message_delta` / `message_stop` -> `done: false`, `finish_reason: null`

### From HOW (runReview pass-through, unit tests with injected `getFn` / `streamFn`)
- [ ] OpenAI happy path: `r.completion` deep-equals the accumulator's completion plus `length_retried: false`
- [ ] OpenAI length re-call: first stream `finish_reason: "length"`, second `"stop"` -> `r.completion.finish_reason === "stop"`, `r.completion.length_retried === true`
- [ ] Anthropic happy path and `max_tokens` re-call: same two assertions
- [ ] Non-ok statuses (`unreachable`, `auth-failed`, `transport-failed`) carry no `completion` key

### From HOW (raw preamble, unit tests on `captureRawResponseBody` with an injected `writeFn`)
- [ ] A result with a completion writes the six new lines, in the documented order, after `# sha256:` and immediately before `# ---`
- [ ] `finish_reason: null` renders `none` when `done` is true and `none (stream ended without a finish)` when false; `usage: null` renders `none`; `length_retried` absent omits that line
- [ ] A result with no completion, and a `null` result, produce a preamble byte-identical to today's
- [ ] A `findings` result with a completion also carries the lines (not empty-only)

### From HOW (stderr, unit tests on `runReviewChain` with injected `log` and `runReviewFn`)
- [ ] Refuter empty, advancing and exhausted: the line keeps its current text and ends with the `formatCompletionLog` suffix
- [ ] Contract-mode empty, advancing and exhausted: same
- [ ] Refusal and malformed lines carry the suffix
- [ ] A result with no completion logs a line byte-identical to today's
- [ ] `res.exit` is 11 for an all-empty chain whether `done` is true or false
- [ ] Cut-empty: a one-element chain whose result is `{ status: "ok", content: "", completion: { finish_reason: null, done: false, content_len: 0, reasoning_len: 0, usage: null } }` exhausts to exit 11, and its exhausted stderr line contains `finish_reason=none done=false`

### From HOW (impure, new file `test/impure/review-call-empty-completion.test.mjs`)
- [ ] An in-process `http.createServer` on 127.0.0.1:0 serves `GET /v1/models` listing `A` and answers every chat POST with HTTP 200 SSE: reasoning-only `delta.reasoning` frames totalling 200 characters, a `finish_reason: "length"` frame, `[DONE]`; it records each POST's `max_tokens`
- [ ] review-call.mjs runs as a child (`spawn(process.execPath, [REVIEW_CALL, ...])`, as in `review-call-served-exit.test.mjs`) with `--backends-json` (a file holding `[{ provider: "openai", model: "A", host: <server>/v1 }]`), `--system` and `--diff` (small temp files), `--raw-dir <tmp>`, `--lens QA`, `--round 1`, `--max-tokens 100`
- [ ] Assertions: exit 11; recorded `max_tokens` is `[100, 200]`; the one raw file's preamble has `# finish_reason: length`, `# done: true`, `# content_len: 0`, `# reasoning_len: 200`, `# length_retried: true`; stderr has the exhausted line ending ` finish_reason=length done=true reasoning_len=200 content_len=0`; no file or stderr line contains the reasoning text
- [ ] The test closes the server and removes its temp dir in `finally`, and runs in under 10s

### From HOW (scope guards)
- [ ] No SKILL.md, `.faffrc*`, `buildOpenAiPayload`, `streamWithFirstByte`, `realStream`, `records/spikes/` or `eval/` change in the diff
- [ ] `faff validate-adapters` still passes

### Integration smoke test

```
1. start the in-process fake server (model A: reasoning-only, finish_reason "length")
2. spawn review-call.mjs --backends-json [A] --raw-dir <tmp> --lens QA --round 1 --max-tokens 100
3. attempt 1 (max_tokens 100): empty, length -> length re-call
4. attempt 2 (max_tokens 200): empty, length -> result ok, content "", completion { length, done, 0, 200, length_retried: true }
5. chain exhausted -> exit 11 (unchanged)
6. <tmp>/round-1.QA.0-openai-A.empty.txt preamble carries the completion lines; stderr carries the suffix
7. grep -h '^# finish_reason:' <tmp>/*.empty*.txt | sort | uniq -c  ->  "1 # finish_reason: length"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)**

- **What's there.** The spec has two separate pieces of work:
  - the `review-call.mjs` observability: the two accumulators, pass-through in `runReview*`, the preamble lines and the `[chain]` suffix;
  - the eval observability: an optional `completion` field on the judgement record, a new `makeOllamaCompletion`, and plumbing in `runCase`.

  The second piece depends on the first only for one import (`sanitizeFinishReason`). The DONE list runs to about 40 checks, and the spec rates itself `build-tier: complex`.
- **Why it matters.** FAFF-1247 gets its evidence from the first piece. Its primary source is the spec-review raw preambles. The second piece fills `completion` only in the direct ollama driver. The empties that started this ticket came from the GLM refutation evals, which ran through the frozen spike (excluded) or `claude -p` (records `completion: null`). So the eval slice adds no evidence about the observed empties, and it makes the build longer than the 1 to 3 day unit.
- **What to do.**
  - Preferred: move the eval slice (judgement-record field, `ollamaCompletion` / `makeOllamaCompletion`, the `runCase` branches and their DONE items) to a sibling Backlog ticket blocked by FAFF-1228. Narrow this ticket's acceptance to "every review call records ...".
  - Alternative: keep it here, but add a line saying the eval slice is not on FAFF-1247's evidence path and is the first thing to cut if the build runs long.

**Workstream fit? (principles 1 + 5)**

- **What's there.** FAFF-1228 has no project, as do FAFF-1247 and the siblings FAFF-1245 and FAFF-1246. All four plausibly serve one outcome: "review and judge calls end bounded and park honestly". FAFF-1228 is the "honestly" half: an exit-11 park that records its cause. FAFF-1067 (TTFT timing, same file) is review-call observability too, but it serves latency measurement rather than honest parking.
- **Why it matters.** Landing with no project is the correct default for a single ticket. With four live tickets now sharing one outcome, though, they are hard to sequence as a group: nothing says FAFF-1247 is the step that finishes the stream.
- **What to do.** No change to this spec. Put the four-ticket cluster forward for the next rehoming pass (`rehome-set`) as one outcome-led project. Leave FAFF-1067 out unless its outcome turns out to be the same.

**Deps surfaced? (principle 6)**

- **What's there.**
  - In the tracker, FAFF-1247 is only `relatedTo` FAFF-1228. FAFF-1228's `blocks` list is empty, and FAFF-1247's `blockedBy` list is empty. The spec, its Assumptions and the prep brief all say FAFF-1247 is blocked by FAFF-1228.
  - Separately, FAFF-1228's own description still carries the pre-split "Then decide ..." step and the acceptance line "The retry decision is made from logged occurrences".
- **Why it matters.**
  - With no blocker edge, automation can pick up FAFF-1247 today, before any completion record exists. That is the guess this split was made to prevent.
  - The stale acceptance line means a reviewer checking the ticket against its description will find a criterion this spec deliberately does not meet.
- **What to do.**
  - Convert the relation to a real blocker: FAFF-1228 blocks FAFF-1247.
  - Narrow FAFF-1228's description to the observability scope and point the decision at FAFF-1247.
  - Optionally, add a `relatedTo` from FAFF-1228 to FAFF-1067. They edit the same file, and the spec's collision check is only visible from this side.

**Risk profile? (principle 7)**

- **What's there.**
  - The technical risk is low. The changes are additive parsing, all of today's behaviour stays pinned by the existing tests, and there is an impure end-to-end test. The assumptions about backends sending usage are non-blocking because null is handled.
  - The remaining risk sits after this ticket. Even once a blocker edge exists, FAFF-1247 unblocks the moment FAFF-1228 merges. At that point there are zero logged occurrences, because the evidence only builds up over days of spec reviews. FAFF-1247 also expects "spec and code reviews", but code review keeps only a stderr line and retains nothing on disk.
- **Why it matters.** If FAFF-1247 is picked up straight after merge, it either parks with nothing to tally or decides from an empty sample. Both repeat the failure this split exists to avoid.
- **What to do.**
  - Give FAFF-1247 an explicit evidence threshold so it parks rather than decides when it is not met, for example "at least N empty preambles carrying `# finish_reason:` across at least 2 refs". Its spec should name the spec-review raw preambles as the retained source, with code-review stderr as supplementary only.
  - No de-risking spike is needed for FAFF-1228 itself.

**Applied at prep:**

- The FAFF-1247 relation is now a real blocker (FAFF-1228 blocks FAFF-1247), and FAFF-1247 carries an evidence threshold: it parks below 10 logged empties across 2 refs.
- FAFF-1228's description is narrowed to observability, and FAFF-1067 is linked as related.
- The eval slice moved to FAFF-1250 (blocked by this ticket) after spec review round 1 upheld the preferred option: it is not on FAFF-1247's evidence path.

confidence: high
build-tier: complex
spec-review: accept (round 1 revise: one minor, eval slice moved to FAFF-1250; fixed)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```
