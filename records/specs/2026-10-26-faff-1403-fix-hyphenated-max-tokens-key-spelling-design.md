# Spec — FAFF-1403: Fix the hyphenated `max-tokens` key spelling in the spec_judge / build_judge adversarial sub-blocks

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1403.

This is a buildable spec for Linear issue FAFF-1403, written for the build agent that will apply the fix and for the human reviewer who approves it. It describes a surgical, one-line-per-block key rename in this repo's own committed `.faff/config.yaml`. There is no code change: FAFF-972 already wired the underscore lookup on the code side; this ticket is purely the committed config file's key spelling.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff resolves a judge's output-token cap through a lookup chain that reads the underscore key `adversarial.<judge>.max_tokens`, falling back to `adversarial.max_tokens` and finally to a hard-coded default of 2000 tokens. A config key spelled `max-tokens` (hyphen) is not the key the chain reads — it is an inert sibling. The intended `15000` value sits in the file but is never consulted; the lookup silently lands on the 2000 default. This is the "inert key" failure mode: a value that looks set but is read by nobody.

**Problem statement.** The committed `.faff/config.yaml` sets the spec-judge and build-judge output caps under the hyphenated key `max-tokens: 15000`, so the lookup falls through to the 2000-token default instead. At 2000 tokens, reasoning-heavy judge backends exhaust the budget on hidden reasoning tokens before emitting visible content, so Phase-1 blind reconstruction comes back empty or truncated (observed 2026-10-26: 3 of 5 judge propositions parked with `reconstruction empty/failed`). Renaming the two keys to the underscore spelling the chain actually reads restores the intended 15000-token budget.

**Design principle — surgical edit, byte-identical siblings.** The only change permitted is the key spelling on two lines. The value (`15000`), the `refs:` lists, every sibling sub-block (`code_review`, `spec_review`), and all surrounding structure stay byte-identical. A reformat, reorder, or incidental edit elsewhere in the file would be out of scope and must be rejected in review.

**Design principle — the CLI is the only reader of this file.** `.faff/config.yaml` is faff's own configuration and is read ONLY via the `faff config` CLI, never hand-read or hand-parsed. Verification is `faff config get`, not grepping the file.

**Reference context.**

| System | Relevance |
|---|---|
| `.faff/config.yaml` → `adversarial.spec_judge` | Holds the first misspelled key; target of the rename |
| `.faff/config.yaml` → `adversarial.build_judge` | Holds the second misspelled key; target of the rename |
| `.faff/config.yaml` → `adversarial.code_review`, `adversarial.spec_review` | Sibling sub-blocks that already use the correct underscore spelling; the pattern to match, must not be touched |
| FAFF-972 | Fixed the code-side lookup (wiring `max_tokens`); this ticket fixes the committed config that FAFF-972's wiring expects |

**Scope statement.** This is a config typo fix in the hosting repo's own faff config — it restores the judge's intended token budget and does not change faff's code, schema, or behaviour for any adopter.

## 2. OUT OF SCOPE

- **Code-side lookup changes** — Why excluded: FAFF-972 already wired the underscore lookup; the code reads `max_tokens` correctly. Extension point: `adversarial` token-cap resolution in the faff CLI source, if the fallback chain itself ever needs revisiting (not here).
- **A schema/validator that rejects unknown `adversarial.*` keys** — Why excluded: a lint that catches inert hyphenated keys before they ship is a real improvement but is a code+test change of a different altitude, not this one-line config fix. Extension point: a future `faff config` lint pass or `validate-adapters` rule over the `adversarial` block; file a separate ticket.
- **The `refs:` backend lists and the `15000` value** — Why excluded: the diagnosis is the key spelling alone; the value and backends are already what the ticket intends. Extension point: tune under `adversarial.spec_judge` / `adversarial.build_judge` in a separate change if a different budget or backend set is ever wanted.
- **The sibling `code_review` / `spec_review` sub-blocks** — Why excluded: they already use the correct underscore spelling and are verified correct. Extension point: none needed; leave byte-identical.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Inert key | A config key whose spelling no lookup reads, so its value is silently ignored while appearing to be set |
| Lookup chain | The ordered resolution `adversarial.<judge>.max_tokens` → `adversarial.max_tokens` → hard-coded `2000` |
| Judge | The would-be-park interceptor backend run by the spec-review / build gate; `spec_judge` and `build_judge` are its two adversarial sub-blocks here |

**The edit, as literal key renames.** Two lines change, each only in the key token before the colon:

```
# adversarial.spec_judge sub-block
- max-tokens: 15000        # BEFORE: hyphen — inert, not read
+ max_tokens: 15000        # AFTER:  underscore — read by the lookup chain

# adversarial.build_judge sub-block
- max-tokens: 15000        # BEFORE: hyphen — inert, not read
+ max_tokens: 15000        # AFTER:  underscore — read by the lookup chain
```

The value `15000`, the trailing `refs: [openrouter-deepseek-v4-flash-reasoning, openrouter-gemma]` line in each sub-block, and all other sub-blocks remain unchanged.

**Design decision — how to express the write.** `faff config set` / `init` cannot safely rename a key in general (it sets values, it does not rewrite a misspelled key in place without risk to surrounding structure). The fix is a surgical YAML edit of the two key tokens.

**Chosen:** Edit `.faff/config.yaml` directly, renaming only the `max-tokens` key token to `max_tokens` on the one line inside each of the `spec_judge` and `build_judge` sub-blocks, preserving the value, the `refs:` list, and every sibling block byte-for-byte. Verify exclusively through `faff config get`.

## 4. HOW — Behaviour

**Approach.** Locate each misspelled key within its sub-block and rename only the key token, leaving the rest of the line (`: 15000`) and the sub-block intact. Because YAML keys are position-sensitive, the edit must target the `max-tokens` line that sits under `spec_judge:` and the one under `build_judge:` specifically — not any other `max-tokens` or `max_tokens` elsewhere in the file.

```
PROCEDURE rename_inert_judge_key(subblock):   # subblock ∈ { spec_judge, build_judge }
  1. Locate the line `max-tokens: 15000` nested directly under `adversarial.<subblock>:`
  2. Rename the key token `max-tokens` → `max_tokens` on that line only
  3. Leave the value `15000`, the `refs:` line, indentation, and comments unchanged
  4. Do NOT touch `code_review`, `spec_review`, or any other block
APPLY rename_inert_judge_key(spec_judge)
APPLY rename_inert_judge_key(build_judge)
```

**Anti-pattern:** Running `faff config set adversarial.spec_judge.max_tokens 15000`. Why: it does not remove the pre-existing inert `max-tokens` line, so the file would carry both a dead hyphenated key and the new one — clutter that re-invites the same confusion. Rename the existing key in place instead.

**Anti-pattern:** Reformatting or reordering the `adversarial` block while editing. Why: the diff must be exactly two changed key tokens; any wider churn obscures the fix and risks disturbing a verified-correct sibling.

**Edge cases.**

- **A hyphenated key still present after the edit** — If either `adversarial.spec_judge.max-tokens` or `adversarial.build_judge.max-tokens` still resolves via `faff config get` after the edit, the rename removed nothing and left a duplicate; the edit is wrong. Both hyphenated lookups must return non-zero (key absent) once the rename is complete.
- **YAML parse integrity** — The file must still parse after the edit: `faff config get` on any key returning a value (not a parse error) confirms the document is still valid YAML.

## 5. Scenarios

The main objective is a single observable: the underscore key the lookup chain reads now resolves to `15000`, and the inert hyphenated key is gone. This is above the trivial bar only in that it is the whole point of the ticket; it maps directly to the acceptance checks.

```
Given the committed .faff/config.yaml with the two judge keys renamed to the underscore spelling
When `faff config get adversarial.spec_judge.max_tokens` is run
Then it prints `15000` and exits 0 (not exit 3)
```

```
Given the same renamed config
When `faff config get adversarial.build_judge.max_tokens` is run
Then it prints `15000` and exits 0 (not exit 3)
```

```
Given the rename is a move, not an addition
When `faff config get adversarial.spec_judge.max-tokens` and `adversarial.build_judge.max-tokens` (hyphen) are run
Then each exits non-zero (the inert key no longer exists)
```

- The sibling sub-blocks are unchanged: `faff config get adversarial.code_review.max_tokens` and `adversarial.spec_review.max_tokens` both still return `15000`.

## 6. Design Decision Rationale

**How should the two misspelled keys be corrected?**

- *Option A — rename the key token in place (chosen).* Pros: minimal diff (two key tokens), preserves value/refs/siblings byte-for-byte, removes the inert key. Cons: requires a direct YAML edit rather than a CLI command.
- *Option B — `faff config set` the underscore key.* Pros: uses the sanctioned write path. Cons: does not delete the existing hyphenated line, leaving a dead duplicate key; `set` is not a safe general key-rename and risks surrounding structure.
- *Option C — add a code-side alias so `max-tokens` is also read.* Pros: would tolerate the typo. Cons: wrong altitude entirely — rewards the misspelling, is a code+test change, and FAFF-972 already fixed the code side.

**Chosen:** Option A — rename `max-tokens` → `max_tokens` in place within each of the `spec_judge` and `build_judge` sub-blocks. Rationale: it is the smallest change that removes the inert key and routes the existing `15000` value to the lookup the code already reads, with no code change and no sibling disturbance.

## 7. Open Questions and Assumptions

**Open Questions.** None. The diagnosis, the fix, and the verification are all closed.

**Assumptions.**

- **Assumes:** the lookup chain is `adversarial.<judge>.max_tokens` → `adversarial.max_tokens` → `2000` as documented by FAFF-972 and confirmed live (the underscore keys currently return exit 3 while the hyphenated keys return `15000`). Validation: before editing, run `faff config get adversarial.spec_judge.max_tokens` and expect exit 3; after editing, expect `15000`. If the pre-edit underscore lookup already returned `15000`, the premise would not hold and the edit should pause for re-diagnosis.

## Already shipped against this surface

Related Done work on the adversarial token-cap surface — **none supersedes this ticket's premise**. This repo's committed `.faff/config.yaml` still carries the hyphenated `spec_judge` / `build_judge` keys, confirmed live: `faff config get adversarial.spec_judge.max_tokens` returns exit 3 (absent) while the hyphenated `max-tokens` returns `15000`. Included as reader context:

- **FAFF-972** (Done 2026-09-03) — wired `max_tokens` into the spec-review judge dispatch on the **code** side. This ticket fixes the committed **config** file that FAFF-972's wiring reads; the code-side resolution is already correct, so there is no code change here.
- **FAFF-917** (Done 2026-08-26) — renamed a *different* adversarial output-cap key (`num_predict` → `max_tokens`). It did not touch the `spec_judge` / `build_judge` sub-block key spelling.

Premise verdict: **holds** — proceed unchanged.

## 8. DONE — Definition of Done

### From WHAT (the edit)
- [ ] The `adversarial.spec_judge` sub-block's token-cap key is spelled `max_tokens` (underscore), value `15000`, with its `refs:` list unchanged.
- [ ] The `adversarial.build_judge` sub-block's token-cap key is spelled `max_tokens` (underscore), value `15000`, with its `refs:` list unchanged.
- [ ] No `max-tokens` (hyphen) key remains in either sub-block.

### From HOW (behaviour, verified via the CLI)
- [ ] `faff config get adversarial.spec_judge.max_tokens` returns `15000` and exits 0 (not exit 3).
- [ ] `faff config get adversarial.build_judge.max_tokens` returns `15000` and exits 0 (not exit 3).
- [ ] `faff config get adversarial.spec_judge.max-tokens` exits non-zero (inert key removed).
- [ ] `faff config get adversarial.build_judge.max-tokens` exits non-zero (inert key removed).

### From OUT OF SCOPE (siblings untouched)
- [ ] `faff config get adversarial.code_review.max_tokens` still returns `15000`.
- [ ] `faff config get adversarial.spec_review.max_tokens` still returns `15000`.
- [ ] The diff touches only the two key tokens — no other lines in `.faff/config.yaml` change.

### Spot-check (manual, not a new automated test)
- [ ] A live spec-review judge dispatch against a case that previously returned `reconstruction empty/failed` at the 2000-token fallback no longer truncates at the same point. This is a one-time manual confirmation that the restored 15000-token budget takes effect; it is a config typo fix, not a code defect, so no new automated test is added.

**Integration smoke test.**

```
1. Run `faff config get adversarial.spec_judge.max_tokens`  → expect `15000`, exit 0
2. Run `faff config get adversarial.build_judge.max_tokens` → expect `15000`, exit 0
3. Run `faff config get adversarial.spec_judge.max-tokens`  → expect non-zero exit
4. If all three hold, the lookup now reads the intended budget — plumbing connected.
```

confidence: high
spec-review: approve
build-tier: standard
