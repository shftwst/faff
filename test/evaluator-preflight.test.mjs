// FAFF-276 — `faff evaluator-preflight` + the `lane-boundary` contract.
// The rung-2 assert-in primitive that makes evaluator code-blindness a physical fact:
// exercises the real entrypoint via runCli (arg parsing, exit codes, JSON shape) and the
// pure evaluatorPreflight(env, fsq, repoPath) core in-process with an injected fsq. Per
// ADR 0002 — assert the deterministic seam (holds/refusals/exit), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";
import { evaluatorPreflight } from "../plugin/skills/faff/bin/lib/evaluator-preflight.js";

// An injectable fsq matching container-check's realFsq shape.
const mkFsq = (present, dirs) => ({
  exists: (p) => present.has(p),
  readEnviron: () => "",
  isDirectory: (p) => dirs.has(p),
});
const CONTAINED = new Set(["/.dockerenv"]);   // a docker marker → containerCheck contained
const NOSIGNAL = new Set();

// --- pure core (the in-process seam) ---

test("evaluatorPreflight: contained + repo absent → holds, no refusals", () => {
  const r = evaluatorPreflight({}, mkFsq(CONTAINED, new Set()), "/gone");
  assert.equal(r.holds, true);
  assert.deepEqual(r.refusals, []);
});

test("evaluatorPreflight: contained + repo readable → refuse, repo-absent leg (physical probe, not a claim)", () => {
  const r = evaluatorPreflight({}, mkFsq(CONTAINED, new Set(["/repo"])), "/repo");
  assert.equal(r.holds, false);
  assert.deepEqual(r.refusals.map((x) => x.leg), ["repo-absent"]);
});

test("evaluatorPreflight: not contained + repo absent → refuse, in-container leg", () => {
  const r = evaluatorPreflight({}, mkFsq(NOSIGNAL, new Set()), "/gone");
  assert.equal(r.holds, false);
  assert.deepEqual(r.refusals.map((x) => x.leg), ["in-container"]);
});

test("evaluatorPreflight: both legs fail → reports EVERY refusal, not just the first", () => {
  const r = evaluatorPreflight({}, mkFsq(NOSIGNAL, new Set(["/repo"])), "/repo");
  assert.equal(r.holds, false);
  assert.deepEqual(r.refusals.map((x) => x.leg).sort(), ["in-container", "repo-absent"]);
});

test("evaluatorPreflight: an absent/non-directory repoPath passes the repo-absent leg (blind state) — never throws", () => {
  // realFsq's never-throws guarantee: statSync on an absent path is caught → isDirectory false.
  const r = evaluatorPreflight({}, mkFsq(CONTAINED, new Set(["/somewhere-else"])), "/no/such/repo/xyz");
  assert.equal(r.holds, true);
  assert.equal(r.refusals.some((x) => x.leg === "repo-absent"), false);
});

// --- CLI seam (the real entrypoint) ---

test("evaluator-preflight --selftest: the fixture table passes (exit 0)", () => {
  const { stdout, code } = runCli(["evaluator-preflight", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

test("evaluator-preflight --repo-path <real dir> in a container marker → exit 1, refusals name repo-absent", () => {
  // Force the in-container leg to pass via k8s marker so the repo-absent leg is isolated.
  const env = { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1" };
  const { stdout, code } = runCli(["evaluator-preflight", "--repo-path", repoRoot, "--json"], { env });
  assert.equal(code, 1, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.holds, false);
  assert.deepEqual(out.refusals.map((x) => x.leg), ["repo-absent"]);
});

test("evaluator-preflight --repo-path <nonexistent> in a container marker → exit 0 (holds)", () => {
  const env = { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1" };
  const { stdout, code } = runCli(["evaluator-preflight", "--repo-path", "/no/such/path/xyz", "--json"], { env });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.holds, true);
  assert.deepEqual(out.refusals, []);
});

test("evaluator-preflight: human (non-JSON) output lists each refusal leg", () => {
  const { stdout, code } = runCli(["evaluator-preflight", "--repo-path", repoRoot], { env: { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1" } });
  assert.equal(code, 1, stdout);
  assert.match(stdout, /REFUSE/);
  assert.match(stdout, /repo-absent/);
});

test("evaluator-preflight --repo-path with no value → usage exit 2", () => {
  const { code } = runCli(["evaluator-preflight", "--repo-path"]);
  assert.equal(code, 2);
});

// --- the lane-boundary contract (intent-out half) ---

test("contract lane-boundary: conformant evaluator intent → exit 0", () => {
  const input = JSON.stringify({ version: 1, lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false });
  const { stdout, code } = runCli(["contract", "lane-boundary"], { input });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.violations.length, 0);
  assert.equal(out.lane, "evaluator");
  assert.deepEqual(out.accesses, { repo: "absent", host_socket: "absent" });
});

test("contract lane-boundary: out-of-enum container → violations, exit 1 (not fail-loud)", () => {
  const input = JSON.stringify({ version: 1, lane: "evaluator", container: "vm", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false });
  const { stdout, code } = runCli(["contract", "lane-boundary"], { input });
  assert.equal(code, 1, stdout);
  const out = JSON.parse(stdout);
  assert.ok(out.violations.some((v) => /container/.test(v)));
});

test("contract lane-boundary: non-object → fail-loud, exit 2", () => {
  const { code } = runCli(["contract", "lane-boundary"], { input: '"not an object"' });
  assert.equal(code, 2);
});

test("contract lane-boundary --selftest: the fixture table passes (exit 0)", () => {
  const { stdout, code } = runCli(["contract", "lane-boundary", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});
