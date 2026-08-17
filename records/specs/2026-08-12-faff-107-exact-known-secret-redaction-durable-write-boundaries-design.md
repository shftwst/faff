# FAFF-107 — Exact known-secret redaction at durable-write boundaries

> Spec: faffter-dark-nlspec · 2026-08-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-107.

This replaces the earlier broad redaction proposal. The first slice is deliberately small: redact exact secret values already known to SuperDomestique at the two code-owned durable-write boundaries. It does not attempt general secret detection, PII detection, or interception of agent-authored narrative files.

## 1. WHY — Problem and principles

SuperDomestique's structured run record can persist free-form strings in `.faff/runs/<run-id>/events.jsonl` and `run-ledger.json`. A caller may accidentally include a credential already present in resolved configuration or referenced through a configured environment-variable handle. Those values should not become part of the durable forensic record.

The governing rule is:

> Before a code-owned structured run artifact is serialized, replace every exact occurrence of a known secret value with a fixed placeholder.

This is proportionate because it:

- protects the two durable write paths the CLI actually controls;
- has a very low false-positive rate;
- requires no heuristic classifier or pattern catalogue;
- makes no unsupported claim about prose written directly by an agent; and
- leaves broader DLP work for evidence that it is needed.

Current code confirms two relevant chokepoints:

| Artifact | Code-owned boundary |
|---|---|
| `events.jsonl` | `appendEventRecord` in `plugin/skills/faff/bin/lib/events.js` |
| `run-ledger.json` | `atomicWriteLedger` in `plugin/skills/faff/bin/lib/heartbeat.js`; production mutations route through `mutateLedgerUnderLock` |

Redaction must occur before serialization and hashing. The ledger's `ledger_sha256` event therefore describes the redacted bytes actually written, and the event chain hashes the redacted event line.

## 2. OUT OF SCOPE

- Known token-shape regexes such as GitHub, OpenAI, AWS, Slack, bearer-token, or PEM patterns.
- Generic high-entropy detection.
- PII detection, including email addresses, names, phone numbers, and postal addresses.
- User-configurable regexes or a `redaction:` configuration namespace.
- An enable/disable switch. Protection at these boundaries is an invariant, not an optional logging preference.
- Narrative files written directly by an agent or orchestration tool, including `prep.md`, `graft.md`, `park.md`, `summary.md`, and `.faff/logs/...`.
- A `faff redact` stdin filter.
- Tracker comments, PR descriptions, terminal output, subprocess output, or transcripts.
- Retroactive rewriting of existing artifacts.
- Secret scanning of staged Git content; `faff stage-guard` owns that separate concern.
- Discovering arbitrary secret-looking environment variables not named by configuration.

Extension point: if narrative writes later gain one code-owned writer, that writer can compose the same pure primitive. Broad detection should be proposed separately with measured false-positive evidence.

## 3. WHAT — Contract and vocabulary

### Known secret value

A string value that the resolved SuperDomestique configuration identifies through either:

1. a configured secret environment handle:

   - `api_key_env`
   - `seat_token_env`

   The configured scalar is the environment-variable name; the known value is the corresponding non-empty value in `process.env`.

2. a configuration field whose schema explicitly stores a secret value:

   - `andon.url`
   - `andon.token`

   `andon.url` is included because webhook URLs commonly embed their credential in
   the URL itself and current documentation explicitly classifies both fields as
   secret-bearing configuration.

The collector is allowlisted to those fields. It must not recursively treat every `*_env` key, every environment variable ending in `_TOKEN` or `_KEY`, or every suspicious-looking configuration scalar as secret-bearing.

Only values of at least eight characters become targets. Empty, absent, and shorter values are ignored to prevent empty-string replacement and destructive substitution of common short text. This is an explicit first-slice limitation.

### Placeholder

Every matched value becomes:

```text
[REDACTED]
```

The placeholder does not include the environment-variable name, config path, prefix, length, hash, or any fragment of the secret.

### Primitive

Add a small module under `plugin/skills/faff/bin/lib/` with pure cores equivalent to:

```text
collectKnownSecretValues(config, env) -> String[]
  Read allowlisted handles and direct secret fields.
  Resolve handles through env.
  Drop absent, non-string, and length < 8 values.
  Deduplicate.
  Sort by descending length, then lexical value for deterministic overlap handling.

redactKnownSecrets(value, secretValues) -> JSONValue
  Recursively clone arrays and plain objects.
  For every string leaf, replace every exact occurrence of every target with
  "[REDACTED]".
  Preserve numbers, booleans, and null unchanged.
```

The primitive must not mutate its input. Longest-first replacement prevents a shorter known value from exposing the remainder of an overlapping longer value. Applying it twice produces the same result as applying it once.

Ruleset resolution may wrap these pure functions, but raw secret values must never be returned by a diagnostic, written to stderr/stdout, or included in thrown error messages.

## 4. HOW — Integration behavior

### Event trail

Inside `appendEventRecord`, resolve the known-value set and redact the caller-controlled payload before constructing/serializing the record.

Redaction covers only nested `data` string leaves. Caller-supplied structural fields
remain unchanged:

- `phase`
- `type`
- `issue`

CLI-minted envelope fields remain unchanged:

- `schema`
- `run_id`
- `seq`
- `ts`
- `prev`

Validation still runs against the redacted record. No second event-writing implementation or duplicate secret collector is introduced.

Structural fields are validated through the existing event contract and are never
passed through the redactor. This prevents a known secret that happens to equal or
occur within a valid protocol token such as `run-start` from corrupting the event
schema or breaking the ledger-write chain.

### Run ledger

Inside `atomicWriteLedger`, redact the ledger object before `JSON.stringify`.

Then:

1. serialize the redacted ledger;
2. compute SHA-256 from those exact serialized bytes;
3. atomically write those bytes;
4. append the existing `ledger-write` event carrying that hash.

The caller-provided ledger object remains unchanged. `mutateLedgerUnderLock` keeps its locking, fencing, and return contract. Existing before/after digest semantics remain byte-based:

- `before_sha256` hashes the prior on-disk bytes;
- `after_sha256` hashes the new redacted bytes.

### Config and failure behavior

Use the existing resolved config loader and current process environment. Do not add config keys.

A missing configured environment value contributes no target. Ordinary absence is not an error.

A malformed config retains the existing config loader's fail-loud behavior; redaction must not catch and suppress that failure.

No log or warning names a collected value. The implementation does not report counts, prefixes, or samples.

## 5. Scenarios

```text
Given backends.primary.api_key_env is SERVICE_API_KEY
And SERVICE_API_KEY contains a value of at least eight characters
When appendEventRecord receives data.msg containing that exact value
Then events.jsonl contains "[REDACTED]"
And no byte of the exact value appears in the appended physical line
```

```text
Given an enabled andon token is present in resolved config
When a ledger mutation places that token inside a nested string leaf
Then run-ledger.json contains "[REDACTED]"
And the following ledger-write event hashes the redacted ledger bytes
```

```text
Given andon.url contains a credential-bearing webhook URL of at least eight characters
When an event data string or ledger string leaf contains that exact URL
Then the durable artifact contains "[REDACTED]"
And no byte of the exact URL appears in the written string leaf
```

```text
Given a configured known secret value equals or occurs within an event phase, type, or issue
When appendEventRecord writes an otherwise valid event
Then phase, type, and issue remain byte-for-byte unchanged
And only nested data string leaves are eligible for redaction
```

```text
Given two known values overlap
When a string contains the longer value
Then longest-first replacement removes the whole longer value
And no suffix remains exposed
```

```text
Given a configured secret handle is absent from the environment
When an event is appended
Then the append behaves as before
And no empty-string replacement or error occurs
```

```text
Given a configured value is shorter than eight characters
When it appears in a structured artifact
Then it is not redacted
```

```text
Given a GitHub-shaped token, email address, UUID, Git SHA, or high-entropy string
And it is not an exact collected known value
When it is written
Then it remains byte-for-byte unchanged
```

```text
Given a caller-owned ledger object contains a known value
When atomicWriteLedger writes it
Then the on-disk clone is redacted
And the caller-owned object still contains its original value
```

## 6. Failure modes and guardrails

- **Unknown secret passes through.** This slice cannot redact a value not reachable through the allowlisted config fields. That is an honest scope limit, not a reason to add heuristics.
- **Short real secret passes through.** Values below eight characters are deliberately excluded to protect artifact usefulness. Revisit only with evidence.
- **Secret already persisted.** Existing files are untouched; no chain-breaking rewrite is attempted.
- **New durable writer bypasses the primitive.** The writer inventory comments and tests must make adding a direct production write visibly wrong.
- **Redaction changes integrity bytes.** Hash only after redaction. Hashing before redaction would make `ledger_sha256` false and is prohibited.
- **Diagnostic recreates the leak.** Tests must assert that neither the raw value nor a fragment is emitted as redaction metadata.

Anti-pattern: widening collection to all ambient environment variables. Ambient variables are not all secrets, and an exact match against every value would corrupt paths, usernames, hosts, and other common strings.

Anti-pattern: adding token-shape or PII regexes "while here." Those reopen the proportionality and false-positive questions this human decision explicitly closed.

## 7. Design decisions

- **Chosen: exact known values only.** This directly addresses credentials SuperDomestique can identify without guessing.
- **Chosen: allowlisted secret sources.** `api_key_env`, `seat_token_env`, `andon.url`, and `andon.token` are explicit secret-bearing schema.
- **Chosen: always on at these boundaries.** A durable-record safety invariant should not silently depend on operator opt-in.
- **Chosen: one opaque placeholder.** `[REDACTED]` avoids leaking secret names or characteristics.
- **Chosen: eight-character floor.** It prevents common short values from destroying forensic usefulness.
- **Chosen: events and ledger only.** These are the current code-owned durable chokepoints.
- **Chosen: redact before serialization and hashing.** Integrity metadata describes the bytes actually persisted.
- **Chosen: no narrative-write claim.** There is currently no enforceable code chokepoint for those writes.
- **Chosen: no broad heuristics or PII.** Their false-positive and proportionality costs are outside this slice.

No open product or architecture decision remains.

## 8. DONE

- [ ] A single shared redaction module collects only `api_key_env`, `seat_token_env`, `andon.url`, and `andon.token` values.
- [ ] Handle values are resolved through the supplied environment; absent and shorter-than-eight values are ignored.
- [ ] Targets are deduplicated and applied longest-first.
- [ ] The replacement is exactly `[REDACTED]`.
- [ ] The recursive primitive is pure, non-mutating, deterministic, and idempotent.
- [ ] `appendEventRecord` redacts only nested `data` string leaves before serialization and chain hashing; structural `phase`, `type`, and `issue` fields remain byte-for-byte unchanged.
- [ ] `atomicWriteLedger` redacts before serialization, writing, digesting, and emitting `ledger-write`.
- [ ] Ledger before/after digest and lock/fence behavior remain intact.
- [ ] Unknown token shapes, PII, UUIDs, SHAs, and high-entropy strings remain unchanged unless they exactly equal a collected known value.
- [ ] No config namespace, toggle, CLI filter, or narrative-log instruction is added.
- [ ] No raw secret value, fragment, name, length, or hash is emitted as redaction diagnostics.
- [ ] Selftests cover exact replacement, nested arrays/objects, multiple occurrences, overlap, duplicate values, absent handles, short values, idempotence, and input non-mutation.
- [ ] Integration tests prove both physical artifacts omit a sentinel and that `ledger_sha256` matches the redacted ledger bytes.
- [ ] Integration tests prove a credential-bearing `andon.url` is redacted and a known value colliding with `phase`, `type`, or `issue` cannot alter those structural fields or break event validation.
- [ ] Existing event-chain, ledger-lock, ownership-fence, config, and adapter-validation tests remain green.
- [ ] Public documentation describes this narrowly as exact known-secret redaction for code-owned structured run artifacts, without claiming general secret/PII protection.

build-tier: complex

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen","decision":"exact known values only"},{"marker":"chosen","decision":"allowlisted api_key_env, seat_token_env, and andon.url/token sources"},{"marker":"chosen","decision":"always-on durable-boundary invariant"},{"marker":"chosen","decision":"opaque [REDACTED] placeholder"},{"marker":"chosen","decision":"eight-character minimum"},{"marker":"chosen","decision":"events data leaves and ledger boundaries only"},{"marker":"chosen","decision":"redact before serialization and hashing"},{"marker":"chosen","decision":"exclude narrative writes"},{"marker":"chosen","decision":"exclude PII and broad heuristics"}],"punts":[],"assumptions":[]}
```

spec-review: approve

Self-review findings:

- The previous spec's unresolved default-on/default-off punt is removed: the narrowed boundary rule is always on.
- The previous token-shape table, generic entropy scan, PII option, extra regex configuration, `faff redact` verb, and narrative logging instruction are removed because they exceed the human-approved slice.
- Current code supports the claimed chokepoints. `appendEventRecord` owns production event envelope creation; `atomicWriteLedger` is the ledger serialization/hash boundary and production ledger mutations route through `mutateLedgerUnderLock`.
- Redaction must sit inside `atomicWriteLedger`, not only `mutateLedgerUnderLock`, so the primitive and its hash cannot drift and any future sanctioned caller inherits it.
- `andon.url` and `andon.token` are included because current documentation explicitly treats both as secret-bearing configuration; webhook URLs commonly carry the credential in the URL itself. Arbitrary ambient `*_TOKEN`/`*_KEY` discovery is intentionally excluded.
- Event redaction is limited to nested `data` string leaves. Structural `phase`, `type`, and `issue` fields retain their validated protocol values even if a known secret happens to collide with one.
- Residual risk is explicit: unknown and short secrets can still pass, and narrative files remain discipline-only. These limitations are consistent with the proportionality decision rather than hidden behind a broad "sensitive-data redaction" claim.
