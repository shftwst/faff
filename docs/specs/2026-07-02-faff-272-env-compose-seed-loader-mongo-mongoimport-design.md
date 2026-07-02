# SPEC — FAFF-272: Env compose seed-loader — mongo (mongoimport)

> Spec: faffter-dark-nlspec (lite) · 2026-07-02 · beep-boop · confidence: high

## WHY

FAFF-270 shipped the extensible seed machinery (`seed_strategy` per datastore in `DATASTORE_TABLE`, per-strategy dispatch in `faff env seed`, `sql-load` as the worked example). mongo already **provisions** — its `mongo:7` row stands up + health-checks — but carries `seed_strategy: "mount"`, so it comes up **empty with an honest note** rather than seeded. mongo is the cleanest of the deferred loaders: `faff fixtures realise` already writes one JSON **array** per entity, which is exactly `mongoimport --jsonArray`'s input — a near-1:1 map, cleaner than the relational row-shaping `sql-load` does.

## WHAT

Add a `mongoimport` seed strategy and wire the `mongo` datastore to it (one collection per entity).

| Term | Definition |
|---|---|
| `mongoimport` | Seed strategy: feed each realised per-entity JSON array into the provisioned `mongo` service via the `mongoimport` tool, one collection per entity |
| collection scheme | collection name = entity name; database `app` (matches the mysql precedent `MYSQL_DATABASE: "app"`) |

After this slice a `mongo` datastore produces a `seed_target` with `strategy: "mongoimport"` (not `mount`); `faff env seed` imports each entity file. No new CLI surface.

## HOW

Edit points in `plugin/skills/faff/bin/faff`, mirroring the `sql-load` worked example:

- **`DATASTORE_TABLE` (~L7516–7522):** change the `mongo` row `seed_strategy: "mount"` → `"mongoimport"` and drop its `followup: "FAFF-272"`. `composeGen` (~L7835) propagates `strategy: "mongoimport"`; the `mount` note branch no longer fires for mongo. (Add a `MONGO_INITDB_DATABASE: "app"`-style env only if needed — `mongoimport --db app` creates the DB lazily, so no compose-env change is required.)
- **New loader `envMongoImport(root, project, target, datasetDir, composeFile)`** beside `envSqlLoad` (~L7931). For each `<entity>.json` in `datasetDir`, run `spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T", "mongo", "mongoimport", "--db", "app", "--collection", <entity>, "--jsonArray", "--quiet"], { input: <file contents> })` (feed the JSON array on stdin via `--file /dev/stdin` or pipe; `mongoimport` reads stdin when no `--file`). Skip empty arrays. Return true iff every non-empty import exited 0. Empty dataset dir → return `true` (no-op), matching `envSqlLoad`.
- **Seed dispatch (~L8061–8069):** add `else if (t.strategy === "mongoimport") { if (!envMongoImport(...)) { errored = true; … } }`.
- **`needsDocker` guard (~L8058):** extend to include `mongoimport`.
- **`env --selftest`:** add a mongo case asserting the `mongo` seed_target has `strategy: "mongoimport"` and emits no unseeded note (mirrors the existing redis/postgres selftest checks ~L8114).
- **`test/env.test.mjs`:** add a compose-gen unit test (`mongo → mongoimport strategy, no note`) and a docker-gated integration test mirroring the postgres one at ~L155: compose-gen a mongo-only profile, `env up`, `env seed --manifest`, then assert the collection is populated via `docker compose … exec -T mongo mongosh --quiet --eval 'db.getSiblingDB("app").<entity>.countDocuments()'` > 0, `env down` in `finally`, skips without docker.

### Anti-patterns
- Do **not** create a literal `SEED_STRATEGIES` table; extend the `seed_strategy` field in `DATASTORE_TABLE` and the `faff env seed` dispatch, exactly as `sql-load` does.
- Do **not** reshape the entity JSON — `mongoimport --jsonArray` consumes the realised file as-is; row-shaping (as `sql-load` does relationally) is unnecessary and would fight the native map.

## Scenarios

```
Given an infra-profile with datastores [mongo]
When `faff env compose-gen` runs
Then the ProvisionPlan seed_target for mongo has strategy "mongoimport" (not "mount")
     and plan.notes contains no "mongo … unseeded" entry
```

```
Given docker available, a mongo-only profile, and a fixtures manifest with one entity (2 rows)  [docker-gated]
When `faff env up` then `faff env seed --manifest` run
Then db.app.<entity>.countDocuments() === 2 inside the mongo service, and `env down` tears the stack down;
     with docker absent the test SKIPS (not fails)
```

### DONE
- [ ] `DATASTORE_TABLE.mongo.seed_strategy === "mongoimport"`, `followup` removed.
- [ ] `composeGen` emits a mongo `seed_target` with `strategy: "mongoimport"` and no unseeded note (asserted in `env --selftest`).
- [ ] `envMongoImport` imports one collection per entity via `mongoimport --db app --jsonArray`, returns non-zero-safe boolean, no-ops on empty dataset.
- [ ] `faff env seed` dispatches `mongoimport`; `needsDocker` guard includes it.
- [ ] Docker-gated integration test proves populated collection (`countDocuments() === 2`) and tears down; skips cleanly without docker.
- [ ] `node --test` green; no regression to the sql-load paths.

confidence: high

## Open Questions (Punts)
- none. Database name `app` follows the existing mysql precedent; the entity-array→collection map is native to `mongoimport`, so no modeling choice remains. (One build-time check: confirm `mongoimport` ships in the `mongo:7` image — it does in the official image; the integration test proves it.)
