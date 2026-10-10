# FAFF-1179 — Request grants from the governor and fail closed when it cannot be reached

> Spec: faffter-dark-nlspec · 2026-10-10 · interactive · claude-code/unknown · build-tier: complex · confidence: high. Full spec on Linear FAFF-1179. · revised 2026-10-10 (spec-review r1) · narrowed 2026-10-10

This is the build spec for FAFF-1179, re-cut against ADR 0135 (Accepted, binding). It is written for the build agent that will implement the runner-side governor client, and for the human reviewers who gate the spec. It assumes the reader knows faff's Commissaire ledger (schema:3 records, the HMAC/Ed25519 split, `appendRecordsUnderLock`) and has ADR 0135 to hand.

## 1. WHY — Problem and Principles

**The load-bearing idea.** Today the same process that authors ledger records also signs the grants over them: `commissaire contract admit` mints an Ed25519 key pair plus an HMAC master into `<run>/commissaire/governor/governor.json`, and the runner reads that file back in `effect authorize` and `verdict conclude` to sign its own verdicts. A runner that holds the signing key can grant itself anything. This ticket moves the signing key out of an honest runner's reach: when a governor is configured, the three facade verbs ask a separate governor process for the signed records and append what it returns, so the runner holds only `K_producer` and the public key. Nothing else in the custody story changes meaning; the mechanism is "ask instead of sign, and stop if you cannot ask."

**Problem statement.** The runner can forge its own grants because it holds `SK_commissaire`, which is the FAFF-1027 threat model. FAFF-1177 shipped the governor server but nothing on the runner talks to it, and faff has no switch that points at one. This ticket adds the runner-side client, the `commissaire.governor` switch, the `custody` label, append-with-retry under the ledger lock, record verification, and fail-closed behaviour when the governor cannot be reached. It is one layer of the FAFF-1027 defence, not the whole of it (see the no-fallback principle below).

**Design principles.**

**A configured governor never falls back to in-process signing under honest operation (ADR 0135, decision 1).** If a run is configured for a governor and the governor cannot be reached, the run stops. There is no same-user tier and no silent degrade. Within this ticket's mechanism — an honest runner that does not tamper with its own switch — any code path that would sign in-process while a governor is configured is a defect, not a fallback.

**The switch is not, on its own, a boundary against a dishonest runner.** The switch is runner-influenceable: it is read from the `COMMISSAIRE_GOVERNOR` env var and the working-tree `.faffrc.yaml`, both of which a dishonest runner controls. A runner that wants to sign in-process can simply unset the switch and admit ungoverned. So this ticket does not by itself defeat the FAFF-1027 threat; it removes in-process signing from honest runs and gives honest runs a verifiable custody record. Defence against a dishonest runner flipping the switch is downstream enforcement: FAFF-1219 strict mode, which reads the required governor pins from the base branch (not the working tree the runner controls) and rejects a run whose custody does not match the pin. State this honestly in review; do not claim the switch alone closes FAFF-1027.

**The runner never fabricates or admits a ledger line it did not receive intact and verify.** The runner appends exactly the signed record the governor returned, at the position the governor signed it for, under the ledger lock, and only after verifying its signature. A partial or mid-flight response, or one whose signature does not verify, is discarded, never appended. This keeps the chain honest against races, transport faults, and a substituted or attacker-anchored key.

**Ungoverned bytes are frozen.** Runs with no governor configured keep today's `in-process` custody and must produce byte-identical ledger records, so the frozen replay fixture and the banked `schema:3` evidence verify unchanged. Any change that alters an in-process record's bytes is out of bounds.

**Commissaire stays import-independent of faff (ADR 0135, decision 11).** The new client is faff code and may read faff config; the governor server (`governor.ts`) must not reach into it, and the client must stay out of the standalone binary's denylisted closure and must not require `config.js`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (committed `.js` emit) | The facade verbs `admit`, `request-decision`, `verdict conclude`; the one in-process signing seam this ticket branches |
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript | `buildEnvelope`, `deriveKey`, `signRecord`/`verifyRecord`, `signDecision`/`verifyDecision`, `pkFingerprint` — the record and crypto primitives |
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript | FAFF-1177 server; the wire protocol the client speaks to |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `appendRecordsUnderLock` — the lock and position-assertion the append uses |
| `plugin/skills/faff/bin/lib/budget.js` | JavaScript (governance region) | `readGovernanceConfig` — the base-config reader the switch is read through |
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | `computeConfigCheck` known-namespace lint; the recognised-namespace set |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | `ensureOwnerOnlyDir`, `writeOwnerOnlyJson` — the owner-only (0700/0600) writers for the client-written key material |
| `plugin/skills/faff-beep-boop/SKILL.md` | Skill prose | The FAFF-1140 fail-closed run-start path this ticket's run-start admit feeds |
| `records/adr/0135-commissaire-governor-runs-out-of-process-opt-in-with-pinned-keys.md` | ADR (Accepted) | The binding decisions, cited throughout |

**Scope statement.** This is the faff-owned runner client and switch (ADR 0135's FAFF-1179 row); the governor process, the trust file, the verify function, pinning, strict mode, and Gate 1 counting are other tickets.

## 2. OUT OF SCOPE

- **Governor-side verification of producer records.** `audit verify` on a governor run reports producer records as `unverifiable_without_secret`, because only the governor holds the master. Both prototypes showed this. Do not make `audit verify` require or read the `custody` label. Extension point: FAFF-1178 (the verify function).
- **The governor process itself.** admit/authorize/conclude server behaviour, key generation, rotation, per-run masters, the chain and position checks, and durable (on-disk) admission state. Shipped by FAFF-1177 in `governor.ts`; this ticket is only its client.
- **The trust file, pins, strict mode, and the verify function.** `.commissaire/trust.toml`, `governor_key_fingerprints`, `require_pinned_governor`, pinned/unpinned/in-process classification. Strict mode is the downstream enforcement that turns the runner-influenceable switch into a boundary against a dishonest runner. Extension points: FAFF-1210 (trust file), FAFF-1178 (verify), FAFF-1212 (call sites), FAFF-1219 (strict mode).
- **Gate 1 counting and the `independence` label.** Whether a governed run counts as evidence. Extension point: FAFF-1182.
- **The peer-credential caller check on the socket.** The server accepts any connection today. Extension point: FAFF-1211.
- **TCP transport confidentiality.** This ticket's TCP path carries `K_producer` and the ledger in cleartext; the new signature verification is the integrity backstop, but on-the-wire confidentiality (TLS or an equivalent) is deferred. Extension point: FAFF-1181 (the Fly deployment and a reachable remote endpoint).
- **Setting the override env var inside the cage.** This ticket defines and honours the env override; claude-box's host launch that sets it is FAFF-1215.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Governor | A separate Commissaire process that holds the only signing key and returns signed records over a socket or TCP endpoint (FAFF-1177). |
| Custody | Who signed a run's Commissaire records: `in-process` (the runner, default) or `governor` (the separate process). A run's custody is fixed at admission and read from the admission record. |
| The switch | `commissaire.governor` in `.faffrc.yaml`: the governor endpoint. Absent means in-process. Runner-influenceable (see §1). |
| Client mode | The runner-side behaviour when the switch resolves to an endpoint: ask the governor instead of signing in-process. |
| Lost race | Another appender took the chain position the governor signed for, before the runner could append. The signed record is now orphaned. |
| Park | The run stops this unit with a recorded, named reason and a needs-human andon event, exiting non-zero, rather than writing a verdict. |

**The resolved switch.**

```
RECORD GovernorEndpoint:
  kind: "unix" | "tcp"        # by shape of the string (below)
  socket_path: Path           # when kind == "unix"
  host: string                # when kind == "tcp"
  port: integer               # when kind == "tcp"; 1..65535

ENUM Custody: "in-process" | "governor"
```

**Endpoint string shape (the switch value).** A string with no `:` host-port separator, or an absolute/relative filesystem path, is a Unix socket path (`kind: "unix"`). A string of the form `host:port` with an integer port is TCP (`kind: "tcp"`). A `.sock` suffix is always a Unix path even if it somehow parses as host:port. A value that is neither a usable path nor a valid `host:port` is a configuration fault (below), never a silent in-process fallback.

**Decision — endpoint shape.** The governor already defaults to a Unix socket and optionally listens on TCP (FAFF-1177); the client must reach both. **Chosen:** accept both forms, discriminated by the string's shape as above, matching the server's two listen modes. A single form would leave Fly (TCP) or local (Unix) unreachable.

**The custody label on records.**

`buildEnvelope` (`producer-auth.ts`) builds the schema:3 envelope and has no `custody` field; the governor already puts `custody: "governor"` inside the *admission* record's *payload*, not the envelope, and only on that record. Its `handleConclude` payload has no custody field. A new envelope field would change `buildEnvelope` and every record's bytes.

**Decision — where custody lives, and on which record.** **Chosen:** custody is a payload field written by the governor on the admission record only, as `payload.custody: "governor"`. A run's custody is authoritatively the admission record's `payload.custody`: `governor` on a governor run, absent on an in-process run. Conclude and other records carry no custody field; the run's custody is *read from the admission record*, never re-stamped on later records. This is forced by two constraints together:

- *Frozen bytes.* Adding any custody field to in-process records would change their bytes and break the replay fixture and the `not-applicable` golden tests, so in-process custody must be signalled by absence on the admission record.
- *Signature integrity.* The shipped FAFF-1177 governor stamps `custody: "governor"` only on the admission record; its `handleConclude` payload has no custody field, and §2 keeps the governor out of scope, so it will not be changed to stamp one. The runner cannot re-stamp a returned record either: any edit to a governor-signed record breaks its Ed25519 signature, which the runner must verify and preserve byte-for-byte before appending. So the conclude record genuinely cannot carry a custody field in scope.

`contract status` reports `in-process | governor` by reading the admission record's label (see §4). The governor already emits `payload.custody: "governor"` in its admission reply, so the admit path needs no re-stamping; no other path stamps custody. The earlier draft's requirement that the conclude record carry `payload.custody` is dropped as unachievable in scope (arch + infosec spec-review majors); see §6 for the rejected alternatives this closes.

**The switch read path.**

`readGovernanceConfig(root)` in `budget.js` (governance region) resolves the base config via `findConfig`, throws `legacy-config-name` on a mis-named file and `base-parse-error` on malformed content, returns `{}` when no rc exists, and otherwise returns the whole base document. `commissaire.ts` already imports it (FAFF-1140). The switch value is read with `dig(cfg, "commissaire.governor")` from `shared-infra`.

**Decision — read the switch through `readGovernanceConfig`, not `config.js`.** **Chosen:** read `commissaire.governor` via `readGovernanceConfig` in `budget.js`, as the DoD and ADR 0135 decision 11 require (Commissaire code must not import faff's config reader, and the client must stay denylist-clean). `config.js` is in the standalone binary's forbidden closure; `budget.js` is governance-region and already imported.

**Decision — config-check known namespace.** `computeConfigCheck` warns on unknown top-level keys, and `commissaire` is in neither `WRITABLE_NAMESPACES` nor `READ_ONLY_NAMESPACES`, so `faff config check` would flag `commissaire.governor` as a probable typo. **Chosen:** add `commissaire` to `READ_ONLY_NAMESPACES` in `config.js` (the set for keys faff reads via `dig` but `config set` does not write), which the recognised-namespaces drift selftest then asserts. It is not writable through `config set` (no `DEFAULTS` entry), so `WRITABLE_NAMESPACES` is left untouched.

**Decision — anchor the governor's key and verify every returned record.** The client persists `pk.json` and appends governor-returned records; without verification, a man-in-the-middle on the TCP endpoint (or a substituted socket) could anchor an attacker's key and hand the runner forged records it would persist and append. **Chosen:** the client verifies cryptographically before it trusts anything.

- *At admit*, after receiving the reply and before persisting or appending: verify the admission record's Ed25519 signature under the reply's `pk` using `verifyDecision(admission_record, pk)`, and verify `pkFingerprint(pk) === pk_fingerprint`. Only if both hold does the client persist `pk.json`/the producer file and append the admission record. A failure is fail-closed: refuse (exit 2), persist and append nothing. This anchors `pk.json` to a key that actually signed the admission, closing the attacker-key-anchoring path.
- *At authorize and conclude*, before appending the returned record: verify its Ed25519 signature under the already-held `pk.json` (`verifyDecision(record, pk)`). A failure is fail-closed: park, append nothing. This is the integrity backstop for the cleartext TCP transport (confidentiality deferred to FAFF-1181, §2).

**The admit reply the client writes.**

The governor's admit reply is `{ ok: true, custody: "governor", producer_id, k_producer_hex, pk, pk_fingerprint, admitted_scope, admission_record }`, where `admission_record` is signed at seq 0 with `prev = sha256(run_id)` and `payload.custody: "governor"`.

```
RECORD ClientAdmitWrite:                  # what client-mode admit writes to disk, after verification
  producer_file: <run>/commissaire/producer/producers/<id>.json   # owner-only (0600), dir 0700
    { producer_id, contract_revision, key_hex: k_producer_hex,
      pk, pk_fingerprint, admitted_scope, status: "admitted", admitted_at }
  pk_file: <run>/commissaire/producer/pk.json
    { pk, pk_fingerprint }                # MUST be written: audit verify checks commissaire records against it
  admission_record: appended to the (empty) ledger at seq 0, verbatim from the reply
  governor_file: NOT WRITTEN              # no governor.json, no sk, no master
```

**Owner-only key material.** The producer file carries `key_hex` (`K_producer`, a legitimate per-run symmetric key). It and the producer directory are written owner-only via `ensureOwnerOnlyDir` (0700) and `writeOwnerOnlyJson` (0600) from `shared-infra.js`, so another local user cannot read `K_producer` off disk. This matches how the in-process path already protects key material.

**Secret-free assertion (what "no secret" means).** On a governor run, after admit, none of the following exists under the run dir or in the runner's environment: `governor.json`, any `sk`/private-key field, `master_secret`, or a root secret. `key_hex` (which is `K_producer`, a per-run symmetric key the runner legitimately holds) is allowed and expected. **Chosen:** the test asserts the absence of `governor.json` and of any `sk`/`master_secret`/root-secret material under `<run>/commissaire/**` and in `process.env`, and the presence of `key_hex` in the producer file.

## 4. HOW — Behaviour

**Architecture and approach.** A new client module (factory region, with its committed `.js` emit) speaks the FAFF-1177 wire protocol: one newline-delimited JSON request per connection over a Unix socket or TCP, one reply. `commissaire.ts`'s three verbs branch on the resolved switch. In-process mode is unchanged. In client mode, the pair "`readGovernorRecord` + `appendCommissaireRecord(sk, …)`" is replaced by "ask the governor + verify the returned record + append it under the lock."

```
PROCEDURE resolve_governor(root, env):
  1. raw = env["COMMISSAIRE_GOVERNOR"]
  2. IF raw is set:
     a. IF raw == "": RETURN { configured: false }        # explicit disable wins
     b. RETURN parse_endpoint(raw)                         # env over rc
  3. cfg = readGovernanceConfig(root)                      # MAY THROW — see fail-closed
  4. value = dig(cfg, "commissaire.governor")
  5. IF value is absent/null: RETURN { configured: false } # in-process, unchanged
  6. RETURN parse_endpoint(value)
```

**Decision — env override name and precedence.** **Chosen:** the override is `COMMISSAIRE_GOVERNOR`. An env value wins over the rc file (env over rc); an empty string is an explicit "no governor" that forces in-process even when the rc names one (so a cage can disable it); unset defers to the rc. With no `.faffrc.yaml`, `readGovernanceConfig` returns `{}`, so the switch is absent and the run is in-process unless the env sets one. FAFF-1215 sets this variable inside the cage. (Both env and rc are runner-influenceable — see §1; the switch is not a boundary against a dishonest runner on its own.)

**Decision — read-error handling fails closed.** `readGovernanceConfig` throws on a legacy filename and on malformed content. **Chosen:** the switch resolver lets those throws propagate at the dispatch boundary (exit 2), the same loud failure the governance ceiling already gets. It never catches the throw and treats it as "no governor," because a malformed config must not silently drop a run from governor custody to in-process signing.

**Decision — contract status predicate rework.** Today `cmdContractStatus` sets `governed = fs.existsSync(governor.json)` and a literal `custody: "in-process"`. On a governor run there is no local `governor.json`, so it would report `governed: false`, and the beep-boop re-admit guard depends on this. **Chosen:** read the custody label from the admission record in the ledger, which is the authoritative source and is present for both custodies (`payload.custody: "governor"` for a governor run, absent for in-process). The predicate becomes: `custody = "governor"` when the admission record carries `payload.custody == "governor"`, else `"in-process"` when an admission record, a local `governor.json`, or a `pk.json` exists, else `null`; and `governed = custody != null`. This no longer depends on `governor.json` existing, correctly labels a governor-admitted run (which writes `pk.json` but no `governor.json`), and stays read-only (it reports what the ledger records, never probing the socket). The read is honest about its confidence: where `pk.json` is available the status read verifies the admission record's signature under it before reporting `governor`; where it is not, it reports the admission record's label as recorded. It never claims a stronger guarantee than the bytes on disk support.

### Admit in client mode

Behaviour summary: ask the governor to admit this run, verify the reply, write the reply's producer key and public key locally (owner-only), append the reply's signed admission record to the empty ledger, write no secret.

```
PROCEDURE client_admit(runDir, producerId, contractRevision, scope, endpoint, force):
  1. Local re-admit guard: IF producer_file OR pk.json already exists AND NOT force:
       refuse (exit 2) — re-admit would orphan prior records (same guard as in-process admit)
  2. Send { op: "admit", run_id, producer_id, contract_revision, admitted_scope }
  3. IF unreachable: fail per unreachable semantics (admit path)
  4. IF reply is a refusal { ok: false, reason }: exit 2, print the reason
  5. VERIFY (fail-closed; on failure refuse exit 2, persist and append nothing):
       a. verifyDecision(reply.admission_record, reply.pk) is true
       b. pkFingerprint(reply.pk) === reply.pk_fingerprint
  6. Write producer_file (key_hex from reply) and pk.json (pk + pk_fingerprint from reply),
       owner-only: ensureOwnerOnlyDir on the producer dir (0700), writeOwnerOnlyJson (0600)
  7. Append reply.admission_record to the ledger VERBATIM under the lock:
       mintOne returns the record as-is; its seq is 0 and prev == sha256(run_id)
  8. DO NOT write governor.json
  9. Print { admitted: true, producer_id, admitted_scope, pk_fingerprint, custody: "governor" }
```

**Decision — the "`--governor-dir` and `--producer-dir` must differ" check and the re-admit guard in client mode.** In-process admit refuses when `governor-dir == producer-dir` (so the SK and a producer key never share one custodian) and refuses re-admit when `governor.json` or the producer file exists. In client mode there is no local SK and no `governor.json`. **Chosen:** in client mode skip the dirs-must-differ check (there is no governor dir to collide), and gate the re-admit guard on the producer file and `pk.json` only (the governor server's admit is not idempotent and a second admit would mint a fresh key and orphan prior records, so the client must refuse locally without `--force`).

### Authorize in client mode

Behaviour summary: append the producer-HMAC'd request as today, then ask the governor to sign the verdict at the next chain position, verify the returned verdict under `pk.json`, then append it under the lock; on a lost race, re-read the tail and ask again, up to three further times, then park.

```
PROCEDURE client_authorize(runDir, producerId, unit, step, payload, endpoint):
  1. Append the effect-decision-request (producer HMAC under K_producer), as in-process does.
     Remember request_seq.
  2. attempts = 0
  3. LOOP:
     a. Re-read the ledger tail: compute (seq, prev) for the next position.
     b. Send { op: "authorize", run_id, producer_id, unit_id, step,
               ledger: <raw NDJSON bytes of the ledger, physical lines>,
               at: { seq, prev }, request_seq, effect, declared_ref, evidence_seq,
               level, attended, holdout }
     c. IF unreachable: park (reason: "governor-unreachable-at-authorize"); RETURN
     d. IF reply.ok == false:
        - reason == "position-mismatch": lost race → go to (g)
        - reason == "ledger-not-extending-head": PERMANENT (truncation, not a race) →
            park (reason: "ledger-not-extending-head"); RETURN
        - reason == "producer-not-admitted": the governor has no admission for this run
            (e.g. it restarted and lost its in-memory state) → park
            (reason: "governor-admission-lost"); RETURN   # see Failure modes
        - any other refusal: print it, exit non-zero (the governor declined; not a race)
     e. IF reply.ok == true:
        - VERIFY verifyDecision(reply.verdict_record, pk) under the held pk.json.
          IF it fails: park (reason: "governor-record-unverified"); RETURN   # fail-closed, append nothing
     f. Append reply.verdict_record under the lock. In the mint callback, IF the lock-assigned
        (seq, prev) != the record's (seq, prev): RETURN null from the callback (abort cleanly,
        write nothing) and treat as a lost race → go to (g). Otherwise the append succeeds; RETURN
        the verdict.
     g. attempts += 1
        IF attempts > 3: park (reason: "governor-lost-race"); RETURN
        ELSE continue LOOP   # re-read tail, re-send with the same request_seq
```

**Decision — what counts as a lost race, re-send shape, and the retry cap.** **Chosen:** a lost race is either a `position-mismatch` refusal from the governor or a local detection in the append callback that the lock-assigned `seq`/`prev` differ from what the governor signed. On a lost race the runner re-reads the tail for a fresh `(seq, prev)` and re-sends the authorize request reusing the same `request_seq` (the already-appended request record), so the governor selects the existing request rather than demanding a new one. The retry cap is the ADR wording "requests again, at most three times": the initial attempt plus up to three further attempts, four in total, then park. `ledger-not-extending-head` is a permanent condition (the chain was truncated), not a race, so it parks immediately without consuming a retry. `producer-not-admitted` is also permanent in scope (see Failure modes) and parks immediately as `governor-admission-lost`.

**Anti-pattern:** letting the append throw on a position mismatch. Why: `appendRecordsUnderLock` throws an untyped `Error` when a minted record's `seq`/`prev` differ from the position it assigns under the lock, which is not a clean, branchable lost-race signal. The callback must compare and return `null` (which aborts the whole batch and writes nothing) so the loop can retry, never rely on the throw.

**Anti-pattern:** re-serialising the ledger before sending it. Why: the governor re-verifies the hash chain and every HMAC over the exact bytes; a JSON round-trip would reorder keys or restyle whitespace and fail chain verification. Send the physical ledger lines verbatim.

### Conclude in client mode

Behaviour summary: run the local preconditions as today, then ask the governor to sign the conclusion at the next position, verify the returned record under `pk.json`, and append under the lock with the same lost-race retry as authorize. An idempotent reply returns the already-recorded sequence without appending.

```
PROCEDURE client_conclude(runDir, unit, endpoint):
  1. Run the existing local preconditions (producer admitted, no unreconciled escape,
     evidence present, grant coverage). A refusal exits as today — NEVER falls back to in-process.
  2. Compute (seq, prev); send { op: "conclude", run_id, unit_id, producer_id,
     ledger: <raw NDJSON bytes>, at: { seq, prev } }
  3. IF unreachable: park (reason: "governor-unreachable-at-conclude"); RETURN — no verdict written
  4. IF reply is a refusal:
     - reason == "producer-not-admitted": park (reason: "governor-admission-lost"); RETURN
     - otherwise: surface it as the matching in-process refusal verb (exit per refuseVerdict)
  5. IF reply.idempotent is true: the conclusion is ALREADY in the ledger. RETURN its existing seq,
     exit 0 (matching in-process conclude idempotency). DO NOT append and DO NOT enter the lost-race
     retry — the record is already at its signed position, so re-appending would fail the position
     check and park spuriously as "governor-lost-race".
  6. ELSE (fresh reply.ok): VERIFY verifyDecision(reply.record, pk) under the held pk.json.
     IF it fails: park (reason: "governor-record-unverified"); RETURN — fail-closed, append nothing.
     Append reply.record under the lock with the authorize lost-race retry
     (up to three further attempts, then park "governor-lost-race").
```

Note: the conclude record carries no `payload.custody` field. The run's custody is read from the admission record (§3); neither the governor nor the runner stamps custody on the conclusion. See §6 for why this is unachievable in scope.

**Decision — conclude never degrades.** **Chosen:** a governor-mode conclude that cannot reach the governor parks; it does not sign a conclusion in-process. This is the no-fallback principle (honest-operation form, §1) applied to the terminal verdict, the most sensitive record in the run.

### Fail-closed at run-start admit

Behaviour summary: run-start branches first on whether a governor is configured. A run with no governor configured proceeds ungoverned (that is the zero-config default, not a fallback). A run with a governor configured that cannot reach it always stops via the FAFF-1140 fail-closed path, whether or not governance is "required".

```
PROCEDURE run_start_admit(runDir):
  1. endpoint = resolve_governor(runDir, env)
  2. IF NOT endpoint.configured:                 # zero-config default — ungoverned BY CONFIGURATION
       proceed ungoverned (in-process), unchanged. This is not a fallback: no governor was
       ever configured for this run, so ADR 0135 decision 1 (which binds only a CONFIGURED run)
       does not apply.
  3. ELSE (governor configured):
     a. Attempt client_admit against the endpoint.
     b. IF reachable: governed admit proceeds (client_admit above).
     c. IF unreachable: a configured governor that cannot be reached ALWAYS stops, whether or not
        governance is "required" (ADR 0135 decision 1 binds any configured run). Follow the
        FAFF-1140 fail-closed path (faff-beep-boop prose):
          - write <run>/commissaire/governance-required.json
          - append a park event { reason: "needs-human" }, pump the andon
          - owner.status: "done", stop_reason: "governance-admit-failed"
          - carry the governor endpoint in a detail field (governor: "<endpoint>") on the
            governance-required.json and the run-log line; DO NOT invent a new stop token
          - admitted: [], exit non-zero before the build step
```

**Decision — the run-start branches on "governor configured?" first.** ADR 0135 decision 1 binds whenever a governor IS configured for the run: configured + unreachable means the run stops, never in-process, whether or not governance is "required". The ticket's "an optional run proceeds ungoverned" is narrowed (operator decision, 2026-10-10) to mean only a run with NO governor configured — the zero-config default, which is ungoverned by configuration rather than a fallback. **Chosen:** make run-start resolve the switch first; a not-configured run proceeds ungoverned, and any configured + unreachable run stops via the FAFF-1140 path.

**Decision — the configured-but-optional run whose governor is unreachable (operator narrowing, 2026-10-10, ADR 0135 decision 1).** A run that HAS a governor configured but is not governance-required, when the governor is unreachable, is a configured + unreachable run like any other. **Chosen:** it always stops via the FAFF-1140 fail-closed path. The ticket's "an optional run proceeds ungoverned" is narrowed to the not-configured (zero-config) case only; a configured run that cannot reach its governor never degrades to in-process, matching ADR 0135 decision 1 with no ADR amendment. The procedure above has no separate optional branch — "governor configured + unreachable" is a single stop.

### Authorize unreachable on a governed run

Behaviour summary: the request record was already appended, no verdict follows, the chokepoint refuses for want of a grant, and the issue parks with a named reason.

The request record is appended first (step 1 of `client_authorize`), so on an unreachable governor there is a request with no verdict. The chokepoint already refuses an effect with no covering grant. **Chosen:** the park reason is `governor-unreachable-at-authorize`, recorded on the park event and the andon, distinct from the lost-race park (`governor-lost-race`), the restart park (`governor-admission-lost`), the verification park (`governor-record-unverified`), and the run-start refusal (`governance-admit-failed`), so an operator can tell them apart.

### Unreachable semantics

```
PROCEDURE is_unreachable(error):
  TRUE for: ENOENT on the socket path, ECONNREFUSED, connect timeout, read/reply timeout,
            and a mid-request disconnect (EPIPE/ECONNRESET) before a complete reply line.
```

**Decision — unreachable mapping, timeouts, and no partial append.** **Chosen:** connect failures (`ENOENT` on a Unix socket, `ECONNREFUSED`), a connect timeout, a reply timeout, and a mid-request disconnect all map to "unreachable." A connect timeout and a reply timeout are each bounded (a connect budget and a reply budget, read from config with conservative defaults, e.g. a few seconds each, overridable). A reply that does not parse as one complete JSON line, or that arrives after a disconnect, is discarded and treated as unreachable; the runner never appends a record it did not receive whole, and never appends one whose signature does not verify. Which verbs degrade: none. Admit-unreachable follows the run-start path (any configured + unreachable run stops); authorize- and conclude-unreachable park. No verb falls back to in-process signing.

**Decision — the client module's region and import independence.** **Chosen:** the client is a new factory-region module with a committed `.js` emit (ADR-0132), reached only from `commissaire.ts`. It must not require `config.js` (it reads the switch through `readGovernanceConfig` in `budget.js`, a legal factory→governance call), must not be required by `governor.ts`, and must stay out of the standalone binary's denylisted closure (`tracker`, `harness`, `engine`, `next`, `project-next`, `run-start`, `run-done`, `queue-state`, `lights-out`, `self-intake`, `scenario-matrix`). The import-independence guard and `faff regions check` must pass, and `faff commissaire …` and the standalone `commissaire …` must stay byte-identical.

### Failure modes

**The orphan verdict on a lost race.** A verdict the governor signs but the runner never appends (it lost the race and the position is now taken) is an orphan. The governor logs it; the runner drops it. How you would know: the governor's log shows a signed verdict whose position never appears in the run's chain. What it means: expected and benign — the retry re-reads the tail and asks for a fresh position, and the chokepoint and `audit verify` only ever accept a verdict at its signed position in an intact chain (ADR 0135, decision 4). Do not try to "rescue" an orphan by appending it at a different position; that would break the chain binding.

**Governor restart loses the admission (known limitation).** The FAFF-1177 governor holds `admissions`/`lastHead` in memory only (durable admission state is out of scope, §2). If the governor restarts between admit and a later authorize/conclude, it no longer recognises the run and replies `producer-not-admitted`. The runner cannot recover on its own: the local re-admit guard refuses a second admit (it would orphan prior records), and `--force` re-admit mints a fresh key and orphans the existing chain. How you would know: a governed run whose admit succeeded begins refusing authorize/conclude with `producer-not-admitted`. What it means: a recoverable-only-by-an-operator condition, not a silent wedge. **Chosen:** map `producer-not-admitted` at authorize/conclude to a distinct named park, `governor-admission-lost` (separate from `governor-lost-race`), so the operator recognises a governor restart rather than a chain race and can act (restart the run against a fresh admission, or restore durable governor state once FAFF-1177's follow-up ships it). This is stated as a known limitation of the in-memory governor, not solved here.

**A forged or substituted record.** A record whose Ed25519 signature does not verify under the anchored `pk` (at admit, under the reply's `pk` with a matching fingerprint; at authorize/conclude, under the held `pk.json`). How you would know: the client refuses at admit (`exit 2`, nothing persisted) or parks at authorize/conclude (`governor-record-unverified`, nothing appended). What it means: either a transport fault on the cleartext TCP path or an active attacker; either way the record never enters the ledger. This is the integrity backstop while transport confidentiality is deferred to FAFF-1181.

**Silent degrade to in-process.** The failure the whole ticket guards against under honest operation: a configured governor run that signs in-process because an error was swallowed. How you would know: the secret-free test finds `governor.json` or an `sk`/`master` under the run dir, or a governor-run admission record lacks `payload.custody: "governor"`. What it means: a defect to fix before merge, not a tolerated edge. (This is distinct from a dishonest runner deliberately unsetting the switch, which the switch cannot prevent and FAFF-1219 strict mode enforces downstream — see §1.)

**Custody absence misread as a bug.** The absence-means-in-process convention could be read by a future tool as "unlabelled" rather than "in-process." How you would know: a reader that treats a missing `custody` as an error rather than `in-process` would reject every pre-cutover and in-process record. What it means: document the convention at `contract status` and in the reader; the admission record is the single source of the label, and absence on it means `in-process`.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run with no commissaire.governor configured and no COMMISSAIRE_GOVERNOR env
When the run admits, authorizes an effect, and concludes
Then every Commissaire record is signed in-process, carries no custody field,
     and is byte-identical to today's ungoverned records
```

```
Given a run with commissaire.governor pointing at a reachable governor
When the run admits
Then the client verifies the admission record's Ed25519 signature under the reply's pk and that
     pkFingerprint(pk) matches pk_fingerprint, the admission record carries payload.custody: "governor",
     pk.json holds the governor's pk (owner-only), and no governor.json, sk, master, or root secret
     exists under the run dir or in the runner env
```

```
Given a reachable governor whose admit reply carries a record whose signature does not verify
     under the reply's pk, or whose pkFingerprint(pk) does not match pk_fingerprint
When the run admits
Then the client refuses (exit 2), persists no pk.json or producer file, and appends nothing
```

```
Given a governed run whose governor restarts and replies producer-not-admitted at authorize
When authorize is attempted
Then no verdict is written and the issue parks with reason "governor-admission-lost",
     distinct from governor-lost-race
```

```
Given a governed run whose conclude receives an idempotent reply (the conclusion is already recorded)
When conclude is attempted
Then the existing sequence is returned and the run exits 0 without appending or entering the
     lost-race retry
```

```
Given a governance-required run whose governor is unreachable at run-start admit
When admit is attempted
Then the run refuses before building: governance-required.json names the governor,
     stop_reason is "governance-admit-failed", admitted is [], and the run exits non-zero before the build step
```

```
Given a governed run whose governor is unreachable at conclude
When conclude is attempted
Then no conclusion is signed in-process and the issue parks; custody never falls back
```

- The frozen secret-free replay fixture and the banked `schema:3` evidence MUST verify unchanged through `audit verify`.
- `faff commissaire …` and the standalone `commissaire …` MUST produce byte-identical stdout, stderr, and exit codes; the import-independence guard and `faff regions check` MUST pass.

## 6. Design Decision Rationale

**Which endpoint forms does the switch accept?** Unix path only, TCP only, or both. The governor listens on a Unix socket by default and optionally on TCP (FAFF-1177); Fly is TCP, local is Unix. **Chosen:** both, discriminated by the string's shape (a `host:port` with an integer port is TCP; anything else, or a `.sock` suffix, is a Unix path). A single form would strand one deployment.

**Where does the custody label live, and on which record?** Options: (a) a new envelope field in `buildEnvelope`; (b) a payload field on the admission record only, with the run's custody read from it and absence meaning in-process; (c) a payload field on all admission and conclude records including a literal `in-process`; (d) the runner re-stamps or the governor stamps `payload.custody` on the conclusion. Option (a) changes every record's bytes and touches the governance-region primitive. Option (c) changes in-process admission and conclude bytes, breaking the frozen replay fixture and the `not-applicable` golden tests. Option (d) is unachievable in scope: the shipped FAFF-1177 governor stamps custody only on the admission record and its `handleConclude` payload has no custody field (and the governor is out of scope, §2), while the runner cannot re-stamp a returned record without breaking its Ed25519 signature — which it must verify and preserve byte-for-byte. **Chosen:** option (b). The governor stamps `payload.custody: "governor"` on the admission record; a run's custody is authoritatively that admission record's label, read (not re-stamped) wherever custody is needed; in-process runs are unlabelled and read as `in-process` by convention, which `contract status` reports. This closes the earlier draft's requirement that the conclude record itself carry `payload.custody` (an arch + infosec spec-review major): conclude custody is DERIVED from the admission record, never stamped on the conclusion. The rejected options are recorded so they are not re-proposed; (c) is only viable if the human relaxes the byte-identity and frozen-fixture acceptance criteria.

**How is the switch read?** Through `config.js` or through `readGovernanceConfig` in `budget.js`. **Chosen:** `readGovernanceConfig`, because Commissaire-adjacent code must not import faff's `config.js` (ADR 0135, decision 11) and the client must stay denylist-clean, and `budget.js` is governance-region and already imported by `commissaire.ts`.

**How does the client trust the governor's key and records?** Trust the reply as received, or verify cryptographically. The TCP path carries records in cleartext, so an unverified client could anchor an attacker's key at admit or append a forged verdict. **Chosen:** verify. At admit, check the admission record's Ed25519 signature under the reply's `pk` and that `pkFingerprint(pk) === pk_fingerprint` before persisting `pk.json` or appending; at authorize/conclude, check the returned record's signature under the held `pk.json` before appending. Any failure is fail-closed (refuse/park, never append). This closes the MITM / attacker-key-anchoring path raised as an infosec spec-review major and is the integrity backstop while transport confidentiality is deferred to FAFF-1181.

**What is the override's name and precedence?** **Chosen:** `COMMISSAIRE_GOVERNOR`, env over rc, empty string means explicit disable, unset defers to rc. The name matches the Commissaire-owned `COMMISSAIRE_KEY_DIR` convention from the server, and an explicit-disable empty value lets a cage force in-process without editing `.faffrc.yaml`. Both inputs are runner-influenceable; the switch is one honest-operation layer, not a boundary against a dishonest runner (FAFF-1219 strict mode is that boundary, §1).

**What does a lost race cover, and how many retries?** **Chosen:** a `position-mismatch` refusal or a local append-callback mismatch; re-read the tail and re-send with the same `request_seq`; the initial attempt plus up to three further attempts, then park. `ledger-not-extending-head` parks immediately (permanent, not a race). This reads ADR 0135 decision 5's "requests again, at most three times" literally and matches the prototype's second-attempt recovery.

**How does conclude handle an idempotent reply?** Append it like a fresh reply, or treat it specially. An idempotent reply returns the conclusion already in the ledger; appending it again would fail the position check and park spuriously as `governor-lost-race`. **Chosen:** branch on `reply.idempotent` — when true, return the existing seq and exit 0 (matching in-process conclude idempotency), appending nothing and skipping the lost-race retry. This closes the spurious-park spec-review major (arch + QA).

**What is the run-start stop reason?** A new governor-naming token or the pinned `governance-admit-failed`. **Chosen:** keep `governance-admit-failed` (pinned in `ESCALATE_STOP_EXACT` and the FAFF-1140 tests) and name the governor in a detail field. A new token would silently stop escalating.

**Does conclude ever degrade?** **Chosen:** never; an unreachable governor at conclude parks. The terminal verdict is the most sensitive record; a fallback here would defeat the custody boundary under honest operation.

**How does a governor restart surface?** Silently wedge, or a distinct park. **Chosen:** a distinct named park, `governor-admission-lost`, mapped from the governor's `producer-not-admitted` refusal, stated as a known limitation of the in-memory governor (durable admission state is out of scope). This gives the operator a recognisable signal rather than an unrecoverable silent wedge.

**Does run-start reconcile the ticket Done-when with ADR decision 1?** Yes, for every case. Branch on configured first: a not-configured run proceeds ungoverned; any configured + unreachable run stops. The operator narrowed the ticket (2026-10-10) so "an optional run proceeds ungoverned" means only the not-configured (zero-config) case, which resolves what was a Punt — a configured-but-optional run that cannot reach its governor now stops like any other configured run, matching ADR 0135 decision 1 with no ADR amendment.

## 7. Open Questions and Assumptions

**Resolved decisions.**

**Chosen — configured-but-optional run whose governor is unreachable at run-start (operator narrowing, 2026-10-10; ADR 0135 decision 1).** The operator narrowed the ticket: "an optional run proceeds ungoverned" means only a run with NO governor configured (the zero-config default). A run that HAS a governor configured and cannot reach it always stops via the FAFF-1140 fail-closed path, whether or not governance is "required", matching ADR 0135 decision 1 with no ADR amendment. Run-start carries no configured-but-optional branch: not-configured → ungoverned; any configured + unreachable → stop. No open decisions remain.

One decision carries a DoD-wording note rather than an open question: the custody label is written as `payload.custody: "governor"` on the admission record only, with in-process custody signalled by absence and conclude custody derived from the admission record (see §3 and §6). This is the only reading consistent with the "ungoverned runs byte-identical" and "frozen fixture verifies unchanged" criteria and with the shipped governor's record set. If a reviewer requires a literal `payload.custody` on the conclude record, that is a change to both the byte-identity criterion and the FAFF-1177 governor scope and should be raised before build.

**Assumes.**

- **Assumes:** a reachable governor endpoint exists for any governed run under test (FAFF-1177's `governor.ts` behind `commissaire governor start`, locally over a Unix socket). Validation: before building, confirm `governor.ts` and its committed `.js` are present and that `commissaire governor start` stands up a socket the client can connect to; the unreachable-path tests need only an absent or refused socket, which needs no running server.

## 8. DONE — Definition of Done

### From WHY
- [ ] A governed run holds only `K_producer` (`key_hex`) and the public key; no `SK_commissaire` or master is read by the runner at authorize or conclude.
- [ ] Under honest operation, a configured governor never falls back to in-process signing on any path (admit, authorize, conclude).
- [ ] The spec and review state honestly that the switch is runner-influenceable and that defence against a dishonest runner flipping it is downstream enforcement (FAFF-1219 strict mode reading pins from the base branch), not this switch on its own.

### From WHAT (switch and config)
- [ ] `commissaire.governor` in `.faffrc.yaml` turns the governor on; absent means in-process, unchanged.
- [ ] The switch value is read through `readGovernanceConfig` in `budget.js`; `config.js` is not imported by the client.
- [ ] A Unix-path value and a `host:port` value both resolve to a usable endpoint; a malformed value is a config fault, never a silent in-process fallback.
- [ ] `COMMISSAIRE_GOVERNOR` overrides the rc value (env over rc); an empty value forces in-process; unset defers to rc; a missing `.faffrc.yaml` is in-process.
- [ ] `readGovernanceConfig` throwing (`legacy-config-name`, `base-parse-error`) fails closed (exit 2), never degrades to in-process.
- [ ] `commissaire` is a recognised namespace in `config.js`, so `faff config check` does not warn on `commissaire.governor`; the recognised-namespaces drift selftest passes.

### From WHAT (custody and records)
- [ ] The governor-custody admission record carries `payload.custody: "governor"`; a run's custody is read from the admission record, and no later record (conclude included) carries a custody field.
- [ ] In-process admission records carry no custody field and are byte-identical to today; in-process conclude records are byte-identical to today.
- [ ] `contract status` reads custody from the admission record (`payload.custody: "governor"` → `governor`, absent → `in-process`), labels a governor-admitted run correctly, and `governed` no longer depends on `governor.json` existing; where `pk.json` is available it verifies the admission signature before reporting `governor`, and never claims more than the bytes support.
- [ ] Client-mode admit verifies the admission record's Ed25519 signature under the reply's `pk` and that `pkFingerprint(pk) === pk_fingerprint` before persisting or appending; a failure refuses (exit 2) and writes nothing.
- [ ] Client-mode admit writes the producer file (with `key_hex`) and `pk.json` owner-only (dir 0700 via `ensureOwnerOnlyDir`, files 0600 via `writeOwnerOnlyJson`), appends the reply's admission record at seq 0, and writes no `governor.json`.
- [ ] On a governor run, no `governor.json`, `sk`, `master_secret`, or root secret exists under the run dir or in the runner's env (tested); `key_hex` is present.

### From HOW (behaviour)
- [ ] Client-mode admit refuses re-admit without `--force` when the producer file or `pk.json` exists, and skips the `--governor-dir`/`--producer-dir` must-differ check.
- [ ] Client-mode authorize appends the producer request, then verifies the governor-signed verdict under `pk.json` and appends it under the ledger lock at the position the governor signed; a verification failure parks `governor-record-unverified` and appends nothing.
- [ ] The ledger is sent to the governor as raw physical NDJSON bytes, not re-serialised.
- [ ] A lost race (`position-mismatch` or a local append-callback mismatch) re-reads the tail and re-sends with the same `request_seq`, up to three further attempts, then parks with reason `governor-lost-race`.
- [ ] The append callback returns `null` on a position mismatch (clean abort, nothing written), never relying on the lock's thrown `Error`.
- [ ] `ledger-not-extending-head` parks immediately with that reason, without consuming a retry.
- [ ] A `producer-not-admitted` refusal at authorize or conclude parks with reason `governor-admission-lost`, distinct from `governor-lost-race`, documented as the in-memory-governor-restart limitation.
- [ ] Client-mode conclude runs the local preconditions; on an idempotent reply it returns the existing seq and exits 0 without appending or retrying; on a fresh reply it verifies the record under `pk.json` and appends under the lock with the same lost-race retry; it never stamps a custody field on the conclusion.

### From HOW (fail-closed and unreachable)
- [ ] Run-start branches on "governor configured?" first: a not-configured run proceeds ungoverned (in-process) as the zero-config default; any configured + unreachable run refuses, whether or not governance is "required".
- [ ] A governance-required run with an unreachable governor at run-start admit refuses via the FAFF-1140 path: `governance-required.json` (naming the governor), a `park` needs-human andon, `owner.status: "done"`, `stop_reason: "governance-admit-failed"`, `admitted: []`, non-zero exit before the build step.
- [ ] A configured + unreachable run always stops, whether or not governance is "required" — including the configured-but-optional case, which is narrowed to a stop (operator decision 2026-10-10, ADR 0135 decision 1) and never degrades to in-process.
- [ ] An unreachable governor at authorize appends the request, writes no verdict, the chokepoint refuses, and the issue parks with reason `governor-unreachable-at-authorize`.
- [ ] An unreachable governor at conclude writes no in-process conclusion and parks with reason `governor-unreachable-at-conclude`.
- [ ] `ENOENT`/`ECONNREFUSED`, connect timeout, reply timeout, and mid-request disconnect all map to unreachable; no record is appended that was not received whole or whose signature does not verify.

### From HOW (import independence)
- [ ] The client is a factory-region module with a committed `.js` emit; it does not require `config.js`, `governor.ts` does not require it, and it stays out of the denylisted closure.
- [ ] The import-independence guard, `faff regions check`, and `faff commissaire`/standalone `commissaire` byte-identity all pass.

### From Scenarios (verification)
- [ ] The frozen secret-free replay fixture and the banked `schema:3` evidence verify unchanged through `audit verify`.
- [ ] On a governor run, `audit verify` classifies every producer record as `unverifiable_without_secret` (not `failed`), unchanged from the no-governor fixture; `audit verify` does not read the `custody` label.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Start a local governor on a Unix socket; set commissaire.governor to its path.
  2. faff commissaire contract admit → assert the admission record verifies under the reply pk,
     payload.custody "governor" on the admission record, pk.json written owner-only,
     no governor.json under the run dir.
  3. faff commissaire effect declare + authorize an allowed effect → assert the governor-signed
     verdict verifies under pk.json and is appended at the next chain position.
  4. faff commissaire verdict conclude → assert a conformed_to_contract record is appended (no custody
     field on it), and that contract status reports custody "governor" by reading the admission record.
  5. audit verify → assert pass with producer records unverifiable_without_secret.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "markers_valid": true,
  "violations": [],
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
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```