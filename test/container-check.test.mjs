// FAFF-42 — `faff container-check`: assert the ADR-0010 blast-radius boundary.
// Exercises the real entrypoint via runCli (shebang dispatch, arg parsing, exit codes)
// and the in-process pure-function table via --selftest. Per ADR 0002 — assert the
// deterministic seam (token / exit / parsed JSON), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";
import { HOST_SOCKET_PATHS, hostSocketProbe } from "../plugin/skills/faff/bin/lib/container-check.js";

// --selftest drives the full pure container_check(env, fsq) precedence table in-process
// (k8s / dockerenv / containerenv / pid1-container= / env-container / no-signal, precedence,
// falsey-env edges, and the real-adapter never-throws guarantee). Deterministic — no env/fs dep.
test("container-check --selftest: the precedence table passes (exit 0)", () => {
  const { stdout, code } = runCli(["container-check", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

// A forced k8s signal (highest precedence) yields contained/k8s deterministically,
// regardless of any marker file on the host — exit 0.
test("container-check: KUBERNETES_SERVICE_HOST set → contained/k8s, exit 0 (--json)", () => {
  const prev = process.env.KUBERNETES_SERVICE_HOST;
  process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
  try {
    const { stdout, code } = runCli(["container-check", "--json"]);
    assert.equal(code, 0, stdout);
    const out = JSON.parse(stdout);
    assert.equal(out.result, "contained");
    assert.equal(out.basis, "k8s");
  } finally {
    if (prev === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
    else process.env.KUBERNETES_SERVICE_HOST = prev;
  }
});

// Default (non-JSON) output is the same verdict in human form, including the basis.
test("container-check: default output names result + basis", () => {
  const prev = process.env.KUBERNETES_SERVICE_HOST;
  process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
  try {
    const { stdout, code } = runCli(["container-check"]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /contained/);
    assert.match(stdout, /basis: k8s/);
  } finally {
    if (prev === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
    else process.env.KUBERNETES_SERVICE_HOST = prev;
  }
});

// Shape + exit-code contract hold whatever the ambient runtime is: result is one of the
// two enum values, basis is a non-empty string, and exit 0 ⟺ contained (1 ⟺ not_confirmed).
test("container-check --json: well-formed shape, exit code agrees with result", () => {
  const { stdout, code } = runCli(["container-check", "--json"]);
  const out = JSON.parse(stdout);
  assert.ok(["contained", "not_confirmed"].includes(out.result), `result=${out.result}`);
  assert.equal(typeof out.basis, "string");
  assert.ok(out.basis.length > 0);
  assert.equal(code, out.result === "contained" ? 0 : 1);
});

// FAFF-333 — hostSocketProbe: pure, injected-fsq fixtures over the two canonical
// HOST docker socket paths. A DIFFERENT axis from containment (containerCheck above) —
// boundedness (ADR-0041 decision 3), never folded into containerCheck's own contract.
// FAFF-713 — hostSocketProbe now reads `fsq.probePath` (tri-state) and returns
// `{ present, path, state }`; `present` stays true only on a confirmed-present socket.
test("hostSocketProbe: absent → {present:false, path:null, state:absent}", () => {
  const fsq = { probePath: () => "absent" };
  assert.deepEqual(hostSocketProbe(fsq), { present: false, path: null, state: "absent" });
});

test("hostSocketProbe: /var/run/docker.sock present → flagged with that path", () => {
  const fsq = { probePath: (p) => (p === "/var/run/docker.sock" ? "present" : "absent") };
  assert.deepEqual(hostSocketProbe(fsq), { present: true, path: "/var/run/docker.sock", state: "present" });
});

test("hostSocketProbe: /run/docker.sock present → flagged with that path", () => {
  const fsq = { probePath: (p) => (p === "/run/docker.sock" ? "present" : "absent") };
  assert.deepEqual(hostSocketProbe(fsq), { present: true, path: "/run/docker.sock", state: "present" });
});

test("hostSocketProbe: both present → the first checked path wins", () => {
  const fsq = { probePath: () => "present" };
  assert.deepEqual(hostSocketProbe(fsq), { present: true, path: HOST_SOCKET_PATHS[0], state: "present" });
});

test("hostSocketProbe: rootless paths are deliberately excluded (never false-positive the recommended posture)", () => {
  const fsq = { probePath: (p) => ((p === "/run/user/1000/docker.sock" || p === "/run/user/1000/podman/podman.sock") ? "present" : "absent") };
  assert.deepEqual(hostSocketProbe(fsq), { present: false, path: null, state: "absent" });
});

test("hostSocketProbe: probe error on a canonical path → {present:false, state:error} (FAFF-713)", () => {
  const fsq = { probePath: (p) => (p === "/var/run/docker.sock" ? "error" : "absent") };
  assert.deepEqual(hostSocketProbe(fsq), { present: false, path: "/var/run/docker.sock", state: "error" });
});

test("hostSocketProbe: a present path wins over an EARLIER error path — present is never masked (FAFF-713)", () => {
  // path[0] errors, path[1] is present → must return present (not error). Pins the
  // loop's present-wins-immediately invariant against future refactors.
  const fsq = { probePath: (p) => (p === HOST_SOCKET_PATHS[0] ? "error" : "present") };
  assert.deepEqual(hostSocketProbe(fsq), { present: true, path: HOST_SOCKET_PATHS[1], state: "present" });
});

// `container-check --json` surfaces host_socket as an ADDITIONAL field — exit code stays
// governed by `result` (containment) alone, never by host_socket presence.
test("container-check --json: host_socket field is well-formed and exit is unaffected by it", () => {
  const { stdout, code } = runCli(["container-check", "--json"]);
  const out = JSON.parse(stdout);
  assert.ok(out.host_socket && typeof out.host_socket === "object", "host_socket field present");
  assert.equal(typeof out.host_socket.present, "boolean");
  assert.ok(out.host_socket.path === null || typeof out.host_socket.path === "string");
  // Exit is driven by `result` only (asserted above too) — host_socket never flips it.
  assert.equal(code, out.result === "contained" ? 0 : 1);
});
