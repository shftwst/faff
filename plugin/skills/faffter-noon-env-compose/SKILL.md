---
name: faffter-noon-env-compose
description: "Default `env` slot occupant — the environment PROVISIONER. Reads the architecture proposal + the team's infra profile and stands up a representative, health-checked local stand-in via docker-compose, seeds it with a synthetic dataset, and emits a `faff-contract:env-handle` block the evaluator points at and tears down. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
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

The procedure calls the deterministic **`faff env`** verbs — compose generation is a pure, tested CLI, the live steps are thin docker orchestration — rather than narrating the mechanics. **The engine context is ambient:** the verbs inherit `DOCKER_HOST` untouched, so pointing them at a bounded nested engine (rootless dind / podman) is an environment precondition, not a producer step; storage-driver / cgroup quirks belong to the cage image. An unreachable engine fails loud naming the effective context — emit the `status: failed` handle, never retarget the socket. Every step is a gate on declaring the env ready:

- **Honour the recommendation.** On `recommendation` ≠ `build` (a `buy`/`hybrid` design), provision nothing: surface the proposal for a human and emit no handle. Procurement is a separate, out-of-scope concern.
- **Generate the plan** — `faff env compose-gen --profile <profile>` writes the compose file and prints a deterministic **ProvisionPlan** (`services`, `endpoint`, `endpoints`, `health_checks[]`, `seed_targets[]`, `unprovisionable[]`). This is the single source for the handle's fields — copy them from the plan, never re-derive in prose. When the repo ships its own compose declaring a single buildable app, the CLI reconciles the generated app service against it (port, env, build context/dockerfile, healthcheck — the real contract wins over the coarse profile) and the datastore tier too (the datastore's auth env is lifted so the app's wired role/db exist, and the app is ordered behind it with a `service_healthy` gate); with no repo compose the synthesis is unchanged.
- **Fail loud on an unprovisionable datastore.** If `plan.unprovisionable[]` is non-empty, emit a `status: failed` handle with a `violations` entry naming the kind(s) and stop — **never** a `ready` handle over an env missing a store the system needs. (A human extends the CLI's `DATASTORE_TABLE`; the producer never guesses an image.)
- **Bring it up + health-wait** — `faff env up --plan <plan>` runs `docker compose up -d` and polls each service's engine-native health check to the SLA (default 60s, 2s poll). On a non-zero exit (docker unavailable, or health never passed) run `faff env down` and emit a `status: failed` handle with the failed checks + a `violations` entry — **never leave a half-up env**.
- **Seed before ready** — `faff env seed --plan <plan> --manifest <manifest>` realises the deterministic dataset (`faff fixtures realise`) and loads it per `seed_targets`: `sql-load` for postgres/mysql/sqlite, `mount` (provisioned-but-unseeded, carried as a handle `note`) for redis/mongo until their loaders land. A non-zero exit is a `status: failed` handle (env torn down via `faff env down`). No `status: ready` is ever emitted against a failed seed.
- **Emit the ready handle** only once the env is up, healthy, and seeded: `status: ready` with the plan's `endpoint` / `endpoints` / `health_checks[]`, the plan's `project_name` as `teardown_ref` + `teardown_cmd: "faff env down --project <name>"`, dev/test `credentials` in-block, `provisioned_at`, `provisioner`, and any plan `notes` (e.g. an unseeded `mount` store) carried through. The env is **ephemeral by default** — one env per evaluation run, torn down on completion via `faff env down`.

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
  "teardown_cmd": "faff env down --project faff-env-7f3a",
  "credentials": { "db_user": "dev", "db_password": "dev" },
  "provisioned_at": "2026-06-28T00:00:00Z",
  "provisioner": "faffter-noon-env-compose",
  "violations": [] }
```

Then close with a `confidence:` line (`high` / `medium` / `low`) — an advisory self-rating of the provisioning, never a quality verdict on the build.

A `ready` handle must carry a non-empty `endpoint`, a non-empty `health_checks[]`, and a `teardown_ref`; a `provisioning`/`failed`/`terminated` handle is a well-formed non-ready state the contract reports at exit 1 (not gate-passing). A swapped-in producer (a cloud-preview or persistent-staging strategy) conforms by emitting the same block.
