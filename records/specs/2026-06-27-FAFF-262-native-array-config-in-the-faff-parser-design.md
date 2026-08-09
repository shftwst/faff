# Spec — FAFF-262: Native array config in the faff parser (arrays of maps)

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive · confidence: high.

This is the build spec for **FAFF-262**, extending the bundled faff config parser so `.faffrc.yaml` can express **block-sequence arrays** (including arrays of maps) as native JS arrays. Audience: the build agent editing `plugin/skills/faff/bin/faff` plus its selftest and `test/`; and the human reviewer. The change is **code** (one parser function + tests + a doc touch), small and well-bounded.

## 1. WHY — Problem and Principles

**The load-bearing model.** `parseYamlSubset` (the parser behind every `faff config` read) is a recursive-descent **map** parser — it understands scalars, nested maps, and block scalars, but **not block sequences**. A YAML list written the readable way (`key:` then `- item` lines) is mis-tokenised: a `- item` line is read as a key literally named `"-"`. So today the only way to put a list in `.faffrc` is a **JSON-string scalar** (`fallbacks: '[{"provider":"x"}]'`) that each consumer must `JSON.parse` itself. This change teaches the parser to read native block sequences, so a list is a real JS array straight out of `config get`.

**Problem statement.** List-valued config has to be hand-encoded as JSON-in-a-string — it can't be commented, diffs badly, can't be partially overridden, and every consumer re-implements the parse. Upcoming work (the lanes config; multiple adversarial + judgement actors, each a `{provider, model, host, …}` map) makes **ordered arrays of maps** the dominant shape, so the workaround stops scaling. This change makes block sequences first-class.

**Design principles:**

- **The parser backs every config read — do not regress it.** `parseYamlSubset` is shared by all of `faff config`. The single hardest constraint: existing scalar / nested-map / block-scalar parsing must be byte-for-byte unchanged. A regression guard (real `.faffrc` still parses identically) is mandatory, not optional.
- **Additive, not a rewrite.** Sequence support is a new branch composed into the existing `parseMap` indentation model — it reuses the same indent helpers and `scalar()` coercion. It must not alter `scalar()` (which already parses strict-JSON inline flow) or `collectBlockScalar`.
- **No new dependencies.** The CLI is a single dependency-free Node script; the parser stays hand-rolled.

**Reference context:**

| System | Form | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `parseYamlSubset` (~134–183) | Node | The sole change surface — add a block-sequence branch |
| `…/faff` → `scalar()` (~123–124) | Node | Already parses strict-JSON inline flow; **left untouched** (back-compat) |
| `…/faff` → `dig()` (~185–192) | Node | Returns an array as a final path segment fine; unchanged |
| `…/faff` → `config get --json` (~613–639) | Node | `JSON.stringify`s the value; already returns real arrays once the parser emits them — unchanged |
| `…/faff` → `configInitSelftest()` (~492–595) | Node | The `check(label, cond)` selftest table to extend |
| `test/config-defaults.test.mjs`, `test/adversarial-call.test.mjs` | Node test | `node --test` coverage to extend |

**Scope statement.** This sits entirely inside the config parser; it changes how `.faffrc.yaml` lists are read, nothing about what any consumer does with them.

## 2. OUT OF SCOPE

- **YAML-style (non-JSON) inline flow** (`key: [{provider: x}]`) — *Why excluded:* strict-JSON inline flow already parses via `scalar()`; full inline-flow YAML is a separate parser concern with low payoff. *Extension point:* `scalar()`.
- **Array indexing in `dig`** (`key.0.provider`) — *Why excluded:* consumers read the whole array, not elements by index; `dig` already returns the array as a final segment. *Extension point:* `dig()`.
- **Consumer migration of `fallbacks` → native list** — *Why excluded:* this ticket is parser-only; migrating the adversarial chain to a real `backends:` list is FAFF-261. *Extension point:* `review-call.mjs` + the adversarial SKILL.md (FAFF-261).
- **Sequences nested directly inside sequences** (a list whose items are themselves lists) — *Why excluded:* no current config needs list-of-lists; items are maps or scalars. *Extension point:* the sequence branch added here.
- **`scalar()` behaviour changes** — *Why excluded:* it already handles strict-JSON inline + scalar coercion and is load-bearing for back-compat. *Extension point:* none — deliberately frozen here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Block sequence | A YAML list written as `- item` lines under a key, one item per line (the readable multi-line form). |
| Array of maps | A block sequence whose items are mappings (`- key: val` + continuation keys) — the target shape (a list of `{…}` objects). |
| Sequence item | One `- …` entry. Its content may be a scalar (`- foo`), or a map whose first key sits on the dash line (`- provider: nvidia`) with continuation keys on following lines. |
| Item content indent | The column of the first character after `- ` on a dash line — the indent continuation keys of that item's map must align to. |

**Parser output contract (the change):**

```
parseYamlSubset(text) -> object tree, where:
  - a key whose value is a block sequence resolves to a JS Array
  - array elements are: objects (from `- key: val` map items) or
    coerced scalars (from `- scalar` items, via the existing scalar())
  - scalars, nested maps, block scalars, and strict-JSON inline flow
    parse exactly as today (unchanged)
```

**Recognition rule.** After a `key:` with empty inline value, peek the next non-blank line: if its indent is greater than the key's indent **and** its trimmed text begins with `- ` (or is exactly `-`), the value is a **block sequence** — parse it as an array. Otherwise the existing behaviour stands (nested map when deeper-indented, else `null`).

**Design decisions** (full rationale in §6):

- **Scope = block sequences (arrays of maps + arrays of scalars). `Chosen:`** the readable `- item` form is the gap; strict-JSON inline flow already works and YAML-style inline flow is out of scope.
- **`dig` array indexing. `Chosen:` out of scope** — consumers read whole arrays; `dig` already returns an array as a final segment.
- **`config get --json`. `Chosen:` no handler change** — it already `JSON.stringify`s structured values; verified + tested only.
- **Back-compat. `Chosen:` `scalar()` untouched; dual-read is permanent** — JSON-string scalars and strict-JSON inline flow keep parsing; native block sequence is the new preferred form. Both coexist indefinitely (cheap).

## 4. HOW — Behavior

**Overview.** Add one branch to `parseMap`: when a key's inline value is empty and the next deeper line opens a block sequence, call a new `parseSeq(seqIndent)` instead of recursing into `parseMap`. `parseSeq` collects consecutive dash lines at `seqIndent` and returns a JS array. The only genuinely fiddly part is the **`- key: val` map item**: the dash introduces a map whose first key is on the dash line, and continuation keys align to the *item content indent* (the column after `- `).

**Behaviour summary.** `parseSeq` turns a run of `- …` lines into an array; each item is a scalar, or a map assembled from the first key on the dash line plus continuation lines indented to the item content column.

```
PROCEDURE parseSeq(seqIndent):
  items = []
  WHILE next non-blank line exists AND indentOf(line) == seqIndent
        AND trimmed(line) starts with "-":
    strip the leading "-" (and one following space) -> remainder
    contentCol = seqIndent + 2          # column after "- "
    consume the dash line
    IF remainder == "":
      # item body is on following deeper lines
      peek next non-blank line:
        IF its indent > seqIndent AND it starts with "-":
            item = parseSeq(its indent)          # (list-of-lists: out of scope; see §2)
        ELSE IF its indent > seqIndent:
            item = parseMap(its indent)          # block map item
        ELSE item = null
    ELSE IF remainder is "key: val" or "key:"   # map item, first key inline
      firstKey, firstVal = split remainder on first ":"
      map = {}
      assign map[firstKey] from firstVal exactly as parseMap assigns a value
        (empty -> nested map/seq on lines indented > contentCol; else scalar(firstVal))
      # absorb continuation keys of THIS item
      WHILE next non-blank line has indent == contentCol AND is NOT a dash line:
        parse it as one more key: val of `map` (same value rules)
      item = map
    ELSE:
      item = scalar(remainder)          # array-of-scalars item
    items.push(item)
  RETURN items
```

**Wiring into `parseMap`** (the empty-value branch, ~lines 172–175): after computing that the next non-blank line is indented deeper than `minIndent`, check whether it begins with `-`; if so `result[key] = parseSeq(thatIndent)`, else the existing `parseMap(thatIndent)` path.

**Edge cases:**

- **Array of scalars** — `- a` / `- b` (no colon) → `["a","b"]`, each via `scalar()` (so `- 3` → number `3`, `- true` → boolean, quoting rules unchanged).
- **Multi-key map item** — continuation keys at the item content indent join the same object; the item ends at the next dash line at `seqIndent` or any dedent.
- **Nested map inside a map item** — a continuation key whose own value is empty + deeper lines recurses through the existing `parseMap` (composes for free).
- **Empty / blank lines and comments inside a sequence** — skipped by the existing `isSkip` helper, exactly as in `parseMap`.
- **Strict-JSON inline flow still wins** — `key: [{"a":1}]` never reaches `parseSeq` (it's a non-empty inline value handled by `scalar()`), so it parses as today.
- **A lone `-` with no content and no deeper body** → a `null` element (degenerate; acceptable).

**Failure modes:**

- **The failure:** the new branch regresses existing scalar / nested-map / block-scalar parsing — the parser backs *every* config read. **How you'd know:** the existing `test/config-defaults.test.mjs` / `setup-worktree-config.test.mjs` fail, or `faff config resolved` / `validate-adapters` misbehaves on a real `.faffrc`. **What it means:** mandatory regression guard — a real multi-block `.faffrc` must parse identically before/after; if sequence support can't be added without disturbing the map/scalar paths, narrow or abandon.
- **The failure:** the `- key: val` continuation-indent logic mis-attributes or drops a second key (merges items, or loses a key). **How you'd know:** the arrays-of-maps selftest case with a 2-key item returns an object missing a key, or array length is wrong. **What it means:** the item-content-indent rule is the crux — cover it explicitly in the selftest table.

**Anti-pattern:** editing `scalar()` to "also handle sequences." Why: it's the back-compat anchor for JSON-string scalars + inline flow; sequence handling belongs in a new `parseMap`-level branch, not in scalar coercion.

## 5. SCENARIOS

```
Given a .faffrc.yaml:
  faffter_dark:
    adversarial:
      backends:
        - provider: nvidia
          model: nemotron
        - provider: ollama
          model: qwen3
When parseYamlSubset parses it
Then dig(data, "faffter_dark.adversarial.backends") is a JS array of length 2,
  equal to [{provider:"nvidia",model:"nemotron"},{provider:"ollama",model:"qwen3"}]
```

```
Given the .faffrc above
When `faff config get --json faffter_dark.adversarial.backends` runs
Then stdout JSON.parses to an array of length 2 of those two objects
```

```
Given a key with a scalar block sequence:
  hosts:
    - alpha
    - beta
When parsed
Then dig(data, "hosts") === ["alpha","beta"]
```

Non-functional assertion: *a real existing `.faffrc.yaml` (scalars, nested `tracking:`/`slots:` maps, a block scalar, and a JSON-string `fallbacks:` scalar) parses to an identical object tree before and after this change — no regression to any non-sequence shape, and the JSON-string `fallbacks` still resolves to its string.*

## 6. DESIGN DECISION RATIONALE

**What scope of YAML list to support?** Options: (a) block sequences only / (b) also full YAML-style inline flow. **Chosen:** block sequences (arrays of maps + arrays of scalars) — *rationale:* the `- item` form is the actual gap and what people write in config; strict-JSON inline flow already parses via `scalar()`, and full inline-flow YAML is disproportionate effort for negligible use.

**Add array indexing to `dig`?** Options: support `key.0.field` / leave `dig` as-is. **Chosen:** leave as-is — *rationale:* consumers read whole arrays; `dig` already returns an array as a final segment. Indexing is unused complexity.

**Change the `config get --json` handler?** Options: modify it / rely on existing behaviour. **Chosen:** no change — *rationale:* it `JSON.stringify`s the resolved value, so it returns a real array the moment the parser emits one. Only a verifying test is added.

**How to keep back-compat?** Options: replace the JSON-string convention / keep both. **Chosen:** keep both permanently, `scalar()` untouched — *rationale:* existing `.faffrc` files with JSON-string lists (and strict-JSON inline flow) must keep working; dual-read costs nothing since the two forms are disjoint at parse time (a quoted/inline scalar value vs a following `- ` block).

**Where does the sequence branch live?** Options: inside `scalar()` / a new `parseMap`-level `parseSeq`. **Chosen:** new `parseSeq` composed into `parseMap`'s empty-value branch — *rationale:* reuses the existing indent model and keeps `scalar()` frozen.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the scope decisions above are all closed.

**Assumptions:**

- **Assumes:** `parseMap`'s existing indentation model (the `indentOf` helper + `minIndent` recursion) can host a sibling `parseSeq` using the same helpers. *Validate:* read `parseYamlSubset` (~134–183) before editing; confirm `indentOf`/`isSkip`/`stripInlineComment`/`scalar` are in scope for a new inner function and that `parseMap` is the only caller deciding the empty-value branch.
- **Assumes:** the only block-sequence item shapes any current or near-term `.faffrc` needs are *map* and *scalar* (not list-of-lists). *Validate:* grep existing `.faffrc.yaml` / `.faffrc.example.yaml` and the lanes/actors design notes; if a list-of-lists appears, it's the §2 extension point, not this ticket.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `.faffrc.yaml` block sequence parses to a native JS array (no JSON-string-scalar needed).

### From WHAT
- [ ] A block sequence of `- key: val` items resolves to an array of objects, with multi-key items intact.
- [ ] A block sequence of `- scalar` items resolves to an array of `scalar()`-coerced values.
- [ ] `faff config get --json <key>` for a sequence key prints a JSON array (no handler change required).
- [ ] `dig` still returns the array as a final path segment; `scalar()` is unmodified.

### From HOW (behaviour)
- [ ] Block sequence recognised only when the next deeper non-blank line begins with `-` after an empty-valued key.
- [ ] `- key: val` continuation keys at the item content indent join the same object; the item ends at the next dash or dedent.
- [ ] Nested maps inside a map item parse via the existing `parseMap` recursion.
- [ ] Strict-JSON inline flow (`key: [{"a":1}]`) and JSON-string scalars still parse unchanged.

### From HOW (edge cases / constraints)
- [ ] **Regression guard:** a representative real `.faffrc` (scalars + nested maps + block scalar + JSON-string `fallbacks`) parses to an identical tree before/after.
- [ ] `faff config init --selftest` gains cases: array-of-maps (multi-key), array-of-scalars, the regression round-trip; selftest passes.
- [ ] A `node --test` case (in `test/config-defaults.test.mjs` or a new file) covers block-sequence parsing + `config get --json` array output.
- [ ] `node --test` and `faff validate-adapters` stay green; `docs/guide/cli.md` `config` text clarifies that `get --json` returns native arrays (no new subcommand → `lint-cli-doc` stays green); `.faffrc.example.yaml` shows a native list form.

**Integration smoke test:**

```
WRITE a .faffrc.yaml with faffter_dark.adversarial.backends as a 2-item block sequence of maps
RUN `faff config get --json faffter_dark.adversarial.backends`
EXPECT stdout JSON.parses to a length-2 array of the two {provider,model} objects
AND `faff config get tracking.team_key` (a plain scalar) still returns its scalar
```

confidence: high
