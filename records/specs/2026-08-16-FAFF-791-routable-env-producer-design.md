# Spec — FAFF-791: routable env producer via a location-independent endpoint surface in `faffter-noon-env-compose`

> Spec: faffter-dark-nlspec · 2026-08-16 · interactive · confidence: high. Full spec on Linear FAFF-791.
>
> _Revised 2026-08-16 after spec-review: added the `base.host` trust-boundary/validation invariant (infosec lens) and its scenario + selftest (QA lens); corrected reference citations against the real repo (the endpoint derivation is `env.js:386-396`; the evaluator is the prose `faffter-noon-evaluate/SKILL.md`, there is no `evaluate-call.mjs`)._

This spec covers FAFF-791 ("Routable env producer: an env-slot occupant that returns an endpoint reachable across a machine boundary"). It is written for the build agent that will change the environment producer, and for the human reviewers who gate the one open decision it leaves standing. The audience should be able to build the whole thing from this document plus the cited files; the one thing it deliberately does not settle is which cross-machine transport fills the routable base, and that is called out as an open question, not left implicit.

The ticket's original framing proposed a brand-new env-slot occupant. A human has since revised that (see the comment on this ticket): this is producer-level work inside the existing default occupant, `faffter-noon-env-compose`, not a new occupant, and it needs no change to the `env-handle` contract. This spec is written to the revised framing.

## 1. WHY — problem and principles

**The load-bearing model.** Today the environment producer bakes `localhost` into the endpoints it hands the evaluator. Separate the endpoint into two parts — a per-service surface (scheme, host-published port, optional path) and a single base host — and resolve the base at provision time. Under the default the base resolves to `localhost`, so the emitted handle is byte-identical to today's. When an off-host transport later supplies a routable base, the same surface resolves against it and the same handle now points across a machine boundary. Nothing about the handle's shape changes; only where the base comes from does.

**Problem statement.** faff owns the seam from a provisioned environment handle to a code-blind evaluator to a holdout verdict to a merge gate (FAFF-30 and FAFF-309, both delivered), but the only environment producer, `faffter-noon-env-compose`, emits `http://localhost:PORT`, which is reachable only from the same host. That blocks a topologically-separated evaluator such as the FAFF-790 proof run, where the evaluator runs on a different machine from the system under build. This change reshapes the producer so the endpoint it emits can be provisioned from anywhere, without a new occupant and without a contract schema change.

**Design principles.**

**The endpoint surface is location-independent by construction.** The producer must not hard-code `localhost` into the surface it computes. The service, port, and path must be expressed separately from a base host, and the base host must be a resolved input, not a baked constant. `localhost` is a legitimate resolved value of that base for a local run; it must never be an assumption the surface cannot be built without.

**The local, loopback behaviour stays the zero-config default and must not regress.** With no configuration, the base resolves to loopback and the emitted handle is byte-for-byte what `faffter-noon-env-compose` emits today. Existing local runs, and the existing `env.js` compose-gen selftests that assert the `http://localhost:PORT` form, must keep passing unchanged.

**The handle keeps carrying resolved, absolute endpoints.** The reshaping is internal to the producer. The `env-handle` block still carries fully-resolved absolute `endpoint` / `endpoints` strings. It does not carry a relative surface plus a separate base for the consumer to compose, because that would change the shape the evaluator reads and break the "evaluator consumes unchanged" objective (see out-of-scope and the design rationale). The relative surface is a producer-internal representation, not part of the handle.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/env.js` (compose-gen endpoint derivation, lines 386-396) | JavaScript | Where `endpoints[s.name] = http://localhost:${hostPort}` (line 390) and the `endpoint` precedence (lines 392-396) are computed inline, and where the plan is assembled (lines 398-399). The change lives here. |
| `plugin/skills/faff/bin/lib/env.js` (compose-gen selftests) | JavaScript | Assert the `http://localhost:PORT` form and app precedence. Must stay green under the default base. |
| `plugin/skills/faff/contracts/env-handle.schema.json` | JSON Schema | The handle contract. `endpoint`/`endpoints`/`credentials` already permit any string/object; a required `violations` array backs the fail-loud path; `additionalProperties:false`. No change. |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` | Markdown (prompt) | The producer prose. Emits the handle by copying the plan's `endpoint`/`endpoints`. Prose describing the surface may need a light touch; the localhost example stays valid as the default. |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Markdown (prompt) | The consumer — the code-blind holdout judge. Its exercise step (line 37) drives the feature "against the env's endpoints"; it reads `endpoint`/`endpoints` from the handle and has no path that reads `credentials`. The scrutiny point for the "zero changes" objective. (The evaluator is prose-driven; there is no `.mjs` spawner file.) |
| `records/adr/0031-env-handle-contract-env-slot-provision-box-interface.md` | Markdown | Fixes handle shape; explicitly leaves the provisioning mechanism (compose now, cloud later) to the producer. This change is squarely inside that boundary. |

**Scope statement.** This sits in the provision box of the build-and-judge pipeline, one producer behind the fixed `env-handle` contract; it changes how that producer computes endpoints, and nothing else in the pipeline.

## 2. Out of scope

- **The concrete cross-machine transport.** Which mechanism supplies a routable base — Fly private networking (6PN over WireGuard), a published port plus a short-lived token, or a preview URL — is a punted open question (see open questions), not decided or built here. **Extension point:** the base-resolution step in `env.js` compose-gen (the resolver defined in section 3); a transport fills the base there.
- **Evaluator-side consumption of per-request credentials.** The evaluator (`faffter-noon-evaluate/SKILL.md`) exercises criteria against the env's endpoints and has no path that reads `credentials` off the handle and attaches them to outbound requests. If a chosen transport needs per-request auth (for example the published-port-plus-token option), that is new evaluator plumbing, and it is deferred with the transport it depends on. **Extension point:** the evaluator's exercise step (SKILL.md line 37), which would gain a credentials-bearing path.
- **File-based datastores as a routable target.** The current producer has a `file://<path>` endpoint fallback for a file-based store such as sqlite (line 396). A local file path is not a networked surface and cannot be re-based to a routable host. Off-host provisioning of a file-based store is not addressed; the transport seam covers networked services only. **Extension point:** a future networked-datastore path in compose-gen, if a file-based store ever needs off-host reach.
- **The `env-handle` contract schema.** No field is added, removed, or re-typed. The existing optional `credentials` object is the designated home for any future evaluator-facing auth, so even that needs no schema change. **Extension point:** none required; the shape already accommodates the seam.
- **Any change to seeding, health-wait, or teardown mechanics.** Those stages (`faff env seed`, `faff env up` health polling, `faff env down`) are untouched except that teardown must still remove everything the run provisioned (see acceptance criteria).

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Relative surface | The per-service description of how to reach a service, independent of where it runs: scheme, host-published port, and optional path. Producer-internal; never emitted in the handle. |
| Base host | The single host component the relative surface is resolved against at provision time. Default `localhost`. A transport later supplies a routable value. |
| Resolved endpoint | The absolute URL the handle carries, formed by composing the base host with a service's relative surface. This is exactly what the handle emits today; only its derivation changes. |

**The relative surface (producer-internal, in the ProvisionPlan).** Today `env.js` compose-gen produces a plan carrying `endpoint` and `endpoints` as absolute localhost strings (built at lines 386-396, assembled into the plan at lines 398-399). This change adds a relative representation and a resolved base to the plan, and derives `endpoint`/`endpoints` from them rather than baking localhost inline.

```
RECORD ServiceSurface:                 # one per provisioned service
  service: String                      # e.g. "app", "db", "minio"
  scheme: String                       # "http" | "tcp"; today: http for app/minio, tcp for other datastores
  port: Int                            # the host-published port (s.ports[0] host side), as today
  path: String                         # optional; "" unless a service needs a path prefix

RECORD BaseHost:
  host: String                         # resolved at provision time; DEFAULT "localhost"
  # a transport later supplies a routable host (+ possibly a credential handled elsewhere)

# the plan gains: surfaces: List<ServiceSurface>, base: BaseHost
# endpoints/endpoint are DERIVED, not stored independently:
#   endpoints[s.service] = resolve(base, s)
#   resolve(base, s) = "{s.scheme}://{base.host}:{s.port}{s.path}"
```

The endpoint-precedence rule is unchanged: `endpoint` is the app's resolved endpoint, else the first non-file-based datastore's, else the `file://<path>` fallback for a file-based store, else `""`. Precedence operates over the resolved endpoints exactly as it does today (lines 392-396).

**The handle is unchanged in shape.** The producer still emits one `faff-contract:env-handle` block with absolute `endpoint`/`endpoints`. Under the default base those strings are identical to today's; under a routable base they are absolute routable URLs. No schema field is added.

**Design decision — where the base is resolved.** The base is resolved inside compose-gen, which takes an optional base parameter defaulting to `localhost`; the resolved absolute endpoints are written into the plan. Compose-gen stays pure and deterministic (its selftests exercise it without docker), and the resolved surface lands in the plan the producer already copies into the handle. The alternative, resolving in the live `faff env up` step, is rejected here: it would split endpoint derivation across two stages and leave the pure, tested compose-gen emitting a half-formed surface. **Chosen:** base resolution is a parameter of compose-gen, defaulting to `localhost`, so the default path is byte-identical and deterministic, and a transport injects a non-default base at the same seam. (A transport that only learns its routable address after the env is up would re-invoke the resolver with the discovered base before the handle is emitted; wiring that is part of the punted transport, not this ticket.)

**Design decision — the `base.host` trust boundary.** The base host is operator- or transport-supplied and is string-interpolated into evaluator-reachable endpoint URLs, so it is a trust boundary the producer must validate, not pass through. `base.host` is a bare host or IP only — no scheme, no embedded port, no path, query, fragment, or userinfo; an IPv6 literal is bracketed (`[::1]`) — and compose-gen validates it before resolving any surface. A malformed base fails loud (compose-gen errors, or the handle carries a `violations` entry and `status` is never `ready`); it never resolves into a silently half-formed URL the evaluator would then call. Under the default the base is the literal `localhost`, which passes trivially, so this adds nothing to the default path. **Chosen:** validate `base.host` as a bare host/IP and fail loud on anything else, so the punted transport builds against a stated, enforced constraint at the seam rather than concatenating unchecked input into a reachable URL. (This is the seam's security invariant; the per-request auth question — how the evaluator proves it is the only caller — is separately punted with the transport.)

**Design decision — resolved-absolute endpoints vs a relative handle.** The handle continues to carry resolved absolute endpoints rather than exposing the relative surface plus a base for the consumer to assemble. This keeps the shape the evaluator reads identical, which is what lets the evaluator consume the handle unchanged. Exposing a relative surface in the handle would need both a schema change and a matching change in the evaluator's exercise step, and the human framing rules out the schema change. **Chosen:** resolved absolute endpoints stay in the handle; the relative surface is producer-internal only.

**Design decision — where evaluator-facing auth would live.** The `env-handle` schema already carries an opaque `credentials` object (today: `db_user`/`db_password`, runtime-only, never persisted to tracker or PR). If a transport needs the evaluator to authenticate to a routable endpoint, `credentials` is the carrier, so no schema change is needed to hold it. Whether and how the evaluator reads and attaches it is a separate question tied to the transport. **Chosen:** `credentials` is the designated home for any future evaluator-facing auth, under the same opaque, runtime-only, never-persisted rule as the datastore credentials it holds today. **Punt:** whether the evaluator must attach that auth per request, and the plumbing to do so, deferred with the transport (see open questions and out-of-scope).

## 4. HOW — behaviour

**Overview.** The producer's live pipeline (honour recommendation, generate plan, bring up, health-wait, seed, emit) is unchanged in ordering and in every stage except plan generation. Inside plan generation, endpoint derivation (the inline loop at `env.js:386-396`) is reshaped: build a relative surface per service, resolve it against a base host that defaults to `localhost`, and derive the plan's `endpoint`/`endpoints` from the resolution. Everything downstream of the plan (the producer copying `endpoint`/`endpoints` into the handle, the evaluator reading them) is untouched.

**Endpoint derivation (replaces the inline localhost baking at `env.js:386-396`).**

```
PROCEDURE derive_endpoints(services, seed_targets, outPath, base = { host: "localhost" }):
  0. VALIDATE base.host is a bare host/IP (no scheme/port/path/query/fragment/userinfo;
     IPv6 literal bracketed; non-empty); else FAIL LOUD (no surface is resolved)
  1. surfaces = []
  2. FOR each service s in services:
       a. scheme = "http" IF s.name in { "app", "minio" } ELSE "tcp"    # unchanged scheme rule (FAFF-273, line 390)
       b. port   = s.ports[0] host side                                  # unchanged (line 388)
       c. surfaces.append({ service: s.name, scheme, port, path: "" })
  3. endpoints = {}
  4. FOR each surface in surfaces:
       endpoints[surface.service] = resolve(base, surface)               # "{scheme}://{host}:{port}{path}"
  5. endpoint = ""                                                        # precedence unchanged (lines 392-396)
     IF endpoints["app"]:            endpoint = endpoints["app"]
     ELSE IF services non-empty:     endpoint = endpoints[services[0].name]
     ELSE IF seed_targets non-empty: endpoint = "file://" + join(dirname(outPath), seed_targets[0].service + ".sqlite")
  6. RETURN { surfaces, base, endpoints, endpoint }

FUNCTION resolve(base, surface):
  RETURN surface.scheme + "://" + base.host + ":" + surface.port + surface.path
```

**Behaviour summary.** With `base.host = "localhost"` and `path = ""`, `resolve` returns exactly the strings the current code writes inline at line 390, so the plan's `endpoints`/`endpoint` are unchanged for every existing case. The only new capability is that a caller can pass a different `base.host` and get the same surfaces resolved against it.

**The file-based fallback stays local.** Step 5's `file://` branch (line 396) is a local path and is not routed through `resolve`. It is inherently local and is out of scope for routability (see out-of-scope). A file-based store never gains a routable endpoint from this change.

**Anti-pattern:** re-introducing `localhost` anywhere inside `resolve` or `derive_endpoints` other than as the default value of `base.host`. Why: that re-bakes the assumption the principle removes, and a transport injecting a routable base would silently keep emitting loopback.

**Anti-pattern:** adding a base or host field to the emitted `env-handle` block. Why: the handle shape is fixed by the contract (`additionalProperties:false`) and the human framing forbids a schema change; the base is resolved before emit and only the resolved absolute endpoints are emitted.

**Failure modes.**

- **The reshaping is not actually byte-identical under the default.** The whole no-regress objective rests on `resolve("localhost", surface)` reproducing the old inline strings for every service kind (http app, http minio, tcp datastore) and the precedence order. *How you'd know:* the existing `env.js` compose-gen selftests, which assert the `http://localhost:PORT` forms and the app precedence, fail. *What it means:* the derivation diverged from the old inline logic; fix the derivation, do not relax the selftests.
- **A transport is assumed reachable but the routable base is never actually reached across the boundary.** This ticket ships only the seam and the loopback default; it does not prove any transport works. *How you'd know:* there is no off-host green path in this ticket to observe; the first real signal is the FAFF-790 proof run reaching the SUT (or failing to). *What it means:* proceed with the seam, but do not claim cross-machine reachability is demonstrated here; that claim belongs to the ticket that fills the base and runs FAFF-790.
- **`credentials` is treated as the auth solution.** Carrying auth in `credentials` is shape-compatible, but the evaluator has no code path that reads it. *How you'd know:* an off-host endpoint that needs auth returns 401/403 during evaluation, because the evaluator sent no credential. *What it means:* the transport that needs per-request auth also needs the evaluator plumbing named in out-of-scope; the two ship together, not this ticket alone.
- **An unvalidated base host is concatenated into the endpoint.** `base.host` is operator/transport-sourced; if a transport passes a value carrying a scheme, an embedded path, or credentials, naive concatenation yields a malformed or misdirected URL the evaluator then calls. *How you'd know:* a resolved endpoint contains a doubled scheme (`http://https://…`) or an unexpected path or `@`-host. *What it means:* the `base.host` validation invariant (step 0) was skipped; validate it as a bare host/IP and fail loud before resolving any surface.

## 5. Scenarios

Main objectives, born verifiable.

```
Given a team profile and repo compose that today yield endpoints[app] = "http://localhost:3000"
When compose-gen runs with no base configured
Then the plan's endpoints[app] is exactly "http://localhost:3000" and endpoint follows the app-first precedence, byte-identical to the pre-change output
```

```
Given the same profile and repo compose
When compose-gen resolves the relative surface against an injected base host of 10.0.0.5
Then the plan's endpoints[app] is "http://10.0.0.5:3000", the scheme and port are unchanged, and the env-handle block still contains only the fixed contract fields (no added base or host field)
```

```
Given a malformed base host such as "http://evil/", "1.2.3.4/admin", or "user@host"
When compose-gen resolves the surface against it
Then it fails loud (compose-gen errors, or the handle carries a violations entry and status is never ready) and never emits a resolved endpoint URL
```

```
Given a ready env-handle whose endpoints were resolved against any base
When faffter-noon-evaluate consumes the handle
Then it validates via `faff contract env-handle` and exercises criteria against the env's endpoints with no change to the evaluator, because the handle still carries absolute endpoint strings
```

- The teardown path removes the provisioned env and any transient networking or credential the run created, on every exit path, with no change to the existing `faff env down` behaviour for the local case.

## 6. Design decision rationale

**Extend `faffter-noon-env-compose`, or add a new env-slot occupant?** The ticket originally proposed a new occupant. A new occupant would duplicate the reusable machinery that already lives in `faffter-noon-env-compose` and its `faff env` verbs: compose generation, seed loaders, health-wait, teardown. The routability change touches only endpoint derivation, a few lines of one function. **Chosen:** extend the existing default occupant. This is the human-decided framing; it is recorded, not re-opened.

**Reshape the surface to be location-independent, or add a routable producer beside the localhost one?** Two producers would fork the pipeline and force a config choice between "local" and "routable" builds, and the second would re-derive everything the first already does. A single surface that resolves against a base makes local a resolved value rather than a separate mode. **Chosen:** one location-independent surface, base resolved at provision time, default loopback. This is the human-decided principle; recorded, not re-opened.

**Validate the base host, or trust the caller?** The base host is operator/transport-sourced and lands in a URL the evaluator calls, so trusting it un-validated turns a config value into an injection surface (doubled scheme, unexpected path, `@`-host). **Chosen:** validate `base.host` as a bare host/IP at the seam and fail loud on anything else, so the punted transport inherits an enforced constraint rather than concatenating unchecked input. The default `localhost` passes trivially.

**Resolved-absolute endpoints in the handle, or a relative surface plus base for the consumer to compose?** A relative handle reads cleaner in the abstract, but it changes the shape the evaluator reads, which needs a schema change (ruled out by the framing) and a matching change in the evaluator's exercise step, and it breaks the objective that the evaluator consumes the handle unchanged. **Chosen:** the handle keeps resolved absolute endpoints; the relative surface is producer-internal. Rejected: relative-surface-in-handle, because it would fail the zero-change-to-evaluator objective and force a contract schema change.

**Where does base resolution live?** In compose-gen as a parameter (default `localhost`), not in the live `faff env up` step. Compose-gen is pure and deterministic and already produces the plan the producer copies; keeping resolution there keeps the default byte-identical and the tests docker-free. Rejected: resolving in `up`, which would split derivation across stages. A transport that only learns its address post-up re-invokes the resolver with the discovered base before emit, and that wiring belongs to the transport ticket. **Chosen:** compose-gen parameter, default `localhost`.

**Where would evaluator-facing auth live, if a transport needs it?** In the existing opaque `credentials` object, under the same runtime-only, never-persisted rule as today's datastore credentials, so no schema change is needed to hold it. **Chosen:** `credentials` is the carrier. The consuming plumbing is punted with the transport.

**Which cross-machine transport?** At the time of writing this is deliberately unresolved. The candidates (Fly 6PN over WireGuard, published port plus short-lived token, preview URL) differ in how the base is reached and whether the evaluator must authenticate. **Punt:** the transport, and with it the per-request-auth question, are for a human to decide (see open questions). The design above is transport-neutral: any of the three fills the base at the same seam.

## 7. Open questions and assumptions

**Open questions.**

- **Which cross-machine transport supplies the routable base?** Fly private networking (6PN over WireGuard), a published port plus a short-lived token, or a preview URL. Each fills the base at the compose-gen resolution seam, but they differ on authentication and on whether the routable address is known before or after the env is up. This ticket ships the seam and the loopback default only; the transport is chosen when a consumer (FAFF-790) needs it. **Punt:** transport mechanism (decides: architecture).
- **Does the evaluator need to attach per-request credentials, and if so with what plumbing?** Only some transports (for example published-port-plus-token) need the evaluator to authenticate. The evaluator has no path today that reads `credentials` off the handle. If auth is needed, that plumbing ships with the transport, not here. **Punt:** evaluator per-request auth consumption (decides: any).

**Assumptions.**

- **Assumes** FAFF-790 (the proof run that executes the evaluator on a separate machine from the system under build) is the first consumer that will select a concrete transport to fill the base. *Validation:* confirm FAFF-790 is still the intended first consumer before wiring any transport; if it has changed, re-confirm which consumer drives the transport choice. This ticket does not depend on FAFF-790 landing first; it ships the seam and the loopback default standalone.

## 8. DONE — definition of done

### From WHY
- [ ] With no base configured, the emitted `env-handle` carries endpoints identical to the pre-change producer output (loopback local behaviour does not regress).
- [ ] The producer can emit an off-host-reachable absolute endpoint when a non-default base is supplied, with no new env-slot occupant and no `env-handle` schema change.

### From WHAT (types and interfaces)
- [ ] Compose-gen produces a per-service relative surface (`scheme`, `port`, `path`) plus a resolved base in the plan, and derives `endpoints`/`endpoint` from them rather than baking `localhost` inline at line 390.
- [ ] The scheme rule is unchanged: `http` for `app` and `minio`, `tcp` for other datastores.
- [ ] The endpoint-precedence rule is unchanged: app, else first non-file-based datastore, else the `file://` fallback, else `""`.
- [ ] The emitted `env-handle` block contains only the fixed contract fields; no base or host field is added.
- [ ] `credentials` remains the opaque, runtime-only, never-persisted object; no schema field is added for auth.

### From HOW (behaviour)
- [ ] `resolve(base, surface)` returns `"{scheme}://{host}:{port}{path}"`, and with `base.host = "localhost"`, `path = ""` reproduces the current inline strings exactly.
- [ ] Base resolution is a parameter of compose-gen defaulting to `localhost`; passing a different `base.host` re-bases every service's endpoint without changing scheme or port.
- [ ] The `file://` fallback for a file-based store is not routed through `resolve` and stays a local path.
- [ ] `localhost` appears only as the default value of `base.host`, nowhere inside `resolve` or the surface construction.
- [ ] `base.host` is validated as a bare host or IP (rejecting an embedded scheme, port, path, query, fragment, or userinfo; IPv6 bracketed; non-empty) before any surface is resolved; a malformed base fails loud (compose-gen errors or the handle carries a `violations` entry and `status` is never `ready`), never emitting a resolved URL. The default `localhost` passes this check.

### From HOW (edge cases and teardown)
- [ ] Teardown removes the provisioned env and any transient networking or credential the run created, on every exit path; the local `faff env down` behaviour is unchanged.

### From evaluator impact
- [ ] `faffter-noon-evaluate` consumes the reshaped handle with no change to its exercise step: the handle still carries absolute `endpoint`/`endpoints` strings, and the evaluator exercises criteria against them as before.

### Tests
- [ ] The existing `env.js` compose-gen selftests (the `http://localhost:PORT` form and app-precedence assertions) pass unchanged under the default base.
- [ ] A new selftest asserts that resolving the same surface against an injected non-default base host yields the re-based absolute endpoint with unchanged scheme and port.
- [ ] A new selftest asserts a malformed `base.host` (scheme/path/userinfo present, or empty) fails loud and produces no resolved endpoint.

**Integration smoke test.**

```
1. Run compose-gen for a repo whose app publishes port 3000, with no base configured.
2. Assert plan.endpoints["app"] == "http://localhost:3000" and plan.endpoint == plan.endpoints["app"].
3. Re-run compose-gen for the same input with base.host = "10.0.0.5".
4. Assert plan.endpoints["app"] == "http://10.0.0.5:3000", scheme and port unchanged.
5. Re-run with base.host = "http://evil/"; assert it fails loud and emits no resolved endpoint.
6. Emit the handle from the valid plans; assert both validate via `faff contract env-handle` and neither carries a field outside the fixed contract shape.
```

confidence: high
