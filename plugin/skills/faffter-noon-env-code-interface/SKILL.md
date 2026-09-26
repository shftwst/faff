---
name: faffter-noon-env-code-interface
description: "Default `env-code-interface` slot occupant — the code-interface reachability provisioner, composed under `env`. Given a code component and its Tier-1 binding manifest, it builds the component and stands up the Node reflection bridge (faff-bridge-node.mjs) as a health-checked compose service, returning the bridge socket the env occupant folds into its env-handle. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
---

# faffter-noon-env-code-interface

The default occupant of the **`env-code-interface`** slot, composed **inline** under `env` exactly as `transport` is: given a code component that the code-blind evaluator must reach over the wire, it builds the component, starts the Node reflection bridge (`faff-bridge-node.mjs`) beside it in the SUT cage, health-checks the bridge socket, and returns a plain reachability result the `env` occupant folds into the one `env-handle` it still emits. The bridge *is a service on the wire* (it reflects a Tier-1 manifest and answers session-RPC over HTTP), so the frozen `env-handle` / `transport` / wire / holdout contracts are untouched — this occupant adds a reachability mechanism, not a contract.

> When standalone, Read the sibling `faff/references/kernel.md` (the shared kernel) first, then `faff/references/l4.md` (the L4 concurrency & evaluator lane it consumes). This recap is non-normative; the gateway kernel wins.

## What it does

One provisioning mechanism: build a code component and expose it over the wire through the Node reflection bridge (`faff-bridge-node.mjs`). It never crosses a trust boundary on its own and carries **no gated `faff-contract` block** — the `env` occupant that calls it consumes the returned object inline, in the same turn, exactly as it consumes the `transport` slot's base host. `env` remains the sole `env-handle` emitter.

It is a **mechanism, not a judgement**: *which* subject an issue's holdout must exercise, and *whether* a code component is best reached via the bridge (versus composed as a service, or both), is the calling `env` occupant's per-issue provisioning call. This occupant is invoked once that call has chosen the bridge path for a component; its job is to stand the bridge up correctly and hand back the socket.

## Inputs

- **`component`** — the code component to expose (its build target / the module the bridge reflects).
- **`subject`** — the subject-under-test name this bridge serves; it becomes the `endpoints[]` key and the health-check name suffix, so multiple bridged components stay distinguishable.
- **`base_host`** — the transport-resolved reachability host (from the `transport` slot the `env` occupant already resolved); the bridge's endpoint is published against it, and it MUST pass `envValidateBaseHost` before use.
- **`manifest_path`** — the committed Tier-1 binding manifest, default `.faff/binding-manifest.json`. Passed **explicitly** to `faff manifest validate` and the bridge `--manifest` (the manifest verb and the bridge do NO default-path resolution).
- **`evaluator_topology`** — the same enum the `transport` slot switched on, so the host-side publish (below) matches the reachability mechanism.

## How it provisions

The occupant does **not** bring the bridge up on its own or run its own `faff env up`. It builds the component and **contributes one bridge service to the single env ProvisionPlan** the `env` occupant then brings up in one `faff env up` — so there is exactly one bring-up and one health-poll for the whole env (services + bridge), no second compose write to clobber, and no stale health verdict from a separate earlier up. The bridge service joins the env's own compose project, so the existing single `faff env down --project <name>` tears services and bridge down together.

```
PROCEDURE contribute_bridge(component, base_host, subject, manifest_path=".faff/binding-manifest.json", evaluator_topology):
  1. faff manifest validate --file <manifest_path>            # explicit path; fail-closed
     invalid / absent -> RETURN { ok:false, violations:["binding manifest absent/invalid"] }
  2. Build the component; resolve its module entry -> <module_path>
     no resolvable entry -> RETURN { ok:false, violations:["component build produced no module entry"] }
  3. Assert base_host via envValidateBaseHost (the positive allowlist).
  4. Contribute ONE bridge service to the env's ProvisionPlan (never a separate compose file / project):
       build:       the built component's context
       command:     node faff-bridge-node.mjs --manifest <manifest_path> --module <module_path> --host 0.0.0.0 --port <container_port> --wire 1
       healthcheck: GET /faff-rpc/health == 200
       reachability: PER evaluator_topology (see "Host-side reachability" below) — never a naive all-interfaces publish
     `<container_port>` is the fixed port the bridge binds inside its container (no host-side probe-then-bind race).
  5. endpoint := envResolveEndpoint({ host: base_host }, { scheme:"http", port:<reach_port>, path:"" })   # real 2-arg resolver
     where <reach_port> is the network-alias container port (no-host-publish branch) or the 127.0.0.1-published
     host port (localhost branch) — see Host-side reachability.
  6. RETURN { ok:true, endpoint, subject,
              health_checks:[{ name:"bridge:<subject>", path:"/faff-rpc/health", expected_status:200 }],
              teardown_ref:<env project>, teardown_cmd:"faff env down --project <env project>",
              provisioner:"faffter-noon-env-code-interface",
              notes:["reflected a code interface via the bridge"] }   # NO SUT paths — see "Code-blindness"
```

The `env` occupant merges every contributed bridge service into the one plan it brings up (with `compose-gen`'s services), does the single `faff env up` + health-poll (which covers `/faff-rpc/health`), and only then folds each result into the handle. A bridge whose `/faff-rpc/health` never passes fails that one health-wait, so the env occupant emits `status:failed` — the health verdict is never pre-committed by this occupant.

**Code-blindness of the notes.** The returned `notes` and every field the `env` occupant folds into the handle are read by the **code-blind evaluator**, so they carry **no SUT filesystem paths** (no built-module path, no manifest path) — only provisioning-state prose. The module/manifest paths stay in the occupant's own run log, never in the handle.

**Host-side reachability.** The bridge binds `--host 0.0.0.0` *inside* its container (required for its port to be reachable — not a widening); host-side exposure follows the transport-resolved mechanism, never a naive all-interfaces `ports:["<p>:<p>"]`:

- **rootless `dind-in-cage`** (transport's shared-network-alias branch): reached over the shared user-defined docker network by service alias, with **NO host `ports:` publish** — reachability is network membership, and the endpoint uses the **container port** on the alias host, matching the service path.
- **rootful `dind-in-cage`**: via the host-gateway (`host.docker.internal`) as transport resolves for services — no all-interfaces publish.
- **co-resident / localhost**: publish bound to `127.0.0.1` only (`127.0.0.1:<p>:<p>`), never `0.0.0.0` on the host; the endpoint uses that published host port.

**SUT-cage placement.** The bridge runs where `faff env up` runs — the orchestrator host, the SUT-cage side per transport's `dind-in-cage` branch — the same implicit placement services already rely on. This occupant carries no topology *proof*; proving the bridge never enters the evaluator cage is the downstream end-to-end conformance test.

## Output

An inline return, not a gated contract block — the calling `env` occupant folds it into the one `env-handle` it emits:

```
RECORD CodeInterfaceResult:
  ok:            Boolean               # the contributed bridge service is well-formed; false => env-compose emits status:failed
  endpoint:      URL                   # the bridge socket at the reachability host + reach_port
  subject:       String                # the subject-under-test this bridge serves (the endpoints[] key)
  health_checks: List<HealthCheck>     # [{ name:"bridge:<subject>", path:"/faff-rpc/health", expected_status:200 }]
  teardown_ref:  String                # the env compose project (shared, so one teardown removes both)
  teardown_cmd:  String                # "faff env down --project <name>"
  provisioner:   String                # "faffter-noon-env-code-interface"
  notes:         List<String>?         # provisioning-state prose only — NEVER a SUT filesystem path
  violations:    List<String>?         # non-empty on !ok; folded into the handle's violations
```

`health_checks[]` items are the SAME `{name, path, expected_status}` shape as the frozen `env-handle.health_checks[]`; the `name` is keyed by `subject` (`bridge:<subject>`) so N bridged components stay distinguishable in the handle. `teardown_ref`/`teardown_cmd` fold into the handle's existing teardown so one `faff env down` removes services and bridge together. Neither ever adds a field to the frozen `env-handle` contract. On `ok:false`, the `env` occupant emits `status:"failed"` with these `violations` and stands up no half-up env.

**Anti-pattern:** emitting a gated contract block — the result is consumed inline by `env`, never gated; the sole `env-handle` emitter is the `env` occupant. **Anti-pattern:** a naive all-interfaces host publish — it widens exposure past the transport's "only the evaluator can reach it" segmentation; follow the per-topology reachability above. **Anti-pattern:** putting a built-module or manifest path into `notes` / the handle — the evaluator is code-blind; SUT paths stay in the occupant's run log only.
