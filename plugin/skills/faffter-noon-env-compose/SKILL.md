---
name: faffter-noon-env-compose
description: "Default `env` slot occupant — the environment PROVISIONER. Reads the architecture proposal + the team's infra profile and stands up a representative, health-checked local stand-in via docker-compose, seeds it with a synthetic dataset, and emits a `faff-contract:env-handle` block the evaluator points at and tears down. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-env-compose

The default occupant of the **`env`** slot — the provision box of faff's build-and-judge pipeline. Given an architecture proposal plus the team's acquired infra profile, it stands up a running, health-checked **stand-in** for the system under build, seeds it with a deterministic synthetic dataset, and emits one `faff-contract:env-handle` describing how to reach it and how to tear it down. The handle is the interface the evaluator depends on; the provisioning mechanism — docker-compose here, a cloud preview or ephemeral container in a swapped-in occupant — sits behind it.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

One pass turns the proposal + profile into one running env and one handle block. It **provisions, never evaluates**: it brings the env up, confirms it is healthy, seeds it, emits the handle, and stops. It runs no judgement over the build — the holdout evaluator is the downstream consumer, and the two meet only through the handle artifact. The handle is a **contract**, not an implementation: the consumer never learns how the env was stood up, so any producer conforms by emitting the same block.

The contract (`faff contract env-handle`) validates the handle's **shape** + the gate rule (exit 0 only on a conformant `status: ready` handle). This producer owns the **provisioning strategy** — how the env is composed and brought up. Do not re-validate shape here; emit a conformant block and let the consumer pipe it.

## Inputs

- The architecture proposal for the work under build (read its `recommendation` + `chosen_architecture`).
- The team's infra profile, read via `faff profile show --json` (the shipped read path). **Never** call `faff profile mine` — acquisition is the `profile` slot's job. On `faff profile show` exit 3 (no profile), record an explicit "no infra profile" assumption and derive services from the proposal alone.

## How it provisions

The procedure, in order — every step is a gate on declaring the env ready:

- **Honour the recommendation.** On `recommendation` ≠ `build` (a `buy`/`hybrid` design), provision nothing: surface the proposal for a human and emit no handle. Procurement is a separate, out-of-scope concern.
- **Check docker + compose first.** If docker / docker-compose is unavailable, emit a `status: failed` handle with a `violations` entry and stop — a clean failure, never a crash.
- **Derive the services.** Map the profile's runtimes + datastores (and the proposal) to compose services; reuse a committed Dockerfile when the deploy targets carry a container image.
- **Locate or generate the compose file**, then bring it up detached under a project name; that project name is the `teardown_ref`.
- **Wait for health within the SLA.** Poll each service's health check until all pass. If the deadline passes, tear the env down and emit a `status: failed` handle with the failed checks + a `violations` entry — **never leave a half-up env**.
- **Seed before ready.** Realise a deterministic synthetic dataset (`faff fixtures realise`) and load it into the datastores. A seeding failure is a `status: failed` handle with `violations` (env torn down). No `status: ready` is ever emitted against an unseeded env.
- **Emit the ready handle** only once the env is up, healthy, and seeded: `status: ready` with `endpoint`, a non-empty `health_checks[]`, the `teardown_ref` + a human-runnable `teardown_cmd`, dev/test `credentials` in-block (synthetic, ephemeral, local), `provisioned_at`, and `provisioner`. The env is **ephemeral by default** — one env per evaluation run, torn down on completion via the `teardown_ref`.

Dev/test credentials in the handle are synthetic and local-only; they are runtime-consumed and must not be persisted to the tracker or PR logs.

## Output (the contract artifact)

Emit exactly one fenced block as the producer's output — the consumer locates it, `JSON.parse`s it, and pipes it to `faff contract env-handle` (the sole source of contract data):

```faff-contract:env-handle
{ "status": "ready",
  "endpoint": "http://localhost:8080",
  "endpoints": { "api": "http://localhost:8080", "db": "postgres://localhost:5432/app" },
  "health_checks": [ { "name": "api", "path": "/healthz", "expected_status": 200 } ],
  "readiness": { "all_checks_passing": true, "last_check_time": "2026-06-28T00:00:00Z" },
  "teardown_ref": "faff-env-7f3a",
  "teardown_cmd": "docker-compose -p faff-env-7f3a down",
  "credentials": { "db_user": "dev", "db_password": "dev" },
  "provisioned_at": "2026-06-28T00:00:00Z",
  "provisioner": "faffter-noon-env-compose",
  "violations": [] }
```

Then close with a `confidence:` line (`high` / `medium` / `low`) — an advisory self-rating of the provisioning, never a quality verdict on the build.

A `ready` handle must carry a non-empty `endpoint`, a non-empty `health_checks[]`, and a `teardown_ref`; a `provisioning`/`failed`/`terminated` handle is a well-formed non-ready state the contract reports at exit 1 (not gate-passing). A swapped-in producer (a cloud-preview or persistent-staging strategy) conforms by emitting the same block.
