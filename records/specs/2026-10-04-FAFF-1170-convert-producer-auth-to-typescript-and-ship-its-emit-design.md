# Spec — FAFF-1170: Convert the Commissaire cluster (`producer-auth` + `commissaire`) to TypeScript and ship its emit through the new toolchain

> Spec: faffter-dark-nlspec · 2026-10-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1170.

This spec is for the build agent and human reviewers. It converts **both** modules of the Commissaire cluster — `producer-auth.js` and `commissaire.js` — to TypeScript in one slice. Two ratified folds land here: **FAFF-1173's scope** (the `commissaire.ts` conversion, folded in so both modules convert together — ratified `convert-commissaire-cluster-together`) and **FAFF-1169's emit-coverage guard** (folded in because its guard is vacuous until a `.ts` file exists — comment "Scope expanded: absorbs FAFF-1169's emit-coverage guard"). A third ratified fold lands here: the **ledger-read branding/behaviour-preservation resolution** (ratified `ledger-read-fields-stay-plain-string`), which closes the one architecture Punt the round-5 review left open — brand only at the mint/admission edge, read ledger fields back as plain `string`. It supersedes the earlier leaf-only spec on this ticket (scope ratified wider on 2026-10-04); the earlier parks were against the leaf-only scope and the now-resolved ledger Punt, and no longer apply.

## 1. WHY — Problem and Principles

**Load-bearing model.** A branded id (`ProducerId`, `ContractRevisionId`) only constrains code that *sees the brand*. `commissaire.js` is `producer-auth`'s sole production caller, so if it stays plain JavaScript the brands erase at the call boundary and the type checker proves nothing about real callers — it only constrains the converted module's own selftest literals. Converting **both** modules together is the structural fix: the brand types flow `producer-auth` → `commissaire` across a real production edge, and a mis-typed value (a raw string passed where a `ProducerId` is required) becomes a compile error on the production path, not just in a test. This is why the slice is the cluster, not the leaf.

**The enforced edge is the mint/admission path — stated precisely so it is unambiguous.** The brand constrains exactly one production surface: the **mint/admission path**, where commissaire's `admit` flow constructs a `ProducerId`/`ContractRevisionId` from trusted CLI input (`asProducerId`/`asContractRevisionId`) and passes the minted id across to `producer-auth`'s typed admission API — a raw, un-minted `string` there is a **`TS2345`** on the production path. This is a real cross-module edge, not a self-test literal. The **ledger-read verify path is deliberately *not* branded** (ratified `ledger-read-fields-stay-plain-string`): values read back from the ledger are plain `string`, and the shared `deriveKey` is therefore not a brand site (see §3). So the brand's enforced surface is narrow and concrete — the admission mint, not "every edge" and not "nothing": it bites where a new identity is first constructed, and stands aside where an existing one is re-verified.

**Problem statement.** The cluster is untyped JavaScript with hand-rolled input handling and no compile-time guarantees on its security-critical identifiers. This slice converts both modules to type-checked TypeScript, stands up the compiler toolchain (which neither module can be checked without), and commits the compiled `.js` emit that every install path actually runs.

**Design principles.**

- **The shipped artifact stays dependency-free.** "Dependency-free" governs the running artifact: the committed `.js` emit and the `bin/faff` / `bin/commissaire` CLIs run on Node built-ins with zero installed runtime dependencies. Build-time-only, fully-erased type packages (`typescript`, `@types/node`) do not touch that artifact and do not violate the pillar (ratified: `ts-devdeps-types-node`).
- **The committed `.js` emit is the governed artifact.** Region lint, the import-independence guard, and every existing test read the committed `.js`, never the authored `.ts` (ratified on FAFF-1169). A brand or a region banner that is not present in the emit does not exist for the toolchain.
- **No unchecked cast crosses an input boundary.** Every value arriving from outside a module — CLI argv, stdin payloads, on-disk ledger/fixture JSON, subprocess stdout, cross-module call arguments — is pinned to its type by a runtime validator, never by a bare `as`/angle-bracket assertion at the boundary. The single sanctioned assertion is *inside* a validator, after the runtime check that justifies it. **The on-disk ledger/admission records are parsed field-by-field with runtime validation and no `as` cast**, but their `producer_id`/`contract_revision` fields are read back as plain `string` and are **not** re-minted into brands on the ledger-read path (ratified `ledger-read-fields-stay-plain-string`; see §3 "Ledger-read fields stay plain `string`"). Branding happens only at the mint/admission edge, so the verify path stays byte-for-byte as today.
- **Brands are a compile-time guarantee, not a new runtime authenticator.** The brand types move a class of mistake from runtime to `tsc`; runtime producer authenticity is still the unchanged split-key machinery (`verifyRecord` HMAC, `verifyDecision` Ed25519). The conversion changes no runtime security property — it adds a compile-time guard on top of the existing one.
- **The stale/divergent-emit risk is a ratified, bounded tradeoff — not an open defect.** Because the governed artifact is the committed `.js`, a `.ts` edited and not rebuilt (or a hand-patched/tampered emit) would run un-reviewed until detected. This slice ships the existence-only floor; the freshness gate (FAFF-1171, `git diff --exit-code` on the emit) and the `faff doctor` stale-emit check (FAFF-1172) are the detection mechanisms, sequenced immediately after. This ordering is **ratified** (`ts-foundation-mitigation-sequencing`); the deferred-mitigation / divergent-emit objection is settled for slices 1170/1171/1172 and is not a re-block of this slice.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/producer-auth.js` (185 ln) | JS → TS | The leaf: `node:crypto` only, `region:governance`, split-key auth cores. Brand site: the **typed admission API** the `admit` flow calls to mint a producer (branded `ProducerId`/`ContractRevisionId` parameters). `deriveKey(masterSecret, producerId, contractRevision)` is **not** a brand site — it is shared by admit and verify, so its id params stay plain `string | undefined` (it already coerces via `String(…)`). |
| `plugin/skills/faff/bin/lib/commissaire.js` (1098 ln) | JS → TS | The facade: `region:factory`, sole production caller of `producer-auth`, validated input boundaries. The `admit` flow is the one mint/admission site; `verifyAuthLeg`/`evaluateDecisionRequest` are the ledger-read verify sites (plain `string`). |
| `records/adr/0132-typescript-emit-lands-beside-source-under-the-js-name.md` (merged on `main` @ `972ae4f6`, FAFF-1168 **Done**) | — | ADR-0132 layout (d). Its `Status` is `Proposed` **by design**: ADR-0132's own status note makes FAFF-1170 (this slice) its acceptance — the layout is settled by the merged FAFF-1168 spike, and *this* slice flips the ADR to `Accepted` (or narrows it only if a real `tsc` emit surfaces a wrinkle the spike's hand-staged fixture did not). So "`Proposed` + this slice is its acceptance" is the expected, intended state, not an unresolved gap. |
| `plugin/skills/faff/bin/lib/regions.js` (1177 ln) | JS | `faff regions check`; `regionsFileMap` scans every line for the banner; `regionSources()` lists `.js` only. Gains `regionsEmitCoverage`. |
| `test/commissaire-standalone.test.mjs` | JS (ESM test) | The standalone import-independence guard; reuses `regionsRequireEdges`, walks the `bin/commissaire` require graph (reads `.js`). |

**Scope statement.** First conversion in the V5 "Commissaire ships from type-checked TypeScript source" project; the toolchain it lands is reused by FAFF-1171 (CI freshness gate) and FAFF-1172 (`faff doctor` stale-emit check).

## 2. OUT OF SCOPE

- **Outer importers stay `.js`** — `cli-surface`, `governance-check`, `merge-gate`, `worktree-prune`, `bin/faff`, `bin/commissaire`. Why excluded: the enforced surface this slice owns is the two cluster modules; the outer callers seeing `commissaire` as `any` across their extensionless `require("./commissaire")` is accepted for this slice (ratified in `convert-commissaire-cluster-together`). Extension point: a later slice converts each and types its edge.
- **CI type-checking / freshness gate** — `tsc --noEmit` + `git diff --exit-code` on a Node 22+ runner. Why excluded: vacuous before the first `.ts`+emit exists. Extension point: FAFF-1171 (ratified: `ts-foundation-mitigation-sequencing`).
- **`faff doctor` stale-emit check** — FAFF-1172. Why excluded: same sequencing. Extension point: `faff doctor`.
- **Staleness detection in the emit-coverage guard** — this slice ships the existence-only floor; FAFF-1171 adds staleness on top (ratified sequencing).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Toolchain.** These toolchain `Chosen` decisions do **not** rest solely on an unaccepted ADR. Each was **independently re-verified by a real `tsc` build during prep** (the "Verified:" notes below), and ADR-0132's own status note explicitly reserves **narrowing the layout/tsconfig to this slice's acceptance evidence**. So they are settled-and-verified, with one sanctioned escape valve: if this slice's real emit diverges from the spike's hand-staged fixture (the exact wrinkle ADR-0132 defers here), the layout/tsconfig may be narrowed **under this slice's acceptance** and the ADR flipped to `Accepted` accordingly — that is ADR-0132 working as designed, not a re-review trigger. No toolchain choice here is an open assumption riding on the ADR alone.

- **Chosen:** Pin `typescript` to **`~5.9` (≥ 5.8 required)**, not 5.7 — rationale: `erasableSyntaxOnly` is a TypeScript **5.8** compiler option (verified: unknown-option error on 5.7.3, accepted on 5.9.3). The ticket's "5.7 or later" is corrected to ≥ 5.8. `@types/node` pinned to the Node 20 line (build-time-only devDependency). Both under `devDependencies`; **no `dependencies` block** (ratified: `ts-devdeps-types-node`).
- **Chosen:** `package.json` and `tsconfig.json` live at **`plugin/skills/faff/`** (the skill root that contains `bin/`), with a `build` script running `tsc -p tsconfig.json`. Rationale: scopes the manifest to the plugin, keeps the marketplace-copy install path self-contained, and stays clear of the repo-root `release-please` config (verify no interference — DONE item). `npm run build` is invoked from `plugin/skills/faff/`.
- **Chosen:** `tsconfig.json` `compilerOptions`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, `allowJs`, `module: "commonjs"`, `types: ["node"]`, `removeComments: false`, **`moduleDetection: "force"`**, and **no `outDir`/`rootDir`** (emit beside source — layout d). `include` lists only the two `.ts` files, so the `.js` siblings are never recompiled over themselves.
- **Chosen:** add **`moduleDetection: "force"`** (absent from the ticket's tsconfig list). Rationale (verified): a CommonJS `.ts` file authored with only `require()`/`module.exports` and no `import`/`export` is treated by TypeScript as a *global script*, so top-level `const`s collide across the two files (TS2451) and `const crypto = require(...)` clashes with the ambient `crypto: Crypto` global. `moduleDetection: "force"` makes every file an isolated module and removes both faults; `@types/node` alone does not.
- **Chosen:** `removeComments: false` so the `// === region:… ===` banner survives into the emit. Verified: the banner is preserved and `regions.js`'s `regionsFileMap` matches it on any line (it is no longer line 1 — a `"use strict"` + `Object.defineProperty(exports,"__esModule",…)` preamble precedes it — which is fine because the scan reads all lines).
- **Chosen:** keep `rewriteRelativeImportExtensions` per ADR-0132, noting it is **inert** here — source relative specifiers are all extensionless, so there are no `.ts` extensions to rewrite. Verified: accepted alongside `module: "commonjs"` on TS 5.9 (no TS5095); the round-1 "only valid with nodenext/node16" claim does not reproduce on the pinned compiler.

**Source module shape.**

- **Chosen:** runtime stays CommonJS — `const x = require("…")` and `module.exports = { … }`; no runtime ESM `import`/`export` (ratified CommonJS decision, comment 8). The emit is CommonJS and the FAFF-1169 require-graph walker stays require-only.
- **Chosen:** **type-only** `import type` / `export type` / `export interface` **are permitted** and are how brands flow across the boundary; runtime ESM `import`/`export` remain prohibited. Rationale: these are fully erasable (emit nothing) and `erasableSyntaxOnly`-legal, so the committed `.js` is byte-for-byte CommonJS — exactly the shape comment 8's rationale protects (runtime/emit/require-graph all unchanged). Verified: `producer-auth.ts` exports `export interface ProducerAuthApi` + `export type` brands; `commissaire.ts` does `import type { ProducerAuthApi, ProducerId, ContractRevisionId } from "./producer-auth"` and pins `const producerAuth: ProducerAuthApi = require("./producer-auth")`. A raw string passed to the **admission-mint API** on `ProducerAuthApi` (the parameter typed `ProducerId`/`ContractRevisionId`) is then a compile error (TS2345) — *not* `deriveKey`, whose id params are plain `string | undefined` because it is shared with the verify path. `export =`/`import =` stay banned (non-erasable).

**Branded ids.**

- **Chosen:** `type OpaqueId<Name extends string> = string & { readonly [brand]: Name }` (with `declare const brand: unique symbol`), `type ProducerId = OpaqueId<"ProducerId">`, `type ContractRevisionId = OpaqueId<"ContractRevisionId">`. The brand carries no runtime cost (erased to `string`); compile-time guard only (runtime authenticity stays the unchanged HMAC/Ed25519 cores).
- **Chosen (two validator forms, used at the mint/admission edge only).** Each brand has two mints sharing one runtime check: a **throwing** `asProducerId(v: unknown): ProducerId` for fail-loud mint sites (CLI argv), and a **non-throwing** `tryAsProducerId(v: unknown): ProducerId | null` for admission-time construction from trusted input. Each returns `v as <Brand>` only after the check (the one sanctioned assertion). Neither is applied on the **ledger-read verify path** — values read back from the ledger stay plain `string` (ratified `ledger-read-fields-stay-plain-string`; see below).

**Validated input boundaries (commissaire).** Runtime-validated, no bare `as`/`<T>` crossing: CLI argv; stdin JSON (`readStdinJson`); on-disk JSON/JSONL (`readJson` l.93, `readLedgerEntries`/`parseJsonlEntries`, `run-ledger.json` l.802); subprocess stdout (l.1022/1063); cross-module `ProducerId`/`ContractRevisionId` call sites. (Fixtures under `test/fixtures/commissaire/…` are trusted test data read by the *tests*, not a `commissaire.ts` boundary.)

**Ledger-read fields stay plain `string` — Chosen (ratified: `ledger-read-fields-stay-plain-string`).** The brand is applied at the **mint/admission edge only**; values read back from the ledger are read as plain `string`, **never re-minted through a `tryAs*` validator, and no `null`→deny path is introduced on the ledger read**.

1. **Boundary readers are `unknown`, not `any`.** `JSON.parse`'d ledger/admission input is `unknown`, so an implicit `any`→record assignment is a `tsc` error.
2. **`parseGovernedRecord(raw: unknown): GovernedRecord | null` / `parseAdmissionRecord` construct the record field-by-field with runtime validation and no `as` cast.** A `null` return is reserved for a **structurally-unusable line only** — `raw` is not an object (a non-object / non-parseable JSONL line). This mirrors today exactly: `parseJsonlEntries` already does `JSON.parse(line)` in a `try`/`catch` and drops a line that throws (`.filter(Boolean)`), so a wholly-garbage line never reaches the auth loop. The caller therefore **drops a `null`-parsed line** (it is not in the entry list), introducing **no** new `null`→deny branch.
3. **Auth-relevant fields are typed plain `string | undefined` (un-branded), not `string`.** `producer_id`/`contract_revision` on `GovernedRecord` are `string | undefined` — plain (ratified: not branded) and honest about a record that is a valid object but lacks the field. This is what makes (2) and the parity requirement consistent: the parser does **not** gate the auth outcome on field presence, so a present-but-incomplete record keeps flowing, carrying `undefined` where a field is absent — exactly as `e.producer_id` is `undefined` today.
4. **`deriveKey`'s id parameters are plain `string | undefined`** (matching its existing `String(producerId)`/`String(contractRevision)` coercion). The verify path passes the `string | undefined` fields to `deriveKey` **unchanged — byte-for-byte as today**.

**Malformed-record outcomes are fully pinned to today's path (no new behaviour, no `null`→deny).** For every shape a malformed ledger record can take, the converted code preserves the exact existing outcome:

| Malformed shape | Today's path (preserved) |
|---|---|
| Non-object / non-parseable JSONL line | `parseJsonlEntries` drops it (`JSON.parse` throws → filtered); `parseGovernedRecord` returns `null` and the caller drops it. Never reaches the auth leg. |
| Object with missing/wrong `schema` (`schema !== 3`) | `verifyAuthLeg` `continue`s — skipped as a frozen pre-cutover line, never a failure. |
| Object, `author === "producer"`, missing/invalid `producer_id`/`contract_revision` | flows `deriveKey(master, undefined, …)` → HMAC mismatch → failure reason **`producer-auth-mismatch`** (the exact existing path and reason string). |
| Object with absent/other `author` | neither verify branch fires — skipped, no failure (unchanged). |

This taxonomy is forced by the behaviour-parity ACs ("CLI results unchanged", "reverting restores the prior artifact with no other change"), which rule out a validator-`null`→deny divergence; it closes the previously-"unspecified except S8" gap so two conformant builds cannot diverge on a wholly-malformed record.

**What the brand *does* constrain (the enforced edge, unambiguous).** The brands enforce the **mint/admission path**: commissaire's `admit` flow mints `asProducerId(trusted-input)` / `asContractRevisionId(trusted-input)` and passes the minted id to `producer-auth`'s typed admission API — **a raw `string` passed where a `ProducerId`/`ContractRevisionId` parameter is required at that mint/admission call is a `TS2345`** on the real production path (not a selftest literal). This is a genuine cross-module brand flow (`producer-auth` → `commissaire` via `import type`). The ledger-read verify path stays untouched and un-branded by design, so the brand is neither "everywhere" (it does not touch `deriveKey` or the verify path) nor "nowhere" (it bites at every admission mint).

**The typed-`require` module binding is the sanctioned trusted-sibling binding — Chosen.** `const producerAuth: ProducerAuthApi = require("./producer-auth")` is not an untrusted input boundary (it is in-repo code governed by the emit-coverage + require-independence guards; the divergent-emit risk is the ratified tradeoff). The cast-prohibition governs external *values*, not this one module-binding line, which the check allow-lists.

**Boundary-contract check — Chosen.** `scripts/check-no-boundary-cast.mjs` (TS-compiler-API AST walk, `node --test` leg) enforces three structural properties `tsc` alone cannot: (1) **no unchecked type assertion of any form** — fail on any `AsExpression` (`x as T`), `TypeAssertionExpression` (`<T>x`), **`NonNullExpression` (`x!`)**, **and `SatisfiesExpression` (`x satisfies T`)** outside the allow-list (validator mints + the typed-`require` line). The node list is exhaustive over TypeScript's type-assertion forms on purpose: `x!` asserts away `null`/`undefined` with no runtime check and `x satisfies T` narrows for the checker without a cast node, so both are exactly the "unchecked cast crosses an input boundary" pattern this control exists to prohibit (e.g. `record.payload!.effect` on a parsed-`unknown` ledger record) — enumerating only `as`/`<T>` would leave `!` and `satisfies` as a silent escape hatch when `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` creates friction on a boundary reader. (2) **no `any` at a boundary reader** — fail if a named reader declares an `any` return type; (3) **the cross-module `producer-auth` require is typed** — fail unless the binding is an `import type` + a typed `const producerAuth: ProducerAuthApi = require("./producer-auth")`, so the brand flow cannot silently degrade to `any` (refinement of `ledger-read-fields-stay-plain-string`). S3 plants `as ProducerId`, `<ProducerId>value`, `as any`, **`value!` (non-null assertion)**, and **`value satisfies ProducerId`** at boundaries and asserts non-zero on each; a planted-`any`-reader fixture asserts property 2; an untyped `require("./producer-auth")` fixture asserts property 3; real sources exit 0.

**Emit-coverage guard (folded from FAFF-1169) — Chosen.** Add `regionsEmitCoverage(files)` to `regions.js` + a `faff regions check` leg that **fails (exit 2) if any `.ts` under `bin/lib/` lacks a committed sibling `.js` emit** (existence-only floor; staleness → FAFF-1171). `faff regions check` runs in CI (wired into `.github/workflows/validate.yml`).

## 4. HOW — Behavior

1. **Toolchain stand-up.** `plugin/skills/faff/package.json` (pinned `typescript ~5.9` + `@types/node`, `build` script, no `dependencies`) + `tsconfig.json` (above). `npm install && npm run build` emits the two `.js` beside the `.ts`.
2. **Convert `producer-auth.ts`.** Annotate the cores; introduce brands + the two validator forms; `export interface ProducerAuthApi` + `export type` brands; `module.exports` shape unchanged; selftest behaviour unchanged.
3. **Convert `commissaire.ts`.** Annotate the facade; `unknown`-typed readers → `parseGovernedRecord`/`parseAdmissionRecord` (field-by-field, no `as`) → plain `string | undefined` auth fields; the verify path passes those plain fields to `deriveKey` **unchanged** (no `tryAs*` re-mint, no `null`→deny — behaviour parity on every malformed shape per §3's taxonomy); branding bites only at the `admit` mint/admission edge; typed `import type` + allow-listed typed `require`.
4. **Boundary-contract check.** Add `scripts/check-no-boundary-cast.mjs` + its `node --test` leg + the S3 negatives (`as`, `<T>`, `as any`, `!`, `satisfies`).
5. **Commit the emit.** Both `.js` committed; byte-stable across two consecutive builds.
6. **Emit-coverage guard.** `regionsEmitCoverage` + `faff regions check` leg; confirm the banner survives the emit.
7. **Importers unchanged.** Extensionless `require`; outer six stay `.js`.
8. **Docs.** README keeps "Node 20 or later"; AGENTS.md gains the Node 22.18+ contributor floor.

**PR structure — Chosen (resolves the review surface without re-slicing).** The cluster converts together (ratified `convert-commissaire-cluster-together`) because the brands only flow across the `producer-auth` → `commissaire` boundary once both are typed; splitting them into separate PRs would ship a half-typed boundary that proves nothing. The PR-review-surface concern is resolved by **staged commits on the one branch**, reviewable in parts, all landing in a single PR:

1. `producer-auth.ts` — brands, validator forms, `ProducerAuthApi` (incl. the typed admission API); emit committed.
2. `commissaire.ts` — boundary readers, `parseGovernedRecord`/`parseAdmissionRecord`, the typed admission call, verify-path parity; emit committed.
3. `scripts/check-no-boundary-cast.mjs` + the emit-coverage guard + CI wiring.

A reviewer reads the leaf conversion, then the facade conversion, then the enforcement tooling as three self-contained diffs. The AST-walking checker (the newest, least-exercised code the methodology lens flagged) is its own commit, reviewable in isolation, yet ships in this PR because the conversion's acceptance (S2/S3) depends on it existing. This keeps the cluster-together decision intact while bounding what any one commit asks a reviewer to hold in mind.

**Edge cases.** `erasableSyntaxOnly` refuses enums/namespaces/parameter-properties/`export =`. The `__esModule` preamble is overwritten at runtime by `module.exports =`. `allowJs` + `.ts`-only `include` means `.js` siblings are not recompiled.

## 5. Scenarios

**S1 — Toolchain builds the cluster.** `npm install && npm run build` exits 0, writes both `.js`.

**S2 — Brands flow across the production edge.** A standalone fixture (`test/fixtures/ts-brand-negative/`, its own tsconfig `extends` the project one) passes a raw, **un-minted** `string` to the `producer-auth` **admission API** (the parameter typed `ProducerId`) on the mint/admission path — the real enforced edge, not `deriveKey` and not a selftest literal; `tsc --noEmit` fails with **`TS2345`** (asserted by code, not merely non-zero exit). [holdout]

**S3 — Cast prohibition enforced.** `check-no-boundary-cast.mjs` plants `as ProducerId`, `<ProducerId>value`, `as any`, `value!` (non-null assertion), and `value satisfies ProducerId` at boundaries → non-zero each; real sources → 0.

**S4a — Source type-valid.** `tsc --noEmit` type-checks both `.ts`, exits 0.

**S4b — Selftests on the emit lane.** `faff commissaire --selftest` → 0 / `commissaire selftest: ok` on Node 20; all existing tests pass against the emit on Node 20.

**S4c — Leaf runs un-built.** `producer-auth.ts` runs directly on Node 22.18+ type-stripping (startup probe). (Layout (d): `commissaire.ts`'s `require("./producer-auth")` resolves the leaf *emit* by design; whole-cluster run-from-source is not claimed.)

**S5 — Guards pass on the emit.** `faff regions check` + `commissaire-standalone.test.mjs` pass against the committed `.js`.

**S6 — Emit-coverage fails on un-emitted source.** `.ts` without its `.js` sibling → `faff regions check` exit 2. [holdout]

**S7 — Revert restores the prior artifact.**

**S8 — Malformed record stays fail-closed (behaviour parity).** A missing/invalid `producer_id` on a schema-3 producer record through `verifyAuthLeg`/`evaluateDecisionRequest` yields the **exact existing outcome** — `deriveKey(master, undefined, …)` → HMAC mismatch → `producer-auth-mismatch` (no `tryAs*` re-mint, no `null`→deny, no throw). Parity fixtures confirm CLI results are unchanged. [holdout]

**S8b — Wholly-malformed records keep today's path (behaviour parity across the full taxonomy).** Three further malformed shapes each reproduce their existing outcome byte-for-byte (per §3's taxonomy): (a) a non-object / non-parseable JSONL line is dropped by `parseJsonlEntries` (never reaches the auth leg); (b) an object with `schema !== 3` is `continue`d (skipped, never a failure); (c) an object with absent/other `author` fires neither verify branch (skipped). No shape introduces a `null`→deny branch, so two conformant builds cannot diverge observably on a malformed record. [holdout]

## 6. Open Questions

- **Punt:** exact `@types/node` minor and `typescript` patch to pin — `(decides: any)` `(non-blocking)`.

The round-5 ledger-path branding vs behaviour-preservation question is now **resolved** — brand only at the mint/admission edge, read ledger fields back as plain `string`, no `tryAs*` re-mint and no `null`→deny on the ledger read (ratified `ledger-read-fields-stay-plain-string`; see §3 "Ledger-read fields stay plain `string`").

## 7. Assumptions

- **Assumes (sequenced upstream dependency, with defined behaviour on failure — not a bare verify step):** this slice depends on FAFF-1168 being merged, which it **is** (FAFF-1168 **Done**; ADR-0132 + the spike spec live on `main` @ `972ae4f6`). The dependency is therefore already satisfied; the branch-point check is a guard against building from the wrong base, not an open risk. **Sequencing + failure behaviour (explicit):** the build branches from `main` and runs `git show HEAD:records/adr/0132-…md` as the first step. On **success** (the expected case, since FAFF-1168 is merged) → proceed. On **failure** (the base lacks the ADR, e.g. a stale `docs/v5-addendum-1` tree) → **STOP** and rebase onto `main` @ `≥ 972ae4f6`; do **not** cherry-pick the ADR, and do **not** proceed unratified. The slice never starts conversion from a base missing its settled upstream.
- **Assumes:** a `plugin/skills/faff/package.json` is not matched by `release-please-config.json` (verify; exclude if it would be).
- **Assumes:** the dev/source lane runs on Node ≥ 22.18 (verify the exact minor against Node release notes).

## 8. DONE — Definition of Done

- `plugin/skills/faff/package.json` with pinned `typescript (~5.9, ≥5.8)` + `@types/node` under `devDependencies`, no `dependencies`, a `build` script; `npm run build` exits 0.
- `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, `allowJs`, `module:"commonjs"`, `types:["node"]`, `moduleDetection:"force"`, `removeComments:false`, no `outDir`.
- `producer-auth.ts` defines `OpaqueId<Name>`, `ProducerId`, `ContractRevisionId`, the two validator forms, and `export interface ProducerAuthApi`; runtime CommonJS.
- `commissaire.ts` validates every input boundary (argv, stdin, on-disk JSON/JSONL, subprocess, cross-module sites) with no `as`/`<T>` crossing a boundary; typed `import type` + typed `require`.
- Boundary readers typed `unknown`; `parseGovernedRecord`/`parseAdmissionRecord` construct records **field-by-field, no `as` cast**, returning `null` **only** for a non-object/non-parseable line (dropped by the caller, mirroring `parseJsonlEntries` — no `null`→deny); ledger-read `producer_id`/`contract_revision` typed plain **`string | undefined`** (un-branded), and `deriveKey`'s id params are plain `string | undefined` (shared verify+admit path). Every malformed shape preserves today's outcome per §3's taxonomy. Branding bites only at the mint/admission edge: a raw `string` passed to the `producer-auth` admission API's `ProducerId`/`ContractRevisionId` parameter is a `tsc` error (`TS2345`); `deriveKey` and the verify path are un-branded by design.
- Both `.js` emits committed, byte-stable across two builds.
- `regions.js` exports `regionsEmitCoverage`; `faff regions check` exits 2 on a `.ts` without a `.js` emit (command-level test); runs in CI (`validate.yml`).
- `scripts/check-no-boundary-cast.mjs` enforces three properties (no unchecked type assertion of any form — `as`/`<T>`/`!` (`NonNullExpression`)/`satisfies` of any target type; no `any` boundary reader; the cross-module `producer-auth` require is typed via `import type` + a typed `require`) with planted-violation fixtures covering all five assertion forms (`as`, `<T>`, `as any`, `!`, `satisfies`); `node --test` leg.
- `tsc --noEmit` type-checks both sources, exits 0.
- All existing commissaire + producer-auth tests/selftests pass against the emit on Node 20; `producer-auth.ts` runs directly on Node 22.18+.
- `commissaire-standalone.test.mjs` passes against the emit.
- S2 negative fixture compiles under its own `extends`-the-project tsconfig and the test asserts `TS2345`.
- S8 malformed-`producer_id` test asserts the existing `producer-auth-mismatch` deny outcome (byte-for-byte: `deriveKey(master, undefined, …)` → HMAC mismatch), never a throw and never a `null`→deny divergence; S8b asserts the three further malformed shapes (non-object line dropped, `schema !== 3` skipped, absent/other `author` skipped) each keep today's path.
- The conversion lands as **staged commits on one branch** (producer-auth.ts → commissaire.ts → check-no-boundary-cast.mjs + guards/CI) in a single PR — cluster-together preserved, review surface bounded per commit.
- The build branches from `main` and the `git show HEAD:records/adr/0132-…md` gate passes (FAFF-1168 merged); defined stop-and-rebase behaviour on a wrong base, never proceed-unratified.
- Clean-install smoke on Node 20 runs `faff commissaire --selftest` from a marketplace-style copy (whole `plugin/skills/faff/` copied, no `npm install`, `node_modules` absent).
- Reverting the conversion commit restores the previous artifact, shown in the PR.
- `faff commissaire --selftest` startup recorded for source and emit (spike baseline: JS 95 ms, `.ts` 227 ms, bare `node -e 0` 73 ms).
- README keeps "Node 20 or later"; AGENTS.md gains the Node 22.18+ contributor floor.
- Commits carry `Signed-off-by`.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```