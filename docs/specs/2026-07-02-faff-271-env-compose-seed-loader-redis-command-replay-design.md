# SPEC — FAFF-271: Env compose seed-loader — redis (command-replay)

> Spec: faffter-dark-nlspec (lite) · 2026-07-02 · beep-boop · confidence: medium

## WHY

FAFF-270 shipped the extensible seed machinery: a `seed_strategy` per datastore in `DATASTORE_TABLE`, a per-strategy dispatch in `faff env seed`, and `sql-load` as the worked example (postgres/mysql/sqlite). redis already **provisions** — its `redis:7-alpine` row stands the service up and health-checks it — but carries `seed_strategy: "mount"`, so it comes up **empty with an honest "unseeded (FAFF-271)" note** rather than seeded. An evaluator (FAFF-34) that needs real redis data can't trust that env. This slice gives redis a native loader so it seeds like the relational three.

## WHAT

Add a `command-replay` seed strategy and wire the `redis` datastore to it.

| Term | Definition |
|---|---|
| `command-replay` | Seed strategy: shape the realised per-entity dataset into redis write commands and replay them into the provisioned `redis` service via `redis-cli` |
| key scheme | one redis hash per entity row, key `<entity>:<id-or-index>`, fields = the row's columns (`HSET`) |

After this slice a `redis` datastore in the infra profile produces a `seed_target` with `strategy: "command-replay"` (not `mount`), and `faff env seed` replays commands into it. No new CLI surface — `faff env seed` gains one strategy branch.

## HOW

Edit points in `plugin/skills/faff/bin/faff`, mirroring the `sql-load` worked example:

- **`DATASTORE_TABLE` (~L7516–7522):** change the `redis` row `seed_strategy: "mount"` → `"command-replay"` and drop its `followup: "FAFF-271"` field. `composeGen` (~L7835) then propagates `strategy: "command-replay"` into the `seed_target` automatically; the `mount` note branch (~L7836) no longer fires for redis.
- **New loader `envRedisLoad(root, project, target, datasetDir, composeFile)`** beside `envSqlLoad` (~L7931), modelled on it. Read each `<entity>.json` from `datasetDir` (per-entity JSON array, same source `envBuildSql` ~L7912 reads). For each row emit `HSET <entity>:<id-or-index> <field> <value> …` (id = `row.id` if present, else the array index). Deliver by piping the newline-joined commands to `spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T", "redis", "redis-cli", "--pipe"], { input })`. Return `r.status === 0`. Empty dataset → return `true` (no-op), same as `envSqlLoad`.
- **Seed dispatch (~L8061–8069):** add `else if (t.strategy === "command-replay") { if (!envRedisLoad(...)) { errored = true; … } }` alongside the `sql-load` branch.
- **`needsDocker` guard (~L8058):** extend so `command-replay` targets also require docker: `t.strategy === "command-replay" || (t.strategy === "sql-load" && t.kind !== "sqlite")`.
- **`envSelftest` (~L8114–8118):** the three `redis:` checks currently assert `strategy: "mount"` + an `FAFF-271` note. Update to assert `strategy === "command-replay"` and that no unseeded-redis note is emitted.
- **`test/env.test.mjs`:** update the `redis provisions … mount-seeds with an unseeded note` unit test (~L104) to assert `command-replay` + no note. Add a docker-gated integration test mirroring the postgres one at ~L155 (`{ skip: skipIntegration }`, `assert.ok(DOCKER, …)`): compose-gen a redis-only profile, `env up`, `env seed --manifest`, then assert data landed via `docker compose … exec -T redis redis-cli DBSIZE` (or `HGETALL` a known key) > 0, and `env down` in `finally`.

### Anti-patterns
- Do **not** invent a new top-level table literally named `SEED_STRATEGIES`; the strategy set is the union of the `seed_strategy` values in `DATASTORE_TABLE` and the dispatch branches in `faff env seed`. Extend those two, matching `sql-load`.
- Do **not** leave the `mount` branch reachable for redis — after this slice no built-in datastore uses `mount`; keep the branch only as the documented fallback for future kinds.

## Scenarios

```
Given an infra-profile with datastores [redis]
When `faff env compose-gen` runs
Then the ProvisionPlan seed_target for redis has strategy "command-replay" (not "mount")
     and plan.notes contains no "redis … unseeded" entry
```

```
Given docker is available, a redis-only profile, and a fixtures manifest with one entity (2 rows)  [docker-gated]
When `faff env up` then `faff env seed --manifest` run
Then `redis-cli DBSIZE` inside the redis service reports > 0 keys, and `env down` tears the stack down;
     with docker absent the test SKIPS (not fails), matching FAFF-270's skip-gate
```

### DONE
- [ ] `DATASTORE_TABLE.redis.seed_strategy === "command-replay"`, `followup` removed.
- [ ] `composeGen` emits a redis `seed_target` with `strategy: "command-replay"` and no unseeded note (asserted in `env --selftest`).
- [ ] `envRedisLoad` replays `HSET`-per-row commands into the `redis` service via `redis-cli --pipe`, returns non-zero-safe boolean, no-ops on empty dataset.
- [ ] `faff env seed` dispatches `command-replay` and reports a per-kind error on failure; `needsDocker` guard includes `command-replay`.
- [ ] Docker-gated integration test proves seeded redis (`DBSIZE > 0`) and tears down; skips cleanly without docker.
- [ ] `node --test` green (updated redis unit test + selftest); no regression to the postgres/mysql/sqlite paths.

confidence: medium

## Open Questions (Punts)
- **Key/value shape.** **Chosen:** one hash per row (`HSET <entity>:<id-or-index>`). A real modeling choice — redis has no single native shape (string-JSON, hash, sorted-set all defensible). Flagged for review; the born-verifiable test only asserts non-empty keyspace, so the exact scheme can be adjusted without breaking the DoD.
