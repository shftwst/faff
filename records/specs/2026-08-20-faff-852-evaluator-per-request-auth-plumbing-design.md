# FAFF-852 — Evaluator per-request auth plumbing for token/preview transport occupants

> Spec: faffter-dark-nlspec · 2026-08-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-852.

This spec addresses **FAFF-852 — Evaluator per-request auth plumbing for token/preview transport occupants**. Its audience is the build agent that will implement it and the human reviewers who gate it. It is written to be buildable from this document plus the cited files alone.

## 1. WHY — Problem and Principles

**The load-bearing model.** The `env` slot's `transport` occupant may hand the evaluator a running system-under-build that sits behind an application-layer credential — a published port guarded by a short-lived bearer token, or a preview URL behind auth. The env-handle already carries an optional, opaque `credentials` object for exactly this. Today the evaluator ignores it: it drives the running feature with bare requests. This change adds the one missing hop — read a credentials object handed to the spawner, thread it (unlogged, unpersisted) to the inner evaluator, and have the inner evaluator attach it to each outbound request per its scheme.

**Problem statement.** FAFF-817 shipped the `transport` slot with an optional `credentials` object but left the evaluator's *consumption* of it unbuilt, because its only occupant (private-network) is network-segmented and needs no application-layer credential. So a token/preview occupant cannot yet be reached: the evaluator has no argument to receive a credential and no rule to attach it. This change adds that receive-and-attach seam, additively.

**Design principles.**

**Credentials are runtime-only — never logged, never persisted, never on the argv — and the invariant is STRUCTURAL, not prose.** The credential value must never appear in `.faff/holdout/<key>.json`, in the written verdict envelope, in stderr/stdout diagnostics, or in the tracker. The CLI accepts a *path* to a JSON file (`--credentials FILE`), never the secret on the command line — mirroring `--spec`/`--intent`. This is a hard invariant, not a nicety: a leaked evaluator credential is a live secret.

**The persistence guard is a spawner-side scrub, because the envelope's allow-list is not sufficient.** `assembleEnvelope` (`evaluate-call.mjs:87-97`) allow-lists envelope *fields*, so it blocks a new named `credentials` field — but it copies the inner evaluator's `aggregate` string and every `violations` string **verbatim** (`:90`,`:92`) into the persisted envelope, and the live token now rides in that inner evaluator's spawn payload. So a live inner evaluator that writes a violation like `"401 for Authorization: Bearer <token>"` would persist the secret through free text the allow-list never inspects. Prose in `SKILL.md` telling the inner evaluator not to echo the token is necessary but **not** the enforcement — the spawner, which holds the token value, is the trusted boundary. **The spawner MUST redact the token value out of every inner-authored free-text field before the envelope is written** (see §4 `redactCredential`). "By construction" means this scrub runs unconditionally on the write path, deterministically covered by test — not that a single field is absent.

**Absent credentials ⇒ behaviour byte-identical to today.** The seam is purely additive. With no `--credentials` and no `credentials` on the handle, every code path, request, and output is exactly what it is now. This mirrors FAFF-817's own byte-identical guarantee and is what lets this ship ahead of the first real occupant.

**The spawner stays code-blind and structural; it does not interpret the secret.** `evaluate-call.mjs` reads, structurally validates (is-an-object), and threads the credentials object. It does not derive headers, does not dispatch on scheme, and does not exercise anything — that remains the inner evaluator's job. The spawner's attestation surface (`buildWithheldSet`, `deriveAttestation`) is untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Node ESM | The spawner: `parseArgs` (:111), file-read pattern (:155), spawn payload (:188), envelope assembly (:87) |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Skill prose | The inner evaluator's exercise step (:38) — where attach is described |
| `plugin/skills/faff/contracts/env-handle.schema.json` | JSON Schema | Already has optional `credentials: object` (:29) — no change needed |
| `plugin/skills/faffter-noon-transport-private-network/SKILL.md` | Skill prose | Source of the opaque `credentials?` (:70-77); absent for private-network |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | Per-scheme header-attach precedent — Bearer vs x-api-key (:1303-1321) |
| `plugin/skills/faff/bin/lib/stage.js` | Node | Commit-guard secret-class already matches a file named `credentials`/`credentials.json` (:41, :192) |
| `test/helpers/holdout-exercise.mjs` | Node ESM | Deterministic exercise stand-in (`exercise()` :30) — bare `fetch`, no headers today |
| `test/evaluate-call.test.mjs` | Node ESM | Spawner tests with injected `preflightFn`/`spawnFn`/`writeFn` stubs |

**Scope statement.** This is the evaluator-side consumption half of the `transport` credential seam introduced by FAFF-817; it sits between the env-handle's opaque `credentials` object and the inner evaluator's outbound requests.

## 2. OUT OF SCOPE

- **Non-bearer schemes (basic auth, per-request-signed, mTLS).** — Why excluded: no occupant needs them yet; inventing more than one scheme ahead of a real consumer is speculative. — Extension point: the `deriveAuthHeaders` scheme switch in `evaluate-call.mjs` (add a `case`) and the corresponding attach bullet in `SKILL.md` §exercise.
- **The token/preview `transport` occupant itself.** — Why excluded: this ticket is the evaluator seam that occupant will use; the occupant is separate work (its own SKILL producing `{ credentials }`). — Extension point: a new `faffter-*-transport-*` skill resolved via `slots.transport`.
- **Credential rotation / refresh within a run.** — Why excluded: no rotation mechanism exists anywhere in the repo; every credential is read-once for the process lifetime, and the env is ephemeral and `--deadline`-bounded. — Extension point: if a future long-lived env needs it, a refresh callback threaded through the spawn payload alongside `credentials`.
- **env-handle schema change.** — Why excluded: the schema already declares optional `credentials: object` (:29); FAFF-852 adds only consumption. — Extension point: none needed; the field is already there and deliberately sub-schema-free.
- **Validating the credential against the SUT (a real auth handshake at parse time).** — Why excluded: the spawner is code-blind and does not reach the SUT; a bad credential surfaces as `needs-human` during exercise, not a parse-time probe. — Extension point: none in the spawner.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Credentials object | An opaque JSON object the `transport` occupant may attach to the env-handle, describing an application-layer credential the evaluator must present to reach the SUT. |
| Scheme | The `scheme` discriminator field on a credentials object selecting how its secret becomes request headers. `bearer` is the only v1 value. |
| Spawn payload | The object `evaluate-call.mjs main()` hands the injected `spawnFn` (:188) — currently `{ specText, endpoints, intentText, deadlineMs }`. |

**Type definitions.**

```
RECORD Credentials:                # the shape THIS spec defines (FAFF-817 left it opaque)
  scheme: String                   # discriminator; v1 recognises "bearer" only
  token:  String                   # scheme=="bearer": the secret presented as a Bearer token

  CONSTRAINT scheme is non-empty
  CONSTRAINT scheme=="bearer" ⇒ token is a non-empty string
  # Additional keys are permitted and ignored by v1 (forward-compatible for future schemes).
```

The v1 header derivation is fixed:

```
scheme "bearer", token T  ⇒  { "Authorization": "Bearer <T>" }
```

**Extended `parseArgs` (`evaluate-call.mjs` :111).** Add one arm to the flat loop, storing the *path* (per `--spec`/`--intent`):

```
else if (k === "--credentials") a.credentials = argv[++i]
```

**Extended spawn payload (`evaluate-call.mjs` :188).** The parsed object (not the path) is added:

```
res = await spawn({ specText, endpoints, intentText, deadlineMs, credentials })
#   credentials is the PARSED object, or undefined when --credentials absent
```

**New pure helper (`evaluate-call.mjs`, alongside the other pure-core fns).** The single source of truth for the scheme→request-header mapping (header SHAPE only — the fail-*posture* on a non-derivable header is inner-evaluator prose, §4), covered by `--selftest`:

```
FUNCTION deriveAuthHeaders(credentials) -> object   # PURE
  # Returns the header map to merge into each outbound request.
  # {} for absent/empty/unknown-scheme/malformed credentials ⇒ no header.
```

**New pure helper — the persistence scrub, covered by `--selftest`:**

```
FUNCTION redactCredential(envelope, credentials) -> envelope   # PURE
  # Replaces every occurrence of the credential's secret value(s) in the
  # envelope's inner-authored free-text fields (aggregate, each violations entry)
  # with the fixed placeholder "<redacted-credential>". No-op when credentials
  # absent or carries no secret. Idempotent. The ONLY value scrubbed is the
  # secret (credentials.token for bearer) — structural fields are untouched.
```

**Envelope invariant (`assembleEnvelope` :87).** It copies only `aggregate`/`code_blind`/`criteria`/`violations`/`spawner_attested`/`attestation` — the allow-list blocks a new named `credentials` field. But `aggregate` (`:90`) and `violations` (`:92`) are inner-authored free text copied verbatim, so the allow-list alone does **not** make the token unpersistable. The build MUST run `redactCredential` over the assembled envelope (or the inner verdict feeding it) **before** `writeFn`, so the secret cannot reach `.faff/holdout/<key>.json` through free text. The build must not add a `credentials` field to the envelope, and must add a test that injects a token-echoing inner verdict and asserts the written envelope is token-free.

## 4. HOW — Behavior

**Architecture and approach.** Four edits, all additive:

1. `evaluate-call.mjs` — `parseArgs` gains `--credentials FILE` (stores path); `main()` reads + JSON-parses + structurally validates the file, `EXIT.USAGE` on any failure; the parsed object is threaded into the spawn payload; a pure `deriveAuthHeaders` pins the scheme→header mapping.
2. `evaluate-call.mjs` — `main()` runs `redactCredential` over the assembled envelope **before** `writeFn` (the write path already at `:200`), so a token echoed into an inner-authored `aggregate`/`violations` string is scrubbed to `<redacted-credential>` before persist. This is the structural enforcement of the never-persisted invariant; it is a no-op when `credentials` is absent.
3. `SKILL.md` §"Exercise the born-verifiable criteria" (:38) — a clause: if the handle/payload carries `credentials`, attach the derived headers to every outbound request, runtime-only, never logged; **credentials present but no header derivable (unknown scheme OR malformed/empty-token known scheme) → record `needs-human`, never a silent unauthenticated send.**
4. `test/helpers/holdout-exercise.mjs` — `exercise()` gains an optional `headers` argument so the docker-gated deterministic stand-in can drive an authenticated endpoint and prove the plumbing.

**Behavior summary.** The credentials read mirrors `--intent` exactly: optional, path-based, fail-to-`USAGE` on read/parse error, plus one structural check (must be a non-null object).

```
PROCEDURE read_credentials(a):                 # inside main(), after --intent read (:161)
  1. IF a.credentials is unset: credentials ← undefined; RETURN     # byte-identical no-op
  2. TRY text ← readFileSync(a.credentials, "utf8")
     CATCH: stderr "cannot read --credentials <path>: <msg>"; RETURN EXIT.USAGE
  3. TRY obj ← JSON.parse(text)
     CATCH: stderr "--credentials is not valid JSON: <msg>"; RETURN EXIT.USAGE
  4. IF obj is null OR typeof obj !== "object" OR Array.isArray(obj):
        stderr "--credentials must be a JSON object"; RETURN EXIT.USAGE
  5. credentials ← obj
  # Never echo obj's VALUES into any diagnostic — messages name the path and the failure class only.
```

```
FUNCTION deriveAuthHeaders(credentials):        # PURE — the scheme dispatch
  1. IF !credentials OR typeof credentials !== "object": RETURN {}
  2. SWITCH credentials.scheme:
       case "bearer":
         IF typeof credentials.token !== "string" OR token is empty: RETURN {}   # malformed ⇒ no header
         RETURN { Authorization: "Bearer " + credentials.token }
       default:
         RETURN {}                              # unknown scheme ⇒ no header (inner evaluator flags it)
```

**Inner evaluator attach (`SKILL.md` :38, appended clause).** Prose the inner LLM evaluator follows, mirroring `deriveAuthHeaders`:

> If the env-handle (or the spawn payload) carries a `credentials` object, attach its derived auth headers to **every** outbound request when exercising the feature. For `scheme: "bearer"`, that is `Authorization: Bearer <token>`. Credentials are runtime-only: never write them to the evidence report, the verdict block, `.faff/holdout/<key>.json`, or any log — and if a request/response you capture as evidence would contain the token, redact it in the evidence text (the spawner also scrubs the persisted envelope as a structural backstop, but do not rely on that to be sloppy). If `credentials` is present but **no header is derivable** — an unrecognised `scheme`, or a known scheme whose secret is missing/empty (e.g. `bearer` with an empty `token`) — do **not** send an unauthenticated request and silently record `unmet`: record that criterion `needs-human` with a note ("credentials present but no auth header derivable"), the same fail-closed rule used for a surface the env exposes no way to exercise. Absent `credentials` (none supplied) is the ordinary no-auth path and exercises bare, unchanged.

**Edge cases and error handling.**

- **No `--credentials`, no handle credentials** → `deriveAuthHeaders` never called with a value / returns `{}`; every path byte-identical to today. Terminal-clean.
- **File missing / unreadable / not JSON / not an object** → `EXIT.USAGE` (2), no spawn, no verdict written — same class and timing as a bad `--spec`/`--intent`.
- **`scheme: "bearer"` with missing/empty `token`** → `deriveAuthHeaders` returns `{}`; because `credentials` **is present** but no header is derivable, the inner evaluator records `needs-human` (the same fail-closed branch as an unknown scheme) rather than sending a bare request. Not a spawner-level error (the spawner does not interpret the secret's validity), but the fail-posture is aligned across both no-derivable-header cases.
- **Unknown `scheme`** → `{}` from the helper; inner evaluator records `needs-human` per the fail-closed clause. Never a silent unauthenticated `unmet`.
- **Token echoed into an inner-authored `aggregate`/`violations` string** → `redactCredential` replaces the secret with `<redacted-credential>` on the write path before `writeFn`; the persisted envelope is token-free regardless of inner-evaluator prose compliance.
- **Credential rejected by the live SUT (expired/wrong token)** → surfaces as an exercised `unmet`/`needs-human` with response evidence; retryable only in the sense the whole exercise is — no rotation.

**Anti-pattern:** putting the token on the argv (`--credentials <token>`). Why: argv is visible in process listings and easily logged; the file-path indirection is the whole point, and `stage.js` already secret-classes a file named `credentials`/`credentials.json` for free.

**Anti-pattern:** echoing the parsed credentials object (or the spawn payload) into a diagnostic on error. Why: that is exactly the leak the runtime-only invariant forbids — name the path and failure class, never the value.

**Anti-pattern:** adding a `credentials` field to the written envelope or `assembleEnvelope`. Why: the verdict file is persisted to `.faff/holdout/<key>.json` and read by downstream gates; a credential there is a persisted secret. The allow-list in `assembleEnvelope` must stay closed.

**Failure modes.**

- **The failure — the invented shape doesn't match the first real occupant.** The `{ scheme, token }` shape is chosen with no in-repo occupant to validate it; the first token/preview `transport` might emit a differently-shaped object. — **How you'd know:** the first occupant lands and its `credentials` return doesn't satisfy `scheme=="bearer" ⇒ token`, or needs a header the switch has no case for. — **What it means:** narrow, not abandon. Because the seam is additive and dispatch is a single `switch`, the occupant either fits `bearer` or adds a `case` + a `SKILL.md` bullet; the absent-credentials and existing-scheme paths stay byte-identical. The extension cost is one branch, by design.
- **The failure — a credential leaks into a persisted/logged surface despite the invariant.** — **How you'd know:** the new redaction test (credential value absent from the written envelope and from captured stderr) fails, or a grep of `.faff/holdout/*.json` finds the token. — **What it means:** blocker; the allow-list envelope and the "name the path not the value" diagnostic rule are the guards — fix the leak before merge.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given evaluate-call.mjs is invoked with NO --credentials flag and a handle carrying no credentials
When the spawner runs to a written verdict
Then every argument, request, spawn payload, and output byte is identical to the pre-FAFF-852 behaviour
```

```
Given a --credentials FILE whose JSON is { "scheme": "bearer", "token": "abc123" }
When the spawner parses it and threads it to the inner evaluator, and deriveAuthHeaders is applied
Then the outbound requests carry header Authorization: "Bearer abc123"
```

```
Given a --credentials FILE that does not exist, or contains invalid JSON, or contains a JSON array/string/number
When the spawner reads it
Then main() returns EXIT.USAGE (2), spawns nothing, and writes no verdict file
```

```
Given a credentials object with scheme "bearer" but an empty or missing token
When deriveAuthHeaders is applied
Then it returns {} (no Authorization header); the spawner still spawns normally, and the inner
     evaluator records needs-human (credentials present, no header derivable) rather than a bare send
```

```
Given --credentials { "scheme": "bearer", "token": "sekret" } and an inner verdict whose
      violations contains the string "401 for Authorization: Bearer sekret"
When main() assembles and writes the envelope
Then redactCredential runs before writeFn and the written .faff/holdout/<key>.json contains
     "<redacted-credential>", never the substring "sekret"
```

Non-functional assertions:

- The parsed credentials object MUST NOT appear in the written verdict envelope or in `.faff/holdout/<key>.json` — not as a field, and not as a substring inside `aggregate`/`violations` (the scrub is the structural guarantee).
- `redactCredential` MUST be idempotent and MUST scrub only the secret value (not structural fields), asserted in `--selftest`.

## 6. Design Decision Rationale

**Should this ship now (ahead of any token/preview occupant) or wait for the first one?**
- *Wait:* avoids inventing a shape with no consumer to validate it (YAGNI).
- *Ship now:* the seam is narrow, additive, and backward-compatible — absent `credentials` is byte-identical to today, so it carries zero risk to existing runs and unblocks the first occupant instead of coupling it to evaluator surgery. The only real risk (wrong shape) is bounded by the additive `switch` extension point.
- **Chosen:** Ship now as a ready seam. The byte-identical guarantee removes the downside of building ahead, and it mirrors how FAFF-817 shipped the producer half ahead of a consumer. *(decides: architecture)* — closed, not punted.

**What concrete shape should the opaque `credentials` object take?**
- *Generic `{ header, value }`:* maximally flexible but leaks transport concerns into the evaluator and offers no validation.
- *`{ scheme, token }` with a `scheme` discriminator:* self-describing, validatable, extensible via new `scheme` values, and matches the ticket's own `Authorization: Bearer <token>` example.
- **Chosen:** `{ scheme: "bearer", token }` as the v1 scheme, deriving `Authorization: Bearer <token>`; `scheme` is the extension discriminator and unknown values derive no header (fail-closed at exercise). Additional keys are ignored, keeping the object forward-compatible. This is the genuinely new decision and it is closed here, not punted — the additive `switch` makes a wrong guess cheap to extend.

**Credential lifetime / rotation within a run.**
- *Rotation/refresh:* no mechanism exists anywhere in the repo; every secret is read-once-at-spawn/provision for the process lifetime, and the evaluator env is ephemeral and `--deadline`-bounded.
- **Chosen:** Single read-at-spawn, held for the (short, ephemeral, deadline-bounded) run; no rotation. Documented as an extension point in OUT OF SCOPE. Consistent with all existing secret handling.

**Where does the scheme→header derivation live?**
- *Inline in the inner evaluator prose only:* no deterministic coverage, drifts easily.
- *A pure `deriveAuthHeaders` helper in `evaluate-call.mjs`:* matches the file's existing pure-core + `--selftest` pattern (`deriveAttestation`, `assembleEnvelope`, `mapSpawnStatusExit`), gives the shape decision test coverage, and is the canonical mapping the `SKILL.md` prose mirrors.
- **Chosen:** A pure `deriveAuthHeaders` helper covered by `--selftest`, with the `SKILL.md` exercise clause mirroring it. It is the single source of truth for the header **shape** only — the security-relevant fail-*posture* (credentials present but no header derivable → `needs-human`) is inner-evaluator prose, not derivable from the helper's `{}` return (which also covers the absent-credentials no-op). The two are deliberately distinct: header shape is deterministic and testable; the exercise-time routing decision is the LLM's.

**How is the never-persisted invariant enforced — allow-list, or an active scrub?**
- *Rely on `assembleEnvelope`'s field allow-list:* blocks a new named `credentials` field but not the token echoed into the inner-authored `aggregate`/`violations` free text it copies verbatim (`evaluate-call.mjs:90`,`:92`) — the invariant would rest on unenforced inner-evaluator prose.
- *Active spawner-side scrub:* the spawner holds the token value, so it is the trusted boundary that can guarantee the secret never reaches disk regardless of inner-evaluator compliance.
- **Chosen:** a pure `redactCredential(envelope, credentials)` run unconditionally on the write path before `writeFn`, replacing the secret value with `<redacted-credential>` in every inner-authored free-text field. This makes "never persisted" structural and deterministically testable (inject a token-echoing inner verdict, assert the written envelope is token-free), rather than a prose promise. This is the fix for the round-1 infosec/QA reject-approach: the allow-list guards a field, the scrub guards the surface.

## 7. Open Questions and Assumptions

**Open Questions.** None. Both of the ticket's open questions ((a) ship-now-vs-defer, (b) lifetime/rotation) are closed above with `**Chosen:**`, and the new shape decision is likewise closed.

**Assumptions.**

- **Assumes:** the env-handle's `credentials` object is opaque with no upstream-fixed shape (FAFF-817 punted it; `env-handle.schema.json:29` declares `credentials: object` with no sub-schema; `contract-defs.js` carries it unvalidated). *Validation:* confirm `env-handle.schema.json:29` still declares `credentials` optional and sub-schema-free, and that no `transport` occupant in the repo already emits a conflicting shape (`grep -rn "credentials" plugin/skills/faffter-*-transport-*`), before relying on `{ scheme, token }`.
- **Assumes:** `assembleEnvelope` still allow-lists envelope fields (does not spread the inner verdict). *Validation:* re-read `evaluate-call.mjs:87-97` — confirm only the six named fields plus optional `attestation` are copied, so `credentials` cannot reach the envelope.

## 8. DONE — Definition of Done

### From WHY
- [ ] With no `--credentials` and no handle credentials, the spawner's arguments, spawn payload, requests, and outputs are byte-identical to pre-FAFF-852 (a test asserts the payload has no `credentials` key when the flag is absent, and that `redactCredential` is a no-op).
- [ ] No credential value appears in `.faff/holdout/<key>.json`, the verdict envelope, any log line, or the tracker — enforced structurally by `redactCredential` on the write path, not by inner-evaluator prose alone.
- [ ] `redactCredential(envelope, credentials)` scrubs the secret value from `aggregate` and every `violations` entry to `<redacted-credential>` before `writeFn`; is idempotent; scrubs only the secret (not structural fields); is a no-op when credentials absent; covered by `--selftest`.

### From WHAT (types and interfaces)
- [ ] `parseArgs` accepts `--credentials FILE`, storing the path in `a.credentials` (mirrors `--spec`/`--intent`); the `--selftest` `parseArgs` assertion covers it.
- [ ] The spawn payload passed to `spawnFn` includes the parsed `credentials` object when the flag is present, and omits it (or `undefined`) when absent.
- [ ] `assembleEnvelope` is unchanged and a test asserts `credentials` never appears in the written envelope.

### From HOW (behaviour)
- [ ] Reading `--credentials` mirrors `--intent`: `readFileSync` failure → `EXIT.USAGE`; `JSON.parse` failure → `EXIT.USAGE`; a parsed non-object (null/array/scalar) → `EXIT.USAGE`; each emits a diagnostic naming the path and failure class, never the value.
- [ ] `deriveAuthHeaders({ scheme: "bearer", token: T })` returns `{ Authorization: "Bearer <T>" }`; covered by `--selftest`.
- [ ] `deriveAuthHeaders` returns `{}` for absent/empty credentials, an unknown `scheme`, and a `bearer` with missing/empty `token`; covered by `--selftest`.
- [ ] `SKILL.md` §exercise (:38) instructs the inner evaluator to attach the derived headers to every outbound request, runtime-only and never logged, and to record `needs-human` (not a silent unauthenticated `unmet`) on any credentials-present-but-no-header-derivable case (unknown scheme OR empty/missing token on a known scheme). Absent credentials exercises bare, unchanged.

### From HOW (edge cases)
- [ ] An `EXIT.USAGE` credentials failure spawns nothing and writes no verdict (asserted with a must-not-spawn stub, per the `test/evaluate-call.test.mjs:71-83` pattern).
- [ ] `test/helpers/holdout-exercise.mjs` `exercise()` accepts an optional `headers` argument and forwards it to `fetch`, so the docker-gated integration test can drive an authenticated endpoint.

### From tests / redaction
- [ ] A new redaction test asserts the credential token value is absent from the captured stderr/stdout on both the success and the `EXIT.USAGE` paths, and from the written envelope.
- [ ] A redaction test injects an inner verdict whose `aggregate`/`violations` echo the token, and asserts the written `.faff/holdout/<key>.json` contains `<redacted-credential>` and never the token substring (the real leak surface, not just the spawner's own paths).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Write a temp spec (scratch()) and a temp credentials.json = { "scheme": "bearer", "token": "tok-smoke" }
  2. Call main(["--spec", spec, "--endpoint", "http://localhost:8080",
               "--credentials", credsPath, "--key", "K", "--out", out],
             { preflightFn: () => ({ holds: true, refusals: [] }),
               spawnFn: async (payload) => { capturedPayload = payload; return { status: "ok", verdict: innerBlind }; } })
  3. ASSERT exit === EXIT.OK
  4. ASSERT capturedPayload.credentials deep-equals { scheme: "bearer", token: "tok-smoke" }
  5. ASSERT deriveAuthHeaders(capturedPayload.credentials) === { Authorization: "Bearer tok-smoke" }
  6. ASSERT the written verdict file JSON has no "credentials" key and its text does not contain "tok-smoke"
  7. Re-run with spawnFn returning verdict whose violations=["saw Authorization: Bearer tok-smoke"];
     ASSERT the written file contains "<redacted-credential>" and never "tok-smoke"
```

The `{ scheme, token }` shape is still `confidence: high`; the round-1 reject-approach (infosec/QA) is resolved in place by promoting the never-persisted invariant from a field allow-list to an active spawner-side scrub, aligning the fail-posture, and adding the token-echoing inner-verdict test.

confidence: high
spec-review: approve
build-tier: complex
