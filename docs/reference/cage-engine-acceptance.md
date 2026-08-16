# Cage-engine acceptance — the joint four-point runbook

The bounded-engine posture (ADR-0041, decision 3) has two halves: **faff's side** — the `faff env`
lifecycle works against any docker-compatible engine reached via the ambient `DOCKER_HOST` — and
**claude-box's side** — a bounded nested engine (rootless dind, podman-in-podman, or a
sysbox-class runtime) available *inside* the cage, with no mounted host socket. This runbook is
where the two sides meet: run it inside claude-box when a cage image hands over a nested engine.

Points 1–3 are faff's, continuously enforced in CI by the `env-rootless` lane in
`.github/workflows/validate.yml`; point 4 is the cage image's isolation proof and can only be
demonstrated from inside the cage. All four passing inside claude-box means `faff env` → the
code-blind holdout evaluator works end-to-end on a properly-bounded cage.

## Precondition — the engine is present and compose-capable

Inside the cage, before anything else:

```bash
docker info                  # reachable via the ambient DOCKER_HOST (or the in-cage default socket)
docker compose version       # compose plugin available
docker info --format '{{.SecurityOptions}}'   # expect: contains "rootless" for a rootless engine
```

If `docker info` fails, the engine is absent or `DOCKER_HOST` is mis-set — fix the cage image /
environment first. faff never resolves or falls back to another socket: the ambient engine
context is the single authority (a dead `DOCKER_HOST` is a loud terminal error naming the value).

## Point 1 — compose up with no host socket

Acquire the point-2 subject first — it MUST publish a port, or point 2 is vacuous.

Preferred (deterministic, self-contained): write the synthetic minio datastore profile — the
same shape the `env-rootless` CI lane exercises (`test/env.test.mjs`) — straight to a file:

```bash
cat > profile.json <<'EOF'
{ "schema": 1, "datastores": [{ "kind": "minio", "evidence": "synthetic — cage-engine acceptance point-2 subject" }], "deploy_targets": [] }
EOF

faff env compose-gen --profile profile.json --out .faff/env/docker-compose.yml --project cage-accept > plan.json
faff env up --plan plan.json --project cage-accept
```

This provisions a single `minio/minio` service publishing `http://localhost:9000` with health
route `/minio/health/ready` — a real HTTP port for point 2 to reach.

Alternative (a repo that actually has provisionable infra): `cd` into it and mine its profile
instead —

```bash
cd <repo-with-provisionable-infra>
faff profile mine > profile.json   # only meaningful if the repo declares datastores/runtimes
faff env compose-gen --profile profile.json --out .faff/env/docker-compose.yml --project cage-accept > plan.json
faff env up --plan plan.json --project cage-accept
```

A repo with no infra artifacts (faff itself is one) mines to an empty profile: zero services,
empty endpoint, and point 2 has nothing to exercise — use the synthetic profile above for that
repo.

**Pass:** `up` exits 0 reporting all services healthy, with `/var/run/docker.sock` **not** mounted
from the host (see point 4).

## Point 2 — the published port is reachable from inside the cage

With the synthetic minio profile above, the published port is `http://localhost:9000` and the
health route is `/minio/health/ready`.

The env-handle `endpoint` the holdout evaluator is handed points at `localhost:<port>`; it must be
reachable from the cage's own processes (this is what rootless port-publishing configuration —
slirp4netns / pasta loopback binding — can silently break while in-container healthchecks stay
green).

`health_checks[].path` is a probe **descriptor**, not always a URL path: for an HTTP app service
it's a URL path to append to `endpoint` (`expected_status: 200`); for a datastore service such as
minio it's a full probe command with the health URL already embedded (`expected_status: 0`). The
snippet below resolves either shape from the plan's already-resolved `endpoint` rather than
concatenating blindly:

```bash
url=$(node -e '
  const p = JSON.parse(require("fs").readFileSync("plan.json","utf8"));
  const hc = p.health_checks.find(h => h.name === "app") || p.health_checks[0] || {};
  const path = hc.path || "";
  if (path.startsWith("/")) console.log(p.endpoint + path);          // HTTP app: append the URL path
  else { const m = path.match(/https?:\/\/\S+/); console.log(m ? m[0] : p.endpoint); }  // datastore: extract the embedded URL
')
curl -fsS "$url"           # expect the health route's expected status (200 for minio's ready probe)
```

**Pass:** the HTTP request succeeds from inside the cage (not from the host).

## Point 3 — clean teardown

```bash
faff env seed --plan plan.json --project cage-accept   # optional but exercises the exec path
faff env down --project cage-accept
docker compose -p cage-accept ps                       # expect: no services
```

**Pass:** `down` exits 0 and no `cage-accept` containers or volumes remain.

## Point 4 — isolation proof (claude-box's side)

Property of the cage image, not of faff:

```bash
ls /var/run/docker.sock        # expect: absent, or owned by the NESTED daemon (never the host's)
docker info --format '{{.SecurityOptions}}'   # expect: rootless (privileged dind is the named weaker posture)
# and the cage cannot see the host filesystem (spot-check a known host path is absent)
```

**Pass:** no mounted host socket, and the engine's authority is bounded by the cage. A mounted
host socket fails the ADR-0041 boundedness criterion by definition — any lane could start a
privileged container and mount the host fs, so the cage would not be host-isolated at all.

## Caveats the cage image owns

Storage-driver and cgroup quirks (fuse-overlayfs, cgroup v2 delegation, slirp4netns vs pasta
flags) are cage-image preconditions: faff stays engine-agnostic and adapts to none of them. If
CI's `env-rootless` lane is green but a point above fails inside claude-box, the divergence is in
the cage image's engine configuration — fix it there, and record the observed requirement here.
