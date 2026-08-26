# FAFF-917 — Rename the adversarial output-cap config key `num_predict` → `max_tokens`

> Spec: faffter-dark-nlspec · 2026-08-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-917.

This spec is for the build agent implementing FAFF-917, and for the human reviewer gating it. It describes a hard rename of one operator-facing configuration key and the matching internal CLI flag. It is a small, mechanical change with a wide-ish surface (config files, two skill dispatch seams, one helper script, two test files), so the value of the spec is an exhaustive, grep-checkable surface list, not architectural novelty.

## 1. WHY — Problem and Principles

**The load-bearing model.** The adversarial reviewer's output-token cap is a plain scalar config leaf under the `adversarial` namespace. Nothing in `config.js` or the CLI knows its name: it is read generically by `faff config get`, written generically by `faff config set`, and only two skill dispatch seams and one bundled helper (`review-call.mjs`) ever name it literally. So renaming the key is a text substitution at a known, finite set of literal sites, not a code-path change. The on-the-wire mapping (ollama receives `options.num_predict`, OpenAI and Anthropic receive `max_tokens`) is a separate concern inside `review-call.mjs` and is already correct; this change does not touch it.

**Problem statement.** The cap is currently spelled `num_predict`, which is ollama's name for the output-token limit. Every other provider faff talks to (OpenAI, vLLM, OpenRouter, NVIDIA, DeepSeek, Gemini, Anthropic) calls it `max_tokens`, so `num_predict` is the one ollama-flavoured name in an otherwise OpenAI-shaped config surface. This change renames the operator-facing key (and the matching internal `--num-predict` CLI flag) to `max_tokens` so the config surface reads consistently.

**Design principles.**

**Hard rename, no compatibility layer.** The operator has already decided (not to be re-opened) that there is no alias, no migration shim, and no deprecation warning. A config still spelled with the old key must simply stop resolving and fall through to the default. This is safe because the only live consumer of the old key is this repo's own `.faffrc.yaml`, confirmed by grep. An implementation that adds a fallback read of the old key, or a warning, violates this principle and must be rejected.

**Behaviour is unchanged; only the name changes.** The two-read resolution shape (`adversarial.<consumer>.max_tokens` else `adversarial.max_tokens` else the `2000` default), the `-gt 0` sanitisation guard, and the auto-double-once-on-truncation retry all keep their exact current behaviour. Only the key string and the flag string change.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Bash-in-Markdown | Read seam A: resolves the cap for code review, passes the flag to the helper |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Bash-in-Markdown | Read seam B: resolves the cap for spec review, passes the flag per lens |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JavaScript (ESM) | The helper that parses the CLI flag and maps it to the wire field |
| `.faffrc.yaml` | YAML | This repo's live config: two write sites plus comments |
| `.faffrc.example.yaml` | YAML | Documented example of the key |
| `plugin/skills/faff/SKILL.md` | Markdown | Gateway prose that names the `--num-predict` flag once |
| `test/config-set.test.mjs` | JavaScript (ESM) | Asserts the key is a writable scalar leaf under `adversarial` |
| `test/adversarial-call.test.mjs` | JavaScript (ESM) | Asserts `review-call.mjs` parses the flag |

**Scope statement.** This is a rename inside the `adversarial` review engine's config and dispatch surface; it does not touch how any slot is selected, how backends are chosen, or how the review verdict is shaped.

## 2. OUT OF SCOPE

- **The `eval/review-bench/` benchmark harness** — `run-bench.mjs`, `full-bench.mjs`, `build-requests.mjs`, and `eval/review-bench/README.md`. **Why excluded:** review-bench is a standalone developer benchmarking tool with its own `--num-predict` flag; it builds its ollama/OpenAI payloads inline and does not spawn `review-call.mjs`, nor does it read faff config. Its flag is a separate developer-facing interface, not the operator config surface FAFF-917 targets, so renaming it is optional churn on an unrelated tool. **Extension point:** if a future issue wants the developer bench flags to match, `eval/review-bench/run-bench.mjs` `parseArgs` and `full-bench.mjs` forwarding are the sites.

- **The eval-judge output cap** — `eval/README.md` and `eval/cli-driver.mjs` references to `options.num_predict`. **Why excluded:** these describe the eval-judge subsystem's own ollama output cap, a different code path from adversarial review. **Extension point:** `eval/cli-driver.mjs`.

- **The internal `numPredict` JavaScript variable and `DEFAULT_NUM_PREDICT` constant inside `review-call.mjs`.** **Why excluded:** these are private identifiers, not operator- or interface-facing; renaming roughly fifteen internal call sites (`buildChatPayload`, `streamOnce*`, `callReview*`, `runReviewChain`) is cosmetic churn with test-regression risk for zero user-visible benefit. **Extension point:** a future cosmetic-cleanup issue could rename them, but it is deliberately not part of this change.

- **The on-the-wire field names** — `options.num_predict` (ollama) in `buildChatPayload`, and `max_tokens` (OpenAI/Anthropic) in `buildOpenAiPayload`/`buildAnthropicPayload`, plus the explanatory comments around them in `review-call.mjs`. **Why excluded:** `options.num_predict` is ollama's actual API field name; changing it would break the wire request. The mapping is already correct. **Extension point:** none; this is provider-API-dictated.

- **`records/` and `.faff/anchors/` history.** **Why excluded:** specs, ADRs, build-progress anchors, and branch-name artifacts record what was true when written and are never retro-edited. **Extension point:** none.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| output-token cap | The maximum number of tokens the adversarial reviewer is allowed to emit for its findings. |
| operator-facing key | A config leaf an operator writes in `.faffrc.yaml` and reads back via `faff config get`. |
| dispatch seam | A `SKILL.md` shell block that resolves config and invokes `review-call.mjs`. |
| internal variable | A private identifier inside `review-call.mjs`, never named by an operator or a caller. |

**Config keys (the rename).**

```
BEFORE                                        AFTER
adversarial.num_predict                    →  adversarial.max_tokens
adversarial.code_review.num_predict        →  adversarial.code_review.max_tokens
adversarial.spec_review.num_predict        →  adversarial.spec_review.max_tokens
```

These remain plain scalar leaves. No schema, validator, or CLI code special-cases them (confirmed: `git grep` for `num_predict` in `plugin/skills/faff/bin/` outside `review-call.mjs` returns nothing).

**CLI flag (the rename).**

```
BEFORE                          AFTER
review-call.mjs --num-predict N →  review-call.mjs --max-tokens N
```

The parsed field the flag populates keeps its internal name:

```
argv "--max-tokens" <N>  →  a.numPredict = Number(<N>)   # field name unchanged (internal)
```

**Unchanged wire mapping (do NOT touch).**

```
buildChatPayload:      options: { num_predict: numPredict }   # ollama API field — stays
buildOpenAiPayload:    max_tokens: maxTokens                  # already correct — stays
buildAnthropicPayload: max_tokens: maxTokens                  # already correct — stays
```

**Design decision — what to rename.** The operator-facing key and the interface-facing CLI flag are renamed; the private JS variable is not.

**Chosen:** rename the config key and the `--num-predict` → `--max-tokens` CLI flag (both dispatch seams, the `review-call.mjs` argv parse, and the usage string), and leave the private `numPredict` variable and `DEFAULT_NUM_PREDICT` constant untouched. Rationale: the key and flag are what operators and the SKILL-to-helper interface expose, so consistency there has user-visible value; the internal variable is invisible, and renaming it is churn with regression risk for no benefit.

## 4. HOW — Behavior

**Architecture and approach.** The change is a literal substitution at each site below. The resolution logic and its guard keep their exact shape; only the key string and flag string change.

**Read seam A — `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (around lines 184–196).** The resolution block currently reads:

```
if [ -n "$consumer" ]; then num_predict=$("$faff" config get "adversarial.$consumer.num_predict"); fi
[ -z "$num_predict" ] && num_predict=$("$faff" config get adversarial.num_predict -d 2000)
[ "$num_predict" -gt 0 ] 2>/dev/null || num_predict=2000
...
      --num-predict "$num_predict" \
```

becomes (config keys and the flag renamed; the two-read fallback, the `[ -n "$consumer" ]` guard, and the `-gt 0` reset all preserved):

```
if [ -n "$consumer" ]; then max_tokens=$("$faff" config get "adversarial.$consumer.max_tokens"); fi
[ -z "$max_tokens" ] && max_tokens=$("$faff" config get adversarial.max_tokens -d 2000)
[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000
...
      --max-tokens "$max_tokens" \
```

The surrounding comments (lines 184, 186, and the `malformed adversarial..num_predict` note) are updated to name `max_tokens`. Renaming the local shell variable `num_predict` → `max_tokens` is included here for readability, since it is fully local to the block.

**Read seam B — `plugin/skills/faffter-dark-spec-review/SKILL.md` (around lines 69–94).** Same substitution:

```
max_tokens=$("$faff" config get adversarial.spec_review.max_tokens)
[ -z "$max_tokens" ] && max_tokens=$("$faff" config get adversarial.max_tokens -d 2000)
[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000
```

plus the two prose mentions of `--num-predict` in the `LensRequest.argv` documentation (the `node -e` comment at line 84 and the argv sentence at line 94) become `--max-tokens`. The comment at line 69 is updated to name `max_tokens`.

**Helper — `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`.** Two sites only:

```
PROCEDURE rename_cli_flag:
  1. Line ~963: change the matched flag string
       else if (k === "--num-predict") a.numPredict = Number(argv[++i]);
     to
       else if (k === "--max-tokens")  a.numPredict = Number(argv[++i]);
     (the assigned field a.numPredict is UNCHANGED — internal name kept)
  2. Line ~1310 (usage string): change "[--num-predict N]" to "[--max-tokens N]"
  3. Leave every other numPredict / DEFAULT_NUM_PREDICT / options.num_predict occurrence untouched
```

**Config write and doc sites.**

```
.faffrc.yaml:
  line 99   adversarial.code_review.num_predict: 32000  →  max_tokens: 32000
  line 101  adversarial.spec_review.num_predict: 32000  →  max_tokens: 32000
  lines 84, 93–94  comment references to num_predict / the resolution chain  →  max_tokens

.faffrc.example.yaml:
  lines 363–366  the documented "# num_predict: 2000" key and the resolution-chain
                 comments  →  max_tokens
                 (the parenthetical "ollama options.num_predict" that explains the wire
                 mapping stays accurate — it names the wire field, not the config key)
```

Note on `.faffrc.yaml`: it already carries an unstaged modification at the start of this work (per `git status`). The build agent edits only the two key lines and their comments and must not revert unrelated pending changes.

**Gateway prose — `plugin/skills/faff/SKILL.md` (line 267).** The Effort-lanes paragraph names the adversarial judge's engine-block flag as `(--num-predict / model)`. Update the flag token to `--max-tokens` so the prose matches the renamed interface. This is a one-token doc-accuracy edit, not a behaviour change.

**Edge cases and fallback chain (unchanged behaviour, verify preserved).**

- **Old key present after the change** — a config that still says `adversarial.num_predict` no longer matches the renamed reads, so `max_tokens` is empty, the two-read fallback yields the `-d 2000` default, and the `-gt 0` guard passes it through. This is the intended hard-rename outcome: the old key silently stops taking effect. No warning, by principle.
- **Per-consumer precedence** — `adversarial.<consumer>.max_tokens` still wins over `adversarial.max_tokens`, which still wins over `2000`.
- **Non-positive or non-numeric value** — the `-gt 0` guard still resets empty, non-numeric, float, `0`, and negative values to `2000`, so nothing malformed reaches the wire.
- **Unset consumer in seam A** — the `[ -n "$consumer" ]` guard still prevents a query against the malformed `adversarial..max_tokens` path.

**Anti-pattern:** adding any read of the old `num_predict` key as a fallback (`config get adversarial.num_predict` after a miss on `max_tokens`). Why: it reintroduces the compatibility behaviour the operator explicitly ruled out, and hides that the rename is incomplete.

**Anti-pattern:** renaming `options.num_predict` in `buildChatPayload`. Why: that is ollama's real API field; changing it breaks the ollama request wire format.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a .faffrc.yaml with adversarial.spec_review.max_tokens: 12000 and adversarial.max_tokens: 8000
When the spec-review dispatch seam resolves the output-token cap
Then it resolves to 12000 (the per-consumer key wins over the global key)
```

```
Given a .faffrc.yaml that still uses the pre-rename key adversarial.num_predict: 32000 and no max_tokens key
When either dispatch seam resolves the output-token cap
Then the old key does NOT take effect and the cap falls through to the 2000 default
```

- The `git grep` sweep for the operator-facing name over live config and dispatch code (excluding `records/`, `.faff/`, and `eval/`) MUST return zero hits after the change.
- The ollama wire field `options.num_predict` MUST still be present in `review-call.mjs` (the mapping is unchanged).

## 6. Design decision rationale

**Should the rename ship with a backward-compatible alias or a deprecation warning?**
- Options: (a) hard rename, no alias; (b) read both keys for a release, warn on the old one.
- (b) pros: tolerant of any external config; cons: keeps the ollama-flavoured name alive, adds a code path and a warning surface for a key with exactly one live consumer.
- (a) pros: clean, single-change, matches the operator's stated intent; cons: any config that still uses the old key silently loses its override (acceptable here — grep confirms the only consumer is this repo's own `.faffrc.yaml`, edited in the same change).
- **Chosen:** (a) hard rename, no alias, no shim, no warning — the operator's fixed scope decision, safe because the sole consumer is edited in the same change.

**Which names change, and which stay?**
- Options: (a) rename config key only; (b) rename config key plus the SKILL-to-helper CLI flag; (c) rename all of those plus the private `numPredict` JS variable.
- (a) leaves the flag as `--num-predict`, so the interface between the seams and the helper still carries the ollama name — inconsistent with the config.
- (c) touches roughly fifteen internal call sites for no user-visible gain, with test-regression risk.
- **Chosen:** (b) rename the config key and the CLI flag, keep the private variable and `DEFAULT_NUM_PREDICT` — rename exactly what is operator- or interface-facing, no more.

**Does the `eval/review-bench/` harness get renamed too?**
- Options: (a) include it for consistency; (b) exclude it.
- review-bench is a standalone benchmark tool with its own `--num-predict` flag; it does not spawn `review-call.mjs` and does not read faff config, so its flag is a separate developer interface, not the operator surface this issue targets.
- **Chosen:** (b) exclude it — it is out of the operator-config surface, and its flag rename is optional developer-tool churn that would widen a scoped change.

**Does the on-the-wire mapping change?**
- **Chosen:** no. `options.num_predict` (ollama) and `max_tokens` (OpenAI/Anthropic) are provider-API field names and are already mapped correctly; changing them would break the request wire format. At the time of writing, ollama's chat API names the output cap `num_predict` under `options`.

## 7. Open questions and assumptions

**Open questions.** None. The one design question the explore surfaced (whether to rename the CLI flag alongside the key) is resolved as Chosen in section 6.

**Assumptions.**

**Assumes:** the only live config consumer of the old key is this repo's own `.faffrc.yaml`. Validation: run `git grep -nE 'adversarial\.[a-z_]*\.?num_predict' -- . ':(exclude)records/' ':(exclude)eval/' ':(exclude).faff/'` before starting; the only non-comment hits should be `.faffrc.yaml` lines 99 and 101. If any other live config file names the key, widen the edit to include it.

**Assumes:** no `config.js`/CLI code special-cases the key name. Validation: `git grep -niE 'num_?predict' -- plugin/skills/faff/bin/ | grep -v review-call.mjs` returns nothing (confirmed during spec authoring).

## 8. DONE — Definition of Done

### From WHY
- [ ] After the change, an operator sets the cap via `adversarial.max_tokens` / `adversarial.<consumer>.max_tokens`; the config surface no longer contains the ollama-flavoured `num_predict` key in live files.
- [ ] No backward-compatible alias, migration shim, or deprecation warning for the old key exists anywhere in the change.

### From WHAT (config keys)
- [ ] `.faffrc.yaml` lines 99 and 101 read `max_tokens: 32000` (code_review and spec_review), with no `num_predict` key remaining in the file.
- [ ] `.faffrc.yaml` comments at lines 84, 93–94 name `max_tokens` (except where they explain the ollama `options.num_predict` wire field, which stays accurate).
- [ ] `.faffrc.example.yaml` lines 363–366 document `max_tokens` and the `adversarial.<consumer>.max_tokens || adversarial.max_tokens || 2000` resolution chain; the parenthetical naming the ollama wire field `options.num_predict` remains.

### From WHAT (CLI flag)
- [ ] `review-call.mjs` line ~963 matches `--max-tokens` and still assigns `a.numPredict`; the internal field name is unchanged.
- [ ] `review-call.mjs` usage string (line ~1310) shows `[--max-tokens N]` and no `--num-predict`.
- [ ] `review-call.mjs` `options.num_predict` (ollama wire field) and `numPredict` / `DEFAULT_NUM_PREDICT` identifiers are unchanged.

### From HOW (dispatch seams)
- [ ] `faffter-dark-adversarial-review/SKILL.md` reads `adversarial.$consumer.max_tokens` then `adversarial.max_tokens -d 2000`, keeps the `[ -n "$consumer" ]` guard and the `[ ... -gt 0 ] || =2000` reset, and passes `--max-tokens "$max_tokens"` to the helper.
- [ ] `faffter-dark-spec-review/SKILL.md` reads `adversarial.spec_review.max_tokens` then `adversarial.max_tokens -d 2000`, keeps the `-gt 0` reset, and the `LensRequest.argv` prose (lines 84 and 94) names `--max-tokens`.
- [ ] `plugin/skills/faff/SKILL.md` line 267 names the adversarial judge's flag as `--max-tokens`.

### From HOW (behaviour preserved)
- [ ] Per-consumer key still wins over the global key, which still wins over the `2000` default.
- [ ] A non-positive or non-numeric value still normalises to `2000` via the `-gt 0` guard.
- [ ] A config that still uses the old `num_predict` key no longer takes effect and falls through to the default.

### From tests
- [ ] `test/config-set.test.mjs` asserts `adversarial.max_tokens`, `adversarial.spec_review.max_tokens`, and `adversarial.code_review.max_tokens` are writable scalar leaves (the three renamed assertions, their test names, and comments updated); the `-gt 0` guard test still passes.
- [ ] `test/adversarial-call.test.mjs` line 128 passes `--max-tokens` to `parseArgs`, and line 132 still asserts `a.numPredict === 1500` (internal field unchanged); the wire-field assertions on `options.num_predict` (lines 29, 35, 117, 695) are unchanged.
- [ ] The full test suite passes.

### Grep DONE criterion
- [ ] `git grep -nE 'adversarial\.[a-z_]*\.?max_tokens' -- .faffrc.yaml` shows the renamed keys, and `git grep -nE '(adversarial\.[a-z_]*\.?num_predict)|--num-predict' -- . ':(exclude)records/' ':(exclude).faff/' ':(exclude)eval/'` returns **zero** hits (no live config or dispatch code references the old operator-facing key or flag).
- [ ] `git grep -n 'options.num_predict' plugin/skills/faffter-dark-adversarial-review/review-call.mjs` still returns the ollama wire-field mapping (proves the wire mapping was not touched).

**Integration smoke test.**

```
PROCEDURE smoke:
  1. In a scratch dir, write .faffrc.yaml:
       adversarial:
         max_tokens: 8000
         spec_review:
           max_tokens: 12000
  2. faff config get adversarial.spec_review.max_tokens        # expect 12000
  3. faff config get adversarial.max_tokens                    # expect 8000
  4. faff config get adversarial.spec_review.num_predict -d 2000   # expect 2000 (old key gone)
  5. node review-call.mjs --max-tokens 1500 ... (parse-only path) # expect the cap parsed as 1500
```

If steps 2–4 return the expected values and step 5 parses without an unknown-flag path, the rename is wired end to end.

confidence: high
build-tier: complex
