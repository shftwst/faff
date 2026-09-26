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
- **`base_host`** — the transport-resolved reachability host (from the `transport` slot the `env` occupant already resolved); the bridge's endpoint is published against it, and it MUST pass `envValidateBaseHost` before use.
- **`manifest_path`** — the committed Tier-1 binding manifest, default `.faff/binding-manifest.json`. Passed **explicitly** to `faff manifest validate` and the bridge `--manifest` (the manifest verb and the bridge do NO default-path resolution).
- **`evaluator_topology`** — the same enum the `transport` slot switched on, so the host-side publish (below) matches the reachability mechanism.

## How it provisions

```
PROCEDURE provision_bridge(component, base_host, manifest_path=".faff/binding-manifest.json", evaluator_topology):
  1. faff manifest validate --file <manifest_path>            # explicit path; fail-closed
     invalid / absent -> RETURN { ok:false, violations:["binding manifest absent/invalid"] }
  2. Build the component; resolve its module entry -> <module_path>
     no resolvable entry -> RETURN { ok:false, violations:["component build produced no module entry"] }
  3. Choose a free port <p>; assert base_host via envValidateBaseHost (the positive allowlist).
  4. Synthesise a minimal ProvisionPlan for ONE bridge service, in the ENV's own compose project so
     `faff env down --project <name>` tears it down with the services:
       build:       the built component's context
       command:     node faff-bridge-node.mjs --manifest <manifest_path> --module <module_path> --host 0.0.0.0 --port <p> --wire 1
       healthcheck: GET /faff-rpc/health == 200
       host publish: PER evaluator_topology (see "Host-side reachability" below) — never a naive all-interfaces publish
  5. Bring it up + health-poll /faff-rpc/health to the SLA (reuse `faff env up`'s poll).
     never healthy -> tear down, RETURN { ok:false, violations:["bridge health never passed"] }
  6. endpoint := envResolveEndpoint({ host: base_host }, { scheme:"http", port:<published p>, path:"" })   # the real 2-arg resolver
  7. RETURN { ok:true, endpoint,
              health_checks:[{ name:"bridge", path:"/faff-rpc/health", expected_status:200 }],
              teardown_ref:<env project>, teardown_cmd:"faff env down --project <env project>",
              provisioner:"faffter-noon-env-code-interface",
              notes:[<module_path>, <manifest_path>] }
```

**Host-side reachability.** The bridge binds `--host 0.0.0.0` *inside* its container (required for its published port to be reachable — not a widening); the docker **host-side publish** follows the transport-resolved mechanism, never a naive all-interfaces `ports:["<p>:<p>"]`:

- **rootless `dind-in-cage`** (transport's shared-network-alias branch): reached over the shared user-defined docker network by service alias, with **NO host `ports:` publish** — reachability is network membership, matching the service path.
- **rootful `dind-in-cage`**: via the host-gateway (`host.docker.internal`) as transport resolves for services — no all-interfaces publish.
- **co-resident / localhost**: publish bound to `127.0.0.1` only (`127.0.0.1:<p>:<p>`), never `0.0.0.0` on the host.

**SUT-cage placement.** The bridge runs where `faff env up` runs — the orchestrator host, the SUT-cage side per transport's `dind-in-cage` branch — the same implicit placement services already rely on. This occupant carries no topology *proof*; proving the bridge never enters the evaluator cage is the downstream end-to-end conformance test.

## Output

An inline return, not a gated contract block — the calling `env` occupant folds it into the one `env-handle` it emits:

```
RECORD CodeInterfaceResult:
  ok:            Boolean               # health-check passed; false => env-compose emits status:failed
  endpoint:      URL                   # http://<base_host>:<published port> — the bridge socket
  health_checks: List<HealthCheck>     # [{ name:"bridge", path:"/faff-rpc/health", expected_status:200 }]
  teardown_ref:  String                # the env compose project (shared, so one teardown removes both)
  teardown_cmd:  String                # "faff env down --project <name>"
  provisioner:   String                # "faffter-noon-env-code-interface"
  notes:         List<String>?         # the built module path + the manifest path used
  violations:    List<String>?         # non-empty on !ok; folded into the handle's violations
```

`health_checks[]` items are the SAME `{name, path, expected_status}` shape as the frozen `env-handle.health_checks[]`, and `teardown_ref`/`teardown_cmd` fold into the handle's existing teardown so one `faff env down` removes services and bridge together. Neither ever adds a field to the frozen `env-handle` contract. On `ok:false`, the `env` occupant emits `status:"failed"` with these `violations` and stands up no half-up bridge.

**Anti-pattern:** emitting a gated contract block — the result is consumed inline by `env`, never gated; the sole `env-handle` emitter is the `env` occupant. **Anti-pattern:** a naive all-interfaces host publish — it widens exposure past the transport's "only the evaluator can reach it" segmentation; follow the per-topology publish above.
