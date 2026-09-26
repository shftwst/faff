# FAFF-1106 — Teach the evaluator the RPC convention for code-interface holdout

This is the buildable spec for FAFF-1106, the evaluator half of the code-blind holdout for non-service code interfaces. It is written for the build agent that will edit the evaluator occupant, and for the human reviewers who gate that change. The whole change lands in one skill prompt; this spec says what prose to add, what must stay untouched, and how to tell the result is right.

## 1. WHY — Problem and Principles

**The one idea:** the evaluator already turns trusted spec text into an exercise against a running env and treats the env's replies as data. Teaching it the session-RPC convention adds a second *way to derive and run* that exercise — an `open`/`call`/`close` sequence against a bridge endpoint instead of an HTTP poke against a service route. The trust boundary, the classification, and the `holdout-verdict` it emits are all unchanged.

**Problem statement.** faff's code-blind holdout can only judge running *services*, because HTTP is the only universal wire it knows how to derive a call for; a plain code interface (a class, a set of functions) has no route to poke. FAFF-1102 shipped the session-RPC wire and FAFF-1104 shipped the first bridge that speaks it, but the evaluator still only knows service-route derivation. This change teaches the evaluator to derive `open`/`call`/`call_static`/`close` sequences from trusted criterion text so it can judge a code interface through a bridge exactly as blindly as it judges a service.

**Design principles.**

**Additive, never a rewrite.** The evaluator's derivation prose is already transport-neutral — it says "endpoints / requests / responses", never "HTTP". The RPC convention is a sibling derivation path added next to the existing service-route path, and a selection step in front of both. Removing or rephrasing the existing exercise language would be wrong: nothing about services changes.

**The trust boundary does not move.** The evaluator reads only trusted spec text to build a call; the env's responses — returned values *and* thrown errors — stay data to assert against, never instructions to execute. The RPC convention adds derivation vocabulary, not a new trusted input.

**Selection reads spec shape, never the endpoint.** A bridge and a plain HTTP service both present at `env-handle.endpoint` as one opaque URL; the frozen `env-handle` carries no protocol-kind field and the health probe never reads a response body. So the convention is chosen from the trusted criterion's *shape*, never by sniffing the endpoint. This is mandated by the wire spec (`docs/reference/session-rpc-wire.md:172`: "Wiring the selection into the occupant is FAFF-1106").

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Skill prompt | The evaluator occupant this change edits — the only file that changes. |
| `docs/reference/session-rpc-wire.md` | Reference spec (FAFF-1102) | The normative RPC convention this teaches; its `derive_call_sequence` and selection prose are the source of truth. |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Caged spawner | Passes `--endpoint` through as an opaque URL; confirmed unchanged. |
| `plugin/skills/faff/bin/faff-bridge-node.mjs` | SUT-side bridge (FAFF-1104) | The endpoint the derived sequences run against; passive, never sees spec text. |
| `plugin/skills/faff/contracts/env-handle.schema.json` | Frozen contract | The handle the evaluator points at; no protocol discriminator; unchanged. |
| `plugin/skills/faff/contracts/holdout-verdict.schema.json` | Frozen contract | The verdict the evaluator emits; transport-agnostic; unchanged. |

**Scope.** This is the evaluator's read-side of the code-interface holdout workstream: the env slot provisions the bridge (FAFF-1105), the bridge speaks the wire (FAFF-1104), and this ticket teaches the judge to poke it.

## 2. OUT OF SCOPE

- **The bridge and its wire mechanics** — how a bridge mints sessions, dispatches ops, or lowers arguments. *Why excluded:* that is FAFF-1104's occupant, already shipped. *Extension point:* `plugin/skills/faff/bin/faff-bridge-node.mjs`.
- **Provisioning the bridge SUT-side** — standing the bridge up, its container placement, the code-blindness topology guarantee. *Why excluded:* that is the env slot's job (FAFF-1105). *Extension point:* the `env` slot occupant (default `faffter-noon-env-compose`).
- **The end-to-end conformance test** — proving a real derive-run-assert round trip against a live bridge. *Why excluded:* that is FAFF-1107, which this ticket blocks. *Extension point:* the docker-gated integration suite alongside `test/holdout-evaluate-integration.test.mjs`.
- **Any change to the caged spawner** — `evaluate-call.mjs` argument handling or spawn payload. *Why excluded:* the bridge is just another opaque `--endpoint`; confirming this is in scope, changing it is not. *Extension point:* `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs`.
- **Any change to a frozen contract** — adding a protocol-kind field to `env-handle`, or a transport field to `holdout-verdict`. *Why excluded:* the wire binds to the contracts as they stand; widening them is explicitly forbidden by FAFF-1102's design. *Extension point:* none — this must not happen.
- **Rich-type marshalling beyond JSON** — a canonical cross-runtime lowering for dates, decimals, sets, blobs. *Why excluded:* FAFF-1102 left this an open architecture question, deferred to a second runtime adapter. *Extension point:* the wire's value-space open question (`docs/reference/session-rpc-wire.md:231`).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Session-RPC wire | faff's universal wire for code interfaces: four methods carried as JSON over `POST /faff-rpc`, defined in FAFF-1102. |
| Bridge | A generic server running in the SUT cage that exposes a code interface over the wire; from the evaluator's side it is just an endpoint. |
| RPC convention | The evaluator's rules for deriving and running `open`/`call`/`call_static`/`close` from a criterion, and for reading the reply. |
| Service-route derivation | The evaluator's existing rules for deriving an HTTP poke (method + path + body) from a service criterion. |
| WireError | A fault in *using* the wire (`malformed_request`, `unknown_method`, `unknown_session`, `unsupported_version`, `dispatch_unavailable`). The evaluator reads it as `needs-human`. |
| Thrown-as-data | A `result.outcome == "threw"` carrying a `ThrownError{type, message, payload}` — the invoked code raised, and that is evidence to assert on, not a transport failure. |

**The wire the evaluator reads (from FAFF-1102, unchanged here).** The evaluator sends a `WireRequest` and reads a `WireResponse`; it authors neither shape, it only produces the field values from trusted criterion text.

```
RECORD WireRequest:                 # the evaluator emits this
  wire: String                      # "faff.session-rpc/<major>", e.g. "faff.session-rpc/1"; MUST be present
  method: Enum{ open, call, call_static, close }
  id: String                        # opaque per-request correlation id, echoed back
  # exactly the method's field set:
  target: String                    # open: the symbol/class to construct
  ctor_args: Array<Json>            # open: positional constructor args (may be empty)
  session_id: String                # call, close: the session to address
  op: String                        # call, call_static: the operation name
  args: Array<Json>                 # call, call_static: positional args (may be empty)

RECORD WireResponse:                # the evaluator reads this; exactly one of result|error
  wire: String
  id: String
  result: Result   | absent         # present iff the method dispatched
  error:  WireError| absent         # present iff a wire-level fault occurred

RECORD Result:
  outcome: Enum{ returned, threw }
  value: Json          | absent     # iff outcome==returned (may be JSON null)
  error: ThrownError   | absent     # iff outcome==threw
  session_id: String   | absent     # open only: the minted session id, on returned
```

**The transport binding the evaluator uses.** One TCP `host:port` URL at `env-handle.endpoint`. Method calls are `POST /faff-rpc` with a JSON `WireRequest`; the health probe is an unauthenticated `GET /faff-rpc/health` expressed as one `env-handle` `health_checks[]` entry. Both paths are wire constants, not configuration. The evaluator reuses the existing opaque-`--endpoint` handling and the existing `bearer` credential path — nothing new to wire up.

**Two failure planes, read differently.** This is the crux of the new reading rules:

- A top-level `WireError` is an infrastructure fault. The evaluator records the affected criterion `needs-human` with the wire code — never retried on the wire, never a silent `unmet`.
- A `result.outcome == "threw"` is evidence. The evaluator asserts on its `ThrownError{type, message, payload}` exactly as it asserts on a returned value, satisfying a "Then it raises X" criterion.

**Selection interface.** The evaluator, per criterion, picks a convention from the criterion's shape (never the endpoint):

```
FUNCTION select_convention(criterion_text) -> { rpc | service_route }:
  IF the criterion names a constructed object/class driven by method calls
     (an open/call/call_static shape)                         -> rpc
  ELSE IF the criterion names service routes                  -> service_route
```

**Design decisions in this section.**

**Selection source.** Selecting by criterion shape versus sniffing the endpoint: sniffing is impossible (one opaque URL, no discriminator, no body-reading probe) and would breach the trust rule. **Chosen:** select from the trusted criterion's shape only, per `docs/reference/session-rpc-wire.md:172`.

**Shape of the change.** A full rewrite of the derivation prose to an RPC-first form, versus an additive selection step plus a sibling RPC path. The existing prose is already transport-neutral and services still exist. **Chosen:** additive — add a selection sentence and an RPC-derivation sibling next to the existing exercise language, remove nothing.

## 4. HOW — Behaviour

**Architecture.** The whole change is prose added to the "Exercise the born-verifiable criteria" bullet of `plugin/skills/faffter-noon-evaluate/SKILL.md` (currently line 41) and its sub-bullets. Two additions:

1. A **convention-selection** clause at the top of the exercise step: for each born-verifiable criterion, read the criterion's shape and pick the RPC convention or the existing service-route derivation. Read only the trusted spec text; never inspect the endpoint.
2. An **RPC-derivation** sibling clause next to the existing "drive the running feature against the env's endpoints" language, giving the `open`/`call`/`close` mapping, the two-failure-plane reading, the credential rule, and the mandatory `close`.

**Deriving a call sequence (the convention the evaluator applies).** Straight from FAFF-1102's `derive_call_sequence`, restated as the evaluator's exercise rule:

```
PROCEDURE exercise_rpc_criterion(criterion_text, endpoint):   # from trusted text only
  1. Given clause -> establish precondition state:
     a. names a constructed object in some state -> open(target, ctor_args),
        then zero or more call(session_id, op, args) to reach that state.
     b. names only pure functions                -> no session; go to When.
  2. When clause -> the action under test:
     a. a method on the constructed object       -> call(session_id, op, args).
     b. a pure function                           -> call_static(op, args).
  3. Then clause -> the observable to assert:
     a. a returned value      -> assert on result.value.
     b. a raised error        -> assert on result.outcome=="threw" and its
                                 ThrownError{type,message,payload}.
     c. a state change        -> a follow-up call reading the state, asserted on result.value.
  4. ALWAYS close() any session opened, on EVERY path (including assertion failure).
```

The `target`, `op`, and argument literals come from the criterion's own words — the same act as reading HTTP method + path + body from a service criterion today. The `wire` tag on each request is `"faff.session-rpc/<major>"`.

**Reading the reply.**

```
PROCEDURE read_wire_response(response, criterion):
  1. IF response carries top-level error (a WireError):
     a. Record the criterion needs-human, note the WireError.code, evidence_present:false.
     b. Do NOT retry on the wire; do NOT record unmet.
  2. IF response carries top-level result:
     a. outcome=="returned" -> assert the criterion against result.value.
     b. outcome=="threw"    -> assert against result.error (ThrownError); a matching
                               "raises X" criterion is met, evidence_present:true.
  3. A criterion whose reply is neither assertable nor an env-exposed surface -> needs-human
     (the existing fail-closed backstop, unchanged).
```

**Credentials.** Reuse the existing `bearer` path: when the handle carries `scheme:"bearer"`, attach `Authorization: Bearer <token>` to every method `POST`; the health `GET` stays unauthenticated. The evaluator must credential-scrub every captured `ThrownError` before it enters the evidence report (the spawner's `redactCredential` covers only the persisted contract envelope, not the prose report). This is the existing credential obligation, extended to cover a captured `ThrownError`.

**Confirming the untouched surfaces.** The build agent verifies, and does not modify, each of these:

- `evaluate-call.mjs` pushes `--endpoint`/`--endpoints` into `a.endpoints` as opaque URL strings and passes them into the spawn payload untouched, with no scheme validation. A bridge URL is just another endpoint. **Confirm, do not change.**
- `env-handle.schema.json` carries `endpoint` as a bare string and `health_checks[]` as `{name, path, expected_status}`, with no protocol-kind field. **Confirm, do not change.**
- `holdout-verdict.schema.json` has `criteria[].class` in `{scenario, assertion, prose}`, `additionalProperties:false`, and no transport field. **Confirm, do not change.**
- `faff dod classify` assigns `class` and `verification_tier`; prose criteria are still forced `needs-human`. **Confirm, do not change.**

**Edge cases and error handling.**

- **Ambiguous criterion shape.** A criterion that reads as neither an object/method shape nor a service route: fall through to the existing service-route derivation, and if that too yields no exercisable surface, the existing fail-closed backstop records `needs-human`. No new branch is needed.
- **`unsupported_version` WireError.** A bridge that does not implement the request's major version returns this WireError; the evaluator reads it as `needs-human` via the WireError rule above. No version negotiation.
- **`unknown_session` on `call`.** A strict WireError (a genuine sequencing bug) -> `needs-human`. `close` on an unknown or closed id is an idempotent returned no-op, so teardown never races a double-close.
- **`prose` criterion.** Untouched — still forced `needs-human`, never RPC-exercised.
- **Env not ready / no endpoint.** Untouched — the existing pre-exercise env-handle gate emits `aggregate: needs-human` and tears down.

**Failure modes — how this approach could be wrong.**

- **The failure:** the added prose makes the evaluator sniff the endpoint (e.g. probe the health body) to decide RPC-versus-service, reintroducing the ambiguity the wire spec forbids. *How you'd know:* the prose or FAFF-1107's behaviour selects a convention without a criterion-shape signal, or reads a response body to classify transport. *What it means:* narrow — the selection clause must cite criterion shape as the sole selector; fix the prose before merge.
- **The failure:** a thrown exception gets read as a transport failure (recorded `needs-human` or `unmet`) instead of as evidence, so a "raises X" criterion can never be met over RPC. *How you'd know:* FAFF-1107's thrown-as-data scenario returns `needs-human` where `met` is expected. *What it means:* narrow — the two-failure-plane reading is the fix; a `result.outcome=="threw"` is always evidence.
- **The failure:** a credential leaks through a captured `ThrownError` into the prose evidence report, because the spawner only scrubs the persisted envelope. *How you'd know:* a bearer token appears in an evidence report built from a `ThrownError` payload. *What it means:* proceed with the explicit scrub clause; this is why the credential rule names the report specifically.

**Anti-pattern:** adding a protocol-kind field to `env-handle` (or a transport field to `holdout-verdict`) so the evaluator can branch on it. Why: the wire binds to the frozen contracts precisely because it needs no such field; selection is by criterion shape, and widening a frozen contract is forbidden by FAFF-1102.

**Anti-pattern:** rewriting the existing "exercise the endpoint" prose into an RPC-first form. Why: service derivation is unchanged and still needed; the RPC path is a sibling, not a replacement.

**Anti-pattern:** shipping a new deterministic RPC exerciser binary as part of this ticket. Why: the occupant is an LLM skill whose derivation is prose; the runnable round-trip is FAFF-1107's conformance test, and `test/helpers/holdout-exercise.mjs` is explicitly test-only, never shipped behaviour.

## 5. Scenarios — born-verifiable main objectives

These express the evaluator's main objectives against a bridge endpoint. The occupant is an LLM skill with no headless run, and there is no running env for a prose change, so these are not marked as holdouts — FAFF-1107 owns the live end-to-end behavioural verification, and these scenarios are the objectives it asserts.

```
Given a born-verifiable criterion that names a constructed object driven by method calls,
      and a bridge endpoint speaking "faff.session-rpc/1"
When the evaluator exercises the criterion
Then it derives an open -> call(...) -> close sequence from the criterion text alone
And it selects the RPC convention from the criterion's shape, never by inspecting the endpoint
```

```
Given a criterion whose Then clause expects a value returned by a method
When the evaluator sends the derived call and reads result.outcome=="returned"
Then it asserts the criterion against result.value and records met with evidence
And it calls close() on the opened session
```

```
Given a criterion whose Then clause expects a raised error of a named type
When the derived call returns result.outcome=="threw" with ThrownError{type, message, payload}
Then the evaluator asserts against that ThrownError and records met with evidence
And it never treats the throw as a transport failure
```

```
Given the bridge replies with a top-level WireError (e.g. unknown_session, unsupported_version)
When the evaluator reads the response
Then it records the criterion needs-human with the wire code, never unmet, and does not retry on the wire
```

- The evaluator MUST close every session it opens on every path, including after an assertion failure.
- When the handle carries `scheme:"bearer"`, every method POST MUST carry `Authorization: Bearer <token>` and the health GET MUST stay unauthenticated.
- Any `ThrownError` captured into the prose evidence report MUST be credential-scrubbed first.
- The emitted `holdout-verdict` block MUST be byte-shape-identical to a service-path verdict — same `class`/`verdict`/`aggregate` vocabulary, no transport field.

## 6. Design Decision Rationale

**How is the RPC-versus-service convention selected?**
- *Sniff the endpoint (probe, scheme, health body):* impossible and unsafe — one opaque URL, no protocol discriminator on `env-handle`, and the health probe reads only a status code; probing would also breach the trust rule.
- *Read the trusted criterion's shape:* the criterion already names either a constructed object driven by methods or service routes.
- **Chosen:** select from the trusted criterion's shape only. Rationale: it keeps the frozen contract untouched and stays behind the same trust boundary, exactly as FAFF-1102 mandates (`docs/reference/session-rpc-wire.md:172`).

**Rewrite the derivation prose, or add to it?**
- *Rewrite to RPC-first:* churns working service-derivation prose and risks implying HTTP is gone.
- *Additive sibling path plus a selection clause:* smallest diff, both conventions coexist.
- **Chosen:** additive. Rationale: the existing prose is already transport-neutral and services remain a first-class path; the ticket's own framing is "the evaluator barely changes".

**Does the caged spawner (`evaluate-call.mjs`) need a change?**
- *Add bridge/scheme awareness to the spawner:* unnecessary coupling; the spawner is deliberately transport-opaque.
- *Leave it: a bridge URL is just another `--endpoint`:* confirmed by reading the arg handling and spawn payload.
- **Chosen:** no change to the spawner — the bridge is just another opaque `--endpoint`. Rationale: verified at `evaluate-call.mjs:154` and `:245`; FAFF-1102's design re-verified it too.

**Ship a deterministic RPC reference exerciser in this ticket?**
- *Add one now (mirroring the HTTP `test/helpers/holdout-exercise.mjs`):* the real occupant is an LLM skill that can't run headless, so a helper wouldn't verify the occupant's prose.
- *Defer runtime verification to FAFF-1107:* the conformance test owns the live round trip.
- **Chosen:** no new runtime code in FAFF-1106 — the change is SKILL.md prose only, verified by review plus FAFF-1107. Rationale: keeps the ticket to its stated scope and avoids shipping non-occupant behaviour.

**How is a WireError distinguished from a thrown exception?**
- *Treat any non-returned reply as failure:* would make "raises X" criteria unverifiable over RPC.
- *Split the two failure planes:* a top-level `WireError` is infrastructure (`needs-human`); a `result.outcome=="threw"` is evidence.
- **Chosen:** split the planes per FAFF-1102 — WireError -> `needs-human`, thrown-as-data -> assert as evidence.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed.

**Assumptions.**

- **Assumes:** the session-RPC wire's JSON value space is sufficient for every criterion the evaluator will derive in this workstream (no non-JSON rich-type argument or return is required). *Validation:* FAFF-1102 bounds the wire's guarantee to JSON-representable values and leaves rich-type marshalling an open architecture question (`docs/reference/session-rpc-wire.md:231`); before relying on it, the build agent confirms no FAFF-1106 criterion or FAFF-1107 conformance case needs a non-JSON value, and if one does, it is the adapter's responsibility (FAFF-1104), not this ticket's.

## 8. DONE — Definition of Done

### From WHY
- [ ] The evaluator can derive and run an `open`/`call`/`close` sequence against a bridge endpoint from trusted criterion text, with the trust boundary unchanged.

### From WHAT (selection and reading)
- [ ] The added prose selects the RPC convention from the trusted criterion's shape only, and never from the endpoint (no scheme sniff, no health-body read).
- [ ] The RPC path is added as a sibling to the existing service-route derivation; no existing service-derivation prose is removed or rewritten.
- [ ] A top-level `WireError` is recorded `needs-human` with the wire code, never `unmet`, and is not retried on the wire.
- [ ] A `result.outcome=="threw"` (`ThrownError{type,message,payload}`) is asserted as evidence and can satisfy a "raises X" criterion.

### From HOW (behaviour)
- [ ] The derivation maps Given -> `open` + `call`s, When -> `call`/`call_static`, Then -> assert on `result.value` or on `result.outcome=="threw"` or a follow-up state-reading `call`.
- [ ] Every opened session is `close()`d on every path, including after an assertion failure.
- [ ] When the handle carries `scheme:"bearer"`, every method `POST` carries `Authorization: Bearer <token>` and the health `GET` is unauthenticated.
- [ ] Any `ThrownError` entering the prose evidence report is credential-scrubbed first.

### From HOW (confirmed unchanged)
- [ ] `evaluate-call.mjs` is unmodified — verified that `--endpoint` is opaque and the bridge is just another endpoint.
- [ ] `env-handle.schema.json` is unmodified — no protocol-kind field added.
- [ ] `holdout-verdict.schema.json` is unmodified — no transport field added; the emitted verdict shape is identical to the service path.
- [ ] `faff dod classify` is unmodified — `class`/`verification_tier` assignment and the prose-forces-`needs-human` rule are unchanged.

### From HOW (edge cases)
- [ ] An ambiguous criterion shape falls through to service-route derivation and then to the existing fail-closed `needs-human` backstop; no new branch added.
- [ ] `unsupported_version` and `unknown_session` WireErrors are read as `needs-human`; `close` on an unknown/closed id is treated as an idempotent no-op.

### Eval coverage
- [ ] No new LLM-judgement seam or grader `KIND` is introduced — the existing evaluator seam and the `holdout-verdict` contract are unchanged; the behavioural eval case for this convention is registered as FAFF-1107's end-to-end conformance test, not a unit test of the skill prose.

### Integration smoke test
```
PROCEDURE rpc_holdout_smoke:                 # the "plumbing is connected" happy path (realised by FAFF-1107)
  1. Stand up a bridge endpoint speaking "faff.session-rpc/1" over TCP host:port.
  2. Give the evaluator a criterion naming a constructed object and an expected returned value.
  3. Evaluator derives: open(target, ctor_args) -> session_id;
                        call(session_id, op, args) -> result{ outcome:"returned", value:V };
                        close(session_id).
  4. Assert V matches the criterion's Then clause -> criterion met, evidence_present:true.
  5. Emitted holdout-verdict validates via `faff contract holdout-verdict` unchanged.
```

confidence: high

## Self-review findings (in-context, per the inherited quality bar)

Ran a fresh-reasoning pass against the drafted spec and the codebase (single-level, as a dispatched producer), checking every claim.

- **Codebase fit — pass.** The additive-selection approach matches the wire spec's explicit mandate (`session-rpc-wire.md:172`) and its transport-neutral principle (`:20`). The `WireError`->`needs-human` versus thrown-as-data reading matches `:100` and `:104-106`. `close`-always matches `derive_call_sequence` step 4 (`:167`).
- **Confirmed-unchanged claims — pass, verified directly.** `evaluate-call.mjs:154/245` treats `--endpoint` as an opaque string with no scheme check; `env-handle.schema.json` has no protocol-kind field (`endpoint` a bare string, `health_checks[]` = `{name, path, expected_status}`); `holdout-verdict.schema.json` is `additionalProperties:false` with no transport field; `admissibility.js:101-130` assigns `verification_tier` and `faffter-noon-evaluate/SKILL.md:43` forces prose -> `needs-human`. All four "do not change" items check out.
- **Assumes-validity — pass.** The single `**Assumes:**` (JSON value space) is real and bounded by the wire spec's own open question (`:231/:233`), with a concrete validation step; it is scoped as a check, not a hidden requirement.
- **Punt-resolvability — pass.** No punts; every decision was resolvable from the wire spec and the codebase, so all are `**Chosen:**`.
- **AC testability — pass.** DONE items are grep/review-checkable for the prose additions and behaviourally assertable by FAFF-1107; none say "works correctly".
- **Scope creep — pass.** The one-file prose change is enforced by the OUT OF SCOPE and confirmed-unchanged sections; no opportunistic edits smuggled in.
- **Skimmability — pass.** No invented labels (no F2/R3/Phase-N); subjects restated on cross-reference; tracker IDs used as-is.
- **Minor note (folded, not blocking):** the "Eval coverage" DONE item is phrased as a negative (no new seam) because the seam and contract are genuinely unchanged; I kept it explicit rather than dropping it, so a reviewer sees the judgement was made, not missed.

Findings resolution: zero blockers, zero majors, one minor (folded in place). The downgrade rule is not triggered, so a `high` self-rating stands.

**Confidence self-rating: high** — every decision is marked and closed, the sole assumption is bounded with a validation step, DONE mirrors the body 1:1, and every confirmed-unchanged claim was verified against the files rather than taken on trust.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
