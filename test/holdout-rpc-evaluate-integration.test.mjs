// FAFF-1107 - docker-gated end-to-end + code-blind conformance test for the code-interface holdout path.
//
// The code-interface sibling of test/holdout-evaluate-integration.test.mjs. It builds the fixture image
// (the FAFF-1104 bridge + its lib + the Stack component source + the FAFF-1103 manifest baked into ONE
// SUT cage), stands the bridge up on a 127.0.0.1 port, and proves three things against that single
// bring-up:
//   1. the six frozen wire conformance scenarios answer live over the containerised bridge;
//   2. the REAL evaluate-call.mjs spawner (byte-unchanged) - driven with an injected RPC-exerciser
//      spawnFn and a stubbed passing preflightFn - writes an attested, code-blind, meets-spec verdict
//      that the REAL `faff contract holdout-verdict --require-spawner-attested` accepts;
//   3. the cage topology holds: the source is co-resident with the bridge cage and absent from a neutral
//      judge cage, while the code is still reachable over the wire.
//
// It changes ZERO production code - every merged piece is exercised as shipped.
//
// Honest degradation: the containerised suite probes the capabilities it actually needs (daemon +
// throwaway build + bare-node sibling run/exec) and SKIPS cleanly when a runner lacks one, never a RED
// flake. The manifest-validity and exerciser plane-splitting assertions run UNGATED (no docker) - the
// latter against the bridge's in-process realListen(), the same real-listener standup test/impure uses.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImage, upBridge, execExists, down, dangling, waitReady } from "../eval/bridge-fixture.mjs";
import { rpc, runSequence, buildVerdict, classifyDoD, SESSION_REF } from "./helpers/holdout-rpc-exercise.mjs";
import { main as evalMain, EXIT, buildWithheldSet } from "../plugin/skills/faffter-noon-evaluate/evaluate-call.mjs";
import { realListen, buildAllowlist } from "../plugin/skills/faff/bin/faff-bridge-node.mjs";
import { Stack, util } from "./fixtures/code-interface/stack.mjs";

const W = "faff.session-rpc/1";
const NEUTRAL_IMAGE = "node:20-alpine";
const SOURCE_FILE_IN_IMAGE = "/app/stack.mjs"; // the `test -e` probe path - a FILE, never the isDirectory-gated preflight path

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/code-interface/", import.meta.url));
const MANIFEST_PATH = join(FIXTURE_DIR, "binding-manifest.json");
const BRIDGE = fileURLToPath(new URL("../plugin/skills/faff/bin/faff-bridge-node.mjs", import.meta.url));
const LIB = fileURLToPath(new URL("../plugin/skills/faff/bin/lib", import.meta.url));

// The faff bin, resolved repo-relative and invoked via node - the same hermetic form the sibling
// holdout-evaluate-integration.test.mjs and classifyDoD use, so the test exercises the checkout's own
// bin regardless of host PATH (CI has no faff on PATH).
const FAFF = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));

// A fixture DoD whose criteria are all born-verifiable (no prose), so the aggregate is a clean
// meets-spec when every criterion is met and never meets-spec when one is unmet.
const SPEC = [
  "## Scenarios",
  "```",
  "Given a fresh Stack",
  "When the client pushes 7 then pops",
  "Then pop returns 7",
  "```",
  "",
  "## 8. DONE",
  "- [ ] pop MUST return the last pushed value",
].join("\n");

// The lane-boundary intent artifact: the evaluator cage promise (the bridge sits on the opposite side).
const LANE_BOUNDARY = JSON.stringify({ lane: "evaluator", container: "own", accesses: { repo: "absent" } }, null, 2);

// The fixed exercise script the deterministic stand-in derives for the Stack: open, push 7, pop -> 7.
const stackScript = (expectValue) => ({
  steps: [
    { wire: W, id: "1", method: "open", target: "Stack", ctor_args: [] },
    { wire: W, id: "2", method: "call", session_id: SESSION_REF, op: "push", args: [7] },
    { wire: W, id: "3", method: "call", session_id: SESSION_REF, op: "pop", args: [] },
  ],
  expect: { outcome: "returned", value: expectValue },
});

// Stage a self-contained docker build context: the committed fixture files plus the bridge and its lib
// copied in beside them, so every COPY in the fixture Dockerfile resolves within one context.
function stageContext() {
  const dir = mkdtempSync(join(tmpdir(), "faff-1107-ctx-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  copyFileSync(BRIDGE, join(dir, "faff-bridge-node.mjs"));
  cpSync(LIB, join(dir, "lib"), { recursive: true });
  return dir;
}

// Discovery-time gate: only the cheap `docker info` daemon check runs at module top level. The build and
// sibling capabilities degrade honestly inside the gated body (buildImage -> t.skip; neutral-cage run
// status -> narrowed form), so no docker build or sibling run/exec fires at test discovery.
const SKIP_E2E = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0 ? false : "docker daemon unavailable";

// A currently-free loopback port, picked by binding a throwaway server on port 0 and reading the OS
// assignment. net.Server.listen/close are event/callback-based, so each is promisified. The server must
// close before docker binds the port; the close->run gap is an accepted TOCTOU race (see spec §4 item 2).
async function freePort() {
  const srv = createServer();
  const port = await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(srv.address().port));
  });
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

const contractExit = (file, ...extra) =>
  spawnSync("node", [FAFF, "contract", "holdout-verdict", ...extra, "--in", file], { encoding: "utf8" }).status;

// ---- UNGATED: manifest validity ------------------------------------------------------------------

test("fixture binding manifest passes faff manifest validate (ungated)", () => {
  const r = spawnSync("node", [FAFF, "manifest", "validate", "--file", MANIFEST_PATH], { encoding: "utf8" });
  assert.equal(r.status, 0, `manifest validate should exit 0: ${r.stderr}`);
});

// ---- UNGATED: exerciser plane-splitting against the in-process real listener ----------------------

test("rpc exerciser splits the two failure planes against in-process realListen (ungated)", async () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const state = { wireMajor: 1, allowlist: buildAllowlist(manifest), moduleRoot: { Stack, util }, sessions: new Map() };
  const server = await realListen("127.0.0.1", 0, state);
  const endpoint = `http://127.0.0.1:${server.address().port}/`;
  try {
    const returned = await runSequence(endpoint, stackScript(7).steps);
    assert.equal(returned.results[2].result.value, 7, "returned plane: pop returns the pushed value");
    assert.equal(returned.sessionsClosed, true, "the exerciser always closes the session it opened");

    const threw = await runSequence(endpoint, [
      { wire: W, id: "1", method: "open", target: "Stack", ctor_args: [] },
      { wire: W, id: "2", method: "call", session_id: SESSION_REF, op: "pop", args: [] },
    ]);
    assert.equal(threw.results[1].result.outcome, "threw", "threw plane: empty pop is a thrown result");
    assert.equal(threw.results[1].result.error.type, "TypeError");
    assert.equal(threw.results[1].error, undefined, "a throw is never a top-level WireError");

    const wireErr = await rpc(endpoint, { wire: W, id: "x", method: "call", session_id: "s-nope", op: "pop", args: [] });
    assert.equal(wireErr.error.code, "unknown_session", "WireError plane: unknown session is a top-level error");
    assert.equal(wireErr.result, undefined);

    // buildVerdict reads the planes distinctly: a threw criterion asserts on the ThrownError -> met.
    const v = await buildVerdict({
      classified: [{ class: "scenario" }],
      endpoint,
      script: {
        steps: [
          { wire: W, id: "1", method: "open", target: "Stack", ctor_args: [] },
          { wire: W, id: "2", method: "call", session_id: SESSION_REF, op: "pop", args: [] },
        ],
        expect: { outcome: "threw", type: "TypeError", message: "empty" },
      },
    });
    assert.equal(v.criteria[0].verdict, "met");
    assert.equal(v.code_blind, true);
  } finally {
    server.close();
  }
});

// ---- DOCKER-GATED: e2e + live conformance + topology + violating variant --------------------------

test("code-interface holdout: live conformance + real-spawner e2e + topology (docker-gated)", { skip: SKIP_E2E }, async (t) => {
  const tag = "faff-ci-stack";
  const name = `faff-ci-stack-${process.pid}`;

  // A passing in-cage preflight is stubbed: the CI host is uncaged, so the real repo-absent probe would
  // refuse on every run. Placement is proven by the topology assertions below, not by this stub.
  const preflightFn = () => ({ holds: true, refusals: [] });

  // Setup artifacts are created INSIDE the try so a mid-setup throw still hits teardown; each is declared
  // here and guarded on its own existence in the finally.
  let staging, workdir, specPath, intentPath, endpoint;
  let imageBuilt = false;

  let spawnPayloadSeen;
  const runSpawner = async (outPath, expectValue) => {
    const code = await evalMain(
      ["--spec", specPath, "--endpoint", endpoint, "--intent", intentPath, "--key", "TEST", "--out", outPath],
      {
        preflightFn,
        spawnFn: async (payload) => {
          spawnPayloadSeen = payload;
          const classified = classifyDoD(FAFF, payload.specText);
          const verdict = await buildVerdict({ classified, endpoint: payload.endpoints[0], script: stackScript(expectValue) });
          return { status: "ok", verdict };
        },
      },
    );
    return { code, verdict: JSON.parse(readFileSync(outPath, "utf8")) };
  };

  try {
    staging = stageContext();
    workdir = mkdtempSync(join(tmpdir(), "faff-1107-run-"));
    specPath = join(workdir, "spec.md");
    intentPath = join(workdir, "lane-boundary.json");
    writeFileSync(specPath, SPEC);
    writeFileSync(intentPath, LANE_BOUNDARY);

    // The real build IS the build-capability check: a build-denied host skips cleanly, never a RED.
    if (!buildImage(staging, tag)) {
      t.skip("docker build not permitted");
      return;
    }
    imageBuilt = true;

    const hostPort = await freePort();
    endpoint = `http://127.0.0.1:${hostPort}/`;
    assert.ok(upBridge({ name, tag, hostPort, containerPort: 8080 }), "bridge container stands up on 127.0.0.1");
    assert.ok(await waitReady(`${endpoint}faff-rpc/health`), "the bridge reaches health");

    await t.test("the six frozen wire conformance scenarios answer live over the containerised bridge", async () => {
      const opened = await rpc(endpoint, { wire: W, id: "1", method: "open", target: "Stack", ctor_args: [] });
      assert.equal(opened.result.outcome, "returned");
      assert.match(opened.result.session_id, /^s-/);
      const sid = opened.result.session_id;

      assert.equal((await rpc(endpoint, { wire: W, id: "2", method: "call", session_id: sid, op: "push", args: [7] })).result.outcome, "returned");
      assert.equal((await rpc(endpoint, { wire: W, id: "3", method: "call", session_id: sid, op: "pop", args: [] })).result.value, 7);

      const threw = await rpc(endpoint, { wire: W, id: "4", method: "call", session_id: sid, op: "pop", args: [] });
      assert.equal(threw.result.outcome, "threw");
      assert.equal(threw.result.error.type, "TypeError");
      assert.equal(threw.error, undefined);

      const drain = await rpc(endpoint, { wire: W, id: "5", method: "call_static", op: "util.drain", args: [21] });
      assert.equal(drain.result.value, 42);

      const badVersion = await rpc(endpoint, { wire: "faff.session-rpc/2", id: "6", method: "open", target: "Stack", ctor_args: [] });
      assert.equal(badVersion.error.code, "unsupported_version");

      assert.equal((await rpc(endpoint, { wire: W, id: "7", method: "close", session_id: sid })).result.outcome, "returned");
      const closedAgain = await rpc(endpoint, { wire: W, id: "8", method: "close", session_id: sid });
      assert.equal(closedAgain.result.outcome, "returned", "close is an idempotent no-op");
      assert.equal(closedAgain.error, undefined);

      const unknown = await rpc(endpoint, { wire: W, id: "9", method: "call", session_id: sid, op: "pop", args: [] });
      assert.equal(unknown.error.code, "unknown_session", "call on a closed session is a strict wire error");
      assert.equal(unknown.result, undefined);
    });

    await t.test("the real evaluate-call spawner writes an attested, code-blind, meets-spec verdict", async () => {
      const classified = classifyDoD(FAFF, SPEC);
      assert.ok(classified.filter((c) => c.class !== "prose").length >= 1, "the fixture spec carries born-verifiable criteria");

      const outPath = join(workdir, "verdict.json");
      const { code, verdict } = await runSpawner(outPath, 7);
      assert.equal(code, EXIT.OK, "the spawner exits OK");
      assert.equal(verdict.code_blind, true, "code_blind is spawner-derived true");
      assert.equal(verdict.spawner_attested, true, "the spawner stamped its attestation");
      assert.equal(verdict.aggregate, "meets-spec", "all born-verifiable criteria met over the wire");

      assert.equal(contractExit(outPath, "--require-spawner-attested"), 0, "the real contract accepts the attested verdict");
    });

    await t.test("the cage topology holds: co-residency split, withheld-set, wire reachability", async () => {
      // Co-residency: the component source lives inside the bridge (SUT) cage.
      assert.equal(execExists(name, SOURCE_FILE_IN_IMAGE), true, "the source is co-resident with the bridge cage");

      // The judge is launched blind: the payload the spawner handed the engine carries only the
      // withheld-safe keys - no repo path / cwd / diff - and the withheld-set is true by construction.
      assert.ok(spawnPayloadSeen, "the happy-path spawn payload was captured");
      assert.deepEqual(Object.keys(spawnPayloadSeen).sort(), ["deadlineMs", "endpoints", "intentText", "specText"]);

      // Live cross-check: the withheld-set the spawner keeps from the child must be the one that actually
      // flowed into the persisted verdict's attestation (build -> derive -> assemble -> write), not a
      // literal compared against a copy of its own definition.
      const persisted = JSON.parse(readFileSync(join(workdir, "verdict.json"), "utf8"));
      assert.deepEqual(persisted.attestation.withheld, buildWithheldSet(), "the persisted verdict's attestation carries the spawner-derived withheld-set");

      // The co-residency split. The `docker exec test -e` probe needs nothing installed in either
      // container, so it is the always-feasible form. The optional `faff evaluator-preflight
      // --repo-path <dir>` corroboration is omitted here: faff is not on PATH in the bare-node judge
      // cage, and it would need a DIRECTORY path (its absent-check is isDirectory-gated), distinct from
      // the file path this probe uses - never the same variable.
      const neutral = `faff-ci-neutral-${process.pid}`;
      spawnSync("docker", ["rm", "-f", neutral], { stdio: "ignore" });
      const ranNeutral = spawnSync("docker", ["run", "-d", "--name", neutral, NEUTRAL_IMAGE, "sleep", "120"], { encoding: "utf8" }).status === 0;
      if (ranNeutral) {
        try {
          assert.equal(execExists(neutral, SOURCE_FILE_IN_IMAGE), false, "the judge cage cannot see the source");
          assert.equal(execExists(name, SOURCE_FILE_IN_IMAGE), true, "the SUT cage legitimately holds it");
        } finally {
          down(neutral);
        }
      } else {
        // Narrowed single-container form when a sibling container is not permitted: source present in
        // the bridge cage only, no neutral sibling.
        assert.equal(execExists(name, SOURCE_FILE_IN_IMAGE), true, "narrowed form: source present in the bridge cage");
      }

      // Reachability despite invisibility: a full wire round trip from the judge side succeeds while the
      // source is unreadable there.
      const roundTrip = await runSequence(endpoint, [
        { wire: W, id: "1", method: "open", target: "Stack", ctor_args: [] },
        { wire: W, id: "2", method: "call", session_id: SESSION_REF, op: "push", args: [5] },
        { wire: W, id: "3", method: "call", session_id: SESSION_REF, op: "pop", args: [] },
      ]);
      assert.equal(roundTrip.results[2].result.value, 5, "the code is reachable over the wire");
      assert.equal(roundTrip.sessionsClosed, true);
    });

    await t.test("a violating criterion yields an unmet, never-meets-spec, still contract-valid verdict", async () => {
      const outPath = join(workdir, "verdict-violating.json");
      // The fixture's pop returns 7; a criterion asserting 999 is one the running feature cannot meet.
      const { code, verdict } = await runSpawner(outPath, 999);
      assert.equal(code, EXIT.OK);
      assert.ok(verdict.criteria.some((c) => c.verdict === "unmet"), "at least one criterion comes back unmet");
      assert.notEqual(verdict.aggregate, "meets-spec", "a violating feature never reads as meets-spec");
      assert.equal(contractExit(outPath), 0, "the unmet verdict is still contract-valid");
    });
  } finally {
    down(name);
    if (imageBuilt) spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
    if (workdir) rmSync(workdir, { recursive: true, force: true });
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
  assert.equal(dangling(name), "", "the bridge container is torn down - no leak");
});
