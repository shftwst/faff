# FAFF-619 — Genericise the private tailnet host in deriveEgress test fixtures + backends.js

> Spec: faffter-dark-nlspec · 2026-08-03 · autonomous · confidence: high. Full spec on Linear FAFF-619.

This spec addresses **FAFF-619**. Its audience is the build agent doing the substitution and the human reviewer gating it. The work is a pure string-literal swap across four tracked files; no production logic changes.

## 1. WHY — Problem and Principles

The load-bearing fact: `deriveEgress` classifies a host as `local` purely from its hostname **suffix** — any hostname ending in `.ts.net` is local by policy (`backends.js:91`), because `ts.net` is Tailscale's non-publicly-registrable MagicDNS suffix. The subdomain label in front of it (`studio.longhair-escalator`) is decorative to the check. That is why we can rename it freely without moving a single assertion.

**Problem statement:** the operator-private host `studio.longhair-escalator.ts.net:11434` is still baked into tracked test fixtures and one self-test string in `backends.js`, so `git grep longhair-escalator` still returns live hits outside the frozen design records. This change swaps those literals for a generic `*.ts.net` placeholder that keeps the exact same suffix-detection behaviour while carrying no operator-private tailnet name.

**Design principles:**

**The `.ts.net` suffix is the only load-bearing part of the fixture — preserve it exactly.** The placeholder must keep a hostname whose suffix is `.ts.net` (case-insensitive), or the `deriveEgress -> local` and `checkRealizable requires:local` assertions flip. An implementation that swaps to a non-`.ts.net` host (e.g. a plain `localhost` or a public domain) is wrong even though the string no longer leaks a name.

**Reuse the placeholder the house already uses — do not invent a new spelling.** The whole point of the ticket is hygiene and consistency; a novel placeholder fragments the convention. The generic tailnet host already has an established in-code test spelling — `studio.x.ts.net` — used ~20 times across the exact files this ticket edits (`backends.js`'s selftest block and `backends.test.mjs`). Adopting it keeps the edited lines identical in shape to their immediate neighbours.

**Each test must use one consistent literal on both its input and its assertion side.** In `eval-cli-driver` and `eval-ollama-model` the host is not detection input — it is echoed straight back into the asserted `req.url` / `baseUrl` / `--base-url` value. If the input literal and the assertion literal drift apart, the test breaks.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/backends.js` | JavaScript | Holds `deriveEgress` (line 74) and its self-test (line 488); the selftest block already uses `studio.x.ts.net` for other generic tailnet hosts |
| `test/backends.test.mjs` | JS (node:test) | `deriveEgress` and `checkRealizable requires:local` tailnet assertions (lines 42, 131); uses `studio.x.ts.net` throughout for generic hosts |
| `test/eval-cli-driver.test.mjs` | JS (node:test) | `buildInvocation` / `resolveLocalParams` base-URL fixtures (lines 15, 95, 96) |
| `test/eval-ollama-model.test.mjs` | JS (node:test) | `buildOllamaRequest` base-URL fixture + `req.url` assertion (lines 19, 21) |

**Scope statement:** this is the final info-leak-hygiene pass that FAFF-587 deliberately left out of scope; it clears the last non-frozen surface where the operator-private tailnet name appears in tracked code.

## 2. OUT OF SCOPE

- **The frozen design records under `docs/specs/*.md`.** Excluded: they are historical records of decisions made at a point in time and are deliberately exempted by the acceptance criterion — the name appears there as a factual account of the operator's setup at the time of writing. These are append-only history, not live fixtures.
- **`deriveEgress` itself and its policy.** Excluded: the `.ts.net`-suffix classification is correct and unchanged; this ticket only renames the fixture that exercises it. Extension point: `backends.js:74` if the egress policy ever changes — a separate concern.
- **Any real-host configuration (`.faffrc`, eval presets, runtime backend records).** Excluded: those carry live operator config, not test fixtures; genericising a real host would break the actual local-model eval.

## 3. WHAT — Vocabulary and the substitution

**Vocabulary:**

| Term | Definition |
|---|---|
| Placeholder host | The generic tailnet hostname replacing the private one; keeps a `.ts.net` suffix, carries no operator-private label |
| Detection fixture | A fixture whose value is fed to `deriveEgress` and whose classification (`local`) the assertion checks — the `.ts.net` suffix is load-bearing |
| Echo fixture | A fixture used only as a base URL that the code copies into an output field the test then asserts — any consistent value works |

**The placeholder.** Replace `studio.longhair-escalator.ts.net` with `studio.x.ts.net` everywhere it appears in the four target files, preserving the surrounding `http://` scheme and `:11434` port exactly. Full literal: `http://studio.x.ts.net:11434`.

**Design decision — which placeholder label:**

The repo already carries two generic-tailnet spellings: `studio.x.ts.net` (used ~20 times across `backends.js`'s selftest block and `backends.test.mjs` — the in-code test convention) and `studio.example.ts.net` (used in the operator-facing `.faffrc.example.yaml`). Both preserve the `.ts.net` suffix and so behave identically under `deriveEgress`. All seven edit sites are test / selftest code — not operator-facing config — and the two files that hold five of the seven sites already use `studio.x.ts.net` for exactly this purpose, so matching it makes the edited lines indistinguishable in shape from their neighbours and introduces no third spelling.

**Chosen:** `studio.x.ts.net` — the established in-code test placeholder, already used across the two files that dominate the edit set (`backends.js`, `backends.test.mjs`); preserves the load-bearing `.ts.net` suffix and carries no operator-private token. *(decides: any)*

## 4. HOW — Behavior

**Approach.** A find-and-replace of the exact literal `studio.longhair-escalator.ts.net` → `studio.x.ts.net`, scoped to the four target files only. Every occurrence is inside a string literal; no code structure moves. Seven occurrences total, at the lines named in the reference table. Where a test binds the host to a reused variable (`eval-cli-driver.test.mjs:15`), replacing the single declaration covers every downstream use of that variable; where the literal is repeated inline (`eval-cli-driver.test.mjs:95` and `:96`; `eval-ollama-model.test.mjs:19` and `:21`), each occurrence is replaced so input and assertion stay identical.

```
PROCEDURE genericise_tailnet_host:
  1. For each of the 4 target files:
     a. Replace every literal "studio.longhair-escalator.ts.net"
        with "studio.x.ts.net", leaving scheme + ":11434" port intact.
  2. Do NOT touch any file under docs/specs/.
  3. Run the test suite; the deriveEgress / checkRealizable / eval-driver /
     ollama-model assertions MUST still pass unchanged.
  4. Run `git grep longhair-escalator`; expect hits ONLY under docs/specs/*.md.
```

**Anti-pattern:** widening the replacement to `git grep -l` across the whole tree and rewriting `docs/specs/*.md` too. Why: the acceptance criterion explicitly exempts the frozen design records; rewriting them corrupts historical accounts and fails review.

**Anti-pattern:** substituting a non-`.ts.net` host (e.g. `localhost` or a public domain) to "be safe". Why: it flips the `deriveEgress -> local` classification and breaks the tailnet-detection assertions the ticket requires to keep passing.

**Anti-pattern:** introducing a new placeholder spelling (`host.example.ts.net`, etc.). Why: it adds a third spelling for one concept and fragments the house convention the ticket exists to tidy.

## 5. Scenarios

```
Given the deriveEgress fixture now reads "http://studio.x.ts.net:11434"
When deriveEgress classifies that host
Then it returns "local" (the .ts.net suffix rule still fires)
```

```
Given the checkRealizable requires:local egress-derivation test using the placeholder host
When the suite runs after the substitution
Then the assertion at test/backends.test.mjs:131 still passes with the .ts.net host classified local
```

- The repo-wide check `git grep longhair-escalator` MUST return zero hits in any tracked path outside `docs/specs/*.md`.

## 6. Open Questions and Assumptions

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the seven occurrences listed in the reference table are the complete set of non-frozen-docs hits **among tracked files**. Validation: run `git grep -n "longhair-escalator" -- ':!docs/specs/*.md'` before starting; expect exactly those seven lines. If more appear, widen the substitution to cover them (still excluding `docs/specs/`). Note: `git grep` searches tracked files only — the acceptance criterion's "returns only docs/specs paths" is scoped to tracked files (an untracked path such as `docs/external-verification/faff-labs/` is out of this ticket's declared scope, which was FAFF-618's for scaffolders).

## 7. DONE — Definition of Done

### From WHY
- [ ] No tracked file outside `docs/specs/*.md` contains the literal `longhair-escalator` (verified by `git grep longhair-escalator` returning only `docs/specs/*.md` paths).

### From WHAT
- [ ] Every replaced literal is exactly `http://studio.x.ts.net:11434` (scheme and `:11434` port preserved).
- [ ] No file under `docs/specs/` is modified.

### From HOW (behaviour)
- [ ] `deriveEgress({ host: "http://studio.x.ts.net:11434" })` returns `"local"` (`test/backends.test.mjs:42`).
- [ ] The `checkRealizable requires:local` egress-derivation assertion passes with the placeholder host (`test/backends.test.mjs:131`).
- [ ] The `backends.js` self-test line asserting `deriveEgress(...) === "local"` passes with the placeholder host (`backends.js:488`).
- [ ] `eval-cli-driver` `buildInvocation` and `resolveLocalParams` assertions pass with input and expected base URL both using the placeholder (`test/eval-cli-driver.test.mjs:15,95,96`).
- [ ] `eval-ollama-model` `buildOllamaRequest` produces `req.url === "http://studio.x.ts.net:11434/api/chat"` (`test/eval-ollama-model.test.mjs:19,21`).

### From HOW (full suite)
- [ ] The full test suite passes with no assertion changes beyond the host literal.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Run the test suite (the project's node:test runner over test/*.mjs)
     and the backends.js self-test.
  2. Expect: all green, no assertion edited except the host literal.
  3. Run `git grep longhair-escalator`.
  4. Expect: hits only under docs/specs/*.md.
  If both hold, the substitution is complete and detection behaviour is intact.
```

confidence: high
spec-review: approve
