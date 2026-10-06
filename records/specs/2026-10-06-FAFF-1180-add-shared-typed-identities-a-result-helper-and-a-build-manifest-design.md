# Spec: FAFF-1180, shared typed identities, a result helper and a build manifest for the TypeScript closure

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1180.

This spec is for the build agent and human reviewers. It adds one shared module of opaque identity types with validating parsers (`bin/lib/ids.ts`), one closed-result helper (`bin/lib/result.ts`), and a deterministic build manifest that `npm run build` writes and CI checks for freshness. It moves the existing `ProducerId` and `ContractRevisionId` brands out of `producer-auth.ts` so every brand is defined once, and it prepares the ground for FAFF-1177 (the governor process), whose `governor.ts` must import these types rather than define its own.

## Why: problem and principles

**The model.** A brand is a compile-time tag on a plain string: `OpaqueId<"UnitId">` is a `string` at runtime and a distinct type at compile time, so a `RunId` cannot be passed where a `UnitId` is expected. The only way to obtain a branded value is a parser that takes `unknown`, checks it at runtime, and returns a closed result (`ok` with the branded value, or `err` with the reason). Exactly one function in the codebase performs the string-to-brand assertion, and the boundary-cast checker allow-lists that one function. Everything else in this ticket (the result helper, the manifest, the checker and CI changes) exists to keep that rule enforceable as more TypeScript modules arrive.

**Problem.** Today the two brands live inside `producer-auth.ts` (lines 38 to 41), the seven other identities the technical design names have no type at all, and there is no shared result type or exhaustiveness check for the governor work to build on. The technical design also requires a build manifest binding inputs, compiler configuration and output digest, and none exists. This change adds the shared module, the helper and the manifest, rewires `producer-auth.ts` and `commissaire.ts` onto the shared brands with no runtime behaviour change, and makes CI fail on a stale manifest.

**Design principles.**

**Parsers accept every value frozen records already hold.** A frozen `schema:3` record is never rewritten, so a parser that rejects any id shape in one of them would turn a valid historical record into an unreadable one. Any implementation that tightens the rule beyond what every committed `schema:3` record satisfies is wrong for this ticket.

**No runtime behaviour change in the Commissaire cluster.** `producer-auth.js` keeps every export, return value and error message. `commissaire.js` changes only inside `cmdAdmit`, and only by binding two already-minted values to annotated locals. FAFF-1176 edits `commissaire.ts` next and must rebase cleanly.

**The shipped artifact stays dependency-free and CommonJS.** New runtime code uses `require` and `module.exports` and Node built-ins only; type-only `import type` and `export type` / `export interface` are allowed because they erase (ratified in FAFF-1170). No `dependencies` block, no committed `node_modules`.

**One cast site, enforced by the checker.** Call sites never assert a brand. The checker's allow-list shrinks from four producer-auth function names to the single shared mint, and that mint is allowed only in `plugin/skills/faff/bin/lib/ids.ts`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript | Defines `OpaqueId`, `ProducerId`, `ContractRevisionId` today; its `asProducerId` / `tryAs*` mints become delegates over the shared parsers |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | Mints the two brands in `cmdAdmit` (line 600) through `producerAuth.asProducerId` / `asContractRevisionId` |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | `unitIdOf(rec)` is the record-level compatibility read (`unit_id` versus legacy `issue`); unchanged |
| `scripts/check-no-boundary-cast.mjs` | JavaScript (ESM) | AST checker: no assertion outside allow-listed mints, no `any` boundary readers, typed cross-module requires |
| `.github/workflows/validate.yml`, job `typecheck` | YAML | `npm ci`, `tsc --noEmit`, remove each include entry's `.js`, `npm run build`, path-less `git diff --exit-code` |
| `plugin/skills/faff/tsconfig.json`, `package.json`, `package-lock.json` | JSON | Literal `include` list, `build` script, `typescript` 5.9.3 pinned in the lockfile |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | Markdown | Identity type list (lines 170 to 188), identity table (lines 202 to 211), envelope `references` (line 245), build manifest requirement (line 161) |

**Scope.** This is step 2 of the technical design's migration (opaque identities and result types) plus the step 1 build manifest, for the TypeScript closure that the standalone `commissaire` binary ships from.

## Out of scope

- **Stricter per-kind id formats** (for example a `run-<date>-<time>-graft-<KEY>-<n>` pattern for `RunId`). Why excluded: any pattern risks rejecting a frozen record or an already-admitted producer id, and no caller needs it yet. Extension point: the rule inside `parseOpaqueId` in `bin/lib/ids.ts`, branched per kind.
- **Branding ledger-read fields.** Why excluded: ratified `ledger-read-fields-stay-plain-string` (FAFF-1170) keeps `producer_id` / `contract_revision` read back from the ledger as plain `string`, and `deriveKey` keeps `string | undefined` parameters. Extension point: a future ratified decision, then `parseGovernedRecord` in `commissaire.ts`.
- **Using `UnitId` or `RunId` inside `commissaire.ts`** (for example typing the admission record's `unit_id: "-"` or `cmdAuditAnchor`'s `--unit-id` check). Why excluded: the operator constraint confines `commissaire.ts` changes to `cmdAdmit` type usage so FAFF-1176 rebases cleanly. Extension point: FAFF-1176 or FAFF-1177, importing from `./ids`.
- **Changing `effects.js :: unitIdOf`.** Why excluded: it validates a record (which key carries the unit), not a value; the parser validates a value. Extension point: none needed; a typed caller composes `parseUnitId(unitIdOf(rec))`.
- **Producer-id path safety in `producerFileOf`.** Why excluded: pre-existing behaviour, unrelated to typing. Extension point: `producerFileOf` in `commissaire.ts`.
- **Reading the manifest from `faff doctor` or release packaging.** Why excluded: the ticket asks for the manifest and its CI freshness gate only. Extension point: the stale-emit axis in `plugin/skills/faff/bin/lib/gates.js` (around line 1580), which already enumerates the tsconfig `include` pairs.
- **The wider "work item" vocabulary in the technical design** (prose, the `"work-item"` stream type). Why excluded: addendum decision 6 renamed only the `issue` key to `unit_id`; this ticket renames the identity type, its envelope field and its table row. Extension point: a design-document revision ticket.

## What: vocabulary, types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Brand | A phantom compile-time tag on a `string`; erased to a plain string in the `.js` emit |
| Identity kind | One of the nine names in `ID_KINDS`; each has one brand and one parser |
| Mint | The single function that asserts a checked string is a brand (`parseOpaqueId`) |
| Admission sentinel | The literal `"-"` written as the unit on an admission record (`unit_id: "-"`, legacy `issue: "-"`) |
| Frozen record | A committed `schema:3` JSONL record; never rewritten |
| Build manifest | `plugin/skills/faff/build-manifest.json`, the deterministic record of build inputs, compiler and output digests |

### Module `bin/lib/result.ts` (region governance)

```
TYPE Ok<T>  = RECORD { ok: true (readonly), value: T (readonly) }
TYPE Err<E> = RECORD { ok: false (readonly), error: E (readonly) }
TYPE Result<T, E> = Ok<T> | Err<E>          # discriminated on `ok`

INTERFACE ResultApi:                         # exported type; pins the typed require
  ok<T>(value: T) -> Ok<T>
  err<E>(error: E) -> Err<E>
  assertNever(value: never, context: String) -> never

RUNTIME EXPORTS (module.exports): { ok, err, assertNever }
```

- `assertNever` is the exhaustiveness check: called in the unreachable branch of a switch over a closed union, it fails compilation when a variant is unhandled, and at runtime throws `Error("<context>: unhandled variant <detail>")`, where `<detail>` is `JSON.stringify(value)` when that call returns a string without throwing, otherwise `typeof value` (so a `BigInt`, which makes `JSON.stringify` throw, still yields the diagnostic rather than an unrelated `TypeError`). It never swallows the value through a default.
- Requires no local module and nothing from Node.

### Module `bin/lib/ids.ts` (region governance)

```
DECLARE idBrand: unique symbol               # declare-only, emits nothing
TYPE OpaqueId<Name extends String> = String & { readonly [idBrand]: Name }

ENUM-AS-UNION IdKind = "RunId" | "RunSegmentId" | "UnitId" | "ContractRevisionId" | "ProducerId"
                     | "EffectId" | "EventId" | "LaneId" | "StageAttemptId"
TYPE RunId = OpaqueId<"RunId">   ... one exported alias per IdKind, same name as the kind

RECORD IdParseError:
  kind: IdKind                                 # which parser rejected
  reason: "not-a-string" | "empty-string"
  received: String                             # `typeof` of the rejected input

INTERFACE IdsApi:                              # exported type; pins the typed require
  ID_KINDS: ReadonlyArray<IdKind>              # the nine kinds, in the order listed above
  parseRunId(v: unknown) -> Result<RunId, IdParseError>
  parseRunSegmentId(v: unknown) -> Result<RunSegmentId, IdParseError>
  parseUnitId(v: unknown) -> Result<UnitId, IdParseError>
  parseContractRevisionId(v: unknown) -> Result<ContractRevisionId, IdParseError>
  parseProducerId(v: unknown) -> Result<ProducerId, IdParseError>
  parseEffectId(v: unknown) -> Result<EffectId, IdParseError>
  parseEventId(v: unknown) -> Result<EventId, IdParseError>
  parseLaneId(v: unknown) -> Result<LaneId, IdParseError>
  parseStageAttemptId(v: unknown) -> Result<StageAttemptId, IdParseError>

RUNTIME EXPORTS (module.exports): { ID_KINDS, parseRunId, ..., parseStageAttemptId }
```

- `enum` is not used: `erasableSyntaxOnly` refuses it. `IdKind` is a string-literal union and `ID_KINDS` a plain array.
- Each parser is named `parse` + its kind, so tests can derive the parser from the kind.
- `parseOpaqueId` is internal (not exported) and is the only function in the codebase containing a type assertion on a brand.
- `ids.ts` requires `./result` at runtime through a typed binding (`const result: ResultApi = require("./result")` plus `import type { Result, ResultApi } from "./result"`). Nothing else.
- The brand declaration uses the same form as `producer-auth.ts` lines 38 to 39, with the symbol named `idBrand` to match the technical design.

### `producer-auth.ts` after the change

- Removes lines 33 to 41 (the brand block) and the now-unused `isNonEmptyString`.
- Adds `import type { ProducerId, ContractRevisionId, IdsApi } from "./ids"` and `const ids: IdsApi = require("./ids")`.
- `ProducerAuthApi` and `GovernorKeypair` keep their exact shape; `ProducerAuthApi` now names the imported brands.
- Drops `export type ProducerId` / `export type ContractRevisionId` with no re-export. Nothing in the repo imports those types from `./producer-auth` (only `ProducerAuthApi` is imported, by `commissaire.ts` and `test/fixtures/ts-brand-negative/brand-negative.ts`).
- The four mints keep their names, signatures, return values and messages:

```
PROCEDURE asProducerId(v: unknown) -> ProducerId:
  1. r = ids.parseProducerId(v)
  2. IF NOT r.ok: throw TypeError("asProducerId: expected a non-empty string, got " + typeof v)
  3. RETURN r.value

PROCEDURE tryAsProducerId(v: unknown) -> ProducerId | null:
  1. r = ids.parseProducerId(v)
  2. RETURN r.ok ? r.value : null

# asContractRevisionId / tryAsContractRevisionId: identical over parseContractRevisionId,
# message prefix "asContractRevisionId: ".
```

- The module header comment's TypeScript paragraph (lines 23 to 28) says the brands come from `ids.ts`; the "Branded ids" and "Brand mints" section comments are updated to match. No other line changes.

### `commissaire.ts` after the change (the whole diff)

```
line 55 (unchanged): import type { ProducerAuthApi } from "./producer-auth";
new line 56:         import type { ProducerId, ContractRevisionId } from "./ids";

cmdAdmit, replacing line 600:
  admittedProducerId: ProducerId = producerAuth.asProducerId(producerId)
  admittedContractRevision: ContractRevisionId = producerAuth.asContractRevisionId(contractRevision)
  key = producerAuth.admitProducerKey(masterSecret, admittedProducerId, admittedContractRevision)
```

- No new runtime `require`; `test/commissaire.test.mjs`'s allowed-local-requires set stays as it is.
- Call order is unchanged (producer id minted, then contract revision, then the key derived), so the emit differs only in those lines of `cmdAdmit`.

### Build manifest `plugin/skills/faff/build-manifest.json`

```
RECORD BuildManifest:                        # JSON, top-level keys in this order
  schema: 1
  compiler: RECORD { name: "typescript", version: String, integrity: String }
                                             # from package-lock.json packages["node_modules/typescript"]
  config: Map<Path, Sha256>                  # exactly { "tsconfig.json": … }
  lock: Map<Path, Sha256>                    # exactly { "package-lock.json": …, "package.json": … }
  inputs: Map<Path, Sha256>                  # every literal ".ts" entry of tsconfig include
  outputs: Map<Path, Sha256>                 # the ".js" sibling of each input
  output_digest: Sha256                      # see compute_manifest step 6

  Path    = POSIX path relative to plugin/skills/faff
  Sha256  = lowercase hex SHA-256 of the file's raw bytes
  CONSTRAINT map keys sorted by code-unit order; no timestamps, hostnames or absolute paths
  CONSTRAINT serialised as JSON with 2-space indent, LF line endings, one trailing newline
```

### Writer `plugin/skills/faff/scripts/build-manifest.js`

CommonJS, Node built-ins only (`node:fs`, `node:path`, `node:crypto`).

```
EXPORTS:
  computeManifest(pkgDir) -> BuildManifest      # throws Error naming the cause on any gap
  serialiseManifest(manifest) -> String
  installedCompilerVersion(pkgDir) -> String | null   # node_modules/typescript/package.json version

CLI: node scripts/build-manifest.js <mode>      # pkgDir = the working directory (npm run sets it to plugin/skills/faff)
  write  -> exit 0 after writing build-manifest.json; exit 1 with a message on any error
  check  -> exit 0 when the committed file equals serialiseManifest(computeManifest(.)) byte for byte;
            exit 1 naming each differing key otherwise
  other  -> exit 2 with a usage line
```

`package.json` `scripts.build` becomes `tsc -p tsconfig.json && node scripts/build-manifest.js write`.

## How: behaviour

### Parsing an identity

Every named parser delegates to the one mint, which applies the single runtime rule (a non-empty string, used exactly as given).

```
PROCEDURE parseOpaqueId(kind: IdKind, v: unknown) -> Result<OpaqueId<kind>, IdParseError>:
  1. IF typeof v != "string": RETURN result.err({ kind, reason: "not-a-string", received: typeof v })
  2. IF v.length == 0:         RETURN result.err({ kind, reason: "empty-string", received: "string" })
  3. RETURN result.ok(v asserted as OpaqueId<kind>)   # the only brand assertion in the codebase
```

- No trimming, case folding or normalisation: `" x "` parses to `" x "`, and the returned value is the identical string (`===` the input).
- `"-"` parses successfully as every kind, including `UnitId`. The meaning "no unit" belongs to the record reader, not the parser.
- A type argument on `result.err` (for example `result.err<IdParseError>(…)`) is acceptable where literal-type widening needs it; it is not an assertion and the checker does not flag it.

**Anti-pattern:** a type predicate such as `isUnitId(v): v is UnitId`. Why: a predicate brands a value as effectively as a cast, and the checker cannot see it. Brands come only from the parsers.

**Anti-pattern:** calling `parseUnitId` on a whole record. Why: the parser takes a value; resolving `unit_id` versus `issue` is `effects.js :: unitIdOf`'s job.

### Boundary-cast checker (`scripts/check-no-boundary-cast.mjs`)

- **Scan list.** Replace the hand-kept `REAL_SOURCES` with the literal `.ts` entries of `plugin/skills/faff/tsconfig.json` `include`, resolved against that directory (the same derivation as the CI positive-proof step). Export it as `realSources()`. An `include` with zero literal `.ts` entries is exit 2 with a message. After this change the list is `producer-auth.ts`, `commissaire.ts`, `ids.ts`, `result.ts`.
- **Include coverage.** `include` is still a hand-kept list, and `tsc` type-checks and emits any `.ts` an included file imports even when it is not listed. So `realSources()` also lists every `*.ts` file anywhere under `plugin/skills/faff/bin/lib/` (recursively, so a subdirectory such as `bin/lib/gov/` is covered) and exits 2 naming each one missing from `include`. A new module such as FAFF-1177's `governor.ts` therefore fails the checker until it joins `include`, rather than escaping it. The manifest writer applies the same rule (see `compute_manifest` step 2), so the two cannot disagree.
- **Property 1 (assertions).** The allow-list is keyed by file as well as function name: an assertion is allowed only inside a function named `parseOpaqueId` in `plugin/skills/faff/bin/lib/ids.ts` (matched on the resolved absolute path). An assertion inside a same-named function in any other file is a violation, reported as an unchecked assertion outside the brand mint. The four producer-auth names are removed, because those functions no longer assert. This narrows FAFF-1170's allow-by-name rule for this checker (human decision, 2026-10-06, comment fea753ed); the brands are defined only in `ids.ts`, so no other file needs to mint.
- **Output.** Unchanged from today: on success it prints `check-no-boundary-cast: clean (<N> source(s))` to stdout and exits 0, where `<N>` is the number of files checked (4 after this change); on violations it prints each to stderr and exits 1.
- **Property 2 (boundary readers).** Unchanged.
- **Property 3 (typed requires).** Generalise from `./producer-auth` to a table:

| Module specifier | Required binding type |
|---|---|
| `./producer-auth` | `ProducerAuthApi` |
| `./ids` | `IdsApi` |
| `./result` | `ResultApi` |

For each specifier a file requires, the `require` call's parent must be a variable declaration whose type annotation names the table's type, and the file must have an `import type … from` the same specifier. The existing message text for `./producer-auth` (which names `ProducerAuthApi`) stays, so the existing `require-untyped.ts` assertion keeps matching.

### Build manifest

The manifest binds what produced the emit (compiler identity, configuration, toolchain lock, source digests) to what was produced (emit digests). `git diff` alone proves the emit matches the source; it does not record which compiler made it.

```
PROCEDURE compute_manifest(pkgDir):
  1. cfg = parse JSON of pkgDir/tsconfig.json
  2. entries = cfg.include filtered to strings ending ".ts"
     IF entries is empty: throw "tsconfig include has no literal .ts entries"
     IF cfg.include has any non-".ts" entry: throw naming the entry
     FOR each *.ts file anywhere under pkgDir/bin/lib (recursive) not in entries:
       throw "<path> is not in tsconfig include; add it so it is checked and recorded"
  3. lock = parse JSON of pkgDir/package-lock.json
     ts = lock.packages["node_modules/typescript"]
     IF ts missing or ts.version / ts.integrity not strings: throw "package-lock.json has no typescript entry"
  4. FOR each entry: inputs[entry] = sha256(bytes(entry))
                     js = entry with ".ts" replaced by ".js"
                     IF js missing: throw "missing emit <js> for <entry>; run npm run build"
                     outputs[js] = sha256(bytes(js))
  5. config = { "tsconfig.json": sha256 }, lock = { "package-lock.json": sha256, "package.json": sha256 }
  6. output_digest = sha256 of the UTF-8 string formed by, for each outputs key in sorted order,
                     "<path>\t<sha256>\n"
  7. RETURN { schema: 1, compiler: { name: "typescript", version: ts.version, integrity: ts.integrity },
              config, lock, inputs, outputs, output_digest }

PROCEDURE write_mode(pkgDir):
  1. installed = installedCompilerVersion(pkgDir)
  2. IF installed is null: exit 1 "typescript is not installed; run npm ci"
  3. m = compute_manifest(pkgDir)                       # errors -> exit 1 with the message
  4. IF installed != m.compiler.version:
       exit 1 "installed typescript <installed> does not match package-lock.json <version>; run npm ci"
     installedIntegrity = node_modules/.package-lock.json packages["node_modules/typescript"].integrity (written by npm ci / npm install)
     IF installedIntegrity is missing or != m.compiler.integrity:
       exit 1 "installed typescript integrity does not match package-lock.json; run npm ci"
  5. write serialiseManifest(m) to pkgDir/build-manifest.json; exit 0
```

`check` mode and the unit test never read `node_modules`, so they run in the Node 20 unit lane, which does not install the toolchain.

### CI `typecheck` job (`.github/workflows/validate.yml`)

Extend the inline script in the existing step "Remove each tsconfig include entry's committed .js emit (positive-proof setup)". Add no new step, so the rung set `test/gates-ci-source.test.mjs` pins on Linux does not change.

```
after the existing per-entry .js removal and its removed === 0 guard:
  IF build-manifest.json does not exist:
     print "::error::no committed build-manifest.json; run npm run build and commit it"; exit 1
  remove build-manifest.json; print "removed build-manifest.json"
```

The next steps already do the rest: `npm run build` must regenerate the manifest, and the path-less `git diff --exit-code` fails on a stale manifest (content differs) or on a build that no longer writes one (the deletion shows). The job's Node 24 full-suite step and every unit lane also run `test/build-manifest.test.mjs`.

### Technical design (`TECHNICAL-DESIGN-v5.md`)

- Identity types block: `type WorkItemId = OpaqueId<"WorkItemId">;` becomes `type UnitId = OpaqueId<"UnitId">;`, and add `type ProducerId = OpaqueId<"ProducerId">;` after `ContractRevisionId`.
- Identity table: the row label "Work-item ID" becomes "Unit ID"; scope and reuse text unchanged.
- Record envelope: `readonly workItemId?: WorkItemId;` becomes `readonly unitId?: UnitId;`.
- No other line changes.

### `AGENTS.md`

In "TypeScript source and the committed emit", the instruction after the build command says to commit the regenerated `.js` and `build-manifest.json` alongside the `.ts`.

### Edge cases

- `parseX(undefined | null | 0 | true | {} | [] | Symbol())` returns `err` with `reason: "not-a-string"` and `received` set to `typeof`; it never throws.
- `asProducerId("")` throws `TypeError("asProducerId: expected a non-empty string, got string")`, as today.
- A `.ts` added to `include` without a committed `.js`: `compute_manifest` throws (build fails after `tsc`), and `faff regions check` already exits 2 with `EMIT-MISSING`.
- A hand-edited committed `.js`, or a source edit committed without rebuilding: `test/build-manifest.test.mjs` fails in every lane, and the CI rebuild plus `git diff` fails.
- A contributor whose installed `typescript` differs from the lockfile: `npm run build` exits 1 at the manifest step, asking for `npm ci`.
- `tsc` reports a type error: `&&` stops the build before the manifest is written, so an old manifest is never paired with a new emit by the build.

### Failure modes

- **The failure:** the manifest adds no detection beyond the existing rebuild-and-diff gate. **How you'd know:** in the `typecheck` job, every manifest failure coincides with an emit diff. **What it means:** proceed. The manifest's distinct value is recording the compiler identity and lockfile binding the technical design requires, and its unit test catches stale emits in the lanes that never run `tsc`.
- **The failure:** a future id shape in a newly committed record breaks a parser. **How you'd know:** `test/ids.test.mjs`'s frozen-record sweep fails on that commit. **What it means:** the rule stays permissive; if a later ticket tightens it, the sweep is the guard.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given every committed schema:3 record (git ls-files '*.jsonl', records whose schema is 3)
When each run_id, producer_id, payload.producer_id, contract_revision, payload.contract_revision,
     unit_id and issue value is passed to the matching parser
Then every result is ok and its value is the identical input string,
 and the sweep saw at least one value for each of those seven fields
 and saw "-" under both unit_id and issue
```

```
Given producer-auth after the change
When asProducerId("") and asContractRevisionId(42) are called
Then each throws TypeError with the message it threw before the change
 ("asProducerId: expected a non-empty string, got string",
  "asContractRevisionId: expected a non-empty string, got number"),
 and tryAsProducerId(42) returns null while tryAsProducerId("P1") returns "P1"
```

```
Given a committed build-manifest.json that matches the tree
When one committed .js emit under the include set changes by one byte without a rebuild
Then computeManifest(...) differs from the committed manifest in outputs and output_digest,
 node scripts/build-manifest.js check exits 1 naming those keys,
 and the typecheck job's git diff step fails
```

```
Given a package.json whose build script no longer runs the manifest writer
When the typecheck job's positive-proof step and npm run build run
Then git diff --exit-code reports build-manifest.json as deleted and the job fails
```

```
Given a TypeScript fixture that passes a RunId where a UnitId is required, and a raw string where a UnitId is required
When tsc --noEmit runs over it with the project's settings
Then tsc reports exactly two TS2345 diagnostics
```

Constraints:

- `plugin/skills/faff/package.json` has no `dependencies` block; `package-lock.json` is byte-identical to before.
- `ids.js` requires only `./result`; `result.js` requires nothing; neither requires a `node:` module or a package.
- `commissaire.js`'s set of local `require` specifiers is unchanged.
- `scripts/check-no-boundary-cast.mjs` reports zero violations across `realSources()`.

## Design decision rationale

**Where do the identities and the result helper live?** Options: one module holding both; two modules; `producer-auth.ts` keeps its brands and a new module holds the rest. One module mixes an identity concern with a general control-flow helper that FAFF-1177's handlers will use for decisions unrelated to ids. Leaving brands in `producer-auth.ts` keeps two homes.
**Chosen:** two governance-region modules, `bin/lib/ids.ts` and `bin/lib/result.ts`. Governance lets factory modules (`commissaire`, a future governor) and governance modules (`producer-auth`) both require them under the direction lint; shared-infra was ruled out because `ids` requires `result`, and shared-infra may require no local module.

**What runtime rule does each parser apply?** Options: today's non-empty-string rule for every kind; per-kind patterns from the observed shapes; non-empty plus a length or control-character limit. Committed `schema:3` records hold run ids like `RUN-SMOKE` and `run-<digits>-<digits>-graft-DEMO-<n>`, producer ids like `bare-claude` and `P1`, contract revisions like `r1`, and the unit `"-"`. The facade v0.2 schemas type every one as a plain string with no pattern.
**Chosen:** a non-empty string, used exactly as given, for all nine kinds. It matches the existing mint contract and the published schema, and accepts every frozen shape. Stricter rules are listed under out of scope.

**Does `parseUnitId` accept the admission sentinel `"-"`?** Options: accept it; reject it and add a separate sentinel type. Rejecting would fail 28 committed admission records, and `effects.js :: unitIdOf` and `matchesUnit` already treat `"-"` as an ordinary unit string.
**Chosen:** accept it. The parser validates a value; `unitIdOf` stays the record-level read and is unchanged.

**What form do the parsers take?** Options: throwing `as*` plus nullable `tryAs*` per kind (the FAFF-1170 pair); a closed `Result` per kind; a single generic `parseId(kind, v)` export. The ticket asks for a result helper and the technical design asks handlers to exhaust closed unions. A single generic export makes call sites stringly typed.
**Chosen:** one named `Result`-returning parser per kind, plus `ID_KINDS`. `producer-auth`'s four mints stay as thin delegates so `ProducerAuthApi` and every caller are unchanged.

**Where is the one brand assertion?** Options: one assertion per named parser (nine allow-listed names); one internal mint. Nine names widen the by-name allow-list for no benefit.
**Chosen:** the internal `parseOpaqueId` in `bin/lib/ids.ts` holds the only assertion, and the allow-list admits that function in that file only (human decision, 2026-10-06, comment fea753ed). The four producer-auth names leave the allow-list because their bodies no longer assert.

**Does `ids` use the result helper at runtime or only its types?** Options: construct `{ ok, value }` literals in `ids.ts` with a type-only import; call `result.ok` / `result.err` through a typed require. Literals duplicate the constructors, and a typed require gives the new `ResultApi` row of the checker table a real source to check.
**Chosen:** a typed runtime require of `./result` from `ids.ts`.

**Does `producer-auth.ts` re-export the moved brand types?** Options: `export type { ProducerId, ContractRevisionId } from "./ids"`; no re-export. A repo search finds no importer of those types from `./producer-auth`, and a re-export would leave two import paths for one brand.
**Chosen:** no re-export; importers use `./ids`.

**How does `commissaire.ts` use the shared types?** Options: no change (it already gets the brands through `ProducerAuthApi`); call the `ids` parsers directly; a type-only import with annotated locals in `cmdAdmit`. Calling `ids` directly adds a runtime require that `test/commissaire.test.mjs`'s allowed-requires set would reject and widens the diff FAFF-1176 rebases over. No change leaves `commissaire.ts` naming no brand, which the ticket's done criteria and the FAFF-1170 design both expected it to.
**Chosen:** `import type { ProducerId, ContractRevisionId } from "./ids"` and two annotated locals in `cmdAdmit`. The diff is one import line and three lines of `cmdAdmit`, with no runtime behaviour change. FAFF-1176 edits the governor read paths, not `cmdAdmit`.

**How does the checker find its sources and typed requires?** Options: extend the hand-kept `REAL_SOURCES` list and add an `./ids` special case; derive sources from tsconfig `include` and drive property 3 from a table. A hand-kept list lets a new `.ts` (FAFF-1177's `governor.ts`) skip the check silently.
**Chosen:** derive sources from tsconfig `include` (exported as `realSources()`), refuse any `bin/lib/*.ts` that `include` omits (the same rule the manifest writer applies, so a module `tsc` reaches only through an import cannot escape either gate), and drive property 3 from the specifier-to-type table above.

**Where does the manifest live and what does it contain?** Options: JSON beside `tsconfig.json`; a file under `bin/`; a section inside `package.json`. `bin/` is the runtime artifact, and writing to `package.json` during a build makes the build edit one of its own inputs.
**Chosen:** `plugin/skills/faff/build-manifest.json`, deterministic JSON with the fields in the `BuildManifest` record: compiler name, version and lockfile integrity; digests of `tsconfig.json`, `package.json` and `package-lock.json`; per-file input and output digests; one output digest. Node's own version is excluded because it varies between contributors and does not change the emit.

**Where does the manifest writer live?** Options: repo-root `scripts/` beside the boundary checker; inside the package at `plugin/skills/faff/scripts/`. A repo-root script would make `npm run build` reach outside its package (`../../../scripts/…`) and fail in a marketplace copy that has the toolchain installed.
**Chosen:** `plugin/skills/faff/scripts/build-manifest.js`, CommonJS with Node built-ins only, chained after `tsc` in `scripts.build`. It ships with the package and is dependency-free, which keeps the shipped-artifact rule.

**Where does the compiler version come from?** Options: the installed `node_modules/typescript`; the lockfile; both. Reading only the installed copy makes the manifest uncomputable in lanes without `node_modules`; reading only the lockfile cannot detect a contributor building with a drifted install.
**Chosen:** record the lockfile's version and integrity, and have `write` mode refuse to write when the installed version differs.

**How does CI fail on a stale manifest?** Options: a new `check` step in the `typecheck` job; extend the positive-proof step to delete the manifest and rely on rebuild plus `git diff`; a unit test only. A new `run:` line would change the rung set `test/gates-ci-source.test.mjs` pins on Linux. A unit test alone cannot catch a build that stopped writing the manifest while a stale committed one still matches.
**Chosen:** extend the positive-proof step's inline script (require and delete the committed manifest) and add `test/build-manifest.test.mjs`, which recomputes the manifest from committed files in every lane.

**How far does the technical design rename go?** Options: rename only the type alias; rename the alias, envelope field and table row; rename every "work item" occurrence. Addendum decision 6 renamed only the record key, and the prose noun and stream type are wider vocabulary questions.
**Chosen:** rename the type alias, the envelope `references` field (`unitId?: UnitId`) and the identity table row label, and add `ProducerId` to the type block so the design's list matches `ids.ts`.

## Open questions and assumptions

**Open questions.** None.

**Assumptions.**

- **Assumes:** FAFF-1176 does not edit `cmdAdmit` or the import lines at the top of `commissaire.ts`. Its tracker description (read 2026-10-06) scopes it to a new `contract status` read verb, a chokepoint-key resolver for `merge-gate.js`, and `verifyAuthLeg`. Validation: before starting, re-read FAFF-1176's description and attached spec; if either now names `cmdAdmit`, keep this ticket's `commissaire.ts` diff to the import line and leave `cmdAdmit` unchanged.

## Done

### From why

- [ ] `grep -n "OpaqueId<\|unique symbol" plugin/skills/faff/bin/lib/*.ts` matches only `ids.ts`.
- [ ] `plugin/skills/faff/bin/lib/producer-auth.js` keeps the same `module.exports` key set as before, asserted in `test/ids.test.mjs` against the literal list in `producer-auth.ts` lines 268 to 275 on `main`.

### From what (types and interfaces)

- [ ] `bin/lib/ids.ts` and `bin/lib/ids.js` exist, carry a `region:governance` banner matching `REGION_TAG_RE` in `regions.js`, and export the nine brand types, `IdKind`, `IdParseError`, `IdsApi`, `ID_KINDS` and the nine `parse<Kind>` functions.
- [ ] `bin/lib/result.ts` and `bin/lib/result.js` exist, carry a `region:governance` banner, and export `Ok`, `Err`, `Result`, `ResultApi`, `ok`, `err`, `assertNever`.
- [ ] `tsconfig.json` `include` lists `bin/lib/ids.ts` and `bin/lib/result.ts` alongside the existing two entries.
- [ ] `producer-auth.ts` imports `ProducerId`, `ContractRevisionId` and `IdsApi` type-only from `./ids`, binds `const ids: IdsApi = require("./ids")`, and contains no `as` expression.
- [ ] `commissaire.ts` differs from `main` only by the `import type { ProducerId, ContractRevisionId } from "./ids"` line and the three `cmdAdmit` lines in the "commissaire.ts after the change" block; `commissaire.js` differs only in the corresponding emitted lines.
- [ ] `build-manifest.json` is committed, matches the `BuildManifest` record, and its `compiler.version` equals `package-lock.json`'s `node_modules/typescript` version.
- [ ] `package.json` `scripts.build` is `tsc -p tsconfig.json && node scripts/build-manifest.js write`; there is no `dependencies` block; `package-lock.json` is unchanged.

### From how (behaviour)

- [ ] `test/ids.test.mjs`: for each kind in `ID_KINDS`, `parse<Kind>` accepts `"RUN-SMOKE"`, `"run-20261004-153223-graft-FAFF-1170-1"`, `"FAFF-1167"`, `"-"`, `"bare-claude"`, `"P1"`, `"faff-runner-v1"`, `"r1"`, `"U1"` and `" x "`, returning `ok: true` with `value === input`.
- [ ] `test/ids.test.mjs`: for each kind, `undefined`, `null`, `0`, `true`, `{}`, `[]` return `ok: false` with `error.kind` equal to the kind, `reason: "not-a-string"` and `received` equal to `typeof`; `""` returns `reason: "empty-string"`.
- [ ] `test/ids.test.mjs`: the frozen-record sweep scenario passes over `git ls-files '*.jsonl'`.
- [ ] `test/ids.test.mjs`: the producer-auth delegate scenario passes with the exact messages.
- [ ] `test/result.test.mjs`: `ok(1)` deep-equals `{ ok: true, value: 1 }`, `err("e")` deep-equals `{ ok: false, error: "e" }`, and `assertNever` throws an `Error` whose message starts with the given context and contains the JSON form of the value; for a value whose `JSON.stringify` is not a string (`undefined`, a function) or throws (`10n`), the message contains its `typeof` instead.
- [ ] `scripts/check-no-boundary-cast.mjs` exports `realSources()`, derived from tsconfig `include`, returning the four `.ts` paths; the assertion allow-list admits only `parseOpaqueId` in `plugin/skills/faff/bin/lib/ids.ts`; property 3 covers `./producer-auth`, `./ids` and `./result`.
- [ ] `test/check-no-boundary-cast.test.mjs`: against a temp package directory, `realSources()` exits 2 naming the file when a `bin/lib/*.ts` is absent from `include`, and exits 2 when `include` has no literal `.ts` entry.
- [ ] `test/build-manifest.test.mjs`: in a temp copy, a `bin/lib/extra.ts` or `bin/lib/sub/extra.ts` absent from `include` makes `computeManifest` throw naming that path; with `node_modules/typescript` absent, `write` exits 1 with "typescript is not installed; run npm ci" and writes nothing.
- [ ] `test/ids.test.mjs`: `Object.keys(require("…/ids.js"))` equals `ID_KINDS` plus the nine parser names, so `parseOpaqueId` is not exported.
- [ ] `test/check-no-boundary-cast.test.mjs` uses `realSources()` for the real-sources case; new fixtures `require-ids-untyped.ts` (an untyped `require("./ids")`, violation names `IdsApi`) `cast-in-retired-mint.ts` (an `as` inside a function named `asProducerId`, now a violation) and `cast-in-foreign-mint.ts` (an `as` inside a function named `parseOpaqueId` in a file that is not `bin/lib/ids.ts`, now a violation) are in the planted list; `clean.ts` contains no assertion, uses typed requires of `./producer-auth`, `./ids` and `./result`, and stays violation-free; the real `ids.ts` passes with its one assertion.
- [ ] `test/fixtures/ts-ids-negative/` (own `tsconfig.json` extending the project one, as `ts-brand-negative` does) plus a case in `test/ts-brand-negative.test.mjs` assert exactly two `TS2345` diagnostics for the brand-distinctness scenario.
- [ ] `test/build-manifest.test.mjs` (pure fs, no `typescript`): the committed manifest equals `serialiseManifest(computeManifest(pkgDir))` byte for byte; in a temp copy, a one-byte `.js` change makes `outputs` and `output_digest` differ and `check` exit 1; a missing emit makes `computeManifest` throw naming the file; a planted installed version unequal to the lockfile makes `write` exit 1 without writing; a planted `node_modules/.package-lock.json` whose typescript `integrity` differs from the lockfile makes `write` exit 1 without writing.
- [ ] The `typecheck` job's positive-proof step fails when `build-manifest.json` is absent and deletes it when present; no new step is added.
- [ ] `TECHNICAL-DESIGN-v5.md` has `type UnitId = OpaqueId<"UnitId">;`, `type ProducerId = OpaqueId<"ProducerId">;`, a "Unit ID" table row and `readonly unitId?: UnitId;`, and no `WorkItemId` / `workItemId`.
- [ ] `AGENTS.md` tells contributors to commit `build-manifest.json` with the regenerated `.js`.

### From how (edge cases and guards)

- [ ] `node plugin/skills/faff/bin/faff regions check` exits 0.
- [ ] `test/commissaire-standalone.test.mjs`, `test/emit-coverage.test.mjs`, `test/commissaire.test.mjs`, `test/commissaire-unit-id.test.mjs` and `test/gates-ci-source.test.mjs` pass unchanged.
- [ ] `plugin/skills/faff/bin/lib/effects.js` is unchanged.
- [ ] From `plugin/skills/faff`: `npm ci && npm run build` followed by `git status --porcelain` from the repo root prints nothing.
- [ ] Every commit carries a `Signed-off-by` trailer.

### Integration smoke test

```
PROCEDURE smoke:
  1. cd plugin/skills/faff; npm ci; npx tsc --noEmit -p tsconfig.json         -> exit 0
  2. delete bin/lib/{ids,result,producer-auth,commissaire}.js and build-manifest.json
  3. npm run build                                                            -> exit 0
  4. git diff --exit-code (repo root)                                         -> exit 0
  5. node scripts/build-manifest.js check                                     -> exit 0
  6. node ../../../scripts/check-no-boundary-cast.mjs                         -> "clean (4 source(s))"
  7. node bin/commissaire admit --run-dir <an existing empty temp dir> --producer P1
          --contract-revision r1 --scope merge                               -> exit 0, stdout keys
                                                                                admitted, producer_id, admitted_scope,
                                                                                pk_fingerprint, governor_dir, producer_dir
  8. node --test test/ids.test.mjs test/result.test.mjs test/build-manifest.test.mjs
                 test/check-no-boundary-cast.test.mjs test/ts-brand-negative.test.mjs  -> all pass, 0 skipped
```

### Files the build touches

| File | Change |
|---|---|
| `plugin/skills/faff/bin/lib/ids.ts`, `ids.js` | New |
| `plugin/skills/faff/bin/lib/result.ts`, `result.js` | New |
| `plugin/skills/faff/bin/lib/producer-auth.ts`, `producer-auth.js` | Brands removed, mints delegate to `./ids` |
| `plugin/skills/faff/bin/lib/commissaire.ts`, `commissaire.js` | One import line, three lines in `cmdAdmit` |
| `plugin/skills/faff/tsconfig.json` | Two `include` entries |
| `plugin/skills/faff/package.json` | `scripts.build` |
| `plugin/skills/faff/scripts/build-manifest.js` | New |
| `plugin/skills/faff/build-manifest.json` | New, generated |
| `scripts/check-no-boundary-cast.mjs` | Sources from tsconfig, one mint, typed-require table |
| `test/check-no-boundary-cast.test.mjs`, `test/fixtures/boundary-cast/clean.ts` | Updated |
| `test/fixtures/boundary-cast/require-ids-untyped.ts`, `cast-in-retired-mint.ts`, `cast-in-foreign-mint.ts` | New |
| `test/ts-brand-negative.test.mjs` | New case |
| `test/fixtures/ts-ids-negative/tsconfig.json`, `ids-negative.ts` | New |
| `test/ids.test.mjs`, `test/result.test.mjs`, `test/build-manifest.test.mjs` | New |
| `.github/workflows/validate.yml` | Positive-proof inline script only |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | Identity block, table row, envelope field |
| `AGENTS.md` | Commit the manifest with the emit |

## Revision note

Revised 2026-10-06 after spec review. Round 1 (architectural, minor): `include` coverage rule added. Round 2 (architectural and QA, minor each): coverage made recursive under `bin/lib`, and the checker's success output stated. Round 3 (architectural minor, two infosec minors): `assertNever` no longer throws on a `BigInt`, and `write` now checks the installed compiler integrity as well as its version. The third round-3 minor (scoping the `parseOpaqueId` allow-list to `ids.ts`) is folded in by human decision (2026-10-06, comment fea753ed): accept and build with the mint limited to `ids.ts`, no further spec-review round.

## Methodology critique

### Right-sized?

**What's there.** FAFF-1180 is labelled Size: S, but the spec touches about 25 files, has 25 done criteria and rates itself `build-tier: complex`. It covers two concerns that don't depend on each other:
- the shared identities and result helper, plus the changes they force (producer-auth and commissaire rewiring, the boundary-cast checker update, the technical design rename);
- the build manifest (a writer script, `build-manifest.json`, the CI freshness check and the AGENTS.md note).

**Why it matters.** FAFF-1177 (governor process) needs only the first concern. While both sit in one ticket, the governor work waits on manifest and CI changes it never uses, and the Size: S label makes the ticket look smaller than it is.

**What to do.** Split the build manifest into its own ticket under the same project. Keep FAFF-1180 to identities, the result helper and the checker, so it alone blocks FAFF-1177. Resize whatever remains after the split.

### Workstream fit?

No issues. Both concerns serve the project's outcome, "The commissaire binary ships from a fully type-checked import closure".

### Deps surfaced?

**What's there.** The spec's assumptions and the operator constraint require FAFF-1176 (route governor reads through the facade) to be built after this ticket merges, because both edit `commissaire.ts`. The only recorded links are "blocked by FAFF-1167" and "blocks FAFF-1177". FAFF-1180 has no link to FAFF-1176.

**Why it matters.** Without a blocker link, automation can pick up FAFF-1176 first, and then the confined `cmdAdmit` diff this spec depends on no longer holds.

**What to do.** Add "FAFF-1180 blocks FAFF-1176". If the order turns out not to matter, drop the FAFF-1176 assumption from the spec.

### Risk profile?

No issues. The new hard step in `npm run build` (refusing to build when the installed compiler doesn't match the lockfile) is the riskiest change. The spec covers it with a clear error message, a holdout scenario and a failure-modes entry. Splitting the manifest out, as suggested above, would also contain this risk in its own ticket.

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
