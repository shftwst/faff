// FAFF-42 — `faff container-check`: assert the ADR-0010 blast-radius boundary.
// Exercises the real entrypoint via runCli (shebang dispatch, arg parsing, exit codes)
// and the in-process pure-function table via --selftest. Per ADR 0002 — assert the
// deterministic seam (token / exit / parsed JSON), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

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
