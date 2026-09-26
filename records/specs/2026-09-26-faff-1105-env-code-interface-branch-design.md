# Spec — FAFF-1105: Add the code-interface branch to the env slot

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: medium. Two human decisions (D1 new inline-composed `env-code-interface` slot; D2 per-issue judgement not a flag) are settled inputs. Spec-review round 1 (architectural/infosec/QA) returned revise on one infosec minor; the host-publish-constraint fix + three architectural clarifications are folded into §4 below.
>
> **Delivery split (build-time, human-approved):** this PR ships the **mechanism** (the `env-code-interface` slot + occupant + validate-adapters registration + config default + the env-compose code-interface branch). The **calibrated judgement-KIND eval** half of D2 (flipping env-compose's `judgement_seam` from `none` and wiring a new grader KIND across `grader.mjs` / `seam-registry.json` / the eval frontier driver + ≥2 calibration cases) proved a self-contained eval sub-project materially larger than the spec's "≥1 case" estimate, and is split to a follow-up (recorded as discovered scope). env-compose keeps `judgement_seam: none` here — the per-issue path choice is the same class of provisioning decision it already makes; its calibration as a graded seam is the follow-up.

**Context:** part of the *code-blind holdout for non-service code interfaces* workstream; blocked-by FAFF-1103 (Tier-1 manifest) + FAFF-1104 (Node reflection bridge), both merged; blocks FAFF-1107 (e2e conformance); related FAFF-1102 (wire).

## 1. WHY

The env slot provisions *whatever the code-blind evaluator points at*, and the evaluator only speaks over the wire. Today it composes only running **services** (docker-compose). FAFF-1104 shipped a bridge (`faff-bridge-node.mjs`) that is *itself a service on the wire*: it reflects a Tier-1 manifest and answers session-RPC over HTTP. So a **code** component is reached by building it, starting the bridge beside it, and pointing the evaluator at the bridge socket — no new evaluator concept, no new transport, no widened env-handle. The env slot gains a branch, not a contract.

**Design principles.**
- **Freeze the contracts.** `env-handle`, the `transport` slot, the session-RPC wire, and the holdout/threat model are UNCHANGED. The bridge is a service on the wire, so the branch conforms by emitting the *same* env-handle block. No env-handle field added/overloaded; no code-vs-service flag on `architecture-proposal`.
- **The handle is a contract, not a mechanism.** `env-handle.schema.json` ("provisioning MECHANISM lives in the producer") and env-compose's own note ("any producer conforms by emitting the same block") anticipate a non-compose producer.
- **Judgement, not detection (D2).** Service-vs-code-interface is not binary and not a stored fact: a project that composes as services will *also* have code-only components. Which subject to holdout-test for *this issue*, and how to reach it (services / bridge / both), is the env occupant's per-issue call over the issue spec + DoD, the architecture proposal, and the infra profile. A committed `.faff/binding-manifest.json` is the bridge's input, not the decider. (This PR realises the *decision + mechanism*; calibrating it as a graded eval KIND is the split follow-up.)
- **Reuse, don't reinvent lifecycle.** The bridge is long-running, stopped by SIGTERM. The compose lifecycle (`faff env up`/`down --project`) already spawns, health-polls, and idempotently tears down SUT-side. Host the bridge as a compose service rather than invent a bare-process teardown primitive.

## 2. OUT OF SCOPE
- **Proving SUT-cage placement (topology proof)** — 1105 gets placement right (bridge runs where services run); *proving* it is FAFF-1107.
- **The calibrated judgement-KIND eval** — split follow-up (discovered scope): the grader KIND + seam-registry row + frontier-driver loader + ≥2 cases + env-compose `judgement_seam` flip.
- **A non-Node runtime bridge; cross-machine bare-process teardown; multi-bridge fan-out beyond one bridged component per issue** — later tickets / loop over `endpoints[]`.
- **Any change to the wire, manifest schema, or the bridge; widening `architecture-proposal`** — frozen / D2-forbidden.

## 3. WHAT

**The new slot (D1).**
```
SLOT env-code-interface:
  config_key:       slots.env-code-interface        # config.js SLOT_DEFAULTS; resolved via `faff config get`, never named literally
  default_occupant: faffter-noon-env-code-interface
  conformance_type: producer-env-code-interface     # new validate-adapters SLOT_TYPES + REGISTRY + checksFor entry
  composition:      INLINE under env-compose         # transport precedent; returns a plain object, no gated block
```

**The occupant's return object** (a plain object env-compose folds into the handle it still emits — mirrors transport's `{base_host,...}`, NOT a `faff-contract` block):
```
RECORD CodeInterfaceResult:
  ok: Boolean                  # health-check passed; false => env-compose emits status:failed
  endpoint: URL                # http://<base_host>:<port> — the bridge socket
  health_checks: [HealthCheck] # exactly [{ name, path:"/faff-rpc/health", expected_status:200 }]
  teardown_ref: String         # the bridge compose project name (shared with the env project)
  teardown_cmd: String         # "faff env down --project <name>"
  provisioner: String          # "faffter-noon-env-code-interface"
  notes: [String]?             # e.g. the built --module path, the manifest path used
  violations: [String]?        # non-empty on !ok
RECORD HealthCheck: { name, path, expected_status }   # SAME shape as env-handle.health_checks[]
```

**env-handle — UNCHANGED (frozen).** The branch fills existing fields: `status:"ready"` (only when bridge up+healthy); `endpoint = http://<base_host>:<bridge_port>`; `endpoints = {"<subject>": <endpoint>, ...}` (plural; services + bridges coexist); `health_checks = [{name:"bridge", path:"/faff-rpc/health", expected_status:200}]`; `teardown_ref`/`teardown_cmd` folded with any service/transport teardown; `provisioner:"faffter-noon-env-compose"` (env-compose stays the sole emitter); `violations:[]`. Gate rule unchanged: exit 0 only on ready + non-empty endpoint + ≥1 health_check + non-empty teardown_ref/provisioned_at/provisioner.

**validate-adapters registration (D1)** (mirroring the transport rows): `REGISTRY["faffter-noon-env-code-interface"]={type:"producer-env-code-interface"}`; `SLOT_TYPES["env-code-interface"]={type:"producer-env-code-interface",slot:"env-code-interface"}`; a `checksFor` case `producer-env-code-interface` modelled on `producer-transport` — names its slot, documents the bridge endpoint + `/faff-rpc/health` + teardown, asserts NO faff-contract block. `config.js` gains `"slots.env-code-interface": "faffter-noon-env-code-interface"`.

**Chosen — occupant return shape:** the occupant returns a plain `CodeInterfaceResult` folded inline by env-compose; env-compose remains the sole `env-handle` emitter. (decides: architecture)

## 4. HOW

```
faffter-noon-env-compose (env slot, still the env-handle emitter)
  ├─ honour architecture-proposal.recommendation      [unchanged]
  ├─ resolve transport slot inline -> { base_host, ... } [unchanged, reused verbatim]
  ├─ decide the subject(s) under test + how to reach them (services / bridge / both) [per-issue provisioning choice]
  ├─ IF services:  faff env compose-gen / up / seed     [unchanged path]
  ├─ IF bridge:    resolve slots.env-code-interface, invoke inline -> CodeInterfaceResult
  └─ fold results -> emit ONE faff-contract:env-handle  [frozen shape]
```

**The bridge branch (occupant).**
```
PROCEDURE provision_bridge(component, base_host, manifest_path=".faff/binding-manifest.json"):
  1. faff manifest validate --file <manifest_path>   # explicit path; NO default auto-resolution
     invalid/absent -> RETURN {ok:false, violations:["binding manifest absent/invalid"]}
  2. Build the component; resolve its module entry -> <module_path>
     no entry -> RETURN {ok:false, violations:["component build produced no module entry"]}
  3. Synthesise a minimal ProvisionPlan for ONE bridge service (build context + the command below +
     the /faff-rpc/health healthcheck + the transport-constrained publish), sharing the env compose PROJECT.
       command: node faff-bridge-node.mjs --manifest <manifest_path> --module <module_path> --host 0.0.0.0 --port <p> --wire 1
  4. Bring it up + health-poll /faff-rpc/health to the SLA (reuse env up's 60s/2s); never healthy -> teardown, RETURN {ok:false,...}
  5. endpoint := envResolveEndpoint({host:base_host}, {scheme:"http", port:<published p>, path:""})   # real 2-arg signature (env.js:374)
  6. RETURN {ok:true, endpoint, health_checks:[{name:"bridge",path:"/faff-rpc/health",expected_status:200}],
             teardown_ref:<env project>, teardown_cmd:"faff env down --project <env project>",
             provisioner:"faffter-noon-env-code-interface", notes:[module_path, manifest_path]}
```

**Host-side reachability (spec-review infosec fix — normative).** The bridge binds `--host 0.0.0.0` inside its container (required for the published port to be reachable — not itself a widening), but the docker **host-side publish** must follow the transport-resolved mechanism, never a naive all-interfaces `ports:["<p>:<p>"]`:
- **rootless `dind-in-cage`** (transport's shared-network-alias branch): reached over the shared user-defined docker network by service alias, **NO host `ports:` publish** — reachability is network membership, matching the service path.
- **rootful `dind-in-cage`**: via the host-gateway (`host.docker.internal`) as transport resolves for services — no all-interfaces publish.
- **co-resident / localhost**: publish bound to `127.0.0.1` only (`127.0.0.1:<p>:<p>`), never `0.0.0.0` on the host.

**Folding (env-compose).**
```
PROCEDURE fold(result):
  1. NOT result.ok -> emit env-handle status:"failed" + result.violations; teardown; STOP
  2. endpoints[<subject>] := result.endpoint
  3. health_checks += result.health_checks
  4. teardown: the bridge shares the env compose PROJECT, so a single `faff env down --project <name>` removes
     services AND bridge together (faff env down takes exactly one --project; a separate project would need a
     compound teardown_cmd — deferred).
  5. only-bridge -> top-level endpoint := result.endpoint
  6. emit ONE faff-contract:env-handle status:"ready"
```

**Bridge lifecycle + teardown (Chosen — compose-hosted).** The occupant hosts the bridge as a service in the env's own compose project (build context = built component, `command` = the `node faff-bridge-node.mjs …` line, `healthcheck` = `/faff-rpc/health`) via the docker-compose lifecycle env already owns; teardown is the existing idempotent `faff env down --project`. Zero new teardown machinery; SUT-cage placement identical to services. Rejected the bare-process (`killable-spawn.mjs` + new teardown verb) option; cross-machine bare-process teardown punted. (decides: architecture)

**Manifest + `--module`.** `.faff/binding-manifest.json` passed **explicitly** to `faff manifest validate --file` and the bridge `--manifest` (no default-path resolution). `--module` is the built component's module entry, resolved from build output (a separate arg from `--manifest`). Fail-closed if manifest absent/invalid or no module entry.

**BOTH-at-once.** A single issue may need services AND a bridged component; multiple subjects live in `endpoints[]` (plural, already in the handle); top-level `endpoint` is the primary. v1 stands up one bridge alongside the service path; N bridges is a loop.

**SUT-cage placement.** The bridge runs where `faff env up` runs (orchestrator host = SUT-cage side per transport's dind-in-cage branch) — the same implicit guarantee services rely on; asserting it here is enough, *proving* it is FAFF-1107.

**Anti-patterns:** naming `faffter-noon-env-code-interface` literally at the dispatch site (FAFF-191 lint requires `faff config get slots.env-code-interface`); the occupant emitting a `faff-contract` block (its `producer-env-code-interface` check asserts none; env-compose is the sole emitter); a naive all-interfaces host publish (the infosec fix above).

## 5. Scenarios — born-verifiable

```
Given an issue whose subject is a code component with a valid .faff/binding-manifest.json
When env-compose takes the bridge path
Then it emits ONE faff-contract:env-handle status:ready, endpoint http://<base_host>:<port>,
     health_checks containing { path:"/faff-rpc/health", expected_status:200 }
```
```
Given a bridge-branch env-handle
When faff contract env-handle validates it
Then it exits 0 with env-handle.schema.json UNCHANGED
```
```
Given .faff/binding-manifest.json is absent or fails `faff manifest validate --file`
When env-compose runs the bridge path
Then it emits status:failed (never ready) with a violations entry naming the fault, and stands up no half-up bridge
```
- The `env-code-interface` occupant carries NO `faff-contract:` block and passes its `producer-env-code-interface` conformance checks (`faff validate-adapters`).
- The dispatch site resolves `faff config get slots.env-code-interface` and names no default literally (FAFF-191 lint passes).
- `faff config get slots.env-code-interface` resolves to `faffter-noon-env-code-interface`.

## 6. Design Decision Rationale
- **Factoring (D1, settled):** new inline-composed `env-code-interface` slot (transport precedent, zero new machinery). (settled)
- **Judgement, not flag (D2, settled):** a per-issue provisioning decision; no flag, no `architecture-proposal` field. Its *calibration* as a graded eval KIND is split to a follow-up (see the delivery-split note). (settled)
- **Lifecycle:** compose-hosted (reuses `faff env down`); bare-process + cross-machine deferred. (decides: architecture)
- **Multiple subjects:** `endpoints[]`; N-bridge fan-out deferred. (decides: architecture)

## 7. Open Questions and Assumptions
- **Punt:** the calibrated judgement-KIND eval (grader KIND naming + seam-registry + frontier-driver wiring + ≥2 cases + env-compose `judgement_seam` flip) — split to a follow-up; the seam-registry NOTE currently documents env-compose as `judgement_seam:none` and the follow-up rewrites it. (decides: qa/architecture)
- **Assumes:** FAFF-1103 (`faff manifest validate --file`) + FAFF-1104 (`faff-bridge-node.mjs`) merged/stable (confirmed at HEAD).
- **Assumes:** the SUT component build produces a resolvable module entry usable as `--module`; else the branch fails closed.
- **Assumes:** for a bridged component, a valid `.faff/binding-manifest.json` exists; validated before the bridge starts.

## 8. DONE — Definition of Done (this PR: the mechanism)
- [ ] `env-code-interface` registered in `validate-adapters.js` (`SLOT_TYPES` + `REGISTRY` as `producer-env-code-interface`) with a `checksFor` case modelled on `producer-transport` (names its slot, documents bridge endpoint + `/faff-rpc/health` + teardown, asserts NO `faff-contract` block).
- [ ] `config.js` `slots.env-code-interface` default = `faffter-noon-env-code-interface`; `faff config get slots.env-code-interface` resolves.
- [ ] Bundled `plugin/skills/faffter-noon-env-code-interface/SKILL.md` (`user-invocable:false`) exists and passes `faff validate-adapters`; carries no `faff-contract` block; documents the `CodeInterfaceResult` inline return + the compose-hosted bridge + the transport-constrained host publish.
- [ ] `faffter-noon-env-compose/SKILL.md` gains the code-interface branch: decide subject(s) + reachability per issue, resolve `faff config get slots.env-code-interface`, invoke inline, fold the result into the one `env-handle` it still emits; `faff env down --project` (shared project) tears down services + bridge together.
- [ ] The bridge branch calls `faff manifest validate --file <path>` explicitly and fails closed (status:failed + violations) on absent/invalid manifest.
- [ ] The bridge is started via `node faff-bridge-node.mjs --manifest <path> --module <built-entry> --host 0.0.0.0 --port <p> --wire 1`, compose-hosted; endpoint = `http://<transport base_host>:<published port>`; health via `/faff-rpc/health`.
- [ ] Host reachability follows the transport-resolved mechanism (no all-interfaces host publish).
- [ ] env-compose remains the sole `env-handle` emitter; `faff contract env-handle` exits 0 on the bridge-branch handle, schema unchanged.
- [ ] `faff validate-adapters` passes (new slot + occupant conform; FAFF-191 lint passes).

### Deferred to the follow-up (split — recorded as discovered scope)
- [ ] env-compose `judgement_seam` flips from `none` to a new KIND; a grader KIND (grader.mjs KINDS + oracle-routing + grade-dispatch arm), a `seam-registry.json` row (+ NOTE rewrite), the eval frontier driver loader + EVAL_MODE instruction, and ≥2 calibration cases.

confidence: medium
build-tier: complex
spec-review: revise → fix folded (infosec host-publish constraint) + architectural clarifications
