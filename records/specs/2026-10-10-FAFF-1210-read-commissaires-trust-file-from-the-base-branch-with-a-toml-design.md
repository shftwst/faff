# FAFF-1210 — Commissaire trust file and its base-branch TOML-subset reader

> Spec: faffter-dark-nlspec · 2026-10-10 · revised 2026-10-10 (spec-review r1) r2-fixes · interactive · claude-code/unknown · build-tier: complex · confidence: high. Full spec on Linear FAFF-1210.

This spec describes the `.commissaire/trust.toml` file, a dependency-free parser for the strict TOML subset it is written in, schema-1 validation of the parsed result, and a reader that takes the file only from the base branch's committed history. It is written for the build agent that will implement the module and for the human reviewers who gate it. The output is a library — a parser plus a reader — with no CLI command of its own; Commissaire's existing facade and the independence verifier (FAFF-1178) are the callers.

ADR 0135 decision 11 is Accepted and binding. This spec implements it; it does not re-open the file name, the schema-1 key table, the accepted/refused grammar, or the reading rules. Where decision 11 settles a question, the marker below is `**Chosen:**` and cites the ADR.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** Commissaire decides whether to trust a governor's key. That decision must rest on a list no runner can edit for itself. The trust file is that list, and its only trustworthy copy is the one committed to the base branch — the branch a runner cannot push to directly under branch protection. So the parser and the reader exist to turn committed bytes on the base branch into a validated set of pins, and to fail closed (never "no pins") the moment those bytes are anything other than a valid schema-1 file.

**Problem statement.** Commissaire's pins (`governor_key_fingerprints`, the strict-mode switch, the change approvers) have no committed home and no reader today. Without one, there is nothing to pin a governor's key against, and nothing stops a runner from asserting its own trust. This change adds the committed file, a strict parser for its format, schema validation, and a base-branch-only reader that reports where it read from.

**Design principles.**

**Fail closed, never fall back to "no pins".** A missing file means zero-config (no pins, strict off, no approvers). Everything else — malformed bytes, an invalid schema, an unknown key, a `git show` that errors for any reason other than "file absent", a remote read whose 404 cannot be *proven* to mean "file absent on a reachable, authorized repo" — is `trust-file-invalid`, not an empty pin set. A silent fall-back to "no pins" would let a corrupt or truncated file, or an unreachable/forbidden repo, disable strict mode, which is the exact failure the pins exist to prevent.

**No local override of any kind.** The reader takes the file only from committed history via `git show <ref>:.commissaire/trust.toml`. It never reads the working tree, never reads a `trust.local.toml`, never consults an environment variable or a flag. A runner can write any working-tree file and set any variable in its own environment, so any override would let it trust its own key.

**Zero runtime dependencies in the shipped closure.** The parser is a built-in, following the `parseYamlSubset` precedent, with no `require` edge outside `node:*` and the governance region. The strictness is *in* the parser (line-numbered refusals), unlike `parseYamlSubset`, which never throws. A full TOML library appears only as a test-only devDependency and must never enter the shipped require closure.

**Import independence from faff's orchestration.** The module must not import `config.js`, `readGovernanceConfig`, `merge-gate.js`, `bundle.js`, or any orchestration module on the standalone denylist. It carries its own small `git`/`gh` wrappers rather than borrowing ones that reach those modules.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/result.ts` | TypeScript | Closed `Ok`/`Err` `Result<T,E>` + `assertNever`; the return shape this module adopts |
| `plugin/skills/faff/bin/lib/ids.ts` | TypeScript | Validating parsers that take `unknown` and return a `Result`; the nearest in-repo model |
| `plugin/skills/faff/bin/lib/shared-infra.js` (`parseYamlSubset` :358) | JavaScript | The dependency-free built-in parser precedent — but forgiving, never throwing; this parser is the strict counterpart |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript | Region banner + require-direction lint; governance may require `shared-infra` and `node:*`, never `factory` |
| `records/adr/0135-*.md` decision 11 | Markdown | Binding source of the file name, schema-1 table, grammar, and reading rules |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | Precedent for `git show <sha>:<path>`, `gh api` Contents reads, and the FAFF-747 headers-only HTTP-status probe — a precedent to mirror, never to import |
| `test/commissaire-standalone.test.mjs` | JavaScript (.mjs) | The import-independence guard + tainted-fixture pattern this module extends |

**Scope.** This is the trust-file library for the Commissaire governance region: the file format, its parser, schema-1 validation, the base-branch reader, and the read-source label. It sits below the governor and the independence verifier, which consume it.

---

## 2. OUT OF SCOPE

- **Independence counting and the `not-counted` reason vocabulary.** Deciding whether a run counts as independent from the source label. *Why excluded:* belongs to FAFF-1178 (the verify function) and FAFF-1213 (branch-protection / bypass-actor policy). *Extension point:* the verifier reads this module's returned `source` label (`remote-base` vs `local-ref`) and decides counting itself.
- **Branch-protection and bypass-actor checks via `gh api .../rules/branches/...`.** *Why excluded:* decision 11 assigns the protection check to FAFF-1213 and notes the endpoint cannot prove the caller has no bypass. *Extension point:* a sibling function in a later ticket, calling `gh api` the same way this module's remote read does.
- **Consuming the pins (key verification, strict-mode enforcement, approver checks).** *Why excluded:* this ticket delivers the validated data, not the governor logic that acts on it. *Extension point:* the governor facade (`commissaire.ts`, region factory) calls `readTrustFile` and applies the result.
- **Schemas beyond 1 (tables, dotted keys, richer types).** *Why excluded:* decision 11 fixes schema 1 and defers tables to a later schema. *Extension point:* a `schema = 2` branch in the validator and a widened grammar, when a future ticket needs it.
- **Writing or editing the trust file.** *Why excluded:* the file is human-edited and committed; this is a reader. *Extension point:* none planned — edits go through a normal reviewed PR.
- **Moving existing pins out of `.faffrc.yaml`.** *Why excluded:* no pins live there today (only the ADR mentions them), so there is nothing to migrate. *Extension point:* n/a.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Trust file | `.commissaire/trust.toml`, committed, holding the pins and strict-mode switch |
| Pin | A `governor_key_fingerprints` entry: 64 lowercase hex chars (the format `pkFingerprint` produces) |
| Strict mode | `require_pinned_governor = true`: refuse any grant not signed by a pinned key |
| Base branch | The branch a protected repo merges into; the only trustworthy source of the file |
| Source label | Where a read actually came from: `remote-base` (proven via the forge) or `local-ref` (the local object store) |
| Git-only mode | A run with no remote, or a base branch the runner can push to directly; it reads locally but does not count |

### Parsed value model

The parser produces a plain map of top-level keys to typed values, with no table or nesting. Everything below erases to plain JS in the `.js` emit.

```
ENUM TomlValueKind: String | Integer | Boolean | StringArray

RECORD TomlValue:
  kind: TomlValueKind
  line: Int                 # 1-based source line of this key, so the validator can cite it
  # exactly one payload set, matching kind
  string?: Text
  integer?: Int             # >= 0, fits a safe JS integer
  boolean?: Bool
  stringArray?: List<Text>

RECORD TomlDocument:
  entries: Map<BareKey, TomlValue>   # insertion order preserved; duplicate key is a parse error
```

### Error model (closed, line-numbered)

```
ENUM TrustErrorStage: Parse | Schema | Read

RECORD TrustFileError:
  code: "trust-file-invalid"        # the single public code; callers branch on nothing finer
  stage: TrustErrorStage
  line: Int | null                  # 1-based source line; null only for whole-file schema faults
  reason: Text                      # stable, human-readable, lower-case, no trailing period
  CONSTRAINT message == "trust-file-invalid: line " + line + ": " + reason   # when line != null
  CONSTRAINT message == "trust-file-invalid: " + reason                      # when line == null
```

**Chosen:** one public error code, `trust-file-invalid`, with a `stage`/`line`/`reason` breakdown for diagnostics and a formatted `message`. Rationale: decision 11 requires exactly this code plus a line number; callers only ever need "valid or not", and the stage/reason aid the human reading a refusal. See §6.

### Trust configuration (schema-1 validated result)

```
RECORD TrustConfig:
  schema: 1                              # always 1 in schema-1
  governorKeyFingerprints: List<Hex64>   # default []; each 64 lowercase hex; no duplicates
  requirePinnedGovernor: Bool            # default false
  pinChangeApprovers: List<Text>         # default []; GitHub logins, used verbatim

  CONSTRAINT requirePinnedGovernor == true  IMPLIES governorKeyFingerprints is non-empty
  CONSTRAINT every fingerprint matches /^[0-9a-f]{64}$/
  CONSTRAINT no duplicate fingerprint
```

### Read result (what the reader returns)

```
ENUM TrustSource: remote-base | local-ref

RECORD TrustRead:
  present: Bool                 # false only for the genuine "no file on the ref" case
  config: TrustConfig | null    # null iff present == false (the zero-config case)
  source: TrustSource           # where the bytes actually came from
```

### Public interface

```
INTERFACE CommissaireTrust:

  # Pure parser: bytes -> document or a line-numbered parse error.
  parseTrustToml(text: Text): Result<TomlDocument, TrustFileError>

  # Pure validator: document -> schema-1 config or a schema error.
  validateSchema1(doc: TomlDocument): Result<TrustConfig, TrustFileError>

  # The one reader every caller shares. ref is a branch ref or SHA.
  # transport selects where the bytes come from and decides the source label.
  readTrustFile(args: {
    repoDir: Text,                 # working-copy root, for the local git object store
    ref: Text,                     # e.g. "origin/main" (local) or "main" (remote)
    transport: "local" | "remote", # local => git show; remote => gh api contents
    repoSlug?: Text,               # "owner/name"; required when transport == "remote"
  }): Result<TrustRead, TrustFileError>
```

**Chosen:** a closed `Result<T, E>` return, not thrown exceptions, for all three functions — matching `result.ts`/`ids.ts`. Rationale: the governor and verifier must handle the invalid arm explicitly; a thrown error is easy to swallow into a `catch` that then does "no pins", the exact fall-back decision 11 forbids. See §6.

**Chosen:** one reader, `readTrustFile`, taking an explicit `ref` and `transport`, so the governor and the independence verifier share it (the ticket's open question resolved to "here, behind one function that takes a ref"). Rationale: a single code path means both callers read, decode, parse and validate identically; only the transport and the resulting `source` label differ. See §6.

---

## 4. HOW — Behaviour

### Module placement and build

- **New file:** `plugin/skills/faff/bin/lib/commissaire-trust.ts`, with a committed `.js` sibling (ADR-0132).
- **Region banner (first line):** `// === region:governance — commissaire-trust — FAFF-1210: trust file TOML-subset parser + base-branch reader ===`.
- **Library only, no CLI.** Do not add a `REGION_MAP` entry — that would force a `REGION_SELFTEST_ARGV` and a runnable `--selftest`. Export the interface; the facade dispatches.
- **TS emit wiring:** add the file to `tsconfig.json` `include`, run `cd plugin/skills/faff && npm run build` (tsc + `build-manifest.js write`), and commit the `.js` and regenerated `build-manifest.json` beside the `.ts`.
- **TS style (match the siblings):** `import type { Result, ResultApi } from "./result";` then `const result: ResultApi = require("./result");`; `module.exports = { ... }`; no unchecked `as` at boundaries (the boundary-cast checker); `noUncheckedIndexedAccess` holds, so guard array indexing.
- **Require edges:** only `node:*` (`node:child_process` for `spawnSync`) and, if a helper is genuinely reusable, `./shared-infra`. Never `./config`, `./budget`, `./merge-gate`, `./bundle`, `./prdr`, or any denylisted basename.

**Anti-pattern:** importing `merge-gate.js` for its `git show` / `gh api` / `anchorHttpStatus` helpers. Why: those modules transitively reach the orchestration denylist and would fail the independence guard. This module carries its own minimal wrappers, modelled on merge-gate's shape but copied, not imported.

### The parser

**Summary.** `parseTrustToml` walks the text line by line, classifying each line as blank, comment, or a `key = value` pair, and returns the first refusal it hits with that line's 1-based number. It is strict: anything outside the decision-11 subset is a refusal, never a best-effort skip.

```
PROCEDURE parseTrustToml(text):
  1. IF text begins with a UTF-8 BOM (U+FEFF): error(Parse, line 1, "byte-order mark not allowed")
  2. Split on LF; strip a single trailing CR from each line (accept LF and CRLF).
     A lone CR inside a line (old-Mac CR line ending) is a control char -> refused at step 6/8.
  3. entries := ordered empty map; lines := the split (and CR-stripped) lines
  4. i := 1 (1-based cursor).  WHILE i <= lines.length:
     a. Let t := lines[i] with leading/trailing spaces and tabs trimmed.
     b. IF t is empty: i := i + 1; continue
     c. IF t starts with "#": i := i + 1; continue            # full-line comment
     d. IF t starts with "[": error(Parse, i, "table headers are not allowed")   # covers [x] and [[x]]
     e. Find the first "=" that is not inside a string. IF none: error(Parse, i, "expected key = value")
     f. key := text left of "="; raw := text right of "="
     g. key := trim(key)
        - IF key is empty: error(Parse, i, "missing key")
        - IF key does not fully match /^[A-Za-z0-9_-]+$/: error(Parse, i, "key must be a bare key")
          # a quoted or dotted key fails this regex
        - IF key already in entries: error(Parse, i, "duplicate key")
     h. value, consumed, err := parseValue(lines, i, raw)   # raw still has its trailing comment, if any;
                                                            # a multi-line array reads lines i+1.. and reports how many it spanned
     i. IF err: return err
     j. entries[key] := value (recording line i)
     k. i := i + consumed      # consumed >= 1; advances the cursor PAST every line the value occupied,
                               # so a multi-line array is never re-read as fresh `key = value` lines
  5. return ok({ entries })

PROCEDURE parseValue(lines, i, raw):   # returns (value, consumed, err); consumed = number of lines this value spanned (>= 1)
  1. s := leading-space-trimmed raw
  2. IF s starts with '"':  v, rem, err := parseBasicString(s, i); IF !err: requireTrailingCommentOrEnd(rem, i); return (v, 1, err)
  3. IF s starts with "[":  return parseStringArray(lines, i, s)   # may span lines; returns consumed >= 1
  4. IF s starts with "t" or "f": match exactly true|false, then trailing comment/end; return (v, 1, err)
                                   else error(Parse, i, "invalid boolean")
  5. IF s starts with a digit:    return (parseInteger(scalarToken(s), i), 1)
  6. error(Parse, i, "unrecognised value")

PROCEDURE parseBasicString(s, i):
  1. Require an opening '"'. Scan chars:
     - '\' begins an escape: the next char MUST be '"' or '\'; any other -> error(Parse, i, "unsupported escape")
     - a raw control char (code point < 0x20, or a lone CR/LF/TAB inside the string) -> error(Parse, i, "control character in string")
     - a non-UTF-8 / invalid byte sequence -> error(Parse, i, "invalid utf-8 in string")
     - '"' (unescaped) closes the string
  2. IF the line ends before a closing '"': error(Parse, i, "unterminated string")   # multi-line strings refused
  3. return the decoded text + the remainder after the closing quote

PROCEDURE parseInteger(token, i):
  1. IF token matches /^[+-]/: error(Parse, i, "signed integers are not allowed")
  2. IF token contains "_": error(Parse, i, "underscores are not allowed")
  3. IF token matches /^0x|^0o|^0b/i: error(Parse, i, "only decimal integers are allowed")
  4. IF token matches /\./ or /e/i or looks like a date/time: error(Parse, i, "floats, dates and times are not allowed")
  5. IF token is not /^(0|[1-9][0-9]*)$/: error(Parse, i, "invalid integer")   # refuses "00", "01"; accepts "0"
  6. n := parse decimal token
  7. IF n > Number.MAX_SAFE_INTEGER: error(Parse, i, "integer out of range")
  8. return integer value n

PROCEDURE parseStringArray(lines, i, s):   # returns (list, consumed, err); consumed counts lines i..L inclusive
  summary: accept [ "a", "b" ] on one line or across lines, with # comments
           between elements and an optional trailing comma; elements are basic strings only.
  1. Consume "[". L := i (line the scanner is on). State machine over the remaining chars of line L,
     advancing to further lines as needed:
     - skip spaces/tabs; at end-of-line set L := L + 1 and continue scanning lines[L] (fail if L > lines.length — step 2)
     - "#" starts a comment to end-of-line -> advance to the next line
     - '"' -> parse a basic string element (parseBasicString on line L); push to list; expect "," or "]" next
     - "]" -> close the array
     - "[" -> error(Parse, L, "nested arrays are not allowed")
     - "," without a preceding element, or two "," in a row -> error(Parse, L, "unexpected comma")
     - any other non-space char (digit, t/f, etc.) -> error(Parse, L, "array elements must be strings")
                                                      # this refuses mixed-type arrays
  2. IF the lines run out before "]": error(Parse, i, "unterminated array")
  3. An empty array "[]" is valid -> []
  4. requireTrailingCommentOrEnd(remainder of line L after "]", L)
  5. return (list, consumed = L - i + 1)   # the outer loop advances its cursor by `consumed`,
                                           # so the ADR's own multi-line fingerprint array is accepted, not re-read line by line

PROCEDURE requireTrailingCommentOrEnd(remainder, i):
  - trim spaces/tabs; IF empty -> ok; IF starts with "#" -> ok (trailing comment); else error(Parse, i, "trailing characters after value")
```

**Anti-pattern:** reusing `parseYamlSubset` or its `scalar`/`stripInlineComment` helpers. Why: they are forgiving and never throw, so they would silently coerce or drop malformed input — the opposite of the strict, line-numbered contract here. A `#` inside a quoted string must stay in the string, which the string scanner handles and a naive `stripInlineComment` does not.

### Schema-1 validation

**Summary.** `validateSchema1` turns a parsed document into a `TrustConfig`, refusing unknown keys and enforcing the key table. Whole-file faults that have no single source line (a missing `schema`, strict mode with an empty fingerprint list) carry `line: null` and format without a line number.

```
PROCEDURE validateSchema1(doc):
  1. known := { schema, governor_key_fingerprints, require_pinned_governor, pin_change_approvers }
  2. FOR each key in doc.entries NOT in known:
        error(Schema, entry.line, "unknown key: " + key)
  3. IF "schema" absent: error(Schema, null, "missing required key schema")
  4. IF schema value is not integer 1: error(Schema, entry.line, "schema must be 1")   # refuses 0, 2, non-int
  5. fingerprints := doc["governor_key_fingerprints"] or []
     - IF present and not a string array: error(Schema, entry.line, "governor_key_fingerprints must be an array of strings")
     - FOR each: IF not /^[0-9a-f]{64}$/: error(Schema, entry.line, "fingerprint must be 64 lowercase hex characters")
     - IF duplicates: error(Schema, entry.line, "duplicate fingerprint")
  6. strict := doc["require_pinned_governor"] or false
     - IF present and not boolean: error(Schema, entry.line, "require_pinned_governor must be a boolean")
  7. approvers := doc["pin_change_approvers"] or []
     - IF present and not a string array: error(Schema, entry.line, "pin_change_approvers must be an array of strings")
  8. IF strict == true AND fingerprints is empty:
        error(Schema, require_pinned_governor entry.line, "strict mode requires at least one fingerprint")
  9. return ok({ schema: 1, governorKeyFingerprints: fingerprints, requirePinnedGovernor: strict, pinChangeApprovers: approvers })
```

**Chosen:** whole-file schema faults (missing `schema`) use `line: null` and the no-line message form; faults tied to a present key use that key's recorded line. Rationale: decision 11 requires a line number "with the line number", but a missing key has no line; `null` keeps the contract honest rather than inventing a line. The parser records each key's source line in the document for this purpose. See §6.

### The reader

**Summary.** `readTrustFile` fetches the committed bytes for `ref`, decodes them, and runs the parser then the validator. A genuinely absent file is the only non-error "no config" outcome; every other failure — including a remote read whose 404 cannot be proven to mean "absent on a reachable, authorized repo" — is `trust-file-invalid`. The transport decides the `source` label.

```
PROCEDURE readTrustFile({ repoDir, ref, transport, repoSlug }):
  1. IF transport == "local":
       bytes, status := gitShow(repoDir, ref, ".commissaire/trust.toml")
       source := "local-ref"
     ELSE  # "remote"
       bytes, status := ghApiContents(repoSlug, ref, ".commissaire/trust.toml")
       source := "remote-base"
  2. IF status == FileAbsent:                 # path proven absent on a reachable, authorized tree
       return ok({ present: false, config: null, source })   # the only "no pins" path
  3. IF status == OtherFailure:               # bad ref, shallow clone, network, auth, no-access, non-zero exit, ambiguous 404
       error(Read, null, "could not read trust file from " + source + ": " + detail)
  4. text := decodeUtf8(bytes)
  5. parsed := parseTrustToml(text);      IF parsed is Err: return parsed
  6. config := validateSchema1(parsed.value); IF config is Err: return config
  7. return ok({ present: true, config: config.value, source })

PROCEDURE gitShow(repoDir, ref, path):
  r := spawnSync("git", ["-C", repoDir, "show", ref + ":" + path], { encoding: "buffer" })
  IF r.status == 0: return (r.stdout, Ok)
  IF stderr matches /does not exist|exists on disk, but not in|path .* does not exist/: return (_, FileAbsent)
  return (_, OtherFailure with stderr detail)
```

**gitShow is the pinned side and is left exactly as above.** The local object store is content-addressed: `git show <ref>:<path>` reads the committed blob, and a non-zero exit whose stderr is not a recognised "path does not exist" phrasing is already `OtherFailure` (fail closed). The remote side cannot borrow this shape, because `gh`'s stderr text is not a contract and GitHub returns an indistinguishable 404 for path-absent, repo-not-found, no-access, and (at the HTTP layer) some auth failures. So the remote read is detected by HTTP status, fail-closed, below.

```
PROCEDURE ghApiContents(repoSlug, ref, path):
  # (1) Primary read: fetch the Contents object for the file.
  r := spawnSync("gh", ["api", "repos/" + repoSlug + "/contents/" + path + "?ref=" + ref], { encoding: "utf8", timeout: 60000 })
  IF r.status == 0:
     obj := JSON.parse(r.stdout)   # on parse failure -> OtherFailure "unparseable contents response"
     b64 := (typeof obj.content == "string") ? obj.content : null
     IF b64 == null: return (_, OtherFailure "contents response carried no base64 content")   # e.g. a directory listing
     # Strip the Contents API's embedded newlines before decode (mirrors merge-gate.js's Contents read).
     return (base64Decode(b64.replace(/\n/g, "")), Ok)

  # (2) Non-zero exit. NEVER match stderr text (FAFF-747 abandoned that for merge-gate). Read the REAL
  #     HTTP status of the file read via a headers-only probe.
  fileStatus := ghHttpStatus(["api", "-I", "repos/" + repoSlug + "/contents/" + path + "?ref=" + ref])
  IF fileStatus != 404:
     # 403 (no-access), 5xx, a network failure, `gh` missing, or an absent/unparseable status line
     # (fileStatus == null) are all NOT a proven file-absence -> fail closed.
     return (_, OtherFailure "contents read failed (http " + (fileStatus ?? "none") + ")")

  # (3) A 404 on the file alone is ambiguous: path-absent, repo-not-found, no-access, and a missing ref
  #     all surface as 404. Disambiguate with a reachability+authorization probe on the repo-root tree
  #     AT THE SAME REF. A 200 there proves the repo is reachable, the token is authorized for contents,
  #     and the ref exists -- so the file's 404 means it is genuinely absent on that tree.
  rootStatus := ghHttpStatus(["api", "-I", "repos/" + repoSlug + "/contents?ref=" + ref])
  IF rootStatus == 200: return (_, FileAbsent)
  return (_, OtherFailure "404 not provably file-absent: repo-root probe http " + (rootStatus ?? "none"))

PROCEDURE ghHttpStatus(args):   # modelled on merge-gate.js's anchorHttpStatus (FAFF-747), copied not imported
  # `gh` exits non-zero on any HTTP error but still writes the response status line to stdout under -I;
  # capture stdout regardless of exit code and read the FIRST `HTTP/<ver> <code> <reason>` line.
  r := spawnSync("gh", args, { encoding: "utf8", timeout: 60000 })
  out := String((r && r.stdout) || "")
  m := out.match(/^HTTP\/[\d.]+\s+(\d{3})\b/m)
  return m ? Number(m[1]) : null   # null => no status line (network/`gh` missing/odd output) => caller fails closed
```

**Chosen:** `transport: "local"` reads via `git show` from the local object store and labels the read `local-ref`; `transport: "remote"` reads via `gh api .../contents?ref=` and labels it `remote-base`. Rationale: decision 11 says only the forge read proves "remote" because the runner controls its local refs; the label is the truth the verifier later consumes to decide counting. This module reports the label and does not itself decide independence. See §6.

**Chosen:** on the remote transport, a 404 maps to `FileAbsent` only when a headers-only repo-root-tree probe at the same ref returns 200 (repo reachable, token authorized, ref present); every other remote outcome — a non-404 file status, a null/absent status line, or a repo-root probe that is not 200 — maps to `OtherFailure` → `trust-file-invalid`. Rationale: GitHub returns an identical 404 for path-absent, repo-not-found, no-access, and a missing ref, so an undisambiguated 404 → `FileAbsent` is a fail-*open* that silently disables strict mode on an unreachable or forbidden repo — the exact hole the ticket forbids. The probe is read by HTTP status (never stderr text, which merge-gate abandoned in FAFF-747), so two builders implement the same mechanism. See §6.

**Chosen:** a genuinely absent file is the only `present: false, config: null` result. On the local transport that is git's recognised "path does not exist"; on the remote transport it is a file 404 *proven* file-absent by a 200 repo-root-tree probe at the ref. Any other read failure (bad ref, shallow clone, network, auth, no-access, an ambiguous 404) is `trust-file-invalid` with `line: null`. Rationale: decision 11's "no file: no pins" applies to a real absence only; conflating a failed or unprovable read with an absent file would reopen the fall-back-to-no-pins hole. See §6.

**Chosen (scope boundary):** `readTrustFile`'s caller supplies the `gh` binary and the credential context; this module attests the *transport*, not the caller's trustworthiness. `source: "remote-base"` means "these bytes were read via the forge Contents API", not "the caller is trustworthy". Per ADR 0135 decision 6 the governor and any independent verifier MUST invoke the remote read with the governor's OWN read-only token (never the runner's) and resolve `gh` from a trusted path — the same trusted-execution discipline FAFF-1211 applies to its interpreter. Binding the `remote-base` label to a trusted caller and credential is the consumer's job (FAFF-1178 / FAFF-1182), out of scope here. Rationale: this *scopes*, not *fixes*, the execution-context concern the infosec review raised — the module cannot attest a credential it does not own, so the honest boundary is to attest transport and name the consumer that must bind trust to it. See §6.

**Anti-pattern:** reading `.commissaire/trust.toml` from the working tree (`fs.readFile`) as a fast path or fall-back. Why: the no-local-override principle forbids it outright; the working-tree copy is runner-controlled and proves nothing.

**Anti-pattern:** mapping a bare `gh` 404 (from exit code or stderr) straight to `FileAbsent`. Why: that is the fail-open the review rejected — a token with no access, an unreachable repo, and a missing ref all 404, so strict mode would silently switch off. A 404 counts as absence only after the repo-root-tree probe proves the tree is reachable and authorized at that ref.

### Failure modes

- **The failure:** the `git show` "file absent" detection relies on matching stderr text, and a future git phrases it differently, so a real absence is misclassified as `OtherFailure` (fail closed) — safe but noisy — or worse, an unrelated error is misclassified as `FileAbsent` (returns "no pins"). **How you'd know:** the corpus/reader tests assert the absent-file case returns `present: false` and the bad-ref case returns an error; a git phrasing change flips one of those. **What it means:** proceed, but the test must pin both directions so a regression is loud; prefer checking exit status plus a conservative absent-pattern, treating anything ambiguous as `OtherFailure` (fail closed).
- **The failure:** the test-only TOML library disagrees with this parser on a file both should accept (e.g. a value this parser accepts but standard TOML reads differently), so "every accepted file is valid TOML with the same meaning" (decision 11) silently does not hold. **How you'd know:** the corpus equivalence test fails for that file. **What it means:** narrow — tighten this parser to reject the divergent input rather than widen it; the accepted set must stay a strict subset of TOML.
- **The failure:** the remote transport's two-probe 404 disambiguation is wrong for some real repo state — e.g. a repo-root-tree probe that 404s for a reason other than the file's absence (a transiently missing ref) is correctly failed closed, but a reviewer expected `present:false`. **How you'd know:** the stubbed-`gh` reader tests assert both arms — a 404 with a 200 root-probe returns `present:false`, and a 404 with a non-200 root-probe (repo-not-found / no-access) returns `trust-file-invalid` (never `present:false`). **What it means:** proceed; the fail-closed direction is the safe one, and the tests pin the boundary so a future change that loosens it toward fail-open is loud.
- **The failure:** the `gh api` Contents path is never exercised in CI (no network / no auth), so the remote transport ships unverified while only the local path is tested. **How you'd know:** coverage shows `ghApiContents`/`ghHttpStatus` unhit; the remote branch has no test asserting base64 decode (with embedded-newline stripping) and the 404 disambiguation. **What it means:** proceed with unit tests that stub `spawnSync` for both `gh` calls — a success fixture (JSON with a base64 `content` carrying embedded `\n`), a proven-absent fixture (file 404 + root-probe 200), and an ambiguous-404 fixture (file 404 + root-probe 404/403) — so decode and both absence arms are tested without a live forge.

---

## 5. Scenarios

> 4 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

> A ```holdout fence marks a born-verifiable holdout scenario reserved for the code-blind evaluator (a faff convention); these remain acceptance scenarios the build must satisfy, not optional extras.

```
Given a .commissaire/trust.toml committed on the base branch with schema = 1 and two valid fingerprints
When readTrustFile runs with transport "local" against that ref
Then it returns present=true, config with both fingerprints, requirePinnedGovernor=false, and source="local-ref"
```

```
Given a trust file whose governor_key_fingerprints is written as a multi-line array (one fingerprint per line, a # comment between elements, and a trailing comma) — the ADR's own example shape
When parseTrustToml runs
Then it parses the array to the full list of fingerprints and resumes at the line after the closing "]", never re-reading an array line as a fresh key = value pair
```

```
Given the same file read with transport "remote" via gh api contents (base64 body, with embedded newlines)
When readTrustFile runs with a repoSlug and ref
Then it strips the base64 newlines, decodes, and returns the identical config and source="remote-base"
```

```
Given a trust file whose only change is a misspelt key "require_pinned_governer = true"
When the reader parses and validates it
Then it returns trust-file-invalid with the unknown-key reason and that line's number, and never "no pins"
```

```
Given a ref that does not exist (or a shallow clone lacking the object)
When readTrustFile runs with transport "local"
Then it returns trust-file-invalid (stage Read, line null), not present=false
```

```
Given a remote repo where gh returns a 404 for the file but a 200 for the repo-root-tree probe at the ref (repo reachable, authorized, ref present, file genuinely absent)
When readTrustFile runs with transport "remote"
Then it returns present=false, config=null, source="remote-base" — the only remote "no pins" path
```

- The shipped require closure of `commissaire-trust.js` MUST contain only `node:*` and governance-region files; it MUST NOT contain the test-only TOML library, `./config`, `./budget`, or any denylisted orchestration basename.

---

## 6. Design Decision Rationale

**Which module, which region, and does it get a CLI command?**
- Options: a new governance-region TS module (library only) / a new module registered in `REGION_MAP` with a `--selftest` / extend an existing file.
- A library-only governance module matches "only Commissaire reads the file" and avoids forcing a selftest argv and runnable entrypoint that a `REGION_MAP` entry would require.
- **Chosen:** new file `commissaire-trust.ts` in `region:governance`, exported as a library, added to `tsconfig.json` `include` with a committed `.js` emit — no `REGION_MAP` entry, no CLI command.

**Return shape: closed `Result` or thrown exceptions?**
- Options: throw on invalid / return `Result<T,E>`.
- A thrown error invites a `catch` that degrades to "no pins"; a closed `Result` forces the caller to handle the invalid arm, matching `result.ts` and `ids.ts`.
- **Chosen:** closed `Result<T, E>` for `parseTrustToml`, `validateSchema1`, and `readTrustFile`.

**Parser strictness style.**
- Options: reuse the forgiving `parseYamlSubset` style (never throws) / a strict, line-numbered parser.
- Decision 11 requires line-numbered refusals; the forgiving style cannot produce them and silently coerces.
- **Chosen:** a bespoke strict parser with first-refusal, 1-based line numbers; `parseYamlSubset` is precedent for "built-in, zero-dep", not for behaviour.

**Error surface: one code or many?**
- Options: a code per failure class / one public `trust-file-invalid` with a structured breakdown.
- Decision 11 names exactly `trust-file-invalid` + a line number; callers branch only on valid/invalid.
- **Chosen:** one code, with `stage`/`line`/`reason` for diagnostics and a formatted `message`.

**Grammar edge cases decision 11 leaves open.**
- Closed, all fail-closed: lone CR inside a line and any code point < 0x20 in a string → "control character in string"; invalid UTF-8 in a string → "invalid utf-8 in string"; `#` inside quotes stays in the string; whitespace/tabs around `=` and inside arrays tolerated; empty array `[]` valid; single `0` valid but `00`/`01` refused ("no leading zeros"); integers above `Number.MAX_SAFE_INTEGER` → "integer out of range"; `schema` any value other than integer `1` → "schema must be 1".
- **Chosen:** the fail-closed rulings above, each with the named reason string.

**Empty / whitespace-only file.**
- Options: treat as "no file" (no pins) / treat as invalid.
- "No file" is the path being absent on the ref; a present empty file lacks the required `schema`.
- **Chosen:** empty file is `trust-file-invalid`, "missing required key schema".

**Absent file vs a read that fails for another reason.**
- Options: any read failure → "no pins" / only a true absence → "no pins", all else invalid.
- The former reopens the fall-back hole decision 11 forbids.
- **Chosen:** only git "path does not exist" (local) or a 404 proven file-absent by the repo-root-tree probe (remote) → `present:false`; every other failure → `trust-file-invalid` (line null).

**Remote-read location and the source label.**
- Options: remote read in each caller / one shared function here taking a `ref`; local `git show` vs forge `gh api` for "remote".
- Decision 11 and the ticket default put it here behind one ref-taking function; only the forge read proves "remote" because the runner controls local refs.
- **Chosen:** `readTrustFile` here; `transport:"local"` (`git show`) → `source:"local-ref"`, `transport:"remote"` (`gh api .../contents?ref=`) → `source:"remote-base"`. Counting on the label is FAFF-1178's job.

**Remote 404: how to tell a genuine absence from an unreachable/forbidden repo (fail-closed).**
- Options: map any `gh` 404 (from exit code or stderr text) to `FileAbsent` / probe the real HTTP status and require a proof of reachability+authorization before treating a 404 as absence.
- GitHub returns an identical 404 for path-absent, repo-not-found, no-access, and a missing ref. The first option is the fail-*open* the review rejected: an auth or network failure would silently disable strict mode. Matching stderr text is also not a contract — merge-gate.js abandoned stderr matching for a headers-only `gh api -I` status probe in FAFF-747.
- **Chosen:** detect by HTTP status, copying merge-gate's `anchorHttpStatus` shape (never importing it). A file 404 maps to `FileAbsent` only when a headers-only repo-root-tree probe at the same ref (`gh api -I repos/<slug>/contents?ref=<ref>`) returns 200; a non-404 file status, a null/absent status line, or a root probe that is not 200 all map to `OtherFailure` → `trust-file-invalid`. The base64 `content` has its embedded newlines stripped (`content.replace(/\n/g,"")`) before decode, mirroring merge-gate's Contents read.

**Caller credential and execution context: what `remote-base` attests (scope boundary).**
- Options: have this module assert the read was trustworthy (right token, trusted `gh`) / have it attest only the transport and leave trust-binding to the consumer.
- The module is handed the `gh` binary and credential context by its caller; it cannot attest a credential it does not own. The infosec review's execution-context concern is real but belongs to the consumer that chooses the token and the `gh` path.
- **Chosen (scope boundary):** `source: "remote-base"` attests TRANSPORT ("read via the forge Contents API"), not caller trustworthiness. Per ADR 0135 decision 6, the governor and any independent verifier MUST drive the remote read with the governor's OWN read-only token (never the runner's) and resolve `gh` from a trusted path — the trusted-execution discipline FAFF-1211 applies to its interpreter. Binding the `remote-base` label to a trusted caller/credential is FAFF-1178 / FAFF-1182's job. This scopes, not fixes, the execution-context concern.

**`gh` and `git` availability.**
- `gh api` (authenticated) and `git` must exist at runtime for the remote and local reads; merge-gate already depends on both.
- **Assumes:** the `gh` CLI is installed and authenticated and `git` is on `PATH`, as merge-gate.js assumes (validate in §7).

**Test-only TOML library and version.**
- Options: `smol-toml` / `@iarna/toml` — both are ADR-rejected as *runtime* deps, so one serves as a *test-only* devDependency.
- `smol-toml` is small, maintained, zero-dependency itself, and TOML-1.0 compliant, keeping the devDependency footprint minimal.
- **Chosen:** add `smol-toml` (pinned, e.g. `^1.3.0`) as a third devDependency beside `typescript` and `@types/node`; it is used only by the corpus equivalence test, never required by shipped code. (At the time of writing, both libraries are maintained; revisit if `smol-toml` stalls.)

**Corpus behaviour when `node_modules` is absent.**
- Options: hard-fail the corpus test / skip it with a visible reason.
- CI runs `npm ci` so the lib is present there; a bare checkout without `npm ci` should not red the suite for a missing devDependency.
- **Chosen:** the equivalence test does a guarded `require` of `smol-toml` resolved from `plugin/skills/faff/node_modules`; if it cannot resolve, the test `skip()`s with a clear message. The independence and no-closure assertions still run (they need no devDependency).

**No-shipped-closure and no-local-override proofs.**
- **Chosen:** extend `test/commissaire-standalone.test.mjs` (or a sibling `.mjs`) with: (a) a require-edge assertion that `commissaire-trust.js`'s transitive edges are a subset of `{node:*} ∪ governance files` and exclude `./config`, `./budget`, `smol-toml`, and every denylisted basename, using `regionsRequireEdges` and proven non-vacuous against a tainted copy with an injected `./config` require (mirroring the existing tainted-fixture test; the real source is never mutated); (b) a `package.json` assertion that no `dependencies` key exists; (c) a temp-repo test that commits a trust file on `main`, writes a *different* working-tree version and an untracked `trust.local.toml`, and asserts `readTrustFile` returns the committed values unchanged.

---

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. Every decision 11 question is settled by the ADR; the ticket's one open question (remote read here vs per-caller) resolved to "here", per the ADR default.

**Assumptions.**

- **Assumes:** the `gh` CLI is installed and authenticated, and `git` is on `PATH`, in every environment that performs a remote-base read. *Validate:* confirm `merge-gate.js` invokes `gh api` / `gh api -I` / `git` the same way (it does, at the Contents-API, `anchorHttpStatus`, and `git show` call sites) and that CI provides an authenticated `gh`; the remote unit tests stub `spawnSync` so they do not themselves need a live `gh`.
- **Assumes:** `pkFingerprint` produces 64 lowercase hex characters, so the fingerprint regex `^[0-9a-f]{64}$` matches real pins. *Validate:* grep the governance region for `pkFingerprint` and confirm its output width and case before finalising the regex.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A missing `.commissaire/trust.toml` on the ref returns `present:false, config:null` (no pins, strict off, no approvers); nothing else does.
- [ ] Malformed/invalid bytes, unknown keys, non-absent read failures, and a remote 404 not proven file-absent all return `trust-file-invalid` and never "no pins".
- [ ] `commissaire-trust.js` is read (not the `.ts`); the module adds no runtime dependency.

### From WHAT (types and interfaces)
- [ ] `parseTrustToml`, `validateSchema1`, and `readTrustFile` return closed `Result` values matching the signatures.
- [ ] `TrustFileError.message` formats as `trust-file-invalid: line N: <reason>` when a line is known and `trust-file-invalid: <reason>` when it is null.
- [ ] `TrustConfig` carries `schema:1`, fingerprints (default `[]`), `requirePinnedGovernor` (default `false`), approvers (default `[]`).

### From HOW (parser)
- [ ] Accepts: LF/CRLF, blank lines, `#` comments (own line and trailing), bare-key `key = value`, basic strings with only `\"`/`\\`, unsigned decimal ints, `true`/`false`, string arrays (one or many lines, inter-element comments, optional trailing comma, empty `[]`).
- [ ] Refuses with a line number: BOM; `[x]` and `[[x]]`; dotted/quoted/duplicate keys; literal/multiline strings and other escapes; floats/dates/times and hex/octal/binary ints; inline tables; nested and mixed-type arrays.
- [ ] `0` accepted; `00`/`01` refused; `#` inside quotes stays in the string; integer above `MAX_SAFE_INTEGER` refused; control char / invalid UTF-8 in a string refused.
- [ ] A multi-line `governor_key_fingerprints` array (element-per-line, inter-element `#` comment, trailing comma — the ADR's example shape) parses to the full list; the parser's cursor advances past every consumed line, so no array line is re-read as a fresh `key = value` pair.

### From HOW (schema-1 validation)
- [ ] Missing `schema` → invalid (line null); `schema` not `1` → invalid; unknown key → invalid with the key's line.
- [ ] Each fingerprint must match `^[0-9a-f]{64}$`; duplicates refused.
- [ ] `require_pinned_governor` must be boolean; `true` with an empty fingerprint list refused.
- [ ] `pin_change_approvers` must be an array of strings.

### From HOW (reader and source label)
- [ ] `transport:"local"` reads via `git show <ref>:.commissaire/trust.toml` and reports `source:"local-ref"`.
- [ ] `transport:"remote"` reads via `gh api repos/<slug>/contents/.commissaire/trust.toml?ref=<ref>`, strips the base64 `content`'s embedded newlines (`content.replace(/\n/g,"")`) before decode, and reports `source:"remote-base"`.
- [ ] Remote read detection is by HTTP status (headers-only `gh api -I` probe modelled on merge-gate's `anchorHttpStatus`), never by stderr-text matching.
- [ ] A remote file 404 maps to `present:false` ONLY when a repo-root-tree probe at the ref returns 200; a stubbed-`gh` test proves this genuine-absent case returns `present:false`.
- [ ] A remote file 404 with a repo-root-tree probe that is NOT 200 (repo-not-found / no-access / missing ref) returns `trust-file-invalid` (stage Read, line null), NOT `present:false`; a stubbed-`gh` test proves it.
- [ ] A bad ref / shallow clone / network / auth failure (local or remote) returns `trust-file-invalid` (line null), not `present:false`.
- [ ] An empty file returns `trust-file-invalid` "missing required key schema".

### From HOW (independence and no-override)
- [ ] `faff regions check` passes: governance banner present, `.js` sibling committed, no governance→factory edge.
- [ ] A test proves the require closure is a subset of `{node:*} ∪ governance files`, excludes `./config`/`./budget`/`smol-toml`/denylist, and fires against a tainted fixture.
- [ ] A test proves `package.json` has no `dependencies` key and lists `smol-toml` only under `devDependencies`.
- [ ] A temp-repo test proves a working-tree edit and an untracked `trust.local.toml` change the result by nothing.

### From test tooling
- [ ] A corpus of accepted and refused files is tested; for accepted files, `smol-toml` parses to the same values; the corpus test `skip()`s (not fails) when `smol-toml` cannot be resolved.
- [ ] `test/commissaire-standalone.test.mjs` passes; no `.ts` lives under `test/`.

### Eval coverage
- [ ] No LLM-judgement seam is introduced; no grader/eval-case registration is required.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. mkdtemp repo; git init; write .commissaire/trust.toml with schema=1 + one valid fingerprint + require_pinned_governor=false; git add; git commit on main
  2. r := readTrustFile({ repoDir, ref: "main", transport: "local" })
  3. ASSERT r.ok && r.value.present == true
  4. ASSERT r.value.config.governorKeyFingerprints has the one fingerprint
  5. ASSERT r.value.source == "local-ref"
  6. rmSync(repo)   # in finally
```

confidence: high

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
    { "marker": "assumes" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```