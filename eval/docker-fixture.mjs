// FAFF-474 — the shared docker-fixture lifecycle for the live holdout lane.
//
// Extracted verbatim-in-behaviour from test/holdout-evaluate-integration.test.mjs (FAFF-34), which grew
// the first up()/waitReady()/down()/dangling() helpers against a real hashicorp/http-echo container. Two
// callers now need the identical up/wait/down shape — that integration test AND eval/live-agent-driver.mjs
// (the live holdout-live driver) — so the lifecycle lives here once and both import it, rather than a
// second copy drifting out of step with the first.
//
// Importing this module spawns nothing: every function only calls docker/fetch when INVOKED. eval/ stays
// out of `node --test`'s reach for its own contents, and the integration test (docker-gated, under test/)
// pulls these in without paying a spawn at import. `fetch` is injectable so a unit test can drive
// waitReady with a stub and never touch a real port.

import { spawnSync } from "node:child_process";

// Stand a container up: remove any stale namesake, then `docker run -d` the image with its launch args,
// publishing hostPort → containerPort. Returns true on a clean launch, false otherwise (the caller
// asserts/branches — never a throw, so teardown still runs). `args` are the image's own launch args
// (e.g. http-echo's `-listen`/`-text`), appended after the image so the ground truth is baked in.
export function up({ name, image, args = [], hostPort, containerPort = 5678 }) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  const r = spawnSync(
    "docker",
    ["run", "-d", "--name", name, "-p", `${hostPort}:${containerPort}`, image, ...args],
    { encoding: "utf8" },
  );
  return r.status === 0;
}

// Tear a container down by name. Best-effort and idempotent (a missing container is a no-op), so it is
// safe to call from a `finally` on every exit path — success, model error, health timeout.
export function down(name) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}

// The container ids still matching `name` (empty string when torn down) — the teardown-completeness probe.
export function dangling(name) {
  return spawnSync("docker", ["ps", "-aq", "--filter", `name=${name}`], { encoding: "utf8" }).stdout.trim();
}

// Poll an endpoint until it answers ok or the try budget runs out. `fetchImpl`/`delayMs` are injectable
// so a unit test drives the poll deterministically with a stub and zero real network.
export async function waitReady(endpoint, tries = 40, { fetchImpl = fetch, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(endpoint);
      if (r.ok) return true;
    } catch {
      /* not up yet — keep polling */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

// The real docker-backed lifecycle bundle live-agent-driver.mjs defaults to. A unit test passes its own
// stub bundle of the same shape (up/waitReady/down/dangling) so driveHoldoutLiveRep never spawns docker.
export const dockerLifecycle = { up, down, dangling, waitReady };
