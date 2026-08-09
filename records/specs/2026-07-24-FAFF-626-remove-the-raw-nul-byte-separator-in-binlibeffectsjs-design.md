# Restore grep visibility of effects.js — escape the raw NUL separator, guard the class

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-626.

This spec covers FAFF-626, item A carved out of FAFF-579's CLI-hygiene bundle by human split decision (2026-07-23): a correctness/reviewability defect shipped standalone so it isn't held behind the bundle's design debates. It is written for the build agent and human reviewers. All claims verified against current `main`.

*(Writing note: this document spells the JavaScript NUL hex escape descriptively as "backslash-x-00" — a backslash, the letter x, two zeros, i.e. the standard two-zero hex escape for character 0x00 — because the tracker's edge firewall rejects the literal four-character sequence. In source code the build agent writes the real escape, never the words.)*

## 1. WHY — Problem and Principles

**The load-bearing idea:** grep (and most text tooling) classifies any file containing a NUL byte as binary and refuses line output — so a single raw 0x00 byte in a source file silently removes that whole module from plain-text search. The fix is to express the same byte as a source-level escape (backslash-x-00), which produces the **identical runtime string** while keeping the source file pure text.

**Problem statement.** `plugin/skills/faff/bin/lib/effects.js:64` embeds exactly one literal 0x00 byte as the map-key separator in the template joining `e.issue` and `e.step` (byte-verified during prep; `cat -v` renders it `^@`). grep therefore treats the module as binary — searching `bin/` for `computeEscapes` returns nothing from the file that defines it, silently defeating the greppability/reviewability that ADR-0052 bought. This change rewrites the byte as the backslash-x-00 escape and adds a regression guard so the class of defect (any raw control byte in the CLI's source tree), not just this instance, stays fixed.

**Design principles.**

- **Behavior-identical or nothing.** The separator is a Map-key implementation detail; the fix must not change any runtime string, output, or ledger byte. Anything beyond the escape swap (renaming, refactoring the key scheme) is out of scope.
- **Guard the class, not the instance.** A test that only checks effects.js line 64 rots the moment code moves. The guard scans every source file under the CLI's `bin/` tree for raw control bytes, so a future paste-a-weird-byte accident anywhere in the tree fails CI with a named file.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | JS (CommonJS) | Holds the raw NUL at line 64, inside `computeEscapes`. The one-character fix site. |
| `test/*.test.mjs` (e.g. `test/lint-refs.test.mjs`) | JS (ESM, `node:test`) | House test conventions: `node --test` in CI, repo root resolved from `import.meta.url`. The model for the new guard test. |
| `.github/workflows/validate.yml` | YAML | Runs `node --test` — the new guard file is picked up with zero wiring. |

**Scope statement.** A one-character source fix inside the governance region's effects module, plus one new test file; no behavior, contract, or gate changes.

## 2. OUT OF SCOPE

- **The other FAFF-579 bundle items.** — Dead exports, entrypoint-doc restructure, price-table staleness (items C/D/E) stay on FAFF-579; the `process.exit(2)` in `readGovernanceConfig` is FAFF-627. *Why excluded:* the human split decision exists precisely so this fix ships alone. *Extension point:* those tickets.
- **Scanning source trees beyond the CLI's `bin/`.** — Skill prose, docs, tests, eval fixtures. *Why excluded:* the defect class is "the CLI source went grep-invisible"; other trees have different content rules (fixtures may legitimately hold binary bytes). *Extension point:* widen the scan roots in the new guard test if ever wanted.
- **A `.gitattributes` / editor-level defense.** — *Why excluded:* it changes how tools *display* the file, not whether the byte exists; the test guards the actual invariant. *Extension point:* repo root `.gitattributes`.

## 3. WHAT

### The fix

`plugin/skills/faff/bin/lib/effects.js:64`, inside `computeEscapes`: the template string that builds the per-(issue, step) Map key currently joins `e.issue` and `e.step` with a literal raw 0x00 byte; after the fix it joins them with the two-character backslash-x-00 escape.

**Design decision — is the escape swap safe?** Verified during prep: the joined key exists only as an in-memory `Map` key inside `computeEscapes`. The group values carry `issue` and `step` as separate fields; the emitted `EscapeSignal` objects use `g.issue`/`g.step`, never the key; nothing serializes the separator (the `declared-effects.jsonl` ledger stores per-entry `issue`/`step` fields, not joined keys). A raw byte and the source escape denote the same one-character string at runtime.

**Chosen:** swap the raw byte for the backslash-x-00 escape, changing nothing else on the line. — *Rationale:* byte-identical runtime semantics with zero blast radius; any alternative separator scheme (e.g. a printable sentinel) would be a gratuitous behavior change needing collision analysis that the escape swap makes unnecessary.

### The regression guard

A new test file `test/source-control-bytes.test.mjs` (house conventions: `node:test`, `assert/strict`, repo root from `import.meta.url`) asserting **no source file under `plugin/skills/faff/bin/` (the `faff` entrypoint plus everything under `lib/`, recursively) contains a raw control byte**.

**Design decision — which bytes count as "raw control bytes"?**

**Chosen:** forbid the C0 control range minus legitimate whitespace — bytes `0x00–0x08`, `0x0B`, `0x0C`, `0x0E–0x1F` — allowing tab (`0x09`), LF (`0x0A`), and CR (`0x0D`). — *Rationale:* NUL is what trips grep's binary heuristic, but any bare C0 byte in JS source is an accident; tab/LF/CR are ordinary text. DEL (`0x7F`) and non-UTF-8 sequences are left alone — out of the defect class, and forbidding them risks false positives with no observed benefit. Prep's census: after the fix, zero files under `bin/` contain a forbidden byte, so the guard passes the real tree immediately.

**Design decision — how does the test prove the guard itself works?**

**Chosen:** structure the check as a small pure helper inside the test file (`findControlBytes(buffer)` returning `[{offset, byte}]` or similar) used twice — (a) against every real file under `bin/` (must find nothing, failure message names file + offset + byte), and (b) against an in-memory/temp-dir synthetic input containing a planted 0x00 byte, which must be flagged. — *Rationale:* without (b), a broken scanner that never finds anything passes forever; the synthetic case is the guard's own smoke test, mirroring how `lint-refs.test.mjs` exercises its lint against a throwaway tree.

## 4. HOW — Behavior

Mechanical. The only procedure worth pinning is the scan:

```
PROCEDURE assert_no_control_bytes(root):
  1. files = every regular file under root, recursively (follow the real tree; no extension filter — the entrypoint has none)
  2. FOR each file: read raw bytes; collect offsets of bytes in {0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F}
  3. IF any collected: fail with "<file>: raw control byte 0x<hex> at offset <n>" per finding
  4. ELSE pass
```

Edge cases: an empty file passes; the scan reads bytes (a `Buffer`), never a decoded string, so encoding can't mask a byte. No allowlist mechanism — if a future file legitimately needs a control byte (none does today), the test is the place that decision gets forced into the open.

## Scenarios

```
Given effects.js after the fix
When `grep -n computeEscapes plugin/skills/faff/bin/lib/effects.js` runs
Then grep prints matching lines with line numbers (text classification, not binary-file suppression)
```

```
Given the fixed source tree
When `node --test test/source-control-bytes.test.mjs` runs
Then the scan over plugin/skills/faff/bin/ reports zero forbidden bytes and the test passes
And the synthetic planted-NUL case is detected (the guard proves it can catch the defect)
```

- The existing `test/effects.test.mjs` suite passes unchanged — the escape swap is behavior-identical, so no assertion moves.

## 6. DESIGN DECISION RATIONALE

**Escape swap vs. printable separator?** (a) the backslash-x-00 escape — identical runtime string, zero blast radius; (b) a printable sentinel such as a double-colon — changes the key scheme, needs collision reasoning against issue/step values. **Chosen:** (a). The separator's only job is Map-key uniqueness already served by NUL; there is nothing to improve, only to make visible in source.

**Guard as a test vs. a lint subcommand?** (a) a plain `node:test` file — zero wiring, runs in the existing `node --test` CI step; (b) a new `faff lint-*` subcommand — heavier, adds CLI surface for a check with no runtime consumer. **Chosen:** (a). The repo's `faff lint-*` commands exist where the check is also a user-facing CLI feature; this guard is CI-only.

**Byte set: NUL-only vs. C0-minus-whitespace?** (a) forbid only 0x00 — narrowest, misses sibling accidents (0x01–0x08 etc. are equally alien in JS source and some also trip binary heuristics); (b) C0 minus tab/LF/CR. **Chosen:** (b) — guards the class at no false-positive cost (census: the fixed tree is clean).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** CI's `node --test` invocation auto-discovers `test/*.test.mjs` files. *Validate:* `.github/workflows/validate.yml:245` runs bare `node --test`, which discovers `test/**/*.test.mjs` by Node's default glob — confirmed on current main (132 sibling test files ride it).

## 8. DONE — Definition of Done

### From WHY
- [ ] `grep -n computeEscapes plugin/skills/faff/bin/lib/effects.js` prints matching lines (the module is text to grep again).

### From WHAT (the fix)
- [ ] The separator at `effects.js:64` is the two-character backslash-x-00 source escape, not a raw byte; a byte-level scan finds zero NUL bytes in the file.
- [ ] No other character on the line, and no other line in the file, changed.

### From WHAT (the guard)
- [ ] `test/source-control-bytes.test.mjs` exists, scans `plugin/skills/faff/bin/` recursively, and forbids bytes 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F while allowing tab/LF/CR.
- [ ] The failure message names file, offset, and byte value.
- [ ] A synthetic planted-NUL input is detected by the same helper (the guard's own smoke test).

### Whole change
- [ ] `node --test` passes across the suite, including `test/effects.test.mjs` unchanged.

**Integration smoke test:**

```
1. node --test test/source-control-bytes.test.mjs → pass (real tree clean, synthetic case caught).
2. node --test test/effects.test.mjs → pass, zero assertion edits.
3. grep -rn computeEscapes plugin/skills/faff/bin/ → hits in effects.js with line numbers.
```

## Already shipped against this surface

Related Done work, none superseding: FAFF-106 built the effects ledger (`computeEscapes` and the separator originate there), FAFF-352/FAFF-383 wired its consumers, FAFF-359 moved the module in the governance carve. The raw byte is verified present on current main; no Done ticket removed it.

## Methodology critique

*(agile-delivery lens — issue-critique)*

- **Right-sized?** Yes — a single sub-day unit: one character plus one small test file. The instance-fix and its class-guard always ship together (the guard is the fix's regression test); splitting them would create an always-ships-together sibling pair, which principle 4 folds back into one unit.
- **Workstream fit / cohesive?** Yes — one outcome: the CLI source tree is fully plain-text-searchable, and stays that way. Item A of the FAFF-579 split, shipped standalone exactly as the human's split decision sequenced it.
- **Deps surfaced?** None hidden. Independent of FAFF-579 (C/D/E: budget/resume/stage/`bin/faff`) and FAFF-627 (`budget.js`); the only adjacency is the guard *reading* `bin/faff`, which no open ticket makes control-byte-dirty. No blocker links needed.
- **Risk profile?** Minimal — behavior-identical by construction (the separator never leaves process memory, verified), guarded by the existing effects suite plus the new test. No spike needed.

confidence: high
spec-review: approve (single-pass — architectural / infosec / QA; no objections; 2026-07-23, autonomous)
