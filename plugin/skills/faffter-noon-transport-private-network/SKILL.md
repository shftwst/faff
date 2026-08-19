---
name: faffter-noon-transport-private-network
description: "Default `transport` slot occupant — the private-network reachability resolver. Given the provision context, resolves the base host the evaluator uses to reach the system under build over a private network where network-layer segmentation alone satisfies \"only the evaluator can reach it\". Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
---

# faffter-noon-transport-private-network

The default occupant of the **`transport`** slot, composed under `env`: given the provision context, it resolves the base host the evaluator uses to reach the system under build across the lane boundary, for the **private-network reachability class** — the system sits on a private network, the evaluator is a member of it, and network-layer segmentation alone satisfies "only the evaluator can reach it", with no application-layer auth.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

One reachability class, one occupant, the substrate branch inside it: local docker-in-docker (this slice's buildable instance) and Fly 6PN (a follow-on, documented so the branch accommodates it) are two instances of the same class on different substrates. It never crosses a trust boundary on its own and carries no gated `faff-contract` block — the env occupant that calls it consumes the returned base host inline, in the same turn, exactly as the evaluator consumes the `env` slot's handle.

The deterministic trigger protects the zero-config guarantee: `base_host` resolves to `"localhost"` iff `provision_context.evaluator_topology` is `"co-resident"` or absent — a switch on one enum field, never an inference. Only `"dind-in-cage"` (this slice) or `"cross-machine"` (the Fly 6PN follow-on) re-bases.

## Inputs

**`provision_context`** — what the calling `env` occupant knows at provision time:

- `evaluator_topology`: `"co-resident"` | `"dind-in-cage"` | `"cross-machine"` — the deterministic trigger.
- `substrate`: `"docker"` | `"fly"` | … — from config and/or detection; selects the branch inside this occupant.

## How it resolves

```
PROCEDURE resolve(provision_context):
  IF provision_context.evaluator_topology is "co-resident" OR absent:
     RETURN { base_host: "localhost", credentials: none, teardown: none }   # the byte-identical path

  IF provision_context.evaluator_topology == "dind-in-cage":                # local-dind — this slice
     # The system under build runs on the orchestrator host (`faff env up`); the evaluator runs in a
     # docker-in-docker container inside the cage. TWO substrate mechanisms, NOT interchangeable:
     #   - host-gateway (host.docker.internal / bridge 172.17.0.1) — routes only under a ROOTFUL engine
     #   - a shared user-defined docker network (both sides join; evaluator reaches the SUT by alias) —
     #     routes under BOTH rootful and rootless
     IF the docker engine is rootless (detected from `docker info`: the rootless security option or a
        rootless context):
        base_host = the SUT's alias on a shared user-defined docker network this occupant attaches
                    both sides to
        teardown  = { ref, cmd } removing that user-defined network
        # host-gateway does NOT route under rootless: rootlesskit publishes host ports inside its own
        # network namespace, so the bridge gateway is unreachable from a sibling container.
     ELSE:                                                                  # rootful engine
        base_host = the docker bridge host-gateway address reachable from inside the evaluator
                    container (host.docker.internal, mapped via --add-host host-gateway on engines
                    that need it)
        teardown  = none                                # host-gateway is ambient; nothing created
     credentials = none                                  # network-layer segmentation only
     RETURN { base_host, credentials, teardown }

  IF provision_context.evaluator_topology == "cross-machine":               # Fly 6PN — a follow-on, not built here
     base_host = the system machine's private 6PN IPv6 address (static, base-known-ahead)
     credentials = none
     teardown = { ref, cmd } removing any transient WireGuard peer this occupant created, else none
     RETURN { base_host, credentials, teardown }
```

**Downstream note.** The future automated reachability test matrix that exercises this branch end-to-end must pin the shared-network mechanism under rootless — a naive host-gateway assertion would fail the `env-rootless` CI job on a rootless engine, exactly the failure this branch now avoids at resolve time.

Both `dind-in-cage` and `cross-machine` are **base-known-ahead**: the base host is knowable before `env up`, so no second resolution point is needed. A base-known-after substrate (a dynamically published host/port) is out of scope for this occupant today.

## Output

An inline return, not a gated contract block — the calling `env` occupant consumes it mid-flow:

```
{ base_host: string,          # a bare hostname or IP literal; MUST pass envValidateBaseHost before use
  credentials?: object,       # optional; absent for the private-network class
  teardown?: { ref, cmd } }   # optional; present only if this occupant created transient networking
                               #   or credentials that must be removed
```

`base_host` is never trusted blind: the caller threads it through the existing `--base-host` seam, and `composeGen` validates it via `envValidateBaseHost` (the positive allowlist — a bare hostname/IP or bracketed IPv6, nothing else) before any interpolation into an endpoint string. A malformed value fails `composeGen` loud, emitting no compose file — this occupant's swappability introduces no command-injection surface. `credentials`, when present, ride the env-handle's existing opaque `credentials` object; `teardown`, when present, folds into the handle's existing `teardown_ref`/`teardown_cmd` so one teardown removes the env and any transient transport artifact together. Neither ever adds a field to the frozen env-handle contract.
