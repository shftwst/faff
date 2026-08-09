# Spec — FAFF-96: Contract-conformance golden tests — extend the 4 contract selftests

> Spec by faffter-dark-nlspec · adaptor faffidavit-spec · 2026-06-11 · autonomous · confidence: high.

Golden-output assertions for the four `faff contract <name>` scripts: pin known input → exact structured output under `node:test`, catching conformance drift the loosely-authored inline `--selftest` may pass. Per ADR 0002.

## 1. WHY
The four contract scripts self-test via inline fixtures, but a refactor could change an output shape and still pass a loose inline check. Golden tests pin input → exact output, so drift fails loud.

## 2. OUT OF SCOPE
- Replacing the inline `--selftest` fixtures (they stay; goldens are the external corpus on top).
- Mock-tracker / skill-level tests (FAFF-89/93). Rendering-adaptor routing assertion (FAFF-97).

## 3. WHAT
- **Chosen:** committed golden manifest `test/golden/contracts/cases.json` (diffable, reviewable, regenerable) — 8 cases, ≥1 valid + ≥1 boundary per contract.
- **Chosen:** invoke `faff contract <name>` as a child process feeding the input, deep-equal parsed stdout to the golden (and assert exit code; fail-loud cases assert exit 2 + stderr `fail-loud`).
- **Chosen:** coverage bar = valid (exit 0) + boundary (coercion exit 1, or fail-loud exit 2) per contract.

## 4. HOW
`test/contract-golden.test.mjs` reads `cases.json`, runs each contract, `assert.deepEqual(JSON.parse(stdout), golden)` for cases with `expectStdout`, asserts exit code always, asserts stderr substring for fail-loud cases. A genuine output change updates the golden in the same PR (the diff is the review surface). **Anti-pattern:** substring assertions — exactly the looseness goldens remove.

## 7. DONE
- [x] `test/golden/contracts/cases.json` holds 8 golden cases (valid + boundary per the 4 contracts).
- [x] `test/contract-golden.test.mjs` deep-equals each contract's parsed output against its golden + asserts exit code (+ stderr for fail-loud).
- [x] An intentional output change is caught (the committed golden no longer matches → fail).
- [x] `node --test` runs green; assertions are deep-equality on parsed structure, not substrings.

confidence: high
