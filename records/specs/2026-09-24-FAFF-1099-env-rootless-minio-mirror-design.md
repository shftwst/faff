# Spec: env-rootless CI — move MinIO images off the quay.io 401 wall to a working public mirror (FAFF-1099)

> Spec: faffter-dark-nlspec · 2026-09-24 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1099.

This is a buildable spec for the build agent and human reviewers. It settles how to restore the `env-rootless` MinIO integration test after quay.io began returning `401 UNAUTHORIZED` for `quay.io/minio/minio` and `quay.io/minio/mc` on every tag. Scope is fixed by the operator: **swap to a working public mirror only** — no skip, no reachability gate.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff env up` provisions each datastore from a single source-of-truth row in `DATASTORE_TABLE` (`plugin/skills/faff/bin/lib/env.js:45`). MinIO is two images, not one: a long-lived **server** (`quay.io/minio/minio`, the compose service) and a throwaway **`mc` client sidecar** (`quay.io/minio/mc`, `docker run --rm` at seed time and in the test's own `mc ls` verification). Both live at quay.io; both now 401. Restoring the env means repointing **both** images, at every call site, to a mirror that pulls anonymously — and proving the mirror is a true drop-in by standing the env up, because the server's health probe runs a shell command *inside* the container.

**Problem statement.** quay.io now permanently gates `quay.io/minio/minio` and `quay.io/minio/mc` behind auth (401 on every tag, confirmed by direct registry probe — even a valid anonymous pull token is denied), so `docker compose up -d` fails to pull the uncached image, `faff env up` exits 1, and the `env-rootless` MinIO integration test reds. This reds PRs that touch nothing near env provisioning. This change repoints both MinIO images at a working public mirror so the env stands up again and the test stays exercised.

**Design principles.**

- **Fail loud, do not skip.** An unpullable MinIO image is a real "this env is broken" signal, because faff claims MinIO is a usable provisioned env for the holdout lane. The fix restores a *working* mirror; it never adds a reachability gate or a skip that would hide a broken env. The existing `[docker-gated]` skip (daemon absence, `test/env.test.mjs:213-238`) is a different concern and stays untouched.
- **Drop-in is verified, not assumed.** The MinIO server's readiness probe (`curl -f http://localhost:9000/minio/health/ready`) is emitted verbatim as an in-container `CMD-SHELL` healthcheck (`env.js:325-328`). A mirror image that omits `curl` boots but never reports healthy, so `env up` times out. Whether the chosen mirror is a true drop-in can only be settled by standing the env up.
- **Reproducible pulls.** Pin by digest, not by a moving tag, so a re-pull months later fetches the same bits and the env is not re-broken by an upstream retag.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/env.js:45` (`DATASTORE_TABLE.minio`) | JS | Source-of-truth row: image, probe, env, `command:` |
| `plugin/skills/faff/bin/lib/env.js:618` (`envObjectUpload`) | JS | Seed-time `mc` client sidecar (`mb`, `pipe`) |
| `plugin/skills/faff/bin/lib/env.js:255-328` (`renderCompose`) | JS | Emits the datastore probe verbatim as an in-container healthcheck |
| `plugin/skills/faff/bin/lib/env.js:820` (`envSelftest`) | JS | Selftest asserts the MinIO image string |
| `test/env.test.mjs:134` / `:323` | JS | Compose-gen unit test + docker-gated integration test |
| `docs/reference/cage-engine-acceptance.md:44` | Markdown | Prose naming the MinIO image |

**Scope statement.** This sits entirely inside the `env` provisioner's MinIO datastore definition and its two tests plus one doc line; it changes which registry the MinIO images come from, nothing about how envs are provisioned, seeded, or judged.

## 2. OUT OF SCOPE

- **Authenticated pull (`docker login` + repo secret).** Excluded — the operator chose the mirror fix, and a login step is a larger CI-and-secrets change. Why: a registry swap is inherently fragile against vendor auth-wall churn (this same set of sites moved Docker Hub → quay.io only ~12 days earlier, commit `e5a3a68f` / FAFF-1031, when Docker Hub went auth-only; now quay.io did the same). A durable fix is an authenticated pull, but it is a separate ticket. Extension point: a `docker login` step in the `env-rootless` CI job plus a credentials-aware pull in `env.js` around the `docker compose up` call (`env.js:725`).
- **A skip / reachability gate for MinIO.** Excluded by operator decision. Why: an unpullable image must fail loud as a broken-env signal. Extension point: none intended; the `[docker-gated]` daemon-absence gate already exists for the legitimate "no docker" case and is not this.
- **The other datastores (postgres/mongo/redis/mysql).** Excluded — they pull from Docker Hub and pass. Why: unaffected by the quay.io gate. Extension point: their `DATASTORE_TABLE` rows, if a future auth wall hits Docker Hub.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Server image | The MinIO S3 server run as the compose `minio` service |
| Client (`mc`) image | The throwaway MinIO client run as a `docker run --rm` sidecar for seeding (`mb`/`pipe`) and test verification (`ls`) |
| In-container probe | The healthcheck `test` command docker runs *inside* the container; its binary (e.g. `curl`) must exist in that image |
| Digest pin | An image reference of the form `repo/name@sha256:<hex>`, immutable regardless of tag movement |

**The two image references (both must move together):**

```
CONSTANT MINIO_SERVER_IMAGE   # replaces "quay.io/minio/minio"
CONSTANT MINIO_CLIENT_IMAGE   # replaces "quay.io/minio/mc"
  form: "<mirror-repo>@sha256:<digest>"   # digest-pinned, resolved at build
```

**The MinIO row after the change** (`env.js:45`), with only `image` (and possibly `probe`) touched:

```
RECORD DATASTORE_TABLE.minio:
  image:         MINIO_SERVER_IMAGE          # CHANGED: mirror, digest-pinned
  port:          9000                        # unchanged
  probe:         "<in-container readiness>"   # unchanged IF mirror ships curl; else adapted (see HOW)
  seed_strategy: "object-upload"             # unchanged
  file_based:    false                       # unchanged
  env:           { MINIO_ROOT_USER: "faffdev", MINIO_ROOT_PASSWORD: "faffdevsecret" }   # unchanged IF drop-in
  command:       "server /data --console-address :9001"                                  # unchanged IF drop-in
```

**Design decisions.**

**Which mirror for the server and client images?**

| Option | Server entrypoint / env | `mc` client | Risk |
|---|---|---|---|
| `chainguard/minio` + `chainguard/minio-client` (Docker Hub) | Tracks upstream: same `server /data` entrypoint and `MINIO_ROOT_USER/PASSWORD` — cleanest drop-in, `command:`/`env:` likely carry over | wraps `mc`, should accept `mb`/`pipe`/`ls` | Minimal image may omit in-container `curl`; free tier keeps only a moving `:latest` (pin by digest) |
| `bitnamilegacy/minio` + `bitnamilegacy/minio-client` (Docker Hub) | **Different** entrypoint (`/opt/bitnami/...`), does not take `server /data`; different config conventions → `command:`/`env:` need rework | wraps `mc` differently | Frozen 2025 archive (won't re-gate, won't update); larger reshaping of the row |

**Chosen:** `chainguard/minio` + `chainguard/minio-client`, digest-pinned, **subject to build verification** (stand the env up). It is the closest drop-in — same entrypoint and root-cred env — so the row's `command:` and `env:` carry over unchanged in the expected case. `bitnamilegacy/*` is the **named fallback** if Chainguard cannot come up healthy, accepting the `command:`/`env:` rework it requires. Dead ends already ruled out: Docker Hub `minio/minio` and `minio/mc` (404/401), `ghcr.io/minio/minio` (403), `public.ecr.aws` (404), quay.io (all 401).

**Pin by digest or tag?** **Chosen:** pin by **digest** (`@sha256:...`), not `:latest`. Chainguard's free public tier keeps only a moving `:latest`, so a tag pin is non-reproducible and a retag could silently re-break the env; a digest is immutable. The build resolves the digest at implementation time (`docker buildx imagetools inspect <repo>:latest` or a `docker pull` then read `RepoDigests`) and writes the resolved `@sha256:...` literal into the constants.

**Does the chosen mirror provide an in-container HTTP readiness probe?** **Assumes:** the Chainguard MinIO server image provides an in-container tool that can hit `http://localhost:9000/minio/health/ready` and exit non-zero on failure (today the probe uses `curl -f`). This cannot be confirmed without standing the env up, and Chainguard images are deliberately minimal. Validation instruction (run at build, before trusting the row): stand the env up (`faff env up`) and watch the `minio` service reach `healthy` within SLA. If it does, keep the probe verbatim. If it times out because the binary is absent, resolve down the probe ladder in HOW without a human. Escalate to a human only if the whole ladder and the fallback mirror all fail.

## 4. HOW — Behavior

**Approach.** Introduce two constants (`MINIO_SERVER_IMAGE`, `MINIO_CLIENT_IMAGE`) holding the digest-pinned mirror references, and repoint every literal at them. Six code/doc sites plus the two constants move together; no other provisioning logic changes.

```
PROCEDURE restore_minio_mirror:
  1. Resolve digests (build machine, docker available):
     a. docker pull chainguard/minio:latest         -> read RepoDigests -> SERVER_DIGEST
     b. docker pull chainguard/minio-client:latest   -> read RepoDigests -> CLIENT_DIGEST
  2. Set MINIO_SERVER_IMAGE = "chainguard/minio@" + SERVER_DIGEST
     Set MINIO_CLIENT_IMAGE = "chainguard/minio-client@" + CLIENT_DIGEST
  3. Replace every quay.io/minio literal (see call-site list) with the matching constant/literal.
  4. Stand the env up and verify (see verify_or_fallback).
```

**All call sites (every one must move):**

| Site | What it holds | New value |
|---|---|---|
| `env.js:55` `DATASTORE_TABLE.minio.image` | server image (source of truth) | `MINIO_SERVER_IMAGE` |
| `env.js:612` comment | mentions `quay.io/minio/mc` | client mirror name |
| `env.js:625` `envObjectUpload` sidecar `docker run` | client image | `MINIO_CLIENT_IMAGE` |
| `env.js:841` `envSelftest` label + `s.image === ...` assertion | server image string (label text + equality) | new server literal (label + assert) |
| `test/env.test.mjs:138` compose-gen unit assertion | `s.image === "quay.io/minio/minio"` | new server literal |
| `test/env.test.mjs:344` integration `mc ls` sidecar | client image | new client literal |
| `docs/reference/cage-engine-acceptance.md:44` | prose "`quay.io/minio/minio`" | new server image name (digest optional in prose) |

**Anti-pattern:** repointing only `DATASTORE_TABLE.minio.image` and leaving the `mc` client sidecars on quay.io. Why: seed (`env.js:625`) and the test's `mc ls` (`test/env.test.mjs:344`) would still 401 — the test would red at seed/verify instead of at `up`.

**Anti-pattern:** using a `:latest` tag "to keep it simple". Why: Chainguard's free tier moves `:latest`, so the env is non-reproducible and can silently re-break.

**The probe ladder (only if the server times out on healthcheck):**

```
PROCEDURE verify_or_fallback:
  1. faff env up; poll minio health within SLA.
  2. IF healthy: keep probe verbatim. DONE.
  3. IF unhealthy AND cause is missing probe binary:
     a. Try wget form:  "wget -qO- http://localhost:9000/minio/health/ready || exit 1"  (app default probe style, env.js:277)
     b. Else a shell/TCP form the image supports.
     c. Re-stand; if healthy with an adapted probe, update DATASTORE_TABLE.minio.probe. DONE.
  4. IF no in-container probe works OR command/env are not drop-in:
     a. Switch both images to bitnamilegacy/minio + bitnamilegacy/minio-client (digest-pinned).
     b. Rework DATASTORE_TABLE.minio command:/env: to bitnami conventions; adjust mc invocation.
     c. Re-stand and verify. DONE.
  5. IF even the fallback cannot come up: STOP — escalate to a human (real broken-env, do not skip).
```

**Failure modes.**

- **The failure:** Chainguard's minimal server image omits `curl`, so the healthcheck never passes though the server booted. **How you'd know:** `faff env up` returns 1 with "health checks did not pass within SLA" (`env.js:738`); the container runs but `docker compose ps` never reports `healthy`. **What it means:** adapt the probe (ladder step 3), do not abandon.
- **The failure:** Chainguard's `minio-client` entrypoint is not `mc`, or its `mb`/`pipe`/`ls` arg handling differs, so the seed sidecar or the `mc ls` verification exits non-zero against a healthy server. **How you'd know:** `env seed` returns 1, or the integration test's `execFileSync(... "ls" ...)` throws / the object count is not 2. **What it means:** adjust the invocation; if irreconcilable, fall back to bitnamilegacy.
- **The failure:** the pinned Chainguard digest ages out of the free public tier (older non-`:latest` bits are paid), so the pull 404s later. **How you'd know:** `docker compose up` fails to pull the digest; env reds again with a pull error, not 401. **What it means:** re-resolve the digest from current `:latest`, or move to the frozen bitnamilegacy archive for stability. This is the registry-churn recurrence the out-of-scope authenticated-pull extension ultimately addresses.

## 5. Scenarios

```
Given the MinIO server and mc-client images are repointed at the digest-pinned public mirror
When `faff env up` provisions the minio env, `faff env seed` uploads a 2-row "users" fixture,
     and an mc-client sidecar runs `ls --recursive local/users`
Then env up returns 0 with the minio service reported healthy,
 And the bucket "users" contains exactly 2 `.json` objects,
 And `faff env down` tears the env down cleanly,
 And no `quay.io/minio` reference remains in env.js, test/env.test.mjs, or the doc
```

Non-functional assertion:

- The MinIO image references are digest-pinned (`@sha256:...`), not tag-pinned, in both `DATASTORE_TABLE` and every sidecar/test literal.

## 6. Design Decision Rationale

**Which mirror?** Options and trade-offs are tabled in WHAT. **Chosen:** `chainguard/minio` + `chainguard/minio-client`, digest-pinned, build-verified, with `bitnamilegacy/*` as the named fallback — because Chainguard tracks upstream (same `server /data` entrypoint and root-cred env), giving the cleanest drop-in, whereas bitnami's `/opt/bitnami` entrypoint would force a `command:`/`env:` rework up front. Rejected: Docker Hub `minio/minio`/`minio/mc` (404/401), `ghcr.io/minio/minio` (403), `public.ecr.aws` (404), quay.io (401) — all probed dead 2026-09-24.

**Tag or digest?** **Chosen:** digest — Chainguard's free tier keeps only a moving `:latest`, so only a digest is reproducible.

**In-container probe.** **Chosen (as an Assumes with a mechanical fallback ladder):** keep `curl -f .../health/ready` if the mirror ships curl; otherwise adapt (wget/shell) or fall back — resolvable at build without a human unless every option fails.

At the time of writing (2026-09-24), quay.io gates all `minio/minio` and `minio/mc` tags, and Chainguard's free public catalog keeps only `:latest`. Both are revisitable if the vendors change policy — in particular the out-of-scope authenticated-pull path becomes attractive if mirror churn recurs.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. (No Punt markers — the one genuinely uncertain item, the probe, is an Assumes with a mechanical validation-and-fallback path that keeps the build autonomous.)

**Assumptions.**

- **Assumes:** the chosen mirror server image provides an in-container HTTP readiness probe tool (today `curl -f`). Validate: stand the env up and confirm the `minio` service reaches `healthy` within SLA; if not, walk the probe ladder (HOW verify_or_fallback), then fall back to bitnamilegacy, escalating to a human only if all fail.
- **Assumes:** the chosen mirror client image's entrypoint is `mc` (or equivalent) and accepts `mb --ignore-existing`, `pipe`, and `ls --recursive` with the current arg shapes. Validate: the integration test's seed + `mc ls` count-of-2 passes; if not, adjust the invocation or fall back.

## 8. DONE — Definition of Done

### From WHY
- [ ] No `quay.io/minio` reference remains in `plugin/skills/faff/bin/lib/env.js`, `test/env.test.mjs`, or `docs/reference/cage-engine-acceptance.md` (server and client).
- [ ] No skip / reachability gate is added; the `[docker-gated]` daemon-absence gate (`test/env.test.mjs:213-238`) and `FAFF_REQUIRE_DOCKER` handling are unchanged.

### From WHAT (images)
- [ ] `DATASTORE_TABLE.minio.image` is the digest-pinned server mirror (`<repo>@sha256:...`).
- [ ] Both `mc` client sidecars (`env.js:625` seed, `test/env.test.mjs:344` verify) and the `env.js:612` comment use the digest-pinned client mirror.
- [ ] Every MinIO image reference is digest-pinned, not tag-pinned.

### From WHAT (assertions kept in sync)
- [ ] `envSelftest` (`env.js:841`) label text and `s.image === ...` assertion use the new server literal, and `faff env --selftest` passes.
- [ ] The compose-gen unit test (`test/env.test.mjs:138`) asserts the new server literal and passes.

### From HOW (behaviour — the born-verifiable AC)
- [ ] The docker-gated integration test (`test/env.test.mjs:323`) passes against the mirror: `env up` returns 0 with minio healthy, object-upload seed lands 2 objects, `mc ls` counts exactly 2, teardown clean. Verified locally if docker is available, otherwise green in the `env-rootless` CI job on the PR.
- [ ] The MinIO service reaches `healthy` within SLA with either the verbatim probe or, if adapted, the updated `DATASTORE_TABLE.minio.probe` (and the compose-gen probe assertion at `test/env.test.mjs:144` still matches whatever probe is emitted).

### From HOW (docs)
- [ ] `docs/reference/cage-engine-acceptance.md:44` names the mirror image, not `quay.io/minio/minio`.

### Suite
- [ ] `node --test test/env.test.mjs` passes; full test suite green; `faff validate-adapters` green.

**Integration smoke test:**

```
1. faff env compose-gen --profile {minio} --out dc.yml --project smoke  -> plan.json
2. faff env up --plan plan.json --project smoke --sla-secs 90           -> expect code 0, minio healthy
3. faff env seed --plan plan.json --manifest {users:2} --project smoke  -> expect code 0
4. docker run --rm --network smoke_default -e MC_HOST_local=http://faffdev:faffdevsecret@minio:9000 \
     <MINIO_CLIENT_IMAGE> ls --recursive local/users                    -> expect 2 .json lines
5. faff env down --project smoke                                        -> clean teardown
```

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
