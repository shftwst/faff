# Spec — FAFF-1104: the first per-runtime reflection adapter (SUT-cage bridge)

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: medium. Spec-review round 1 (architectural/infosec/QA) returned revise on one minor infosec objection; the fix (op-allowlist gate + prototype-safe resolution) is folded into §3/§4/§6/§8 below.

This is the buildable specification for **FAFF-1104**, the first per-runtime reflection adapter — a small generic bridge that runs in the SUT cage, reflects a component's public surface from a Tier-1 binding manifest, and serves the frozen session RPC wire so the code-blind evaluator drives it exactly as it drives any HTTP service. It builds on two merged, frozen upstream artifacts — the wire (`docs/reference/session-rpc-wire.md`, FAFF-1102) and the manifest (`docs/reference/tier1-binding-manifest.md`, FAFF-1103) — and is consumed by FAFF-1105 (env-slot code-interface branch) and FAFF-1107 (e2e conformance).

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's code-blind holdout is a guarantee about *topology*: the judge and the code live in different cages, and the judge only ever reaches the code over a wire, so the judge's own process never contains the source. Today that works for running services only, because HTTP is the universal service wire. This ticket delivers the piece that extends the guarantee to plain code interfaces: a **standalone server process** — the bridge — that runs beside the component in the SUT cage, reflects the component's public symbols named by a validated manifest, and answers the four wire methods (`open` / `call` / `call_static` / `close`) over TCP. The evaluator POSTs to it exactly as it POSTs to a service; the cage guarantees hold for free because nothing about the transport changed.

**Problem statement.** The wire and the manifest are frozen and merged, but nothing yet reflects a real component and answers the wire. This ticket builds the first runtime's reflection adapter so one runtime's public surface, declared in a `.faff/binding-manifest.json`, becomes a live wire-speaking server inside the SUT cage. It does not wire that server into env-compose or stand it up SUT-side (both FAFF-1105).

### Design principles

**The component's code must never enter the evaluator cage.** The bridge is a server, reached only over the process boundary. Any design that would let the evaluator import, load, or reflect the component locally is wrong by construction, because a built artifact frequently *is* the source (a wheel/npm package ships the `.py`/`.js`). This kills the "import the built artifact into the judge" idea outright.

**The bridge is generic, fixed, and unforgeable — never tuned per project.** The bridge contains no project-specific logic: it reflects whatever a validated manifest names and dispatches by reflection. There is no knob, flag, or per-project branch that could be set to make a grader pass. Its only inputs are a names-only manifest (which structurally cannot carry behaviour) and the wire envelopes.

**The bridge serves exactly the manifest's declared surface — never more.** The manifest is a names-only allowlist by design (FAFF-1103). The bridge enforces that allowlist rather than trusting the wire `op` to be a declared one, and never lets JS's prototype chain widen the served surface past what was declared (see §4 — the op-allowlist gate + prototype-safe resolution).

**A thrown exception is a result, not a wire fault.** When the reflected code throws, panics, or rejects, the bridge returns `result.outcome=="threw"` carrying a `ThrownError{type,message,payload}` — structured data the evaluator asserts on, never a top-level `error`, never anything executable. The two planes are disjoint: a `WireError` is an infra fault (`needs-human`); a throw is evidence.

**Credentials never re-enter as data.** The bridge must never echo an inbound bearer token into any `ThrownError` field or return value. It satisfies this by construction: it never reads the `Authorization` header into any value it passes to the component or captures into a response.

**Code-blindness is topology-necessary-but-not-sufficient.** Co-residence with the SUT is required but insufficient: a bridge that is *importable* from the evaluator cage (e.g. published as the same npm package the SUT ships) regains code access while the repo-mount signal still reads absent. So the bridge is a **standalone server process, never published as an importable module** alongside the SUT package. This ticket carries the structural rule; FAFF-1105 provisions placement and FAFF-1107 proves it via the topology check.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `docs/reference/session-rpc-wire.md` (FAFF-1102) | — | The frozen wire this bridge serves: four methods, envelopes, error/throw planes, conformance list. |
| `docs/reference/tier1-binding-manifest.md` + `plugin/skills/faff/bin/lib/manifest.js` (FAFF-1103) | Node | The names-only descriptor this bridge reflects; `validateManifest` is a pure function reusable at startup. |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` (FAFF-384) | Node | The delivery-shape precedent: standalone bundled `.mjs`, pure core + injectable I/O, stable exit family, `--selftest` with zero real processes, `bearer` credential path. |
| `plugin/skills/faff/bin/lib/killable-spawn.mjs` (FAFF-793) | Node | House process/listener discipline: pure core + injected I/O, single-settle, `--selftest`. |
| `plugin/skills/faff/bin/lib/env.js` (`envValidateBaseHost`, Node health probe) | Node | Why the bridge must bind TCP `host:port` (no socket path passes base-host validation). |

**Scope statement.** This is the first concrete occupant of the code-interface holdout stack below the wire and manifest: it turns FAFF-1103's validated descriptor into FAFF-1105's provisionable server.

## 2. OUT OF SCOPE

- **Wiring the bridge into env-compose** — FAFF-1105, consuming this ticket's invocation contract.
- **Standing the bridge up SUT-side** — FAFF-1105; teardown via `env-handle.teardown_ref`.
- **The evaluator reading the wire / selecting the RPC convention** — FAFF-1106. The bridge never sees spec text and never picks the convention.
- **End-to-end conformance + topology proof** — FAFF-1107.
- **Second and subsequent runtimes** — Python/Go adapters. Extension point: a sibling `faff-bridge-<runtime>` built to the same invocation contract and wire; the `runtime` manifest field routes to it.
- **A canonical cross-runtime rich-type lowering standard** — deferred (matches the wire's own open question): dates, decimals, blobs, sets, enums.
- **Multi-module resolution roots in one bridge process** — this first adapter resolves all bindings against a single SUT module root. Extension point: a per-binding module arg.
- **App-layer authentication of method calls** — private-network segmentation is the control (`faffter-noon-transport-private-network`).

## 3. WHAT — Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| **Bridge** | The standalone server process this ticket builds; runs in the SUT cage, reflects the component, serves the wire. |
| **Module root** | The single SUT module the bridge `import()`s at startup; every manifest dotted path resolves against its export namespace. |
| **Dispatch plane** | Locating and beginning to invoke a named symbol. A failure here is a `WireError{code:"dispatch_unavailable"}`. |
| **Throw plane** | Everything from the invocation onward. A failure here is `result{outcome:"threw"}` — evidence, not a wire fault. |

### The chosen runtime

**Chosen:** **Node** first — strongest engineering gravity (every pattern to mirror is Node), the simplest path to a fixed unforgeable reflective bridge (`Reflect.construct`, `obj[op](...args)`), zero new CI toolchain, and it reuses the shipped `validateManifest` at startup. `runtime` is validated only as a bare-id today (no closed enum), so this pick becomes the de-facto first enum entry and sets the first rich-type-lowering precedent. Python is the acknowledged near-tie for representativeness and the natural second adapter; Go is out (no string-name dynamic dispatch).

### Delivery shape

**Chosen:** a standalone bundled `.mjs` server script (mirroring `evaluate-call.mjs`), invoked as `node faff-bridge-node.mjs <args>`, **not** a registered `faff` CLI verb. Rationale: the bridge runs SUT-side in the SUT's runtime, so tying it to the faff CLI's Node dispatch would not generalise to Python/Go adapters; and a CLI verb would couple the bridge to the harness process, against the standalone-server constraint. **Placement:** `plugin/skills/faff/bin/faff-bridge-node.mjs` — a shipped harness artifact FAFF-1105 copies/mounts into the SUT cage.

### Invocation contract (FAFF-1105 consumes this verbatim)

```
faff-bridge-node.mjs
  --manifest PATH     # the validated .faff/binding-manifest.json to reflect (required)
  --module SPECIFIER  # the SUT module to import(); all manifest dotted paths resolve
                      #   against its export namespace (required)
  --host HOST         # TCP bind host (required; must pass envValidateBaseHost's charset)
  --port PORT         # TCP bind port (required; positive integer)
  --wire MAJOR        # wire major version to serve; default 1 (optional)
  --selftest          # run the pure-core selftest and exit; binds nothing (dev/CI only)
```

**Why `--module` exists:** the manifest's `entry`/`op`/`factory` fields are bare-identifier-or-dotted-paths (FAFF-1103 grammar), which structurally cannot hold a Node module specifier (scoped packages carry `@`/`/`, files carry `.`/`/`). So the Node-specific module location is supplied at invocation, keeping the manifest runtime-neutral. All bindings resolve against this one root (multi-root is out of scope).

Fixed wire constants (not configurable): `POST /faff-rpc` and `GET /faff-rpc/health`.

### Type notation the bridge honours (from the frozen wire — restated, not re-decided)

```
RECORD WireRequest:                       # POSTed to /faff-rpc, strict per-method field set
  wire: String                            # "faff.session-rpc/<major>"; MUST be present
  method: Enum{ open, call, call_static, close }
  id: String                              # echoed on the response
  target?, ctor_args?, session_id?, op?, args?   # exactly the set for `method`
RECORD WireResponse: { wire, id, result | error }   # exactly one of result/error
RECORD Result: { outcome: returned|threw, value?, error?: ThrownError, session_id?(open only) }
RECORD ThrownError: { type: String, message: String, payload: Json|null }
RECORD WireError: { code: Enum{ malformed_request, unknown_method, unknown_session,
                                unsupported_version, dispatch_unavailable }, message }
```

Field-to-manifest mapping (FAFF-1103): `open.target` → `Binding.name` (→ `Binding.entry`); `open.ctor_args` shape → `construction.arity`; ctor-vs-factory → `construction.kind`(+`factory`); `call.op` → `instance_ops[].op`; `call_static.op` → `static_ops[].op`; `close` → no manifest field (session lifecycle is this bridge's).

### Design decisions (each concluded with a marker; full rationale in §6)

- **Reflection/resolution semantics** — **Chosen:** resolve dotted paths as **own-property** paths against the imported module root's export namespace (with a CJS `.default` fallback on the first segment); construct via `Reflect.construct` (ctor) or the named factory; dispatch instance ops as `instance[op](...args)` bound to the instance, static ops as `fn(...args)`; await any returned thenable.
- **Manifest op-allowlist gate + prototype-safe resolution** — **Chosen:** the bridge exposes exactly the names-only surface the manifest authorises, never inherited or dunder symbols. Enforced two ways: (a) before any reflection, `call` rejects an `op` absent from the resolved binding's declared `instance_ops[].op` set, and `call_static` rejects an `op` absent from any binding's `static_ops[].op` set, as `dispatch_unavailable`; (b) `resolve()` walks **own enumerable properties only** (never the prototype chain, via `Object.prototype.hasOwnProperty.call`) and refuses the reserved segments `__proto__`, `prototype`, `constructor` at any position.
- **Static-op dotted-path resolution scoping** — **Chosen:** module-relative to the bridge's `--module` export namespace (the same root `entry` resolves against), never relative to the entry instance object.
- **`dispatch_unavailable` vs a genuine throw** — **Chosen:** `dispatch_unavailable` is decided entirely *before* invocation (op not in the declared set, symbol absent, not a constructor for `kind:ctor`, factory not callable, op not a function, `open` on a construction-less binding, a reserved-segment resolution miss); once the resolved callable is invoked, every failure — a synchronous body error or a rejected promise — is `result.outcome=="threw"`.
- **Rich-type marshalling (first rule)** — **Chosen:** JSON base types pass end-to-end; args arrive already JSON-parsed and are passed positionally as-is. A **void return (`undefined`)** — the common mutator case (`push`, `set`) — maps to a normal `result{returned, value:null}`, never an error. A return that is genuinely not JSON-representable (BigInt, function, symbol, circular) is `result.outcome=="threw"` with reserved `ThrownError.type` `faff.bridge.NonJSONReturn` (wire-sanctioned), never a `WireError`. (Build refinement: an earlier draft lumped top-level `undefined` into NonJSONReturn, which would have errored every void method.)
- **Canonical cross-runtime rich-type lowering standard** — **Punt:** defer a canonical JSON lowering for dates/decimals/blobs/sets/enums until a second runtime lands — needs human (decides: architecture). Mirrors the wire doc's own open question; non-blocking.
- **Arity enforcement** — **Chosen:** none — `arity` is informational (FAFF-1103); pass the positional vector as-is.
- **Async op handling** — **Chosen:** await a returned thenable before marshalling; async returns → `returned`, rejections → `threw`.
- **Bearer credential handling** — **Chosen:** no app-layer auth (segmentation is the control); never read `Authorization` into `ctor_args`/`args` or any captured `ThrownError`/return value — never-echo by construction.
- **Health response body shape** — **Chosen:** `GET /faff-rpc/health` returns 200 `{"status":"ok","wire":["faff.session-rpc/1"]}`; liveness is the status code, the body reports supported versions.
- **`session_id` minting scheme** — **Chosen:** `s-` + `crypto.randomUUID()`, opaque, unique within the process, in-process Map, no persistence.
- **Startup manifest validation** — **Chosen:** fail-closed — re-run the shipped `validateManifest` on `--manifest` and refuse to bind (non-zero exit) if invalid/malformed or `runtime` is not `node`.

## 4. HOW — Behaviour

### Architecture

```
                  SUT cage                                  evaluator cage
  +--------------------------------------------+        +----------------------+
  |  faff-bridge-node.mjs  (this ticket)       |        |  evaluator (FAFF-1106)|
  |   startup: validateManifest + import()      |  TCP   |   POST /faff-rpc      |
  |   node:http server on --host:--port  <------+--------+   GET  /faff-rpc/health
  |   sessions: Map<session_id, instance>       |        |   Authorization:Bearer|
  |   reflects: module root's export namespace  |        +----------------------+
  |   the component's source (never crosses) ---X (boundary; code never leaves)
  +--------------------------------------------+
```

Zero-dependency, node stdlib only (`node:http`, `node:crypto`, `node:fs`), `#!/usr/bin/env node` shebang, direct-invocation guard, exported pure functions for test import — mirroring `evaluate-call.mjs` and `killable-spawn.mjs`. Pure core (envelope parse/validate, allowlist + resolution, marshalling, response assembly) is `--selftest`-covered with zero real listeners; the `import()`, the `node:http` bind, and the reflective invocation are the injectable/real I/O edge.

### Startup

```
PROCEDURE startup(args):
  1. Parse args; missing required arg -> exit usage (non-zero), bind nothing.
  2. Read --manifest; run validateManifest on it.
     a. invalid/malformed OR runtime != "node" -> print violations to stderr, exit non-zero, bind nothing.
  3. import() the --module specifier -> the module root namespace.
     a. import throws (module not found, syntax error) -> exit non-zero, bind nothing.
  4. Bind node:http server on --host:--port; serve until SIGTERM/close.
```

### Request handling

```
PROCEDURE handle(request_body):
  1. GET /faff-rpc/health -> 200 { "status":"ok", "wire":["faff.session-rpc/1"] } (no auth).
  2. POST /faff-rpc:
     a. Body not valid JSON, or violates the per-method field constraints -> error{ malformed_request }.
     b. wire tag absent/malformed -> error{ malformed_request }.  wire major != served -> error{ unsupported_version }.
     c. method not in {open,call,call_static,close} -> error{ unknown_method }.
     d. dispatch by method (below). Echo `wire` and `id` on every response.

PROCEDURE open(target, ctor_args):
  1. Look up target in manifest bindings by name.
     a. no such binding, OR binding has no construction (static-only) -> error{ dispatch_unavailable }.
  2. Resolve construction:
     a. kind==ctor:    resolve `entry` (own-property) against module root; not a constructor -> dispatch_unavailable.
                       instance = Reflect.construct(EntryClass, ctor_args)     # THROW plane begins here
     b. kind==factory: resolve `factory` (own-property) against module root; not callable -> dispatch_unavailable.
                       instance = factory(...ctor_args)                        # THROW plane begins here
  3. await instance if thenable.
  4. success -> mint session_id, store instance, respond result{ returned, value:null, session_id }.
  5. constructor/factory throws or rejects -> respond result{ threw, error:ThrownError }, mint NO session.

PROCEDURE call(session_id, op, args):
  1. session_id unknown or already closed -> error{ unknown_session }   (STRICT).
  2. ALLOWLIST GATE (before reflection): op not in this binding's declared instance_ops[].op -> error{ dispatch_unavailable }.
  3. resolve op (single-segment, own-property) on the stored instance; instance[op] not a function -> dispatch_unavailable.
  4. result = instance[op].apply(instance, args); await if thenable        # THROW plane
  5. respond result{ returned, value:marshal(result) } or result{ threw, error }.

PROCEDURE call_static(op, args):
  1. ALLOWLIST GATE (before reflection): op not in any binding's declared static_ops[].op -> error{ dispatch_unavailable }.
  2. resolve op (dotted path, own-property) against module root; not a function -> dispatch_unavailable.
  3. result = fn(...args); await if thenable                               # THROW plane
  4. respond returned/threw as for call. (No session touched.)

PROCEDURE close(session_id):
  1. live session -> dispose, drop from Map, respond result{ returned, value:null }.
  2. unknown/already-closed -> respond result{ returned, value:null }      (IDEMPOTENT no-op; never errors).
```

### Symbol resolution (own-property only; prototype-safe)

```
PROCEDURE resolve(dotted_path, module_root):
  1. segments = dotted_path.split(".")
  2. IF any segment in { "__proto__", "prototype", "constructor" } -> resolution miss (-> dispatch_unavailable)
  3. cursor = module_root
  4. FOR each segment:
     a. IF Object.prototype.hasOwnProperty.call(cursor, segment) -> cursor = cursor[segment]      # OWN property only
     b. ELSE IF first segment AND hasOwnProperty(cursor,"default") AND hasOwnProperty(cursor.default, segment)
          -> cursor = cursor.default[segment]                                                     # CJS interop, own only
     c. ELSE -> resolution miss (caller maps to dispatch_unavailable)
  5. return cursor
```

### Marshalling

```
PROCEDURE marshal(value):
  1. value === undefined (a void return) -> result{ returned, value:null }.
  2. Attempt JSON round-trip of value.
  3. representable -> return value (the wire layer JSON.stringifies the whole response).
  4. NOT representable (BigInt / function / symbol / circular) ->
       raise NonJSONReturn -> result{ threw, error:{ type:"faff.bridge.NonJSONReturn", message:<what>, payload:null } }.

PROCEDURE toThrownError(err):
  type    = (err is an object) ? (err.constructor?.name || err.name || "object")    # "TypeError"
                              : typeof err                                          # "string" for `throw "x"`
  message = String(err?.message ?? err)
  payload = JSON-representable own-enumerable props of err minus {type,message}, else null
  # NEVER include the inbound Authorization header value (never in scope here by construction)
```

### Edge cases

- **`open` on a construction-less (static-only) binding** → `dispatch_unavailable`.
- **`call` on an unknown/closed session** → strict `unknown_session`. **`close` on the same** → idempotent returned no-op.
- **An `op` not in the binding's declared set** → `dispatch_unavailable` (allowlist gate, before reflection).
- **A `__proto__`/`prototype`/`constructor` segment** → `dispatch_unavailable` (resolution miss, before reflection).
- **Missing method vs a method that raises** → missing (`instance[op]` not a function) is `dispatch_unavailable`; a present method that throws is `threw`.
- **Thrown non-Error value** (`throw 42`) → `ThrownError{type:typeof, message:String(value), payload:null}`.
- **Rejected promise** → `threw`. **Malformed body / bad field set / bad wire tag** → `malformed_request`. **Wire major mismatch** → `unsupported_version`.

**Anti-pattern:** representing a marshalling failure or a dispatch miss as a top-level `error` with an ad-hoc code — the `WireError.code` enum is closed. **Anti-pattern:** the bridge reading/logging the bearer token. **Anti-pattern:** publishing the bridge as a package importable alongside the SUT. **Anti-pattern:** dispatching an op straight against the instance/module without the allowlist gate + own-property resolution first (the widened-surface gap the spec-review caught).

### Failure modes

- **Node-first is engineering-convenient not representative** → the rich-type-lowering Punt (no lowering committed) keeps the eventual cross-runtime standard un-foreclosed.
- **`threw` overloaded for a non-JSON return** → mitigated by the reserved `type:"faff.bridge.NonJSONReturn"`; wire-sanctioned; closed `WireError` enum offers no alternative.
- **Single-`--module`-root doesn't fit multi-package bindings** → out of scope; extension point (per-binding module arg) named.

## 5. Scenarios — born-verifiable main objectives (drawn from the wire conformance list)

```
open mints a session and call drives it: open{target,ctor_args} -> result{returned, value:null, session_id:S};
  then call{S, op, args} -> result{returned, value:<op's return>}.
a throwing op is evidence: call on an op that raises <E>/<msg> -> top-level result, outcome "threw",
  error ThrownError{type:<E>, message:<msg>}.
call on an unknown/closed session -> top-level error{ code:"unknown_session" }, no result.
close is idempotent: a second close{S} -> result{returned, value:null}, no error.
call_static drives a pure function with no session -> result{returned, value:<F's return>}.
unsupported major: a request tagged "faff.session-rpc/2" -> error{ code:"unsupported_version" }.
dispatch fault vs evidence: call{S, "Z"} (no such declared op) -> error{ dispatch_unavailable };
  call{S, "M"} where M throws -> result{ outcome:"threw" }.
open on a ctor that throws -> result{ threw }, no session_id.
allowlist gate: call{S, op} where op is a real instance method NOT in instance_ops -> error{ dispatch_unavailable }.
prototype safety: call{S, "constructor"} or an op resolving through __proto__ -> error{ dispatch_unavailable }.
```

Non-functional assertions:
- The bridge presents at `env-handle.endpoint` as a TCP `host:port` URL that passes `envValidateBaseHost`; health probe = one `health_checks[]` entry `{name,path:"/faff-rpc/health",expected_status:200}`.
- The bridge never includes the inbound `Authorization` bearer value in any `ThrownError` field or return value.
- Every response satisfies exactly-one-of `{result, error}`; no `WireError.code` denotes an application throw.
- The bridge is a standalone server; not published or importable as a module alongside the SUT package.

## 6. Design Decision Rationale

Runtime: Node has the patterns, the simplest unforgeable reflection, zero new CI toolchain, reusable `validateManifest`; Python the representativeness near-tie; Go out. Delivery: standalone `.mjs` (evaluate-call.mjs precedent) generalises to other runtimes and stays a non-importable process. `--module`: the identifier grammar can't hold a module specifier. Reflection: own-property dotted-path walk, `Reflect.construct`/factory, await thenables. **Op-allowlist gate + prototype-safe resolution:** the manifest is a names-only allowlist, so the bridge must enforce membership before reflection and must not let the prototype chain (`constructor`/`prototype`/`__proto__`, all valid single-segment identifiers under the FAFF-1103 grammar) widen the surface — own-property resolution + reserved-segment refusal + pre-reflection membership together make the served surface exactly the declared set (spec-review round-1 infosec fix). Static-op scoping: module-relative. dispatch/throw boundary: before-vs-from invocation. Rich-type: JSON base types; non-JSON return is `threw`/NonJSONReturn. Lowering standard: Punt. Arity: informational. Async: await. Bearer: no app-auth, never-echo. Health: 200 + version body. session_id: `s-`+UUID. Startup: fail-closed validate.

## 7. Open Questions and Assumptions

- **Punt:** canonical cross-runtime rich-type lowering (decides: architecture) — the wire itself defers it; the Node adapter commits to no lowering, so nothing is foreclosed. Non-blocking.
- **Assumes:** FAFF-1105 supplies at invocation a validated `--manifest`, an importable `--module`, and a private-network `--host`/`--port`. The bridge fail-closes at startup, so a misconfigured stand-up surfaces as a non-zero exit, not a silent mis-serve.
- **Assumes:** the shipped `validateManifest` (`plugin/skills/faff/bin/lib/manifest.js`) is importable as a pure function (confirmed present + pure, FAFF-1103 merged).

## 8. DONE — Definition of Done

### Delivery & shape
- [ ] Delivered as `plugin/skills/faff/bin/faff-bridge-node.mjs`, zero-dependency (node stdlib only), shebang + direct-invocation guard, exported pure functions, a `--selftest` that binds nothing; not a `faff` CLI verb, not importable-alongside-SUT.
- [ ] Accepts `--manifest`, `--module`, `--host`, `--port`, `--wire`(default 1), `--selftest`; a missing required arg exits non-zero without binding.
- [ ] Binds TCP `--host:--port` (host passes `envValidateBaseHost`'s charset; no socket path); serves `POST /faff-rpc` + `GET /faff-rpc/health` at exactly those fixed paths.

### Startup validation
- [ ] Re-runs `validateManifest`; refuses to bind (non-zero) on an invalid/malformed manifest or a non-`node` runtime; refuses to bind if `import(--module)` throws.

### Wire behaviour
- [ ] `open` ctor → `Reflect.construct`, mint `s-`+UUID, store, `result{returned, value:null, session_id}`; factory → named factory; ctor/factory throw → `result{threw}`, no session; construction-less binding → `error{dispatch_unavailable}`.
- [ ] `call` dispatches `instance[op](...args)`; unknown/closed session → strict `error{unknown_session}`; op not a function → `error{dispatch_unavailable}`.
- [ ] `call_static` resolves the op against `--module` and calls `fn(...args)` with no session; not a function → `error{dispatch_unavailable}`.
- [ ] `close` disposes a live session; idempotent returned no-op on unknown/closed (never `error`).
- [ ] Returned thenables awaited (async → `returned`, rejection → `threw`); `dispatch_unavailable` only before invocation, every from-invocation failure is `result{threw}`.

### Op-allowlist + prototype safety (spec-review infosec fix)
- [ ] `call`/`call_static` reject an `op` absent from the binding's declared `instance_ops`/`static_ops` set as `dispatch_unavailable`, **before** any reflection.
- [ ] `resolve()` traverses own enumerable properties only (never the prototype chain) and refuses `__proto__`/`prototype`/`constructor` segments; a `--selftest` case asserts a `constructor`/`__proto__`-bearing op is `dispatch_unavailable`, and an undeclared-but-real instance method is `dispatch_unavailable`.

### Envelope + version + marshalling
- [ ] Malformed JSON / bad per-method field set / absent-or-malformed `wire` tag → `error{malformed_request}`; unknown method → `error{unknown_method}`; wire major mismatch → `error{unsupported_version}`.
- [ ] Every response echoes `wire`+`id` and satisfies exactly-one-of `{result,error}`; no `WireError.code` denotes an application throw.
- [ ] Thrown exception → `ThrownError{type,message,payload}` (non-Error → type from `typeof`); JSON args pass as-is, arity not enforced; non-JSON return → `result{threw, error:{type:"faff.bridge.NonJSONReturn",...}}`.

### Health + credentials
- [ ] `GET /faff-rpc/health` → 200 `{"status":"ok","wire":["faff.session-rpc/1"]}`, no credentials.
- [ ] The bridge never reads the inbound `Authorization` bearer value into `ctor_args`/`args` or any `ThrownError`/return value.

### Tests
- [ ] Pure-core `--selftest` covers envelope validation, allowlist gate, prototype-safe resolution, dispatch-vs-throw boundary, marshalling, response assembly — zero real listeners.
- [ ] Real-listener conformance tests in `test/impure/` cover the wire conformance list (open/call, throw-as-data, strict unknown_session, idempotent close, call_static, unsupported_version, dispatch-vs-throw, ctor-throw-no-session, allowlist-gate, prototype-safety) on the macOS + linux env-rootless lanes.
- [ ] `test/*.test.mjs` imports the module and spawns `--selftest` as a subprocess assertion, mirroring `evaluate-call.mjs`.

### Integration smoke test
```
1. stack.mjs exporting class Stack { push(x){...} pop(){...} }; .faff/binding-manifest.json (runtime:node)
   binding name "Stack" -> entry "Stack", ctor construction, instance_ops [push, pop].
2. node faff-bridge-node.mjs --manifest <that> --module <stack.mjs> --host 127.0.0.1 --port <p>
3. GET /faff-rpc/health -> 200 {status:ok, wire:[...]}
4. open{target:"Stack", ctor_args:[]} -> result{returned, session_id:S}
5. call{S, "push", [1]} -> result{returned};  call{S, "pop", []} -> result{returned, value:1}
6. call{S, "pop", []} again -> result{threw} (empty stack)
7. call{S, "constructor", []} -> error{dispatch_unavailable}   # prototype safety
8. close{S} twice -> both result{returned, value:null}
```

confidence: medium
build-tier: complex
spec-review: revise → fix folded (infosec minor: op-allowlist gate + prototype-safe resolution)
