# Per-consumer adversarial-review backends (FAFF-870)

> Spec: faffter-dark-nlspec · 2026-08-18 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-870.

This spec defines a buildable change for FAFF-870, "Configure adversarial-review backends per-consumer (spec_review / code_review / prdr_review), not one shared fallback list." The audience is the build agent implementing it and the human reviewers gating the spec. It is written against the post-FAFF-871 config surface, where the adversarial config lives at the root `adversarial.*` namespace (commit ed4bb0b6 collapsed the former `faffter_dark.adversarial.*` into it). Nothing below reintroduces the `faffter_dark` namespace.

## 1. WHY — problem and principles

**The load-bearing model.** Every adversarial-review consumer today resolves its model backend chain through the single shared `adversarial.*` block. This change lets a named consumer point `adversarial.<consumer>.refs` at its own ordered list of backend names, resolved by the same mechanism the shared `adversarial.refs` already uses. When a consumer has no such sub-block, it resolves through the existing shared assembly with byte-identical output. The whole feature is one added optional layer in front of an unchanged resolver, reached by a new `--consumer <name>` argument that is inert when the sub-block is absent.

**Problem statement.** All adversarial-review consumers share one fallback chain and one timeout, so a spec-altitude prose challenge and a code-altitude diff challenge cannot pin different models or different latency budgets. This change gives three named consumers (spec_review, code_review, prdr_review) their own chain and timeout. An unset per-consumer key resolves exactly as today, so no existing `.faffrc` changes behaviour.

**Design principles.**

**Zero behaviour change when unset is the governing constraint.** Any implementation that alters the emitted backend JSON, the resolved timeout, or an exit code for a config with no per-consumer keys is wrong, regardless of how clean it looks. The existing `test/adversarial-backends.test.mjs` fixtures are all single flat blocks and must pass untouched.

**This is config ergonomics, not a correctness fix.** No residency semantics, no transport behaviour, and no `review-call.mjs` byte change belong in this work. The per-consumer layer selects a chain and a timeout; everything else the resolver already does stays where it is.

**The consumer seam is open-ended, not an allowlist.** Any consumer name is accepted. An unrecognised or unconfigured name is not an error; it finds no sub-block and falls through to the shared chain. This keeps future consumers free to adopt the seam without editing a central list.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node CJS | `assembleAdversarialBackends(cfg)` and the `faff adversarial-backends` CLI handler this change extends |
| `plugin/skills/faff/bin/lib/backends.js` | Node CJS | `resolveBackendRefs(cfg, refs)` (the name-list resolver reused for per-consumer refs) and `backendsConfigCheckFindings(cfg)` (the residency guard to extend) |
| `plugin/skills/faff/bin/lib/config.js` | Node CJS | `SEQUENCE_VALUED_KEYS` and the `config set` refusal to extend; `DEFAULTS` (holds no `adversarial.timeout`) |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown prose | the spec_review call site of `faff adversarial-backends` |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown prose | the shared Backend call block (code_review seam) and the adr-drift / prdr-yagni seams |
| `.faffrc.example.yaml` | YAML | documented config surface, to gain the per-consumer keys |

**Scope statement.** This sits entirely inside the adversarial-review configuration and dispatch path; it changes how a chain and timeout are selected, and touches no other slot, gate, or contract.

## 2. Out of scope

- **Per-consumer legacy primary / host / fallbacks / backends blocks.** Excluded: a consumer selects a chain only through `adversarial.<consumer>.refs` (a name list), never its own inline primary+fallbacks. Why: the settled shape is refs-name selection, which keeps the per-consumer surface minimal and reuses one resolver. Extension point: a future issue wanting inline per-consumer backends would extend `assembleAdversarialBackends` to check `adversarial.<consumer>.backends` before falling through.

- **Per-consumer deadline, requires, or any other adversarial field.** Excluded: only the chain (refs) and `timeout` split per consumer. `deadline`, `requires`, and all other fields stay global. Why: `spec_review` does not even read `adversarial.deadline` today (its Backend call block reads only `adversarial.timeout`), so a per-consumer deadline would add behaviour beyond the zero-change-when-unset guarantee. Extension point: a future issue would add `adversarial.<consumer>.deadline` resolution at the two adversarial-review call sites that read `adversarial.deadline`.

- **A generic `faff backends`-style CLI replacing `assembleAdversarialBackends`.** Excluded: `adversarial-backends` keeps its own assembly (legacy primary+fallbacks, native backends, refs) rather than being folded into `faff backends resolve`. Why: the legacy and native forms have no equivalent in the name-list-only `faff backends` CLI, and collapsing them is a larger refactor that risks the byte-identity guarantee. Extension point: `resolveBackendRefs` is already the shared resolver both call into; a future consolidation issue would migrate `adversarial-backends` onto `faff backends` once the legacy forms are retired.

- **`review-call.mjs` transport changes.** Excluded: the transport, its exit codes, and its `--backends-json` mapper are untouched. Why: the per-consumer layer resolves a chain and timeout that arrive at the transport in the existing shape. Extension point: none needed; `test/adversarial-call.test.mjs` must stay byte-for-byte green.

## 3. WHAT — config surface, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Consumer | A named adversarial-review caller: `spec_review`, `code_review`, or `prdr_review` today; the name is open-ended, so any string is a valid consumer name. |
| Per-consumer sub-block | The optional config map `adversarial.<consumer>` carrying `refs` and/or `timeout` for one consumer. |
| Shared assembly | The existing `assembleAdversarialBackends` fallthrough: `adversarial.refs` → `adversarial.backends` → legacy `adversarial` primary + `adversarial.fallbacks`. |
| Fallthrough | Resolving through the shared assembly because no per-consumer sub-block applies; produces byte-identical output to a no-`--consumer` call. |

**Config surface (new optional keys).**

```
RECORD adversarial.<consumer>:              # e.g. adversarial.spec_review
  refs: List<String>       # OPTIONAL — ordered backend NAMES into the merged
                           #   top-level backends:/engines: namespace, same
                           #   mechanism as adversarial.refs. Non-empty, all strings.
  timeout: Number          # OPTIONAL — per-consumer override of adversarial.timeout
                           #   (seconds, bounds one stream attempt)

  CONSTRAINT unset sub-block  ->  consumer resolves via shared assembly (byte-identical)
  CONSTRAINT refs present but empty / non-string-element  ->  ignored, falls through
  CONSTRAINT no per-consumer deadline / requires / provider / host / fallbacks / backends
```

The existing root `adversarial.*` fields (`provider`, `model`, `host`, `api_key_env`, `reasoning_off`, `timeout`, `deadline`, `requires`, `fallbacks`, `backends`, `refs`) are unchanged.

**CLI surface.** `faff adversarial-backends` gains one flag:

```
faff adversarial-backends [--consumer NAME] [--root DIR] [--json] [--selftest]
```

- `--consumer NAME`: resolve `adversarial.<NAME>.refs` first; if absent/empty, fall through to shared assembly. Absent flag = today's behaviour exactly.
- `--json` stays accepted-and-ignored (the default output already is the JSON array).
- Output shape, exit codes (0 ok / 3 unset / 2 malformed), and `BACKEND_KEYS` are unchanged.

**Resolver signature.**

```
assembleAdversarialBackends(cfg, consumer?)  ->  { chain } | { error: "unset" } | { error: "malformed", detail }
```

`consumer` is optional; omitting it reproduces the current single-argument behaviour byte-for-byte.

**Design decision — what a consumer may split.** Options: split chain + timeout only; or split chain, timeout, deadline, and requires. **Chosen:** split chain (refs) and timeout only; deadline, requires, and all other fields stay global. Rationale: `spec_review` does not read `adversarial.deadline` today, so a per-consumer deadline would add behaviour where an unset key must add none.

**Design decision — config shape for the per-consumer chain.** Options: a per-consumer refs-name list; or a per-consumer legacy primary+fallbacks block. **Chosen:** per-consumer `adversarial.<consumer>.refs`, an ordered name list resolved by the existing `resolveBackendRefs` against the merged `backends:`/`engines:` namespace. It reuses one resolver and keeps the sub-block to two optional keys.

## 4. HOW — behaviour

### Resolver fallthrough

**Behaviour summary.** `assembleAdversarialBackends` gains an optional `consumer` argument. When a consumer names a sub-block with a usable `refs` list, that list resolves the chain. In every other case the function runs its existing logic unchanged, so the emitted chain is identical to a no-consumer call.

```
PROCEDURE assembleAdversarialBackends(cfg, consumer):
  1. adv = dig(cfg, "adversarial")
  2. IF adv is not a plain object: RETURN { error: "unset" }        # unchanged
  3. IF consumer is present and non-empty:
     a. sub = adv[consumer]                                          # the sub-block, if any
     b. IF sub is a plain object
          AND Array.isArray(sub.refs) AND sub.refs.length > 0
          AND every element of sub.refs is a string:
            res = resolveBackendRefs(cfg, sub.refs)
            IF res.error: RETURN { error: "malformed", detail: res.error }
            RETURN { chain: res.chain.map(pickBackendKeys) }
     c. ELSE: fall through to step 4 (byte-identical to no consumer)
  4. <existing assembly unchanged: adv.refs -> adv.backends -> legacy primary + fallbacks>
```

Precedence: a usable `adversarial.<consumer>.refs` wins over everything in the shared assembly. Anything short of a usable per-consumer refs list (absent flag, absent sub-block, non-object sub-block, empty or non-string refs) falls through to the shared assembly with no observable difference.

**Anti-pattern:** reading the per-consumer sub-block through `pickBackendKeys` or letting it leak into the legacy primary. Why: `pickBackendKeys` copies only `BACKEND_KEYS`, so a sub-block key like `spec_review` is already ignored by the legacy path; the per-consumer branch must resolve refs explicitly and must not add the sub-block to the primary object.

**Anti-pattern:** naming a consumer after a reserved `adversarial` field (`refs`, `backends`, `fallbacks`, `host`, `provider`, `timeout`, `deadline`, `requires`). Why: `adv["refs"]` is the shared refs array, not a `{refs}` sub-block, so `sub.refs` is undefined and the call silently falls through; a consumer must use a distinct name. Document this in the example config rather than enforcing an allowlist.

### CLI wiring

`cmdAdversarialBackends` parses `--consumer` (arity 1) from `ADVERSARIAL_BACKENDS_SPEC` and passes it to `assembleAdversarialBackends(cfg, values["--consumer"])`. Exit-code handling and stderr text are unchanged.

### Per-consumer timeout resolution

**Behaviour summary.** The chain JSON and the scalar timeout are read separately at every call site. Rather than fold timeout into the resolver output (which would change the emitted JSON shape and risk byte-identity), each call site does a two-read fallback in shell.

```
PROCEDURE resolve_timeout(consumer):
  1. t = faff config get adversarial.<consumer>.timeout       # empty when unset
  2. IF t is empty:
       t = faff config get adversarial.timeout -d 120         # global, then caller default
  3. USE t as --timeout
```

`adversarial.<consumer>.timeout` is a plain scalar leaf. `WRITABLE_NAMESPACES` already contains `adversarial`, and nested leaves need no registration, so `faff config set adversarial.spec_review.timeout 240` works with no config.js change. `DEFAULTS` holds no `adversarial.timeout`, so the `-d 120` (spec_review) and `-d 120` / `-d 480` (adversarial-review) caller defaults remain the only defaults.

**Design decision — timeout mechanism.** Options: (a) two-read shell fallback at each call site, no CLI change; or (b) fold a `timeout` field into `adversarial-backends --consumer` output. **Chosen:** (a) the two-read shell fallback. It keeps the CLI change to the single `--consumer` flag, leaves the emitted JSON shape and byte-identity untouched, and matches how every call site already reads the timeout as a separate scalar.

### Call-site wiring (the three named consumers plus adr-drift)

**Behaviour summary.** Each named consumer passes its own name to `faff adversarial-backends` and reads its own timeout; the unnamed adr-drift seam passes no consumer and falls through.

- **spec_review** — `plugin/skills/faffter-dark-spec-review/SKILL.md` Backend call block: change `"$faff" adversarial-backends > "$backends_json"` to `"$faff" adversarial-backends --consumer spec_review > "$backends_json"`, and set `timeout` via the two-read fallback on `adversarial.spec_review.timeout` then `adversarial.timeout -d 120`.

- **code_review** — `plugin/skills/faffter-dark-adversarial-review/SKILL.md` shared Backend call block (the refutation-code / Phase-2 diff transport): parameterize the block with a `consumer` shell variable, set `consumer=code_review` on this path, pass `--consumer "$consumer"`, and resolve the timeout via the two-read fallback on `adversarial.code_review.timeout` then `adversarial.timeout -d 120`. `deadline` stays `adversarial.deadline -d 480` (global, unchanged).

- **prdr_review** — the prdr-yagni seam reaches the adversarial engine by dispatching the `review` slot with a proposal-shaped input (gateway "Upper-gate (YAGNI) two-phase arbitration"; `faff-plot` Step 5c), not through the diff-shaped Backend call block. Wherever that seam resolves its adversarial backend chain via `faff adversarial-backends`, it passes `--consumer prdr_review` and reads `adversarial.prdr_review.timeout` with the same two-read fallback. Because the seam is described as reusing the mechanical path abstractly rather than carrying its own literal bash block, the build agent locates the concrete invocation and threads the consumer there; it must not assume a second copy of the code_review block already exists.

- **adr-drift** — left unnamed. It passes no `--consumer`, so it falls through to the shared chain, byte-identical to today. Future consumers inherit the seam for free by passing their own name.

**Anti-pattern:** hard-coding `consumer=code_review` into the shared block such that the prdr-yagni reuse also emits `code_review`. Why: the two seams must resolve distinct sub-blocks; the consumer value is set by the calling seam, defaulted to unset (adr-drift), never baked into the shared block.

### `config set` refusal for per-consumer refs

**Behaviour summary.** `adversarial.<consumer>.refs` is sequence-valued and must be refused by `config set` for the same reason `adversarial.refs` is: its documented forms (JSON-string, bare inline-flow) read back as a scalar, so a value-shape guard alone cannot catch them. Because consumer names are open-ended, an exact key set cannot enumerate them.

```
PROCEDURE is_sequence_valued_key(key):
  RETURN SEQUENCE_VALUED_KEYS.has(key)                             # the existing exact set
      OR /^adversarial\.[A-Za-z0-9_]+\.refs$/.test(key)            # per-consumer refs, open-ended
```

`cmdConfigSet` replaces `SEQUENCE_VALUED_KEYS.has(key)` with `is_sequence_valued_key(key)`. The regex requires the three-segment `adversarial.<name>.refs` shape, so it never matches the two-segment `adversarial.refs` (already in the exact set) and never matches `adversarial.<consumer>.timeout` (a legitimate writable scalar). The refusal message and exit 2 are unchanged.

**Design decision — carve-out representation.** Options: enumerate the three named consumers in `SEQUENCE_VALUED_KEYS`; or a regex predicate alongside the exact set. **Chosen:** the regex predicate. The consumer seam is open-ended, so enumeration would silently fail to refuse a fourth consumer's refs; the predicate closes the whole shape. `configSetSelftest`'s drift check gains a per-consumer refs case to pin the predicate to the schema.

### `config check` residency guard extension

**Behaviour summary.** `backendsConfigCheckFindings` today inspects only the single `adversarial.refs` block against the global `adversarial.requires`. Since `requires` stays global but per-consumer `refs` can now exist, the derived-egress soundness check must also iterate each `adversarial.<consumer>.refs` against that same global `requires`.

```
PROCEDURE backendsConfigCheckFindings(cfg):                  # extension only
  ... existing merge-error, budget.allow_unmetered, and adv.refs handling ...
  WHEN adv.requires is present AND is a recognised residency value:
    FOR each key k in adv WHERE adv[k] is a plain object AND Array.isArray(adv[k].refs):
      FOR each name in adv[k].refs:
        b = merged.backends[name]
        IF b exists AND b.egress == "local" AND NOT b._egress_explicit:
          push warn finding, surface `adversarial.<k>.refs[<name>]`, same message shape as today
```

The `requires` enum validation (fail-closed on an unrecognised value) stays exactly as written and runs once, globally. The per-consumer loop reuses the same derived-vs-explicit egress test as the existing `adversarial.refs` loop. Enumerating only sub-blocks whose value is an object with a `refs` array skips the reserved scalar/array fields (`host`, `timeout`, `refs`, `backends`, `fallbacks`).

**Design decision — residency guard extension.** Options: leave the guard on the shared block only; or iterate per-consumer refs too. **Chosen:** iterate each `adversarial.<consumer>.refs` against the global `adversarial.requires`. A per-consumer chain that leans on a derived (not explicit) `egress: local` is exactly the soundness gap the guard exists to surface, and it is invisible if the guard stays single-block.

### Documentation

`.faffrc.example.yaml` gains a short commented example under the `adversarial:` block showing the per-consumer keys, for instance:

```
#   spec_review:
#     refs: [gemini-gemma]      # spec-altitude prose challenge — its own chain
#     timeout: 240              # OPTIONAL — overrides adversarial.timeout for this consumer
#   code_review:
#     refs: [nvidia-glm, studio-ollama]
#   # prdr_review: { refs: [...] }   # any consumer name; unset => shared chain, byte-identical
#   # NB: a consumer name must not reuse a reserved adversarial field name
#   #     (refs / backends / fallbacks / host / provider / timeout / deadline / requires).
```

Because `configSetSelftest`'s namespace-drift check reads the example's top-level keys, the addition stays under the existing `adversarial:` top-level key and adds no new top-level namespace.

### Failure modes

- **The failure:** the per-consumer branch changes emitted output for a config with no sub-block (for example by always constructing a sub-block object, or by reordering the fallthrough). **How you'd know:** the existing `test/adversarial-backends.test.mjs` fixtures, all single flat blocks, start failing, or a `--consumer X` run with no `adversarial.X` sub-block differs from the no-flag run. **What it means:** abandon that approach; the branch must be a pure prefix that only acts on a usable per-consumer refs list.

- **The failure:** the prdr_review consumer name is threaded at the wrong place, so the prdr-yagni challenge silently resolves the `code_review` chain (or the shared chain) instead of `prdr_review`. **How you'd know:** a config with distinct `adversarial.code_review.refs` and `adversarial.prdr_review.refs` sees the prdr-yagni dispatch emit the code_review backends. **What it means:** narrow the change to the actual adversarial-backends invocation inside the prdr-yagni seam; if no such distinct invocation exists, the seam inherits whatever chain its nested review dispatch resolves, and threading prdr_review needs the dispatch to carry the consumer identity. This is the one wiring point the build must verify against the live call topology rather than assume.

- **The failure:** the `config set` regex is too broad and refuses a legitimate scalar (for example `adversarial.spec_review.timeout`) or too narrow and admits a per-consumer refs write. **How you'd know:** `config set adversarial.spec_review.timeout 240` returns exit 2, or `config set adversarial.spec_review.refs '[...]'` succeeds and flattens the list. **What it means:** the predicate must anchor on the trailing `.refs` and the three-segment shape exactly.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a .faffrc with no per-consumer adversarial sub-blocks
When `faff adversarial-backends --consumer spec_review` runs
Then its stdout is byte-identical to `faff adversarial-backends` with no flag
```

```
Given a .faffrc with backends: entries named A and B, and adversarial.spec_review.refs: [B, A]
When `faff adversarial-backends --consumer spec_review` runs
Then the emitted chain is [B, A] resolved from the backends: namespace
And `faff adversarial-backends --consumer code_review` (no code_review sub-block) emits the shared chain unchanged
```

```
Given adversarial.timeout: 120 and adversarial.code_review.timeout: 300
When the code_review call site resolves its timeout
Then it reads 300
And with adversarial.code_review.timeout unset it reads 120 (global), then the caller default 120 when adversarial.timeout is also unset
```

```
Given adversarial.spec_review.refs authored in any of its list forms
When `faff config set adversarial.spec_review.refs '[x, y]'` runs
Then it is refused with exit 2 and the file is byte-unchanged, exactly as `faff config set adversarial.refs` is refused
```

- The `assembleAdversarialBackends` selftest MUST include a case asserting `assembleAdversarialBackends(cfg, "spec_review")` equals `assembleAdversarialBackends(cfg)` when no sub-block exists.
- The change MUST NOT alter any exit code, stderr text, or emitted key in `BACKEND_KEYS` for a config with no per-consumer keys.

## 6. Design decision rationale

**What may a consumer split?** Options: chain + timeout, versus chain + timeout + deadline + requires. Splitting deadline would add behaviour to `spec_review`, which does not read `adversarial.deadline` today, breaching the zero-change-when-unset guarantee. **Chosen:** chain (refs) and timeout only; deadline, requires, and every other field stay global.

**Config shape for the per-consumer chain.** Options: a refs-name list, versus a full per-consumer legacy primary+fallbacks block. A refs list reuses `resolveBackendRefs` and keeps the sub-block to two optional keys; a per-consumer primary block would duplicate the whole legacy assembly per consumer. **Chosen:** `adversarial.<consumer>.refs`, a name list resolved against the merged `backends:`/`engines:` namespace.

**Consumer seam shape.** Options: an allowlist of the three names, versus an open-ended `--consumer <name>`. An allowlist would force a central edit for every future consumer and turn an unconfigured name into an error. **Chosen:** open-ended; any name resolves its sub-block or falls through, and an unrecognised name is not an error.

**Timeout resolution mechanism.** Options: two-read shell fallback at each call site, versus folding a timeout field into `adversarial-backends` output. Folding it in would change the emitted JSON shape and put the byte-identity guarantee at risk; the two-read fallback keeps the CLI change to one flag. **Chosen:** two-read shell fallback (`adversarial.<consumer>.timeout` then `adversarial.timeout -d <default>`).

**`--consumer` fallthrough placement.** Options: a per-key merge of the sub-block over the shared block, versus a clean prefix branch keyed on a usable `adversarial.<consumer>.refs`. A per-key merge would entangle the sub-block with the legacy primary and threaten byte-identity. **Chosen:** a prefix branch that acts only on a non-empty all-string `refs` list and otherwise falls through untouched.

**`config set` carve-out.** Options: enumerate the three named consumers in `SEQUENCE_VALUED_KEYS`, versus a regex predicate alongside the exact set. Enumeration cannot cover an open-ended fourth consumer. **Chosen:** a regex predicate `^adversarial\.[A-Za-z0-9_]+\.refs$` combined with the existing exact set, pinned by a `configSetSelftest` case.

**Residency guard extension.** Options: leave the guard on the shared block, versus iterate per-consumer refs against the global requires. A per-consumer chain leaning on derived `egress: local` is exactly the soundness gap the guard exists to surface. **Chosen:** iterate every `adversarial.<consumer>.refs` against the single global `adversarial.requires`, reusing the existing derived-vs-explicit test.

**prdr_review wiring point.** Options: assume the shared code_review Backend call block also serves prdr-yagni, versus thread the consumer at the prdr-yagni seam's own adversarial-backends invocation. The gateway (Upper-gate arbitration) and the adversarial-review skill show prdr-yagni reaches the engine by dispatching the `review` slot with a proposal, not the diff-shaped block. **Chosen:** thread `--consumer prdr_review` where the prdr-yagni seam resolves its chain, verified against the live call topology; adr-drift stays unnamed.

## 7. Open questions and assumptions

No open questions. All decisions are closed above. The one wiring point that requires verification against the live call topology (where the prdr-yagni seam invokes `faff adversarial-backends`) is a build-time locate-and-thread step covered by the failure mode and the DONE item, not an unresolved design choice.

No external assumptions. The per-consumer chain reuses `resolveBackendRefs` and the merged `backends:`/`engines:` namespace, both already present; the prdr-yagni Phase-2 dispatch is confirmed in `plugin/skills/faff/SKILL.md` (Upper-gate arbitration) and `plugin/skills/faffter-dark-adversarial-review/SKILL.md`.

## 8. DONE — definition of done

### From WHY
- [ ] With no per-consumer keys set, every existing `test/adversarial-backends.test.mjs` case passes unchanged.
- [ ] `faff adversarial-backends --consumer X` with no `adversarial.X` sub-block emits stdout byte-identical to the no-flag call (new test).

### From WHAT (config surface and CLI)
- [ ] `adversarial.<consumer>.refs` (ordered name list) and `adversarial.<consumer>.timeout` (scalar) are recognised optional keys; the root `adversarial.*` fields are unchanged.
- [ ] `faff adversarial-backends` accepts `--consumer NAME` (arity 1); `--json` stays accepted-and-ignored; exit codes 0/3/2 and `BACKEND_KEYS` are unchanged.
- [ ] `assembleAdversarialBackends(cfg)` (single argument) behaves byte-for-byte as before.

### From HOW (resolver fallthrough)
- [ ] A usable `adversarial.<consumer>.refs` (non-empty, all strings) resolves the chain via `resolveBackendRefs` and wins over the shared assembly.
- [ ] An absent flag, absent sub-block, non-object sub-block, or empty/non-string refs falls through to the shared assembly with identical output.
- [ ] A refs resolution error (unknown name or namespace merge error) returns `{ error: "malformed" }` → exit 2, same as the shared refs path.

### From HOW (timeout)
- [ ] Each named call site resolves `adversarial.<consumer>.timeout`, then `adversarial.timeout -d <default>`, then the caller default.
- [ ] `faff config set adversarial.spec_review.timeout 240` succeeds with no config.js namespace change.

### From HOW (call-site wiring)
- [ ] `faffter-dark-spec-review` Backend call block passes `--consumer spec_review` and reads the spec_review timeout.
- [ ] `faffter-dark-adversarial-review` shared Backend call block passes `--consumer code_review` on the refutation-code path, via a `consumer` variable, and reads the code_review timeout; `adversarial.deadline` stays global.
- [ ] The prdr-yagni seam passes `--consumer prdr_review` at its actual adversarial-backends invocation, resolving a distinct chain from code_review when both sub-blocks differ.
- [ ] The adr-drift seam passes no `--consumer` and falls through to the shared chain, byte-identical to today.

### From HOW (config set refusal)
- [ ] `config set adversarial.<consumer>.refs …` is refused (exit 2, file byte-unchanged) for the JSON-string, bare inline-flow, and block-sequence forms, via the regex predicate.
- [ ] The predicate does not match `adversarial.refs` or `adversarial.<consumer>.timeout`; a `configSetSelftest` case pins it.

### From HOW (config check)
- [ ] `faff config check` iterates each `adversarial.<consumer>.refs` against the global `adversarial.requires`, emitting the derived-egress warn finding with surface `adversarial.<consumer>.refs[<name>]`.
- [ ] The `requires` fail-closed enum validation is unchanged and runs once globally.

### From WHAT (documentation)
- [ ] `.faffrc.example.yaml` shows the per-consumer keys under the existing `adversarial:` block, including the reserved-name caution; no new top-level namespace is added.

**Integration smoke test.**

```
Given .faffrc:
  backends: { A: {provider: nvidia, model: m, host: https://a/v1, api_key_env: K},
              B: {provider: ollama, model: q, host: http://localhost:11434} }
  adversarial: { host: http://localhost:11434, model: base, provider: ollama,
                 spec_review: { refs: [A], timeout: 300 } }
When `faff adversarial-backends --consumer spec_review` runs
Then exit 0 and stdout is the single-element chain for backend A
And `faff adversarial-backends --consumer code_review` emits the legacy primary chain (ollama base) unchanged
And `faff adversarial-backends` (no flag) emits that same legacy primary chain
```

If those three calls behave as stated, the resolver branch, the CLI flag, and the fallthrough are connected.

confidence: high
build-tier: complex