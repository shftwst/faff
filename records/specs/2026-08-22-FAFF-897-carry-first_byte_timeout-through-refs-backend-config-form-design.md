# Spec — FAFF-897: carry `first_byte_timeout` through the `refs:` backend-config form

> Spec: faffter-dark-nlspec · 2026-08-22 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-897.
>
> build-tier: standard
>
> spec-review: approve

This is a buildable spec for **FAFF-897**, a High-priority Backlog bug. Audience: the build agent implementing the fix, and the human reviewers gating it. It restores the per-backend first-byte (TTFT) override from FAFF-885 on the `refs:` backend-config form, where it is currently dropped before reaching the reviewer. The change is one field-copy line (plus one symmetric sibling), matched by three test additions.

## 1. WHY — Problem and Principles

**Load-bearing model.** The `refs:` config form resolves a backend name through `normalizeBackend` in `backends.js`, and `normalizeBackend` is a *hand-written, field-by-field allowlist rebuild*: it constructs a fresh record copying only the fields it names explicitly, so any config key it forgets to name is silently dropped at namespace-normalisation time — before the adversarial emitter (`pickBackendKeys`, whose own allowlist already includes the key) ever runs. The bug is a missing line in that rebuild, not a missing feature or a broken consumer.

**Problem statement.** FAFF-885 added a per-backend `first_byte_timeout` override so a slow local backend can raise its TTFT window above the ~60s default, but a backend referenced by name via `adversarial.refs:` loses that key before it reaches the reviewer, which then falls back to the default. For a local backend whose cold prompt-eval alone is ~234s (studio qwen on a ~15K-token review prompt), that default guarantees a first-byte breach on every fresh spec. This change adds `first_byte_timeout` to `normalizeBackend`'s field rebuild so the key rides through the `refs:` namespace the same way `timeout` already does.

**Design principles.**

**Symmetry with `timeout` is the whole design.** `first_byte_timeout` is a sibling of `timeout` in every layer that already handles it correctly (`BACKEND_KEYS`, `pickBackendKeys`, `inheritOptionalFromPrimary`, the review-call mapper). The one place that treats them differently — `normalizeBackend` — is the bug. The fix is to make them symmetric there too, mirroring the existing `timeout` line exactly. Any implementation that coerces, defaults, or validates `first_byte_timeout` differently from `timeout` is out of bounds — that would be new behaviour, not a symmetry repair.

**No consumer change.** The downstream reader (`review-call.mjs`'s `resolveFirstByteMs` + `--backends-json` mapper) already reads `b.first_byte_timeout`. Once the key survives normalisation it is picked up with no further change. Do not touch the consumer.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/backends.js` | Node.js (CJS) | `normalizeBackend` — the sole fix locus; also holds `BACKEND_RECORD_KEYS` (the CLI JSON-output allowlist) |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node.js (CJS) | `BACKEND_KEYS` / `pickBackendKeys` — already carry `first_byte_timeout`; unchanged |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node.js (ESM) | `resolveFirstByteMs` + mapper — already consume `first_byte_timeout`; unchanged |
| `test/backends.test.mjs` | Node `node:test` | `normalizeBackend` / `resolveBackendRefs` coverage + the legacy-vs-refs byte-equivalence test |
| `test/adversarial-backends.test.mjs` | Node `node:test` | refs:→emitter round-trip coverage |

**Scope statement.** This sits at config namespace-normalisation — the point where a named backend record is rebuilt on the `refs:` resolution path, upstream of both the adversarial emitter and the `faff backends resolve` CLI.

## 2. OUT OF SCOPE

- **`review-call.mjs` consumer (`resolveFirstByteMs`, the mapper).** Why excluded: it already reads `b.first_byte_timeout ?? b.firstByteTimeout`; once the key survives normalisation it works unchanged. Extension point: none needed.
- **`BACKEND_KEYS` / `pickBackendKeys` in `adversarial-backends.js`.** Why excluded: `BACKEND_KEYS` already lists `first_byte_timeout` and `pickBackendKeys` copies it; the drop is entirely upstream in `normalizeBackend`. Extension point: none needed.
- **The legacy `primary + fallbacks` form and the inline `adversarial.backends:` array form.** Why excluded: both call `pickBackendKeys` directly on raw YAML and already retain `first_byte_timeout`; only the `refs:` form routes through `normalizeBackend`. This fix restores symmetry with those two forms, not new behaviour. Extension point: none needed.
- **`IDENTITY_KEYS` (`spec-review-pin.js`).** Why excluded: a deliberately narrow 3-field identity pin; TTFT is not identity. Extension point: `spec-review-pin.js` if a future pin ever needs timeout fields.
- **`SECRET_ENV_HANDLE_KEYS` (`redact.js`).** Why excluded: names secret env-handle keys only; `first_byte_timeout` is a plain scalar, not a secret handle. Extension point: n/a.
- **The `engine:` lane (`engine.js`).** Why excluded: the `engine:` lane has no first-byte feature; FAFF-885's scope was `adversarial-backends.js` + `review-call.mjs`. Extension point: `engine.js` if a first-byte window is ever added to the engine lane (separate feature, separate issue).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `first_byte_timeout` | Per-backend first-byte (TTFT) window override, in **seconds**, from FAFF-885. Optional. Consumed by `review-call.mjs`'s `resolveFirstByteMs` (precedence: per-backend > `--first-byte-timeout` flag > default). |
| `refs:` form | The `adversarial.refs: [name, ...]` config shape — an ordered list of backend NAMES resolved against the shared top-level `backends:` namespace via `mergeBackendsNamespace` → `normalizeBackend` → `resolveBackendRefs`. |
| Field rebuild | `normalizeBackend`'s hand-written block that reconstructs a Backend record field-by-field from raw config (`b.<field> = present(raw.<field>) ? <coerce>(raw.<field>) : undefined`), acting as an implicit allowlist. |

**The `normalizeBackend` field rebuild — target shape.** The existing `timeout` line is the exact template; the new line mirrors it (same `present(...) ? Number(...) : undefined` coercion, same placement — immediately after `timeout`):

```
# in normalizeBackend's field rebuild (backends.js), AFTER the existing timeout line:
b.timeout            = present(raw.timeout) ? Number(raw.timeout) : undefined            # existing
b.first_byte_timeout = present(raw.first_byte_timeout) ? Number(raw.first_byte_timeout) : undefined   # NEW — mirrors timeout exactly
```

**`BACKEND_RECORD_KEYS` — the second, symmetric addition.** `BACKEND_RECORD_KEYS` (`backends.js`) is a parallel allowlist feeding the `faff backends resolve` CLI's JSON-output filter; it currently omits `first_byte_timeout`. It is NOT required to fix the reported refs:-drop bug — the adversarial emitter reads `BACKEND_KEYS` in `adversarial-backends.js`, not `BACKEND_RECORD_KEYS`. Adding it keeps `faff backends resolve` output symmetric with the in-memory record (a resolved backend that carries `first_byte_timeout` on the object should show it in the CLI JSON too).

**Decision — include `BACKEND_RECORD_KEYS` in scope?** Options: (a) fix only `normalizeBackend`, leaving `faff backends resolve` JSON output asymmetric with the record; (b) also add `first_byte_timeout` to `BACKEND_RECORD_KEYS` — a small, same-file, side-effect-free allowlist entry that restores CLI-output symmetry. Option (a) is the minimum bug fix but leaves an observable inconsistency in the resolve CLI. Option (b) is one extra list element in the same file with no behavioural risk. **Chosen:** (b) — add `first_byte_timeout` to both `normalizeBackend` and `BACKEND_RECORD_KEYS`, as an explicit, in-scope symmetry restoration. (decides: architecture)

## 4. HOW — Behavior

**Approach.** Two edits, both in `backends.js`, no consumer or emitter change.

```
PROCEDURE fix_refs_first_byte_drop:
  1. In normalizeBackend's field rebuild:
     a. Locate the existing `b.timeout = present(raw.timeout) ? Number(raw.timeout) : undefined;` line.
     b. Insert immediately after it:
        `b.first_byte_timeout = present(raw.first_byte_timeout) ? Number(raw.first_byte_timeout) : undefined;`
  2. In BACKEND_RECORD_KEYS:
     a. Add the string "first_byte_timeout" to the array (adjacent to "timeout" for readability).
  3. No other file changes. The refs: resolution path (mergeBackendsNamespace -> normalizeBackend ->
     resolveBackendRefs) now carries first_byte_timeout into the record; pickBackendKeys (already
     listing it) copies it into the emitted chain; review-call.mjs's mapper (already reading it)
     applies it as the first-byte window.
```

**Coercion note.** `first_byte_timeout` is expressed in seconds in config, same as `timeout`; `review-call.mjs` multiplies by 1000 to derive `firstByteMs`. `normalizeBackend` stores the numeric seconds value via `Number(...)`, exactly as it does for `timeout` — no unit conversion happens at normalisation.

**Edge cases (all inherited from the `timeout` line's behaviour — no new logic).**
- Absent / `null` / `""` `first_byte_timeout` → `present()` is false → field is `undefined` → `pickBackendKeys`' own `present()` gate omits it → the chain emits byte-identically to today (no first-byte override). This preserves refs↔legacy byte-equivalence for backends that set no override.
- `first_byte_timeout: 0` → `present(0)` is true (0 is not `null`/`undefined`/`""`) → carried as `0`; `resolveFirstByteMs` already treats `<= 0` as the explicit pass-through opt-out (FAFF-885). No new handling needed here.
- Non-numeric value → `Number(...)` yields `NaN`, mirroring the existing `timeout` line's behaviour exactly; validating/rejecting it is out of scope (symmetry principle — `timeout` does not validate either).

**Anti-pattern:** adding `first_byte_timeout` validation, clamping, or a default inside `normalizeBackend`. Why: `timeout` has none; introducing asymmetric handling is new behaviour beyond the reported bug and breaks the symmetry principle.

**Anti-pattern:** touching `review-call.mjs`, `BACKEND_KEYS`, or `pickBackendKeys`. Why: they already handle the key correctly; the drop is solely upstream in `normalizeBackend`.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a top-level `backends:` entry that sets `first_byte_timeout` and is referenced by name via `adversarial.refs:`
When the adversarial backend chain is assembled (mergeBackendsNamespace -> normalizeBackend -> resolveBackendRefs -> pickBackendKeys)
Then the emitted refs-resolved backend carries `first_byte_timeout` with the configured value (not dropped, not defaulted)
```

```
Given a named `backends:` entry that sets `first_byte_timeout`
When `normalizeBackend` rebuilds that record
Then the returned backend object has `first_byte_timeout` equal to the configured numeric (seconds) value
```

## 6. Design Decision Rationale

**Where is the single fix locus for the reported drop?** Options: `normalizeBackend` (the field rebuild), `pickBackendKeys` (the emitter allowlist), or the consumer. Exploration established the emitter allowlist (`BACKEND_KEYS`) and the consumer already handle `first_byte_timeout`; the record is stripped earlier, at `normalizeBackend`'s rebuild, before either runs. **Chosen:** `normalizeBackend` — add the mirrored `first_byte_timeout` line right after the `timeout` line. Rationale: it is the sole point on the `refs:` path where the key is lost, and mirroring `timeout` restores symmetry with the two config forms that already retain it. Rejected alternatives: touching the emitter or consumer would be no-ops (they already work) and would not fix the drop.

**Include the `BACKEND_RECORD_KEYS` sibling addition?** Covered in §3 — **Chosen:** yes, add it too for CLI-output symmetry; a one-element, same-file, side-effect-free change that is not strictly required for the refs: bug but keeps `faff backends resolve` JSON consistent with the record.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.** None requiring external validation — every claim (allowlist contents, consumer behaviour, the test coverage gap) was verified against the code during exploration.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `backends:` entry with `first_byte_timeout`, referenced via `adversarial.refs:`, retains that value all the way to the emitted chain (no fallback to the ~60s default for the refs: form).

### From WHAT / HOW (the fix)
- [ ] `normalizeBackend` in `plugin/skills/faff/bin/lib/backends.js` has a `first_byte_timeout` line immediately after the `timeout` line, of the exact shape `b.first_byte_timeout = present(raw.first_byte_timeout) ? Number(raw.first_byte_timeout) : undefined;`.
- [ ] `BACKEND_RECORD_KEYS` in the same file includes `"first_byte_timeout"`.
- [ ] No change to `review-call.mjs`, `BACKEND_KEYS`, or `pickBackendKeys`.

### From HOW (edge cases — symmetry preserved)
- [ ] A `backends:` entry with no `first_byte_timeout` still normalises with `first_byte_timeout` undefined and emits a chain byte-identical to today (no spurious key).

### Tests (Node `node:test`; runner `node --import ./test/hermetic-env.mjs --test test/`, and bare `node --test test/` on a clean checkout)
- [ ] `test/backends.test.mjs`: a new `normalizeBackend` unit test asserts a raw record with `first_byte_timeout: <N>` produces a normalized backend whose `first_byte_timeout === <N>` (template: the existing "telemetry derives per family and is carried on the normalized record" carry test near line 481).
- [ ] `test/backends.test.mjs`: the legacy-vs-refs byte-equivalence integration test (near line 383, `"integration: adversarial refs: resolves against backends:, byte-equivalent to the legacy chain ..."`) is extended so both the legacy block and the restated `refs:` `backends:` entries carry `first_byte_timeout`, and the `assert.deepEqual(migrated.chain, legacy.chain)` still passes with the field present on the corresponding backend — closing the coverage gap that let this bug ship.
- [ ] `test/adversarial-backends.test.mjs`: a refs:→`assembleAdversarialBackends` test asserts the emitted refs-resolved backend carries `first_byte_timeout` (template: the refs: resolution tests near lines 311-354 and the round-trip mapper test near line 227 that asserts `reasoning_effort` is among the emitted keys).
- [ ] Full suite passes: `node --import ./test/hermetic-env.mjs --test test/`.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Config: backends: { slow-local: { provider: ollama, model: q, host: http://studio.x.ts.net:11434, first_byte_timeout: 300 } }
             adversarial: { refs: ["slow-local"] }
  2. chain = assembleAdversarialBackends(cfg)
  3. ASSERT chain.chain[0].first_byte_timeout === 300   # survives refs: namespace normalisation
  # (Optional, mirroring the existing integration smoke) feed the emitted JSON to review-call.mjs's
  #  --backends-json with a stubbed runReviewFn and ASSERT captured[0].firstByteMs === 300000.
```

## Design Decision Rationale — marker recap

Two non-trivial decisions, both closed:
1. Fix locus = `normalizeBackend` (mirror the `timeout` line). **Chosen.**
2. Also add `first_byte_timeout` to `BACKEND_RECORD_KEYS` for CLI-output symmetry. **Chosen.**

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (agile-delivery). Advisory — does not gate this high-confidence spec; surfaced for the next `/faff-wtf`._

**Right-sized? (principle 4) — No issues.** 2 lines of production code + 3 targeted tests in one file is a sub-day unit, comfortably inside the 1-3 day band. The symmetric sibling addition (`first_byte_timeout` to `BACKEND_RECORD_KEYS`) is not a split candidate — it's the same key in the same file for `faff backends resolve` output symmetry, an always-ships-together pair correctly kept in one ticket. No split, no merge.

**Workstream fit? (principles 1 + 5) — No issues.** A single-outcome bug (a dropped key on one config form), project-less in Backlog — the correct default landing for a captured bug. One cohesive concern, nothing to regroup.

**Deps surfaced? (principle 6) — One thing to check.**
- The fix relies on FAFF-885's feature work (Done), so that prerequisite is satisfied — no missing blocker.
- FAFF-898 is open and carries only a loose "related" relation, no blocker link. "Related" is not machine-readable sequencing: if FAFF-898 touches the same `normalizeBackend` / `BACKEND_RECORD_KEYS` surface or depends on this key surviving, an implicit dep is unencoded, inviting a silent same-file merge collision.
- What to do: confirm the FAFF-897 ↔ FAFF-898 relationship. If one needs the other's output, promote "related" to an explicit `blockedBy`/`blocks` edge; if merely thematically adjacent, leave it. (Left unencoded by this autonomous pass — the relationship is not confirmed, so no topology edit was made.)

**Risk profile? (principle 7) — No issues.** A two-line mirror of the existing `timeout` line, no new dependencies, no architecture/schema/API/runtime change, high confidence, with unit + byte-equivalence + round-trip tests included. Zero novel-integration or external-dep surface — no de-risking spike warranted.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
