# Docker-gated tests — probe cheaply, defer the heavy work

A test that needs docker must not do heavy docker work at module load. `faff gates run` splits the
UNIT rung into N `node --test` shards run through a bounded pool (`docs/reference/GLOSSARY.md`:
shard), and every shard imports every test file at discovery. A `docker build`/`docker run` at a
file's top level therefore fires N times, oversubscribes the box, and starves timing-sensitive
sibling tests into spurious REDs (FAFF-1137).

## The convention

- **Probe with `docker info` only, at module top level.** It is a cheap daemon-liveness check; it
  never builds or runs a container. Use its result to compute a skip reason.
- **Defer every `docker build` / `docker run` / `docker exec` into the gated test body**, behind
  that skip. A skipped test does no docker work at discovery, so the probe is the only cost a
  docker-less or contended shard pays.
- **Degrade honestly.** When the daemon is absent, `t.skip` the build legs and narrow any
  sibling-capability assertion, rather than letting a build failure red the shard.

## Exemplar

`test/holdout-rpc-evaluate-integration.test.mjs` (FAFF-1138): a single top-level
`spawnSync("docker", ["info"], …)` sets `SKIP_E2E`; `buildImage` and the container run/exec all sit
inside the gated body and `t.skip` when the daemon is unavailable.
