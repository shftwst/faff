# FAFF-1177 — The out-of-process Commissaire governor (server side)

> Spec: faffter-dark-nlspec · 2026-10-08 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1177.

Revised on 2026-10-08 after spec-review round 1 (`revise`, 3 major): §4.6 names the pure buffer primitive `walkPhysicalChain` (not the disk-reading `verifyEffectsChain`) and pins the byte-exact physical-line wire representation; `lastHead` advances only from the verified incoming head (never the signed/orphan position) so lost-race recovery holds; the lost-race selftest now drives recovery, not just the orphan. Four minors folded as build guidance (request-record selected by `request_seq`; no FAFF-978 re-admit guard; `no-governor` dropped from the wire reasons; the governor log is in-process-serialised). Round 2 confirmed the body fixes and flagged that the DoD checklist + one failure-mode line still carried the pre-fix wording; those were aligned (DoD authorize line now names `walkPhysicalChain`; the `lastHead` DoD + restart failure-mode lines now state it is never rebuilt from the log — absent-on-restart means no prior head).

This is the build spec for FAFF-1177 (domain: Commissaire). It is written for the build agent that implements `plugin/skills/faff/bin/lib/governor.ts` and for the human reviewers who gate it. It implements ADR 0135 (Accepted, binding); it does not re-decide it. Where ADR 0135 already chose something, this spec cites it as `**Chosen:**` with the ADR as the rationale rather than opening the question again.

## 1. WHY — Problem and Principles

**The load-bearing model.** Today a single runner process both holds `SK_commissaire` and runs `merge-gate`, so a dishonest runner can sign its own grant (the FAFF-1027 threat). This ticket moves the signing out of the runner's reach into a separate long-running process, the *governor*, which is the only holder of the Ed25519 signing key and the HMAC root secret. The governor never touches the run directory: the runner sends it a ledger plus a chain position over a socket, the governor verifies the chain itself, evaluates with the unchanged decision logic, and returns a verdict signed at that position. The runner appends the signed record; the governor keeps its own copy in a log the runner cannot reach. That is the whole mechanism; everything below is detail on the three operations (admit, authorize, conclude), the key custody, and the wire.

**Problem statement.** In-process custody (option 3) gives author binding but not unforgeability, because the runner holds the key (ADR 0135 Context). FAFF-1177 externalises admit/authorize/conclude into a process behind a Unix socket and a network listener, holding the only signing key. It is the server half only: it does not rewire the runner (FAFF-1179) and the existing in-process path keeps working.

**Design principles:**

**The governor never reads or writes the run directory.** It receives the ledger on the wire, verifies it, and returns signed records for the runner to append. It persists only its own key material, per-run derivation state, and its own append-only log (ADR 0135 decisions 4, 5). An implementation that has the governor read `<run_dir>` is wrong, because that fails on a separate machine and buys nothing over receiving the ledger.

**The decision logic does not change.** The two evaluators move verbatim from `commissaire.ts` into a shared governance-region module. Both the in-process authorize and the governor call the same functions, byte-identical. A reviewer must be able to diff the moved code and see no behavioural change.

**The runner is never trusted for anything the governor can check itself.** Every record the decision rests on is re-authenticated under a re-derived `K_producer`; the chain is re-verified from genesis; the requested position is recomputed, never accepted on the runner's word (ADR 0135 decisions 3, 4, 5).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (region: factory) | Holds today's in-process `cmdAdmit` (`:658`), `cmdRequestDecision` (`:806`), `cmdTerminalVerdict` (`:895`), the two evaluators (`:259`, `:318`), dispatch tables (`:1091`+), owner-only helpers (`:150`, `:162`), selftest (`:1218`) |
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript (region: governance) | `mintGovernorKeypair` (`:177`), `deriveKey`/`admitProducerKey` (`:139`,`:149`), `signDecision`/`verifyDecision` (`:193`,`:200`), `pkFingerprint` (`:186`), `signRecord`/`verifyRecord` (`:155`,`:162`) |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript (region: governance) | `verifyEffectsChain` (`:893`), `appendRecordsUnderLock` with the seq/prev assert (`:511`, `:529`), `sha256Hex`; genesis `prev` = `sha256(run_id)` (`:524`) |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript (region: governance) | `effectDescriptorViolations`, `effectTargetMatches`, `matchesUnit`, `unitIdOf`, `carriesBothUnitKeys`, `isProtectedKind`, `conclusionKindOf`, `CONCLUSION_KIND` — used by the evaluators and conclude |
| `plugin/skills/faff/bin/commissaire` | JavaScript (shell) | The standalone binary; requires only `./lib/commissaire` + `./lib/shared-infra` (`:17`) |
| `test/commissaire-standalone.test.mjs` | JavaScript | The import-independence guard (`:140`) + the tainted-fixture liveness check (`:241`) |
| `plugin/skills/faff/bin/lib/ids.ts`, `result.ts` | TypeScript (region: governance) | FAFF-1180 branded ids + `Result`; the typed identities the governor and evaluator module use |
| `plugin/skills/faff/build-manifest.json` | JSON (schema 1) | Pins tsc version + per-file `.ts`→`.js` digests; a new `governor.ts` emit is added here by the build |
| `records/adr/0135-...md` | Markdown (Accepted) | The binding design: decisions 2, 3, 4, 5, 6 and Ownership |
| `records/spikes/2026-10-06-faff-1109/RESULTS.md` | Markdown | Prototype design + import list (throwaway code, nothing liftable) |

**Scope statement.** FAFF-1177 is the Commissaire-owned governor *server* process that `commissaire governor start` launches; it sits between FAFF-1109 (this ADR) and the consumers (FAFF-1178 verify, FAFF-1179 runner client, FAFF-1181 Fly).

## 2. OUT OF SCOPE

- **Socket peer-credential caller check** — the governor does not yet check the caller's uid. *Why:* ADR 0135 decision 3 assigns this to its own ticket. *Extension point:* FAFF-1211; a guard invoked on each accepted Unix-socket connection before the request is read.
- **Install (the `_commissaire`/`commissaire` OS user, systemd/launchd, root-owned key dir)** — *Why:* the install workflow is a separate, large ticket. *Extension point:* FAFF-1216; FAFF-1177 stores keys under a plain `--key-dir` so `start` runs without install.
- **`commissaire governor pin` and `status`** — *Why:* pin/status read the trust file and `gh`. *Extension point:* FAFF-1217.
- **The pin-change human rule** — *Why:* enforced by the verify function and the governor against GitHub. *Extension point:* FAFF-1218.
- **`.commissaire/trust.toml` and its TOML-subset parser** — *Why:* ADR 0135 decision 11, its own ticket. *Extension point:* FAFF-1210. FAFF-1177 does not read the trust file or enforce pins.
- **The verify function + pinned/unpinned/in-process classification + `audit verify` extension** — *Why:* consumer side. *Extension point:* FAFF-1178; it imports the same evaluator module this ticket extracts.
- **Strict mode** — *Extension point:* FAFF-1219.
- **The runner client, faff's `commissaire.governor` switch, fail-closed, append-with-retry** — *Why:* FAFF-1177 is server-only. *Extension point:* FAFF-1179. The `(non-blocking)` network-listener caller-auth punt below is cross-referenced here.
- **The Fly governor app** — *Extension point:* FAFF-1181.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| governor | The long-running process holding the only `SK_commissaire` and the root secret, answering admit/authorize/conclude over a socket and a network listener |
| root secret | A 32-byte secret the governor generates once on first start; per-run HMAC masters derive from it |
| per-run master | `HMAC-SHA256(root_secret, "faff-run-master:" + run_id)`; the master `K_producer` derives from |
| last-verified head | The `(seq, head_hash)` of the newest ledger the governor accepted for a run; a later request must extend it |
| orphan verdict | A validly-signed verdict the runner never appends (it lost the chain-position race); the governor logs it |
| key dir | The `0700` directory the governor owns, holding the `0600` key file; never under a run directory |

**Type definitions (language-agnostic):**

```
RECORD GovernorKeyFile:            # one 0600 file in the 0700 key dir
  sk: Ed25519PrivateKeyPEM         # never sent on the wire
  pk: Ed25519PublicKeyPEM
  pk_fingerprint: hex64            # sha256(SPKI-DER), the pinned value
  root_secret: hex                 # 32 bytes; never sent on the wire
  created_at: ISO8601
  prior_fingerprints: hex64[]      # appended by `rotate`; informational, never removed here

RECORD AdmitRequest:   { op: "admit", run_id, producer_id, contract_revision, admitted_scope: string[] }
RECORD AdmitReply:     { ok: true, custody: "governor", producer_id,
                         k_producer_hex, pk, pk_fingerprint, admitted_scope,
                         admission_record }         # signed, kind_of_entry "admission", payload.custody "governor"
                       | { ok: false, reason }

RECORD AuthorizeRequest:
  op: "authorize"
  run_id; producer_id; unit_id; step
  ledger: GovernedRecord[]         # the runner's full schema:3 ledger so far
  at: { seq: int, prev: hex }      # the position the runner will append the verdict at
  effect; declared_ref?; evidence_seq?; level?; attended?; holdout?   # the request payload fields
RECORD AuthorizeReply:
  { ok: true, verdict: "grant"|"deny", reason, verdict_record }   # signed at `at`
  | { ok: false, reason }          # "position-mismatch" | "chain-invalid" | "ledger-not-extending-head"
                                   #  | "producer-not-admitted" | "producer-auth-failed" | ...

RECORD ConcludeRequest:
  op: "conclude"
  run_id; unit_id; producer_id?
  ledger: GovernedRecord[]
  at: { seq: int, prev: hex }
RECORD ConcludeReply:
  { ok: true, verdict: "conformed_to_contract", kind_of_entry, record }  # signed at `at`
  | { ok: false, verdict: "refused", reason }   # same reasons as cmdTerminalVerdict
```

**New governance-region module — `decision-policy.ts`.** Holds the two evaluators and the compose helper, moved byte-identical out of `commissaire.ts`.

```
MODULE decision-policy        # banner: // === region:governance — decision-policy — FAFF-1177 ... ===
  evaluateDecisionRequest(admission, requestRecord, key, ledgerEntries) -> { verdict, reason }   # was commissaire.ts:259
  evaluateLevelPolicy({ level, attended, holdout }) -> { pass, reason }                           # was commissaire.ts:318
  composeDecision(pure, levelPolicy) -> { verdict, reason }    # was the inline compose at commissaire.ts:848-850
```

`composeDecision` is grant iff `pure.verdict === "grant"` AND `levelPolicy.pass`, else deny with the first failing reason (pure first, then level policy). The local narrowers the evaluators use (`isRecord`, `str`, `num`) move or are re-defined in the module; they are pure.

**New primitive — `deriveRunMaster` in `producer-auth.ts`** (region: governance):

```
deriveRunMaster(rootSecret, runId) -> Buffer   # HMAC-SHA256(rootSecret, "faff-run-master:" + runId)
```

**New entrypoint — `governor.ts`** (region: factory, the server shell):

```
MODULE governor              # banner: // === region:factory — governor — FAFF-1177 ... ===
  governorStart(flags) -> number       # binds socket + network listener, serves until stopped
  governorRotate(flags) -> number       # mints a new keypair, archives the prior fingerprint
  handleRequest(state, request) -> reply  # pure-ish dispatch: admit | authorize | conclude (the selftest seam)
  governorSelftest() -> number
```

**Design decisions:** collected with markers in sections 6 and 7; each is restated there.

## 4. HOW — Behaviour

### 4.1 The evaluator move (keeps regions and the guard green)

`decision-policy.ts` carries a `// === region:governance ... ===` banner and requires only governance modules (`effects.js`) plus node built-ins, so `faff regions check` sees no `governance → factory` edge (`regions.js:808`). `commissaire.ts` imports the three functions from `./decision-policy` and **keeps re-exporting** `evaluateDecisionRequest` and `evaluateLevelPolicy` in its `module.exports` (`commissaire.ts:1428`), because `test/commissaire.test.mjs:22` and `test/commissaire-unit-id.test.mjs` import them from `commissaire.js`. The move is a cut-and-paste: no leg, no reason string, no ordering changes.

**Anti-pattern:** re-implementing or "tidying" the evaluator legs during the move. Why: FAFF-1178's verify function and the governor must produce byte-identical verdicts to the in-process path; any change silently forks the two.

### 4.2 `governor.ts` placement and dispatch

`governor.ts` sits in the factory region like `commissaire`, and `commissaire governor start` / `rotate` dispatch to it. The dispatch tables gain a `governor` object token:

```
OBJECT_TOKENS                 += "governor"                               # commissaire.ts:1091
COMMISSAIRE_DISPATCH          += "governor start":  (f) => require("./governor").governorStart(f)
                                 "governor rotate": (f) => require("./governor").governorRotate(f)   # :1095
REQUIRED_FLAGS_BY_CANONICAL   += "governor start":  []     "governor rotate": []                     # :1126
COMMISSAIRE_SPEC.flags        += "--key-dir": {arity:1}, "--socket":{arity:1}, "--listen":{arity:1}   # :1185
```

The `require("./governor")` is a static string literal, so `regionsRequireEdges` (`regions.js:759`) attributes it and the standalone walk (`commissaire-standalone.test.mjs:142`) reaches `governor.js`. Therefore `governor.ts` must: carry a region banner, ship a committed `.js` sibling, be required by literal path, carry no DENYLIST basename require, and resolve only inside `bin/`. `governor.ts` requires `./producer-auth`, `./decision-policy`, `./effects`, `./events`, `./shared-infra`, and node built-ins (`net`, `node:crypto`, `node:fs`) — **never `./commissaire`** (that would be a require cycle, since `commissaire.ts` requires `governor` for dispatch).

**Anti-pattern:** having `governor.ts` import `commissaire.ts` for the owner-only helpers. Why: it creates a require cycle with the dispatch edge. See 4.3.

### 4.3 Owner-only key helpers move to shared-infra

`ensureOwnerOnlyDir` (`commissaire.ts:150`, `0700`) and `writeOwnerOnlyJson` (`:162`, `0600` via `open "wx"` + rename) move to `shared-infra.js` (region: shared-infra, requirable by both factory and governance, no cycle). `commissaire.ts` imports them from `./shared-infra` and keeps its own behaviour unchanged; `governor.ts` imports the same two. The emit stays byte-identical in behaviour; the modes (`0700`/`0600`) are asserted by both selftests.

### 4.4 Key custody and first start

```
PROCEDURE governorStart(flags):
  1. keyDir = flags["--key-dir"] OR env COMMISSAIRE_KEY_DIR OR default ~/.local/state/commissaire
  2. keyFile = keyDir + "/governor-key.json"
  3. IF keyFile does not exist:                         # first start
     a. ensureOwnerOnlyDir(keyDir)                       # 0700
     b. kp = mintGovernorKeypair()                       # producer-auth.ts:177
     c. rootSecret = randomBytes(32).hex
     d. writeOwnerOnlyJson(keyFile, { sk, pk, pk_fingerprint, root_secret, created_at, prior_fingerprints: [] })   # 0600
  4. load keyFile; refuse to start if its mode is not 0600 or keyDir is not 0700 (fail loud, exit non-zero)
  5. bind the Unix socket at flags["--socket"] (default keyDir + "/governor.sock")
  6. bind the network listener at flags["--listen"] if given (host:port)
  7. serve: one NDJSON request per connection, dispatch to handleRequest, reply, close
```

The key material is never written under any run directory and never leaves the process on the wire. A plain `start` under the runner's own OS user is honest but *not independent* (ADR 0135 decision 7): counted runs need the separate-user, root-owned home that FAFF-1216 install creates. FAFF-1177's job is only to store a key *somewhere* `0700`/`0600` so `start` runs standalone.

### 4.5 Admit

Admit is the one request with no producer HMAC: the runner has no key yet, and admitting earns nothing over a run the caller could start anyway (ADR 0135 decision 3).

```
PROCEDURE handle_admit(state, req):
  1. master     = deriveRunMaster(state.root_secret, req.run_id)        # HMAC-SHA256
  2. k_producer = admitProducerKey(master, req.producer_id, req.contract_revision)   # producer-auth.ts:149
  3. admissionRecord = buildEnvelope(... kind_of_entry "admission", step "admit",
         payload { producer_id, contract_revision, admitted_scope, pk_fingerprint, admitted_at, custody: "governor" })
     signed with signDecision(record, state.sk) at seq 0 / prev sha256(run_id)
  4. record the request + the signed admission in the governor log
  5. reply { ok:true, custody:"governor", k_producer_hex, pk, pk_fingerprint, admitted_scope, admission_record }
```

The governor retains per-run derivation context keyed by `run_id` (the master is re-derivable, so it need not be stored, but the governor tracks that the run is admitted and under which contract revision). The admission record carries `custody: "governor"` in its payload (the DoD requirement; today's in-process admit writes no custody field, `commissaire.ts:714`).

### 4.6 Authorize — the five ordered steps

Summary: verify the chain, refuse a non-extending ledger, check the position, evaluate unchanged, sign at the position.

**Wire representation of the ledger (load-bearing).** The chain walk, the head hash, and the position `prev` all hash **physical-line bytes** (genesis `prev0 = sha256(run_id)`; each link and the head = `sha256(previous physical line bytes)`; `appendRecordsUnderLock` computes `prev` as `sha256(JSON.stringify(record))`, `events.js:534`). So `AuthorizeRequest.ledger`/`ConcludeRequest.ledger` are transmitted as the **raw NDJSON physical-line bytes** the runner holds (not re-serialised parsed objects), and the governor hashes those exact bytes. (A parse-then-`JSON.stringify` round trip is admissible only if proven byte-idempotent against the runner's writer; raw bytes on the wire is the default and avoids the hazard.)

```
PROCEDURE handle_authorize(state, req):
  1. CHAIN:  walkPhysicalChain(ledgerBytes) over the raw NDJSON the runner sent          # events.js:683 — the PURE
             (genesis prev0 = sha256(run_id); each link = sha256(previous physical line bytes)).
             NOTE: NOT verifyEffectsChain (events.js:893), which reads declared-effects.jsonl + a witness
             file from a directory on disk — the governor must never read a run dir.
             Then parse each physical line and re-verify every producer HMAC (deriveKey(master,            # producer-auth.ts:139
               producer_id, contract_revision) then verifyRecord) and every commissaire signature
               (verifyDecision under state.pk).
             ANY failure -> reply { ok:false, reason:"chain-invalid", detail }
  2. HEAD:   head = (max seq, sha256(last physical line bytes)) of the sent ledger
             IF state.lastHead[run_id] exists AND head does NOT extend it
                (head.seq < stored.seq, OR the record at stored.seq no longer hashes to stored.head_hash)
             -> reply { ok:false, reason:"ledger-not-extending-head" }                           # ADR decision 4 addition
  3. POSITION: compute (nextSeq, nextPrev) from the verified ledger exactly as appendRecordsUnderLock would  # events.js:522-534
             (nextPrev = sha256 of the last physical line bytes)
             IF req.at.seq != nextSeq OR req.at.prev != nextPrev
             -> reply { ok:false, reason:"position-mismatch" }                                   # ADR decision 5
  4. EVALUATE: locate the producer request record in the VERIFIED ledger — the effect-decision-request
             for this (unit, step) whose request_seq matches req.at/request_seq (never the top-level wire
             payload, which is a cross-check only), then
             pure   = evaluateDecisionRequest(admission, requestRecord, k_producer, verifiedLedger)   # decision-policy
             policy = evaluateLevelPolicy({ level, attended, holdout })
             composed = composeDecision(pure, policy)
  5. SIGN:   verdictRecord = envelope(kind_of_entry "effect-decision-verdict", unit_id, step, payload{...})
             at seq=req.at.seq / prev=req.at.prev, signed with signDecision(record, state.sk)
             # DO NOT advance lastHead to this signed position — a raced verdict may be an orphan the
             # runner never appends; advancing to it would false-refuse the honest winner next request.
             # lastHead was already set in step 2 from the VERIFIED INCOMING head.
             log the request + the signed verdict (always, incl. the orphan case; the log does not move lastHead)
             reply { ok:true, verdict:composed.verdict, reason:composed.reason, verdict_record:verdictRecord }
```

The request record the governor evaluates is the producer-HMAC'd `effect-decision-request` the runner appended to its ledger before asking; the governor re-verifies it under the re-derived key in step 1, so step 4 trusts a verified record selected by `request_seq` (not the wire payload). (This differs from the in-process path, where `cmdRequestDecision` mints the request itself at `commissaire.ts:832`; here the runner mints and appends it, then sends the ledger.)

**Edge cases:**
- Unknown `run_id` at authorize (never admitted) -> `producer-not-admitted` (the governor has no admission context).
- A verdict signed at a position the runner then loses: the governor logs the verdict as an orphan **without** advancing `lastHead` (which only ever moves to a verified incoming head); the honest winner's re-request carries the appended verdict as its new head, which extends `lastHead`, and the governor recomputes the position and signs again (see 4.8).
- Absent `level` -> `evaluateLevelPolicy` passes (back-compat, `commissaire.ts:320`); the composed verdict is the pure verdict.
- Re-admit of the same `run_id`: the per-run master is a deterministic `HMAC(root, "faff-run-master:"+run_id)`, so re-admit is idempotent-safe — `handle_admit` does **not** port the in-process FAFF-978 refuse-without-`--force` guard (`cmdAdmit:674`), which exists only because the in-process path minted a fresh random master per admit.

### 4.7 Conclude

```
PROCEDURE handle_conclude(state, req):
  apply the SAME preconditions as cmdTerminalVerdict (commissaire.ts:895-975) against req.ledger:
    - resolve the producer (explicit req.producer_id, else the single producer, else "ambiguous-producer")
    - producer admitted and not revoked, else "producer-not-admitted"
    - no unreconciled escape (computeEscapes), else "unreconciled-escape"
    - pk-fingerprint agreement between the admission context and state.pk_fingerprint, else "pk-fingerprint-mismatch"
    - FAFF-1225 grant coverage: every observed protected effect has a signed covering grant earlier
      in the chain (grantCoverage via chokepointPermit), else "ungranted-protected-effect"
    - single contract revision over the unit's entries, else "ambiguous-contract-revision"
  idempotent: a prior signed conclusion in req.ledger (current CONCLUSION_KIND or legacy via conclusionKindOf) -> return it
  on pass: sign a `conformed_to_contract` record at req.at, log it, reply { ok:true, record }
  on refusal: reply { ok:false, verdict:"refused", reason }   (a refusal is a completed evaluation, not an error)
  # The wire reason set drops cmdTerminalVerdict's `no-governor` (an exit-2 in-process setup error, commissaire.ts:929):
  # the governor always holds a key, so that reason has no server-side analogue.
```

Records written before FAFF-1221 carry `accepted_under_contract` and are read through `conclusionKindOf`; new records carry `CONCLUSION_KIND` (`conformed_to_contract`). `grantCoverage` and `chokepointPermit` are reused unchanged (they are pure and already handle the pinned-fingerprint argument); see the Assumes on where they live.

**Assumes:** `grantCoverage`/`chokepointPermit` stay importable to the governor. They currently live in `commissaire.ts` (factory). *Validation:* if the governor must not import `commissaire.ts` (cycle), move `chokepointPermit`/`grantCoverage` into `decision-policy.ts` alongside the evaluators (they are pure and governance-appropriate) and re-export from `commissaire.ts`; check `faff regions check` stays green. See the open question.

### 4.8 Lost race and parallel lanes

The governor signs at the position it is asked for (after the position check). If two lanes request the same `(seq, prev)`, both receive validly-signed verdicts, but only one `appendRecordsUnderLock` succeeds on the runner side (`events.js:529` throws on a seq/prev the lock did not assign); the other verdict is an orphan. The governor logs every verdict it signs, orphans included (ADR 0135 decision 4). The governor does no server-side queueing or retry.

**The `≤3 re-requests then park` policy is the runner client's (FAFF-1179), not the governor's.** FAFF-1177 provides exactly the two mechanisms that policy needs: `position-mismatch` on a stale position, and orphan logging. (See the Open Questions entry.)

### 4.9 The governor's own log

A single append-only NDJSON file in the key dir (e.g. `<key-dir>/governor-log.jsonl`), serialised by the governor's own single long-running process (an in-process append queue — not a cross-process `withFileLock` contract, since the governor is the sole writer), outside every run directory. Each line records `{ ts, op, run_id, unit_id?, request_summary, verdict|refusal, signed_record?, appended_hint }`. Every signed verdict is logged, including orphans the runner never appends (ADR 0135 decision 4; the prototype finding in RESULTS). This is not a hash-chained schema:3 ledger; it is the governor's private audit record.

### 4.10 `rotate`

```
PROCEDURE governorRotate(flags):
  load keyFile; kp' = mintGovernorKeypair()
  prior_fingerprints += old pk_fingerprint
  write keyFile with the new sk/pk/pk_fingerprint, root_secret UNCHANGED, prior_fingerprints updated (0600)
```

Rotate changes only the Ed25519 signing keypair; the root secret is untouched, so existing runs' `K_producer` still re-derives and their records still verify. The old fingerprint stays valid until a human-approved PR removes it from `.commissaire/trust.toml` (ADR 0135 decision 6); that removal is FAFF-1210/1218 and is out of scope here. New admissions and verdicts sign under the new key.

### 4.11 What stays in-process

`cmdAdmit`/`cmdRequestDecision`/`cmdTerminalVerdict` keep working unchanged against the extracted `decision-policy.ts` (ADR 0135 decision 1: `custody: in-process` is the default when no governor is configured). FAFF-1177 does not add faff's `commissaire.governor` switch and does not make the runner call the governor; that is FAFF-1179.

## Failure modes

- **The failure:** the governor evaluates a *different* request record than the one the runner appended (e.g. the runner sends the ledger but the request payload fields in `AuthorizeRequest` disagree with the appended record). *How you'd know:* the evaluator grants/denies on fields the chain does not contain; a selftest that mutates the wire payload away from the appended record would still pass. *What it means:* narrow — the governor must evaluate the *verified* request record found in `req.ledger`, treating the top-level payload fields only as a cross-check, not the source of truth. The spec pins step 4 to the ledger record for this reason.
- **The failure:** `lastHead` tracking rejects a legitimate ledger after a governor restart (in-memory map lost). *How you'd know:* the first authorize after restart is refused `ledger-not-extending-head` though the ledger is sound. *What it means:* this must not happen — on restart an absent `lastHead` entry means "no prior head" and is accepted, then set from that first verified incoming head. The governor does **not** rebuild `lastHead` from its log (the log records orphans with only an `appended_hint` and cannot reconstruct the verified-incoming-head), which is why absent-means-no-prior-head is the only restart behaviour.
- **The failure:** the position check passes but the runner's lock assigns a different seq (a concurrent append landed between the governor's computation and the runner's append). *How you'd know:* `appendRecordsUnderLock` throws on the runner side. *What it means:* expected and handled — this is the lost race; the verdict becomes an orphan and the runner re-requests.

## 5. Scenarios — born-verifiable main objectives

```
Given a governor on first start with no key file
When governorStart runs
Then a key dir exists mode 0700 and a key file mode 0600 holding sk + root_secret + pk_fingerprint, under no run directory
```

```
Given an admitted run and a sound ledger whose latest effect-decision-request is covered and in scope
When the runner sends an authorize request at the correct next (seq, prev)
Then the reply is verdict "grant" and a verdict_record signed under the governor key that verifies with verifyDecision
```

```
Given a sound ledger but an authorize request whose `at` disagrees with the governor's computed next position
When the governor handles it
Then the reply is { ok:false, reason:"position-mismatch" } and nothing is signed
```

```
Given an authorize request carrying a forged effect-decision-request (producer_hmac does not verify under the re-derived key)
When the governor verifies the chain
Then the reply is { ok:false, reason:"chain-invalid" } (or "producer-auth-failed") and no verdict is signed
```

```
Given a run_id the governor never admitted
When an authorize request arrives for it
Then the reply is { ok:false, reason:"producer-not-admitted" }
```

```
Given a run whose latest observe for (unit, step) is at seq N and a request resting on evidence_seq < N
When the governor evaluates
Then the verdict is "deny" with reason "stale-evidence"
```

```
Given a prior accepted ledger for a run at head seq N
When a later authorize request sends a ledger that does not extend that head (truncated below N, or the record at N no longer hashes to the stored head)
Then the reply is { ok:false, reason:"ledger-not-extending-head" }
```

- The governor log records every signed verdict, including a verdict for a lost-race position the runner never appends (the orphan).
- The governor's require graph reaches no DENYLIST orchestration basename and nothing outside `bin/` (import-independence guard).

## 6. Design Decision Rationale

**Where do the two evaluators live after the move?**
Options: leave in `commissaire.ts` and have the governor import from factory (creates `governor → commissaire` plus `commissaire → governor` cycle); a new governance module. **Chosen:** a new governance-region module `decision-policy.ts` exporting `evaluateDecisionRequest`, `evaluateLevelPolicy`, `composeDecision`, imported by both `commissaire.ts` (re-exported for the existing tests) and the governor, and by FAFF-1178 verify later — rationale: ADR 0135 Ownership wants the shared verify logic in the governance region, and this keeps `faff regions check` green (no `governance → factory` edge) and the move byte-identical.

**Where do the owner-only key helpers live?**
Options: duplicate in `governor.ts`; import from `commissaire.ts` (cycle); move to shared-infra. **Chosen:** move `ensureOwnerOnlyDir`/`writeOwnerOnlyJson` to `shared-infra.js` and import from both — rationale: shared-infra is requirable by factory and governance without a cycle, and DRY keeps one `0700`/`0600` implementation under both selftests.

**What region is `governor.ts`, and how is it dispatched?**
**Chosen:** `governor.ts` in the factory region (like `commissaire`), dispatched by a new `governor` object token with `start`/`rotate` keys in the existing dispatch tables, required by a static literal `require("./governor")` so the standalone walk reaches it — rationale: ADR 0135 Ownership and decision 2 put the commands on the standalone `commissaire` binary; factory may require the governance cores; `governor.ts` requires no DENYLIST module and never imports `commissaire.ts`.

**Where is the key stored before install has run?**
**Chosen:** a `--key-dir` flag (env `COMMISSAIRE_KEY_DIR`, default `~/.local/state/commissaire`), `0700` dir / `0600` file, never under a run directory — rationale: FAFF-1177 must run on a plain `start`; FAFF-1216 provides the root-owned separate-user home for counted runs (ADR 0135 decision 6 local storage).

**How is the per-run HMAC master derived?**
**Chosen:** `HMAC-SHA256(root_secret, "faff-run-master:" + run_id)`, then `admitProducerKey(master, producer_id, contract_revision)` — rationale: ADR 0135 decision 6 (agent proposal, now binding); `deriveRunMaster` is added to `producer-auth.ts` (governance).

**What is the wire format?**
**Chosen:** one NDJSON request per connection, identical over the Unix socket and the network listener, with `admit`/`authorize`/`conclude`; admit carries no producer HMAC — rationale: ADR 0135 decision 2 and the prototype (RESULTS); the ticket's default.

**How does authorize order its checks?**
**Chosen:** chain-verify, then head-extension refusal, then position check, then evaluate (unchanged), then sign at the position — rationale: ADR 0135 decisions 4 and 5, confirmed by the prototype.

**How is the last-verified head tracked and persisted?**
Options: a persisted per-run head file; in-memory only; rebuild from the governor log. **Chosen:** `lastHead[run_id]` advances **only from the verified INCOMING ledger head** (authorize step 2), never from the position the governor last *signed*; it is held in memory for the live process, and on restart an absent entry means "no prior head" and is accepted and set (the governor does **not** rebuild `lastHead` from logged verdict positions). *Rationale:* a raced verdict the governor signs may be an orphan the runner never appends; advancing `lastHead` to a signed/orphan position — or rebuilding it from logged positions — would false-refuse the honest winner's next request and break the ADR 0135 decision 5 lost-race recovery. ADR 0135 decision 4 means "the last ledger head it *verified*", and decision 2 keeps the governor's only state the key, per-run admissions, and the log, so no separate persisted head file is introduced. *Rejected:* advancing `lastHead` to the signed position; a persisted per-run head file; rebuilding the head from logged (possibly-orphan) verdict positions.

**How does conclude behave over the wire?**
**Chosen:** apply the same `cmdTerminalVerdict` preconditions (including FAFF-1225 grant coverage) against the sent ledger and sign `conformed_to_contract` at the requested position; a refusal is a completed evaluation, not an error — rationale: the DoD and `commissaire.ts:895-975`.

**What does `rotate` change?**
**Chosen:** a new Ed25519 keypair only; root secret unchanged; prior fingerprint retained in the key file and still valid until a human PR removes it from the trust file (FAFF-1210/1218) — rationale: ADR 0135 decision 6.

**What is the governor's own log?**
**Chosen:** a single append-only NDJSON file in the key dir, outside every run directory, recording every request and every signed verdict including orphans — rationale: ADR 0135 decision 4 and the prototype's orphan finding.

**Who implements the lost-race retry?**
**Chosen:** the governor signs at the position and logs orphans with no server-side retry; the `≤3 re-requests then park` loop is the runner client's, implemented in FAFF-1179 — rationale: FAFF-1177 is server-only; the governor supplies `position-mismatch` and orphan logging, which are the mechanisms the client policy needs.

**Does the in-process path change?**
**Chosen:** no; the in-process admit/authorize/conclude keep working against `decision-policy.ts`, and the runner is not rewired here — rationale: ADR 0135 decision 1 (`custody: in-process` default) and FAFF-1179 owning the switch.

## 7. Open Questions and Assumptions

**Open Questions:**

- **Punt:** the network listener's bind address and caller authentication beyond "listens, same NDJSON" (non-blocking) (decides: security). FAFF-1177's network side binds a listener and speaks the same NDJSON; real caller authentication on it (peer credentials on the socket, network placement/app identity on Fly) is FAFF-1211 and FAFF-1181. Recommended default for this ticket: bind the network listener only when `--listen host:port` is given, default off; serve the same handlers with no caller check yet; document that an exposed listener is not independent until FAFF-1211. Cross-referenced under OUT OF SCOPE. This is the one open item and it does not block the server's admit/authorize/conclude behaviour.

**Assumptions:**

- **Assumes:** `grantCoverage`/`chokepointPermit` are reachable from the governor without a require cycle. They are pure and currently in `commissaire.ts`. *Validation before building conclude:* confirm the governor must not import `commissaire.ts` (it must not, because of the dispatch edge), then move `grantCoverage`/`chokepointPermit` into `decision-policy.ts` beside the evaluators and re-export them from `commissaire.ts`; run `faff regions check` and the existing `commissaire.test.mjs` to confirm nothing breaks. If a simpler path exists (both already pure and governance-appropriate), this is a mechanical move, not a new decision.
- **Assumes:** the runner appends the `effect-decision-request` before calling authorize, so the governor finds and re-verifies it in `req.ledger`. *Validation:* this is the prototype's protocol (RESULTS) and the FAFF-1179 contract; the governor must fail closed (`chain-invalid`/`assurance-floor`) if the record is absent, never fabricate one.

## 8. DONE — Definition of Done

### From WHY
- [ ] The governor never reads or writes a run directory; it operates only on the ledger received on the wire and persists only key material, in-memory per-run head, and its own log.

### From WHAT (types and interfaces)
- [ ] `decision-policy.ts` exists (region: governance) exporting `evaluateDecisionRequest`, `evaluateLevelPolicy`, `composeDecision`; `commissaire.ts` imports and re-exports the two evaluators so `test/commissaire.test.mjs` and `test/commissaire-unit-id.test.mjs` pass unchanged.
- [ ] `producer-auth.ts` exports `deriveRunMaster(rootSecret, runId)` computing `HMAC-SHA256(rootSecret, "faff-run-master:" + runId)`.
- [ ] `governor.ts` exists (region: factory) exporting `governorStart`, `governorRotate`, `handleRequest`, `governorSelftest`.
- [ ] Admit reply and admission record carry `custody: "governor"`.
- [ ] `ensureOwnerOnlyDir`/`writeOwnerOnlyJson` live in `shared-infra.js` and are imported by both `commissaire.ts` and `governor.ts`.

### From HOW (behaviour)
- [ ] `commissaire governor start` / `rotate` dispatch via the `governor` object token in `OBJECT_TOKENS`, `COMMISSAIRE_DISPATCH`, `REQUIRED_FLAGS_BY_CANONICAL`, and `COMMISSAIRE_SPEC.flags`.
- [ ] First start generates one Ed25519 keypair and one 32-byte root secret inside the governor, writes them `0600` in a `0700` key dir (`--key-dir`/`COMMISSAIRE_KEY_DIR`/default), never under a run dir; neither secret is ever sent on the wire.
- [ ] Admit derives the per-run master via `deriveRunMaster` then `admitProducerKey`, returns `K_producer` + PK + fingerprint, and signs an admission record.
- [ ] Authorize performs, in order: chain verify from genesis via `walkPhysicalChain` over the received ledger bytes (NOT the dir-reading `verifyEffectsChain`) + re-verify every producer HMAC and commissaire signature; refuse a ledger not extending the last verified head (`ledger-not-extending-head`); position check against its own computation (`position-mismatch`); evaluate via `decision-policy`; sign the verdict at the requested position **without advancing `lastHead` to the signed position**.
- [ ] Conclude applies the `cmdTerminalVerdict` preconditions including FAFF-1225 grant coverage and signs `conformed_to_contract`, or replies `{ verdict:"refused", reason }`; legacy `accepted_under_contract` records are read through `conclusionKindOf`.
- [ ] The governor appends every request and every signed verdict (orphans included) to its own NDJSON log in the key dir, outside any run directory.
- [ ] `rotate` mints a new keypair, leaves the root secret unchanged, and retains the prior fingerprint in the key file.
- [ ] The in-process admit/authorize/conclude still pass their existing tests via `decision-policy.ts`; the runner is not rewired.

### From HOW (edge cases)
- [ ] An authorize for an unadmitted `run_id` replies `producer-not-admitted`.
- [ ] A request resting on evidence older than the latest observe denies with `stale-evidence`.
- [ ] A forged request record fails chain verification and no verdict is signed.
- [ ] `lastHead` advances only from the verified incoming ledger head, never the signed position; it is never rebuilt from the governor log; an absent entry on restart means "no prior head" and is set from the next verified incoming head.

### From Build / discipline
- [ ] `governorSelftest()` (wired into `commissaireSelftest`, riding `commissaire --selftest`) covers all seven cases: grant, deny, forged request, unadmitted producer, stale evidence, a lost race, and a truncated ledger (`ledger-not-extending-head`). **The lost-race case must drive recovery, not just the orphan:** two requests at the same position, one verdict becomes an orphan (logged, `lastHead` unchanged), then the loser re-requests at the new head built on the appended winner and **receives a signed verdict** — asserting the honest winner is not false-refused `ledger-not-extending-head`.
- [ ] `test/commissaire-standalone.test.mjs` import-independence guard passes with `governor.js` in the walk (no DENYLIST basename, nothing outside `bin/`, no non-literal require).
- [ ] `faff regions check` is green (no `governance → factory` edge from `decision-policy.ts`; `governor.ts` and the new banners attribute cleanly).
- [ ] `build-manifest.json` is regenerated (adds `governor.ts`/`.js`, `decision-policy.ts`/`.js`, updated `producer-auth`, `commissaire`); the `.js` emit is committed beside each `.ts`; `cd plugin/skills/faff && npm install && npm run build` is clean.
- [ ] Every commit carries a `Signed-off-by` trailer (DCO).

**Integration smoke test (happy path):**

```
PROCEDURE smoke():
  start governor with a fresh --key-dir (no real socket needed: drive handleRequest in-process)
  r1 = handleRequest(state, { op:"admit", run_id:"RUN-S", producer_id:"P1", contract_revision:"r1", admitted_scope:["merge"] })
  ASSERT r1.ok AND r1.custody == "governor"
  build a ledger: the admission record, a declare(merge/main), an effect-decision-request(merge/main) HMAC'd under r1.k_producer
  r2 = handleRequest(state, { op:"authorize", run_id:"RUN-S", unit_id:"FAFF-1", step:"merge",
                              ledger, at:{ next seq/prev }, effect:{kind:"merge",target:"main"} })
  ASSERT r2.ok AND r2.verdict == "grant" AND verifyDecision(r2.verdict_record, state.pk)
  ASSERT the governor log has one admit line and one authorize line
```

confidence: high
build-tier: complex
