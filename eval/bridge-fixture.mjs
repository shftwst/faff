// FAFF-1107 - the docker-fixture lifecycle for the code-interface holdout path.
//
// The sibling of eval/docker-fixture.mjs: that module stands a PRE-BUILT public image up and polls it;
// the code-interface path needs a CUSTOM image (the bridge + its lib + the fixture component + the
// manifest baked into one SUT cage) and a source-present probe inside it. So this module adds buildImage
// / upBridge / execExists and RE-EXPORTS the shared down / dangling / waitReady rather than overloading
// docker-fixture.mjs, which stays byte-unchanged so the service path never regresses.
//
// Importing this module spawns nothing: every function only calls docker when INVOKED.
import { spawnSync } from "node:child_process";

export { down, dangling, waitReady } from "./docker-fixture.mjs";

// Build the fixture image from a self-contained context directory (the caller stages the bridge, its
// lib/, and the fixture files into it). Returns true on a clean build, false otherwise - never a throw,
// so a docker-gated test can branch/skip and still run teardown.
export function buildImage(contextDir, tag) {
  const r = spawnSync("docker", ["build", "-q", "-t", tag, contextDir], { encoding: "utf8" });
  return r.status === 0;
}

// Stand the bridge container up: remove any stale namesake, then `docker run -d` bound to 127.0.0.1 so
// the published port is reachable only from the host (the co-resident SUT cage). Returns true on a clean
// launch, false otherwise.
export function upBridge({ name, tag, hostPort, containerPort = 8080 }) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  const r = spawnSync(
    "docker",
    ["run", "-d", "--name", name, "-p", `127.0.0.1:${hostPort}:${containerPort}`, tag],
    { encoding: "utf8" },
  );
  return r.status === 0;
}

// Whether `path` exists inside the named running container - `docker exec <name> test -e <path>`. Needs
// nothing installed in the container, so it is the always-feasible source-present probe the topology
// proof rests on: source present in the bridge cage, absent in the neutral judge cage.
export function execExists(name, path) {
  return spawnSync("docker", ["exec", name, "test", "-e", path], { stdio: "ignore" }).status === 0;
}
