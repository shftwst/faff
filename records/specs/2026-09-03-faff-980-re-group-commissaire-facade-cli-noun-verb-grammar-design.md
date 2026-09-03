# FAFF-980 — Commissaire facade CLI re-grouped to the ADR-0123 noun-verb object grammar

> Spec: faffter-dark-nlspec · 2026-09-02 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-980.

The Commissaire facade CLI presents seven flat verb subcommands under `faff commissaire`. This spec re-groups that surface to the ADR-0123 noun-verb object grammar (`commissaire <object> <action>`) over the governed objects contract, effect, verdict, and audit, keeping the seven flat verbs as compatibility aliases. It is written for the build agent implementing FAFF-980 and the reviewers checking it. The change lives entirely in the surface and dispatch layer of `plugin/skills/faff/bin/lib/commissaire.js` and the declared grammar in `cli-surface.js`; no pure core, handler internal, or record kind is touched.

## 1. WHY — Problem and Principles

**The load-bearing model.** The Commissaire facade has no object types. It is a flat `switch(verb)` in `cmdCommissaire` over seven single-token verbs, each routing to a handler function, plus a declared grammar (`COMMISSAIRE_SURFACE.subcommands`) that names the required flags per verb. "Adopting the object grammar" means one thing only: give each verb a two-token spelling (`contract admit` instead of `admit`) that resolves to the exact same handler, and keep the old single-token spelling working as an alias. Nothing about the handlers, the record ledger, or the split-key cores changes.

**Problem statement.** FAFF-828 shipped the facade as seven flat verbs with no object grouping, so operations on the same governed object do not sit together and the surface stops teaching the object model the design is built on (ADR-0123). FAFF-977 adds the first object-grammar operation (`audit verify`) under a new `audit` namespace. This ticket re-groups the remaining six operations so the whole surface is consistent, with the flat verbs retained as aliases through the compatibility window.

**Design principles.**

**Grammar-first, not a rewrite.** The objects are CLI namespaces layered over the existing handlers. If an implementation moves handler logic, changes a pure core (`evaluateDecisionRequest`, `chokepointPermit`, `verifyAuthLeg`, `computeEscapes`), or alters a record kind, it is wrong regardless of whether tests pass. The re-grouping is confined to the dispatch resolution and the declared surface.

**One handler per operation, reached by two names.** A flat verb and its object-verb form must resolve to the same handler function. An alias is a second spelling, never a second implementation. The clean way to guarantee this is a single canonical dispatch table plus an alias-to-canonical name map, so an alias can only ever point at a canonical entry, not carry its own body.

**The selftests are the guard, not an afterthought.** Two selftests pin this surface: `faff commissaire --selftest` (the round-trip chain) and `faff cli-surface --selftest` (the grammar bijection). Both are green at baseline and must stay green. The design is shaped so they stay green by construction, and the round-trip is extended to exercise both spellings.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript | The facade CLI: `cmdCommissaire` dispatch, the seven handlers, `COMMISSAIRE_SURFACE`/`COMMISSAIRE_SPEC`, and `commissaireSelftest` |
| `plugin/skills/faff/bin/lib/cli-surface.js` | JavaScript | Assembles `DISPATCH_SURFACES.commissaire` and runs the verb-level bijection + pinned-classification selftest |
| `records/adr/0123-...grammar-first.md` | Markdown | The decision this ticket materialises; the object→action table and alias list are authoritative |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | Markdown | Lines 136-146 hold the first-facade operation list this ticket reconciles |
| `test/commissaire.test.mjs` | JavaScript | The end-to-end facade test, entirely flat-verb today; must stay green (aliases) and gains object-verb coverage |
| `test/scaffolder-cli-surface-drift.test.mjs` | JavaScript | Asserts scaffolder-cited `faff <verb> <subcommand>` forms exist in the surface; protected by retaining the flat aliases |

**Scope statement.** This is the surface layer of the Commissaire facade inside the `faff` CLI bin; it sits above the governance cores and below the (unbuilt) standalone `commissaire` front-end.

## 2. OUT OF SCOPE

- **Typed per-object record envelopes** — the design's future direction (`ContractProposal`, `AuditSeal`, per-object `RecordEnvelope`). Why excluded: ADR-0123 records this as future work; grammar-first names the objects at the CLI only. Extension point: the `KIND_AUTHOR` map and `buildEnvelope` in `commissaire.js`, where the single `kind_of_entry` envelope would grow into per-object types.
- **Standalone `commissaire` CLI front-end** — the diagrams' "commissaire CLI, Phase 2A" binary. Why excluded: untracked follow-on; this ticket keeps the surface under `faff commissaire`. Extension point: a new bin entry over the same `COMMISSAIRE_SURFACE` grammar.
- **`audit export`** — the ninth design operation. Why excluded: still unbuilt, not in this ticket's mapping. Extension point: an `audit export` canonical key + handler alongside `audit seal`.
- **`audit verify`** — FAFF-977, not this ticket. Why excluded: 977 lands the `audit` object first; 980 adds `audit seal` as its sibling. Extension point: already the `audit` namespace 977 introduces.
- **Handler hardening (admit idempotency, authoritative-PK auth leg, pre-append revocation check, reconcile flag)** — FAFF-978, in review on this surface. Why excluded: separate ticket; 980 rebases on it and changes no handler internal. Extension point: the handler bodies themselves, which 978 owns.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Object | A CLI namespace naming a governed thing: `contract`, `effect`, `verdict`, `audit` |
| Action | The imperative verb done to an object, e.g. `admit`, `declare`, `authorize`, `conclude`, `seal` |
| Object-verb form | The two-token canonical spelling `commissaire <object> <action>` |
| Flat verb | The original single-token spelling from FAFF-828 (`admit`, `request-decision`, …) |
| Alias | A flat verb retained as a second spelling of an object-verb form; resolves to the same handler |
| Canonical key | The object-verb string used as the single dispatch-table key, e.g. `"contract admit"` |

**The object→action→handler→alias mapping** (authoritative; from ADR-0123 and the ticket scope):

| Object-verb (canonical) | Routes to today's handler | Flat-verb alias | Required flags |
|---|---|---|---|
| `contract admit` | `cmdAdmit` | `admit` | `--producer`, `--contract-revision` |
| `effect declare` | `cmdProducerLedger(…, "declare", "declare")` | `declare` | `--producer`, `--issue`, `--step` |
| `effect authorize` | `cmdRequestDecision` | `request-decision` | `--producer`, `--issue`, `--step` |
| `effect observe` | `cmdProducerLedger(…, "observe", "observe")` | `observe` | `--producer`, `--issue`, `--step` |
| `effect reconcile` | `cmdReconcile` | `reconcile` | `--issue` |
| `verdict conclude` | `terminal-verdict` boundary stub (`events anchor`) | `terminal-verdict` | `--issue` |
| `audit seal` | `seal-bundle` boundary stub (`bundle publish`) | `seal-bundle` | (none) |

`audit verify` is not in this table; it is FAFF-977's operation under the same `audit` object.

**Dispatch resolution shape.** Two module-level tables replace the ad-hoc `switch(verb)`: a canonical dispatch table (`COMMISSAIRE_DISPATCH`, keyed by the object-verb string, the only place a handler is named) plus a flat-verb-to-canonical alias map (`COMMISSAIRE_ALIASES`, where an alias never appears as a dispatch key). `OBJECT_TOKENS` is the first-token namespace set `{contract, effect, verdict, audit}`. `audit verify` is wired to `cmdAuditVerify` (contributed by FAFF-977) so the unified resolver keeps it working.

**Surface derivation.** `COMMISSAIRE_SURFACE.subcommands` lists every accepted spelling (both canonical keys and alias keys) with its required flags, derived from one source (`REQUIRED_FLAGS_BY_CANONICAL`) so the declared grammar cannot drift from dispatch.

**Design decision — how to represent object-verb keys.** **Chosen:** compound string keys on the flat `subcommands` map, both canonical and alias, following the FAFF-977 `"audit verify"` representation. It matches the `request-decision` precedent and needs no change to `buildCliSurface`/`acceptedFlags`/`cliSurfaceSelftest`, which iterate `Object.entries(surface.subcommands)`.

**Design decision — single source for dispatch and surface.** **Chosen:** derive both the runtime dispatch and the declared `subcommands` from `COMMISSAIRE_DISPATCH` + `COMMISSAIRE_ALIASES` + `REQUIRED_FLAGS_BY_CANONICAL`, so a canonical key has exactly one handler and an alias can only resolve to a canonical key. This discharges "no second implementation" by construction.

## 4. HOW — Behavior

**Architecture.** `cmdCommissaire` stops reading a single verb token and instead resolves one or two leading tokens to a canonical key, then dispatches off `COMMISSAIRE_DISPATCH`. Flag parsing (`parseCommissaireArgs`) is unchanged: it collects non-flag tokens into `rest` and flags into `flags`, so `rest = ["contract", "admit"]` and `rest = ["admit"]` both parse identically.

**Resolution procedure.**

```
PROCEDURE resolve_canonical(rest):
  1. IF rest is empty: RETURN unresolved
  2. IF rest[0] is in OBJECT_TOKENS:
     a. key = rest[0] + " " + (rest[1] or "")
     b. IF key is a COMMISSAIRE_DISPATCH key: RETURN key
     c. ELSE: RETURN unresolved
  3. ELSE IF rest[0] is a COMMISSAIRE_ALIASES key:
     a. RETURN COMMISSAIRE_ALIASES[rest[0]]
  4. ELSE: RETURN unresolved
```

```
PROCEDURE cmdCommissaire(args):
  1. IF args contains "--selftest": RETURN commissaireSelftest()
  2. { flags, rest } = parseCommissaireArgs(args)
  3. key = resolve_canonical(rest)
  4. IF key is unresolved: print usage(); RETURN 2
  5. RETURN COMMISSAIRE_DISPATCH[key](flags)
```

Behaviour summary: any accepted spelling reaches its handler through one canonical key, so exit codes, stdout JSON, and stderr are produced by the same handler regardless of spelling. The boundary stubs for `verdict conclude`/`audit seal` keep their current inline flag-presence checks (`--issue` required for the verdict, `--run-dir` for the seal) and their `cmdBoundaryStub` delegation to `faff events anchor` / `faff bundle publish` unchanged; only the dispatch key that reaches them changes.

**Handler-label wording.** Handlers hard-code a verb label in their stderr messages. **Chosen:** leave those labels exactly as they are — no handler body is edited. An operator invoking an object-verb form may see the legacy flat label in a stderr diagnostic; this is acceptable because the label is stderr text only, never part of the JSON or exit code.

**Selftest under both spellings.** Extend the existing round-trip to run admit → declare → request-decision → reconcile once with flat tokens and once with object-verb tokens, asserting exit 0 at each step, the request-decision verdict is `grant`, the ledger verifies, the auth leg passes, split-key custody holds, and reconcile exits 0; both passes identical in exit and verdict.

**`usage()` string.** Rewrite the usage text to present the object-verb grammar as primary with the flat verbs noted as aliases.

**Edge cases and error handling.**

| Input | Outcome |
|---|---|
| `commissaire contract admit …` | Resolves to `"contract admit"` → `cmdAdmit`; identical to `commissaire admit …` |
| `commissaire admit …` (alias) | Resolves via alias map to `"contract admit"` → `cmdAdmit`; unchanged behaviour, exit, JSON |
| `commissaire contract` (object, no action) | Unresolved → `usage()`, exit 2 |
| `commissaire effect frobnicate` (unknown action) | Unresolved → `usage()`, exit 2 |
| `commissaire wibble` (unknown single token) | Unresolved → `usage()`, exit 2 (unchanged) |
| `commissaire audit verify …` | Resolves via the `audit verify` key contributed by FAFF-977 |
| Handler-level bad flags / missing run dir | Unchanged: handlers still return exit 2 / 3 as today |

No object token collides with any flat verb, so resolution is unambiguous.

**Anti-pattern:** duplicating a handler body under the object-verb key and leaving the flat verb pointing at a copy. Aliases must resolve to the single canonical entry.

**Anti-pattern:** touching `evaluateDecisionRequest`, `chokepointPermit`, `verifyAuthLeg`, `computeEscapes`, `KIND_AUTHOR`, or `buildEnvelope` to "fit" the objects.

**Failure modes.**

- The cli-surface bijection is a top-level verb-layer check (`Object.keys(SURFACES)` vs `Object.keys(COMMANDS)`); `commissaire` is one verb and its `subcommands` map is not part of any bijection. Adding compound and alias keys drawn from the existing `COMMISSAIRE_SPEC` flags keeps both checks green.
- `test/scaffolder-cli-surface-drift.test.mjs` parses only the immediate second token, so it validates `commissaire admit` but not the compound `contract admit`. Retaining the seven flat aliases keeps every existing citation resolvable; do not remove a flat alias.

## 5. Scenarios

- The `faff commissaire --selftest` chain passes for both the flat and object-verb spellings.
- The `faff cli-surface --selftest` bijection and required-flag checks pass with the enlarged `subcommands` map.
- Every one of the seven flat verbs remains accepted and produces the same exit code and JSON as its object-verb form.

## 6. Design Decision Rationale

**How should object-verb forms be represented in the surface?** **Chosen:** compound string keys on the flat map — the least-change representation consistent with the established `request-decision`/`audit verify` pattern.

**How is "an alias never carries a second implementation" enforced?** **Chosen:** the single canonical table plus alias map; the flat verb resolves through the alias map to the same canonical key.

**How does the cli-surface selftest stay green?** **Chosen:** the selftest is the guard; the design keeps the verb-level bijection intact (commissaire stays one verb) and draws all required flags from the existing spec.

**What is the `audit` object's state when 980 runs?** **Assumes** FAFF-977 has merged, contributing the `audit` object; 980 adds `audit seal` as a sibling and wires `audit verify` into the unified dispatch table without touching `cmdAuditVerify`.

**Which handler internals does 980 build against?** **Assumes** FAFF-978 has merged, hardening the handlers. 980 changes no handler internal.

**What exactly is reconciled in the technical design doc?** **Chosen:** rewrite the fenced operation list at `TECHNICAL-DESIGN-v5.md` to the object grammar, renaming `evidence register`→`effect declare`, `observation append`→`effect observe`, `effect decide`→`effect authorize`, bare `reconcile`→`effect reconcile`, `verdict decide`→`verdict conclude`; `contract admit`, `audit seal`, `audit export`, `audit verify` keep their spelling.

**Should the commissaire round-trip selftest cover both spellings?** **Chosen:** parametrise the existing round-trip to run once per spelling, asserting identical exit and verdict.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.**

- **Assumes:** FAFF-977 has merged, introducing the `audit` object (an `audit`-token dispatch branch and the `audit verify` handler/key). If present, extend that scaffolding and add `audit seal`.
- **Assumes:** FAFF-978 has merged, hardening the four handlers. Rebase on the merged 978 and read the current bodies before wiring dispatch; touch none of them.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff commissaire` accepts all seven object-verb forms and all seven flat verbs; no pure core, handler internal, or record kind is modified (diff touches only dispatch/surface/selftest/usage in `commissaire.js`, the surface in `cli-surface.js`, the two docs, and `test/commissaire.test.mjs`).

### From WHAT (mapping and surface)
- [ ] Each object-verb form dispatches to the exact handler its flat verb does today, per the mapping table.
- [ ] `COMMISSAIRE_DISPATCH` has one entry per canonical key; `COMMISSAIRE_ALIASES` maps each flat verb to a canonical key; no alias appears as a `COMMISSAIRE_DISPATCH` key.
- [ ] `COMMISSAIRE_SURFACE.subcommands` contains all seven canonical compound keys and all seven alias keys, each with its canonical's `required_flags`, derived from the single source.

### From HOW (behaviour)
- [ ] `commissaire contract admit …` and `commissaire admit …` produce identical exit code and stdout JSON on the same inputs (and likewise for the other six pairs).
- [ ] `commissaire contract`, `commissaire effect frobnicate`, and `commissaire wibble` each print usage and exit 2.
- [ ] The `verdict conclude` and `audit seal` boundary stubs still delegate to `faff events anchor` / `faff bundle publish` with unchanged flag-presence checks.
- [ ] Handler bodies are unchanged; their stderr labels stay as today, and JSON and exit codes are unchanged.
- [ ] The `usage()` string presents the object-verb grammar with the flat verbs noted as aliases.

### From HOW (selftests)
- [ ] `faff commissaire --selftest` runs the chain under both flat and object-verb spellings and passes.
- [ ] `faff cli-surface --selftest` passes with the enlarged `subcommands` map.

### From tests and docs
- [ ] `test/commissaire.test.mjs` stays green and gains at least one assertion that an object-verb form and its flat alias return identical exit and JSON.
- [ ] `test/scaffolder-cli-surface-drift.test.mjs` stays green (all seven flat aliases retained).
- [ ] `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` first-facade operation list is reconciled to the object grammar.
- [ ] `docs/guide/cli.md` commissaire row reflects the object-verb grammar with the flat aliases noted.

confidence: high
build-tier: complex
spec-review: approve
