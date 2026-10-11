# FAFF-1211 — Authenticate callers on the Commissaire governor's Unix socket by peer credentials

> Spec: faffter-dark-nlspec · 2026-10-10 · interactive · claude-code/unknown · build-tier: complex · confidence: medium · revised 2026-10-10 (spec-review r1). Full spec on Linear FAFF-1211.
>
> Revised 2026-10-10 (r0): the helper interpreter was resolved to **Python** by operator decision; the blocking Punt is closed. The macOS `LOCAL_PEERCRED` read and `python3` availability are carried as Assumptions to validate at build.
>
> Revised 2026-10-10 (spec-review r1): closes the adversarial spec-review (`reject-approach`; infosec CRITICAL + major). Dropped `--allow-uid` as a trusted provisioning path — the only trusted allow-list source is now the root-owned `governor-config.json` the runner cannot write; the helper interpreter is resolved from a trusted absolute path only (never `PATH`); `governorStart` probes the interpreter at start and fails loud; the false SCM_RIGHTS claim is corrected. Re-rated **medium**: production-safe provisioning now depends on FAFF-1216's root-owned install, carried as an **Assumes**.

This spec is for the build agent implementing FAFF-1211, and for the human reviewers who gate it. It specifies a peer-credential caller check on the Commissaire governor's Unix socket: the governor reads the connecting process's uid from the kernel and refuses any caller not on a governor-owned allow list, before it reads the request. It builds directly on the FAFF-1177 server (`plugin/skills/faff/bin/lib/governor.ts`) and closes ADR 0135 decisions 2 and 3's "socket caller check" item.

## 1. WHY — Problem and Principles

**The load-bearing model.** The kernel knows which process is on the other end of a Unix domain socket, and it will tell the listening process that peer's uid on request. That uid is authoritative: a caller cannot forge it, because the kernel sets it from the connecting process's real credentials, not from anything the caller sends over the wire. Node has no API to ask the kernel for it, so the governor asks through a tiny helper and then refuses any caller whose uid is not on a list the governor alone controls. Everything below is about where that list lives, how the uid is read on each platform, and what happens when the read fails.

**Problem statement.** Today the FAFF-1177 governor answers any process that can open its Unix socket; the socket's `0600` mode is the only gate, and ADR 0135 (decision 3) notes that admit has no HMAC, so any reachable caller can start a run and get its `K_producer`. This change adds a uid allow-list check on every Unix-socket connection, refused before the request is read. The FAFF-1109 Linux prototype proved the check works (RESULTS part 3) but spawned a throwaway Python helper per connection; this ticket makes that a production route.

**Design principles.**

**The uid comes from the kernel, never from the caller — and never from the governor's own launch environment.** The check is worthless if the caller can influence the answer. The uid is read via a kernel peer-credential call on the accepted socket; the allow list is read from a **root-owned** file in the `0700` key directory the runner cannot write. No wire field, and no part of the governor's launch environment, feeds either side. This last clause is load-bearing: in the claude-box host-governor placement (ADR 0135 decision 9) the launcher sources a runner-writable `.env.agent-box` at every launch, so the governor's own argv and environment variables are runner-influenceable at start. A runner could therefore inject `--allow-uid <its own uid>` (or an equivalent env var) and self-authorize the very admit gate this ticket adds. The allow list must come only from a file outside the runner's reach — never from a flag or an environment variable (see §3).

**Fail closed.** Any uncertainty refuses the caller. An unreadable uid, a missing or empty allow list, a helper that times out or errors, a missing trusted interpreter: each refuses. An allowed caller is the only path that proceeds to the request.

**No compiled code in the shipped closure.** ADR 0135 and this ticket require the shipped artifact to stay dependency-free: Node built-ins only, zero runtime dependencies (`plugin/skills/faff/package.json`). The chosen route adds no compiled binary and no `require` the import-independence guard would reject (an interpreted Python helper is not a `require`).

**The check runs before the request is read.** The refusal happens at connection accept time, before any request bytes are parsed, matching the prototype and ADR 0135 (:124). A refused caller never reaches `handleRequest`.

## 2. OUT OF SCOPE

- **TCP `--listen` caller authentication** — the optional network listener gets no peer check. TCP has no `SO_PEERCRED`; FAFF-1177 already ships `--listen` unauthenticated by design and punts its caller auth to FAFF-1181.
- **`commissaire governor install` writing the allow-list / creating the OS user / systemd / launchd** — that command is FAFF-1216, blocked by this ticket. This ticket defines the file install will write and supplies an interim operator path (hand-writing that file).
- **Restricting the socket file to the runner's group** — the "second layer" group restriction is install setup (FAFF-1216); the socket stays `0600` owner-only as today. The uid check is independent of file mode.
- **gid / pid gating** — the allow list gates on uid only. gid and pid are logged when the platform returns them, but do not gate.
- **Request-record HMAC changes for admit** — admit having no HMAC is intentional; the uid allow-list is the gate on admit, which is exactly what this ticket adds.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Peer credentials | The connecting process's identity (uid, and where available gid/pid) as the kernel reports it on an accepted Unix-domain socket |
| Allow list | The set of uids the governor will serve, read from a root-owned file the runner cannot write; never from the caller or the launch environment |
| Peer-cred helper | A small Python script the governor spawns to read peer credentials, because Node exposes no API for it |
| Guard | The check invoked on each accepted Unix-socket connection, before the request is read |
| Trusted absolute path | A fixed, operator-and-root-controlled filesystem path (e.g. `/usr/bin/python3`) that no runner-writable directory contributes to; used to locate the helper interpreter |

**New module — `peer-cred` (region: factory).** A small module beside the governor, holding the platform-specific uid read behind one injectable interface. It requires only Node built-ins and resolves the helper path relative to its own directory.

```
MODULE peer-cred                 # banner: // === region:factory — peer-cred — FAFF-1211 ... ===

INTERFACE PeerCredReader:
  readPeerUid(socket): PeerCredResult   # synchronous

RECORD PeerCredResult:
  ok: boolean
  uid: integer     # present only when ok
  gid: integer?    # present when the platform returns it; never gates
  pid: integer?    # present when the platform returns it; never gates
  error: string?   # present only when not ok (e.g. "helper-timeout", "helper-nonzero", "unparseable", "unsupported-platform", "interpreter-missing")
```

**Allow-list config file.**

```
RECORD GovernorConfig:              # <keyDir>/governor-config.json, mode 0600, ROOT-OWNED (the governor's own user)
  allow_uids: Set<integer>          # the uids the governor will serve; may be empty

  CONSTRAINT file mode == 0600, file owned by the governor's own user, parent dir mode == 0700,
             else refuse to start (mirrors loadKeyFile)
```

- **Location.** `<keyDir>/governor-config.json`, sibling to `governor-key.json`. `keyDir` is resolved by the existing `keyDirOf`.
- **Ownership.** The file lives in the `0700` key dir the runner cannot write, and is owned by the governor's own user (root in the claude-box host-governor placement). This is the **only** trusted source of the allow list — nothing the runner can influence (socket wire, environment, or argv) contributes to it.
- **Missing / unreadable / empty `allow_uids`** → the governor serves no caller on the Unix socket (fail closed). Missing is not an error at start; it yields an empty allow list.

**Decision — where the allow list lives.** **Chosen:** a separate `governor-config.json`. The key file is minted and rewritten by the governor itself and holds secret key material; the allow list is written by a different writer (`install`, FAFF-1216), holds no secret, and must be rewritable without touching or rotating keys.

**Interim supply before `install` exists.** **Chosen:** require the operator (acting as root / the governor's own user) to hand-write the root-owned `governor-config.json` (mode `0600`) in the `0700` key dir; **no flag**. A `--allow-uid` flag (or an env var) would let a runner inject its own uid and self-authorize the sole admit gate this ticket adds. The only trustworthy source is therefore a file the runner cannot write. An empty or missing file refuses all callers (fail closed). Production-safe provisioning is FAFF-1216's job; this ticket carries that dependency as an **Assumes** (§7).

**Production route — reading the uid.** **Chosen:** a shipped interpreted helper script (route C). A native addon fails "no compiled code"; `ss` is Linux-only and racy, `lsof` is slow and racy, macOS has no `ss`; a short interpreted helper that calls the kernel's peer-credential `getsockopt` is kernel-authoritative, works on both platforms, and ships as a plain script the import-independence guard and build-manifest do not reject.

**Chosen — the helper's interpreter: a Python helper (operator decision, 2026-10-10).** The governor spawns a short **Python** helper that reads the kernel peer credentials from the inherited connection descriptor: `getsockopt(SOL_SOCKET, SO_PEERCRED)` and `struct.unpack` on Linux; `getsockopt` decoding `struct xucred` on macOS. Two risks move to Assumptions (§7): (1) macOS no longer ships a default `python3`, so the host/cage must provide one at a trusted absolute path — a missing interpreter is treated as a failed read and refuses the caller (`error: "interpreter-missing"`, fail-closed); (2) the macOS decode has no precedent in this repo and is demonstrated by the build's macOS verification. The Linux `SO_PEERCRED` read is human-ratified and proven.

**Trusted-path policy for the interpreter.** The helper interpreter is resolved from a fixed list of **trusted absolute paths** only (`/usr/bin/python3`), never from `PATH`, `~/.local/bin`, or any other user-writable directory. The governor spawns the helper as its own (root) user and hands it the live connection file descriptor, so a runner-writable `python3` shim on `PATH` would run attacker code as the governor with the peer socket in hand and could forge any uid it liked — a `PATH` lookup is itself an admit bypass. If no `python3` exists at a trusted absolute path, the read fails closed (`error: "interpreter-missing"`), and `governorStart` surfaces the condition loudly at start.

**New wire reasons.**

| Reason | When |
|---|---|
| `caller-not-allowed` | The peer uid was read and is not in the allow list |
| `peer-credentials-unreadable` | The uid could not be read (helper timeout / nonzero exit / unparseable output / unsupported platform / interpreter missing) |

The refused reply is `{ ok: false, reason: "caller-not-allowed", peer: { uid } }` for a disallowed caller and `{ ok: false, reason: "peer-credentials-unreadable" }` for a failed read.

## 4. HOW — Behaviour

**Architecture and approach.** `governorStart` builds the servers through `make()`. The Unix listener's connection handler gains the guard; the TCP listener keeps the bare `onConnection`. The guard reads the peer uid synchronously, checks it against the allow list, and only then hands the socket to `onConnection`. A refused caller is logged and its socket ended.

```
PROCEDURE guard_unix_connection(state, allowUids, reader, socket):
  1. result := reader.readPeerUid(socket)      # synchronous
  2. IF NOT result.ok:
     a. appendConnectLog(state, { peer_uid: null, refusal: "peer-credentials-unreadable", error: result.error })
     b. socket.end(JSON.stringify({ ok: false, reason: "peer-credentials-unreadable" }) + "\n")
     c. RETURN   # the data listener is never attached
  3. IF result.uid NOT IN allowUids:
     a. appendConnectLog(state, { peer_uid: result.uid, refusal: "caller-not-allowed" })
     b. socket.end(JSON.stringify({ ok: false, reason: "caller-not-allowed", peer: { uid: result.uid } }) + "\n")
     c. RETURN
  4. onConnection(state, socket, result.uid)    # allowed: proceed, carrying the uid for the per-request log stamp
```

**Guard mechanism — why synchronous.** **Chosen:** a synchronous read before attaching the data listener. net's socket does not flow until a `data` listener is attached, so reading synchronously at the top of the connection handler means no bytes arrive before the decision. The read is a `spawnSync` of the Python helper with an explicit `timeout` and `killSignal`, so a hung helper cannot block accept indefinitely; on timeout `spawnSync` returns with an error and the guard fails closed.

**Anti-pattern:** attach `socket.on("data")` and then start an asynchronous uid lookup without first `socket.pause()`. The synchronous read avoids this class of bug entirely.

**Reading the peer uid.** `readPeerUid` resolves the Python helper path relative to the `peer-cred` module's directory, resolves the interpreter from a trusted absolute path, spawns it synchronously handing it the accepted connection's file descriptor, and parses the helper's single-line output into a `PeerCredResult`.

```
PROCEDURE readPeerUid(socket):
  1. fd := socket._handle.fd                    # the accepted connection's descriptor
  2. IF platform is not linux or darwin: RETURN { ok: false, error: "unsupported-platform" }
  3. interpreter := first existing of TRUSTED_PYTHON_PATHS      # fixed absolute paths; NEVER PATH
     IF none: RETURN { ok: false, error: "interpreter-missing" }
  4. r := spawnSync(interpreter, [helperPath], { stdio: [fd, "pipe", "pipe"], timeout: HELPER_TIMEOUT_MS, killSignal: "SIGKILL" })
  5. IF r.error or r.status != 0: RETURN { ok: false, error: r.error ? "helper-timeout-or-spawn" : "helper-nonzero" }
  6. parsed := parse r.stdout as { uid, gid?, pid? }
  7. IF parse fails or uid is not a non-negative integer: RETURN { ok: false, error: "unparseable" }
  8. RETURN { ok: true, uid: parsed.uid, gid: parsed.gid, pid: parsed.pid }
```

`TRUSTED_PYTHON_PATHS` is a module constant: a short, fixed list of absolute interpreter paths (`/usr/bin/python3`). No element is derived from `PATH` or any user-writable directory. The Python helper reads peer credentials from the inherited descriptor (stdin fd 0) and prints one line of `{ "uid": N, "gid": N, "pid": N }`. The helper is a committed `.py` file under `plugin/skills/faff/bin/lib/`.

**Loading the allow list, probing the interpreter, and wiring the guard in `governorStart`.**

```
PROCEDURE governorStart(flags):            # extends the existing procedure
  config := loadGovernorConfig(keyDir)     # missing file -> { allow_uids: [] }; wrong mode/owner -> refuse to start (exit 2)
  allowUids := config.allow_uids           # the root-owned file is the ONLY source: no flag, no env
  reader := makePeerCredReader()           # the real reader; tests inject a stub
  IF resolveTrustedInterpreter() is none:  # start-time probe
     surface a PROMINENT warning (stderr + a start-time log record) that peer-cred reads will fail closed
  make(guarding listener).listen(socketPath, () => chmodSync(socketPath, 0o600); log listening)
  IF listen:
    make(bare listener).listen(port, host, ...)          # TCP: NO guard
```

`loadGovernorConfig` mirrors `loadKeyFile`'s mode discipline: the key dir must be `0700`, and when the config file exists it must be `0600` and owned by the governor's own user, else the governor refuses to start.

**Start-time interpreter probe.** Before binding, `governorStart` calls `resolveTrustedInterpreter()`. When no trusted `python3` resolves, the governor emits a prominent warning to stderr and writes a start-time log record, so the operator sees immediately that every Unix caller will be refused.

**Logging.** **Chosen:** add a sibling `appendConnectLog(state, { peer_uid, refusal, error? })` that writes a connection-level line `{ ts, op: "connect", peer_uid, refusal }` (with `error` when present) to `governor-log.jsonl`. A failed read logs `peer_uid: null`. **Chosen:** also stamp `peer_uid` on every accepted request's log line, by threading the allowed uid from the guard into `onConnection` -> `answer` -> `handleRequest` -> `appendLog`. This changes the `handleRequest` signature (it gains a `peer_uid` parameter), so the governor/commissaire selftest and the existing suite must stay green. A connect-log append that throws is swallowed (best-effort) rather than crashing the accept loop.

**Failure modes.**

- **The helper cannot read the macOS peer cred, or no trusted `python3` is present.** A refusal here is fail-closed (safe), not a silent accept; the start-time probe warns loudly if the interpreter was absent.
- **`socket._handle.fd` is unavailable or changes across Node versions.** This is private API; validated on the Node 20 floor before relying on it.
- **Synchronous `spawnSync` per connection stalls accept under load.** Acceptable for a single-runner governor; a higher-throughput deployment would move to a long-lived helper (Node can hand an accepted socket to a long-lived child over SCM_RIGHTS). Out of scope here.

## 5. SCENARIOS — born-verifiable main objectives

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governor whose allow list contains the connecting process's uid
When that process opens the Unix socket and sends an admit request
Then the governor reads the request and replies as it does today, and the request's log line carries peer_uid
```

```
Given a governor whose allow list does NOT contain the connecting process's uid
When that process opens the Unix socket and sends any request
Then the governor replies { ok: false, reason: "caller-not-allowed" } without reading the request, and writes a connect log line with op "connect", refusal "caller-not-allowed", and the peer uid
```

```
Given a governor whose only allow-list source is the root-owned governor-config.json (mode 0600) in the 0700 key dir, with no flag or environment variable able to add to it
When the file lists the connecting process's uid, the caller is served; and when the file is missing or its allow_uids is empty, every caller is refused
Then the allow list is sourced solely from the root-owned file (fail closed when it is absent or empty), confirming no runner-influenceable input (argv/env/wire) can authorize a caller
```

- The TCP `--listen` listener applies no peer check and is unchanged by this ticket (assertion).
- The shipped require closure gains no runtime dependency: `test/commissaire-standalone.test.mjs` import-independence guard stays green with the new `peer-cred` module in the walk.

## 6. DESIGN DECISION RATIONALE

(See §3/§4 Chosen markers; condensed here.) Allow list lives in a separate `governor-config.json` (different writer, no secret, rewritable without rotating keys). Supplied before install via a hand-written root-owned file, no flag/env (a flag/env is runner-influenceable and would self-authorize). Uid read via a shipped interpreted Python helper (only cross-platform route honouring "no compiled code"). Interpreter located from trusted absolute paths only, probed at start, fail-closed when missing (a PATH lookup is itself an admit bypass). Synchronous read before the data listener attaches (no flow before the decision, no race). `peer-cred` is a factory-region module required by factory `governor.ts`; the `.py` helper ships under `bin/lib/`, invisible to the import guard (not a `require`) and to build-manifest (`.ts`→`.js` only). Refusals log via a new `appendConnectLog`; accepted requests stamp `peer_uid` on the existing line.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The interpreter was resolved to Python by operator decision. The one residual, non-blocking gap is production provisioning, carried as an Assumes below and reflected in the `medium` confidence.

**Assumptions.**

- **Assumes:** production-safe provisioning of the allow list depends on FAFF-1216 (`commissaire governor install`). Until it lands, the operator hand-creates the root-owned file. This ticket is buildable and testable now with a hand-created file.
- **Assumes:** a `python3` interpreter is present on the host/cage at a **trusted absolute path** (`/usr/bin/python3`). A missing trusted interpreter is treated as a failed read and refuses the caller (fail-closed, `error: "interpreter-missing"`), surfaced loudly by the start-time probe.
- **Assumes:** Python can read macOS `LOCAL_PEERCRED` (`struct xucred`) and return the correct uid for a known second user. Validation: a macOS multi-user check during the build; if it cannot be demonstrated, surface it loudly rather than shipping an unproven macOS read. The Linux `SO_PEERCRED` read is already proven by the FAFF-1109 spike.
- **Assumes:** `socket._handle.fd` exposes the accepted connection's descriptor on the Node 20 adopter floor.
- **Assumes:** `spawnSync` with `timeout` + `killSignal` is available (a Node built-in).

## 8. DONE — Definition of Done

### From WHY
- [ ] A caller whose uid is not on the allow list is refused before its request is read, and the refusal is logged with the uid.
- [ ] The allow list is read only from the root-owned `governor-config.json` in the `0700` key dir — never from a flag, an environment variable, or any caller- or runner-controllable input.
- [ ] A caller whose uid cannot be read (including no trusted `python3`) is refused (fail closed).
- [ ] The shipped require closure gains no runtime dependency; the Python helper is not a `require`.

### From WHAT (types and interfaces)
- [ ] `peer-cred` module exists (region: factory, committed `.js` beside any `.ts`) exporting a `readPeerUid(socket) -> PeerCredResult` reader with an injectable form for tests.
- [ ] `governor-config.json` is read from `<keyDir>`, `0600` and owned by the governor's own user, parsed to `{ allow_uids: integer[] }`; missing file yields an empty list; a wrong file/dir mode or wrong owner refuses to start (exit 2).
- [ ] `governor start` exposes no flag and no environment variable that can add to the allow list (no `--allow-uid`); the root-owned file is the only source.
- [ ] Refusal replies use `caller-not-allowed` and `peer-credentials-unreadable`; the shipped helper is a Python script under `plugin/skills/faff/bin/lib/`.

### From HOW (behaviour)
- [ ] The guard runs on the Unix listener only; the TCP `--listen` listener keeps the bare `onConnection` with no peer check.
- [ ] An allowed caller's request proceeds exactly as today, and its log line carries `peer_uid`.
- [ ] A disallowed caller receives `{ ok: false, reason: "caller-not-allowed", peer: { uid } }` with no request read, and a connect log line `{ op: "connect", peer_uid, refusal: "caller-not-allowed" }` is written.
- [ ] A failed uid read receives `{ ok: false, reason: "peer-credentials-unreadable" }`, logs `peer_uid: null`, and reads no request.
- [ ] The uid is read synchronously before any `data` listener attaches; a helper exceeding `HELPER_TIMEOUT_MS` is killed and fails closed.
- [ ] `governorStart` probes the trusted interpreter at start; when none resolves it surfaces a prominent warning (stderr + a start-time log record) rather than binding silently-inert.

### From HOW (edge cases)
- [ ] The uid check refuses a disallowed caller even when the socket file mode is widened past the governor's own `0600`.
- [ ] A connect-log append that throws does not crash the accept loop.
- [ ] A missing trusted `python3` interpreter fails closed (`peer-credentials-unreadable`, `error: "interpreter-missing"`).
- [ ] The interpreter is resolved only from trusted absolute paths; a `python3` shim on `PATH` or in a user-writable dir is never executed (a test asserts a `PATH` shim is ignored).

### Guards and platform coverage
- [ ] `faff regions check` is green: the `peer-cred` banner attributes cleanly and creates no `governance → factory` edge.
- [ ] `test/commissaire-standalone.test.mjs` import-independence guard passes with `peer-cred.js` in the governor's walk.
- [ ] The FAFF-1000 runtime spawn-guard still passes.
- [ ] `node scripts/build-manifest.js check` stays green (the `.py` helper is outside its `.ts`→`.js` scope).
- [ ] The governor/commissaire selftest and the existing suite stay green after the `handleRequest` signature change that threads `peer_uid`.
- [ ] Darwin dev-host tests cover allowed / refused / failed-read via the injected stub reader, plus the allow-list-source case.
- [ ] A Linux multi-user test (per the FAFF-1109 spike) asserts the intruder is refused `caller-not-allowed` before the request and that the log records `peer_uid`. A real-peer same-uid Linux read is covered without root; the root/useradd intruder variant is gated to the capability.
- [ ] macOS real-peer coverage is a documented manual verification procedure (recorded under `records/`); CI uses the stub reader.

**Integration smoke test.**

```
1. Write a root-owned governor-config.json (mode 0600) with allow_uids == [<the test uid>] into a temp 0700 key dir, and start a governor on it (no flag).
2. From a process whose uid is <the test uid>, connect and send a valid admit request.
3. Assert the reply is the normal admit reply and governor-log.jsonl's last line carries peer_uid == <the test uid>.
4. From a process whose uid is NOT in the file (or with the stub reader returning a different uid), connect and send the same request.
5. Assert the reply is { ok: false, reason: "caller-not-allowed" } and a connect log line was written with that uid.
```

confidence: medium
