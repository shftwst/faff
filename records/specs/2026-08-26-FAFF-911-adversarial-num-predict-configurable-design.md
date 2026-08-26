# Spec — FAFF-911: operator-configurable adversarial-review output cap (`adversarial.num_predict`)

> Spec: faffter-dark-nlspec · 2026-08-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-911.

_Revised 2026-08-26 (2 rounds of spec-review, QA lens) — round 1: a present-but-non-integer config value bypassed the `-d 2000` default and reached the wire as `null`; round 2: the first guard (`case ... *[!0-9]*`) still let `0` through (→ `max_tokens: 0`, zero output). Now uses the `-gt 0` integer guard in both HOW procedures, closing empty/non-numeric/float/`0`/negative in one test; section 3, edge cases, scenarios, and the negative-test criterion updated to name zero._

This spec is for the build agent implementing FAFF-911, and for the human reviewers gating it. It threads a new operator config key through the two production adversarial-review dispatch seams so the review's output-token cap can be raised without a code change. It is a config-threading change in an existing repo; no new architecture is decided here.

## 1. WHY — problem and principles

**The output cap the reviewer streams under is a single hardcoded scalar, `DEFAULT_NUM_PREDICT = 2000`, and no config key can raise it.** The review model streams its `### <severity>:` findings under this cap. On a large diff a verbose reviewer (reasoning-off) can exhaust 2000 output tokens before emitting any finding: the call returns `finish: "length"` with 0 content bytes, `review-call.mjs` reports empty/malformed, the chain advances to a slower fallback, and the graft parks on a review outage even though the code under review is fine. The measured trigger is the 67.5k-token FAFF-906 diff, which came back empty at the 2000 cap.

**Problem statement.** The cap is code-only, so the sole way to give a verbose reviewer more room on a big diff is to edit source. This change adds an `adversarial.num_predict` config key resolved `adversarial.<consumer>.num_predict || adversarial.num_predict || 2000`, threaded into the review dispatch, so an operator raises the ceiling by editing `.faffrc.yaml`.

**Load-bearing model.** `review-call.mjs` already threads a `--num-predict` flag end-to-end (CLI parse → chain → every backend → all three payload builders → the one-shot 2x truncation retry). Nothing in that helper needs to change. The gap is only that neither production dispatch seam reads a config key or appends the flag, so both silently fall back to the builder default of 2000. The fix lives entirely in the two SKILL.md dispatch blocks plus config documentation and tests.

**Design principle — this knob raises the reasoning-OFF ceiling for verbose/large-diff cases; it does not make reasoning-on viable.** A full review-bench sweep of the target model (`unsloth/Qwen3.8-27B-NVFP4` on vLLM) showed reasoning-off stays tight on easy payloads (~308 output tokens on the skeleton diff) but overruns on large diffs. Reasoning-ON is not rescued by any sane cap on this model: a 4-lens panel at a 16000 cap took 14.5 min wall-clock and the architectural lens still hit the cap empty (a regression from 2 findings reasoning-off). The key exists to give the reasoning-off path headroom, not to enable reasoning-on. Documentation and rationale must say so.

**Design principle — an explicit default-valued flag must be byte-identical to appending nothing.** The dispatch always appends `--num-predict <value>` with the resolved value defaulting to 2000. Because `2000 == DEFAULT_NUM_PREDICT` and every builder already defaults to that constant, appending `--num-predict 2000` produces the same wire payload as today's no-flag path. Existing configs that set no key are unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JS | Already threads `--num-predict` chain-wide (parse line 923, chain line 1372, per-backend line 1167, builders lines 85/464/533, 2x retry lines 787/841/883). No change. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Skill prose | Code-review dispatch block (lines 166-192); reads `adversarial.timeout` two-read at 176-177, appends flags to the review-call argv at 183. Change site. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Skill prose | Spec-review dispatch block (lines 58-88); reads timeout two-read at 67-68, builds per-lens `LensRequest.argv` at 78. Change site. |
| `plugin/skills/faff/bin/lib/config.js` | JS | `config get <dotted> -d <default>` reads any key via `dig` (line 2078); `adversarial` already in `WRITABLE_NAMESPACES` (line 896). No schema registration needed. |
| `.faffrc.example.yaml` | YAML | Adversarial block (lines 351-401); scalar leaves `timeout` (358) and `deadline` (359) are the doc-placement precedent. |

**Scope.** This is the operator knob for the existing adversarial-review output budget; it sits beside `adversarial.timeout` / `adversarial.deadline` as another dispatch-time scalar the two SKILL.md seams read and append.

## 2. Out of scope

- **Per-backend `num_predict` in the `--backends-json` mapper.** Excluded. Why: the mapper (review-call.mjs lines 1282-1295) reads per-backend `timeout` and `first_byte_timeout` but has no `num_predict` slot; `num_predict` is a chain-wide shared scalar (`shared.numPredict`, line 1167), not per-backend. Adding a per-backend override is new behaviour, not a mirror of an existing per-backend field, and the documented failure is a global-cap problem. Extension point: the `raw.map` block at review-call.mjs lines 1282-1295 (add a `numPredict: (b.num_predict != null) ? Number(b.num_predict) : shared.numPredict` slot and thread it into `callReview`) plus a `num_predict` field in the `--backends-json` schema.
- **Changing `review-call.mjs` threading or the 2x truncation retry.** Excluded. The helper already threads `--num-predict` fully and doubles it once on truncation (lines 787/841/883). The retry behaviour is kept exactly. Extension point: none needed; the helper is complete.
- **The review-bench harness (`eval/review-bench/*.mjs`).** Excluded. It is the only caller that passes `--num-predict` today and it builds its own payloads, so it never exercises the production review-call path. No change.
- **Reasoning-on enablement.** Excluded. The operational evidence shows a raised cap does not make reasoning-on viable on the target model. This key does not touch `reasoning_off` / `reasoning_effort`.

## 3. WHAT — vocabulary, keys, and resolution

**Vocabulary.**

| Term | Definition |
|---|---|
| consumer | The per-consumer selector the calling seam sets: `code_review` (adversarial code review) or `spec_review` (L4 spec review). Same selector already used for `adversarial.<consumer>.timeout`. |
| resolved cap | The integer value passed as `--num-predict` after the two-read fallback resolves. |

**Config key.** `adversarial.num_predict` — global scalar leaf under the existing `adversarial` namespace. Optional per-consumer override `adversarial.<consumer>.num_predict` (`adversarial.code_review.num_predict`, `adversarial.spec_review.num_predict`). Both are plain integer scalars, readable and writable with zero schema registration:

- Readable: `config get` digs any dotted key with a `-d` default (config.js line 2078/2085). No `DEFAULTS` registry entry needed, exactly like `adversarial.timeout` / `adversarial.deadline`.
- Writable: `adversarial` is in `WRITABLE_NAMESPACES` (config.js line 896), and `num_predict` is a scalar leaf, so `config set` accepts it. It must NOT be added to `SEQUENCE_VALUED_KEYS` (config.js lines 873-877) — that set is list-valued keys only, and `num_predict` is a scalar.

**Resolution (the two-read fallback, mirroring `timeout`).**

```
raw_cap =
  config get adversarial.<consumer>.num_predict     # per-consumer override, empty/exit-3 if unset
  || config get adversarial.num_predict -d 2000     # global, default 2000 when unset

resolved_cap = raw_cap if raw_cap is a positive integer, else 2000   # integer-normalisation guard
```

The global read yields a value on the absent-key path (2000 by `-d`), but `-d` fires only when the key is **absent** — a key that is *present but not a positive integer* (`num_predict: abc`, an empty string, a float, `0`, or a negative value) is returned verbatim with exit 0 and bypasses the default (`config.js` `dig` at line 2078, `-d` fallback at 2085 only on null/undefined). Two failure shapes follow if left un-normalised: a non-numeric/empty value makes `Number("abc") = NaN` (and the builder default rescues only `undefined`, not `NaN`), reaching the wire as `num_predict: null` / `max_tokens: null`; and `0` reaches the wire as `max_tokens: 0` — zero output tokens, the exact empty-output failure this ticket exists to fix. The **integer-normalisation guard** closes both: a resolved value that is not a positive integer falls back to 2000, so `resolved_cap` is always a concrete positive integer and the dispatch always appends `--num-predict <resolved_cap>`. The guard is the `-gt 0` integer test (see section 4), which rejects `0` and negatives as well as non-numeric and float values — a digit-only pattern match would let `0` through. This mirrors the safe-default intent of the `timeout` reads without importing new validation the config layer doesn't do.

## 4. HOW — behaviour

**Both production dispatch seams gain the same two-read + append, placed beside the existing `timeout` read.** Neither seam passes `--num-predict` today; both will after this change. `review-call.mjs` is untouched.

**Code-review seam — `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (lines 166-192).**

```
PROCEDURE code_review_dispatch (after the existing timeout read at 176-177):
  1. IF consumer is set (`[ -n "$consumer" ]`): num_predict = config get "adversarial.$consumer.num_predict"
     — the SAME guard the timeout read uses at 176, because this seam has unset-consumer callers
       (adr-drift leaves consumer UNSET, prdr sets prdr_review); an unguarded read would query
       the malformed `adversarial..num_predict`.
  2. IF num_predict empty: num_predict = config get adversarial.num_predict -d 2000
  3. NORMALISE: if num_predict is not a positive integer, reset to 2000. In shell:
     `[ "$num_predict" -gt 0 ] 2>/dev/null || num_predict=2000`
     — the `-gt` integer test rejects empty, non-numeric, and float values (the `2>/dev/null` swallows
       the "integer expression expected" error, `||` then defaults) AND rejects `0` and negatives
       (both fail `-gt 0`). A digit-only `case` guard would let `0` / `00` through — see section 3.
  4. In the `node "$REVIEW_CALL" --backends-json ... --timeout "$timeout" ...` argv (line 183),
     append: --num-predict "$num_predict"
```

Add prose to the block naming the new read and the appended flag, matching how the timeout read is documented. The per-consumer read is guarded on `[ -n "$consumer" ]` exactly as the timeout read is; an unset consumer (adr-drift) resolves byte-identically to the global-or-2000 value.

**Spec-review seam — `plugin/skills/faffter-dark-spec-review/SKILL.md` (lines 58-88).**

```
PROCEDURE spec_review_dispatch (after the existing timeout read at 67-68):
  1. num_predict = config get adversarial.spec_review.num_predict     # per-consumer, empty if unset
  2. IF num_predict empty: num_predict = config get adversarial.num_predict -d 2000
  3. NORMALISE: if num_predict is not a positive integer, reset to 2000
     (`[ "$num_predict" -gt 0 ] 2>/dev/null || num_predict=2000`) — same guard as the code-review seam
     (rejects empty/non-numeric/float AND `0`/negatives).
  4. In the per-lens LensRequest.argv built at line 78 (documented at 88), include:
     --num-predict "$num_predict"
     — identical across every lens in the pass, assembled once like $timeout, not per lens.
```

Update the argv documentation at lines 88 and 92 to list `--num-predict "$num_predict"` alongside `--timeout "$timeout"`.

**Config documentation — `.faffrc.example.yaml` (adversarial block, after `deadline` at line 359).** Add a commented `num_predict` scalar leaf documenting: the global default of 2000, the resolution order (`adversarial.<consumer>.num_predict || adversarial.num_predict || 2000`), that it raises the reasoning-off output ceiling for verbose/large-diff reviews (not a reasoning-on enabler), and that the one-shot truncation retry still doubles the resolved value. Mirror the per-consumer sub-block note already present at lines 348-350.

**Edge cases.**

- **Unset everywhere:** both reads miss, `-d 2000` yields 2000, dispatch appends `--num-predict 2000` — byte-identical to today's no-flag path (builders default to `DEFAULT_NUM_PREDICT = 2000`).
- **Global set, per-consumer unset:** per-consumer read empty, global read returns the operator value, that value is appended for every consumer.
- **Per-consumer set:** per-consumer read wins for that consumer; other consumers fall through to global-or-2000.
- **Truncation retry composes unchanged:** whatever value is appended, a truncated first stream retries once at `resolved_cap * 2` (review-call.mjs lines 787/841/883). An 8000 cap retries at 16000.
- **Malformed value (present but not a positive integer):** a config value like `num_predict: abc`, an empty string, a float, `0`, or a negative number is returned verbatim by `config get` (exit 0, bypassing `-d`); the `-gt 0` integer-normalisation guard resets it to 2000, so the dispatch appends `--num-predict 2000` rather than letting `Number("abc") = NaN` reach the wire as `null` or `0` reach it as `max_tokens: 0` (zero output).

**Anti-pattern:** adding `num_predict` to `SEQUENCE_VALUED_KEYS`. Why: that set exists to refuse list-valued keys (`adversarial.refs`, `adversarial.fallbacks`); `num_predict` is a scalar and belongs nowhere near it — adding it there would make the key unwritable.

**Anti-pattern:** editing `review-call.mjs` to read config or re-resolve the cap. Why: the helper is pure transport and reads no config; the config-read seam is the SKILL.md dispatch prose. Duplicating resolution into the helper would create two sources of truth.

**Anti-pattern:** appending the flag only when a key is set (conditional append). Why: always appending with `-d 2000` keeps the two seams uniform with the `timeout` precedent and is byte-identical to no-flag at the default, so there is no behaviour fork to reason about.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given no adversarial.num_predict key and no per-consumer override in .faffrc.yaml
When the code-review or spec-review dispatch resolves the cap
Then it appends --num-predict 2000, byte-identical to today's no-flag wire payload
```

```
Given adversarial.num_predict is set to 8000 and no per-consumer override
When either dispatch seam resolves the cap
Then --num-predict 8000 is appended, and a truncated first stream retries once at 16000
```

```
Given adversarial.num_predict is set to a value that is not a positive integer (e.g. abc, 0, -1, or 3.5)
When either dispatch seam resolves the cap
Then the -gt 0 integer-normalisation guard resets it and --num-predict 2000 is appended (no NaN/null, and no max_tokens: 0, on the wire)
```

- `adversarial.num_predict` is a writable scalar leaf: `config set adversarial.num_predict 8000` exits 0 and writes the key.

## 5. Design decision rationale

**Does the per-consumer override (`adversarial.<consumer>.num_predict`) ship in v1, or is global-only enough?**
- Global-only: simpler, covers the documented FAFF-906 failure (a code-review large-diff overrun).
- Per-consumer + global: mirrors the existing `adversarial.<consumer>.timeout` two-read at the exact same dispatch sites; the config layer already supports the nested scalar with zero registration; the ticket's own stated resolution order is `adversarial.<consumer>.num_predict || adversarial.num_predict || 2000`.

**Chosen:** ship the per-consumer override in v1 — the two-read is a one-line mirror of the `timeout` read already present at both seams, the ticket specifies the three-level resolution, and it costs nothing extra in the config layer. Spec-review (large ~15k-token context blocks) and code-review have genuinely different verbosity profiles, so a per-consumer knob is useful, not speculative.

**Add per-backend `num_predict` to the `--backends-json` mapper?**
- For: symmetry with per-backend `timeout` / `first_byte_timeout`.
- Against: `num_predict` is currently a single chain-wide shared scalar, not a per-backend field; adding a per-backend slot is new threading through `callReview`, not a mirror, and no evidence shows different backends in one chain need different caps.

**Chosen:** defer — keep `num_predict` a single global (optionally per-consumer) scalar for v1. Deliberately out of scope, not an open question; the extension point is recorded in section 2.

**Always append `--num-predict` (even the default 2000) vs conditional append?**
**Chosen:** always append, resolving through `-d 2000` then the `-gt 0` integer-normalisation guard. It keeps the two seams uniform with the `timeout` precedent and is byte-identical to the no-flag path at the default value, so no behaviour fork exists.

## 6. Open questions and assumptions

None. Every decision is closed above; no `**Punt:**` items. No external dependency is assumed — every touched file and seam is verified present in the repo.

## 7. DONE — definition of done

### From WHY
- [ ] With no `num_predict` key set, both dispatch seams append `--num-predict 2000`, producing the same wire payload as the pre-change no-flag path (no regression for existing configs).
- [ ] `.faffrc.example.yaml` documents that the key raises the reasoning-off ceiling for verbose/large-diff reviews and does not enable reasoning-on.

### From WHAT (keys and resolution)
- [ ] `adversarial.num_predict` resolves via `config get adversarial.num_predict -d 2000` with no `DEFAULTS` registration.
- [ ] `config set adversarial.num_predict 8000` exits 0 and writes the key (writable scalar leaf) — asserted in `test/config-set.test.mjs`, mirroring the `per-consumer timeout IS a writable scalar leaf` test at lines 138-144.
- [ ] `config set adversarial.spec_review.num_predict 12000` exits 0 and writes the nested key (per-consumer scalar leaf, not caught by the refs carve-out) — asserted in `test/config-set.test.mjs`.
- [ ] `num_predict` is NOT added to `SEQUENCE_VALUED_KEYS`.

### From HOW (behaviour)
- [ ] Code-review dispatch (`faffter-dark-adversarial-review/SKILL.md`) reads `adversarial.$consumer.num_predict` (guarded on `[ -n "$consumer" ]`, mirroring the timeout read at line 176) then `adversarial.num_predict -d 2000`, and appends `--num-predict "$num_predict"` to the review-call argv at the invocation on line 183.
- [ ] Spec-review dispatch (`faffter-dark-spec-review/SKILL.md`) performs the same two-read and includes `--num-predict "$num_predict"` in each `LensRequest.argv` (assembled once, identical across lenses), with the argv documentation at lines 88 and 92 updated.
- [ ] `.faffrc.example.yaml` adversarial block gains a commented `num_predict` leaf after `deadline` (line 359) documenting default, resolution order, and retry-doubling.
- [ ] Per-consumer override wins over global when both are set; global wins over the 2000 default.
- [ ] Both dispatch seams normalise a resolved value that is not a positive integer (empty string, non-numeric, float, `0`, or negative) back to 2000 before appending `--num-predict`, using the `-gt 0` integer test, so neither `NaN`/`null` nor `max_tokens: 0` reaches the wire. A negative test covers at least `abc` and `0` (both → `--num-predict 2000`), landing in `test/config-set.test.mjs` alongside the writable-leaf tests, or a shell-level guard test if one exists for the dispatch prose.

### From HOW (unchanged behaviour — regression guards)
- [ ] `review-call.mjs` is unmodified; `test/adversarial-call.test.mjs` continues to pass, including: `--num-predict 1500` parses to `a.numPredict === 1500` (lines 127-132), builders default to `DEFAULT_NUM_PREDICT` (lines 25-35), and the truncation retry doubles the budget (lines 112-125, 641-651).

### Integration smoke test
```
1. In a temp repo, write .faffrc.yaml with `adversarial:\n  num_predict: 8000\n`
2. Run `faff config get adversarial.num_predict`  → prints 8000
3. Run `faff config get adversarial.code_review.num_predict -d 2000` → prints 2000 (per-consumer unset → falls through)
4. Run `faff config set adversarial.spec_review.num_predict 12000` → exits 0, file now has the nested key
5. Run `faff config get adversarial.spec_review.num_predict` → prints 12000
```

confidence: high
build-tier: complex
spec-review: approve
