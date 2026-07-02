# SPEC — FAFF-273: Env compose provisioning + seed-loader — S3-compatible object store (MinIO)

> Spec: faffter-dark-nlspec (lite) · 2026-07-02 · beep-boop · confidence: medium

## WHY

FAFF-270 shipped relational provisioning + seeding and the two extension points: `DATASTORE_TABLE` (provision) and the per-strategy dispatch in `faff env seed` (seed). An S3-compatible object store is a **different shape** from a row store — it needs BOTH a new provisioning row AND a new seed strategy, unlike redis/mongo (FAFF-271/272) which only add a loader to an already-provisioned service. Until this lands an `s3`/`minio` kind hits FAFF-270's fail-loud `unprovisionable[]` escalate — correct, but it blocks any env whose profile lists an object store.

## WHAT

Add object-store support: a `minio` `DATASTORE_TABLE` entry (provision) + an `object-upload` seed strategy (seed) + endpoint/creds in the handle.

| Term | Definition |
|---|---|
| `minio` datastore kind | local S3-compatible store, image `minio/minio`, API port 9000, health probe `/minio/health/ready` |
| `object-upload` | Seed strategy: turn the realised per-entity dataset into objects and PUT them into buckets, **bucket-per-entity** |
| object scheme | bucket = entity name; one object per row, key `<id-or-index>.json`, body = the row JSON |

After this slice a `minio` (or aliased `s3`) datastore provisions a healthy MinIO service, seeds one bucket per entity, and the env-handle carries the endpoint + dev/test credentials (runtime-consumed only, never persisted to tracker/PR — FAFF-30 §7).

## HOW

Edit points in `plugin/skills/faff/bin/faff`:

- **`DATASTORE_TABLE` (~L7516):** add a `minio` row: `{ image: "minio/minio", port: 9000, probe: "curl -f http://localhost:9000/minio/health/ready", seed_strategy: "object-upload", file_based: false, env: { MINIO_ROOT_USER: "faffdev", MINIO_ROOT_PASSWORD: "faffdevsecret" }, command: "server /data --console-address :9001" }`.
- **`renderCompose` (~L7759) — NEW capability:** MinIO refuses to start without a `command:` (`server /data`). `renderCompose` today emits image/ports/env/healthcheck/depends_on but **no `command`**. Add: if `s.command` is set, emit `    command: <value>`. Thread `command` through `composeGen`'s datastore-service push (~L7830) from `spec.command`. This is the one genuinely-new bit of machinery vs FAFF-271/272 (which reuse the seed dispatch only).
- **New loader `envObjectUpload(root, project, target, datasetDir, composeFile)`** beside `envSqlLoad` (~L7931). For each `<entity>.json`: ensure bucket `<entity>` exists, then PUT one object per row. Transport via a throwaway `minio/mc` sidecar on the compose network: `docker run --rm --network <project>_default -e MC_HOST_local=http://faffdev:faffdevsecret@minio:9000 minio/mc …` (`mc mb --ignore-existing local/<entity>` then `mc pipe local/<entity>/<key>` per row, body on stdin). Return true iff every put exited 0; empty dataset → no-op true. (The `minio/minio` server image has no `mc`; the sidecar is why an object store is its own slice.)
- **Seed dispatch (~L8061) + `needsDocker` guard (~L8058):** add an `object-upload` branch and include it in the docker-required set.
- **Endpoint + credentials:** `composeGen` already builds `endpoints[minio] = tcp://localhost:9000`; for an S3 store the handle wants an `http://` endpoint + creds. The producer (`faffter-noon-env-compose`) fills the env-handle's `credentials` block from the known dev/test creds above (in-block, runtime-only). Confirm `env-handle.schema.json` `credentials` carries what an S3 client needs (access key / secret / endpoint); if a field is genuinely missing that is a separate contract issue (out of scope), noted as a Punt.
- **`env --selftest` + `test/env.test.mjs`:** add compose-gen unit tests — `minio → service present, object-upload seed_target, command: server /data emitted in YAML, empty unprovisionable[]`. Add a docker-gated integration test mirroring the postgres one (~L155): compose-gen a minio-only profile, `env up` (health-wait on `/minio/health/ready`), `env seed --manifest`, then assert the bucket has objects via an `mc ls` sidecar (count > 0), `env down` in `finally`, skips without docker.

### Anti-patterns
- Do **not** embed the MinIO root credentials anywhere the run persists them (tracker comment, PR body, committed handle) — they live in `DATASTORE_TABLE`/handle at runtime only (FAFF-30 §7). Dev/test throwaway creds, never real.
- Do **not** try to seed via `mc` inside the `minio/minio` container — it has no `mc`; use the `minio/mc` sidecar on the compose network.

## Scenarios

```
Given an infra-profile with datastores [minio]
When `faff env compose-gen` runs
Then the ProvisionPlan has a minio service (image minio/minio, port 9000) with an object-upload seed_target,
     the generated compose emits `command: server /data …`, and unprovisionable[] is empty
```

```
Given docker available, a minio-only profile, and a fixtures manifest with one entity (2 rows)  [docker-gated]
When `faff env up` (health-waits /minio/health/ready) then `faff env seed --manifest` run
Then bucket "<entity>" exists and contains 2 objects (via an `mc ls` sidecar), and `env down` tears down;
     with docker absent the test SKIPS (not fails)
```

### DONE
- [ ] `DATASTORE_TABLE.minio` row exists (image/port/probe/`object-upload`/command/creds-env); an `s3`/`minio` kind no longer hits `unprovisionable[]`.
- [ ] `renderCompose` emits an optional `command:` line, threaded from `spec.command`; MinIO boots and reaches healthy on `/minio/health/ready`.
- [ ] `envObjectUpload` creates bucket-per-entity and uploads one object per row via a `minio/mc` sidecar; returns non-zero-safe boolean, no-ops on empty dataset.
- [ ] `faff env seed` dispatches `object-upload`; `needsDocker` guard includes it.
- [ ] The env-handle carries the S3 endpoint + dev/test creds (runtime-only, never persisted); handle still validates against `env-handle.schema.json`.
- [ ] Docker-gated integration test proves a seeded bucket (objects > 0) and tears down; skips cleanly without docker.
- [ ] `env --selftest` + `node --test` green; relational + redis/mongo paths unregressed.

confidence: medium

## Open Questions (Punts)
- **Health-probe tool in the image.** **Chosen default:** `curl -f …/minio/health/ready`. Newer `minio/minio` images may not ship `curl`. Validate at build: if absent, pin a tag that includes it, or health-wait via an `mc ready local` sidecar / a `depends_on` on the mc bucket-create. Flagged for review.
- **mc transport shape.** **Chosen:** throwaway `minio/mc` sidecar on `<project>_default`. Alternative: `aws --endpoint-url s3` CLI. Sidecar chosen for zero host deps; reviewable.
- **`env-handle.credentials` sufficiency.** Assumes the contract's `credentials` block can carry access-key/secret/endpoint for an S3 client. Validate against `env-handle.schema.json` at build; a genuine gap is a separate contract-evolution issue (out of scope here).
