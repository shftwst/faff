# Session RPC wire protocol

> The harness's own universal wire for code interfaces: how faff's code-blind holdout evaluates a plain code interface (a class, a set of functions) the same way it already evaluates a running service. Fixed, shipped, and audited: identical for every project. Spec: FAFF-1102.

This is the normative specification of the **session RPC wire**. It is a design artifact, not a running system: the runnable pieces are delivered by sibling tickets and named at their extension points below. Read it before implementing a bridge (FAFF-1104), the binding manifest (FAFF-1103), the env-slot code-interface branch (FAFF-1105), the evaluator's RPC reading (FAFF-1106), or the end-to-end conformance test (FAFF-1107).

## Why this exists

faff's code-blind holdout works because the code and the judge live in different cages, and the judge only ever reaches the code over a wire, so the judge's own process never contains the source. That structural fact is the whole guarantee.

Today the holdout can only judge **running services**, because HTTP is the universal service wire: every web service speaks it, so the judge has a project-independent way to poke a service without reading its code. **Code interfaces have no shared wire**, and faff is an open-source harness usable by any project, so no stable interface shape can be assumed. The fix is for the harness to ship its own universal wire for code interfaces, and make each project bridge to it, so the judge stays as blind for a code interface as it already is for a service.

To evaluate a code interface, faff turns it into a service: a small generic **bridge**, running in the code's cage, exposes each method over this wire, and the judge pokes it exactly as it pokes any service.

## Design principles

- **Code must never enter the evaluator cage.** The wire exists so the judge reaches the code over a process boundary, never in-process. Any feature that would require the judge to load, import, or reflect the component locally is wrong by construction, because a built artifact frequently *is* the source (a Python wheel or an npm package ships the `.py`/`.js` files). The wire carries data across cages; it never carries code into the judge.
- **A thrown exception is a result, not an instruction.** When the invoked code throws, panics, or rejects, the wire represents that as structured data (a type name, a message, a payload) the evaluator asserts against, never as text the evaluator executes, and never as a transport failure. The running feature is not trusted; its error output is evidence to test, exactly like its return values.
- **The frozen contracts do not move.** `env-handle`, `holdout-verdict`, `lane-boundary`, and the `transport` slot's inline return are untouched by this wire. The wire fits their existing shapes (it presents at `env-handle.endpoint` as a URL and pings via a `health_checks[]` entry); it never widens them.
- **The wire is additive to the evaluator's convention-neutral language.** The evaluator already derives the exercise command from trusted spec text only, treats env responses as data, and speaks of "endpoints / requests / responses" rather than "HTTP routes". The RPC convention is an additional way to derive and execute a call; it does not rewrite the trust boundary.
- **The threat model does not change.** The holdout defends the judge against *seeing code*, not the SUT against *lying*. A service can already fake HTTP responses today; a builder-authored bridge that fakes results is the same existing risk on the same SUT side of the same boundary. It introduces no new hole, provided the bridge runs in the SUT cage and never the evaluator cage.
- **Credentials never re-enter as data.** The bridge must not echo an inbound bearer credential into any `ThrownError` field or return value, and the evaluator credential-scrubs every captured `ThrownError` before it enters the evidence report. The spawner's `redactCredential` scrubs only the persisted contract envelope, not the prose evidence report, so the wire carries this obligation explicitly.

## The four methods

The wire is session-based so it covers stateful objects, builders, and pure functions alike:

```
open(target, ctor_args)      -> session_id            # construct / enter a stateful object
call(session_id, op, args)   -> result | wire error   # drive it, call by call
call_static(op, args)        -> result | wire error   # pure functions, no session
close(session_id)            -> result (idempotent)   # dispose
```

## Transport binding

The wire presents at `env-handle.endpoint` as a single TCP `host:port` URL. Method envelopes are JSON bodies POSTed to a fixed RPC path; the health check is an unauthenticated GET on a fixed health path returning a fixed status.

- **Method calls:** `POST /faff-rpc` with a JSON `WireRequest` body, a JSON `WireResponse` reply.
- **Health probe:** `GET /faff-rpc/health`, expressible as one `env-handle` `health_checks[]` entry `{ name, path, expected_status }`.

Both paths are **constants of the wire**, not per-project configuration: interop depends on both sides agreeing and there is no negotiation channel, so fixing them is what lets the bridge (FAFF-1104) and the evaluator (FAFF-1106) round-trip, and lets the env slot author the health-check `path` deterministically.

A **Unix-domain socket path cannot be carried.** faff's `envValidateBaseHost` (`plugin/skills/faff/bin/lib/env.js`) accepts only a bare hostname/IP or a bracketed IPv6 literal, and `envResolveEndpoint` builds the endpoint as `scheme://host:port/path`, so a socket path would fail base-host validation and never reach the handle. A bridge therefore binds a TCP `host:port`. This reuses the caged spawner's opaque-URL `--endpoint` handling verbatim (`plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` treats `--endpoint` as an opaque URL string) and the existing `bearer` credential path, with no change to any frozen contract.

## Request envelope

Every request carries the protocol tag, the method, and a correlation id, plus exactly the method-specific field set:

```
RECORD WireRequest:
  wire: String                 # protocol tag, e.g. "faff.session-rpc/1"; MUST be present
  method: Enum{ open, call, call_static, close }
  id: String                   # opaque per-request correlation id, echoed on the response
  # method-specific fields, exactly the set for `method`:
  target: String               # open only: the entry symbol / target name to construct
  ctor_args: Array<Json>       # open only: positional constructor args (may be empty)
  session_id: String           # call, close: the session to address
  op: String                   # call, call_static: the operation / method name
  args: Array<Json>            # call, call_static: positional args (may be empty)

  CONSTRAINT method==open        => fields {target, ctor_args} present; no session_id/op/args
  CONSTRAINT method==call        => fields {session_id, op, args} present; no target/ctor_args
  CONSTRAINT method==call_static => fields {op, args} present; no session_id/target/ctor_args
  CONSTRAINT method==close       => field {session_id} present; no op/args/target/ctor_args
```

`args` and `ctor_args` are JSON arrays of **positional** arguments: the lowest common denominator across runtimes, and trivial to reason about. Keyword arguments, defaulting, and any language-specific lowering are the adapter's job (FAFF-1104); the wire only guarantees the ordered argument vector arrives intact.

## Response envelope

A response carries exactly one of a top-level `result` or a top-level `error`:

```
RECORD WireResponse:
  wire: String                 # echoes the request tag
  id: String                   # echoes the request id
  result: Result   | absent    # present iff the method dispatched
  error:  WireError| absent    # present iff a wire-level fault occurred

  CONSTRAINT exactly one of {result, error} is present

RECORD Result:
  outcome: Enum{ returned, threw }
  value: Json          | absent    # present iff outcome==returned (may be JSON null)
  error: ThrownError   | absent    # present iff outcome==threw
  session_id: String   | absent    # open only: the minted session id, on outcome==returned

RECORD ThrownError:               # a thrown exception represented AS DATA
  type: String                    # the exception / error type name, e.g. "ValueError"
  message: String                 # the human-readable message
  payload: Json                   # structured extra data (fields, code, cause), or JSON null

RECORD WireError:                 # a protocol fault in USING the wire
  code: Enum{ malformed_request, unknown_method, unknown_session,
              unsupported_version, dispatch_unavailable }
  message: String
```

**`error` is reserved for faults in *using* the wire.** `result` means the method dispatched, and its `outcome` says whether the code returned a value or threw. The two failure planes are disjoint and the evaluator treats them differently: a `WireError` is an infrastructure fault the evaluator reads as `needs-human`; a `result.outcome=="threw"` is evidence to assert on.

## Error as data

A thrown exception, panic, or rejected promise from the invoked code is `result.outcome == "threw"` carrying a `ThrownError { type, message, payload }`. It is **never** a top-level `error`, and it **never** carries anything the evaluator executes: no source, no eval-able expression. A language stack trace, if included at all, lives only as an opaque string inside `message`/`payload` and is treated as text.

This lets the evaluator assert on the thrown type and message exactly the way it asserts on a returned value (a "Then it raises `ValueError`" criterion), while preserving the trust rule that env responses are data, never instructions.

## `session_id` lifecycle

A `session_id` is opaque, minted by the bridge, unique within the bridge process, and lives only for the current evaluation. The bridge process is stood up and torn down per env, so sessions never persist across evaluations or across bridge processes.

```
PROCEDURE session_lifecycle:
  1. open(target, ctor_args):
     a. The bridge constructs the target with ctor_args.
     b. On success: mint a fresh session_id (opaque, unique in this bridge process),
        store the live instance under it, respond
        result{ outcome:"returned", value:null, session_id:<minted> }.
     c. On a constructor that throws: respond result{ outcome:"threw", error:<ThrownError> },
        and mint NO session_id (there is no instance to address).
  2. call(session_id, op, args):
     a. IF session_id is unknown or already closed: respond error{ code:"unknown_session" }.
     b. ELSE dispatch op(args) against the stored instance; respond
        result{ outcome:"returned", value:<...> } or result{ outcome:"threw", error:<...> }.
  3. call_static(op, args):
     a. Dispatch a pure function with no session; respond returned/threw as for call.
  4. close(session_id):
     a. IF session_id is live: dispose the instance, drop it, respond
        result{ outcome:"returned", value:null }.
     b. IF session_id is unknown or already closed: respond
        result{ outcome:"returned", value:null } (idempotent no-op; teardown never fails).
```

`call` on an unknown or closed id is a **strict** `unknown_session` wire error, which surfaces a genuine sequencing bug loudly (the evaluator reads it as `needs-human`). `close` on an unknown or closed id is an **idempotent** returned no-op, so the evaluator and teardown can dispose without racing on a double-close. No cross-run persistence keeps the guarantee that each evaluation starts from a clean bridge.

## Wire versioning

Every request carries a `wire` tag `"faff.session-rpc/<major>"`. A bridge that does not implement the request's major version returns `error.code == "unsupported_version"`. An audited, shipped wire needs an unambiguous version handshake so an old bridge against a new evaluator (or the reverse) fails loud rather than mis-parsing. The minor/patch axis is reserved for additive, backward-compatible fields.

The health response body should report the supported `wire` version(s) so a mismatch is diagnosable, but the probe's liveness meaning is carried by the status code alone.

## Credentials

When the `env-handle` carries `scheme:"bearer"` credentials, the evaluator attaches `Authorization: Bearer <token>` to each method POST (reusing the existing spawner path); the health GET stays unauthenticated. The wire defines no credential of its own.

Per the credentials-never-re-enter principle: the bridge must not echo the token into a `ThrownError` or a return value, and the evaluator credential-scrubs every captured `ThrownError` before it enters the evidence report (the spawner's `redactCredential` covers only the persisted contract envelope, not the prose report).

## Deriving a call sequence from a spec criterion

The evaluator turns a trusted spec criterion into an `open`/`call`/`close` sequence, the same act it already performs to turn a criterion into an HTTP poke. This is a **convention the evaluator applies**, not a payload the spec carries: the spec text never contains wire envelopes.

```
PROCEDURE derive_call_sequence(criterion_text):     # applied by the evaluator, from trusted text only
  1. Given clause  -> establish precondition state:
     a. Naming a constructed object in some state  -> open(target, ctor_args),
        then zero or more call(session_id, op, args) to reach that state.
     b. Naming only pure functions                 -> no session; go straight to When.
  2. When clause   -> the action under test:
     a. A method on the constructed object         -> call(session_id, op, args).
     b. A pure function                            -> call_static(op, args).
  3. Then clause   -> the observable to assert:
     a. A returned value                           -> assert on result.value.
     b. A raised error                             -> assert on result.outcome=="threw"
                                                       and its ThrownError{type,message,payload}.
     c. A state change                             -> a follow-up call reading the state,
                                                       asserted on its result.value.
  4. Always close() any session opened, on every path (including assertion failure).
```

The `target`, `op`, and argument values are read from the criterion's own words (the symbol/op names and literals the trusted spec text states), exactly as HTTP method + path + body are read from a service criterion today. The wire adds no new trusted input. Criterion classes are unchanged: `scenario` and `assertion` criteria stay transport-agnostic (they name behaviour, not wire mechanics), and `prose` criteria still force `needs-human`. `faff dod classify` is untouched.

**Selecting the convention.** The evaluator cannot tell a bridge from a plain HTTP service by the endpoint alone: both present at `env-handle.endpoint` as an opaque URL, the frozen `env-handle` carries no protocol-kind discriminator, and `health_checks[]` never reads a response body. So the convention is selected from the **trusted spec's criterion shape**, never by sniffing the endpoint: a criterion that names a constructed object or class and drives it by method calls (the `open`/`call`/`call_static` shape) selects the RPC convention; a criterion that names service routes selects the existing HTTP derivation. This keeps the frozen contract untouched, removes the ambiguity of two protocols behind one opaque URL, and stays behind the same trust rule, since the selector reads only trusted spec text. Wiring the selection into the occupant is FAFF-1106.

## Frozen contracts this wire binds to (none are changed)

- `env-handle.endpoint` = the bridge's TCP URL; `env-handle.health_checks[]` = one entry for the GET ping (`plugin/skills/faff/contracts/env-handle.schema.json`, `additionalProperties:false`).
- `holdout-verdict` is emitted exactly as today; its criteria classes `scenario`/`assertion`/`prose` are transport-agnostic (`plugin/skills/faff/contracts/holdout-verdict.schema.json`).
- `lane-boundary` still expresses the evaluator cage promise, with the bridge on the opposite (SUT) side (`plugin/skills/faff/contracts/lane-boundary.schema.json`).
- The `transport` slot's inline return `{ base_host, credentials?, teardown? }` is reused unchanged; the bridge address is a private-network `host:port`.

No field is added, overloaded, or widened on any of these.

## Code-blindness precondition (topology is the normative observable)

The threat-model guarantee holds only while the **bridge runs in the SUT cage, never the evaluator cage**. The **normative observable is the container topology**: the bridge must be co-resident with the SUT cage and not with the judge.

The evaluator lane's `lane-boundary.json` reading `lane:evaluator, container:own, accesses.repo:absent` is necessary but **not sufficient on its own**. A mis-placed bridge that loads a built artifact which *is* the source (a wheel or an npm package) regains code access while `accesses.repo` still reads `absent`, so the repo-mount signal alone cannot catch it. FAFF-1105 provisions the bridge SUT-side and FAFF-1107 proves the placement via the topology check; this document states it as a precondition.

## Conformance criteria

Any conformant bridge (FAFF-1104) must exhibit the following, and FAFF-1107 asserts them end to end. There is no running system at this specification stage, so none of these is a holdout criterion here.

```
Scenario: open mints a session and call drives it
  Given a bridge speaking wire "faff.session-rpc/1" over a TCP host:port endpoint
  When a WireRequest{ method:"open", target:<T>, ctor_args:[...] } is sent
  Then the response is result{ outcome:"returned", session_id:<S> } with S a fresh opaque id
  And a subsequent WireRequest{ method:"call", session_id:S, op:<M>, args:[...] }
      returns result{ outcome:"returned", value:<the method's return> }

Scenario: a thrown exception is returned as data, not a wire error
  Given a live session S whose op <M> raises an exception of type <E> with message <msg>
  When WireRequest{ method:"call", session_id:S, op:<M>, args:[...] } is sent
  Then the response carries top-level result (never top-level error)
  And result.outcome == "threw"
  And result.error == ThrownError{ type:<E>, message:<msg>, payload:<data or null> }

Scenario: call on an unknown or closed session is a strict wire error
  Given a session_id that was never opened, or was already closed
  When WireRequest{ method:"call", session_id:<that id>, op:<M>, args:[] } is sent
  Then the response carries top-level error{ code:"unknown_session" } (no result)

Scenario: close is idempotent
  Given a session S that has already been closed once with a returned result
  When WireRequest{ method:"close", session_id:S } is sent again
  Then the response is result{ outcome:"returned", value:null } (no error), a no-op

Scenario: call_static drives a pure function with no session
  Given a bridge exposing a static op <F>
  When WireRequest{ method:"call_static", op:<F>, args:[...] } is sent with no session_id
  Then the response is result{ outcome:"returned", value:<F's return> }

Scenario: a request tagged with an unsupported major version is rejected loud
  Given a bridge implementing wire major version 1 only
  When a WireRequest with wire "faff.session-rpc/2" is sent
  Then the response carries top-level error{ code:"unsupported_version" } (no result)
```

Additionally, a conformant bridge presents at `env-handle.endpoint` as a TCP `host:port` URL that passes `envValidateBaseHost`, its health probe is expressible as a single `health_checks[]` entry, the health GET succeeds without credentials, method POSTs carry `Authorization: Bearer <token>` when and only when the handle carries `scheme:"bearer"` credentials, and every response satisfies exactly-one-of `{result, error}` with no `WireError.code` denoting an application-level throw.

## Open question

**Rich-type marshalling beyond JSON.** The wire guarantees JSON primitives, arrays, and objects end to end. Language-specific rich types (dates/times, arbitrary-precision decimals, binary blobs, sets, enums) have no single canonical JSON lowering, and the choice is entangled with each runtime adapter's reflection. Whether to standardise a canonical cross-runtime lowering now, or to defer until the first reflection adapter (FAFF-1104) exposes the concrete need and standardise once a second runtime lands, is an open architecture decision. Until it is resolved, the wire's guarantee is scoped to JSON-representable values, and an argument or return value that is not JSON-representable is the adapter's responsibility to lower, or to reject as `outcome:"threw"` with a descriptive `ThrownError`. This does not affect the wire's four-method shape; it only bounds the value space the wire promises.

## Relationship to the shipped holdout stack

The shipped holdout stack delivers the **service path only**; the code-interface path this wire adds is not yet delivered. This document is greenfield: no prior wire/RPC/code-interface design reconciles with it.

| Shipped | Delivers |
|---|---|
| FAFF-34 | The code-blind holdout harness and `holdout-verdict`. |
| FAFF-276 | Sandboxed code-blind enforcement. |
| FAFF-307 / 309 / 311 | Wiring the holdout into the delivery / graft pipeline (`holdout_step`, faff-graft Step 10). |
| FAFF-384 | The evaluator hard cage, the `evaluate-call.mjs` spawner, and cross-cage transport (`spawner_attested` + `attestation`). |
| FAFF-817 | The `transport` slot (private-network base-host resolution). |

## Appendix A: wire error catalogue

| `WireError.code` | Meaning | Terminal? |
|---|---|---|
| `malformed_request` | Envelope is not valid JSON, missing required fields, or violates a per-method field constraint. | Yes |
| `unknown_method` | `method` is not one of `open`/`call`/`call_static`/`close`. | Yes |
| `unknown_session` | `call` addressed a `session_id` never opened or already closed. (`close` on such an id is an idempotent no-op instead.) | Yes (for `call`) |
| `unsupported_version` | The request's `wire` major version is not implemented by the bridge. | Yes |
| `dispatch_unavailable` | The bridge could not locate or invoke the named `target`/`op` at all: a dispatch-plane fault, distinct from the component throwing. | Yes |

No code in this catalogue denotes an application-level throw; a throw is always `result.outcome=="threw"`. All wire errors are terminal for the request: the evaluator does not retry on the wire, it records `needs-human` with the code.

## Appendix B: worked envelope examples

```
# open
--> { "wire":"faff.session-rpc/1", "id":"r1", "method":"open",
      "target":"Stack", "ctor_args":[] }
<-- { "wire":"faff.session-rpc/1", "id":"r1",
      "result":{ "outcome":"returned", "value":null, "session_id":"s-7f3a" } }

# call (returns)
--> { "wire":"faff.session-rpc/1", "id":"r2", "method":"call",
      "session_id":"s-7f3a", "op":"pop", "args":[] }
<-- { "wire":"faff.session-rpc/1", "id":"r2",
      "result":{ "outcome":"returned", "value":2 } }

# call (throws, as data)
--> { "wire":"faff.session-rpc/1", "id":"r3", "method":"call",
      "session_id":"s-7f3a", "op":"pop", "args":[] }
<-- { "wire":"faff.session-rpc/1", "id":"r3",
      "result":{ "outcome":"threw",
                 "error":{ "type":"IndexError", "message":"pop from empty stack", "payload":null } } }

# call (unknown session, wire error)
--> { "wire":"faff.session-rpc/1", "id":"r4", "method":"call",
      "session_id":"s-dead", "op":"pop", "args":[] }
<-- { "wire":"faff.session-rpc/1", "id":"r4",
      "error":{ "code":"unknown_session", "message":"no live session s-dead" } }

# close (idempotent)
--> { "wire":"faff.session-rpc/1", "id":"r5", "method":"close", "session_id":"s-7f3a" }
<-- { "wire":"faff.session-rpc/1", "id":"r5",
      "result":{ "outcome":"returned", "value":null } }
```
